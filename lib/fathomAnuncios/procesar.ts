// ── Orquestador: una grabación de Fathom → cambios por cliente → Discord ─────────────────────────
// procesarReunion() hace el recorrido completo con las dependencias INYECTADAS (base, CRM, Claude, Discord, reloj), así
// los tests lo prueban con fakes y la ruta le pasa las reales:
//   1. valida el payload;
//   2. con dry no toca la base ni Discord (sí lee el CRM y llama a Claude: es para probar la extracción de verdad);
//   3. reclama la grabación en el registro y guarda el payload (si otra ejecución ya la tiene o ya terminó →
//      "duplicada", no hace nada). Si la fila ya tenía algo de un intento anterior, se RETOMA (ver abajo);
//   4. sin transcripción en el payload → "error" con un aviso a Tomás (una sola vez por grabación): es que el webhook
//      de Fathom no tiene activado Transcript. Transcripción con menos de MIN_RENGLONES renglones o grabación de menos
//      de 3 minutos → "omitida", sin Claude;
//   5. lista de clientes del CRM (best effort) y alias de la bóveda;
//   6. extracción con Claude, que se guarda en el registro APENAS sale (antes de mandar nada);
//   7. llamada de venta, o ningún cliente con cambios ni pendientes → "sin_cambios" (no se manda nada);
//   8. un mensaje (o más, si no entra en 2000 caracteres) por cliente, mencionando a Valentino; después de cada
//      cliente que salió entero, su clave queda anotada en clientes_enviados;
//   9. "enviado" con los ids de Discord, conteos, tokens, duración y el resultado. El payload se borra.
//
// Retomar sin duplicar: si la fila ya tiene la extracción de la MISMA versión del prompt, se reusa (no se vuelve a
// llamar a Claude) y se mandan solo los clientes que no están en clientes_enviados. Con forzar se re-extrae y se manda
// TODO de nuevo (duplica lo que ya había salido: es a propósito).
//
// Tiempo: un deadline único (t0 + PLAZO_MS, o el que pase el cron). A Claude se le da hasta deadline − ahora − 30 s
// (nunca más de 240 s por intento, lo recorta extraer.ts); Discord no espera más allá del deadline. Si un paso falla con
// un error transitorio (Claude 429/5xx/529/red, Discord 5xx/timeout, Neon de red) y queda tiempo, se espera
// ESPERA_REINTENTO_MS y se reintenta ese paso UNA vez.
//
// Ante un error: "error" en el registro con el motivo y UN aviso corto al mismo canal mencionando a Tomás, que dice la
// verdad sobre el reintento (lo toma el cron de la mañana, o ya no porque llegó al tope, o no quedó registrada). Si el
// aviso también falla, solo queda en el log. Los motivos se limpian (sin URLs ni claves) antes de guardarlos o mandarlos.
//
// reintentarPendientes() es el cron diario (8:30 AR; en Hobby corre entre las 8 y las 9): hasta MAX_FILAS_CRON filas
// en error o colgadas en procesando, con payload e intentos < TOPE_INTENTOS_CRON, en serie y dentro del deadline.
//
// Kickoffs (24/10): si el bot de kickoff dice que la llamada es una kickoff, no se manda nada ("omitida"): Valentino ya
// recibe el «🚀 Para lanzar». Se mira antes de Claude (si ya está decidido, ni se llama) y otra vez antes de mandar,
// esperando a que se decida si hace falta. Ver kickoff.ts.
import type { AliasCliente, ContextoCRM, Extraccion, ResultadoExtraccion, ReunionFathom } from './tipos'
import { TIPOS_REUNION, validarReunion } from './tipos'
import { LARGO_AVISO, duracionGrabacionS, formatearTranscripcion } from './transcripcion'
import {
  armarMensajes, clavesUnicas, textoAgotada, textoAviso, textoColgadaReintentada, textoSinPayload, textoSinTranscripcion, tieneAlgo, type Reintento,
} from './mensaje'
import { VERSION_PROMPT } from './prompt'
import type { Extraida, FilaPendiente, Marca, OpcionesReclamo, Reclamo } from './registro'
import { ESPERA_KICKOFF_MAX_MS, ESPERA_KICKOFF_PASO_MS, MOTIVO_KICKOFF, TOPE_LECTURA_KICKOFF_MS, decidirKickoff, type ConsultaKickoff, type DecisionKickoff } from './kickoff'
import type { EntradaExtraccion } from './extraer'
import { ErrorTransitorio, esTransitorio } from './errores'

