// ── Zona desde el video: lo que se marcó en el MAPA compartido en pantalla durante la kickoff (tarea c03) ─────────
// En las kickoffs Tomás comparte pantalla y marca la zona de los anuncios en un mapa (Google Maps o el selector de
// ubicaciones de Meta Ads). Eso NO queda en la transcripción: la ficha solo sabe que hubo un mapa (zona.mapa_en_pantalla) y
// en qué momento se habló de la zona (zona.timestamp y zona.aprox). Este módulo mira el VIDEO en ese momento:
//   1. momentosMapa: 4 a 8 segundos alrededor del momento de la zona (hasta 3 minutos después, para ver la marca terminada),
//      acotados a la duración de la grabación;
//   2. pedirVideo / esperarVideo (obtenerVideo junta los dos): la API de Fathom genera el MP4 en segundo plano (doc oficial
//      leída el 24/10/2026). POST /recordings/{id}/download → 202 RecordingDownload {download_id, status processing |
//      completed | failed | expired, video {url, content_type, file_size_bytes, expires_at}, failure_reason}; el estado se
//      sondea con GET /recordings/{id}/downloads/{download_id}, con espera creciente y un tope total. La URL es firmada
//      (~24 h) y solo la puede consultar el cliente de la API que pidió la descarga; 422 = la grabación no tiene video. Va
//      con la API key de quien grabó (FATHOM_API_KEY_<QUIEN>, grabadores.ts). destination_url no se usa por ahora: se sondea.
//      Si se corta por algo que vale reintentar (la espera agotada, 429/5xx/red), el error lleva el download_id
//      (descargaDelError) para retomar esa misma descarga en vez de pedirle a Fathom otro MP4;
//   3. sacarCuadros: un ffmpeg por cuadro, en paralelo, con -ss ANTES de -i (busca por el índice del MP4 y lee por rangos
//      HTTP desde el keyframe anterior a cada segundo; no lo guarda en disco, pero con keyframes muy separados puede leer
//      buena parte del archivo) y el JPEG por stdout (sin archivos temporales). Cortes: 15 s sin datos y 45 s en total;
//   4. leerMapa: Claude con visión (los cuadros con el minuto de cada uno) describe SOLO el mapa y su marca (en su estado
//      final), con salida estructurada (JSON Schema estricto) validada a la vuelta. No se le pasan los lugares dichos en la
//      llamada (si no, "lee" lo que le soplamos): la comparación la hace el código;
//   5. combinarZonaConMapa (pura, en mapa-zona.ts): le suma a la zona un bloque `mapa` {lugares, marca, radio, límites,
//      excluidas, fuente 'video', momento}, lo que coincide (con el mismo nombre), lo parecido (para revisar), lo que no se
//      puede verificar y las discrepancias con lo dicho, SIN pisar lo dicho.
// zonaDesdeVideo orquesta todo y NUNCA lanza: devuelve {estado ok | sin_mapa | sin_video | sin_key | listo (dry) | error,
// mapa, zona, motivo, tiempos, tokens}. Antes de pedirle nada a Fathom controla que estén la key, la clave de Claude y ffmpeg
// (así no se genera un video para nada); con dry corta ahí: ni Fathom ni Claude. aZonaVideo pasa ese resultado a lo que se
// guarda en cj_kickoffs.zona_video (lo usa /api/bot/kickoff/mapa).
// Integración con el bot (24/10): procesar.ts pide el video TEMPRANO con pedirVideoSeguro (solo el POST /download, que no
// lanza: así Fathom lo genera mientras siguen Meta y las ideas), guarda el download_id y, con la ficha "lista", dispara
// /api/bot/kickoff/mapa, que lo retoma (descarga_id), saca los cuadros, llama a Claude y guarda el bloque.
// Privacidad: los cuadros pueden mostrar la pantalla de Tomás o del cliente (mails, chats, pestañas). Viven solo en memoria
// mientras se llama a Claude: no se guardan ni se devuelven. El prompt pide describir solo el mapa en todos los campos y,
// si no hay mapa, las notas quedan vacías. La URL firmada del video tampoco sale en mensajes ni logs (motivoDe limpia URLs y
// el resultado no la trae).
// ffmpeg: FFMPEG_PATH → el paquete ffmpeg-static (si está instalado: exporta la ruta del binario) → "ffmpeg" del PATH,
// verificado en tiempo de ejecución (error claro si no está). En Vercel lo pone ffmpeg-static (79,8 MB), que next.config.ts
// empaqueta SOLO en /api/bot/kickoff/mapa (no en la del kickoff, que ya carga googleapis): el require es dinámico a
// propósito, para que el empaquetado no lo arrastre a las otras rutas que importan este archivo (servidor.ts).
// Fetch, spawn, reloj, entorno, ffmpeg y la llamada a Claude son inyectables: scripts/test-bot-kickoff-mapa.mjs lo prueba
// sin red ni ffmpeg, y scripts/probar-mapa.mjs de punta a punta con un MP4 local servido por HTTP.
import type Anthropic from '@anthropic-ai/sdk'
import { spawn as spawnNode } from 'node:child_process'
import { accessSync, constants as fsConst, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, isAbsolute, join } from 'node:path'
import { acotar } from '@/lib/fathomAnuncios/tipos'
import { segundos } from '@/lib/fathomAnuncios/transcripcion'
import { esTransitorio } from '@/lib/fathomAnuncios/errores'
import { motivoDe } from '@/lib/fathomAnuncios/procesar'
import { claveClaude, esfuerzoDe, llamarClaude, type Esfuerzo, type RespuestaClaude } from './claude'
import { BASE_FATHOM, ErrorFathomApi, MAX_ESPERA_429_MS, TOPE_PEDIDO_MS, claveApi } from './fathomApi'
import { GRABADORES, QUIENES, varApiKey, type Quien } from './grabadores'
import { PROMPT_SISTEMA_MAPA, VERSION_MAPA, etiquetaCuadro, hhmmss, introCuadros } from './mapa-prompt'
import {
  LARGO_FRASES_MAPA, LEGIBLES, MARCAS_MAPA, MOTIVO_SIN_MOMENTO, POSICIONES_LUGAR, TIPOS_MAPA, combinarZonaConMapa, compararLugares,
  diferenciasMapa, leerZonaVideo, lineaMapa, mapaUtil, mismoLugar, normLugar, textoSinKeyMapa,
  type BloqueMapaZona, type DiscrepanciasMapa, type Legible, type LugarVisto, type MapaLeido, type MarcaMapa, type ParecidoMapa,
  type PosicionLugar, type TipoMapa, type ZonaVideoFicha,
} from './mapa-zona'
import type { Uso } from './tipos'

export { VERSION_MAPA }

type Entorno = Record<string, string | undefined>
type Fetch = (input: string, init: RequestInit) => Promise<Response>
const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

// ── 1. Momentos a mirar ──────────────────────────────────────────────────────────────────────────
// Alrededor del momento de la zona: un poco antes (el mapa ya puede estar en pantalla), seguido durante el primer minuto (la
// marca se dibuja mientras se habla) y a los 2 y 3 minutos (la zona se suele ajustar un rato: lo que importa es la marca
// terminada). Si el renglón de Fathom (que junta hasta 2 minutos) arranca bastante antes que la cita, se suma también su
// comienzo. Todo acotado a la duración: cerca del final quedan menos.
export const DESFASES_S = [-10, 0, 15, 35, 60, 120, 180] as const
const MIN_SEPARACION_S = 3                      // dos cuadros a menos de esto son el mismo
const MIN_DESFASE_RENGLON_S = 20                // con menos, el comienzo del renglón ya está cubierto
export const MAX_CUADROS = 8

/** Lo mínimo de la ficha que hace falta para elegir los momentos. */
export interface FichaParaMapa {
  zona: { timestamp: string | null; aprox?: string | null; mapa_en_pantalla?: boolean; lugares: string[]; radio_km: number | null }
  fecha?: string | null            // inicio de la grabación (ISO)
  fin_grabacion?: string | null    // fin de la grabación (ISO)
}
/** O directo: el momento de la zona (HH:MM:SS o segundos) y la duración en segundos. */
export interface MomentoZona { timestampZona: string | number | null; duracion: number | null; inicioRenglon?: string | number | null }

