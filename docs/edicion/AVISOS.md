> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Edición · Avisos, textos, pedidos del cliente, marca, importación y puente (bloque C)

Parte del reemplazo de ClickUp por el Despacho en Grabación (e01–e05) y Edición (f01–f06). El diseño completo está en `docs/RELEVAMIENTO-EDICION-CJ.md`; el motor, en `docs/edicion/MOTOR.md` (bloque A); la pantalla, en `docs/edicion/PANTALLA.md` (bloque B).

Estado (24/10/2026): hecho y probado con juguetes en la copia `$APP_DIR`. **Sin deploy, sin commits y sin tocar servicios reales.** Todo arranca en modo prueba (`EDICION_MODO=dry`).

---

## 1. Secretos: dónde se crea y dónde se pega cada uno

> Lo que preguntó RESPONSABLE_HUB: "creo que la había armado, pero el secreto no sé dónde lo tengo que hacer".

Ninguno de los dos secretos propios se saca de un servicio. **Los generás vos en la Mac, una sola vez**, y el mismo valor va a cada lugar. Se usa formato hexadecimal: no trae comillas, `+` ni `/`, así que no se rompe en `.env` ni en una cabecera.

| Secreto | Dónde se crea | Dónde se pega |
|---|---|---|
| `VIGIA_SECRETO` | En la Mac, con el comando de abajo | **1)** Apps Script, cuenta CUENTA_GOOGLE_OPERADORA_CONFIGURADA, proyecto "Puente Drive · Despacho": **⚙ Configuración del proyecto → Propiedades de la secuencia de comandos → Agregar propiedad**. Nombre `VIGIA_SECRETO`, valor: pegar (Cmd+V), **Guardar**. Es el mismo lugar donde ya está `SECRETO`, que **no se toca**. **2)** Vercel (Production). **3)** `$APP_DIR` |
| `ASSEMBLYAI_WEBHOOK_SECRETO` | En la Mac, con el mismo comando. **No se crea en AssemblyAI**: no tiene pantalla para eso | Solo en Vercel y en `.env.local`. El Despacho lo manda solo en cada pedido de transcripción (`webhook_auth_header_value`) y lo controla cuando vuelve el aviso |
| `ASSEMBLYAI_API_KEY` | En AssemblyAI, en la sección de API keys | Vercel y `.env.local`. Hoy no está en `.env.local` |
| `DISCORD_WEBHOOK_EDICION` | Discord, en #✂️-edicion → Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL | Vercel y `.env.local` |
| `DISCORD_WEBHOOK_KICKOFF_ADS` | Lo mismo en #📣-ads (el que había dio 404 el 21/10: hay que crearlo de nuevo) | Vercel y `.env.local` |
| `DISCORD_ID_AYLU`, `DISCORD_ID_RENE` | Discord con el modo desarrollador prendido (Ajustes → Avanzado): clic derecho sobre la persona → Copiar ID de usuario | Vercel y `.env.local`. No son secretos, pero sin ellos el aviso sale con el nombre en texto y no le notifica |

**`VIGIA_SECRETO`, en un solo comando** (desde la Terminal de la Mac; no muestra el valor en ningún momento):

```bash
S=$(openssl rand -hex 32); printf '\nVIGIA_SECRETO=%s\n' "$S" >> $APP_DIR (cd $APP_DIR && printf %s "$S" | vercel env add VIGIA_SECRETO production); printf %s "$S" | pbcopy; unset S
```

Queda en `.env.local`, en Vercel y en el portapapeles. Enseguida se pega en Apps Script (fila de arriba).

**`ASSEMBLYAI_WEBHOOK_SECRETO`**: el mismo comando cambiando el nombre y sin `pbcopy` (no va a Apps Script):

```bash
S=$(openssl rand -hex 32); printf '\nASSEMBLYAI_WEBHOOK_SECRETO=%s\n' "$S" >> $APP_DIR (cd $APP_DIR && printf %s "$S" | vercel env add ASSEMBLYAI_WEBHOOK_SECRETO production); unset S
```

