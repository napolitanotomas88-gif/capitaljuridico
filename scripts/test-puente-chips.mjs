// node --no-warnings scripts/test-puente-chips.mjs
// La acción cargarEnChips del Puente Drive (docs/guiones/puente/GuionesChips.gs, 27/10/2026) corrida en node:vm con un Doc de
// juguete armado como «Plantilla Guiones - C.J»: «TANDA N°» y, debajo, renglones con viñeta «Video:» (el chip) separados por
// un renglón vacío. Controla: cada guion debajo de su chip y en orden; el chip que falta (6.º) se agrega dentro de su tanda;
// el formato (sección en negrita, indicación y gesto resaltados); una segunda carga reemplaza lo del bot sin duplicar; si una
// persona escribió bajo un chip, frena sin tocar nada; valida antes de abrir el doc; el candado; y que ningún nombre global
// choque con Codigo.gs ni Vigia.gs (Apps Script junta todos los .gs). SIN red.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const CHIPS = readFileSync(new URL('../docs/guiones/puente/GuionesChips.gs', import.meta.url), 'utf8')
const ESTADO = readFileSync(new URL('../docs/guiones/puente/GuionesEstadoChips.gs', import.meta.url), 'utf8')
const RUTA_CODIGO = process.env.PUENTE_CODIGO_GS || new URL('../integrations/apps-script/Codigo.gs', import.meta.url)
const VIGIA = readFileSync(new URL('../docs/edicion/puente/Vigia.gs', import.meta.url), 'utf8')
const DOC_ID = 'fixture-google-id-000000000000000000000006'
const GOOGLE_DOCS = 'application/vnd.google-apps.document'
const ROSA = '#f4cccc'

/** Un Doc de juguete: el cuerpo es una lista de elementos (párrafos o renglones de lista) con su formato. */
function docDeJuguete(estructura) {
  const falla = { insertar: null }   // número de inserciones que salen bien antes de que falle una (null = nunca)
  const hijos = []
  const nombrados = []
  const elemento = (e) => {
    const el = {
      ...e, bold: e.bold ?? false, italic: false, bg: e.bg ?? null, rangos: [],
      getType: () => el.tipo, asParagraph: () => el, asListItem: () => el,
      // Como Apps Script: setText('') tira «No se puede insertar un elemento vacío de texto» (11/11/2026)
      getText: () => el.texto, setText: (t) => { if (t === '') throw new Error('No se puede insertar un elemento vacío de texto.'); el.texto = t; return el },
      setHeading: (h) => { el.heading = h; return el },
      getParent: () => (hijos.includes(el) ? cuerpo : null),
      // Como Apps Script: el último párrafo del documento no se puede borrar
      removeFromParent: () => { const i = hijos.indexOf(el); if (i === hijos.length - 1) throw new Error('No se puede quitar el último párrafo de una sección.'); if (i >= 0) hijos.splice(i, 1); return el },
      copy: () => elemento({ tipo: el.tipo, texto: el.texto, heading: el.heading, chip: el.chip }),
      replaceText: (re, s) => { el.texto = el.texto.replace(new RegExp(re, 'g'), s); return el },
      editAsText: () => {
        const t = {
          getText: () => el.texto,
          deleteText: (a, b) => { el.texto = el.texto.slice(0, a) + el.texto.slice(b + 1); return t },
          setBold: (v) => { if (!el.texto) throw new Error('vacío'); el.bold = v; return t },
          setItalic: (v) => { if (!el.texto) throw new Error('vacío'); el.italic = v; return t },
          setBackgroundColor: (...a) => { if (a.length === 1) el.bg = a[0]; else el.rangos.push([a[0], a[1], a[2]]); return t },
        }
        return t
      },
    }
    return el
  }
  const cuerpo = {
    getNumChildren: () => hijos.length,
    getChild: (i) => { if (i < 0 || i >= hijos.length) throw new Error(`índice fuera de rango: ${i}`); return hijos[i] },
    getChildIndex: (el) => { const i = hijos.indexOf(el); if (i < 0) throw new Error('no es hijo'); return i },
    insertParagraph: (i, texto) => { if (falla.insertar !== null && falla.insertar-- <= 0) throw new Error('falla de prueba al insertar'); const el = elemento({ tipo: 'PARAGRAPH', texto, heading: 'NORMAL', bold: true, bg: '#ffff00' }); hijos.splice(i, 0, el); return el },
    insertListItem: (i, li) => { hijos.splice(i, 0, li); return li },
    appendParagraph: (x) => { const el = typeof x === 'string' ? elemento({ tipo: 'PARAGRAPH', texto: x, heading: 'NORMAL' }) : x; hijos.push(el); return el },
    appendListItem: (li) => { hijos.push(li); return li },
  }
  for (const e of estructura) hijos.push(elemento(e))
  const conteo = { guardar: 0 }
  const doc = {
    getBody: () => cuerpo,
    saveAndClose: () => { conteo.guardar++ },
    getNamedRanges: (n) => nombrados.filter(r => r.nombre === n).map(r => ({
      getRange: () => ({ getRangeElements: () => r.els.map(e => ({ getElement: () => e })) }),
      remove: () => { nombrados.splice(nombrados.indexOf(r), 1) },
    })),
    newRange: () => { const els = []; const b = { addElement: (e) => { els.push(e); return b }, build: () => ({ els }) }; return b },
    addNamedRange: (nombre, rango) => { nombrados.push({ nombre, els: rango.els }) },
  }
  return { doc, hijos, nombrados, conteo, falla }
}

