> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot "Capital Jurídico": etapa ÉXITO DEL CLIENTE

Pedido y decisiones de RESPONSABLE_HUB (25/10/2026, con los ajustes del mismo día: detección en los 3 grupos, formulario único `bnvnMvVn`, rondas mensuales que nunca se mezclan, textos de la encuesta aprobados y envío de la encuesta solo con OK). Escrita en una copia aislada, **apagada por defecto** (modo seco): no manda nada hasta que se configuren las variables del checklist.

**Qué hace.** El bot detecta cuándo a un cliente le está yendo bien. Si RESPONSABLE_HUB o CSM dan el OK, le pide un video de testimonio en su grupo General. Cuando llega el video, le agradece con el link de la reunión de Análisis y Proyecciones con OPERADOR_AUTORIZADO (Actis) y avisa a COORDINACION en Discord. Además, cada mes publica la lista de clientes activos para la encuesta de satisfacción, la manda con el OK y manda un recordatorio a quien no respondió.

## Flujo

1. **Detección del éxito.** Hay dos señales.
   - **Mensajes del cliente** en cualquiera de sus 3 grupos: General, Ventas y Contenido. Es un cambio de RESPONSABLE_HUB del 25/10: el cliente puede mostrarse contento en cualquiera de los tres.
     - Primero, un filtro barato y sin red (`pareceResultado`) deja pasar solo los textos que pueden hablar de resultados ("cerré 3 casos", "me entraron muchas consultas", "excelente, no paran de escribirme"). Un "gracias", un "ok" o un "excelente" suelto no pasan. Una palabra de satisfacción sola pasa únicamente si el texto tiene 4 palabras o más, o algún número.
     - Después, Claude decide si el mensaje habla de **resultados** y si son **buenos**. Usa el mismo patrón que `direccionClaude.ts`: Haiku 5.5, esfuerzo bajo, JSON estricto y una cita literal.
     - A Claude no se lo llama si:
       - el cliente tiene un pedido abierto o está en el período de espera;
       - el mismo mensaje ya se evaluó (por ejemplo, porque Whapi reintentó);
       - el cliente ya tuvo 5 evaluaciones en el día.
   - **La encuesta mensual:** un puntaje de 8 o más (escala de 0 a 10) **en la ronda vigente** del cliente (ver "Rondas"). Un puntaje de un mes anterior no cuenta. Como mucho se abren 5 pedidos por la encuesta en un día, así no se llena Verificaciones.
2. **Pedido de permiso en Verificaciones C.J.** Es un mensaje corto:
   ```
   🏆 Éxito de cliente: <cliente>
   Escribió en el grupo Contenido: "<cita breve>"        (o: Encuesta mensual: 9/10 (05/10/2026))

   ¿Le mando el mensaje de testimonio? Respondé citando: OK / NO
   ```
   - Solo cuentan las respuestas que citan el pedido, de alguien de `BOT_ALTA_APROBADORES` (RESPONSABLE_HUB y CSM). Es la misma regla `enLista` del motor, y un test controla que den lo mismo.
   - Si Whapi no devuelve el id del pedido, lo recupera el eco del propio mensaje, igual que en el motor.
   - El motor de altas ignora esas respuestas: el mensaje citado no es de ningún alta, así que no se pisan.
   - No se vuelve a pedir por el mismo cliente mientras:
     - haya un pedido abierto (lo garantiza un índice único en Neon);
     - no hayan pasado **60 días** desde que se mandó el mensaje de testimonio;
     - no hayan pasado **30 días** desde un NO o desde un OK de ensayo. Esto lo decidió esta etapa; se cambia con `ENFRIAMIENTO_NO_MS`.
   - Un pedido sin respuesta vence a los 14 días, y después se puede volver a pedir.
3. **Con el OK**, el bot manda al **grupo General** el texto exacto (abajo) y responde "Listo: le mandé el mensaje de testimonio a X." citando el OK.
   - Si WhatsApp no confirma el envío, el pedido queda como `dudoso` (cuenta como enviado) y avisa en Verificaciones para que lo revisen antes de mandarlo a mano.
   - Con un **NO**, no se manda nada.
