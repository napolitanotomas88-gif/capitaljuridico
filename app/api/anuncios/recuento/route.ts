import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, cronAutorizado, sesionValida } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { recuentoMeta, validarPeriodo } from '@/lib/anuncios/recuento'
import { esCasa } from '@/lib/anuncios/dolar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Recuento de días malos de Meta de un período: /api/anuncios/recuento?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&dolar=oficial
// (un mes entero o fechas elegidas; máximo ~6 meses). Mismo acceso que /api/anuncios.
export async function GET(req: NextRequest) {
  if (!claveConfigurada()) return NextResponse.json({ error: 'Falta configurar la clave del tablero (ANUNCIOS_PASSWORD).' }, { status: 503 })
  if (!sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value) && !cronAutorizado(req) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const periodo = validarPeriodo(p.get('desde'), p.get('hasta'))
  if ('error' in periodo) return NextResponse.json({ error: periodo.error }, { status: 400 })
  const dolar = p.get('dolar') ?? 'oficial'
  if (!esCasa(dolar)) return NextResponse.json({ error: 'Dólar inválido (oficial, blue, bolsa o tarjeta)' }, { status: 400 })
  try {
    const r = await recuentoMeta(periodo.desde, periodo.hasta, dolar)
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
