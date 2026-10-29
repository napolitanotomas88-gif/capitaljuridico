// ── Fathom → cambios de anuncios: tipos y validación del payload ──────────────────────────────
// Fathom manda, al terminar de procesar una grabación ("new meeting content ready"), el objeto Meeting de su API
// pública con la transcripción, el resumen y las tareas. Acá está el SUBCONJUNTO que usamos y su validación a mano:
// el payload viene de afuera (aunque esté firmado), así que todo se acota (largo de strings, cantidad de renglones) y
// lo que no tiene la forma esperada se descarta en vez de romper. Sin zod: la forma es chica y estable.
// También están los tipos del resultado de la extracción (lo que devuelve Claude ya validado) y del registro en Neon.

// ── Payload de Fathom (schema Meeting) ──
export interface RenglonFathom {
  speaker: { display_name: string; matched_calendar_invitee_email: string | null }
  text: string
  timestamp: string                       // 'HH:MM:SS' desde el inicio de la grabación
}
export interface ResumenFathom { template_name: string | null; markdown_formatted: string | null }   // Fathom lo da SIEMPRE en inglés
export interface TareaFathom {
  description: string
  recording_timestamp: string | null
  recording_playback_url: string | null
  assignee: { name: string | null; email: string | null; team: string | null } | null
}
export interface InvitadoFathom { name: string | null; email: string | null; email_domain: string | null; is_external: boolean }
export interface PersonaFathom { name: string | null; email: string | null; email_domain: string | null; team: string | null }

export interface ReunionFathom {
  title: string
  meeting_title: string | null
  recording_id: number
  url: string                             // https://fathom.video/calls/…
  share_url: string | null
  created_at: string | null
  recording_start_time: string | null     // ISO
  recording_end_time: string | null       // ISO
  calendar_invitees_domains_type: string | null   // 'only_internal' | 'one_or_more_external'
  transcript: RenglonFathom[] | null
  default_summary: ResumenFathom | null
  action_items: TareaFathom[] | null
  calendar_invitees: InvitadoFathom[]
  recorded_by: PersonaFathom | null
}

// ── Resultado de la extracción (salida de Claude, ya validada en extraer.ts) ──
export const TIPOS_CAMBIO = [
  'rama', 'ubicacion', 'presupuesto', 'guion', 'apagar', 'prender', 'publico', 'copy_cta', 'destino', 'pago_cuenta', 'accesos', 'lanzamiento', 'otro',
] as const
export type TipoCambio = (typeof TIPOS_CAMBIO)[number]
export const TIPOS_REUNION = ['cliente', 'equipo', 'venta', 'otra'] as const
export type TipoReunion = (typeof TIPOS_REUNION)[number]
export type Certeza = 'confirmado' | 'a_confirmar'

export interface Cambio {
  tipo: TipoCambio
  detalle: string
  cuando: string | null
  certeza: Certeza
  timestamp: string | null                // null = Claude dio uno mal formado o fuera de la llamada: el cambio va SIN link
  cita: string                            // queda en el registro, no va al mensaje
}
export interface ClienteExtraido {
  nombre_escuchado: string
  cliente_crm: string | null              // solo si coincide con un nombre de la lista del CRM (se verifica en extraer.ts)
  cuenta_publicitaria: string | null
  cambios: Cambio[]
  pendientes: string[]
}
export interface Extraccion { tipo_reunion: TipoReunion; resumen_corto: string; clientes: ClienteExtraido[] }

export interface ResultadoExtraccion {
  extraccion: Extraccion
  modelo: string                          // el modelo que respondió (puede ser el de respaldo si hubo fallback)
  usage: { input_tokens: number; output_tokens: number }
  ajustes: string[]                       // qué se corrigió de la salida (timestamps sin link, nombres no verificados…)
}

// ── Contexto del CRM que se le pasa al modelo ──
export interface ClienteConocido { nombre: string; estado: string; email: string; cuentas: string[] }
/** Cómo escribió mal Fathom a un cliente antes (alias.json, generado de la bóveda por scripts/fathom-alias-desde-boveda.mjs). */
export interface AliasCliente { escrito: string[]; cliente: string }
export interface ContextoCRM { clientes: ClienteConocido[]; estado: 'ok' | 'sin_crm'; aviso?: string }

// ── Registro (tabla cj_fathom_anuncios) ──
export type EstadoRegistro = 'procesando' | 'enviado' | 'sin_cambios' | 'omitida' | 'error'

// ── Validación del payload ─────────────────────────────────────────────────────────────────────
const MAX_RENGLONES = 20_000
const MAX_TAREAS = 200
const MAX_INVITADOS = 200
export const RE_TIMESTAMP = /^\d{2,3}:[0-5]\d:[0-5]\d$/

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
/** String acotada (sin caracteres de control salvo salto de línea y tab); null si no es string. */
export function acotar(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const limpio = x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio
}
const textoONull = (x: unknown, max: number): string | null => {
  const t = acotar(x, max)
  return t ? t : null
}

