// ── Cliente mínimo de la API de Fathom (solo lectura de reuniones), con la API key de cada persona ─────
// Sirve para RECUPERAR o reprocesar una kickoff que el webhook no entregó (por ejemplo, una grabación de antes del deploy,
// o una de Gero M antes de crear su webhook): trae la reunión por recording_id y arma el MISMO payload que manda el webhook
// "new meeting content ready" (objeto Meeting con transcript, default_summary y action_items), validado con
// validarReunion de lib/fathomAnuncios/tipos.ts. Lo usa el modo manual de /api/bot/kickoff (?recording_id=…&quien=…).
// API (doc oficial leída el 24/10/2026, https://developers.fathom.ai): base https://api.fathom.ai/external/v1, cabecera
// X-Api-Key. No hay "traer una reunión por id", así que:
//   1. GET /meetings?include_action_items=true (pedido liviano), página por página con cursor/next_cursor, hasta encontrar
//      el recording_id (como mucho MAX_PAGINAS; created_after/created_before acotan si se sabe la fecha). La lista trae
//      título, url, fechas agendadas y grabadas, invitados, recorded_by y tareas;
//   2. en paralelo, GET /recordings/{id}/transcript y GET /recordings/{id}/summary (sin destination_url: respuesta
//      sincrónica). Son los pedidos "pesados" (30 por minuto, a veces 5): por eso no se piden en la lista, que los
//      repetiría en cada página. La transcripción es obligatoria; el resumen no (sin él solo falta la pista de la rama).
// Límites de Fathom: 60 pedidos por minuto por cuenta. Un 429 con Retry-After corto (hasta MAX_ESPERA_429_MS) se espera y
// se reintenta UNA vez; un 5xx, una vez. Cada pedido tiene su tope (TOPE_PEDIDO_MS) y todo junto un deadline.
// Errores claros por código (sin clave, 401, 403, 404, 429, 5xx, red, timeout, respuesta rara): ErrorFathomApi, con
// `transitorio` en 429/5xx/red/timeout (mismo contrato que lib/fathomAnuncios/errores.ts). La API key va SOLO en la
// cabecera: nunca en la URL, en un mensaje, en un log ni en lo que se devuelve. Fetch, reloj y entorno inyectables.
import { RE_TIMESTAMP, validarReunion, type ReunionFathom } from '@/lib/fathomAnuncios/tipos'
import { GRABADORES, QUIENES, varApiKey, type Quien } from './grabadores'

export const BASE_FATHOM = 'https://api.fathom.ai/external/v1'
export const TOPE_PEDIDO_MS = 12_000
export const TOPE_TOTAL_MS = 40_000
export const MAX_PAGINAS = 25
export const MAX_ESPERA_429_MS = 10_000

export type CodigoFathom =
  | 'sin_clave' | 'pedido_invalido' | 'no_autorizada' | 'sin_permiso' | 'no_encontrada' | 'limite' | 'servidor' | 'red' | 'timeout' | 'respuesta_invalida'

export class ErrorFathomApi extends Error {
  readonly codigo: CodigoFathom
  readonly status: number | null
  readonly transitorio: boolean
  /** Segundos que pidió esperar Fathom (Retry-After de un 429), si los dijo. */
  readonly reintentarEnS: number | null
  constructor(codigo: CodigoFathom, mensaje: string, op: { status?: number | null; reintentarEnS?: number | null } = {}) {
    super(mensaje)
    this.name = 'ErrorFathomApi'
    this.codigo = codigo
    this.status = op.status ?? null
    this.transitorio = codigo === 'limite' || codigo === 'servidor' || codigo === 'red' || codigo === 'timeout'
    this.reintentarEnS = op.reintentarEnS ?? null
  }
}

type Entorno = Record<string, string | undefined>
type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** La API key de una persona (FATHOM_API_KEY_<QUIEN>), o null. Nunca se loguea. */
export function claveApi(quien: Quien, env: Entorno = process.env): string | null {
  return env[varApiKey(quien)]?.trim() || null
}

