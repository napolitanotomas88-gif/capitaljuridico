> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot Capital Jurídico · Grabación y Edición (e01–e05, f01–f06)

Pedido de RESPONSABLE_HUB (24/10/2026): el Despacho reemplaza a ClickUp en las etapas **Grabación** (e01 a e05) y **Edición** (f01 a f06) del doc "Sistema de tareas - C.J". ClickUp (lista "Sistema de Edición") queda **solo de consulta**: el Despacho nunca escribe ahí. El relevamiento y el diseño completo están en `docs/RELEVAMIENTO-EDICION-CJ.md`.

Fuente original recuperada y verificada mediante lectura nativa el 29/10/2026: Sistema de tareas - C.J (referencia privada). Las instrucciones posteriores de RESPONSABLE_HUB prevalecen sobre la terminología histórica del documento original.

Decisiones de RESPONSABLE_HUB (24/10):
- **P1:** entran **todos los clientes activos** desde una fecha de corte (`EDICION_FECHA_CORTE`). Se importan los ~37 videos activos de ClickUp.
- **P2** (por defecto): si el cliente no graba, la escalera de la daily en días hábiles: día 0 mensaje con guion y fecha (COORDINACION), día 2 audio de COORDINACION, día 4 llamada citando el contrato (COORDINACION), día 9 decide RESPONSABLE_HUB la pausa; si no pausa, un recordatorio cada 4 días hábiles. Arranca cuando el guion pasa a "Para grabar" en el doc o COORDINACION marca "guiones enviados".
- **P3:** EDITOR **entra al Despacho** (sección nueva Edición, sin Clientes): ve su cola, marca listo y corregido y tilda notas. Además el bot detecta lo que sube a "Editados - X" y propone vincularlo.
- **P4** (por defecto): el estado final es **Aprobado** (OK del cliente) y le avisa a ADS en #ads. "En anuncios" queda para la etapa Anuncios.
- **P5:** transcripción con **AssemblyAI** (Universal, idioma `es`, palabras clave de la ficha del kickoff, **nunca el guion** como contexto), por link de descarga de Drive y con webhook. La transcripción se **borra en AssemblyAI** apenas se guarda en Neon. Plan B documentado; implementado solo el corte por tamaño.
- **P6:** tope de **2 rondas** de corrección del cliente por video, **interno**: la 3.ª no le llega a EDITOR sin el OK de RESPONSABLE_HUB. Al cliente nunca se le dice que no en automático.
- **Sin número de WhatsApp todavía:** todo lo que va al cliente es un texto para copiar más un botón «Enviado» que deja la constancia. Con el chip, el mismo botón pasará a «Enviar». Los avisos internos van por Discord.

Estado (24/10, noche):
- Hecho en la copia aislada `$APP_DIR`, **sin publicar** (sin commit ni deploy). El deploy lo hace la sesión dueña, desde `$APP_DIR`, con el parche `edicion.patch`.
- **Todo arranca en modo prueba** (`EDICION_MODO` sin cargar): no se escribe en Neon y no sale nada a AssemblyAI, Claude ni Discord.
- Cuatro revisores (motor, límites, seguridad y uso) dejaron 34 hallazgos (32 distintos); ver "Revisión del 24/10". Tests, `tsc` y `next build` pasan.
- **Nada se corrió contra servicios reales**: ni Neon, ni Drive, ni AssemblyAI, ni Discord, ni ClickUp, ni Claude. El SQL se probó con un Neon falso; la primera escritura en modo sombra es la que lo valida de verdad.

Más detalle: `docs/edicion/MOTOR.md` (datos, vigía, transcripción, comparación, diario), `docs/edicion/PANTALLA.md` (pantalla, roles, API) y `docs/edicion/AVISOS.md` (secretos, Discord, textos, pedidos, marca, importación, Puente Drive).

## La pregunta de RESPONSABLE_HUB: "creo que la había armado, pero el secreto no sé dónde lo tengo que hacer"

Los dos secretos propios **no se sacan de ningún servicio**: se generan en la Mac, una sola vez, y el mismo valor va a cada lugar. Van en hexadecimal (sin `+`, `/` ni `=`).

| Secreto | Dónde se crea | Dónde se pega |
|---|---|---|
| `VIGIA_SECRETO` | En la Terminal de la Mac (comando de abajo) | **1)** Apps Script, cuenta CUENTA_GOOGLE_OPERADORA_CONFIGURADA, proyecto "Puente Drive · Despacho": ⚙ Configuración del proyecto → Propiedades de la secuencia de comandos → Agregar propiedad → nombre `VIGIA_SECRETO`, valor: pegar → Guardar. Es el mismo lugar donde ya está `SECRETO`, que **no se toca**. **2)** Vercel (Production). **3)** `$APP_DIR` |
| `ASSEMBLYAI_WEBHOOK_SECRETO` | En la Mac, con el mismo comando. **No se crea en AssemblyAI** | Solo Vercel y `.env.local`. El Despacho se lo manda a AssemblyAI en cada pedido y lo controla cuando vuelve el aviso |
| `ASSEMBLYAI_API_KEY` | En AssemblyAI, sección API keys | Vercel y `.env.local` (va al final, ver el checklist) |
| `DISCORD_WEBHOOK_EDICION` | Discord: #✂️-edicion → Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL | Vercel y `.env.local` |

