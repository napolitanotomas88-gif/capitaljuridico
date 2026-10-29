import { NextResponse, after } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { PASOS, correrPaso, iniciar, reanudar, type Paso } from '@/lib/bot/guiones/proceso'
import { depsReales } from '@/lib/bot/guiones/servidor'
import { baseConfigurada } from '@/lib/bot/guiones/registro'
import { claveClaude } from '@/lib/bot/kickoff/claude'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Etapa Guiones del bot Capital Jurídico (docs/BOT-GUIONES-CJ.md). Todo con "Authorization: Bearer <CRON_SECRET>".
// GET: qué está configurado (solo nombres de variables).
// POST {recording_id}: disparo desde el kickoff (ideas aprobadas por Tomi y Gero M) → crea la tanda y arranca.
// POST {reanudar: id}: retoma una tanda en error o colgada.
// POST {paso, id, numero?}: un paso de la tanda (lo dispara la propia ruta). Responde 202 y trabaja en after().
const ok = (status: number, cuerpo: Record<string, unknown>) => NextResponse.json(cuerpo, { status })

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET?.trim()) return ok(503, { ok: false, motivo: 'falta CRON_SECRET' })
  if (!accesoMaquina(req.headers)) return ok(401, { ok: false })
  const faltan = [
    ...(baseConfigurada() ? [] : ['DATABASE_URL']), ...(claveClaude() ? [] : ['BOT_ANTHROPIC_API_KEY']),
    ...(process.env.CRON_SECRET?.trim() ? [] : ['CRON_SECRET']),
    ...(process.env.DISCORD_WEBHOOK_GUIONES?.trim() || process.env.DISCORD_WEBHOOK_KICKOFF?.trim() ? [] : ['DISCORD_WEBHOOK_GUIONES']),
  ]
  return ok(200, { ok: faltan.length === 0, faltan, opcionales: process.env.DISCORD_ID_FAUS?.trim() ? [] : ['DISCORD_ID_FAUS'] })
}

export async function POST(req: Request) {
  const t0 = Date.now()
  if (!process.env.CRON_SECRET?.trim()) return ok(503, { ok: false, motivo: 'falta CRON_SECRET' })
  if (!accesoMaquina(req.headers)) return ok(401, { ok: false })
  if (!baseConfigurada()) return ok(503, { ok: false, motivo: 'falta DATABASE_URL' })
  let b: Record<string, unknown>
  try { b = (await req.json()) as Record<string, unknown> } catch { return ok(400, { ok: false, motivo: 'JSON inválido' }) }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ok(400, { ok: false, motivo: 'JSON inválido' })
  const deps = depsReales()
  const entero = (x: unknown) => (typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : typeof x === 'string' && /^\d{1,16}$/.test(x) ? Number(x) : null)

  if (b.paso !== undefined) {
    const paso = String(b.paso) as Paso, id = entero(b.id), numero = b.numero === undefined ? undefined : entero(b.numero) ?? undefined
    if (!(PASOS as readonly string[]).includes(paso) || !id) return ok(400, { ok: false, motivo: 'paso o id inválido' })
    after(async () => {
      try { console.log(`bot-guiones: tanda ${id} · ${paso}${numero ? ` ${numero}` : ''} → ${await correrPaso(paso, { id, numero }, t0, deps)}`) }
      catch (e) { console.error(`bot-guiones: tanda ${id} · ${paso} falló —`, ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)) }
    })
    return ok(202, { ok: true })
  }
  if (b.reanudar !== undefined) {
    const id = entero(b.reanudar)
    if (!id) return ok(400, { ok: false, motivo: 'id inválido' })
    try { return ok(200, { ok: true, resultado: await reanudar(id, deps) }) } catch (e) { return ok(500, { ok: false, motivo: (e as Error)?.message }) }
  }
  const rec = entero(b.recording_id)
  if (!rec) return ok(400, { ok: false, motivo: 'falta recording_id' })
  try { return ok(202, { ok: true, ...(await iniciar(rec, deps)) }) } catch (e) { return ok(409, { ok: false, motivo: (e as Error)?.message }) }
}
