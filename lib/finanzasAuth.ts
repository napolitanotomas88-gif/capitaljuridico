// ── Acceso al dashboard de Finanzas: contraseña única (env FINANZAS_PASSWORD) ──────────────
// Login → cookie httpOnly firmada con HMAC-SHA256 (clave derivada de la contraseña: si se cambia
// la contraseña, todas las sesiones abiertas se invalidan solas). Sin la env, todo queda bloqueado.
// La usan proxy.ts (primera barrera) y, de nuevo, /finanzas y /api/finanzas (defensa en profundidad).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const COOKIE_FINANZAS = 'skwd_finanzas'
export const DURACION_SESION_S = 30 * 24 * 3600   // 30 días

export function passwordConfigurada(): string | null {
  const p = process.env.FINANZAS_PASSWORD
  return p && p.trim().length >= 6 ? p : null
}

const clave = (pwd: string) => createHash('sha256').update(`skwd-finanzas|${pwd}`).digest()
const firmar = (datos: string, pwd: string) => createHmac('sha256', clave(pwd)).update(datos).digest('base64url')

function igualesSeguro(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest(), hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function passwordCorrecta(intento: string): boolean {
  const pwd = passwordConfigurada()
  if (!pwd) return false
  return igualesSeguro(intento, pwd)
}

export function crearToken(): string | null {
  const pwd = passwordConfigurada()
  if (!pwd) return null
  const datos = `v1.${Math.floor(Date.now() / 1000) + DURACION_SESION_S}`
  return `${datos}.${firmar(datos, pwd)}`
}

export function tokenValido(token: string | undefined | null): boolean {
  const pwd = passwordConfigurada()
  if (!pwd || !token) return false
  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'v1') return false
  const vence = Number(partes[1])
  if (!Number.isFinite(vence) || vence * 1000 < Date.now()) return false
  return igualesSeguro(partes[2], firmar(`${partes[0]}.${partes[1]}`, pwd))
}

// Freno simple a la fuerza bruta: 8 intentos fallidos por IP cada 15 min (memoria del proceso)
const fallos = new Map<string, { n: number; desde: number }>()
export function bloqueadoPorIntentos(ip: string): boolean {
  const f = fallos.get(ip)
  if (!f) return false
  if (Date.now() - f.desde > 15 * 60_000) { fallos.delete(ip); return false }
  return f.n >= 8
}
export function registrarFallo(ip: string) {
  const f = fallos.get(ip)
  if (!f || Date.now() - f.desde > 15 * 60_000) fallos.set(ip, { n: 1, desde: Date.now() })
  else f.n++
}
export function limpiarFallos(ip: string) { fallos.delete(ip) }
