// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs --test scripts/test-controles-clientes.mjs
// Controles de cumplimiento del cliente (11/11/2026, lib/clientes/controles): reglas puras (Meta, entregas, capturas, textos,
// resumen), la corrida con dependencias de juguete (idempotencia, dry, pausa, alertas a 🛠️ con Gero M y el aviso «para
// enviar» j01), la migración idempotente, la ruta y los crons. SIN red ni base: fetch bloqueado. Datos inventados (Z001).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
delete process.env.CONTROLES_CLIENTES

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const R = await import('../lib/clientes/controles/reglas.ts')
const S = await import('../lib/clientes/controles/servidor.ts')
const DB = await import('../lib/clientes/controles/db.ts')
const P = await import('../lib/alertas/personas.ts')
const RUTAS = await import('../lib/auth/rutas.ts')

const HOY = '2026-11-11'   // miércoles
const cfg = (extra = {}) => {
  const r = R.normalizarConfig({ idCrm: 'z001', cliente: 'Cliente Ejemplo', cuentaMeta: '123456789', presupuestoDiarioUsd: 12, carpetaCliente: 'carpetaCliente0000000001', desde: '2026-11-01', ...extra }, HOY)
  assert.ok(r.ok, r.motivo)
  return r.config
}
const cuentaOk = (extra = {}) => ({ estado: 1, motivoBaja: 0, entrega: 'activa', medioPago: true, moneda: 'USD', textoEstado: 'activa', ...extra })
const ERRORES = [2, 3, 7, 8]

test('config: valida, completa los valores por defecto (contrato v4) y nunca inventa ids', () => {
  const c = cfg()
  assert.equal(c.idCrm, 'Z001')
  assert.equal(c.cuentaMeta, 'act_123456789')
  assert.deepEqual(c.plazos, { revisionHabiles: 2, crudosCorridos: 5, capturasHoras: 24, correccionCorridos: 3, periodoDias: 30 })
  assert.deepEqual(c.clausulas, { pago: '5.b y 7.3 a)', gasto: '4.b y 7.3 b)', guiones: '5.d', crudos: '5.e', capturas: '5.g' })
  assert.equal(c.carpetaCapturas, null)
  assert.equal(R.normalizarConfig({ idCrm: 'xx', cliente: 'A' }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: '' }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: 'A', cuentaMeta: 'abc' }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: 'A', presupuestoDiarioUsd: -1 }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: 'A', carpetaCliente: '../x' }, HOY).ok, false)
  const sinDesde = R.normalizarConfig({ idCrm: 'Z001', cliente: 'A' }, HOY)
  assert.equal(sinDesde.ok && sinDesde.config.desde, HOY)
  const otras = cfg({ plazos: { revisionHabiles: 3, capturasHoras: 999 }, clausulas: { pago: '7.3 a)' } })
  assert.equal(otras.plazos.revisionHabiles, 3)
  assert.equal(otras.plazos.capturasHoras, 24, 'fuera de rango → por defecto')
  assert.equal(otras.clausulas.pago, '7.3 a)')
})

test('interruptor: CONTROLES_CLIENTES apagado por defecto; solo «encendido» lo prende', () => {
  assert.equal(R.controlesEncendidos({}), false)
  assert.equal(R.controlesEncendidos({ CONTROLES_CLIENTES: 'real' }), false)
  assert.equal(R.controlesEncendidos({ CONTROLES_CLIENTES: ' Encendido ' }), true)
})

test('modos: solo pago y gasto del período son aviso automático; entregas y capturas a verificar; el resto interno', () => {
  assert.deepEqual(Object.entries(R.MODO_TIPO).filter(([, m]) => m === 'aviso').map(([t]) => t).sort(), ['meta_pago', 'periodo_gasto'])
  assert.deepEqual(Object.entries(R.MODO_TIPO).filter(([, m]) => m === 'verificar').map(([t]) => t).sort(), ['capturas_faltantes', 'crudos_sin_subir', 'guiones_sin_revision'])
  assert.deepEqual(Object.entries(R.MODO_TIPO).filter(([, m]) => m === 'interna').map(([t]) => t).sort(), ['meta_gasto_bajo', 'meta_pausada'])
})

