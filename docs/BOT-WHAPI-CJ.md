> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot "Capital Jurídico": webhook y cliente de Whapi (BLOQUE W)

Parte del motor del bot de altas (`docs/BOT-ALTA-CJ.md`). Este bloque es la puerta de WhatsApp: recibe los mensajes de "Ventas C.J." y "Verificaciones C.J", los convierte en eventos para el orquestador y le da un cliente de Whapi que respeta el modo (seco, ensayo o real). El orquestador (BLOQUE O, `lib/bot/alta/motor/*`) decide qué hacer con cada evento.

Escrito el 24/10/2026, **sin chip ni cuenta de Whapi**: todo está probado contra respuestas armadas con la forma de la referencia de Whapi (OpenAPI 1.8.7, 30/06/2026) y de los ejemplos de soporte. Nada llamó a Whapi.

## Archivos

| Archivo | Qué hace |
|---|---|
| `app/api/bot/whapi/route.ts` | La ruta de Next: pasa `after()` y las fábricas reales a `ruta.ts`. `maxDuration = 300`, `runtime = 'nodejs'`. |
| `lib/bot/whapi/ruta.ts` | Lo que hace la ruta (POST del webhook y GET de estado), probado sin Next. |
| `lib/bot/whapi/webhook.ts` | Puro: lee la envoltura de Whapi y clasifica cada mensaje en un `EventoBot`. También `veredicto()` (OK / NO). |
| `lib/bot/whapi/config.ts` | Lee y valida las variables. Nunca devuelve ni loguea valores, solo nombres. |
| `lib/bot/whapi/cliente.ts` | Cliente real (`fetch` contra `<URL_CONFIGURADA_PRIVADAMENTE>` con Bearer). |
| `lib/bot/whapi/medios.ts` | Bajar el comprobante (tope de 20 MB, redirecciones permitidas, sha256 propio). |
| `lib/bot/whapi/compuerta.ts` | La compuerta del modo sobre cualquier cliente: lo que el modo no permite no sale. |
| `lib/bot/whapi/index.ts` | `clienteWhapiDesdeEntorno()`: el cliente que usa el motor, siempre con la compuerta. |
| `lib/bot/whapi/juguete.ts` | Cliente de juguete para los tests del orquestador (sin red, fallas programables). |
| `lib/bot/whapi/errores.ts` | `ErrorWhapi` y la traducción de los códigos HTTP. |
| `lib/bot/whapi/comun.ts` | Patrones de la referencia (chat, MediaID, menciones) y la descripción de cada operación. |
| `lib/bot/whapi/guiones.ts` | Reenvío a Guiones de los textos de los grupos «Contenido - <cliente>» (filtro puro, dedupe en Neon y POST a `/api/bot/guiones/respuesta`). |
| `lib/bot/whapi/ajustes.ts` | Arma el `PATCH /settings` del canal (puro). |
| `scripts/bot-whapi-configurar.mjs` | CLI para configurar el webhook del canal. |
| `scripts/test-bot-whapi.mjs` | Tests (114, sin red). |

El contrato con el orquestador está en `lib/bot/alta/motor/tipos.ts` (día 0, lo escribió el BLOQUE O) y el modo en `lib/bot/alta/motor/modo.ts`. La revisión del 24/10/2026 sumó dos cambios aditivos al contrato: `EventoEco.grupo` puede ser `null` (el eco del General de un cliente) y `enviarVideo` acepta `hasta` (el plazo de la invocación para la subida y el envío juntos).

## El webhook: `POST /api/bot/whapi`

Responde en menos de 10 s (Whapi espera 15). En el camino síncrono solo hay verificación, parseo, clasificación y el registro en Neon (`motor.registrar`, con tope de 8 s). Todo lo largo corre en `after()`: bajar el comprobante, Claude, Sheets, Drive y PandaDoc.

