> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Registrar referido (6/10/2026): contrato, evidencia, límites y siguientes pasos

**Qué hace:** agrega UNA fila en la pestaña "Referidos" del CRM de clientes con estado inicial "Presentado", la identidad del cliente que refiere y "Cargado por" (mail de la sesión). No otorga ni canjea créditos: eso lo calcula el programa desde las filas. "Canjear crédito" sigue deshabilitado a propósito.

## Dónde está
- Formulario: ficha del cliente (cliente fijo, solo si está ACTIVO) y `/referidos` (se elige un cliente activo). `components/clientes/RegistrarReferido.tsx`.
- API: `POST /api/referidos` (`app/api/referidos/route.ts`). Solo socio y csm con sesión de Google; sin acceso por máquina. Mismo origen obligatorio, JSON, tope de 8 KB. Declarada en `lib/auth/rutas.ts` y `docs/ACCESO-Y-ROLES.md`.
- Validación y decisión (puras): `lib/clientes/altaReferido.ts`. Escritor: `lib/clientes/escribirReferido.ts`. Tests: `scripts/test-alta-referido.mjs` (25), solo con planilla simulada.

## Contrato de escritura (según `docs/SPEC-PESTANAS-REFERIDOS-CREDITOS.md`)
- Escribe A:L y N:P de la primera fila libre. NO toca M (fecha de liberación) ni Q (nombre del referidor): ya tienen fórmula.
- Valores: ID R001… correlativo; fecha del pedido como número de serie (la celda tiene formato de fecha); estado `Presentado`; fechas de llamada y de primer pago vacías; `Cargado por` = mail de la sesión. Escritura `RAW` (un "+54…" queda como texto) y los textos que empiezan con `=`, `+`, `-` o `@` se neutralizan.
- Lectura fresca justo antes de escribir (Referidos y Agencia/Consultora) y un candado que serializa las altas.

## Idempotencia y rechazos
- Mismo cliente + mismo teléfono (últimos 8 dígitos): no se crea otra fila, devuelve el ID que ya existe.
- Doble clic o doble envío: botón bloqueado + clave por envío + candado: una sola fila.
- Rechazados con motivo claro: el teléfono ya lo presentó otro cliente; la persona ya es cliente (teléfono o mail); cliente que refiere inexistente o no activo.
- Avisos (no bloquean): más de 3 nombres en el mismo pedido (supuesto de las reglas); fecha anterior al 1/10/2026 (no genera crédito).

## Modo de revisión y bloqueo de la escritura real (importante)
- Por defecto el servidor NO escribe: valida, decide y responde "Modo de revisión: no se guardó nada… se habría cargado como R001". En producción también.
- **La bandera `CRM_ESCRITURA_REFERIDOS=real` sola NO alcanza.** Escribir de verdad exige además coordinación atómica DURABLE entre instancias. Hoy el proyecto no la tiene (ver "Coordinación"), así que en Vercel/producción la API responde `escritura_bloqueada` (503) ANTES de leer o escribir, aunque la bandera esté puesta. Solo en desarrollo local (un único proceso, fuera de Vercel) la bandera habilita la escritura. Nadie definió la bandera hoy y esta sesión no la cargó.

## Coordinación entre instancias: RESERVAS durables en Postgres (implementado y probado solo con mocks; sin base, sin migración ejecutada)
**Por qué cambió el diseño:** un lock de Postgres no protege al Sheet. Si la conexión a la base se cae mientras la escritura HTTP al Sheet sigue en vuelo, el lock se libera y otra instancia puede elegir la misma primera fila libre. Ahora el lock no es lo que protege la fila: la protege una RESERVA ya commiteada.

**Protocolo (`lib/clientes/escribirReferido.ts` + `lib/clientes/coordinadorPostgres.ts`):**
1. Lectura fresca del Sheet: decide (duplicado, ya cliente…) y da el piso: primera fila libre y mayor ID R### existentes.
2. **Reserva y COMMIT en Postgres ANTES de tocar el Sheet:** en una transacción corta (con `pg_advisory_xact_lock` solo para serializar la asignación) se elige `fila = máx(piso del Sheet, mayor fila reservada + 1)` e `ID = máx(piso, mayor ID reservado + 1)` y se guarda con estado `pendiente`. Después se suelta la conexión: la escritura al Sheet no ocurre dentro de ninguna transacción.
3. Se comprueba que esa fila siga vacía en el Sheet (si tiene otro dato, se descarta la reserva y no se escribe) y se escribe A:L y N:P en ESA fila (M y Q son fórmulas: no se tocan).
4. Se marca la reserva `confirmada`.

