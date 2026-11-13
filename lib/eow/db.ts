// ── Reporte EOW en Neon (13/11/2026). SOLO servidor ─────────────────────────────────────────────────────────────────────
// Tablas propias, independientes (editar el EOW no toca ninguna otra tabla del Despacho). Se crean solas (idempotente) con
// asegurarTablasEow(), la misma función que usa el importador del historial (scripts/eow-importar.mjs):
//   · cj_eow_reportes: una fila por semana (fecha del reporte), data jsonb {filas, tarjetas}, version (control optimista,
//     como cj_cuotas_planes: se guarda solo si nadie guardó antes), actualizado y actualizado_por (nombre, sin mail).
//   · cj_eow_historial: quién cambió qué y cuándo (líneas cortas de resumirCambios; nunca el texto entero).
//   · cj_eow_avisos: el aviso de Discord de los recién lanzados, uno por semana (no se repite).
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { copiarSemana, datosVacios, resumirCambios, validarDatos, type DatosEow, type ReporteEow } from './modelo'

type Q = NeonQueryFunction<false, false>
export const baseEowConfigurada = (): boolean => !!process.env.DATABASE_URL?.trim()
const conectar = (url = process.env.DATABASE_URL?.trim() ?? '', tope = 10_000): Q => {
  if (!url) throw new Error('Falta DATABASE_URL')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(tope) } })
}

let listas = false
export async function asegurarTablasEow(q: Q = conectar()): Promise<void> {
  if (listas) return
  await q`CREATE TABLE IF NOT EXISTS cj_eow_reportes (
    semana date PRIMARY KEY, data jsonb NOT NULL, version int NOT NULL DEFAULT 1,
    creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now(), actualizado_por text)`
  await q`CREATE TABLE IF NOT EXISTS cj_eow_historial (
    id bigserial PRIMARY KEY, semana date NOT NULL, quien text NOT NULL, cuando timestamptz NOT NULL DEFAULT now(),
    version int, cambios jsonb NOT NULL DEFAULT '[]'::jsonb)`
  await q`CREATE INDEX IF NOT EXISTS cj_eow_historial_semana ON cj_eow_historial (semana, cuando DESC)`
  await q`CREATE TABLE IF NOT EXISTS cj_eow_avisos (
    semana date PRIMARY KEY, nombres jsonb NOT NULL DEFAULT '[]'::jsonb, estado text NOT NULL, cuando timestamptz NOT NULL DEFAULT now())`
  listas = true
}

