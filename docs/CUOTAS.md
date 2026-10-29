> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Cuotas (CRM de ventas) — en el dashboard

Portado del CRM original (ZIP `<ID_PRIVADO_CONFIGURADO>`, docs originales: `docs/CUOTAS.md` del ZIP). Ruta: **`/cuotas`**, sección "Cobro de cuotas" de la barra de la izquierda (desde el 10/10/2026; `/ventas/cuotas` redirige). Ya no hay botón
"Cuotas" dentro del CRM de ventas; queda solo el atajo "Crear plan de cuotas" al cerrar una venta.

- **Qué es:** planes de pago de **ventas nuevas** (lo que queda pendiente al cerrar) y, desde el 10/10/2026, también renovaciones y cobros de clientes como planes de **Administración**. Columnas Avisar / Cobrar hoy / Vencidas, pagos parciales, coordinar fecha,
  abandono y reactivación, historial y anulación de pagos. Los cambios del 8/10 están incluidos (botón "Avisado", fecha coordinada como fecha vigente, WhatsApp sin teléfono,
  sin "Registrar pago" en Avisar).
- **Quién:** socio = "admin" del CRM (todos los planes y Administración); closer = solo los planes de su pestaña (`lib/crm/auth.ts`); quien tiene Cobro de cuotas en Configuración **sin Ventas** (y sin pestaña) ve y gestiona solo los planes de **Administración** (decisión de RESPONSABLE_HUB, 10/10/2026).
- **Dónde viven los datos:** base **Neon Postgres** propia (`CUOTAS_DATABASE_URL` o `DATABASE_URL`), tabla `cj_cuotas_planes`. No lee ni escribe Google Sheets.
  Sin base, la pantalla dice "conexión pendiente" y el resto del CRM sigue igual.
- **Renovaciones y cobros de clientes que ya están adentro:** desde el 10/10/2026 también se cargan acá, como planes de **Administración** (Backend se retiró;
  ver "Carga desde Backend"). `/backend` redirige a `/clientes?renovacion=1`.
- **Código:** `lib/crm/cuotas/{modelo,db,acciones}.ts`, `components/crm/cuotas/TableroCuotas.tsx`, `app/(shell)/cuotas/*` (`/ventas/cuotas` solo redirige).
  Pruebas: `scripts/crm-tests` (`lib__cuotas__modelo.test.ts`, `lib__cuotas__acciones.test.ts`; `cd scripts/crm-tests && npx vitest run`).

## Arranque de cero (10/10/2026)
Pedido de RESPONSABLE_HUB: Cuotas se usa desde cero y **todo se carga a mano**; no se importa nada de ningún lado. Los 30 planes que había (29 importados el 8/10 de la
hoja "Cuotas a Cobrar" + 1 creado a mano) se sacaron de `cj_cuotas_planes` y quedaron guardados, recuperables, en la tabla `cj_cuotas_planes_archivo` de la misma
base y en `$APP_DIR`. El script de importación y su lista se movieron a `$APP_DIR` (fuera
del proyecto) para que nada vuelva a cargarlos solo.

## Pagado, concepto y "Copiar plan" (10/10/2026, deploy `<ID_PRIVADO_CONFIGURADO>`)
- **Fila "Pagado"**: el formulario siempre arranca con una fila "Pagado" (monto + fecha de pago, sin vencimiento) para anotar lo que el cliente **ya pagó**. Se guarda como una cuota `inicial: true` con un pago por el total (id del pago = id de la cuota), no se numera ni aparece en las columnas de cobro. Vacía o en 0 no se guarda; la fecha no puede ser futura; va una sola vez y primera. Debajo, "Cuota 1, 2, 3…" con vencimiento.
- **Concepto por cuota**: Reserva / Cuota / Completa pago (`concepto` en cada cuota; por defecto Reserva en Pagado y Cuota en el resto). Se ve en la tarjeta, en el detalle y en el texto copiado. El selector del plan (venta/renovación) ahora se llama "Tipo de plan".
- **Copiar plan**: botón en el formulario (encima de "Crear plan de pago", copia lo cargado aunque no esté guardado), en el detalle del plan (al lado de "Editar plan") y en cada fila del Historial. Copia todo (cliente, WhatsApp, responsable, tipo, pagado, cuotas con vencimiento/concepto/pagos/fecha coordinada, totales) **menos las notas** — `textoPlan()` en `lib/crm/cuotas/modelo.ts`.
- Planes cargados antes del cambio: al editarlos aparece la fila Pagado vacía; si no se completa, el plan queda igual.

