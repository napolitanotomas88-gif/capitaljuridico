// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-rutas.mjs
// Tabla de rutas (lib/auth/rutas.ts) y proxy.ts: quién entra a cada URL. Sin red ni Google: los mails, el secreto y las
// claves de acá son inventados. Reproduce el recorrido real de una petición: primero el matcher de proxy.ts compilado
// con el mismo código de Next (getMiddlewareMatchers); si el matcher la deja afuera NO pasa por el proxy, y si no, se
// llama a proxy() con una NextRequest de verdad.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { proxy, config } from '../proxy.ts'
import { COOKIE_SESION, DURACION_SESION_S, firmarCookie } from '../lib/auth/cookie.ts'
import { COOKIE_FINANZAS, crearToken } from '../lib/finanzasAuth.ts'
import { accesoMaquina, exigirAccesoApi, sesionDePeticion } from '../lib/auth/acceso.ts'
import { ERROR_SESION_VENCIDA, LOGIN_VUELTA_AL_RESUMEN, leerJsonDeDatos } from '../lib/auth/datosResumen.ts'
import { MATRIZ_ROLES, RUTA_SECCION, SECCIONES, ROLES, puedeVer, rutaInicial, rutaMenu } from '../lib/auth/roles.ts'
import { destinoSinPermiso, rutaClientes } from '../lib/auth/hubClientes.ts'
// Los roles de la lista fija de Vercel (el rol 'acceso' lleva sus secciones propias: se prueba en test-accesos.mjs)
const ROLES_FIJOS = ROLES.filter((r) => r !== 'acceso')
import {
  POR_DEFECTO, REGLAS, decidir, destinoEntrar, normalizarRuta, resolverRegla, veredicto,
} from '../lib/auth/rutas.ts'

const RAIZ = join(fileURLToPath(import.meta.url), '..', '..')
const require = createRequire(import.meta.url)
const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info.js')

// ── Entorno de prueba ─────────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:3101'
const SECRET = randomBytes(48).toString('base64url')
const CRON = `cron-${randomBytes(12).toString('hex')}`
const EOD = `eod-${randomBytes(12).toString('hex')}`
const PASS_FIN = `fin-${randomBytes(6).toString('hex')}`
const USUARIOS = [
  { email: 'ana.socia@ejemplo.test', nombre: 'Ana', rol: 'socio' },
  { email: 'cami@ejemplo.test', nombre: 'Cami', rol: 'csm' },
  { email: 'lu@ejemplo.test', nombre: 'Lu', rol: 'closer' },
  { email: 'sofi@ejemplo.test', nombre: 'Sofi', rol: 'setter' },
]
const VARIABLES = ['NODE_ENV', 'VERCEL_ENV', 'AUTH_SECRET', 'AUTH_USUARIOS', 'CRON_SECRET', 'EOD_KEY', 'FINANZAS_PASSWORD', 'CRM_DEV_ROL']
const entorno = (extra = {}) => {
  const e = {
    NODE_ENV: undefined, VERCEL_ENV: undefined, CRM_DEV_ROL: undefined, AUTH_SECRET: SECRET,
    AUTH_USUARIOS: JSON.stringify(USUARIOS), CRON_SECRET: CRON, EOD_KEY: EOD, FINANZAS_PASSWORD: PASS_FIN, ...extra,
  }
  for (const v of VARIABLES) {
    if (e[v] === undefined) delete process.env[v]
    else process.env[v] = e[v]
  }
}
let guardado
beforeEach(() => {
  guardado = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
  entorno()
})
afterEach(() => {
  for (const v of VARIABLES) {
    if (guardado[v] === undefined) delete process.env[v]
    else process.env[v] = guardado[v]
  }
})

const cookieDe = (rol) => {
  const u = USUARIOS.find((x) => x.rol === rol)
  return `${COOKIE_SESION}=${firmarCookie('sesion', { e: u.email }, DURACION_SESION_S)}`
}

// ── El recorrido de una petición ──────────────────────────────────────────────────────────
const matchers = getMiddlewareMatchers(config.matcher, {}).map((m) => new RegExp(m.regexp))
/** ¿El matcher de proxy.ts hace que esta ruta pase por el proxy? (se prueba con el pathname que ve Next, ya sin ./ ni ../) */
const pasaPorProxy = (pathname) => matchers.some((re) => re.test(pathname))

/**
 * Resultado de una petición a `ruta`. "fuera" = el matcher la deja afuera: el proxy ni se invoca.
 * Si no, se llama a proxy(): "pasa" (NextResponse.next) o "estado" + "location" + "cuerpo".
 */
async function pedir(ruta, { metodo = 'GET', cookie, cabeceras = {}, host = 'localhost:3101' } = {}) {
  // Se concatena (y no new URL(ruta, BASE)) para que "//api//raw" quede como ruta y no como un host
  const url = new URL(BASE + ruta)
  if (!pasaPorProxy(url.pathname)) return { fuera: true, pasa: true }
  const headers = { host, ...cabeceras }
  if (cookie) headers.cookie = cookie
  const res = await proxy(new NextRequest(url, { method: metodo, headers }))
  const texto = res.headers.get('content-type')?.includes('json') ? await res.text() : null
  return {
    fuera: false,
    pasa: res.headers.get('x-middleware-next') === '1',
    estado: res.status,
    location: res.headers.get('location'),
    cache: res.headers.get('cache-control'),
    json: texto ? JSON.parse(texto) : null,
  }
}
const ubicacion = (r) => (r.location ? new URL(r.location).pathname + new URL(r.location).search : null)

// ═════════════════════════════════════════════════════════════════════════════════════════
// Rutas del marco global del Despacho que piden sesión de Google sin sección (cualquier rol): la ruta filtra adentro.
const MARCO_SIN_SECCION = ['/api/notificaciones/*', '/api/presencia']

describe('normalizarRuta', () => {
  const casos = [
    ['/api/raw', '/api/raw', false],
    ['/api/raw/', '/api/raw', false],
    ['/API/Raw', '/api/raw', false],
    ['//api//raw', '/api/raw', false],
    ['/', '/', false],
    ['', '/', false],
    ['///', '/', false],
    ['/clientes/a%20b', '/clientes/a b', false],
    ['/api/raw%2F', '/api/raw/', true],
    ['/api%2Fraw', '/api/raw', true],
    ['/api%5Craw', '/api\\raw', true],
    ['/api/raw%00', '/api/raw\u0000', true],
    ['/api/%2e%2e/raw', '/api/../raw', true],
    ['/api/./raw', '/api/./raw', true],
    ['/api/../raw', '/api/../raw', true],
    ['/api/%252e%252e/raw', '/api/%2e%2e/raw', true],
    ['/api/%E0%A4%A/raw', null, true],
    ['/api/raw%0a', null, true],
  ]
  for (const [entrada, ruta, ambigua] of casos) {
    test(`${JSON.stringify(entrada)}`, () => {
      const r = normalizarRuta(entrada)
      assert.equal(r.ambigua, ambigua)
      if (ruta !== null) assert.equal(r.ruta, ruta)
    })
  }
})

describe('resolverRegla: una ruta ambigua nunca cuenta como abierta', () => {
  const abiertas = ['/entrar', '/api/auth/google', '/_next/static/a.js', '/favicon.ico', '/v/traspaso.mp4', '/api/analista', '/api/calendly-webhook', '/api/fathom-anuncios', '/api/fathom-anuncios/reintentar', '/anuncios', '/finanzas/login']
  for (const ruta of abiertas) {
    test(`${ruta} limpia: abierta`, () => assert.match(resolverRegla(ruta).regla.quien, /^(publico|propio)$/))
  }
  const trucos = [
    '/api/auth/..%2Fraw', '/api/auth/%2e%2e/raw', '/v/..%2Fapi/raw', '/_next/..%2Fapi%2Fraw', '/api/analista%2F..%2Fraw',
    '/entrar%2F..%2Fapi%2Fraw', '/api/auth%2F..%2F..%2Fapi%2Fraw', '/api/calendly-webhook%2F..%2Fraw', '/api/fathom-anuncios%2F..%2Fraw', '/api/fathom-anuncios/reintentar%2F..%2F..%2Fraw', '/anuncios%2F..%2Fapi%2Fraw',
    '/finanzas%2Flogin', '/api/finanzas/login%2F..%2F..%2F..%2Fraw', '/v/%252e%252e/api/raw', '/_next/%00/x',
  ]
  for (const ruta of trucos) {
    test(`${ruta}: ambigua, se le aplica una protección`, () => {
      const r = resolverRegla(ruta)
      assert.equal(r.ambigua, true)
      assert.doesNotMatch(r.regla.quien, /^(publico|propio)$/)
    })
  }
})

