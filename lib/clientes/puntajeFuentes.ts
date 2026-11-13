// ── Puntaje: las tres lecturas que la cartera no hacía (SOLO servidor, SOLO lectura) ─────────────────────────────────────
// Wins (cj_wins), el último EOW (cj_eow_reportes) y los planes del tablero de cuotas (cj_cuotas_planes). Tres consultas para
// TODA la cartera (nunca una por cliente), cada una con caché compartida corta (conCache), tope de espera y pausa tras una
// falla. Lo demás (CRM, Seguimiento, Typeform, Meta, hitos) ya lo lee la cartera y se reusa. Nada de esto crea tablas: sin
// tabla, la fuente sale vacía; si falla o tarda, sale null y el puntaje muestra esas señales como «sin dato».
import { neon } from '@neondatabase/serverless'
import { conCache } from '../anuncios/cache'
import { crearLecturaConPausa, motivoCorto, PAUSA_KICKOFFS_MS } from '../anuncios/kickoffs'
import { validarDatos, type DatosEow } from '../eow/modelo'
import { tarea, type Plan } from '../crm/cuotas/modelo'
import type { FuentesPuntaje, PlanPagos } from './puntajeSenales'
import { fechasDeWins } from './wins/db'

const TOPE_MS = 3_000
const faltaTabla = (e: unknown) => (e as { code?: string })?.code === '42P01' || /relation "[^"]+" does not exist/i.test((e as Error)?.message ?? '')

async function ultimoEow(): Promise<Pick<DatosEow, 'filas' | 'tarjetas'> | null> {
  const q = neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(6_000) } })
  try {
    const filas = (await q`SELECT data FROM cj_eow_reportes ORDER BY semana DESC LIMIT 1`) as { data: unknown }[]
    if (!filas.length) return null
    const v = validarDatos(filas[0].data)
    return v.ok ? v.datos : null
  } catch (e) {
    if (faltaTabla(e)) return null
    throw e
  }
}

async function planesPagos(): Promise<PlanPagos[]> {
  const url = process.env.CUOTAS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
  if (!url) return []
  const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(6_000) } })
  try {
    const filas = (await q`SELECT data FROM cj_cuotas_planes`) as { data: unknown }[]
    const ahora = new Date()
    // Solo lo que hace falta para el puntaje: a quién es y si tiene una cuota vencida sin pagar (nada de montos en la caché)
    return filas.map(f => f.data as Plan).filter(p => p && Array.isArray(p.cuotas)).map(p => ({
      nombre: String(p.nombre ?? ''), telefono: String(p.telefono ?? ''), abandonado: !!p.abandonado,
      atrasado: p.cuotas.some(c => tarea(c, ahora)?.grupo === 'vencidas'),
    }))
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
}

const leerEow = crearLecturaConPausa(() => conCache('puntaje-eow-v1', 120, ultimoEow), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'EOW del puntaje' })
const leerPlanes = crearLecturaConPausa(() => conCache('puntaje-cuotas-v1', 120, planesPagos), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'cuotas del puntaje' })
const leerWins = crearLecturaConPausa(fechasDeWins, { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'wins del puntaje' })

const VACIAS: FuentesPuntaje = { winsFechas: null, eow: null, planes: null }

/** Las tres fuentes en paralelo. Nunca rechaza: lo que falla queda null (sus señales salen «sin dato»). */
export async function leerFuentesPuntaje(): Promise<FuentesPuntaje> {
  if (!process.env.DATABASE_URL?.trim()) return VACIAS
  const [w, e, p] = await Promise.allSettled([leerWins(), leerEow(), leerPlanes()])
  for (const r of [w, e, p]) if (r.status === 'rejected') console.error('[puntaje] fuente:', motivoCorto(r.reason))
  return {
    winsFechas: w.status === 'fulfilled' ? w.value : null,
    eow: e.status === 'fulfilled' ? e.value.data ?? null : null,
    planes: p.status === 'fulfilled' && Array.isArray(p.value.data) ? p.value.data : null,
  }
}
