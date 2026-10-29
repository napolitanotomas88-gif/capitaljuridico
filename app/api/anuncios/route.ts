import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, cronAutorizado, sesionValida } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { invalidarCacheAnuncios } from '@/lib/anuncios/cache'
import { obtenerTablero } from '@/lib/anuncios/tablero'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET carga el tablero desde caché; POST actualiza las fuentes al pulsar el botón.
// Acceso: cookie de sesión del tablero o CRON_SECRET.
async function responder(req: NextRequest, actualizar = false) {
  if (!claveConfigurada()) return NextResponse.json({ error: 'Falta configurar la clave del tablero (ANUNCIOS_PASSWORD).' }, { status: 503 })
  if (!sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value) && !cronAutorizado(req) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    if (actualizar) await invalidarCacheAnuncios()
    const tablero = await obtenerTablero()
    return NextResponse.json(tablero, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return responder(req) }
export async function POST(req: NextRequest) { return responder(req, true) }
