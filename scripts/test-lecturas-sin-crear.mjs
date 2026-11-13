// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-lecturas-sin-crear.mjs
// Velocidad 3 (13/11/2026): las lecturas que corren al abrir /clientes y la tarjeta no crean tablas. Un CREATE TABLE IF NOT
// EXISTS en una lectura suma una ida a Neon en cada arranque en frío; «tabla inexistente» (42P01) cuenta como vacío, como
// en lib/edicion/db/base.ts. Sin red: el fetch del cliente HTTP de Neon se reemplaza y se anota cada SQL que sale.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const enviados = []
let responder = () => ({ estado: 200, cuerpo: { fields: [], rows: [], command: 'SELECT', rowCount: 0, rowAsArray: false } })
const fetchReal = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('falso.invalid')) return fetchReal(url, init)
  const { query } = JSON.parse(init.body)
  enviados.push(query)
  const r = responder(query)
  return new Response(JSON.stringify(r.cuerpo), { status: r.estado, headers: { 'content-type': 'application/json' } })
}
process.env.DATABASE_URL = 'postgres://u:p@ep-falso.falso.invalid/neondb'

const B = await import('../lib/bot/anuncios/docAdsBaseNeon.ts')

test('línea de base del Doc de ADS (la lee el tablero que arma la cartera): sin tabla = [] y sin CREATE', async () => {
  enviados.length = 0
  responder = () => ({ estado: 400, cuerpo: { message: 'relation "cj_anuncios_doc_base" does not exist', code: '42P01' } })
  assert.deepEqual(await B.leerFilasBase(), [])
  assert.equal(await B.leerLineaBase(), null)
  assert.ok(enviados.length > 0 && enviados.every(q => /^SELECT/.test(q.trim())), `solo lecturas: ${enviados.join(' | ')}`)
})

test('línea de base: con tabla devuelve las filas; otro error se propaga', async () => {
  enviados.length = 0
  responder = () => ({ estado: 200, cuerpo: { fields: [{ name: 'huella', dataTypeID: 25 }, { name: 'tipo', dataTypeID: 25 }, { name: 'bloque', dataTypeID: 25 }, { name: 'listo', dataTypeID: 16 }, { name: 'estado', dataTypeID: 25 }], rows: [['h1', 'video', 'b', 't', 'base']], command: 'SELECT', rowCount: 1, rowAsArray: true } })
  assert.deepEqual(await B.leerFilasBase(), [{ huella: 'h1', tipo: 'video', bloque: 'b', listo: true, estado: 'base' }])
  responder = () => ({ estado: 400, cuerpo: { message: 'column "listo" does not exist', code: '42703' } })
  await assert.rejects(B.leerFilasBase(), /listo/)
})

test('faltaTablaBase: solo 42P01 o el mensaje de esa tabla', () => {
  assert.equal(B.faltaTablaBase({ code: '42P01' }), true)
  assert.equal(B.faltaTablaBase(new Error('relation "cj_anuncios_doc_base" does not exist')), true)
  assert.equal(B.faltaTablaBase({ code: '42703' }), false)
  assert.equal(B.faltaTablaBase(new Error('fetch failed')), false)
})

test('las escrituras sí crean la tabla antes de guardar', async () => {
  const fuente = (await import('node:fs')).readFileSync(new URL('../lib/bot/anuncios/docAdsBaseNeon.ts', import.meta.url), 'utf8')
  const leer = fuente.slice(fuente.indexOf('export async function leerFilasBase'), fuente.indexOf('export async function leerLineaBase'))
  assert.doesNotMatch(leer, /asegurarTabla\(\)/)
  const insertar = fuente.slice(fuente.indexOf('async function insertar'))
  assert.match(insertar.split('\n').slice(0, 4).join('\n'), /await asegurarTabla\(\)/)
})

test('lecturas de la cartera y de la tarjeta: con las tablas sin crear salen vacías y no mandan CREATE ni ALTER', async () => {
  const lecturas = {
    'hitos y etapas a mano': async () => (await import('../lib/clientes/hitosRegistro.ts')).leerAnotaciones(),
    'despacho del recorrido': async () => (await import('../lib/clientes/recorridoFuentes.ts')).leerDespachoRecorrido(),
    'éxitos del bot': async () => (await import('../lib/clientes/recorridoFuentes.ts')).exitosDelBot(),
    'marcas de proyección': async () => (await import('../lib/bot/proyeccion/marcas.ts')).leerMarcasProyeccion(),
    'acciones del cliente': async () => (await import('../lib/clientes/acciones/registro.ts')).listarAcciones('Z001'),
    'wins del cliente': async () => (await import('../lib/clientes/wins/db.ts')).listarWins('Z001'),
    'portales armados': async () => (await import('../lib/clientes/portal/base.ts')).idsConPortal(),
    'tandas del cliente': async () => (await import('../lib/bot/guiones/registro.ts')).tandasDelCliente('Z001'),
    'videos del cliente': async () => (await import('../lib/edicion/db/videos.ts')).listarVideos({ id_crm: 'Z001', incluirFinales: true, limite: 200 }),
    'doc de guiones vinculado': async () => (await import('../lib/bot/guiones/documento.ts')).documentoVinculadoCliente('Z001'),
  }
  responder = q => (/^\s*(CREATE|ALTER)/i.test(q) ? { estado: 200, cuerpo: { fields: [], rows: [], command: 'CREATE', rowCount: 0, rowAsArray: true } } : { estado: 400, cuerpo: { message: 'relation "cj_x" does not exist', code: '42P01' } })
  for (const [que, leer] of Object.entries(lecturas)) {
    enviados.length = 0
    await leer().catch(e => assert.fail(`${que}: ${e.message}`))
    assert.ok(enviados.length > 0, `${que}: tiene que llegar a la base (si no, la prueba no prueba nada)`)
    const ddl = enviados.filter(q => /^\s*(CREATE|ALTER)/i.test(q))
    assert.deepEqual(ddl, [], `${que} no debe crear tablas al leer`)
  }
})
