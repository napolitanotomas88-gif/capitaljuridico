import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_FINANZAS, tokenValido } from '@/lib/finanzasAuth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { sesionDePeticion } from '@/lib/auth/acceso'
import { CORREO_SIN_GOOGLE, firmarTokenBase } from '@/lib/finanzasSkwd/tokenBase'

export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'Cache-Control': 'private, no-store' }

// GET /api/finanzas/base: el token de la base de Finanzas SKWD para quien ya entró a Finanzas (lib/finanzasSkwd/tokenBase.ts).
// Mismo acceso que /api/finanzas (proxy.ts + chequeo acá). Sin SUPABASE_JWT_SECRET: 503 y la pantalla pide el usuario de la base.
export async function GET(req: NextRequest) {
  if (!tokenValido(req.cookies.get(COOKIE_FINANZAS)?.value) && !(await adminPorCabeceras(req.headers)))
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SIN_CACHE })
  const secreto = process.env.SUPABASE_JWT_SECRET?.trim()
  if (!secreto) return NextResponse.json({ error: 'Falta SUPABASE_JWT_SECRET', modo: 'login' }, { status: 503, headers: SIN_CACHE })
  let correo = CORREO_SIN_GOOGLE
  try { correo = sesionDePeticion(req.headers)?.email || CORREO_SIN_GOOGLE } catch { /* sin Google: el correo genérico */ }
  try {
    const { token, vence } = firmarTokenBase(correo, secreto)
    return NextResponse.json({ token, vence, correo }, { headers: SIN_CACHE })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, modo: 'login' }, { status: 503, headers: SIN_CACHE })
  }
}
