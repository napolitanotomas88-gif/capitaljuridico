// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-seguimiento.mjs
// Bot C.J., etapa Anuncios: seguimiento de lanzamientos y optimizaciones (lib/bot/anuncios). SIN red, SIN base, SIN
// planilla y SIN Discord: tablero armado a mano, Meta y Neon falsos, fetch global bloqueado. Nombres e IDs inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['DISCORD_WEBHOOK_ANUNCIOS', 'DISCORD_ID_VALENTINO', 'DATABASE_URL', 'META_CLIENTES_TOKEN', 'META_ANUNCIOS_TOKEN', 'ANUNCIOS_SEGUIMIENTO']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const S = await import('../lib/bot/anuncios/seguimiento.ts')
const { seguimientoAnuncios, RESERVA_ENVIO_MS, PAUSA_ENTRE_AVISOS_MS } = await import('../lib/bot/anuncios/procesar.ts')
const registro = await import('../lib/bot/anuncios/registro.ts')
const { aEvento } = await import('../lib/bot/anuncios/metaDetalle.ts')

const V = '222222222222222222'
const HOY = '2026-10-24'
const lanz = (over = {}) => ({
  cuenta: 'act_1', campanaId: '900', campana: '[DM][ABO][BSAS][$300]', fecha: '2026-10-21', inicioCompetencia: '2026-10-21', anuncios: 3, dm: true,
  gasto: 40, mensajes: 20, dia: 4, cplUSD: 2, link: 'https://adsmanager.facebook.com/x', fechaOptimizacion: null, etapa: null, diasCompetencia: 0,
  pendienteRevision: true, diasDesdeRevision: 3, fechaRevision: null, ...over,
})
const fila = (lanzamientos, over = {}) => ({
  id: 'act_1', cliente: 'Laura Pérez', clienteCRM: 'Dra. Laura Pérez', cuenta: 'Estudio Pérez', moneda: 'USD', usdPor: 1, pausado: false,
  pago: { errorPago: false }, rama: { id: 'laboral', nombre: 'Laboral (despidos)', fuente: 'manual', tarea: null, umbral: { ok: 1.5, medio: 2.25 } },
  links: { ads: 'https://adsmanager.facebook.com/cuenta', portfolio: null }, lanzamientos, ...over,
})
const tablero = (filas, over = {}) => ({ hoy: HOY, filas, optimizacionesLeidas: true, ...over })
const detalle = (over = {}) => ({
  anuncios: [
    { id: 'a1', nombre: 'Despido en negro', conjunto: 's1', activo: true, creado: '2026-10-21' },
    { id: 'a2', nombre: 'Me echaron', conjunto: 's2', activo: true, creado: '2026-10-21' },
    { id: 'a3', nombre: 'Horas extra', conjunto: 's3', activo: true, creado: '2026-10-21' },
  ],
  metricas: { a1: { gasto: 12, mensajes: 20 }, a2: { gasto: 12, mensajes: 7 }, a3: { gasto: 12, mensajes: 2 } },
  eventos: [],
  ...over,
})
const ev = (over = {}) => ({ tipo: 'update_ad_set_run_status', objeto: 's3', nombre: 'Conjunto 3', quien: 'Valentino Zalazar', fecha: '2026-10-23T14:00', viejo: 1, nuevo: 7, ...over })
const pausaAnuncio = (over = {}) => ev({ tipo: 'update_ad_run_status', objeto: 'a3', viejo: 1, nuevo: 8, ...over })   // un anuncio pausado queda en 8 (datos reales)
const OP = { tanda: { desde: '2026-10-21', hasta: '2026-10-23' }, conPresupuesto: true }

