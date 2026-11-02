// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-portal-reporte.mjs
// Portal del cliente (2/11/2026): barra de casos, cálculos del reporte de anuncios y lectura de Meta SOLO de las cuentas del
// portal. Sin red: cuentas, tokens y cifras inventados.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { barraCasos, casosDelMes, validarDatosPortal } from '../lib/clientes/portal/modelo.ts'
import { armarReporte, calcularMetricas, tipoCampana, usd } from '../lib/clientes/portal/reporte.ts'
import { leerAnunciosPortal, usarFetchMetaDePrueba } from '../lib/clientes/portal/meta.ts'

describe('validar casos y reporte', () => {
  test('casos, meta, hito y el conteo entra al historial (uno por fecha, ordenado)', () => {
    const r = validarDatosPortal({ progreso: { casos: 70, actualizado: '2026-11-02', meta: 500, hito: { casos: 200, fecha: '2026-11-30' }, historial: [{ fecha: '2026-11-02', casos: 60 }, { fecha: '2026-10-01', casos: 40 }] } })
    assert.equal(r.ok, true)
    assert.deepEqual(r.datos.progreso.historial, [{ fecha: '2026-10-01', casos: 40 }, { fecha: '2026-11-02', casos: 70 }])
    assert.deepEqual(r.datos.progreso.hito, { casos: 200, fecha: '2026-11-30' })
  })
  test('rechaza casos negativos, decimales, hito mayor que la meta y fechas falsas', () => {
    for (const progreso of [{ casos: -1 }, { casos: 1.5 }, { casos: 10, meta: 0 }, { meta: 100, hito: { casos: 200 } }, { casos: 1, actualizado: '2026-02-30' }, { historial: [{ fecha: 'x', casos: 1 }] }])
      assert.equal(validarDatosPortal({ progreso }).ok, false, JSON.stringify(progreso))
  })
  test('sin datos nuevos (portal viejo): casos vacíos y valor por caso 2000; secciones nuevas ocultas', () => {
    const r = validarDatosPortal({ nombre: 'X' })
    assert.equal(r.datos.progreso.casos, null)
    assert.deepEqual(r.datos.reporte, { cuentas: [], valorCaso: 2000 })
    assert.equal(r.datos.secciones.reporte, false)
    assert.equal(validarDatosPortal({ secciones: { reporte: true } }).datos.secciones.reporte, true)
  })
  test('cuentas: solo act_ + dígitos (sin rutas ni parámetros), sin repetidas, vacías ignoradas, hasta 5', () => {
    assert.deepEqual(validarDatosPortal({ reporte: { cuentas: ['123456789', 'act_123456789', ' '] } }).datos.reporte.cuentas, ['act_123456789'])
    for (const c of ['act_1/../me', 'act_123?fields=x', 'me', 'act_12', 'act_12345&access_token=x', 7])
      assert.equal(validarDatosPortal({ reporte: { cuentas: [c] } }).ok, false, String(c))
    assert.equal(validarDatosPortal({ reporte: { cuentas: ['act_100001', 'act_100002', 'act_100003', 'act_100004', 'act_100005', 'act_100006'] } }).ok, false)
    assert.equal(validarDatosPortal({ reporte: { valorCaso: 0 } }).ok, false)
    assert.equal(validarDatosPortal({ reporte: { valorCaso: -5 } }).ok, false)
  })
})

