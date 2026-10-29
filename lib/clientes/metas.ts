// ── Metas del programa de referidos y KPI principal (funciones PURAS, sin red ni reloj) ─────────
// KPI principal: % de los clientes nuevos del mes que entran por referido.
//   · "Clientes nuevos del mes" = clientes de Agencia, con ID y que cuentan para las métricas (cuentaEnMetricas), cuyo
//     Día 1 cae en ese mes.
//   · "Entran por referido" = su ID figura como "ID cliente nuevo" en un referido con estado Cerró (cada cliente cuenta
//     una vez aunque lo hayan presentado dos). Un reembolso no le quita el origen: entró por referido igual.
//   · Un cierre sin "ID cliente nuevo" cargado no se puede ubicar en ningún cliente: se informa aparte (cierresSinCliente),
//     no se estima ni se suma.
// Las metas y los indicadores de apoyo están en reglasReferidos.ts (metas); acá solo se leen.
import type { Cliente, Referido, Ymd } from './tipos'
import type { HitoMeta, IndicadorApoyo, ReglasReferidos } from './reglasReferidos'
import { REGLAS_REFERIDOS } from './reglasReferidos'
import { exigirYmd } from './fechas'
import { usd } from './formato'

/** Mes calendario 'AAAA-MM' */
export type Mes = string

export const esMesValido = (m: unknown): m is Mes => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

/** '2026-10-06' → '2026-10' (la fecha tiene que ser real) */
export const mesDe = (ymd: Ymd): Mes => exigirYmd(ymd).slice(0, 7)

const exigirMes = (m: unknown): Mes => {
  if (!esMesValido(m)) throw new TypeError(`mes inválido: se esperaba 'AAAA-MM' y llegó ${JSON.stringify(m)}`)
  return m
}

// ── Meta del mes ─────────────────────────────────────────────────────────────────────────
export interface MetaDelMes {
  mes: Mes
  minPct: number
  maxPct: number
  hitoDesde: Mes                  // mes del hito que fija esta meta
  esHito: boolean                 // true = el mes es justo el del hito; false = rige la última meta fijada
  siguiente: HitoMeta | null      // próximo hito (null = es el último)
}

// Octubre 2026 = 5 %, diciembre 2026 = 10 %, marzo 2027 = 15 a 20 %. Entre hitos rige la última meta fijada (noviembre: 5 %); después
// del último, ese mismo rango. Antes del primer hito (o del inicio del programa) todavía no hay meta: null.
export function metaDelMes(mes: Mes, reglas: ReglasReferidos = REGLAS_REFERIDOS): MetaDelMes | null {
  exigirMes(mes)
  const hitos = [...reglas.metas.kpiPrincipal.hitos].sort((a, b) => a.desde.localeCompare(b.desde))
  if (mes < mesDe(reglas.vigenteDesde)) return null
  let idx = -1
  hitos.forEach((h, i) => { if (h.desde <= mes) idx = i })
  if (idx < 0) return null
  const h = hitos[idx]
  return { mes, minPct: h.minPct, maxPct: h.maxPct, hitoDesde: h.desde, esHito: h.desde === mes, siguiente: hitos[idx + 1] ?? null }
}

// ── KPI real del mes ─────────────────────────────────────────────────────────────────────
export type EstadoKpi =
  | 'sin_pestana'          // todavía no existe la pestaña Referidos: no hay de dónde calcularlo
  | 'sin_clientes_nuevos'  // el mes no tiene clientes nuevos: no se puede sacar un porcentaje
  | 'ok'

export interface KpiReferidos {
  mes: Mes
  estado: EstadoKpi
  clientesNuevos: number          // Agencia, con ID, que cuentan, con Día 1 en el mes
  porReferido: number             // de esos, los que vinieron por un referido que Cerró
  porcentaje: number | null       // 0 a 100 (sin redondear); null si no se puede calcular
  meta: MetaDelMes | null
  cumpleMeta: boolean | null      // porcentaje >= meta mínima; null si falta el porcentaje o la meta
  cierresSinCliente: number       // cierres del mes sin "ID cliente nuevo": no se pueden ubicar
}