describe('candidatos', () => {
  test('optimizar solo del día 4 al 7, pendiente y sin optimización', () => {
    for (const [dia, sale] of [[3, false], [4, true], [7, true], [8, false]]) {
      const c = S.candidatos(tablero([fila([lanz({ dia })])]))
      assert.equal(c.some(x => x.tipo === 'optimizar'), sale, `día ${dia}`)
    }
    assert.equal(S.candidatos(tablero([fila([lanz({ pendienteRevision: false })])])).length, 0)
    const [c] = S.candidatos(tablero([fila([lanz()])]))
    assert.equal(c.clave, 'optimizar:900:2026-10-21')
  })
  test('ganadores del día 7 al 10 de la optimización (solo si fue la del día 4 del ciclo)', () => {
    assert.equal(S.candidatos(tablero([fila([lanz({ fecha: '2026-09-01', fechaOptimizacion: '2026-10-15', etapa: 'ganador', diasCompetencia: 9, pendienteRevision: false })])])).length, 0, 'revisión semanal de DM')
    const l = d => lanz({ fecha: '2026-10-10', fechaOptimizacion: '2026-10-15', etapa: 'ganador', diasCompetencia: d, pendienteRevision: false })
    assert.equal(S.candidatos(tablero([fila([l(6)])])).length, 0)
    const [c] = S.candidatos(tablero([fila([l(9)])]))
    assert.equal(c.tipo, 'ganadores')
    assert.equal(c.desde, '2026-10-15')
    assert.equal(S.candidatos(tablero([fila([l(11)])])).length, 0)
  })
  test('optimizada desde el tablero (hoy o ayer) y la revisión final solo si es ≥ 5 días después', () => {
    const [o] = S.candidatos(tablero([fila([lanz({ fechaOptimizacion: '2026-10-23', pendienteRevision: false })])]))
    assert.equal(o.tipo, 'optimizada')
    assert.equal(o.subtipo, 'optimizacion')
    assert.equal(o.clave, 'optimizada:900:2026-10-23')
    assert.equal(S.candidatos(tablero([fila([lanz({ fecha: '2026-10-15', fechaOptimizacion: '2026-10-20', pendienteRevision: false })])])).length, 0, 'de hace 4 días ya no')
    assert.equal(S.candidatos(tablero([fila([lanz({ fecha: '2026-10-15', fechaOptimizacion: '2026-10-21', pendienteRevision: false })])])).length, 1, 'de hace 3 días sí (si no salió)')
    const [g] = S.candidatos(tablero([fila([lanz({ fecha: '2026-10-10', fechaOptimizacion: '2026-10-16', fechaRevision: '2026-10-24', pendienteRevision: false })])]))
    assert.equal(g.subtipo, 'ganadores')
    assert.equal(g.clave, 'ganadores-hecha:900:2026-10-24')
    // revisiones semanales de DM (a 2 o a 14 días de la optimización): no se le avisa al cliente
    assert.equal(S.candidatos(tablero([fila([lanz({ fechaOptimizacion: '2026-10-21', fechaRevision: '2026-10-23', pendienteRevision: false, dia: 9 })])])).length, 0)
    assert.equal(S.candidatos(tablero([fila([lanz({ fecha: '2026-09-25', fechaOptimizacion: '2026-10-10', fechaRevision: '2026-10-24', pendienteRevision: false, dia: 30 })])])).length, 0)
    // «Ya optimicé» de una revisión semanal (lejos del lanzamiento): no es "la del día 4"
    assert.equal(S.candidatos(tablero([fila([lanz({ fecha: '2026-10-01', fechaOptimizacion: '2026-10-23', pendienteRevision: false, dia: 24 })])])).filter(c => c.tipo === 'optimizada').length, 0)
  })
  test('lanzada: día 1 a 3 con gasto, una por campaña (se juntan al mandar); rotación; reactivada no', () => {
    const nueva = (id, over = {}) => lanz({ campanaId: id, fecha: '2026-10-23', inicioCompetencia: '2026-10-23', dia: 2, pendienteRevision: false, ...over })
    const cs = S.candidatos(tablero([fila([nueva('1'), nueva('2', { campana: 'Otra' }), nueva('3', { gasto: 0, mensajes: 0 })])]))
    assert.deepEqual(cs.map(c => c.clave), ['lanzada:1:2026-10-23', 'lanzada:2:2026-10-23'])
    assert.match(S.textoLanzada(cs, V), /2 campañas/)
    assert.match(S.textoLanzada(cs, V), /6 anuncios activos/)
    const [r] = S.candidatos(tablero([fila([nueva('4', { inicioCompetencia: '2026-09-01' })])]))
    assert.equal(r.rotacion, true)
    assert.match(S.textoLanzada([r], V), /Videos nuevos al aire/)
    assert.equal(S.candidatos(tablero([fila([nueva('5', { dia: 4 })])])).filter(x => x.tipo === 'lanzada').length, 0)
    assert.equal(S.candidatos(tablero([fila([nueva('6', { reactivada: '2026-10-23', creada: '2026-09-01' })])])).length, 0, 'una vieja reactivada')
    const [b] = S.candidatos(tablero([fila([nueva('7', { reactivada: '2026-10-23', creada: '2026-10-21' })])]))
    assert.equal(b?.tipo, 'lanzada', 'un borrador armado el 21 y prendido el 23 sí es un lanzamiento')
    assert.equal(b.rotacion, false)
  })
  test('cuenta pausada o con error de pago: nada', () => {
    assert.equal(S.candidatos(tablero([fila([lanz()], { pausado: true })])).length, 0)
    assert.equal(S.candidatos(tablero([fila([lanz()], { pago: { errorPago: true } })])).length, 0)
  })
})

