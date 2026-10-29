// ── Transcripción de los crudos con AssemblyAI: envío, webhook y barrido ────────────────────────────────────────────
// enviarPendientes (lo llama el vigía): solo crudos video/* o audio/* en `pendiente`.
//   · más pesado que el tope (TOPE_BYTES_TRANSCRIPCION o ASSEMBLYAI_MAX_BYTES) → `grande`: es el corte por tamaño (plan B
//     documentado: subirlo desde Vercel o faster-whisper en la Mac o la VPS; no se implementa ahora);
//   · el mismo crudo subido dos veces (mismo cliente, nombre y peso) → no se transcribe de nuevo (`no_aplica`);
//   · tope de minutos por día (la duración se estima por el peso si Drive todavía no la tiene, a la baja del peso por minuto
//     y distinto para audio y video); uno que no entra hoy se saltea (no frena la cola) y uno más largo que el tope entero
//     pasa a `grande` (plan B);
//   · un pendiente de más de TRANSCRIBIR_ULTIMAS_HORAS (el atraso de semanas sin key) pasa a `vieja` y no se manda;
//   · sin ASSEMBLYAI_API_KEY → queda `pendiente` con el motivo (se anota una sola vez); sin ASSEMBLYAI_WEBHOOK_SECRETO (32+
//     caracteres) tampoco se manda;
//   · si AssemblyAI rechaza las palabras clave (400), se reenvía una vez sin ellas y queda anotado.
//   El webhook_url lleva ?archivo=<id>: un `enviando` que volvió a pendiente pudo haber creado la transcripción igual, y
//   así el webhook la reconoce (la adopta o, si el archivo ya tiene otra, la borra en AssemblyAI).
// atenderWebhook: cabecera X-Edicion-Secreto en tiempo constante (sin el secreto configurado → 503; distinto → 401).
//   Con `completed`: traer → guardar en Neon → BORRAR en AssemblyAI apenas se guardó (si el borrado falla, queda marcado y el
//   vigía lo reintenta). Con `error`: un fallo de descarga se anota como `link_privado` (plan B) y se avisa.
//   Responde enseguida; el trabajo va en after() (la ruta). Si la tanda del crudo ya cerró y quedó completa, compara SOLO con
//   el cruce simple (alListo): Claude no entra en los 60 s del webhook, lo toma el vigía.
// barrerColgadas: enviando de más de 10 min → pendiente; enviada de más de 30 min → GET; listas sin borrar → se borran; y,
//   una vez por día, la lista de AssemblyAI de las últimas 48 horas: lo que no se guardó o ya está guardado se borra allá.
// En modo dry no se llama a AssemblyAI ni se escribe: se devuelve el plan.
import type { ArchivoGrabacion, AvisoMotor, EstadoTranscripcion, IdCrm, Transcripcion } from '@/lib/edicion/tipos'
import { BYTES_POR_MINUTO_AUDIO, BYTES_POR_MINUTO_VIDEO, MIN_SECRETO, MOTIVO_DUPLICADO, TOPE_MINUTOS_TRANSCRIPCION_DIA, TRANSCRIBIR_ULTIMAS_HORAS, topeBytesTranscripcion } from '@/lib/edicion/config'
import { igualesSeguro } from '@/lib/auth/cookie'
import { esTransitorio } from '@/lib/fathomAnuncios/errores'
import { ErrorAssembly, esFallaDescarga, urlDescargaDrive, type TranscripcionProveedor, type Transcriptor } from './assemblyai'

export interface RepoTranscripcion {
  pendientesDeTranscribir(limite: number): Promise<ArchivoGrabacion[]>
  reclamarTranscripcion(archivo_id: number, segundos?: number | null): Promise<boolean>
  anotarTranscripcion(archivo_id: number, c: { estado: EstadoTranscripcion; proveedor_id?: string; motivo?: string }): Promise<void>
  guardarTranscripcion(t: Transcripcion): Promise<void>
  anotarBorradaProveedor(archivo_id: number, borrada?: boolean): Promise<void>
  porProveedorId(id: string): Promise<ArchivoGrabacion | null>
  leerArchivo(id: number): Promise<ArchivoGrabacion | null>
  colgadas(ahora: Date): Promise<{ enviando: ArchivoGrabacion[]; enviada: ArchivoGrabacion[]; sinBorrar: ArchivoGrabacion[] }>
  segundosEnviadosDesde(desde: string): Promise<number>
  buscarGemelo(a: Pick<ArchivoGrabacion, 'id' | 'id_crm' | 'nombre' | 'bytes'>): Promise<number | null>
}
export interface DepsTranscripcion {
  transcriptor: Transcriptor | null
  repo: RepoTranscripcion
  palabras(id_crm: IdCrm): Promise<string[]>
  cliente?(id_crm: IdCrm): string
  env: Record<string, string | undefined>
  ahora(): Date
  modo: 'dry' | 'real'
  urlBase: string
  /** Después de guardar una transcripción (el webhook): compara la tanda con el cruce simple si ya está completa. */
  alListo?(archivo: ArchivoGrabacion): Promise<void>
  esOperativo?(idCrm: string): Promise<boolean>
}

