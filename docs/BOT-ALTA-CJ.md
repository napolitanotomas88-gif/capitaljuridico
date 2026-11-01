> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot "Capital Jurídico": alta automática de clientes (Fase 1)

Pedido de RESPONSABLE_HUB (21/10/2026). Fuente: doc "Sistema de tareas - C.J" (Drive <ID_PRIVADO_CONFIGURADO>).

**Decisiones tomadas:**
- La aplicación vive **dentro del Despacho** y reemplaza a ClickUp.
- El equipo aprueba por **WhatsApp**, en el grupo **Verificaciones C.J** (dentro de la comunidad del equipo): ahí van TODAS las altas, los checks humanos y las verificaciones (los avisos de cada área van a los grupos CSM, OPERACIONES, ADS, COPYWRITING y EDICIÓN).
- El número nuevo del bot va en **Whapi.Cloud**, porque es el único proveedor con API documentada para crear comunidades. Se conecta por QR, así que no es oficial.
- Los closers cargan las altas con el formato **`#ALTA`**.
- 2Chat sigue igual para los mensajes de los closers.

## Formato #ALTA (lo mandan los closers en "Ventas C.J." junto con el comprobante)

```
#ALTA
Closer: CUENTA_QA
Programa: Agencia
Tipo de pago: PP 3300 USD        (PP = en cuotas / PIF = pago completo)
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: …
Teléfono: +54 9 …
Correo: …
Socios:                          (uno por línea: nombre · teléfono · correo; sin socios, "Socios: ninguno")
Nombre Apellido · +54 9 … · correo@…
Nombre Apellido · +54 9 … · correo@…
Dirección: …
DNI: …
CUIT: …
Inicio del servicio: dd/mm/aaaa
Cuotas:
dd/mm/aaaa 1100
dd/mm/aaaa 1100
```

**Socios (RESPONSABLE_HUB, 24/10/2026):** los socios también reciben la invitación a Skool, así que cada socio va con **nombre, teléfono y correo**, en una sola línea debajo de "Socios:" (separados por "·", coma o espacio). Detalle en "Socios con correo".
- El formato de antes se sigue leyendo: "Socios: Ana Gómez +54 9 …" en la misma línea, o varios separados por coma ("Ana Gómez +54 9 …, CUENTA_QA CUENTA_QA +54 9 …").
- Un socio con nombre y sin correo es un **faltante**: el bot se lo pide al closer, igual que el correo del cliente.
- Para los socios no se usan "Tel:", "Correo:" ni "Mail:": esas claves son las del cliente. Si llegan dos correos distintos en "Correo:", el bot pregunta cuál es el del cliente.

## Altas en formato libre y reglas unificadas de Fee, cliente existente y primera cuota (RESPONSABLE_HUB, 26/10/2026)

Pedido de RESPONSABLE_HUB: "esto por ejemplo es un alta, lo identificás por la información". El mismo día decidió que el `#ALTA` use **las mismas reglas** (Fee, cliente existente y primera cuota). Código: `lib/bot/alta/altaLibre.ts` (puro), el webhook (`lib/bot/whapi/webhook.ts`), `pasoValidar`, `pasoFinanzas`, `pasoComunidad`, la máquina de estados y el orquestador. Tests: `scripts/test-bot-alta-libre.mjs` y "alta en formato libre" en `scripts/test-bot-orquestador.mjs`. Todo probado sin red: no se probó con WhatsApp real.

**Detección del formato libre (sin Claude, con reglas):** un mensaje de Ventas C.J. sin `#ALTA` **y sin citar** es un alta probable si trae las tres cosas:
- un nombre de cliente en "Nombre:", "Nombre completo:", "Nombre y apellido:" o "Cliente:" (dos palabras o más, sin números);
- un contacto: "Tel/Teléfono/Cel/Celular/WhatsApp/Wsp:" con 8 dígitos o más, o un correo;
- una señal de pago: USD, U$S, $ con un número, PIF, PP, cuota, seña, Fee, pago, abono, anticipo, "completa"…

Tolera mayúsculas, acentos, ":" o " - ", negritas de WhatsApp, el orden que sea y campos extra (CI, DNI, Dirección, Programa, Closer, Socios). La charla del grupo no entra (hay 15 mensajes de charla en los tests, por ejemplo "son 800 usd que entraron hoy y mañana 1800 para completar"). Citando un mensaje sigue siendo una respuesta. También vale como pie de una imagen o un PDF.

**Parseo:** el mismo `parsearAlta`, con claves nuevas: "Cliente", "Cel", "WhatsApp", "CI" o "Cédula" (va al DNI) y "Clave - valor". La primera línea da el tipo y el monto ("Completa PIF 1299 USD" → PIF 1299). También lee "Seña 300 USD" y "2 cuotas de 1300".
- El closer sale del autor con **`BOT_ALTA_CLOSERS`** y queda como "Closer:" arriba del texto. Si el autor no está en la lista, se le pregunta al closer.
- Plantilla de `BOT_ALTA_CLOSERS`: `{"CloserUno":"<TELEFONO_CLOSER_UNO>","CloserDos":"<TELEFONO_CLOSER_DOS>","CloserTres":"<TELEFONO_CLOSER_TRES>"}`. Los marcadores no son contactos ni valores válidos para ejecución: configurar números autorizados fuera de Git.
- Lo que falte (inicio, DNI…) se pide con el pedido de siempre.

**Quién confirma:** los de **`BOT_ALTA_APROBADORES`** (CSM, COORDINACION y COORDINACION, cargados por RESPONSABLE_HUB el 26/10). Lo mismo para la suma de un Fee.

**Confirmaciones en Verificaciones C.J** (citando, OK / NO):
- **Formato libre, antes de hacer NADA:** "¿Esto es un alta? CUENTA_QA · closer CUENTA_QA · PIF 1299 USD … Respondé citando este mensaje: OK / NO". Con OK sigue igual que un `#ALTA`. Un `#ALTA` no tiene esta pregunta.
- **Regla A, cliente que ya existe** (en el `#ALTA` y en el formato libre). Antes de seguir se busca a la persona en el CRM de Clientes por teléfono, correo o nombre (solo lectura). FINALIZADO = alta nueva; INACTIVO, sin estado, ACTIVO o PAUSADO = pago. Una renovación (DFY+R) no se busca. Si ya está: "💳 CUENTA_QA ya está en el CRM de Clientes (Z001…): no es un alta, es un pago de 1000 USD… ¿Lo cargo en Finanzas como pago de un cliente existente?". Con OK solo corre Finanzas y el alta termina `lista`.
  - El concepto es la cuota que sigue a las de ese cliente en "Registro de Pagos": se cuentan sus cuotas y PIF por nombre o por los últimos 8 dígitos del teléfono, y los Fee no cuentan. Como mínimo es "2da Cuota"; después, "3ra Cuota", etc. Se calcula una vez y queda guardado en el paso (`conceptoCuota`).
  - **Ojo:** la lista desplegable de la columna J hoy llega hasta "2da Cuota". Hay que sumar "3ra Cuota", "4ta Cuota"… Si la lista es estricta y falta la opción, Finanzas no carga la fila y queda a revisar.
- **Regla B, Fee** (en el `#ALTA` y en el formato libre). Un Fee es un pago de menos de USD 500 o, si se sabe la primera cuota, menor que ella: por ejemplo, 800 de un PIF de 2600. Pregunta: "💰 Fee de CUENTA_QA (300 USD, closer CUENTA_QA). ¿Lo cargo en Finanzas y creo la comunidad?". Con OK corren Finanzas (concepto "Fee") y la comunidad de WhatsApp, y nada más. El Fee **no** da el alta en el CRM: `FEE_LIBRE_CON_CRM = false`, decisión de RESPONSABLE_HUB. El alta queda `fee`. En el formato libre, si el pago ya era un Fee, la primera pregunta es esta.
- Con NO no se hace nada: el alta queda `rechazada`, sin mensaje al closer, y no se vuelve a preguntar por ese mensaje (ni si Whapi lo reenvía o el closer lo edita). Un OK citado dentro de los 7 días la retoma.
- En seco o en ensayo, las preguntas quedan anotadas y el resto corre como vista previa.

**Regla C, completar la primera cuota** (las dos formas). La primera cuota es el total de un PIF o el monto de "N cuotas de X", de este mensaje o del Fee. Un PP del `#ALTA` sin "N cuotas de X" no la dice: el umbral queda en USD 500. Cuando los pagos de la cadena llegan a esa cuota, los aprobadores responden: "CUENTA_QA completó la primera cuota (300 + 1000 = 1300 USD). ¿Sigo con el alta completa?". Si no se sabe la cuota, el mensaje lo dice.
- Con OK corre el resto del alta: CRM, Drive, Skool, bienvenida y contrato. La comunidad del Fee se reusa, no se arma otra.
- Con NO, ese pago queda como Fee: se carga en Finanzas y vale como el OK del Fee.

**Comprobante aparte (formato libre):** las imágenes y los PDF del mismo autor, sin citar, que llegan dentro de los **30 minutos** van al alta libre mientras no se validó. En el ejemplo real llegaron 12 y 13 minutos después.

**Regla D, pagos siguientes:**
- Un alta libre, o un "Pago 1000 USD · Nombre: CUENTA_QA" sin contacto, se une al Fee abierto de la misma persona por teléfono, correo o nombre. Los datos que no repite (teléfono, correo, plan) salen del Fee y no se vuelve a preguntar "¿Esto es un alta?".
- Un alta libre de alguien con un alta abierta que no es Fee se ignora. Si esa alta le estaba pidiendo datos al mismo closer, son esos datos sin citar y se suman.

**Cambios de comportamiento del `#ALTA` (tests actualizados):**
- Un Fee pide el OK y además arma la comunidad (antes solo cargaba Finanzas, sin OK).
- La suma Fee + pago usa el mensaje de la regla C.
- Un PIF pagado en parte, por debajo del total, es un Fee.
- Un cliente que ya está en el CRM es un pago con OK. Antes seguía como alta, y el paso CRM preguntaba por el duplicado.

**Lo que queda abierto:**
- Sumar "3ra Cuota" en adelante a la lista desplegable de la columna J de Finanzas.
- Un comprobante solo, sin texto, de un cliente con un Fee abierto no se reconoce por el ordenante: hace falta el mensaje del pago.
- Un Fee al que ya le llegó el pago siguiente igual pide su OK y arma su comunidad, y el alta que completa la cuota la reusa.

## Flujo

Cada paso es **idempotente** y queda guardado en Postgres (Neon), en la tabla `cj_altas` con un registro por paso. Si algo falla, se reintenta desde ese paso sin duplicar nada.

| # | Paso | Cómo | Check humano |
|---|---|---|---|
| 0 | Detectar `#ALTA` en "Ventas C.J." | Webhook de Whapi → `/api/bot/whapi` | — |
| 1 | Validar | Parser fijo de los campos. Claude con visión lee el comprobante (monto, moneda, fecha, n.º de operación y destinatario) y lo compara con "Este pago". Regla: **≥ USD 500**; con menos es un **Fee** (ver "Decisiones de RESPONSABLE_HUB para Finanzas"). | Si falta un dato, el bot le pide al closer el dato que falta. Si no coincide, pregunta a RESPONSABLE_HUB o OPERADOR_AUTORIZADO en Verificaciones C.J. Un Fee solo se registra en Finanzas y se avisa ahí: el resto del alta espera a que el pago llegue a 500 |
| 2 | Finanzas | Fila en `Registro de Pagos` (SHEET_ID_FINANZAS) más el comprobante subido a Drive | COORDINACION revisa la carga |
| 3 | CRM Clientes | Fila en Agencia + período 0 en Renovaciones + fórmulas, a partir de `lib/clientes/altas.ts`, que hoy solo arma el plan sin escribir y pasa a escribir de verdad | — |
| 4 | Drive | Carpeta "Nombre completo - C.J" con el doc "Guiones - X" (copia de la plantilla), las carpetas "Crudos - X" y "Editados - X", y el doc "Bienvenida - Nombre" (ver "Carpeta de Drive del cliente") | — |
| 5 | WhatsApp | Comunidad "Nombre - C.J" con 3 grupos (ver abajo), foto y descripción, **solo con el equipo**. El link del General va al closer, que se lo pasa al cliente (ver "WhatsApp seguro") | COORDINACION confirma que quedó bien (si el bot no vio entrar al cliente) |
| 6 | Bienvenida | Mensaje oficial de CUENTA_QA en el grupo General con el video de Skool adjunto; bienvenido/a/os según el nombre; avisa que la invitación a Skool llega al correo del #ALTA (con socios, a los correos de todos) (ver "Mensaje de bienvenida oficial") | — (el texto es fijo). Si la bienvenida trae avisos (socios con teléfono pero sin nombre, socios sin correo, un correo repetido, nombre sin género claro, falta el nombre o el correo): revisar en Verificaciones C.J |
| 7 | Skool | Aviso en Verificaciones C.J con los correos del #ALTA (el del cliente y los de sus socios); COORDINACION los invita por correo desde Skool (Configuración → Invitar): acceso instantáneo, sin solicitud (ver "Skool: invitación por correo") | COORDINACION envía la invitación |
| 8 | Checklist de saludos | En la ficha del Despacho: COORDINACION, COORDINACION, CSM, RESPONSABLE_HUB y el closer | Cada uno tilda |
| 9 | Contrato (fase 1b) | PandaDoc: borrador desde la plantilla (normal o con GARANTÍA) con los datos del #ALTA. Nunca se envía solo (ver "Contrato en PandaDoc") | El closer revisa el borrador, completa o confirma lo que falte y confirma el envío |

**Grupos de cada comunidad**
- **General:** COORDINACION, COORDINACION, RESPONSABLE_HUB, Capital Jurídico y el closer. El cliente (y los socios) entran por el link de invitación: el bot ya no los suma (ver "WhatsApp seguro").
- **Ventas:** los de General más ADS y CUENTA_QA Girándola.
- **Contenido:** los de General más CUENTA_QA Gamarra.

**Aprobaciones:** el bot publica un resumen en el grupo del equipo que corresponda. Se aprueba respondiendo (citando el mensaje) "OK", y se rechaza con "NO" seguido del motivo.

## WhatsApp seguro (26/10/2026)

El 26/10/2026 WhatsApp **suspendió** el número del bot (Whapi, canal DAREDL-UHNK8) a las pocas horas de prender la capacidad `comunidad`, que sumaba al cliente directo a sus grupos desde un número recién conectado. RESPONSABLE_HUB: "esto no puede pasar". Desde ahora:

