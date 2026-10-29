// ── Lista de personas autorizadas (variable AUTH_USUARIOS) ──────────────────────────────────
// JSON con una lista de objetos { email, nombre, rol }, rol = socio | closer | csm | setter. Los mails no viven en el
// código: se editan en Vercel (ver docs/ACCESO-Y-ROLES.md). Una cuenta que no figura acá no entra, aunque Google la
// reconozca. La entrada inválida se ignora con un aviso en el servidor que NO incluye mails ni el contenido de la variable.
import { MATRIZ_ROLES, SECCIONES, SECCIONES_ASIGNABLES, esRol, type Rol, type Seccion } from './roles'

/** Persona de la lista fija AUTH_USUARIOS (Vercel). */
export type Usuario = { readonly email: string; readonly nombre: string; readonly rol: Rol }

/**
 * Persona con sus permisos ya resueltos, venga de donde venga:
 *  · lista fija de Vercel (AUTH_USUARIOS): socio = administrador; closer, csm y setter con las secciones de su rol;
 *  · planilla de Accesos (pantalla Configuración): "admin" (todo, y gestiona accesos) o "acceso" (las secciones y pestañas del CRM que se le marcaron).
 */
export type Acceso = Usuario & {
  readonly admin: boolean
  readonly secciones: readonly Seccion[]
  /** Pestañas del CRM de ventas que puede abrir (además de las que le dé AUTH_VENTAS_PESTANAS). Vacío para los administradores: ven todas. */
  readonly pestanas: readonly string[]
  readonly origen: 'vercel' | 'planilla'
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOLO_ASCII_IMPRIMIBLE = /^[\x21-\x7e]+$/
const LARGO_MAX_EMAIL = 254
const LARGO_MAX_NOMBRE = 80

/**
 * Mismo criterio en todos lados: sin espacios y en minúsculas. Solo ASCII imprimible, y se controla ANTES de pasar a
 * minúsculas: toLowerCase() convierte el signo Kelvin (U+212A) en una "k" común y haría pasar por listado a un mail
 * distinto. Fallar cerrado cuesta poco: las cuentas de Google de esta lista no usan caracteres fuera de ASCII.
 */
export function normalizarEmail(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const recortado = valor.trim()
  if (!SOLO_ASCII_IMPRIMIBLE.test(recortado)) return null
  const email = recortado.toLowerCase()
  return email.length <= LARGO_MAX_EMAIL && RE_EMAIL.test(email) ? email : null
}

/**
 * Parsea AUTH_USUARIOS. Función pura (el aviso se inyecta para poder probarla). Reglas:
 *  · JSON inválido o que no sea una lista → ninguna persona (todo queda cerrado).
 *  · Entrada con mail, nombre o rol inválidos → se ignora.
 *  · Mail repetido con el mismo rol → una sola entrada; con roles distintos → se descartan todas (falla cerrado: mejor
 *    que alguien quede afuera y lo avise, a que conserve un rol de más sin que nadie se entere).
 */
export function parsearUsuarios(
  crudo: string | undefined,
  avisar: (mensaje: string) => void = (m) => console.warn(m),
): Usuario[] {
  if (!crudo || !crudo.trim()) return []
  let datos: unknown
  try {
    datos = JSON.parse(crudo)
  } catch {
    // No se imprime el error de JSON.parse: puede citar un trozo del contenido (mails)
    avisar('[auth] AUTH_USUARIOS no es un JSON válido: nadie queda autorizado')
    return []
  }
  if (!Array.isArray(datos)) {
    avisar('[auth] AUTH_USUARIOS tiene que ser una lista JSON: nadie queda autorizado')
    return []
  }

  const porEmail = new Map<string, Usuario[]>()
  datos.forEach((entrada: unknown, i: number) => {
    const n = i + 1
    if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
      avisar(`[auth] AUTH_USUARIOS: entrada ${n} ignorada (no es un objeto)`)
      return
    }
    const { email, nombre, rol } = entrada as Record<string, unknown>
    const mail = normalizarEmail(email)
    if (!mail) return avisar(`[auth] AUTH_USUARIOS: entrada ${n} ignorada (mail inválido)`)
    const nom = typeof nombre === 'string' ? nombre.trim() : ''
    if (!nom || nom.length > LARGO_MAX_NOMBRE) return avisar(`[auth] AUTH_USUARIOS: entrada ${n} ignorada (nombre inválido)`)
    if (!esRol(rol) || rol === 'acceso') return avisar(`[auth] AUTH_USUARIOS: entrada ${n} ignorada (rol inválido)`)
    const lista = porEmail.get(mail) ?? []
    lista.push(Object.freeze({ email: mail, nombre: nom, rol }))
    porEmail.set(mail, lista)
  })

  const usuarios: Usuario[] = []
  for (const lista of porEmail.values()) {
    if (lista.every((u) => u.rol === lista[0].rol)) {
      usuarios.push(lista[0])
    } else {
      avisar(`[auth] AUTH_USUARIOS: una cuenta aparece ${lista.length} veces con roles distintos: se descartan todas esas entradas`)
    }
  }
  return usuarios
}