const tituloTanda = (n) => ({ tipo: 'PARAGRAPH', texto: `TANDA ${n}°`, heading: 'HEADING2' })
const chip = () => ({ tipo: 'LIST_ITEM', texto: 'Video: ', heading: 'HEADING4', chip: 'No iniciado' })
const vacio = () => ({ tipo: 'PARAGRAPH', texto: '', heading: 'NORMAL' })
/** Como la plantilla: título, aclaración y 3 tandas de 5 chips. */
function plantilla() {
  const e = [{ tipo: 'PARAGRAPH', texto: '📲 Guiones', heading: 'HEADING1' }, { tipo: 'PARAGRAPH', texto: 'Hacer click en la flechita…', heading: 'NORMAL' }]
  for (const t of [1, 2, 3]) { e.push(tituloTanda(t)); for (let i = 0; i < 5; i++) { e.push(chip()); if (i < 4) e.push(vacio()) } }
  return e
}

function entorno({ nombre = 'Guiones - PRUEBA', estructura = plantilla(), candadoLibre = true, docs = null } = {}) {
  const d = docDeJuguete(estructura)
  const llamadas = { abrir: 0, liberar: 0 }
  const ctx = {
    PREFIJO_DOC_GUIONES: 'Guiones - ',
    MimeType: { GOOGLE_DOCS },
    DriveApp: { getFileById: (id) => { assert.equal(id, DOC_ID); return { getId: () => DOC_ID, getUrl: () => `https://docs.google.com/document/d/${DOC_ID}/edit`, getName: () => nombre, getMimeType: () => GOOGLE_DOCS, isTrashed: () => false } } },
    DocumentApp: {
      ElementType: { PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM' },
      ParagraphHeading: { NORMAL: 'NORMAL' },
      openById: () => { llamadas.abrir++; return d.doc },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => candadoLibre, releaseLock: () => { llamadas.liberar++ } }) },
    ...(docs ? { Docs: docs } : {}),
  }
  vm.createContext(ctx)
  vm.runInContext(CHIPS, ctx)
  if (docs) vm.runInContext(ESTADO, ctx)
  return { ...d, llamadas, cargar: (p) => ctx.cargarEnChips_(JSON.parse(JSON.stringify(p))) }
}

