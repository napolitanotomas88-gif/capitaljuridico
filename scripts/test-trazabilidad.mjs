// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-trazabilidad.mjs  (muestra, vínculo y reporte; sin red)
import assert from 'node:assert/strict'
import { cierreDeFila, numero, fechaDeCelda, mejorVinculo, puntajeVinculo, tramoCiclo, concepto, variantesTelefono, nombreCoincide } from '../lib/trazabilidad/modelo.ts'
import { armarReporte, lectura } from '../lib/trazabilidad/reporte.ts'
import { ANGULOS_SEMILLA } from '../lib/trazabilidad/catalogo.ts'
import { textoSemanal } from '../lib/trazabilidad/semanalTexto.ts'
import { agruparFormatos, conceptoDeVideo } from '../lib/trazabilidad/formatosCalc.ts'
import { claveAnuncio } from '../lib/trazabilidad/modelo.ts'
let n = 0; const ok = (nombre, fn) => { try { fn(); n++ } catch (e) { console.error('✖', nombre); throw e } }

const fila = (o = {}) => {
  const r = Array(34).fill('')
  r[0] = o.nombre ?? 'Ana Pérez'; r[1] = o.tel ?? '+54 9 11 5555-1234'; r[2] = o.mail ?? 'ana@x.com'; r[3] = o.fecha ?? 46310
  r[21] = o.sit ?? 'Cerrado en llamada'; r[24] = o.dia1 ?? 1100; r[25] = o.trato ?? ''; r[26] = o.valor ?? 3300
  r[29] = o.grab ?? 'https://fathom.video/share/abc'
  return r
}

ok('solo entran las filas cerradas (o con plata en Trato Cerrado, como el dashboard)', () => {
  assert.equal(cierreDeFila('Closer 1', 2, fila({ sit: 'Seguimiento' }), 1100), null)
  assert.ok(cierreDeFila('Closer 1', 2, fila({ sit: 'Cerrado en seguimiento' }), 1100))
  assert.equal(cierreDeFila('Closer 1', 2, fila({ sit: '', dia1: '', trato: 2600 }), 1100).grupo, 'muestra')
  assert.equal(cierreDeFila('Closer 1', 2, fila({ sit: 'Fee', dia1: 200, trato: '' }), 1100), null)
})
ok('muestra = cobró ≥ umbral (el mayor entre día 1 y trato)', () => {
  assert.equal(cierreDeFila('C', 2, fila({ dia1: 1100 }), 1100).grupo, 'muestra')
  assert.equal(cierreDeFila('C', 2, fila({ dia1: 100, trato: 1650 }), 1100).grupo, 'muestra')
  assert.equal(cierreDeFila('C', 2, fila({ dia1: 825, trato: 825 }), 1100).grupo, 'contraste')
  assert.equal(cierreDeFila('C', 2, fila({ dia1: '', trato: '' }), 1100).grupo, 'contraste')
})
ok('concepto', () => {
  assert.equal(concepto(2600, 2600, 1100), 'PIF completo')
  assert.equal(concepto(1650, 3300, 1100), '1ª cuota o más')
  assert.equal(concepto(500, 3300, 1100), 'Seña / parcial')
})
ok('números y fechas de la planilla', () => {
  assert.equal(numero('1.100'), 1100); assert.equal(numero('1.100,50'), 1100.5); assert.equal(numero('USD 2600'), 2600); assert.equal(numero(393.74), 393.74)
  assert.equal(fechaDeCelda('19/10/2026'), '2026-10-19'); assert.equal(fechaDeCelda(46314), '2026-10-19'); assert.equal(fechaDeCelda(''), null)
})
ok('grabaciones: solo links de Fathom', () => {
  const r = fila(); r[30] = 'nota'; r[31] = 'https://fathom.video/share/zz'
  assert.deepEqual(cierreDeFila('C', 2, r, 1100).grabaciones, ['https://fathom.video/share/abc', 'https://fathom.video/share/zz'])
})

