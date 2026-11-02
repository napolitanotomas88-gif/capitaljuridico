// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-guiones-recordatorio.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
const { pendientesSinVerificar, alertaSinVerificar, notificacionesSinVerificar, rolDeEditor, correrRecordatorio } = await import('../lib/bot/guiones/recordatorio.ts')

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

test('alerta: menciona a quien editó, una por tanda y día', () => {
  const [p] = pendientesSinVerificar([fila({ 2: { editado: { quien: 'Faus', cuando: hace(5) } }, 4: { editado: { quien: 'Tomás', cuando: hace(3) } } })], AHORA)
  const a = alertaSinVerificar(p, '2026-11-03')
  assert.equal(a.canal, 'guiones')
  assert.equal(a.clave, 'guiones_sin_verificar:9:2026-11-03')
  assert.deepEqual([...a.menciones].sort(), ['faus', 'tomas'])
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