4. **El video del testimonio.** Cuenta cualquier video del cliente (video, short o un documento `video/*`) en **cualquiera de sus 3 grupos**, si llega después del mensaje de testimonio y dentro de los **30 días**. Entonces:
   - se guarda en `cj_exito_testimonios`: id del mensaje, id del medio en Whapi, mime, duración, tamaño y grupo;
   - el bot responde en el **General** con el agradecimiento y el link de Calendly. Cita el video si llegó al General;
   - avisa en Discord **#🤝-exito-y-bajas** (`DISCORD_WEBHOOK_CLIENTES`) mencionando a COORDINACION (`DISCORD_ID_GERO_M`; si falta, se usa el id de ggeroo confirmado el 24/10).
   - Solo se reconoce un testimonio por pedido.
   - **WhatsApp no tiene links a un mensaje:** el aviso lleva el link de invitación del General (si el motor lo guardó) y el id del mensaje.
5. **Encuesta mensual** (cron diario a las 10:00 de Argentina, que solo arranca la ronda el día `EXITO_ENCUESTA_DIA`, por defecto el 1):
   - **La lista con OK.** El día 1 el bot arma la lista de clientes **ACTIVOS** de Agencia en el CRM. Quedan afuera los pausados, finalizados, inactivos o bajas y los históricos. La publica en Verificaciones C.J:
     ```
     📋 Encuesta mensual (2026-11): la mando a estos N clientes activos: Ana CUENTA_QA, CUENTA_QA Gómez, …

     Sin grupo General conocido (no les llega): …

     ¿Mando? Respondé citando OK / NO (para dejar afuera a alguien: "OK sin Nombre Apellido")
     ```
   - **Solo con el OK** de un aprobador manda la encuesta al **General** de cada uno.
     - **"OK sin X"** / **"OK menos X, Y"** (también "excepto" o "salvo") deja afuera a esos clientes. Se reconocen por ID del CRM o por nombre, y cada nombre tiene que calzar con un solo cliente de la lista. Si alguno no se encuentra o es ambiguo, el bot no manda nada y pide que respondan de nuevo.
     - **NO:** ese mes no se manda.
     - Hay una pausa de 2 s entre mensaje y mensaje, porque el número no es oficial. Lo que no entre en el tiempo de la función sigue en el próximo cron.
     - Si el cron del día 1 falló, `GET /api/bot/exito?lista=1` publica la lista otro día.
   - **Recordatorio:** a los **3 días**, sin pedir OK de nuevo. Va solo a los clientes de esa ronda aprobada cuya ronda no tiene respuesta vinculada. Sin la planilla del Typeform no se sabe quién respondió, y entonces no se manda.

### Rondas: una respuesta vieja nunca cuenta para la ronda actual

Es un pedido explícito de RESPONSABLE_HUB (`lib/bot/exito/rondas.ts`).

- Cada envío de la encuesta a un cliente es una **ronda**: una fila de `cj_exito_encuestas` con id `<AAAA-MM>:<ID del CRM>`. Guarda:
  - el cliente, la fecha de envío y el id del mensaje;
  - el recordatorio (fecha y estado);
  - la **respuesta vinculada** (Response ID de Typeform), el **puntaje** y cuándo respondió.
- La fecha de envío se fija **antes** de mandar el mensaje.
- Una respuesta cuenta para una ronda solo si su `submitted_at` es **posterior o igual al envío de esa ronda y anterior al envío de la ronda siguiente** del mismo cliente. Si llegó antes del primer envío del bot, no cuenta para ninguna.
- `submitted_at` sale de la columna "Fecha (AR)" de la planilla, con hora: el webhook la escribe así.
- A cada ronda se le vincula una sola respuesta: la primera de su ventana.
- Una respuesta de un mes anterior **no** marca "respondió" en la ronda actual y **no** cuenta como éxito actual.
- Para el éxito se usa **solo** el puntaje de la ronda vigente, que es la última enviada a ese cliente.
- Tests: respuesta de hoy, del mes pasado y de hace dos meses, más los bordes (minutos antes del envío, dos respuestas en la misma ronda).

### Identificar al cliente de cada respuesta

El formulario es **uno solo y fijo**: "Encuesta mensual de satisfacción", id `bnvnMvVn`. Lo renombró RESPONSABLE_HUB; ya no se usa `uphVostn`. **No tiene campos ocultos:** se revisó la definición pública el 25/10, y además el editor nuevo de Typeform no los muestra.

