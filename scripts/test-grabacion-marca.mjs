// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-marca.mjs
// e05: lo que el cliente sube a "Marca - X" → propuesta de paleta (lib/bot/grabacion/marcaClaude.ts y marcaVigia.ts) y el
// aviso marca_propuesta. Drive, Claude y la base son de juguete: SIN red (fetch bloqueado). Datos inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) if (/^(DISCORD_|EDICION_)/.test(k) || ['DATABASE_URL', 'DESPACHO_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY'].includes(k)) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const MC = await import('../lib/bot/grabacion/marcaClaude.ts')
const MV = await import('../lib/bot/grabacion/marcaVigia.ts')
const M = await import('../lib/edicion/avisos/mensajes.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')

// ── Puro ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('formatos: imagen, PDF y SVG se leen; HEIC, AI y videos no', () => {
  assert.equal(MC.formatoDe('image/png'), 'imagen')
  assert.equal(MC.formatoDe('image/JPEG'), 'imagen')
  assert.equal(MC.formatoDe('application/pdf'), 'pdf')
  assert.equal(MC.formatoDe('image/svg+xml'), 'svg')
  for (const m of ['image/heic', 'application/postscript', 'video/mp4', 'application/zip']) assert.equal(MC.formatoDe(m), null, m)
})

test('validarLectura: hex normalizado, sin repetidos, con tope; tipografías limpias', () => {
  const l = MC.validarLectura({
    que_es: 'logo',
    colores: [{ hex: '1e4740', nombre: ' Verde  petróleo ' }, { hex: '#1E4740', nombre: 'repetido' }, { hex: '#abc', nombre: 'Gris' }, { hex: 'rojo', nombre: 'malo' },
      ...Array.from({ length: 12 }, (_, i) => ({ hex: `#0000${String(i).padStart(2, '0')}`, nombre: '' }))],
    tipografias: ['Montserrat', 'Montserrat', '  ', 'Playfair Display', 'A', 'B', 'C'],
    nota: 'dos versiones del logo',
  })
  assert.deepEqual(l.colores.slice(0, 2), [{ hex: '#1E4740', nombre: 'Verde petróleo' }, { hex: '#AABBCC', nombre: 'Gris' }])
  assert.equal(l.colores.length, MC.MAX_COLORES_PROPUESTA)
  assert.deepEqual(l.tipografias, ['Montserrat', 'Playfair Display', 'A', 'B'])
  assert.equal(l.que_es, 'logo')
  assert.deepEqual(MC.validarLectura(null), { colores: [], tipografias: [], nota: '', que_es: 'otro' })
})

test('armarUsuario: imagen y PDF en base64; SVG como texto', () => {
  const b = Buffer.from('<svg fill="#1E4740"/>')
  const img = MC.armarUsuario('imagen', 'image/png', b, 'logo.png')
  assert.equal(img[0].type, 'image')
  assert.equal(img[0].source.media_type, 'image/png')
  assert.equal(img[0].source.data, b.toString('base64'))
  assert.equal(MC.armarUsuario('pdf', 'application/pdf', b, 'manual.pdf')[0].type, 'document')
  const svg = MC.armarUsuario('svg', 'image/svg+xml', b, 'logo.svg')
  assert.ok(svg.every(x => x.type === 'text') && svg[1].text.includes('#1E4740'))
})

// ── revisarMarcas con juguetes ────────────────────────────────────────────────────────────────────────────────
const raiz = (id) => ({ drive_id: `MARCA_${id}_00000000`, nombre: 'Marca', padre_id: 'X', nivel: 0, ruta: [], id_crm: id, tipo: 'marca', raiz: 'marca', raiz_id: `MARCA_${id}_00000000`,
  vinculo: 'alta', candidatos: [], vigilar: false, creada: null, ultimo_archivo: null, consultada: null, borrada: null })