**Los que se copian de un servicio** (la key de AssemblyAI y los webhooks de Discord): copiarlos y correr `pbpaste | vercel env add <NOMBRE> production` desde `$APP_DIR`. Después, una línea `<NOMBRE>=…` en `.env.local`.

**Por qué el puente no usa `CRON_SECRET`:** ese secreto abre también `/api/raw`, que tiene teléfonos. `VIGIA_SECRETO` solo dispara el vigía. El mínimo de 32 caracteres se exige solo a `VIGIA_SECRETO` y a `ASSEMBLYAI_WEBHOOK_SECRETO` (con `-hex 32` salen 64). A `CRON_SECRET` no: lo usan otros 11 crons.

**Si ya habías armado un disparador a mano:** no pasa nada. `probarVigia` lista todos los disparadores del proyecto (función y cantidad), así se ve si quedó uno que llama a otra función: ese se borra a mano desde el reloj ⏰ (Activadores). `instalarDisparadorVigia` borra los de `dispararVigia` y deja uno solo.

---

## 2. Puesta en marcha, por etapas (el orden importa)

1. **Secretos y variables** (se pueden cargar ya): los de la sección 1, más `EDICION_REVISOR_AYLU`, `EDICION_EDITOR_RENE` y `EDICION_FECHA_CORTE`. Sin `EDICION_MODO`, todo sigue en modo prueba.
2. **Deploy** desde `$APP_DIR` (lo hace la sesión dueña). Los archivos compartidos van además como parche en `docs/edicion/PARCHE-COMPARTIDOS.diff` (bloque B).
3. **`?dry=1` a mano** contra producción: el vigía responde el plan en el momento, sin escribir nada.
4. **Modo sombra, 1 o 2 días:** `EDICION_MODO=real` + `EDICION_AVISOS=dry`, sin `ASSEMBLYAI_API_KEY`. El bot escribe en Neon y los avisos quedan en `/edicion/avisos` con su texto, sin salir a Discord.
5. **Recién ahora, el disparador del puente** (sección 6). En modo dry el vigía responde 202 y no hace nada: el disparador correría cada 15 minutos sin guardar nada, y "último vigía" no se movería.
6. **Avisos reales:** se saca `EDICION_AVISOS=dry`.
7. **La key de AssemblyAI** (`ASSEMBLYAI_API_KEY`): arranca la transcripción. Lo que quedó pendiente con más de 48 horas pasa a `vieja` en el primer envío y no se transcribe (no se paga el atraso).

---

## 3. Avisos de Discord

**Código:** `lib/edicion/avisos/` (`entorno.ts`, `mensajes.ts`, `cola.ts` e `index.ts`) y `lib/edicion/db/avisos.ts`, sobre la tabla `cj_edicion_avisos`, que crea la migración de A.

**Cómo se usan:**
- `avisarEventos(eventos, extra)`: lo llaman el motor y la pantalla en `after()`. Encola según las reglas de abajo y despacha lo que ya venció. **Nunca lanza.**
- `despacharPendientes()`: lo llaman el vigía (cada 15 minutos) y el diario.

**Cómo se arma y se manda cada aviso:**
- **El texto se arma al despachar**, con lo que hay en la base en ese momento. Por ejemplo, "EDITOR terminó 6 de 8" cuenta los videos que están editados ahora, no los que había cuando se encoló el aviso.
- **Menciones:** solo con el id declarado (`<@id>`, que va en `allowed_mentions.users`). Sin id, va "@COORDINACION" en texto, que no notifica a nadie.
  - RESPONSABLE_HUB: `DISCORD_ID_TOMAS` o, si falta, `ID_TOMAS` de fathom-anuncios.
  - COORDINACION: `DISCORD_ID_GERO_M` o, si falta, 1.
- **Datos personales:** todo dato variable pasa primero por `sinDatosPersonales` (mails y teléfonos quedan como "(mail)" y "(teléfono)") y después por `escaparDiscord` (sin markdown ni menciones). Se aplica a los datos y no al texto final, para no romper las menciones ni los ids de los links.
- **Largo:** máximo 2.000 caracteres. Van ítems enteros y lo que no entra se cuenta como "+N". El pie con el link no se pierde nunca.
- **Links:** siempre a la pantalla (`/edicion…`, con `DESPACHO_URL` o el dominio del Despacho), nunca a una API.
- **ADS:** no entra a `/edicion`, así que a ella le van los links a los **archivos** editados de Drive. Nunca la carpeta, que deja editar a cualquiera con el enlace.

