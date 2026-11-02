// ── Éxito y Bajas sin WhatsApp (2/11/2026). Solo servidor ───────────────────────────────────────────────────────────────
// Los núcleos de Éxito y Bajas siguen igual: «mandan» textos a un chat. Sin WhatsApp esos chats son virtuales:
//   · CHAT_VERIFICACIONES_DISCORD ('discord:verificaciones'): el texto va como alerta a ✅-verificaciones, mencionando a Gero M
//     y a Tomás, con el link a /clientes/aprobaciones (donde están los botones OK / NO). «Respondé citando…» se reemplaza.
//   · el grupo General del cliente (real o virtual 'cliente:<ID>:general'): el texto queda «para enviar» (📤) con su pieza.
// Así cada pedido, aprobación y vencimiento sigue la misma lógica probada; solo cambia por dónde sale.
import { createHash } from 'node:crypto'
import { alertar } from '@/lib/alertas'
import type { Mencion } from '@/lib/alertas/personas'
import { paraEnviar } from './canal/salidaCliente'

export const CHAT_VERIFICACIONES_DISCORD = 'discord:verificaciones'
const ID_CRM = /^[A-Za-z]\d{1,6}$/

/** El «grupo General» virtual de un cliente sin grupo conocido. */
export const generalVirtual = (idCrm: string | null): string | null => (idCrm && ID_CRM.test(idCrm.trim()) ? `cliente:${idCrm.trim().toUpperCase()}:general` : null)
const idDeVirtual = (chatId: string): string | null => /^cliente:([A-Z]\d{1,6}):/.exec(chatId)?.[1] ?? null

const huella = (t: string) => createHash('sha256').update(t.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 20)
const diaAR = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

/** «Respondé citando: OK / NO» → «Respondelo en el Despacho con OK / NO». */
export function sinCitar(texto: string): string {
  return texto
    .replace(/Respond[eé] (?:de nuevo )?citando(?: (?:este mensaje|el pedido|la lista|la consulta))?(?: con)?:?\s*/gi, 'Respondelo en el Despacho: ')
    .replace(/citando el pedido/gi, 'en el Despacho')
}

type Envio = { chatId: string; texto: string; citar?: string | null; pieza?: string; idCrm?: string | null; cliente?: string | null; clave?: string | null }

export async function enviarTextoSinWhatsapp(origen: 'exito' | 'bajas', p: Envio): Promise<{ id: string | null }> {
  if (p.chatId === CHAT_VERIFICACIONES_DISCORD) {
    const lineas = sinCitar(p.texto).split('\n').map((l) => l.trim()).filter(Boolean)
    const titulo = (lineas.shift() ?? 'Pedido de OK').replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 150)
    const clave = `${origen}:${huella(p.texto)}:${diaAR()}`
    const menciones: Mencion[] = ['gero_m', 'tomas']
    const r = await alertar({ canal: 'verificaciones', tipo: `${origen}_verificaciones`, clave, emoji: origen === 'exito' ? '🏆' : '📕', titulo, lineas, link: '/clientes/aprobaciones', menciones })
    if (r.estado === 'error') throw Object.assign(new Error(`Discord: ${r.motivo ?? 'no salió'}`), { aplicado: false })
    if (r.estado === 'dudoso') throw Object.assign(new Error(`Discord no confirmó (${r.motivo ?? ''})`), { aplicado: null, tipo: 'dudoso' })
    return { id: `dc:${clave}` }
  }
  const pieza = p.pieza
  if (pieza !== 'h01' && pieza !== 'h02' && pieza !== 'h03' && pieza !== 'i01' && pieza !== 'i03') {
    throw Object.assign(new Error('sin WhatsApp: mensaje al cliente sin pieza (no se manda)'), { aplicado: false })
  }
  const idCrm = p.idCrm?.toUpperCase() ?? idDeVirtual(p.chatId)
  const r = await paraEnviar({
    pieza, idCrm, cliente: p.cliente?.trim() || idCrm || 'Cliente', clave: p.clave ?? huella(p.texto), texto: p.texto,
    abrir: idCrm ? `/clientes/${idCrm}` : '/clientes', datos: { origen },
  })
  if (r.estado === 'error') throw Object.assign(new Error(r.motivo), { aplicado: false })
  return { id: `manual:${r.id ?? 'sin-id'}` }
}

/** Tarea humana en 🛠️-operaciones (crear grupos, sacar de grupos, Skool…). Nunca tira. */
export async function tareaOperaciones(t: { idCrm: string | null; cliente: string; clave: string; titulo: string; lineas: string[]; menciones?: Mencion[]; link?: string | null }): Promise<void> {
  await alertar({
    canal: 'operaciones', tipo: 'tarea_manual', clave: `tarea:${t.clave}`, idCrm: t.idCrm, emoji: '🛠️', titulo: t.titulo, cliente: t.cliente,
    lineas: t.lineas, link: t.link ?? (t.idCrm ? `/clientes/${t.idCrm.toUpperCase()}` : '/clientes'), menciones: t.menciones ?? ['aylu'],
  })
}
