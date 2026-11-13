// ── Señales del puntaje de cada cliente, a partir de lo que la cartera YA lee (puro: sin red ni base) ──────────────────────
// De dónde sale cada señal (especificación v1, 13/11/2026):
//   · Encuesta del cliente: SOLO las filas de fuente «typeform» (Seguimiento del CRM o la planilla del Typeform cruzada por
//     lib/seguimiento/typeform.ts). Los puntajes «manual» del botón «Puntuar» son la mirada del equipo y NO cuentan.
//     También las respuestas del Typeform que el equipo asignó a mano en /clientes/encuesta (cj_encuesta_asignaciones): siguen
//     siendo lo que respondió el cliente (conAsignadas). Descartar o reasignar una respuesta que el cruce automático ya había
//     unido a otro cliente se la saca a ese cliente.
//   · Rama: la del tablero de Anuncios (la que fija el KPI del costo por mensaje y usa la cartera), con su calidad de
//     CALIDAD_RAMA. Solo informativa.
//   · Meta: la campaña de la cartera (campanasMetaCartera → lib/clientes/produccion.ts, caché compartida): activa, color del
//     costo por mensaje, gasto diario real y pactado, semáforo y error de pago. Sin lectura de Meta: todo el bloque sin dato.
//   · Promesa y renovación: columnas «Promesa» y «Renovó» del CRM (y las renovaciones pagas de la pestaña Renovaciones).
//   · Wins: cj_wins (lib/clientes/wins), los de los últimos 60 días.
//   · EOW: el último reporte (cj_eow_reportes): el color de su fila y si figura en «Cliente pesadilla», vinculado con el mismo
//     cruce del EOW (lib/eow/vinculo.ts: ID puesto a mano o nombre que calza con un solo cliente; nunca adivina).
//   · Pagos: los planes del tablero de cuotas (cj_cuotas_planes), cruzados por teléfono o nombre con UN solo cliente.
//   · Referidos: la pestaña Referidos del CRM (presentó al menos uno que no esté descartado).
//   · Graba y responde a tiempo: el Despacho todavía no tiene una señal clara (queda sin dato).
import type { CampanaMeta } from './prioridad'
import type { Cliente, Referido, Ymd } from './tipos'
import { calcularPuntaje, type ColorSemaforo, type ResultadoPuntaje, type SenalesPuntaje } from './puntaje'
import { contarWinsDesde } from './wins/modelo'
import { normalizarNombreCobro, telefonoCobro } from './cobrosFinanzas'
import { crearVinculador, type ClienteCartera } from '../eow/vinculo'
import type { DatosEow } from '../eow/modelo'
import { CALIDAD_RAMA, NOMBRE_RAMA, type FuenteRama, type Rama } from '../anuncios/ramas'
import type { RamaPuntaje } from './puntaje'

/** Lo mínimo de un puntaje de Seguimiento (lib/seguimiento/modelo.ts) para elegir la respuesta del cliente. */
export interface PuntajeLeido { valor: number; dia: Ymd; fecha: string; fuente: 'manual' | 'typeform' }

/** La última respuesta DEL CLIENTE (fuente typeform) de su historial; las del equipo («manual») no cuentan. */
export function ultimaRespuestaCliente(historial: readonly PuntajeLeido[]): { valor: number; dia: Ymd } | null {
  const del = historial.filter(p => p.fuente === 'typeform')
  if (!del.length) return null
  const ultima = [...del].sort((a, b) => (a.dia !== b.dia ? (a.dia < b.dia ? 1 : -1) : a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))[0]
  return { valor: ultima.valor, dia: ultima.dia }
}

/** Una respuesta del Typeform asignada a mano en /clientes/encuesta: a quién la asignó el equipo (null = descartada) y a quién
 *  la había unido el cruce automático (null = a nadie). */
export interface RespuestaAsignada { clave: string; asignado: string | null; auto: string | null; enviadaEn: string; valor: number | null }

/** El día y la hora argentinos (UTC−3, sin horario de verano) de un instante ISO. */
function enArgentina(iso: string): { dia: Ymd; fecha: string } | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const ar = new Date(t - 3 * 3_600_000).toISOString()
  return { dia: ar.slice(0, 10), fecha: `${ar.slice(0, 10)} ${ar.slice(11, 16)}` }
}

/**
 * El historial de cada cliente con las respuestas asignadas a mano: la asignada a otro cliente (o a ninguno) se le suma a ese
 * cliente como respuesta suya (fuente typeform), y se le saca al que la había unido el cruce automático (misma fecha y valor).
 * Si el equipo la asignó al mismo cliente que el cruce, no cambia nada (ya estaba).
 */