describe('detectarAccion (historial de Meta)', () => {
  test('una persona pausa un conjunto (1→7) o un anuncio (1→8, o en revisión 9→8) de la tanda desde el día 3', () => {
    const r = S.detectarAccion(detalle({ eventos: [ev(), pausaAnuncio({ objeto: 'a2', fecha: '2026-10-23T15:00' })] }), '2026-10-23', OP)
    assert.deepEqual(r, { fecha: '2026-10-23', quien: 'Valentino Zalazar', resumen: 'pausó 1 conjunto, pausó 1 anuncio' })
    assert.ok(S.detectarAccion(detalle({ eventos: [pausaAnuncio()] }), '2026-10-23', OP), 'anuncio 1→8 (antes no se veía)')
    assert.ok(S.detectarAccion(detalle({ eventos: [pausaAnuncio({ viejo: 9 })] }), '2026-10-23', OP), 'en revisión → inactivo')
    assert.ok(S.detectarAccion(detalle({ eventos: [pausaAnuncio({ nuevo: 3 })] }), '2026-10-23', OP), 'eliminado')
  })
  test('sin ninguna pausa no está hecha (solo presupuesto = escalar); con pausa, el presupuesto suma al resumen y nombra a todos', () => {
    const presupuesto = ev({ tipo: 'update_ad_set_budget', objeto: 's1', viejo: null, nuevo: null, quien: 'Geronimo Actis' })
    assert.equal(S.detectarAccion(detalle({ eventos: [presupuesto] }), '2026-10-23', OP), null)
    const r = S.detectarAccion(detalle({ eventos: [presupuesto, ev()] }), '2026-10-23', OP)
    assert.match(r.quien, /Geronimo Actis y Valentino Zalazar|Valentino Zalazar y Geronimo Actis/)
    assert.match(r.resumen, /pausó 1 conjunto, cambió el presupuesto de 1 conjunto/)
    assert.doesNotMatch(S.detectarAccion(detalle({ eventos: [presupuesto, ev()] }), '2026-10-23', { ...OP, conPresupuesto: false }).resumen, /presupuesto/)
  })
  test('tanda de un borrador o una reactivación: los anuncios se armaron antes del prendido', () => {
    const [c] = S.candidatos(tablero([fila([lanz({ fecha: '2026-10-21', reactivada: '2026-10-21', creada: '2026-10-18' })])]))
    assert.deepEqual(S.tandaDe(c), { desde: '2026-10-18', hasta: '2026-10-23' })
    const d = detalle({ anuncios: detalle().anuncios.map(a => ({ ...a, creado: '2026-10-18' })), eventos: [ev()] })
    assert.ok(S.detectarAccion(d, '2026-10-23', { tanda: S.tandaDe(c), conPresupuesto: true }))
  })
  test('no cuentan: Meta solo, antes del día 3, apagado→apagado, 7 en un anuncio, campaña entera, otra campaña, reactivar, otra tanda, sin nada prendido', () => {
    const no = [
      ev({ quien: 'Meta' }), ev({ quien: '' }), ev({ fecha: '2026-10-22T23:59' }), ev({ viejo: 7 }), ev({ viejo: null }),
      pausaAnuncio({ nuevo: 7 }), ev({ tipo: 'update_campaign_run_status', objeto: '900' }), ev({ objeto: 's99' }), ev({ viejo: 7, nuevo: 1 }),
    ]
    assert.equal(S.detectarAccion(detalle({ eventos: no }), '2026-10-23', OP), null)
    assert.equal(S.detectarAccion(detalle({ eventos: null }), '2026-10-23', OP), null)
    const otraTanda = detalle({ anuncios: [...detalle().anuncios, { id: 'v1', nombre: 'Viejo', conjunto: 'sv', activo: false, creado: '2026-09-01' }], eventos: [ev({ objeto: 'sv' })] })
    assert.equal(S.detectarAccion(otraTanda, '2026-10-23', OP), null, 'pausar la tanda vieja no es optimizar esta')
    const nadaPrendido = detalle({ anuncios: detalle().anuncios.map(a => ({ ...a, activo: false })), eventos: [ev()] })
    assert.equal(S.detectarAccion(nadaPrendido, '2026-10-23', OP), null, 'apagó todo: frenó, no optimizó')
  })
  test('aEvento: run_status numérico o, si no viene, el texto; fecha en hora de Argentina', () => {
    const e = aEvento({ event_type: 'update_ad_set_run_status', event_time: '2026-10-22T14:00:23+0000', object_id: 123, actor_name: 'Valentino Zalazar', extra_data: JSON.stringify({ old_value: 'Activo', new_value: 'Inactivo', run_status: { old_value: 1, new_value: 7 } }) })
    assert.deepEqual([e.objeto, e.fecha, e.viejo, e.nuevo], ['123', '2026-10-22T11:00', 1, 7])
    const t = aEvento({ event_type: 'update_ad_run_status', event_time: '2026-10-22T14:00:23+0000', object_id: '5', extra_data: JSON.stringify({ old_value: 'Activo', new_value: 'Eliminado' }) })
    assert.deepEqual([t.viejo, t.nuevo], [1, 3])
    assert.equal(aEvento({ event_type: 'x' }), null)
    assert.equal(aEvento({ event_type: 'x', event_time: '2026-10-22T14:00:23+0000', object_id: 1, extra_data: '{roto' }).viejo, null)
  })
})