### Reglas de agrupación

| Tipo | Disparador | Base | Cuándo sale | A quién |
|---|---|---|---|---|
| `tanda_crudos` | AvisoMotor (e03 listo o 20 min) | `tanda:<id>` (una vez) | enseguida | COORDINACION |
| `para_editar` | un video llega a para_editar | `rene_cola:<id_crm>` | enseguida si no queda nada en crudo_a_revisar del cliente; si no, 30 min | EDITOR |
| `marca_falta` | llega a para_editar sin paleta, o AvisoMotor | `marca:<id_crm>:<ymd>` (una vez) | enseguida | COORDINACION |
| `editados` | llega a editado | `aylu_editados:<id_crm>` | lote completo (nada en para_editar) o 30 min sin otro | COORDINACION |
| `correccion` | llega a correccion; también una nota (la pantalla devuelve su evento) o un pedido que se suma a la corrección abierta | `rene_correccion:<id_crm>` | 10 min | EDITOR, con las notas de la corrección EN CURSO ("corrección N" = la cuenta total; "ronda" queda para el contador del cliente) |
| `corregidos` | llega a corregido | `aylu_corregidos:<id_crm>` | lote completo (nada en correccion) o 30 min | COORDINACION |
| `aprobado` | llega a aprobado | `valen:<id_crm>` | 30 min sin otro OK | ADS en #ads |
| `tope_rondas` | AvisoMotor (P6) | `tope:<video>:<ronda>` (una vez) | enseguida | RESPONSABLE_HUB |
| `resumen_daily` | AvisoMotor | `resumen:<ymd>` (una vez) | enseguida | COORDINACION; COORDINACION si hay audio o llamada; RESPONSABLE_HUB si hay día 9 |
| `error` | cualquier bloque | `error:<proceso>:<huella>:<ymd>` (una vez) | enseguida | RESPONSABLE_HUB |
| `vigia_callado` | AvisoMotor | `callado:<desde>` (una vez) | enseguida | RESPONSABLE_HUB |
| `crudo_borrado` | AvisoMotor | `borrado:<video>:<huella del archivo>` (una vez) | enseguida | COORDINACION |
| `vinculo_pendiente` | AvisoMotor | `vinculo:<carpeta>` (una vez) | enseguida | COORDINACION |
| `transcripcion_fallida` | AvisoMotor (link_privado o grande) | `transcripcion:<id_crm>:<ymd>` | 20 min, agrupado | RESPONSABLE_HUB (plan B) |
| `bloqueo` | EDITOR marca un bloqueo "otro" | `bloqueo:<video>:<evento>` (una vez) | enseguida | COORDINACION |

### La cola

**Estados:** pendiente → enviando → enviado, dry, error, dudoso o descartado.

**Encolar:**
- **Agrupado:** una sola sentencia, `INSERT … ON CONFLICT (base) WHERE estado='pendiente' DO UPDATE`. Mezcla los datos (las listas `videos` y `archivos` se juntan sin repetir) y corre `enviar_despues`, que nunca pasa de `creado` + 2 h. `clave` queda NULL.
- **De una vez:** `clave = base` y `ON CONFLICT DO NOTHING`.

**Despachar:**
- `reclamarVencidos` toma los avisos con `FOR UPDATE SKIP LOCKED` y anota la hora en `enviado`.
- Si al despachar ya no hay nada que decir (por ejemplo, los videos volvieron atrás), el aviso queda `descartado`.

