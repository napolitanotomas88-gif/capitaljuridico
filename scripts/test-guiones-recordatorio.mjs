// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-guiones-recordatorio.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { pendientesSinVerificar, alertaSinVerificar, notificacionesSinVerificar, rolDeEditor, correrRecordatorio, revisionesPendientes, alertaRevision, notificacionesRevision } = await import('../lib/bot/guiones/recordatorio.ts')

const AHORA = new Date('2026-11-03T12:00:00Z')
const hace = h => new Date(AHORA.getTime() - h * 3_600_000).toISOString()
const v = { quien: 'Faus', email: 'x@y.z', cuando: hace(1) }
const fila = (guiones, estado = 'a_revisar') => ({ id: 9, id_crm: 'CUENTA_QA', cliente: 'Cliente QA', estado, guiones })

test('rolDeEditor: Faus y Tomás/Tomi; otro nombre, null', () => {
  assert.equal(rolDeEditor('Faus'), 'faus')
  assert.equal(rolDeEditor('Tomás'), 'tomas')
  assert.equal(rolDeEditor('Tomi'), 'tomas')
  assert.equal(rolDeEditor('Aylu'), null)
})

test('pendientes: editados hace más de 2 h y sin verificar', () => {
  const f = fila({ 1: { editado: { quien: 'Faus', cuando: hace(5) } }, 2: { editado: { quien: 'Faus', cuando: hace(4) }, verificado: v }, 3: {} })
  const p = pendientesSinVerificar([f], AHORA)
  assert.equal(p.length, 1)
  assert.deepEqual(p[0].numeros, [1])
  assert.deepEqual(p[0].editores, ['Faus'])
})

test('pendientes: no avisa si sigue editando (menos de 2 h), sin ediciones o fuera de a_revisar', () => {
  assert.equal(pendientesSinVerificar([fila({ 1: { editado: { quien: 'Faus', cuando: hace(5) } }, 2: { editado: { quien: 'Faus', cuando: hace(1) } } })], AHORA).length, 0)
  assert.equal(pendientesSinVerificar([fila({ 1: {}, 2: {} })], AHORA).length, 0)
  assert.equal(pendientesSinVerificar([fila({ 1: { editado: { quien: 'Faus', cuando: hace(5) } } }, 'aprobada')], AHORA).length, 0)
})

test('alerta: menciona a quien editó (lo de Tomás va a Faus), una por tanda y día', () => {
  const [p] = pendientesSinVerificar([fila({ 2: { editado: { quien: 'Faus', cuando: hace(5) } }, 4: { editado: { quien: 'Tomás', cuando: hace(3) } } })], AHORA)
  const a = alertaSinVerificar(p, '2026-11-03')
  assert.equal(a.canal, 'guiones')
  assert.equal(a.clave, 'guiones_sin_verificar:9:2026-11-03')
  assert.deepEqual([...a.menciones].sort(), ['faus'])
  const [solo] = pendientesSinVerificar([fila({ 1: { editado: { quien: 'Tomi', cuando: hace(5) } } })], AHORA)
  assert.deepEqual([...alertaSinVerificar(solo, '2026-11-03').menciones], ['faus'])
  const [otro] = pendientesSinVerificar([fila({ 1: { editado: { quien: 'Aylu', cuando: hace(5) } } })], AHORA)
  assert.deepEqual([...alertaSinVerificar(otro, '2026-11-03').menciones].sort(), ['faus', 'gero_m'])
  const nt = notificacionesSinVerificar(solo, '2026-11-03', { GUIONES_REVISOR_FAUS: 'faus@ejemplo.test', KICKOFF_REVISOR_TOMI: 'tomi@ejemplo.test' })
  assert.deepEqual(nt.map(n => n.paraEmail), ['faus@ejemplo.test'])
  assert.match(a.lineas.join(' '), /los guiones 2 y 4/)
  assert.equal(a.link, '/guiones/CUENTA_QA')
})

