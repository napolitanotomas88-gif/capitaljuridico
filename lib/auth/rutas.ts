// ── Tabla de rutas: quién entra a cada URL ──────────────────────────────────────────────────
// ÚNICO lugar donde se decide el acceso por URL. Lo usa proxy.ts (primera barrera) y lo prueba scripts/test-rutas.mjs.
// Para auditar el acceso de un vistazo alcanza con leer REGLAS. La explicación larga y la tabla para personas está en
// docs/ACCESO-Y-ROLES.md (un test controla que cada patrón figure ahí).
//
// Cómo se lee:
//   · Se evalúan en orden y gana la primera regla que coincide. Lo que no coincide con ninguna cae en POR_DEFECTO:
//     sesión de Google (cualquier rol). Una ruta nueva queda CERRADA hasta que alguien la declare acá.
//   · Patrón: ruta exacta ("/api/raw") o prefijo por segmentos ("/clientes/*" coincide con /clientes y /clientes/x,
//     pero no con /clientesx). La comparación es sin mayúsculas, sin barra final y con las barras dobles juntadas.
//   · Una ruta ambigua (%2F o %5C, doble codificación, "." o "..", caracteres de control) NUNCA cuenta como abierta:
//     las reglas "publico" y "propio" se saltean y se aplica la protección que le toque. Falla cerrado.
//   · En las rutas /api el rechazo es 401 o 403 en JSON (nunca redirección: un fetch() no tiene que seguir hasta una
//     página HTML). En las páginas, sin sesión se redirige a /entrar?next=<ruta> y sin permiso a la primera sección del rol.
// Sin imports de Next: se prueba con node:test.
import { puedeVer, rutaInicial, type Rol, type Seccion } from './roles'
import { rutaInternaSegura } from './destino'
import { destinoSinPermiso } from './hubClientes'

export type Quien =
  /** Cualquiera: login y estáticos. El proxy no mira nada de la petición. */
  | 'publico'
  /** Se autentica sola (cron con CRON_SECRET, webhook con firma, clave propia del tablero): el proxy no interviene. */
  | 'propio'
  /** Contraseña de Finanzas (cookie skwd_finanzas): se conserva el bloque original de proxy.ts, sin cambios. */
  | 'finanzas'
  /** Sesión de Google. Si la regla trae "seccion", el rol tiene que poder verla (puedeVer). */
  | 'google'
  /** Igual que "google", o bien "Authorization: Bearer <CRON_SECRET>" (scripts y verificaciones, nunca ?key=). */
  | 'google_o_maquina'

export type Regla = { patron: string; quien: Quien; seccion?: Seccion; motivo: string }

