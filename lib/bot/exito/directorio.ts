// ── Bot "Capital Jurídico": etapa ÉXITO — de qué cliente es cada grupo (General, Ventas y Contenido) ──────────────────────
// Cambio de Tomás (25/10/2026): el éxito se DETECTA en los 3 grupos del cliente; la encuesta, el pedido de testimonio y el
// Calendly salen SIEMPRE al General. Cómo se sabe, sin adivinar (mismo criterio que el reenvío a Guiones):
//   1. los chat_id que guardó el paso 'comunidad' del motor (cj_altas_pasos.resultado / parcial → grupos.general|ventas|
//      contenido.id), con el nombre del alta (cj_altas.nombre_cliente) y el ID del CRM que guardó el paso 'crm'
//      (resultado.id / parcial.id). Una consulta, 10 min de caché por instancia.
//   2. si no está ahí (clientes de antes del bot): el nombre del grupo por Whapi (GET /groups/{id}): "General - X",
//      "Ventas - X" o "Contenido - X". El cliente es X; el General se busca por nombre en GET /groups (paginado, 1 h de caché).
//      Caché del nombre: 12 h si es de un cliente, 1 h si no, 5 min si Whapi falló.
// La clave del cliente (para el "un pedido abierto" y los 60 días) es el ID del CRM si se conoce; si no, "n:<nombre normalizado>".
import { PATRON_GRUPO } from '@/lib/bot/whapi/comun'
import type { GrupoCliente } from './textos'

export interface FichaCliente {
  clave: string; cliente: string; idCrm: string | null
  grupos: Partial<Record<GrupoCliente, string>>
  invitacionGeneral: string | null
  origen: 'motor' | 'nombre'
}
export interface EntradaChat { ficha: FichaCliente; grupo: GrupoCliente }

export const PREFIJOS: Record<GrupoCliente, string> = { general: 'General - ', ventas: 'Ventas - ', contenido: 'Contenido - ' }

export const normNombre = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
export const claveCliente = (idCrm: string | null, nombre: string): string => (idCrm && /^[A-Za-z]\d{1,5}$/.test(idCrm) ? idCrm.toUpperCase() : `n:${normNombre(nombre)}`)

/** "General - Ana Pérez" → { grupo: 'general', cliente: 'Ana Pérez' }; otro nombre → null. */
export function parsearNombreGrupo(nombre: string | null | undefined): { grupo: GrupoCliente; cliente: string } | null {
  const t = (nombre ?? '').trimStart()
  for (const g of Object.keys(PREFIJOS) as GrupoCliente[]) {
    if (t.startsWith(PREFIJOS[g])) {
      const cliente = t.slice(PREFIJOS[g].length).trim()
      return cliente ? { grupo: g, cliente } : null
    }
  }
  return null
}

type Fila = Record<string, unknown>
const idGrupo = (x: unknown): string | null => (typeof x === 'string' && PATRON_GRUPO.test(x.trim()) ? x.trim() : null)

/** Las filas de la consulta al motor → fichas (puro). La más nueva de cada cliente manda. */
export function fichasDelMotor(filas: readonly Fila[]): FichaCliente[] {
  const porClave = new Map<string, FichaCliente>()
  const ordenadas = [...filas].sort((a, b) => String(a.creado ?? '').localeCompare(String(b.creado ?? '')))
  for (const f of ordenadas) {
    const grupos: Partial<Record<GrupoCliente, string>> = {}
    for (const g of ['general', 'ventas', 'contenido'] as GrupoCliente[]) { const id = idGrupo(f[g]); if (id) grupos[g] = id }
    if (!Object.keys(grupos).length) continue
    const nombre = String(f.nombre ?? '').trim() || 'Cliente sin nombre'
    const idCrm = typeof f.id_crm === 'string' && /^[A-Za-z]\d{1,5}$/.test(f.id_crm) ? f.id_crm.toUpperCase() : null
    const clave = claveCliente(idCrm, nombre)
    const invitacion = typeof f.invitacion === 'string' && f.invitacion ? (f.invitacion.startsWith('https://') ? f.invitacion : `https://chat.whatsapp.com/${f.invitacion}`) : null
    porClave.set(clave, { clave, cliente: nombre, idCrm, grupos, invitacionGeneral: invitacion, origen: 'motor' })
  }
  return [...porClave.values()]
}

/** La lista de grupos de Whapi (id + nombre) → fichas por nombre (puro). */
export function fichasPorNombre(grupos: readonly { id: string; nombre: string }[]): FichaCliente[] {
  const porCliente = new Map<string, FichaCliente>()
  for (const g of grupos) {
    const p = parsearNombreGrupo(g.nombre)
    const id = idGrupo(g.id)
    if (!p || !id) continue
    const clave = claveCliente(null, p.cliente)
    const f = porCliente.get(clave) ?? { clave, cliente: p.cliente, idCrm: null, grupos: {}, invitacionGeneral: null, origen: 'nombre' as const }
    f.grupos[p.grupo] ??= id
    porCliente.set(clave, f)
  }
  return [...porCliente.values()]
}

export interface FuentesDirectorio {
  /** Filas del motor: { nombre, id_crm, general, ventas, contenido, invitacion, creado }. [] si no hay base o tabla. */
  filasMotor(): Promise<Fila[]>
  /** Nombre de un grupo (GET /groups/{id}); null si Whapi no lo conoce. Tira si Whapi falló. */
  nombreGrupo(chatId: string): Promise<string | null>
  /** Todos los grupos del número (GET /groups paginado). */
  listarGrupos(): Promise<{ id: string; nombre: string }[]>
  ahora?: () => number
  /** false en seco: sin Whapi (solo el motor). */
  conWhapi: boolean
}

