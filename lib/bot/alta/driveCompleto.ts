// ── Revisión diaria «Drive completo» (2/11/2026) ─────────────────────────────────────────────────────────────────────
// Regla de Tomás (2/11/2026): «toda alta y todo cliente activo tiene su carpeta "<Nombre> - C.J" con Crudos, Editados, Marca
// y Guiones». Si ya tiene la carpeta, se le agrega lo que falte; si no la tiene, se crea entera. La bienvenida la arma el
// alta; esta revisión solo se la agrega a los clientes recientes (Día 1 en los últimos DIAS_RECIENTE días): a un cliente
// de hace meses no se le arma un documento de bienvenida.
// Este archivo es el núcleo (sin red: todo entra por deps) y lo prueba scripts/test-bot-drive-completo.mjs. Las
// dependencias reales están en driveCompletoServidor.ts y la ruta es /api/bot/drive-completo (cron diario 9:30 AR).
// Por cliente ACTIVO del CRM (sin archivados, sin «PRUEBA BOT…», sin filas sin ID):
//   1. Busca su carpeta en la raíz de Clientes: por el vínculo registrado (registro del vigía cj_grab_carpetas, Doc de
//      guiones cj_guiones_documentos, cj_altas) o por el nombre exacto (normalizado, sin "- C.J"/"- SKWD").
//   2. Una sola carpeta y nada raro → la revisa: lo que ya tiene adentro se reconoce por el prefijo (cualquier sufijo, como
//      los puestos a mano) y solo se crea lo que falta, con prepararDriveCliente (idempotente: el puente busca por nombre adentro).
//   3. Ninguna carpeta y ningún parecido → la crea completa (carpeta + Crudos, Editados, Marca, Guiones).
//   4. Ambigüedad → NO toca nada y avisa en 🛠️-operaciones mencionando a coordinación y Gero M (una vez por situación):
//      dos carpetas posibles, una carpeta registrada fuera de Clientes (las sueltas en Mi unidad: la cuenta de servicio no
//      ve Mi unidad, así que se detectan por el vínculo registrado), un homónimo en el CRM, una carpeta con un nombre
//      parecido, una carpeta vinculada a otro ID o un cliente viejo sin carpeta (casi seguro tiene una con otro nombre).
//   5. Registra en el Despacho: las raíces Crudos / Editados / Marca en el registro del vigía (con el ID y vigiladas) y el
//      Doc de guiones como «listo» (si lo creó esta corrida o el cliente es reciente y no tiene otro registrado).
// Tope: TOPE_POR_CORRIDA clientes con llamadas al Puente por corrida (los nuevos primero); el resto queda para mañana.
// Corte (Tomás, 3/11/2026: «empezá a aplicarla en los clientes nuevos que ingresaron a partir del 20/10/2026; el resto ya
// están bien armados»): solo entran los clientes con Día 1 del CRM ≥ BOT_DRIVE_COMPLETO_DESDE (por defecto 2026-10-20). Los
// de Día 1 anterior o sin Día 1 se ignoran por completo (ni completar, ni crear, ni avisar): solo se cuentan en el resumen
// como «fuera de corte». El paso Drive del alta («Cargar alta») no cambia: siempre arma los 5 elementos.
// Modos (BOT_DRIVE_COMPLETO_MODO): 'ensayo' (por defecto: lee todo, no escribe nada en Drive ni en la base y no avisa;
// devuelve el plan), 'real', 'apagado'. ?dry=1 fuerza el ensayo.
import { claveNombre, crearCruceCarpetas } from '../../clientes/prioridad'
import {
  CLAVES_ADENTRO, clasificarHijos, nombresDriveCliente, urlCarpetaDrive, type ClaveAdentro, type GuardadoDrive, type HijoDrive, type IdGuardado,
  type OpcionesDrive, type ResultadoDriveCliente,
} from './driveCliente'
import type { AltaParseada } from './parsear'