- El cliente se identifica cruzando **Nombre + Apellido + Estudio** de la respuesta con el CRM. Usa el mismo cruce de la cartera (`leerRespuestas` de `lib/seguimiento/typeform.ts`): tolera tildes, mayúsculas y errores de tipeo, y nunca elige entre dos.
- Si el cruce es **dudoso** y la respuesta puede ser de la ronda vigente, el bot pregunta en Verificaciones C.J (como mucho 5 por día):
  ```
  📋 Encuesta: no sé de qué cliente es esta respuesta.
  Ana P. · Estudio · 9/10 · 02/11/2026

  Respondé citando: OK <ID del CRM> (por ejemplo, OK Z001) / NO si no es de un cliente
  ```
  - **"OK Z001"** la asigna (queda en `cj_exito_senales`) y el próximo cron la vincula a su ronda.
  - **NO** la descarta.

### Typeform → planilla: lo que falta (no se creó nada)

El Despacho lee las respuestas de la planilla **"Typeform · Satisfacción de clientes (respuestas)"** (`SHEET_ID_TYPEFORM`). Las filas las agrega el webhook `${AUTH_BASE_URL}/api/typeform` (`~/web-gratis-abogados/api/typeform.js`).

Al 25/10/2026 la planilla tiene **40 filas, todas del formulario viejo** ("Primer testeo de satisfaccion - 02/09/2026"; la última del 8/10) y **ninguna de "Encuesta mensual de satisfacción"**. El webhook `despacho-satisfaccion` se creó sobre `uphVostn` (8/10). Sin el token de Typeform no se pudo leer la lista de webhooks de `bnvnMvVn`. RESPONSABLE_HUB tiene que:

1. Entrar al formulario `bnvnMvVn` → Connect → Webhooks y verificar que esté el webhook a `${AUTH_BASE_URL}/api/typeform`, activo. Si no está, agregarlo con esa misma URL.
2. Mandar una respuesta de prueba y ver que aparezca una fila con "Encuesta mensual de satisfacción" en la columna Formulario. Las filas con "prueba" o "test" en el nombre se ignoran.

Sin esa conexión, el bot no ve respuestas: no vincula rondas, no detecta éxito por la encuesta y no manda recordatorios.

### Cómo se reconocen los grupos de cada cliente

Es el mismo criterio que el reenvío a Guiones (`lib/bot/whapi/guiones.ts`):

1. **Los `chat_id` que guardó el paso `comunidad` del motor.** Están en `cj_altas_pasos.resultado` o `parcial`, en `grupos.general`, `grupos.ventas` y `grupos.contenido`. De ahí salen también el nombre del alta y el ID del CRM (paso `crm`). Es una sola consulta, con 10 minutos de caché por instancia.
2. **Si no están ahí** (clientes de antes del bot), el nombre del grupo por Whapi (`GET /groups/{id}`): "General - X", "Ventas - X" o "Contenido - X".
   - El General de ese cliente se busca por nombre en `GET /groups` (paginado, 1 h de caché).
   - Caché del nombre: 12 h si es de un cliente, 1 h si no, 5 min si Whapi falló.

La **clave** del cliente es el ID del CRM si se conoce; si no, `n:<nombre normalizado>`.

No se procesan nunca:
- lo que escribe una persona del equipo (`BOT_ALTA_EQUIPO_TELEFONOS`, `BOT_ALTA_APROBADORES`, `BOT_ALTA_OPERACIONES`);
- lo que manda el propio bot;
- los grupos del equipo (Ventas C.J. y los `WHAPI_GRUPO_*`);
- lo que llega con más de 48 h de atraso.

**Convive con el reenvío a Guiones.** Los dos procesos leen los mismos mensajes del grupo Contenido. Cada uno tiene su propio dedupe (`cj_guiones_reenvios` y `cj_exito_senales`) y su propio `after()`, así no se pisan ni se duplican. El reenvío a Guiones no cambió.

## Saludo según la hora (ajuste documentado)

El texto de RESPONSABLE_HUB empieza con "Buenas tardes". El bot cambia solo esas dos palabras según la hora de **Argentina** en el momento del envío:

| Hora (AR) | Saludo |
|---|---|
| 5:00 a 12:59 | Buenos días |
| 13:00 a 19:59 | Buenas tardes |
| 20:00 a 4:59 | Buenas noches |

`[CLIENTE]` se reemplaza por el **primer nombre** del cliente. Se saltean títulos como "Dra." y se corrigen las mayúsculas: "ANA CUENTA_QA PÉREZ" queda "Ana". El resto del texto va tal cual.

## Textos

### Mensaje de testimonio (texto exacto de RESPONSABLE_HUB)

