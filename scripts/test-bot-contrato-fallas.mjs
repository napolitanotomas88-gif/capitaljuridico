// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-contrato-fallas.mjs
// Fallas del contrato de PandaDoc del bot "Capital Jurídico" (lib/bot/alta/pandadoc.ts): borrador huérfano después
// del POST, plazo real del polling, 429 (Retry-After grande, tercero seguido, cuerpo sin leer), borrarDocumento y la
// revisión antes de enviar. Sin red: todo con un fetch falso. Datos inventados.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  crearBorradorContrato, borrarDocumento, enviarContrato, revisarParaEnviar,
  ErrorPandaDoc, ErrorBorrador, ContratoIncompleto, RETRY_AFTER_MAX_MS, TOPE_ESTADO_MS,
} from '../lib/bot/alta/pandadoc.ts'

// Candado: cualquier pedido que no use el fetch falso cae acá (y se cuenta)
let pedidosAlFetchGlobal = 0
globalThis.fetch = async () => { pedidosAlFetchGlobal++; throw new Error('red prohibida en tests') }
after(() => assert.equal(pedidosAlFetchGlobal, 0, 'algún test salió por el fetch global'))

const alta = (o = {}) => ({
  etiquetaAlta: true, closer: 'Marcos', programa: 'Agencia', modalidad: 'PIF', totalUsd: 2100, estePagoUsd: 2100,
  medioPago: 'Transferencia USD', pagoEnPesos: null,
  nombre: 'Ana Inventada', telefonos: [{ numero: '5491130002222', etiqueta: '' }], socios: null,
  correo: 'ana.inventada@example.com', direccion: 'Calle 2 456, Rosario', dni: '30222333', cuit: null,
  inicio: '2026-10-24', contrato: 'normal', cuotas: [], faltantes: [], avisos: [],
  ...o,
})

/** fetch falso: cada respuesta es { status, body, headers }, { red: true } (error de red) o { stream } (cuerpo propio).
 *  `alPedir` corre en cada pedido (ej. para adelantar un reloj falso). */
function fetchFalso(respuestas, alPedir = () => {}) {
  const llamadas = []
  const f = async (url, init) => {
    llamadas.push({ url, method: init.method, headers: init.headers })
    alPedir()
    const r = respuestas.shift()
    if (!r) throw new Error('pedido de más: ' + init.method + ' ' + url)
    if (r.red) throw new TypeError('fetch failed')
    const cuerpo = r.stream ?? (r.body === undefined ? null : JSON.stringify(r.body))
    return new Response(cuerpo, { status: r.status ?? 200, headers: r.headers ?? {} })
  }
  return { f, llamadas }
}

const sinEsperar = async () => {}

// ── Borrador huérfano: falla después del POST ───────────────────────────────────────────────────

test('POST 201 y después GET 500: ErrorBorrador con el id, y alCrear lo avisó antes', async () => {
  const { f, llamadas } = fetchFalso([
    { status: 201, body: { id: 'HUERFANO1', status: 'document.uploaded' } },
    { status: 500, body: { detail: 'boom' } },
  ])
  const avisados = []
  await assert.rejects(
    crearBorradorContrato(alta(), { apiKey: 'SECRETA', fetch: f, esperar: sinEsperar, alCrear: id => { avisados.push([id, llamadas.length]) } }),
    e => {
      assert.ok(e instanceof ErrorBorrador)
      assert.equal(e.idDocumento, 'HUERFANO1')
      assert.ok(e.causa instanceof ErrorPandaDoc)
      assert.equal(e.causa.status, 500)
      assert.match(e.message, /HUERFANO1 quedó creado.*GET \/documents\/HUERFANO1: HTTP 500/)
      assert.ok(!e.message.includes('SECRETA'))
      return true
    },
  )
  assert.deepEqual(avisados, [['HUERFANO1', 1]])   // se avisó con el POST hecho y antes de la primera consulta
})

test('POST 201 y después document.error o error de red: ErrorBorrador con el id', async () => {
  const conError = fetchFalso([{ status: 201, body: { id: 'HUERFANO2', status: 'document.uploaded' } }, { body: { status: 'document.error' } }])
  await assert.rejects(crearBorradorContrato(alta(), { apiKey: 'K', fetch: conError.f, esperar: sinEsperar }), e => {
    assert.ok(e instanceof ErrorBorrador)
    assert.equal(e.idDocumento, 'HUERFANO2')
    assert.match(e.message, /document\.error/)
    return true
  })
  const sinRed = fetchFalso([{ status: 201, body: { id: 'HUERFANO3', status: 'document.uploaded' } }, { red: true }])
  await assert.rejects(crearBorradorContrato(alta(), { apiKey: 'K', fetch: sinRed.f, esperar: sinEsperar }), e => {
    assert.ok(e instanceof ErrorBorrador)
    assert.equal(e.idDocumento, 'HUERFANO3')
    assert.ok(e.causa instanceof TypeError)
    return true
  })
})

