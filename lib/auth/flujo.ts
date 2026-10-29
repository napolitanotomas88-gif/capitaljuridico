// ── Flujo de login, callback y salida (lo que hacen las rutas /api/auth/*) ───────────────────
// Funciones Request → Response sin depender de Next, así se prueban con un proveedor de Google simulado.
// Las redirecciones internas usan Location RELATIVO ("/entrar?error=..."): el navegador las resuelve contra el origen
// en el que está, nunca contra un host que venga de un encabezado. Solo la URL de Google es absoluta.
import {
  COOKIE_INTENTO, COOKIE_SESION, DURACION_INTENTO_S, DURACION_SESION_S, RUTA_COOKIE_INTENTO, RUTA_COOKIE_SESION,
  borrarCookie, firmarCookie, igualesSeguro, leerCookie, serializarCookie, verificarCookie,
} from './cookie'
import { rutaInternaSegura } from './destino'
import { ErrorAuth, type CodigoError } from './errores'
import { crearIntento, intercambiarCodigo, leerConfig, urlAutorizacion, validarIdToken } from './google'
import { COOKIE_ANUNCIOS } from '../anuncios/auth'
import { COOKIE_FINANZAS } from '../finanzasAuth'
import { asegurarUsuarios } from './accesos'
import { rutaInicial } from './roles'
import { buscarUsuario } from './usuarios'

function redirigir(ubicacion: string, cookies: string[] = []): Response {
  // 303: el navegador siempre sigue con GET, aunque la petición original haya sido un POST (salir)
  const h = new Headers({ Location: ubicacion, 'Cache-Control': 'no-store' })
  for (const c of cookies) h.append('Set-Cookie', c)
  return new Response(null, { status: 303, headers: h })
}

const aEntrar = (codigo: CodigoError, cookies: string[] = []) => redirigir(`/entrar?error=${codigo}`, cookies)
const limpiarIntento = () => borrarCookie(COOKIE_INTENTO, RUTA_COOKIE_INTENTO)

// Estados ya canjeados. Mejor esfuerzo dentro de un mismo proceso: la garantía real es que el callback borra la cookie
// del intento y que Google acepta cada código una sola vez.
const estadosUsados = new Map<string, number>()
function marcarUsado(state: string, ahoraMs: number): boolean {
  for (const [s, vence] of estadosUsados) if (vence <= ahoraMs) estadosUsados.delete(s)
  if (estadosUsados.has(state)) return false
  estadosUsados.set(state, ahoraMs + DURACION_INTENTO_S * 1000)
  return true
}

/** GET /api/auth/google?next=<ruta interna>: arranca el login y manda a Google. */
export function iniciarLogin(req: Request): Response {
  const cfg = leerConfig()
  if (!cfg.ok) return aEntrar('configuracion')

  const next = rutaInternaSegura(new URL(req.url).searchParams.get('next'))
  const intento = crearIntento()
  const cookie = firmarCookie('intento', { s: intento.state, n: intento.nonce, v: intento.verifier, x: next }, DURACION_INTENTO_S)
  if (!cookie) return aEntrar('configuracion')

  return redirigir(urlAutorizacion(cfg.config, intento), [
    serializarCookie(COOKIE_INTENTO, cookie, DURACION_INTENTO_S, RUTA_COOKIE_INTENTO),
  ])
}

/** GET /api/auth/google/callback: valida el retorno de Google, emite la sesión y redirige. Cualquier falla → /entrar?error=. */
export async function completarLogin(req: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  const limpiar = [limpiarIntento()]
  try {
    const cfg = leerConfig()
    if (!cfg.ok) throw new ErrorAuth('configuracion', 'sin_configuracion')

    const params = new URL(req.url).searchParams
    // La persona canceló o Google rechazó el pedido: no hay código que canjear
    if (params.has('error')) throw new ErrorAuth('google_rechazo', 'google_devolvio_error')

    const intento = verificarCookie('intento', leerCookie(req.headers.get('cookie'), COOKIE_INTENTO))
    if (!intento) throw new ErrorAuth('intento_vencido', 'sin_cookie_de_intento')
    const { s: state, n: nonce, v: verifier, x: next } = intento
    if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string') {
      throw new ErrorAuth('intento_vencido', 'cookie_de_intento_incompleta')
    }

    const recibido = params.get('state')
    if (!recibido || !igualesSeguro(recibido, state)) throw new ErrorAuth('intento_vencido', 'state_distinto')
    if (!marcarUsado(state, Date.now())) throw new ErrorAuth('intento_vencido', 'state_reutilizado')

    const codigo = params.get('code')
    if (!codigo || codigo.length > 2048) throw new ErrorAuth('google_rechazo', 'sin_codigo')

    const idToken = await intercambiarCodigo(cfg.config, codigo, verifier, fetchFn)
    const { email } = validarIdToken(idToken, { clientId: cfg.config.clientId, nonce })

    // Cuenta que no figura en AUTH_USUARIOS: denegada aunque Google la haya verificado
    await asegurarUsuarios()
    const usuario = buscarUsuario(email)
    if (!usuario) throw new ErrorAuth('cuenta_no_autorizada', 'cuenta_no_listada')

    // La cookie solo prueba identidad (mail): nombre y rol se leen de AUTH_USUARIOS en cada petición
    const sesion = firmarCookie('sesion', { e: usuario.email }, DURACION_SESION_S)
    if (!sesion) throw new ErrorAuth('configuracion', 'sin_secreto')

    // "next" viene de una cookie firmada, pero se vuelve a validar: defensa en profundidad contra redirección abierta
    const destino = rutaInternaSegura(next) ?? rutaInicial(usuario)
    return redirigir(destino, [serializarCookie(COOKIE_SESION, sesion, DURACION_SESION_S, RUTA_COOKIE_SESION), ...limpiar])
  } catch (e) {
    if (e instanceof ErrorAuth) {
      console.warn(`[auth] login rechazado: ${e.motivo}`)
      return aEntrar(e.codigo, limpiar)
    }
    // Solo el tipo del error: el mensaje podría citar un trozo del id_token
    console.error(`[auth] fallo inesperado en el login (${e instanceof Error ? e.name : typeof e})`)
    return aEntrar('error', limpiar)
  }
}

/** ¿El POST viene de nuestro propio sitio? Sin Origin (navegadores viejos) se acepta; con Origin tiene que coincidir. */
function origenPropio(req: Request): boolean {
  const origen = req.headers.get('origin')
  if (!origen) return true
  const cfg = leerConfig()
  return origen === (cfg.ok ? cfg.config.baseUrl : new URL(req.url).origin)
}

/** POST /api/auth/salir: borra la sesión y vuelve a /entrar. */
export function cerrarSesion(req: Request): Response {
  if (!origenPropio(req)) return new Response('Origen no permitido', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  // "Salir" cierra TODO lo que esta persona abrió en este navegador: la sesión de Google y también las contraseñas de
  // Finanzas y Anuncios (si no, en una computadora compartida el que sigue entraría directo a las finanzas). Las dos
  // cookies se emitieron con Path=/ y los mismos atributos, así que se borran igual.
  return redirigir('/entrar', [
    borrarCookie(COOKIE_SESION, RUTA_COOKIE_SESION), limpiarIntento(),
    borrarCookie(COOKIE_FINANZAS, '/'), borrarCookie(COOKIE_ANUNCIOS, '/'),
  ])
}

/** GET (y cualquier otro método que no sea POST) en /api/auth/salir: no hace nada, ni toca la cookie. */
export function salirSoloPost(): Response {
  return new Response('Método no permitido', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
}
