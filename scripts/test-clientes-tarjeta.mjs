// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-clientes-tarjeta.mjs
// Velocidad 3 (13/11/2026): la tarjeta del cliente se abre y se cierra sin rearmar la cartera. La URL (?cliente=<ID>) cambia
// con history.pushState y solo la tarjeta llega del servidor (tarjetaDelCliente). Reglas puras + guardas del código fuente.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const T = await import('../lib/clientes/tarjetaUrl.ts')
const leer = ruta => readFileSync(new URL(`../app/(shell)/clientes/(cartera)/_componentes/${ruta}`, import.meta.url), 'utf8')

test('urlConCliente: abre y cierra la tarjeta conservando los demás parámetros', () => {
  assert.equal(T.urlConCliente('/clientes', '?demo=1', 'A001'), '/clientes?demo=1&cliente=A001')
  assert.equal(T.urlConCliente('/clientes', '?demo=1&cliente=A001', 'B002'), '/clientes?demo=1&cliente=B002')
  assert.equal(T.urlConCliente('/clientes', '?demo=1&cliente=A001&accion=pago', null), '/clientes?demo=1&accion=pago')
  assert.equal(T.urlConCliente('/clientes', '?cliente=A001', null), '/clientes', 'sin parámetros no queda un «?» suelto')
  assert.equal(T.urlConCliente('/clientes', '', 'Z001'), '/clientes?cliente=Z001')
})

test('clienteDelPanel: solo abre clientes del recorrido, sin importar mayúsculas', () => {
  const filas = [{ id: 'A001' }, { id: 'Z001' }]
  assert.equal(T.clienteDelPanel('a001', filas), 'A001')
  assert.equal(T.clienteDelPanel('Z001', filas), 'Z001')
  assert.equal(T.clienteDelPanel('B002', filas), null, 'un ID que no está en el recorrido lo avisa el servidor')
  assert.equal(T.clienteDelPanel('', filas), null)
  assert.equal(T.clienteDelPanel(null, filas), null)
})

test('abrir y cerrar no le piden la página al servidor: pushState/replaceState/back, sin router.push ni router.replace', () => {
  const linea = leer('LineaTiempo.tsx')
  assert.match(linea, /window\.history\.pushState\(null, '', urlCon\(id\)\)/)
  assert.match(linea, /window\.history\.replaceState\(null, '', urlCon\(null\)\)/)
  assert.match(linea, /window\.history\.back\(\)/)
  assert.doesNotMatch(linea, /router\.(push|replace|back)\(/)
  // La tarjeta llega sola y en una transición (sin la espera de 300 ms con que React revela un Suspense nuevo)
  assert.match(linea, /tarjetaDelCliente\(idPanel, \{ demo, accion \}\)/)
  assert.match(linea, /startTransition\(\(\) => setContenido\(/)
  // Lo que arma el servidor con la página (enlace directo, router.refresh de las acciones) manda sobre lo traído
  assert.match(linea, /if \(abierto && detalle\) \{\s*setContenido\(\{ id: abierto, nodo: detalle \}\)/)
})

test('tarjetaDelCliente: función de servidor con las mismas barreras que la página', () => {
  const accion = leer('accionTarjeta.ts')
  assert.match(accion, /^'use server'/)
  const cuerpo = accion.slice(accion.indexOf('export async function tarjetaDelCliente'))
  assert.match(cuerpo.split('\n')[1], /const sesion = await exigirAcceso\('clientes'\)/, 'la sesión y el permiso van primero')
  assert.match(cuerpo, /ID_CLIENTE_VALIDO\.test\(id\)/)
  assert.match(cuerpo, /const demo = pedidoDemo\(/, '?demo=1 solo en desarrollo')
  assert.match(cuerpo, /cargarVista\(demo, !verCobros \? 'omitir' : modoCobros\(await cookies\(\)\)\)/, 'cobros solo con Finanzas, como la página')
  assert.doesNotMatch(cuerpo, /revalidatePath|revalidateTag|\.set\(/, 'leer la tarjeta no debe disparar un refresco de la página')
})

test('el enlace directo y la tarjeta sola dibujan la misma tarjeta (nodoTarjeta)', () => {
  const enVivo = leer('EnVivo.tsx')
  const usos = enVivo.match(/nodoTarjeta\(c, fila, sesion, vista\.esDemo, accion\)/g) ?? []
  assert.equal(usos.length, 2)
  assert.match(enVivo, /export async function tarjetaSola\(/)
})
