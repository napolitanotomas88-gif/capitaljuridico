import { accesoMaquina } from '@/lib/auth/acceso'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

// Recién lanzados del EOW (13/11/2026, lib/eow/lanzados.ts). Solo máquina: Authorization: Bearer <CRON_SECRET> (el cron de
// Vercel lo manda solo; nunca ?key=).
//   · GET           → cron "0 13 * * *" (10:00 AR): actúa SOLO los domingos. Agrega al reporte de la semana los clientes
//                     recién lanzados y avisa en #📊-reporte-eow mencionando a Gero M. Encendido con EOW_AVISO=encendido.
//   · GET ?dry=1    → lo que haría, sin escribir ni mandar nada (cualquier día, aunque esté apagado).
//   · GET ?forzar=1 → corre aunque no sea domingo (con EOW_AVISO=encendido).
const headers = { 'cache-control': 'no-store' }

export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return Response.json({ ok: false, mensaje: 'Sin autorización.' }, { status: 401, headers })
  if (!process.env.DATABASE_URL?.trim()) return Response.json({ ok: false, mensaje: 'Base no configurada.' }, { status: 503, headers })
  const q = new URL(req.url).searchParams
  try {
    const { depsAvisoEowReales } = await import('@/lib/eow/lanzadosReales')
    const { correrAvisoEow } = await import('@/lib/eow/lanzados')
    return Response.json({ ok: true, ...(await correrAvisoEow(depsAvisoEowReales(), { dry: q.get('dry') === '1', forzar: q.get('forzar') === '1' })) }, { headers })
  } catch (e) {
    console.error(`[eow-aviso] falló: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)}`)
    return Response.json({ ok: false, mensaje: 'No se pudo correr el aviso del EOW.' }, { status: 503, headers })
  }
}
