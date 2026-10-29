// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-puente-drive.mjs
// El Codigo.gs versionado en integrations/apps-script (o PUENTE_CODIGO_GS explícito), corrido en
// node:vm con juguetes de PropertiesService, ContentService, Session, DriveApp, DocumentApp, MimeType y LockService. SIN red.
// Controla la acción agregarTanda (25/10/2026): escribe al final, en orden, con títulos, cursiva solo en las indicaciones y el
// marcador «[tanda:<clave>]» chico y gris; es idempotente por la clave; solo en docs «Guiones - …»; valida antes de tocar el
// doc; respeta el candado; limpia el formato que hereda un párrafo nuevo del marcador anterior; y que ningún nombre global
// choque con Vigia.gs (Apps Script junta todos los .gs). Si el archivo no está en esta máquina, las pruebas se saltean.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const RUTA = process.env.PUENTE_CODIGO_GS || new URL('../integrations/apps-script/Codigo.gs', import.meta.url)
const HAY = existsSync(RUTA)
const CODIGO = HAY ? readFileSync(RUTA, 'utf8') : ''
const VIGIA = readFileSync(new URL('../docs/edicion/puente/Vigia.gs', import.meta.url), 'utf8')
const CHIPS = readFileSync(new URL('../docs/guiones/puente/GuionesChips.gs', import.meta.url), 'utf8')
const SECRETO = 'secreto-de-prueba-0123456789abcdef'
const PROPS = { SECRETO, DRIVE_CARPETA_COMPROBANTES: 'fixture-google-id-000000000000000000000018', PUENTE_CORREO_ORGANIZACION: 'organizacion@example.test' }
const DOC_ID = 'fixture-google-id-000000000000000000000006'
const GOOGLE_DOCS = 'application/vnd.google-apps.document'

/** Un párrafo de juguete. Como en Docs, uno nuevo hereda el formato del último del cuerpo. */
function parrafo(texto, heredado = {}, modoNull = 'acepta') {
  const p = { texto, heading: heredado.heading ?? 'NORMAL', italic: heredado.italic ?? false, color: heredado.color ?? null, tamano: heredado.tamano ?? null }
  const t = {
    getText: () => p.texto,
    setItalic: (v) => { if (!p.texto) throw new Error('vacío'); p.italic = v; return t },
    setBold: () => t,
    setForegroundColor: (c) => { if (c === null && modoNull === 'tira') throw new Error('Invalid argument: color'); if (c === null && modoNull === 'ignora') return t; p.color = c; return t },
    setFontSize: (n) => { if (n === null && modoNull === 'tira') throw new Error('Invalid argument: fontSize'); if (n === null && modoNull === 'ignora') return t; p.tamano = n; return t },
    getForegroundColor: () => p.color,
    getFontSize: () => p.tamano,
  }
  p.setHeading = (h) => { p.heading = h; return p }
  p.editAsText = () => t
  return p
}

function entorno({ nombre = 'Guiones - ClaudiaR', mime = GOOGLE_DOCS, papelera = false, previos = ['Plantilla de guiones'], candadoLibre = true, modoNull = 'acepta', props = { ...PROPS } } = {}) {
  const parrafos = previos.map((t) => parrafo(t))
  const conteo = { abrir: 0, guardar: 0, liberar: 0, pedirCandado: 0 }
  const body = {
    getText: () => parrafos.map((p) => p.texto).join('\n'),
    appendParagraph: (t) => { const ult = parrafos[parrafos.length - 1] ?? {}; const p = parrafo(t, ult, modoNull); parrafos.push(p); return p },
  }
  const archivo = { getId: () => DOC_ID, getUrl: () => `https://docs.google.com/document/d/${DOC_ID}/edit`, getName: () => nombre, getMimeType: () => mime, isTrashed: () => papelera }
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ contenido: s, setMimeType() { return this } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'cuenta@ejemplo.test' }) },
    MimeType: { GOOGLE_DOCS },
    DriveApp: { getFileById: (id) => { if (id !== DOC_ID) throw new Error('No item with the given ID could be found.'); return archivo } },
    DocumentApp: {
      ParagraphHeading: { HEADING1: 'HEADING1', HEADING2: 'HEADING2', NORMAL: 'NORMAL' },
      openById: (id) => { conteo.abrir++; assert.equal(id, DOC_ID); return { getBody: () => body, saveAndClose: () => { conteo.guardar++ } } },
    },
    LockService: { getScriptLock: () => ({ tryLock: (ms) => { conteo.pedirCandado++; assert.ok(ms > 0 && ms <= 60_000); return candadoLibre }, releaseLock: () => { conteo.liberar++ } }) },
    Logger: { log: () => {} },
    Utilities: {},
  }
  vm.createContext(ctx)
  vm.runInContext(CODIGO, ctx, { filename: 'Codigo.gs' })
  const post = (cuerpo) => JSON.parse(ctx.doPost({ postData: { contents: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) } }).contenido)
  return { ctx, post, parrafos, conteo, body }
}

