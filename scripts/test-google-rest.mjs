// Token de la cuenta de servicio por scope (lib/auth/googleRest.ts), con un Google simulado en 127.0.0.1.
// Uso: node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs --test scripts/test-google-rest.mjs
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { googleJson, reiniciarTokensGoogle } from '../lib/auth/googleRest.ts'

const SCOPE_A = 'https://www.googleapis.com/auth/spreadsheets'
const SCOPE_B = 'https://www.googleapis.com/auth/drive.readonly'

describe('googleRest: un token por scope', () => {
  let servidor, puerto, pedidosToken, vistos
  before(async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    servidor = createServer((req, res) => {
      let cuerpo = ''
      req.on('data', (c) => { cuerpo += c })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/token') {
          // El scope viaja dentro del JWT firmado: se lee de la carga para devolver un token distinto por scope
          const jwt = new URLSearchParams(cuerpo).get('assertion') ?? ''
          const { scope } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
          pedidosToken.push(scope)
          // Tarda un poco: los pedidos simultáneos llegan mientras el primero sigue en curso
          setTimeout(() => res.end(JSON.stringify({ access_token: `token-${pedidosToken.length}-${scope === SCOPE_A ? 'a' : 'b'}`, expires_in: 3600 })), 30)
          return
        }
        vistos.push(req.headers.authorization)
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
    puerto = servidor.address().port
    Object.assign(process.env, { NODE_ENV: 'test', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'cuenta@ejemplo.test', GOOGLE_PRIVATE_KEY: pem, GOOGLE_TOKEN_URL: `http://127.0.0.1:${puerto}/token` })
    delete process.env.VERCEL_ENV
  })
  after(() => servidor.close())
  beforeEach(() => { pedidosToken = []; vistos = []; reiniciarTokensGoogle() })
  const dato = (scopes) => googleJson(`http://127.0.0.1:${puerto}/dato`, { scopes })

  test('pedidos simultáneos del mismo scope comparten UN pedido de token', async () => {
    await Promise.all([dato(SCOPE_A), dato(SCOPE_A), dato(SCOPE_A)])
    assert.deepEqual(pedidosToken, [SCOPE_A])
    assert.deepEqual(new Set(vistos), new Set(['Bearer token-1-a']))
  })
  test('dos scopes en paralelo no se pisan: un token cada uno, y se reutilizan', async () => {
    await Promise.all([dato(SCOPE_A), dato(SCOPE_B), dato(SCOPE_A), dato(SCOPE_B)])
    assert.deepEqual([...pedidosToken].sort(), [SCOPE_A, SCOPE_B].sort())
    // Alternar entre scopes ya no descarta el token del otro
    await dato(SCOPE_A); await dato(SCOPE_B); await dato(SCOPE_A)
    assert.equal(pedidosToken.length, 2)
    assert.ok(vistos.every((v) => /^Bearer token-\d-[ab]$/.test(v)))
    assert.equal(new Set(vistos).size, 2)
  })
  test('si el pedido de token falla, no queda guardado: el siguiente vuelve a pedirlo', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = ''
    try { await assert.rejects(dato(SCOPE_A), /Falta la cuenta de servicio/) } finally { process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'cuenta@ejemplo.test' }
    await dato(SCOPE_A)
    assert.deepEqual(pedidosToken, [SCOPE_A])
  })
})
