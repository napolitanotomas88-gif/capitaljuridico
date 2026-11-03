// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-guiones-aviso-revision.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
const R = await import('../lib/bot/guiones/avisoRevision.ts')

// 3/11/2026 15:00 Argentina = 18:00 UTC
const AHORA = new Date('2026-11-03T18:00:00Z')
const hace = h => new Date(AHORA.getTime() - h * 3_600_000).toISOString()
const fila = (id, extra = {}) => ({ id, tanda: 1, id_crm: `A${id}`, cliente: `Cliente ${id}`, estado: 'a_revisar', actualizado: hace(1), guiones: { 1: {}, 2: {}, 3: {} }, ...extra })

test('aviso: menciona a Faus, Tomi y Gero M, con cliente, tanda y link', () => {
  const a = R.alertaRevision(fila(7, { cliente: 'Cliente Prueba', id_crm: 'A169' }), 'revisar')
  assert.equal(a.canal, 'guiones')
  assert.deepEqual([...a.menciones].sort(), ['faus', 'gero_m', 'tomas'])
  assert.match(a.titulo, /tanda 1/)
  assert.equal(a.cliente, 'Cliente Prueba')
  assert.equal(a.link, '/guiones/A169')
  assert.equal(a.clave, `guiones:7:revisar:${hace(1)}`)
  const c = R.alertaRevision(fila(7), 'corregida')
  assert.equal(c.tipo, 'guiones_correcciones')
  assert.deepEqual([...c.menciones].sort(), ['faus', 'gero_m', 'tomas'])
})

test('etapa: nada antes de 24 h, rec24 entre 24 y 48, rec48 desde 48 (sin repetir la de 24)', () => {
  assert.equal(R.etapaQueToca(hace(23.9), AHORA), null)
  assert.equal(R.etapaQueToca(hace(24), AHORA), 'rec24')
  assert.equal(R.etapaQueToca(hace(47), AHORA), 'rec24')
  assert.equal(R.etapaQueToca(hace(48), AHORA), 'rec48')
  assert.equal(R.etapaQueToca(hace(200), AHORA), 'rec48')
  assert.equal(R.etapaQueToca('cualquiera', AHORA), null)
})

test('recordatorios: 24 h → Faus y Gero M; 48 h → también Tomás; clave por ronda y etapa', () => {
  const r = { tanda_id: 7, desde: hace(30) }
  const a = R.alertaRecordatorio(fila(7), r, 'rec24', AHORA)
  assert.deepEqual([...a.menciones].sort(), ['faus', 'gero_m'])
  assert.match(a.lineas[0], /Faus, ¿la podés revisar\? Gero M, atento/)
  assert.equal(a.clave, `guiones_revision:7:${hace(30)}:rec24`)
  const b = R.alertaRecordatorio(fila(7), { tanda_id: 7, desde: hace(50) }, 'rec48', AHORA)
  assert.deepEqual([...b.menciones].sort(), ['faus', 'gero_m', 'tomas'])
  assert.notEqual(a.clave, b.clave)
})

test('horario: de 9 a 20 h de Argentina', () => {
  assert.equal(R.enHorario(new Date('2026-11-03T12:00:00Z')), true)   // 9:00
  assert.equal(R.enHorario(new Date('2026-11-03T11:59:00Z')), false)  // 8:59
  assert.equal(R.enHorario(new Date('2026-11-03T22:59:00Z')), true)   // 19:59
  assert.equal(R.enHorario(new Date('2026-11-03T23:00:00Z')), false)  // 20:00
})

test('barrido: un solo mensaje con todas las tandas, links y menciones', () => {
  const a = R.alertaBarrido([{ fila: fila(4), desde: hace(100) }, { fila: fila(7), desde: hace(70) }], 'https://x.test/', '2026-11-03')
  assert.equal(a.clave, 'guiones_revision_barrido:2026-11-03')
  assert.deepEqual([...a.menciones].sort(), ['faus', 'gero_m', 'tomas'])
  assert.match(a.lineas[0], /Cliente 4 \(A4\) · tanda 1 · desde el .* → <https:\/\/x\.test\/guiones\/A4>/)
  assert.match(a.titulo, /^2 tandas/)
})