export const REGLAS: readonly Regla[] = [
  // ── Públicas: sin esto nadie puede entrar o la pantalla de ingreso se rompe ───────────────────
  { patron: '/entrar', quien: 'publico', motivo: 'Pantalla de ingreso. Si exigiera sesión habría un bucle de redirecciones.' },
  { patron: '/api/auth/*', quien: 'publico', motivo: 'Inicio y retorno del login con Google y salida. Se protegen con state, PKCE y nonce.' },
  { patron: '/_next/*', quien: 'publico', motivo: 'Archivos compilados (CSS, JS, fuentes, imágenes): nunca llevan datos y /entrar los necesita sin sesión.' },
  { patron: '/favicon.ico', quien: 'publico', motivo: 'Ícono de la pestaña.' },
  { patron: '/manifest.webmanifest', quien: 'publico', motivo: 'Manifiesto de la app instalable: el navegador lo pide sin cookie. Solo nombre, colores e íconos.' },
  { patron: '/pwa/*', quien: 'publico', motivo: 'Íconos de la app instalable (también el de iOS): se piden sin cookie. Son imágenes de texto, sin datos.' },
  { patron: '/marca/*', quien: 'publico', motivo: 'Logo oficial de Capital Jurídico (SVG): lo muestra la página de acceso antes del login. Sin datos.' },
  { patron: '/v/*', quien: 'publico', motivo: 'Video del WhatsApp de confirmación: Make (6333195) y 2Chat lo descargan sin cookie.' },
  // OJO: '/bot/*' es público solo porque hoy sirve public/bot/*.jpg. No crear páginas ni rutas en app/bot/: quedarían
  // abiertas sin sesión (scripts/test-rutas.mjs falla si aparece cualquier archivo en app/bot/).
  { patron: '/bot/*', quien: 'publico', motivo: 'Fotos de la comunidad y los grupos de cada cliente (public/bot/*.jpg): Whapi las baja por URL sin cookie al crear los grupos. Solo imágenes, sin datos.' },
  { patron: '/finanzas/login', quien: 'publico', motivo: 'Pantalla de contraseña de Finanzas (igual que antes; ahora en verde y con el marco del dashboard si hay sesión de Google).' },
  { patron: '/api/finanzas/login', quien: 'publico', motivo: 'Login de Finanzas (igual que antes).' },
  { patron: '/api/finanzas/logout', quien: 'publico', motivo: 'Salida de Finanzas (igual que antes).' },

  // ── Automatización: se autentica sola, el proxy no interviene ─────────────────────────────────
  { patron: '/api/analista', quien: 'propio', motivo: 'Cron de Vercel 8:20 AR. CRON_SECRET (Bearer o ?key=), falla cerrado.' },
  { patron: '/api/resumen-diario', quien: 'propio', motivo: 'Cron de Vercel 8:00 AR. CRON_SECRET (Bearer o ?key=).' },
  { patron: '/api/recordatorio-formularios', quien: 'propio', motivo: 'Cron de Vercel los días 1 y 15. CRON_SECRET (Bearer o ?key=).' },
  { patron: '/api/reporte-enrutamiento', quien: 'propio', motivo: 'Cron de Vercel 8:05 AR. CRON_SECRET (Bearer o ?key=).' },
  { patron: '/api/agenda-slots', quien: 'propio', motivo: 'Cron de Vercel 8:10 AR y llamada interna del webhook de Calendly. CRON_SECRET, falla cerrado.' },
  { patron: '/api/finanzas-cierre', quien: 'propio', motivo: 'Cron de Vercel 10:00 AR. CRON_SECRET, 503 si falta.' },
  { patron: '/api/reporte-anuncios', quien: 'propio', motivo: 'Cron de Vercel, lunes 8:00 AR. CRON_SECRET, falla cerrado.' },
  { patron: '/api/alerta-anuncios', quien: 'propio', motivo: 'Cron de Vercel 8:45 AR. CRON_SECRET, falla cerrado.' },
  { patron: '/api/reporte-eod', quien: 'propio', motivo: 'Make 6463821 (EOD de Maite, 23:59 AR). CRON_SECRET o EOD_KEY (Bearer o ?key=).' },
  { patron: '/api/calendly-webhook', quien: 'propio', motivo: 'Calendly. Firma HMAC en Calendly-Webhook-Signature. Si falla 24 h seguidas Calendly lo deshabilita.' },
  { patron: '/api/fathom-anuncios', quien: 'propio', motivo: 'Webhook de Fathom (firma Standard Webhooks con FATHOM_WEBHOOK_SECRET) y modo manual con Bearer CRON_SECRET. Falla cerrado.' },
  { patron: '/api/bot/kickoff', quien: 'propio', motivo: 'Webhook de Fathom de las kickoffs (firma Standard Webhooks con FATHOM_KICKOFF_WEBHOOK_SECRET o FATHOM_KICKOFF_WEBHOOK_SECRET_<QUIEN>, Tomás y Gero M) y modo manual / GET de estado con Bearer CRON_SECRET. Falla cerrado.' },
  { patron: '/api/bot/kickoff/mapa', quien: 'propio', motivo: 'Zona desde el video de la kickoff (Fathom + ffmpeg + Claude). POST y GET solo con Bearer CRON_SECRET (nunca ?key=). Falla cerrado.' },
  { patron: '/api/bot/guiones', quien: 'propio', motivo: 'Etapa Guiones del bot (disparo desde la aprobación del kickoff, pasos y GET de estado). Solo Bearer CRON_SECRET (nunca ?key=): 503 sin el secreto, 401 con otro. Falla cerrado.' },
  { patron: '/api/bot/guiones/respuesta', quien: 'propio', motivo: 'Respuestas del cliente en el grupo Contenido (las reenvía el webhook de Whapi). Solo Bearer CRON_SECRET: 503 sin el secreto, 401 con otro. Falla cerrado.' },
  { patron: '/api/bot/whapi', quien: 'propio', motivo: 'Webhook de Whapi del bot de altas: header x-cj-bot-secreto (WHAPI_WEBHOOK_SECRETO, tiempo constante), solo Ventas C.J. y Verificaciones C.J; GET de estado con Bearer CRON_SECRET. Falla cerrado.' },
  { patron: '/api/bot/alta/motor', quien: 'propio', motivo: 'Motor del bot de altas: continuaciones, despertador, barrido, respuestas manuales y simulación. Solo Bearer CRON_SECRET (nunca ?key=). Falla cerrado.' },
  { patron: '/api/bot/exito', quien: 'propio', motivo: 'Etapa Éxito del bot de altas: cron diario de Vercel 10:00 AR (vence pedidos, lista de la encuesta para el OK el día 1, envío y recordatorio), ?dry=1, ?lista=1 y ?estado=1. Solo Bearer CRON_SECRET (nunca ?key=): 503 sin el secreto, 401 con otro. Falla cerrado.' },
  { patron: '/api/bot/bajas', quien: 'propio', motivo: 'Etapa Bajas del bot de altas: cron diario de Vercel 10:30 AR (aviso de fin 14 días antes, lista mensual de recontacto), ?dry=1, ?recontacto=1, ?estado=1, ?baja=ID (pide la confirmación) y ?recording_id= (Fathom). Solo Bearer CRON_SECRET (nunca ?key=): 503 sin el secreto, 401 con otro. Falla cerrado.' },
  { patron: '/api/trazabilidad/botonera', quien: 'propio', motivo: 'Botón "Enviar al Despacho" de la botonera de ManyChat (extensión de Chrome). Bearer TRAZABILIDAD_KEY, falla cerrado.' },
  { patron: '/api/trazabilidad/manychat', quien: 'propio', motivo: 'Importa a Trazabilidad las etiquetas de ManyChat de los cierres (prueba, importar, analizar). Bearer CRON_SECRET, falla cerrado.' },
  { patron: '/api/trazabilidad/semanal', quien: 'propio', motivo: 'Cron de Vercel, lunes 8:00 AR: semanal de setting a Discord. Bearer CRON_SECRET, falla cerrado.' },
  { patron: '/api/trazabilidad/procesar', quien: 'propio', motivo: 'Cron de Vercel 7:00 AR: analiza envíos de la botonera y trae llamadas de Fathom. Bearer CRON_SECRET, falla cerrado.' },
  { patron: '/api/bot/grabacion/vigia', quien: 'propio', motivo: 'Vigía de Crudos y Editados (Drive): lo dispara el Puente Drive cada 15 min con Bearer VIGIA_SECRETO, o a mano con Bearer CRON_SECRET; el GET de estado, solo con CRON_SECRET. Nunca ?key=. Falla cerrado.' },
  { patron: '/api/bot/grabacion/transcripcion', quien: 'propio', motivo: 'Webhook de AssemblyAI (transcripción terminada): cabecera X-Edicion-Secreto = ASSEMBLYAI_WEBHOOK_SECRETO, comparada en tiempo constante; sin el secreto configurado, 503. Falla cerrado.' },
  { patron: '/api/bot/grabacion/diario', quien: 'propio', motivo: 'Cron de Vercel 7:00 AR: pasada completa de Drive, guiones, seguimiento e01 y resumen para la daily de Edición. Bearer CRON_SECRET, falla cerrado.' },
  { patron: '/api/fathom-anuncios/reintentar', quien: 'propio', motivo: 'Cron de Vercel 8:30 AR: reintenta las grabaciones de Fathom en error. Bearer CRON_SECRET, falla cerrado.' },

  // ── Clave propia: el tablero de Anuncios no usa el login de Google (Valentino entra solo con la clave) ───
  { patron: '/anuncios/*', quien: 'propio', motivo: 'Tablero de anuncios: cookie skwd_anuncios (ANUNCIOS_PASSWORD), la verifica la página.' },
  { patron: '/api/anuncios/*', quien: 'propio', motivo: 'API del tablero: cookie skwd_anuncios o CRON_SECRET, la verifica cada ruta.' },

  // ── Contraseña de Finanzas: el acceso no cambió (7/10/2026 solo cambió el aspecto: verde y dentro del marco del dashboard) ──
  { patron: '/finanzas/*', quien: 'finanzas', motivo: 'Cookie skwd_finanzas (FINANZAS_PASSWORD). No se le exige además la sesión de Google: quien tiene la sesión ve el marco del dashboard (menú y Salir), quien no, solo la pantalla.' },
  { patron: '/api/finanzas/*', quien: 'finanzas', motivo: 'Igual que /finanzas, con 401 o 503 en JSON.' },

  // ── Sesión de Google ──────────────────────────────────────────────────────────────────────────
  { patron: '/api/raw', quien: 'google_o_maquina', seccion: 'resumen', motivo: 'Datos del Resumen (teléfonos de leads, pagos). Navegador, o Bearer CRON_SECRET para verificar producción.' },
  { patron: '/api/metrics', quien: 'google_o_maquina', seccion: 'resumen', motivo: 'Cuotas a cobrar y cash del mes. Navegador, o Bearer CRON_SECRET.' },
  { patron: '/api/ads', quien: 'google_o_maquina', seccion: 'resumen', motivo: 'Gasto y campañas de Meta. Navegador, o Bearer CRON_SECRET.' },
  { patron: '/', quien: 'google', seccion: 'resumen', motivo: 'Resumen (el dashboard principal). Solo socio por ahora.' },
  { patron: '/configuracion/*', quien: 'google', seccion: 'configuracion', motivo: 'Configuración: alta y baja de accesos. Solo administradores (la lista de Vercel y los "admin" de la planilla de Accesos).' },
  { patron: '/guiones/*', quien: 'google', seccion: 'guiones', motivo: 'Guiones y grabaciones de clientes (antes dentro del Resumen; el listado lee /api/raw: en la práctica, solo socio). /guiones/[id] es la verificación de la tanda de guiones del bot (Tomi o Faus editan, aprueban o regeneran): lee su propia base, así que también anda con la sección Guiones sola.' },
  { patron: '/api/guiones/*', quien: 'google', seccion: 'guiones', motivo: 'API de la pantalla /guiones/[id] (editar, aprobar, regenerar): sesión de Google con la sección Guiones y mismo origen; aprobar, solo los revisores (KICKOFF_REVISOR_TOMI / GUIONES_REVISOR_FAUS). Sin acceso por máquina.' },
  { patron: '/sistema/*', quien: 'google', seccion: 'resumen', motivo: 'Revisión de marca. Solo existe en desarrollo (en producción da 404).' },
  { patron: '/ventas/*', quien: 'google', seccion: 'ventas', motivo: 'CRM de ventas (Mi día, ficha, guía y tablero). Closer y setter ven solo las pestañas de AUTH_VENTAS_PESTANAS; el tablero /ventas/admin es solo del socio (se controla en la página). Escribe en la planilla solo con PERMITIR_ESCRITURA_ORIGINAL=si.' },
  { patron: '/cuotas/*', quien: 'google', seccion: 'cuotas', motivo: 'Cobro de cuotas (planes de pago de ventas nuevas, base Neon). Sección propia desde el 10/10/2026: socio, closer y quien la tenga en Configuración. Cada closer ve sus planes.' },
  { patron: '/trazabilidad/*', quien: 'google', seccion: 'trazabilidad', motivo: 'Trazabilidad de contenido: cierres del CRM con su setting (botonera), su llamada (Fathom) y los reportes mensual y semanal. Solo socio.' },
  { patron: '/backend/*', quien: 'google', seccion: 'clientes', motivo: 'Backend se retiró el 10/10/2026: /backend redirige a Clientes con el filtro de renovación pendiente (los cobros pasaron a Cobro de cuotas).' },
  // Clientes es un hub de pestañas (25/10/2026, lib/auth/hubClientes.ts): cada pestaña conserva el permiso de su sección.
  // Edición y Referidos van ANTES que '/clientes/*' (gana la primera que coincide): sin esto pedirían la Cartera ('clientes').
  // Las rutas viejas (/edicion, /referidos) redirigen con 308 en next.config.ts, antes de llegar al proxy.
  { patron: '/clientes/altas/*', quien: 'google', seccion: 'altas', motivo: '«Cargar alta» (pestaña de Clientes, 26/10/2026): el bot de altas sin WhatsApp (pegar el alta, vista previa, OK / NO, datos del closer, "Hecho a mano"). Closers y quien la tenga en Configuración; adentro, la página exige closer o aprobador (Tomás, Gero A, Aylu, Gero M por mail) y un closer ve solo sus altas.' },
  { patron: '/clientes/edicion/*', quien: 'google', seccion: 'edicion', motivo: 'Edición (pestaña de Clientes; antes /edicion): tablero de grabación y edición de videos (crudos, check de Aylu, cola de René, notas, envío al cliente, seguimiento). Socio y quien la tenga en Configuración (René, con [edicion] y sin Cartera).' },
  { patron: '/clientes/referidos/*', quien: 'google', seccion: 'referidos', motivo: 'Programa de referidos (pestaña de Clientes; antes /referidos).' },
  { patron: '/clientes/*', quien: 'google', seccion: 'clientes', motivo: 'Cartera de clientes (muestra cobros) y la ficha de cada cliente con su kickoff. Solo la sección Clientes: ninguna otra pestaña del hub la habilita.' },
  { patron: '/api/clientes/altas', quien: 'google', seccion: 'altas', motivo: 'API de «Cargar alta» (POST multipart): sesión de Google con la sección Cargar alta, mismo origen y quién puede qué en lib/bot/alta/despacho/acciones.ts (aprueban solo Tomás, Gero A, Aylu y Gero M). Sin acceso por máquina.' },
  { patron: '/api/clientes/inactivos', quien: 'google_o_maquina', seccion: 'clientes', motivo: 'Seguimiento de respuestas: sesión de Clientes para lectura/registro autorizado; cron con CRON_SECRET para alertas internas cada tres días, sin mensajes al cliente.' },
  { patron: '/api/clientes/inactivos/cron', quien: 'propio', motivo: 'Cron con Bearer CRON_SECRET: alertas internas por tres días sin respuesta. Sin sesión humana y sin mensajes al cliente.' },
  { patron: '/api/clientes/sincronizar', quien: 'propio', motivo: 'Cron con Bearer CRON_SECRET: confirma pedidos durables de acciones y meses de referidos; reconcilia avisos internos. Sin escritura nueva sin un pedido previo.' },
  { patron: '/api/clientes/*', quien: 'google', seccion: 'clientes', motivo: 'API de clientes. La usa la pantalla /clientes/[id]/kickoff (POST /api/clientes/[id]/kickoff: tildes del portfolio y aprobación de ideas). Sin acceso por máquina.' },
  { patron: '/api/edicion/*', quien: 'google', seccion: 'edicion', motivo: 'API de la pantalla /edicion (acciones y pedido del cliente con Claude): sesión de Google con la sección Edición, mismo origen y JSON. Sin acceso por máquina.' },
  { patron: '/api/referidos', quien: 'google', seccion: 'referidos', motivo: 'Registrar referido (POST): sesión de Google con rol que ve Referidos. Sin acceso por máquina.' },
  { patron: '/api/referidos/canje', quien: 'google', seccion: 'referidos', motivo: 'Simular canje de créditos (POST): sesión de Google con rol que ve Referidos. Sin acceso por máquina.' },
  // Marco global del Despacho (27/10/2026): la fuente única de notificaciones (la arma el Hub de Clientes) y la presencia.
  // Cualquiera con sesión: el filtro por mail o sección (notificaciones) y por rol (lista de conectados) va adentro de la ruta.
  { patron: '/api/notificaciones/*', quien: 'google', motivo: 'Notificaciones del Despacho: GET /api/notificaciones?desde=<id> (solo las de esa persona, por mail o por sección; las lee el aviso con sonido del marco y el menú rápido del Hub) y POST /api/notificaciones/[id] para marcarla vista o hecha (mismo origen; la ruta controla que sea de esa persona). Sesión de Google de cualquier rol. Sin acceso por máquina.' },
  { patron: '/api/presencia', quien: 'google', motivo: 'Quién está conectado: POST cada 45 s con la pestaña visible (registra mail, nombre y sección) y GET con los conectados de los últimos 2 min, que ve todo el equipo (decisión de Tomás, 27/10/2026). Sin acceso por máquina.' },
]

