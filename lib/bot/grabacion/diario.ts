// ── Diario: pasada completa, e01, videos trabados y resumen para la daily ────────────────────────────────────────────
// Por FASES que se pueden retomar (estado `diario:<ymd>:<fase>` en cj_grab_corridas.resumen.fases): si el cron de Hobby
// falla o lo corta el tiempo, el vigía retoma lo que falte (retomarDiario).
//   completa → pasada completa del árbol, vínculos, borrados y docs de guiones (altas de videos con línea de base);
//   e01      → calcularE01 + crearPasos + cierre de ciclos (el resumen lo necesita: si falta, se corre antes);
//   resumen  → solo en días hábiles de martes a viernes (la daily es a las 8:30) y desde las 7:45 de Argentina; sale una
//              sola vez (la fase y la clave `resumen:<ymd>` de los avisos);
//   huecos   → ¿ayer hubo más de 2 horas de horario de trabajo sin vigía? (solo si el puente corrió en los últimos 7 días);
//   colgadas → barrido de transcripciones colgadas y de lo que quedó del lado de AssemblyAI.
// El vigía solo retoma `completa` si ya son las 9 de Argentina (el cron claramente no corrió) y le quedan 120 s o más.
import type { Corrida, DocGuiones, EstadoVideo, IdCrm, PasoSeguimiento, ResumenDaily, Video, VideoTrabado, Ymd } from '@/lib/edicion/tipos'
import { DIAS_DAILY, HORA_RESUMEN, HORARIO_VIGIA, HORAS_VIGIA_CALLADO, UMBRALES_TRABADO } from '@/lib/edicion/config'
import { diaSemana } from '@/lib/anuncios/feriados'
import type { FilaTablero } from '@/lib/edicion/db/videos'
import type { EstadoArchivos } from '@/lib/edicion/db/archivos'
import type * as Guiones from '@/lib/edicion/db/guiones'
import { calcularE01, habilesEntre } from './seguimiento'
import { correrVigia, pasadaCompleta, ymdAR, type DepsVigia, type OpcionesFase, type ResultadoFases, type ResultadoVigia } from './vigia'
import { barrerColgadas, inicioDelDiaAR } from './transcripcion'
import { enviarE01, type DepsE01Whatsapp } from './e01Whatsapp'

export interface DepsDiario extends DepsVigia {
  listarDocs: typeof Guiones.listarDocs
  /** e01 por WhatsApp (e01Whatsapp.ts). Sin él (los fakes de los tests) no se manda nada; con él, solo si E01_WHATSAPP=real. */
  e01Whatsapp?: DepsE01Whatsapp
}

const motivo = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
const minutosAR = (d: Date): number => { const t = new Date(d.getTime() - 3 * 3_600_000); return t.getUTCHours() * 60 + t.getUTCMinutes() }
const [hhR, mmR] = HORA_RESUMEN.split(':').map(Number)
export const yaEsHoraDelResumen = (d: Date): boolean => minutosAR(d) >= hhR * 60 + mmR
export const esDiaDeDaily = (ymd: Ymd, esHabil: (d: Ymd) => boolean): boolean => esHabil(ymd) && DIAS_DAILY.includes(diaSemana(ymd))

// ── Videos trabados (horas hábiles: un fin de semana o un feriado no cuentan) ───────────────────────────────────
export function horasHabiles(desde: Date, hasta: Date, esHabil: (d: Ymd) => boolean): number {
  let ms = 0
  let t = desde.getTime()
  const fin = hasta.getTime()
  while (t < fin) {
    const ymd = ymdAR(new Date(t))
    const finDia = Date.parse(`${ymd}T03:00:00.000Z`) + 86_400_000      // medianoche de Argentina del día siguiente
    const tramo = Math.min(finDia, fin) - t
    if (esHabil(ymd)) ms += tramo
    t += Math.max(tramo, 1)
  }
  return ms / 3_600_000
}