const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const dos = (n: number) => String(n).padStart(2, '0')

/** "HH:MM:SS" de un timestamp de Fathom ("00:05:32"; también "5:32", "1:05:32" o segundos como número), o null. */
export function aHHMMSS(x: unknown): string | null {
  let total: number
  if (typeof x === 'number') {
    if (!Number.isFinite(x) || x < 0) return null
    total = Math.floor(x)
  } else if (typeof x === 'string') {
    const m = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?$/.exec(x.trim())
    if (!m) return null
    const [a, b, c] = [Number(m[1]), Number(m[2]), m[3] === undefined ? null : Number(m[3])]
    if (b > 59 || (c !== null && c > 59)) return null
    total = c === null ? a * 60 + b : a * 3600 + b * 60 + c
  } else return null
  const hhmmss = `${dos(Math.floor(total / 3600))}:${dos(Math.floor((total % 3600) / 60))}:${dos(total % 60)}`
  return RE_TIMESTAMP.test(hhmmss) ? hhmmss : null
}

/** Retry-After en segundos (entero o fecha HTTP), o null. */
function segundosRetry(v: string | null, ahoraMs: number): number | null {
  if (!v) return null
  const t = v.trim()
  if (/^\d{1,6}$/.test(t)) return Number(t)
  const f = Date.parse(t)
  return Number.isFinite(f) ? Math.max(0, Math.ceil((f - ahoraMs) / 1000)) : null
}

function errorDeEstado(status: number, que: string, quien: Quien, esperaS: number | null): ErrorFathomApi {
  const nombre = GRABADORES[quien].nombre
  if (status === 400) return new ErrorFathomApi('pedido_invalido', `Fathom rechazó el pedido de ${que} (400)`, { status })
  if (status === 401) return new ErrorFathomApi('no_autorizada', `la API key de Fathom de ${nombre} (${varApiKey(quien)}) no es válida o se revocó (401)`, { status })
  if (status === 403) return new ErrorFathomApi('sin_permiso', `la API key de Fathom de ${nombre} no tiene permiso para ${que} (403)`, { status })
  if (status === 404) return new ErrorFathomApi('no_encontrada', `Fathom no encontró ${que} (404)`, { status })
  if (status === 429) {
    return new ErrorFathomApi('limite', `Fathom limitó los pedidos de la cuenta de ${nombre} (429)${esperaS !== null ? `: reintentar en ${esperaS} s` : ': reintentar en un minuto'}`, { status, reintentarEnS: esperaS })
  }
  return new ErrorFathomApi('servidor', `Fathom respondió ${status} a ${que}`, { status })
}

interface Ctx { clave: string; quien: Quien; fetch: Fetch; ahora: () => number; esperar: (ms: number) => Promise<void>; deadline: number }

/** Un GET a la API con su tope; 429 corto y 5xx se reintentan una vez si queda tiempo. */
async function pedir(ctx: Ctx, ruta: string, query: URLSearchParams | null, que: string): Promise<unknown> {
  const url = `${BASE_FATHOM}${ruta}${query && [...query.keys()].length ? `?${query}` : ''}`
  for (let intento = 0; ; intento++) {
    const restante = ctx.deadline - ctx.ahora()
    if (restante < 1_000) throw new ErrorFathomApi('timeout', `no quedó tiempo para pedirle a Fathom ${que}`)
    const tope = Math.min(TOPE_PEDIDO_MS, restante)
    let res: Response
    try {
      res = await ctx.fetch(url, { method: 'GET', headers: { 'X-Api-Key': ctx.clave, accept: 'application/json' }, signal: AbortSignal.timeout(tope), cache: 'no-store' })
    } catch (e) {
      const n = (e as Error)?.name
      if (n === 'TimeoutError' || n === 'AbortError') throw new ErrorFathomApi('timeout', `Fathom no respondió en ${Math.round(tope / 1000)} s (${que})`)
      throw new ErrorFathomApi('red', `no se pudo conectar con Fathom (${que})`)
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        throw new ErrorFathomApi('respuesta_invalida', `Fathom devolvió algo que no es JSON (${que})`, { status: res.status })
      }
    }
    await res.body?.cancel().catch(() => {})
    const esperaS = res.status === 429 ? segundosRetry(res.headers.get('retry-after'), ctx.ahora()) : null
    const queda = ctx.deadline - ctx.ahora()
    if (intento === 0 && res.status === 429 && esperaS !== null && esperaS * 1000 <= MAX_ESPERA_429_MS && queda - esperaS * 1000 > 2_000) {
      await ctx.esperar(esperaS * 1000)
      continue
    }
    if (intento === 0 && res.status >= 500 && queda > 3_000) {
      await ctx.esperar(1_000)
      continue
    }
    throw errorDeEstado(res.status, que, ctx.quien, esperaS)
  }
}

