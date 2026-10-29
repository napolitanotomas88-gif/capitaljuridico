// ── Bot "Capital Jurídico": etapa ÉXITO — ¿el cliente habla de RESULTADOS y son BUENOS? (Claude) ──────────────────────────
// SOLO SERVIDOR. Mismo patrón que lib/bot/alta/direccionClaude.ts: la misma clave (BOT_ANTHROPIC_API_KEY o
// ANTHROPIC_API_KEY), el mismo modelo por defecto (Haiku 5.5, esfuerzo bajo, salida JSON estricta validada a la vuelta), sin
// reintentos del SDK y con tope corto. BOT_EXITO_MODELO lo cambia. Antes de llegar acá el mensaje ya pasó el filtro barato
// (filtro.ts: pareceResultado), el dedupe por mensaje y el tope por cliente: nunca se llama por cada "gracias".
// Éxito = habla de resultados del estudio Y son buenos Y la confianza no es baja. La cita es un fragmento literal y corto.
import Anthropic from '@anthropic-ai/sdk'
import { MODELO_DIRECCION, claveClaudeDireccion } from '@/lib/bot/alta/direccionClaude'

export const TOPE_EXITO_MS = 15_000
export const modeloExito = (): string => process.env.BOT_EXITO_MODELO?.trim() || MODELO_DIRECCION

export interface LecturaExito { exito: boolean; hablaDeResultados: boolean; buenos: boolean; confianza: 'alta' | 'media' | 'baja'; cita: string; motivo: string }
export type ClasificarExito = (texto: string) => Promise<LecturaExito>

export const SISTEMA_EXITO = `Leés mensajes que los clientes de una agencia de marketing para abogados (Capital Jurídico) escriben en sus grupos de WhatsApp con el equipo.
Tenés que decir si el mensaje habla de RESULTADOS del estudio del cliente (casos cerrados, clientes nuevos, consultas o llamadas que entran, contratos firmados, facturación, cantidad de leads, agenda llena) y si esos resultados son BUENOS.
- "Cerré 3 casos esta semana", "me entraron muchísimas consultas", "excelente, no paran de escribirme" → habla de resultados y son buenos.
- "Gracias", "excelente" respondiendo a un guion, un video o un aviso, "perfecto, lo grabo mañana", saludos, dudas, quejas o pedidos → NO habla de resultados.
- "No está entrando nada", "pocas consultas" → habla de resultados, pero no son buenos.
Confianza: alta si es explícito; media si se entiende con alguna duda; baja si es ambiguo.
cita: un fragmento LITERAL del mensaje (hasta 140 caracteres) que muestre el resultado; vacío si no hay. motivo: una frase corta.`

const SCHEMA = {
  type: 'object',
  properties: {
    habla_de_resultados: { type: 'boolean' },
    resultados_buenos: { type: 'boolean' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    cita: { type: 'string' },
    motivo: { type: 'string' },
  },
  required: ['habla_de_resultados', 'resultados_buenos', 'confianza', 'cita', 'motivo'],
  additionalProperties: false,
} as const

const limpiar = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/** Valida la salida de Claude (puro: lo prueban los tests). La cita tiene que estar en el mensaje; si no, se usa el mensaje. */
export function leerSalidaExito(json: unknown, texto: string): LecturaExito {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('la salida de Claude no es un objeto')
  const o = json as Record<string, unknown>
  if (typeof o.habla_de_resultados !== 'boolean' || typeof o.resultados_buenos !== 'boolean') throw new Error('la salida de Claude no trae los campos pedidos')
  const confianza = o.confianza === 'alta' || o.confianza === 'media' ? o.confianza : 'baja'
  const plano = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  let cita = limpiar(o.cita, 140)
  if (!cita || !plano(texto).includes(plano(cita))) cita = limpiar(texto, 140)
  const habla = o.habla_de_resultados, buenos = o.resultados_buenos
  return { exito: habla && buenos && confianza !== 'baja', hablaDeResultados: habla, buenos, confianza, cita, motivo: limpiar(o.motivo, 200) }
}

function motivo(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude no respondió a tiempo'
  if (e instanceof Anthropic.APIConnectionError) return 'no se pudo conectar con Claude'
  if (e instanceof Anthropic.APIError) return `Claude respondió ${e.status ?? 'con error'}`
  return String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)
}

export interface OpcionesClaudeExito { apiKey?: string; cliente?: Pick<Anthropic, 'messages'>; modelo?: string; topeMs?: number }

/** Clasifica un mensaje. Tira si no hay clave, si Claude falla o rechaza, o si la salida no es la pedida. */
export async function clasificarConClaude(texto: string, op: OpcionesClaudeExito = {}): Promise<LecturaExito> {
  const entrada = texto.trim().slice(0, 2_000)
  if (!entrada) throw new Error('mensaje vacío')
  const tope = op.topeMs ?? TOPE_EXITO_MS
  let cliente = op.cliente
  if (!cliente) {
    const apiKey = op.apiKey ?? claveClaudeDireccion()
    if (!apiKey) throw new Error('falta BOT_ANTHROPIC_API_KEY (o ANTHROPIC_API_KEY)')
    cliente = new Anthropic({ apiKey, maxRetries: 0, timeout: tope })
  }
  let msg: Awaited<ReturnType<Anthropic['messages']['create']>>
  try {
    msg = await cliente.messages.create(
      {
        model: op.modelo ?? modeloExito(),
        max_tokens: 2048,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: SISTEMA_EXITO,
        messages: [{ role: 'user', content: `Mensaje del cliente:\n"""\n${entrada}\n"""` }],
      },
      { timeout: tope, maxRetries: 0 },
    ) as Awaited<ReturnType<Anthropic['messages']['create']>>
  } catch (e) {
    throw new Error(`clasificar el mensaje: ${motivo(e)}`)
  }
  const m = msg as { stop_reason?: string | null; content?: { type: string; text?: string }[] }
  if (m.stop_reason === 'refusal') throw new Error('Claude rechazó clasificar el mensaje')
  if (m.stop_reason === 'max_tokens') throw new Error('la respuesta de Claude se cortó por max_tokens')
  if (m.stop_reason !== 'end_turn') throw new Error(`Claude terminó de forma inesperada (${m.stop_reason ?? 'sin stop_reason'})`)
  const salida = (m.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('').trim()
  let json: unknown
  try { json = JSON.parse(salida) } catch { throw new Error('la salida de Claude no es JSON válido') }
  return leerSalidaExito(json, entrada)
}
