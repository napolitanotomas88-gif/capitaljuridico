// ── Sesión del dashboard unificado ──────────────────────────────────────────────────────────
// Login real con Google (ver docs/ACCESO-Y-ROLES.md). obtenerSesion() funciona así:
//   1. Lee la cookie cj_sesion y verifica su firma y vencimiento (lib/auth/cookie.ts). La cookie solo prueba IDENTIDAD
//      (el mail): el nombre y el rol salen siempre de AUTH_USUARIOS. Si la persona ya no figura, no hay sesión; si
//      cambió de rol, manda el rol actual de AUTH_USUARIOS.
//   2. Si no hay sesión real y NO es producción: usuario de prueba con CRM_DEV_ROL (socio, closer, csm o setter),
//      pero SOLO a peticiones hechas desde esta misma computadora (host localhost, 127.0.0.1 o [::1]): ese usuario ve
//      datos reales de clientes y no puede quedar a la vista de otros equipos de la red.
//   3. En producción (también en los preview de Vercel) sin cookie válida devuelve null: falla cerrado.
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { asegurarUsuarios } from './accesos'
import { COOKIE_SESION } from './cookie'
import { sesionDePrueba, sesionDesdeCookie, type Sesion } from './identidad'
import { destinoSinPermiso } from './hubClientes'
import { puedeVer, rutaInicial, type Seccion } from './roles'

export type { Sesion }

export async function obtenerSesion(): Promise<Sesion | null> {
  // Siempre dinámico: la sesión depende de la cookie de la petición
  await connection()

  // La lista de la planilla de Accesos se renueva (caché de 60 s) antes de decidir quién es
  await asegurarUsuarios()
  const real = sesionDesdeCookie((await cookies()).get(COOKIE_SESION)?.value)
  if (real) return real

  // Solo fuera de producción. Aunque el servidor de desarrollo escuche solo en 127.0.0.1, esto frena a quien llegue
  // por otro host (red, túnel). Es la misma función que usa el proxy.
  return sesionDePrueba(await headers())
}

/**
 * Barrera para cada página del shell. Llamarla al principio de la página, antes de leer datos:
 * un layout no alcanza porque no se vuelve a ejecutar en cada navegación ni frena a las páginas hijas.
 * Sin sesión manda a /entrar; con sesión pero sin permiso para la sección, a la primera que sí puede ver.
 */
export async function exigirAcceso(seccion: Seccion): Promise<Sesion> {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/entrar')
  if (!puedeVer(sesion, seccion)) redirect(destinoSinPermiso(sesion, seccion, rutaInicial))
  return sesion
}
