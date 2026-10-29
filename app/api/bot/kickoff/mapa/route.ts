import { NextResponse, after } from 'next/server'
import { accesoMaquina } from '@/lib/auth/acceso'
import { enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { baseConfigurada, guardarZonaVideo, leerKickoff } from '@/lib/bot/kickoff/registro'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { QUIENES, varApiKey } from '@/lib/bot/kickoff/grabadores'
import { claveClaude } from '@/lib/bot/kickoff/claude'
import { pantallaFicha, urlDespacho, webhookKickoff } from '@/lib/bot/kickoff/entorno'
import { VERSION_MAPA, versionFfmpeg, zonaDesdeVideo } from '@/lib/bot/kickoff/mapa'
import { atenderMapa, dispararMapaReal } from '@/lib/bot/kickoff/mapa-api'
import { textoAvisoMapa } from '@/lib/bot/kickoff/mensaje'
import { barrerAvisosAds, depsAvisoAdsReales, intentarAvisoAds } from '@/lib/bot/kickoff/aviso-ads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Zona desde el video (tarea c03): mira el mapa que se compartió en pantalla en la kickoff, lo compara con la zona dicha y
// guarda el resultado en cj_kickoffs.zona_video. Detalle en docs/BOT-KICKOFF-CJ.md ("Zona desde el video"),
// lib/bot/kickoff/mapa.ts (Fathom, ffmpeg, Claude) y lib/bot/kickoff/mapa-api.ts (la lógica de esta ruta).
// Todo con "Authorization: Bearer <CRON_SECRET>" (tiempo constante, lib/auth/acceso.ts; nunca ?key=).
// GET: qué está configurado (ffmpeg y si corre, la clave de Claude, de quién hay API key de Fathom: solo nombres).
// POST: la dispara procesar.ts con la ficha "lista" ({recording_id, quien, descarga_id}); con ficha guardada responde 202 y
// mira el video en after() (hasta maxDuration). Con dry solo verifica y no escribe. Ver mapa-api.ts. Un error pasajero se
// reintenta una vez solo (redisparar: esta misma ruta, con la descarga ya pedida). Con KICKOFF_AVISO_MAPA=1 (apagado por
// defecto, decisión pendiente de Tomás), cuando el mapa no coincide con lo dicho, no se lee o no aparece, sale un renglón a
// #📝-kickoff SIN menciones (un webhook de Discord no puede responder a otro mensaje: va suelto, con el link a la ficha).
// Aviso a Valentino «🚀 Para lanzar» (aviso-ads.ts): cuando la lectura termina (en cualquier estado final), sale el que quedó
// pendiente al marcar la ficha lista, con la zona leída; solo con KICKOFF_AVISO_ADS=1 (apagado por defecto desde el 26/10) y con canal
// (DISCORD_WEBHOOK_KICKOFF_ADS o DISCORD_WEBHOOK_ANUNCIOS). Al final de la lectura corre también el barrido de los
// pendientes de otras grabaciones (barrerAvisosAds).
const TOPE_AVISO_MAPA_MS = 15_000

export async function POST(req: Request) {
  const webhook = process.env.KICKOFF_AVISO_MAPA?.trim() === '1' ? webhookKickoff() : ''
  const ads = depsAvisoAdsReales()
  return atenderMapa(req, {
    clienteOperativo,
    autorizado: r => accesoMaquina(r.headers),
    baseConfigurada,
    leerKickoff,
    guardarZonaVideo: (id, zv, op) => guardarZonaVideo(id, zv, op),
    zonaDesdeVideo,
    enSegundoPlano: fn => after(async () => {
      try {
        await fn()
      } catch (e) {
        console.error('bot-kickoff-mapa: falla inesperada en segundo plano —', ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
      }
    }),
    ahora: () => Date.now(),
    redisparar: (datos, topeMs) => dispararMapaReal(datos, topeMs),
    ...(webhook ? {
      avisarMapa: async (ficha, zv, deadline) => {
        const texto = textoAvisoMapa(ficha, zv, { base: urlDespacho(), pantalla: pantallaFicha() })
        if (texto) await enviarDiscord(webhook, [texto], [], { deadline: Math.min(deadline, Date.now() + TOPE_AVISO_MAPA_MS), reintentos429: 1 })
      },
    } : {}),
    ...(ads ? {
      avisarAds: async (id, zv, deadline) => {
        const r = await intentarAvisoAds(id, ads, { deadline, listo: true, zv })
        if (r.estado !== 'no_corresponde' && r.estado !== 'ya_salio') console.log(`bot-kickoff-mapa: grabación ${id}, aviso a Valentino → ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}`)
      },
      // Al final de la lectura, los pendientes de otras grabaciones (como el barrido del webhook)
      barrerAds: async deadline => {
        for (const x of await barrerAvisosAds(ads, { deadline })) {
          if (x.ads.estado !== 'esperando_mapa') console.log(`bot-kickoff-mapa: barrido, grabación ${x.recording_id} → aviso a Valentino: ${x.ads.estado}${x.ads.motivo ? ` (${x.ads.motivo})` : ''}`)
        }
      },
    } : {}),
  })
}

export async function GET(req: Request) {
  if (!accesoMaquina(req.headers)) return NextResponse.json({ error: 'no autorizado' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({
    version: VERSION_MAPA,
    ffmpeg: await versionFfmpeg(),
    anthropic: !!claveClaude(),
    fathom_api: QUIENES.filter(q => !!process.env[varApiKey(q)]?.trim()),
    base: baseConfigurada(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