export interface EntradaKpi {
  clientes: Cliente[]
  referidos: Referido[]
  hoy: Ymd
  mes?: Mes                       // por defecto, el mes de hoy
  pestanaReferidosAusente?: boolean
}

const normId = (id: unknown) => (id ?? '').toString().trim().toUpperCase()

export function kpiClientesNuevosPorReferido(e: EntradaKpi, reglas: ReglasReferidos = REGLAS_REFERIDOS): KpiReferidos {
  if (!e || !Array.isArray(e.clientes) || !Array.isArray(e.referidos)) throw new TypeError('clientes y referidos deben ser listas')
  const mes = e.mes === undefined ? mesDe(e.hoy) : exigirMes(e.mes)
  const meta = metaDelMes(mes, reglas)

  const nuevos = e.clientes.filter(c => c && c.cuentaEnMetricas && !!c.id && !!c.dia1 && c.dia1.slice(0, 7) === mes)
  const cierres = e.referidos.filter(r => r && r.estado === 'Cerró')
  const idsPorReferido = new Set(cierres.map(r => normId(r.idClienteNuevo)).filter(Boolean))
  const porReferido = nuevos.filter(c => idsPorReferido.has(normId(c.id))).length

  // Cierres sin "ID cliente nuevo" cuyo mes (o el que se pueda deducir) es el pedido, o que no traen ninguna fecha
  const cierresSinCliente = cierres.filter(r => {
    if (normId(r.idClienteNuevo)) return false
    const f = r.fechaPrimerPago ?? r.fechaLlamada ?? r.fechaPedido
    return !f || f.slice(0, 7) === mes
  }).length

  const sinPestana = e.pestanaReferidosAusente === true
  const estado: EstadoKpi = sinPestana ? 'sin_pestana' : nuevos.length === 0 ? 'sin_clientes_nuevos' : 'ok'
  const porcentaje = estado === 'ok' ? (porReferido / nuevos.length) * 100 : null
  return {
    mes,
    estado,
    clientesNuevos: nuevos.length,
    porReferido: sinPestana ? 0 : porReferido,
    porcentaje,
    meta,
    cumpleMeta: porcentaje !== null && meta ? porcentaje >= meta.minPct : null,
    cierresSinCliente: sinPestana ? 0 : cierresSinCliente,
  }
}

// ── Textos de metas para las pantallas ───────────────────────────────────────────────────
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-10' → "octubre de 2026" */
export function mesLargo(mes: Mes): string {
  exigirMes(mes)
  return `${MESES[+mes.slice(5, 7) - 1]} de ${mes.slice(0, 4)}`
}

/** 5 → "5 %"; 12.5 → "12,5 %" (coma decimal; sin decimales si es entero) */
export const porcentajeTexto = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')} %`

/** { minPct: 15, maxPct: 20 } → "15 a 20 %"; { minPct: 5, maxPct: 5 } → "5 %" */
export const rangoMetaTexto = (m: Pick<HitoMeta, 'minPct' | 'maxPct'>): string =>
  m.minPct === m.maxPct ? porcentajeTexto(m.minPct) : `${m.minPct} a ${porcentajeTexto(m.maxPct)}`

/** Indicador de apoyo en palabras: "60 %", "8 a 10 %", "30 % o más", "menos de USD 446" */
export function objetivoApoyoTexto(i: IndicadorApoyo): string {
  const num = (n: number) => (i.unidad === 'usd' ? usd(n) : porcentajeTexto(n))
  switch (i.comparacion) {
    case 'cerca_de': return num(i.valor)
    case 'entre': return i.unidad === 'usd' ? `entre ${num(i.valor)} y ${num(i.hasta ?? i.valor)}` : `${i.valor} a ${porcentajeTexto(i.hasta ?? i.valor)}`
    case 'al_menos': return `${num(i.valor)} o más`
    case 'menos_de': return `menos de ${num(i.valor)}`
  }
}
