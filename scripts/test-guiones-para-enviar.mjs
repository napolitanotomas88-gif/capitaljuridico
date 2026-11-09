// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-guiones-para-enviar.mjs
// El «para enviar» (d02) de los guiones aprobados, SÍ O SÍ (Tomás, 3/11/2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
const W = await import('../lib/bot/guiones/whatsappCliente.ts')
const F = await import('../lib/bot/guiones/paraEnviarFaltantes.ts')
const { publicarParaEntrega } = await import('../lib/bot/guiones/publicacion.ts')
const R = await import('../lib/bot/guiones/avisoRevision.ts')

const AP = '2026-11-02T22:05:07.977Z'
const fila = (o = {}) => ({
  id: 6, recording_id: 1, tanda: 1, id_crm: 'A165', cliente: 'Cliente Prueba', estado: 'aprobada', notas: [], guiones: { 1: {}, 2: {} },
  aprobacion: { quien: 'Faus', email: 'f@x.test', cuando: AP }, doc: { id: 'd1', url: 'https://docs.google.com/document/d/d1/edit', tanda: 1, publicada: AP },
  actualizado: AP, ...o,
})
function deps(previos = []) {
  const log = { creados: [], actualizados: [], alertas: [], descartados: [] }
  return { log, d: {
    existentes: async () => previos,
    crear: async m => { log.creados.push(m); return { estado: 'manual_pendiente', id: 99 } },
    actualizar: async (id, texto, datos) => { log.actualizados.push({ id, texto, datos }); return true },
    alertar: async a => { log.alertas.push(a) },
    descartar: async (id, motivo) => { log.descartados.push([id, motivo]) },
  } }
}

test('problemaDelDoc: bien escrito → null; falla, dudosa, sin link o versión vieja → el motivo', () => {
  assert.equal(W.problemaDelDoc(fila()), null)
  assert.equal(W.problemaDelDoc(fila({ doc: { ...fila().doc, publicacion: { estado: 'dudoso', cuando: AP, motivo: 'timeout' } } })).dudoso, true)
  assert.match(W.problemaDelDoc(fila({ doc: { ...fila().doc, publicacion: { estado: 'error', cuando: AP, motivo: 'puente 500' } } })).motivo, /puente 500/)
  assert.match(W.problemaDelDoc(fila({ doc: null })).motivo, /link del Doc/)
  assert.match(W.problemaDelDoc(fila({ doc: { ...fila().doc, publicada: '2026-10-01T00:00:00Z' } })).motivo, /versión aprobada/)
})

test('d02: tras el check final crea el «para enviar» (link + grabación) con la clave de la aprobación', async () => {
  const x = deps()
  const r = await W.guionesParaEnviar(fila(), new Date('2026-11-03T15:00:00Z'), null, x.d)
  assert.equal(r.estado, 'manual')
  assert.equal(x.log.creados.length, 1)
  const m = x.log.creados[0]
  assert.equal(m.pieza, 'd02'); assert.equal(m.clave, `6:${AP}`)
  assert.match(m.texto, /docs\.google\.com\/document\/d\/d1/)
  assert.deepEqual(m.datos, { tanda: 6, tandaDoc: 1, grabacion: true })
  assert.equal(m.avisos, undefined)
})

test('d02: con la carga en el Doc fallida o dudosa sale IGUAL, con la advertencia (y marcado docPendiente)', async () => {
  const x = deps()
  await W.guionesParaEnviar(fila(), new Date(), { dudoso: true, motivo: 'el puente no respondió' }, x.d)
  const m = x.log.creados[0]
  assert.equal(m.datos.docPendiente, true)
  assert.match(m.avisos[0], /DUDOSA.*el puente no respondió/)
  assert.match(m.avisos[1], /NO lo mandes todavía/)
  // sin link del Doc: sale igual, con el lugar del link marcado
  const y = deps()
  await W.guionesParaEnviar(fila({ doc: null }), new Date(), null, y.d)
  assert.match(y.log.creados[0].texto, /\[link del documento de guiones\]/)
  assert.match(y.log.creados[0].avisos[0], /Falló la carga en el Doc/)
})