test('Meta: error de pago o falta de fondos = incumplimiento (5.b y 7.3 a), gana sobre pausa y gasto', () => {
  const c = cfg()
  const r = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ estado: 3, textoEstado: 'error de pago: deuda' }), gasto: 0, usdPor: 1, erroresPago: ERRORES })
  assert.equal(r.hallazgo.tipo, 'meta_pago')
  assert.equal(r.hallazgo.clausula, '5.b y 7.3 a)')
  assert.equal(R.modoDe(r.hallazgo), 'aviso')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ medioPago: false }), gasto: 15, usdPor: 1, erroresPago: ERRORES }).hallazgo.tipo, 'meta_pago')
})

test('Meta: pausa o sin entrega SIN error de pago → solo alerta interna', () => {
  const c = cfg()
  const a = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ entrega: 'sin_activos' }), gasto: 20, usdPor: 1, erroresPago: ERRORES }).hallazgo
  assert.equal(a.tipo, 'meta_pausada')
  assert.equal(R.modoDe(a), 'interna')
  assert.equal(a.falta, '')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk(), gasto: 0, usdPor: 1, erroresPago: ERRORES }).hallazgo.tipo, 'meta_pausada')
})

test('Meta: gasto diario bajo (USD o convertido desde ARS) → solo alerta interna', () => {
  const c = cfg()
  const bajo = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk(), gasto: 11.5, usdPor: 1, erroresPago: ERRORES })
  assert.equal(bajo.hallazgo.tipo, 'meta_gasto_bajo')
  assert.equal(R.modoDe(bajo.hallazgo), 'interna')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk(), gasto: 12, usdPor: 1, erroresPago: ERRORES }).hallazgo, null)
  const ars = cuentaOk({ moneda: 'ARS' })
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: ars, gasto: 18_000, usdPor: 1_500, erroresPago: ERRORES }).hallazgo, null, 'ARS 18.000 / 1.500 = USD 12')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: ars, gasto: 15_000, usdPor: 1_500, erroresPago: ERRORES }).hallazgo.tipo, 'meta_gasto_bajo')
  const sinFx = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: ars, gasto: 15_000, usdPor: null, erroresPago: ERRORES })
  assert.equal(sinFx.hallazgo, null)
  assert.equal(sinFx.avisos.length, 1)
})

test('Meta: antes de «desde», sin cuenta configurada o sin respuesta de Meta no hay hallazgo', () => {
  assert.equal(R.evaluarMeta({ config: cfg({ desde: '2026-11-11' }), dia: '2026-11-10', cuenta: cuentaOk(), gasto: 0, usdPor: 1, erroresPago: ERRORES }).hallazgo, null)
  assert.equal(R.evaluarMeta({ config: cfg({ cuentaMeta: null }), dia: '2026-11-10', cuenta: cuentaOk(), gasto: 0, usdPor: 1, erroresPago: ERRORES }).hallazgo, null)
  const sin = R.evaluarMeta({ config: cfg(), dia: '2026-11-10', cuenta: null, gasto: null, usdPor: null, erroresPago: ERRORES })
  assert.equal(sin.hallazgo, null)
  assert.equal(sin.avisos.length, 1)
})

test('Período Mensual: 30 días corridos desde «desde»', () => {
  const c = cfg({ desde: '2026-11-05' })
  assert.deepEqual(R.periodoDe(c, '2026-11-05'), { numero: 1, inicio: '2026-11-05', fin: '2026-12-04' })
  assert.deepEqual(R.periodoDe(c, '2026-12-04'), { numero: 1, inicio: '2026-11-05', fin: '2026-12-04' })
  assert.deepEqual(R.periodoDe(c, '2026-12-05'), { numero: 2, inicio: '2026-12-05', fin: '2027-01-03' })
  assert.equal(R.periodoDe(c, '2026-11-04'), null)
})

