// ── Bot "Capital Jurídico": quién aprueba altas desde el Despacho (26/10/2026) ─────────────────────────────────────────
// En WhatsApp se aprueba por número (BOT_ALTA_APROBADORES / BOT_ALTA_OPERACIONES). En el Despacho, por el mail de Google de
// la sesión. Solo pueden responder los pedidos de Verificaciones (OK / NO, cuenta, MEP, fuente, nombre) y marcar "Hecho a
// mano": Tomás, Gero A, Aylu y Gero M. Los mails salen de las variables que ya identifican a cada uno en el Despacho:
//   · Tomás  → EDICION_REVISOR_TOMAS o KICKOFF_REVISOR_TOMI
//   · Gero M → KICKOFF_REVISOR_GERO_M
//   · Aylu   → EDICION_REVISOR_AYLU
//   · Gero A → no hay ninguna: va en BOT_ALTA_APROBADORES_EMAIL (lista de mails, separados por coma)
// BOT_ALTA_APROBADORES_EMAIL SUMA mails (sirve también para la segunda cuenta de alguien). Un mail inválido se ignora.
// Fuera de producción, el usuario de prueba de desarrollo con rol socio también aprueba (nunca existe en producción).
// Cargar altas (Tomás, 26/10/2026): los closers (rol "closer": Carlos, Marcos, Yami, Nahuel, Brenda) y los aprobadores. Un
// closer ve, carga y completa los datos de SUS altas, pero no aprueba. Puro, sin red.
import type { Espera, FilaAlta } from '../motor/almacen'
import { CLOSERS_DESPACHO } from './evento'

export interface Aprobador { email: string; nombre: string }

/** Variable → nombre con que firma la respuesta (queda como "manual:<nombre>" en el alta). */
export const VARIABLES_APROBADORES: readonly { variable: string; nombre: string }[] = [
  { variable: 'EDICION_REVISOR_TOMAS', nombre: 'Tomás' },
  { variable: 'KICKOFF_REVISOR_TOMI', nombre: 'Tomás' },
  { variable: 'KICKOFF_REVISOR_GERO_M', nombre: 'Gero M' },
  { variable: 'EDICION_REVISOR_AYLU', nombre: 'Aylu' },
]
export const VARIABLE_EXTRA = 'BOT_ALTA_APROBADORES_EMAIL'

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Mismo criterio que lib/auth/usuarios.ts (normalizarEmail): ASCII imprimible, sin espacios, en minúsculas. */
export function mailNormalizado(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const t = x.trim()
  if (!/^[\x21-\x7e]+$/.test(t)) return null
  const m = t.toLowerCase()
  return m.length <= 254 && RE_EMAIL.test(m) ? m : null
}
const mails = (v: string | undefined) => (v ?? '').split(/[,;\s]+/).map(mailNormalizado).filter((m): m is string => !!m)

/** Todos los aprobadores con su nombre (el primero que aparece manda si un mail se repite). */
export function aprobadoresDesdeEntorno(env: NodeJS.ProcessEnv = process.env): Aprobador[] {
  const out = new Map<string, Aprobador>()
  for (const { variable, nombre } of VARIABLES_APROBADORES) for (const email of mails(env[variable])) if (!out.has(email)) out.set(email, { email, nombre })
  for (const email of mails(env[VARIABLE_EXTRA])) if (!out.has(email)) out.set(email, { email, nombre: '' })
  return [...out.values()]
}

/** Lo que importa de la sesión de Google (lib/auth/identidad.ts: Sesion). */
export interface QuienPide { email: string; nombre: string; rol: string; esDePrueba?: boolean; secciones?: readonly string[] }

/** El aprobador que es esta sesión, o null. El nombre: el de la variable o, si no, el de la sesión (AUTH_USUARIOS). */
export function aprobadorDe(s: QuienPide | null, env: NodeJS.ProcessEnv = process.env): Aprobador | null {
  if (!s) return null
  if (s.esDePrueba) return env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production' || s.rol !== 'socio' ? null : { email: s.email, nombre: 'Usuario de prueba' }
  const m = mailNormalizado(s.email)
  if (!m) return null
  const a = aprobadoresDesdeEntorno(env).find((x) => x.email === m)
  return a ? { email: m, nombre: a.nombre || s.nombre.split(/\s+/)[0] || m } : null
}

