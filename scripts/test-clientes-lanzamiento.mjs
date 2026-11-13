// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-clientes-lanzamiento.mjs
// «Campaña lanzada» como hito que no se olvida (13/11/2026): lib/clientes/lanzamientoAuto.ts, hitos.ts y recorrido.ts, y que la
// escritura de fondo (hitosRegistro.ts) no haga nada sin base. Puro: sin red ni base. Nombres inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.DATABASE_URL
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const L = await import('../lib/clientes/lanzamientoAuto.ts')
const H = await import('../lib/clientes/hitos.ts')
const R = await import('../lib/clientes/recorrido.ts')
const REG = await import('../lib/clientes/hitosRegistro.ts')

const HOY = '2026-11-13'
const LEE = { meta: true, despacho: true, clickup: true }
const cli = (o = {}) => ({ id: 'A950', nombre: 'Ana Prueba', closer: 'Gero', estado: 'ACTIVO', dia1: '2026-10-01', diasParaVencer: 60, fechaBaja: null, promesa: '', satisfaccion: null, ...o })
const ev = (o = {}) => ({ dia1: '2026-10-01', renovo: 'NO', inicioPeriodo2: null, kickoff: null, tanda: null, videos: null, drive: null, clickupGuiones: null, lanzamiento: null, campanaActiva: false, exito: null, manuales: [], ...o })
const vid = (o = {}) => ({ grabacion: 0, edicion: 0, aprobados: 0, pausados: 0, ultimoGrabacion: null, ultimoEdicion: null, ultimoAprobado: null, ...o })
const guardado = (fecha, nota = 'Primer gasto que vio el tablero de Anuncios') => ({ hito: 'lanzamiento', fecha, nota, quien: L.QUIEN_AUTOMATICO, cuando: '2026-11-13T15:00:00.000Z' })

test('lanzamientoVisto: solo con gasto real; fecha del primer gasto o de los anuncios creados antes', () => {
  assert.equal(L.lanzamientoVisto(null), null)
  assert.equal(L.lanzamientoVisto({ primerLanzamiento: '2026-11-10', primerGasto: null }), null, 'anuncios creados sin gasto no es lanzar')
  assert.deepEqual(L.lanzamientoVisto({ primerLanzamiento: null, primerGasto: '2026-10-29' }).fecha, '2026-10-29')
  assert.equal(L.lanzamientoVisto({ primerLanzamiento: '2026-10-28', primerGasto: '2026-10-29' }).fecha, '2026-10-28')
  const antes = L.lanzamientoVisto({ primerLanzamiento: null, primerGasto: '2026-10-10', gastoAntesDe: '2026-10-10' })
  assert.equal(antes.fecha, null)
  assert.match(antes.nota, /antes del 10\/10/)
})

test('pedidosLanzamiento: idempotente (no repite a quien ya lo tiene), IDs válidos y con tope', () => {
  const v = { fecha: '2026-10-29', nota: 'x' }
  const xs = [{ id: 'a950', meta: v }, { id: 'A950', meta: v }, { id: 'A951', meta: null }, { id: 'A952', meta: v }, { id: 'malo', meta: v }, { id: 'A953', meta: v }]
  assert.deepEqual(L.pedidosLanzamiento(xs, new Set(['A952']), 10).map(p => p.id), ['A950', 'A953'])
  assert.deepEqual(L.pedidosLanzamiento(xs, new Set(), 1).map(p => p.id), ['A950'])
})

test('hitos: lo guardado por el sistema es un dato de Meta, no una anotación a mano (y lo manual lo pisa)', () => {
  const h = H.hitosDelCliente(ev({ manuales: [guardado('2026-10-29')] })).find(x => x.clave === 'lanzamiento')
  assert.equal(h.hecho, true)
  assert.equal(h.fecha, '2026-10-29')
  assert.equal(h.fuente, 'meta')
  assert.equal(h.manual, null)
  // sin fecha (ya gastaba antes de la ventana): hecho, sin fecha
  const sf = H.hitosDelCliente(ev({ lanzamientoSinFecha: 'Ya gastaba en Meta antes del 10/10' })).find(x => x.clave === 'lanzamiento')
  assert.equal(sf.hecho, true)
  assert.equal(sf.fecha, null)
  // anotado a mano después: manda
  const m = H.hitosDelCliente(ev({ manuales: [guardado('2026-10-29'), { hito: 'lanzamiento', fecha: '2026-10-27', nota: 'lo prendió Valen', quien: 'Tomás', cuando: '2026-11-13T18:00:00.000Z' }] }))
  assert.equal(m.find(x => x.clave === 'lanzamiento').fuente, 'manual')
})

test('recorrido: con el lanzamiento guardado, en pausa y con videos aprobados NO vuelve a «Por lanzar»', () => {
  const hitos = H.hitosDelCliente(ev({ manuales: [guardado('2026-10-29')] }))
  const videos = vid({ aprobados: 4, ultimoAprobado: '2026-11-05' })
  // Sin fila en Anuncios (la cuenta ya no gasta): Lanzado con el detalle claro
  const sinFila = R.ubicarCliente(cli(), { kickoff: null, tanda: null, videos, meta: null, clickup: null, puntaje: null, hitos }, HOY, LEE)
  assert.equal(sinFila.etapa, 'lanzado')
  assert.match(sinFila.detalle, /^Lanzó el 29\/10; campaña en pausa/)
  assert.ok(sinFila.alertas.includes('Sin anuncios activos'))
  // Con fila pero sin campaña activa: «en pausa desde» el día siguiente al último gasto
  const meta = { activa: false, ultimoLanzamiento: null, semaforo: null, ultimoGasto: '2026-11-11' }
  const conFila = R.ubicarCliente(cli(), { kickoff: null, tanda: null, videos, meta, clickup: null, puntaje: null, hitos }, HOY, LEE)
  assert.equal(conFila.etapa, 'lanzado')
  assert.equal(conFila.detalle, 'Lanzó el 29/10; campaña en pausa desde el 12/11')
  // Sin el hito (como antes): los videos aprobados lo dejan en «Por lanzar»
  const antes = R.ubicarCliente(cli(), { kickoff: null, tanda: null, videos, meta: null, clickup: null, puntaje: null, hitos: H.hitosDelCliente(ev()) }, HOY, LEE)
  assert.equal(antes.etapa, 'por_lanzar')
})

test('recorrido: el CRM sigue mandando (PAUSADO → Pausa) y la campaña activa sigue siendo Lanzado', () => {
  const hitos = H.hitosDelCliente(ev({ manuales: [guardado('2026-10-29')] }))
  assert.equal(R.ubicarCliente(cli({ estado: 'PAUSADO' }), { kickoff: null, tanda: null, videos: null, meta: null, clickup: null, puntaje: null, hitos }, HOY, LEE).etapa, 'pausa')
  const activa = R.ubicarCliente(cli(), { kickoff: null, tanda: null, videos: null, meta: { activa: true, ultimoLanzamiento: '2026-11-10', semaforo: 'verde', ultimoGasto: HOY }, clickup: null, puntaje: null, hitos }, HOY, LEE)
  assert.equal(activa.etapa, 'lanzado')
  assert.match(activa.detalle, /^Campaña activa/)
})

test('escritura de fondo: sin base no hace nada ni tira', async () => {
  assert.equal(await REG.guardarLanzamientosAutomaticos([{ id: 'A950', fecha: '2026-10-29', nota: 'x' }]), 0)
  assert.doesNotThrow(() => REG.anotarLanzamientosDeFondo([{ id: 'A950', fecha: '2026-10-29', nota: 'x' }]))
})
