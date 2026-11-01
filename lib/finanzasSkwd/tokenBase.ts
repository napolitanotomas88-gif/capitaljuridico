// ── Finanzas SKWD: el acceso a la base Supabase con la cuenta del Despacho (sin otro inicio de sesión) ────────────────────
// Pedido de Tomás (1/11/2026): «no hace falta la contraseña: al Despacho ya se entra con el correo y solo ciertas personas
// entran a Finanzas». La base no necesita un usuario propio: sus permisos (RLS) solo piden el rol `authenticated` y
// miran el correo del token (`auth.jwt() ->> 'email'`): los datos sensibles del equipo para los correos de
// private.sensibles_autorizados, y la firma de quién cargó o corrigió (creado_por). Entonces el servidor del Despacho,
// después de verificar el acceso a Finanzas, firma un token corto (HS256, con el JWT secret del proyecto,
// SUPABASE_JWT_SECRET) con el correo de la sesión de Google. Puro: sin red ni Next.
import { createHash, createHmac } from 'node:crypto'

export const DURACION_TOKEN_S = 3600
/** Correo cuando se entra solo con la contraseña de Finanzas (sin Google): no está entre los autorizados a lo sensible. */
export const CORREO_SIN_GOOGLE = 'acceso-por-clave@finanzas.despacho'

const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url')

/** Un uuid estable por correo (el `sub` del token; la base no lo usa, pero el formato lo pide). */
export function uuidDeCorreo(correo: string): string {
  const h = createHash('sha256').update(`finanzas-skwd|${correo}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function firmarTokenBase(correo: string, secreto: string, ahoraS = Math.floor(Date.now() / 1000)): { token: string; vence: number } {
  if (!secreto || secreto.length < 32) throw new Error('SUPABASE_JWT_SECRET inválido')
  const email = correo.trim().toLowerCase()
  const vence = ahoraS + DURACION_TOKEN_S
  const cabeza = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const cuerpo = b64(JSON.stringify({ aud: 'authenticated', role: 'authenticated', sub: uuidDeCorreo(email), email, iss: 'despacho-capital-juridico', iat: ahoraS, exp: vence }))
  const firma = createHmac('sha256', secreto).update(`${cabeza}.${cuerpo}`).digest('base64url')
  return { token: `${cabeza}.${cuerpo}.${firma}`, vence }
}
