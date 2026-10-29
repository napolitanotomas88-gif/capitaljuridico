// ── Cookies firmadas del acceso (HMAC-SHA256 con AUTH_SECRET) ───────────────────────────────
// Dos cookies, las dos HttpOnly, SameSite=Lax y Secure en producción:
//   · cj_sesion  (7 días, Path=/): solo prueba IDENTIDAD (el mail). El nombre y el rol salen siempre de AUTH_USUARIOS.
//   · cj_intento (10 min, Path=/api/auth/google): state, nonce y code_verifier de un intento de login con Google.
// Formato: v1.<carga en base64url>.<firma en base64url>. La firma cubre "v1.<propósito>.<carga>": una cookie de
// intento no sirve como sesión ni al revés. Cambiar AUTH_SECRET invalida todas las cookies emitidas.
// Solo node:crypto, sin dependencias.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { enProduccion } from './entorno'

export const COOKIE_SESION = 'cj_sesion'
export const COOKIE_INTENTO = 'cj_intento'
export const RUTA_COOKIE_SESION = '/'
/** El intento de login solo viaja a las rutas de /api/auth/google (inicio y retorno de Google) */
export const RUTA_COOKIE_INTENTO = '/api/auth/google'
export const DURACION_SESION_S = 7 * 24 * 60 * 60
export const DURACION_INTENTO_S = 10 * 60

const VERSION = 'v1'
const LARGO_MAX = 2048
const SECRET_LARGO_MIN = 32
const SECRET_DISTINTOS_MIN = 8

export type Proposito = 'sesion' | 'intento'
export type DatosCookie = { iat: number; exp: number; [clave: string]: unknown }

/** AUTH_SECRET si es utilizable (32 caracteres o más y no repetitivo); si no, null: sin secreto no se firma ni se verifica nada. */
export function leerSecret(): string | null {
  const s = process.env.AUTH_SECRET
  if (typeof s !== 'string' || s.trim().length < SECRET_LARGO_MIN) return null
  if (new Set(s).size < SECRET_DISTINTOS_MIN) return null
  return s
}

const firmar = (datos: string, secret: string): Buffer => createHmac('sha256', secret).update(datos).digest()

/** Comparación en tiempo constante de dos textos (se comparan sus hashes, así el largo no filtra nada). */
export function igualesSeguro(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/**
 * Firma una cookie. Devuelve null si falta AUTH_SECRET o es corto. "iat" y "exp" (en segundos) los pone esta función
 * y pisan cualquier valor de la carga. "ahoraMs" existe para los tests.
 */
export function firmarCookie(
  proposito: Proposito,
  carga: Record<string, unknown>,
  duracionS: number,
  ahoraMs: number = Date.now(),
): string | null {
  const secret = leerSecret()
  if (!secret) return null
  const iat = Math.floor(ahoraMs / 1000)
  const cuerpo = Buffer.from(JSON.stringify({ ...carga, iat, exp: iat + duracionS })).toString('base64url')
  const firma = firmar(`${VERSION}.${proposito}.${cuerpo}`, secret).toString('base64url')
  return `${VERSION}.${cuerpo}.${firma}`
}

/** Datos de una cookie válida (firma correcta, propósito correcto y no vencida), o null. Nunca lanza. */
export function verificarCookie(
  proposito: Proposito,
  valor: string | null | undefined,
  ahoraMs: number = Date.now(),
): DatosCookie | null {
  const secret = leerSecret()
  if (!secret || typeof valor !== 'string' || valor.length === 0 || valor.length > LARGO_MAX) return null
  const partes = valor.split('.')
  if (partes.length !== 3 || partes[0] !== VERSION) return null
  const [, cuerpo, firma] = partes

  const recibida = Buffer.from(firma, 'base64url')
  const esperada = firmar(`${VERSION}.${proposito}.${cuerpo}`, secret)
  // Una sola forma de escribir la firma: base64url canónico, sin relleno ni caracteres de más
  if (recibida.toString('base64url') !== firma) return null
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null

  try {
    const datos: unknown = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
    if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return null
    const { iat, exp } = datos as Record<string, unknown>
    if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isFinite(exp)) return null
    if (exp * 1000 <= ahoraMs) return null
    return datos as DatosCookie
  } catch {
    return null
  }
}

const VALOR_SEGURO = /^[A-Za-z0-9._-]*$/
const secure = () => (enProduccion() ? '; Secure' : '')

/** Encabezado Set-Cookie para emitir una cookie. Solo acepta valores base64url y puntos (evita inyectar encabezados). */
export function serializarCookie(nombre: string, valor: string, maxAgeS: number, ruta: string): string {
  if (!VALOR_SEGURO.test(valor)) throw new Error('Valor de cookie inválido')
  return `${nombre}=${valor}; Path=${ruta}; Max-Age=${Math.floor(maxAgeS)}; HttpOnly; SameSite=Lax${secure()}`
}

/** Encabezado Set-Cookie que borra una cookie (mismo Path con el que se emitió). */
export function borrarCookie(nombre: string, ruta: string): string {
  return `${nombre}=; Path=${ruta}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure()}`
}

/** Valor de una cookie dentro del encabezado Cookie de la petición (la primera con ese nombre), o undefined. */
export function leerCookie(cabecera: string | null | undefined, nombre: string): string | undefined {
  if (!cabecera) return undefined
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=')
    if (i > 0 && trozo.slice(0, i).trim() === nombre) return trozo.slice(i + 1).trim()
  }
  return undefined
}
