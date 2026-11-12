// Seguimiento del embudo por ManyChat (el WhatsApp del setter está conectado ahí por la API oficial de Meta):
//  1) al recibir el formulario se crea/busca el contacto de WhatsApp, se le pone la etiqueta y la letra;
//  2) a los EMBUDO_WA_ESPERA_SEG (180 por defecto), si el contacto no interactuó desde que completó el formulario,
//     se le manda el flujo EMBUDO_WA_MC_FLOW (empieza con la plantilla aprobada por Meta). Una sola vez, sin reintentos.
// Apagado salvo EMBUDO_WA_SEGUIMIENTO=1 + MANYCHAT_API_KEY + EMBUDO_WA_MC_FLOW (pedido de Gero, 12/11/2026).
import 'server-only'
import { neon } from '@neondatabase/serverless'

const BASE = 'https://api.manychat.com/fb'
const sql = () => neon(process.env.DATABASE_URL!.trim())
const ETIQUETA = () => process.env.EMBUDO_WA_MC_ETIQUETA?.trim() || 'Embudo formulario'
const CAMPO_LETRA = () => process.env.EMBUDO_WA_MC_CAMPO_LETRA?.trim() || 'Letra embudo'

export const seguimientoEncendido = () =>
  process.env.EMBUDO_WA_SEGUIMIENTO?.trim() === '1' && !!process.env.MANYCHAT_API_KEY?.trim() && !!process.env.EMBUDO_WA_MC_FLOW?.trim()

export const esperaSegundos = () => Math.min(270, Math.max(30, Number(process.env.EMBUDO_WA_ESPERA_SEG) || 180))

type Resp<T> = { status?: string; data?: T; message?: string; details?: unknown }
async function mc<T>(ruta: string, body?: unknown): Promise<Resp<T>> {
  const r = await fetch(BASE + ruta, {
    method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.MANYCHAT_API_KEY!.trim()}`, Accept: 'application/json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return ((await r.json().catch(() => null)) ?? { status: 'error', message: `HTTP ${r.status}` }) as Resp<T>
}
type Sus = { id: number | string; last_interaction?: string | null; last_seen?: string | null }

async function anotar(id: string, campo: 'mc' | 'error', valor: string) {
  if (campo === 'mc') await sql()`UPDATE cj_embudo_wa_lead SET origen = origen || ${JSON.stringify({ manychat_id: valor })}::jsonb WHERE id = ${id}`
  else await sql()`UPDATE cj_embudo_wa_lead SET seguimiento_error = ${valor.slice(0, 300)} WHERE id = ${id}`
}

/** Crea (o encuentra) el contacto de WhatsApp en ManyChat, con etiqueta y letra. Devuelve su id o null. */
export async function prepararContacto(id: string, telefono: string, nombre: string, apellido: string, letra: string): Promise<string | null> {
  const tel = '+' + telefono
  let sus: Sus | undefined
  const c = await mc<Sus>('/subscriber/createSubscriber', {
    first_name: nombre, last_name: apellido, whatsapp_phone: tel, phone: tel, has_opt_in_sms: false, has_opt_in_email: false,
    consent_phrase: 'Completó el formulario de capitaljuridico.com.ar/aplicar y pidió que lo contacten por WhatsApp',
  })
  if (c.status === 'success' && c.data?.id) sus = c.data
  else {
    const f = await mc<Sus>(`/subscriber/findBySystemField?phone=${encodeURIComponent(tel)}`)
    if (f.status === 'success' && f.data?.id) sus = f.data
  }
  if (!sus) { await anotar(id, 'error', `ManyChat: no se pudo crear ni encontrar el contacto (${String(c.message ?? JSON.stringify(c.details ?? '')).slice(0, 200)})`); return null }
  const sid = String(sus.id)
  await anotar(id, 'mc', sid)
  await mc('/subscriber/addTagByName', { subscriber_id: Number(sid), tag_name: ETIQUETA() })
  await mc('/subscriber/setCustomFieldByName', { subscriber_id: Number(sid), field_name: CAMPO_LETRA(), field_value: letra })
  return sid
}

/** Después de la espera: si el contacto no interactuó desde `desde`, le manda el flujo con la plantilla. */
export async function seguirLead(id: string, sid: string, desde: Date): Promise<void> {
  try {
    const info = await mc<Sus>(`/subscriber/getInfo?subscriber_id=${encodeURIComponent(sid)}`)
    const ult = info.data?.last_interaction ? new Date(info.data.last_interaction) : null
    if (ult && !isNaN(+ult) && +ult >= +desde - 5000) {
      await sql()`UPDATE cj_embudo_wa_lead SET wa_escribio = COALESCE(wa_escribio, ${ult.toISOString()}) WHERE id = ${id}`
      return
    }
    const r = await mc('/sending/sendFlow', { subscriber_id: Number(sid), flow_ns: process.env.EMBUDO_WA_MC_FLOW!.trim() })
    if (r.status !== 'success') throw new Error(String(r.message ?? JSON.stringify(r.details ?? 'error')).slice(0, 250))
    await sql()`UPDATE cj_embudo_wa_lead SET seguimiento_enviado = now(), seguimiento_error = NULL WHERE id = ${id}`
  } catch (e) {
    await anotar(id, 'error', `ManyChat: ${e instanceof Error ? e.message : 'error'}`).catch(() => {})
  }
}
