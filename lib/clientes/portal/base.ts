// ── Portal del cliente en Neon (tabla cj_portal_cliente) — SOLO servidor ──────────────────────────────────────────────────
// Esquema: db/portal/2026-11-02-portal-cliente.sql (idempotente; la primera escritura lo crea solo). Una fila por cliente, siempre
// filtrada por su ID. Concurrencia optimista: cada guardado manda la versión que leyó; si otro guardó antes, se rechaza.
// Sin tabla, la lectura devuelve el portal vacío (no es una falla). Inyectable para las pruebas (usarSqlDePrueba).
import { neon } from '@neondatabase/serverless'
import { ID_PORTAL } from '@/lib/auth/portal'
import { leerDatosGuardados, PORTAL_VACIO, type DatosPortal, type PortalGuardado } from './modelo'

type Sql = (partes: TemplateStringsArray, ...valores: unknown[]) => Promise<Record<string, unknown>[]>
const TOPE_MS = 10_000
let inyectado: Sql | null = null
/** Solo para pruebas: un Neon falso. */
export function usarSqlDePrueba(s: Sql | null) { inyectado = s; tablaLista = false }

export const basePortalConfigurada = (): boolean => !!inyectado || !!process.env.DATABASE_URL?.trim()
const sql = (): Sql => inyectado ?? (neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(TOPE_MS) } }) as unknown as Sql)
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /cj_portal_cliente" does not exist/i.test((e as Error)?.message ?? '')
const yaExiste = (e: unknown) => ['23505', '42P07'].includes((e as { code?: string })?.code ?? '')
const fechaIso = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : typeof x === 'string' && x ? x : null)

const idValido = (id: string): string => {
  if (!ID_PORTAL.test(id)) throw new Error('ID de cliente inválido')
  return id.toUpperCase()
}

let tablaLista = false
async function asegurarTabla(q: Sql): Promise<void> {
  if (tablaLista) return
  try {
    await q`CREATE TABLE IF NOT EXISTS cj_portal_cliente (
      id_crm text PRIMARY KEY CHECK (id_crm ~ '^[A-Z][0-9]{1,6}$'), datos jsonb NOT NULL DEFAULT '{}'::jsonb,
      version integer NOT NULL DEFAULT 1 CHECK (version >= 1), quien text NOT NULL DEFAULT '',
      creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now())`
  } catch (e) { if (!yaExiste(e)) throw e }
  tablaLista = true
}

/** El portal de UN cliente. Sin fila (o sin tabla): vacío, versión 0. */
export async function leerPortal(idCrudo: string): Promise<PortalGuardado> {
  const id = idValido(idCrudo)
  if (!basePortalConfigurada()) return { datos: PORTAL_VACIO, version: 0, actualizado: null }
  try {
    const filas = await sql()`SELECT datos, version, actualizado FROM cj_portal_cliente WHERE id_crm = ${id}`
    const f = filas[0]
    if (!f) return { datos: PORTAL_VACIO, version: 0, actualizado: null }
    return { datos: leerDatosGuardados(f.datos), version: Number(f.version) || 0, actualizado: fechaIso(f.actualizado) }
  } catch (e) {
    if (faltaTabla(e)) return { datos: PORTAL_VACIO, version: 0, actualizado: null }
    throw e
  }
}

/** IDs que ya tienen portal armado (para el acceso «Portal del cliente» en la Cartera). Nunca lanza: ante una falla, ninguno. */
export async function idsConPortal(): Promise<Set<string>> {
  if (!basePortalConfigurada()) return new Set()
  try {
    return new Set((await sql()`SELECT id_crm FROM cj_portal_cliente`).map(f => String(f.id_crm).toUpperCase()))
  } catch {
    return new Set()
  }
}

export type ResultadoGuardar = { ok: true; version: number; actualizado: string | null } | { ok: false; conflicto: true; version: number }

/**
 * Guarda el portal de UN cliente si nadie lo cambió desde `versionLeida` (0 = todavía no existe). Los datos ya vienen validados
 * (validarDatosPortal). `quien` = nombre corto de quien guarda (sin mails).
 */
export async function guardarPortal(idCrudo: string, datos: DatosPortal, versionLeida: number, quien: string): Promise<ResultadoGuardar> {
  const id = idValido(idCrudo)
  if (!Number.isInteger(versionLeida) || versionLeida < 0) throw new Error('versión inválida')
  const q = sql()
  await asegurarTabla(q)
  const json = JSON.stringify(datos)
  const nombre = quien.slice(0, 60)
  const filas = versionLeida === 0
    ? await q`INSERT INTO cj_portal_cliente (id_crm, datos, version, quien) VALUES (${id}, ${json}::jsonb, 1, ${nombre})
        ON CONFLICT (id_crm) DO NOTHING RETURNING version, actualizado`
    : await q`UPDATE cj_portal_cliente SET datos = ${json}::jsonb, version = version + 1, quien = ${nombre}, actualizado = now()
        WHERE id_crm = ${id} AND version = ${versionLeida} RETURNING version, actualizado`
  if (filas[0]) return { ok: true, version: Number(filas[0].version), actualizado: fechaIso(filas[0].actualizado) }
  const actual = await q`SELECT version FROM cj_portal_cliente WHERE id_crm = ${id}`
  return { ok: false, conflicto: true, version: Number(actual[0]?.version) || 0 }
}

/**
 * Portales armados con su título (datos.nombre; vacío si no tiene), para las pestañas del hub Clientes (2/11/2026). Ordenados por
 * creación. Nunca lanza: ante una falla, ninguno (las pestañas de siempre salen igual).
 */
export async function portalesArmados(): Promise<{ id: string; titulo: string }[]> {
  if (!basePortalConfigurada()) return []
  try {
    const filas = await sql()`SELECT id_crm, COALESCE(datos->>'nombre', '') AS titulo FROM cj_portal_cliente ORDER BY creado, id_crm`
    return filas.map(f => ({ id: String(f.id_crm).toUpperCase(), titulo: String(f.titulo ?? '').trim().slice(0, 80) }))
  } catch {
    return []
  }
}