const dias = (desde, n, g) => Object.fromEntries(Array.from({ length: n }, (_, i) => { const d = new Date(`${desde}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return [d.toISOString().slice(0, 10), g] }))

test('gasto del período (4.b y 7.3 b): al cierre, acumulado < presupuesto × días; en el 1.º, desde el primer gasto', () => {
  const c = cfg({ desde: '2026-11-05' })
  const p1 = R.periodoDe(c, '2026-11-05')
  // Lanzó el 15/11 (producción inicial antes): 20 días × 12 = 240
  const ok = R.evaluarPeriodo({ config: c, periodo: p1, gastos: dias('2026-11-15', 20, 12), moneda: 'USD', usdPor: 1 })
  assert.equal(ok.hallazgo, null)
  const bajo = R.evaluarPeriodo({ config: c, periodo: p1, gastos: { ...dias('2026-11-15', 20, 12), '2026-11-20': 0 }, moneda: 'USD', usdPor: 1 })
  assert.equal(bajo.hallazgo.tipo, 'periodo_gasto')
  assert.equal(bajo.hallazgo.ref, 'p1')
  assert.equal(bajo.hallazgo.fecha, '2026-12-04')
  assert.equal(bajo.hallazgo.clausula, '4.b y 7.3 b)')
  assert.match(bajo.hallazgo.falta, /USD 228,00, por debajo de los USD 240,00/)
  assert.equal(R.modoDe(bajo.hallazgo), 'aviso')
  // Sin gasto en todo el 1.º período: no se acusa, se avisa al equipo
  const nada = R.evaluarPeriodo({ config: c, periodo: p1, gastos: {}, moneda: 'USD', usdPor: 1 })
  assert.equal(nada.hallazgo, null)
  assert.equal(nada.avisos.length, 1)
  // 2.º período: cuentan los 30 días
  const p2 = R.periodoDe(c, '2026-12-05')
  assert.equal(R.evaluarPeriodo({ config: c, periodo: p2, gastos: dias('2026-12-10', 25, 12), moneda: 'USD', usdPor: 1 }).hallazgo.tipo, 'periodo_gasto')
  // Un día alto compensa uno bajo: el control es del período, no del día
  assert.equal(R.evaluarPeriodo({ config: c, periodo: p2, gastos: { ...dias('2026-12-05', 30, 12), '2026-12-06': 6, '2026-12-07': 18 }, moneda: 'USD', usdPor: 1 }).hallazgo, null)
})

// Guiones enviados el jueves 5/11 a las 15:00 (AR): 2 hábiles → lunes 9/11; crudos: 5 corridos desde la aprobación → 14/11
const tanda = (extra = {}) => ({ id: 7, tanda: 1, estado: 'enviada', envio: '2026-11-05T18:00:00.000Z', notas: [], ...extra })

test('entregas (a verificar): 2 días hábiles sin revisión (5.d) y 5 corridos desde la aprobación sin crudos (5.e)', () => {
  const c = cfg()
  const xs = R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda()], crudos: [] })
  assert.deepEqual(xs.map((x) => [x.tipo, x.fecha, x.ref, x.clausula]), [['guiones_sin_revision', '2026-11-09', 't7', '5.d']])
  assert.equal(R.modoDe(xs[0]), 'verificar')
  const tarde = R.evaluarEntregas({ config: c, hoy: '2026-11-15', tandas: [tanda()], crudos: [] })
  assert.deepEqual(tarde.map((x) => [x.tipo, x.fecha, x.clausula]), [['guiones_sin_revision', '2026-11-09', '5.d'], ['crudos_sin_subir', '2026-11-14', '5.e']])
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-09', tandas: [tanda()], crudos: [] }).length, 0, 'el lunes 9/11 todavía está en plazo')
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-10', tandas: [tanda()], crudos: [], esHabil: (d) => !['2026-11-06', '2026-11-07', '2026-11-08'].includes(d) })[0], undefined, 'feriado: el plazo corre')
})

test('entregas: una nota del cliente o un crudo nuevo cuentan como revisión; otros estados no se controlan', () => {
  const c = cfg()
  const conNota = R.evaluarEntregas({ config: c, hoy: '2026-11-15', tandas: [tanda({ notas: [{ cuando: '2026-11-06T12:00:00Z' }] })], crudos: [] })
  assert.deepEqual(conNota.map((x) => x.tipo), ['crudos_sin_subir'])
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-15', tandas: [tanda({ notas: [{ cuando: '2026-11-01T12:00:00Z' }] })], crudos: [] }).length, 2, 'una nota anterior al envío no es revisión')
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-15', tandas: [tanda()], crudos: [{ creado: '2026-11-08T12:00:00Z' }] }).length, 0)
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-15', tandas: [tanda()], crudos: [{ creado: '2026-11-04T12:00:00Z' }] }).length, 2, 'un crudo anterior al envío no cuenta')
  for (const estado of ['aprobada', 'con_notas', 'corrigiendo', 'cerrada']) assert.equal(R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda({ estado })], crudos: [] }).length, 0, estado)
  assert.equal(R.evaluarEntregas({ config: cfg({ desde: '2026-11-06' }), hoy: HOY, tandas: [tanda()], crudos: [] }).length, 0, 'envío anterior a «desde»')
})

test('capturas (a verificar, 5.g): el día con campaña tiene plazo hasta 24 h después de su fin', () => {
  const c = cfg()
  const vence9 = Date.parse('2026-11-11T03:00:00Z')
  assert.equal(R.evaluarCapturas({ config: c, ahora: vence9 - 1, dias: ['2026-11-09'], archivos: [] }).length, 0, 'todavía en plazo')
  const xs = R.evaluarCapturas({ config: c, ahora: vence9, dias: ['2026-11-09'], archivos: [] })
  assert.deepEqual(xs.map((x) => [x.tipo, x.fecha, x.clausula]), [['capturas_faltantes', '2026-11-09', '5.g']])
  assert.equal(R.modoDe(xs[0]), 'verificar')
  assert.equal(R.evaluarCapturas({ config: c, ahora: vence9, dias: ['2026-11-09'], archivos: [{ creado: '2026-11-10T22:00:00Z' }] }).length, 0, 'subida al día siguiente: en plazo')
  assert.equal(R.evaluarCapturas({ config: c, ahora: vence9, dias: ['2026-11-09'], archivos: [{ creado: '2026-11-11T04:00:00Z' }] }).length, 1, 'fuera de plazo')
  assert.equal(R.evaluarCapturas({ config: cfg({ desde: '2026-11-10' }), ahora: vence9, dias: ['2026-11-09'], archivos: [] }).length, 0)
  assert.deepEqual(R.diasActivos({ '2026-11-09': 10, '2026-11-08': 0, '2026-11-07': 3 }), ['2026-11-07', '2026-11-09'])
})

test('aviso al cliente: formal con voseo, corto, con fecha, cláusula(s), qué faltó y 3 días corridos (7.3)', () => {
  const c = cfg()
  const [i] = R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda()], crudos: [] })
  const t = R.textoAviso(i, c, HOY)
  assert.match(t, /^Hola, Cliente\./)
  assert.match(t, /El 09\/11 no recibimos tus observaciones ni tu aprobación de los guiones que te enviamos el 05\/11/)
  assert.match(t, /según la cláusula 5\.d del contrato/)
  assert.match(t, /Tenés 3 días corridos para subsanarlo \(hasta el 14\/11\)/)
  assert.ok(t.length < 500, 'corto')
  assert.ok(!/anticipo|usted|ustedes/i.test(t))
  assert.equal(t.split('\n').length, 3)
  const pago = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ estado: 3, textoEstado: 'x' }), gasto: 0, usdPor: 1, erroresPago: ERRORES }).hallazgo
  assert.match(R.textoAviso(pago, c, HOY), /según las cláusulas 5\.b y 7\.3 a\) del contrato/)
})

test('resumen semanal: semana cerrada y acumulado del período contra lo esperado (con lo manual)', () => {
  assert.deepEqual(R.semanaAnterior('2026-11-16'), { desde: '2026-11-09', hasta: '2026-11-15' })
  assert.deepEqual(R.semanaAnterior('2026-11-11'), { desde: '2026-11-02', hasta: '2026-11-08' })
  const ls = R.lineasResumen({
    config: cfg(), desde: '2026-11-09', hasta: '2026-11-15',
    incumplimientos: [{ tipo: 'meta_pago', fecha: '2026-11-10', estado: 'enviado' }, { tipo: 'capturas_faltantes', fecha: '2026-11-11', estado: 'a_verificar' }],
    gastos: { '2026-11-09': 12, '2026-11-10': 9, '2026-11-11': 12 },
    periodo: { numero: 1, inicio: '2026-11-05', fin: '2026-12-04', hasta: '2026-11-15', gastoUsd: 33, esperado: 84 }, conCapturas: 2,
  })
  assert.equal(ls.length, 6)
  assert.match(ls[0], /: 2 .*1 a verificar/)
  assert.match(ls[1], /3 de 7/)
  assert.match(ls[2], /Período 1 \(05\/11 al 04\/12\), al 15\/11: USD 33,00 de USD 84,00 esperados/)
  assert.match(ls[3], /2 de 3 días con campaña/)
  assert.match(ls[4], /carga manual/)
  assert.match(ls[5], /12 h: chequeo manual/)
})

// ── La corrida con dependencias de juguete ───────────────────────────────────────────────────────────────────────────
function juguete(extra = {}) {
  const registrados = new Map()
  const alertas = []
  const creadas = []
  const d = {
    ahora: () => new Date('2026-11-11T13:00:00Z'),   // 10:00 AR
    configs: async () => [cfg()],
    pausado: async () => false,
    cuenta: async () => cuentaOk(),
    gastos: async () => ({ '2026-11-08': 12, '2026-11-09': 12, '2026-11-10': 8 }),
    usdPor: async () => 1,
    erroresPago: ERRORES,
    tandas: async () => [tanda()],
    crudos: async () => [],
    carpetaCapturas: async (c, crear) => { if (crear) creadas.push(c.idCrm); return 'carpetaCapturas000000001' },
    archivos: async () => [{ creado: '2026-11-10T15:00:00Z' }],   // cubre el 9 (y el 10); faltan las del 8
    registrar: async (h, clave, texto, modo) => {
      if (registrados.has(clave)) return { nuevo: false, mensajeId: null }
      registrados.set(clave, { h, texto, modo })
      return { nuevo: true, mensajeId: modo === 'aviso' ? registrados.size : null }
    },
    anotarAlerta: async () => undefined,
    incumplimientos: async () => [...registrados.values()].map(({ h, modo }) => ({ tipo: h.tipo, fecha: h.fecha, estado: modo === 'aviso' ? 'para_enviar' : 'a_verificar' })),
    alertar: async (a) => { alertas.push(a); return { estado: 'enviado' } },
    ...extra,
  }
  return { d, registrados, alertas, creadas }
}

test('corrida: gasto diario bajo = interna; capturas y guiones = a verificar sin aviso; todo una sola vez', async () => {
  const j = juguete()
  const r = await S.correrControles(j.d)
  assert.equal(r.fecha, HOY)
  const hs = r.clientes[0].hallazgos.map((x) => `${x.tipo}:${x.modo}:${x.fecha}`).sort()
  assert.deepEqual(hs, ['capturas_faltantes:verificar:2026-11-08', 'guiones_sin_revision:verificar:2026-11-09', 'meta_gasto_bajo:interna:2026-11-10'])
  assert.equal(j.registrados.size, 2, 'la interna no se registra como incumplimiento')
  for (const { modo } of j.registrados.values()) assert.equal(modo, 'verificar')
  const interna = j.alertas.find((a) => a.tipo === 'controles_meta_gasto_bajo')
  assert.match(interna.titulo, /Alerta interna/)
  assert.equal(interna.copiar, undefined, 'la interna no trae texto para el cliente')
  const verif = j.alertas.filter((a) => /^controles_(capturas|guiones)/.test(a.tipo))
  assert.equal(verif.length, 2)
  for (const a of verif) {
    assert.equal(a.canal, 'operaciones')
    assert.deepEqual(a.menciones, ['gero_m'])
    assert.match(a.titulo, /^A verificar/)
    assert.equal(a.copiar, undefined, 'sin aviso al cliente hasta «Es incumplimiento»')
    assert.equal(a.link, '/clientes/controles?cliente=Z001')
  }
  assert.deepEqual(j.creadas, ['Z001'], 'la carpeta Capturas se busca o se crea')
  const antes = j.alertas.length
  const r2 = await S.correrControles(j.d)
  assert.ok(r2.clientes[0].hallazgos.filter((x) => x.modo !== 'interna').every((x) => !x.nuevo))
  assert.equal(j.alertas.filter((a) => a.tipo !== 'controles_meta_gasto_bajo').length, antes - 1, 'nada nuevo (la interna se deduplica en lib/alertas por su clave)')
})

test('corrida: error de pago = aviso automático con texto para pegar y link a Para enviar', async () => {
  const j = juguete({ cuenta: async () => cuentaOk({ estado: 3, textoEstado: 'error de pago' }), tandas: async () => [] })
  await S.correrControles(j.d)
  const a = j.alertas.find((x) => x.tipo === 'controles_meta_pago')
  assert.match(a.titulo, /^Incumplimiento \(cláusula 5\.b y 7\.3 a\)\)/)
  assert.match(a.copiar, /Tenés 3 días corridos para subsanarlo/)
  assert.match(a.link, /^\/clientes\/para-enviar#m-\d+$/)
  assert.equal([...j.registrados.values()].find((x) => x.h.tipo === 'meta_pago').modo, 'aviso')
})

test('corrida: el día después del cierre del Período Mensual controla el gasto del período', async () => {
  const leidos = []
  const j = juguete({
    ahora: () => new Date('2026-12-05T13:00:00Z'), configs: async () => [cfg({ desde: '2026-11-05' })], tandas: async () => [],
    gastos: async (_, desde, hasta) => { leidos.push([desde, hasta]); return { ...dias('2026-11-15', 20, 10) } },
    archivos: async () => [{ creado: '2026-12-01T15:00:00Z' }, { creado: '2026-11-29T15:00:00Z' }, { creado: '2026-12-03T15:00:00Z' }],
  })
  await S.correrControles(j.d)
  assert.deepEqual(leidos[0], ['2026-11-05', '2026-12-04'], 'lee el período entero')
  const p = [...j.registrados.values()].find((x) => x.h.tipo === 'periodo_gasto')
  assert.equal(p.modo, 'aviso')
  assert.equal(p.h.ref, 'p1')
  assert.match(p.texto, /USD 200,00, por debajo de los USD 240,00/)
  // Al otro día no se vuelve a controlar el período
  const j2 = juguete({ ahora: () => new Date('2026-12-06T13:00:00Z'), configs: async () => [cfg({ desde: '2026-11-05' })], tandas: async () => [], gastos: async () => ({ ...dias('2026-11-15', 20, 10) }) })
  await S.correrControles(j2.d)
  assert.ok(![...j2.registrados.values()].some((x) => x.h.tipo === 'periodo_gasto'))
})

test('corrida: ?dry=1 no registra, no crea carpetas ni avisa', async () => {
  const j = juguete()
  const r = await S.correrControles(j.d, { dry: true })
  assert.equal(r.clientes[0].hallazgos.length, 3)
  assert.equal(j.registrados.size, 0)
  assert.equal(j.alertas.length, 0)
  assert.deepEqual(j.creadas, [])
})

test('corrida: cliente en pausa no se controla; Meta caído no acusa y avisa en 🧰', async () => {
  const p = juguete({ pausado: async () => true })
  const r = await S.correrControles(p.d)
  assert.equal(r.clientes[0].saltado, 'cliente en pausa en el Despacho')
  assert.equal(p.alertas.length, 0)
  const caido = juguete({ cuenta: async () => { throw new Error('Meta limitado') }, gastos: async () => null, tandas: async () => [] })
  const r2 = await S.correrControles(caido.d)
  assert.equal(r2.clientes[0].hallazgos.length, 0)
  const sis = caido.alertas.filter((a) => a.canal === 'sistema')
  assert.equal(sis.length, 1)
  assert.ok(!JSON.stringify(sis).includes('access_token'))
})

test('resumen de los lunes: una alerta por cliente en 🛠️ con la semana y el acumulado del período', async () => {
  const j = juguete({
    ahora: () => new Date('2026-11-16T13:00:00Z'), configs: async () => [cfg({ desde: '2026-11-05' })],
    gastos: async () => ({ '2026-11-08': 12, '2026-11-09': 12, '2026-11-10': 12 }), archivos: async () => [{ creado: '2026-11-09T15:00:00Z' }],
  })
  const r = await S.correrResumenSemanal(j.d)
  assert.deepEqual([r.desde, r.hasta], ['2026-11-09', '2026-11-15'])
  assert.equal(j.alertas.length, 1)
  const a = j.alertas[0]
  assert.equal(a.canal, 'operaciones')
  assert.equal(a.clave, 'controles:semanal:Z001:2026-11-09')
  assert.match(a.lineas[1], /2 de 7/)
  // Primer gasto el 8/11 → 8 días hasta el 15/11 × 12 = 96 esperados; acumulado 36
  assert.match(a.lineas[2], /Período 1 \(05\/11 al 04\/12\), al 15\/11: USD 36,00 de USD 96,00 esperados/)
  assert.match(a.lineas[3], /1 de 2 días con campaña/)
  assert.equal(j.creadas.length, 0, 'el resumen no crea carpetas')
})

test('migración: idempotente (todo IF NOT EXISTS) y sin datos de clientes', () => {
  for (const s of DB.SENTENCIAS_CONTROLES) assert.match(s, /IF NOT EXISTS/, s.slice(0, 60))
  assert.ok(DB.SENTENCIAS_CONTROLES.some((s) => /cj_controles_cliente/.test(s)))
  assert.ok(DB.SENTENCIAS_CONTROLES.some((s) => /cj_controles_incumplimientos[\s\S]*clave text NOT NULL UNIQUE/.test(s)))
  assert.ok(DB.SENTENCIAS_CONTROLES.some((s) => /ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'aviso'/.test(s)))
})

test('pieza j01 «Aviso de incumplimiento»: grupo General, responsable Gero M', () => {
  assert.ok(P.PIEZAS_CLIENTE.includes('j01'))
  assert.equal(P.NOMBRE_PIEZA.j01, 'Aviso de incumplimiento')
  assert.equal(P.GRUPO_PIEZA.j01, 'General')
  assert.deepEqual(P.responsablesDe('j01', {}), ['gero_m'])
})

test('ruta y crons: máquina con CRON_SECRET, 10:00 AR todos los días y lunes', () => {
  const regla = RUTAS.resolverRegla('/api/clientes/controles').regla
  assert.equal(regla.patron, '/api/clientes/controles')
  assert.equal(regla.quien, 'propio')
  const ruta = readFileSync(join(RAIZ, 'app', 'api', 'clientes', 'controles', 'route.ts'), 'utf8')
  assert.equal((ruta.match(/if \(!accesoMaquina\(req\.headers\)\)/g) ?? []).length, 2, 'GET y POST exigen el Bearer')
  const crons = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons
  assert.ok(crons.some((c) => c.path === '/api/clientes/controles' && c.schedule === '0 13 * * *'))
  assert.ok(crons.some((c) => c.path === '/api/clientes/controles?semanal=1' && c.schedule === '0 13 * * 1'))
  // «Es incumplimiento» / «No corresponde»: sesión de Clientes, mismo origen (pasa por el proxy)
  assert.equal(RUTAS.resolverRegla('/api/clientes/controles/12').regla.patron, '/api/clientes/*')
  const verif = readFileSync(join(RAIZ, 'app', 'api', 'clientes', 'controles', '[id]', 'route.ts'), 'utf8')
  assert.match(verif, /exigirAccesoApi\(req, 'clientes'\)/)
  assert.match(verif, /mismoOrigen\(req\.headers\)/)
})

test('repo público: el código de controles no trae ids de clientes, webhooks ni tokens', () => {
  for (const f of ['reglas.ts', 'db.ts', 'servidor.ts', 'reales.ts']) {
    const t = readFileSync(join(RAIZ, 'lib', 'clientes', 'controles', f), 'utf8')
    assert.ok(!/discord(app)?\.com\/api\/webhooks/i.test(t), f)
    assert.ok(!/A184|Caraballo|Freddy/i.test(t), f)
    assert.ok(!/act_\d{6,}/.test(t), f)
  }
})
