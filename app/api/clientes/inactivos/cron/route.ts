import { accesoMaquina } from '@/lib/auth/acceso'
import { procesarInactivos } from '@/lib/clientes/inactivos'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export async function GET(req: Request) {
  const headers = { 'cache-control': 'no-store' }
  if (!accesoMaquina(req.headers)) return Response.json({ ok: false, mensaje: 'Sin autorización.' }, { status: 401, headers })
  if (!process.env.DATABASE_URL?.trim()) return Response.json({ ok: false, mensaje: 'Base de seguimiento no configurada.' }, { status: 503, headers })
  try {
    const r = await procesarInactivos({ dry: new URL(req.url).searchParams.get('dry') === '1' })
    return Response.json({ ok: true, creadas: r.creadas, candidatos: r.candidatos.length, whatsapp: r.whatsapp }, { headers })
  } catch {
    return Response.json({ ok: false, mensaje: 'No se pudo comprobar el seguimiento. No se enviaron recordatorios.' }, { status: 503, headers })
  }
}
