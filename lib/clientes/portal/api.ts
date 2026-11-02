// ── POST /api/clientes/portal/<ID>: el equipo guarda el portal del cliente (sin imports de Next: se prueba con node:test) ──
// Barreras, en orden: la regla de lib/auth/rutas.ts repetida (sesión del equipo con la Cartera: el cliente da 403 siempre),
// mismo origen, JSON chico, ID válido, datos validados (modelo.ts) y la versión leída (si otro guardó antes: 409).
import { ID_PORTAL } from '@/lib/auth/portal'
import { validarDatosPortal, type DatosPortal } from './modelo'
import type { ResultadoGuardar } from './base'

export interface DepsGuardado {
  /** exigirAccesoApi(req, 'clientes'): 401/403 o null */
  exigirAcceso: (req: Request) => Response | null
  /** sesión del EQUIPO (sesionDePeticion: la de un cliente vale null) */
  sesion: (req: Request) => { nombre: string; rol: string; esDePrueba: boolean } | null
  mismoOrigen: (h: { get(n: string): string | null }) => boolean
  guardar: (id: string, datos: DatosPortal, version: number, quien: string) => Promise<ResultadoGuardar>
  baseConfigurada: () => boolean
}

const TOPE_BYTES = 64_000
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })

export async function atenderGuardado(req: Request, idCrudo: string, deps: DepsGuardado): Promise<Response> {
  const rechazo = deps.exigirAcceso(req)
  if (rechazo) return rechazo
  const sesion = deps.sesion(req)
  // Doble control: aunque la regla cambie, un cliente (o nadie) no guarda
  if (!sesion || sesion.rol === 'cliente') return json({ error: 'Sin permiso para esta sección' }, 403)
  if (!deps.mismoOrigen(req.headers)) return json({ error: 'Origen no permitido' }, 403)
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'Se espera JSON' }, 415)
  if (!ID_PORTAL.test(idCrudo)) return json({ error: 'ID de cliente inválido' }, 400)
  const texto = await req.text()
  if (texto.length > TOPE_BYTES) return json({ error: 'Demasiado largo' }, 413)
  let cuerpo: unknown
  try { cuerpo = JSON.parse(texto) } catch { return json({ error: 'JSON inválido' }, 400) }
  const o = cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : {}
  const version = o.version
  if (!Number.isInteger(version) || (version as number) < 0) return json({ error: 'Falta la versión que leíste: recargá la página.' }, 400)
  const v = validarDatosPortal(o.datos)
  if (!v.ok) return json({ error: v.error }, 422)
  if (sesion.esDePrueba) return json({ ok: true, prueba: true, version: (version as number) + 1, actualizado: null })
  if (!deps.baseConfigurada()) return json({ error: 'Falta DATABASE_URL' }, 503)
  try {
    const r = await deps.guardar(idCrudo.toUpperCase(), v.datos, version as number, sesion.nombre)
    if (!r.ok) return json({ error: 'Alguien guardó cambios mientras editabas. Recargá para ver la última versión.', version: r.version }, 409)
    return json({ ok: true, version: r.version, actualizado: r.actualizado })
  } catch {
    return json({ error: 'No se pudo guardar. Probá de nuevo en un minuto.' }, 502)
  }
}
