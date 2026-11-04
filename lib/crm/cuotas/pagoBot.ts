// ── Pago de cuota del bot → tablero de Cuotas (Tomás, 4/11/2026) ────────────────────────────────────────────────────
// «Aplicá ese código para que lea lo que armamos para los pagos de cuotas que vayan entrando»: cuando el bot carga en
// Finanzas la 2da, 3ra… cuota de un cliente, el pago se registra solo en su plan de /cuotas (si no, el tablero sigue
// pidiendo un pago que ya entró). Corre DESPUÉS de que la fila quedó verificada en la planilla (finanzasEscribir.ts): si
// falla, el pago queda cargado igual en Finanzas y se avisa.
//   · Solo cuotas que siguen a la primera ("2da Cuota", "3ra Cuota"…): la 1ra, los Fee y los PIF son de altas nuevas, que
//     el closer arma en el tablero con su propio "Pagado".
//   · El plan: el único que no esté abandonado, tenga saldo y sea del mismo cliente (los últimos 8 dígitos del teléfono; el
//     nombre solo si a alguno le falta el teléfono). Ninguno o más de uno: no se toca nada y se avisa.
//   · Sin duplicados: si el plan ya tiene un pago parecido (±USD 2 y ±5 días), no se registra otro. Los ids de operación
//     salen del pago, así que reintentar es idempotente.
//   · El monto va a las cuotas en orden de vencimiento. Una diferencia de cambio chica (hasta USD 10 o el 2 %) da la cuota
//     por saldada, para que no quede un resto de centavos pidiéndose.
import { createHash } from 'node:crypto'
import { modificarPlan, porCobrar, saldo, type Plan, type RegistroPlan } from './modelo'

export const ACTOR_BOT = 'Bot de altas (cuota cargada en Finanzas)'

export interface PagoCuotaBot { fecha: string; nombre: string | null; telefono: string | null; usd: number; concepto: string }
export type ResultadoTablero =
  | { accion: 'registrado'; planId: string; nombre: string; plan: Plan; version: number; detalle: string; avisos: string[] }
  | { accion: 'ya_estaba' | 'no_aplica'; detalle: string }
  | { accion: 'sin_plan' | 'ambiguo'; detalle: string }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tel8 = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-8)
const dias = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5
const pendiente = (p: Plan) => p.cuotas.reduce((s, c) => s + porCobrar(c), 0)

/** ¿Este concepto es una cuota que sigue a la primera? ("2da Cuota", "3ra Cuota", "Cuota 13"…) */
export const esCuotaSiguiente = (concepto: string) => /cuota/i.test(concepto) && !/^\s*1\s*ra\b/i.test(concepto)