```
Buenas tardes [CLIENTE], ¿cómo estás? ¿Todo bien?

Estuvimos viendo que te está yendo muy bien y la idea es que podamos seguir sacándole el máximo provecho a todos estos resultados para no bajarnos del envión en el que estamos.

Por eso, nos gustaría que nos cuentes un poco como arrancaste con nosotros, que venías haciendo antes y que resultados venís teniendo ahora, grabando un breve video de testimonio.

Acá dejamos unos ejemplos: <URL_CONFIGURADA_PRIVADAMENTE>

Además, si podes enviarlo, a modo de agradecimiento, vas a poder tener una reunión de Análisis Estratégico y Proyección del estudio con OPERADOR_AUTORIZADO (Actis), así pueden plantear los próximos pasos para seguir escalando.

¿Te parece?
```

### APROBADO POR RESPONSABLE_HUB (25/10/2026): encuesta y recordatorio, tal cual

`[CLIENTE]` es el primer nombre y el link es el formulario `bnvnMvVn`.

**Encuesta mensual:**
```
Buenas [CLIENTE]!  Como todos los meses, queremos saber cómo te venís sintiendo con Capital Jurídico. Son 3 preguntas y te lleva menos de 3 minutos:
<URL_CONFIGURADA_PRIVADAMENTE>
Tu respuesta nos ayuda a detectar dónde estamos fallando y qué debemos mejorar. Desde ya, muchas gracias!
```

**Recordatorio** (a los 3 días, si no respondió en la ronda vigente):
```
[CLIENTE], te recordamos la encuesta de este mes. Son 3 minutos y nos sirve muchísimo para poder ayudarte de la mejor manera:
<URL_CONFIGURADA_PRIVADAMENTE>
```

### A APROBAR POR RESPONSABLE_HUB

Están en `lib/bot/exito/textos.ts`. Se cambian ahí.

**Agradecimiento cuando llega el video:**
```
¡Muchísimas gracias, Ana! 🙌 Ya nos llegó tu video, de verdad lo valoramos un montón.

Como te contamos, acá podés agendar tu reunión de Análisis Estratégico y Proyección del estudio con OPERADOR_AUTORIZADO (Actis): <URL_CONFIGURADA_PRIVADAMENTE>
```

