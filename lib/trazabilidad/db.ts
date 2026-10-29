// ── Base de Trazabilidad (Neon, la misma DATABASE_URL que Cuotas y Fathom) ─────────────────────
// Tablas (se crean solas la primera vez):
//   cj_traz_setting   un envío de la botonera por contacto de ManyChat (se pisa al reenviar). "manual:<clave>" = pegado a mano.
//   cj_traz_llamada   resumen + análisis de la llamada de venta de cada cierre (clave del cierre).
//   cj_traz_vinculo   vínculo manual cierre → envío de la botonera ('' = "este cierre no tiene chat").
//   cj_traz_piezas    etiqueta de ManyChat (pieza de contenido) → ángulo. origen 'ia' (propuesto) o 'manual' (manda).
//   cj_traz_angulos   catálogo de ángulos (semilla en catalogo.ts).
//   cj_traz_conceptos concepto de anuncio (video) con su formato y ángulo (3 clasificadores, mayoría) y el gasto en Meta.
//   cj_traz_anuncios  nombre de anuncio normalizado (claveAnuncio) o id de Meta → concepto: cruza la columna Video del CRM.
import 'server-only'
import { neon } from '@neondatabase/serverless'
import { ANGULOS_SEMILLA, type Angulo, type Bolsa } from './catalogo'
import type { AnalisisLlamada, AnalisisSetting, FilaLlamada, FilaSetting, TipoPieza } from './modelo'

export function configurada(): boolean {
  return !!process.env.DATABASE_URL?.trim()
}
function sql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('La base de datos todavía no está conectada (DATABASE_URL).')
  return neon(url)
}

let lista: Promise<void> | null = null
export function asegurarTablas(): Promise<void> {
  lista ??= (async () => {
    const q = sql()
    await q`CREATE TABLE IF NOT EXISTS cj_traz_setting (
      subscriber_id text PRIMARY KEY,
      nombre text NOT NULL DEFAULT '',
      ig_usuario text NOT NULL DEFAULT '',
      telefono text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT '',
      etiquetas jsonb NOT NULL DEFAULT '[]',
      campos jsonb NOT NULL DEFAULT '{}',
      resumen text NOT NULL DEFAULT '',
      transcript text NOT NULL DEFAULT '',
      analisis jsonb,
      error text,
      enviado_por text NOT NULL DEFAULT '',
      creado timestamptz NOT NULL DEFAULT now(),
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_traz_llamada (
      clave text PRIMARY KEY,
      url text NOT NULL DEFAULT '',
      resumen text NOT NULL DEFAULT '',
      transcript text NOT NULL DEFAULT '',
      analisis jsonb,
      error text,
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_traz_vinculo (
      clave text PRIMARY KEY,
      subscriber_id text NOT NULL,
      por text NOT NULL DEFAULT '',
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_traz_piezas (
      etiqueta text PRIMARY KEY,
      angulo text,
      tipo text NOT NULL DEFAULT 'otro',
      origen text NOT NULL DEFAULT 'ia',
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_traz_angulos (
      id text PRIMARY KEY,
      nombre text NOT NULL,
      descripcion text NOT NULL DEFAULT '',
      bolsa text,
      descartado boolean NOT NULL DEFAULT false,
      orden int NOT NULL DEFAULT 0
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_traz_conceptos (
      clave text PRIMARY KEY,
      formato text NOT NULL,
      angulo text,
      angulo_secundario text,
      caso_nombrado boolean NOT NULL DEFAULT false,
      quien_habla text,
      gancho text NOT NULL DEFAULT '',
      certeza text NOT NULL DEFAULT 'solo_nombre',
      acuerdo int NOT NULL DEFAULT 0,
      ligas text[] NOT NULL DEFAULT '{}',
      gasto numeric NOT NULL DEFAULT 0,
      gasto_al date,
      actualizado timestamptz NOT NULL DEFAULT now()
    )`
    await q`CREATE TABLE IF NOT EXISTS cj_traz_anuncios (
      clave_anuncio text PRIMARY KEY,
      concepto text NOT NULL
    )`
    const hay = await q`SELECT count(*)::int AS n FROM cj_traz_angulos`
    if (!hay[0]?.n) {
      for (const [i, a] of ANGULOS_SEMILLA.entries()) {
        await q`INSERT INTO cj_traz_angulos (id, nombre, descripcion, bolsa, descartado, orden) VALUES (${a.id}, ${a.nombre}, ${a.descripcion}, ${a.bolsa}, ${a.descartado}, ${i}) ON CONFLICT (id) DO NOTHING`
      }
    }
  })().catch((e) => {
    lista = null
    throw e
  })
  return lista
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''))