const env = (o) => ({ subscriberId: o.id, nombre: o.nombre ?? '', igUsuario: o.ig ?? '', telefono: o.tel ?? '', email: o.mail ?? '', etiquetas: [], resumen: 'x', analisis: o.analisis ?? null, error: null, enviadoPor: '', creado: '2026-10-01T00:00:00Z', actualizado: o.act ?? '2026-10-01T00:00:00Z' })
ok('vínculo: teléfono o mail = seguro; nombre completo = 0,9; un solo apellido no alcanza', () => {
  const c = cierreDeFila('C', 2, fila(), 1100)
  assert.equal(puntajeVinculo(c, env({ id: '1', tel: '11 5555 1234' })), 1)
  assert.equal(puntajeVinculo(c, env({ id: '1', mail: 'ANA@x.com ' })), 1)
  assert.equal(puntajeVinculo(c, env({ id: '1', nombre: 'Ana Pérez' })), 0.9)
  assert.equal(puntajeVinculo(c, env({ id: '1', nombre: 'Lucía Pérez' })), 0)
})
ok('vínculo: con empate de nombres no se elige ninguno', () => {
  const c = cierreDeFila('C', 2, fila({ tel: '', mail: '' }), 1100)
  assert.equal(mejorVinculo(c, [env({ id: '1', nombre: 'Ana Perez' }), env({ id: '2', nombre: 'Ana Pérez' })]), null)
  assert.equal(mejorVinculo(c, [env({ id: '1', nombre: 'Ana Perez' }), env({ id: '2', nombre: 'Otra' })]).subscriberId, '1')
})
ok('ManyChat: variantes de teléfono y coincidencia de nombre', () => {
  assert.deepEqual(variantesTelefono('+54 9 11 5555-1234'), ['+5491155551234', '+541155551234'])
  assert.deepEqual(variantesTelefono('1155551234'), ['+1155551234', '+5491155551234'])
  assert.deepEqual(variantesTelefono('123'), [])
  assert.equal(nombreCoincide('Juan Cruz Comolli', { name: 'Juan Cruz Comolli' }), true)
  assert.equal(nombreCoincide('Juan Cruz Comolli', { name: 'Juan', ig_username: 'cruz.comolli' }), true)
  assert.equal(nombreCoincide('Juan Cruz Comolli', { name: 'Juan Cruz' }), false)
  assert.equal(nombreCoincide('Gabriel', { name: 'Gabriel' }), false)
})
ok('tramos de ciclo', () => {
  assert.equal(tramoCiclo(0).id, '0'); assert.equal(tramoCiclo(5).id, '1-5'); assert.equal(tramoCiclo(11).id, '6-16')
  assert.equal(tramoCiclo(700).id, '366+'); assert.equal(tramoCiclo(null), null); assert.equal(tramoCiclo(-3), null)
})
ok('lectura fija', () => {
  assert.equal(lectura(0.5, 1, 1), '—')
  assert.equal(lectura(0.45, 1, 18), 'Atrae')
  assert.equal(lectura(0.2, 6, 4), 'Dispara')
  assert.equal(lectura(0.1, 3, 4), 'Mixto')
})