/** Lo que no coincide con ninguna regla: cerrado, con sesión de Google de cualquier rol. */
export const POR_DEFECTO: Regla = {
  patron: '(cualquier otra)',
  quien: 'google',
  motivo: 'Ruta no declarada: pide sesión de Google, cualquier rol. Hay que declararla en REGLAS.',
}

// ── Normalización ──────────────────────────────────────────────────────────────────────────
export type RutaNormalizada = { ruta: string; ambigua: boolean }

// Control, "\", "/" (venía como %2F o %5C) y "%" (doble codificación) dentro de un segmento ya decodificado
const SEGMENTO_RARO = /[\u0000-\u001f\u007f\\/%]/

/** Ruta en minúsculas, sin barra final y con las barras dobles juntadas. Marca como ambigua la que no se puede leer sin dudas. */
export function normalizarRuta(pathname: string): RutaNormalizada {
  let ambigua = false
  const segmentos: string[] = []
  for (const crudo of String(pathname).split('/')) {
    if (crudo === '') continue // barra doble o barra final
    let seg = crudo
    try {
      seg = decodeURIComponent(crudo)
    } catch {
      ambigua = true // %ZZ o UTF-8 roto
    }
    if (SEGMENTO_RARO.test(seg) || seg === '.' || seg === '..') ambigua = true
    segmentos.push(seg.toLowerCase())
  }
  return { ruta: `/${segmentos.join('/')}`, ambigua }
}

