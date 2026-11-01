> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot Capital Jurídico · etapa Guiones (ideas del kickoff → tanda → revisión → Doc + WhatsApp → correcciones)

Tareas d01–d04 del doc «Sistema de tareas - C.J» (artifact de tareas, etapa Guiones). Antes los escribía REVISOR_GUIONES, el copywriter, con las ideas de RESPONSABLE_HUB.

## Decisiones de RESPONSABLE_HUB (24–25/10/2026)
- **~6 guiones por tanda**, de **500 a 800 caracteres** de texto hablado.
- **Diversidad creativa:** un recurso distinto por guion (catálogo de 20 en `formatos.ts`) y el abogado nunca quieto.
- **Análisis de mercado de la zona** antes de escribir (`mercado.ts`, con búsqueda web y fuentes).
- **9 reglas de estilo** que salen de sus votos en el Taller de guiones (`preferencias.ts`, mandan sobre todo lo demás):
  1. «despido» y la provincia en la primera frase;
  2. solo la provincia;
  3. «trabajo» y nunca «laburo»;
  4. nada de gente que ya firmó la liquidación;
  5. ganchos cortos;
  6. indicaciones simples (objeto o gesto, sin jerga de cámara ni tono);
  7. conectores;
  8. CTA directo («así resolvemos juntos… así te pagan lo que realmente te corresponde»);
  9. urgencia = lo que pierde («te pueden pagar la mitad o menos») y las pruebas que se pierden.
- El cliente lee los guiones en **su Doc «Guiones - Z001»** y el bot le avisa en el grupo **«Contenido - <cliente>»** de su comunidad de WhatsApp.
- Aprueban **RESPONSABLE_HUB o REVISOR_GUIONES**: con uno alcanza. Los avisos al equipo («lista para revisar», «el cliente pidió cambios y ya están aplicados») van al **grupo de guiones de WhatsApp** (`WHAPI_GRUPO_COPYWRITING`); la revisión y el check se hacen en el Despacho (`/guiones/<id>`).
- **Correcciones del cliente: las hace el bot solo** y después RESPONSABLE_HUB o REVISOR_GUIONES dan el check de nuevo (25/10).

Tanda de referencia aprobada por RESPONSABLE_HUB (CUENTA_QA CUENTA_QA CUENTA_QA, San CUENTA_QA): `.cache/guiones/prueba/tanda-2026-10-25-15-23.json`.

## Flujo
1. **Disparo.** RESPONSABLE_HUB y COORDINACION aprueban las ideas en `/clientes/<id>/kickoff`. La sesión Kickoff agrega en `lib/bot/kickoff/acciones.ts`, en la rama «las dos aprobadas», `POST /api/bot/guiones {recording_id}` con `Authorization: Bearer <CRON_SECRET>`.
2. **Generación por pasos** (`proceso.ts`), cada uno en su invocación; la ruta responde 202 y trabaja en `after()`. Cada llamada a Claude recibe como tope lo que le queda a la invocación (tope de 255 s):
   - `mercado`: unos 2–4 min, ~15 búsquedas.
   - `plan`.
   - `guion n` ×6 en paralelo: escribe y guarda.
   - `revisar n`: reglas y jefe creativo con contexto limpio; corrige ahí mismo si le alcanza el tiempo, y si no, dispara `corregir n`.
   - El que deja el último guion listo pasa la tanda a `a_revisar` (una sola vez) y avisa al grupo de guiones de WhatsApp. Si no está ese grupo o falta `WHAPI_TOKEN`, avisa por Discord.
   - Si algo falla, la tanda queda en `error` con el motivo. Si queda colgada (más de 6 min sin moverse), la pantalla muestra «Retomar» (`reanudar`), que vuelve a lo que falta.
   - Todas las escrituras del bot llevan condición sobre el estado: un paso tardío no pisa lo que ya editó o aprobó una persona.