`VIGIA_SECRETO` en un solo comando (no muestra el valor; lo deja en `.env.local`, en Vercel y en el portapapeles para pegarlo en Apps Script):

```sh
S=$(openssl rand -hex 32); printf '\nVIGIA_SECRETO=%s\n' "$S" >> $APP_DIR (cd $APP_DIR && printf %s "$S" | vercel env add VIGIA_SECRETO production); printf %s "$S" | pbcopy; unset S
```

`ASSEMBLYAI_WEBHOOK_SECRETO`, igual pero sin el portapapeles:

```sh
S=$(openssl rand -hex 32); printf '\nASSEMBLYAI_WEBHOOK_SECRETO=%s\n' "$S" >> $APP_DIR (cd $APP_DIR && printf %s "$S" | vercel env add ASSEMBLYAI_WEBHOOK_SECRETO production); unset S
```

- **"Creo que la había armado":** el código del vigía va en un archivo **nuevo** del proyecto de Apps Script, `Vigia.gs` (está en `docs/edicion/puente/Vigia.gs`), no al final de `Código.gs` (ese es de la sesión del alta). `probarVigia` dice si la propiedad está cargada (sin mostrarla) y lista los disparadores del proyecto con su función: ahí se ve si quedó uno armado a mano. `instalarDisparadorVigia` deja uno solo de `dispararVigia`; uno a mano que llame a otra función se borra desde el reloj ⏰ (Activadores).
- **Por qué el puente no usa `CRON_SECRET`:** ese secreto abre también `/api/raw`, que tiene teléfonos. Con `VIGIA_SECRETO` solo se puede disparar el vigía.
- **Largo:** un `VIGIA_SECRETO` o `ASSEMBLYAI_WEBHOOK_SECRETO` de menos de 32 caracteres cuenta como mal configurado (503).
- **Cuándo:** los secretos se pueden cargar ya. El **disparador** del puente se instala recién con `EDICION_MODO=real` cargado en Vercel (no alcanza con el deploy): en modo prueba el vigía responde 202 y no guarda nada. No hace falta publicar "Nueva versión" del puente.

## Qué hace

1. **Guiones (e01).** La pasada diaria lee el doc "Guiones - X" de cada cliente activo (export de Drive). La primera lectura es la línea de base y no crea videos. Después, cada guion que **pasa** a "Para grabar" crea su video en *Esperando crudos* y abre el ciclo de seguimiento. Lo que pasa antes de la fecha de corte queda pospuesto y se crea desde ese día. COORDINACION también puede marcar «Guiones enviados» por tanda en la ficha del cliente.
2. **Seguimiento si no graba (e01, P2).** El cálculo diario arma los pasos (día 0, 2, 4 y 9, en días hábiles contados desde el día 0) en **Grabaciones pendientes**, con el texto para copiar o la guía interna y un «Hecho». Si el ciclo lo abrió un envío con constancia (pedido de regrabación o «Guiones enviados»), el día 0 nace hecho. El escalón no avanza si llegaron crudos que todavía no se ubicaron (así COORDINACION no llama a quien ya grabó).
3. **Vigía de Crudos (e02).** Cada 15 minutos de 8 a 22 (disparador del Puente Drive) lista "Crudos - X" y "Editados - X" de los clientes con vínculo, filtrando por fecha de subida, y baja las subcarpetas nuevas hasta 4 niveles. Cada archivo se guarda una sola vez. Distingue si subió el cliente o el equipo. Arma **tandas de subida** (se cierran a los 45 minutos sin archivos nuevos), vincula cada crudo a su video por la carpeta o el nombre ("Tanda 1 / Video 4", "T2V4") y propone los editados nuevos.
4. **Transcribir y comparar (e03, P5).** Cada crudo nuevo va a AssemblyAI con el link de Drive y las palabras clave (nunca el guion). Al cerrar la tanda, un cruce simple marca por cada guion qué frases aparecen al menos una vez, qué crudo cubre qué video y la mejor toma. Claude entra solo para las frases dudosas. El resultado va en **un** aviso por tanda a COORDINACION.
5. **Check de COORDINACION (e04).** En la ficha del cliente, por tanda: «Sirve» (pasa a *Para editar*; «Sirven los N» en lote), «Regrabar» con motivo y detalle (el texto para el cliente sale de ahí) o «Pausa con devolución».
6. **Paleta (e05).** Ficha de marca por cliente (colores en hexadecimal, tipografía, logo, referencia y de dónde salió cada dato). No frena nada: si falta al pasar a *Para editar*, se le avisa a COORDINACION.
7. **EDITOR edita (f01, f02).** Ve su cola (correcciones primero, después prioridad y lo más viejo), marca «Listo» (o acepta el editado que propone el bot) y le avisamos a COORDINACION por lote.
8. **Correcciones (f03).** COORDINACION deja notas por segundo (17, 1:05 o 1,05) y «Pedir corrección», también con el video ya en el cliente (un error propio no gasta una ronda del cliente). EDITOR tilda cada nota y marca «Corregido».
9. **Al cliente (f04).** «Está bien: al cliente», de a uno o **la tanda entera**, y **un solo** link final con todos los videos para copiar en el grupo Contenido, con su «Enviado».
10. **Pedido del cliente (f05, P6).** COORDINACION pega el mensaje; Claude lo separa en notas (o se cargan a mano) y COORDINACION confirma cuáles van. La 3.ª ronda queda esperando el OK de RESPONSABLE_HUB y EDITOR no la ve. Un solo pedido puede esperar a RESPONSABLE_HUB por video.
11. **OK del cliente (f06, P4).** «El cliente dio el OK», de a uno o para toda la tanda con una sola cita: pasa a *Aprobado* y le avisa a ADS en #ads con los links a los archivos editados.