/** URL https válida (normalizada), o null. */
export function urlHttps(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 2000) return null
  try {
    const u = new URL(x)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** fathom.video o un subdominio suyo. */
export function esHostFathom(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'fathom.video' || h.endsWith('.fathom.video')
  } catch {
    return false
  }
}

export type Validacion = { ok: true; reunion: ReunionFathom } | { ok: false; error: string }

export function validarReunion(entrada: unknown): Validacion {
  if (!esObjeto(entrada)) return { ok: false, error: 'el cuerpo no es un objeto JSON' }
  // Por si Fathom alguna vez lo manda envuelto ({ data: Meeting } o { meeting: Meeting }): se desenvuelve solo si adentro está la reunión
  let m: Record<string, unknown> = entrada
  if (!('recording_id' in m)) {
    const adentro = esObjeto(m.data) ? m.data : esObjeto(m.meeting) ? m.meeting : null
    if (adentro && 'recording_id' in adentro) m = adentro
  }
  const id = m.recording_id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'recording_id inválido (tiene que ser un entero positivo)' }
  const url = urlHttps(m.url)
  if (!url) return { ok: false, error: 'url inválida (tiene que ser https)' }
  // Los links de los mensajes salen de acá: solo se aceptan grabaciones de Fathom (nada de links ajenos en #📣-ads)
  if (!esHostFathom(url)) return { ok: false, error: 'url inválida (tiene que ser de fathom.video)' }

  let transcript: RenglonFathom[] | null = null
  if (Array.isArray(m.transcript)) {
    transcript = []
    for (const r of m.transcript.slice(0, MAX_RENGLONES)) {
      if (!esObjeto(r)) continue
      const texto = acotar(r.text, 20_000)
      const ts = typeof r.timestamp === 'string' ? r.timestamp.trim() : ''
      if (!texto || !RE_TIMESTAMP.test(ts)) continue
      const sp = esObjeto(r.speaker) ? r.speaker : {}
      transcript.push({
        speaker: { display_name: acotar(sp.display_name, 120) || 'Sin nombre', matched_calendar_invitee_email: textoONull(sp.matched_calendar_invitee_email, 200) },
        text: texto,
        timestamp: ts,
      })
    }
  }

  const resumen = esObjeto(m.default_summary)
    ? { template_name: textoONull(m.default_summary.template_name, 120), markdown_formatted: textoONull(m.default_summary.markdown_formatted, 60_000) }
    : null

  const tareas: TareaFathom[] | null = Array.isArray(m.action_items)
    ? m.action_items.slice(0, MAX_TAREAS).filter(esObjeto).map(t => {
        const a = esObjeto(t.assignee) ? t.assignee : null
        const ts = typeof t.recording_timestamp === 'string' && RE_TIMESTAMP.test(t.recording_timestamp.trim()) ? t.recording_timestamp.trim() : null
        return {
          description: acotar(t.description, 1000) ?? '',
          recording_timestamp: ts,
          recording_playback_url: urlHttps(t.recording_playback_url),
          assignee: a ? { name: textoONull(a.name, 120), email: textoONull(a.email, 200), team: textoONull(a.team, 120) } : null,
        }
      }).filter(t => t.description)
    : null

  const invitados: InvitadoFathom[] = Array.isArray(m.calendar_invitees)
    ? m.calendar_invitees.slice(0, MAX_INVITADOS).filter(esObjeto).map(i => ({
        name: textoONull(i.name, 120), email: textoONull(i.email, 200), email_domain: textoONull(i.email_domain, 120), is_external: i.is_external === true,
      }))
    : []

  const rb = esObjeto(m.recorded_by) ? m.recorded_by : null
  const titulo = acotar(m.title, 300) || acotar(m.meeting_title, 300) || `Grabación ${id}`

  return {
    ok: true,
    reunion: {
      title: titulo,
      meeting_title: textoONull(m.meeting_title, 300),
      recording_id: id,
      url,
      share_url: urlHttps(m.share_url),
      created_at: textoONull(m.created_at, 40),
      recording_start_time: textoONull(m.recording_start_time, 40),
      recording_end_time: textoONull(m.recording_end_time, 40),
      calendar_invitees_domains_type: textoONull(m.calendar_invitees_domains_type, 40),
      transcript,
      default_summary: resumen,
      action_items: tareas,
      calendar_invitees: invitados,
      recorded_by: rb ? { name: textoONull(rb.name, 120), email: textoONull(rb.email, 200), email_domain: textoONull(rb.email_domain, 120), team: textoONull(rb.team, 120) } : null,
    },
  }
}
