// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-portal-cliente.mjs
// Portal del cliente (2/11/2026): el rol 'cliente' (PORTAL_CLIENTES_JSON), su única página /clientes/portal/<ID> y lo que ve.
// Sin red: mails, secretos e IDs inventados (Z001/Z002 son ficticios). Prueba el recorrido real de una petición por proxy().
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { proxy } from '../proxy.ts'
import { COOKIE_SESION, DURACION_SESION_S, firmarCookie } from '../lib/auth/cookie.ts'
import { exigirAccesoApi, sesionDePeticion } from '../lib/auth/acceso.ts'
import { sesionDesdeCookie } from '../lib/auth/identidad.ts'
import { buscarUsuario, parsearUsuarios } from '../lib/auth/usuarios.ts'
import { accesoPortal, esRutaDelPortal, idPortalDeMail, idsConMailDePortal, parsearPortalClientes, rutaPortal } from '../lib/auth/portal.ts'
import { MATRIZ_ROLES, puedeVer, rutaInicial, SECCIONES } from '../lib/auth/roles.ts'
import { decidir, resolverRegla } from '../lib/auth/rutas.ts'
import { atenderGuardado } from '../lib/clientes/portal/api.ts'
import { guardarPortal, leerPortal, usarSqlDePrueba } from '../lib/clientes/portal/base.ts'
import { avancePlan, leerDatosGuardados, PORTAL_VACIO, procesoParaCliente, tandasParaCliente, validarDatosPortal } from '../lib/clientes/portal/modelo.ts'

const BASE = 'http://localhost:3101'
const SECRET = randomBytes(48).toString('base64url')
const CRON = `cron-${randomBytes(12).toString('hex')}`
const EQUIPO = [
  { email: 'ana.socia@ejemplo.test', nombre: 'Ana', rol: 'socio' },
  { email: 'cami@ejemplo.test', nombre: 'Cami', rol: 'csm' },
  { email: 'lu@ejemplo.test', nombre: 'Lu', rol: 'closer' },
]
const CLIENTE = 'cliente.uno@ejemplo.test'
const OTRO = 'cliente.dos@ejemplo.test'
// Ana figura también como cliente: el equipo manda
const PORTAL = { [CLIENTE]: 'Z001', [OTRO]: 'z002', 'ana.socia@ejemplo.test': 'Z009' }
const VARIABLES = ['NODE_ENV', 'VERCEL_ENV', 'AUTH_SECRET', 'AUTH_USUARIOS', 'CRON_SECRET', 'CRM_DEV_ROL', 'CRM_DEV_CLIENTE', 'PORTAL_CLIENTES_JSON', 'FINANZAS_PASSWORD', 'SHEET_ID_ACCESOS']
let guardado
beforeEach(() => {
  guardado = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
  for (const v of VARIABLES) delete process.env[v]
  Object.assign(process.env, { AUTH_SECRET: SECRET, AUTH_USUARIOS: JSON.stringify(EQUIPO), CRON_SECRET: CRON, PORTAL_CLIENTES_JSON: JSON.stringify(PORTAL), FINANZAS_PASSWORD: 'fin-prueba' })
})
afterEach(() => {
  for (const v of VARIABLES) {
    if (guardado[v] === undefined) delete process.env[v]
    else process.env[v] = guardado[v]
  }
  usarSqlDePrueba(null)
})

const cookieDe = (email) => `${COOKIE_SESION}=${firmarCookie('sesion', { e: email }, DURACION_SESION_S)}`
async function pedir(ruta, { metodo = 'GET', cookie, cabeceras = {} } = {}) {
  const headers = { host: 'localhost:3101', ...cabeceras }
  if (cookie) headers.cookie = cookie
  const res = await proxy(new NextRequest(new URL(BASE + ruta), { method: metodo, headers }))
  return { pasa: res.headers.get('x-middleware-next') === '1', estado: res.status, location: res.headers.get('location') }
}
const ubicacion = (r) => (r.location ? new URL(r.location, BASE).pathname + new URL(r.location, BASE).search : null)

