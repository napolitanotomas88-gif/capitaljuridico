// ── Rondas de revisión de guiones (Neon, tabla cj_guiones_revision). Solo servidor ───────────────────────────────────────
// Una fila por tanda mientras está en «a_revisar»: desde cuándo (el momento del aviso), qué tipo de aviso, su clave en
// cj_alertas_discord y cómo salió. La escribe el aviso (servidor.ts → guardarRonda, que la reinicia en cada vuelta a
// revisión) y la lee el vigía para los recordatorios de 24/48 h (avisoRevision.ts). Se crea sola (idempotente).
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { Ronda, TipoRevision } from './avisoRevision'

type Q = NeonQueryFunction<false, false>
let lista = false
const url = () => process.env.DATABASE_URL?.trim() || ''
const q = (): Q => neon(url(), { fetchOptions: { signal: AbortSignal.timeout(8_000) } })

async function asegurar(s: Q): Promise<void> {
  if (lista) return
  await s`CREATE TABLE IF NOT EXISTS cj_guiones_revision (
    tanda_id bigint PRIMARY KEY, desde timestamptz NOT NULL DEFAULT now(), tipo text NOT NULL DEFAULT 'revisar', clave text,
    estado text NOT NULL DEFAULT 'enviando', actualizado timestamptz NOT NULL DEFAULT now())`
  lista = true
}

const iso = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x ?? ''))

export async function leerRondas(): Promise<Ronda[]> {
  if (!url()) return []
  const s = q(); await asegurar(s)
  return (await s`SELECT tanda_id, desde, tipo, clave, estado FROM cj_guiones_revision`).map(r => ({
    tanda_id: Number(r.tanda_id), desde: iso(r.desde), tipo: (r.tipo === 'corregida' ? 'corregida' : 'revisar') as TipoRevision, clave: (r.clave as string | null) ?? null, estado: String(r.estado),
  }))
}

/** Ronda nueva (cada vez que la tanda pasa a revisión y se avisa): reinicia «desde» y los recordatorios. */
export async function guardarRonda(r: { tanda_id: number; tipo: TipoRevision; clave: string | null; estado: string; desde?: string }): Promise<void> {
  if (!url()) return
  const s = q(); await asegurar(s)
  const desde = r.desde ?? new Date().toISOString()
  await s`INSERT INTO cj_guiones_revision (tanda_id, desde, tipo, clave, estado) VALUES (${r.tanda_id}, ${desde}::timestamptz, ${r.tipo}, ${r.clave}, ${r.estado})
    ON CONFLICT (tanda_id) DO UPDATE SET desde = EXCLUDED.desde, tipo = EXCLUDED.tipo, clave = EXCLUDED.clave, estado = EXCLUDED.estado, actualizado = now()`
}

/** Reserva una ronda sin pisar una existente (el vigía, antes de mandar un aviso que faltaba). */
export async function reservarRonda(r: Ronda): Promise<boolean> {
  if (!url()) return false
  const s = q(); await asegurar(s)
  return (await s`INSERT INTO cj_guiones_revision (tanda_id, desde, tipo, clave, estado) VALUES (${r.tanda_id}, ${r.desde}::timestamptz, ${r.tipo}, ${r.clave}, ${r.estado})
    ON CONFLICT (tanda_id) DO NOTHING RETURNING tanda_id`).length > 0
}

export async function marcarRonda(tandaId: number, estado: string): Promise<void> {
  if (!url()) return
  const s = q(); await asegurar(s)
  await s`UPDATE cj_guiones_revision SET estado = ${estado}, actualizado = now() WHERE tanda_id = ${tandaId}`
}

/** Borra las rondas de las tandas que ya no están en revisión (así los recordatorios cortan y la próxima vuelta arranca de cero).
 *  Solo las que no se tocaron en 10 min: una que se acaba de crear no se borra por una lectura de un momento antes. */
export async function limpiarRondas(vigentes: number[]): Promise<number> {
  if (!url()) return 0
  const s = q(); await asegurar(s)
  return (await s`DELETE FROM cj_guiones_revision WHERE NOT (tanda_id = ANY(${vigentes}::bigint[])) AND actualizado < now() - interval '10 minutes' RETURNING tanda_id`).length
}
