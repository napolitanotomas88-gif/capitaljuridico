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

test('config: valida, completa los valores por defecto y nunca inventa ids', () => {
  const c = cfg()
  assert.equal(c.idCrm, 'Z001')
  assert.equal(c.cuentaMeta, 'act_123456789')
  assert.deepEqual(c.plazos, { revisionHabiles: 2, crudosCorridos: 5, capturasHoras: 24, correccionCorridos: 3 })
  assert.deepEqual(c.clausulas, { meta: '7.3', guiones: '5', crudos: '5', capturas: '5' })
  assert.equal(c.carpetaCapturas, null)
  assert.equal(R.normalizarConfig({ idCrm: 'xx', cliente: 'A' }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: '' }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: 'A', cuentaMeta: 'abc' }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: 'A', presupuestoDiarioUsd: -1 }, HOY).ok, false)
  assert.equal(R.normalizarConfig({ idCrm: 'Z001', cliente: 'A', carpetaCliente: '../x' }, HOY).ok, false)
  const sinDesde = R.normalizarConfig({ idCrm: 'Z001', cliente: 'A' }, HOY)
  assert.equal(sinDesde.ok && sinDesde.config.desde, HOY)
  const otras = cfg({ plazos: { revisionHabiles: 3, capturasHoras: 999 }, clausulas: { meta: '7.3 b' } })
  assert.equal(otras.plazos.revisionHabiles, 3)
  assert.equal(otras.plazos.capturasHoras, 24, 'fuera de rango → por defecto')
  assert.equal(otras.clausulas.meta, '7.3 b')
})

test('interruptor: CONTROLES_CLIENTES apagado por defecto; solo «encendido» lo prende', () => {
  assert.equal(R.controlesEncendidos({}), false)
  assert.equal(R.controlesEncendidos({ CONTROLES_CLIENTES: 'real' }), false)
  assert.equal(R.controlesEncendidos({ CONTROLES_CLIENTES: ' Encendido ' }), true)
})

test('Meta: error de pago gana sobre pausa y gasto; sin medio de pago también es pago', () => {
  const c = cfg()
  const r = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ estado: 3, textoEstado: 'error de pago: deuda' }), gasto: 0, usdPor: 1, erroresPago: ERRORES })
  assert.equal(r.incumplimiento.tipo, 'meta_pago')
  assert.equal(r.incumplimiento.clausula, '7.3')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ medioPago: false }), gasto: 15, usdPor: 1, erroresPago: ERRORES }).incumplimiento.tipo, 'meta_pago')
})

test('Meta: sin anuncios activos o sin gasto → campaña sin entrega', () => {
  const c = cfg()
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk({ entrega: 'sin_activos' }), gasto: 20, usdPor: 1, erroresPago: ERRORES }).incumplimiento.tipo, 'meta_pausada')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk(), gasto: 0, usdPor: 1, erroresPago: ERRORES }).incumplimiento.tipo, 'meta_pausada')
})

test('Meta: gasto por debajo del presupuesto en USD y convertido desde ARS', () => {
  const c = cfg()
  const bajo = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk(), gasto: 11.5, usdPor: 1, erroresPago: ERRORES })
  assert.equal(bajo.incumplimiento.tipo, 'meta_gasto_bajo')
  assert.match(bajo.incumplimiento.falta, /USD 11,50.*USD 12,00/)
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: cuentaOk(), gasto: 12, usdPor: 1, erroresPago: ERRORES }).incumplimiento, null)
  const ars = cuentaOk({ moneda: 'ARS' })
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: ars, gasto: 18_000, usdPor: 1_500, erroresPago: ERRORES }).incumplimiento, null, 'ARS 18.000 / 1.500 = USD 12')
  assert.equal(R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: ars, gasto: 15_000, usdPor: 1_500, erroresPago: ERRORES }).incumplimiento.tipo, 'meta_gasto_bajo')
  const sinFx = R.evaluarMeta({ config: c, dia: '2026-11-10', cuenta: ars, gasto: 15_000, usdPor: null, erroresPago: ERRORES })
  assert.equal(sinFx.incumplimiento, null, 'sin cotización no se acusa: se avisa al equipo')
  assert.equal(sinFx.avisos.length, 1)
})

