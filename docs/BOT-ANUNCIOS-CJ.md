> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bot Capital Jurídico · etapa Anuncios

Pedido de RESPONSABLE_HUB (24/10/2026), tareas g01–g06 del doc "Sistema de tareas - C.J" (lista compartida, etapa Anuncios). Código en `lib/bot/anuncios/`. Reglas de armado de campañas (para g03): memoria `reference_estrategia_campanas_clientes.md`, sacadas de los Fathom de RESPONSABLE_HUB con ADS del 28/9 (1 y 1).

## g02 · Fathom → ADS sin duplicar las kickoffs

Ver `docs/FATHOM-ANUNCIOS.md` → "Kickoffs". En una kickoff ADS recibe solo el «🚀 Para lanzar» del bot de kickoff; `/api/fathom-anuncios` lee solo las llamadas de RESPONSABLE_HUB (webhook `ArQDFwUufvBZs2xu`, creado con `scripts/fathom-webhook-anuncios.mjs`).

## g04 · g05 · g06 · Seguimiento de lanzamientos y optimizaciones

El tablero de anuncios ya arma el ciclo de cada campaña (día 1 = anuncios nuevos; desde el día 4 "Revisar para optimizar" hasta «Ya optimicé»; 7 días "compitiendo"; "Revisar ganador final" hasta «Ya revisé»). El seguimiento agrega, **una vez por campaña y ciclo**, mensajes en #📣-ads mencionando a ADS:

| Aviso | Cuándo | Qué dice |
|---|---|---|
| 🛠️ **Optimizar** (g05) | Día 4 a 7 del lanzamiento (o de la reactivación), sin optimización | Cada anuncio activo con su costo por mensaje en USD desde el inicio, contra el rango de la rama: ✅ bien · ⚠️ mirar la calidad · ❌ apagar · ⏳ poco gasto. Si hay caros con mensajes: "preguntale al cliente si esas consultas son buenas". Con un solo anuncio: no hay qué apagar (escalar o pedir videos). Links a Ads Manager y al tablero |
| 🏆 **Dejar 1 o 2 ganadores** (g06) | Día 7 a 10 desde la optimización del ciclo, sin la revisión final. Si ya se ve en Meta que apagaron alguno, pasa a "Ganadores elegidos"; si no y quedan 1 o 2 activos, no hay qué elegir (no sale ni se registra) | Los activos de los últimos días: 🥇 🥈 y el resto a apagar (los que pasan el rango o cuestan 1,5 × el mejor). "Pedí iteraciones de los ganadores" |
| ✅ **Optimización hecha / Ganadores elegidos** | La optimización del ciclo (hasta 10 días después del lanzamiento) o la revisión final (a 7–11 días de esa optimización) se registró en los últimos 3 días con el botón, **o** el bot la vio en Meta | Quién y qué hizo, y el texto para el cliente. Las revisiones semanales de las DM no se le avisan al cliente |
| 🚀 **Campaña al aire / Videos nuevos al aire** (g04) | Día 1 a 3, cuando ya gasta. Un borrador que se prende días después de armarlo cuenta como lanzamiento; una campaña vieja que se reactiva, no | Las campañas nuevas del cliente (en un solo mensaje si salieron el mismo día, con una clave por campaña) y el texto para el cliente |

**"Hecha" en Meta** (`detectarAccion`): una persona (no "Meta") apagó un anuncio (run_status → 8) o un conjunto (→ 7), o lo eliminó (→ 3), que estaba prendido, **de la tanda del ciclo** (anuncios creados entre el lanzamiento y 2 días después, y sus conjuntos; en un borrador prendido días después o una reactivación, desde que se armaron), desde el día 3 (para ganadores, desde 3 días después de la optimización), y quedó al menos un anuncio prendido. Sin al menos una pausa no está hecha: cambiar solo el presupuesto es escalar, no optimizar (en la del día 4 se suma al resumen). No cuenta pausar la campaña entera, ni tocar otra tanda, ni lo que hace Meta solo. Los códigos se verificaron con el historial real del 24/10. Cuando la ve, **la registra sola** en «Ads Optimizaciones» (columna I = `auto: <quién> <qué>`; la revisión final con la fecha de hoy, para que el tablero cierre el ciclo, y la clave del aviso también) y no manda el recordatorio. Si el registro falla, no manda nada (al día siguiente se reintenta). Comprobado: CSM pausó 2 conjuntos de CUENTA_QA CUENTA_QA el 22/10.