// Reporte: 4 leads de muestra con setting, 1 de contraste
const an = (gatillo, piezas, ciclo = 10, seg = 2) => ({ situacion: null, dolor: null, objetivo: null, origen: 'inbound_contenido', piezas, pieza_gatillo: gatillo, primera_interaccion: null, fecha_agenda: null, ciclo_dias: ciclo, seguimientos: seg, material_enviado: [], caso_exito_enviado: null })
const P = (e, a) => ({ etiqueta: e, tipo: 'reel', angulo: a, fecha: null })
const lead = (i, grupo, analisis, llamada = null) => ({
  cierre: { ...cierreDeFila('C', i + 2, fila({ nombre: `Lead ${i}`, dia1: grupo === 'muestra' ? 2600 : 200 }), 1100) },
  setting: analisis ? env({ id: String(i), analisis }) : null, vinculoManual: false, llamada,
})
const leads = [
  lead(1, 'muestra', an('R-IA', [P('R-IA', 'ia'), P('R-ref', 'referidos')], 3, 1)),
  lead(2, 'muestra', an('R-ref', [P('R-IA', 'ia'), P('R-ref', 'referidos')], 40, 4)),
  lead(3, 'muestra', an('R-ref2', [P('R-IA', 'ia'), P('R-ref2', null)], 400, 0)),
  lead(4, 'muestra', null, { clave: 'x', url: '', resumen: '', error: null, actualizado: '', analisis: { meta: null, situacion_actual: null, oferta_propuesta: null, motivo_decision: null, habilidad_closer: null, como_nos_conocio: null, contenido_mencionado: [], objeciones: [], arquetipo: 'A', dolores: [{ tema: 'Clientes que no pagan', angulo: null, cita: 'no me pagan' }, { tema: 'Referidos', angulo: 'referidos', cita: 'dependo del boca a boca' }] } }),
  lead(5, 'contraste', an('R-IA', [P('R-IA', 'ia')])),
]
const piezas = new Map([['R-ref2', { angulo: 'referidos' }]])
const r = armarReporte(leads, ANGULOS_SEMILLA, piezas)
ok('reporte: n, capas y contraste', () => {
  assert.equal(r.n, 4); assert.equal(r.conSetting, 3); assert.equal(r.conGatillo, 3); assert.equal(r.conLlamada, 1); assert.equal(r.contraste, 1)
  assert.equal(r.direccional, true); assert.equal(r.cobradoTotal, 4 * 2600)
})
ok('reporte: gatillo vs presencia (el catálogo de piezas manda sobre lo propuesto)', () => {
  const ia = r.angulos.find((a) => a.id === 'ia'), ref = r.angulos.find((a) => a.id === 'referidos')
  assert.equal(ia.gatillos, 1); assert.equal(ia.presencia, 3); assert.equal(ia.deCadaDiez, 3)
  assert.equal(ref.gatillos, 2); assert.equal(ref.presencia, 3)
  assert.equal(r.sinAngulo.gatillos, 0)
})
ok('reporte: ciclo, seguimientos, dolores y contraste', () => {
  assert.equal(r.cicloMediana, 40)
  assert.equal(r.ciclo.find((c) => c.tramo === '1 a 5 días').leads, 1)
  assert.equal(r.seguimientos.mediana, 1)
  assert.equal(r.dolores.length, 2); assert.ok(r.dolores.some((d) => d.angulo === null && d.tema === 'Clientes que no pagan'))
  assert.equal(r.arquetipos[0].arquetipo, 'A')
  const cIa = r.contrasteGatillos.find((x) => x.id === 'ia'); assert.equal(cIa.contraste, 1); assert.equal(cIa.pctContraste, 1)
  assert.equal(r.individual.length, 4)
})
ok('semanal: totales, días y faltantes', () => {
  const dia = (fecha, agendas, calendarios, outbound, recursos) => ({ fecha, agendas, calendarios, outbound, recursos, agendasHistorias: 0, congelado: true })
  const t = textoSemanal({ domingo: '2026-10-11', url: 'u', botonera: { total: 0, origenes: [] },
    dias: [dia('2026-10-11', 3, 2, 28, 5), dia('2026-10-12', 12, 8, 37, 5), dia('2026-10-13', 7, 2, null, null), dia('2026-10-14', 4, 5, 0, 8), dia('2026-10-15', 4, 2, 0, 6), dia('2026-10-16', 6, 5, 4, 0), dia('2026-10-17', 4, 3, 0, 2)],
    cierres: [{ nombre: 'Ana', muestra: true, setting: false, llamada: false }, { nombre: 'Beto', muestra: false, setting: false, llamada: false }] }).join('\n')
  assert.match(t, /11\/10 al 17\/10/); assert.match(t, /Agendas \*\*40\*\*/); assert.match(t, /Outbound a historias 69/)
  assert.match(t, /`Mar 13\/10` 7 ag · 2 cal · — out/); assert.match(t, /Falta el setting de: Ana$/m); assert.match(t, /\*\*0\*\* — nadie/)
})
ok('formatos: cruce de la columna Video y agrupación', () => {
  const anuncios = new Map([[claveAnuncio('Adv+ | Acting Feria | 9/7'), 'acting feria'], ['120238067681830317', 'caso caro'], [claveAnuncio('Pizarra APJ'), 'pizarra apj']])
  assert.equal(conceptoDeVideo('Adv++|+Acting+Feria+|+9/7', anuncios), 'acting feria')
  assert.equal(conceptoDeVideo('120238067681830317', anuncios), 'caso caro')
  assert.equal(conceptoDeVideo('bio', anuncios), null)
  const conceptos = [{ clave: 'acting feria', formato: 'acting', angulo: 'libertad-tiempo', gasto: 1000 }, { clave: 'pizarra apj', formato: 'pizarra', angulo: 'casos-exito', gasto: 500 }, { clave: 'caso caro', formato: 'testimonio_directo', angulo: 'casos-exito', gasto: 0 }]
  const ag = (video, closed, cobrado) => ({ fecha: '2026-10-01', video, fuente: '', presento: true, closed, cobrado, grupo: !closed ? 'no_cierre' : cobrado >= 1100 ? 'muestra' : 'contraste' })
  const r = agruparFormatos([ag('Adv++|+Acting+Feria+|+9/7', true, 2600), ag('Adv++|+Acting+Feria+|+9/7', false, 0), ag('Pizarra+APJ', true, 300), ag('bio', true, 2600), ag('otro anuncio', false, 0)], conceptos, anuncios, (c) => c.formato, true)
  assert.equal(r.sinAnuncio, 2); assert.equal(r.sinClasificar, 0)
  const acting = r.filas.find((f) => f.grupo === 'acting'); assert.equal(acting.agendas, 2); assert.equal(acting.pagadores, 1); assert.equal(acting.cashPorDolar, 2.6); assert.equal(acting.cashPorAgenda, 1300)
  const piz = r.filas.find((f) => f.grupo === 'pizarra'); assert.equal(piz.ventas, 1); assert.equal(piz.pagadores, 0)
  assert.ok(r.filas.find((f) => f.grupo === 'testimonio_directo'), 'aparece aunque no tenga agendas')
})
console.log(`✔ ${n} pruebas de trazabilidad`)