// El parseo se repite solo si cambia el valor de la variable (así el aviso sale una vez y no en cada petición)
let memo: { crudo: string | undefined; porEmail: Map<string, Usuario> } | null = null

function cargar(): Map<string, Usuario> {
  const crudo = process.env.AUTH_USUARIOS
  if (!memo || memo.crudo !== crudo) {
    memo = { crudo, porEmail: new Map(parsearUsuarios(crudo).map((u) => [u.email, u])) }
  }
  return memo.porEmail
}

// Accesos cargados desde la planilla (lib/auth/accesos.ts los renueva cada minuto); la lista fija de Vercel siempre manda
let desdePlanilla = new Map<string, Acceso>()
export function fijarAccesosDePlanilla(lista: readonly Acceso[]) {
  desdePlanilla = new Map(lista.map((a) => [a.email, a]))
}

const deLaListaFija = (u: Usuario): Acceso =>
  Object.freeze({ ...u, admin: u.rol === 'socio', secciones: MATRIZ_ROLES[u.rol], pestanas: [], origen: 'vercel' as const })

/** Convierte una fila válida de la planilla en persona con permisos. "admin" = todo; "acceso" = solo lo marcado (y nunca Configuración). */
export function accesoDePlanilla(f: { email: string; nombre: string; tipo: 'admin' | 'acceso'; secciones: readonly string[]; pestanas: readonly string[] }): Acceso {
  if (f.tipo === 'admin') return Object.freeze({ email: f.email, nombre: f.nombre, rol: 'socio' as const, admin: true, secciones: SECCIONES, pestanas: [], origen: 'planilla' as const })
  const secciones = SECCIONES_ASIGNABLES.filter((s) => f.secciones.includes(s))
  return Object.freeze({ email: f.email, nombre: f.nombre, rol: 'acceso' as const, admin: false, secciones, pestanas: [...f.pestanas], origen: 'planilla' as const })
}

/** La persona autorizada con ese mail (sin distinguir mayúsculas), o null si no figura: acceso denegado. */
export function buscarUsuario(email: unknown): Acceso | null {
  const mail = normalizarEmail(email)
  if (!mail) return null
  const fija = cargar().get(mail)
  if (fija) return deLaListaFija(fija)
  return desdePlanilla.get(mail) ?? null
}

/** Todas las personas con acceso: primero la lista fija de Vercel y después las de la planilla (sin repetir mails). */
export function listarAccesos(): Acceso[] {
  const fijas = [...cargar().values()].map(deLaListaFija)
  const vistas = new Set(fijas.map((f) => f.email))
  return [...fijas, ...[...desdePlanilla.values()].filter((a) => !vistas.has(a.email))]
}

/** ¿Hay al menos una persona autorizada en la lista fija? Sin eso el acceso se considera no configurado (la planilla sola no alcanza: siempre tiene que haber un administrador que no dependa de ella). */
export function hayUsuarios(): boolean {
  return cargar().size > 0
}
