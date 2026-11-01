// ── Bot "Capital Jurídico": lo que hace la ruta /api/bot/whapi (BLOQUE W) ───────────────────────────────────────────────
// La ruta de Next (app/api/bot/whapi/route.ts) solo pasa `after` y las fábricas reales; toda la lógica vive acá para poder
// probarla sin Next, sin red y sin base (scripts/test-bot-whapi.mjs, con un motor de juguete).
//
// POST (webhook de Whapi). Responde en menos de 10 s: en el camino síncrono solo hay verificación, parseo, clasificación y
// el registro en Neon (motor.registrar, con tope de 8 s). Lo largo (bajar el comprobante, Claude, Sheets…) va en after().
//   1. Sin WHAPI_WEBHOOK_SECRETO válido o sin los dos grupos → 503 (falla cerrado; el log dice el NOMBRE de la variable).
//   2. Header x-cj-bot-secreto distinto (tiempo constante) → 401.
//   3. Con callback_persist, Whapi reintenta 24 h todo lo que no sea 200 (revisión 16): lo PERMANENTE responde 200 con
//      { ignorado }: cuerpo de más de 2 MB, JSON roto, cuerpo que no es un objeto o un channel_id ajeno (si WHAPI_CANAL_ID
//      está). Solo lo pasajero o un error de configuración responde 401/503.
//   4. Clasifica (webhook.ts). Un evento de la sesión del número (channel / users) → log (error si se desvinculó) y 200.
//      Sin eventos → 200, y se llama a motor.procesar([]) en after(): el motor hace ahí el barrido oportunista
//      (recordatorios, horas vencidas), porque sin cron solo despierta con los webhooks (revisión 22). Con `frenoBarrido`
//      (la ruta de Next lo pasa), como mucho uno cada 10 min por instancia: la charla de los grupos no mantiene despierta
//      la base de Neon (revisión del 24/10, ronda 2).
//   5. motor.registrar(eventos) con tope de 8 s. Si tira o se pasa → 503 y Whapi reintenta (lo ya guardado vuelve como
//      repetido y el motor lo devuelve en `nuevos` si sigue sin procesar: revisión 13).
//   6. after(() => motor.procesar(nuevos, { hasta: t0 + 285 s })) y 200 { recibido: true, … } (solo conteos).
//   Aparte del motor (25/10/2026, guiones.ts): con `reenviarGuiones` (la ruta de Next lo pasa), los textos de los grupos
//   «Contenido - <cliente>» se reenvían a /api/bot/guiones/respuesta en after(), antes de armar el motor (así un 503 del motor
//   no los frena; el reintento de Whapi no los duplica: dedupe por mensaje_id). En el camino síncrono solo se filtran (puro):
//   la consulta a Neon, a Whapi y el POST van en segundo plano. Pasa DESPUÉS del secreto y del filtro de WHAPI_CANAL_ID.
//   Etapa Éxito (25/10/2026, lib/bot/exito/*): con `procesarExito` (la ruta de Next lo pasa), del mismo envío se filtran (puro)
//   los mensajes y videos de los clientes en sus grupos (General, Ventas y Contenido) y las respuestas OK / NO a los pedidos
//   de testimonio en Verificaciones, y se procesan en after(), igual que Guiones: un 503 del motor no los frena y cada uno
//   lleva su propio dedupe (los dos procesos leen los mismos mensajes de Contenido sin pisarse). Docs: docs/BOT-EXITO-CJ.md.
//   Etapa Bajas (25/10/2026, lib/bot/bajas/*): con `procesarBajas` (la ruta de Next lo pasa), del mismo envío se filtran (puro)
//   las respuestas OK / NO que CITAN un mensaje en Verificaciones y los ecos del bot, y se procesan en after(), igual que
//   Guiones y Éxito: un 503 del motor no las frena. Cada etapa busca el mensaje citado entre SUS pedidos: si no es suyo, lo
//   ignora (Éxito ignora los de Bajas y al revés; el motor ignora los dos). Docs: docs/BOT-BAJAS-CJ.md.
// GET (Bearer CRON_SECRET): modo, capacidades y los NOMBRES de las variables que faltan. Nunca valores.
// El log lleva conteos y nombres de variables: nunca el secreto, el token, textos, teléfonos ni nombres.
import { randomBytes } from 'node:crypto'
import { accesoMaquina } from '@/lib/auth/acceso'
import { capacidadesDesconocidas, capacidadesReales, modoDesdeEntorno } from '@/lib/bot/alta/motor/modo'
import { PLAZO_INVOCACION_MS, type ClienteWhapiDesdeEntorno, type CrearMotorAltas, type MotorAltas, type ResultadoRegistro } from '@/lib/bot/alta/motor/tipos'
import { HEADER_SECRETO, configWebhook, estadoConfigWhapi } from './config'
import { limpiarDetalle } from './errores'
import { candidatosGuiones, gruposDelEquipo, personasDelEquipo, type ReenviarGuiones } from './guiones'
import { candidatosExito, gruposEquipoExito, sinCandidatos } from '@/lib/bot/exito/filtro'
import type { ProcesarExito } from '@/lib/bot/exito/servidor'
import { candidatosBajas, sinCandidatosBajas } from '@/lib/bot/bajas/filtro'
import type { ProcesarBajas } from '@/lib/bot/bajas/servidor'
import { candidatosNotas } from '@/lib/bot/anuncios/notas'
import type { ProcesarNotasAnuncios } from '@/lib/bot/anuncios/notasServidor'
import { clasificarEnvoltura, estadoDelCanal, resumenEventos, verificarSecreto } from './webhook'
import { guardiaWhapi } from './salud'

