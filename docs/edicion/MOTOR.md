> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Grabación y Edición · motor (bloque A: datos, vigía, transcripción, comparación y diario)

Pedido de RESPONSABLE_HUB (24/10/2026): el Despacho reemplaza a ClickUp en GRABACIÓN (e01–e05) y EDICIÓN (f01–f06). Relevamiento y
decisiones: `docs/RELEVAMIENTO-EDICION-CJ.md`. Este documento cubre el bloque A. La pantalla está en `docs/edicion/PANTALLA.md`
(bloque B) y los avisos en `docs/edicion/AVISOS.md` (bloque C).

**Estado:** hecho y probado con juguetes en la copia `$APP_DIR`. Sin commit, sin deploy, sin tocar bases reales.

## Dónde se carga cada secreto (lo que preguntó RESPONSABLE_HUB)

Ninguno de estos secretos se saca de un servicio, salvo la key de AssemblyAI y el webhook de Discord. Los dos secretos propios
se generan en la Mac. Conviene generar cada uno **una sola vez** y cargarlo en todos los lugares con un solo comando. Van en
**hexadecimal**: no traen `+`, `/` ni `=`, así que no dan problemas de comillas en `.env` ni en las cabeceras.

| Secreto | Dónde se crea | Dónde se pega |
|---|---|---|
| `VIGIA_SECRETO` | En la Mac, con el comando de abajo | `$APP_DIR`, Vercel (Production) y Apps Script (propiedad del script) |
| `ASSEMBLYAI_WEBHOOK_SECRETO` | En la Mac, con el mismo comando (sin `pbcopy`). **No se crea en AssemblyAI**: el Despacho lo manda en cada pedido (`webhook_auth_header_value`) y lo controla cuando vuelve el aviso | `.env.local` y Vercel |
| `ASSEMBLYAI_API_KEY` | En AssemblyAI, en la sección de API keys | `.env.local` y Vercel |
| `DISCORD_WEBHOOK_EDICION` | En Discord: #✂️-edicion → Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL | `.env.local` y Vercel |

`VIGIA_SECRETO`, desde la Terminal de la Mac (queda en `.env.local`, en Vercel y en el portapapeles, sin mostrarse):

```bash
S=$(openssl rand -hex 32); printf '\nVIGIA_SECRETO=%s\n' "$S" >> $APP_DIR (cd $APP_DIR && printf %s "$S" | vercel env add VIGIA_SECRETO production); printf %s "$S" | pbcopy; unset S
```

Después, en Apps Script (cuenta CUENTA_GOOGLE_OPERADORA_CONFIGURADA, proyecto "Puente Drive · Despacho"): **⚙ Configuración del proyecto →
Propiedades de la secuencia de comandos → Agregar propiedad**, nombre `VIGIA_SECRETO`, valor: pegar (cmd+V) y **Guardar**. Es
el mismo lugar donde ya está `SECRETO`, que no se toca.

`ASSEMBLYAI_WEBHOOK_SECRETO`, igual pero sin el portapapeles:

```bash
S=$(openssl rand -hex 32); printf '\nASSEMBLYAI_WEBHOOK_SECRETO=%s\n' "$S" >> $APP_DIR (cd $APP_DIR && printf %s "$S" | vercel env add ASSEMBLYAI_WEBHOOK_SECRETO production); unset S
```

- **Por qué el puente no usa `CRON_SECRET`:** ese secreto también abre `/api/raw`, que tiene teléfonos. Si el Apps Script se
  filtrara, con `VIGIA_SECRETO` solo se puede disparar el vigía.
- **Largo:** `VIGIA_SECRETO` y `ASSEMBLYAI_WEBHOOK_SECRETO` de menos de 32 caracteres cuentan como mal configurados (el vigía
  responde 503 al puente; el webhook, 503). A `CRON_SECRET` no se le exige largo: lo usan otros 11 crons.