## Estados del video

| Estado | Cuándo entra | Quién lo mueve | Aviso |
|---|---|---|---|
| Esperando crudos | El guion pasa a "Para grabar", COORDINACION marca «Guiones enviados», se registra el envío de un pedido de regrabación, o se importa "en espera de datos" | El bot, COORDINACION | El seguimiento de e01 |
| Crudo a revisar | Llegaron crudos del video (cierre de la tanda, comparación o un crudo que COORDINACION ordenó en Drive) | El bot | A COORDINACION, uno por tanda, con el resultado de e03 |
| Regrabar | COORDINACION: no sirve (duro, audio, encuadre, falta una frase u otro) | COORDINACION, RESPONSABLE_HUB | El texto para el cliente; con «Enviado» vuelve a Esperando crudos |
| Para editar | COORDINACION: «Sirve» (e04) | COORDINACION, RESPONSABLE_HUB | A EDITOR, uno por tanda; a COORDINACION si falta la paleta |
| Editado | EDITOR: «Listo» (o acepta el editado propuesto) | EDITOR, COORDINACION, RESPONSABLE_HUB | A COORDINACION, por lote |
| Corrección | COORDINACION pide corrección (desde Editado, Corregido o Con el cliente) o se confirma un pedido del cliente | COORDINACION, RESPONSABLE_HUB | A EDITOR, con las notas de la corrección en curso |
| Corregido | EDITOR, con todas las notas tildadas (COORDINACION y RESPONSABLE_HUB pueden forzar con una nota) | EDITOR, COORDINACION, RESPONSABLE_HUB | A COORDINACION, por lote |
| Con el cliente | COORDINACION: «Está bien: al cliente» (de a uno o en lote) | COORDINACION, RESPONSABLE_HUB | El texto con el link para el cliente |
| Aprobado | El cliente dio el OK (con la cita) | COORDINACION, RESPONSABLE_HUB | A ADS en #ads |
| Pausado | Pausa (con nota), pausa con devolución o la decisión del día 9 | COORDINACION, RESPONSABLE_HUB | Ninguno |
| Descartado | Con nota | COORDINACION, RESPONSABLE_HUB | Ninguno |

- Bloqueos que no son estado: `tope_rondas_cliente` (3.ª ronda, solo RESPONSABLE_HUB), `sin_link_editado` (se limpia solo al vincular el editado), `crudo_borrado` (la pasada diaria vio que se borró un crudo) y `otro` (lo puede marcar EDITOR, con motivo, y le avisa a COORDINACION).
- Reanudar vuelve al estado de antes de la pausa; RESPONSABLE_HUB puede reabrir un aprobado (a Con el cliente) o un descartado (al estado previo).
- Cada cambio deja su evento (quién, cuándo, de qué estado a cuál) **en la misma sentencia**: es el historial que ClickUp no guardaba.
- Salir de Con el cliente a Corrección borra la constancia del link final: el cliente tiene que recibir el link de la versión corregida.

## Quién mueve qué

| Acción | EDITOR | COORDINACION | RESPONSABLE_HUB | Bot |
|---|---|---|---|---|
| Llegaron los crudos | | ✓ | ✓ | ✓ |
| Sirve / regrabar / pausa con devolución (e04) | | ✓ | ✓ | |
| Listo | ✓ | ✓ | ✓ | |
| Notas, pedir corrección | | ✓ | ✓ | |
| Tildar notas, corregido | ✓ | ✓ (forzar con nota) | ✓ (forzar con nota) | |
| Al cliente, OK del cliente, constancias de envío | | ✓ | ✓ | |
| Pedido del cliente (rondas 1 y 2) | | ✓ | ✓ | |
| Autorizar la 3.ª ronda, decidir el día 9, reabrir, bloqueo del tope | | | ✓ | |
| Vínculos de carpetas, ficha de marca, «Guiones enviados», pasos de e01 | | ✓ | ✓ | |
| Aceptar el editado propuesto, bloqueo "otro" con motivo | ✓ | ✓ | ✓ | |

