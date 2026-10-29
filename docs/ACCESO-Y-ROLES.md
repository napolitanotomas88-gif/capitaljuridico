> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Acceso y roles

Cómo entra la gente al dashboard unificado de Capital Jurídico y qué ve cada uno. Cada persona entra con su cuenta de Google (Gmail o Workspace): no hay contraseñas propias. Solo entran las cuentas que figuran en una lista que se edita en Vercel.

Todo el sitio pide ese login, incluido el dashboard principal (`/`) y sus rutas de datos, salvo lo que usan los crons, los webhooks y Make (que se autentican solos) y las dos secciones que tienen su propia clave (Finanzas y Anuncios). La lista completa, ruta por ruta, está en "Quién entra a cada ruta".

## Cómo funciona

1. La persona abre cualquier página sin sesión y cae en `/entrar`. Toca "Entrar con Google".
2. `/api/auth/google` genera un intento (state, nonce y code_verifier al azar, PKCE con S256), lo guarda en una cookie firmada de 10 minutos y manda a la persona a Google, siempre con selector de cuenta.
3. Google vuelve a `/api/auth/google/callback` con un código. El servidor comprueba que el `state` sea el del intento, canjea el código en el token endpoint de Google (con el `code_verifier` y el secreto del cliente, que nunca pasan por el navegador) y revisa el `id_token`: emisor de Google, audiencia igual a `GOOGLE_CLIENT_ID`, no vencido, `nonce` del intento, mail presente y verificado. El `id_token` llega directo del token endpoint por HTTPS, así que no hace falta verificar su firma (OpenID Connect Core, 3.1.3.7).
4. Si el mail figura en `AUTH_USUARIOS`, se emite la cookie de sesión y se redirige a la página que pidió la persona (`next`) o, si no hay, a la primera sección que su rol puede ver. Si no figura, se la rechaza aunque Google la haya verificado.
5. Desde ahí, el proxy (`proxy.ts`) y cada página llaman a la misma lógica: leen la cookie, la verifican y buscan a la persona en `AUTH_USUARIOS`. El proxy es la primera barrera y `exigirAcceso(seccion)` (`lib/auth/sesion.ts`) la segunda, en cada página.

**La cookie solo prueba identidad.** Guarda el mail y las fechas de emisión y vencimiento. El nombre y el rol salen en cada petición de `AUTH_USUARIOS`. Por eso quitar a alguien de la lista o cambiarle el rol rige apenas termina el redeploy, sin tocar el secreto y sin esperar a que venza su sesión.

| Cookie | Dura | Path | Qué lleva |
|---|---|---|---|
| `cj_sesion` | 7 días desde el ingreso (no se renueva sola: al vencer, un clic y vuelve a entrar) | `/` | el mail |
| `cj_intento` | 10 minutos | `/api/auth/google` | state, nonce, code_verifier y a dónde volver |

Las dos son `HttpOnly`, `SameSite=Lax` y `Secure` en producción, y están firmadas con HMAC-SHA256 con `AUTH_SECRET` (formato `v1.<carga>.<firma>`, comparación en tiempo constante). La firma cubre también el propósito: una cookie de intento no sirve como sesión.

Si falta cualquiera de las variables obligatorias en producción, el login **falla cerrado**: `/entrar` muestra "Acceso no configurado", `/api/auth/google` redirige a `/entrar?error=configuracion` y no se emite ninguna cookie.

### Códigos de error (`/entrar?error=...`)

| Código | Cuándo | Qué se le dice a la persona |
|---|---|---|
| `cuenta_no_autorizada` | Google la verificó pero el mail no está en `AUTH_USUARIOS` | Que pida a un socio que la agregue o entre con otra cuenta |
| `intento_vencido` | Pasaron más de 10 minutos, la cookie del intento falta o fue alterada, el `state` no coincide o el intento ya se usó | Que vuelva a tocar "Entrar con Google" |
| `google_rechazo` | Canceló en Google, Google rechazó el canje o no confirmó el mail | Que pruebe de nuevo o elija otra cuenta |
| `configuracion` | Falta o está mal alguna variable obligatoria | Que avise a quien administra el dashboard |
| `error` | Cualquier otra falla (token con emisor, audiencia, nonce o vencimiento incorrectos, Google caído, respuesta rara) | Que pruebe de nuevo |

El motivo exacto queda en el log del servidor (`[auth] login rechazado: ...`), sin mails ni tokens.

## Variables de entorno

Solo se cargan en Vercel (Settings, Environment Variables). Nunca van en el código ni en el repositorio.

| Variable | Qué es |
|---|---|
| `AUTH_SECRET` | 32 caracteres o más al azar (por ejemplo `openssl rand -base64 48`). Firma las cookies. Si falta o es corto, no se firma ni se acepta nada. |
| `AUTH_USUARIOS` | Lista de personas autorizadas, en JSON (ver abajo). |
| `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` | De la credencial OAuth "Aplicación web" de Google Cloud. |
| `AUTH_BASE_URL` | Origen público, con https y sin barra final: `${AUTH_BASE_URL}/`. En desarrollo vale `http://localhost:3101` si no se define. |
| `CRON_SECRET` | Ya existe (lo usan los crons). Además abre `/api/raw`, `/api/metrics` y `/api/ads` a quien manda `Authorization: Bearer <CRON_SECRET>` (scripts de verificación, `scripts/audit.mjs`). Sin esta variable el acceso por Bearer queda cerrado. No sirve como `?key=` en esas tres rutas. |
| `GOOGLE_AUTH_URL` y `GOOGLE_TOKEN_URL` | Solo para tests: apuntan a un proveedor simulado. Se ignoran si `NODE_ENV` es `production` o si existe cualquier `VERCEL_ENV`. En producción los endpoints son los de Google, fijos en el código. |

### Credencial de Google (una sola vez)

En Google Cloud, proyecto del dashboard:

1. Pantalla de consentimiento: nombre "Capital Jurídico". Los alcances son `openid`, `email` y `profile` (no sensibles, normalmente no piden verificación de Google; confirmarlo en la pantalla). Con tipo "Interno" (solo Workspace) entra todo el dominio. Con "Externo" y publicación "En pruebas", solo entran los mails cargados como usuarios de prueba, así que conviene pasarlo a producción.
2. Credenciales, crear "ID de cliente de OAuth", tipo "Aplicación web".
3. URI de redireccionamiento autorizados: `${AUTH_BASE_URL}/api/auth/google/callback`. Para probar en la compu, sumar `http://localhost:3101/api/auth/google/callback`. Tiene que coincidir letra por letra con `AUTH_BASE_URL` más `/api/auth/google/callback`.
4. Copiar el ID y el secreto a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel.

## Agregar o sacar a una persona

`AUTH_USUARIOS` es una lista JSON en una sola línea. Cada entrada lleva `email`, `nombre` y `rol` (`socio`, `closer`, `csm` o `setter`):

```json
[{"email":"<EMAIL_PRIVADO_CONFIGURADO>","nombre":"Nombre","rol":"socio"},{"email":"<EMAIL_PRIVADO_CONFIGURADO>","nombre":"Otra","rol":"csm"}]
```

1. En Vercel, Settings, Environment Variables, editar `AUTH_USUARIOS` (Production, y Preview si se usa).
2. Agregar o borrar la entrada. Para cambiar el rol, editar `rol`.
3. **Redeployar** (Deployments, los tres puntos del último, Redeploy). Las variables solo se leen al desplegar.

