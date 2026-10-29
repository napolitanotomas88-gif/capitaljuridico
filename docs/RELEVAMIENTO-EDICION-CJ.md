> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Grabación y Edición (C.J): síntesis, diseño y preguntas

Relevamiento del 24/10/2026 (tareas e01–e05 y f01–f06 del doc "Sistema de tareas - C.J"). Todo se hizo en solo lectura: no se escribió nada en planillas, Drive, ClickUp, Discord, Neon, el repo ni la bóveda.

Fuente original recuperada y leída con Google Docs nativo el 29/10/2026: Sistema de tareas - C.J (referencia privada). La evidencia de lectura y la comparación con las decisiones posteriores están en `work/cierre-pendientes-1`; este documento conserva el relevamiento histórico del 24/10.

## En pocas palabras

- **Lo que se puede construir ya, sin el chip:**
  - un tablero `/edicion` en el Despacho, con estados, historial, el check de COORDINACION y las notas de corrección;
  - un vigía de "Crudos" que lee Drive con la cuenta de servicio;
  - la transcripción con AssemblyAI (unos USD 2 a 2,5 por mes) y la comparación con los guiones con Claude (unos USD 5 a 10 por mes);
  - los avisos internos por Discord, en un canal nuevo #edicion-cj;
  - un panel de "Grabaciones pendientes" para la daily.
- **Lo que le toca al cliente** (seguimiento, link final, correcciones, OK) queda así hasta que llegue el chip: el bot arma el texto, COORDINACION lo copia en el grupo Contenido y toca un botón que deja la constancia. Cuando llegue el chip, ese botón pasa a "enviar".
- **Lo que tiene que hacer RESPONSABLE_HUB para arrancar (cosas chicas):**
  - crear el canal y conseguir los IDs de Discord de COORDINACION y EDITOR;
  - crear la key de AssemblyAI;
  - compartir "Clientes" con la cuenta de servicio;
  - publicar una versión nueva del Puente Drive que dispare el vigía cada 15 minutos.

---

## 1. Cómo se trabaja hoy

### Grabación

1. **Guiones.** REVISOR_GUIONES arma los guiones en el doc "Guiones - X", dentro de la carpeta del cliente. Van en tandas de 5, y cada guion tiene un chip "Video: <estado>" (No iniciado, Para grabar o Grabado completo). El cliente los revisa en el grupo Contenido.
2. **Grabación.** El cliente se graba por frases ("leés una línea, grabás"), sube los videos a "Crudos - X" y avisa por el grupo. A veces marca "Grabado completo".
   - Los ordena en subcarpetas como "Tanda / Video N", que arma él o COORDINACION.
   - Los archivos llegan con el nombre del celular (IMG_0249.MOV).
3. **Nadie avisa solo.** COORDINACION se entera en sus tres rondas diarias (a la mañana, entre las 16 y las 17, y cerca de las 20) o cuando el cliente escribe. En ClickUp está la vista "GRABACIONES PENDIENTES".
4. **Revisión a mano de COORDINACION.** Revisa tres cosas:
   - que estén todos los videos contra los guiones;
   - que estén bien grabados;
   - que no estén "duros".

   "Duro" no está definido en ningún lado. El antecedente más cercano es la reunión del 10/9: "si aprueba calidad y contenido → edición; si no → pausa con feedback".
5. **Paleta.** COORDINACION la pide recién en este paso. Llega como captura en un comentario de ClickUp o como link: el campo está lleno en 21 de 66 tarjetas, y en 8 de los 10 clientes activos llegó como captura.
6. **Seguimiento si el cliente no graba.** Se hace a mano y hay dos reglas distintas:
   - la daily (9/10) tiene una escalera en días hábiles: día 0, mensaje con guion y fecha; día 2, audio de OPERADOR_AUTORIZADO; día 4, llamada citando el contrato; día 9, RESPONSABLE_HUB decide la pausa;
   - el doc nuevo dice "cada 4 días".

### Edición (ClickUp, lista "Sistema de Edición")

1. **Carga.** Cuando llegan los crudos, COORDINACION crea una tarjeta por cliente y una subtarea por video ("video N", "video 2 tanda 3").
   - Pega el gancho y el guion en comentarios y el link del crudo en el campo "2 - Crudo".
   - EDITOR figura asignado a la tarjeta del cliente, nunca al video, y nadie le avisa.
2. **Edición.** EDITOR edita: 1080x1920, en menos de 24 horas, 10 videos por día según el SOP. Carga el link en "3 - Editado" y pasa la tarjeta a "editado".
   - **Ojo:** 601 de los 608 archivos de "Editados - X" en Drive los subió COORDINACION, así que EDITOR entrega por otro lado. Hay que confirmarlo con COORDINACION.
3. **Revisión de COORDINACION.** Busca errores y faltas de ortografía y deja las correcciones por segundo en comentarios: `seg 17 "mora"`, `corta de seg 26 a 32`, `velocidad 1.2`.
   - No hay un estado de corrección.
   - En una muestra de 39 videos, 33 tuvieron correcciones: 26 con una ronda, 6 con dos y 1 con tres.
   - EDITOR corrige en horas y pasa la tarjeta a "corregido".