**Errores:**
- Un timeout de Discord deja el aviso en **`dudoso`**, porque pudo haber salido igual. No se reintenta solo y se ve en `/edicion/avisos`.
- Lo que quedó `enviando` más de 10 minutos también pasa a `dudoso`.
- Sin conexión o un 5xx: vuelve a la cola a los 5 minutos, hasta 3 intentos, y después queda en `error`.
- Un 400 o un 404: `error`.
- Sin `DISCORD_WEBHOOK_EDICION`: `error` ("falta DISCORD_WEBHOOK_EDICION").
- Sin `DISCORD_WEBHOOK_KICKOFF_ADS`: el aviso a ADS va a #✂️-edicion, para que COORDINACION se lo reenvíe, y le llega un error a RESPONSABLE_HUB una vez por día.

**Modos:**
- `EDICION_MODO≠real`: no se escribe nada y se devuelve el plan con el texto que saldría.
- Real con `EDICION_AVISOS=dry`: se encola y el texto queda en estado `dry`.
- Real: sale a Discord.
- Sin `DATABASE_URL` no hay cola, y se devuelve el plan igual que en dry.

**Sugerencia para ADS** (`lib/edicion/metaReciente.ts`):
- Sale de `campanasMeta()` del tablero de `/anuncios`, solo lectura y con una caché de 10 minutos, cruzando por nombre.
- Con campañas activas o un lanzamiento en los últimos 30 días: "parece optimización". Si no: "parece campaña nueva".
- Si el nombre no cruza: "sin dato de Meta: decidir con RESPONSABLE_HUB".

### Ejemplos (salida de los tests)

```
<@COORDINACION> 📥 **Crudos nuevos · CUENTA_QA** · Tanda 1: 14 archivos (los subió el cliente) · 4 de 5 guiones completos · video 3: 1 frase falta («Escribinos al WhatsApp del estudio, te respondemos hoy») · 1 crudo sin ubicar (asignalos en la pantalla) · Revisar (referencia privada)
<@EDITOR> ✂️ **Para editar · Ana CUENTA_QA** · 2 videos (1 urgente) · paleta cargada · Edición (referencia privada)
<@COORDINACION> 👀 EDITOR terminó 2 de 3 de Ana CUENTA_QA · revisar (referencia privada)
<@EDITOR> 🛠️ **Corrección · CUENTA_QA**
• video 1 («Gancho 1») (corrección 2, de COORDINACION): 2 notas
  · 0:17 · texto: dice «mora», va «demora»
  · 0:26–0:32 · corte: cortar donde se traba
<@RESPONSABLE_HUB> 🚦 **Tope de rondas · Ana CUENTA_QA · T1 video 2**: el cliente pidió la ronda 3 de correcciones. Espera tu OK para pasarle las notas a EDITOR (al cliente no se le dijo nada) · Ver el pedido (referencia privada)
<@ADS> 🎬 **Ana CUENTA_QA aprobó 2 videos** · [T1 video 1](<<RECURSO_DRIVE_PRIVADO>>) · …
💡 parece optimización (hay campañas activas en los últimos 7 días)
```

---

## 4. Textos para el cliente (`lib/edicion/textos.ts`, versión `tx1`, BORRADOR que aprueba RESPONSABLE_HUB)

Mientras no haya chip, COORDINACION copia el texto en el grupo Contenido y toca "enviado", que deja la constancia. Con el chip, el mismo botón pasa a "enviar".

- **`textoE01`:**
  - día 0 y recordatorios r1, r2…: texto para el cliente, con el link al doc de guiones y una fecha propuesta (dos días hábiles después; COORDINACION la puede cambiar);
  - días 2, 4 y 9: guías internas. El día 2 es el audio de COORDINACION, el día 4 la llamada citando el contrato, y el día 9 decide RESPONSABLE_HUB;
  - el ciclo de regrabación tiene su propio texto del día 0.
- **`textoRegrabar`:** un renglón por video, con el motivo en lenguaje amable (`MOTIVO_AMABLE`). "Duro" nunca le llega al cliente.
- **`textoLinkFinal`:** un renglón por video, con el título y el link al editado. Invita a pedir ajustes sin hablar de rondas.
- **P6:** ningún texto para el cliente dice ronda, tope ni la palabra "no" (lo controla el test).
- **Pendiente de RESPONSABLE_HUB:** la cláusula del contrato del día 4 (`CLAUSULA_CONTRATO` queda como marcador) y aprobar los textos.

