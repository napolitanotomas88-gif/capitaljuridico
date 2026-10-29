// ── Entorno de ejecución del acceso (un solo lugar para decidir qué es "producción") ─────────
// Los despliegues de preview de Vercel también compilan con NODE_ENV=production, así que cuentan como producción.

/** Producción real o preview de Vercel: acá el acceso falla cerrado y no se puede torcer con variables de prueba. */
export function enProduccion(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

/**
 * Solo fuera de producción se pueden sobrescribir los endpoints de Google (GOOGLE_AUTH_URL y GOOGLE_TOKEN_URL),
 * que existen únicamente para que los tests usen un proveedor simulado. Si hay NODE_ENV=production o cualquier
 * VERCEL_ENV (production, preview o development), las variables se ignoran: el secreto del cliente nunca viaja a
 * otro host.
 */
export function permiteEndpointsDePrueba(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV
}
