import { asegurarUsuarios } from '@/lib/auth/accesos'
import { sesionDePeticion } from '@/lib/auth/acceso'
import { mismoOrigen } from '@/lib/bot/kickoff/acciones'
import { seccionesDe } from '@/lib/notificaciones/modelo'
import { marcarNotificacion } from '@/lib/notificaciones/registro'

// POST /api/notificaciones/<id> { accion: 'vista' | 'hecha' } — "vista" es por persona; "hecha" la cierra para todos (queda
// quién y cuándo). Solo si la persona puede ver esa notificación (si no, 404). Sesión de Google, mismo origen y JSON.
export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'content-type': 'application/json', 'cache-control': 'no-store' }
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: SIN_CACHE })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await asegurarUsuarios()
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return respuesta({ ok: false, mensaje: 'No autorizado.' }, 401)
  if (!mismoOrigen(req.headers)) return respuesta({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return respuesta({ ok: false, mensaje: 'Se espera JSON.' }, 415)
  const { id } = await ctx.params
  const n = Number(id)
  if (!/^\d{1,15}$/.test(id) || !Number.isSafeInteger(n)) return respuesta({ ok: false, mensaje: 'No encontrada.' }, 404)
  const texto = await req.text().catch(() => '')
  let accion: unknown
  try { accion = (JSON.parse(texto.slice(0, 500)) as { accion?: unknown })?.accion } catch { return respuesta({ ok: false, mensaje: 'JSON inválido.' }, 400) }
  if (accion !== 'vista' && accion !== 'hecha') return respuesta({ ok: false, mensaje: 'La acción tiene que ser "vista" o "hecha".' }, 400)
  try {
    const ok = await marcarNotificacion(n, accion, { email: sesion.email, nombre: sesion.nombre, secciones: seccionesDe(sesion) })
    return ok ? respuesta({ ok: true }) : respuesta({ ok: false, mensaje: 'No encontrada.' }, 404)
  } catch (e) {
    console.error('API notificaciones (marcar):', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return respuesta({ ok: false, mensaje: 'No se pudo guardar. Probá de nuevo.' }, 503)
  }
}
