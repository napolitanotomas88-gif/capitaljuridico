// ── Pago de cuota del bot → tablero de Cuotas (Tomás, 4/11/2026) ────────────────────────────────────────────────────
// «Aplicá ese código para que lea lo que armamos para los pagos de cuotas que vayan entrando»: cuando el bot carga en
// Finanzas la 2da, 3ra… cuota de un cliente, el pago se registra solo en su plan de /cuotas (si no, el tablero sigue
// pidiendo un pago que ya entró). Corre DESPUÉS de que la fila quedó verificada en la planilla (finanzasEscribir.ts): si
// falla, el pago queda cargado igual en Finanzas y se avisa.
//   · Solo cuotas que siguen a la primera ("2da Cuota", "3ra Cuota"…): la 1ra, los Fee y los PIF son de altas nuevas, que
//     el closer arma en el tablero con su propio "Pagado".
//   · El plan: el único que no esté abandonado, tenga saldo y sea del mismo cliente por teléfono (últimos 8 dígitos). Solo
//     si el pago no trae teléfono se busca por nombre (y solo planes sin teléfono). Si no se puede confirmar, se avisa.
//   · Conservador con la plata: ante la duda NO registra y avisa para hacerlo a mano en /cuotas.
//     - Idempotente: los ids de operación salen del pago (fecha, cliente, monto, concepto); si ya están, no se repite.
//     - Si el plan tiene un pago cargado a mano parecido (±3 % o ±USD 10, ±10 días), puede ser el mismo: avisa.
//   · El monto va a las cuotas por orden de vencimiento, sin pasarse de lo que entró. Solo la última cuota tocada puede darse
//     por saldada por diferencia de cambio, si el resto es chico frente a lo que entró en ella (hasta el 1,5 %; mínimo USD 2).
import { createHash } from 'node:crypto'
import { modificarPlan, porCobrar, saldo, type Plan, type RegistroPlan } from './modelo'

export const ACTOR_BOT = 'Bot de altas (cuota cargada en Finanzas)'

export interface PagoCuotaBot { fecha: string; nombre: string | null; telefono: string | null; usd: number; concepto: string }
export type ResultadoTablero =
  | { accion: 'registrado'; planId: string; nombre: string; plan: Plan; version: number; detalle: string; avisos: string[] }
  | { accion: 'ya_estaba' | 'no_aplica'; detalle: string }
  | { accion: 'sin_plan' | 'ambiguo' | 'revisar'; detalle: string }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tel8 = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-8)
const dias = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5
const pendiente = (p: Plan) => p.cuotas.reduce((s, c) => s + porCobrar(c), 0)

/** ¿Este concepto es una cuota que sigue a la primera? ("2da Cuota", "3ra Cuota", "Cuota 13"…) */
export const esCuotaSiguiente = (concepto: string) => /cuota/i.test(concepto) && !/^\s*1\s*ra\b/i.test(concepto)

