> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot Capital Jurídico · etapa Kickoff (Fathom → ficha → ideas de guiones)

Pedido de RESPONSABLE_HUB (24/10/2026), tareas c01 a c06 del doc "Sistema de tareas - C.J". Después de la llamada de kickoff (la hacen RESPONSABLE_HUB o COORDINACION, cada uno con su Fathom), Claude arma la **ficha de kickoff** del cliente y propone 5 **ideas de guiones**. La ficha reemplaza la tarjeta de ClickUp "Seguimiento de Anuncios". Además, el bot **chequea el portfolio del cliente en Meta** (solo lectura) y lo cruza con lo que se dijo en la llamada.

Decisiones de RESPONSABLE_HUB (24/10):
- La ficha vive en la base del Despacho (Neon, tabla propia `cj_kickoffs`), **no** en columnas del CRM de Clientes.
- El aviso "ideas de guiones para revisar" para RESPONSABLE_HUB (RESPONSABLE_HUB) y COORDINACION (CUENTA_QA Mozzi) va por **Discord** hasta que exista el bot de WhatsApp: canal privado **#📝-kickoff** (`DISCORD_WEBHOOK_KICKOFF`), mencionando a RESPONSABLE_HUB (`DISCORD_ID_TOMAS`) y a COORDINACION (`DISCORD_ID_GERO_M` = 1, **confirmado**: es el usuario `ggeroo`, sacado de Discord el 24/10).
- Las kickoffs las hacen **RESPONSABLE_HUB y COORDINACION**, cada uno con su Fathom: la ficha anota quién la hizo (`grabo`) y el aviso lo dice.
- El chequeo del portfolio por Meta va **siempre**. Un portfolio comercial **sin verificar** cuenta como **ok con la nota**: no frena nada.
- El dominio del Despacho es `${AUTH_BASE_URL}/`. El viejo `dashboard-metricas-eight` sigue andando, pero no va en links nuevos.

