import { NextResponse, type NextRequest } from 'next/server'
import { obtenerFinanzas } from '@/lib/finanzas'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/finanzas?mes=YYYY-MM — protegido (proxy.ts + chequeo acá de nuevo)
export async function GET(req: NextRequest) {
  if (!tokenValido(req.cookies.get(COOKIE_FINANZAS)?.value) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const datos = await obtenerFinanzas(req.nextUrl.searchParams.get('mes'))
    return NextResponse.json(datos, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error'
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