describe('tabla REGLAS: orden y forma', () => {
  test('patrones en minúscula, con "/" inicial, sin repetir', () => {
    const vistos = new Set()
    for (const r of REGLAS) {
      assert.match(r.patron, /^\/[^A-Z]*$/, r.patron)
      assert.ok(!r.patron.includes('//'), r.patron)
      assert.ok(r.patron === '/' || !r.patron.endsWith('/') || r.patron.endsWith('/*'), r.patron)
      assert.ok(!vistos.has(r.patron), `patrón repetido: ${r.patron}`)
      vistos.add(r.patron)
      assert.ok(['publico', 'propio', 'finanzas', 'google', 'google_o_maquina'].includes(r.quien), r.patron)
      if (r.seccion) assert.ok(SECCIONES.includes(r.seccion), r.patron)
      // Las rutas del marco global (notificaciones y presencia, 27/10/2026) son para cualquiera con sesión: el filtro va adentro
      if ((r.quien === 'google' || r.quien === 'google_o_maquina') && !MARCO_SIN_SECCION.includes(r.patron)) assert.ok(r.seccion, `${r.patron}: falta la sección`)
      assert.ok(r.motivo.length > 10, r.patron)
    }
  })
  test('ninguna regla queda tapada por otra anterior (el orden importa)', () => {
    for (const r of REGLAS) {
      const base = r.patron.endsWith('/*') ? r.patron.slice(0, -2) : r.patron
      assert.equal(resolverRegla(base).regla, r, `${r.patron} la gana otra regla`)
      if (r.patron.endsWith('/*')) assert.equal(resolverRegla(`${base}/x/y`).regla, r, `${base}/x/y la gana otra regla`)
    }
  })
  test('coincidencia por segmentos: /clientesx y /api/analista-x no son /clientes ni /api/analista', () => {
    assert.equal(resolverRegla('/clientesx').regla, POR_DEFECTO)
    assert.equal(resolverRegla('/api/analista-x').regla, POR_DEFECTO)
    assert.equal(resolverRegla('/api/finanzas-cierre').regla.quien, 'propio')
    assert.equal(resolverRegla('/api/finanzas').regla.quien, 'finanzas')
    assert.equal(resolverRegla('/api/raw/x').regla, POR_DEFECTO)
    assert.equal(resolverRegla('/api/raw.json').regla, POR_DEFECTO)
    assert.equal(resolverRegla('/index').regla, POR_DEFECTO)
  })
  test('lo que no está declarado cae cerrado: Google, cualquier rol', () => {
    assert.equal(POR_DEFECTO.quien, 'google')
    assert.equal(POR_DEFECTO.seccion, undefined)
    assert.equal(resolverRegla('/api/algo-nuevo').regla, POR_DEFECTO)
  })
  test('cada sección de la matriz tiene su ruta con la regla que corresponde', () => {
    for (const s of SECCIONES) {
      const r = resolverRegla(RUTA_SECCION[s]).regla
      if (s === 'finanzas') assert.equal(r.quien, 'finanzas')
      else if (s === 'anuncios') assert.equal(r.quien, 'propio')
      else {
        assert.equal(r.quien, 'google', s)
        assert.equal(r.seccion, s, s)
      }
    }
  })
})

// Recorre app/ y arma la ruta de cada page.tsx y route.ts: así una pantalla o API nueva no puede quedar sin decidir
function rutasDeApp() {
  const salida = []
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      const completo = join(dir, nombre)
      if (statSync(completo).isDirectory()) recorrer(completo)
      else if (nombre === 'page.tsx' || nombre === 'route.ts') {
        const segmentos = relative(join(RAIZ, 'app'), dir).split('/').filter((s) => s && !/^\(.*\)$/.test(s))
        salida.push({ tipo: nombre === 'page.tsx' ? 'pagina' : 'api', ruta: `/${segmentos.map((s) => (/^\[.*\]$/.test(s) ? 'x' : s)).join('/')}`, archivo: relative(RAIZ, completo) })
      }
    }
  }
  recorrer(join(RAIZ, 'app'))
  return salida
}

describe('cobertura: cada página y cada ruta /api de app/ está declarada a propósito', () => {
  const rutas = rutasDeApp()
  test('se encontraron páginas y rutas', () => {
    assert.ok(rutas.filter((r) => r.tipo === 'api').length >= 20, 'rutas /api')
    assert.ok(rutas.filter((r) => r.tipo === 'pagina').length >= 9, 'páginas')
  })
  for (const r of rutas) {
    test(`${r.ruta}  (${r.archivo})`, () => {
      assert.notEqual(resolverRegla(r.ruta).regla, POR_DEFECTO, 'falta declararla en lib/auth/rutas.ts')
    })
  }
})

describe('veredicto: regla por rol', () => {
  test('google con sección: solo los roles que la ven; sin sesión, sin_sesion', () => {
    for (const s of ['resumen', 'ventas', 'clientes', 'referidos']) {
      for (const rol of ROLES_FIJOS) {
        assert.equal(veredicto({ quien: 'google', seccion: s }, { sesion: { rol }, maquina: false }), puedeVer(rol, s) ? 'pasar' : 'sin_permiso', `${rol} ${s}`)
      }
      assert.equal(veredicto({ quien: 'google', seccion: s }, { sesion: null, maquina: false }), 'sin_sesion')
    }
  })
  test('google: el Bearer solo no alcanza', () => {
    assert.equal(veredicto({ quien: 'google', seccion: 'clientes' }, { sesion: null, maquina: true }), 'sin_sesion')
  })
  test('google_o_maquina: el Bearer pasa aunque no haya sesión o el rol no vea la sección', () => {
    assert.equal(veredicto({ quien: 'google_o_maquina', seccion: 'resumen' }, { sesion: null, maquina: true }), 'pasar')
    assert.equal(veredicto({ quien: 'google_o_maquina', seccion: 'resumen' }, { sesion: { rol: 'closer' }, maquina: true }), 'pasar')
    assert.equal(veredicto({ quien: 'google_o_maquina', seccion: 'resumen' }, { sesion: { rol: 'closer' }, maquina: false }), 'sin_permiso')
    assert.equal(veredicto({ quien: 'google_o_maquina', seccion: 'resumen' }, { sesion: null, maquina: false }), 'sin_sesion')
  })
})

describe('decidir: rutas abiertas no leen cookie ni Authorization', () => {
  const sinLeer = () => { throw new Error('se leyó el contexto de una ruta abierta') }
  for (const ruta of ['/entrar', '/api/auth/google/callback', '/_next/static/x.js', '/favicon.ico', '/v/a.mp4', '/api/analista', '/api/reporte-eod', '/api/calendly-webhook', '/api/fathom-anuncios', '/anuncios', '/api/anuncios/login', '/finanzas/login']) {
    test(ruta, () => assert.deepEqual(decidir({ pathname: ruta, contexto: sinLeer }), { accion: 'pasar' }))
  }
})

