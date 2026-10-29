// ── Análisis con Claude: setting y llamada → datos estructurados ──────────────────────────────
// Regla de la clase: la IA DESCRIBE y EXTRAE, nunca concluye. Por eso la salida es un JSON con campos cerrados
// (salida estructurada con json_schema) y los porcentajes del reporte los calcula reporte.ts, no el modelo.
// Mismo patrón que lib/fathomAnuncios/extraer.ts: streaming, fallback del servidor, stop_reason antes de leer.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { ARQUETIPOS, DESCRIPCION_ARQUETIPOS, type Angulo } from './catalogo'
import type { AnalisisLlamada, AnalisisSetting } from './modelo'

const MODELO_POR_DEFECTO = 'claude-opus-5-5'
const modelo = () => process.env.TRAZ_MODELO?.trim() || MODELO_POR_DEFECTO
const TOPE_MS = 200_000

const textoONull = { type: ['string', 'null'] }
const fechaONull = { type: ['string', 'null'], description: 'YYYY-MM-DD o null' }

async function claudeJSON<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('falta ANTHROPIC_API_KEY')
  const client = new Anthropic({ maxRetries: 1, timeout: TOPE_MS })
  const stream = client.beta.messages.stream(
    {
      model: modelo(),
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    },
    { signal: AbortSignal.timeout(TOPE_MS) },
  )
  const msg = await stream.finalMessage()
  if (msg.stop_reason === 'refusal') throw new Error('Claude rechazó el pedido')
  if (msg.stop_reason === 'max_tokens') throw new Error('la respuesta de Claude se cortó por max_tokens')
  const desde = msg.content.map((b) => b.type).lastIndexOf('fallback') + 1
  const texto = msg.content.slice(desde).map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  try {
    return JSON.parse(texto) as T
  } catch {
    throw new Error('la salida de Claude no es JSON válido')
  }
}

const lineasAngulos = (angulos: Angulo[]) =>
  angulos.map((a) => `- ${a.id}: ${a.nombre}${a.descartado ? ' (descartado)' : ''} — ${a.descripcion}`).join('\n')

// ── Setting ───────────────────────────────────────────────────────────────────────────────
const SCHEMA_SETTING = {
  type: 'object', additionalProperties: false,
  required: ['situacion', 'dolor', 'objetivo', 'origen', 'piezas', 'pieza_gatillo', 'primera_interaccion', 'fecha_agenda', 'ciclo_dias', 'seguimientos', 'material_enviado', 'caso_exito_enviado'],
  properties: {
    situacion: textoONull, dolor: textoONull, objetivo: textoONull,
    origen: { type: 'string', enum: ['inbound_contenido', 'outbound_historias', 'nuevo_seguidor', 'anuncio', 'otro'] },
    piezas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['etiqueta', 'tipo', 'angulo', 'fecha'],
        properties: {
          etiqueta: { type: 'string' },
          tipo: { type: 'string', enum: ['reel', 'carrusel', 'historia', 'anuncio', 'otro'] },
          angulo: textoONull, fecha: fechaONull,
        },
      },
    },
    pieza_gatillo: textoONull, primera_interaccion: fechaONull, fecha_agenda: fechaONull,
    ciclo_dias: { type: ['integer', 'null'] }, seguimientos: { type: ['integer', 'null'] },
    material_enviado: { type: 'array', items: { type: 'string' } }, caso_exito_enviado: textoONull,
  },
}

const SISTEMA_SETTING = (angulos: Angulo[], conocidas: string) => `Sos analista de datos de setting de Capital Jurídico (programa para abogados). Recibís el resumen que generó la botonera de ManyChat, las etiquetas del contacto y, a veces, la transcripción del chat. Tu trabajo es EXTRAER datos, no opinar.

Reglas:
- Nada de conclusiones, recomendaciones ni adjetivos. Solo lo que dicen los datos. Si un dato no está, null.
- "piezas": SOLO piezas de contenido que el contacto consumió, sacadas de las ETIQUETAS (reels, carruseles, historias, anuncios). Una por etiqueta, con la etiqueta EXACTA como figura. No incluyas etiquetas operativas (ASIGNADO, Lead - <Mes>, Reel - <Mes>, Carrusel - <Mes>, Historias - <Mes>, Boton recurso, AGENDADO, booqueado, seteando, calificado, inbound, etc.). Fecha = la de la etiqueta si la trae (DD/MM → año de la conversación), si no null.
- "angulo" de cada pieza: el id del catálogo que mejor describe de qué habla la pieza según su nombre; null si no se puede saber. Si la pieza ya tiene ángulo asignado (lista "ya clasificadas"), usá ese.
- "pieza_gatillo": la etiqueta (exacta, una de "piezas") del último contenido orgánico que consumió antes de agendar. Si solo hay "Nuevo seguidor" sin piezas → null y origen "nuevo_seguidor".
- "origen": outbound_historias si el primer contacto fue la cuenta respondiendo su historia ("Respondiste a su historia"); inbound_contenido si escribió por una pieza; nuevo_seguidor si entró por la bienvenida a nuevos seguidores / Follow Me Ads; anuncio si vino de un anuncio pago.
- "ciclo_dias": días entre la primera interacción y la agenda, con las fechas del chat. "seguimientos": cantidad de mensajes proactivos del setter para que agende (número entero).

Catálogo de ángulos (id: nombre — descripción):
${lineasAngulos(angulos)}

Piezas ya clasificadas (etiqueta → ángulo):
${conocidas || '(ninguna)'}`

