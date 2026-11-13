// HUB_PRUEBAS_SIN_RED=1 HUB_CONFIG_PRIVADA_DIR=./private-config.example node --experimental-strip-types --no-warnings --import ./scripts/fixtures-entorno.mjs --import ./scripts/ts-resolve.mjs --test scripts/test-anuncios-rama-planilla.mjs
// Rama por cuenta desde la columna D «Rama» de «Cuentas Meta» (13/11/2026): cómo se lee el valor, la prioridad entre fuentes
// (ajuste privado → planilla → ClickUp → nombre de la cuenta), que el cruce la trae de la fila de la cuenta, que los rangos de
// lectura llegan a la columna D, y que las pestañas del hub van en una sola fila en escritorio sin achicar la letra.
// Puro: sin red ni base. Cuentas y nombres inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const k of ['DATABASE_URL']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const R = await import('../lib/anuncios/ramas.ts')
const { crearCruce } = await import('../lib/anuncios/cruce.ts')

test('columna D: id o nombre visible, sin mayúsculas ni tildes; vacío = nada; lo raro = desconocida', () => {
  assert.equal(R.ramaDeTexto('laboral'), 'laboral')
  assert.equal(R.ramaDeTexto('  ART '), 'art')
  assert.equal(R.ramaDeTexto('Tránsito'), 'transito')
  assert.equal(R.ramaDeTexto('GERIATRICO'), 'geriatrico')
  assert.equal(R.ramaDeTexto('Accidentes de transito'), 'transito')
  assert.equal(R.ramaDeTexto('ciudadanía / internacional'), 'internacional')
  assert.equal(R.ramaDeTexto('Laboral (despidos)'), 'laboral')
  assert.equal(R.ramaDeTexto(''), null)
  assert.equal(R.ramaDeTexto(undefined), null)
  assert.equal(R.ramaDeTexto('Derecho espacial'), 'desconocida')
  for (const r of Object.keys(R.NOMBRE_RAMA)) {
    assert.equal(R.ramaDeTexto(r), r, r)
    assert.equal(R.ramaDeTexto(R.NOMBRE_RAMA[r]), r, R.NOMBRE_RAMA[r])
  }
})

test('prioridad: ajuste privado → planilla → ClickUp → nombre de la cuenta; lo desconocido se ignora y se avisa', () => {
  assert.deepEqual(R.elegirRama({ manual: 'penal', planilla: 'laboral', clickup: 'familia', cuenta: 'salud' }), { rama: 'penal', fuente: 'manual', desconocida: null })
  assert.deepEqual(R.elegirRama({ planilla: 'Sucesiones', clickup: 'familia', cuenta: 'salud' }), { rama: 'sucesiones', fuente: 'planilla', desconocida: null })
  assert.deepEqual(R.elegirRama({ planilla: '', clickup: 'familia', cuenta: 'salud' }), { rama: 'familia', fuente: 'clickup', desconocida: null })
  assert.deepEqual(R.elegirRama({ planilla: 'cualquier cosa', clickup: 'familia' }), { rama: 'familia', fuente: 'clickup', desconocida: 'cualquier cosa' })
  assert.deepEqual(R.elegirRama({ cuenta: 'salud' }), { rama: 'salud', fuente: 'cuenta', desconocida: null })
  assert.deepEqual(R.elegirRama({}), { rama: null, fuente: null, desconocida: null })
  // Con ajuste privado, un valor raro en la planilla igual se avisa (para corregirlo)
  assert.equal(R.elegirRama({ manual: 'penal', planilla: 'xx' }).desconocida, 'xx')
})

test('el cruce trae la columna D de la fila de «Cuentas Meta» de la cuenta (por id o por nombre)', () => {
  const datos = {
    clientes: [{ nombre: 'Estudio Ejemplo Uno', estado: 'ACTIVO', id: 'Z001' }],
    cuentasMeta: [
      { cuenta: '555000111', actual: true, clienteCRM: 'Estudio Ejemplo Uno', rama: 'Geriátrico' },
      { cuenta: 'USD Cuenta Ejemplo Dos', actual: true, clienteCRM: '', rama: '' },
      { cuenta: 'Cuenta vieja sin columna D', actual: true, clienteCRM: '' },   // filas leídas antes del cambio (caché)
    ],
    alias: [], guiones: [], errores: [],
  }
  const cruce = crearCruce(datos)
  assert.equal(cruce.resolverCliente({ id: 'act_555000111', nombre: 'Otra cuenta' }).ramaPlanilla, 'Geriátrico')
  assert.equal(cruce.resolverCliente({ id: 'act_1', nombre: 'USD Cuenta Ejemplo Dos' }).ramaPlanilla, '')
  assert.equal(cruce.resolverCliente({ id: 'act_2', nombre: 'Cuenta vieja sin columna D' }).ramaPlanilla, '')
  assert.equal(cruce.resolverCliente({ id: 'act_3', nombre: 'Sin fila' }).ramaPlanilla, '')
})

test('los rangos de «Cuentas Meta» llegan a la columna D (y el resto no cambia)', () => {
  const sheets = readFileSync(new URL('../lib/anuncios/sheets.ts', import.meta.url), 'utf8')
  assert.match(sheets, /'Cuentas Meta'!A1:D300/)
  assert.match(sheets, /'Agencia!A1:C400'/)
  assert.match(sheets, /rama: txt\(r\[3\]\)/)
  const raw = readFileSync(new URL('../lib/rawSheets.ts', import.meta.url), 'utf8')
  assert.match(raw, /'Cuentas Meta'!A1:D120/)
  assert.doesNotMatch(raw, /'Cuentas Meta'!A1:C120/)
})

test('pestañas del hub: una sola fila en escritorio (se desplaza en horizontal) y sin letra menor a 12 px', () => {
  const css = readFileSync(new URL('../components/shell/pestanasClientes.css', import.meta.url), 'utf8')
  const escritorio = css.slice(css.indexOf('@media (min-width: 769px)'))
  assert.ok(escritorio.length > 30, 'falta el bloque de escritorio')
  assert.match(escritorio, /\.cj-hub__lista \{[^}]*flex-wrap: nowrap/)
  assert.match(escritorio, /\.cj-hub__lista \{[^}]*overflow-x: auto/)
  assert.match(escritorio, /\.cj-hub\.cj-hub:has\(\.mr\) \{ flex-wrap: nowrap; \}/)
  assert.doesNotMatch(escritorio.slice(0, escritorio.indexOf('prefers-reduced-motion')), /display: none/)
  for (const m of css.matchAll(/font-size:\s*([\d.]+)px/g)) assert.ok(Number(m[1]) >= 12, `letra de ${m[1]} px`)
})
