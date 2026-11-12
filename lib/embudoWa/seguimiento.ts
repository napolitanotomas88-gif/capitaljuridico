// Seguimiento del embudo: si a los X minutos el lead no le escribió al setter por WhatsApp, 2Chat le manda UN mensaje
// desde el número del setter. Apagado salvo EMBUDO_WA_SEGUIMIENTO=1 (pedido explícito de Gero, 12/11/2026).
// Si ya hay CUALQUIER mensaje en esa conversación (lo escribió el lead o el setter), no se manda nada.
import 'server-only'
import { neon } from '@neondatabase/serverless'

const API = 'https://api.p.2chat.io/open/whatsapp'
const sql = () => neon(process.env.DATABASE_URL!.trim())

export const seguimientoEncendido = () =>
  process.env.EMBUDO_WA_SEGUIMIENTO?.trim() === '1' && !!process.env.TWOCHAT_API_KEY?.trim() && !!process.env.EMBUDO_WA_WHATSAPP?.trim()

export const esperaSegundos = () => Math.min(270, Math.max(30, Number(process.env.EMBUDO_WA_ESPERA_SEG) || 180))

export function textoSeguimiento(nombre: string): string {
  const n = nombre.trim().split(' ')[0]
  return `Hola${n ? ' ' + n : ''}! Vi que completaste tus datos para mejorar la captación de clientes en tu estudio jurídico. Contame, ¿ejercés de forma independiente o en relación de dependencia?`
}

async function llamar(path: string, init?: RequestInit) {
  const r = await fetch(API + path, {
    ...init, signal: AbortSignal.timeout(15000),
    headers: { 'X-User-API-Key': process.env.TWOCHAT_API_KEY!.trim(), 'content-type': 'application/json' },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.success === false) throw new Error(String(j?.message ?? j?.error ?? `HTTP ${r.status}`).slice(0, 200))
  return j
}

/** Corre después de la espera: chequea la conversación en 2Chat y, si está vacía, manda el mensaje. Nunca reintenta. */
export async function seguirLead(id: string, telefono: string, nombre: string): Promise<void> {
  const desde = '+' + process.env.EMBUDO_WA_WHATSAPP!.replace(/\D/g, '')
  const hacia = '+' + telefono
  try {
    const conv = await llamar(`/messages/${encodeURIComponent(desde)}/${encodeURIComponent(hacia)}`)
    const mensajes: unknown[] = Array.isArray(conv?.messages) ? conv.messages : []
    if (mensajes.length > 0) {
      await sql()`UPDATE cj_embudo_wa_lead SET wa_escribio = COALESCE(wa_escribio, now()) WHERE id = ${id}`
      return
    }
    await llamar('/send-message', { method: 'POST', body: JSON.stringify({ from_number: desde, to_number: hacia, text: textoSeguimiento(nombre) }) })
    await sql()`UPDATE cj_embudo_wa_lead SET seguimiento_enviado = now(), seguimiento_error = NULL WHERE id = ${id}`
  } catch (e) {
    await sql()`UPDATE cj_embudo_wa_lead SET seguimiento_error = ${e instanceof Error ? e.message : 'error'} WHERE id = ${id}`.catch(() => {})
  }
}
