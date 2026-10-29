// ── Envío a Discord de los cambios de anuncios (webhook propio, no usa lib/discord.ts) ────────────
// POST {webhook}?wait=true para que Discord devuelva el mensaje creado (su id queda en el registro).
//   · flags 4 = SUPPRESS_EMBEDS: los links a Fathom no arman tarjetas;
//   · allowed_mentions con parse [] y SOLO los usuarios que pasamos: aunque un texto trajera @everyone o un <@id>
//     (ya vienen neutralizados de mensaje.ts), Discord no notifica a nadie más;
//   · cada fetch tiene su timeout (15 s, o lo que quede hasta el deadline si es menos): una conexión colgada no se
//     come la función entera;
//   · 429: se espera el retry_after COMPLETO si entra antes del deadline (si no, se corta con error transitorio); hasta
//     `reintentos429` veces por mensaje (2; el aviso a Tomás usa 1). Sin deadline, como mucho 10 s de espera;
//   · 5xx: 2 reintentos con espera de 1 s y 3 s (también dentro del deadline);
//   · 400 ms entre mensajes para que lleguen en orden;
//   · la URL del webhook es un secreto (quien la tiene publica en el canal): nunca va a un log ni a un error.
// Si falla a mitad de un lote, el error lleva los ids de lo que sí salió (ErrorEnvio.enviados) y si vale la pena
// reintentar (ErrorEnvio.transitorio: 5xx, timeout, red, 429 sin tiempo; un 400/401/404 no).

export class ErrorEnvio extends Error {
  enviados: string[]
  transitorio: boolean
  constructor(mensaje: string, enviados: string[], transitorio = false) {
    super(mensaje)
    this.name = 'ErrorEnvio'
    this.enviados = enviados
    this.transitorio = transitorio
  }
}

/** Un ID de usuario de Discord (snowflake) o null. */
export const idDiscord = (x: string | undefined | null): string | null => {
  const t = (x ?? '').trim()
  return /^\d{15,25}$/.test(t) ? t : null
}

export interface OpcionesEnvio {
  fetch?: typeof fetch
  esperar?: (ms: number) => Promise<void>
  ahora?: () => number
  /** Hora límite (ms epoch): ninguna espera ni pedido se estira más allá. Sin deadline: timeout de cada pedido y esperas cortas. */
  deadline?: number
  pausaMs?: number
  timeoutMs?: number
  reintentos429?: number
  esperas5xx?: number[]
}

export const TIMEOUT_DISCORD_MS = 15_000
const ESPERAS_5XX_MS = [1_000, 3_000]
const MAX_ESPERA_SIN_DEADLINE_MS = 10_000
const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Manda los mensajes en orden y devuelve sus ids. menciones = ids de usuario que pueden notificarse. */
export async function enviarDiscord(webhook: string, mensajes: string[], menciones: string[], op: OpcionesEnvio = {}): Promise<string[]> {
  const f = op.fetch ?? fetch, esperar = op.esperar ?? dormir, ahora = op.ahora ?? Date.now
  const pausa = op.pausaMs ?? 400, timeout = op.timeoutMs ?? TIMEOUT_DISCORD_MS
  const max429 = op.reintentos429 ?? 2, esperas5xx = op.esperas5xx ?? ESPERAS_5XX_MS
  const url = `${webhook}${webhook.includes('?') ? '&' : '?'}wait=true`
  const ids: string[] = []
  const restante = () => (op.deadline === undefined ? Infinity : op.deadline - ahora())
  /** Espera ms si entra antes del deadline; si no, corta con error transitorio. */
  const esperarSiAlcanza = async (ms: number, motivo: string) => {
    if (ms > restante()) throw new ErrorEnvio(`${motivo} y no alcanza el tiempo`, ids, true)
    await esperar(ms)
  }

  for (let i = 0; i < mensajes.length; i++) {
    if (i > 0) await esperarSiAlcanza(pausa, 'pausa entre mensajes')
    const cuerpo = JSON.stringify({ content: mensajes[i], flags: 4, allowed_mentions: { parse: [], users: menciones } })
    let n429 = 0, n5xx = 0
    for (;;) {
      const queda = restante()
      if (queda <= 0) throw new ErrorEnvio('se acabó el tiempo para mandar a Discord', ids, true)
      const tope = Math.max(1, Math.min(timeout, queda))
      let res: Response
      try {
        res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, signal: AbortSignal.timeout(tope) })
      } catch (e) {
        // El mensaje de error de fetch puede incluir la URL: no se reenvía
        const nombre = (e as Error)?.name ?? 'error'
        if (nombre === 'TimeoutError' || nombre === 'AbortError') throw new ErrorEnvio(`Discord no respondió en ${Math.round(tope / 1000)} s`, ids, true)
        throw new ErrorEnvio(`no se pudo conectar con Discord (${nombre})`, ids, true)
      }
      if (res.status === 429) {
        const datos = (await res.json().catch(() => ({}))) as { retry_after?: number }
        const seg = Number(datos.retry_after ?? res.headers.get('retry-after') ?? 1)
        let ms = Number.isFinite(seg) && seg > 0 ? Math.ceil(seg * 1000) : 1000
        if (op.deadline === undefined) ms = Math.min(ms, MAX_ESPERA_SIN_DEADLINE_MS)
        if (n429 >= max429) throw new ErrorEnvio('Discord respondió 429 (demasiados mensajes seguidos)', ids, true)
        n429++
        await esperarSiAlcanza(ms, `Discord pidió esperar ${Math.ceil(ms / 1000)} s (429)`)
        continue
      }
      if (res.status >= 500) {
        await res.body?.cancel().catch(() => {})
        if (n5xx >= esperas5xx.length) throw new ErrorEnvio(`Discord respondió ${res.status}`, ids, true)
        await esperarSiAlcanza(esperas5xx[n5xx++], `Discord respondió ${res.status}`)
        continue
      }
      if (!res.ok) {
        const detalle = (await res.text().catch(() => '')).replace(/https?:\/\/\S+/g, '[url]').slice(0, 200)
        throw new ErrorEnvio(`Discord respondió ${res.status}${detalle ? `: ${detalle}` : ''}`, ids, false)
      }
      const datos = (await res.json().catch(() => ({}))) as { id?: string }
      ids.push(typeof datos.id === 'string' ? datos.id : '')
      break
    }
  }
  return ids
}
