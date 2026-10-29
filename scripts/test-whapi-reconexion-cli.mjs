import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspeccionarReconexion, parsearReconexion } from './whapi-reconexion.mjs'
const TOKEN = 'secreto-de-canal-no-publicable', WEBHOOK = 'secreto-webhook-no-publicable'
const env = { WHAPI_TOKEN: TOKEN, WHAPI_CANAL_ID: 'CANAL-PRUEBA', WHAPI_WEBHOOK_SECRETO: WEBHOOK }
const json = x => Response.json(x)
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
function proveedor(h = { channel_id: env.WHAPI_CANAL_ID, status: { text: 'LAUNCH', code: 2 }, user: null }, imagen = png) {
  const llamadas = []
  return { llamadas, fetch: async (url, init) => {
    const u = new URL(url); llamadas.push({ ruta: u.pathname, metodo: init.method })
    assert.equal(u.origin, 'https://gate.whapi.cloud'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`)
    if (u.pathname === '/health') return json(h)
    if (u.pathname === '/settings') return json({ callback_persist: true, full_history: false, auto_read_messages: false, webhooks: [{ url: 'https://despacho.example.test/api/bot/whapi?secreto=no-mostrar', mode: 'body', events: [], headers: { 'x-cj-bot-secreto': WEBHOOK } }, { url: 'https://hook.make.test/credencial-privada', headers: { Authorization: TOKEN } }] })
    assert.equal(u.pathname, '/users/login/image'); return new Response(imagen, { headers: { 'content-type': 'image/png' } })
  } }
}
test('CLI no sale por defecto ni acepta rutas relativas o modos ambiguos', () => {
  for (const args of [[], ['--qr'], ['--leer', '--qr', '--env=/env', '--privado=/tmp/privado'], ['--leer', '--env=relativo', '--privado=/tmp/privado'], ['--real', '--env=/env', '--privado=/tmp/privado']]) assert.throws(() => parsearReconexion(args))
  assert.deepEqual(parsearReconexion(['--leer', '--env=/ruta/.env.local', '--privado=/tmp/privado']), { modo: 'leer', env: '/ruta/.env.local', privado: '/tmp/privado' })
})
test('diagnóstico sólo GET no pide QR, no dispara guardia ni expone tokens, cabeceras o número', async () => {
  const f = proveedor({ channel_id: env.WHAPI_CANAL_ID, status: { text: 'AUTH', code: 4 }, user: { id: '5491111111111', name: 'Dueño privado' } })
  const out = await inspeccionarReconexion(env, f)
  assert.deepEqual(f.llamadas.map(x => x.ruta), ['/health', '/settings']); assert.equal(out.salud.conectado, true); assert.equal(out.qrGenerado, false); assert.equal(out.envios, 0)
  for (const secreto of [TOKEN, WEBHOOK, '5491111111111', 'Dueño privado', 'credencial-privada', 'no-mostrar']) assert.ok(!JSON.stringify(out).includes(secreto))
  assert.equal(out.ajustes.webhooks[0].secretoCoincide, true)
})
test('QR del canal confirmado se entrega sólo al destino privado, nunca al resultado', async () => {
  const f = proveedor(), guardados = []
  const out = await inspeccionarReconexion(env, { ...f, qr: true, guardarQr: async bytes => guardados.push(bytes) })
  assert.deepEqual(f.llamadas.map(x => x.ruta), ['/health', '/settings', '/users/login/image']); assert.deepEqual(guardados, [png]); assert.equal(out.qrGenerado, true); assert.equal(out.envios, 0); assert.ok(!JSON.stringify(out).includes(png.toString('base64')))
})
test('canal ajeno, suspensión, salud incierta o canal conectado nunca generan QR', async () => {
  for (const h of [{ channel_id: 'OTRO-CANAL', status: { text: 'QR', code: 3 } }, { channel_id: env.WHAPI_CANAL_ID, status: { text: 'BANNED', code: 5 } }, { channel_id: env.WHAPI_CANAL_ID }, { channel_id: env.WHAPI_CANAL_ID, status: { text: 'ERROR', code: 5 } }]) {
    const f = proveedor(h); await assert.rejects(inspeccionarReconexion(env, { ...f, qr: true, guardarQr: async () => assert.fail('No debe guardar') })); assert.equal(f.llamadas.length, 2)
  }
  const f = proveedor({ channel_id: env.WHAPI_CANAL_ID, status: { text: 'AUTH', code: 4 } })
  assert.equal((await inspeccionarReconexion(env, { ...f, qr: true })).qrGenerado, false); assert.equal(f.llamadas.length, 2)
})
test('respuesta HTML/JSON del endpoint QR no se guarda como imagen ni se expone', async () => {
  const f = proveedor(undefined, JSON.stringify({ token: TOKEN }))
  await assert.rejects(inspeccionarReconexion(env, { ...f, qr: true, guardarQr: async () => assert.fail('No debe guardar') }), /no es una imagen PNG/)
})
