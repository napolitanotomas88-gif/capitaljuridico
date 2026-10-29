import { NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/anuncios/auth'
import { obtenerTablero } from '@/lib/anuncios/tablero'
import { enviarPDFDiscord, reporteSemanal } from '@/lib/anuncios/discord'
import { generarReportePDF } from '@/lib/anuncios/pdf'
import { recuentoMeta } from '@/lib/anuncios/recuento'
import { hoyAR, sumarDias } from '@/lib/anuncios/formato'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Reporte SEMANAL de anuncios (cron de Vercel los lunes 11:00 UTC = 8:00 AR): un mensaje en el
// canal de anuncios (DISCORD_WEBHOOK_ANUNCIOS) que arroba a Tomás y a Gero, con resumen y el PDF.
// ?preview=1 devuelve el texto sin mandar; ?pdf=1 devuelve el PDF. Protegido con CRON_SECRET (Bearer o ?key=).
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const url = new URL(req.url)
  try {
    const tablero = await obtenerTablero()
    // Recuento de días malos del mes en curso (del 1 a ayer); si falla, el reporte sale igual sin esa parte
    const ayer = sumarDias(hoyAR(), -1)
    const mes = await recuentoMeta(`${ayer.slice(0, 7)}-01`, ayer, 'bolsa').catch(() => null)
    if (url.searchParams.get('preview')) return NextResponse.json({ preview: reporteSemanal(tablero, new Date(), mes).join('\n\n'), resumen: tablero.resumen, avisos: tablero.avisos })
    const pdf = await generarReportePDF(tablero, mes)
    const nombre = `reporte-anuncios-${tablero.hoy}.pdf`
    if (url.searchParams.get('pdf'))
      return new NextResponse(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` } })
    const webhook = process.env.DISCORD_WEBHOOK_ANUNCIOS
    if (!webhook) return NextResponse.json({ enviado: false, error: 'Falta configurar DISCORD_WEBHOOK_ANUNCIOS: no se mandó el reporte.' }, { status: 500 })
    const r = await enviarPDFDiscord(webhook, tablero, pdf, nombre)
    return NextResponse.json(r, { status: r.enviado ? 200 : 500 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
