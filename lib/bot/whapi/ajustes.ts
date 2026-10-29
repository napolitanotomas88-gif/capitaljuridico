// ── Bot "Capital Jurídico": el PATCH /settings del canal de Whapi (BLOQUE W) ────────────────────────────────────────────
// Puro. Lo usa scripts/bot-whapi-configurar.mjs. La trampa de Whapi: en PATCH /settings "los campos omitidos que tienen
// valor por defecto vuelven a ese valor" (pdo_sync → true, offline_mode / full_history / auto_read_messages → false). Por
// eso el cuerpo se arma desde lo que devolvió GET /settings (TODO lo leído) más nuestros cambios (revisión 30), y los cuatro
// campos con defecto van siempre explícitos con el valor que tenían.
// Nuestros cambios:
//   · webhook propio (por url): mode 'body', eventos messages.post y messages.patch (las ediciones), channel.post y
//     users.delete (la sesión del número: si se desvincula, la ruta lo deja en el log como error; revisión del 24/10, ronda 2:
//     antes el bot quedaba sordo sin ningún rastro), groups.patch (groups_participants: el cliente entró al General por el
//     link, WhatsApp seguro del 26/10/2026), header x-cj-bot-secreto
//     y webhook_max_age_seconds 86400 (no perder un #ALTA si Whapi o Vercel se caen más de 10 min; los repetidos se
//     descartan igual). Otros webhooks que hubiera quedan como están.
//   · callback_persist: true (Whapi reintenta hasta tener un 200; pide REINICIAR el canal), backoff 3000 ms y tope 900000 ms.
//   · media.auto_download: [] — apagado (revisión 29): dejaría un link público de wasabi de cada archivo de los grupos.
// taparSecretos() oculta los valores de los headers, el proxy y la query de las urls antes de imprimir nada; de los webhooks
// que no son el nuestro muestra solo el host (Make y otros llevan el token en la ruta).
import { HEADER_SECRETO } from './config'

export const EVENTOS_BOT = [
  { type: 'messages', method: 'post' }, { type: 'messages', method: 'patch' }, { type: 'channel', method: 'post' }, { type: 'users', method: 'delete' },
  // WhatsApp seguro (26/10/2026): quién entra a los grupos (el cliente al General por el link → sale la bienvenida)
  { type: 'groups', method: 'patch' },
] as const
export const EDAD_MAX_WEBHOOK_S = 86_400
export const BACKOFF_MS = 3_000
export const BACKOFF_MAX_MS = 900_000
/** Los campos que PATCH /settings vuelve a su valor por defecto si se omiten. */
export const CAMPOS_CON_DEFECTO = { pdo_sync: true, offline_mode: false, full_history: false, auto_read_messages: false } as const
export const URL_WEBHOOK_POR_DEFECTO = 'https://despacho-capital-juridico.vercel.app/api/bot/whapi'

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null)
const clonar = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T))

/** La url del webhook: https, sin usuario ni clave, terminada en /api/bot/whapi. null si no sirve. */
export function urlWebhookValida(u: string): string | null {
  try {
    const x = new URL(u.trim())
    if (x.protocol !== 'https:' || x.username || x.password || x.search || x.hash) return null
    if (!/\/api\/bot\/whapi\/?$/.test(x.pathname)) return null
    return x.href.replace(/\/$/, '')
  } catch {
    return null
  }
}

export interface AjustesArmados {
  cuerpo: Obj
  avisos: string[]
}