export function videosTrabados(videos: readonly Video[], ahora: Date, esHabil: (d: Ymd) => boolean): VideoTrabado[] {
  const out: VideoTrabado[] = []
  for (const v of videos) {
    const u = UMBRALES_TRABADO[v.estado]
    if (!u || !v.estado_desde) continue
    const desde = new Date(v.estado_desde)
    const horas = Math.round(horasHabiles(desde, ahora, esHabil) * 10) / 10
    const habiles = habilesEntre(ymdAR(desde), ymdAR(ahora), esHabil)
    if ((u.horas !== undefined && horas >= u.horas) || (u.habiles !== undefined && habiles >= u.habiles)) {
      out.push({ video_id: v.id, id_crm: v.id_crm, cliente: v.cliente, clave: v.clave, estado: v.estado, desde: v.estado_desde, horas, habiles, quien: u.quien })
    }
  }
  return out.sort((a, b) => b.horas - a.horas)
}

// ── Resumen ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface EntradaResumen {
  hoy: Ymd; ahora: Date; esHabil: (d: Ymd) => boolean
  pasos: readonly PasoSeguimiento[]; videos: readonly FilaTablero[]; docs: readonly DocGuiones[]
  archivos: EstadoArchivos; vinculosPorConfirmar: number; nombres: ReadonlyMap<IdCrm, string>
}
const ORDEN_ESCALON = (e: string) => (e === 'dia0' ? 0 : e === 'dia2' ? 1 : e === 'dia4' ? 2 : e === 'dia9' ? 3 : 4 + Number(e.slice(1)))

export function armarResumen(e: EntradaResumen): ResumenDaily {
  const nombre = (id: IdCrm) => e.nombres.get(id) ?? e.videos.find(v => v.id_crm === id)?.cliente ?? id
  // Escalones: el último paso vencido y sin hacer de cada ciclo abierto
  const porCiclo = new Map<string, PasoSeguimiento>()
  for (const p of e.pasos) {
    if (p.estado !== 'abierto' || p.hecho || p.debido > e.hoy) continue
    const k = `${p.id_crm}|${p.ciclo}`, ya = porCiclo.get(k)
    if (!ya || ORDEN_ESCALON(p.escalon) > ORDEN_ESCALON(ya.escalon)) porCiclo.set(k, p)
  }
  const grupos = new Map<string, ResumenDaily['escalones'][number]['clientes']>()
  for (const p of porCiclo.values()) {
    if (!grupos.has(p.escalon)) grupos.set(p.escalon, [])
    grupos.get(p.escalon)!.push({ id_crm: p.id_crm, cliente: p.cliente || nombre(p.id_crm), dias: habilesEntre(p.ciclo, e.hoy, e.esHabil), responsable: p.frenado ? 'aylu' : p.responsable })
  }
  const escalones = [...grupos].sort((a, b) => ORDEN_ESCALON(a[0]) - ORDEN_ESCALON(b[0])).map(([escalon, clientes]) => ({ escalon: escalon as PasoSeguimiento['escalon'], clientes }))
  const activos = e.videos.filter(v => v.estado !== 'aprobado' && v.estado !== 'descartado')
  const colas: Partial<Record<EstadoVideo, number>> = {}
  for (const v of activos) colas[v.estado] = (colas[v.estado] ?? 0) + 1
  const rene = new Map<IdCrm, { id_crm: IdCrm; cliente: string; videos: number; urgente: boolean }>()
  for (const v of activos) {
    if ((v.estado !== 'para_editar' && v.estado !== 'correccion') || v.bloqueo === 'tope_rondas_cliente') continue
    const x = rene.get(v.id_crm) ?? { id_crm: v.id_crm, cliente: v.cliente, videos: 0, urgente: false }
    x.videos++; x.urgente ||= v.prioridad === 'urgente'
    rene.set(v.id_crm, x)
  }
  const grabado_sin_crudos: ResumenDaily['grabado_sin_crudos'] = []
  for (const d of e.docs) {
    const refs = d.guiones.filter(g => g.estado_doc === 'grabado_completo').filter(g => {
      const v = e.videos.find(x => x.id_crm === d.id_crm && (x.guion?.huella === g.huella || x.clave === g.ref))
      return !v || (v.crudos === 0 && (v.estado === 'esperando_crudos' || v.estado === 'regrabar'))
    }).map(g => g.ref)
    if (refs.length) grabado_sin_crudos.push({ id_crm: d.id_crm, cliente: nombre(d.id_crm), refs })
  }
  const sinTranscribir = new Map<string, ResumenDaily['sin_transcribir'][number]>()
  for (const s of e.archivos.sinTranscribir) {
    const k = `${s.id_crm}|${s.motivo}`
    const x = sinTranscribir.get(k) ?? { id_crm: s.id_crm, cliente: nombre(s.id_crm), archivos: 0, motivo: s.motivo }
    x.archivos += s.archivos
    sinTranscribir.set(k, x)
  }
  const avisos_guiones = e.docs.filter(d => ymdAR(d.leido) === e.hoy).map(d => ({ id_crm: d.id_crm, cliente: nombre(d.id_crm),
    avisos: d.avisos.filter(a => /no se crearon|cambió en el doc|posible duplicado/.test(a)) })).filter(x => x.avisos.length)
  return {
    fecha: e.hoy, escalones, colas, trabados: videosTrabados(activos, e.ahora, e.esHabil),
    cola_rene: [...rene.values()].sort((a, b) => Number(b.urgente) - Number(a.urgente) || b.videos - a.videos),
    grabado_sin_crudos, editados_por_vincular: e.archivos.editadosPorVincular, vinculos_por_confirmar: e.vinculosPorConfirmar,
    sin_transcribir: [...sinTranscribir.values()], ...(avisos_guiones.length ? { avisos_guiones } : {}),
  }
}