4. **Envío al cliente.** COORDINACION pasa el video a "revisión" (todo indica que ya se le mandó al cliente y se espera su OK; hay que confirmarlo) y le manda el link por WhatsApp.
5. **Cierre.** El cliente da el OK o pide cambios en el grupo Contenido. COORDINACION cierra en tanda como "publicado": 253 de los 282 cierres fueron así.
6. **Pase a Anuncios.** COORDINACION sube los videos al documento compartido con ADS y le avisa por WhatsApp. ADS decide si lanza o si optimiza.

### Números que importan

| Dato | Valor |
|---|---|
| Videos creados en ClickUp | 40 en agosto, 97 en septiembre y 176 del 1 al 24 de octubre (unos 45 por semana) |
| Videos activos hoy | 37 de 10 clientes: 12 para editar, 16 en revisión, 6 en espera de datos, 2 corregidos y 1 editado. 7 de esos clientes (27 videos) son de carpetas SKWD |
| Desde que se crea el video hasta "publicado" | Mediana de 3,0 días; el 90 % tarda 6,1 días o menos |
| Crudos de los últimos 30 días (árbol completo de Drive, recalculado para esta síntesis) | 638 archivos de 45 clientes: 9,4 horas de video y 170 GB. Hay 14 de más de 2 GB y 5 de más de 5 GB |
| Tandas en 30 días (tanda = el cliente pasa 45 minutos sin subir nada) | 92. La mediana es de 4 archivos por tanda; el p90, de 21 |
| Desde que se crea la carpeta hasta el primer crudo | Mediana de 16 días. En los clientes C.J, entre 1 y 11 días |
| Clientes sin crudos hoy | 30: 17 C.J (de 0 a 15 días) y 13 SKWD (de 18 a 120 días). 4 de los SKWD ya tienen editados |

**Corrección sobre el inventario de transcripción.** Ese frente contó 491 videos y 375 minutos en octubre, pero solo bajó dos niveles de carpetas, y 1.873 crudos están más abajo. Con el árbol completo, del 1 al 24 de octubre hubo 553 videos, 9,0 horas y 165 GB. Los costos de abajo usan estos números.

### Lo que hoy no funciona

- Nadie se entera cuando el cliente sube videos, y nadie le avisa a EDITOR qué le toca.
- ClickUp, con este plan, no guarda el historial de estados: no se puede saber cuánto tarda cada paso.
- Las correcciones no tienen estado: no se distingue si las pidió COORDINACION o el cliente, y no hay tope de rondas.
- La paleta llega en cinco formatos distintos.
- Los nombres no coinciden entre ClickUp, el CRM y Drive ("De CUENTA_QA" y "De CUENTA_QA").
- **El Despacho cuenta mal los crudos:** `lib/clientes/drive.ts` baja un solo nivel y ve 510 de 2.383. Por eso `/guiones` muestra 0 crudos en 19 clientes que sí tienen.

---

## 2. Diseño propuesto

### 2.1 Principios: los mismos del kickoff

- **Dónde vive.** Todo va en el Despacho y en Neon, con tablas `cj_*` propias que se crean solas.
  - Código: `lib/bot/grabacion/` y `lib/edicion/`.
  - Rutas: `app/api/bot/grabacion/*` y `app/api/edicion/*`.
  - Pantalla: `app/(shell)/edicion/`.
- **Archivos compartidos.** Se tocan los mínimos (roles, rutas, proxy, navegación, `vercel.json` y la tabla de accesos) y siempre coordinando con la sesión dueña. El deploy sale solo de `$APP_DIR`.
- **Las decisiones quedan en la pantalla.** Un "ok" en Discord no cuenta, igual que en el kickoff.
- **Discord solo avisa.**
  - El aviso lleva el link a `/edicion`, nunca a una API.
  - Menciona solo los IDs declarados. Si falta un ID, va el nombre en texto, sin notificar.
- **Un aviso por tanda o por lote, no por video.** El SOP del editor pide avisar por cliente entero o por lote.
- **Lo que le toca al cliente.** El bot arma el texto y COORDINACION lo copia y toca "enviado". Con el chip, el mismo botón pasa a "enviar".
- **Robustez.** Cada paso es idempotente, hay modo `dry`, los tests usan simulaciones y los errores le llegan a RESPONSABLE_HUB una sola vez.

### 2.2 Piezas

