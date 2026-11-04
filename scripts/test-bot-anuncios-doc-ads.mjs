// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-doc-ads.mjs
// Doc «Organización de ADS - Orgánico» (docAds.ts) y el lanzamiento desde el Doc (docAdsLanzar.ts). Sin red: deps falsas.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const D = await import('../lib/bot/anuncios/docAds.ts')
const L = await import('../lib/bot/anuncios/docAdsLanzar.ts')
const B = await import('../lib/bot/anuncios/borrador.ts')
const LB = await import('../lib/bot/anuncios/docAdsBase.ts')
const VACIA = () => LB.lineaBaseDe([{ huella: 'b:otro', tipo: 'bloque', bloque: 'otro', listo: false, estado: 'base' }])

const ID = n => `1AbCdEfGhIjKlMnOpQrStUvWx${n}`
const COPY = n => `¿Te chocaron y no sabés qué reclamar ${n}? ⬇️\nLa aseguradora puede ofrecerte poco y perder lo que te corresponde.\nEnviame un mensaje 💬 y te ayudo a revisar tu caso antes de aceptar.`
const DOC = [
  'Organización de ADS - Orgánico',
  'Juana Perezz - LISTO',
  `video 1:https://drive.google.com/file/d/${ID(1)}/view `,
  ...COPY(1).split('\n'),
  `video 2:https://drive.google.com/file/d/${ID(2)}/view?usp=drive_link`,
  ...COPY(2).split('\n'),
  'Marta Gómez - Hacer la campaña desde su perfil de ig cuando estén todos publicados',
  `video 1:https://drive.google.com/file/d/${ID(3)}/view`,
  ...COPY(3).split('\n'),
  '04/11 9HS',
  'video 2: Publicado',
  '',
  '3- Pedro Ruiz - LISTO (Acceso portfolio)',
  `https://drive.google.com/file/d/${ID(4)}/view`,
  ...COPY(4).split('\n'),
  'Una citación no es para ir a explicar y listo: lo que digas puede tener consecuencias, por eso hay que preparar la defensa.',
  'Juana Perezz - LISTO',
  `video 1:https://drive.google.com/file/d/${ID(9)}/view`,
  ...COPY(9).split('\n'),
].join('\n')

describe('parsearDocAds', () => {
  const b = D.parsearDocAds(DOC)
  test('un bloque por encabezado, en orden, con estado y nota', () => {
    assert.deepEqual(b.map(x => [x.nombre, x.listo, x.nota]), [['Juana Perezz', true, null], ['Marta Gómez', false, 'Hacer la campaña desde su perfil de ig cuando estén todos publicados'], ['Pedro Ruiz', true, '(Acceso portfolio)'], ['Juana Perezz', true, null]])
  })
  test('videos con link de Drive, copy de 3 párrafos y fecha', () => {
    assert.deepEqual(b[0].videos.map(v => [v.numero, v.drive]), [[1, ID(1)], [2, ID(2)]])
    assert.equal(b[0].videos[0].copy, COPY(1))
    assert.equal(b[1].videos[0].fecha, '04/11 9HS')
    assert.deepEqual([b[1].videos[1].drive, b[1].videos[1].nota], [null, 'Publicado'])
  })
  test('un link suelto debajo del encabezado es el video siguiente; una frase del copy con «listo» no es encabezado', () => {
    assert.equal(b[2].videos.length, 1)
    assert.equal(b[2].videos[0].drive, ID(4))
    assert.ok(b[2].videos[0].copy.endsWith('preparar la defensa.'))
  })
  test('partirEncabezado', () => {
    assert.deepEqual(D.partirEncabezado('Juan Cruz - Ripamonti - LISTO'), { nombre: 'Juan Cruz - Ripamonti', estado: 'LISTO' })
    assert.deepEqual(D.partirEncabezado('Ana Paz . Listo'), { nombre: 'Ana Paz', estado: 'Listo' })
    assert.equal(D.partirEncabezado('¿Te despidieron? ⬇️'), null)
  })
})