**Aviso en Discord** (#🤝-exito-y-bajas):
```
@COORDINACION 🎥 **Ana CUENTA_QA** mandó su testimonio (24/10/2026).
Link del grupo General: <URL_CONFIGURADA_PRIVADAMENTE> · mensaje <id>
Ya le respondimos con el link de la reunión de Análisis y Proyecciones.
```

## Modo y capacidades

Siguen el mismo criterio que el motor (`lib/bot/alta/motor/modo.ts`), con un interruptor propio para prender esta etapa aparte del alta.

| Modo (`BOT_EXITO_MODO`) | Qué pasa |
|---|---|
| `seco` (por defecto) | No sale nada ni se escribe nada: ni Claude, ni Whapi (ni siquiera lecturas), ni planillas. El webhook ni siquiera arma la etapa. |
| `ensayo` | Lecturas reales (Claude, Whapi GET, CRM, planilla del Typeform). Lo único que sale es un reporte **"SIMULACIÓN — no se cargó nada"** en Verificaciones: el pedido de OK, el aviso de que llegó un video, la lista de la encuesta y las consultas por respuestas dudosas. Nunca un mensaje a un cliente. Un OK en ensayo queda como `aprobado_simulado`. |
| `real` | Sale solo lo que diga `BOT_EXITO_CAPACIDADES`. |

| Capacidad | Qué deja salir |
|---|---|
| `exito_pedido_ok` | El pedido de OK y el "Listo" en Verificaciones (en ensayo, como reporte SIMULACIÓN). |
| `exito_mensaje_cliente` | El mensaje de testimonio al General (solo real). Sin esta capacidad, un OK queda `aprobado_simulado`. |
| `exito_testimonio` | El agradecimiento con el Calendly en el General y el aviso en Discord (solo real; en ensayo, un reporte SIMULACIÓN). |
| `encuesta_mensual` | La lista para el OK en Verificaciones, la encuesta y el recordatorio en el General de cada activo, y las consultas por respuestas dudosas (solo real; en ensayo, la lista sale como SIMULACIÓN y el OK no manda nada). |

`BOT_EXITO=no` apaga la etapa entera.

## Variables (solo nombres)

| Variable | Para qué |
|---|---|
| `BOT_EXITO_MODO` | `seco` (por defecto), `ensayo` o `real`. |
| `BOT_EXITO_CAPACIDADES` | Lista separada por coma con las capacidades de arriba. |
| `BOT_EXITO` | `no` apaga todo. |
| `EXITO_CALENDLY_URL` | Link de "Reunion de Análisis y Proyecciones" (Capital Jurídico, uri `<ID_PRIVADO_CONFIGURADO>`). Se leyó el 25/10 con `CALENDLY_VENTAS_TOKEN` (solo lectura): `<URL_CONFIGURADA_PRIVADAMENTE>`. Ese mismo link es el valor por defecto en el código, así que la variable es opcional (solo para cambiarlo). |
| `EXITO_TYPEFORM_URL` | Link de la encuesta. Por defecto, `<URL_CONFIGURADA_PRIVADAMENTE>` ("Encuesta mensual de satisfacción"). |
| `EXITO_ENCUESTA_DIA` | Día del mes en que se publica la lista de la encuesta (1 a 28; por defecto 1). |
| `BOT_EXITO_MODELO` | Modelo de Claude (por defecto, el mismo del bot de altas: Haiku 5.5). |
| `BOT_ANTHROPIC_API_KEY` o `ANTHROPIC_API_KEY` | Claude. |
| `WHAPI_TOKEN`, `WHAPI_GRUPO_VERIFICACIONES`, `WHAPI_GRUPO_VENTAS` | Los mismos del bot de altas. |
| `BOT_ALTA_APROBADORES` | Quién aprueba (RESPONSABLE_HUB y CSM). |
| `BOT_ALTA_EQUIPO_TELEFONOS`, `BOT_ALTA_OPERACIONES`, `WHAPI_GRUPO_ADS` / `CSM` / `EDICION` / `OPERACIONES` / `COPYWRITING` | Lo del equipo, que nunca cuenta como cliente. |
| `DISCORD_WEBHOOK_CLIENTES` | Canal #🤝-exito-y-bajas. |
| `DISCORD_ID_GERO_M` | Mención de COORDINACION. |
| `SHEET_ID_CLIENTES`, `SHEET_ID_TYPEFORM` | CRM (clientes activos) y respuestas del Typeform (solo lectura). |
| `DATABASE_URL` | Neon (tablas `cj_exito_*`). |
| `CRON_SECRET` | El cron y la ruta `/api/bot/exito`. |

## Archivos

| Archivo | Qué hace |
|---|---|
| `lib/bot/exito/config.ts` | Modo, capacidades, constantes y variables (puro). |
| `lib/bot/exito/textos.ts` | Textos, saludo por hora, primer nombre, link de la encuesta (puro). |
| `lib/bot/exito/filtro.ts` | Qué mensajes del webhook le importan a la etapa y el filtro barato (puro). |
| `lib/bot/exito/claude.ts` | Clasificación con Claude. |
| `lib/bot/exito/directorio.ts` | De qué cliente es cada grupo (motor, o Whapi por nombre). |
| `lib/bot/exito/rondas.ts` | Rondas de la encuesta y respuestas de la planilla con su hora y su cliente (puro). |
| `lib/bot/exito/almacen.ts` / `almacenNeon.ts` | Estado: contrato y versión en memoria / Neon. Tablas: `cj_exito_senales` (mensajes evaluados y respuestas dudosas), `cj_exito_pedidos`, `cj_exito_testimonios`, `cj_exito_encuestas` (rondas) y `cj_exito_lotes` (la lista del mes y su OK). |
| `lib/bot/exito/nucleo.ts` | La lógica: webhook (`procesarEventos`) y cron (`correrDiario`). |
| `lib/bot/exito/servidor.ts` | Las dependencias reales y lo que llaman la ruta del webhook y el cron. |
| `lib/bot/exito/ruta.ts` / `app/api/bot/exito/route.ts` | `/api/bot/exito`. |
| `lib/bot/exito/lectura.ts` | `leerEstadoExito()` para la cartera (ver abajo). |
| `lib/bot/whapi/ruta.ts`, `app/api/bot/whapi/route.ts` | **Compartidos:** el webhook programa la etapa en `after()` (`procesarExito`), después del secreto y antes del motor. |
| `scripts/bot-exito-migrar.mjs` | Crea las tablas (`--simular`, `--real`, `--real --confirmar`). |
| `scripts/test-bot-exito.mjs` | Tests (sin red ni base). |

## Ruta `/api/bot/exito` y cron

- Regla `propio` en `lib/auth/rutas.ts`, excluida del matcher de `proxy.ts`. Solo `Authorization: Bearer <CRON_SECRET>`, nunca `?key=`. Sin el secreto responde 503; con otro, 401.
- **Cron** en `vercel.json`: `0 13 * * *`, que son las 10:00 de Argentina (en Hobby, en algún momento de esa hora). Corre todos los días, pero la lista de la encuesta solo se publica el día 1. Además vence pedidos, vincula las respuestas a su ronda, detecta éxito por la ronda vigente, consulta las respuestas dudosas, sigue un lote aprobado y manda los recordatorios.
- `GET ?dry=1`: lee todo y devuelve lo que haría, sin mandar ni escribir.
- `GET ?lista=1`: publica la lista de la encuesta del mes aunque no sea el día 1 (si todavía no se publicó).
- `GET ?estado=1`: modo, capacidades, variables que faltan (nombres) y el estado de cada cliente.

## Estado en la cartera (para la sesión "Hub de Clientes")

Esta etapa **no toca** `app/(shell)/clientes/(cartera)/*`. Para mostrarlo:

- Desde el servidor: `import { leerEstadoExito } from '@/lib/bot/exito/lectura'`. Devuelve `{ modo, capacidades, faltan, clientes: [{ clave, idCrm, cliente, estado, motivo, desde, testimonioEn }], conteos }`. Nunca tira: sin base, vuelve vacío.
- Se cruza por `idCrm` ("Z001") o, si no está, por `cliente` (nombre).
- `estado` puede ser:
  - `pedido_abierto`: esperando el OK;
  - `testimonio_pedido`: se le mandó el mensaje;
  - `testimonio_recibido`: mandó el video;
  - `rechazado`, `vencido`, `error`;
  - `simulado`: ensayo.
- Desde afuera: `GET /api/bot/exito?estado=1` con el Bearer.

## Checklist para encenderlo

1. Crear las tablas:
   ```
   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-exito-migrar.mjs
   ```
   Corre `--simular` por defecto. Después, `--real` (solo mira) y `--real --confirmar` (crea). También se crean solas con la primera escritura.
2. Aprobar el agradecimiento con el Calendly ("A APROBAR POR RESPONSABLE_HUB"). La encuesta y el recordatorio ya están aprobados.
3. Typeform: verificar el webhook de `bnvnMvVn` hacia la planilla (ver "Typeform → planilla").
4. Vercel, en orden:
   - **Ensayo:** `BOT_EXITO_MODO=ensayo` y `BOT_EXITO_CAPACIDADES=exito_pedido_ok,exito_testimonio,encuesta_mensual`. Redeploy. En Verificaciones salen solo mensajes "SIMULACIÓN". Probar un OK citado.
   - **Real por partes:** `BOT_EXITO_MODO=real` con `exito_pedido_ok`. Después sumar `exito_mensaje_cliente`, después `exito_testimonio` y, por último, `encuesta_mensual`.
   - Opcionales: `EXITO_CALENDLY_URL`, `EXITO_TYPEFORM_URL`, `EXITO_ENCUESTA_DIA`.
5. Controlar que estén `DISCORD_WEBHOOK_CLIENTES`, `DISCORD_ID_GERO_M`, `BOT_ALTA_APROBADORES`, `WHAPI_TOKEN`, `WHAPI_GRUPO_VERIFICACIONES`, `SHEET_ID_CLIENTES` y `SHEET_ID_TYPEFORM` (`GET /api/bot/exito?estado=1` lista lo que falta).
6. Probar el cron a mano con `GET /api/bot/exito?dry=1` (con el Bearer).

## Tests

```
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-exito.mjs
```

Corren sin red ni base, con Whapi, Claude y Discord falsos y el almacén en memoria (o un SQL falso para Neon). Cubren:
- la configuración y los modos;
- los textos: el exacto, el saludo por hora y el primer nombre;
- el filtro y los candidatos (incluida la convivencia con Guiones);
- Claude;
- el directorio por motor y por nombre;
- el flujo completo en real y ensayo: OK, NO, eco sin id, dudoso, 30 y 60 días, tope, concurrencia, video en otro grupo, fuera de ventana;
- las rondas: respuestas de hoy, del mes pasado y de hace dos meses, los bordes y la planilla con hora;
- el cron:
  - vencimientos;
  - la lista con OK, "OK sin X", el nombre que no está en la lista y el NO;
  - el envío por ronda y el recordatorio solo de la ronda vigente;
  - el éxito solo por la ronda vigente;
  - las dudosas con "OK Z001";
  - ensayo y dry;
- la integración con el webhook;
- la ruta;
- el almacén de Neon;
- la migración;
- la documentación.
