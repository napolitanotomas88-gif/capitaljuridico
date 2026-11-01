// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-anuncios-videos.mjs
// g01: videos nuevos en «Editados - X» → aviso a Valentino (lib/bot/anuncios/videos.ts). Sin red: deps falsas.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const V = await import('../lib/bot/anuncios/videos.ts')

const H = 3_600_000
const AHORA = Date.parse('2026-10-28T12:00:00Z')
const iso = ms => new Date(ms).toISOString()
const vid = (id, horasAtras) => ({ id, nombre: `${id}.mp4`, creado: iso(AHORA - horasAtras * H) })
const DESDE = '2026-10-26T03:00:00.000Z'
const oliva = (videos, raiz = []) => ({ carpetaCliente: 'Carlos Oliva - SKWD', editadosId: 'ED', tandas: [{ id: 'ED', nombre: 'Editados - CarlosO', videos: raiz }, { id: 'T2', nombre: '2° Tanda', videos }].filter(t => t.videos.length) })
const fila = (o = {}) => ({
  cliente: 'Carlos Oliva', cuenta: 'act_1', pausado: false, usdPor: 1000, gasto: { d7: 50000 }, cpl: { d7: 1270 },
  rama: { id: 'laboral', umbral: { ok: 1.5, medio: 2 } }, presupuesto: { mensualUSD: 250, ajusteDiarioUSD: 11.27, realDiarioUSD: 8 }, ...o,
})

describe('subidasNuevas', () => {
  test('una tanda terminada sale una vez con todos sus videos; la clave guarda el último', () => {
    const s = V.subidasNuevas([oliva([vid('a', 30), vid('b', 20), vid('c', 14)])], new Map(), AHORA, DESDE)
    assert.equal(s.length, 1)
    assert.deepEqual(s[0].videos.map(v => v.id), ['a', 'b', 'c'])
    assert.equal(s[0].numero, 2)
    assert.equal(s[0].clave, `videos:T2:${iso(AHORA - 14 * H)}`)
    assert.equal(V.hastaDeClave(s[0].clave), iso(AHORA - 14 * H))
  })
  test('si René sigue subiendo (último hace menos de CIERRE_HORAS) espera', () => {
    assert.equal(V.subidasNuevas([oliva([vid('a', 30), vid('b', 2)])], new Map(), AHORA, DESDE).length, 0)
  })
  test('lo ya avisado no vuelve; lo que cae después en la misma carpeta sale solo', () => {
    const ya = new Map([['T2', iso(AHORA - 20 * H)]])
    assert.equal(V.subidasNuevas([oliva([vid('a', 30), vid('b', 20)])], ya, AHORA, DESDE).length, 0)
    const s = V.subidasNuevas([oliva([vid('a', 30), vid('b', 20), vid('c', 13)])], ya, AHORA, DESDE)
    assert.deepEqual(s[0].videos.map(v => v.id), ['c'])
  })
  test('nada antes de la fecha de corte ni de más de DIAS_VENTANA', () => {
    assert.equal(V.subidasNuevas([oliva([vid('a', 24 * 5)])], new Map(), AHORA, DESDE).length, 0)   // 23/10: antes del corte
    assert.equal(V.subidasNuevas([oliva([vid('a', 24 * 20)])], new Map(), AHORA, '2026-01-01').length, 0)
  })
  test('los sueltos en la raíz de Editados son otra tanda', () => {
    const s = V.subidasNuevas([oliva([], [vid('x', 15)])], new Map(), AHORA, DESDE)
    assert.equal(s[0].tanda, 'sin carpeta de tanda')
    assert.equal(s[0].numero, null)
  })
})

