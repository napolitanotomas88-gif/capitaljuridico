// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-seguimiento.mjs
// Clientes y Guiones más usables (8/10/2026): puntaje 1-10, Typeform, cruce con ClickUp, trabados sin campaña y prioridades.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { leerPuntaje, estadoPorCliente, validarPuntaje } from '../lib/seguimiento/modelo.ts'
import { leerRespuestas } from '../lib/seguimiento/typeform.ts'
import { crearCruceClickUp, crearCruceCarpetas, clientesTrabados, filasDeGuiones } from '../lib/clientes/prioridad.ts'

const HOY = '2026-10-08'
const p = (fecha, id, valor, fuente = 'manual') => leerPuntaje([fecha, id, valor, fuente, '', 'Tomás'])

describe('puntaje 1 a 10', () => {
  test('lee filas válidas y descarta las rotas (fuera de 1-10, sin cliente o sin fecha)', () => {
    assert.deepEqual([p('2026-10-01 10:00', 'a001', 7).valor, p('2026-10-01', 'A001', 10).valor, p('01/10/2026', 'A001', '3').dia], [7, 10, '2026-10-01'])
    assert.equal(p('2026-10-01', 'A001', 0, 'typeform').valor, 0)   // el Typeform permite 0
    for (const fila of [['2026-10-01', 'A001', -1], ['2026-10-01', 'A001', 11], ['2026-10-01', 'A001', 7.5], ['', 'A001', 7], ['2026-10-01', '', 7]]) assert.equal(leerPuntaje(fila), null, JSON.stringify(fila))
    assert.equal(p('2026-10-01', 'A001', 8, 'Typeform').fuente, 'typeform')
  })
  test('último puntaje, tendencia frente al mes anterior y respuesta del Typeform de este mes', () => {
    const e = estadoPorCliente([p('2026-09-02', 'A001', 6), p('2026-09-20', 'A001', 5), p('2026-10-03', 'A001', 8, 'typeform'), p('2026-10-01', 'A002', 4)], HOY)
    const a = e.get('A001')
    assert.equal(a.ultimo.valor, 8); assert.equal(a.anterior.valor, 5); assert.equal(a.tendencia, 'sube'); assert.equal(a.respondioTypeformEsteMes, true)
    assert.equal(e.get('A002').tendencia, null)   // un solo mes: sin tendencia
    assert.equal(e.get('A002').respondioTypeformEsteMes, false)
    const baja = estadoPorCliente([p('2026-09-02', 'A003', 9), p('2026-10-02', 'A003', 4)], HOY).get('A003')
    assert.equal(baja.tendencia, 'baja')
    assert.equal(estadoPorCliente([p('2026-09-02', 'A004', 6), p('2026-10-02', 'A004', 6)], HOY).get('A004').tendencia, 'igual')
  })
  test('validación del toque: cliente válido, entero del 1 al 10 y nota corta sin saltos', () => {
    assert.equal(validarPuntaje({ idCliente: 'a054', valor: '7' }).ok, true)
    for (const v of ['0', '11', '7.5', 'x', '']) assert.equal(validarPuntaje({ idCliente: 'A054', valor: v }).ok, false, v)
    assert.equal(validarPuntaje({ idCliente: '../x', valor: 5 }).ok, false)
    assert.equal(validarPuntaje({ idCliente: 'A054', valor: 5, nota: 'hola\n\nchau' }).nota, 'hola chau')
  })
})