## Fila "Pagado": solo se corrige con Editar plan (auditoría del 10/10/2026)
- Lo ya pagado **no se cobra, no se anula, no se coordina ni se gestiona**: `modificarPlan` rechaza pago/promesa/gestión sobre la cuota `inicial` y la
  anulación de su pago inicial (id = id de la cuota) ("Lo ya pagado se corrige con Editar plan."); el detalle no muestra "Registrar pago" en esa fila y junto
  al pago inicial dice "Se corrige con Editar plan". Antes, anular su pago la convertía en una "Cuota 0 de N" vencida que sumaba en las columnas y en los saldos.
- **Pagos de más sobre la fila Pagado** (datos de antes del 10/10, cuando el detalle dejaba anular y registrar pagos ahí): esos pagos (id distinto del de la
  cuota) **sí se anulan** desde el detalle ("Anular registro"; el historial dice "Pagado: pago anulado (USD …)"). Es la salida cuando lo cobrado supera el
  importe: hasta anularlo, cualquier guardado del plan se rechaza con "Lo cobrado no puede superar el importe de la fila Pagado. Anulá el pago de más desde el
  detalle del plan."; después se puede editar y bajar el importe. (Antes no había salida: no se podía bajar, ni quitar, ni anular.)
  En un plan **abandonado** el detalle no deja anular (y `modificarPlan` lo rechaza): el error dice "Reactivá el plan, anulá el pago de más desde el detalle y,
  si corresponde, volvé a marcar el abandono." y en el detalle, junto a ese pago, "Para anularlo, reactivá el plan" (solo si la fila quedó cobrada de más).
- Nunca entra en las columnas ni en "Gestiones de hoy", "Saldo pendiente", "Saldo vencido", el saldo del Historial o de Abandonos: `tarea()` devuelve
  `null` y todo suma con `porCobrar()` (0 para la inicial). En "Copiar plan" la línea Pagado y los totales usan lo efectivamente cobrado.
- **Corregir:** cambiar monto o fecha en Editar plan (el historial dice "Pagado corregido: … → …"). **Quitar** una fila cargada por error: vaciarla (o 0)
  y guardar; se puede si su único historial es su propio pago inicial, y queda "Pagado quitado (USD …)". Agregarla después: "Pagado agregado (…)".
- `leerPlan` conserva el estado del pago inicial (si en datos viejos quedó anulado, editar no lo revive) y no deja que lo cobrado supere el importe de la fila.
  Con el pago inicial anulado, corregir el importe o la fecha lo dice en el historial ("Pagado corregido: … → … (el pago sigue anulado: cobrado USD …)",
  "Pagado quitado (…, con el pago anulado)") y en Editar plan "Ya pagado" es lo que de verdad queda cobrado (`cobradoFilaPagado`), con un aviso debajo
  del total (`avisoPagoInicialAnulado`) que cambia según la fila:
  - si lo único que tiene es su pago inicial: "Si el cliente sí pagó, vaciá la fila, guardá y cargala de nuevo" (entra con otro id y un pago nuevo);
  - si además tiene otros pagos o gestiones **no se puede quitar** (`cuotaConHistorial`, la misma regla de `leerPlan`), así que no se aconseja vaciarla:
    con un pago de más vigente dice que ya cuenta en "Ya pagado"; si no queda nada cobrado, que se agregue una cuota por ese importe, se guarde y se
    registre el pago desde el detalle (en un plan abandonado, reactivándolo antes).

## Otros arreglos de la auditoría (10/10/2026)
- **Editar plan guarda contra la versión con la que se abrió**: si otra pantalla cambió el plan mientras tanto, el servidor responde "Este plan cambió en otra
  pantalla" (antes el refresco de cada 60 s actualizaba la versión y se pisaban montos, fechas y cuotas nuevas). El formulario avisa y ofrece "Recargar datos del plan".
  Si el plan desaparece de la lista (el socio lo pasó a otro responsable), el formulario no se vacía ni crea un plan nuevo: avisa y deja copiar.
  La parte del servidor tiene prueba (`lib__cuotas__acciones.test.ts`); la del tablero (mandar la versión del formulario abierto) **se verifica a mano**:
  abrir "Editar plan" del mismo plan en dos pestañas, guardar un cambio en una, esperar el refresco (o volver a la otra pestaña) y guardar en la otra:
  tiene que decir "Este plan cambió en otra pantalla" y mostrar "Recargar datos del plan", sin pisar lo guardado.