describe('métricas y textos', () => {
  test('en USD con la cotización de la cuenta, contra la rama, ordenadas por costo', () => {
    const ms = S.metricasUSD({ usdPor: 1000, rama: fila([]).rama }, detalle({ metricas: { a1: { gasto: 12000, mensajes: 20 }, a2: { gasto: 12000, mensajes: 7 }, a3: { gasto: 12000, mensajes: 2 } } }), true)
    assert.deepEqual(ms.map(m => [m.nombre, m.nivel, Math.round(m.cpl * 100) / 100]), [['Despido en negro', 'bien', 0.6], ['Me echaron', 'mirar', 1.71], ['Horas extra', 'apagar', 6]])
    const pocos = S.metricasUSD({ usdPor: 1, rama: null }, detalle({ metricas: { a1: { gasto: 1, mensajes: 0 }, a2: { gasto: 6, mensajes: 0 }, a3: { gasto: 2, mensajes: 1 } } }), true)
    assert.deepEqual(Object.fromEntries(pocos.map(m => [m.id, m.nivel])), { a1: 'sin_datos', a2: 'apagar', a3: 'sin_datos' })
    assert.deepEqual(S.metricasUSD({ usdPor: null, rama: null }, detalle(), true), [], 'sin cotización no se inventa')
  })
  test('optimizar: mención solo a Valentino, anuncios con emoji, qué apagar, links y nombres escapados', () => {
    const [c] = S.candidatos(tablero([fila([lanz({ campana: '**[DM]** @everyone <@123>' })])]))
    const t = S.textoOptimizar(c, detalle(), V)
    assert.ok(t.startsWith(`<@${V}> 🛠️ **Optimizar · día 4 · Dra. Laura Pérez**`))
    assert.match(t, /✅ Despido en negro · USD 0,60 · 20 msj/)
    assert.match(t, /❌ Horas extra · USD 6,00 · 2 msj → apagar/)
    assert.match(t, /preguntale al cliente/)
    assert.match(t, /\[Ads Manager\]\(<https:\/\/adsmanager/)
    assert.ok(!/@everyone|<@123>/.test(t.replace(`<@${V}>`, '')), 'sin menciones ajenas')
    assert.ok(t.length <= S.MAX_TEXTO)
  })
  test('optimizar con un solo anuncio, sin detalle de Meta y sin cotización', () => {
    const [c] = S.candidatos(tablero([fila([lanz()])]))
    assert.match(S.textoOptimizar(c, detalle({ anuncios: [detalle().anuncios[0]] }), V), /Un solo anuncio activo: no hay qué apagar/)
    assert.match(S.textoOptimizar(c, { anuncios: [], metricas: {}, eventos: null }, null), /no devolvió el detalle/)
    const [p] = S.candidatos(tablero([fila([lanz()], { moneda: 'ARS', usdPor: null })]))
    assert.match(S.textoOptimizar(p, detalle(), V), /sin la cotización de hoy de ARS/)
    assert.match(S.textoOptimizar(c, detalle({ metricas: {}, metricasOk: false }), V), /no devolvió el detalle/, 'falló gasto o mensajes: no inventa "sin entrega"')
  })
  test('activos que no entregaron: salen como "sin entrega" y no se cuentan como uno solo', () => {
    const [c] = S.candidatos(tablero([fila([lanz()])]))
    const t = S.textoOptimizar(c, detalle({ metricas: { a1: { gasto: 12, mensajes: 20 } }, metricasOk: true }), V)
    assert.match(t, /⏳ Me echaron · sin entrega todavía/)
    assert.doesNotMatch(t, /Un solo anuncio activo/)
    assert.ok(!S.textoOptimizar(c, detalle(), null).includes('<@'), 'sin ID, sin mención')
  })
  test('ganadores: 🥇🥈 y el resto a apagar', () => {
    const [c] = S.candidatos(tablero([fila([lanz({ fechaOptimizacion: '2026-10-15', etapa: 'ganador', diasCompetencia: 9, pendienteRevision: false })])]))
    const t = S.textoGanadores(c, detalle({ metricas: { a1: { gasto: 12, mensajes: 20 }, a2: { gasto: 12, mensajes: 12 }, a3: { gasto: 12, mensajes: 9 } } }), V)
    assert.match(t, /🥇 Despido en negro/)
    assert.match(t, /🥈 Me echaron/)
    assert.match(t, /❌ Horas extra .* → apagar/)
    assert.match(t, /iteraciones/)
  })
  test('muchos anuncios: no pasa de 1900 y no pierde la mención ni el pie', () => {
    const anuncios = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, nombre: `Video número ${i} con un título bastante largo para llenar`, conjunto: `s${i}`, activo: true }))
    const metricas = Object.fromEntries(anuncios.map((a, i) => [a.id, { gasto: 10 + i, mensajes: 5 }]))
    const [c] = S.candidatos(tablero([fila([lanz()])]))
    const t = S.textoOptimizar(c, { anuncios: anuncios.map(a => ({ ...a, creado: '2026-10-21' })), metricas, eventos: [] }, V)
    assert.ok(t.length <= S.MAX_TEXTO, `${t.length}`)
    assert.ok(t.startsWith(`<@${V}>`))
    assert.match(t, /Ya optimicé/)
    assert.match(t, /más \(en Ads Manager\)/)
  })
  test('nombre de pila y textos para el cliente', () => {
    assert.equal(S.nombrePila('Dra. Laura Ortiz Molina'), 'Laura')
    assert.equal(S.nombrePila('María Sofía Torres'), 'María')
    assert.equal(S.nombrePila('Estudio Romero'), null)
    assert.equal(S.nombrePila('Abogado previsional'), null)
    assert.equal(S.nombrePila(null), null)
    const [c] = S.candidatos(tablero([fila([lanz({ fechaOptimizacion: '2026-10-23', pendienteRevision: false })])]))
    assert.match(S.textoCliente(c), /^¡Hola Laura! Ya pasaron los primeros días/)
    assert.match(S.textoHecha(c, V), /📲 \*\*Para el cliente\*\*/)
    assert.match(S.textoHecha(c, V), /\n🗂️ /, 'la campaña no arranca el renglón (un # sería un título)')
  })
})

