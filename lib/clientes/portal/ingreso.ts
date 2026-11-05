import { crearNotificacion } from '@/lib/notificaciones/registro'

// Aviso de que un cliente entró a su portal (Tomás, 5/11/2026: «confirmame cuando ingrese»). Le llega a Tomás por la campanita
// del Despacho, uno por cliente y por día (la clave no se repite). Al cliente no le llega nada: su marco (MarcoPortal) no tiene
// campanita ni menú. Nunca tira: si falla, el portal se muestra igual.
const mailTomas = (env: NodeJS.ProcessEnv = process.env) => (env.KICKOFF_REVISOR_TOMI ?? '').split(/[,;\s]+/).find((m) => m.includes('@')) ?? null

export async function avisarIngresoPortal(p: { id: string; nombre: string }): Promise<void> {
  try {
    const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
    console.info(`[portal] ingreso del cliente ${p.id}`)
    const para = mailTomas()
    if (!para) return
    await crearNotificacion({
      paraEmail: para, tipo: 'portal_ingreso', titulo: `Portal: ${p.nombre} entró a su estrategia`,
      cuerpo: 'El cliente abrió su portal con su cuenta de Google.', url: `/clientes/portal/${p.id}`,
      origen: 'portal-cliente', clave: `portal:ingreso:${p.id}:${dia}`,
    })
  } catch (e) {
    console.warn('[portal] no se pudo avisar el ingreso:', String((e as Error)?.message ?? e).slice(0, 120))
  }
}
