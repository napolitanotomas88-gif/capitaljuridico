// ── Bot "Capital Jurídico": etapa ÉXITO — dependencias REALES (Neon, Whapi, Claude, Discord, CRM y planilla del Typeform) ────
// El único lugar que decide qué es real. La lógica está en nucleo.ts; acá se arma según el modo (config.ts):
//   · seco: ni Claude, ni Whapi (ni siquiera GET), ni planillas, ni escrituras. Solo el registro de lo que haría.
//   · ensayo: lecturas reales; lo único que puede salir es el reporte SIMULACIÓN en Verificaciones (nucleo.ts lo decide por
//     capacidad).
//   · real: por capacidad.
// La ruta del webhook (lib/bot/whapi/ruta.ts) llama a procesarExitoReal en after(); el cron (/api/bot/exito) a correrDiarioReal.
// El log lleva conteos y nombres de variables: nunca textos, teléfonos ni secretos. Solo servidor.
import { neon } from '@neondatabase/serverless'
import { BASE_WHAPI } from '@/lib/bot/whapi/comun'
import { tokenWhapi } from '@/lib/bot/whapi/config'
import { crearClienteWhapi } from '@/lib/bot/whapi/cliente'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { almacenExitoNeon } from './almacenNeon'
import type { AlmacenExito } from './almacen'
import { clasificarConClaude } from './claude'
import { capacidadesExitoDesconocidas, configExito, exitoApagado, hayLecturas, type ConfigExito } from './config'
import { CONSULTA_MOTOR, crearDirectorio, type Directorio } from './directorio'
import { sinCandidatos, type CandidatosExito } from './filtro'
import { respuestasDeFilas } from './rondas'
import { crearNucleo, type ClienteActivo, type DepsExito, type LectoresDiario, type RegistroLogExito, type ResumenExito } from './nucleo'

export const TOPE_WHAPI_LECTURA_MS = 8_000
/** Gero M (ggeroo), el mismo id por defecto que lib/edicion/avisos/entorno.ts (copiado para no traer sus dependencias). */
export const ID_GERO_M_POR_DEFECTO = ''
const MAX_PAGINAS_GRUPOS = 10

