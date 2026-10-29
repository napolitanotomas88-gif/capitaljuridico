import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historialOperativo, inicioPausaVigente } from '../lib/clientes/historialOperativo.ts'
import { accionesDemoHistorial } from '../lib/clientes/historialOperativoDemo.ts'

const accion = (id, datos, aplicada, extra = {}) => ({ id, idCrm: 'A078', tipo: datos.tipo, datos, plan: [], modo: 'real', estado: 'aplicada', creada: aplicada ?? '2026-11-01T12:00:00Z', aplicada, anulada: null, resumen: '', quien: 'Equipo', error: null, ...extra })
const periodo = (extra = {}) => ({ fila: 2, idCliente: 'A078', nombre: 'Cliente de prueba', periodo: 0, dia1: '2026-06-25', fin: '2026-11-22', precio: 2600, notas: 'Contrató cinco meses desde el inicio', meses: 5, esExtension: false, esRenovacionPaga: false, ...extra })
const pausa = accion('ac_pausa', { tipo: 'pausa', desde: '2026-11-01' }, '2026-11-01T12:00:00Z')
const retoma = accion('ac_retoma', { tipo: 'reanudar', fecha: '2026-11-10' }, '2026-11-10T12:00:00Z', { plan: [
  { hoja: 'Renovaciones · fila nueva', celda: 'Día 1', antes: '', despues: '2026-11-22' },
  { hoja: 'Renovaciones · fila nueva', celda: 'Finalización', antes: '', despues: '2026-12-01' },
] })

test('conserva período inicial y ordena puntos de pausa, retoma y extensión por sus fechas reales', () => {
  const extension = accion('ac_extra', { tipo: 'servicio', duracion: '1m', motivo: 'bonificación por renovación' }, '2026-11-20T12:00:00Z')
  const r = historialOperativo([extension, retoma, pausa], [periodo()], false)
  assert.deepEqual(r.map(e => e.fecha), ['2026-06-25', '2026-11-01', '2026-11-10', '2026-11-20'])
  assert.equal(r[0].titulo, 'Inicio del servicio')
  assert.doesNotMatch(r[0].detalle, /gratis|beneficio|bonifica/i, 'cinco meses iniciales no prueban un mes extra')
  assert.match(r[2].detalle, /Pausa desde el 01\/11\/2026/)
  assert.match(r[2].detalle, /9 días compensados/)
  assert.match(r[2].detalle, /01\/12\/2026/)
  assert.match(r[3].detalle, /Bonificación por renovación/)
  assert.equal(inicioPausaVigente([extension, retoma, pausa]), null)
})

test('deshacer retoma conserva su punto, agrega la reversa y vuelve a exponer la pausa original', () => {
  const anulada = { ...retoma, estado: 'anulada', anulada: '2026-11-11T12:00:00Z' }
  const r = historialOperativo([anulada, pausa], [], false)
  assert.deepEqual(r.map(e => e.id), ['ac_pausa', 'ac_retoma', 'ac_retoma:reversa'])
  assert.equal(r[1].anulada, true)
  assert.equal(r[2].fecha, '2026-11-11')
  assert.match(r[2].titulo, /Se deshizo/)
  assert.equal(inicioPausaVigente([anulada, pausa]), '2026-11-01')
})

test('un período con marca de acción no duplica la extensión ni su reversa', () => {
  const anulada = { ...retoma, estado: 'anulada', anulada: '2026-11-11T12:00:00Z' }
  const p = periodo({ fila: 3, periodo: 1, dia1: '2026-11-22', fin: '2026-12-01', precio: 0, notas: 'Extensión +9 días — compensa pausa · acción ac_retoma', esExtension: true })
  const r = historialOperativo([anulada, pausa], [periodo(), p], false)
  assert.equal(r.filter(e => e.id.startsWith('periodo:')).length, 1)
  assert.equal(r.filter(e => e.id === 'ac_retoma').length, 1)
})

