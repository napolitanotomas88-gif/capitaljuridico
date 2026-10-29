// ── De la cookie de sesión a la persona (parte pura de lib/auth/sesion.ts) ───────────────────
// Está separada de sesion.ts porque sesion.ts importa next/headers y no se puede cargar fuera de Next:
// así esta parte se prueba con node:test (scripts/test-auth-google.mjs).
import { verificarCookie } from './cookie'
import { enProduccion } from './entorno'
import { peticionLocal } from './hostLocal'
import { MATRIZ_ROLES, SECCIONES, esRol, type Rol, type Seccion } from './roles'
import { buscarUsuario } from './usuarios'

export type Sesion = {
  /** Identificador estable: el mail en minúsculas (en el usuario de prueba, "dev") */
  id: string
  email: string
  nombre: string
  rol: Rol
  /** Administrador: ve todo y es el único que entra a Configuración */
  admin: boolean
  /** Secciones que puede ver (las de su rol, o las que se le marcaron en Configuración) */
  secciones: readonly Seccion[]
  /** Pestañas del CRM de ventas que se le asignaron en Configuración (el administrador ve todas) */
  pestanas: readonly string[]
  /** true = usuario de prueba de desarrollo (nunca existe en producción) */
  esDePrueba: boolean
}

/**
 * Sesión que prueba el valor de la cookie cj_sesion, o null (firma mala, vencida, AUTH_SECRET ausente o persona que
 * ya no figura en AUTH_USUARIOS). La cookie solo prueba IDENTIDAD: nombre y rol se leen de AUTH_USUARIOS en cada
 * petición, así que quitar a alguien de la lista o cambiarle el rol rige al toque.
 */
export function sesionDesdeCookie(valor: string | null | undefined): Sesion | null {
  const datos = verificarCookie('sesion', valor)
  if (!datos) return null
  const usuario = buscarUsuario(datos.e)
  if (!usuario) return null
  return { id: usuario.email, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol, admin: usuario.admin, secciones: usuario.secciones, pestanas: usuario.pestanas, esDePrueba: false }
}

/**
 * Usuario de prueba de desarrollo: solo fuera de producción, con CRM_DEV_ROL válido y solo a peticiones hechas desde esta
 * misma computadora (host localhost, 127.0.0.1 o [::1]): ese usuario ve datos reales y no puede quedar a la vista de otros
 * equipos de la red. Lo usan obtenerSesion() y el proxy, para que decidan lo mismo.
 */
export function sesionDePrueba(headers: { get(nombre: string): string | null }): Sesion | null {
  if (enProduccion()) return null
  const rol = process.env.CRM_DEV_ROL
  if (!esRol(rol)) return null
  if (!peticionLocal(headers)) return null
  // CRM_DEV_ROL=acceso: secciones a mano con CRM_DEV_SECCIONES (por ejemplo "edicion" para ver lo que ve René). Sin la
  // variable, o con claves desconocidas o 'configuracion', no suma nada (falla cerrado, como un acceso vacío).
  const secciones: readonly Seccion[] = rol === 'socio' ? SECCIONES : rol === 'acceso' ? seccionesDePrueba(process.env.CRM_DEV_SECCIONES) : MATRIZ_ROLES[rol]
  return { id: 'dev', email: 'dev@localhost', nombre: 'Usuario de prueba', rol, admin: rol === 'socio', secciones, pestanas: [], esDePrueba: true }
}

/** Secciones del usuario de prueba de tipo "acceso" (solo desarrollo): lista separada por comas, sin 'configuracion'. */
export function seccionesDePrueba(valor: string | undefined): Seccion[] {
  const pedidas = String(valor ?? '').split(',').map((x) => x.trim().toLowerCase())
  return SECCIONES.filter((s) => s !== 'configuracion' && pedidas.includes(s))
}