- **Comunidad en modo seguro (por defecto, sin variable).** El bot arma la comunidad y los 3 grupos **solo con el equipo** (y el closer en General). Al cliente y a los socios no los suma, no los verifica (`POST /contacts`) ni los agenda. Saca el link de invitación del General (`GET /groups/{id}/invite`) y se lo manda al closer en Ventas C.J., citando su #ALTA: `Pasale este link a CUENTA_QA para que entre a su grupo: <URL_CONFIGURADA_PRIVADAMENTE>`.
- **Bienvenida cuando el cliente entra.** El webhook de Whapi avisa quién entra a un grupo (`groups_participants`, evento `groups.patch`, que hay que sumar con `scripts/bot-whapi-configurar.mjs`). Si entra al General alguien que no es del equipo, la espera de COORDINACION se resuelve sola y sale la bienvenida. Si ese evento no llega, COORDINACION responde OK cuando lo ve adentro (o la manda a mano), como antes.
- **El modo viejo** (sumar al cliente directo) queda detrás de `BOT_COMUNIDAD_AGREGAR_DIRECTO=si`. Está apagado y no conviene prenderlo.
- **Tope:** `BOT_ALTA_MAX_COMUNIDADES_DIA` (en Vercel vale 2) comunidades en 24 h. La que se pasa queda en `reintento` hasta que se libera el cupo al día siguiente, nunca fallada. El chequeo y la creación van bajo el candado `comunidad_cupo`.
- **Ritmo:** entre crear la comunidad y cada grupo pasan de 20 a 40 s al azar. Si la pausa no entra en la invocación, sigue en otra y la respeta.
- **Guardia de salud para TODO envío por Whapi** (`lib/bot/whapi/salud.ts`): altas, comunidad, bienvenida, Guiones, Grabación (e01), Anuncios, Éxito y Bajas. Antes de cada pedido que no sea un GET mira `GET /health` (con caché de 60 s). Si no está en `AUTH` (code 4), dice "banned", o un pedido de Whapi devuelve 401, **no sale nada**. Un 403 obliga a mirar `/health` en el acto. El paso queda en reintento con el motivo "número del bot desconectado o suspendido" y retoma solo cuando vuelve a `AUTH`. También frena cuando el webhook avisa que la sesión se cayó (`users.delete`, `channel` con QR o ERROR).
- **Aviso único a Discord** en #alertas-dashboard (`DISCORD_WEBHOOK_URL`), mencionando a RESPONSABLE_HUB (`DISCORD_ID_TOMAS`, o su id de siempre). Sale como mucho uno cada 6 h, con el candado `whapi_salud_aviso` en `cj_altas_recursos` para que no avise cada instancia. Si `/health` no responde, no sale nada pero tampoco se avisa.
- Tests: `scripts/test-whatsapp-seguro.mjs` (guardia, otros bots, webhook) y el bloque "WhatsApp seguro" de `scripts/test-bot-orquestador.mjs`. Todo se probó con fakes, sin Whapi real.

## Altas desde el Despacho (26/10/2026)

Con el número del bot suspendido, el alta funciona **sin WhatsApp** desde **Despacho → Clientes → «Cargar alta»** (`/clientes/altas`). Todo en una pantalla:
- **Cargar:** se pega el alta tal cual la mandó el closer (`#ALTA` o formato libre), se elige el closer (CUENTA_QA, CUENTA_QA, OPERADOR_AUTORIZADO, CUENTA_QA o CUENTA_QA; un closer con sesión carga solo a su nombre) y se suben 1 o más comprobantes (imagen o PDF, hasta 4 MB cada uno y 4,4 MB entre todos). **Vista previa** muestra qué entendió el bot sin escribir nada (el motor en seco, como `{ simular }`). **Cargar alta** arma el mismo `EventoAlta` que el webhook de Whapi (origen `despacho`, id único `despacho-<uuid>`, mismo parseo y mismas reglas de Fee, cliente existente y primera cuota) y el motor lo procesa en segundo plano.
- **Comprobantes:** se guardan en Neon (`cj_altas_archivos`, se crea sola). El motor los lee con el mismo `descargarMedio`, envuelto (`lib/bot/alta/despacho/archivos.ts`): un id `despacho-arch-…` nunca va a Whapi.
- **Altas abiertas:** cada pedido muestra el mismo texto de Verificaciones C.J (o el pedido al closer) con botones: OK, NO con motivo, `OK RESPONSABLE_HUB / OK OPERADOR_AUTORIZADO / OK Empresa` (cuenta), `OK 1450` (MEP), `OK <fuente>` y `OK Nombre Apellido`. Usan el mismo camino que `POST /api/bot/alta/motor { alta_id, responder: { espera_id, texto, por } }`, a nombre de quien responde (`manual:COORDINACION`). Los datos del closer se completan con un formulario ("DNI: 1"), con el comprobante si lo pide. "Reintentar ahora" despierta el alta (con el WhatsApp caído no llegan webhooks y no hay cron).
- **Quién:** cargan los closers (rol `closer`, ven y completan **solo sus** altas, no aprueban) y los aprobadores. **Aprueban solo RESPONSABLE_HUB, CSM, COORDINACION y COORDINACION**, por el mail de su sesión: `EDICION_REVISOR_TOMAS` / `KICKOFF_REVISOR_TOMI`, `KICKOFF_REVISOR_GERO_M`, `EDICION_REVISOR_AYLU` y **`BOT_ALTA_APROBADORES_EMAIL`** (lista de mails; CSM no tiene otra variable). La pantalla avisa a quién le falta el mail.
- **Canal:** `BOT_ALTA_CANAL=despacho|whatsapp|ambos`. Sin la variable: `despacho` si la guardia de salud ya sabe que el número está caído, `ambos` si no. Con `despacho` no sale nada a Ventas ni a Verificaciones. Cuando un pedido no sale por WhatsApp (canal Despacho, o la guardia lo frenó en `ambos`), sale **un aviso por espera a Discord** en #✅-verificaciones (`DISCORD_WEBHOOK_VERIFICACIONES`; si falta, `DISCORD_WEBHOOK_URL`), mencionando a los cuatro aprobadores (fijos en `lib/bot/alta/despacho/aviso.ts`; `BOT_ALTA_APROBADORES_DISCORD` los reemplaza) con qué falta y el link `/clientes/altas?alta=<id>#espera-<id>`. Los "falta un dato" también van ahí: el equipo se lo consulta al closer. Con `whatsapp` no hay avisos por pedido.
- **A mano:** con el número caído, la comunidad, la bienvenida y el aviso de Skool quedan en reintento (con el canal Despacho, Skool también). La pantalla los muestra como "A mano: crear grupos / bienvenida / Skool" (con los nombres de los grupos, el texto de la bienvenida y los correos para Skool) y el botón **«Hecho a mano»** (solo aprobadores) deja el paso `hecho` con quién y cuándo; el alta sigue y queda `lista`.
- **Acceso:** sección nueva `altas` («Cargar alta», pestaña de Clientes): la tienen el socio y el closer; a los demás aprobadores (si no son administradores) hay que dársela en Configuración. Los cambios de `lib/auth/*`, el hub y sus tests van aparte (`COMPARTIDOS.diff`); sin ellos la pantalla queda bajo la Cartera (`/clientes/*`).
- Código: `lib/bot/alta/despacho/*`, `app/(shell)/clientes/altas/*`, `app/api/clientes/altas/route.ts`; en el motor, `canal`, `avisarEspera` y `hechoAMano` (orquestador) y `depsServidor`. Tests: `scripts/test-bot-alta-despacho.mjs`. Sin red ni base: no se probó con Neon ni Discord de verdad.
- Abierto: los archivos de `cj_altas_archivos` no se purgan solos; un mismo id de espera ("validar-1") repetido entre altas solo se marca en la que pide el link.

## Riesgos conocidos

- **Docs creados por la cuenta de servicio:** las cuentas de servicio no tienen cuota de Drive, así que crear un Google Doc en la carpeta de RESPONSABLE_HUB puede fallar con `storageQuotaExceeded`. Las carpetas sí se pueden crear. Opciones: un Apps Script publicado como RESPONSABLE_HUB, u OAuth de CUENTA_GOOGLE_OPERADORA_CONFIGURADA.
- **Whapi no es oficial:** hay riesgo de bloqueo, y **pasó el 26/10/2026** (ver "WhatsApp seguro"). Se usa un chip nuevo con el "calentamiento" del número activado. El volumen es bajo (unos pocos clientes por semana) y WhatsApp corta en unos 30 grupos por día.
- **Clave de Claude:** el bot la lee como `BOT_ANTHROPIC_API_KEY` y, si no está, como `ANTHROPIC_API_KEY` (la de `.env.local`). Según docs/BOT-KICKOFF-CJ.md, `BOT_ANTHROPIC_API_KEY` ya está en Vercel. `ANTHROPIC_API_KEY` todavía no está en Vercel, y `/api/fathom-anuncios` la necesita con ese nombre. Sin clave, o si Claude no responde en 8 s, la dirección del contrato se separa solo con reglas y lo dudoso queda como "Confirmar ciudad y provincia" para el closer (ver "Contrato en PandaDoc").
- **Este repo lo maneja la sesión DASHBOARD PWA VERCEL:** los deploys se coordinan con esa sesión. El código nuevo va en archivos propios (`lib/bot/`, `app/api/bot/`).

## Lo que tiene que conseguir RESPONSABLE_HUB

1. Un chip nuevo con WhatsApp Business (foto con el logo de C.J y nombre "Capital Jurídico").
2. Una cuenta en whapi.cloud, escanear el QR con el chip y pegar el token en `.env.local` como `WHAPI_TOKEN`. El sandbox gratis alcanza **solo** para la prueba a mano (orden de trabajo 1): según la página de precios de whapi.cloud tiene tope de 5 conversaciones por mes (un grupo cuenta como una), 150 mensajes por día y 1.000 pedidos a la API por mes. Antes del ensayo hay que contratar un plan pago para el canal (ver el checklist): con Ventas y Verificaciones ya son 2 conversaciones, y la primera comunidad (comunidad, General y 3 grupos) pasa el tope.
3. Sumar el número del bot a "Ventas C.J.", Verificaciones C.J y a CSM, OPERACIONES, ADS, COPYWRITING y EDICIÓN.
4. `ANTHROPIC_API_KEY` en `.env.local` y en Vercel.
5. La foto para los grupos de los clientes.
6. Más adelante: la API key de Fathom (para las llamadas de los closers) y la API key de **producción** de PandaDoc como `PANDADOC_API_KEY` (`.env.local` y Vercel). Hoy solo está la de sandbox (ver "Contrato en PandaDoc").
7. La plantilla de guiones: una copia vacía de un "Guiones - X" llamada "Plantilla Guiones - C.J", guardada fuera de Clientes. Su id va en la variable `PLANTILLA_GUIONES_ID` (ver "Carpeta de Drive del cliente").
8. ~~Al publicar la versión nueva del Puente Drive: cargar la propiedad `SECRETO` en el proyecto de Apps Script~~ HECHO 24/10/2026 (versión 3 publicada, ver "Puente Drive").

## Orden de trabajo

1. **Prueba de Whapi**, hecha a mano con el sandbox: crear una comunidad y 3 grupos con 2 números de prueba, poner la foto y después borrar todo.
2. Parser de `#ALTA` con tests, armados con los 4 ejemplos reales del 19 al 21/10.
3. Webhook, tabla `cj_altas` y pasos 1 a 3, primero en modo simulación con reporte en Verificaciones C.J y después escribiendo de verdad.
4. Pasos 4 a 7.
5. Pantalla "Altas" en el Despacho, con el estado de cada paso y la checklist de saludos.

## Decisiones de RESPONSABLE_HUB para Finanzas (24/10/2026)

Pestaña "Registro de Pagos" de "SKWD | Finanzas 2026". Cada pago entra como fila nueva en la fila 2, igual que con el "Formulario de Pagos" de COORDINACION.

Copia en la app de Finanzas (1/11/2026, pedido de Tomás): con la fila ya verificada, `lib/finanzasSkwd/pagoApp.ts` guarda el mismo pago en `finanzas.pagos` (Neon) y su «quién recibió» (Tomi, Gero, Empresa o Financiera; la Financiera incluye Ágil Pagos / Diaz Rangel Rosanthony). No duplica: si ya está el mismo cliente, fecha y monto, no carga otro. Si la copia falla, el pago queda en la planilla y el aviso pide cargarlo a mano en Finanzas → Pagos.

- **Programa (col B):** el closer no lo escribe; el bot lo deduce del tipo de pago y el total.
  - DFY = Done For You (agencia). DFY+R = renovación (no es un alta nueva).
  - PP = Payment Plan (en cuotas), PIF = pago completo.
  - Ejemplo: "Tipo de pago: PP 3300 USD" → `DFY | PP | $3300`.
- **Setter y Fuente (H y K):** ver "Setter y Fuente (RESPONSABLE_HUB, 25/10/2026)" abajo. En corto: el setter sale del `Setter:` del closer (si se traduce a la lista) o del CRM de ventas, y si no, se le pregunta al closer; la fuente la saca el bot de los UTM del lead, y si no alcanzan, de lo que dijo el closer o de un OK en Verificaciones C.J.
- **Concepto (J):**
  - PIF → "PIF".
  - En cuotas, el primer pago → "1ra Cuota".
  - **"Fee"** = una seña que no completa la primera cuota (200, 300, menos de USD 500).
  - **Con menos de USD 500 el alta no arranca:** se registra el Fee y se avisa en Verificaciones C.J.
  - El servicio empieza cuando el pago llega a USD 500 o más.
- **Cuenta que recibió (R) — 3 opciones (RESPONSABLE_HUB, 24/10): RESPONSABLE_HUB · OPERADOR_AUTORIZADO · Empresa.** Se deduce del destinatario del comprobante.
  - "RESPONSABLE_HUB RESPONSABLE_HUB", en cualquier banco o billetera (Santander, Galicia, Mercado Pago…) → **RESPONSABLE_HUB**.
  - CSM, en cualquier lado → **OPERADOR_AUTORIZADO**. Cripto → **OPERADOR_AUTORIZADO** (los recibe él).
  - **Empresa:** Stripe, dLocal Go, PayPal, Relay y la Financiera (Asociación Mutual de Escribanos, o algo parecido a "Tecnos Ross": reconocerlo con variantes, ej. tecno/tecnos + ross/cross).
  - Si no está claro → pregunta en Verificaciones C.J.
- **Pagos en pesos:**
  - Pesos ARS (F) = el monto real en pesos del comprobante.
  - Efectivo Recaudado en USD (E) = pesos ÷ **dólar MEP (venta) del día anterior** al pago. Se usa el histórico de argentinadatos (casa "bolsa"); si ese día no hay cotización (fin de semana o feriado), la última anterior.
  - Un monto en pesos escrito en "Este pago" (ARS, pesos, Mercado Pago o "$" con más de 6 cifras) nunca va a E como USD.
  - En el código: `usdDesdePesos` y `fechaDiaAnterior` (puras, `lib/bot/alta/finanzas.ts`); el servidor busca la cotización con `lib/bot/alta/mep.ts`. El simulador no sale a internet: ahí el MEP queda pendiente.
