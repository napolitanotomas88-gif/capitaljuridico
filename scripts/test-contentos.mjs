// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-contentos.mjs
// Clientes contentos (a quién pedirle referidos): señal, medición y orden. Lógica pura; los umbrales son una propuesta.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { senalDe, armarContentos, UMBRAL_SATISFACCION_ALTA, UMBRAL_SATISFACCION_BAJA } from '../lib/clientes/contentos.ts'

const C = (o = {}) => ({ id: 'A001', nombre: 'Ana', estado: 'ACTIVO', cuentaEnMetricas: true, semaforo: 'verde', promesa: '', testimonio: '', satisfaccion: null, diasParaVencer: 30, ...o })

describe('senalDe', () => {
  test('rojo o satisfacción baja = no pedir, aunque tenga otras señales', () => {
    assert.equal(senalDe(C({ semaforo: 'rojo', promesa: 'Sí', testimonio: 'x', satisfaccion: 10 })).senal, 'no_pedir')
    assert.equal(senalDe(C({ satisfaccion: UMBRAL_SATISFACCION_BAJA, promesa: 'Sí', testimonio: 'x' })).senal, 'no_pedir')
  })
  test('alta: verde con satisfacción alta, o verde con promesa cumplida y testimonio', () => {
    assert.equal(senalDe(C({ satisfaccion: UMBRAL_SATISFACCION_ALTA })).senal, 'alta')
    assert.equal(senalDe(C({ promesa: 'Sí', testimonio: 'Excelente' })).senal, 'alta')
  })
  test('media: verde con promesa cumplida o con testimonio (una sola señal)', () => {
    assert.equal(senalDe(C({ promesa: 'Sí' })).senal, 'media'); assert.equal(senalDe(C({ testimonio: 'bien' })).senal, 'media')
  })
  test('por medir: verde sin señales, amarillo, promesa parcial o satisfacción 7', () => {
    for (const c of [C(), C({ semaforo: 'amarillo', promesa: 'Sí', testimonio: 'x' }), C({ promesa: 'Parcial' }), C({ satisfaccion: 7 })]) assert.equal(senalDe(c).senal, 'por_medir')
    assert.deepEqual(senalDe(C()).motivos, ['Semáforo verde'])
  })
  test('el testimonio con solo espacios no cuenta', () => assert.equal(senalDe(C({ testimonio: '   ' })).senal, 'por_medir'))
})

describe('armarContentos', () => {
  const clientes = [
    C({ id: 'A001', nombre: 'Zeta', promesa: 'Sí', testimonio: 'x' }),
    C({ id: 'A002', nombre: 'Beta', satisfaccion: 9 }),
    C({ id: 'A003', nombre: 'Alfa', satisfaccion: 5 }),
    C({ id: 'A004', nombre: 'Gamma', promesa: 'Sí' }),
    C({ id: 'A005', nombre: 'Delta' }),
    C({ id: 'A006', nombre: 'Inactivo', estado: 'FINALIZADO' }),
    C({ id: 'A007', nombre: 'No cuenta', cuentaEnMetricas: false }),
    C({ id: '', nombre: 'Sin ID' }),
  ]
  const { filas, medicion } = armarContentos({ clientes, referidos: [{ idReferidor: 'A001' }, { idReferidor: 'A001' }, { idReferidor: 'A002' }] })
  test('solo clientes activos, con ID y que cuentan en las métricas', () => assert.deepEqual(filas.map(f => f.id).sort(), ['A001', 'A002', 'A003', 'A004', 'A005']))
  test('orden: alta antes que media, por medir y no pedir; con igual señal, mayor satisfacción primero', () => {
    assert.deepEqual(filas.map(f => f.id), ['A002', 'A001', 'A004', 'A005', 'A003'])
  })
  test('medición: cuántos tienen cada dato, promedio solo de las cargadas y sin promedio si no hay ninguna', () => {
    assert.equal(medicion.activos, 5); assert.equal(medicion.conSatisfaccion, 2); assert.equal(medicion.promedioSatisfaccion, 7)
    assert.equal(medicion.verdes, 5); assert.equal(medicion.promesaSi, 2); assert.equal(medicion.conTestimonio, 1)
    assert.deepEqual(medicion.porSenal, { alta: 2, media: 1, por_medir: 1, no_pedir: 1 })
    assert.equal(armarContentos({ clientes: [C()], referidos: [] }).medicion.promedioSatisfaccion, null)
  })
  test('referidos ya presentados por cada cliente', () => {
    assert.equal(filas.find(f => f.id === 'A001').referidosPresentados, 2); assert.equal(filas.find(f => f.id === 'A002').referidosPresentados, 1); assert.equal(filas.find(f => f.id === 'A005').referidosPresentados, 0)
  })
  test('no modifica las entradas', () => {
    const copia = JSON.stringify(clientes); armarContentos({ clientes, referidos: [] }); assert.equal(JSON.stringify(clientes), copia)
  })
})
