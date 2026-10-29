import { NextResponse } from 'next/server'
import { autorizarExito, atenderExito } from '@/lib/bot/exito/ruta'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Etapa ÉXITO DEL CLIENTE del bot "Capital Jurídico" (docs/BOT-EXITO-CJ.md). Regla 'propio' en lib/auth/rutas.ts: se
// autentica sola, SOLO con `Authorization: Bearer <CRON_SECRET>` (nunca ?key=). Sin CRON_SECRET → 503; con otro → 401.
//   · GET (el cron diario de vercel.json, "0 13 * * *" = 10:00 de Argentina): vence pedidos, vincula las respuestas de la
//     encuesta a su ronda, el día 1 publica la lista de la encuesta en Verificaciones (sale solo con el OK), sigue un lote
//     aprobado y manda el recordatorio a los 3 días. Nace en seco (BOT_EXITO_MODO).
//   · GET ?dry=1: lo que haría, sin mandar ni escribir nada.
//   · GET ?lista=1: publica la lista de la encuesta del mes aunque no sea el día 1 (si el cron de ese día falló).
//   · GET ?estado=1: modo, capacidades, variables que faltan (nombres) y el estado de cada cliente (leerEstadoExito).
const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(req: Request) {
  const a = autorizarExito(req.headers, process.env)
  if (!a.ok) return NextResponse.json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, { status: a.status, headers: SIN_CACHE })
  const r = await atenderExito(new URL(req.url).searchParams)
  return NextResponse.json(r.cuerpo, { status: r.status, headers: SIN_CACHE })
}