const aSegundos = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) && x >= 0 ? Math.floor(x) : null
  return typeof x === 'string' && x.trim() ? segundos(x.trim()) : null
}

/** Duración de la grabación en segundos (fin − inicio de la ficha), o null. */
export function duracionDeFicha(f: Pick<FichaParaMapa, 'fecha' | 'fin_grabacion'>): number | null {
  const ini = f.fecha ? Date.parse(f.fecha) : NaN, fin = f.fin_grabacion ? Date.parse(f.fin_grabacion) : NaN
  return Number.isFinite(ini) && Number.isFinite(fin) && fin > ini ? Math.round((fin - ini) / 1000) : null
}

/**
 * Los segundos de la grabación a mirar (hasta MAX_CUADROS, ordenados, sin repetidos), o null si no hay momento de la zona (o
 * cae fuera de la grabación). Con la ficha, el centro es zona.aprox (el segundo estimado de la cita) o, si no hay,
 * zona.timestamp.
 */
export function momentosMapa(x: FichaParaMapa | MomentoZona): number[] | null {
  let base: number | null, renglon: number | null, duracion: number | null
  if ('zona' in x) {
    base = aSegundos(x.zona.aprox) ?? aSegundos(x.zona.timestamp)
    renglon = aSegundos(x.zona.timestamp)
    duracion = duracionDeFicha(x)
  } else {
    base = aSegundos(x.timestampZona)
    renglon = aSegundos(x.inicioRenglon)
    duracion = typeof x.duracion === 'number' && Number.isFinite(x.duracion) && x.duracion > 0 ? Math.floor(x.duracion) : null
  }
  if (base === null) return null
  if (duracion !== null && base > duracion + 5) return null       // el momento no está en la grabación: no se adivina
  const cands: number[] = DESFASES_S.map(d => base + d)
  if (renglon !== null && Math.abs(renglon - base) >= MIN_DESFASE_RENGLON_S) cands.push(renglon + 5)
  const tope = duracion !== null ? Math.max(0, duracion - 1) : Infinity
  const acotados = cands.map(s => Math.min(tope, Math.max(0, Math.round(s)))).sort((a, b) => a - b)
  const out: number[] = []
  for (const s of acotados) if (!out.length || s - out[out.length - 1] >= MIN_SEPARACION_S) out.push(s)
  return out.slice(0, MAX_CUADROS)
}

/**
 * Para la ruta, cuando el cuerpo trae timestamp_zona: la ficha a usar (la guardada con ese momento, o una armada con lo
 * dicho que vino en el cuerpo) y los momentos, acotados a duracion_s o, si no vino, a la duración de la ficha guardada
 * (fin_grabacion − fecha). null si el momento cae después del final: mejor un 400 que pedirle el video a Fathom para nada.
 */
export function fichaConMomento(
  guardada: FichaParaMapa | null,
  ts: string,
  cuerpo: { duracion: number | null; lugares: string[]; radio_km: number | null },
): { ficha: FichaParaMapa; segundos: number[]; duracion: number | null } | null {
  const duracion = cuerpo.duracion ?? (guardada ? duracionDeFicha(guardada) : null)
  const segundos = momentosMapa({ timestampZona: ts, duracion })
  if (!segundos) return null
  return {
    ficha: {
      fecha: guardada?.fecha ?? null,
      fin_grabacion: guardada?.fin_grabacion ?? null,
      zona: { ...(guardada?.zona ?? { lugares: cuerpo.lugares, radio_km: cuerpo.radio_km }), timestamp: ts, aprox: null, mapa_en_pantalla: true },
    },
    segundos,
    duracion,
  }
}

// ── 2. El video de Fathom ────────────────────────────────────────────────────────────────────────
export const ESTADOS_DESCARGA = ['processing', 'completed', 'failed', 'expired'] as const
export type EstadoDescarga = (typeof ESTADOS_DESCARGA)[number]
export interface ArchivoVideo { url: string; content_type: string | null; file_size_bytes: number | null; expires_at: string | null }
export interface DescargaFathom {
  download_id: string
  recording_id: number | null
  status: EstadoDescarga
  video: ArchivoVideo | null      // solo con status completed (y si la grabación tiene video)
  audio: boolean                  // vino el archivo de audio (grabación solo de audio)
  failure_reason: string | null
}

// Espera entre sondeos: crece hasta 15 s y sigue en 15 s. Tope total por defecto: 4 minutos (la ruta lo acota a su plazo).
export const ESPERAS_SONDEO_MS = [3_000, 5_000, 8_000, 12_000, 15_000] as const
export const TOPE_VIDEO_MS = 240_000
const MAX_FALLAS_SEGUIDAS = 3                   // 5xx / 429 / red seguidos mientras se sondea
const RE_DOWNLOAD_ID = /^[A-Za-z0-9_-]{1,120}$/

/** Lo que no es un error HTTP de Fathom: la grabación no tiene video, Fathom no lo pudo generar, venció o tardó demasiado. */
export class ErrorVideo extends Error {
  readonly codigo: 'sin_video' | 'fallo' | 'expirada' | 'espera'
  constructor(codigo: ErrorVideo['codigo'], mensaje: string) {
    super(mensaje)
    this.name = 'ErrorVideo'
    this.codigo = codigo
  }
}

/**
 * El RecordingDownload de Fathom, validado. Los archivos solo cuentan con status completed: mientras procesa (o si falló o
 * venció) Fathom puede mandar el objeto video con sus campos en null, y eso no es un error. Completed, la url del video
 * tiene que ser https (va a ffmpeg).
 */
export function leerDescarga(x: unknown): DescargaFathom {
  if (!esObj(x) || typeof x.download_id !== 'string' || !RE_DOWNLOAD_ID.test(x.download_id) || !(ESTADOS_DESCARGA as readonly string[]).includes(x.status as string)) {
    throw new ErrorFathomApi('respuesta_invalida', 'Fathom devolvió una descarga sin download_id válido o con un estado desconocido')
  }
  const completa = x.status === 'completed'
  let video: ArchivoVideo | null = null
  if (completa && esObj(x.video)) {
    const url = typeof x.video.url === 'string' ? x.video.url.trim() : ''
    if (!/^https:\/\//i.test(url)) throw new ErrorFathomApi('respuesta_invalida', 'Fathom devolvió el video sin una url https')
    const tam = x.video.file_size_bytes
    video = {
      url,
      content_type: acotar(x.video.content_type, 60),
      file_size_bytes: typeof tam === 'number' && Number.isFinite(tam) && tam >= 0 ? tam : null,
      expires_at: acotar(x.video.expires_at, 40),
    }
  }
  return {
    download_id: x.download_id,
    recording_id: typeof x.recording_id === 'number' && Number.isSafeInteger(x.recording_id) ? x.recording_id : null,
    status: x.status as EstadoDescarga,
    video,
    audio: completa && esObj(x.audio),
    failure_reason: acotar(x.failure_reason, 60),
  }
}

export interface OpcionesVideo {
  env?: Entorno
  fetch?: Fetch
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
  /** Hora límite (ms epoch) para pedir y esperar el video. Por defecto, ahora + TOPE_VIDEO_MS. */
  limite?: number
}
interface CtxVideo { clave: string; quien: Quien; fetch: Fetch; ahora: () => number; esperar: (ms: number) => Promise<void>; limite: number }

function ctxVideo(quien: Quien, op: OpcionesVideo): CtxVideo {
  if (!QUIENES.includes(quien)) throw new ErrorFathomApi('pedido_invalido', `no hay cuenta de Fathom para "${String(quien)}"`)
  const clave = claveApi(quien, op.env ?? process.env)
  if (!clave) throw new ErrorFathomApi('sin_clave', `falta ${varApiKey(quien)}: la API key de Fathom de ${GRABADORES[quien].nombre} (Fathom → Settings → API Access)`)
  const ahora = op.ahora ?? (() => Date.now())
  return {
    clave, quien, ahora,
    fetch: op.fetch ?? ((input, init) => fetch(input, init)),
    esperar: op.esperar ?? (ms => new Promise<void>(r => setTimeout(r, Math.max(0, ms)))),
    limite: op.limite ?? ahora() + TOPE_VIDEO_MS,
  }
}

const segundosRetry = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : null)