const iso = (x: unknown): string | null => {
  if (!x) return null
  const d = x instanceof Date ? x : new Date(String(x))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function aReporte(f: Record<string, unknown>): ReporteEow {
  const v = validarDatos(f.data)
  const datos: DatosEow = v.ok ? v.datos : datosVacios()
  return { semana: String(f.semana), ...datos, version: Number(f.version), actualizado: iso(f.actualizado), actualizadoPor: f.actualizado_por ? String(f.actualizado_por) : null }
}

/** Las semanas que hay, de la más nueva a la más vieja. */
export async function listarSemanas(): Promise<string[]> {
  const q = conectar()
  await asegurarTablasEow(q)
  const filas = (await q`SELECT semana::text AS semana FROM cj_eow_reportes ORDER BY semana DESC`) as { semana: string }[]
  return filas.map((f) => f.semana)
}

export async function leerReporte(semana: string): Promise<ReporteEow | null> {
  const q = conectar()
  await asegurarTablasEow(q)
  const filas = (await q`SELECT semana::text AS semana, data, version, actualizado, actualizado_por FROM cj_eow_reportes WHERE semana = ${semana}::date`) as Record<string, unknown>[]
  return filas.length ? aReporte(filas[0]) : null
}

/** El reporte más nuevo anterior a `semana` (o el más nuevo de todos, sin semana). */
export async function reporteAnterior(semana?: string): Promise<ReporteEow | null> {
  const q = conectar()
  await asegurarTablasEow(q)
  const filas = (semana
    ? await q`SELECT semana::text AS semana, data, version, actualizado, actualizado_por FROM cj_eow_reportes WHERE semana < ${semana}::date ORDER BY semana DESC LIMIT 1`
    : await q`SELECT semana::text AS semana, data, version, actualizado, actualizado_por FROM cj_eow_reportes ORDER BY semana DESC LIMIT 1`) as Record<string, unknown>[]
  return filas.length ? aReporte(filas[0]) : null
}

/** Crea el reporte de una semana (si ya existe no lo toca: devuelve false). */
export async function crearReporte(semana: string, datos: DatosEow, quien: string, q: Q = conectar()): Promise<boolean> {
  await asegurarTablasEow(q)
  const r = await q`INSERT INTO cj_eow_reportes (semana, data, actualizado_por) VALUES (${semana}::date, ${JSON.stringify(datos)}::jsonb, ${quien})
    ON CONFLICT (semana) DO NOTHING RETURNING version`
  if (!r.length) return false
  await q`INSERT INTO cj_eow_historial (semana, quien, version, cambios) VALUES (${semana}::date, ${quien}, 1, ${JSON.stringify(['Reporte creado'])}::jsonb)`
  return true
}

/** «Nueva semana»: crea `semana` copiando la anterior. Si ya existía, la deja como está. */
export async function nuevaSemana(semana: string, quien: string): Promise<{ creada: boolean; reporte: ReporteEow | null }> {
  const anterior = await reporteAnterior(semana)
  const creada = await crearReporte(semana, copiarSemana(anterior, 'n'), quien)
  return { creada, reporte: await leerReporte(semana) }
}

export type ResultadoGuardar = { ok: true; version: number; actualizado: string | null } | { ok: false; version: number | null }

/** Guarda con control de versión: solo si la versión en la base es la que leyó la pantalla. Registra los cambios. */
export async function guardarReporte(semana: string, datos: DatosEow, version: number, quien: string): Promise<ResultadoGuardar> {
  const q = conectar()
  await asegurarTablasEow(q)
  const antes = (await q`SELECT data, version FROM cj_eow_reportes WHERE semana = ${semana}::date`) as { data: unknown; version: number }[]
  if (!antes.length) return { ok: false, version: null }
  if (Number(antes[0].version) !== version) return { ok: false, version: Number(antes[0].version) }
  const previo = validarDatos(antes[0].data)
  const cambios = resumirCambios(previo.ok ? previo.datos : null, datos)
  const r = (await q`UPDATE cj_eow_reportes SET data = ${JSON.stringify(datos)}::jsonb, version = version + 1, actualizado = now(), actualizado_por = ${quien}
    WHERE semana = ${semana}::date AND version = ${version} RETURNING version, actualizado`) as { version: number; actualizado: unknown }[]
  if (!r.length) {
    const ahora = (await q`SELECT version FROM cj_eow_reportes WHERE semana = ${semana}::date`) as { version: number }[]
    return { ok: false, version: ahora.length ? Number(ahora[0].version) : null }
  }
  if (cambios.length) await q`INSERT INTO cj_eow_historial (semana, quien, version, cambios) VALUES (${semana}::date, ${quien}, ${Number(r[0].version)}, ${JSON.stringify(cambios.slice(0, 80))}::jsonb)`
  return { ok: true, version: Number(r[0].version), actualizado: iso(r[0].actualizado) }
}

export interface EntradaHistorial { quien: string; cuando: string | null; version: number | null; cambios: string[] }
export async function historialSemana(semana: string, n = 30): Promise<EntradaHistorial[]> {
  const q = conectar()
  await asegurarTablasEow(q)
  const filas = (await q`SELECT quien, cuando, version, cambios FROM cj_eow_historial WHERE semana = ${semana}::date ORDER BY cuando DESC, id DESC LIMIT ${Math.min(100, Math.max(1, n))}`) as Record<string, unknown>[]
  return filas.map((f) => ({ quien: String(f.quien), cuando: iso(f.cuando), version: f.version === null ? null : Number(f.version), cambios: Array.isArray(f.cambios) ? (f.cambios as unknown[]).map(String) : [] }))
}

// ── Avisos de recién lanzados: uno por semana ──
/** Reserva el aviso de la semana. false = ya estaba (no se repite). */
export async function reservarAviso(semana: string, nombres: string[]): Promise<boolean> {
  const q = conectar()
  await asegurarTablasEow(q)
  const r = await q`INSERT INTO cj_eow_avisos (semana, nombres, estado) VALUES (${semana}::date, ${JSON.stringify(nombres)}::jsonb, 'anotado')
    ON CONFLICT (semana) DO UPDATE SET nombres = EXCLUDED.nombres, estado = 'anotado', cuando = now() WHERE cj_eow_avisos.estado IN ('error', 'sin_webhook')
    RETURNING semana`
  return r.length > 0
}
export async function cerrarAviso(semana: string, estado: string): Promise<void> {
  const q = conectar()
  await q`UPDATE cj_eow_avisos SET estado = ${estado}, cuando = now() WHERE semana = ${semana}::date`
}

/** Para el sistema (cron): agrega filas sin ubicar al reporte de la semana con control de versión (reintenta 3 veces). */
export async function agregarRecienLanzados(semana: string, agregar: (datos: DatosEow) => DatosEow, quien: string): Promise<{ ok: boolean; creado: boolean }> {
  let creado = false
  if (!(await leerReporte(semana))) creado = (await nuevaSemana(semana, quien)).creada
  for (let i = 0; i < 3; i++) {
    const r = await leerReporte(semana)
    if (!r) return { ok: false, creado }
    const datos = agregar({ filas: r.filas, tarjetas: r.tarjetas })
    if (datos.filas.length === r.filas.length) return { ok: true, creado }
    const g = await guardarReporte(semana, datos, r.version, quien)
    if (g.ok) return { ok: true, creado }
  }
  return { ok: false, creado }
}