// ── Setting ───────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
const filaSetting = (r: Row): FilaSetting => ({
  subscriberId: String(r.subscriber_id), nombre: String(r.nombre ?? ''), igUsuario: String(r.ig_usuario ?? ''),
  telefono: String(r.telefono ?? ''), email: String(r.email ?? ''),
  etiquetas: Array.isArray(r.etiquetas) ? (r.etiquetas as unknown[]).map(String) : [],
  resumen: String(r.resumen ?? ''), analisis: (r.analisis as AnalisisSetting | null) ?? null, error: (r.error as string | null) ?? null,
  enviadoPor: String(r.enviado_por ?? ''), creado: iso(r.creado), actualizado: iso(r.actualizado),
})

export async function listarSetting(): Promise<FilaSetting[]> {
  await asegurarTablas()
  const filas = await sql()`SELECT subscriber_id, nombre, ig_usuario, telefono, email, etiquetas, resumen, analisis, error, enviado_por, creado, actualizado FROM cj_traz_setting ORDER BY actualizado DESC`
  return filas.map(filaSetting)
}

export async function obtenerSetting(id: string): Promise<(FilaSetting & { transcript: string; campos: Record<string, unknown> }) | null> {
  await asegurarTablas()
  const f = await sql()`SELECT * FROM cj_traz_setting WHERE subscriber_id = ${id}`
  return f.length ? { ...filaSetting(f[0]), transcript: String(f[0].transcript ?? ''), campos: (f[0].campos as Record<string, unknown>) ?? {} } : null
}

export interface EnvioBotonera {
  subscriberId: string; nombre: string; igUsuario: string; telefono: string; email: string
  etiquetas: string[]; campos: Record<string, unknown>; resumen: string; transcript: string; enviadoPor: string
}
export async function guardarSetting(e: EnvioBotonera): Promise<void> {
  await asegurarTablas()
  await sql()`INSERT INTO cj_traz_setting (subscriber_id, nombre, ig_usuario, telefono, email, etiquetas, campos, resumen, transcript, enviado_por, analisis, error)
    VALUES (${e.subscriberId}, ${e.nombre}, ${e.igUsuario}, ${e.telefono}, ${e.email}, ${JSON.stringify(e.etiquetas)}::jsonb, ${JSON.stringify(e.campos)}::jsonb, ${e.resumen}, ${e.transcript}, ${e.enviadoPor}, NULL, NULL)
    ON CONFLICT (subscriber_id) DO UPDATE SET nombre = EXCLUDED.nombre, ig_usuario = EXCLUDED.ig_usuario, telefono = EXCLUDED.telefono, email = EXCLUDED.email,
      etiquetas = EXCLUDED.etiquetas, campos = EXCLUDED.campos, resumen = EXCLUDED.resumen, transcript = EXCLUDED.transcript, enviado_por = EXCLUDED.enviado_por,
      analisis = NULL, error = NULL, actualizado = now()`
}

export async function guardarAnalisisSetting(id: string, analisis: AnalisisSetting | null, error: string | null): Promise<void> {
  await sql()`UPDATE cj_traz_setting SET analisis = ${analisis ? JSON.stringify(analisis) : null}::jsonb, error = ${error}, actualizado = now() WHERE subscriber_id = ${id}`
}

// ── Llamadas ──────────────────────────────────────────────────────────────────────────────
const filaLlamada = (r: Row): FilaLlamada => ({
  clave: String(r.clave), url: String(r.url ?? ''), resumen: String(r.resumen ?? ''),
  analisis: (r.analisis as AnalisisLlamada | null) ?? null, error: (r.error as string | null) ?? null, actualizado: iso(r.actualizado),
})
export async function listarLlamadas(): Promise<FilaLlamada[]> {
  await asegurarTablas()
  return (await sql()`SELECT clave, url, resumen, analisis, error, actualizado FROM cj_traz_llamada`).map(filaLlamada)
}
export async function guardarLlamada(clave: string, datos: { url: string; resumen: string; transcript: string; analisis: AnalisisLlamada | null; error: string | null }): Promise<void> {
  await asegurarTablas()
  await sql()`INSERT INTO cj_traz_llamada (clave, url, resumen, transcript, analisis, error) VALUES (${clave}, ${datos.url}, ${datos.resumen}, ${datos.transcript}, ${datos.analisis ? JSON.stringify(datos.analisis) : null}::jsonb, ${datos.error})
    ON CONFLICT (clave) DO UPDATE SET url = EXCLUDED.url, resumen = EXCLUDED.resumen, transcript = EXCLUDED.transcript, analisis = EXCLUDED.analisis, error = EXCLUDED.error, actualizado = now()`
}
export async function obtenerLlamada(clave: string): Promise<(FilaLlamada & { transcript: string }) | null> {
  await asegurarTablas()
  const f = await sql()`SELECT * FROM cj_traz_llamada WHERE clave = ${clave}`
  return f.length ? { ...filaLlamada(f[0]), transcript: String(f[0].transcript ?? '') } : null
}