- **"Creo que la había armado":** el código del vigía va en un archivo NUEVO del proyecto de Apps Script, `Vigia.gs` (lo arma
  el bloque C en `docs/edicion/puente/Vigia.gs`), no al final de `Codigo.gs` (ese es de la sesión del alta). `probarVigia`
  dice si la propiedad está cargada y lista los disparadores del proyecto (función y cantidad): ahí se ve si quedó uno armado a
  mano que apunte a otra función. `instalarDisparadorVigia` borra los de `dispararVigia` y deja uno solo.
- **Cuándo:** los secretos se pueden cargar ya. El disparador del puente se instala **después** de pasar a `EDICION_MODO=real`
  (no alcanza con el deploy): en dry el vigía no guarda nada, así que cada 15 minutos volvería a leer todo sin avanzar.
  No hace falta "Nueva versión" del puente: el disparador corre el código guardado (y publicar subiría también lo pendiente del
  alta).

## Puesta en marcha, por etapas

1. Deploy desde `$APP_DIR` (lo hace la sesión dueña). Variables en Vercel: las de la tabla, `EDICION_EQUIPO_DRIVE`
   (mails o `@dominios` del equipo, separados por coma), `EDICION_REVISOR_AYLU`, `EDICION_EDITOR_RENE`, `EDICION_FECHA_CORTE`
   (AAAA-MM-DD, la decide RESPONSABLE_HUB).
2. Prueba en seco contra producción:
   `curl -s -X POST '${AUTH_BASE_URL}/api/bot/grabacion/vigia -H "Authorization: Bearer $CRON_SECRET" | jq`
   y `curl -s '${AUTH_BASE_URL}/api/bot/grabacion/diario -H "Authorization: Bearer $CRON_SECRET" | jq`.
3. Importar los videos de ClickUp (`scripts/edicion-importar-clickup.mjs`, bloque C) el mismo día, antes del primer diario real.
4. **Modo sombra, 1 o 2 días:** `EDICION_MODO=real` + `EDICION_AVISOS=dry` y **sin** `ASSEMBLYAI_API_KEY`. Se escribe en Neon
   (la primera escritura crea las tablas), los avisos quedan en `/edicion/avisos` sin salir a Discord y no se transcribe nada.
   Instalar el disparador del puente (`instalarDisparadorVigia`). COORDINACION confirma los vínculos en `/edicion/vinculos`.
5. Avisos reales: sacar `EDICION_AVISOS=dry`.
6. Transcripción: cargar `ASSEMBLYAI_API_KEY`. Lo que quedó `pendiente` durante el modo sombra y tiene más de 48 horas pasa a
   `vieja` en el primer envío (`enviarPendientes`) y no se manda: sus tandas ya se avisaron. Lo de las últimas 48 horas sí se
   transcribe (sirve para las próximas comparaciones de esa tanda del guion).
7. Antes de pasar a real, revisar las horas de cómputo del plan de Neon (neon-almond-planet): el vigía cada 15 minutos la
   mantiene despierta cerca de un tercio del horario de trabajo.

## Archivos

