// ── Bot "Capital Jurídico": modo del motor de altas (seco · ensayo · real) ─────────────────────────────────────────────
// Contrato del día 0 (diseño del motor, sección 2): lo usan el orquestador (BLOQUE O) y la compuerta de Whapi (BLOQUE W).
// Puro y sin red. Es la ÚNICA fuente del modo: sin la configuración explícita, todo es 'seco'.
//   · seco (por defecto): no sale nada. Ni Claude, ni descargas, ni lecturas de planillas, ni mensajes: el motor registra lo
//     que haría.
//   · ensayo: lecturas reales (comprobante, Claude, MEP, CRM de ventas, planillas en modo simulación) y, como mucho, un
//     reporte en Verificaciones C.J ("modo simulación con reporte en Verificaciones C.J", doc, orden de trabajo 3).
//   · real: escribe solo lo que dice BOT_ALTA_PASOS_REALES (capacidad por capacidad).
// Interruptor (revisión del diseño, punto 27): el modo de cada alta queda fijo cuando nace, y el modo EFECTIVO es el menor
// entre el del alta y el del entorno (menorModo). El entorno solo puede bajar el modo de un alta, nunca subirlo.

export type ModoMotor = 'seco' | 'ensayo' | 'real'

/** Lo que puede tener efecto afuera. 'reporte_verificaciones' es lo único que admite 'ensayo'; las demás, solo 'real'. */
export type Capacidad =
  | 'reporte_verificaciones' | 'mensajes_equipo' | 'finanzas' | 'crm' | 'drive' | 'comunidad' | 'bienvenida' | 'contrato'

export const CAPACIDADES: readonly Capacidad[] = [
  'reporte_verificaciones', 'mensajes_equipo', 'finanzas', 'crm', 'drive', 'comunidad', 'bienvenida', 'contrato',
]

const ORDEN: Record<ModoMotor, number> = { seco: 0, ensayo: 1, real: 2 }

/** BOT_ALTA_MODO: solo 'real' o 'ensayo' exactos; vacío, mal escrito o cualquier otra cosa → 'seco'. */
export function modoDesdeEntorno(env: NodeJS.ProcessEnv = process.env): ModoMotor {
  const v = env.BOT_ALTA_MODO
  return v === 'real' || v === 'ensayo' ? v : 'seco'
}

/** Nombres de capacidad que no se reconocen (para avisar en el log, sin valores). */
export function capacidadesDesconocidas(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.BOT_ALTA_PASOS_REALES ?? '').split(',').map((s) => s.trim()).filter((s) => s && !(CAPACIDADES as readonly string[]).includes(s))
}

/** BOT_ALTA_PASOS_REALES ("finanzas,crm,drive"): los nombres desconocidos se ignoran (avisando en el log).
 *  En 'seco' devuelve vacío; en 'ensayo', como mucho {'reporte_verificaciones'}. */
export function capacidadesReales(modo: ModoMotor, env: NodeJS.ProcessEnv = process.env): ReadonlySet<Capacidad> {
  if (modo === 'seco') return new Set()
  const desconocidas = capacidadesDesconocidas(env)
  if (desconocidas.length) console.warn(`bot-alta: BOT_ALTA_PASOS_REALES trae ${desconocidas.length} nombre(s) que no son capacidades: se ignoran`)
  const pedidas = new Set((env.BOT_ALTA_PASOS_REALES ?? '').split(',').map((s) => s.trim()).filter((s): s is Capacidad => (CAPACIDADES as readonly string[]).includes(s)))
  if (modo === 'ensayo') return new Set([...pedidas].filter((c) => c === 'reporte_verificaciones'))
  return pedidas
}

export function puede(c: Capacidad, modo: ModoMotor, caps: ReadonlySet<Capacidad>): boolean {
  if (modo === 'seco') return false
  if (modo === 'ensayo') return c === 'reporte_verificaciones' && caps.has(c)
  return caps.has(c)
}

/** El menor de dos modos (seco < ensayo < real). */
export const menorModo = (a: ModoMotor, b: ModoMotor): ModoMotor => (ORDEN[a] <= ORDEN[b] ? a : b)

/** true si `a` es un modo más bajo que `b`. */
export const modoMenorQue = (a: ModoMotor, b: ModoMotor): boolean => ORDEN[a] < ORDEN[b]

export const esModo = (x: unknown): x is ModoMotor => x === 'seco' || x === 'ensayo' || x === 'real'
export const esCapacidad = (x: unknown): x is Capacidad => typeof x === 'string' && (CAPACIDADES as readonly string[]).includes(x)