---

## 5. Pedidos del cliente (f05) y tope de rondas (P6)

**`lib/edicion/pedidos.ts`, `pedidos-prompt.ts` y `db/pedidos.ts`:**
1. **Proponer.** `proponerNotas` usa Claude con el cliente del kickoff, esfuerzo `low`, `max_tokens` fijo en 16.000 y un tope de 90 s (la ruta tiene 120).
   - El schema no tiene campos que admitan null (`segundo: -1`) y la nota va en `$defs`.
   - Cada cita tiene que aparecer tal cual en el pedido; solo se ignoran los espacios, las comillas y las mayúsculas. Si no aparece, la nota se descarta y queda en `ajustes`.
   - Sin Claude (modo dry o sin key) o si falla, la propuesta sale vacía con el aviso "cargá las notas a mano". Nunca lanza.
2. **Guardar.** `crearPedido` lo guarda como `propuesto`, con `creado_por` = el nombre.
3. **Confirmar, autorizar o descartar.** `confirmarPedido`, `autorizarRonda` y `descartarPedido` usan `aplicarPedidoCliente`, `autorizarPedidoCliente` y `descartarPedidoCliente` de A. Cada una es una sola sentencia: crea las notas, decide el pedido y mueve o bloquea el video.
   - Si la ronda pasaría de `TOPE_RONDAS_CLIENTE` (2) y quien confirma no es RESPONSABLE_HUB, el pedido queda en `espera_tomas` con el bloqueo `tope_rondas_cliente`, y sale el aviso a RESPONSABLE_HUB.
   - No elegir ninguna nota es "nada que corregir" y no cuenta como ronda.
   - Si se descarta un pedido que esperaba a RESPONSABLE_HUB, se saca el bloqueo.
   - Los errores salen como `ErrorPedido` (conflicto, no_existe o no_permitido), y la API los convierte en 409, 404 o 403.
4. **`decidirRonda`** usa la regla de A (`decidirRondaCliente`, que se apoya en `puede()` y en el tope), sin reescribirla.

---

## 6. Ficha de marca (e05)

**`lib/edicion/marca.ts` y `db/marca.ts`.**

**`validarFicha` normaliza y controla:**
- los colores, en hexadecimal `#RRGGBB` ("#abc" pasa a "#AABBCC");
- las URLs, solo https (un "www.x" suelto se completa con https). Los adjuntos de ClickUp no se aceptan;
- los `quien`, que guardan el nombre, nunca el mail;
- como máximo 12 colores y 6 tipografías.

**`guardarMarca`:**
- con `version` null crea la ficha, y si ya existía da conflicto;
- con `version` n actualiza con condición sobre esa versión;
- deja a nombre de quien guarda los campos que cambiaron (`fuentesAlGuardar`);
- solo pueden guardar COORDINACION y RESPONSABLE_HUB.

**Lo demás:**
- `nombreCarpetaMarca(sufijo)` devuelve "Marca - X", para que la sesión del alta cree la carpeta.
- **No frena nada.**
- La paleta desde el kickoff queda pendiente a propósito: el schema del kickoff está en el límite de la gramática.

---

## 7. Importación desde ClickUp (modo prueba)

**`lib/edicion/importar.ts` (pura) y `scripts/edicion-importar-clickup.mjs`.**

**Cómo se corre:**

```bash
# sin red, desde un volcado
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/edicion-importar-clickup.mjs --desde-volcado <tareas.json> [--crm <crm.json>] [--fecha-corte AAAA-MM-DD]
# leyendo ClickUp (solo GET) y el CRM (solo lectura), con $APP_DIR cargado sin imprimir nada
node … scripts/edicion-importar-clickup.mjs --leer-clickup --leer-crm --fecha-corte AAAA-MM-DD
```

- Escribe `.cache/edicion-importacion/propuesta-AAAA-MM-DD.json` (ignorado en git) y un resumen con conteos.
- **No escribe en Neon ni en ClickUp.** `fetch` queda bloqueado salvo para ClickUp (solo GET) y Google (el CRM).
- Del CRM se quedan solo el id, el nombre y el estado: ni celular ni mail.