3. **Verificación humana (d02):** en `/guiones/<id>` RESPONSABLE_HUB o REVISOR_GUIONES editan la indicación y el texto, y dan el check «✓ Revisado: aprobar y mandar al cliente». La primera vez se pega el Doc «Guiones - …»; después se reusa.
4. **Envío** (`envio.ts`, en `after()`):
   - El Puente Drive (`agregarTanda`) agrega la tanda al final del Doc con un marcador por aprobación, `[tanda:cj-guiones-<recording>-<n>-<aprobación>]`. Un reintento no la duplica y una reaprobación escribe la versión corregida.
   - Whapi manda el mensaje al grupo Contenido del cliente. Se reserva antes de mandar, así sale uno solo por aprobación. El grupo se busca por nombre exacto («Contenido - » más todas las palabras del cliente) o se carga a mano.
   - **WhatsApp al cliente apagado por defecto:** solo sale con `GUIONES_WHATSAPP=real`, después de la prueba controlada y el OK de RESPONSABLE_HUB.
5. **Respuesta del cliente (d03):** el webhook de Whapi (CONSULTOR) la reenvía a `/api/bot/guiones/respuesta`; también se puede pegar a mano en la pantalla. Queda como nota y la tanda pasa a `con_notas`.
6. **Corrección automática (d04):** el paso `notas` decide a qué guiones va cada nota (una nota general va a todos), los corrige en paralelo, deja las notas como aplicadas y vuelve a `a_revisar`. Avisa al grupo de guiones: «el cliente pidió cambios y ya están aplicados». RESPONSABLE_HUB o REVISOR_GUIONES dan el check de nuevo, y eso escribe la versión corregida en el Doc y avisa al cliente.

## Verificación por guion y check final (27/10/2026, aprobado por RESPONSABLE_HUB vía el orquestador)

- **Entrada:** Kickoff dispara `POST /api/bot/guiones {recording_id}` apenas la ficha queda «lista» con ideas, sin esperar la
  aprobación de las ideas. `crearTanda` es una por kickoff: un segundo disparo no duplica.
- **Por guion:** en `/guiones/<ID>` cada guion tiene «✓ Verificado» (RESPONSABLE_HUB o REVISOR_GUIONES; acción `verificar` de `/api/guiones/<id>`,
  `verificarGuion`). Se guarda en `guiones.<n>.verificado` {quien, email, cuando}. Editar un guion lo des-verifica.
- **Check final:** «✓ Check final: aprobar y mandar al cliente» se habilita con TODOS verificados y lo da UNA persona (RESPONSABLE_HUB o
  REVISOR_GUIONES, la que esté). `aprobarTanda` lo vuelve a exigir en la base (`faltanVerificar` en aprobadores.ts para el mensaje).
- **Corrección del cliente:** `aplicarCorrecciones` des-verifica SOLO los guiones que tocó la nota; los demás siguen verificados.
  Vuelve a a_revisar: verificar los corregidos y otro check final de una persona.

## El Doc del cliente: los guiones van en los chips (27/10/2026, pedido de RESPONSABLE_HUB)

Formato de los Docs «Guiones - X» (copias de «Plantilla Guiones - C.J»; mirado en CUENTA_QA, CUENTA_QA y CUENTA_QA):
- `TANDA N°` (encabezado 2) y, debajo, un renglón con viñeta por video: encabezado 4 «Video:» + un **chip desplegable** de
  estado (No iniciado / Para grabar / Grabado completo), plegable con la flechita. 5 chips por tanda.
- El guion va DEBAJO de su chip, en párrafos normales, por sección: «HOOK» en negrita · «Velocidad N» · «(indicación)»
  resaltada en rosa #f4cccc · el texto (el «(gesto con el dedo hacia abajo)» también resaltado) · renglón vacío. Sin título ni
  «para tener a mano».