describe('Typeform (planilla de respuestas)', () => {
  const clientes = [
    { id: 'A001', nombre: 'Ana Pérez', mail: 'ana@x.com', celular: '+54 9 11 5555-1234' },
    { id: 'A002', nombre: 'Juan Gómez', mail: '', celular: '' },
    { id: 'A003', nombre: 'Juan Gómez', mail: 'otro@x.com', celular: '' },
  ]
  const filas = [
    ['Nombre', 'Email', 'Teléfono', '¿Cómo te está yendo del 1 al 10?', 'Submitted At'],
    ['Ana', 'ANA@x.com', '', 9, '2026-10-05 14:00:00'],
    ['Alguien', '', '011 5555-1234', 6, '2026-10-06'],
    ['Juan Gómez', '', '', 7, '2026-10-06'],
    ['Desconocido', 'z@z.com', '', 5, '2026-10-06'],
    ['Ana', 'ana@x.com', '', 15, '2026-10-07'],
  ]
  test('detecta la pregunta 1-10 y cruza por mail, después por teléfono; usa el valor tal cual', () => {
    const r = leerRespuestas(filas, clientes)
    assert.equal(r.columnaPuntaje, '¿Cómo te está yendo del 1 al 10?')
    assert.deepEqual(r.puntajes.map(x => [x.idCliente, x.valor, x.fuente, x.mes]), [['A001', 9, 'typeform', '2026-10'], ['A001', 6, 'typeform', '2026-10']])
  })
  test('lo que no cruza (o el nombre es ambiguo, o el puntaje está fuera de rango) queda en la bandeja sin asignar', () => {
    const r = leerRespuestas(filas, clientes)
    assert.equal(r.sinAsignar.length, 3)
    assert.ok(r.sinAsignar.some(s => s.nombre === 'Juan Gómez'))   // dos clientes con el mismo nombre: no se adivina
    assert.ok(r.sinAsignar.some(s => s.motivo.includes('fuera de 0 a 10')))
  })
  test('formato real (8/10): nombre + apellido, estudio, ID manual, 0 permitido, sin duplicados ni filas de prueba', () => {
    const crm = [
      { id: 'A022', nombre: 'Noelia Edith Benitez', mail: '', celular: '' },
      { id: 'A030', nombre: 'Lucas Ribera', mail: '', celular: '' },
      { id: 'A055', nombre: 'Brian Ibanez (Estudio Romero)', mail: '', celular: '' },
      { id: 'A099', nombre: 'Natalia Carolina Salas', mail: '', celular: '' },
    ]
    const real = [
      ['Fecha (AR)', 'Response ID', 'Nombre', 'Apellido', 'Estudio', 'Puntaje (0-10)', 'Área a mejorar', 'Qué cambiaría', 'Formulario', 'ID cliente (CRM)'],
      ['2/9/2026, 20:49:34', 'r1', 'Noelia', 'Benitez', 'Abogada.Noelia Benitez', 10, '', '', 'x', ''],
      ['2/9/2026, 20:49:34', 'r1', 'Noelia', 'Benitez', 'Abogada.Noelia Benitez', 10, '', '', 'x', ''],   // reintento del webhook
      ['2/9/2026, 20:49:56', 'r2', 'Lucas', 'Ribéra', 'Estudio Jurídico Ribera &Asoc', 0, '', '', 'x', ''],
      ['3/9/2026, 10:00:00', 'r3', 'Bri', 'I.', 'Estudio Romero', 7, '', '', 'x', ''],                        // cruza por el estudio
      ['3/9/2026, 11:00:00', 'r4', 'Nati', 'S', 'Mi estudio', 8, '', '', 'x', 'a099'],                         // ID cargado a mano
      ['4/9/2026, 12:00:00', 'r5', 'PRUEBA webhook (borrar)', '', '', 5, '', '', 'x', ''],
      ['2/9/2026, 20:24:07', 'r6', 'Tomas', 'napolitano', 'estudio juridico napolitano', 5, '', '', 'x', ''],   // no es cliente
      ['5/9/2026, 09:00:00', 'r7', 'Natali', 'Salas', '', 9, '', '', 'x', ''],                              // tipeo: Natali ↔ Natalia (apellido único)
    ]
    const r = leerRespuestas(real, crm)
    assert.equal(r.columnaPuntaje, 'Puntaje (0-10)')
    assert.equal(r.respuestas, 5)   // la de Tomás (estudio juridico napolitano) se ignora
    assert.deepEqual(r.puntajes.map(x => [x.idCliente, x.valor, x.dia]), [['A022', 10, '2026-09-02'], ['A030', 0, '2026-09-02'], ['A055', 7, '2026-09-03'], ['A099', 8, '2026-09-03'], ['A099', 9, '2026-09-05']])
    assert.deepEqual(r.sinAsignar, [])
  })
  test('sin columna de puntaje reconocible no inventa nada; con TYPEFORM_COLUMNA_PUNTAJE se fija a mano', () => {
    const otra = [['Nombre', 'Email', 'Pregunta X', 'Fecha'], ['Ana', 'ana@x.com', 8, '2026-10-01']]
    assert.equal(leerRespuestas(otra, clientes).puntajes.length, 0)
    assert.equal(leerRespuestas(otra, clientes, 'pregunta x').puntajes[0].valor, 8)
  })
})

