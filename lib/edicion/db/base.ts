// ── Conexión a Neon para Grabación y Edición (la usan todos los db/*.ts, también los del bloque C) ─────────────────
// Mismo patrón que lib/bot/kickoff/registro.ts (que ya corre en producción):
//   · consulta(): un cliente HTTP de Neon por llamada, con un tope de TOPE_CONSULTA_MS; sin conexión, 5xx o timeout →
//     ErrorTransitorio (se reintenta en la próxima corrida). La URL de la base nunca sale en un mensaje.
//   · leer(): igual, pero si la tabla todavía no existe (42P01) devuelve `vacio`: las LECTURAS no crean nada.
//   · asegurarTablas(): corre la migración versionada (db/migracion.ts) una vez por proceso. SOLO la llaman las escrituras.
//   · sqlParaPruebas(): los tests reemplazan el cliente por un Neon falso (null vuelve al real) y se olvida la migración.
// Misma base que Cuotas y el kickoff (DATABASE_URL). Solo servidor.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import { migrar } from './migracion'

export type Sql = NeonQueryFunction<false, false>
export type Fila = Record<string, unknown>

export const TOPE_CONSULTA_MS = 10_000

export const baseConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()

const sqlReal = (url: string): Sql => neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_CONSULTA_MS) } })
let crearSql: (url: string) => Sql = sqlReal
let tablasListas: Promise<void> | null = null

/** Solo para los tests: reemplaza el cliente de Neon por uno falso (null vuelve al real) y olvida la migración hecha. */
export function sqlParaPruebas(f: ((url: string) => Sql) | null): void {
  crearSql = f ?? sqlReal
  tablasListas = null
}

/** Error de entrada (validación antes de tocar la base): la API lo traduce a 422. */
export class ErrorEntradaEdicion extends Error {
  readonly campo: string
  constructor(campo: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorEntradaEdicion'
    this.campo = campo
  }
}

/** Tabla que no existe (42P01): en las lecturas es "no hay nada", no una falla. */
export const faltaTabla = (e: unknown): boolean =>
  (e as { code?: string })?.code === '42P01' || /relation "cj_[a-z_]+" does not exist/i.test((e as Error)?.message ?? '')

export async function consulta<T>(que: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('falta DATABASE_URL')
  const q = crearSql(url)
  let t: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new ErrorTransitorio(`la base no respondió en ${TOPE_CONSULTA_MS / 1000} s (${que})`)), TOPE_CONSULTA_MS)
  })
  try {
    return await Promise.race([fn(q), tope])
  } catch (e) {
    if (e instanceof ErrorTransitorio) throw e
    const m = (e as Error)?.message ?? ''
    if (/^Error connecting to database|^Server error \(HTTP status 5\d\d|TimeoutError|AbortError|aborted|fetch failed/i.test(m)) {
      throw new ErrorTransitorio(`la base no respondió (${que}): ${m.replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 120)}`)
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

/** Lectura: si la tabla no existe todavía, `vacio` (no crea nada). */
export async function leer<T>(que: string, vacio: T, fn: (q: Sql) => Promise<T>): Promise<T> {
  try {
    return await consulta(que, fn)
  } catch (e) {
    if (faltaTabla(e)) return vacio
    throw e
  }
}

/** Crea o pone al día las tablas (una vez por proceso). Solo desde las escrituras. */
export function asegurarTablas(): Promise<void> {
  if (!tablasListas) {
    const p: Promise<void> = consulta('migración', q => migrar(q)).then(() => undefined)
    tablasListas = p.catch(e => { tablasListas = null; throw e })
  }
  return tablasListas
}

// ── Conversión de filas (Neon devuelve bigint como texto, timestamptz como Date) ──────────────────────────────────
export const iso = (x: unknown): string => {
  if (x instanceof Date) return x.toISOString()
  if (typeof x === 'string' && x) { const t = Date.parse(x); return Number.isFinite(t) ? new Date(t).toISOString() : x }
  return ''
}
export const isoONull = (x: unknown): string | null => (x === null || x === undefined || x === '' ? null : iso(x) || null)
export const ymd = (x: unknown): string => {
  if (x instanceof Date) return x.toISOString().slice(0, 10)
  return typeof x === 'string' ? x.slice(0, 10) : ''
}
export const num = (x: unknown): number | null => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x))
export const entero = (x: unknown, porDefecto = 0): number => num(x) ?? porDefecto
export const txt = (x: unknown): string => (typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x))
export const txtONull = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null)
export const json = <T>(x: unknown, porDefecto: T): T => {
  if (x === null || x === undefined) return porDefecto
  if (typeof x === 'string') { try { return JSON.parse(x) as T } catch { return porDefecto } }
  return x as T
}
export const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map(v => String(v)) : [])
export const numeros = (x: unknown): number[] => (Array.isArray(x) ? x.map(Number).filter(Number.isFinite) : [])

/** Misma forma que ID_CLIENTE_VALIDO de lib/clientes/ficha.ts (A157, C003). Siempre se guarda en mayúsculas. */
export const ID_CRM_VALIDO = /^[A-Za-z]\d{1,6}$/
export function idCrm(x: unknown): string {
  if (typeof x !== 'string' || !ID_CRM_VALIDO.test(x.trim())) throw new ErrorEntradaEdicion('id_crm', 'ID del CRM inválido')
  return x.trim().toUpperCase()
}
export function idPositivo(x: unknown, campo = 'id'): number {
  const n = Number(x)
  if (!Number.isSafeInteger(n) || n <= 0) throw new ErrorEntradaEdicion(campo, `${campo} inválido`)
  return n
}
