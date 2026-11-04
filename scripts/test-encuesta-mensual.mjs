// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-encuesta-mensual.mjs
// Encuesta mensual sin WhatsApp (lib/clientes/encuesta/modelo.ts): rondas por día marcado, cruce, sin asignar y aviso a Discord.
import { test } from 'node:test'
import assert from 'node:assert/strict'
const M = await import('../lib/clientes/encuesta/modelo.ts')
const { respuestasDeFilas } = await import('../lib/bot/exito/rondas.ts')

const ENC = ['Fecha (AR)', 'Response ID', 'Nombre', 'Apellido', 'Estudio', 'Puntaje (0-10)', 'Área a mejorar', 'Qué cambiaría', 'Formulario', 'ID cliente (CRM)']
const fila = (fecha, id, nombre, apellido, estudio, puntaje) => [fecha, id, nombre, apellido, estudio, puntaje, '', '', 'bnvnMvVn', '']
const clientesCrm = [
  { id: 'A901', nombre: 'Ana Ejemplo', mail: '', celular: '' },
  { id: 'A902', nombre: 'Bruno Muestra', mail: '', celular: '' },
  { id: 'A903', nombre: 'Carla Ficticia', mail: '', celular: '' },
  { id: 'A904', nombre: 'Diego Inventado', mail: '', celular: '' },
]
const clientes = [
  ...clientesCrm.map((c) => ({ id: c.id, nombre: c.nombre, estado: 'ACTIVO', responsable: 'Gero M' })),
  { id: 'A905', nombre: 'Elena Finalizada', estado: 'FINALIZADO', responsable: 'Gero M' },
]
const filas = [ENC,
  fila('20/9/2026, 10:00:00', 'viejo1', 'Ana', 'Ejemplo', '', 9),     // de antes del envío: no cuenta
  fila('4/11/2026, 08:30:00', 'r1', 'Ana', 'Ejemplo', '', 8),         // mismo día del envío, antes de marcarlo: cuenta
  fila('5/11/2026, 12:00:00', 'r2', 'Bruno', 'Muestra', 'Estudio Muestra', 10),
  fila('5/11/2026, 13:00:00', 'r3', 'Juan', 'Nadie', 'Estudio Desconocido', 6), // no cruza
  fila('6/11/2026, 09:00:00', 'r4', 'Diego', 'Inventado', '', 7),          // cliente sin envío marcado
]
const envios = ['A901', 'A902', 'A903', 'A905'].map((idCrm) => ({ idCrm, dia: '2026-11-04', por: 'Tomás' }))

test('rondas: cuenta desde las 00:00 del día marcado y solo la ronda vigente', () => {
  const respuestas = respuestasDeFilas(filas, clientesCrm)
  const e = M.estadoEncuesta({ envios, respuestas, asignaciones: [], clientes, hoy: '2026-11-08' })
  assert.deepEqual(e.contestaron.map((c) => [c.id, c.valor]), [['A901', 8], ['A902', 10]])
  assert.deepEqual(e.noContestaron.map((c) => [c.id, c.dias, c.responsable]), [['A903', 4, 'Gero M']])   // A905 finalizado no aparece
  assert.equal(e.total, 3)
  assert.equal(e.promedio, 9)
  assert.deepEqual(e.sinAsignar.map((s) => [s.clave, s.sugerido]), [['r3', null], ['r4', 'A904']])
  assert.match(e.sinAsignar[1].motivo, /A904 no tiene la encuesta marcada/)
})

test('asignar a mano y descartar', () => {
  const respuestas = respuestasDeFilas(filas, clientesCrm)
  const e = M.estadoEncuesta({ envios, respuestas, asignaciones: [{ clave: 'r3', idCrm: 'a903' }, { clave: 'r4', idCrm: null }], clientes, hoy: '2026-11-08' })
  assert.deepEqual(e.contestaron.map((c) => c.id).sort(), ['A901', 'A902', 'A903'])
  assert.equal(e.noContestaron.length, 0)
  assert.equal(e.sinAsignar.length, 0)
  assert.equal(e.promedio, 8)
})

