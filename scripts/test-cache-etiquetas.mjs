// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-cache-etiquetas.mjs
// Caché compartida (lib/anuncios/cache.ts), velocidad tanda 2: etiquetas para invalidar varias claves juntas. Fuera de Next
// solo existe la capa de memoria, que es la que se prueba acá (el Data Cache se invalida con el mismo tag en producción).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { conCache, invalidarEtiqueta } = await import('../lib/anuncios/cache.ts')

test('invalidarEtiqueta tira solo las claves con esa etiqueta; la próxima lectura va a la fuente', async () => {
  const lecturas = { a: 0, b: 0, c: 0 }
  const leer = (k) => () => Promise.resolve(++lecturas[k])
  await conCache('prueba-etq-a', 60, leer('a'), { etiquetas: ['grupo-1'] })
  await conCache('prueba-etq-b', 60, leer('b'), { etiquetas: ['grupo-1', 'grupo-2'] })
  await conCache('prueba-etq-c', 60, leer('c'))
  invalidarEtiqueta('grupo-2')
  assert.equal((await conCache('prueba-etq-a', 60, leer('a'), { etiquetas: ['grupo-1'] })).data, 1)   // sigue en memoria
  assert.equal((await conCache('prueba-etq-b', 60, leer('b'), { etiquetas: ['grupo-1', 'grupo-2'] })).data, 2)
  invalidarEtiqueta('grupo-1')
  assert.equal((await conCache('prueba-etq-a', 60, leer('a'), { etiquetas: ['grupo-1'] })).data, 2)
  assert.equal((await conCache('prueba-etq-c', 60, leer('c'))).data, 1)   // sin etiqueta: intacta
})

test('Trazabilidad: toda escritura de db.ts invalida la caché de lecturas', () => {
  const src = readFileSync(new URL('../lib/trazabilidad/db.ts', import.meta.url), 'utf8')
  const escrituras = [...src.matchAll(/export async function (guardar\w*|proponer\w*|asignar\w*)\([\s\S]*?\n\}/g)]
  assert.ok(escrituras.length >= 7)
  for (const [cuerpo, nombre] of escrituras) assert.match(cuerpo, /invalidarTrazabilidad\(\)/, `${nombre} no invalida la caché`)
  // Lo que decide qué procesar lee al día
  assert.match(readFileSync(new URL('../lib/trazabilidad/leads.ts', import.meta.url), 'utf8'), /cargarDatos\(\{ alDia: true \}\)/)
})

test('Resumen: /api/raw, /api/metrics y /api/ads responden desde conCache', () => {
  for (const r of ['raw', 'metrics', 'ads']) {
    assert.match(readFileSync(new URL(`../app/api/${r}/route.ts`, import.meta.url), 'utf8'), /await conCache\(/, `/api/${r}`)
  }
  assert.match(readFileSync(new URL('../lib/rawSheets.ts', import.meta.url), 'utf8'), /invalidarEtiqueta\(ETIQUETA_RAW\)/)
})