describe('numeroTanda y cruzarCliente', () => {
  test('nombres de carpeta reales', () => {
    assert.equal(V.numeroTanda('2° Tanda'), 2)
    assert.equal(V.numeroTanda('1° tanda'), 1)
    assert.equal(V.numeroTanda('Tanda 3'), 3)
    assert.equal(V.numeroTanda('Renovación'), null)
  })
  test('cruza por palabras; empate o nada = null', () => {
    const xs = [{ cliente: 'Carlos Oliva' }, { cliente: 'Laura Guzman' }]
    assert.equal(V.cruzarCliente('Carlos Oliva - SKWD', xs)?.cliente, 'Carlos Oliva')
    assert.equal(V.cruzarCliente('Laura Guzman - C.J', xs)?.cliente, 'Laura Guzman')
    assert.equal(V.cruzarCliente('Enzo - SKWD', xs), null)
    assert.equal(V.cruzarCliente('Julio Herrera - SKWD', [{ cliente: 'Julio Herrera' }, { cliente: 'Julio Cordero' }])?.cliente, 'Julio Herrera')
    assert.equal(V.cruzarCliente('Julio - SKWD', [{ cliente: 'Julio Herrera' }, { cliente: 'Julio Cordero' }]), null)
    assert.equal(V.cruzarCliente('Lucas Tapia - C.J', [{ cliente: 'Lucas Agustín Quiroga' }, { cliente: 'Lucas Tapia' }])?.cliente, 'Lucas Tapia')
  })
  test('cruce de una sola palabra de varias → hay que confirmarlo', () => {
    assert.equal(V.cruceParcial('Bautista & Guido - SKWD', 'Bautista Escudero'), true)
    assert.equal(V.cruceParcial('Carlos Oliva - SKWD', 'Carlos Oliva'), false)
    assert.equal(V.cruceParcial('Enzo - SKWD', 'Enzo Pérez'), false)
  })
  test('el orquestador busca en corriendo y por lanzar juntos', async () => {
    const r = await V.avisarVideosNuevos({ filas: [fila({ cliente: 'Carlos Pérez' })], porLanzar: [{ cliente: 'Carlos Oliva', kickoff: null, acceso: 'si' }] },
      { editados: async () => [oliva([vid('a', 14)])], avisadoHasta: async () => new Map(), valentino: null, ahora: () => AHORA }, { dry: true, desde: DESDE })
    assert.match(r.avisos[0].texto, /🚀 \*\*Lanzamiento/)
    assert.equal(r.avisos[0].cliente, 'Carlos Oliva')
  })
})

