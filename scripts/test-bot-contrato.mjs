// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-contrato.mjs
// Contrato de PandaDoc del bot "Capital Jurídico" (lib/bot/alta/pandadoc.ts): armado del cuerpo del POST /documents
// y flujo de crear → esperar "document.draft" con un fetch falso. Sin red. Datos inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cuerpoBorrador, nombreDocumento, linkEdicion, verificarTokens, crearBorradorContrato, enviarContrato, ErrorPandaDoc,
} from '../lib/bot/alta/pandadoc.ts'
import { PLANTILLAS_CONTRATO } from '../lib/bot/alta/contrato.ts'

// Candado: un test que se olvide de pasar `fetch` no puede salir a api.pandadoc.com
globalThis.fetch = async () => { throw new Error('red prohibida en tests') }

const alta = (o = {}) => ({
  etiquetaAlta: true, closer: 'Marcos', programa: 'Agencia', modalidad: 'PP', totalUsd: 3300, estePagoUsd: 1100,
  medioPago: 'Transferencia USD', pagoEnPesos: null,
  nombre: 'Juan Manuel Pérez', telefonos: [{ numero: '5491130001111', etiqueta: '' }], socios: null,
  correo: 'juan.perez@example.com', direccion: 'Calle 1 123, Mar del Plata', dni: '30111222', cuit: '20-30111222-3',
  inicio: '2026-10-19', contrato: 'normal', cuotas: [], faltantes: [], avisos: [],
  ...o,
})

test('cuerpo completo con la plantilla normal', () => {
  const { cuerpo, faltantes } = cuerpoBorrador(alta())
  assert.deepEqual(cuerpo, {
    name: 'Contrato - Juan Manuel Pérez - C.J',
    template_uuid: PLANTILLAS_CONTRATO.normal,
    recipients: [{ email: 'juan.perez@example.com', first_name: 'Juan Manuel', last_name: 'Pérez', role: 'Client' }],
    tokens: [
      { name: 'Client.FirstName', value: 'Juan Manuel' },
      { name: 'Client.LastName', value: 'Pérez' },
      { name: 'Client.Email', value: 'juan.perez@example.com' },
      { name: 'Client.StreetAddress', value: 'Calle 1 123' },
      { name: 'Client.City', value: 'Mar del Plata' },
      { name: 'Client.State', value: 'Buenos Aires' },
      { name: 'Client.Country', value: 'Argentina' },
      { name: 'DNI', value: '30111222' },
      { name: 'Fecha de Inicio', value: '19/10/2026' },
      { name: 'TU DIRECCIÓN EN ARGENTINA', value: 'Calle Ficticia 123, Ciudad Ejemplo, Provincia Ejemplo' },
    ],
  })
  assert.deepEqual(faltantes, [])
  // El contrato no lleva monto, CUIT ni cuotas
  assert.ok(!JSON.stringify(cuerpo).includes('3300'))
  assert.ok(!JSON.stringify(cuerpo).includes('20-30111222-3'))
})

test('contrato con garantía usa la otra plantilla; la plantilla explícita manda', () => {
  assert.equal(cuerpoBorrador(alta({ contrato: 'garantia' })).cuerpo.template_uuid, PLANTILLAS_CONTRATO.garantia)
  assert.equal(cuerpoBorrador(alta({ contrato: 'garantia' }), { plantilla: 'otra' }).cuerpo.template_uuid, 'otra')
})

test('ciudad, provincia y país extra mandan sobre las reglas; los vacíos no se mandan', () => {
  const { cuerpo } = cuerpoBorrador(alta({ direccion: 'Calle 1 123, Batán' }), { extra: { ciudad: 'Batán', provincia: 'Buenos Aires' } })
  const t = Object.fromEntries(cuerpo.tokens.map(x => [x.name, x.value]))
  assert.equal(t['Client.StreetAddress'], 'Calle 1 123')
  assert.equal(t['Client.City'], 'Batán')
  assert.equal(t['Client.State'], 'Buenos Aires')
  assert.equal(t['Client.Country'], 'Argentina')
  assert.ok(cuerpo.tokens.every(x => x.value.trim() !== ''))
  // Un campo de extra en '' manda (= no se sabe): no se rellena con las reglas
  const vacio = cuerpoBorrador(alta(), { extra: { ciudad: '', provincia: '' } })
  assert.ok(!vacio.cuerpo.tokens.some(x => x.name === 'Client.City' || x.name === 'Client.State'))
  assert.ok(vacio.faltantes.includes('Ciudad y provincia del cliente'))
  // Sin ciudad en la dirección, City y State no viajan y se le piden al closer
  const sin = cuerpoBorrador(alta({ direccion: 'Calle 1 123' }))
  assert.ok(!sin.cuerpo.tokens.some(x => x.name === 'Client.City' || x.name === 'Client.State'))
  assert.equal(sin.cuerpo.tokens.find(x => x.name === 'Client.StreetAddress').value, 'Calle 1 123')
  assert.deepEqual(sin.faltantes, ['Ciudad y provincia del cliente'])
})