| Archivo | Qué es |
|---|---|
| `lib/edicion/tipos.ts` | El contrato (tipos y constantes; congelado: lo nuevo va como campo opcional) |
| `lib/edicion/estados.ts` | La máquina de estados: `TRANSICIONES`, `puede()`, `accionesPara()`, `TOPE_RONDAS_CLIENTE` |
| `lib/edicion/config.ts` | Números (cierre de tanda, margen, umbrales de trabados, topes), `modoEdicion`, `avisosReales` |
| `lib/edicion/db/base.ts`, `migracion.ts` | Conexión (`consulta`, `leer`, `asegurarTablas`, `sqlParaPruebas`) y esquema versionado |
| `lib/edicion/db/videos.ts` | Videos, eventos, notas y pedidos del cliente (P6), con versión y evento en la misma sentencia |
| `lib/edicion/db/archivos.ts`, `tandas.ts`, `carpetas.ts`, `guiones.ts`, `seguimientos.ts`, `corridas.ts`, `clientes.ts` | El resto del repositorio |
| `lib/edicion/db/filas.ts`, `index.ts` | Filas → tipos (nunca se lee el mail del actor) e índice |
| `lib/bot/grabacion/drive.ts` | Lector de Drive (inyectable): `listarCambios`, `listarArbol`, `carpetasClientes`, `exportarTexto` |
| `lib/bot/grabacion/tandas.ts` | `inferirUbicacion` (carpeta / nombre) y `agrupar` (hueco de 45 minutos), puros |
| `lib/bot/grabacion/guiones.ts` | `parsearDocGuiones` y `planDoc` (línea de base, altas, freno), puros |
| `lib/bot/grabacion/vigia.ts` | `correrVigia`, `pasadaCompleta`, `procesarArchivos`, `cerrarTandas`, `compararTanda`, `procesarDoc` |
| `lib/bot/grabacion/assemblyai.ts`, `transcripcion.ts`, `palabrasClave.ts` | Transcripción: cliente, envío, webhook, barrido |
| `lib/bot/grabacion/comparar.ts`, `compararClaude.ts` | Cruce simple (puro) y Claude solo para lo dudoso |
| `lib/bot/grabacion/seguimiento.ts` | `calcularE01` (puro) e `iniciarTanda` ("guiones enviados", lo usa la pantalla) |
| `lib/bot/grabacion/diario.ts` | Fases del diario, `videosTrabados`, `armarResumen`, `retomarDiario`, `correrDiario` |
| `lib/bot/grabacion/acceso.ts` | Quién puede llamar a las rutas propias (puro) |
| `lib/bot/grabacion/servidor.ts` | Dependencias reales |
| `lib/bot/grabacion/fuenteAltas.ts` | Vínculos desde `cj_altas`: devuelve `[]` hasta acordar las columnas con la sesión del alta |
| `app/api/bot/grabacion/vigia/route.ts` | POST (puente o a mano) y GET de estado |
| `app/api/bot/grabacion/transcripcion/route.ts` | Webhook de AssemblyAI |
| `app/api/bot/grabacion/diario/route.ts` | Cron diario (`0 10 * * *`, 7:00 de Argentina) |
| `scripts/edicion-esquema.mjs --imprimir` | Imprime el DDL sin conectarse |
| `scripts/edicion-juguetes.mjs` | Juguetes de los tests (Neon falso, repositorio en memoria) |

## Modo dry

`EDICION_MODO` vale `real` o, por defecto, `dry`. En dry el vigía y el diario no abren corrida ni escriben en Neon, no llaman
a AssemblyAI, Claude ni Discord, y devuelven el plan. `?dry=1` lo fuerza en las tres rutas. `EDICION_AVISOS=dry` deja Discord
en silencio aunque el modo sea real. El webhook en dry responde 200 con lo que haría.

Con `EDICION_MODO` distinto de `real`, el POST del puente al vigía responde 202 y no hace nada.

## Datos (Neon, tablas `cj_*` que crea la primera escritura)

Migración versionada (`cj_edicion_esquema`): si ya está en la versión, no corre ningún DDL; si no, todo en una transacción con
`CREATE … IF NOT EXISTS`. La carrera entre dos arranques en frío (23505 / 42P07) se reintenta una vez. Las migraciones futuras
son solo aditivas. Solo las escrituras migran; las lecturas devuelven vacío si la tabla no existe.

