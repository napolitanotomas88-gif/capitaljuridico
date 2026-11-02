// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-finanzas-preferencias.mjs
// Preferencias de pantalla de Finanzas POR CUENTA (lib/finanzasSkwd/preferencias.ts, pedido de Tomás del 1/11/2026: nocturno
// por defecto y la configuración guardada por cuenta). Neon falso en memoria, sin red. Correos inventados.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const P = await import('../lib/finanzasSkwd/preferencias.ts')

// Neon falso: entiende las tres consultas del módulo (crear tabla, leer, insertar/sumar)
function neonFalso() {
  const filas = new Map()
  const consultas = []
  const sql = (partes, ...valores) => {
    const texto = partes.join('$')
    consultas.push(texto)
    if (/CREATE TABLE IF NOT EXISTS cj_preferencias_usuario/.test(texto)) return Promise.resolve([])
    if (/^\s*SELECT prefs FROM cj_preferencias_usuario/.test(texto)) {
      const f = filas.get(valores[0])
      return Promise.resolve(f ? [{ prefs: f }] : [])
    }
    if (/INSERT INTO cj_preferencias_usuario/.test(texto)) {
      const [correo, json] = valores
      const nuevo = { ...(filas.get(correo) ?? {}), ...JSON.parse(json) }
      filas.set(correo, nuevo)
      return Promise.resolve([{ prefs: nuevo }])
    }
    return Promise.reject(new Error('consulta inesperada: ' + texto))
  }
  return { sql, filas, consultas }
}

describe('normalizarPreferencias', () => {
  test('solo claves conocidas y con el tipo correcto', () => {
    assert.deepEqual(P.normalizarPreferencias({ noche: true, nav: 'riel', otra: 1 }), { noche: true, nav: 'riel' })
    assert.deepEqual(P.normalizarPreferencias({ noche: 'si', nav: 'abierta' }), {})
    assert.deepEqual(P.normalizarPreferencias(null), {})
    assert.deepEqual(P.normalizarPreferencias([1, 2]), {})
  })
})

describe('claveCorreo', () => {
  test('minúsculas y sin espacios; rechaza lo que no es correo', () => {
    assert.equal(P.claveCorreo('  Ana.Prueba@Ejemplo.TEST '), 'ana.prueba@ejemplo.test')
    assert.equal(P.claveCorreo('sin-arroba'), null)
    assert.equal(P.claveCorreo(42), null)
  })
})

describe('resolverPreferencias', () => {
  test('sin nada: nocturno y barra abierta', () => {
    assert.deepEqual(P.resolverPreferencias(null, {}), { noche: true, nav: 'panel' })
  })
  test('sin cuenta guardada manda la cookie del navegador', () => {
    assert.deepEqual(P.resolverPreferencias(null, { noche: '0', nav: 'riel' }), { noche: false, nav: 'riel' })
  })
  test('lo guardado en la cuenta manda sobre la cookie', () => {
    assert.deepEqual(P.resolverPreferencias({ noche: true }, { noche: '0', nav: 'riel' }), { noche: true, nav: 'riel' })
  })
  test('valores raros de la cookie se ignoran', () => {
    assert.deepEqual(P.resolverPreferencias(null, { noche: 'tal vez', nav: 'x' }), { noche: true, nav: 'panel' })
  })
})

describe('guardar y leer por cuenta', () => {
  let falso
  beforeEach(() => { falso = neonFalso(); P.usarSqlDePrueba(falso.sql) })

  test('cada correo tiene lo suyo', async () => {
    await P.guardarPreferencias('uno@ejemplo.test', { noche: false })
    await P.guardarPreferencias('dos@ejemplo.test', { noche: true, nav: 'riel' })
    assert.deepEqual(await P.leerPreferencias('uno@ejemplo.test'), { noche: false })
    assert.deepEqual(await P.leerPreferencias('DOS@ejemplo.test'), { noche: true, nav: 'riel' })
    assert.equal(await P.leerPreferencias('tres@ejemplo.test'), null)
  })
  test('guardar suma sin pisar las otras claves y descarta lo desconocido', async () => {
    await P.guardarPreferencias('uno@ejemplo.test', { noche: true, nav: 'riel' })
    const r = await P.guardarPreferencias('uno@ejemplo.test', { noche: false, colado: 'x' })
    assert.deepEqual(r, { noche: false, nav: 'riel' })
    assert.ok(!JSON.stringify([...falso.filas.values()]).includes('colado'))
  })
  test('la tabla se crea una sola vez', async () => {
    await P.leerPreferencias('uno@ejemplo.test')
    await P.leerPreferencias('uno@ejemplo.test')
    assert.equal(falso.consultas.filter((q) => /CREATE TABLE/.test(q)).length, 1)
  })
  test('correo inválido: no consulta y no guarda', async () => {
    assert.equal(await P.leerPreferencias('nada'), null)
    await assert.rejects(() => P.guardarPreferencias('nada', { noche: true }), /Correo no válido/)
  })
  test('sin demora: ante error o tardanza devuelve null (la página usa la cookie)', async () => {
    P.usarSqlDePrueba(() => Promise.reject(new Error('caída')))
    assert.equal(await P.leerPreferenciasSinDemora('uno@ejemplo.test'), null)
    P.usarSqlDePrueba(() => new Promise(() => {}))
    assert.equal(await P.leerPreferenciasSinDemora('uno@ejemplo.test', 30), null)
    assert.equal(await P.leerPreferenciasSinDemora(null), null)
  })
})