Los botones salen de la misma tabla que valida la API (`lib/edicion/estados.ts`), así nadie ve un botón que se le va a rechazar. Cada escritura lleva la versión que vio la persona: si otro lo cambió en el medio, responde 409 y pide recargar.

## Dónde se guarda: tablas `cj_*` en Neon (misma base que Cuotas)

Se crean solas con una **migración versionada** (`cj_edicion_esquema`): si la base ya está en la versión, no corre ningún DDL; si no, todo en una transacción con `CREATE … IF NOT EXISTS`. Las lecturas no crean nada (sin tabla devuelven vacío). `scripts/edicion-esquema.mjs --imprimir` muestra el DDL sin conectarse.

| Tabla | Para qué |
|---|---|
| `cj_grab_carpetas` | Árbol de Drive por cliente: la carpeta del cliente (vínculo con el CRM), sus raíces (Crudos, Editados, Marca) y subcarpetas; qué se vigila y cuándo se consultó |
| `cj_grab_archivos` | Crudos y editados: datos del archivo, quién subió (cliente o equipo, sin mails), tanda y video inferidos, vínculo y estado de la transcripción |
| `cj_grab_transcripciones` | Texto y palabras con tiempos (aparte, por el peso) |
| `cj_grab_tandas` | Tandas de subida y el resultado de la comparación con los guiones |
| `cj_grab_guiones` | Último doc de guiones leído por cliente (línea de base) |
| `cj_grab_corridas` | Corridas del vigía y del diario (candado y fases) |
| `cj_grab_seguimientos` | Pasos de e01 |
| `cj_videos`, `cj_video_eventos` | Un video por fila y su historial (el mail de quien actúa queda solo en el historial y nunca se lee) |
| `cj_video_notas`, `cj_video_pedidos` | Notas de corrección y pedidos del cliente |
| `cj_marca` | Ficha de marca |
| `cj_edicion_avisos` | Cola de avisos de Discord |
| `cj_edicion_clientes` | Clientes que graba el equipo (quedan afuera de e01) |

## Disparadores

| Cuándo | Qué | Por dónde |
|---|---|---|
| Cada 15 minutos, de 8 a 22 (Argentina) | El vigía (`POST /api/bot/grabacion/vigia`): archivos nuevos, tandas, transcripción, comparación, las fases del diario que falten y el despacho de avisos | Disparador del **Puente Drive** (`Vigia.gs`) con `Bearer VIGIA_SECRETO`. Hace falta porque el plan Hobby de Vercel solo permite crons diarios |
| Una vez por día (`0 10 * * *`, 7:00 de Argentina) | El diario (`GET /api/bot/grabacion/diario`): pasada completa del árbol (carpetas nuevas, movidos y borrados, docs de guiones), e01, resumen de la daily, huecos del vigía y transcripciones colgadas | Cron de Vercel con `CRON_SECRET`. El minuto no es puntual: el resumen (martes a viernes, desde las 7:45) lo manda la primera corrida del vigía que vea que falta |
| Cuando AssemblyAI termina | Guarda la transcripción, la borra en AssemblyAI y, si la tanda ya está completa, compara con el cruce simple (Claude lo hace el vigía) | `POST /api/bot/grabacion/transcripcion` con la cabecera `X-Edicion-Secreto` |
| Cuando alguien toca un botón | Las acciones de la pantalla | `POST /api/edicion` y `POST /api/edicion/pedido` (sesión de Google con la sección Edición, mismo origen) |

Control: arriba de cada pantalla, "Último vigía hace X". Si pasan más de 2 horas de horario de trabajo sin corrida, le llega un aviso a RESPONSABLE_HUB.

## Avisos de Discord

- Canal privado nuevo **#✂️-edicion** (`DISCORD_WEBHOOK_EDICION`) con RESPONSABLE_HUB, COORDINACION y EDITOR; ADS en **#ads** (`DISCORD_WEBHOOK_KICKOFF_ADS`).
- **Un aviso por tanda o por lote, nunca por video:** crudos nuevos (con el resultado de e03), para editar, EDITOR terminó, corrección (con las notas de la corrección en curso), corregidos, aprobado (a ADS, con links a los **archivos** editados, nunca a la carpeta), tope de rondas (a RESPONSABLE_HUB), falta la paleta, crudo borrado, vínculo por confirmar, transcripción que no salió (plan B), bloqueo que marcó EDITOR, resumen de la daily, vigía callado y errores.
- El texto se arma al despachar, con lo que hay en la base en ese momento. Los links van siempre a `/edicion`, nunca a una API.
- **Menciones solo con el id declarado** (`DISCORD_ID_AYLU`, `DISCORD_ID_RENE`, `DISCORD_ID_TOMAS`, `DISCORD_ID_GERO_M`, `DISCORD_ID_VALENTINO`). Sin id, va el nombre en texto, sin notificar.
- Ningún aviso lleva mails ni teléfonos. Los importados de ClickUp se nombran "video N (ClickUp)", nunca con su clave interna.
- Un error le llega a RESPONSABLE_HUB **una vez por día** por motivo. Un timeout de Discord deja el aviso como dudoso y no se reintenta solo.
- Detalle de reglas, ventanas y ejemplos: `docs/edicion/AVISOS.md`, sección 3.