export const MAX_CUERPO_BYTES = 2_000_000
export const TOPE_REGISTRO_MS = 8_000

/** Freno del barrido oportunista: un webhook sin eventos nuevos despierta el barrido como mucho cada `intervaloMs` (lo
 *  comparten las invocaciones de la misma instancia). Cada barrido son unas 6 consultas a Neon (la misma base que Cuotas y
 *  el kickoff): con cada mensaje de cualquier grupo la base no llegaba a dormirse. Un webhook con eventos nuevos procesa
 *  siempre (y cuenta como barrido). */
export interface FrenoBarrido { ultimo: number; intervaloMs: number }
export const INTERVALO_BARRIDO_VACIO_MS = 10 * 60_000
export const FRENO_BARRIDO: FrenoBarrido = { ultimo: 0, intervaloMs: INTERVALO_BARRIDO_VACIO_MS }

export interface RegistroLog { info(m: string): void; warn(m: string): void; error(m: string): void }

export interface DepsRutaWhapi {
  crearMotor: CrearMotorAltas
  clienteWhapi: ClienteWhapiDesdeEntorno
  /** after() de Next: corre la tarea después de responder (hasta maxDuration). */
  programar: (tarea: () => Promise<void>) => void
  env?: NodeJS.ProcessEnv
  ahora?: () => number
  log?: RegistroLog
  idInvocacion?: () => string
  /** Sin freno, cada webhook sin eventos barre (los tests); la ruta de Next pasa FRENO_BARRIDO. */
  frenoBarrido?: FrenoBarrido
  /** Reenvío a Guiones de los grupos Contenido (guiones.ts). Sin esto (los tests de antes), no se reenvía nada. */
  reenviarGuiones?: ReenviarGuiones
  /** Etapa Éxito (lib/bot/exito/servidor.ts). Sin esto, no se procesa nada de esa etapa. */
  procesarExito?: ProcesarExito
  /** Etapa Bajas (lib/bot/bajas/servidor.ts). Sin esto, no se procesa nada de esa etapa. */
  procesarBajas?: ProcesarBajas
  /** Notas del cliente para Anuncios (lib/bot/anuncios/notasServidor.ts). Solo lee. Sin esto, no se procesa nada. */
  procesarNotasAnuncios?: ProcesarNotasAnuncios
}

/** Filtra (puro) lo que el cliente dice de sus anuncios y lo procesa en after(). Nunca tira ni demora la respuesta. */
function programarNotas(deps: DepsRutaWhapi, log: RegistroLog, env: NodeJS.ProcessEnv, datos: unknown, grupos: { ventas: string; verificaciones: string }, t0: number): number {
  const procesar = deps.procesarNotasAnuncios
  if (!procesar) return 0
  let cands: ReturnType<typeof candidatosNotas>
  try {
    cands = candidatosNotas(datos, grupos, t0, personasDelEquipo(env), gruposEquipoExito(env))
  } catch (e) {
    log.error(`bot-whapi: notas de anuncios — no se pudieron filtrar los mensajes: ${motivoDe(e)}`)
    return 0
  }
  if (!cands.length) return 0
  deps.programar(async () => {
    try {
      await procesar(cands, { env, log })
    } catch (e) {
      log.error(`bot-whapi: notas de anuncios — el proceso tiró: ${motivoDe(e)}`)
    }
  })
  return cands.length
}

