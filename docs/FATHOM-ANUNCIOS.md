> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Fathom → cambios de anuncios → Discord (@ADS)

Pedido de RESPONSABLE_HUB (13/10/2026): apenas termina una llamada grabada con Fathom, anotar los cambios de campaña de cada cliente y mandárselos a ADS (media buyer) por Discord, arrobándolo, un mensaje por cliente. Todo automático.

## Qué hace

1. Fathom termina de procesar una grabación de RESPONSABLE_HUB y manda el webhook **"new meeting content ready"** (transcripción, resumen y tareas) a `POST ${AUTH_BASE_URL}/api/fathom-anuncios`.
2. La ruta verifica la firma (Standard Webhooks), valida el payload y responde `200 {recibido: true}` enseguida. El resto corre después de la respuesta (`after()`, hasta 300 s).
3. Se registra la grabación en Neon (`cj_fathom_anuncios`) por `recording_id`, junto con lo que mandó Fathom (`payload`, para poder reintentar sin que Fathom la reenvíe): si ya se procesó, no se repite.
4. Si el webhook llega **sin transcripción** (el campo `transcript` vacío/nulo), no es una llamada corta: es que al webhook de Fathom le falta activar Transcript. Queda en `error` y sale **un** aviso a RESPONSABLE_HUB (una sola vez por grabación): "El webhook de Fathom llega sin transcripción: en Fathom → Settings → API Access → el webhook, activá Transcript." El cron no reintenta esas.
5. Se descartan las grabaciones de prueba: transcripción con menos de 6 renglones o menos de 3 minutos → `omitida`, sin llamar a Claude.
6. Se arma la lista de clientes del CRM (Agencia y Consultora, con estado, email y cuentas publicitarias de "Cuentas Meta" y de `AJUSTES_CUENTA`) más los **alias** de nombres mal transcriptos (`lib/fathomAnuncios/alias.json`, ver abajo), para que el modelo use los nombres canónicos. Si el CRM tarda más de 8 s o falla, se sigue sin lista (`contexto: sin_crm` en el registro) y los nombres salen como "(nombre sin verificar)".
7. Claude (`claude-opus-5-5`, esfuerzo `high`, salida estructurada en JSON) lee la llamada con el prompt de `lib/fathomAnuncios/prompt.ts` (versión `v3-2026-10-17`) y devuelve, por cliente, los cambios (rama, ubicación, presupuesto, guion, apagar, prender, público, texto/CTA, destino, pago/cuenta, accesos, lanzamiento, otro), con certeza, momento de la llamada y cita textual, más los pendientes. El resultado se guarda en el registro **apenas sale**, antes de mandar nada.
8. Si fue una llamada de venta o no hay nada para ADS → `sin_cambios`, no se manda nada.
9. Si hay cambios: un mensaje por cliente al canal, mencionando a ADS. Después de cada cliente que salió entero, queda anotado en el registro (`clientes_enviados`). Ejemplo:

```
@ADS 🎯 Cambios de anuncios · CUENTA_QA CUENTA_QA
📞 Seguimiento CUENTA_QA · lun 12/10 18:32 · Fathom
🧾 Cuenta: ACT_CUENTA_DE_PRUEBA

⚖️ Rama: Pasá los anuncios de Sucesiones a Familia. ▶ 12:30
💵 Presupuesto: Subí el presupuesto a USD 10 por día desde mañana. ▶ 14:05
❓ A confirmar: 📍 Ubicación: Sumar Quilmes si no mejora el CPL. ▶ 21:40
⏳ Pendiente: No lanzar hasta que la clienta mande los videos nuevos.
```

Cada "▶ 12:30" abre la grabación de Fathom en ese momento. La cita textual no va en el mensaje (queda en el registro). Lo dudoso ("capaz", "lo vemos") va al final como **A confirmar**. Si un cliente no entra en 2000 caracteres se parte en varios mensajes (solo el primero menciona).

Si algo falla: la fila queda en `error` con el motivo y sale **un** aviso corto al mismo canal mencionando a RESPONSABLE_HUB, que dice la verdad sobre el reintento: "Se reintenta sola mañana entre las 8 y las 9 (o si Fathom la reenvía). Si es urgente, pedile a Claude que reintente la grabación {recording_id}." (Si ya llegó al tope de intentos, o si ni siquiera quedó en la base, lo dice.)

