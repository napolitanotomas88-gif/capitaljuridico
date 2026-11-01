// ── Base de Finanzas SKWD en Neon (esquemas finanzas y finanzas_priv; migrada desde Supabase el 1/11/2026) ──────────────
// Decisión de Tomás (1/11): «no lo vamos a usar más [Supabase], migramos todo». Los datos viven en la misma base del
// Despacho (DATABASE_URL); la estructura está en db/finanzas/estructura.sql. Las pantallas siguen escribiendo como con
// supabase-js (components/finanzas/skwd/supabase.js arma el pedido) y acá se traduce a SQL:
//   · cada pedido corre en una transacción con el rol finanzas_app y el correo de la sesión en request.jwt.claims, así los
//     permisos (RLS) y los triggers que firman con el correo (finanzas_priv.jwt()) funcionan igual que en Supabase;
//   · tablas y columnas solo de la lista blanca / identificadores simples; los valores van siempre como parámetros;
//   · la respuesta sale como JSON de Postgres (números como números, fechas como texto), igual que la de PostgREST.
// Solo servidor.
import { neon } from '@neondatabase/serverless'

export const TABLAS_FINANZAS = [
  'campos_corregibles', 'conciliaciones', 'correcciones', 'cuentas', 'estado_parametros', 'estado_referencia_excel', 'gastos',
  'gastos_personales', 'movimientos_cuenta', 'pago_quien_recibio', 'pagos', 'pagos_equipo', 'pagos_equipo_sensibles', 'personas',
  'personas_sensibles', 'personas_sensibles_historial', 'vocabularios_correccion',
  // vistas
  'correcciones_vigentes', 'correcciones_por_registro', 'gastos_vigentes', 'movimientos_cuenta_vigentes', 'movimientos_cuenta_empresa',
  'pagos_equipo_vigentes', 'pagos_vigentes',
] as const

/** Clave primaria de cada tabla (para upsert sin onConflict). */
const CLAVES: Record<string, string[]> = {
  campos_corregibles: ['tabla', 'campo'], estado_parametros: ['anio'], estado_referencia_excel: ['anio', 'mes'],
  pago_quien_recibio: ['pago_id'], pagos_equipo_sensibles: ['pago_equipo_id'], personas_sensibles: ['persona_id'],
  vocabularios_correccion: ['tabla', 'campo', 'valor'],
}

