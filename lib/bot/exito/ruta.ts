// ── Bot "Capital Jurídico": etapa ÉXITO — lo que hace /api/bot/exito (probado sin Next en scripts/test-bot-exito.mjs) ────────
// Solo Bearer CRON_SECRET (tiempo constante), falla cerrado: sin el secreto configurado 503, con otro 401. Nunca ?key=.
import { igualesSeguro } from '@/lib/auth/cookie'
import type { AlmacenExito } from './almacen'
import type { LectoresDiario } from './nucleo'

type Cabeceras = { get(nombre: string): string | null }

export function autorizarExito(h: Cabeceras, env: NodeJS.ProcessEnv): { ok: true } | { ok: false; status: 401 | 503 } {
  const secreto = env.CRON_SECRET?.trim()
  if (!secreto) return { ok: false, status: 503 }
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(h.get('authorization') ?? '')
  if (!m || !igualesSeguro(m[1], secreto)) return { ok: false, status: 401 }
  return { ok: true }
}

export interface DepsRutaExito { env?: NodeJS.ProcessEnv; almacen?: AlmacenExito; lectores?: LectoresDiario; ahora?: () => number; log?: { info(m: string): void; warn(m: string): void; error(m: string): void } }

const limpio = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\d{8,}/g, '[número]').slice(0, 200)

export async function atenderExito(q: URLSearchParams, deps: DepsRutaExito = {}): Promise<{ status: number; cuerpo: unknown }> {
  const env = deps.env ?? process.env
  try {
    if (q.get('estado') === '1') {
      const { leerEstadoExito } = await import('./lectura')
      return { status: 200, cuerpo: await leerEstadoExito({ env, almacen: deps.almacen }) }
    }
    if (!env.DATABASE_URL?.trim() && !deps.almacen) return { status: 503, cuerpo: { error: 'falta DATABASE_URL' } }
    const { correrDiarioReal } = await import('./servidor')
    const r = await correrDiarioReal({ env, almacen: deps.almacen, lectores: deps.lectores, ahora: deps.ahora, log: deps.log, dry: q.get('dry') === '1', forzarLista: q.get('lista') === 'prueba' ? 'prueba' : q.get('lista') === '1' })
    return { status: 200, cuerpo: { ok: r.errores.length === 0, dry: q.get('dry') === '1', ...r, errores: r.errores.map(limpio) } }
  } catch (e) {
    return { status: 500, cuerpo: { ok: false, error: limpio(e) } }
  }
}
