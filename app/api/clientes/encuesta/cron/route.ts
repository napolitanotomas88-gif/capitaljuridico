import { accesoMaquina } from '@/lib/auth/acceso'
import { avisarEncuesta, recordarEncuesta } from '@/lib/clientes/encuesta/servidor'

// Cron diario (10:00 de Argentina): la lista de los que no contestaron la encuesta mensual va a 🛠️-operaciones. ?dry=1 devuelve
// el texto sin mandar nada. ?recordatorio=manana|tarde (día 1, 9:30 y 18:00): el recordatorio de mandar la encuesta del mes.
export const dynamic = 'force-dynamic'
export const maxDuration = 120
export async function GET(req: Request) {
  const headers = { 'cache-control': 'no-store' }
  if (!accesoMaquina(req.headers)) return Response.json({ ok: false, mensaje: 'Sin autorización.' }, { status: 401, headers })
  if (!process.env.DATABASE_URL?.trim()) return Response.json({ ok: false, mensaje: 'Base no configurada.' }, { status: 503, headers })
  const params = new URL(req.url).searchParams
  const dry = params.get('dry') === '1'
  const turno = params.get('recordatorio')
  try {
    if (turno === 'manana' || turno === 'tarde') return Response.json({ ok: true, dry, ...(await recordarEncuesta({ turno, dry })) }, { headers })
    const r = await avisarEncuesta({ dry })
    return Response.json({ ok: true, dry, ...r }, { headers })
  } catch (e) {
    console.error('[encuesta] no se pudo armar el aviso:', (e as Error)?.message?.slice(0, 120) ?? 'error')
    return Response.json({ ok: false, mensaje: 'No se pudo comprobar la encuesta. No se mandó el aviso.' }, { status: 503, headers })
  }
}