const seccion = (nombre, vel, ind, texto) => [
  { tipo: 'seccion', texto: nombre }, { tipo: 'velocidad', texto: `Velocidad ${vel}` }, { tipo: 'indicacion', texto: `(${ind})` }, { tipo: 'texto', texto }, { tipo: 'vacio', texto: '' },
]
const guion = (n, extra = '') => ({ numero: n, parrafos: [
  ...seccion('HOOK', 5, 'Levantá el sobre', `Hook del guion ${n}${extra}`),
  ...seccion('CTA', 5, 'Señalá abajo', `Si sos de San Juan, escribime acá abajo (gesto con el dedo hacia abajo) así resolvemos juntos esta situación. G${n}`),
] })
const pedido = (cambios = {}) => ({ docId: DOC_ID, tanda: 1, clave: 'cj-guiones-123-1', guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n)), ...cambios })

/** Lo que hay debajo de cada chip de la tanda t (textos no vacíos), en orden. */
function bajoChips(hijos, t) {
  const ini = hijos.findIndex(e => e.texto === `TANDA ${t}°`)
  let fin = hijos.findIndex((e, i) => i > ini && /^TANDA \d/.test(e.texto)); if (fin < 0) fin = hijos.length
  const out = []
  for (let i = ini + 1; i < fin; i++) {
    if (hijos[i].tipo === 'LIST_ITEM') out.push([])
    else if (hijos[i].texto && out.length) out[out.length - 1].push(hijos[i].texto)
  }
  return out
}

test('carga cada guion debajo de su chip, en orden, y agrega el 6.º chip dentro de la TANDA 1', () => {
  const e = entorno()
  const r = e.cargar(pedido())
  assert.equal(r.ok, true, r.error); assert.equal(r.cargados, 6); assert.equal(r.agregados, 1); assert.equal(r.reemplazados, 0)
  const t1 = bajoChips(e.hijos, 1)
  assert.equal(t1.length, 6)
  t1.forEach((ps, k) => { assert.equal(ps[0], 'HOOK'); assert.equal(ps[1], 'Velocidad 5'); assert.equal(ps[3], `Hook del guion ${k + 1}`); assert.match(ps.at(-1), new RegExp(`G${k + 1}$`)) })
  assert.ok(bajoChips(e.hijos, 2).every(ps => ps.length === 0), 'la TANDA 2 no se toca')
  assert.equal(bajoChips(e.hijos, 2).length, 5)
  const nuevo = e.hijos.filter(x => x.tipo === 'LIST_ITEM')[5]
  assert.equal(nuevo.chip, 'No iniciado', 'el chip agregado es copia del último')
  assert.equal(e.conteo.guardar, 1); assert.equal(e.llamadas.liberar, 1)
})

test('formato de los Docs cargados a mano: sección en negrita, indicación y gesto resaltados, lo demás limpio', () => {
  const e = entorno()
  e.cargar(pedido())
  const p = (t) => e.hijos.find(x => x.texto === t)
  assert.equal(p('HOOK').bold, true); assert.equal(p('HOOK').bg, null)
  assert.equal(p('Velocidad 5').bold, false)
  assert.equal(p('(Levantá el sobre)').bg, ROSA)
  const hook = p('Hook del guion 1'); assert.equal(hook.bold, false); assert.equal(hook.bg, null); assert.equal(hook.italic, false)
  const cta = e.hijos.find(x => x.texto.endsWith('G1'))
  const i = cta.texto.indexOf('(gesto con el dedo hacia abajo)')
  assert.deepEqual(cta.rangos, [[i, i + '(gesto con el dedo hacia abajo)'.length - 1, ROSA]])
})

test('una segunda carga (corrección) reemplaza lo que cargó el bot, sin duplicar ni agregar chips', () => {
  const e = entorno()
  e.cargar(pedido())
  const antes = e.hijos.length
  const r = e.cargar(pedido({ guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n, n === 3 ? ' (corregido)' : '')) }))
  assert.equal(r.ok, true, r.error); assert.equal(r.agregados, 0); assert.equal(r.reemplazados, 6)
  assert.equal(e.hijos.length, antes)
  const t1 = bajoChips(e.hijos, 1)
  assert.equal(t1[2][3], 'Hook del guion 3 (corregido)')
  assert.equal(t1.filter(ps => ps.length).length, 6)
  assert.equal(e.nombrados.length, 6)
})