- **Fecha (col A):** se escribe el serial de Sheets (días desde 1899-12-30), no un texto; la vista previa muestra además dd/mm/aaaa.
- **Lista desplegable de la columna R:** sumar "Empresa". "Relay", "Financiera" y "Otra" quedan para las filas viejas. El tablero de Finanzas ya cuenta "Empresa" como plata de la empresa (fuera del reparto); lo único que se reparte es RESPONSABLE_HUB y OPERADOR_AUTORIZADO.

### Cómo aplica el bot esas reglas (revisión del 24/10/2026, a confirmar con RESPONSABLE_HUB)

- **Monto en pesos sin decirlo:** además del "$" con más de 6 cifras, un monto sin "USD" de más de USD 10.000 en "Este pago" se toma como pesos, porque ningún programa cuesta tanto. Un Fee en pesos tiene 6 cifras (ej. $465.000). Se avisa para confirmarlo con el comprobante.
- **Pago en pesos sin el USD todavía** (falta el MEP del día anterior): el alta espera igual que con un Fee, porque puede serlo. Es el estado `falta_usd`; solo se valida el pago.
- **"Este pago":** el monto es el que está pegado a la moneda ("1ra cuota 1100 USD" → 1100). Los ordinales, el número de cuota y las fechas no cuentan como monto.
- **Cuenta OPERADOR_AUTORIZADO:** se pide "Actis", porque en el equipo hay otro OPERADOR_AUTORIZADO (Mozzi). Si dice solo "CUENTA_QA", se pregunta.
- **Cuenta Financiera:** se reconoce por "asociación mutual", "mutual de escribanos", "financiera" o "Tecnos Ross" y sus variantes. No alcanza con "escribano" suelto, porque los clientes son escribanos.
- **Cuenta deducida del medio de pago del #ALTA** (no del comprobante): se escribe en R, con un aviso para confirmarla.
- **DFY+R en un #ALTA:** el parser avisa y el alta queda esperando el OK de RESPONSABLE_HUB o OPERADOR_AUTORIZADO. No se crean CRM, Drive ni comunidad nuevos.

## Setter y Fuente (RESPONSABLE_HUB, 25/10/2026)

**Respuestas de RESPONSABLE_HUB a las dudas (25/10):**
- Outbound ya no se hace: no se mide.
- El closer nunca escribe la fuente: la deciden siempre los UTM.
- Setter con `utm_source` "ig" o "fb" → "RESPONSABLE_HUB / OPERADOR_AUTORIZADO".
- Un enrutamiento con setter "mai" → "ENRU / Mai" (son los enrutamientos perdidos que recupera Mai).

Está en `setterDeUtm` (`lib/bot/alta/setterFuente.ts`).

Motivo: en la prueba en seco del 25/10 el closer puso "Setter: Maite" y "Fuente: Anuncio" en el `#ALTA` y el bot igual le pidió los dos (solo leía esas líneas en las respuestas, no en el `#ALTA`). Código: `lib/bot/alta/setterFuente.ts` (reglas puras) y el paso 5 de `pasoValidar` (`lib/bot/alta/motor/pasos.ts`).

**Setter (col H).** Orden: (1) el `Setter:` del `#ALTA` o de una respuesta del closer, si `setterAOpcion` lo traduce ("Mai", "Maite" → `Mai`; "ENRU…" → `ENRU / Mai`; "RESPONSABLE_HUB", "RESPONSABLE_HUB", "OPERADOR_AUTORIZADO" → `RESPONSABLE_HUB / OPERADOR_AUTORIZADO`); (2) la columna K del CRM de ventas (utm_source: "mai" → `Mai`); (3) si no, se le pregunta al closer. Lo que no se traduce ("Pepe", "Luli") no se escribe: se avisa una vez y se le sigue preguntando.

**Fuente (col K).** La identifica el bot con los 3 UTM del lead, nunca el closer:
1. **UTM del CRM de ventas.** Se busca al lead por teléfono (últimos 8 dígitos) y, si no aparece, por el correo del `#ALTA`; de varias filas, la más reciente con UTM.
2. **Respaldo: lo que dijo el closer** en `Fuente:` (en el `#ALTA` o en una respuesta), solo si los UTM no alcanzan o no hay. Se traduce con `fuenteAOpcion` (nombre de la lista o sinónimo: "anuncio" → `VSL Funnel`, "instagram" → `Inbound IG`, "bio"/"web" → `BIO Página Web`, "referido" → `Referido`, "tiktok" → `Inbound Tiktok`…). Si menciona dos fuentes ("anuncio de IG") o ninguna, no se usa.
3. **Si no hay forma de saberla, se pregunta en Verificaciones C.J** (no al closer), en la misma ronda que la cuenta, con el motivo y lo que dijo el closer: `OK VSL Funnel`, `OK Inbound IG`… Un `OK` solo no alcanza.

Una fuente de los UTM o de un OK no se pisa con lo que diga el closer después. Si una corrección cambia el teléfono, lo que vino del CRM se suelta y se vuelve a buscar. En seco no se lee el CRM: se usa el respaldo del closer, o queda anotado que se preguntaría en Verificaciones.

**Dónde están los UTM.** El escenario de Make 5924157 ("Calendly CRM - Nuevo flujo con Enrutamiento por Calificación") copia el `tracking` del invitee de Calendly a la fila que agrega en la pestaña del closer (planilla Ventas). Según el blueprint, comprobado contra la API de Calendly el 25/10, los encabezados engañan:

| Columna del CRM de ventas | Encabezado | Es |
|---|---|---|
| G | Fuente | `utm_medium` |
| H | Campaña | `utm_campaign` |
| I | Video | `utm_content` (nombre del anuncio) |
| K | Setter | `utm_source` |

Antes del 25/10, el bot copiaba la columna G ("paid_social") tal cual en la K de Finanzas. El invitee de Calendly (`CALENDLY_VENTAS_TOKEN`, `scheduled_events?invitee_email=`) tiene los mismos UTM: queda como alternativa si algún día hace falta buscar a un lead que no está en el CRM.

**Regla UTM → Fuente** (`fuenteDeUtm`). Sale de cruzar la columna Fuente de "Registro de Pagos" con los UTM de los mismos leads en el CRM de ventas (por teléfono: 123 clientes con UTM):

| utm_medium | utm_campaign | Fuente | Casos históricos |
|---|---|---|---|
| `paid_social` o `paid` | cualquiera (VSL Funnel, Retargeting, id de Meta, Uruguay) | VSL Funnel | 51 de 55 |
| `inbound` | `ig` (source `mai`) | Inbound IG | 35 de 35 |
| `ig` | `inbound` | Inbound IG | 10 de 11 |
| `ig` | contiene `vsl` (link de la BIO) | BIO Página Web | 15 de 16 |
| `enrutamiento` | `wsp` | Enrutamiento | 5 de 5 |
| `refe` | cualquiera | Referido | 1 de 1 |
| `webinar` | `zoom` | Webinar | ninguno cruzado (va por el nombre) |
| `ig` con otra campaña, `social`, `mai`, vacío u otro | — | sin regla: respaldo del closer o Verificaciones | — |

`Outbound` e `Inbound Tiktok` no tienen UTM propio: nunca salen de la regla. Los parámetros de Meta sin reemplazar (`{{campaign.name}}`, `{{site_source_name}}`) cuentan como vacíos.

**Preguntas abiertas para RESPONSABLE_HUB:**
- **Outbound:** 7 pagos de Finanzas son "Outbound" (2 clientes) y ningún UTM lo marca: uno tenía UTM de anuncio (`paid_social`/`VSL`) y el otro, con 6 pagos, no está en el CRM de ventas. Con la regla, un lead que vino de un anuncio y se trabajó por outbound queda como `VSL Funnel`. ¿Outbound se identifica de otra forma (por ejemplo, una campaña o un source propio) o lo marca el closer y eso manda?
- **`ig` + `vsl` = BIO Página Web y `ig` + `inbound` = Inbound IG:** salen de los datos (15/16 y 10/11), pero ¿es así como están armados los links (BIO → VSL con utm_medium=ig)?
- **Webinar:** no hay ningún pago cruzado con `utm_medium=webinar`; se mapea por el nombre.
- **Respaldo "Anuncio" → VSL Funnel:** el closer escribió "Anuncio", que no está en la lista. Se traduce a `VSL Funnel` porque el 93 % de los leads de anuncios (51 de 55) se cargó así. ¿Está bien?
- **Setter del CRM de ventas `ig`/`fb`:** en Finanzas quedaron como `RESPONSABLE_HUB / OPERADOR_AUTORIZADO` 109 de 115 veces, y `mai` como `Mai` (o `ENRU / Mai`) 97 de 98. Hoy `ig`/`fb` no se traducen y se le pregunta al closer. ¿Se traducen a `RESPONSABLE_HUB / OPERADOR_AUTORIZADO`?
- **ENRU / Mai:** ¿se puede deducir de `utm_medium=enrutamiento` + `utm_source=mai`? Hoy no se deduce.

## Fotos de la comunidad y los grupos (24/10/2026)

Las hizo la sesión VISUAL MOTION: dibujo en negro tinta sobre el oro del logo, cuadrado de 640 × 640 (WhatsApp recorta en círculo).

| Dónde | Archivo en el Despacho | Dibujo |
|---|---|---|
| Comunidad | `public/bot/foto-grupo-cj-640.jpg` | Logo (escudo) |
| General | `public/bot/grupo-general.jpg` | Engranaje |
| Ventas | `public/bot/grupo-ventas.jpg` | Bolsas de compras |
| Contenido | `public/bot/grupo-contenido.jpg` | Cámara de cine |

Originales y versiones PNG/SVG en `<DIRECTORIO_PRIVADO_DE_MARCA>`. Al crear cada grupo, el bot pone la foto con el endpoint de imagen de grupo de Whapi.

## Skool: invitación por correo (RESPONSABLE_HUB, 24/10/2026)

Decisión de RESPONSABLE_HUB del 24/10: Skool deja de ser "el cliente pide acceso y COORDINACION lo acepta". Ahora **COORDINACION invita al cliente por correo** desde Skool: **Configuración → Invitar → "Invitar a personas por correo electrónico"**, que da acceso instantáneo, sin solicitud.
- El bot avisa en **Verificaciones C.J**: "{Nombre completo} ya pagó. Invitalo a Skool: Configuración → Invitar → correo: {correo}". COORDINACION pega el correo y toca **"Enviar invitación"**.
- Si el #ALTA no trae correo, el aviso es: "{Nombre completo} ya pagó, pero el #ALTA no trae correo: pedíselo al closer antes de invitarlo a Skool."
- **Con socios** (RESPONSABLE_HUB, 24/10/2026: también entran a Skool), el aviso trae los correos de todos y sigue diciendo "Invitalo" (decisión de RESPONSABLE_HUB):
  - "CUENTA_QA CUENTA_QA ya pagó. Invitalo a Skool con su socia Ana Gómez: Configuración → Invitar → correos: juan@…, ana@…";
  - con dos o más: "… con sus socios Ana Gómez y CUENTA_QA CUENTA_QA: Configuración → Invitar → correos: juan@…, ana@…, pedro@…";
  - si a un socio le falta el correo (solo puede pasar en la vista previa, porque el alta espera ese dato): "… Falta el correo de CUENTA_QA CUENTA_QA: pedíselo al closer.";
  - sin el correo del cliente: "{Nombre completo} ya pagó, pero el #ALTA no trae su correo: pedíselo al closer antes de invitarlo a Skool. Correos de sus socios: …".
- En la bienvenida, el bot le avisa al cliente que le va a llegar la invitación a su correo (con socios, a los correos de todos; ver "Mensaje de bienvenida oficial"). El link de la comunidad sigue en el mensaje.
- La invita COORDINACION a mano: la invitación automática desde el bot sigue descartada (exige el plan Pro).
- Ya no hace falta la pregunta de ingreso que se había propuesto para saber a quién aprobar: no hay solicitud.
- El escenario de Make 6761182 ("Bot C.J. · Invitar cliente a Skool", webhook 2977651) quedó creado pero apagado y no se usa. Se puede borrar si RESPONSABLE_HUB confirma.

## Video de bienvenida (24/10/2026)

- Video actual de cómo usar Skool (3:17): ${AUTH_BASE_URL}/v/<ID_PRIVADO_CONFIGURADO>.mp4. Es el que manda COORDINACION, comprimido a 8 MB para WhatsApp; el original está en Downloads ("WhatsApp Video 2026-10-22 at 20.19.03.mp4").
- RESPONSABLE_HUB va a grabar uno nuevo. Cuando llegue, se reemplaza esta URL.
- Resumen del contenido: registrarse en Skool, pedir acceso con el link que se manda por WhatsApp, Classroom → onboarding (WhatsApp, Drive, activos), paso 3: conectar las cuentas de Facebook para el administrador de anuncios y agendar la llamada de kickoff, marcar las clases como completadas.
- Desde el 24/10 Skool va por invitación por correo (ver "Skool: invitación por correo"): el paso "pedir acceso con el link" del video actual ya no corresponde. El video nuevo tendría que mostrar cómo entrar con la invitación que llega al correo.

## Puente Drive (instalado el 24/10/2026)

- Apps Script "Puente Drive · Despacho", cuenta CUENTA_GOOGLE_OPERADORA_CONFIGURADA. Es una aplicación web en .env.local: `PUENTE_DRIVE_URL` y `PUENTE_DRIVE_SECRETO`. Código en `integrations/apps-script/Codigo.gs`.
- **El secreto ya no está en el `.gs`** (desde la versión `2026-10-24b`): el puente lo lee de las propiedades del proyecto de Apps Script (`SECRETO`). Así una copia o una captura del archivo no lo expone. Sin esa propiedad el puente rechaza todo ("no autorizado"). Ver "Actualizar la implementación del puente".
- **Publicado: versión 3 de la implementación (24/10/2026, 15:51), código `2026-10-24b`**, con la propiedad `SECRETO` cargada. Misma URL de siempre.
  - Prueba real del paso Drive OK ese mismo día: creó "PRUEBA BOT - borrar - C.J" con Crudos, Editados, "Guiones - X" copiado de la plantilla oficial y el doc de bienvenida; reintento sin duplicar, freno de homónimos y limpieza a la papelera verificados con la cuenta de servicio.
  - **Falta publicar la versión `2026-10-25a`** (acción `agregarTanda`, para Guiones). Ya está en `Codigo.gs` (respaldo de la anterior en `Codigo.gs.antes-2026-10-25`, en la misma carpeta). La publica CONSULTOR desde el Chrome local de RESPONSABLE_HUB, con los pasos de "Actualizar la implementación del puente". No pide permisos nuevos ni cambia la URL. Mientras no se publique, el puente responde "acción desconocida: agregarTanda" y Guiones deja el envío de la tanda como pendiente.
  - **Trampa:** apenas se publica, Google tarda unos segundos en servir la versión nueva en todas las llamadas. En la prueba, el primer `ping` vino de la versión vieja (sin `version`) y las llamadas siguientes de la nueva. Si el sondeo dice "sin versión" justo después de publicar, esperar un minuto y repetir.