test('Meta: antes de «desde», sin cuenta configurada o sin respuesta de Meta no hay incumplimiento', () => {
  assert.equal(R.evaluarMeta({ config: cfg({ desde: '2026-11-11' }), dia: '2026-11-10', cuenta: cuentaOk(), gasto: 0, usdPor: 1, erroresPago: ERRORES }).incumplimiento, null)
  assert.equal(R.evaluarMeta({ config: cfg({ cuentaMeta: null }), dia: '2026-11-10', cuenta: cuentaOk(), gasto: 0, usdPor: 1, erroresPago: ERRORES }).incumplimiento, null)
  const sin = R.evaluarMeta({ config: cfg(), dia: '2026-11-10', cuenta: null, gasto: null, usdPor: null, erroresPago: ERRORES })
  assert.equal(sin.incumplimiento, null)
  assert.equal(sin.avisos.length, 1)
})

// Guiones enviados el jueves 5/11 a las 15:00 (AR): 2 hábiles → lunes 9/11; 5 corridos → martes 10/11
const tanda = (extra = {}) => ({ id: 7, tanda: 1, estado: 'enviada', envio: '2026-11-05T18:00:00.000Z', notas: [], ...extra })

test('entregas: 2 días hábiles sin revisión y 5 corridos sin crudos', () => {
  const c = cfg()
  const xs = R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda()], crudos: [] })
  assert.deepEqual(xs.map((x) => [x.tipo, x.fecha, x.ref]), [['guiones_sin_revision', '2026-11-09', 't7'], ['crudos_sin_subir', '2026-11-10', 't7']])
  // El lunes 9/11 todavía está en plazo de revisión
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-09', tandas: [tanda()], crudos: [] }).length, 0)
  // Feriado: si el viernes 6 lo fuera, el plazo corre al martes 10
  assert.equal(R.evaluarEntregas({ config: c, hoy: '2026-11-10', tandas: [tanda()], crudos: [], esHabil: (d) => !['2026-11-06', '2026-11-07', '2026-11-08'].includes(d) })[0], undefined)
})

test('entregas: una nota del cliente o un crudo nuevo cuentan como revisión; otros estados no se controlan', () => {
  const c = cfg()
  const conNota = R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda({ notas: [{ cuando: '2026-11-06T12:00:00Z' }] })], crudos: [] })
  assert.deepEqual(conNota.map((x) => x.tipo), ['crudos_sin_subir'])
  const notaVieja = R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda({ notas: [{ cuando: '2026-11-01T12:00:00Z' }] })], crudos: [] })
  assert.equal(notaVieja.length, 2, 'una nota anterior al envío no es revisión')
  assert.equal(R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda()], crudos: [{ creado: '2026-11-08T12:00:00Z' }] }).length, 0)
  assert.equal(R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda()], crudos: [{ creado: '2026-11-04T12:00:00Z' }] }).length, 2, 'un crudo anterior al envío no cuenta')
  for (const estado of ['aprobada', 'con_notas', 'corrigiendo', 'cerrada']) assert.equal(R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda({ estado })], crudos: [] }).length, 0, estado)
  assert.equal(R.evaluarEntregas({ config: cfg({ desde: '2026-11-06' }), hoy: HOY, tandas: [tanda()], crudos: [] }).length, 0, 'envío anterior a «desde»')
})

