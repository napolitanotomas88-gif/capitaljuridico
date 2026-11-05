// Resumen de guiones trabados (pedido de Tomás, 5/11/2026: «que me avise cuáles están pendientes, qué falta… a Gero M, para
// ver dónde nos está faltando»). Toma las tandas abiertas (todo lo que no está enviado ni cerrado) y dice, por tanda, en qué
// paso está y de quién es: revisar (Faus), check final (Faus), carga en el Doc fallida, link sin entregar (Aylu/Gero) o el
// bot trabado armándola. Lo usan la alerta diaria a Gero M (cron de guiones, días hábiles) y el panel de /guiones. Puro.
import type { Alerta } from '@/lib/alertas/alerta'
import { ESTADOS_TRABAJO, type FilaTanda } from './registro'

export type PasoPendiente = 'revisar' | 'check_final' | 'doc_fallido' | 'entregar' | 'cargando_doc' | 'bot_trabado' | 'armando'

export interface TandaPendiente {
  id: number; idCrm: string; cliente: string; tanda: number; paso: PasoPendiente
  /** Qué falta, en una frase («Faltan 6 de 6 por verificar»). */
  falta: string
  /** Desde cuándo está en este paso (ISO) y cuántos días van. */
  desde: string; dias: number
}

/** El paso, quién lo tiene y el orden en que se muestra (lo más trabado primero). */
export const PASOS: Record<PasoPendiente, { titulo: string; quien: string; orden: number }> = {
  doc_fallido: { titulo: 'Check dado, pero no entró al Doc', quien: 'Faus reintenta', orden: 0 },
  bot_trabado: { titulo: 'El bot se trabó armándola', quien: 'Gero M', orden: 1 },
  revisar: { titulo: 'Falta revisar y verificar', quien: 'Faus', orden: 2 },
  check_final: { titulo: 'Falta el check final', quien: 'Faus', orden: 3 },
  entregar: { titulo: 'En el Doc, falta entregar el link', quien: 'Aylu / Gero', orden: 4 },
  cargando_doc: { titulo: 'Cargándose en el Doc', quien: 'el bot', orden: 5 },
  armando: { titulo: 'El bot la está armando', quien: 'el bot', orden: 6 },
}

/** Un estado de trabajo sin movimiento hace más que esto está trabado (una invocación dura minutos). */
export const HORAS_TRABADA = 2

const esVerificado = (g: { verificado?: unknown }) => !!(g.verificado && typeof g.verificado === 'object')
const diasDesde = (desde: string, ahora: Date) => Math.max(0, Math.floor((ahora.getTime() - Date.parse(desde)) / 86_400_000))
const lista = (ns: number[]) => (ns.length === 1 ? `el ${ns[0]}` : `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`)

/** El paso pendiente de una tanda abierta, o null si no le falta nada a nadie (enviada, cerrada). Puro. */
export function pasoDe(fila: FilaTanda, ahora: Date = new Date()): Omit<TandaPendiente, 'id' | 'idCrm' | 'cliente' | 'tanda'> | null {
  const desde = fila.actualizado
  const con = (paso: PasoPendiente, falta: string, d = desde) => ({ paso, falta, desde: d, dias: diasDesde(d, ahora) })
  if (fila.estado === 'a_revisar') {
    const gs = Object.entries(fila.guiones), faltan = gs.filter(([, g]) => !esVerificado(g)).map(([n]) => Number(n)).sort((a, b) => a - b)
    if (!faltan.length) return con('check_final', `Los ${gs.length} verificados: falta el check final`)
    return con('revisar', faltan.length === gs.length ? `Ninguno verificado (${gs.length} guiones)` : `Van ${gs.length - faltan.length} de ${gs.length}: falta${faltan.length === 1 ? '' : 'n'} ${lista(faltan)}`)
  }
  if (fila.estado === 'aprobada') {
    const pub = fila.doc?.publicacion, aprobada = fila.aprobacion?.cuando ?? desde
    if (pub && (pub.estado === 'error' || pub.estado === 'dudoso')) return con('doc_fallido', pub.motivo?.trim() || 'la carga en el Doc falló', pub.cuando || aprobada)
    if (fila.doc?.publicada && fila.doc.publicada === fila.aprobacion?.cuando) return con('entregar', 'Escrita en el Doc: falta mandarle el link al cliente', fila.doc.publicada)
    return con('cargando_doc', 'Check dado: se está escribiendo en el Doc', aprobada)
  }
  if (fila.estado === 'error') return con('bot_trabado', fila.error?.trim() ? `Error: ${fila.error.trim()}` : 'Quedó en error: tocá «Retomar»')
  if (fila.estado === 'pendiente' || ESTADOS_TRABAJO.includes(fila.estado)) {
    const horas = (ahora.getTime() - Date.parse(desde)) / 3_600_000
    return horas >= HORAS_TRABADA ? con('bot_trabado', `Sin moverse hace ${Math.floor(horas)} h (${fila.estado}): tocá «Retomar»`) : con('armando', `En curso (${fila.estado})`)
  }
  return null
}

