import { test } from 'node:test'
import assert from 'node:assert/strict'
delete process.env.DATABASE_URL
globalThis.fetch = async () => { throw new Error('red prohibida') }
const { avisosDeEstados, avisosSinRegistrar } = await import('../lib/notificaciones/reconciliar.ts')
const { atajosDelHub } = await import('../components/clientes/menuRapidoAtajos.ts')
const { laVe } = await import('../lib/notificaciones/modelo.ts')
const fila = (fuente, estado) => ({ fuente, estado, id: '12', cliente: 'Cliente de prueba', idCrm: 'a149', actualizado: '2026-10-28T12:00:00Z' })

test('la reconciliación deriva sólo trabajo humano pendiente y sólo de las secciones autorizadas', () => {
  const filas = [fila('guiones', 'a_revisar'), fila('guiones', 'enviada'), fila('edicion', 'editado'), fila('altas', 'esperando_humano'), fila('bajas', 'rechazado')]
  const a = avisosDeEstados(filas, ['guiones'])
  assert.equal(a.length, 1); assert.match(a[0].titulo, /Revisar guiones/); assert.equal(a[0].url, '/guiones/A149')
  assert.equal(avisosDeEstados(filas, []).length, 0)
  assert.equal(avisosDeEstados(filas, ['edicion']).length, 1)
})
test('el error genera urgente; misma versión mantiene clave, cambio real genera otro aviso', () => {
  const f = fila('guiones', 'error')
  const a = avisosDeEstados([f], ['guiones'])[0]
  assert.equal(a.urgente, true)
  assert.equal(avisosDeEstados([f], ['guiones'])[0].clave, a.clave)
  assert.notEqual(avisosDeEstados([{ ...f, actualizado: '2026-10-28T13:00:00Z' }], ['guiones'])[0].clave, a.clave)
})
test('los pedidos generales de Altas sólo llegan a aprobadores, no a cualquier closer con sección Altas', () => {
  const f = fila('altas', 'esperando_humano')
  assert.equal(avisosDeEstados([f], ['altas']).length, 0)
  const a = avisosDeEstados([f], ['altas'], ['aprobador@ejemplo.test'])
  assert.equal(a.length, 1)
  assert.equal(a[0].paraSeccion, null)
  assert.equal(laVe(a[0], 'closer@ejemplo.test', ['altas']), false)
  assert.equal(laVe(a[0], 'aprobador@ejemplo.test', ['altas']), true)
})
test('el cupo se consume sólo con avisos nuevos: el aviso 41 no queda postergado detrás de 40 ya registrados', () => {
  const avisos = Array.from({ length: 85 }, (_, i) => ({ clave: `recon:${i}`, urgente: i === 84, titulo: `Caso ${i}` }))
  const primera = avisosSinRegistrar(avisos, new Set())
  assert.equal(primera.length, 40)
  assert.equal(primera[0].clave, 'recon:84', 'los avisos nuevos urgentes se atienden primero')
  const existentes = new Set(primera.map(a => a.clave))
  const segunda = avisosSinRegistrar(avisos, existentes)
  assert.equal(segunda.length, 40)
  assert.equal(segunda.some(a => existentes.has(a.clave)), false)
  assert.ok(segunda.some(a => a.clave === 'recon:40'))
  for (const a of segunda) existentes.add(a.clave)
  assert.equal(avisosSinRegistrar(avisos, existentes).length, 5)
})
test('los atajos no exponen pago/renovación sin Finanzas ni acciones sin permiso de edición', () => {
  const accesos = [{ href: '/clientes', etiqueta: 'Cartera' }, { href: '/clientes/altas', etiqueta: 'Alta' }, { href: '/guiones', etiqueta: 'Guiones' }]
  const comunes = atajosDelHub(accesos)
  assert.equal(comunes.some(a => /accion=/.test(a.href)), false)
  assert.equal(comunes.some(a => a.href === '/clientes/altas'), true)
  const editor = atajosDelHub(accesos, { puedeEditarCliente: true })
  assert.equal(editor.some(a => /accion=(pago|renovacion)/.test(a.href)), false)
  assert.equal(editor.some(a => a.href === '/clientes?accion=pausa'), true)
  assert.equal(editor.some(a => a.href === '/clientes/entregas'), false, 'ser aprobador de altas no otorga la entrega final de guiones')
  assert.equal(atajosDelHub(accesos, { puedeEntregarGuiones: true }).some(a => a.href === '/clientes/entregas'), true)
  assert.equal(atajosDelHub(accesos, { puedeEditarCliente: true, puedeFinanzas: true }).some(a => a.href === '/clientes?accion=pago'), true)
  assert.equal(atajosDelHub([]).length, 0)
})