// ── Orquestador con dependencias falsas ──
function fakes(over = {}) {
  const log = { reclamar: [], enviar: [], registrar: [], dudoso: [], soltar: [], enviado: [], esperas: [] }
  const reloj = { t: Date.parse('2026-10-24T11:45:00Z') }
  const reclamadas = new Set()
  const deps = {
    detalles: async cs => new Map(cs.map(c => [c.l.campanaId, detalle()])),
    optimizaciones: async () => [],
    registrarOptimizacion: async o => { log.registrar.push(o) },
    reclamar: async clave => { log.reclamar.push(clave); if (reclamadas.has(clave)) return false; reclamadas.add(clave); return true },
    marcarEnviado: async (clave, id) => { log.enviado.push([clave, id]) },
    marcarDudoso: async clave => { log.dudoso.push(clave) },
    soltar: async clave => { log.soltar.push(clave) },
    yaSalieron: async claves => new Set(claves.filter(c => reclamadas.has(c))),
    reciente: async (campana, tipo) => [...reclamadas].some(k => k.startsWith(`${tipo}:${campana}:`)),
    enviar: async texto => { log.enviar.push(texto); return `m${log.enviar.length}` },
    esperar: async ms => { log.esperas.push(ms); reloj.t += ms },
    valentino: V,
    ahora: () => (reloj.t += 1),
    ...over,
  }
  return { deps, log, reloj }
}

