// ── Acceso al tablero de anuncios: clave única (env ANUNCIOS_PASSWORD) ───────────────────────
// Mismo patrón que lib/finanzasAuth.ts pero con su PROPIA clave y cookie: login → cookie httpOnly
// firmada con HMAC-SHA256 (clave derivada de la contraseña: si se cambia, todas las sesiones se
// cierran solas). Sin la env, el tablero queda bloqueado y muestra "falta configurar la clave".
// No pasa por proxy.ts (ese archivo es de Finanzas): la página y la API verifican la cookie acá.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const COOKIE_ANUNCIOS = 'skwd_anuncios'
export const DURACION_SESION_S = 30 * 24 * 3600   // 30 días

export function claveConfigurada(): string | null {
  const p = process.env.ANUNCIOS_PASSWORD
  return p && p.trim().length >= 8 ? p : null
}

const derivada = (pwd: string) => createHash('sha256').update(`skwd-anuncios|${pwd}`).digest()
const firmar = (datos: string, pwd: string) => createHmac('sha256', derivada(pwd)).update(datos).digest('base64url')

function igualesSeguro(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest(), hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function claveCorrecta(intento: string): boolean {
  const pwd = claveConfigurada()
  return !!pwd && igualesSeguro(intento, pwd)
}

export function crearSesion(): string | null {
  const pwd = claveConfigurada()
  if (!pwd) return null
  const datos = `a1.${Math.floor(Date.now() / 1000) + DURACION_SESION_S}`
  return `${datos}.${firmar(datos, pwd)}`
}

export function sesionValida(token: string | undefined | null): boolean {
  const pwd = claveConfigurada()
  if (!pwd || !token) return false
  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'a1') return false
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

// Cron / llamadas manuales a los reportes: CRON_SECRET como Bearer (Vercel) o ?key=
export function cronAutorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const url = new URL(req.url)
  return req.headers.get('authorization') === `Bearer ${secret}` || url.searchParams.get('key') === secret
}
