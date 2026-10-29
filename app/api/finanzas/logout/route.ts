import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_FINANZAS } from '@/lib/finanzasAuth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/finanzas/login', req.url), 303)
  res.cookies.set(COOKIE_FINANZAS, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
