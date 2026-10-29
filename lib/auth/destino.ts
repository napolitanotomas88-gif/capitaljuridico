// ── Destino posterior al login (parámetro next): sin redirección abierta ─────────────────────
// Solo se acepta una ruta interna: empieza con UNA barra, sin "//", sin "\", sin espacios ni caracteres de control
// (los navegadores ignoran tabs y saltos de línea dentro de una URL, así que "/\t/evil.com" se leería "//evil.com").
// Solo ASCII imprimible: un carácter fuera de Latin-1 (por ejemplo "€") hace fallar al armar el encabezado Location
// y rompería el ingreso con un error genérico, y uno de Latin-1 (por ejemplo "ñ") saldría como un byte suelto no UTF-8.
// Los navegadores mandan las rutas ya codificadas con %XX, así que lo legítimo siempre es ASCII.
// Además se resuelve contra un origen de mentira y tiene que quedar en ese mismo origen.

const ORIGEN_FALSO = 'http://destino.invalid'
const PROHIBIDOS = /[\\\u0000- \u007f-￿]/
const LARGO_MAX = 512
// Volver al login o a las rutas del propio login no tiene sentido (y arma un ida y vuelta)
const NO_VOLVER = ['/entrar', '/api/auth']

/** La ruta interna segura (tal cual vino) o null si no lo es. */
export function rutaInternaSegura(valor: unknown): string | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > LARGO_MAX) return null
  if (valor[0] !== '/' || valor[1] === '/' || valor[1] === '\\') return null
  if (PROHIBIDOS.test(valor)) return null
  let url: URL
  try {
    url = new URL(valor, ORIGEN_FALSO)
  } catch {
    return null
  }
  if (url.origin !== ORIGEN_FALSO) return null
  const ruta = url.pathname.toLowerCase()
  if (NO_VOLVER.some((p) => ruta === p || ruta.startsWith(`${p}/`))) return null
  return valor
}
