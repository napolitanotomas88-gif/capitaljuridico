// ── Habitantes de la zona de un cliente (para la regla de estructura de plan.ts) ─────────────────────
// Tomás (28/9): "preguntarle a Claude cuál es el público estimado que cree que habría en la zona". Con la zona de la
// ficha de kickoff (descripción, lugares y lo leído del mapa) Claude suma los habitantes de lo que queda adentro, con el
// último censo. Es una estimación para decidir la estructura, no un dato para mostrarle al cliente. Usa el cliente de
// Claude del bot de kickoff (llamarClaude: mismo modelo y clave), con esfuerzo bajo.
import { llamarClaude } from '@/lib/bot/kickoff/claude'
import type { ZonaFicha } from '@/lib/bot/kickoff/tipos'

export interface EstimacionHabitantes { habitantes: number; minimo: number; maximo: number; base: string; confianza: 'alta' | 'media' | 'baja'; etiqueta: string }

const SISTEMA = `Estimás cuántos habitantes viven en la zona donde un estudio de abogados va a mostrar anuncios de Meta. Te paso la zona tal como se acordó en la llamada (descripción, lugares nombrados, radio si hay) y lo que se leyó del mapa marcado en pantalla. Sumá la población de las localidades y partidos que quedan ADENTRO de la zona (no la de toda la provincia si la zona es un recorte), con el último censo disponible (en Argentina, el Censo 2022 del INDEC). Si la zona es un radio alrededor de un punto, estimá la población dentro de ese radio. Si un nombre está marcado "(de oído, verificar)", tomalo como la localidad más probable de esa provincia. Devolvé tu mejor estimación con un rango, en qué te basaste (una frase, con las cifras de las localidades principales) y una etiqueta corta de la zona para el nombre de los conjuntos (por ejemplo "Gran San Juan", "Córdoba capital 40 km", "San Miguel 10 km"). Respondé en español.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['habitantes', 'minimo', 'maximo', 'base', 'confianza', 'etiqueta'],
  properties: {
    habitantes: { type: 'integer' },
    minimo: { type: 'integer' },
    maximo: { type: 'integer' },
    base: { type: 'string' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    etiqueta: { type: 'string' },
  },
}

export function textoZona(z: ZonaFicha): string {
  const m = z.mapa
  return [
    `País: ${z.pais ?? 'sin dato'}`,
    `Descripción: ${z.descripcion}`,
    z.lugares.length ? `Lugares nombrados: ${z.lugares.join('; ')}` : '',
    z.radio_km ? `Radio: ${z.radio_km} km` : '',
    m ? `Mapa leído del video: lugares ${m.lugares.join('; ') || '—'}; incluidas ${m.incluidas.join('; ') || '—'}; límites ${m.limites || '—'}${m.radio_km ? `; radio ${m.radio_km} km` : ''}` : '',
  ].filter(Boolean).join('\n')
}

export async function estimarHabitantes(z: ZonaFicha, topeMs = 60_000): Promise<EstimacionHabitantes> {
  const r = await llamarClaude({ que: 'los habitantes de la zona', sistema: SISTEMA, usuario: `<zona>\n${textoZona(z)}\n</zona>`, schema: SCHEMA, esfuerzo: 'low', topeMs, maxTokens: 4_000 })
  const x = r.json as EstimacionHabitantes
  if (!Number.isFinite(x?.habitantes) || x.habitantes <= 0) throw new Error('Claude no devolvió una cantidad de habitantes válida')
  return { ...x, etiqueta: String(x.etiqueta ?? '').slice(0, 40) }
}