// ── Fases ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const FASES = ['completa', 'e01', 'resumen', 'huecos', 'colgadas'] as const
export type Fase = (typeof FASES)[number]
export const claveFase = (ymd: Ymd, f: Fase): string => `diario:${ymd}:${f}`

async function faseE01(deps: DepsDiario, ahora: Date): Promise<{ creados: number; cerrados: number }> {
  const hoy = ymdAR(ahora)
  const desde = new Date(ahora.getTime() - 30 * 86_400_000).toISOString()
  const [videos, pasos, archivos, excluidos] = await Promise.all([
    deps.repo.listarVideos({ incluirFinales: false }), deps.repo.pasosAbiertos(), deps.repo.estadoArchivos(desde), deps.repo.clientesGrabaEquipo(deps.env),
  ])
  const corte = /^\d{4}-\d{2}-\d{2}$/.test(deps.env.EDICION_FECHA_CORTE?.trim() ?? '') ? deps.env.EDICION_FECHA_CORTE!.trim() : null
  const r = calcularE01({ videos, pasos, hoy, esHabil: deps.esHabil, sinUbicar: archivos.sinUbicar, excluidos, corte })
  const creados = await deps.repo.crearPasos(r.nuevos)
  for (const a of r.actualizar) await deps.repo.actualizarPaso(a.id, { videos: a.videos, frenado: a.frenado })
  let cerrados = 0
  for (const c of r.cerrar) cerrados += await deps.repo.cerrarCiclo(c.id_crm, c.ciclo, c.estado)
  return { creados: creados.length, cerrados }
}

