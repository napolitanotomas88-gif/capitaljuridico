import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_FINANZAS } from '@/lib/finanzasAuth'
import { correoFinanzas } from '@/lib/finanzasSkwd/correoSesion'
import { correrPedido, type Pedido } from '@/lib/finanzasSkwd/baseNeon'

export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'Cache-Control': 'private, no-store' }

// /api/finanzas/db: la base de Finanzas SKWD (Neon, lib/finanzasSkwd/baseNeon.ts) para quien ya entró a Finanzas.
// Mismo acceso que /api/finanzas (proxy.ts + chequeo acá). GET: el correo con el que se firma; POST: un pedido.
const correoSiAutorizado = (req: NextRequest) => correoFinanzas(req.headers, req.cookies.get(COOKIE_FINANZAS)?.value)

export async function GET(req: NextRequest) {
  const correo = await correoSiAutorizado(req)
  if (!correo) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SIN_CACHE })
  if (!process.env.DATABASE_URL?.trim()) return NextResponse.json({ error: 'Falta DATABASE_URL' }, { status: 503, headers: SIN_CACHE })
  return NextResponse.json({ correo }, { headers: SIN_CACHE })
}

export async function POST(req: NextRequest) {
  const correo = await correoSiAutorizado(req)
  if (!correo) return NextResponse.json({ data: null, error: { message: 'No autorizado', code: '401' } }, { status: 401, headers: SIN_CACHE })
  let pedido: Pedido
  try { pedido = (await req.json()) as Pedido } catch {
    return NextResponse.json({ data: null, error: { message: 'Pedido inválido', code: '400' } }, { status: 400, headers: SIN_CACHE })
  }
  return NextResponse.json(await correrPedido(pedido, correo), { headers: SIN_CACHE })
}