| Pieza | Qué hace | Qué reutiliza |
|---|---|---|
| Pantalla `/edicion` | El tablero de videos por estado, la vista por cliente y tanda (guiones, crudos, cobertura, paleta) y el panel "Grabaciones pendientes" | El patrón de `/clientes/[id]/kickoff`: la vista pura, las acciones detrás de una barrera HTTP y las escrituras condicionadas a lo que vio la persona |
| Vigía (`/api/bot/grabacion/vigia`) | Lista "Crudos - X" y "Editados - X" de los clientes en grabación o edición, filtrando por fecha de subida mayor que la última corrida, y arma las tandas | `hijos()`, `enParalelo()` y `CARPETA_CLIENTES` de `lib/clientes/drive.ts`, y la cuenta de servicio |
| Lectura de guiones | Exporta "Guiones - X" como texto por Drive (la API de Docs da 403) y separa cada guion: `Video: <estado>`, HOOK, PROBLEMA, SOLUCIÓN y CTA. Vuelve a exportar el doc solo si cambió su fecha de modificación | `googleJson` y el permiso de solo lectura de Drive |
| Transcripción (`/transcribir` y el webhook `/transcripcion`) | Manda cada crudo a AssemblyAI con el link de Drive y guarda el texto con los tiempos de cada palabra | Es nueva |
| Comparación | Claude cruza cada guion de la tanda con las transcripciones | El cliente de Claude del kickoff (`BOT_ANTHROPIC_API_KEY`) |
| Cálculo diario | Escalones de e01, cola de EDITOR, videos trabados y resumen para la daily | Es nueva |
| Avisos | Canal #edicion-cj, y #ads para ADS | `enviarDiscord` y `escaparDiscord` de `lib/fathomAnuncios/` |
| Disparo cada 15 minutos | Un disparador de tiempo del Puente Drive llama al vigía | El Puente Drive (Apps Script de CUENTA_GOOGLE_OPERADORA_CONFIGURADA) |
| Importación | Lee ClickUp (solo lectura) y carga los 37 videos activos y las paletas | Los scripts del relevamiento |

### 2.3 Estados del video (reemplazan la lista de ClickUp)

| Estado | Cuándo entra | Quién lo mueve | Aviso |
|---|---|---|---|
| Esperando crudos | El guion está en "Para grabar" en el doc, o COORDINACION marca "guiones enviados" | El bot | El seguimiento de e01 |
| Crudo a revisar | El vigía ve crudos del video y la tanda ya se cerró | El bot | A COORDINACION, uno por tanda, con el resultado de e03 |
| Regrabar | COORDINACION marca que no sirve (está duro, falla el audio o el encuadre, falta una frase) | COORDINACION | El texto para el cliente; después vuelve a Esperando crudos |
| Para editar | COORDINACION da el check (e04) | COORDINACION | A EDITOR, uno por tanda |
| Editado | EDITOR lo marca (o el bot propone el archivo nuevo que vio en Editados) | EDITOR | A COORDINACION, uno por lote |
| Corrección (ronda N, de COORDINACION o del cliente) | COORDINACION deja notas por segundo | COORDINACION | A EDITOR, con la lista de notas |
| Corregido | EDITOR lo marca y tilda cada nota | EDITOR | A COORDINACION |
| Con el cliente ("Para publicar") | COORDINACION lo aprueba | COORDINACION | El texto con el link para el cliente (con el chip, lo manda el bot) |
| Aprobado | El cliente dio el OK | COORDINACION, con un botón (con el chip, lo detecta el bot) | A ADS en #ads |
| Pausado | El cliente está en pausa | COORDINACION o RESPONSABLE_HUB | Ninguno |

- "editando" y "publicar" de ClickUp desaparecen: nadie los usa.
- El estado del cliente lo calcula el Despacho a partir de sus videos; no se mueve a mano.
- Cada cambio queda registrado con quién lo hizo y cuándo. Eso es justo lo que ClickUp no da.

### 2.4 Tarea por tarea

