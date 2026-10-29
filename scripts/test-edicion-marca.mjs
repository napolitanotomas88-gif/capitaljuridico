// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-marca.mjs
// Ficha de marca (e05): validación (lib/edicion/marca.ts) y SQL (lib/edicion/db/marca.ts) contra un Neon FALSO. SIN red ni
// base real. Los ids, nombres y links son inventados.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.DATABASE_URL
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const M = await import('../lib/edicion/marca.ts')
const DB = await import('../lib/edicion/db/marca.ts')
const base = await import('../lib/edicion/db/base.ts')

const AYLU = { rol: 'aylu', nombre: 'Aylu', email: 'aylu@ejemplo.test' }
const RENE = { rol: 'rene', nombre: 'René', email: 'rene@ejemplo.test' }
const ficha = (over = {}) => ({ id_crm: 'a157', colores: [{ hex: '1e4740', nombre: 'Verde petróleo' }, '#abc'], tipografias: ['Sitka', ' Source Serif 4 ', 'Sitka'],
  logo: { url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view' }, referencia: { url: 'www.estudio-ejemplo.com.ar', descripcion: 'su web' },
  carpeta_marca: null, fuentes: {}, notas: '  usar el bordó en los botones  ', ...over })

describe('validarFicha', () => {
  test('normaliza: id en mayúsculas, hex #RRGGBB (también #abc), tipografías sin repetir, https completado, id de Drive del logo', () => {
    const r = M.validarFicha(ficha())
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal(r.ficha.id_crm, 'A157')
    assert.deepEqual(r.ficha.colores, [{ hex: '#1E4740', nombre: 'Verde petróleo' }, { hex: '#AABBCC', nombre: '' }])
    assert.deepEqual(r.ficha.tipografias, ['Sitka', 'Source Serif 4'])
    assert.equal(r.ficha.logo.drive_id, '1AbCdEfGhIjKlMnOp')
    assert.equal(r.ficha.referencia.url, 'https://www.estudio-ejemplo.com.ar/')
    assert.equal(r.ficha.notas, 'usar el bordó en los botones')
  })
  test('rechaza con el campo: hex inválido, http, adjunto de ClickUp, id del CRM, mail en "quien", campos de más', () => {
    const casos = [
      [{ colores: ['verde'] }, 'colores.0'],
      [{ colores: [{ hex: '#12345' }] }, 'colores.0'],
      [{ logo: { url: 'http://inseguro.test/logo.png' } }, 'logo.url'],
      [{ referencia: { url: 'https://t9017906266.p.clickup-attachments.com/t9017906266/abc/paleta.png' } }, 'referencia.url'],
      [{ id_crm: 'Lucas' }, 'id_crm'],
      [{ fuentes: { colores: { origen: 'aylu', quien: 'aylu@ejemplo.test', cuando: '2026-10-24T12:00:00Z' } } }, 'fuentes.colores.quien'],
      [{ fuentes: { paleta: { origen: 'aylu', quien: 'Aylu', cuando: '2026-10-24T12:00:00Z' } } }, 'fuentes.paleta'],
      [{ carpeta_marca: { id: 'x', url: 'https://drive.google.com/drive/folders/x' } }, 'carpeta_marca.id'],
      [{ colores: Array.from({ length: 13 }, (_, i) => `#0000${String(i).padStart(2, '0')}`) }, 'colores'],
    ]
    for (const [over, campo] of casos) {
      const r = M.validarFicha(ficha(over))
      assert.equal(r.ok, false, JSON.stringify(over))
      assert.equal(r.campo, campo, JSON.stringify(over))
    }
    assert.equal(M.validarFicha(null).ok, false)
  })
  test('colores desde texto libre (el campo de ClickUp) y nombre de la carpeta de marca', () => {
    assert.deepEqual(M.coloresDeTexto('Verde petróleo #1E4740 Bordó #6B2737'), [{ hex: '#1E4740', nombre: 'Verde petróleo' }, { hex: '#6B2737', nombre: 'Bordó' }])
    assert.deepEqual(M.coloresDeTexto('Azul oscuro noche o gris'), [])
    assert.equal(M.nombreCarpetaMarca('  Lucas   Quiroga '), 'Marca - Lucas Quiroga')
    assert.equal(M.tienePaleta({ colores: [] }), false)
    assert.equal(M.tienePaleta(null), false)
  })
  test('fuentesAlGuardar: lo que cambió queda a nombre de quien guarda (nombre, nunca mail); lo vacío no tiene fuente', () => {
    const v = M.validarFicha(ficha()).ficha
    const previa = { colores: v.colores, tipografias: [], logo: null, referencia: null, fuentes: { colores: { origen: 'clickup', quien: 'importación de ClickUp', cuando: '2026-10-20T00:00:00.000Z' } } }
    const f = M.fuentesAlGuardar(previa, v, AYLU, '2026-10-24T15:00:00.000Z')
    assert.equal(f.colores.origen, 'clickup', 'los colores no cambiaron: queda la fuente de ClickUp')
    assert.deepEqual(f.tipografias, { origen: 'aylu', quien: 'Aylu', cuando: '2026-10-24T15:00:00.000Z' })
    assert.equal(f.logo.quien, 'Aylu')
    assert.ok(!JSON.stringify(f).includes('@'))
    const sinColores = M.fuentesAlGuardar(previa, { ...v, colores: [] }, { ...AYLU, rol: 'tomas', nombre: 'Tomás' }, '2026-10-24T15:00:00.000Z')
    assert.equal(sinColores.colores, undefined)
    assert.equal(sinColores.tipografias.origen, 'tomas')
  })
})

describe('db/marca (Neon falso)', () => {
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    q.query = async texto => { consultas.push({ texto, valores: [] }); return /max\(version\)/.test(texto) ? [{ version: 999 }] : [] }
    q.transaction = async xs => Promise.all(xs)
    return { consultas, fabrica: () => q }
  }
  const fila = (over = {}) => ({ id_crm: 'A157', colores: [{ hex: '#1E4740', nombre: 'Verde' }], tipografias: [], logo: null, referencia: null, carpeta_marca: null,
    fuentes: {}, notas: '', version: 3, actualizado: new Date('2026-10-24T12:00:00Z'), actualizado_por: 'Aylu', ...over })
  beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
  afterEach(() => { base.sqlParaPruebas(null); delete process.env.DATABASE_URL })

  test('leerMarca: si la tabla no existe, null (sin crear nada)', async () => {
    const n = neonFalso(() => { throw Object.assign(new Error('relation "cj_marca" does not exist'), { code: '42P01' }) })
    base.sqlParaPruebas(n.fabrica)
    assert.equal(await DB.leerMarca('a157'), null)
    assert.ok(!n.consultas.some(c => /CREATE/.test(c.texto)))
    assert.deepEqual([...(await DB.leerMarcas(['A157', 'a157']))], [])
  })
  test('crear (version null): INSERT … ON CONFLICT DO NOTHING; actualizado_por = nombre, nunca el mail', async () => {
    const n = neonFalso(t => (t.startsWith('INSERT') ? [fila({ version: 1 })] : []))
    base.sqlParaPruebas(n.fabrica)
    const r = await DB.guardarMarca('a157', M.validarFicha(ficha()).ficha, null, AYLU)
    assert.ok(r.ok)
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_marca'))
    assert.match(ins.texto, /ON CONFLICT \(id_crm\) DO NOTHING RETURNING \*/)
    assert.ok(ins.valores.includes('Aylu'))
    assert.ok(!ins.valores.some(v => String(v).includes('aylu@ejemplo.test')), 'el mail no se guarda')
  })
  test('crear sobre una que ya existe → conflicto con lo de ahora; actualizar con otra versión → conflicto', async () => {
    let n = neonFalso(t => (t.startsWith('SELECT') ? [fila()] : []))
    base.sqlParaPruebas(n.fabrica)
    const r = await DB.guardarMarca('A157', M.validarFicha(ficha()).ficha, null, AYLU)
    assert.equal(r.ok, false); assert.equal(r.motivo, 'conflicto'); assert.equal(r.actual.version, 3)
    n = neonFalso(t => (t.startsWith('SELECT') ? [fila({ version: 4 })] : []))
    base.sqlParaPruebas(n.fabrica)
    const r2 = await DB.guardarMarca('A157', M.validarFicha(ficha()).ficha, 3, AYLU)
    assert.equal(r2.ok, false); assert.equal(r2.motivo, 'conflicto'); assert.equal(r2.actual.version, 4)
    const upd = n.consultas.find(c => c.texto.startsWith('UPDATE cj_marca'))
    assert.match(upd.texto, /WHERE id_crm = \$\d+ AND version = \$\d+ RETURNING \*/)
  })
  test('actualizar una que no existe → no_existe; René no guarda la ficha; una ficha inválida no llega a la base', async () => {
    const n = neonFalso(() => [])
    base.sqlParaPruebas(n.fabrica)
    const r = await DB.guardarMarca('A157', M.validarFicha(ficha()).ficha, 2, AYLU)
    assert.equal(r.motivo, 'no_existe')
    const r2 = await DB.guardarMarca('A157', M.validarFicha(ficha()).ficha, 2, RENE)
    assert.equal(r2.ok, false); assert.equal(r2.motivo, 'no_permitido')
    const antes = n.consultas.length
    await assert.rejects(DB.guardarMarca('A157', { ...M.validarFicha(ficha()).ficha, colores: [{ hex: 'verde', nombre: '' }] }, 2, AYLU), base.ErrorEntradaEdicion)
    assert.equal(n.consultas.length, antes, 'no tocó la base')
  })
})
