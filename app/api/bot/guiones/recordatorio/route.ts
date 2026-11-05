import { NextResponse } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { baseConfigurada, tandasARevisar } from '@/lib/bot/guiones/registro'
import { correrRecordatorio } from '@/lib/bot/guiones/recordatorio'
import { alertar } from '@/lib/alertas'
import { crearNotificacion } from '@/lib/notificaciones/registro'
import { recordarGuionesARevisar, resumenGuionesPendientes } from '@/lib/bot/guiones/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Recordatorio diario de guiones editados sin verificar (lib/bot/guiones/recordatorio.ts). Cron de Vercel en días hábiles;
// Vercel manda `Authorization: Bearer <CRON_SECRET>`. A mano: GET con el mismo Bearer; ?dry=1 devuelve qué avisaría.
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET?.trim()) return json({ ok: false, motivo: 'falta CRON_SECRET' }, 503)
  if (!accesoMaquina(req.headers)) return json({ ok: false }, 401)
  if (!baseConfigurada()) return json({ ok: false, motivo: 'falta DATABASE_URL' }, 503)
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  try {
    const r = await correrRecordatorio({ leer: tandasARevisar, alertar, notificar: crearNotificacion }, { dry })
    if (!r.dry) console.log(`guiones-recordatorio: ${r.pendientes.length} sin verificar, ${r.revisiones?.length ?? 0} a medias · ${r.resultados?.join(' · ') || 'nada'}`)
    // Además, las tandas sin revisar (aviso que faltó + 24/48 h). También lo corre el vigía cada 15 min.
    const revision = await recordarGuionesARevisar({ dry })
    // Y el resumen del día a Gero M: lo que falta corregir, verificar o dar el check (5/11/2026).
    const resumen = await resumenGuionesPendientes({ dry })
    if (resumen && !dry) console.log(`guiones-resumen: ${resumen.pendientes.length} abiertas · ${resumen.alerta}`)
    return json({ ok: true, ...r, revision, resumen: resumen && { alerta: resumen.alerta, pendientes: resumen.pendientes.map(p => ({ idCrm: p.idCrm, tanda: p.tanda, paso: p.paso, dias: p.dias })) } })
  } catch (e) {
    const m = ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
    console.error('guiones-recordatorio: falla —', m)
    return json({ ok: false, error: m }, 500)
  }
}
