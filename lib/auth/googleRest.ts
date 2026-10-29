// Cliente mínimo de Google Sheets/Drive por REST (fetch + node:crypto), SIN la librería googleapis (que pesa ~100 MB y haría
// lento el arranque del proxy, que lo usa para leer la lista de accesos en cada petición protegida).
// Autenticación: cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY), JWT RS256 → token de acceso.
import { createSign } from 'node:crypto'
import { permiteEndpointsDePrueba } from './entorno'

// Solo fuera de producción (tests con un Google simulado) se pueden cambiar; en Vercel valen siempre los reales.
const TOKEN_REAL = 'https://oauth2.googleapis.com/token'
const SHEETS_REAL = 'https://sheets.googleapis.com'
const tokenUrl = () => (permiteEndpointsDePrueba() && process.env.GOOGLE_TOKEN_URL) || TOKEN_REAL
export const sheetsBase = () => (permiteEndpointsDePrueba() && process.env.GOOGLE_SHEETS_URL) || SHEETS_REAL
const ESPERA_MS = 8000
let token: { valor: string; vence: number; scopes: string } | null = null

function clavePrivada(): string {
  let k = (process.env.GOOGLE_PRIVATE_KEY ?? '').trim()
  const m = /^(["'])([\s\S]*)\1$/.exec(k)
  if (m) k = m[2].trim()
  return `${k.replace(/\\r\\n|\\n/g, '\n').trim()}\n`
}
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function googleConfigurado(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)
}

async function tokenDeAcceso(scopes: string): Promise<string> {
  if (token && token.scopes === scopes && token.vence > Date.now() + 60_000) return token.valor
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  if (!email || !process.env.GOOGLE_PRIVATE_KEY) throw new Error('Falta la cuenta de servicio de Google')
  const ahora = Math.floor(Date.now() / 1000)
  const carga = b64u(JSON.stringify({ iss: email, scope: scopes, aud: tokenUrl(), iat: ahora, exp: ahora + 3600 }))
  const cabecera = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const firma = createSign('RSA-SHA256').update(`${cabecera}.${carga}`).sign(clavePrivada()).toString('base64url')
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cabecera}.${carga}.${firma}` }),
    signal: AbortSignal.timeout(ESPERA_MS),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Google rechazó la cuenta de servicio (${res.status})`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  token = { valor: json.access_token, vence: Date.now() + json.expires_in * 1000, scopes }
  return token.valor
}

export const SCOPE_SHEETS = 'https://www.googleapis.com/auth/spreadsheets'
export const SCOPE_SHEETS_Y_ARCHIVOS = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'

export async function googleJson<T = unknown>(url: string, opciones: { metodo?: string; cuerpo?: unknown; scopes?: string } = {}): Promise<T> {
  const t = await tokenDeAcceso(opciones.scopes ?? SCOPE_SHEETS)
  const res = await fetch(url, {
    method: opciones.metodo ?? (opciones.cuerpo ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    signal: AbortSignal.timeout(ESPERA_MS),
    cache: 'no-store',
  })
  if (!res.ok) {
    // Nunca se devuelve el cuerpo: solo el código (puede citar ids o mails)
    throw Object.assign(new Error(`Google respondió ${res.status}`), { status: res.status })
  }
  return (await res.json()) as T
}
