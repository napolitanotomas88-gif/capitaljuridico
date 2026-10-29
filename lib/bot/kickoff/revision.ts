// ── Pantalla de la ficha de kickoff: tildes del portfolio, faltantes hechos y revisión de las ideas (puro) ────────────
// Lo que la pantalla (/clientes/<id>/kickoff) escribe en cj_kickoffs, en las tres columnas que el bot nunca pisa
// (registro.ts): portfolio_checks, faltantes_checks y revision. Acá van los tipos, la lectura defensiva del jsonb, la
// validación ESTRICTA de lo que manda el navegador y quién es revisor. Sin imports de Next ni de la base: lo usan la API,
// registro.ts, vista.ts, los componentes del navegador (solo tipos y constantes) y scripts/test-bot-kickoff-vista.mjs.
//   · portfolio_checks = { <ítem>: { valor, nota, quien, email, cuando } }: lo que tilda a mano quien ve Clientes para los
//     ítems que ni Meta ni la llamada resolvieron (fuente 'ninguna' de portfolio_final). Sin el ítem = sin tildar.
//   · faltantes_checks = { <clave>: { nota, quien, email, cuando } }: un faltante que no es del portfolio marcado como hecho
//     (con la nota: "el recorte del mapa es …", que también le sirve a Valentino), y los dos datos de lanzamiento que se
//     cargan a mano (fecha estimada y WhatsApp de destino: la nota ES el dato). Sin la clave = sin hacer / sin cargar.
//   · revision = { tomi: {...} | null, gero_m: {...} | null }: aprobó las ideas, pidió cambios (con comentario) o deshizo
//     (estado 'pendiente', así no se pierde el historial). Cada uno escribe SOLO su clave, y la clave sale de la sesión
//     (revisorDeSesion), nunca del cuerpo del pedido. Lleva la huella de las ideas que VIO quien revisa (la manda la
//     pantalla): si el bot las rehízo mientras tanto, la API responde 409 «ideas_cambiaron» y no escribe; una aprobación
//     vieja de otras ideas no cuenta (vista.ts la muestra como "anterior"). Guarda hasta MAX_HISTORIAL pasos anteriores
//     (pidió cambios → aprobó): un comentario no se pierde al aprobar encima.
//   · "No pisar el cambio de otro": cada escritura manda `previo` = el `cuando` de lo que se vio (null = no había nada). El
//     UPDATE solo prende si sigue siendo ese (registro.ts); si no, conflicto y la pantalla pide recargar.
import { ITEMS_PORTFOLIO, REVISORES, type ItemPortfolio } from './tipos'

// ── Tildes del portfolio ──
export const VALORES_CHECK = ['ok', 'falta', 'problema'] as const
export type ValorCheck = (typeof VALORES_CHECK)[number]
export const NOMBRE_VALOR_CHECK: Record<ValorCheck, string> = { ok: 'Ok', falta: 'Falta', problema: 'Problema' }
export interface CheckPortfolio {
  valor: ValorCheck
  nota: string                    // '' = sin nota
  quien: string                   // nombre de la sesión (Google) de quien tildó
  email: string
  cuando: string                  // ISO: también es la marca para la escritura con condición
}
export type ChecksPortfolio = Partial<Record<ItemPortfolio, CheckPortfolio>>

// ── Faltantes marcados como hechos y datos de lanzamiento (faltantes_checks) ──
// Las claves de los faltantes que arma ficha.ts (claveFaltante() las reconoce en el texto, también en las fichas viejas).
// Los del portfolio que se tildan a mano no van acá: se resuelven con portfolio_checks.
// zona_mapa es "anotar el recorte" (o "se está leyendo del video"); zona_mapa_video, lo que pide el mapa YA leído del video
// ("revisar las diferencias", "confirmar el recorte leído"): una clave aparte, así una nota del recorte anotada a mano ANTES
// de que se leyera el video no da por revisada una diferencia que el video encontró después.
export const CLAVES_FALTANTE = [
  'cliente', 'rama', 'subramas', 'avatar', 'zona', 'zona_mapa', 'zona_mapa_video', 'presupuesto_monto', 'presupuesto_deducido',
  'presupuesto_confirmar', 'moneda', 'cuenta_crm', 'ideas',
] as const
export type ClaveFaltante = (typeof CLAVES_FALTANTE)[number]
// Los datos para lanzar que Meta no deja leer y la llamada no siempre dice: se cargan a mano en la pantalla
export const CLAVES_DATO = ['fecha_lanzamiento', 'whatsapp_destino'] as const
export type ClaveDato = (typeof CLAVES_DATO)[number]
export const NOMBRE_DATO: Record<ClaveDato, string> = { fecha_lanzamiento: 'Fecha estimada de lanzamiento', whatsapp_destino: 'WhatsApp de destino de los anuncios' }
export type ClaveMarca = ClaveFaltante | ClaveDato
export interface MarcaFaltante {
  nota: string                    // en un dato, el valor; en un faltante, la nota (opcional)
  quien: string
  email: string
  cuando: string
}
export type MarcasFaltantes = Partial<Record<ClaveMarca, MarcaFaltante>>

