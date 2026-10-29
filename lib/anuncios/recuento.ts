// ── Recuento de días malos de Meta para un período (un mes entero o fechas elegidas) ──────────
// Pide a Meta el gasto y los mensajes diarios de TODAS las cuentas seguidas, desde 28 días antes
// del período (para tener la base de comparación de los primeros días) hasta el final, y corre el
// mismo detector que el tablero en vivo (diasMalos.ts). Además suma gasto y mensajes del período
// en USD: lo que está en pesos se pasa con el dólar VENTA de cada día (dolar.ts).
import { createHash } from 'node:crypto'
import { conCache } from './cache'
import { detectarDiasMeta, type DiaMeta } from './diasMalos'
import { dolarHistorico, monedasPorUSD, ventaDelDia, type CasaDolar } from './dolar'
import { diasEntre, hoyAR, sumarDias } from './formato'
import { leerInsightsRango } from './meta'
import { obtenerTablero } from './tablero'
import { diaSemana } from './feriados'

export const MAX_DIAS_RECUENTO = 186   // ~6 meses por consulta
const BASE_PREVIA = 28

export interface Recuento {
  desde: string
  hasta: string
  generado: string
  dias: DiaMeta[]                       // cada día del período (los que tuvieron cuentas comparables)
  malos: number
  malosHabiles: number
  malosFinde: number
  porDiaSemana: number[]                // días malos por día de la semana (0 = domingo)
  totales: {
    gastoUSD: number
    mensajes: number
    cplUSD: number | null
    cplUSDMalos: number | null          // CPL general en los días malos
    cplUSDNormales: number | null       // y en el resto
    cuentas: number                     // cuentas con gasto en el período
    sinConvertir: number                // cuentas en otras monedas sin cotización disponible (no se suman)
  }
  dolar: { casa: CasaDolar; promedio: number | null; error: string | null }
  avisos: string[]
}

export function validarPeriodo(desde: string | null, hasta: string | null): { desde: string; hasta: string } | { error: string } {
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  if (!desde || !hasta || !ymd.test(desde) || !ymd.test(hasta)) return { error: 'Fechas inválidas: usar AAAA-MM-DD' }
  const ayer = sumarDias(hoyAR(), -1)
  const h = hasta > ayer ? ayer : hasta
  if (desde > h) return { error: 'La fecha "desde" tiene que ser anterior a "hasta" (y hasta ayer como mucho)' }
  if (desde < '2024-01-01') return { error: 'Solo hay datos desde 2024' }
  if (diasEntre(desde, h) + 1 > MAX_DIAS_RECUENTO) return { error: `Máximo ${MAX_DIAS_RECUENTO} días por consulta` }
  return { desde, hasta: h }
}

async function calcular(desde: string, hasta: string, casa: CasaDolar): Promise<Recuento> {
  const tablero = await obtenerTablero()   // de caché: da las cuentas seguidas y su moneda
  const monedas: Record<string, string> = {}
  for (const f of tablero.filas) monedas[f.id] = f.moneda
  for (const e of tablero.excluidas) monedas[e.id] = e.moneda
  const ids = Object.keys(monedas)
  const avisos: string[] = []

  const [insights, historico, fx] = await Promise.all([
    leerInsightsRango(ids, sumarDias(desde, -BASE_PREVIA), hasta),
    dolarHistorico(casa).then(h => ({ h, error: null as string | null })).catch(e => ({ h: null, error: (e as Error).message })),
    // Otras monedas: cotización del último día del período (si falla, la de hoy)
    monedasPorUSD(hasta).catch(() => monedasPorUSD()).catch(() => null),
  ])
  const fallidas = Object.keys(insights.errores).length
  if (fallidas) avisos.push(`${fallidas} cuenta${fallidas > 1 ? 's' : ''} no se pudo leer de Meta: el recuento usa el resto.`)
  if (insights.limitado) avisos.push('Meta limitó algunos pedidos: probá de nuevo en unos minutos para el recuento completo.')
  if (historico.error) avisos.push(`No se pudo leer el dólar histórico (${historico.error}): los totales en pesos no se suman.`)

  const nDias = diasEntre(desde, hasta) + 1
  const dias = detectarDiasMeta(insights.porCuenta, monedas, sumarDias(hasta, 1), nDias)
  const malosSet = new Set(dias.filter(x => x.malo).map(x => x.d))
  const porDiaSemana = [0, 0, 0, 0, 0, 0, 0]
  for (const d of malosSet) porDiaSemana[diaSemana(d)]++

  // Totales en USD del período
  const fechasDolar = historico.h ? Object.keys(historico.h).sort() : []
  let gT = 0, mT = 0, gM = 0, mM = 0, sinConvertir = 0, cuentas = 0, sumaTasa = 0, nTasa = 0
  for (const [id, xs] of Object.entries(insights.porCuenta)) {
    const moneda = monedas[id] ?? 'USD'
    const delPeriodo = xs.filter(x => x.d >= desde && x.d <= hasta && (x.g > 0 || x.m > 0))
    if (!delPeriodo.length) continue
    const otra = moneda !== 'USD' && moneda !== 'ARS' ? fx?.[moneda] ?? null : null
    if (moneda !== 'USD' && moneda !== 'ARS' && !otra) { sinConvertir++; continue }
    if (moneda === 'ARS' && !historico.h) continue
    cuentas++
    for (const x of delPeriodo) {
      let g = x.g
      if (moneda === 'ARS') {
        const t = ventaDelDia(historico.h!, x.d, fechasDolar)
        if (!t) continue
        g = x.g / t; sumaTasa += t; nTasa++
      } else if (otra) g = x.g / otra
      gT += g; mT += x.m
      if (malosSet.has(x.d)) { gM += g; mM += x.m }
    }
  }
  const cpl = (g: number, m: number) => (m > 0 ? g / m : null)
  return {
    desde, hasta, generado: new Date().toISOString(),
    dias,
    malos: malosSet.size,
    malosHabiles: dias.filter(x => x.malo && x.tipo === 'habil').length,
    malosFinde: dias.filter(x => x.malo && x.tipo === 'finde').length,
    porDiaSemana,
    totales: {
      gastoUSD: Math.round(gT * 100) / 100, mensajes: mT,
      cplUSD: cpl(gT, mT), cplUSDMalos: cpl(gM, mM), cplUSDNormales: cpl(gT - gM, mT - mM),
      cuentas, sinConvertir,
    },
    dolar: { casa, promedio: nTasa ? sumaTasa / nTasa : null, error: historico.error },
    avisos,
  }
}

// Períodos cerrados (terminan antes de anteayer) no cambian: caché de 12 h. Si incluye días recientes, 12 min.
export async function recuentoMeta(desde: string, hasta: string, casa: CasaDolar): Promise<Recuento> {
  const cerrado = hasta < sumarDias(hoyAR(), -2)
  const clave = createHash('sha1').update(`${desde}|${hasta}|${casa}`).digest('hex').slice(0, 12)
  const r = await conCache(`recuento:${clave}`, cerrado ? 43_200 : 720, () => calcular(desde, hasta, casa))
  return r.data
}
