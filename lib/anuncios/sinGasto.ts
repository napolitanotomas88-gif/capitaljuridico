// ── Por qué un cliente del tablero no gasta (pedido de Tomás, 3/11/2026) ─────────────────────────────
// En el grupo «Sin gasto» se ve, al lado del nombre, hasta cuándo está pausado el cliente o la causa real en Meta.
//   · Pausa del cliente (acción «pausa» del Despacho, cj_cliente_acciones; o PAUSADO en el CRM): «Pausado hasta DD/MM ·
//     motivo», o «Pausado · <condición de vuelta>», o «Pausado · sin fecha de vuelta».
//   · Si no está pausado: error de pago o deuda, sin medio de pago, campañas en pausa (sin anuncios activos) o, si no se
//     ve nada en Meta, «sin gasto en el período».
// Puro: la pausa la trae pausasVigentes (pausas.ts) y la fila es la del tablero.
import type { Analisis } from './reglas'

export interface PausaCliente {
  desde: string                // YYYY-MM-DD
  hasta: string | null         // fecha de vuelta, si se cargó
  vuelta: string | null        // condición de vuelta («cuando agende la proyección»), si no hay fecha
  motivo: string | null
}

export type TipoSinGasto = 'pausa' | 'pago' | 'sin_medio_pago' | 'campanas_pausadas' | 'sin_gasto'
export interface CausaSinGasto { tipo: TipoSinGasto; texto: string; hasta: string | null }

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const corto = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
/** Sin referencias internas («(ac_…)», «en sombra»): el motivo es para leer. */
const limpio = (s: string) => s.replace(/\(?\bac_[a-z0-9]+[^)]*\)?/gi, '').replace(/\ben sombra\b/gi, '').replace(/\s+/g, ' ').replace(/[\s·,;:-]+$/, '').trim()

export function textoPausa(p: PausaCliente | null): string {
  if (!p) return 'Pausado · sin fecha de vuelta'
  const m = p.motivo ? limpio(p.motivo) : ''
  const motivo = m ? ` · ${corto(m)}` : ''
  if (p.hasta) return `Pausado hasta ${dm(p.hasta)}${motivo}`
  if (p.vuelta?.trim()) return `Pausado · ${corto(p.vuelta.trim())}${motivo}`
  return `Pausado · sin fecha de vuelta${motivo}`
}

/** La causa para una fila (null si gasta y no está pausada). `pausa` = la pausa vigente del cliente en el Despacho. */
export function causaSinGasto(
  f: { pausado: boolean; gasto?: { hoy: number }; pago: Pick<Analisis['pago'], 'errorPago' | 'sinMedioPago' | 'texto' | 'periodoGracia'>; corriendo: Pick<Analisis['corriendo'], 'sinAnunciosActivos'>; semaforo: Analisis['semaforo'] },
  pausa: PausaCliente | null,
): CausaSinGasto | null {
  if (pausa || f.pausado) return { tipo: 'pausa', texto: `${textoPausa(pausa)}${f.pago.errorPago ? ' · deuda en Meta' : ''}`, hasta: pausa?.hasta ?? null }
  if (f.semaforo !== 'sin_gasto' && f.semaforo !== 'error') return null
  if (f.pago.errorPago) return { tipo: 'pago', texto: f.pago.texto[0].toUpperCase() + f.pago.texto.slice(1), hasta: null }
  if (f.pago.sinMedioPago && !f.pago.periodoGracia) return { tipo: 'sin_medio_pago', texto: 'Sin medio de pago en Meta', hasta: null }
  if (f.semaforo !== 'sin_gasto') return null
  if ((f.gasto?.hoy ?? 0) > 0) return { tipo: 'sin_gasto', texto: 'Empezó a gastar hoy', hasta: null }
  if (f.corriendo.sinAnunciosActivos) return { tipo: 'campanas_pausadas', texto: 'Campañas en pausa en Meta', hasta: null }
  return { tipo: 'sin_gasto', texto: 'Sin gasto en el período (Meta no muestra un freno)', hasta: null }
}