## Accesos

- **Sección nueva `edicion`** (`/edicion` y `/api/edicion/*`) en `SECCIONES`; se asigna desde Configuración. Los socios la ven.
- **Roles dentro de Edición**, siempre por la sesión y por **mail exacto** en producción: `EDICION_REVISOR_AYLU`, `EDICION_REVISOR_TOMAS` (si falta, `KICKOFF_REVISOR_TOMI`) y `EDICION_EDITOR_RENE`. Sin la variable, o con un mail en dos listas, la persona queda en **solo lectura** (falla cerrado). El usuario de prueba de desarrollo nunca escribe.
- **EDITOR:** una fila de tipo "acceso" con **solo [edicion]**. No tiene Clientes: la pantalla nunca le arma links a `/clientes` y no ve cobros. Tampoco ve Pendientes, Vínculos ni Avisos, ni ningún pedido del cliente (P6): lo que le toca le llega como notas.
- **ADS** no entra: le alcanza el aviso de #ads.
- **Rutas del bot** (`propio` en `lib/auth/rutas.ts`, fuera del matcher del proxy): el vigía (`VIGIA_SECRETO` o `CRON_SECRET`), el diario (`CRON_SECRET`) y el webhook (`X-Edicion-Secreto`).
- **Archivos compartidos con otras sesiones** que toca el parche (marcados en `edicion-archivos.txt`): `lib/auth/roles.ts`, `lib/auth/rutas.ts`, `proxy.ts`, la navegación (`components/shell/secciones.ts`, `iconos.tsx`), `docs/ACCESO-Y-ROLES.md`, `vercel.json` (el cron diario) y tres tests (`test-rutas`, `test-accesos`, `test-nav`). `lib/clientes/drive.ts` **no** se toca.

## Modo prueba (dry)

- `EDICION_MODO` vale `real` o, por defecto, `dry`. En dry no se abre corrida, no se escribe en Neon y no se llama a AssemblyAI, Claude ni Discord: cada ruta y cada botón devuelven lo que **harían**.
- `?dry=1` en la URL fuerza el modo prueba en cualquier ruta, también con el modo real.
- Con `EDICION_MODO` distinto de `real`, el POST del puente al vigía responde 202 y no hace nada.
- **Modo sombra:** `EDICION_MODO=real` + `EDICION_AVISOS=dry`. Se escribe todo en Neon y los avisos quedan en `/edicion/avisos` con el texto que habrían llevado, sin salir a Discord.
- `?demo=1` en la pantalla muestra datos ficticios (clientes "(ejemplo)") y deja cambiar de rol para mirar cómo lo ve cada uno; no escribe nada.

## Variables (solo los nombres)