describe('seguimientoAnuncios', () => {
  test('recordatorio de optimizar: se reclama, se manda y no se repite en la segunda corrida', async () => {
    const { deps, log } = fakes()
    const t = tablero([fila([lanz()])])
    const r = await seguimientoAnuncios(t, deps)
    assert.deepEqual(r.avisos.map(a => [a.tipo, a.estado]), [['optimizar', 'enviado']])
    assert.equal(log.enviado.length, 1)
    const r2 = await seguimientoAnuncios(t, deps)
    assert.deepEqual(r2.avisos.map(a => a.estado), ['ya_salio'])
    assert.equal(log.enviar.length, 1)
  })
  test('ya optimizada en Meta: se registra (origen auto) y sale el texto para el cliente, no el recordatorio', async () => {
    const { deps, log } = fakes({ detalles: async cs => new Map(cs.map(c => [c.l.campanaId, detalle({ eventos: [ev()] })])) })
    const r = await seguimientoAnuncios(tablero([fila([lanz()])]), deps)
    assert.deepEqual(r.avisos.map(a => [a.tipo, a.clave]), [['optimizada', 'optimizada:900:2026-10-23']])
    // Después el tablero la ve como «Ya optimicé» del 23/10 (una segunda corrida, o al día siguiente si la pausa fue del
    // mismo día): arma la misma clave y no sale de nuevo
    const t2 = { hoy: HOY, optimizacionesLeidas: true, filas: [fila([lanz({ fechaOptimizacion: '2026-10-23', pendienteRevision: false })])] }
    const r2 = await seguimientoAnuncios(t2, deps)
    assert.deepEqual(r2.avisos.map(a => a.estado), ['ya_salio'])
    assert.equal(log.registrar.length, 1)
    assert.deepEqual([log.registrar[0].accion, log.registrar[0].fecha, log.registrar[0].campanaId], ['optimizacion', '2026-10-23', '900'])
    assert.match(log.registrar[0].origen, /^auto: Valentino Zalazar pausó 1 conjunto/)
    assert.match(log.enviar[0], /Optimización hecha .* Valentino Zalazar pausó 1 conjunto el 23\/10/)
  })
  test('no registra dos veces la misma optimización', async () => {
    const { deps, log } = fakes({
      detalles: async cs => new Map(cs.map(c => [c.l.campanaId, detalle({ eventos: [ev()] })])),
      optimizaciones: async () => [{ campanaId: '900', accion: 'optimizacion', fecha: '2026-10-23' }],
    })
    await seguimientoAnuncios(tablero([fila([lanz()])]), deps)
    assert.equal(log.registrar.length, 0)
  })
  test('ganadores con 1 o 2 activos: no hay qué elegir, ni aviso ni registro', async () => {
    const dos = detalle({ anuncios: detalle().anuncios.map((a, i) => ({ ...a, activo: i < 2 })) })
    const { deps, log } = fakes({ detalles: async cs => new Map(cs.map(c => [c.l.campanaId, dos])) })
    const r = await seguimientoAnuncios(tablero([fila([lanz({ fecha: '2026-10-10', fechaOptimizacion: '2026-10-15', etapa: 'ganador', diasCompetencia: 9, pendienteRevision: false })])]), deps)
    assert.equal(r.avisos.length, 0)
    assert.equal(log.registrar.length, 0)
    assert.match(r.omitidos[0], /ya tiene 2 activos/)
  })
  test('ganadores hecha en Meta (apagó uno y quedaron 2): se registra con la fecha de HOY y la clave también (al día siguiente el tablero arma la misma)', async () => {
    const d = detalle({ anuncios: detalle().anuncios.map(a => ({ ...a, creado: '2026-10-10', activo: a.id !== 'a3' })), eventos: [pausaAnuncio({ fecha: '2026-10-20T10:00' })] })
    const { deps, log } = fakes({ detalles: async cs => new Map(cs.map(c => [c.l.campanaId, d])) })
    const l = lanz({ fecha: '2026-10-10', fechaOptimizacion: '2026-10-15', etapa: 'ganador', diasCompetencia: 9, pendienteRevision: false })
    const r = await seguimientoAnuncios(tablero([fila([l])]), deps)
    assert.deepEqual(r.avisos.map(a => a.clave), [`ganadores-hecha:900:${HOY}`])
    assert.deepEqual([log.registrar[0].accion, log.registrar[0].fecha], ['revision_competencia', HOY])
    assert.match(log.enviar[0], /Ganadores elegidos .* pausó 1 anuncio el 20\/10/)
    const [c] = S.candidatos({ hoy: '2026-10-25', filas: [fila([{ ...l, fechaRevision: HOY, etapa: null }])] })
    assert.equal(c.clave, `ganadores-hecha:900:${HOY}`)
  })
  test('dry: no reclama, no registra, no manda; dice cuáles ya salieron', async () => {
    const { deps, log } = fakes({ detalles: async cs => new Map(cs.map(c => [c.l.campanaId, detalle({ eventos: [ev()] })])), yaSalieron: async () => new Set(['optimizada:900:2026-10-23']) })
    const r = await seguimientoAnuncios(tablero([fila([lanz()])]), deps, { dry: true })
    assert.deepEqual(r.avisos.map(a => a.estado), ['ya_salio'])
    assert.deepEqual([log.reclamar.length, log.registrar.length, log.enviar.length], [0, 0, 0])
    assert.match(r.registradas[0], /^\(dry\)/)
  })
  test('Discord: seguro no salió (429) → se suelta; un 5xx sin tiempo para reintentar pudo salir → dudoso', async () => {
    const f = fakes({ enviar: async () => { throw Object.assign(new Error('Discord respondió 429 (demasiados mensajes seguidos)'), { transitorio: true }) } })
    await seguimientoAnuncios(tablero([fila([lanz()])]), f.deps)
    assert.deepEqual(f.log.soltar, ['optimizar:900:2026-10-21'])
    assert.deepEqual(f.log.dudoso, [])
    const g = fakes({ enviar: async () => { throw Object.assign(new Error('Discord respondió 502 y no alcanza el tiempo'), { transitorio: true }) } })
    await seguimientoAnuncios(tablero([fila([lanz()])]), g.deps)
    assert.deepEqual(g.log.dudoso, ['optimizar:900:2026-10-21'])
  })
  test('Discord: rechazado → se suelta (sale mañana); sin confirmar → dudoso (no se repite)', async () => {
    const a = fakes({ enviar: async () => { throw Object.assign(new Error('Discord respondió 404'), { transitorio: false }) } })
    const ra = await seguimientoAnuncios(tablero([fila([lanz()])]), a.deps)
    assert.equal(ra.avisos[0].estado, 'rechazado')
    assert.deepEqual(a.log.soltar, ['optimizar:900:2026-10-21'])
    const b = fakes({ enviar: async () => { throw Object.assign(new Error('timeout'), { transitorio: true }) } })
    const rb = await seguimientoAnuncios(tablero([fila([lanz()])]), b.deps)
    assert.equal(rb.avisos[0].estado, 'dudoso')
    assert.deepEqual(b.log.dudoso, ['optimizar:900:2026-10-21'])
  })
  test('Meta no responde: el recordatorio sale igual (sin detalle) y queda el error', async () => {
    const { deps, log } = fakes({ detalles: async () => { throw new Error('rate limit') } })
    const r = await seguimientoAnuncios(tablero([fila([lanz()])]), deps)
    assert.equal(r.avisos[0].estado, 'enviado')
    assert.match(log.enviar[0], /no devolvió el detalle/)
    assert.match(r.errores[0], /rate limit/)
  })
  test('la planilla falla al registrar: no sale el aviso (diría "lo registré"; mañana se reintenta)', async () => {
    const { deps, log } = fakes({ detalles: async cs => new Map(cs.map(c => [c.l.campanaId, detalle({ eventos: [ev()] })])), registrarOptimizacion: async () => { throw new Error('Sheets 503') } })
    const r = await seguimientoAnuncios(tablero([fila([lanz()])]), deps)
    assert.equal(log.enviar.length, 0)
    assert.equal(log.reclamar.length, 0)
    assert.match(r.errores[0], /Sheets 503/)
  })
  test('el tablero no pudo leer «Ads Optimizaciones»: no corre', async () => {
    const { deps, log } = fakes()
    const r = await seguimientoAnuncios(tablero([fila([lanz()])], { optimizacionesLeidas: false }), deps)
    assert.equal(r.avisos.length, 0)
    assert.equal(log.enviar.length, 0)
    assert.match(r.errores[0], /Ads Optimizaciones/)
  })
  test('segunda llave: si la fecha del ciclo se corre, no sale otro "Optimizar" de la misma campaña en 7 días', async () => {
    const { deps, log } = fakes()
    await seguimientoAnuncios(tablero([fila([lanz()])]), deps)
    const r = await seguimientoAnuncios(tablero([fila([lanz({ fecha: '2026-10-22', dia: 3 + 1 })])]), deps)
    assert.deepEqual(r.avisos.map(a => a.estado), ['ya_salio'])
    assert.equal(log.enviar.length, 1)
  })
  test('lanzadas: un mensaje por cliente y día, con clave por campaña; la que ya salió no se repite y la nueva sí', async () => {
    const nueva = (id) => lanz({ campanaId: id, fecha: '2026-10-23', inicioCompetencia: '2026-10-23', dia: 2, pendienteRevision: false })
    const { deps, log } = fakes()
    const r1 = await seguimientoAnuncios(tablero([fila([nueva('B')])]), deps)
    assert.deepEqual(r1.avisos.map(a => a.clave), ['lanzada:B:2026-10-23'])
    const r2 = await seguimientoAnuncios(tablero([fila([nueva('A'), nueva('B')])]), deps)
    assert.deepEqual(r2.avisos.map(a => [a.clave, a.estado]), [['lanzada:A:2026-10-23', 'enviado']])
    assert.equal(log.enviar.length, 2)
    assert.doesNotMatch(log.enviar[1], /2 campañas/)
  })
  test('pausa entre avisos', async () => {
    const filas = [fila([lanz({ campanaId: '1' })], { id: 'act_a' }), fila([lanz({ campanaId: '2' })], { id: 'act_b' })]
    const { deps, log } = fakes()
    await seguimientoAnuncios(tablero(filas), deps)
    assert.deepEqual(log.esperas, [PAUSA_ENTRE_AVISOS_MS])
  })
  test('sin tiempo: no manda lo que no entra; orden: optimizar, ganadores, hecha, lanzada', async () => {
    const filas = [
      fila([lanz({ campanaId: '1', fecha: '2026-10-23', inicioCompetencia: '2026-10-23', dia: 2, pendienteRevision: false })], { id: 'act_a' }),
      fila([lanz({ campanaId: '2' })], { id: 'act_b' }),
    ]
    const { deps } = fakes()
    const r = await seguimientoAnuncios(tablero(filas), deps)
    assert.deepEqual(r.avisos.map(a => a.tipo), ['optimizar', 'lanzada'])
    const f = fakes()
    const r2 = await seguimientoAnuncios(tablero(filas), f.deps, { deadline: f.reloj.t + RESERVA_ENVIO_MS - 100 })
    assert.ok(r2.avisos.every(a => a.estado === 'sin_tiempo'))
    assert.equal(f.log.reclamar.length, 0)
  })
  test('tope por corrida', async () => {
    const filas = Array.from({ length: 20 }, (_, i) => fila([lanz({ campanaId: String(100 + i) })], { id: `act_${i}` }))
    const { deps, log } = fakes()
    await seguimientoAnuncios(tablero(filas), deps)
    assert.equal(log.enviar.length, S.MAX_AVISOS_POR_CORRIDA)
  })
})