## Kickoffs: ADS recibe solo el «🚀 Para lanzar» (24/10/2026)

Decisión de RESPONSABLE_HUB (24/10): en una kickoff, ADS recibe **solo** el «🚀 Para lanzar» del bot de kickoff (`lib/bot/kickoff/aviso-ads.ts`, ver `docs/BOT-KICKOFF-CJ.md`), no además los "cambios de anuncios" de esta ruta. Las dos rutas reciben las mismas grabaciones de RESPONSABLE_HUB (dos webhooks de Fathom), así que `procesar.ts` mira cómo clasificó la llamada el bot de kickoff en `cj_kickoffs` (**solo lectura**, `leerKickoff` de `registro.ts`; la tabla es del bot de kickoff y acá nunca se crea ni se escribe):

- **Antes de Claude:** si la fila ya dice kickoff (un reintento, o Fathom la reenvió), queda `omitida` sin llamar a Claude.
- **Antes de mandar:** se vuelve a mirar. El bot de kickoff guarda la ficha (con `tipo_reunion`) apenas sale de Claude, todavía en `procesando`: suele estar decidido ~1 minuto después del webhook. Si todavía no decidió, se espera de a 10 s hasta 3 minutos desde que arrancó la grabación (`ESPERA_KICKOFF_*` de `lib/fathomAnuncios/kickoff.ts`), siempre dejando el margen para mandar.
- **Kickoff** (`ficha.tipo_reunion = kickoff` o estado `lista`) → `omitida` con el motivo `kickoff: la llamada es una kickoff: ADS recibe el «🚀 Para lanzar» del bot de kickoff` (la extracción queda guardada en el registro, nada sale a Discord). Una fila `duplicada` (la misma reunión la grabó COORDINACION primero) decide por la original (`duplicada_de`).
- **No es kickoff** → sale como siempre.
- **Sin fila, `omitida`, `error` sin ficha, o sin decidir pasados los 3 minutos** → sale como siempre: mejor un mensaje de más que perder el cambio de un seguimiento. Si la base no responde al consultar, cuenta como "sin decidir" (se vuelve a probar dentro de la espera).
- Con `dry` no se espera: la respuesta trae `kickoff` (`kickoff`, `no_kickoff`, `pendiente` o `desconocido`) con lo que había en ese momento, y si ya era kickoff vuelve `omitida` sin llamar a Claude. `forzar` no saltea este control.

Tests: `node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-fathom-anuncios-kickoff.mjs` (19, sin red ni base: la decisión, la espera con reloj falso, el cron con poco plazo, dry, la base caída y el SQL contra un Neon falso, que tiene que ser solo un SELECT).

## Variables de entorno (Vercel, proyecto `dashboard-metricas`)