Estado (24/10, tarde):
- **Publicado el 24/10 en el deploy `ovc3cbtre`**: la ficha de kickoff (`lib/bot/kickoff/*`, `/api/bot/kickoff`, `/api/clientes/[id]/kickoff` y la pantalla `/clientes/[id]/kickoff`). Prueba real con la kickoff de CUENTA_QA (grabación 1, Z002): la fila está en Neon (`cj_kickoffs`, estado `lista`) y el aviso salió en Discord. Prompts `k3-2026-10-24` e `i3-2026-10-24`.
- **Hecho después del deploy, SIN publicar** (sin commit ni deploy): la zona desde el video integrada al bot (ver "Zona desde el video"), la deduplicación de una kickoff grabada por los dos (ver "La misma kickoff grabada por los dos"), la columna `grabador` (qué cuenta de Fathom firmó) y el aviso sin cortes a mitad de frase (ver "Aviso de Discord" → "Largo"). Las migraciones son aditivas y toleran la fila de CUENTA_QA: ver "Dónde se guarda".
- **Tercera revisión (24/10, tarde, dos revisores: código y producto), también SIN publicar:** ver "Tercera revisión del 24/10". Prompt del mapa `m3-2026-10-24` (los de la ficha y las ideas siguen `k3` e `i3`).
- **27/10 (RESPONSABLE_HUB, por el Hub de Clientes): la tanda de guiones arranca SOLA cuando la ficha queda «lista» con ideas** (procesar.ts paso 13 → `disparo-guiones.ts`: POST `/api/bot/guiones {recording_id}` con Bearer CRON_SECRET, espera solo el 202, nunca lanza; no en dry, ni sin ideas, ni si no es kickoff; la ruta de guiones es idempotente, así que retomar o forzar no arma otra tanda). `KICKOFF_GUIONES=0` lo apaga. Aprobar o pedir cambios en la ficha ya NO dispara nada: queda como comentario y aviso; la revisión humana pasa a los guiones (verificación por guion y un check final de una persona, en la etapa Guiones). El aviso de #📝-kickoff dice «✍️ Los guiones ya se están escribiendo… comentalas en la ficha».
- **26/10 (RESPONSABLE_HUB, por CONSULTOR): el «🚀 Para lanzar» a ADS ya NO sale en la kickoff.** «Cuando llega al para lanzar es con los videos ya editados»: lo manda g01 (lib/bot/anuncios/videos.ts) cuando aparecen los videos en «Editados - X». `KICKOFF_AVISO_ADS` pasó a apagado por defecto (solo `=1` lo prende): sin aviso al marcar la ficha lista, sin barrido, sin el ✅ de ideas aprobadas a ADS, y el modo manual `aviso_ads` responde apagado. fathom-anuncios sigue salteando las kickoffs siempre (antes dependía de este interruptor). La ficha sigue en la pantalla y en el tablero para que ADS prepare la campaña. Lo de abajo sobre el aviso «prendido» queda como historia.
- **24/10, noche:** según el pedido del aviso a ADS, producción está en el deploy `kkw8gxnx5` (ficha, aviso a #📝-kickoff y lectura del mapa asincrónica activos). Lo nuevo de la noche, el **aviso a ADS en #📣-ads** (ver "Aviso a ADS"), está hecho y probado con fakes, **sin commit ni deploy**, con la revisión de la noche aplicada (ver "Cuarta revisión del 24/10"). **Ojo: sale PRENDIDO apenas se deploya** (`DISCORD_WEBHOOK_ANUNCIOS` ya está en Vercel): la primera kickoff después del deploy ya le escribe a ADS, salvo `KICKOFF_AVISO_ADS=0`.

## Qué hace

1. Fathom termina de procesar una grabación (de RESPONSABLE_HUB o de COORDINACION) y manda el webhook "new meeting content ready" a `POST /api/bot/kickoff`. Es un webhook **aparte** del de `/api/fathom-anuncios`, con otro secreto y otra tabla, sobre las mismas grabaciones.
2. La ruta verifica la firma (Standard Webhooks) contra el secreto de cada cuenta de Fathom (`FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS`, `_GERO_M` y el de compatibilidad: ver "Varios Fathom (RESPONSABLE_HUB y COORDINACION)"), valida el payload (solo `url` de fathom.video) y responde `200` enseguida. El resto corre en `after()` (hasta 300 s, contados desde que llegó el pedido).
3. Se reclama la grabación en `cj_kickoffs` por `recording_id`, con el payload guardado para poder reintentar, la cuenta de Fathom que firmó (`grabador`) y la clave de la reunión (horario, título del evento y huellas de los mails de los invitados externos). Si ya se procesó, no se repite.
   - **La misma kickoff grabada por los dos:** si ya hay una fila ANTERIOR de la misma reunión (la grabó el otro, con OTRA cuenta de Fathom), esta queda `duplicada` con `duplicada_de` = la primera, sin Claude ni aviso. Una grabación que no se va a procesar (sin transcripción o cortada) no busca gemela ni le gana a la otra. Ver "La misma kickoff grabada por los dos".
4. Sin transcripción → `error` con un aviso a RESPONSABLE_HUB (una vez): hay que activar Transcript en el webhook. Menos de 6 renglones o menos de 3 minutos → `omitida`, sin Claude. Una kickoff recuperada por la API de Fathom con la transcripción vacía (todavía no lista) o con horas ilegibles NO llega acá: `armarPayload` responde 502 y se reintenta en unos minutos (si no, quedaba `omitida` para siempre).
5. Mientras Claude lee la llamada, ya se piden en paralelo los **ganadores de Meta** de la rama probable (sale del resumen de Fathom o de la transcripción con `clasificarRama`) y se **precalienta el descubrimiento de cuentas** del tablero (`prepararPortfolio`: lo lento del portfolio, unos 9 s en frío).
6. CRM (solo lectura) + **Claude, extracción** (Opus 5.5, esfuerzo `high`) → ficha base. Se guarda apenas sale.
7. Si la llamada no es un kickoff (seguimiento, venta, equipo, otra) → `no_kickoff`: queda la ficha, sin ideas, ni portfolio, ni aviso.
8. En paralelo, después de la extracción:
   - el **portfolio en Meta** (ver "Portfolio de Meta en la ficha"): busca la cuenta del cliente y chequea los 7 ítems, con un tope de **15 s**. Corre también en `dry`, porque es lectura;
   - los **ganadores** de la rama de la ficha, con un tope de **8 s**. Se sacan las cuentas del propio cliente: las del CRM **y las que encontró la búsqueda del portfolio** (a CUENTA_QA su cuenta solo aparece por el descubrimiento).
   Si Meta falla o tarda, se sigue sin ganadores y con el portfolio "Meta no pudo leer la cuenta" (manda lo de la llamada), anotado en los ajustes.
9. **Claude, ideas** (esfuerzo `medium`) con la ficha, los ganadores (sin el nombre del otro cliente) y la base de conocimiento de la rama (`lib/bot/kickoff/kb/`). Se guardan apenas salen.
10. **Ficha final** con el portfolio de Meta cruzado con la llamada, **aviso de Discord** a RESPONSABLE_HUB y COORDINACION, una sola vez (el id del mensaje queda anotado), y estado `lista`. El payload se borra.
11. **Zona desde el video** (si la ficha dice que la zona se marcó en un mapa en pantalla y tiene el minuto en que se habló de la zona): el video se le pidió a Fathom apenas salió la ficha (paso 6, sin esperar); con la ficha `lista` se dispara `/api/bot/kickoff/mapa`, que lo mira en otra invocación y guarda el bloque del mapa en `zona_video` (un error pasajero se reintenta una vez solo). Mientras tanto la pantalla dice que lo está leyendo el bot y se actualiza sola. Ver "Zona desde el video" → "Integración con el bot".

12. **Aviso a ADS** (#📣-ads, mencionándolo): lo que necesita para lanzar la campaña, una sola vez por grabación. Sale enseguida o, si se está leyendo el mapa del video, cuando la lectura termina. Ver "Aviso a ADS".

Si algo falla: `error` con el motivo (lo que ya salió queda guardado) y **un** aviso corto a RESPONSABLE_HUB en el mismo canal. Un paso con error pasajero (Claude 429/5xx/529, Neon sin respuesta) se reintenta una vez dentro de la misma ejecución.

Al retomar:
- Se reusa la ficha si es de la misma versión del prompt.
- El portfolio se vuelve a chequear **siempre** (es barato y puede haber cambiado). Sus ajustes viejos no se arrastran (prefijo `portfolio en Meta:`).
- Las ideas se reusan **solo si también se reusó la ficha** (y son de la misma versión de ideas). Si la ficha se volvió a extraer, las ideas viejas podrían ser de otra rama.
- El aviso no se repite. Si Discord publicó pero la base no anotó el id, la fila queda en `error` con el prefijo `aviso_enviado:<id>`; un reintento lo toma como salido y solo lo anota. A RESPONSABLE_HUB le llega "el aviso ya salió, no hace falta reintentar".
- Discord **no** se reintenta desde el orquestador: `enviarDiscord` ya reintenta 429 y 5xx, y un timeout puede haber publicado igual. En ese caso a RESPONSABLE_HUB le llega que el aviso es dudoso y que mire el canal antes de reintentar.
- Si ni siquiera se pudo reclamar la grabación (base caída), el aviso a RESPONSABLE_HUB dice que no quedó registrada y que la reenvíe desde Fathom.

Tiempos: después de las ideas quedan 50 s (`MARGEN_ENVIO_MS`) para guardarlas (hasta 10 s), mandar a Discord (que corta 20 s antes del deadline) y registrar.

## La ficha: campos y de dónde sale cada uno

Cada dato que sale de la llamada lleva su **cita textual** (hasta 25 palabras) y su **timestamp** HH:MM:SS, validado contra la transcripción. Claude los devuelve juntos en un campo `evidencia` ("[00:12:00] cita") y el código los separa.
- Un timestamp mal formado o fuera de la llamada queda sin link.
- Una cita que no aparece tal cual en la transcripción queda marcada "no textual".
- Una cita que está en la transcripción pero no en el renglón de su timestamp (ni en el de al lado) queda anotada en los ajustes.
- Fathom junta renglones de hasta 2 minutos. Por eso se estima el segundo de la cita dentro de su renglón (`aprox`, interpolado hasta el renglón siguiente) y el link va a ese segundo con "≈". El timestamp original se guarda igual.

| Campo | Qué es | De dónde sale |
|---|---|---|
| `tipo_reunion` | kickoff · seguimiento · venta · equipo · otra | Claude, por el contenido. El título "X y RESPONSABLE_HUB" es igual para kickoffs y seguimientos |
| `cliente` | nombre escuchado, apodo ("Cris"), nombre en el CRM, ID (A0xx), mail del invitado, cuentas publicitarias | Claude elige de la lista del CRM; el código lo valida. Si el mail del invitado externo coincide con UN cliente del CRM, gana ese. Si no está en la lista → "sin verificar" |
| `rama` (c02) | principal (clave de `lib/anuncios/ramas.ts`), texto, subramas (**solo el tema**: los filtros van en avatar), descartadas con motivo (también las ramas que el cliente nombró y no se eligieron), a futuro (con el avatar que dijo para esa rama) | Claude. Una rama que no está en la lista queda en null |
| `avatar` | filtros que incluye y excluye ("en blanco o parcialmente en blanco", "nada de pasantes"), más el contexto del mercado que dé el cliente ("en la zona hay muchos rurales en negro") | Claude |
| `zona` (c03) | descripción (sin inferir el centro del radio), lugares, radio en km, cómo se presenta (texto, en qué contexto se dijo y su propia cita), contexto (distancia del estudio, si acepta viajar), país, si se marcó en un mapa en pantalla y, desde el 24/10, `zona.mapa`: lo que se leyó del **video** (lugares, marca, límites, radio, discrepancias con lo dicho, ▶ al cuadro) | Claude; el **país** lo deduce el código de la zona (provincias argentinas, Uruguay…). El recorte del mapa no queda en la transcripción: lo lee `mapa.ts` del video (columna `zona_video`); mientras no se lee, va como faltante |
| `zona_video` | la lectura del mapa: estado (`pedido`, `leyendo`, `ok`, `sin_mapa`, `sin_video`, `sin_key`, `error`), versión del prompt, cuenta de Fathom, `download_id`, motivo, tokens | La que manda es la de la **columna** `zona_video` (la escribe la ruta del mapa después de que la ficha quedó lista); la ficha guarda la que se conocía al armarla. `conZonaVideo` (ficha.ts) la suma a la ficha |
| `presupuesto` (c04) | USD por día (mín. y máx.), USD por mes, moneda, texto, deducido, certeza, evidencia del mensual si se dijo aparte | Claude, y el código completa lo que se deduce directo (un solo monto → mín = máx; el mensual desde el diario) marcándolo deducido. Con un rango diario se muestra el rango mensual ("~USD 240–300 por mes"); si el mensual que se dijo es el del mínimo, con cuánto se arranca: "USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes" |
| `portfolio` (c01) | lo que se dijo en la **llamada** de los 7 ítems fijos: Instagram, WhatsApp Business, página de Facebook, portfolio comercial, tarjeta, verificación, accesos del equipo (geroa2004@ y valentinozalazar.ads@, de `EQUIPO_ACCESOS_BASE` en `tipos.ts`: una sola lista para el prompt, el ítem y el chequeo) | Claude: ok, falta, problema, sin_verificar (se mencionó, no se comprobó) o no_se_hablo. "No se habló" con cita pasa a sin_verificar. `sin_dato` **no** está en el enum de Claude: es de Meta |
| `portfolio_meta` | la cabecera del chequeo de Meta: `cuenta` (act_…), `nombre`, `leido`, `motivo` (si no se pudo leer), `aviso` (qué hacer), `generado`, `origen_cuenta` (crm / descubrimiento), `moneda` y `zona_horaria` de la cuenta (desde el 24/10) | `portfolio.ts` (`paraFicha`). `null` = Meta no se consultó (ficha vieja o no es kickoff) |
| `portfolio_final` | los 7 ítems ya cruzados: `estado` (ok / falta / problema / sin_dato), `fuente` (meta / llamada / ninguna), `detalle`, lo de cada lado y la `discrepancia` | `combinarPortfolio(Meta, llamada)`: la **única** fusión. De acá leen los faltantes, el markdown y el aviso. Lo que queda con fuente `ninguna` lo tilda RESPONSABLE_HUB a mano (columna `portfolio_checks`). Las fichas viejas no lo tienen: `portfolioFinalDe()` lo rearma de la llamada |
| `grabo` | con qué Fathom se grabó la kickoff: nombre y mail de Fathom, `quien` (RESPONSABLE_HUB / COORDINACION) y `cuenta_fathom` (la cuenta que firmó el webhook). La pantalla y el markdown dicen "Grabada con el Fathom de X" (no "la hizo": si la grabaron los dos, gana la que llegó primero) | `recorded_by` del payload de Fathom; se reconoce por nombre o mail (`RESPONSABLE_HUB` → RESPONSABLE_HUB, `mozzi` → COORDINACION). Si no alcanza (no vino, u otro nombre), la cuenta que firmó (columna `grabador`). Otra persona → va su nombre |
| `acuerdos`, `pendientes` | quién, qué y cuándo (fecha concreta con día de la semana; los plazos del equipo en días hábiles); los compromisos del equipo a nombre de quien los dijo (RESPONSABLE_HUB o COORDINACION); lo que el cliente ya hizo va como hecho | Claude. Con Meta consultado, el código saca los pendientes que hablan del portfolio (los cubre el chequeo) y lo anota en los ajustes |
| `faltantes` | lo que tiene que completar RESPONSABLE_HUB | **El código** (nunca Claude): cliente sin verificar, rama, subramas, avatar, zona vacía, la zona del mapa ("anotar el recorte exacto para la campaña", con el ▶ al minuto y los lugares que se nombraron), presupuesto sin monto o deducido, cuenta que factura en otra moneda que el presupuesto; la zona del mapa según lo que se leyó del video (resuelta si el mapa se lee bien y coincide con lo dicho; "revisar las diferencias…" si no coincide y "confirmar el recorte leído del video" si coincide pero se lee en parte, las dos con su propia clave `zona_mapa_video`; mientras el bot lo lee, "se está leyendo del video (en unos minutos queda acá; si preferís, anotá el recorte a mano)"; si no se pudo leer, el porqué: "conectar la API key de Fathom de COORDINACION para leer el mapa", "la grabación no tiene video", la ficha sin el minuto de la zona, un error pasajero con cómo reintentarlo…); del portfolio: lo que ni Meta ni la llamada resolvieron (tildar a mano), lo que está en falta o con problema diciendo según quién, lo que Meta y la llamada ven distinto ("ojo: Meta dice X, en la llamada se dijo Y"), la cuenta que encontró sola el tablero ("cargar act_… en «Cuentas Meta» del CRM") y el aviso de Meta; ideas que no salieron. Cada uno tiene clave (`claveFaltante`) para marcarlo como hecho en la pantalla. Que la grabación cortó antes de lo agendado **ya no es un faltante**: es una nota de la cabecera (`notaCorteGrabacion`) |
| `ideas_guiones` (c06) | 5 ideas: título, gancho, ángulo, subrama, en qué se apoya. Estado `a_revisar`, revisores RESPONSABLE_HUB y COORDINACION | Claude, con la ficha, los ganadores y la base de la rama |
| `ganadores` | hasta 10 anuncios de la misma rama de OTRAS cuentas, por costo por mensaje (180 días) | Meta (solo lectura), ver abajo. El nombre del otro cliente queda solo en el JSON: no va a Claude, ni a Discord, ni al markdown |
| `ajustes` | qué se corrigió de lo que devolvió Claude | El código |

c05 queda resuelto con esto: la ficha del Despacho reemplaza la carga en ClickUp.

### Dónde se guarda: `cj_kickoffs` (Neon, misma base que Cuotas)

Una fila por `recording_id`, que se crea sola la primera vez (`CREATE TABLE IF NOT EXISTS`). Columnas:
- **Estado:** `procesando`, `lista`, `no_kickoff`, `omitida`, `error` y, desde el 24/10, `duplicada` (la misma reunión ya llegó en otra grabación: `duplicada_de`). `duplicada` es un estado final (se borra el payload).
- **Datos:** `cliente_crm`, `id_crm` (con índice), `ficha` y `ideas` (jsonb, las ideas con los ganadores con que salieron), `version_prompt`, `version_ideas`, `modelo`, `tokens_in` y `tokens_out` (suma de las dos llamadas), `aviso_discord` (id del mensaje), `error`, `duracion_ms`, `intentos` y timestamps.
- **Nueva del 24/10 (noche), sin publicar:** `aviso_ads` (text): la marca del aviso a ADS (`''` en una fila nueva sin aviso, `pendiente:<ms>`, `enviando:<ms>`, el id del mensaje, `dudoso:<ms>` o `error:<ms>`; ver "Aviso a ADS" → "La marca"). La suma `asegurarTabla()` con `ADD COLUMN IF NOT EXISTS`, sin default; `reclamar` inserta las filas nuevas con `''`. La fila de CUENTA_QA (y cualquiera de antes del deploy) queda en NULL: **no sale sola, ni reprocesándola con `?forzar=1`** (se manda a mano). Las lecturas la piden con `to_jsonb(cj_kickoffs) ->> 'aviso_ads'` (el `GET` de estado la muestra).
- **Payload:** el de Fathom (más `scheduled_end_time`, que la validación no conserva), mientras no termina. Se borra al llegar a un estado final. En las filas que quedan en `error` o colgadas, `purgarPayloadsViejos` lo borra a los 14 días sin cambios (la ruta la llama después de cada grabación del webhook; no hay cron propio).
- **Para la pantalla:** `revision` (`{"RESPONSABLE_HUB": null, "gero_m": null}`), `portfolio_checks` (`{}`) y `faltantes_checks` (`{}`, nueva del 24/10: faltantes marcados como hechos y los datos de lanzamiento cargados a mano). El bot no las pisa nunca. `faltantes_checks` la suma `asegurarTabla()` con `ADD COLUMN IF NOT EXISTS` (mirando antes `information_schema`, para no pedir el lock en cada arranque); las lecturas la piden con `to_jsonb(cj_kickoffs) -> 'faltantes_checks'`, así no rompen si todavía no existe.
- **Nuevas del 24/10 (tarde), sin publicar:** `grabador` (text: `tomas` | `gero_m`, la cuenta que firmó), `agendado` (timestamptz: la hora de la reunión para buscar la gemela), `dedupe` (jsonb: la clave de la reunión, con HUELLAS de los mails, nunca los mails), `duplicada_de` (bigint) y `zona_video` (jsonb: la lectura del mapa). Las suma `asegurarTabla()` **solo con `ADD COLUMN IF NOT EXISTS`, sin default ni `NOT NULL`** (no reescribe filas), mirando antes `information_schema` **en el schema de la conexión** (`table_schema = current_schema()`: una copia de respaldo de `cj_kickoffs` en otro schema no cuenta como "ya están"). La fila de CUENTA_QA queda con todo eso en NULL y anda: las lecturas piden las columnas nuevas con `to_jsonb(cj_kickoffs) -> '…'`, una fila sin `agendado` no entra en la búsqueda de gemelas y sin `zona_video` la pantalla muestra lo de antes. `guardarZonaVideo` escribe solo su columna (ni la ficha, ni el estado, ni `actualizado`).

Las escrituras crean la tabla la primera vez. Las lecturas (`leerPayload`, `ultimas`, `leerKickoff`: el GET de estado y el `dry` con `recording_id`) **no** crean nada: si la tabla no existe, devuelven vacío.

**En esta etapa no se ejecutó nada contra la base real.**

### Ganadores de Meta (`lib/bot/kickoff/ganadores.ts`)

- **Cuentas de la rama:** la misma selección y la misma rama por cuenta que el tablero de anuncios (`AJUSTES_CUENTA.rama` → ClickUp → nombre de la cuenta), con las **mismas claves de caché** del tablero (`sheets`, `descubrir`, `clickup-presupuestos-v1`, `dolar`, `monedas`).
- **Lectura:** Batch API con un subpedido **GET** por cuenta (`insights?level=ad`, 180 días, gasto, mensajes y nombre de la campaña) y otro GET con el texto de los 30 mejores. Se reintenta con el otro token si falta permiso.
- **Caché:** `kickoff-ganadores-v2:<rama>:<día>`, 12 h, con el tag `anuncios`.
- **Selección:** sin las cuentas del propio cliente y sin lo que es de otra rama. Máximo 2 por cliente y hasta 10, con ids G1…Gn.
- **País:** cada cuenta lleva el suyo (moneda ARS/UYU/… o el país o la provincia en el nombre de las campañas; USD sin nada más = sin dato). Primero van los del país del cliente, después los sin dato, y los de otro país solo para llegar a 3, marcados. En la prueba de CUENTA_QA quedaron afuera 4 de Uruguay (antes 2 se habían colado: G7 y G10, con el BPS en el texto).
- **Anonimizar:** el nombre y el texto del anuncio van a Claude sin teléfonos, @usuarios, "Dra. Fulana" ni las palabras del nombre de ese cliente.
- **Pocos datos:** con menos de 3 queda en "pocos_datos".
- **Moneda:** ARS al MEP de hoy y las otras monedas a la cotización de hoy. Es aproximado: es una referencia para idear.

### Portfolio de Meta en la ficha (`lib/bot/kickoff/portfolio.ts`, solo lectura)

- **Qué lee:** una llamada a la Batch API de Graph con 9 subpedidos **GET** (y una segunda solo si hace falta mirar las agencias), con los tokens de lectura (`META_ANUNCIOS_TOKEN`, después `META_CLIENTES_TOKEN`). Nunca `META_ADS_WRITE_TOKEN`. El detalle de cada ítem está en el encabezado de `portfolio.ts`.
- **Qué cuenta revisa:** la de "Cuentas Meta" del CRM o, si no hay, la del descubrimiento del tablero cruzado con el CRM (mismas cachés). Si no aparece, todo "sin dato" con el aviso de cargarla en "Cuentas Meta".
- **Fusión (`combinarPortfolio`):** manda Meta salvo que diga `sin_dato`; ahí queda lo de la llamada. Un "ok" de Meta deducido de los anuncios (Instagram y WhatsApp) no le gana a un "falta" o "problema" de la llamada. Un `sin_verificar` de la llamada (se mencionó) no le discute a Meta: si Meta no vio nada, queda "sin dato" y se tilda a mano.
- **Tiempo:** el descubrimiento en frío tarda unos 9 s y se precalienta mientras Claude lee la llamada. El chequeo, 2 a 4 s. Tope total 15 s (race): si no llega, "Meta no respondió a tiempo" y manda la llamada.
- **Markdown:** la tabla tiene columna **Fuente** (Meta / llamada / —). El **Momento** de la grabación va solo cuando la fila habla de la llamada (la fuente es la llamada, se mencionó sin verificar o la llamada dijo otra cosa que Meta). Debajo van la cuenta act_… revisada, de dónde salió y el aviso de Meta.
- **Límites del token actual:** Instagram y el número de WhatsApp de la página no se pueden leer (faltan `instagram_basic` / `pages_read_engagement`). Por eso casi siempre quedan "para tildar" si no hay anuncios y la llamada no los resolvió.
- **Textos:** sin nombres de permisos ni de tokens (los lee RESPONSABLE_HUB): dicen qué revisar a mano y dónde ("revisalo en el portfolio del cliente: Configuración del negocio → Cuentas de Instagram"). El porqué técnico (el permiso que falta, el código de Graph) va en `ItemMeta.tecnico` y de ahí a los ajustes (`portfolio en Meta: …`). "Sin verificar" queda **solo** para la verificación de Meta: lo que nadie resolvió es "para tildar" y lo que la llamada nombró sin confirmar, "se nombró".
- **Moneda y hora:** el mismo GET de la cuenta pide `currency` y `timezone_name` (sin índice nuevo). Si la cuenta factura en otra moneda que el presupuesto, faltante: "La cuenta factura en ARS: pasar USD 8–10 por día a pesos al cargar el presupuesto".

**CUENTA_QA (Z002), 24/10, con `--rearmar` (sin Claude; última pasada, después de la segunda revisión):**
- Cuenta `ACT_CUENTA_DE_PRUEBA` («USD ESTUDIO JURIDICO OLIVER MASIA»), factura en **USD**, hora de Argentina. La encontró el **tablero de anuncios** (no está en "Cuentas Meta"): faltante "Portfolio · cargar ACT_CUENTA_DE_PRUEBA en «Cuentas Meta» del CRM". 9,4 s en frío, 6 GET a Graph.
- Portfolio comercial **ok** ("sin verificar (no frena nada)"), página **ok**, tarjeta **ok** (sin deuda), verificación **ok** ("Cuenta publicitaria activa, sin restricciones · el portfolio no está verificado por Meta (no frena nada)"), accesos **ok** (CSM y ADS pueden anunciar). Todo según Meta: **5 de 7**.
- Instagram y WhatsApp Business **para tildar** (ni Meta ni la llamada; WhatsApp solo se nombró).
- En la llamada la tarjeta solo se mencionó ("tenela bien cargada"): Meta la da ok y no hay discrepancia.
- El pendiente de Claude "No se revisó el portfolio en Meta…" (con dos mails) salió de la ficha: lo cubre el chequeo (queda en los ajustes).

### Base de conocimiento (`lib/bot/kickoff/kb/`)

Por ahora solo **laboral** (`kb/laboral.ts`, versión `kb-laboral-2-2026-10-24`). Se armó con `.cache/kickoff-prueba/ejemplos-guiones-laboral.md`, sin datos personales:
- no tiene nombres de clientes ni ids de docs;
- no incluye nada del doc de la propia clienta de la prueba ("CUENTA_QA", que se usa como control). La v1 sí copiaba su gancho, su solución, su CTA y dos de sus ángulos (licencia médica, horas extra), y las ideas repetían el control; la v2 los saca;
- no incluye las cifras legales de los guiones viejos.

Si RESPONSABLE_HUB quiere sumar el formato de CUENTA_QA para producción, hay que aclararlo en el encabezado de `kb/laboral.ts`.

Es un **borrador para que lo apruebe RESPONSABLE_HUB**. Para una rama sin base, las ideas salen igual y queda anotado.

## Aviso de Discord

Este es el texto que sale con la kickoff de CUENTA_QA (24/10, corrida k3/i3 rearmada con `--rearmar` después de la tercera revisión): **1.905 caracteres**, el máximo son 2.000. Cambió respecto del publicado: la subrama del accidente dice «(a confirmar)», el gancho que ya traía comillas va con “…” adentro y los faltantes dicen «portfolio (2)».

```
<@1> <@1> 📝 **Kickoff · CUENTA_QA — ideas de guiones para revisar**
📞 Kickoff de RESPONSABLE_HUB · vie 23/10 09:00 · [Fathom](<<URL_CONFIGURADA_PRIVADAMENTE>>)

⚖️ **Rama:** Laboral (despidos) — subramas: despidos; despido después de un accidente de trabajo (a confirmar)
👤 **Avatar:** antigüedad mínima de un año y medio trabajando · en blanco o mitad en negro y mitad en blanco · ✋ afuera: trabajo totalmente en negro · pasantes · gente con poca antigüedad
📍 **Zona:** Tres Esquinas · Pedernal · Caucete · el Bordón · se presenta como «San CUENTA_QA capital» · 🗺️ marcada en el mapa
💵 **Presupuesto:** USD 8 por día para arrancar (hasta 10) · \~USD 240 por mes
🧾 **Portfolio:** 5/7 ok según Meta · ➜ cargar la cuenta en «Cuentas Meta» del CRM · a tildar: Instagram, WhatsApp

💡 **Ideas para revisar:**
1. **Una parte en mano** — «¿Te despidieron en San CUENTA_QA y una parte del sueldo te la daban en mano? Ojo, que eso no te deja afuera.»
2. **Ya firmaste la liquidación** — «Si trabajaste más de un año y medio en blanco, te despidieron y ya firmaste la liquidación, esperá antes de dar todo por cerrado.»
3. **Te empujan a renunciar** — «¿En tu laburo te cambian el horario, te sacan tareas y te hacen la vida imposible para que renuncies? No firmes nada todavía.»
4. **Accidente y después despido** — «¿Tuviste un accidente en el laburo, estabas en blanco hace más de un año y medio y al volver te despidieron? Escuchá esto.»
5. **No vengas más** — «“Mirá, mañana no hace falta que vengas.” ¿Te lo dijeron así, de palabra, después de más de un año y medio en blanco?»
🏆 3 de 5 ideas se apoyan en 4 ganadores de Laboral (despidos) en Meta (180 días): G2, G3, G4, G9
👉 Aprobá o pedí cambios en la ficha (referencia privada)

⚠️ **Falta completar (3):** recorte de la zona (mapa) · portfolio (2): ver 🧾
```

**El corte que se arregló (24/10):** en producción el renglón del avatar salía "… y trabajadores rurales: el…": un ítem largo (el contexto del mercado, escrito sin el prefijo "contexto" que lo saca del aviso) se cortaba en un límite de palabra. Ahora los renglones son listas de ítems enteros: con la misma ficha y ese ítem, el código de antes daba `… · gente con poca antigüedad · mucha gente en negro a la que despiden en la zona, y muchos son trabajadores…` y el de ahora da `… · gente con poca antigüedad · +1` (comparado sobre la salida de CUENTA_QA con ese ítem cambiado a mano; no se leyó la fila de producción).

- **Menciones:** solo RESPONSABLE_HUB y COORDINACION, con `allowed_mentions.users`. Lo que escribe el modelo pasa por `escaparDiscord`: sin markdown ni menciones.
- **Quién la hizo:** "📞 Kickoff de RESPONSABLE_HUB" o "de COORDINACION" (de `grabo`). Si es otra persona, va su nombre de Fathom, escapado.
- **Link a la ficha:** en su propio renglón, después de las ideas: "👉 Aprobá o pedí cambios en la [ficha]" (la aprobación queda registrada en la ficha; un "ok" en Discord, no). Va a `${AUTH_BASE_URL}/clientes/<id_crm>/kickoff` (o `DESPACHO_URL`). **Encendido por defecto**; `KICKOFF_PANTALLA=0` lo apaga. Sin ID del CRM no hay link. Nunca a `/api/bot/kickoff` (pide Bearer: desde Discord da 401). Sin link, el aviso no dice "el detalle está en la ficha" y suma los pendientes.
- **Portfolio (🧾):** sale de `portfolio_final`: cuántos ítems están ok y según quién, lo que falta o tiene problema, "➜" el aviso de Meta y, si la cuenta la encontró sola el tablero, "cargar la cuenta en «Cuentas Meta» del CRM", lo que Meta y la llamada ven distinto y lo que queda "a tildar". Los faltantes del portfolio no se repiten en ⚠️ ("portfolio: ver 🧾").
- **Ganadores:** se cuentan solo los que las ideas citan de verdad ("4 de 5 ideas se apoyan en 6 ganadores…: G1, G2…"), sin nombres de otros clientes ni sus números.
- **Rama, avatar y zona:** las subramas van cortas (solo el tema, sin cortarlas; si la subrama está «a confirmar», eso queda: es una decisión pendiente y el prompt no la repite en los pendientes); los filtros, solo en el avatar, tras "✋ afuera:" sin la doble negación ("nada de pasantes" → "pasantes") y sin el contexto del mercado (no es un filtro); la zona arranca por los lugares y termina con cómo se presenta el abogado, sin el paréntesis de cuándo se dijo (antes arrancaba por "San CUENTA_QA capital", que no es la zona).
- **Mapa (🗺️):** "marcada en el mapa"; "(el bot la está leyendo del video: el resultado queda en la ficha)" si la lectura está pedida; sin la API key de quien grabó, "(no se lee sola: falta la API key de Fathom de COORDINACION)"; sin video, "(la grabación no tiene video)"; si el mapa ya se leyó (al reprocesar), "coincide con el mapa del video" (con "(se lee en parte: confirmarlo)" si se lee en parte) o, nombrando los lugares, "el mapa del video no muestra Tres Esquinas, Pedernal ni el Bordón: revisar" (antes "revisar (N)" contaba frases: con tres lugares que no aparecían decía 1). El aviso normal sale ANTES de que se lea el mapa: el resultado se ve en la ficha y, si RESPONSABLE_HUB lo prende (`KICKOFF_AVISO_MAPA=1`), en un renglón aparte cuando termina (ver "Ruta `/api/bot/kickoff/mapa`").
- **Faltantes (⚠️):** con etiquetas cortas fijas (`ETIQUETA_FALTANTE`: "recorte de la zona (mapa)", "cliente sin cruzar", "presupuesto a confirmar"…; mientras el bot lee el mapa, "recorte de la zona (lo está leyendo el bot)"; con el mapa del video en contra de lo dicho, "revisar el mapa de la zona"; si se lee en parte, "confirmar el recorte (mapa)"), así entran todos. Los del portfolio, "portfolio (N): ver 🧾" (antes "Falta completar (3)" mostraba dos cosas). Los que no tienen etiqueta (de una ficha vieja), enteros mientras entren, y "+N".
- **Ganchos con comillas:** un gancho que ya trae «…» va con “…” adentro (`entreComillas`, también en el markdown y la pantalla): antes salía «««Mirá…» …»».
- **Largo, sin cortes a mitad de frase (24/10):** la rama, el avatar, la zona, el portfolio (🧾), los pendientes y los faltantes son **listas de ítems enteros** (`encajar` en mensaje.ts): primero entra el primer ítem de cada grupo (el primer lugar, el radio, cómo se presenta; lo que incluye y lo que queda afuera), después el resto en orden mientras entre, y lo que no entra se cuenta como "+N" (está en la ficha): dentro de su grupo si tiene prefijo ("✋ afuera: … · +2", "subramas: …; +1"), o un solo "+N" después de los grupos sin prefijo. Nunca se corta un ítem en los niveles normales; el primero de cada renglón va siempre. Si no entra en 2.000 caracteres, se achican de a poco esos renglones (con link, los faltantes sin etiqueta quedan en el número: el detalle está en la ficha) y los ganchos recién al final. En los últimos cinco niveles, además, un ítem que solo ya no entra (un primer filtro de 290 caracteres, una descripción de la zona de 400) se acorta en un límite de palabra (220 → 80 caracteres): antes el primero no se recortaba nunca, el mensaje no entraba y el recurso final cortaba la cola (`.slice(0, 1999)`), llevándose el 👉 con el link y el ⚠️ de los faltantes. **El recurso final ahora saca ideas enteras desde la última** ("… y N ideas más en la ficha"): el link y los faltantes no se pierden nunca. Hay tests con los textos largos de la revisión (sin "…" al final, con el link y los faltantes).
- **Avisos de la pantalla** (no del bot): pedir cambios avisa al otro revisor en #📝-kickoff ("✏️ COORDINACION pidió cambios en las ideas de …: «…» · [Ficha]", mencionando solo a ese otro); cuando quedan aprobadas por los dos, "✅ Ideas de … aprobadas por RESPONSABLE_HUB y COORDINACION" y, si está `DISCORD_WEBHOOK_KICKOFF_ADS`, el bloque "para lanzar" a ADS (ver la pantalla). Ese ✅ a ADS es **otro** mensaje, de otro momento, y sigue saliendo solo con `DISCORD_WEBHOOK_KICKOFF_ADS` (no con #📣-ads): el «🚀 Para lanzar» de la ficha lista es el de "Aviso a ADS".

## Aviso a ADS (#📣-ads, 24/10, noche, sin publicar)

Pedido de RESPONSABLE_HUB (24/10): que **ADS** (media buyer) reciba en Discord, mencionándolo, lo que necesita para lanzar la campaña del cliente nuevo. Lo arma `lib/bot/kickoff/aviso-ads.ts` desde `armarVista` (la misma vista de la pantalla de la ficha y del bloque "Para lanzar" del tablero: sin mails, con los tildes y las marcas hechas a mano y la lectura del mapa de la columna `zona_video`).

**Qué lleva** (hasta 2.000 caracteres, renglones de ítems enteros con `encajar`, como el aviso de #📝-kickoff; lo que no entra queda como "+N"):
- `<@ADS> 🚀 **Para lanzar · <cliente>**` (sin cruzar con el CRM, lo dice) y `📞 Kickoff de RESPONSABLE_HUB · vie 23/10 09:00 · [Fathom]`.
- 🏦 **Cuenta:** el `act_…` en código (se copia de un toque), el nombre, moneda y horario y, si entra, la página.
- ⚖️ **Rama** y subramas (con «(a confirmar)» si lo está) · 👤 **A quién le habla (para el copy)** y "✋ afuera:" (la antigüedad o "en blanco" no se segmentan en Meta: van en el copy).
- 📍 **Zona**: la **provincia y el país** delante ("Provincia de San CUENTA_QA, Argentina:", sacada de la descripción; no se inventa: "CUENTA_QA capital" no da provincia), el **"desde… hasta…" tal como se dijo** (es un área entre esos puntos, no pines sueltos) con "(de oído)" donde corresponde, los lugares que ese tramo no nombra, el radio y **la distancia al estudio** (el primer contexto de la zona que habla del estudio o de km; solo en los niveles con lugar). Sin la provincia, "Pedernal" o "Tres Esquinas" podían ser localidades homónimas de otra provincia en Meta · 🗺️ **Mapa**: el recorte anotado a mano si lo hay; si el mapa del video coincide, "✅" y lo leído (lugares y límites; con un pin de Meta, la ubicación con su radio y lo excluido); si hay diferencias, "⚠️ el mapa del video no muestra … : confirmar el recorte con RESPONSABLE_HUB antes de lanzar"; si no se pudo leer (sin mapa en esos minutos, sin video, error, colgada), el porqué con la misma pedida a RESPONSABLE_HUB; el ▶ al cuadro del mapa · 🗣️ **Presentarse como** («San CUENTA_QA capital», si un lead pregunta).
- 💵 **Presupuesto** por día y por mes (si la cuenta factura en otra moneda, que se pase al cargarlo) · 📅 **Lanzamiento**: la fecha cargada a mano en la ficha "(cuando estén los videos)" o "sin fecha todavía: sale cuando estén los videos" con lo acordado (guiones, quién graba, edición); "📲 WhatsApp de destino:" el cargado a mano o "sin cargar (pedíselo a RESPONSABLE_HUB)" (las campañas de CJ son de mensajes a WhatsApp).
- 🧾 **Portfolio**: "⛔ frena:" lo que falta o tiene problema (accesos y tarjeta primero, con el porqué), o "sin frenos: 6/7 ok según Meta"; con **WhatsApp Business sin confirmar** (ni Meta, ni la llamada, ni un tilde) no dice "sin frenos": "⚠️ WhatsApp Business sin confirmar (es el destino de los anuncios) · 5/7 ok según Meta"; "sin confirmar:" lo demás que nadie resolvió; el aviso de Meta. Si Meta no pudo leer la cuenta, que confirme accesos y tarjeta con RESPONSABLE_HUB.
- 👉 `[Ficha]` (`${AUTH_BASE_URL}/clientes/<id>/kickoff`, o `DESPACHO_URL`; sin ID del CRM o con `KICKOFF_PANTALLA=0`, no va) · `[Tablero de anuncios]` (`/anuncios`). La mención y este renglón no se pierden nunca: si no entra, se achican los renglones, en los últimos niveles un ítem que solo ya no entra se acorta en un límite de palabra y, como recurso final, se sacan renglones enteros de los menos importantes.
- **Nada** de las ideas de guiones ni de los ganadores de otros clientes (hay tests). Lo que viene del modelo o de Meta pasa por `escaparDiscord`; la única mención es la de ADS.


```
<@1> 🚀 **Para lanzar · CUENTA_QA**
📞 Kickoff de RESPONSABLE_HUB · vie 23/10 09:00 · [Fathom](<<URL_CONFIGURADA_PRIVADAMENTE>>)

🏦 **Cuenta:** `ACT_CUENTA_DE_PRUEBA` («USD ESTUDIO JURIDICO OLIVER MASIA») · factura en USD · hora de Argentina · página «Estudio CUENTA_QA CUENTA_QA CUENTA_QA CUENTA_QA»
⚖️ **Rama:** Laboral (despidos) — subramas: despidos; despido después de un accidente de trabajo (a confirmar)
👤 **A quién le habla (para el copy):** antigüedad mínima de un año y medio trabajando · en blanco o mitad en negro y mitad en blanco · ✋ afuera: trabajo totalmente en negro · pasantes · gente con poca antigüedad
📍 **Zona:** Provincia de San CUENTA_QA, Argentina: desde Tres Esquinas (de oído) y Pedernal hasta Caucete y el Bordón (de oído) · El estudio está en Media Agua; ella dice que está a 60 km (media hora)
🗺️ **Mapa:** ⚠️ se marcó en un mapa en pantalla y no se leyó del video: confirmar el recorte con RESPONSABLE_HUB antes de lanzar [▶ ≈17:18](<<URL_CONFIGURADA_PRIVADAMENTE>>)
🗣️ **Presentarse como:** «San CUENTA_QA capital» (si un lead le pregunta dónde está)
💵 **Presupuesto:** USD 8 por día para arrancar (hasta 10) · \~USD 240 por mes
📅 **Lanzamiento:** sin fecha todavía: sale cuando estén los videos · guiones para mar 27/10 o mié 28/10, estimado · después graba CUENTA_QA y se edita · 📲 WhatsApp de destino: sin cargar (pedíselo a RESPONSABLE_HUB)
🧾 **Portfolio:** ⚠️ WhatsApp Business sin confirmar (es el destino de los anuncios) · 5/7 ok según Meta · sin confirmar: Instagram

👉 Ficha (referencia privada) · Tablero de anuncios (referencia privada)
```

(El rearmado no lee el mapa: por eso el 🗺️ dice que no se leyó. Con la lectura `ok` dice "✅ … · leído: … · límites: …" o las diferencias.)

**Canal, mención e interruptor** (`entorno.ts`): `DISCORD_WEBHOOK_KICKOFF_ADS` o, si no está, `DISCORD_WEBHOOK_ANUNCIOS` (#📣-ads, ya en Vercel). Mención `<@DISCORD_ID_VALENTINO>` (ya en Vercel), con `allowed_mentions` solo ese user (`enviarDiscord` de fathom-anuncios: `?wait=true`, flags 4, 429 y 5xx con reintentos acotados); sin el ID, "ADS" en texto, sin notificar. `KICKOFF_AVISO_ADS=0` lo apaga (por defecto, **prendido: sale apenas se deploya**). Sin canal o apagado, no se deja la marca: esas fichas no salen solas después (se mandan a mano).

**Si falla, se entera RESPONSABLE_HUB** (como con los errores de #📝-kickoff): cuando el aviso queda en `error` (Discord lo rechazó: el webhook de #📣-ads se borró o se regeneró, o la ficha no se puede leer) o en `dudoso` (Discord no confirmó o se cortó la conexión a mitad: puede haber salido), le llega **un** aviso corto en #📝-kickoff (`DISCORD_WEBHOOK_KICKOFF`, mencionándolo solo a él) con cómo reintentarlo (`aviso_ads=1` o, si es dudoso, mirar #📣-ads y `aviso_ads=forzar`). La marca ya no es pendiente, así que no se repite. Un error pasajero que seguro no publicó (5xx, 429, sin tiempo) no avisa: vuelve a pendiente y lo manda el barrido. A mano no avisa (la respuesta ya lo dice). Ejemplo: `<@RESPONSABLE_HUB> ⚠️ No salió el aviso a ADS «🚀 Para lanzar» de «CUENTA_QA…» (grabación 1): Discord lo rechazó (Discord respondió 404: …): seguramente el webhook de #📣-ads se borró o se regeneró. Cuando esté el nuevo en Vercel, pedile a Claude que lo mande (POST /api/bot/kickoff?recording_id=1&aviso_ads=1).`

**Cuándo sale** (solo kickoffs `lista`: nunca las duplicadas ni las `no_kickoff`). El mecanismo más simple con lo que ya existe, sin cron nuevo ni tocar `vercel.json`:
1. `procesar.ts`, al marcar la ficha `lista`, deja la marca `pendiente:<ms>` **en el mismo UPDATE** (`marcar` con `aviso_ads_desde`). Si la invocación se corta después, la marca queda y el barrido la encuentra.
2. **Sin lectura del mapa en marcha** (no hubo mapa en pantalla, falta la API key, sin el minuto de la zona, Fathom dijo que no hay video, la ruta del mapa no aceptó la lectura o no se pudo conectar): sale enseguida, desde `procesar.ts`, después del aviso de #📝-kickoff.
3. **Con la lectura en marcha** (la ruta del mapa respondió 202/200/409, o el disparo no respondió a tiempo y puede haberla aceptado): lo manda la **ruta del mapa cuando la lectura termina**, en cualquier estado final (ok, sin mapa, sin video, sin key, error), desde su `after()`, con la zona recién guardada. Si queda en camino el reintento solo (error pasajero con la descarga ya pedida), lo manda el reintento al terminar; si el redisparo del reintento no respondió a tiempo (un arranque en frío: puede haber arrancado), también se espera al reintento y, si no arrancó, lo manda el barrido a los 12 minutos. También sale al responder `ya_leido` y cuando la verificación corta la lectura (sin key, sin ffmpeg…: con el porqué anotado). Una relectura a mano de una ficha vieja, o de una que ya avisó, no manda nada (solo actúa sobre la marca `pendiente`).
4. **Si se cuelga** (la invocación del mapa se cortó, el aviso no tuvo tiempo, Discord dio un error pasajero): el **barrido** (`barrerAvisosAds`) corre después de cada grabación del webhook, junto a la purga de payloads (`trasWebhook` de `procesar.ts`; RESPONSABLE_HUB y COORDINACION graban todas sus llamadas, así que corre varias veces por día), **al final de cada lectura del mapa** (los pendientes de otras grabaciones) y en el modo manual con `?recording_id=` de una ficha lista ("el próximo reproceso lo manda"). Manda las pendientes de los últimos **7 días** (hasta 3 por pasada; un fin de semana largo sin grabaciones no las pierde) en cuanto el mapa terminó o, si la lectura sigue `pedido`/`leyendo`/con error pasajero, pasados **12 minutos** desde que quedó pendiente **o desde la última escritura de la lectura** (`ESPERA_MAX_MAPA_MS`: una invocación de 300 s, el reintento solo y el disparo, con margen; una lectura vieja de hace horas no se espera); ahí el 🗺️ dice "la lectura del mapa del video no terminó: confirmar el recorte con RESPONSABLE_HUB". Lo pendiente de más de 7 días no sale solo (si el aviso se prende o el canal se carga semanas después, no manda viejas). Sin cron propio, si no llega ninguna grabación el barrido no corre: el `GET` de estado lista esos pendientes viejos en `aviso_ads.revisar`.

**Tiempos:** se toma el aviso solo si quedan 15 s hasta el deadline (`MIN_TIEMPO_ADS_MS`: tomar y anotar pueden tardar hasta 10 s cada uno en el peor caso, y el deadline más tardío es 7 s antes de los 300 s), y el envío a Discord deja 6 s antes del deadline para anotar cómo terminó (`RESERVA_ANOTAR_MS`): así no queda `enviando` a mitad de camino. Una lectura del mapa que termina en los últimos ~10 s deja el aviso pendiente para el barrido.

**Una sola vez por grabación — la marca (columna `aviso_ads`):** NULL = ficha de antes del aviso (como la de CUENTA_QA): **no sale sola, ni reprocesándola con `?forzar=1`** · `''` = ficha nueva todavía sin aviso (así la inserta `reclamar`; si el aviso estaba apagado al marcarla lista, queda así y tampoco sale sola) · `pendiente:<ms>` · `enviando:<ms>` (alguien lo tomó; si la invocación se cortó a mitad, no se repite solo: el `GET` de estado lo marca "colgado" pasados 2 minutos) · el id del mensaje de Discord (salió) · `dudoso:<ms>` (Discord no respondió o se cortó la conexión a mitad del pedido: puede haber salido; no se repite solo, la misma regla que el aviso de #📝-kickoff) · `error:<ms>` (Discord lo rechazó, 400/404: el webhook está mal, o la ficha no se pudo leer; no se repite solo). Un error pasajero que seguro no publicó (5xx, 429, sin tiempo) la devuelve a `pendiente`. Tomarla es un UPDATE con condición sobre la marca que se leyó (`tomarAvisoAds`), así que si la ruta del mapa, `procesar.ts` y el barrido lo intentan a la vez, sale una sola vez. **Retomar o forzar el kickoff (`?forzar=1`) no lo repite**: `marcar` solo deja la marca en una fila nueva sin aviso (`''`) o si ya estaba pendiente.

**A mano** (con el Bearer de siempre):
```bash
# El texto, sin escribir ni mandar nada (con la ficha guardada y sus tildes)
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff -H "Authorization: Bearer $CRON_SECRET" | jq
# Manda el que nunca salió (una ficha de antes, como la de CUENTA_QA) o el que Discord rechazó; si el mapa se está leyendo, espera
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff -H "Authorization: Bearer $CRON_SECRET" | jq
# Lo vuelve a mandar ya, aunque haya salido (salvo que otro lo esté mandando ahora)
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff -H "Authorization: Bearer $CRON_SECRET" | jq
```
`POST ?recording_id=<una ficha lista>` sin `quien` corre el barrido de esa grabación y responde **200** `{ estado: 'lista', aviso_ads }` (antes respondía 409 "no tiene el payload guardado", aunque el aviso hubiera salido).

En seco con un payload (`?dry=1` del modo manual) la respuesta trae `mensaje_ads`; `scripts/probar-kickoff.mjs` lo guarda en `salida-<id>.json` y en `ficha-<id>.md` (con `--ads` lo imprime). El `GET` de estado muestra, cuando hay canal, `aviso_ads: { encendido, canal (el NOMBRE de la variable), canal_ok, ADS, revisar? }` y la marca de cada fila en `ultimas`:
- `canal_ok`: el webhook del canal existe (un **GET** al webhook de Discord, que devuelve sus datos **sin publicar nada**; ni la URL ni el token van en la respuesta). `false` = Discord respondió 401/403/404: se borró o se regeneró y cada aviso terminaría rechazado (con `canal_motivo`); `null` = no se pudo comprobar (red, 5xx).
- `revisar` (solo si hay algo): de las últimas 10 filas, los avisos rechazados, dudosos, colgados a mitad (`enviando` de más de 2 minutos) o pendientes de más de una hora y 12 minutos (no hubo barrido), cada uno con qué sumarle a `?recording_id=…` para reintentarlo.

**Antes del deploy (o apenas después), para probarlo:** el `GET` de estado (`canal_ok: true`) y `?recording_id=1&aviso_ads=1&dry=1` (el texto de CUENTA_QA con sus tildes, sin mandar nada).

**fathom-anuncios en las kickoffs (resuelto el 24/10, deploy `g8wqhdxeo`):** la sesión "Bot C.J. · Anuncios" (g02) hizo que `/api/fathom-anuncios` consulte `cj_kickoffs` (solo lectura): si la grabación es una kickoff `lista`, la omite y ADS recibe solo este «🚀 Para lanzar»; si está `procesando`, espera hasta 210 s; en error, colgada o sin fila, manda igual. Su webhook de Fathom (ArQDFwUufvBZs2xu, my_recordings de RESPONSABLE_HUB) y `FATHOM_WEBHOOK_SECRET` quedaron activos en ese deploy. Detalle en `docs/FATHOM-ANUNCIOS.md`.

**Tests:** `scripts/test-bot-kickoff-ads.mjs` (73, sin red, sin base, sin Discord): el texto (lo que lleva, nada de ideas ni ganadores, escape, menciones, sin ID, sin ID del CRM, mapa ok / con diferencias / pin de Meta / sin mapa / sin video / error / colgado / anotado a mano, frenos del portfolio, WhatsApp Business sin confirmar o confirmado por Meta o a mano, moneda, fecha y WhatsApp de destino a mano o sin cargar, la provincia y el país, el "desde… hasta…" y la distancia al estudio, un tilde con un mail en la nota, largo con todo largo y con un ítem enorme, la ficha de CUENTA_QA si está la salida), la marca y cuándo está listo (también una lectura vieja), una sola vez (también dos a la vez), sin tiempo (15 s, y el barrido sin tiempo ni busca), Discord dudoso (timeout y corte de conexión) / pasajero / rechazado, el aviso a RESPONSABLE_HUB (rechazado, dudoso, ficha que no se puede armar; no en el pasajero ni a mano; si falla, no rompe), el barrido (también colgado y los 7 días), a mano (`1`, `forzar`, dry, apagado, una lectura vieja), `procesarKickoff` (sin mapa, lectura aceptada, disparo sin respuesta o sin conexión, sin API key, retomar o forzar sin repetir, forzar una ficha de antes sin mandarla, retomar una en error, dry, no kickoff, duplicada, apagado), `trasWebhook` (el barrido corre aunque fallen el proceso o la purga), la ruta del mapa (ok, sin mapa, sin video, error con y sin reintento solo, redisparo sin respuesta, sin key, sin ffmpeg, ya leído, dry, 409, aviso que falla, el barrido al final, un reloj que avanza hasta los 283 y los 291 s), el canal, la mención y el aviso a RESPONSABLE_HUB con un fetch falso, `comprobarCanalAds` y `revisarAvisosAds`, el SQL contra un Neon falso y la ruta (`aviso_ads` mal pedido o sin base; una ficha lista sin `quien` con Neon y Discord falsos → 200; el `GET` de estado con el nombre del canal y `canal_ok`, nunca el webhook ni el token).

## Variables de entorno

| Variable | Para qué | Si falta |
|---|---|---|
| `BOT_ANTHROPIC_API_KEY` (Vercel) o `ANTHROPIC_API_KEY` (local) | Claude | La grabación queda en `error` y se avisa a RESPONSABLE_HUB |
| `FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS`, `FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M` **(nuevas)** | Firma del webhook de cada cuenta de Fathom (`whsec_…`, 24 bytes o más). `FATHOM_KICKOFF_WEBHOOK_SECRET` sigue valiendo como el de RESPONSABLE_HUB. Ver "Varios Fathom" | Sin ninguna usable, la ruta responde **503** (nunca acepta sin firma); sin la de una persona, sus envíos dan 401 |
| `DISCORD_WEBHOOK_KICKOFF` **(nueva)** | Canal del aviso (lo elige RESPONSABLE_HUB); desde el 24/10 (noche), también el aviso corto a RESPONSABLE_HUB cuando el «🚀 Para lanzar» a ADS no salió y no se repite solo | `error` antes de llamar a Claude; la falla del aviso a ADS queda solo en el log |
| `DISCORD_ID_TOMAS` **(nueva)** | Mención de RESPONSABLE_HUB | Usa el ID de RESPONSABLE_HUB que ya usa fathom-anuncios |
| `DISCORD_ID_GERO_M` **(nueva)** | Mención de COORDINACION | El aviso sale con "COORDINACION" en texto, sin notificar |
| `KICKOFF_MODELO`, `KICKOFF_ESFUERZO` (opcionales, nuevas) | Otro modelo / pisar el esfuerzo de las dos llamadas | `claude-opus-5-5`, `high` (ficha) y `medium` (ideas) |
| `CRON_SECRET` (ya existe) | Modo manual y `GET` de estado (`Authorization: Bearer …`, nunca `?key=`); desde el 24/10 también el disparo de `/api/bot/kickoff/mapa` desde el bot | 401; sin él, el disparo del mapa falla y queda anotado en `zona_video` (para reintentar) |
| `DATABASE_URL` (ya existe) | `cj_kickoffs` | La grabación queda en `error` |
| `META_ANUNCIOS_TOKEN` / `META_CLIENTES_TOKEN` (ya existen) | Ganadores y portfolio (solo GET) | Sigue sin ganadores y con el portfolio "Meta no pudo leer la cuenta" (anotado) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SHEET_ID_CLIENTES`, `CLICKUP_TOKEN` (ya existen) | CRM y rama por cuenta, solo lectura | Sigue sin lista (cliente "sin verificar") o con menos cuentas |
| `DESPACHO_URL` **(nueva, opcional)** | Dirección del Despacho para el link a la ficha (https) y, desde el 24/10, a dónde se dispara la lectura del mapa (`<DESPACHO_URL>/api/bot/kickoff/mapa`) | `${AUTH_BASE_URL}/`. `AUTH_BASE_URL` ya no se usa para este link |
| `FATHOM_API_KEY_TOMAS`, `FATHOM_API_KEY_GERO_M` | API key de Fathom de cada uno: recuperar kickoffs por `recording_id` y, desde el 24/10, **bajar el video para leer el mapa** (ver "Varios Fathom") | El mapa no se lee: `zona_video` queda `sin_key` y el faltante dice "conectar la API key de Fathom de <quien> para leer el mapa" |
| `KICKOFF_PANTALLA` **(nueva, opcional)** | `0` apaga el link a la ficha en el aviso | Link encendido (si el cliente tiene ID del CRM) |
| `KICKOFF_REVISOR_TOMI`, `KICKOFF_REVISOR_GERO_M` **(nuevas, obligatorias en producción)** | Mail de login (Google) de RESPONSABLE_HUB y de COORDINACION, separados por coma si son varios: quién aprueba las ideas en la pantalla | **En producción nadie aprueba** (falla cerrado). Solo en desarrollo vale el apellido como palabra entera en el nombre de la sesión |
| `DISCORD_WEBHOOK_KICKOFF_ADS` **(nueva, opcional)** | Un canal propio para el aviso a ADS «🚀 Para lanzar» (si no está, va a #📣-ads con `DISCORD_WEBHOOK_ANUNCIOS`) y para el ✅ de las ideas aprobadas por RESPONSABLE_HUB y COORDINACION | El «🚀 Para lanzar» va a #📣-ads; el ✅ de las ideas aprobadas no se le manda |
| `DISCORD_WEBHOOK_ANUNCIOS` (ya existe en Vercel, la usa fathom-anuncios) | #📣-ads: el canal del aviso a ADS si no está `DISCORD_WEBHOOK_KICKOFF_ADS` | Sin ninguno de los dos, el aviso a ADS no sale (ni queda pendiente) |
| `DISCORD_ID_VALENTINO` (ya existe en Vercel: 1, la usa fathom-anuncios) | Mención de ADS (`allowed_mentions` solo ese user) | El aviso dice "ADS" en texto, sin notificarlo |
| `KICKOFF_AVISO_ADS` **(nueva, opcional)** | `0` apaga el aviso a ADS | Prendido: con `DISCORD_WEBHOOK_ANUNCIOS` ya en Vercel, **sale apenas se deploya** |
| `KICKOFF_AVISO_MAPA` **(nueva, opcional; decisión pendiente de RESPONSABLE_HUB)** | `1` prende el renglón que manda la ruta del mapa a #📝-kickoff cuando la lectura termina y el mapa no coincide con lo dicho, no deja leer el recorte o no aparece (sin menciones, con el link a la ficha) | Apagado: el resultado del mapa se ve solo en la ficha |

`.env.local` ya tiene `DISCORD_WEBHOOK_KICKOFF`, `DISCORD_ID_TOMAS` y `DISCORD_ID_GERO_M`; no tiene `KICKOFF_REVISOR_*` (en local vale el apellido). Falta revisar qué tiene cargado Vercel.

## Puesta en marcha (el orden importa)

1. ~~Las ediciones compartidas de abajo (ruta "propia" y fuera del proxy) y el deploy~~: hechas, publicado el 24/10 (`ovc3cbtre`). Lo nuevo de la tarde (mapa integrado, dedupe, grabador, aviso) espera el próximo deploy: ver "Pendientes reales (24/10, tarde)".
2. En Vercel: `BOT_ANTHROPIC_API_KEY` (ya está), `DISCORD_WEBHOOK_KICKOFF`, `DISCORD_ID_TOMAS`, `DISCORD_ID_GERO_M` y, **obligatorias**, `KICKOFF_REVISOR_TOMI` (el mail con que entra RESPONSABLE_HUB) y `KICKOFF_REVISOR_GERO_M` (el mail de Google con que entra COORDINACION: no es `ggeroo`, que es su usuario de Discord). Sin ellas, en producción nadie aprueba las ideas.
3. En la planilla de Accesos: marcarle a COORDINACION la sección **Clientes** (si es closer o setter, el link de Discord lo manda a Ventas y no ve la ficha).
4. Prueba con `?dry=1` contra producción (abajo) con un kickoff real.
5. Recién ahí, crear el webhook de cada cuenta de Fathom con el CLI: ver "Varios Fathom (RESPONSABLE_HUB y COORDINACION)" → "Puesta en marcha, para cada uno". Grabaciones **My recordings**, con Transcript, Summary y Action items; cada secreto va a su variable (`FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS`, `_GERO_M`) y se redeploya.

Comprobación: el `GET` de estado tiene que mostrar todo en `true`, `fathom.firmas` con las dos variables y `fathom.firmas_invalidas` e `ignoradas` vacías.

## Probar en seco

**Local** (lo que se corrió el 24/10, sin base ni Discord):

```bash
node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-kickoff.mjs 1
```

- Lee `.cache/kickoff-prueba/payload-<id>.json`.
- Carga `.env.local` sin imprimir nada.
- Lee el CRM y Meta (ganadores y portfolio) solo lectura y llama a Claude de verdad.
- Borra `DATABASE_URL`, `META_ADS_WRITE_TOKEN` y los webhooks de Discord del proceso, y deja salir a fetch solo a los hosts de lectura. A Meta, solo subpedidos GET.
- Guarda `salida-<id>.json` y `ficha-<id>.md`.
- Con `--rearmar` **no llama a Claude** (el host de Anthropic queda bloqueado): toma la extracción, las ideas y los ganadores de la ficha guardada, vuelve a chequear el **portfolio real** (solo GET, con 30 s de tope porque no hay Claude que caliente el descubrimiento) y rearma la ficha final, el mensaje y el markdown.

**En producción** (cuando esté el deploy):

```bash
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' --data @reunion.json | jq
curl -s '${AUTH_BASE_URL}/api/bot/kickoff' -H "Authorization: Bearer $CRON_SECRET" | jq
curl -s '${AUTH_BASE_URL}/api/bot/kickoff -H "Authorization: Bearer $CRON_SECRET" | jq
```

**Reintentar** una grabación (usa el payload guardado, reusa ficha e ideas, no repite el aviso): `POST …/api/bot/kickoff?recording_id=123` con el Bearer. Con `&forzar=1` se rehace todo y se avisa de nuevo.

**Tests** (sin red, sin base, sin Claude), uno por uno:

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff.mjs              # 106 (24/10)
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-portfolio.mjs    # 92 (24/10)
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-fathom.mjs       # 51 (24/10, tarde)
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-vista.mjs        # 65 (24/10)
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-mapa.mjs         # 75 (24/10, tarde)
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-integracion.mjs  # 71 (24/10, tarde: dedupe, grabador, mapa integrado, ruta asincrónica, aviso, tercera revisión)
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-ads.mjs          # 73 (24/10, noche: el aviso a ADS y su revisión)
```

## Revisión del 24/10 (dos revisores: fidelidad y código)

Se corrigió lo que dieron por real: link roto a la ficha y aviso sin datos; ganadores de Uruguay mezclados; la base de laboral copiaba el control (CUENTA_QA); el aviso cortaba en mitad de palabra y repetía los filtros; contexto del mercado en el avatar (rurales en negro); zona más afirmada que lo dicho; mensual del presupuesto; portfolio "no se habló" con cita; apodo y "carpeta de Cris"; links al inicio de renglones de 2 minutos; controles de la cita en su renglón, del costo citado y de la subrama de las ideas; filtros del avatar en los ganchos y ART; detalles del prompt (subramas sin filtros, descartadas, a futuro, compromisos de RESPONSABLE_HUB, fechas con día); ideas viejas reusadas sobre una ficha re-extraída; aviso duplicado; margen de tiempo después de las ideas; aviso de error sin fila; lecturas que creaban la tabla; payloads sin purga; motivos del CRM sin limpiar; copy de otros abogados a Claude; tests que faltaban. Versiones nuevas: prompt `k2-2026-10-24`, ideas `i2-2026-10-24`, base `kb-laboral-2-2026-10-24`.

**Segunda corrida (k2/i2, en seco):** 92,9 s (ficha 65,6 s, ideas 26,3 s, Meta 20,8 s en paralelo), 36.212 tokens de entrada y 10.707 de salida, unos **USD 0,36**, 0 ajustes de la validación.
- Rama laboral con dos subramas cortas: despidos, y despido después de un accidente de trabajo (a confirmar). Penal y sucesiones quedan en descartadas; familia a futuro, con el avatar que dijo CUENTA_QA (hombres que se divorcian).
- Avatar: 1,5 años o más, en blanco o mitad en blanco; sin pasantes, sin poca antigüedad, sin trabajo totalmente en negro, y el contexto de la zona (muchos rurales en negro).
- Zona: Tres Esquinas, Pedernal, Caucete y El Bordón (de oído), sin inferir el centro. Se presenta como «San CUENTA_QA capital» si un lead pregunta, con su propia cita. El estudio está en Media Agua, a 60 km, y CUENTA_QA acepta viajar. País AR.
- Presupuesto: USD 8–10 por día (~USD 240–300 por mes), con la evidencia del mensual (15:48).
- Portfolio: tarjeta y WhatsApp mencionados sin verificar; el resto, no se habló.
- 3 faltantes: el mapa, el portfolio y que la grabación terminó a las 09:22 con el evento agendado hasta las 09:45.
- 10 ganadores, todos de Argentina (4 de Uruguay afuera). Las 5 ideas llevan los filtros en el gancho, evitan el rubro rural y la del accidente dice que no se buscaron ganadores de ART.

## Segunda revisión del 24/10 (pantalla, Fathom y producto: dos revisores)

Código:
- **Secretos de webhook:** uno de menos de 24 bytes (un placeholder como `whsec_AA`) cuenta como mal configurado: antes abría la ruta con una clave de 1 byte (256 intentos). Lista cerrada: solo las variables de cada persona y la de compatibilidad; otra con el mismo prefijo (`_TOMAS_VIEJO`) no autentica y sale en `ignoradas` (log y GET de estado).
- **Transcripción vacía o con horas ilegibles** al recuperar por la API: 502 en vez de una fila `omitida` para siempre.
- **Huella de las ideas:** la manda la pantalla (las que vio quien aprueba); si el bot las rehízo, 409 `ideas_cambiaron` sin escribir.
- **Revisores:** en producción, sin `KICKOFF_REVISOR_*` nadie aprueba (antes "Mozzini" o cualquier "RESPONSABLE_HUB" que viera Clientes podía); fuera de producción, el apellido como palabra entera y nunca por el mail.
- **Plazos:** el tope duro de los envíos cuenta desde que llegó el pedido (`depsReales(t0)`), también en el webhook.
- **Cliente en el UPDATE:** tildes, marcas y revisión llevan `upper(id_crm)` = el de la URL (si el bot cruzó la ficha con otro cliente en el medio, no se escribe en la del otro).
- **Barrera HTTP** de la API de la pantalla en `atenderPost` (acciones.ts), con tests: 401/403, mismo origen exacto, 415, 404, 413, 400, 503.
- **CLI:** `--quien constructor` ya no pasa (`Object.hasOwn`). **Demo:** sin frases ni ubicación de la llamada real.

Producto:
- **Para lanzar** (arriba de la ficha): lo que necesita ADS, con fecha estimada y WhatsApp de destino a mano. El ✅ de la pantalla a ADS (ideas aprobadas por los dos) quedó listo y apagado: sale solo con `DISCORD_WEBHOOK_KICKOFF_ADS` (decisión de RESPONSABLE_HUB). Ojo: eso es otro mensaje que el «🚀 Para lanzar» del 24/10 (noche, ver "Aviso a ADS"), que sale **prendido** apenas se deploya, en #📣-ads con `DISCORD_WEBHOOK_ANUNCIOS` (salvo `KICKOFF_AVISO_ADS=0`).
- **Faltantes que se cierran:** cada uno se marca como hecho con nota (`faltantes_checks`); la zona del mapa dice qué anotar y trae su ▶; "la grabación cortó" pasó a la cabecera; la cuenta que encontró sola el tablero, faltante para cargarla en el CRM; la moneda de la cuenta, si no es la del presupuesto.
- **Pendientes** sin el portfolio cuando Meta se consultó; **mails** tapados en toda la pantalla (los del equipo, por su nombre corto).
- **"Sin verificar"** solo para la verificación de Meta; textos del portfolio sin permisos ni tokens (el detalle técnico, a los ajustes).
- **Presupuesto de arranque** ("USD 8 por día para arrancar (hasta 10)") y **renglón de lanzamiento** armado desde los acuerdos.
- **Revisión:** pedir cambios avisa al otro revisor; aprobadas por los dos, ✅; historial de hasta 5 pasos; a quien no es revisor se le dice con qué nombre entró y qué variable falta.
- **Aviso:** zona por los lugares, avatar "✋ afuera:", 👉 a la ficha, faltantes con etiquetas cortas, "a tildar". **Tilde:** "Quitar tilde" explícito y la nota precargada. **Ganadores:** cerrados en un `<details>`, estados con texto.
- **Prompts:** k3 (RESPONSABLE_HUB o COORDINACION, pendientes sin portfolio, días hábiles) e i3 (el filtro en no más de 3 ganchos, nada de "en blanco" ambiguo, ejemplos por su ángulo, coma decimal).

Descartado: nada. Quedó afuera, por ser de otra sesión o una decisión: el bloque en `/anuncios` y el acceso de ADS, el tilde por idea (opcional), y la deduplicación de una kickoff grabada por los dos.

## Tercera revisión del 24/10 (tarde: mapa integrado, dedupe y aviso; dos revisores, código y producto)

Sin publicar. Se corrigió todo lo que dieron por real menos un caso (abajo).

Código:
- **Aviso:** en los últimos niveles se acorta, en un límite de palabra, un ítem que solo ya no entra; el recurso final saca ideas enteras y nunca se lleva el 👉 ni el ⚠️ (antes `.slice(0, 1999)` cortaba la cola). Tests con los textos largos de la revisión.
- **Dedupe:** dos grabaciones del MISMO Fathom (cortada y retomada) nunca son "la otra" (`mismaReunion` y, en la base, `buscarGemela` saltea el mismo `grabador`); sin calendario para comparar (COORDINACION entra por el link del Meet), la misma si empiezan a menos de 5 min, se pisan y comparten a alguien que habla (huellas de los nombres de la transcripción, sin el de quien grabó cada una); la clave anota si la grabación se va a procesar (`procesable`) y una que va a quedar en error u omitida no busca gemela ni le gana a la otra.
- **Mapa:** clave propia (`zona_mapa_video`) para lo que pide el mapa ya leído ("revisar", "confirmar"): una nota del recorte anotada a mano antes no lo tapa. `planMapa` no pide el video si la ficha no tiene el minuto de la zona (queda anotado el porqué); la ruta del mapa anota también lo que corta la verificación (sin ffmpeg, sin la clave de Claude, sin el minuto), en palabras, y `procesar.ts` no lo pisa con "no se pudo disparar".
- **Tiempos:** el disparo del mapa y su escritura se acotan al deadline (12 s reservados para escribir; sin tiempo no escribe); las ideas dejan 10 s más cuando hay mapa por leer; en la ruta, Claude deja 12 s para guardar el resultado.
- **Migración:** `information_schema` en el schema de la conexión.

Producto:
- **Mientras el bot lee el mapa:** la pantalla no pide anotarlo a mano, dice que lo está leyendo y se actualiza sola cada 20 s (hasta 8 minutos, `RefrescoMapa.tsx`); el faltante y "Para lanzar" dicen lo mismo; el aviso, "(el bot la está leyendo del video: el resultado queda en la ficha)". Sin la API key, el aviso lo dice.
- **Zona en la pantalla:** lo que se dijo → lo que se ve en el video (chips punteados, ✓ en lo que se dijo) → las diferencias. Con un polígono no se repite la zona como "sin que se dijera". Con un pin de Meta, "Para lanzar" lleva la ubicación configurada con su radio ("San CUENTA_QA, San CUENTA_QA, Argentina +17 km · sin Chimbas…"), no los nombres que se leen dentro del círculo; con un polígono, los lugares y los límites.
- **Textos del mapa:** "se nombraron Tres Esquinas, Pedernal y el Bordón y en el mapa no aparecen sus nombres: pueden estar dentro sin nombre, afuera o mal oídos (Tres Esquinas y el Bordón, de oído)", en singular o plural; el aviso nombra los lugares. Sin mapa en esos minutos, la pantalla dice cuáles miró el bot y el ▶ es a cuando se habló de la zona. Un error pasajero dice cómo reintentar ("pedile a Claude que relea el mapa de la grabación …") y se reintenta una vez solo. Coincide pero se lee en parte: "confirmar el recorte leído del video".
- **Límites y notas del mapa:** se cortan en una frase o una palabra (600 caracteres), no a la mitad; el prompt pide límites cortos por punto cardinal (`m3-2026-10-24`).
- **Duplicadas:** el modo manual nombra la grabación que ganó (para reintentar esa) en vez de sugerir `&forzar=1`; la cabecera dice "También la grabó RESPONSABLE_HUB (Fathom): es la misma reunión, no se procesa aparte" y "Grabada con el Fathom de X" en vez de "La hizo X" (también el selector y el markdown).
- **Aviso:** la subrama conserva «(a confirmar)»; "portfolio (N): ver 🧾"; ganchos con comillas adentro sin «««»»». Faltantes: un solo ▶ (el link), no también en el texto.
- **Aviso cuando el mapa termina** (`KICKOFF_AVISO_MAPA=1`, apagado: decide RESPONSABLE_HUB): un renglón a #📝-kickoff sin menciones cuando el mapa no coincide, no se lee o no aparece. Va suelto (un webhook de Discord no puede responder a otro mensaje).

Descartado (con motivo):
- **Leer el mapa con la grabación gemela cuando la ganadora es de COORDINACION y falta su API key.** Depende de un faltante de configuración que ya está en los pendientes (cargar `FATHOM_API_KEY_GERO_M` en Vercel); hacerlo pide una lectura cruzada entre dos grabaciones (la gemela casi siempre llega después que la ganadora, con su propio desfase de tiempo, y el resultado se guarda en otra fila) que no se puede validar sin una kickoff grabada por los dos. Queda como opción en los pendientes.

## Cuarta revisión del 24/10 (noche: el aviso a ADS)

Sin publicar. Se corrigió lo que se confirmó (ver "Aviso a ADS" para el detalle):
- **Fallas que nadie veía:** si Discord rechaza el aviso (el webhook de #📣-ads vencido o regenerado) o no confirma, a RESPONSABLE_HUB le llega **un** aviso corto en #📝-kickoff con cómo reintentarlo; el `GET` de estado comprueba que el webhook exista (`canal_ok`, con un GET que no publica nada) y lista lo que hay que revisar (`revisar`: rechazados, dudosos, colgados, pendientes viejos). El barrido corre también al final de cada lectura del mapa y mira 7 días (antes 3).
- **Zona:** la provincia y el país delante, el "desde… hasta…" como se dijo y la distancia al estudio. Con CUENTA_QA: «Provincia de San CUENTA_QA, Argentina: desde Tres Esquinas (de oído) y Pedernal hasta Caucete y el Bordón (de oído) · El estudio está en Media Agua; …a 60 km».
- **WhatsApp:** con WhatsApp Business sin confirmar ya no dice "sin frenos" (es el destino de los anuncios) y el 📅 dice "📲 WhatsApp de destino: sin cargar (pedíselo a RESPONSABLE_HUB)". El 👤 pasó a "A quién le habla (para el copy)": esos filtros no se segmentan en Meta.
- **Duplicados y marcas:** un corte de conexión a mitad del envío queda `dudoso` (como en #📝-kickoff), no se reenvía solo; el redisparo del reintento solo que no responde a tiempo se da por reintentando (no manda un aviso con el error un minuto antes de que el mapa quede leído); una lectura vieja (`pedido` o error pasajero de hace horas) no se espera; si armar el texto lanza, la marca queda en `error` (no `enviando` para siempre); se toma con 15 s y el envío deja 6 s para anotar.
- **Fichas de antes:** reprocesar a CUENTA_QA con `?forzar=1` ya no le manda el aviso a ADS (la marca NULL es "de antes"; las filas nuevas entran con `''`). `POST ?recording_id=<lista>` sin `quien` responde 200 con lo que hizo el aviso (antes, 409).
- **Privacidad:** la nota de un tilde del portfolio con un mail se tapa (`checkVista`), en la pantalla y en el aviso.
- **Tests:** 73 en `test-bot-kickoff-ads.mjs` (antes 49), con lo que faltaba (sin ffmpeg, un reloj que avanza, `trasWebhook`, la ruta con una ficha lista, el corte de conexión, el redisparo sin respuesta, la lectura vieja, retomar una ficha en error).

Descartado o ajustado (con motivo):
- **Avisar a RESPONSABLE_HUB desde el barrido por una pendiente de más de una hora:** el barrido que la encuentra la manda en ese mismo momento (la espera ya venció), así que el aviso hablaría de algo que se está resolviendo; si después falla para siempre, ya cae en el aviso de rechazado o dudoso. Lo único que no se puede detectar sin un cron (que no corra ningún barrido) queda a la vista en el `GET` de estado (`revisar: pendiente_viejo`).
- **`MIN_TIEMPO_ADS_MS` en 15 s y no 25 s:** con la reserva de 6 s para anotar, 15 s ya cubren el peor caso (tomar y anotar con su tope de 10 s cada uno, antes de los 300 s). Con 25 s, toda lectura del mapa que terminara después de los 268 s dejaba el aviso al próximo barrido.

## Costos

Claude Opus 5.5 cuesta USD 4 por millón de tokens de entrada y USD 20 por millón de salida (el razonamiento se cobra como salida).
- Un kickoff de unos 20 minutos cuesta unos **USD 0,30** entre las dos llamadas.
- Uno de 45 minutos, del orden de USD 0,45 a 0,60.
- Con 3 a 5 kickoffs por semana, USD 5 a 12 por mes.
- Las grabaciones que no son kickoff pagan solo la extracción (USD 0,15 a 0,30).

Las duplicadas y las omitidas no llaman a Claude. Meta y el CRM son lecturas cacheadas.

## Seguridad y privacidad

- **Webhook:** firma Standard Webhooks sobre el cuerpo crudo, en tiempo constante, con ventana de 5 minutos, contra la lista cerrada de secretos (de 24 bytes o más). Sin ninguno usable responde 503.
- **Pantalla:** sesión de Google con Clientes, mismo origen exacto y JSON chico; las escrituras van con condición sobre lo que se vio y sobre el cliente de la URL; aprobar ideas, solo con `KICKOFF_REVISOR_*` en producción. Ningún mail llega al navegador.
- **Modo manual y estado:** solo con `Authorization: Bearer <CRON_SECRET>`.
- **Discord:** las únicas menciones son las de RESPONSABLE_HUB y COORDINACION (el aviso del mapa, con `KICKOFF_AVISO_MAPA=1`, no menciona a nadie) y, en el aviso a ADS de #📣-ads, solo la de ADS (el aviso de su falla, en #📝-kickoff, solo a RESPONSABLE_HUB). Ese aviso no lleva las ideas ni los ganadores de otros clientes, y ningún mail: sale de `armarVista`, que tapa los mails también en la nota de los tildes del portfolio (`checkVista`, desde el 24/10 noche: antes "pedirle el acceso a fulana@…" llegaba tal cual a la pantalla y al aviso). Los motivos de error se limpian de URLs y claves. El `GET` de estado comprueba el webhook de #📣-ads con un GET que no publica nada y no devuelve ni la URL ni el token.
- **Ganadores:** son anuncios de otros clientes y solo sirven de referencia interna. El nombre del otro cliente no va a Claude, ni a Discord, ni al markdown. Nunca se le mandan al cliente nuevo.
- **Datos que se borran:** el payload, que trae la transcripción y los mails, se borra al terminar; en las filas que quedan en error, a los 14 días.
- **Anuncios de otros clientes:** el copy y el nombre del anuncio van a Claude anonimizados (sin teléfonos, @usuarios, "Dra. X" ni el nombre de ese cliente).
- **La misma kickoff grabada por los dos:** la clave que queda en la fila (`dedupe`) guarda HUELLAS de los mails de los invitados y de los nombres de quienes hablan (sha256 truncado, con un prefijo fijo), no los mails ni los nombres.
- **El video del mapa:** los cuadros viven solo en memoria mientras se llama a Claude; `zona_video` guarda la descripción del mapa, los momentos, los tokens y el `download_id` de Fathom, nunca los cuadros ni la URL firmada. El disparo de la lectura va con el Bearer a la ruta propia del Despacho.

## Ediciones compartidas para producción (hechas el 24/10)

Las hizo la sesión dueña del Despacho y salieron en el deploy `ovc3cbtre`: los puntos 1 a 3 de abajo (y los de la ruta del mapa: ver "Zona desde el video"). `scripts/test-rutas.mjs` (24/10, tarde): 344 pasan y 2 fallan, las dos por `/api/resumen-diario?soloFoto=1` de `vercel.json` (de otra sesión, no del kickoff). Lo que sigue como pendiente: el link desde la ficha del cliente, el cron opcional y los opcionales 4 y 5.

1. ~~`lib/auth/rutas.ts`~~ (hecho): declarar la ruta como propia, igual que fathom-anuncios:
   ```ts
   { patron: '/api/bot/kickoff', quien: 'propio', motivo: 'Webhook de Fathom (kickoff, firma Standard Webhooks con FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS / _GERO_M) y modo manual / estado con Bearer CRON_SECRET. Falla cerrado.' },
   ```
   Coordinarlo con la sesión del alta si va a declarar `/api/bot/whapi` o un `/api/bot/*`.
2. ~~`proxy.ts`~~ (hecho): sumar `bot/kickoff` a la lista del matcher, al lado de `fathom-anuncios`.
3. ~~`docs/ACCESO-Y-ROLES.md`~~ (hecho): una fila para `/api/bot/kickoff`. Un test controla que cada patrón de `rutas.ts` figure ahí.
4. Opcional: exportar `batchConRespaldo` y `getGraph` de `lib/anuncios/meta.ts` para que `ganadores.ts` no tenga su propia copia chica del batch de Meta.
5. Opcional: `googleTexto()` en `lib/auth/googleRest.ts`, para refrescar la base de guiones desde Drive. Solo suma, pero ese archivo lo usa el proxy.
6. ~~Pantalla nueva `app/(shell)/clientes/[id]/kickoff/`~~: hecha (ver "Pantalla de la ficha en el Despacho"). Falta el link desde la ficha del cliente y publicar `/api/clientes/<id>/kickoff` (abajo, en esa sección).
7. Opcional: un cron de reintentos en `vercel.json`, igual que fathom-anuncios. Hoy se reintenta si Fathom reenvía la grabación o a mano por `recording_id`.

## Decisiones pendientes de RESPONSABLE_HUB

- **Base de laboral:** aprobarla o corregirla. ¿Largo de 500 a 800 o de unos 1.000 caracteres?
- **Filtro de CUENTA_QA:** ¿"en blanco o mitad en blanco" deja afuera todo lo totalmente en negro? RESPONSABLE_HUB ya escribió guiones "en negro" en su doc.
- **Subrama de accidente con despido** para CUENTA_QA: ¿entra o no?
- **Kickoffs de COORDINACION:** resuelto en el código (24/10): el prompt k3 dice que la hacen RESPONSABLE_HUB o COORDINACION, recibe quién grabó en `<reunion>` ("OPERADOR_AUTORIZADO Mozzi (COORDINACION, de Capital Jurídico)") y pone los compromisos del equipo a nombre de quien los dijo; la ruta acepta un secreto por cuenta. Falta probarlo con una kickoff real de COORDINACION.
- **ADS y la ficha (antes de dejar ClickUp):** la pantalla pide la sección Clientes, y ADS solo entra a `/anuncios` con la clave del tablero. Opción (a): darle un usuario en la planilla de Accesos con solo Clientes (vería todos los clientes). Opción (b), mejor: un bloque "Para lanzar" de solo lectura dentro de `/anuncios` (archivos de otra sesión), armado con el mismo modelo (`armarVista(...).lanzar`, ya hecho y probado). Desde el 24/10 (noche), además, ADS recibe el «🚀 Para lanzar» en #📣-ads apenas la ficha queda lista (ver "Aviso a ADS"), sin abrir nada.
- **Instagram y WhatsApp en Meta:** con los permisos del token de hoy no se pueden leer. Si se quieren automáticos, hace falta un token con `instagram_basic` y `pages_read_engagement`. El número de WhatsApp de destino, mientras tanto, se carga a mano en "Para lanzar".
- **Aviso cuando el mapa del video no coincide** (hecho el 24/10 y **apagado**): con `KICKOFF_AVISO_MAPA=1`, la ruta del mapa manda un renglón a #📝-kickoff cuando la lectura termina y el mapa no coincide con lo dicho, no deja leer el recorte o no aparece en esos minutos ("🗺️ CUENTA_QA: el mapa del video no muestra Tres Esquinas, Pedernal ni el Bordón (lo que se nombró en la llamada): revisar la zona antes de lanzar · ficha"), sin menciones. Si coincide, nada. Falta que RESPONSABLE_HUB decida si lo prende.

## Archivos

- `lib/bot/kickoff/`:
  - `tipos.ts` (también el equipo con acceso, `EQUIPO_ACCESOS_BASE`, los tipos del portfolio final y el estado `duplicada`);
  - `dedupe.ts` (puro: la clave de la reunión y `mismaReunion`, para la misma kickoff grabada por los dos);
  - `mapa.ts` (zona desde el video: Fathom, ffmpeg y Claude, solo servidor), `mapa-zona.ts` (lo puro del mapa: combinar con lo dicho, textos, `ZonaVideoFicha`), `mapa-prompt.ts` y `mapa-api.ts` (la lógica de `/api/bot/kickoff/mapa`, con dependencias inyectables, y `dispararMapaReal`, que `servidor.ts` re-exporta);
  - `entorno.ts` (webhook, menciones, link a la ficha: lo comparten el bot y la API de la pantalla, sin cargar Claude ni Meta);
  - `portfolio.ts` (chequeo del portfolio en Meta, solo GET, y `combinarPortfolio`, la única fusión con la llamada);
  - `prompt.ts` (versión `k3-2026-10-24`) y `prompt-ideas.ts` (`i3-2026-10-24`);
  - `claude.ts` (llamada común, también con imágenes: la usa el mapa), `extraer.ts` e `ideas.ts`;
  - `ficha.ts` (puro: armado, faltantes, markdown);
  - `ganadores.ts`, `contexto.ts`, `mensaje.ts`, `registro.ts`;
  - `procesar.ts` (orquestador con dependencias inyectables), `servidor.ts` (dependencias reales);
  - `aviso-ads.ts` (24/10, noche): el aviso a ADS «🚀 Para lanzar» (texto puro desde `armarVista`, la zona para segmentar, la marca, cuándo está listo, el orquestador con dependencias inyectables, el aviso a RESPONSABLE_HUB si falla, el barrido, el modo manual, lo del `GET` de estado y las dependencias reales); `procesar.ts` también tiene `trasWebhook` (lo que corre en `after()` del webhook: procesar, purgar y barrer) y `vista.ts` tapa los mails de la nota de los tildes;
  - `kb/index.ts` y `kb/laboral.ts`.
- `app/api/bot/kickoff/route.ts`: webhook, modo manual (también por `recording_id`) y estado. `app/api/bot/kickoff/mapa/route.ts`: la zona desde el video (arma las dependencias de `mapa-api.ts`: el reintento solo y, con `KICKOFF_AVISO_MAPA=1`, el aviso).
- `app/(shell)/clientes/[id]/kickoff/_componentes/RefrescoMapa.tsx` (nuevo, cliente): mientras el bot lee el mapa, vuelve a pedir la ficha cada 20 s, hasta 8 minutos.
- `scripts/test-bot-kickoff.mjs`, `-portfolio`, `-fathom`, `-vista`, `-mapa`, `-integracion` (dedupe, grabador, mapa integrado, ruta asincrónica, aviso por ítems) y `-ads` (el aviso a ADS): tests.
- `scripts/probar-kickoff.mjs`: prueba en seco. `scripts/probar-mapa.mjs`: el mapa de punta a punta con un video armado.

## Varios Fathom (RESPONSABLE_HUB y COORDINACION)

Decisión de RESPONSABLE_HUB (24/10): las kickoffs las hacen RESPONSABLE_HUB **y** COORDINACION, cada uno con su cuenta de Fathom. Cada cuenta tiene **su** webhook hacia `/api/bot/kickoff`, con **su** secreto, y **su** API key para recuperar grabaciones.

Cómo queda:
- **Firma:** la ruta acepta el envío si verifica con alguno de `FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS`, `FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M` o `FATHOM_KICKOFF_WEBHOOK_SECRET` (el de RESPONSABLE_HUB de antes: se sigue aceptando). Prueba todos siempre, cada uno en tiempo constante. Sin ninguno usable: 503. Uno mal formado **o de menos de 24 bytes** (un placeholder como `whsec_AA`) queda en el log, no se usa y no tapa a los demás. **Lista cerrada:** otra variable con el mismo prefijo (un secreto viejo renombrado `_TOMAS_VIEJO`) no autentica; se loguea y sale en `fathom.ignoradas` del GET de estado.
- **Log:** dice el **nombre** de la variable que verificó ("firmada con FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M (gero_m)"), nunca el valor.
- **Quién firmó, en la base (24/10, tarde, sin publicar):** la ruta le pasa a `procesarKickoff` la cuenta que verificó (`grabador: tomas | gero_m`) y queda en `cj_kickoffs.grabador` (un reintento sin firma conserva la que estaba). En el modo manual, `?quien=` hace lo mismo. Sirve para la API key con que se baja el video del mapa y para el "Kickoff de RESPONSABLE_HUB / de COORDINACION" del aviso y la ficha cuando `recorded_by` no alcanza (no vino, o dice otro nombre): `quienGrabo(recorded_by, grabador)` y `ficha.grabo.cuenta_fathom`.
- **Solo grabaciones propias:** cada webhook va con `triggered_for: ['my_recordings']`. Con las compartidas del equipo, la grabación de uno llegaría también por el webhook del otro.
- **GET de estado:** cuando hay algo configurado, suma `fathom: { firmas, firmas_invalidas, ignoradas, api }`, solo con nombres de variables y de personas.
- **Archivos:** `lib/bot/kickoff/grabadores.ts` (personas, variables y firma con varios secretos), `lib/bot/kickoff/fathomApi.ts` (cliente de la API, solo lectura), `scripts/fathom-webhook-kickoff.mjs` (CLI) y `scripts/test-bot-kickoff-fathom.mjs` (tests, sin red).

| Variable | Para qué | Si falta |
|---|---|---|
| `FATHOM_API_KEY_TOMAS`, `FATHOM_API_KEY_GERO_M` **(nuevas)** | API key de Fathom de cada uno. En `.env.local`, para que el CLI cree o borre su webhook. En Vercel, solo para recuperar kickoffs por `recording_id` | El CLI explica qué falta y sale con 1. La recuperación responde 503 |
| `FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS`, `FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M` **(nuevas)** | Secreto del webhook de cada cuenta. Lo escribe el CLI en `.env.local`; en Vercel se carga a mano | Los envíos de esa cuenta: 401 |
| `FATHOM_KICKOFF_WEBHOOK_SECRET` | El secreto de RESPONSABLE_HUB de antes (compatibilidad) | Nada, si están los de arriba |

### Puesta en marcha, para cada uno (primero RESPONSABLE_HUB, después COORDINACION)

Va **después** del deploy con las ediciones compartidas (ruta propia y fuera del proxy). Los comandos se corren desde `$APP_DIR`.

1. **API key:** entrar a Fathom con **su** cuenta → **Settings → API Access → Generate API key**. COORDINACION la genera en la suya; no se pasa por chat.
2. **Pegarla** en `.env.local` en una línea: `FATHOM_API_KEY_TOMAS=…` o `FATHOM_API_KEY_GERO_M=…`.
3. **Probar en seco:** `node scripts/fathom-webhook-kickoff.mjs --quien gero_m --dry`. Muestra el pedido que haría, con la key como `<FATHOM_API_KEY_GERO_M, en .env.local>`, y no llama a nada.
4. **Crear el webhook:** `node scripts/fathom-webhook-kickoff.mjs --quien gero_m`.
   - Destino `${AUTH_BASE_URL}/api/bot/kickoff` (otro con `--url <URL_CONFIGURADA_PRIVADAMENTE>`), *my recordings*, con transcript, summary y action items.
   - El secreto de la respuesta va a `.env.local` como `FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M`, sin mostrarse.
   - Si esa variable ya está, no crea nada (no la pisa): avisa y sale con 1.
5. **Cargar el secreto en Vercel** (Production) sin que el valor pase por la pantalla:
   ```bash
   grep '^FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M=' .env.local | cut -d= -f2- | tr -d '\n' | vercel env add FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M production
   ```
   Para poder recuperar kickoffs desde producción, cargar `FATHOM_API_KEY_GERO_M` de la misma forma.
6. **Redeployar** y comprobar con el `GET` de estado que `fathom.firmas` incluya la variable.

Entre el paso 4 y el 6 Fathom ya manda y la ruta le responde 401. Esas grabaciones no se pierden: se recuperan por `recording_id` (abajo).

**RESPONSABLE_HUB:** si ya tiene un webhook creado a mano con `FATHOM_KICKOFF_WEBHOOK_SECRET`, sigue andando y no hace falta otro. Si se le crea uno con el CLI, una vez cargado `_TOMAS` en Vercel hay que borrar el viejo en Settings y sacar `FATHOM_KICKOFF_WEBHOOK_SECRET`. Si no, cada grabación llega dos veces: la segunda da "duplicada", pero es un envío de más.

Otros comandos del CLI:
- `--listar`: la API de Fathom **no** tiene cómo listar webhooks (solo crear y borrar). Muestra los que creó el CLI (`.cache/fathom-webhooks-kickoff.json`, sin secretos), si hay key y secreto por persona (sí/no) y remite a Fathom → Settings → API Access → Manage. No sale a la red.
- `--borrar <id>` (con `--quien`): borra el webhook. La variable del secreto queda: si no se crea otro, sacarla de `.env.local` y de Vercel; si se crea otro, sacarla de `.env.local` antes.
- `--dry` con cualquiera de los dos: muestra el pedido sin hacerlo.

### Recuperar una kickoff por recording_id

Sirve para la que el webhook no entregó: de antes del deploy, de antes de cargar el secreto en Vercel o una que dio 401. Necesita `FATHOM_API_KEY_<QUIEN>` en Vercel y el Bearer de siempre.

```bash
# En seco: ficha, markdown y aviso, sin escribir en la base ni en Discord
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff \
  -H "Authorization: Bearer $CRON_SECRET" | jq
# De verdad: lo mismo sin &dry=1
```

- `quien` es el que **grabó** la kickoff (`tomas` o `gero_m`): se usa su API key.
- Si la fila ya tiene el payload guardado, se usa ese y no se le pide nada a Fathom.
- Si la fila ya terminó (`lista`, `no_kickoff`, `omitida`), responde "duplicada" sin pedir nada. Con `&forzar=1` se rehace y se avisa de nuevo.
- `&desde=2026-10-20` (y `&hasta=`) acotan la búsqueda. Sin fecha se recorren hasta 25 páginas de reuniones, de la más nueva para atrás.
- La respuesta trae `origen` (`registro`, `fathom` o `cuerpo`) y, si vino de Fathom, `fathom: { quien, paginas, notas }`.
- **Errores:** 503 sin la key, 502 si Fathom rechaza la key (401/403), 404 si esa cuenta no la ve (probar con el otro `quien`), 429 con `Retry-After` si Fathom limitó los pedidos.
- **El `recording_id` no es el número del link de Fathom** (`fathom.video/calls/…` es otro id: en la prueba de CUENTA_QA, `calls/1` es la grabación 1). Sale del `GET` de estado si llegó por webhook, del conector de Fathom de Claude (`get_recording_by_url`) o de la lista de la API.

Cómo la trae (`fathomApi.ts`, doc oficial leída el 24/10): la API no tiene "traer una reunión por id".
1. `GET /meetings?include_action_items=true`, página por página con `cursor`, hasta encontrar el `recording_id`.
2. `GET /recordings/{id}/transcript` y `/summary`, en paralelo. La transcripción es obligatoria; si falla el resumen, sigue sin él y lo anota.
3. Arma el mismo payload del webhook (Meeting con transcript en renglones `HH:MM:SS`, `default_summary` y `action_items`) y lo valida con `validarReunion`.

Topes: 12 s por pedido y 40 s en total. Un 429 con `Retry-After` de hasta 10 s se espera y se reintenta una vez; un 5xx, una vez. Fathom permite 60 pedidos por minuto por cuenta, y 30 de los pesados (transcript y summary). La key va solo en la cabecera `X-Api-Key`: nunca en la URL, un mensaje o un log.

- **Transcripción vacía o con horas ilegibles** (la reunión ya figura en `/meetings` y la transcripción todavía no, o Fathom cambió el formato de la hora): `armarPayload` lanza y la ruta responde 502, sin procesar. Antes la fila quedaba `omitida` (estado final) y desde ahí todo daba "duplicada".

**Tests:** `node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-fathom.mjs` (51, sin red, sin base, sin Claude ni Discord).

### Falta (fuera de estos archivos)

- ~~**Quién firmó, en la base**~~: hecho el 24/10 (columna `grabador`, arriba). Sin publicar.
- ~~**La misma kickoff grabada por los dos**~~: hecho el 24/10 (ver "La misma kickoff grabada por los dos"). Sin publicar.
- ~~El prompt de la ficha da por hecho que la kickoff la hace RESPONSABLE_HUB~~: resuelto en k3 (falta probarlo con una kickoff real de COORDINACION).
- **Recuperar por link:** aceptar la URL de Fathom (`calls/…`) además del `recording_id` (`traerReunion` podría buscar por `url` en la misma lista).

## La misma kickoff grabada por los dos (24/10, tarde, sin publicar)

RESPONSABLE_HUB y COORDINACION graban cada uno con su Fathom y su webhook: la misma llamada llega dos veces, con dos `recording_id`. **Gana la primera** que se registró en `cj_kickoffs` (por `creado` y, si empatan, por `recording_id`); la segunda queda `duplicada` con `duplicada_de` = la primera, **sin Claude y sin aviso**, aunque la primera siga `procesando`. No se elige la más completa (decisión de RESPONSABLE_HUB).

- **Cuándo se mira:** después de reclamar la fila y antes de todo lo demás (Claude, Meta, Discord). Con `forzar` o en seco, no. Si la búsqueda falla (base lenta), se sigue: mejor dos fichas que ninguna.
- **La clave de la reunión** (`dedupe.ts`, guardada al reclamar en las columnas `agendado` y `dedupe`): el horario agendado (`scheduled_start_time`, que `validarReunion` no conserva: se toma del payload crudo), el inicio y el fin de la grabación, el título del evento del calendario (`meeting_title`) y las **huellas** (sha256 truncado) de los mails de los invitados externos, sin los del equipo (CSM, ADS) ni el de quien grabó. Los mails no quedan en la clave.
- **Es la misma reunión si** (`mismaReunion`): las grabó **otra cuenta de Fathom** (dos grabaciones del mismo Fathom son dos partes de una llamada cortada y retomada: la segunda suele traer la zona, el presupuesto y el portfolio, así que nunca queda duplicada de la primera), el mismo horario (agendado ±2 min o, si alguna no lo trae, grabaciones que empiezan a menos de 20 min y se pisan) **y** un invitado externo en común, sin contar a quienes grabaron (en la grabación de COORDINACION, RESPONSABLE_HUB puede figurar como externo, y al revés; así dos kickoffs distintas a la misma hora con RESPONSABLE_HUB invitado a las dos no se juntan). Si alguna no tiene invitados externos para comparar: el mismo título de evento con el mismo horario agendado. Si las dos tienen invitados y no comparten ninguno, no es la misma (aunque coincida el título).
- **Sin calendario para comparar** (24/10, tarde: COORDINACION entra por el link del Meet y su Fathom no trae agenda, título ni invitados): es la misma si las grabaciones empiezan a menos de 5 min, se pisan y comparten a alguien que **habla** (el `display_name` de la transcripción, sin el de quien grabó cada una), o si el que grabó una habla en la otra. Dos reuniones distintas a la misma hora no comparten a nadie que hable. La clave guarda **huellas** de esos nombres (`hablantes`, `grabo_nombre`), nunca los nombres.
- **Las que no se van a procesar** (sin transcripción o cortadas): la clave lo anota al reclamar (`procesable: false`, se sabe antes porque es puro), no buscan gemela (quedan con su estado: error con el aviso de activar Transcript, u omitida) y la búsqueda de las otras las saltea, aunque todavía digan "procesando". Antes, si las dos llegaban casi juntas, la buena podía quedar duplicada de una que después quedaba en error, y la kickoff no la procesaba nadie.
- **La búsqueda** (`buscarGemela`, registro.ts): filas con `agendado` a ±20 min, anteriores por `(creado, recording_id)` (si llegan juntas, solo la segunda queda duplicada), sin las `omitida` (otra grabación, cortada, puede ser la completa), las `duplicada`, las `error` por llegar sin transcripción (ese webhook no tiene Transcript; el otro sí), las del mismo `grabador` y las que su clave dice `procesable: false`. Después afina con `mismaReunion`.
- **Las filas de antes** (la de CUENTA_QA) no tienen clave: no entran en la búsqueda. Si la otra grabación de una kickoff vieja llegara ahora, saldría como nueva.
- La segunda queda en el registro (estado final, sin payload) y el `GET` de estado la muestra con `duplicada_de`. En el log: "grabación … duplicada de … (por invitado | evento | hablantes)".
- **Se ve y lleva a la buena:** la pantalla de la ficha que ganó dice "También la grabó RESPONSABLE_HUB (Fathom): es la misma reunión, no se procesa aparte" (`registro.gemelasDe`, lectura). Si alguien pide reintentar la duplicada por su `recording_id`, el modo manual responde `duplicada` con `duplicada_de` y "para reintentar, usá recording_id=<la que ganó>", y avisa que `&forzar=1` arma OTRA ficha de la misma reunión y otro aviso (antes empujaba a forzar).

## Pantalla de la ficha en el Despacho (`/clientes/<id>/kickoff`)

Hecha el 24/10 (es el punto 6 de "Ediciones compartidas") y publicada en `ovc3cbtre`: reemplaza la tarjeta de ClickUp "Seguimiento de Anuncios" y es a donde apunta el link del aviso. El bloque del mapa del video (abajo) es de la tarde del 24/10 y está sin publicar.

Qué muestra la última ficha del cliente (con un selector si tiene más de una llamada registrada, `?grabacion=<recording_id>`):
- **Cabecera:** cliente, fecha, con qué Fathom se grabó ("Grabada con el Fathom de X", de `grabo`), la otra grabación de la misma reunión si la hubo ("También la grabó RESPONSABLE_HUB (Fathom): es la misma reunión, no se procesa aparte"), link a Fathom, estado de la fila (lista, con error, procesando, no es kickoff) y de la revisión de las ideas, y la nota "⏱️ La grabación cortó a las 09:22; el evento iba hasta las 09:45" si cortó antes.
- **Falta completar:** los faltantes (recalculados con `calcularFaltantes`, con la lectura del mapa de la columna `zona_video`: una ficha vieja muestra los textos de hoy), con la línea del portfolio rehecha según lo que ya se tildó. Cada uno con clave se marca **como hecho con una nota** (`faltantes_checks`): pasa a "Hechos" y el número baja. La zona del mapa trae su ▶ (al cuadro del mapa leído en el video, si lo hay), uno solo: el texto ya no lo repite. Con el mapa leído, que se lee bien y sin diferencias, ese faltante no aparece. Lo que pide el mapa leído ("revisar", "confirmar") tiene su propia clave (`zona_mapa_video`): si antes se había anotado el recorte a mano (clave `zona_mapa`), esa nota no lo da por hecho y queda a la vista como contexto.
- **Para lanzar:** lo que necesita ADS: cuenta act_… con moneda y hora, página, presupuesto de arranque, zona (con el ▶ del mapa y la nota del recorte, si ya se anotó, con un "Ojo: el mapa del video dice otra cosa… confirmarlo con RESPONSABLE_HUB" si el video la contradice y nadie lo revisó; si no hay nota, el recorte **según el video**: con un pin de Meta, la ubicación configurada con su radio y lo excluido; con un polígono, los lugares y los límites; mientras el bot lo lee, "(el bot lo está leyendo del video)"), avatar, estado de las ideas y lanzamiento; y dos datos a mano: **fecha estimada** y **WhatsApp de destino**.
- **Rama, avatar** (con el contexto del mercado aparte: no es un filtro), **zona y presupuesto.** La zona va en orden: **lo que se dijo en la llamada** (descripción, "Lugares que se nombraron", cómo se presenta, radio y país, contexto), después **lo que se ve en el video** (chips punteados, para que no se confundan con lo dicho; ✓ en lo marcado que se dijo; con un pin, "Ubicación marcada" y aparte "Dentro del círculo se lee"; con un polígono, sin la lista "en el mapa, sin que se dijera", que repetía la zona) y al final las diferencias. Mientras el bot lee el mapa, la nota dice eso (no "anotalo vos") y la página se actualiza sola cada 20 s, hasta 8 minutos; sin mapa en los minutos que miró el bot, dice cuáles fueron y que se busque en otro momento. El **bloque del mapa según el video** (`vista.zona.video`): si coincide con lo dicho o no, Google Maps o Meta Ads y la marca, ▶ al cuadro con la marca terminada, la zona marcada, límites, radio, excluidas, lo que se lee sin saber si queda dentro, lo que coincide, lo que no coincide (en rojo), lo parecido para revisar, lo que el mapa no permite verificar y lo que se ve sin que se dijera. Si no se leyó, el estado: se está leyendo, sin video, sin la API key de Fathom de quien grabó, error (con cómo reintentarlo; una lectura colgada más de 20 minutos se muestra como cortada, para reintentar). La columna `zona_video` manda sobre la copia de la ficha.
- **Portfolio:** estado final, fuente y detalle (de `portfolio_final`, o de `portfolioFinalDe()` en las fichas viejas). Los ítems con fuente `ninguna` ("Para tildar") se tildan a mano (ok, falta o problema, con nota; "Quitar tilde" aparte; tocar el prendido con otra nota la actualiza).
- **Acuerdos y pendientes.**
- **Ideas de guiones**, con la revisión de RESPONSABLE_HUB y COORDINACION: aprobar, pedir cambios (con comentario, que le llega al otro por Discord) o deshacer, con el historial de cada uno.
- **Ganadores** (referencia interna), cerrados en un `<details>` (si se comparte pantalla con el cliente no quedan a la vista), sin el nombre del otro cliente, su cuenta ni el copy.
- Cada dato lleva su **▶ minuto**, que abre Fathom en ese segundo. **Ningún mail** llega a la pantalla (los del equipo, por su nombre corto).

Cómo está hecha:
- `lib/bot/kickoff/vista.ts` (puro): de la fila a lo que se muestra. Ahí se decide qué no llega al navegador: los mails, los otros clientes y lo crudo.
- `lib/bot/kickoff/revision.ts` (puro, sirve también en el navegador): tipos de `portfolio_checks` y `revision`, validación estricta del pedido y `revisorDeSesion`.
- `lib/bot/kickoff/acciones.ts`: la barrera HTTP (`atenderPost`) y lo que decide la API (`atenderAccion`), con dependencias inyectables; también los avisos de la revisión y `textoParaLanzar`.
- `lib/bot/kickoff/registro.ts`: `listarFichasCliente` (lectura, no crea la tabla), `guardarCheckPortfolio`, `guardarMarcaFaltante` y `guardarRevision`. Las escrituras van con condición sobre el `cuando` que vio la persona y sobre el cliente de la URL, no crean la tabla y no tocan `actualizado` (`guardarMarcaFaltante` suma la columna si falta).
- `lib/bot/kickoff/demo.ts`: la ficha de la prueba de CUENTA_QA saneada (sin mails, cuentas ni nombres reales), para `?demo=1` y los tests.
- `app/(shell)/clientes/[id]/kickoff/`: `page.tsx`, `loading.tsx`, `kickoff.css` y `_componentes/` (nuevos: `Faltantes.tsx`, `ParaLanzar.tsx`, `MarcaFaltante.tsx`).
- `app/api/clientes/[id]/kickoff/route.ts`: el `POST` de tildes, faltantes y revisión (solo arma las dependencias; los avisos salen en `after()`).

Permisos:
- Ver la pantalla, tildar y marcar faltantes: quien ve Clientes (socio y csm), igual que el resto de `/clientes`. La API cae en la regla `/api/clientes/*` de `rutas.ts`, sin acceso por máquina, y además pide mismo origen (host exacto) y JSON de hasta 4.000 caracteres (`atenderPost`, con tests).
- Aprobar las ideas: solo RESPONSABLE_HUB y COORDINACION, deducidos de la sesión. **En producción, solo por `KICKOFF_REVISOR_TOMI` y `KICKOFF_REVISOR_GERO_M`** (mails de login exactos, separados por coma): sin ellas nadie aprueba. Fuera de producción, si no están, el apellido como palabra entera en el nombre: «RESPONSABLE_HUB» o «mozzi» (nunca por el mail). A quien no es revisor se le muestra con qué nombre entró y qué variable falta, sin su mail.
- La revisión guarda la huella de las ideas que **vio** quien revisa (la manda la pantalla). Si el bot las rehízo mientras tanto, la API responde 409 `ideas_cambiaron` y no escribe; una aprobación vieja de otras ideas deja de contar y se muestra como "anterior". Lo anterior queda en el historial (hasta 5 pasos).
- Cada escritura lleva además el cliente de la URL en el `WHERE`.
- El usuario de prueba de desarrollo (`CRM_DEV_ROL`) no escribe: con la `DATABASE_URL` de `.env.local` sería la base real.

**Cómo ver la pantalla** en local sin base: con `npm run dev`, entrar a `http://127.0.0.1:<puerto>/clientes/E001/kickoff?demo=1` (el 24/10 respondió 200 en el servidor de desarrollo de la carpeta). Muestra la ficha de ejemplo (inventada: La Pampa, localidades y frases escritas a mano): la última «lista», con Instagram tildado a mano, el mapa leído del video (Meta Ads, pin con 30 km en «Colonia Ejemplo, La Pampa, Argentina»: «El Molino» queda afuera, así que el faltante es «revisar» —clave `zona_mapa_video`— y está anotado en "Hechos"), la fecha de lanzamiento cargada y las ideas aprobadas por RESPONSABLE_HUB después de pedir un cambio (con el historial); y otra de tres días antes «con error», sin chequeo de Meta y con las ideas solo en la columna. Los tildes, las marcas y la revisión (con "Probar como" RESPONSABLE_HUB o COORDINACION) cambian solo en pantalla. En producción `?demo=1` no hace nada.

Tests: `node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-vista.mjs` (65, sin red ni base: vista, revisión, la decisión de la API, la barrera HTTP y el SQL contra un Neon falso). Si existe `.cache/kickoff-prueba/salida-1.json`, uno de los tests pasa la salida real por la vista y controla que no se filtren clientes, cuentas ni **ningún** mail.

Falta (fuera de estos archivos, compartido con otras sesiones):
- **Link desde la ficha del cliente:** `app/(shell)/clientes/[id]/page.tsx` es de otra sesión; hay que sumar un enlace a `/clientes/<id>/kickoff`.
- ~~**`lib/auth/rutas.ts` y `docs/ACCESO-Y-ROLES.md`**~~: hecho (la regla `/api/clientes/*` ya nombra la ficha de kickoff y la doc dice que `/api/clientes/[id]/kickoff` sale con la pantalla).
- **Vercel:** cargar `KICKOFF_REVISOR_TOMI` y `KICKOFF_REVISOR_GERO_M` (**obligatorias**: en producción, sin ellas nadie aprueba) y, si RESPONSABLE_HUB lo decide, `DISCORD_WEBHOOK_KICKOFF_ADS` y `DISCORD_ID_VALENTINO`.
- **Planilla de Accesos:** marcarle Clientes a COORDINACION.
- **ADS:** decidir (a) usuario con Clientes o (b) bloque "Para lanzar" en `/anuncios` (archivos de otra sesión; el modelo `vista.lanzar` ya está).
- ~~**La misma kickoff grabada por los dos**~~: hecho el 24/10 (sin publicar): la segunda queda `duplicada`, sin ficha (no aparece en la pantalla).

## Zona desde el video (tarea c03, 24/10)

En las kickoffs RESPONSABLE_HUB comparte pantalla y marca la zona de los anuncios en un mapa (Google Maps o el selector de ubicaciones de Meta Ads). Eso no queda en la transcripción: la ficha solo marca `zona.mapa_en_pantalla` y el momento en que se habló de la zona (`zona.timestamp` y `zona.aprox`). Este paso mira el **video** en ese momento y compara lo que se ve con lo que se dijo.

Estado (24/10, tarde): código, tests y prueba local de punta a punta hechos (la prueba con el prompt `m2-2026-10-24`; desde la tercera revisión el prompt es `m3-2026-10-24`, que solo pide límites y notas más cortos: no se volvió a llamar a Claude) e **integrado al bot** (ver "Integración con el bot"): `procesar.ts` pide el video temprano y dispara la ruta, la ruta es **asincrónica** y guarda el resultado en `cj_kickoffs.zona_video`, y la ficha, la pantalla y el aviso muestran el mapa. **Sin publicar** (sin commit ni deploy) y **sin probar contra Fathom** (no se creó ninguna descarga). Las ediciones compartidas 1 a 5 ya están en la copia de trabajo (más abajo); falta cargar las API keys de Fathom en Vercel y deployar.

### Cómo funciona (`lib/bot/kickoff/mapa.ts`; prompt en `mapa-prompt.ts`)

1. **Momentos** (`momentosMapa`): a −10, 0, +15, +35, +60, +120 y +180 s de `zona.aprox` (o de `zona.timestamp` si no hay), más el comienzo del renglón de Fathom si queda a 20 s o más. Son hasta 8 cuadros, acotados a la duración (`fin_grabacion − fecha`). Los de +2 y +3 minutos están porque la zona se suele ajustar un rato, y lo que importa es la marca terminada. Sin momento (timestamp mal formado o fuera de la llamada), no se mira: es un `error` con el motivo "la ficha no tiene el minuto en que se habló de la zona: no se sabe qué parte del video mirar" (antes `sin_mapa`, que decía que se miró y no estaba).
2. **Video** (`pedirVideo`, `esperarVideo`, `obtenerVideo`), con la doc oficial de Fathom leída el 24/10:
   - `POST /recordings/{id}/download` con la API key de quien grabó (`FATHOM_API_KEY_<QUIEN>`);
   - sondeo de `GET /recordings/{id}/downloads/{download_id}` a los 3, 5, 8, 12 y 15 s (después, cada 15 s), con un tope de 4 minutos (`TOPE_VIDEO_MS`; la ruta lo acota a su plazo). El objeto `video` se valida solo con `completed`: mientras procesa puede venir con los campos en null;
   - 422 o grabación solo de audio → `sin_video`; `failed` → error con el motivo de Fathom; `expired` → se pide una vez más; tres 5xx, 429 o fallas de red seguidas → error pasajero; 401 y 403 cortan enseguida;
   - una descarga **retomada** (`descarga_id`) que da 404 (se purgó), 403 (la pidió otro cliente de la API) o `failed` → se pide una nueva, una sola vez;
   - si corta por algo que vale reintentar (la espera agotada, 429, 5xx, red), el error lleva el `download_id` (`descargaDelError`) y la respuesta lo devuelve en `video.download_id`. El reintento lo manda como `descarga_id` y retoma esa descarga, en vez de que Fathom genere otro MP4;
   - la URL firmada (unas 24 h, solo la lee el cliente de la API que la pidió) no sale nunca en mensajes ni en la respuesta. `destination_url` no se usa por ahora.
3. **Cuadros** (`sacarCuadros`): un ffmpeg por cuadro, en paralelo, con `-ss` antes de `-i` y el JPEG por stdout, hasta 1920 de ancho.
   - **Lee por rangos HTTP**, desde el keyframe anterior a cada segundo. No guarda nada en disco, pero no es "sin bajar el archivo": cada ffmpeg pide desde su punto hasta el final y corta cuando tiene el cuadro, así que con keyframes muy separados puede leer buena parte.
   - Solo protocolos de red (`-protocol_whitelist https,tls,tcp`). Cortes: 15 s sin datos y 45 s en total; al tope, el proceso se mata con SIGKILL.
   - Un cuadro de más de 3,5 MB se descarta (la API de Claude acepta hasta 5 MB por imagen y el base64 crece un 33 %).
   - ffmpeg: `FFMPEG_PATH`, después el paquete `ffmpeg-static` y después el del `PATH`. Se verifica **antes** de pedirle el video a Fathom.
4. **Claude** (`leerMapa`): el modelo de la ficha, esfuerzo `medium`, salida estructurada validada a la vuelta y el mismo manejo de errores que `claude.ts`.
   - Describe **solo el mapa y su marca**, en todos los campos (notas incluidas): nada de personas, mails, chats, pestañas ni otras ventanas. Si no hay mapa, las notas quedan vacías.
   - El mejor cuadro (de ahí sale el `momento`) es el del **estado final** de la marca, no el que mejor se lee.
   - Devuelve `hay_mapa`, `tipo`, `lugares` con su posición (dentro, borde, fuera, lista de incluidas o de excluidas, sin_marca), `marca`, `radio_km` solo si el número se lee (si no, `radio_estimado_km` y cómo lo estimó), `limites`, `excluidas`, `mejor_cuadro`, `legible` y `notas`.
   - **No** se le pasan los lugares dichos: así no "lee" lo que le soplamos (el ejemplo de los límites del prompt m3 tampoco nombra lugares).
   - Los límites y las notas se acotan a 600 caracteres **en una frase** (hasta el último "; " o ". ") o, si no, en una palabra (`enFrase`): antes se cortaban a los 400 a mitad de palabra y se perdía el último tramo de los límites ("…al oeste de CUENTA_QA Krause, CUENTA_QA Aberasta…").
   - Claude deja 12 s antes del plazo para guardar el resultado (`RESERVA_GUARDAR_MS`; antes 2 s, y el UPDATE con la lectura ya pagada se podía cortar).
   - `validarMapa` deja coherentes la marca y las posiciones: sin marca no hay dentro ni fuera (pasan a `sin_marca`), y con lugares en la lista de Meta la marca es `lista`.
5. **Combinar** (`combinarZonaConMapa`, pura): suma `zona.mapa` con `fuente: 'video'` y **no toca lo dicho**. La zona del mapa son los lugares dentro, en el borde o en la lista de incluidas; los `sin_marca` van aparte (`sin_posicion`); las ubicaciones de la lista de Meta (`lista_incluida`) quedan además en `incluidas` (con un pin con radio, es lo que se carga: "San CUENTA_QA +17 km"; los demás nombres son lo que se lee impreso dentro del círculo; en las lecturas de antes, `[]`). Cada lugar dicho se busca primero con el **mismo nombre** y después con uno **parecido**:
   - mismo nombre en la zona → `coinciden`; afuera o excluido → `dichos_afuera`; sin posición → `no_verificables`;
   - parecido (uno contiene al otro, o 1 o 2 letras de diferencia) → `parecidos`, para que lo revise una persona: "Sarmiento" y "CUENTA_QA del Sarmiento" pueden ser lugares distintos, y "Causete" puede ser "Caucete" mal oído;
   - sin nada → `dichos_no_vistos` si el mapa se lee y tiene zona marcada. Si es ilegible, no hay lugares leídos o no hay marca → `no_verificables`.
   - "Mismo nombre" es sin acentos, con lo de entre paréntesis como alias ("CUENTA_QA Krause (Rawson)"), solo lo de antes de la coma ("Chimbas, San CUENTA_QA, Argentina"), sin prefijos administrativos ("Departamento Pocito") y con los números del 1 al 31 en letras ("9 de CUENTA_QA" = "Nueve de CUENTA_QA"). "Provincia de San CUENTA_QA" no es "San CUENTA_QA": queda como parecido.
   - **Radio:** el leído se compara con 1 km de tolerancia (20 dichos contra "+17 km" en Meta es una diferencia real); el estimado, con 50 %.
   - `hay_discrepancias` cuenta solo `dichos_no_vistos`, `dichos_afuera` y el radio. `vistos_no_dichos` es informativo: con un polígono se marca justamente lo que no se nombra (la pantalla y el markdown no lo muestran con un polígono o un área: repetía la zona); con un pin o una lista de Meta sale solo de `incluidas`. `lineaMapa` lo resume en una línea.
   - **Textos** (`diferenciasMapa`): sin la nota "(de oído, verificar)" metida en la frase (los de oído se aclaran al final), en singular o plural, y sin dar por hecho que quedan afuera: "se nombraron Tres Esquinas, Pedernal y el Bordón y en el mapa no aparecen sus nombres: pueden estar dentro sin nombre, afuera o mal oídos (Tres Esquinas y el Bordón, de oído)"; "Chimbas y Pedernal se nombraron pero en el mapa quedan afuera"; "se nombró Causete y en el mapa se lee Caucete".
6. **Orquestador** (`zonaDesdeVideo`): **nunca lanza**. Devuelve `ok`, `sin_mapa`, `sin_video`, `sin_key`, `listo` (dry) o `error` (con `transitorio` si vale reintentar), más los tiempos, los tokens y el costo. Antes de pedir el video controla la key de Fathom, la clave de Claude y ffmpeg.

**Privacidad:** los cuadros pueden mostrar la pantalla de RESPONSABLE_HUB o del cliente. Viven solo en memoria mientras se llama a Claude: no se guardan ni se devuelven. De lo que se ve, solo viaja la descripción del mapa.

### Ruta `/api/bot/kickoff/mapa`

Solo con `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`). `maxDuration` 300 y runtime `nodejs`. Plazo interno de 285 s: al video le quedan unos 185 s, porque se reservan 100 s para los cuadros y Claude. La lógica está en `lib/bot/kickoff/mapa-api.ts` (`atenderMapa`, con dependencias inyectables: así se prueba sin base ni Fathom); el `route.ts` solo arma las reales (`after()` de Next, `leerKickoff`, `guardarZonaVideo`, `zonaDesdeVideo`).

- **`POST`**, cuerpo `{ recording_id, quien?, dry?, forzar?, esperar?, descarga_id?, reintento?, timestamp_zona?, duracion_s?, lugares?, radio_km? }`:
  - la ficha sale de `cj_kickoffs`, solo lectura. Sin ficha guardada, alcanzan `timestamp_zona` y `duracion_s` (más `lugares` y `radio_km` para comparar): ahí no hay dónde guardar y responde en el acto, como antes. Con ficha guardada y `timestamp_zona` sin `duracion_s`, los momentos se acotan a la duración de la ficha (y si el momento cae después del final, 400);
  - si no viene `quien`: la columna `grabador` (la cuenta que firmó el webhook), después `ficha.grabo.cuenta_fathom` y por último `ficha.grabo.quien`. `forzar` mira el video aunque la ficha no marque mapa (y aunque ya esté leído). `descarga_id` retoma una descarga ya pedida; si no viene, la de `zona_video` (misma versión y misma cuenta: la URL solo se la da Fathom a quien la pidió);
  - **asincrónica (24/10)** con ficha guardada y sin `dry`: primero verifica sin costo (los momentos, la key de Fathom, la clave de Claude y ffmpeg), toma el candado `leyendo` en `zona_video` (vale 6 minutos; si otra lectura está en curso, **409**) y responde **202**; en `after()` mira el video y guarda el resultado con `guardarZonaVideo` (ok con el bloque, sin_mapa, sin_video, sin_key o error con `transitorio` y el `download_id` para retomar). **Lo que corta la verificación queda anotado** (con `libre`: no pisa una lectura en curso), en palabras y sin nombres de variables: sin la API key (503, la ficha dice qué conectar), sin el minuto de la zona, "el servidor no tiene ffmpeg para sacar los cuadros del video: avisale a RESPONSABLE_HUB", "el servidor no tiene la clave de Claude: avisale a RESPONSABLE_HUB" (502). La respuesta lleva `guardado: true` y el motivo técnico: `procesar.ts` no lo pisa con "no se pudo disparar";
  - **reintento solo (24/10, tarde):** un error pasajero con una descarga ya pedida (Fathom tardó en generar el MP4, 429/5xx) se reintenta **una vez**: la ruta se dispara a sí misma con esa descarga y `reintento: true` (si quedan al menos 15 s); si vuelve a fallar, queda el error con "para reintentar, pedile a Claude que relea el mapa de la grabación …";
  - **aviso al terminar** (`KICKOFF_AVISO_MAPA=1`, apagado por defecto): cuando la lectura termina y el mapa no coincide con lo dicho, no deja leer el recorte o no aparece en esos minutos, un renglón a #📝-kickoff sin menciones y con el link a la ficha (`textoAvisoMapa` de mensaje.ts), dentro de los 293 s de la invocación. Va suelto: un webhook de Discord no puede responder a otro mensaje;
  - con la misma `VERSION_MAPA` ya leída (ok, sin mapa o sin video) y sin `forzar`: **200 `ya_leido`**, sin hacer nada;
  - `esperar: true`: lo mismo pero en el acto (responde el resultado y lo guarda), para probar a mano;
  - **`dry`** solo verifica y corta **antes** de Fathom con estado `listo`: no genera un video, no llama a Claude y **no escribe**;
  - en el acto responde 200 (`ok`, `sin_mapa`, `sin_video`, `listo`, `ya_leido`), 503 (`sin_key` o error pasajero, con `video.download_id` si ya había una descarga) o 502.
- **`GET`**: la versión, ffmpeg (dónde está y si corre `-version`), si hay clave de Claude y de quién hay API key de Fathom (solo nombres).

```bash
# Verificar sin costo (ni Fathom ni Claude)
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff/mapa' \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  --data '{"recording_id":1,"quien":"tomas","dry":true}' | jq
# De verdad (202): Fathom genera el MP4 y Claude lee el mapa (~USD 0,10–0,13); el resultado queda en zona_video
curl -s -X POST '${AUTH_BASE_URL}/api/bot/kickoff/mapa' \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  --data '{"recording_id":1,"quien":"tomas"}' | jq
# Ver el resultado: el GET de estado del kickoff trae zona_video
curl -s '${AUTH_BASE_URL}/api/bot/kickoff -H "Authorization: Bearer $CRON_SECRET" | jq .zona_video
```

### Probarlo

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-mapa.mjs          # 75, sin red ni ffmpeg ni Claude
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-integracion.mjs   # 71: la integración (procesar, ruta asincrónica, ficha, pantalla, aviso), dedupe, grabador y la tercera revisión
node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-mapa.mjs   # prueba local con Claude (~USD 0,30)
```

Opciones de `probar-mapa.mjs`:
- `--armar`: solo arma los PNG y el MP4;
- `--solo-cuadros`: saca los cuadros sin Claude, para medir ffmpeg;
- `--recombinar`: rehace la combinación, la línea y la verificación de `resultado.json` con el código actual, sin ffmpeg ni Claude.

### Ediciones compartidas (1 a 5: ya en la copia de trabajo; 6: hecha acá)

Al 24/10 (tarde), `package.json` tiene `ffmpeg-static` 5.2.0 (instalado: `node_modules/ffmpeg-static/ffmpeg`), `next.config.ts` lo empaqueta solo en esta ruta, `proxy.ts` deja afuera `bot/kickoff/mapa`, `lib/auth/rutas.ts` la declara propia y `docs/ACCESO-Y-ROLES.md` tiene su fila. `scripts/test-rutas.mjs`: 344 pasan y 2 fallan (las dos de `vercel.json`, `/api/resumen-diario?soloFoto=1`, de otra sesión). Falta el 7 (Vercel) y el deploy.

1. ~~**`package.json`**~~ (en la copia): `"ffmpeg-static": "5.2.0"` (ffmpeg 6.0; en el build de Vercel baja el binario linux-x64, unos 80 MB).
2. ~~**`next.config.ts`**~~ (en la copia), solo para esta ruta (la del kickoff ya carga googleapis):
   ```ts
   serverExternalPackages: ['ffmpeg-static'],
   outputFileTracingIncludes: { '/api/bot/kickoff/mapa': ['./node_modules/ffmpeg-static/ffmpeg'] },
   ```
3. ~~**`proxy.ts`**~~ (en la copia): `bot/kickoff/mapa` en el matcher, al lado de `bot/kickoff`.
4. ~~**`lib/auth/rutas.ts`**~~ (en la copia):
   ```ts
   { patron: '/api/bot/kickoff/mapa', quien: 'propio', motivo: 'Zona desde el video de la kickoff (Fathom + ffmpeg + Claude). POST y GET con Bearer CRON_SECRET. Falla cerrado.' },
   ```
5. ~~**`docs/ACCESO-Y-ROLES.md`**~~ (en la copia): la fila de `/api/bot/kickoff/mapa`.
6. ~~**`lib/bot/kickoff/claude.ts`**~~ (hecho el 24/10): `PedidoClaude.usuario` acepta bloques (`string | BetaContentBlockParam[]`) y un `maxTokens` propio; `esPasajero` y `motivoApi` se exportan. `llamarClaudeVision` de `mapa.ts` ya no es una copia: llama a `llamarClaude` con los cuadros (tope 120 s, max_tokens 16.000).
7. **Vercel (falta):** `FATHOM_API_KEY_TOMAS` y `FATHOM_API_KEY_GERO_M`. Después del deploy, el `GET` tiene que dar `ffmpeg.ok: true`. Hay que mirar la memoria y la CPU de la función: son hasta 8 ffmpeg en paralelo decodificando 1080p.

### Integración con el bot (hecha el 24/10, tarde, sin publicar)

- **`procesar.ts`** (paso 8 bis y 11, con `planMapa`, puro):
  - si la ficha es un kickoff con `zona.mapa_en_pantalla` y se sabe con qué cuenta se grabó (`grabador` de la firma o, si no, `recorded_by`: `cuentaDeGrabacion`), apenas sale la ficha se le pide el video a Fathom (`deps.pedirVideo` = `pedirVideoSeguro` de mapa.ts: solo el `POST /download`, que **nunca lanza**) **sin esperar**: Fathom lo genera mientras siguen Meta y las ideas. Cuando responde se guarda `zona_video` `pedido` con el `download_id` (`guardarZonaVideo` con `libre`: no pisa una lectura en curso);
  - **sin `FATHOM_API_KEY_<QUIEN>`** no se pide nada: `zona_video` `sin_key` con "conectar la API key de Fathom de <quien> para leer el mapa", que es lo que dice el faltante. Si no se sabe quién grabó: "no se sabe con qué cuenta de Fathom se grabó la kickoff: el mapa no se lee solo";
  - **sin el minuto de la zona** (`momentosMapa` da null: timestamp mal formado o fuera de la llamada) tampoco se pide nada: `zona_video` `error` con el porqué (`planMapa` → `sin_momento`). Antes se creaba una descarga en Fathom que nadie miraba y la pantalla decía "se está leyendo" 20 minutos;
  - **en `dry` no se pide el video** (no se crean descargas en Fathom), ni se guarda ni se dispara nada; la respuesta dice `mapa: { plan: 'dry', quien }`;
  - con la ficha `lista` (después de marcarla), `deps.dispararMapa` hace `POST <DESPACHO_URL>/api/bot/kickoff/mapa` con `Authorization: Bearer <CRON_SECRET>` y `{recording_id, quien, descarga_id}`, y espera **solo la respuesta** (202; 200 y 409 también valen), con un tope de 8 s. Antes espera hasta 12 s el `POST /download` temprano (casi siempre respondió hace rato). **Los dos topes se acotan al deadline** reservando 12 s para escribir (`RESERVA_ZONA_MS`); sin tiempo ni para escribir, no escribe (queda `pedido` y la pantalla lo da por cortado a los 20 minutos). Las ideas dejan 10 s más cuando hay mapa por leer (`MARGEN_MAPA_MS`). Si el disparo falla, `zona_video` queda en `error` (pasajero, con el `download_id` y "no se pudo disparar la lectura del mapa (…)"; la ficha agrega cómo reintentarla) y la ficha sigue `lista`; **si la ruta respondió que no y ya anotó la causa** (`ErrorDisparoMapa` con `guardado`), no se pisa. Si Fathom dijo que no hay video (422 o solo audio) o la key se rechazó, no se dispara: ya quedó anotado;
  - **al retomar**: con `zona_video` terminado (`ok`, `sin_mapa`, `sin_video`) de la misma `VERSION_MAPA`, no se repite (la ficha lo trae); con un `leyendo` vigente, tampoco; con un `pedido` (o un error pasajero) de la misma versión y la misma cuenta, se retoma esa descarga (`descarga_id`) en vez de pedir otro MP4; con otra versión o `forzar`, se vuelve a mirar;
  - sin `deps.hayApiKey` (los fakes de los tests viejos) no se mira el mapa.
- **`tipos.ts`:** `ZonaFicha.mapa?: BloqueMapaZona | null` y `FichaKickoff.zona_video?: ZonaVideoFicha | null`, opcionales (las fichas viejas no los tienen). Los tipos del mapa están en `mapa-zona.ts`.
- **`registro.ts`:** `guardarZonaVideo(id, zv, { libre, dry })` sobre la columna nueva `zona_video` (aditiva). Con `libre`, escribe solo si no hay lectura o es de otra versión, si está `pedido`, `error` o `sin_key`, o si el candado de `leyendo` venció. Con `dry`, no escribe.
- **`ficha.ts`:** `conZonaVideo` suma la lectura a la ficha; `faltanteMapa`: resuelto si el mapa se lee bien, tiene zona marcada y no contradice lo dicho; "Zona del mapa: revisar las diferencias entre el mapa del video y lo dicho (ojo: …; revisar: …; el mapa se ve ▶ …)" si la contradice (etiqueta del aviso: "revisar el mapa de la zona") y "Zona del mapa: confirmar el recorte leído del video (se lee en parte…)" si coincide pero se lee en parte, las dos con la clave `zona_mapa_video`; mientras se lee, "se está leyendo del video (en unos minutos queda acá…)"; si no se pudo leer, el porqué (sin mapa en esos minutos, el ▶ es a cuando "se habló de la zona"). El markdown suma "🗺️ Mapa según el video [▶ minuto]" con la zona marcada, límites, radio, excluidas, lo que coincide, los "⚠️ Ojo" y lo que no se puede verificar.
- **`vista.ts`, la pantalla y `mensaje.ts`:** ver "Pantalla de la ficha" (el bloque del mapa en la zona, el ▶ del faltante al cuadro del mapa, "según el video" en Para lanzar) y "Aviso de Discord" (🗺️ coincide / revisar / se lee del video).
- **Costo:** igual que antes, unos USD 0,10 a 0,13 por kickoff con mapa (solo cuando la ficha marca mapa en pantalla).

**Pendientes reales del mapa (24/10, tarde):**
1. **Vercel:** cargar `FATHOM_API_KEY_TOMAS` y `FATHOM_API_KEY_GERO_M` (cada uno genera la suya en Fathom → Settings → API Access; no por chat). Sin ellas, cada kickoff con mapa queda `sin_key` (no se rompe nada). `.env.local` tampoco las tiene: localmente el mapa real no se puede probar.
2. **Deploy** de la copia de trabajo (lo hace la sesión dueña del Despacho), y después: el `GET /api/bot/kickoff/mapa` tiene que dar `ffmpeg.ok: true`; mirar memoria y CPU de la función con una grabación real (hasta 8 ffmpeg en paralelo sobre 1080p).
3. **Primera prueba real** (cuesta ~USD 0,12 y crea una descarga en Fathom): con la kickoff de CUENTA_QA, `POST /api/bot/kickoff/mapa {"recording_id":1,"quien":"tomas"}` → 202, y a los 1 a 4 minutos el `GET` de estado tiene que traer `zona_video` `ok`. Medir cuánto tarda Fathom en generar el MP4 (hoy no se sabe).
4. **`DESPACHO_URL`:** si algún día el bot corre en otro dominio (o en un preview), el disparo va a `DESPACHO_URL`; sin ella, al dominio de producción.
