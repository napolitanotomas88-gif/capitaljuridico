// ── Extracción de los cambios de anuncios con Claude ─────────────────────────────────────────
// Una sola llamada a la API de Claude (Opus 5.5 por defecto) con salida estructurada: el JSON Schema de SCHEMA_SALIDA
// obliga a la forma, pero igual se valida todo a la vuelta (validarSalida) porque lo que sale de acá le llega directo a
// Valentino por Discord: un cambio inventado se hace mal en la cuenta de un cliente.
//   · thinking adaptativo (en Opus 5.5 es lo mismo que omitirlo; "disabled" o budget_tokens dan 400), esfuerzo "high"
//     (FATHOM_ANUNCIOS_ESFUERZO), max_tokens 32000, streaming (.stream + finalMessage) para no cortar por timeout.
//   · Fallback del servidor ante un rechazo de los clasificadores: fallbacks "default" con la beta
//     server-side-fallback-2026-07-01 (por eso va por client.beta.messages). Si aun así rechaza → error con la categoría.
//   · Se mira stop_reason ANTES de leer el contenido: refusal y max_tokens son errores, nunca un resultado a medias.
//   · Tope por intento: el que pasa procesar.ts (deadline − ahora − 30 s de margen para mandar y avisar, nunca más de
//     TOPE_CLAUDE_MS). Sin reintentos del SDK (maxRetries 0): el único reintento lo decide procesar.ts, que sabe cuánto
//     tiempo queda. Los errores pasajeros (429, 5xx, 529 overloaded, error a mitad del stream, conexión) salen como
//     ErrorTransitorio; un rechazo, max_tokens o un JSON roto, no.
import Anthropic from '@anthropic-ai/sdk'
import { crearClienteClaude, viaMac } from '@/lib/ia/cliente'
import { ErrorTransitorio } from './errores'
import { PROMPT_SISTEMA } from './prompt'
import { RE_TIMESTAMP, TIPOS_CAMBIO, TIPOS_REUNION, acotar } from './tipos'
import type { AliasCliente, Cambio, ClienteConocido, ClienteExtraido, Extraccion, ResultadoExtraccion, ReunionFathom, TipoCambio, TipoReunion } from './tipos'
import { fechaLargaAR, segundos, type Transcripcion } from './transcripcion'
import { lineasClientes, normNombre } from './contexto'

export const MODELO_POR_DEFECTO = 'claude-opus-5-5'
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Esfuerzo = (typeof ESFUERZOS)[number]
export const TOPE_CLAUDE_MS = 240_000           // por intento, como máximo

// ── JSON Schema de la salida (additionalProperties false y todo en required, como pide la salida estructurada) ──
const textoONull = { type: ['string', 'null'] }
export const SCHEMA_SALIDA = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo_reunion', 'resumen_corto', 'clientes'],
  properties: {
    tipo_reunion: { type: 'string', enum: [...TIPOS_REUNION] },
    resumen_corto: { type: 'string' },
    clientes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre_escuchado', 'cliente_crm', 'cuenta_publicitaria', 'cambios', 'pendientes'],
        properties: {
          nombre_escuchado: { type: 'string' },
          cliente_crm: textoONull,
          cuenta_publicitaria: textoONull,
          cambios: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['tipo', 'detalle', 'cuando', 'certeza', 'timestamp', 'cita'],
              properties: {
                tipo: { type: 'string', enum: [...TIPOS_CAMBIO] },
                detalle: { type: 'string' },
                cuando: textoONull,
                certeza: { type: 'string', enum: ['confirmado', 'a_confirmar'] },
                timestamp: { type: 'string' },
                cita: { type: 'string' },
              },
            },
          },
          pendientes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

/** Alias de la bóveda (lib/fathomAnuncios/alias.json): una línea por cliente, "escrito / escrito → cliente". */
export function lineasAlias(alias: AliasCliente[]): string[] {
  const limpio = (x: string) => x.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
  const lineas = alias
    .map(a => ({ escrito: a.escrito.map(limpio).filter(Boolean), cliente: limpio(a.cliente) }))
    .filter(a => a.escrito.length && a.cliente)
    .map(a => `${a.escrito.join(' / ')} → ${a.cliente}`)
  return lineas.length ? ['Alias (así lo escribió Fathom antes → cliente):', ...lineas] : []
}

