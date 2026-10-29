// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-textos.mjs
// Textos para el cliente (lib/edicion/textos.ts, versión tx1): e01 (día 0 y recordatorios), regrabación y link final, y las
// guías internas de los días 2, 4 y 9. P6: ningún texto para el cliente dice ronda, tope ni "no". Sin red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const T = await import('../lib/edicion/textos.ts')

const paso = (over = {}) => ({
  id: 1, id_crm: 'A101', cliente: 'Ana Pérez', ciclo: '2026-10-26', motivo: 'para_grabar', escalon: 'dia0', debido: '2026-10-26', dias_habiles: 0,
  videos: [11, 12, 13], responsable: 'aylu', texto: '', hecho: null, decision: null, estado: 'abierto', version: 1, ...over,
})
const PROHIBIDAS = /\b(no|ronda|rondas|tope|topes|l[ií]mite|m[aá]ximo|negamos|imposible)\b/i
const sinProhibidas = (t, que) => assert.ok(!PROHIBIDAS.test(t), `${que} trae una palabra prohibida: ${t.match(PROHIBIDAS)?.[0]}\n${t}`)
const sinDatos = t => {
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(t), 'sin mails')
  assert.ok(!/\+?\d[\d\s().-]{7,}\d/.test(t.replace(/https?:\/\/\S+/g, '')), 'sin teléfonos')
}

describe('e01', () => {
  test('día 0: para el cliente, con el link al doc, la fecha propuesta y la cantidad de videos', () => {
    const r = T.textoE01({ paso: paso(), nombre: 'Ana', linkGuiones: 'https://docs.google.com/document/d/abc123def456/edit', fechaSugerida: '2026-10-29', videos: 3 })
    assert.equal(r.para, 'grupo_contenido')
    assert.equal(r.version, 'tx1')
    assert.match(r.texto, /^¡Hola, Ana!/)
    assert.match(r.texto, /los 3 videos/)
    assert.match(r.texto, /https:\/\/docs\.google\.com\/document\/d\/abc123def456\/edit/)
    assert.match(r.texto, /el jueves 29\/10/)
    sinProhibidas(r.texto, 'día 0'); sinDatos(r.texto)
  })
  test('día 0 sin link: nombra el doc «Guiones» de la carpeta; un solo video en singular', () => {
    const r = T.textoE01({ paso: paso(), nombre: 'Ana', linkGuiones: null, fechaSugerida: '2026-10-29', videos: 1 })
    assert.match(r.texto, /doc «Guiones» de tu carpeta/)
    assert.match(r.texto, /el video para grabar/)
    sinProhibidas(r.texto, 'día 0 sin link')
  })
  test('día 0 de un ciclo de regrabación: pregunta por lo que hay que volver a grabar', () => {
    const r = T.textoE01({ paso: paso({ motivo: 'regrabar' }), nombre: 'Ana', linkGuiones: null, fechaSugerida: '2026-10-29', videos: 2 })
    assert.match(r.texto, /volver a grabar/)
    sinProhibidas(r.texto, 'día 0 regrabar')
  })
  test('recordatorios (r1, r2…): para el cliente, amables, con link y fecha', () => {
    for (const escalon of ['r1', 'r2', 'r7']) {
      const r = T.textoE01({ paso: paso({ escalon }), nombre: 'Ana', linkGuiones: 'https://docs.google.com/document/d/abc123def456/edit', fechaSugerida: '2026-11-03', videos: 5 })
      assert.equal(r.para, 'grupo_contenido')
      assert.match(r.texto, /¿Cómo venís con la grabación de los 5 videos\?/)
      assert.match(r.texto, /el martes 3\/11/)
      sinProhibidas(r.texto, escalon); sinDatos(r.texto)
    }
  })
  test('días 2 y 4: guías internas para Gero M (audio y llamada citando el contrato); día 9: Tomás decide', () => {
    const d2 = T.textoE01({ paso: paso({ escalon: 'dia2', responsable: 'gero_m' }), nombre: 'Ana', linkGuiones: null, fechaSugerida: '2026-10-29', videos: 3 })
    assert.equal(d2.para, 'interno'); assert.equal(d2.responsable, 'gero_m')
    assert.ok(d2.pasos.some(p => /audio corto/.test(p)))
    const d4 = T.textoE01({ paso: paso({ escalon: 'dia4', responsable: 'gero_m' }), nombre: 'Ana', linkGuiones: null, fechaSugerida: '2026-10-29', videos: 3 })
    assert.equal(d4.para, 'interno'); assert.equal(d4.responsable, 'gero_m')
    assert.ok(d4.pasos.some(p => p.includes(T.CLAUSULA_CONTRATO)), 'la cláusula queda pendiente de Tomás, no se inventa')
    const d9 = T.textoE01({ paso: paso({ escalon: 'dia9', responsable: 'tomas' }), nombre: 'Ana', linkGuiones: null, fechaSugerida: '2026-10-29', videos: 3 })
    assert.equal(d9.para, 'interno'); assert.equal(d9.responsable, 'tomas')
    assert.ok(d9.pasos.some(p => /pausar el servicio o seguir/.test(p)))
  })
  test('fecha sugerida: dos días hábiles después (saltea fin de semana y feriados)', () => {
    assert.equal(T.fechaSugeridaE01('2026-10-22'), '2026-10-26')   // jueves → lunes
    assert.equal(T.fechaSugeridaE01('2026-10-26'), '2026-10-28')   // lunes → miércoles
    assert.equal(T.sumarHabiles('2026-11-19', 2), '2026-11-24')    // el lunes 23/11 es feriado (Soberanía, trasladado)
    assert.equal(T.fechaParaCliente('2026-10-28'), 'el miércoles 28/10')
  })
  test('nombre de saludo: el primer nombre de una persona; una dupla o un estudio, entero', () => {
    assert.equal(T.nombreDeSaludo('Lucas Quiroga'), 'Lucas')
    assert.equal(T.nombreDeSaludo('Flor y Gianfranco'), 'Flor y Gianfranco')
    assert.equal(T.nombreDeSaludo('Estudio Romero'), 'Estudio Romero')
    assert.equal(T.nombreDeSaludo('  '), '')
  })
})