/** Nombre con que queda la respuesta (sin el mail): "Aylu", "Tomás"… */
export const firma = (s: QuienPide, a: Aprobador | null) => (a?.nombre || s.nombre.split(/\s+/)[0] || 'Despacho').slice(0, 60)

/** El closer que es esta sesión (rol "closer" del Despacho), por su nombre en AUTH_USUARIOS: "Marcos Pérez" → "Marcos",
 *  "Yamila …" → "Yami". null si no es closer o no es uno de los cinco. */
export function closerDeSesion(s: QuienPide | null): string | null {
  // Los closers hoy entran como tipo "acceso" (planilla de Accesos, con su pestaña): cuentan si tienen la sección "altas"
  // (DASHBOARD, 26/10/2026: nadie usa el rol "closer"). El nombre decide cuál de los cinco es.
  if (!s || !(s.rol === 'closer' || (s.rol === 'acceso' && (s.secciones ?? []).includes('altas')))) return null
  const primero = s.nombre.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const alias: Record<string, string> = { yamila: 'Yami' }
  return alias[primero] ?? CLOSERS_DESPACHO.find((c) => c.toLowerCase() === primero) ?? null
}
const mismoCloser = (a: string | null, b: string | null) => {
  const n = (x: string | null) => { const t = (x ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''; return t === 'yamila' ? 'yami' : t }
  return !!a && !!b && n(a) === n(b)
}

/** Tomás (26/10/2026): pueden CARGAR altas los closers (rol "closer") y los aprobadores. */
// Tomás (26/10/2026, más tarde): los closers NO cargan en el Despacho; mandan el cierre al grupo Ventas de WhatsApp y lo
// cargan Aylu, Gero A, Tomás o Gero M. Solo cargan, ven y responden los aprobadores. closerDeSesion queda para
// BOT_ALTA_CLOSERS_DESPACHO=si (apagado).
export const closersCargan = (env: NodeJS.ProcessEnv = process.env) => env.BOT_ALTA_CLOSERS_DESPACHO?.trim() === 'si'
export const puedeCargar = (s: QuienPide | null, env: NodeJS.ProcessEnv = process.env) => !!aprobadorDe(s, env) || (closersCargan(env) && !!closerDeSesion(s))

/** ¿Ve esta alta? Los aprobadores, todas; un closer, solo las suyas. */
export function veAlta(s: QuienPide | null, alta: Pick<FilaAlta, 'textoVigente' | 'autor'>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (aprobadorDe(s, env)) return true
  return closersCargan(env) && mismoCloser(closerDeSesion(s), closerDeFila(alta))
}

/** ¿Esta sesión puede responder esta espera? OK / NO del equipo: solo aprobadores. Datos del closer: un aprobador o el
 *  closer de esa alta (los closers cargan y completan sus altas, pero no aprueban). */
export function puedeResponder(s: QuienPide | null, e: Pick<Espera, 'quien'>, alta: Pick<FilaAlta, 'textoVigente' | 'autor'>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!s) return false
  if (aprobadorDe(s, env)) return true
  return closersCargan(env) && e.quien === 'closer' && mismoCloser(closerDeSesion(s), closerDeFila(alta))
}

/** ¿Puede marcar "Hecho a mano"? Solo aprobadores. */
export const puedeMarcarAMano = (s: QuienPide | null, env: NodeJS.ProcessEnv = process.env) => !!aprobadorDe(s, env)

/** Quién falta: los cuatro que tienen que poder aprobar y si su mail está configurado. */
export function faltantesAprobadores(env: NodeJS.ProcessEnv = process.env): string[] {
  const nombres = new Set(aprobadoresDesdeEntorno(env).map((a) => a.nombre).filter(Boolean))
  const faltan = ['Tomás', 'Gero M', 'Aylu'].filter((n) => !nombres.has(n))
  // Gero A no tiene variable propia: alcanza con que BOT_ALTA_APROBADORES_EMAIL tenga algún mail
  if (!mails(env[VARIABLE_EXTRA]).length) faltan.push('Gero A')
  return faltan
}

/** El closer de un alta, del texto vigente ("Closer: Marcos") o del autor del mensaje. */
export function closerDeFila(alta: Pick<FilaAlta, 'textoVigente' | 'autor'>): string | null {
  const m = /^\s*closer\s*[:\-–—]\s*(.+)$/im.exec(alta.textoVigente ?? '')
  return m?.[1]?.trim() || alta.autor?.nombre || null
}
