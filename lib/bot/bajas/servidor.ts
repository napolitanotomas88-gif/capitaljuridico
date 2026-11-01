// ── Bot "Capital Jurídico": etapa BAJA — dependencias REALES (Neon, Whapi, Claude, Discord, CRM, Typeform y Fathom) ────────
// El único lugar que decide qué es real. La lógica está en nucleo.ts; acá se arma según el modo (config.ts):
//   · seco: ni Claude, ni Whapi (ni siquiera GET), ni Fathom, ni planillas, ni escrituras. Solo el registro de lo que haría.
//   · ensayo: lecturas reales; lo único que puede salir es el reporte SIMULACIÓN en Verificaciones (nucleo.ts lo decide).
//   · real: por capacidad. DELETE de participantes solo con baja_quitar_grupos; el CRM solo con baja_crm.
// Quién lo llama: el webhook de Whapi (lib/bot/whapi/ruta.ts, en after()) → procesarBajasReal; el webhook de Fathom de
// /api/bot/kickoff (en after()) → procesarLlamadaBajasReal; /api/bot/bajas (cron y manual) → correrDiarioBajasReal,
// pedirBajaManualReal y procesarGrabacionBajasReal. El log lleva conteos y nombres de variables: nunca textos, teléfonos ni
// secretos. Solo servidor.
import { neon } from '@neondatabase/serverless'
import { BASE_WHAPI } from '@/lib/bot/whapi/comun'
import { tokenWhapi } from '@/lib/bot/whapi/config'
import { crearClienteWhapi } from '@/lib/bot/whapi/cliente'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { personasDelEquipo } from '@/lib/bot/whapi/guiones'
import { enviarDiscord, idDiscord } from '@/lib/fathomAnuncios/discord'
import { validarReunion, type ReunionFathom } from '@/lib/fathomAnuncios/tipos'
import type { AlmacenBajas } from './almacen'
import { almacenBajasNeon } from './almacenNeon'
import { clasificarLlamadaConClaude } from './claude'
import { PLAZO_BAJAS_MS, bajasApagado, capacidadesBajasDesconocidas, configBajas, configPruebaBajas, hayLecturas, listaPersonas, prendida, type ConfigBajas } from './config'
import { clienteDePrueba, esClientePrueba, nombreDePrueba } from './prueba'
import { normNombre } from './fin'
import type { DirectorioGrupos } from './grupos'

export { PLAZO_BAJAS_MS }
import { marcarBajaCrm, nombreCalza } from './crm'
import { crearMetaBajas, type CuentaCliente, type MetaBajas } from './meta'
import type { CandidatosBajas } from './filtro'
import { sinCandidatosBajas } from './filtro'
import type { ClienteBaja } from './fin'
import { CONSULTA_MOTOR_BAJAS, crearDirectorioGrupos } from './grupos'
import { crearNucleoBajas, type DepsBajas, type RegistroLogBajas, type ResumenBajas } from './nucleo'

export const TOPE_WHAPI_LECTURA_MS = 8_000
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

/** Clientes del CRM (lib/clientes/leer.ts) → lo mínimo que usa la etapa. */
export async function leerClientesReal(): Promise<ClienteBaja[]> {
  const { leerClientes } = await import('@/lib/clientes/leer')
  const datos = await leerClientes()
  return datos.clientes.map((k) => ({
    id: k.id, nombre: k.nombre, estado: k.estado, linea: k.linea, mail: k.mail, celular: k.celular, dia1: k.dia1, finPeriodo: k.finPeriodo,
    periodos: k.periodos.map((p) => ({ fin: p.fin, meses: p.meses, periodo: p.periodo })), fechaBaja: k.fechaBaja, satisfaccion: k.satisfaccion, esNoCliente: k.esNoCliente,
  }))
}

