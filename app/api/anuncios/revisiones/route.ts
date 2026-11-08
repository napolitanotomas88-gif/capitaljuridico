import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, cronAutorizado, sesionValida } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { leerRevisiones, vistaRevisiones } from '@/lib/anuncios/revisiones'
import { hoyAR } from '@/lib/anuncios/formato'

export const dynamic = 'force-dynamic'

// Pruebas y cambios para revisar (pestaña «Ads Revisiones» de la planilla de Clientes). Mismo acceso que el tablero.
export async function GET(req: NextRequest) {
  if (!claveConfigurada()) return NextResponse.json({ error: 'Falta configurar la clave del tablero (ANUNCIOS_PASSWORD).' }, { status: 503 })
  if (!sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value) && !cronAutorizado(req) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const hoy = hoyAR()
    return NextResponse.json({ hoy, revisiones: vistaRevisiones(await leerRevisiones(), hoy) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
