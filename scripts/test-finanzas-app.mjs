// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-finanzas-app.mjs
// Resumen de /finanzas leyendo la app de Finanzas (lib/finanzasApp.ts, pedido de Tomás del 1/11/2026 «pasa todo a la app»):
// conversión de las filas de Neon a las estructuras del cálculo, «quién recibió» (Tomi y Gero = mitad y mitad), respaldo de
// los comprobantes, caché/deduplicación/último valor bueno y la carga del estimado de Meta del cierre. Neon falso, sin red.
// Datos inventados: ningún cliente, monto ni correo real.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const A = await import('../lib/finanzasApp.ts')
const C = await import('../lib/finanzasCalc.ts')
const K = await import('../lib/finanzasCierre.ts')

const pago = (id, fecha, monto, quien = null, extra = {}) => ({
  id, fecha, cliente: `Cliente ${id}`, monto_usd: monto, closer: 'Closer Uno', setter: null, concepto: 'Fee', fuente: 'Inbound IG',
  tipo_venta: 'Front-end', tipo_pago: 'Upfront', cat_cash: null, comision: 0, pesos_ars: null, quien, ...extra,
})
const gasto = (id, fecha, monto, tipo, cuenta = null, extra = {}) => ({ id, fecha, concepto: `Gasto ${id}`, monto_usd: monto, tipo, cuenta, id_origen: null, ...extra })
const equipo = (id, mes, nombre, base, extra = {}) => ({
  id, mes, nombre, puesto: 'Puesto', honorarios_base: base, bonuses: 0, comision: 0, total_usd: base, pagado: true, pagado_por: 'Financiera', ...extra,
})
const entrada = (app, extra = {}) => ({
  mes: '2026-10', hoy: '2026-10-31', registro: [], gastos: [], payroll: [], er: [], anioPlanillas: 2026, metaSpend: {}, mep: [], app, ...extra,
})

describe('pagosDesdeApp: quién recibió', () => {
  test('Tomi, Gero y Financiera tal cual; Empresa → Relay; sin fila → sin dato', () => {
    const ps = A.pagosDesdeApp([
      pago(1, '2026-10-01', 100, 'Tomi'), pago(2, '2026-10-02', 200, 'Gero'), pago(3, '2026-10-03', 300, 'Financiera'),
      pago(4, '2026-10-04', 400, 'Empresa'), pago(5, '2026-10-05', 500, null),
    ])
    assert.deepEqual(ps.map(p => p.cuenta), ['Tomi', 'Gero', 'Financiera', 'Relay', 'sin dato'])
    assert.deepEqual(ps.map(p => p.fuenteCuenta), ['app', 'app', 'app', 'app', null])
    assert.equal(ps[0].ref, 'Pago #1')
    assert.equal(ps[0].montoEsNumero, true)
  })
  test('«Tomi y Gero» = efectivo mitad y mitad (sin perder centavos)', () => {
    const [p] = A.pagosDesdeApp([pago(9, '2026-10-09', 100.01, 'Tomi y Gero')])
    assert.deepEqual(p.partes, [{ cuenta: 'Tomi', monto: 50.01 }, { cuenta: 'Gero', monto: 50 }])
    assert.equal(Math.round(p.partes.reduce((s, x) => s + x.monto, 0) * 100) / 100, 100.01)
  })
  test('montos como texto de Postgres, pesos y categoría FECCU/FECCP/BECC', () => {
    const [a, b] = A.pagosDesdeApp([
      pago(1, '2026-10-01', '1500.50', 'Tomi', { pesos_ars: '2000000', tipo_pago: 'Payment Plan' }),
      pago(2, '2026-10-02', '700', 'Gero', { tipo_venta: 'Back-end', comision: '12.5' }),
    ])
    assert.equal(a.monto, 1500.5); assert.equal(a.ars, 2000000); assert.equal(a.categoria, 'FECCP')
    assert.equal(b.categoria, 'BECC'); assert.equal(b.comisionPlataforma, 12.5); assert.equal(b.ars, null)
  })
  test('filas sin fecha válida se descartan', () => {
    assert.equal(A.pagosDesdeApp([pago(1, null, 10), pago(2, '2026-10-01', 10)]).length, 1)
  })
})