// ── Revisión de las ideas (Tomi y Gero M) ──
export const CLAVES_REVISOR = ['tomi', 'gero_m'] as const
export type ClaveRevisor = (typeof CLAVES_REVISOR)[number]
export const NOMBRE_REVISOR: Record<ClaveRevisor, (typeof REVISORES)[number]> = { tomi: 'Tomi', gero_m: 'Gero M' }
export const ESTADOS_REVISION = ['aprobada', 'cambios'] as const
export type EstadoRevision = (typeof ESTADOS_REVISION)[number]
/** Lo que se puede pedir y guardar: aprobar, pedir cambios o volver a "pendiente" (deshacer lo propio). */
export type EstadoPedidoRevision = EstadoRevision | 'pendiente'
/** Un paso anterior de la revisión de uno (el más nuevo primero). */
export interface PasoRevision { estado: EstadoRevision; comentario: string; cuando: string; huella: string }
export interface RevisionIdeas {
  estado: EstadoPedidoRevision    // 'pendiente' = deshizo lo suyo (queda el historial)
  comentario: string              // obligatorio al pedir cambios
  cuando: string                  // ISO
  email: string
  huella: string                  // huellaIdeas() de las ideas que vio: si cambian, la revisión vieja no cuenta ('' al deshacer)
  historial: PasoRevision[]       // hasta MAX_HISTORIAL pasos anteriores (aprobó / pidió cambios), el más nuevo primero
}
export type Revision = Record<ClaveRevisor, RevisionIdeas | null>
export const MAX_HISTORIAL = 5

// ── Límites (la API, registro.ts y el formulario usan los mismos) ──
export const LARGO_NOTA = 280
export const LARGO_COMENTARIO = 1000
export const MIN_COMENTARIO_CAMBIOS = 3
const LARGO_NOMBRE = 80
const LARGO_EMAIL = 254
export const MAX_RECORDING_ID = 1e15
export const RE_HUELLA = /^[0-9a-f]{8}$/
// Datos de lanzamiento: la fecha es texto libre corto ("lun 2/11", "primera semana de noviembre"); el WhatsApp, un número
export const LARGO_FECHA_LANZAMIENTO = 60
const RE_WHATSAPP = /^\+?\d[\d ()-]{5,22}\d$/

/** Error de una entrada inválida (la API responde 422; registro.ts lo tira antes de tocar la base). */
export class ErrorEntradaKickoff extends Error {
  readonly campo: string
  constructor(campo: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorEntradaKickoff'
    this.campo = campo
  }
}

const RE_CUANDO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Controles: fuera todos (en el comentario se dejan los saltos de línea y se normalizan los \r)
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g

export const esCuando = (x: unknown): x is string => typeof x === 'string' && RE_CUANDO.test(x) && Number.isFinite(Date.parse(x))
export const esItemPortfolio = (x: unknown): x is ItemPortfolio => typeof x === 'string' && (ITEMS_PORTFOLIO as readonly string[]).includes(x)
export const esValorCheck = (x: unknown): x is ValorCheck => typeof x === 'string' && (VALORES_CHECK as readonly string[]).includes(x)
export const esClaveRevisor = (x: unknown): x is ClaveRevisor => typeof x === 'string' && (CLAVES_REVISOR as readonly string[]).includes(x)
export const esClaveDato = (x: unknown): x is ClaveDato => typeof x === 'string' && (CLAVES_DATO as readonly string[]).includes(x)
export const esClaveMarca = (x: unknown): x is ClaveMarca => esClaveDato(x) || (typeof x === 'string' && (CLAVES_FALTANTE as readonly string[]).includes(x))
export const esRecordingId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0 && x < MAX_RECORDING_ID

/**
 * Texto que escribió una persona: NFC, sin controles ni caracteres invisibles de dirección, recortado. `multilinea` deja
 * los saltos de línea (hasta dos seguidos); si no, todo va en una línea. null = no es texto o se pasa de `max` (no se recorta:
 * una nota cortada a la mitad dice otra cosa).
 */