describe('producción: ClickUp + Meta', () => {
  const t = (id, nombre, estado, extra = {}) => ({ id, nombre, estado, url: `https://app.clickup.com/t/${id}`, creada: '2026-09-01', actualizada: '2026-10-01', guionesHechos: [], ...extra })
  const tareas = [t('1', 'Rodrigo Gonzalo Calderon', 'onboarding'), t('2', 'Barbara & Diego', 'guionizar'), t('3', 'Juan Perez', 'verde'), t('4', 'Juan Perez', 'final del servicio'), t('5', 'Luz SR', 'grabación')]
  const cruce = crearCruceClickUp(tareas)
  test('cruce por nombre: completo, dupla, y sin adivinar con nombres sueltos', () => {
    assert.equal(cruce('Rodrigo Gonzalo Calderon')?.id, '1')
    assert.equal(cruce('Rodrigo Calderon')?.id, '1')                 // nombre + apellido
    assert.equal(cruce('Juan Perez')?.id, '3')                       // la que no es "final del servicio" gana
    assert.equal(cruce('Barbara Lopez'), null)                       // una sola palabra en común no alcanza
    assert.equal(cruce('Maria Gallardo'), null)
  })
  test('carpetas de Drive: apodos, apellidos con tipeo y palabras únicas, sin adivinar', () => {
    const crm = ['Florencia Daniela Toledo', 'Noelia Edith Benitez', 'Tatiana Peralta', 'Brian Ibanez (Estudio Romero)', 'Claudio Gabriel Figueroag', 'Juan Pablo Galvan Arias', 'Juan Pablo Perez', 'Agustina Vega Rojas']
    const carpetas = ['Flor Toledo', 'Noe Benitez', 'Tatiana', 'Estudio Romero', 'Gabriel Figueroa', 'Juan Pablo', 'Agus & Pau'].map((nombre, i) => ({ id: String(i), nombre }))
    const c = crearCruceCarpetas(carpetas, x => x.nombre, crm)
    assert.deepEqual(crm.map(n => c(n)?.nombre ?? null), ['Flor Toledo', 'Noe Benitez', 'Tatiana', 'Estudio Romero', 'Gabriel Figueroa', null, null, null])
    // Desempate: gana el que comparte más palabras y el mismo primer nombre
    const c2 = crearCruceCarpetas([{ id: 'x', nombre: 'José Maria' }, { id: 'y', nombre: 'Ángel Gabriel Díaz' }], x => x.nombre, ['José Maria Gallardo', 'Maria Jose Molina', 'Ángel Gabriel Díaz', 'Gabriel Angel Delgado'])
    assert.equal(c2('José Maria Gallardo')?.id, 'x'); assert.equal(c2('Maria Jose Molina'), null)
    assert.equal(c2('Ángel Gabriel Díaz')?.id, 'y'); assert.equal(c2('Gabriel Angel Delgado'), null)
  })
  test('trabados: activos en etapa previa a la campaña y SIN anuncios activos', () => {
    const clientes = [
      { id: 'A1', nombre: 'Rodrigo Gonzalo Calderon', closer: 'Carlos', estado: 'ACTIVO' },
      { id: 'A2', nombre: 'Juan Perez', closer: 'Fer', estado: 'ACTIVO' },          // verde: no está trabado
      { id: 'A3', nombre: 'Luz SR', closer: 'Gero', estado: 'ACTIVO' },             // grabación pero con campaña activa
      { id: 'A4', nombre: 'Rodrigo Gonzalo Calderon', closer: '', estado: 'FINALIZADO' },
    ]
    const campana = n => (n === 'Luz SR' ? { activa: true, ultimoLanzamiento: '2026-10-01', lanzamientoAprox: false, semaforo: 'verde', aGrabar: null } : null)
    const r = clientesTrabados(clientes, cruce, campana, '2026-10-08')
    assert.deepEqual(r.map(x => [x.idCliente, x.etapa, x.dias, x.diasCliente, x.responsable]), [['A1', 'Onboarding', 7, 37, 'Carlos']])
  })
  test('guiones: prioridad 5 sin lanzar u onboarding, 4 si fue mal, 1 si funciona; entregas desde el lanzamiento', () => {
    const clientes = [
      { id: 'A1', nombre: 'Rodrigo Gonzalo Calderon', closer: 'Carlos', estado: 'ACTIVO' },
      { id: 'A2', nombre: 'Juan Perez', closer: 'Fer', estado: 'ACTIVO' },
      { id: 'A3', nombre: 'Luz SR', closer: 'Gero', estado: 'ACTIVO' },
    ]
    const meta = { 'Juan Perez': { activa: true, ultimoLanzamiento: '2026-09-10', lanzamientoAprox: false, semaforo: 'verde', aGrabar: null },
      'Luz SR': { activa: true, ultimoLanzamiento: '2026-09-01', lanzamientoAprox: true, semaforo: 'rojo', aGrabar: 'no_rinde' } }
    const guiones = { 'Juan Perez': { ultimoGuion: '2026-10-01', fechasGuiones: ['2026-08-01', '2026-09-20', '2026-10-01'], grabado: true, ultimaGrabacion: '2026-09-25' } }
    const f = filasDeGuiones(clientes, cruce, n => meta[n] ?? null, n => guiones[n] ?? null, '2026-10-08')
    assert.deepEqual(f.map(x => [x.idCliente, x.prioridad]), [['A1', 5], ['A3', 4], ['A2', 1]])
    const juan = f.find(x => x.idCliente === 'A2')
    assert.deepEqual([juan.ultimoGuion, juan.diasDesdeGuion, juan.guionesDesdeLanzamiento, juan.grabado], ['2026-10-01', 7, 2, true])
    assert.equal(f.find(x => x.idCliente === 'A1').guionesDesdeLanzamiento, null)   // nunca lanzó
    assert.equal(f.find(x => x.idCliente === 'A3').lanzamientoAprox, true)
    // Prioridad 4 vs 3: lanzó y hoy no corre nada = urgente; amarillo o quemándose = optimización con variables
    const m2 = { 'Ana Verde': { activa: false, ultimoLanzamiento: '2026-08-01', lanzamientoAprox: false, semaforo: 'verde', aGrabar: null },
      'Beto Rojo': { activa: true, ultimoLanzamiento: '2026-08-01', lanzamientoAprox: false, semaforo: 'amarillo', aGrabar: 'quema' } }
    const c2 = crearCruceClickUp([t('9', 'Ana Verde', 'campañas activas'), t('8', 'Beto Rojo', 'verde')])
    const p2 = filasDeGuiones([{ id: 'B1', nombre: 'Ana Verde', closer: '', estado: 'ACTIVO' }, { id: 'B2', nombre: 'Beto Rojo', closer: '', estado: 'ACTIVO' }], c2, n => m2[n] ?? null, () => null, '2026-10-08')
    assert.deepEqual(p2.map(x => [x.idCliente, x.prioridad]), [['B1', 4], ['B2', 3]])
    // Sin datos de Meta (caché fría): el estado de ClickUp decide si ya lanzó y si rinde
    const cruce2 = crearCruceClickUp([t('9', 'Ana Verde', 'verde'), t('8', 'Beto Rojo', 'rojo'), t('7', 'Caro Nueva', 'onboarding')])
    const sinMeta = filasDeGuiones([{ id: 'B1', nombre: 'Ana Verde', closer: '', estado: 'ACTIVO' }, { id: 'B2', nombre: 'Beto Rojo', closer: '', estado: 'ACTIVO' }, { id: 'B3', nombre: 'Caro Nueva', closer: '', estado: 'ACTIVO' }], cruce2, () => null, () => null, '2026-10-08')
    assert.deepEqual(sinMeta.map(x => [x.idCliente, x.prioridad]), [['B3', 5], ['B2', 4], ['B1', 1]])
  })
})