describe('cruce del nombre', () => {
  test('tolera una letra («Perezz» = «Perez») y pide 2 palabras para «firme»', () => {
    const xs = [{ cliente: 'Juana Perez' }, { cliente: 'Juana Otra' }]
    assert.deepEqual(D.cruzarNombreDoc('Juana Perezz', xs), { x: xs[0], fuerza: 'firme' })
    assert.equal(D.cruzarNombreDoc('Juana', xs), null)   // empate
    assert.equal(D.cruzarNombreDoc('Juana', [xs[0]]).fuerza, 'debil')
  })
  test('estadoPorCliente: el bloque más arriba gana', () => {
    const xs = [{ cliente: 'Juana Perez' }, { cliente: 'Marta Gomez' }]
    const m = D.estadoPorCliente(D.parsearDocAds(DOC), xs)
    assert.equal(m.get(xs[0]).linea, 2)
    assert.equal(m.get(xs[0]).videos, 2)
    assert.equal(m.get(xs[1]).listo, false)
    assert.ok(D.armaDesdeDoc(m.get(xs[0])))
    assert.ok(!D.armaDesdeDoc(m.get(xs[1])))
  })
})

describe('grupos y copy', () => {
  test('un grupo por video (cada uno es su idea → su conjunto), con su copy propio', () => {
    const gs = D.gruposDesdeDoc([1, 2, 3, 4].map(n => ({ drive: ID(n), nombre: `v${n}`, copy: COPY(n) })))
    assert.equal(gs.length, 4)
    assert.deepEqual(gs.map(g => g.videos.length), [1, 1, 1, 1])
    assert.equal(gs[1].copyPorVideo[ID(2)], COPY(2))
    assert.ok(B.grupoConCopy(gs[0]))
    assert.ok(!B.grupoConCopy({ ...gs[0], copyPorVideo: {} }))
  })
  test('claveDoc cambia si cambian los videos', () => {
    const c = { idCrm: 'Z001', cliente: 'Juana Perez' }
    assert.equal(D.claveDoc(c, [ID(1), ID(2)]), D.claveDoc(c, [ID(2), ID(1)]))
    assert.notEqual(D.claveDoc(c, [ID(1), ID(2)]), D.claveDoc(c, [ID(1), ID(2), ID(3)]))
  })
})

// ── El orquestador ──
const ficha = (o = {}) => ({ idCrm: 'Z001', fechaIso: '2026-10-10T18:00:00Z', cuenta: { id: 'act_1', nombre: 'Estudio X', monedaHora: 'ARS' }, cuentaAviso: null,
  rama: { nombre: 'Accidentes de tránsito', texto: '', subramas: [] }, avatar: { incluye: [], excluye: [] }, zona: { lugares: ['Lugar'], descripcion: 'Lugar', radioKm: 10, pais: 'AR' },
  presupuesto: { texto: 'USD 300 por mes', aConfirmar: false }, lanzamiento: { fecha: null, texto: '' }, whatsapp: null, frenos: [], ojos: [], link: null, fathom: null, ...o })