describe('destinoEntrar', () => {
  test('"/" → /entrar?next=/', () => assert.equal(destinoEntrar('/', ''), '/entrar?next=/'))
  test('con ruta y búsqueda', () => {
    assert.equal(destinoEntrar('/clientes/abc', ''), '/entrar?next=/clientes/abc')
    assert.equal(destinoEntrar('/clientes', '?estado=rojo&q=a%20b'), '/entrar?next=/clientes%3Festado%3Drojo%26q%3Da%2520b')
  })
  test('ruta que no es segura para volver: /entrar a secas', () => {
    assert.equal(destinoEntrar('//evil.test', ''), '/entrar')
    assert.equal(destinoEntrar('/x\\y', ''), '/entrar')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('proxy: "/" y las páginas del shell', () => {
  test('"/" sin sesión: redirige a /entrar?next=/ (307, sin caché)', async () => {
    const r = await pedir('/')
    assert.equal(r.pasa, false)
    assert.equal(r.estado, 307)
    assert.equal(ubicacion(r), '/entrar?next=/')
    assert.equal(r.cache, 'no-store')
  })
  test('"/" con sesión de socio pasa; csm cae en /clientes; closer y setter en /ventas', async () => {
    assert.equal((await pedir('/', { cookie: cookieDe('socio') })).pasa, true)
    assert.equal(ubicacion(await pedir('/', { cookie: cookieDe('csm') })), '/clientes')
    assert.equal(ubicacion(await pedir('/', { cookie: cookieDe('closer') })), '/ventas')
    assert.equal(ubicacion(await pedir('/', { cookie: cookieDe('setter') })), '/ventas')
  })
  test('la redirección sin sesión conserva la ruta y la búsqueda en next', async () => {
    const r = await pedir('/clientes/cli-001?pestana=cobros')
    assert.equal(r.estado, 307)
    assert.equal(ubicacion(r), '/entrar?next=/clientes/cli-001%3Fpestana%3Dcobros')
  })
  test('un POST sin sesión se redirige con 303', async () => {
    assert.equal((await pedir('/clientes', { metodo: 'POST' })).estado, 303)
  })
  // La matriz completa: página × rol
  // Sin permiso: a su sección inicial, salvo que tenga otra pestaña del hub Clientes (ahí, a su primera pestaña: destinoSinPermiso)
  const paginas = [['/', 'resumen'], ['/ventas', 'ventas'], ['/clientes', 'clientes'], ['/clientes/cli-001', 'clientes'], ['/clientes/referidos', 'referidos'], ['/clientes/edicion', 'edicion'], ['/guiones', 'guiones'], ['/sistema', 'resumen']]
  for (const [ruta, seccion] of paginas) {
    for (const rol of ROLES_FIJOS) {
      const destino = destinoSinPermiso(rol, seccion, rutaInicial)
      test(`${ruta} como ${rol}: ${puedeVer(rol, seccion) ? 'pasa' : `va a ${destino}`}`, async () => {
        const r = await pedir(ruta, { cookie: cookieDe(rol) })
        if (puedeVer(rol, seccion)) assert.equal(r.pasa, true)
        else {
          assert.equal(r.pasa, false)
          assert.equal(r.estado, 307)
          assert.equal(ubicacion(r), destino)
        }
      })
    }
  }
  test('el rol sale de AUTH_USUARIOS en cada petición: si lo cambian, rige al toque', async () => {
    const cookie = cookieDe('csm')
    assert.equal((await pedir('/clientes', { cookie })).pasa, true)
    process.env.AUTH_USUARIOS = JSON.stringify(USUARIOS.map((u) => (u.rol === 'csm' ? { ...u, rol: 'closer' } : u)))
    // Los closers no cargan altas (decisión de Tomás, 26/10/2026): sin ninguna pestaña del hub, la Cartera lo manda a Ventas
    assert.equal(ubicacion(await pedir('/clientes', { cookie })), '/ventas')
    process.env.AUTH_USUARIOS = JSON.stringify(USUARIOS.filter((u) => u.rol !== 'csm'))
    assert.equal(ubicacion(await pedir('/clientes', { cookie })), '/entrar?next=/clientes')
  })
  test('cookie con firma rota, vencida, de otro propósito o de otro secreto: sin sesión', async () => {
    const buena = cookieDe('socio')
    const valor = buena.split('=')[1]
    const rota = `${COOKIE_SESION}=${valor.slice(0, -3)}AAA`
    const vencida = `${COOKIE_SESION}=${firmarCookie('sesion', { e: USUARIOS[0].email }, DURACION_SESION_S, Date.now() - 8 * 86400_000)}`
    const deIntento = `${COOKIE_SESION}=${firmarCookie('intento', { e: USUARIOS[0].email }, 600)}`
    const sinMail = `${COOKIE_SESION}=${firmarCookie('sesion', { e: 'otra@ejemplo.test' }, DURACION_SESION_S)}`
    for (const cookie of [rota, vencida, deIntento, sinMail, `${COOKIE_SESION}=`, `${COOKIE_SESION}=basura`, 'otra=1']) {
      assert.equal((await pedir('/', { cookie })).pasa, false, cookie.slice(0, 30))
    }
    process.env.AUTH_SECRET = randomBytes(48).toString('base64url')
    assert.equal((await pedir('/', { cookie: buena })).pasa, false, 'otro AUTH_SECRET')
    delete process.env.AUTH_SECRET
    assert.equal((await pedir('/', { cookie: buena })).pasa, false, 'sin AUTH_SECRET')
  })
  test('sin AUTH_USUARIOS (acceso no configurado) todo queda cerrado, también con una cookie firmada', async () => {
    const cookie = cookieDe('socio')
    delete process.env.AUTH_USUARIOS
    assert.equal((await pedir('/', { cookie })).pasa, false)
    assert.equal((await pedir('/api/raw', { cookie })).estado, 401)
  })
})

describe('proxy: rutas /api de datos (401/403 en JSON, nunca redirección)', () => {
  const datos = ['/api/raw', '/api/metrics', '/api/ads', '/api/ads?month=2026-10']
  for (const ruta of datos) {
    test(`${ruta} sin credenciales: 401 JSON`, async () => {
      const r = await pedir(ruta)
      assert.equal(r.pasa, false)
      assert.equal(r.estado, 401)
      assert.equal(r.location, null)
      assert.deepEqual(r.json, { error: 'No autorizado' })
      assert.equal(r.cache, 'no-store')
    })
    test(`${ruta}: socio pasa; csm, closer y setter 403`, async () => {
      assert.equal((await pedir(ruta, { cookie: cookieDe('socio') })).pasa, true)
      for (const rol of ['csm', 'closer', 'setter']) {
        const r = await pedir(ruta, { cookie: cookieDe(rol) })
        assert.equal(r.estado, 403, rol)
        assert.equal(r.location, null)
        assert.deepEqual(r.json, { error: 'Sin permiso para esta sección' })
      }
    })
    test(`${ruta}: Bearer CRON_SECRET pasa, sin sesión y con cualquier rol`, async () => {
      const auth = { authorization: `Bearer ${CRON}` }
      assert.equal((await pedir(ruta, { cabeceras: auth })).pasa, true)
      assert.equal((await pedir(ruta, { cabeceras: { authorization: `bearer ${CRON}` } })).pasa, true, 'esquema en minúscula')
      assert.equal((await pedir(ruta, { cookie: cookieDe('closer'), cabeceras: auth })).pasa, true)
    })
    test(`${ruta}: Bearer incorrecto, ?key= y otros esquemas no pasan`, async () => {
      for (const authorization of [`Bearer ${CRON}x`, `Bearer ${CRON.slice(0, -1)}`, 'Bearer ', 'Bearer', `Basic ${CRON}`, CRON, `Bearer ${EOD}`, `Bearer  ${CRON} extra`]) {
        assert.equal((await pedir(ruta, { cabeceras: { authorization } })).estado, 401, authorization)
      }
      const r = await pedir(`${ruta}${ruta.includes('?') ? '&' : '?'}key=${CRON}`)
      assert.equal(r.estado, 401, '?key= no abre estas rutas')
    })
  }
  test('sin CRON_SECRET en el entorno, ningún Bearer abre nada (ni "Bearer undefined" ni vacío)', async () => {
    delete process.env.CRON_SECRET
    for (const authorization of ['Bearer undefined', 'Bearer ', 'Bearer null', 'Bearer ""']) {
      assert.equal((await pedir('/api/raw', { cabeceras: { authorization } })).estado, 401, authorization)
    }
    process.env.CRON_SECRET = '   '
    assert.equal((await pedir('/api/raw', { cabeceras: { authorization: 'Bearer    ' } })).estado, 401)
  })
  test('/api/clientes: solo sesión y rol; el Bearer NO sirve', async () => {
    assert.equal((await pedir('/api/clientes', { cabeceras: { authorization: `Bearer ${CRON}` } })).estado, 401)
    assert.equal((await pedir('/api/clientes')).estado, 401)
    assert.equal((await pedir('/api/clientes/cli-001', { cookie: cookieDe('closer') })).estado, 403)
    assert.equal((await pedir('/api/clientes', { cookie: cookieDe('csm') })).pasa, true)
    assert.equal((await pedir('/api/clientes', { cookie: cookieDe('socio') })).pasa, true)
  })
  test('una ruta /api que no está declarada queda cerrada con 401 JSON', async () => {
    const r = await pedir('/api/algo-nuevo')
    assert.equal(r.estado, 401)
    assert.equal(r.location, null)
  })
  test('el Bearer de máquina no da acceso a las páginas', async () => {
    const r = await pedir('/', { cabeceras: { authorization: `Bearer ${CRON}` } })
    assert.equal(r.pasa, false)
    assert.equal(r.estado, 307)
  })
})

describe('proxy: lo que usan cron, webhooks, Make y el video sigue pasando SIN credenciales', () => {
  const vercel = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'))
  test('vercel.json tiene crons', () => assert.ok(vercel.crons.length >= 8))
  for (const { path } of vercel.crons) {
    // Un cron puede traer query (ej. "/api/resumen-diario?soloFoto=1"): Vercel la manda, pero el matcher y la tabla miran solo el pathname
    const pathname = path.split('?')[0]
    test(`cron ${path}: el proxy ni se invoca y la tabla lo da por abierto`, async () => {
      const r = await pedir(path)
      assert.equal(r.fuera, true)
      assert.equal(r.pasa, true)
      assert.equal(resolverRegla(pathname).regla.quien, 'propio')
      assert.deepEqual(decidir({ pathname, contexto: () => { throw new Error('leyó el contexto') } }), { accion: 'pasar' })
    })
    test(`cron ${path} con ?preview=1 y ?key=: igual`, async () => {
      assert.equal((await pedir(`${path}${path.includes('?') ? '&' : '?'}preview=1&key=${CRON}`)).pasa, true)
    })
  }
  test('webhook de Calendly (POST con firma) y EOD de Make (Bearer EOD_KEY) quedan afuera del proxy', async () => {
    const w = await pedir('/api/calendly-webhook', { metodo: 'POST', cabeceras: { 'calendly-webhook-signature': 't=1,v1=abc', 'content-type': 'application/json' } })
    assert.equal(w.fuera, true)
    // Fathom (firma Standard Webhooks) y su modo manual con Bearer: también afuera, la ruta verifica por su cuenta
    const f = await pedir('/api/fathom-anuncios', { metodo: 'POST', cabeceras: { 'webhook-id': 'msg_1', 'webhook-timestamp': '1', 'webhook-signature': 'v1,abc', 'content-type': 'application/json' } })
    assert.equal(f.fuera, true)
    assert.equal((await pedir('/api/fathom-anuncios?dry=1&forzar=1')).fuera, true)
    assert.equal((await pedir('/api/fathom-anuncios?recording_id=123&forzar=1', { metodo: 'POST' })).fuera, true)
    assert.equal((await pedir('/api/fathom-anuncios/reintentar')).fuera, true)
    // Solo la subruta exacta: /api/fathom-anuncios/otra no queda afuera del proxy
    assert.equal((await pedir('/api/fathom-anuncios/otra')).fuera, false)
    const e = await pedir('/api/reporte-eod', { cabeceras: { authorization: `Bearer ${EOD}` } })
    assert.equal(e.fuera, true)
    assert.equal((await pedir('/api/reporte-eod?preview=1&fecha=2026-10-05&forzar=1&esquema=1')).fuera, true)
  })
  test('agenda-slots (cron y llamada interna del webhook) y los manuales con ?preview=1', async () => {
    for (const p of ['/api/agenda-slots', '/api/agenda-slots?forzar=1', '/api/analista?completo=1', '/api/finanzas-cierre?mes=2026-09&forzar=1', '/api/reporte-anuncios?pdf=1', '/api/alerta-anuncios?preview=1']) {
      assert.equal((await pedir(p)).fuera, true, p)
    }
  })
  test('el video del WhatsApp (todos los archivos de public/v) se descarga sin cookie', async () => {
    const videos = ['video-ficticio.mp4', 'bienvenida-ficticia.mp4'] // Sólo política de rutas; los medios privados no se versionan.
    for (const v of videos) {
      const r = await pedir(`/v/${v}`)
      assert.equal(r.fuera, true, v)
      assert.equal(resolverRegla(`/v/${v}`).regla.quien, 'publico')
    }
    assert.equal((await pedir('/v/video-ficticio.mp4', { cabeceras: { range: 'bytes=0-1023', 'user-agent': 'WhatsApp/2.23' } })).pasa, true)
  })
  test('tablero de anuncios con su clave propia: no pasa por Google (Valentino no figura en la matriz)', async () => {
    for (const p of ['/anuncios', '/anuncios/login', '/api/anuncios', '/api/anuncios/login', '/api/anuncios/logout', '/api/anuncios/optimizar', '/api/anuncios/recuento', '/api/anuncios/reporte-pdf']) {
      const r = await pedir(p, { cabeceras: p === '/api/anuncios' ? { authorization: `Bearer ${CRON}` } : {} })
      assert.equal(r.pasa, true, p)
    }
  })
})

describe('proxy: login y estáticos abiertos (no se bloquea lo que /entrar necesita)', () => {
  const abiertas = [
    '/entrar', '/entrar?error=cuenta_no_autorizada', '/entrar?next=/clientes', '/api/auth/google', '/api/auth/google?next=/clientes',
    '/api/auth/google/callback?code=abc&state=def', '/api/auth/salir',
    '/_next/static/chunks/main.js', '/_next/static/css/app.css', '/_next/static/media/archivo.woff2', '/_next/image?url=%2Fa.png&w=64&q=75',
    '/_next/webpack-hmr', '/favicon.ico',
  ]
  for (const ruta of abiertas) {
    test(`${ruta}`, async () => {
      assert.equal((await pedir(ruta)).pasa, true)
      assert.equal((await pedir(ruta, { metodo: 'POST' })).pasa, true)
    })
  }
  test('POST /api/auth/salir sin sesión también pasa (la ruta responde sola)', async () => {
    assert.equal((await pedir('/api/auth/salir', { metodo: 'POST' })).pasa, true)
  })
  test('las lookalikes de lo abierto NO quedan abiertas', async () => {
    for (const p of ['/entrarx', '/entrar.json', '/api/authx', '/_nextx/static/a.js', '/favicon.ico.bak', '/api/auth-x', '/vx/a.mp4', '/api/analista-x', '/api/analista.json']) {
      const r = await pedir(p)
      assert.equal(r.pasa, false, p)
      assert.equal(r.fuera, false, p)
    }
  })
})

describe('app instalable (PWA): manifiesto e íconos públicos, y nada más', () => {
  const publicas = ['/manifest.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png', '/pwa/apple-touch-icon.png']
  for (const ruta of publicas) {
    test(`${ruta}: sin cookie pasa (GET) y la tabla la declara pública`, async () => {
      assert.equal(resolverRegla(ruta).regla.quien, 'publico')
      assert.equal((await pedir(ruta)).pasa, true)
    })
  }
  test('las lookalikes NO quedan abiertas', async () => {
    for (const p of ['/manifest.webmanifest.bak', '/manifest.json', '/manifestx.webmanifest', '/pwax/icon-192.png', '/pwa-x/a.png', '/pwa%2F..%2Fapi%2Fraw', '/pwa/..%2Fapi%2Fraw', '/pwa/%2e%2e/api/raw']) {
      const r = await pedir(p)
      assert.equal(r.pasa, false, p)
    }
  })
  test('el manifiesto cumple lo pedido: standalone, marfil y verde, español, íconos 192/512/maskable que existen como ruta', async () => {
    const { default: manifest } = await import('../app/manifest.ts')
    const m = manifest()
    assert.equal(m.name, 'Capital Jurídico') // nombre de la app instalada (pedido de Tomás, 25/10/2026; antes "Despacho")
    assert.equal(m.short_name, 'Capital Jurídico')
    assert.ok(m.short_name && m.short_name.length <= 16)
    assert.equal(m.start_url, '/'); assert.equal(m.display, 'standalone'); assert.equal(m.lang, 'es')
    assert.equal(m.background_color, '#f2eadc'); assert.equal(m.theme_color, '#012d25') // MARFIL de fondo y VERDE de la barra (estética del CRM, 7/10/2026)
    const tam = (p) => m.icons.filter((i) => i.purpose === p).map((i) => i.sizes)
    assert.ok(tam('any').includes('192x192') && tam('any').includes('512x512'))
    assert.deepEqual(tam('maskable'), ['512x512'])
    for (const i of m.icons) {
      assert.equal(resolverRegla(i.src).regla.quien, 'publico', i.src)
      assert.ok(existsSync(join(RAIZ, 'app', 'pwa', '[nombre]', 'route.ts')))
    }
  })
  test('sin service worker ni caché sin conexión de datos privados', () => {
    const ruta = (...p) => join(RAIZ, ...p)
    for (const f of ['public/sw.js', 'public/service-worker.js', 'app/sw.ts', 'app/sw.js']) assert.ok(!existsSync(ruta(f)), f)
    const codigo = [ruta('app', 'manifest.ts'), ruta('app', 'pwa', '[nombre]', 'route.ts'), ruta('components', 'shell', 'Navegacion.tsx')].map((f) => readFileSync(f, 'utf8')).join('\n')
    assert.ok(!/serviceWorker|navigator\.serviceWorker|workbox|caches\.open/.test(codigo))
  })
  test('el shell y "/" (Resumen) declaran la app para iOS: appleWebApp, ícono, viewport-fit=cover, verde', () => {
    for (const f of [['app', '(shell)', 'layout.tsx'], ['app', 'page.tsx']]) {
      const c = readFileSync(join(RAIZ, ...f), 'utf8')
      assert.match(c, /METADATA_APP/, f.join('/')); assert.match(c, /VIEWPORT_APP/, f.join('/'))
    }
    const l = readFileSync(join(RAIZ, 'components', 'shell', 'pwa.ts'), 'utf8')
    assert.match(l, /appleWebApp:\s*{[^}]*capable:\s*true/)
    assert.match(l, /statusBarStyle:\s*'black-translucent'/)
    assert.match(l, /apple:\s*`\/pwa\/apple-touch-icon\.png\?v=\$\{VERSION_ICONOS\}`/)
    assert.match(l, /viewportFit:\s*'cover'/)
    assert.match(l, /themeColor:\s*'#012d25'/)
  })
})

describe('proxy: Finanzas conserva su protección actual (contraseña propia, sin Google)', () => {
  const cookieFin = () => `${COOKIE_FINANZAS}=${crearToken()}`
  test('sin cookie de Finanzas: la página redirige a /finanzas/login y la API da 401 JSON', async () => {
    const p = await pedir('/finanzas')
    assert.equal(p.estado, 307)
    assert.equal(ubicacion(p), '/finanzas/login')
    assert.equal((await pedir('/finanzas/otra')).estado, 307)
    const a = await pedir('/api/finanzas?mes=2026-10')
    assert.equal(a.estado, 401)
    assert.deepEqual(a.json, { error: 'No autorizado' })
  })
  test('con la cookie de Finanzas pasa, sin pedir sesión de Google; una sesión de Google que NO es de administrador no alcanza', async () => {
    assert.equal((await pedir('/finanzas', { cookie: cookieFin() })).pasa, true)
    assert.equal((await pedir('/api/finanzas', { cookie: cookieFin() })).pasa, true)
    for (const rol of ['closer', 'csm', 'setter']) {
      assert.equal((await pedir('/finanzas', { cookie: cookieDe(rol) })).estado, 307, rol)
      assert.equal((await pedir('/api/finanzas', { cookie: cookieDe(rol) })).estado, 401, rol)
    }
    assert.equal((await pedir('/api/finanzas', { cookie: cookieDe('closer'), cabeceras: { authorization: `Bearer ${CRON}` } })).estado, 401)
    assert.equal((await pedir('/api/finanzas', { cookie: `${cookieFin()}; ${cookieDe('closer')}` })).pasa, true)
    assert.equal((await pedir('/api/finanzas')).estado, 401)
  })
  test('8/10/2026: el ADMINISTRADOR con sesión de Google entra a Finanzas sin la contraseña (página y API)', async () => {
    assert.equal((await pedir('/finanzas', { cookie: cookieDe('socio') })).pasa, true)
    assert.equal((await pedir('/api/finanzas', { cookie: cookieDe('socio') })).pasa, true)
    // una cookie de sesión falsificada no sirve
    assert.equal((await pedir('/finanzas', { cookie: `${COOKIE_SESION}=v1.falsa.firma` })).estado, 307)
  })
  test('login y logout de Finanzas siguen libres', async () => {
    for (const p of ['/finanzas/login', '/api/finanzas/login', '/api/finanzas/logout']) assert.equal((await pedir(p, { metodo: p.startsWith('/api') ? 'POST' : 'GET' })).pasa, true, p)
  })
  test('sin FINANZAS_PASSWORD no se abre nada: 503 JSON en la API y redirección en la página', async () => {
    delete process.env.FINANZAS_PASSWORD
    const a = await pedir('/api/finanzas')
    assert.equal(a.estado, 503)
    assert.match(a.json.error, /FINANZAS_PASSWORD/)
    assert.equal((await pedir('/finanzas')).estado, 307)
    assert.equal((await pedir('/finanzas', { cookie: cookieDe('closer') })).estado, 307)
    // el administrador se identificó con Google: entra aunque falte la contraseña
    assert.equal((await pedir('/finanzas', { cookie: cookieDe('socio') })).pasa, true)
  })
  test('/api/finanzas-cierre (cron) no se confunde con /api/finanzas', async () => {
    assert.equal((await pedir('/api/finanzas-cierre')).fuera, true)
    assert.equal((await pedir('/api/finanzas/x')).estado, 401)
  })
})

describe('proxy: casos de borde en la URL', () => {
  // Rutas protegidas escritas de otra forma: tienen que dar lo mismo que la limpia (401 sin credenciales)
  const variantesRaw = ['/api/raw/', '/API/RAW', '/Api/Raw', '/api//raw', '//api//raw', '/api/./raw', '/api/x/../raw', '/api/%2e/raw', '/api/raw?x=1', '/api/raw#frag', '/api/RAW/']
  for (const ruta of variantesRaw) {
    test(`${ruta} sin credenciales no pasa`, async () => {
      const r = await pedir(ruta)
      assert.equal(r.pasa, false, 'no tiene que abrirse')
      assert.equal(r.fuera, false, 'tiene que pasar por el proxy')
      assert.equal(r.estado, 401)
    })
  }
  test('barra final, mayúsculas y barras dobles con sesión de socio: llegan a la ruta; con csm, 403', async () => {
    for (const ruta of ['/api/raw/', '/API/RAW', '//api//raw']) {
      assert.equal((await pedir(ruta, { cookie: cookieDe('socio') })).pasa, true, ruta)
      assert.equal((await pedir(ruta, { cookie: cookieDe('csm') })).estado, 403, ruta)
    }
  })
  test('%2F, %5C, doble codificación y caracteres de control: nunca abren una ruta protegida', async () => {
    for (const ruta of ['/api%2Fraw', '/api/raw%2F', '/api%5Craw', '/api/raw%00', '/api/%252e%252e/raw', '/api/raw%0a', '/api/%E0%A4%A/raw', '/%2e%2e/api/raw']) {
      const r = await pedir(ruta)
      assert.equal(r.pasa, false, ruta)
      assert.ok([401, 307].includes(r.estado), `${ruta}: ${r.estado}`)
    }
  })
  test('rutas abiertas con truco de "/" o ".." codificado: no se las trata como abiertas', async () => {
    for (const ruta of ['/api/auth/..%2Fraw', '/v/..%2Fapi%2Fraw', '/_next/..%2Fapi%2Fraw', '/api/analista%2F..%2Fraw', '/entrar%2F..%2Fapi%2Fraw', '/api/calendly-webhook%2F..%2Fraw']) {
      const r = await pedir(ruta)
      assert.equal(r.pasa, false, ruta)
      assert.equal(r.fuera, false, ruta)
    }
  })
  test('"%2e%2e" es ".." para la URL: /api/%2E%2E/raw llega como /raw (página inexistente, cerrada)', async () => {
    assert.equal(new URL(`${BASE}/api/%2E%2E/raw`).pathname, '/raw')
    assert.equal((await pedir('/api/%2E%2E/raw')).pasa, false)
  })
  test('con ../ literal la URL ya llega resuelta: /v/../api/raw y /entrar/../api/raw son /api/raw', async () => {
    for (const ruta of ['/v/../api/raw', '/entrar/../api/raw', '/api/auth/../raw', '/_next/static/../../api/raw']) {
      assert.equal(new URL(ruta, BASE).pathname, '/api/raw')
      assert.equal((await pedir(ruta)).estado, 401, ruta)
    }
  })
  test('barra final, mayúsculas y barras dobles en las páginas protegidas', async () => {
    for (const ruta of ['/clientes/', '/CLIENTES', '/Clientes/Cli-001', '//clientes', '/ventas/', '/referidos//']) {
      const r = await pedir(ruta)
      assert.equal(r.pasa, false, ruta)
      assert.equal(r.estado, 307, ruta)
      // "//clientes" no es una ruta segura para volver (empieza con dos barras): va a /entrar sin next
      assert.match(ubicacion(r), ruta === '//clientes' ? /^\/entrar$/ : /^\/entrar\?next=/, ruta)
    }
  })
  test('barra final, mayúsculas y barras dobles en lo que sí es público/automático: se comportan igual que antes', async () => {
    assert.equal((await pedir('/entrar/')).pasa, true)
    assert.equal((await pedir('/ENTRAR')).pasa, true)
    assert.equal((await pedir('/api/analista/')).pasa, true)
    assert.equal((await pedir('//api//reporte-eod')).pasa, true)
    assert.equal((await pedir('/Finanzas/Login')).pasa, true)
  })
  test('encabezados de bypass conocidos (x-middleware-subrequest y compañía) no abren nada', async () => {
    const trucos = [
      { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' },
      { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy' },
      { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' },
      { 'x-middleware-subrequest': 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy' },
      { 'x-middleware-prefetch': '1' }, { 'x-nextjs-data': '1' }, { 'x-middleware-next': '1' }, { 'x-middleware-rewrite': '/entrar' },
      { 'x-invoke-path': '/entrar' }, { 'x-invoke-status': '200' }, { 'x-matched-path': '/entrar' }, { 'x-original-url': '/entrar' },
      { 'x-rewrite-url': '/entrar' }, { 'x-forwarded-for': '127.0.0.1' }, { 'x-forwarded-host': 'localhost:3101' }, { 'x-forwarded-proto': 'https' },
      { rsc: '1' }, { 'next-router-prefetch': '1' }, { 'next-router-state-tree': '[]' }, { 'x-vercel-cron': '1' }, { 'user-agent': 'vercel-cron/1.0' },
      { 'x-forwarded-user': 'ana.socia@ejemplo.test' }, { 'x-user-email': 'ana.socia@ejemplo.test' },
    ]
    for (const cabeceras of trucos) {
      assert.equal((await pedir('/', { cabeceras })).pasa, false, JSON.stringify(cabeceras))
      assert.equal((await pedir('/api/raw', { cabeceras })).estado, 401, JSON.stringify(cabeceras))
      assert.equal((await pedir('/clientes', { cabeceras })).pasa, false, JSON.stringify(cabeceras))
    }
  })
  test('parámetros de búsqueda de bypass (?key=, ?token=, ?_rsc=, ?__nextDataReq=) no abren nada', async () => {
    for (const q of [`key=${CRON}`, `token=${CRON}`, `secret=${CRON}`, '_rsc=abc', '__nextDataReq=1', 'preview=1', 'next=/entrar']) {
      assert.equal((await pedir(`/api/raw?${q}`)).estado, 401, q)
      assert.equal((await pedir(`/?${q}`)).pasa, false, q)
    }
  })
  test('rutas con sufijos de Next (.rsc, .json, .segments) sin sesión: cerradas', async () => {
    for (const ruta of ['/clientes.rsc', '/clientes.json', '/clientes.segments/_tree.segment.rsc', '/clientes/cli-001.segments/_tree.segment.rsc']) {
      assert.equal((await pedir(ruta)).pasa, false, ruta)
    }
  })
  test('/_next/data/<build>/api/raw.json: Next lo normaliza a /api/raw antes del proxy, así que queda cerrado', async () => {
    assert.equal(new NextRequest(`${BASE}/_next/data/abc/api/raw.json`).nextUrl.pathname, '/api/raw')
    assert.equal((await pedir('/_next/data/abc/api/raw.json')).estado, 401)
    assert.equal((await pedir('/_next/data/abc/clientes.json')).pasa, false)
  })
  test('rutas declaradas pero con otro método: se aplica la misma regla', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      assert.equal((await pedir('/api/raw', { metodo })).estado, 401, metodo)
    }
    assert.equal((await pedir('/', { metodo: 'HEAD' })).estado, 307)
  })
})

describe('proxy: el usuario de prueba de desarrollo (CRM_DEV_ROL)', () => {
  test('solo en desarrollo y desde esta compu, igual que obtenerSesion()', async () => {
    entorno({ CRM_DEV_ROL: 'socio', AUTH_SECRET: undefined, AUTH_USUARIOS: undefined })
    assert.equal((await pedir('/')).pasa, true)
    assert.equal((await pedir('/api/raw')).pasa, true)
    assert.equal((await pedir('/', { host: '192.168.0.15:3101' })).pasa, false, 'host de la red')
    assert.equal((await pedir('/', { cabeceras: { 'x-forwarded-host': 'abc.ngrok.app' } })).pasa, false, 'túnel')
    entorno({ CRM_DEV_ROL: 'csm', AUTH_SECRET: undefined, AUTH_USUARIOS: undefined })
    assert.equal((await pedir('/api/raw')).estado, 403)
    assert.equal(ubicacion(await pedir('/')), '/clientes')
  })
  test('en producción y en cualquier despliegue de Vercel se ignora', async () => {
    entorno({ NODE_ENV: 'production', CRM_DEV_ROL: 'socio' })
    assert.equal((await pedir('/')).pasa, false)
    entorno({ VERCEL_ENV: 'production', CRM_DEV_ROL: 'socio' })
    assert.equal((await pedir('/api/raw')).estado, 401)
  })
  test('rol inválido: sin sesión', async () => {
    entorno({ CRM_DEV_ROL: 'admin' })
    assert.equal((await pedir('/')).pasa, false)
  })
})

describe('regla pública /bot/*', () => {
  test('no existe nada en app/bot/: la regla pública es solo para las fotos de public/bot', () => {
    // Si alguien crea una página o ruta en app/bot/…, quedaría abierta sin sesión por la regla '/bot/*' de rutas.ts
    const dir = join(RAIZ, 'app', 'bot')
    assert.ok(!existsSync(dir), 'apareció app/bot/: moverlo a otra ruta o cambiar la regla pública /bot/* de lib/auth/rutas.ts')
  })
  test('public/bot solo tiene imágenes', () => {
    const dir = join(RAIZ, 'public', 'bot')
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir)) assert.match(f, /\.(jpe?g|png|webp)$/i, `public/bot/${f} no es una imagen`)
  })
})

describe('matcher de proxy.ts', () => {
  test('el matcher es el esperado (si se toca, este test obliga a revisar la tabla)', () => {
    assert.equal(config.matcher.length, 1)
    const m = config.matcher[0]
    assert.ok(m.startsWith('/((?!_next/static|_next/image|favicon\\.ico$|v/[^/%]+$|api/(?:'), m)
    assert.ok(m.endsWith(')/?$).*)'), m)
    assert.ok(!m.includes('finanzas|') && !m.includes('|raw'), 'las rutas protegidas no se excluyen')
    assert.deepEqual([...m.matchAll(/(?:\||\()clientes([^|)]*)/g)].map(x => x[1]), ['/sincronizar', '/inactivos/cron'], 'sólo las dos rutas exactas autenticadas por CRON_SECRET salen del proxy')
    for (const p of ['/api/clientes', '/api/clientes/inactivos', '/api/clientes/sincronizar/x', '/api/clientes/inactivos/cron/x']) assert.equal(pasaPorProxy(p), true, `${p} permanece protegido`)
  })
  test('todo lo que el matcher deja afuera está abierto en la tabla (si no, sería un hueco)', () => {
    const sondas = new Set(['/', '/entrar', '/api/raw', '/api/metrics', '/api/ads', '/ventas', '/clientes', '/clientes/x', '/referidos', '/sistema', '/finanzas', '/api/finanzas'])
    for (const r of REGLAS) {
      const base = r.patron.endsWith('/*') ? r.patron.slice(0, -2) : r.patron
      for (const p of [base, `${base}/x`, `${base}/`, `${base}/x/y.js`]) sondas.add(p)
    }
    for (const p of ['/api/analista-x', '/api/analistax', '/api/analista.json', '/api/analista/x', '/v/x/y.mp4', '/v/..%2Fapi%2Fraw', '/vx/a', '/_next', '/_nextx/a', '/favicon.ico.bak', '/favicon.icox', '/api', '/api/']) sondas.add(p)
    let afuera = 0, protegidasConProxy = 0
    for (const p of sondas) {
      const q = resolverRegla(p).regla.quien
      if (!pasaPorProxy(p)) {
        afuera++
        assert.match(q, /^(publico|propio)$/, `${p} queda fuera del proxy pero la tabla la protege (${q})`)
      } else if (/^(finanzas|google|google_o_maquina)$/.test(q)) protegidasConProxy++
    }
    assert.ok(afuera >= 15, `fuera del proxy: ${afuera}`)
    assert.ok(protegidasConProxy >= 15, `protegidas que pasan por el proxy: ${protegidasConProxy}`)
  })
  test('toda ruta protegida de la tabla pasa por el proxy', () => {
    for (const r of REGLAS.filter((x) => /^(finanzas|google|google_o_maquina)$/.test(x.quien))) {
      const base = r.patron.endsWith('/*') ? r.patron.slice(0, -2) : r.patron
      for (const p of [base, `${base}/x`, `${base}/`]) assert.ok(pasaPorProxy(p), `${p} no pasa por el proxy`)
    }
  })
  test('las rutas de automatización del matcher son exactamente las "propio" de cron, webhook y EOD', () => {
    const delMatcher = [...config.matcher[0].matchAll(/api\/\(\?:([^)]*)\)/g)][0][1].split('|').map((n) => `/api/${n}`).sort()
    const delaTabla = REGLAS.filter((r) => r.quien === 'propio' && /^\/api\/[^*]+$/.test(r.patron) && !r.patron.startsWith('/api/anuncios')).map((r) => r.patron).sort()
    assert.deepEqual(delMatcher, delaTabla)
    const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons.map((c) => c.path.split('?')[0])
    for (const c of crons) assert.ok(delMatcher.includes(c), `${c} (vercel.json) no está en el matcher`)
  })
  test('la ruta de la sesión de Google en el matcher: "/" y las páginas pasan por el proxy', () => {
    for (const p of ['/', '/clientes', '/clientes/abc', '/ventas', '/referidos', '/sistema', '/finanzas', '/finanzas/login', '/api/raw', '/api/metrics', '/api/ads', '/api/clientes', '/api/finanzas']) {
      assert.ok(pasaPorProxy(p), p)
    }
  })
})

describe('segunda barrera: exigirAccesoApi y helpers (lo usan /api/raw, /api/metrics y /api/ads)', () => {
  const req = (cabeceras = {}) => new Request(`${BASE}/api/raw`, { headers: cabeceras })
  test('sin credenciales 401 JSON; rol sin permiso 403; socio pasa (null)', async () => {
    const r401 = exigirAccesoApi(req(), 'resumen', { maquina: true })
    assert.equal(r401.status, 401)
    assert.equal(r401.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await r401.json(), { error: 'No autorizado' })
    assert.equal(exigirAccesoApi(req({ cookie: cookieDe('csm') }), 'resumen', { maquina: true }).status, 403)
    assert.equal(exigirAccesoApi(req({ cookie: cookieDe('socio') }), 'resumen', { maquina: true }), null)
  })
  test('Bearer: solo con maquina:true', () => {
    const auth = { authorization: `Bearer ${CRON}` }
    assert.equal(exigirAccesoApi(req(auth), 'resumen', { maquina: true }), null)
    assert.equal(exigirAccesoApi(req(auth), 'resumen').status, 401)
    assert.equal(exigirAccesoApi(req({ authorization: 'Bearer mal' }), 'resumen', { maquina: true }).status, 401)
  })
  test('accesoMaquina: formato y secreto', () => {
    const h = (v) => new Headers(v ? { authorization: v } : {})
    assert.equal(accesoMaquina(h(`Bearer ${CRON}`)), true)
    assert.equal(accesoMaquina(h(`BEARER   ${CRON}  `)), true)
    assert.equal(accesoMaquina(h()), false)
    assert.equal(accesoMaquina(h(`Bearer ${CRON} x`)), false)
    delete process.env.CRON_SECRET
    assert.equal(accesoMaquina(h('Bearer ')), false)
  })
  test('sesionDePeticion: la cookie de sesión manda y toma la primera si viene repetida', () => {
    assert.equal(sesionDePeticion(new Headers({ cookie: cookieDe('csm') })).rol, 'csm')
    assert.equal(sesionDePeticion(new Headers({ cookie: `x=1; ${cookieDe('closer')}; y=2` })).rol, 'closer')
    assert.equal(sesionDePeticion(new Headers()), null)
  })
  for (const archivo of ['raw', 'metrics', 'ads']) {
    test(`app/api/${archivo}/route.ts llama a exigirAccesoApi con maquina:true antes de leer nada`, () => {
      const fuente = readFileSync(join(RAIZ, 'app', 'api', archivo, 'route.ts'), 'utf8')
      const i = fuente.indexOf("exigirAccesoApi(")
      assert.ok(i > 0, 'falta la barrera')
      assert.match(fuente.slice(i, i + 80), /'resumen', \{ maquina: true \}/)
      assert.ok(i < fuente.indexOf('try {'), 'la barrera tiene que ir antes de leer datos')
    })
    test(`GET /api/${archivo} responde 401 sin credenciales y 403 a un csm (sin llegar a Sheets ni a Meta)`, async () => {
      const { GET } = await import(`../app/api/${archivo}/route.ts`)
      assert.equal((await GET(new Request(`${BASE}/api/${archivo}`))).status, 401)
      assert.equal((await GET(new Request(`${BASE}/api/${archivo}`, { headers: { cookie: cookieDe('csm') } }))).status, 403)
    })
  }
})

describe('Resumen en el navegador: con la sesión vencida los datos no quedan congelados en silencio', () => {
  const alVencer = () => { alVencer.llamadas++ }
  beforeEach(() => { alVencer.llamadas = 0 })

  test('el login al que se lleva es el mismo que arma el proxy para "/"', () => {
    assert.equal(LOGIN_VUELTA_AL_RESUMEN, destinoEntrar('/', ''))
    assert.equal(LOGIN_VUELTA_AL_RESUMEN, '/entrar?next=/')
  })

  for (const archivo of ['raw', 'metrics', 'ads']) {
    test(`el 401 REAL de /api/${archivo} lleva al login y conserva el formato { error }`, async () => {
      const { GET } = await import(`../app/api/${archivo}/route.ts`)
      const res = await GET(new Request(`${BASE}/api/${archivo}`)) // sin cookie ni Bearer: lo que ve una pestaña con la sesión vencida
      assert.equal(res.status, 401)
      const json = await leerJsonDeDatos(res, alVencer)
      assert.equal(alVencer.llamadas, 1)
      assert.deepEqual(json, { error: ERROR_SESION_VENCIDA })
      assert.ok(!json.transactions, 'no puede parecer un dato válido: page.tsx lo descarta por tener "error"')
    })
  }

  test('403 (otro rol), 200 y 500 no llevan al login: se leen como antes', async () => {
    const { GET } = await import('../app/api/raw/route.ts')
    const sinPermiso = await GET(new Request(`${BASE}/api/raw`, { headers: { cookie: cookieDe('csm') } }))
    assert.equal(sinPermiso.status, 403)
    assert.deepEqual(await leerJsonDeDatos(sinPermiso, alVencer), { error: 'Sin permiso para esta sección' })
    const datos = { transactions: [1] }
    assert.deepEqual(await leerJsonDeDatos(Response.json(datos), alVencer), datos)
    assert.deepEqual(await leerJsonDeDatos(Response.json({ error: 'boom' }, { status: 500 }), alVencer), { error: 'boom' })
    assert.equal(alVencer.llamadas, 0)
  })

  test('un cuerpo que no es JSON sigue lanzando (page.tsx lo atrapa como antes)', async () => {
    await assert.rejects(() => leerJsonDeDatos(new Response('<html>', { status: 502 }), alVencer))
    assert.equal(alVencer.llamadas, 0)
  })

  test('el Resumen (components/ResumenDashboard.tsx) lee TODOS sus datos con leerJsonDeDatos (ningún .json() suelto que ignore el 401)', () => {
    const fuente = readFileSync(join(RAIZ, 'components', 'ResumenDashboard.tsx'), 'utf8')
    for (const ruta of ['/api/metrics', '/api/raw', '/api/ads']) {
      const i = fuente.indexOf(`fetch('${ruta}'`)
      assert.ok(i > 0, `ResumenDashboard.tsx ya no pide ${ruta}`)
      assert.match(fuente.slice(i, i + 160), /leerJsonDeDatos\(r, irAlLogin\)/, `${ruta} no pasa por leerJsonDeDatos`)
    }
    assert.doesNotMatch(fuente, /\.json\(\)/, 'una lectura de datos nueva tiene que pasar por leerJsonDeDatos')
    assert.match(fuente, /window\.location\.assign\(LOGIN_VUELTA_AL_RESUMEN\)/)
  })

  test('app/page.tsx sigue protegida del lado del servidor: exige acceso al Resumen antes de renderizar (no es bypass del guard)', () => {
    const fuente = readFileSync(join(RAIZ, 'app', 'page.tsx'), 'utf8')
    const a = fuente.indexOf("await exigirAcceso('resumen')"), r = fuente.indexOf('<ResumenDashboard')
    assert.ok(a > 0 && r > a, 'page.tsx tiene que llamar exigirAcceso(\'resumen\') antes de renderizar el Resumen')
    assert.doesNotMatch(fuente, /'use client'/)
  })
})

describe('roles: rutaMenu (a dónde vuelve "Volver al menú")', () => {
  test('siempre es una página del shell que el rol puede ver', () => {
    const conMenu = new Set(['/', '/clientes', '/ventas', '/clientes/referidos'])
    for (const rol of ROLES_FIJOS) {
      const ruta = rutaMenu(rol)
      assert.ok(conMenu.has(ruta), `${rol}: ${ruta}`)
      const sec = SECCIONES.find((s) => RUTA_SECCION[s] === ruta)
      assert.ok(MATRIZ_ROLES[rol].includes(sec), `${rol} no ve ${ruta}`)
    }
    assert.equal(rutaMenu('socio'), '/') // el Resumen ya vive dentro del shell
    assert.equal(rutaMenu('csm'), '/clientes')
    assert.equal(rutaMenu('closer'), '/ventas')
    assert.equal(rutaMenu('setter'), '/ventas')
  })
})

describe('documentación: docs/ACCESO-Y-ROLES.md tiene la tabla de rutas al día', () => {
  const doc = readFileSync(join(RAIZ, 'docs', 'ACCESO-Y-ROLES.md'), 'utf8')
  for (const r of REGLAS) {
    test(`figura ${r.patron}`, () => assert.ok(doc.includes(`\`${r.patron}\``), `falta \`${r.patron}\` en docs/ACCESO-Y-ROLES.md`))
  }
  test('figura la regla por defecto y existe el archivo del proxy', () => {
    assert.ok(doc.includes('cualquier otra'))
    assert.ok(existsSync(join(RAIZ, 'proxy.ts')))
  })
  test('Backend (retirado el 10/10/2026) ya no figura entre las secciones que se marcan en Configuración', () => {
    const linea = doc.split('\n').find((l) => l.startsWith('- **Acceso:**'))
    assert.ok(linea, 'falta la línea "- **Acceso:**" de Configuración')
    const marcadas = /marca qué secciones ve \(([^)]*)\)/.exec(linea)?.[1] ?? ''
    assert.ok(marcadas.includes('Cobro de cuotas') && marcadas.includes('Clientes'), marcadas)
    assert.equal(/Backend/.test(marcadas), false, marcadas)
    assert.equal(SECCIONES.includes('backend'), false)
  })
})

// ── Edición (24/10/2026): sección nueva, su API y las tres rutas del bot de grabación ───────────────────────────────
describe('Edición: /clientes/edicion (antes /edicion), /api/edicion y las rutas del bot de grabación', () => {
  test('la sección existe, va después de Guiones y su ruta es /clientes/edicion (solo socio en la matriz fija)', () => {
    assert.ok(SECCIONES.includes('edicion'))
    assert.equal(SECCIONES.indexOf('edicion'), SECCIONES.indexOf('guiones') + 1)
    assert.equal(RUTA_SECCION.edicion, '/clientes/edicion')
    for (const rol of ROLES_FIJOS) assert.equal(puedeVer(rol, 'edicion'), rol === 'socio', rol)
  })
  test('/clientes/edicion y sus páginas: socio pasa; csm, closer y setter van a su sección; sin sesión, a /entrar', async () => {
    for (const ruta of ['/clientes/edicion', '/clientes/edicion/cliente/A101', '/clientes/edicion/video/12', '/clientes/edicion/pendientes', '/clientes/edicion/vinculos', '/clientes/edicion/avisos']) {
      assert.equal((await pedir(ruta, { cookie: cookieDe('socio') })).pasa, true, ruta)
      // csm tiene otra pestaña del hub (Cartera): se queda en Clientes (destinoSinPermiso); closer y setter, a su inicio
      for (const rol of ['csm', 'closer', 'setter']) assert.equal(ubicacion(await pedir(ruta, { cookie: cookieDe(rol) })), rutaInicial(rol), `${ruta} ${rol}`)
      assert.match(ubicacion(await pedir(ruta)), /^\/entrar\?next=\/clientes\/edicion/, ruta)
    }
  })
  test('un acceso con solo [edicion] (René) entra a /clientes/edicion y a su API, y no a la Cartera', () => {
    const rene = () => ({ sesion: { rol: 'acceso', secciones: ['edicion'] }, maquina: false })
    assert.equal(decidir({ pathname: '/clientes/edicion', contexto: rene }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/clientes/edicion/video/3', contexto: rene }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/api/edicion', contexto: rene }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/clientes/A101', contexto: rene }).accion, 'redirigir')
    assert.equal(decidir({ pathname: '/api/clientes/A101/kickoff', contexto: rene }).estado, 403)
    assert.equal(rutaInicial({ rol: 'acceso', secciones: ['edicion'] }), '/clientes/edicion')
  })
  test('/api/edicion y /api/edicion/pedido: sesión con la sección; el Bearer NO sirve; JSON 401/403, nunca redirección', async () => {
    for (const ruta of ['/api/edicion', '/api/edicion/pedido']) {
      assert.equal((await pedir(ruta, { metodo: 'POST', cabeceras: { authorization: `Bearer ${CRON}` } })).estado, 401, ruta)
      const csm = await pedir(ruta, { metodo: 'POST', cookie: cookieDe('csm') })
      assert.equal(csm.estado, 403, ruta)
      assert.equal(csm.location, null)
      assert.equal((await pedir(ruta, { metodo: 'POST', cookie: cookieDe('socio') })).pasa, true, ruta)
      assert.equal(resolverRegla(ruta).regla.seccion, 'edicion')
    }
  })
  test('vigía, webhook de transcripción y diario: fuera del proxy y "propio" (se autentican solos, sin cookie)', async () => {
    for (const ruta of ['/api/bot/grabacion/vigia', '/api/bot/grabacion/transcripcion', '/api/bot/grabacion/diario']) {
      assert.equal(resolverRegla(ruta).regla.quien, 'propio', ruta)
      assert.equal((await pedir(ruta, { metodo: 'POST' })).fuera, true, ruta)
      assert.equal((await pedir(`${ruta}?dry=1`, { metodo: 'POST' })).fuera, true, `${ruta}?dry=1`)
    }
    // Solo las tres exactas: otra ruta colgada de /api/bot/grabacion pasa por el proxy y cae cerrada
    for (const ruta of ['/api/bot/grabacion', '/api/bot/grabacion/otra', '/api/bot/grabacion/vigia/x', '/api/bot/grabacion%2Fvigia']) {
      assert.equal((await pedir(ruta)).fuera, false, ruta)
      assert.doesNotMatch(resolverRegla(ruta).regla.quien, /^(publico|propio)$/, ruta)
    }
  })
  test('el cron diario de Edición está en vercel.json, sin query, a las 10:00 UTC (7:00 AR)', () => {
    const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons
    const c = crons.find((x) => x.path.startsWith('/api/bot/grabacion'))
    assert.deepEqual(c, { path: '/api/bot/grabacion/diario', schedule: '0 10 * * *' })
  })
  test('la documentación nombra las cinco reglas y la sección', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'ACCESO-Y-ROLES.md'), 'utf8')
    for (const p of ['/clientes/edicion/*', '/api/edicion/*', '/api/bot/grabacion/vigia', '/api/bot/grabacion/transcripcion', '/api/bot/grabacion/diario']) assert.ok(doc.includes(`\`${p}\``), p)
    assert.ok(doc.includes('## Edición (24/10/2026)'))
    const linea = doc.split('\n').find((l) => l.startsWith('- **Acceso:**'))
    assert.ok(/marca qué secciones ve \([^)]*Edición/.test(linea), 'Edición entre las secciones que se marcan')
  })
})

