// ── Llamada a Claude de la etapa Guiones, con CACHÉ del contexto repetido ─────────────────────────
// Pedido de Tomás (25/10/2026, después de quemar crédito en las pruebas): una tanda hace ~20 llamadas y todas mandan el mismo
// contexto (preferencias, ficha, ideas, mercado, catálogo, base de la rama: ~10.000 tokens). Va como el PRIMER bloque del
// system con cache_control: la primera llamada lo escribe (1,25×) y las siguientes de los próximos 5 minutos lo leen a 0,1×.
// El plan corre solo y antes que los guiones, así que deja la caché escrita para las 6 llamadas en paralelo que siguen.
// Las instrucciones de cada paso (redactor, revisor, corrector) van DESPUÉS del bloque cacheado: el revisor sigue sin ver el
// prompt del redactor (contexto limpio), solo comparte los datos. Mismo patrón que kickoff/claude.ts (Opus 5.5, thinking
// adaptativo, fallbacks «default», salida estructurada, streaming, sin reintentos del SDK; 429/5xx → ErrorTransitorio).
// En `usage.input_tokens` va el equivalente en tokens de entrada (escritura de caché ×1,25 y lectura ×0,1) para el costo.
import Anthropic from '@anthropic-ai/sdk'
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import { claveClaude, modeloConfigurado, esPasajero, motivoApi, TOPE_CLAUDE_MS, MAX_TOKENS, type Esfuerzo } from '../kickoff/claude'
import type { Uso } from '../kickoff/tipos'

export interface PedidoCache {
  que: string
  contexto: string                // lo que se repite entre llamadas (se cachea)
  sistema: string                 // las instrucciones de este paso
  usuario: string
  schema: Record<string, unknown>
  esfuerzo: Esfuerzo
  topeMs: number
}

export async function llamarConCache(p: PedidoCache): Promise<{ json: unknown; modelo: string; usage: Uso }> {
  // Motor local (plan Max en la Mac de Tomás, GUIONES_LLM=cli): la misma llamada por `claude -p` (motor-cli.ts)
  if (process.env.GUIONES_LLM?.trim() === 'cli') {
    const { llamarCli } = await import('./motor-cli')
    const r = await llamarCli({ que: p.que, sistema: `${p.contexto}\n\n${p.sistema}`, usuario: p.usuario, schema: p.schema, esfuerzo: 'medium', topeMs: Math.max(p.topeMs, 300_000) })
    return { json: r.json, modelo: r.modelo, usage: r.usage }
  }
  const apiKey = claveClaude()
  if (!apiKey) throw new Error('falta ANTHROPIC_API_KEY (o BOT_ANTHROPIC_API_KEY)')
  const tope = Math.max(1_000, Math.min(TOPE_CLAUDE_MS, Math.round(p.topeMs)))
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: tope })
  const corte = AbortSignal.timeout(tope)
  let msg: Anthropic.Beta.Messages.BetaMessage
  try {
    msg = await client.beta.messages.stream({
      model: modeloConfigurado(), max_tokens: MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: p.esfuerzo, format: { type: 'json_schema', schema: p.schema } },
      system: [
        { type: 'text', text: p.contexto, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: p.sistema },
      ],
      messages: [{ role: 'user', content: p.usuario }],
    }, { signal: corte }).finalMessage()
  } catch (err) {
    if (corte.aborted) throw new ErrorTransitorio(`Claude no terminó ${p.que} en ${Math.round(tope / 1000)} s`)
    if (esPasajero(err)) throw new ErrorTransitorio(motivoApi(err))
    throw err instanceof Anthropic.APIError ? new Error(motivoApi(err)) : err
  }
  if (msg.stop_reason === 'refusal') throw new Error(`Claude rechazó ${p.que}`)
  if (msg.stop_reason === 'max_tokens') throw new Error(`la respuesta de Claude (${p.que}) se cortó por max_tokens`)
  if (msg.stop_reason !== 'end_turn') throw new Error(`Claude terminó ${p.que} de forma inesperada (${msg.stop_reason ?? 'sin stop_reason'})`)
  const desde = msg.content.map(b => b.type).lastIndexOf('fallback') + 1
  const texto = msg.content.slice(desde).map(b => (b.type === 'text' ? b.text : '')).join('').trim()
  let json: unknown
  try { json = JSON.parse(texto) } catch { throw new Error(`la salida de Claude (${p.que}) no es JSON válido`) }
  const u = msg.usage
  const equivalente = (u.input_tokens ?? 0) + Math.round((u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1)
  return { json, modelo: msg.model, usage: { input_tokens: equivalente, output_tokens: u.output_tokens ?? 0 } }
}
