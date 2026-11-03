// ── Pausas vigentes de los clientes para el tablero (cj_cliente_acciones, lib/clientes/acciones) ─────────
// Una sola consulta: por cliente, la última acción vigente de pausa o reanudar. Si es una pausa, sigue en pausa. Lee
// `desde`, `hasta`, `vuelta` y `motivo` de la acción. Sin base, sin tabla o si Neon no responde: mapa vacío (el tablero
// muestra «Pausado · sin fecha de vuelta» con el estado del CRM). Solo servidor.
import { neon } from '@neondatabase/serverless'
import type { PausaCliente } from './sinGasto'

export const TOPE_PAUSAS_MS = 6_000
const ymd = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null)
const txt = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)

export function pausaDeFila(f: { tipo: string; datos: unknown; creada: unknown }): PausaCliente | null {
  if (f.tipo !== 'pausa') return null
  const d = (f.datos ?? {}) as Record<string, unknown>
  const creada = f.creada instanceof Date ? f.creada.toISOString() : String(f.creada ?? '')
  return { desde: ymd(d.desde) ?? creada.slice(0, 10), hasta: ymd(d.hasta), vuelta: txt(d.vuelta), motivo: txt(d.motivo) }
}

export async function pausasVigentes(ids: readonly string[]): Promise<Map<string, PausaCliente>> {
  const out = new Map<string, PausaCliente>()
  const url = process.env.DATABASE_URL?.trim()
  const lista = [...new Set(ids.map(x => x.toUpperCase()).filter(x => /^[A-Z]\d{1,6}$/.test(x)))]
  if (!url || !lista.length) return out
  try {
    const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(TOPE_PAUSAS_MS) } })
    const filas = await q`SELECT DISTINCT ON (upper(id_crm)) upper(id_crm) AS id, tipo, datos, creada FROM cj_cliente_acciones
      WHERE upper(id_crm) = ANY(${lista}) AND tipo IN ('pausa', 'reanudar') AND estado NOT IN ('anulada', 'error')
      ORDER BY upper(id_crm), creada DESC` as { id: string; tipo: string; datos: unknown; creada: unknown }[]
    for (const f of filas) { const p = pausaDeFila(f); if (p) out.set(f.id, p) }
  } catch { /* sin tabla o sin respuesta: el tablero sigue con el estado del CRM */ }
  return out
}
