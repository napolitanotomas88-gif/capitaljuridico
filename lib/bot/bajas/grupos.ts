// ── Bot "Capital Jurídico": etapa BAJA — los 3 grupos de un cliente (General, Ventas y Contenido) ─────────────────────────
// Mismo criterio que el reenvío a Guiones y la etapa Éxito (copiado y reducido de lib/bot/exito/directorio.ts para que esta
// etapa no dependa de los cachés ni de la forma de las fichas de Éxito; se pueden unificar más adelante):
//   1. los chat_id que guardó el paso 'comunidad' del motor (cj_altas_pasos.resultado / parcial → grupos.<g>.id), con el
//      ID del CRM que guardó el paso 'crm'. Se cruza por ID del CRM (y si no, por nombre igual).
//   2. si no está ahí (clientes de antes del bot): GET /groups de Whapi (paginado) y los nombres "General - X",
//      "Ventas - X", "Contenido - X". El cliente X se cruza por nombre: igual o, si es el ÚNICO, con 2 o más palabras en común.
// Nunca adivina entre dos. En seco no hay Whapi (solo el motor).
import { PATRON_GRUPO } from '@/lib/bot/whapi/comun'
import { correosDe } from '@/lib/bot/alta/parsear'
import { normNombre } from './fin'

export type GrupoCliente = 'general' | 'ventas' | 'contenido'
export const GRUPOS_CLIENTE: readonly GrupoCliente[] = ['general', 'ventas', 'contenido']
export const PREFIJOS: Record<GrupoCliente, string> = { general: 'General - ', ventas: 'Ventas - ', contenido: 'Contenido - ' }

/** `comunidad`: el id de la comunidad del cliente (ronda 2), si el motor lo guardó (paso 'comunidad': comunidadId). */
/** Ronda 2: `carpeta` = id de su carpeta de Drive (paso 'drive') y `correos` = los del #ALTA (cliente y socios). */
export interface GruposDeCliente { cliente: string; idCrm: string | null; grupos: Partial<Record<GrupoCliente, string>>; origen: 'motor' | 'nombre'; comunidad?: string | null; carpeta?: string | null; correos?: string[] }

type Fila = Record<string, unknown>
const idGrupo = (x: unknown): string | null => (typeof x === 'string' && PATRON_GRUPO.test(x.trim()) ? x.trim() : null)

export function parsearNombreGrupo(nombre: string | null | undefined): { grupo: GrupoCliente; cliente: string } | null {
  const t = (nombre ?? '').trimStart()
  for (const g of GRUPOS_CLIENTE) {
    if (t.startsWith(PREFIJOS[g])) { const cliente = t.slice(PREFIJOS[g].length).trim(); return cliente ? { grupo: g, cliente } : null }
  }
  return null
}

/** Filas de la consulta al motor → fichas (la más nueva de cada cliente manda). PURO. */
export function fichasDelMotor(filas: readonly Fila[]): GruposDeCliente[] {
  const porClave = new Map<string, GruposDeCliente>()
  for (const f of [...filas].sort((a, b) => String(a.creado ?? '').localeCompare(String(b.creado ?? '')))) {
    const grupos: Partial<Record<GrupoCliente, string>> = {}
    for (const g of GRUPOS_CLIENTE) { const id = idGrupo(f[g]); if (id) grupos[g] = id }
    if (!Object.keys(grupos).length) continue
    const nombre = String(f.nombre ?? '').trim()
    const idCrm = typeof f.id_crm === 'string' && /^[A-Za-z]\d{1,5}$/.test(f.id_crm) ? f.id_crm.toUpperCase() : null
    porClave.set(idCrm ?? `n:${normNombre(nombre)}`, { cliente: nombre, idCrm, grupos, origen: 'motor', comunidad: idGrupo(f.comunidad),
      carpeta: typeof f.carpeta === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(f.carpeta) ? f.carpeta : null,
      correos: typeof f.texto === 'string' ? [...new Set(correosDe(f.texto))] : [] })
  }
  return [...porClave.values()]
}

/** Grupos de Whapi (id + nombre) → fichas por nombre de cliente. PURO. */
export function fichasPorNombre(grupos: readonly { id: string; nombre: string }[]): GruposDeCliente[] {
  const por = new Map<string, GruposDeCliente>()
  for (const g of grupos) {
    const p = parsearNombreGrupo(g.nombre)
    const id = idGrupo(g.id)
    if (!p || !id) continue
    const k = normNombre(p.cliente)
    const f = por.get(k) ?? { cliente: p.cliente, idCrm: null, grupos: {}, origen: 'nombre' as const }
    f.grupos[p.grupo] ??= id
    por.set(k, f)
  }
  return [...por.values()]
}