/** Un pedido a la API (la key solo en la cabecera). Devuelve el estado y el JSON; lanza solo por red o timeout. */
async function pedirFathom(ctx: CtxVideo, metodo: 'GET' | 'POST', ruta: string, que: string): Promise<{ status: number; json: unknown; retryS: number | null }> {
  const restante = ctx.limite - ctx.ahora()
  if (restante < 1_000) throw new ErrorFathomApi('timeout', `no quedó tiempo para pedirle a Fathom ${que}`)
  const tope = Math.min(TOPE_PEDIDO_MS, restante)
  let res: Response
  try {
    res = await ctx.fetch(`${BASE_FATHOM}${ruta}`, {
      method: metodo,
      headers: { 'X-Api-Key': ctx.clave, accept: 'application/json', ...(metodo === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(metodo === 'POST' ? { body: '{}' } : {}),
      signal: AbortSignal.timeout(tope),
      cache: 'no-store',
    })
  } catch (e) {
    const n = (e as Error)?.name
    if (n === 'TimeoutError' || n === 'AbortError') throw new ErrorFathomApi('timeout', `Fathom no respondió en ${Math.round(tope / 1000)} s (${que})`)
    throw new ErrorFathomApi('red', `no se pudo conectar con Fathom (${que})`)
  }
  const retryS = res.status === 429 ? segundosRetry(res.headers.get('retry-after')) : null
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    return { status: res.status, json: null, retryS }
  }
  try {
    return { status: res.status, json: await res.json(), retryS }
  } catch {
    throw new ErrorFathomApi('respuesta_invalida', `Fathom devolvió algo que no es JSON (${que})`, { status: res.status })
  }
}

/** Error claro por estado HTTP (mismo contrato que fathomApi.ts: transitorio en 429 y 5xx). 422 = sin video. */
function errorHttp(status: number, que: string, quien: Quien, retryS: number | null): Error {
  const nombre = GRABADORES[quien].nombre
  if (status === 422) return new ErrorVideo('sin_video', 'la grabación no tiene video para bajar (Fathom respondió 422)')
  if (status === 401) return new ErrorFathomApi('no_autorizada', `la API key de Fathom de ${nombre} (${varApiKey(quien)}) no es válida o se revocó (401)`, { status })
  if (status === 403) return new ErrorFathomApi('sin_permiso', `la API key de Fathom de ${nombre} no tiene permiso para ${que} (403)`, { status })
  if (status === 404) return new ErrorFathomApi('no_encontrada', `Fathom no encontró ${que} (404)`, { status })
  if (status === 429) return new ErrorFathomApi('limite', `Fathom limitó los pedidos de la cuenta de ${nombre} (429)`, { status, reintentarEnS: retryS })
  if (status === 400) return new ErrorFathomApi('pedido_invalido', `Fathom rechazó el pedido de ${que} (400)`, { status })
  return new ErrorFathomApi('servidor', `Fathom respondió ${status} a ${que}`, { status })
}

/** POST /recordings/{id}/download. Un 429 corto o un 5xx se reintentan una vez. 422 → ErrorVideo sin_video. */
export async function pedirVideo(recordingId: number, quien: Quien, op: OpcionesVideo = {}): Promise<DescargaFathom> {
  if (!Number.isSafeInteger(recordingId) || recordingId <= 0) throw new ErrorFathomApi('pedido_invalido', 'recording_id inválido (tiene que ser un entero positivo)')
  const ctx = ctxVideo(quien, op)
  const que = `el video de la grabación ${recordingId}`
  for (let intento = 0; ; intento++) {
    const r = await pedirFathom(ctx, 'POST', `/recordings/${recordingId}/download`, que)
    if (r.status >= 200 && r.status < 300) return leerDescarga(r.json)
    const queda = ctx.limite - ctx.ahora()
    if (intento === 0 && r.status === 429 && r.retryS !== null && r.retryS * 1000 <= MAX_ESPERA_429_MS && queda - r.retryS * 1000 > 2_000) {
      await ctx.esperar(r.retryS * 1000)
      continue
    }
    if (intento === 0 && r.status >= 500 && queda > 3_000) {
      await ctx.esperar(1_000)
      continue
    }
    throw errorHttp(r.status, que, quien, r.retryS)
  }
}

/** El video de una descarga terminada; si no hay video (solo audio) o falló o venció, el ErrorVideo que corresponde. */
function videoDe(d: DescargaFathom): ArchivoVideo | null {
  if (d.status === 'completed') {
    if (d.video) return d.video
    throw new ErrorVideo('sin_video', d.audio ? 'la grabación es solo de audio: no hay video para mirar' : 'Fathom terminó la descarga sin video')
  }
  if (d.status === 'failed') throw new ErrorVideo('fallo', `Fathom no pudo generar el video (${d.failure_reason ?? 'sin motivo'})`)
  if (d.status === 'expired') throw new ErrorVideo('expirada', 'la descarga del video venció: hay que pedirla de nuevo')
  return null
}

/**
 * Sondea GET /recordings/{id}/downloads/{download_id} hasta que el video esté (espera creciente, ESPERAS_SONDEO_MS) o se
 * llegue al límite (ErrorVideo 'espera'). Hasta MAX_FALLAS_SEGUIDAS errores pasajeros seguidos (5xx, 429, red) se toleran;
 * 401/403/404 cortan enseguida.
 */
export async function esperarVideo(recordingId: number, downloadId: string, quien: Quien, op: OpcionesVideo & { primeraEsperaMs?: number } = {}): Promise<ArchivoVideo> {
  if (!RE_DOWNLOAD_ID.test(downloadId)) throw new ErrorFathomApi('pedido_invalido', 'download_id inválido')
  const ctx = ctxVideo(quien, op)
  const inicio = ctx.ahora()
  const que = `el estado del video de la grabación ${recordingId}`
  let fallas = 0
  for (let i = 0; ; i++) {
    const espera = i === 0 && op.primeraEsperaMs !== undefined ? op.primeraEsperaMs : ESPERAS_SONDEO_MS[Math.min(i, ESPERAS_SONDEO_MS.length - 1)]
    if (ctx.limite - ctx.ahora() - espera < 1_000) {
      throw new ErrorVideo('espera', `Fathom no terminó de generar el video en ${Math.round((ctx.ahora() - inicio) / 1000)} s`)
    }
    if (espera > 0) await ctx.esperar(espera)
    let r: Awaited<ReturnType<typeof pedirFathom>>
    try {
      r = await pedirFathom(ctx, 'GET', `/recordings/${recordingId}/downloads/${downloadId}`, que)
    } catch (e) {
      if (esTransitorio(e) && ++fallas < MAX_FALLAS_SEGUIDAS) continue
      throw e
    }
    if (r.status === 429 || r.status >= 500) {
      if (++fallas >= MAX_FALLAS_SEGUIDAS) throw errorHttp(r.status, que, quien, r.retryS)
      // Fathom pidió esperar: se respeta si entra (el sondeo siguiente suma su propia espera)
      if (r.retryS !== null && r.retryS * 1000 < ctx.limite - ctx.ahora() - 1_000) await ctx.esperar(r.retryS * 1000)
      continue
    }
    if (r.status < 200 || r.status >= 300) throw errorHttp(r.status, que, quien, r.retryS)
    fallas = 0
    const v = videoDe(leerDescarga(r.json))
    if (v) return v
  }
}

export interface VideoObtenido { video: ArchivoVideo; download_id: string; pedidos: number }
export interface DescargaEnCurso { download_id: string; pedidos: number }

// La descarga en curso cuando obtenerVideo corta por algo que vale reintentar (la espera agotada, un 429/5xx/red): quien
// reintente la retoma con ese download_id en vez de pedirle a Fathom otro MP4 desde cero. Va en un WeakMap (no se le agregan
// campos a errores ajenos, como ErrorFathomApi); se lee con descargaDelError.
const DESCARGA_DEL_ERROR = new WeakMap<object, DescargaEnCurso>()

/** El download_id para retomar, si el error de obtenerVideo lo trae (solo en los que vale reintentar). */
export function descargaDelError(e: unknown): DescargaEnCurso | null {
  return typeof e === 'object' && e !== null ? (DESCARGA_DEL_ERROR.get(e) ?? null) : null
}

const reintentable = (e: unknown): boolean => (e instanceof ErrorVideo && e.codigo === 'espera') || esTransitorio(e)

/**
 * Pide el video y espera a que esté. Con descargaId retoma una descarga ya pedida (por ejemplo, la que pidió procesar.ts al
 * llegar el webhook, para que Fathom lo genere mientras Claude lee la llamada). Se pide una descarga nueva UNA sola vez: si la
 * que había venció o, si era retomada, Fathom ya no la da (404: se purgó; 403: la pidió otro cliente de la API) o falló.
 * Si corta por algo que vale reintentar, el error lleva el download_id (descargaDelError).
 */
export async function obtenerVideo(recordingId: number, quien: Quien, op: OpcionesVideo & { descargaId?: string | null } = {}): Promise<VideoObtenido> {
  let pedidos = 0, repedido = false
  type Actual = { id: string; video: ArchivoVideo | null; retomada: boolean }
  const nueva = async (): Promise<Actual> => {
    pedidos++
    const d = await pedirVideo(recordingId, quien, op)
    return { id: d.download_id, video: videoDe(d), retomada: false }
  }
  const otraVez = (e: unknown, retomada: boolean): boolean => {
    if (repedido) return false
    if (e instanceof ErrorVideo && e.codigo === 'expirada') return true
    if (!retomada) return false
    return (e instanceof ErrorVideo && e.codigo === 'fallo') || (e instanceof ErrorFathomApi && (e.codigo === 'no_encontrada' || e.codigo === 'sin_permiso'))
  }
  let actual: Actual
  try {
    actual = op.descargaId ? { id: op.descargaId, video: null, retomada: true } : await nueva()
  } catch (e) {
    if (!otraVez(e, false)) throw e
    repedido = true
    actual = await nueva()
  }
  for (;;) {
    if (actual.video) return { video: actual.video, download_id: actual.id, pedidos }
    try {
      const video = await esperarVideo(recordingId, actual.id, quien, { ...op, ...(actual.retomada ? { primeraEsperaMs: 0 } : {}) })
      return { video, download_id: actual.id, pedidos }
    } catch (e) {
      if (otraVez(e, actual.retomada)) {
        repedido = true
        actual = await nueva()
        continue
      }
      if (reintentable(e) && typeof e === 'object' && e !== null) DESCARGA_DEL_ERROR.set(e, { download_id: actual.id, pedidos })
      throw e
    }
  }
}

/** Lo que necesita procesar.ts del pedido temprano del video: el download_id, o por qué no (sin lanzar nunca). */
export type PedidoVideo =
  | { ok: true; download_id: string; status: EstadoDescarga }
  | { ok: false; estado: 'sin_video' | 'sin_key' | 'error'; motivo: string; transitorio: boolean }

/**
 * El POST /download (pedirVideo) que procesar.ts larga apenas la ficha dice que hubo un mapa en pantalla, para que Fathom
 * vaya generando el MP4 mientras siguen Meta y las ideas. NUNCA lanza: 422 o solo audio → sin_video; sin la key → sin_key;
 * failed, 401, 403, 404 → error definitivo; 429, 5xx, red o timeout → error pasajero (la ruta del mapa lo vuelve a pedir).
 */
export async function pedirVideoSeguro(recordingId: number, quien: Quien, op: OpcionesVideo = {}): Promise<PedidoVideo> {
  try {
    const d = await pedirVideo(recordingId, quien, op)
    if (d.status === 'failed') return { ok: false, estado: 'error', motivo: `Fathom no pudo generar el video (${d.failure_reason ?? 'sin motivo'})`, transitorio: false }
    if (d.status === 'completed' && !d.video) {
      return { ok: false, estado: 'sin_video', motivo: d.audio ? 'la grabación es solo de audio: no hay video para mirar' : 'Fathom terminó la descarga sin video', transitorio: false }
    }
    return { ok: true, download_id: d.download_id, status: d.status }
  } catch (e) {
    if (e instanceof ErrorVideo && e.codigo === 'sin_video') return { ok: false, estado: 'sin_video', motivo: e.message, transitorio: false }
    if (e instanceof ErrorFathomApi && e.codigo === 'sin_clave') return { ok: false, estado: 'sin_key', motivo: textoSinKeyMapa(GRABADORES[quien]?.nombre ?? String(quien)), transitorio: false }
    return { ok: false, estado: 'error', motivo: `video de Fathom: ${motivoDe(e)}`, transitorio: esTransitorio(e) }
  }
}

// ── 3. Cuadros con ffmpeg ────────────────────────────────────────────────────────────────────────
export const TOPE_CUADROS_MS = 45_000
export const SIN_DATOS_MS = 15_000
export const ANCHO_MAX = 1920                   // 1080p: ~2.800 tokens de imagen por cuadro
// La API de Claude acepta hasta 5 MB por imagen y el base64 crece un 33 %: con 3,5 MB queda margen. Un cuadro más grande
// (pantalla con mucho detalle o ruido) se descarta y va a fallas: si llegara a Claude, el 400 tiraría todos los cuadros.
export const MAX_BYTES_CUADRO = 3_500_000

/** Lo mínimo de un proceso hijo que usa sacarCuadros (el de node:child_process o uno falso en los tests). */
export interface ProcesoFfmpeg {
  stdout: { on(ev: 'data', cb: (d: Buffer) => void): unknown } | null
  stderr: { on(ev: 'data', cb: (d: Buffer) => void): unknown } | null
  on(ev: 'close', cb: (code: number | null) => void): unknown
  on(ev: 'error', cb: (e: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}
export type SpawnFfmpeg = (cmd: string, args: string[]) => ProcesoFfmpeg
const spawnReal: SpawnFfmpeg = (cmd, args) => spawnNode(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

/** No hay ffmpeg (o FFMPEG_PATH apunta a algo que no se puede ejecutar). */
export class ErrorFfmpeg extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorFfmpeg'
  }
}

export interface OpcionesFfmpeg {
  env?: Entorno
  /** Carga un paquete (por defecto, require desde la raíz del proyecto). Inyectable para los tests. */
  requerir?: (nombre: string) => unknown
  /** ¿La ruta es un archivo ejecutable? Inyectable para los tests. */
  esEjecutable?: (ruta: string) => boolean
}

const ejecutable = (ruta: string): boolean => {
  try {
    accessSync(ruta, fsConst.X_OK)
    return statSync(ruta).isFile()
  } catch {
    return false
  }
}
// require desde la raíz del proyecto (en Vercel, /var/task). Es el require de node, no el del bundler: si ffmpeg-static
// no está instalado, falla acá (y se sigue con el PATH) en vez de romper el build.
const requerirDesdeRaiz = (nombre: string): unknown => createRequire(join(process.cwd(), 'package.json'))(nombre)

/** Dónde está ffmpeg: FFMPEG_PATH → ffmpeg-static → "ffmpeg" del PATH. Lanza ErrorFfmpeg si no hay ninguno ejecutable. */
export function ubicarFfmpeg(op: OpcionesFfmpeg = {}): { ruta: string; origen: 'FFMPEG_PATH' | 'ffmpeg-static' | 'PATH' } {
  const env = op.env ?? process.env
  const esEjec = op.esEjecutable ?? ejecutable
  const propio = env.FFMPEG_PATH?.trim()
  if (propio) {
    if (isAbsolute(propio) && esEjec(propio)) return { ruta: propio, origen: 'FFMPEG_PATH' }
    throw new ErrorFfmpeg('FFMPEG_PATH no apunta a un ffmpeg ejecutable (tiene que ser una ruta absoluta)')
  }
  try {
    const ruta = (op.requerir ?? requerirDesdeRaiz)('ffmpeg-static')
    if (typeof ruta === 'string' && ruta && esEjec(ruta)) return { ruta, origen: 'ffmpeg-static' }
  } catch {
    // no está instalado: se sigue con el PATH
  }
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const ruta = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (esEjec(ruta)) return { ruta, origen: 'PATH' }
  }
  throw new ErrorFfmpeg('no hay ffmpeg: falta el paquete ffmpeg-static en el servidor (o FFMPEG_PATH, o ffmpeg en el PATH)')
}

/**
 * Para el GET de estado de la ruta: dónde está ffmpeg y si de verdad corre ("ffmpeg -version", tope 5 s; si no responde, se
 * mata). En Vercel es lo que confirma que ffmpeg-static quedó en el paquete de la función y es ejecutable. Nunca lanza.
 */
export async function versionFfmpeg(op: OpcionesFfmpeg & { spawn?: SpawnFfmpeg; topeMs?: number } = {}): Promise<{ ok: true; origen: string; version: string } | { ok: false; motivo: string }> {
  const topeMs = op.topeMs ?? 5_000
  let u: ReturnType<typeof ubicarFfmpeg>
  try {
    u = ubicarFfmpeg(op)
  } catch (e) {
    return { ok: false, motivo: motivoDe(e) }
  }
  return new Promise(resolve => {
    let p: ProcesoFfmpeg
    try {
      p = (op.spawn ?? spawnReal)(u.ruta, ['-hide_banner', '-version'])
    } catch (e) {
      resolve({ ok: false, motivo: `ffmpeg no se pudo ejecutar: ${motivoDe(e)}` })
      return
    }
    const out: Buffer[] = []
    const corte = setTimeout(() => { p.kill('SIGKILL'); resolve({ ok: false, motivo: `ffmpeg -version no respondió en ${Math.round(topeMs / 1000)} s` }) }, topeMs)
    p.stdout?.on('data', d => { if (out.length < 20) out.push(d) })
    p.on('error', e => { clearTimeout(corte); resolve({ ok: false, motivo: `ffmpeg no se pudo ejecutar: ${motivoDe(e)}` }) })
    p.on('close', code => {
      clearTimeout(corte)
      const primera = Buffer.concat(out).toString().split('\n')[0]?.trim() ?? ''
      resolve(code === 0 ? { ok: true, origen: u.origen, version: primera.slice(0, 80) } : { ok: false, motivo: `ffmpeg -version salió con ${code}` })
    })
  })
}

/** ¿Se le puede pasar esta URL a ffmpeg? https siempre; http solo a la propia máquina y si se permite (prueba local). */
export function urlVideoValida(url: string, permitirHttpLocal = false): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  return permitirHttpLocal && u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
}