const archivo = (id, nombre, mime, creado = '2026-10-20T10:00:00Z', bytes = 1000) => ({ drive_id: id, nombre, mime, carpeta_id: 'X', ruta: [], bytes, duracion_ms: null, ancho: null, alto: null, creado, modificado: creado, subio: 'cliente' })

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
function juguetes({ archivos = {}, conColores = new Set(), claude = null, modo = 'real', descargar = true, bytesDe = {} } = {}) {
  const filas = []
  const reintentos = []
  const bajados = []
  const llamadas = []
  const drive = {
    async listarArbol(r) { return { archivos: archivos[r.id_crm] ?? [], carpetas: [], completo: true } },
    ...(descargar ? { async descargar(id) { bajados.push(id); return bytesDe[id] ?? PNG } } : {}),
  }
  const repo = {
    async fichaConColores(id) { return conColores.has(id) },
    async yaLeidos(ids) { return new Set(filas.map(f => f.drive_id).filter(x => ids.includes(x))) },
    async guardar(p) { if (filas.some(f => f.drive_id === p.drive_id)) return false; filas.push(p); return true },
    async reintento(p) { reintentos.push(p) },
  }
  const llamar = claude ?? (async (p) => { llamadas.push(p); return { json: { que_es: 'logo', colores: [{ hex: '#1E4740', nombre: 'Verde' }], tipografias: [], nota: '' }, modelo: 'claude-x', usage: {} } })
  return { deps: { drive, repo, claude: llamar, modo }, filas, bajados, llamadas, reintentos }
}
const lejos = () => ({ deadline: Date.now() + 600_000 })

test('lee lo nuevo, deja la propuesta y avisa a Aylu una vez por cliente; la segunda pasada no relee', async () => {
  const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png', '2026-10-21T10:00:00Z'), archivo('f2', 'foto.jpg', 'image/jpeg')] } })
  const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Estudio Uno', raiz: raiz('A1') }], lejos())
  assert.equal(r.leidos, 2)
  assert.deepEqual(j.bajados, ['f1', 'f2'], 'el más nuevo primero')
  assert.equal(j.filas.length, 2)
  assert.ok(j.filas.every(f => f.estado === 'propuesta' && f.colores[0].hex === '#1E4740' && f.modelo === 'claude-x'))
  assert.deepEqual(r.extra, [{ tipo: 'marca_propuesta', id_crm: 'A1', cliente: 'Estudio Uno', archivos: 2, archivo: 'foto.jpg' }])
  assert.equal(j.llamadas[0].esfuerzo, 'low')
  const r2 = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Estudio Uno', raiz: raiz('A1') }], lejos())
  assert.equal(r2.leidos, 0)
  assert.deepEqual(r2.extra, [])
  assert.equal(j.bajados.length, 2)
})

test('con la ficha ya cargada no lee nada (nunca pisa la ficha)', async () => {
  const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png')] }, conColores: new Set(['A1']) })
  const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
  assert.equal(r.clientes, 0)
  assert.deepEqual(j.bajados, [])
  assert.deepEqual(j.filas, [])
})

test('formato que no se lee y archivo pesado: fila error sin bajar ni llamar a Claude', async () => {
  const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.heic', 'image/heic'), archivo('f2', 'manual.pdf', 'application/pdf', '2026-10-20T10:00:00Z', 50_000_000)] } })
  const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
  assert.deepEqual(j.filas.map(f => f.estado), ['error', 'error'])
  assert.match(j.filas[0].nota, /PNG, JPG o PDF/)
  assert.match(j.filas[1].nota, /pesa más de 8 MB/)
  assert.deepEqual(j.bajados, [])
  assert.deepEqual(r.extra, [])
})

test('sin colores → sin_colores y sin aviso', async () => {
  const claude = async () => ({ json: { que_es: 'foto', colores: [], tipografias: [], nota: 'foto del estudio' }, modelo: 'm', usage: {} })
  const j = juguetes({ archivos: { A1: [archivo('f1', 'oficina.jpg', 'image/jpeg')] }, claude })
  const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
  assert.equal(j.filas[0].estado, 'sin_colores')
  assert.equal(j.filas[0].nota, 'foto · foto del estudio')
  assert.deepEqual(r.extra, [])
})