const pl = (o = {}) => ({ cliente: 'Juana Perez', idCrm: 'Z001', acceso: 'si', cuentas: [], kickoff: ficha(), sinFicha: false, editados: { cantidad: 1, url: 'https://drive.google.com/drive/folders/CARPETA0001', ultimo: null, carpeta: 'Juana Perez' }, ...o })
function deps(o = {}) {
  const log = { reclamos: [], enviados: [], armados: [], procesadas: [], creada: null }
  const reclamadas = new Set(o.yaReclamadas ?? [])
  return { log, d: {
    leerDoc: async () => DOC,
    archivo: async id => (o.ilegibles ?? []).includes(id) ? null : { nombre: `Juana ${id.slice(-1)}.mp4`, md5: `md5-${id}`, video: true, publico: !(o.privados ?? []).includes(id) },
    editados: async () => o.editados ?? [{ id: 'EDITADO000001', nombre: 'Juana 1.mp4', md5: `md5-${ID(1)}`, guionesDoc: null }],
    gruposExtra: async s => s.videos.map(v => ({ videos: [{ nombre: v.nombre, drive: v.id }], textos: [], titulos: [], guiones: [] })),
    variacion: async cs => ({ textos: ['amplio'], titulos: ['T1', 'T2'] }),
    campanas: async () => o.campanas ?? [],
    lineaBase: async () => ('base' in o ? o.base : VACIA()),
    crearLineaBase: async f => { log.creada = f },
    marcarProcesado: async f => { log.procesadas.push(...f) },
    permitido: () => o.permitido ?? true,
    armar: async (s, p, grupos, op) => { log.armados.push({ s, grupos, op }); return { borrador: { campana: 'C', campanaId: '1', nueva: true, conjuntos: [{ id: '2', nombre: 'S', anuncios: ['3', '4'] }], diarioLocal: 1, diarioUSD: 10, link: 'https://x', faltan: [], conjuntoId: '2', conjunto: 'S', anuncios: ['3', '4'] }, pedidos: op.seco ? [] : null } },
    reclamar: async clave => { log.reclamos.push(clave); if (reclamadas.has(clave)) return false; reclamadas.add(clave); return true },
    marcarEnviado: async () => {}, marcarDudoso: async () => {}, soltar: async clave => { reclamadas.delete(clave) },
    enviar: async texto => { log.enviados.push(texto); return 'm1' },
    valentino: '111', tomas: '222', ahora: () => Date.parse('2026-11-03T12:00:00Z'),
  } }
}
const tab = (o = {}) => ({ filas: [], porLanzar: [pl(o)], porLanzarEsperando: [] })

