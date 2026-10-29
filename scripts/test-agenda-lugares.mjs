// Lugares de agenda por closer (lib/agendaLugares.ts, pedido de Tomás del 26/10/2026).
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-agenda-lugares.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contarLugares, dentroDeHorario, hostLibre, nivelDeEvento, nivelDeNombre, puedePisar } from '../lib/agendaLugares.ts'

const TZ = 'America/Argentina/Buenos_Aires'
// Lunes 27/10/2026 en hora argentina (UTC-3)
const ar = (hhmm, dia = '2026-10-27') => new Date(`${dia}T${hhmm}:00-03:00`)
const semana = (from, to) => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((wday) => ({ type: 'wday', wday, intervals: [{ from, to }] }))

test('nivel de una reserva por su nombre (nombres del 26/10; las viejas "Reunión Consultiva" cuentan como A/B)', () => {
  assert.equal(nivelDeNombre('Reunión Consultiva'), 1)
  assert.equal(nivelDeNombre('Reunión Consultiva - Capital Jurídico'), 2)
  assert.equal(nivelDeNombre('Reunión Consultiva con el equipo de Capital Jurídico'), 2)
  assert.equal(nivelDeNombre('Reunión Consultiva con Capital Jurídico'), 3)
  assert.equal(nivelDeNombre('Reunión Consultiva - Reagenda Carlos'), 0)
  assert.equal(nivelDeNombre('Reunión WEBINAR'), 0)
  assert.equal(nivelDeEvento('Leads A y B - 2 DÍAS DE AGENDA', 'x'), 1)
  assert.equal(nivelDeEvento('Leads C - 2 DÍAS DE AGENDA', 'x'), 2)
  assert.equal(nivelDeEvento('Leads D+E - 2 DÍAS DE AGENDA', 'x'), 3)
})

test('quién pisa a quién: A/B pisa a C y D+E, C pisa a D+E, nunca el mismo nivel ni una reagenda', () => {
  assert.equal(puedePisar(1, 2), true)
  assert.equal(puedePisar(1, 3), true)
  assert.equal(puedePisar(2, 3), true)
  assert.equal(puedePisar(2, 2), false)
  assert.equal(puedePisar(3, 2), false)
  assert.equal(puedePisar(1, 1), false)
  assert.equal(puedePisar(1, 0), false)
})

test('horario del host: la reunión entera tiene que entrar (y las fechas puntuales mandan sobre el día de la semana)', () => {
  const reglas = semana('09:00', '13:00')
  assert.equal(dentroDeHorario(reglas, TZ, ar('12:00'), 60), true)
  assert.equal(dentroDeHorario(reglas, TZ, ar('12:30'), 60), false)
  assert.equal(dentroDeHorario([...reglas, { type: 'date', date: '2026-10-27', intervals: [] }], TZ, ar('10:00'), 60), false)
})

test('libre u ocupado según el nivel: una reserva de D+E no ocupa para A/B, sí para D+E; lo externo siempre ocupa', () => {
  const h = { nombre: 'Marcos', reglas: semana('09:00', '20:00'), tz: TZ, ocupado: [{ inicio: ar('10:00'), fin: ar('11:00'), nivel: 3 }] }
  assert.equal(hostLibre(h, ar('10:00'), 60, 1), true)
  assert.equal(hostLibre(h, ar('10:00'), 60, 3), false)
  assert.equal(hostLibre(h, ar('10:30'), 60, 2), true)
  const ext = { ...h, ocupado: [{ inicio: ar('10:00'), fin: ar('11:00'), nivel: 0, externo: true }] }
  assert.equal(hostLibre(ext, ar('10:00'), 60, 1), false)
})

test('cuenta reuniones que entran, no horarios: un closer libre de 9 a 11 suma 2 aunque Calendly ofrezca 9:00, 9:30 y 10:00', () => {
  const horarios = [ar('09:00'), ar('09:30'), ar('10:00')]
  const carlos = { nombre: 'Carlos Roletto', reglas: semana('09:00', '11:00'), tz: TZ, ocupado: [] }
  const r = contarLugares({ horarios, hosts: [carlos], duracionMin: 60, nivel: 1 })
  assert.equal(r.total, 2)
  assert.deepEqual(r.porDia, { '2026-10-27': { 'Carlos Roletto': 2 } })
})

test('dos closers libres en el mismo horario son dos lugares (Calendly lo muestra una sola vez)', () => {
  const horarios = [ar('15:00')]
  const hosts = ['Carlos Roletto', 'Marcos Carlomagno'].map((nombre) => ({ nombre, reglas: semana('09:00', '20:00'), tz: TZ, ocupado: [] }))
  const r = contarLugares({ horarios, hosts, duracionMin: 60, nivel: 1 })
  assert.equal(r.total, 2)
  assert.equal(r.sinCloser, 0)
})

test('tope diario: Yamila con 3 por día y 2 ya reservadas suma 1 más ese día', () => {
  const horarios = [ar('09:00'), ar('10:00'), ar('11:00')]
  const yami = { nombre: 'Yamila Coutoune', reglas: semana('09:00', '13:00'), tz: TZ, ocupado: [], reservasPorDia: { '2026-10-27': 2 }, tope: 3 }
  assert.equal(contarLugares({ horarios, hosts: [yami], duracionMin: 60, nivel: 2 }).total, 1)
})

test('un horario que Calendly ofrece sin closer libre se cuenta aparte (sinCloser), no como lugar', () => {
  const horarios = [ar('22:00')]
  const carlos = { nombre: 'Carlos Roletto', reglas: semana('09:00', '20:00'), tz: TZ, ocupado: [] }
  const r = contarLugares({ horarios, hosts: [carlos], duracionMin: 60, nivel: 1 })
  assert.deepEqual([r.total, r.sinCloser], [0, 1])
})
