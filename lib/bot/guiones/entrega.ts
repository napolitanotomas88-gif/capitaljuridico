// Revisión → Doc → cola interna de entrega. La aprobación nunca manda automáticamente al cliente.
import { neon } from '@neondatabase/serverless'
import { crearNotificacion } from '@/lib/notificaciones/registro'
import type { NuevaNotificacion } from '@/lib/notificaciones/modelo'
import type { FilaTanda } from './registro'
const mails = (s?: string) => (s ?? '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
export function destinatariosEntrega(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set([env.EDICION_REVISOR_AYLU, env.KICKOFF_REVISOR_GERO_M, env.GUIONES_ENTREGA_EMAIL, env.KICKOFF_REVISOR_TOMI].flatMap(mails))]
}
export const puedeEntregarGuiones = (email: string, env: Record<string, string | undefined> = process.env) => destinatariosEntrega(env).includes(email.trim().toLowerCase())
export function avisosEntrega(fila: FilaTanda, env: Record<string, string | undefined> = process.env): NuevaNotificacion[] {
  if (!fila.doc?.id || !fila.aprobacion || !fila.id_crm) return []
  return destinatariosEntrega(env).map(email => ({
    paraEmail: email, tipo: 'guiones_entrega', titulo: `Guiones listos para entregar · ${fila.cliente ?? fila.id_crm}`,
    cuerpo: `Tanda ${fila.doc?.tanda ?? fila.tanda} aprobada por ${fila.aprobacion!.quien}. Revisá el documento y entregá el link al cliente: ${fila.doc!.url}`,
    url: `/clientes/entregas?cliente=${encodeURIComponent(fila.id_crm!)}`, urgente: false, origen: 'bot-guiones',
    clave: `guiones-entrega:${fila.id}:${fila.aprobacion!.cuando}:${email}`,
  }))
}
export async function notificarEntrega(fila: FilaTanda): Promise<void> {
  const avisos = avisosEntrega(fila)
  if (!avisos.length) throw new Error('Faltan los destinatarios de entrega (Aylu/Gero) o el vínculo del documento.')
  await Promise.all(avisos.map(crearNotificacion))
}
export async function notificarRevision(fila: FilaTanda, corregida: boolean): Promise<void> {
  if (!fila.id_crm) return
  const destinatarios = [...new Set([process.env.KICKOFF_REVISOR_TOMI, process.env.GUIONES_REVISOR_FAUS].flatMap(mails))]
  const base: NuevaNotificacion = {
    tipo: 'guiones_a_revisar', titulo: `${corregida ? 'Guiones corregidos' : 'Guiones listos para revisar'} · ${fila.cliente ?? fila.id_crm}`,
    cuerpo: `${Object.keys(fila.guiones).length} guiones; verificá cada uno y da el check final.`,
    url: `/guiones/${encodeURIComponent(fila.id_crm)}`, origen: 'bot-guiones', urgente: true,
  }
  await Promise.all((destinatarios.length ? destinatarios.map(email => ({ ...base, paraEmail: email, clave: `guiones-revisar:${fila.id}:${fila.actualizado}:${email}` })) : [{ ...base, paraSeccion: 'guiones' as const, clave: `guiones-revisar:${fila.id}:${fila.actualizado}` }]).map(crearNotificacion))
}
export async function cerrarAvisosEntrega(tanda: number, quien: string): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    const q = neon(process.env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(8_000) } })
    await q`UPDATE cj_notificaciones SET hecha_en = now(), hecha_por = ${quien} WHERE origen = 'bot-guiones' AND tipo = 'guiones_entrega' AND clave LIKE ${`guiones-entrega:${tanda}:%`} AND hecha_en IS NULL`
  } catch (e) { console.error('Guiones: no se cerró el aviso de entrega:', (e as Error)?.name ?? 'error') }
}
