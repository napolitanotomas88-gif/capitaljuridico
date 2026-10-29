// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-auth.mjs
// Control de host de la sesión de prueba de desarrollo (lib/auth/hostLocal.ts). Lógica pura, sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { esHostLocal, peticionLocal } from '../lib/auth/hostLocal.ts'

const cab = (o = {}) => ({ get: n => (n in o ? o[n] : null) })

describe('esHostLocal', () => {
  test('acepta localhost, 127.0.0.1, [::1] y *.localhost, con o sin puerto', () => {
    for (const h of ['localhost', 'localhost:3101', 'LOCALHOST:3101', '127.0.0.1', '127.0.0.1:3101', '[::1]', '[::1]:3101', 'crm.localhost:3101']) {
      assert.equal(esHostLocal(h), true, h)
    }
  })
  test('rechaza IPs de la red, dominios y trucos de prefijo', () => {
    for (const h of ['192.168.0.15:3101', '10.0.0.4', 'localhost.evil.com', 'evil.com:80@localhost', 'miequipo.local:3101', '0.0.0.0:3101', '127.0.0.1.evil.com', 'xlocalhost', '']) {
      assert.equal(esHostLocal(h), false, h)
    }
  })
  test('sin header (null o undefined) falla cerrado', () => {
    assert.equal(esHostLocal(null), false)
    assert.equal(esHostLocal(undefined), false)
  })
})

describe('peticionLocal', () => {
  test('Host local sin proxy: pasa', () => {
    assert.equal(peticionLocal(cab({ host: 'localhost:3101' })), true)
  })
  test('Host de la red: no pasa', () => {
    assert.equal(peticionLocal(cab({ host: '192.168.0.15:3101' })), false)
    assert.equal(peticionLocal(cab({})), false)
  })
  test('túnel que reenvía un host público aunque el Host sea local: no pasa', () => {
    assert.equal(peticionLocal(cab({ host: 'localhost:3101', 'x-forwarded-host': 'abc.ngrok.app' })), false)
    assert.equal(peticionLocal(cab({ host: 'localhost:3101', 'x-forwarded-host': 'localhost:3101, abc.ngrok.app' })), false)   // en una lista tienen que ser todos locales
    assert.equal(peticionLocal(cab({ host: 'localhost:3101', 'x-forwarded-host': 'localhost:3101' })), true)
    assert.equal(peticionLocal(cab({ host: 'localhost:3101', 'x-forwarded-host': '' })), false)
  })
})