- **Modo:** `EDICION_MODO`, `EDICION_AVISOS`, `EDICION_FECHA_CORTE`.
- **Roles:** `EDICION_REVISOR_AYLU`, `EDICION_REVISOR_TOMAS` (o `KICKOFF_REVISOR_TOMI`), `EDICION_EDITOR_RENE`.
- **Secretos propios:** `VIGIA_SECRETO`, `ASSEMBLYAI_WEBHOOK_SECRETO` (y `CRON_SECRET`, el de siempre).
- **AssemblyAI:** `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_MODELO` (opcional; lista separada por comas, por defecto `universal-3-5-pro,universal-2`), `ASSEMBLYAI_BASE`, `ASSEMBLYAI_MAX_BYTES`.
- **Discord:** `DISCORD_WEBHOOK_EDICION`, `DISCORD_WEBHOOK_KICKOFF_ADS`, `DISCORD_ID_AYLU`, `DISCORD_ID_RENE`, `DISCORD_ID_TOMAS`, `DISCORD_ID_GERO_M`, `DISCORD_ID_VALENTINO`.
- **Drive y CRM:** `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `DRIVE_CARPETA_CLIENTES`, `SHEET_ID_CLIENTES`, `EDICION_EQUIPO_DRIVE` (mails o `@dominios` del equipo, para saber quién subió), `EDICION_GRABA_EQUIPO`.
- **Base y Claude:** `DATABASE_URL`, `BOT_ANTHROPIC_API_KEY` (o `ANTHROPIC_API_KEY`), `KICKOFF_MODELO`, `META_ANUNCIOS_TOKEN` (la sugerencia para ADS, solo lectura).
- **Links e importación:** `DESPACHO_URL`, `CLICKUP_TOKEN`, `CLICKUP_LISTA_EDICION`.
- **Puente Drive** (propiedades del script, no de Vercel): `VIGIA_SECRETO` y, opcional, `VIGIA_URL`.

## Importación de ClickUp y fecha de corte

- **Qué entra:** los ~37 videos activos de la lista "Sistema de Edición" (las subtareas "video 3", "video 2 tanda 3") y las paletas. Equivalencias: "en espera de datos" → Esperando crudos; "para editar" y "editando" → Para editar; "editado" → Editado; "corregido" → Corregido; "revisión" → Con el cliente (marcado "confirmar con COORDINACION"); "publicar" y "publicado" no se importan.
- **Cómo:** `scripts/edicion-importar-clickup.mjs` lee ClickUp (solo GET) y el CRM (solo lectura) y escribe una **propuesta** en JSON (`.cache/edicion-importacion/propuesta-AAAA-MM-DD.json`), sin tocar Neon. La carga (`--cargar`) exige `EDICION_MODO=real`, una propuesta generada **ese mismo día** y escribir CARGAR. Es idempotente por el id de ClickUp.
- **Nombres:** el cliente se cruza con el CRM; lo dudoso queda en `sin_cruzar` con candidatos para que decida COORDINACION (por ejemplo "De CUENTA_QA" con "De CUENTA_QA" primero, y "CUENTA_QA"). Si el nombre de ClickUp no trae la tanda, la clave interna es `CU-<id>`, pero la pantalla, los avisos y el link al cliente dicen "Video N".
- **Choques con el doc:** un video que el doc ya creó, que sigue esperando crudos y que nadie tocó, se completa con lo de ClickUp (id, prioridad, gancho si falta, link al editado). Si ya avanzó, queda como conflicto para COORDINACION.
- **Fecha de corte (`EDICION_FECHA_CORTE`, AAAA-MM-DD):** desde ese día lo nuevo va solo al Despacho y ClickUp queda de consulta. Antes del corte no se crean videos desde el doc (quedan pospuestos y se crean ese día). Los importados en espera arrancan su seguimiento en la fecha de corte.
- Prueba sin red con el volcado del relevamiento: de 37 videos activos, 28 cruzan con 8 clientes y 9 quedan sin cruzar (2 tarjetas); 25 de los 28 quedan como `CU-…`; 28 fichas de marca y ninguna URL de adjunto.

## Revisión del 24/10 (cuatro revisores)

Corregido, cada uno con su test (los juguetes de los revisores ahora dan el resultado bueno):

- **El vigía quedaba caído para siempre** cuando el mismo archivo o carpeta llegaba por dos caminos (COORDINACION arma "Tanda 3/Video 1" de antemano): Postgres da 21000 con un upsert de id repetido. Ahora va uno por `drive_id` en el vigía y en el repositorio, y las subcarpetas ya vigiladas no se vuelven a bajar.
- **Una tanda cerrada por el hueco de 45 minutos no movía su video** (y el martes salían el audio y la llamada a quien ya grabó). Ahora la comparación mueve con todos los crudos vinculados de la tanda, y un crudo que COORDINACION ordena en Drive mueve su video. Un crudo viejo no destraba un video que volvió a esperar por un pedido de regrabación.
- **Un crudo de 3 horas tapaba la cola de transcripción de todos.** El tope diario ya no corta la cola; uno más largo que el tope entero pasa a plan B. La duración se estima a la baja del peso por minuto (distinto para audio y video) y después se anota la real. Lo pendiente de más de 48 horas pasa a "vieja" (no se paga el atraso del modo sombra).
- **Tandas colgadas en "comparando":** una comparación que falla vuelve a "cerrada" y una cortada a mitad se retoma a los 10 minutos.
- **AssemblyAI:** `speech_models` (lista; el campo en singular está deprecado) con `universal-3-5-pro` y `universal-2`; si rechaza el modelo, se reenvía sin modelo y queda anotado; el modelo que corrió se lee de `speech_model_used`.
- **Claude recibía "(sin fragmentos)"** cuando una toma larga ocupaba todo el espacio: ahora van ventanas por cada aparición, de cualquier crudo, y un guion sin fragmentos no se le pregunta.
- **e01:** un ciclo que arrancaba un sábado se comprimía (el audio caía un día hábil después del mensaje); el pedido de regrabación ahora manda sobre "guiones enviados"; el día 0 de un envío con constancia nace hecho (ya no aparece "vencido" pidiendo repetir el mensaje).
- **Archivos movidos** entre Crudos y Editados, o de un cliente a otro, toman el tipo y el cliente nuevos; los borrados se marcan al final de la pasada (ya no hay "crudo borrado" falso por el orden de las raíces).
- **Crudos históricos** de la primera pasada ya no se vinculan a los videos de hoy (sin tanda en la carpeta, solo a un video que espera crudos; nada creado más de 21 días antes que el video).
- **Fecha de corte en el futuro:** los guiones que pasaban a "Para grabar" antes del corte se perdían; ahora quedan pospuestos y se crean desde el corte.
- **Importación:** "completado con ClickUp" no completaba nada y sumaba un evento en cada carga; ahora guarda el id de ClickUp, la prioridad y lo que falta.
- **P6:** EDITOR veía en la ficha el mensaje del cliente de la 3.ª ronda; ahora no recibe ningún pedido. Y ya no pueden quedar dos pedidos esperando a RESPONSABLE_HUB en el mismo video.
- **Pantalla y textos:** una nota sumada a la corrección en curso ahora sí le avisa a EDITOR; los textos con un solo video van en singular; el detalle de «Regrabar» llega al texto para el cliente; los importados se ven como "Video N · ClickUp"; COORDINACION puede pedir una corrección propia con el video ya en el cliente; los vínculos se confirman preguntando y se pueden corregir; «Guiones enviados» se ofrece por tanda; "Corrección N" en las notas y en el aviso a EDITOR ("ronda" queda para el contador del cliente) y el aviso solo lleva las notas de la corrección en curso; a EDITOR con notas sin tildar se le explica qué hacer; el contador de Grabaciones pendientes cuenta solo lo que falta; el segundo se puede escribir como 1,05 desde el teclado numérico del celular.
- **Cierre por tanda (así cierra COORDINACION):** «Están bien los N: al cliente», un solo link final con todos los videos de la tanda y «El cliente dio el OK a los N» con una sola cita.
- **Plazos del vigía:** corta 60 segundos antes del límite, un paso largo no arranca pegado al corte y la corrida se cierra antes del despacho a Discord.

Sin cambios (decidido): el aviso del tope de rondas sigue saliendo por #✂️-edicion (no lleva el contenido del pedido: EDITOR solo ve que existe y, al abrir, no ve nada); y un ciclo de e01 sigue siendo uno por cliente (una tanda nueva se suma al ciclo abierto).

## Revisión de la integración (24/10, ronda 3)

Corregido, cada uno con su test (`describe('revisión de la integración, ronda 3')` en `test-edicion-db`, `test-edicion-estados`, `test-edicion-avisos`, `test-grabacion-vigia` y `test-grabacion-diario`):

- **Corregir el cliente de una carpeta** (`/edicion/vinculos`) ahora suelta en la misma sentencia lo que se armó con el cliente anterior: los archivos pierden su video, su propuesta y su tanda (y la próxima pasada completa los vuelve a mirar con el cliente nuevo); los videos del anterior sueltan el editado y, si tenían crudos de esa carpeta, quedan bloqueados (`crudo_borrado`) para que COORDINACION decida; las tandas que quedan vacías se cierran. El doc de guiones de la carpeta se vuelve a leer aunque no haya cambiado: los videos del anterior que salieron de él y todavía esperan crudos **se descartan solos** (es lo único que el bot descarta) y el cliente correcto recibe esos videos; la línea de base del resto se mantiene.
- **Un editado que pasa a los Editados de otro cliente** suelta el link final del video del cliente anterior.
- **P6:** con el pedido del cliente esperando a RESPONSABLE_HUB, nadie puede "Pedir corrección" (mandaba a EDITOR las notas de la 3.ª ronda y salteaba a RESPONSABLE_HUB). Primero decide él, o COORDINACION marca el OK del cliente.
- **e01:** con crudos sin ubicar y todos los pasos del ciclo hechos (el día 0 nace hecho con «guiones enviados»), el escalón vencido queda como «ubicar crudos» para COORDINACION (antes no aparecía nada). Las fotos, los PDF y las copias marcadas como duplicado ya no cuentan como crudos sin ubicar ni como "sin transcribir" en el aviso de la tanda.
- **«Guiones enviados»** sobre videos que ya había creado la pasada desde el doc: el día 0 del ciclo nace hecho (el video pasa a origen `aylu`) y, si el ciclo ya tenía el día 0 pendiente, queda marcado con la constancia.
- **Avisos reprogramados:** al juntarse con el pendiente de la misma base, las listas de videos y archivos se suman (antes se perdían los del aviso viejo: a ADS le llegaba un solo video).

## Checklist de RESPONSABLE_HUB para encenderlo (en orden)

- [x] **Discord:** canal privado **#✂️-edicion** creado, con su webhook en `DISCORD_WEBHOOK_EDICION` (ya está en `.env.local`; cargarlo también en Vercel si falta).
- [x] **Discord:** COORDINACION y EDITOR en el servidor, con sus IDs en `DISCORD_ID_AYLU` y `DISCORD_ID_RENE` (ya en `.env.local`; cargarlos también en Vercel si faltan). Sin ID, el aviso sale con el nombre en texto, sin notificar.
- [ ] **Discord:** volver a crear el webhook de **#ads** (dio 404 el 21/10) → `DISCORD_WEBHOOK_KICKOFF_ADS`. Sin él, el aviso a ADS va a #✂️-edicion para que COORDINACION lo reenvíe.
- [ ] **Mail de Google de EDITOR** → `EDICION_EDITOR_RENE`. Y `EDICION_REVISOR_AYLU` (mail de COORDINACION); `EDICION_REVISOR_TOMAS` es opcional. **Sin estas variables, en producción nadie mueve videos.**
- [ ] **Secretos propios:** `VIGIA_SECRETO` y `ASSEMBLYAI_WEBHOOK_SECRETO` con los comandos de arriba (y `VIGIA_SECRETO` en las propiedades del Puente Drive).
- [ ] **Compartir la carpeta "Clientes" de Drive con la cuenta de servicio** como Lector (habilita la lectura de cambios más barata y el plan B de la transcripción).
- [ ] **Decidir la fecha de corte** → `EDICION_FECHA_CORTE` (AAAA-MM-DD).
- [ ] **Aprobar** los textos para el cliente (versión `tx1`, borrador, en `lib/edicion/textos.ts`) y la cláusula del contrato que se cita en la llamada del día 4.
- [ ] **Deploy** (lo hace la sesión dueña desde `$APP_DIR`, aplicando `edicion.patch`; ver `edicion-archivos.txt` para los compartidos).
- [ ] **Acceso de EDITOR:** en Configuración, una fila de tipo "acceso" con solo **Edición**.
- [ ] **Acceso de COORDINACION (sin esto no puede abrir el tablero):** la matriz fija le da al rol `csm` solo Clientes y Referidos, y la lista fija `AUTH_USUARIOS` de Vercel siempre manda sobre Configuración. Si COORDINACION figura ahí como `csm`, sacarla de esa lista y cargarla en Configuración como "acceso" con **Clientes, Referidos y Edición** (ve lo mismo que hoy, más Edición; va a entrar directo a `/edicion`). Si ya es un acceso de Configuración, sumarle **Edición**. Después, `EDICION_REVISOR_AYLU` con su mail. (No se sumó Edición al rol `csm` a propósito: los CSM entrarían a `/edicion` en vez de a `/clientes` y lo vería cualquier otro CSM.)
- [ ] **Probar en seco:** abrir `/edicion` (en modo prueba los botones dicen qué harían) y `?dry=1` en las rutas del bot con `Bearer CRON_SECRET`.
- [ ] **Migración:** la corre sola la primera escritura con `EDICION_MODO=real` (no hace falta un paso aparte). Para revisarla antes: `scripts/edicion-esquema.mjs --imprimir` (no se conecta).
- [ ] **Importar ClickUp en real:** generar la propuesta del día (`--leer-clickup --leer-crm --fecha-corte …`), revisar con COORDINACION los `sin_cruzar` y lo "confirmar con COORDINACION", y `--cargar` (escribir CARGAR) **antes** del primer diario en modo real.
- [ ] **Modo sombra, 1 o 2 días:** `EDICION_MODO=real` + `EDICION_AVISOS=dry`, todavía sin `ASSEMBLYAI_API_KEY`. COORDINACION confirma los vínculos en `/edicion/vinculos`.
- [ ] **Publicar el disparador del Puente Drive:** pegar `docs/edicion/puente/Vigia.gs` como archivo nuevo, correr `probarVigia` y después `instalarDisparadorVigia` (instrucciones en su encabezado). No hace falta "Nueva versión".
- [ ] **Avisos reales:** sacar `EDICION_AVISOS=dry`.
- [ ] **Key de AssemblyAI** → `ASSEMBLYAI_API_KEY` (cuenta nueva, USD 50 gratis). Con la key, probar un MOV grande por link y confirmar los identificadores del modelo y el campo de palabras clave.
- [ ] **Neon:** revisar las horas de cómputo del plan: el vigía cada 15 minutos mantiene la base despierta cerca de un tercio del horario de trabajo.

## Para confirmar con COORDINACION (sección 2.13 del relevamiento)

1. ¿"Revisión" en ClickUp quiere decir que el video ya se le mandó al cliente y se espera su OK? (se importa como «Con el cliente», marcado para confirmar).
2. ¿Por dónde te entrega EDITOR los editados? (601 de los 608 archivos de "Editados" los subiste vos).
3. Cuando dejás correcciones, ¿cambiás el estado del video? ¿La etiqueta "ajuste requerido" marca lo que pide el cliente?
4. ¿Cuáles son los 3 a 5 criterios de "duro" que usás para el check de los crudos (e04)?
5. ¿Los clientes usan el chip "Grabado completo" del doc? ¿Sirve como señal?

## Pendientes (sin bloquear el encendido)

- `cj_altas` (bot del alta): `fuenteAltas.ts` devuelve vacío hasta acordar las columnas con esa sesión; mientras, los clientes nuevos se vinculan por nombre exacto o los confirma COORDINACION.
- "Graba el equipo" no tiene pantalla: por ahora `EDICION_GRABA_EQUIPO`.
- En Pendientes no se muestra la fecha del próximo recordatorio; en Vínculos no aparecen los clientes de ClickUp sin cruzar (viven en la propuesta JSON).
- El conteo de crudos de `/guiones` (`lib/clientes/drive.ts`, de otra sesión) sigue bajando un solo nivel; más adelante se puede alimentar desde `cj_grab_archivos`.
- Plan B de la transcripción (archivos de más de 4,9 GB y links privados): documentado, no implementado.

## Tests (sin red ni base real), uno por uno

```bash
for t in test-edicion-estados test-edicion-db test-edicion-vista test-edicion-acciones test-edicion-avisos test-edicion-textos \
  test-edicion-pedidos test-edicion-marca test-edicion-importar test-grabacion-vigia test-grabacion-guiones \
  test-grabacion-transcripcion test-grabacion-comparar test-grabacion-diario test-puente-vigia test-rutas test-accesos test-nav; do
  node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/$t.mjs
done
npx tsc --noEmit -p .
```
