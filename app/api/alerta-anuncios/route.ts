import { NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/anuncios/auth'
import { obtenerTablero } from '@/lib/anuncios/tablero'
import { alertaDiaria } from '@/lib/anuncios/discord'
import { sendDiscord } from '@/lib/discord'
import { correrSeguimiento, correrVideos } from '@/lib/bot/anuncios/servidor'
import { resumenEquipoWhatsapp } from '@/lib/bot/anuncios/whatsappEquipoServidor'
import { correrTrabados } from '@/lib/bot/anuncios/trabadosAviso'
import { correrDocAds } from '@/lib/bot/anuncios/docAdsServidor'
import { cubiertosPorDoc } from '@/lib/bot/anuncios/docAdsLanzar'
import { barrerCuentasTempranas } from '@/lib/bot/kickoff/cuentaTempranaServidor'
import { correrKickoffsPerdidas } from '@/lib/bot/kickoff/kickoffPerdida'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // los borradores de g03 esperan que Meta procese los videos

// Alerta DIARIA de anuncios (cron de Vercel 12:05 UTC = 9:05 AR; desde el 2/11, para que el WhatsApp al cliente de g04
// caiga dentro del horario 9 a 20 h). Solo manda si hay rojos nuevos
// o algo urgente (pago, saldo, gasto sin mensajes, token por vencer); si todo está bien, no manda.
// Después, con el MISMO tablero, el seguimiento del bot C.J. (lib/bot/anuncios, docs/BOT-ANUNCIOS-CJ.md): los
// recordatorios de optimización a Valentino y los textos para avisarle al cliente, una vez cada uno. Corre aunque la
// alerta no tenga nada que mandar; si falla, la alerta no se entera. ANUNCIOS_SEGUIMIENTO=0 lo apaga.
// Al final, los videos nuevos en «Editados - X» (g01, lib/bot/anuncios/videos.ts): un aviso a Valentino por subida.
// ANUNCIOS_VIDEOS=0 lo apaga.
// Y lo que salió por Discord va también, en UN solo mensaje, al grupo ADS de WhatsApp (whatsappEquipo.ts), solo con
// ANUNCIOS_WHATSAPP_EQUIPO=real.
// Y los CLIENTES TRABADOS antes de lanzar (3/11, lib/bot/anuncios/trabadosAviso.ts): kickoff de hace más de 7 días y sin
// campaña, con la etapa, el motivo y el responsable; UN mensaje en #📣-ads, una vez por cliente por etapa. ANUNCIOS_TRABADOS=0 lo apaga.
// Y el DOC DE ADS («Organización de ADS - Orgánico», 3/11, lib/bot/anuncios/docAdsLanzar.ts): ANTES de los videos, cada cliente
// por lanzar marcado LISTO en el Doc → campaña nueva EN PAUSA con esos videos y su copy + aviso a Valen. g01 no le arma otro
// lanzamiento desde «Editados» a esos clientes. ANUNCIOS_DOC_ADS=0 lo apaga.
// Y la vigilancia de la etapa Kickoff (3/11): las kickoffs de Fathom con más de 48 h sin ficha lista (aviso en #📝-kickoff y
// reintento, lib/bot/kickoff/kickoffPerdida.ts; KICKOFF_PERDIDAS=0 lo apaga) y las fichas listas sin cuenta de Meta o sin
// acceso del token (aviso en #📣-ads con la candidata, cuentaTempranaServidor.ts; KICKOFF_CUENTA_TEMPRANA=0 lo apaga).
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
    const videos = (dry: boolean, cubiertos?: ReadonlySet<string>) => correrVideos(tablero, { dry, deadline, cubiertos })
    if (url.searchParams.has('preview')) {
      const doc = await correrDocAds(tablero, { dry: true, deadline })
      return NextResponse.json({ preview: partes.length ? partes.join('\n\n') : '(nada urgente: hoy no se mandaría ninguna alerta)', seMandaria: partes.length > 0, resumen: tablero.resumen, seguimiento: await seguimiento(true), docAds: doc, videos: await videos(true, 'clientes' in doc ? cubiertosPorDoc(doc) : undefined), trabados: await correrTrabados(tablero, { dry: true }), cuentasTempranas: await barrerCuentasTempranas(tablero, { dry: true }), kickoffsPerdidas: await correrKickoffsPerdidas({ dry: true, tablero }) })
    }
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
    const doc = await correrDocAds(tablero, { deadline })
    const vid = await videos(false, 'clientes' in doc ? cubiertosPorDoc(doc) : undefined)
    const trabados = await correrTrabados(tablero)
    const cuentasTempranas = await barrerCuentasTempranas(tablero)
    const kickoffsPerdidas = await correrKickoffsPerdidas({ tablero })
    return NextResponse.json({ ...alerta, seguimiento: seg, docAds: doc, videos: vid, trabados, cuentasTempranas, kickoffsPerdidas, whatsappEquipo: await resumenEquipoWhatsapp(seg, vid) }, { status })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