| Tabla | Para qué | Unicidad que importa |
|---|---|---|
| `cj_grab_carpetas` | Árbol de cada cliente: carpeta del cliente (vínculo con el CRM), raíces y subcarpetas; `vigilar`, `consultada` | `drive_id` |
| `cj_grab_archivos` | Crudos, editados y marca; inferencia; vínculo con el video; estado de la transcripción | `drive_id`, `tr_id` |
| `cj_grab_transcripciones` | Texto y palabras con tiempos (aparte, para no arrastrar ~100 KB por crudo) | `archivo_id` |
| `cj_grab_tandas` | Tandas de subida y el resultado de la comparación | una abierta por cliente y tipo (índice parcial) |
| `cj_grab_guiones` | Último texto leído de cada doc (línea de base) | `doc_id` |
| `cj_grab_corridas` | Corridas del bot y fases del diario | una `corriendo` a la vez (índice parcial = candado) |
| `cj_grab_seguimientos` | Pasos de e01 | `(id_crm, ciclo, escalon)` |
| `cj_videos` | Un video por fila | `(id_crm, clave)`, `clickup_id` |
| `cj_video_eventos` | Historial; el mail del actor queda solo acá (auditoría, nunca se lee) | — |
| `cj_video_notas`, `cj_video_pedidos` | Notas de corrección y pedidos del cliente (f05) | — |
| `cj_marca`, `cj_edicion_avisos` | Ficha de marca y cola de avisos (el SQL lo escribe el bloque C) | `id_crm`; `base` pendiente única |
| `cj_edicion_clientes` | Marcas por cliente: `graba_equipo` (afuera de e01). También vale `EDICION_GRABA_EQUIPO` | `id_crm` |

## Vigía (cada 15 minutos, por el Puente Drive)

1. Abre la corrida (candado). Si hay otra en curso, se saltea.
2. Consulta las carpetas con `vigilar`, de la consultada hace más tiempo a la más reciente, 8 en paralelo, con
   `'<id>' in parents and createdTime > '<consultada − 120 min>' and trashed=false` (lo probado en el relevamiento; lo movido
   o modificado lo ve la pasada completa). Una carpeta nunca consultada se lista entera. Las subcarpetas nuevas se recorren en
   la misma corrida hasta 4 niveles.
3. Corta 60 segundos antes del plazo (`MARGEN_DEADLINE_MS`: después todavía corren los avisos) y deja el resto para la próxima
   (lo no consultado conserva su fecha y no se pierde nada). Un paso que puede tardar (export de un doc, envío a AssemblyAI) no
   arranca si quedan menos de 35 segundos. Las subcarpetas nuevas que no se alcanzan a recorrer se guardan igual, vigiladas y
   con `consultada` vacía: la próxima corrida las lista enteras. La corrida se cierra **antes** del despacho a Discord.
   Las subcarpetas que ya se vigilan no se vuelven a bajar desde la carpeta de arriba (se consultan por su cuenta).
4. Guarda los archivos: **uno por `drive_id`** (el mismo archivo puede llegar por dos caminos y un upsert con el id repetido da
   21000 en Postgres; antes tiraba la corrida entera para todos los clientes). Lo mismo con las carpetas y las consultas. Quién
   subió se reduce a cliente / equipo / desconocido y el mail se descarta en el lector. Los creados hace más de 48 horas la
   primera vez que se ven quedan `vieja`, sin tanda ni aviso. Un archivo movido a otra raíz (Crudos ↔ Editados) o a la carpeta
   de otro cliente toma el tipo y el cliente nuevos y suelta su video, su propuesta y su tanda (un editado que deja de serlo
   suelta también el link del video).
5. Arma las tandas (hueco de 45 minutos), vincula los crudos por carpeta o nombre ("Tanda 1 / Video 4", "video 4", "T2V4") y
   propone los editados nuevos de "Editados - X". Si la carpeta ni el nombre dicen la tanda, el número solo vincula a un video
   que espera ese tipo de archivo; y un archivo creado más de 21 días antes que el video no se vincula solo (los históricos de
   la primera pasada). Un crudo vinculado **fuera** de una tanda abierta (COORDINACION lo ordenó en Drive, o es viejo de la pasada
   completa) mueve su video ahí mismo.
