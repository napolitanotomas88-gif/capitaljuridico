import { NextResponse } from 'next/server'
import { autorizarCron } from '@/lib/bot/grabacion/acceso'
import { despacharNotifWhatsappReal, estadoNotifWhatsapp } from '@/lib/notificaciones/whatsapp/servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Salida única de WhatsApp de la bandeja central (docs/NOTIF-WHATSAPP.md). Se autentica sola (regla `propio` en
// lib/auth/rutas.ts, ANTES de '/api/notificaciones/*'), solo con `Authorization: Bearer <CRON_SECRET>` (nunca ?key=):
//   · POST → una corrida del despachador (lo mismo que hace el vigía cada 15 min). Con NOTIF_WHATSAPP apagado no hace nada.
//   · GET  → variables (sí/no, nunca el valor), cuentas por estado de los últimos 7 días y los últimos 30 registros.
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })
const motivo = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export async function POST(req: Request) {
  const a = autorizarCron(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  try {
    return json({ ok: true, ...(await despacharNotifWhatsappReal()) })
  } catch (e) {
    return json({ ok: false, error: motivo(e) }, 500)
  }
}

export async function GET(req: Request) {
  const a = autorizarCron(req.headers, process.env)
  if (!a.ok) return json({ error: a.status === 503 ? 'no configurado' : 'no autorizado' }, a.status)
  try {
    return json({ ok: true, ...(await estadoNotifWhatsapp()) })
  } catch (e) {
    return json({ ok: false, error: motivo(e) }, 500)
  }
}
