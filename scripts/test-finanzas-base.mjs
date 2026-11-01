// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-finanzas-base.mjs
// Token de la base de Finanzas SKWD (lib/finanzasSkwd/tokenBase.ts): HS256 con el JWT secret, rol authenticated y el correo
// de la sesión del Despacho (lo que miran los permisos RLS de la base). Secreto de PRUEBA, sin red.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const T = await import('../lib/finanzasSkwd/tokenBase.ts')
const SECRETO = 'secreto-de-prueba-de-al-menos-32-caracteres-xx'
const leer = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())

test('firma HS256 verificable, rol authenticated, correo en minúsculas y vence en 1 h', () => {
  const { token, vence } = T.firmarTokenBase('  Tomas@Ejemplo.test ', SECRETO, 1_000_000)
  const [c, b, f] = token.split('.')
  assert.equal(f, createHmac('sha256', SECRETO).update(`${c}.${b}`).digest('base64url'))
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' })
  const p = leer(token)
  assert.equal(p.role, 'authenticated'); assert.equal(p.aud, 'authenticated'); assert.equal(p.email, 'tomas@ejemplo.test')
  assert.equal(p.exp, 1_000_000 + T.DURACION_TOKEN_S); assert.equal(vence, p.exp)
  assert.match(p.sub, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(T.uuidDeCorreo('tomas@ejemplo.test'), p.sub)
})
test('sin secreto (o muy corto) no firma', () => {
  assert.throws(() => T.firmarTokenBase('a@b.test', ''), /SUPABASE_JWT_SECRET/)
  assert.throws(() => T.firmarTokenBase('a@b.test', 'corto'), /SUPABASE_JWT_SECRET/)
})
test('el correo genérico (entrada con la contraseña de Finanzas) no es de nadie', () => {
  assert.match(T.CORREO_SIN_GOOGLE, /@finanzas\.despacho$/)
})
