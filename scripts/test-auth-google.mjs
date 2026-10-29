// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-auth-google.mjs
// Login con Google (lib/auth/*, app/api/auth/*). NUNCA llama a Google: usa un proveedor OIDC simulado en un servidor
// http local que valida redirect_uri, PKCE (S256) y que cada código se use una sola vez, y que emite id_tokens a pedido
// (buenos y rotos). Los mails, el client id y el secreto de acá son inventados.
import { test, describe, before, after, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import {
  COOKIE_INTENTO, COOKIE_SESION, DURACION_INTENTO_S, DURACION_SESION_S, RUTA_COOKIE_INTENTO, RUTA_COOKIE_SESION,
  borrarCookie, firmarCookie, leerCookie, leerSecret, serializarCookie, verificarCookie,
} from '../lib/auth/cookie.ts'
import { rutaInternaSegura } from '../lib/auth/destino.ts'
import { ErrorAuth } from '../lib/auth/errores.ts'
import {
  GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, desafioPkce, endpointAutorizacion, endpointToken, intercambiarCodigo, leerConfig,
  urlAutorizacion, validarIdToken,
} from '../lib/auth/google.ts'
import { completarLogin } from '../lib/auth/flujo.ts'
import { sesionDesdeCookie } from '../lib/auth/identidad.ts'
import { MATRIZ_ROLES, puedeVer, rutaInicial } from '../lib/auth/roles.ts'
import { SECCIONES } from '../lib/auth/roles.ts'
import { buscarUsuario, hayUsuarios, normalizarEmail, parsearUsuarios } from '../lib/auth/usuarios.ts'
import { GET as rutaIniciar } from '../app/api/auth/google/route.ts'
import { GET as rutaCallback } from '../app/api/auth/google/callback/route.ts'
import { GET as rutaSalirGet, POST as rutaSalirPost } from '../app/api/auth/salir/route.ts'

// ── Entorno de prueba ─────────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:3101'
const BASE_PROD = 'https://panel.ejemplo.test'
const CLIENT_ID = 'cliente-prueba.apps.googleusercontent.com'
const CLIENT_SECRET = 'secreto-de-prueba'
const SECRET = randomBytes(48).toString('base64url')
const USUARIOS = [
  { email: 'Ana.Socia@ejemplo.test', nombre: 'Ana', rol: 'socio' },
  { email: 'cami@ejemplo.test', nombre: 'Cami', rol: 'csm' },
  { email: 'lu@ejemplo.test', nombre: 'Lu', rol: 'closer' },
]
const VARIABLES = [
  'NODE_ENV', 'VERCEL_ENV', 'AUTH_SECRET', 'AUTH_USUARIOS', 'AUTH_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GOOGLE_AUTH_URL', 'GOOGLE_TOKEN_URL', 'CRM_DEV_ROL',
]

const entorno = (extra = {}) => {
  const e = {
    NODE_ENV: undefined, VERCEL_ENV: undefined, CRM_DEV_ROL: undefined,
    AUTH_SECRET: SECRET, AUTH_USUARIOS: JSON.stringify(USUARIOS), AUTH_BASE_URL: BASE,
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_AUTH_URL: undefined, GOOGLE_TOKEN_URL: undefined,
    ...extra,
  }
  for (const v of VARIABLES) {
    if (e[v] === undefined) delete process.env[v]
    else process.env[v] = e[v]
  }
}
const enProduccion = (extra = {}) => entorno({ NODE_ENV: 'production', AUTH_BASE_URL: BASE_PROD, ...extra })

let guardado
const registro = []   // todo lo que el código registró con console.warn/error: no puede tener mails ni tokens
beforeEach(() => {
  guardado = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
  entorno()
  registro.length = 0
  mock.method(console, 'warn', (...a) => registro.push(a.join(' ')))
  mock.method(console, 'error', (...a) => registro.push(a.join(' ')))
})
afterEach(() => {
  mock.restoreAll()
  for (const v of VARIABLES) {
    if (guardado[v] === undefined) delete process.env[v]
    else process.env[v] = guardado[v]
  }
  for (const linea of registro) {
    assert.ok(!/@|ejemplo\.test|eyJ/.test(linea), `el log no puede llevar mails ni tokens: ${linea}`)
  }
})

// ── Utilidades ────────────────────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'JWT', kid: 'prueba' })}.${b64(claims)}.${randomBytes(32).toString('base64url')}`
const setCookies = (res) => res.headers.getSetCookie()
const cookieEmitida = (res, nombre) => setCookies(res).find((c) => c.startsWith(`${nombre}=`))
const valorEmitido = (res, nombre) => cookieEmitida(res, nombre)?.slice(nombre.length + 1).split(';')[0]
const decodificar = (valor) => JSON.parse(Buffer.from(valor.split('.')[1], 'base64url').toString('utf8'))
const ahora = () => Date.now()

function esperarError(res, codigo) {
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), `/entrar?error=${codigo}`)
  assert.equal(cookieEmitida(res, COOKIE_SESION), undefined, 'un login fallido no puede emitir sesión')
  const borrada = cookieEmitida(res, COOKIE_INTENTO)
  assert.ok(borrada && /Max-Age=0/.test(borrada) && borrada.startsWith(`${COOKIE_INTENTO}=;`), 'el intento tiene que quedar borrado')
}

// ── Proveedor OIDC simulado ───────────────────────────────────────────────────────────────
function crearProveedor() {
  const p = {
    url: '',
    cuenta: { email: 'ana.socia@ejemplo.test', email_verified: true, name: 'Ana', sub: '1001' },
    claims: {},                 // se pisan encima de los claims normales (undefined = quitar el claim)
    rechazarCanje: false,       // el token endpoint contesta 400
    visitas: { auth: 0, token: 0 },
    codigos: new Map(),
  }
  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.method === 'GET' && u.pathname === '/auth') {
      p.visitas.auth++
      const q = u.searchParams
      const mal = (m) => { res.writeHead(400); res.end(m) }
      if (q.get('client_id') !== CLIENT_ID) return mal('client_id')
      if (q.get('response_type') !== 'code') return mal('response_type')
      if (q.get('redirect_uri') !== `${BASE}/api/auth/google/callback`) return mal('redirect_uri')
      if (q.get('scope') !== 'openid email profile') return mal('scope')
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return mal('pkce')
      if (!q.get('state') || !q.get('nonce')) return mal('state/nonce')
      if (q.get('prompt') !== 'select_account') return mal('prompt')
      const code = randomBytes(24).toString('base64url')
      p.codigos.set(code, { nonce: q.get('nonce'), desafio: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), usado: false })
      res.writeHead(302, { Location: `${q.get('redirect_uri')}?code=${code}&state=${q.get('state')}` })
      return res.end()
    }
    if (req.method === 'POST' && u.pathname === '/token') {
      p.visitas.token++
      let cuerpo = ''
      for await (const t of req) cuerpo += t
      const f = new URLSearchParams(cuerpo)
      const rechazo = (e) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e })) }
      const c = p.codigos.get(f.get('code'))
      if (p.rechazarCanje || !c) return rechazo('invalid_grant')
      if (c.usado) return rechazo('invalid_grant')   // un código sirve una sola vez
      c.usado = true
      if (f.get('grant_type') !== 'authorization_code') return rechazo('unsupported_grant_type')
      if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== CLIENT_SECRET) return rechazo('invalid_client')
      if (f.get('redirect_uri') !== c.redirectUri) return rechazo('redirect_uri_mismatch')
      const desafio = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url')
      if (desafio !== c.desafio) return rechazo('invalid_grant')   // PKCE
      const t = Math.floor(Date.now() / 1000)
      const claims = {
        iss: 'https://accounts.google.com', azp: CLIENT_ID, aud: CLIENT_ID, sub: p.cuenta.sub, email: p.cuenta.email,
        email_verified: p.cuenta.email_verified, name: p.cuenta.name, nonce: c.nonce, iat: t, exp: t + 3600, ...p.claims,
      }
      for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k]
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ access_token: 'no-se-usa', token_type: 'Bearer', expires_in: 3599, id_token: jwt(claims) }))
    }
    res.writeHead(404)
    res.end()
  })
  p.iniciar = () => new Promise((ok) => servidor.listen(0, '127.0.0.1', () => { p.url = `http://127.0.0.1:${servidor.address().port}`; ok() }))
  p.cerrar = () => new Promise((ok) => { servidor.closeAllConnections(); servidor.close(ok) })
  p.reiniciar = () => { p.claims = {}; p.rechazarCanje = false; p.cuenta = { email: 'ana.socia@ejemplo.test', email_verified: true, name: 'Ana', sub: '1001' }; p.visitas = { auth: 0, token: 0 } }
  return p
}

