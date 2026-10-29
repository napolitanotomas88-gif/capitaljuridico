// Quién está conectado (lib/presencia/registro.ts, 27/10/2026).
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-presencia.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filtrarConectados, rutaLimpia, seccionDeRuta } from '../lib/presencia/registro.ts'
import { readFileSync } from 'node:fs'

test('la ruta se guarda sin query ni fragmento y con largo acotado (la query puede traer datos de un lead)', () => {
  assert.equal(rutaLimpia('/ventas/lead/Closer%201/634?nombre=Juan#x'), '/ventas/lead/Closer%201/634')
  assert.equal(rutaLimpia('javascript:alert(1)'), '/')
  assert.equal(rutaLimpia(undefined), '/')
  assert.equal(rutaLimpia('/' + 'a'.repeat(300)).length, 120)
})

test('la sección sale de la ruta (las pestañas del Hub antes que la Cartera)', () => {
  assert.equal(seccionDeRuta('/'), 'Resumen')
  assert.equal(seccionDeRuta('/ventas/closer/closer-1'), 'Ventas')
  assert.equal(seccionDeRuta('/clientes/edicion/video/3'), 'Edición')
  assert.equal(seccionDeRuta('/clientes/A101'), 'Clientes')
  assert.equal(seccionDeRuta('/guiones/12'), 'Guiones')
  assert.equal(seccionDeRuta('/raro'), 'Despacho')
})

test('conectado = avisó en los últimos 2 minutos; el más reciente primero', () => {
  const ahora = Date.parse('2026-10-27T15:00:00Z')
  const f = (email, hace) => ({ email, nombre: email, seccion: 'Ventas', ruta: '/ventas', ultima: new Date(ahora - hace).toISOString() })
  assert.deepEqual(filtrarConectados([f('a', 30_000), f('b', 150_000), f('c', 5_000)], ahora).map((x) => x.email), ['c', 'a'])
})

test('la lista de conectados la ve todo el equipo (decisión de Tomás, 27/10/2026), siempre con sesión', () => {
  const marco = readFileSync(new URL('../components/shell/MarcoShell.tsx', import.meta.url), 'utf8')
  assert.match(marco, /verConectados\n/)
  const ruta = readFileSync(new URL('../app/api/presencia/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(ruta, /solo socios/)
  assert.match(ruta, /if \(!sesion\) return json\(\{ error: 'sin sesión' \}, 401\)/)
  assert.match(ruta, /mismoOrigen\(req\.headers\)/)
})