test('si una persona escribió debajo de un chip, frena sin tocar nada', () => {
  const est = plantilla()
  const i = est.findIndex(x => x.texto === 'TANDA 1°') + 4   // justo debajo del 2.º chip
  est.splice(i, 0, { tipo: 'PARAGRAPH', texto: 'HOOK escrito a mano', heading: 'NORMAL' })
  const e = entorno({ estructura: est })
  const foto = JSON.stringify(e.hijos.map(x => [x.tipo, x.texto]))
  const r = e.cargar(pedido())
  assert.equal(r.ok, false); assert.match(r.error, /video 2 de la TANDA 1/)
  assert.equal(JSON.stringify(e.hijos.map(x => [x.tipo, x.texto])), foto)
  assert.equal(e.conteo.guardar, 0); assert.equal(e.llamadas.liberar, 1)
})

test('sin el título de la tanda o sin chips: error sin escribir', () => {
  const e = entorno()
  assert.match(e.cargar(pedido({ tanda: 4 })).error, /no tiene el título «TANDA 4°»/)
  const s = entorno({ estructura: [tituloTanda(1), vacio()] })
  assert.match(s.cargar(pedido()).error, /no tiene ningún chip/)
  assert.equal(e.conteo.guardar + s.conteo.guardar, 0)
})

test('toma «TANDA 1:» y «TANDA 1º» como título', () => {
  for (const titulo of ['TANDA 1:', 'TANDA 1º', 'Tanda 1']) {
    const est = plantilla(); est[est.findIndex(x => x.texto === 'TANDA 1°')].texto = titulo
    const e = entorno({ estructura: est })
    assert.equal(e.cargar(pedido({ guiones: [guion(1)] })).ok, true, titulo)
  }
})

test('valida antes de abrir el doc: docs ajenos, tanda, clave y guiones', () => {
  const malos = [
    [{ nombre: 'Plantilla Guiones - C.J' }, {}],
    [{}, { tanda: -1 }], [{}, { tanda: '1' }], [{}, { clave: 'con espacios' }], [{}, { guiones: [] }],
    [{}, { guiones: [guion(1), guion(1)] }], [{}, { guiones: [{ numero: 1, parrafos: [{ tipo: 'titulo', texto: 'x' }] }] }],
    [{}, { docId: 'corto' }],
  ]
  for (const [opc, cambios] of malos) {
    const e = entorno(opc)
    const r = e.cargar(pedido(cambios))
    assert.equal(r.ok, false, JSON.stringify(cambios)); assert.equal(e.llamadas.abrir, 0, JSON.stringify(cambios))
  }
})

test('con el candado ocupado no abre el doc', () => {
  const e = entorno({ candadoLibre: false })
  assert.match(e.cargar(pedido()).error, /ocupado/)
  assert.equal(e.llamadas.abrir, 0)
})

test('ningún nombre global choca con Codigo.gs ni con Vigia.gs', { skip: !existsSync(RUTA_CODIGO) }, () => {
  const globales = (src) => new Set([...src.matchAll(/^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+))/gm)].map(m => m[1] ?? m[2]))
  const mios = new Set([...globales(CHIPS), ...globales(ESTADO)]), otros = new Set([...globales(readFileSync(RUTA_CODIGO, 'utf8')), ...globales(VIGIA)])
  assert.ok(mios.size >= 8)
  assert.deepEqual([...mios].filter(n => otros.has(n)), [])
  assert.ok(otros.has('PREFIJO_DOC_GUIONES') && otros.has('resp_'), 'usa PREFIJO_DOC_GUIONES y resp_ de Codigo.gs')
})