// ── Variable PORTAL_CLIENTES_JSON ─────────────────────────────────────────────────────────────────────────────────────────
describe('PORTAL_CLIENTES_JSON: mail → ID, falla cerrado', () => {
  const avisos = []
  const avisar = (m) => avisos.push(m)
  test('objeto válido: mails en minúscula, ID en mayúscula', () => {
    const m = parsearPortalClientes(JSON.stringify({ ' Cliente.Uno@Ejemplo.TEST ': 'z001', 'b@ejemplo.test': 'B12' }), avisar)
    assert.deepEqual([...m], [['cliente.uno@ejemplo.test', 'Z001'], ['b@ejemplo.test', 'B12']])
  })
  test('vacío, JSON roto, lista o texto: nadie entra (y el aviso no cita mails)', () => {
    avisos.length = 0
    for (const crudo of [undefined, '', '  ', '{roto', '[]', '"x"', 'null']) assert.equal(parsearPortalClientes(crudo, avisar).size, 0, String(crudo))
    assert.ok(avisos.every((a) => !a.includes('@')))
  })
  test('mail inválido, ID inválido o el mismo mail con dos IDs: esas entradas se descartan', () => {
    avisos.length = 0
    const m = parsearPortalClientes(JSON.stringify({ 'no-es-mail': 'Z001', 'ok@ejemplo.test': 'Z1234567', 'bien@ejemplo.test': 'Z003', 'kKelvin@ejemplo.test': 'Z004' }), avisar)
    assert.deepEqual([...m], [['bien@ejemplo.test', 'Z003']])
    const dup = parsearPortalClientes('{"a@ejemplo.test":"Z001","A@ejemplo.test":"Z002"}', avisar)
    assert.equal(dup.size, 0)
    assert.ok(avisos.every((a) => !a.includes('@')))
  })
  test('idPortalDeMail lee la variable actual; sin variable, nadie', () => {
    assert.equal(idPortalDeMail('CLIENTE.UNO@ejemplo.test'), 'Z001')
    assert.equal(idPortalDeMail(OTRO), 'Z002')
    assert.deepEqual([...idsConMailDePortal()].sort(), ['Z001', 'Z002', 'Z009'])
    delete process.env.PORTAL_CLIENTES_JSON
    assert.equal(idPortalDeMail(CLIENTE), null)
    assert.equal(buscarUsuario(CLIENTE), null)
  })
  test('AUTH_USUARIOS no acepta el rol cliente (solo sale de PORTAL_CLIENTES_JSON)', () => {
    assert.equal(parsearUsuarios(JSON.stringify([{ email: 'x@ejemplo.test', nombre: 'X', rol: 'cliente' }]), () => {}).length, 0)
  })
})

// ── Identidad ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('identidad: el cliente es rol "cliente", sin secciones, atado a UN ID; el equipo manda', () => {
  test('buscarUsuario y la sesión de la cookie', () => {
    const u = buscarUsuario(CLIENTE)
    assert.equal(u.rol, 'cliente')
    assert.equal(u.clienteId, 'Z001')
    assert.deepEqual([...u.secciones], [])
    assert.equal(u.admin, false)
    const s = sesionDesdeCookie(firmarCookie('sesion', { e: CLIENTE }, DURACION_SESION_S))
    assert.equal(s.rol, 'cliente')
    assert.equal(s.clienteId, 'Z001')
    for (const sec of SECCIONES) assert.equal(puedeVer(s, sec), false, sec)
    assert.deepEqual(MATRIZ_ROLES.cliente, [])
  })
  test('un mail del equipo que también figura en el portal sigue siendo equipo', () => {
    const u = buscarUsuario('ana.socia@ejemplo.test')
    assert.equal(u.rol, 'socio')
    assert.equal(u.clienteId, undefined)
    assert.equal(sesionDesdeCookie(firmarCookie('sesion', { e: 'ana.socia@ejemplo.test' }, DURACION_SESION_S)).clienteId, null)
  })
  test('rutaInicial del cliente = su portal (al entrar con Google va directo ahí)', () => {
    assert.equal(rutaInicial(buscarUsuario(CLIENTE)), '/clientes/portal/Z001')
    assert.equal(rutaInicial({ rol: 'cliente', clienteId: null }), '/entrar?error=sin_secciones')
    assert.equal(rutaPortal('z001'), '/clientes/portal/Z001')
  })
  test('sesionDePeticion: el cliente vale "sin sesión" salvo que se pida incluirCliente', () => {
    const h = new Headers({ cookie: cookieDe(CLIENTE), host: 'localhost:3101' })
    assert.equal(sesionDePeticion(h), null)
    assert.equal(sesionDePeticion(h, { incluirCliente: true }).clienteId, 'Z001')
    assert.equal(sesionDePeticion(new Headers({ cookie: cookieDe('cami@ejemplo.test') })).rol, 'csm')
  })
  test('exigirAccesoApi: el cliente da 403 en cualquier sección', () => {
    const req = new Request(`${BASE}/api/x`, { headers: { cookie: cookieDe(CLIENTE) } })
    for (const sec of SECCIONES) assert.equal(exigirAccesoApi(req, sec).status, 403, sec)
  })
})

