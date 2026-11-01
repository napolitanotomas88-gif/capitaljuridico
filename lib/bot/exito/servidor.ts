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
import { clientesPrueba, esClientePrueba } from '@/lib/bot/clientesPrueba'
import { registradorRastros, type RegistrarRastro } from '@/lib/bot/rastrosPrueba'
import { almacenExitoNeon } from './almacenNeon'
import type { AlmacenExito } from './almacen'
import { clasificarConClaude } from './claude'
import { capacidadesExitoDesconocidas, configExito, configPruebaExito, exitoApagado, hayLecturas, type ConfigExito } from './config'
import { CONSULTA_MOTOR, crearDirectorio, normNombre, type Directorio, type FichaCliente } from './directorio'
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

export interface ClientePrueba { id: string; nombre: string }
export interface OpcionesExitoReal {
  env?: NodeJS.ProcessEnv; log?: RegistroLogExito; fetch?: typeof fetch; almacen?: AlmacenExito; config?: ConfigExito; ahora?: () => number; esperar?: (ms: number) => Promise<void>
  /** Registro de rastros de la corrida de prueba (por defecto, Neon: cj_prueba_rastros). */
  rastros?: RegistrarRastro
  /** Nombres en el CRM de los clientes de prueba (por defecto, leerClientes con caché). Para reconocer sus grupos por nombre. */
  nombresPrueba?: () => Promise<ClientePrueba[]>
  /** Directorio (tests). */
  directorio?: Directorio
  /** Cliente de Discord / Whapi falsos (tests). */
  enviarTexto?: DepsExito['enviarTexto']; discord?: DepsExito['discord']; clasificar?: DepsExito['clasificar']; clienteOperativo?: DepsExito['clienteOperativo']
}

// Nombres de los clientes de prueba en el CRM (10 min de caché por instancia; si el CRM falla, lista vacía: solo cuenta el ID)
let NOMBRES_PRUEBA: { clave: string; hasta: number; lista: ClientePrueba[] } | null = null
async function nombresPruebaReales(ids: ReadonlySet<string>): Promise<ClientePrueba[]> {
  const clave = [...ids].sort().join(',')
  if (NOMBRES_PRUEBA && NOMBRES_PRUEBA.clave === clave && Date.now() < NOMBRES_PRUEBA.hasta) return NOMBRES_PRUEBA.lista
  try {
    const { leerClientes } = await import('@/lib/clientes/leer')
    const lista = (await leerClientes()).clientes.filter((k) => ids.has(String(k.id ?? '').toUpperCase())).map((k) => ({ id: String(k.id).toUpperCase(), nombre: k.nombre }))
    NOMBRES_PRUEBA = { clave, hasta: Date.now() + 10 * 60_000, lista }
    return lista
  } catch {
    return []
  }
}

/** Directorio que reconoce los grupos de un cliente de prueba armados a mano ("General - <su nombre en el CRM>") y les pone
 *  su ID del CRM. Así los dos núcleos lo separan bien (el general lo ignora; el de prueba lo atiende). */
export function directorioConPrueba(dir: Directorio, pruebas: () => Promise<ClientePrueba[]>): Directorio {
  const enriquecer = async (f: FichaCliente): Promise<FichaCliente> => {
    if (f.idCrm) return f
    const p = (await pruebas()).find((x) => normNombre(x.nombre) === normNombre(f.cliente))
    return p ? { ...f, idCrm: p.id, clave: p.id } : f
  }
  return {
    async deChat(chatId) { const e = await dir.deChat(chatId); return e ? { ...e, ficha: await enriquecer(e.ficha) } : null },
    async todas() { return Promise.all((await dir.todas()).map(enriquecer)) },
  }
}

type Ambito = NonNullable<DepsExito['ambito']>