export const LIMITE_POR_CORRIDA = 25
const MOTIVO_SIN_KEY = 'falta ASSEMBLYAI_API_KEY'
const MOTIVO_SIN_SECRETO = 'falta ASSEMBLYAI_WEBHOOK_SECRETO'

/** El secreto del webhook, solo si está y tiene 32 caracteres o más (si no, mal configurado: null). */
export function secretoWebhook(env: Record<string, string | undefined>): string | null {
  const s = env.ASSEMBLYAI_WEBHOOK_SECRETO?.trim() ?? ''
  return s.length >= MIN_SECRETO ? s : null
}

/** Segundos para el tope diario: la duración de Drive o, si todavía no está (lo normal en la primera corrida, y siempre en
 *  los audio/*), una estimación por el peso a la BAJA del peso por minuto (sobreestima: el tope frena de más, nunca de menos). */
export const segundosEstimados = (a: Pick<ArchivoGrabacion, 'duracion_ms' | 'bytes'> & { mime?: string }): number => {
  if (a.duracion_ms) return Math.ceil(a.duracion_ms / 1000)
  if (!a.bytes) return 60
  const porMinuto = /^audio\//i.test(a.mime ?? '') ? BYTES_POR_MINUTO_AUDIO : BYTES_POR_MINUTO_VIDEO
  return Math.ceil((a.bytes / porMinuto) * 60)
}