test('si alCrear falla (ej. no se pudo guardar el id), sale ErrorBorrador con el id', async () => {
  const { f, llamadas } = fetchFalso([{ status: 201, body: { id: 'HUERFANO4', status: 'document.draft' } }])
  await assert.rejects(
    crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, esperar: sinEsperar, alCrear: async () => { throw new Error('Postgres caído') } }),
    e => e instanceof ErrorBorrador && e.idDocumento === 'HUERFANO4' && /Postgres caído/.test(e.message),
  )
  assert.equal(llamadas.length, 1)
})

test('si falla el POST no hay documento: ErrorPandaDoc (no ErrorBorrador) y alCrear no se llama', async () => {
  const { f } = fetchFalso([{ status: 403, body: { detail: 'no access to template' } }])
  let avisado = false
  await assert.rejects(crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, alCrear: () => { avisado = true } }), e => {
    assert.ok(e instanceof ErrorPandaDoc && !(e instanceof ErrorBorrador))
    assert.equal(e.status, 403)
    return true
  })
  assert.equal(avisado, false)
})

// ── 429 ─────────────────────────────────────────────────────────────────────────────────────────

test('Retry-After grande: la espera tiene techo', async () => {
  const { f } = fetchFalso([
    { status: 429, headers: { 'Retry-After': '3600' } },
    { status: 201, body: { id: 'd1', status: 'document.draft' } },
  ])
  const esperas = []
  const r = await crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, esperar: async ms => { esperas.push(ms) } })
  assert.equal(r.estado, 'document.draft')
  assert.deepEqual(esperas, [RETRY_AFTER_MAX_MS])
})

test('tercer 429 seguido en el POST: ErrorPandaDoc 429 sin la clave y sin documento', async () => {
  const { f, llamadas } = fetchFalso([
    { status: 429, headers: { 'Retry-After': '2' } },
    { status: 429 },
    { status: 429, body: { detail: 'Request was throttled' } },
  ])
  const esperas = []
  let avisado = false
  await assert.rejects(
    crearBorradorContrato(alta(), { apiKey: 'SECRETA', fetch: f, esperar: async ms => { esperas.push(ms) }, alCrear: () => { avisado = true } }),
    e => {
      assert.ok(e instanceof ErrorPandaDoc && !(e instanceof ErrorBorrador))
      assert.equal(e.status, 429)
      assert.match(e.message, /POST \/documents: HTTP 429 .*throttled/)
      assert.ok(!e.message.includes('SECRETA'))
      return true
    },
  )
  assert.equal(llamadas.length, 3)
  assert.deepEqual(esperas, [2000, 6000])   // Retry-After de 2 s; sin Retry-After, 6 s
  assert.equal(avisado, false)
})

test('429 en las consultas de estado: nunca pasa el tope y devuelve el estado que tenga', async () => {
  const resps = [{ status: 201, body: { id: 'd2', status: 'document.uploaded' } }]
  for (let i = 0; i < 7; i++) resps.push({ status: 429, headers: { 'Retry-After': '10' } }, { status: 429, headers: { 'Retry-After': '10' } }, { body: { status: 'document.uploaded' } })
  const { f } = fetchFalso(resps)
  const esperas = []
  const r = await crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, esperar: async ms => { esperas.push(ms) } })
  assert.equal(r.id, 'd2')
  assert.equal(r.estado, 'document.uploaded')
  const total = esperas.reduce((a, b) => a + b, 0)
  assert.ok(total <= TOPE_ESTADO_MS, `esperó ${total} ms`)
  // 1 s de pausa + 2 esperas de 10 s por 429; después 1,5 s de pausa y el siguiente 429 ya no entra en el plazo
  assert.deepEqual(esperas, [1000, 10_000, 10_000, 1500])
})

test('el plazo cuenta lo que tarda cada pedido, no solo las pausas', async () => {
  let reloj = 0
  const resps = [{ status: 201, body: { id: 'd3', status: 'document.uploaded' } }]
  for (let i = 0; i < 7; i++) resps.push({ body: { status: 'document.uploaded' } })
  const { f, llamadas } = fetchFalso(resps, () => { reloj += 8000 })   // cada pedido tarda 8 s
  const r = await crearBorradorContrato(alta(), {
    apiKey: 'K', fetch: f, ahora: () => reloj, esperar: async ms => { reloj += ms },
  })
  assert.equal(r.estado, 'document.uploaded')
  // POST (8 s) + 3 consultas: antes de la 4.ª ya van 36,5 s. Sin contar los pedidos habría hecho las 7.
  assert.equal(llamadas.length, 4)
})