Carga: acción `cargarEnChips` del Puente Drive (`docs/guiones/puente/GuionesChips.gs`, archivo aparte del proyecto de Apps
Script + una línea en el `switch` de `doPost` de Codigo.gs; lo publica CONSULTOR). El guion N va bajo el chip N de la
`TANDA N°` que elige el puente (tanda 0): la que ya cargó el bot con esa clave o la primera con todos los chips vacíos (el Doc de
CUENTA_QA CUENTA_QA, «Guiones - CUENTA_QA», ya tenía la TANDA 1° cargada a mano). Si falta el chip del 6.º, lo agrega copiando el último.
La tanda usada se guarda en `doc.tanda` y la nombra el WhatsApp al cliente. Solo escribe bajo chips vacíos o ya cargados por el
bot (rango con nombre invisible `cjg|<clave>|<n>`, clave estable `cj-guiones-<recording>-<tanda>`): una corrección reemplaza lo
suyo; si una persona ya escribió bajo un chip, frena sin tocar nada. **El valor del chip no se puede cambiar por script**
(queda «No iniciado»). Reemplaza a `agregarTanda` (que agregaba al final). Prueba real: `scripts/probar-chips.mjs <idTanda>`
contra el Doc «Guiones - PRUEBA BOT» (carpeta «PRUEBA BOT guiones chips», nunca un Doc de cliente). Pruebas:
`scripts/test-puente-chips.mjs`. **Prueba real del 27/10** (puente v6, VERSION 2026-10-27a, Doc «Guiones - PRUEBA BOT» con la tanda
de CUENTA_QA): 6 guiones en TANDA 1° con el 6.º chip agregado y su desplegable conservado («No iniciado ▾», visto en Chrome);
formato igual al de los Docs a mano; recarga = 6 reemplazados sin duplicar; en la última tanda del Doc también agrega el chip; con
otra clave frena («ya hay texto que no cargó el bot»).

### El chip pasa solo a «Para grabar» (31/10/2026)

Con el check final, después de cargar el Doc, `publicarParaEntrega` llama a `marcarParaGrabar` (acción `estadoChips` del Puente
Drive, `docs/guiones/puente/GuionesEstadoChips.gs`): los chips «Video:» de la tanda que usó `cargarEnChips` pasan de «No iniciado»
a «Para grabar». Apps Script (DocumentApp) no ve los chips desplegables; la Docs API sí (`ParagraphElement.dropdown` +
`updateDropdownProperties`), por el servicio avanzado `Docs` del puente (v8). Solo cambia los que están en «No iniciado» (nunca
baja un «Grabado completo») y es idempotente. Si falla, el Doc ya quedó publicado: se deja aviso en el log y se cambia a mano.
Probado el 31/10 en una copia de prueba de la plantilla: 6 chips cambiados, 0 en la segunda corrida, las otras tandas intactas.

### d05: los videos entran solos a Edición con el check final (01/11/2026)

Apenas los chips quedan en «Para grabar», `publicarParaEntrega` llama a `altaDesdeTanda` (`lib/bot/grabacion/altaDesdeGuiones.ts`):
arma el mismo texto que va a leer el vigía (`TANDA N°`, `* Video: Para grabar`, HOOK / Velocidad / (indicación) / texto), lo pasa
por `parsearDocGuiones` y `planDoc` (mismo freno de 10 por cliente, misma `EDICION_FECHA_CORTE`) y crea los videos en Esperando
crudos con clave `T<tanda>-V<n>`, origen `doc` y actor `bot (guiones)`. Antes Edición se enteraba al día siguiente y, si era la
primera lectura del Doc (cliente nuevo), la línea de base no creaba nada.
- **Idempotente:** `crearVideoSiFalta` no duplica `(id_crm, clave)`; la pasada del vigía reconoce los videos por huella o clave.
- **Reaprobación con correcciones:** actualiza el guion de los que todavía esperan crudos; los ya grabados quedan con aviso.
- **No toca** lo que guardó el vigía del Doc (`cj_grab_guiones`). Respeta `EDICION_MODO` (en dry no escribe). No manda mensajes.
- Solo corre si los chips pasaron a «Para grabar»; si se cambian a mano, los toma el vigía como siempre. Si falla, el Doc ya
  quedó publicado y se deja aviso en el log. Pruebas: `scripts/test-alta-desde-guiones.mjs`.