test('cliente del exterior sin DNI: no se pide DNI; el país sale de la dirección', () => {
  const { cuerpo, faltantes } = cuerpoBorrador(alta({ telefonos: [{ numero: '34600111222', etiqueta: '' }], dni: null, direccion: 'Calle Mayor 10, 28013 Madrid, España' }))
  const t = Object.fromEntries(cuerpo.tokens.map(x => [x.name, x.value]))
  assert.ok(!('DNI' in t))
  assert.deepEqual([t['Client.StreetAddress'], t['Client.City'], t['Client.State'], t['Client.Country']], ['Calle Mayor 10', 'Madrid', 'Comunidad de Madrid', 'España'])
  assert.deepEqual(faltantes, [])
  // Sin dirección y con teléfono de afuera no se inventa país
  const sinDir = cuerpoBorrador(alta({ telefonos: [{ numero: '447700900123', etiqueta: '' }], dni: null, direccion: null }))
  assert.ok(!sinDir.cuerpo.tokens.some(x => x.name === 'Client.Country'))
})

test('faltan dirección e inicio: se crea igual y se informan los faltantes', () => {
  const { cuerpo, faltantes } = cuerpoBorrador(alta({ direccion: null, inicio: null }))
  assert.deepEqual(faltantes, ['Dirección', 'Inicio del servicio'])
  const nombres = cuerpo.tokens.map(x => x.name)
  assert.ok(!nombres.includes('Client.StreetAddress') && !nombres.includes('Fecha de Inicio'))
})

test('un solo nombre: el apellido queda en faltantes y last_name vacío', () => {
  const { cuerpo, faltantes } = cuerpoBorrador(alta({ nombre: 'Juan' }))
  assert.equal(cuerpo.name, 'Contrato - Juan - C.J')
  assert.equal(cuerpo.recipients[0].last_name, '')
  assert.deepEqual(faltantes, ['Apellido'])
})

test('el nombre va limpio como en Drive: sin "Dr./Dra.", con mayúscula inicial y "Ma." → "María"', () => {
  const casos = [
    // [nombre del #ALTA, FirstName, LastName, documento]
    ['DRA. MARIA LAURA PEREZ', 'Maria Laura', 'Perez', 'Contrato - Maria Laura Perez - C.J'],
    ['Dr. Juan Pérez', 'Juan', 'Pérez', 'Contrato - Juan Pérez - C.J'],
    ['ma. laura ruiz', 'María Laura', 'Ruiz', 'Contrato - María Laura Ruiz - C.J'],
    ['Dra.Lucía Benítez', 'Lucía', 'Benítez', 'Contrato - Lucía Benítez - C.J'],
    ['Escribana Laura Gómez', 'Laura', 'Gómez', 'Contrato - Laura Gómez - C.J'],
    ['JUAN PABLO DE LA VEGA', 'Juan Pablo', 'de la Vega', 'Contrato - Juan Pablo de la Vega - C.J'],
    ['Juan del Valle', 'Juan', 'del Valle', 'Contrato - Juan del Valle - C.J'],
    ['  Ana   María  Gómez ', 'Ana María', 'Gómez', 'Contrato - Ana María Gómez - C.J'],
  ]
  for (const [n, nombre, apellido, doc] of casos) {
    const { cuerpo, faltantes } = cuerpoBorrador(alta({ nombre: n }))
    const t = Object.fromEntries(cuerpo.tokens.map(x => [x.name, x.value]))
    assert.deepEqual([t['Client.FirstName'], t['Client.LastName'], cuerpo.recipients[0].first_name, cuerpo.recipients[0].last_name], [nombre, apellido, nombre, apellido], n)
    assert.equal(cuerpo.name, doc, n)
    assert.equal(nombreDocumento(n), doc, n)
    assert.deepEqual(faltantes, [], n)
  }
  // Solo un título: no hay nombre
  assert.throws(() => cuerpoBorrador(alta({ nombre: 'Dra.' })), /nombre completo/)
  // "Dra. Lucía" sin apellido: falta el apellido (el título no cuenta como nombre)
  assert.deepEqual(cuerpoBorrador(alta({ nombre: 'Dra. Lucía' })).faltantes, ['Apellido'])
})

