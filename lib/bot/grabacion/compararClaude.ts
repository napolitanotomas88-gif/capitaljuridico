// ── Comparación con Claude, solo para las frases dudosas del cruce simple (e03) ─────────────────────────────────────
// Mismo cliente y mismo modelo que el kickoff (llamarClaude de lib/bot/kickoff/claude.ts, KICKOFF_MODELO), esfuerzo medium,
// MAX_TOKENS_COMPARACION de salida (con el thinking adaptativo, 8.000 podía cortar por max_tokens y llamarClaude lo trata como
// error) y un tope de TOPE_CLAUDE_COMPARACION_MS. Se mandan SOLO los guiones con dudas, sus frases dudosas o faltantes y los
// tramos de transcripción candidatos (±20 s). Schema SIN campos que admitan null (-1 en su lugar: lección del kickoff, la
// gramática compilada tiene un límite) y con $defs. Claude NUNCA pasa un video a Para editar: el e04 sigue siendo de Aylu.
import type { CoberturaGuion, GuionDoc } from '@/lib/edicion/tipos'
import { MAX_TOKENS_COMPARACION, TOPE_CLAUDE_COMPARACION_MS } from '@/lib/edicion/config'
import type { PedidoClaude, RespuestaClaude } from '@/lib/bot/kickoff/claude'
import { tramosCandidatos, type TranscripcionCruce } from './comparar'

export const VERSION_COMPARACION = 'cmp1-2026-10-24'

export const SCHEMA_COMPARACION = {
  type: 'object', additionalProperties: false, required: ['guiones'],
  properties: { guiones: { type: 'array', items: { $ref: '#/$defs/guion' } } },
  $defs: {
    guion: { type: 'object', additionalProperties: false, required: ['ref', 'frases'],
      properties: { ref: { type: 'string' }, frases: { type: 'array', items: { $ref: '#/$defs/frase' } } } },
    frase: { type: 'object', additionalProperties: false, required: ['indice', 'estado', 'archivo_id', 'segundo'],
      properties: { indice: { type: 'integer' }, estado: { type: 'string', enum: ['presente', 'dudosa', 'falta'] }, archivo_id: { type: 'integer' }, segundo: { type: 'integer' } } },
  },
} as const

export const SISTEMA_COMPARACION = `Revisás si un abogado grabó todas las frases de sus guiones para un video corto.
Te paso, por cada guion, las frases que el cruce automático no encontró con seguridad (con su número) y fragmentos de la transcripción automática de los videos crudos (cada uno con el id del archivo y el segundo en que arranca).
Para cada frase decidí:
- "presente": la frase se dijo, aunque la transcripción tenga errores de palabras sueltas, muletillas o una toma repetida;
- "dudosa": se dijo algo parecido pero no se puede asegurar que esté completa o con el mismo sentido;
- "falta": no aparece.
No cuentes como presente una frase que solo se parece por el tema. La voz de otra persona dirigiendo la grabación no cuenta.
Devolvé archivo_id y segundo de la mejor aparición; si falta, archivo_id = -1 y segundo = -1. Respondé solo con el JSON.`

export interface EntradaClaude { guiones: GuionDoc[]; coberturas: CoberturaGuion[]; trans: TranscripcionCruce[] }
export type LlamarClaude = (p: PedidoClaude) => Promise<RespuestaClaude>

/** Lo que se le manda a Claude (exportado para los tests: ni el guion entero ni nada fuera de los tramos). */
export function armarPedido(e: EntradaClaude): { usuario: string; dudas: Map<string, number[]> } {
  const dudas = new Map<string, number[]>()
  const partes: string[] = []
  for (const g of e.guiones) {
    const c = e.coberturas.find(x => x.guion_ref === g.ref)
    if (!c) continue
    const idx = g.frases.map((f, i) => (c.dudosas.includes(f) || c.faltan.includes(f) ? i : -1)).filter(i => i >= 0)
    if (!idx.length) continue
    // Sin fragmentos Claude solo podría decir "falta" (y se pagaría la llamada): ese guion queda como lo dejó el cruce
    const tramos = tramosCandidatos(g, e.trans)
    if (!tramos.length) continue
    dudas.set(g.ref, idx)
    partes.push(`## Guion ${g.ref}\nFrases a revisar:\n${idx.map(i => `${i}. ${g.frases[i]}`).join('\n')}\n\nFragmentos:\n${tramos.map(t => `[archivo ${t.archivo_id}, desde el segundo ${t.desde_s}] ${t.texto}`).join('\n')}`)
  }
  return { usuario: partes.join('\n\n'), dudas }
}

export async function compararConClaude(e: EntradaClaude, claude: LlamarClaude, topeMs = TOPE_CLAUDE_COMPARACION_MS): Promise<{ coberturas: CoberturaGuion[]; tokens: { in: number; out: number }; modelo: string; ajustes: string[] }> {
  const { usuario, dudas } = armarPedido(e)
  if (!dudas.size) return { coberturas: e.coberturas, tokens: { in: 0, out: 0 }, modelo: '', ajustes: [] }
  const r = await claude({ que: 'la comparación con los guiones', sistema: SISTEMA_COMPARACION, usuario, schema: SCHEMA_COMPARACION as unknown as Record<string, unknown>,
    esfuerzo: 'medium', topeMs: Math.min(topeMs, TOPE_CLAUDE_COMPARACION_MS), maxTokens: MAX_TOKENS_COMPARACION })
  const ajustes: string[] = []
  const archivos = new Set(e.trans.map(t => t.archivo_id))
  const salida = (r.json as { guiones?: { ref?: unknown; frases?: { indice?: unknown; estado?: unknown; archivo_id?: unknown; segundo?: unknown }[] }[] })?.guiones ?? []
  const coberturas = e.coberturas.map(c => ({ ...c, dudosas: [...c.dudosas], faltan: [...c.faltan] }))
  for (const g of salida) {
    const ref = typeof g.ref === 'string' ? g.ref : ''
    const pedidas = dudas.get(ref)
    const guion = e.guiones.find(x => x.ref === ref)
    const c = coberturas.find(x => x.guion_ref === ref)
    if (!pedidas || !guion || !c) { ajustes.push(`Claude devolvió un guion que no se pidió (${String(g.ref).slice(0, 20)})`); continue }
    for (const f of g.frases ?? []) {
      const i = Number(f.indice)
      if (!pedidas.includes(i)) { ajustes.push(`${ref}: frase ${String(f.indice)} fuera de lo pedido`); continue }
      const texto = guion.frases[i]
      const estado = f.estado === 'presente' || f.estado === 'dudosa' || f.estado === 'falta' ? f.estado : 'dudosa'
      const archivo = Number(f.archivo_id)
      if (estado !== 'falta' && archivo !== -1 && !archivos.has(archivo)) ajustes.push(`${ref}: archivo ${archivo} desconocido`)
      c.dudosas = c.dudosas.filter(x => x !== texto)
      c.faltan = c.faltan.filter(x => x !== texto)
      if (estado === 'dudosa') c.dudosas.push(texto)
      else if (estado === 'falta') c.faltan.push(texto)
    }
    c.presentes = guion.frases.length - c.dudosas.length - c.faltan.length
    c.estado = c.presentes === guion.frases.length ? 'completo' : 'incompleto'
    c.por = 'claude'
  }
  return { coberturas, tokens: { in: r.usage.input_tokens, out: r.usage.output_tokens }, modelo: r.modelo, ajustes }
}
