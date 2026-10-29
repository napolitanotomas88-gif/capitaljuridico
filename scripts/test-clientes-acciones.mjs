// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-clientes-acciones.mjs
// Acciones desde la tarjeta del cliente (lib/clientes/acciones): planes de servicio/pausa/reanudar, pausa vigente y
// validación del cuerpo. Sin red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { planServicio, planPausa, planReanudar, finActual } from '../lib/clientes/acciones/plan.ts'
import { pausaVigente } from '../lib/clientes/acciones/registro.ts'
import { leerCuerpoAccion } from '../lib/clientes/acciones/servidor.ts'

const per = (periodo, dia1, fin, precio = 1000, notas = '') => ({ idCliente: 'A001', fila: 2 + periodo, nombre: 'Ana', periodo, dia1, fin, precio, notas, meses: null, esExtension: notas.startsWith('Extensión'), esRenovacionPaga: periodo > 0 && precio !== 0 })
const cliente = (x = {}) => ({ id: 'A001', linea: 'agencia', fila: 23, nombre: 'Ana', estado: 'ACTIVO', finPeriodo: '2026-11-20', notasRenov: '', periodos: [per(0, '2026-07-23', '2026-11-20')], ...x })

describe('servicio', () => {
  test('+1 mes desde el fin actual, período siguiente, precio 0 y la acción en la nota', () => {
    const p = planServicio(cliente(), { tipo: 'servicio', duracion: '1m', motivo: 'regalo' }, 'ac_x1')
    assert.equal(typeof p, 'object')
    assert.deepEqual(p.extension, { id: 'A001', nombre: 'Ana', periodo: 1, desde: '2026-11-20', hasta: '2026-12-20', notas: 'Extensión +1 mes — regalo · acción ac_x1', meses: 1 })
    assert.match(p.resumen, /2026-11-20 a 2026-12-20/)
  })
  test('+2 semanas = 14 días', () => assert.equal(planServicio(cliente(), { tipo: 'servicio', duracion: '2s' }, 'a').extension.hasta, '2026-12-04'))
  test('personalizado por fecha y por días; rechaza fechas viejas y más de un año', () => {
    assert.equal(planServicio(cliente(), { tipo: 'servicio', duracion: 'personalizado', hasta: '2026-12-01' }, 'a').extension.notas, 'Extensión +11 días · acción a')
    assert.equal(planServicio(cliente(), { tipo: 'servicio', duracion: 'personalizado', dias: 10 }, 'a').extension.hasta, '2026-11-30')
    assert.equal(typeof planServicio(cliente(), { tipo: 'servicio', duracion: 'personalizado', hasta: '2026-11-01' }, 'a'), 'string')
    assert.equal(typeof planServicio(cliente(), { tipo: 'servicio', duracion: 'personalizado', dias: 400 }, 'a'), 'string')
    assert.equal(typeof planServicio(cliente(), { tipo: 'servicio', duracion: 'personalizado' }, 'a'), 'string')
  })
  test('el fin actual sale del mayor fin de Renovaciones', () => {
    assert.equal(finActual(cliente({ periodos: [per(0, '2026-07-23', '2026-11-20'), per(1, '2026-11-20', '2027-01-20', 0, 'Extensión +2 meses')] })), '2027-01-20')
    assert.equal(typeof planServicio(cliente({ finPeriodo: null, periodos: [] }), { tipo: 'servicio', duracion: '1m' }, 'a'), 'string')
  })
})