/** Filtra (puro) las respuestas citadas de Verificaciones y los ecos para la etapa Bajas y las procesa en after(). Nunca tira. */
function programarBajas(deps: DepsRutaWhapi, log: RegistroLog, env: NodeJS.ProcessEnv, datos: unknown, grupos: { ventas: string; verificaciones: string }, t0: number): number {
  const procesar = deps.procesarBajas
  if (!procesar) return 0
  let cands: ReturnType<typeof candidatosBajas>
  try {
    cands = candidatosBajas(datos, grupos, t0)
  } catch (e) {
    log.error(`bot-whapi: bajas — no se pudieron filtrar los mensajes: ${motivoDe(e)}`)
    return 0
  }
  if (sinCandidatosBajas(cands)) return 0
  deps.programar(async () => {
    try {
      await procesar(cands, { env, log })
    } catch (e) {
      log.error(`bot-whapi: bajas — el proceso tiró: ${motivoDe(e)}`)
    }
  })
  return cands.respuestas.length + cands.ecos.length
}

/** Filtra (puro) lo que le importa a la etapa Éxito y lo procesa en after(). Nunca tira ni demora la respuesta. */
function programarExito(deps: DepsRutaWhapi, log: RegistroLog, env: NodeJS.ProcessEnv, datos: unknown, grupos: { ventas: string; verificaciones: string }, t0: number): number {
  const procesar = deps.procesarExito
  if (!procesar) return 0
  let cands: ReturnType<typeof candidatosExito>
  try {
    cands = candidatosExito(datos, grupos, t0, personasDelEquipo(env), gruposEquipoExito(env))
  } catch (e) {
    log.error(`bot-whapi: éxito — no se pudieron filtrar los mensajes: ${motivoDe(e)}`)
    return 0
  }
  if (sinCandidatos(cands)) return 0
  deps.programar(async () => {
    try {
      await procesar(cands, { env, log })
    } catch (e) {
      log.error(`bot-whapi: éxito — el proceso tiró: ${motivoDe(e)}`)
    }
  })
  return cands.mensajes.length + cands.videos.length + cands.respuestas.length + cands.ecos.length
}

/** Filtra (puro) los mensajes que pueden ir a Guiones y programa el reenvío en after(). Nunca tira ni demora la respuesta. */
function programarGuiones(deps: DepsRutaWhapi, log: RegistroLog, env: NodeJS.ProcessEnv, req: Request, datos: unknown, grupos: { ventas: string; verificaciones: string }, t0: number): number {
  const reenviar = deps.reenviarGuiones
  if (!reenviar) return 0
  let candidatos: ReturnType<typeof candidatosGuiones>['candidatos']
  let origen: string
  try {
    candidatos = candidatosGuiones(datos, grupos, t0, personasDelEquipo(env), gruposDelEquipo(env)).candidatos
    origen = new URL(req.url).origin
  } catch (e) {
    log.error(`bot-whapi: guiones — no se pudieron filtrar los mensajes: ${motivoDe(e)}`)
    return 0
  }
  if (!candidatos.length) return 0
  deps.programar(async () => {
    try {
      await reenviar(candidatos, { env, origen, log })
    } catch (e) {
      log.error(`bot-whapi: guiones — el reenvío tiró: ${motivoDe(e)}`)
    }
  })
  return candidatos.length
}

/** ¿Toca barrer? Con eventos nuevos, siempre. Sin eventos, solo si pasó el intervalo desde el último barrido de la instancia. */
function tocaBarrer(deps: DepsRutaWhapi, t0: number, conEventos: boolean): boolean {
  const f = deps.frenoBarrido
  if (!f) return true
  if (!conEventos && t0 - f.ultimo < f.intervaloMs) return false
  f.ultimo = t0
  return true
}