test('una ronda nueva tapa a la anterior; sin ronda nueva el pendiente sigue (no vence por días)', () => {
  const respuestas = respuestasDeFilas(filas, clientesCrm)
  const e = M.estadoEncuesta({ envios: [...envios, { idCrm: 'A901', dia: '2026-11-07', por: null }], respuestas, asignaciones: [], clientes, hoy: '2026-11-08' })
  assert.ok(e.noContestaron.some((c) => c.id === 'A901' && c.dias === 1))   // la respuesta del 4/11 es de la ronda anterior
  // 36 días después sin marcar la siguiente: A903 sigue en el aviso
  const tarde = M.estadoEncuesta({ envios, respuestas, asignaciones: [], clientes, hoy: '2026-12-10' })
  assert.deepEqual(M.pendientesDeAviso(tarde).map((f) => [f.id, f.dias]), [['A903', 36]])
  // Se marca la ronda de diciembre: deja de salir hasta el día 3 de esa ronda
  const dic = [...envios, ...['A901', 'A902', 'A903'].map((idCrm) => ({ idCrm, dia: '2026-12-01', por: null }))]
  assert.equal(M.avisoPendientes(M.estadoEncuesta({ envios: dic, respuestas, asignaciones: [], clientes, hoy: '2026-12-03' })), null)
  assert.equal(M.pendientesDeAviso(M.estadoEncuesta({ envios: dic, respuestas, asignaciones: [], clientes, hoy: '2026-12-04' })).length, 3)
  // «Sin asignar» mira solo la ronda en curso: la respuesta suelta de noviembre ya no aparece en diciembre
  assert.equal(M.estadoEncuesta({ envios: dic, respuestas, asignaciones: [], clientes, hoy: '2026-12-04' }).sinAsignar.length, 0)
})

test('recordatorio: solo el día 1; la tarde solo si no se marcó la ronda del mes; una clave por mes y turno', () => {
  assert.equal(M.recordatorioMensual('manana', '2026-12-02', []), null)
  const m = M.recordatorioMensual('manana', '2026-12-01', envios)
  assert.equal(m.clave, 'encuesta-recordatorio:2026-12:manana')
  assert.equal(m.texto, 'Hoy, día 1, toca mandar la encuesta mensual de satisfacción a los clientes activos. Cuando salga, marcala como enviada en Clientes → Encuesta.')
  const t = M.recordatorioMensual('tarde', '2026-12-01', envios)   // la ronda de noviembre no cuenta para diciembre
  assert.equal(t.clave, 'encuesta-recordatorio:2026-12:tarde')
  assert.equal(t.urgente, true)
  assert.equal(M.recordatorioMensual('tarde', '2026-12-01', [...envios, { idCrm: 'A901', dia: '2026-12-01', por: null }]), null)
})

test('aviso: desde el día 3, una línea por cliente, partido en bloques', () => {
  const respuestas = respuestasDeFilas(filas, clientesCrm)
  assert.equal(M.avisoPendientes(M.estadoEncuesta({ envios, respuestas, asignaciones: [], clientes, hoy: '2026-11-06' })), null)   // día 2: todavía no
  const a = M.avisoPendientes(M.estadoEncuesta({ envios, respuestas, asignaciones: [], clientes, hoy: '2026-11-07' }))
  assert.equal(a.titulo, 'Encuesta mensual: 1 sin contestar')
  assert.equal(a.bloques[0], 'A903 · Carla Ficticia · Gero M · 3 días (enviada el 4/11)')
  assert.match(a.lineas[0], /^Contestaron 2 de 3 · promedio 9$/)
  assert.match(a.lineas[2], /sin asignar: 2/)
  const muchos = Array.from({ length: 80 }, (_, i) => ({ id: `A${200 + i}`, nombre: 'Nombre Apellido Largo De Prueba', estado: 'ACTIVO', responsable: 'Gero M' }))
  const b = M.avisoPendientes(M.estadoEncuesta({ envios: muchos.map((c) => ({ idCrm: c.id, dia: '2026-11-01', por: null })), respuestas: [], asignaciones: [], clientes: muchos, hoy: '2026-11-08' }))
  assert.ok(b.bloques.length > 1 && b.bloques.every((x) => x.length <= 1500))
  assert.equal(b.bloques.join('\n').split('\n').length, 80)
})

test('responsable: CSM y si no, closer', () => {
  assert.equal(M.responsableDe({ csm: 'Gero M', closer: 'Marcos' }), 'Gero M')
  assert.equal(M.responsableDe({ csm: '', closer: 'Marcos' }), 'Marcos')
  assert.equal(M.responsableDe({}), 'sin responsable')
})