test('d02: sin duplicar — con el de ESTA aprobación pendiente no crea otro; la misma aprobación ya hecha tampoco', async () => {
  const x = deps([{ id: 5, clave: `d02:6:${AP}`, estado: 'para_enviar', datos: { tanda: 6 } }])
  assert.equal((await W.guionesParaEnviar(fila(), new Date(), null, x.d)).estado, 'ya_estaba')
  assert.equal(x.log.creados.length + x.log.actualizados.length + x.log.alertas.length + x.log.descartados.length, 0)
  const y = deps([{ id: 5, clave: `d02:6:${AP}`, estado: 'enviado', datos: { tanda: 6 } }])
  assert.equal((await W.guionesParaEnviar(fila(), new Date(), null, y.d)).estado, 'ya_estaba')
  assert.equal(y.log.creados.length, 0)
})

test('d02: pendiente de una aprobación ANTERIOR (nunca marcado «Enviado») → se descarta y sale el nuevo', async () => {
  const x = deps([{ id: 5, clave: 'd02:6:2026-10-30T10:00:00.000Z', estado: 'para_enviar', datos: { tanda: 6 } }])
  assert.equal((await W.guionesParaEnviar(fila(), new Date(), null, x.d)).estado, 'manual')
  assert.deepEqual(x.log.descartados.map(d => d[0]), [5])
  assert.equal(x.log.creados.length, 1)
  assert.equal(x.log.creados[0].clave, `6:${AP}`)
})

test('d02: corrección / 2.ª ronda (otra aprobación, la anterior ya enviada) → mensaje nuevo', async () => {
  const x = deps([{ id: 5, clave: 'd02:6:2026-10-30T10:00:00.000Z', estado: 'enviado', datos: { tanda: 6 } }])
  await W.guionesParaEnviar(fila({ notas: [{ id: 'n', aplicada: '2026-11-01' }] }), new Date(), null, x.d)
  assert.equal(x.log.creados.length, 1)
  assert.match(x.log.creados[0].texto, /Ya estan los \d+ guiones nuevos/, 'texto único de Tomás (9/11), también para la 2.ª ronda')
})

test('d02: el pendiente que salió con el Doc en duda se actualiza cuando el Doc queda bien (y avisa en 📤)', async () => {
  const x = deps([{ id: 5, clave: `d02:6:${AP}`, estado: 'para_enviar', datos: { tanda: 6, docPendiente: true } }])
  const r = await W.guionesParaEnviar(fila(), new Date(), null, x.d)
  assert.equal(r.estado, 'manual')
  assert.equal(x.log.creados.length, 0)
  assert.equal(x.log.actualizados[0].id, 5)
  assert.equal(x.log.actualizados[0].datos.docPendiente, undefined)
  assert.equal(x.log.alertas[0].canal, 'para_enviar')
  assert.deepEqual([...x.log.alertas[0].menciones].sort(), ['aylu', 'gero_m'])
})

const publicador = (o = {}) => {
  const log = [], alertas = [], d02 = []; let actual = fila({ doc: null })
  return { log, alertas, d02, deps: {
    reservar: async () => true, leer: async () => actual,
    resolver: async () => ({ id: 'd1', url: 'x' }),
    escribir: async () => ({ estado: 'ok', id: 'd1', tanda: 1 }),
    guardar: async (_i, doc) => { actual = { ...actual, doc } }, notificar: async () => { log.push('notificar') },
    error: async (_i, _m, dudoso) => log.push(dudoso ? 'dudoso' : 'error'), alertar: async a => { alertas.push(a) },
    whatsapp: async (f, problema) => { d02.push({ f, problema: problema ?? null }); return { estado: 'manual' } }, ...o,
  } }
}
test('check final: publicación sana → «para enviar» sin advertencia', async () => {
  const a = publicador(); await publicarParaEntrega(6, Date.now() + 1000, a.deps)
  assert.equal(a.d02.length, 1); assert.equal(a.d02[0].problema, null)
})
test('check final: si la carga en el Doc falla o queda dudosa, el «para enviar» sale IGUAL (con el problema) y la alerta a 🧰', async () => {
  const a = publicador({ escribir: async () => ({ estado: 'error', motivo: 'agregarTanda: 500' }) })
  await publicarParaEntrega(6, Date.now() + 1000, a.deps)
  assert.equal(a.alertas.length, 1); assert.equal(a.alertas[0].canal, 'sistema')
  assert.equal(a.d02.length, 1); assert.deepEqual(a.d02[0].problema, { dudoso: false, motivo: 'agregarTanda: 500' })
  const b = publicador({ escribir: async () => ({ estado: 'dudoso', motivo: 'sin respuesta' }) })
  await publicarParaEntrega(6, Date.now() + 1000, b.deps)
  assert.equal(b.d02[0].problema.dudoso, true)
})
test('check final: cliente archivado o la reserva tomada → no deja nada', async () => {
  const err = Object.assign(new Error('archivado'), { code: 'CLIENTE_ARCHIVADO' })
  const a = publicador({ exigirActivo: async () => { throw err } }); await publicarParaEntrega(6, 1, a.deps)
  assert.equal(a.d02.length, 0)
  const b = publicador({ reservar: async () => false }); await publicarParaEntrega(6, 1, b.deps)
  assert.equal(b.d02.length, 0)
})