const SIN_CACHE = { 'Cache-Control': 'no-store' }
const responder = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status, headers: SIN_CACHE })
const motivoDe = (e: unknown) => limpiarDetalle(e instanceof Error ? `${e.name}: ${e.message}` : String(e), null, 200)

function armarMotor(deps: DepsRutaWhapi, env: NodeJS.ProcessEnv, grupos: { ventas: string; verificaciones: string }): MotorAltas {
  const modo = modoDesdeEntorno(env)
  const capacidades = capacidadesReales(modo, env)
  const whapi = deps.clienteWhapi({ modo, capacidades, grupos })
  return deps.crearMotor({ whapi, modo, capacidades, grupos, ahora: deps.ahora })
}

/** Corre motor.procesar en after(): nunca deja escapar un error (el motor tampoco debería tirar). */
function programarProceso(deps: DepsRutaWhapi, log: RegistroLog, motor: MotorAltas, eventos: Parameters<MotorAltas['procesar']>[0], t0: number) {
  const invocacion = deps.idInvocacion?.() ?? `wh-${t0.toString(36)}-${randomBytes(3).toString('hex')}`
  deps.programar(async () => {
    try {
      const r = await motor.procesar(eventos, { hasta: t0 + PLAZO_INVOCACION_MS, invocacion })
      if (eventos.length || r.altas.length || r.errores.length) {
        log.info(`bot-whapi: ${invocacion} → ${eventos.length} evento(s), ${r.altas.length} alta(s) tocadas, ${r.continuaciones} continuación(es), ${r.errores.length} error(es)`)
      }
    } catch (e) {
      log.error(`bot-whapi: ${invocacion} — el motor tiró al procesar: ${motivoDe(e)}`)
    }
  })
}

async function leerCuerpo(req: Request): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declarado) && declarado > MAX_CUERPO_BYTES) return null
  const texto = await req.text()
  return Buffer.byteLength(texto, 'utf8') > MAX_CUERPO_BYTES ? null : texto
}

