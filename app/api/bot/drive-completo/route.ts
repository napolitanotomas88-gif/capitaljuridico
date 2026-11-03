import { NextResponse } from 'next/server'
import { autorizarBajas } from '@/lib/bot/bajas/ruta'
import { modoDriveCompleto, TOPE_POR_CORRIDA } from '@/lib/bot/alta/driveCompleto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Revisión diaria «Drive completo» (docs/BOT-ALTA-CJ.md): todo cliente activo tiene su carpeta «<Nombre> - C.J» con Crudos,
// Editados, Marca y Guiones (y la bienvenida, si es reciente). Regla 'propio' en lib/auth/rutas.ts: SOLO
// `Authorization: Bearer <CRON_SECRET>` (nunca ?key=). Sin CRON_SECRET → 503; con otro → 401.
//   · GET (cron diario de vercel.json, "30 12 * * *" = 9:30 de Argentina): corre en el modo de BOT_DRIVE_COMPLETO_MODO
//     (ensayo por defecto: no escribe ni avisa; real; apagado).
//   · ?dry=1: ensayo aunque el modo sea real. ?tope=N: tope de clientes con llamadas al Puente (por defecto 10, máximo 25).
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const limpio = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export async function GET(req: Request) {
  const inicio = Date.now()
  const a = autorizarBajas(req.headers, process.env)
  if (!a.ok) return NextResponse.json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, { status: a.status, headers: SIN_CACHE })
  const q = new URL(req.url).searchParams
  const modo = q.get('dry') === '1' ? 'ensayo' : modoDriveCompleto()
  if (modo === 'apagado') return NextResponse.json({ ok: true, modo, nada: 'BOT_DRIVE_COMPLETO_MODO=apagado' }, { headers: SIN_CACHE })
  // Sin ?tope (el cron) va el de por defecto: Number(null) es 0 y dejaba la corrida sin hacer nada (revisión 2/11/2026)
  const crudo = q.get('tope')
  const t = crudo !== null && crudo.trim() !== '' ? Number(crudo) : NaN
  const tope = Number.isInteger(t) && t >= 0 ? Math.min(t, 25) : TOPE_POR_CORRIDA
  try {
    const { correrDriveCompletoReal } = await import('@/lib/bot/alta/driveCompletoServidor')
    const r = await correrDriveCompletoReal({ modo, tope, inicio, deadline: inicio + 240_000 })
    return NextResponse.json({ ok: r.errores.length === 0, ...r, errores: r.errores.map(limpio) }, { headers: SIN_CACHE })
  } catch (e) {
    return NextResponse.json({ ok: false, error: limpio(e) }, { status: 500, headers: SIN_CACHE })
  }
}