describe('pausa y reanudar', () => {
  const hoy = '2026-10-27'
  test('pausa: solo ACTIVO, sin pausa abierta, no futura', () => {
    const p = planPausa(cliente(), { tipo: 'pausa' }, hoy, null)
    assert.equal(p.estadoNuevo, 'PAUSADO')
    assert.equal(p.plan[0].despues, 'PAUSADO')
    assert.equal(typeof planPausa(cliente({ estado: 'FINALIZADO' }), { tipo: 'pausa' }, hoy, null), 'string')
    assert.equal(typeof planPausa(cliente(), { tipo: 'pausa', desde: '2026-10-28' }, hoy, null), 'string')
    assert.equal(typeof planPausa(cliente(), { tipo: 'pausa' }, hoy, { desde: '2026-10-01', dias: 26, accionId: 'x', modo: 'sombra' }), 'string')
  })
  test('reanudar suma los días pausados como extensión', () => {
    const p = planReanudar(cliente(), { tipo: 'reanudar' }, hoy, { desde: '2026-10-07', dias: 20, accionId: 'x', modo: 'sombra' }, 'ac_r')
    assert.equal(p.estadoNuevo, 'ACTIVO')
    assert.equal(p.extension.hasta, '2026-12-10')
    assert.equal(p.extension.notas, 'Extensión +20 días — compensa pausa · acción ac_r')
    assert.equal(typeof planReanudar(cliente(), { tipo: 'reanudar' }, hoy, null, 'a'), 'string')
  })
  test('pausa vigente: la última pausa sin reanudar posterior; ignora anuladas', () => {
    const a = (id, tipo, estado = 'registrada', datos = {}) => ({ id, tipo, estado, datos, creada: '2026-10-20T12:00:00Z' })
    assert.equal(pausaVigente([a('3', 'pausa', 'registrada', { desde: '2026-10-20' })], hoy).dias, 7)
    assert.equal(pausaVigente([a('4', 'reanudar'), a('3', 'pausa')], hoy), null)
    assert.equal(pausaVigente([a('4', 'reanudar', 'anulada'), a('3', 'pausa', 'registrada', { desde: '2026-10-25' })], hoy).desde, '2026-10-25')
    assert.equal(pausaVigente([a('3', 'pausa', 'anulada')], hoy), null)
  })
})

describe('cuerpo', () => {
  test('tipos activos pasan; los demás todavía no', () => {
    assert.equal(leerCuerpoAccion({ tipo: 'servicio', duracion: '1m' }).tipo, 'servicio')
    assert.equal(typeof leerCuerpoAccion({ tipo: 'servicio', duracion: '3m' }), 'string')
    assert.equal(typeof leerCuerpoAccion({ tipo: 'pago' }), 'string')
    assert.equal(typeof leerCuerpoAccion({ tipo: 'borrar' }), 'string')
    assert.equal(typeof leerCuerpoAccion(null), 'string')
  })
})

import { planDatos, camposDe, validarValor } from '../lib/clientes/acciones/campos.ts'
describe('datos', () => {
  const c = () => ({ ...cliente(), celular: '+54 9 11 1234-5678', mail: 'ana@x.com', closer: 'Marcos', promesa: '', satisfaccion: 8, proximoCobro: '2026-11-01', dia1: '2026-07-23' })
  test('solo los campos que cambian, con antes → después', () => {
    const p = planDatos(c(), { tipo: 'datos', cambios: [{ campo: 'mail', valor: 'ana@y.com' }, { campo: 'closer', valor: 'Marcos' }] }, false)
    assert.deepEqual(p.cambios, [{ campo: 'mail', antes: 'ana@x.com', despues: 'ana@y.com' }])
    assert.equal(p.plan[0].hoja, 'Agencia · fila 23')
  })
  test('rechaza: campo desconocido, sin cambios, fecha inválida, opción, fórmula, nombre vacío, finanzas', () => {
    const r = (cambios, fin = false) => planDatos(c(), { tipo: 'datos', cambios }, fin)
    assert.equal(typeof r([{ campo: 'finPeriodo', valor: 'x' }]), 'string')
    assert.equal(typeof r([{ campo: 'closer', valor: 'Marcos' }]), 'string')
    assert.equal(typeof r([{ campo: 'dia1', valor: '2026-02-31' }]), 'string')
    assert.equal(typeof r([{ campo: 'promesa', valor: 'Quizás' }]), 'string')
    assert.equal(typeof r([{ campo: 'anotaciones', valor: '=IMPORTXML(1)' }]), 'string')
    assert.equal(typeof r([{ campo: 'nombre', valor: '  ' }]), 'string')
    assert.equal(typeof r([{ campo: 'proximoCobro', valor: '2026-12-01' }]), 'string')
    assert.equal(typeof r([{ campo: 'proximoCobro', valor: '2026-12-01' }], true), 'object')
  })
  test('el celular con + pasa; satisfacción 1–10', () => {
    assert.equal(validarValor('celular', '+54 9 11 0000-0000'), '+54 9 11 0000-0000')
    assert.equal(validarValor('satisfaccion', '9'), '9')
    assert.equal(typeof validarValor('satisfaccion', '11'), 'object')
  })
  test('campos: sin Finanzas no aparece Próximo cobro', () => {
    assert.ok(!camposDe(c(), false).some(x => x.campo === 'proximoCobro'))
    assert.equal(camposDe(c(), true).find(x => x.campo === 'satisfaccion').valor, '8')
  })
})
