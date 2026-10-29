// ── Dependencias REALES del kickoff (Neon, CRM, Claude, Meta, Discord, reloj) ──────────────────────
// Está acá y no en el route.ts porque un route.ts de Next solo puede exportar GET/POST/dynamic/maxDuration…, y además las
// usa scripts/probar-kickoff.mjs (en seco, con la base y Discord reemplazados).
//   · Tiempo: maxDuration 300 s. procesar.ts trabaja con un deadline de t0 + 280 s; acá se fija un tope duro
//     (FIN_INVOCACION_MS desde `inicio`, la hora en que LLEGÓ el pedido) que ningún envío a Discord pasa, ni el aviso de
//     error. La ruta pasa su t0: en el modo manual, la base y Fathom pueden haber tardado 50 s antes de armar esto.
//   · Discord: un webhook propio, DISCORD_WEBHOOK_KICKOFF (el canal lo decide Tomás). Se reusa el envío de
//     lib/fathomAnuncios/discord.ts: ?wait=true (devuelve el id), flags 4 (sin tarjetas de links), allowed_mentions SOLO con
//     los users pasados (Tomi y Gero M; en el aviso de error, Tomás), timeout por pedido, 429 y 5xx con reintentos acotados.
//   · Menciones, link a la ficha y webhook: entorno.ts (lo comparte con la API de la pantalla, que no carga nada de esto).
//     Sin DISCORD_ID_GERO_M el aviso sale con "Gero M" en texto, sin notificarlo, y queda un aviso en el log.
//   · Portfolio (portfolio.ts, solo GET con los tokens de lectura): portfolioDelCliente busca la cuenta del cliente (las del
//     CRM o el descubrimiento del tablero, con las MISMAS cachés) y la chequea. prepararPortfolio() arranca el descubrimiento
//     (fuentesCuentaTablero, ~9 s en frío) una sola vez por invocación, mientras Claude lee la llamada; la búsqueda después
//     usa esa misma promesa. Los topes de la búsqueda y del chequeo se recortan al tope que pasa procesar.ts.
//   · La misma kickoff grabada por los dos: gemela = buscarGemela de registro.ts.
//   · Zona desde el video (24/10): hayApiKey (FATHOM_API_KEY_<QUIEN>, solo si está), pedirVideo (pedirVideoSeguro de mapa.ts:
//     solo el POST /download, con un límite corto), guardarZonaVideo (registro.ts) y dispararMapa: POST a
//     <Despacho>/api/bot/kickoff/mapa con Bearer CRON_SECRET y {recording_id, quien, descarga_id}, esperando SOLO el 202
//     (la ruta mira el video en after(), en otra invocación con sus propios 300 s). La dirección es la del Despacho
//     (DESPACHO_URL o el dominio de producción, igual que el link a la ficha). Sin CRON_SECRET, el disparo falla y queda
//     anotado; si la ruta respondió que no y ya anotó el porqué (sin ffmpeg, sin la clave de Claude), procesar.ts no lo
//     pisa. ffmpeg NO corre acá: solo en la ruta del mapa.
//   · Aviso a Valentino (24/10): avisoAds = depsAvisoAdsReales de aviso-ads.ts (Neon con condición y Discord en
//     DISCORD_WEBHOOK_KICKOFF_ADS o #📣-ads; si falla para siempre, el aviso corto a Tomás va por DISCORD_WEBHOOK_KICKOFF),
//     o null si está apagado (por defecto desde el 26/10; KICKOFF_AVISO_ADS=1 lo prende) o no hay canal; valentino, para el texto en seco.
// Solo servidor.
import { ID_TOMAS } from '@/lib/fathomAnuncios/procesar'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import type { DepsKickoff } from './procesar'
import { anotarAviso, buscarGemela, guardarFicha, guardarIdeas, guardarZonaVideo, marcar, reclamar } from './registro'
import { claveApi } from './fathomApi'
import { pedirVideoSeguro } from './mapa'
import { dispararMapaReal } from './mapa-api'
import { contextoKickoff } from './contexto'
import { extraerFicha } from './extraer'
import { generarIdeas } from './ideas'
import { leerCandidatos } from './ganadores'
import { TIMEOUT_TOTAL_MS, TOPE_BUSQUEDA_MS, fuentesCuentaTablero, portfolioDelCliente, type FuentesCuenta } from './portfolio'
import { kbDeRama } from './kb/index'
import { URL_DESPACHO, idValentino, mencionesKickoff, pantallaFicha, urlDespacho, webhookKickoff } from './entorno'
import { depsAvisoAdsReales } from './aviso-ads'
import { dispararGuionesReal, guionesEncendido } from './disparo-guiones'