test('sin nombre o sin correo no se puede armar', () => {
  assert.throws(() => cuerpoBorrador(alta({ nombre: null })), /nombre completo/)
  assert.throws(() => cuerpoBorrador(alta({ correo: null })), /correo de Juan Manuel Pérez/)
  assert.throws(() => cuerpoBorrador(alta({ correo: '  ' })), /correo/)
})

test('metadata opcional; nombre y link', () => {
  assert.equal(cuerpoBorrador(alta()).cuerpo.metadata, undefined)
  assert.equal(cuerpoBorrador(alta(), { metadata: {} }).cuerpo.metadata, undefined)
  assert.deepEqual(cuerpoBorrador(alta(), { metadata: { alta_id: '7' } }).cuerpo.metadata, { alta_id: '7' })
  assert.equal(nombreDocumento('  Ana   María  Gómez '), 'Contrato - Ana María Gómez - C.J')
  assert.equal(linkEdicion('abc123'), 'https://app.pandadoc.com/a/#/documents/abc123')
})

test('verificarTokens detecta distintos y ausentes', () => {
  const enviados = [{ name: 'DNI', value: '1' }, { name: 'A', value: 'x' }, { name: 'B', value: 'y' }]
  assert.deepEqual(verificarTokens(enviados, [{ name: 'DNI', value: '1' }, { name: 'A', value: 'x' }, { name: 'B', value: 'y' }]), { ok: true, distintos: [] })
  const r = verificarTokens(enviados, [{ name: 'DNI', value: '2' }, { name: 'A', value: 'x' }])
  assert.equal(r.ok, false)
  assert.deepEqual(r.distintos, [{ name: 'DNI', esperado: '1', recibido: '2' }, { name: 'B', esperado: 'y', recibido: null }])
})

// ── Flujo con fetch falso ────────────────────────────────────────────────────────────────────────

function fetchFalso(respuestas) {
  const llamadas = []
  const f = async (url, init) => {
    llamadas.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
    const r = respuestas.shift()
    if (!r) throw new Error('pedido de más: ' + init.method + ' ' + url)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} })
  }
  return { f, llamadas }
}

test('crea el borrador y espera a document.draft', async () => {
  const { f, llamadas } = fetchFalso([
    { status: 201, body: { id: 'doc1', status: 'document.uploaded' } },
    { body: { id: 'doc1', status: 'document.uploaded' } },
    { body: { id: 'doc1', status: 'document.draft' } },
  ])
  const esperas = []
  const r = await crearBorradorContrato(alta(), { apiKey: 'CLAVE', fetch: f, esperar: async ms => { esperas.push(ms) } })
  assert.deepEqual(r, {
    id: 'doc1', estado: 'document.draft', link: 'https://app.pandadoc.com/a/#/documents/doc1',
    nombre: 'Contrato - Juan Manuel Pérez - C.J', plantilla: PLANTILLAS_CONTRATO.normal, faltantes: [],
    clave: 'opciones.apiKey',
    direccion: {
      calle: 'Calle 1 123', ciudad: 'Mar del Plata', provincia: 'Buenos Aires', pais: 'Argentina', confianza: 'alta',
      fuente: 'reglas', avisos: [], faltantes: [],
    },
  })
  assert.equal(llamadas[0].url, 'https://api.pandadoc.com/public/v1/documents')
  assert.equal(llamadas[0].method, 'POST')
  assert.equal(llamadas[0].headers.Authorization, 'API-Key CLAVE')
  assert.equal(llamadas[0].headers['Content-Type'], 'application/json')
  assert.deepEqual(llamadas[0].body, cuerpoBorrador(alta()).cuerpo)
  assert.deepEqual(llamadas.slice(1).map(l => `${l.method} ${l.url}`), [
    'GET https://api.pandadoc.com/public/v1/documents/doc1', 'GET https://api.pandadoc.com/public/v1/documents/doc1',
  ])
  assert.equal(llamadas[1].body, undefined)
  assert.deepEqual(esperas, [1000, 1500])
})