1. **Configuración.** Si falta `WHAPI_WEBHOOK_SECRETO` o alguno de los dos grupos, o tienen una forma imposible, responde **503**. Falla cerrado. El log dice el nombre de la variable, nunca el valor.
2. **Secreto.** Whapi no firma los envíos. El header `x-cj-bot-secreto` se configura en el canal (`PATCH /settings`) y se compara en tiempo constante (`igualesSeguro`). Si no coincide, responde **401**. El secreto nunca va en la URL, porque quedaría en los logs.
3. **Lo permanente responde 200.** Con `callback_persist`, Whapi reintenta durante 24 h todo lo que no sea 200. Por eso un cuerpo de más de 2 MB, un JSON roto, un cuerpo que no es un objeto o un `channel_id` ajeno responden **200 `{ ignorado }`**. Solo lo pasajero o un error de configuración responde 401 o 503.
4. **Clasificación** (`webhook.ts`, sección siguiente).
5. **Sin eventos:** responde 200 y llama igual a `motor.procesar([])` en `after()`. Sin cron, el motor solo despierta con los webhooks, y ahí hace el barrido de recordatorios y horas vencidas.
6. **Con eventos:** `motor.registrar(eventos)`. Si tira o tarda más de 8 s, responde **503** y Whapi reintenta. Lo que ya se guardó vuelve como repetido, y el motor lo devuelve en `nuevos` si sigue sin procesar. Después, `after(() => motor.procesar(nuevos, { hasta: t0 + 285 s }))` y **200** con conteos.

### Reenvío a Guiones de los grupos «Contenido - <cliente>» (25/10/2026)

Aparte del motor de altas, los mensajes de **texto** que el cliente escribe en su grupo Contenido se reenvían a la ruta de Guiones, que los guarda como nota sin revisar si en ese grupo se avisó una tanda (`app/api/bot/guiones/respuesta/route.ts`). Código: `lib/bot/whapi/guiones.ts`; la ruta lo llama desde `ruta.ts`.
- **Contrato:** `POST ${DESPACHO_URL (https) o el origen del propio pedido}/api/bot/guiones/respuesta`, con `authorization: Bearer ${CRON_SECRET}` y JSON `{ grupo, texto, mensaje_id, autor, citado?, fecha? }`. `autor` es el nombre que se ve en WhatsApp (o el teléfono / lid si no hay), `citado` el id del mensaje citado (por ejemplo, el aviso de la tanda) y `fecha` cuándo lo mandó el cliente (ISO).
- **Qué va:** texto (`text` / `link_preview`) e imágenes **solo con su pie** como texto, de un grupo que no sea Ventas C.J., Verificaciones C.J ni el grupo de guiones del equipo (`WHAPI_GRUPO_COPYWRITING`, si está), con hasta 48 h de atraso. Audios, stickers, documentos, videos, reacciones y ediciones no.
- **Qué no va nunca:** lo del número del bot (`from_me`) ni lo de una persona del equipo (teléfonos o lid de `BOT_ALTA_EQUIPO_TELEFONOS`, `BOT_ALTA_APROBADORES` y `BOT_ALTA_OPERACIONES`).
- **Cómo se sabe que el grupo es un Contenido, sin adivinar:**
  1. los `chat_id` que guardó el paso `comunidad` del motor (`cj_altas_pasos.resultado.grupos.contenido.id`, o el `parcial` mientras corre). Se leen en una sola consulta y quedan 10 min en caché por instancia;
  2. si no está ahí, el nombre del grupo por Whapi (`GET /groups/{id}`), que tiene que empezar con «Contenido - ». Caché por instancia: 12 h si es, 1 h si no es, 5 min si Whapi falló.
  - Un mensaje de cualquier otro grupo se ignora: no sale nada.