/** Último puntaje del Typeform por ID (la misma planilla y el mismo cruce que la cartera: lib/seguimiento/typeform.ts). */
async function puntajesTypeform(clientes: ClienteBaja[]): Promise<Map<string, number>> {
  const id = process.env.SHEET_ID_TYPEFORM?.trim()
  const { googleConfigurado, googleJson, sheetsBase } = await import('@/lib/auth/googleRest')
  if (!id || !googleConfigurado()) return new Map()
  const { leerRespuestas } = await import('@/lib/seguimiento/typeform')
  const r = await googleJson<{ values?: unknown[][] }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent('A1:Z5000')}`)
  const res = leerRespuestas(r.values ?? [], clientes.filter((k) => k.id).map((k) => ({ id: k.id, nombre: k.nombre, mail: k.mail, celular: k.celular })))
  const m = new Map<string, { fecha: string; valor: number }>()
  for (const p of res.puntajes) {
    const k = p.idCliente.toUpperCase()
    const prev = m.get(k)
    if (!prev || p.fecha >= prev.fecha) m.set(k, { fecha: p.fecha, valor: p.valor })
  }
  return new Map([...m].map(([k, v]) => [k, v.valor]))
}

/** Las cuentas de Meta del cliente: el MISMO cruce del tablero (helpers de LECTURA de lib/anuncios, sin tocarlos). */
export async function cuentasMetaDelCliente(cliente: string): Promise<CuentaCliente[]> {
  const [{ leerSheets }, { descubrirCuentas }, { crearCruce }] = await Promise.all([import('@/lib/anuncios/sheets'), import('@/lib/anuncios/meta'), import('@/lib/anuncios/cruce')])
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const [s, d] = await Promise.all([leerSheets(hoy), descubrirCuentas()])
  const cruce = crearCruce(s)
  return d.cuentas.filter((c) => {
    const r = cruce.resolverCliente({ id: c.id, nombre: c.nombre, negocio: c.negocio?.nombre ?? null })
    return !!r.cliente && nombreCalza(r.cliente.nombre, cliente)
  }).map((c) => ({ id: c.id, nombre: c.nombre }))
}

export interface OpcionesBajasReal {
  env?: NodeJS.ProcessEnv; log?: RegistroLogBajas; fetch?: typeof fetch; almacen?: AlmacenBajas; config?: ConfigBajas
  ahora?: () => number; esperar?: (ms: number) => Promise<void>; leerClientes?: () => Promise<ClienteBaja[]>; dry?: boolean
  /** Márgenes del deadline de i02 (solo tests). */
  margenes?: { inicio: number; envio: number }
  /** Ronda 2 (tests): Meta de juguete. */
  meta?: MetaBajas
}

/** Almacén que no escribe nada (para ?dry=1): lee lo real, acepta las escrituras sin guardarlas. */
export function almacenSoloLectura(b: AlmacenBajas): AlmacenBajas {
  return {
    ...b,
    crearPedido: async () => true, actualizarPedido: async () => true, crearBaja: async () => true, marcarPaso: async () => {},
    reclamarLlamada: async () => true, actualizarLlamada: async () => {}, reclamarRecontacto: async () => true, actualizarRecontacto: async () => {},
  }
}

/** Modo prueba: los grupos solo se aceptan si son del MISMO cliente (por ID del motor o nombre idéntico), nunca "parecidos". */
export function directorioSoloPrueba(base: DirectorioGrupos): DirectorioGrupos {
  return {
    async deCliente(id, nombre) {
      const f = await base.deCliente(id, nombre)
      if (!f) return null
      return (f.idCrm && f.idCrm === id.toUpperCase()) || normNombre(f.cliente) === normNombre(nombre) ? f : null
    },
  }
}

const PREFIJO_DISCORD_PRUEBA = '🧪 PRUEBA (cliente ficticio, no hay que hacer nada) — '

export function depsBajasReales(op: OpcionesBajasReal = {}): DepsBajas {
  const env = op.env ?? process.env
  const config = op.config ?? configBajas(env)
  const prueba = !!config.prueba
  const listaPrueba = config.clientesPrueba ?? []
  const lecturas = hayLecturas(config.modo)
  const token = tokenWhapi(env)
  const conWhapi = lecturas && !!token
  const webhook = env.DISCORD_WEBHOOK_CLIENTES?.trim() ?? ''
  const db = env.DATABASE_URL?.trim()
  let cliente: ReturnType<typeof crearClienteWhapi> | null = null
  const whapi = () => (cliente ??= crearClienteWhapi({ token: token!, fetch: op.fetch }))
  const equipo = new Set([...personasDelEquipo(env), ...listaPersonas(env.BAJA_EXCLUIR_TELEFONOS)])
  const almacenBase = op.almacen ?? almacenBajasNeon()
  // Alcance: el núcleo de prueba atiende SOLO a los clientes de BOT_CLIENTES_PRUEBA con fila "PRUEBA BOT…"; el general, a todos
  // menos los de la lista (así nunca se atiende dos veces ni se cruza un cliente real con el modo prueba)
  const alcance = (idCrm: string) => (prueba ? esClientePrueba(idCrm, listaPrueba) : !esClientePrueba(idCrm, listaPrueba))
  const leerBase = op.leerClientes ?? leerClientesReal
  const leer = async (): Promise<ClienteBaja[]> => {
    const todos = await leerBase()
    if (!prueba) return listaPrueba.length ? todos.filter((k) => !esClientePrueba(k.id, listaPrueba)) : todos
    const enLista = todos.filter((k) => esClientePrueba(k.id, listaPrueba))
    const raros = enLista.filter((k) => !nombreDePrueba(k.nombre)).length
    if (raros) (op.log ?? console).warn(`bot-bajas: BOT_CLIENTES_PRUEBA trae ${raros} ID(s) cuya fila no es "PRUEBA BOT…": se ignoran`)
    return enLista.filter((k) => clienteDePrueba(k, listaPrueba))
  }
  const discordBase = webhook ? async (textos: string[], menciones: string[]) => (op.dry ? null : (await enviarDiscord(webhook, textos, menciones, { fetch: op.fetch }))[0] ?? null) : undefined
  const directorio = crearDirectorioGrupos({
      conWhapi,
      async filasMotor() {
        if (!db || !lecturas) return []
        try { return (await neon(db, { fetchOptions: { signal: AbortSignal.timeout(10_000) } }).query(CONSULTA_MOTOR_BAJAS)) as Record<string, unknown>[] } catch (e) {
          if ((e as { code?: string })?.code === '42P01') return []
          throw e
        }
      },
      async listarGrupos() {
        if (!token) return []
        const out: { id: string; nombre: string }[] = []
        for (let i = 0; i < MAX_PAGINAS_GRUPOS; i++) {
          const r = await whapiGet(token, `/groups?count=100&offset=${i * 100}`, op.fetch)
          if (r.status >= 400) throw new Error(`Whapi respondió ${r.status}`)
          const grupos = ((r.json as { groups?: unknown[] } | null)?.groups ?? []) as Record<string, unknown>[]
          for (const g of grupos) { const n = nombreDe(g); if (typeof g.id === 'string' && n) out.push({ id: g.id, nombre: n }) }
          if (grupos.length < 100) break
        }
        return out
      },
    })
  return {
    config,
    clienteOperativo,
    alcance,
    almacen: op.dry ? almacenSoloLectura(almacenBase) : almacenBase,
    grupos: prueba ? directorioSoloPrueba(directorio) : directorio,
    async enviarTexto(p) {
      if (op.dry) return { id: null }   // ?dry=1: no sale nada
      if (config.modo === 'seco') throw new Error('modo seco: no sale nada')
      if (!token) throw Object.assign(new Error('falta WHAPI_TOKEN'), { aplicado: false })
      const r = await whapi().enviarTexto({ chatId: p.chatId, texto: p.texto, citar: p.citar ?? null })
      return { id: r.id }
    },
    participantes: conWhapi ? (chatId) => whapi().participantesGrupo(chatId) : undefined,
    quitar: conWhapi && !op.dry && config.modo === 'real' && config.capacidades.has('baja_quitar_grupos') ? (chatId, ids) => whapi().quitarParticipantes({ grupoId: chatId, participantes: ids }) : undefined,
    clasificar: prendida('baja_fathom', config.modo, config.capacidades) ? (p) => clasificarLlamadaConClaude(p, { topeMs: p.topeMs }) : undefined,
    // En prueba, el aviso de Discord lleva un prefijo claro y no menciona a nadie
    discord: discordBase && prueba ? (textos) => discordBase(textos.map((t, i) => (i === 0 ? `${PREFIJO_DISCORD_PRUEBA}${t}` : t)), []) : discordBase,
    crm: lecturas ? async (p, modo) => {
      const { planillaCrmReal } = await import('@/lib/bot/alta/crmEscribir')
      // En modo prueba el CRM SOLO escribe filas "PRUEBA BOT…", sin importar BAJA_CRM_SOLO_PRUEBA
      const r = await marcarBajaCrm(planillaCrmReal(), p, { modo: op.dry ? 'simulacion' : modo, soloPrueba: prueba || /^(si|sí|1|true)$/i.test(env.BAJA_CRM_SOLO_PRUEBA?.trim() ?? '') })
      if (r.estado === 'hecho') { const { invalidarSnapshot } = await import('@/lib/clientes/snapshot'); invalidarSnapshot() }
      return r
    } : undefined,
    // Ronda 2. Meta: solo con la capacidad (en ensayo, solo lectura). Token: META_ANUNCIOS_TOKEN (Gero A, ve las cuentas de los
    // clientes); el usuario del sistema de META_ADS_WRITE_TOKEN no las ve. En dry, la pausa no sale
    meta: prueba ? undefined : op.meta ?? (prendida('baja_pausar_meta', config.modo, config.capacidades) ? (() => {
      const m = crearMetaBajas({ token: env.META_ANUNCIOS_TOKEN?.trim() || null, cuentasDelCliente: cuentasMetaDelCliente, fetch: op.fetch })
      return op.dry ? { ...m, pausar: async (ids: string[]) => ({ pausadas: [], fallidas: ids.map((id) => ({ id, motivo: 'dry: no se pausó' })), tokenCaido: false }) } : m
    })() : undefined),
    quitarAccesoDrive: !op.dry && config.modo === 'real' && config.capacidades.has('baja_quitar_drive') ? async (carpetaId, correos) => {
      const { puenteDriveReal } = await import('@/lib/bot/alta/puenteDrive')
      const puente = puenteDriveReal({ hasta: Date.now() + 60_000 })
      if (!puente.quitarAccesoCliente) throw new Error('el cliente del puente no tiene quitarAccesoCliente')
      return puente.quitarAccesoCliente({ carpetaId, correos })
    } : undefined,
    eliminarComunidad: conWhapi && !op.dry && config.modo === 'real' && config.capacidades.has('baja_eliminar_comunidad') ? (id) => whapi().eliminarComunidad(id) : undefined,
    buscarComunidad: conWhapi ? async (cliente) => {
      const { nombreComunidad } = await import('@/lib/bot/alta/motor/comunidad')
      const halladas = await whapi().buscarComunidades({ nombre: nombreComunidad(cliente), desde: '2020-01-01T00:00:00.000Z' })
      return halladas.length === 1 ? halladas[0].id : null
    } : undefined,
    leerClientes: leer,
    puntajes: lecturas ? puntajesTypeform : undefined,
    mencionAylu: prueba ? null : idDiscord(env.DISCORD_ID_AYLU),
    equipo,
    ahora: op.ahora ?? Date.now,
    esperar: op.esperar ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    margenes: op.margenes,
    log: op.log ?? console,
  }
}

export const lineaResumenBajas = (r: ResumenBajas) =>
  `modo ${r.modo}: ${r.avisos} aviso(s) de fin, ${r.renovaciones} renovación(es), ${r.llamadas} llamada(s), ${r.pedidosBaja} pedido(s) de baja, ${r.bajas} baja(s), ${r.despedidas} despedida(s), ${r.quitados} quitado(s), ${r.aprobados} OK, ${r.rechazados} NO, ${r.recontactos} recontacto(s), ${r.vencidos} vencido(s), ${r.errores.length} error(es)`

/** Junta los resúmenes de los núcleos (prueba y general). Las líneas del de prueba van con "[prueba] ". */
export function unirResumenes(rs: readonly { prueba: boolean; r: ResumenBajas }[], modoGeneral: string): ResumenBajas {
  const out: ResumenBajas = { modo: modoGeneral, avisos: 0, pedidosBaja: 0, despedidas: 0, aprobados: 0, rechazados: 0, renovaciones: 0, llamadas: 0, bajas: 0, quitados: 0, recontactos: 0, vencidos: 0, ecos: 0, ignorados: 0, errores: [], registro: [] }
  const numericos = ['avisos', 'pedidosBaja', 'despedidas', 'aprobados', 'rechazados', 'renovaciones', 'llamadas', 'bajas', 'quitados', 'recontactos', 'vencidos', 'ecos', 'ignorados'] as const
  for (const { prueba, r } of rs) {
    for (const k of numericos) out[k] += r[k]
    const pre = prueba ? '[prueba] ' : ''
    out.errores.push(...r.errores.map((e) => pre + e))
    out.registro.push(...r.registro.map((e) => pre + e))
  }
  if (rs.some((x) => x.prueba)) out.modo = `${modoGeneral} + prueba`
  return out
}

/** Los núcleos que corren: el de PRUEBA (si BOT_CLIENTES_PRUEBA tiene IDs; real solo para esos) y SIEMPRE el general (en seco
 *  no hace nada, como siempre). Con la lista vacía es exactamente lo de antes. */
export function nucleosBajas(op: OpcionesBajasReal = {}): { prueba: boolean; nucleo: ReturnType<typeof crearNucleoBajas>; config: ConfigBajas }[] {
  const env = op.env ?? process.env
  if (bajasApagado(env)) return []
  const general = op.config ?? configBajas(env)
  const p = op.config ? null : configPruebaBajas(env)
  const out: { prueba: boolean; nucleo: ReturnType<typeof crearNucleoBajas>; config: ConfigBajas }[] = []
  if (p) out.push({ prueba: true, config: p, nucleo: crearNucleoBajas(depsBajasReales({ ...op, config: p })) })
  out.push({ prueba: false, config: general, nucleo: crearNucleoBajas(depsBajasReales({ ...op, config: general })) })
  return out
}

async function enTodos(op: OpcionesBajasReal, fn: (n: ReturnType<typeof crearNucleoBajas>, prueba: boolean) => Promise<ResumenBajas>): Promise<ResumenBajas> {
  const env = op.env ?? process.env
  const ns = nucleosBajas(op)
  const rs: { prueba: boolean; r: ResumenBajas }[] = []
  for (const n of ns) rs.push({ prueba: n.prueba, r: await fn(n.nucleo, n.prueba) })
  return rs.length === 1 && !rs[0].prueba ? rs[0].r : unirResumenes(rs, (op.config ?? configBajas(env)).modo)
}

let avisoFalta = ''
function puedeCorrer(env: NodeJS.ProcessEnv, log: RegistroLogBajas, op: OpcionesBajasReal): boolean {
  if (bajasApagado(env)) return false
  if (configBajas(env).modo === 'seco' && !op.config && !configPruebaBajas(env)) return false
  if (!env.DATABASE_URL?.trim() && !op.almacen) {
    if (avisoFalta !== 'DATABASE_URL') { avisoFalta = 'DATABASE_URL'; log.warn('bot-bajas: sin DATABASE_URL — la etapa Bajas no procesa nada') }
    return false
  }
  const raras = capacidadesBajasDesconocidas(env).length
  if (raras) log.warn(`bot-bajas: BOT_BAJAS_CAPACIDADES trae ${raras} nombre(s) que no son capacidades: se ignoran`)
  return true
}
const logErrores = (log: RegistroLogBajas, r: ResumenBajas) => { for (const e of r.errores.slice(0, 5)) log.warn(`bot-bajas: ${e.replace(/\d{8,}/g, '[número]').slice(0, 200)}`) }

/** Webhook de Whapi (en after()): los OK / NO de los pedidos de esta etapa. Nunca tira. null = no hizo nada. */
export async function procesarBajasReal(cands: CandidatosBajas, op: OpcionesBajasReal = {}): Promise<ResumenBajas | null> {
  const env = op.env ?? process.env
  const log = op.log ?? console
  if (sinCandidatosBajas(cands) || !puedeCorrer(env, log, op)) return null
  try {
    const r = await enTodos(op, (n) => n.procesarEventos(cands))
    if (r.aprobados || r.rechazados || r.ecos || r.errores.length) log.info(`bot-bajas: ${lineaResumenBajas(r)}`)
    logErrores(log, r)
    return r
  } catch (e) {
    log.error(`bot-bajas: falló el proceso (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    return null
  }
}
export type ProcesarBajas = typeof procesarBajasReal

