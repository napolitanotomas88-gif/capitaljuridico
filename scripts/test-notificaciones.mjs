// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-notificaciones.mjs
// Notificaciones del Despacho (lib/notificaciones/modelo.ts): quién ve qué, validación, links internos y orden. Puro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
const M = await import('../lib/notificaciones/modelo.ts')

test('quién la ve: por mail, por sección o todos', () => {
  assert.equal(M.laVe({ paraEmail: 'Tomi@x.com', paraSeccion: null }, 'tomi@x.com', []), true)
  assert.equal(M.laVe({ paraEmail: 'otro@x.com', paraSeccion: 'clientes' }, 'tomi@x.com', ['clientes']), false, 'con mail manda el mail')
  assert.equal(M.laVe({ paraEmail: null, paraSeccion: 'guiones' }, 'a@x.com', ['clientes']), false)
  assert.equal(M.laVe({ paraEmail: null, paraSeccion: 'guiones' }, 'a@x.com', ['guiones']), true)
  assert.equal(M.laVe({ paraEmail: null, paraSeccion: null }, 'a@x.com', []), true)
  assert.deepEqual(M.seccionesDe('csm'), ['clientes', 'referidos'])
})

test('validación y links internos', () => {
  assert.equal(typeof M.limpiarNueva({ tipo: '', titulo: 'x', origen: 'o' }), 'string')
  assert.equal(typeof M.limpiarNueva({ tipo: 't', titulo: 'x', origen: 'o', paraEmail: 'no-es-mail' }), 'string')
  assert.equal(typeof M.limpiarNueva({ tipo: 't', titulo: 'x', origen: 'o', paraSeccion: 'inventada' }), 'string')
  const ok = M.limpiarNueva({ tipo: 't', titulo: '  Hola   mundo ', origen: 'o', url: '/clientes?cliente=A1', urgente: true, paraEmail: 'A@B.com' })
  assert.equal(ok.titulo, 'Hola mundo'); assert.equal(ok.url, '/clientes?cliente=A1'); assert.equal(ok.urgente, true); assert.equal(ok.paraEmail, 'a@b.com')
  for (const malo of ['https://evil.com', '//evil.com', '/\\evil', 'javascript:alert(1)', '/a b']) assert.equal(M.urlInterna(malo), null, malo)
})

test('menú rápido: urgentes primero, después las que más esperan; "hace cuánto"', () => {
  const n = (id, urgente, creadaEn) => ({ id, urgente, creadaEn })
  assert.deepEqual([n(1, false, '2026-10-20'), n(2, true, '2026-10-25'), n(3, false, '2026-10-10'), n(4, true, '2026-10-22')].sort(M.ordenPendientes).map(x => x.id), [4, 2, 3, 1])
  const ahora = Date.parse('2026-10-27T12:00:00Z')
  assert.equal(M.haceCuanto('2026-10-27T11:30:00Z', ahora), 'hace 30 min')
  assert.equal(M.haceCuanto('2026-10-27T09:00:00Z', ahora), 'hace 3 h')
  assert.equal(M.haceCuanto('2026-10-24T12:00:00Z', ahora), 'hace 3 días')
})