## Motor: plan Max en la Mac de RESPONSABLE_HUB (25/10/2026)
Decisión de RESPONSABLE_HUB («hagamos eso siempre»), después de gastar ~USD 20 de API en pruebas: las tandas NO se arman con la API.
- **Despacho:** la tanda nace en estado `pendiente` (`GUIONES_MOTOR`, por defecto `local`; con `api` vuelve al flujo por invocaciones). No dispara nada ni gasta.
- **Mac de RESPONSABLE_HUB:** `scripts/guiones-local.mjs`, que corre con launchd (`$APP_DIR`) cada 10 minutos. Logs en `$APP_DIR`.
  - Toma las tandas `pendiente` y `con_notas`, y las colgadas (estado de trabajo sin moverse más de 330 s).
  - Corre los mismos pasos de `proceso.ts` en el mismo proceso, en una cola de a 3.
  - Cada llamada a Claude sale por `claude -p` (`motor-cli.ts`: Opus 5.5, esfuerzo medio, `--json-schema`; el mercado con WebSearch/WebFetch). Los pide `GUIONES_LLM=cli`.
  - Usa `CLAUDE_CODE_OAUTH_TOKEN` (de `claude setup-token`, vale un año). Nunca le pasa a `claude` las claves de la API.
  - Hace falta Claude Code 2.1.280 o más nuevo: con la 2.1.228, Opus 5.5 daba 400.
- **Respaldo:** si una tanda pasa más de 2 horas en `pendiente`, RESPONSABLE_HUB o REVISOR_GUIONES ven «Armar con la API» en `/guiones/<id>`. Con la caché del contexto (`claude.ts`) sale ~USD 2.
- **Para retomar una tanda en error con el motor local:** «Retomar» la deja en su estado de trabajo y la Mac la toma cuando pasan 330 s sin moverse.

## Tabla `cj_guiones` (Neon, misma base que el kickoff)
- **Clave:** una fila por `(recording_id, tanda)`.
- **Columnas:**
  - `estado` (`mercado`, `plan`, `escribiendo`, `a_revisar`, `aprobada`, `enviada`, `con_notas`, `corrigiendo`, `error`);
  - `mercado` (markdown);
  - `plan`;
  - `guiones` (`{n: {guion, hallazgos, revision, estado, editado}}`);
  - `aprobacion`, `doc`, `whatsapp`, `notas`;
  - `aviso_discord`, `error`, tokens, `version`.
- La crean las escrituras; las lecturas no crean nada.

## Variables
- **Que ya existen:** `DATABASE_URL`, `BOT_ANTHROPIC_API_KEY` (o `ANTHROPIC_API_KEY`), `CRON_SECRET`, `DISCORD_WEBHOOK_KICKOFF`, `DISCORD_ID_TOMAS`, `KICKOFF_REVISOR_TOMI`, `PUENTE_DRIVE_URL` y `PUENTE_DRIVE_SECRETO`, `WHAPI_TOKEN`.
- **Nuevas:**
  - `GUIONES_REVISOR_FAUS`: mail de REVISOR_GUIONES para aprobar.
  - `DISCORD_ID_FAUS`: ya está en `.env.local`; falta en Vercel.
  - `WHAPI_GRUPO_COPYWRITING`: el grupo de guiones del equipo; ya está en `.env.local`, falta confirmar que esté en Vercel. Ahí van los avisos al equipo.
  - `DISCORD_WEBHOOK_GUIONES`: opcional; es el respaldo si no hay grupo de WhatsApp (si no está, usa #📝-kickoff).
  - `GUIONES_WHATSAPP=real`: solo cuando RESPONSABLE_HUB dé el OK.

## Archivos
- `lib/bot/guiones/`:
  - `tipos`, `revisar` (revisor mecánico), `formatos` (catálogo), `preferencias` (reglas de RESPONSABLE_HUB);
  - `prompt` (redactor, revisor y corrector), `generar` (plan, escribir y revisar, corregir), `ganchos` (tanda de ganchos para calibrar);
  - `mercado` (+ `kb/plantilla-mercado`);
  - `registro`, `proceso`, `servidor`, `envio`, `aprobadores`.
- **Rutas:** `app/api/bot/guiones/route.ts` (pasos), `app/api/bot/guiones/respuesta/route.ts` (WhatsApp del cliente) y `app/api/guiones/[id]/route.ts` (pantalla).
- **Pantalla:** `app/(shell)/guiones/[id]/`.
- **Pruebas:** `scripts/test-bot-guiones.mjs` (sin red ni base).
- **En seco:** `scripts/probar-tanda.mjs`, `probar-ganchos.mjs` y `rehacer-indicaciones.mjs` (solo `api.anthropic.com`).
- **Calibración:** el Taller de guiones (<URL_CONFIGURADA_PRIVADAMENTE>) y la investigación en `.cache/guiones/investigacion/`.
