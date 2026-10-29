// Los enlaces internos de /clientes/edicion conservan el modo de ejemplo (?demo=1&como=…) para poder recorrer la pantalla en local.
export function conSufijo(href: string, sufijo: string): string {
  if (!sufijo) return href
  return `${href}${href.includes('?') ? '&' : '?'}${sufijo}`
}