export function textoLimpio(x: unknown, max: number, multilinea = false): string | null {
  if (typeof x !== 'string') return null
  let t = x.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROLES, '')
  t = multilinea ? t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ')
  t = t.trim()
  return t.length <= max ? t : null
}

const emailLimpio = (x: unknown): string | null => {
  if (typeof x !== 'string') return null
  const e = x.trim().toLowerCase()
  return e.length <= LARGO_EMAIL && /^[\x21-\x7e]+$/.test(e) && RE_EMAIL.test(e) ? e : null
}

/** El valor de un dato de lanzamiento, validado (null = no sirve). La fecha, texto corto; el WhatsApp, un número. */
export function valorDato(clave: ClaveDato, x: unknown): string | null {
  const t = textoLimpio(x, clave === 'fecha_lanzamiento' ? LARGO_FECHA_LANZAMIENTO : 30)
  if (!t || t.length < 3) return null
  return clave === 'whatsapp_destino' && !RE_WHATSAPP.test(t) ? null : t
}

// ── Lectura defensiva del jsonb (lo que haya en la base: una fila vieja, un cambio a mano) ──
/** Los tildes válidos de portfolio_checks; lo que no tenga la forma esperada se ignora. */
export function leerChecks(x: unknown): ChecksPortfolio {
  const out: ChecksPortfolio = {}
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out
  for (const k of ITEMS_PORTFOLIO) {
    const c = (x as Record<string, unknown>)[k] as Record<string, unknown> | null | undefined
    if (!c || typeof c !== 'object' || !esValorCheck(c.valor) || !esCuando(c.cuando)) continue
    out[k] = {
      valor: c.valor,
      nota: textoLimpio(c.nota ?? '', LARGO_NOTA) ?? '',
      quien: textoLimpio(c.quien ?? '', LARGO_NOMBRE) ?? '',
      email: emailLimpio(c.email) ?? '',
      cuando: c.cuando,
    }
  }
  return out
}

/** Las marcas válidas de faltantes_checks (un dato con un valor que ya no valida se ignora). */
export function leerMarcas(x: unknown): MarcasFaltantes {
  const out: MarcasFaltantes = {}
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out
  for (const k of [...CLAVES_FALTANTE, ...CLAVES_DATO]) {
    const c = (x as Record<string, unknown>)[k] as Record<string, unknown> | null | undefined
    if (!c || typeof c !== 'object' || !esCuando(c.cuando)) continue
    const nota = esClaveDato(k) ? valorDato(k, c.nota) : textoLimpio(c.nota ?? '', LARGO_NOTA) ?? ''
    if (nota === null) continue
    out[k] = { nota, quien: textoLimpio(c.quien ?? '', LARGO_NOMBRE) ?? '', email: emailLimpio(c.email) ?? '', cuando: c.cuando }
  }
  return out
}

const esEstadoGuardado = (x: unknown): x is EstadoPedidoRevision => x === 'aprobada' || x === 'cambios' || x === 'pendiente'

function leerPaso(x: unknown): PasoRevision | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const p = x as Record<string, unknown>
  if ((p.estado !== 'aprobada' && p.estado !== 'cambios') || !esCuando(p.cuando)) return null
  return {
    estado: p.estado,
    comentario: textoLimpio(p.comentario ?? '', LARGO_COMENTARIO, true) ?? '',
    cuando: p.cuando,
    huella: typeof p.huella === 'string' && RE_HUELLA.test(p.huella) ? p.huella : '',
  }
}

/** La revisión de cada uno (null = todavía no revisó, o lo guardado no tiene la forma esperada). */
export function leerRevision(x: unknown): Revision {
  const out: Revision = { tomi: null, gero_m: null }
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out
  for (const k of CLAVES_REVISOR) {
    const r = (x as Record<string, unknown>)[k] as Record<string, unknown> | null | undefined
    if (!r || typeof r !== 'object' || !esEstadoGuardado(r.estado) || !esCuando(r.cuando)) continue
    out[k] = {
      estado: r.estado,
      comentario: textoLimpio(r.comentario ?? '', LARGO_COMENTARIO, true) ?? '',
      cuando: r.cuando,
      email: emailLimpio(r.email) ?? '',
      huella: typeof r.huella === 'string' && RE_HUELLA.test(r.huella) ? r.huella : '',
      historial: (Array.isArray(r.historial) ? r.historial : []).map(leerPaso).filter((p): p is PasoRevision => !!p).slice(0, MAX_HISTORIAL),
    }
  }
  return out
}