- Acciones: `ping`, `subirArchivo`, `crearCarpeta`, `crearDoc`, `aPapelera`; desde el 24/10, `copiarArchivo` y `aPapeleraCarpeta`; y desde la versión `2026-10-25a`, `agregarTanda`. Todas exigen el secreto.
- `ping` devuelve la cuenta y, desde la versión `2026-10-24b`, la versión del puente (`version`).
- `crearCarpetaCliente` **se quitó** en la versión `2026-10-24b`: creaba "Guiones - X" como carpeta, y la convención es un Google Doc. La carpeta del cliente se arma con `crearCarpeta`, `copiarArchivo` y `crearDoc`.
- `copiarArchivo` `{ archivoId, carpetaId, nombre }`: hace una copia del archivo (la plantilla de guiones) en la carpeta con ese nombre. Si ya hay uno con ese nombre en la carpeta, devuelve ese (`yaExistia: true`) y no lo duplica.
  - **Solo copia archivos cuyo nombre empieza con "Plantilla"**: cualquier otro lo rechaza ("solo se copian plantillas"). Es un freno para que nunca se copie el "Guiones - X" de un cliente, con sus guiones adentro.
  - Sin `archivoId`, `carpetaId` o `nombre` responde "faltan …" antes de tocar Drive (la prueba lo usa para saber si la acción existe).
- `aPapelera` `{ id }`: **solo acepta archivos que estén en "Subidos"** (los comprobantes: el bot deshace una carga a medias) **o dentro de una carpeta "PRUEBA BOT…"**. Cualquier otro lo rechaza, por ejemplo los "Guiones - X" de los clientes.
- `aPapeleraCarpeta` `{ id }`: solo para limpiar las pruebas. Manda a la papelera la carpeta con todo lo que tiene adentro, y **solo si su nombre empieza con "PRUEBA BOT"**: cualquier otra carpeta la rechaza. Se recupera desde la papelera durante 30 días.
- `agregarTanda` `{ docId, clave, bloques }` (versión `2026-10-25a`, la usa Guiones: `lib/bot/guiones/envio.ts`, que llama al puente con su propio `fetch` y no por `puenteDrive.ts`). Agrega una tanda de guiones **al final** del Google Doc "Guiones - X" del cliente.
  - `bloques`: `[{ tipo: 'titulo' | 'subtitulo' | 'parrafo' | 'indicacion', texto }]`. Como `crearDoc`, pero sin `lista` y con `indicacion` (un párrafo en cursiva). Título = Título 1, subtítulo = Título 2.
  - **Solo escribe en docs cuyo nombre empieza con "Guiones - "** y que sean Google Docs fuera de la papelera. La plantilla ("Plantilla Guiones - C.J") y cualquier otro archivo se rechazan.
  - **Idempotente por la clave:** si el doc ya tiene `[tanda:<clave>]`, no escribe nada y responde `yaExistia: true`. Si no, escribe los bloques y al final el marcador `[tanda:<clave>]`, chico (8 pt) y gris. Guiones usa la clave `cj-guiones-<recording_id>-<tanda>`.
  - Valida todo **antes** de abrir el doc: `docId`; `clave` con letras, números y `_ . : -` (hasta 100); de 1 a 600 bloques con tipo válido y texto de hasta 5.000 caracteres. Cualquier falla responde `{ ok: false, error }` sin tocar nada.
  - Usa el candado del script (`LockService`, hasta 30 s): dos pedidos iguales a la vez (un reintento mientras el primero sigue corriendo) no escriben la tanda dos veces. Si el candado está ocupado, responde `{ ok: false, error: 'el puente está ocupado…' }`.
  - **Trampa de formato:** en Docs, un párrafo nuevo hereda el formato del último, y el último es el marcador gris de la tanda anterior. Por eso cada párrafo nuevo vuelve al color y al tamaño de su estilo, y la cursiva queda solo en las indicaciones. La negrita no se toca: la ponen los estilos de título de la plantilla.
  - Respuesta: `{ ok: true, id, url, yaExistia }` o `{ ok: false, error }`.
  - Todos los `.gs` del proyecto comparten espacio de nombres (está también `Vigia.gs`): los nombres nuevos (`agregarTanda_`, `formatoTandaLimpio_`, `PREFIJO_DOC_GUIONES`, `TANDA_*`) no repiten ninguno. Lo controlan `scripts/test-puente-drive.mjs` (corre `Codigo.gs` en `node:vm` con juguetes de DriveApp, DocumentApp y LockService) y `scripts/test-puente-vigia.mjs`.
- En la misma versión: al buscar "si ya existe" (`subirArchivo`, `crearCarpeta`, `crearDoc`, `copiarArchivo`), lo que está en la papelera ya no cuenta. Los iteradores de DriveApp también devuelven lo que está en la papelera, así que antes una carpeta borrada se podía "reutilizar" (por ejemplo, la de prueba en la segunda corrida).
- Prueba del 24/10 (todo OK; las pruebas se mandaron a la papelera):
  - sin el secreto responde "no autorizado";
  - `ping` responde como CUENTA_GOOGLE_OPERADORA_CONFIGURADA;
  - subir un archivo a DFY - SKWD/Subidos;
  - crear la carpeta del cliente en "Clientes" con Guiones / Crudos / Editados (con `crearCarpetaCliente`, que ya se quitó);
  - crear un Google Doc con título, párrafo y lista dentro de la carpeta.
- Desde Node usar `fetch` con `redirect: 'follow'`. El Python del sistema falla con el certificado SSL.
- Si el puente publicado no tiene una acción, responde "acción desconocida: …". El cliente (`lib/bot/alta/puenteDrive.ts`) lo marca con `codigo: 'accion_desconocida'` y el paso Drive lo informa como pendiente, sin frenar lo demás. Si `copiarArchivo` rechaza el archivo porque no es una plantilla, el código es `no_es_plantilla` y los guiones también quedan pendientes.

### Reintentos (24/10/2026)

**Por qué:** el 24/10 un `ping` devolvió **HTTP 500** una vez y los siguientes anduvieron. Apps Script da 500 pasajeros, y sin reintento un 500 en medio de un alta deja el paso a medias o pendiente.
- Ese 500 **no sale de `Codigo.gs`**: `doPost` atrapa cualquier error y responde `{ ok: false }` con HTTP 200. Sale de la infraestructura de Google, en uno de dos tramos: el POST a `/exec` (el script puede no haber corrido) o el GET al que lleva el 302 hacia googleusercontent (**el script ya corrió**). Por eso un 5xx es dudoso (`aplicado: null`) y no un rechazo.
- Todas las acciones son idempotentes por nombre (devuelven el existente con `yaExistia: true`), así que repetir no duplica.

**Cómo reintenta el cliente** (`lib/bot/alta/puenteDrive.ts`, `llamar()`):
- **Solo lo pasajero:** HTTP 5xx, error de red, corte por tiempo y respuesta que no es JSON.
- **Nunca un rechazo:** ni `{ ok: false }` del puente ni un HTTP 4xx (tampoco 408 ni 429).
  - Un `{ ok: false }` con un error pasajero de Drive ("Service error: Drive", "server error… try again", "Backend Error") tampoco se reintenta, pero ya no queda como `aplicado: false`: `createFolder` puede haber creado la carpeta igual, así que queda dudoso (`aplicado: null`).
  - Un 4xx que llega **después del 302** (`Response.redirected`: falló el GET a googleusercontent, con el script ya corrido) tampoco se reintenta, pero queda dudoso (`aplicado: null`), no como "seguro no se hizo". Un 4xx en el POST a `/exec` sigue siendo un rechazo (`aplicado: false`).
  - Si un intento anterior quedó dudoso, el error final queda dudoso aunque el último intento sea un rechazo. En ese caso `ErrorPuente.rechazo` es `true`: el puente respondió `{ ok: false }`, así que la acción existe (el sondeo de la prueba lo usa).
- **Hasta 3 intentos** (2 reintentos), con esperas de 3 s y 8 s más hasta 1 s al azar. Son más largas que una acción típica: así un intento anterior que siguió corriendo termina, y la búsqueda por nombre de Drive (que puede tardar unos segundos en ver lo recién creado) lo encuentra antes de que el reintento busque.
- **Un intento largo** (cortado por tiempo o de más de 25 s) solo se reintenta en `ping`, `aPapelera` y `aPapeleraCarpeta`, que no crean nada. En las demás el Apps Script puede seguir corriendo (hasta 6 min) y un segundo intento en paralelo duplicaría, porque el puente busca y crea sin bloqueo. Un corte por tiempo siempre es largo: salta a los 90 s o al llegar al plazo, y entonces no queda tiempo para otro intento. Por eso, en las acciones que crean algo, un corte no se reintenta nunca.
- **Tope por llamada (100 s):** entre todos los intentos y las esperas, una llamada termina a los 95 s como mucho, aunque no haya plazo (`TOPE_LLAMADA_MS`). Antes de los reintentos el techo era 90 s. Sin este tope, un `ping` o un `aPapelera` llegaban a 283 s y un `crearCarpeta` a 153 s. Con el tope, después de un corte de 90 s no queda lugar para otro intento, ni siquiera en `ping`.
- **Plazo:** `puenteDriveReal({ hasta })`, y `hasta` en las opciones de `prepararDriveCliente` y de `cargarPagoFinanzas`. **El webhook tiene que pasarlo** según su `maxDuration` (por ejemplo, inicio + 285 s de 300): el tope cubre cada llamada, pero no el paso entero, que hace varias. Manda lo que llegue primero, el plazo o el tope. Cada intento se corta a min(90 s, límite − 5 s). Sin 10 s libres no se llama (el error dice que seguro no se hizo) y sin 20 s no se reintenta.
- El cuerpo y la señal de corte se arman **antes** del pedido: si fallan, no sale nada (`aplicado: false`, sin reintento) y no se confunde con un error de red. El timeout se redondea para abajo, porque `AbortSignal.timeout` rechaza los ms con decimales. Una `PUENTE_DRIVE_URL` mal escrita frena al crear el cliente, sin mostrarla.
- **Costo:** si todo sale bien, ninguna llamada de más. Con un 500 se suman de 3 a 9 s y un pedido.
- Si hubo un intento dudoso antes de la respuesta buena, el resultado trae `dudoso: { desde, hasta, puedeSeguir }`. `puedeSeguir` es `true` si algún intento dudoso se cortó por tiempo o tardó más de 25 s: el Apps Script pudo seguir corriendo después. El `ErrorPuente` final también trae `dudoso` cuando no se sabe si se hizo. Los mensajes dicen cuántos intentos hubo y nunca llevan la URL ni el secreto.
- Los tests (`scripts/test-bot-drive.mjs` y `scripts/test-bot-finanzas-escribir.mjs`) usan un Apps Script de juguete detrás del `fetch` y un reloj de juguete (`esperar`, `ahora` y `senal` se inyectan). No esperan de verdad ni llaman al puente real. El de Drive respeta el corte de cada intento, como el `fetch` real.

**El freno de homónimos no salta por una carpeta del bot** (`driveCliente.ts`, `carpetaDeIntentoDudoso`):
- **La trampa:** si `crearCarpeta` creó la carpeta principal pero la respuesta se perdió, el reintento la ve con `yaExistia: true` y el freno ("ya había una carpeta en Clientes") saltaría por una carpeta que creó el propio bot. Esto ya pasaba antes entre corridas: el aviso nombraba "un intento anterior que no llegó a responder" como causa posible.
- **Regla:** si la carpeta principal vuelve con `yaExistia` y hubo un intento dudoso, se lee su `createdTime` **por id** con la cuenta de servicio (`files.get` con `drive.readonly`, como `lib/clientes/drive.ts`). Por id no tiene la demora de las búsquedas por nombre. También se controla que esté en Clientes y fuera de la papelera.
  - **Es del bot** solo si se creó dentro de la ventana de **alguna** llamada dudosa: desde 3 s antes de que saliera su primer intento hasta 6 min después de que terminó el último (lo máximo que corre un Apps Script: después de un 5xx o de un corte, el script pudo seguir y crearla un rato más tarde). Queda `creado`, con el motivo, y el paso sigue.
  - **Cada ventana se mira por separado.** Las de corridas distintas nunca se unen: entre una y otra pueden pasar horas o días, y una sola ventana "del primer intento al último" aceptaría cualquier carpeta creada en el medio. Se encontró en la revisión del 24/10, con una carpeta ajena creada entre dos corridas que fallaron.
  - **Anterior a la primera ventana:** es un homónimo real. Ese intento la encontró al buscar y no creó nada. Espera el OK como siempre, y el aviso dice la fecha de creación.
  - **Fuera de toda ventana pero posterior a la primera:** la creó otro (por ejemplo, COORDINACION a mano entre dos corridas). Espera el OK.
  - **No se puede leer** (sin cuenta de servicio, error, otra carpeta padre, en la papelera o sin fecha): espera el OK, con un aviso que dice que casi seguro la creó el bot. **Nunca se acepta sin prueba.**
- **Lo que queda:** una carpeta con ese nombre exacto que alguien cree dentro de la ventana de un intento dudoso (de 3 s antes a 6 min después) se toma como del bot. En la práctica sería COORDINACION armándola a mano para este mismo cliente.
- **Marca entre corridas:** si la carpeta principal termina sin respuesta (o sin poder confirmarse), el resultado trae `intentoCarpeta: { nombre, padreId, ventanas: [{ desde, hasta, puedeSeguir }, …] }`, una ventana por llamada dudosa (las 10 más nuevas). El webhook lo guarda en `cj_altas` junto a `guardar` y lo pasa como `opciones.intentoCarpeta` en la corrida siguiente, que suma su propia ventana y aplica la misma regla. Solo vale para la misma carpeta (nombre y carpeta padre). Una marca rota o con otra forma se ignora, y entonces el freno actúa como siempre. Vuelve en `null` cuando la duda se aclara.
- **`noReintentarAntesDe`:** si algún intento dudoso del paso se cortó por tiempo o tardó más de 25 s (`puedeSeguir`), el Apps Script pudo seguir corriendo hasta 6 min. El webhook no repite el paso antes de esa hora: correría en paralelo con él y podría duplicar. Es la misma regla que frena el reintento dentro de la llamada. `cargarPagoFinanzas` devuelve lo mismo para la subida del comprobante.
- **Posible duplicado:** si un elemento lo creó el reintento después de un intento dudoso (`dudoso` sin `yaExistia`), el paso suma un pendiente: "puede haber quedado dos veces" en Clientes o en la carpeta del cliente, con el link del que usa el bot. Pasa si el primer intento también lo había creado y la búsqueda por nombre todavía no lo veía.

