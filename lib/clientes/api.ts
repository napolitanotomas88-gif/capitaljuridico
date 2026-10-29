// ── Piezas comunes de las rutas /api/clientes (solo servidor) ──────────────────────────────
// Falla cerrado: sin sesión 401, con sesión pero sin permiso para Clientes 403. En producción obtenerSesion()
// devuelve null mientras no exista el login real, así que ahí todo da 401.
import { NextResponse } from 'next/server'
import { puedeVer, type Rol } from '@/lib/auth/roles'
import { obtenerSesion, type Sesion } from '@/lib/auth/sesion'

// Respuesta corta y privada (es por usuario): el navegador puede reusarla un minuto, ningún intermediario la guarda.
const CACHE_OK = 'private, max-age=60'
const CACHE_NO = 'no-store'

export function json(cuerpo: unknown, status = 200): NextResponse {
  return NextResponse.json(cuerpo, { status, headers: { 'Cache-Control': status === 200 ? CACHE_OK : CACHE_NO } })
}

/** Rol con permiso para ver Clientes, o la respuesta de error que hay que devolver */
export async function exigirClientes(): Promise<{ rol: Rol; sesion: Sesion } | { error: NextResponse }> {
  const sesion = await obtenerSesion()
  if (!sesion) return { error: json({ error: 'No autorizado' }, 401) }
  if (!puedeVer(sesion, 'clientes')) return { error: json({ error: 'Sin permiso para ver clientes' }, 403) }
  return { rol: sesion.rol, sesion }
}