// ── Armado del payload (puro) ─────────────────────────────────────────────────────────────────────
/** El payload tal como lo manda el webhook "new meeting content ready" (objeto Meeting). */
export type PayloadWebhook = Record<string, unknown> & { recording_id: number }

// Los campos del Meeting que manda el webhook, en el orden de la doc (lo demás de la lista, como highlights o
// crm_matches, no se usa y no se copia)
const CAMPOS_REUNION = [
  'title', 'meeting_title', 'meeting_type', 'recording_id', 'url', 'share_url', 'created_at', 'scheduled_start_time', 'scheduled_end_time',
  'recording_start_time', 'recording_end_time', 'calendar_invitees_domains_type', 'transcript_language', 'calendar_invitees', 'recorded_by',
] as const

type RenglonPayload = { speaker: { display_name: string; matched_calendar_invitee_email: string | null }; text: string; timestamp: string }

/**
 * La transcripción leída: los renglones con texto y hora HH:MM:SS, cuántos traían texto y cuántos de esos se descartaron
 * porque la hora no se entiende (aHHMMSS). null = no vino una lista.
 */
export function leerTranscripcion(x: unknown): { renglones: RenglonPayload[]; conTexto: number; sinHora: number } | null {
  const lista = Array.isArray(x) ? x : esObj(x) && Array.isArray(x.transcript) ? x.transcript : null
  if (!lista) return null
  const renglones: RenglonPayload[] = []
  let conTexto = 0, sinHora = 0
  for (const r of lista) {
    if (!esObj(r) || typeof r.text !== 'string' || !r.text.trim()) continue
    conTexto++
    const ts = aHHMMSS(r.timestamp)
    if (!ts) { sinHora++; continue }
    const sp = esObj(r.speaker) ? r.speaker : {}
    renglones.push({
      speaker: {
        display_name: typeof sp.display_name === 'string' && sp.display_name.trim() ? sp.display_name : 'Sin nombre',
        matched_calendar_invitee_email: typeof sp.matched_calendar_invitee_email === 'string' ? sp.matched_calendar_invitee_email : null,
      },
      text: r.text,
      timestamp: ts,
    })
  }
  return { renglones, conTexto, sinHora }
}

/** Renglones de la transcripción con timestamp HH:MM:SS (los que no tienen texto u hora válida se descartan). */
export function renglonesDeTranscripcion(x: unknown): RenglonPayload[] | null {
  return leerTranscripcion(x)?.renglones ?? null
}

/** El resumen ({ summary: { template_name, markdown_formatted } } o el objeto solo) como default_summary, o null. */
export function resumenDe(x: unknown): { template_name: string | null; markdown_formatted: string | null } | null {
  const s = esObj(x) && esObj(x.summary) ? x.summary : x
  if (!esObj(s) || !('markdown_formatted' in s || 'template_name' in s)) return null
  const t = (v: unknown) => (typeof v === 'string' ? v : null)
  return { template_name: t(s.template_name), markdown_formatted: t(s.markdown_formatted) }
}