**Finanzas** (`finanzasEscribir.ts`):
- Un reintento de `subirArchivo` no duplica el archivo (lo busca por nombre) ni la fila: el lote de Sheets va aparte, después, y `buscarRepetido` corre antes.
- Si el reintento encuentra el comprobante (`yaExistia` con `dudoso`), puede ser el que subió el primer intento o **uno anterior con el mismo nombre** (de otro pago o de un cliente que renueva). Sin prueba, va el aviso de siempre ("Revisar que sea el mismo comprobante"), que además lo explica. Si después Google rechaza la fila, ese archivo **no** se manda a la papelera. El motivo avisa que quedó en Subidos: si ninguna otra fila del Registro lo usa, es el del bot y se puede borrar a mano; si lo usa otra, se deja. (Leer su `createdTime`, como en Drive, depende de que la cuenta de servicio vea Subidos, y eso no está confirmado.)
- Si el reintento lo sube de nuevo (`dudoso` sin `yaExistia`), el aviso dice que puede haber quedado dos veces en Subidos, con el link del que subió el reintento. Si después se rechaza la fila, ese va a la papelera y el motivo avisa que puede quedar otra copia, la del primer intento.
- `aPapelera` (deshacer una carga) se reintenta ante lo pasajero aunque el intento haya sido largo: mandar a la papelera dos veces no hace daño.

**Lo que no se hizo:** llamar en dos tramos (`redirect: 'manual'` y reintentar solo el GET del 302, que no vuelve a correr el script). Depende de algo que Apps Script no documenta y no cubre un 500 en el POST, así que igual haría falta la regla de la fecha. Queda como mejora posible.

**Riesgos que quedan:**
- Un duplicado si el Apps Script sigue ejecutando el primer intento después de un 5xx rápido, o si la búsqueda por nombre de Drive todavía no ve lo que creó ese intento (las esperas lo achican). Adentro de la carpeta del cliente sería, por ejemplo, un "Crudos - X" repetido; en Clientes, una segunda carpeta vacía con el mismo nombre. Cuando el reintento crea algo después de un intento dudoso, se avisa (ver "Posible duplicado").
- `crearDoc_` no hace todo de una vez: crea el doc en la raíz de Mi unidad de CUENTA_GOOGLE_OPERADORA_CONFIGURADA y después lo mueve. Si se corta en el medio, queda un "Bienvenida - X" huérfano en la raíz. Sin tocar `Codigo.gs` no se arregla.
- Los cupos diarios de Apps Script no se reintentan.
- A futuro, lo más simple sería que `crearCarpeta_` devuelva `getDateCreated()` cuando la carpeta ya existía: la misma regla, sin la cuenta de servicio. Exige publicar una versión nueva del puente.

### Actualizar la implementación del puente (la URL no cambia)

El código está en `integrations/apps-script/Codigo.gs`. Claude puede hacer todo desde el Chrome local de RESPONSABLE_HUB (el de su Mac, nunca el "Compu de OPERADOR_AUTORIZADO"): pegar el código, guardar y publicar la versión nueva. **Lo único que hace RESPONSABLE_HUB es cargar o cambiar el valor de la propiedad `SECRETO`**, porque es una clave: Claude se la deja en el portapapeles (`pbcopy`, sin mostrarla) y RESPONSABLE_HUB la pega.

Trampas al pegar el código desde la Mac:
- Copiarlo con `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbcopy < Codigo.gs`. Sin eso, `pbcopy` lo toma como MacRoman y los acentos quedan rotos ("est√° cargada", "‚Üí" en vez de "está cargada", "→").
- El 24/10 la propiedad `SECRETO` ya está cargada: para una actualización común, alcanza con los pasos 3 y 5 a 9.

1. Entrar a script.google.com con la cuenta **CUENTA_GOOGLE_OPERADORA_CONFIGURADA** y abrir el proyecto "Puente Drive · Despacho".
2. **Antes de borrar el código viejo, cargar el secreto como propiedad** (la versión nueva ya no lo trae escrito):
   1. En `Código.gs`, copiar el valor que está entre comillas en la línea `var SECRETO = '…'` (es el mismo que `PUENTE_DRIVE_SECRETO` de `.env.local`). No pegarlo en ningún chat.
   2. Ir a **⚙ Configuración del proyecto** (rueda a la izquierda) → **Propiedades de la secuencia de comandos** → **Agregar propiedad de la secuencia de comandos**.
   3. Propiedad: `SECRETO`. Valor: el que se copió. **Guardar propiedades de la secuencia de comandos**.
3. Volver a `Código.gs`, seleccionar todo (Cmd+A), borrarlo y pegar el contenido entero de `integrations/apps-script/Codigo.gs`.
4. Guardar (Cmd+S). Para comprobar la propiedad: elegir la función `probar` y tocar **Ejecutar**; el registro tiene que decir "SECRETO cargado: true" (no muestra el valor).
5. **Implementar → Gestionar implementaciones**.
6. En la implementación que ya existe (la aplicación web), tocar el **lápiz** (Editar).
7. En **Versión**, elegir **Nueva versión**.
8. **Implementar**. La URL de la aplicación web sigue igual, así que no hay que tocar `.env.local` ni Vercel. No pide permisos nuevos: usa DriveApp, DocumentApp (ya la usaba `crearDoc`), PropertiesService y LockService (las propiedades y el candado del propio proyecto no piden autorización).
9. Avisarle a Claude, que corre `scripts/bot-drive-prueba-real.mjs --real` (ver "Carpeta de Drive del cliente"). La prueba sondea el puente antes de crear nada: si responde "no autorizado", falta la propiedad `SECRETO` (o quedó mal copiada).

Si se crea una implementación **nueva** en lugar de editar la existente, la URL cambia y el bot sigue llamando a la vieja.

## Mensaje de bienvenida oficial (RESPONSABLE_HUB, 24/10/2026)

Lo manda el bot en el grupo General, con el video de Skool adjunto (ver "Video de bienvenida"). `{nombre}` = el primer nombre del #ALTA y `{correo}` = el correo del #ALTA. El texto va tal cual:

```
Hola {nombre}! Cómo va? Muy bienvenido a Capital Jurídico!
Me presento: soy {FIRMA_OPERACIONES}, encargada de operaciones de la empresa. 
Estamos muy contentos de que comencemos a trabajar juntos por todos los objetivos planteados! 🙌🏽

Por acá te comparto el próximo paso, es un video explicativo de la plataforma Skool, donde vas a encontrar módulos con herramientas y videos que te van a servir durante todo el proceso. 

Cualquier duda o consulta que tengas, estamos a disposición! 
A avanzar con todo! 💪🏼

Link de la plataforma:
<URL_CONFIGURADA_PRIVADAMENTE>

Te va a llegar una invitación a tu correo ({correo}) para entrar a la plataforma.
```

Ajustes aprobados por RESPONSABLE_HUB el 24/10 ("sí, hacé todo"):
- "Muy bienvenido / bienvenida" según el nombre. Si el #ALTA trae socios, va "Hola {nombre} y {socio}! … Muy bienvenidos" y el resto en plural. Si no se puede deducir el género, queda "bienvenido".
- Última línea (Skool por invitación, RESPONSABLE_HUB 24/10; reemplaza a "Una vez que te hayas creado la cuenta y envíes la solicitud…, avisame así te acepto"):
  - con correo: "Te va a llegar una invitación a tu correo ({correo}) para entrar a la plataforma."
  - sin correo en el #ALTA: "Te va a llegar una invitación a tu correo para entrar a la plataforma."
  - con socios: "Les va a llegar una invitación a su correo ({correo}) para entrar a la plataforma." (sin correo, va sin el paréntesis).
  - con socios que traen su correo (RESPONSABLE_HUB, 24/10/2026: los socios también entran a Skool): "Les va a llegar una invitación a sus correos ({correo}, {correo del socio}, …) para entrar a la plataforma.", con el del cliente primero. Es lo único que cambia del texto. Si el cliente no tiene correo, va sin el paréntesis (los de los socios solos parecerían el suyo). Con tres socios de nombres y correos larguísimos el texto queda en unos 940 caracteres, debajo de los 1024 del pie del video (un test lo controla). Si algún día no entrara, la última línea va sin el paréntesis y el texto sigue siendo el pie; los correos siguen en el aviso de Skool.

Al mismo tiempo, el bot avisa en Verificaciones C.J: "{Nombre completo} ya pagó. Invitalo a Skool: Configuración → Invitar → correo: {correo}". Sin correo: "{Nombre completo} ya pagó, pero el #ALTA no trae correo: pedíselo al closer antes de invitarlo a Skool." Con socios, con los correos de todos (ver "Skool: invitación por correo").

## Socios con correo (RESPONSABLE_HUB, 24/10/2026)

Decisión de RESPONSABLE_HUB del 24/10: **los socios del cliente también reciben la invitación a Skool**, así que el #ALTA trae el correo de cada socio.

**Cómo lo lee el bot** (`lib/bot/alta/parsear.ts`: `leerSocios`, `esSocioSkool`, `esContinuacionSocios`):
- "Socios:" y debajo un socio por línea. Una línea sigue el bloque si trae un teléfono o un correo; con "Socios:" vacío, también un nombre solo ("Ana Gómez") o "ninguno". El bloque termina en la próxima "Clave: valor". Una línea de cuotas nunca es un socio.
- En cada línea (o pedazo entre ";") se buscan el nombre, el teléfono y el correo, en cualquier orden y separados por "·", coma o espacio. Varios socios en una línea también valen: "Ana Gómez +54 9 …, CUENTA_QA CUENTA_QA +54 9 …", "+54 9 … Ana, +54 9 … CUENTA_QA" o en columnas ("Ana y CUENTA_QA: +54 9 …, +54 9 …").
- Del nombre se sacan los títulos y las aclaraciones ("socia Dra. Ana Gómez (estudio)" → "Ana Gómez").
- `socios` guarda el texto con las líneas unidas por "; ". crm.ts y la comunidad siguen releyendo de ahí los teléfonos de los socios. Los teléfonos quedan en el orden en que aparecen, con el nombre del socio como etiqueta.
- Los dígitos de un correo nunca se leen como teléfono ("estudio2215001111@…"). Vale en todo el parser.

**Qué es un faltante y qué un aviso:**
- Socio con nombre y sin correo → faltante "Correo de cada socio (falta el de Ana Gómez)" / "(faltan los de Ana Gómez y CUENTA_QA CUENTA_QA)". El alta espera ese dato, como el correo del cliente.
- Un teléfono suelto, sin nombre ni correo (por ejemplo, el del estudio), **no es un socio para Skool**: se suma a los grupos como siempre, pero no se le pide el correo ni se lo invita. La bienvenida ya lo marcaba ("socios sin nombre"), y ahora el aviso agrega que, si es de un socio, el closer tiene que mandar su nombre y su correo. *Criterio del bot, a confirmar con RESPONSABLE_HUB.*
- Un socio sin teléfono no es faltante: se lo invita a Skool, pero no entra a los grupos. Pasaba igual antes. *A confirmar con RESPONSABLE_HUB.*
- Dos correos distintos en "Correo:" (o dos líneas "Correo:"/"Mail:") → faltante "Correo del cliente (vinieron 2: …)". Casi siempre es el correo de un socio escrito con la clave del cliente, que pisaría el del contrato y el del CRM.
- Un mismo correo para dos personas → aviso de la bienvenida: Skool da una sola cuenta por correo.
- "Teléfono y de los socios:" (formato de antes) no dice cuáles son socios: no se pide ningún correo de más. A esos socios no los invita el bot.

**Respuesta del closer** (motor, `lib/bot/alta/motor/fusion.ts`): el pedido trae el ejemplo "Socios:" + "CUENTA_QA Gómez · <EMAIL_PRIVADO_CONFIGURADO>", no el de "Correo:", que pisaría el del cliente. Lo que manda el closer en "Socios:" **se suma** a los socios del #ALTA, no los reemplaza:
- el socio que ya estaba (mismo nombre, solo el nombre de pila si no hay otro igual, mismo teléfono o mismo correo) se completa y conserva su teléfono;
- un correo solo va al único socio con nombre al que le falta, y un nombre escrito distinto ("Bea Gómez" por "Beatriz Gómez") va al único socio sin correo con el que comparte una palabra;
- un socio nuevo se agrega y "Socios: ninguno" saca a todos;
- completar es `completa`; cambiar un teléfono o un correo, agregar o sacar socios es `corrige`: si ya se escribió algo afuera, pasa por el OK de corrección.

**Tests:** `scripts/test-bot-alta.mjs` (parser y plan), `scripts/test-bot-bienvenida.mjs` (mensaje, aviso de Skool, pie de 1024) y `scripts/test-bot-orquestador.mjs` (`describe('socios con correo (24/10)')`: fusión, pedido al closer, camino feliz y seco).

## Carpeta de Drive del cliente (paso 4, 24/10/2026)

Código: `lib/bot/alta/driveCliente.ts`, con `prepararDriveCliente(a, { modo: 'real' | 'simulacion', plantillaGuionesId, guardado?, nombreConfirmado? })`. Los nombres salen de `lib/bot/alta/nombreCliente.ts`, el mismo normalizador que usa la bienvenida. Tests: `scripts/test-bot-drive.mjs`. Prueba: `scripts/bot-drive-prueba-real.mjs` (con `lib/bot/alta/drivePrueba.ts`).

**Convención real** (revisada el 24/10 en las carpetas que arma COORDINACION dentro de "Clientes", `<ID_PRIVADO_CONFIGURADO>`: CUENTA_QA CUENTA_QA, CUENTA_QA, CUENTA_QA, CUENTA_QA CUENTA_QA, Bárbara B., Marti F.):

```
Clientes / CUENTA_QA CUENTA_QA - C.J
  ├─ Guiones - ClaudiaR      (Google Doc, copia de la plantilla: TANDA 1°, 2° y 3°, cinco "Video: No iniciado" por tanda)
  ├─ Crudos - ClaudiaR       (carpeta)
  ├─ Editados - ClaudiaR     (carpeta)
  └─ Bienvenida - CUENTA_QA CUENTA_QA   (Google Doc del bot, con los bloques de armarBienvenida)
```

