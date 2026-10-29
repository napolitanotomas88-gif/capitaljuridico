> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Edición en el Despacho: la pantalla y sus acciones (bloque B)

Pantalla `/edicion` del Despacho para las etapas Grabación (e01–e05) y Edición (f01–f06). Reemplaza la lista "Sistema de Edición" de ClickUp, que queda solo de consulta. Pedido de RESPONSABLE_HUB del 24/10/2026; diseño en `docs/RELEVAMIENTO-EDICION-CJ.md`. El índice general está en `docs/BOT-EDICION-CJ.md`.

Estado: hecho en la copia `$APP_DIR`, **sin publicar** (sin commit ni deploy). Modo prueba por defecto (`EDICION_MODO` distinto de `real`).

## Quién entra y qué hace

- **Entrar:** la sección nueva `edicion` (`/edicion` y `/api/edicion/*`). La ven los socios y quien la tenga marcada en Configuración.
  - EDITOR entra con una fila de tipo "acceso" con **solo [edicion]**. No tiene Clientes, así que la pantalla nunca le arma links a `/clientes` y en Edición no aparece ningún cobro.
- **Adentro**, el rol sale de la sesión (nunca del pedido; `lib/edicion/permisos.ts`):

| Rol | Variable (mails exactos, separados por coma) | Qué hace |
|---|---|---|
| COORDINACION | `EDICION_REVISOR_AYLU` | Revisa crudos (e04), deja notas (f03), manda al cliente (f04), carga los pedidos del cliente (f05) y el OK (f06), la ficha de marca (e05), confirma vínculos, marca los pasos del seguimiento |
| RESPONSABLE_HUB | `EDICION_REVISOR_TOMAS` (si falta, `KICKOFF_REVISOR_TOMI`) | Lo de COORDINACION, más: autorizar la 3.ª ronda del cliente (P6), decidir el día 9, reabrir, el bloqueo del tope de rondas |
| EDITOR | `EDICION_EDITOR_RENE` | Su cola, «listo» (con el link al editado si ya lo tiene), «corregido» (con todas las notas tildadas), tildar notas, aceptar el editado que propone el bot y avisar un problema (bloqueo «otro» con motivo, que le llega a COORDINACION) |
| Solo lectura | cualquier otra persona con la sección | Ve el tablero. Los socios ven además las grabaciones pendientes |

- En producción, sin la variable o con un mail en dos listas, el rol es "solo lectura": falla cerrado.
- Fuera de producción, si la variable no está, vale el nombre o el apellido como palabra entera: aylén o cuenca, RESPONSABLE_HUB, EDITOR.
- El usuario de prueba de desarrollo (`CRM_DEV_ROL`) nunca escribe: con la `DATABASE_URL` de `.env.local` sería la base real.
- A quien entra como "solo lectura" la pantalla le dice con qué nombre entró y qué variable falta, sin su mail.

## Pantallas