function coincide(patron: string, ruta: string): boolean {
  if (patron.endsWith('/*')) {
    const base = patron.slice(0, -2)
    return ruta === base || ruta.startsWith(`${base}/`)
  }
  return ruta === patron
}

export type Resolucion = { regla: Regla; ruta: string; ambigua: boolean; esApi: boolean }

/** Qué regla le toca a una ruta (la que se mostró arriba). */
export function resolverRegla(pathname: string): Resolucion {
  const { ruta, ambigua } = normalizarRuta(pathname)
  const esApi = ruta === '/api' || ruta.startsWith('/api/')
  for (const regla of REGLAS) {
    if (!coincide(regla.patron, ruta)) continue
    if (ambigua && (regla.quien === 'publico' || regla.quien === 'propio')) continue
    return { regla, ruta, ambigua, esApi }
  }
  return { regla: POR_DEFECTO, ruta, ambigua, esApi }
}

// ── Decisión ───────────────────────────────────────────────────────────────────────────────
/** Lo que se sabe de quien pide: su sesión de Google (solo hace falta el rol) y si mandó el Bearer correcto. */
export type Contexto = { sesion: { rol: Rol; secciones?: readonly Seccion[] | null } | null; maquina: boolean }
export type Veredicto = 'pasar' | 'finanzas' | 'sin_sesion' | 'sin_permiso'