| Tarea | Lo que se construye ya | Dónde corre | Aviso interno (Discord) | Lo que espera al chip |
|---|---|---|---|---|
| **e01** Seguimiento si no grabó | Para cada cliente con guiones "Para grabar" y sin crudos (o con la tanda incompleta), el bot cuenta los días hábiles y calcula el escalón según la regla que se elija (P2). El panel "Grabaciones pendientes" muestra el escalón, el texto listo y un botón "hecho" que lo registra. Quedan afuera los pausados y los que ya tienen editados | Cálculo diario y la pantalla | Resumen a COORDINACION antes de la daily. Se menciona a COORDINACION cuando le toca el audio o la llamada, y a RESPONSABLE_HUB el día 9 | Que el bot mande solo los recordatorios escritos al grupo Contenido. El audio y la llamada siguen siendo de personas |
| **e02** Vigía de Crudos | Corre cada 15 minutos con la opción A (una consulta por carpeta conocida, filtrando por fecha de subida) y hace una pasada completa por día. Distingue si subió el cliente o el equipo. Cierra la tanda a los 45 minutos sin archivos nuevos. El chip "Grabado completo" del doc sirve como segunda señal | Disparador del puente y cron diario | Un aviso por tanda a COORDINACION, que sale junto con el resultado de e03. Si la transcripción tarda más de 20 minutos, sale solo | "Recibimos tus videos" al cliente (opcional) |
| **e03** Transcribir y comparar | Cada crudo nuevo va a AssemblyAI con palabras clave de la ficha del kickoff (ciudad, estudio, ART, ANSES), nunca con el guion. Al cerrar la tanda, Claude marca por cada guion qué frases aparecen al menos una vez, qué crudo cubre qué video, la mejor toma con su minuto y lo que falta. Ubica el video por la carpeta o el nombre ("Tanda 1 / Video 4": así viene el 73 %) y, si no, por el contenido | Vigía, ruta y webhook | El resultado va en el aviso de la tanda: "4 de 5 completos; video 3: falta el CTA" | Mandar los faltantes al grupo Contenido, recién con el OK de COORDINACION |
| **e04** Check de COORDINACION | En la vista de la tanda, por cada video: "sirve", "regrabar" (con el motivo: duro, audio, encuadre o falta una frase) o "pausa con devolución", siguiendo la lista de criterios de "duro" que defina COORDINACION. Solo aprueban COORDINACION (`EDICION_REVISOR_AYLU`) y RESPONSABLE_HUB. Con "sirve", el video pasa a Para editar | Pantalla | No hay aviso propio: queda registrado en la pantalla. Al aprobar la tanda sale el aviso a EDITOR | El pedido de regrabación al cliente; hasta entonces, texto para copiar |
| **e05** Paleta antes | Una ficha de marca por cliente (`cj_marca`: colores en hexadecimal, tipografía, logo y de dónde salió cada dato), visible en la tarjeta del video. Se importan las 21 paletas de ClickUp. El bot de alta crea una carpeta "Marca - X" al lado de Crudos (`crearCarpeta` ya existe en el puente). El kickoff saca la paleta de la llamada si se habló, o la deja como faltante en la ficha. **No frena nada:** si falta al pasar a Para editar, se le avisa a COORDINACION | Alta, kickoff y pantalla | A COORDINACION, solo si falta | El pedido en la bienvenida (el texto oficial lo decide RESPONSABLE_HUB) y en el video de uso de Drive |
| **f01** Tablero y aviso al editor | El tablero `/edicion` con los estados de 2.3. Cada tarjeta lleva el cliente (con su id del CRM), el video y la tanda, el gancho, el guion, los crudos con link, la paleta, la prioridad, el motivo del bloqueo y el historial | Pantalla | A EDITOR, uno por tanda: "Para editar: CUENTA_QA, 8 videos (urgente)" con el link | No hace falta |
| **f02** EDITOR mueve a listos | EDITOR marca "listo" en cada video o "terminé la tanda". El vigía, además, detecta los archivos nuevos en "Editados - X" y propone vincularlos | Pantalla y vigía | A COORDINACION, agrupado: cuando EDITOR termina el lote del cliente o cuando pasan 30 minutos sin que marque otro | No hace falta |
| **f03** Check de COORDINACION (errores y ortografía) | COORDINACION revisa con el video al lado. Si hay problemas, deja notas por segundo (segundo, texto e imagen opcional) y el video pasa a Corrección, con su número de ronda y origen "COORDINACION". Si está bien, lo pasa a Con el cliente. EDITOR tilda cada nota a medida que la resuelve | Pantalla | A EDITOR, con la lista de notas | No hace falta |
| **f04** Link final al cliente | Al pasar a Con el cliente, el bot arma el mensaje para el grupo Contenido con el link del editado en Drive. COORDINACION lo copia y toca "enviado", y queda la hora | Pantalla | No hay | Que el bot lo mande solo |
| **f05** Correcciones del cliente | COORDINACION pega el pedido del cliente. Claude lo separa en notas, clasifica cada una (texto, corte, b-roll, título, cambio de guion), marca si afecta el rendimiento del video y cuenta la ronda. COORDINACION confirma cuáles van: esas pasan a Corrección con origen "cliente". El tope de rondas se aplica según P6 | Pantalla y Claude | A EDITOR cuando COORDINACION confirma. A RESPONSABLE_HUB si llega a la ronda 3 | Que el bot lea el grupo Contenido y arme las notas solo. El check de COORDINACION se mantiene |
| **f06** OK del cliente | Un botón "el cliente dio el OK", con la cita del mensaje, pasa el video a Aprobado y le avisa a ADS | Pantalla | A ADS en #ads, con los links y una sugerencia: campaña nueva u optimización (criterio del doc: si en esa cuenta ya hay campañas recientes) | Que el bot detecte el OK en el grupo Contenido y lo proponga. El primer mes lo confirma COORDINACION |

### 2.5 Datos en Neon (tablas nuevas que se crean solas, como `cj_kickoffs`)

- `cj_grab_carpetas`: el árbol de Crudos y Editados de cada cliente (id de la carpeta, id del CRM, tipo, ruta, última vez que se vio).
  - Los clientes nuevos traen los ids desde `cj_altas`.
  - Los viejos se vinculan una sola vez: el bot cruza por nombre y COORDINACION confirma en la pantalla.
- `cj_grab_archivos`: un registro por crudo o editado. Guarda:
  - los datos del archivo: id de Drive, cliente, carpeta, nombre, peso, duración, resolución, fecha de subida y quién lo subió;
  - lo que infiere el bot: tanda y video;
  - la transcripción: estado, id y texto con los tiempos.
- `cj_grab_tandas`: un lote por cliente (desde, hasta, si está cerrada, resultado de la comparación, check de COORDINACION, id del aviso).
- `cj_videos`: una fila por video. Guarda:
  - de qué se trata: cliente, tanda, número, guion de referencia y gancho;
  - los archivos: crudos y editado;
  - en qué está: estado, prioridad, motivo del bloqueo y ronda de corrección del cliente;
  - la entrega: hora del envío del link y OK del cliente.
