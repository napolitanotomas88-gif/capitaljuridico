// ── Notificaciones del Despacho: modelo y reglas puras (sin red ni base; lo prueba scripts/test-notificaciones.mjs) ──────
// Pedido de Tomás (27/10/2026): un "menú rápido" con las notificaciones urgentes pendientes (qué hay que hacer, a quién le
// toca, si está hecho y hace cuánto) y un aviso emergente con sonido en todo el Despacho. Contrato acordado con la sesión
// DASHBOARD PWA VERCEL: UNA sola fuente (tabla cj_notificaciones, registro.ts) que este Hub define y el marco del shell
// consume (cartel + sonido). Cada notificación va a una persona (para_email), a quien vea una sección (para_seccion) o, sin
// ninguna de las dos, a todos los que tengan sesión.
import { SECCIONES, puedeVer, type Quien, type Seccion } from '../auth/roles'

export interface Notificacion {
  id: number
  creadaEn: string            // ISO
  paraEmail: string | null
  paraSeccion: Seccion | null
  tipo: string                // 'guiones_a_revisar', 'alta_nueva', 'pago_vencido'… (lo define quien la crea)
  titulo: string
  cuerpo: string
  url: string | null          // ruta interna del Despacho ('/clientes?cliente=A123'); nunca un dominio externo
  urgente: boolean
  hechaEn: string | null
  hechaPor: string | null
  origen: string              // quién la creó: 'bot-guiones', 'cron-exito', 'hub-clientes'…
  vista: boolean              // la vio ESTA persona (por persona, aunque vaya a una sección)
}

export interface NuevaNotificacion {
  paraEmail?: string | null
  paraSeccion?: Seccion | null
  tipo: string
  titulo: string
  cuerpo?: string
  url?: string | null
  urgente?: boolean
  origen: string
  clave?: string | null       // para no duplicar: la misma clave no se crea dos veces (por ejemplo 'guiones:A123:tanda-2')
}

export const MAX_LISTA = 50
const LARGO = { tipo: 60, titulo: 160, cuerpo: 1000, url: 300, origen: 60, clave: 160 }
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Secciones que ve quien pide: sirve para filtrar las notificaciones que van a una sección. */
export const seccionesDe = (quien: Quien): Seccion[] => SECCIONES.filter(s => puedeVer(quien, s))

/** ¿Esta persona puede ver esta notificación? (la misma regla que aplica la consulta SQL; acá para los tests). */
export function laVe(n: Pick<Notificacion, 'paraEmail' | 'paraSeccion'>, email: string, secciones: readonly Seccion[]): boolean {
  if (n.paraEmail) return n.paraEmail.toLowerCase() === email.toLowerCase()
  if (n.paraSeccion) return secciones.includes(n.paraSeccion)
  return true
}

/** Ruta interna segura para el link (sin dominio, sin "//", sin esquema): si no, null. */
export function urlInterna(u: unknown): string | null {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\s]/.test(s) || /^\/[^/]*:/.test(s)) return null
  return s.slice(0, LARGO.url)
}

/** Valida y limpia una notificación nueva. Devuelve el motivo si no sirve. */
export function limpiarNueva(n: NuevaNotificacion): Required<Omit<NuevaNotificacion, 'paraSeccion' | 'paraEmail' | 'clave' | 'url'>> & { paraEmail: string | null; paraSeccion: Seccion | null; clave: string | null; url: string | null } | string {
  const corta = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const tipo = corta(n.tipo, LARGO.tipo), titulo = corta(n.titulo, LARGO.titulo), origen = corta(n.origen, LARGO.origen)
  if (!tipo || !titulo || !origen) return 'Faltan tipo, título u origen.'
  const paraEmail = n.paraEmail ? corta(n.paraEmail, 200).toLowerCase() : null
  if (paraEmail && !MAIL.test(paraEmail)) return 'Mail de destino inválido.'
  const paraSeccion = n.paraSeccion ?? null
  if (paraSeccion && !(SECCIONES as readonly string[]).includes(paraSeccion)) return 'Sección desconocida.'
  return {
    tipo, titulo, origen, paraEmail, paraSeccion,
    cuerpo: typeof n.cuerpo === 'string' ? n.cuerpo.trim().slice(0, LARGO.cuerpo) : '',
    url: n.url ? urlInterna(n.url) : null,
    urgente: n.urgente === true,
    clave: n.clave ? corta(n.clave, LARGO.clave) : null,
  }
}

/** Para el menú rápido: urgentes primero, después las más viejas sin hacer (las que más esperan). */
export const ordenPendientes = (a: Notificacion, b: Notificacion): number =>
  Number(b.urgente) - Number(a.urgente) || a.creadaEn.localeCompare(b.creadaEn)

/** "hace 3 h", "hace 2 días": cuánto lleva sin hacerse. */
export function haceCuanto(iso: string, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}