test('capturas: el día con campaña tiene plazo hasta 24 h después de su fin', () => {
  const c = cfg()
  const vence9 = Date.parse('2026-11-11T03:00:00Z')   // fin del 10/11 AR + 24 h
  assert.equal(R.evaluarCapturas({ config: c, ahora: vence9 - 1, dias: ['2026-11-09'], archivos: [] }).length, 0, 'todavía en plazo')
  const xs = R.evaluarCapturas({ config: c, ahora: vence9, dias: ['2026-11-09'], archivos: [] })
  assert.deepEqual(xs.map((x) => [x.tipo, x.fecha, x.clausula]), [['capturas_faltantes', '2026-11-09', '5']])
  assert.equal(R.evaluarCapturas({ config: c, ahora: vence9, dias: ['2026-11-09'], archivos: [{ creado: '2026-11-10T22:00:00Z' }] }).length, 0, 'subida al día siguiente: en plazo')
  assert.equal(R.evaluarCapturas({ config: c, ahora: vence9, dias: ['2026-11-09'], archivos: [{ creado: '2026-11-11T04:00:00Z' }] }).length, 1, 'fuera de plazo')
  assert.equal(R.evaluarCapturas({ config: cfg({ desde: '2026-11-10' }), ahora: vence9, dias: ['2026-11-09'], archivos: [] }).length, 0)
  assert.deepEqual(R.diasActivos({ '2026-11-09': 10, '2026-11-08': 0, '2026-11-07': 3 }), ['2026-11-07', '2026-11-09'])
})

test('aviso al cliente: formal con voseo, corto, con fecha, cláusula, qué faltó y 3 días corridos', () => {
  const c = cfg()
  const [i] = R.evaluarEntregas({ config: c, hoy: HOY, tandas: [tanda()], crudos: [] })
  const t = R.textoAviso(i, c, HOY)
  assert.match(t, /^Hola, Cliente\./)
  assert.match(t, /El 09\/11 los guiones que te enviamos el 05\/11/)
  assert.match(t, /cláusula 5 del contrato/)
  assert.match(t, /Tenés 3 días corridos para corregirlo \(hasta el 14\/11\)/)
  assert.ok(t.length < 500, 'corto')
  assert.ok(!/anticipo|usted|ustedes/i.test(t))
  assert.equal(t.split('\n').length, 3)
})

test('resumen semanal: semana cerrada lunes a domingo y las 6 viñetas (con lo manual)', () => {
  assert.deepEqual(R.semanaAnterior('2026-11-16'), { desde: '2026-11-09', hasta: '2026-11-15' })
  assert.deepEqual(R.semanaAnterior('2026-11-11'), { desde: '2026-11-02', hasta: '2026-11-08' })
  const ls = R.lineasResumen({
    config: cfg(), desde: '2026-11-09', hasta: '2026-11-15',
    incumplimientos: [{ tipo: 'meta_gasto_bajo', fecha: '2026-11-10', estado: 'enviado' }, { tipo: 'capturas_faltantes', fecha: '2026-11-11', estado: 'para_enviar' }],
    gastos: { '2026-11-09': 12, '2026-11-10': 9, '2026-11-11': 12 }, gastoUsd: 33, conCapturas: 2,
  })
  assert.equal(ls.length, 6)
  assert.match(ls[0], /Incumplimientos: 2 .*1 aviso\(s\) sin marcar «Enviado»/)
  assert.match(ls[1], /3 de 7/)
  assert.match(ls[2], /USD 33,00 de USD 84,00/)
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
    registrar: async (i, clave, texto) => { if (registrados.has(clave)) return { nuevo: false, mensajeId: null }; registrados.set(clave, { i, texto }); return { nuevo: true, mensajeId: registrados.size } },
    anotarAlerta: async () => undefined,
    incumplimientos: async () => [...registrados.values()].map(({ i }) => ({ tipo: i.tipo, fecha: i.fecha, estado: 'para_enviar' })),
    alertar: async (a) => { alertas.push(a); return { estado: 'enviado' } },
    ...extra,
  }
  return { d, registrados, alertas, creadas }
}

