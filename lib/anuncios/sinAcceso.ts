// ── Cuentas sin acceso (Meta #200): el dueño de la cuenta publicitaria no nos da permiso de lectura ──
// Liviano a propósito (sin next/cache): lo usan el tablero y sus tests.
/** Meta #200: el dueño de la cuenta publicitaria no nos da permiso de lectura (sacó el acceso o nunca lo dio). */
export const esSinPermiso = (e: string): boolean => /\(#200\)|NOT grant ads_management or ads_read/i.test(e)

/** El aviso para Tomás: por nombre de cliente y qué hacer, sin el error crudo de Meta. */
export function avisoSinAcceso(clientes: string[]): string {
  const lista = clientes.length > 1 ? `${clientes.slice(0, -1).join(', ')} y ${clientes.at(-1)}` : clientes[0]
  return `Sin acceso a la cuenta publicitaria de ${lista}. ${clientes.length > 1 ? 'Cada cliente tiene' : 'El cliente tiene'} que volver a darle acceso a su cuenta publicitaria a Gerónimo Actis (Configuración del negocio → Cuentas publicitarias → Asignar personas). Mientras tanto, su gasto y su CPL no se actualizan.`
}