export type Filtro = [op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is', columna: string, valor: unknown]
export interface Pedido {
  tabla: string
  accion: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  columnas?: string | null          // select(...) o returning; null = sin returning
  filtros?: Filtro[]
  orden?: [columna: string, ascendente: boolean][]
  limite?: number | null
  datos?: Record<string, unknown> | Record<string, unknown>[]
  enConflicto?: string | null
  uno?: 'single' | 'maybeSingle' | null
}

export class ErrorPedido extends Error {
  readonly code: string
  constructor(mensaje: string, code = 'PEDIDO') { super(mensaje); this.name = 'ErrorPedido'; this.code = code }
}

const ID = /^[a-z_][a-z0-9_]*$/
const ident = (s: string): string => {
  if (!ID.test(s)) throw new ErrorPedido(`Nombre no válido: ${s}`)
  return `"${s}"`
}
const lista = (cols: string): string => {
  const c = cols.split(',').map((x) => x.trim()).filter(Boolean)
  if (c.length === 1 && c[0] === '*') return '*'
  return c.map(ident).join(', ')
}

/** Traduce el pedido a una consulta que devuelve una sola fila con la columna `filas` (JSON). Exportada para los tests. */
export function armarConsulta(p: Pedido): { texto: string; params: unknown[] } {
  if (!(TABLAS_FINANZAS as readonly string[]).includes(p.tabla)) throw new ErrorPedido(`Tabla desconocida: ${p.tabla}`)
  const t = `finanzas.${ident(p.tabla)}`
  const params: unknown[] = []
  const par = (v: unknown) => { params.push(v); return `$${params.length}` }
  const where = (p.filtros ?? []).map(([op, col, v]) => {
    const c = ident(col)
    switch (op) {
      case 'eq': return `${c} = ${par(v)}`
      case 'neq': return `${c} <> ${par(v)}`
      case 'gt': return `${c} > ${par(v)}`
      case 'gte': return `${c} >= ${par(v)}`
      case 'lt': return `${c} < ${par(v)}`
      case 'lte': return `${c} <= ${par(v)}`
      case 'in': if (!Array.isArray(v)) throw new ErrorPedido('in() necesita una lista'); return `${c} = any(${par(v)})`
      case 'is': if (v !== null && v !== true && v !== false) throw new ErrorPedido('is() solo acepta null, true o false'); return `${c} is ${v === null ? 'null' : String(v)}`
      default: throw new ErrorPedido(`Filtro desconocido: ${String(op)}`)
    }
  })
  const W = where.length ? ` where ${where.join(' and ')}` : ''
  const devolver = p.columnas == null ? null : lista(p.columnas || '*')
  const envolver = (q: string) => `with r as (${q}) select coalesce(json_agg(r), '[]'::json) as filas from r`

  if (p.accion === 'select') {
    const O = p.orden?.length ? ` order by ${p.orden.map(([c, asc]) => `${ident(c)} ${asc ? 'asc' : 'desc'}`).join(', ')}` : ''
    const L = p.limite != null ? ` limit ${Math.max(0, Math.floor(Number(p.limite)))}` : ''
    return { texto: envolver(`select ${devolver ?? '*'} from ${t}${W}${O}${L}`), params }
  }
  const R = devolver ? ` returning ${devolver}` : ''
  const fin = (q: string) => (devolver ? envolver(q) : `with r as (${q}) select null::json as filas`)
  if (p.accion === 'delete') {
    if (!where.length) throw new ErrorPedido('Borrar sin filtro no está permitido')
    return { texto: fin(`delete from ${t}${W}${R}`), params }
  }
  const filas = Array.isArray(p.datos) ? p.datos : p.datos ? [p.datos] : []
  if (!filas.length) throw new ErrorPedido('Faltan los datos')
  const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))].map(ident)
  if (p.accion === 'update') {
    if (!where.length) throw new ErrorPedido('Modificar sin filtro no está permitido')
    if (filas.length !== 1) throw new ErrorPedido('update() recibe un solo objeto')
    const fuente = `(select ${cols.join(', ')} from json_populate_record(null::${t}, ${par(JSON.stringify(filas[0]))}::json))`
    return { texto: fin(`update ${t} set (${cols.join(', ')}) = ${fuente}${W}${R}`), params }
  }
  // insert / upsert
  let q = `insert into ${t} (${cols.join(', ')}) select ${cols.join(', ')} from json_populate_recordset(null::${t}, ${par(JSON.stringify(filas))}::json)`
  if (p.accion === 'upsert') {
    const conflicto = (p.enConflicto ? p.enConflicto.split(',').map((x) => x.trim()) : CLAVES[p.tabla] ?? ['id']).map(ident)
    const resto = cols.filter((c) => !conflicto.includes(c))
    q += ` on conflict (${conflicto.join(', ')}) do ${resto.length ? `update set ${resto.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'nothing'}`
  } else if (p.accion !== 'insert') throw new ErrorPedido(`Acción desconocida: ${String(p.accion)}`)
  return { texto: fin(q + R), params }
}

/** Respuesta con la forma de supabase-js: { data, error }. */
export interface Respuesta { data: unknown; error: { message: string; code: string } | null }

type Ejecutar = (consultas: { texto: string; params: unknown[] }[]) => Promise<unknown[][]>

const ejecutarNeon: Ejecutar = async (consultas) => {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new ErrorPedido('Falta DATABASE_URL', 'SIN_BASE')
  const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(20_000) } })
  return (await sql.transaction(consultas.map((c) => sql.query(c.texto, c.params)))) as unknown[][]
}

/** Corre el pedido con el rol de la app y el correo de la sesión (los permisos y triggers de la base lo leen). */
export async function correrPedido(p: Pedido, correo: string, ejecutar: Ejecutar = ejecutarNeon): Promise<Respuesta> {
  try {
    const q = armarConsulta(p)
    const res = await ejecutar([
      { texto: 'set local role finanzas_app', params: [] },
      { texto: "select set_config('request.jwt.claims', $1, true)", params: [JSON.stringify({ email: correo, role: 'authenticated' })] },
      q,
    ])
    const filas = (res.at(-1)?.[0] as { filas: unknown } | undefined)?.filas ?? null
    if (!p.uno) return { data: filas, error: null }
    const lista = Array.isArray(filas) ? filas : []
    if (lista.length === 1) return { data: lista[0], error: null }
    if (lista.length === 0 && p.uno === 'maybeSingle') return { data: null, error: null }
    return { data: null, error: { message: `Se esperaba una fila y hubo ${lista.length}`, code: 'PGRST116' } }
  } catch (e) {
    const err = e as { message?: string; code?: string }
    return { data: null, error: { message: err.message ?? String(e), code: err.code ?? 'ERROR' } }
  }
}
