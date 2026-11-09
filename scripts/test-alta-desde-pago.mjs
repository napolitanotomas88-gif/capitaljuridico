// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-alta-desde-pago.mjs
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const A = await import('../lib/finanzasSkwd/altaDesdePago.ts')
const P = await import('../lib/bot/alta/parsear.ts')

const base = { ...A.pagoParaBotVacio(), cliente: 'Ana Gómez', telefono: '+54 9 11 5555-0001', programa: 'DFY | PP | $3300', montoUsd: '825', medio: 'Transferencia' }

describe('Finanzas → bot de altas (5/11/2026)', () => {
  test('programa de la lista → programa, tipo y total', () => {
    assert.deepEqual(A.partesPrograma('DFY | PIF | $2600'), { programa: 'DFY', tipo: 'PIF', total: 2600 })
    assert.deepEqual(A.partesPrograma('DFY | PIF | $6.000'), { programa: 'DFY', tipo: 'PIF', total: 6000 })
    assert.deepEqual(A.partesPrograma('DFY+R++ | PP | $3800'), { programa: 'DFY+R++', tipo: 'PP', total: 3800 })
    assert.equal(A.partesPrograma('Fee'), null)
  })
  test('alta nueva PP: el parser del bot entiende todos los campos', () => {
    const p = { ...base, altaNueva: true, correo: 'ana@estudio.com', dni: '30123456', cuit: '20-30123456-7', direccion: 'Calle 1 123, Córdoba', inicio: '2026-11-06', cuotas: '06/12/2026 825\n06/01/2027 825\n06/02/2027 825', socios: 'No tiene', setter: 'Mai' }
    assert.deepEqual(A.faltanParaBot(p, 'Marcos', 1), [])
    const a = P.parsearAlta(A.textoAltaDesdePago(p, 'Marcos'))
    assert.equal(a.etiquetaAlta, true)
    assert.equal(a.closer, 'Marcos')
    assert.equal(a.nombre, 'Ana Gómez')
    assert.equal(a.modalidad, 'PP')
    assert.equal(a.totalUsd, 3300)
    assert.equal(a.estePagoUsd, 825)
    assert.equal(a.correo, 'ana@estudio.com')
    assert.equal(a.inicio, '2026-11-06')
    assert.equal(a.cuotas.length, 3)
    assert.ok(A.textoAltaDesdePago(p, 'Marcos').includes('Setter: Mai'))
    assert.equal(a.avisos.filter((x) => /cronograma suma/.test(x)).length, 0)
    assert.equal(a.telefonos[0]?.numero.replace(/\D/g, '').slice(-8), '55550001')
  })
  test('PIF y pago en pesos', () => {
    const a = P.parsearAlta(A.textoAltaDesdePago({ ...base, programa: 'DFY | PIF | $2600', montoUsd: '', pesos: '1343000' }, 'Carlos'))
    assert.equal(a.modalidad, 'PIF')
    assert.equal(a.totalUsd, 2600)
    assert.ok(a.pagoEnPesos)
  })
  test('faltantes: sin comprobante, teléfono corto, alta nueva sin correo ni cuotas', () => {
    const f = A.faltanParaBot({ ...base, telefono: '123', altaNueva: true }, '', 0)
    for (const x of ['Teléfono', 'Closer', 'Comprobante', 'Correo', 'Fecha de inicio', 'Cuotas', 'DNI', 'Dirección']) assert.ok(f.some((y) => y.startsWith(x)), x)
    assert.ok(!f.some((y) => y.startsWith('CUIT')), 'CUIT / CUIL es opcional (9/11)')
  })
})

test('los closers del formulario son los mismos que acepta «Cargar alta»', async () => {
  const E = await import('../lib/bot/alta/despacho/evento.ts')
  assert.deepEqual([...A.CLOSERS_BOT], [...E.CLOSERS_DESPACHO])
})

test('las fuentes del formulario son las de la col K', async () => {
  const F = await import('../lib/bot/alta/finanzas.ts')
  assert.deepEqual([...A.FUENTES_BOT], [...F.OPCIONES_FUENTE])
})
