// ── Acceso a una petición HTTP: sesión de Google o Bearer de máquina ────────────────────────
// Lo usan el proxy (primera barrera) y las rutas /api de datos (segunda barrera, por si el proxy no corre o cambia su
// matcher), así los dos deciden con exactamente la misma lógica. Sin imports de Next: se prueba con node:test.
import { COOKIE_SESION, igualesSeguro, leerCookie } from './cookie'
import { sesionDePrueba, sesionDesdeCookie, type Sesion } from './identidad'
import type { Seccion } from './roles'
import { ERROR_SIN_PERMISO, ERROR_SIN_SESION, veredicto, type Contexto } from './rutas'

type Cabeceras = { get(nombre: string): string | null }

/** Sesión de Google de la petición (cookie cj_sesion) o, solo en desarrollo y desde esta compu, el usuario de prueba. */
export function sesionDePeticion(headers: Cabeceras): Sesion | null {
  return sesionDesdeCookie(leerCookie(headers.get('cookie'), COOKIE_SESION)) ?? sesionDePrueba(headers)
}

/**
 * Acceso de máquina: "Authorization: Bearer <CRON_SECRET>". Solo por encabezado (nunca ?key=, que queda en logs).
 * Sin CRON_SECRET definido no abre nada. Comparación en tiempo constante.
 */
export function accesoMaquina(headers: Cabeceras): boolean {
  const secreto = process.env.CRON_SECRET
  if (!secreto || secreto.trim().length === 0) return false
  const coincidencia = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(headers.get('authorization') ?? '')
  return coincidencia !== null && igualesSeguro(coincidencia[1], secreto)
}

/** Quién pide. Nunca lanza: ante cualquier falla inesperada se lo trata como anónimo (cerrado). */
export function contextoDePeticion(headers: Cabeceras): Contexto {
  try {
    return { sesion: sesionDePeticion(headers), maquina: accesoMaquina(headers) }
  } catch {
    return { sesion: null, maquina: false }
  }
}

const SIN_CACHE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

/**
 * Segunda barrera de las rutas /api de datos del Resumen. Devuelve la respuesta de rechazo (401 sin sesión, 403 si el rol
 * no ve la sección) o null si puede seguir. Con { maquina: true } también deja pasar el Bearer CRON_SECRET.
 */
export function exigirAccesoApi(req: Request, seccion: Seccion, opciones: { maquina?: boolean } = {}): Response | null {
  const ctx = contextoDePeticion(req.headers)
  const quien = opciones.maquina ? 'google_o_maquina' : 'google'
  switch (veredicto({ quien, seccion }, ctx)) {
    case 'sin_sesion':
      return new Response(JSON.stringify({ error: ERROR_SIN_SESION }), { status: 401, headers: SIN_CACHE })
    case 'sin_permiso':
      return new Response(JSON.stringify({ error: ERROR_SIN_PERMISO }), { status: 403, headers: SIN_CACHE })
    default:
      return null
  }
}