// ── Mensaje de usuario: todo lo variable de la llamada, cada bloque con su etiqueta ──
// La fecha va con día de la semana y año ("lunes 12/10/2026 18:32"): el prompt pide pasar las fechas relativas a día/mes.
export function mensajeUsuario(r: ReunionFathom, clientes: ClienteConocido[], tr: Transcripcion, alias: AliasCliente[] = []): string {
  const invitados = r.calendar_invitees.length
    ? r.calendar_invitees.map(i => `${i.name ?? 'Sin nombre'}${i.email ? ` <${i.email}>` : ''} (${i.is_external ? 'externo' : 'interno'})`).join(', ')
    : '(sin invitados)'
  const tareas = r.action_items?.length
    ? r.action_items.map(t => `- ${t.recording_timestamp ? `[${t.recording_timestamp}] ` : ''}${t.description.replace(/\s+/g, ' ')}${t.assignee?.name ? ` — ${t.assignee.name}` : ''}`).join('\n')
    : '(sin tareas)'
  return [
    '<reunion>',
    `Título: ${r.title}${r.meeting_title && r.meeting_title !== r.title ? ` (evento: ${r.meeting_title})` : ''}`,
    `Fecha: ${fechaLargaAR(r.recording_start_time) ?? fechaLargaAR(r.created_at) ?? 'sin fecha'} (hora de Buenos Aires)`,
    `Grabó: ${r.recorded_by?.name ?? 'sin dato'}`,
    `Invitados: ${invitados}`,
    `Tipo de invitados: ${r.calendar_invitees_domains_type ?? 'sin dato'}`,
    '</reunion>',
    '<clientes_conocidos>',
    lineasClientes(clientes),
    ...lineasAlias(alias),
    '</clientes_conocidos>',
    '<resumen_fathom>',
    r.default_summary?.markdown_formatted ?? '(sin resumen)',
    '</resumen_fathom>',
    '<tareas_fathom>',
    tareas,
    '</tareas_fathom>',
    '<transcripcion>',
    tr.texto || '(sin transcripción)',
    '</transcripcion>',
  ].join('\n')
}

// ── Validación de la salida ──
const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const MAX_CLIENTES = 30, MAX_CAMBIOS = 40, MAX_PENDIENTES = 20

export interface RangoTranscripcion { desde: number | null; hasta: number | null }

/**
 * Valida y acota la salida del modelo. Correcciones (quedan en "ajustes"):
 *   · timestamp mal formado o fuera de la transcripción → el cambio queda, pero SIN link (no se busca "el más cercano");
 *   · cliente_crm que no está en la lista del CRM → null (sale como "nombre sin verificar"); sin lista, siempre null;
 *   · cuenta_publicitaria que no figura en la lista → null;
 *   · cambios sin detalle y pendientes vacíos se descartan; textos largos se recortan.
 */
export function validarSalida(json: unknown, rango: RangoTranscripcion, conocidos: ClienteConocido[]): { extraccion: Extraccion; ajustes: string[] } {
  if (!esObj(json)) throw new Error('la salida de Claude no es un objeto JSON')
  const ajustes: string[] = []
  const tipoReunion: TipoReunion = (TIPOS_REUNION as readonly string[]).includes(json.tipo_reunion as string) ? (json.tipo_reunion as TipoReunion) : 'otra'
  const porNombre = new Map(conocidos.map(c => [normNombre(c.nombre), c]))
  const cuentasConocidas = new Map(conocidos.flatMap(c => c.cuentas.map(cu => [normNombre(cu), cu] as const)))
  const clientes: ClienteExtraido[] = []
  for (const c of (Array.isArray(json.clientes) ? json.clientes : []).slice(0, MAX_CLIENTES)) {
    if (!esObj(c)) continue
    const escuchado = acotar(c.nombre_escuchado, 120) || 'Sin nombre'
    let crm: string | null = acotar(c.cliente_crm, 120) || null
    if (crm) {
      const hit = porNombre.get(normNombre(crm))
      if (hit) crm = hit.nombre
      else { ajustes.push(`cliente_crm "${crm}" no está en la lista del CRM: se manda como sin verificar`); crm = null }
    }
    let cuenta: string | null = acotar(c.cuenta_publicitaria, 120) || null
    if (cuenta) {
      const hit = cuentasConocidas.get(normNombre(cuenta))
      if (hit) cuenta = hit
      else { ajustes.push(`cuenta "${cuenta}" no figura en la lista: se omite`); cuenta = null }
    }
    const cambios: Cambio[] = []
    for (const x of (Array.isArray(c.cambios) ? c.cambios : []).slice(0, MAX_CAMBIOS)) {
      if (!esObj(x)) continue
      const detalle = acotar(x.detalle, 600)
      if (!detalle) { ajustes.push('cambio sin detalle descartado'); continue }
      const ts = typeof x.timestamp === 'string' ? x.timestamp.trim() : ''
      const s = RE_TIMESTAMP.test(ts) ? segundos(ts) : null
      const enRango = s !== null && rango.desde !== null && rango.hasta !== null && s >= rango.desde && s <= rango.hasta
      if (!enRango) ajustes.push(`timestamp "${ts.slice(0, 20)}" inválido o fuera de la llamada: el cambio va sin link`)
      cambios.push({
        tipo: (TIPOS_CAMBIO as readonly string[]).includes(x.tipo as string) ? (x.tipo as TipoCambio) : 'otro',
        detalle,
        cuando: acotar(x.cuando, 120) || null,
        certeza: x.certeza === 'confirmado' ? 'confirmado' : 'a_confirmar',
        timestamp: enRango ? ts : null,
        cita: acotar(x.cita, 300) ?? '',
      })
    }
    const pendientes = (Array.isArray(c.pendientes) ? c.pendientes : []).slice(0, MAX_PENDIENTES)
      .map(p => acotar(p, 400)).filter((p): p is string => !!p)
    clientes.push({ nombre_escuchado: escuchado, cliente_crm: crm, cuenta_publicitaria: cuenta, cambios, pendientes })
  }
  return { extraccion: { tipo_reunion: tipoReunion, resumen_corto: acotar(json.resumen_corto, 200) ?? '', clientes }, ajustes }
}

