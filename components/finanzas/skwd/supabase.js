import { createClient } from '@supabase/supabase-js'

// Base de Finanzas SKWD (Supabase, permisos RLS por correo). Dentro del Despacho (1/11/2026):
//   · modo token (el normal): el servidor del Despacho firma el acceso con el correo de la sesión (/api/finanzas/base);
//     no hay otro inicio de sesión. supabase-js pide el token con `accessToken` y lo renueva antes de que venza.
//   · modo login (si falta SUPABASE_JWT_SECRET): el inicio de sesión de la app original (email y contraseña de Supabase).
// `supabase` es un `export let`: los módulos que lo importan ven el cliente que arma FinanzasSkwd al arrancar.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const clave = process.env.NEXT_PUBLIC_SUPABASE_KEY

export const supabaseConfigurado = Boolean(url && clave)
/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
export let supabase = null

let actual = null   // { token, vence (s) }
async function tokenDelDespacho() {
  if (actual && actual.vence - 120 > Date.now() / 1000) return actual.token
  const r = await fetch('/api/finanzas/base', { cache: 'no-store' })
  if (!r.ok) throw new Error(`No se pudo abrir la base (${r.status})`)
  actual = await r.json()
  return actual.token
}

/**
 * Prueba el modo token; si el Despacho no lo da, queda el de login.
 * @returns {Promise<{ modo: 'token' | 'login' | 'sin_config', correo: string | null }>}
 */
export async function prepararBase() {
  if (!supabaseConfigurado) return { modo: 'sin_config', correo: null }
  try {
    await tokenDelDespacho()
    supabase = createClient(url, clave, { accessToken: tokenDelDespacho })
    return { modo: 'token', correo: actual?.correo ?? null }
  } catch {
    supabase = createClient(url, clave)
    return { modo: 'login', correo: null }
  }
}