describe('registro contra un Neon falso', () => {
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    return { consultas, fabrica: () => q }
  }
  const correr = async (responder, fn) => {
    process.env.DATABASE_URL = 'postgres://falsa.test/db'
    const n = neonFalso(responder)
    registro.sqlParaPruebas(n.fabrica)
    try { return { r: await fn(), consultas: n.consultas } } finally { registro.sqlParaPruebas(null); delete process.env.DATABASE_URL }
  }
  test('reclamar: INSERT … ON CONFLICT DO NOTHING; true solo si insertó', async () => {
    const d = { tipo: 'lanzada', cuenta: 'act_1', campana_id: '9', cliente: 'Laura', texto_cliente: '¡Hola!' }
    const si = await correr(t => (t.startsWith('INSERT') ? [{ clave: 'k' }] : []), () => registro.reclamarAviso('k', d))
    assert.equal(si.r, true)
    const ins = si.consultas.find(c => c.texto.startsWith('INSERT'))
    assert.match(ins.texto, /ON CONFLICT \(clave\) DO NOTHING RETURNING clave$/)
    assert.ok(ins.valores.includes('pendiente_whapi'))
    assert.ok(si.consultas.some(c => c.texto.startsWith('CREATE TABLE IF NOT EXISTS cj_anuncios_avisos')))
    const no = await correr(() => [], () => registro.reclamarAviso('k', d))
    assert.equal(no.r, false)
  })
  test('soltar solo borra una fila que sigue enviando; leer en seco no crea la tabla y tolera que no exista', async () => {
    const s = await correr(() => [], () => registro.soltarAviso('k'))
    assert.match(s.consultas[0].texto, /^DELETE FROM cj_anuncios_avisos WHERE clave = \$1 AND estado = 'enviando'$/)
    const sinTabla = Object.assign(new Error('relation "cj_anuncios_avisos" does not exist'), { code: '42P01' })
    const l = await correr(() => { throw sinTabla }, () => registro.avisosRegistrados(['a']))
    assert.equal(l.r.size, 0)
    assert.ok(!l.consultas.some(c => c.texto.startsWith('CREATE')))
  })
})