// El "navegador": arranca el login, pasa por el proveedor y devuelve el retorno que Google le daría a /callback
async function arrancar(proveedor, next) {
  const q = next === undefined ? '' : `?next=${encodeURIComponent(next)}`
  const inicio = rutaIniciar(new Request(`${BASE}/api/auth/google${q}`))
  assert.equal(inicio.status, 303)
  const urlGoogle = new URL(inicio.headers.get('location'))
  const intento = valorEmitido(inicio, COOKIE_INTENTO)
  const vuelta = await fetch(urlGoogle, { redirect: 'manual' })
  assert.equal(vuelta.status, 302, 'el proveedor tiene que aceptar la URL de autorización')
  return { inicio, urlGoogle, intento, retorno: new URL(vuelta.headers.get('location')) }
}
const callback = (retorno, intento) =>
  rutaCallback(new Request(retorno, { headers: intento ? { cookie: `${COOKIE_INTENTO}=${intento}` } : {} }))

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('cookie firmada', () => {
  test('ida y vuelta: carga, emisión y vencimiento a 7 días', () => {
    const t = ahora()
    const v = firmarCookie('sesion', { e: 'ana@ejemplo.test' }, DURACION_SESION_S, t)
    assert.match(v, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const d = verificarCookie('sesion', v)
    assert.equal(d.e, 'ana@ejemplo.test')
    assert.equal(d.exp - d.iat, 7 * 24 * 3600)
    assert.equal(DURACION_SESION_S, 604800)
    assert.equal(DURACION_INTENTO_S, 600)
  })

  test('"iat" y "exp" de la carga no pueden pisar los que pone la función', () => {
    const t = ahora()
    const v = firmarCookie('sesion', { e: 'x@ejemplo.test', exp: 9_999_999_999, iat: 1 }, 60, t)
    const d = decodificar(v)
    assert.equal(d.iat, Math.floor(t / 1000))
    assert.equal(d.exp, Math.floor(t / 1000) + 60)
  })

  test('manipulada: cambiar la carga con la firma vieja, firma alterada, truncada o con otra versión', () => {
    const v = firmarCookie('sesion', { e: 'cami@ejemplo.test' }, DURACION_SESION_S)
    const [ver, cuerpo, firma] = v.split('.')
    const datos = decodificar(v)
    const otro = Buffer.from(JSON.stringify({ ...datos, e: 'ana.socia@ejemplo.test' })).toString('base64url')
    const alterada = (firma[0] === 'A' ? 'B' : 'A') + firma.slice(1)
    for (const malo of [
      `${ver}.${otro}.${firma}`,            // carga cambiada, firma vieja
      `${ver}.${cuerpo}.${alterada}`,       // firma con un carácter distinto
      `${ver}.${cuerpo}.${firma}=`,         // misma firma con relleno: otra forma de escribir lo mismo tampoco vale
      `${ver}.${cuerpo}.${firma.slice(0, 10)}`,
      `${ver}.${cuerpo}.`,
      `v2.${cuerpo}.${firma}`,
      `${cuerpo}.${firma}`,
      `${v}.extra`,
      '', 'x', 'v1..', '...', 'v1.e30.e30', 'a'.repeat(5000), `${v}${'A'.repeat(3000)}`,
    ]) {
      assert.equal(verificarCookie('sesion', malo), null, malo.slice(0, 40))
      assert.equal(sesionDesdeCookie(malo), null)
    }
    assert.equal(verificarCookie('sesion', null), null)
    assert.equal(verificarCookie('sesion', undefined), null)
    assert.ok(verificarCookie('sesion', v), 'la original sigue valiendo')
  })

  test('una cookie firmada con otro secreto no vale', () => {
    const v = firmarCookie('sesion', { e: 'ana.socia@ejemplo.test' }, DURACION_SESION_S)
    process.env.AUTH_SECRET = randomBytes(48).toString('base64url')
    assert.equal(verificarCookie('sesion', v), null)
  })

  test('el propósito está firmado: un intento no sirve de sesión ni al revés', () => {
    const intento = firmarCookie('intento', { e: 'ana.socia@ejemplo.test' }, DURACION_INTENTO_S)
    const sesion = firmarCookie('sesion', { s: 'x' }, DURACION_SESION_S)
    assert.equal(verificarCookie('sesion', intento), null)
    assert.equal(sesionDesdeCookie(intento), null)
    assert.equal(verificarCookie('intento', sesion), null)
  })

  test('vencida: vale hasta el último segundo y no desde el vencimiento', () => {
    const t = ahora()
    const v = firmarCookie('sesion', { e: 'ana.socia@ejemplo.test' }, DURACION_SESION_S, t)
    const iat = Math.floor(t / 1000)
    assert.ok(verificarCookie('sesion', v, (iat + DURACION_SESION_S) * 1000 - 1))
    assert.equal(verificarCookie('sesion', v, (iat + DURACION_SESION_S) * 1000), null)
    const vieja = firmarCookie('sesion', { e: 'ana.socia@ejemplo.test' }, DURACION_SESION_S, t - 8 * 24 * 3600 * 1000)
    assert.equal(verificarCookie('sesion', vieja), null)
    assert.equal(sesionDesdeCookie(vieja), null)
  })

  test('AUTH_SECRET ausente, corto o repetitivo: no se firma ni se verifica nada', () => {
    const valida = firmarCookie('sesion', { e: 'ana.socia@ejemplo.test' }, DURACION_SESION_S)
    assert.ok(valida)
    for (const malo of [undefined, '', '   ', 'a'.repeat(31), 'abc123'.repeat(7), 'a'.repeat(64)]) {
      entorno({ AUTH_SECRET: malo })
      assert.equal(leerSecret(), null, String(malo))
      assert.equal(firmarCookie('sesion', { e: 'x@ejemplo.test' }, 60), null)
      assert.equal(verificarCookie('sesion', valida), null, 'ni siquiera la cookie que era válida')
      assert.equal(sesionDesdeCookie(valida), null)
    }
    entorno({ AUTH_SECRET: randomBytes(24).toString('base64url') })   // 32 caracteres justos
    assert.ok(leerSecret())
  })

  test('Set-Cookie: HttpOnly, SameSite=Lax, Path y Max-Age; Secure solo en producción', () => {
    const sesion = serializarCookie(COOKIE_SESION, 'v1.abc.def', DURACION_SESION_S, RUTA_COOKIE_SESION)
    assert.equal(sesion, 'cj_sesion=v1.abc.def; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax')
    const intento = serializarCookie(COOKIE_INTENTO, 'v1.abc.def', DURACION_INTENTO_S, RUTA_COOKIE_INTENTO)
    assert.equal(intento, 'cj_intento=v1.abc.def; Path=/api/auth/google; Max-Age=600; HttpOnly; SameSite=Lax')
    assert.match(borrarCookie(COOKIE_SESION, '/'), /^cj_sesion=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/)

    enProduccion()
    assert.match(serializarCookie(COOKIE_SESION, 'v1.abc.def', 60, '/'), /; HttpOnly; SameSite=Lax; Secure$/)
    assert.match(borrarCookie(COOKIE_SESION, '/'), /; Secure$/)
    entorno({ NODE_ENV: undefined, VERCEL_ENV: 'production' })
    assert.match(serializarCookie(COOKIE_SESION, 'v1.abc.def', 60, '/'), /; Secure$/)
  })

  test('el valor de la cookie no puede inyectar encabezados', () => {
    for (const malo of ['a;b', 'a\r\nSet-Cookie: x=y', 'a b', 'a=b', 'ñ']) {
      assert.throws(() => serializarCookie('cj_sesion', malo, 60, '/'), /inválido/)
    }
  })

  test('leerCookie: busca por nombre exacto dentro del encabezado', () => {
    const h = 'otra=1; cj_sesion=v1.a.b; cj_sesion2=zzz;  cj_intento=v1.c.d'
    assert.equal(leerCookie(h, 'cj_sesion'), 'v1.a.b')
    assert.equal(leerCookie(h, 'cj_intento'), 'v1.c.d')
    assert.equal(leerCookie(h, 'sesion'), undefined)
    assert.equal(leerCookie(null, 'cj_sesion'), undefined)
    assert.equal(leerCookie('', 'cj_sesion'), undefined)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('AUTH_USUARIOS', () => {
  test('normaliza mails a minúsculas, sin espacios, y encuentra sin distinguir mayúsculas', () => {
    assert.equal(normalizarEmail('  Ana.Socia@Ejemplo.TEST '), 'ana.socia@ejemplo.test')
    assert.equal(buscarUsuario('ANA.SOCIA@ejemplo.test').nombre, 'Ana')
    assert.equal(buscarUsuario(' cami@ejemplo.test ').rol, 'csm')
    for (const malo of [null, undefined, 42, '', 'sin-arroba', 'a@b', 'a b@c.d', {}]) assert.equal(buscarUsuario(malo), null)
  })

  test('mails parecidos o con caracteres que no son ASCII no se confunden con uno listado (Kelvin, homógrafos, ancho completo)', () => {
    // toLowerCase() convierte el signo Kelvin (U+212A) en una "k" común: sin el control de ASCII, ese mail entraba como "kari@"
    assert.equal('\u212aari@ejemplo.test'.toLowerCase(), 'kari@ejemplo.test', 'premisa: toLowerCase() lo baja a ASCII')
    const lista = JSON.stringify([{ email: 'kari@ejemplo.test', nombre: 'Kari', rol: 'csm' }, { email: 'ana@ejemplo.test', nombre: 'Ana', rol: 'socio' }])
    entorno({ AUTH_USUARIOS: lista })
    assert.equal(buscarUsuario('Kari@ejemplo.test').nombre, 'Kari', 'control: el mail común sí entra')
    for (const parecido of [
      '\u212aari@ejemplo.test', 'an\u0430@ejemplo.test', 'ana@ejemp\u043flo.test', '\uff41na@ejemplo.test', 'ana@ejemplo\u3002test',
      'ana\u200b@ejemplo.test', 'ana@ejemplo.test\u0000', 'ana@ejemplo.test\nx@evil.com', 'ana+x@ejemplo.test', 'ana@sub.ejemplo.test',
      'ana@ejemplo.test.evil.com', 'ana@ejemplo.test.', 'cam\u0130@ejemplo.test', '\u00e1na@ejemplo.test',
    ]) {
      assert.equal(buscarUsuario(parecido), null, JSON.stringify(parecido))
    }
    for (const malo of ['\u212aari@ejemplo.test', 'k\u00e1ri@ejemplo.test', 'kari@eje\u2028mplo.test']) assert.equal(normalizarEmail(malo), null, JSON.stringify(malo))
    // Una entrada de la lista con caracteres raros se ignora (con aviso) en vez de normalizarse a otro mail
    const avisos = []
    const ignorada = parsearUsuarios(JSON.stringify([{ email: '\u212aari@ejemplo.test', nombre: 'Kari', rol: 'socio' }]), (m) => avisos.push(m))
    assert.deepEqual(ignorada, [])
    assert.equal(avisos.length, 1)
    // Los espacios de los costados y las mayúsculas siguen siendo válidos
    assert.equal(normalizarEmail('\u00a0 KARI@Ejemplo.Test \n'), 'kari@ejemplo.test')
  })

  test('cuenta no listada: acceso denegado; sin variable o con lista vacía no hay nadie', () => {
    assert.equal(buscarUsuario('intrusa@ejemplo.test'), null)
    for (const v of [undefined, '', '   ', '[]']) {
      entorno({ AUTH_USUARIOS: v })
      assert.equal(hayUsuarios(), false)
      assert.equal(buscarUsuario('ana.socia@ejemplo.test'), null)
    }
  })

  test('ignora entradas inválidas con aviso que no lleva mails', () => {
    const avisos = []
    const lista = parsearUsuarios(
      JSON.stringify([
        { email: 'ok@ejemplo.test', nombre: 'Ok', rol: 'socio' },
        { email: 'sin-rol@ejemplo.test', nombre: 'X', rol: 'admin' },
        { email: 'sin-nombre@ejemplo.test', rol: 'csm' },
        { email: 'no-es-mail', nombre: 'X', rol: 'csm' },
        { email: 'largo@ejemplo.test', nombre: 'N'.repeat(81), rol: 'csm' },
        'texto', null, 7, [],
        { email: 'otro@ejemplo.test', nombre: ' Otro ', rol: 'setter' },
      ]),
      (m) => avisos.push(m),
    )
    assert.deepEqual(lista.map((u) => u.email), ['ok@ejemplo.test', 'otro@ejemplo.test'])
    assert.equal(lista[1].nombre, 'Otro')
    assert.equal(avisos.length, 8)
    assert.ok(avisos.every((a) => !a.includes('@') && !a.includes('ejemplo')), 'los avisos no llevan mails')
  })

  test('JSON roto o que no es una lista: nadie queda autorizado, sin citar el contenido', () => {
    for (const crudo of ['{no es json', '{"email":"a@ejemplo.test"}', '"texto"', '42']) {
      const avisos = []
      assert.deepEqual(parsearUsuarios(crudo, (m) => avisos.push(m)), [])
      assert.equal(avisos.length, 1)
      assert.ok(!avisos[0].includes('ejemplo') && !avisos[0].includes('{no'), avisos[0])
    }
  })

  test('mail repetido: igual rol = una entrada; roles distintos = se descartan todas (falla cerrado)', () => {
    const avisos = []
    const lista = parsearUsuarios(
      JSON.stringify([
        { email: 'dup@ejemplo.test', nombre: 'A', rol: 'csm' },
        { email: 'DUP@ejemplo.test', nombre: 'A2', rol: 'csm' },
        { email: 'choque@ejemplo.test', nombre: 'B', rol: 'csm' },
        { email: 'Choque@ejemplo.test', nombre: 'B', rol: 'socio' },
        { email: 'solo@ejemplo.test', nombre: 'C', rol: 'closer' },
      ]),
      (m) => avisos.push(m),
    )
    assert.deepEqual(lista.map((u) => u.email).sort(), ['dup@ejemplo.test', 'solo@ejemplo.test'])
    assert.equal(avisos.length, 1)
    assert.ok(!avisos[0].includes('@'))
  })

  test('al cambiar la variable se vuelve a leer (el parseo no queda pegado)', () => {
    assert.equal(buscarUsuario('lu@ejemplo.test').rol, 'closer')
    entorno({ AUTH_USUARIOS: JSON.stringify([{ email: 'lu@ejemplo.test', nombre: 'Lu', rol: 'setter' }]) })
    assert.equal(buscarUsuario('lu@ejemplo.test').rol, 'setter')
    assert.equal(buscarUsuario('ana.socia@ejemplo.test'), null)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('destino posterior al login (next)', () => {
  test('acepta rutas internas', () => {
    for (const ok of ['/', '/clientes', '/clientes/abc-123?x=1&y=a%20b#h', '/ventas', '/finanzas', '/%5Cevil.com']) {
      assert.equal(rutaInternaSegura(ok), ok, ok)
    }
  })

  test('rechaza todo lo que pueda salir del sitio o romper la respuesta', () => {
    for (const malo of [
      '//evil.com', '///evil.com', '/\\evil.com', '\\\\evil.com', '\\/evil.com', 'https://evil.com', 'http://evil.com/x',
      'javascript:alert(1)', 'data:text/html,hola', 'evil.com', 'clientes', '', ' /clientes', '/ruta con espacio',
      '/\t/evil.com', '/\n/evil.com', '/\r\nSet-Cookie: a=b', '/a\u0000b', '/a\u0085b', '/a\\b',
      // Fuera de ASCII: un carácter que no entra en Latin-1 rompe el encabezado Location y uno de Latin-1 saldría como byte suelto
      '/\u20ac', '/\u00f1', '/a\u2028b', '/a\u202ebc', '/\u0430dmin', '/\ud83d\ude00', '/\uff0fevil.com', '/clientes?q=\u00f1and\u00fa',
      '/entrar', '/entrar?error=error', '/api/auth/google', '/api/auth/google/callback', '/API/AUTH/salir',
      '/' + 'a'.repeat(600),
      null, undefined, 42, {}, ['/clientes'],
    ]) {
      assert.equal(rutaInternaSegura(malo), null, JSON.stringify(malo)?.slice(0, 50))
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('validarIdToken', () => {
  const t = ahora()
  const base = (extra = {}) => ({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, sub: '1', email: 'Ana.Socia@ejemplo.test',
    email_verified: true, nonce: 'nonce-123', iat: Math.floor(t / 1000), exp: Math.floor(t / 1000) + 3600, ...extra,
  })
  const validar = (claims, nonce = 'nonce-123') => validarIdToken(jwt(claims), { clientId: CLIENT_ID, nonce }, t)
  const falla = (claims, codigo, motivo, nonce) =>
    assert.throws(
      () => validar(claims, nonce),
      (e) => e instanceof ErrorAuth && e.codigo === codigo && e.motivo === motivo,
      motivo,
    )

  test('token correcto: devuelve el mail normalizado', () => {
    assert.deepEqual(validar(base()), { email: 'ana.socia@ejemplo.test', sub: '1' })
  })

  test('emisor: acepta las dos formas de Google y nada más', () => {
    assert.ok(validar(base({ iss: 'accounts.google.com' })))
    for (const iss of ['https://evil.com', 'https://accounts.google.com.evil.com', 'http://accounts.google.com', undefined, 7]) {
      falla(base({ iss }), 'error', 'iss_distinto')
    }
  })

  test('audiencia: tiene que ser nuestro client id (texto o lista con azp)', () => {
    falla(base({ aud: 'otro-cliente.apps.googleusercontent.com' }), 'error', 'aud_distinto')
    falla(base({ aud: undefined }), 'error', 'aud_distinto')
    falla(base({ aud: [] }), 'error', 'aud_distinto')
    assert.ok(validar(base({ aud: [CLIENT_ID] })))
    assert.ok(validar(base({ aud: ['otro', CLIENT_ID], azp: CLIENT_ID })))
    falla(base({ aud: ['otro', CLIENT_ID], azp: 'otro' }), 'error', 'azp_distinto')
    falla(base({ aud: ['otro', CLIENT_ID], azp: undefined }), 'error', 'azp_distinto')
  })

  test('vencimiento: exp en el pasado, igual a ahora, ausente o que no es número', () => {
    falla(base({ exp: Math.floor(t / 1000) - 3600 }), 'error', 'id_token_vencido')
    falla(base({ exp: Math.floor(t / 1000) }), 'error', 'id_token_vencido')
    falla(base({ exp: undefined }), 'error', 'id_token_vencido')
    falla(base({ exp: String(Math.floor(t / 1000) + 3600) }), 'error', 'id_token_vencido')
  })

  test('nonce: igual al del intento, y presente', () => {
    falla(base({ nonce: 'otro' }), 'error', 'nonce_distinto')
    falla(base({ nonce: undefined }), 'error', 'nonce_distinto')
    falla(base(), 'error', 'nonce_distinto', 'distinto-del-token')
  })

  test('email: presente y verificado (true o "true"; falso, ausente o texto raro = rechazo)', () => {
    assert.ok(validar(base({ email_verified: 'true' })))
    for (const v of [false, 'false', undefined, 1, 'yes']) falla(base({ email_verified: v }), 'google_rechazo', 'email_no_verificado')
    for (const email of [undefined, '', 'sin-arroba', 42, null]) falla(base({ email }), 'google_rechazo', 'sin_email')
  })

  test('token malformado', () => {
    for (const malo of ['', 'a.b', 'a.b.c.d', 'a..c', '.b.c', 'a.@@@.c', `a.${Buffer.from('[1]').toString('base64url')}.c`, `a.${Buffer.from('"x"').toString('base64url')}.c`]) {
      assert.throws(() => validarIdToken(malo, { clientId: CLIENT_ID, nonce: 'n' }, t), (e) => e instanceof ErrorAuth && e.motivo === 'id_token_malformado', malo)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('configuración y endpoints (sin red)', () => {
  test('en producción falta cualquiera de las variables obligatorias: login cerrado, sin cookies', () => {
    enProduccion()
    assert.equal(leerConfig().ok, true)
    for (const v of ['AUTH_SECRET', 'AUTH_USUARIOS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_BASE_URL']) {
      enProduccion({ [v]: undefined })
      const c = leerConfig()
      assert.equal(c.ok, false, v)
      assert.deepEqual(c.faltan, [v])
      const res = rutaIniciar(new Request(`${BASE_PROD}/api/auth/google`))
      assert.equal(res.status, 303)
      assert.equal(res.headers.get('location'), '/entrar?error=configuracion')
      assert.deepEqual(setCookies(res), [], `${v}: no puede emitir cookies`)
    }
  })

  test('AUTH_SECRET corto o AUTH_USUARIOS roto también cuentan como no configurado', () => {
    enProduccion({ AUTH_SECRET: 'a'.repeat(31) })
    assert.deepEqual(leerConfig().faltan, ['AUTH_SECRET'])
    enProduccion({ AUTH_USUARIOS: '{roto' })
    assert.deepEqual(leerConfig().faltan, ['AUTH_USUARIOS'])
    enProduccion({ AUTH_USUARIOS: '[]' })
    assert.deepEqual(leerConfig().faltan, ['AUTH_USUARIOS'])
  })

  test('el aviso de configuración nombra variables, nunca valores', () => {
    enProduccion({ AUTH_SECRET: undefined, GOOGLE_CLIENT_SECRET: undefined })
    leerConfig()
    const aviso = registro.join('\n')
    assert.match(aviso, /AUTH_SECRET/)
    assert.ok(!aviso.includes(CLIENT_ID))
  })

  test('AUTH_BASE_URL: en producción solo https; en desarrollo se asume localhost:3101 y se acepta http', () => {
    enProduccion({ AUTH_BASE_URL: 'http://panel.ejemplo.test' })
    assert.deepEqual(leerConfig().faltan, ['AUTH_BASE_URL'])
    enProduccion({ AUTH_BASE_URL: 'esto no es una url' })
    assert.deepEqual(leerConfig().faltan, ['AUTH_BASE_URL'])
    enProduccion({ AUTH_BASE_URL: `${BASE_PROD}/algo/mas/` })
    assert.equal(leerConfig().config.baseUrl, BASE_PROD, 'se queda con el origen')
    assert.equal(leerConfig().config.redirectUri, `${BASE_PROD}/api/auth/google/callback`)
    entorno({ AUTH_BASE_URL: undefined })
    assert.equal(leerConfig().config.baseUrl, 'http://localhost:3101')
  })

  test('GOOGLE_AUTH_URL y GOOGLE_TOKEN_URL solo se respetan fuera de producción', () => {
    const pruebaAuth = 'http://127.0.0.1:9999/auth'
    const pruebaToken = 'http://127.0.0.1:9999/token'
    const config = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, baseUrl: BASE, redirectUri: `${BASE}/api/auth/google/callback` }

    entorno({ GOOGLE_AUTH_URL: pruebaAuth, GOOGLE_TOKEN_URL: pruebaToken })
    assert.equal(endpointAutorizacion(), pruebaAuth, 'control: en desarrollo sí se sobrescribe')
    assert.equal(endpointToken(), pruebaToken)

    const casos = [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', VERCEL_ENV: 'production' },
      { NODE_ENV: 'production', VERCEL_ENV: 'preview' },
      { NODE_ENV: 'development', VERCEL_ENV: 'preview' },     // cualquier VERCEL_ENV las bloquea
      { NODE_ENV: 'development', VERCEL_ENV: 'development' },
      { NODE_ENV: undefined, VERCEL_ENV: 'production' },
    ]
    for (const caso of casos) {
      entorno({ ...caso, GOOGLE_AUTH_URL: pruebaAuth, GOOGLE_TOKEN_URL: pruebaToken })
      assert.equal(endpointAutorizacion(), GOOGLE_AUTH_URL, JSON.stringify(caso))
      assert.equal(endpointToken(), GOOGLE_TOKEN_URL, JSON.stringify(caso))
      assert.ok(urlAutorizacion(config, { state: 's', nonce: 'n', verifier: 'v' }).startsWith(`${GOOGLE_AUTH_URL}?`))
    }
  })

  test('en producción el canje de código va a Google aunque GOOGLE_TOKEN_URL esté seteado', async () => {
    enProduccion({ GOOGLE_TOKEN_URL: 'http://127.0.0.1:9999/token', GOOGLE_AUTH_URL: 'http://127.0.0.1:9999/auth' })
    const visto = []
    const falso = async (url, init) => {
      visto.push({ url: String(url), cuerpo: String(init.body) })
      return new Response(JSON.stringify({ id_token: 'x.y.z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const config = leerConfig().config
    assert.equal(await intercambiarCodigo(config, 'codigo-1', 'verificador-1', falso), 'x.y.z')
    assert.equal(visto.length, 1)
    assert.equal(visto[0].url, 'https://oauth2.googleapis.com/token')
    const f = new URLSearchParams(visto[0].cuerpo)
    assert.equal(f.get('grant_type'), 'authorization_code')
    assert.equal(f.get('code_verifier'), 'verificador-1')
    assert.equal(f.get('redirect_uri'), `${BASE_PROD}/api/auth/google/callback`)
  })

  test('canje: 4xx de Google = google_rechazo; 5xx, red caída o respuesta rara = error', async () => {
    const config = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, baseUrl: BASE, redirectUri: `${BASE}/x` }
    const con = (r) => async () => r
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status })
    const ve = (fetchFn, codigo, motivo) =>
      assert.rejects(intercambiarCodigo(config, 'c', 'v', fetchFn), (e) => e instanceof ErrorAuth && e.codigo === codigo && e.motivo === motivo)
    await ve(con(json({ error: 'invalid_grant' }, 400)), 'google_rechazo', 'token_http_400')
    await ve(con(json({}, 401)), 'google_rechazo', 'token_http_401')
    await ve(con(json({}, 500)), 'error', 'token_http_500')
    await ve(con(new Response('<html>', { status: 200 })), 'error', 'token_respuesta_ilegible')
    await ve(con(json({ access_token: 'x' })), 'error', 'token_sin_id_token')
    await ve(async () => { throw new TypeError('fetch failed') }, 'error', 'token_sin_respuesta')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('login completo contra el proveedor simulado', () => {
  const proveedor = crearProveedor()
  before(() => proveedor.iniciar())
  after(() => proveedor.cerrar())
  beforeEach(() => {
    proveedor.reiniciar()
    entorno({ GOOGLE_AUTH_URL: `${proveedor.url}/auth`, GOOGLE_TOKEN_URL: `${proveedor.url}/token` })
  })

  test('camino feliz: URL de Google con PKCE, state y nonce; sesión HttpOnly de 7 días; vuelta a la primera sección', async () => {
    const { inicio, urlGoogle, intento, retorno } = await arrancar(proveedor)

    // Lo que se le manda a Google
    const q = urlGoogle.searchParams
    assert.equal(`${urlGoogle.origin}${urlGoogle.pathname}`, `${proveedor.url}/auth`)
    assert.equal(q.get('client_id'), CLIENT_ID)
    assert.equal(q.get('redirect_uri'), `${BASE}/api/auth/google/callback`)
    assert.equal(q.get('response_type'), 'code')
    assert.equal(q.get('scope'), 'openid email profile')
    assert.equal(q.get('code_challenge_method'), 'S256')
    assert.equal(q.get('prompt'), 'select_account')
    assert.ok(q.get('state').length >= 43 && q.get('nonce').length >= 43)
    assert.notEqual(q.get('state'), q.get('nonce'))
    assert.ok(!urlGoogle.href.includes(CLIENT_SECRET), 'el secreto del cliente nunca viaja por la URL')
    const datosIntento = verificarCookie('intento', intento)
    assert.equal(desafioPkce(datosIntento.v), q.get('code_challenge'))
    assert.equal(datosIntento.s, q.get('state'))
    assert.equal(datosIntento.n, q.get('nonce'))
    assert.ok(!urlGoogle.href.includes(datosIntento.v), 'el code_verifier no sale en la URL')
    assert.equal(cookieEmitida(inicio, COOKIE_INTENTO), `cj_intento=${intento}; Path=/api/auth/google; Max-Age=600; HttpOnly; SameSite=Lax`)
    assert.equal(inicio.headers.get('cache-control'), 'no-store')

    // Retorno de Google → sesión
    const res = await callback(retorno, intento)
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/', 'socio: la primera sección es Resumen')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const sesion = cookieEmitida(res, COOKIE_SESION)
    assert.match(sesion, /^cj_sesion=v1\.[\w-]+\.[\w-]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/)
    assert.ok(!sesion.includes('Secure'), 'en desarrollo la cookie no es Secure')
    assert.match(cookieEmitida(res, COOKIE_INTENTO), /^cj_intento=; Path=\/api\/auth\/google; Max-Age=0/)
    assert.equal(proveedor.visitas.token, 1)

    // La cookie solo trae el mail; nombre y rol salen de AUTH_USUARIOS
    const cookie = valorEmitido(res, COOKIE_SESION)
    const carga = decodificar(cookie)
    assert.deepEqual(Object.keys(carga).sort(), ['e', 'exp', 'iat'])
    assert.deepEqual(sesionDesdeCookie(cookie), { id: 'ana.socia@ejemplo.test', email: 'ana.socia@ejemplo.test', nombre: 'Ana', rol: 'socio', admin: true, secciones: SECCIONES, pestanas: [], esDePrueba: false })
  })

  test('cada rol cae en su primera sección', async () => {
    for (const [email, esperada] of [['cami@ejemplo.test', '/clientes'], ['lu@ejemplo.test', '/ventas'], ['ana.socia@ejemplo.test', '/']]) {
      proveedor.cuenta.email = email
      const { retorno, intento } = await arrancar(proveedor)
      const res = await callback(retorno, intento)
      assert.equal(res.headers.get('location'), esperada, email)
    }
  })

  test('next interno válido: vuelve ahí', async () => {
    const { retorno, intento } = await arrancar(proveedor, '/clientes/abc?q=a%20b#x')
    const res = await callback(retorno, intento)
    assert.equal(res.headers.get('location'), '/clientes/abc?q=a%20b#x')
  })

  test('el mail de Google en mayúsculas igual entra', async () => {
    proveedor.cuenta.email = 'ANA.SOCIA@EJEMPLO.TEST'
    const { retorno, intento } = await arrancar(proveedor)
    const res = await callback(retorno, intento)
    assert.ok(cookieEmitida(res, COOKIE_SESION))
  })

  test('emisor "accounts.google.com" (sin https) también es válido', async () => {
    proveedor.claims = { iss: 'accounts.google.com' }
    const { retorno, intento } = await arrancar(proveedor)
    assert.ok(cookieEmitida(await callback(retorno, intento), COOKIE_SESION))
  })

  test('state incorrecto: se corta antes de hablar con Google', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    retorno.searchParams.set('state', 'otro-state')
    esperarError(await callback(retorno, intento), 'intento_vencido')
    retorno.searchParams.delete('state')
    esperarError(await callback(retorno, intento), 'intento_vencido')
    assert.equal(proveedor.visitas.token, 0)
  })

  test('sin cookie de intento, o con una vencida, manipulada, de otro secreto o que en realidad es una sesión', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const datos = verificarCookie('intento', intento)
    const [ver, cuerpo, firma] = intento.split('.')
    const otroCuerpo = Buffer.from(JSON.stringify({ ...datos, x: '/finanzas' })).toString('base64url')
    const vencida = firmarCookie('intento', { s: datos.s, n: datos.n, v: datos.v, x: null }, DURACION_INTENTO_S, ahora() - 11 * 60 * 1000)
    const comoSesion = firmarCookie('sesion', { s: datos.s, n: datos.n, v: datos.v, x: null }, DURACION_INTENTO_S)
    const malas = [undefined, '', vencida, comoSesion, `${ver}.${otroCuerpo}.${firma}`, `${ver}.${cuerpo}.${(firma[0] === 'A' ? 'B' : 'A') + firma.slice(1)}`, 'basura']
    for (const mala of malas) esperarError(await callback(retorno, mala), 'intento_vencido')
    assert.equal(proveedor.visitas.token, 0)
  })

  test('reutilización del mismo state: el segundo uso se rechaza aunque el navegador conserve la cookie', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const primero = await callback(retorno, intento)
    assert.ok(cookieEmitida(primero, COOKIE_SESION))
    assert.match(cookieEmitida(primero, COOKIE_INTENTO), /Max-Age=0/, 'la cookie del intento se borra al usarla')
    esperarError(await callback(retorno, intento), 'intento_vencido')   // repite el mismo retorno con la cookie vieja
    esperarError(await callback(retorno, undefined), 'intento_vencido') // y sin cookie
    assert.equal(proveedor.visitas.token, 1, 'Google se consulta una sola vez')
  })

  test('reutilización del código: Google lo rechaza la segunda vez', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const config = leerConfig().config
    const verifier = verificarCookie('intento', intento).v
    const codigo = retorno.searchParams.get('code')
    assert.ok(await intercambiarCodigo(config, codigo, verifier))
    await assert.rejects(intercambiarCodigo(config, codigo, verifier), (e) => e instanceof ErrorAuth && e.codigo === 'google_rechazo')
  })

  test('PKCE: un code_verifier distinto no canjea el código', async () => {
    const { retorno } = await arrancar(proveedor)
    await assert.rejects(
      intercambiarCodigo(leerConfig().config, retorno.searchParams.get('code'), 'verificador-que-no-es'),
      (e) => e instanceof ErrorAuth && e.codigo === 'google_rechazo',
    )
  })

  test('id_token con nonce incorrecto', async () => {
    proveedor.claims = { nonce: 'nonce-de-otro-intento' }
    const { retorno, intento } = await arrancar(proveedor)
    esperarError(await callback(retorno, intento), 'error')
  })

  test('id_token con aud incorrecto', async () => {
    proveedor.claims = { aud: 'otro-cliente.apps.googleusercontent.com', azp: 'otro-cliente.apps.googleusercontent.com' }
    const { retorno, intento } = await arrancar(proveedor)
    esperarError(await callback(retorno, intento), 'error')
  })

  test('id_token con iss incorrecto', async () => {
    proveedor.claims = { iss: 'https://accounts.evil.com' }
    const { retorno, intento } = await arrancar(proveedor)
    esperarError(await callback(retorno, intento), 'error')
  })

  test('id_token vencido', async () => {
    proveedor.claims = { exp: Math.floor(Date.now() / 1000) - 60 }
    const { retorno, intento } = await arrancar(proveedor)
    esperarError(await callback(retorno, intento), 'error')
  })

  test('email_verified falso o ausente', async () => {
    for (const v of [false, undefined]) {
      proveedor.claims = { email_verified: v }
      const { retorno, intento } = await arrancar(proveedor)
      esperarError(await callback(retorno, intento), 'google_rechazo')
    }
  })

  test('id_token sin email', async () => {
    proveedor.claims = { email: undefined }
    const { retorno, intento } = await arrancar(proveedor)
    esperarError(await callback(retorno, intento), 'google_rechazo')
  })

  test('cuenta verificada por Google pero no listada en AUTH_USUARIOS: acceso denegado', async () => {
    proveedor.cuenta.email = 'intrusa@ejemplo.test'
    const { retorno, intento } = await arrancar(proveedor)
    esperarError(await callback(retorno, intento), 'cuenta_no_autorizada')
    assert.equal(proveedor.visitas.token, 1)
  })

  test('la persona cancela en Google (error=access_denied) o el canje es rechazado', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const cancelado = new URL(`${BASE}/api/auth/google/callback?error=access_denied&state=${retorno.searchParams.get('state')}`)
    esperarError(await callback(cancelado, intento), 'google_rechazo')
    esperarError(await callback(new URL(`${BASE}/api/auth/google/callback?error=access_denied`), undefined), 'google_rechazo')

    proveedor.rechazarCanje = true
    const otro = await arrancar(proveedor)
    esperarError(await callback(otro.retorno, otro.intento), 'google_rechazo')
  })

  test('retorno sin código', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    retorno.searchParams.delete('code')
    esperarError(await callback(retorno, intento), 'google_rechazo')
  })

  test('falla inesperada al llamar a Google: error genérico, sin filtrar el mensaje', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const req = new Request(retorno, { headers: { cookie: `${COOKIE_INTENTO}=${intento}` } })
    // Una respuesta cuya lectura explota con un Error común (no ErrorAuth): cae en "fallo inesperado"
    const rota = async () => ({ get status() { throw new Error('secreto: no debe salir') } })
    const res = await completarLogin(req, rota)
    esperarError(res, 'error')
    assert.ok(!registro.join('\n').includes('no debe salir'))
  })

  test('next malicioso: se descarta y se va a la primera sección (nunca a otro sitio)', async () => {
    for (const malo of ['//evil.com', '///evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/\t/evil.com', 'evil.com', '/entrar', '/api/auth/google']) {
      const { inicio, intento, retorno } = await arrancar(proveedor, malo)
      assert.equal(verificarCookie('intento', intento).x, null, `no se guarda: ${malo}`)
      assert.ok(!decodeURIComponent(inicio.headers.get('location')).includes('evil'))
      const res = await callback(retorno, intento)
      assert.equal(res.headers.get('location'), '/', malo)
    }
  })

  test('next con caracteres fuera de ASCII: se descarta y el ingreso sigue andando (antes fallaba al armar el Location)', async () => {
    for (const raro of ['/\u20ac', '/a\u2028b', '/\u00f1', '/\u202etxt']) {
      const { intento, retorno } = await arrancar(proveedor, raro)
      assert.equal(verificarCookie('intento', intento).x, null, `no se guarda: ${JSON.stringify(raro)}`)
      const res = await callback(retorno, intento)
      assert.equal(res.status, 303)
      assert.equal(res.headers.get('location'), '/', JSON.stringify(raro))
      assert.ok(cookieEmitida(res, COOKIE_SESION), 'la persona entra igual')
    }
    // Aunque una cookie firmada trajera uno, el callback lo vuelve a validar y no revienta
    const { retorno, intento } = await arrancar(proveedor)
    const datos = verificarCookie('intento', intento)
    const propia = firmarCookie('intento', { s: datos.s, n: datos.n, v: datos.v, x: '/\u20ac' }, DURACION_INTENTO_S)
    const res = await callback(retorno, propia)
    assert.equal(res.headers.get('location'), '/')
    assert.ok(cookieEmitida(res, COOKIE_SESION))
  })

  test('next malicioso metido a mano en la cookie de intento: la firma lo impide', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const datos = verificarCookie('intento', intento)
    const [ver, , firma] = intento.split('.')
    const cuerpo = Buffer.from(JSON.stringify({ ...datos, x: '//evil.com' })).toString('base64url')
    esperarError(await callback(retorno, `${ver}.${cuerpo}.${firma}`), 'intento_vencido')
  })

  test('aunque la cookie firmada trajera un next malo, el callback lo vuelve a validar', async () => {
    const { retorno, intento } = await arrancar(proveedor)
    const datos = verificarCookie('intento', intento)
    const propia = firmarCookie('intento', { s: datos.s, n: datos.n, v: datos.v, x: '//evil.com' }, DURACION_INTENTO_S)
    const res = await callback(retorno, propia)
    assert.equal(res.headers.get('location'), '/')
  })

  test('toda redirección interna es relativa y de una sola barra', async () => {
    const { inicio, retorno, intento } = await arrancar(proveedor, '/ventas')
    assert.ok(inicio.headers.get('location').startsWith(`${proveedor.url}/auth?`), 'solo la de Google es absoluta')
    const ok = await callback(retorno, intento)
    assert.match(ok.headers.get('location'), /^\/(?!\/)/)
    const mal = await callback(retorno, intento)
    assert.match(mal.headers.get('location'), /^\/entrar\?error=[a-z_]+$/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('producción: login completo con fetch simulado (nunca se toca la red)', () => {
  test('cookie Secure, canje contra el endpoint real de Google y error genérico si falta algo', async () => {
    enProduccion({ GOOGLE_TOKEN_URL: 'http://127.0.0.1:9999/token', GOOGLE_AUTH_URL: 'http://127.0.0.1:9999/auth' })
    const inicio = rutaIniciar(new Request(`${BASE_PROD}/api/auth/google?next=${encodeURIComponent('/clientes')}`))
    const urlGoogle = new URL(inicio.headers.get('location'))
    assert.equal(`${urlGoogle.origin}${urlGoogle.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(urlGoogle.searchParams.get('redirect_uri'), `${BASE_PROD}/api/auth/google/callback`)
    assert.match(cookieEmitida(inicio, COOKIE_INTENTO), /; HttpOnly; SameSite=Lax; Secure$/)
    const intento = valorEmitido(inicio, COOKIE_INTENTO)

    const llamadas = []
    const google = async (url, init) => {
      llamadas.push(String(url))
      const t = Math.floor(Date.now() / 1000)
      const id = jwt({
        iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, sub: '9', email: 'cami@ejemplo.test', email_verified: true,
        nonce: urlGoogle.searchParams.get('nonce'), iat: t, exp: t + 3600,
      })
      assert.equal(new URLSearchParams(String(init.body)).get('client_secret'), CLIENT_SECRET)
      return new Response(JSON.stringify({ id_token: id }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const retorno = `${BASE_PROD}/api/auth/google/callback?code=abc&state=${urlGoogle.searchParams.get('state')}`
    const res = await completarLogin(new Request(retorno, { headers: { cookie: `${COOKIE_INTENTO}=${intento}` } }), google)
    assert.deepEqual(llamadas, ['https://oauth2.googleapis.com/token'])
    assert.equal(res.headers.get('location'), '/clientes')
    assert.match(cookieEmitida(res, COOKIE_SESION), /^cj_sesion=v1\.[\w-]+\.[\w-]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure$/)
    assert.match(cookieEmitida(res, COOKIE_INTENTO), /Max-Age=0.*; Secure$/)

    // Misma cookie con un callback sin configuración: falla cerrado
    entorno({ NODE_ENV: 'production', AUTH_BASE_URL: BASE_PROD, AUTH_SECRET: undefined })
    const sinSecreto = await completarLogin(new Request(retorno, { headers: { cookie: `${COOKIE_INTENTO}=${intento}` } }), google)
    esperarError(sinSecreto, 'configuracion')
    assert.equal(llamadas.length, 1, 'sin configuración no se llama a Google')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('sesión y roles', () => {
  const cookieDe = (email) => firmarCookie('sesion', { e: email }, DURACION_SESION_S)

  test('quien ya no figura en AUTH_USUARIOS pierde la sesión aunque la cookie siga firmada', () => {
    const v = cookieDe('cami@ejemplo.test')
    assert.equal(sesionDesdeCookie(v).rol, 'csm')
    entorno({ AUTH_USUARIOS: JSON.stringify([{ email: 'ana.socia@ejemplo.test', nombre: 'Ana', rol: 'socio' }]) })
    assert.equal(sesionDesdeCookie(v), null)
  })

  test('si cambió de rol, manda AUTH_USUARIOS (nombre incluido), no la cookie', () => {
    const v = cookieDe('cami@ejemplo.test')
    entorno({ AUTH_USUARIOS: JSON.stringify([{ email: 'cami@ejemplo.test', nombre: 'Camila', rol: 'socio' }]) })
    const s = sesionDesdeCookie(v)
    assert.equal(s.rol, 'socio')
    assert.equal(s.nombre, 'Camila')
    entorno({ AUTH_USUARIOS: JSON.stringify([{ email: 'cami@ejemplo.test', nombre: 'Camila', rol: 'setter' }]) })
    assert.equal(sesionDesdeCookie(v).rol, 'setter')
  })

  test('una cookie firmada para un mail que no es de nadie no da sesión', () => {
    assert.equal(sesionDesdeCookie(cookieDe('intrusa@ejemplo.test')), null)
    assert.equal(sesionDesdeCookie(firmarCookie('sesion', {}, DURACION_SESION_S)), null)
    assert.equal(sesionDesdeCookie(firmarCookie('sesion', { e: 42 }, DURACION_SESION_S)), null)
    assert.equal(sesionDesdeCookie(undefined), null)
  })

  test('la matriz de roles vive en roles.ts: socio todo; csm Clientes y Referidos; closer y setter Ventas', () => {
    const ve = (rol) => ['resumen', 'ventas', 'clientes', 'referidos', 'finanzas', 'anuncios'].filter((s) => puedeVer(rol, s))
    assert.deepEqual(ve('socio'), ['resumen', 'ventas', 'clientes', 'referidos', 'finanzas', 'anuncios'])
    assert.deepEqual(ve('csm'), ['clientes', 'referidos'])
    assert.deepEqual(ve('closer'), ['ventas'])
    assert.deepEqual(ve('setter'), ['ventas'])
    assert.deepEqual(MATRIZ_ROLES.csm, ['clientes', 'referidos'])
    assert.equal(rutaInicial('csm'), '/clientes')
    assert.equal(rutaInicial('setter'), '/ventas')
  })

  test('salir: POST borra la cookie y vuelve a /entrar', () => {
    const res = rutaSalirPost(new Request(`${BASE}/api/auth/salir`, { method: 'POST' }))
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/entrar')
    assert.match(cookieEmitida(res, COOKIE_SESION), /^cj_sesion=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970/)
    // también cierra las contraseñas de Finanzas y Anuncios (no quedan abiertas en una compu compartida)
    assert.match(cookieEmitida(res, 'skwd_finanzas'), /^skwd_finanzas=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970.*HttpOnly; SameSite=Lax/)
    assert.match(cookieEmitida(res, 'skwd_anuncios'), /^skwd_anuncios=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970.*HttpOnly; SameSite=Lax/)
    const mismoOrigen = rutaSalirPost(new Request(`${BASE}/api/auth/salir`, { method: 'POST', headers: { origin: BASE } }))
    assert.equal(mismoOrigen.status, 303)
  })

  test('salir: un GET no hace nada (ni toca la cookie)', () => {
    const res = rutaSalirGet()
    assert.equal(res.status, 405)
    assert.equal(res.headers.get('allow'), 'POST')
    assert.deepEqual(setCookies(res), [])
    assert.equal(res.headers.get('location'), null)
  })

  test('salir: un POST que viene de otro sitio se rechaza sin tocar la cookie', () => {
    const res = rutaSalirPost(new Request(`${BASE}/api/auth/salir`, { method: 'POST', headers: { origin: 'https://evil.com' } }))
    assert.equal(res.status, 403)
    assert.deepEqual(setCookies(res), [])
  })
})