- **Sin repetir:** cada `mensaje_id` se reclama en Neon (`cj_guiones_reenvios`, `INSERT … ON CONFLICT DO NOTHING`) antes de mandarlo. Si Whapi reintenta el webhook o manda el mismo mensaje dos veces, no se reenvía de nuevo. La tabla la crea la primera escritura. Sin base para reclamar, no se manda (sin dedupe no sale nada).
- **No demora la respuesta a Whapi:** en el camino síncrono solo hay un filtro puro. La consulta a Neon, el `GET` a Whapi y el `POST` van en `after()`. Se programa **después** del secreto y del filtro de `WHAPI_CANAL_ID`, y **antes** de armar el motor: un 503 del motor no frena el reenvío, y el reintento de Whapi no lo duplica.
- **No se reintenta:** si la ruta de Guiones falla, queda el estado en `cj_guiones_reenvios` (`nota`, `ignorado`, `error_http_<n>` o `error_<tipo>`) y la nota se puede cargar a mano en la pantalla de la tanda.
- **Apagado:** `BOT_GUIONES_REENVIO=no`. Sin `CRON_SECRET` o sin `DATABASE_URL` no se reenvía nada, y el log lo dice una vez por instancia (con los nombres).
- El log lleva conteos ("guiones → 1 reenviado(s) (1 nota(s), 0 sin tanda)…"): nunca textos, teléfonos, nombres ni secretos.

### Etapa Éxito del cliente (25/10/2026)

Del mismo envío, la ruta también filtra, sin red, lo que le importa a la etapa Éxito y lo procesa en `after()` (`procesarExito`, `lib/bot/exito/*`):
- los textos y videos de los clientes en sus 3 grupos (General, Ventas y Contenido);
- los OK / NO que citan un pedido de testimonio en Verificaciones;
- los ecos de esos pedidos.

Igual que Guiones, va después del secreto y del filtro de `WHAPI_CANAL_ID` y antes del motor, así un 503 del motor no la frena. Tiene su propio dedupe (`cj_exito_senales`): convive con el reenvío a Guiones sobre los mismos mensajes de Contenido sin pisarse. Nace en seco (`BOT_EXITO_MODO`) y `BOT_EXITO=no` la apaga. Detalle en `docs/BOT-EXITO-CJ.md`.

**El modo nace en seco.** Sin `BOT_ALTA_MODO=real` (o `ensayo`) y sin `BOT_ALTA_PASOS_REALES`, el motor no escribe en Sheets, Drive ni PandaDoc y no manda mensajes. La compuerta lo garantiza aunque el orquestador se equivoque.

**El log** lleva conteos ("3 mensaje(s) → eventos alta:1 respuesta:1 · descartados charla:1") y nombres de variables. Nunca el secreto, el token, textos, teléfonos ni nombres.

**`GET /api/bot/whapi`**, con `Authorization: Bearer <CRON_SECRET>`, devuelve el modo, las capacidades y los nombres de las variables que faltan o están mal. Los eventos y las altas se ven en `GET /api/bot/alta/motor`: el contrato del motor no tiene un método para listarlos.

## Qué se guarda y qué no (clasificación)

| Dónde | Mensaje | Evento |
|---|---|---|
| Ventas C.J. | Texto con `#ALTA`, también como pie de una imagen o un PDF | `EventoAlta`, con el medio si lo hay |
| Ventas C.J. | Imagen, o documento PDF o imagen, sin `#ALTA` | `EventoAdjunto` (comprobante suelto) |
| Ventas C.J. | Álbum (`type: 'album'`) | `EventoAdjunto` sin medios, con `albumEsperado`. Las fotos llegan después, cada una como su propio mensaje |
| Ventas C.J. | Texto sin `#ALTA` que cita un mensaje o trae una línea "Clave: valor" | `EventoRespuesta` (el veredicto viene leído, pero en Ventas no se usa) |
| Ventas C.J. | Edición de un mensaje con `#ALTA` o "Clave: valor" | `EventoEdicion` (ver abajo) |
| Verificaciones C.J | Texto que **cita** un mensaje y empieza con OK o NO | `EventoRespuesta` con el veredicto |
| Los dos grupos | Mensaje del propio bot mandado por la API (`from_me: true`, `source: 'api'`) | `EventoEco`, para confirmar un envío dudoso y recuperar su id |
| Cualquier otro grupo (`…@g.us`) | Lo mismo: el eco de la bienvenida en el General de un cliente (desde el 24/10/2026) | `EventoEco` con `grupo: null` |

