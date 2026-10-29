// ── Login con Google: OpenID Connect, flujo "authorization code" con PKCE ───────────────────
// Sin dependencias: node:crypto y fetch. Pasos: (1) crearIntento + urlAutorizacion mandan a la persona a Google;
// (2) Google vuelve a /api/auth/google/callback con un código; (3) intercambiarCodigo lo canjea en el token endpoint
// y (4) validarIdToken revisa el id_token. El id_token llega DIRECTO del token endpoint de Google por HTTPS, así que
// según OIDC Core 3.1.3.7 alcanza con validar sus datos (no hace falta verificar la firma ni bajar las claves de Google).
import { createHash, randomBytes } from 'node:crypto'
import { igualesSeguro, leerSecret } from './cookie'
import { enProduccion, permiteEndpointsDePrueba } from './entorno'
import { ErrorAuth } from './errores'
import { normalizarEmail, hayUsuarios } from './usuarios'

// Endpoints de Google: constantes. Solo fuera de producción se pueden sobrescribir (tests con proveedor simulado).
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const RUTA_CALLBACK = '/api/auth/google/callback'
export const ALCANCE = 'openid email profile'
const EMISORES = ['https://accounts.google.com', 'accounts.google.com']
const BASE_URL_DESARROLLO = 'http://localhost:3101'
const ESPERA_TOKEN_MS = 10_000

function endpoint(constante: string, variable: string): string {
  const prueba = process.env[variable]
  if (!permiteEndpointsDePrueba() || !prueba) return constante
  try {
    const u = new URL(prueba)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : constante
  } catch {
    return constante
  }
}
export const endpointAutorizacion = (): string => endpoint(GOOGLE_AUTH_URL, 'GOOGLE_AUTH_URL')
export const endpointToken = (): string => endpoint(GOOGLE_TOKEN_URL, 'GOOGLE_TOKEN_URL')

// ── Configuración ──────────────────────────────────────────────────────────────────────────
export type ConfigGoogle = {
  clientId: string
  clientSecret: string
  /** Origen público sin barra final (AUTH_BASE_URL) */
  baseUrl: string
  /** URL de retorno registrada en Google: baseUrl + /api/auth/google/callback */
  redirectUri: string
}
export type ResultadoConfig = { ok: true; config: ConfigGoogle } | { ok: false; faltan: string[] }

function leerBaseUrl(): string | null {
  const crudo = (process.env.AUTH_BASE_URL ?? '').trim() || (enProduccion() ? '' : BASE_URL_DESARROLLO)
  try {
    const u = new URL(crudo)
    // En producción solo https; en desarrollo también http (localhost)
    if (u.protocol === 'https:' || (u.protocol === 'http:' && !enProduccion())) return u.origin
  } catch {
    /* mal formada: cuenta como faltante */
  }
  return null
}

let ultimoAviso = ''

/**
 * Todo lo necesario para entrar con Google. Si falta algo, el login falla CERRADO (nunca abre acceso) y devuelve los
 * NOMBRES de las variables que faltan o están mal (jamás sus valores).
 */
export function leerConfig(): ResultadoConfig {
  const faltan: string[] = []
  if (!leerSecret()) faltan.push('AUTH_SECRET')
  if (!hayUsuarios()) faltan.push('AUTH_USUARIOS')
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim()
  if (!clientId) faltan.push('GOOGLE_CLIENT_ID')
  if (!clientSecret) faltan.push('GOOGLE_CLIENT_SECRET')
  const baseUrl = leerBaseUrl()
  if (!baseUrl) faltan.push('AUTH_BASE_URL')

  if (faltan.length > 0 || !baseUrl) {
    const aviso = faltan.join(', ')
    if (aviso !== ultimoAviso) {
      ultimoAviso = aviso
      console.error(`[auth] acceso no configurado, falta o está mal: ${aviso}`)
    }
    return { ok: false, faltan }
  }
  ultimoAviso = ''
  return { ok: true, config: { clientId, clientSecret, baseUrl, redirectUri: `${baseUrl}${RUTA_CALLBACK}` } }
}

// ── Intento de login ───────────────────────────────────────────────────────────────────────
export type Intento = { state: string; nonce: string; verifier: string }

