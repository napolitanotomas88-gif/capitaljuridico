import { asegurarUsuarios } from '@/lib/auth/accesos'
import { sesionDePeticion } from '@/lib/auth/acceso'
import { seccionesDe } from '@/lib/notificaciones/modelo'
import { leerBandejaNotificaciones } from '@/lib/notificaciones/bandeja'

// GET /api/notificaciones?desde=<id>&pendientes=1 — las notificaciones del Despacho que ve la persona con sesión (por su
// mail, por sus secciones o para todos). Contrato acordado con DASHBOARD PWA VERCEL (27/10/2026): el marco del shell sondea
// con ?desde= cada 30 s (cartel + sonido) y el menú rápido del Hub pide ?pendientes=1. La regla '/api/notificaciones/*' de
// lib/auth/rutas.ts exige sesión de Google (sin sección: el filtro va adentro, en la consulta). Sin acceso por máquina.
export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'content-type': 'application/json', 'cache-control': 'no-store' }

export async function GET(req: Request) {
  await asegurarUsuarios()
  const sesion = sesionDePeticion(req.headers)
  if (!sesion) return new Response(JSON.stringify({ ok: false, mensaje: 'No autorizado.' }), { status: 401, headers: SIN_CACHE })
  const u = new URL(req.url)
  const desde = Number(u.searchParams.get('desde') ?? 0)
  try {
    const bandeja = await leerBandejaNotificaciones({ email: sesion.email, secciones: seccionesDe(sesion), desde: Number.isSafeInteger(desde) ? desde : 0, pendientes: u.searchParams.get('pendientes') === '1', historial: u.searchParams.get('historial') === '1' })
    return new Response(JSON.stringify({ ok: true, ...bandeja }), { headers: SIN_CACHE })
  } catch (e) {
    console.error('API notificaciones:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return new Response(JSON.stringify({ ok: false, mensaje: 'No se pudieron leer las notificaciones.' }), { status: 503, headers: SIN_CACHE })
  }
}