export function conAsignadas(historialDe: (id: string) => readonly PuntajeLeido[], asignadas: readonly RespuestaAsignada[] | null): (id: string) => readonly PuntajeLeido[] {
  if (!asignadas?.length) return historialDe
  const suma = new Map<string, PuntajeLeido[]>(), resta = new Map<string, { dia: Ymd; valor: number }[]>()
  const agregar = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v])
  for (const a of asignadas) {
    const asignado = a.asignado?.toUpperCase() ?? null, auto = a.auto?.toUpperCase() ?? null
    if (asignado === auto) continue
    const cuando = enArgentina(a.enviadaEn)
    const valor = a.valor
    if (!cuando || valor === null || !Number.isFinite(valor) || valor < 0 || valor > 10) continue
    if (asignado) agregar(suma, asignado, { valor, dia: cuando.dia, fecha: cuando.fecha, fuente: 'typeform' })
    if (auto) agregar(resta, auto, { dia: cuando.dia, valor })
  }
  return (id: string) => {
    const k = id.toUpperCase()
    let base = [...historialDe(id)]
    for (const q of resta.get(k) ?? []) {
      const i = base.findIndex(p => p.fuente === 'typeform' && p.dia === q.dia && p.valor === q.valor)
      if (i >= 0) base = [...base.slice(0, i), ...base.slice(i + 1)]
    }
    // Sin duplicar: si la planilla ya la trae para este cliente (misma fecha y valor), no se suma de nuevo
    const nuevas = (suma.get(k) ?? []).filter(n => !base.some(p => p.fuente === 'typeform' && p.dia === n.dia && p.valor === n.valor))
    return [...base, ...nuevas]
  }
}

/** La rama del tablero → el dato informativo del puntaje (con su calidad 1 a 5). */
export function ramaPuntaje(rama: Rama | null | undefined, fuente: FuenteRama | null | undefined): RamaPuntaje | null {
  if (!rama || !(rama in CALIDAD_RAMA)) return null
  return { id: rama, nombre: NOMBRE_RAMA[rama], calidad: CALIDAD_RAMA[rama], fuente: fuente ?? null }
}

export interface EowCliente { color: ColorSemaforo | null; pesadilla: boolean }

/** Por ID del CRM: el color de su fila en el reporte y si figura en «Cliente pesadilla». Lo que no se vincula queda afuera. */
export function indiceEow(datos: Pick<DatosEow, 'filas' | 'tarjetas'>, cartera: readonly ClienteCartera[]): Map<string, EowCliente> {
  const vincular = crearVinculador(cartera)
  const m = new Map<string, EowCliente>()
  for (const f of datos.filas) {
    const v = vincular(f)
    if (v.tipo === 'ninguno') continue
    const id = v.cliente.id.toUpperCase()
    // Si un cliente aparece dos veces, manda el peor color (una alarma no se tapa con otra fila)
    const previo = m.get(id)
    const peor = (a: ColorSemaforo | null, b: ColorSemaforo | null) => (a === 'rojo' || b === 'rojo' ? 'rojo' : a === 'amarillo' || b === 'amarillo' ? 'amarillo' : a ?? b)
    m.set(id, { color: previo ? peor(previo.color, f.color) : f.color, pesadilla: previo?.pesadilla ?? false })
  }
  for (const nombre of datos.tarjetas.pesadilla ?? []) {
    const v = vincular({ cliente: nombre, idCrm: null })
    if (v.tipo === 'ninguno') continue
    const id = v.cliente.id.toUpperCase()
    m.set(id, { color: m.get(id)?.color ?? null, pesadilla: true })
  }
  return m
}

/** Lo mínimo de un plan del tablero de cuotas: a quién es y si tiene una cuota vencida sin pagar. */
export interface PlanPagos { nombre: string; telefono: string; abandonado: boolean; atrasado: boolean }

/** Por ID del CRM: 'atrasado' si algún plan suyo tiene una cuota vencida; si no, 'al_dia'. Solo cruces con UN cliente. */
export function estadoPagos(planes: readonly PlanPagos[], clientes: readonly Pick<Cliente, 'id' | 'nombre' | 'celular'>[]): Map<string, 'al_dia' | 'atrasado'> {
  const porTel = new Map<string, string[]>(), porNombre = new Map<string, string[]>()
  const sumar = (m: Map<string, string[]>, k: string, id: string) => { if (k) m.set(k, [...new Set([...(m.get(k) ?? []), id])]) }
  for (const c of clientes) {
    if (!c.id) continue
    sumar(porTel, telefonoCobro(c.celular), c.id.toUpperCase())
    sumar(porNombre, normalizarNombreCobro(c.nombre), c.id.toUpperCase())
  }
  const out = new Map<string, 'al_dia' | 'atrasado'>()
  for (const p of planes) {
    if (p.abandonado) continue
    const t = porTel.get(telefonoCobro(p.telefono)) ?? []
    const n = porNombre.get(normalizarNombreCobro(p.nombre)) ?? []
    const id = t.length === 1 ? t[0] : t.length === 0 && n.length === 1 ? n[0] : null
    if (!id) continue
    out.set(id, p.atrasado || out.get(id) === 'atrasado' ? 'atrasado' : 'al_dia')
  }
  return out
}