test('un 429 que se reintenta cancela el cuerpo sin leer (libera la conexión)', async () => {
  let cancelado = false
  const stream = new ReadableStream({ start() {}, cancel() { cancelado = true } })
  const { f } = fetchFalso([{ status: 429, headers: { 'Retry-After': '1' }, stream }, { status: 201, body: { id: 'd4', status: 'document.draft' } }])
  await crearBorradorContrato(alta(), { apiKey: 'K', fetch: f, esperar: sinEsperar })
  assert.equal(cancelado, true)
})

// ── borrarDocumento ─────────────────────────────────────────────────────────────────────────────

test('borrarDocumento manda DELETE; un 404 sale como ErrorPandaDoc', async () => {
  const ok = fetchFalso([{ status: 204 }])
  assert.equal(await borrarDocumento('doc9', { apiKey: 'K', fetch: ok.f }), undefined)
  assert.equal(ok.llamadas[0].method, 'DELETE')
  assert.equal(ok.llamadas[0].url, 'https://api.pandadoc.com/public/v1/documents/doc9')
  assert.equal(ok.llamadas[0].headers['Content-Type'], undefined)
  const no = fetchFalso([{ status: 404, body: { detail: 'Not found' } }])
  await assert.rejects(borrarDocumento('doc9', { apiKey: 'K', fetch: no.f }), e => e instanceof ErrorPandaDoc && e.status === 404)
})

// ── Revisión antes de enviar ────────────────────────────────────────────────────────────────────

test('revisarParaEnviar: estado draft y sin variables vacías (las Document.* no cuentan)', () => {
  const tokens = [
    { name: 'Client.FirstName', value: 'Ana' }, { name: 'Client.City', value: '' }, { name: 'Client.State', value: null },
    { name: 'DNI', value: '  ' }, { name: 'Document.CreatedDate', value: '' },
  ]
  assert.deepEqual(revisarParaEnviar({ status: 'document.draft', tokens }), { listo: false, estado: 'document.draft', vacios: ['Client.City', 'Client.State', 'DNI'] })
  assert.deepEqual(revisarParaEnviar({ status: 'document.draft', tokens }, ['Client.City', 'Client.State', 'DNI']).listo, true)
  assert.deepEqual(revisarParaEnviar({ status: 'document.uploaded', tokens: [] }), { listo: false, estado: 'document.uploaded', vacios: [] })
  assert.equal(revisarParaEnviar({}).listo, false)
})

test('enviarContrato con variables vacías o fuera de borrador: ContratoIncompleto y NO manda el POST /send', async () => {
  const vacio = fetchFalso([{ body: { id: 'doc6', status: 'document.draft', tokens: [{ name: 'Client.City', value: '' }, { name: 'Client.State' }] } }])
  await assert.rejects(enviarContrato('doc6', 'Hola', { apiKey: 'K', fetch: vacio.f }), e => {
    assert.ok(e instanceof ContratoIncompleto)
    assert.deepEqual(e.vacios, ['Client.City', 'Client.State'])
    assert.match(e.message, /Client\.City, Client\.State/)
    return true
  })
  assert.deepEqual(vacio.llamadas.map(l => `${l.method} ${l.url.split('/v1')[1]}`), ['GET /documents/doc6/details'])

  const enviado = fetchFalso([{ body: { id: 'doc7', status: 'document.sent', tokens: [] } }])
  await assert.rejects(enviarContrato('doc7', 'Hola', { apiKey: 'K', fetch: enviado.f }), e => e instanceof ContratoIncompleto && e.estado === 'document.sent')
  assert.equal(enviado.llamadas.length, 1)
})

test('enviarContrato con permitirVacios manda igual; nunca usa el fetch global', async () => {
  const antes = pedidosAlFetchGlobal
  const { f, llamadas } = fetchFalso([
    { body: { id: 'doc8', status: 'document.draft', tokens: [{ name: 'DNI', value: '' }] } },
    { body: { id: 'doc8', status: 'document.sent' } },
  ])
  const r = await enviarContrato('doc8', 'Hola', { apiKey: 'K', fetch: f, permitirVacios: ['DNI'] })
  assert.equal(r.status, 'document.sent')
  assert.equal(llamadas[1].url, 'https://api.pandadoc.com/public/v1/documents/doc8/send')
  assert.equal(pedidosAlFetchGlobal, antes)
})

test('el candado funciona: sin fetch falso, enviarContrato choca contra la red prohibida', async () => {
  await assert.rejects(enviarContrato('doc9', 'Hola', { apiKey: 'K' }), /red prohibida en tests/)
  pedidosAlFetchGlobal--   // este pedido fue a propósito: no cuenta para el control del final
})