const palabras = (s: string) => new Set(normNombre(s).split(' ').filter((w) => w.length >= 3))

/** La ficha de un cliente del CRM entre las conocidas: por ID, por nombre igual o, si es la ÚNICA, 2+ palabras en común. */
export function fichaDe(id: string, nombre: string, fichas: readonly GruposDeCliente[]): GruposDeCliente | null {
  const porId = fichas.find((f) => f.idCrm && f.idCrm === id.toUpperCase())
  if (porId) return porId
  const n = normNombre(nombre)
  const iguales = fichas.filter((f) => normNombre(f.cliente) === n)
  if (iguales.length === 1) return iguales[0]
  if (iguales.length > 1) return null
  const pc = palabras(nombre)
  const parecidas = fichas.filter((f) => [...palabras(f.cliente)].filter((w) => pc.has(w)).length >= 2)
  return parecidas.length === 1 ? parecidas[0] : null
}

export interface FuentesGrupos {
  filasMotor(): Promise<Fila[]>
  listarGrupos(): Promise<{ id: string; nombre: string }[]>
  conWhapi: boolean
}

export interface DirectorioGrupos { deCliente(id: string, nombre: string): Promise<GruposDeCliente | null> }

/** Una consulta al motor y una lista de Whapi por invocación (el cron y el webhook son cortos: no hace falta más caché). */
export function crearDirectorioGrupos(f: FuentesGrupos): DirectorioGrupos {
  let motor: Promise<GruposDeCliente[]> | null = null
  let whapi: Promise<GruposDeCliente[]> | null = null
  return {
    async deCliente(id, nombre) {
      motor ??= f.filasMotor().then(fichasDelMotor).catch(() => [])
      const delMotor = fichaDe(id, nombre, await motor)
      // El motor puede tener solo algunos grupos (un alta a medias): se completan por nombre
      if (delMotor && GRUPOS_CLIENTE.every((g) => delMotor.grupos[g])) return delMotor
      if (!f.conWhapi) return delMotor
      whapi ??= f.listarGrupos().then(fichasPorNombre).catch(() => [])
      const porNombre = fichaDe(id, nombre, await whapi)
      if (!delMotor) return porNombre
      return porNombre ? { ...delMotor, grupos: { ...porNombre.grupos, ...delMotor.grupos }, comunidad: delMotor.comunidad ?? null, carpeta: delMotor.carpeta ?? null, correos: delMotor.correos ?? [] } : delMotor
    },
  }
}

/** La consulta al motor (una sola): grupos de la comunidad, nombre del alta e ID del CRM. */
export const CONSULTA_MOTOR_BAJAS = `SELECT a.nombre_cliente AS nombre, a.creado, a.texto_vigente AS texto,
  COALESCE(pc.resultado -> 'grupos' -> 'general' ->> 'id', pc.parcial -> 'grupos' -> 'general' ->> 'id') AS general,
  COALESCE(pc.resultado -> 'grupos' -> 'ventas' ->> 'id', pc.parcial -> 'grupos' -> 'ventas' ->> 'id') AS ventas,
  COALESCE(pc.resultado -> 'grupos' -> 'contenido' ->> 'id', pc.parcial -> 'grupos' -> 'contenido' ->> 'id') AS contenido,
  COALESCE(pr.resultado ->> 'id', pr.parcial ->> 'id') AS id_crm,
  COALESCE(pc.resultado ->> 'comunidadId', pc.parcial ->> 'comunidadId') AS comunidad,
  COALESCE(pd.resultado -> 'carpeta' ->> 'id', pd.parcial -> 'guardado' -> 'carpeta' ->> 'id') AS carpeta
  FROM cj_altas a JOIN cj_altas_pasos pc ON pc.alta_id = a.id AND pc.paso = 'comunidad'
  LEFT JOIN cj_altas_pasos pr ON pr.alta_id = a.id AND pr.paso = 'crm'
  LEFT JOIN cj_altas_pasos pd ON pd.alta_id = a.id AND pd.paso = 'drive'
  WHERE a.estado NOT IN ('simulada', 'duplicada', 'rechazada')`