- `cj_video_eventos`: el historial (de qué estado a cuál, quién, cuándo, nota).
- `cj_video_notas`: las correcciones (segundo, texto, origen, ronda, tilde de EDITOR, evaluación del bot).
- `cj_grab_seguimientos`: los escalones de e01 (cliente, desde cuándo, escalón, texto, quién lo hizo y cuándo).
- `cj_marca`: paleta, tipografía, logo y de dónde salió cada dato, por cliente.

**El conteo de crudos se arregla de paso.** El árbol guardado en Neon puede alimentar el "se grabó" de `/guiones`. La alternativa es corregir `resumirArchivos` para que baje hasta 4 niveles, pero ese archivo es de otra sesión y hay que coordinarlo.

### 2.6 Disparadores

- **Cada 15 minutos, de 8 a 22 horas:** un disparador de tiempo en el Puente Drive hace un POST al vigía con un secreto propio (`VIGIA_SECRETO`), guardado en las propiedades del script igual que `SECRETO`. Hace falta porque el plan Hobby de Vercel solo permite crons diarios.
  - Del lado de Apps Script son unos 2 segundos por corrida, 96 corridas por día: entra en las cuotas de una cuenta común.
  - Del lado de Vercel:
    - si se miran solo los clientes C.J en grabación o edición, son 33 consultas a Drive por corrida;
    - con todos los activos, unas 360 (unos 25 segundos con 8 en paralelo);
    - con "Clientes" compartida con la cuenta de servicio se baja a 1 o 2 consultas (`changes.list`).
- **Una vez por día (cron nuevo de Vercel):**
  - hace la pasada completa del árbol: carpetas nuevas, archivos movidos o borrados;
  - corre el cálculo de e01 y de los videos trabados.

  En Hobby el minuto exacto del cron no está garantizado. Por eso el resumen de antes de la daily (punto 9: "Grabaciones pendientes" y "cola de EDITOR") lo dispara la primera corrida del vigía después de las 8:00 que vea que todavía no salió.
- **Por evento:** el webhook de AssemblyAI (`/api/bot/grabacion/transcripcion`, con una cabecera secreta) y las acciones de la pantalla.
- **Control:** la pantalla muestra "último vigía hace X". Si pasan 2 horas sin corrida en horario de trabajo, se le avisa a RESPONSABLE_HUB.

### 2.7 Transcripción recomendada y costo

- **Proveedor:** AssemblyAI Universal-3.5 Pro, que recibe el link de descarga de Drive (`drive.usercontent.google.com/download?id=…&export=download&confirm=t`). Así ni Vercel ni la Mac bajan el video.
  - Acepta videos de hasta 5 GB y avisa por webhook.
  - Según AssemblyAI, en español erra cerca del 4 % de las palabras.
  - Configuración: idioma `es` y palabras clave; nunca el guion como contexto, porque lo induce a "oír" frases que no se dijeron.
- **Costo de la transcripción:** 9,4 horas por mes × USD 0,21 a 0,26 por hora = **USD 2 a 2,5 por mes**. En un escenario alto (×1,5), USD 3,7. Los USD 50 gratis de AssemblyAI cubren cerca de un año y medio.
- **Costo de la comparación con Claude** (Opus 5.5, el mismo del kickoff: USD 4 por millón de tokens de entrada y USD 20 por millón de salida): unas 92 tandas por mes × USD 0,05 a 0,10 = **USD 5 a 10 por mes**. Es una estimación sin medir. Se puede bajar con un cruce simple antes: si todas las frases aparecen tal cual, no hace falta llamar a Claude.
- **Clasificar los pedidos del cliente (f05):** centavos.
- **Total: USD 7 a 13 por mes.** Drive, Discord y Neon no suman costo, y Vercel sigue en Hobby.
- **Plan B:** para los archivos de más de 5 GB (5 en 30 días, todos de cámara 4K del equipo) o si se cierra el link público:
  - primera opción: el Despacho le pasa el archivo de Drive a AssemblyAI sin guardarlo. Necesita "Clientes" compartida con la cuenta de servicio, aguanta hasta 2,2 GB y falta medir cuánto tarda en Vercel;
  - si no alcanza: ffmpeg y faster-whisper large-v3-turbo en la Mac, o en la VPS cuando exista.
- **Pendientes:**
  - probar con una key que AssemblyAI baje desde ese link un MOV de 1,4 GB;
  - borrar la transcripción del lado de AssemblyAI apenas se guarda en Neon.

### 2.8 Avisos de Discord (canal privado nuevo #edicion-cj, con EDITOR, COORDINACION y RESPONSABLE_HUB; COORDINACION es opcional)

