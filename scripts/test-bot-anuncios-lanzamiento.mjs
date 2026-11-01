// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-lanzamiento.mjs
// g03 (27/10): copy desde el guion (lib/bot/anuncios/copys.ts) y lanzamiento desde la ficha, todo EN PAUSA
// (lib/bot/anuncios/lanzamiento.ts). Sin red: Meta y Claude falsos.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const C = await import('../lib/bot/anuncios/copys.ts')
const L = await import('../lib/bot/anuncios/lanzamiento.ts')

const DOC = `TANDA 1°
* Video: Grabado completo
Despido sin causa
HOOK: ¿Te despidieron sin causa?
PROBLEMA: Te pagan menos.
SOLUCIÓN: Revisamos la liquidación.
CTA: Escribime.
* Video: Grabado completo
HOOK: ¿Trabajás en negro?
PROBLEMA: Perdés aportes.
CTA: Escribime.
TANDA 2°
* Video: Para grabar
HOOK: ¿Te deben horas extra?
PROBLEMA: No te las pagan.
CTA: Escribime.`
const AMPLIO = 'Un lunes te llaman a la oficina y te dicen que no vuelvas.\nTe dan un papel con números que no entendés y te apuran para que firmes.\nLo que no te dicen es que muchas liquidaciones vienen mal hechas: antigüedad, preaviso, vacaciones, aguinaldo.\nUna firma apurada puede costarte meses de sueldo.\nEnviame un mensaje 💬 y te ayudo a revisar tu caso antes de que firmes.'
const COPY = '¿Te despidieron sin causa? ⬇️\nSi firmás la liquidación sin revisarla, podés perder plata que te corresponde por antigüedad, preaviso o sueldo.\nEnviame un mensaje 💬 y te ayudo a revisar tu caso antes de que firmes algo que después no puedas reclamar.'

describe('copys: qué guion es de qué video', () => {
  test('número del archivo', () => {
    assert.equal(C.numeroVideo('Carlos Oliva 2.mp4'), 2)
    assert.equal(C.numeroVideo('Lucas Tapia 4-1.mp4'), 4)
    assert.equal(C.numeroVideo('final.mp4'), null)
  })
  test('por número dentro de la tanda; si no, el N-ésimo del doc; tanda que no existe: nada', async () => {
    const { parsearDocGuiones } = await import('../lib/bot/grabacion/guiones.ts')
    const doc = parsearDocGuiones(DOC, 'd', 'X', '2026-10-27T00:00:00Z')
    assert.equal(C.elegirGuion(doc, 1, 'X 2.mp4')?.ref, 'T1-V2')
    assert.equal(C.elegirGuion(doc, 2, 'X 1.mp4')?.ref, 'T2-V1')
    assert.equal(C.elegirGuion(doc, 2, 'X 3.mp4')?.ref, 'T2-V1')   // numeración seguida: el 3° del doc
    assert.equal(C.elegirGuion(doc, 5, 'X 1.mp4'), null)
    assert.equal(C.elegirGuion(doc, 1, 'sin numero.mp4'), null)
  })
  test('el copy tiene que cumplir el molde', () => {
    assert.equal(C.copyValido(COPY), COPY)
    assert.equal(C.copyValido('Una sola línea sin flecha'), null)
    assert.equal(C.copyValido('Gancho sin flecha\nProblema largo que no sirve para nada en este caso concreto de prueba.\nEnviame un mensaje 💬 y te ayudo.'), null)
  })
  test('3:2:2: textos válidos (amplio + directo, 2 títulos distintos)', () => {
    assert.deepEqual(C.textosValidos({ amplio: AMPLIO, directo: COPY, titulo1: 'Escribime hoy', titulo2: 'Vemos tu caso' }), { textos: [AMPLIO, COPY], titulos: ['Escribime hoy', 'Vemos tu caso'] })
    assert.equal(C.textosValidos({ amplio: COPY, directo: COPY, titulo1: 'Escribime hoy', titulo2: 'Vemos tu caso' }), null)   // el amplio no puede ser el directo
    assert.equal(C.textosValidos({ amplio: AMPLIO, directo: COPY, titulo1: 'Escribime hoy', titulo2: 'escribime hoy' }), null)
    assert.equal(C.textosValidos({ amplio: AMPLIO, directo: 'sin molde', titulo1: 'Escribime hoy', titulo2: 'Vemos tu caso' }), null)
  })
  test('gruposConTextos: de a 3 en orden, un pedido por anuncio; sin doc o si Claude falla, sin textos y con aviso', async () => {
    const s = { numero: 1, videos: [4, 2, 1, 3].map(i => ({ id: `v${i}`, nombre: `Cliente ${i}.mp4` })) }
    const T = { textos: [AMPLIO, COPY], titulos: ['Escribime hoy', 'Vemos tu caso'] }
    const pedidos = []
    let r = await C.gruposConTextos(s, 'doc', { exportarTexto: async () => DOC, escribir: async gs => { pedidos.push(gs.map(g => g.ref)); return T } })
    assert.deepEqual(r.grupos.map(g => g.videos.map(v => v.drive)), [['v1', 'v2', 'v3'], ['v4']])
    assert.equal(pedidos.length, 1); assert.deepEqual(pedidos[0].slice(0, 2), ['T1-V1', 'T1-V2'])   // un pedido a Claude por anuncio; el video 4 no tiene guion
    assert.match(r.aviso, /1 de 2 anuncios sin textos/)
    assert.deepEqual(r.grupos[0].textos, T.textos)
    r = await C.gruposConTextos(s, null, { exportarTexto: async () => DOC, escribir: async () => T })
    assert.match(r.aviso, /no encontré el doc/); assert.equal(r.grupos.length, 2)
    r = await C.gruposConTextos(s, 'doc', { exportarTexto: async () => DOC, escribir: async () => { throw new Error('sin clave') } })
    assert.equal(r.grupos.filter(g => g.textos.length).length, 0); assert.match(r.aviso, /ningún anuncio sin textos/)
  })
})