export const MIN_RENGLONES = 6
export const MIN_DURACION_S = 3 * 60
// Tomás: el mismo ID que menciona el reporte semanal de anuncios (lib/anuncios/discord.ts, MENCIONES_REPORTE.tomas)
export const ID_TOMAS = process.env.DISCORD_ID_TOMAS?.trim() ?? ''

// ── Tiempos (maxDuration de la ruta: 300 s) ──
export const PLAZO_MS = 280_000                 // deadline desde que arranca el procesamiento
export const RESERVA_ESCRITURAS_MS = 20_000     // Discord termina 20 s antes del deadline: quedan anotarEnviados y marcar (10 s c/u)
export const MARGEN_ENVIO_MS = 30_000           // lo que se guarda, después de Claude, para mandar y avisar
export const MIN_CLAUDE_MS = 60_000             // con menos que esto no vale la pena arrancar una llamada a Claude
export const ESPERA_REINTENTO_MS = 6_000        // antes del único reintento de un paso
export const PAUSA_ENTRE_CLIENTES_MS = 400      // igual que entre mensajes (discord.ts): llegan en orden
const MIN_RESTANTE = { base: 15_000, discord: 20_000, claude: MARGEN_ENVIO_MS + MIN_CLAUDE_MS }

// ── Cron de reintentos ──
export const TOPE_INTENTOS_CRON = 4             // el cron no toma filas con intentos >= 4 (con forzar no hay tope)
export const MAX_FILAS_CRON = 5
export const MIN_PARA_OTRA_FILA_MS = 120_000    // el cron no arranca otra fila si queda menos que esto
export const PREFIJO_SIN_PAYLOAD = 'sin_payload:'
export const PREFIJO_SIN_TRANSCRIPCION = 'sin_transcripcion:'
export const PREFIJO_AGOTADA = 'agotada:'

export interface Deps {
  reclamar(id: number, op: OpcionesReclamo, datos: { titulo: string; url: string; payload: ReunionFathom }): Promise<Reclamo | null>
  guardarExtraccion(id: number, x: Extraida): Promise<void>
  anotarEnviados(id: number, clientes: string[], mensajes: string[]): Promise<void>
  marcar(id: number, m: Marca): Promise<void>
  contexto(): Promise<ContextoCRM>
  /** topeMs: lo máximo que puede tardar este intento (extraer.ts además lo recorta a 240 s). */
  extraer(e: EntradaExtraccion, topeMs: number): Promise<ResultadoExtraccion>
  /** Manda los mensajes en orden sin pasarse del deadline y devuelve los ids. Si falla a mitad, el error trae `enviados`. */
  enviar(mensajes: string[], deadline: number): Promise<string[]>
  avisar(texto: string): Promise<void>
  esperar(ms: number): Promise<void>
  /** Cómo clasificó la grabación el bot de kickoff (cj_kickoffs, solo lectura). Sin esta dependencia no se mira. */
  kickoff?(id: number): Promise<ConsultaKickoff>
  alias: AliasCliente[]
  valentino: string | null
  discordListo: boolean
  ahora(): number
}

/** Lo que además necesita el cron de reintentos. */
export interface DepsCron extends Deps {
  pendientes(limite: number, topeIntentos: number, excluir: readonly string[]): Promise<FilaPendiente[]>
  leerPayload(id: number): Promise<{ payload: unknown; estado: string; intentos: number } | undefined>
  /** true si esta ejecución la marcó (si otra ya lo hizo, false: así el aviso sale una sola vez). */
  marcarSinPayload(id: number, error: string): Promise<boolean>
  /** Cierra una colgada que ya llegó al tope; true si esta ejecución la cerró. */
  marcarAgotada(id: number, error: string): Promise<boolean>
}

