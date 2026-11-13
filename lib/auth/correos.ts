// ── Secciones que se abren por MAIL, no por rol (13/11/2026) ──────────────────────────────────────────────────────────
// Algunas pantallas no son de un rol sino de personas puntuales. Hoy: «EOW» (reporte End of Week), que solo ven y editan
// Tomás, la cuenta Empresa y Gero M. La lista vive en una variable de entorno (el repo es público: los mails no van en el
// código) y se lee en cada pedido. Sin la variable, o vacía, NADIE entra (falla cerrado), tampoco un socio.
// Lo usan lib/auth/rutas.ts (regla con `correos`), las páginas (exigirCorreos) y las API (exigirAccesoApi con `correos`).
// Sin imports de Next: se prueba con node:test.
type Entorno = Record<string, string | undefined>

export const LISTAS_CORREOS = ['eow'] as const
export type ListaCorreos = (typeof LISTAS_CORREOS)[number]

/** Variable de entorno de cada lista: mails separados por coma, espacio o punto y coma. */
export const VARIABLE_LISTA: Record<ListaCorreos, string> = { eow: 'EOW_CORREOS' }

const MAIL = /^[^\s@,;]+@[^\s@,;]+$/

/** Los mails de la lista, en minúscula y sin repetidos. Lo que no tiene forma de mail se descarta. */
export function correosDe(lista: ListaCorreos, env: Entorno = process.env): string[] {
  const crudo = String(env[VARIABLE_LISTA[lista]] ?? '')
  return [...new Set(crudo.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => MAIL.test(x)))]
}

/** ¿Este mail está en la lista? Sin mail o sin lista: no. */
export function correoPermitido(lista: ListaCorreos, email: string | null | undefined, env: Entorno = process.env): boolean {
  const e = String(email ?? '').trim().toLowerCase()
  if (!e || !MAIL.test(e)) return false
  return correosDe(lista, env).includes(e)
}