/** Las tandas con algo pendiente, de lo más trabado a lo menos y, dentro de cada paso, la más vieja primero. Puro. */
export function tandasPendientes(filas: readonly FilaTanda[], ahora: Date = new Date()): TandaPendiente[] {
  return filas.flatMap((f): TandaPendiente[] => {
    const p = f.id_crm ? pasoDe(f, ahora) : null
    return p ? [{ id: f.id, idCrm: f.id_crm!, cliente: f.cliente?.trim() || f.id_crm!, tanda: f.tanda, ...p }] : []
  }).sort((a, b) => PASOS[a.paso].orden - PASOS[b.paso].orden || a.desde.localeCompare(b.desde))
}

const hace = (dias: number) => (dias === 0 ? 'hoy' : dias === 1 ? 'hace 1 día' : `hace ${dias} días`)

/** Lo que entra en el resumen diario (Tomás, 5/11/2026: «que solo mencione lo que falta corregir, dar el check y demás»):
 *  revisar/corregir, check final y el check que no entró al Doc. La entrega del link y el bot quedan solo en el panel. */
export const PASOS_RESUMEN: readonly PasoPendiente[] = ['doc_fallido', 'revisar', 'check_final']

/** La alerta diaria a Gero M en ✍️-guiones: una viñeta por paso con sus clientes (Discord: hasta 6 viñetas). null si no
 *  hay nada de PASOS_RESUMEN. Puro. */
export function alertaResumen(pendientes: readonly TandaPendiente[], base: string, dia: string): Alerta | null {
  const trabadas = pendientes.filter(p => PASOS_RESUMEN.includes(p.paso))
  if (!trabadas.length) return null
  const b = base.replace(/\/+$/, '')
  const porPaso = new Map<PasoPendiente, TandaPendiente[]>()
  for (const p of trabadas) porPaso.set(p.paso, [...(porPaso.get(p.paso) ?? []), p])
  const grupos = [...porPaso.entries()].sort(([a], [z]) => PASOS[a].orden - PASOS[z].orden)
  const lineas = grupos.slice(0, 5).map(([paso, ps]) => {
    const clientes = ps.slice(0, 4).map(p => `${p.cliente} (${p.idCrm}, tanda ${p.tanda}, ${hace(p.dias)}${paso === 'doc_fallido' ? `: ${p.falta}` : ''})`).join(' · ')
    return `**${PASOS[paso].titulo}** → ${PASOS[paso].quien}: ${clientes}${ps.length > 4 ? ` y ${ps.length - 4} más` : ''}`
  })
  return {
    canal: 'guiones', tipo: 'guiones_resumen', clave: `guiones_resumen:${dia}`, emoji: '🧭',
    titulo: `Guiones: ${trabadas.length} tanda${trabadas.length === 1 ? '' : 's'} por corregir o con el check pendiente`,
    lineas: [...lineas, `Detalle y links: <${b}/guiones>`],
    menciones: ['gero_m'],
  }
}
