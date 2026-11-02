import { NextResponse } from 'next/server'
import { autorizarBajas } from '@/lib/bot/bajas/ruta'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Continuidad: la LLAMADA DE PROYECCIÓN (lib/bot/proyeccion). Regla 'propio' en lib/auth/rutas.ts: solo
// `Authorization: Bearer <CRON_SECRET>` (nunca ?key=). Sin CRON_SECRET → 503; con otro → 401.
//   · GET (cron de vercel.json, 10:40 y 18:00 de Argentina): invitación en 📤 a −14, tarea en 🛠️ a −7 / −5 / −3 y
//     «Agendada» desde Calendly con aviso en ✅. Idempotente: la segunda corrida del día no repite nada.
//   · ?dry=1: lo que haría (quiénes caen y en qué paso), sin mandar ni escribir.
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const limpio = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export async function GET(req: Request) {
  const a = autorizarBajas(req.headers, process.env)
  if (!a.ok) return NextResponse.json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, { status: a.status, headers: SIN_CACHE })
  try {
    const { correrProyeccionReal } = await import('@/lib/bot/proyeccion/servidor')
    const r = await correrProyeccionReal({ dry: new URL(req.url).searchParams.get('dry') === '1' })
    return NextResponse.json({ ok: r.errores.length === 0, ...r, errores: r.errores.map(limpio) }, { headers: SIN_CACHE })
  } catch (e) {
    return NextResponse.json({ ok: false, error: limpio(e) }, { status: 500, headers: SIN_CACHE })
  }
}