test('tanda 0: elige la primera TANDA con todos los chips vacíos y, en una corrección, la misma que ya cargó el bot', () => {
  const est = plantilla()
  const i = est.findIndex(x => x.texto === 'TANDA 1°') + 2   // la TANDA 1° ya tiene un guion escrito a mano
  est.splice(i, 0, { tipo: 'PARAGRAPH', texto: 'HOOK escrito a mano', heading: 'NORMAL' })
  const e = entorno({ estructura: est })
  const r = e.cargar(pedido({ tanda: 0 }))
  assert.equal(r.ok, true, r.error); assert.equal(r.tanda, 2); assert.equal(r.agregados, 1)
  assert.equal(bajoChips(e.hijos, 1)[0][0], 'HOOK escrito a mano', 'la TANDA 1° no se toca')
  assert.equal(bajoChips(e.hijos, 2).filter(ps => ps.length).length, 6)
  const r2 = e.cargar(pedido({ tanda: 0, guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n, ' v2')) }))
  assert.equal(r2.tanda, 2); assert.equal(r2.reemplazados, 6)
  assert.equal(bajoChips(e.hijos, 2)[0][3], 'Hook del guion 1 v2')
  assert.ok(bajoChips(e.hijos, 3).every(ps => ps.length === 0))
})

test('tanda 0 sin ninguna tanda libre: crea la TANDA siguiente al final, con el mismo formato, y carga ahí (5/11)', () => {
  const est = plantilla()
  for (const t of [1, 2, 3]) { const i = est.findIndex(x => x.texto === `TANDA ${t}°`) + 2; est.splice(i, 0, { tipo: 'PARAGRAPH', texto: 'a mano', heading: 'NORMAL' }) }
  const lote = []
  const docs = { Documents: {
    get: () => ({ tabs: [{ tabProperties: { tabId: 't.0' }, documentTab: { dropdownDefinitions: DEF, body: { content: [
      par('TANDA 3°\n'), par('Video: ', { id: 'v3', valor: 'Grabado completo' }), par('TANDA 4°\n'),
      ...[1, 2, 3, 4, 5, 6].map(n => par('Video: ', { id: `n${n}`, valor: n === 1 ? 'No iniciado' : 'Grabado completo' })),
    ] } } }] }),
    batchUpdate: (cuerpo) => { lote.push(...JSON.parse(JSON.stringify(cuerpo.requests))) },
  } }
  const e = entorno({ estructura: est, docs })
  const r = e.cargar(pedido({ tanda: 0 }))
  assert.equal(r.ok, true, r.error); assert.equal(r.tanda, 4); assert.equal(r.creada, true); assert.equal(r.agregados, 0); assert.equal(r.reiniciados, 5)
  const titulo = e.hijos.find(x => x.texto === 'TANDA 4°')
  assert.ok(titulo, 'el título nuevo'); assert.equal(titulo.heading, 'HEADING2', 'copia del título de la tanda anterior')
  const t4 = bajoChips(e.hijos, 4)
  assert.equal(t4.length, 6)
  t4.forEach((ps, k) => assert.equal(ps[3], `Hook del guion ${k + 1}`))
  assert.ok(e.hijos.slice(e.hijos.indexOf(titulo)).filter(x => x.tipo === 'LIST_ITEM').every(x => x.heading === 'HEADING4' && x.chip), 'chips copiados del último')
  for (const t of [1, 2, 3]) assert.ok(bajoChips(e.hijos, t).some(ps => ps.includes('a mano')), `la TANDA ${t} no se toca`)
  assert.deepEqual(lote.map(x => x.updateDropdownProperties.dropdownId), ['n2', 'n3', 'n4', 'n5', 'n6'])
  assert.ok(lote.every(x => x.updateDropdownProperties.dropdownProperties.selectedOptionId === 'dropdownItem.no'))
  // una corrección vuelve a la misma tanda, sin crear otra
  const r2 = e.cargar(pedido({ tanda: 0, guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n, ' v2')) }))
  assert.equal(r2.tanda, 4); assert.equal(r2.creada, false); assert.equal(r2.reemplazados, 6)
  assert.equal(e.hijos.filter(x => /^TANDA \d/.test(x.texto)).length, 4)
})