test('campanita: al mail de quien editó; sin mail, a la sección guiones', () => {
  const [p] = pendientesSinVerificar([fila({ 1: { editado: { quien: 'Faus', cuando: hace(5) } } })], AHORA)
  const ns = notificacionesSinVerificar(p, '2026-11-03', { GUIONES_REVISOR_FAUS: 'faus@ejemplo.test' })
  assert.deepEqual(ns.map(n => n.paraEmail), ['faus@ejemplo.test'])
  const sin = notificacionesSinVerificar(p, '2026-11-03', {})
  assert.equal(sin[0].paraSeccion, 'guiones')
})

test('correr: dry no avisa; real avisa una vez por tanda', async () => {
  const alertas = [], notis = []
  const deps = { leer: async () => [fila({ 1: { editado: { quien: 'Faus', cuando: hace(5) } } })], alertar: async a => { alertas.push(a); return { estado: 'enviado' } }, notificar: async n => { notis.push(n) } }
  const d = await correrRecordatorio(deps, { ahora: AHORA, dry: true })
  assert.equal(d.pendientes.length, 1); assert.equal(alertas.length, 0)
  const r = await correrRecordatorio(deps, { ahora: AHORA })
  assert.equal(alertas.length, 1); assert.ok(notis.length >= 1)
  assert.equal(r.dia, '2026-11-03')
})

const vv = h => ({ quien: 'Faus', email: 'x@y.z', cuando: hace(h) })

test('revisión a medias: 6/6 verificados sin check final → «falta el check final» a Faus y Gero M', () => {
  const g = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [n, { verificado: vv(5) }]))
  const [r] = revisionesPendientes([fila(g)], AHORA)
  assert.deepEqual(r.faltan, []); assert.equal(r.total, 6)
  const a = alertaRevision(r, '2026-11-03')
  assert.equal(a.clave, 'guiones_revision_pendiente:9:2026-11-03')
  assert.deepEqual([...a.menciones], ['faus', 'gero_m'])
  assert.match(a.lineas.join(' '), /Falta el check final: van 6 de 6/)
  assert.doesNotMatch(a.lineas.join(' '), /Tomi|Tomás/)
  const ns = notificacionesRevision(r, '2026-11-03', { GUIONES_REVISOR_FAUS: 'faus@ejemplo.test', KICKOFF_REVISOR_TOMI: 'tomi@ejemplo.test' })
  assert.deepEqual(ns.map(n => n.paraEmail), ['faus@ejemplo.test'])
})

test('revisión a medias: 5/6 → «falta 1 por verificar»; no se pisa con lo editado sin verificar ni avisa lo intacto o reciente', () => {
  const g = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [n, n === 3 ? {} : { verificado: vv(5) }]))
  const [r] = revisionesPendientes([fila(g)], AHORA)
  assert.deepEqual(r.faltan, [3])
  assert.match(alertaRevision(r, '2026-11-03').lineas[0], /^Falta 1 por verificar \(el guion 3\) y después el check final: van 5 de 6/)
  // editado sin verificar: lo cubre pendientesSinVerificar
  assert.equal(revisionesPendientes([fila({ ...g, 3: { editado: { quien: 'Faus', cuando: hace(5) } } })], AHORA).length, 0)
  // nadie empezó: no es «a medias»
  assert.equal(revisionesPendientes([fila({ 1: {}, 2: {} })], AHORA).length, 0)
  // la última verificación es de hace menos de 2 h: sigue revisando
  assert.equal(revisionesPendientes([fila({ ...g, 6: { verificado: vv(1) } })], AHORA).length, 0)
  assert.equal(revisionesPendientes([fila(g, 'aprobada')], AHORA).length, 0)
})

test('correr: avisa también la revisión a medias', async () => {
  const alertas = []
  const g = Object.fromEntries([1, 2].map(n => [n, { verificado: vv(5) }]))
  const deps = { leer: async () => [fila(g)], alertar: async a => { alertas.push(a); return { estado: 'enviado' } }, notificar: async () => {} }
  const d = await correrRecordatorio(deps, { ahora: AHORA, dry: true })
  assert.deepEqual(d.revisiones, [{ id: 9, idCrm: 'CUENTA_QA', faltan: [], total: 2 }]); assert.equal(alertas.length, 0)
  const r = await correrRecordatorio(deps, { ahora: AHORA })
  assert.equal(alertas.length, 1); assert.equal(alertas[0].tipo, 'guiones_revision_pendiente')
  assert.match(r.resultados[0], /check final/)
})
