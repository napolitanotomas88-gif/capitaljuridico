// ── Puntaje: las lecturas que la cartera no hacía (SOLO servidor, SOLO lectura) ─────────────────────────────────────────
// Wins (cj_wins), el último EOW (cj_eow_reportes), los planes del tablero de cuotas (cj_cuotas_planes) y las respuestas de la
// encuesta asignadas a mano en /clientes/encuesta (cj_encuesta_asignaciones cruzada con la planilla del Typeform, 13/11/2026).
// Consultas para TODA la cartera (nunca una por cliente), cada una con caché compartida corta (conCache), tope de espera y
// pausa tras una falla. Lo demás (CRM, Seguimiento, Typeform, Meta, hitos) ya lo lee la cartera y se reusa. Nada de esto crea tablas: sin
// tabla, la fuente sale vacía; si falla o tarda, sale null y el puntaje muestra esas señales como «sin dato».
import { neon } from '@neondatabase/serverless'
import { conCache } from '../anuncios/cache'
import { crearLecturaConPausa, motivoCorto, PAUSA_KICKOFFS_MS } from '../anuncios/kickoffs'
import { validarDatos, type DatosEow } from '../eow/modelo'
import { tarea, type Plan } from '../crm/cuotas/modelo'
import type { FuentesPuntaje, PlanPagos, RespuestaAsignada } from './puntajeSenales'
import type { ClienteParaCruce } from '../seguimiento/typeform'
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

/** Las respuestas asignadas a mano (o descartadas), con a quién las había unido el cruce automático. Solo las asignadas viajan
 *  a la caché (clave, IDs, instante y valor: ni nombres ni mails). Sin asignaciones no se lee la planilla. */
async function respuestasAsignadas(clientes: ClienteParaCruce[]): Promise<RespuestaAsignada[]> {
  const q = neon(process.env.DATABASE_URL!.trim(), { fetchOptions: { signal: AbortSignal.timeout(6_000) } })
  let asignaciones: { clave: string; idCrm: string | null }[]
  try {
    const filas = (await q`SELECT clave, id_crm FROM cj_encuesta_asignaciones`) as Record<string, unknown>[]
    asignaciones = filas.map(f => ({ clave: String(f.clave), idCrm: f.id_crm ? String(f.id_crm).toUpperCase() : null }))
  } catch (e) {
    if (faltaTabla(e)) return []
    throw e
  }
  if (!asignaciones.length) return []
  const id = process.env.SHEET_ID_TYPEFORM?.trim()
  const { googleConfigurado, googleJson, sheetsBase } = await import('@/lib/auth/googleRest')
  if (!id || !googleConfigurado()) throw new Error('La planilla del Typeform no está conectada')
  const r = await googleJson<{ values?: unknown[][] }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent('A1:Z5000')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)
  // Mismo cruce que /clientes/encuesta (lib/bot/exito/rondas.ts) para la clave, y contra los clientes de la cartera para saber a
  // quién la había unido el cruce automático (el mismo que hace leerTypeform)
  const { respuestasDeFilas } = await import('@/lib/bot/exito/rondas')
  const porClave = new Map(asignaciones.map(a => [a.clave, a.idCrm]))
  return respuestasDeFilas(r.values ?? [], clientes)
    .filter(x => porClave.has(x.clave))
    .map(x => ({ clave: x.clave, asignado: porClave.get(x.clave) ?? null, auto: x.idCliente, enviadaEn: x.enviadaEn, valor: x.valor }))
}

const leerEow = crearLecturaConPausa(() => conCache('puntaje-eow-v1', 120, ultimoEow), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'EOW del puntaje' })
const leerPlanes = crearLecturaConPausa(() => conCache('puntaje-cuotas-v1', 120, planesPagos), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'cuotas del puntaje' })
const leerWins = crearLecturaConPausa(fechasDeWins, { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'wins del puntaje' })

// La caché guarda el resultado del cruce contra la cartera de ese momento (el cruce cambia solo si cambian los clientes)
let clientesCruce: ClienteParaCruce[] = []
const leerAsignadas = crearLecturaConPausa(() => conCache('puntaje-encuesta-asignada-v1', 120, () => respuestasAsignadas(clientesCruce)), { esperaMs: TOPE_MS, pausaMs: PAUSA_KICKOFFS_MS, que: 'encuesta asignada del puntaje' })

const VACIAS: FuentesPuntaje = { winsFechas: null, eow: null, planes: null, asignadas: null }

/** Las fuentes en paralelo. Nunca rechaza: lo que falla queda null (sus señales salen «sin dato»). `clientes`: los de Agencia
 *  con ID, para saber a quién había unido el cruce automático cada respuesta asignada a mano (sin ellos no se leen). */
export async function leerFuentesPuntaje(clientes: ClienteParaCruce[] = []): Promise<FuentesPuntaje> {
  if (!process.env.DATABASE_URL?.trim()) return VACIAS
  clientesCruce = clientes
  const [w, e, p, a] = await Promise.allSettled([leerWins(), leerEow(), leerPlanes(), clientes.length ? leerAsignadas() : Promise.resolve(null)])
  for (const r of [w, e, p, a]) if (r.status === 'rejected') console.error('[puntaje] fuente:', motivoCorto(r.reason))
  return {
    winsFechas: w.status === 'fulfilled' ? w.value : null,
    eow: e.status === 'fulfilled' ? e.value.data ?? null : null,
    planes: p.status === 'fulfilled' && Array.isArray(p.value.data) ? p.value.data : null,
    asignadas: a.status === 'fulfilled' && a.value && Array.isArray(a.value.data) ? a.value.data : null,
  }
}