**Cambio en el tablero (24/10):** una optimización (o revisión) cuenta solo si es del ciclo actual: fecha ≥ la de la tanda (`vigente` de `tablero.ts`). Antes, una optimización vieja tapaba para siempre las tandas de videos nuevos de la misma campaña (nunca había "Revisar para optimizar" ni recordatorios). Ahora esas rotaciones vuelven a tener su día 4, y la revisión semanal de las DM se cuenta desde la tanda (no desde el anuncio más viejo prendido: si no, una rotación quedaba "Revisar para optimizar" desde el día 1). `Tablero.optimizacionesLeidas` dice si se pudo leer la pestaña: si no, el seguimiento no corre.

**Textos para el cliente:** hasta que el bot tenga WhatsApp (Whapi) van en el mensaje a ADS, para que los pegue en el grupo de ventas del cliente. Quedan guardados en `cj_anuncios_avisos.texto_cliente` con `cliente_estado = pendiente_whapi`: cuando esté Whapi, salen de ahí.

**No avisa:** cuentas pausadas en el CRM o con error de pago; campañas fuera de su ventana (al publicar no se avisa historia vieja); la revisión semanal de las DM (no es la final); una campaña vieja reactivada. Tope: 15 mensajes por corrida (orden: optimizar, ganadores, hecha, lanzada), con 400 ms entre uno y otro. Con los datos del 24/10, la primera mañana habría 19 y salen los primeros 15 (4 de optimizar o hecha, 11 "al aire"); algún "al aire" de hace 3 días puede quedar sin salir. Después, unos pocos por día. Los anuncios activos que todavía no entregaron salen como "sin entrega todavía".

### Cuándo corre

Después de la alerta diaria (`/api/alerta-anuncios`, cron 8:45 AR), con el mismo tablero (no vuelve a leer Meta entero). Corre aunque la alerta no tenga nada que mandar. Lee de Meta, en un solo batch y con los tokens de lectura, solo las campañas con recordatorio: anuncios, gasto y mensajes por anuncio (en pedidos separados) y el historial de la cuenta. `?preview=1` devuelve los textos (`seguimiento.avisos`) sin escribir nada (ni base, ni planilla, ni Discord). `ANUNCIOS_SEGUIMIENTO=0` lo apaga.

### Una sola vez — `cj_anuncios_avisos` (Neon)

Clave `tipo:campaña:fecha del ciclo`. Se reclama antes de mandar (`INSERT … ON CONFLICT DO NOTHING`): `enviando` → `enviado` (id de Discord). Segunda llave: no sale un aviso del mismo tipo para la misma campaña si ya salió uno en los últimos 7 días (la fecha de la clave se puede correr si se pausa el anuncio más viejo). Si Discord lo rechaza (400/404) o seguro no salió (429, o se cortó antes de pedir) se suelta y sale en la próxima corrida si sigue en su ventana; si no confirmó (timeout, 5xx) queda `dudoso` y no se repite.

### Archivos

- `lib/bot/anuncios/seguimiento.ts` — qué toca hoy, detección en el historial, métricas por anuncio y textos (puro).
- `lib/bot/anuncios/metaDetalle.ts` — lectura de Meta (solo GET).
- `lib/bot/anuncios/registro.ts` — `cj_anuncios_avisos`.
- `lib/bot/anuncios/procesar.ts` — orquestador (dependencias inyectadas); `servidor.ts` — las reales.
- `app/api/alerta-anuncios/route.ts` — lo llama después de la alerta.
- `lib/anuncios/optimizaciones.ts` — columna `origen` (I). `lib/anuncios/meta.ts` — exporta `batchConRespaldo` y suma `creada` a los lanzamientos (la fecha de los anuncios antes de una reactivación). `lib/anuncios/tablero.ts` — `vigente` por ciclo y `optimizacionesLeidas`.
- Tests: `node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-seguimiento.mjs` (35, sin red, base, planilla ni Discord). Dos revisiones adversariales del 24/10 aplicadas (avisos dobles de ganadores, revisiones semanales, rotaciones tapadas, pausas de anuncios con código 8, métricas a medias, lanzadas agrupadas, registro fallido, reactivaciones).
- Prueba en seco con datos reales: `~/cj-anuncios/scripts/seguimiento-seco.mjs` (copiarlo a `scripts/` para correrlo: lee el tablero, Meta y Neon, no escribe nada).