export function depsExitoReales(op: OpcionesExitoReal = {}, ambito?: Ambito): DepsExito {
  const env = op.env ?? process.env
  const config = op.config ?? configExito(env)
  const lecturas = hayLecturas(config.modo)
  const token = tokenWhapi(env)
  const webhook = env.DISCORD_WEBHOOK_CLIENTES?.trim() ?? ''
  const ids = clientesPrueba(env)
  let cliente: ReturnType<typeof crearClienteWhapi> | null = null
  const base = op.directorio ?? directorioReal(env, lecturas, op.fetch)
  const deps: DepsExito = {
    config,
    ambito,
    clienteOperativo: op.clienteOperativo ?? clienteOperativo,
    almacen: op.almacen ?? almacenExitoNeon(),
    directorio: ids.size ? directorioConPrueba(base, op.nombresPrueba ?? (() => nombresPruebaReales(ids))) : base,
    enviarTexto: op.enviarTexto ?? (async (p) => {
      if (config.modo === 'seco') throw new Error('modo seco: no sale nada')
      if (!token) throw Object.assign(new Error('falta WHAPI_TOKEN'), { aplicado: false })
      cliente ??= crearClienteWhapi({ token, fetch: op.fetch })
      const r = await cliente.enviarTexto({ chatId: p.chatId, texto: p.texto, citar: p.citar ?? null })
      return { id: r.id }
    }),
    clasificar: op.clasificar ?? (lecturas ? (t) => clasificarConClaude(t) : undefined),
    discord: op.discord ?? (webhook ? async (texto, menciones) => (await enviarDiscord(webhook, [texto], menciones, { fetch: op.fetch }))[0] ?? null : undefined),
    mencionGeroM: idDiscord(env.DISCORD_ID_GERO_M) ?? ID_GERO_M_POR_DEFECTO,
    ahora: op.ahora ?? Date.now,
    esperar: op.esperar ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    log: op.log ?? console,
  }
  if (ambito?.tipo === 'prueba') conRastros(deps, op.rastros ?? registradorRastros(env, op.log ?? console), [...ids].sort().join(','))
  if (config.prueba) {
    const h = Number(env.EXITO_RECORDATORIO_HORAS_PRUEBA)
    if (Number.isInteger(h) && h >= 0 && h <= 72) deps.recordatorioMs = h * 3600_000
  }
  return deps
}

/** Corrida de PRUEBA: cada mensaje que sale (WhatsApp o Discord) deja su rastro para poder borrarlo después
 *  (scripts/limpiar-cliente-prueba-exito.mjs). Uno dudoso (pudo haber salido, sin id) también queda anotado. */
function conRastros(deps: DepsExito, registrar: RegistrarRastro, idCrm: string): void {
  const enviar = deps.enviarTexto
  deps.enviarTexto = async (p) => {
    try {
      const r = await enviar(p)
      await registrar({ etapa: 'exito', idCrm, tipo: 'whatsapp', destino: p.chatId, ref: r.id, detalle: { equipo: p.chatId === deps.config.verificaciones } })
      return r
    } catch (e) {
      const ap = (e as { aplicado?: boolean | null })?.aplicado
      if (ap !== false) await registrar({ etapa: 'exito', idCrm, tipo: 'whatsapp', destino: p.chatId, ref: null, detalle: { dudoso: true } })
      throw e
    }
  }
  const discord = deps.discord
  if (discord) deps.discord = async (texto, menciones) => {
    const id = await discord(texto, menciones)
    await registrar({ etapa: 'exito', idCrm, tipo: 'discord', destino: 'DISCORD_WEBHOOK_CLIENTES', ref: id })
    return id
  }
}

/** Los núcleos que corren: el general (si no está en seco) y, con BOT_CLIENTES_PRUEBA, el de prueba (real, solo esos). */
function corridas(op: OpcionesExitoReal, env: NodeJS.ProcessEnv, cfgGeneral: ConfigExito, cfgPrueba: ConfigExito | null, almacen: AlmacenExito | undefined): DepsExito[] {
  const ids = clientesPrueba(env)
  const esPrueba = (id: string | null) => esClientePrueba(id, ids)
  const out: DepsExito[] = []
  if (cfgGeneral.modo !== 'seco') out.push(depsExitoReales({ ...op, config: cfgGeneral, almacen }, ids.size ? { tipo: 'general', esPrueba } : undefined))
  if (ids.size && cfgPrueba) out.push(depsExitoReales({ ...op, config: cfgPrueba, almacen }, { tipo: 'prueba', esPrueba }))
  return out
}