describe('textoVideos (formato aprobado con Carlos Oliva)', () => {
  const s = V.subidasNuevas([oliva([vid('a', 30), vid('b', 20), vid('c', 14)])], new Map(), AHORA, DESDE)[0]
  test('rotación: CPL, links, conjunto con los 3 juntos y el diario que cierra el mes', () => {
    const t = V.textoVideos(s, fila(), null, '366', AHORA)
    assert.match(t, /^<@366> 📦 \*\*Videos nuevos para cargar\*\* · Carlos Oliva \(tanda 2 · 3 videos/)
    assert.match(t, /Rotación, no lanzamiento/)
    assert.match(t, /USD 1,27 por mensaje en 7 días \(Laboral: normal hasta USD 1,5\)/)
    assert.match(t, /drive\.google\.com\/file\/d\/a\/view/)
    // 3:2:2: 3 videos = 1 anuncio flexible → un solo conjunto
    assert.match(t, /1 conjunto nuevo .*1 anuncio flexible con los 3 videos, a USD 3\/día/)
    assert.match(t, /📐 Un solo anuncio: un solo conjunto/)
    assert.match(t, /🧩 \*\*3:2:2:\*\* cada anuncio con 3 videos \+ 2 textos/)
    // 6 videos = 2 anuncios: 2 × 3,5 × 4 = 28, el 11 % de 250 → uno por anuncio; con 100/mes (28 %) van juntos
    const seis = { ...s, videos: [1, 2, 3, 4, 5, 6].map(i => ({ id: `v${i}`, nombre: `Carlos Oliva ${i}.mp4`, creado: s.videos[0].creado })) }
    assert.match(V.textoVideos(seis, fila(), null, null, AHORA), /2 conjuntos nuevos, uno por anuncio .*a USD 3,5\/día cada uno/)
    assert.match(V.textoVideos(seis, fila({ presupuesto: { mensualUSD: 100, ajusteDiarioUSD: 11.27, realDiarioUSD: 8 } }), null, null, AHORA), /1 conjunto nuevo .*2 anuncios flexibles de hasta 3 videos/)
    assert.doesNotMatch(t, /⚠️/)
  })
  test('sin presupuesto: diario mínimo y alerta', () => {
    const t = V.textoVideos(s, fila({ presupuesto: { mensualUSD: null, ajusteDiarioUSD: null, realDiarioUSD: 8 } }), null, null, AHORA)
    assert.match(t, /USD 3\/día/)
    assert.match(t, /⚠️ Sin presupuesto mensual cargado: va todo junto/)
  })
  test('lanzamiento con y sin ficha; cliente que no está en el tablero', () => {
    const k = {
      cuenta: { id: 'act_123', nombre: 'Estudio Oliva', monedaHora: 'ARS · Buenos Aires' }, cuentaAviso: null,
      rama: { nombre: 'Laboral', texto: 'Despidos', subramas: ['trabajo en negro'] }, avatar: { incluye: ['despedidos'], excluye: ['empleados públicos'] },
      zona: { lugares: ['Lomas de Zamora', 'Banfield'], descripcion: '', radioKm: 10, presentarse: null, mapa: { estado: 'revisar', texto: '', momento: null } },
      presupuesto: { texto: 'USD 300/mes', aConfirmar: true }, lanzamiento: { fecha: '30/10', texto: 'Lanzamiento: apenas estén los videos' },
      whatsapp: '+54 9 11 5555-5555', frenos: [{ nombre: 'Tarjeta', detalle: 'no cargó la tarjeta', frena: true }, { nombre: 'Píxel', detalle: '', frena: false }],
      ojos: [], link: 'https://despacho/ficha', fathom: 'https://fathom.video/x',
    }
    const t = V.textoVideos(s, null, { cliente: 'Carlos Oliva', kickoff: k, acceso: 'si' }, '366', AHORA)
    assert.match(t, /^<@366> 🚀 \*\*Para lanzar\*\* · Carlos Oliva \(tanda 2 · 3 videos/)
    for (const re of [/🏦 \*\*Cuenta:\*\* `act_123` \(«Estudio Oliva»\) · ARS · Buenos Aires/, /⚖️ \*\*Rama:\*\* Laboral — Despidos — subramas: trabajo en negro/,
      /👤 .*despedidos · ✋ afuera: empleados públicos/, /📍 \*\*Zona:\*\* Lomas de Zamora · Banfield · radio 10 km \(⚠️ el mapa/, /💵 \*\*Presupuesto:\*\* USD 300\/mes \(a confirmar\)/,
      /📅 \*\*Lanzamiento:\*\* 30\/10 · apenas estén los videos/, /📲 .*\+54 9 11 5555-5555/, /🧾 \*\*Portfolio:\*\* ⛔ Tarjeta: no cargó la tarjeta · para tildar: Píxel/,
      /\[Ficha\]\(<https:\/\/despacho\/ficha>\) · \[Kickoff en Fathom\]/]) assert.match(t, re)
    assert.doesNotMatch(t, /⚠️ Sin ficha/)
    assert.match(V.textoVideos(s, null, { cliente: 'Carlos Oliva', kickoff: null, acceso: 'no' }, null, AHORA), /⚠️ Sin ficha de kickoff[\s\S]*token no ve/)
    assert.match(V.textoVideos(s, null, null, null, AHORA), /⚠️ No encontré a este cliente/)
  })
})

describe('Por lanzar solo con editados (lib/anuncios/editadosPorLanzar.ts)', () => {
  const carpetas = [
    { nombre: 'Carlos Oliva', editados: { cantidad: 3, ultimo: '2026-10-24', url: 'u1' } },
    { nombre: 'Laura Guzman', editados: { cantidad: 0, ultimo: null, url: 'u2' } },
    { nombre: 'Julio Herrera', editados: { cantidad: 5, ultimo: null, url: 'u3' } }, { nombre: 'Julio Cordero', editados: { cantidad: 4, ultimo: null, url: 'u4' } },
  ]
  test('con editados se muestra con su carpeta; vacía no; sin carpeta o empate, se muestra igual', async () => {
    const E = await import('../lib/anuncios/editadosPorLanzar.ts')
    const r = E.filtrarConEditados([{ cliente: 'Carlos Alberto Oliva' }, { cliente: 'María Laura Guzman Aguirre' }, { cliente: 'Enzo Pérez' }, { cliente: 'Julio César' }], carpetas, true)
    assert.deepEqual(r.porLanzar.map(p => [p.cliente, p.editados?.cantidad ?? null]), [['Carlos Alberto Oliva', 3], ['Enzo Pérez', null], ['Julio César', null]])
    assert.deepEqual(r.sinEditados, ['María Laura Guzman Aguirre'])
  })
  test('sin Drive no filtra a nadie', async () => {
    const E = await import('../lib/anuncios/editadosPorLanzar.ts')
    const r = E.filtrarConEditados([{ cliente: 'María Laura Guzman Aguirre' }], carpetas, false)
    assert.equal(r.porLanzar.length, 1); assert.equal(r.sinEditados.length, 0)
  })
})

describe('avisarVideosNuevos', () => {
  const base = (o = {}) => {
    const log = []
    return { log, deps: {
      editados: async () => [oliva([vid('a', 30), vid('b', 14)])], avisadoHasta: async () => new Map(),
      reclamar: async c => { log.push(['reclamar', c]); return true }, marcarEnviado: async (c, id) => log.push(['enviado', c, id]),
      marcarDudoso: async c => log.push(['dudoso', c]), soltar: async c => log.push(['soltar', c]),
      enviar: async () => 'm1', valentino: '366', ahora: () => AHORA, ...o,
    } }
  }
  const t = { filas: [fila()], porLanzar: [] }
  test('reclama, manda y anota; en seco no toca nada', async () => {
    const a = base()
    const r = await V.avisarVideosNuevos(t, a.deps, { desde: DESDE })
    assert.equal(r.avisos[0].estado, 'enviado')
    assert.deepEqual(a.log.map(x => x[0]), ['reclamar', 'enviado'])
    const b = base({ reclamar: async () => { throw new Error('PROHIBIDO') }, enviar: async () => { throw new Error('PROHIBIDO') } })
    assert.equal((await V.avisarVideosNuevos(t, b.deps, { dry: true, desde: DESDE })).avisos[0].estado, 'dry')
  })
  test('ya reclamado → ya_salio; Discord rechaza → soltar; timeout → dudoso', async () => {
    assert.equal((await V.avisarVideosNuevos(t, base({ reclamar: async () => false }).deps, { desde: DESDE })).avisos[0].estado, 'ya_salio')
    const r1 = base({ enviar: async () => { throw Object.assign(new Error('404'), { transitorio: false }) } })
    assert.equal((await V.avisarVideosNuevos(t, r1.deps, { desde: DESDE })).avisos[0].estado, 'rechazado')
    assert.equal(r1.log.at(-1)[0], 'soltar')
    const r2 = base({ enviar: async () => { throw Object.assign(new Error('timeout'), { transitorio: true }) } })
    assert.equal((await V.avisarVideosNuevos(t, r2.deps, { desde: DESDE })).avisos[0].estado, 'dudoso')
    assert.equal(r2.log.at(-1)[0], 'dudoso')
  })
  test('Drive o la base caídos: no manda nada y lo dice', async () => {
    const r = await V.avisarVideosNuevos(t, base({ editados: async () => { throw new Error('403') } }).deps, { desde: DESDE })
    assert.equal(r.avisos.length, 0); assert.match(r.errores[0], /^drive/)
    const r2 = await V.avisarVideosNuevos(t, base({ avisadoHasta: async () => { throw new Error('caída') } }).deps, { desde: DESDE })
    assert.equal(r2.avisos.length, 0); assert.match(r2.errores[0], /^base/)
  })
  test('si Meta pudo escribir, un fallo de Discord conserva la reserva y no vuelve a armar en la próxima corrida', async () => {
    for (const error of [Object.assign(new Error('404'), { transitorio: false }), new Error('429')]) {
      let reservado = false, armados = 0
      const a = base({
        reclamar: async () => { if (reservado) return false; reservado = true; return true },
        soltar: async () => { reservado = false },
        borrador: { permitido: () => true, armar: async () => { armados++; throw new Error('Meta creó un conjunto y falló después') } },
        enviar: async () => { throw error },
      })
      const r = await V.avisarVideosNuevos(t, a.deps, { desde: DESDE })
      assert.equal(r.avisos[0].estado, 'dudoso')
      assert.equal(a.log.at(-1)[0], 'dudoso')
      assert.equal((await V.avisarVideosNuevos(t, a.deps, { desde: DESDE })).avisos[0].estado, 'ya_salio')
      assert.equal(armados, 1)
    }
  })
  test('sin tiempo antes del tope: no reclama', async () => {
    const a = base()
    const r = await V.avisarVideosNuevos(t, a.deps, { desde: DESDE, deadline: AHORA + 1000 })
    assert.equal(r.avisos[0].estado, 'sin_tiempo'); assert.equal(a.log.length, 0)
  })
})
