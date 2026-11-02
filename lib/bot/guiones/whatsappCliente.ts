// ── d02: al aprobar la tanda, el link de los guiones al grupo «Contenido» del cliente (2/11/2026) ─────────────────────────
// Prendido solo con GUIONES_WHATSAPP=real Y GUIONES_WHATSAPP_DESDE=<ISO UTC>: solo sale para aprobaciones posteriores al
// corte y de menos de 24 h (un «reenviar» de una tanda vieja NO le escribe al cliente: queda para Aylu/Gero como antes).
// WhatsApp seguro: horario 9 a 20 h de Argentina, /health del número antes de escribir, un solo envío por aprobación
// (reservarWhatsApp) y el grupo tiene que ser uno solo y claro (WHAPI_GRUPOS_CONTENIDO o el nombre completo).
// Si sale, la tanda pasa a «enviada» y no se crea el aviso de entrega manual; si no sale, todo sigue como antes (aviso a Aylu/Gero).
import * as reg from './registro'
import type { FilaTanda } from './registro'
import { avisarCliente, buscarGrupoContenido } from './envio'
import { tokenWhapi } from '../whapi/config'
import { guardiaWhapi } from '../whapi/salud'
import { textoWhatsApp } from './envio'
import { paraEnviar } from '../canal/salidaCliente'

export const MAX_ANTIGUEDAD_APROBACION_MS = 24 * 3_600_000
export const HORARIO_GUIONES_WA = { desde: 9, hasta: 20 } as const   // hora de Argentina, [desde, hasta)
const horaAR = (ms: number): number => Number(new Date(ms - 3 * 3_600_000).toISOString().slice(11, 13))

export type ResultadoD02 = { estado: 'enviado' | 'apagado' | 'fuera' | 'sin_grupo' | 'error'; motivo?: string }

/** ¿Esta aprobación puede salir sola por WhatsApp? null = sí; si no, el motivo. Puro. */
export function motivoNoSale(fila: Pick<FilaTanda, 'estado' | 'aprobacion' | 'doc' | 'cliente'>, env: Record<string, string | undefined>, ahora: number): string | null {
  if (env.GUIONES_WHATSAPP?.trim() !== 'real') return 'GUIONES_WHATSAPP apagado'
  const corte = Date.parse(env.GUIONES_WHATSAPP_DESDE?.trim() ?? '')
  if (!Number.isFinite(corte) || corte > ahora) return 'falta GUIONES_WHATSAPP_DESDE (ISO UTC, no futura)'
  if (fila.estado !== 'aprobada') return 'la tanda no está aprobada'
  const cuando = Date.parse(fila.aprobacion?.cuando ?? '')
  if (!Number.isFinite(cuando) || cuando < corte) return 'aprobación anterior al encendido'
  if (ahora - cuando > MAX_ANTIGUEDAD_APROBACION_MS) return 'aprobación de más de 24 h'
  if (!fila.doc?.url || !fila.cliente?.trim()) return 'falta el documento o el nombre del cliente'
  const h = horaAR(ahora)
  if (h < HORARIO_GUIONES_WA.desde || h >= HORARIO_GUIONES_WA.hasta) return 'fuera de horario (9 a 20 h)'
  return null
}

export async function enviarGuionesAlCliente(fila: FilaTanda, env: Record<string, string | undefined> = process.env): Promise<ResultadoD02> {
  const no = motivoNoSale(fila, env, Date.now())
  if (no) return { estado: no.startsWith('GUIONES_WHATSAPP apagado') ? 'apagado' : 'fuera', motivo: no }
  if (!(await reg.reservarWhatsApp(fila.id))) return { estado: 'fuera', motivo: 'ya reservado por otro pedido' }
  let enviado: { id: string | null; grupo: string } | null = null
  try {
    const token = tokenWhapi()
    if (!token) return { estado: 'error', motivo: 'falta WHAPI_TOKEN' }
    const grupo = await buscarGrupoContenido(fila.cliente ?? '', { idCrm: fila.id_crm })
    if (!grupo) return { estado: 'sin_grupo', motivo: 'no hay un grupo Contenido único para el cliente' }
    await guardiaWhapi().antesDeEscribir({ token, fetch, ahora: Date.now })
    const r = await avisarCliente(fila, grupo.id, fila.doc!.url)
    if (r.estado !== 'enviado') return { estado: r.estado === 'apagado' ? 'apagado' : r.estado, motivo: r.motivo }
    enviado = { id: r.id, grupo: grupo.id }
    return { estado: 'enviado' }
  } catch (e) {
    return { estado: 'error', motivo: String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160) }
  } finally {
    await reg.anotarWhatsApp(fila.id, enviado).catch(e => console.error('Guiones: no se anotó el WhatsApp de la tanda', fila.id, (e as Error)?.name ?? 'error'))
  }
}

/** d02 sin WhatsApp (2/11/2026): el link de la tanda aprobada queda «para enviar» (Aylu o Gero M lo pegan en el grupo
 *  Contenido y confirman la entrega). Devuelve 'manual' (no 'enviado'): el aviso de entrega de la campanita sale igual. */
export async function guionesParaEnviar(fila: FilaTanda): Promise<ResultadoD02 | { estado: 'manual'; motivo?: string }> {
  if (!fila.doc?.url || !fila.aprobacion?.cuando) return { estado: 'fuera', motivo: 'falta el documento o la aprobación' }
  const r = await paraEnviar({
    pieza: 'd02', idCrm: fila.id_crm, cliente: fila.cliente ?? fila.id_crm ?? 'Cliente', clave: claveD02(fila),
    texto: textoWhatsApp(fila, fila.doc.url), abrir: fila.id_crm ? `/clientes/entregas?cliente=${encodeURIComponent(fila.id_crm)}` : '/clientes/entregas',
    datos: { tanda: fila.id },
  })
  return r.estado === 'error' ? { estado: 'error', motivo: r.motivo } : { estado: 'manual', motivo: 'queda para enviar a mano (📤)' }
}

/** La clave del «para enviar» de una tanda (por aprobación: una corrección aprobada de nuevo es otro mensaje). */
export const claveD02 = (fila: Pick<FilaTanda, 'id' | 'aprobacion'>) => `${fila.id}:${fila.aprobacion?.cuando ?? 'sin-aprobacion'}`