describe('lanzamiento: helpers', () => {
  test('presupuesto mensual de la ficha', () => {
    assert.equal(L.mensualDeFicha('USD 300/mes'), 300)
    assert.equal(L.mensualDeFicha('300 dólares por mes'), 300)
    assert.equal(L.mensualDeFicha('USD 10 por día'), 300)
    assert.equal(L.mensualDeFicha('USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes'), 240)
    assert.equal(L.mensualDeFicha('USD 300'), 300)
    assert.equal(L.mensualDeFicha('USD 1.500 por mes'), 1500)
    assert.equal(L.mensualDeFicha('a confirmar'), null)
  })
  test('página: la única, o la que comparte palabras con el cliente', () => {
    assert.equal(L.elegirPagina([{ id: '1', name: 'X' }], 'Ana Pérez')?.id, '1')
    assert.equal(L.elegirPagina([{ id: '1', name: 'Estudio Pérez' }, { id: '2', name: 'Otra' }], 'Ana Pérez')?.id, '1')
    assert.equal(L.elegirPagina([{ id: '1', name: 'A' }, { id: '2', name: 'B' }], 'Ana Pérez'), null)
  })
  test('zona: elige la provincia que comparten los lugares (Pedernal de San Juan, no de Entre Ríos)', async () => {
    const R = { 'Pedernal': [{ key: 'PE', name: 'Pedernal', type: 'city', region: 'Entre Rios' }, { key: 'PS', name: 'Pedernal', type: 'city', region: 'San Juan' }],
      'Caucete': [{ key: 'CA', name: 'Caucete', type: 'city', region: 'San Juan' }], 'Nada': [] }
    const g = { get: async (_r, q) => ({ data: R[q.q] ?? [] }) }
    const z = await L.geoDeFicha(g, ['Pedernal (de oído)', 'Caucete', 'Nada'], 20, 'AR', '')
    assert.deepEqual(z.geo.cities.map(c => c.key), ['PS', 'CA'])
    assert.deepEqual(z.ubicados, ['Pedernal (San Juan)', 'Caucete (San Juan)'])
    assert.deepEqual(z.sinUbicar, ['Nada'])
    const z2 = await L.geoDeFicha(g, ['Pedernal'], 20, 'AR', 'Paraná, Entre Ríos')   // la ficha nombra la provincia
    assert.deepEqual(z2.geo.cities.map(c => c.key), ['PE'])
  })
  test('la bienvenida y las mejoras apagadas', () => {
    assert.match(JSON.parse(L.BIENVENIDA).text_format.message.text, /de dónde sos/)
    assert.ok(Object.values(L.MEJORAS_APAGADAS).every(x => x.enroll_status === 'OPT_OUT'))
  })
})