export interface OpcionesCuadros extends OpcionesFfmpeg {
  spawn?: SpawnFfmpeg
  /** La ruta de ffmpeg ya ubicada (si no, ubicarFfmpeg). */
  ffmpeg?: string
  anchoMax?: number
  topeMs?: number
  sinDatosMs?: number
  permitirHttpLocal?: boolean
}
export interface Cuadro { seg: number; jpg: Buffer; ms: number }
export interface ResultadoCuadros { cuadros: Cuadro[]; fallas: { seg: number; error: string }[]; ms: number }

/** Un cuadro: ffmpeg con -ss antes de -i, un solo fotograma, JPEG por stdout. Nunca lanza: devuelve el cuadro o el error. */
function unCuadro(ffmpeg: string, spawn: SpawnFfmpeg, url: string, seg: number, op: Required<Pick<OpcionesCuadros, 'anchoMax' | 'topeMs' | 'sinDatosMs' | 'permitirHttpLocal'>>): Promise<Cuadro | { seg: number; error: string }> {
  return new Promise(resolve => {
    const t0 = Date.now()
    const args = [
      '-hide_banner', '-v', 'error', '-nostdin',
      // Solo protocolos de red (nada de file:, concat: ni subfile: aunque la URL lo pidiera)
      '-protocol_whitelist', op.permitirHttpLocal ? 'http,https,tls,tcp' : 'https,tls,tcp',
      '-rw_timeout', String(op.sinDatosMs * 1000),             // sin datos tanto tiempo → corta (en microsegundos)
      '-ss', String(seg), '-i', url,
      '-frames:v', '1', '-an', '-sn', '-dn',
      '-vf', `scale='min(${op.anchoMax},iw)':-2`,
      '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1',
    ]
    let listo = false
    const fin = (r: Cuadro | { seg: number; error: string }) => { if (!listo) { listo = true; clearTimeout(corte); resolve(r) } }
    let p: ProcesoFfmpeg
    try {
      p = spawn(ffmpeg, args)
    } catch (e) {
      resolve({ seg, error: `no se pudo ejecutar ffmpeg: ${motivoDe(e)}` })
      return
    }
    const out: Buffer[] = [], err: Buffer[] = []
    let bytes = 0
    const corte = setTimeout(() => { p.kill('SIGKILL'); fin({ seg, error: `ffmpeg no terminó en ${Math.round(op.topeMs / 1000)} s` }) }, op.topeMs)
    p.stdout?.on('data', d => {
      bytes += d.length
      if (bytes > MAX_BYTES_CUADRO) { p.kill('SIGKILL'); fin({ seg, error: 'el cuadro salió demasiado grande' }) } else out.push(d)
    })
    p.stderr?.on('data', d => { if (err.length < 50) err.push(d) })
    p.on('error', e => fin({ seg, error: `no se pudo ejecutar ffmpeg: ${motivoDe(e)}` }))
    p.on('close', code => {
      const jpg = Buffer.concat(out)
      // Un JPEG empieza con FF D8; menos de 1 KB no es un cuadro de video
      if (code === 0 && jpg.length > 1_000 && jpg[0] === 0xff && jpg[1] === 0xd8) fin({ seg, jpg, ms: Date.now() - t0 })
      else {
        const ultima = Buffer.concat(err).toString().trim().split('\n').pop() ?? ''
        fin({ seg, error: motivoDe(ultima || (code === 0 ? 'ffmpeg no devolvió ningún cuadro (¿el segundo está después del final?)' : `ffmpeg salió con ${code}`)).slice(0, 200) })
      }
    })
  })
}

