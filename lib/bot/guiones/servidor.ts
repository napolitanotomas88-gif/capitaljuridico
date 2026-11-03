// ── Dependencias REALES de la etapa Guiones (Neon, ficha de kickoff, Claude, Discord, disparo de pasos) ──
// Las usa la ruta /api/bot/guiones. Separado del route.ts porque un route.ts de Next solo exporta GET/POST/…
//   · leerKickoff: la fila de cj_kickoffs (registro del kickoff, solo lectura) → ficha + ideas.
//   · disparar: POST a <Despacho>/api/bot/guiones con Bearer CRON_SECRET y {paso, id, numero}, esperando SOLO el 202 (el
//     trabajo corre en after(), en otra invocación con sus propios 300 s). Mismo patrón que dispararMapaReal del kickoff.
//   · avisar (pedido de Tomás del 25/10): al grupo de guiones del equipo en WhatsApp (WHAPI_GRUPO_COPYWRITING, Whapi) con el
//     link a /guiones/<id>: «lista para revisar» o «el cliente pidió cambios y ya están aplicados». Es un grupo INTERNO (no un
//     cliente). Sin el grupo o sin WHAPI_TOKEN, va a Discord (DISCORD_WEBHOOK_GUIONES o #📝-kickoff) mencionando a Faus y Gero M.
//     Desde el 3/11/2026 (Tomás): menciona a Faus (revisa y da el check final) y Gero M (atento), nunca a Tomás; guarda la ronda de revisión y el vigía recuerda a las 24/48 h
//     (avisoRevision.ts).
// Solo servidor.
import { leerKickoff } from '../kickoff/registro'
import { kbDeRama } from '../kickoff/kb/index'
import { urlDespacho, webhookKickoff } from '../kickoff/entorno'
import type { ExtraccionKickoff, IdeaGuion } from '../kickoff/tipos'
import { analizarMercado } from './mercado'
import * as reg from './registro'
import type { DepsProceso, KickoffParaGuiones, Paso, TipoAviso } from './proceso'
import { alertar } from '@/lib/alertas'
import { whatsappBotEncendido } from '../whapi/corte'
import { crearClienteWhapi } from '../whapi/cliente'
import { tokenWhapi } from '../whapi/config'
import type { FilaTanda } from './registro'
import { notificarRevision } from './entrega'
import { exigirClienteNoArchivado, leerArchivados } from '@/lib/clientes/archivados'
import { alertaBarrido, alertaRevision, claveAviso, correrRecordatoriosRevision, desdeAviso } from './avisoRevision'
import { guardarRonda, leerRondas, limpiarRondas, marcarRonda, reservarRonda } from './rondas'

const TOPE_DISPARO_MS = 25_000
export const webhookGuiones = (): string => process.env.DISCORD_WEBHOOK_GUIONES?.trim() || webhookKickoff()

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
    ? `✍️ Guiones listos para revisar: ${cliente} · ${n} guiones (tanda ${fila.tanda}). Faus: revisalos y da el check final acá${link ? `: ${link}` : ' (falta el ID del CRM)'}. Gero M: atento`
    : `🔁 ${cliente} pidió cambios en sus guiones y el bot ya los aplicó. Faus: revisalos y da el check final acá${link ? `: ${link}` : ''}. Gero M: atento`
}

/** El aviso al equipo de una tanda que pasó a «a_revisar»: campanita del Hub + ✍️-guiones (Faus y Gero M) y la ronda
 *  de revisión (desde cuándo, para los recordatorios de 24/48 h del vigía). Lo usan TODOS los caminos que ponen a_revisar. */
export async function avisarEquipo(fila: FilaTanda, tipo: TipoAviso): Promise<string | null> {
  await exigirClienteNoArchivado(fila.id_crm, await leerArchivados({ forzar: true }))
  await notificarRevision(fila, tipo !== 'revisar').catch(e => console.error('Guiones: aviso del Hub pendiente —', (e as Error)?.name ?? 'error'))
  const clave = claveAviso(fila, tipo)
  const ronda = (estado: string) => guardarRonda({ tanda_id: fila.id, tipo, clave, estado }).catch(e => console.error('Guiones: no se guardó la ronda de revisión —', (e as Error)?.name ?? 'error'))
  const grupo = grupoGuionesEquipo(), token = tokenWhapi()
  // Sin WhatsApp (2/11/2026, WHATSAPP_BOT distinto de «encendido»): el aviso va solo a ✍️-guiones de Discord
  if (grupo && token && whatsappBotEncendido()) {
    try {
      const env = await crearClienteWhapi({ token }).enviarTexto({ chatId: grupo, texto: textoAviso(fila, tipo) })
      await ronda('whatsapp')
      return `wa:${env.id ?? 'sin-id'}`
    } catch (e) {
      console.error('Guiones: el aviso por WhatsApp no salió, va a Discord:', (e as Error).message?.slice(0, 160))
    }
  }
  const r = await alertar(alertaRevision(fila, tipo, clave))
  await ronda(r.estado)
  return r.estado === 'enviado' ? `dc:${r.mensajeId ?? ''}` : null
}

/** Recordatorios de tandas sin revisar (24 h: Faus y Gero M; 48 h: escala a Gero M) y avisos que faltaron. Lo corre el vigía (cada
 *  15 min) y el cron diario. Nunca tira. */
export async function recordarGuionesARevisar(op: { dry?: boolean } = {}) {
  if (!reg.baseConfigurada()) return null
  try {
    const r = await correrRecordatoriosRevision({
      leer: reg.tandasARevisar, rondas: leerRondas, reservar: reservarRonda, marcar: marcarRonda, limpiar: limpiarRondas,
      avisar: async (fila, tipo) => { const m = await avisarEquipo(fila, tipo); if (m) await reg.anotarAviso(fila.id, m).catch(() => {}); return m },
      alertar,
    }, op)
    if (r.avisos.length || r.recordatorios.length || r.errores.length) console.log(`guiones-revision: avisos ${r.avisos.join(' · ') || '0'} | recordatorios ${r.recordatorios.join(' · ') || '0'}${r.errores.length ? ` | errores ${r.errores.join(' · ')}` : ''}`)
    return r
  } catch (e) {
    console.error('guiones-revision: falla —', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return null
  }
}

/** Barrido (3/11/2026): UN mensaje en ✍️-guiones con todas las tandas que hoy esperan revisión (Faus y Gero M) y la
 *  ronda de cada una (estado «barrido», desde ahora: los recordatorios de 24/48 h cuentan desde este aviso). */
export async function barridoGuionesARevisar(op: { dry?: boolean } = {}) {
  const filas = await reg.tandasARevisar()
  const items = filas.map(fila => ({ fila, desde: desdeAviso(fila) })).sort((a, b) => a.desde.localeCompare(b.desde))
  const lista = items.map(({ fila, desde }) => ({ id: fila.id, id_crm: fila.id_crm, cliente: fila.cliente, tanda: fila.tanda, desde }))
  if (op.dry || !items.length) return { lista, alerta: null }
  const ahora = new Date().toISOString()
  const alerta = await alertar(alertaBarrido(items, urlDespacho(), ahora.slice(0, 10)))
  for (const { fila } of items) await reservarRonda({ tanda_id: fila.id, desde: ahora, tipo: 'revisar', clave: null, estado: 'barrido' }).catch(e => console.error('Guiones: ronda del barrido —', (e as Error)?.name ?? 'error'))
  return { lista, alerta: alerta.estado }
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
