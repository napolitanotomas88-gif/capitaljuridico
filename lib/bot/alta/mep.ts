// ── Bot "Capital Jurídico": dólar MEP del día anterior al pago (docs/BOT-ALTA-CJ.md) ─────────────────────
// Tomás, 24/10/2026: un pago en pesos se pasa a USD con el dólar MEP (venta) del DÍA ANTERIOR a la fecha del pago.
// Histórico de argentinadatos, casa "bolsa" (lib/anuncios/dolar.ts); si ese día no hubo cotización (fin de semana o
// feriado), la última anterior.
// SOLO SERVIDOR: buscarMepDiaAnterior() sale a internet. No se usa en el render del simulador (/configuracion/altas),
// que es un componente de cliente: ahí el pago en pesos queda con el MEP como pendiente. La parte pura
// (mepDiaAnteriorDe) se prueba en scripts/test-bot-alta.mjs.
import { dolarHistorico, ventaDelDia } from '../../anuncios/dolar'
import { fechaDiaAnterior } from './finanzas'

export interface MepDiaAnterior {
  venta: number          // dólar MEP (venta): va a ExtrasRegistro.mepDiaAnterior
  diaAnterior: string    // 'aaaa-mm-dd': el día anterior al pago
  fechaCotizacion: string // 'aaaa-mm-dd': el día de la cotización usada (el anterior con cotización si ese día no hubo)
}

/** Puro: MEP (venta) del día anterior a `fechaPago` ('aaaa-mm-dd') a partir del histórico {fecha: venta}.
 *  null si la fecha no es real o si no hay ninguna cotización hasta ese día. */
export function mepDiaAnteriorDe(historico: Record<string, number>, fechaPago: string): MepDiaAnterior | null {
  const dia = fechaDiaAnterior(fechaPago)
  if (!dia) return null
  const fechas = Object.keys(historico).sort()
  const venta = ventaDelDia(historico, dia, fechas)
  if (venta === null) return null
  const anteriores = fechas.filter((f) => f <= dia)
  const fechaCotizacion = historico[dia] ? dia : anteriores[anteriores.length - 1]
  return { venta, diaAnterior: dia, fechaCotizacion }
}

/** Con red (solo servidor): busca el histórico del MEP y devuelve la venta del día anterior al pago. */
export async function buscarMepDiaAnterior(fechaPago: string): Promise<MepDiaAnterior | null> {
  return mepDiaAnteriorDe(await dolarHistorico('bolsa'), fechaPago)
}