## g01 + g03 · Videos nuevos en Editados y borrador en pausa (25–26/10/2026)

- **g01 (en producción desde el 25/10, r2d8ykd93).** Corre en la alerta de las 8:45 (`lib/bot/anuncios/videos.ts` + `editadosDrive.ts`).
  - Mira «Editados - X» y sus subcarpetas.
  - Avisa una vez por subida: espera 12 h sin videos nuevos.
  - Solo toma lo subido desde `ANUNCIOS_VIDEOS_DESDE` (por defecto el 26/10).
  - Se apaga con `ANUNCIOS_VIDEOS=0`.
- **g03 (`borrador.ts`).** En las rotaciones, el aviso llega con el borrador ya armado en Meta y todo en `PAUSED`. Se verifica relevendo; nada se prende solo.
  - **Molde del conjunto:** el conjunto activo que más gastó en 7 días. Solo campañas ABO: con presupuesto de campaña (CBO) va a mano.
  - **Molde del anuncio:** el anuncio activo de un solo video que más gastó (primero en ese conjunto, si no en toda la cuenta). Los anuncios con una versión del video por ubicación (`asset_feed_spec`) no sirven de molde.
  - **Copy:** el del ganador; el aviso le pide a ADS que lo ajuste.
  - **Lo que no se copia:** `attribution_spec` y `standard_enhancements`, porque Meta los rechaza.
  - **Interruptor:** apagado salvo `ANUNCIOS_BORRADOR=real`; `ANUNCIOS_BORRADOR_SOLO=act_…` lo limita a esas cuentas.
  - **Token:** `META_ANUNCIOS_TOKEN`.
  - **Tiempo:** la ruta de la alerta pasó a `maxDuration` 300, porque los videos tardan en procesarse en Meta. Si no terminan a tiempo, el conjunto no se crea y el aviso lo dice.
- **g04 (WhatsApp al cliente).** Construido y publicado, APAGADO: solo sale con `ANUNCIOS_WHATSAPP=real` (+ `ANUNCIOS_WHATSAPP_SOLO` y `ANUNCIOS_WHATSAPP_GRUPOS`). Sin eso, el texto para el cliente le llega a ADS para que lo pegue.

## Regla del 26/10: el «🚀 Para lanzar» sale con los videos, no en la kickoff

- **El aviso.** La kickoff ya no le avisa a ADS (`KICKOFF_AVISO_ADS` apagado, lo cambió la sesión Kickoff). El único aviso de lanzamiento es el de g01. Cuando aparecen videos en «Editados - X» de un cliente que todavía no gasta, sale un «🚀 Para lanzar» con lo de la ficha de kickoff (`lineasFicha` en `videos.ts`):
  - cuenta (`act_…`, moneda y horario);
  - rama y a quién le habla;
  - zona (con la marca si hay que revisar el mapa);
  - presupuesto (si está a confirmar);
  - fecha de lanzamiento;
  - WhatsApp de destino;
  - lo del portfolio que frena;
  - links a la ficha y a Fathom.

  Sin ficha, va ⚠️.
- **El tablero.** El bloque «Por lanzar» (`lib/anuncios/editadosPorLanzar.ts`, `tablero.ts`, `components/anuncios/PorLanzar.tsx`) muestra solo a los que tienen archivos en su carpeta de editados, con el link a la carpeta.
  - **Sin videos:** los que tienen la carpeta vacía van en una línea al pie.
  - **Sin carpeta o sin Drive:** si no se encuentra la carpeta (nombre distinto en Drive, o empate entre dos), se muestran igual. Si Drive no responde en 45 s, se muestran todos con un aviso.

