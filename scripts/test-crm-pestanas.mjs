// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-crm-pestanas.mjs
// Nombres de las pestañas del CRM de ventas y la persona que trabaja en varias (pre-caller, pedido de Tomás 17/10/2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.AUTH_VENTAS_PESTANAS = '{}'
process.env.AUTH_USUARIOS = ''
const { fijarAccesosDePlanilla, accesoDePlanilla } = await import('../lib/auth/usuarios.ts')
const { closers, hojasDeMail, nombreCloserDeHoja } = await import('../lib/crm/config.ts')

const persona = (email, nombre, pestanas) => accesoDePlanilla({ email, nombre, tipo: 'acceso', secciones: ['ventas'], pestanas })
const nombres = () => Object.fromEntries(closers().map((c) => [c.hoja, c.nombre]))

test('cada pestaña lleva el nombre de su dueño (quien tiene SOLO esa); el pre-caller con todas no le pone su nombre a ninguna', () => {
  fijarAccesosDePlanilla([
    persona('carlos@x.co', 'Carlos Roletto', ['Closer 1']),
    persona('marcos@x.co', 'Marcos Carlomagno', ['Closer 2']),
    persona('yamila@x.co', 'Yamila Coutoune', ['Closer 3']),
    persona('valentin@x.co', 'Valentin Iboldi', ['Closer 1', 'Closer 2', 'Closer 3', 'Gero-Xavi Rejunte']),
  ])
  // Closer 4 y 5 (18/10/2026) todavía sin closer: llevan el nombre de la pestaña
  assert.deepEqual(nombres(), { 'Closer 1': 'Carlos Roletto', 'Closer 2': 'Marcos Carlomagno', 'Closer 3': 'Yamila Coutoune', 'Closer 4': 'Closer 4', 'Closer 5': 'Closer 5', 'Gero-Xavi Rejunte': 'Gero-Xavi Rejunte' })
  assert.equal(nombreCloserDeHoja('Gero-Xavi Rejunte'), 'Gero-Xavi Rejunte')
  // El pre-caller puede abrir las 4
  assert.deepEqual(hojasDeMail('valentin@x.co'), ['Closer 1', 'Closer 2', 'Closer 3', 'Gero-Xavi Rejunte'])
})

test('dos dueños de la misma pestaña: queda el nombre de la pestaña', () => {
  fijarAccesosDePlanilla([persona('a@x.co', 'Ana', ['Closer 1']), persona('b@x.co', 'Beto', ['Closer 1'])])
  assert.equal(nombres()['Closer 1'], 'Closer 1')
})