6. Cierra la tanda cuando pasaron 45 minutos desde su último archivo **y** todas las carpetas vigiladas del cliente se
   consultaron después de `hasta` + 45 minutos (pasadas 6 horas, se cierra igual). Mueve con `llegaron_crudos` los videos con
   crudos vinculados. La comparación vuelve a mirar los crudos vinculados de su tanda: una tanda que cerró `asignarATanda` por
   el hueco de 45 minutos también mueve sus videos. Un video que volvió a esperar por un pedido de regrabación solo se mueve con
   crudos posteriores al pedido.
7. Transcripciones (enviar y barrer), comparación de las tandas listas, fases del diario que falten, aviso de vigía callado
   (más de 2 horas de horario de trabajo sin corrida) y despacho de los avisos (bloque C).

Solo procesan las carpetas con vínculo `alta`, `aylu`, `tomas` o `bot` (este último, solo si el nombre normalizado coincide
exacto con un único cliente del CRM). Las `a_confirmar` se listan en `/edicion/vinculos` y a COORDINACION le llega un aviso una vez por
carpeta.

## Pasada completa (la corre el diario)

Lista las carpetas de clientes, cruza con el CRM (solo lectura), guarda vínculos y raíces, recorre el árbol de cada raíz de los
clientes ACTIVOS con vínculo que procesa (hasta 4 niveles), guarda lo nuevo y lo movido (se vuelve a inferir solo lo que asignó
el bot), marca los borrados (al final, con TODAS las raíces ya guardadas y contra lo visto en todas: un archivo movido de Crudos a
Editados o de un cliente a otro no queda "borrado"; solo raíces listadas enteras y nada si la pasada se cortó por tiempo; un crudo
borrado de un video sin aprobar deja el bloqueo `crudo_borrado` y avisa), recalcula `vigilar` (raíces de los activos, subcarpetas con actividad en 45 días y todo Crudos de los clientes con
videos esperando crudos o para regrabar) y lee los docs de guiones que cambiaron.

**Docs de guiones:** la primera lectura es la línea de base (no crea videos; solo vincula los guiones a los importados de
ClickUp, por clave o por el gancho). Después crea video el guion que pasa a "Para grabar", desde `EDICION_FECHA_CORTE`; lo que
pasa ANTES del corte queda pospuesto (se guarda con su estado de antes y con la fecha de modificación vieja, así la pasada vuelve
a exportar el doc y desde el corte lo ve pasar y lo crea). Más de
10 altas de un cliente en una pasada → no se crea ninguna y se avisa. Un guion que cambió: con el video esperando crudos se
actualiza; si ya se grabó, va como aviso.

## Transcripción (P5)

AssemblyAI con el link de descarga de Drive, idioma `es`, `speech_models` (lista en orden de preferencia: `ASSEMBLYAI_MODELO`
separado por comas; por defecto `universal-3-5-pro` y `universal-2` de respaldo; `speech_model` en singular está deprecado; si
AssemblyAI rechaza el modelo se reenvía una vez sin modelos y queda anotado) y `keyterms_prompt` con las palabras clave de la ficha del kickoff más una base fija (ART, ANSES, indemnización…). **Nunca el
guion ni un prompt.** El `webhook_url` lleva `?archivo=<id>` y la cabecera `X-Edicion-Secreto`.

- Más pesado que `TOPE_BYTES_TRANSCRIPCION` (4,9 GB, o `ASSEMBLYAI_MAX_BYTES`) → `grande` (plan B, solo documentado: subirlo desde
  Vercel, o faster-whisper en la Mac o la VPS) y aviso.
- El mismo crudo subido dos veces no se transcribe de nuevo. Tope de 180 minutos por día: sin duración de Drive se estima por el
  peso a la baja del peso por minuto (video 60 MB/min, audio 0,5 MB/min: sobreestima) y al guardar se anota la duración real. Uno
  que no entra hoy se saltea sin frenar la cola; uno más largo que el tope entero (una grabación de Zoom de 3 horas) pasa a
  `grande` (plan B) y avisa. Un pendiente de más de 48 horas pasa a `vieja`.
