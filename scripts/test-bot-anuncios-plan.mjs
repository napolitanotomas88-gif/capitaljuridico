// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-plan.mjs
// g03: la regla de estructura de Tomás (24/10/2026) y el plan de campaña (lib/bot/anuncios/plan.ts). Puro: sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const P = await import('../lib/bot/anuncios/plan.ts')

describe('decidirEstructura (regla de Tomás)', () => {
  test('sus ejemplos: 300 + 500 mil → por video · 300 + 6 millones → todos juntos · 600 + 6 millones → por video · 300 + 300 mil → ampliar', () => {
    assert.equal(P.decidirEstructura(300, 500_000, 5).estructura, 'por_video')
    assert.equal(P.decidirEstructura(300, 6_000_000, 5).estructura, 'todos_juntos')
    assert.equal(P.decidirEstructura(600, 6_000_000, 5).estructura, 'por_video')
    const chica = P.decidirEstructura(300, 300_000, 5)
    assert.equal(chica.ampliarZona, true)
  })
  test('lo del 28/9: 200–250 por mes va todo junto; sin presupuesto o con un video, todo junto', () => {
    assert.equal(P.decidirEstructura(240, 800_000, 5).estructura, 'todos_juntos')
    assert.equal(P.decidirEstructura(200, 500_000, 5).estructura, 'todos_juntos')
    assert.equal(P.decidirEstructura(null, 500_000, 5).estructura, 'todos_juntos')
    assert.equal(P.decidirEstructura(600, 500_000, 1).estructura, 'todos_juntos')
  })
  test('el corte es el 25 % del mensual con la tarifa según el tamaño de la zona', () => {
    const d = P.decidirEstructura(280, 900_000, 5)   // 5 × 3,5 × 4 = 70 = 25 %
    assert.equal(d.testeoUSD, 70)
    assert.equal(d.estructura, 'por_video')
    assert.equal(P.decidirEstructura(279, 900_000, 5).estructura, 'todos_juntos')
    assert.equal(P.decidirEstructura(600, 1_200_000, 5).tarifa, 6.5)
  })
})

describe('armarPlan', () => {
  const base = { cliente: 'Laura', rama: 'laboral', zona: 'Gran San Juan', videos: ['A', 'B', 'C', 'D', 'E'], fecha: '2026-10-27' }
  test('por video: nombres como los de Valentino y un anuncio por conjunto', () => {
    const p = P.armarPlan({ ...base, mensualUSD: 300, habitantes: 500_000 })
    assert.equal(p.campana, 'Laboral | DM-WPP | ABO | 27/10/26 [USD 300/MES]')
    assert.equal(p.conjuntos.length, 5)
    assert.equal(p.conjuntos[0].nombre, '1- Broad | Gran San Juan | 18-64 | USD 3.5/día | 27/10')
    assert.deepEqual(p.conjuntos[4].anuncios, ['5- E'])
    assert.equal(p.diarioTotalUSD, 17.5)
    assert.ok(p.avisos.some(a => /bajar el gasto/.test(a)))
  })
  test('todos juntos: un conjunto, diario = mensual / 30 con mínimo 8', () => {
    const p = P.armarPlan({ ...base, mensualUSD: 200, habitantes: 800_000 })
    assert.equal(p.conjuntos.length, 1)
    assert.equal(p.conjuntos[0].diarioUSD, 8)
    assert.equal(P.armarPlan({ ...base, mensualUSD: 300, habitantes: 6_000_000 }).conjuntos[0].diarioUSD, 10)
  })
  test('avisos: zona chica, sin habitantes, sin presupuesto, sin rama; ganchos largos se acortan', () => {
    const p = P.armarPlan({ ...base, rama: null, mensualUSD: null, habitantes: 200_000, videos: ['x'.repeat(100)] })
    assert.ok(p.avisos.some(a => /ampliarla/.test(a)))
    assert.ok(p.avisos.some(a => /presupuesto mensual/.test(a)))
    assert.match(p.campana, /^General \|/)
    assert.ok(p.conjuntos[0].anuncios[0].length <= 64)
    assert.ok(P.armarPlan({ ...base, mensualUSD: 300, habitantes: null }).avisos.some(a => /sin habitantes|No hay habitantes/.test(a)))
  })
  test('el texto entra en Discord, menciona solo a Valentino y escapa lo que viene de afuera', () => {
    const p = P.armarPlan({ ...base, mensualUSD: 300, habitantes: 500_000, videos: Array.from({ length: 12 }, (_, i) => `@everyone **gancho ${i}**`) })
    const t = P.textoPlan(p, 'Dra. <@123> Laura', '222222222222222222')
    assert.ok(t.length <= 1900)
    assert.ok(t.startsWith('<@222222222222222222> 📋'))
    assert.ok(!/@everyone|<@123>/.test(t.replace('<@222222222222222222>', '')))
  })
})