export type ModoDriveCompleto = 'real' | 'ensayo' | 'apagado'
export const VARIABLE_MODO = 'BOT_DRIVE_COMPLETO_MODO'
export const modoDriveCompleto = (env: Record<string, string | undefined> = process.env): ModoDriveCompleto => {
  const v = env[VARIABLE_MODO]?.trim().toLowerCase()
  return v === 'real' || v === 'apagado' ? v : 'ensayo'
}
export const TOPE_POR_CORRIDA = 10
/** Corte por fecha de ingreso (Día 1 del CRM): solo se revisan los clientes con Día 1 en esta fecha o después. */
export const VARIABLE_DESDE = 'BOT_DRIVE_COMPLETO_DESDE'
export const DESDE_POR_DEFECTO = '2026-10-20'
const esYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
export const desdeDriveCompleto = (env: Record<string, string | undefined> = process.env): string => {
  const v = env[VARIABLE_DESDE]?.trim()
  return esYmd(v) ? v : DESDE_POR_DEFECTO
}
/** ¿Entra en la revisión? Solo con Día 1 válido y en la fecha de corte o después (sin Día 1: fuera). */
export const dentroDelCorte = (c: Pick<ClienteActivo, 'dia1'>, desde: string = DESDE_POR_DEFECTO): boolean => esYmd(c.dia1) && c.dia1 >= desde
/** La bienvenida y el registro de un Doc de guiones que ya existía, solo para los que arrancaron hace 7 días o menos (los
 *  que no pasaron por el bot): a los más viejos no se les arma bienvenida ni se les cambia el Doc vinculado. */
export const DIAS_RECIENTE = 7
/** Sin carpeta y con el Día 1 más viejo que esto: no se crea (casi seguro tiene una con otro nombre, como un apodo:
 *  "Majo X - SKWD" para María José X): se avisa. */
export const DIAS_CREAR_SIN_CARPETA = 21
export const MAX_AVISOS_POR_CORRIDA = 8
/** Lo que tiene que estar siempre (la bienvenida, solo en los recientes). */
export const ESENCIALES: readonly ClaveAdentro[] = ['crudos', 'editados', 'marca', 'guiones']
export const NOMBRE_ELEMENTO: Record<ClaveAdentro, string> = { crudos: 'Crudos', editados: 'Editados', marca: 'Marca', guiones: 'Guiones', bienvenida: 'Bienvenida' }

const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'skwd'])
/** Palabras con peso de un nombre (4 letras o más, sin las genéricas). */
const palabrasDe = (s: string) => claveNombre(s).split(' ').filter((w) => w.length >= 4 && !GENERICAS.has(w))
const SUFIJO = /\s*-\s*(skwd|c\.?\s*j\.?|capital jur[ií]dico)\s*$/i
export const sinSufijo = (s: string) => s.replace(SUFIJO, '').trim()
export const esPrueba = (nombre: string) => /^\s*PRUEBA\b/i.test(nombre)

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ClienteActivo { id: string; nombre: string; dia1: string | null; correo?: string | null }
export interface CarpetaRaiz { id: string; nombre: string }
/** Vínculo registrado carpeta ↔ cliente. origen: 'vigia' (cj_grab_carpetas, tipo cliente, vínculo que procesa), 'doc'
 *  (cj_guiones_documentos.carpeta_id) o 'alta' (cj_altas). */
export interface VinculoCarpeta { drive_id: string; id_crm: string; origen: 'vigia' | 'doc' | 'alta'; vinculo?: string | null }

export interface EntradaPlan {
  clientes: readonly ClienteActivo[]
  /** Todos los del CRM (cualquier estado), para los homónimos. */
  todosCrm: readonly { id: string; nombre: string }[]
  carpetas: readonly CarpetaRaiz[]
  vinculos: readonly VinculoCarpeta[]
  /** Altas del motor que no terminaron (también las en Fee: el alta completa, con Drive, sigue con la primera cuota) y con
   *  el paso Drive sin hacer: ese paso arma la carpeta; la revisión no se
   *  mete (el puente busca-y-crea sin bloqueo: dos corridas a la vez podrían duplicar). */
  altasEnCurso?: readonly { id_crm: string | null; nombre: string }[]
  hoy: string   // YYYY-MM-DD (Argentina)
  /** Corte por Día 1 (YYYY-MM-DD); sin él, DESDE_POR_DEFECTO. */
  desde?: string
}