export async function analizarSetting(entrada: { resumen: string; etiquetas: string[]; campos: Record<string, unknown>; transcript: string; nombre: string }, angulos: Angulo[], conocidas: Map<string, string | null>): Promise<AnalisisSetting> {
  const lista = entrada.etiquetas.filter((e) => conocidas.has(e)).map((e) => `- ${e} → ${conocidas.get(e) ?? 'sin ángulo'}`).join('\n')
  const campos = Object.entries(entrada.campos ?? {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${String(v).slice(0, 300)}`).join('\n')
  const user = `Contacto: ${entrada.nombre}

=== ETIQUETAS DE MANYCHAT ===
${entrada.etiquetas.join('\n') || '(sin etiquetas)'}

=== CAMPOS PERSONALIZADOS ===
${campos || '(sin campos)'}

=== RESUMEN DE LA BOTONERA ===
${entrada.resumen || '(sin resumen)'}

=== TRANSCRIPCIÓN DEL CHAT ===
${entrada.transcript ? entrada.transcript.slice(0, 120_000) : '(no enviada)'}`
  const r = await claudeJSON<AnalisisSetting>(SISTEMA_SETTING(angulos, lista), user, SCHEMA_SETTING)
  const ids = new Set(angulos.map((a) => a.id))
  const etiquetas = new Set(entrada.etiquetas)
  // Solo etiquetas reales y ángulos del catálogo: lo inventado se descarta
  r.piezas = (r.piezas ?? []).filter((p) => etiquetas.has(p.etiqueta)).map((p) => ({ ...p, angulo: p.angulo && ids.has(p.angulo) ? p.angulo : null }))
  if (r.pieza_gatillo && !r.piezas.some((p) => p.etiqueta === r.pieza_gatillo)) r.pieza_gatillo = null
  if (r.ciclo_dias != null && (r.ciclo_dias < 0 || r.ciclo_dias > 3650)) r.ciclo_dias = null
  if (r.seguimientos != null && (r.seguimientos < 0 || r.seguimientos > 200)) r.seguimientos = null
  return r
}

// ── Llamada ───────────────────────────────────────────────────────────────────────────────
const SCHEMA_LLAMADA = {
  type: 'object', additionalProperties: false,
  required: ['meta', 'situacion_actual', 'oferta_propuesta', 'motivo_decision', 'habilidad_closer', 'como_nos_conocio', 'contenido_mencionado', 'dolores', 'objeciones', 'arquetipo'],
  properties: {
    meta: textoONull, situacion_actual: textoONull, oferta_propuesta: textoONull, motivo_decision: textoONull,
    habilidad_closer: textoONull, como_nos_conocio: textoONull,
    contenido_mencionado: { type: 'array', items: { type: 'string' } },
    dolores: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['tema', 'angulo', 'cita'],
        properties: { tema: { type: 'string' }, angulo: textoONull, cita: { type: 'string' } },
      },
    },
    objeciones: { type: 'array', items: { type: 'string' } },
    arquetipo: { type: 'string', enum: [...ARQUETIPOS] },
  },
}

const SISTEMA_LLAMADA = (angulos: Angulo[]) => `Sos analista de llamadas de venta de Capital Jurídico (programa para abogados). Recibís el resumen y/o la transcripción de Fathom de una llamada que terminó en venta. EXTRAÉ datos, no opines.

Reglas:
- Nada de conclusiones ni recomendaciones. Descripciones cortas (una o dos líneas) con lo que dijo el lead. Si no está, null.
- "dolores": cada dolor que el LEAD verbalizó. "tema" = el dolor en 3 a 8 palabras, redactado de forma genérica para poder agruparlo con otras llamadas (ej. "Dependencia de referidos", "Muchos mensajes de curiosos que no pagan"). "angulo" = id del catálogo si el dolor corresponde a uno; null si es un tema que el catálogo no cubre (esos son los ángulos NUEVOS que buscamos). "cita" = frase textual corta del lead.
- "contenido_mencionado": piezas, videos, casos o anuncios que el lead dice haber visto. "como_nos_conocio": lo que cuenta él.
- "habilidad_closer": qué hizo el closer para cerrar (descriptivo, sin calificar).
- "arquetipo" según:
${DESCRIPCION_ARQUETIPOS}
Si no alcanza la información, "sin datos".

Catálogo de ángulos (id: nombre — descripción):
${lineasAngulos(angulos)}`

export async function analizarLlamada(entrada: { nombre: string; resumen: string; transcript: string }, angulos: Angulo[]): Promise<AnalisisLlamada> {
  const user = `Lead: ${entrada.nombre}

=== RESUMEN DE FATHOM ===
${entrada.resumen || '(sin resumen)'}

=== TRANSCRIPCIÓN ===
${entrada.transcript ? entrada.transcript.slice(0, 400_000) : '(no disponible)'}`
  const r = await claudeJSON<AnalisisLlamada>(SISTEMA_LLAMADA(angulos), user, SCHEMA_LLAMADA)
  const ids = new Set(angulos.map((a) => a.id))
  r.dolores = (r.dolores ?? []).map((d) => ({ ...d, angulo: d.angulo && ids.has(d.angulo) ? d.angulo : null }))
  if (!(ARQUETIPOS as readonly string[]).includes(r.arquetipo)) r.arquetipo = 'sin datos'
  return r
}