function deps(filas, rondas = []) {
  const log = { alertas: [], avisos: [], reservas: [], marcas: [], limpiar: null }
  const mapa = new Map(rondas.map(r => [r.tanda_id, r]))
  return {
    log,
    d: {
      leer: async () => filas,
      rondas: async () => [...mapa.values()],
      reservar: async r => { if (mapa.has(r.tanda_id)) return false; mapa.set(r.tanda_id, r); log.reservas.push(r.tanda_id); return true },
      marcar: async (id, e) => { log.marcas.push([id, e]) },
      limpiar: async v => { log.limpiar = v; return 0 },
      avisar: async (f, t) => { log.avisos.push([f.id, t]); return 'dc:1' },
      alertar: async a => { log.alertas.push(a); return { estado: 'enviado' } },
    },
  }
}

test('vuelta: sin ronda → aviso inicial (una sola vez); con ronda vieja → recordatorio; limpia las que salieron', async () => {
  const x = deps([fila(1), fila(2), fila(3), fila(4)], [
    { tanda_id: 2, desde: hace(25), tipo: 'revisar', clave: 'k2', estado: 'enviado' },
    { tanda_id: 3, desde: hace(49), tipo: 'revisar', clave: 'k3', estado: 'enviado' },
    { tanda_id: 4, desde: hace(2), tipo: 'revisar', clave: 'k4', estado: 'enviado' },
  ])
  const r = await R.correrRecordatoriosRevision(x.d, { ahora: AHORA })
  assert.deepEqual(x.log.avisos, [[1, 'revisar']])
  assert.deepEqual(x.log.alertas.map(a => a.tipo), ['guiones_revision_rec24', 'guiones_revision_rec48'])
  assert.deepEqual(x.log.limpiar, [1, 2, 3, 4])
  assert.equal(r.errores.length, 0)
  // segunda vuelta: la tanda 1 ya tiene ronda (reservada): no se avisa de nuevo
  await R.correrRecordatoriosRevision(x.d, { ahora: AHORA })
  assert.deepEqual(x.log.avisos, [[1, 'revisar']])
})

test('vuelta: fuera de horario no recuerda (pero el aviso que faltó sí sale)', async () => {
  const noche = new Date('2026-11-04T02:00:00Z') // 23:00 AR
  const x = deps([fila(1), fila(2)], [{ tanda_id: 2, desde: hace(30), tipo: 'revisar', clave: 'k2', estado: 'enviado' }])
  const r = await R.correrRecordatoriosRevision(x.d, { ahora: noche })
  assert.equal(r.fueraDeHorario, true)
  assert.equal(x.log.alertas.length, 0)
  assert.deepEqual(x.log.avisos, [[1, 'revisar']])
})

test('vuelta: aviso inicial que falló se reintenta con la misma clave', async () => {
  const x = deps([fila(5)], [{ tanda_id: 5, desde: hace(1), tipo: 'corregida', clave: 'guiones:5:corregida:t', estado: 'sin_webhook' }])
  await R.correrRecordatoriosRevision(x.d, { ahora: AHORA })
  assert.equal(x.log.alertas.length, 1)
  assert.equal(x.log.alertas[0].clave, 'guiones:5:corregida:t')
  assert.equal(x.log.alertas[0].tipo, 'guiones_correcciones')
  assert.deepEqual(x.log.marcas, [[5, 'enviado']])
})

test('vuelta en seco: no manda ni limpia nada', async () => {
  const x = deps([fila(1), fila(2)], [{ tanda_id: 2, desde: hace(30), tipo: 'revisar', clave: 'k', estado: 'enviado' }])
  const r = await R.correrRecordatoriosRevision(x.d, { ahora: AHORA, dry: true })
  assert.deepEqual(r.avisos, ['A1: aviso inicial'])
  assert.deepEqual(r.recordatorios, ['A2: rec24'])
  assert.equal(x.log.alertas.length + x.log.avisos.length + x.log.reservas.length, 0)
  assert.equal(x.log.limpiar, null)
})
