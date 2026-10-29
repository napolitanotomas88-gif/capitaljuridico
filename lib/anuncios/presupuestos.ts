import { sumarDias } from './formato'
import type { DiaInsight } from './meta'
export interface Presupuesto {
  mensualUSD: number | null; objetivoDiarioUSD: number | null; realDiarioUSD: number | null
  gastadoMesUSD: number | null; proyeccionUSD: number | null; ajusteDiarioUSD: number | null
  configuradoDiarioUSD?: number | null; configuradoNota?: string
  fuente: string; estado: 'exceso' | 'corto' | 'en_rango' | 'sin_datos' | 'sin_presupuesto' | 'pausado'
}
export function evaluarPresupuesto(mensualUSD: number | null, dias: DiaInsight[] | null, hoy: string, usdPor: number | null, pausado: boolean, fuente: string): Presupuesto {
  const inicio = hoy.slice(0, 7) + '-01', ayer = sumarDias(hoy, -1)
  const [y, mes, dia] = hoy.split('-').map(Number)
  const diasMes = new Date(Date.UTC(y, mes, 0)).getUTCDate(), completos = dia - 1
  const objetivoDiarioUSD = mensualUSD == null ? null : mensualUSD / diasMes
  const medible = dias != null && usdPor != null && usdPor > 0
  const gasto = (desde: string, hasta: string) => dias!.filter(d => d.d >= desde && d.d <= hasta).reduce((s, d) => s + d.g, 0) / usdPor!
  const realDiarioUSD = medible ? gasto(sumarDias(hoy, -7), ayer) / 7 : null
  const gastadoMesUSD = medible && completos > 0 ? gasto(inicio, ayer) : null
  const proyeccionUSD = gastadoMesUSD == null ? null : gastadoMesUSD / completos * diasMes
  const ajusteDiarioUSD = mensualUSD == null || gastadoMesUSD == null ? null : Math.max(0, mensualUSD - gastadoMesUSD) / (diasMes - completos)
  const estado = mensualUSD == null ? 'sin_presupuesto' : pausado ? 'pausado' : proyeccionUSD == null ? 'sin_datos'
    : Math.round(proyeccionUSD * 100) - Math.round(mensualUSD * 100) > 2000 ? 'exceso' : Math.round(proyeccionUSD * 100) - Math.round(mensualUSD * 100) < -2000 ? 'corto' : 'en_rango'
  return { mensualUSD, objetivoDiarioUSD, realDiarioUSD, gastadoMesUSD, proyeccionUSD, ajusteDiarioUSD, fuente, estado }
}