export type Decision =
  | { tipo: 'revisar'; cliente: ClienteActivo; carpeta: CarpetaRaiz; por: 'registro' | 'nombre'; vinculo: string | null }
  | { tipo: 'crear'; cliente: ClienteActivo }
  | { tipo: 'en_alta'; cliente: ClienteActivo }
  | { tipo: 'fuera_corte'; cliente: ClienteActivo }
  | { tipo: 'ambiguo'; cliente: ClienteActivo; codigo: string; motivo: string; carpetas: { id: string; nombre: string }[] }

const dias = (desde: string | null, hasta: string): number | null => {
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return null
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)
}
export const esReciente = (c: Pick<ClienteActivo, 'dia1'>, hoy: string): boolean => { const d = dias(c.dia1, hoy); return d !== null && d <= DIAS_RECIENTE }

/** Qué hacer con cada cliente activo (puro). Ordenado: los más nuevos primero. */
export function decidir(e: EntradaPlan): Decision[] {
  const enRaiz = new Map(e.carpetas.map((c) => [c.id, c]))
  const clave = (s: string) => claveNombre(sinSufijo(s))
  const porClave = new Map<string, CarpetaRaiz[]>()
  for (const c of e.carpetas) { const k = clave(c.nombre); if (k) porClave.set(k, [...(porClave.get(k) ?? []), c]) }
  const homonimos = new Map<string, number>()
  for (const c of e.todosCrm) { const k = claveNombre(c.nombre); if (k) homonimos.set(k, (homonimos.get(k) ?? 0) + 1) }
  // Dueño registrado de cada carpeta (el vigía manda; un doc o un alta suman)
  const duenos = new Map<string, Set<string>>()
  for (const v of e.vinculos) { const s = duenos.get(v.drive_id) ?? new Set<string>(); s.add(v.id_crm.toUpperCase()); duenos.set(v.drive_id, s) }
  const vinculoVigia = new Map(e.vinculos.filter((v) => v.origen === 'vigia').map((v) => [`${v.drive_id}|${v.id_crm.toUpperCase()}`, v.vinculo ?? null]))
  // Carpetas libres (sin dueño registrado) para el cruce tolerante
  const libres = e.carpetas.filter((c) => !duenos.has(c.id))
  const cruce = crearCruceCarpetas(libres, (c) => sinSufijo(c.nombre), e.todosCrm.map((c) => c.nombre))

  const out: Decision[] = []
  const orden = [...e.clientes].sort((a, b) => (b.dia1 ?? '').localeCompare(a.dia1 ?? ''))
  const enAlta = (c: ClienteActivo) => (e.altasEnCurso ?? []).some((a) => (a.id_crm && a.id_crm.toUpperCase() === c.id.toUpperCase())
    || (claveNombre(c.nombre).length > 0 && (` ${claveNombre(a.nombre)} `).includes(` ${claveNombre(c.nombre)} `)))
  const desde = esYmd(e.desde) ? e.desde : DESDE_POR_DEFECTO
  for (const c of orden) {
    // Antes del corte o sin Día 1: no se toca ni se avisa (regla de Tomás 3/11/2026)
    if (!dentroDelCorte(c, desde)) { out.push({ tipo: 'fuera_corte', cliente: c }); continue }
    const id = c.id.toUpperCase()
    const k = claveNombre(c.nombre)
    if (enAlta(c)) { out.push({ tipo: 'en_alta', cliente: c }); continue }
    const ambiguo = (codigo: string, motivo: string, cs: CarpetaRaiz[]) => out.push({ tipo: 'ambiguo', cliente: c, codigo, motivo, carpetas: cs.map((x) => ({ id: x.id, nombre: x.nombre })) })
    const registradas = [...new Set(e.vinculos.filter((v) => v.id_crm.toUpperCase() === id).map((v) => v.drive_id))]
    const dentro = registradas.filter((x) => enRaiz.has(x)).map((x) => enRaiz.get(x) as CarpetaRaiz)
    const fuera = registradas.filter((x) => !enRaiz.has(x)).map((x) => ({ id: x, nombre: '(fuera de Clientes)' }))
    const homonimo = (homonimos.get(k) ?? 0) > 1
    const porNombre = (porClave.get(k) ?? []).filter((x) => { const d = duenos.get(x.id); return !d || d.has(id) })
    const deOtro = (porClave.get(k) ?? []).filter((x) => { const d = duenos.get(x.id); return d && !d.has(id) })
    const conjunto = [...new Map([...dentro, ...(homonimo ? [] : porNombre)].map((x) => [x.id, x])).values()]
    // Una carpeta registrada a este cliente y a otro a la vez
    const compartida = dentro.find((x) => (duenos.get(x.id)?.size ?? 0) > 1)
    if (compartida) { ambiguo('compartida', 'la carpeta está registrada a este cliente y a otro ID a la vez', [compartida]); continue }
    if (conjunto.length > 1) { ambiguo('dos_carpetas', 'hay más de una carpeta que puede ser de este cliente en Clientes', conjunto); continue }
    if (conjunto.length === 1) {
      if (fuera.length) { ambiguo('suelta', 'además de su carpeta en Clientes tiene otra registrada fuera de Clientes (suelta en Mi unidad o en Ex clientes)', [conjunto[0], ...fuera]); continue }
      const x = conjunto[0]
      const por = dentro.some((y) => y.id === x.id) ? 'registro' : 'nombre'
      out.push({ tipo: 'revisar', cliente: c, carpeta: x, por, vinculo: vinculoVigia.get(`${x.id}|${id}`) ?? null })
      continue
    }
    // Sin carpeta en Clientes
    if (fuera.length) { ambiguo('fuera', 'su carpeta registrada no está en Clientes (suelta en Mi unidad o en Ex clientes): moverla a Clientes', fuera); continue }
    if (homonimo) { ambiguo('homonimo', 'hay otro cliente con el mismo nombre en el CRM: no se sabe cuál es su carpeta', porClave.get(k) ?? []); continue }
    if (deOtro.length) { ambiguo('de_otro', 'la carpeta con su nombre está registrada a otro ID', deOtro); continue }
    const parecida = cruce(c.nombre)
    // Antes de crear una carpeta: ninguna carpeta de Clientes puede compartir una palabra del nombre (solo el primer nombre,
    // "Nombre - SKWD", o una dupla "Nombre y Socio - SKWD"): ante la duda, se avisa y no se crea
    const ws = new Set(palabrasDe(c.nombre))
    const primero = palabrasDe(c.nombre)[0]
    const ultimo = palabrasDe(c.nombre).at(-1)
    const peso = (x: CarpetaRaiz) => palabrasDe(sinSufijo(x.nombre)).reduce((n, w) => n + (ws.has(w) ? (w === ultimo ? 3 : w === primero ? 1 : 2) : 0), 0)
    const comparten = e.carpetas.filter((x) => peso(x) > 0).sort((a, b) => peso(b) - peso(a))
    if (!parecida && comparten.length) { ambiguo('parecida', 'no tiene carpeta con su nombre exacto, pero hay carpetas que comparten parte del nombre: si alguna es suya, vincularla en /clientes/edicion o renombrarla', comparten.slice(0, 3)); continue }
    if (parecida) { ambiguo('parecida', 'no tiene carpeta con su nombre exacto, pero hay una con un nombre parecido: vincularla en /clientes/edicion o renombrarla', [parecida]); continue }
    const d = dias(c.dia1, e.hoy)
    if (d === null || d > DIAS_CREAR_SIN_CARPETA) { ambiguo('viejo_sin_carpeta', `no se encontró su carpeta y es cliente ${d === null ? 'sin Día 1 en el CRM' : `desde hace ${d} días`}: casi seguro tiene una con otro nombre (no se crea otra)`, []); continue }
    out.push({ tipo: 'crear', cliente: c })
  }
  return out
}

