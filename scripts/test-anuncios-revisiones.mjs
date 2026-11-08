// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-anuncios-revisiones.mjs
// Panel «A revisar» del tablero (8/11/2026): días que van, días que faltan y orden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
const R = await import('../lib/anuncios/revisiones.ts')

const filas = [
  ['2026-11-08', '2026-11-15', 'Cliente A', 'Test intereses', 'hecho', 'mirar', 'ids', ''],
  ['2026-11-08', '2026-11-12', 'Cliente B', 'Winners', 'hecho', '', '', ''],
  ['2026-11-01', '2026-11-08', 'Cliente C', 'Charlie', '', '', '', 'Revisado'],
  ['fecha mal', '2026-11-12', 'Cliente D', '', '', '', '', ''],
]

test('parsea y descarta filas sin fechas válidas', () => {
  const l = R.parsearRevisiones(filas)
  assert.equal(l.length, 3)
  assert.equal(l[0].fila, 2)
  assert.equal(l[2].estado, 'revisado')
})

test('cuenta días y ordena por lo más urgente; oculta las revisadas', () => {
  const v = R.vistaRevisiones(R.parsearRevisiones(filas), '2026-11-08')
  assert.deepEqual(v.map(x => x.cliente), ['Cliente B', 'Cliente A'])
  assert.deepEqual([v[1].dia, v[1].total, v[1].faltan], [1, 7, 7])
  const luego = R.vistaRevisiones(R.parsearRevisiones(filas), '2026-11-15')
  assert.equal(luego[0].cliente, 'Cliente B')
  assert.equal(luego[0].vencida, true)
  assert.equal(luego[1].hoyToca, true)
  assert.equal(luego[1].dia, 8)
})