/** Webhook de Fathom de /api/bot/kickoff (en SU PROPIO after(), separado del kickoff): la MISMA grabación, sin otro webhook.
 *  `deadline` (ms epoch): la ruta pasa t0 + PLAZO_BAJAS_MS (275 s desde que llegó el webhook). Adentro, el núcleo no empieza
 *  ni abre el pedido sin margen (la llamada queda 'cortada' y se puede reintentar); afuera, una carrera contra el deadline
 *  garantiza que esta tarea termina a tiempo aunque algo se cuelgue. Lo que no sea de renovación se descarta barato: sin
 *  Claude, sin escrituras (nunca llama a Meta). Nunca tira. */
export async function procesarLlamadaBajasReal(datos: unknown, op: OpcionesBajasReal & { deadline?: number } = {}): Promise<ResumenBajas | null> {
  const env = op.env ?? process.env
  const log = op.log ?? console
  if (!puedeCorrer(env, log, op)) return null
  const configs = op.config ? [op.config] : [configBajas(env), configPruebaBajas(env)].filter((x): x is ConfigBajas => !!x)
  if (!configs.some((c) => prendida('baja_fathom', c.modo, c.capacidades))) return null   // sin la capacidad no se gasta nada
  const v = validarReunion(datos)
  if (!v.ok) return null
  const ahora = op.ahora ?? Date.now
  const deadline = op.deadline ?? ahora() + PLAZO_BAJAS_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<'tope'>((res) => { timer = setTimeout(() => res('tope'), Math.max(0, deadline - ahora())) })
  try {
    const r = await Promise.race([enTodos(op, (n) => n.procesarLlamada(v.reunion, { deadline })), tope])
    if (r === 'tope') { log.warn(`bot-bajas: llamada ${v.reunion.recording_id} — se acabó el tope de la etapa (queda para reintentar)`); return null }
    if (r.llamadas || r.errores.length) log.info(`bot-bajas: llamada ${v.reunion.recording_id} — ${lineaResumenBajas(r)}`)
    logErrores(log, r)
    return r
  } catch (e) {
    log.error(`bot-bajas: falló la llamada (${String((e as Error)?.name ?? 'error').slice(0, 40)})`)
    return null
  } finally { if (timer) clearTimeout(timer) }
}