| Ruta | Qué muestra | Quién |
|---|---|---|
| `/edicion` | **Mi cola** (EDITOR: para editar y correcciones, sin las que esperan a RESPONSABLE_HUB; correcciones primero, después prioridad y lo más viejo. COORDINACION y RESPONSABLE_HUB: crudos a revisar, editados y corregidos, regrabaciones por pedir, links por mandar y bloqueos; RESPONSABLE_HUB, además, las 3.as rondas arriba), agrupada por cliente con el botón de lote («Terminé los N para editar», «Sirven los N»). **Por estado**: columnas en escritorio y lista agrupada en el celular, filtros en la URL (`?vista=estado&estado=&cliente=`) | Todos (el lector, solo "Por estado") |
| `/edicion/cliente/[id]` | Por tanda del guion: cada guion con su estado en el doc y el del video, la cobertura de e03 (frases x de y, lo que falta, lo dudoso y la mejor toma) y el check de COORDINACION (sirve, regrabar con motivo, pausa con devolución; «Sirven los N» en lote). «Guiones enviados» POR TANDA (arranca el seguimiento e01; se ofrece si a la tanda le falta algún video o tiene videos esperando fuera de un ciclo: el ciclo abierto de otra tanda no la tapa). El texto de regrabación para copiar con su «enviado» y el detalle que escribió COORDINACION. **El cierre de cada tanda** (revisión 24/10): «Están bien los N: al cliente» en lote, UN link final con todos los videos de la tanda que faltan mandar (con su «Enviado») y «El cliente dio el OK a los N» con una sola cita. Crudos y editados con su asignación (que se puede cambiar), las subidas y la ficha de marca | Todos; las acciones, COORDINACION y RESPONSABLE_HUB |
| `/edicion/video/[id]` | Gancho y guion; los botones de `accionesPara(rol, …)`; el texto para el cliente (regrabación o link final) con «enviado» y la hora; el pedido del cliente (f05) con la propuesta para tildar y el cartel interno de la 3.ª ronda (EDITOR no recibe ningún pedido: P6); las notas por corrección («Corrección N» es la cuenta total; COORDINACION escribe, EDITOR tilda; segundo como 17, 1:05 o 1,05 desde el teclado numérico); «Pedir corrección» también con el video ya en el cliente (un error de COORDINACION no gasta una ronda del cliente); a EDITOR con notas sin tildar, «Qué sigue» le explica que las tilde; el editado y lo que propone el bot («Es este: vincular y marcar listo»); crudos; paleta; el OK del cliente con su cita; el historial con nombres | Todos; cada uno sus botones |
| `/edicion/pendientes` | Grabaciones pendientes (e01): por cliente, el escalón, los días hábiles, los videos que espera y el responsable; el texto para copiar (editable, con la fecha propuesta) y «Hecho» con nota; las guías internas de los días 2 y 4; en el día 9, «Pausar» o «Seguir con recordatorios» (solo RESPONSABLE_HUB); los pasos frenados por crudos sin ubicar. El contador de la pestaña cuenta solo los pasos SIN hacer; el día 0 de un ciclo que abrió un envío con constancia aparece ya hecho | COORDINACION, RESPONSABLE_HUB y los socios (lectura) |
| `/edicion/vinculos` | Carpetas «a confirmar» con sus candidatos y puntaje: cada confirmación se pregunta antes (o se escribe el id del CRM a mano). Debajo, «Ya vinculadas» (las del bot primero, marcadas para revisar) con «Corregir el cliente»: un vínculo equivocado se arregla sin tocar la base | COORDINACION y RESPONSABLE_HUB |
| `/edicion/avisos` | Avisos de Discord en modo prueba (con el texto que habrían llevado), dudosos y con error | COORDINACION y RESPONSABLE_HUB |

Arriba de todo: "Último vigía hace X" (verde con menos de 30 minutos, latón con menos de 2 horas, bordó desde 2 horas dentro del horario del vigía) y el cartel de **modo prueba** si `EDICION_MODO` no es `real`.

**Diseño:** los tokens de `cj.css` (marfil, blanco cálido, negro, latón mate solo para etiquetas, foco y acentos, **bordó solo para alertas**: bloqueos, trabados y errores), sin sombras ni dorado brillante. Todo funciona en el celular (una columna, sin scroll horizontal, áreas de toque de 44 px, campos de 16 px para que iOS no haga zoom). Foco visible y mensajes con `aria-live`. Estilos en `app/(shell)/edicion/edicion.css` (prefijo `ed-`).

**Trabados en la pantalla:** los umbrales de `config.ts` (`UMBRALES_TRABADO`), con las horas contadas **solo en días hábiles** (un fin de semana no hace parecer atrasado a EDITOR) y los "días hábiles" después del día en que entró al estado.

**Privacidad:** ninguna vista lleva mails, teléfonos ni montos (`lib/edicion/vista.ts` lo decide; los tests lo controlan). El historial dice el nombre de quien hizo cada cosa, nunca `actor.email`; si en un campo de nombre quedó un mail por error, se muestra "(equipo)". El guion sí puede traer el WhatsApp del estudio (lo lleva el CTA).

## API

### `POST /api/edicion` (`maxDuration` 30)

Acciones:

| `accion` | Qué hace | Quién |
|---|---|---|
| `mover` | Cambio de estado (`transicion`, con `motivo`, `nota`, `cita` o `editado_url` según pida) | Según `TRANSICIONES` de `estados.ts` |
| `mover_lote` | `sirve`, `listo`, `para_cliente` u `ok_cliente` (este con UNA `cita` para todos) de hasta 30 videos: un resultado por video | COORDINACION y RESPONSABLE_HUB (`sirve`, `para_cliente`, `ok_cliente`); EDITOR, COORDINACION y RESPONSABLE_HUB (`listo`) |
| `vincular_archivo` | Vincula o desvincula un crudo o editado | COORDINACION y RESPONSABLE_HUB |
| `aceptar_editado` | El editado que propuso el bot: en Para editar, vincula y marca listo; en Corrección, solo vincula | EDITOR, COORDINACION y RESPONSABLE_HUB |
| `nota_crear`, `nota_editar`, `nota_borrar` | Notas de corrección (solo se editan o borran mientras no se mandaron) | COORDINACION y RESPONSABLE_HUB |
| `nota_tildar` | Tilde de una nota enviada (con el video en corrección) | EDITOR, COORDINACION y RESPONSABLE_HUB |
| `envio_registrado` | Constancia de lo que se copió al grupo Contenido (`regrabar`: vuelven a Esperando crudos; `link_final`) | COORDINACION y RESPONSABLE_HUB |
| `prioridad` | Urgente, alta o normal | COORDINACION y RESPONSABLE_HUB |
| `bloqueo` | Poner o sacar un bloqueo con motivo. EDITOR solo «otro» (le avisa a COORDINACION); el del tope de rondas, solo RESPONSABLE_HUB | Ver la columna anterior |
| `guiones_enviados` | Arranca el seguimiento e01 de la tanda del guion | COORDINACION y RESPONSABLE_HUB |
| `paso_hecho` | Paso del seguimiento hecho, con nota y el texto que se mandó | COORDINACION y RESPONSABLE_HUB |
| `paso_decision` | Día 9: pausar o seguir | RESPONSABLE_HUB |
| `pedido_confirmar`, `pedido_descartar` | f05: las notas elegidas del pedido del cliente (P6 lo resuelve el repositorio en una sola sentencia) | COORDINACION y RESPONSABLE_HUB |
| `ronda_autorizar` | La 3.ª ronda del cliente | RESPONSABLE_HUB |
| `marca_guardar` | Ficha de marca (la valida `marca.ts` del bloque C) | COORDINACION y RESPONSABLE_HUB |
| `vinculo_confirmar` | Carpeta ↔ cliente | COORDINACION y RESPONSABLE_HUB |

**La barrera** (`lib/edicion/acciones.ts` → `atenderPost`, mismo orden que el kickoff):
1. sesión de Google con la sección Edición (401 o 403);
2. mismo origen exacto (403);
3. `application/json` (415);
4. cuerpo de hasta 8.000 caracteres (413);
5. JSON válido (400);
6. la sesión (401) y la base configurada (503).

**La decisión** (`atenderAccion`):
- validación estricta (`pedido.ts`: un campo de más es 422);
- el usuario de prueba devuelve 403 y el lector, 403 `solo_lectura`;
- los cambios de estado pasan por `puede()` antes del repositorio, que vuelve a validar en la misma sentencia;
- cada escritura lleva la `version` que vio la persona.

**Respuestas:** 200 `{ ok, mensaje, version }` · 403 · 404 · 409 `conflicto` (con `actual: { version, estado }`) o `no_permitido` (con el motivo) · 422 · 503.

**Modo prueba:** con `EDICION_MODO` distinto de `real`, o con `?dry=1`, valida, lee lo que haga falta y responde `{ ok: true, dry: true, habria }` sin escribir.

**Avisos:** los eventos y los `AvisoMotor` van a `avisarEventos` (bloque C) en `after()`. Si fallan, la acción ya quedó guardada igual.

### `POST /api/edicion/pedido` (`maxDuration` 120)

- Recibe `{ video_id, texto, notas? }`: el mensaje del cliente, hasta 4.000 caracteres.
- Sin `notas`, `proponerNotas` (bloque C) lo separa con Claude. Las citas tienen que ser textuales y la respuesta no tiene campos null.
- Con `notas` (cargadas a mano, hasta 30) no se llama a Claude. Sirve cuando Claude no está (modo prueba, sin key) o no entendió el pedido.
- El pedido queda `propuesto`; las notas recién pasan a EDITOR cuando COORDINACION confirma cuáles van.
- Solo COORDINACION y RESPONSABLE_HUB, con el video «Con el cliente». En modo prueba no guarda.