**Equivalencias de estado:**
- en espera de datos → esperando_crudos (e01 arranca en la fecha de corte);
- para editar y editando → para_editar;
- editado → editado;
- corregido → corregido;
- revisión → con_cliente, marcado "confirmar con COORDINACION" y con la constancia "importado de ClickUp";
- publicar y publicado no se importan.

**Clave del video:** `T{tanda}-V{n}` solo si el nombre trae la tanda. "video N" sin tanda pasa a `CU-<id>`. Una clave repetida en el mismo cliente también pasa a `CU-<id>`. La pantalla, los avisos y el link final NO muestran esa clave: dicen «Video N · ClickUp» (o «video N (ClickUp)» en Discord) con el número que sí se leyó del nombre.

**Campos y comentarios:**
- "2 - Crudo" y "3 - Editado": el id de Drive y el link normalizado. Un link que no es de Drive (fromsmash) queda como "otro" y se avisa.
- "1 - Paleta de Color": los hexadecimales van a colores, una URL https a referencia y el texto suelto a notas.
- Una captura en un comentario de la tarjeta queda como "captura en ClickUp (comentario del dd/mm)", con el link a la tarea. **Nunca la URL del adjunto.**
- El gancho y el guion salen de los comentarios de la subtarea. Las correcciones "seg 7…" no cuentan.

**Cruce con el CRM:** con `crearCruceCarpetas`. Lo dudoso va a `sin_cruzar`, con candidatos ordenados por parecido: la misma palabra vale 1, un tipeo ("CUENTA_QA" y "CUENTA_QA") 0,8 y un apodo que es el comienzo del nombre ("CUENTA_QA" y "CUENTA_QA") 0,6. La paleta se importa de **todos** los clientes cruzados, también los que hoy no tienen videos activos. Las tarjetas que ya no tienen nada activo se cuentan en `conteo.tarjetas_cerradas`, sin listarlas.

**Validación sin red (24/10)** con el volcado del relevamiento (`tareas.json` y `detalle_muestra.json`) y el snapshot local del CRM. Se imprimieron solo conteos y la propuesta quedó en el scratchpad:
- de los 37 videos activos, 28 son de 8 clientes cruzados y 9 quedan sin cruzar, en 2 tarjetas;
- "CUENTA_QA" queda con "CUENTA_QA De CUENTA_QA" primero entre los candidatos (1,8) y "CUENTA_QA" queda para que decida COORDINACION;
- 25 de los 28 videos quedan como `CU-…`, porque el nombre no dice la tanda, y 16 entran como "revisión → confirmar con COORDINACION";
- 28 fichas de marca, y ninguna URL de adjunto.

**`cargarPropuesta(prop, repo)`:** queda lista y probada solo con un repositorio falso. Idempotente por `clickup_id`.
- Un video del doc que sigue esperando crudos y que ninguna persona tocó se completa de verdad: el id de ClickUp (la carga siguiente lo reconoce y no repite el evento), la prioridad, el gancho si el doc no lo trae y el link al editado. El guion del doc manda.
- Si ya avanzó, queda como conflicto para COORDINACION.
- No pisa una ficha de marca existente.
- El crudo y el link de ClickUp quedan en el evento `importado`.
- Con `--cargar` exige `EDICION_MODO=real`, una propuesta generada ese mismo día y escribir CARGAR. **No se corrió.**

---

## 8. Puente Drive: `docs/edicion/puente/Vigia.gs`

- Es un **archivo nuevo** del proyecto de Apps Script ("Vigia"), con su propia `VERSION_VIGIA`.
- No se pega en `Código.gs` (VERSION 2026-10-24b, de la sesión del alta) ni sube su `VERSION`.
- No repite ningún nombre global de `Código.gs`, porque Apps Script junta todos los `.gs` en un solo espacio de nombres.