export async function atenderWebhook(req: Request, deps: DepsRutaWhapi): Promise<Response> {
  const ahora = deps.ahora ?? Date.now
  const log = deps.log ?? console
  const env = deps.env ?? process.env
  const t0 = ahora()

  const cfg = configWebhook(env)
  if (!cfg.ok) {
    const nombres = [...cfg.faltan.map((n) => `${n} (falta)`), ...cfg.invalidas.map((n) => `${n} (mal escrita)`)]
    log.error(`bot-whapi: ${nombres.join(', ')} — se rechazan todos los envíos de Whapi (503)`)
    return responder({ error: 'no configurado' }, 503)
  }
  if (!verificarSecreto(req.headers, cfg.config.secreto)) {
    log.warn(`bot-whapi: envío sin el header ${HEADER_SECRETO} correcto (401)`)
    return responder({ error: 'no autorizado' }, 401)
  }

  let cuerpo: string | null
  try {
    cuerpo = await leerCuerpo(req)
  } catch {
    // El cuerpo se cortó en el camino: es pasajero, que Whapi lo reintente
    return responder({ error: 'no se pudo leer el cuerpo' }, 503)
  }
  if (cuerpo === null) {
    log.warn(`bot-whapi: envío de más de ${MAX_CUERPO_BYTES} bytes: se ignora`)
    return responder({ recibido: false, ignorado: 'cuerpo_grande' })
  }
  let datos: unknown
  try {
    datos = JSON.parse(cuerpo)
  } catch {
    log.warn('bot-whapi: envío con JSON roto: se ignora')
    return responder({ recibido: false, ignorado: 'json' })
  }
  const r = clasificarEnvoltura(datos, cfg.config.grupos, t0)
  if (!r) {
    log.warn('bot-whapi: el cuerpo no es un objeto: se ignora')
    return responder({ recibido: false, ignorado: 'forma' })
  }
  if (cfg.config.canalId && r.canalId !== cfg.config.canalId) {
    log.warn('bot-whapi: envío de otro canal de Whapi (channel_id distinto de WHAPI_CANAL_ID): se ignora')
    return responder({ recibido: false, ignorado: 'canal' })
  }
  // La sesión del número cambió de estado: si se desvinculó, queda como ERROR en el log (sin datos personales)
  const canal = estadoDelCanal(datos)
  if (canal) {
    const que = `${canal.tipo}${canal.metodo ? `.${canal.metodo}` : ''}${canal.estado ? ` (${canal.estado})` : ''}`
    if (canal.caido) {
      log.error(`bot-whapi: la sesión del número de Whapi se cayó: ${que}. El bot no recibe ni manda nada hasta volver a vincular el número en el panel de whapi.cloud.`)
      // WhatsApp seguro: la guardia de salud frena todos los envíos hasta que /health diga AUTH y avisa una vez a Discord
      deps.programar(async () => { await guardiaWhapi().reportarCaida(`webhook de Whapi: ${que}`, { estado: canal.estado, ahora }).catch(() => {}) })
    }
    else log.info(`bot-whapi: estado del canal de Whapi: ${que}`)
    return responder({ recibido: true, canal: canal.estado ?? canal.tipo, caido: canal.caido })
  }
  const aGuiones = programarGuiones(deps, log, env, req, datos, cfg.config.grupos, t0)
  const aExito = programarExito(deps, log, env, datos, cfg.config.grupos, t0)
  const aBajas = programarBajas(deps, log, env, datos, cfg.config.grupos, t0)
  const aNotas = programarNotas(deps, log, env, datos, cfg.config.grupos, t0)
  const descartados = Object.values(r.descartes).reduce((a, b) => a + (b ?? 0), 0)
  if (r.total) {
    const motivos = Object.entries(r.descartes).map(([k, v]) => `${k}:${v}`).join(' ')
    log.info(`bot-whapi: ${r.total} mensaje(s) → eventos ${resumenEventos(r.eventos)}${descartados ? ` · descartados ${motivos}` : ''}${aGuiones ? ` · ${aGuiones} candidato(s) a Guiones` : ''}${aExito ? ` · ${aExito} candidato(s) a Éxito` : ''}${aBajas ? ` · ${aBajas} candidato(s) a Bajas` : ''}${aNotas ? ` · ${aNotas} candidato(s) a notas de Anuncios` : ''}`)
  }

  let motor: MotorAltas
  try {
    motor = armarMotor(deps, env, cfg.config.grupos)
  } catch (e) {
    log.error(`bot-whapi: no se pudo armar el motor: ${motivoDe(e)} (503)`)
    return responder({ error: 'motor no disponible' }, 503)
  }

  if (!r.eventos.length) {
    if (tocaBarrer(deps, t0, false)) programarProceso(deps, log, motor, [], t0)
    return responder({ recibido: true, eventos: 0, descartados })
  }

  let reg: ResultadoRegistro
  let reloj: ReturnType<typeof setTimeout> | undefined
  try {
    const tope = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error(`registrar tardó más de ${TOPE_REGISTRO_MS / 1000} s`)), TOPE_REGISTRO_MS)
    })
    reg = await Promise.race([motor.registrar(r.eventos), tope])
  } catch (e) {
    log.error(`bot-whapi: no se pudieron registrar ${r.eventos.length} evento(s): ${motivoDe(e)} (503: Whapi reintenta)`)
    return responder({ error: 'no se pudo registrar' }, 503)
  } finally {
    if (reloj) clearTimeout(reloj)
  }

  if (tocaBarrer(deps, t0, reg.nuevos.length > 0)) programarProceso(deps, log, motor, reg.nuevos, t0)
  return responder({ recibido: true, eventos: r.eventos.length, nuevos: reg.nuevos.length, repetidos: reg.repetidos.length, descartados })
}

export async function atenderEstado(req: Request, deps: Pick<DepsRutaWhapi, 'env'> = {}): Promise<Response> {
  if (!accesoMaquina(req.headers)) return responder({ error: 'no autorizado' }, 401)
  const env = deps.env ?? process.env
  const modo = modoDesdeEntorno(env)
  const capacidades = [...capacidadesReales(modo, env)]
  const whapi = estadoConfigWhapi(env)
  return responder({
    modo,
    capacidades,
    capacidades_desconocidas: capacidadesDesconocidas(env).length,
    whapi,
    webhook_configurado: configWebhook(env).ok,
    header_secreto: HEADER_SECRETO,
    plazo_ms: PLAZO_INVOCACION_MS,
    nota: 'Los eventos y las altas se ven en GET /api/bot/alta/motor (Bearer CRON_SECRET).',
  })
}