export type EstadoProceso = 'invalida' | 'duplicada' | 'omitida' | 'sin_cambios' | 'enviado' | 'error' | 'dry'

export interface ResultadoRegistrado {
  tipo_reunion: Extraccion['tipo_reunion']
  resumen_corto: string
  clientes: Extraccion['clientes']
  ajustes: string[]
  contexto: ContextoCRM['estado']
  aviso_contexto?: string
  renglones: number
  largo: number
}

export interface ResultadoProceso {
  estado: EstadoProceso
  recording_id?: number
  motivo?: string
  mensajes?: string[]          // textos que se mandaron en esta pasada (o se mandarían, con dry)
  ids?: string[]               // ids de Discord (todos los de la grabación, también los de intentos anteriores)
  resultado?: ResultadoRegistrado
  modelo?: string
  usage?: ResultadoExtraccion['usage']
  reutilizado?: boolean        // true = se reusó la extracción guardada (no se llamó a Claude)
  intentos?: number
  kickoff?: DecisionKickoff    // lo último que se leyó del bot de kickoff (con dry no se espera: es lo que había)
}

export interface OpcionesProceso {
  dry?: boolean
  forzar?: boolean
  /** Solo el cron: no toma filas con intentos >= topeIntentos. */
  topeIntentos?: number
  /** Hora límite (ms epoch). Por defecto, t0 + PLAZO_MS. */
  deadline?: number
  /** Solo a mano: no mirar el bot de kickoff (si clasificó mal un seguimiento como kickoff). */
  ignorarKickoff?: boolean
}

/** Motivo de un error, apto para guardar y para Discord: sin URLs ni claves, acotado. */
export function motivoDe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return (m || 'error desconocido')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\bsk-ant-[\w-]+/g, '[clave]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Hora (0–23) en Buenos Aires. */
function horaAR(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)))
}

/** Qué decir sobre el reintento en el aviso de error (la verdad según el estado de la fila). */
export function reintentoDe(reclamo: Pick<Reclamo, 'intentos'> | null, ahoraMs: number): Reintento {
  if (!reclamo) return { tipo: 'sin_registro' }
  if (reclamo.intentos >= TOPE_INTENTOS_CRON) return { tipo: 'sin_mas', intentos: reclamo.intentos }
  return { tipo: 'automatico', cuando: horaAR(ahoraMs) < 8 ? 'hoy' : 'mañana' }
}

const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** La extracción guardada, si se puede reusar: misma versión del prompt, sin forzar y con la forma esperada. */
export function resultadoGuardado(reclamo: Reclamo | null, forzar: boolean): ResultadoRegistrado | null {
  if (!reclamo || forzar || reclamo.version_prompt !== VERSION_PROMPT) return null
  const x = reclamo.resultado
  if (!esObj(x) || !(TIPOS_REUNION as readonly unknown[]).includes(x.tipo_reunion) || !Array.isArray(x.clientes)) return null
  const bien = x.clientes.every(c => esObj(c) && typeof c.nombre_escuchado === 'string' && Array.isArray(c.cambios) && Array.isArray(c.pendientes))
  return bien ? (x as unknown as ResultadoRegistrado) : null
}

/** Los ids que alcanzaron a salir antes de un error de envío (ErrorEnvio.enviados). */
function enviadosDe(e: unknown): string[] {
  const parcial = esObj(e) || e instanceof Error ? (e as { enviados?: unknown }).enviados : undefined
  return Array.isArray(parcial) ? parcial.filter((x): x is string => typeof x === 'string') : []
}

class ErrorSinTranscripcion extends Error {
  constructor() {
    super(`${PREFIJO_SIN_TRANSCRIPCION} el webhook de Fathom llegó sin transcripción (activar Transcript en el webhook de Fathom)`)
  }
}