**Qué pasa ante un corte:**
- Caída de la base o del proceso durante la escritura al Sheet: la reserva ya estaba commiteada; otra instancia no puede elegir esa fila ni ese ID (probado con mocks).
- Timeout o corte de la escritura (puede haber llegado o no): NO se declara guardado. La API responde `pendiente_confirmacion` (HTTP 202), la reserva queda `pendiente` y el reintento con la misma clave y contenido recibe LA MISMA reserva: escribe en la misma fila, o si el Sheet ya la tiene, la reconoce sin reescribir. Nunca recalcula la fila libre.
- La escritura salió bien pero falló la confirmación en la base: se responde guardado con un aviso, la reserva queda pendiente y un reintento la confirma sin duplicar.
- 403 al escribir: se libera la reserva (fila, ID y teléfono) porque no se escribió nada.
- Fila reservada ocupada por una edición manual: la reserva se descarta (su fila e ID no se reusan) y el reintento toma una fila posterior.

**Exclusividad por persona y por clave:**
- Una sola reserva viva por teléfono canónico (HMAC de los últimos 8 dígitos). Dos claves o dos actores con el mismo teléfono y el mismo referidor no reservan dos filas: devuelve la reserva existente (si está sin confirmar, `pendiente_confirmacion` apuntando a su ID; su contenido no se guarda, así que se completa reintentando el envío original). Con otro referidor: rechazo explícito `telefono_reservado_por_otro`.
- Misma clave, mismo actor y otro contenido: `clave_reutilizada` (409), sin tocar nada. Dos actores con la misma clave no se mezclan.
- Índices únicos parciales y `fila` única en la migración son la red de seguridad.

**Privacidad:** la tabla guarda solo HMAC-SHA256 del teléfono (canónico), del actor, de la clave y del contenido, el ID del cliente que refiere (Z012), el estado y el resultado (ID, fila, mensaje). Ni nombres, ni teléfonos, ni mails, ni estudios. La llave es `REFERIDOS_HMAC_SECRET` (variable propia, mínimo 32 caracteres); **sin ella no hay coordinador** (no hay llave pública por defecto). Rotarla invalida las huellas viejas: no rotarla sin migrar los hashes.

**Falla cerrado:** sin `DATABASE_URL` apropiada (esquema `postgres://`/`postgresql://`, con host y base, y no local en Vercel/producción) o sin `REFERIDOS_HMAC_SECRET`, no hay coordinador: la escritura real queda bloqueada (`escritura_bloqueada`) y se conserva la simulación. Si la base falla al reservar, no se escribe nada en el Sheet.

**Pruebas (`scripts/test-coordinador-postgres.mjs`, 20):** base falsa en memoria + planilla falsa que detecta cualquier pisada. Cubren: la reserva está commiteada y sin transacción abierta al escribir; 10 altas concurrentes desde 3 instancias sin pisarse; conexión perdida durante una escritura lenta con una segunda instancia; reintentos antes y después del corte (misma fila, sin recalcular, sin doble escritura); reintento con lectura atrasada del Sheet; claves distintas con el mismo teléfono; mismo teléfono con otro referidor; misma clave con datos distintos; fila ocupada a mano; 403; base caída; piso desde el Sheet; privacidad; llave y entorno; coincidencia del SQL con el adapter.
**Límites del mock — no se afirma verificación real:** no hay Postgres local ni provisionado. El mock no prueba locks reales, el comportamiento del pooler, los timeouts del servidor, SSL, la red ni Google Sheets reales. Que dos conexiones reales se serialicen con `pg_advisory_xact_lock` y que los índices únicos parciales se comporten como se espera hay que verificarlo contra una base real.

**Límites que no se pueden eliminar:**
- Coordina las altas hechas por esta app; NO controla ediciones manuales en el Sheet. Entre la comprobación de fila vacía y la escritura no hay atomicidad posible con Sheets (no tiene compare-and-set); solo una edición manual simultánea en esa fila podría aprovechar esa ventana.
- Una reserva `pendiente` que nadie reintenta deja un hueco en la planilla (una fila vacía entre dos filas con datos) y mantiene reservado ese teléfono hasta limpiarla a mano (ver la consulta en la migración).
- Una reserva `pendiente` de otra alta de la misma persona no se puede completar desde otro envío distinto (no guardamos contactos); hay que reintentar el original.