describe('regrabación y link final', () => {
  test('regrabar: un renglón por video con el motivo en lenguaje amable; sin "duro" ni negativas', () => {
    const r = T.textoRegrabar({ nombre: 'Ana', tanda: 2, videos: [
      { clave: 'T2-V3', motivo: 'duro', detalle: '' },
      { clave: 'T2-V4', motivo: 'audio', detalle: 'se escucha el ventilador' },
      { clave: 'T2-V5', motivo: 'otro', detalle: 'grabalo con la toga puesta' },
      { clave: 'CU-86abc', motivo: 'encuadre', detalle: '' },
    ] })
    assert.equal(r.para, 'grupo_contenido')
    assert.match(r.texto, /tanda 2/)
    assert.match(r.texto, /• Video 3: que salga más suelto y natural/)
    assert.match(r.texto, /• Video 4: que el audio se escuche más claro.*\(se escucha el ventilador\)/)
    assert.match(r.texto, /• Video 5: grabalo con la toga puesta\./)
    assert.match(r.texto, /• Video: acomodar el encuadre/)
    assert.ok(!/\bduro\b/i.test(r.texto), 'el motivo interno no le llega al cliente')
    for (const motivo of Object.keys(T.MOTIVO_AMABLE)) sinProhibidas(T.MOTIVO_AMABLE[motivo], `motivo ${motivo}`)
    sinProhibidas(r.texto, 'regrabar'); sinDatos(r.texto)
  })
  test('link final: un renglón por video con título y link; invita a pedir ajustes sin hablar de rondas', () => {
    const r = T.textoLinkFinal({ nombre: 'Ana', tanda: 1, videos: [
      { clave: 'T1-V1', titulo: '¿Te despidieron sin causa?', url: 'https://drive.google.com/file/d/AAAAAAAAAAAA/view' },
      { clave: 'T1-V2', titulo: '', url: 'https://drive.google.com/file/d/BBBBBBBBBBBB/view' },
    ] })
    assert.match(r.texto, /¡Ya están listos los videos de la tanda 1!/)
    assert.match(r.texto, /• Video 1 — ¿Te despidieron sin causa\?: https:\/\/drive\.google\.com\/file\/d\/AAAAAAAAAAAA\/view/)
    assert.match(r.texto, /• Video 2: https:\/\/drive\.google\.com\/file\/d\/BBBBBBBBBBBB\/view/)
    assert.match(r.texto, /ajustar algo/)
    sinProhibidas(r.texto, 'link final'); sinDatos(r.texto)
  })
  test('etiqueta del video: T2-V4 → Video 4; CU-… → Video', () => {
    assert.equal(T.etiquetaVideo('T2-V4'), 'Video 4')
    assert.equal(T.etiquetaVideo('T10-V12'), 'Video 12')
    assert.equal(T.etiquetaVideo('CU-86b2x'), 'Video')
    assert.equal(T.etiquetaVideo('CU-86b2x', 3), 'Video 3', 'un importado con el número leído del nombre de ClickUp')
  })
  test('revisión: con UN video todo va en singular (link final, día 0, recordatorio, regrabación)', () => {
    const malos = /están listos el video|de el video|\bMiralos\b|grabarlos|subilos|\blos subas\b|tenerlos/
    const link = T.textoLinkFinal({ nombre: 'Lucas', tanda: 2, videos: [{ clave: 'T2-V3', titulo: 'El gancho', url: 'https://drive.google.com/file/d/abc/view' }] }).texto
    assert.match(link, /¡Ya está listo el video de la tanda 2!/); assert.match(link, /Miralo con tiempo y contanos qué te parece\./)
    const d0 = T.textoE01({ paso: paso(), nombre: 'Lucas', linkGuiones: null, fechaSugerida: '2026-10-28', videos: 1 }).texto
    assert.match(d0, /Ya está listo el video para grabar/); assert.match(d0, /grabarlo para/)
    const re = T.textoE01({ paso: paso({ escalon: 'r1' }), nombre: 'Lucas', linkGuiones: null, fechaSugerida: '2026-10-28', videos: 1 }).texto
    assert.match(re, /la grabación del video/)
    const rg = T.textoE01({ paso: paso({ motivo: 'regrabar' }), nombre: 'Lucas', linkGuiones: null, fechaSugerida: '2026-10-28', videos: 1 }).texto
    const reg = T.textoRegrabar({ nombre: 'Lucas', tanda: 2, videos: [{ clave: 'T2-V3', motivo: 'falta_frase', detalle: 'la frase del CTA' }] }).texto
    assert.match(reg, /• Video 3: sumar una parte del guion que quedó afuera \(la frase del CTA\)\./, 'el detalle de Aylu llega al texto')
    assert.match(reg, /Cuando lo tengas, subilo/)
    for (const [que, t] of Object.entries({ link, d0, re, rg, reg })) { assert.ok(!malos.test(t), `${que}: ${t.match(malos)?.[0]}`); sinProhibidas(t, que) }
    const varios = T.textoLinkFinal({ nombre: 'Lucas', tanda: 2, videos: [{ clave: 'T2-V3', titulo: '', url: 'https://a.test/1' }, { clave: 'T2-V4', titulo: '', url: 'https://a.test/2' }] }).texto
    assert.match(varios, /Miralos con tiempo y contanos qué te parecen\./)
  })
})
