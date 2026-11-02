// ── Salida al cliente, proveedor 'manual' (2/11/2026). Solo servidor ───────────────────────────────────────────────────
// paraEnviar(m): registra el mensaje en cj_canal_mensajes (la misma clave nunca dos veces) y avisa en
// #📤-para-enviar-al-cliente mencionando a la persona responsable de la pieza (lib/alertas/personas.ts), con el texto listo
// para copiar y el link a /clientes/para-enviar. Devuelve {estado:'manual_pendiente'}. Nunca tira.
// Recordatorios (los corre el vigía): a las 24 h sin «Enviado», otra mención en 📤; a las 48 h, aviso en #🛠️-operaciones a
// Tomás, Gero M y Aylu (Tomás, 2/11/2026: que le llegue también a Gero M y a Aylu).
import { alertar } from '@/lib/alertas'
import { GRUPO_PIEZA, NOMBRE_PIEZA, responsablesDe } from '@/lib/alertas/personas'
import { baseCanalLista, insertarMensaje, idPorClave, tomarParaRecordar } from './registro'
import type { CanalSalidaCliente, MensajeCliente, ResultadoSalidaCliente } from './tipos'

const motivoDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\d{8,}/g, '[número]').slice(0, 160)
export const claveCompleta = (m: Pick<MensajeCliente, 'pieza' | 'clave'>) => `${m.pieza}:${m.clave}`.slice(0, 300)
export const linkParaEnviar = (id: number | null) => (id ? `/clientes/para-enviar#m-${id}` : '/clientes/para-enviar')

export async function paraEnviar(m: MensajeCliente): Promise<ResultadoSalidaCliente> {
  if (!m.texto?.trim()) return { estado: 'error', motivo: 'texto vacío' }
  const clave = claveCompleta(m)
  let id: number | null = null
  try {
    if (baseCanalLista()) {
      id = await insertarMensaje({ ...m, claveCompleta: clave })
      if (id === null) return { estado: 'ya_estaba', id: await idPorClave(clave).catch(() => null) }
    }
  } catch (e) {
    console.error(`[para-enviar] ${m.pieza}: no se pudo registrar (${motivoDe(e)}): sale solo la alerta`)
  }
  await alertar({
    canal: 'para_enviar', tipo: `para_enviar_${m.pieza}`, clave: `para_enviar:${clave}`, idCrm: m.idCrm,
    emoji: '📤', titulo: `${NOMBRE_PIEZA[m.pieza]} para el grupo ${GRUPO_PIEZA[m.pieza]}`, cliente: m.cliente,
    lineas: [...(m.adjuntos ?? []).slice(0, 3).map((a) => `Adjuntá: ${a}`), 'Pegalo en el grupo del cliente y marcá «Enviado» en el Despacho.'],
    copiar: m.texto, link: linkParaEnviar(id), menciones: responsablesDe(m.pieza),
  })
  return { estado: 'manual_pendiente', id }
}

export const canalManual: CanalSalidaCliente = { proveedor: 'manual', enviar: paraEnviar }

/** Quiénes reciben el aviso de las 48 h sin «Enviado» (en 🛠️). */
export const MENCIONES_ATRASADO = ['tomas', 'gero_m', 'aylu'] as const

/** El vigía: recordatorio a las 24 h (en 📤) y aviso a Tomás, Gero M y Aylu a las 48 h (en 🛠️). Nunca tira. */
export async function recordarParaEnviar(): Promise<{ recordados: number; atrasados: number }> {
  let recordados = 0, atrasados = 0
  try {
    for (const m of await tomarParaRecordar(24, 1)) {
      const r = await alertar({ canal: 'para_enviar', tipo: 'para_enviar_rec', clave: `para_enviar:${m.clave}:rec1`, idCrm: m.idCrm, emoji: '⏰', titulo: `Sigue sin marcarse «Enviado»: ${NOMBRE_PIEZA[m.pieza]}`, cliente: m.cliente, lineas: ['Hace más de 24 h que está para enviar.'], link: linkParaEnviar(m.id), menciones: responsablesDe(m.pieza) })
      if (r.estado === 'enviado') recordados++
    }
    for (const m of await tomarParaRecordar(48, 2)) {
      const r = await alertar({ canal: 'operaciones', tipo: 'para_enviar_atrasado', clave: `para_enviar:${m.clave}:rec2`, idCrm: m.idCrm, emoji: '🚩', titulo: `Más de 48 h sin mandar: ${NOMBRE_PIEZA[m.pieza]}`, cliente: m.cliente, lineas: ['Nadie marcó «Enviado» ni «No corresponde».'], link: linkParaEnviar(m.id), menciones: MENCIONES_ATRASADO })
      if (r.estado === 'enviado') atrasados++
    }
  } catch (e) { console.error(`[para-enviar] recordatorios: ${motivoDe(e)}`) }
  return { recordados, atrasados }
}