**Cómo arma los nombres el bot** (funciones puras con tests, en `nombreCliente.ts`):
- **Carpeta:** el nombre completo del #ALTA + " - C.J", sin título adelante y con mayúscula inicial si vino todo en mayúsculas o todo en minúsculas. "Ma." pasa a "CUENTA_QA". COORDINACION a veces lo acorta ("CUENTA_QA" → "CUENTA_QA CUENTA_QA - C.J"); el cruce carpeta ↔ cliente de `/clientes` acepta las dos formas.
- **Títulos que se sacan:** abreviados o enteros, con o sin punto, también pegados al nombre: Dr./Dra., Doctor/a, Lic., Licenciado/a, Ab./Abg./Abog., Abogado/a, Esc./Escr., Escribano/a, Cr./Cra., Cdor./Cdora., Ctdor./Ctdora., Contador/a. "Escribana CUENTA_QA CUENTA_QA" → "CUENTA_QA CUENTA_QA - C.J" y "Guiones - Z001"; "Dra.Lucía Benítez" → "Lucía Benítez - C.J" y "Guiones - Z001". La bienvenida usa la misma lista ("Hola CUENTA_QA!", y el título decide "bienvenida" o "bienvenido").
- **Sufijo X:** primer nombre + inicial de la **última** palabra. "CUENTA_QA" → "ClaudiaR" (igual que la carpeta real), "CUENTA_QA de la Fuente" → "JuanF", "Ma. CUENTA_QA CUENTA_QA" → "MaríaR", "CUENTA_QA" → "CUENTA_QA". Las iniciales sueltas no cuentan ("CUENTA_QA J. CUENTA_QA" → "JuanP") y los acentos se respetan ("BelénA", como COORDINACION).
- **Doc de bienvenida:** "Bienvenida - " + el mismo nombre de la carpeta (sin título). Antes la bienvenida tenía su propio normalizador: "Dra. Lucía Benítez" daba la carpeta "Lucía Benítez - C.J" con el doc "Bienvenida - Dra. Lucía Benítez", y como la idempotencia busca por nombre, un cambio en uno solo duplicaba el doc.
- **Nombre con más de una persona:** si el nombre del #ALTA trae " y ", " e ", "/", "&", "+" o paréntesis ("CUENTA_QA CUENTA_QA y Ana Gómez" daría "JuanG"; "Lucía Benítez (socia: Ana)" daría "LucíaA"), el bot **no crea nada** y avisa en Verificaciones C.J con los nombres que saldrían (`esperaOk: 'nombre_dudoso'`). El nombre que confirmen vuelve en `nombreConfirmado` y manda para la carpeta, los sufijos y la bienvenida. Un apellido con "y" ("Ortega y Gasset") también se pregunta: es raro y cuesta un OK.
- COORDINACION a veces usa solo las iniciales ("Guiones - Z001", "Guiones - Z001"). El bot usa siempre la forma larga, que es la más común.

**Qué hace en modo real:**
1. Carpeta "<Nombre> - C.J" en Clientes. Sin esa carpeta no sigue.
   - **Primera corrida** (sin ids guardados): `crearCarpeta`. Si el puente devuelve una carpeta que **ya existía** (un homónimo, una que armó COORDINACION con ese nombre exacto o un intento anterior que no llegó a responder), **no crea nada adentro**: la carpeta queda pendiente con su link y un aviso en Verificaciones C.J (`esperaOk: 'carpeta_existente'`). Con el OK, el webhook guarda ese id con `aprobarCarpetaExistente(resultado)` y reintenta; si es de otro cliente, se responde con otro nombre (`nombreConfirmado`).
   - **Intento dudoso:** si se perdió la respuesta de `crearCarpeta` (5xx, corte por tiempo), la carpeta que aparece después se acepta como del bot solo si su fecha de creación lo confirma (ver "Puente Drive" → "Reintentos"). Así un 500 no deja el alta esperando un OK por una carpeta que creó el propio bot, y un homónimo real sigue frenando.
   - **Reintentos:** trabaja con el id guardado en `cj_altas` (`guardado.carpeta`) y **no busca por nombre** en Clientes.
2. En paralelo, adentro de esa carpeta: `crearCarpeta` Crudos y Editados, `copiarArchivo` de la plantilla como "Guiones - X" y `crearDoc` "Bienvenida - <Nombre>". Lo que ya tiene id guardado no se vuelve a pedir; lo demás se busca por nombre solo adentro de la carpeta del cliente, así que no se duplica.
- **Ids en `cj_altas`:** cada corrida devuelve `resultado.guardar` (los ids y links de la carpeta y de cada elemento: los de antes más lo que creó o reutilizó). El webhook lo guarda en el registro del paso Drive y lo pasa como `guardado` en el reintento. Una carpeta que espera el OK no entra en `guardar` hasta que se apruebe. Junto a `guardar` se guarda `resultado.intentoCarpeta` (la marca de un intento dudoso de la carpeta principal, o `null`) y vuelve como `intentoCarpeta`. Si el resultado trae `noReintentarAntesDe`, el paso no se repite antes de esa hora.
- Si el puente todavía no tiene `copiarArchivo`, si no hay plantilla o si la plantilla no se llama "Plantilla…", los guiones quedan como **pendiente** (copiar la plantilla a mano) y el resto se hace igual.
- No tira excepciones: devuelve el estado de cada elemento, con ids, links, pendientes y errores.
- En simulación no llama al puente: devuelve los nombres y las llamadas que haría (no puede saber si la carpeta ya existe).
- Dos corridas simultáneas del mismo cliente podrían duplicar la carpeta, porque el puente busca y crea sin bloqueo. El webhook tiene que correr los pasos de cada alta de a uno (`cj_altas`).

**Plantilla de guiones: no hay una por defecto.** No existe un doc "Plantilla Guiones": todos los "Guiones - X" son copias del mismo modelo (pesan casi lo mismo, ~275 KB). Antes el código traía como propuesta el "Guiones - Z001" (carpeta "CUENTA_QA CUENTA_QA - C.J"), que es el doc de un cliente real: cuando tenga sus guiones, cada cliente nuevo los recibiría. Se sacó del código.
- En producción el id sale de la variable **`PLANTILLA_GUIONES_ID`** (`plantillaGuionesDesdeEntorno()`). Si no está, los guiones quedan pendientes y se avisa en Verificaciones C.J.
- Falta crearla: RESPONSABLE_HUB o COORDINACION hacen "Archivo → Hacer una copia" de un "Guiones - X" vacío (por ejemplo "Guiones - Z001", `<ID_PRIVADO_CONFIGURADO>`, mientras siga vacío), la llaman **"Plantilla Guiones - C.J"**, la guardan **fuera** de Clientes (así no aparece en `/clientes` ni en `/guiones`) y su id va en `PLANTILLA_GUIONES_ID` (`.env.local` y Vercel).
- El nombre tiene que empezar con "Plantilla": el puente no copia otros archivos.
- La cuenta CUENTA_GOOGLE_OPERADORA_CONFIGURADA tiene que poder abrir esa plantilla.

