// Aviso emergente con sonido (lib/aviso/logica.ts, 27/10/2026).
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-aviso.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { debeSonar, nuevas, ultimoId, urlSegura } from '../lib/aviso/logica.ts'

const n = (id, extra = {}) => ({ id, titulo: `n${id}`, cuerpo: '', url: null, urgente: false, hechaEn: null, vista: false, ...extra })

test('nuevas: solo las posteriores a la última conocida, sin hacer y sin ver, en orden', () => {
  const lista = [n(5), n(3), n(7, { hechaEn: '2026-10-27T10:00:00Z' }), n(8, { vista: true }), n(9)]
  assert.deepEqual(nuevas(lista, 4).map((x) => x.id), [5, 9])
  assert.equal(ultimoId(lista, 4), 9)
  assert.equal(ultimoId([], 12), 12)
})

test('suena solo con alguna urgente y fuera del silencio de 23 a 8 (hora argentina)', () => {
  const tarde = new Date('2026-10-27T18:00:00Z') // 15:00 AR
  const noche = new Date('2026-10-28T03:30:00Z') // 00:30 AR
  assert.equal(debeSonar([n(1, { urgente: true })], tarde), true)
  assert.equal(debeSonar([n(1)], tarde), false)
  assert.equal(debeSonar([n(1, { urgente: true })], noche), false)
  assert.equal(debeSonar([n(1, { urgente: true })], new Date('2026-10-27T11:00:00Z')), true) // 8:00 AR
})

test('el link del cartel es siempre interno', () => {
  assert.equal(urlSegura('/clientes?cliente=A101'), '/clientes?cliente=A101')
  assert.equal(urlSegura('//evil.com'), null)
  assert.equal(urlSegura('https://evil.com'), null)
  assert.equal(urlSegura(null), null)
})