test('error pasajero (Claude saturado, cuota o red): anota un reintento; error definitivo: fila error', async () => {
  const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png')] }, claude: async () => { throw new ErrorTransitorio('Claude respondió 529') } })
  const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
  assert.deepEqual(j.filas, [])
  assert.equal(j.reintentos.length, 1)
  assert.equal(j.reintentos[0].drive_id, 'f1')
  assert.equal(r.errores.length, 1)
  assert.ok(MV.pasajero(Object.assign(new Error('x'), { name: 'TimeoutError' })))
  assert.ok(MV.pasajero(Object.assign(new Error('x'), { status: 503 })))
  assert.ok(MV.pasajero(Object.assign(new Error('x'), { status: 403 })), '403 de cuota de Drive')
  assert.ok(MV.pasajero(new TypeError('fetch failed')))
  assert.ok(!MV.pasajero(new TypeError('Cannot read properties of undefined')))
  assert.ok(!MV.pasajero(Object.assign(new Error('x'), { status: 404 })))
  const j2 = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png')] }, claude: async () => { throw new Error('Claude rechazó la paleta') } })
  await MV.revisarMarcas(j2.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
  assert.equal(j2.filas[0].estado, 'error')
})

test('el tipo real manda: un "PNG" que no lo es queda error sin llamar a Claude; un JPG etiquetado PNG va como JPG', async () => {
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
  const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png', '2026-10-21T10:00:00Z'), archivo('f2', 'raro.png', 'image/png')] }, bytesDe: { f1: JPG, f2: Buffer.from('hola') } })
  await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
  assert.equal(j.llamadas.length, 1)
  assert.equal(j.llamadas[0].usuario[0].source.media_type, 'image/jpeg')
  assert.equal(j.filas.find(f => f.drive_id === 'f2').estado, 'error')
  assert.equal(MC.mimeReal(Buffer.from('%PDF-1.7')), 'application/pdf')
  assert.equal(MC.limpiarSvg('<image href="data:image/png;base64,AAAA"/>'), '<image href="data:…"/>')
})

test('topes: como mucho 2 por cliente y 3 por pasada', async () => {
  const muchos = (c) => Array.from({ length: 5 }, (_, i) => archivo(`${c}-${i}`, `l${i}.png`, 'image/png', `2026-10-2${i}T10:00:00Z`))
  const j = juguetes({ archivos: { A1: muchos('A1'), A2: muchos('A2'), A3: muchos('A3'), A4: muchos('A4') } })
  const rs = ['A1', 'A2', 'A3', 'A4'].map(id => ({ id_crm: id, cliente: id, raiz: raiz(id) }))
  const r = await MV.revisarMarcas(j.deps, rs, lejos())
  assert.equal(j.bajados.length, MV.MAX_POR_PASADA)
  assert.equal(j.bajados.filter(x => x.startsWith('A1')).length, MV.MAX_POR_CLIENTE)
  assert.equal(r.cortado, true)
})

test('modo dry o sin Claude o sin descarga: solo cuenta, no baja ni escribe', async () => {
  for (const op of [{ modo: 'dry' }, { claude: null }, { descargar: false }]) {
    const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png')] }, ...op })
    if (op.claude === null) j.deps.claude = null
    const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], lejos())
    assert.equal(r.por_leer, 1, JSON.stringify(op))
    assert.deepEqual(j.filas, [])
    assert.deepEqual(j.bajados, [])
  }
})

test('pegado al corte no arranca', async () => {
  const j = juguetes({ archivos: { A1: [archivo('f1', 'logo.png', 'image/png')] } })
  const r = await MV.revisarMarcas(j.deps, [{ id_crm: 'A1', cliente: 'Uno', raiz: raiz('A1') }], { deadline: Date.now() + 1_000 })
  assert.equal(r.cortado, true)
  assert.deepEqual(j.filas, [])
})

// ── Aviso ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('aviso marca_propuesta: a Aylu, con el link a la ficha del cliente', () => {
  assert.ok(M.TIPOS_AVISO.includes('marca_propuesta'))
  assert.equal(M.DESTINO.marca_propuesta, 'aylu')
  const m = M.armarMensaje({ tipo: 'marca_propuesta', datos: { id_crm: 'A1', cliente: 'Estudio Uno', archivos: 1, archivo: 'logo.png' } }, {}, { aylu: '123' }, 'https://despacho.ejemplo')
  assert.match(m.texto, /Estudio Uno subió su marca \(«logo\.png»\)/)
  assert.ok(m.texto.includes('https://despacho.ejemplo/clientes/edicion/cliente/A1'))
  const m2 = M.armarMensaje({ tipo: 'marca_propuesta', datos: { id_crm: 'A1', cliente: 'Uno', archivos: 3, archivo: 'x' } }, {}, {}, 'https://d')
  assert.match(m2.texto, /\(3 archivos\)/)
})