/** Renovó: la columna «Renovó» del CRM empieza con R y un número, o hay una renovación paga en Renovaciones. */
export const renovoDe = (c: Pick<Cliente, 'renovo' | 'renovacionesPagas'>): boolean => c.renovacionesPagas > 0 || /^r\s*\d/i.test(c.renovo.trim())

/** La campaña de la cartera → la señal del puntaje. */
export function senalMeta(m: CampanaMeta | null): SenalesPuntaje['meta'] {
  if (!m) return null
  return {
    activa: m.activa, cpl: m.cpl ?? null, gastoRealDiarioUSD: m.gastoRealDiarioUSD ?? null, gastoObjetivoDiarioUSD: m.gastoObjetivoDiarioUSD ?? null,
    semaforo: m.semaforo, errorPago: !!m.errorPago,
  }
}

export interface ContextoSenales {
  historial: readonly PuntajeLeido[]
  metaLeida: boolean
  meta: CampanaMeta | null
  wins: Map<string, number> | null          // null = no se pudo leer la base de wins
  eow: Map<string, EowCliente> | null        // null = no se pudo leer el EOW (o no hay ninguno)
  pagos: Map<string, 'al_dia' | 'atrasado'> | null
  referidos: readonly Referido[] | null      // null = la pestaña no existe
}

/** Todas las señales de un cliente. */
export function armarSenales(c: Pick<Cliente, 'id' | 'promesa' | 'renovo' | 'renovacionesPagas'>, x: ContextoSenales): SenalesPuntaje {
  const id = c.id.toUpperCase()
  return {
    encuesta: ultimaRespuestaCliente(x.historial),
    metaLeida: x.metaLeida,
    meta: x.metaLeida ? senalMeta(x.meta) : null,
    promesa: c.promesa,
    wins: x.wins ? x.wins.get(id) ?? 0 : null,
    eowLeido: !!x.eow,
    eow: x.eow?.get(id) ?? null,
    renovo: renovoDe(c),
    pagos: x.pagos?.get(id) ?? null,
    referido: x.referidos ? x.referidos.some(r => r.idReferidor.toUpperCase() === id && r.estado !== 'Descartado') : null,
    grabaYResponde: null,
    rama: x.metaLeida ? ramaPuntaje(x.meta?.rama, x.meta?.ramaFuente) : null,
  }
}

// ── Toda la cartera de una vez (sin consultas por cliente: todo lo de afuera ya viene leído) ──
export interface FuentesPuntaje {
  winsFechas: { idCrm: string; fecha: Ymd }[] | null
  eow: Pick<DatosEow, 'filas' | 'tarjetas'> | null
  planes: PlanPagos[] | null
  /** Respuestas de la encuesta asignadas a mano (cj_encuesta_asignaciones). null o ausente = no se pudieron leer. */
  asignadas?: RespuestaAsignada[] | null
}
export interface EntradaCartera {
  clientes: readonly Cliente[]
  hoy: Ymd
  historialDe: (id: string) => readonly PuntajeLeido[]
  metaLeida: boolean
  campanaDe: (c: Cliente) => CampanaMeta | null
  /** Ya lanzó (hito «Campaña lanzada» o Meta lo ve corriendo): solo ellos tienen puntaje. */
  lanzo: (c: Cliente) => boolean
  referidos: readonly Referido[] | null
  fuentes: FuentesPuntaje
}

/** El puntaje de cada cliente de Agencia con ID que ya lanzó (por ID en mayúscula). */
export function puntajesDeCartera(e: EntradaCartera): Map<string, ResultadoPuntaje> {
  const agencia = e.clientes.filter(c => c.linea === 'agencia' && c.id)
  const desde = restarDias(e.hoy, 59)   // 60 días contando hoy
  const wins = e.fuentes.winsFechas ? contarWinsDesde(e.fuentes.winsFechas, desde) : null
  const cartera: ClienteCartera[] = agencia.map(c => ({ id: c.id.toUpperCase(), nombre: c.nombre, estadoCrm: c.estado, pausaDesde: null, estado: c.estado === 'ACTIVO' ? 'activo' : c.estado === 'PAUSADO' ? 'pausado' : c.estado === 'FINALIZADO' || c.estado === 'INACTIVO' ? 'finalizado' : 'otro' }))
  const eow = e.fuentes.eow ? indiceEow(e.fuentes.eow, cartera) : null
  const pagos = e.fuentes.planes ? estadoPagos(e.fuentes.planes, agencia) : null
  const historialDe = conAsignadas(e.historialDe, e.fuentes.asignadas ?? null)
  const out = new Map<string, ResultadoPuntaje>()
  for (const c of agencia) {
    const id = c.id.toUpperCase()
    if (out.has(id) || c.esNoCliente || !e.lanzo(c)) continue
    out.set(id, calcularPuntaje(armarSenales(c, { historial: historialDe(c.id), metaLeida: e.metaLeida, meta: e.campanaDe(c), wins, eow, pagos, referidos: e.referidos })))
  }
  return out
}

const restarDias = (ymd: Ymd, n: number): Ymd => new Date(Date.parse(`${ymd}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