const BLOQUES = [
  { tipo: 'titulo', texto: 'TANDA 1° · 25/10/2026' },
  { tipo: 'subtitulo', texto: 'Video 1: Para grabar — El error del despido' },
  { tipo: 'indicacion', texto: 'Para tener a mano: un Código Civil' },
  { tipo: 'parrafo', texto: 'Gancho · Velocidad alta' },
  { tipo: 'indicacion', texto: '(mirando a cámara)' },
  { tipo: 'parrafo', texto: 'Si te despidieron sin causa…' },
]
const pedido = (extra = {}) => ({ secreto: SECRETO, accion: 'agregarTanda', docId: DOC_ID, clave: 'cj-guiones-123-1', bloques: BLOQUES, ...extra })

describe('Codigo.gs · agregarTanda', { skip: HAY ? false : `no está ${RUTA}` }, () => {
  test('VERSION 2026-10-26a y ping la devuelve', () => {
    const e = entorno()
    assert.match(CODIGO, /var VERSION = '2026-10-26a';/)
    assert.deepEqual(e.post({ secreto: SECRETO, accion: 'ping' }), { ok: true, cuenta: 'cuenta@ejemplo.test', version: '2026-10-26a' })
  })
  test('sin el secreto no toca nada', () => {
    const e = entorno()
    assert.deepEqual(e.post(pedido({ secreto: 'otro' })), { ok: false, error: 'no autorizado' })
    assert.equal(e.conteo.abrir, 0)
  })
  test('sin configuración privada rechaza operaciones antes de abrir documentos o pedir candados', () => {
    for (const campo of ['DRIVE_CARPETA_COMPROBANTES', 'PUENTE_CORREO_ORGANIZACION']) {
      const e = entorno({ props: { ...PROPS, [campo]: '' } })
      const r = e.post(pedido())
      assert.equal(r.ok, false)
      assert.match(r.error, new RegExp(campo))
      assert.deepEqual(e.conteo, { abrir: 0, guardar: 0, liberar: 0, pedirCandado: 0 })
    }
  })
  test('ping autenticado sigue disponible con instalación incompleta sin tocar Drive', () => {
    const e = entorno({ props: { SECRETO } })
    assert.equal(e.post({ secreto: SECRETO, accion: 'ping' }).ok, true)
    assert.deepEqual(e.conteo, { abrir: 0, guardar: 0, liberar: 0, pedirCandado: 0 })
  })
  test('enruta cargarEnChips al módulo versionado y conserva su validación antes de escribir', () => {
    const e = entorno()
    vm.runInContext(CHIPS, e.ctx, { filename: 'GuionesChips.gs' })
    const r = e.post({ secreto: SECRETO, accion: 'cargarEnChips', docId: DOC_ID, tanda: 1, clave: 'chips-fixture', guiones: [] })
    assert.equal(r.ok, false)
    assert.match(r.error, /guiones inválidos/)
    assert.deepEqual(e.conteo, { abrir: 0, guardar: 0, liberar: 0, pedirCandado: 0 })
  })
  test('escribe los bloques al final, en orden, con títulos, cursiva solo en indicaciones y el marcador chico y gris', () => {
    const e = entorno()
    const r = e.post(pedido())
    assert.deepEqual(r, { ok: true, id: DOC_ID, url: `https://docs.google.com/document/d/${DOC_ID}/edit`, yaExistia: false })
    assert.deepEqual(e.parrafos.map((p) => p.texto), ['Plantilla de guiones', ...BLOQUES.map((b) => b.texto), '[tanda:cj-guiones-123-1]'])
    const nuevos = e.parrafos.slice(1, -1)
    assert.deepEqual(nuevos.map((p) => p.heading), ['HEADING1', 'HEADING2', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL'])
    assert.deepEqual(nuevos.map((p) => p.italic), [false, false, true, false, true, false])
    const marca = e.parrafos.at(-1)
    assert.equal(marca.heading, 'NORMAL'); assert.equal(marca.italic, false); assert.equal(marca.color, '#bbbbbb'); assert.equal(marca.tamano, 8)
    assert.equal(e.conteo.guardar, 1)
    assert.equal(e.conteo.liberar, 1, 'libera el candado')
  })
  test('idempotente: con la misma clave no escribe y devuelve yaExistia: true', () => {
    const e = entorno()
    e.post(pedido())
    const antes = e.parrafos.length
    const r = e.post(pedido())
    assert.equal(r.ok, true); assert.equal(r.yaExistia, true); assert.equal(r.id, DOC_ID)
    assert.equal(e.parrafos.length, antes)
    assert.equal(e.conteo.liberar, 2, 'libera el candado también cuando ya existía')
  })
  test('una clave que es prefijo de otra no cuenta como repetida', () => {
    const e = entorno({ previos: ['x', '[tanda:cj-guiones-123-10]'] })
    assert.equal(e.post(pedido()).yaExistia, false)
  })
  for (const modoNull of ['acepta', 'tira', 'ignora']) {
    test(`la tanda siguiente no hereda el gris ni los 8 pt del marcador anterior (null ${modoNull})`, () => {
      const e = entorno({ modoNull })
      e.post(pedido())
      const desde = e.parrafos.length
      assert.equal(e.post(pedido({ clave: 'cj-guiones-123-2' })).yaExistia, false)
      const nuevos = e.parrafos.slice(desde, -1)
      assert.equal(nuevos.length, BLOQUES.length)
      for (const p of nuevos) {
        assert.notEqual(p.color, '#bbbbbb', p.texto)
        assert.notEqual(p.tamano, 8, p.texto)
      }
      assert.equal(e.parrafos.at(-1).texto, '[tanda:cj-guiones-123-2]')
    })
  }
  test('un bloque con texto vacío no rompe (no se le aplica formato)', () => {
    const e = entorno()
    assert.equal(e.post(pedido({ bloques: [{ tipo: 'parrafo', texto: '' }, { tipo: 'indicacion', texto: 'ok' }] })).ok, true)
  })
  test('solo en docs «Guiones - …»: la plantilla u otro archivo se rechazan sin abrirlos', () => {
    for (const nombre of ['Plantilla Guiones - C.J', 'Bienvenida - ClaudiaR', 'guiones - minúscula']) {
      const e = entorno({ nombre })
      const r = e.post(pedido())
      assert.equal(r.ok, false); assert.match(r.error, /Guiones - /)
      assert.equal(e.conteo.abrir, 0); assert.equal(e.conteo.pedirCandado, 0)
    }
  })
  test('no es un Google Doc o está en la papelera: rechazo', () => {
    assert.match(entorno({ mime: 'application/pdf' }).post(pedido()).error, /Google Doc/)
    assert.match(entorno({ papelera: true }).post(pedido()).error, /papelera/)
  })
  test('valida antes de tocar el doc: sin docId, clave inválida, sin bloques, tipo lista u otro, texto que no es texto', () => {
    const malos = [
      { docId: '' }, { clave: '' }, { clave: 'con espacios' }, { clave: 'a]b' }, { clave: 'x'.repeat(101) }, { clave: 5 },
      { bloques: [] }, { bloques: 'texto' }, { bloques: [{ tipo: 'lista', texto: 'x' }] }, { bloques: [{ tipo: 'titulo' }] },
      { bloques: [null] }, { bloques: [{ tipo: 'parrafo', texto: 'x'.repeat(5001) }] }, { bloques: Array.from({ length: 601 }, () => ({ tipo: 'parrafo', texto: 'x' })) },
    ]
    for (const m of malos) {
      const e = entorno()
      const r = e.post(pedido(m))
      assert.equal(r.ok, false, JSON.stringify(m).slice(0, 80))
      assert.equal(e.conteo.abrir, 0)
    }
  })
  test('un doc que no existe: { ok: false } con el error de Drive (doPost lo atrapa)', () => {
    const r = entorno().post(pedido({ docId: 'fixture-google-id-000000000000000000000012' }))
    assert.equal(r.ok, false); assert.match(r.error, /No item/)
  })
  test('candado ocupado: no escribe y lo dice', () => {
    const e = entorno({ candadoLibre: false })
    const r = e.post(pedido())
    assert.equal(r.ok, false); assert.match(r.error, /ocupado/)
    assert.equal(e.conteo.abrir, 0); assert.equal(e.parrafos.length, 1)
  })
  test('si algo tira a mitad de camino, el candado se libera igual', () => {
    const e = entorno()
    e.body.appendParagraph = () => { throw new Error('Service error: Docs') }
    const r = e.post(pedido())
    assert.equal(r.ok, false); assert.match(r.error, /Service error/)
    assert.equal(e.conteo.liberar, 1)
  })
  test('las acciones de antes siguen y una desconocida se informa igual que siempre', () => {
    const e = entorno()
    assert.deepEqual(e.post({ secreto: SECRETO, accion: 'otra' }), { ok: false, error: 'acción desconocida: otra' })
    for (const a of ['subirArchivo', 'crearCarpeta', 'crearDoc', 'aPapelera', 'copiarArchivo', 'aPapeleraCarpeta', 'agregarTanda']) assert.match(CODIGO, new RegExp(`case '${a}':`))
  })
})

// ── quitarAccesoCliente (26/10/2026, etapa Bajas): le saca al cliente y a sus socios el acceso a su carpeta "<Nombre> - C.J" ──
const CARPETA_ID = 'fixture-google-id-000000000000000000000010'
function entornoCarpeta({ nombre = 'Ana Pérez - C.J', papelera = false, editores = [], lectores = [], duenio = 'duenio@ejemplo.test', acceso = 'PRIVATE' } = {}) {
  const ed = [...editores], le = [...lectores]
  const quitados = []
  const usuario = (m) => ({ getEmail: () => m })
  const carpeta = {
    getName: () => nombre, isTrashed: () => papelera, getOwner: () => (duenio ? usuario(duenio) : null),
    getEditors: () => ed.map(usuario), getViewers: () => le.map(usuario),
    removeEditor: (m) => { const i = ed.indexOf(m); assert.ok(i >= 0); ed.splice(i, 1); quitados.push(['editor', m]); return carpeta },
    removeViewer: (m) => { const i = le.indexOf(m); assert.ok(i >= 0); le.splice(i, 1); quitados.push(['lector', m]); return carpeta },
    getSharingAccess: () => acceso,
    setSharing: () => { throw new Error('no debería cambiar el acceso general') },
  }
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => PROPS[k] ?? null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ contenido: s, setMimeType() { return this } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'organizacion@example.test' }) },
    MimeType: {},
    DriveApp: {
      Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' },
      getFolderById: (id) => { if (id !== CARPETA_ID) throw new Error('No item with the given ID could be found.'); return carpeta },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} }, Utilities: {},
  }
  vm.createContext(ctx)
  vm.runInContext(CODIGO, ctx, { filename: 'Codigo.gs' })
  const post = (cuerpo) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secreto: SECRETO, accion: 'quitarAccesoCliente', ...cuerpo }) } }).contenido)
  return { post, quitados, ed, le }
}

