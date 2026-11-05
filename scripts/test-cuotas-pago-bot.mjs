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
  test('PIF tras Fee (5/11/2026): el "PIF" también va al tablero; sin plan con saldo queda sin_plan', () => {
    assert.equal(T.aplicaAlTablero('PIF'), true)
    assert.equal(T.aplicaAlTablero('2da Cuota'), true)
    assert.equal(T.aplicaAlTablero('1ra Cuota'), false)
    assert.equal(T.aplicaAlTablero('Fee'), false)
    const r = T.pagoAlTablero([reg(leandro())], { fecha: '2026-11-04', nombre: 'Leandro Arabia', telefono: '543515121372', usd: 825, concepto: 'PIF' }, AHORA)
    assert.equal(r.accion, 'registrado')
    assert.equal(T.pagoAlTablero([], { fecha: '2026-11-05', nombre: 'Patricia Marimon', telefono: '+51975537200', usd: 2400, concepto: 'PIF' }, AHORA).accion, 'sin_plan')
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
  test('un pago parecido cargado a mano no se duplica: se avisa para revisar (también con diferencia de cambio)', () => {
    const p = plan({ nombre: 'Tatiana Potochnik', telefono: '5491100000001', cuotas: [{ v: '2026-10-15', usd: 1200, pagos: [{ f: '2026-10-19', usd: 1200 }] }, { v: '2026-11-19', usd: 200 }] })
    assert.equal(T.pagoAlTablero([reg(p)], { fecha: '2026-10-20', nombre: 'Tatiana Potochnik', telefono: '5491100000001', usd: 1199, concepto: '2da Cuota' }, AHORA).accion, 'revisar')
    // Revisión del PR: el closer registró a mano 825 el 3/11 y el bot carga el mismo pago como 817,35 el 4/11
    const l = plan({ nombre: 'Leandro Arabia', telefono: '543515121372', cuotas: [{ v: '2026-11-10', usd: 825, pagos: [{ f: '2026-11-03', usd: 825 }] }, { v: '2026-12-10', usd: 825 }] })
    assert.equal(T.pagoAlTablero([reg(l)], { fecha: '2026-11-04', nombre: 'Leandro Arabia', telefono: '543515121372', usd: 817.35, concepto: '2da Cuota' }, AHORA).accion, 'revisar')
  })
  test('dos cuotas seguidas del mismo monto por el bot se registran las dos (no se confunden con un duplicado)', () => {
    const p = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-10-25', usd: 500 }, { v: '2026-11-25', usd: 500 }] })
    const r1 = T.pagoAlTablero([reg(p)], { fecha: '2026-11-01', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 500, concepto: '2da Cuota' }, AHORA)
    const r2 = T.pagoAlTablero([reg(r1.plan)], { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 500, concepto: '3ra Cuota' }, AHORA)
    assert.equal(r2.accion, 'registrado')
    assert.equal(pendiente(r2.plan), 0)
  })
  test('un plan sin teléfono con el mismo nombre no se toca si el pago trae otro teléfono: se avisa', () => {
    const p = plan({ nombre: 'Maria Lopez', telefono: '', cuotas: [{ v: '2026-11-01', usd: 500 }] })
    assert.equal(T.pagoAlTablero([reg(p)], { fecha: '2026-11-04', nombre: 'María López', telefono: '5491199999999', usd: 500, concepto: '2da Cuota' }, AHORA).accion, 'revisar')
  })
  test('la diferencia de cambio nunca acredita más que un resto chico de lo que entró', () => {
    const chico = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-11-01', usd: 500, pagos: [{ f: '2026-10-01', usd: 488 }] }] })
    const r = T.pagoAlTablero([reg(chico)], { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 3, concepto: '2da Cuota' }, AHORA)
    assert.equal(pendiente(r.plan), 9)
    const dos = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-11-01', usd: 500 }, { v: '2026-12-01', usd: 510 }] })
    const r2 = T.pagoAlTablero([reg(dos)], { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 1000, concepto: '2da Cuota' }, AHORA)
    assert.equal(pendiente(r2.plan), 10)
  })
  test('un pago del bot que quedó en un plan abandonado no cuenta como ya registrado: se avisa para revisar el plan nuevo', () => {
    const pago = { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 500, concepto: '2da Cuota' }
    const p = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-11-01', usd: 500 }] })
    const r1 = T.pagoAlTablero([reg(p)], pago, AHORA)
    const abandonado = { ...r1.plan, abandonado: true }
    const nuevo = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-11-01', usd: 500 }] })
    assert.equal(T.pagoAlTablero([reg(abandonado), reg(nuevo)], pago, AHORA).accion, 'revisar')
  })
  test('un pago del bot que después se anuló no se vuelve a registrar en silencio: se avisa', () => {
    const pago = { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 500, concepto: '2da Cuota' }
    const p = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-11-01', usd: 500 }, { v: '2026-12-01', usd: 500 }] })
    const r1 = T.pagoAlTablero([reg(p)], pago, AHORA)
    const pid = r1.plan.cuotas[0].pagos[0].id
    const anulado = M.modificarPlan(r1.plan, { tipo: 'anular', cuota: r1.plan.cuotas[0].id, pago: pid }, '00000000-0000-4000-8000-999999999999', 'x', AHORA)
    assert.equal(T.pagoAlTablero([reg(anulado)], pago, AHORA).accion, 'revisar')
  })
  test('el pago va a la cuota que vence primero, aunque tenga una promesa más adelante', () => {
    const p = plan({ nombre: 'Ana Pérez', telefono: '5491130001111', cuotas: [{ v: '2026-10-01', usd: 500 }, { v: '2026-11-01', usd: 500 }] })
    p.cuotas[0].promesa = '2026-12-15'
    const r = T.pagoAlTablero([reg(p)], { fecha: '2026-11-04', nombre: 'Ana Pérez', telefono: '5491130001111', usd: 500, concepto: '2da Cuota' }, AHORA)
    assert.equal(M.saldo(r.plan.cuotas[0]), 0)
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
    assert.equal(T.pagoAlTablero([reg(a)], { fecha: '2026-11-04', nombre: 'Maria Lopez', telefono: null, usd: 500, concepto: '2da Cuota' }, AHORA).accion, 'revisar')
    assert.equal(T.pagoAlTablero([reg(a)], { fecha: '2026-11-04', nombre: 'Otra Persona', telefono: '5491199999999', usd: 500, concepto: '2da Cuota' }, AHORA).accion, 'sin_plan')
  })
  test('planes abandonados o ya pagados no cuentan', () => {
    const ab = plan({ nombre: 'Lucas Ruarte', telefono: '5491100000009', abandonado: true, cuotas: [{ v: '2026-09-25', usd: 3500 }] })
    const pago = plan({ nombre: 'Gisela Videmato', telefono: '5491100000008', cuotas: [{ v: '2026-10-30', usd: 1000, pagos: [{ f: '2026-10-19', usd: 1000 }] }] })
    assert.equal(T.pagoAlTablero([reg(ab)], { fecha: '2026-11-04', nombre: 'Lucas Ruarte', telefono: '5491100000009', usd: 3500, concepto: '2da Cuota' }, AHORA).accion, 'sin_plan')
    assert.equal(T.pagoAlTablero([reg(pago)], { fecha: '2026-11-04', nombre: 'Gisela Videmato', telefono: '5491100000008', usd: 500, concepto: '3ra Cuota' }, AHORA).accion, 'sin_plan')
  })
})