**Lo que se descarta, con su motivo** (y no se guarda): charla de Ventas (un "Buen día equipo" no es una respuesta), OK o NO sin cita, charla citando en Verificaciones, imágenes en Verificaciones, audios, stickers, reacciones, documentos que no son PDF ni imagen (un `.docx` suelto, aunque con `#ALTA` en el pie sí pasa), otros chats (salvo el eco de la API en un grupo), lo que mandó una persona desde el teléfono del bot y lo que llega con más de 48 h de atraso (una sincronización al reconectar).

**Veredictos.**
- "OK", "ok!!", "OK RESPONSABLE_HUB" y "OK CUENTA_QA CUENTA_QA" son OK, y el resto queda en `resto`.
- "NO", "No, falta el DNI" y "no sé" son NO, y el motivo queda en `motivo`.
- "okey" o "nota" no son veredictos.
- Para confirmar o cambiar un nombre se responde **"OK Nombre Apellido"**. El texto libre sin OK no se guarda en Verificaciones.

**Ediciones.** Llegan por dos caminos:
- como `type: 'action'` con `action.type` igual a `edit` o `edited`, `action.target` y `action.edited_content`;
- por `messages.patch` (`messages_updates[]` con `trigger`, `before_update` y `after_update`).

`mensajeId` es el mensaje editado. La clave es `ed:<id editado>:<sha256 del texto nuevo>`, así la misma edición que llega por los dos caminos se guarda una sola vez.

**Autor.**
- `from` con dígitos o `…@s.whatsapp.net` es el teléfono.
- `…@lid` queda en `lid`. Si viene `phone` (`data_mode: extend`), también queda el teléfono.
- Con `data_mode: replace` (el de por defecto), el mismo closer puede llegar a veces con teléfono y a veces con `@lid`. Por eso se guardan los dos.
- `from_name` es solo informativo: no sirve para autorizar.

**Medios.** `RefMedio.link` queda siempre en `null`: `auto_download` está apagado y el archivo se baja por `GET /media/{id}`.

## El cliente: real, compuerta y juguete

**Cliente real (`cliente.ts`).**
- **Escrituras** (mandar, crear, agregar, foto, info, agendar): nunca se reintentan. Un 5xx, un 524, un corte o un error de red salen como `dudoso` (`aplicado: null`) y decide el orquestador.
- **Lecturas** (media, subgrupos, invitación, comunidades, verificar números): se reintentan una vez ante un 5xx o un error de red.
- **Errores:** 401 → `auth` (se cayó la sesión: volver a escanear el QR), 402 → `limite`, 403 → `prohibido`, 404 → `no_encontrado`, 409 → `ya_existe`, 429 → `soft_ban`, 400 o 413 → `rechazo`.
- **Ids simulados:** los ids `seco-…` y `jg-…` se rechazan con `config` antes de salir. Es la tercera barrera del modo seco.
- **Menciones:** Whapi exige "@<número>" en el texto además de `mentions`. Lo arma quien llama; si falta, `config` y no sale nada.
- **Id del envío:** `SentMessage.message`, que trae el id, es opcional en la referencia. Si no viene, el envío vuelve con `id: null` y el id llega con el eco.
- **Video:** primero se sube con `POST /media`, una vez por URL y por proceso (se reusa 24 h), y después se manda por MediaID con `no_encode`. Si falla la subida no se mandó nada (`aplicado: false`), y el envío en sí es corto, así casi no hay 524.
- **Grupos:** crear un grupo devuelve un `Group` sin `failed`. Los fallidos salen de comparar lo pedido con los `participants` que vuelven. Un participante que vuelve solo como `@lid` no se puede emparejar y cuenta como fallido: el aviso a COORDINACION lo resuelve con los links de invitación.
- **Buscar comunidades:** `buscarComunidades` usa `GET /communities` paginado (100 por página, hasta 5 páginas) y filtra por nombre exacto y fecha, porque `GET /groups` no filtra. `buscarGrupoPorNombre` no se implementa.
- **Subgrupos:** `subgruposComunidad` trae `generalChat` (el "General" que WhatsApp puede crear solo) y el código de invitación de cada grupo.