/** El historial después de escribir: lo que había (si era aprobar o pedir cambios) pasa adelante; hasta MAX_HISTORIAL. */
export function historialNuevo(previa: RevisionIdeas | null | undefined): PasoRevision[] {
  if (!previa) return []
  const paso: PasoRevision[] = previa.estado === 'pendiente' ? [] : [{ estado: previa.estado, comentario: previa.comentario, cuando: previa.cuando, huella: previa.huella }]
  return [...paso, ...previa.historial].slice(0, MAX_HISTORIAL)
}

/** Huella corta (FNV-1a, 32 bits) de las ideas: título y gancho de cada una, en orden. No es seguridad: detecta un cambio. */
export function huellaIdeas(ideas: readonly { titulo?: unknown; gancho?: unknown }[]): string {
  const texto = JSON.stringify(ideas.map(i => [String(i?.titulo ?? ''), String(i?.gancho ?? '')]))
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ── El pedido del navegador (POST /api/clientes/<id>/kickoff) ──
export type PedidoKickoff =
  | { accion: 'check'; recording_id: number; item: ItemPortfolio; valor: ValorCheck | null; nota: string; previo: string | null }
  | { accion: 'faltante'; recording_id: number; clave: ClaveMarca; hecho: boolean; nota: string; previo: string | null }
  | { accion: 'revision'; recording_id: number; estado: EstadoPedidoRevision; comentario: string; huella: string; previo: string | null }

const CLAVES_PEDIDO = {
  check: ['accion', 'recording_id', 'item', 'valor', 'nota', 'previo'],
  faltante: ['accion', 'recording_id', 'clave', 'hecho', 'nota', 'previo'],
  revision: ['accion', 'recording_id', 'estado', 'comentario', 'huella', 'previo'],
} as const

type Validacion = { ok: true; pedido: PedidoKickoff } | { ok: false; campo: string; error: string }
const mal = (campo: string, error: string): Validacion => ({ ok: false, campo, error })

/**
 * Valida el cuerpo tal cual llega (JSON ya parseado). Estricto: un campo de más, un tipo distinto o un texto largo es un
 * rechazo, no un arreglo silencioso. Quién lo hace NO viene acá: sale de la sesión.
 */
export function validarPedido(x: unknown): Validacion {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return mal('cuerpo', 'Se espera un objeto JSON.')
  const c = x as Record<string, unknown>
  if (c.accion !== 'check' && c.accion !== 'faltante' && c.accion !== 'revision') return mal('accion', 'La acción tiene que ser «check», «faltante» o «revision».')
  const permitidas: readonly string[] = CLAVES_PEDIDO[c.accion]
  const sobra = Object.keys(c).find(k => !permitidas.includes(k))
  if (sobra) return mal(sobra.slice(0, 40), `Campo no permitido: ${sobra.slice(0, 40)}.`)
  if (!esRecordingId(c.recording_id)) return mal('recording_id', 'Falta la grabación (recording_id) o no es válida.')
  const previo = c.previo ?? null
  if (previo !== null && !esCuando(previo)) return mal('previo', 'La marca de la versión vista (previo) no es válida.')
  if (c.accion === 'check') {
    if (!esItemPortfolio(c.item)) return mal('item', 'Ese ítem del portfolio no existe.')
    const valor = c.valor ?? null
    if (valor !== null && !esValorCheck(valor)) return mal('valor', 'El valor tiene que ser ok, falta, problema o vacío (quitar).')
    const nota = textoLimpio(c.nota ?? '', LARGO_NOTA)
    if (nota === null) return mal('nota', `La nota tiene que ser texto de hasta ${LARGO_NOTA} caracteres.`)
    if (valor === null && nota) return mal('nota', 'Para quitar el tilde no hace falta nota.')
    return { ok: true, pedido: { accion: 'check', recording_id: c.recording_id, item: c.item, valor, nota, previo } }
  }
  if (c.accion === 'faltante') {
    if (!esClaveMarca(c.clave)) return mal('clave', 'Ese faltante no existe.')
    if (typeof c.hecho !== 'boolean') return mal('hecho', 'Falta decir si está hecho (true) o no (false).')
    const nota = esClaveDato(c.clave) && c.hecho ? valorDato(c.clave, c.nota) : textoLimpio(c.nota ?? '', LARGO_NOTA)
    if (nota === null) {
      return mal('nota', c.clave === 'whatsapp_destino' ? 'El WhatsApp tiene que ser un número (con el código de país, por ejemplo +54 9 264 …).'
        : esClaveDato(c.clave) ? `Escribí la fecha estimada (hasta ${LARGO_FECHA_LANZAMIENTO} caracteres).` : `La nota tiene que ser texto de hasta ${LARGO_NOTA} caracteres.`)
    }
    if (!c.hecho && nota) return mal('nota', 'Para desmarcar no hace falta nota.')
    return { ok: true, pedido: { accion: 'faltante', recording_id: c.recording_id, clave: c.clave, hecho: c.hecho, nota, previo } }
  }
  const estado = c.estado
  if (estado !== 'aprobada' && estado !== 'cambios' && estado !== 'pendiente') return mal('estado', 'El estado tiene que ser aprobada, cambios o pendiente.')
  const comentario = textoLimpio(c.comentario ?? '', LARGO_COMENTARIO, true)
  if (comentario === null) return mal('comentario', `El comentario tiene que ser texto de hasta ${LARGO_COMENTARIO} caracteres.`)
  if (estado === 'cambios' && comentario.length < MIN_COMENTARIO_CAMBIOS) return mal('comentario', 'Para pedir cambios, escribí qué cambiar.')
  if (estado === 'pendiente' && comentario) return mal('comentario', 'Para deshacer la revisión no hace falta comentario.')
  // La huella de las ideas que se vieron: obligatoria para aprobar o pedir cambios (la API la compara con las de ahora)
  const huella = c.huella ?? ''
  if (typeof huella !== 'string' || (huella && !RE_HUELLA.test(huella))) return mal('huella', 'La huella de las ideas no es válida.')
  if (estado !== 'pendiente' && !huella) return mal('huella', 'Falta la huella de las ideas que se vieron: recargá la página.')
  return { ok: true, pedido: { accion: 'revision', recording_id: c.recording_id, estado, comentario, huella, previo } }
}

// ── Quién es revisor (sale de la sesión de Google, nunca del pedido) ──
const VARIABLE_REVISOR: Record<ClaveRevisor, string> = { tomi: 'KICKOFF_REVISOR_TOMI', gero_m: 'KICKOFF_REVISOR_GERO_M' }
export const VARIABLES_REVISOR = Object.values(VARIABLE_REVISOR)
// Respaldo SOLO fuera de producción: el apellido como palabra entera en el nombre de la sesión
const APELLIDO_REVISOR: Record<ClaveRevisor, RegExp> = { tomi: /\bnapolitano\b/, gero_m: /\bmozzi\b/ }

const mailsDe = (v: string | undefined): string[] => (v ?? '').split(/[,;\s]+/).map(emailLimpio).filter((e): e is string => !!e)
const normNombre = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
/** Next pone NODE_ENV=production en el build y en cualquier deploy de Vercel (también los previews). */
const enProduccion = (env: Record<string, string | undefined>) => env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production'

/**
 * 'tomi', 'gero_m' o null (no aprueba ideas: ve el estado y nada más).
 *   1. KICKOFF_REVISOR_TOMI / KICKOFF_REVISOR_GERO_M (mails de login separados por coma): si la variable de uno está, manda
 *      ella, por mail EXACTO (los mails no viven en el código, igual que AUTH_USUARIOS).
 *   2. En producción, sin la variable nadie es revisor por esa clave (falla cerrado: una subcadena del nombre dejaba aprobar
 *      a cualquier "Mozzini" o "Napolitano" que viera Clientes). Fuera de producción, el apellido como palabra entera en el
 *      nombre de la sesión: «napolitano» → Tomi; «mozzi» → Gero M (nunca por el mail).
 * El usuario de prueba de desarrollo nunca es revisor. Si la misma persona calza en los dos, nadie.
 */
export function revisorDeSesion(s: { email: string; nombre: string; esDePrueba?: boolean } | null | undefined, env: Record<string, string | undefined> = process.env): ClaveRevisor | null {
  if (!s || s.esDePrueba) return null
  const email = emailLimpio(s.email)
  if (!email) return null
  const n = normNombre(s.nombre ?? '')
  const prod = enProduccion(env)
  const encontrados = CLAVES_REVISOR.filter(k => {
    const lista = mailsDe(env[VARIABLE_REVISOR[k]])
    if (lista.length) return lista.includes(email)
    return !prod && APELLIDO_REVISOR[k].test(n)
  })
  return encontrados.length === 1 ? encontrados[0] : null
}
