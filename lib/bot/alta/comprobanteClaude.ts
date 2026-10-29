// ── Bot "Capital Jurídico": lectura del comprobante con Claude (visión) ──────────────────────────────────────────────
// SOLO SERVIDOR (API de Anthropic). No lleva `import 'server-only'` para poder probarlo con node, con el cliente falso.
// Mismo cliente y misma clave que direccionClaude.ts: claveClaudeDireccion() (BOT_ANTHROPIC_API_KEY o ANTHROPIC_API_KEY) y,
// por defecto, el mismo modelo (MODELO_DIRECCION, Haiku 5.5): una extracción corta, una vez por comprobante (el motor la
// guarda en caché por sha256 + versión + modelo). BOT_ALTA_MODELO_COMPROBANTE lo cambia (decisión 5 de Tomás: Haiku u Opus).
//   · Salida JSON estricta (output_config.format con SCHEMA_COMPROBANTE) y validada a la vuelta (leerSalida).
//   · Va por client.beta.messages para poder sumar el fallback del servidor ante un rechazo de los clasificadores en los
//     modelos que lo tienen (Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.1): fallbacks "default" con la beta
//     server-side-fallback-2026-07-01. Haiku 5.5 no tiene fallback: un rechazo es un error (queda "ilegible" y lo mira
//     un humano).
//   · stop_reason se mira antes del contenido: refusal y max_tokens son errores. Si hubo fallback, vale el texto que viene
//     después del último bloque `fallback`.
//   · Errores: 429, 5xx, 529 y conexión → ErrorTransitorio (el motor reintenta); el resto, Error común.
//   · Sin reintentos del SDK (maxRetries 0) y con tope de 45 s.
import Anthropic from '@anthropic-ai/sdk'
import { ErrorTransitorio } from '../../fathomAnuncios/errores'
import { MODELO_DIRECCION, claveClaudeDireccion } from './direccionClaude'
import { SCHEMA_COMPROBANTE, SISTEMA_COMPROBANTE, formatoComprobante, leerSalida, type SalidaComprobante } from './comprobante'
import type { MedioDescargado } from './motor/tipos'

export const TOPE_COMPROBANTE_MS = 45_000
export const modeloComprobante = (): string => process.env.BOT_ALTA_MODELO_COMPROBANTE?.trim() || MODELO_DIRECCION
const CON_FALLBACK = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/

/** Lo mínimo del cliente de Anthropic que se usa (el real o uno falso en los tests). */
export interface ClienteClaudeVision {
  beta: { messages: { create(body: Record<string, unknown>, op?: { timeout?: number; maxRetries?: number }): Promise<unknown> } }
}

export interface OpcionesVision { apiKey?: string; cliente?: ClienteClaudeVision; modelo?: string; topeMs?: number }

export interface LecturaClaude { modelo: string; salida: SalidaComprobante; tokens: { entrada: number | null; salida: number | null } }

function motivo(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude no respondió a tiempo'
  if (e instanceof Anthropic.APIConnectionError) return 'no se pudo conectar con Claude'
  if (e instanceof Anthropic.APIError) return `Claude respondió ${e.status ?? 'con error'}`
  return String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
}
const esPasajero = (e: unknown): boolean => {
  if (e instanceof Anthropic.APIConnectionError) return true
  const s = (e as { status?: number })?.status
  return typeof s === 'number' && (s === 429 || s >= 500)
}

interface Bloque { type: string; text?: string }
interface Respuesta { stop_reason?: string | null; stop_details?: { category?: string | null } | null; content?: Bloque[]; usage?: { input_tokens?: number; output_tokens?: number } }

export async function leerComprobanteConClaude(medio: Pick<MedioDescargado, 'base64' | 'mime' | 'bytes'>, op: OpcionesVision = {}): Promise<LecturaClaude> {
  const fmt = formatoComprobante(medio.mime, medio.bytes, null)
  if (!fmt.ok) throw new Error(`formato no soportado: ${fmt.motivo}`)
  const modelo = op.modelo ?? modeloComprobante()
  const tope = op.topeMs ?? TOPE_COMPROBANTE_MS
  let cliente = op.cliente
  if (!cliente) {
    const apiKey = op.apiKey ?? claveClaudeDireccion()
    if (!apiKey) throw new Error('falta BOT_ANTHROPIC_API_KEY (o ANTHROPIC_API_KEY)')
    cliente = new Anthropic({ apiKey, maxRetries: 0, timeout: tope }) as unknown as ClienteClaudeVision
  }
  const adjunto = fmt.tipo === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: fmt.mime, data: medio.base64.replace(/\s/g, '') } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: medio.base64.replace(/\s/g, '') } }
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    max_tokens: 8000,   // deja lugar al razonamiento (piensa por defecto) además del JSON corto
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_COMPROBANTE } },
    system: SISTEMA_COMPROBANTE,
    messages: [{ role: 'user', content: [adjunto, { type: 'text', text: 'Leé este comprobante y devolvé los campos del esquema.' }] }],
    ...(CON_FALLBACK.test(modelo) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  }
  let r: Respuesta
  try {
    r = (await cliente.beta.messages.create(cuerpo, { timeout: tope, maxRetries: 0 })) as Respuesta
  } catch (e) {
    if (esPasajero(e)) throw new ErrorTransitorio(`lectura del comprobante: ${motivo(e)}`)
    throw new Error(`lectura del comprobante: ${motivo(e)}`)
  }
  if (r.stop_reason === 'refusal') throw new Error(`Claude no leyó el comprobante (rechazo: ${r.stop_details?.category ?? 'sin categoría'})`)
  if (r.stop_reason === 'max_tokens') throw new Error('la respuesta de Claude se cortó por max_tokens')
  if (r.stop_reason !== 'end_turn') throw new Error(`Claude terminó de forma inesperada (${r.stop_reason ?? 'sin stop_reason'})`)
  const bloques = r.content ?? []
  const ultimoFallback = bloques.map((b) => b.type).lastIndexOf('fallback')
  const texto = bloques.slice(ultimoFallback + 1).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('').trim()
  let json: unknown
  try { json = JSON.parse(texto) } catch { throw new Error('la salida de Claude no es JSON válido') }
  return { modelo, salida: leerSalida(json), tokens: { entrada: r.usage?.input_tokens ?? null, salida: r.usage?.output_tokens ?? null } }
}