/** Id de operación estable para el pago (uuid con forma v4, del sha256 del pago y la cuota): reintentar no duplica. */
export function idOperacion(pago: PagoCuotaBot, i: number): string {
  const h = createHash('sha256').update(`pago-bot|${pago.fecha}|${tel8(pago.telefono) || norm(pago.nombre)}|${Math.round(pago.usd * 100)}|${norm(pago.concepto)}|${i}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Decide y arma el cambio. Pura: no lee ni escribe nada. */
export function pagoAlTablero(planes: readonly RegistroPlan[], pago: PagoCuotaBot, ahora = new Date()): ResultadoTablero {
  if (!esCuotaSiguiente(pago.concepto)) return { accion: 'no_aplica', detalle: `«${pago.concepto}» no es una cuota de un cliente existente` }
  if (!(pago.usd > 0)) return { accion: 'no_aplica', detalle: 'sin monto en USD' }
  const t = tel8(pago.telefono), n = norm(pago.nombre)
  const quien = pago.nombre ?? 'el cliente'
  const vivos = planes.filter(({ plan }) => !plan.abandonado)
  // Ya registrado por el bot (reintento del motor): un pago vigente con el mismo id de operación en un plan vigente
  const ids = new Set(Array.from({ length: 60 }, (_, i) => idOperacion(pago, i)))
  if (vivos.some(({ plan }) => plan.cuotas.some((c) => c.pagos.some((p) => !p.anulado && ids.has(p.id))))) return { accion: 'ya_estaba', detalle: `la cuota de ${quien} ya estaba registrada en el tablero` }
  // Registrado antes por el bot y después anulado o en un plan abandonado: el mismo id no se puede volver a usar (modificarPlan
  // lo ignoraría en silencio) y además alguien lo deshizo a propósito
  if (planes.some(({ plan }) => plan.eventos.some((e) => ids.has(e.id)))) return { accion: 'revisar', detalle: `ese pago de ${quien} ya se había registrado en el tablero y después se anuló o se abandonó el plan` }
  const conSaldo = vivos.filter(({ plan }) => pendiente(plan) > 0)
  let candidatos: RegistroPlan[]
  if (t.length === 8) {
    candidatos = conSaldo.filter(({ plan }) => tel8(plan.telefono) === t)
    if (!candidatos.length && n.length >= 5 && conSaldo.some(({ plan }) => tel8(plan.telefono).length < 8 && norm(plan.nombre) === n))
      return { accion: 'revisar', detalle: `hay un plan de «${quien}» sin teléfono en el tablero: confirmá que es el mismo cliente` }
  } else {
    // Sin teléfono en el pago, por nombre; si ese plan sí tiene teléfono no se puede confirmar que sea el mismo cliente
    candidatos = n.length >= 5 ? conSaldo.filter(({ plan }) => norm(plan.nombre) === n) : []
    if (candidatos.length === 1 && tel8(candidatos[0].plan.telefono).length === 8)
      return { accion: 'revisar', detalle: `el pago de «${quien}» no trae teléfono y su plan sí: confirmá que es el mismo cliente` }
  }
  if (!candidatos.length) return { accion: 'sin_plan', detalle: `${quien} no tiene un plan con saldo en el tablero de cuotas` }
  if (candidatos.length > 1) return { accion: 'ambiguo', detalle: `${quien} tiene ${candidatos.length} planes con saldo en el tablero de cuotas` }
  const { plan, version } = candidatos[0]
  // ¿Un pago cargado a mano que puede ser este mismo? (no los del bot, que se reconocen por su id; no el "Pagado" inicial)
  const tol = Math.max(10, pago.usd * 0.03)
  const parecido = plan.cuotas.some((c) => !c.inicial && c.pagos.some((p) => !p.anulado && Math.abs(p.centavos / 100 - pago.usd) <= tol && dias(p.fecha, pago.fecha) <= 10
    && !plan.eventos.some((e) => e.id === p.id && e.actor === ACTOR_BOT)))
  if (parecido) return { accion: 'revisar', detalle: `el plan de ${plan.nombre} ya tiene un pago parecido cargado a mano cerca del ${pago.fecha}: puede ser el mismo` }

  const avisos: string[] = []
  let resto = Math.round(pago.usd * 100)
  let siguiente = plan
  const abiertas = [...plan.cuotas].filter((c) => porCobrar(c) > 0).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento))
  const partes: string[] = []
  let ultima: { id: string; i: number; centavos: number } | null = null
  for (const [i, c] of abiertas.entries()) {
    if (resto <= 0) break
    const centavos = Math.min(resto, saldo(c))
    siguiente = modificarPlan(siguiente, { tipo: 'pago', cuota: c.id, monto: (centavos / 100).toFixed(2), fecha: pago.fecha }, idOperacion(pago, i), ACTOR_BOT, ahora)
    partes.push(`USD ${(centavos / 100).toFixed(2)}`)
    resto -= centavos
    ultima = { id: c.id, i, centavos }
  }
  // Diferencia de cambio: solo la última cuota tocada, si le quedó un resto chico
  if (ultima) {
    const c = siguiente.cuotas.find((x) => x.id === ultima!.id)!
    const falta = saldo(c)
    if (falta > 0 && falta <= Math.max(200, Math.round(ultima.centavos * 0.015))) {
      siguiente = modificarPlan(siguiente, { tipo: 'pago', cuota: c.id, monto: (falta / 100).toFixed(2), fecha: pago.fecha }, idOperacion(pago, 30 + ultima.i), ACTOR_BOT, ahora)
      avisos.push(`Diferencia de cambio: faltaban USD ${(falta / 100).toFixed(2)} para la cuota de USD ${(c.centavos / 100).toFixed(2)}; se dio por saldada`)
    }
  }
  if (resto > 0) avisos.push(`Sobraron USD ${(resto / 100).toFixed(2)} sin cuota en el plan de ${plan.nombre}: revisar el plan`)
  return { accion: 'registrado', planId: plan.id, nombre: plan.nombre, plan: siguiente, version, detalle: `registrado en el plan de ${plan.nombre}: ${partes.join(' + ')}`, avisos }
}

/** Lee los planes, registra el pago y guarda (con la versión: si otro lo cambió en el medio, reintenta una vez). Cada consulta
 *  se corta a los 10 s (AbortSignal): no queda nada corriendo en segundo plano que escriba después del aviso. Nunca tira. */
export async function registrarPagoBotEnTablero(pago: PagoCuotaBot): Promise<{ ok: boolean; accion: ResultadoTablero['accion'] | 'error'; detalle: string; avisos: string[] }> {
  if (!esCuotaSiguiente(pago.concepto)) return { ok: true, accion: 'no_aplica', detalle: 'no es una cuota siguiente', avisos: [] }
  const url = process.env.CUOTAS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
  if (!url) return { ok: false, accion: 'error', detalle: 'el tablero de cuotas no tiene base configurada', avisos: [] }
  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = () => neon(url, { fetchOptions: { signal: AbortSignal.timeout(10_000) } })
    for (let intento = 0; intento < 2; intento++) {
      const filas = await sql()`SELECT data, version FROM cj_cuotas_planes`
      const planes: RegistroPlan[] = filas.map((f) => ({ plan: f.data as Plan, version: Number(f.version) }))
      const r = pagoAlTablero(planes, pago)
      if (r.accion !== 'registrado') return { ok: r.accion === 'ya_estaba', accion: r.accion, detalle: r.detalle, avisos: [] }
      const responsable = planes.find((x) => x.plan.id === r.planId)!.plan.responsable
      const g = await sql()`UPDATE cj_cuotas_planes SET data=${JSON.stringify(r.plan)}::jsonb, version=version+1, updated_at=now() WHERE id=${r.planId}::uuid AND version=${r.version} AND owner_id=${responsable} RETURNING id`
      if (g.length) return { ok: true, accion: 'registrado', detalle: r.detalle, avisos: r.avisos }
    }
    return { ok: false, accion: 'error', detalle: 'el plan cambió dos veces mientras se registraba el pago', avisos: [] }
  } catch (e) {
    return { ok: false, accion: 'error', detalle: String((e as Error)?.message ?? e).slice(0, 200), avisos: [] }
  }
}