// ── Etapa Éxito del bot "Capital Jurídico" (25/10/2026): /api/bot/exito ──────────────────────────────────────────────────
describe('etapa Éxito: /api/bot/exito es "propio", fuera del proxy, con su cron y falla cerrado', () => {
  test('fuera del proxy y "propio" (se autentica sola con el Bearer, sin cookie)', async () => {
    assert.equal(resolverRegla('/api/bot/exito').regla.quien, 'propio')
    assert.equal((await pedir('/api/bot/exito')).fuera, true)
    assert.equal((await pedir('/api/bot/exito?dry=1')).fuera, true)
    // Solo la exacta: otra ruta colgada de /api/bot/exito pasa por el proxy y cae cerrada
    for (const ruta of ['/api/bot/exito/otra', '/api/bot/exitox', '/api/bot/exito%2Fx']) {
      assert.equal((await pedir(ruta)).fuera, false, ruta)
      assert.doesNotMatch(resolverRegla(ruta).regla.quien, /^(publico|propio)$/, ruta)
    }
  })
  test('el cron diario está en vercel.json, sin query, a las 13:00 UTC (10:00 AR)', () => {
    const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons
    assert.deepEqual(crons.find((x) => x.path.startsWith('/api/bot/exito')), { path: '/api/bot/exito', schedule: '0 13 * * *' })
  })
  test('la ruta pide CRON_SECRET por Bearer y nunca ?key=: 503 sin secreto, 401 con otro', async () => {
    const { autorizarExito } = await import('../lib/bot/exito/ruta.ts')
    const h = (v) => ({ get: (k) => (k === 'authorization' ? v : null) })
    assert.deepEqual(autorizarExito(h(`Bearer ${CRON}`), {}), { ok: false, status: 503 })
    assert.deepEqual(autorizarExito(h('Bearer otro'), { CRON_SECRET: CRON }), { ok: false, status: 401 })
    assert.deepEqual(autorizarExito(h(`Bearer ${CRON}`), { CRON_SECRET: CRON }), { ok: true })
    const fuente = readFileSync(join(RAIZ, 'app', 'api', 'bot', 'exito', 'route.ts'), 'utf8')
    assert.doesNotMatch(fuente, /searchParams\.get\(['"]key['"]\)/)
    assert.match(fuente, /autorizarExito\(req\.headers, process\.env\)/)
  })
})

// ── Etapa Bajas del bot "Capital Jurídico" (25/10/2026): /api/bot/bajas ──────────────────────────────────────────────────
describe('etapa Bajas: /api/bot/bajas es "propio", fuera del proxy, con su cron y falla cerrado', () => {
  test('fuera del proxy y "propio" (se autentica sola con el Bearer, sin cookie)', async () => {
    assert.equal(resolverRegla('/api/bot/bajas').regla.quien, 'propio')
    assert.equal((await pedir('/api/bot/bajas')).fuera, true)
    assert.equal((await pedir('/api/bot/bajas?dry=1')).fuera, true)
    for (const ruta of ['/api/bot/bajas/otra', '/api/bot/bajasx', '/api/bot/bajas%2Fx']) {
      assert.equal((await pedir(ruta)).fuera, false, ruta)
      assert.doesNotMatch(resolverRegla(ruta).regla.quien, /^(publico|propio)$/, ruta)
    }
  })
  test('el cron diario está en vercel.json, sin query, a las 13:30 UTC (10:30 AR)', () => {
    const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons
    assert.deepEqual(crons.find((x) => x.path.startsWith('/api/bot/bajas')), { path: '/api/bot/bajas', schedule: '30 13 * * *' })
  })
  test('la ruta pide CRON_SECRET por Bearer y nunca ?key=: 503 sin secreto, 401 con otro', async () => {
    const { autorizarBajas } = await import('../lib/bot/bajas/ruta.ts')
    const h = (v) => ({ get: (k) => (k === 'authorization' ? v : null) })
    assert.deepEqual(autorizarBajas(h(`Bearer ${CRON}`), {}), { ok: false, status: 503 })
    assert.deepEqual(autorizarBajas(h('Bearer otro'), { CRON_SECRET: CRON }), { ok: false, status: 401 })
    assert.deepEqual(autorizarBajas(h(`Bearer ${CRON}`), { CRON_SECRET: CRON }), { ok: true })
    const fuente = readFileSync(join(RAIZ, 'app', 'api', 'bot', 'bajas', 'route.ts'), 'utf8')
    assert.doesNotMatch(fuente, /searchParams\.get\(['"]key['"]\)/)
    assert.match(fuente, /autorizarBajas\(req\.headers, process\.env\)/)
  })
})

// ── Clientes como hub (25/10/2026): pestañas, rutas nuevas y redirecciones ─────────────────────────────────────────────
describe('hub Clientes: rutas de las pestañas, redirecciones y que nada se interprete como un <id>', () => {
  const APP = join(RAIZ, 'app', '(shell)', 'clientes')
  test('Edición y Referidos se resuelven por su sección antes que la Cartera ("/clientes/*")', () => {
    assert.equal(resolverRegla('/clientes/edicion').regla.seccion, 'edicion')
    assert.equal(resolverRegla('/clientes/edicion/video/3').regla.seccion, 'edicion')
    assert.equal(resolverRegla('/clientes/referidos').regla.seccion, 'referidos')
    assert.equal(resolverRegla('/clientes').regla.seccion, 'clientes')
    assert.equal(resolverRegla('/clientes/A101').regla.seccion, 'clientes')
    assert.equal(resolverRegla('/clientes/A101/kickoff').regla.seccion, 'clientes')
    assert.equal(resolverRegla('/clientes/edicionx').regla.seccion, 'clientes') // prefijo por segmentos
    const i = (p) => REGLAS.findIndex((r) => r.patron === p)
    assert.ok(i('/clientes/edicion/*') < i('/clientes/*') && i('/clientes/referidos/*') < i('/clientes/*'))
  })
  test('las pestañas son carpetas estáticas (Next las prefiere a [id]) y ningún ID de cliente puede llamarse así', async () => {
    const { ID_CLIENTE_VALIDO } = await import('../lib/clientes/ficha.ts')
    for (const p of ['edicion', 'referidos']) assert.ok(existsSync(join(APP, p, 'page.tsx')), `${p}/page.tsx`)
    for (const p of ['edicion', 'referidos', 'guiones', 'anuncios', 'cartera', 'kickoff']) assert.equal(ID_CLIENTE_VALIDO.test(p), false, p)
    // La Cartera vive en un grupo (cartera) con su barrera; la ficha sigue en [id] con la suya: las dos piden 'clientes'
    assert.match(readFileSync(join(APP, '(cartera)', 'layout.tsx'), 'utf8'), /exigirAcceso\('clientes'\)/)
    assert.match(readFileSync(join(APP, '[id]', 'layout.tsx'), 'utf8'), /exigirAcceso\('clientes'\)/)
    assert.match(readFileSync(join(APP, 'edicion', 'layout.tsx'), 'utf8'), /exigirAcceso\('edicion'\)/)
    assert.match(readFileSync(join(APP, 'referidos', 'layout.tsx'), 'utf8'), /exigirAcceso\('referidos'\)/)
    assert.doesNotMatch(readFileSync(join(APP, 'layout.tsx'), 'utf8'), /exigirAcceso\('clientes'\)/, 'el layout del hub no puede pedir la Cartera: dejaría afuera a René')
    // Ya no quedan las carpetas viejas
    for (const p of ['edicion', 'referidos']) assert.equal(existsSync(join(RAIZ, 'app', '(shell)', p)), false, p)
  })
  test('/guiones/[id] (sección Guiones sola) no se mueve ni se redirige', async () => {
    assert.ok(existsSync(join(RAIZ, 'app', '(shell)', 'guiones', '[id]', 'page.tsx')))
    const faus = () => ({ sesion: { rol: 'acceso', secciones: ['guiones'] }, maquina: false })
    assert.equal(decidir({ pathname: '/guiones/A101', contexto: faus }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/api/guiones/A101', contexto: faus }).accion, 'pasar')
    const { REDIRECCIONES_HUB } = await import('../next.config.ts')
    assert.ok(REDIRECCIONES_HUB.every((r) => !r.source.startsWith('/guiones') && !r.source.startsWith('/anuncios') && !r.source.startsWith('/api')))
  })
  test('redirecciones permanentes desde /edicion y /referidos, con subrutas (la query la conserva Next)', async () => {
    const { REDIRECCIONES_HUB } = await import('../next.config.ts')
    assert.deepEqual(REDIRECCIONES_HUB, [
      { source: '/edicion/:ruta*', destination: '/clientes/edicion/:ruta*', permanent: true },
      { source: '/referidos/:ruta*', destination: '/clientes/referidos/:ruta*', permanent: true },
    ])
  })
  test('Anuncios sigue con su clave propia, sin Google (Valentino), en /anuncios', () => {
    assert.equal(resolverRegla('/anuncios').regla.quien, 'propio')
    assert.equal(resolverRegla('/anuncios/login').regla.quien, 'propio')
    assert.equal(resolverRegla('/api/anuncios').regla.quien, 'propio')
    assert.equal(decidir({ pathname: '/anuncios', contexto: () => ({ sesion: null, maquina: false }) }).accion, 'pasar')
    // Con la clave sola no hay sesión: tampoco entra a la Cartera ni a otra pestaña
    for (const p of ['/clientes', '/clientes/edicion', '/clientes/referidos', '/guiones']) {
      const d = decidir({ pathname: p, contexto: () => ({ sesion: null, maquina: false }) })
      assert.equal(d.accion, 'redirigir', p); assert.match(d.destino, /^\/entrar/, p)
    }
  })
  test('sin permiso para una pestaña, a la primera pestaña que sí ve (nunca a la Cartera si no la tiene)', () => {
    const q = (secciones) => ({ rol: 'acceso', secciones })
    assert.equal(destinoSinPermiso(q(['referidos']), 'clientes', rutaInicial), '/clientes/referidos')
    assert.equal(destinoSinPermiso(q(['anuncios']), 'clientes', rutaInicial), '/anuncios')
    assert.equal(destinoSinPermiso(q(['ventas']), 'clientes', rutaInicial), '/ventas')
    assert.equal(destinoSinPermiso(q(['edicion', 'ventas']), 'trazabilidad', rutaInicial), rutaInicial(q(['edicion', 'ventas'])))
    assert.equal(rutaClientes(q(['ventas'])), null)
  })
})
