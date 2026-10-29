// ── Vigía de Crudos y Editados (e02), pasada completa y comparación por tanda (e03) ─────────────────────────────────
// correrVigia (cada 15 minutos por el Puente Drive, o a mano):
//   1. abre la corrida (candado); si hay otra en curso, se saltea;
//   2. consulta las carpetas con vigilar = true, de la consultada hace más tiempo a la más reciente, 8 en paralelo, con
//      `createdTime > consultada − MARGEN_VIGIA_MIN` (una carpeta nunca consultada se lista entera). Las subcarpetas
//      nuevas se recorren EN LA MISMA corrida hasta NIVELES_ARBOL (si no, "Tanda 3/Video 2" tardaría una corrida por nivel);
//   3. corta antes del deadline − 30 s y deja el resto para la próxima (barrido rotativo: lo que no se consultó conserva su
//      `consultada` vieja y no se pierde nada);
//   4. guarda los archivos (UNO por drive_id: el mismo archivo puede llegar por dos caminos y un upsert con el id repetido da
//      21000 en Postgres), arma las tandas, vincula crudos por carpeta o nombre y propone editados. Un crudo que se vincula
//      fuera de una tanda abierta (movido por Aylu, o viejo de la pasada completa) mueve su video ahí mismo;
//   5. cierra las tandas (45 minutos sin archivos Y todas las carpetas vigiladas del cliente consultadas después) y mueve con
//      llegaron_crudos los videos con crudos vinculados (la comparación vuelve a mirar los vinculados de su tanda: una tanda
//      que cerró asignarATanda por el hueco de 45 minutos también mueve sus videos);
//   6. transcripciones (enviar y barrer lo colgado), comparación de las tandas listas, fases del diario que falten (el
//      resumen de la daily si ya son las 7:45 de Argentina), aviso de "vigía callado" y despacho de los avisos.
// Archivos viejos (creados hace más de TRANSCRIBIR_ULTIMAS_HORAS la primera vez que se ven): se guardan, se vinculan por
// carpeta o nombre, pero NO arman tanda ni aviso (la primera pasada encuentra unos 2.400 crudos históricos).
// Solo procesan las carpetas con vínculo alta / aylu / tomas / bot (exacto); las `a_confirmar` no generan nada.
// Modo dry: no abre corrida ni escribe; devuelve el plan (carpetas y archivos vistos).
import type {
  Actor, ArchivoDrive, ArchivoGrabacion, AvisoMotor, CarpetaGrabacion, CoberturaGuion, Corrida, DocGuiones, EventoVideo, GuionDoc, IdCrm, ResultadoComparacion,
  Video, Ymd,
} from '@/lib/edicion/tipos'
import {
  DIAS_CRUDO_ANTES_DEL_VIDEO, ESPERA_TRANSCRIPCION_MIN, HORARIO_VIGIA, HORAS_VIGIA_CALLADO, MARGEN_DEADLINE_MS, MARGEN_PASO_LARGO_MS, MARGEN_VIGIA_MIN,
  MAX_ALTAS_POR_PASADA, MIN_PARA_CLAUDE_MS, NIVELES_ARBOL, PARALELO_DRIVE, TRANSCRIBIR_ULTIMAS_HORAS, esCopiaDuplicada,
} from '@/lib/edicion/config'
import type * as Videos from '@/lib/edicion/db/videos'
import type * as Archivos from '@/lib/edicion/db/archivos'
import type * as Tandas from '@/lib/edicion/db/tandas'
import type * as Carpetas from '@/lib/edicion/db/carpetas'
import type * as Guiones from '@/lib/edicion/db/guiones'
import type * as Seguimientos from '@/lib/edicion/db/seguimientos'
import type * as Corridas from '@/lib/edicion/db/corridas'
import type * as Clientes from '@/lib/edicion/db/clientes'
import { claveNombre, crearCruceCarpetas } from '@/lib/clientes/prioridad'
import type { LectorDrive } from './drive'
import { inferirUbicacion, type Ubicacion } from './tandas'
import { ganchoGuion, huellaTexto, parsearDocGuiones, planDoc, textoGuion } from './guiones'
import { cruceSimple } from './comparar'
import { VERSION_COMPARACION, compararConClaude, type LlamarClaude } from './compararClaude'
import { barrerColgadas, enviarPendientes, type DepsTranscripcion } from './transcripcion'
import { revisarMarcas, type RaizMarca, type RepoMarca } from './marcaVigia'

export interface RepoGrabacion {
  abrirCorrida: typeof Corridas.abrirCorrida; cerrarCorrida: typeof Corridas.cerrarCorrida; ultimaCorrida: typeof Corridas.ultimaCorrida
  corridasDesde: typeof Corridas.corridasDesde; fasesHechas: typeof Corridas.fasesHechas
  carpetasAVigilar: typeof Carpetas.carpetasAVigilar; guardarArbol: typeof Carpetas.guardarArbol; anotarConsultas: typeof Carpetas.anotarConsultas
  ajustarVigilancia: typeof Carpetas.ajustarVigilancia; vigilarCrudosDe: typeof Carpetas.vigilarCrudosDe; vinculosSinAviso: typeof Carpetas.vinculosSinAviso
  marcarCarpetasBorradas: typeof Carpetas.marcarCarpetasBorradas; todasLasCarpetas: typeof Carpetas.todasLasCarpetas; listarVinculos: typeof Carpetas.listarVinculos
  guardarArchivos: typeof Archivos.guardarArchivos; marcarBorrados: typeof Archivos.marcarBorrados; vincularArchivo: typeof Archivos.vincularArchivo
  proponerEditado: typeof Archivos.proponerEditado; crudosDeCliente: typeof Archivos.crudosDeCliente; archivosDeTanda: typeof Archivos.archivosDeTanda
  transcripcionesDe: typeof Archivos.transcripcionesDe; estadoArchivos: typeof Archivos.estadoArchivos
  asignarATanda: typeof Tandas.asignarATanda; tandasParaCerrar: typeof Tandas.tandasParaCerrar; cerrarTanda: typeof Tandas.cerrarTanda
  reclamarComparacion: typeof Tandas.reclamarComparacion; guardarResultado: typeof Tandas.guardarResultado; marcarAvisada: typeof Tandas.marcarAvisada
  soltarComparacion: typeof Tandas.soltarComparacion
  tandasParaComparar: typeof Tandas.tandasParaComparar; tandasEditadosCerradas: typeof Tandas.tandasEditadosCerradas; leerTanda: typeof Tandas.leerTanda
  listarVideos: typeof Videos.listarVideos; moverVideo: typeof Videos.moverVideo; actualizarVideo: typeof Videos.actualizarVideo; crearVideoSiFalta: typeof Videos.crearVideoSiFalta
  leerDoc: typeof Guiones.leerDoc; leerDocPorId: typeof Guiones.leerDocPorId; docsLeidos: typeof Guiones.docsLeidos; guardarDoc: typeof Guiones.guardarDoc
  pasosAbiertos: typeof Seguimientos.pasosAbiertos; crearPasos: typeof Seguimientos.crearPasos; actualizarPaso: typeof Seguimientos.actualizarPaso
  cerrarCiclo: typeof Seguimientos.cerrarCiclo
  clientesGrabaEquipo: typeof Clientes.clientesGrabaEquipo
}