export function armarAjustes(actual: unknown, op: { url: string; secreto: string }): AjustesArmados {
  const leido = obj(clonar(actual)) ?? {}
  const cuerpo: Obj = { ...leido }
  const avisos: string[] = []

  const previos = Array.isArray(leido.webhooks) ? leido.webhooks.filter((w) => obj(w)) as Obj[] : []
  const otros = previos.filter((w) => typeof w.url !== 'string' || w.url.replace(/\/$/, '') !== op.url)
  if (otros.length) avisos.push(`Hay ${otros.length} webhook(s) más en el canal: se dejan como están (revisá que no sean de una prueba vieja).`)
  cuerpo.webhooks = [
    ...otros,
    {
      url: op.url,
      mode: 'body',
      events: EVENTOS_BOT.map((e) => ({ ...e })),
      headers: { [HEADER_SECRETO]: op.secreto },
      webhook_max_age_seconds: EDAD_MAX_WEBHOOK_S,
    },
  ]

  if (leido.callback_persist !== true) avisos.push('callback_persist pasa a true: Whapi pide REINICIAR el canal para que tome efecto (panel de whapi.cloud).')
  cuerpo.callback_persist = true
  const backoff = typeof leido.callback_backoff_delay_ms === 'number' ? leido.callback_backoff_delay_ms : BACKOFF_MS
  cuerpo.callback_backoff_delay_ms = Math.min(15_000, Math.max(3_000, backoff))
  cuerpo.max_callback_backoff_delay_ms = BACKOFF_MAX_MS

  const media = obj(leido.media) ?? {}
  const antes = Array.isArray(media.auto_download) ? media.auto_download : []
  if (antes.length) avisos.push(`Se apaga auto_download (estaba en: ${antes.join(', ')}): los comprobantes se bajan por GET /media/{id} con el token.`)
  cuerpo.media = { ...media, auto_download: [] }

  for (const [k, defecto] of Object.entries(CAMPOS_CON_DEFECTO)) {
    cuerpo[k] = typeof leido[k] === 'boolean' ? leido[k] : defecto
  }
  if (leido.data_mode === 'original') avisos.push('data_mode está en "original": los autores pueden llegar solo como @lid, sin teléfono. Conviene "replace" (el de por defecto).')
  return { cuerpo, avisos }
}

const OCULTO = '•••(oculto)'

/** Copia para mostrar: sin valores de headers, proxy, código de vinculación ni query de las urls. */
export function taparSecretos(x: unknown): unknown {
  const tapar = (v: unknown, clave: string | null): unknown => {
    if (Array.isArray(v)) return v.map((e) => tapar(e, null))
    const o = obj(v)
    if (o) {
      const salida: Obj = {}
      for (const [k, val] of Object.entries(o)) {
        if (k === 'headers' && obj(val)) salida[k] = Object.fromEntries(Object.keys(obj(val)!).map((h) => [h, OCULTO]))
        else salida[k] = tapar(val, k)
      }
      return salida
    }
    if (typeof v === 'string' && clave && ['proxy', 'mobile_proxy', 'mock_pairing_code', 'token', 'secreto'].includes(clave) && v) return OCULTO
    if (typeof v === 'string' && clave === 'url') return taparUrl(v)
    return v
  }
  return tapar(x, null)
}

/** La url de un webhook para mostrar: la nuestra (…/api/bot/whapi) sin la query; la de otro (Make, Zapier…) solo con el
 *  host, porque esos servicios llevan el token EN LA RUTA (revisión del 24/10: hook.us2.make.com/<token> se imprimía entera). */
export function taparUrl(v: string): string {
  try {
    const u = new URL(v)
    if (/\/api\/bot\/whapi\/?$/.test(u.pathname) && !u.username && !u.password) return `${u.origin}${u.pathname}${u.search ? '?•••' : ''}`
    return `${u.origin}/•••`
  } catch {
    return OCULTO
  }
}

/** Qué cambia, campo por campo (ya tapado). */
export function diferencias(antes: unknown, despues: unknown): string[] {
  const a = obj(taparSecretos(antes)) ?? {}, d = obj(taparSecretos(despues)) ?? {}
  const claves = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort()
  return claves
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map((k) => `${k}: ${a[k] === undefined ? '(sin valor)' : JSON.stringify(a[k])} → ${d[k] === undefined ? '(sin valor)' : JSON.stringify(d[k])}`)
}