// ── Proxy: el test de acceso pedido ───────────────────────────────────────────────────────────────────────────────────────
describe('acceso: mail de cliente → solo su portal; otra ruta/API → bloqueado; otro ID → bloqueado; equipo → todo', () => {
  test('el cliente abre su portal (sin importar mayúsculas ni la barra final)', async () => {
    for (const ruta of ['/clientes/portal/Z001', '/clientes/portal/z001', '/clientes/portal/Z001/', '/clientes/portal/Z001?x=1']) {
      assert.equal((await pedir(ruta, { cookie: cookieDe(CLIENTE) })).pasa, true, ruta)
    }
  })
  test('otro ID, una subruta o una ruta ambigua: de vuelta a SU portal', async () => {
    for (const ruta of ['/clientes/portal/Z002', '/clientes/portal/Z009', '/clientes/portal/Z001/editar', '/clientes/portal/Z001%2F..%2FZ002', '/clientes/portal', '/clientes/portal/Z0011']) {
      const r = await pedir(ruta, { cookie: cookieDe(CLIENTE) })
      assert.equal(r.pasa, false, ruta)
      assert.equal(ubicacion(r), '/clientes/portal/Z001', ruta)
    }
    // Y el otro cliente, al revés
    assert.equal((await pedir('/clientes/portal/Z002', { cookie: cookieDe(OTRO) })).pasa, true)
    assert.equal(ubicacion(await pedir('/clientes/portal/Z001', { cookie: cookieDe(OTRO) })), '/clientes/portal/Z002')
  })
  test('cualquier otra página del Despacho: redirigido a su portal', async () => {
    for (const ruta of ['/', '/clientes', '/clientes/Z001', '/clientes/Z001/kickoff', '/clientes/edicion', '/clientes/referidos', '/clientes/altas', '/clientes/entregas', '/guiones', '/guiones/Z001', '/ventas', '/cuotas', '/trazabilidad', '/configuracion', '/sistema', '/ruta-nueva']) {
      const r = await pedir(ruta, { cookie: cookieDe(CLIENTE) })
      assert.equal(r.pasa, false, ruta)
      assert.equal(ubicacion(r), '/clientes/portal/Z001', ruta)
    }
  })
  test('cualquier /api (también la del propio portal y las del marco): 403 en JSON, nunca redirección', async () => {
    for (const [ruta, metodo] of [['/api/clientes/portal/Z001', 'POST'], ['/api/clientes/Z001', 'GET'], ['/api/clientes/Z001/kickoff', 'POST'], ['/api/clientes', 'GET'], ['/api/raw', 'GET'], ['/api/metrics', 'GET'], ['/api/notificaciones', 'GET'], ['/api/presencia', 'POST'], ['/api/preferencias', 'POST'], ['/api/guiones/Z001', 'POST'], ['/api/edicion', 'POST'], ['/api/referidos', 'POST'], ['/api/clientes/altas', 'POST'], ['/api/otra-nueva', 'GET']]) {
      const r = await pedir(ruta, { metodo, cookie: cookieDe(CLIENTE) })
      assert.equal(r.estado, 403, ruta)
      assert.equal(r.location, null, ruta)
    }
  })
  test('Finanzas sigue pidiendo su contraseña (el cliente no es administrador)', async () => {
    assert.equal(ubicacion(await pedir('/finanzas', { cookie: cookieDe(CLIENTE) })), '/finanzas/login')
    assert.equal((await pedir('/api/finanzas', { cookie: cookieDe(CLIENTE) })).estado, 401)
  })
  test('el login y los estáticos siguen abiertos (puede entrar y salir)', async () => {
    for (const ruta of ['/entrar', '/marca/logo-claro.svg']) assert.equal((await pedir(ruta, { cookie: cookieDe(CLIENTE) })).pasa, true, ruta)
  })
  test('equipo con Clientes: ve y edita el portal de cualquier cliente', async () => {
    for (const quien of ['ana.socia@ejemplo.test', 'cami@ejemplo.test']) {
      for (const ruta of ['/clientes/portal/Z001', '/clientes/portal/Z002', '/clientes/portal/A123']) assert.equal((await pedir(ruta, { cookie: cookieDe(quien) })).pasa, true, `${quien} ${ruta}`)
      assert.equal((await pedir('/api/clientes/portal/Z001', { metodo: 'POST', cookie: cookieDe(quien) })).pasa, true, quien)
      // y el resto del Despacho que ya veía, igual
      assert.equal((await pedir('/clientes', { cookie: cookieDe(quien) })).pasa, true, quien)
    }
  })
  test('equipo sin Clientes (closer): no entra al portal ni a su API', async () => {
    assert.equal((await pedir('/clientes/portal/Z001', { cookie: cookieDe('lu@ejemplo.test') })).pasa, false)
    assert.equal((await pedir('/api/clientes/portal/Z001', { metodo: 'POST', cookie: cookieDe('lu@ejemplo.test') })).estado, 403)
  })
  test('sin sesión: al login (página) o 401 (API)', async () => {
    assert.match(ubicacion(await pedir('/clientes/portal/Z001')), /^\/entrar\?next=\/clientes\/portal\/Z001/)
    assert.equal((await pedir('/api/clientes/portal/Z001', { metodo: 'POST' })).estado, 401)
  })
  test('la regla del portal va antes que la Cartera y pide la sección Clientes', () => {
    assert.equal(resolverRegla('/clientes/portal/Z001').regla.patron, '/clientes/portal/*')
    assert.equal(resolverRegla('/api/clientes/portal/Z001').regla.patron, '/api/clientes/portal/*')
    assert.equal(resolverRegla('/clientes/portal/Z001').regla.seccion, 'clientes')
    // Un Bearer de máquina no abre la API del portal
    assert.equal(decidir({ pathname: '/api/clientes/portal/Z001', contexto: () => ({ sesion: null, maquina: true }) }).estado, 401)
  })
  test('esRutaDelPortal: exacta, sin prefijos parecidos', () => {
    assert.equal(esRutaDelPortal('/clientes/portal/z001', 'Z001'), true)
    assert.equal(esRutaDelPortal('/clientes/portal/z0011', 'Z001'), false)
    assert.equal(esRutaDelPortal('/clientes/portal/z001/x', 'Z001'), false)
    assert.equal(esRutaDelPortal('/clientes/portal/z001', null), false)
  })
})