/** Id de operación estable para el pago (uuid con forma v4, del sha256 del pago y la cuota): reintentar no duplica. */
export function idOperacion(pago: PagoCuotaBot, i: number): string {
  const h = createHash('sha256').update(`pago-bot|${pago.fecha}|${tel8(pago.telefono) || norm(pago.nombre)}|${pago.usd}|${i}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Decide y arma el cambio. Pura: no lee ni escribe nada. */
export function pagoAlTablero(planes: readonly RegistroPlan[], pago: PagoCuotaBot, ahora = new Date()): ResultadoTablero {
  if (!esCuotaSiguiente(pago.concepto)) return { accion: 'no_aplica', detalle: `«${pago.concepto}» no es una cuota de un cliente existente` }
  if (!(pago.usd > 0)) return { accion: 'no_aplica', detalle: 'sin monto en USD' }
  const t = tel8(pago.telefono), n = norm(pago.nombre)
  const candidatos = planes.filter(({ plan }) => {
    if (plan.abandonado || pendiente(plan) <= 0) return false
    const pt = tel8(plan.telefono)
    if (t.length === 8 && pt.length === 8) return pt === t
    return n.length >= 5 && norm(plan.nombre) === n
  })
  const quien = pago.nombre ?? 'el cliente'
  if (!candidatos.length) return { accion: 'sin_plan', detalle: `${quien} no tiene un plan con saldo en el tablero de cuotas` }
  if (candidatos.length > 1) return { accion: 'ambiguo', detalle: `${quien} tiene ${candidatos.length} planes con saldo en el tablero de cuotas` }
  const { plan, version } = candidatos[0]
  const parecido = plan.cuotas.some((c) => c.pagos.some((p) => !p.anulado && Math.abs(p.centavos / 100 - pago.usd) <= 2 && dias(p.fecha, pago.fecha) <= 5))
  if (parecido) return { accion: 'ya_estaba', detalle: `el plan de ${plan.nombre} ya tiene un pago de unos USD ${pago.usd} cerca del ${pago.fecha}` }

  const avisos: string[] = []
  let resto = Math.round(pago.usd * 100)
  let siguiente = plan
  const abiertas = [...plan.cuotas].filter((c) => porCobrar(c) > 0).sort((a, b) => (a.promesa || a.vencimiento).localeCompare(b.promesa || b.vencimiento))
  const partes: string[] = []
  for (const [i, c] of abiertas.entries()) {
    if (resto <= 0) break
    const s = saldo(c)
    const tolerancia = Math.max(1000, Math.round(s * 0.02))
    // Un resto chico de esta cuota (diferencia de cambio) la da por saldada; si no, va lo que alcance
    const centavos = resto >= s || s - resto <= tolerancia ? s : resto
    if (centavos !== resto && centavos > resto) avisos.push(`Diferencia de cambio: entraron USD ${(resto / 100).toFixed(2)} y la cuota era de USD ${(s / 100).toFixed(2)}; se dio por saldada`)
    siguiente = modificarPlan(siguiente, { tipo: 'pago', cuota: c.id, monto: (centavos / 100).toFixed(2), fecha: pago.fecha }, idOperacion(pago, i), ACTOR_BOT, ahora)
    partes.push(`USD ${(centavos / 100).toFixed(2)}`)
    resto -= Math.min(resto, centavos)
  }
  if (resto > 100) avisos.push(`Sobraron USD ${(resto / 100).toFixed(2)} sin cuota en el plan de ${plan.nombre}: revisar el plan`)
  return { accion: 'registrado', planId: plan.id, nombre: plan.nombre, plan: siguiente, version, detalle: `registrado en el plan de ${plan.nombre}: ${partes.join(' + ')}`, avisos }
}

/** Lee los planes, registra el pago y guarda (con la versión: si otro lo cambió en el medio, reintenta una vez). Nunca tira. */
export async function registrarPagoBotEnTablero(pago: PagoCuotaBot): Promise<{ ok: boolean; accion: ResultadoTablero['accion'] | 'error'; detalle: string; avisos: string[] }> {
  if (!esCuotaSiguiente(pago.concepto)) return { ok: true, accion: 'no_aplica', detalle: 'no es una cuota siguiente', avisos: [] }
  try {
    const { configurado, guardarPlan, listarPlanes } = await import('./db')
    if (!configurado()) return { ok: false, accion: 'error', detalle: 'el tablero de cuotas no tiene base configurada', avisos: [] }
    for (let intento = 0; intento < 2; intento++) {
      const planes = await listarPlanes()
      const r = pagoAlTablero(planes, pago)
      if (r.accion !== 'registrado') return { ok: r.accion === 'ya_estaba', accion: r.accion, detalle: r.detalle, avisos: [] }
      const responsable = planes.find((x) => x.plan.id === r.planId)!.plan.responsable
      if (await guardarPlan(r.plan, r.version, responsable)) return { ok: true, accion: 'registrado', detalle: r.detalle, avisos: r.avisos }
    }
    return { ok: false, accion: 'error', detalle: 'el plan cambió dos veces mientras se registraba el pago', avisos: [] }
  } catch (e) {
    return { ok: false, accion: 'error', detalle: String((e as Error)?.message ?? e).slice(0, 200), avisos: [] }
  }
}
