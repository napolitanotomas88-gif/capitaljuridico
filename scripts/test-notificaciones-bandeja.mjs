import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerBandejaNotificaciones } from '../lib/notificaciones/bandeja.ts'

globalThis.fetch = async () => { throw new Error('Sin red en pruebas de la bandeja') }
const pedido = { email: 'equipo@ejemplo.test', secciones: ['clientes'], pendientes: true }
const aviso = { id: 1, titulo: 'Error de un bot', url: '/clientes?cliente=A149', hechaEn: null, paraSeccion: 'clientes' }
test('si CRM falla, devuelve avisos persistidos con advertencia y nunca reconcilia ni cierra fuentes', async () => {
  let reconciliadas = 0, lecturas = 0
  const r = await leerBandejaNotificaciones(pedido, {
    archivados: async () => { throw new Error('CRM sin respuesta') },
    reconciliar: async () => { reconciliadas++ },
    listar: async p => { assert.equal(p, pedido); lecturas++; return [aviso] },
  })
  assert.equal(lecturas, 1)
  assert.equal(reconciliadas, 0)
  assert.equal(r.estadoClientesVerificado, false)
  assert.deepEqual(r.notificaciones, [aviso])
  assert.match(r.avisoReconciliacion, /No se pudo verificar el CRM/)
})
test('un fallo de reconciliación no oculta la bandeja y el archivo vigente sólo oculta avisos operativos pendientes', async () => {
  const historial = { ...aviso, id: 2, hechaEn: '2026-10-28T12:00:00Z' }
  const finanzas = { ...aviso, id: 3, paraSeccion: 'finanzas' }
  const otro = { ...aviso, id: 4, url: '/clientes?cliente=A150' }
  const r = await leerBandejaNotificaciones(pedido, {
    archivados: async () => new Set(['A149']),
    reconciliar: async () => { throw new Error('Una tabla no responde') },
    listar: async () => [aviso, historial, finanzas, otro],
  })
  assert.equal(r.estadoClientesVerificado, true)
  assert.deepEqual(r.notificaciones.map(n => n.id), [2, 3, 4])
  assert.match(r.avisoReconciliacion, /Se muestran los avisos ya guardados/)
})
test('si falla la base de notificaciones, se informa el error de lectura en vez de inventar una bandeja vacía', async () => {
  await assert.rejects(leerBandejaNotificaciones(pedido, {
    archivados: async () => new Set(), reconciliar: async () => {}, listar: async () => { throw new Error('Neon sin respuesta') },
  }), /Neon/)
})
