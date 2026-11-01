// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-finanzas-pago-app.mjs
// Pago del bot → app de Finanzas (lib/finanzasSkwd/pagoApp.ts) y quién recibió (quienRecibioApp de finanzas.ts). Sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const { pagoDesdeFila, consultaPagoApp, guardarPagoEnApp, CORREO_BOT } = await import('../lib/finanzasSkwd/pagoApp.ts')
const { filaRegistroPagos, quienRecibioApp, cuentaPorMedio } = await import('../lib/bot/alta/finanzas.ts')
const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')

const ALTA = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Juan Pérez
Teléfono: +54 9 11 3000-1111
Correo: juan@example.test
Dirección: Calle 1 123
DNI: 30111222
CUIT: 20-30111222-3
Inicio del servicio: 19/10/2026
Cuotas:
19/11/2026 1100
19/12/2026 1100`

describe('quién recibió', () => {
  test('Tomi y Gero pasan igual; Empresa se separa de la Financiera', () => {
    assert.equal(quienRecibioApp('Tomi', []), 'Tomi')
    assert.equal(quienRecibioApp('Gero', ['Stripe']), 'Gero')
    assert.equal(quienRecibioApp('Empresa', ['Stripe']), 'Empresa')
    assert.equal(quienRecibioApp('Empresa', ['Asociación Mutual de Escribanos']), 'Financiera')
    assert.equal(quienRecibioApp('', ['Stripe']), null)
  })
  test('Ágil Pagos / Diaz Rangel Rosanthony es la Financiera (Tomás, 1/11)', () => {
    assert.equal(cuentaPorMedio('Diaz Rangel Rosanthony'), 'Empresa')
    assert.equal(cuentaPorMedio('Ágil Pagos'), 'Empresa')
    assert.equal(quienRecibioApp('Empresa', ['Diaz Rangel Rosanthony - Ágil Pagos']), 'Financiera')
  })
  test('la fila del bot lo trae', () => {
    const f = filaRegistroPagos(parsearAlta(ALTA), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Inbound IG', destinatario: 'Diaz Rangel Rosanthony' })
    assert.equal(f.celdas.R, 'Empresa'); assert.equal(f.quienRecibio, 'Financiera')
  })
})

describe('pagoDesdeFila', () => {
  test('la fila del Registro como pago de la app', () => {
    const f = filaRegistroPagos(parsearAlta(ALTA), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Tomi' })
    const p = pagoDesdeFila(f, 'Juan Pérez - PP 1/3.jpg')
    assert.equal(p.fecha, '2026-10-23'); assert.equal(p.cliente, 'Juan Pérez'); assert.equal(p.monto_usd, 1100)
    assert.equal(p.concepto, '1ra Cuota'); assert.equal(p.tipo_pago, 'Payment Plan'); assert.equal(p.closer, 'Marcos')
    assert.equal(p.comprobante, 'Juan Pérez - PP 1/3.jpg'); assert.equal(p.moneda_original, 'USD'); assert.equal(p.comision, 0)
    assert.equal(f.quienRecibio, 'Tomi')
  })
  test('sin fecha, cliente o monto: null', () => {
    const f = filaRegistroPagos(parsearAlta(ALTA), { fecha: '2026-10-23' })
    assert.equal(pagoDesdeFila({ ...f, celdas: { ...f.celdas, C: '' } }), null)
    assert.equal(pagoDesdeFila({ ...f, celdas: { ...f.celdas, A: '' } }), null)
  })
})

describe('guardarPagoEnApp', () => {
  const f = filaRegistroPagos(parsearAlta(ALTA), { fecha: '2026-10-23', cuenta: 'Gero' })
  test('una sentencia que no duplica y firma con el correo del bot', async () => {
    let vistas
    const r = await guardarPagoEnApp(f, null, async (qs) => { vistas = qs; return [[{}], [{ id: '700', nuevo: true }]] })
    assert.deepEqual(r, { ok: true, id: 700, nuevo: true, motivo: null })
    assert.deepEqual(JSON.parse(vistas[0].params[0]), { email: CORREO_BOT })
    assert.match(vistas[1].texto, /where not exists \(select 1 from ya\)/)
    assert.equal(vistas[1].params[1], 'Gero')
    assert.equal(consultaPagoApp(pagoDesdeFila(f), null).params[1], null)
  })
  test('un error de la base no se tira: vuelve como motivo', async () => {
    const r = await guardarPagoEnApp(f, null, async () => { throw new Error('sin conexión') })
    assert.deepEqual(r, { ok: false, id: null, nuevo: false, motivo: 'sin conexión' })
  })
})