test('con el tope alcanzado devuelve el estado que tenga, sin tirar error', async () => {
  const { f, llamadas } = fetchFalso([
    { status: 201, body: { id: 'doc2', status: 'document.uploaded' } },
    { body: { status: 'document.uploaded' } },
    { body: { status: 'document.uploaded' } },
  ])
  const r = await crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, esperar: async () => {}, pausasMs: [100, 100, 100], topeMs: 250 })
  assert.equal(r.estado, 'document.uploaded')
  assert.equal(llamadas.length, 3)   // POST + 2 consultas (la tercera pasaría el tope)
})

test('429 se reintenta respetando Retry-After; otros errores no exponen la clave', async () => {
  const { f, llamadas } = fetchFalso([
    { status: 429, body: { detail: 'Request was throttled' }, headers: { 'Retry-After': '3' } },
    { status: 201, body: { id: 'doc3', status: 'document.draft' } },
  ])
  const esperas = []
  const r = await crearBorradorContrato(alta(), { apiKey: 'SECRETA', fetch: f, esperar: async ms => { esperas.push(ms) } })
  assert.equal(r.estado, 'document.draft')
  assert.equal(llamadas.length, 2)
  assert.deepEqual(esperas, [3000])

  const mal = fetchFalso([{ status: 403, body: { type: 'authorization_error', detail: 'no access to template' } }])
  await assert.rejects(crearBorradorContrato(alta(), { apiKey: 'SECRETA', fetch: mal.f }), e => {
    assert.ok(e instanceof ErrorPandaDoc)
    assert.equal(e.status, 403)
    assert.match(e.message, /POST \/documents: HTTP 403 .*no access to template/)
    assert.ok(!e.message.includes('SECRETA'))
    return true
  })
})

test('document.error tira error; sin clave no sale ningún pedido', async () => {
  const { f } = fetchFalso([{ status: 201, body: { id: 'doc4', status: 'document.uploaded' } }, { body: { status: 'document.error' } }])
  await assert.rejects(crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, esperar: async () => {} }), /document\.error/)
  const vacio = fetchFalso([])
  const antes = { p: process.env.PANDADOC_API_KEY, s: process.env.PANDADOC_API_KEY_SANDBOX }
  delete process.env.PANDADOC_API_KEY
  delete process.env.PANDADOC_API_KEY_SANDBOX
  try {
    await assert.rejects(crearBorradorContrato(alta(), { fetch: vacio.f }), /falta la API key \(PANDADOC_API_KEY o PANDADOC_API_KEY_SANDBOX\)/)
    assert.equal(vacio.llamadas.length, 0)
  } finally {
    if (antes.p !== undefined) process.env.PANDADOC_API_KEY = antes.p
    if (antes.s !== undefined) process.env.PANDADOC_API_KEY_SANDBOX = antes.s
  }
})

test('enviarContrato revisa el borrador y arma el POST /send (sin llamar a la red real)', async () => {
  const { f, llamadas } = fetchFalso([
    { body: { id: 'doc5', status: 'document.draft', tokens: [{ name: 'Client.City', value: 'Mar del Plata' }, { name: 'Document.CreatedDate', value: '' }] } },
    { body: { id: 'doc5', status: 'document.sent' } },
  ])
  await enviarContrato('doc5', 'Hola Juan, te mando el contrato.', { apiKey: 'K', fetch: f, asunto: 'Contrato C.J' })
  assert.equal(llamadas[0].url, 'https://api.pandadoc.com/public/v1/documents/doc5/details')
  assert.equal(llamadas[0].method, 'GET')
  assert.equal(llamadas[1].url, 'https://api.pandadoc.com/public/v1/documents/doc5/send')
  assert.equal(llamadas[1].method, 'POST')
  assert.deepEqual(llamadas[1].body, { message: 'Hola Juan, te mando el contrato.', silent: false, subject: 'Contrato C.J' })
})