## g03 · Anuncios armados EN PAUSA (alcance aprobado 27/10: Hub + RESPONSABLE_HUB)

- **Qué hace.** Cuando el aviso de videos nuevos sale con ANUNCIOS_BORRADOR=real (`ANUNCIOS_BORRADOR_SOLO` limita las cuentas), el bot arma en Meta y deja TODO en `PAUSED`. Lo relee para verificarlo y lo prende ADS.
- **Rotación** (`borrador.ts`). La estructura sale de la regla de RESPONSABLE_HUB (`estructuraRotacion`, `plan.ts`):
  - **Un conjunto por video**, a la tarifa de prueba, si probarlos cuesta como mucho el 25 % del mensual.
  - **Todos juntos**, al diario que cierra el mes, si cuesta más o si no hay presupuesto.
  - **Molde:** el conjunto activo y el anuncio de un solo video que más gastan.
- **Lanzamiento** (`lanzamiento.ts`). Cliente sin fila, con ficha de kickoff y acceso:
  - **Campaña nueva:** «Rama | DM-WPP | ABO | dd/mm/aa [USD N/MES]».
  - **Presupuesto:** el mensual de la ficha (`mensualDeFicha`).
  - **Página e Instagram:** las páginas que promociona la cuenta; si no hay, las del portfolio.
  - **Zona:** los lugares de la ficha buscados en Meta. Primero se elige la provincia que comparten; lo que no aparece se avisa.
  - **Estructura:** la regla de RESPONSABLE_HUB, con habitantes estimados por Claude.
  - **Conjunto:** conversaciones a WhatsApp, 18-64, Advantage+ apagado, FB+IG, solo celular.
  - **Anuncio:** «Enviar mensaje de WhatsApp», «Chatea con nosotros», el saludo de `plan.ts` y todas las mejoras apagadas.
- **Copy** (`copys.ts`). Lo escribe Claude desde el guion del video, que sale del doc «Guiones - X» con el parser de Grabación:
  - **Qué guion es de qué video:** el número del archivo dentro de la tanda; si no aparece, el N-ésimo del doc.
  - **Molde:** «gancho ⬇️ / problema / Enviame un mensaje 💬 …».
  - **Sin copy:** en la rotación va el del ganador con ⚠️; en el lanzamiento no se arma.
- **Página sin WhatsApp vinculado** (CUENTA_QA y CUENTA_QA, 27/10). Meta no deja crear el conjunto: el aviso dice ⛔ con qué hacer y los videos quedan subidos.
- **Prueba en seco del 27/10.** Se escribe en `~/cj-anuncios/scripts/g03-seco.mjs`: lee Meta, Drive y la ficha, y no escribe.
  - **CUENTA_QA:** 3 conjuntos por video, con copys que coinciden con la transcripción de los videos.
  - **Z002:** campaña [USD 240/MES], 2 conjuntos, zona en San CUENTA_QA.

### Revisión de publicación — 28/10/2026

- Si se intentó armar en Meta y luego falla Discord (incluye rechazo y 429), se conserva la reserva como dudosa. No se reintenta el armado automáticamente: evita duplicar campañas/conjuntos parciales o completos.
- Los lanzamientos usan el país ISO de la ficha, incluido en Por lanzar. Sin país o presupuesto mensual confirmado, no se arma una campaña. La estimación de habitantes usa ese mismo país.
- Antes de cada pedido de Meta se comprueba que quede tiempo para completarlo dentro del plazo del cron.
- Revisión completa: 3.464 tests, 3.459 aprobados, 5 omitidos y 0 fallos; ESLint y build local correctos. Ensayo con lectura real de CUENTA_QA y POST simulados: 3 conjuntos y 3 anuncios en PAUSED, cero escrituras reales.
- La publicación habilita la preparación de borradores mediante ANUNCIOS_BORRADOR=real; los anuncios se crean en PAUSED y los revisa/enciende ADS. No se ejecuta manualmente el cron ni se envían mensajes como parte de esta revisión.