## Archivos

- `lib/edicion/permisos.ts`: roles de edición, pestañas por rol y permisos que no son de estado.
- `lib/edicion/pedido.ts`: validación estricta de lo que manda el navegador, límites y tiempos mm:ss.
- `lib/edicion/vista.ts`: lo que se muestra (tablero, cliente, video, pendientes, vínculos, avisos, vigía).
- `lib/edicion/etiquetas.ts`: etiquetas livianas para los componentes del navegador.
- `lib/edicion/acciones.ts`: la barrera HTTP y la decisión, con dependencias inyectables.
- `lib/edicion/demo.ts`: datos ficticios para `?demo=1` y los tests.
- `app/(shell)/edicion/`: `page.tsx`, `cliente/[id]/page.tsx`, `video/[id]/page.tsx`, `pendientes/page.tsx`, `vinculos/page.tsx`, `avisos/page.tsx`, `loading.tsx`, `edicion.css` y `_componentes/`.
- `app/api/edicion/route.ts` y `app/api/edicion/pedido/route.ts`: solo arman las dependencias reales.

## Cómo verla en local sin base

Con `npm run dev`, entrar a `http://127.0.0.1:<puerto>/edicion?demo=1`. Hay datos de ejemplo de cinco clientes ficticios (E101 a E105) con videos en todos los estados, una corrección con notas, una 3.ª ronda esperando a RESPONSABLE_HUB, un editado propuesto, un posible duplicado de ClickUp y pasos del seguimiento. «Probar como» cambia el rol (COORDINACION, EDITOR, RESPONSABLE_HUB, solo lectura). Los botones no guardan nada. En producción `?demo=1` no hace nada.

Ojo: aunque el ejemplo no toca la base, el layout del shell lee la planilla de Accesos (Google) en cada carga, como en todo el Despacho. Con el usuario de prueba (`CRM_DEV_ROL=socio`) se entra sin login.

## Tests

De a un archivo: `node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/<archivo>`.

| Archivo | Qué controla |
|---|---|
| `test-edicion-vista.mjs` | Sin mails ni montos en ninguna vista, EDITOR sin links a Clientes y sin notas sin mandar, el estado del cliente, el orden de la cola de EDITOR y de RESPONSABLE_HUB, filtros, horas y días hábiles, trabados, el vigía, la cobertura, los roles y la validación estricta |
| `test-edicion-acciones.mjs` | La barrera completa, la matriz rol × acción sacada de `TRANSICIONES`, el modo prueba que no escribe, el 409 por versión, el usuario de prueba, el lote con resultados parciales, la 3.ª ronda de COORDINACION frente a la de RESPONSABLE_HUB, los bloqueos, aceptar el editado, la propuesta de notas y los avisos en `after()` que no rompen |
| `test-rutas.mjs`, `test-accesos.mjs`, `test-nav.mjs` | Las cinco reglas nuevas, el matcher, el cron, la documentación, la sección asignable (EDITOR con `[edicion]` entra a `/edicion` y no a Clientes), la etiqueta y el ícono |

## Archivos compartidos que se tocaron

Con respaldo previo en el scratchpad (`respaldo-edicion/`). El parche está en `docs/edicion/PARCHE-COMPARTIDOS.diff`, para aplicarlo sin pisar lo de otras sesiones:
- `lib/auth/roles.ts`: la sección `edicion`, después de `guiones`, con su ruta;
- `lib/auth/rutas.ts`: `/edicion/*` y `/api/edicion/*` (Google con la sección), y las tres del bot (`propio`);
- `proxy.ts`: las tres rutas del bot fuera del proxy;
- `components/shell/secciones.ts` (etiqueta "Edición" y lugar en el menú) e `iconos.tsx` (ícono de película);
- `docs/ACCESO-Y-ROLES.md`;
- `vercel.json`: el cron `/api/bot/grabacion/diario` a las 10:00 UTC (7:00 de Argentina);
- los tests `test-rutas.mjs`, `test-accesos.mjs` y `test-nav.mjs` (bloques nuevos al final).