export async function procesarReunion(payload: unknown, deps: Deps, op: OpcionesProceso = {}): Promise<ResultadoProceso> {
  const t0 = deps.ahora()
  const deadline = op.deadline ?? t0 + PLAZO_MS
  const v = validarReunion(payload)
  if (!v.ok) return { estado: 'invalida', motivo: v.error }
  const r = v.reunion, id = r.recording_id, dry = !!op.dry, forzar = !!op.forzar
  const duracion = () => Math.max(0, Math.round(deps.ahora() - t0))
  const tr = formatearTranscripcion(r.transcript)
  let reclamo: Reclamo | null = null
  const ids: string[] = []                // ids de Discord de la grabación (los de antes + los de esta pasada)
  const clientesEnviados: string[] = []   // claves de los clientes que ya salieron enteros

  /** Corre un paso; si falla con un error transitorio y queda tiempo, espera y lo reintenta UNA vez. */
  const paso = async <T>(que: keyof typeof MIN_RESTANTE, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (!esTransitorio(e) || deadline - deps.ahora() - ESPERA_REINTENTO_MS < MIN_RESTANTE[que]) throw e
      console.warn(`fathom-anuncios: grabación ${id}, ${que}: ${motivoDe(e)} — reintento en ${ESPERA_REINTENTO_MS / 1000} s`)
      await deps.esperar(ESPERA_REINTENTO_MS)
      return await fn()
    }
  }

  /** Lo que dice el bot de kickoff. Si no se puede leer, "pendiente": se vuelve a probar mientras quede espera. */
  const consultarKickoff = async (): Promise<DecisionKickoff> => {
    if (!deps.kickoff || op.ignorarKickoff) return 'desconocido'
    // Sin margen para leer y después mandar, no se mira (best effort: se manda como siempre)
    if (deadline - deps.ahora() < MARGEN_ENVIO_MS + TOPE_LECTURA_KICKOFF_MS * 2) return 'desconocido'
    try {
      return decidirKickoff(await deps.kickoff(id))
    } catch (e) {
      console.warn(`fathom-anuncios: grabación ${id}, no se pudo leer el bot de kickoff — ${motivoDe(e)}`)
      return 'pendiente'
    }
  }
  /** Es una kickoff: queda "omitida" (con la extracción, si la hubo) y no se manda nada. */
  const omitirPorKickoff = async (comun: Partial<Marca>, extra: Partial<ResultadoProceso> = {}): Promise<ResultadoProceso> => {
    if (!dry) await paso('base', () => deps.marcar(id, { estado: 'omitida', error: MOTIVO_KICKOFF, clientes: 0, cambios: 0, ...comun, duracion_ms: duracion() }))
    return { estado: 'omitida', recording_id: id, ...extra, motivo: MOTIVO_KICKOFF, mensajes: [], kickoff: 'kickoff' }
  }

  try {
    if (!dry) {
      reclamo = await paso('base', () => deps.reclamar(id, { forzar, topeIntentos: op.topeIntentos }, { titulo: r.title, url: r.url, payload: r }))
      if (!reclamo) return { estado: 'duplicada', recording_id: id }
      ids.push(...reclamo.mensajes)
      clientesEnviados.push(...reclamo.clientes_enviados)
      if (!deps.discordListo) throw new Error('falta DISCORD_WEBHOOK_CAMBIOS_ANUNCIOS (o DISCORD_WEBHOOK_ANUNCIOS)')
    }

    // 4. Sin transcripción es la configuración del webhook (no una llamada corta); prueba o cortada → omitida, sin Claude
    if (r.transcript === null) throw new ErrorSinTranscripcion()
    const durS = duracionGrabacionS(r, tr)
    const motivoOmitida = tr.renglones < MIN_RENGLONES
      ? `transcripción con ${tr.renglones} renglones (mínimo ${MIN_RENGLONES})`
      : durS !== null && durS < MIN_DURACION_S ? `grabación de ${durS} s (mínimo ${MIN_DURACION_S / 60} min)` : null
    if (motivoOmitida) {
      if (!dry) await paso('base', () => deps.marcar(id, { estado: 'omitida', error: motivoOmitida, duracion_ms: duracion(), resultado: { renglones: tr.renglones, largo: tr.largo } }))
      return { estado: 'omitida', recording_id: id, motivo: motivoOmitida, mensajes: [] }
    }
    if (tr.largo > LARGO_AVISO) console.warn(`fathom-anuncios: transcripción larga (${tr.largo} caracteres) en la grabación ${id}: se procesa igual`)

    // 4b. Si el bot de kickoff ya decidió que es una kickoff (un reintento, o Fathom la reenvió), ni se llama a Claude
    let kickoff = await consultarKickoff()
    if (kickoff === 'kickoff') return await omitirPorKickoff({})

    // 5–6. La extracción guardada de un intento anterior, o contexto + Claude (y se guarda antes de mandar)
    let resultado = resultadoGuardado(reclamo, forzar)
    const reutilizado = !!resultado
    let modelo = reutilizado ? reclamo?.modelo ?? undefined : undefined
    let usage = reutilizado && reclamo?.tokens_in != null && reclamo.tokens_out != null ? { input_tokens: reclamo.tokens_in, output_tokens: reclamo.tokens_out } : undefined
    let comun: Partial<Marca> = {}
    if (!resultado) {
      const ctx: ContextoCRM = await deps.contexto().catch(e => ({ clientes: [], estado: 'sin_crm' as const, aviso: motivoDe(e) }))
      const ex = await paso('claude', () => {
        const tope = deadline - deps.ahora() - MARGEN_ENVIO_MS
        if (tope < MIN_CLAUDE_MS) throw new ErrorTransitorio(`no queda tiempo para llamar a Claude (${Math.max(0, Math.round(tope / 1000))} s)`)
        return deps.extraer({ reunion: r, transcripcion: tr, clientes: ctx.clientes, alias: deps.alias }, tope)
      })
      const nuevo: ResultadoRegistrado = {
        tipo_reunion: ex.extraccion.tipo_reunion,
        resumen_corto: ex.extraccion.resumen_corto,
        clientes: ex.extraccion.clientes,
        ajustes: ex.ajustes,
        contexto: ctx.estado,
        ...(ctx.aviso ? { aviso_contexto: ctx.aviso } : {}),
        renglones: tr.renglones,
        largo: tr.largo,
      }
      resultado = nuevo
      modelo = ex.modelo
      usage = ex.usage
      comun = { modelo: ex.modelo, version_prompt: VERSION_PROMPT, tokens_in: ex.usage.input_tokens, tokens_out: ex.usage.output_tokens, resultado: nuevo }
      // Si no se puede guardar, no se manda: un reintento sin la extracción ni los clientes anotados duplicaría todo
      if (!dry) await paso('base', () => deps.guardarExtraccion(id, { resultado: nuevo, modelo: ex.modelo, version_prompt: VERSION_PROMPT, tokens_in: ex.usage.input_tokens, tokens_out: ex.usage.output_tokens }))
    }
    const extraccion: Extraccion = { tipo_reunion: resultado.tipo_reunion, resumen_corto: resultado.resumen_corto, clientes: resultado.clientes }
    const conAlgo = extraccion.clientes.filter(tieneAlgo)
    const salida = { recording_id: id, resultado, modelo, usage, reutilizado, ...(reclamo ? { intentos: reclamo.intentos } : {}) }

    // 7. Venta o nada para Valentino
    if (extraccion.tipo_reunion === 'venta' || !conAlgo.length) {
      if (!dry) await paso('base', () => deps.marcar(id, { estado: 'sin_cambios', clientes: 0, cambios: 0, ...comun, duracion_ms: duracion() }))
      return { estado: 'sin_cambios', ...salida, mensajes: [], kickoff }
    }

    // 7b. Kickoff: se vuelve a mirar (el bot de kickoff suele decidir ~1 minuto después del webhook) y, si todavía no
    //     decidió, se espera hasta ESPERA_KICKOFF_MAX_MS desde el arranque. Sin decidir pasado eso, se manda igual.
    if (kickoff !== 'no_kickoff') {
      kickoff = await consultarKickoff()
      const limite = Math.min(t0 + ESPERA_KICKOFF_MAX_MS, deadline - MARGEN_ENVIO_MS - 2 * ESPERA_KICKOFF_PASO_MS)
      while (!dry && kickoff === 'pendiente' && deps.ahora() + ESPERA_KICKOFF_PASO_MS <= limite) {
        await deps.esperar(ESPERA_KICKOFF_PASO_MS)
        kickoff = await consultarKickoff()
      }
      if (kickoff === 'kickoff') return await omitirPorKickoff(comun, salida)
      if (kickoff === 'pendiente' && !dry) console.warn(`fathom-anuncios: grabación ${id}, el bot de kickoff no decidió a tiempo: se manda igual`)
    }

    // 8. Mensajes: de a un cliente; los que ya salieron en un intento anterior no se repiten
    const porCliente = armarMensajes(extraccion, r, deps.valentino)
    const claves = clavesUnicas(extraccion.clientes)
    if (dry) return { estado: 'dry', ...salida, mensajes: porCliente.flatMap(m => m.partes), kickoff }
    const ya = new Set(clientesEnviados)
    const textos: string[] = []
    for (let i = 0; i < porCliente.length; i++) {
      if (ya.has(claves[i])) continue
      if (textos.length) await deps.esperar(PAUSA_ENTRE_CLIENTES_MS)
      const partes = porCliente[i].partes
      let hechas = 0   // dentro de esta invocación, el reintento sigue desde la parte que falló
      await paso('discord', async () => {
        try {
          const nuevos = await deps.enviar(partes.slice(hechas), deadline - RESERVA_ESCRITURAS_MS)
          ids.push(...nuevos)
          hechas += nuevos.length
        } catch (e) {
          const parcial = enviadosDe(e)
          ids.push(...parcial)
          hechas += parcial.length
          throw e
        }
      })
      textos.push(...partes)
      clientesEnviados.push(claves[i])
      ya.add(claves[i])
      // Si no se puede anotar, se corta: seguir mandando sin registro haría que un reintento repita estos clientes
      await paso('base', () => deps.anotarEnviados(id, [...clientesEnviados], [...ids]))
    }

    // 9. Listo. Si falla solo el registro final, los mensajes ya salieron y quedaron anotados: no se avisa
    const cambios = conAlgo.reduce((n, c) => n + c.cambios.length, 0)
    try {
      await paso('base', () => deps.marcar(id, { estado: 'enviado', clientes: conAlgo.length, cambios, mensajes: [...ids], clientes_enviados: [...clientesEnviados], ...comun, duracion_ms: duracion() }))
    } catch (e) {
      console.error(`fathom-anuncios: grabación ${id} enviada pero no se pudo registrar el final —`, motivoDe(e))
    }
    return { estado: 'enviado', ...salida, mensajes: textos, ids: [...ids], kickoff }
  } catch (e) {
    const sinTranscripcion = e instanceof ErrorSinTranscripcion
    const motivo = motivoDe(e)
    console.error(`fathom-anuncios: grabación ${id} con error —`, motivo)
    if (dry) return { estado: 'error', recording_id: id, motivo }
    if (reclamo) {
      try {
        // Sin version_prompt: esa columna acompaña a la extracción guardada (la pone guardarExtraccion), no al error
        await deps.marcar(id, { estado: 'error', error: motivo, mensajes: ids.length ? [...ids] : null, clientes_enviados: [...clientesEnviados], duracion_ms: duracion() })
      } catch (e2) {
        console.error(`fathom-anuncios: no se pudo marcar el error de la grabación ${id} —`, motivoDe(e2))
      }
    }
    try {
      if (!sinTranscripcion) await deps.avisar(textoAviso(r.title, id, motivo, ID_TOMAS, reintentoDe(reclamo, deps.ahora())))
      else if (!reclamo?.error_previo?.startsWith(PREFIJO_SIN_TRANSCRIPCION)) await deps.avisar(textoSinTranscripcion(r.title, id, ID_TOMAS))
    } catch (e3) {
      console.error(`fathom-anuncios: tampoco salió el aviso de la grabación ${id} —`, motivoDe(e3))
    }
    return { estado: 'error', recording_id: id, motivo, ...(ids.length ? { ids: [...ids] } : {}), ...(reclamo ? { intentos: reclamo.intentos } : {}) }
  }
}