function conSesion(regla: Pick<Regla, 'seccion'>, ctx: Contexto): Veredicto {
  if (!ctx.sesion) return 'sin_sesion'
  if (regla.seccion && !puedeVer(ctx.sesion, regla.seccion)) return 'sin_permiso'
  return 'pasar'
}

/** Resultado de aplicar una regla a quien pide. "finanzas" = que lo resuelva el bloque de la contraseña de Finanzas. */
export function veredicto(regla: Pick<Regla, 'quien' | 'seccion'>, ctx: Contexto): Veredicto {
  switch (regla.quien) {
    case 'publico':
    case 'propio':
      return 'pasar'
    case 'finanzas':
      return 'finanzas'
    case 'google_o_maquina':
      // Sin el Bearer correcto se sigue como "google"
      return ctx.maquina ? 'pasar' : conSesion(regla, ctx)
    case 'google':
      return conSesion(regla, ctx)
  }
}

export type Decision =
  | { accion: 'pasar' }
  | { accion: 'finanzas'; esApi: boolean }
  | { accion: 'json'; estado: 401 | 403; error: string }
  | { accion: 'redirigir'; destino: string }

export const ERROR_SIN_SESION = 'No autorizado'
export const ERROR_SIN_PERMISO = 'Sin permiso para esta sección'