test('red/barrido: crea solo los que faltan (sin pendiente ni la misma aprobación), con el problema del Doc', async () => {
  const filas = [
    fila({ id: 2, id_crm: 'A162', aprobacion: { cuando: '2026-10-27T18:03:25.578Z' }, doc: { id: 'd', url: 'u', publicada: '2026-10-27T18:03:25.578Z' } }),
    fila({ id: 6 }),
    fila({ id: 9, id_crm: 'A179' }),
    fila({ id: 11, id_crm: 'A200', doc: { id: 'd', url: 'u', publicada: AP, publicacion: { estado: 'error', cuando: AP, motivo: 'puente caído' } } }),
  ]
  const previos = { 6: [{ clave: `d02:6:${AP}`, estado: 'para_enviar' }], 9: [{ clave: 'd02:9:x', estado: 'para_enviar' }] }
  const creados = []
  const deps = {
    aprobadas: async (desde, hasta) => { assert.equal(desde, '2026-10-24T03:00:00.000Z'); assert.ok(hasta < '2026-11-03T15:00:00Z'); return filas },
    existentes: async id => previos[id] ?? [],
    crear: async (f, p) => { creados.push([f.id_crm, p?.motivo ?? null]); return { estado: 'manual' } },
  }
  const r = await F.crearParaEnviarFaltantes(deps, { desde: '2026-10-24T03:00:00.000Z', ahora: new Date('2026-11-03T15:00:00Z') })
  // A179 tiene pendiente uno de OTRA aprobación: también se crea (guionesParaEnviar descarta el viejo)
  assert.deepEqual(creados, [['A162', null], ['A179', null], ['A200', 'puente caído']])
  assert.deepEqual(r.faltantes.map(f => f.id_crm), ['A162', 'A179', 'A200'])
  // en seco: lista sin crear
  creados.length = 0
  const s = await F.crearParaEnviarFaltantes(deps, { desde: '2026-10-24T03:00:00.000Z', ahora: new Date('2026-11-03T15:00:00Z'), dry: true })
  assert.equal(creados.length, 0); assert.equal(s.faltantes.length, 3)
})
test('red: por defecto mira los últimos 10 días y deja 20 min a la publicación en curso', async () => {
  let rango
  await F.crearParaEnviarFaltantes({ aprobadas: async (d, h) => { rango = [d, h]; return [] }, existentes: async () => [], crear: async () => ({}) }, { ahora: new Date('2026-11-03T15:00:00Z') })
  assert.deepEqual(rango, ['2026-10-24T15:00:00.000Z', '2026-11-03T14:40:00.000Z'])
})

test('revisión: «desde cuándo» sale del id de Discord del aviso; sin él, de actualizado', () => {
  assert.equal(R.desdeAviso({ aviso_discord: 'dc:1566157392037679226', actualizado: 'z' }), '2026-10-31T18:30:20.059Z')
  assert.equal(R.desdeAviso({ aviso_discord: 'wa:abc', actualizado: '2026-11-01T00:00:00Z' }), '2026-11-01T00:00:00Z')
})