// ── Corrida ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FilaVigia { drive_id: string; nombre: string; tipo: 'cliente' | 'crudos' | 'editados' | 'marca'; padre_id: string; id_crm: string; vinculo: string; vigilar: boolean }

export interface DepsDriveCompleto {
  leerEntrada(): Promise<EntradaPlan & { carpetaClientesId: string }>
  listarHijos(carpetaId: string): Promise<HijoDrive[] | null>
  /** prepararDriveCliente real (con el puente). */
  preparar(a: AltaParseada, op: OpcionesDrive): Promise<ResultadoDriveCliente>
  plantillaGuionesId(): string | null
  /** drive_id ya registrados en el vigía (cualquier tipo). */
  registradasVigia(): Promise<Set<string>>
  /** IDs del CRM con Doc de guiones «listo». */
  docsListos(): Promise<Set<string>>
  guardarVigia(filas: FilaVigia[]): Promise<void>
  vincularDoc(p: { idCrm: string; docId: string; carpetaId: string }): Promise<void>
  avisar(a: { canal: 'operaciones' | 'sistema'; tipo: string; clave: string; titulo: string; cliente?: string | null; idCrm?: string | null; lineas: string[]; menciones?: ('aylu' | 'gero_m')[] }): Promise<string>
  ahora(): number
}