/** Suma dos resúmenes; lo de la prueba se marca en el registro y los errores. */
export function sumarResumenes(a: ResumenExito | null, b: ResumenExito, etiqueta: string): ResumenExito {
  const marca = (x: string) => (etiqueta ? `[${etiqueta}] ${x}` : x)
  const bb = { ...b, registro: b.registro.map(marca), errores: b.errores.map(marca) }
  if (!a) return { ...bb, modo: etiqueta ? `${b.modo === 'real' ? 'seco' : b.modo} + prueba` : b.modo }
  const n = (k: keyof ResumenExito) => (a[k] as number) + (bb[k] as number)
  return {
    modo: etiqueta ? `${a.modo} + prueba` : a.modo,
    detectados: n('detectados'), pedidos: n('pedidos'), aprobados: n('aprobados'), rechazados: n('rechazados'), testimonios: n('testimonios'), ecos: n('ecos'),
    encuestas: n('encuestas'), recordatorios: n('recordatorios'), vencidos: n('vencidos'), ignorados: n('ignorados'),
    errores: [...a.errores, ...bb.errores], registro: [...a.registro, ...bb.registro],
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
  // En seco y sin clientes de prueba no hay nada que hacer: ni lecturas ni escrituras
  if (configExito(env).modo === 'seco' && !op.config && !clientesPrueba(env).size) return null
  if (!env.DATABASE_URL?.trim() && !op.almacen) {
    if (avisoFalta !== 'DATABASE_URL') { avisoFalta = 'DATABASE_URL'; log.warn('bot-exito: sin DATABASE_URL — la etapa Éxito no procesa nada') }
    return null
  }
  if (capacidadesExitoDesconocidas(env).length) log.warn(`bot-exito: BOT_EXITO_CAPACIDADES trae ${capacidadesExitoDesconocidas(env).length} nombre(s) que no son capacidades: se ignoran`)
  try {
    const lista = op.config ? [depsExitoReales(op)] : corridas(op, env, configExito(env), configPruebaExito(env), op.almacen)
    let r: ResumenExito | null = null
    for (const deps of lista) r = sumarResumenes(r, await crearNucleo(deps).procesarEventos(cands), deps.ambito?.tipo === 'prueba' ? 'prueba' : '')
    if (!r) return null
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
export async function correrDiarioReal(op: OpcionesExitoReal & { dry?: boolean; forzarLista?: boolean | 'prueba'; lectores?: LectoresDiario } = {}): Promise<ResumenExito> {
  const env = op.env ?? process.env
  const seca = (c: ConfigExito): ConfigExito => (op.dry ? { ...c, modo: c.modo === 'seco' ? 'seco' : 'ensayo', capacidades: new Set() } : c)
  const base = op.config ?? configExito(env)
  const almacen0 = op.almacen ?? almacenExitoNeon()
  const almacen = op.dry ? almacenSoloLectura(almacen0) : almacen0
  const lectores = op.lectores ?? lectoresReales()
  const ids = clientesPrueba(env)
  const esPrueba = (id: string | null) => esClientePrueba(id, ids)
  // El general corre siempre (en seco vuelve enseguida); el de prueba, solo con BOT_CLIENTES_PRUEBA
  const lista: DepsExito[] = [depsExitoReales({ ...op, config: seca(base), almacen }, ids.size && !op.config ? { tipo: 'general', esPrueba } : undefined)]
  if (ids.size && !op.config) lista.push(depsExitoReales({ ...op, config: seca(configPruebaExito(env)), almacen }, { tipo: 'prueba', esPrueba }))
  let r: ResumenExito | null = null
  for (const deps of lista) {
    const prueba = deps.ambito?.tipo === 'prueba'
    const forzar = prueba ? op.forzarLista === 'prueba' : op.forzarLista === true
    r = sumarResumenes(r, await crearNucleo(deps).correrDiario(lectores, { forzarLista: forzar }), prueba ? 'prueba' : '')
  }
  if (!op.dry) (op.log ?? console).info(`bot-exito: diario — ${lineaResumen(r!)}`)
  return r!
}