**Funciones:**
- `dispararVigia`: cada 15 minutos, de 8:00 a 21:59 de Argentina. Hace un POST con `Authorization: Bearer <VIGIA_SECRETO>` y el cuerpo `{origen:'puente', version}`. El log lleva solo el código HTTP, nunca el cuerpo ni el secreto.
- `instalarDisparadorVigia`: deja uno solo y no toca los de otras funciones.
- `quitarDisparadorVigia`.
- `probarVigia`: dice si la propiedad está cargada, sin mostrarla, y lista los disparadores con su cantidad.
- La propiedad opcional `VIGIA_URL` pisa la URL del Despacho.

**Instalación:** está en el encabezado del archivo.
1. Pegarlo como archivo nuevo (copiarlo con `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbcopy < docs/edicion/puente/Vigia.gs`).
2. Ejecutar `probarVigia`.
3. Con `EDICION_MODO=real` ya en Vercel, ejecutar `instalarDisparadorVigia` una vez. Pide permisos nuevos: conectarse a un servicio externo y ejecutarse cuando no estás. Si `appsscript.json` tiene `oauthScopes` escritos a mano, sumar `script.external_request` y `script.scriptapp`.
4. **No hace falta "Nueva versión":** el disparador corre el código guardado, y publicar subiría además lo pendiente del alta.

---

## 9. Variables de entorno del bloque C

| Variable | Para qué | Si falta |
|---|---|---|
| `DISCORD_WEBHOOK_EDICION` | Canal #✂️-edicion | Los avisos quedan en `error` (en modo real) |
| `DISCORD_ID_AYLU`, `DISCORD_ID_RENE` | Menciones | El nombre en texto, sin notificar |
| `DISCORD_ID_TOMAS`, `DISCORD_ID_GERO_M` | Menciones | Los ids de siempre (fathom-anuncios, ggeroo) |
| `DISCORD_WEBHOOK_KICKOFF_ADS`, `DISCORD_ID_VALENTINO` | Aviso de "aprobado" a ADS en #ads | Va a #✂️-edicion para COORDINACION, más un error a RESPONSABLE_HUB |
| `EDICION_MODO` | `real` escribe y avisa | `dry`: no escribe nada |
| `EDICION_AVISOS` | `dry` = modo sombra (los avisos no salen a Discord) | Salen (si el modo es real) |
| `DESPACHO_URL` | Base de los links | `${AUTH_BASE_URL}/` |
| `CLICKUP_TOKEN`, `CLICKUP_LISTA_EDICION`, `EDICION_FECHA_CORTE` | Importación (solo lectura) | Lista 1; la fecha de corte es hoy |
| `META_ANUNCIOS_TOKEN` | La sugerencia para ADS (lectura, vía el tablero) | "sin dato de Meta: decidir con RESPONSABLE_HUB" |
| `BOT_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY`, `KICKOFF_MODELO` | f05 (propuesta de notas) | Propuesta vacía: "cargá las notas a mano" |

---

## 10. Tests (sin red, sin base real, sin Discord, sin Claude), uno por uno

```bash
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-avisos.mjs     # 29
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-textos.mjs     # 10
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-pedidos.mjs    # 11
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-marca.mjs      # 8
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-importar.mjs   # 13
node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-puente-vigia.mjs       # 11
```

---

## 11. Lo que queda (bloque C)

- **RESPONSABLE_HUB:**
  - aprobar los textos `tx1` y la cláusula del contrato del día 4;
  - volver a crear el webhook de #ads (#✂️-edicion, su webhook y los ids de COORDINACION y EDITOR ya están en `.env.local`: cargarlos en Vercel si faltan);
  - generar y cargar `VIGIA_SECRETO` y `ASSEMBLYAI_WEBHOOK_SECRETO` (sección 1);
  - definir la fecha de corte (`EDICION_FECHA_CORTE`);
  - instalar el disparador del puente recién con el modo real (sección 2).
- **Importación real:** correr `--leer-clickup --leer-crm` en modo prueba cuando RESPONSABLE_HUB lo pida, revisar con COORDINACION los `sin_cruzar` y "confirmar con COORDINACION", y `--cargar` antes del primer diario real, con la propuesta de ese día.
- **Para confirmar con COORDINACION:** qué significa "revisión" en ClickUp, que hoy se importa como Con el cliente.
