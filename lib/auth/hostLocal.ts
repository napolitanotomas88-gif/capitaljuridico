// ── ¿La petición viene de esta misma computadora? (solo para la sesión de prueba de desarrollo) ──
// obtenerSesion() entrega un usuario de prueba con CRM_DEV_ROL; sin este control, cualquier equipo de la misma
// red que alcance el servidor de desarrollo vería datos reales de clientes sin login. Se mira el header Host
// (lo que escribió el navegador): entrar por la IP de la red (192.168.x.x) o por un túnel lo deja afuera.
// Es una segunda barrera: la primera es que el servidor de desarrollo escuche solo en 127.0.0.1
// (script "dev" de package.json). El header Host lo puede falsear quien ya llegó al servidor, por eso sola no alcanza.

/** Hosts locales aceptados: localhost, 127.0.0.1, [::1] y *.localhost (con o sin puerto). */
export function esHostLocal(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.trim().toLowerCase()
  // "[::1]:3101" → "[::1]"; "localhost:3101" → "localhost"
  const nombre = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]
  return nombre === 'localhost' || nombre === '127.0.0.1' || nombre === '[::1]' || nombre.endsWith('.localhost')
}

/**
 * La petición es local si su Host lo es y, cuando pasó por un proxy o túnel que informa el host original
 * (x-forwarded-host), ese también lo es.
 */
export function peticionLocal(headers: { get(nombre: string): string | null }): boolean {
  if (!esHostLocal(headers.get('host'))) return false
  const reenviado = headers.get('x-forwarded-host')
  // Con varios proxies el header trae una lista: todos tienen que ser locales (el primero lo puede escribir el cliente)
  return reenviado === null || reenviado.split(',').every(esHostLocal)
}