### Requisitos pendientes (no se hizo nada de esto)
1. Elegir y provisionar una base Postgres alcanzable desde Vercel (decisión y costo de RESPONSABLE_HUB/Codex; no se eligió proveedor). Con pooler, las transacciones cortas funcionan en modo transacción.
2. Cargar en Production `DATABASE_URL` y `REFERIDOS_HMAC_SECRET` (aleatoria, ≥ 32 caracteres, distinta de `AUTH_SECRET`). Sin ambas todo sigue bloqueado.
3. Ejecutar a mano `lib/clientes/migraciones/001_referidos_alta.sql` (crea `referidos_reservas`).
4. Prueba real con la base provisionada: concurrencia entre dos instancias, corte de la conexión a mitad de una alta, reintentos, y UN alta real aprobada por RESPONSABLE_HUB. Recién ahí se puede decir que está operativo.
5. Activar `CRM_ESCRITURA_REFERIDOS=real` solo después, y confirmar que la cuenta del dashboard es editora del Sheet.

## Idempotencia (atada a actor y contenido)
- Sin reservas durables (simulación o escritura local de un proceso): memoria por (actor + clave) con la huella canónica del contenido; clave con otros datos = 409; sin actor identificado no se hace nada.
- Con reservas durables: la idempotencia es la propia reserva (clave y huella con HMAC, sobreviven a reinicios y a otras instancias), más la deduplicación del Sheet (mismo cliente + mismo teléfono) y la exclusividad por teléfono.

## Permisos: lo verificado y lo que falta
- Usa la misma cuenta de servicio y las mismas variables que ya usa el dashboard; no se cambió ninguna credencial ni acceso. Solo cambia el scope pedido en este escritor (planillas, no solo lectura).
- **No se pudo comprobar que esa cuenta sea EDITORA del Sheet sin escribir de verdad** (una llamada vacía devolvió un error de validación, no de permisos). Si no lo es, la primera escritura real responde 403 y el formulario dice "La cuenta del dashboard no tiene permiso de edición… No se guardó nada". Qué hacer entonces: compartir el Sheet con esa cuenta como editora (decisión de RESPONSABLE_HUB).

## Evidencia
- Tests: coordinador-postgres 20/20 (base y planilla falsas; límites arriba); alta-referido 34/34 (incluye dos actores con la misma clave, misma clave con datos distintos, producción sin lock y coordinador simulado, todo sin red); rutas 289/289; clientes 52/52; pantallas 95/95; créditos 115/115; `tsc` y eslint limpios en lo tocado.
- En localhost:3101 (dev, modo de revisión): el formulario abre en `/referidos` con 78 clientes activos en el selector, 8 campos y controles de 44 px a 390 px sin desborde. Enviar vacío muestra los 5 errores por campo (422). Un envío válido con datos de prueba, enviado dos veces seguidas, respondió "Modo de revisión… se habría cargado como R001" y no escribió nada. Después, una lectura real confirmó que Referidos sigue con 0 filas.
- No se creó ninguna persona ni registro en la planilla real. Sin deploy, env ni OAuth.
- No hay captura: el panel del navegador estaba oculto y no compone imágenes; las medidas salen del DOM.

## Limitaciones
- Sin edición ni baja de filas, sin cambio de estado (Asistió, Cerró…) desde la UI: falta la siguiente etapa. Las ediciones se hacen a mano en la planilla.
- Entre instancias no hay coordinación durable: por eso la escritura real está bloqueada en Vercel/producción (ver arriba).
- "De otro estudio" sigue siendo un control manual (no hay dato del estudio del cliente que refiere).
- No existe un módulo de afiliados externos: hoy "referidor" es un cliente activo del CRM.

## Siguientes pasos de afiliados
1. **Pregunta pendiente para RESPONSABLE_HUB:** ¿qué recompensa recibe un afiliado externo (alguien que no es cliente)? Hoy el programa solo da meses de servicio a clientes activos, canjeables contra su renovación; un afiliado externo no tiene renovación. Sin esa respuesta no se diseña ni se paga nada.
2. Decidir si afiliado = otra "línea" en el CRM (ID propio, datos de contacto y de pago) o una pestaña aparte.
3. Decidir cómo se coordina la escritura entre instancias (almacén con lock atómico o base transaccional), confirmar el permiso de edición del Sheet y recién entonces activar `CRM_ESCRITURA_REFERIDOS=real`, probando con UN alta real aprobada por RESPONSABLE_HUB.
4. Siguiente etapa del flujo: cambiar el estado (Asistió, Cerró, No cerró), cargar "ID cliente nuevo" y fecha del primer pago, y "Canjear crédito" con su propio contrato de escritura en la pestaña Créditos.
