// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-comparar.mjs
// Comparación guiones ↔ transcripciones (e03): el cruce simple (lib/bot/grabacion/comparar.ts) y Claude solo para lo dudoso
// (compararClaude.ts, con un Claude de juguete): completo sin Claude, dudosas, faltantes, crudos sin ubicar, ubicación por
// carpeta o por contenido, mejor toma, el schema sin campos que admitan null y que a Claude va solo lo necesario.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const G = await import('../lib/bot/grabacion/guiones.ts')
const C = await import('../lib/bot/grabacion/comparar.ts')
const CC = await import('../lib/bot/grabacion/compararClaude.ts')

const guion = (ref, frases) => ({ ref, tanda: 1, numero: Number(ref.split('V')[1]), estado_doc: 'para_grabar', titulo: '', secciones: { hook: frases[0], problema: '', solucion: '', cta: '' }, frases, huella: G.huellaTexto(frases.join(' ')) })
/** Transcripción de juguete: cada palabra dura 400 ms, arrancando en `desdeMs`. */
const trans = (archivo_id, texto, desdeMs = 0) => ({ archivo_id, palabras: texto.split(/\s+/).filter(Boolean).map((w, i) => [desdeMs + i * 400, desdeMs + i * 400 + 350, w]) })

const G1 = guion('T1-V1', ['¿Te despidieron y trabajabas en negro?', 'Estar en negro no te quita la indemnización.', 'Escribime acá abajo y contame cuántos años trabajaste.'])
const G2 = guion('T1-V2', ['¿Firmaste la liquidación final de tu trabajo?', 'Firmar no cierra la puerta al reclamo laboral.'])

describe('cruceSimple', () => {
  test('todas las frases aparecen (con tomas repetidas, muletillas y la voz de quien dirige): completo, sin Claude', () => {
    const t = trans(11, 'bueno arrancamos eh te despidieron y trabajabas en negro te despidieron y trabajabas en negro dale otra vez estar en negro no te quita la indemnización escribime acá abajo y contame cuántos años trabajaste listo')
    const r = C.cruceSimple([G1], [t], { videoDe: new Map([['T1-V1', 70]]) })
    assert.equal(r.coberturas[0].estado, 'completo')
    assert.equal(r.coberturas[0].presentes, 3)
    assert.equal(r.coberturas[0].video_id, 70)
    assert.deepEqual(r.necesitaClaude, [])
    assert.equal(r.asignacion.get(11).ref, 'T1-V1'); assert.equal(r.asignacion.get(11).por, 'contenido')
  })
  test('una frase cambiada a medias es dudosa (va a Claude); una que no está, falta', () => {
    const t = trans(12, 'te despidieron y trabajabas en negro estar en blanco no te saca nada de la indemnización')
    const r = C.cruceSimple([G1], [t])
    const c = r.coberturas[0]
    assert.equal(c.estado, 'incompleto')
    assert.deepEqual(c.faltan, ['Escribime acá abajo y contame cuántos años trabajaste.'])
    assert.deepEqual(c.dudosas, ['Estar en negro no te quita la indemnización.'])
    assert.deepEqual(r.necesitaClaude, ['T1-V1'])
  })
  test('la carpeta manda: un crudo ubicado en T1-V2 cuenta para ese guion aunque hable de otra cosa', () => {
    const a = trans(21, 'te despidieron y trabajabas en negro')
    const r = C.cruceSimple([G1, G2], [a], { ubicados: new Map([[21, 'T1-V2']]) })
    assert.equal(r.asignacion.get(21).por, 'carpeta')
    assert.equal(r.coberturas.find(c => c.guion_ref === 'T1-V2').estado, 'incompleto')
    assert.equal(r.coberturas.find(c => c.guion_ref === 'T1-V1').estado, 'sin_transcripcion', 'T1-V1 no tiene crudos propios ni sueltos')
  })
  test('un crudo que no dice nada de ningún guion (o empata) queda sin ubicar', () => {
    const r = C.cruceSimple([G1, G2], [trans(31, 'hola probando probando uno dos tres')])
    assert.deepEqual(r.sin_ubicar, [31])
  })
  test('mejor toma: el crudo y el segundo con más frases seguidas', () => {
    const corto = trans(41, 'te despidieron y trabajabas en negro', 0)
    const largo = trans(42, 'uno dos tres cuatro cinco te despidieron y trabajabas en negro estar en negro no te quita la indemnización escribime acá abajo y contame cuántos años trabajaste', 10_000)
    const r = C.cruceSimple([G1], [corto, largo], { ubicados: new Map([[41, 'T1-V1'], [42, 'T1-V1']]) })
    assert.deepEqual(r.coberturas[0].mejor_toma, { archivo_id: 42, segundo: 12 })
  })
  test('sin transcripciones: sin_transcripcion y nada para Claude', () => {
    const r = C.cruceSimple([G1, G2], [])
    assert.deepEqual(r.coberturas.map(c => c.estado), ['sin_transcripcion', 'sin_transcripcion'])
    assert.deepEqual(r.necesitaClaude, [])
  })
  test('tramosCandidatos: ±20 s alrededor de las palabras del guion, nada más', () => {
    const t = trans(51, `${'relleno '.repeat(200)}te despidieron y trabajabas en negro ${'relleno '.repeat(200)}`)
    const [x] = C.tramosCandidatos(G1, [t])
    assert.equal(x.archivo_id, 51)
    assert.ok(x.texto.includes('despidieron'))
    assert.ok(x.texto.split(' ').length < 140, 'no manda toda la transcripción')
  })
  test('revisión: una toma larga del primer crudo (claves al principio y al final) no deja afuera a la toma buena del segundo', () => {
    const larga = trans(1, `te despidieron ${'bueno entonces eh la empresa mirá '.repeat(260)} trabajabas en negro`)
    const buena = trans(2, 'te despidieron y trabajabas en negro estar en blanco no te saca nada de la indemnización')
    const xs = C.tramosCandidatos(G1, [larga, buena], 20_000, 1_500)
    assert.ok(xs.some(x => x.archivo_id === 2), 'la toma buena va')
    assert.ok(xs.reduce((n, x) => n + x.texto.length, 0) <= 1_500)
  })
  test('revisión: sin fragmentos no se le pregunta a Claude por ese guion (no se paga una llamada para que diga "falta")', () => {
    const sin = trans(9, 'nada que ver con el guion')
    const cob = C.cruceSimple([G1], [sin]).coberturas.map(c => ({ ...c, dudosas: [G1.frases[1]] }))
    const p = CC.armarPedido({ guiones: [G1], coberturas: cob, trans: [sin] })
    assert.equal(p.dudas.size, 0); assert.equal(p.usuario, '')
  })
})