/** Los cuadros de esos segundos, en paralelo. Lanza solo si la URL no es válida o no hay ffmpeg; cada cuadro que falla va a fallas. */
export async function sacarCuadros(url: string, segs: number[], op: OpcionesCuadros = {}): Promise<ResultadoCuadros> {
  const t0 = Date.now()
  if (!urlVideoValida(url, op.permitirHttpLocal)) throw new Error('la url del video no es válida (tiene que ser https)')
  const lista = [...new Set(segs.filter(s => Number.isFinite(s) && s >= 0).map(s => Math.floor(s)))].sort((a, b) => a - b).slice(0, MAX_CUADROS + 2)
  if (!lista.length) throw new Error('no hay segundos para mirar')
  const ffmpeg = op.ffmpeg ?? ubicarFfmpeg(op).ruta
  const opc = {
    anchoMax: op.anchoMax ?? ANCHO_MAX, topeMs: op.topeMs ?? TOPE_CUADROS_MS, sinDatosMs: op.sinDatosMs ?? SIN_DATOS_MS, permitirHttpLocal: op.permitirHttpLocal ?? false,
  }
  const r = await Promise.all(lista.map(s => unCuadro(ffmpeg, op.spawn ?? spawnReal, url, s, opc)))
  return {
    cuadros: r.filter((x): x is Cuadro => 'jpg' in x),
    fallas: r.filter((x): x is { seg: number; error: string } => 'error' in x),
    ms: Date.now() - t0,
  }
}