- Si AssemblyAI rechaza las palabras clave, se reenvía una vez sin ellas.
- El webhook guarda la transcripción y la **borra en AssemblyAI** apenas se guarda. Si el borrado falla, lo reintenta el vigía.
  Un error de descarga queda como `link_privado` y avisa. Una transcripción desconocida con `?archivo=` se adopta (si el archivo
  no tiene otra) o se borra en AssemblyAI (si ya tiene otra). El webhook compara solo con el cruce simple: Claude lo hace el vigía.
- El diario lista las transcripciones de AssemblyAI de las últimas 48 horas y borra las que no se guardaron o que ya están guardadas.

**Pendiente al tener la key:** confirmar con un pedido real los identificadores (`universal-3-5-pro`, `universal-2`), el campo de
las palabras clave (`keyterms_prompt`) para español y si AssemblyAI reintenta el webhook (el diseño no depende de eso: el vigía
barre lo colgado). El modelo que corrió se lee de `speech_model_used`.

## Comparación con los guiones (e03)

Por **tanda del guion**: contra todos los crudos del cliente desde que empezaron esos guiones, no solo contra la subida. Cruce
simple (LCS por frase sobre ventanas de hasta 1,3 × su largo: 0,85 presente; 0,6 dudosa). Cada crudo va al guion que dicen su
carpeta o su nombre; si no, al guion donde caen más frases; si empata, queda sin ubicar. Claude (el del kickoff, esfuerzo medium,
16.000 tokens, tope 120 s, schema sin nulls) solo para los guiones con frases dudosas y solo si quedan 150 segundos o más; si no,
queda para la próxima corrida. A Claude van ventanas de ±20 s alrededor de CADA aparición de las palabras clave, las de más palabras
distintas primero, hasta 6.000 caracteres (una toma larga del primer crudo ya no deja afuera a la buena del segundo); un guion sin
fragmentos no se le pregunta. Si la comparación falla, la tanda vuelve a `cerrada`; una que quedó `comparando` más de 10 minutos
(la función se cortó) la retoma la corrida siguiente. El aviso de la tanda sale una vez, con el resultado final. Claude nunca pasa
un video a Para editar.

## Diario (cron `0 10 * * *` y lo que retoma el vigía)

Fases que se pueden retomar (`diario:<ymd>:<fase>` en las corridas): `completa`, `e01`, `resumen`, `huecos`, `colgadas`. El
resumen sale solo martes a viernes hábiles (la daily es a las 8:30), desde las 7:45 de Argentina, una vez, y necesita el e01 del
día. Como el cron de Hobby corre en algún momento entre las 7:00 y las 7:59, normalmente lo manda la primera corrida del vigía
después de las 7:45. El vigía solo retoma la pasada completa si ya son las 9 y le quedan 120 segundos.

**e01 (P2):** un ciclo por cliente; dia0 (COORDINACION) el día del inicio o el primer hábil; dia2 y dia4 (COORDINACION) y dia9 (RESPONSABLE_HUB) en días
hábiles contados DESDE EL DIA0 (un ciclo que arranca un sábado no se comprime). Si el ciclo lo abrió un envío con constancia
(pedido de regrabación o "guiones enviados"), el dia0 nace hecho; un pedido de regrabación manda sobre cómo nació el video. Si RESPONSABLE_HUB
decide "seguir", un recordatorio cada 4 días hábiles. No avanza si después del inicio llegaron crudos del cliente que siguen sin
ubicar (queda "ubicar crudos" para COORDINACION). Un regrabar con el ciclo abierto suma sus videos sin reiniciar. Los importados arrancan
en la fecha de corte. Quedan afuera los clientes que graba el equipo. "Pausar" en el día 9 pausa los videos del ciclo que siguen
esperando y cancela el ciclo, en la misma sentencia. El texto lo arma la vista (`textoE01`, bloque C) y se guarda al marcar "hecho".

