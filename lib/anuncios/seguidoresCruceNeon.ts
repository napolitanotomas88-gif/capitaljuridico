// ── Fotos diarias del cruce de seguidores FM (Neon). Solo servidor ───────────────────────────────────────────────────
// Una fila por día (la última foto del día pisa a la anterior del mismo día). La tabla se crea sola, aditiva, como las
// otras cj_*: nunca DROP ni ALTER.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { FotoCruce } from './seguidoresCruce'

type Q = NeonQueryFunction<false, false>
let lista = false

function conexion(): Q | null {
  const url = process.env.DATABASE_URL?.trim()
  return url ? neon(url, { fetchOptions: { signal: AbortSignal.timeout(8_000) } }) : null
}

async function asegurar(q: Q): Promise<void> {
  if (lista) return
  await q`CREATE TABLE IF NOT EXISTS cj_fm_seguidores_cruce (
    dia date PRIMARY KEY, foto jsonb NOT NULL, recibida timestamptz NOT NULL DEFAULT now())`
  lista = true
}

/** Guarda la foto del día (reemplaza la del mismo día). false si no hay base configurada. */
export async function guardarFoto(foto: FotoCruce): Promise<boolean> {
  const q = conexion()
  if (!q) return false
  await asegurar(q)
  await q`INSERT INTO cj_fm_seguidores_cruce (dia, foto) VALUES (${foto.dia}, ${JSON.stringify(foto)}::jsonb)
    ON CONFLICT (dia) DO UPDATE SET foto = EXCLUDED.foto, recibida = now()`
  return true
}

/** Las últimas `n` fotos, de la más nueva a la más vieja. null si no hay base configurada. */
export async function ultimasFotos(n = 2): Promise<FotoCruce[] | null> {
  const q = conexion()
  if (!q) return null
  await asegurar(q)
  const filas = await q`SELECT foto FROM cj_fm_seguidores_cruce ORDER BY dia DESC LIMIT ${Math.min(Math.max(n, 1), 60)}`
  return filas.map(f => (typeof f.foto === 'string' ? JSON.parse(f.foto) : f.foto) as FotoCruce)
}