// Los tipos de lo que lee Claude, la combinación con lo dicho y los textos están en mapa-zona.ts (puro: lo usan también la
// ficha, la pantalla y el aviso, que no cargan el SDK ni ffmpeg). Se re-exportan acá para quien ya los importaba de mapa.ts.
export {
  LEGIBLES, MARCAS_MAPA, POSICIONES_LUGAR, TIPOS_MAPA, combinarZonaConMapa, compararLugares, diferenciasMapa, leerZonaVideo, lineaMapa,
  mapaUtil, mismoLugar, textoSinKeyMapa,
}
export type { BloqueMapaZona, DiscrepanciasMapa, Legible, LugarVisto, MapaLeido, MarcaMapa, ParecidoMapa, PosicionLugar, TipoMapa, ZonaVideoFicha }
// JSON Schema de la salida: sin campos nullable (los números van como texto, "" = no hay) y el objeto del arreglo en $defs,
// igual que el de la ficha (extraer.ts), para que la gramática compilada quede chica.
const str = { type: 'string' } as const
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props })
export const SCHEMA_MAPA = {
  ...obj({
    hay_mapa: { type: 'boolean' },
    tipo: { type: 'string', enum: [...TIPOS_MAPA] },
    lugares: { type: 'array', items: { $ref: '#/$defs/lugar' } },
    marca: { type: 'string', enum: [...MARCAS_MAPA] },
    marca_detalle: str,
    radio_km: str,
    radio_estimado_km: str,
    radio_como: str,
    limites: str,
    excluidas: { type: 'array', items: str },
    mejor_cuadro: { type: 'integer' },
    legible: { type: 'string', enum: [...LEGIBLES] },
    notas: str,
  }),
  $defs: { lugar: obj({ nombre: str, posicion: { type: 'string', enum: [...POSICIONES_LUGAR] } }) },
}

const MAX_LUGARES = 40, MAX_EXCLUIDAS = 30, MAX_RADIO_KM = 1_000

/**
 * Un texto largo de Claude (límites, notas) acotado SIN cortar a la mitad: hasta el último "; " o ". " que entre (si deja al
 * menos la mitad) o, si no, hasta la última palabra entera, con "…". Antes se cortaba a los 400 caracteres a mitad de palabra
 * y se perdía justo el último tramo de los límites («por el oeste corre al oeste de Villa Krause, Villa Aberasta…»).
 */
export function enFrase(x: unknown, max: number): string {
  const t = (acotar(x, 5_000) ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const c = t.slice(0, max - 1)
  const frase = Math.max(c.lastIndexOf('; '), c.lastIndexOf('. ')), palabra = c.lastIndexOf(' ')
  const corte = frase > max * 0.5 ? c.slice(0, frase + 1) : palabra > max * 0.5 ? c.slice(0, palabra) : c
  return `${corte.replace(/[\s,;:·–-]+$/u, '')}…`
}

// Sin mapa, las notas quedan vacías: lo único que podrían contar es lo que SÍ se ve (la videollamada, otra pantalla), y eso
// no tiene que viajar a la ficha ni a Discord.
const mapaVacio = (): MapaLeido => ({
  hay_mapa: false, tipo: 'ninguno', lugares: [], marca: 'ninguna', marca_detalle: '', radio_km: null, radio_estimado_km: null, radio_como: '',
  limites: '', excluidas: [], mejor_cuadro: null, momento: null, legible: 'no', notas: '',
})

/**
 * Valida y acota lo que devolvió Claude. segs: el segundo de cada cuadro, en el orden en que se mandaron. Lanza solo si no
 * es un objeto. Además deja coherentes la marca y las posiciones: sin marca no hay "dentro" ni "fuera" (pasan a sin_marca), y
 * si hay lugares en la lista de Meta la marca es la lista.
 */
export function validarMapa(json: unknown, segs: number[]): { mapa: MapaLeido; ajustes: string[] } {
  if (!esObj(json)) throw new Error('la salida de Claude (el mapa) no es un objeto JSON')
  const ajustes: string[] = []
  const texto = (x: unknown, max: number) => acotar(x, max) ?? ''
  const enumDe = <T extends string>(x: unknown, valores: readonly T[], porDefecto: T, que: string): T => {
    if ((valores as readonly unknown[]).includes(x)) return x as T
    if (x !== undefined && x !== '') ajustes.push(`${que} desconocido «${String(x).slice(0, 30)}»: queda ${porDefecto}`)
    return porDefecto
  }
  const numero = (x: unknown, que: string): number | null => {
    if (x === null || x === undefined || (typeof x === 'string' && !x.trim())) return null
    const t = typeof x === 'string' ? x.trim().replace(/\s*km$/i, '').replace(/^\+/, '') : ''
    const n = typeof x === 'number' ? x : /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN
    if (!Number.isFinite(n) || n <= 0 || n > MAX_RADIO_KM) { ajustes.push(`${que} fuera de rango (${String(x).slice(0, 20)}): queda vacío`); return null }
    return Math.round(n * 10) / 10
  }

  const lugaresCrudos = Array.isArray(json.lugares) ? json.lugares : []
  if (json.hay_mapa !== true) {
    if (lugaresCrudos.length) ajustes.push(`Claude dijo que no hay mapa pero listó ${lugaresCrudos.length} lugar(es): se descartan`)
    return { mapa: mapaVacio(), ajustes }
  }
  let tipo = enumDe(json.tipo, TIPOS_MAPA, 'otro', 'tipo de mapa')
  if (tipo === 'ninguno') { tipo = 'otro'; ajustes.push('hay mapa con tipo «ninguno»: queda «otro»') }

  const vistos = new Set<string>()
  const lugares: LugarVisto[] = []
  for (const l of lugaresCrudos.slice(0, MAX_LUGARES * 2)) {
    if (!esObj(l)) continue
    const nombre = acotar(l.nombre, 80)
    const n = nombre ? normLugar(nombre) : ''
    if (!nombre || !n || vistos.has(n)) continue
    vistos.add(n)
    lugares.push({ nombre, posicion: enumDe(l.posicion, POSICIONES_LUGAR, 'sin_marca', 'posición de lugar') })
    if (lugares.length >= MAX_LUGARES) break
  }
  const excluidas = (Array.isArray(json.excluidas) ? json.excluidas : []).map(x => acotar(x, 80)).filter((x): x is string => !!x).slice(0, MAX_EXCLUIDAS)

  let marca = enumDe(json.marca, MARCAS_MAPA, 'otra', 'marca')
  if (marca === 'ninguna' && lugares.some(l => l.posicion === 'lista_incluida' || l.posicion === 'lista_excluida')) {
    marca = 'lista'
    ajustes.push('marca «ninguna» con lugares en la lista de ubicaciones: queda «lista»')
  }
  if (marca === 'ninguna') {
    const conPosicion = lugares.filter(l => l.posicion === 'dentro' || l.posicion === 'borde' || l.posicion === 'fuera')
    for (const l of conPosicion) l.posicion = 'sin_marca'
    if (conPosicion.length) ajustes.push(`sin marca no hay dentro ni fuera: ${conPosicion.length} lugar(es) quedan «sin_marca»`)
  }

  let mejor: number | null = null
  const mc = json.mejor_cuadro
  if (typeof mc === 'number' && Number.isInteger(mc) && mc >= 1 && mc <= segs.length) mejor = mc
  else if (mc !== 0 && mc !== undefined) ajustes.push(`mejor_cuadro fuera de rango (${String(mc).slice(0, 10)}): queda sin momento`)

  const radio_km = numero(json.radio_km, 'radio en km')
  let radio_estimado_km = numero(json.radio_estimado_km, 'radio estimado')
  if (radio_km !== null && radio_estimado_km !== null) { radio_estimado_km = null; ajustes.push('vino el radio leído y uno estimado: queda el leído') }

  return {
    mapa: {
      hay_mapa: true,
      tipo,
      lugares,
      marca,
      marca_detalle: texto(json.marca_detalle, 300),
      radio_km,
      radio_estimado_km,
      radio_como: radio_estimado_km !== null ? texto(json.radio_como, 200) : '',
      limites: enFrase(json.limites, LARGO_FRASES_MAPA),
      excluidas,
      mejor_cuadro: mejor,
      momento: mejor !== null ? hhmmss(segs[mejor - 1]) : null,
      legible: enumDe(json.legible, LEGIBLES, 'parcial', 'legibilidad'),
      notas: enFrase(json.notas, LARGO_FRASES_MAPA),
    },
    ajustes,
  }
}

// La llamada a Claude con imágenes: llamarClaude de claude.ts (mismo modelo, thinking adaptativo, esfuerzo explícito,
// salida estructurada, streaming, fallback del servidor, stop_reason antes del contenido, sin reintentos del SDK; 429, 5xx,
// 529 y red → ErrorTransitorio), con los cuadros como bloques de imagen y su propio tope (120 s) y max_tokens.
export const TOPE_CLAUDE_MAPA_MS = 120_000
export interface PedidoVision { sistema: string; contenido: Anthropic.Beta.Messages.BetaContentBlockParam[]; schema: Record<string, unknown>; esfuerzo: Esfuerzo; topeMs: number }
export type LlamadaVision = (p: PedidoVision) => Promise<RespuestaClaude>

export const llamarClaudeVision: LlamadaVision = p => llamarClaude({
  que: 'el mapa', sistema: p.sistema, usuario: p.contenido, schema: p.schema, esfuerzo: p.esfuerzo,
  topeMs: Math.min(TOPE_CLAUDE_MAPA_MS, p.topeMs), maxTokens: 16_000,
})

export interface OpcionesLeerMapa { claude?: LlamadaVision; topeMs?: number }
export interface ResultadoLeerMapa { mapa: MapaLeido; ajustes: string[]; modelo: string; usage: Uso }

/** Los cuadros (en orden) → lo que Claude ve en el mapa, validado. Lanza si Claude falla o la salida no es un objeto. */
export async function leerMapa(cuadros: Pick<Cuadro, 'seg' | 'jpg'>[], op: OpcionesLeerMapa = {}): Promise<ResultadoLeerMapa> {
  if (!cuadros.length) throw new Error('no hay cuadros para mirar')
  const orden = [...cuadros].sort((a, b) => a.seg - b.seg)
  const contenido: Anthropic.Beta.Messages.BetaContentBlockParam[] = [{ type: 'text', text: introCuadros(orden.length, orden[0].seg, orden[orden.length - 1].seg) }]
  orden.forEach((c, i) => {
    contenido.push({ type: 'text', text: etiquetaCuadro(i + 1, c.seg) })
    contenido.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.jpg.toString('base64') } })
  })
  const res = await (op.claude ?? llamarClaudeVision)({
    sistema: PROMPT_SISTEMA_MAPA, contenido, schema: SCHEMA_MAPA, esfuerzo: esfuerzoDe('medium'), topeMs: op.topeMs ?? TOPE_CLAUDE_MAPA_MS,
  })
  const { mapa, ajustes } = validarMapa(res.json, orden.map(c => c.seg))
  return { mapa, ajustes, modelo: res.modelo, usage: res.usage }
}


