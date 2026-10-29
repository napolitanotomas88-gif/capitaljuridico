// ── Lo del entorno que usan los avisos de Edición (liviano: sin base, sin Claude, sin Meta) ──────────────────────────
//   · DISCORD_WEBHOOK_EDICION: el canal privado #✂️-edicion (René, Aylu y Tomás; Gero M opcional). Todos los avisos
//     internos y los errores a Tomás van ahí.
//   · DISCORD_WEBHOOK_KICKOFF_ADS + DISCORD_ID_VALENTINO: el aviso de "aprobado" a Valen en #ads (los mismos que dejó el
//     kickoff). Sin el webhook de #ads (dio 404 el 21/10), el aviso va a #✂️-edicion para que Aylu lo reenvíe, más un
//     error a Tomás (una vez por día).
//   · Menciones: DISCORD_ID_AYLU, DISCORD_ID_RENE, DISCORD_ID_TOMAS (si falta, ID_TOMAS de fathom-anuncios) y
//     DISCORD_ID_GERO_M (si falta, el de ggeroo confirmado el 24/10). SIN el id, va el NOMBRE en texto, sin notificar.
//   · El link va siempre a la pantalla (/clientes/edicion…) con urlDespacho() del kickoff (DESPACHO_URL o el dominio del Despacho),
//     nunca a una API (pide credenciales: desde Discord daría 401).
//   · Modo: EDICION_MODO (dry por defecto) y EDICION_AVISOS=dry (avisos en silencio aunque el modo sea real). La lógica
//     está en config.ts (modoEdicion, avisosReales).
// La URL de un webhook es un secreto (quien la tiene publica en el canal): nunca va a un log, a un error ni a la base.
import { ID_TOMAS } from '@/lib/fathomAnuncios/procesar'
import { idDiscord } from '@/lib/fathomAnuncios/discord'
import { URL_DESPACHO } from '@/lib/bot/kickoff/entorno'
import { avisosReales, modoEdicion } from '../config'

type Entorno = Record<string, string | undefined>

/** Gero M (usuario ggeroo), confirmado en Discord el 24/10 (docs/BOT-KICKOFF-CJ.md). */
export const ID_GERO_M_POR_DEFECTO = ''

export type Destinatario = 'aylu' | 'rene' | 'tomas' | 'gero_m' | 'valen'
export const NOMBRE_DESTINATARIO: Record<Destinatario, string> = { aylu: 'Aylu', rene: 'René', tomas: 'Tomás', gero_m: 'Gero M', valen: 'Valen' }
export type Menciones = Record<Destinatario, string | null>

export const webhookEdicion = (env: Entorno = process.env): string => env.DISCORD_WEBHOOK_EDICION?.trim() || ''
export const webhookAds = (env: Entorno = process.env): string => env.DISCORD_WEBHOOK_KICKOFF_ADS?.trim() || ''

export function mencionesEdicion(env: Entorno = process.env): Menciones {
  return {
    aylu: idDiscord(env.DISCORD_ID_AYLU),
    rene: idDiscord(env.DISCORD_ID_RENE),
    tomas: idDiscord(env.DISCORD_ID_TOMAS) ?? ID_TOMAS,
    gero_m: idDiscord(env.DISCORD_ID_GERO_M) ?? ID_GERO_M_POR_DEFECTO,
    valen: idDiscord(env.DISCORD_ID_VALENTINO),
  }
}

/** La base de los links (https, sin barra final): la misma regla que la ficha de kickoff (DESPACHO_URL o el dominio). */
export function urlDespacho(env: Entorno = process.env): string {
  const b = env.DESPACHO_URL?.trim() ?? ''
  try {
    if (new URL(b).protocol === 'https:') return b.replace(/\/+$/, '')
  } catch { /* sin DESPACHO_URL o mal formada */ }
  return URL_DESPACHO
}

export interface ModoAvisos { modo: 'dry' | 'real'; discord: boolean }
/** dry: no se escribe nada (devuelve el plan); real sin discord: la cola anota el texto en estado "dry"; real con discord: salen. */
export function modoAvisos(env: Entorno = process.env): ModoAvisos {
  return { modo: modoEdicion(env), discord: avisosReales(env) }
}
