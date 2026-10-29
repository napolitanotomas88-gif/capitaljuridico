import { NextResponse } from 'next/server'
import { revisarEspaciosAgenda } from '@/lib/agendaSlots'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Notificador de espacios de agenda (Calendly ventas → Discord con @).
// ?preview=1 calcula sin mandar ni guardar · ?forzar=1 manda el estado actual con @ (prueba).
// Protegido con CRON_SECRET (Bearer o ?key=). Falla CERRADO: sin CRON_SECRET definido no responde
// (?forzar=1 arroba a personas: no puede quedar público por una env faltante).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get('key') !== secret))
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  try {
    const r = await revisarEspaciosAgenda({ preview: !!url.searchParams.get('preview'), forzar: !!url.searchParams.get('forzar') })
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