// ── Orquestador ──────────────────────────────────────────────────────────────────────────────────
/** Lo que se reserva al final para guardar el resultado (TOPE_CONSULTA_MS de registro.ts, 10 s, y un margen). */
export const RESERVA_GUARDAR_MS = 12_000
// listo: dry, está todo lo necesario y se cortó ANTES de Fathom (no se generó un video ni se llamó a Claude)
export type EstadoZonaVideo = 'ok' | 'sin_mapa' | 'sin_video' | 'sin_key' | 'listo' | 'error'
// Lo que se le reserva a los cuadros y a Claude cuando se espera el video dentro de un plazo (la ruta: 300 s)
export const RESERVA_CUADROS_CLAUDE_MS = TOPE_CUADROS_MS + 55_000
// Precio de Opus 5.5 (USD por millón de tokens; el razonamiento se cobra como salida). Aproximado si es otro modelo.
const USD_MTOK = { entrada: 4, salida: 20 }

export interface DepsZonaVideo extends OpcionesVideo, OpcionesFfmpeg {
  spawn?: SpawnFfmpeg
  claude?: LlamadaVision
  /** Hora límite (ms epoch) de todo. Por defecto, ahora + TOPE_VIDEO_MS + RESERVA_CUADROS_CLAUDE_MS. */
  deadline?: number
  /** Tope de la espera del video (por defecto TOPE_VIDEO_MS); igual se acota para que queden los cuadros y Claude. */
  topeVideoMs?: number
  /** Retoma una descarga ya pedida a Fathom. */
  descargaId?: string | null
  /** Salta Fathom: el video ya está en esta URL (prueba local; https, o http a la propia máquina con permitirHttpLocal). */
  urlVideo?: string
  permitirHttpLocal?: boolean
  /** Pisa los momentos (pruebas). */
  segundos?: number[]
  /** Por defecto true: si la ficha no marca un mapa en pantalla, no se mira el video. */
  soloSiMapaEnPantalla?: boolean
  anchoMax?: number
  /** Solo verifica (momentos, key de Fathom, clave de Claude, ffmpeg) y corta con estado 'listo': ni Fathom ni Claude. */
  dry?: boolean
}

export interface ResultadoZonaVideo<Z extends FichaParaMapa['zona'] = FichaParaMapa['zona']> {
  estado: EstadoZonaVideo
  motivo?: string
  /**
   * El error fue pasajero (Fathom 429/5xx/red, Claude 429/5xx/529, la espera del video): vale la pena reintentar más tarde.
   * Si ya había una descarga en Fathom, video.download_id la trae: el reintento la retoma (descarga_id) en vez de pedir otra.
   */
  transitorio?: boolean
  version: string
  momentos: number[] | null
  mapa?: MapaLeido
  zona?: Z & { mapa: BloqueMapaZona | null }   // la zona de la ficha TAL CUAL + el bloque mapa
  linea?: string                  // lineaMapa del bloque (para la ficha o el aviso)
  video?: { download_id: string | null; pedidos: number; content_type: string | null; file_size_bytes: number | null; expires_at: string | null }
  cuadros: { pedidos: number; sacados: number; fallas: string[] }
  tiempos: { total_ms: number; video_ms: number | null; cuadros_ms: number | null; claude_ms: number | null }
  tokens: (Uso & { costo_usd: number }) | null
  modelo: string | null
  ajustes: string[]
}

/**
 * Del recording_id y la ficha a la zona con el mapa visto en el video. NUNCA lanza. Orden: momentos → que estén la key de
 * Fathom, la clave de Claude y ffmpeg (con dry, acá corta: 'listo') → video (pedir y esperar) → cuadros → Claude → combinar.
 */