describe('gastosDesdeApp y payrollDesdeApp', () => {
  test('cuenta vacía = Relay (empresa); ARQ = otro; "Anuncios FM" = Anuncios; monto 0 no entra', () => {
    const gs = A.gastosDesdeApp([
      gasto(1, '2026-10-01', 10, 'Software'), gasto(2, '2026-10-02', 20, 'Anuncios FM', 'Relay'),
      gasto(3, '2026-10-03', 30, 'Otros', 'ARQ'), gasto(4, '2026-10-04', 0, 'Software'),
      gasto(5, '2026-10-05', 5, 'Software', null, { id_origen: 'gastos-fila-9' }),
    ])
    assert.deepEqual(gs.map(g => [g.cat, g.pagador]), [['Software', 'Empresa'], ['Anuncios', 'Empresa'], ['Otros', 'otro'], ['Software', 'Empresa']])
    assert.deepEqual(gs.map(g => g.web), [true, true, true, false])
    assert.equal(gs[0].ref, 'Gasto #1')
  })
  test('payroll por mes; Financiera = empresa; total = base + bonus + comisión (o total_usd si están en 0)', () => {
    const m = A.payrollDesdeApp([
      equipo(1, '2026-09', 'Persona Uno', 100), equipo(2, '2026-10', 'Persona Dos', 200, { bonuses: 50, pagado_por: 'Tomi' }),
      equipo(3, '2026-10', 'Persona Tres', 0, { total_usd: 70, pagado_por: null, pagado: false }),
    ])
    assert.deepEqual([...m.keys()], ['2026-09', '2026-10'])
    assert.deepEqual(m.get('2026-10').map(f => [f.total, f.pagador, f.pagado]), [[250, 'Tomi', true], [70, 'sin dato', false]])
    assert.equal(m.get('2026-09')[0].pagador, 'Empresa')
  })
})

