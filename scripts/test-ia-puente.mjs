// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-ia-puente.mjs
// Puente de Claude a la Mac (lib/ia/puenteMac.ts, lib/ia/cliente.ts, lib/ia/pedidoCli.ts): una base falsa en memoria y un
// reloj de juguete. Sin red ni Neon.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'

const P = await import('../lib/ia/puenteMac.ts')
const C = await import('../lib/ia/cliente.ts')
const K = await import('../lib/ia/pedidoCli.ts')

/** Base falsa: guarda las filas y deja que el test haga de "Mac" con `alTomar`. */
function baseFalsa(alConsultar = () => {}) {
  const filas = new Map()
  const consultas = []
  return {
    filas, consultas,
    async query(sql, params = []) {
      consultas.push(sql.trim().split(/\s+/).slice(0, 2).join(' '))
      if (/^SELECT id FROM cj_ia_pedidos WHERE huella/.test(sql.trim())) {
        const f = [...filas.values()].filter((x) => x.huella === params[0] && ['pendiente', 'tomado', 'listo'].includes(x.estado)).at(-1)
        return { rows: f ? [{ id: f.id }] : [] }
      }
      if (/^INSERT INTO cj_ia_pedidos/.test(sql.trim())) {
        const [id, origen, modelo, esfuerzo, cuerpo, vence, huella] = params
        filas.set(id, { id, origen, modelo, esfuerzo, cuerpo: JSON.parse(cuerpo), vence, huella, estado: 'pendiente' })
        return { rows: [] }
      }
      if (/^SELECT estado, respuesta, error/.test(sql.trim())) {
        const f = filas.get(params[0])
        alConsultar(f)
        return { rows: f ? [{ estado: f.estado, respuesta: f.respuesta ?? null, error: f.error ?? null }] : [] }
      }
      if (/^UPDATE cj_ia_pedidos SET estado = 'vencido'/.test(sql.trim())) {
        const f = filas.get(params[0]); if (f && f.estado === 'pendiente') f.estado = 'vencido'
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
}
const reloj = () => { let t = 1_000_000; return { ahora: () => t, esperar: async (ms) => { t += ms } } }
const CUERPO = { model: 'claude-haiku-5-5', max_tokens: 100, system: 'Sos un lector.', messages: [{ role: 'user', content: 'hola' }], output_config: { effort: 'low' } }

describe('puenteMac', () => {
  test('deja el pedido y devuelve la respuesta con la forma de la API', async () => {
    const base = baseFalsa((f) => { f.estado = 'listo'; f.respuesta = { texto: '{"ok":true}', modelo: 'claude-haiku-5-5', entrada: 10, salida: 3 } })
    const m = await P.pedirALaMac(CUERPO, { base, origen: 'prueba', ...reloj() })
    assert.equal(m.content[0].type, 'text'); assert.equal(m.content[0].text, '{"ok":true}')
    assert.equal(m.stop_reason, 'end_turn'); assert.deepEqual(m.usage, { input_tokens: 10, output_tokens: 3 })
    const f = [...base.filas.values()][0]
    assert.equal(f.origen, 'prueba'); assert.equal(f.esfuerzo, 'low'); assert.equal(f.modelo, 'claude-haiku-5-5')
  })
  test('sin respuesta a tiempo: error de conexión (pasajero) y el pedido sin tomar se cancela', async () => {
    const base = baseFalsa()
    await assert.rejects(P.pedirALaMac(CUERPO, { base, topeMs: 10_000, ...reloj() }), (e) => e instanceof Anthropic.APIConnectionError && /no respondió/.test(e.message))
    assert.equal([...base.filas.values()][0].estado, 'vencido')
  })
  test('error del trabajador: "no disponible" es pasajero; lo demás, 400 definitivo', async () => {
    const pasajero = baseFalsa((f) => { f.estado = 'error'; f.error = 'Claude no disponible en la Mac (límite del plan, sesión o conexión)' })
    await assert.rejects(P.pedirALaMac(CUERPO, { base: pasajero, ...reloj() }), (e) => e instanceof Anthropic.APIConnectionError)
    const definitivo = baseFalsa((f) => { f.estado = 'error'; f.error = 'la salida no trae el JSON pedido' })
    await assert.rejects(P.pedirALaMac(CUERPO, { base: definitivo, ...reloj() }), (e) => e instanceof Anthropic.APIError && e.status === 400)
  })
  test('huella: el mismo pedido reusa el que está en curso (un reintento no empieza de cero)', async () => {
    const base = baseFalsa()
    await assert.rejects(P.pedirALaMac(CUERPO, { base, origen: 'alta', topeMs: 10_000, ...reloj() }))
    const f = [...base.filas.values()][0]
    f.estado = 'tomado'   // la Mac lo estaba corriendo cuando el módulo cortó
    let vueltas = 0
    const base2 = Object.assign(base, {})
    const q = base2.query.bind(base2)
    base2.query = async (sql, params) => { if (/^SELECT estado/.test(sql.trim()) && ++vueltas === 2) { f.estado = 'listo'; f.respuesta = { texto: 'ya está' } } return q(sql, params) }
    const m = await P.pedirALaMac(CUERPO, { base: base2, origen: 'alta', ...reloj() })
    assert.equal(m.content[0].text, 'ya está'); assert.equal(base.filas.size, 1)
  })
  test('clienteMac: stream(...).finalMessage() y beta.messages.create', async () => {
    const base = baseFalsa((f) => { f.estado = 'listo'; f.respuesta = { texto: 'ok' } })
    const c = P.clienteMac({ base, origen: 'kickoff', ...reloj() })
    assert.equal((await c.beta.messages.stream(CUERPO).finalMessage()).content[0].text, 'ok')
    assert.equal((await c.messages.create(CUERPO)).content[0].text, 'ok')
  })
})

describe('cliente', () => {
  test('CLAUDE_VIA=mac: el cliente es el puente y la clave es la marca; sin eso, el SDK', () => {
    const antes = process.env.CLAUDE_VIA
    try {
      process.env.CLAUDE_VIA = 'mac'
      assert.equal(C.viaMac(), true); assert.equal(C.claveOMac(''), 'via-mac')
      assert.ok(!(C.crearClienteClaude({ origen: 'x' }) instanceof Anthropic))
      delete process.env.CLAUDE_VIA
      assert.equal(C.claveOMac('sk-x'), 'sk-x'); assert.equal(C.claveOMac(''), '')
      assert.ok(C.crearClienteClaude({ apiKey: 'sk-falsa', origen: 'x' }) instanceof Anthropic)
    } finally { if (antes === undefined) delete process.env.CLAUDE_VIA; else process.env.CLAUDE_VIA = antes }
  })
})

describe('pedidoCli', () => {
  test('adjuntos a archivos (Read), esquema, esfuerzo, modelo y búsqueda web', () => {
    const escritos = []
    const p = K.armarPedido({
      model: 'claude-haiku-5-5', system: [{ type: 'text', text: 'Leés comprobantes.' }],
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpg').toString('base64') } }, { type: 'text', text: 'Leé este comprobante.' }] }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    }, '/tmp/x', (ruta, datos) => escritos.push([ruta, datos.toString()]))
    assert.deepEqual(escritos, [['/tmp/x/adjunto-1.jpg', 'jpg']])
    assert.match(p.usuario, /Archivo adjunto: \/tmp\/x\/adjunto-1\.jpg/); assert.match(p.usuario, /Leé este comprobante/)
    assert.equal(p.sistema, 'Leés comprobantes.'); assert.deepEqual(p.schema, { type: 'object' })
    assert.equal(p.esfuerzo, 'low'); assert.equal(p.modelo, 'claude-haiku-5-5')
    assert.deepEqual(p.herramientas, ['Read', 'WebSearch'])
  })
  test('varios turnos van como transcripción; sin adjuntos ni herramientas, ninguna', () => {
    const p = K.armarPedido({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }, '/tmp/y', () => {})
    assert.match(p.usuario, /<turno rol="assistant">\nb\n<\/turno>/); assert.deepEqual(p.herramientas, []); assert.equal(p.schema, null)
  })
})