/** Manual (/api/bot/bajas?recording_id=…): trae la grabación de la API de Fathom (FATHOM_API_KEY_TOMAS por defecto). */
export async function procesarGrabacionBajasReal(recordingId: number, quien: 'tomas' | 'gero_m', op: OpcionesBajasReal = {}): Promise<ResumenBajas> {
  const { traerReunion } = await import('@/lib/bot/kickoff/fathomApi')
  const t = await traerReunion(recordingId, quien, { fetch: op.fetch, env: op.env })
  return enTodos(op, (n) => n.procesarLlamada(t.reunion as ReunionFathom))
}

export async function pedirBajaManualReal(id: string, por: string, motivo: string, op: OpcionesBajasReal = {}): Promise<ResumenBajas> {
  // Un cliente de prueba lo atiende SOLO el núcleo de prueba; cualquier otro, solo el general
  const env = op.env ?? process.env
  const ns = nucleosBajas(op)
  const esPrueba = !op.config && esClientePrueba(id, configBajas(env).clientesPrueba ?? [])
  const n = ns.find((x) => x.prueba === esPrueba)
  if (!n) { const r = unirResumenes([], configBajas(env).modo); r.registro.push('BOT_BAJAS=no: la etapa está apagada'); return r }
  const r = await n.nucleo.pedirBajaManual(id, por, motivo)
  return n.prueba ? unirResumenes([{ prueba: true, r }], configBajas(env).modo) : r
}

/** El cron diario. `dry`: lee todo y devuelve lo que haría, sin mandar ni escribir nada. */
export async function correrDiarioBajasReal(op: OpcionesBajasReal & { forzarRecontacto?: boolean } = {}): Promise<ResumenBajas> {
  const r = await enTodos(op, (n) => n.correrDiario({ forzarRecontacto: op.forzarRecontacto }))
  if (!op.dry) (op.log ?? console).info(`bot-bajas: diario — ${lineaResumenBajas(r)}`)
  return r
}