describe('calcularFinanzas con datos de la app', () => {
  const app = () => ({
    pagos: A.pagosDesdeApp([
      pago(1, '2026-10-01', 1000, 'Tomi'), pago(2, '2026-10-02', 600, 'Tomi y Gero'),
      pago(3, '2026-10-03', 400, 'Empresa'), pago(4, '2026-10-04', 300, null),
    ]),
    gastos: A.gastosDesdeApp([gasto(1, '2026-10-05', 100, 'Software'), gasto(2, '2026-10-06', 50, 'Otros', 'Tomi')]),
    payroll: A.payrollDesdeApp([equipo(1, '2026-10', 'Persona Uno', 500, { bonuses: 100 }), equipo(2, '2026-10', 'Persona Dos', 200, { pagado_por: 'Gero' })]),
  })
  test('cash, cuentas (con la mitad de Tomi y Gero), Staff y reparto salen de la app', () => {
    const f = C.calcularFinanzas(entrada(app()))
    assert.equal(f.entradas.cash, 2300)
    assert.deepEqual(f.entradas.porCuenta, { Tomi: 1300, Gero: 300, Relay: 400, Financiera: 0, 'sin dato': 300, otra: 0 })
    assert.equal(f.entradas.fuenteCuenta, 'app')
    assert.equal(f.gastos.categorias.find(c => c.categoria === 'Staff').monto, 800)
    assert.deepEqual(f.reparto.gastos, { Tomi: 50, Gero: 200 })
    assert.equal(f.comisiones.aPagar, 230)   // 10% del closer
  })
  test('"A revisar" apunta a la app (Pago #id) y pide cargar «quién recibió»', () => {
    const f = C.calcularFinanzas(entrada(app()))
    const sin = f.revisar.find(r => r.texto.includes('quién recibió'))
    assert.ok(sin, 'avisa los pagos sin quién recibió')
    assert.match(sin.texto, /Pago #4/)
    assert.equal(sin.monto, 300)
    assert.ok(f.reparto.detalleGastos.some(x => x.origen === 'Gasto #2'))
  })
  test('los comprobantes solo completan pagos SIN asignación en la app (y no se modifican los datos de entrada)', () => {
    const datos = app()
    const comprobantes = [['2026-10-04', 'Cliente 4', 300, 'Gero', 'alta'], ['2026-10-01', 'Cliente 1', 1000, 'Relay', 'alta']]
    const f = C.calcularFinanzas(entrada(datos, { comprobantes }))
    assert.equal(f.entradas.porCuenta.Gero, 600)      // 300 de la mitad + 300 del comprobante
    assert.equal(f.entradas.porCuenta.Tomi, 1300)     // el comprobante del pago 1 NO pisa la asignación de la app
    assert.equal(f.entradas.porCuenta['sin dato'], 0)
    assert.equal(datos.pagos[3].cuenta, 'sin dato')
  })
  test('sin `app` el cálculo sigue leyendo la planilla (referencias "Registro fila N")', () => {
    const registro = [['', '', 'Nombre del cliente', '', 'Efectivo recaudado'], [46296, '', 'Cliente X', '', -50]]
    const f = C.calcularFinanzas(entrada(undefined, { registro, mes: '2026-10' }))
    assert.equal(f.entradas.cash, -50)
    assert.ok(f.revisar.some(r => r.fila === 'Registro fila 2'))
  })
})

describe('leerApp: caché, deduplicación y último valor bueno', () => {
  beforeEach(() => A.olvidarCacheApp(true))
  const respuesta = () => [[pago(1, '2026-10-01', 10, 'Tomi')], [gasto(1, '2026-10-01', 5, 'Software')], [equipo(1, '2026-10', 'Persona Uno', 1)]]
  test('una sola lectura (3 consultas en una transacción) para pedidos concurrentes y dentro de los 60 s', async () => {
    let llamadas = 0, consultas
    const ej = async (qs) => { llamadas++; consultas = qs; return respuesta() }
    const [a, b] = await Promise.all([A.leerApp(ej), A.leerApp(ej)])
    await A.leerApp(ej)
    assert.equal(llamadas, 1)
    assert.equal(consultas.length, 3)
    assert.match(consultas[0].texto, /pagos_vigentes.*pago_quien_recibio/s)
    assert.ok(consultas.every(q => !/set local role/.test(q.texto)))
    assert.equal(a, b)
    assert.equal(a.data.pagos[0].cuenta, 'Tomi')
  })
  test('si falla después de una lectura buena: último valor bueno con aviso; si nunca leyó: error (→ planilla)', async () => {
    await assert.rejects(A.leerApp(async () => { throw new Error('sin conexión') }), /sin conexión/)
    await A.leerApp(async () => respuesta())
    A.olvidarCacheApp()
    const r = await A.leerApp(async () => { throw new Error('sin conexión') })
    assert.equal(r.data.pagos.length, 1)
    assert.match(r.avisos[0], /últimos datos/)
  })
})

describe('cierre de mes: estimado de Meta en la app', () => {
  const gs = (...xs) => A.gastosDesdeApp(xs)
  test('plan: anuncios reales → nada; mismo estimado → nada; otro monto → actualizar; importado → nada; sin nada → agregar', () => {
    const est = K.conceptoEstimadoMeta('2026-10-30')
    assert.equal(K.planAnunciosMetaApp(gs(gasto(1, '2026-10-10', 90, 'Anuncios')), '2026-10', '2026-10-30', 100).accion, 'nada')
    assert.equal(K.planAnunciosMetaApp(gs(gasto(2, '2026-10-31', 100, 'Anuncios', null, { concepto: est })), '2026-10', '2026-10-30', 100.2).accion, 'nada')
    assert.deepEqual(K.planAnunciosMetaApp(gs(gasto(3, '2026-10-31', 80, 'Anuncios', null, { concepto: est })), '2026-10', '2026-10-30', 100),
      { accion: 'actualizar', id: 3, montoAnterior: 80, monto: 100 })
    assert.equal(K.planAnunciosMetaApp(gs(gasto(4, '2026-10-31', 80, 'Anuncios', null, { concepto: est, id_origen: 'gastos-fila-3' })), '2026-10', '2026-10-30', 100).accion, 'nada')
    assert.deepEqual(K.planAnunciosMetaApp(gs(gasto(5, '2026-10-02', 10, 'Software')), '2026-10', '2026-10-30', 123.456),
      { accion: 'agregar', fecha: '2026-10-31', concepto: est, monto: 123.46 })
    assert.equal(K.planAnunciosMetaApp([], '2026-10', '2026-10-30', 0).accion, 'nada')
  })
  test('el gasto simulado entra en el cálculo como Anuncios estimado', () => {
    const plan = K.planAnunciosMetaApp([], '2026-10', '2026-10-30', 100)
    const conPlan = K.gastosAppConPlan([], plan)
    const f = C.calcularFinanzas(entrada({ pagos: [], gastos: conPlan, payroll: new Map() }))
    assert.equal(f.gastos.categorias.find(c => c.categoria === 'Anuncios').monto, 100)
    assert.equal(f.gastos.anunciosEstimado, true)
  })
  test('consultas: firma del cierre en la misma transacción, insert sin duplicar (fecha + concepto + monto), update solo de filas web', () => {
    const [firma, ins] = A.consultasEstimadoApp({ accion: 'agregar', fecha: '2026-10-31', concepto: 'ADS (x)', monto: 100 })
    assert.equal(firma.texto, "select set_config('request.jwt.claims', $1, true)")
    assert.deepEqual(JSON.parse(firma.params[0]), { email: 'cierre@finanzas.despacho' })
    assert.match(ins.texto, /insert into finanzas\.gastos \(fecha, concepto, monto_usd, tipo\)/)
    assert.match(ins.texto, /where not exists \(select 1 from finanzas\.gastos where fecha = \$1::date and concepto = \$2::text and monto_usd = \$3::numeric\)/)
    assert.doesNotMatch(ins.texto, /id_origen/)   // fila web: id_origen queda null
    assert.deepEqual(ins.params, ['2026-10-31', 'ADS (x)', 100])
    const [, upd] = A.consultasEstimadoApp({ accion: 'actualizar', id: 7, monto: 50 })
    assert.match(upd.texto, /where id = \$1 and id_origen is null/)
  })
  test('cargarEstimadoMetaEnApp: id nuevo, duplicado (no insertó) y update que no encontró la fila', async () => {
    assert.deepEqual(await A.cargarEstimadoMetaEnApp({ accion: 'agregar', fecha: '2026-10-31', concepto: 'c', monto: 1 }, async () => [[], [{ id: '41' }]]), { id: 41, duplicado: false })
    assert.deepEqual(await A.cargarEstimadoMetaEnApp({ accion: 'agregar', fecha: '2026-10-31', concepto: 'c', monto: 1 }, async () => [[], []]), { id: null, duplicado: true })
    await assert.rejects(A.cargarEstimadoMetaEnApp({ accion: 'actualizar', id: 7, monto: 1 }, async () => [[], []]), /no se encontró/)
  })
})
