// ── Bot "Capital Jurídico": etapa BAJA — lo que hace /api/bot/bajas (probado sin Next en scripts/test-bot-bajas.mjs) ───────
// Solo Bearer CRON_SECRET (tiempo constante), falla cerrado: sin el secreto configurado 503, con otro 401. Nunca ?key=.
//   · GET (cron diario): vence pedidos, i01 avisos de fin, i05 recontacto (el día BAJA_RECONTACTO_DIA).
//   · GET ?dry=1: lo que haría, sin mandar ni escribir.
//   · GET ?recontacto=1: publica la lista de recontacto del mes aunque no sea el día (si todavía no salió).
//   · GET ?estado=1: modo, capacidades, variables que faltan (nombres) y el estado de cada cliente.
//   · GET ?baja=A123[&motivo=…]: pide a mano la confirmación de la baja en Verificaciones (no da de baja: espera el OK).
//   · GET ?recording_id=123[&quien=tomas|gero_m][&dry=1]: trae la llamada de Fathom y la mira (por si el webhook no llegó).
import { igualesSeguro } from '@/lib/auth/cookie'
import type { AlmacenBajas } from './almacen'
import type { ClienteBaja } from './fin'

type Cabeceras = { get(nombre: string): string | null }

export function autorizarBajas(h: Cabeceras, env: NodeJS.ProcessEnv): { ok: true } | { ok: false; status: 401 | 503 } {
  const secreto = env.CRON_SECRET?.trim()
  if (!secreto) return { ok: false, status: 503 }
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(h.get('authorization') ?? '')
  if (!m || !igualesSeguro(m[1], secreto)) return { ok: false, status: 401 }
  return { ok: true }
}

export interface DepsRutaBajas { env?: NodeJS.ProcessEnv; almacen?: AlmacenBajas; leerClientes?: () => Promise<ClienteBaja[]>; ahora?: () => number; fetch?: typeof fetch; log?: { info(m: string): void; warn(m: string): void; error(m: string): void } }

const limpio = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\d{8,}/g, '[número]').slice(0, 200)

export async function atenderBajas(q: URLSearchParams, deps: DepsRutaBajas = {}): Promise<{ status: number; cuerpo: unknown }> {
  const env = deps.env ?? process.env
  try {
    if (q.get('estado') === '1') {
      const { leerEstadoBajas } = await import('./lectura')
      return { status: 200, cuerpo: await leerEstadoBajas({ env, almacen: deps.almacen }) }
    }
    if (!env.DATABASE_URL?.trim() && !deps.almacen) return { status: 503, cuerpo: { error: 'falta DATABASE_URL' } }
    const dry = q.get('dry') === '1'
    const S = await import('./servidor')
    const op = { env, almacen: deps.almacen, leerClientes: deps.leerClientes, ahora: deps.ahora, fetch: deps.fetch, log: deps.log, dry }
    const salida = (r: Awaited<ReturnType<typeof S.correrDiarioBajasReal>>) => ({ status: 200, cuerpo: { ok: r.errores.length === 0, dry, ...r, errores: r.errores.map(limpio) } })
    const baja = q.get('baja')
    if (baja !== null) {
      if (!/^[A-Za-z]\d{1,5}$/.test(baja.trim())) return { status: 400, cuerpo: { error: 'baja inválida: el ID del CRM, por ejemplo ?baja=A123' } }
      return salida(await S.pedirBajaManualReal(baja.trim().toUpperCase(), 'pedido manual', (q.get('motivo') ?? '').slice(0, 300), op))
    }
    const rec = q.get('recording_id')
    if (rec !== null) {
      const n = Number(rec.trim())
      if (!/^\d{1,16}$/.test(rec.trim()) || !Number.isSafeInteger(n) || n <= 0) return { status: 400, cuerpo: { error: 'recording_id inválido (tiene que ser un entero positivo)' } }
      const quien = q.get('quien') ?? 'tomas'
      if (quien !== 'tomas' && quien !== 'gero_m') return { status: 400, cuerpo: { error: 'quien inválido (tomas o gero_m)' } }
      return salida(await S.procesarGrabacionBajasReal(n, quien, op))
    }
    return salida(await S.correrDiarioBajasReal({ ...op, forzarRecontacto: q.get('recontacto') === '1' }))
  } catch (e) {
    return { status: 500, cuerpo: { ok: false, error: limpio(e) } }
  }
}
