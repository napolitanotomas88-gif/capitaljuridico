// ── /api/eow: leer, guardar y «Nueva semana» (sin imports de Next: se prueba con node:test) ───────────────────────────────
// Barreras, en orden: la regla de lib/auth/rutas.ts repetida (sesión de Google con el mail en EOW_CORREOS: si no, 401/403),
// mismo origen (POST), JSON chico, semana válida, datos validados (modelo.ts) y la versión leída (si otro guardó antes: 409).
import { domingoDe, esFecha, validarDatos, type DatosEow, type ReporteEow } from './modelo'
import type { EntradaHistorial, ResultadoGuardar } from './db'

export interface DepsApiEow {
  /** exigirAccesoApi(req, null, { correos: 'eow' }): 401/403 o null */
  exigirAcceso: (req: Request) => Response | null
  sesion: (req: Request) => { nombre: string; email: string; esDePrueba: boolean } | null
  mismoOrigen: (h: { get(n: string): string | null }) => boolean
  baseConfigurada: () => boolean
  hoy: () => string
  listarSemanas: () => Promise<string[]>
  leerReporte: (semana: string) => Promise<ReporteEow | null>
  historial: (semana: string) => Promise<EntradaHistorial[]>
  guardar: (semana: string, datos: DatosEow, version: number, quien: string) => Promise<ResultadoGuardar>
  nuevaSemana: (semana: string, quien: string) => Promise<{ creada: boolean; reporte: ReporteEow | null }>
}

const TOPE_BYTES = 400_000
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })
const quienDe = (s: { nombre: string; email: string }) => (s.nombre || s.email.split('@')[0] || 'Equipo').slice(0, 80)

export async function atenderGetEow(req: Request, d: DepsApiEow): Promise<Response> {
  const rechazo = d.exigirAcceso(req)
  if (rechazo) return rechazo
  if (!d.sesion(req)) return json({ error: 'No autorizado' }, 401)
  if (!d.baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  const pedida = new URL(req.url).searchParams.get('semana')
  if (pedida && !esFecha(pedida)) return json({ error: 'Semana inválida' }, 400)
  try {
    const semanas = await d.listarSemanas()
    const semana = pedida ?? semanas[0] ?? null
    const reporte = semana ? await d.leerReporte(semana) : null
    return json({ semanas, reporte, historial: reporte ? await d.historial(reporte.semana) : [] })
  } catch {
    return json({ error: 'No se pudo leer el EOW. Probá de nuevo en un minuto.' }, 502)
  }
}

export async function atenderPostEow(req: Request, d: DepsApiEow): Promise<Response> {
  const rechazo = d.exigirAcceso(req)
  if (rechazo) return rechazo
  const sesion = d.sesion(req)
  if (!sesion) return json({ error: 'No autorizado' }, 401)
  if (!d.mismoOrigen(req.headers)) return json({ error: 'Origen no permitido' }, 403)
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'Se espera JSON' }, 415)
  const texto = await req.text()
  if (texto.length > TOPE_BYTES) return json({ error: 'Demasiado largo' }, 413)
  let cuerpo: Record<string, unknown>
  try {
    const x = JSON.parse(texto)
    cuerpo = x && typeof x === 'object' ? x : {}
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  if (!d.baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  const quien = quienDe(sesion)
  try {
    if (cuerpo.accion === 'nueva') {
      // La semana nueva = el domingo de esta semana; si ya existe (o es anterior a la última), el domingo siguiente a la última
      const semanas = await d.listarSemanas()
      let semana = esFecha(cuerpo.semana) ? cuerpo.semana : domingoDe(d.hoy())
      if (!esFecha(cuerpo.semana) && semanas[0] && semana <= semanas[0]) semana = domingoDe(new Date(new Date(`${semanas[0]}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10))
      const r = await d.nuevaSemana(semana, quien)
      return json({ ok: true, creada: r.creada, reporte: r.reporte })
    }
    if (cuerpo.accion !== 'guardar') return json({ error: 'Acción inválida (guardar o nueva).' }, 400)
    if (!esFecha(cuerpo.semana)) return json({ error: 'Semana inválida' }, 400)
    const version = cuerpo.version
    if (!Number.isInteger(version) || (version as number) < 1) return json({ error: 'Falta la versión que leíste: recargá la página.' }, 400)
    const v = validarDatos(cuerpo.datos)
    if (!v.ok) return json({ error: v.error }, 422)
    const r = await d.guardar(cuerpo.semana, v.datos, version as number, quien)
    if (!r.ok) {
      if (r.version === null) return json({ error: 'Esa semana no existe.' }, 404)
      return json({ error: 'Alguien guardó cambios mientras editabas. Recargá para ver la última versión.', version: r.version }, 409)
    }
    return json({ ok: true, version: r.version, actualizado: r.actualizado, actualizadoPor: quien })
  } catch {
    return json({ error: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 502)
  }
}
