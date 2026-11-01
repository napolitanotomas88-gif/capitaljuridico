// ── Notas del cliente: dependencias reales (directorio de Éxito, Claude, Neon, Discord) ─────────────────────────────────
// La ruta del webhook de Whapi (lib/bot/whapi/ruta.ts) llama a procesarNotasReal en after(). Solo LEE WhatsApp: el único
// envío es el aviso a #📣-ads (DISCORD_WEBHOOK_ANUNCIOS) mencionando a Valen (DISCORD_ID_VALENTINO). ANUNCIOS_NOTAS=0 lo
// apaga. El log lleva conteos, nunca textos ni teléfonos. Solo servidor.
import { llamarClaude } from '@/lib/bot/kickoff/claude'
import { directorioReal } from '@/lib/bot/exito/servidor'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { urlDespacho } from '@/lib/edicion/avisos/entorno'
import { SCHEMA_NOTAS, SISTEMA_NOTAS, lecturaValida, procesarNotas, type DepsNotas, type MensajeNota, type ResultadoNotas } from './notas'
import { guardarLectura, marcarAvisoNota, reclamarNota } from './notasNeon'

export const TOPE_LECTURA_MS = 40_000
export const notasEncendidas = (env: NodeJS.ProcessEnv = process.env): boolean => env.ANUNCIOS_NOTAS?.trim() !== '0'

interface Log { info(m: string): void; warn(m: string): void; error(m: string): void }

export function depsNotas(env: NodeJS.ProcessEnv = process.env): DepsNotas {
  const webhook = env.DISCORD_WEBHOOK_ANUNCIOS?.trim() || ''
  const directorio = directorioReal(env, true)
  return {
    async deChat(chatId) {
      const e = await directorio.deChat(chatId)
      return e ? { idCrm: e.ficha.idCrm, cliente: e.ficha.cliente, grupo: e.grupo } : null
    },
    clienteOperativo,
    reclamar: reclamarNota,
    async leer(texto) {
      const r = await llamarClaude({ que: 'la nota del cliente', sistema: SISTEMA_NOTAS, schema: SCHEMA_NOTAS, esfuerzo: 'low', topeMs: TOPE_LECTURA_MS, maxTokens: 2_000, usuario: `<mensaje>\n${texto}\n</mensaje>` })
      return lecturaValida(r.json)
    },
    guardar: guardarLectura,
    async enviar(texto) {
      if (!webhook) throw new Error('falta DISCORD_WEBHOOK_ANUNCIOS')
      const v = idDiscord(env.DISCORD_ID_VALENTINO)
      return (await enviarDiscord(webhook, [texto], v ? [v] : []))[0] ?? ''
    },
    marcarAviso: marcarAvisoNota,
    link: id => `${urlDespacho(env)}/anuncios?nota=${id}#notas`,
    valentino: idDiscord(env.DISCORD_ID_VALENTINO),
  }
}

/** Lo que llama el webhook de Whapi en after(). Nunca tira. */
export async function procesarNotasReal(cands: readonly MensajeNota[], op: { env?: NodeJS.ProcessEnv; log?: Log } = {}): Promise<ResultadoNotas | null> {
  const env = op.env ?? process.env, log = op.log ?? console
  if (!notasEncendidas(env) || !cands.length) return null
  if (!env.DATABASE_URL?.trim()) { log.warn('anuncios-notas: sin DATABASE_URL, no se guarda nada'); return null }
  try {
    const r = await procesarNotas(cands, depsNotas(env))
    if (r.leidos || r.errores.length) log.info(`anuncios-notas: ${r.leidos} leído(s) · ${r.notas} nota(s) · ${r.avisos} aviso(s)${r.errores.length ? ` · errores: ${r.errores.join(' | ')}` : ''}`)
    return r
  } catch (e) {
    log.error(`anuncios-notas: el proceso tiró: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    return null
  }
}
export type ProcesarNotasAnuncios = typeof procesarNotasReal