**Compuerta (`compuerta.ts`).** Decide por operación con `puede()`:

| Operación | Necesita |
|---|---|
| Texto a Verificaciones C.J | `reporte_verificaciones` o `mensajes_equipo` |
| Texto a Ventas C.J. | `mensajes_equipo` |
| Texto a cualquier otro chat (la bienvenida cuando no entra como pie) | `bienvenida` |
| Video | `bienvenida` |
| Comunidad, grupos, fotos, participantes, invitaciones, contactos y verificar números | `comunidad` |
| Bajar el comprobante | modo ensayo o real (es una lectura) |

Lo que no pasa:
- no toca la red: queda en el registro como simulado y vuelve un resultado con ids `seco-<n>` (`EnvioWhapi.simulado = true`);
- bajar el comprobante en seco tira `bloqueado`.

En ensayo, cada texto que sale lleva adelante "SIMULACIÓN — no se cargó nada" (si ya lo trae, no se repite). En seco igual se controla la forma de un texto (vacío, menciones sin "@"), para que un error del orquestador aparezca en los tests.

**Juguete (`juguete.ts`)**, para los tests del orquestador: `clienteWhapiDeJuguete(opciones)`.
- Sin red. Ids `jg-…`. Registra cada llamada (`registro()`, y `llamadas()` con argumentos y resultado).
- `fallas: { metodo: { status | red, aplicar?, veces? } }`: se traducen igual que en el cliente real. Con `aplicar: true` la operación se hace igual antes de fallar (el dudoso de verdad). `fallar(metodo, falla)` suma una más.
- `generalAutomatico` (el General de WhatsApp), `sinIdEnEnvios` (id null), `noAgregables`, `invalidos` y `medios` (archivos por id).
- `ecos(grupos)` devuelve los `EventoEco` de lo que "mandó" a los dos grupos (y, con `grupo: null`, a cualquier otro grupo), iguales a los que emite el webhook real (hay un test que lo compara).
- El juguete no reintenta: el cliente real reintenta las lecturas una vez.

## Configurar el canal (cuando haya chip y cuenta)

### Reconexión del canal existente (29/10/2026)

`scripts/whapi-reconexion.mjs` consulta únicamente `GET /health` y `GET /settings`. Requiere `--leer`, una ruta absoluta `--env=…` y un directorio absoluto `--privado=…`; sin esos argumentos no realiza ninguna solicitud. El resultado omite tokens, número, nombres y valores de cabeceras. No invoca la guardia que manda alertas de Discord.

Con `--qr` pide además `GET /users/login/image` sólo si coincide el canal esperado, no está conectado ni suspendido y está en LAUNCH/QR. Guarda `reconexion-qr.png` con permisos 0600 dentro de un directorio 0700. El QR es temporal y se renueva al momento de escanear con el WhatsApp del dueño. Tener QR no acredita conexión: verificar después `AUTH`/código 4. No activa flags, cambia el webhook ni envía mensajes. Contrato oficial: <URL_CONFIGURADA_PRIVADAMENTE>.

La entrega automática de Edición requiere **ambos** `EDICION_WHATSAPP=real` y `EDICION_WHATSAPP_DESDE=<fecha ISO UTC completa>`, además de salud, CRM, revisión y enlace actuales. La fecha del evento original debe ser posterior al corte y tener como máximo 24 horas. Un reintento no rejuvenece una entrega. Los avisos anteriores pasan a `espera_revision` antes del límite de lectura, siguen visibles en la tarjeta y generan un aviso interno idempotente a COORDINACION/RESPONSABLE_HUB. Requieren una nueva revisión; reconectar no los libera. Se intenta como máximo un lote de un cliente por pasada; el resultado incierto consume ese límite y queda `dudoso`, sin reenvío automático.

