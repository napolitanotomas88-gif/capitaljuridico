// ── Disparo de la tanda de guiones (Bot C.J. · Guiones) desde el kickoff ─────────────────────────────
// Desde el 27/10/2026 (Tomás, por el Hub de Clientes): la tanda arranca sola apenas la ficha queda «lista» con ideas, sin
// esperar la aprobación de Tomi y Gero M. La revisión humana pasa a los guiones (verificación por guion y un check final de
// una persona, en la etapa Guiones). Las ideas siguen en la ficha para comentarlas.
//   · POST <Despacho>/api/bot/guiones {recording_id} con Bearer CRON_SECRET, tope corto (solo se espera el 202: la ruta
//     trabaja en after()), sin reintentos: la ruta es idempotente (crearTanda reusa la tanda de esa grabación), así que un
//     reintento o un forzar del kickoff no arma otra.
//   · KICKOFF_GUIONES=0 lo apaga. Sin CRON_SECRET no se dispara (queda en el log). Nunca lanza.
// Solo servidor.
import { urlDespacho } from './entorno'

export const TOPE_GUIONES_MS = 8_000

/** ¿Arranca la tanda sola? Por defecto sí; KICKOFF_GUIONES=0 lo apaga. */
export const guionesEncendido = (env: NodeJS.ProcessEnv = process.env): boolean => env.KICKOFF_GUIONES?.trim() !== '0'

export type ResultadoDisparoGuiones = 'disparado' | 'apagado' | 'sin_secreto' | 'error'

/** Dispara la tanda de una grabación y espera solo la respuesta (202). Nunca lanza: devuelve qué pasó. */
export async function dispararGuionesReal(recordingId: number, topeMs: number = TOPE_GUIONES_MS): Promise<ResultadoDisparoGuiones> {
  if (!guionesEncendido()) return 'apagado'
  const secreto = process.env.CRON_SECRET?.trim()
  if (!secreto) { console.warn('bot-kickoff: sin CRON_SECRET: no se dispara la tanda de guiones'); return 'sin_secreto' }
  try {
    const r = await fetch(`${urlDespacho()}/api/bot/guiones`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secreto}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recording_id: recordingId }),
      signal: AbortSignal.timeout(topeMs),
    })
    if (r.status === 202) return 'disparado'
    console.warn(`bot-kickoff: la tanda de guiones de ${recordingId} respondió ${r.status}`)
    return 'error'
  } catch (e) {
    console.error(`bot-kickoff: no se pudo disparar la tanda de guiones de ${recordingId} —`, ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    return 'error'
  }
}
