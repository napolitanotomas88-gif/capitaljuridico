import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, cronAutorizado, sesionValida } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { obtenerTablero } from '@/lib/anuncios/tablero'
import { generarReportePDF } from '@/lib/anuncios/pdf'
import { recuentoMeta } from '@/lib/anuncios/recuento'
import { hoyAR, sumarDias } from '@/lib/anuncios/formato'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Descarga del reporte semanal en PDF desde el tablero (mismo acceso que /api/anuncios)
export async function GET(req: NextRequest) {
  if (!claveConfigurada()) return NextResponse.json({ error: 'Falta configurar la clave del tablero.' }, { status: 503 })
  if (!sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value) && !cronAutorizado(req) && !(await adminPorCabeceras(req.headers))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const tablero = await obtenerTablero()
    const ayer = sumarDias(hoyAR(), -1)
    const mes = await recuentoMeta(`${ayer.slice(0, 7)}-01`, ayer, 'bolsa').catch(() => null)
    const pdf = await generarReportePDF(tablero, mes)
    return new NextResponse(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="reporte-anuncios-${tablero.hoy}.pdf"`, 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
