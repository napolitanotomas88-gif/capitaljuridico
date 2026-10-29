// ── Docs "Guiones - X" ya leídos (Neon: cj_grab_guiones) ──────────────────────────────────────────────────────────
// Se guarda lo último que se leyó de cada doc (los guiones con su estado del chip y su huella). La PRIMERA lectura de un
// doc es la línea de base: los guiones se guardan como vistos y no crean videos (salvo los que coinciden con lo importado
// de ClickUp); después, solo crea video el guion que PASA a "Para grabar" (comparando con lo guardado acá).
import type { DocGuiones, IdCrm } from '../tipos'
import { asegurarTablas, consulta, idCrm, leer, type Fila } from './base'
import { aDoc } from './filas'

export async function leerDoc(id_crm: IdCrm): Promise<DocGuiones | null> {
  const id = idCrm(id_crm)
  const [f] = await leer('leer doc de guiones', [] as Fila[], q => q`SELECT * FROM cj_grab_guiones WHERE id_crm = ${id} ORDER BY leido DESC LIMIT 1` as Promise<Fila[]>)
  return f ? aDoc(f) : null
}

export async function leerDocPorId(doc_id: string): Promise<DocGuiones | null> {
  if (typeof doc_id !== 'string' || !doc_id) return null
  const [f] = await leer('leer doc por id', [] as Fila[], q => q`SELECT * FROM cj_grab_guiones WHERE doc_id = ${doc_id}` as Promise<Fila[]>)
  return f ? aDoc(f) : null
}

/** Todos los docs leídos (para saber cuáles cambiaron sin bajarlos de nuevo). */
export async function docsLeidos(): Promise<Map<string, { id_crm: IdCrm; modificado: string }>> {
  const filas = await leer('docs leídos', [] as Fila[], q => q`SELECT doc_id, id_crm, modificado FROM cj_grab_guiones` as Promise<Fila[]>)
  return new Map(filas.map(f => [String(f.doc_id), { id_crm: String(f.id_crm), modificado: f.modificado instanceof Date ? f.modificado.toISOString() : String(f.modificado ?? '') }]))
}

/** Guarda el doc (upsert por doc_id). Devuelve si era la primera vez (línea de base). */
export async function guardarDoc(d: DocGuiones, huella = ''): Promise<{ nuevo: boolean }> {
  const id = idCrm(d.id_crm)
  await asegurarTablas()
  const [f] = await consulta('guardar doc de guiones', q => q`INSERT INTO cj_grab_guiones (doc_id, id_crm, modificado, leido, guiones, huella, avisos)
    VALUES (${d.doc_id}, ${id}, ${d.modificado || null}::timestamptz, ${d.leido || new Date().toISOString()}::timestamptz,
      ${JSON.stringify(d.guiones)}::jsonb, ${huella}, ${JSON.stringify(d.avisos.slice(0, 50))}::jsonb)
    ON CONFLICT (doc_id) DO UPDATE SET id_crm = EXCLUDED.id_crm, modificado = EXCLUDED.modificado, leido = EXCLUDED.leido,
      guiones = EXCLUDED.guiones, huella = EXCLUDED.huella, avisos = EXCLUDED.avisos
    RETURNING (xmax = 0) AS nuevo` as Promise<Fila[]>)
  return { nuevo: f?.nuevo === true }
}

/** El último doc leído de cada cliente (para el resumen de la daily: guiones grabados sin crudos y avisos del día). */
export async function listarDocs(excluidos: readonly string[] = []): Promise<DocGuiones[]> {
  const filas = await leer('listar docs', [] as Fila[], q => q`SELECT DISTINCT ON (id_crm) * FROM cj_grab_guiones WHERE NOT (upper(id_crm) = ANY(${[...excluidos]}::text[])) ORDER BY id_crm, leido DESC LIMIT 500` as Promise<Fila[]>)
  return filas.map(aDoc)
}
