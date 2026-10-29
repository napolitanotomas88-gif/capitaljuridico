// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-actualizar-referido.mjs
// "Actualizar referido" (lib/clientes/actualizarReferido.ts): validación, decisión y escritor con planilla falsa. Sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validarActualizacion, decidirActualizacion, actualizarReferido } from '../lib/clientes/actualizarReferido.ts'

const hoy = '2026-10-27'
const fila = (x = {}) => ({ fila: 5, id: 'R001', idReferidor: 'A012', estado: 'Presentado', fechaPedido: '2026-10-10', fechaLlamada: null, idClienteNuevo: '', fechaPrimerPago: null, reembolso: false, notas: '', ...x })
const ctx = (x = {}) => ({ idsClientes: new Set(['A012', 'A170', 'A171']), vinculados: new Map([['A171', 'R009']]), ...x })
const val = e => validarActualizacion({ id: 'R001', estadoAnterior: 'Presentado', ...e }, hoy)

describe('validación', () => {
  test('Asistió/No cerró/Cerró piden fecha de llamada; Cerró pide cliente nuevo', () => {
    assert.ok(val({ estado: 'Asistió' }).errores.fechaLlamada)
    assert.ok(val({ estado: 'Cerró', fechaLlamada: '2026-10-20' }).errores.idClienteNuevo)
    assert.equal(val({ estado: 'No cerró', fechaLlamada: '2026-10-20' }).ok, true)
    assert.equal(val({ estado: 'Descartado' }).ok, true)
  })
  test('fechas futuras, primer pago antes de la llamada y datos de cierre sin Cerró se rechazan', () => {
    assert.ok(val({ estado: 'Asistió', fechaLlamada: '2026-11-01' }).errores.fechaLlamada)
    assert.ok(val({ estado: 'Cerró', fechaLlamada: '2026-10-20', idClienteNuevo: 'A170', fechaPrimerPago: '2026-10-19' }).errores.fechaPrimerPago)
    assert.ok(val({ estado: 'Asistió', fechaLlamada: '2026-10-20', idClienteNuevo: 'A170' }).errores.idClienteNuevo)
    assert.ok(val({ estado: 'No cerró', fechaLlamada: '2026-10-20', reembolso: true }).errores.reembolso)
  })
})

describe('decisión', () => {
  const act = e => val(e).act
  test('Cerró arma I:L con seriales y N=NO; nota con fecha y quién', () => {
    const d = decidirActualizacion(act({ estado: 'Cerró', fechaLlamada: '2026-10-20', idClienteNuevo: 'A170', fechaPrimerPago: '2026-10-22', nota: 'pagó PIF' }), fila(), ctx(), hoy, 'Tomás')
    assert.equal(d.tipo, 'cambiar')
    assert.deepEqual(d.celdasIL, ['Cerró', 46315, 'A170', 46317])
    assert.deepEqual(d.celdasNO, ['NO', '[27/10] pagó PIF (Tomás)'])
  })
  test('cambio concurrente, cliente inexistente, ya vinculado, el mismo referidor', () => {
    const c = act({ estado: 'Cerró', fechaLlamada: '2026-10-20', idClienteNuevo: 'A170' })
    assert.equal(decidirActualizacion(c, fila({ estado: 'Asistió' }), ctx(), hoy, 'x').codigo, 'cambio_concurrente')
    assert.equal(decidirActualizacion({ ...c, idClienteNuevo: 'A999' }, fila(), ctx(), hoy, 'x').codigo, 'cliente_inexistente')
    assert.equal(decidirActualizacion({ ...c, idClienteNuevo: 'A171' }, fila(), ctx(), hoy, 'x').codigo, 'cliente_ya_vinculado')
    assert.equal(decidirActualizacion({ ...c, idClienteNuevo: 'A012' }, fila(), ctx(), hoy, 'x').codigo, 'cliente_es_referidor')
    assert.equal(decidirActualizacion(c, null, ctx(), hoy, 'x').codigo, 'no_existe')
  })
  test('llamada anterior al pedido se rechaza; mismo pedido repetido = sin cambios', () => {
    assert.equal(decidirActualizacion(act({ estado: 'Asistió', fechaLlamada: '2026-10-01' }), fila(), ctx(), hoy, 'x').codigo, 'llamada_antes_del_pedido')
    const ya = fila({ estado: 'Asistió', fechaLlamada: '2026-10-20' })
    assert.equal(decidirActualizacion(validarActualizacion({ id: 'R001', estadoAnterior: 'Asistió', estado: 'Asistió', fechaLlamada: '2026-10-20' }, hoy).act, ya, ctx(), hoy, 'x').tipo, 'sin_cambios')
  })
})

