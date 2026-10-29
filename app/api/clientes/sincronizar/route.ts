import { accesoMaquina } from '@/lib/auth/acceso'
import { SECCIONES } from '@/lib/auth/roles'
import { reconciliarAccionesPendientes } from '@/lib/clientes/acciones/servidor'
import { procesarBeneficiosPendientes } from '@/lib/clientes/beneficiosPendientes'
import { reconciliarNotificaciones } from '@/lib/notificaciones/reconciliar'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { 'cache-control': 'no-store' } })

/** Retoma sólo pedidos durables ya autorizados. Nunca reenvía una escritura de Sheets sin comprobar su evidencia. */
export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return json({ ok: false, mensaje: 'Sin autorización.' }, 401)
  if (!process.env.DATABASE_URL?.trim()) return json({ ok: false, mensaje: 'Base no configurada.' }, 503)
  try {
    const acciones = await reconciliarAccionesPendientes({ limite: 10 })
    const beneficios = await procesarBeneficiosPendientes(10)
    await reconciliarNotificaciones(SECCIONES)
    return json({ ok: true, acciones, beneficios })
  } catch {
    return json({ ok: false, mensaje: 'No se pudo completar la sincronización. Los pedidos se conservan para la próxima pasada.' }, 503)
  }
}
