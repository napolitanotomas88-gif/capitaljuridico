// ── Llamada a Claude del kickoff (la usan extraer.ts, ideas.ts y mapa.ts) ─────────────────────────
// Mismo patrón que lib/fathomAnuncios/extraer.ts, que ya corre en producción:
//   · Opus 5.5 por defecto (KICKOFF_MODELO), thinking adaptativo (en Opus 5.5 no se puede apagar: "disabled" o budget_tokens
//     dan 400), esfuerzo explícito por llamada (KICKOFF_ESFUERZO pisa el de las dos; el default de Opus 5.5 es medium);
//   · salida estructurada con JSON Schema estricto (output_config.format), y además se valida todo a la vuelta;
//   · streaming (.stream + finalMessage) para no cortar por timeout; max_tokens 32000 (o el que pida la llamada);
//   · el mensaje de usuario es texto (ficha, ideas) o bloques (el mapa: texto + los cuadros del video como imágenes);
//   · fallback del servidor ante un rechazo de los clasificadores: fallbacks "default" con la beta
//     server-side-fallback-2026-07-01 (por eso va por client.beta.messages);
//   · stop_reason se mira ANTES de leer el contenido: refusal y max_tokens son errores, nunca un resultado a medias;
//   · sin reintentos del SDK (maxRetries 0): el único reintento lo decide procesar.ts, que sabe cuánto tiempo queda. 429,
//     5xx, 529 overloaded, error a mitad del stream y conexión salen como ErrorTransitorio; lo demás, como error definitivo.
// Clave: ANTHROPIC_API_KEY (local) o BOT_ANTHROPIC_API_KEY (así se llama en Vercel). Se pasa explícita al SDK.
import Anthropic from '@anthropic-ai/sdk'
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import { claveOMac, crearClienteClaude } from '@/lib/ia/cliente'
import type { Uso } from './tipos'

export const MODELO_POR_DEFECTO = 'claude-opus-5-5'
export const TOPE_CLAUDE_MS = 240_000           // por intento, como máximo
export const MAX_TOKENS = 32_000
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Esfuerzo = (typeof ESFUERZOS)[number]

// Con CLAUDE_VIA=mac (1/11/2026) no hace falta clave: las llamadas van a la Mac de Tomás (lib/ia/puenteMac.ts)
export const claveClaude = (): string => claveOMac(process.env.ANTHROPIC_API_KEY?.trim() || process.env.BOT_ANTHROPIC_API_KEY?.trim() || '')
export const modeloConfigurado = (): string => process.env.KICKOFF_MODELO?.trim() || MODELO_POR_DEFECTO
/** El esfuerzo de esta llamada: KICKOFF_ESFUERZO si es válido (pisa los dos), si no el que pide cada paso. */
export function esfuerzoDe(porDefecto: Esfuerzo): Esfuerzo {
  const e = (process.env.KICKOFF_ESFUERZO ?? '').trim()
  return (ESFUERZOS as readonly string[]).includes(e) ? (e as Esfuerzo) : porDefecto
}

/** ¿Vale la pena reintentar? 429, 5xx (529 = overloaded), error a mitad del stream o conexión. */
export function esPasajero(e: unknown): boolean {
  if (e instanceof Anthropic.APIUserAbortError) return false
  if (e instanceof Anthropic.APIConnectionError) return true          // incluye APIConnectionTimeoutError
  if (e instanceof Anthropic.APIError) {
    if (e.status === 429 || (typeof e.status === 'number' && e.status >= 500)) return true
    return e.status === undefined && /overloaded|api_error|rate_limit/i.test(String(e.type ?? e.message))
  }
  return false
}

/** Mensaje corto de un error de la API (va al registro y al aviso; motivoDe además limpia URLs y claves). */
export function motivoApi(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude no respondió a tiempo (timeout de conexión)'
  if (e instanceof Anthropic.APIConnectionError) return 'no se pudo conectar con Claude'
  if (e instanceof Anthropic.APIError) {
    const cuerpo = e.error as { error?: { message?: unknown } } | undefined
    const detalle = typeof cuerpo?.error?.message === 'string' ? cuerpo.error.message.replace(/\s+/g, ' ').slice(0, 150) : ''
    return `Claude respondió ${e.status ?? 'con error'}${e.type ? ` (${e.type})` : ''}${detalle ? `: ${detalle}` : ''}`
  }
  return (e as Error)?.message ?? String(e)
}

export interface PedidoClaude {
  que: string                     // 'la ficha' | 'las ideas' | 'el mapa' (para los mensajes de error)
  sistema: string
  usuario: string | Anthropic.Beta.Messages.BetaContentBlockParam[]   // texto, o bloques (imágenes del video)
  schema: Record<string, unknown>
  esfuerzo: Esfuerzo
  topeMs: number
  maxTokens?: number              // por defecto MAX_TOKENS
}
export interface RespuestaClaude { json: unknown; modelo: string; usage: Uso }

export async function llamarClaude(p: PedidoClaude): Promise<RespuestaClaude> {
  const apiKey = claveClaude()
  if (!apiKey) throw new Error('falta ANTHROPIC_API_KEY (o BOT_ANTHROPIC_API_KEY)')
  const tope = Math.max(1_000, Math.min(TOPE_CLAUDE_MS, Math.round(p.topeMs)))
  const client = crearClienteClaude({ apiKey, maxRetries: 0, timeout: tope, origen: 'kickoff' })
  const corte = AbortSignal.timeout(tope)
  let msg: Anthropic.Beta.Messages.BetaMessage
  try {
    const stream = client.beta.messages.stream(
      {
        model: modeloConfigurado(),
        max_tokens: p.maxTokens ?? MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: p.esfuerzo, format: { type: 'json_schema', schema: p.schema } },
        system: p.sistema,
        messages: [{ role: 'user', content: p.usuario }],
      },
      { signal: corte },
    )
    msg = await stream.finalMessage()
  } catch (err) {
    if (corte.aborted) throw new ErrorTransitorio(`Claude no terminó ${p.que} en ${Math.round(tope / 1000)} s`)
    if (esPasajero(err)) throw new ErrorTransitorio(motivoApi(err))
    throw err instanceof Anthropic.APIError ? new Error(motivoApi(err)) : err
  }

  if (msg.stop_reason === 'refusal') throw new Error(`Claude rechazó ${p.que} (categoría ${msg.stop_details?.category ?? 'sin categoría'})`)
  if (msg.stop_reason === 'max_tokens') throw new Error(`la respuesta de Claude (${p.que}) se cortó por max_tokens`)
  if (msg.stop_reason !== 'end_turn') throw new Error(`Claude terminó ${p.que} de forma inesperada (${msg.stop_reason ?? 'sin stop_reason'})`)

  // Si hubo fallback a mitad de respuesta, lo del modelo que rechazó queda antes del bloque "fallback": se toma lo de después
  const desde = msg.content.map(b => b.type).lastIndexOf('fallback') + 1
  const texto = msg.content.slice(desde).map(b => (b.type === 'text' ? b.text : '')).join('').trim()
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    throw new Error(`la salida de Claude (${p.que}) no es JSON válido`)
  }
  return { json, modelo: msg.model, usage: { input_tokens: msg.usage.input_tokens ?? 0, output_tokens: msg.usage.output_tokens ?? 0 } }
}