describe('Codigo.gs · quitarAccesoCliente', { skip: HAY ? false : `no está ${RUTA}` }, () => {
  test('saca al cliente y a los socios como editores o lectores; nunca al dueño, a skyward ni a una cuenta de servicio', () => {
    const e = entornoCarpeta({ editores: ['ana@estudio.test', 'organizacion@example.test', 'bot@proyecto.iam.gserviceaccount.com'], lectores: ['socio@estudio.test'] })
    const r = e.post({ carpetaId: CARPETA_ID, correos: ['ANA@estudio.test ', 'socio@estudio.test', 'duenio@ejemplo.test', 'organizacion@example.test', 'bot@proyecto.iam.gserviceaccount.com', 'otro@x.test'] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.quitados, [{ correo: 'ana@estudio.test', como: 'editor' }, { correo: 'socio@estudio.test', como: 'lector' }])
    assert.deepEqual(r.protegidos, ['duenio@ejemplo.test', 'organizacion@example.test', 'bot@proyecto.iam.gserviceaccount.com'])
    assert.deepEqual(r.noTenian, ['otro@x.test'])
    assert.deepEqual(e.ed, ['organizacion@example.test', 'bot@proyecto.iam.gserviceaccount.com'])
    assert.equal(r.enlacePublico, false)
  })
  test('idempotente: la segunda vez no saca nada (todos "noTenian")', () => {
    const e = entornoCarpeta({ editores: ['ana@estudio.test'] })
    e.post({ carpetaId: CARPETA_ID, correos: ['ana@estudio.test'] })
    const r = e.post({ carpetaId: CARPETA_ID, correos: ['ana@estudio.test'] })
    assert.deepEqual(r.quitados, []); assert.deepEqual(r.noTenian, ['ana@estudio.test'])
  })
  test('"cualquiera con el enlace" NO se cambia: se informa', () => {
    const r = entornoCarpeta({ editores: ['ana@estudio.test'], acceso: 'ANYONE_WITH_LINK' }).post({ carpetaId: CARPETA_ID, correos: ['ana@estudio.test'] })
    assert.equal(r.ok, true); assert.equal(r.enlacePublico, true); assert.equal(r.acceso, 'ANYONE_WITH_LINK')
  })
  test('valida antes de tocar: carpeta que no es de cliente, en la papelera, correos inválidos o de más, id inválido', () => {
    const cases = [
      [{ nombre: 'Clientes' }, { carpetaId: CARPETA_ID, correos: ['a@b.co'] }, /solo carpetas de cliente/],
      [{ papelera: true }, { carpetaId: CARPETA_ID, correos: ['a@b.co'] }, /papelera/],
      [{}, { carpetaId: CARPETA_ID, correos: ['no-es-correo'] }, /correo inválido/],
      [{}, { carpetaId: CARPETA_ID, correos: [] }, /faltan los correos/],
      [{}, { carpetaId: CARPETA_ID, correos: Array.from({ length: 21 }, (_, i) => `x${i}@b.co`) }, /demasiados/],
      [{}, { carpetaId: 'corto', correos: ['a@b.co'] }, /carpetaId/],
    ]
    for (const [op, cuerpo, re] of cases) {
      const e = entornoCarpeta({ ...op, editores: ['a@b.co'] })
      const r = e.post(cuerpo)
      assert.equal(r.ok, false); assert.match(r.error, re); assert.equal(e.quitados.length, 0)
    }
    assert.equal(entornoCarpeta({ nombre: 'PRUEBA BOT Ana', editores: ['a@b.co'] }).post({ carpetaId: CARPETA_ID, correos: ['a@b.co'] }).ok, true)
  })
})

describe('convivencia con Vigia.gs (mismo espacio de nombres en Apps Script)', { skip: HAY ? false : `no está ${RUTA}` }, () => {
  const globales = (src) => [...src.matchAll(/^(?:var|let|const)\s+([A-Za-z_$][\w$]*)|^function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1] ?? m[2])
  test('ningún nombre global de Codigo.gs se repite en Vigia.gs ni dentro del mismo archivo', () => {
    const mios = globales(CODIGO), suyos = new Set(globales(VIGIA))
    assert.deepEqual(mios.filter((n) => suyos.has(n)), [])
    assert.equal(new Set(mios).size, mios.length, 'sin nombres repetidos')
    for (const n of ['agregarTanda_', 'formatoTandaLimpio_', 'PREFIJO_DOC_GUIONES', 'quitarAccesoCliente_']) assert.ok(mios.includes(n), n)
  })
  test('el archivo no trae un secreto escrito', () => {
    assert.ok(!/var\s+SECRETO\s*=/.test(CODIGO))
    assert.match(CODIGO, /getProperty\('SECRETO'\)/)
  })
})
