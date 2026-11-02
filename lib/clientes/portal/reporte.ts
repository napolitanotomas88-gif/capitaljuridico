// ── Portal del cliente: reporte de anuncios (puro: sin red ni base; lo prueba scripts/test-portal-reporte.mjs) ─────────────
// 2/11/2026 (pedido de Tomás para un estudio cliente): cuánto le sale cada mensaje, cuánto cada caso real, cuánto invierte y cuánto
// le queda de profit, con el valor promedio por caso que carga el equipo (por defecto USD 2.000). Los ingresos son ESTIMADOS
// (casos × valor promedio): la pantalla lo aclara. Divisiones por cero → null (la pantalla muestra «—»), nunca Infinity ni NaN.
import { casosDelMes, type PuntoCasos } from './modelo'

/** Una fila de insights de Meta: una campaña en un mes, en la moneda de su cuenta. */
export interface FilaAnuncios { mes: string; campana: string; gasto: number; mensajes: number }
export type TipoCampana = 'mensajes' | 'seguidores'

/** Follow Me Ads (campañas para sumar seguidores) se reconocen por el nombre: «FM», «Follow» o «Seguidores». El resto es DM. */
export function tipoCampana(nombre: string): TipoCampana {
  return /(^|[^a-z0-9])fm([^a-z0-9]|$)|follow|seguidor/i.test(nombre) ? 'seguidores' : 'mensajes'
}

export interface Metricas {
  /** Inversión total en anuncios (DM + Follow Me) */
  inversion: number
  inversionMensajes: number
  inversionSeguidores: number
  /** Conversaciones iniciadas (de las campañas de mensajes) */
  mensajes: number
  /** inversión en campañas de mensajes / mensajes */
  costoMensaje: number | null
  casos: number | null
  /** inversión total / casos */
  costoCaso: number | null
  /** casos × valor promedio por caso (estimado) */
  ingresos: number | null
  /** ingresos − inversión */
  profit: number | null
  /** ingresos / inversión (cuántas veces vuelve lo invertido) */
  retorno: number | null
}

const div = (a: number, b: number | null): number | null => (b !== null && b > 0 && Number.isFinite(a) ? a / b : null)
const red = (n: number) => Math.round(n * 100) / 100

export function calcularMetricas(filas: readonly FilaAnuncios[], casos: number | null, valorCaso: number): Metricas {
  let inversionMensajes = 0, inversionSeguidores = 0, mensajes = 0
  for (const f of filas) {
    const g = Number.isFinite(f.gasto) && f.gasto > 0 ? f.gasto : 0
    if (tipoCampana(f.campana) === 'seguidores') inversionSeguidores += g
    else { inversionMensajes += g; mensajes += Number.isFinite(f.mensajes) && f.mensajes > 0 ? f.mensajes : 0 }
  }
  const inversion = inversionMensajes + inversionSeguidores
  const c = casos !== null && Number.isFinite(casos) && casos >= 0 ? casos : null
  const ingresos = c !== null && valorCaso > 0 ? c * valorCaso : null
  const costoMensaje = div(inversionMensajes, mensajes)
  const costoCaso = div(inversion, c)
  const retorno = ingresos !== null ? div(ingresos, inversion) : null
  return {
    inversion: red(inversion), inversionMensajes: red(inversionMensajes), inversionSeguidores: red(inversionSeguidores), mensajes,
    costoMensaje: costoMensaje === null ? null : red(costoMensaje), casos: c, costoCaso: costoCaso === null ? null : red(costoCaso),
    ingresos: ingresos === null ? null : red(ingresos), profit: ingresos === null ? null : red(ingresos - inversion),
    retorno: retorno === null ? null : Math.round(retorno * 10) / 10,
  }
}

export interface MesReporte extends Metricas { mes: string }
export interface Reporte {
  /** Primer mes con inversión (desde cuándo cuenta el acumulado) */
  desde: string | null
  acumulado: Metricas
  mesActual: MesReporte
  /** Meses con inversión, del más nuevo al más viejo */
  porMes: MesReporte[]
  /** Qué parte de la inversión fue a Follow Me Ads (0–100, null sin inversión) */
  porcentajeSeguidores: number | null
  valorCaso: number
}

/**
 * Arma el reporte: acumulado desde el primer mes con inversión (con los casos totales del contador) y cada mes (con los casos
 * del mes solo si salen del historial; si no, null: el costo por caso del mes queda «—» en vez de inventarlo).
 */
export function armarReporte(filas: readonly FilaAnuncios[], o: { casos: number | null; historial: readonly PuntoCasos[]; valorCaso: number; mesActual: string }): Reporte {
  const meses = [...new Set(filas.filter(f => f.gasto > 0 || f.mensajes > 0).map(f => f.mes))].sort()
  const delMes = (m: string) => filas.filter(f => f.mes === m)
  const casosMes = (m: string) => casosDelMes(o.historial, m)
  const acumulado = calcularMetricas(filas, o.casos, o.valorCaso)
  return {
    desde: meses[0] ?? null,
    acumulado,
    mesActual: { mes: o.mesActual, ...calcularMetricas(delMes(o.mesActual), casosMes(o.mesActual), o.valorCaso) },
    porMes: meses.reverse().map(m => ({ mes: m, ...calcularMetricas(delMes(m), casosMes(m), o.valorCaso) })),
    porcentajeSeguidores: acumulado.inversion > 0 ? Math.round((acumulado.inversionSeguidores / acumulado.inversion) * 100) : null,
    valorCaso: o.valorCaso,
  }
}

/** "2026-11" → "noviembre de 2026" */
export function nombreMes(mes: string): string {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const [a, m] = mes.split('-').map(Number)
  return m >= 1 && m <= 12 ? `${MESES[m - 1]} de ${a}` : mes
}

/** USD con separadores argentinos: 12.048,73 → "USD 12.049" (o con 2 decimales si se pide). null → «—». */
export function usd(n: number | null, decimales = 0): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const t = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return `${n < 0 ? '−' : ''}USD ${t}`
}
export const numero = (n: number | null): string => (n === null || !Number.isFinite(n) ? '—' : n.toLocaleString('es-AR'))