## Método 3:2:2 en los anuncios de clientes (1/11/2026, Hub + Tomás)

Reemplaza la regla de las 5 variaciones de copy. Por cada **idea** (3 videos de la tanda, en orden: 1-2-3, 4-5-6…) se
escriben 2 textos principales (uno **amplio/entretenido** y uno **directo**, el molde de siempre) y 2 títulos, sin
descripción. Cada video es **su propio anuncio** y los 3 comparten esos textos y títulos: Meta combina 4 variantes por
video, 12 por idea.

- **Por qué no un solo anuncio flexible con los 3 videos:** Meta no admite el formato flexible de varios videos con el
  objetivo Interacción, que es el de las campañas de WhatsApp de los clientes. La prueba real del 1/11 lo rechazó con
  «El objetivo seleccionado no admite el formato flexible en este momento». Según la documentación, por API solo lo
  admiten Ventas y Apps. Además, si los videos van en `asset_feed_spec` junto con un `video_data`, Meta los descarta
  sin avisar (`validate_only` da OK igual).
- **En Meta** (`borrador.ts`): cada anuncio lleva `video_data` con su video, el directo y el primer título, más
  `asset_feed_spec` con `bodies` (directo y amplio), `titles` (los 2) y `optimization_type: "DEGREES_OF_FREEDOM"`.
- **Textos** (`copys.ts`): un pedido a Claude por idea, con los guiones de sus 3 videos. Si Claude falla, va el copy
  del ganador con aviso (rotación) o no se arma (lanzamiento).
- **Estructura:** la regla de Tomás cuenta **ideas** (6 videos = 2 ideas): un conjunto por idea o todos juntos.
- **Nombres:** «n- <gancho> · V<número del video>».
- Si sobran 1 o 2 videos, forman una idea más chica, con aviso. El aviso le pide a Valen que confirme que cada idea
  junte videos del mismo concepto.

## Notas del cliente: WhatsApp → Despacho → Valen (1/11/2026, Hub + Tomás)

Lo que el cliente dice de sus anuncios en su grupo de WhatsApp queda en **Anuncios → «Notas del cliente»** (fecha, lo
que dijo, lo que pide). Si hay que cambiar o tener en cuenta algo de la campaña, sale un aviso a #📣-ads mencionando a
Valen, con el pedido y el link a la nota (`/anuncios?nota=<id>#notas`).

- **Solo lee.** El bot no escribe nada en los grupos (por el baneo del 26/10).
- **De dónde sale:** el mismo webhook de Whapi que usa Éxito (`lib/bot/whapi/ruta.ts` → `programarNotas`), con las
  mismas exclusiones: sin equipo, sin grupos del equipo, sin mensajes propios y nada con más de 48 h. De qué cliente es
  el grupo lo resuelve el directorio de Éxito (`directorioReal`). Cuentan los grupos General y Ventas; los de Contenido
  van a Guiones. Los audios no se leen.
- **Filtro + Claude** (`notas.ts`): un filtro barato de palabras de campaña y después Claude con esfuerzo bajo, que
  decide si el mensaje es de anuncios y lo resume (qué dijo, qué pide, si hay que avisar y el tema).
- **Base:** `cj_anuncios_notas` (`notasNeon.ts`), con una fila por mensaje que se reclama antes de leerlo. Lo que no es
  de anuncios queda «descartado», sin el texto.
- **API:** `GET /api/anuncios/notas`, con el mismo acceso que el tablero. La sección se ve en
  `components/anuncios/NotasCliente.tsx`.
- **Interruptor:** `ANUNCIOS_NOTAS=0` lo apaga. Usa `DISCORD_WEBHOOK_ANUNCIOS`, `DISCORD_ID_VALENTINO`, `DATABASE_URL` y
  la clave de Claude.
- **Ojo (1/11):** el número del bot está conectado (AUTH) pero hoy está en 2 grupos y en ningún «General - X». Hasta
  que lo sumen a los grupos de los clientes no hay nada que leer.