**Prueba (`scripts/bot-drive-prueba-real.mjs`, #ALTA inventado "PRUEBA BOT - borrar"):**
- `--simular`: no llama al puente; imprime los nombres y las llamadas que haría. Acepta `--plantilla=<id>`; sin plantilla muestra los guiones pendientes.
- `--real`: exige `--plantilla=<id>` (la "Plantilla Guiones - C.J") o `--sin-plantilla` (los guiones quedan pendientes). No hay plantilla por defecto.
  - **Sondeo antes de crear nada** (`sondearPuente`): `ping` (el secreto y la versión) y dos llamadas que no cambian nada: `copiarArchivo` sin nombre y `aPapeleraCarpeta` con un id que no existe. La versión nueva responde un error del puente; la vieja, "acción desconocida". Si falta alguna de las dos acciones, aborta sin crear nada (si no, la carpeta de prueba quedaría en Clientes con Crudos y Editados adentro, a la vista de COORDINACION, `/clientes` y `/guiones`).
  - Después crea todo en Clientes ("PRUEBA BOT - borrar - C.J"), verifica y **siempre** manda a la papelera lo creado.
  - Verificación (`verificarPruebaDrive`): (1) un reintento con los ids guardados devuelve los mismos ids con `existia` y no busca la carpeta en Clientes; (2) una primera corrida sin ids encuentra la carpeta y queda esperando el OK, sin crear nada adentro (el freno de homónimos); (3) la cuenta de servicio (solo lectura) ve una sola carpeta en Clientes y cada elemento adentro, sin duplicados.
  - Limpieza (`limpiarPruebaDrive`): manda a la papelera solo los docs que la cuenta de servicio ve **adentro** de la carpeta de prueba (`aPapelera`) y después la carpeta con todo lo de adentro (`aPapeleraCarpeta`). Si hay más de una carpeta de prueba, van todas. Un paso que falla no frena los otros, y al final controla que Clientes ya no la tenga.
  - Si al empezar ya había una carpeta de prueba (de una corrida que no se limpió), el freno de homónimos no crea nada: la prueba la manda a la papelera y pide volver a correr.
  - `/clientes` y `/guiones` guardan Drive en caché 30 minutos: si alguien los abre durante la prueba, la carpeta puede aparecer ahí un rato.
- **Corrida real del 24/10/2026: todo OK** (puente versión 3; plantilla `PLANTILLA_GUIONES_ID`). Comando: `node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/bot-drive-prueba-real.mjs --real --plantilla="$PLANTILLA_GUIONES_ID"` (con `.env.local` cargado). Si el puente publicado no tiene `copiarArchivo` y `aPapeleraCarpeta`, el sondeo aborta y no se crea nada.

## Contrato en PandaDoc (paso 9, 24/10/2026)

Código: `lib/bot/alta/contrato.ts` (tokens, puro: lo usa también el simulador), `lib/bot/alta/pandadoc.ts` (API, solo servidor), `lib/bot/alta/direccion.ts` (separar la dirección con reglas, puro) y `lib/bot/alta/direccionClaude.ts` (Claude, solo servidor). Tests: `scripts/test-bot-contrato.mjs`, `scripts/test-bot-contrato-fallas.mjs` y `scripts/test-bot-direccion.mjs`. Prueba: `scripts/bot-contrato-sandbox.mjs`.

**Plantillas** (rol único "Client", sin monto, CUIT ni cuotas): normal `ukDkbGk63sugvEKC4GADkG` y con GARANTÍA `FFTu88hQc2eWvQkBzYHKGE` (si el #ALTA dice "Contrato: Garantía").

**El bot nunca lo envía solo.** Crea el borrador, espera a que PandaDoc lo deje en "document.draft" y avisa en Verificaciones C.J con `textoAvisoBorrador` (link, clave usada, lo que falta y los avisos de la dirección). El closer lo revisa y confirma. Recién ahí `enviarContrato` lo manda a firmar, y antes relee el documento: si le queda una variable vacía (ej. `[Client.City]`) no lo manda.

**Claves de PandaDoc** (`clavePandaDoc`):
- `PANDADOC_API_KEY` (producción): la que se usa si existe. Configurar la credencial privada y verificar el entorno antes de usarla.
- `PANDADOC_API_KEY_SANDBOX`: solo fuera de producción (local o preview, `VERCEL_ENV` distinto de `production`). En producción sin la clave de producción, el paso da error: un contrato real no se crea en la sandbox por descuido.
- `PANDADOC_USAR_SANDBOX=1`: fuerza la sandbox (aunque esté la de producción), también en producción. Es para pruebas.
- Con la clave de sandbox, `enviarContrato` se niega siempre (`ContratoEnSandbox`): esos borradores llevan marca de agua. El aviso de Verificaciones C.J lo dice bien a la vista ("⚠ Clave: SANDBOX").

**Nombre del cliente:** el mismo que usa Drive (`nombreCliente`): sin "Dr./Dra./Escribana…", con mayúscula inicial si vino todo en mayúsculas o minúsculas y "Ma." → "CUENTA_QA". "DRA. MARIA LAURA PEREZ" → FirstName "CUENTA_QA CUENTA_QA", LastName "CUENTA_QA", documento "Contrato - CUENTA_QA CUENTA_QA CUENTA_QA - C.J". Las partículas van con el apellido ("CUENTA_QA de la Fuente" → "CUENTA_QA" / "de la Fuente").

**Dirección del cliente, separada** (StreetAddress lleva solo la calle; City, State y Country van en sus tokens):
1. Reglas (`separarDireccion`): catálogo de ciudades y provincias, barrios de CABA y el código del teléfono para desempatar. Los pedazos que empiezan con una palabra de unidad o de barrio (Depto, Dpto, Piso, PB, Planta Baja, Oficina, Local, Torre, Casa, Lote, Manzana, Mz, UF, Unidad, Block, Centro, Apto, Edificio, Barrio, B°) quedan en la calle, nunca como ciudad. Una localidad que no está en el catálogo se acepta por su posición, pero con confianza baja (puede ser un barrio, como "Nueva Córdoba").
2. Con confianza baja, Claude Haiku 5.5 (`BOT_ANTHROPIC_API_KEY`), con tope de 8 s y sin reintentos. Así, sumado a los 30 s de PandaDoc, entra en una función de Vercel de 60 s. Lo que deduce Claude va como aviso ("revisarlas en el borrador").
3. Sin Claude (sin clave, caído o fuera de tiempo): se manda lo que separaron las reglas, para que el closer lo vea en el editor, y queda el faltante **"Confirmar ciudad y provincia del cliente (deducidas sin verificar)"**. Si ciudad o provincia quedan vacías, el faltante es "Ciudad y provincia del cliente" y esos tokens no se mandan.

**Dirección contratante:** se requiere `CONTRATO_DIRECCION_ARGENTINA`, sin dirección por defecto. La configuración privada debe estar completa antes de crear el borrador.

**Prueba (`scripts/bot-contrato-sandbox.mjs`, solo con la clave de sandbox):**
- `--simular` (por defecto): no crea nada. Revisa la dirección, el cuerpo del POST y los tokens de la plantilla (GET de solo lectura), y lista los borradores de prueba que hayan quedado de corridas viejas.
- `--real`: crea un borrador con datos inventados, lo verifica (tokens, variables vacías, texto del PDF y domicilio de Skyward) y siempre lo borra. Con Ctrl+C borra el borrador antes de salir. Si el POST lo creó pero la respuesta se cortó (sin id), lo busca por el nombre exacto de la prueba y lo borra.
- `--garantia`: lo mismo con la plantilla con GARANTÍA.

## Motor del alta y webhook de Whapi (en seco, 24/10/2026)

Es lo que encadena los pasos 0 a 7 y el 9 cuando llegue el número del bot. Se escribió **sin chip ni cuenta de Whapi**: todo está probado sin red, sin base real y sin Claude, con un almacén en memoria y dependencias de juguete. **Sin la configuración explícita de modo real, no escribe en Sheets, Drive ni PandaDoc y no manda mensajes: registra lo que haría.**

Código:
- **Webhook y cliente de Whapi (BLOQUE W):** `app/api/bot/whapi/route.ts` y `lib/bot/whapi/*`. Detalle en `docs/BOT-WHAPI-CJ.md` (qué mensajes se guardan, el cliente real, la compuerta del modo y el CLI que configura el canal).
- **Orquestador (BLOQUE O):** `lib/bot/alta/motor/*`, la ruta manual `app/api/bot/alta/motor/route.ts` y la lectura del comprobante en `lib/bot/alta/comprobante.ts` (pura) y `comprobanteClaude.ts` (Claude con visión).
- **Contrato entre los dos:** `lib/bot/alta/motor/tipos.ts` y `modo.ts`.
- **Tests:** `scripts/test-bot-orquestador.mjs` (152, con los de socios y los de la segunda revisión del 24/10) y `scripts/test-bot-whapi.mjs` (92), cada uno por separado: `node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-XXX.mjs`.
- **Tablas:** `scripts/bot-alta-migrar.mjs` (ver el checklist).

### Cómo funciona

1. **Webhook** (`POST /api/bot/whapi`, header `x-cj-bot-secreto`): clasifica cada mensaje de "Ventas C.J." y "Verificaciones C.J" (`#ALTA`, comprobante suelto, respuesta, edición, eco del propio bot) y lo guarda en Neon sin repetir (`registrar`, con tope de 8 s; si falla, 503 y Whapi reintenta). Responde 200 enseguida.
2. **Después de responder** (`after()`, con plazo de 285 s de los 300 de la función), `procesar`:
   - cada evento encuentra su alta o crea una (un `#ALTA` nuevo, una corrección citando, un reenvío, el pago siguiente de un Fee);
   - cada alta tocada **avanza**: toma el candado del alta, aplica sus eventos pendientes y corre el primer paso listo, en el orden validar → Finanzas → CRM → Drive → comunidad → bienvenida → Skool → contrato, guardando el resultado de cada paso;
   - al final, el **barrido**: recordatorios, esperas vencidas, altas con hora vencida y eventos que quedaron sin procesar.
3. **No hay cron:** el motor despierta con los webhooks. Uno sin eventos nuevos (la charla de cualquier grupo donde está el bot) dispara el barrido como mucho cada 10 minutos por instancia, así la base de Neon (la misma de Cuotas y el kickoff) puede dormirse; la purga de mensajes viejos corre una vez por día. En producción, si un paso no entra en el plazo, se dispara una continuación (`POST /api/bot/alta/motor` con `CRON_SECRET`, como mucho 8 por hora), y un despertador para las esperas cortas (los 3 minutos del comprobante).
   Un alta nace con hora de reintento y cada invocación que la toma la deja, como mucho, en el fin de su candado más un minuto: si la invocación muere a la mitad (Vercel la corta o Neon se cae), el barrido la retoma.
4. **Cada paso es idempotente:** guarda los ids apenas los tiene (fila congelada de Finanzas, id del CRM, carpetas de Drive, comunidad y grupos, borrador de PandaDoc) y una corrida que se cortó se trata como dudosa: antes de repetir, se busca lo que pudo haber quedado hecho.

**Tablas en Neon** (misma base que el kickoff, `DATABASE_URL`): `cj_altas` (una fila por alta, con las esperas y la validación), `cj_altas_pasos` (una fila por paso), `cj_altas_mensajes` (entrantes y salientes, para no repetir y para saber a qué pedido responde una cita) y `cj_altas_recursos` (candados de Finanzas, CRM y el barrido, la pausa de Whapi y el tope de comunidades por día). Se crean solas en la primera escritura o con `scripts/bot-alta-migrar.mjs`; nunca hay `DROP` ni cambios de tipo.

### Estados

**Del alta:**

| Estado | Qué significa |
|---|---|
| `recibida` · `en_curso` | Recién creada o corriendo pasos |
| `esperando_comprobante` | Falta la imagen o el PDF (a los 3 minutos se le pide al closer citando su `#ALTA`) |
| `esperando_humano` | Hay un pedido abierto (closer, RESPONSABLE_HUB o OPERADOR_AUTORIZADO, COORDINACION, el equipo) |
| `esperando_reintento` | Un paso vuelve a intentar a una hora fija (MEP, Finanzas ocupado, Whapi en pausa…) |
| `fee` | Fee cargado en Finanzas: espera el pago siguiente. A los 60 días queda `vencida` con aviso |
| `revisar` | Algo quedó a medias y no se reintenta solo: lo destraba un OK en Verificaciones |
| `lista` · `simulada` | Terminada (en real) o terminada como vista previa (seco o ensayo) |
| `rechazada` | NO de RESPONSABLE_HUB o OPERADOR_AUTORIZADO antes de escribir nada afuera. Se retoma con un OK citado dentro de los 7 días |
| `duplicada` · `reemplazada` | Reenvío del mismo `#ALTA` · Fee que completó un pago posterior |
| `vencida` | 14 días sin respuesta a un pedido de validación (o Fee de 60 días). Se retoma respondiendo el pedido citándolo (30 días más) o forzando el paso desde la ruta del motor |

**De cada paso:** `pendiente`, `corriendo`, `hecho`, `simulado` (sin la capacidad, o en seco/ensayo), `espera` (un OK), `reintento` (con hora), `revisar` y `omitido`.

**Pedidos (esperas):** varias por alta, cada una con su ronda y todos sus mensajes citables (el pedido, los recordatorios y los reenvíos). Recordatorios a las 24 y 72 h, solo de 9 a 21 de Argentina; a los 14 días vencen. Un pedido que no salió (Whapi devolvió un 5xx o se cortó) se reenvía marcado "(repetido)" a los 5 min, 30 min, 2 h y después cada 6 h.

### Cómo se responde

- **Closer (Ventas):** citando el pedido del bot, una línea por dato ("DNI: 1", "Setter: Mai"). Ya no se le pide la fuente; si la manda ("Fuente: Inbound IG"), queda como respaldo de los UTM. Sin citar también vale si tiene una sola alta esperando datos **y es su última alta** (si mandó otro `#ALTA` después, el bot pide citar). Si la respuesta citada no trae ningún dato que el bot entienda, se lo dice.
  - El comprobante, citando el `#ALTA` o el pedido. Sin citar: si es la imagen de un `#ALTA` que llega en los 15 minutos siguientes, es de ese; si no, va al alta que lo espera cuando hay una sola y es la última del closer. Con más de una esperando, el bot pide citar enseguida. Un comprobante sin citar que pagó otra persona (el ordenante no comparte ningún apellido con el cliente ni con sus socios) se pregunta en Verificaciones.
  - El correo de un socio: "Socios:" y debajo "Nombre · correo" (se suma al socio que ya estaba, sin repetir el teléfono; ver "Socios con correo"). También se entienden "Correo de Beatriz: …", "Beatriz Gómez: …" y, si falta el correo de un solo socio, "Mail: …" con un correo distinto del cliente. Si faltan los de varios socios, un "Mail:" suelto se pregunta.
- **Equipo (Verificaciones), siempre citando el mensaje del bot:**
  - `OK` para seguir · `NO motivo` para frenar.
  - Cuenta que recibió: `OK RESPONSABLE_HUB`, `OK OPERADOR_AUTORIZADO` u `OK Empresa`. "Cuenta: X" escrita en Ventas no decide sola: si choca con el comprobante, el bot pregunta.
  - Dólar MEP: `OK 1.450` (con o sin punto de miles).
  - Fuente que los UTM no dicen (25/10/2026): `OK VSL Funnel`, `OK Inbound IG`, `OK BIO Página Web`, `OK Outbound`… (una de la lista de la columna K). Un `OK` solo, o uno con dos fuentes, se vuelve a pedir.
  - Nombre dudoso o carpeta que ya existía: `OK` deja el del `#ALTA`; `OK Nombre Apellido`, **con mayúsculas**, lo cambia. Cualquier otra cosa ("OK, es una sola persona") el bot la vuelve a preguntar sin tocar nada.
  - Suma de un Fee con el pago siguiente: `OK` arranca el alta; `NO` deja este pago como Fee (se carga igual en Finanzas) y el alta espera otro pago.
- Solo cuentan los números de `BOT_ALTA_APROBADORES` (RESPONSABLE_HUB y CSM) y `BOT_ALTA_OPERACIONES` (COORDINACION), según el pedido. A un `@lid` que no está en las listas el bot le contesta una vez "No te reconozco".

### Modo seco, ensayo y real

- **Seco (por defecto):** sin `BOT_ALTA_MODO`, o mal escrito. No sale nada: ni Claude, ni descargas, ni lecturas de planillas, ni mensajes. Cada alta termina `simulada` con lo que haría en el registro.
- **Ensayo** (`BOT_ALTA_MODO=ensayo`): lecturas reales (comprobante, Claude, MEP, CRM de ventas, Finanzas y CRM en modo simulación) y, como mucho, **un** reporte por alta en Verificaciones C.J que empieza con "SIMULACIÓN — no se cargó nada" (con la capacidad `reporte_verificaciones`).
- **Real** (`BOT_ALTA_MODO=real`): escribe solo lo que dice `BOT_ALTA_PASOS_REALES`, capacidad por capacidad: `reporte_verificaciones`, `mensajes_equipo` (pedidos al closer, aviso de Skool), `finanzas`, `crm`, `drive`, `comunidad`, `bienvenida`, `contrato`. Un paso sin su capacidad corre como vista previa (`simulado`).
- **Interruptor:** el modo de cada alta queda fijo cuando nace y el entorno solo puede bajarlo. Pasar el entorno a `seco` frena las altas en curso (quedan en pausa), **pero recién después de un Redeploy**: Vercel aplica los cambios de variables solo a los deploys nuevos. Un alta nacida en seco no pasa a real sola: `POST /api/bot/alta/motor { alta_id, rehacer_en_real: true }`.
- **Freno inmediato** (sin esperar un deploy): sacar la URL del webhook en el panel de whapi.cloud (Settings → Webhooks). Deja de llegar todo y no despierta nada nuevo; lo que ya estaba corriendo termina en menos de 5 minutos.
- Hay tres barreras: el orquestador, la compuerta de Whapi (en seco no sale nada a la red) y el cliente real, que rechaza ids `seco-`/`jg-`.

**Ruta manual** `POST /api/bot/alta/motor` (`Authorization: Bearer <CRON_SECRET>`): `{ simular: { texto } }` (sincrónico y en seco: el plan y lo que haría, sirve sin chip), `{ alta_id, forzar_paso }`, `{ alta_id, responder: { espera_id, texto, por } }` (responder un pedido sin cita), `{ alta_id, rehacer_en_real: true }` y `{ barrer: true }`. `GET` con `?alta_id=` muestra el estado y los pasos, sin textos sensibles.

### Revisión del 24/10/2026 (tres revisores, 33 hallazgos)

Se corrigieron todos los reales, cada uno con su test (`describe('revisión del 24/10 …')` en `scripts/test-bot-orquestador.mjs`). Los que cambian el comportamiento:
- **Fee:** un Fee ya cargado no cuenta como reenvío (el mismo texto con otro comprobante es el pago siguiente); la suma usa lo acumulado (un Fee en 3 o más partes llega a 500); el Fee anterior queda `reemplazado` aunque el nuevo también sea Fee; el NO a la suma no rechaza el alta, la deja como Fee; un Fee que espera un OK y recibe el `#ALTA` del pago siguiente no se toma como corrección (para corregir, citar el `#ALTA`).
- **Comprobante:** sin citar, va al alta que lo espera aunque hayan pasado más de 15 minutos; el mismo `#ALTA` reenviado con la imagen que faltaba se la da al alta original; un álbum solo se suma a un alta que todavía no se validó (así el comprobante del alta siguiente no se lo queda la anterior); el mismo archivo del Fee mandado con otro `#ALTA` se pregunta.
- **Pedidos y avisos:** lo que vuelve dudoso a un grupo del equipo se reenvía marcado; uno que salió sin id cuenta como enviado y corren los recordatorios; el aviso de Skool sale solo con `mensajes_equipo` y, si falla, se reintenta y al cuarto queda a revisar.
- **Respuestas:** primero se controla quién responde (un OK de quien no aprueba ya no reabre un rechazo); lo que sigue al OK solo cambia el nombre si parece un nombre; el MEP se lee con el punto de miles; un evento que falla a la mitad queda sin procesar y se reaplica solo (a la hora se descarta con aviso); una espera vencida se retoma citándola.
- **Comunidad y bienvenida:** el General que crea WhatsApp se guarda antes de sumar a la gente (un 409 o un 5xx ya no crean otro General); un OK a un grupo dudoso lo busca y sigue con lo que falta (otros grupos, fotos, links y el OK de COORDINACION); el NO a una bienvenida dudosa reenvía solo lo dudoso; el eco de la bienvenida en el General del cliente la confirma sola; el video lleva el plazo de la invocación y el paso solo arranca con 265 s libres.
- **Correcciones:** una edición que llega antes que su `#ALTA` se aplica; la de un alta terminada no dice "Tomé la corrección"; una edición sin cambios en los datos (un emoji) no frena nada; si bajar el comprobante para Finanzas falla, la fila no queda congelada con los datos viejos.
- **Seco:** no congela la fecha del pago; `rehacer_en_real` rehace la validación (guarda la caché de Claude).
- **CLI de Whapi:** de los webhooks ajenos muestra solo el host (Make lleva el token en la ruta).

### Segunda revisión del 24/10/2026 (27 hallazgos)

Cada arreglo tiene su test en `describe('revisión del 24/10, ronda 2')` de `scripts/test-bot-orquestador.mjs` (y en `test-bot-whapi.mjs` y `test-bot-finanzas-escribir.mjs`). Lo que cambia:
- **Comprobante sin citar:** espera 15 minutos a que lo reclame el `#ALTA` que suele llegar enseguida, y recién después va al alta que lo esperaba (si sigue siendo la última del closer). Con dos o más esperando, el bot pide citar enseguida y lo descarta (el barrido no lo vuelve a evaluar). Si lo pagó otra persona, se pregunta (antes salía "coincide" y Finanzas lo cargaba a nombre de otro cliente).
- **Mismo teléfono:** un `#ALTA` con el teléfono de un alta abierta solo es su corrección (o el pago siguiente de su Fee) si el nombre puede ser el mismo; con otro nombre es un alta nueva y validar pregunta por el teléfono repetido (un `#ALTA` copiado de otro sin cambiar el teléfono).
- **Fee:** el pago siguiente se encadena al Fee **más nuevo** (aunque espere un OK), así la suma no queda corta; un Fee que espera un OK con su comprobante tampoco cuenta como reenvío del mismo texto con otro comprobante. El comprobante de la segunda seña va como "<Nombre> - Fee 2" y, si en Subidos ya había un archivo con ese nombre (de otro pago o de otro cliente con el mismo nombre), se sube como "<nombre> (2)".
- **MEP:** todo pago en pesos lo busca, aunque el closer haya escrito los USD al lado; se pide con la fecha del comprobante (no con la de llegada) y se vuelve a pedir si esa fecha cambia. El Fee se decide con ese USD y el CRM lo recibe.
- **Lectura del comprobante caída** (Claude no responde): se reintenta sin preguntar nada en Verificaciones (antes se preguntaba la cuenta y el OK quedaba por encima del destinatario). Una cuenta dada que no coincide con el destinatario del comprobante queda en los avisos de Finanzas.
- **Envíos:** el eco que llega antes que el error dudoso ya no se pisa; la copia "(repetido)" se empareja con su eco; si Whapi mandó el mensaje y falla Neon al confirmarlo, queda enviado (no sale dos veces). Una respuesta en Ventas que cita un mensaje desconocido, con datos, se trata como sin cita.
- **Correcciones:** un `#ALTA` corregido con el comprobante como pie valida con ese comprobante en la misma vuelta.
- **CRM:** si otra carga se metió entre la lectura y la escritura sin que se escribiera nada, se reintenta con una lectura nueva (antes iba a revisar y su OK dejaba el cliente sin cargar); el recurso `crm` se toma por los 300 s de la función.
- **Webhook:** los recortes no parten un emoji (un surrogate suelto hacía fallar el jsonb para siempre y Whapi reintentaba 24 h); el canal también se suscribe a `channel.post` y `users.delete`, y si la sesión del número se cae queda un ERROR en el log de Vercel; el webhook de prueba lleva el header del secreto.

### Tercera revisión (integración, 24/10/2026)

Cada arreglo tiene su test en `describe('revisión de la integración, ronda 3')` de `scripts/test-bot-orquestador.mjs`:
- **`#ALTA` de otro cliente respondido sobre el de un alta abierta:** la cita sola ya no la vuelve corrección. Si el nombre no puede ser el mismo, es un **alta nueva** (con su comprobante, si lo trae) y el alta citada no se toca; el bot le avisa al closer y a Verificaciones por si era una corrección del nombre (esa se hace editando el `#ALTA` o respondiendo el pedido con `Nombre completo: …`). Antes el alta citada tomaba el nombre, el teléfono y los datos del otro cliente y se cargaba Finanzas con el comprobante equivocado.
- **Mismo cliente = todas las palabras del nombre más corto en el otro** (`mismaPersona`, con una letra de tolerancia en las palabras largas): "Ana CUENTA_QA" y "Ana CUENTA_QA CUENTA_QA" sí; "Ana CUENTA_QA" y "Ana Gómez" no. Lo usan la cita, el freno del mismo teléfono y el aviso de teléfono repetido. Para el ordenante del comprobante sigue la regla amplia (`nombresCompatibles`: alcanza un apellido).
- **Setter y UTM del CRM de ventas:** se guardan con el teléfono con que se buscaron; si una corrección cambia el teléfono, lo que vino del CRM se suelta y se vuelve a buscar (lo que dijo el closer y un OK de Verificaciones quedan).
- **Alta vencida:** el aviso ya no manda a "retomarla desde el Despacho" (no hay pantalla de altas): se retoma respondiendo el pedido hasta 30 días; después, la retoma RESPONSABLE_HUB.

### Variables de entorno nuevas (solo nombres)

| Variable | Para qué |
|---|---|
| `WHAPI_TOKEN` | Token del canal del bot. |
| `WHAPI_WEBHOOK_SECRETO` | Valor del header `x-cj-bot-secreto` (24 caracteres o más). Sin él, el webhook responde 503. |
| `WHAPI_GRUPO_VENTAS`, `WHAPI_GRUPO_VERIFICACIONES` | `chat_id` (`…@g.us`) de "Ventas C.J." y "Verificaciones C.J". Distintos. |
| `WHAPI_CANAL_ID` | Opcional: `channel_id` del canal (ignora lo que venga de otro). |
| `BOT_ALTA_MODO` | `ensayo` o `real` exactos; cualquier otra cosa es seco. |
| `BOT_ALTA_PASOS_REALES` | Capacidades en real, separadas por coma (ver arriba). |
| `BOT_ALTA_APROBADORES` | Teléfonos (o `@lid`) de RESPONSABLE_HUB y CSM, separados por coma. |
| `BOT_ALTA_OPERACIONES` | Teléfono de COORDINACION (la mención del aviso de Skool sale del primero). |
| `BOT_ALTA_EQUIPO_TELEFONOS` | JSON nombre → teléfono para los grupos del cliente: `COORDINACION`, `COORDINACION`, `RESPONSABLE_HUB`, `ADS`, `CUENTA_QA Girándola`, `CUENTA_QA Gamarra`. |
| `BOT_ALTA_CLOSERS` | JSON nombre → teléfono de cada closer: `{"CUENTA_QA":"1","CUENTA_QA":"1","CUENTA_QA":"1"}`. El closer de un alta en formato libre sale del autor del mensaje (26/10/2026). Sin él, se le pregunta al closer. |
| `BOT_ALTA_MAX_COMUNIDADES_DIA` | Opcional: tope de comunidades nuevas en 24 h (2 por defecto). |
| `BOT_COMUNIDAD_AGREGAR_DIRECTO` | Opcional, **apagado**: `si` vuelve al modo viejo, que suma al cliente y a los socios directo a los grupos. Ver "WhatsApp seguro". |
| `BOT_ALTA_DESPERTADOR` | Opcional: `0` apaga el despertador de las esperas cortas. |
| `BOT_ALTA_MODELO_COMPROBANTE` | Opcional: modelo de Claude para leer el comprobante (por defecto, el mismo Haiku de la dirección). |

Usa además variables que existen en otros lados, pero **no todas están en Vercel** (de `PUENTE_DRIVE_URL`, `PUENTE_DRIVE_SECRETO` y `PLANTILLA_GUIONES_ID` solo consta que están en `.env.local`, y la `PANDADOC_API_KEY` de producción todavía no existe). Por capacidad:

| Capacidad / parte | Variables que tienen que estar en Vercel (Production) |
|---|---|
| Motor (siempre) | `DATABASE_URL`, `CRON_SECRET`, `DESPACHO_URL` (opcional) |
| Lectura del comprobante (ensayo y real) | `BOT_ANTHROPIC_API_KEY` (o `ANTHROPIC_API_KEY`) |
| `finanzas` | `SHEET_ID_FINANZAS`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `PUENTE_DRIVE_URL`, `PUENTE_DRIVE_SECRETO` (el comprobante se sube por el puente antes de cargar la fila) |
| `crm` | `SHEET_ID_CLIENTES`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` |
| `drive` | `PUENTE_DRIVE_URL`, `PUENTE_DRIVE_SECRETO`, `PLANTILLA_GUIONES_ID` (sin ella, los guiones quedan pendientes) |
| `contrato` | `PANDADOC_API_KEY` de producción (sin ella el paso queda `omitido` y el contrato se arma a mano) |
| `mensajes_equipo`, `comunidad`, `bienvenida` | `WHAPI_TOKEN` y las `BOT_ALTA_*` de la tabla de arriba |

Después de cargar o cambiar cualquiera: **Redeploy** (ver el checklist).

### CHECKLIST para el día que llegue el chip

Cada paso con un tilde antes de pasar al siguiente. Nada de esto lo hace el motor solo.

**Variables en Vercel: después de cada cambio, Redeploy.** Vercel aplica las variables nuevas solo a los deploys nuevos: Deployments → el deploy de producción actual → Redeploy (mismo código, variables nuevas; coordinarlo con la sesión DASHBOARD PWA VERCEL). Después, `GET /api/bot/whapi` con `Authorization: Bearer <CRON_SECRET>` tiene que mostrar el modo y las capacidades nuevas. Vale para todos los pasos de abajo que cargan o cambian una variable (3, 4, 6, 7, 12, 13 y el freno).

1. [ ] **Chip y WhatsApp Business** con la foto de C.J y el nombre "Capital Jurídico" (ver "Lo que tiene que conseguir RESPONSABLE_HUB"). El teléfono del chip queda **siempre enchufado y con datos**: si WhatsApp lo desvincula de Whapi, el bot deja de recibir todo (queda un ERROR "la sesión del número de Whapi se cayó" en el log de Vercel; conviene una alerta de Vercel sobre esa línea).
2. [ ] **Cuenta en whapi.cloud** (RESPONSABLE_HUB): crear el canal y **escanear el QR** con el chip. Dejar que el número se caliente (la ficha pide de 3 a 10 días antes de usarlo fuerte).
3. [ ] **Cargar el token**: `WHAPI_TOKEN` en `.env.local` y en Vercel (Production). Lo pega RESPONSABLE_HUB; nadie lo copia en un chat.
4. [ ] **Secreto del webhook**: generar uno (`openssl rand -base64 32`, sin `=`) y cargarlo como `WHAPI_WEBHOOK_SECRETO` en `.env.local` y Vercel.
5. [ ] **Sumar el número del bot** a "Ventas C.J." y "Verificaciones C.J" (y a CSM, OPERACIONES, ADS, COPYWRITING y EDICIÓN). **El equipo agenda el número del bot**: si no, el bot no los puede sumar a los grupos de los clientes.
6. [ ] **Sacar los `chat_id`** de los dos grupos (`…@g.us`) con `GET /groups` (desde el panel de whapi.cloud, que lo prueba con el token). No se pueden sacar del primer webhook: sin los dos grupos la ruta responde 503 antes de leer el cuerpo. Cargarlos como `WHAPI_GRUPO_VENTAS` y `WHAPI_GRUPO_VERIFICACIONES` (y, si se quiere, `WHAPI_CANAL_ID`). Sin los dos, el webhook responde 503 a todo.
7. [ ] **Listas de personas**: `BOT_ALTA_APROBADORES`, `BOT_ALTA_OPERACIONES` y `BOT_ALTA_EQUIPO_TELEFONOS` en Vercel. Confirmar con RESPONSABLE_HUB si los closers están en Verificaciones (sus OK no cuentan para aprobar). Sumar un `@lid` después también pide Redeploy.
7b. [ ] **Variables por capacidad** (tabla "Variables de entorno nuevas"): las de `finanzas`, `crm`, `drive` y `contrato` en Vercel antes de prender cada capacidad. Sin `PUENTE_DRIVE_*`, Finanzas no puede subir el comprobante y queda a revisar.
8. [ ] **Migración de las tablas** (`cj_altas` y compañía), con `.env.local` cargado:
   - `scripts/bot-alta-migrar.mjs --simular`: muestra las sentencias, sin conectarse;
   - primero contra una **rama de Neon** (su `DATABASE_URL`): `--real` (solo mira) y `--real --confirmar` (crea); correr los tests de la rama si hace falta;
   - después contra la base del Despacho: `--real --confirmar`. Es idempotente.
9. [ ] **Deploy** de este código (lo coordina la sesión DASHBOARD PWA VERCEL), con `BOT_ALTA_MODO` **sin cargar** (seco).
10. [ ] **Configurar la URL del webhook** del canal: `scripts/bot-whapi-configurar.mjs --simular`, después `--real` (muestra la diferencia) y `--real --confirmar` (manda el `PATCH /settings` y un webhook de prueba, con el header del secreto). En el log de `/api/bot/whapi` tiene que aparecer la prueba **sin** "(401)" ni "(503)"; un 401 ahí quiere decir que el `WHAPI_WEBHOOK_SECRETO` de Vercel no es el de `.env.local` (o falta el Redeploy). **Reiniciar el canal** en el panel de whapi.cloud (lo pide `callback_persist`).
11. [ ] **Prueba en seco** con un `#ALTA` inventado ("Nombre completo: PRUEBA BOT - borrar", teléfono y correo de prueba, una imagen cualquiera) en Ventas C.J.:
    - en los logs de Vercel, `/api/bot/whapi` responde 200 con "alta:1";
    - `GET /api/bot/alta/motor` muestra el alta `simulada` y lo que haría;
    - no sale ningún mensaje.
    Antes de eso se puede probar sin WhatsApp con `POST /api/bot/alta/motor { simular: { texto } }`.
11b. [ ] **Plan pago del canal de Whapi** (RESPONSABLE_HUB): contratarlo y confirmar en el panel que el canal dejó de ser sandbox. Con el sandbox, Whapi responde 402 al pasar el tope y la comunidad queda a revisar y los pedidos sin salir.
12. [ ] **Ensayo**: `BOT_ALTA_MODO=ensayo` y `BOT_ALTA_PASOS_REALES=reporte_verificaciones`, **Redeploy** y `GET /api/bot/whapi` dice `ensayo`. Otro `#ALTA` de prueba: tiene que llegar **un** reporte a Verificaciones que empieza con "SIMULACIÓN — no se cargó nada", con la lectura real del comprobante (Claude) y el MEP si el pago es en pesos.
13. [ ] **Real, de a una capacidad**, con el OK de RESPONSABLE_HUB en cada una, con altas de verdad y un Redeploy después de cada cambio de `BOT_ALTA_PASOS_REALES`:
    - `reporte_verificaciones,mensajes_equipo`: pedidos al closer, OK/NO en Verificaciones y aviso de Skool, sin escribir nada. COORDINACION sigue cargando todo a mano, como siempre;
    - `+finanzas` y `+crm` (orden de trabajo 3): desde acá **COORDINACION NO carga lo que ya cargó el bot**. Compara la fila 2 del Registro de Pagos (con su chip) y el cliente en Agencia con lo que habría cargado ella, y corrige a mano lo que esté mal. El bot detecta lo que COORDINACION cargó ANTES que él (pregunta), pero nada detecta lo que ella carga DESPUÉS: quedarían el pago y el cliente dos veces (el tablero de Finanzas suma E y F dos veces y el reparto sale inflado);
    - `+drive`, `+comunidad`, `+bienvenida` y `+contrato` (orden de trabajo 4). La comunidad crea grupos de WhatsApp de verdad: probarla con un cliente real, no con uno inventado.
    Si algo sale mal: primero el **freno inmediato** (sacar la URL del webhook en el panel de whapi.cloud) y después `BOT_ALTA_MODO` vacío (seco) **con Redeploy**, que deja en pausa todas las altas en curso. Para volver: cargar el modo, Redeploy y volver a poner el webhook (`scripts/bot-whapi-configurar.mjs --real --confirmar`).

### Lo que queda abierto

- **El SQL de `almacenNeon.ts` no se corrió contra una base de verdad** (solo con un cliente falso): por eso el paso 8 va primero contra una rama de Neon.
- **Formas de Whapi sin confirmar** (probarlas con el sandbox, ver `docs/BOT-WHAPI-CJ.md`): el webhook de una imagen, cómo se vinculan las fotos de un álbum, la foto y descripción de una comunidad ya creada y el formato del link de invitación.
- **Pantalla "Altas"** del Despacho y **checklist de saludos** (paso 8): sin hacer.
- **Socios (24/10):** si un teléfono suelto en "Socios:" (sin nombre ni correo) queda fuera de Skool y si un socio sin teléfono tiene que ser faltante (hoy no lo es; ver "Socios con correo"). Falta confirmar que Skool acepte varios correos juntos en "Invitar" o si COORDINACION los pega de a uno.
- **Decisiones de RESPONSABLE_HUB:** los nombres de los 3 grupos y la descripción de la comunidad (hoy "General - Nombre", "Ventas - Nombre", "Contenido - Nombre"); cómo se traduce el setter del CRM de ventas (`ig`/`fb`) y las preguntas de "Setter y Fuente (25/10/2026)"; qué concepto lleva en Finanzas el pago que completa un Fee; si la columna N va "Back-end" en una DFY+R; qué fecha va en la columna A (hoy la del comprobante, con aviso si difiere más de un día); el modelo de visión (Haiku u Opus); sumar "Empresa" a la lista de la columna R; desde qué alta COORDINACION deja de cargar a mano; si los closers están en Verificaciones; y si los 60 días de un Fee en varias partes se cuentan desde el primero (hoy, desde el último).


## Configuración de contratos en la edición pública

`PANDADOC_PLANTILLA_NORMAL`, `PANDADOC_PLANTILLA_GARANTIA` y `CONTRATO_DIRECCION_ARGENTINA` son configuración privada obligatoria para el borrador que las necesita. No hay IDs ni dirección incorporados en el repositorio. Configuración ausente debe bloquear antes de la solicitud externa. No confundir un borrador sandbox con un contrato autorizado para enviar.