export interface ClienteCrm { id: IdCrm; nombre: string; estado: string }
export interface OpcionesFase { deadline: number; ahora: Date }
export interface ResultadoFases { fases: string[]; eventos: EventoVideo[]; extra: AvisoMotor[] }

export interface DepsVigia {
  drive: LectorDrive
  repo: RepoGrabacion
  transcripcion: DepsTranscripcion | null
  claude: LlamarClaude | null
  crm(): Promise<ClienteCrm[]>
  altas(): Promise<{ id_crm: IdCrm; carpeta_id: string }[]>
  avisar(eventos: readonly EventoVideo[], extra: readonly AvisoMotor[]): Promise<unknown>
  despachar(): Promise<unknown>
  ahora(): Date
  modo: 'dry' | 'real'
  esHabil(d: Ymd): boolean
  env: Record<string, string | undefined>
  esOperativo?(idCrm: string): Promise<boolean>
  /** e05: lo de "Marca - X" (marcaVigia.ts). Sin él, la pasada completa no mira Marca (los fakes de los tests). */
  marca?: RepoMarca
  /** Las fases del diario que falten (las retoma el vigía: el cron de Hobby no es puntual). */
  retomar?(op: OpcionesFase & { corrida: Corrida | null }): Promise<ResultadoFases>
}

export const BOT_VIGIA: Actor = { tipo: 'bot', proceso: 'vigia' }
export const BOT_COMPARACION: Actor = { tipo: 'bot', proceso: 'comparacion' }

const VINCULOS_OK = new Set(['alta', 'aylu', 'tomas', 'bot'])
const msHoras = (h: number) => h * 3_600_000
const motivo = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
const horaAR = (d: Date): number => Number(new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 13))
export const ymdAR = (d: Date | string): Ymd => new Date((typeof d === 'string' ? Date.parse(d) : d.getTime()) - 3 * 3_600_000).toISOString().slice(0, 10)