describe('barra de casos', () => {
  test('70 de 500 con marca en 200', () => {
    const b = barraCasos({ casos: 70, meta: 500, actualizado: '2026-11-02', hito: { casos: 200, fecha: '2026-11-30' }, historial: [] })
    assert.equal(b.porcentaje, 14)
    assert.equal(b.faltan, 430)
    assert.deepEqual({ ...b.hito }, { casos: 200, fecha: '2026-11-30', porcentaje: 40, logrado: false, faltan: 130 })
  })
  test('pasada la meta: tope 100 % y hito logrado; sin casos o sin meta: null', () => {
    const b = barraCasos({ casos: 600, meta: 500, actualizado: null, hito: { casos: 200, fecha: null }, historial: [] })
    assert.equal(b.porcentaje, 100)
    assert.equal(b.hito.logrado, true)
    assert.equal(b.faltan, 0)
    assert.equal(barraCasos({ casos: null, meta: 500, actualizado: null, hito: null, historial: [] }), null)
    assert.equal(barraCasos({ casos: 3, meta: null, actualizado: null, hito: null, historial: [] }), null)
  })
  test('casos del mes: cierre del mes menos el conteo anterior; sin conteo previo, null', () => {
    const h = [{ fecha: '2026-09-30', casos: 30 }, { fecha: '2026-10-15', casos: 45 }, { fecha: '2026-10-31', casos: 55 }, { fecha: '2026-11-02', casos: 70 }]
    assert.equal(casosDelMes(h, '2026-10'), 25)
    assert.equal(casosDelMes(h, '2026-11'), 15)
    assert.equal(casosDelMes(h, '2026-09'), null)
    assert.equal(casosDelMes(h, '2026-12'), null)
    assert.equal(casosDelMes([], '2026-11'), null)
  })
})

describe('cálculos del reporte', () => {
  const filas = [
    { mes: '2026-10', campana: '[DM][ABO][ARG]', gasto: 1000, mensajes: 400 },
    { mes: '2026-10', campana: 'FM ADS 10/4/26', gasto: 250, mensajes: 3 },
    { mes: '2026-11', campana: '[DM][ABO][ARG]', gasto: 250, mensajes: 100 },
  ]
  test('Follow Me Ads por nombre (FM / Follow / Seguidores); DM el resto', () => {
    for (const n of ['FM ADS 10/4/26', '[FM] Masterclass', 'Follow me', 'Campaña seguidores']) assert.equal(tipoCampana(n), 'seguidores', n)
    for (const n of ['[DM][ABO][ARG]', 'FMA laboral', 'Formulario', '[ABO][ARGENTINA] - 20/09 [TRAFICO IG]']) assert.equal(tipoCampana(n), 'mensajes', n)
  })
  test('costo por mensaje (solo DM), costo por caso (inversión total), ingresos, profit y retorno', () => {
    const m = calcularMetricas(filas, 10, 2000)
    assert.equal(m.inversion, 1500)
    assert.equal(m.inversionSeguidores, 250)
    assert.equal(m.mensajes, 500)
    assert.equal(m.costoMensaje, 2.5)
    assert.equal(m.costoCaso, 150)
    assert.equal(m.ingresos, 20000)
    assert.equal(m.profit, 18500)
    assert.equal(m.retorno, 13.3)
  })
  test('divisiones por cero y faltantes: null, nunca Infinity ni NaN', () => {
    const vacio = calcularMetricas([], 0, 2000)
    assert.equal(vacio.costoMensaje, null)
    assert.equal(vacio.costoCaso, null)
    assert.equal(vacio.retorno, null)
    assert.equal(vacio.profit, 0)
    const sinCasos = calcularMetricas(filas, null, 2000)
    assert.equal(sinCasos.costoCaso, null)
    assert.equal(sinCasos.ingresos, null)
    assert.equal(sinCasos.profit, null)
    const soloFm = calcularMetricas([filas[1]], 0, 2000)
    assert.equal(soloFm.costoMensaje, null)
    assert.equal(soloFm.profit, -250)
    const raro = calcularMetricas([{ mes: '2026-10', campana: 'x', gasto: NaN, mensajes: -3 }], 1, 2000)
    assert.equal(raro.inversion, 0)
    assert.equal(raro.mensajes, 0)
    for (const v of Object.values(raro)) if (typeof v === 'number') assert.ok(Number.isFinite(v))
  })
  test('armarReporte: acumulado con los casos totales; el mes, con los del historial', () => {
    const r = armarReporte(filas, { casos: 70, historial: [{ fecha: '2026-10-31', casos: 60 }, { fecha: '2026-11-02', casos: 70 }], valorCaso: 2000, mesActual: '2026-11' })
    assert.equal(r.desde, '2026-10')
    assert.equal(r.acumulado.costoCaso, Math.round((1500 / 70) * 100) / 100)
    assert.equal(r.mesActual.casos, 10)
    assert.equal(r.mesActual.costoCaso, 25)
    assert.deepEqual(r.porMes.map(m => m.mes), ['2026-11', '2026-10'])
    assert.equal(r.porMes[1].casos, null)
    assert.equal(r.porcentajeSeguidores, 17)
  })
  test('mes actual sin inversión: ceros y «—» (no rompe)', () => {
    const r = armarReporte([], { casos: 70, historial: [], valorCaso: 2000, mesActual: '2026-12' })
    assert.equal(r.desde, null)
    assert.equal(r.mesActual.inversion, 0)
    assert.equal(r.mesActual.costoMensaje, null)
    assert.equal(r.porcentajeSeguidores, null)
    assert.equal(usd(null), '—')
    assert.equal(usd(-250), '−USD 250')
  })
})

