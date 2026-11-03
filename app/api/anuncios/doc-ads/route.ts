// ── Doc de ADS a pedido: el botón «Leer el Doc de ADS ahora» de /anuncios (3/11/2026) ─────────────────────────────
// POST: la MISMA corrida que la alerta de las 9:05 (docAdsLanzar.ts): cada cliente por lanzar marcado LISTO en el Doc →
//   campaña nueva EN PAUSA + aviso a Valen en #📣-ads, una vez por juego de videos. Nada se prende en Meta.
// GET: solo lee (no reclama, no manda, no crea): el estado del Doc de cada cliente por lanzar. Con ?seco=1 arma en SECO
//   (lee de Meta, no escribe nada) y devuelve qué borrador saldría; &cliente=<id del CRM o nombre> lo limita a uno.
// Sesión de /anuncios, CRON_SECRET o la llave de admin.
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_ANUNCIOS, claveConfigurada, sesionValida, cronAutorizado } from '@/lib/anuncios/auth'
import { adminPorCabeceras } from '@/lib/auth/llaveAdmin'
import { obtenerTablero } from '@/lib/anuncios/tablero'
import { correrDocAds } from '@/lib/bot/anuncios/docAdsServidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function autorizado(req: NextRequest): Promise<boolean> {
  return (await adminPorCabeceras(req.headers)) || cronAutorizado(req) || (!!claveConfigurada() && sesionValida(req.cookies.get(COOKIE_ANUNCIOS)?.value))
}

async function correr(req: NextRequest, op: { dry: boolean; seco: boolean }) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const inicio = Date.now()
  try {
    const u = new URL(req.url)
    const tablero = await obtenerTablero()
    const r = await correrDocAds(tablero, { ...op, solo: u.searchParams.get('cliente'), deadline: inicio + (maxDuration - 10) * 1000 })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const seco = new URL(req.url).searchParams.get('seco') === '1'
  return correr(req, { dry: true, seco })
}

export async function POST(req: NextRequest) {
  return correr(req, { dry: false, seco: false })
}