export interface OpcionesCorrida { modo: Exclude<ModoDriveCompleto, 'apagado'>; tope?: number; deadline?: number }

export interface LineaPlan {
  id: string; cliente: string; accion: 'nada' | 'completar' | 'crear' | 'registrar' | 'ambiguo' | 'en_alta' | 'tope' | 'error' | 'fuera_corte'
  carpeta?: string | null; faltan?: string[]; registra?: string[]; hecho?: string[]; motivo?: string
}
export interface ResultadoCorrida {
  modo: string; hoy: string; desde: string; activos: number; revisados: number
  resumen: Record<LineaPlan['accion'], number>
  plan: LineaPlan[]; avisos: { clave: string; estado: string }[]; errores: string[]
}

const altaDe = (c: ClienteActivo): AltaParseada => ({
  etiquetaAlta: false, closer: null, programa: null, modalidad: null, totalUsd: null, estePagoUsd: null, medioPago: null, pagoEnPesos: null,
  nombre: c.nombre, telefonos: [], socios: null, correo: c.correo ?? null, direccion: null, dni: null, cuit: null, inicio: null,
  contrato: 'normal', cuotas: [], faltantes: [], avisos: [],
} as AltaParseada)

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/gi, '[url]').slice(0, 200)

async function enParalelo<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]) } }))
  return out
}

/** Filas del registro del vigía para una carpeta de cliente y sus raíces (las que falten). */
function filasVigia(carpeta: IdGuardado & { nombre: string }, g: GuardadoDrive, idCrm: string, vinculo: string, ya: Set<string>, raizClientes: string): FilaVigia[] {
  const out: FilaVigia[] = []
  if (!ya.has(carpeta.id)) out.push({ drive_id: carpeta.id, nombre: sinSufijo(carpeta.nombre), tipo: 'cliente', padre_id: raizClientes, id_crm: idCrm, vinculo, vigilar: false })
  for (const k of ['crudos', 'editados', 'marca'] as const) {
    const x = g[k]
    if (x && !ya.has(x.id)) out.push({ drive_id: x.id, nombre: NOMBRE_ELEMENTO[k], tipo: k, padre_id: carpeta.id, id_crm: idCrm, vinculo, vigilar: k !== 'marca' })
  }
  return out
}