Reglas de la lista: los mails se comparan en minúsculas y sin espacios, y solo se aceptan con caracteres ASCII (un mail con letras de otros alfabetos, por ejemplo cirílicas o el signo Kelvin, nunca coincide con uno listado, ni del lado de Google ni dentro de la lista). Una entrada con mail, nombre o rol inválidos se ignora y queda un aviso en el log del servidor (sin mails). Un mail repetido con el mismo rol cuenta una vez; repetido con roles distintos se descarta por completo (falla cerrado: hay que dejar una sola entrada). Si el JSON está roto o la lista queda vacía, el acceso queda "no configurado".

## Rotar `AUTH_SECRET`

1. Generar un secreto nuevo (`openssl rand -base64 48`).
2. Reemplazarlo en Vercel y redeployar.

Todas las cookies emitidas con el secreto viejo dejan de valer: **se cierran todas las sesiones** y cada persona vuelve a entrar con un clic. Conviene hacerlo si se sospecha que el secreto se filtró. No hace falta para sacar a una persona (eso se hace en `AUTH_USUARIOS`).

## Quién entra a cada ruta

La tabla vive en un solo archivo, `lib/auth/rutas.ts` (`REGLAS`): ahí se decide el acceso por URL, y `proxy.ts` solo la aplica. Se evalúa en orden y gana la primera regla que coincide. **Lo que no figura cae cerrado**: pide sesión de Google con cualquier rol, así que una ruta nueva queda protegida hasta que alguien la declare. `scripts/test-rutas.mjs` falla si hay una página o una ruta `/api` en `app/` sin declarar, o si esta tabla no tiene algún patrón de `REGLAS`.

Cómo se leen los patrones: `/clientes/*` coincide con `/clientes` y con todo lo que cuelga de ahí, pero no con `/clientesx`. La comparación no distingue mayúsculas, ignora la barra final y junta las barras dobles. Una ruta ambigua (`%2F` o `%5C` escondidos, doble codificación, `.` o `..`, caracteres de control) nunca cuenta como abierta: se le aplica la protección que le toque.

Qué pasa cuando no se puede entrar: en las páginas, sin sesión se redirige a `/entrar?next=<ruta>` (después de entrar vuelve a la página que se pidió) y con sesión pero sin permiso se manda a la primera sección que el rol sí ve. En las rutas `/api` la respuesta es `401` (sin sesión) o `403` (sin permiso) en JSON, nunca una redirección: un `fetch()` no tiene que terminar en una página HTML.

### Públicas

| Ruta | Quién | Para qué |
|---|---|---|
| `/entrar` | Cualquiera | Pantalla de ingreso. Si exigiera sesión habría un bucle de redirecciones. |
| `/api/auth/*` | Cualquiera | Inicio y retorno del login con Google, y salir. Se protegen con `state`, PKCE y `nonce`. |
| `/_next/*` | Cualquiera | Archivos compilados (CSS, JS, fuentes, imágenes). Nunca llevan datos y `/entrar` los necesita sin sesión. |
| `/favicon.ico` | Cualquiera | Ícono de la pestaña. |
| `/manifest.webmanifest` | Cualquiera | Manifiesto de la app instalable (PWA): el navegador lo pide sin cookie. Solo nombre, colores e íconos. No hay service worker ni caché sin conexión. |
| `/pwa/*` | Cualquiera | Íconos de la app instalable (192, 512, maskable y el de iOS). Imágenes con el wordmark de texto, sin datos. |
| `/marca/*` | Cualquiera | Logo oficial de Capital Jurídico (SVG) para la página de acceso. Sin datos. |
| `/v/*` | Cualquiera | Video del WhatsApp de confirmación. Make (escenario 6333195) y 2Chat lo descargan sin cookie desde `/v/<ID_PRIVADO_CONFIGURADO>.mp4`: **no mover ni renombrar**. |
| `/bot/*` | Cualquiera | Fotos de la comunidad y de los grupos General, Ventas y Contenido de cada cliente (`public/bot/*.jpg`). Whapi las baja por URL, sin cookie, cuando el bot de altas arma los grupos. Solo imágenes, sin datos. Pasa por el proxy (que la da por pública). Ver `docs/BOT-WHAPI-CJ.md`. |
| `/finanzas/login` | Cualquiera | Pantalla de contraseña de Finanzas (igual que antes). |
| `/api/finanzas/login` | Cualquiera | Login de Finanzas (igual que antes). |
| `/api/finanzas/logout` | Cualquiera | Salida de Finanzas (igual que antes). |

### Automatización: se autentica sola

El proxy no interviene: ni siquiera se invoca (el `matcher` de `proxy.ts` las deja afuera) y la tabla las marca como abiertas por si el `matcher` cambia. La ruta verifica por su cuenta.