async function whapiGet(token: string, ruta: string, f: typeof fetch = fetch): Promise<{ status: number; json: unknown }> {
  const res = await f(`${BASE_WHAPI}${ruta}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(TOPE_WHAPI_LECTURA_MS), cache: 'no-store' })
  if (!res.ok) { await res.body?.cancel().catch(() => {}); return { status: res.status, json: null } }
  return { status: res.status, json: await res.json().catch(() => null) }
}

const nombreDe = (j: unknown): string | null => {
  const o = j as { name?: unknown; subject?: unknown } | null
  return typeof o?.name === 'string' ? o.name : typeof o?.subject === 'string' ? o.subject : null
}

// Un directorio por instancia (sus cachés las comparten las invocaciones)
let DIRECTORIO: { clave: string; d: Directorio } | null = null
export function olvidarDirectorioExito() { DIRECTORIO = null }

export function directorioReal(env: NodeJS.ProcessEnv, conWhapi: boolean, f: typeof fetch = fetch): Directorio {
  const token = tokenWhapi(env)
  const clave = `${conWhapi && !!token}`
  if (DIRECTORIO && DIRECTORIO.clave === clave) return DIRECTORIO.d
  const db = env.DATABASE_URL?.trim()
  const d = crearDirectorio({
    conWhapi: conWhapi && !!token,
    async filasMotor() {
      if (!db) return []
      try {
        return (await neon(db, { fetchOptions: { signal: AbortSignal.timeout(10_000) } }).query(CONSULTA_MOTOR)) as Record<string, unknown>[]
      } catch (e) {
        if ((e as { code?: string })?.code === '42P01') return []
        throw e
      }
    },
    async nombreGrupo(chatId) {
      if (!token) return null
      const r = await whapiGet(token, `/groups/${encodeURIComponent(chatId)}`, f)
      if (r.status === 404) return null
      if (r.status >= 400) throw new Error(`Whapi respondió ${r.status}`)
      return nombreDe(r.json)
    },
    async listarGrupos() {
      if (!token) return []
      const out: { id: string; nombre: string }[] = []
      for (let i = 0; i < MAX_PAGINAS_GRUPOS; i++) {
        const r = await whapiGet(token, `/groups?count=100&offset=${i * 100}`, f)
        if (r.status >= 400) throw new Error(`Whapi respondió ${r.status}`)
        const grupos = ((r.json as { groups?: unknown[] } | null)?.groups ?? []) as Record<string, unknown>[]
        for (const g of grupos) { const n = nombreDe(g); if (typeof g.id === 'string' && n) out.push({ id: g.id, nombre: n }) }
        const total = Number((r.json as { total?: unknown } | null)?.total)
        if (grupos.length < 100 || (Number.isFinite(total) && out.length >= total)) break
      }
      return out
    },
  })
  DIRECTORIO = { clave, d }
  return d
}

export interface OpcionesExitoReal { env?: NodeJS.ProcessEnv; log?: RegistroLogExito; fetch?: typeof fetch; almacen?: AlmacenExito; config?: ConfigExito; ahora?: () => number; esperar?: (ms: number) => Promise<void> }

export function depsExitoReales(op: OpcionesExitoReal = {}): DepsExito {
  const env = op.env ?? process.env
  const config = op.config ?? configExito(env)
  const lecturas = hayLecturas(config.modo)
  const token = tokenWhapi(env)
  const webhook = env.DISCORD_WEBHOOK_CLIENTES?.trim() ?? ''
  let cliente: ReturnType<typeof crearClienteWhapi> | null = null
  return {
    config,
    clienteOperativo,
    almacen: op.almacen ?? almacenExitoNeon(),
    directorio: directorioReal(env, lecturas, op.fetch),
    async enviarTexto(p) {
      if (config.modo === 'seco') throw new Error('modo seco: no sale nada')
      if (!token) throw Object.assign(new Error('falta WHAPI_TOKEN'), { aplicado: false })
      cliente ??= crearClienteWhapi({ token, fetch: op.fetch })
      const r = await cliente.enviarTexto({ chatId: p.chatId, texto: p.texto, citar: p.citar ?? null })
      return { id: r.id }
    },
    clasificar: lecturas ? (t) => clasificarConClaude(t) : undefined,
    discord: webhook ? async (texto, menciones) => (await enviarDiscord(webhook, [texto], menciones, { fetch: op.fetch }))[0] ?? null : undefined,
    mencionGeroM: idDiscord(env.DISCORD_ID_GERO_M) ?? ID_GERO_M_POR_DEFECTO,
    ahora: op.ahora ?? Date.now,
    esperar: op.esperar ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    log: op.log ?? console,
  }
}

const lineaResumen = (r: ResumenExito) =>
  `modo ${r.modo}: ${r.detectados} éxito(s), ${r.pedidos} pedido(s), ${r.aprobados} OK, ${r.rechazados} NO, ${r.testimonios} testimonio(s), ${r.encuestas} encuesta(s), ${r.recordatorios} recordatorio(s), ${r.vencidos} vencido(s), ${r.errores.length} error(es)`

let avisoFalta = ''

/** Lo que llama la ruta del webhook en after(). Nunca tira. null = no hizo nada (apagado, sin candidatos o sin base). */
export async function procesarExitoReal(cands: CandidatosExito, op: OpcionesExitoReal = {}): Promise<ResumenExito | null> {
  const env = op.env ?? process.env
  const log = op.log ?? console
  if (exitoApagado(env) || sinCandidatos(cands)) return null
  if (configExito(env).modo === 'seco' && !op.config) return null   // en seco no hay nada que hacer: ni lecturas ni escrituras
  if (!env.DATABASE_URL?.trim() && !op.almacen) {
    if (avisoFalta !== 'DATABASE_URL') { avisoFalta = 'DATABASE_URL'; log.warn('bot-exito: sin DATABASE_URL — la etapa Éxito no procesa nada') }
    return null
  }
  if (capacidadesExitoDesconocidas(env).length) log.warn(`bot-exito: BOT_EXITO_CAPACIDADES trae ${capacidadesExitoDesconocidas(env).length} nombre(s) que no son capacidades: se ignoran`)
  try {
    const r = await crearNucleo(depsExitoReales(op)).procesarEventos(cands)
    if (r.detectados || r.pedidos || r.aprobados || r.rechazados || r.testimonios || r.errores.length) log.info(`bot-exito: ${lineaResumen(r)}`)
    for (const e of r.errores.slice(0, 5)) log.warn(`bot-exito: ${e.replace(/\d{8,}/g, '[número]').slice(0, 200)}`)
    return r
  } catch (e) {
    log.error(`bot-exito: falló el proceso (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    return null
  }
}

export type ProcesarExito = typeof procesarExitoReal

/** Lectores del cron: CRM (Agencia ACTIVO con ID) y la planilla del Typeform (cruce de lib/seguimiento/typeform.ts). */
export function lectoresReales(): LectoresDiario {
  return {
    async clientesActivos(): Promise<ClienteActivo[]> {
      const { leerClientes } = await import('@/lib/clientes/leer')
      const datos = await leerClientes()
      return datos.clientes.filter((k) => k.linea === 'agencia' && k.estado === 'ACTIVO' && k.id).map((k) => ({ id: k.id, nombre: k.nombre, mail: k.mail, celular: k.celular }))
    },
    async respuestasTypeform(clientes) {
      // La misma planilla que la cartera (SHEET_ID_TYPEFORM, solo lectura), pero con la HORA de cada respuesta: las rondas
      // se comparan con el instante del envío (rondas.ts)
      const id = process.env.SHEET_ID_TYPEFORM?.trim()
      const { googleConfigurado, googleJson, sheetsBase } = await import('@/lib/auth/googleRest')
      if (!id || !googleConfigurado()) return null
      const r = await googleJson<{ values?: unknown[][] }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent('A1:Z5000')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)
      return respuestasDeFilas(r.values ?? [], clientes)
    },
  }
}

