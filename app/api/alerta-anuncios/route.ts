import { NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/anuncios/auth'
import { obtenerTablero } from '@/lib/anuncios/tablero'
import { alertaDiaria } from '@/lib/anuncios/discord'
import { sendDiscord } from '@/lib/discord'
import { correrSeguimiento, correrVideos } from '@/lib/bot/anuncios/servidor'
import { resumenEquipoWhatsapp } from '@/lib/bot/anuncios/whatsappEquipoServidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // los borradores de g03 esperan que Meta procese los videos

// Alerta DIARIA de anuncios (cron de Vercel 11:45 UTC = 8:45 AR). Solo manda si hay rojos nuevos
// o algo urgente (pago, saldo, gasto sin mensajes, token por vencer); si todo está bien, no manda.
// Después, con el MISMO tablero, el seguimiento del bot C.J. (lib/bot/anuncios, docs/BOT-ANUNCIOS-CJ.md): los
// recordatorios de optimización a Valentino y los textos para avisarle al cliente, una vez cada uno. Corre aunque la
// alerta no tenga nada que mandar; si falla, la alerta no se entera. ANUNCIOS_SEGUIMIENTO=0 lo apaga.
// Al final, los videos nuevos en «Editados - X» (g01, lib/bot/anuncios/videos.ts): un aviso a Valentino por subida.
// ANUNCIOS_VIDEOS=0 lo apaga.
// Y lo que salió por Discord va también, en UN solo mensaje, al grupo ADS de WhatsApp (whatsappEquipo.ts), solo con
// ANUNCIOS_WHATSAPP_EQUIPO=real.
// ?preview (con cualquier valor, también vacío) devuelve los textos sin mandar nada (tampoco registra ni reclama). Protegido con CRON_SECRET (Bearer o ?key=).
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const url = new URL(req.url)
  const inicio = Date.now()
  try {
    const tablero = await obtenerTablero()
    const partes = alertaDiaria(tablero)
    const deadline = inicio + (maxDuration - 10) * 1000
    const seguimiento = (dry: boolean) => correrSeguimiento(tablero, { dry, deadline })
    const videos = (dry: boolean) => correrVideos(tablero, { dry, deadline })
    if (url.searchParams.has('preview'))
      return NextResponse.json({ preview: partes.length ? partes.join('\n\n') : '(nada urgente: hoy no se mandaría ninguna alerta)', seMandaria: partes.length > 0, resumen: tablero.resumen, seguimiento: await seguimiento(true), videos: await videos(true) })
    let alerta: Record<string, unknown>
    let status = 200
    if (!partes.length) alerta = { enviado: false, motivo: 'Todo en orden: no hay nada urgente, no se manda alerta.' }
    else {
      const webhook = process.env.DISCORD_WEBHOOK_ANUNCIOS
      if (!webhook) { alerta = { enviado: false, error: 'Falta configurar DISCORD_WEBHOOK_ANUNCIOS: no se mandó la alerta.' }; status = 500 }
      else {
        const r = await sendDiscord(partes, webhook)
        alerta = { ...r }
        if (!r.enviado) status = 500
      }
    }
    const seg = await seguimiento(false)
    const vid = await videos(false)
    return NextResponse.json({ ...alerta, seguimiento: seg, videos: vid, whatsappEquipo: await resumenEquipoWhatsapp(seg, vid) }, { status })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