**Trabados:** horas hábiles (crudo_a_revisar, editado y corregido: 24 h, COORDINACION; para_editar y corrección: 24 h, EDITOR; regrabar:
1 día hábil; con el cliente: 3 días hábiles).

## Rutas

| Ruta | Quién | Qué |
|---|---|---|
| `POST /api/bot/grabacion/vigia` | `Bearer VIGIA_SECRETO` (puente) o `Bearer CRON_SECRET` (a mano) | 202 enseguida y trabaja en `after()`. `?dry=1`: el plan en el momento. `?tipo=completa`: la pasada completa (solo con `CRON_SECRET`) |
| `GET /api/bot/grabacion/vigia` | `Bearer CRON_SECRET` | Variables (sí/no, nunca el valor), últimas corridas y contadores |
| `POST /api/bot/grabacion/transcripcion` | `X-Edicion-Secreto` | Webhook de AssemblyAI; 200 rápido y trabajo en `after()` |
| `GET /api/bot/grabacion/diario` | `Bearer CRON_SECRET` (cron de Vercel) | Las fases que falten; `?dry=1` a mano |

Las tres son `propio` en `lib/auth/rutas.ts` y están fuera del matcher de `proxy.ts` (integración del bloque B).

## Variables del bloque A

`DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `DRIVE_CARPETA_CLIENTES`, `SHEET_ID_CLIENTES`, `CRON_SECRET`,
`VIGIA_SECRETO`, `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_WEBHOOK_SECRETO`, `ASSEMBLYAI_MODELO`, `ASSEMBLYAI_BASE`, `ASSEMBLYAI_MAX_BYTES`,
`EDICION_EQUIPO_DRIVE`, `EDICION_MODO`, `EDICION_AVISOS`, `EDICION_FECHA_CORTE`, `EDICION_GRABA_EQUIPO`,
`BOT_ANTHROPIC_API_KEY`/`ANTHROPIC_API_KEY`, `KICKOFF_MODELO`, `DESPACHO_URL`.

## Tests (sin red ni base: Neon falso, repositorio en memoria, Drive y AssemblyAI de juguete)

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-estados.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-db.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-vigia.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-guiones.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-transcripcion.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-comparar.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-diario.mjs
```

El SQL se probó contra un Neon falso (forma de las sentencias, guardas de versión, candados): **no se ejecutó contra un Postgres
real**. La primera escritura en modo sombra es la que lo valida; si algo falla, el error llega a RESPONSABLE_HUB y no se escribe nada a medias
(cada cambio de video es una sola sentencia).

## Pendientes y riesgos

- `cj_altas` no existe en esta copia: `fuenteAltas.ts` devuelve `[]` hasta acordar las columnas con la sesión del alta.
- Importación (bloque C): si un importado choca por `(id_crm, clave)` con un video del doc todavía esperando crudos sin acciones
  de personas, se completa con `actualizarVideo` (id de ClickUp, prioridad, gancho vacío y link al editado; el guion del doc
  manda). Con el `clickup_id` guardado, la carga siguiente lo reconoce y no repite el evento.
- La marca "graba el equipo" no tiene pantalla: por ahora `EDICION_GRABA_EQUIPO` o `marcarGrabaEquipo` (db/clientes.ts).
- Para confirmar con COORDINACION: qué significa "revisión", por dónde le entrega EDITOR, los criterios de "duro" y si los clientes usan el
  chip "Grabado completo".
- El conteo de crudos de `/guiones` (`lib/clientes/drive.ts`, de otra sesión) sigue bajando un solo nivel. Más adelante se puede
  alimentar desde `cj_grab_archivos`.