describe('accesoPortal (segunda barrera, en la página)', () => {
  const sinPermiso = '/ventas'
  test('cliente: su ID entra; otro ID, a su portal; sin ID atado, a /entrar', () => {
    assert.deepEqual(accesoPortal({ rol: 'cliente', clienteId: 'Z001' }, 'z001', false, sinPermiso), { tipo: 'cliente', id: 'Z001' })
    assert.deepEqual(accesoPortal({ rol: 'cliente', clienteId: 'Z001' }, 'Z002', false, sinPermiso), { tipo: 'redirigir', destino: '/clientes/portal/Z001' })
    assert.deepEqual(accesoPortal({ rol: 'cliente', clienteId: null }, 'Z001', false, sinPermiso), { tipo: 'redirigir', destino: '/entrar?error=sin_secciones' })
  })
  test('equipo: con Clientes edita; sin Clientes, afuera; ID mal formado, 404', () => {
    assert.deepEqual(accesoPortal({ rol: 'socio' }, 'z002', true, sinPermiso), { tipo: 'equipo', id: 'Z002' })
    assert.deepEqual(accesoPortal({ rol: 'closer' }, 'Z002', false, sinPermiso), { tipo: 'redirigir', destino: sinPermiso })
    for (const id of ['portal', '..', 'Z', 'ZZ001', 'Z1234567']) assert.deepEqual(accesoPortal({ rol: 'socio' }, id, true, sinPermiso), { tipo: 'no_existe' }, id)
  })
})

