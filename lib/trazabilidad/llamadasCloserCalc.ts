// ── Llamadas de closers: lo que devuelve Fathom → fila, y su cruce con el CRM (puro: se prueba sin red) ───────────────
// Cada closer graba en su propia cuenta de Fathom; la API (/meetings) trae las reuniones de esa cuenta. Acá se normaliza
// cada reunión y se busca su fila del CRM de ventas: primero por el mail de un invitado externo, después por nombre
// (2 palabras en común) con la fecha de la llamada a ±3 días.
import { normEmail, normNombre, type AgendaLigera } from './modelo'

export interface InvitadoLlamada { nombre: string; email: string; externo: boolean }
export interface LlamadaCloser {
  recordingId: number
  closer: string
  titulo: string
  inicio: string | null        // ISO
  duracionS: number | null
  url: string
  invitados: InvitadoLlamada[]
  externa: boolean             // hay al menos un invitado de afuera del equipo
  resumenFathom: string
}

const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)

/** Reunión de la API de Fathom → llamada. `closer` es el dueño de la cuenta (el nombre de su variable de entorno). */
export function llamadaDeApi(m: Record<string, unknown>, closer: string): LlamadaCloser {
  const inicio = iso(m.recording_start_time) ?? iso(m.scheduled_start_time) ?? iso(m.created_at)
  const fin = iso(m.recording_end_time) ?? iso(m.scheduled_end_time)
  const invitados = ((m.calendar_invitees as Record<string, unknown>[] | undefined) ?? []).map((i) => ({
    nombre: String(i.name ?? '').trim(), email: normEmail(String(i.email ?? '')), externo: i.is_external === true,
  }))
  const resumen = (m.default_summary as { markdown_formatted?: string | null } | null | undefined)?.markdown_formatted ?? ''
  return {
    recordingId: Number(m.recording_id), closer, titulo: String(m.title ?? m.meeting_title ?? '').trim(), inicio,
    duracionS: inicio && fin ? Math.max(0, Math.round((Date.parse(fin) - Date.parse(inicio)) / 1000)) : null,
    url: String(m.share_url || m.url || ''), invitados,
    externa: m.calendar_invitees_domains_type === 'one_or_more_external' || invitados.some((i) => i.externo),
    resumenFathom: resumen,
  }
}

/** Nombre del lead: el primer invitado externo con nombre; si no hay, lo que el título tiene antes de " y " / " x " */
export function leadDeLlamada(l: Pick<LlamadaCloser, 'invitados' | 'titulo'>): string {
  const ext = l.invitados.find((i) => i.externo && i.nombre) ?? l.invitados.find((i) => i.externo)
  if (ext?.nombre) return ext.nombre
  if (ext?.email) return ext.email
  return l.titulo.split(/\s+(?:y|x|&|-|\|)\s+/i)[0] ?? l.titulo
}

const dias = (a: string, b: string) => Math.abs(Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / 86_400_000

/** Fila del CRM de esta llamada, o null si no hay una segura */
export function agendaDeLlamada(l: Pick<LlamadaCloser, 'invitados' | 'titulo' | 'inicio'>, agendas: AgendaLigera[]): AgendaLigera | null {
  if (!l.inicio) return null
  const cerca = agendas.filter((a) => a.fecha && dias(a.fecha, l.inicio!) <= 3)
  const mails = new Set(l.invitados.filter((i) => i.externo && i.email).map((i) => i.email))
  const porMail = cerca.filter((a) => a.email && mails.has(normEmail(a.email)))
  if (porMail.length) return porMail.sort((x, y) => dias(x.fecha, l.inicio!) - dias(y.fecha, l.inicio!))[0]
  const palabras = new Set([leadDeLlamada({ invitados: l.invitados, titulo: l.titulo }), ...l.invitados.filter((i) => i.externo).map((i) => i.nombre)]
    .flatMap((n) => normNombre(n).split(' ')).filter((p) => p.length > 2))
  const porNombre = cerca.filter((a) => normNombre(a.nombre).split(' ').filter((p) => p.length > 2 && palabras.has(p)).length >= 2)
  if (porNombre.length === 1) return porNombre[0]
  if (porNombre.length > 1) return porNombre.sort((x, y) => dias(x.fecha, l.inicio!) - dias(y.fecha, l.inicio!))[0]
  return null
}

export const duracionTexto = (s: number | null) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`)