export const FIN_INVOCACION_MS = 295_000        // maxDuration (300 s) menos un margen para responder y loguear
const LIMITE_PEDIDO_VIDEO_MS = 30_000           // el POST /download temprano (con un reintento de 429/5xx adentro)

// El disparo de la lectura del mapa (POST a la ruta propia con el Bearer, esperando solo el 202) está en mapa-api.ts: la
// ruta del mapa lo usa para su único reintento solo sin cargar todo esto
export { dispararMapaReal }

export { URL_DESPACHO, mencionesKickoff, pantallaFicha, urlDespacho, webhookKickoff }

const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)))

/** Lo que no toca la base ni Discord: lo comparten las dependencias reales y la prueba en seco. */
export function depsLectura(): Pick<DepsKickoff, 'clienteOperativo' | 'contexto' | 'extraer' | 'candidatos' | 'portfolio' | 'prepararPortfolio' | 'kb' | 'ideas' | 'esperar' | 'ahora' | 'menciones' | 'tomas' | 'urlBase' | 'pantallaFicha' | 'hayApiKey' | 'valentino'> {
  // El descubrimiento de cuentas, una sola vez por invocación (lo arranca prepararPortfolio o, si no, la primera búsqueda)
  let fuentes: Promise<FuentesCuenta> | null = null
  const fuentesUnaVez = (): Promise<FuentesCuenta> => (fuentes ??= fuentesCuentaTablero())
  return {
    clienteOperativo,
    contexto: () => contextoKickoff(),
    extraer: extraerFicha,
    candidatos: leerCandidatos,
    portfolio: (cliente, topeMs) => portfolioDelCliente(cliente, {
      fuentes: fuentesUnaVez, topeMs: Math.min(TOPE_BUSQUEDA_MS, topeMs), timeoutMs: Math.min(TIMEOUT_TOTAL_MS, topeMs),
    }),
    prepararPortfolio: () => { fuentesUnaVez().catch(() => { /* la búsqueda lo vuelve a ver y lo anota */ }) },
    kb: rama => kbDeRama(rama),
    ideas: generarIdeas,
    esperar: dormir,
    ahora: () => Date.now(),
    menciones: mencionesKickoff(),
    tomas: idDiscord(process.env.DISCORD_ID_TOMAS) ?? ID_TOMAS,
    urlBase: urlDespacho(),
    pantallaFicha: pantallaFicha(),
    // Solo si la variable está (nunca el valor): con dry, procesar.ts igual no pide el video
    hayApiKey: quien => !!claveApi(quien),
    valentino: idValentino(),
  }
}

/** inicio: cuándo llegó el pedido (por defecto, ahora). El tope duro de los envíos es inicio + FIN_INVOCACION_MS. */
export function depsReales(inicio: number = Date.now()): DepsKickoff {
  const fin = inicio + FIN_INVOCACION_MS
  const webhook = webhookKickoff()
  const lectura = depsLectura()
  if (!lectura.menciones.gero_m) console.warn('bot-kickoff: falta DISCORD_ID_GERO_M (o no es un ID de Discord): el aviso sale sin mencionar a Gero M')
  return {
    ...lectura,
    reclamar,
    gemela: buscarGemela,
    guardarFicha,
    guardarIdeas,
    anotarAviso,
    marcar,
    pedirVideo: (id, quien) => pedirVideoSeguro(id, quien, { limite: Date.now() + LIMITE_PEDIDO_VIDEO_MS }),
    guardarZonaVideo: (id, zv, op) => guardarZonaVideo(id, zv, op),
    dispararMapa: (datos, topeMs) => dispararMapaReal(datos, topeMs),
    enviar: async (texto, menciones, deadline) => {
      const [id] = await enviarDiscord(webhook, [texto], menciones, { deadline: Math.min(deadline, fin) })
      return id ?? ''
    },
    avisar: async texto => {
      if (!webhook) throw new Error('no hay webhook de Discord configurado (DISCORD_WEBHOOK_KICKOFF)')
      await enviarDiscord(webhook, [texto], lectura.tomas ? [lectura.tomas] : [], { deadline: fin, reintentos429: 1 })
    },
    discordListo: !!webhook,
    avisoAds: depsAvisoAdsReales(),
    // La tanda de guiones arranca sola con la ficha lista (27/10); KICKOFF_GUIONES=0 lo apaga
    ...(guionesEncendido() ? { dispararGuiones: (id: number) => dispararGuionesReal(id) } : {}),
  }
}