// ── API de guardado ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('POST /api/clientes/portal/<ID> (atenderGuardado)', () => {
  const DATOS = { nombre: 'Estudio de prueba', objetivo: { texto: 'Llegar a 50 consultas', metrica: '50 consultas/mes', fecha: '2027-03-01' }, etapas: [{ titulo: 'Posicionamiento', detalle: '', estado: 'en_curso', fecha: null }], notas: [], proximos: [] }
  const llamadas = []
  const deps = (extra = {}) => ({
    exigirAcceso: (r) => exigirAccesoApi(r, 'clientes'),
    sesion: (r) => sesionDePeticion(r.headers),
    mismoOrigen: (h) => h.get('origin') === BASE,
    guardar: async (id, datos, version, quien) => { llamadas.push({ id, datos, version, quien }); return { ok: true, version: version + 1, actualizado: '2026-11-02T12:00:00.000Z' } },
    baseConfigurada: () => true,
    ...extra,
  })
  const req = (email, cuerpo, cab = {}) => new Request(`${BASE}/api/clientes/portal/z001`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, host: 'localhost:3101', ...(email ? { cookie: cookieDe(email) } : {}), ...cab }, body: JSON.stringify(cuerpo) })

  test('el cliente NO guarda (ni el suyo): 403', async () => {
    llamadas.length = 0
    assert.equal((await atenderGuardado(req(CLIENTE, { version: 0, datos: DATOS }), 'Z001', deps())).status, 403)
    assert.equal(llamadas.length, 0)
  })
  test('sin sesión 401; closer 403; otro origen 403', async () => {
    assert.equal((await atenderGuardado(req(null, { version: 0, datos: DATOS }), 'Z001', deps())).status, 401)
    assert.equal((await atenderGuardado(req('lu@ejemplo.test', { version: 0, datos: DATOS }), 'Z001', deps())).status, 403)
    assert.equal((await atenderGuardado(req('cami@ejemplo.test', { version: 0, datos: DATOS }, { origin: 'https://otro.test' }), 'Z001', deps())).status, 403)
  })
  test('equipo: guarda con el ID en mayúscula, su nombre (no el mail) y la versión leída', async () => {
    llamadas.length = 0
    const r = await atenderGuardado(req('cami@ejemplo.test', { version: 3, datos: DATOS }), 'z001', deps())
    assert.equal(r.status, 200)
    assert.equal((await r.json()).version, 4)
    assert.deepEqual(llamadas.map((l) => [l.id, l.version, l.quien]), [['Z001', 3, 'Cami']])
  })
  test('datos inválidos 422, sin versión 400, ID inválido 400, conflicto 409', async () => {
    assert.equal((await atenderGuardado(req('cami@ejemplo.test', { version: 0, datos: { ...DATOS, etapas: [{ titulo: '', estado: 'x' }] } }), 'Z001', deps())).status, 422)
    assert.equal((await atenderGuardado(req('cami@ejemplo.test', { datos: DATOS }), 'Z001', deps())).status, 400)
    assert.equal((await atenderGuardado(req('cami@ejemplo.test', { version: 0, datos: DATOS }), '../x', deps())).status, 400)
    const conflicto = deps({ guardar: async () => ({ ok: false, conflicto: true, version: 7 }) })
    assert.equal((await atenderGuardado(req('cami@ejemplo.test', { version: 2, datos: DATOS }), 'Z001', conflicto)).status, 409)
  })
})

