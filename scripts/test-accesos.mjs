// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-accesos.mjs
// Accesos desde Configuración: modelo, permisos por persona y la planilla (contra un Google SIMULADO en un servidor http local).
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { validarEntrada, leerFila, aCeldas, leerFilasNumeradas, ultimaFilaDe, ENCABEZADOS } from '../lib/auth/accesosModelo.ts'
import { MATRIZ_ROLES, SECCIONES, SECCIONES_ASIGNABLES, puedeVer, rutaInicial, rutaSinCRM, RUTA_SIN_SECCIONES } from '../lib/auth/roles.ts'
import { buscarUsuario, fijarAccesosDePlanilla, accesoDePlanilla, listarAccesos } from '../lib/auth/usuarios.ts'
import { decidir } from '../lib/auth/rutas.ts'
import { asegurarUsuarios, guardarAcceso, quitarAcceso, invalidarAccesos, filasDeLaPlanilla } from '../lib/auth/accesos.ts'

describe('validación del formulario', () => {
  test('acceso: exige mail, nombre y al menos una sección; Configuración nunca se asigna', () => {
    assert.equal(validarEntrada({ email: 'x', nombre: 'A', tipo: 'acceso', secciones: ['ventas'] }).ok, false)
    assert.equal(validarEntrada({ email: 'a@b.co', nombre: '', tipo: 'acceso', secciones: ['ventas'] }).ok, false)
    assert.equal(validarEntrada({ email: 'a@b.co', nombre: 'Ana', tipo: 'acceso', secciones: [] }).ok, false)
    assert.equal(validarEntrada({ email: 'a@b.co', nombre: 'Ana', tipo: 'acceso', secciones: ['configuracion'] }).ok, false)
    assert.equal(validarEntrada({ email: 'a@b.co', nombre: 'Ana', tipo: 'otro', secciones: ['ventas'] }).ok, false)
    const v = validarEntrada({ email: ' ANA@B.co ', nombre: '  Ana   Pérez ', tipo: 'acceso', secciones: ['ventas', 'configuracion', 'clientes'], pestanas: ['Closer 1', 'Inventada'] })
    assert.ok(v.ok)
    assert.deepEqual(v.datos, { email: 'ana@b.co', nombre: 'Ana Pérez', tipo: 'acceso', secciones: ['ventas', 'clientes'], pestanas: ['Closer 1'] })
  })
  test('las pestañas solo cuentan si tiene Ventas; admin ignora secciones y pestañas', () => {
    const sinVentas = validarEntrada({ email: 'a@b.co', nombre: 'Ana', tipo: 'acceso', secciones: ['clientes'], pestanas: ['Closer 1'] })
    assert.deepEqual(sinVentas.datos.pestanas, [])
    const admin = validarEntrada({ email: 'a@b.co', nombre: 'Ana', tipo: 'admin', secciones: ['ventas'], pestanas: ['Closer 1'] })
    assert.deepEqual(admin.datos, { email: 'a@b.co', nombre: 'Ana', tipo: 'admin', secciones: [], pestanas: [] })
  })
  test('leerFila: ignora filas rotas y no da acceso por error', () => {
    assert.equal(leerFila(['no-es-mail', 'Ana', 'admin', '', '', 'sí']), null)
    assert.equal(leerFila(['a@b.co', 'Ana', 'superadmin', '', '', 'sí']), null)
    assert.equal(leerFila(['a@b.co', '', 'admin', '', '', 'sí']), null)
    const f = leerFila(['A@B.co', 'Ana', 'ACCESO', 'ventas, clientes, configuracion, xx', 'Closer 2, Nada', 'Sí', 'Tomás', '2026-10-08'])
    assert.deepEqual([f.email, f.tipo, f.secciones, f.pestanas, f.activo], ['a@b.co', 'acceso', ['ventas', 'clientes'], ['Closer 2'], true])
    assert.equal(leerFila(['a@b.co', 'Ana', 'admin', '', '', 'no']).activo, false)
    assert.deepEqual(aCeldas({ ...f }).slice(0, 6), ['a@b.co', 'Ana', 'acceso', 'ventas, clientes', 'Closer 2', 'sí'])
  })
  test('cada fila válida conserva su número real: las vacías o inválidas de arriba no corren la cuenta', () => {
    const filas = leerFilasNumeradas([[], ['bob@b.co', 'Bob', 'admn', '', '', 'sí'], ['ana@b.co', 'Ana', 'admin', '', '', 'sí'], ['luz@b.co', 'Luz', 'acceso', 'guiones', '', 'sí'], ['ana@b.co', 'Ana', 'acceso', 'clientes', '', 'no']])
    assert.deepEqual(filas.map((f) => [f.email, f.fila]), [['ana@b.co', 4], ['luz@b.co', 5], ['ana@b.co', 6]])
    assert.equal(ultimaFilaDe(filas, 'ana@b.co').fila, 6)   // repetido: manda la última
    assert.equal(ultimaFilaDe(filas, 'bob@b.co'), null)      // su fila no sirve: no está
  })
})