E01 conserva su corte separado `E01_WHATSAPP_DESDE`, escalones, horario hábil, vigencia y máximo de envíos. Guiones mantiene entrega manual desde su cola. La alerta de clientes activos con tres días sin respuesta es sólo interna, con actividad observable; no manda mensajes ni depende de que WhatsApp esté conectado.

`GET /api/bot/grabacion/vigia` autenticado expone los modos y cortes de Edición/E01 sin secretos. Para revisar inactivos sin escribir se usa `GET /api/clientes/inactivos?dry=1`. Estos controles no habilitan envíos ni sustituyen la comprobación del número después del escaneo.

1. RESPONSABLE_HUB crea el canal en whapi.cloud, escanea el QR con el chip y deja que el número se caliente (la ficha pide de 3 a 10 días antes de usarlo).
2. En `.env.local` y en Vercel:
   - `WHAPI_TOKEN`;
   - `WHAPI_WEBHOOK_SECRETO`: 24 caracteres o más, por ejemplo `openssl rand -base64 32` sin `=`;
   - `WHAPI_GRUPO_VENTAS` y `WHAPI_GRUPO_VERIFICACIONES`: el `chat_id` de cada grupo (`…@g.us`); se ve en `GET /groups`. No sale del primer webhook: sin los dos grupos, la ruta responde 503 antes de leer el cuerpo (y con `callback_persist` Whapi reintentaría esos envíos 24 h);
   - opcional, `WHAPI_CANAL_ID`.
3. Sumar el número del bot a los dos grupos. **El equipo tiene que agendar el número del bot**: un número nuevo no puede agregar a los grupos a quien no lo tiene agendado.
4. Configurar el webhook:
   - `scripts/bot-whapi-configurar.mjs --simular` muestra el `PATCH /settings` sin salir a la red (`--actual=<archivo>` parte de una configuración leída);
   - `--leer` muestra la configuración actual, tapada;
   - `--real` lee `GET /settings`, arma el cuerpo con **todo lo leído** más los cambios y muestra la diferencia;
   - recién con `--real --confirmar` manda el `PATCH` y el `POST /settings/webhook_test`. La prueba lleva su propio header `x-cj-bot-secreto` (webhook_test no usa los del webhook guardado). En el log de `/api/bot/whapi` tiene que verse una línea `bot-whapi: …` sin "(401)" ni "(503)" (la prueba no trae mensajes de los grupos: 200 con 0 eventos). Un 401 = el secreto de Vercel no es el de `.env.local`, o falta el Redeploy después de cargarlo.

   El script nunca imprime el token ni el secreto: los headers, el proxy y la query de las URLs salen tapados. De los webhooks que no son el nuestro muestra solo el host (revisión del 24/10/2026: Make y otros llevan el token en la ruta, por ejemplo `hook.us2.make.com/<token>`).
5. **Reiniciar el canal** en el panel de whapi.cloud: `callback_persist` lo pide.

**Lo que configura el `PATCH /settings`.** Va siempre con todos los campos, por la trampa de que lo omitido vuelve a su valor por defecto:
- un webhook propio por URL: `mode: 'body'`, eventos `messages.post`, `messages.patch`, `channel.post` y `users.delete`, header `x-cj-bot-secreto` y `webhook_max_age_seconds: 86400`. Son 24 h y no 10 min para no perder un `#ALTA` si Whapi o Vercel se caen un rato; los repetidos se descartan igual. `channel.post` y `users.delete` son la sesión del número: si se desvincula (QR, error, cierre de sesión), la ruta deja un ERROR "la sesión del número de Whapi se cayó" en el log, sin datos personales, y responde 200 sin tocar el motor (revisión del 24/10, ronda 2: antes el bot quedaba sordo sin rastro);
- `callback_persist: true`, backoff de 3000 ms y tope de 900000 ms;
- `media.auto_download: []`, apagado: si no, quedaría un link público de wasabi de cada archivo de los grupos;
- `pdo_sync`, `offline_mode`, `full_history` y `auto_read_messages` explícitos, con el valor que tenían;
- los otros webhooks del canal quedan como están.