// ── Cron diario de reintentos ────────────────────────────────────────────────────────────────
export type EstadoCron = EstadoProceso | 'sin_payload' | 'sin_tiempo'
export interface ResultadoCron { revisadas: number; procesadas: { recording_id: number; estado: EstadoCron; motivo?: string }[] }

function resumenColgada(r: ResultadoProceso): string {
  if (r.estado === 'enviado') return r.mensajes?.length ? `mandé lo que faltaba (${r.mensajes.length} mensaje${r.mensajes.length === 1 ? '' : 's'} para Valentino)` : 'ya estaba todo mandado'
  if (r.estado === 'sin_cambios') return 'no había cambios para Valentino'
  return `quedó omitida (${r.motivo ?? 'sin motivo'})`
}

/**
 * Reprocesa hasta MAX_FILAS_CRON filas en error o colgadas, en serie y dentro del deadline. Las que no tienen payload no
 * se pueden reintentar: se marcan (prefijo sin_payload:) y se avisa a Tomás una vez. Si una colgada termina bien, se le
 * avisa a Tomás que se reintentó (si termina en error, ya sale el aviso de error).
 */
export async function reintentarPendientes(deps: DepsCron, op: { deadline?: number } = {}): Promise<ResultadoCron> {
  const deadline = op.deadline ?? deps.ahora() + PLAZO_MS
  const filas = await deps.pendientes(MAX_FILAS_CRON, TOPE_INTENTOS_CRON, [PREFIJO_SIN_PAYLOAD, PREFIJO_SIN_TRANSCRIPCION, PREFIJO_AGOTADA])
  const procesadas: ResultadoCron['procesadas'] = []
  for (const f of filas) {
    const titulo = f.titulo || `Grabación ${f.recording_id}`
    if (!f.tiene_payload) {
      try {
        const marcada = await deps.marcarSinPayload(f.recording_id, `${PREFIJO_SIN_PAYLOAD} ${f.error ?? `quedó en ${f.estado}`}`.slice(0, 500))
        if (marcada) await deps.avisar(textoSinPayload(titulo, f.recording_id, f.estado === 'procesando' ? 'procesando (se cortó)' : f.estado, ID_TOMAS))
      } catch (e) {
        console.error(`fathom-anuncios: grabación ${f.recording_id} sin payload — no se pudo marcar o avisar:`, motivoDe(e))
      }
      procesadas.push({ recording_id: f.recording_id, estado: 'sin_payload' })
      continue
    }
    if (f.estado === 'procesando' && f.intentos >= TOPE_INTENTOS_CRON) {
      try {
        const cerrada = await deps.marcarAgotada(f.recording_id, `${PREFIJO_AGOTADA} se cortó ${f.intentos} veces en procesando`)
        if (cerrada) await deps.avisar(textoAgotada(titulo, f.recording_id, f.intentos, ID_TOMAS))
      } catch (e) {
        console.error(`fathom-anuncios: no se pudo cerrar o avisar la colgada ${f.recording_id} —`, motivoDe(e))
      }
      procesadas.push({ recording_id: f.recording_id, estado: 'error', motivo: 'agotada' })
      continue
    }
    if (deadline - deps.ahora() < MIN_PARA_OTRA_FILA_MS) {
      procesadas.push({ recording_id: f.recording_id, estado: 'sin_tiempo' })
      continue
    }
    let payload: unknown
    try {
      payload = (await deps.leerPayload(f.recording_id))?.payload ?? null
    } catch (e) {
      procesadas.push({ recording_id: f.recording_id, estado: 'error', motivo: motivoDe(e) })
      continue
    }
    const r = await procesarReunion(payload, deps, { topeIntentos: TOPE_INTENTOS_CRON, deadline })
    procesadas.push({ recording_id: f.recording_id, estado: r.estado, ...(r.motivo ? { motivo: r.motivo } : {}) })
    if (f.estado === 'procesando' && (r.estado === 'enviado' || r.estado === 'sin_cambios' || r.estado === 'omitida')) {
      try {
        await deps.avisar(textoColgadaReintentada(titulo, f.recording_id, resumenColgada(r), ID_TOMAS))
      } catch (e) {
        console.error(`fathom-anuncios: no salió el aviso de la colgada ${f.recording_id} —`, motivoDe(e))
      }
    }
  }
  return { revisadas: filas.length, procesadas }
}