- "Saldo vencido" usa la fecha vigente (la coordinada, si hay), igual que la columna Vencidas. Una cuota pagada ya no muestra "pago coordinado" (ni en el detalle ni al copiar).
- "Crear plan de cuotas" desde una venta cerrada propone **Venta inicial** aunque lo abra el socio. Al cerrar ese formulario sin crear, los datos de la venta salen de la URL.
- Formularios: campos de 16 px (sin zoom en el iPhone), fechas con borde y tamaño propios, importes validados en el navegador (sin puntos de miles), "+ Agregar cuota"
  propone el mes siguiente, cerrar con cambios sin guardar pide confirmación, el error del servidor se trae a la vista y el título y la ✕ quedan fijos arriba.
- Cerrar con Esc o "volver" (Android): Chrome no deja frenar dos cierres seguidos sin otro toque en el medio; el segundo cierra el diálogo igual (sin
  preguntar, porque "Cancelar" no serviría) y el tablero se entera por el evento `close` (`onCerradoPorNavegador` en `Dialogo`), así los botones que abren
  otro diálogo siguen andando y los datos de una venta salen de la URL. El padding del diálogo va adentro (no en el `<dialog>`) para que el título fijo se pegue al borde.
  A mano: editar un plan, Esc → Cancelar, Esc otra vez → se cierra; después "+ Nuevo plan de pago" tiene que abrir. En un plan de muchas cuotas, al bajar no se ve contenido por encima del título.
- El aviso de "Plan actualizado · …" usa el plan que devolvió el servidor: si se corrigió el nombre, dice el nuevo.
- Avisos del tablero ("Aviso registrado · …", errores con "Actualizar") abajo y a la vista; el de éxito se va solo a los 5 s. "Copiar plan" muestra el error debajo del botón.

## Revisión final (10/10/2026)
- **Arrastrar para actualizar** (`components/shell/ArrastrarParaActualizar.tsx`, en todo el shell) no actúa con un diálogo abierto ni si el toque empieza
  dentro de uno: cuenta el `<dialog>` nativo abierto de Cuotas (antes solo miraba `[role="dialog"]` y un deslizamiento dentro de "Nuevo plan" o "Editar plan"
  recargaba la página y se perdía lo cargado). A mano, en un celular: abrir "+ Nuevo plan de pago" arriba de todo, cargar algo y deslizar hacia abajo dentro
  del formulario: no tiene que recargar.
- Lectores de pantalla: los avisos de abajo son dos regiones vivas hermanas y siempre montadas (`role="alert"` y `role="status"`, solo en el texto; los
  botones quedan afuera); el error dentro del diálogo ya no lleva `role="alert"` (recibe el foco y con eso se lee una vez); cada "Copiar plan" del
  Historial se anuncia "Copiar plan de {cliente}"; sin Ventas no queda el `<nav>` "Secciones del CRM" vacío.
- Foco: "Limpiar filtros" lo deja en el botón de al lado, "Actualizar"; "Recargar datos del plan" lo vuelve a ubicar como al abrir "Editar plan"
  (la versión va en la `vista` del `Dialogo`). En ningún caso va a un campo: en el celular levantaría el teclado.
- Botones: `border-dorado!` en el primario y `justify-between!` en las filas de Abandonos (con dos utilidades de la misma propiedad gana la que Tailwind
  escribe después en el CSS, no la última de la clase).
- Textos: en Abandonos (que no se filtra por fecha) "con esta búsqueda" solo si hay búsqueda; cerrar "Editar plan" con cambios pregunta
  "¿Descartar los cambios sin guardar?" (el plan ya está guardado).

## Carga desde Backend (10/10/2026, excepción al "arranque de cero")
Pedido de RESPONSABLE_HUB: los cobros pendientes de la pestaña `Cobros` (sección Backend, que se retiró) pasaron acá como 9 planes de **Administración**: 14 cuotas, USD 20.446. Z008 y Z009 con concepto "Completa pago"; Z009 y Z010 con su fila "Pagado" (1.400 y 450 el 2/10); Z011 como venta, el resto renovación. Notas y medio de pago de cada fila en las notas del plan; `origen` = `Backend · Cobros A0xx fila N`. Script idempotente (uuid fijo): `$APP_DIR`; respaldo previo de la tabla en `$APP_DIR` (12 planes; el `cuotas-planes-despues-de-backend-…T21-34-02-731Z.json` es posterior, con los 21). Base: 12 → 21 planes, saldo USD 24.786,25 → 45.232,25.