export async function resumenDelDia(deps: DepsDiario, ahora: Date): Promise<ResumenDaily> {
  const hoy = ymdAR(ahora)
  const [pasos, videos, docs, archivos, vinculos] = await Promise.all([
    deps.repo.pasosAbiertos(), deps.repo.listarVideos({ incluirFinales: false }), deps.listarDocs(),
    deps.repo.estadoArchivos(new Date(ahora.getTime() - 30 * 86_400_000).toISOString()), deps.repo.listarVinculos(),
  ])
  return armarResumen({ hoy, ahora, esHabil: deps.esHabil, pasos, videos, docs, archivos, vinculosPorConfirmar: vinculos.filter(v => v.vinculo === 'a_confirmar').length, nombres: new Map() })
}

/** Huecos de más de HORAS_VIGIA_CALLADO en el horario de trabajo de ayer (solo si el puente anduvo en la última semana). */
export function huecosDe(corridas: readonly Corrida[], ayer: Ymd): { desde: string; horas: number }[] {
  const vigias = corridas.filter(c => c.tipo === 'vigia' && c.fin && c.estado !== 'colgada').sort((a, b) => a.inicio.localeCompare(b.inicio))
  if (!vigias.some(c => c.origen === 'puente')) return []
  const ini = Date.parse(`${ayer}T${String(HORARIO_VIGIA.desde + 3).padStart(2, '0')}:00:00.000Z`)
  const fin = Date.parse(`${ayer}T00:00:00.000Z`) + (HORARIO_VIGIA.hasta + 3) * 3_600_000
  const delDia = vigias.filter(c => Date.parse(c.inicio) >= ini && Date.parse(c.inicio) < fin)
  const out: { desde: string; horas: number }[] = []
  let previo = ini
  for (const c of delDia) {
    const h = (Date.parse(c.inicio) - previo) / 3_600_000
    if (h > HORAS_VIGIA_CALLADO) out.push({ desde: new Date(previo).toISOString(), horas: Math.round(h * 10) / 10 })
    previo = Math.max(previo, Date.parse(c.fin!))
  }
  const h = (fin - previo) / 3_600_000
  if (h > HORAS_VIGIA_CALLADO) out.push({ desde: new Date(previo).toISOString(), horas: Math.round(h * 10) / 10 })
  return out
}

