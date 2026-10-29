// ── Dependencias REALES de la etapa Guiones (Neon, ficha de kickoff, Claude, Discord, disparo de pasos) ──
// Las usa la ruta /api/bot/guiones. Separado del route.ts porque un route.ts de Next solo exporta GET/POST/…
//   · leerKickoff: la fila de cj_kickoffs (registro del kickoff, solo lectura) → ficha + ideas.
//   · disparar: POST a <Despacho>/api/bot/guiones con Bearer CRON_SECRET y {paso, id, numero}, esperando SOLO el 202 (el
//     trabajo corre en after(), en otra invocación con sus propios 300 s). Mismo patrón que dispararMapaReal del kickoff.
//   · avisar (pedido de Tomás del 25/10): al grupo de guiones del equipo en WhatsApp (WHAPI_GRUPO_COPYWRITING, Whapi) con el
//     link a /guiones/<id>: «lista para revisar» o «el cliente pidió cambios y ya están aplicados». Es un grupo INTERNO (no un
//     cliente). Sin el grupo o sin WHAPI_TOKEN, va a Discord (DISCORD_WEBHOOK_GUIONES o #📝-kickoff) mencionando a Tomi y Faus.
// Solo servidor.
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { ID_TOMAS } from '@/lib/fathomAnuncios/procesar'
import { leerKickoff } from '../kickoff/registro'
import { kbDeRama } from '../kickoff/kb/index'
import { urlDespacho, webhookKickoff } from '../kickoff/entorno'
import type { ExtraccionKickoff, IdeaGuion } from '../kickoff/tipos'
import { analizarMercado } from './mercado'
import * as reg from './registro'
import type { DepsProceso, KickoffParaGuiones, Paso, TipoAviso } from './proceso'
import { crearClienteWhapi } from '../whapi/cliente'
import { tokenWhapi } from '../whapi/config'
import type { FilaTanda } from './registro'
import { notificarRevision } from './entrega'
import { exigirClienteNoArchivado, leerArchivados } from '@/lib/clientes/archivados'

const TOPE_DISPARO_MS = 25_000
export const webhookGuiones = (): string => process.env.DISCORD_WEBHOOK_GUIONES?.trim() || webhookKickoff()
export const revisoresGuiones = (): { tomi: string; faus: string | null } => ({ tomi: idDiscord(process.env.DISCORD_ID_TOMAS) ?? ID_TOMAS, faus: idDiscord(process.env.DISCORD_ID_FAUS) })

export async function leerKickoffParaGuiones(recordingId: number): Promise<KickoffParaGuiones | null> {
  const f = await leerKickoff(recordingId)
  if (!f?.ficha) return null
  // cj_kickoffs.ideas = { kb, ganadores, ajustes, ideas: { ideas: [...], notas, estado, revisores } } (las fichas viejas
  // pueden traer el resultado de las ideas directo): se busca la lista donde esté
  const col = f.ideas as Record<string, unknown> | null
  const interno = col?.ideas as Record<string, unknown> | unknown[] | undefined
  const lista = Array.isArray(interno) ? interno : Array.isArray((interno as Record<string, unknown> | undefined)?.ideas) ? (interno as { ideas: unknown[] }).ideas : []
  const ideas = (lista as IdeaGuion[]).filter(i => i && typeof i.titulo === 'string' && !/firm(ó|aste|o) la liquidaci/i.test(`${i.titulo} ${i.angulo ?? ''}`))
  return { recording_id: recordingId, id_crm: (f.id_crm as string | null) ?? null, cliente: (f.cliente_crm as string | null) ?? null, ficha: f.ficha as unknown as ExtraccionKickoff, ideas }
}

/** Dispara un paso esperando solo el 202. Prueba del 25/10: dos «corregir» disparados desde «revisar» dieron «no arrancó» y
 *  frenaron la tanda; lo más probable es un arranque en frío de más de 15 s (el paso igual arrancaba y se encontraba la tanda
 *  en error). Ahora: tope de 25 s; un corte por tiempo NO es error (el paso puede estar corriendo; si no arrancó, la tanda queda
 *  sin moverse y la pantalla ofrece «Retomar» a los 6 min); un 5xx o sin conexión se reintenta una vez; un 4xx es error. */
