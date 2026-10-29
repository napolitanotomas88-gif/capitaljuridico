// ── Lo del entorno que comparten el bot (servidor.ts) y la API de la pantalla (/api/clientes/<id>/kickoff) ──────────
// Liviano a propósito: la API de la pantalla no tiene por qué cargar Claude, Meta ni el CRM para saber a qué canal avisar.
//   · DISCORD_WEBHOOK_KICKOFF: el canal privado #📝-kickoff (avisos a Tomi y Gero M, errores a Tomás, pedidos de cambios).
//   · Menciones: DISCORD_ID_TOMAS (si falta, el mismo ID de Tomás que ya usa fathom-anuncios) y DISCORD_ID_GERO_M (si falta,
//     el aviso sale con "Gero M" en texto, sin notificarlo).
//   · Link a la ficha: DESPACHO_URL (opcional, https) o https://despacho-capital-juridico.vercel.app, el dominio del Despacho
//     (decisión de Tomás, 24/10: el viejo dashboard-metricas-eight sigue andando pero no va en links nuevos).
//   · KICKOFF_PANTALLA=0 apaga el link a la ficha en el aviso (por defecto, encendido).
//   · Aviso a Valentino «🚀 Para lanzar» (aviso-ads.ts, 24/10): DISCORD_WEBHOOK_KICKOFF_ADS o, si no está, el de #📣-ads
//     (DISCORD_WEBHOOK_ANUNCIOS, el mismo de fathom-anuncios); mención con DISCORD_ID_VALENTINO (sin él, "Valentino" en
//     texto, sin notificar). APAGADO por defecto desde el 26/10/2026 (Tomás: «cuando llega al para lanzar es con los videos
//     ya editados»): el «🚀» a Valentino lo manda g01 (lib/bot/anuncios/videos.ts) cuando aparecen los videos en «Editados -
//     X»; la ficha sigue en la pantalla para que Valen prepare la campaña. KICKOFF_AVISO_ADS=1 lo vuelve a prender en la
//     kickoff. Si no sale y no se repite solo (Discord lo rechazó o no confirmó), el aviso corto va a Tomás por
//     DISCORD_WEBHOOK_KICKOFF, como los otros errores del bot.
import { ID_TOMAS } from '@/lib/fathomAnuncios/procesar'
import { idDiscord } from '@/lib/fathomAnuncios/discord'

export const webhookKickoff = (): string => process.env.DISCORD_WEBHOOK_KICKOFF?.trim() || ''

/** El canal del aviso a Valentino: el propio (DISCORD_WEBHOOK_KICKOFF_ADS) o #📣-ads (DISCORD_WEBHOOK_ANUNCIOS). '' = ninguno. */
export const webhookKickoffAds = (): string => process.env.DISCORD_WEBHOOK_KICKOFF_ADS?.trim() || process.env.DISCORD_WEBHOOK_ANUNCIOS?.trim() || ''
/** El NOMBRE de la variable del canal del aviso a Valentino (para el GET de estado; nunca el valor), o null. */
export const varCanalAds = (): string | null => process.env.DISCORD_WEBHOOK_KICKOFF_ADS?.trim() ? 'DISCORD_WEBHOOK_KICKOFF_ADS'
  : process.env.DISCORD_WEBHOOK_ANUNCIOS?.trim() ? 'DISCORD_WEBHOOK_ANUNCIOS' : null
/** ¿Sale el aviso a Valentino en la kickoff? Por defecto no (26/10: sale con los videos editados, g01); KICKOFF_AVISO_ADS=1 lo prende. */
export const avisoAdsEncendido = (): boolean => process.env.KICKOFF_AVISO_ADS?.trim() === '1'
/** Mención de Valentino (el mismo ID que usa fathom-anuncios), o null. */
export const idValentino = (): string | null => idDiscord(process.env.DISCORD_ID_VALENTINO)

export const URL_DESPACHO = 'https://despacho-capital-juridico.vercel.app'

export function urlDespacho(): string {
  const b = process.env.DESPACHO_URL?.trim() ?? ''
  try {
    if (new URL(b).protocol === 'https:') return b.replace(/\/+$/, '')
  } catch { /* sin DESPACHO_URL o mal formada */ }
  return URL_DESPACHO
}

export function mencionesKickoff(): { tomi: string | null; gero_m: string | null } {
  return { tomi: idDiscord(process.env.DISCORD_ID_TOMAS) ?? ID_TOMAS, gero_m: idDiscord(process.env.DISCORD_ID_GERO_M) }
}

/** ¿El aviso lleva link a la pantalla de la ficha? Por defecto sí; KICKOFF_PANTALLA=0 lo apaga (sin id_crm nunca hay link). */
export const pantallaFicha = (): boolean => process.env.KICKOFF_PANTALLA?.trim() !== '0'
