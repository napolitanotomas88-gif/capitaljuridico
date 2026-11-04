// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-cuotas-pago-bot.mjs
// Pago de cuota del bot → tablero de Cuotas (Tomás, 4/11/2026): lib/crm/cuotas/pagoBot.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const T = await import('../lib/crm/cuotas/pagoBot.ts')
const M = await import('../lib/crm/cuotas/modelo.ts')

const AHORA = new Date('2026-11-04T20:00:00Z')
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const plan = (o) => ({ id: id(), responsable: 'carlos@x', nombre: o.nombre, telefono: o.telefono ?? '', concepto: 'venta', notas: '', abandonado: !!o.abandonado, cuotas: o.cuotas.map((c) => ({ id: id(), vencimiento: c.v, centavos: c.usd * 100, concepto: 'cuota', pagos: (c.pagos ?? []).map((p) => ({ id: id(), centavos: p.usd * 100, fecha: p.f, creado: p.f, actor: 'x' })), gestiones: [] })), eventos: [] })
const reg = (p) => ({ plan: p, version: 1 })
const pendiente = (p) => p.cuotas.reduce((s, c) => s + M.porCobrar(c), 0) / 100
const leandro = () => plan({ nombre: 'Leandro Arabia', telefono: '+54 351 512-1372', cuotas: [{ v: '2026-10-08', usd: 825, pagos: [{ f: '2026-10-08', usd: 825 }] }, { v: '2026-11-10', usd: 825 }, { v: '2026-12-10', usd: 825 }, { v: '2027-01-10', usd: 825 }] })

describe('pago de cuota del bot → tablero de Cuotas', () => {
  test('solo cuotas que siguen a la 1ra', () => {
    assert.equal(T.esCuotaSiguiente('2da Cuota'), true)
    assert.equal(T.esCuotaSiguiente('Cuota 13'), true)
    assert.equal(T.esCuotaSiguiente('1ra Cuota'), false)
    assert.equal(T.esCuotaSiguiente('Fee'), false)
    assert.equal(T.esCuotaSiguiente('PIF'), false)
    assert.equal(T.pagoAlTablero([reg(leandro())], { fecha: '2026-11-04', nombre: 'Leandro Arabia', telefono: '543515121372', usd: 825, concepto: '1ra Cuota' }, AHORA).accion, 'no_aplica')
  })
  test('Leandro (4/11): 817,35 en pesos salda la 2da cuota de 825 por diferencia de cambio, sin resto de centavos', () => {
    const p = leandro()
    const r = T.pagoAlTablero([reg(p)], { fecha: '2026-11-04', nombre: 'Leandro Arabia', telefono: '543515121372', usd: 817.35, concepto: '2da Cuota' }, AHORA)
    assert.equal(r.accion, 'registrado')
    assert.equal(pendiente(r.plan), 1650)
    assert.equal(M.saldo(r.plan.cuotas[1]), 0)
    assert.ok(r.avisos.some((x) => x.startsWith('Diferencia de cambio')))
    assert.equal(pendiente(p), 2475, 'no modifica el plan original')
  })
  test('idempotente: el mismo pago otra vez no se registra dos veces', () => {
    const p = leandro()
    const pago = { fecha: '2026-11-04', nombre: 'Leandro Arabia', telefono: '543515121372', usd: 825, concepto: '2da Cuota' }
    const r1 = T.pagoAlTablero([reg(p)], pago, AHORA)
    const r2 = T.pagoAlTablero([reg(r1.plan)], pago, AHORA)
    assert.equal(r2.accion, 'ya_estaba')
    assert.equal(T.idOperacion(pago, 1), T.idOperacion(pago, 1))
    assert.ok(M.uuidValido(T.idOperacion(pago, 1)))
  })
  test('un pago que ya estaba registrado a mano (±2 USD, ±5 días) no se duplica', () => {
    const p = plan({ nombre: 'Tatiana Potochnik', telefono: '5491100000001', cuotas: [{ v: '2026-10-15', usd: 1200, pagos: [{ f: '2026-10-19', usd: 1200 }] }, { v: '2026-11-19', usd: 200 }] })
    assert.equal(T.pagoAlTablero([reg(p)], { fecha: '2026-10-20', nombre: 'Tatiana Potochnik', telefono: '5491100000001', usd: 1199, concepto: '2da Cuota' }, AHORA).accion, 'ya_estaba')
  })
  test('un pago grande cubre varias cuotas en orden y avisa lo que sobra', () => {
    const p = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-12-01', usd: 500 }, { v: '2026-11-01', usd: 500 }] })
    const r = T.pagoAlTablero([reg(p)], { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 1200, concepto: '2da Cuota' }, AHORA)
    assert.equal(r.accion, 'registrado')
    assert.equal(pendiente(r.plan), 0)
    assert.ok(r.avisos.some((x) => x.startsWith('Sobraron USD 200.00')))
  })
  test('un pago parcial deja el resto pendiente en la misma cuota', () => {
    const p = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-11-01', usd: 1000 }] })
    const r = T.pagoAlTablero([reg(p)], { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 600, concepto: '2da Cuota' }, AHORA)
    assert.equal(pendiente(r.plan), 400)
  })
  test('homónimos: con teléfono en los dos lados manda el teléfono; sin plan o con dos planes no se toca nada', () => {
    const a = plan({ nombre: 'Maria Lopez', telefono: '5491100000001', cuotas: [{ v: '2026-11-01', usd: 500 }] })
    const b = plan({ nombre: 'Maria Lopez', telefono: '5491100000002', cuotas: [{ v: '2026-11-01', usd: 500 }] })
    const r = T.pagoAlTablero([reg(a), reg(b)], { fecha: '2026-11-04', nombre: 'Maria Lopez', telefono: '5491100000002', usd: 500, concepto: '2da Cuota' }, AHORA)
    assert.equal(r.accion, 'registrado'); assert.equal(r.planId, b.id)
    assert.equal(T.pagoAlTablero([reg(a), reg(b)], { fecha: '2026-11-04', nombre: 'Maria Lopez', telefono: null, usd: 500, concepto: '2da Cuota' }, AHORA).accion, 'ambiguo')
    assert.equal(T.pagoAlTablero([reg(a)], { fecha: '2026-11-04', nombre: 'Otra Persona', telefono: '5491199999999', usd: 500, concepto: '2da Cuota' }, AHORA).accion, 'sin_plan')
  })
  test('planes abandonados o ya pagados no cuentan', () => {
    const ab = plan({ nombre: 'Lucas Ruarte', telefono: '5491100000009', abandonado: true, cuotas: [{ v: '2026-09-25', usd: 3500 }] })
    const pago = plan({ nombre: 'Gisela Videmato', telefono: '5491100000008', cuotas: [{ v: '2026-10-30', usd: 1000, pagos: [{ f: '2026-10-19', usd: 1000 }] }] })
    assert.equal(T.pagoAlTablero([reg(ab)], { fecha: '2026-11-04', nombre: 'Lucas Ruarte', telefono: '5491100000009', usd: 3500, concepto: '2da Cuota' }, AHORA).accion, 'sin_plan')
    assert.equal(T.pagoAlTablero([reg(pago)], { fecha: '2026-11-04', nombre: 'Gisela Videmato', telefono: '5491100000008', usd: 500, concepto: '3ra Cuota' }, AHORA).accion, 'sin_plan')
  })
})
