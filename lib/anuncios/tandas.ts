// ── La última tanda de guiones de cada cliente (Neon, cj_guiones) para «Por lanzar» y los trabados (trabados.ts) ───────
// Solo lectura, con caché (5 min) y pausa tras una falla, como las fichas de kickoff (kickoffs.ts). Lo que se cachea es un
// array de pares (conCache guarda JSON). Sin base, o si falla: null (los trabados no dicen nada de los guiones). Solo servidor.
import { neon } from '@neondatabase/serverless'
import { conCache } from './cache'
import { crearLecturaConPausa, PAUSA_KICKOFFS_MS } from './kickoffs'
import type { TandaTraba } from './trabados'

const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "[^"]+" does not exist/i.test((e as Error)?.message ?? '')

async function leer(): Promise<[string, TandaTraba][]> {
  const q = neon(process.env.DATABASE_URL!.trim())
  try {
    const filas = (await q`SELECT DISTINCT ON (upper(id_crm)) upper(id_crm) AS id, tanda, estado,
        (SELECT min((x.aprobacion ->> 'cuando')) FROM cj_guiones x WHERE upper(x.id_crm) = upper(g.id_crm) AND x.aprobacion IS NOT NULL) AS aprobada
      FROM cj_guiones g WHERE id_crm IS NOT NULL ORDER BY upper(id_crm), creado DESC`) as Record<string, unknown>[]
    return filas.map(f => [String(f.id), { tanda: Number(f.tanda) || 0, estado: String(f.estado ?? ''), aprobada: f.aprobada ? String(f.aprobada) : null }])
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

const lectura = crearLecturaConPausa(() => conCache('tandas-lanzar-v1', 300, leer), { esperaMs: 3_000, pausaMs: PAUSA_KICKOFFS_MS, que: 'tandas de guiones' })

/** id del CRM → su última tanda (sin tanda: no está en el mapa). null = no se pudo leer. Nunca rechaza. */
export async function tandasPorCliente(): Promise<Map<string, TandaTraba> | null> {
  if (!process.env.DATABASE_URL?.trim()) return null
  try {
    const r = await lectura()
    return new Map(Array.isArray(r.data) ? r.data : [])
  } catch {
    return null
  }
}