/** "/entrar" con el next que corresponde (la barra queda sin codificar: /entrar?next=/clientes). */
export function destinoEntrar(pathname: string, search: string): string {
  const next = rutaInternaSegura(`${pathname}${search}`)
  return next ? `/entrar?next=${encodeURIComponent(next).replace(/%2F/gi, '/')}` : '/entrar'
}

/**
 * Decisión del proxy para una petición. El contexto es una función a propósito: las rutas abiertas no leen la cookie ni
 * el encabezado Authorization, así que lo que usan los crons, los webhooks y el video queda intacto.
 */
export function decidir(entrada: { pathname: string; search?: string; contexto: () => Contexto }): Decision {
  const { regla, esApi } = resolverRegla(entrada.pathname)
  if (regla.quien === 'publico' || regla.quien === 'propio') return { accion: 'pasar' }
  if (regla.quien === 'finanzas') return { accion: 'finanzas', esApi }

  const ctx = entrada.contexto()
  switch (veredicto(regla, ctx)) {
    case 'pasar':
      return { accion: 'pasar' }
    case 'sin_sesion':
      return esApi
        ? { accion: 'json', estado: 401, error: ERROR_SIN_SESION }
        : { accion: 'redirigir', destino: destinoEntrar(entrada.pathname, entrada.search ?? '') }
    case 'sin_permiso':
      return esApi
        ? { accion: 'json', estado: 403, error: ERROR_SIN_PERMISO }
        : { accion: 'redirigir', destino: ctx.sesion ? destinoSinPermiso(ctx.sesion, regla.seccion, rutaInicial) : '/entrar' }
    case 'finanzas':
      return { accion: 'finanzas', esApi }
  }
}