describe('Claude solo para lo dudoso', () => {
  const t = trans(12, 'te despidieron y trabajabas en negro estar en blanco no te saca nada de la indemnización')
  const base = C.cruceSimple([G1], [t])

  test('el schema no tiene campos que admitan null y usa $defs', () => {
    const s = JSON.stringify(CC.SCHEMA_COMPARACION)
    assert.ok(!s.includes('"null"') && !s.includes('nullable') && !s.includes('anyOf'))
    assert.ok(CC.SCHEMA_COMPARACION.$defs.frase.required.includes('archivo_id'))
  })
  test('a Claude van solo las frases dudosas o faltantes y los tramos (nunca el guion completo ni otros guiones)', () => {
    const p = CC.armarPedido({ guiones: [G1, G2], coberturas: base.coberturas, trans: [t] })
    assert.deepEqual([...p.dudas], [['T1-V1', [1, 2]]])
    assert.ok(!p.usuario.includes(G1.frases[0]), 'la frase presente no va')
    assert.ok(!p.usuario.includes('Firmaste'), 'otro guion no va')
  })
  test('con la respuesta del Claude de juguete se recalcula la cobertura (por: claude) y se anotan los desvíos', async () => {
    let pedido
    const claude = async p => {
      pedido = p
      return { json: { guiones: [{ ref: 'T1-V1', frases: [{ indice: 1, estado: 'presente', archivo_id: 12, segundo: 3 }, { indice: 2, estado: 'falta', archivo_id: -1, segundo: -1 }, { indice: 0, estado: 'falta', archivo_id: -1, segundo: -1 }] }, { ref: 'T9-V9', frases: [] }] },
        modelo: 'claude-de-juguete', usage: { input_tokens: 100, output_tokens: 20 } }
    }
    const r = await CC.compararConClaude({ guiones: [G1], coberturas: base.coberturas, trans: [t] }, claude)
    assert.equal(pedido.esfuerzo, 'medium')
    assert.ok(pedido.maxTokens >= 16_000)
    assert.ok(pedido.topeMs <= 120_000)
    const c = r.coberturas[0]
    assert.equal(c.por, 'claude')
    assert.deepEqual(c.dudosas, [])
    assert.deepEqual(c.faltan, ['Escribime acá abajo y contame cuántos años trabajaste.'])
    assert.equal(c.presentes, 2)
    assert.deepEqual(r.tokens, { in: 100, out: 20 })
    assert.equal(r.ajustes.length, 2, 'la frase 0 (no pedida) y el guion T9-V9 quedan anotados y no se usan')
  })
  test('sin nada dudoso no se llama a Claude', async () => {
    let llamado = false
    const ok = C.cruceSimple([G1], [trans(1, 'te despidieron y trabajabas en negro estar en negro no te quita la indemnización escribime acá abajo y contame cuántos años trabajaste')])
    await CC.compararConClaude({ guiones: [G1], coberturas: ok.coberturas, trans: [] }, async () => { llamado = true; return {} })
    assert.equal(llamado, false)
  })
})