const aleatorio = (bytes: number): string => randomBytes(bytes).toString('base64url')

/** state y nonce de 256 bits; code_verifier de 64 caracteres (PKCE pide entre 43 y 128) */
export function crearIntento(): Intento {
  return { state: aleatorio(32), nonce: aleatorio(32), verifier: aleatorio(48) }
}

export const desafioPkce = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

/** URL de Google a la que se manda a la persona */
export function urlAutorizacion(config: ConfigGoogle, intento: Intento): string {
  const u = new URL(endpointAutorizacion())
  u.searchParams.set('client_id', config.clientId)
  u.searchParams.set('redirect_uri', config.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', ALCANCE)
  u.searchParams.set('state', intento.state)
  u.searchParams.set('nonce', intento.nonce)
  u.searchParams.set('code_challenge', desafioPkce(intento.verifier))
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('prompt', 'select_account')
  return u.href
}

// ── Canje del código ───────────────────────────────────────────────────────────────────────
/** Canjea el código por el id_token. 4xx de Google → google_rechazo; red caída, 5xx o respuesta rara → error. */
export async function intercambiarCodigo(
  config: ConfigGoogle,
  codigo: string,
  verifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let res: Response
  try {
    res = await fetchFn(endpointToken(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: codigo,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: verifier,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_TOKEN_MS),
    })
  } catch {
    throw new ErrorAuth('error', 'token_sin_respuesta')
  }
  if (res.status >= 400 && res.status < 500) throw new ErrorAuth('google_rechazo', `token_http_${res.status}`)
  if (!res.ok) throw new ErrorAuth('error', `token_http_${res.status}`)
  let cuerpo: unknown
  try {
    cuerpo = await res.json()
  } catch {
    throw new ErrorAuth('error', 'token_respuesta_ilegible')
  }
  const idToken = (cuerpo as { id_token?: unknown } | null)?.id_token
  if (typeof idToken !== 'string' || idToken.length === 0) throw new ErrorAuth('error', 'token_sin_id_token')
  return idToken
}

// ── Validación del id_token ────────────────────────────────────────────────────────────────
export type Identidad = { email: string; sub: string | null }

function decodificarJwt(idToken: string): Record<string, unknown> {
  const partes = idToken.split('.')
  if (partes.length !== 3 || partes.some((p) => p.length === 0)) throw new ErrorAuth('error', 'id_token_malformado')
  try {
    const datos: unknown = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'))
    if (typeof datos === 'object' && datos !== null && !Array.isArray(datos)) return datos as Record<string, unknown>
  } catch {
    /* cae al error de abajo */
  }
  throw new ErrorAuth('error', 'id_token_malformado')
}

/**
 * Revisa los datos del id_token: emisor de Google, audiencia = nuestro client id, no vencido, nonce del intento,
 * email presente y verificado. Devuelve el mail normalizado. Lanza ErrorAuth si algo no cierra.
 */
export function validarIdToken(
  idToken: string,
  esperado: { clientId: string; nonce: string },
  ahoraMs: number = Date.now(),
): Identidad {
  const c = decodificarJwt(idToken)

  if (typeof c.iss !== 'string' || !EMISORES.includes(c.iss)) throw new ErrorAuth('error', 'iss_distinto')

  // aud puede ser un texto o una lista; con varias audiencias, azp tiene que ser nuestro client id
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(esperado.clientId)) throw new ErrorAuth('error', 'aud_distinto')
  if (aud.length > 1 && c.azp !== esperado.clientId) throw new ErrorAuth('error', 'azp_distinto')

  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp) || c.exp * 1000 <= ahoraMs) throw new ErrorAuth('error', 'id_token_vencido')

  if (typeof c.nonce !== 'string' || !igualesSeguro(c.nonce, esperado.nonce)) throw new ErrorAuth('error', 'nonce_distinto')

  const email = normalizarEmail(c.email)
  if (!email) throw new ErrorAuth('google_rechazo', 'sin_email')
  if (c.email_verified !== true && c.email_verified !== 'true') throw new ErrorAuth('google_rechazo', 'email_no_verificado')

  return { email, sub: typeof c.sub === 'string' ? c.sub : null }
}
