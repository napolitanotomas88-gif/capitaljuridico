// ── f05 / f06: dependencias reales de la lectura del grupo Contenido (directorio de Éxito, Claude, Neon, Discord) ─────────
// La ruta del webhook de Whapi (lib/bot/whapi/ruta.ts) llama a procesarContenidoReal en after(). Solo LEE WhatsApp: nunca
// escribe en un grupo. Lo único que sale es el aviso a Aylu en #✂️-edicion (y solo con los avisos reales de Edición).
// Interruptor propio: EDICION_LECTURA=real, además de EDICION_MODO=real. Sin los dos, no se guarda ni se lee nada. Claude
// va por el puente a la Mac (CLAUDE_VIA=mac); si la Mac no responde, queda la lectura gruesa marcada para revisar.
// El log lleva conteos, nunca textos ni teléfonos. Solo servidor.
import { directorioReal } from '@/lib/bot/exito/servidor'
import { claveClaude, llamarClaude } from '@/lib/bot/kickoff/claude'
import { enviarDiscord } from '@/lib/fathomAnuncios/discord'
import { avisosReales, modoEdicion } from './config'
import { SCHEMA_CONTENIDO, SISTEMA_CONTENIDO, lecturaContenidoValida, procesarContenido, type DepsContenido, type MensajeContenido, type ResumenContenido } from './contenido'
import { mencionesEdicion, urlDespacho, webhookEdicion } from './avisos/entorno'
import { guardarLectura, idPorNombreCliente, reclamarLectura, videosConCliente, videosDelMensaje } from './db/lecturas'
import { crearPedido, leerDoc, leerDocPorId, leerVideo } from './operativo'
import { proponerNotas } from './pedidos'
import type { GuionDoc, Persona, Video } from './tipos'

export const TOPE_LECTURA_MS = 60_000
/** Quien firma los pedidos que arma el bot (queda en «lo cargó …»). Solo cuenta la ronda: no confirma nada. */
export const BOT_CONTENIDO: Persona = { rol: 'aylu', nombre: 'Bot C.J (grupo Contenido)', email: '' }

/** ¿Está encendida la lectura? EDICION_LECTURA=real y EDICION_MODO=real. */
export const lecturaEncendida = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.EDICION_LECTURA?.trim().toLowerCase() === 'real' && modoEdicion(env) === 'real'

interface Log { info(m: string): void; warn(m: string): void; error(m: string): void }

async function guionDe(v: Video): Promise<GuionDoc | null> {
  const doc = (v.guion?.doc_id ? await leerDocPorId(v.guion.doc_id) : null) ?? await leerDoc(v.id_crm)
  const ref = v.guion?.ref ?? v.clave
  return doc?.guiones.find(g => g.ref === ref) ?? null
}

export function depsContenido(env: NodeJS.ProcessEnv = process.env): DepsContenido {
  const directorio = directorioReal(env, true)
  const conClaude = !!claveClaude()
  return {
    async deChat(chatId) {
      const e = await directorio.deChat(chatId)
      return e ? { idCrm: e.ficha.idCrm, cliente: e.ficha.cliente, grupo: e.grupo } : null
    },
    idPorNombre: idPorNombreCliente,
    videosConCliente,
    videosDelCitado: videosDelMensaje,
    reclamar: (m, c) => reclamarLectura(m, c),
    async leer(texto) {
      if (!conClaude) return null
      const r = await llamarClaude({ que: 'el mensaje del grupo Contenido', sistema: SISTEMA_CONTENIDO, schema: SCHEMA_CONTENIDO, esfuerzo: 'low', topeMs: TOPE_LECTURA_MS, maxTokens: 2_000, usuario: `<mensaje>\n${texto}\n</mensaje>` })
      return lecturaContenidoValida(r.json)
    },
    async crearPedido(video, texto) {
      const d = await leerVideo(video.id)
      if (!d || d.video.estado !== 'con_cliente') throw new Error('el video ya no está «Con el cliente»')
      if (d.video.bloqueo === 'tope_rondas_cliente') throw new Error('el video ya tiene un pedido esperando a Tomás')
      const guion = await guionDe(d.video).catch(() => null)
      const prop = await proponerNotas({ texto, video: d.video, guion }, { claude: conClaude ? llamarClaude : null, topeMs: TOPE_LECTURA_MS })
      const pedido = await crearPedido({ video_id: d.video.id, ronda: d.video.ronda_cliente + 1, texto, propuesta: prop.propuesta, modelo: prop.modelo, version_prompt: prop.version, actor: BOT_CONTENIDO })
      return pedido.id
    },
    guardar: guardarLectura,
    async avisar(texto) {
      // Modo sombra (EDICION_AVISOS=dry): la lectura queda en el Despacho y no sale nada a Discord.
      if (!avisosReales(env)) return null
      const webhook = webhookEdicion(env)
      if (!webhook) throw new Error('falta DISCORD_WEBHOOK_EDICION')
      const aylu = mencionesEdicion(env).aylu
      return (await enviarDiscord(webhook, [texto], aylu ? [aylu] : []))[0] ?? null
    },
    link: idCrm => `${urlDespacho(env)}/clientes/edicion/cliente/${encodeURIComponent(idCrm)}#lecturas`,
    aylu: mencionesEdicion(env).aylu,
  }
}

/** Lo que llama el webhook de Whapi en after(). Nunca tira. */
export async function procesarContenidoReal(cands: readonly MensajeContenido[], op: { env?: NodeJS.ProcessEnv; log?: Log } = {}): Promise<ResumenContenido | null> {
  const env = op.env ?? process.env, log = op.log ?? console
  if (!lecturaEncendida(env) || !cands.length) return null
  if (!env.DATABASE_URL?.trim()) { log.warn('edicion-contenido: sin DATABASE_URL, no se guarda nada'); return null }
  try {
    const r = await procesarContenido(cands, depsContenido(env))
    if (r.leidos || r.errores.length) log.info(`edicion-contenido: ${r.leidos} leído(s) · ${r.ok} OK · ${r.pedidos} pedido(s) · ${r.sinVideo} sin video · ${r.avisos} aviso(s)${r.errores.length ? ` · errores: ${r.errores.join(' | ')}` : ''}`)
    return r
  } catch (e) {
    log.error(`edicion-contenido: el proceso tiró: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    return null
  }
}
export type ProcesarContenidoEdicion = typeof procesarContenidoReal