export async function dispararPaso(paso: Paso, datos: { id: number; numero?: number }): Promise<void> {
  const cron = process.env.CRON_SECRET?.trim()
  if (!cron) throw new Error('falta CRON_SECRET')
  let ultimo = ''
  for (let intento = 0; intento < 2; intento++) {
    if (intento) await new Promise(r => setTimeout(r, 2_000))
    try {
      const r = await fetch(`${urlDespacho()}/api/bot/guiones`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(TOPE_DISPARO_MS),
        headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' },
        body: JSON.stringify({ paso, id: datos.id, ...(datos.numero ? { numero: datos.numero } : {}) }),
      })
      await r.body?.cancel().catch(() => {})
      if (r.status === 202 || r.status === 200) return
      ultimo = `HTTP ${r.status}`
      if (r.status < 500) break
    } catch (e) {
      if ((e as Error)?.name === 'TimeoutError') { console.warn(`bot-guiones: el paso ${paso}${datos.numero ? ` ${datos.numero}` : ''} no confirmó en ${TOPE_DISPARO_MS / 1000} s (puede estar corriendo)`); return }
      ultimo = 'sin conexión'
    }
  }
  throw new Error(`el paso ${paso} no arrancó (${ultimo})`)
}

export const grupoGuionesEquipo = (): string | null => { const g = process.env.WHAPI_GRUPO_COPYWRITING?.trim() ?? ''; return /@g\.us$/.test(g) ? g : null }

export function textoAviso(fila: FilaTanda, tipo: TipoAviso, base: string = urlDespacho()): string {
  const n = Object.keys(fila.guiones).length
  const link = fila.id_crm ? `${base}/guiones/${encodeURIComponent(fila.id_crm)}` : ''
  const cliente = fila.cliente ?? 'cliente sin nombre'
  return tipo === 'revisar'
    ? `✍️ Guiones listos para revisar: ${cliente} · ${n} guiones (tanda ${fila.tanda}). Tomi o Faus: revisalos y aprobalos acá${link ? `: ${link}` : ' (falta el ID del CRM)'}`
    : `🔁 ${cliente} pidió cambios en sus guiones y el bot ya los aplicó. Tomi o Faus: revisalos y aprobalos acá${link ? `: ${link}` : ''}`
}

async function avisarEquipo(fila: FilaTanda, tipo: TipoAviso): Promise<string | null> {
  await exigirClienteNoArchivado(fila.id_crm, await leerArchivados({ forzar: true }))
  await notificarRevision(fila, tipo !== 'revisar').catch(e => console.error('Guiones: aviso del Hub pendiente —', (e as Error)?.name ?? 'error'))
  const grupo = grupoGuionesEquipo(), token = tokenWhapi()
  if (grupo && token) {
    // Si WhatsApp no sale (número del bot caído o suspendido: la guardia de "WhatsApp seguro" frena el envío), el aviso cae a
    // Discord en vez de perderse (26/10/2026: el número quedó suspendido y Faus no se habría enterado de la tanda)
    try {
      const env = await crearClienteWhapi({ token }).enviarTexto({ chatId: grupo, texto: textoAviso(fila, tipo) })
      return `wa:${env.id ?? 'sin-id'}`
    } catch (e) {
      console.error('Guiones: el aviso por WhatsApp no salió, va a Discord:', (e as Error).message?.slice(0, 160))
    }
  }
  const wh = webhookGuiones()
  if (!wh) return null
  const { tomi, faus } = revisoresGuiones()
  const quienes = [`<@${tomi}>`, faus ? `<@${faus}>` : 'Faus'].join(' ')
  const ids = await enviarDiscord(wh, [`${quienes} ${textoAviso(fila, tipo).replace(/(https:\/\/\S+)/, '<$1>')}`], [tomi, ...(faus ? [faus] : [])], { deadline: Date.now() + 15_000, reintentos429: 1 })
  return ids[0] ? `dc:${ids[0]}` : null
}

export const motorGuiones = (): 'local' | 'api' => (process.env.GUIONES_MOTOR?.trim() === 'api' ? 'api' : 'local')

export function depsReales(motor: 'local' | 'api' = motorGuiones()): DepsProceso {
  return {
    motor,
    exigirActivo: exigirClienteNoArchivado,
    leerKickoff: leerKickoffParaGuiones,
    registro: reg,
    analizarMercado: (ficha, topeMs) => analizarMercado(ficha, { topeMs }),
    kb: ficha => kbDeRama(ficha.rama.principal)?.texto ?? null,
    disparar: dispararPaso,
    avisar: avisarEquipo,
    ahora: () => Date.now(),
  }
}