## Variables (solo nombres)

| Variable | Para qué |
|---|---|
| `WHAPI_TOKEN` | Token del canal. Sin él, en ensayo o real cada llamada tira `config` y no sale nada. |
| `WHAPI_WEBHOOK_SECRETO` | Valor del header `x-cj-bot-secreto`. |
| `WHAPI_GRUPO_VENTAS`, `WHAPI_GRUPO_VERIFICACIONES` | `chat_id` de los dos grupos. Tienen que ser distintos. |
| `WHAPI_CANAL_ID` | Opcional: `channel_id` del canal. |
| `BOT_ALTA_MODO`, `BOT_ALTA_PASOS_REALES` | Modo y capacidades del motor (`lib/bot/alta/motor/modo.ts`). |
| `CRON_SECRET` | `GET` de estado y el Bearer del reenvío a Guiones. |
| `DATABASE_URL`, `DESPACHO_URL` | Reenvío a Guiones: dedupe y grupos del motor en Neon; base de la URL (si no, el origen del pedido). |
| `BOT_GUIONES_REENVIO` | `no` apaga el reenvío a Guiones (prendido por defecto). |
| `BOT_ALTA_EQUIPO_TELEFONOS`, `BOT_ALTA_APROBADORES`, `BOT_ALTA_OPERACIONES` | Además del motor: lo que escriben esas personas en un grupo Contenido no se reenvía. |

## Tests

```
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-whapi.mjs
```

Son 114, sin red (desde el 25/10, con el reenvío a Guiones: filtro, ruta, dedupe y lo real con Neon y fetch falsos): el fetch global está bloqueado y cada prueba usa un fetch falso. Cubren:
- la envoltura con los ejemplos de la ficha, el filtro y los veredictos;
- la ruta, con un motor de juguete: los 503, el 401, los 200 `{ ignorado }`, el registro que tira o tarda, el `after()`, el freno del barrido (un webhook sin eventos nuevos barre como mucho cada 10 min por instancia), los eventos de la sesión del número y que el log no tenga datos;
- los recortes de texto, que no parten un emoji (un surrogate suelto hace fallar el jsonb de Neon);
- el cliente real: rutas, verbos, cuerpos, errores, reintentos, video por MediaID, fallidos y paginado;
- los medios: tope, redirecciones y sha256;
- la compuerta en seco, ensayo y real, capacidad por capacidad;
- el juguete;
- el CLI.

## Lo que queda abierto

- ~~**Eco de la bienvenida.**~~ HECHO en la revisión del 24/10/2026: `EventoEco.grupo` admite `null` y el webhook deja pasar el eco de la API de cualquier grupo, así una bienvenida dudosa se confirma sola (también el video sin pie, cuando el texto va aparte: su eco llega sin texto y se empareja con la huella del texto vacío en ese chat).
- **Eventos en el `GET` de estado.** `MotorAltas` no tiene un método para listar eventos. Se ven en `GET /api/bot/alta/motor`.
- **Formas sin confirmar en la doc de Whapi** (probarlas en el sandbox):
  - el ejemplo de webhook de una imagen;
  - cómo se vinculan las fotos de un álbum con el mensaje `album`;
  - la foto y la descripción de una comunidad después de crearla;
  - el formato del link de invitación (`<URL_CONFIGURADA_PRIVADAMENTE><invite_code>` se deduce);
  - si `GET /media/{id}` redirige al almacenamiento (se aceptan redirecciones solo a `gate.whapi.cloud` o `*.wasabisys.com`, sin el token);
  - si `GET /settings` devuelve campos que `PATCH` no acepta.
- **Avisar las caídas del número** por otra vía que no sea WhatsApp (por ejemplo, Discord): desde la ronda 2 del 24/10, la desvinculación llega por `channel.post` / `users.delete` y queda como ERROR en el log de Vercel (y el 401 de un envío, en `cj_altas`); falta mandarlo a algún lado que alguien mire (una alerta de Vercel sobre esa línea alcanza).
