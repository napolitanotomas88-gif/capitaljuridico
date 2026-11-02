import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_FINANZAS } from '@/lib/finanzasAuth'
import { correoFinanzas } from '@/lib/finanzasSkwd/correoSesion'
import { baseConfigurada, guardarPreferencias, leerPreferencias, normalizarPreferencias } from '@/lib/finanzasSkwd/preferencias'

export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'Cache-Control': 'private, no-store' }

// /api/finanzas/preferencias: modo nocturno y barra abierta/cerrada del diseño de cristal, guardados POR CUENTA (correo de
// la sesión de Finanzas). Mismo acceso que /api/finanzas/db. GET: lo guardado (o null); POST { noche?, nav? }: lo suma.
export async function GET(req: NextRequest) {
  const correo = await correoFinanzas(req.headers, req.cookies.get(COOKIE_FINANZAS)?.value)
  if (!correo) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SIN_CACHE })
  if (!baseConfigurada()) return NextResponse.json({ error: 'Falta DATABASE_URL' }, { status: 503, headers: SIN_CACHE })
  try {
    return NextResponse.json({ correo, prefs: await leerPreferencias(correo) }, { headers: SIN_CACHE })
  } catch {
    return NextResponse.json({ error: 'No se pudieron leer las preferencias' }, { status: 502, headers: SIN_CACHE })
  }
}

export async function POST(req: NextRequest) {
  const correo = await correoFinanzas(req.headers, req.cookies.get(COOKIE_FINANZAS)?.value)
  if (!correo) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SIN_CACHE })
  if (!baseConfigurada()) return NextResponse.json({ error: 'Falta DATABASE_URL' }, { status: 503, headers: SIN_CACHE })
  let cambios
  try { cambios = normalizarPreferencias(await req.json()) } catch {
    return NextResponse.json({ error: 'Pedido inválido' }, { status: 400, headers: SIN_CACHE })
  }
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: 'Nada para guardar' }, { status: 400, headers: SIN_CACHE })
  try {
    return NextResponse.json({ correo, prefs: await guardarPreferencias(correo, cambios) }, { headers: SIN_CACHE })
  } catch {
    return NextResponse.json({ error: 'No se pudieron guardar las preferencias' }, { status: 502, headers: SIN_CACHE })
  }
}