/**
 * Meeting de la lista + transcripción + resumen → el payload del webhook, validado. Lanza ErrorFathomApi
 * ('respuesta_invalida', la ruta responde 502 y NO procesa) si no hay transcripción, si viene vacía, si más de la mitad de
 * los renglones trae una hora que no se entiende, o si la reunión no pasa validarReunion (url que no es de fathom.video…).
 * Lo de la transcripción vacía importa: procesarKickoff la marcaría "omitida", que es un estado final (borra el payload) y
 * no avisa a nadie; desde ahí el webhook real de esa grabación y el modo manual sin forzar darían "duplicada". Pasa si se
 * recupera la kickoff apenas termina la llamada (la reunión ya figura en /meetings y la transcripción todavía no) o si
 * Fathom cambia el formato de la hora.
 */
export function armarPayload(reunion: unknown, transcripcion: unknown, resumen: unknown): { payload: PayloadWebhook; reunion: ReunionFathom } {
  if (!esObj(reunion)) throw new ErrorFathomApi('respuesta_invalida', 'Fathom devolvió una reunión que no es un objeto')
  const t = leerTranscripcion(transcripcion ?? reunion.transcript)
  if (!t) throw new ErrorFathomApi('respuesta_invalida', `Fathom no devolvió la transcripción de la grabación ${String(reunion.recording_id)}`)
  if (!t.renglones.length || t.sinHora * 2 > t.conTexto) {
    const que = !t.conTexto ? 'vacía' : `con horas ilegibles (${t.sinHora} de ${t.conTexto} renglones)`
    throw new ErrorFathomApi('respuesta_invalida', `Fathom devolvió la transcripción ${que}: reintentá en unos minutos (si sigue igual, avisá: puede haber cambiado el formato)`)
  }
  const renglones = t.renglones
  const payload: Record<string, unknown> = {}
  for (const k of CAMPOS_REUNION) if (k in reunion) payload[k] = reunion[k]
  payload.transcript = renglones
  payload.default_summary = resumenDe(resumen) ?? resumenDe(reunion.default_summary)
  payload.action_items = Array.isArray(reunion.action_items) ? reunion.action_items : null
  const v = validarReunion(payload)
  if (!v.ok) throw new ErrorFathomApi('respuesta_invalida', `la reunión que devolvió Fathom no pasa la validación: ${v.error}`)
  return { payload: payload as PayloadWebhook, reunion: v.reunion }
}

// ── Traer una reunión por recording_id ────────────────────────────────────────────────────────────
export interface OpcionesTraer {
  env?: Entorno
  fetch?: Fetch
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
  /** Hora límite (ms epoch) para todo. Por defecto, ahora + TOPE_TOTAL_MS. */
  deadline?: number
  /** ISO: acotan la búsqueda en la lista (created_after / created_before). */
  creadoDesde?: string | null
  creadoHasta?: string | null
  maxPaginas?: number
}

export interface ReunionTraida {
  payload: PayloadWebhook
  reunion: ReunionFathom
  quien: Quien
  /** Páginas de /meetings que hubo que recorrer. */
  paginas: number
  /** Lo que faltó y no frena (por ejemplo, el resumen). */
  notas: string[]
}

