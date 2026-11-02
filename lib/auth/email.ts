// ── Mail normalizado (lo usan la lista de personas y el portal del cliente) ──────────────────────────────────────
// Separado de usuarios.ts para que lib/auth/portal.ts lo use sin importar la lista (sin ciclos).
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOLO_ASCII_IMPRIMIBLE = /^[\x21-\x7e]+$/
const LARGO_MAX_EMAIL = 254

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