describe('Meta: solo las cuentas del portal, solo lectura', () => {
  const pedidos = []
  beforeEach(() => { pedidos.length = 0; process.env.META_ANUNCIOS_TOKEN = 'tok-falso-1'; delete process.env.META_CLIENTES_TOKEN })
  afterEach(() => { usarFetchMetaDePrueba(null); delete process.env.META_ANUNCIOS_TOKEN; delete process.env.META_CLIENTES_TOKEN })
  const graph = (porCuenta) => async (url) => {
    pedidos.push(url)
    const u = new URL(url)
    const cuenta = u.pathname.split('/')[2]
    const r = porCuenta[cuenta]
    if (!r) return { json: async () => ({ error: { message: 'no existe', code: 100 } }) }
    if (u.pathname.endsWith('/insights')) return { json: async () => ({ data: r.data }) }
    return { json: async () => ({ currency: r.moneda ?? 'USD' }) }
  }
  test('pide solo las cuentas guardadas (y válidas), con GET y sin otras rutas', async () => {
    usarFetchMetaDePrueba(graph({ act_111111: { data: [{ date_start: '2026-10-01', campaign_name: '[DM]', spend: '100.5', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '40' }, { action_type: 'like', value: '9' }] }] } }))
    const r = await leerAnunciosPortal(['act_111111', 'act_1/../me'])
    assert.deepEqual(r.filas, [{ mes: '2026-10', campana: '[DM]', gasto: 100.5, mensajes: 40 }])
    assert.ok(pedidos.length > 0)
    for (const p of pedidos) assert.match(new URL(p).pathname, /^\/v23\.0\/act_111111(\/insights)?$/)
  })
  test('una cuenta en otra moneda no se suma (aviso para el equipo, sin token en el texto)', async () => {
    usarFetchMetaDePrueba(graph({ act_111111: { data: [] }, act_222222: { moneda: 'ARS', data: [{ date_start: '2026-10-01', spend: '999999' }] } }))
    const r = await leerAnunciosPortal(['act_111111', 'act_222222'])
    assert.equal(r.filas.length, 0)
    assert.equal(r.errores.length, 1)
    assert.match(r.errores[0], /ARS/)
    assert.doesNotMatch(r.errores[0], /tok-falso/)
  })
  test('si no se puede leer ninguna, lanza (así la caché no guarda un vacío); sin cuentas, vacío sin pedir nada', async () => {
    usarFetchMetaDePrueba(graph({}))
    await assert.rejects(() => leerAnunciosPortal(['act_333333']))
    pedidos.length = 0
    assert.deepEqual(await leerAnunciosPortal([]), { filas: [], leidas: 0, errores: [] })
    assert.equal(pedidos.length, 0)
  })
})