test('tanda 0 sin ninguna tanda con chips para copiar: error sin escribir; con tanda explícita no crea nada', () => {
  const e = entorno({ estructura: [{ tipo: 'PARAGRAPH', texto: '📲 Guiones', heading: 'HEADING1' }] })
  assert.match(e.cargar(pedido({ tanda: 0 })).error, /ninguna «TANDA N°» con chips «Video:» para copiar/)
  assert.equal(e.conteo.guardar, 0)
  const f = entorno()
  assert.match(f.cargar(pedido({ tanda: 7 })).error, /no tiene el título «TANDA 7°»/)
  assert.equal(f.hijos.filter(x => /^TANDA \d/.test(x.texto)).length, 3)
})

test('con tanda explícita, lo que el bot cargó en OTRA tanda no habilita a escribir sobre texto ajeno', () => {
  const est = plantilla()
  const i = est.findIndex(x => x.texto === 'TANDA 1°') + 2
  est.splice(i, 0, { tipo: 'PARAGRAPH', texto: 'a mano', heading: 'NORMAL' })
  const e = entorno({ estructura: est })
  assert.equal(e.cargar(pedido({ tanda: 2 })).ok, true)
  assert.match(e.cargar(pedido({ tanda: 1 })).error, /video 1 de la TANDA 1°/)
})

// ── estadoChips (31/10): los chips de la tanda pasan a «Para grabar» por la Docs API ──
const DEF = { 'kix.estado': { title: 'Estado', dropdownOptions: [
  { optionId: 'dropdownItem.no', displayValue: 'No iniciado' }, { optionId: 'dropdownItem.grabar', displayValue: 'Para grabar' },
  { optionId: 'dropdownItem.listo', displayValue: 'Grabado completo' }] } }
const par = (texto, chip, bullet = !!chip) => ({ paragraph: { ...(bullet ? { bullet: { listId: 'l1' } } : {}), elements: [
  { textRun: { content: texto } },
  ...(chip ? [{ dropdown: { dropdownId: chip.id, dropdownProperties: { dropdownDefinitionId: 'kix.estado', selectedOptionId: 'x', displayValue: chip.valor } } }] : []),
] } })
function docApi(valoresT2) {
  const content = [par('TANDA 1°\n'), par('Video: ', { id: 'c1', valor: 'Para grabar' }), par('TANDA 2°\n'),
    ...valoresT2.map((v, i) => par('Video: ', { id: `d${i + 1}`, valor: v })), par('TANDA 3°\n'), par('Video: ', { id: 'e1', valor: 'No iniciado' })]
  return { tabs: [{ tabProperties: { tabId: 't.0' }, documentTab: { body: { content }, dropdownDefinitions: DEF } }] }
}
function entornoEstado(valoresT2, { nombre = 'Guiones - PRUEBA', codigoBatch = 200 } = {}) {
  const llamadas = []
  const ctx = {
    PREFIJO_DOC_GUIONES: 'Guiones - ',
    DriveApp: { getFileById: () => ({ getName: () => nombre, isTrashed: () => false }) },
    Docs: { Documents: {
      get: (id, op) => { llamadas.push({ que: 'get', id, op }); return docApi(valoresT2) },
      batchUpdate: (cuerpo, id) => { llamadas.push({ que: 'batch', id, cuerpo }); if (codigoBatch !== 200) throw new Error(`API call failed with error ${codigoBatch}`); return {} },
    } },
  }
  vm.createContext(ctx); vm.runInContext(CHIPS, ctx); vm.runInContext(ESTADO, ctx)
  return { llamadas, estado: (p) => JSON.parse(JSON.stringify(ctx.estadoChips_(JSON.parse(JSON.stringify({ docId: DOC_ID, tanda: 2, cantidad: 6, estado: 'Para grabar', ...p }))))) }
}

