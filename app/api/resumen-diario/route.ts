import { NextResponse } from 'next/server'
import { fetchRawData, invalidarCacheRaw } from '@/lib/rawSheets'
import { fetchCalendlyProximas } from '@/lib/calendly'
import { buildResumenDiario, sendDiscord } from '@/lib/discord'
import { guardarFotoOperativa } from '@/lib/historialOperativo'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cron de Vercel (8:00 AR) o llamada manual. ?preview=1 devuelve el texto sin enviar.
// ?soloFoto=1 solo guarda la foto diaria del semáforo operativo (pestaña "Historial operativo").
// Protegido con CRON_SECRET (Vercel lo manda como Bearer; a mano: ?key=).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get('key') !== secret))
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  try {
    if (url.searchParams.get('soloFoto')) {
      const foto = await guardarFotoOperativa(await fetchRawData())
      if (foto.ok) invalidarCacheRaw()
      return NextResponse.json(foto, { status: foto.ok ? 200 : 500 })
    }
    const [raw, llamadas] = await Promise.all([fetchRawData(), fetchCalendlyProximas(48)])
    const partes = buildResumenDiario(raw, llamadas)
    if (url.searchParams.get('preview')) return NextResponse.json({ preview: partes.join('\n\n') })
    // Foto diaria del semáforo: si falla, el resumen a Discord sale igual
    let foto: { ok: boolean; detalle: string }
    try { foto = await guardarFotoOperativa(raw) }
    catch (e) { foto = { ok: false, detalle: (e as Error).message } }
    if (foto.ok) invalidarCacheRaw()
    else console.error('Historial operativo:', foto.detalle)
    const r = await sendDiscord(partes)
    return NextResponse.json({ ...r, foto }, { status: r.enviado ? 200 : 500 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
