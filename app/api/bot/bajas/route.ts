import { NextResponse } from 'next/server'
import { autorizarBajas, atenderBajas } from '@/lib/bot/bajas/ruta'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

// Etapa BAJA DEL CLIENTE del bot "Capital Jurídico" (docs/BOT-BAJAS-CJ.md). Regla 'propio' en lib/auth/rutas.ts: se
// autentica sola, SOLO con `Authorization: Bearer <CRON_SECRET>` (nunca ?key=). Sin CRON_SECRET → 503; con otro → 401.
//   · GET (el cron diario de vercel.json, "30 13 * * *" = 10:30 de Argentina): vence pedidos, pide el OK del aviso de fin
//     (14 días antes del fin real) y, el día BAJA_RECONTACTO_DIA, publica la lista de recontacto. Nace en seco (BOT_BAJAS_MODO).
//   · ?dry=1 (lo que haría, sin mandar ni escribir) · ?recontacto=1 · ?estado=1 · ?baja=A123 · ?recording_id=123[&quien=…].
const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(req: Request) {
  const a = autorizarBajas(req.headers, process.env)
  if (!a.ok) return NextResponse.json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, { status: a.status, headers: SIN_CACHE })
  const r = await atenderBajas(new URL(req.url).searchParams)
  return NextResponse.json(r.cuerpo, { status: r.status, headers: SIN_CACHE })
}