describe('escritor', () => {
  const falsa = (inicial) => {
    let f = { ...inicial }, escrituras = 0
    return {
      escrituras: () => escrituras,
      leerFila: async id => (id === f.id ? { ...f } : null),
      leerContexto: async () => ctx(),
      escribir: async (n, il, no) => { escrituras++; f = { ...f, estado: il[0], idClienteNuevo: il[2] } },
    }
  }
  test('simula sin bandera; escribe y verifica con bandera; el reenvío no vuelve a escribir', async () => {
    const p = falsa(fila())
    const e = { id: 'R001', estadoAnterior: 'Presentado', estado: 'Cerró', fechaLlamada: '2026-10-20', idClienteNuevo: 'A170' }
    assert.equal((await actualizarReferido(e, 'Tomás', { planilla: p, real: false, hoy })).estado, 'simulado')
    assert.equal(p.escrituras(), 0)
    const r = await actualizarReferido(e, 'Tomás', { planilla: p, real: true, hoy })
    assert.equal(r.estado, 'guardado'); assert.equal(p.escrituras(), 1)
    const r2 = await actualizarReferido({ ...e, estadoAnterior: 'Cerró' }, 'Tomás', { planilla: p, real: true, hoy })
    assert.equal(r2.ok, true)
  })
})

import { validarAlta, decidirAlta } from '../lib/clientes/altaReferido.ts'
describe('alta de un referido que ya es cliente', () => {
  const base = { idReferidor: 'A012', nombre: 'Juan Pérez', telefono: '+54 9 11 5555-1234', estudio: 'Estudio JP', momento: 'Primer win', fechaPedido: '2026-10-05' }
  const clientes = [{ id: 'A012', estado: 'ACTIVO', digitos: '5491100000000', mail: '' }, { id: 'A170', estado: 'ACTIVO', digitos: '5491155551234', mail: '' }, { id: 'A171', estado: 'ACTIVO', digitos: '5491177770000', mail: '' }]
  test('sin ID: rechazado como hoy; con su ID: se acepta y va en K', () => {
    assert.equal(decidirAlta(validarAlta(base, hoy).alta, [], clientes).codigo, 'ya_es_cliente')
    const a = validarAlta({ ...base, idClienteNuevo: 'a170' }, hoy).alta
    assert.equal(decidirAlta(a, [], clientes).tipo, 'nuevo')
  })
  test('ID que no coincide con el teléfono, inexistente o ya vinculado: rechazado', () => {
    assert.equal(decidirAlta(validarAlta({ ...base, idClienteNuevo: 'A171' }, hoy).alta, [], clientes).codigo, 'cliente_nuevo_no_coincide')
    assert.equal(decidirAlta(validarAlta({ ...base, idClienteNuevo: 'A999' }, hoy).alta, [], clientes).codigo, 'cliente_nuevo_inexistente')
    assert.equal(decidirAlta(validarAlta({ ...base, idClienteNuevo: 'A170' }, hoy).alta, [{ id: 'R004', idReferidor: 'A050', digitos: '1', fechaPedido: null, momento: '', idClienteNuevo: 'A170' }], clientes).codigo, 'cliente_nuevo_ya_vinculado')
  })
})