describe('WhatsApp al grupo Ventas del cliente', async () => {
  const W = await import('../lib/bot/anuncios/whatsapp.ts')
  test('elige el grupo «Ventas - <cliente>» único; no el interno ni uno ambiguo', () => {
    const gs = [{ id: '1@g.us', name: 'Ventas C.J.' }, { id: '2@g.us', name: 'Ventas - Laura Ortiz Molina' }, { id: '3@g.us', name: 'Contenido - Laura Ortiz Molina' }, { id: '4@g.us', name: 'Ventas - Juan Pérez' }]
    assert.deepEqual(W.elegirGrupoVentas('Dra. Laura Cristina Ortiz Molina', gs), { id: '2@g.us', nombre: 'Ventas - Laura Ortiz Molina' })
    assert.equal(W.elegirGrupoVentas('Estudio Jurídico', gs), null, 'solo palabras genéricas')
    assert.equal(W.elegirGrupoVentas('Laura Pérez', gs), null, 'dos candidatos')
  })
  test('grupo fijado a mano por cuenta (nombres cortos como «Ventas - FlorT»)', () => {
    assert.equal(W.grupoFijado('act_1', { ANUNCIOS_WHATSAPP_GRUPOS: '{"act_1":"120363000000000001@g.us"}' }), '120363000000000001@g.us')
    assert.equal(W.grupoFijado('act_2', { ANUNCIOS_WHATSAPP_GRUPOS: '{"act_1":"120363000000000001@g.us"}' }), null)
    assert.equal(W.grupoFijado('act_1', { ANUNCIOS_WHATSAPP_GRUPOS: 'roto' }), null)
  })
  test('apagado por defecto; con la lista de prueba, solo esas cuentas', () => {
    assert.equal(W.permitidaWhatsApp('act_1', {}), false)
    assert.equal(W.permitidaWhatsApp('act_1', { ANUNCIOS_WHATSAPP: 'real' }), true)
    assert.equal(W.permitidaWhatsApp('act_1', { ANUNCIOS_WHATSAPP: 'real', ANUNCIOS_WHATSAPP_SOLO: 'act_2' }), false)
    assert.equal(W.permitidaWhatsApp('act_2', { ANUNCIOS_WHATSAPP: 'real', ANUNCIOS_WHATSAPP_SOLO: 'act_2, act_3' }), true)
  })
  const wa = (over = {}) => {
    const log = { enviados: [], anotados: [] }
    return { log, w: { permitida: () => true, grupos: async () => [{ id: '9@g.us', name: 'Ventas - Laura Pérez' }], elegir: (c, g) => W.elegirGrupoVentas(c, g), enviar: async (g, t) => { log.enviados.push([g, t]); return 'wamid.1' }, anotar: async (k, g, id) => { log.anotados.push([k, g, id]) }, ...over } }
  }
  const nueva = lanz({ fecha: '2026-10-23', inicioCompetencia: '2026-10-23', dia: 2, pendienteRevision: false })
  test('lanzada: le manda el texto al cliente y a Valentino le dice que ya salió', async () => {
    const { log, w } = wa()
    const { deps, log: l2 } = fakes({ whatsapp: w })
    await seguimientoAnuncios(tablero([fila([nueva])]), deps)
    assert.equal(log.enviados.length, 1)
    assert.match(log.enviados[0][1], /^¡Hola Laura! Ya están corriendo tus anuncios/)
    assert.match(l2.enviar[0], /Ya se lo mandé al cliente.*Ventas - Laura Pérez/)
    assert.deepEqual(log.anotados.map(a => a[2]), ['wamid.1'])
  })
  test('sin grupo: no manda y a Valentino le queda el texto para pegar con el motivo', async () => {
    const { log, w } = wa({ grupos: async () => [] })
    const { deps, log: l2 } = fakes({ whatsapp: w })
    await seguimientoAnuncios(tablero([fila([nueva])]), deps)
    assert.equal(log.enviados.length, 0)
    assert.match(l2.enviar[0], /pegalo en su grupo Ventas: no encontré/)
  })
  test('el recordatorio a Valentino (optimizar) nunca va al cliente; apagada para esa cuenta, tampoco', async () => {
    const a = wa(); const fa = fakes({ whatsapp: a.w })
    await seguimientoAnuncios(tablero([fila([lanz()])]), fa.deps)
    assert.equal(a.log.enviados.length, 0)
    const b = wa({ permitida: () => false }); const fb = fakes({ whatsapp: b.w })
    await seguimientoAnuncios(tablero([fila([nueva])]), fb.deps)
    assert.equal(b.log.enviados.length, 0)
    assert.match(fb.log.enviar[0], /pegalo en su grupo de ventas hasta/)
  })
  test('si el WhatsApp salió y Discord falla, no se suelta (el cliente no lo recibe dos veces)', async () => {
    const { w } = wa()
    const { deps, log } = fakes({ whatsapp: w, enviar: async () => { throw Object.assign(new Error('Discord respondió 429'), { transitorio: true }) } })
    await seguimientoAnuncios(tablero([fila([nueva])]), deps)
    assert.deepEqual(log.soltar, [])
    assert.deepEqual(log.dudoso, ['lanzada:900:2026-10-23'])
  })
})