async function enParalelo<T, R>(items: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

// ── Vincular por carpeta o nombre ────────────────────────────────────────────────────────────────────────────────
const PREF_CRUDO = new Set(['esperando_crudos', 'regrabar', 'crudo_a_revisar'])
const PREF_EDITADO = new Set(['para_editar', 'correccion', 'editado', 'corregido'])

/**
 * El video al que va un archivo según lo inferido (null si no alcanza o es ambiguo). Si la carpeta ni el nombre dicen la
 * tanda ("Crudos/Video 4/"), el número solo no alcanza para cualquier video: únicamente uno que espere ese tipo de archivo
 * (un crudo de mayo en "Video 4" no es del "video 4" que hoy está en edición).
 */
export function videoDeUbicacion(inf: Pick<Ubicacion, 'tanda_guion' | 'numero'>, videos: readonly Video[], tipo: 'crudo' | 'editado'): Video | null {
  if (inf.numero === null) return null
  const espera = tipo === 'crudo' ? PREF_CRUDO : PREF_EDITADO
  const xs = videos.filter(v => v.numero === inf.numero && (inf.tanda_guion === null || v.tanda_guion === inf.tanda_guion) && v.estado !== 'descartado')
    .filter(v => inf.tanda_guion !== null || espera.has(v.estado))
  if (xs.length === 1) return xs[0]
  const pref = xs.filter(v => espera.has(v.estado))
  return pref.length === 1 ? pref[0] : null
}

/** ¿El archivo es muy anterior al video? (más de DIAS_CRUDO_ANTES_DEL_VIDEO días: un histórico, no se vincula solo). */
export function anteriorAlVideo(a: Pick<ArchivoDrive, 'creado'>, v: Pick<Video, 'creado'>): boolean {
  const ta = Date.parse(a.creado), tv = Date.parse(v.creado)
  return Number.isFinite(ta) && Number.isFinite(tv) && ta < tv - DIAS_CRUDO_ANTES_DEL_VIDEO * 86_400_000
}

/**
 * ¿Este crudo destraba al video? El video tiene que esperar crudos (esperando_crudos o regrabar) y, si ya pasó por un pedido
 * de regrabación, el crudo tiene que ser posterior a ese pedido (los crudos de la primera grabación siguen vinculados).
 */
export function crudoDestraba(v: Pick<Video, 'estado' | 'estado_desde' | 'motivo_regrabar'>, a: Pick<ArchivoDrive, 'creado'>): boolean {
  if (v.estado !== 'esperando_crudos' && v.estado !== 'regrabar') return false
  if (!v.motivo_regrabar) return true
  const ta = Date.parse(a.creado), tv = Date.parse(v.estado_desde)
  return !Number.isFinite(tv) || !Number.isFinite(ta) || ta >= tv
}

/** Mueve con llegaron_crudos los videos que destraba algún crudo (video → su crudo más nuevo). Idempotente. */
async function moverConCrudos(deps: DepsVigia, crudos: ReadonlyMap<number, Pick<ArchivoDrive, 'creado'> & { id: number }>, actor: Actor, datos: Record<string, unknown>): Promise<EventoVideo[]> {
  const eventos: EventoVideo[] = []
  if (!crudos.size) return eventos
  for (const v of await deps.repo.listarVideos({ ids: [...crudos.keys()] })) {
    const a = crudos.get(v.id)
    if (!a || !crudoDestraba(v, a)) continue
    const m = await deps.repo.moverVideo({ id: v.id, version: v.version, accion: 'llegaron_crudos', actor, ctx: {}, datos: { ...datos, archivo_id: a.id } })
    if (m.ok) eventos.push(m.actual.evento)
  }
  return eventos
}

/** Se queda con el crudo más nuevo de cada video. */
function sumarCrudo<T extends { creado: string }>(m: Map<number, T>, video_id: number, a: T): void {
  const ya = m.get(video_id)
  if (!ya || a.creado > ya.creado) m.set(video_id, a)
}

// ── Archivos: guardar, tandas, vínculos y propuestas ─────────────────────────────────────────────────────────────
export interface ResultadoArchivos { nuevos: number; recientes: number; vinculados: number; propuestos: number; extra: AvisoMotor[]; eventos: EventoVideo[] }

export async function procesarArchivos(deps: DepsVigia, archivos: readonly ArchivoDrive[], carpetas: ReadonlyMap<string, CarpetaGrabacion>, ahora: Date): Promise<ResultadoArchivos> {
  const r: ResultadoArchivos = { nuevos: 0, recientes: 0, vinculados: 0, propuestos: 0, extra: [], eventos: [] }
  const viejo = ahora.getTime() - msHoras(TRANSCRIBIR_ULTIMAS_HORAS)
  const grupos = new Map<string, { id_crm: IdCrm; raiz: 'crudos' | 'editados'; xs: ArchivoDrive[] }>()
  for (const a of archivos) {
    const c = carpetas.get(a.carpeta_id)
    if (!c?.id_crm || !VINCULOS_OK.has(c.vinculo) || (c.raiz !== 'crudos' && c.raiz !== 'editados')) continue
    const k = `${c.id_crm}|${c.raiz}`
    if (!grupos.has(k)) grupos.set(k, { id_crm: c.id_crm, raiz: c.raiz, xs: [] })
    grupos.get(k)!.xs.push(a)
  }
  for (const g of grupos.values()) {
    const tipo = g.raiz === 'crudos' ? 'crudo' : 'editado'
    const xs = g.xs.map(a => {
      const inferido = inferirUbicacion(a.ruta, a.nombre)
      const media = /^(video|audio)\//i.test(a.mime)
      const t = Date.parse(a.creado)
      const tr_estado = tipo === 'crudo' && media ? (Number.isFinite(t) && t < viejo ? 'vieja' as const : 'pendiente' as const) : 'no_aplica' as const
      return { ...a, inferido, tr_estado }
    })
    const { nuevos, movidos } = await deps.repo.guardarArchivos(g.id_crm, tipo, xs)
    r.nuevos += nuevos.length
    const recientes = nuevos.filter(a => { const t = Date.parse(a.creado); return !Number.isFinite(t) || t >= viejo })
    r.recientes += recientes.length
    if (recientes.length) await deps.repo.asignarATanda(g.id_crm, g.raiz, recientes, ahora)
    const enTandaNueva = new Set(recientes.map(a => a.id))
    const aRevisar = [...nuevos, ...movidos.filter(a => a.asignado_por === null || a.asignado_por === 'bot')].filter(a => a.inferido.numero !== null)
    if (!aRevisar.length) continue
    const videos = await deps.repo.listarVideos({ id_crm: g.id_crm, incluirFinales: false })
    const aMover = new Map<number, ArchivoGrabacion>()
    for (const a of aRevisar) {
      const v = videoDeUbicacion(a.inferido, videos, tipo)
      if (!v || anteriorAlVideo(a, v)) continue
      if (tipo === 'crudo') {
        if (a.video_id === v.id) continue
        const x = await deps.repo.vincularArchivo({ archivo_id: a.id, video_id: v.id, actor: BOT_VIGIA, por: a.inferido.por ?? 'carpeta' })
        if (!x.ok) continue
        r.vinculados++
        // Los de una tanda nueva los mueve el cierre de esa tanda (salen junto con su aviso); los demás (movidos por Aylu o
        // viejos de la pasada completa, sin tanda o con su tanda ya cerrada) mueven el video ahora
        if (enTandaNueva.has(a.id)) continue
        if (a.tanda_id !== null && (await deps.repo.leerTanda(a.tanda_id))?.estado === 'abierta') continue
        sumarCrudo(aMover, v.id, a)
      } else if (a.video_id === null && a.propuesta_video_id !== v.id) {
        await deps.repo.proponerEditado(a.id, v.id)
        r.propuestos++
      }
    }
    r.eventos.push(...await moverConCrudos(deps, aMover, BOT_VIGIA, { por: 'vinculo' }))
  }
  return r
}

// ── Cierre de tandas ─────────────────────────────────────────────────────────────────────────────────────────────
export async function cerrarTandas(deps: DepsVigia, ahora: Date): Promise<{ cerradas: number; eventos: EventoVideo[] }> {
  const eventos: EventoVideo[] = []
  let cerradas = 0
  for (const t of await deps.repo.tandasParaCerrar(ahora)) {
    const c = await deps.repo.cerrarTanda(t.id, t.version)
    if (!c.ok) continue
    cerradas++
    if (t.tipo === 'editados') { await deps.repo.marcarAvisada(t.id); continue }
    const porVideo = new Map<number, ArchivoGrabacion>()
    for (const a of await deps.repo.archivosDeTanda(t.id)) if (a.video_id !== null && a.tipo === 'crudo') sumarCrudo(porVideo, a.video_id, a)
    eventos.push(...await moverConCrudos(deps, porVideo, BOT_VIGIA, { tanda_id: t.id }))
  }
  return { cerradas, eventos }
}

// ── Comparación de una tanda de crudos con los guiones (por tanda del guion) ──────────────────────────────────────
export interface OpcionesComparar { deadline: number; ahora: Date; sinClaude?: boolean; cliente?: string }
export interface ResultadoComparar { tanda_id: number; resultado: ResultadoComparacion | null; eventos: EventoVideo[]; extra: AvisoMotor[]; motivo?: string }

const refDe = (v: Pick<Video, 'tanda_guion' | 'numero' | 'clave'>): string => (v.tanda_guion !== null && v.numero !== null ? `T${v.tanda_guion}-V${v.numero}` : v.clave)

export async function compararTanda(deps: DepsVigia, tanda_id: number, op: OpcionesComparar): Promise<ResultadoComparar> {
  if (deps.esOperativo) {
    const actual = await deps.repo.leerTanda(tanda_id)
    if (actual && !await deps.esOperativo(actual.id_crm)) return { tanda_id, resultado: null, eventos: [], extra: [], motivo: 'cliente archivado' }
  }
  const tanda = await deps.repo.reclamarComparacion(tanda_id, op.ahora)
  if (!tanda) return { tanda_id, resultado: null, eventos: [], extra: [], motivo: 'no se pudo reclamar (otra la está comparando o ya se comparó)' }
  const eventos: EventoVideo[] = [], extra: AvisoMotor[] = []
  try {
    const propios = await deps.repo.archivosDeTanda(tanda.id)
    const [doc, videos] = await Promise.all([deps.repo.leerDoc(tanda.id_crm), deps.repo.listarVideos({ id_crm: tanda.id_crm, incluirFinales: true })])
    const porId = new Map(videos.map(v => [v.id, v]))
    // Qué tandas del guion tocó esta subida: por la carpeta / el nombre o por los videos ya vinculados; si no, las activas
    const tocadas = new Set<number>()
    for (const a of propios) {
      if (a.inferido.tanda_guion !== null) tocadas.add(a.inferido.tanda_guion)
      const v = a.video_id ? porId.get(a.video_id) : undefined
      if (v?.tanda_guion != null) tocadas.add(v.tanda_guion)
    }
    if (!tocadas.size) for (const v of videos) if (v.tanda_guion !== null && ['esperando_crudos', 'crudo_a_revisar', 'regrabar'].includes(v.estado)) tocadas.add(v.tanda_guion)
    const guiones: GuionDoc[] = (doc?.guiones ?? []).filter(g => tocadas.has(g.tanda) && (g.estado_doc !== 'no_iniciado' || videos.some(v => refDe(v) === g.ref)))
    const videoDe = new Map(videos.filter(v => v.estado !== 'descartado').map(v => [refDe(v), v.id]))
    // Todos los crudos del cliente desde que esas tandas del guion empezaron (no solo los de esta subida)
    const inicios = videos.filter(v => v.tanda_guion !== null && tocadas.has(v.tanda_guion)).map(v => Date.parse(v.creado)).filter(Number.isFinite)
    const desde = inicios.length ? new Date(Math.min(...inicios) - msHoras(24)).toISOString() : new Date(Date.parse(tanda.desde) - msHoras(24 * 30)).toISOString()
    const crudos = (await deps.repo.crudosDeCliente(tanda.id_crm, desde)).filter(a => /^(video|audio)\//i.test(a.mime))
    const listos = crudos.filter(a => a.transcripcion.estado === 'lista')
    const trans = (await deps.repo.transcripcionesDe(listos.map(a => a.id))).map(t => ({ archivo_id: t.archivo_id, palabras: t.palabras }))
    const ubicados = new Map<number, string>()
    const unicaTocada = tocadas.size === 1 ? [...tocadas][0] : null
    for (const a of crudos) {
      const v = a.video_id ? porId.get(a.video_id) : undefined
      if (v) { ubicados.set(a.id, refDe(v)); continue }
      if (a.inferido.numero !== null) {
        const t = a.inferido.tanda_guion ?? unicaTocada
        if (t !== null) ubicados.set(a.id, `T${t}-V${a.inferido.numero}`)
      }
    }
    const cruce = cruceSimple(guiones, trans, { ubicados, videoDe })
    let coberturas: CoberturaGuion[] = cruce.coberturas
    let tokens: { in: number; out: number } | null = null
    let pendienteClaude: string[] = []
    if (cruce.necesitaClaude.length) {
      const puedeClaude = deps.modo === 'real' && deps.claude && !op.sinClaude && op.deadline - Date.now() >= MIN_PARA_CLAUDE_MS
      if (puedeClaude) {
        if (deps.esOperativo && !await deps.esOperativo(tanda.id_crm)) {
          await deps.repo.soltarComparacion(tanda.id)
          return { tanda_id, resultado: null, eventos: [], extra: [], motivo: 'cliente archivado' }
        }
        try {
          const c = await compararConClaude({ guiones: guiones.filter(g => cruce.necesitaClaude.includes(g.ref)), coberturas, trans }, deps.claude!)
          coberturas = c.coberturas
          tokens = c.tokens
        } catch (e) {
          extra.push({ tipo: 'error', proceso: 'comparacion', motivo: `Claude no pudo comparar la tanda ${tanda.id}: ${motivo(e)}` })
        }
      } else if (deps.modo === 'real' && deps.claude) {
        pendienteClaude = cruce.necesitaClaude
      }
    }
    const propiosIds = new Set(propios.map(a => a.id))
    const resultado: ResultadoComparacion = {
      version: VERSION_COMPARACION, generado: op.ahora.toISOString(), guiones: coberturas,
      sin_ubicar: cruce.sin_ubicar.filter(id => propiosIds.has(id)),
      // Sin las copias marcadas como duplicado: su gemelo es el que se transcribe (revisión de la integración, ronda 3: el aviso
      // decía "1 crudo sin transcribir" por una copia)
      sin_transcribir: propios.filter(a => /^(video|audio)\//i.test(a.mime) && a.transcripcion.estado !== 'lista' && !esCopiaDuplicada(a)).map(a => a.id),
      tokens, ...(pendienteClaude.length ? { pendiente_claude: pendienteClaude } : {}),
    }
    await deps.repo.guardarResultado(tanda.id, resultado)
    // Lo que se ubicó por contenido se vincula (como bot: nunca pisa a una persona). Los videos que esperaban crudos se
    // mueven con TODOS los crudos vinculados de la tanda (también los que ya venían por carpeta o nombre: una tanda que cerró
    // asignarATanda por el hueco de 45 minutos no pasó por cerrarTandas)
    const mover = new Map<number, ArchivoGrabacion>()
    for (const a of propios) {
      if (a.tipo !== 'crudo') continue
      if (a.video_id !== null) { sumarCrudo(mover, a.video_id, a); continue }
      const asig = cruce.asignacion.get(a.id)
      if (!asig) continue
      const vid = videoDe.get(asig.ref)
      if (!vid) continue
      const x = await deps.repo.vincularArchivo({ archivo_id: a.id, video_id: vid, actor: BOT_COMPARACION, por: asig.por === 'carpeta' ? 'carpeta' : 'contenido' })
      if (x.ok) sumarCrudo(mover, vid, a)
    }
    eventos.push(...await moverConCrudos(deps, mover, BOT_COMPARACION, { tanda_id: tanda.id }))
    // El aviso de la tanda sale una vez, con el resultado final (si quedó Claude pendiente, lo manda el vigía después)
    if (!pendienteClaude.length) {
      const cerrada = tanda.cerrada ? Date.parse(tanda.cerrada) : op.ahora.getTime()
      const demorada = resultado.sin_transcribir.length > 0 && op.ahora.getTime() - cerrada >= ESPERA_TRANSCRIPCION_MIN * 60_000
      extra.push({ tipo: 'tanda_crudos', tanda: { ...tanda, estado: 'comparada', resultado }, cliente: op.cliente ?? videos[0]?.cliente ?? tanda.id_crm, demorada })
      await deps.repo.marcarAvisada(tanda.id)
    }
    return { tanda_id, resultado, eventos, extra }
  } catch (e) {
    // La tanda vuelve a 'cerrada' para que la próxima corrida la retome (si no, quedaría 'comparando' para siempre); si ni
    // eso se puede, tandasParaComparar la levanta igual pasados COMPARANDO_COLGADA_MIN
    try { await deps.repo.soltarComparacion(tanda.id) } catch { /* la retoma por colgada */ }
    extra.push({ tipo: 'error', proceso: 'comparacion', motivo: `tanda ${tanda.id}: ${motivo(e)}` })
    return { tanda_id, resultado: null, eventos, extra, motivo: motivo(e) }
  }
}

// ── Vigía ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanVigia { carpetas: number; consultadas: number; archivos_vistos: number; subcarpetas_nuevas: number; por_cliente: Record<string, number> }
export interface ResultadoVigia {
  ok: boolean; dry: boolean; saltada?: string; corrida: number | null
  consultas: number; carpetas: number; consultadas: number; pendientes: number; archivos_nuevos: number
  tandas_cerradas: number; comparadas: number; eventos: number; avisos: number; fases: string[]
  errores: string[]; plan?: PlanVigia
}

interface Lectura { archivos: ArchivoDrive[]; carpetasNuevas: CarpetaGrabacion[]; consultas: { drive_id: string; cuando: string; ultimo_archivo: string | null }[] }

/**
 * Lista una carpeta vigilada y recorre enteras, en esta misma corrida, sus subcarpetas NUEVAS hasta NIVELES_ARBOL. Las que ya
 * se vigilan (`conocidas`) no se bajan: se consultan por su cuenta (si no, el mismo archivo llegaba dos veces). Si se acaba el
 * tiempo, las subcarpetas que faltan se guardan igual sin recorrer: quedan vigiladas con `consultada` vacía y la próxima
 * corrida las lista enteras.
 */
async function leerCarpeta(drive: LectorDrive, c: CarpetaGrabacion, cuando: string, deadline: number, conocidas: ReadonlySet<string>): Promise<Lectura> {
  const out: Lectura = { archivos: [], carpetasNuevas: [], consultas: [] }
  const desde = c.consultada ? new Date(Date.parse(c.consultada) - MARGEN_VIGIA_MIN * 60_000).toISOString() : null
  const r = await drive.listarCambios(c, desde)
  const ultimo = (xs: ArchivoDrive[]) => xs.map(a => a.creado).filter(Boolean).sort().pop() ?? null
  out.archivos.push(...r.archivos)
  out.consultas.push({ drive_id: c.drive_id, cuando, ultimo_archivo: ultimo(r.archivos) })
  const vistas = new Set<string>()
  const nuevasDe = (xs: CarpetaGrabacion[]) => xs.filter(s => s.nivel <= NIVELES_ARBOL && !conocidas.has(s.drive_id) && !vistas.has(s.drive_id))
  let cola = nuevasDe(r.carpetas)
  while (cola.length) {
    const siguiente: CarpetaGrabacion[] = []
    for (const s of cola) {
      if (vistas.has(s.drive_id)) continue
      vistas.add(s.drive_id)
      out.carpetasNuevas.push(s)
      if (Date.now() >= deadline) continue
      const h = await drive.listarCambios(s, null)
      out.archivos.push(...h.archivos)
      out.consultas.push({ drive_id: s.drive_id, cuando, ultimo_archivo: ultimo(h.archivos) })
      siguiente.push(...nuevasDe(h.carpetas))
    }
    cola = siguiente
  }
  return out
}

/** ¿Hubo más de HORAS_VIGIA_CALLADO horas de horario de trabajo (8 a 22, Argentina) entre `desde` y `hasta`? */
export function horasCalladas(desde: Date, hasta: Date): number {
  let ms = 0
  for (let t = desde.getTime(); t < hasta.getTime(); t += 60_000) {
    const h = horaAR(new Date(t))
    if (h >= HORARIO_VIGIA.desde && h < HORARIO_VIGIA.hasta) ms += 60_000
  }
  return ms / 3_600_000
}

export async function correrVigia(deps: DepsVigia, op: { tipo: 'vigia' | 'completa' | 'diario'; origen: Corrida['origen']; deadline: number }): Promise<ResultadoVigia> {
  const ahora = deps.ahora()
  const r: ResultadoVigia = { ok: true, dry: deps.modo === 'dry', corrida: null, consultas: 0, carpetas: 0, consultadas: 0, pendientes: 0, archivos_nuevos: 0,
    tandas_cerradas: 0, comparadas: 0, eventos: 0, avisos: 0, fases: [], errores: [] }
  const corte = op.deadline - MARGEN_DEADLINE_MS
  const consultas0 = deps.drive.consultas()

  if (deps.modo === 'dry') {
    // Plan: qué carpetas se consultarían y qué archivos se ven (sin escribir nada: `consultada` no avanza)
    const carpetas = await deps.repo.carpetasAVigilar(500)
    const conocidas = new Set(carpetas.map(c => c.drive_id))
    const plan: PlanVigia = { carpetas: carpetas.length, consultadas: 0, archivos_vistos: 0, subcarpetas_nuevas: 0, por_cliente: {} }
    await enParalelo(carpetas, PARALELO_DRIVE, async c => {
      if (Date.now() > corte) return
      try {
        const l = await leerCarpeta(deps.drive, c, ahora.toISOString(), corte, conocidas)
        plan.consultadas++; plan.archivos_vistos += l.archivos.length; plan.subcarpetas_nuevas += l.carpetasNuevas.length
        if (c.id_crm) plan.por_cliente[c.id_crm] = (plan.por_cliente[c.id_crm] ?? 0) + l.archivos.length
      } catch (e) { r.errores.push(`${c.nombre}: ${motivo(e)}`) }
    })
    return { ...r, carpetas: carpetas.length, consultadas: plan.consultadas, pendientes: carpetas.length - plan.consultadas, consultas: deps.drive.consultas() - consultas0, plan }
  }

  const previa = op.tipo === 'vigia' ? await deps.repo.ultimaCorrida('vigia').catch(() => null) : null
  const corrida = await deps.repo.abrirCorrida(op.tipo, op.origen)
  if (!corrida) return { ...r, ok: true, saltada: 'otra corrida en curso' }
  r.corrida = corrida.id
  const eventos: EventoVideo[] = [], extra: AvisoMotor[] = []
  const resumen: Record<string, unknown> = {}
  let fatal: string | null = null
  try {
    if (op.tipo === 'completa') {
      const p = await pasadaCompleta(deps, { deadline: corte, ahora })
      eventos.push(...p.eventos); extra.push(...p.extra); r.archivos_nuevos += p.archivos_nuevos; r.errores.push(...p.errores)
      if (p.completa) r.fases.push(`diario:${ymdAR(ahora)}:completa`)
      Object.assign(resumen, { completa: p.resumen })
    } else if (op.tipo === 'diario') {
      // El diario: primero sus fases (la pasada completa, e01, resumen…); después, tandas, transcripción y comparación
      if (deps.retomar) {
        const f = await deps.retomar({ deadline: corte, ahora, corrida })
        r.fases.push(...f.fases); eventos.push(...f.eventos); extra.push(...f.extra)
      }
    } else {
      // 1. Consultar lo vigilado (barrido rotativo)
      const carpetas = await deps.repo.carpetasAVigilar(500)
      r.carpetas = carpetas.length
      const lecturas: Lectura[] = []
      const mapa = new Map(carpetas.map(c => [c.drive_id, c]))
      const conocidas = new Set(mapa.keys())
      await enParalelo(carpetas, PARALELO_DRIVE, async c => {
        if (Date.now() > corte) return
        try {
          // La hora de ARRANQUE de la corrida (anterior a la consulta real): el próximo filtro por fecha no se pierde nada
          lecturas.push(await leerCarpeta(deps.drive, c, ahora.toISOString(), corte, conocidas))
        } catch (e) { r.errores.push(`${c.nombre}: ${motivo(e)}`) }
      })
      r.consultadas = new Set(lecturas.flatMap(l => l.consultas.map(x => x.drive_id)).filter(id => conocidas.has(id))).size
      r.pendientes = carpetas.length - r.consultadas
      // Una carpeta y un archivo pueden llegar por dos caminos (dos lecturas en paralelo que bajan a la misma subcarpeta
      // nueva): una sola vez cada uno (un upsert con el drive_id repetido da 21000 y tiraría la corrida entera)
      const nuevas = [...new Map(lecturas.flatMap(l => l.carpetasNuevas).filter(s => !conocidas.has(s.drive_id)).map(s => [s.drive_id, s] as const)).values()]
      for (const s of nuevas) mapa.set(s.drive_id, s)
      if (nuevas.length) await deps.repo.guardarArbol(nuevas)
      // 2. Archivos (y después recién se anota la consulta: si guardar falla, la próxima vuelve a pedirlos)
      const archivos = [...new Map(lecturas.flatMap(l => l.archivos).map(f => [f.drive_id, f] as const)).values()]
      const a = await procesarArchivos(deps, archivos, mapa, ahora)
      r.archivos_nuevos = a.nuevos
      extra.push(...a.extra)
      eventos.push(...a.eventos)
      await deps.repo.anotarConsultas(lecturas.flatMap(l => l.consultas))
      Object.assign(resumen, { archivos: a })
    }
    // 3. Cierre de tandas
    const c = await cerrarTandas(deps, ahora)
    r.tandas_cerradas = c.cerradas
    eventos.push(...c.eventos)
    // 4. Transcripciones
    if (deps.transcripcion && Date.now() < corte) {
      try {
        // Un envío a AssemblyAI puede tardar hasta 30 s (dos intentos de 15): no arranca uno pegado al corte
        const env = await enviarPendientes(deps.transcripcion, { deadline: corte - MARGEN_PASO_LARGO_MS })
        const bar = await barrerColgadas(deps.transcripcion, { deadline: corte })
        extra.push(...env.extra, ...bar.extra)
        Object.assign(resumen, { transcripcion: { enviados: env.enviados, grandes: env.grandes, sin_key: env.sin_key, errores: env.errores, tope_diario: env.tope_diario, reenviar: bar.reenviar, borradas: bar.borradas } })
      } catch (e) { r.errores.push(`transcripción: ${motivo(e)}`) }
    }
    // 5. Comparación de las tandas listas
    for (const t of await deps.repo.tandasParaComparar(ahora)) {
      if (Date.now() > corte) break
      const x = await compararTanda(deps, t.id, { deadline: corte, ahora })
      if (x.resultado) r.comparadas++
      eventos.push(...x.eventos); extra.push(...x.extra)
    }
    // 6. Fases del diario que falten (resumen de la daily después de las 7:45, e01 del día…)
    if (op.tipo !== 'diario' && deps.retomar && Date.now() < corte) {
      try {
        const f = await deps.retomar({ deadline: corte, ahora, corrida })
        r.fases.push(...f.fases); eventos.push(...f.eventos); extra.push(...f.extra)
      } catch (e) { r.errores.push(`diario: ${motivo(e)}`) }
    }
    // 7. Vigía callado (más de 2 horas de horario de trabajo sin corrida)
    if (previa?.fin) {
      const horas = horasCalladas(new Date(previa.fin), ahora)
      if (horas > HORAS_VIGIA_CALLADO) extra.push({ tipo: 'vigia_callado', desde: previa.fin, horas: Math.round(horas * 10) / 10 })
    }
  } catch (e) {
    fatal = motivo(e)
    r.ok = false
    r.errores.push(fatal)
    extra.push({ tipo: 'error', proceso: op.tipo === 'completa' ? 'pasada completa' : 'vigia', motivo: fatal })
  }
  // Los errores pasajeros de Drive (5xx, tiempo) quedan en la corrida; a Tomás le llega lo que no se arregla solo
  for (const e of r.errores.slice(0, 5)) if (e !== fatal && !/respondió 5\d\d|no respondió|timeout|aborted/i.test(e)) extra.push({ tipo: 'error', proceso: 'vigia', motivo: e })
  r.eventos = eventos.length
  r.avisos = extra.length
  try { await deps.avisar(eventos, extra) } catch (e) { r.errores.push(`avisos: ${motivo(e)}`) }
  r.consultas = deps.drive.consultas() - consultas0
  // La corrida se cierra ANTES del despacho a Discord: si Vercel corta la función mientras sale un aviso, las fases ya quedaron
  // registradas (la próxima no repite la pasada completa) y lo que no salió sigue en la cola
  try {
    await deps.repo.cerrarCorrida(corrida.id, {
      estado: fatal ? 'error' : 'ok', consultas: r.consultas, archivos_nuevos: r.archivos_nuevos, tandas_cerradas: r.tandas_cerradas,
      error: fatal ?? r.errores.slice(0, 3).join(' · '), resumen: { ...resumen, fases: r.fases, comparadas: r.comparadas, pendientes: r.pendientes, errores: r.errores.length },
    })
  } catch (e) { r.errores.push(`cerrar corrida: ${motivo(e)}`) }
  try { await deps.despachar() } catch (e) { r.errores.push(`despacho: ${motivo(e)}`) }
  return r
}

// ── Pasada completa (la corre el diario) ─────────────────────────────────────────────────────────────────────────
export interface ResultadoPasada {
  completa: boolean; archivos_nuevos: number; eventos: EventoVideo[]; extra: AvisoMotor[]; errores: string[]
  resumen: Record<string, unknown>; avisos_guiones: { id_crm: IdCrm; cliente: string; avisos: string[] }[]
}

/** Candidatos del CRM para una carpeta de cliente (puntaje = palabras en común; 2 si el cruce de carpetas la elige). */
export function candidatosDe(nombreCarpeta: string, crm: readonly ClienteCrm[], elegido: string | null): { id_crm: IdCrm; nombre: string; puntaje: number }[] {
  const ws = new Set(claveNombre(nombreCarpeta).split(' ').filter(w => w.length >= 3))
  return crm.map(c => {
    const comunes = claveNombre(c.nombre).split(' ').filter(w => ws.has(w)).length
    return { id_crm: c.id, nombre: c.nombre, puntaje: c.id === elegido ? Math.max(2, comunes) + 0.5 : comunes }
  }).filter(x => x.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje).slice(0, 3)
}

export async function pasadaCompleta(deps: DepsVigia, op: OpcionesFase): Promise<ResultadoPasada> {
  const out: ResultadoPasada = { completa: false, archivos_nuevos: 0, eventos: [], extra: [], errores: [], resumen: {}, avisos_guiones: [] }
  const ahora = op.ahora
  const [clientes, crm, altas, existentes] = await Promise.all([deps.drive.carpetasClientes(), deps.crm(), deps.altas(), deps.repo.todasLasCarpetas()])
  const previas = new Map(existentes.map(c => [c.drive_id, c]))
  const activos = new Set(crm.filter(c => c.estado.toUpperCase() === 'ACTIVO').map(c => c.id.toUpperCase()))
  const nombreDe = new Map(crm.map(c => [c.id.toUpperCase(), c.nombre]))
  const cruce = crearCruceCarpetas(clientes.map(c => ({ id: c.carpeta.drive_id, nombre: c.carpeta.nombre })), x => x.nombre, crm.map(c => c.nombre))
  const elegida = new Map<string, string>()     // carpeta → id del CRM que la elige el cruce
  for (const c of crm) { const t = cruce(c.nombre); if (t) elegida.set(t.id, c.id) }
  const claves = new Map<string, number>()
  for (const c of clientes) claves.set(claveNombre(c.carpeta.nombre), (claves.get(claveNombre(c.carpeta.nombre)) ?? 0) + 1)

  const carpetas: CarpetaGrabacion[] = []
  const raices: { cliente: (typeof clientes)[number]; id_crm: IdCrm; raiz: CarpetaGrabacion }[] = []
  const marcas: RaizMarca[] = []
  for (const c of clientes) {
    const previa = previas.get(c.carpeta.drive_id)
    let id_crm: IdCrm | null = null, vinculo: CarpetaGrabacion['vinculo'] = 'a_confirmar'
    if (previa?.id_crm && ['alta', 'aylu', 'tomas'].includes(previa.vinculo)) { id_crm = previa.id_crm; vinculo = previa.vinculo }
    else {
      const alta = altas.find(a => a.carpeta_id === c.carpeta.drive_id)
      if (alta) { id_crm = alta.id_crm.toUpperCase(); vinculo = 'alta' }
      else {
        const exactos = crm.filter(x => claveNombre(x.nombre) === claveNombre(c.carpeta.nombre))
        if (exactos.length === 1 && claves.get(claveNombre(c.carpeta.nombre)) === 1) { id_crm = exactos[0].id.toUpperCase(); vinculo = 'bot' }
      }
    }
    const candidatos = vinculo === 'a_confirmar' ? candidatosDe(c.carpeta.nombre, crm, elegida.get(c.carpeta.drive_id) ?? null) : []
    const cliente: CarpetaGrabacion = { ...c.carpeta, id_crm, vinculo, candidatos }
    carpetas.push(cliente)
    for (const [raiz, id, nombre] of [['crudos', c.crudos, 'Crudos'], ['editados', c.editados, 'Editados'], ['marca', c.marca, 'Marca']] as const) {
      if (!id) continue
      const r: CarpetaGrabacion = { drive_id: id, nombre, padre_id: cliente.drive_id, nivel: 0, ruta: [], id_crm, tipo: raiz, raiz, raiz_id: id, vinculo,
        candidatos: [], vigilar: false, creada: null, ultimo_archivo: null, consultada: previas.get(id)?.consultada ?? null, borrada: null }
      carpetas.push(r)
      if (raiz !== 'marca' && id_crm && VINCULOS_OK.has(vinculo) && activos.has(id_crm)) raices.push({ cliente: c, id_crm, raiz: r })
      if (raiz === 'marca' && id_crm && VINCULOS_OK.has(vinculo) && activos.has(id_crm)) marcas.push({ id_crm, cliente: nombreDe.get(id_crm) ?? c.carpeta.nombre, raiz: r })
    }
  }
  await deps.repo.guardarArbol(carpetas)

  // Árbol de cada raíz de los clientes activos con vínculo que procesa: archivos nuevos, movidos y borrados
  let cortado = false
  const borradosConVideo: ArchivoGrabacion[] = []
  const completas: { raiz_id: string; subs: string[] }[] = []
  const presentes = new Set<string>()
  await enParalelo(raices, 4, async x => {
    if (Date.now() > op.deadline) { cortado = true; return }
    try {
      const arbol = await deps.drive.listarArbol(x.raiz, NIVELES_ARBOL)
      // El último archivo de cada subcarpeta (para que ajustarVigilancia vigile las que tuvieron actividad reciente)
      const ultimo = new Map<string, string>()
      for (const f of arbol.archivos) if (f.creado && (!ultimo.has(f.carpeta_id) || f.creado > ultimo.get(f.carpeta_id)!)) ultimo.set(f.carpeta_id, f.creado)
      const subs = arbol.carpetas.map(s => ({ ...s, id_crm: x.id_crm, vinculo: x.raiz.vinculo, raiz: x.raiz.raiz, raiz_id: x.raiz.drive_id, vigilar: false,
        ultimo_archivo: ultimo.get(s.drive_id) ?? null }))
      if (subs.length) await deps.repo.guardarArbol(subs)
      const mapa = new Map<string, CarpetaGrabacion>([[x.raiz.drive_id, x.raiz], ...subs.map(s => [s.drive_id, s] as const)])
      const a = await procesarArchivos(deps, arbol.archivos, mapa, ahora)
      out.archivos_nuevos += a.nuevos
      out.eventos.push(...a.eventos)
      for (const f of arbol.archivos) presentes.add(f.drive_id)
      if (arbol.completo) completas.push({ raiz_id: x.raiz.drive_id, subs: subs.map(s => s.drive_id) })
    } catch (e) { out.errores.push(`${x.cliente.carpeta.nombre} (${x.raiz.nombre}): ${motivo(e)}`) }
  })
  // Borrados: recién con todas las raíces listadas y guardadas, contra lo visto en TODAS (un archivo movido de Crudos a
  // Editados, o de un cliente a otro, ya quedó con su carpeta nueva y no se marca borrado por la raíz de antes; antes corría
  // en paralelo y el orden decidía). Solo las raíces listadas enteras; si la pasada se cortó por tiempo, hoy no se marca nada.
  if (!cortado && Date.now() <= op.deadline) {
    const todos = [...presentes]
    for (const c of completas) {
      const borrados = await deps.repo.marcarBorrados(c.raiz_id, todos)
      borradosConVideo.push(...borrados.filter(b => b.video_id !== null && b.tipo === 'crudo' && !presentes.has(b.drive_id)))
      await deps.repo.marcarCarpetasBorradas(c.raiz_id, c.subs)
    }
  }
  // Un crudo borrado de un video que no está aprobado: bloqueo crudo_borrado y aviso
  if (borradosConVideo.length) {
    const vids = await deps.repo.listarVideos({ ids: [...new Set(borradosConVideo.map(b => b.video_id!))] })
    for (const b of borradosConVideo) {
      const v = vids.find(x => x.id === b.video_id)
      if (!v || v.estado === 'aprobado' || v.estado === 'descartado' || v.bloqueo === 'crudo_borrado') continue
      const u = await deps.repo.actualizarVideo({ id: v.id, version: v.version, actor: BOT_VIGIA, tipo: 'bloqueo',
        cambios: { bloqueo: 'crudo_borrado', motivo_bloqueo: `se borró de Drive el crudo ${b.nombre.slice(0, 80)}` }, datos: { archivo_id: b.id } })
      if (u.ok) { out.eventos.push(u.actual.evento); v.version = u.actual.video.version; v.bloqueo = 'crudo_borrado' }
      out.extra.push({ tipo: 'crudo_borrado', video_id: v.id, id_crm: v.id_crm, cliente: v.cliente, clave: v.clave, numero: v.numero, archivo: b.nombre.slice(0, 120) })
    }
  }
  // Vigilancia: raíces de los activos + subcarpetas con actividad + todo Crudos de los que esperan crudos
  const espera = await deps.repo.listarVideos({ estados: ['esperando_crudos', 'regrabar'] })
  await deps.repo.ajustarVigilancia([...activos], [...new Set(espera.map(v => v.id_crm))], ahora)
  // Vínculos por confirmar: un aviso a Aylu una sola vez por carpeta
  for (const c of await deps.repo.vinculosSinAviso()) out.extra.push({ tipo: 'vinculo_pendiente', carpeta_id: c.drive_id, nombre: c.nombre, candidatos: c.candidatos })
  // Docs de guiones que cambiaron
  const leidos = await deps.repo.docsLeidos()
  for (const x of raices.filter(r => r.raiz.raiz === 'crudos')) {
    const c = x.cliente
    // Un export puede tardar 15 s más el proceso: no arranca uno pegado al corte (queda para la próxima corrida)
    if (!c.guiones_doc || Date.now() > op.deadline - MARGEN_PASO_LARGO_MS) { if (c.guiones_doc) cortado = true; continue }
    const ya = leidos.get(c.guiones_doc)
    // Un doc leído con OTRO cliente (el vínculo de la carpeta se corrigió) se vuelve a leer aunque no haya cambiado en Drive
    const mismoCliente = !!ya && ya.id_crm.toUpperCase() === x.id_crm.toUpperCase()
    if (ya && mismoCliente && c.guiones_modificado && ya.modificado && Date.parse(ya.modificado) >= Date.parse(c.guiones_modificado)) continue
    try {
      const texto = await deps.drive.exportarTexto(c.guiones_doc)
      const doc = parsearDocGuiones(texto, c.guiones_doc, x.id_crm, c.guiones_modificado ?? ahora.toISOString(), ahora.toISOString())
      const p = await procesarDoc(deps, doc, nombreDe.get(x.id_crm) ?? c.carpeta.nombre, ahora)
      out.eventos.push(...p.eventos)
      if (p.avisos.length) out.avisos_guiones.push({ id_crm: x.id_crm, cliente: nombreDe.get(x.id_crm) ?? c.carpeta.nombre, avisos: p.avisos })
    } catch (e) { out.errores.push(`guiones de ${c.carpeta.nombre}: ${motivo(e)}`) }
  }
  // e05: lo que los clientes subieron a "Marca - X" → propuesta de paleta (al final: no apura como un crudo)
  let marca: Record<string, unknown> | null = null
  if (deps.marca && marcas.length && Date.now() <= op.deadline - MARGEN_PASO_LARGO_MS) {
    const m = await revisarMarcas({ drive: deps.drive, claude: deps.claude, repo: deps.marca, modo: deps.modo, esOperativo: deps.esOperativo }, marcas, { deadline: op.deadline })
    out.extra.push(...m.extra)
    // Las fallas de Marca se reintentan solas (marcaVigia.ts): van al resumen, no como aviso de error a Tomás
    marca = { clientes: m.clientes, leidos: m.leidos, propuestas: m.propuestas, por_leer: m.por_leer, cortado: m.cortado, errores: m.errores.slice(0, 5) }
  }
  out.completa = !cortado && Date.now() <= op.deadline
  out.resumen = { clientes: clientes.length, raices: raices.length, archivos_nuevos: out.archivos_nuevos, borrados: borradosConVideo.length, errores: out.errores.length, ...(marca ? { marca } : {}) }
  return out
}

// ── Doc de una carpeta que se corrigió a otro cliente ─────────────────────────────────────────────────────────────
// El doc se había leído con el cliente anterior (vínculo equivocado, corregido en /edicion/vinculos). Revisión de la
// integración, ronda 3: la línea de base quedaba con el cliente anterior, así que el cliente correcto nunca recibía los
// videos de los guiones que ya estaban en "Para grabar", y los videos creados desde el doc seguían en el anterior (y su e01
// le reclamaba crudos a otra persona). Ahora:
//   · los videos del cliente anterior que salieron de este doc y todavía esperan crudos se descartan (nadie trabajó en ellos);
//     los demás quedan con un aviso para Aylu;
//   · esos guiones salen de la línea de base, así el cliente correcto recibe sus videos (con el freno y la fecha de corte de
//     siempre); el resto de la línea de base se mantiene (no aparecen videos fantasma).
export const NOTA_DESCARTE_VINCULO = 'el guion es de otro cliente: la carpeta se corrigió en Vínculos'
async function deCarpetaCorregida(deps: DepsVigia, doc: ReturnType<typeof parsearDocGuiones>, leido: DocGuiones | null, cliente: string): Promise<{ anterior: DocGuiones | null; eventos: EventoVideo[]; avisos: string[] }> {
  if (!leido || leido.id_crm.toUpperCase() === doc.id_crm.toUpperCase()) return { anterior: leido, eventos: [], avisos: [] }
  const eventos: EventoVideo[] = [], avisos: string[] = []
  const delAnterior = (await deps.repo.listarVideos({ id_crm: leido.id_crm, incluirFinales: true })).filter(v => v.guion?.doc_id === doc.doc_id)
  const quedan: string[] = []
  for (const v of delAnterior) {
    if (v.estado === 'esperando_crudos') {
      const r = await deps.repo.moverVideo({ id: v.id, version: v.version, accion: 'descartar', actor: { tipo: 'bot', proceso: 'diario' }, ctx: { nota: NOTA_DESCARTE_VINCULO },
        nota: NOTA_DESCARTE_VINCULO, datos: { vinculo_corregido: true, cliente_nuevo: doc.id_crm } })
      if (r.ok) { eventos.push(r.actual.evento); continue }
    }
    if (v.estado !== 'descartado') quedan.push(v.clave)
  }
  if (quedan.length) avisos.push(`la carpeta pasó a ${cliente}: ${quedan.join(', ')} ${quedan.length === 1 ? 'quedó' : 'quedaron'} en el cliente anterior (${delAnterior[0]?.cliente || leido.id_crm}) con trabajo hecho: revisar y descartar o rehacer`)
  const refs = new Set(delAnterior.map(v => v.guion!.ref))
  return { anterior: { ...leido, guiones: leido.guiones.filter(g => !refs.has(g.ref)) }, eventos, avisos }
}

// ── Doc de guiones → videos (con línea de base y freno) ───────────────────────────────────────────────────────────
export async function procesarDoc(deps: DepsVigia, doc: ReturnType<typeof parsearDocGuiones>, cliente: string, ahora: Date): Promise<{ eventos: EventoVideo[]; altas: number; avisos: string[] }> {
  const eventos: EventoVideo[] = []
  const [leido, videos] = await Promise.all([deps.repo.leerDocPorId(doc.doc_id), deps.repo.listarVideos({ id_crm: doc.id_crm, incluirFinales: true })])
  const corregido = await deCarpetaCorregida(deps, doc, leido, cliente)
  eventos.push(...corregido.eventos)
  const anterior = corregido.anterior
  const corte = /^\d{4}-\d{2}-\d{2}$/.test(deps.env.EDICION_FECHA_CORTE?.trim() ?? '') ? deps.env.EDICION_FECHA_CORTE!.trim() : null
  const plan = planDoc(doc, anterior, videos, { hoy: ymdAR(ahora), corte, maxAltas: MAX_ALTAS_POR_PASADA })
  const actor: Actor = { tipo: 'bot', proceso: 'diario' }
  for (const x of plan.vincular) {
    const v = videos.find(y => y.id === x.video_id)
    const r = await deps.repo.actualizarVideo({ id: x.video_id, version: x.version, actor, tipo: 'creado', nota: 'guion vinculado desde el doc',
      cambios: { guion: { doc_id: doc.doc_id, ref: x.guion.ref, huella: x.guion.huella }, guion_texto: textoGuion(x.guion), ...(v && !v.gancho ? { gancho: ganchoGuion(x.guion) } : {}) },
      datos: { guion_vinculado: x.motivo, ref: x.guion.ref } })
    if (r.ok) eventos.push(r.actual.evento)
  }
  let altas = 0
  for (const a of plan.altas) {
    const r = await deps.repo.crearVideoSiFalta({
      id_crm: doc.id_crm, cliente, clave: a.guion.ref, tanda_guion: a.guion.tanda, numero: a.guion.numero,
      guion: { doc_id: doc.doc_id, ref: a.guion.ref, huella: a.guion.huella }, guion_texto: textoGuion(a.guion), gancho: ganchoGuion(a.guion),
      estado: 'esperando_crudos', prioridad: 'normal', origen: 'doc', clickup_id: null, posible_duplicado: a.posible_duplicado,
    }, actor)
    if (r.creado) { altas++; if (r.evento) eventos.push({ ...r.evento, datos: { ...r.evento.datos, motivo: 'para_grabar' } }) }
  }
  if (altas) await deps.repo.vigilarCrudosDe(doc.id_crm)
  plan.avisos.unshift(...corregido.avisos)
  const avisos = [...doc.avisos, ...plan.avisos]
  // Los guiones que pasaron a "Para grabar" ANTES de la fecha de corte se guardan con su estado de antes y con la fecha de
  // modificación vieja: la próxima pasada vuelve a exportar el doc y, desde el corte, los ve pasar y crea sus videos (si se
  // guardaran en para_grabar, después del corte "ya estaban" y no se crearían nunca)
  const pospuestos = new Set(plan.pospuestos)
  const guardado: typeof doc = pospuestos.size && anterior
    ? { ...doc, modificado: anterior.modificado, guiones: doc.guiones.map(g => pospuestos.has(g.ref) ? { ...g, estado_doc: anterior.guiones.find(x => x.ref === g.ref)?.estado_doc ?? 'no_iniciado' } : g) }
    : doc
  await deps.repo.guardarDoc({ ...guardado, avisos }, huellaTexto(doc.guiones.map(g => g.huella).join('|')))
  return { eventos, altas, avisos: plan.avisos }
}

