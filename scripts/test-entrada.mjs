// Entrada animada del Despacho (components/shell/entradaLogica.ts, 13/11/2026): cifras y «solo la primera vez».
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings --test scripts/test-entrada.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { CLAVE_VISTA, SCRIPT_ENTRADA, TIEMPOS, escribirCifra, escudoDentroDelLogo, leerCifra, textoEn, vuelo } from '../components/shell/entradaLogica.ts'

test('lee números limpios con su formato: miles, decimales, moneda y %', () => {
  assert.deepEqual(leerCifra('94'), { prefijo: '', sufijo: '', valor: 94, decimales: 0, miles: '', coma: '.' })
  assert.equal(leerCifra('5.500').valor, 5500)
  assert.equal(leerCifra('5.500').miles, '.')
  assert.equal(leerCifra('1.234.567,89').valor, 1234567.89)
  assert.equal(leerCifra('USD 12.300').prefijo, 'USD ')
  assert.equal(leerCifra('26%').sufijo, '%')
  assert.equal(leerCifra('26 %').sufijo, ' %')
  assert.equal(leerCifra('3,5').valor, 3.5)
  assert.equal(leerCifra('−1.200').prefijo, '−')
})

test('no toca lo que no es un número limpio', () => {
  for (const t of ['', '—', '3 de 5', '13/11/2026', '15:20', 'día 8', 'Grabación', '1.2.3,4,5', '12-14', 'abc 3']) assert.equal(leerCifra(t), null, t)
})

test('los valores intermedios respetan el formato y el final es EXACTAMENTE el original', () => {
  const originales = ['5.500', 'USD 12.300', '1.234.567,89', '26%', '94', '3,5', '−1.200']
  for (const o of originales) {
    const c = leerCifra(o)
    assert.equal(escribirCifra(c, c.valor), o, `reescritura de ${o}`)
    assert.equal(textoEn(o, c, TIEMPOS.cifraDura, TIEMPOS.cifraDura), o)
    assert.equal(textoEn(o, c, 99999, TIEMPOS.cifraDura), o)
  }
  const c = leerCifra('5.500')
  assert.equal(escribirCifra(c, 0), '0')
  assert.equal(escribirCifra(c, 1234.4), '1.234')
  assert.equal(escribirCifra(leerCifra('1.234.567,89'), 1000.5), '1.000,50')
  // A mitad de camino va por arriba de la mitad (arranca rápido, llega despacio) y nunca pasa del valor
  const medio = leerCifra(textoEn('5.500', c, TIEMPOS.cifraDura / 2, TIEMPOS.cifraDura).replace('.', ''))
  assert.ok(medio.valor > 2750 && medio.valor < 5500)
})

test('vuelo: lleva el centro del escudo al centro del destino con su ancho', () => {
  assert.deepEqual(vuelo({ left: 683, top: 340, width: 74, height: 109 }, { left: 20, top: 30, width: 37, height: 54.5 }), { dx: -681.5, dy: -337.25, s: 0.5 })
  assert.equal(vuelo({ left: 0, top: 0, width: 0, height: 0 }, { left: 1, top: 1, width: 1, height: 1 }), null)
  const caja = escudoDentroDelLogo({ left: 28, top: 40, width: 150, height: 72.26 })
  assert.equal(caja.left, 28)
  assert.ok(Math.abs(caja.width / caja.height - 555.02 / 816.96) < 0.01) // la proporción del isotipo
})

// El script en línea, corrido tal cual en un entorno falso de navegador
function correrScript({ guardado = null, reducido = false, sinStorage = false } = {}) {
  const attrs = new Map()
  const telon = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) }
  const almacen = new Map(guardado ? [[CLAVE_VISTA, guardado]] : [])
  const escuchas = new Map()
  const relojes = []
  const window = {
    performance: { now: () => 1234 },
    matchMedia: (q) => ({ matches: reducido && q.includes('reduce') }),
    addEventListener: (t, f) => escuchas.set(t, f),
    removeEventListener: (t) => escuchas.delete(t),
  }
  Object.defineProperty(window, 'sessionStorage', {
    get() {
      if (sinStorage) throw new Error('SecurityError')
      return { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v) }
    },
  })
  const ctx = { window, document: { getElementById: (id) => (id === 'cj-telon' ? telon : null) }, setTimeout: (f, ms) => relojes.push({ f, ms }), clearTimeout: () => {} }
  vm.runInNewContext(SCRIPT_ENTRADA, ctx)
  return { attrs, almacen, escuchas, relojes, estado: window.__cjEntrada }
}

test('primera vez en la sesión: marca el telón, guarda la marca y deja la red de seguridad', () => {
  const r = correrScript()
  assert.equal(r.attrs.get('data-fase'), 'anda')
  assert.equal(r.almacen.get(CLAVE_VISTA), '1')
  assert.equal(r.estado.t0, 1234)
  assert.deepEqual([...r.escuchas.keys()].sort(), ['keydown', 'pointerdown'])
  assert.equal(r.relojes[0].ms, TIEMPOS.seguridad)
})

test('ya vista, movimiento reducido o sin sessionStorage: no toca nada', () => {
  for (const op of [{ guardado: '1' }, { reducido: true }, { sinStorage: true }]) {
    const r = correrScript(op)
    assert.equal(r.attrs.has('data-fase'), false, JSON.stringify(op))
    assert.equal(r.estado, undefined)
  }
  // Con movimiento reducido igual queda vista (no se muestra después si se apaga la preferencia en la misma sesión)
  assert.equal(correrScript({ reducido: true }).almacen.get(CLAVE_VISTA), '1')
})

test('saltar (clic, tecla o la red de seguridad) deja la página normal una sola vez y avisa a React', () => {
  const r = correrScript()
  r.attrs.set('data-contenido', '')
  let avisos = 0
  r.estado.alTerminar = () => { avisos++ }
  r.escuchas.get('keydown')()
  assert.equal(r.attrs.size, 0)
  assert.equal(r.estado.listo, true)
  assert.equal(r.escuchas.size, 0)
  r.relojes[0].f() // la red de seguridad después ya no hace nada
  assert.equal(avisos, 1)
})