const fechaIso = (x: string | null | undefined): string | null => {
  if (!x?.trim()) return null
  const t = Date.parse(x.trim())
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export async function traerReunion(recordingId: number, quien: Quien, op: OpcionesTraer = {}): Promise<ReunionTraida> {
  if (!Number.isSafeInteger(recordingId) || recordingId <= 0) throw new ErrorFathomApi('pedido_invalido', 'recording_id inválido (tiene que ser un entero positivo)')
  if (!QUIENES.includes(quien)) throw new ErrorFathomApi('pedido_invalido', `no hay cuenta de Fathom para "${String(quien)}"`)
  const env = op.env ?? process.env
  const clave = claveApi(quien, env)
  if (!clave) {
    throw new ErrorFathomApi('sin_clave', `falta ${varApiKey(quien)}: la API key de Fathom de ${GRABADORES[quien].nombre} (Fathom → Settings → API Access) en el entorno del Despacho`)
  }
  const ahora = op.ahora ?? (() => Date.now())
  const ctx: Ctx = {
    clave, quien, ahora,
    fetch: op.fetch ?? ((input, init) => fetch(input, init)),
    esperar: op.esperar ?? (ms => new Promise<void>(r => setTimeout(r, Math.max(0, ms)))),
    deadline: op.deadline ?? ahora() + TOPE_TOTAL_MS,
  }
  const maxPaginas = Math.max(1, Math.min(100, op.maxPaginas ?? MAX_PAGINAS))
  const desde = fechaIso(op.creadoDesde), hasta = fechaIso(op.creadoHasta)

  // 1. La reunión en la lista (con las tareas), página por página
  let encontrada: Record<string, unknown> | null = null
  let cursor: string | null = null
  let paginas = 0
  const vistos = new Set<string>()
  while (!encontrada && paginas < maxPaginas) {
    const q = new URLSearchParams({ include_action_items: 'true' })
    if (desde) q.set('created_after', desde)
    if (hasta) q.set('created_before', hasta)
    if (cursor) q.set('cursor', cursor)
    const r = await pedir(ctx, '/meetings', q, 'la lista de reuniones')
    paginas++
    if (!esObj(r) || !Array.isArray(r.items)) throw new ErrorFathomApi('respuesta_invalida', 'Fathom devolvió la lista de reuniones sin "items"')
    encontrada = r.items.find((m): m is Record<string, unknown> => esObj(m) && m.recording_id === recordingId) ?? null
    const sig: string | null = typeof r.next_cursor === 'string' && r.next_cursor ? r.next_cursor : null
    if (!sig || vistos.has(sig)) break
    vistos.add(sig)
    cursor = sig
  }
  if (!encontrada) {
    const tope = paginas >= maxPaginas ? ` (se cortó en ${maxPaginas} páginas: acotá con la fecha)` : ''
    throw new ErrorFathomApi('no_encontrada', `la grabación ${recordingId} no está entre las reuniones que ve la cuenta de Fathom de ${GRABADORES[quien].nombre}${tope}: ¿la grabó otra persona?`, { status: 404 })
  }

  // 2. Transcripción (obligatoria) y resumen (si falla, se sigue sin él), en paralelo
  const [tr, rs] = await Promise.allSettled([
    pedir(ctx, `/recordings/${recordingId}/transcript`, null, `la transcripción de la grabación ${recordingId}`),
    pedir(ctx, `/recordings/${recordingId}/summary`, null, `el resumen de la grabación ${recordingId}`),
  ])
  if (tr.status === 'rejected') throw tr.reason
  const notas: string[] = []
  let resumen: unknown = null
  if (rs.status === 'fulfilled') resumen = rs.value
  else {
    const e = rs.reason
    if (e instanceof ErrorFathomApi && (e.codigo === 'no_autorizada' || e.codigo === 'sin_permiso')) throw e
    notas.push(`sin resumen de Fathom (${e instanceof Error ? e.message : String(e)}): la rama probable sale de la transcripción`)
  }
  const { payload, reunion } = armarPayload(encontrada, tr.value, resumen)
  return { payload, reunion, quien, paginas, notas }
}

/** Estado HTTP con que la ruta contesta un error de la API (el detalle va en el mensaje). */
export function estadoHttpDe(e: ErrorFathomApi): number {
  switch (e.codigo) {
    case 'sin_clave': return 503
    case 'pedido_invalido': return 400
    case 'no_encontrada': return 404
    case 'limite': return 429
    case 'timeout': return 504
    default: return 502   // 401/403 de Fathom (la key es del servidor, no de quien llama), 5xx, red, respuesta rara
  }
}
