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

test('saca etiqueta e ID de la columna de conjuntos y arma el link (10/11)', () => {
  const p = R.idsDeConjuntos('Broad 120250704284800649 · Intereses 120251062083140649 · Campaña 120249629034410377')
  assert.deepEqual(p.map(x => [x.etiqueta, x.id, x.campana]), [['Broad', '120250704284800649', false], ['Intereses', '120251062083140649', false], ['Campaña', '120249629034410377', true]])
  assert.equal(R.idsDeConjuntos('sin ids').length, 0)
  assert.equal(R.linkAdministrador('123', 'act_99', false), 'https://adsmanager.facebook.com/adsmanager/manage/adsets?act=99&selected_adset_ids=123')
  assert.equal(R.linkAdministrador('123', 'act_99', true), 'https://adsmanager.facebook.com/adsmanager/manage/adsets?act=99&selected_campaign_ids=123')
  assert.equal(R.linkAdministrador('123', null, false), null)
})