export interface EntradaExtraccion { reunion: ReunionFathom; transcripcion: Transcripcion; clientes: ClienteConocido[]; alias: AliasCliente[] }

function esfuerzo(): Esfuerzo {
  const e = (process.env.FATHOM_ANUNCIOS_ESFUERZO ?? '').trim()
  return (ESFUERZOS as readonly string[]).includes(e) ? (e as Esfuerzo) : 'high'
}
export const modeloConfigurado = (): string => process.env.FATHOM_ANUNCIOS_MODELO?.trim() || MODELO_POR_DEFECTO

/** ¿Vale la pena reintentar este error de la API? 429, 5xx (529 = overloaded), error a mitad del stream o conexión. */
function esPasajero(e: unknown): boolean {
  if (e instanceof Anthropic.APIUserAbortError) return false
  if (e instanceof Anthropic.APIConnectionError) return true          // incluye APIConnectionTimeoutError
  if (e instanceof Anthropic.APIError) {
    if (e.status === 429 || (typeof e.status === 'number' && e.status >= 500)) return true
    // Error que llega dentro del stream (sin status): overloaded_error, api_error, rate_limit_error
    return e.status === undefined && /overloaded|api_error|rate_limit/i.test(String(e.type ?? e.message))
  }
  return false
}

/** Mensaje de un error de la API, corto (se guarda en el registro y va al aviso; motivoDe además limpia URLs y claves). */
const motivoApi = (e: unknown): string => {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude no respondió a tiempo (timeout de conexión)'
  if (e instanceof Anthropic.APIConnectionError) return 'no se pudo conectar con Claude'
  if (e instanceof Anthropic.APIError) {
    const cuerpo = e.error as { error?: { message?: unknown } } | undefined
    const detalle = typeof cuerpo?.error?.message === 'string' ? cuerpo.error.message.replace(/\s+/g, ' ').slice(0, 150) : ''
    return `Claude respondió ${e.status ?? 'con error'}${e.type ? ` (${e.type})` : ''}${detalle ? `: ${detalle}` : ''}`
  }
  return (e as Error)?.message ?? String(e)
}

export async function extraerCambios(e: EntradaExtraccion, topeMs: number = TOPE_CLAUDE_MS): Promise<ResultadoExtraccion> {
  if (!viaMac() && !process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('falta ANTHROPIC_API_KEY')
  const tope = Math.max(1_000, Math.min(TOPE_CLAUDE_MS, Math.round(topeMs)))
  const client = crearClienteClaude({ maxRetries: 0, timeout: tope, origen: 'fathom-anuncios' })
  const corte = AbortSignal.timeout(tope)
  let msg: Anthropic.Beta.Messages.BetaMessage
  try {
    const stream = client.beta.messages.stream(
      {
        model: modeloConfigurado(),
        max_tokens: 32_000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: esfuerzo(), format: { type: 'json_schema', schema: SCHEMA_SALIDA } },
        system: PROMPT_SISTEMA,
        messages: [{ role: 'user', content: mensajeUsuario(e.reunion, e.clientes, e.transcripcion, e.alias) }],
      },
      { signal: corte },
    )
    msg = await stream.finalMessage()
  } catch (err) {
    if (corte.aborted) throw new ErrorTransitorio(`Claude no terminó en ${Math.round(tope / 1000)} s`)
    if (esPasajero(err)) throw new ErrorTransitorio(motivoApi(err))
    throw err instanceof Anthropic.APIError ? new Error(motivoApi(err)) : err
  }

  if (msg.stop_reason === 'refusal') throw new Error(`Claude rechazó la llamada (categoría ${msg.stop_details?.category ?? 'sin categoría'})`)
  if (msg.stop_reason === 'max_tokens') throw new Error('la respuesta de Claude se cortó por max_tokens')
  if (msg.stop_reason !== 'end_turn') throw new Error(`Claude terminó de forma inesperada (${msg.stop_reason ?? 'sin stop_reason'})`)

  // Si hubo fallback a mitad de respuesta, el texto del modelo que rechazó queda antes del bloque "fallback": se toma solo lo de después
  const desde = msg.content.map(b => b.type).lastIndexOf('fallback') + 1
  const texto = msg.content.slice(desde).map(b => (b.type === 'text' ? b.text : '')).join('').trim()
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    throw new Error('la salida de Claude no es JSON válido')
  }
  const { extraccion, ajustes } = validarSalida(json, { desde: e.transcripcion.desde, hasta: e.transcripcion.hasta }, e.clientes)
  return {
    extraccion,
    ajustes,
    modelo: msg.model,
    usage: { input_tokens: msg.usage.input_tokens ?? 0, output_tokens: msg.usage.output_tokens ?? 0 },
  }
}
