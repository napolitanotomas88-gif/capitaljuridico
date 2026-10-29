import { NextResponse } from 'next/server'
import { autorizarCron } from '@/lib/bot/grabacion/acceso'
import { correrDiario } from '@/lib/bot/grabacion/diario'
import { PLAZO_VIGIA_MS, depsReales } from '@/lib/bot/grabacion/servidor'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { conArchivadosActuales } from '@/lib/clientes/archivados'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Cron diario de Grabación (vercel.json: "0 10 * * *", 7:00 de Argentina; en Hobby corre en algún momento de esa hora).
// Vercel manda `Authorization: Bearer <CRON_SECRET>` (regla `propio` en lib/auth/rutas.ts). Corre las fases del diario que
// falten (pasada completa, e01, resumen si ya son las 7:45 y es día de daily, huecos del vigía, transcripciones colgadas);
// lo que no termine lo retoma el vigía. Ruta hija SIN query en el cron (los crons con ? rompen scripts/test-rutas.mjs).
// A mano: GET con el mismo Bearer; ?dry=1 devuelve el plan sin escribir.
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function GET(req: Request) {
  const t0 = Date.now()
  const a = autorizarCron(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  if (!baseConfigurada()) return json({ error: 'falta DATABASE_URL' }, 503)
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  try {
    const r = await conArchivadosActuales(() => correrDiario(depsReales({ inicio: t0, dry }), { origen: req.headers.get('user-agent')?.includes('vercel-cron') ? 'cron' : 'manual', deadline: t0 + PLAZO_VIGIA_MS }))
    if (!r.dry) console.log(`grabacion-diario: ${r.saltada ? `salteado (${r.saltada})` : `corrida ${r.corrida}: fases ${r.fases.join(', ') || 'ninguna'} · ${r.errores.length} errores`}`)
    return json(r)
  } catch (e) {
    const m = ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)
    console.error('grabacion-diario: falla inesperada —', m)
    return json({ ok: false, error: m }, 500)
  }
}
