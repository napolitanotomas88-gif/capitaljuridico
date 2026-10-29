import { NextResponse } from 'next/server'
import { fetchRawData } from '@/lib/rawSheets'
import { fetchCalendlyCreadas, fetchCalendlyProximas, fetchRoutingPerdidos, CALENDLY_VENTAS } from '@/lib/calendly'
import { armarEnrutamientosPerdidos, sendDiscord } from '@/lib/discord'
import { registrarEnrutamiento } from '@/lib/enrutamientoSheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// "Enrutamientos perdidos" del DÍA ANTERIOR: cron de Vercel (8:05 AR) o llamada manual.
// 1) escribe las filas en el sheet de Ventas (pestañas "Enrutamientos perdidos", "No-shows",
//    "Leads IG sin asignar" y "Resumen enrutamiento", idempotente por fecha) y 2) manda el
//    reporte al canal propio (DISCORD_WEBHOOK_ENRUTAMIENTO; si falta, cae en DISCORD_WEBHOOK_URL).
// ?preview=1 devuelve el texto sin escribir ni enviar · ?soloSheet=1 escribe sin mandar a Discord.
// Protegido con CRON_SECRET (Bearer o ?key=).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get('key') !== secret))
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  try {
    // Reservas/cancelaciones y llamadas de hoy: de la cuenta de VENTAS (toda la organización: Carlos, Gero, Marcos).
    // Si no hay token de ventas, cae en la cuenta por defecto (solo kick-offs/proyección).
    const ventas = CALENDLY_VENTAS.token ? CALENDLY_VENTAS : undefined
    const [raw, cal, proximas, routing] = await Promise.all([
      fetchRawData(), fetchCalendlyCreadas(-1, ventas), fetchCalendlyProximas(20, ventas), fetchRoutingPerdidos(-1),
    ])
    const { partes, registro } = armarEnrutamientosPerdidos(raw, cal, proximas, routing)
    if (url.searchParams.get('preview')) return NextResponse.json({ preview: partes.join('\n\n'), registro })
    const sheet = await registrarEnrutamiento(registro)
    if (url.searchParams.get('soloSheet')) return NextResponse.json({ sheet })
    const r = await sendDiscord(partes, process.env.DISCORD_WEBHOOK_ENRUTAMIENTO)
    return NextResponse.json({ ...r, sheet }, { status: r.enviado ? 200 : 500 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
