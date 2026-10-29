import { after } from 'next/server'
import { asegurarUsuarios } from '@/lib/auth/accesos'
import { exigirAccesoApi, sesionDePeticion } from '@/lib/auth/acceso'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { atenderPost, type AvisoDiscord } from '@/lib/bot/kickoff/acciones'
import { baseConfigurada, guardarCheckPortfolio, guardarMarcaFaltante, guardarRevision, leerKickoff } from '@/lib/bot/kickoff/registro'
import { avisoAdsEncendido, mencionesKickoff, urlDespacho, webhookKickoff, webhookKickoffAds } from '@/lib/bot/kickoff/entorno'

// POST /api/clientes/<id>/kickoff — lo que se toca en la pantalla de la ficha de kickoff (/clientes/<id>/kickoff):
//   { accion: 'check', recording_id, item, valor: 'ok' | 'falta' | 'problema' | null, nota, previo }   → tilde a mano del portfolio
//   { accion: 'faltante', recording_id, clave, hecho, nota, previo }                                   → faltante hecho / dato de lanzamiento
//   { accion: 'revision', recording_id, estado: 'aprobada' | 'cambios' | 'pendiente', comentario, huella, previo } → revisión de las ideas
// Va FUERA de /api/bot: la cubre la regla "/api/clientes/*" de lib/auth/rutas.ts (sesión de Google con un rol que ve Clientes:
// socio y csm), sin acceso por máquina. La barrera entera (esa regla repetida por si el proxy no corre, mismo origen, JSON,
// tamaño) y la decisión están en lib/bot/kickoff/acciones.ts (atenderPost, probada en scripts/test-bot-kickoff-vista.mjs);
// acá solo van las dependencias reales. Los avisos de Discord (pedido de cambios al otro revisor, ideas aprobadas) salen
// en after(), sin demorar la respuesta: #📝-kickoff (DISCORD_WEBHOOK_KICKOFF) y, para Valentino, el canal de anuncios si
// está DISCORD_WEBHOOK_KICKOFF_ADS o, si no, DISCORD_WEBHOOK_ANUNCIOS (#📣-ads), solo con KICKOFF_AVISO_ADS=1 (apagado desde el
// 26/10: lo de lanzar le llega a Valentino con los videos editados, g01). Desde el 27/10 aprobar las ideas ya no dispara la
// tanda de guiones: arranca sola cuando la ficha queda lista (lib/bot/kickoff/disparo-guiones.ts).
export const dynamic = 'force-dynamic'

const TOPE_AVISO_MS = 20_000

const webhookAds = (): string => (avisoAdsEncendido() ? webhookKickoffAds() : '')

function enviarAvisos(avisos: AvisoDiscord[]): void {
  after(async () => {
    for (const a of avisos) {
      const webhook = a.canal === 'ads' ? webhookAds() : webhookKickoff()
      if (!webhook) { console.warn(`API kickoff: sin webhook para el aviso (${a.canal}): no sale`); continue }
      try {
        await enviarDiscord(webhook, [a.texto], a.menciones, { deadline: Date.now() + TOPE_AVISO_MS })
      } catch (e) {
        console.error(`API kickoff: no salió el aviso (${a.canal}) —`, ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
      }
    }
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const { id } = await ctx.params
  const m = mencionesKickoff()
  return atenderPost(req, id, {
    exigirAcceso: r => exigirAccesoApi(r, 'clientes'), // 401 sin sesión, 403 sin permiso (segunda barrera, además del proxy)
    sesion: r => sesionDePeticion(r.headers),
    baseLista: baseConfigurada,
    accion: {
      leer: leerKickoff, guardarCheck: guardarCheckPortfolio, guardarMarca: guardarMarcaFaltante, guardarRevision,
      avisos: { urlBase: urlDespacho(), menciones: { ...m, valentino: idDiscord(process.env.DISCORD_ID_VALENTINO) }, ads: !!webhookAds() },
    },
    enviarAvisos,
  })
}