test('estadoChips: pasa a «Para grabar» solo los chips «No iniciado» de SU tanda, en un solo batchUpdate', () => {
  const e = entornoEstado(['No iniciado', 'No iniciado', 'Para grabar', 'Grabado completo', 'No iniciado', 'No iniciado'])
  const r = e.estado({})
  assert.equal(r.ok, true, r.error); assert.equal(r.cambiados, 4); assert.deepEqual(r.omitidos, [{ n: 4, valor: 'Grabado completo' }])
  const batch = e.llamadas.find(x => x.que === 'batch')
  const pedidos = JSON.parse(JSON.stringify(batch.cuerpo.requests))
  assert.deepEqual(pedidos.map(x => x.updateDropdownProperties.dropdownId), ['d1', 'd2', 'd5', 'd6'])
  assert.ok(pedidos.every(x => x.updateDropdownProperties.dropdownProperties.selectedOptionId === 'dropdownItem.grabar' && x.updateDropdownProperties.fields === 'selectedOptionId' && x.updateDropdownProperties.tabId === 't.0'))
  assert.equal(batch.id, DOC_ID); assert.equal(e.llamadas[0].op.includeTabsContent, true)
})

test('estadoChips: si ya están todos, no llama a batchUpdate; soloLeer no cambia nada', () => {
  const e = entornoEstado(Array(6).fill('Para grabar'))
  assert.equal(e.estado({}).cambiados, 0)
  const l = entornoEstado(Array(6).fill('No iniciado'))
  const r = l.estado({ soloLeer: true })
  assert.equal(r.chips.length, 6); assert.ok(r.definiciones['kix.estado'])
  assert.ok([...e.llamadas, ...l.llamadas].every(x => x.que !== 'batch'))
})

test('estadoChips: errores claros (menos chips que guiones, opción inexistente, API que falla, doc ajeno)', () => {
  assert.match(entornoEstado(['No iniciado']).estado({}).error, /tiene 1 chips y hacen falta 6/)
  assert.match(entornoEstado(Array(6).fill('No iniciado')).estado({ estado: 'Publicado' }).error, /no tiene la opción «Publicado»/)
  assert.match(entornoEstado(Array(6).fill('No iniciado'), { codigoBatch: 403 }).estado({}).error, /no cambió los chips: API call failed with error 403/)
  assert.match(entornoEstado(Array(6).fill('No iniciado'), { nombre: 'Plantilla Guiones - C.J' }).estado({}).error, /solo se tocan docs/)
})

// ── 11/11/2026 (Tomás): nunca se pisa una tanda anterior y una recarga que falla deja todo como estaba ──
const foto = (hijos) => JSON.stringify(hijos.map(x => [x.tipo, x.texto, x.bold, x.bg, x.chip ?? null]))
const tramo = (hijos, t) => {
  const ini = hijos.findIndex(e => e.texto === `TANDA ${t}°`)
  let fin = hijos.findIndex((e, i) => i > ini && /^TANDA \d/.test(e.texto)); if (fin < 0) fin = hijos.length
  return foto(hijos.slice(ini, fin))
}

test('con la TANDA 1 y la 2 llenas, cargar la 3 no cambia nada de la 1 ni de la 2 (guiones, chips y estados)', () => {
  const e = entorno()
  assert.equal(e.cargar(pedido({ tanda: 1, clave: 'cj-guiones-1-1' })).ok, true)
  assert.equal(e.cargar(pedido({ tanda: 2, clave: 'cj-guiones-1-2', guiones: [1, 2, 3, 4, 5].map(n => guion(n, ' T2')) })).ok, true)
  // un chip de la TANDA 2 ya grabado, cambiado a mano
  e.hijos.filter(x => x.tipo === 'LIST_ITEM')[7].chip = 'Grabado completo'
  const t1 = tramo(e.hijos, 1), t2 = tramo(e.hijos, 2)
  const r = e.cargar(pedido({ tanda: 0, clave: 'cj-guiones-1-3', guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n, ' T3')) }))
  assert.equal(r.ok, true, r.error); assert.equal(r.tanda, 3)
  assert.equal(tramo(e.hijos, 1), t1, 'la TANDA 1 queda igual')
  assert.equal(tramo(e.hijos, 2), t2, 'la TANDA 2 queda igual')
  assert.equal(bajoChips(e.hijos, 3).filter(ps => ps.length).length, 6)
})