/** Almacén que no escribe nada (para ?dry=1): las lecturas son las reales, las escrituras se aceptan y no se guardan. */
export function almacenSoloLectura(b: AlmacenExito): AlmacenExito {
  return {
    ...b,
    reclamarSenal: async () => true, marcarSenal: async () => {}, crearPedido: async () => true, actualizarPedido: async () => true,
    reclamarTestimonio: async () => true, guardarTestimonio: async () => {}, actualizarTestimonio: async () => {},
    reclamarEncuesta: async () => true, actualizarEncuesta: async () => {}, vincularRespuesta: async () => true, crearLote: async () => true, actualizarLote: async () => true,
  }
}

/** El cron diario. `dry`: lee todo y devuelve lo que haría, sin mandar ni escribir nada. */
export async function correrDiarioReal(op: OpcionesExitoReal & { dry?: boolean; forzarLista?: boolean; lectores?: LectoresDiario } = {}): Promise<ResumenExito> {
  const env = op.env ?? process.env
  const base = op.config ?? configExito(env)
  const config: ConfigExito = op.dry ? { ...base, modo: base.modo === 'seco' ? 'seco' : 'ensayo', capacidades: new Set() } : base
  const almacen = op.almacen ?? almacenExitoNeon()
  const deps = depsExitoReales({ ...op, config, almacen: op.dry ? almacenSoloLectura(almacen) : almacen })
  const r = await crearNucleo(deps).correrDiario(op.lectores ?? lectoresReales(), { forzarLista: op.forzarLista })
  if (!op.dry) (op.log ?? console).info(`bot-exito: diario — ${lineaResumen(r)}`)
  return r
}