describe('permisos por persona', () => {
  test('el rol acceso sin secciones no ve nada (falla cerrado) y rutaInicial lo dice', () => {
    assert.deepEqual(MATRIZ_ROLES.acceso, [])
    for (const s of SECCIONES) assert.equal(puedeVer('acceso', s), false)
    assert.equal(puedeVer({ rol: 'acceso', secciones: ['clientes'] }, 'clientes'), true)
    assert.equal(puedeVer({ rol: 'acceso', secciones: ['clientes'] }, 'ventas'), false)
    assert.equal(rutaInicial({ rol: 'acceso', secciones: [] }), RUTA_SIN_SECCIONES)
    assert.equal(rutaInicial({ rol: 'acceso', secciones: ['referidos', 'clientes'] }), '/clientes') // primera en el orden del menú
  })
  test('tipo admin ve todo; tipo acceso solo lo marcado y nunca Configuración', () => {
    const adm = accesoDePlanilla({ email: 'a@b.co', nombre: 'A', tipo: 'admin', secciones: [], pestanas: [] })
    assert.equal(adm.admin, true); assert.ok(SECCIONES.every((s) => puedeVer(adm, s)))
    const acc = accesoDePlanilla({ email: 'c@d.co', nombre: 'C', tipo: 'acceso', secciones: ['ventas', 'configuracion', 'anuncios'], pestanas: ['Closer 1'] })
    assert.equal(acc.admin, false); assert.deepEqual(acc.secciones, ['ventas', 'anuncios'])
    assert.equal(puedeVer(acc, 'configuracion'), false)
    assert.deepEqual(SECCIONES_ASIGNABLES.includes('configuracion'), false)
  })
  test('el proxy decide por las secciones de la persona', () => {
    const ctx = (sesion) => () => ({ sesion, maquina: false })
    const acc = { rol: 'acceso', secciones: ['clientes'] }
    assert.equal(decidir({ pathname: '/clientes', contexto: ctx(acc) }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/ventas', contexto: ctx(acc) }).accion, 'redirigir')
    assert.equal(decidir({ pathname: '/configuracion', contexto: ctx(acc) }).accion, 'redirigir')
    assert.equal(decidir({ pathname: '/api/raw', contexto: ctx(acc) }).estado, 403)
    assert.equal(decidir({ pathname: '/configuracion', contexto: ctx({ rol: 'socio' }) }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/configuracion', contexto: ctx({ rol: 'csm' }) }).accion, 'redirigir')
  })
  test('la lista fija de Vercel manda sobre la planilla y se listan juntas', () => {
    process.env.AUTH_USUARIOS = JSON.stringify([{ email: 'jefe@ejemplo.test', nombre: 'Jefe', rol: 'socio' }])
    fijarAccesosDePlanilla([accesoDePlanilla({ email: 'jefe@ejemplo.test', nombre: 'Intruso', tipo: 'acceso', secciones: ['clientes'], pestanas: [] }), accesoDePlanilla({ email: 'ana@ejemplo.test', nombre: 'Ana', tipo: 'acceso', secciones: ['clientes'], pestanas: [] })])
    assert.equal(buscarUsuario('jefe@ejemplo.test').origen, 'vercel')
    assert.equal(buscarUsuario('jefe@ejemplo.test').admin, true)
    assert.equal(buscarUsuario('ana@ejemplo.test').origen, 'planilla')
    assert.deepEqual(listarAccesos().map((a) => a.email), ['jefe@ejemplo.test', 'ana@ejemplo.test'])
    fijarAccesosDePlanilla([])
    assert.equal(buscarUsuario('ana@ejemplo.test'), null)
  })
  test('sin sesión del CRM nunca se la manda de vuelta a la misma sección (Cobro de cuotas sin Ventas: aviso, no bucle)', () => {
    const v = validarEntrada({ email: 'c@d.co', nombre: 'C', tipo: 'acceso', secciones: ['cuotas'], pestanas: ['Closer 1'] })
    assert.deepEqual(v.datos.pestanas, [])                  // sin Ventas no guarda pestañas: no hay closer para ella
    const soloCuotas = accesoDePlanilla(v.datos)
    assert.equal(rutaInicial(soloCuotas), '/cuotas')         // por eso redirigir a su sección inicial era un bucle infinito
    assert.equal(rutaSinCRM(soloCuotas, 'cuotas'), null)     // null = no redirigir: se corta (bucle evitado)
    // null solo cuando su sección inicial es /cuotas (Cobro de cuotas va antes que Clientes, Referidos y Finanzas en el menú)
    for (const secciones of [['cuotas'], ['clientes', 'cuotas'], ['cuotas', 'referidos'], ['cuotas', 'finanzas']]) {
      assert.equal(rutaSinCRM({ rol: 'acceso', secciones }, 'cuotas'), null, secciones.join(','))
    }
    // Con una sección antes en el menú se la sigue mandando ahí, como en producción (no a la pantalla de error de /cuotas)
    assert.equal(rutaSinCRM({ rol: 'acceso', secciones: ['guiones', 'cuotas'] }, 'cuotas'), '/guiones')
    assert.equal(rutaSinCRM({ rol: 'acceso', secciones: ['resumen', 'cuotas'] }, 'cuotas'), '/')
    assert.equal(rutaSinCRM({ rol: 'acceso', secciones: ['cuotas', 'guiones'] }, 'cuotas'), '/guiones') // manda el orden del menú
    // Con Ventas va a /ventas, que muestra "sin CRM asignado" y no llama a requerirSesion
    assert.equal(rutaSinCRM({ rol: 'acceso', secciones: ['ventas', 'cuotas'] }, 'cuotas'), '/ventas')
    assert.equal(rutaSinCRM('closer', 'cuotas'), '/ventas')
    assert.equal(rutaSinCRM('setter', 'ventas'), '/ventas')
    // Quien no ve la sección pedida va a su inicial (el proxy ya la frena antes; es la red de seguridad)
    assert.equal(rutaSinCRM('csm', 'cuotas'), '/clientes')
  })
})

// ── La planilla contra un Google simulado ──────────────────────────────────────────────────────────────
describe('planilla de Accesos (Google simulado)', () => {
  let servidor, puerto
  let filas, historial, caidoLeyendo
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  before(async () => {
    servidor = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x')
      let cuerpo = ''
      req.on('data', (c) => (cuerpo += c))
      req.on('end', () => {
        const json = (o, estado = 200) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
        if (url.pathname === '/token') return json({ access_token: 'prueba', expires_in: 3600 })
        const m = /\/values\/(.+?)(:append)?$/.exec(decodeURIComponent(url.pathname))
        if (!m) return json({}, 404)
        const [, rango, esAppend] = m
        const hoja = rango.startsWith('Historial') ? historial : filas
        if (req.method === 'GET') {
          if (caidoLeyendo) return json({ error: 'x' }, 500)
          if (rango.endsWith('A1:H1')) return json({ values: hoja.length ? [hoja[0]] : [] })
          return json({ values: hoja.slice(1) })
        }
        const valores = JSON.parse(cuerpo).values
        if (esAppend) hoja.push(...valores)
        else {
          const f = /!([A-Z])(\d+)/.exec(rango); const fila = Number(f[2])
          if (f[1] === 'F') { hoja[fila - 1][5] = valores[0][0] } else hoja[fila - 1] = valores[0]
          if (rango.endsWith('A1:H1') || rango.endsWith('A1:E1')) hoja[0] = valores[0]
        }
        json({})
      })
    })
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
    puerto = servidor.address().port
  })
  after(() => servidor.close())
  beforeEach(() => {
    filas = []; historial = []; caidoLeyendo = false
    Object.assign(process.env, { NODE_ENV: 'test', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'cuenta@ejemplo.test', GOOGLE_PRIVATE_KEY: pem, SHEET_ID_ACCESOS: 'planilla-prueba', GOOGLE_TOKEN_URL: `http://127.0.0.1:${puerto}/token`, GOOGLE_SHEETS_URL: `http://127.0.0.1:${puerto}`, AUTH_USUARIOS: JSON.stringify([{ email: 'jefe@ejemplo.test', nombre: 'Jefe', rol: 'socio' }]) })
    delete process.env.VERCEL_ENV
    fijarAccesosDePlanilla([]); invalidarAccesos()
  })

  test('alta: guarda la fila, deja historial y la persona entra con sus secciones', async () => {
    const r = await guardarAcceso({ email: 'ana@ejemplo.test', nombre: 'Ana', tipo: 'acceso', secciones: ['ventas', 'clientes'], pestanas: ['Closer 1'] }, 'jefe@ejemplo.test')
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(filas[0][0], 'Email')                       // encabezados creados
    assert.deepEqual(filas[1].slice(0, 6), ['ana@ejemplo.test', 'Ana', 'acceso', 'ventas, clientes', 'Closer 1', 'sí'])
    assert.equal(historial[1][2], 'alta')
    const u = buscarUsuario('ana@ejemplo.test')
    assert.equal(u.rol, 'acceso'); assert.deepEqual(u.secciones, ['clientes', 'ventas'].sort((a, b) => SECCIONES.indexOf(a) - SECCIONES.indexOf(b))); assert.deepEqual(u.pestanas, ['Closer 1'])
  })
  test('cambio: reescribe la misma fila (no duplica); baja: Activo = no y pierde el acceso', async () => {
    await guardarAcceso({ email: 'ana@ejemplo.test', nombre: 'Ana', tipo: 'acceso', secciones: ['clientes'] }, 'jefe@ejemplo.test')
    await guardarAcceso({ email: 'ana@ejemplo.test', nombre: 'Ana P', tipo: 'admin' }, 'jefe@ejemplo.test')
    assert.equal(filas.length, 2); assert.equal(historial[2][2], 'cambio')
    assert.equal(buscarUsuario('ana@ejemplo.test').admin, true)
    const b = await quitarAcceso('ana@ejemplo.test', 'jefe@ejemplo.test')
    assert.equal(b.ok, true); assert.equal(filas[1][5], 'no'); assert.equal(buscarUsuario('ana@ejemplo.test'), null)
    assert.equal(historial.at(-1)[2], 'baja')
  })
  test('protecciones: no se toca a la lista fija, nadie se quita a sí mismo, y los datos inválidos no escriben', async () => {
    assert.equal((await guardarAcceso({ email: 'jefe@ejemplo.test', nombre: 'X', tipo: 'acceso', secciones: ['clientes'] }, 'otro@ejemplo.test')).ok, false)
    assert.equal((await quitarAcceso('jefe@ejemplo.test', 'otro@ejemplo.test')).ok, false)
    await guardarAcceso({ email: 'ana@ejemplo.test', nombre: 'Ana', tipo: 'admin' }, 'jefe@ejemplo.test')
    assert.equal((await quitarAcceso('ana@ejemplo.test', 'ana@ejemplo.test')).ok, false)
    const n = filas.length
    assert.equal((await guardarAcceso({ email: 'mal', nombre: 'Ana', tipo: 'admin' }, 'jefe@ejemplo.test')).ok, false)
    assert.equal((await guardarAcceso({ email: 'b@c.co', nombre: 'B', tipo: 'acceso', secciones: [] }, 'jefe@ejemplo.test')).ok, false)
    assert.equal(filas.length, n)
  })
  test('filas vacías o inválidas arriba: el cambio y la baja escriben en la fila real de la persona, no en la de otro', async () => {
    filas = [[...ENCABEZADOS], [], ['bob@ejemplo.test', 'Bob', 'admn', '', '', 'sí'], ['ana@ejemplo.test', 'Ana', 'acceso', 'clientes', '', 'sí', 'jefe@ejemplo.test', '2026-10-01 10:00']]
    const r = await guardarAcceso({ email: 'ana@ejemplo.test', nombre: 'Ana', tipo: 'acceso', secciones: ['guiones'] }, 'jefe@ejemplo.test')
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.mensaje, 'Cambios guardados.')
    assert.equal(filas.length, 4)                                                   // no agregó otra fila
    assert.deepEqual(filas[1], [])                                                  // la vacía sigue vacía
    assert.deepEqual(filas[2], ['bob@ejemplo.test', 'Bob', 'admn', '', '', 'sí'])   // la ajena, intacta
    assert.deepEqual(filas[3], ['ana@ejemplo.test', 'Ana', 'acceso', 'guiones', '', 'sí', 'jefe@ejemplo.test', '2026-10-01 10:00'])
    assert.deepEqual(buscarUsuario('ana@ejemplo.test').secciones, ['guiones'])     // el cambio rige
    const b = await quitarAcceso('ana@ejemplo.test', 'jefe@ejemplo.test')
    assert.equal(b.ok, true)
    assert.equal(filas[3][5], 'no'); assert.deepEqual(filas[1], []); assert.equal(filas[2][5], 'sí')
    assert.equal(buscarUsuario('ana@ejemplo.test'), null)                          // y la baja también: ya no entra
  })
  test('lectura: asegurarUsuarios carga la planilla, ignora filas rotas y no lanza si Google cae (se queda con lo último)', async () => {
    filas = [['Email', 'Nombre', 'Tipo', 'Secciones', 'Pestañas CRM', 'Activo'], ['luz@ejemplo.test', 'Luz', 'acceso', 'guiones', '', 'sí'], ['roto', 'X', 'admin', '', '', 'sí'], ['off@ejemplo.test', 'Off', 'admin', '', '', 'no']]
    await asegurarUsuarios()
    assert.equal(buscarUsuario('luz@ejemplo.test').nombre, 'Luz')
    assert.equal(buscarUsuario('off@ejemplo.test'), null)
    caidoLeyendo = true; invalidarAccesos()
    await asegurarUsuarios()                                   // no lanza
    assert.equal(buscarUsuario('luz@ejemplo.test').nombre, 'Luz')  // conserva lo último
  })
  test('sin SHEET_ID_ACCESOS no hay planilla: no se llama a Google y la lista fija sigue entrando', async () => {
    delete process.env.SHEET_ID_ACCESOS
    await asegurarUsuarios()
    assert.equal((await guardarAcceso({ email: 'a@b.co', nombre: 'A', tipo: 'admin' }, 'jefe@ejemplo.test')).ok, false)
    assert.deepEqual(await filasDeLaPlanilla(), [])
    assert.equal(buscarUsuario('jefe@ejemplo.test').admin, true)
  })
})

// ── Edición (24/10/2026): René entra con un acceso [edicion], sin Clientes ─────────────────────────────────────────────
describe('Edición: sección asignable desde Configuración', () => {
  test('edicion es asignable y la planilla la guarda y la lee', () => {
    assert.ok(SECCIONES_ASIGNABLES.includes('edicion'))
    const v = validarEntrada({ email: 'rene@ejemplo.test', nombre: 'René', tipo: 'acceso', secciones: ['edicion'] })
    assert.ok(v.ok)
    assert.deepEqual(v.datos.secciones, ['edicion'])
    const f = leerFila(['rene@ejemplo.test', 'René', 'acceso', 'edicion', '', 'sí'])
    assert.deepEqual(f.secciones, ['edicion'])
    assert.deepEqual(aCeldas(f).slice(0, 4), ['rene@ejemplo.test', 'René', 'acceso', 'edicion'])
  })
  test('un acceso con [edicion] entra a /clientes/edicion y a /api/edicion, no ve la Cartera y arranca en /clientes/edicion', () => {
    const rene = accesoDePlanilla({ email: 'rene@ejemplo.test', nombre: 'René', tipo: 'acceso', secciones: ['edicion'], pestanas: [] })
    assert.equal(puedeVer(rene, 'edicion'), true)
    assert.equal(puedeVer(rene, 'clientes'), false)
    assert.equal(rutaInicial(rene), '/clientes/edicion')
    const ctx = () => ({ sesion: rene, maquina: false })
    assert.equal(decidir({ pathname: '/clientes/edicion', contexto: ctx }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/clientes/edicion/video/7', contexto: ctx }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/api/edicion/pedido', contexto: ctx }).accion, 'pasar')
    // La Cartera (cobros) y la ficha no: vuelve a su pestaña, dentro de Clientes
    assert.deepEqual(decidir({ pathname: '/clientes', contexto: ctx }), { accion: 'redirigir', destino: '/clientes/edicion' })
    assert.deepEqual(decidir({ pathname: '/clientes/A101', contexto: ctx }), { accion: 'redirigir', destino: '/clientes/edicion' })
    assert.deepEqual(decidir({ pathname: '/clientes/referidos', contexto: ctx }), { accion: 'redirigir', destino: '/clientes/edicion' })
    assert.equal(decidir({ pathname: '/api/clientes/A101/kickoff', contexto: ctx }).estado, 403)
  })
  test('el socio la ve sola (MATRIZ_ROLES.socio = SECCIONES) y csm, closer y setter no', () => {
    assert.equal(puedeVer('socio', 'edicion'), true)
    for (const rol of ['csm', 'closer', 'setter']) assert.equal(puedeVer(rol, 'edicion'), false, rol)
    assert.ok(MATRIZ_ROLES.socio.includes('edicion'))
  })
})