test('corrida: registra cada incumplimiento una vez, con aviso para pegar y alerta en 🛠️ a Gero M', async () => {
  const j = juguete()
  const r = await S.correrControles(j.d)
  assert.equal(r.fecha, HOY)
  const tipos = r.clientes[0].incumplimientos.map((x) => `${x.tipo}:${x.fecha}`).sort()
  assert.deepEqual(tipos, ['capturas_faltantes:2026-11-08', 'crudos_sin_subir:2026-11-10', 'guiones_sin_revision:2026-11-09', 'meta_gasto_bajo:2026-11-10'])
  const incs = j.alertas.filter((a) => a.tipo.startsWith('controles_') && a.tipo !== 'controles_aviso')
  assert.equal(incs.length, 4)
  for (const a of incs) {
    assert.equal(a.canal, 'operaciones')
    assert.deepEqual(a.menciones, ['gero_m'])
    assert.match(a.copiar, /Tenés 3 días corridos/)
    assert.match(a.link, /^\/clientes\/para-enviar#m-\d+$/)
    assert.match(a.clave, /^controles:Z001:/)
  }
  assert.deepEqual(j.creadas, ['Z001'], 'la carpeta Capturas se busca o se crea')
  // Segunda corrida el mismo día: nada nuevo, ninguna alerta de incumplimiento
  const antes = j.alertas.length
  const r2 = await S.correrControles(j.d)
  assert.ok(r2.clientes[0].incumplimientos.every((x) => !x.nuevo))
  assert.equal(j.alertas.length, antes)
})

test('corrida: ?dry=1 no registra, no crea carpetas ni avisa', async () => {
  const j = juguete()
  const r = await S.correrControles(j.d, { dry: true })
  assert.equal(r.clientes[0].incumplimientos.length, 4)
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
  assert.equal(r2.clientes[0].incumplimientos.length, 0)
  const sis = caido.alertas.filter((a) => a.canal === 'sistema')
  assert.equal(sis.length, 1)
  assert.ok(!JSON.stringify(sis).includes('access_token'))
})

test('resumen de los lunes: una alerta por cliente en 🛠️ con la semana cerrada', async () => {
  const j = juguete({ ahora: () => new Date('2026-11-16T13:00:00Z'), gastos: async () => ({ '2026-11-09': 12, '2026-11-10': 12 }), archivos: async () => [{ creado: '2026-11-09T15:00:00Z' }] })
  const r = await S.correrResumenSemanal(j.d)
  assert.deepEqual([r.desde, r.hasta], ['2026-11-09', '2026-11-15'])
  assert.equal(j.alertas.length, 1)
  const a = j.alertas[0]
  assert.equal(a.canal, 'operaciones')
  assert.equal(a.clave, 'controles:semanal:Z001:2026-11-09')
  assert.match(a.lineas[1], /2 de 7/)
  assert.match(a.lineas[3], /1 de 2 días con campaña/)
  assert.equal(j.creadas.length, 0, 'el resumen no crea carpetas')
})

test('migración: idempotente (todo IF NOT EXISTS) y sin datos de clientes', () => {
  for (const s of DB.SENTENCIAS_CONTROLES) assert.match(s, /IF NOT EXISTS/, s.slice(0, 60))
  assert.ok(DB.SENTENCIAS_CONTROLES.some((s) => /cj_controles_cliente/.test(s)))
  assert.ok(DB.SENTENCIAS_CONTROLES.some((s) => /cj_controles_incumplimientos[\s\S]*clave text NOT NULL UNIQUE/.test(s)))
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
})

test('repo público: el código de controles no trae ids de clientes, webhooks ni tokens', () => {
  for (const f of ['reglas.ts', 'db.ts', 'servidor.ts', 'reales.ts']) {
    const t = readFileSync(join(RAIZ, 'lib', 'clientes', 'controles', f), 'utf8')
    assert.ok(!/discord(app)?\.com\/api\/webhooks/i.test(t), f)
    assert.ok(!/A184|Caraballo|Freddy/i.test(t), f)
    assert.ok(!/act_\d{6,}/.test(t), f)
  }
})
