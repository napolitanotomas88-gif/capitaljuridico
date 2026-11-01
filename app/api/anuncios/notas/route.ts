import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, cronAutorizado, sesionValida } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { listarNotas } from '@/lib/bot/anuncios/notasNeon'

export const dynamic = 'force-dynamic'

// Notas del cliente (lo que dijo de sus anuncios en su grupo de WhatsApp, lib/bot/anuncios/notas.ts), últimos 60 días.
// Mismo acceso que el tablero: cookie de Anuncios, CRON_SECRET o administrador.
export async function GET(req: NextRequest) {
  if (!claveConfigurada()) return NextResponse.json({ error: 'Falta configurar la clave del tablero (ANUNCIOS_PASSWORD).' }, { status: 503 })
  if (!sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value) && !cronAutorizado(req) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return NextResponse.json({ notas: await listarNotas() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