export async function zonaDesdeVideo<F extends FichaParaMapa>(recordingId: number, quien: Quien, ficha: F, deps: DepsZonaVideo = {}): Promise<ResultadoZonaVideo<F['zona']>> {
  const ahora = deps.ahora ?? (() => Date.now())
  const t0 = ahora()
  const deadline = deps.deadline ?? t0 + (deps.topeVideoMs ?? TOPE_VIDEO_MS) + RESERVA_CUADROS_CLAUDE_MS
  const r: ResultadoZonaVideo<F['zona']> = {
    estado: 'error', version: VERSION_MAPA, momentos: null, cuadros: { pedidos: 0, sacados: 0, fallas: [] },
    tiempos: { total_ms: 0, video_ms: null, cuadros_ms: null, claude_ms: null }, tokens: null, modelo: null, ajustes: [],
  }
  const terminar = (estado: EstadoZonaVideo, motivo?: string, transitorio?: boolean): ResultadoZonaVideo<F['zona']> => {
    r.estado = estado
    if (motivo) r.motivo = motivoDe(motivo)
    if (transitorio) r.transitorio = true
    r.tiempos.total_ms = Math.max(0, ahora() - t0)
    return r
  }
  try {
    if (!Number.isSafeInteger(recordingId) || recordingId <= 0) return terminar('error', 'recording_id inválido (tiene que ser un entero positivo)')
    if (!ficha || !esObj(ficha) || !esObj(ficha.zona)) return terminar('error', 'falta la ficha (o su zona)')
    if ((deps.soloSiMapaEnPantalla ?? true) && ficha.zona.mapa_en_pantalla !== true && !deps.segundos) {
      return terminar('sin_mapa', 'la ficha no marca un mapa en pantalla: no se mira el video')
    }
    r.momentos = deps.segundos?.length ? [...deps.segundos] : momentosMapa(ficha)
    // Sin el minuto de la zona no se mira nada: es un error (no "sin mapa", que diría que se miró y no estaba)
    if (!r.momentos?.length) return terminar('error', MOTIVO_SIN_MOMENTO)

    // Lo que hace falta, ANTES de pedirle a Fathom que genere el video
    if (!deps.urlVideo) {
      if (!QUIENES.includes(quien)) return terminar('error', `no hay cuenta de Fathom para "${String(quien)}" (tomas o gero_m)`)
      if (!claveApi(quien, deps.env ?? process.env)) return terminar('sin_key', `falta ${varApiKey(quien)}: la API key de Fathom de ${GRABADORES[quien].nombre}`)
    }
    if (!deps.claude && !claveClaude()) return terminar('error', 'falta ANTHROPIC_API_KEY (o BOT_ANTHROPIC_API_KEY)')
    let ffmpeg: string
    try {
      ffmpeg = ubicarFfmpeg(deps).ruta
    } catch (e) {
      return terminar('error', motivoDe(e))
    }
    if (deps.dry) {
      const video = deps.urlVideo ? 'la url del video' : `la API key de Fathom de ${GRABADORES[quien].nombre}`
      const pediria = deps.urlVideo ? 'leería el video de esa url' : `pediría el video a Fathom${deps.descargaId ? ' (retomando la descarga)' : ''}`
      return terminar('listo', `dry: están ${video}, la clave de Claude y ffmpeg; sin dry ${pediria}, sacaría ${r.momentos.length} cuadros y llamaría a Claude`)
    }

    // Video
    let url: string
    if (deps.urlVideo) {
      if (!urlVideoValida(deps.urlVideo, deps.permitirHttpLocal)) return terminar('error', 'la url del video no es válida (tiene que ser https)')
      url = deps.urlVideo
    } else {
      const tv = ahora()
      const limite = Math.min(tv + (deps.topeVideoMs ?? TOPE_VIDEO_MS), deadline - RESERVA_CUADROS_CLAUDE_MS)
      if (limite - tv < 10_000) return terminar('error', 'no queda tiempo para esperar el video', true)
      try {
        const v = await obtenerVideo(recordingId, quien, { ...deps, ahora, limite, descargaId: deps.descargaId ?? null })
        url = v.video.url
        r.video = { download_id: v.download_id, pedidos: v.pedidos, content_type: v.video.content_type, file_size_bytes: v.video.file_size_bytes, expires_at: v.video.expires_at }
      } catch (e) {
        r.tiempos.video_ms = ahora() - tv
        const enCurso = descargaDelError(e)
        if (enCurso) r.video = { download_id: enCurso.download_id, pedidos: enCurso.pedidos, content_type: null, file_size_bytes: null, expires_at: null }
        if (e instanceof ErrorVideo && e.codigo === 'sin_video') return terminar('sin_video', e.message)
        if (e instanceof ErrorFathomApi && e.codigo === 'sin_clave') return terminar('sin_key', e.message)
        return terminar('error', `video de Fathom: ${motivoDe(e)}`, esTransitorio(e) || (e instanceof ErrorVideo && e.codigo === 'espera'))
      }
      r.tiempos.video_ms = ahora() - tv
    }

    // Cuadros (solo en memoria)
    const tc = ahora()
    r.cuadros.pedidos = r.momentos.length
    let cuadros: Cuadro[]
    try {
      const c = await sacarCuadros(url, r.momentos, {
        ...deps, ffmpeg, permitirHttpLocal: deps.permitirHttpLocal, anchoMax: deps.anchoMax,
        topeMs: Math.max(5_000, Math.min(TOPE_CUADROS_MS, deadline - ahora() - 50_000)),
      })
      cuadros = c.cuadros
      r.cuadros.sacados = c.cuadros.length
      r.cuadros.fallas = c.fallas.map(f => `${hhmmss(f.seg)}: ${f.error}`)
    } catch (e) {
      r.tiempos.cuadros_ms = ahora() - tc
      return terminar('error', `cuadros: ${motivoDe(e)}`)
    }
    r.tiempos.cuadros_ms = ahora() - tc
    if (!cuadros.length) return terminar('error', `no salió ningún cuadro del video (${r.cuadros.fallas[0] ?? 'sin detalle'})`)
    if (r.cuadros.fallas.length) r.ajustes.push(`${r.cuadros.fallas.length} cuadro(s) no salieron: se miró con ${cuadros.length}`)

    // Claude
    const tl = ahora()
    // Lo que quede, menos lo de guardar el resultado (si Claude terminaba a 2 s del deadline, el UPDATE se cortaba)
    const topeClaude = Math.min(TOPE_CLAUDE_MAPA_MS, deadline - ahora() - RESERVA_GUARDAR_MS)
    if (topeClaude < 15_000) return terminar('error', 'no queda tiempo para que Claude lea el mapa', true)
    let leido: ResultadoLeerMapa
    try {
      leido = await leerMapa(cuadros, { claude: deps.claude, topeMs: topeClaude })
    } catch (e) {
      r.tiempos.claude_ms = ahora() - tl
      return terminar('error', `Claude: ${motivoDe(e)}`, esTransitorio(e))
    } finally {
      cuadros.length = 0            // los cuadros no se guardan en ningún lado
    }
    r.tiempos.claude_ms = ahora() - tl
    r.modelo = leido.modelo
    const u = leido.usage
    r.tokens = { ...u, costo_usd: Math.round(((u.input_tokens * USD_MTOK.entrada + u.output_tokens * USD_MTOK.salida) / 1e6) * 10_000) / 10_000 }
    r.ajustes.push(...leido.ajustes)
    r.mapa = leido.mapa
    if (!leido.mapa.hay_mapa) return terminar('sin_mapa', 'en los cuadros no se ve un mapa')
    r.zona = combinarZonaConMapa(ficha.zona, leido.mapa)
    if (r.zona.mapa) r.linea = lineaMapa(r.zona.mapa)
    return terminar('ok')
  } catch (e) {
    return terminar('error', `falla inesperada: ${motivoDe(e)}`)
  }
}

/**
 * El resultado de zonaDesdeVideo → lo que se guarda en cj_kickoffs.zona_video (guardarZonaVideo de registro.ts). null con
 * "listo" (dry: no se guarda nada). Sin cuadros ni la URL del video (el resultado no los trae); el download_id queda para
 * retomar la descarga si hay que reintentar.
 */
export function aZonaVideo(r: ResultadoZonaVideo, quien: Quien, op: { generado?: string; descargaPrevia?: string | null } = {}): ZonaVideoFicha | null {
  if (r.estado === 'listo') return null
  const mapa = r.estado === 'ok' ? r.zona?.mapa ?? null : null
  const estado = r.estado === 'ok' && !mapa ? 'sin_mapa' : r.estado
  return {
    estado,
    version: r.version,
    quien,
    download_id: r.video?.download_id ?? op.descargaPrevia ?? null,
    motivo: estado === 'ok' ? null : estado === 'sin_key' ? textoSinKeyMapa(GRABADORES[quien]?.nombre ?? String(quien)) : r.motivo ?? null,
    transitorio: !!r.transitorio,
    mapa,
    momentos: r.momentos,
    tokens: r.tokens,
    modelo: r.modelo,
    generado: op.generado ?? new Date().toISOString(),
  }
}