- A COORDINACION, cuando llega una tanda: «@COORDINACION Crudos nuevos · CUENTA_QA · Tanda 1: 14 archivos (los subió el cliente) · 4 de 5 guiones completos · video 3: falta el CTA · Revisar en /edicion».
- A EDITOR: «@EDITOR Para editar · CUENTA_QA · 8 videos (urgente) · paleta cargada · /edicion».
- A COORDINACION: «EDITOR terminó 6 de 8 de CUENTA_QA · revisar en /edicion».
- A EDITOR: «Corrección · CUENTA_QA· video 1 (ronda 1, de COORDINACION): 3 notas · /edicion».
- Resumen antes de la daily: clientes por escalón de seguimiento, la cola de cada estado y lo que lleva más de 24 horas trabado.
- A ADS, en #ads (con `DISCORD_WEBHOOK_KICKOFF_ADS` y `DISCORD_ID_VALENTINO`, los mismos que dejó preparados el kickoff): «CUENTA_QA aprobó 8 videos · links en Editados · parece optimización (hay campañas activas de los últimos 7 días)».
- Si algo falla, un solo aviso a RESPONSABLE_HUB en el mismo canal. En ningún aviso van mails ni teléfonos.

### 2.9 Accesos

- **Sección nueva.** `edicion` (`/edicion` y `/api/edicion/*`) se suma a `SECCIONES` y se asigna desde Configuración.
- **Quién entra:**
  - COORDINACION ya entra, porque es administradora.
  - EDITOR necesita una fila de tipo "acceso" con [edicion]. Falta su mail de Google. No conviene darle Clientes, porque la ficha muestra los cobros.
  - ADS se arregla con el aviso de Discord. Si se quiere, puede tener [edicion] de solo lectura.
- **Quién aprueba** (e04, f03, el pase a Con el cliente y el OK del cliente): `EDICION_REVISOR_AYLU` (su mail) y RESPONSABLE_HUB. En producción, si la variable no está, nadie aprueba (igual que `KICKOFF_REVISOR_*`). EDITOR solo marca "listo" y "corregido" y tilda notas.
- **Archivos compartidos** que hay que tocar, coordinando con la sesión dueña:
  - `lib/auth/roles.ts`;
  - `lib/auth/rutas.ts`;
  - `proxy.ts` (el matcher del vigía y del webhook);
  - `docs/ACCESO-Y-ROLES.md` (lo controla `scripts/test-rutas.mjs`);
  - la navegación;
  - `vercel.json` (el cron diario).

### 2.10 Pase desde ClickUp

- **Qué se importa.** Con una lectura de ClickUp se cargan los 37 videos activos (estado, crudo, editado, gancho y guion de los comentarios, prioridad) y las 21 paletas.
- **Equivalencias:**
  - "en espera de datos" pasa a Esperando crudos;
  - "para editar" queda en Para editar;
  - "editado" queda en Editado;
  - "corregido" queda en Corregido;
  - "revisión" pasa a Con el cliente, si COORDINACION confirma qué significa;
  - "publicado" no se importa: queda solo como referencia de tiempos.
- **Nombres.** El cruce con el id del CRM lo revisa COORDINACION en la pantalla ("De CUENTA_QA" y "De CUENTA_QA", "CUENTA_QA", "CUENTA_QA").
- **Corte.** Desde una fecha, lo nuevo va solo al Despacho y ClickUp queda de consulta. En ClickUp no se escribe nada.

### 2.11 Orden de construcción

1. **Fase 1 (no depende de nadie):**
   - las tablas;
   - el vigía con la opción A, con disparo manual y cron diario;
   - el tablero `/edicion` con los estados, el check de COORDINACION, las notas de corrección y el historial;
   - el panel de grabaciones pendientes con los textos para copiar;
   - la importación de ClickUp en modo de prueba;
   - los avisos de Discord (si faltan los IDs, va el nombre en texto);
   - el arreglo del conteo de crudos, coordinado con la sesión dueña.
2. **Fase 2 (con la key de AssemblyAI):** la transcripción, la comparación y el aviso por tanda.
3. **Fase 3 (con el puente nuevo):** el vigía cada 15 minutos. Con "Clientes" compartida, se pasa a `changes.list`.
4. **Fase 4 (con el chip):**
   - los envíos al cliente (e01, e02, e03 y f04);
   - la lectura del grupo Contenido (f05 y f06) a través del webhook de Whapi del bot de alta.

### 2.12 Lo que tiene que hacer RESPONSABLE_HUB (no son preguntas)

1. Crear el canal privado #edicion-cj y su webhook (desde su Chrome). Sumar a COORDINACION y a EDITOR al servidor (es la tarea abierta del 5/10) y pasar sus IDs (`DISCORD_ID_AYLU` y `DISCORD_ID_RENE`).
2. Volver a crear el webhook de #ads, que dio 404 el 21/10. Es el que lleva el aviso a ADS.
3. Crear la cuenta de AssemblyAI (USD 50 gratis, sin tarjeta) y cargar `ASSEMBLYAI_API_KEY` en `.env.local` y en Vercel.
4. Compartir "Clientes" con la cuenta de servicio como Lector. Habilita `changes.list` y el plan B de la transcripción.
5. Publicar la versión nueva del Puente Drive con el disparador cada 15 minutos. El código lo armamos nosotros; la publicación es a mano, como la versión 3.
6. Pasar el mail de Google de EDITOR.