// ── Clientes como hub (25/10/2026): los permisos guardados en la planilla siguen valiendo tal cual ─────────────────────────
describe('Hub Clientes: las secciones de la planilla no cambian ni suman la Cartera', () => {
  test("'guiones', 'edicion', 'anuncios' y 'referidos' se leen igual que antes y ninguno da 'clientes'", () => {
    for (const s of ['guiones', 'edicion', 'anuncios', 'referidos']) {
      const f = leerFila([`${s}@ejemplo.test`, 'X', 'acceso', s, '', 'sí'])
      assert.deepEqual(f.secciones, [s], s)
      const acc = accesoDePlanilla({ email: `${s}@ejemplo.test`, nombre: 'X', tipo: 'acceso', secciones: [s], pestanas: [] })
      assert.deepEqual(acc.secciones, [s], s)
      assert.equal(puedeVer(acc, 'clientes'), false, s)
      assert.notEqual(decidir({ pathname: '/clientes', contexto: () => ({ sesion: acc, maquina: false }) }).accion, 'pasar', s)
    }
    // Las cuatro juntas tampoco
    const todas = accesoDePlanilla({ email: 'x@ejemplo.test', nombre: 'X', tipo: 'acceso', secciones: ['guiones', 'edicion', 'anuncios', 'referidos'], pestanas: [] })
    assert.equal(puedeVer(todas, 'clientes'), false)
  })
  test('Faus (solo guiones) entra a /guiones y a /guiones/<id>, y no a la Cartera', () => {
    const faus = accesoDePlanilla({ email: 'faus@ejemplo.test', nombre: 'Faus', tipo: 'acceso', secciones: ['guiones'], pestanas: [] })
    const ctx = () => ({ sesion: faus, maquina: false })
    assert.equal(rutaInicial(faus), '/guiones')
    assert.equal(decidir({ pathname: '/guiones', contexto: ctx }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/guiones/A101', contexto: ctx }).accion, 'pasar')
    assert.equal(decidir({ pathname: '/api/guiones/A101', contexto: ctx }).accion, 'pasar')
    assert.deepEqual(decidir({ pathname: '/clientes', contexto: ctx }), { accion: 'redirigir', destino: '/guiones' })
    assert.deepEqual(decidir({ pathname: '/clientes/edicion', contexto: ctx }), { accion: 'redirigir', destino: '/guiones' })
  })
})
