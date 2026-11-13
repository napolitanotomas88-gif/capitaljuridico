import { accesoMaquina } from '@/lib/auth/acceso'
import { avisoCuotasAdminEncendido } from '@/lib/crm/cuotas/avisoAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

// Aviso diario de las cuotas que cobra Administración (12/11/2026, lib/crm/cuotas/avisoAdmin.ts). Solo máquina:
// Authorization: Bearer <CRON_SECRET> (el cron de Vercel lo manda solo; nunca ?key=).
//   · GET        → cron "5 13 * * *" (10:05 AR): un mensaje en 🛠️-operaciones y los textos «para enviar» (k01).
//                  Encendido con AVISO_CUOTAS_ADMIN=encendido (apagado por defecto: no hace nada).
//   · GET ?dry=1 → lo que avisaría, sin escribir ni mandar nada (anda aunque esté apagado).
const headers = { 'cache-control': 'no-store' }

export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return Response.json({ ok: false, mensaje: 'Sin autorización.' }, { status: 401, headers })
  if (!process.env.CUOTAS_DATABASE_URL?.trim() && !process.env.DATABASE_URL?.trim()) return Response.json({ ok: false, mensaje: 'Base no configurada.' }, { status: 503, headers })
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  if (!dry && !avisoCuotasAdminEncendido()) return Response.json({ ok: true, apagado: true, mensaje: 'AVISO_CUOTAS_ADMIN no está en «encendido»: no se hizo nada.' }, { headers })
  try {
    const { depsAvisoCuotasReales } = await import('@/lib/crm/cuotas/avisoAdminReales')
    const { correrAvisoCuotasAdmin } = await import('@/lib/crm/cuotas/avisoAdmin')
    return Response.json({ ok: true, ...(await correrAvisoCuotasAdmin(depsAvisoCuotasReales(), { dry })) }, { headers })
  } catch (e) {
    console.error(`[cuotas-admin] falló: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)}`)
    return Response.json({ ok: false, mensaje: 'No se pudo armar el aviso de cuotas.' }, { status: 503, headers })
  }
}