### 2.13 Para confirmar con COORDINACION

1. ¿"revisión" quiere decir que el video ya se le mandó al cliente y se espera su OK?
2. ¿Por dónde te entrega EDITOR los editados? (601 de los 608 archivos de Editados los subiste vos).
3. Cuando dejás correcciones, ¿cambiás el estado del video? ¿La etiqueta "ajuste requerido" marca lo que pide el cliente?
4. ¿Cuáles son los 3 a 5 criterios de "duro" que usás para e04?
5. ¿Los clientes usan el chip "Grabado completo"? ¿Sirve como señal?

---

## 3. Preguntas para RESPONSABLE_HUB

**P1. ¿Qué clientes entran al tablero y cuándo se deja ClickUp?**
- (a) Solo los clientes C.J nuevos. Lo viejo sigue en ClickUp hasta que se termine.
- (b) Todos los clientes activos desde una fecha de corte. Se importan los 37 videos activos y ClickUp queda de consulta.
- (c) Los dos sistemas en paralelo durante un mes.
- **Recomiendo (b).** 7 de los 10 clientes con videos activos (27 de 37 videos) son de carpetas SKWD: con (a), el tablero arranca casi vacío y COORDINACION carga en dos lados. Con (c) se duplica el trabajo.
- Qué cambia: la importación, el costo del vigía (33 o unas 360 consultas por corrida) y el cruce de nombres.

**P2. ¿Qué regla sigue el seguimiento cuando el cliente no graba (e01)?**
- (a) "Cada 4 días" corridos hasta que grabe, como dice el doc.
- (b) La escalera de la daily, en días hábiles: día 0, mensaje con guion y fecha; día 2, audio de OPERADOR_AUTORIZADO; día 4, llamada citando el contrato; día 9, RESPONSABLE_HUB decide la pausa.
- (c) La escalera de (b) y, si el día 9 RESPONSABLE_HUB decide no pausar, un recordatorio cada 4 días hábiles.
- **Recomiendo (c).** Respeta lo que ya se acordó en la daily, cuyo día 4 coincide con el doc. El reloj arranca cuando el guion pasa a "Para grabar" o cuando COORDINACION marca "guiones enviados".
- Qué cambia: el cálculo diario, los textos y qué podrá mandar solo el bot cuando llegue el chip (solo lo escrito).

**P3. ¿Cómo trabaja EDITOR con el sistema?**
- (a) Entra al Despacho (sección Edición, con su cuenta de Google): ve su cola, marca "listo" y "corregido", tilda las notas y sube el editado a "Editados - X".
- (b) No entra al Despacho: recibe los avisos por Discord y sube el editado a "Editados - X" con el nombre "video N". El bot detecta el archivo y lo pasa a Editado. Las notas le llegan por Discord.
- (c) Sigue como hoy: le entrega a COORDINACION y ella mueve los estados.
- **Recomiendo (a), con la detección de (b) como respaldo.** La cola, las notas por segundo y el historial necesitan que EDITOR toque el tablero, y f02 dice que los videos los mueve él.
- Qué cambia: los accesos (sección nueva), los avisos y quién sube el editado.

**P4. ¿Cuál es el estado final del tablero y qué dispara el aviso a ADS?**
- (a) "Aprobado": el cliente dio el OK. Ahí termina Edición y sale el aviso a ADS. El lanzamiento lo sigue la etapa Anuncios.
- (b) "Publicado": ADS ya lo lanzó en Meta. El video sigue en el tablero hasta que ADS lo marca.
- (c) Los dos estados: "Aprobado" (con el aviso a ADS) y después "En anuncios", que el bot marcaría más adelante leyendo Meta.
- **Recomiendo (a) ahora, y (c) cuando se haga la etapa Anuncios.** Los videos corren como anuncios, no en el feed, así que "publicado" confunde.
- Qué cambia: los estados, el aviso a ADS y dónde se engancha la etapa siguiente.

**P5. ¿Cómo se transcriben los crudos (e03)?**
- (a) AssemblyAI Universal-3.5 Pro con el link de Drive: unos USD 2 a 2,5 por mes, con USD 50 gratis.
- (b) ElevenLabs Scribe v2: en la tabla general erra menos, cuesta unos USD 2 por mes, pero acepta hasta 2 GB y 14 crudos por mes no entran.
- (c) Sin proveedor externo: faster-whisper en la Mac o en la VPS. Es gratis, pero hay que bajar unos 170 GB por mes, y la VPS todavía no existe.
- (d) No transcribir: solo el vigía y el check a mano de COORDINACION.
- **Recomiendo (a).** Hay que tener en cuenta que los videos de los clientes los procesa un tercero en EE. UU. (la transcripción se borra de su lado apenas se guarda). Si eso no va, (c) con la Mac como puente hasta que exista la VPS.
- Qué cambia: e03 entero y el costo.