| Ruta | Quién la llama | Cómo se autentica |
|---|---|---|
| `/api/analista` | Cron de Vercel, 8:20 AR | `CRON_SECRET` (Bearer o `?key=`), falla cerrado |
| `/api/resumen-diario` | Cron de Vercel, 8:00 AR | `CRON_SECRET` (Bearer o `?key=`) |
| `/api/recordatorio-formularios` | Cron de Vercel, días 1 y 15 | `CRON_SECRET` (Bearer o `?key=`) |
| `/api/reporte-enrutamiento` | Cron de Vercel, 8:05 AR | `CRON_SECRET` (Bearer o `?key=`) |
| `/api/agenda-slots` | Cron de Vercel, 8:10 AR, y el webhook de Calendly | `CRON_SECRET`, falla cerrado |
| `/api/finanzas-cierre` | Cron de Vercel, 10:00 AR | `CRON_SECRET`, 503 si falta |
| `/api/reporte-anuncios` | Cron de Vercel, lunes 8:00 AR | `CRON_SECRET`, falla cerrado |
| `/api/alerta-anuncios` | Cron de Vercel, 8:45 AR | `CRON_SECRET`, falla cerrado |
| `/api/reporte-eod` | Make 6463821 (EOD de Maite, 23:59 AR) | `CRON_SECRET` o `EOD_KEY` (Bearer o `?key=`) |
| `/api/calendly-webhook` | Calendly | Firma HMAC en `Calendly-Webhook-Signature`. Si falla 24 horas seguidas Calendly deshabilita la suscripción, y de esta ruta depende también el WhatsApp de confirmación al lead. |
| `/api/fathom-anuncios` | Fathom (webhook "new meeting content ready") y pruebas manuales | Firma Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) con `FATHOM_WEBHOOK_SECRET`; sin el secreto responde 503. El modo manual y el `GET` de estado piden `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`). Falla cerrado. Ver `docs/FATHOM-ANUNCIOS.md`. |
| `/api/bot/kickoff` | Fathom de RESPONSABLE_HUB y de COORDINACION (webhook "new meeting content ready" de las kickoffs) y pruebas manuales | Firma Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) contra `FATHOM_KICKOFF_WEBHOOK_SECRET` o `FATHOM_KICKOFF_WEBHOOK_SECRET_<QUIEN>`; sin ningún secreto responde 503. El modo manual y el `GET` de estado piden `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`). Falla cerrado. Ver `docs/BOT-KICKOFF-CJ.md`. |
| `/api/bot/kickoff/mapa` | Pruebas y procesos manuales del bot de kickoff: zona desde el video (baja el video de Fathom, saca cuadros con ffmpeg y Claude lee el mapa) | `POST` y `GET` solo con `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`). Falla cerrado. Ver `docs/BOT-KICKOFF-CJ.md`. |
| `/api/bot/guiones` | La aprobación del kickoff (disparo de la tanda de guiones), los pasos del bot y pruebas manuales | `GET` y `POST` solo con `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`); sin el secreto, 503; con otro, 401. Falla cerrado. Ver `docs/BOT-GUIONES-CJ.md`. |
| `/api/bot/guiones/respuesta` | El webhook de Whapi, que reenvía los mensajes de los grupos Contenido | `POST` solo con `Authorization: Bearer <CRON_SECRET>`; sin el secreto, 503; con otro, 401. Falla cerrado. Ver `docs/BOT-GUIONES-CJ.md`. |
| `/api/bot/whapi` | Whapi.Cloud (webhook de mensajes del número del bot "Capital Jurídico") | Header `x-cj-bot-secreto` igual a `WHAPI_WEBHOOK_SECRETO` (24+ caracteres, comparado en tiempo constante; Whapi no firma los envíos). Sin el secreto o sin `WHAPI_GRUPO_VENTAS` / `WHAPI_GRUPO_VERIFICACIONES` responde 503. Solo procesa esos dos grupos. El `GET` de estado pide `Authorization: Bearer <CRON_SECRET>`. Falla cerrado. Ver `docs/BOT-WHAPI-CJ.md`. |
| `/api/bot/alta/motor` | El propio bot de altas (continuaciones y despertador) y pruebas manuales (barrido, respuestas, simulación) | `POST` y `GET` solo con `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`). Falla cerrado. Ver `docs/BOT-ALTA-CJ.md`. |
| `/api/bot/exito` | Cron diario de Vercel (10:00 AR) de la etapa Éxito del bot "Capital Jurídico" y consultas manuales (`?dry=1`, `?lista=1`, `?estado=1`) | Solo `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`): 503 sin el secreto, 401 con otro. Falla cerrado. Ver `docs/BOT-EXITO-CJ.md`. |
| `/api/bot/bajas` | Cron diario de Vercel 10:30 AR (etapa Bajas del bot: aviso de fin, recontacto mensual) y pruebas manuales (`?dry=1`, `?estado=1`, `?baja=ID`, `?recording_id=`) | `GET` solo con `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`): 503 sin el secreto, 401 con otro. Falla cerrado. Ver `docs/BOT-BAJAS-CJ.md`. |
| `/api/bot/grabacion/vigia` | Puente Drive (Apps Script de CUENTA_GOOGLE_OPERADORA_CONFIGURADA, disparador cada 15 min de 8 a 22 AR) y pruebas manuales | `Authorization: Bearer <VIGIA_SECRETO>` (el puente; secreto propio, no `CRON_SECRET`, que abre `/api/raw`) o `Bearer <CRON_SECRET>` (a mano). `VIGIA_SECRETO` de menos de 32 caracteres cuenta como no configurado; sin ninguno, 503. El `GET` de estado, solo con `CRON_SECRET`. Nunca `?key=`. Falla cerrado. Ver `docs/BOT-EDICION-CJ.md`. |
| `/api/bot/grabacion/transcripcion` | AssemblyAI (webhook "transcripción terminada") | Cabecera `X-Edicion-Secreto` igual a `ASSEMBLYAI_WEBHOOK_SECRETO` (mínimo 32 caracteres), comparada en tiempo constante; sin el secreto configurado responde 503. Falla cerrado. |
| `/api/bot/grabacion/diario` | Cron de Vercel, 7:00 AR (en Hobby, entre las 7 y las 8): pasada completa de Drive, guiones, seguimiento e01 y resumen para la daily de Edición | `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`), falla cerrado. Ruta hija sin query, como `/api/fathom-anuncios/reintentar`. |
| `/api/fathom-anuncios/reintentar` | Cron de Vercel, 8:30 AR (en Hobby, entre las 8 y las 9): reintenta las grabaciones de Fathom que quedaron en error | `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`), falla cerrado. Es una ruta hija (y no `?reintentar=1`) porque Vercel no documenta que respete una query en el path de un cron. |
| `/api/trazabilidad/botonera` | Botón "Enviar al Despacho" de la botonera de ManyChat (extensión de Chrome) | `Authorization: Bearer <TRAZABILIDAD_KEY>`; sin la clave responde 503. Falla cerrado. Ver `docs/TRAZABILIDAD.md`. |
| `/api/trazabilidad/manychat` | Importación de etiquetas de ManyChat a Trazabilidad (manual) | `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`), falla cerrado. Sin `?escribir=1` solo cuenta coincidencias; `?analizar=N` analiza pendientes. |
| `/api/trazabilidad/semanal` | Cron de Vercel, lunes 8:00 AR: semanal de setting (EOD + botonera + cierres sin capas) a Discord | `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`), falla cerrado. `?preview=1` devuelve el texto. |
| `/api/trazabilidad/procesar` | Cron de Vercel, 7:00 AR: analiza los envíos de la botonera y trae las llamadas de Fathom de los cierres | `Authorization: Bearer <CRON_SECRET>` (nunca `?key=`), falla cerrado. |

Si se agrega una ruta de automatización nueva hay que sumarla en dos lugares: `REGLAS` y el `matcher` de `proxy.ts`. El test avisa si quedan desfasados.

### Clave propia (no usan el login de Google)

| Ruta | Quién | Cómo se controla |
|---|---|---|
| `/anuncios/*` | Quien tenga la clave del tablero (RESPONSABLE_HUB y el media buyer, que no figura en la matriz de roles) | Cookie `skwd_anuncios` (`ANUNCIOS_PASSWORD`), la verifica la página |
| `/api/anuncios/*` | El tablero | Cookie `skwd_anuncios` o `CRON_SECRET`, la verifica cada ruta |
| `/finanzas/*` | Quien tenga la contraseña de Finanzas | Cookie `skwd_finanzas` (`FINANZAS_PASSWORD`), bloque original de `proxy.ts` sin cambios |
| `/api/finanzas/*` | La pantalla de Finanzas | Igual, con `401` o `503` en JSON |

La sesión de Google **no reemplaza** la clave de Finanzas ni la de Anuncios (ni al revés): son accesos separados por ahora.

### Con sesión de Google

