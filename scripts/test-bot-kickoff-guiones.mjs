// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-guiones.mjs
// Disparo de la tanda de guiones desde el kickoff (lib/bot/kickoff/disparo-guiones.ts, 27/10/2026): interruptor, secreto y
// el POST a /api/bot/guiones, con fetch falso (nada sale a la red).
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
const G = await import('../lib/bot/kickoff/disparo-guiones.ts')
const S = await import('../lib/bot/kickoff/servidor.ts')

describe('disparo de la tanda de guiones', () => {
  beforeEach(() => { delete process.env.KICKOFF_GUIONES; delete process.env.CRON_SECRET; delete process.env.DESPACHO_URL })
  test('prendido por defecto; KICKOFF_GUIONES=0 lo apaga (y las dependencias reales no lo traen)', async () => {
    assert.equal(G.guionesEncendido(), true)
    assert.equal(typeof S.depsReales().dispararGuiones, 'function')
    process.env.KICKOFF_GUIONES = '0'
    assert.equal(G.guionesEncendido(), false)
    assert.equal(await G.dispararGuionesReal(1), 'apagado')
    assert.equal(S.depsReales().dispararGuiones, undefined)
  })
  test('sin CRON_SECRET no se dispara (y no llama a la red)', async () => {
    const original = globalThis.fetch
    let llamadas = 0
    globalThis.fetch = async () => { llamadas++; return new Response('', { status: 202 }) }
    try { assert.equal(await G.dispararGuionesReal(1), 'sin_secreto'); assert.equal(llamadas, 0) } finally { globalThis.fetch = original }
  })
  test('POST a /api/bot/guiones del Despacho con Bearer y {recording_id}; 202 → disparado, otra cosa o red caída → error (nunca lanza)', async () => {
    process.env.CRON_SECRET = 'secreto-de-prueba'
    const original = globalThis.fetch
    const pedidos = []
    try {
      globalThis.fetch = async (url, init) => { pedidos.push({ url: String(url), init }); return new Response('{}', { status: 202 }) }
      assert.equal(await G.dispararGuionesReal(196195462), 'disparado')
      assert.equal(pedidos[0].url, 'https://despacho-capital-juridico.vercel.app/api/bot/guiones')
      assert.equal(pedidos[0].init.method, 'POST')
      assert.equal(pedidos[0].init.headers.authorization, 'Bearer secreto-de-prueba')
      assert.deepEqual(JSON.parse(pedidos[0].init.body), { recording_id: 196195462 })
      globalThis.fetch = async () => new Response('{}', { status: 409 })
      assert.equal(await G.dispararGuionesReal(1), 'error')
      globalThis.fetch = async () => { throw new Error('fetch failed https://algo.test/x') }
      assert.equal(await G.dispararGuionesReal(1), 'error')
    } finally { globalThis.fetch = original; delete process.env.CRON_SECRET }
  })
})
