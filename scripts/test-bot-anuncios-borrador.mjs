// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-borrador.mjs
// g03: borrador EN PAUSA para los videos nuevos de una rotación (lib/bot/anuncios/borrador.ts) y su paso en el aviso de
// g01 (videos.ts). Sin red: un Meta falso que anota cada pedido.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const B = await import('../lib/bot/anuncios/borrador.ts')
const V = await import('../lib/bot/anuncios/videos.ts')

const TARGETING = { age_min: 25, age_max: 64, geo_locations: { cities: [{ name: 'Buenos Aires', region: 'Ciudad Autónoma de Buenos Aires', key: '83693' }], custom_locations: [{ latitude: -34.6, longitude: -58.3, radius: 5 }] } }
const VIDEO_DATA = { video_id: 'viejo', image_hash: 'h', message: 'copy del ganador', call_to_action: { type: 'WHATSAPP_MESSAGE' }, page_welcome_message: '{}' }

function metaFalso(o = {}) {
  const posts = [], gets = []
  let n = 0
  const graph = {
    async get(ruta, q) {
      gets.push([ruta, q])
      if (ruta.endsWith('/adsets')) return o.adsets ?? { data: [
        { id: 'S1', name: 'Broad 16/8', campaign: { id: 'C1', name: '[DM][ABO][BSAS][$250]' }, optimization_goal: 'CONVERSATIONS', billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', destination_type: 'WHATSAPP', promoted_object: { page_id: 'P' }, targeting: TARGETING, insights: { data: [{ spend: '900' }] } },
        { id: 'S0', name: 'otro', campaign: { id: 'C0', name: 'vieja' }, targeting: {}, insights: { data: [{ spend: '10' }] } },
      ] }
      if (ruta === 'act_9/ads') return o.adsCuenta ?? o.ads ?? { data: [{ id: 'A1', creative: { object_story_spec: { page_id: 'P', instagram_user_id: 'IG', video_data: VIDEO_DATA }, degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' }, video_auto_crop: { enroll_status: 'OPT_OUT' } } } }, insights: { data: [{ spend: '500' }] } }] }
      if (ruta.endsWith('/ads')) return o.ads ?? { data: [{ id: 'A1', creative: { object_story_spec: { page_id: 'P', instagram_user_id: 'IG', video_data: VIDEO_DATA }, degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' }, video_auto_crop: { enroll_status: 'OPT_OUT' } } } }, insights: { data: [{ spend: '500' }] } }] }
      if (q?.fields === 'status') return { status: { video_status: o.estadoVideo ?? 'ready' } }
      if (ruta.endsWith('/thumbnails')) return { data: [{ uri: 'https://mini', is_preferred: true }] }
      if (q?.fields === 'status,ads{status}') return o.chequeo ?? { status: 'PAUSED', ads: { data: [{ status: 'PAUSED' }, { status: 'PAUSED' }] } }
      throw new Error(`GET inesperado ${ruta}`)
    },
    async post(ruta, cuerpo) { posts.push([ruta, cuerpo]); return { id: `N${++n}` } },
  }
  return { graph, posts, gets }
}
const subida = { clave: 'videos:T2:x', carpetaId: 'T2', carpetaCliente: 'Carlos Oliva - SKWD', cliente: 'Carlos Oliva', tanda: '2° Tanda', numero: 2, hasta: '2026-10-27T12:00:00Z',
  videos: [{ id: 'd1', nombre: 'Carlos Oliva 1.mp4', creado: '2026-10-27T11:00:00Z' }, { id: 'd2', nombre: 'Carlos Oliva 2.mp4', creado: '2026-10-27T12:00:00Z' }] }
const fila = { id: 'act_9', cliente: 'Carlos Oliva', cuenta: 'CO', moneda: 'ARS', usdPor: 1563.9, pausado: false, gasto: { d7: 1 }, cpl: { d7: null }, rama: null, presupuesto: { mensualUSD: 250, ajusteDiarioUSD: 11.27, realDiarioUSD: 8 } }
const AHORA = Date.parse('2026-10-28T12:00:00Z')
const VIDS = [{ videos: subida.videos.map(v => ({ nombre: v.nombre, drive: v.id })), textos: [], titulos: [], guiones: [] }]   // 1 anuncio 3:2:2 con los 2 videos
const JUNTOS = { porAnuncio: false, diarioUSD: 3 }
const deps = m => ({ graph: m.graph, esperar: async () => {}, ahora: () => AHORA })

describe('interruptor', () => {
  test('apagado salvo ANUNCIOS_BORRADOR=real; SOLO limita las cuentas', () => {
    assert.equal(B.borradorPermitido('act_1', {}), false)
    assert.equal(B.borradorPermitido('act_1', { ANUNCIOS_BORRADOR: 'si' }), false)
    assert.equal(B.borradorPermitido('act_1', { ANUNCIOS_BORRADOR: 'real' }), true)
    assert.equal(B.borradorPermitido('act_1', { ANUNCIOS_BORRADOR: 'real', ANUNCIOS_BORRADOR_SOLO: 'act_2' }), false)
    assert.equal(B.borradorPermitido('act_2', { ANUNCIOS_BORRADOR: 'real', ANUNCIOS_BORRADOR_SOLO: 'act_2, act_3' }), true)
  })
})

describe('helpers', () => {
  test('zona y monto en la unidad de Meta', () => {
    assert.equal(B.zonaDe(TARGETING), 'CABA + radio')
    assert.equal(B.zonaDe({ geo_locations: { custom_locations: [{}, {}] } }), '2 zonas')
    assert.equal(B.zonaDe({ geo_locations: { regions: [{ name: 'Mendoza' }] } }), 'Mendoza')
    assert.equal(B.zonaDeNombre('2 -Broad | San Miguel 10 km | 18-64 | USD 5/día | 23/10/26 | V1 - Copia'), 'San Miguel 10 km')
    assert.equal(B.zonaDeNombre('Broad 16/8'), null)
    assert.equal(B.montoMeta(3, 1563.9, 'ARS'), 469170)
    assert.equal(B.montoMeta(3, 950, 'CLP'), 2850)
    assert.equal(B.montoMeta(3, 1, 'USD'), 300)
  })
})

describe('armarBorrador', () => {
  test('copia el molde y crea TODO en pausa, sin attribution_spec ni standard_enhancements', async () => {
    const m = metaFalso()
    const b = await B.armarBorrador(subida, fila, VIDS, JUNTOS, deps(m), AHORA + 60_000)
    const rutas = m.posts.map(p => p[0])
    assert.deepEqual(rutas, ['act_9/advideos', 'act_9/advideos', 'act_9/adsets', 'act_9/adcreatives', 'act_9/ads'])
    const set = m.posts[2][1]
    assert.equal(set.status, 'PAUSED'); assert.equal(set.campaign_id, 'C1'); assert.equal(set.daily_budget, '469170')
    assert.equal(set.attribution_spec, undefined)
    assert.deepEqual(set.targeting, TARGETING)
    assert.equal(set.name, 'Broad | CABA + radio | 25-64 | USD 3/día | Tanda 2 | 28/10')
    for (const [r, c] of m.posts) if (r.endsWith('/ads')) assert.equal(c.status, 'PAUSED')
    const cr = m.posts[3][1]
    assert.equal(cr.degrees_of_freedom_spec.creative_features_spec.standard_enhancements, undefined)
    assert.equal(cr.object_story_spec.video_data.video_id, 'N1')
    assert.equal(cr.object_story_spec.video_data.image_hash, undefined)
    assert.equal(cr.object_story_spec.video_data.message, 'copy del ganador')
    // 3:2:2: un solo anuncio flexible con los 2 videos y, sin textos del guion, el copy del ganador
    assert.deepEqual(cr.asset_feed_spec.videos.map(v => v.video_id), ['N1', 'N2'])
    assert.deepEqual(cr.asset_feed_spec.bodies, [{ text: 'copy del ganador' }])
    assert.equal(cr.asset_feed_spec.optimization_type, 'DEGREES_OF_FREEDOM')
    assert.match(m.posts[0][1].file_url, /drive\.usercontent\.google\.com\/download\?id=d1/)
    assert.equal(b.anuncios.length, 1)
    assert.ok(b.faltan.some(f => /3:2:2 pide 3 videos por anuncio y el anuncio 1 tiene 2/.test(f)))
    assert.match(b.link, /act=9&selected_adset_ids=N3/)
    assert.match(b.faltan[0], /copy es el del anuncio ganador/)
  })
  test('campaña con presupuesto de campaña (CBO) o sin anuncio de video: no crea nada', async () => {
    const cbo = metaFalso({ adsets: { data: [{ id: 'S', name: 'x', campaign: { id: 'C', name: 'c', daily_budget: '100' }, insights: { data: [{ spend: '1' }] } }] } })
    await assert.rejects(B.armarBorrador(subida, fila, VIDS, JUNTOS, deps(cbo), AHORA + 60_000), /CBO/)
    assert.equal(cbo.posts.length, 0)
    const sinVideo = metaFalso({ ads: { data: [{ id: 'A', creative: { object_story_spec: { link_data: {} } } }] } })
    await assert.rejects(B.armarBorrador(subida, fila, VIDS, JUNTOS, deps(sinVideo), AHORA + 60_000), /un solo video/)
    assert.equal(sinVideo.posts.length, 0)
  })
  test('conjunto sin anuncio de video simple: el formato sale del mejor de la cuenta', async () => {
    const m = metaFalso({ ads: { data: [{ id: 'AF', creative: { object_story_spec: { page_id: 'P' } } }] }, adsCuenta: { data: [{ id: 'A7', creative: { object_story_spec: { page_id: 'P', video_data: { ...VIDEO_DATA, message: 'otro copy' } } }, insights: { data: [{ spend: '5' }] } }] } })
    const b = await B.armarBorrador(subida, fila, VIDS, JUNTOS, deps(m), AHORA + 60_000)
    assert.equal(m.posts.find(p => p[0].endsWith('/adcreatives'))[1].object_story_spec.video_data.message, 'otro copy')
    assert.equal(b.anuncios.length, 1)
  })
  test('3:2:2: 3 videos, el directo de texto principal, el amplio de variante, 2 títulos y sin descripción', async () => {
    const m = metaFalso({ ads: { data: [{ id: 'A1', creative: { object_story_spec: { page_id: 'P', video_data: { ...VIDEO_DATA, title: 'viejo', link_description: 'desc' } } }, insights: { data: [{ spend: '5' }] } }] } })
    const DIRECTO = '¿Te despidieron? ⬇️\nProblema.\nEnviame un mensaje 💬 y te ayudo.', AMPLIO = 'Escena.\nHistoria.\nEnviame un mensaje 💬 y te ayudo.'
    const g = { videos: [1, 2, 3].map(i => ({ nombre: `Carlos Oliva ${i}.mp4`, drive: `d${i}` })), textos: [AMPLIO, DIRECTO], titulos: ['Escribime hoy', 'Vemos tu caso'], guiones: ['T2-V1', 'T2-V2', 'T2-V3'] }
    const b = await B.armarBorrador(subida, fila, [g], JUNTOS, deps(m), AHORA + 60_000)
    const cr = m.posts.find(p => p[0].endsWith('/adcreatives'))[1]
    assert.equal(cr.object_story_spec.video_data.message, DIRECTO)
    assert.equal(cr.object_story_spec.video_data.title, 'Escribime hoy')
    assert.equal(cr.object_story_spec.video_data.link_description, undefined)
    assert.equal(cr.asset_feed_spec.videos.length, 3)
    assert.deepEqual(cr.asset_feed_spec.bodies.map(x => x.text), [DIRECTO, AMPLIO])
    assert.deepEqual(cr.asset_feed_spec.titles.map(x => x.text), ['Escribime hoy', 'Vemos tu caso'])
    assert.equal(cr.asset_feed_spec.descriptions, undefined)
    assert.equal(m.posts.find(p => p[0].endsWith('/ads'))[1].name, '1- ¿Te despidieron?')
    assert.ok(b.faltan.some(f => /anuncio 1: 1-2-3/.test(f)))
    assert.ok(b.faltan.some(f => /textos escritos desde el guion \(anuncio 1 ← T2-V1, T2-V2, T2-V3\)/.test(f)))
    assert.ok(!b.faltan.some(f => /pide 3 videos/.test(f)))
  })
  test('sin tiempo para una petición de Meta: corta antes de subir videos o crear el conjunto', async () => {
    const m = metaFalso({ estadoVideo: 'processing' })
    await assert.rejects(B.armarBorrador(subida, fila, VIDS, JUNTOS, deps(m), AHORA + 1000), /se acabó el tiempo/)
    assert.equal(m.posts.length, 0)
  })
  test('videos que siguen procesando al agotarse la espera: no crea conjuntos', async () => {
    const m = metaFalso({ estadoVideo: 'processing' })
    let ahora = AHORA
    await assert.rejects(B.armarBorrador(subida, fila, VIDS, JUNTOS, { graph: m.graph, ahora: () => ahora, esperar: async ms => { ahora += ms } }, AHORA + 21_000), /se acabó el tiempo|no terminó de procesarlos/)
    assert.equal(m.posts.filter(p => p[0].endsWith('/adsets')).length, 0)
  })
  test('si algo no quedó en pausa, lo grita', async () => {
    const m = metaFalso({ chequeo: { status: 'ACTIVE', ads: { data: [] } } })
    await assert.rejects(B.armarBorrador(subida, fila, VIDS, JUNTOS, deps(m), AHORA + 60_000), /no quedó en pausa/)
  })
})

describe('en el aviso de g01', () => {
  const editados = async () => [{ carpetaCliente: 'Carlos Oliva - SKWD', editadosId: 'ED', tandas: [{ id: 'T2', nombre: '2° Tanda', videos: subida.videos.map(v => ({ ...v, creado: new Date(AHORA - 20 * 3_600_000).toISOString() })) }] }]
  const base = o => ({ editados, avisadoHasta: async () => new Map(), reclamar: async () => true, marcarEnviado: async () => {}, marcarDudoso: async () => {}, soltar: async () => {},
    enviar: async t => { base.ultimo = t; return 'm' }, valentino: null, ahora: () => AHORA, ...o })
  const t = { filas: [fila], porLanzar: [] }
  test('con borrador: link y aviso del copy; se arma una vez, después de reclamar', async () => {
    let armados = 0
    const r = await V.avisarVideosNuevos(t, base({ borrador: { permitido: () => true, armar: async (_s, _f, e) => { armados++; return { campana: 'Camp', campanaId: 'C1', nueva: false, conjuntos: e.porAnuncio ? [{ id: 'S1', nombre: '1- Broad', anuncios: ['a'] }, { id: 'S2', nombre: '2- Broad', anuncios: ['b'] }] : [{ id: 'S9', nombre: 'Broad | CABA | 25-64 | Tanda 2 | 28/10', anuncios: ['a', 'b'] }], conjuntoId: 'S9', conjunto: 'Broad', anuncios: ['a', 'b'], diarioLocal: 1, diarioUSD: e.diarioUSD, link: 'https://adsmanager/x', faltan: ['el copy es el del anuncio ganador: ajustalo al video'] } } } }), { desde: '2026-10-26T03:00:00Z' })
    assert.equal(armados, 1)
    // 3:2:2: 2 videos = 1 anuncio → un solo conjunto, al diario que cierra el mes
    assert.match(r.avisos[0].texto, /📝 \*\*Armado en Meta, todo EN PAUSA:\*\* en «Camp», 1 conjunto «Broad .*» con 2 anuncios, a USD 3\/día cada conjunto/)
    assert.match(r.avisos[0].texto, /📐 Un solo anuncio/)
    assert.match(r.avisos[0].texto, /⚠️ El copy es el del anuncio ganador/)
    assert.doesNotMatch(r.avisos[0].texto, /📋 \*\*Propuesta/)
  })
  test('si falla: propuesta + motivo; no permitido, en seco o ya reclamado: no se arma', async () => {
    const r = await V.avisarVideosNuevos(t, base({ borrador: { permitido: () => true, armar: async () => { throw new Error('Meta #100: algo') } } }), { desde: '2026-10-26T03:00:00Z' })
    assert.match(r.avisos[0].texto, /📋 \*\*Propuesta/)
    assert.match(r.avisos[0].texto, /No pude armarlo en Meta \(Meta #100: algo\)/)
    const nunca = { permitido: () => true, armar: async () => { throw new Error('PROHIBIDO') } }
    for (const [o, op] of [[{ borrador: { ...nunca, permitido: () => false } }, {}], [{ borrador: nunca }, { dry: true }], [{ borrador: nunca, reclamar: async () => false }, {}]]) {
      const x = await V.avisarVideosNuevos(t, base(o), { desde: '2026-10-26T03:00:00Z', ...op })
      assert.doesNotMatch(x.avisos[0].texto, /No pude armar/)
    }
  })
  test('página sin WhatsApp: ⛔ con qué hacer, sin propuesta repetida como falta', async () => {
    const r = await V.avisarVideosNuevos(t, base({ borrador: { permitido: () => true, armar: async () => { throw new Error(B.MOTIVO_SIN_WHATSAPP) } } }), { desde: '2026-10-26T03:00:00Z' })
    assert.match(r.avisos[0].texto, /⛔ \*\*No pude armarlo en Meta:\*\* la página no está vinculada a WhatsApp/)
  })
  test('lanzamientos (sin gasto) no arman borrador', async () => {
    const x = await V.avisarVideosNuevos({ filas: [{ ...fila, gasto: { d7: 0 } }], porLanzar: [] }, base({ borrador: { permitido: () => true, armar: async () => { throw new Error('PROHIBIDO') } } }), { desde: '2026-10-26T03:00:00Z' })
    assert.doesNotMatch(x.avisos[0].texto, /No pude armar|Armado en Meta/)
  })
})