test('sin Finanzas no salen pagos, importes, cuentas ni textos libres que puedan contener dinero', () => {
  const importe = 9371.23
  const pago = accion('ac_pago', { tipo: 'pago', fecha: '2026-11-05', usd: importe, concepto: 'PIF', cuenta: 'Empresa-secreto' }, '2026-11-05T12:00:00Z', { resumen: `USD ${importe}` })
  const renovacion = accion('ac_renovacion', { tipo: 'renovacion', inicio: '2026-11-22', meses: 4, precio: importe }, '2026-11-06T12:00:00Z')
  const cobro = accion('ac_cobro', { tipo: 'datos', cambios: [{ campo: 'proximoCobro', valor: '2026-12-15' }] }, '2026-11-07T12:00:00Z')
  const r = historialOperativo([pago, renovacion, cobro], [periodo({ precio: importe, notas: `Programa inicial USD ${importe}` })], false)
  assert.ok(!JSON.stringify(r).includes(String(importe)))
  assert.ok(!JSON.stringify(r).includes('Empresa-secreto'))
  assert.equal(r.some(e => e.id === pago.id || e.id === cobro.id), false)
  assert.ok(r.every(e => e.monto === null))
  const con = historialOperativo([pago], [], true)
  assert.equal(con[0].monto, importe)
  assert.equal(con[0].fecha, '2026-11-05')
})

test('no inventa fechas históricas ni considera simulaciones o pedidos pendientes como hechos', () => {
  const sinFecha = accion('ac_legacy', { tipo: 'servicio', duracion: '1m' }, null)
  const r = historialOperativo([sinFecha, { ...pausa, id: 'ac_simulada', modo: 'sombra' }, { ...retoma, id: 'ac_pendiente', estado: 'registrada' }], [periodo({ dia1: null, fin: null })], false)
  assert.equal(r.length, 2)
  assert.ok(r.every(e => e.fecha === null))
  assert.equal(r.some(e => /2026-11-01/.test(e.fecha ?? '')), false)
  assert.equal(historialOperativo([pausa, { ...pausa, id: 'ac_sombra_original', modo: 'sombra', estado: 'registrada' }], [], false).length, 1, 'la pausa real no duplica el intento anterior en sombra')
})

test('el modo demo sintetiza dos puntos de prueba y nueve días compensados, sin base', () => {
  const demo = accionesDemoHistorial('2026-10-29', '2027-02-10')
  const eventos = historialOperativo(demo, [], false)
  assert.equal(eventos.length, 2)
  assert.ok(eventos.every(e => e.prueba))
  assert.deepEqual(eventos.map(e => e.fecha), ['2026-10-15', '2026-10-24'])
  assert.match(eventos[1].detalle, /9 días compensados/)
})

test('una pausa heredada sólo usa la fecha aportada y no afirma compensación sin plan confirmado', () => {
  const r = historialOperativo([accion('ac_heredada', { tipo: 'reanudar', desdePausa: '2026-10-20', fecha: '2026-11-01' }, '2026-11-01T12:00:00Z')], [], false)[0]
  assert.match(r.detalle, /Pausa de 12 días/)
  assert.match(r.detalle, /Sin detalle de compensación registrado/)
  assert.doesNotMatch(r.detalle, /12 días compensados/)
  const tarde = historialOperativo([accion('ac_noche', { tipo: 'archivar', motivo: 'Fin', confirmacion: 'Cliente', confirmado: true }, '2026-11-02T02:00:00Z')], [], false)[0]
  assert.equal(tarde.fecha, '2026-11-01', 'los sellos UTC se muestran en el día argentino')
})

test('renovación conserva los meses de referidos confirmados y su fin sin exponer datos financieros', () => {
  const renovacion = accion('ac_renovacion_auto', { tipo: 'renovacion', inicio: '2026-11-22', meses: 4, precio: 9382.17 }, '2026-11-20T12:00:00Z', {
    renovacionReferidos: { mesesContratados: 4, mesesReferidos: 1, mesesTotales: 5, finContrato: '2027-03-22', finServicio: '2027-04-22', canjeId: 'M001' },
    resultado: { renovacionReferidos: { usdPendiente: 791.13, huella: 'privada-no-visible' } },
  })
  const r = historialOperativo([renovacion], [], false)
  assert.equal(r.length, 1)
  assert.match(r[0].detalle, /4 meses contratados/)
  assert.match(r[0].detalle, /automáticamente 1 mes liberado por referidos/)
  assert.match(r[0].detalle, /Total: 5 meses/)
  assert.match(r[0].detalle, /22\/04\/2027/)
  assert.doesNotMatch(JSON.stringify(r), /9382|791|privada-no-visible|M001/)
  const deshecha = historialOperativo([{ ...renovacion, estado: 'anulada', anulada: '2026-11-21T12:00:00Z' }], [], false)
  assert.equal(deshecha[0].anulada, true)
  assert.match(deshecha[1].titulo, /Se deshizo/)
  const sinEvidencia = historialOperativo([{ ...renovacion, renovacionReferidos: undefined }], [], false)
  assert.doesNotMatch(sinEvidencia[0].detalle, /referidos|automáticamente|5 meses/)
})