// ── Vínculos manuales ─────────────────────────────────────────────────────────────────────
export async function listarVinculos(): Promise<Map<string, string>> {
  await asegurarTablas()
  return new Map((await sql()`SELECT clave, subscriber_id FROM cj_traz_vinculo`).map((r) => [String(r.clave), String(r.subscriber_id)]))
}
export async function guardarVinculo(clave: string, subscriberId: string | null, por: string): Promise<void> {
  await asegurarTablas()
  if (subscriberId === null) await sql()`DELETE FROM cj_traz_vinculo WHERE clave = ${clave}`
  else await sql()`INSERT INTO cj_traz_vinculo (clave, subscriber_id, por) VALUES (${clave}, ${subscriberId}, ${por}) ON CONFLICT (clave) DO UPDATE SET subscriber_id = EXCLUDED.subscriber_id, por = EXCLUDED.por, actualizado = now()`
}

// ── Catálogo ──────────────────────────────────────────────────────────────────────────────
export async function listarAngulos(): Promise<Angulo[]> {
  await asegurarTablas()
  return (await sql()`SELECT id, nombre, descripcion, bolsa, descartado FROM cj_traz_angulos ORDER BY orden, nombre`).map((r) => ({
    id: String(r.id), nombre: String(r.nombre), descripcion: String(r.descripcion ?? ''), bolsa: (r.bolsa as Bolsa | null) ?? null, descartado: !!r.descartado,
  }))
}
export async function guardarAngulo(a: Angulo): Promise<void> {
  await asegurarTablas()
  await sql()`INSERT INTO cj_traz_angulos (id, nombre, descripcion, bolsa, descartado, orden) VALUES (${a.id}, ${a.nombre}, ${a.descripcion}, ${a.bolsa}, ${a.descartado}, 999)
    ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, bolsa = EXCLUDED.bolsa, descartado = EXCLUDED.descartado`
}

export interface Pieza { etiqueta: string; angulo: string | null; tipo: TipoPieza; origen: 'ia' | 'manual' }
export async function listarPiezas(): Promise<Map<string, Pieza>> {
  await asegurarTablas()
  return new Map((await sql()`SELECT etiqueta, angulo, tipo, origen FROM cj_traz_piezas`).map((r) => [String(r.etiqueta), {
    etiqueta: String(r.etiqueta), angulo: (r.angulo as string | null) ?? null, tipo: String(r.tipo) as TipoPieza, origen: r.origen === 'manual' ? 'manual' : 'ia',
  }]))
}
/** La IA solo propone: nunca pisa una pieza que alguien asignó a mano */
export async function proponerPieza(p: Omit<Pieza, 'origen'>): Promise<void> {
  await asegurarTablas()
  await sql()`INSERT INTO cj_traz_piezas (etiqueta, angulo, tipo, origen) VALUES (${p.etiqueta}, ${p.angulo}, ${p.tipo}, 'ia')
    ON CONFLICT (etiqueta) DO UPDATE SET angulo = EXCLUDED.angulo, tipo = EXCLUDED.tipo, actualizado = now() WHERE cj_traz_piezas.origen = 'ia' AND cj_traz_piezas.angulo IS NULL`
}
export async function asignarPieza(etiqueta: string, angulo: string | null, tipo: TipoPieza): Promise<void> {
  await asegurarTablas()
  await sql()`INSERT INTO cj_traz_piezas (etiqueta, angulo, tipo, origen) VALUES (${etiqueta}, ${angulo}, ${tipo}, 'manual')
    ON CONFLICT (etiqueta) DO UPDATE SET angulo = EXCLUDED.angulo, tipo = EXCLUDED.tipo, origen = 'manual', actualizado = now()`
}

// ── Conceptos de anuncios (formato × ángulo) ──────────────────────────────────────────────
export interface ConceptoAnuncio {
  clave: string; formato: string; angulo: string | null; anguloSecundario: string | null; casoNombrado: boolean
  quienHabla: string | null; gancho: string; certeza: string; acuerdo: number; ligas: string[]; gasto: number; gastoAl: string | null
}
export async function listarConceptos(): Promise<{ conceptos: ConceptoAnuncio[]; anuncios: Map<string, string> }> {
  await asegurarTablas()
  const [c, a] = await Promise.all([sql()`SELECT * FROM cj_traz_conceptos`, sql()`SELECT clave_anuncio, concepto FROM cj_traz_anuncios`])
  return {
    conceptos: c.map((r) => ({
      clave: String(r.clave), formato: String(r.formato), angulo: (r.angulo as string | null) ?? null, anguloSecundario: (r.angulo_secundario as string | null) ?? null,
      casoNombrado: !!r.caso_nombrado, quienHabla: (r.quien_habla as string | null) ?? null, gancho: String(r.gancho ?? ''), certeza: String(r.certeza ?? ''),
      acuerdo: Number(r.acuerdo ?? 0), ligas: (r.ligas as string[]) ?? [], gasto: Number(r.gasto ?? 0), gastoAl: r.gasto_al ? iso(r.gasto_al).slice(0, 10) : null,
    })),
    anuncios: new Map(a.map((r) => [String(r.clave_anuncio), String(r.concepto)])),
  }
}