| Ruta | Sección | Quién entra | Notas |
|---|---|---|---|
| `/` | Resumen | socio | Dashboard principal. Antes era público. Quien no puede verlo va a su sección. |
| `/api/raw` | Resumen | socio, o `Authorization: Bearer <CRON_SECRET>` | Teléfonos de leads, pagos y llamadas. Respuesta `401` o `403` en JSON. |
| `/api/metrics` | Resumen | socio, o Bearer `CRON_SECRET` | Cuotas a cobrar y cash del mes. |
| `/api/ads` | Resumen | socio, o Bearer `CRON_SECRET` | Gasto y campañas de Meta. |
| `/clientes/altas/*` | Cargar alta (pestaña de Clientes) | socio (y quien la tenga en Configuración) | Bot de altas sin WhatsApp (26/10/2026): pegar el alta (#ALTA o formato libre), vista previa, OK / NO de Verificaciones, datos del closer y "Hecho a mano". Va ANTES que `/clientes/*`. Adentro, la página exige closer o aprobador: aprueban solo RESPONSABLE_HUB, CSM, COORDINACION y COORDINACION (por su mail, `lib/bot/alta/despacho/aprobadores.ts`); un closer carga y completa SUS altas. Ver `docs/BOT-ALTA-CJ.md`, "Altas desde el Despacho". |
| `/clientes/edicion/*` | Edición (pestaña de Clientes) | socio (y quien la tenga en Configuración) | Antes `/edicion` (redirige con 308). Va ANTES que `/clientes/*` en `REGLAS`: pide Edición, no la Cartera. Tablero de grabación y edición de videos (reemplaza la lista "Sistema de Edición" de ClickUp): crudos y su cobertura, check de COORDINACION, cola de EDITOR, notas por segundo, envío al cliente, seguimiento e01, ficha de marca y vínculos de carpetas. Adentro, el rol de edición (COORDINACION, RESPONSABLE_HUB, EDITOR o solo lectura) sale de `EDICION_REVISOR_AYLU`, `EDICION_REVISOR_TOMAS` y `EDICION_EDITOR_RENE` (`lib/edicion/permisos.ts`). EDITOR entra con un acceso [edicion], sin Clientes. Ver `docs/edicion/PANTALLA.md`. |
| `/guiones/*` | Guiones (pestaña de Clientes) | socio (y quien la tenga en Configuración) | La ruta no se movió con el hub (25/10/2026) y no tiene redirección. Tracker de grabaciones y guiones de clientes (antes dentro del Resumen). El listado lee `/api/raw` (en la práctica, solo socio). `/guiones/[id]` es la verificación de la tanda de guiones del bot (RESPONSABLE_HUB o REVISOR_GUIONES editan, aprueban o regeneran) y lee su propia base: anda con la sección Guiones sola. Ver `docs/BOT-GUIONES-CJ.md`. |
| `/api/guiones/*` | Guiones | socio (y quien la tenga en Configuración) | La usa `/guiones/[id]` (`POST /api/guiones/[id]`: editar, aprobar, regenerar). Mismo origen; aprobar, solo los revisores (`KICKOFF_REVISOR_TOMI` / `GUIONES_REVISOR_FAUS`). El Bearer no sirve acá. |
| `/configuracion/*` | Configuración | solo administradores | Alta, cambio y baja de accesos (ver "Accesos desde Configuración"). La sección no se puede asignar a mano: la ven los socios de la lista fija de Vercel y las personas de tipo "Administrador". |
| `/ventas/*` | Ventas | socio, closer y setter | CRM de ventas integrado (docs/CRM-VENTAS-INTEGRADO.md): Mi día, ficha del lead (`/ventas/lead/...`), guía y tablero. Closer y setter ven solo las pestañas que el socio les asignó en `AUTH_VENTAS_PESTANAS` (sin asignación, un aviso). `/ventas/admin` y el cambio de closer son solo del socio. Las escrituras a la planilla original están bloqueadas salvo `PERMITIR_ESCRITURA_ORIGINAL=si`. |
| `/cuotas/*` | Cobro de cuotas | socio y closer (y quien la tenga en Configuración) | Planes de pago de ventas nuevas (base Neon). Sección propia de la barra desde el 10/10/2026; `/ventas/cuotas` redirige acá. Cada closer ve solo sus planes. |
| `/trazabilidad/*` | Trazabilidad | socio (y quien la tenga en Configuración) | Cierres del CRM con su contexto de setting (botonera), su llamada (Fathom) y los reportes mensual y semanal. Base Neon. Ver `docs/TRAZABILIDAD.md`. |
| `/backend/*` | Clientes | socio y CSM (quien ve Clientes) | **Retirada el 10/10/2026**: redirige a `/clientes?renovacion=1`. Los cobros pasaron a Cobro de cuotas; las renovaciones y llamadas de proyección se marcan en Clientes. |
| `/clientes/edicion/*` y `/clientes/referidos/*` | — | — | Ver sus filas: son pestañas del hub Clientes con su propia sección. |
| `/clientes/*` | Clientes (pestaña Cartera) | socio y csm | La Cartera (`/clientes`, muestra cobros) y la ficha `/clientes/<id>` con su kickoff. Ninguna otra pestaña del hub la habilita. Quien no la tiene pero ve otra pestaña va a su primera pestaña (`destinoSinPermiso`, `lib/auth/hubClientes.ts`). |
| `/api/clientes/altas` | Cargar alta | socio (y quien la tenga en Configuración) | `POST` multipart de «Cargar alta» (`lib/bot/alta/despacho/acciones.ts`): mismo origen y quién puede qué (cargar, aprobar, completar datos, a mano). El Bearer no sirve acá. |
| `/api/clientes/*` | Clientes | socio y csm | La usa la ficha de kickoff (`/clientes/[id]/kickoff` → `POST /api/clientes/[id]/kickoff`: tildes del portfolio y aprobación de ideas; ver `docs/BOT-KICKOFF-CJ.md`). El Bearer no sirve acá. |
| `/api/edicion/*` | Edición | socio (y quien la tenga en Configuración) | La usa la pantalla `/clientes/edicion` (la API no se movió) (`POST /api/edicion`: acciones; `POST /api/edicion/pedido`: el pedido del cliente con Claude). Mismo origen, JSON de hasta 8.000 caracteres y validación estricta; el rol sale de la sesión. El Bearer no sirve acá. |
| `/api/referidos` | Referidos | socio y csm | POST "Registrar referido": una fila "Presentado" en la pestaña Referidos. Mismo origen obligatorio, JSON, validación en servidor. Sin Bearer. Escribe solo con `CRM_ESCRITURA_REFERIDOS=real`; sin esa variable queda en modo de revisión (no guarda). |
| `/api/referidos/canje` | Referidos | socio y csm | POST: **simula** un canje de créditos contra la renovación (meses y USD por separado). Mismo origen, JSON, validación en servidor. Sin Bearer. No escribe nada: con `CRM_ESCRITURA_CANJE=real` responde 503 (escritura bloqueada sin Postgres y sin escritor del libro). |
| `/api/notificaciones/*` | Marco del Despacho | cualquiera con sesión | GET `/api/notificaciones?desde=<id>`: las notificaciones de esa persona (por mail o por sección), para el aviso con sonido y el menú rápido del Hub (27/10/2026). POST `/api/notificaciones/[id]` `{ accion: 'vista' \| 'hecha' }`: mismo origen; la ruta controla que sea de esa persona. Sin Bearer. |
| `/api/presencia` | Marco del Despacho | cualquiera con sesión | POST cada 45 s con la pestaña visible (mail, nombre, sección); GET con los conectados de los últimos 2 minutos: los ve todo el equipo (decisión de RESPONSABLE_HUB, 27/10/2026). Sin Bearer. |
| `/clientes/referidos/*` | Referidos (pestaña de Clientes) | socio y csm | Antes `/referidos` (redirige con 308, con subrutas y query). Va ANTES que `/clientes/*` en `REGLAS`. |
| `/sistema/*` | Resumen | socio | Revisión de marca. Solo existe en desarrollo (en producción da 404). |
| (cualquier otra) | — | cualquier rol con sesión | Ruta no declarada: cerrada hasta que se declare en `REGLAS`. |

El acceso por Bearer es solo por encabezado (`?key=` no abre estas tres rutas, porque la clave quedaría en los logs) y se compara en tiempo constante. En `/api/raw`, `/api/metrics` y `/api/ads` la verificación se hace dos veces: en el proxy y de nuevo adentro de cada ruta (`exigirAccesoApi`, en `lib/auth/acceso.ts`), por si el proxy no corriera.

### Qué cambió para quien ya usaba estas rutas

- **Verificar producción con `curl`**: `curl -H "Authorization: Bearer $CRON_SECRET" ${AUTH_BASE_URL}/api/raw`. `scripts/audit.mjs` ya manda el Bearer (lo lee de `.env.local`).
- **Los links "Dashboard" de los mensajes de Discord** apuntan a `/`: ahora abren el login y, con la matriz actual, solo el socio ve el Resumen. Closers, setters y CSM caen en su sección. Decidir si se les da acceso al Resumen o si se cambia el link (ver Pendientes).
- **Una sesión de 7 días vencida con el Resumen abierto**: en el siguiente refresco (cada 2 minutos, con la pestaña visible) las rutas de datos responden `401` y la página lleva sola a `/entrar?next=/`; al entrar vuelve al Resumen. Antes ignoraba el `401` y dejaba los datos congelados (y hasta marcaba "actualizado"). La lógica está en `lib/auth/datosResumen.ts` y `app/page.tsx` la usa en sus tres lecturas. Una pantalla fija sin teclado no puede completar el login con Google (ver Pendientes).
- **Una dirección que no existe** muestra un 404 en español, con los colores del Manual pero con estilos en línea y tipografía del sistema (`app/not-found.tsx`). No usa `cj.css` ni las fuentes de la marca a propósito: ese archivo cuelga del layout raíz, y lo que importe se cargaría en todas las páginas. (Finanzas y Anuncios, en cambio, sí llevan la marca, a propósito: ver "Finanzas y Anuncios dentro del marco".)

### Cómo se probó

`scripts/test-rutas.mjs` reproduce el recorrido real de una petición: compila el `matcher` de `proxy.ts` con el mismo código de Next, y si deja pasar la ruta llama a `proxy()` con una `NextRequest`. Cubre cada ruta y cada rol, los consumidores externos (los crons de `vercel.json`, el webhook, el EOD de Make, el video), el Bearer correcto y los incorrectos, y los casos de borde de la URL: barra final, mayúsculas, barras dobles, `%2F`, `%5C`, `%00`, doble codificación, `./`, `../`, `x-middleware-subrequest` y otros encabezados de bypass, `?key=`, sufijos `.rsc` y `.json`. Además se probó contra un servidor de desarrollo real, con `curl --path-as-is` (para que no normalice la ruta) y con el navegador integrado.

## Matriz de roles

Borrador vigente, a confirmar. Vive en un solo lugar: `lib/auth/roles.ts` (`MATRIZ_ROLES`).

| Sección | Ruta | socio | csm | closer | setter |
|---|---|---|---|---|---|
| Resumen | `/` | sí | no | no | no |
| Guiones (pestaña de Clientes) | `/guiones` | sí | no | no | no |
| Edición (pestaña de Clientes) | `/clientes/edicion` | sí | no | no | no |
| Ventas | `/ventas` | sí | no | sí | sí |
| Cobro de cuotas | `/cuotas` | sí | no | sí | no |
| Clientes · Cartera | `/clientes` | sí | sí | no | no |
| Referidos (pestaña de Clientes) | `/clientes/referidos` | sí | sí | no | no |
| Cargar alta (pestaña de Clientes) | `/clientes/altas` | sí | no | no | no |
| Finanzas | `/finanzas` | sí | no | no | no |
| Anuncios (pestaña de Clientes) | `/anuncios` | sí | no | no | no |

Quien pide una sección que no puede ver va a la primera que sí: socio a Resumen, csm a Clientes, closer y setter a Ventas.

Finanzas y Anuncios figuran en la matriz solo para decidir quién ve el enlace en la navegación. **Entrar de verdad lo decide únicamente su clave propia** (ver "Clave propia"): no se mira la sesión de Google ni el rol, así que quien tenga la clave entra aunque no sea socio, y también sin haber iniciado sesión. Decisión pendiente: ver Pendientes.

## Desarrollo local

- **Sin Google:** definir `CRM_DEV_ROL` (`socio`, `closer`, `csm` o `setter`) en `.env.local`. Con `CRM_DEV_ROL=acceso` se eligen las secciones con `CRM_DEV_SECCIONES` (por ejemplo `edicion` para ver lo que ve EDITOR; nunca `configuracion`). Da un usuario de prueba, solo a peticiones desde esta compu (host `localhost`, `127.0.0.1` o `[::1]`). Nunca existe en producción ni en los preview de Vercel. El proxy y las páginas lo tratan igual (misma función, `sesionDePrueba` en `lib/auth/identidad.ts`). Con el usuario de prueba la navegación no muestra el nombre ni "Salir": no hay sesión que cerrar.
- **Probar el proxy como visitante:** con `CRM_DEV_ROL` definido, `localhost` siempre entra. Para ver lo que vería alguien sin sesión, pedir con otro host: `curl -H 'Host: 192.168.0.15:3101' http://127.0.0.1:3101/`.
- **Con login real:** definir las cinco variables de arriba (con `AUTH_BASE_URL=http://localhost:3101`) y la URI de retorno local en la credencial de Google. Si hay sesión real, manda sobre `CRM_DEV_ROL`.

## Archivos

| Qué | Dónde |
|---|---|
| Cookies firmadas (HMAC, vencimiento, Set-Cookie) | `lib/auth/cookie.ts` |
| Lista de personas (`AUTH_USUARIOS`) | `lib/auth/usuarios.ts` |
| OIDC con Google (URL, canje, validación del `id_token`) | `lib/auth/google.ts` |
| Destino posterior al login, sin redirección abierta | `lib/auth/destino.ts` |
| Flujo de inicio, retorno y salida | `lib/auth/flujo.ts` |
| De la cookie a la persona (parte pura) y sesión de Next | `lib/auth/identidad.ts`, `lib/auth/sesion.ts` |
| Roles y matriz | `lib/auth/roles.ts` |
| Tabla de rutas (quién entra a cada URL) | `lib/auth/rutas.ts` |
| Sesión de la petición, Bearer y segunda barrera de las rutas `/api` | `lib/auth/acceso.ts` |
| Qué hace el navegador con un `401` de las rutas de datos del Resumen (al login y vuelta) | `lib/auth/datosResumen.ts` |
| Primera barrera (aplica la tabla) | `proxy.ts` |
| Navegación con nombre, rol y "Salir"; marco compartido y marco opcional | `components/shell/Navegacion.tsx`, `components/shell/MarcoShell.tsx`, `components/shell/MarcoOpcional.tsx` |
| Rutas | `app/api/auth/google/route.ts`, `app/api/auth/google/callback/route.ts`, `app/api/auth/salir/route.ts` |
| Pantalla de ingreso | `app/entrar/page.tsx` |
| Tests | `scripts/test-auth-google.mjs`, `scripts/test-rutas.mjs` |

`/api/auth/salir` solo acepta POST (un GET no hace nada, para que ningún enlace o imagen de otro sitio pueda cerrar la sesión) y rechaza POST de otro origen. El botón "Salir" de la navegación es un formulario común que hace ese POST (anda sin JavaScript), de 40 px de alto: al pie de la barra lateral en escritorio y a la derecha del wordmark en móvil. Junto al wordmark se muestran el nombre y el rol de la persona (el nombre sale de `AUTH_USUARIOS`).

**Finanzas y Anuncios dentro del marco (7/10/2026).** Siguen abriéndose SOLO con su contraseña (cookies `skwd_finanzas` y `skwd_anuncios`, variables `FINANZAS_PASSWORD` y `ANUNCIOS_PASSWORD`), sin pedir el login de Google: el acceso no cambió (`proxy.ts`, `lib/finanzasAuth.ts`, `lib/anuncios/auth.ts` y las rutas `/api/finanzas/*` y `/api/anuncios/*` son idénticos a lo desplegado). Lo que cambió es el aspecto: las dos pantallas (la de la contraseña y el panel) son **verdes** y, si hay una sesión de Google que puede ver la sección, se muestran **dentro del marco del dashboard** (barra lateral, nombre y "Salir"); quien entra solo con la contraseña (el media buyer, por ejemplo) las ve solas, con la misma fuente. Eso lo decide `components/shell/MarcoOpcional.tsx` desde `app/finanzas/layout.tsx` y `app/anuncios/layout.tsx`; no abre ni cierra nada. Dentro de Finanzas, "Cerrar Finanzas" borra solo `skwd_finanzas` (vuelve a pedir la contraseña, la sesión de Google sigue); en Anuncios, "cerrar Anuncios". El "Salir" del marco cierra además la contraseña de Finanzas y de Anuncios (`lib/auth/flujo.ts`), para que en una computadora compartida nadie entre directo. El tema verde: `components/finanzas/Tema.tsx` (`.fin-verde`) y `app/anuncios/layout.tsx` (`.skw`, `.anu-verde`), más las reglas `:has()` de `app/(shell)/cj.css`. Ya no existe `VolverAlMenu`.

## Tests

```
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-rutas.mjs
node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-auth-google.mjs
```

`test-rutas.mjs`: la tabla de rutas y el proxy (ver "Cómo se probó"). Comprueba también que cada patrón de `REGLAS` figure en este documento, que ninguna regla quede tapada por otra anterior, que cada página y cada ruta `/api` de `app/` esté declarada, y que lo que el `matcher` deja afuera del proxy esté abierto en la tabla (si no, sería un hueco).

`test-rutas.mjs` también cubre el Resumen con la sesión vencida: el `401` real de `/api/raw`, `/api/metrics` y `/api/ads` lleva al login con vuelta a `/`, el `403`, el `200` y los errores se leen como antes, y `app/page.tsx` no puede leer datos sin pasar por `leerJsonDeDatos`.

`test-auth-google.mjs`: el login. Usa un proveedor OIDC simulado en un servidor http local (valida `redirect_uri`, PKCE y que cada código se use una sola vez). No llaman nunca a Google. Cubren el camino feliz, state y nonce incorrectos, `aud` o `iss` incorrectos, token vencido, `email_verified` falso, cuenta no autorizada, cookie manipulada o vencida, `AUTH_SECRET` ausente o corto, `next` malicioso, reutilización del state y que `GOOGLE_TOKEN_URL` no se use en producción.

`test-pantallas.mjs` (última suite): ningún archivo del layout raíz ni el 404 importan `cj.css`, `pantallas.css` o las fuentes de la marca (Finanzas y Anuncios sí, a través de `MarcoOpcional`, a propósito); controla además que Finanzas y Anuncios se envuelvan con `MarcoOpcional`, que sus páginas no pidan sesión de Google, que `MarcoOpcional` no redirija y que el marco no deje `<main>` anidados. El 404 raíz sigue en español y sin lo que la marca prohíbe.

## Orden para publicar

El paso a paso, con los comandos y la reversa, está en `docs/RUNBOOK.md`. Lo que hay que tener presente de este acceso:

1. **Primero las variables y la credencial, después el deploy.** Sin `AUTH_SECRET`, `AUTH_USUARIOS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `AUTH_BASE_URL` (con https y sin barra final), todo el sitio queda cerrado, también `/` para el socio: `/entrar` dice "Acceso no configurado". La URI `/api/auth/google/callback` tiene que estar cargada en la credencial de Google antes.
2. **Desplegar desde la carpeta de producción** (`dashboard-metricas`, que tiene `.vercel` y está vinculada al proyecto), nunca desde `dashboard-unificado`: esta copia no tiene `.vercel`, y `vercel deploy` desde acá pediría crear otro proyecto en lugar de actualizar el actual.
3. **Repetir el diff contra producción justo antes** (bloque 3.3 del plan). `lib/eodSetter.ts` y `scripts/test-eod.mjs` ya están igual que producción (con el texto "Recursos enviados por outbound de historias" del EOD de Maite); si otra sesión los vuelve a cambiar, el bloque lo marca como conflicto y frena.
4. **Confirmar `CRON_SECRET` en Production.** Las tres rutas de cron que antes quedaban abiertas sin secreto (`/api/resumen-diario`, `/api/recordatorio-formularios`, `/api/reporte-enrutamiento`) ahora responden `401` si falta. Se infiere que existe (los crons de `agenda-slots`, `analista` y `finanzas-cierre` ya fallan cerrados y se probaron en producción), pero no se pudo leer el panel. Si faltara, no saldrían el resumen de las 8:00, el reporte de las 8:05 ni el recordatorio de los días 1 y 15.
5. **Los despliegues de vista previa no inician sesión** (Google solo conoce la URI de `AUTH_BASE_URL`) y las variables van solo en Production. Entrar por un host distinto de `AUTH_BASE_URL` (por ejemplo un alias de `*.vercel.app`) tampoco anda: el botón "Salir" da `403` porque el `Origin` no coincide. Usar siempre el dominio principal.
6. **Con el login sin configurar, el Bearer `CRON_SECRET` sigue abriendo `/api/raw`, `/api/metrics` y `/api/ads`** (es acceso de máquina, no de personas). Los crons, el webhook de Calendly y el video no dependen del login.

## Pendientes

### Decisiones que son del usuario (no se cambiaron)

Ordenadas por impacto. Cada una trae la recomendación.

- **RESUELTO (7/10/2026): el socio aterriza en `/`, el Resumen, dentro del shell** (`app/page.tsx` llama a `exigirAcceso('resumen')` y renderiza `components/ResumenDashboard.tsx` envuelto en el layout del shell: barra lateral en escritorio, navegación de 3 columnas en móvil y "Salir"). El Resumen arranca en su tema oscuro (el que combina con el shell); el botón lo pasa a claro y "Descargar PDF" siempre imprime en claro. Al salir del Resumen se quita el `data-theme` de `<html>`. Falta solo decidir si más adelante se rediseña el Resumen con la marca nueva.
- **Finanzas dice "solo socio" en la matriz pero se abre con su clave, sin sesión de Google ni rol.** Hoy un closer, CSM o setter con la clave entra, y alguien sin login también. Lo mismo `/anuncios` con la suya (y `/api/anuncios` con `Bearer CRON_SECRET`). Recomendación: antes de exigir además la sesión (regla `google` con `seccion: 'finanzas'` delante de la clave, en `lib/auth/rutas.ts`), confirmar si hay alguien que hoy entra solo con la clave (el media buyer entra a Anuncios así). Si la clave va a seguir siendo el único control, aclararlo en la matriz. (7/10/2026: se mantuvo así a propósito al integrarlas al marco; ver "Finanzas y Anuncios dentro del marco").
- **RESUELTO (7/10/2026): Finanzas y Anuncios en verde y dentro del marco.** Se abren con su contraseña como siempre; con sesión de Google se ven dentro del marco del dashboard (ver "Finanzas y Anuncios dentro del marco"). Queda pendiente solo decidir si más adelante conviene exigirles además la sesión de Google de un socio (dejaría afuera a quien hoy entra solo con la clave).
- **El link "Dashboard" de los mensajes de Discord apunta a `/`** (`lib/discord.ts`, `app/api/analista`). Con la matriz actual solo el socio ve el Resumen: closers, setters y CSM que lo abren caen en su sección. Decidir entre darles acceso al Resumen (`MATRIZ_ROLES`) o cambiar el link. Los links viejos con `/api/raw?key=` o `/api/ads` sin Bearer ahora reciben `401`.
- **Pantallas fijas e iframes.** No se relevó si alguien deja `/` en una pantalla sin teclado (no puede hacer el login con Google, y con la sesión vencida la página ahora la lleva a `/entrar`) o la embebe en un iframe (la cookie `SameSite=Lax` no viaja entre sitios). Confirmar con el equipo antes de publicar.
- **`/api/clientes/*`** están publicadas, con sesión y rol (desde los deploys de la carpeta completa, la decisión D3 del plan de publicación quedó atrás). `/api/clientes` y `/api/clientes/[id]` todavía no las usa ninguna pantalla; `/api/clientes/[id]/kickoff` sí (ficha de kickoff, 24/10/2026) y tiene que salir junto con la pantalla `/clientes/[id]/kickoff`.
- **Lista real de `AUTH_USUARIOS` y matriz de roles.** Hoy solo el socio ve `/`. Quienes abren links "Dashboard" y no figuran en ninguna sección (closers, setter, media buyer, quien lleve Finanzas) caen en su sección o en el login.

### Endurecimientos que quedaron afuera (no son parte de este cambio)

- **Freno de fuerza bruta de Finanzas.** Vive en la memoria de cada instancia (`lib/finanzasAuth.ts`), poco confiable en serverless, y la clave local es corta. Ya era así antes del login de Google. Recomendación: una clave de 20 caracteres o más, o llevar el contador a un almacén compartido.
- **`exigirAcceso` sin `next`.** El proxy ya redirige a `/entrar?next=<ruta>`, pero la redirección de `exigirAcceso` (la segunda barrera, en cada página) todavía manda a `/entrar` a secas. Solo se ve si el proxy no corriera.
- **RESUELTO (7/10/2026): `/finanzas` ya no necesita "Volver al menú":** con sesión de Google se muestra dentro del marco, que trae el menú. Sin sesión de Google queda sola (como antes para quien entra solo con la clave).
- **Escenarios de Make y flujos de ManyChat sin relevar** (Make pidió autenticación en esa sesión). Las rutas que podrían llamar están excluidas del proxy, así que no se rompen; el riesgo sería que algo llame a `/`, `/api/raw`, `/api/metrics` o `/api/ads`, y no hay indicio de eso.

### Antes de apretar el botón

- **Cargar las variables en Vercel** (solo los valores, nunca en el código): las cinco de arriba y la URI de retorno en la credencial de Google. Confirmar que `CRON_SECRET` y `EOD_KEY` existan en Vercel (se infiere de que los crons funcionan, pero no se pudo leer).
- **Archivos que esta etapa tocó y que también existen en producción:** `proxy.ts` (reescrito, con el bloque de Finanzas intacto), `app/api/raw/route.ts`, `app/api/metrics/route.ts` y `app/api/ads/route.ts` (5 líneas cada uno), `app/api/resumen-diario/route.ts`, `app/api/recordatorio-formularios/route.ts` y `app/api/reporte-enrutamiento/route.ts` (una línea cada una: fallan cerradas sin `CRON_SECRET`), `app/anuncios/layout.tsx` (reescrito el 7/10 para el tema verde y el marco opcional), `app/page.tsx` (un import, una constante y tres lecturas de datos: el manejo del `401`; el archivo que más editan otras sesiones, así que el bloque 3.3 del plan lo va a marcar como conflicto si cambió en producción), `scripts/audit.mjs` y `PROMPT_EMBUDO.md` (para mandar el Bearer). `app/globals.css` y `app/finanzas/` se tocaron después (tema y marco, 7/10/2026): no cambian el acceso.
- **Verificar después del deploy**: `curl -I ${AUTH_BASE_URL}/v/<ID_PRIVADO_CONFIGURADO>.mp4` (200 sin cookie; el archivo viaja en `public/v`), que el cron de la mañana y el EOD de las 23:59 sigan corriendo (el texto nuevo del EOD: "Recursos enviados por outbound de historias"), y que Calendly no marque el webhook como fallido.


## Accesos desde Configuración (8/10/2026)

Además de la lista fija `AUTH_USUARIOS` (Vercel), ahora hay una pantalla **Configuración** (`/configuracion`, solo administradores) para agregar gente sin tocar Vercel. Dos tipos de acceso:

- **Acceso:** el administrador marca qué secciones ve (Resumen, Guiones, Edición, Ventas, Cobro de cuotas, Clientes, Referidos, Finanzas, Anuncios) y, si tiene Ventas, qué pestañas del CRM (Closer 1, Closer 2, Closer 3, OPERADOR_AUTORIZADO-OPERADOR_AUTORIZADO Rejunte). Finanzas y Anuncios siguen pidiendo su propia contraseña. Sin ninguna sección marcada no se guarda. Backend ya no se ofrece (se retiró el 10/10/2026); si una fila vieja de la planilla la tiene, se ignora. Cobro de cuotas muestra los planes de la pestaña de cada closer. Quien la tiene **sin Ventas** (y sin pestaña, sin ser administrador) ve y gestiona **solo los planes de Administración** (decisión de RESPONSABLE_HUB, 10/10/2026; `sesionActual` en `lib/crm/auth.ts`), sin el botón de la guía de Ventas. Con Ventas y sin pestaña, `/cuotas` lo manda a `/ventas`, que explica el "sin CRM asignado". `rutaSinCRM` (`lib/auth/roles.ts`) nunca redirige a la misma sección pedida (antes era un bucle).
- **Administrador:** ve todo y es el único que entra a Configuración.

**Dónde se guarda:** una planilla de Google ("Capital Jurídico – Accesos", hojas `Accesos` e `Historial`) compartida como **Editor** con la cuenta de servicio, cuyo id va en la variable `SHEET_ID_ACCESOS` (Production). La baja no borra la fila: pone Activo = no. `Historial` registra cada alta, cambio y baja con quién y cuándo. El código habla con Google por REST (`lib/auth/googleRest.ts`, sin la librería `googleapis`) para no demorar el proxy.

**Cómo se decide quién entra:** la lista fija de Vercel **siempre manda** (esos socios son administradores de respaldo y no se tocan desde la pantalla). Las personas de la planilla se leen con caché de 60 s (`lib/auth/accesos.ts`); si Google falla se usa lo último leído y, sin eso, solo entran los de la lista fija (falla cerrado para los de la planilla). Rige en menos de un minuto, sin redesplegar. La cookie sigue siendo solo identidad (el mail); los permisos salen de la lista en cada petición. Rol interno `acceso` = matriz base vacía: una persona sin secciones no ve nada.

**Protecciones:** solo un administrador puede invocar las acciones (se comprueba en el servidor, no solo en la página); nadie puede quitarse el acceso a sí mismo; el rol `acceso` nunca recibe Configuración; un mail repetido vale por su última fila. Guardar y quitar escriben en el número de fila real de la persona aunque arriba haya filas vacías o inválidas (antes se corría y la baja caía en otra fila).

Archivos: `lib/auth/accesos.ts` (planilla), `accesosModelo.ts` (validación y lectura de filas), `googleRest.ts`, `accionesAccesos.ts` (acciones), `app/(shell)/configuracion/*`, `scripts/test-accesos.mjs`.

## Dos direcciones: Despacho y la dirección vieja (8/10/2026)
El sistema se llama **Despacho · Capital Jurídico** y su dirección es `${AUTH_BASE_URL}/` (`AUTH_BASE_URL`; la URI de
retorno `…/api/auth/google/callback` está registrada en el cliente OAuth junto a la vieja). `dashboard-metricas-eight.vercel.app` **sigue viva**: Make, los
crons, el webhook de Calendly, el video de 2Chat y los enlaces de Discord le pegan. `lib/auth/anfitrion.ts` (llamado desde `proxy.ts`) manda por 307 a la
dirección nueva solo las **páginas** que abre una persona (y el inicio/retorno del login); todo `/api/*` de máquina, `/v/`, el manifiesto, `/pwa/` y `/marca/`
se quedan como estaban. La sesión, la contraseña de Finanzas y la de Anuncios son por dirección: quien entraba por la vieja tiene que entrar una vez más por
la nueva (y reinstalar la app si la había instalado). Si hubiera que volver atrás: `AUTH_BASE_URL` = la dirección vieja y redesplegar (la redirección se apaga sola).

## Administradores sin contraseña en Finanzas y Anuncios (8/10/2026)
Pedido de RESPONSABLE_HUB: un **administrador** con sesión de Google válida (socio de la lista fija `AUTH_USUARIOS` o "Administrador" de la planilla de Accesos)
entra a `/finanzas` y `/anuncios` sin que le pidan la contraseña. Todos los demás (closer, csm, setter, acceso por secciones y quien entra solo con la clave,
como el media buyer) siguen igual que antes. Las contraseñas no cambiaron. Código: `lib/auth/llaveAdmin.ts` (`esAdministrador`, `adminPorCabeceras`) y
`lib/auth/llaveAdminPagina.ts` (`adminEnPagina`), consultados en `proxy.ts`, `app/finanzas/page.tsx`, `app/finanzas/login/page.tsx`, `app/api/finanzas/route.ts`,
`app/anuncios/page.tsx`, `app/anuncios/login/page.tsx` y las rutas `app/api/anuncios/{route,recuento,reporte-pdf,optimizar}`. Pruebas: `scripts/test-llave-admin.mjs`
y `scripts/test-rutas.mjs`. `<EMAIL_PRIVADO_CONFIGURADO>` quedó también como "admin" en la planilla de Accesos (la lista fija de Vercel es sensible y no se puede leer).

## Edición (24/10/2026)

Sección nueva `edicion` (`/edicion` y `/api/edicion/*`; desde el 25/10/2026 la pantalla es la pestaña `/clientes/edicion`), asignable desde Configuración como cualquier otra. El socio la ve sola.

- **Quién entra:** los socios y quien la tenga marcada. EDITOR (editor) entra con una fila de tipo "acceso" con **solo [edicion]**: no tiene Clientes (la ficha muestra cobros), así que la pantalla nunca le arma links a `/clientes` y en Edición no aparece ningún cobro.
- **COORDINACION (CSM) necesita Edición y el rol `csm` no la tiene:** si figura en `AUTH_USUARIOS` como `csm`, desde Configuración no se le puede sumar (la lista fija manda). Hay que sacarla de `AUTH_USUARIOS` y cargarla como "acceso" con Clientes, Referidos y Edición (ver el checklist de `docs/BOT-EDICION-CJ.md`).
- **Qué hace cada uno adentro** (el rol sale de la sesión, nunca del pedido; `lib/edicion/permisos.ts`):
  - **COORDINACION** (`EDICION_REVISOR_AYLU`): revisa crudos (e04), deja notas (f03), manda al cliente, carga la marca, confirma vínculos, marca los pasos del seguimiento;
  - **RESPONSABLE_HUB** (`EDICION_REVISOR_TOMAS`; si falta, `KICKOFF_REVISOR_TOMI`): lo de COORDINACION, más la 3.ª ronda del cliente (P6), la decisión del día 9 y reabrir;
  - **EDITOR** (`EDICION_EDITOR_RENE`): su cola, listo, corregido, tildar notas, aceptar el editado que propone el bot y marcar un bloqueo "otro" con motivo;
  - **cualquier otra persona con la sección:** solo lectura (los socios ven además las grabaciones pendientes).
- En producción el rol sale solo del mail exacto (varios separados por coma). Sin la variable, o con un mail en dos listas, es solo lectura: falla cerrado. Fuera de producción vale el nombre o el apellido como palabra entera. El usuario de prueba (`CRM_DEV_ROL`) nunca escribe.
- Las rutas del bot (`/api/bot/grabacion/vigia`, `/transcripcion` y `/diario`) se autentican solas (ver "Automatización") y están fuera del proxy.


## Clientes como hub (25/10/2026)

Guiones, Edición, Anuncios y Referidos dejaron de ser entradas sueltas del menú: son **pestañas dentro de Clientes**. El menú queda en Resumen, Clientes, Ventas, Cobro de cuotas, Trazabilidad, Finanzas y Configuración. **Los permisos no cambiaron**: cada pestaña pide la misma sección de antes y las claves de la planilla de Accesos (`clientes`, `guiones`, `edicion`, `anuncios`, `referidos`) siguen valiendo tal cual. Todo vive en `lib/auth/hubClientes.ts`.

| Pestaña | Ruta | Sección | Notas |
|---|---|---|---|
| Cartera | `/clientes` (y la ficha `/clientes/<id>`) | `clientes` | Muestra cobros. Barreras: `(cartera)/layout.tsx` y `[id]/layout.tsx`. |
| Guiones | `/guiones` (y `/guiones/<id>`) | `guiones` | No se movió: `/guiones/[id]` anda con la sección Guiones sola (REVISOR_GUIONES). |
| Edición | `/clientes/edicion` | `edicion` | Antes `/edicion`: redirección 308 con subrutas y query. |
| Anuncios | `/anuncios` | `anuncios` | No se movió: sigue con su clave propia, sin Google (ADS). Con sesión de Google se dibujan las pestañas arriba; con la clave sola, solo el tablero. |
| Referidos | `/clientes/referidos` | `referidos` | Antes `/referidos`: redirección 308 con subrutas y query. |

- **Quién ve qué:** solo las pestañas de sus secciones. "Clientes" aparece en el menú con al menos una y lleva a la **primera permitida** (EDITOR, con solo `[edicion]`, va directo a `/clientes/edicion` y ve únicamente esa pestaña; REVISOR_GUIONES, con solo `[guiones]`, a `/guiones`). Nadie gana la Cartera por tener otra pestaña. Sin ninguna, no hay Clientes en el menú.
- **Sin permiso para una pestaña:** el proxy y `exigirAcceso` mandan a la primera pestaña permitida (`destinoSinPermiso`), no fuera de Clientes.
- **Redirecciones:** `next.config.ts` (`REDIRECCIONES_HUB`), 308 permanentes, corren antes que el proxy. Cubren los links viejos de los avisos de Discord de Edición; los avisos nuevos ya salen con `/clientes/edicion/…`. Las API (`/api/edicion/*`, `/api/referidos*`, `/api/guiones/*`, `/api/anuncios/*`) no cambiaron.
- **La ficha** muestra accesos rápidos a lo de ese cliente en las otras pestañas (Kickoff, Guiones, Edición), solo los que la persona tiene.
- **Configuración** nombra las secciones del hub como "Clientes · Cartera", "Clientes · Guiones", etc. (solo cambia el texto).
- Tests: `scripts/test-nav.mjs` (menú, pestañas, pestaña por defecto, barrido sin Cartera), `scripts/test-rutas.mjs` (reglas, carpetas estáticas frente a `[id]`, redirecciones, Anuncios con clave) y `scripts/test-accesos.mjs` (EDITOR, REVISOR_GUIONES y las claves de la planilla).

### Hub completo — acciones, entregas y seguimiento (28/10/2026)

- `/api/clientes/inactivos`: lectura con Clientes o cron CRON_SECRET; POST sólo aprobadores por mail, mismo origen. Alerta interna por tres días sin respuesta, sin WhatsApp al cliente.
- `/clientes/entregas` y `/api/clientes/entregas`: Clientes y destinatarios autorizados (COORDINACION, COORDINACION, RESPONSABLE_HUB); registrar entrega no envía WhatsApp.
- Acciones de cliente: idempotencia y revisión previa; pagos y precios de renovación requieren Finanzas. Los archivados se conservan para restaurar y quedan fuera de la cartera activa.
| `/api/clientes/sincronizar` | Cron diario con `Bearer CRON_SECRET` | Recupera pedidos durables y meses de referidos; actualiza avisos internos. No crea pedidos nuevos. |
| `/api/clientes/inactivos/cron` | Cron diario con `Bearer CRON_SECRET` | Alerta interna cada tres días sin respuesta. No envía mensajes al cliente. |