// ── Neon (falso) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('cj_portal_cliente: lectura filtrada por ID y versión optimista', () => {
  test('sin tabla: portal vacío, versión 0', async () => {
    process.env.DATABASE_URL = 'postgres://falso'
    usarSqlDePrueba(async () => { const e = new Error('relation "cj_portal_cliente" does not exist'); e.code = '42P01'; throw e })
    assert.deepEqual(await leerPortal('z001'), { datos: PORTAL_VACIO, version: 0, actualizado: null })
    delete process.env.DATABASE_URL
  })
  test('lee SOLO el ID pedido (en mayúscula) y no confía en lo guardado', async () => {
    const consultas = []
    usarSqlDePrueba(async (partes, ...valores) => { consultas.push({ sql: partes.join('?'), valores }); return [{ datos: { nombre: 'x', etapas: 'roto' }, version: 5, actualizado: new Date('2026-11-02T00:00:00Z') }] })
    const r = await leerPortal('z001')
    assert.deepEqual(consultas[0].valores, ['Z001'])
    assert.match(consultas[0].sql, /WHERE id_crm = \?/)
    assert.deepEqual(r.datos, PORTAL_VACIO)
    assert.equal(r.version, 5)
    await assert.rejects(() => leerPortal("Z001' OR 1=1"))
  })
  test('guardar: alta con versión 0 (INSERT … DO NOTHING), cambio con UPDATE … WHERE version; si nadie quedó, conflicto', async () => {
    const consultas = []
    let devolver = [{ version: 1, actualizado: '2026-11-02T00:00:00Z' }]
    usarSqlDePrueba(async (partes, ...valores) => { const sql = partes.join('?'); consultas.push({ sql, valores }); if (/^\s*CREATE/.test(sql)) return []; if (/^\s*SELECT version/.test(sql)) return [{ version: 9 }]; return devolver })
    assert.deepEqual(await guardarPortal('z001', PORTAL_VACIO, 0, 'Cami'), { ok: true, version: 1, actualizado: '2026-11-02T00:00:00Z' })
    assert.ok(consultas.some((c) => /INSERT INTO cj_portal_cliente/.test(c.sql) && /ON CONFLICT \(id_crm\) DO NOTHING/.test(c.sql) && c.valores[0] === 'Z001'))
    devolver = []
    assert.deepEqual(await guardarPortal('Z001', PORTAL_VACIO, 4, 'Cami'), { ok: false, conflicto: true, version: 9 })
    const upd = consultas.find((c) => /UPDATE cj_portal_cliente/.test(c.sql))
    assert.match(upd.sql, /WHERE id_crm = \? AND version = \?/)
    assert.deepEqual(upd.valores.slice(-2), ['Z001', 4])
  })
})

