import { test } from 'node:test'
import assert from 'node:assert/strict'
delete process.env.DATABASE_URL
globalThis.fetch = async () => { throw new Error('red prohibida en pruebas') }
const { alertasInactivos, INTERVALO_INACTIVOS_MS } = await import('../lib/clientes/inactivos.ts')
const ahora = Date.parse('2026-10-28T12:00:00Z'), dia = 86_400_000
const cliente = { id: 'A149', nombre: 'Cliente de prueba', estado: 'ACTIVO' }
const contacto = (equipo, entrada = null) => ({ idCrm: 'A149', ultimoEquipo: new Date(equipo).toISOString(), ultimoCliente: entrada === null ? null : new Date(entrada).toISOString() })

test('sólo se alerta desde tres días completos de espera; la clave cambia cada tres días, no en cada cron', () => {
  assert.equal(INTERVALO_INACTIVOS_MS, 3 * dia)
  assert.equal(alertasInactivos([cliente], [contacto(ahora - 3 * dia + 1)], ahora).length, 0)
  const a = alertasInactivos([cliente], [contacto(ahora - 3 * dia)], ahora)[0]
  assert.equal(a.dias, 3)
  assert.equal(alertasInactivos([cliente], [contacto(ahora - 3 * dia)], ahora + dia)[0].clave, a.clave)
  assert.notEqual(alertasInactivos([cliente], [contacto(ahora - 3 * dia)], ahora + 3 * dia)[0].clave, a.clave)
})
test('una respuesta del cliente resuelve la espera; una respuesta anterior al último pedido no la resuelve', () => {
  assert.equal(alertasInactivos([cliente], [contacto(ahora - 5 * dia, ahora - 2 * dia)], ahora).length, 0)
  assert.equal(alertasInactivos([cliente], [contacto(ahora - 5 * dia, ahora - 6 * dia)], ahora).length, 1)
  assert.equal(alertasInactivos([cliente], [contacto(ahora - 5 * dia, ahora - 5 * dia)], ahora).length, 0)
})
test('CRM INACTIVO no significa falta de respuesta; tampoco avisa pausados, finalizados, no clientes ni fechas desconocidas', () => {
  for (const estado of ['INACTIVO', 'PAUSADO', 'FINALIZADO', '']) assert.equal(alertasInactivos([{ ...cliente, estado }], [contacto(ahora - 5 * dia)], ahora).length, 0)
  assert.equal(alertasInactivos([{ ...cliente, esNoCliente: true }], [contacto(ahora - 5 * dia)], ahora).length, 0)
  for (const ultimoEquipo of [null, '', 'fecha falsa', new Date(ahora + dia).toISOString()]) assert.equal(alertasInactivos([cliente], [{ idCrm: 'A149', ultimoEquipo, ultimoCliente: null }], ahora).length, 0)
  assert.equal(alertasInactivos([cliente], [], ahora).length, 0)
})