test('una recarga que falla a mitad deja el Doc exactamente como estaba (lo viejo no se pierde)', () => {
  const e = entorno()
  assert.equal(e.cargar(pedido()).ok, true)
  const antes = foto(e.hijos)
  e.falla.insertar = 25   // escribe un par de guiones nuevos y falla en el medio de otro
  const r = e.cargar(pedido({ guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n, ' v2')) }))
  assert.equal(r.ok, false); assert.match(r.error, /quedó como estaba/)
  assert.equal(foto(e.hijos), antes)
  assert.equal(e.nombrados.length, 6, 'los rangos del bot siguen siendo los de antes')
  assert.equal(bajoChips(e.hijos, 1)[5][3], 'Hook del guion 6')
})

test('recargar la última tanda del Doc (lo del bot llega hasta el final) ya no tira «elemento vacío de texto»', () => {
  // Doc con una sola tanda: lo que carga el bot bajo el último chip termina siendo el final del documento
  const est = [{ tipo: 'PARAGRAPH', texto: '📲 Guiones', heading: 'HEADING1' }, tituloTanda(1)]
  for (let i = 0; i < 6; i++) { est.push(chip()); if (i < 5) est.push(vacio()) }
  const e = entorno({ estructura: est })
  assert.equal(e.cargar(pedido()).ok, true)
  assert.equal(e.hijos.at(-1).texto, '', 'el Doc termina en el renglón vacío del guion 6')
  const r = e.cargar(pedido({ guiones: [1, 2, 3, 4, 5, 6].map(n => guion(n, ' v2')) }))
  assert.equal(r.ok, true, r.error); assert.equal(r.reemplazados, 6)
  const t1 = bajoChips(e.hijos, 1)
  assert.equal(t1[5][3], 'Hook del guion 6 v2')
  assert.equal(t1.flat().filter(x => /Hook del guion 6$/.test(x)).length, 0, 'lo viejo del 6 se fue')
})

test('tanda 0: una TANDA con guiones viejos escritos como título (sin viñeta) no está libre aunque tenga chips vacíos', () => {
  const est = plantilla()
  const i = est.findIndex(x => x.texto === 'TANDA 1°') + 1
  est.splice(i, 0, { tipo: 'PARAGRAPH', texto: 'Video: Grabado completo HOOK', heading: 'HEADING3' }, { tipo: 'PARAGRAPH', texto: 'Texto de un guion viejo', heading: 'NORMAL' })
  const e = entorno({ estructura: est })
  const t1 = tramo(e.hijos, 1)
  const r = e.cargar(pedido({ tanda: 0 }))
  assert.equal(r.ok, true, r.error); assert.equal(r.tanda, 2)
  assert.equal(tramo(e.hijos, 1), t1)
})

test('estadoChips: un «Video:» viejo puesto como título (sin viñeta) no cuenta como chip de la tanda', () => {
  const ctx = { PREFIJO_DOC_GUIONES: 'Guiones - ', DriveApp: { getFileById: () => ({ getName: () => 'Guiones - PRUEBA', isTrashed: () => false }) } }
  vm.createContext(ctx); vm.runInContext(CHIPS, ctx); vm.runInContext(ESTADO, ctx)
  const content = [par('TANDA 2°\n'), par('Video: ', { id: 'viejo', valor: 'Grabado completo' }, false), par('Video: ', { id: 'n1', valor: 'No iniciado' }), par('Video: ', { id: 'n2', valor: 'No iniciado' })]
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.chipsDeTandaApi_(content, 2))).map(c => c.id), ['n1', 'n2'])
})
