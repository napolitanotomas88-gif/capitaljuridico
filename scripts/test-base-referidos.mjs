// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-base-referidos.mjs
// Base de referidos (una ficha por persona recomendada): categorías, N.º de intento, beneficios del referido y vínculos. Lógica pura.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { armarBaseReferidos, contarPorCategoria, textoBeneficiosReferido, esCategoriaBase } from '../lib/clientes/baseReferidos.ts'
import { calcularCreditosDeDatos } from '../lib/clientes/programa.ts'
import { REGLAS_REFERIDOS } from '../lib/clientes/reglasReferidos.ts'

const HOY = '2026-10-20'
const R = REGLAS_REFERIDOS
const REF = (o = {}) => ({ id: 'R001', fila: 2, fechaPedido: '2026-10-02', momento: 'Primer win', idReferidor: 'A001', nombre: 'Lead', telefono: '', mail: '', estudio: 'Estudio X', estado: 'Presentado', fechaLlamada: null, idClienteNuevo: '', fechaPrimerPago: null, fechaLiberacion: null, reembolso: false, notas: '', cargadoPor: '', ...o })
const clientes = [{ id: 'A001', nombre: 'Ana Pérez', celular: '', mail: '' }, { id: 'A050', nombre: 'Nuevo Cliente', celular: '', mail: '' }]
const base = referidos => {
  const datos = { clientes, referidos, movimientos: [], hoy: HOY, reglas: R }
  return armarBaseReferidos({ referidos, clientes, creditos: calcularCreditosDeDatos(datos), hoy: HOY }, R)
}
const por = (filas, id) => filas.find(f => f.id === id)

describe('base de referidos', () => {
  const filas = base([
    REF({ id: 'R001', estado: 'Presentado' }),
    REF({ id: 'R002', estado: 'No cerró', fechaLlamada: '2026-10-05', nombre: 'Intento uno' }),
    REF({ id: 'R003', estado: 'No cerró', fechaLlamada: '2026-10-09', nombre: 'Intento dos' }),
    REF({ id: 'R004', estado: 'Cerró', fechaLlamada: '2026-10-06', fechaPrimerPago: '2026-10-07', idClienteNuevo: 'A050' }),
    REF({ id: 'R005', estado: 'No asistió' }),
    REF({ id: 'R006', estado: 'Descartado' }),
  ])
  test('cada estado cae en su categoría y los conteos suman', () => {
    assert.deepEqual(contarPorCategoria(filas), { en_curso: 1, intento: 2, cerro: 1, sin_llamada: 2 })
    assert.equal(por(filas, 'R004').categoria, 'cerro')
  })
  test('el N.º de intento sigue el orden de las llamadas y trae el premio de la escalera de intentos', () => {
    assert.equal(por(filas, 'R002').intento.numero, 1); assert.match(por(filas, 'R002').intento.premio, /Página web/i)
    assert.equal(por(filas, 'R003').intento.numero, 2); assert.match(por(filas, 'R003').intento.premio, /USD 300/)
    assert.equal(por(filas, 'R002').intento.cuenta, true)
    for (const id of ['R001', 'R004', 'R005', 'R006']) assert.equal(por(filas, id).intento, null)   // un cierre no es un intento
  })
  test('beneficios del referido: condición mientras está en curso, le corresponden si cerró, los pierde si no se sumó; nunca "verificado"', () => {
    const b = textoBeneficiosReferido(R); assert.equal(b, 'USD 300 de descuento + 1 mes más de servicio')
    assert.equal(por(filas, 'R001').beneficio.tono, 'espera'); assert.match(por(filas, 'R001').beneficio.texto, /solo si se suma en la llamada/)
    assert.equal(por(filas, 'R004').beneficio.tono, 'aplica'); assert.match(por(filas, 'R004').beneficio.texto, /closer confirma/)
    assert.equal(por(filas, 'R002').beneficio.tono, 'perdido')
    assert.equal(por(filas, 'R005').beneficio.tono, 'ninguno')
  })
  test('vínculos: nombre de quien presentó y del cliente nuevo salen del CRM; sin cliente asignado no inventa un nombre', () => {
    assert.equal(por(filas, 'R001').nombreReferidor, 'Ana Pérez'); assert.equal(por(filas, 'R001').referidorEnCrm, true)
    assert.equal(por(filas, 'R004').nombreClienteNuevo, 'Nuevo Cliente')
    const x = base([REF({ id: 'R100', idReferidor: 'A999' })])[0]
    assert.equal(x.referidorEnCrm, false); assert.equal(x.nombreReferidor, 'A999')
  })
  test('lo más reciente primero y los anteriores al programa no generan beneficios ni intento', () => {
    assert.equal(filas[0].id, 'R003')
    const previo = base([REF({ id: 'R200', estado: 'No cerró', fechaPedido: '2026-09-15', fechaLlamada: '2026-09-20' })])[0]
    assert.equal(previo.intento, null); assert.equal(previo.beneficio.tono, 'previo')
  })
  test('un intento que el cálculo de créditos no cuenta (lead que ya era contacto del CRM) se marca "no suma" en vez de prometer premio', () => {
    const conocidos = [{ id: 'A001', nombre: 'Ana', celular: '+54 9 351 555 0000', mail: '' }]
    const referidos = [REF({ id: 'R300', estado: 'No cerró', fechaLlamada: '2026-10-05', telefono: '+54 9 351 555 0000' })]
    const datos = { clientes: conocidos, referidos, movimientos: [], hoy: HOY, reglas: R }
    const f = armarBaseReferidos({ referidos, clientes: conocidos, creditos: calcularCreditosDeDatos(datos), hoy: HOY }, R)[0]
    assert.equal(f.intento.cuenta, false)
  })
  test('no modifica sus entradas y el filtro acepta solo categorías conocidas', () => {
    const referidos = [REF({ id: 'R400', estado: 'No cerró', fechaLlamada: '2026-10-05' })]; const copia = JSON.stringify(referidos)
    base(referidos); assert.equal(JSON.stringify(referidos), copia)
    assert.equal(esCategoriaBase('intento'), true); for (const v of ['otra', '', null, undefined, '__proto__']) assert.equal(esCategoriaBase(v), false)
  })
})