**P6. ¿Cómo se manejan las correcciones del cliente (f05)?**
- (a) Tope de 2 rondas por video que hace cumplir el bot: la tercera no le llega a EDITOR sin el OK de RESPONSABLE_HUB. Lo que "no afecta el rendimiento" el bot lo propone para descartar y COORDINACION confirma.
- (b) Sin tope automático: el bot cuenta las rondas y marca lo cosmético, y siempre decide COORDINACION.
- (c) Tope por tanda: 2 rondas por tanda, con todas las notas juntas.
- **Recomiendo (a), pero solo puertas adentro.** El contrato no limita las rondas de edición: el "máximo 2" está solo en el doc. Por eso al cliente no se le dice "no" de forma automática: el freno es interno y la tercera ronda la decide RESPONSABLE_HUB.
- Qué cambia: la lógica de f05 y lo que ve EDITOR.

---

## 4. Riesgos

1. **El puente hace de reloj.** Si su disparador se cae, el vigía queda en una pasada por día. *Qué hacer:* mostrar "último vigía hace X", avisarle a RESPONSABLE_HUB si pasan 2 horas sin corrida y mantener el cron diario de respaldo.
2. **Los links de las carpetas permiten editar a cualquiera.** En las carpetas nuevas figura "cualquiera con el enlace: editor", así que cualquiera con el link puede borrar videos.
   - Gracias a ese permiso suben los clientes y anda la transcripción por link. Cerrarlo rompe las dos cosas.
   - *Qué hacer:* compartir "Clientes" con la cuenta de servicio (deja listo el plan B) y decidir el permiso aparte.
3. **Los crudos son de la cuenta del cliente** (2.150 de 2.383). Si los borra o se queda sin espacio, se pierden. *Qué hacer:* la pasada diaria detecta los borrados y avisa; EDITOR baja el crudo apenas el video entra a Para editar.
4. **Falsos "completo" en e03.** Los crudos traen tomas repetidas y la voz de quien dirige, y si al transcriptor se le pasa el guion, "oye" frases que no se dijeron. *Qué hacer:* nada de guion en el transcriptor, el criterio es "cada frase aparece al menos una vez", y el check de COORDINACION sigue siendo la puerta: e03 nunca le pasa un video a EDITOR solo.
5. **Cliente equivocado.** Los nombres no coinciden entre ClickUp, el CRM y Drive. *Qué hacer:* trabajar siempre con el id del CRM y el id de la carpeta; los vínculos de los clientes viejos los confirma COORDINACION una vez.
6. **Avisos que nadie lee.** COORDINACION y EDITOR todavía no están en el servidor de Discord (tarea del 5/10). Sin eso, el tablero anda pero los avisos no les llegan. *Qué hacer:* el resumen diario y un contador en la pantalla.
7. **EDITOR es un cuello de botella.** Es un solo editor para unos 45 videos por semana (su capacidad es de 10 por día), y ya se atrasó 7 videos el 15/7. No hay un editor de respaldo definido. *Qué hacer:* el tablero muestra la cola y avisa si un video pasa más de 24 horas en Para editar.
8. **Doble carga durante el pase.** Si no hay fecha de corte, COORDINACION carga en ClickUp y en el Despacho. Lo resuelve P1.
9. **Cuando llegue el chip.**
   - Whapi no es oficial y el número puede quedar bloqueado.
   - Un "OK" mal leído dispararía el aviso a ADS y el lanzamiento.
   - El número del bot tiene que estar en el grupo Contenido de cada cliente, y en los viejos hay que sumarlo a mano.
   - *Qué hacer:* el bot propone y COORDINACION confirma durante el primer mes.
10. **Archivos grandes.** Por mes llegan 5 crudos de más de 5 GB, que no entran en AssemblyAI por link, y 13 de más de 2,2 GB, que no se pueden subir desde Vercel. Son de cámara del equipo, no del cliente. *Qué hacer:* procesarlos en la Mac o en la VPS.
11. **Archivos compartidos y deploy.** Roles, rutas, proxy, navegación, `vercel.json` y `lib/clientes/drive.ts` son de la sesión dueña. El deploy sale solo de `$APP_DIR`.
12. **Privacidad.** Los videos y las transcripciones de los clientes pasan por un tercero. En Discord no van mails ni teléfonos.
13. **Los crons de Hobby no son puntuales.** El resumen de antes de la daily lo dispara el vigía, no el cron.
14. **ClickUp no tiene historial.** Los tiempos por paso arrancan de cero. La única referencia es la mediana de 3,0 días de punta a punta.

---

## Archivos

- Esta síntesis: `/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/<ID_PRIVADO_CONFIGURADO>/scratchpad/relevamiento/SINTESIS.md`
- El recálculo del volumen con el árbol completo de Drive (solo lee `drive/arbol.json`): `/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/<ID_PRIVADO_CONFIGURADO>/scratchpad/relevamiento/sintesis/volumen.py`
- Los frentes del relevamiento:
  - `/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/<ID_PRIVADO_CONFIGURADO>/scratchpad/relevamiento/clickup/`
  - `/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/<ID_PRIVADO_CONFIGURADO>/scratchpad/relevamiento/drive/`
  - `/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/<ID_PRIVADO_CONFIGURADO>/scratchpad/relevamiento/transcripcion/`
  - `/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/<ID_PRIVADO_CONFIGURADO>/scratchpad/relevamiento/equipo/`
