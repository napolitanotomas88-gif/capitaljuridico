import { NextResponse, type NextRequest } from 'next/server'
import {
  COOKIE_ANUNCIOS, DURACION_SESION_S, bloqueadoPorIntentos, claveConfigurada, claveCorrecta, crearSesion, limpiarFallos, registrarFallo,
} from '@/lib/anuncios/auth'

export const dynamic = 'force-dynamic'

// POST (form) clave=… → cookie de sesión firmada y vuelta a /anuncios
export async function POST(req: NextRequest) {
  const volver = (q: string) => NextResponse.redirect(new URL(`/anuncios/login${q}`, req.url), 303)
  if (!claveConfigurada()) return volver('?error=config')
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (bloqueadoPorIntentos(ip)) return volver('?error=intentos')
  const form = await req.formData().catch(() => null)
  const intento = (form?.get('clave') ?? '').toString()
  if (!claveCorrecta(intento)) {
    registrarFallo(ip)
    await new Promise(r => setTimeout(r, 700))   // enlentece la fuerza bruta
    return volver('?error=1')
  }
  limpiarFallos(ip)
  const res = NextResponse.redirect(new URL('/anuncios', req.url), 303)
  res.cookies.set(COOKIE_ANUNCIOS, crearSesion()!, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: DURACION_SESION_S,
  })
  return res
}