// ── Lo que ve el cliente ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('modelo: validación y lo que ve el cliente (nada interno)', () => {
  test('validarDatosPortal: limpia, aplica topes y rechaza fechas falsas', () => {
    const r = validarDatosPortal({ nombre: '  Estudio  X ', objetivo: { texto: 'a\r\n\r\n\r\nb', metrica: 'm', fecha: '2027-02-28' }, etapas: [{ titulo: 'T', detalle: '', estado: 'hecha' }], notas: [{ titulo: 'Reunión', texto: '' }], proximos: [{ texto: 'Grabar', hecho: true }] })
    assert.equal(r.ok, true)
    assert.equal(r.datos.nombre, 'Estudio X')
    assert.equal(r.datos.objetivo.texto, 'a\n\nb')
    assert.equal(validarDatosPortal({ objetivo: { fecha: '2027-02-30' } }).ok, false)
    assert.equal(validarDatosPortal({ etapas: Array.from({ length: 13 }, () => ({ titulo: 't', estado: 'pendiente' })) }).ok, false)
    assert.equal(validarDatosPortal({ notas: [{ titulo: '', texto: '' }] }).ok, false)
    assert.equal(validarDatosPortal({ nombre: 'x\u0007' }).ok, false)
    assert.equal(validarDatosPortal([]).ok, false)
    assert.deepEqual(leerDatosGuardados('basura'), PORTAL_VACIO)
    assert.deepEqual(avancePlan([{ estado: 'hecha' }, { estado: 'en_curso' }, { estado: 'pendiente' }, { estado: 'hecha' }]), { hechas: 2, total: 4, porcentaje: 50 })
  })
  test('guiones: solo tandas aprobadas o enviadas, sin intención, verificar, hallazgos, revisores ni notas', () => {
    const guion = (n) => ({ guion: { numero: n, titulo: `Guion ${n}`, idea: 'IDEA INTERNA', formato: 'f', tipo_gancho: 'x', utileria: [], secciones: [{ seccion: 'HOOK', velocidad: 3, indicacion: 'a cámara', texto: 'Hola' }, { seccion: 'CTA', velocidad: 3, indicacion: '', texto: 'Escribime' }], ganchos_alternativos: ['Otro'], intencion: 'INTENCION SECRETA', verificar: ['VERIFICAR SECRETO'] }, hallazgos: [{ texto: 'HALLAZGO' }], revision: { notas: 'REVISION' }, estado: 'listo', verificado: { quien: 'Revisor', email: 'rev@ejemplo.test' } })
    const filas = [
      { tanda: 1, estado: 'enviada', creado: '2026-10-01T00:00:00Z', aprobacion: { quien: 'Revisor', email: 'rev@ejemplo.test', cuando: '2026-10-02T10:00:00Z' }, guiones: { 1: guion(1), 2: guion(2) }, notas: [{ texto: 'NOTA' }], tokens_in: 999 },
      { tanda: 2, estado: 'a_revisar', creado: '2026-10-20T00:00:00Z', guiones: { 1: guion(1) } },
      { tanda: 3, estado: 'escribiendo', creado: '2026-10-21T00:00:00Z', guiones: { 1: guion(1) } },
      { tanda: 4, estado: 'cerrada', creado: '2026-10-22T00:00:00Z', guiones: { 1: guion(1) } },
      { tanda: 5, estado: 'aprobada', creado: '2026-10-23T00:00:00Z', guiones: { 1: guion(1) } },
    ]
    const t = tandasParaCliente(filas)
    assert.deepEqual(t.map((x) => x.tanda), [5, 1])
    assert.equal(t[1].fecha, '2026-10-02')
    assert.deepEqual(t[1].guiones[0], { numero: 1, titulo: 'Guion 1', secciones: [{ seccion: 'Gancho', indicacion: 'a cámara', texto: 'Hola' }, { seccion: 'Llamado a la acción', indicacion: '', texto: 'Escribime' }], ganchos: ['Otro'] })
    const json = JSON.stringify(t)
    for (const interno of ['INTENCION', 'VERIFICAR', 'HALLAZGO', 'REVISION', 'IDEA INTERNA', 'rev@', 'Revisor', 'NOTA', '999']) assert.equal(json.includes(interno), false, interno)
  })
  test('proceso: hitos en el idioma del cliente, sin fuentes; éxito y renovación solo si pasaron', () => {
    const h = (clave, hecho, fecha = null) => ({ clave, hecho, fecha, fuente: hecho ? 'clickup' : null, detalle: 'DETALLE INTERNO', manual: hecho ? { quien: 'Interno' } : null })
    const p = procesoParaCliente([h('alta', true, '2026-05-26'), h('kickoff', true), h('guiones', false), h('revision', false), h('grabacion', false), h('edicion', false), h('lanzamiento', false), h('exito', false), h('renovacion', true, '2026-09-11')])
    assert.deepEqual(p.map((x) => x.clave), ['alta', 'kickoff', 'guiones', 'revision', 'grabacion', 'edicion', 'lanzamiento', 'renovacion'])
    assert.equal(p.find((x) => x.actual).clave, 'guiones')
    assert.equal(p[0].titulo, 'Empezamos a trabajar juntos')
    const json = JSON.stringify(p)
    for (const interno of ['DETALLE', 'clickup', 'Interno']) assert.equal(json.includes(interno), false, interno)
  })
})

describe('pestañas de los portales en el hub Clientes (2/11/2026)', () => {
  test('el rol cliente sale del layout antes de leer portales o dibujar pestañas', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../app/(shell)/clientes/layout.tsx', import.meta.url), 'utf8')
    const salidaCliente = src.indexOf("sesion.rol === 'cliente'")
    assert.ok(salidaCliente > 0, 'falta la salida del rol cliente')
    assert.ok(salidaCliente < src.indexOf('pestanasDePortal()'), 'los portales se leen recién después de descartar al cliente')
    assert.ok(salidaCliente < src.indexOf('<PestanasClientes'), 'el cliente no ve pestañas')
    // Las pestañas de portal solo para quien ve la Cartera, y sin nombres ni IDs de clientes en el código
    assert.match(src, /puedeVer\(sesion, 'clientes'\) \? await pestanasDePortal\(\)/)
    assert.doesNotMatch(src, /\b[A-Z]\d{3}\b/)
  })
  test('portalesArmados nunca lanza (sin base o con falla: ninguno)', async () => {
    const base = await import('../lib/clientes/portal/base.ts')
    base.usarSqlDePrueba(async () => { throw new Error('caída') })
    assert.deepEqual(await base.portalesArmados(), [])
    base.usarSqlDePrueba(async () => [{ id_crm: 'x1', titulo: '  Plan  ' }, { id_crm: 'Y2', titulo: null }])
    assert.deepEqual(await base.portalesArmados(), [{ id: 'X1', titulo: 'Plan' }, { id: 'Y2', titulo: '' }])
    base.usarSqlDePrueba(null)
  })
})