describe('lanzarDesdeDoc', () => {
  test('LISTO → arma en pausa con los videos del Doc (el editado con el mismo md5 no se suma) y avisa a Valen', async () => {
    const { d, log } = deps()
    const r = await L.lanzarDesdeDoc(tab(), d)
    const c = r.clientes.find(x => x.cliente === 'Juana Perez')
    assert.equal(c.accion, 'armado')
    assert.deepEqual(c.videos.map(v => v.drive), [ID(1), ID(2)])
    assert.equal(log.armados.length, 1)
    const g = log.armados[0].grupos[0]
    assert.equal(g.copyPorVideo[ID(1)], COPY(1))
    assert.deepEqual([g.textos, g.titulos], [['amplio'], ['T1', 'T2']])
    assert.equal(log.enviados.length, 1)
    assert.match(log.enviados[0], /<@111>.*Para lanzar desde el Doc de ADS/)
    assert.match(log.enviados[0], /EN PAUSA/)
  })
  test('no duplica: la segunda corrida no arma ni avisa', async () => {
    const { d, log } = deps()
    await L.lanzarDesdeDoc(tab(), d)
    const r2 = await L.lanzarDesdeDoc(tab(), d)
    assert.equal(r2.clientes[0].accion, 'ya_salio')
    assert.equal(log.armados.length, 1)
  })
  test('si la cuenta ya tiene una campaña reciente, no arma: solo avisa los videos nuevos (una vez)', async () => {
    const { d, log } = deps({ campanas: [{ nombre: 'Accidentes | DM-WPP', creada: '2026-11-01T10:00:00Z' }] })
    const r = await L.lanzarDesdeDoc(tab(), d)
    assert.equal(r.clientes[0].accion, 'videos_nuevos')
    assert.equal(log.armados.length, 0)
    await L.lanzarDesdeDoc(tab(), d)
    assert.equal(log.enviados.length, 1)
  })
  test('sin cuenta en la ficha: avisa UNA vez (menciona a Tomás) y no arma', async () => {
    const { d, log } = deps()
    const t = tab({ kickoff: ficha({ cuenta: null }) })
    const r = await L.lanzarDesdeDoc(t, d)
    assert.equal(r.clientes[0].accion, 'falta_cuenta')
    await L.lanzarDesdeDoc(t, d)
    assert.equal(log.enviados.length, 1)
    assert.match(log.enviados[0], /<@222>/)
    assert.equal(log.armados.length, 0)
  })
  test('en seco: arma sin reclamar ni mandar nada', async () => {
    const { d, log } = deps()
    const r = await L.lanzarDesdeDoc(tab(), d, { seco: true })
    assert.equal(r.clientes[0].accion, 'seco')
    assert.equal(log.armados[0].op.seco, true)
    assert.equal(log.reclamos.length + log.enviados.length, 0)
  })
  test('vista previa (dry): solo el plan', async () => {
    const { d, log } = deps()
    const r = await L.lanzarDesdeDoc(tab(), d, { dry: true })
    assert.equal(r.clientes[0].accion, 'plan')
    assert.equal(log.armados.length + log.reclamos.length + log.enviados.length, 0)
  })
  test('videos que la cuenta de servicio no puede leer: se avisan', async () => {
    const { d } = deps({ ilegibles: [ID(2)] })
    const r = await L.lanzarDesdeDoc(tab(), d)
    assert.deepEqual(r.clientes[0].noLegibles, ['video 2'])
    assert.match(r.clientes[0].texto, /no puedo leer video 2/i)
  })
  test('video que la cuenta de servicio lee pero no es público (Meta no lo puede bajar): no se usa y se avisa', async () => {
    const { d, log } = deps({ privados: [ID(2)] })
    const r = await L.lanzarDesdeDoc(tab(), d)
    assert.deepEqual(r.clientes[0].noLegibles, ['video 2'])
    assert.ok(!r.clientes[0].videos.some(v => v.drive === ID(2)))
    assert.ok(log.armados.every(a => !JSON.stringify(a).includes(ID(2))))
  })
  test('un cliente con nota distinta de LISTO no arma; y g01 sabe a quién cubre el Doc', async () => {
    const { d, log } = deps()
    const t = { filas: [], porLanzar: [pl(), pl({ cliente: 'Marta Gomez', idCrm: 'Z002' })], porLanzarEsperando: [] }
    const r = await L.lanzarDesdeDoc(t, d)
    const marta = r.clientes.find(c => c.cliente === 'Marta Gomez')
    assert.equal(marta.accion, 'solo_estado')
    assert.match(marta.doc, /Hacer la campaña/)
    assert.equal(log.armados.length, 1)
    assert.deepEqual([...L.cubiertosPorDoc(r)], ['Juana Perez'])
  })
  test('sin línea de base: la crea (todo histórico) y no arma ni avisa nada', async () => {
    const { d, log } = deps({ base: null })
    const r = await L.lanzarDesdeDoc(tab(), d)
    assert.equal(r.lineaBase, 'creada')
    assert.ok(log.creada.length > 0 && log.creada.every(f => f.estado === 'base'))
    assert.equal(r.clientes[0].accion, 'historico')
    assert.equal(log.armados.length + log.enviados.length + log.reclamos.length, 0)
    assert.deepEqual([...L.cubiertosPorDoc(r)], ['Juana Perez'])   // g01 tampoco le arma desde Editados
  })
  test('sin línea de base en seco/vista previa: no crea nada ni procesa', async () => {
    const { d, log } = deps({ base: null })
    const r = await L.lanzarDesdeDoc(tab(), d, { seco: true })
    assert.equal(r.lineaBase, 'sin')
    assert.equal(log.creada, null)
    assert.equal(log.armados.length, 0)
  })
  test('con la línea de base del Doc de hoy: lo que ya estaba es histórico, nada se arma', async () => {
    const { d, log } = deps({ base: LB.lineaBaseDe(LB.filasLineaBase(D.parsearDocAds(DOC))) })
    const t = { filas: [], porLanzar: [pl(), pl({ cliente: 'Pedro Ruiz', idCrm: 'Z003' })], porLanzarEsperando: [] }
    const r = await L.lanzarDesdeDoc(t, d, { seco: true })
    assert.deepEqual(r.clientes.map(c => c.accion), ['historico', 'historico'])
    assert.equal(log.armados.length, 0)
  })
  test('pendiente (excepción explícita): se arma aunque estuviera en la línea de base, y queda procesado', async () => {
    const filas = LB.filasLineaBase(D.parsearDocAds(DOC), b => b.nombre === 'Juana Perezz')
    const { d, log } = deps({ base: LB.lineaBaseDe(filas) })
    const r = await L.lanzarDesdeDoc(tab(), d)
    assert.equal(r.clientes[0].accion, 'armado')
    assert.equal(r.clientes[0].nuevo, 'pendiente')
    assert.ok(log.procesadas.some(f => f.huella === `v:${ID(1)}` && f.estado === 'procesado'))
    const base2 = LB.lineaBaseDe([...filas.filter(f => !log.procesadas.some(p => p.huella === f.huella)), ...log.procesadas])
    assert.ok(LB.novedad(D.parsearDocAds(DOC)[0], base2).historico)
  })
  test('un bloque viejo renombrado (mismos videos) sigue siendo histórico', () => {
    const base = LB.lineaBaseDe(LB.filasLineaBase(D.parsearDocAds(DOC)))
    const ren = D.parsearDocAds(DOC.replace('Juana Perezz - LISTO', 'Juana Pérez Gómez - LISTO'))[0]
    assert.ok(LB.novedad(ren, base).historico)
  })
  test('un bloque que pasa a LISTO cuenta como nuevo', () => {
    const viejo = DOC.replace('Juana Perezz - LISTO', 'Juana Perezz - Revisión').replace(/\nJuana Perezz - LISTO[\s\S]*$/, '')
    const base = LB.lineaBaseDe(LB.filasLineaBase(D.parsearDocAds(viejo)))
    const n = LB.novedad(D.parsearDocAds(DOC)[0], base)
    assert.deepEqual([n.bloqueNuevo, n.motivo, n.videosNuevos.length], [true, 'paso_a_listo', 2])
  })
  test('un video nuevo de un cliente con campaña corriendo: solo aviso a Valen, sin armar', async () => {
    const viejo = DOC.replace(/video 2:https:\/\/drive\.google\.com\/file\/d\/[^\n]+\n[^\n]+\n[^\n]+\n[^\n]+\n/, '')
    const base = LB.lineaBaseDe(LB.filasLineaBase(D.parsearDocAds(viejo)))
    const { d, log } = deps({ base })
    const fila = { cliente: 'Juana Perez', clienteCRM: 'Juana Perez', idCrm: 'Z001', id: 'act_1' }
    const r = await L.lanzarDesdeDoc({ filas: [fila], porLanzar: [], porLanzarEsperando: [] }, d)
    assert.equal(r.clientes[0].accion, 'videos_nuevos')
    assert.equal(log.armados.length, 0)
    assert.equal(log.enviados.length, 1)
    assert.match(log.enviados[0], /<@111>.*Videos nuevos en el Doc de ADS.*1 video nuevo para sumar\/rotar/)
    assert.ok(log.procesadas.some(f => f.huella === `v:${ID(2)}`))
  })
  test('por lanzar con una campaña pausada de hace 100 días (≤ 120): no arma, avisa videos nuevos', async () => {
    const { d, log } = deps({ campanas: [{ nombre: 'Vieja', creada: '2026-07-26T10:00:00Z', activa: false }] })
    const r = await L.lanzarDesdeDoc(tab(), d)
    assert.equal(r.clientes[0].accion, 'videos_nuevos')
    assert.equal(log.armados.length, 0)
    assert.equal(log.enviados.length, 1)
  })
  test('resumirSeco lee los POST anotados', () => {
    const pedidos = [
      { ruta: 'act_1/campaigns', cuerpo: { name: 'Rama | DM-WPP' } },
      { ruta: 'act_1/adsets', cuerpo: { name: 'Broad | Lugar', daily_budget: '1500000', targeting: { geo_locations: { cities: [{ key: '1', radius: 10 }] } } } },
      { ruta: 'act_1/adcreatives', cuerpo: { name: 'v1', object_story_spec: { video_data: { message: 'copy' } }, asset_feed_spec: { bodies: [{ text: 'copy' }, { text: 'amplio' }], titles: [{ text: 'T1' }] } } },
      { ruta: 'act_1/ads', cuerpo: { name: '1- copy' } },
    ]
    const s = L.resumirSeco(pedidos, { faltan: ['x'], motivo: 'm' }, 'ARS')
    assert.equal(s.campana, 'Rama | DM-WPP')
    assert.match(s.conjuntos[0].zona, /1 ciudad\(es\) a 10 km/)
    assert.deepEqual(s.anuncios[0].textos, ['copy', 'amplio'])
  })
})