export const MOTOR_CACHE_MS = 10 * 60_000
export const NOMBRE_SI_MS = 12 * 3600_000
export const NOMBRE_NO_MS = 3600_000
export const NOMBRE_ERROR_MS = 5 * 60_000
export const LISTA_CACHE_MS = 3600_000

export interface Directorio {
  deChat(chatId: string): Promise<EntradaChat | null>
  /** Todas las fichas conocidas (motor + grupos por nombre), para la encuesta mensual. */
  todas(): Promise<FichaCliente[]>
}

export function crearDirectorio(f: FuentesDirectorio): Directorio {
  const ahora = f.ahora ?? Date.now
  let motor: { fichas: FichaCliente[]; hasta: number } = { fichas: [], hasta: 0 }
  let lista: { grupos: { id: string; nombre: string }[]; hasta: number } = { grupos: [], hasta: 0 }
  const nombres = new Map<string, { nombre: string | null; hasta: number }>()

  async function fichasMotor(): Promise<FichaCliente[]> {
    if (ahora() < motor.hasta) return motor.fichas
    try {
      motor = { fichas: fichasDelMotor(await f.filasMotor()), hasta: ahora() + MOTOR_CACHE_MS }
    } catch {
      motor = { fichas: motor.fichas, hasta: ahora() + NOMBRE_ERROR_MS }
    }
    return motor.fichas
  }
  async function grupos(): Promise<{ id: string; nombre: string }[]> {
    if (!f.conWhapi) return []
    if (ahora() < lista.hasta) return lista.grupos
    try {
      lista = { grupos: await f.listarGrupos(), hasta: ahora() + LISTA_CACHE_MS }
    } catch {
      lista = { grupos: lista.grupos, hasta: ahora() + NOMBRE_ERROR_MS }
    }
    return lista.grupos
  }
  async function nombre(chatId: string): Promise<string | null> {
    const c = nombres.get(chatId)
    if (c && ahora() < c.hasta) return c.nombre
    try {
      const n = await f.nombreGrupo(chatId)
      nombres.set(chatId, { nombre: n, hasta: ahora() + (parsearNombreGrupo(n) ? NOMBRE_SI_MS : NOMBRE_NO_MS) })
      return n
    } catch {
      nombres.set(chatId, { nombre: null, hasta: ahora() + NOMBRE_ERROR_MS })
      return null
    }
  }

  return {
    async deChat(chatId) {
      for (const ficha of await fichasMotor()) {
        for (const g of Object.keys(ficha.grupos) as GrupoCliente[]) if (ficha.grupos[g] === chatId) return { ficha, grupo: g }
      }
      if (!f.conWhapi) return null
      const p = parsearNombreGrupo(await nombre(chatId))
      if (!p) return null
      // Si el motor ya tiene a ese cliente por nombre (grupo renombrado o recreado a mano), se usa su ficha
      const clave = claveCliente(null, p.cliente)
      const delMotor = (await fichasMotor()).find((x) => normNombre(x.cliente) === normNombre(p.cliente))
      if (delMotor) return { ficha: { ...delMotor, grupos: { ...delMotor.grupos, [p.grupo]: delMotor.grupos[p.grupo] ?? chatId } }, grupo: p.grupo }
      const porNombre = fichasPorNombre(await grupos()).find((x) => x.clave === clave)
      const ficha: FichaCliente = porNombre
        ? { ...porNombre, grupos: { ...porNombre.grupos, [p.grupo]: porNombre.grupos[p.grupo] ?? chatId } }
        : { clave, cliente: p.cliente, idCrm: null, grupos: { [p.grupo]: chatId }, invitacionGeneral: null, origen: 'nombre' }
      return { ficha, grupo: p.grupo }
    },
    async todas() {
      const delMotor = await fichasMotor()
      const ids = new Set(delMotor.flatMap((x) => Object.values(x.grupos)))
      const nombresMotor = new Set(delMotor.map((x) => normNombre(x.cliente)))
      const otras = fichasPorNombre((await grupos()).filter((g) => !ids.has(g.id))).filter((x) => !nombresMotor.has(normNombre(x.cliente)))
      return [...delMotor, ...otras]
    },
  }
}

/** La consulta al motor (una sola): grupos de la comunidad, nombre del alta e ID del CRM. */
export const CONSULTA_MOTOR = `SELECT a.nombre_cliente AS nombre, a.creado,
  COALESCE(pc.resultado -> 'grupos' -> 'general' ->> 'id', pc.parcial -> 'grupos' -> 'general' ->> 'id') AS general,
  COALESCE(pc.resultado -> 'grupos' -> 'ventas' ->> 'id', pc.parcial -> 'grupos' -> 'ventas' ->> 'id') AS ventas,
  COALESCE(pc.resultado -> 'grupos' -> 'contenido' ->> 'id', pc.parcial -> 'grupos' -> 'contenido' ->> 'id') AS contenido,
  COALESCE(pc.resultado -> 'grupos' -> 'general' ->> 'invitacion', pc.parcial -> 'grupos' -> 'general' ->> 'invitacion') AS invitacion,
  COALESCE(pr.resultado ->> 'id', pr.parcial ->> 'id') AS id_crm
  FROM cj_altas a JOIN cj_altas_pasos pc ON pc.alta_id = a.id AND pc.paso = 'comunidad'
  LEFT JOIN cj_altas_pasos pr ON pr.alta_id = a.id AND pr.paso = 'crm'
  WHERE a.estado NOT IN ('simulada', 'duplicada', 'rechazada')`