describe('armarLanzamiento', () => {
  const AHORA = Date.parse('2026-10-28T12:00:00Z')
  const kickoff = {
    cuenta: { id: 'act_7', nombre: 'Estudio Pérez', monedaHora: 'ARS' }, rama: { nombre: 'Laboral', texto: '', subramas: [] },
    zona: { pais: 'AR', lugares: ['Lomas de Zamora', 'Lugar inventado'], descripcion: '', radioKm: 15, presentarse: null, mapa: null },
    presupuesto: { texto: 'USD 300/mes', aConfirmar: false }, frenos: [{ nombre: 'Tarjeta', detalle: 'falta', frena: true }],
  }
  const pl = { cliente: 'Ana Pérez', acceso: 'si', kickoff }
  const s = { numero: 1, videos: [] }
  // 2 anuncios 3:2:2 (de un video cada uno, para probar la regla con 2 conjuntos)
  const vids = [1, 2].map(i => ({ videos: [{ nombre: `Ana ${i}.mp4`, drive: `d${i}` }], textos: [AMPLIO, COPY], titulos: ['Escribime hoy', 'Vemos tu caso'], guiones: [`T1-V${i}`] }))
  function meta(o = {}) {
    const posts = [], tipos = {}; let n = 0
    const graph = {
      async get(ruta, q) {
        if (ruta === 'act_7' && q?.fields?.startsWith('business')) return { business: { owned_pages: { data: o.portfolio ?? [] } } }
        if (ruta === 'act_7') return { currency: 'ARS', account_status: o.estado ?? 1 }
        if (ruta.endsWith('/promote_pages')) return { data: o.paginas ?? [{ id: 'P1', name: 'Estudio Pérez', instagram_business_account: { id: 'IG1' } }] }
        if (ruta === 'search') return { data: /Lomas/.test(q.q) ? [{ key: '123', name: 'Lomas de Zamora', type: 'city', region: 'Buenos Aires' }] : [] }
        if (q?.fields === 'status') return tipos[ruta] === 'campaigns' ? { status: 'PAUSED' } : { status: { video_status: 'ready' } }
        if (ruta.endsWith('/thumbnails')) return { data: [{ uri: 'u', is_preferred: true }] }
        if (q?.fields === 'status,ads{status}') return { status: 'PAUSED', ads: { data: [{ status: 'PAUSED' }] } }
        throw new Error(`GET inesperado ${ruta}`)
      },
      async post(ruta, cuerpo) { posts.push([ruta, cuerpo]); const id = `N${++n}`; tipos[id] = ruta.split('/')[1]; return { id } },
    }
    return { graph, posts }
  }
  const deps = m => ({ graph: m.graph, esperar: async () => {}, ahora: () => AHORA, usdPor: x => (x === 'ARS' ? 1500 : 1), habitantes: async () => 700_000 })

  test('crea campaña, conjuntos por video y anuncios, TODO en pausa, con la configuración de Valen', async () => {
    const m = meta()
    const b = await L.armarLanzamiento(s, pl, vids, deps(m), AHORA + 60_000)
    const camp = m.posts.find(p => p[0] === 'act_7/campaigns')[1]
    assert.equal(camp.status, 'PAUSED'); assert.equal(camp.objective, 'OUTCOME_ENGAGEMENT'); assert.equal(camp.is_adset_budget_sharing_enabled, false)
    assert.equal(camp.name, 'Laboral | DM-WPP | ABO | 28/10/26 [USD 300/MES]')
    const sets = m.posts.filter(p => p[0] === 'act_7/adsets').map(p => p[1])
    assert.equal(sets.length, 2)   // 2 × 3,5 × 4 = 28 = 9 % de 300 → uno por anuncio
    for (const x of sets) {
      assert.equal(x.status, 'PAUSED'); assert.equal(x.daily_budget, String(Math.round(3.5 * 1500 * 100)))
      assert.equal(x.destination_type, 'WHATSAPP'); assert.equal(x.optimization_goal, 'CONVERSATIONS')
      assert.deepEqual(x.targeting.geo_locations.cities, [{ key: '123', radius: 15, distance_unit: 'kilometer' }])
      assert.equal(x.targeting.targeting_automation.advantage_audience, 0); assert.deepEqual(x.targeting.device_platforms, ['mobile'])
      assert.deepEqual(x.targeting.publisher_platforms, ['facebook', 'instagram'])
    }
    assert.match(sets[0].name, /^1- Broad \| Lomas de Zamora 15 km \| 18-64 \| USD 3,5\/día \| Tanda 1 \| 28\/10\/26$/)
    const cr = m.posts.find(p => p[0] === 'act_7/adcreatives')[1]
    assert.equal(cr.object_story_spec.page_id, 'P1'); assert.equal(cr.object_story_spec.instagram_user_id, 'IG1')
    assert.equal(cr.object_story_spec.video_data.message, COPY); assert.equal(cr.object_story_spec.video_data.call_to_action.type, 'WHATSAPP_MESSAGE')
    for (const [r, c] of m.posts) if (r === 'act_7/ads') { assert.equal(c.status, 'PAUSED'); assert.match(c.name, /^\d- ¿Te despidieron sin causa\? · V\d$/) }
    assert.equal(b.nueva, true)
    assert.ok(b.faltan.some(f => /no ubiqué en Meta: Lugar inventado/.test(f)))
    assert.ok(b.faltan.some(f => /frenos \(Tarjeta\)/.test(f)))
  })
  test('sin páginas para promocionar: usa la del portfolio de la cuenta', async () => {
    const m = meta({ paginas: [], portfolio: [{ id: 'PB', name: 'Estudio Ana Pérez' }] })
    await L.armarLanzamiento(s, pl, vids, deps(m), AHORA + 60_000)
    assert.equal(m.posts.find(p => p[0] === 'act_7/adcreatives')[1].object_story_spec.page_id, 'PB')
  })
  test('sin país o sin presupuesto confirmado no escribe; con UY busca la zona en Uruguay', async () => {
    for (const cambio of [
      { zona: { ...kickoff.zona, pais: null } },
      { presupuesto: { texto: 'a confirmar', aConfirmar: false } },
      { presupuesto: { texto: 'USD 300/mes', aConfirmar: true } },
    ]) {
      const m = meta()
      await assert.rejects(L.armarLanzamiento(s, { ...pl, kickoff: { ...kickoff, ...cambio } }, vids, deps(m), AHORA + 60_000), /falta confirmar/)
      assert.equal(m.posts.length, 0)
    }
    const m = meta(), get = m.graph.get, paises = []
    m.graph.get = async (ruta, q) => { if (ruta === 'search') paises.push(q.country_code); return get(ruta, q) }
    await L.armarLanzamiento(s, { ...pl, kickoff: { ...kickoff, zona: { ...kickoff.zona, pais: 'UY' } } }, vids, deps(m), AHORA + 60_000)
    assert.ok(paises.length > 0)
    assert.ok(paises.every(p => p === 'UY'))
  })
  test('si se agotó el tiempo antes de subir videos, no escribe en Meta', async () => {
    const m = meta()
    await assert.rejects(L.armarLanzamiento(s, pl, vids, deps(m), AHORA + 10_000), /se acabó el tiempo/)
    assert.equal(m.posts.length, 0)
  })
  test('no arma: sin copy, cuenta inactiva, página ambigua o zona sin ubicar (y no crea nada)', async () => {
    for (const [o, v, re] of [
      [{}, [{ ...vids[0], textos: [], titulos: [] }], /faltan los textos/],
      [{ estado: 2 }, vids, /no está activa/],
      [{ paginas: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }, vids, /qué página/],
    ]) {
      const m = meta(o)
      await assert.rejects(L.armarLanzamiento(s, pl, v, deps(m), AHORA + 60_000), re)
      assert.equal(m.posts.length, 0)
    }
    const m = meta()
    await assert.rejects(L.armarLanzamiento(s, { ...pl, kickoff: { ...kickoff, zona: { ...kickoff.zona, lugares: ['Nada'] } } }, vids, deps(m), AHORA + 60_000), /ubicar/)
    assert.equal(m.posts.length, 0)
  })
})
