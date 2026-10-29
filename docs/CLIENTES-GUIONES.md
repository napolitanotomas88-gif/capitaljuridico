> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Clientes y Guiones más usables (8/10/2026)

Pedido de RESPONSABLE_HUB (vía la sesión CONSULTOR), especificación `docs/specs/SPEC-CLIENTES-GUIONES-USABLES.md`.

## Clientes (`/clientes`)
- **Fuera:** "Grabación en oficinas" y "Extra" (lista, tarjetas del celular y ficha). Las funciones `textoGrabacion`/`textoExtraCorto` quedan para las pruebas de referidos.
- **Por defecto, solo clientes actuales** (ACTIVO y PAUSADO; los de onboarding figuran ACTIVO en el CRM). Chip "Todos (también finalizados)".
- **Chips de un toque:** "Por vencer · 30 días" y "· 15 días" (ordenados por fecha), "Prioridad: sin campaña", "Sin respuesta este mes" (solo con Typeform conectado).
- **Bloque "Prioridad: todavía sin campaña lanzada"** arriba de todo: activos que en ClickUp ("Clientes 2026") siguen en nuevo cliente, onboarding,
  esperando tópicos, guionizar, opt. guiones, grabación, edición o creación de campaña, y sin anuncios activos en Meta (cuenta no pausada, con gasto en 7 días y
  anuncios activos, del tablero de `/anuncios`). Se ven los 6 más urgentes y el resto a un toque. **Limitaciones de ClickUp:** el plan no da el tiempo en cada estado
  (se muestra "último movimiento en ClickUp hace X días") y las tareas no tienen responsable asignado (se muestra el closer del CRM).
- **"Cómo le va" (1 a 10)** en la lista, en las tarjetas y en la ficha (con historial): un toque abre los 10 números y una nota opcional. Se guarda en la pestaña
  **`Seguimiento`** del CRM de clientes (Fecha, ID cliente, Puntaje, Fuente manual/typeform, Nota, Cargado por, Mes); la pestaña se crea sola con el primer puntaje.
  Tendencia (↑ ↓ →) frente al último puntaje de un mes anterior. Escritura real con `SEGUIMIENTO_ESCRITURA=real`; sin la variable, modo revisión.
- **Typeform:** se lee la planilla de respuestas de la integración nativa (Typeform → Connect → Google Sheets) si `SHEET_ID_TYPEFORM` está cargada y la planilla
  está compartida con la cuenta de servicio. Cruce por mail, teléfono (últimos 8 dígitos) y nombre (solo si es único); lo demás va a "respuestas sin asignar".
  **Conectado el 8/10/2026** (`SHEET_ID_TYPEFORM` = planilla "Typeform · Satisfacción de clientes (respuestas)", la conectó la sesión CONSULTOR; las respuestas nuevas
  entran por un webhook de Typeform). Columnas: Fecha (AR) · Response ID · Nombre · Apellido · Estudio · Puntaje (0-10) · … · ID cliente (CRM). El puntaje va de 0 a 10
  y se usa tal cual. Cruce, en orden: la columna "ID cliente (CRM)" si se completó a mano · nombre + apellido · primer nombre + primer apellido · estudio · mismo
  apellido (único) con nombre que empieza igual (tipeos como Melisa/CUENTA_QA). Se deduplica por Response ID y se ignoran las filas de prueba. Con las 39 respuestas
  del 2 al 4/9: 31 cruzadas solas; las que no cruzan quedan en "sin asignar" (se resuelven escribiendo el ID en la columna "ID cliente (CRM)").

## Guiones (`/guiones`)
Tabla (tarjetas) por cliente activo, arriba del tracker de grabaciones:
- **Prioridad:** 5 = onboarding o nunca lanzó (guiones desde cero) · **4 = optimización urgente** (9/10/2026: semáforo rojo, "no rinde", ya lanzó y hoy no corre
  nada, o ClickUp en rojo) · 3 = optimización con variables (amarillo, se queman, ClickUp "opt. guiones") · 1 = lanzó y funciona (variaciones para que no se queme).
  Orden: prioridad y después días esperando. Si Meta no responde (caché fría tras un deploy), el estado de ClickUp decide si ya lanzó y si rinde.
- **Fuente real: la carpeta de cada cliente en Drive** (9/10/2026, pedido de RESPONSABLE_HUB: medir con lo que realmente se hizo). `lib/clientes/drive.ts` recorre
  "Clientes" (`<ID_PRIVADO_CONFIGURADO>`, compartida "cualquiera con el enlace"; sin "2 - Ex clientes") carpeta por carpeta, en paralelo, con caché de 30 min:
  **"Guiones - X"** (última modificación y quién) = último guion · **"Crudos - X"** y **"Editados - X"** con videos = se grabó (y cuándo).
  Cruce carpeta ↔ cliente con `crearCruceCarpetas` (apodos "CUENTA_QA"/"Noe"/"CUENTA_QA", apellidos con tipeo, palabras únicas; si una carpeta calza con dos clientes
  actuales gana el que comparte más palabras y el primer nombre, y si empatan no se asigna). Al 9/10: 71 de 79 activos cruzados.
- **Último guion:** el documento de Drive; si no hay, la planilla "Guiones y Videos" (columna D) o una subtarea de ClickUp con fecha de hecho.
- **¿Guion nuevo desde el lanzamiento?** Sí/No según si el documento cambió después del último lanzamiento en Meta. **"Guiones sin grabar":** el documento cambió
  después de la última grabación (filtro propio).
- **Último lanzamiento en Meta:** el más reciente que detecta el tablero de anuncios; si es más viejo que la ventana de Meta, "≈" desde cuándo corre la campaña.
- **Guiones desde el lanzamiento:** entregas posteriores al último lanzamiento. **¿Se grabó?** con filtro "Se grabó / Nunca se grabó".

Código: `lib/seguimiento/{modelo,typeform,hojas,acciones}.ts`, `lib/clientes/{prioridad,produccion}.ts`, `components/clientes/PuntajeRapido.tsx`,
`app/(shell)/clientes/_componentes/{Prioridad,EstadoTypeform}.tsx`, `app/(shell)/clientes/[id]/_componentes/ComoLeVa.tsx`, `app/(shell)/guiones/{page,TablaGuiones}.tsx`.
Pruebas: `scripts/test-seguimiento.mjs` (+ `test-pantallas` y `test-panel-referidos` actualizadas).