| Variable | Para qué | Si falta |
|---|---|---|
| `ANTHROPIC_API_KEY` | Llamar a Claude | Cada grabación queda en `error` ("falta ANTHROPIC_API_KEY") y avisa a RESPONSABLE_HUB |
| `FATHOM_WEBHOOK_SECRET` | Verificar la firma de Fathom (`whsec_…`, lo da Fathom al crear el webhook) | La ruta responde **503** a Fathom: nunca acepta envíos sin firma |
| `DISCORD_WEBHOOK_CAMBIOS_ANUNCIOS` | Canal donde se publican los cambios | Usa `DISCORD_WEBHOOK_ANUNCIOS` (#📣-ads); sin ninguna de las dos, `error` antes de llamar a Claude |
| `DISCORD_ID_VALENTINO` | ID numérico de Discord de ADS: `1` (no es secreto; decisión de RESPONSABLE_HUB del 13/10) | Se manda igual, sin mención, y queda un aviso en el log |
| `CRON_SECRET` (ya existe) | Modo manual, `GET` de estado y el cron de reintentos (Vercel lo manda solo): `Authorization: Bearer …` (nunca `?key=`) | Modo manual, estado y cron responden 401 |
| `DATABASE_URL` (ya existe, misma base de Cuotas) | Registro y deduplicación | Cada grabación queda en `error` ("falta DATABASE_URL") y avisa a RESPONSABLE_HUB |
| `FATHOM_ANUNCIOS_MODELO` (opcional) | Otro modelo | `claude-opus-5-5` |
| `FATHOM_ANUNCIOS_ESFUERZO` (opcional) | `low`, `medium`, `high`, `xhigh` o `max` | `high` |

También usa las credenciales de Google que ya existen (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SHEET_ID_CLIENTES`) para leer el CRM, solo lectura. Para no gastar cuota de Sheets, los clientes salen del snapshot de 10 minutos de `lib/clientes/leer.ts` y las cuentas de "Cuentas Meta" de la **misma caché del tablero de anuncios** (`conCache('sheets', REFRESCO.sheetsSeg)`): compartida entre instancias y casi siempre caliente porque el tablero la usa, así que la mayoría de los webhooks no le piden nada a Sheets (un lector propio gastaría una lectura por webhook siempre).

## Puesta en marcha (el orden importa)

1. `ANTHROPIC_API_KEY` en Vercel (Production).
2. Prueba con `?dry=1` y el payload más largo (una Daily) midiendo el tiempo. Si Claude tarda más de ~150 s, cargar `FATHOM_ANUNCIOS_ESFUERZO=medium`.
3. Recién ahí: crear el webhook en Fathom y cargar `FATHOM_WEBHOOK_SECRET`. Si el secreto llega antes que la clave de Claude, cada grabación genera avisos de error en #📣-ads.

Endurecido el 17/10: solo se aceptan grabaciones con `url` de fathom.video; el 503 sin configuración responde "no configurado" (el detalle queda en el log); el cron borra el payload de las filas en error con más de 14 días.

## Crear el webhook en Fathom

Por API (24/10, con la API key de RESPONSABLE_HUB que ya está en `.env.local`): `node scripts/fathom-webhook-anuncios.mjs --dry` muestra el pedido; sin `--dry` lo crea hacia `${AUTH_BASE_URL}/api/fathom-anuncios` (solo `my_recordings`, con transcripción, resumen y tareas) y guarda el secreto en `.env.local` como `FATHOM_WEBHOOK_SECRET` sin mostrarlo (si ya está, no crea otro). `--borrar <id>` lo borra. Los creados quedan en `.cache/fathom-webhooks-anuncios.json` (sin secretos). Después: cargar `FATHOM_WEBHOOK_SECRET` en Vercel y redeployar. **Orden:** primero tiene que estar publicado el control de kickoffs (arriba); si no, en una kickoff a ADS le llegan dos mensajes.

A mano, como antes:

1. Fathom → **Settings → API Access → Add Webhook**.
2. URL: `${AUTH_BASE_URL}/api/fathom-anuncios`.
3. Grabaciones: **My recordings** (las de RESPONSABLE_HUB).
4. Incluir **Transcript**, **Summary** y **Action items**.
5. Guardar y copiar el secreto (`whsec_…`) a `FATHOM_WEBHOOK_SECRET` en Vercel. Redeployar para que tome la variable.

Comprobación: `GET` de estado (abajo) tiene que mostrar todo en `true`.

## Probar sin mandar nada (`dry`)

Con el JSON de una reunión (el mismo formato que manda Fathom) en `reunion.json`:

```bash
curl -s -X POST '${AUTH_BASE_URL}/api/fathom-anuncios \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  --data @reunion.json | jq
```

Devuelve `{estado, mensajes, resultado, modelo, usage}`: los mensajes tal cual saldrían y lo que extrajo Claude (con las citas). **No** toca la base ni Discord, pero **sí** llama a Claude (cuesta lo mismo que una pasada real) y lee el CRM.

Estado y últimas 10 grabaciones:

```bash
curl -s ${AUTH_BASE_URL}/api/fathom-anuncios -H "Authorization: Bearer $CRON_SECRET" | jq
```

## Reintentos y reprocesar

Fathom recibe el `200` antes de que se procese la grabación: si después algo falla, Fathom no se entera. Por eso el registro guarda lo necesario para **retomar sin duplicar**:

- **Dentro de la misma ejecución**: si un paso falla con un error pasajero (Claude 429/5xx/529 o sin conexión, Discord 5xx o sin respuesta, Neon sin respuesta) y queda tiempo, se esperan 6 s y se reintenta ese paso **una** vez.
- **Cron diario** (`/api/fathom-anuncios/reintentar`, `30 11 * * *` en `vercel.json` = 8:30 AR; en el plan Hobby Vercel lo dispara en algún momento entre las 8:00 y las 8:59): toma hasta 5 grabaciones en `error` o colgadas en `procesando` hace más de 10 minutos, con el payload guardado y menos de 4 intentos, en serie y dentro del tiempo de la función. Una colgada que termina bien avisa a RESPONSABLE_HUB que se reintentó. Una sin payload (por ejemplo, de antes de este cambio) no se puede reintentar sola: se marca (`error` con el prefijo `sin_payload:`) y se avisa a RESPONSABLE_HUB **una** vez. Es una ruta hija y no `?reintentar=1` porque Vercel no documenta que respete una query en el path de un cron.
- **Si Fathom reenvía** la grabación, también se retoma (mismas reglas, sin tope de intentos).
- **Retomar** = si la fila ya tiene la extracción de la misma versión del prompt, se reusa (no se vuelve a pagar Claude) y se mandan **solo** los clientes que no están en `clientes_enviados`. Si cambió la versión del prompt, se vuelve a extraer, pero los clientes ya anotados igual no se repiten.
- **A mano por id** (lo que hace Claude cuando RESPONSABLE_HUB pide "reintentá la grabación 123"):

```bash
curl -s -X POST '${AUTH_BASE_URL}/api/fathom-anuncios \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

  Usa el payload guardado y retoma. `&dry=1` muestra qué saldría sin escribir en la base ni en Discord. `&forzar=1` re-extrae y manda **todo** de nuevo (**duplica** lo que ya había salido: revisar el canal antes). Si la fila ya no tiene el payload (se borra al llegar a `enviado`, `sin_cambios` u `omitida`), responde 409: para reprocesar una así, mandar el JSON de la reunión en el cuerpo, sin `recording_id`, con `?forzar=1` (el mismo `curl` de "Probar sin mandar nada" cambiando `dry` por `forzar`).
- El cron de reintentos también se puede correr a mano: `GET /api/fathom-anuncios?reintentar=1` o `GET /api/fathom-anuncios/reintentar`, con el Bearer.

### Tiempos

Cada ejecución tiene hasta 300 s (`maxDuration`). El procesamiento trabaja con un único límite de 280 s desde que arranca: a Claude se le da lo que quede menos 30 s (para mandar y avisar), nunca más de 240 s por intento; cada pedido a Discord tiene 15 s como máximo (un 429 se espera completo si entra en el límite; un 5xx se reintenta 2 veces, a 1 s y 3 s); cada consulta a Neon, 10 s. Ningún envío a Discord, ni el aviso de error, pasa de los 295 s.

- Colgada que ya llegó al tope de intentos (4): el cron la toma igual, la pasa a `error` con el prefijo `agotada:` (conserva el payload para un reintento a mano) y avisa a RESPONSABLE_HUB UNA vez. Ya no se reintenta sola.
- Discord termina 20 s antes del deadline (`RESERVA_ESCRITURAS_MS`) para que entren las últimas escrituras en Neon.

## Registro (`cj_fathom_anuncios`, Neon)

Una fila por `recording_id`, se crea sola la primera vez (las columnas nuevas `payload` y `clientes_enviados` se agregan solas con `ADD COLUMN IF NOT EXISTS`). Estados: `procesando`, `enviado`, `sin_cambios`, `omitida` (el motivo queda en `error`), `error`. Guarda título, URL, intentos, cantidad de clientes y de cambios, ids de los mensajes de Discord, los clientes ya mandados (`clientes_enviados`), el resultado de Claude (con las citas, el contexto `ok`/`sin_crm`, el largo de la transcripción y lo que se corrigió de la salida), modelo, versión del prompt, tokens y duración. Mientras la grabación no termina guarda también el `payload` de Fathom (que incluye la transcripción) para poder reintentar; se borra (`NULL`) cuando llega a `enviado`, `sin_cambios` u `omitida`. Las filas en `error` lo conservan hasta que se resuelven.

## Alias de nombres (bóveda → `alias.json`)

Fathom escribe los nombres de oído ("Bucha Morro" era CUENTA_QA). La bóveda de Obsidian tiene la tabla "Alias conocidos" en `negocio/Clientes - nombres canonicos.md`; `node scripts/fathom-alias-desde-boveda.mjs` la lee (solo lectura) y escribe `lib/fathomAnuncios/alias.json` (`[{ "escrito": [...], "cliente": "..." }]`, sin enlaces). Va en el mensaje de usuario, dentro de `<clientes_conocidos>`, después de la lista. Solo ayuda a elegir: un `cliente_crm` que no está en la lista del CRM igual pasa a "(nombre sin verificar)". Cuando cambie la tabla, correr el script de nuevo y deployar el JSON nuevo.

## Qué se controla de la salida de Claude

- Forma: JSON Schema estricto (salida estructurada) y además validación a la vuelta.
- `cliente_crm` tiene que estar en la lista del CRM; si no, se manda como "(nombre sin verificar)". La cuenta publicitaria, igual: si no figura en la lista, no va.
- Timestamp mal formado o fuera de la llamada: el cambio va igual, pero **sin** link (no se adivina el momento).
- Textos recortados, sin markdown propio y sin menciones (`@everyone`, `@here`, `<@…>`): la única mención es la de ADS. Discord además solo permite notificar a los usuarios que se le pasan (`allowed_mentions`).
- `stop_reason` de rechazo o de `max_tokens` → `error`, nunca un resultado a medias. Ante un rechazo de los clasificadores se pide el fallback del servidor (`fallbacks: "default"`).

## Costo estimado

Claude Opus 5.5: USD 4 por millón de tokens de entrada y USD 20 por millón de salida (el razonamiento se cobra como salida). Una llamada de 30 minutos son unos 15.000–20.000 tokens de entrada (transcripción, lista de clientes y prompt) y unos 2.000–6.000 de salida: **USD 0,10 a 0,20 por llamada**; una de una hora, hasta unos USD 0,30. Con 5 llamadas por día, del orden de USD 20–30 por mes. Los tokens reales de cada pasada quedan en el registro (`tokens_in`, `tokens_out`). Las grabaciones omitidas y las duplicadas no llaman a Claude.

## Seguridad

- Webhook: firma Standard Webhooks sobre el cuerpo crudo, comparación en tiempo constante, ventana de 5 minutos contra reenvíos; sin `FATHOM_WEBHOOK_SECRET` responde 503.
- Modo manual, estado y cron: solo `Authorization: Bearer <CRON_SECRET>` (comparación en tiempo constante), nunca `?key=`.
- `/api/fathom-anuncios` y `/api/fathom-anuncios/reintentar` quedan fuera del proxy (matcher de `proxy.ts`) y declaradas como `propio` en `lib/auth/rutas.ts`: se autentican solas. Ver `docs/ACCESO-Y-ROLES.md`.
- La URL del webhook de Discord nunca se loguea; los motivos de error se limpian de URLs y claves antes de guardarse o mandarse.

## Archivos

- `app/api/fathom-anuncios/route.ts` — webhook, modo manual (también por `recording_id`) y estado.
- `app/api/fathom-anuncios/reintentar/route.ts` — cron diario de reintentos.
- `lib/fathomAnuncios/` — `kickoff.ts` (la decisión de las kickoffs, pura; la lectura de `cj_kickoffs` está en `registro.ts`), `tipos.ts` (payload y validación), `firma.ts`, `transcripcion.ts`, `contexto.ts` (CRM), `prompt.ts` (texto exacto + versión), `alias.json` (generado), `extraer.ts` (Claude), `mensaje.ts` (formato de Discord y avisos), `discord.ts` (envío), `errores.ts` (qué es pasajero), `registro.ts` (Neon), `procesar.ts` (orquestador y cron, con dependencias inyectables), `servidor.ts` (dependencias reales que comparten las dos rutas).
- `scripts/fathom-alias-desde-boveda.mjs` — regenera `alias.json` desde la bóveda.
- `scripts/fathom-webhook-anuncios.mjs` — crea o borra el webhook de Fathom de esta ruta por API (cuenta de RESPONSABLE_HUB).
- Tests (sin red, sin base, sin Claude): `node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-fathom-anuncios.mjs`.