export async function correrDriveCompleto(deps: DepsDriveCompleto, op: OpcionesCorrida): Promise<ResultadoCorrida> {
  const tope = Math.max(0, Math.trunc(op.tope ?? TOPE_POR_CORRIDA))
  const deadline = op.deadline ?? deps.ahora() + 240_000
  const real = op.modo === 'real'
  const entrada = await deps.leerEntrada()
  const decisiones = decidir(entrada)
  const [hijosPorCarpeta, yaVigia, listos] = await Promise.all([
    enParalelo(decisiones.filter((d) => d.tipo === 'revisar'), 8, async (d) => {
      const id = (d as Extract<Decision, { tipo: 'revisar' }>).carpeta.id
      try { return [id, await deps.listarHijos(id)] as const } catch (e) { return [id, new Error(motivo(e))] as const }
    }).then((xs) => new Map<string, HijoDrive[] | null | Error>(xs)),
    deps.registradasVigia(),
    deps.docsListos(),
  ])
  const plan: LineaPlan[] = []
  const errores: string[] = []
  const avisos: { clave: string; estado: string }[] = []
  let conPuente = 0
  const plantilla = deps.plantillaGuionesId()

  for (const d of decisiones) {
    // Fuera de corte: ni línea en el plan (solo cuenta en el resumen)
    if (d.tipo === 'fuera_corte') continue
    const c = d.cliente
    const id = c.id.toUpperCase()
    const reciente = esReciente(c, entrada.hoy)
    // Si ya tiene un Doc de guiones registrado en el Despacho (aunque esté fuera de su carpeta), no se le copia otro: dos Docs
    // de guiones confunden a quien escribe y al vigía (revisión 2/11/2026)
    const conDoc = listos.has(id)
    const quiere: ClaveAdentro[] = (reciente ? [...CLAVES_ADENTRO] : [...ESENCIALES]).filter((k) => !(k === 'guiones' && conDoc))
    const omitir: ClaveAdentro[] = [...(reciente ? [] : ['bienvenida' as const]), ...(conDoc ? ['guiones' as const] : [])]
    if (d.tipo === 'en_alta') { plan.push({ id, cliente: c.nombre, accion: 'en_alta', motivo: 'su alta está en curso o en Fee: el paso Drive del alta arma la carpeta (con la primera cuota completa)' }); continue }
    if (d.tipo === 'ambiguo') {
      plan.push({ id, cliente: c.nombre, accion: 'ambiguo', motivo: d.motivo, carpeta: d.carpetas.map((x) => x.nombre).join(' · ') || null })
      continue
    }
    if (d.tipo === 'revisar') {
      const hijos = hijosPorCarpeta.get(d.carpeta.id)
      if (hijos instanceof Error || hijos == null) {
        plan.push({ id, cliente: c.nombre, accion: 'error', carpeta: d.carpeta.nombre, motivo: hijos instanceof Error ? `no se pudo listar la carpeta: ${hijos.message}` : 'sin cuenta de servicio' })
        continue
      }
      const ya = clasificarHijos(hijos)
      const faltan = quiere.filter((k) => !ya[k])
      const vinculo = d.vinculo && ['alta', 'aylu', 'tomas', 'bot'].includes(d.vinculo) ? d.vinculo : 'bot'
      const guardado: GuardadoDrive = { carpeta: { id: d.carpeta.id, url: urlCarpetaDrive(d.carpeta.id) }, ...ya }
      const registra = (g: GuardadoDrive, docCreado: boolean): string[] => {
        const r = filasVigia({ ...guardado.carpeta as IdGuardado, nombre: d.carpeta.nombre }, g, id, vinculo, yaVigia, entrada.carpetaClientesId).map((f) => `vigía ${f.tipo === 'cliente' ? 'carpeta' : NOMBRE_ELEMENTO[f.tipo as ClaveAdentro]}`)
        if (g.guiones && !listos.has(id) && (docCreado || reciente)) r.push('Doc de guiones «listo»')
        return r
      }
      if (!faltan.length) {
        const reg = registra(guardado, false)
        if (!reg.length) { plan.push({ id, cliente: c.nombre, accion: 'nada', carpeta: d.carpeta.nombre }); continue }
        const linea: LineaPlan = { id, cliente: c.nombre, accion: 'registrar', carpeta: d.carpeta.nombre, registra: reg }
        if (real) await registrar(deps, linea, { carpeta: { ...guardado.carpeta as IdGuardado, nombre: d.carpeta.nombre }, g: guardado, id, vinculo, yaVigia, raiz: entrada.carpetaClientesId, listos, docCreado: false, reciente }, errores)
        plan.push(linea)
        continue
      }
      const linea: LineaPlan = { id, cliente: c.nombre, accion: 'completar', carpeta: d.carpeta.nombre, faltan: faltan.map((k) => NOMBRE_ELEMENTO[k]) }
      if (faltan.includes('guiones') && !plantilla) linea.motivo = 'falta PLANTILLA_GUIONES_ID: los guiones quedan pendientes'
      linea.registra = registra({ ...guardado, ...Object.fromEntries(faltan.map((k) => [k, { id: `nuevo-${k}`, url: '' }])) }, faltan.includes('guiones'))
      if (conPuente >= tope || deps.ahora() > deadline) { plan.push({ ...linea, accion: 'tope', motivo: 'tope de la corrida: queda para mañana' }); continue }
      conPuente++
      if (real) {
        try {
          const r = await deps.preparar(altaDe(c), { modo: 'real', plantillaGuionesId: plantilla, guardado, omitir, idCrm: id, hasta: deadline })
          linea.hecho = faltan.filter((k) => r[k].estado === 'creado' || r[k].estado === 'existia').map((k) => NOMBRE_ELEMENTO[k])
          if (r.errores.length) { linea.accion = 'error'; linea.motivo = r.errores.join('; ').slice(0, 300) }
          await registrar(deps, linea, { carpeta: { ...guardado.carpeta as IdGuardado, nombre: d.carpeta.nombre }, g: r.guardar, id, vinculo, yaVigia, raiz: entrada.carpetaClientesId, listos, docCreado: r.guiones.estado === 'creado', reciente }, errores)
        } catch (e) { linea.accion = 'error'; linea.motivo = motivo(e) }
      }
      plan.push(linea)
      continue
    }
    // crear
    const n = nombresDriveCliente(c.nombre)
    const linea: LineaPlan = { id, cliente: c.nombre, accion: 'crear', carpeta: n?.carpeta ?? null, faltan: ['Carpeta', ...quiere.map((k) => NOMBRE_ELEMENTO[k])], registra: ['vigía carpeta', 'vigía Crudos', 'vigía Editados', 'vigía Marca', 'Doc de guiones «listo»'] }
    if (!n) { plan.push({ ...linea, accion: 'error', motivo: 'nombre sin letras' }); continue }
    if (conPuente >= tope || deps.ahora() > deadline) { plan.push({ ...linea, accion: 'tope', motivo: 'tope de la corrida: queda para mañana' }); continue }
    conPuente++
    if (real) {
      try {
        // Sin aceptarExistente: si la carpeta apareció entre la lectura y ahora, espera (no se toca) y se avisa
        const r = await deps.preparar(altaDe(c), { modo: 'real', plantillaGuionesId: plantilla, guardado: null, omitir, idCrm: id, hasta: deadline, carpetaClientesId: entrada.carpetaClientesId })
        if (r.esperaOk) {
          plan.push({ ...linea, accion: 'ambiguo', motivo: r.esperaOk === 'carpeta_existente' ? `ya había una carpeta "${n.carpeta}" en Clientes que no estaba en la lectura: no se tocó` : 'el nombre del CRM puede traer a más de una persona: no se creó nada' })
          continue
        }
        linea.hecho = (['carpeta', ...quiere] as const).filter((k) => r[k].estado === 'creado' || r[k].estado === 'existia').map((k) => (k === 'carpeta' ? 'Carpeta' : NOMBRE_ELEMENTO[k]))
        if (r.errores.length) { linea.accion = 'error'; linea.motivo = r.errores.join('; ').slice(0, 300) }
        if (r.guardar.carpeta) await registrar(deps, linea, { carpeta: { ...r.guardar.carpeta, nombre: n.carpeta }, g: r.guardar, id, vinculo: 'bot', yaVigia, raiz: entrada.carpetaClientesId, listos, docCreado: r.guiones.estado === 'creado', reciente }, errores)
      } catch (e) { linea.accion = 'error'; linea.motivo = motivo(e) }
    }
    plan.push(linea)
  }

  // Avisos (solo en real): ambigüedades a 🛠️-operaciones (una vez por situación) y el resumen del día a 🧰-sistema-bot
  if (real) {
    let n = 0
    for (const d of decisiones) {
      if (d.tipo !== 'ambiguo' || n >= MAX_AVISOS_POR_CORRIDA) continue
      const firma = [d.codigo, ...d.carpetas.map((x) => x.id).sort()].join(',')
      const clave = `drive-completo:ambiguo:${d.cliente.id.toUpperCase()}:${firma}`.slice(0, 280)
      const lineas = [d.motivo, ...d.carpetas.slice(0, 3).map((x) => `${x.nombre}: ${urlCarpetaDrive(x.id)}`), 'No se tocó nada: cuando quede una sola carpeta en Clientes con su nombre (o vinculada en /clientes/edicion), la revisión diaria la completa sola.']
      // Solo cuentan para el tope los que salieron: los ya avisados («ya_estaba») no tapan a los que siguen
      try {
        const estado = await deps.avisar({ canal: 'operaciones', tipo: 'drive_completo_ambiguo', clave, titulo: 'Drive del cliente: revisar a mano', cliente: d.cliente.nombre, idCrm: d.cliente.id, lineas, menciones: ['aylu', 'gero_m'] })
        avisos.push({ clave, estado })
        if (estado !== 'ya_estaba') n++
      } catch (e) { errores.push(`aviso ${d.cliente.id}: ${motivo(e)}`); n++ }
    }
    const hechos = plan.filter((l) => (l.accion === 'completar' || l.accion === 'crear' || l.accion === 'registrar') && ((l.hecho?.length ?? 0) > 0 || (l.registra?.length ?? 0) > 0))
    const fallas = plan.filter((l) => l.accion === 'error')
    if (hechos.length || fallas.length) {
      const lineas = [
        ...hechos.slice(0, 4).map((l) => `${l.id} ${l.cliente}: ${l.accion === 'crear' ? 'carpeta nueva' : l.accion === 'registrar' ? 'registrado' : `agregado ${(l.hecho ?? []).join(', ') || '—'}`}${l.registra?.length ? ` · registro: ${l.registra.length}` : ''}`),
        ...(hechos.length > 4 ? [`y ${hechos.length - 4} clientes más`] : []),
        ...(fallas.length ? [`${fallas.length} con error: ${fallas.slice(0, 3).map((l) => l.id).join(', ')}`] : []),
      ]
      const clave = `drive-completo:resumen:${entrada.hoy}`
      try { avisos.push({ clave, estado: await deps.avisar({ canal: 'sistema', tipo: 'drive_completo_resumen', clave, titulo: `Drive completo: ${hechos.length} cliente${hechos.length === 1 ? '' : 's'} al día`, lineas }) }) } catch (e) { errores.push(`resumen: ${motivo(e)}`) }
    }
  }

  const resumen = { nada: 0, completar: 0, crear: 0, registrar: 0, ambiguo: 0, en_alta: 0, tope: 0, error: 0, fuera_corte: 0 } as Record<LineaPlan['accion'], number>
  for (const l of plan) resumen[l.accion]++
  resumen.fuera_corte = decisiones.filter((d) => d.tipo === 'fuera_corte').length
  const desde = esYmd(entrada.desde) ? entrada.desde : DESDE_POR_DEFECTO
  return { modo: op.modo, hoy: entrada.hoy, desde, activos: entrada.clientes.length, revisados: plan.length, resumen, plan, avisos, errores }
}

async function registrar(
  deps: DepsDriveCompleto, linea: LineaPlan,
  x: { carpeta: IdGuardado & { nombre: string }; g: GuardadoDrive; id: string; vinculo: string; raiz: string; yaVigia: Set<string>; listos: Set<string>; docCreado: boolean; reciente: boolean },
  errores: string[],
): Promise<void> {
  const hecho: string[] = []
  const filas = filasVigia(x.carpeta, x.g, x.id, x.vinculo, x.yaVigia, x.raiz)
  if (filas.length) {
    try { await deps.guardarVigia(filas); for (const f of filas) x.yaVigia.add(f.drive_id); hecho.push(...filas.map((f) => `vigía ${f.tipo}`)) } catch (e) { errores.push(`${x.id} vigía: ${motivo(e)}`) }
  }
  if (x.g.guiones && !x.listos.has(x.id) && (x.docCreado || x.reciente)) {
    try { await deps.vincularDoc({ idCrm: x.id, docId: x.g.guiones.id, carpetaId: x.carpeta.id }); x.listos.add(x.id); hecho.push('Doc «listo»') } catch (e) { errores.push(`${x.id} Doc: ${motivo(e)}`) }
  }
  linea.registra = hecho
}
