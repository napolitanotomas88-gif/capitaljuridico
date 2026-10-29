import { NextResponse, type NextRequest } from 'next/server'
import {
  COOKIE_FINANZAS, DURACION_SESION_S, bloqueadoPorIntentos, crearToken, limpiarFallos,
  passwordConfigurada, passwordCorrecta, registrarFallo,
} from '@/lib/finanzasAuth'

export const dynamic = 'force-dynamic'

// POST (form) password=… → cookie de sesión firmada y vuelta a /finanzas
export async function POST(req: NextRequest) {
  const volver = (q: string) => NextResponse.redirect(new URL(`/finanzas/login${q}`, req.url), 303)
  if (!passwordConfigurada()) return volver('?error=config')
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (bloqueadoPorIntentos(ip)) return volver('?error=intentos')
  const form = await req.formData().catch(() => null)
  const intento = (form?.get('password') ?? '').toString()
  if (!passwordCorrecta(intento)) {
    registrarFallo(ip)
    await new Promise(r => setTimeout(r, 700))   // enlentece la fuerza bruta
    return volver('?error=1')
  }
  limpiarFallos(ip)
  const token = crearToken()!
  const res = NextResponse.redirect(new URL('/finanzas', req.url), 303)
  res.cookies.set(COOKIE_FINANZAS, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: DURACION_SESION_S,
  })
  return res
}