/** Inicio del día de hoy en Argentina (UTC−3), en ISO. */
export function inicioDelDiaAR(ahora: Date): string {
  const ymd = new Date(ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
  return `${ymd}T03:00:00.000Z`
}

const gb = (b: number) => (b / 1e9).toFixed(1).replace('.', ',')
const motivoDe = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export interface ResultadoEnvio {
  enviados: number; grandes: number; duplicados: number; sin_key: number; errores: number; tope_diario: boolean
  /** Pendientes de más de TRANSCRIBIR_ULTIMAS_HORAS (el atraso del modo sombra sin key, o lo que el tope dejó para otro día):
   *  pasan a `vieja` y no se mandan (sus tandas ya se avisaron). */
  viejas?: number
  extra: AvisoMotor[]; plan?: { archivo_id: number; nombre: string; accion: string }[]
}

export async function enviarPendientes(deps: DepsTranscripcion, op: { deadline: number }): Promise<ResultadoEnvio> {
  const r: ResultadoEnvio = { enviados: 0, grandes: 0, duplicados: 0, sin_key: 0, errores: 0, tope_diario: false, extra: [] }
  const pendientes = await deps.repo.pendientesDeTranscribir(LIMITE_POR_CORRIDA)
  if (!pendientes.length) return r
  const tope = topeBytesTranscripcion(deps.env)
  const secreto = secretoWebhook(deps.env)
  const dry = deps.modo === 'dry'
  if (dry) r.plan = []
  let segundos = dry ? 0 : await deps.repo.segundosEnviadosDesde(inicioDelDiaAR(deps.ahora()))
  const cache = new Map<string, string[]>()
  const atraso = deps.ahora().getTime() - TRANSCRIBIR_ULTIMAS_HORAS * 3_600_000
  const topeDia = TOPE_MINUTOS_TRANSCRIPCION_DIA * 60
  for (const a of pendientes) {
    if (Date.now() > op.deadline) break
    const creado = Date.parse(a.creado)
    if (Number.isFinite(creado) && creado < atraso) {
      r.viejas = (r.viejas ?? 0) + 1
      if (dry) { r.plan!.push({ archivo_id: a.id, nombre: a.nombre, accion: `vieja (más de ${TRANSCRIBIR_ULTIMAS_HORAS} h): no se transcribe` }); continue }
      await deps.repo.anotarTranscripcion(a.id, { estado: 'vieja', motivo: `pendiente de más de ${TRANSCRIBIR_ULTIMAS_HORAS} h: no se transcribe` })
      continue
    }
    if (a.bytes !== null && a.bytes > tope) {
      r.grandes++
      if (dry) { r.plan!.push({ archivo_id: a.id, nombre: a.nombre, accion: `grande (${gb(a.bytes)} GB): plan B` }); continue }
      await deps.repo.anotarTranscripcion(a.id, { estado: 'grande', motivo: `${gb(a.bytes)} GB: plan B` })
      r.extra.push({ tipo: 'transcripcion_fallida', archivo_id: a.id, id_crm: a.id_crm, cliente: deps.cliente?.(a.id_crm) ?? a.id_crm, nombre: a.nombre, motivo: 'grande' })
      continue
    }
    if (!deps.transcriptor || !secreto) {
      r.sin_key++
      const motivo = !deps.transcriptor ? MOTIVO_SIN_KEY : MOTIVO_SIN_SECRETO
      if (dry) { r.plan!.push({ archivo_id: a.id, nombre: a.nombre, accion: `sin enviar (${motivo})` }); continue }
      if (a.transcripcion.motivo !== motivo) await deps.repo.anotarTranscripcion(a.id, { estado: 'pendiente', motivo })
      continue
    }
    const gemelo = await deps.repo.buscarGemelo(a)
    if (gemelo !== null) {
      r.duplicados++
      if (dry) { r.plan!.push({ archivo_id: a.id, nombre: a.nombre, accion: `${MOTIVO_DUPLICADO}${gemelo}` }); continue }
      await deps.repo.anotarTranscripcion(a.id, { estado: 'no_aplica', motivo: `${MOTIVO_DUPLICADO}${gemelo}` })
      continue
    }
    const seg = segundosEstimados(a)
    // Más largo que el tope de un día entero (una charla de Zoom de 3 h): nunca entraría y frenaría la cola de todos → plan B
    if (seg > topeDia) {
      r.grandes++
      const motivo = `dura unos ${Math.round(seg / 60)} min (más que el tope de ${TOPE_MINUTOS_TRANSCRIPCION_DIA} por día): plan B`
      if (dry) { r.plan!.push({ archivo_id: a.id, nombre: a.nombre, accion: motivo }); continue }
      await deps.repo.anotarTranscripcion(a.id, { estado: 'grande', motivo })
      r.extra.push({ tipo: 'transcripcion_fallida', archivo_id: a.id, id_crm: a.id_crm, cliente: deps.cliente?.(a.id_crm) ?? a.id_crm, nombre: a.nombre, motivo: 'grande' })
      continue
    }
    // No entra hoy: queda pendiente, pero sigue la cola (uno más corto puede entrar)
    if (segundos + seg > topeDia) { r.tope_diario = true; continue }
    if (dry) { r.plan!.push({ archivo_id: a.id, nombre: a.nombre, accion: 'enviar a AssemblyAI' }); segundos += seg; continue }
    if (deps.esOperativo && !await deps.esOperativo(a.id_crm)) continue
    if (!(await deps.repo.reclamarTranscripcion(a.id, seg))) continue
    segundos += seg
    if (!cache.has(a.id_crm)) cache.set(a.id_crm, await deps.palabras(a.id_crm))
    const palabras = cache.get(a.id_crm)!
    const pedido = {
      audioUrl: urlDescargaDrive(a.drive_id), palabrasClave: palabras, secreto,
      webhookUrl: `${deps.urlBase.replace(/\/+$/, '')}/api/bot/grabacion/transcripcion?archivo=${a.id}`,
    }
    try {
      const tr = deps.transcriptor
      let sinPalabras = false
      const x = await tr.enviar(pedido).catch(async (e: unknown) => {
        if (!(e instanceof ErrorAssembly && e.status === 400 && e.codigo === 'palabras_clave' && palabras.length)) throw e
        sinPalabras = true
        return tr.enviar({ ...pedido, palabrasClave: [] })
      })
      const notas = [sinPalabras ? 'AssemblyAI rechazó las palabras clave: se mandó sin ellas' : '', x.aviso ?? ''].filter(Boolean).join(' · ')
      await deps.repo.anotarTranscripcion(a.id, { estado: 'enviada', proveedor_id: x.id, motivo: notas })
      r.enviados++
    } catch (e) {
      r.errores++
      const transitorio = esTransitorio(e)
      await deps.repo.anotarTranscripcion(a.id, { estado: transitorio ? 'pendiente' : 'error', motivo: motivoDe(e) })
      if (!transitorio) r.extra.push({ tipo: 'error', proceso: 'transcripcion', motivo: `no se pudo mandar a transcribir: ${motivoDe(e)}` })
    }
  }
  return r
}

// ── Una transcripción terminada (webhook o barrido) ─────────────────────────────────────────────────────────────
export interface ResultadoProceso { archivo_id: number; estado: 'lista' | 'error' | 'en_curso'; borrada: boolean; extra: AvisoMotor[] }

async function procesarTerminada(deps: DepsTranscripcion, a: ArchivoGrabacion, t: TranscripcionProveedor): Promise<ResultadoProceso> {
  const tr = deps.transcriptor!
  if (t.estado === 'queued' || t.estado === 'processing') return { archivo_id: a.id, estado: 'en_curso', borrada: false, extra: [] }
  const extra: AvisoMotor[] = []
  if (t.estado === 'completed') {
    await deps.repo.guardarTranscripcion({
      archivo_id: a.id, proveedor: 'assemblyai', modelo: t.modelo, idioma: t.idioma ?? 'es', texto: t.texto,
      palabras: t.palabras, duracion_ms: t.duracion_ms, creado: deps.ahora().toISOString(),
    })
  } else {
    const privado = esFallaDescarga(t.error)
    await deps.repo.anotarTranscripcion(a.id, { estado: 'error', motivo: `${privado ? 'link_privado: ' : ''}${t.error ?? 'error sin detalle'}` })
    if (privado) extra.push({ tipo: 'transcripcion_fallida', archivo_id: a.id, id_crm: a.id_crm, cliente: deps.cliente?.(a.id_crm) ?? a.id_crm, nombre: a.nombre, motivo: 'link_privado' })
  }
  // Borrar del lado de AssemblyAI apenas se guardó (P5). Si falla, queda tr_borrada_proveedor = false y lo reintenta el vigía
  let borrada = false
  try {
    await tr.borrar(t.id)
    await deps.repo.anotarBorradaProveedor(a.id, true)
    borrada = true
  } catch { /* lo reintenta barrerColgadas */ }
  if (t.estado === 'completed' && deps.alListo) {
    try { await deps.alListo({ ...a, transcripcion: { ...a.transcripcion, estado: 'lista' } }) } catch { /* lo compara el vigía */ }
  }
  return { archivo_id: a.id, estado: t.estado === 'completed' ? 'lista' : 'error', borrada, extra }
}

// ── Webhook ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PedidoWebhook { cabecera: string | null; archivo: string | null; cuerpo: unknown }
export interface RespuestaWebhook {
  status: number; cuerpo: Record<string, unknown>
  /** El trabajo pesado, para after() (null = nada que hacer). */
  trabajo: (() => Promise<ResultadoProceso | { ignorado: string }>) | null
}

const ID_TRANSCRIPCION = /^[A-Za-z0-9_-]{6,80}$/

export function atenderWebhook(deps: DepsTranscripcion, p: PedidoWebhook): RespuestaWebhook {
  const secreto = secretoWebhook(deps.env)
  if (!secreto) return { status: 503, cuerpo: { error: 'no configurado' }, trabajo: null }
  if (typeof p.cabecera !== 'string' || !igualesSeguro(p.cabecera, secreto)) return { status: 401, cuerpo: { error: 'no autorizado' }, trabajo: null }
  const c = (p.cuerpo ?? {}) as { transcript_id?: unknown; status?: unknown }
  const tid = typeof c.transcript_id === 'string' && ID_TRANSCRIPCION.test(c.transcript_id) ? c.transcript_id : null
  const estado = typeof c.status === 'string' ? c.status : ''
  if (!tid || !['completed', 'error'].includes(estado)) return { status: 200, cuerpo: { ok: true, ignorado: true }, trabajo: null }
  const archivoParam = p.archivo && /^\d{1,15}$/.test(p.archivo) ? Number(p.archivo) : null
  if (deps.modo === 'dry') return { status: 200, cuerpo: { ok: true, dry: true, habria: { transcript_id: tid, status: estado, archivo: archivoParam } }, trabajo: null }
  if (!deps.transcriptor) return { status: 200, cuerpo: { ok: true, sin_key: true }, trabajo: null }
  return {
    status: 200, cuerpo: { ok: true },
    trabajo: async () => {
      let a = await deps.repo.porProveedorId(tid)
      if (!a && archivoParam !== null) {
        const b = await deps.repo.leerArchivo(archivoParam)
        if (b) {
          const otra = b.transcripcion.proveedor_id && b.transcripcion.proveedor_id !== tid
          if (otra || b.transcripcion.estado === 'lista') {
            // Huérfana: el archivo ya tiene otra transcripción → se borra esta en AssemblyAI (P5)
            try { await deps.transcriptor!.borrar(tid) } catch { /* la barre el diario */ }
            return { ignorado: 'huérfana: el archivo ya tenía otra transcripción (borrada en AssemblyAI)' }
          }
          await deps.repo.anotarTranscripcion(b.id, { estado: 'enviada', proveedor_id: tid, motivo: 'adoptada por el webhook' })
          a = { ...b, transcripcion: { ...b.transcripcion, estado: 'enviada', proveedor_id: tid } }
        }
      }
      if (!a) return { ignorado: 'transcripción desconocida' }
      if (a.transcripcion.estado === 'lista' && a.transcripcion.proveedor_id === tid) {
        try { await deps.transcriptor!.borrar(tid); await deps.repo.anotarBorradaProveedor(a.id, true) } catch { /* reintento del vigía */ }
        return { ignorado: 'ya estaba guardada' }
      }
      return procesarTerminada(deps, a, await deps.transcriptor!.traer(tid))
    },
  }
}

// ── Barrido de lo colgado ──────────────────────────────────────────────────────────────────────────────────────
export interface ResultadoBarrido { reenviar: number; consultadas: number; borradas: number; huerfanas: number; extra: AvisoMotor[] }

export async function barrerColgadas(deps: DepsTranscripcion, op: { deadline: number; listarProveedor?: boolean }): Promise<ResultadoBarrido> {
  const r: ResultadoBarrido = { reenviar: 0, consultadas: 0, borradas: 0, huerfanas: 0, extra: [] }
  if (deps.modo === 'dry' || !deps.transcriptor) return r
  const tr = deps.transcriptor
  const { enviando, enviada, sinBorrar } = await deps.repo.colgadas(deps.ahora())
  for (const a of enviando) {
    await deps.repo.anotarTranscripcion(a.id, { estado: 'pendiente', motivo: 'reintento: quedó enviando' })
    r.reenviar++
  }
  for (const a of enviada) {
    if (Date.now() > op.deadline || !a.transcripcion.proveedor_id) continue
    try {
      const p = await procesarTerminada(deps, a, await tr.traer(a.transcripcion.proveedor_id))
      r.consultadas++
      r.extra.push(...p.extra)
    } catch (e) {
      if (!esTransitorio(e)) await deps.repo.anotarTranscripcion(a.id, { estado: 'error', motivo: motivoDe(e) })
    }
  }
  for (const a of sinBorrar) {
    if (Date.now() > op.deadline || !a.transcripcion.proveedor_id) continue
    try { await tr.borrar(a.transcripcion.proveedor_id); await deps.repo.anotarBorradaProveedor(a.id, true); r.borradas++ } catch { /* la próxima */ }
  }
  if (op.listarProveedor && tr.listar) {
    const desde = new Date(deps.ahora().getTime() - 48 * 3_600_000).toISOString()
    let lista: Awaited<ReturnType<NonNullable<Transcriptor['listar']>>> = []
    try { lista = await tr.listar(desde) } catch { lista = [] }
    for (const t of lista) {
      if (Date.now() > op.deadline) break
      if (t.estado !== 'completed' && t.estado !== 'error') continue
      const a = await deps.repo.porProveedorId(t.id)
      try {
        if (!a) { await tr.borrar(t.id); r.huerfanas++; continue }
        if (a.transcripcion.estado === 'lista' || a.transcripcion.estado === 'error') { await tr.borrar(t.id); await deps.repo.anotarBorradaProveedor(a.id, true); r.borradas++; continue }
        const p = await procesarTerminada(deps, a, await tr.traer(t.id))
        r.extra.push(...p.extra)
      } catch { /* la próxima */ }
    }
  }
  return r
}
