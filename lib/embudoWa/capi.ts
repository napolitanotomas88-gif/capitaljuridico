// Evento de conversión del embudo por la API de conversiones de Meta. Mismo event_id que el del píxel del navegador para
// que Meta los deduplique. Solo se llama para leads calificados (A y B).
import 'server-only'
import crypto from 'node:crypto'

const sha = (v: string) => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex')

export const NOMBRE_EVENTO = process.env.EMBUDO_WA_EVENTO?.trim() || 'LeadCalificado'

export type DatosEvento = {
  eventId: string; url: string; ip: string | null; ua: string | null; fbp?: string; fbc?: string
  telefono: string; nombre: string; apellido: string; letra: string
}

export async function enviarEvento(d: DatosEvento): Promise<{ ok: boolean; error: string | null }> {
  const pixel = process.env.EMBUDO_WA_PIXEL_ID?.trim()
  const token = (process.env.EMBUDO_WA_CAPI_TOKEN || process.env.META_ACCESS_TOKEN || '').trim()
  if (!pixel || !token) return { ok: false, error: 'Falta EMBUDO_WA_PIXEL_ID o el token de Meta' }
  const user_data: Record<string, unknown> = {
    ph: [sha(d.telefono.replace(/\D/g, ''))], fn: [sha(d.nombre)], ln: [sha(d.apellido)], external_id: [sha(d.eventId)],
  }
  if (d.ip) user_data.client_ip_address = d.ip
  if (d.ua) user_data.client_user_agent = d.ua
  if (d.fbp) user_data.fbp = d.fbp
  if (d.fbc) user_data.fbc = d.fbc
  const cuerpo = {
    data: [{
      event_name: NOMBRE_EVENTO, event_time: Math.floor(Date.now() / 1000), event_id: d.eventId, action_source: 'website',
      event_source_url: d.url, user_data, custom_data: { lead_scoring: d.letra },
    }],
    ...(process.env.EMBUDO_WA_TEST_CODE?.trim() ? { test_event_code: process.env.EMBUDO_WA_TEST_CODE.trim() } : {}),
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(8000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: String(j?.error?.message ?? `HTTP ${r.status}`).slice(0, 300) }
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'error' }
  }
}
