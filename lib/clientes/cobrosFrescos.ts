// ── Cobros «frescos» para quien acaba de escribir (13/11/2026) ──────────────────────────────
// Abrir la tarjeta o la ficha de un cliente usa la caché de 45 s de cobrosFinanzas.ts (antes forzaba releer las dos
// planillas en cada apertura). La caché vive en la memoria de cada instancia del servidor: invalidarla donde se escribe
// un pago no alcanza si la pantalla siguiente la arma OTRA instancia. Por eso, después de una acción sobre el cliente,
// el navegador de esa persona lleva esta marca durante un minuto y sus pantallas de Clientes leen los cobros sin caché.
// El resto del equipo ve el pago, como mucho, 45 s después. No guarda ningún dato: solo «1».
export const COOKIE_COBROS_FRESCOS = 'cj_cobros_frescos'
const SEGUNDOS = 60

/** Valor de la cabecera Set-Cookie que deja la marca (solo para /clientes, sin acceso desde JavaScript). */
export function cabeceraCobrosFrescos(): string {
  return `${COOKIE_COBROS_FRESCOS}=1; Max-Age=${SEGUNDOS}; Path=/clientes; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

/** 'fresco' si el pedido trae la marca; si no, la caché de 45 s. */
export function modoCobros(cookies: { has(nombre: string): boolean }): 'fresco' | 'cache' {
  return cookies.has(COOKIE_COBROS_FRESCOS) ? 'fresco' : 'cache'
}