/** Las fases del diario que falten hoy (lo llaman el cron y, para retomar, el vigía). */
export async function retomarDiario(deps: DepsDiario, op: OpcionesFase & { corrida: Corrida | null; incluirCompleta?: boolean }): Promise<ResultadoFases> {
  const ahora = op.ahora, hoy = ymdAR(ahora)
  const out: ResultadoFases = { fases: [], eventos: [], extra: [] }
  const hechas = await deps.repo.fasesHechas(inicioDelDiaAR(ahora))
  const hecha = (f: Fase) => hechas.has(claveFase(hoy, f)) || out.fases.includes(claveFase(hoy, f))
  const queda = () => op.deadline - Date.now()
  const errores: string[] = []
  // completa
  const completaPermitida = op.incluirCompleta || (minutosAR(ahora) >= 9 * 60 && queda() >= 120_000)
  if (!hecha('completa') && completaPermitida) {
    try {
      const p = await pasadaCompleta(deps, op)
      out.eventos.push(...p.eventos); out.extra.push(...p.extra)
      for (const e of p.errores.slice(0, 5)) out.extra.push({ tipo: 'error', proceso: 'pasada completa', motivo: e })
      if (p.completa) out.fases.push(claveFase(hoy, 'completa'))
    } catch (e) { errores.push(`pasada completa: ${motivo(e)}`) }
  }
  // e01
  if (!hecha('e01') && queda() > 15_000) {
    try { await faseE01(deps, ahora); out.fases.push(claveFase(hoy, 'e01')) } catch (e) { errores.push(`e01: ${motivo(e)}`) }
  }
  // e01 por WhatsApp: idempotente (un paso reclamado ya no es elegible), así que corre en cada vuelta, sin fase propia
  if (deps.e01Whatsapp && hecha('e01') && queda() > 20_000) {
    try {
      const w = await enviarE01(deps.e01Whatsapp, { ahora, modo: deps.modo, deadline: op.deadline })
      for (const a of w.avisar) out.extra.push({ tipo: 'error', proceso: 'e01 por WhatsApp', motivo: a })
    } catch (e) { errores.push(`e01 por WhatsApp: ${motivo(e)}`) }
  }
  // resumen (necesita el e01 del día)
  if (!hecha('resumen') && hecha('e01') && esDiaDeDaily(hoy, deps.esHabil) && yaEsHoraDelResumen(ahora) && queda() > 10_000) {
    try {
      const resumen = await resumenDelDia(deps, ahora)
      out.extra.push({ tipo: 'resumen_daily', resumen })
      out.fases.push(claveFase(hoy, 'resumen'))
    } catch (e) { errores.push(`resumen: ${motivo(e)}`) }
  }
  // huecos de ayer
  if (!hecha('huecos') && queda() > 10_000) {
    try {
      const ayer = ymdAR(new Date(ahora.getTime() - 86_400_000))
      const corridas = await deps.repo.corridasDesde(new Date(ahora.getTime() - 8 * 86_400_000).toISOString())
      for (const h of huecosDe(corridas, ayer)) out.extra.push({ tipo: 'vigia_callado', desde: h.desde, horas: h.horas })
      out.fases.push(claveFase(hoy, 'huecos'))
    } catch (e) { errores.push(`huecos: ${motivo(e)}`) }
  }
  // colgadas (y lo que quedó del lado de AssemblyAI)
  if (!hecha('colgadas') && deps.transcripcion && queda() > 20_000) {
    try {
      const b = await barrerColgadas(deps.transcripcion, { deadline: op.deadline, listarProveedor: true })
      out.extra.push(...b.extra)
      out.fases.push(claveFase(hoy, 'colgadas'))
    } catch (e) { errores.push(`colgadas: ${motivo(e)}`) }
  }
  for (const e of errores) out.extra.push({ tipo: 'error', proceso: 'diario', motivo: e })
  return out
}

export interface ResultadoDiario extends ResultadoVigia { plan_diario?: Record<string, unknown> }

/** El cron diario: una corrida `diario` que hace todas las fases que falten (con la pasada completa). */
export async function correrDiario(deps: DepsDiario, op: { origen: Corrida['origen']; deadline: number }): Promise<ResultadoDiario> {
  const ahora = deps.ahora()
  if (deps.modo === 'dry') {
    // Plan sin escribir: cuántas carpetas de clientes hay, qué daría e01 hoy y el resumen con lo que ya hay en la base
    const [clientes, pasos, videos, archivos] = await Promise.all([
      deps.drive.carpetasClientes().catch(() => []), deps.repo.pasosAbiertos(), deps.repo.listarVideos({ incluirFinales: false }),
      deps.repo.estadoArchivos(new Date(ahora.getTime() - 30 * 86_400_000).toISOString()),
    ])
    const e01 = calcularE01({ videos, pasos, hoy: ymdAR(ahora), esHabil: deps.esHabil, sinUbicar: archivos.sinUbicar })
    const resumen = await resumenDelDia(deps, ahora)
    return { ok: true, dry: true, corrida: null, consultas: deps.drive.consultas(), carpetas: clientes.length, consultadas: 0, pendientes: 0, archivos_nuevos: 0,
      tandas_cerradas: 0, comparadas: 0, eventos: 0, avisos: 0, fases: [], errores: [],
      plan_diario: { carpetas_clientes: clientes.length, e01: { nuevos: e01.nuevos.length, cerrar: e01.cerrar.length }, resumen } }
  }
  // La corrida del diario es una corrida del vigía de tipo 'diario' con la pasada completa y todas las fases
  return correrVigia({ ...deps, retomar: o => retomarDiario(deps, { ...o, incluirCompleta: true }) }, { tipo: 'diario', origen: op.origen, deadline: op.deadline })
}

