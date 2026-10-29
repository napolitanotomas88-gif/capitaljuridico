// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-mapa.mjs
// Zona desde el video (lib/bot/kickoff/mapa.ts y app/api/bot/kickoff/mapa/route.ts). SIN red (fetch falso con respuestas
// con la forma de la doc de Fathom: RecordingDownload), SIN ffmpeg real (spawn falso que devuelve un "JPEG" armado), SIN
// Claude (llamada falsa) y SIN base. Reloj falso para el sondeo. Las keys, ids y urls de acá son inventadas.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

// Antes de importar nada: entorno limpio (que ninguna variable real del shell active una llamada de verdad)
for (const k of Object.keys(process.env)) {
  if (/^FATHOM_/.test(k) || ['FFMPEG_PATH', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'KICKOFF_ESFUERZO', 'KICKOFF_MODELO', 'DATABASE_URL', 'CRON_SECRET'].includes(k)) delete process.env[k]
}
const RED_BLOQUEADA = async () => { throw new Error('red bloqueada en los tests') }
globalThis.fetch = RED_BLOQUEADA

const M = await import('../lib/bot/kickoff/mapa.ts')
const { ErrorFathomApi } = await import('../lib/bot/kickoff/fathomApi.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')

const KEY = 'fk-test-0123456789abcdef'
const ID = 777000111
const URL_VIDEO = 'https://media.fathom.ai/downloads/abc123?firma=SECRETA-xyz'
const FFMPEG = '/falso/bin/ffmpeg'
const ENV = { FATHOM_API_KEY_TOMAS: KEY, FFMPEG_PATH: FFMPEG, PATH: '' }
const esEjecutable = p => p === FFMPEG

// ── Reloj falso: esperar() adelanta el tiempo ──
function reloj(inicio = 1_000_000) {
  const r = { t: inicio, esperas: [] }
  r.ahora = () => r.t
  r.esperar = async ms => { r.esperas.push(ms); r.t += ms }
  return r
}

// ── fetch falso: una lista de respuestas en orden (o una función), anota cada pedido ──
const descarga = (status, extra = {}) => ({ download_id: 'dl_PRUEBA123', recording_id: ID, status, ...extra })
const conVideo = (extra = {}) => descarga('completed', { video: { url: URL_VIDEO, content_type: 'video/mp4', file_size_bytes: 154763264, expires_at: '2026-10-25T18:30:00Z' }, ...extra })
const resp = (status, cuerpo, headers = {}) => () => new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json', ...headers } })
function fetchFalso(respuestas) {
  const pedidos = []
  const f = async (url, init = {}) => {
    pedidos.push({ url, metodo: init.method ?? 'GET', key: init.headers?.['X-Api-Key'] ?? null, body: init.body ?? null })
    const r = typeof respuestas === 'function' ? respuestas(url, init, pedidos.length) : respuestas[pedidos.length - 1]
    if (!r) throw new Error(`pedido de más: ${init.method} ${url}`)
    return r()
  }
  f.pedidos = pedidos
  return f
}

// ── spawn falso: cada proceso emite su salida en el próximo tick; guarda los procesos y con qué señal se mataron ──
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3_000, 7)])
function spawnFalso(comportamiento = () => ({ jpg: JPEG, code: 0 })) {
  const llamadas = [], procesos = []
  const s = (cmd, args) => {
    llamadas.push({ cmd, args })
    const p = new EventEmitter()
    p.stdout = new EventEmitter()
    p.stderr = new EventEmitter()
    p.matado = false
    p.senal = null
    p.kill = senal => { p.matado = true; p.senal = senal ?? 'SIGTERM'; setImmediate(() => p.emit('close', null)); return true }
    const seg = Number(args[args.indexOf('-ss') + 1])
    const c = comportamiento(seg, args)
    if (c.lanzar) throw new Error(c.lanzar)
    procesos.push(p)
    setImmediate(() => {
      if (c.colgado) return
      if (c.errorSpawn) { p.emit('error', Object.assign(new Error(c.errorSpawn), { code: 'ENOENT' })); return }
      if (c.jpg) p.stdout.emit('data', c.jpg)
      if (c.stderr) p.stderr.emit('data', Buffer.from(c.stderr))
      p.emit('close', c.code ?? 0)
    })
    return p
  }
  s.llamadas = llamadas
  s.procesos = procesos
  return s
}

// ── Claude falso ──
const MAPA_OK = {
  hay_mapa: true, tipo: 'google_maps',
  lugares: [
    { nombre: 'Villa Krause', posicion: 'dentro' }, { nombre: 'Rawson', posicion: 'dentro' }, { nombre: 'Pocito', posicion: 'borde' },
    { nombre: 'Médano de Oro', posicion: 'dentro' }, { nombre: 'Caucete', posicion: 'borde' }, { nombre: 'Chimbas', posicion: 'fuera' },
  ],
  marca: 'poligono', marca_detalle: 'polígono azul semitransparente', radio_km: '', radio_estimado_km: '', radio_como: '',
  limites: 'de Pocito al oeste hasta Caucete al este', excluidas: [], mejor_cuadro: 3, legible: 'si', notas: '',
}
function claudeFalso(json = MAPA_OK, usage = { input_tokens: 9_000, output_tokens: 1_200 }) {
  const llamadas = []
  const c = async p => { llamadas.push(p); if (typeof json === 'function') return json(p); return { json, modelo: 'claude-opus-5-5', usage } }
  c.llamadas = llamadas
  return c
}

// La zona dicha de la kickoff de prueba (Laura): con su timestamp y el segundo estimado de la cita
const FICHA = {
  fecha: '2026-10-23T12:00:00Z', fin_grabacion: '2026-10-23T12:22:30Z',
  zona: {
    descripcion: 'Tres Esquinas, Pedernal, hasta Caucete y El Bordón', lugares: ['Tres Esquinas', 'Pedernal', 'Caucete', 'El Bordón (de oído, verificar)'],
    radio_km: null, mapa_en_pantalla: true, timestamp: '00:16:00', aprox: '00:17:18', cita: 'sería tres esquinas…', textual: true, pais: 'AR',
  },
}
const depsBase = (extra = {}) => {
  const r = reloj()
  return { env: ENV, esEjecutable, ahora: r.ahora, esperar: r.esperar, reloj: r, ...extra }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('momentosMapa', () => {
  test('con la ficha: alrededor del segundo estimado de la cita (hasta 3 min después), más el comienzo del renglón', () => {
    assert.deepEqual(M.momentosMapa(FICHA), [965, 1028, 1038, 1053, 1073, 1098, 1158, 1218])
    assert.equal(M.momentosMapa(FICHA).length, M.MAX_CUADROS)
  })
  test('directo: 45 s en un video de 90 → acotado al final', () => {
    assert.deepEqual(M.momentosMapa({ timestampZona: 45, duracion: 90 }), [35, 45, 60, 80, 89])
  })
  test('cerca del principio no baja de 0 y cerca del final no repite', () => {
    assert.deepEqual(M.momentosMapa({ timestampZona: 5, duracion: null }), [0, 5, 20, 40, 65, 125, 185])
    const fin = M.momentosMapa({ timestampZona: 85, duracion: 90 })
    assert.deepEqual(fin, [75, 85, 89])
    assert.ok(fin.every(s => s >= 0 && s <= 89))
  })
  test('HH:MM:SS, y sin timestamp o fuera de la grabación → null', () => {
    assert.deepEqual(M.momentosMapa({ timestampZona: '00:01:00', duracion: 600 }), [50, 60, 75, 95, 120, 180, 240])
    assert.equal(M.momentosMapa({ timestampZona: null, duracion: 600 }), null)
    assert.equal(M.momentosMapa({ timestampZona: '1:00', duracion: 600 }), null)
    assert.equal(M.momentosMapa({ timestampZona: '00:30:00', duracion: 600 }), null)
    assert.equal(M.momentosMapa({ zona: { timestamp: null, aprox: null, lugares: [], radio_km: null } }), null)
  })
  test('sin aprox usa el timestamp y nunca más de MAX_CUADROS', () => {
    const m = M.momentosMapa({ ...FICHA, zona: { ...FICHA.zona, aprox: null } })
    assert.deepEqual(m, [950, 960, 975, 995, 1020, 1080, 1140])
    assert.ok(M.momentosMapa(FICHA).length <= M.MAX_CUADROS)
  })
  test('duracionDeFicha', () => {
    assert.equal(M.duracionDeFicha(FICHA), 1350)
    assert.equal(M.duracionDeFicha({ fecha: null, fin_grabacion: null }), null)
    assert.equal(M.duracionDeFicha({ fecha: '2026-10-23T12:30:00Z', fin_grabacion: '2026-10-23T12:00:00Z' }), null)
  })
  test('fichaConMomento: sin duracion_s usa la duración de la ficha guardada; después del final → null', () => {
    const corta = { ...FICHA, fin_grabacion: '2026-10-23T12:25:00Z' }                    // 25 min
    assert.equal(M.fichaConMomento(corta, '01:30:00', { duracion: null, lugares: [], radio_km: null }), null)
    const r = M.fichaConMomento(corta, '00:24:30', { duracion: null, lugares: ['ignorado'], radio_km: 3 })
    assert.deepEqual(r.segundos, [1460, 1470, 1485, 1499])
    assert.equal(r.duracion, 1500)
    assert.equal(r.ficha.fecha, corta.fecha)
    assert.equal(r.ficha.fin_grabacion, corta.fin_grabacion)
    assert.deepEqual(r.ficha.zona.lugares, FICHA.zona.lugares, 'con ficha guardada, lo dicho sale de la ficha')
    assert.equal(r.ficha.zona.timestamp, '00:24:30')
    assert.equal(r.ficha.zona.mapa_en_pantalla, true)
    // duracion_s del cuerpo manda; sin ficha, lo dicho sale del cuerpo
    const s = M.fichaConMomento(null, '00:00:45', { duracion: 90, lugares: ['Rawson'], radio_km: 20 })
    assert.deepEqual(s.segundos, [35, 45, 60, 80, 89])
    assert.deepEqual(s.ficha.zona, { lugares: ['Rawson'], radio_km: 20, timestamp: '00:00:45', aprox: null, mapa_en_pantalla: true })
    // Sin ficha ni duración no se puede acotar: se mira igual
    assert.deepEqual(M.fichaConMomento(null, '01:30:00', { duracion: null, lugares: [], radio_km: null }).segundos, [5390, 5400, 5415, 5435, 5460, 5520, 5580])
  })
})

describe('leerDescarga', () => {
  test('válida, con video', () => {
    const d = M.leerDescarga(conVideo())
    assert.equal(d.status, 'completed')
    assert.equal(d.video.url, URL_VIDEO)
    assert.equal(d.video.file_size_bytes, 154763264)
  })
  test('rara → respuesta_invalida (completed con url que no es https, sin url o sin id)', () => {
    for (const x of [
      null, [], {}, descarga('otro'), { ...descarga('processing'), download_id: '../../x' },
      conVideo({ video: { url: 'http://media.fathom.ai/x.mp4' } }), conVideo({ video: { url: 'file:///etc/passwd' } }), conVideo({ video: { url: null } }),
    ]) {
      assert.throws(() => M.leerDescarga(x), e => e instanceof ErrorFathomApi && e.codigo === 'respuesta_invalida')
    }
  })
  test('processing (o failed/expired) con el objeto video en null → no es error: video null', () => {
    const vacio = { url: null, content_type: null, file_size_bytes: null, expires_at: null }
    for (const st of ['processing', 'failed', 'expired']) {
      const d = M.leerDescarga(descarga(st, { video: vacio, audio: vacio }))
      assert.equal(d.status, st)
      assert.equal(d.video, null)
      assert.equal(d.audio, false)
    }
  })
})

describe('pedir y esperar el video (Fathom)', () => {
  test('processing → processing → completed, con espera creciente y la key solo en la cabecera', async () => {
    const r = reloj()
    const f = fetchFalso([resp(202, descarga('processing')), resp(200, descarga('processing')), resp(200, conVideo())])
    const v = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar })
    assert.equal(v.video.url, URL_VIDEO)
    assert.equal(v.pedidos, 1)
    assert.deepEqual(f.pedidos.map(p => p.metodo), ['POST', 'GET', 'GET'])
    assert.equal(f.pedidos[0].url, `https://api.fathom.ai/external/v1/recordings/${ID}/download`)
    assert.equal(f.pedidos[1].url, `https://api.fathom.ai/external/v1/recordings/${ID}/downloads/dl_PRUEBA123`)
    assert.ok(f.pedidos.every(p => p.key === KEY && !p.url.includes(KEY)))
    assert.deepEqual(r.esperas, [3_000, 5_000])
  })
  test('el POST ya vuelve completed → no se sondea', async () => {
    const f = fetchFalso([resp(202, conVideo())])
    const v = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() })
    assert.equal(v.video.url, URL_VIDEO)
    assert.equal(f.pedidos.length, 1)
  })
  test('failed → ErrorVideo fallo con el motivo de Fathom', async () => {
    const r = reloj()
    const f = fetchFalso([resp(202, descarga('processing')), resp(200, descarga('failed', { failure_reason: 'generation_timeout' }))])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar }), e => e instanceof M.ErrorVideo && e.codigo === 'fallo' && /generation_timeout/.test(e.message))
  })
  test('expired → se pide UNA vez más; si vuelve a vencer, error', async () => {
    let r = reloj()
    let f = fetchFalso([resp(202, descarga('processing')), resp(200, descarga('expired')), resp(202, descarga('processing')), resp(200, conVideo())])
    const v = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar })
    assert.equal(v.pedidos, 2)
    assert.deepEqual(f.pedidos.map(p => p.metodo), ['POST', 'GET', 'POST', 'GET'])
    r = reloj()
    f = fetchFalso([resp(202, descarga('processing')), resp(200, descarga('expired')), resp(202, descarga('processing')), resp(200, descarga('expired'))])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar }), e => e instanceof M.ErrorVideo && e.codigo === 'expirada')
    assert.equal(f.pedidos.length, 4)
  })
  test('422 → sin video; completed solo con audio → sin video', async () => {
    let f = fetchFalso([resp(422, { error: 'no media' })])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }), e => e instanceof M.ErrorVideo && e.codigo === 'sin_video')
    f = fetchFalso([resp(202, descarga('completed', { audio: { url: 'https://media.fathom.ai/a.m4a', content_type: 'audio/mp4', file_size_bytes: 1, expires_at: 'x' } }))])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }), e => e instanceof M.ErrorVideo && e.codigo === 'sin_video' && /audio/.test(e.message))
  })
  test('timeout: siempre processing → ErrorVideo espera dentro del límite', async () => {
    const r = reloj()
    const f = fetchFalso(url => (url.endsWith('/download') ? resp(202, descarga('processing')) : resp(200, descarga('processing'))))
    const limite = r.t + 60_000
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar, limite }), e => e instanceof M.ErrorVideo && e.codigo === 'espera')
    assert.ok(r.t <= limite, 'no se pasa del límite')
    assert.deepEqual(r.esperas.slice(0, 5), [3_000, 5_000, 8_000, 12_000, 15_000])
  })
  test('401 en el POST y 403 en el sondeo cortan enseguida', async () => {
    let f = fetchFalso([resp(401, { error: 'x' })])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }), e => e instanceof ErrorFathomApi && e.codigo === 'no_autorizada' && !e.message.includes(KEY))
    f = fetchFalso([resp(202, descarga('processing')), resp(403, { error: 'x' })])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }), e => e instanceof ErrorFathomApi && e.codigo === 'sin_permiso')
    assert.equal(f.pedidos.length, 2)
  })
  test('429 con Retry-After corto en el POST se espera y se reintenta', async () => {
    const r = reloj()
    const f = fetchFalso([resp(429, { error: 'rate' }, { 'retry-after': '2' }), resp(202, conVideo())])
    const v = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar })
    assert.equal(v.video.url, URL_VIDEO)
    assert.deepEqual(r.esperas, [2_000])
  })
  test('429 en el sondeo: se tolera; tres seguidos → limite', async () => {
    let r = reloj()
    let f = fetchFalso([resp(202, descarga('processing')), resp(429, {}, { 'retry-after': '4' }), resp(200, conVideo())])
    assert.equal((await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar })).video.url, URL_VIDEO)
    assert.deepEqual(r.esperas, [3_000, 4_000, 5_000])
    r = reloj()
    f = fetchFalso(url => (url.endsWith('/download') ? resp(202, descarga('processing')) : resp(429, {})))
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar }), e => e instanceof ErrorFathomApi && e.codigo === 'limite' && e.transitorio)
    assert.equal(f.pedidos.length, 4)
  })
  test('5xx y red en el sondeo: dos seguidos se toleran', async () => {
    const r = reloj()
    let n = 0
    const f = fetchFalso(url => {
      if (url.endsWith('/download')) return resp(202, descarga('processing'))
      n++
      if (n === 1) return resp(503, {})
      if (n === 2) return () => { throw new TypeError('fetch failed') }
      return resp(200, conVideo())
    })
    assert.equal((await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar })).video.url, URL_VIDEO)
  })
  test('sin key → sin_clave, sin pedir nada', async () => {
    const f = fetchFalso([])
    await assert.rejects(M.obtenerVideo(ID, 'gero_m', { env: ENV, fetch: f, ...reloj() }), e => e instanceof ErrorFathomApi && e.codigo === 'sin_clave' && /FATHOM_API_KEY_GERO_M/.test(e.message))
    assert.equal(f.pedidos.length, 0)
  })
  test('retomar una descarga ya pedida: sondea enseguida, sin POST', async () => {
    const r = reloj()
    const f = fetchFalso([resp(200, conVideo())])
    const v = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar, descargaId: 'dl_PRUEBA123' })
    assert.equal(v.pedidos, 0)
    assert.deepEqual(f.pedidos.map(p => p.metodo), ['GET'])
    assert.deepEqual(r.esperas, [])
  })
  test('la espera se agota → el error trae el download_id para retomar (y los pedidos)', async () => {
    const r = reloj()
    const f = fetchFalso(url => (url.endsWith('/download') ? resp(202, descarga('processing')) : resp(200, descarga('processing'))))
    const e = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar, limite: r.t + 60_000 }).catch(x => x)
    assert.ok(e instanceof M.ErrorVideo && e.codigo === 'espera')
    assert.deepEqual(M.descargaDelError(e), { download_id: 'dl_PRUEBA123', pedidos: 1 })
    // Retomada desde afuera y otra vez agotada: el mismo id, sin pedir otro
    const r2 = reloj()
    const f2 = fetchFalso(() => resp(200, descarga('processing', { download_id: 'dl_RETOMADA' })))
    const e2 = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f2, ahora: r2.ahora, esperar: r2.esperar, limite: r2.t + 30_000, descargaId: 'dl_RETOMADA' }).catch(x => x)
    assert.deepEqual(M.descargaDelError(e2), { download_id: 'dl_RETOMADA', pedidos: 0 })
    assert.ok(f2.pedidos.every(p => p.metodo === 'GET'))
  })
  test('429 seguidos en el sondeo → el error pasajero también trae el download_id; 401/403 no', async () => {
    let f = fetchFalso(url => (url.endsWith('/download') ? resp(202, descarga('processing')) : resp(429, {})))
    let e = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }).catch(x => x)
    assert.equal(e.codigo, 'limite')
    assert.equal(M.descargaDelError(e)?.download_id, 'dl_PRUEBA123')
    f = fetchFalso([resp(202, descarga('processing')), resp(401, {})])
    e = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }).catch(x => x)
    assert.equal(e.codigo, 'no_autorizada')
    assert.equal(M.descargaDelError(e), null)
    assert.equal(M.descargaDelError('no es un objeto'), null)
  })
  test('descarga retomada que Fathom ya no da (404, 403) o que falló → se pide una nueva UNA vez', async () => {
    for (const malo of [resp(404, {}), resp(403, {}), resp(200, descarga('failed', { failure_reason: 'generation_timeout' }))]) {
      const r = reloj()
      const f = fetchFalso([malo, resp(202, descarga('processing', { download_id: 'dl_NUEVA' })), resp(200, conVideo({ download_id: 'dl_NUEVA' }))])
      const v = await M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ahora: r.ahora, esperar: r.esperar, descargaId: 'dl_VIEJA' })
      assert.equal(v.download_id, 'dl_NUEVA')
      assert.equal(v.pedidos, 1)
      assert.deepEqual(f.pedidos.map(p => p.metodo), ['GET', 'POST', 'GET'])
      assert.match(f.pedidos[0].url, /downloads\/dl_VIEJA$/)
    }
    // La nueva también da 404 → error, sin otra vuelta
    const f = fetchFalso([resp(404, {}), resp(202, descarga('processing', { download_id: 'dl_NUEVA' })), resp(404, {})])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj(), descargaId: 'dl_VIEJA' }), e => e instanceof ErrorFathomApi && e.codigo === 'no_encontrada')
    assert.equal(f.pedidos.length, 3)
  })
  test('una descarga PROPIA que da 404 o falla no se vuelve a pedir', async () => {
    let f = fetchFalso([resp(202, descarga('processing')), resp(404, {})])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }), e => e instanceof ErrorFathomApi && e.codigo === 'no_encontrada')
    assert.equal(f.pedidos.length, 2)
    f = fetchFalso([resp(202, descarga('processing')), resp(200, descarga('failed'))])
    await assert.rejects(M.obtenerVideo(ID, 'tomas', { env: ENV, fetch: f, ...reloj() }), e => e instanceof M.ErrorVideo && e.codigo === 'fallo')
    assert.equal(f.pedidos.length, 2)
  })
})

describe('ffmpeg', () => {
  test('FFMPEG_PATH → ffmpeg-static → PATH', () => {
    assert.deepEqual(M.ubicarFfmpeg({ env: { FFMPEG_PATH: FFMPEG }, esEjecutable }), { ruta: FFMPEG, origen: 'FFMPEG_PATH' })
    assert.deepEqual(M.ubicarFfmpeg({ env: {}, requerir: () => '/nm/ffmpeg-static/ffmpeg', esEjecutable: p => p === '/nm/ffmpeg-static/ffmpeg' }), { ruta: '/nm/ffmpeg-static/ffmpeg', origen: 'ffmpeg-static' })
    const noHay = () => { throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' }) }
    assert.deepEqual(M.ubicarFfmpeg({ env: { PATH: '/a:/usr/bin' }, requerir: noHay, esEjecutable: p => p === '/usr/bin/ffmpeg' }), { ruta: '/usr/bin/ffmpeg', origen: 'PATH' })
  })
  test('sin ffmpeg o FFMPEG_PATH roto → error claro', () => {
    const noHay = () => { throw new Error('Cannot find module') }
    assert.throws(() => M.ubicarFfmpeg({ env: { PATH: '/a' }, requerir: noHay, esEjecutable: () => false }), e => e instanceof M.ErrorFfmpeg && /ffmpeg-static/.test(e.message))
    assert.throws(() => M.ubicarFfmpeg({ env: { FFMPEG_PATH: 'ffmpeg' }, esEjecutable: () => true }), e => e instanceof M.ErrorFfmpeg && /absoluta/.test(e.message))
    assert.throws(() => M.ubicarFfmpeg({ env: { FFMPEG_PATH: '/no/esta' }, esEjecutable: () => false }), M.ErrorFfmpeg)
  })
  test('versionFfmpeg: corre "ffmpeg -version" (spawn falso); sin ffmpeg o si no arranca → ok false, sin lanzar', async () => {
    const s = spawnFalso(() => ({ jpg: Buffer.from('ffmpeg version 6.0-static https://johnvansickle.com\nbuilt with gcc'), code: 0 }))
    const v = await M.versionFfmpeg({ env: { FFMPEG_PATH: FFMPEG }, esEjecutable, spawn: s })
    assert.deepEqual(v, { ok: true, origen: 'FFMPEG_PATH', version: 'ffmpeg version 6.0-static https://johnvansickle.com' })
    assert.deepEqual(s.llamadas[0].args, ['-hide_banner', '-version'])
    assert.equal((await M.versionFfmpeg({ env: { PATH: '' }, requerir: () => { throw new Error('no') }, esEjecutable: () => false })).ok, false)
    assert.equal((await M.versionFfmpeg({ env: { FFMPEG_PATH: FFMPEG }, esEjecutable, spawn: spawnFalso(() => ({ errorSpawn: 'EACCES' })) })).ok, false)
    assert.equal((await M.versionFfmpeg({ env: { FFMPEG_PATH: FFMPEG }, esEjecutable, spawn: spawnFalso(() => ({ lanzar: 'EACCES' })) })).ok, false)
  })
  test('versionFfmpeg colgado → ok false al tope y el proceso se MATA con SIGKILL', async () => {
    const s = spawnFalso(() => ({ colgado: true }))
    const v = await M.versionFfmpeg({ env: { FFMPEG_PATH: FFMPEG }, esEjecutable, spawn: s, topeMs: 20 })
    assert.equal(v.ok, false)
    assert.match(v.motivo, /no respondió/)
    assert.equal(s.procesos.length, 1)
    assert.equal(s.procesos[0].matado, true)
    assert.equal(s.procesos[0].senal, 'SIGKILL')
  })
  test('urlVideoValida: https sí; file:, http afuera y basura no; http local solo si se permite', () => {
    assert.ok(M.urlVideoValida(URL_VIDEO))
    for (const u of ['file:///etc/passwd', 'concat:a|b', 'http://media.fathom.ai/x.mp4', 'nada', '']) assert.equal(M.urlVideoValida(u, true) && !u.startsWith('http://127'), false, u)
    assert.equal(M.urlVideoValida('http://127.0.0.1:5555/v.mp4'), false)
    assert.equal(M.urlVideoValida('http://127.0.0.1:5555/v.mp4', true), true)
  })
})

describe('sacarCuadros (spawn falso)', () => {
  test('un ffmpeg por cuadro, -ss antes de -i, solo protocolos de red, 15 s sin datos', async () => {
    const s = spawnFalso()
    const r = await M.sacarCuadros(URL_VIDEO, [60, 45, 45, 80], { spawn: s, ffmpeg: FFMPEG })
    assert.deepEqual(r.cuadros.map(c => c.seg), [45, 60, 80])
    assert.equal(r.fallas.length, 0)
    const a = s.llamadas[0].args
    assert.equal(s.llamadas[0].cmd, FFMPEG)
    assert.ok(a.indexOf('-ss') < a.indexOf('-i'))
    assert.equal(a[a.indexOf('-protocol_whitelist') + 1], 'https,tls,tcp')
    assert.equal(a[a.indexOf('-rw_timeout') + 1], '15000000')
    assert.equal(a[a.length - 1], 'pipe:1')
  })
  test('cuadros que fallan van a fallas (sin la URL firmada); los demás siguen', async () => {
    const s = spawnFalso(seg => {
      if (seg === 10) return { code: 1, stderr: `${URL_VIDEO}: Server returned 403 Forbidden` }
      if (seg === 20) return { errorSpawn: 'spawn ffmpeg ENOENT' }
      if (seg === 30) return { jpg: Buffer.alloc(5_000, 1), code: 0 }                 // no es JPEG
      if (seg === 40) return { jpg: Buffer.from([0xff, 0xd8, 1, 2]), code: 0 }        // demasiado chico
      return { jpg: JPEG, code: 0 }
    })
    const r = await M.sacarCuadros(URL_VIDEO, [10, 20, 30, 40, 50], { spawn: s, ffmpeg: FFMPEG })
    assert.deepEqual(r.cuadros.map(c => c.seg), [50])
    assert.equal(r.fallas.length, 4)
    assert.ok(r.fallas.every(f => !f.error.includes('SECRETA') && !f.error.includes('media.fathom.ai')), JSON.stringify(r.fallas))
    assert.match(r.fallas[0].error, /\[url\]/)
  })
  test('ffmpeg colgado → al tope se MATA con SIGKILL (no quedan procesos leyendo la URL firmada)', async () => {
    const s = spawnFalso(seg => (seg === 5 ? { colgado: true } : { jpg: JPEG, code: 0 }))
    const r = await M.sacarCuadros(URL_VIDEO, [5, 9], { spawn: s, ffmpeg: FFMPEG, topeMs: 30 })
    assert.deepEqual(r.cuadros.map(c => c.seg), [9])
    assert.match(r.fallas[0].error, /no terminó/)
    assert.equal(s.procesos[0].matado, true)
    assert.equal(s.procesos[0].senal, 'SIGKILL')
    assert.equal(s.procesos[1].matado, false, 'el que terminó bien no se toca')
  })
  test('un cuadro más grande que MAX_BYTES_CUADRO (límite de imagen de Claude) se descarta y se mata ffmpeg', async () => {
    assert.ok(M.MAX_BYTES_CUADRO * 4 / 3 < 5 * 1024 * 1024, 'en base64 entra en los 5 MB de Claude')
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(4_000_000, 3)])
    const s = spawnFalso(seg => (seg === 10 ? { jpg: grande, code: 0 } : { jpg: JPEG, code: 0 }))
    const r = await M.sacarCuadros(URL_VIDEO, [10, 20], { spawn: s, ffmpeg: FFMPEG })
    assert.deepEqual(r.cuadros.map(c => c.seg), [20])
    assert.match(r.fallas[0].error, /demasiado grande/)
    assert.equal(s.procesos[0].senal, 'SIGKILL')
  })
  test('URL que no es https o sin segundos → lanza; http local solo con permiso', async () => {
    await assert.rejects(M.sacarCuadros('file:///etc/passwd', [1], { spawn: spawnFalso(), ffmpeg: FFMPEG }), /no es válida/)
    await assert.rejects(M.sacarCuadros(URL_VIDEO, [], { spawn: spawnFalso(), ffmpeg: FFMPEG }), /segundos/)
    const s = spawnFalso()
    const r = await M.sacarCuadros('http://127.0.0.1:5555/v.mp4', [1], { spawn: s, ffmpeg: FFMPEG, permitirHttpLocal: true })
    assert.equal(r.cuadros.length, 1)
    assert.equal(s.llamadas[0].args[s.llamadas[0].args.indexOf('-protocol_whitelist') + 1], 'http,https,tls,tcp')
  })
})

describe('validarMapa (salida rara de Claude)', () => {
  const SEGS = [35, 45, 60, 80, 89]
  test('no es objeto → lanza', () => {
    for (const x of [null, 'hola', [], 3]) assert.throws(() => M.validarMapa(x, SEGS), /no es un objeto/)
  })
  test('sin mapa pero con lugares → se descartan; las notas quedan vacías (no viaja lo que se ve en pantalla)', () => {
    const { mapa, ajustes } = M.validarMapa({ hay_mapa: false, lugares: [{ nombre: 'Rawson', posicion: 'dentro' }], tipo: 'google_maps', notas: 'solo la videollamada con Laura Ortiz y un Gmail abierto' }, SEGS)
    assert.equal(mapa.hay_mapa, false)
    assert.equal(mapa.tipo, 'ninguno')
    assert.deepEqual(mapa.lugares, [])
    assert.equal(mapa.notas, '')
    assert.match(ajustes.join(' '), /descartan/)
  })
  test('marca «ninguna»: dentro/borde/fuera pasan a sin_marca; con lugares en la lista de Meta, la marca es «lista»', () => {
    let { mapa, ajustes } = M.validarMapa({ ...MAPA_OK, marca: 'ninguna' }, SEGS)
    assert.equal(mapa.marca, 'ninguna')
    assert.ok(mapa.lugares.every(l => l.posicion === 'sin_marca'))
    assert.match(ajustes.join(' '), /6 lugar\(es\) quedan «sin_marca»/)
    ;({ mapa, ajustes } = M.validarMapa({ ...MAPA_OK, marca: 'ninguna', lugares: [{ nombre: 'San Juan', posicion: 'lista_incluida' }, { nombre: 'Chimbas', posicion: 'lista_excluida' }, { nombre: 'Rawson', posicion: 'dentro' }] }, SEGS))
    assert.equal(mapa.marca, 'lista')
    assert.deepEqual(mapa.lugares.map(l => l.posicion), ['lista_incluida', 'lista_excluida', 'dentro'])
    assert.match(ajustes.join(' '), /queda «lista»/)
  })
  test('enums desconocidos, repetidos, radio con km, mejor cuadro → momento', () => {
    const { mapa, ajustes } = M.validarMapa({
      hay_mapa: true, tipo: 'ninguno', marca: 'circulo', legible: 'bastante',
      lugares: [{ nombre: 'Rawson', posicion: 'adentro' }, { nombre: 'RAWSÓN', posicion: 'dentro' }, { nombre: '', posicion: 'dentro' }, 'x', { nombre: 'Pocito', posicion: 'borde' }],
      radio_km: '+17 km', radio_estimado_km: '20', excluidas: ['Chimbas', 3, ''], mejor_cuadro: 2,
    }, SEGS)
    assert.equal(mapa.tipo, 'otro')
    assert.equal(mapa.marca, 'otra')
    assert.equal(mapa.legible, 'parcial')
    assert.deepEqual(mapa.lugares, [{ nombre: 'Rawson', posicion: 'sin_marca' }, { nombre: 'Pocito', posicion: 'borde' }])
    assert.equal(mapa.radio_km, 17)
    assert.equal(mapa.radio_estimado_km, null)
    assert.deepEqual(mapa.excluidas, ['Chimbas'])
    assert.equal(mapa.mejor_cuadro, 2)
    assert.equal(mapa.momento, '00:00:45')
    assert.ok(ajustes.length >= 4)
  })
  test('límites y notas largos: se cortan en una frase (o en una palabra), nunca a la mitad; antes se perdía el tramo oeste', () => {
    const limites = 'Por el norte, una línea recta justo al sur del centro (debajo de Concepción); por el noreste baja siguiendo la ruta 20 hasta Independencia; '
      + 'el extremo este es un vértice en Pie de Palo; por el sur pasa por debajo de Caucete y Nueve de Julio hasta Alfonso XIII y queda apenas al norte de La Rinconada; '
      + 'por el oeste corre al oeste de Villa Krause, Villa Aberastain y Pocito, hasta cerrar el polígono otra vez al sur del centro de la ciudad capital de la provincia.'
    const { mapa } = M.validarMapa({ ...MAPA_OK, limites: limites.repeat(2), notas: 'palabra '.repeat(120) }, SEGS)
    // Corta justo antes de un "; " (fin de un tramo) y pone "…"
    const largo = limites.repeat(2), sinPuntos = mapa.limites.slice(0, -1)
    assert.ok(mapa.limites.length <= 600 && mapa.limites.endsWith('…') && largo.startsWith(sinPuntos) && largo.slice(sinPuntos.length, sinPuntos.length + 2) === '; ', mapa.limites.slice(-40))
    assert.ok(!/Aberasta…|Villa Kr…/.test(mapa.limites))
    assert.match(mapa.notas, /palabra…$/)
    assert.equal(M.enFrase('corto y entero', 600), 'corto y entero')
    assert.equal(M.enFrase('x'.repeat(700), 600).length, 600, 'sin espacios: el corte de siempre')
  })
  test('radio absurdo y mejor_cuadro fuera de rango → vacíos con ajuste; todo acotado', () => {
    const { mapa, ajustes } = M.validarMapa({
      hay_mapa: true, tipo: 'meta_ads', marca: 'pin_con_radio', radio_km: '-3', radio_estimado_km: '5000', mejor_cuadro: 9,
      lugares: Array.from({ length: 60 }, (_, i) => ({ nombre: `Lugar ${i}`, posicion: 'lista_incluida' })), limites: 'x'.repeat(2_000),
    }, SEGS)
    assert.equal(mapa.radio_km, null)
    assert.equal(mapa.radio_estimado_km, null)
    assert.equal(mapa.mejor_cuadro, null)
    assert.equal(mapa.momento, null)
    assert.equal(mapa.lugares.length, 40)
    assert.ok(mapa.limites.length <= 600)
    assert.equal(ajustes.filter(a => /fuera de rango/.test(a)).length, 3)
  })
  test('el schema es estricto (additionalProperties false y todo required)', () => {
    assert.equal(M.SCHEMA_MAPA.additionalProperties, false)
    assert.deepEqual([...M.SCHEMA_MAPA.required].sort(), Object.keys(M.SCHEMA_MAPA.properties).sort())
    assert.equal(M.SCHEMA_MAPA.$defs.lugar.additionalProperties, false)
  })
})

describe('combinarZonaConMapa (puro)', () => {
  const leido = M.validarMapa(MAPA_OK, [1028, 1038, 1053]).mapa
  const conLugares = (lugares, extra = {}) => M.validarMapa({ ...MAPA_OK, lugares, ...extra }, [1028, 1038, 1053]).mapa
  test('Laura: Caucete coincide; lo dicho que no se ve es discrepancia y lo visto que no se dijo, solo informativo', () => {
    const antes = structuredClone(FICHA.zona)
    const z = M.combinarZonaConMapa(FICHA.zona, leido)
    assert.deepEqual(FICHA.zona, antes, 'no muta la zona')
    assert.deepEqual(z.lugares, FICHA.zona.lugares)
    assert.equal(z.descripcion, FICHA.zona.descripcion)
    assert.equal(z.mapa.fuente, 'video')
    assert.equal(z.mapa.momento, '00:17:33')
    assert.deepEqual(z.mapa.lugares, ['Villa Krause', 'Rawson', 'Pocito', 'Médano de Oro', 'Caucete'])
    assert.deepEqual(z.mapa.coinciden, ['Caucete'])
    assert.deepEqual(z.mapa.parecidos, [])
    assert.deepEqual(z.mapa.no_verificables, [])
    assert.deepEqual(z.mapa.discrepancias.dichos_no_vistos, ['Tres Esquinas', 'Pedernal', 'El Bordón (de oído, verificar)'])
    assert.deepEqual(z.mapa.discrepancias.vistos_no_dichos, ['Villa Krause', 'Rawson', 'Pocito', 'Médano de Oro'])
    assert.equal(z.mapa.hay_discrepancias, true)
    // Sin la nota "(de oído, verificar)" metida en la frase, en plural y sin dar por hecho que quedan afuera
    assert.match(M.lineaMapa(z.mapa), /ojo: se nombraron Tres Esquinas, Pedernal y El Bordón y en el mapa no aparecen sus nombres: pueden estar dentro sin nombre, afuera o mal oídos \(El Bordón, de oído\)/)
  })
  test('un solo lugar dicho que no aparece: en singular; con un pin de Meta, «en el mapa también» sale de la ubicación configurada', () => {
    const uno = M.combinarZonaConMapa({ lugares: ['Pedernal'], radio_km: null }, leido)
    assert.deepEqual(M.diferenciasMapa(uno.mapa).ojos, ['se nombró Pedernal y en el mapa no aparece su nombre: puede estar dentro sin nombre, afuera o mal oído'])
    const pin = conLugares([
      { nombre: 'San Juan, San Juan, Argentina', posicion: 'lista_incluida' }, { nombre: 'Chimbas, San Juan, Argentina', posicion: 'lista_excluida' },
      { nombre: 'Albardón', posicion: 'dentro' }, { nombre: 'Rivadavia', posicion: 'dentro' },
    ], { tipo: 'meta_ads', marca: 'pin_con_radio', radio_km: '17' })
    const z = M.combinarZonaConMapa({ lugares: ['Rawson'], radio_km: 17 }, pin)
    assert.deepEqual(z.mapa.incluidas, ['San Juan, San Juan, Argentina'])
    assert.deepEqual(z.mapa.lugares, ['San Juan, San Juan, Argentina', 'Albardón', 'Rivadavia'], 'para comparar, la zona sigue siendo todo lo de adentro')
    assert.deepEqual(z.mapa.discrepancias.vistos_no_dichos, ['San Juan, San Juan, Argentina'], 'no los nombres impresos dentro del círculo')
    // Una lectura guardada antes (sin incluidas) se lee igual
    const { incluidas: _i, ...viejo } = z.mapa
    void _i
    assert.deepEqual(M.leerZonaVideo({ estado: 'ok', version: M.VERSION_MAPA, mapa: viejo }).mapa.incluidas, [])
  })
  test('lo dicho coincide y la marca abarca más (polígono): vistos_no_dichos NO es discrepancia', () => {
    const z = M.combinarZonaConMapa({ lugares: ['Caucete'], radio_km: null }, leido)
    assert.deepEqual(z.mapa.coinciden, ['Caucete'])
    assert.ok(z.mapa.discrepancias.vistos_no_dichos.includes('Pocito'))
    assert.equal(z.mapa.hay_discrepancias, false)
    assert.match(M.lineaMapa(z.mapa), /en el mapa también: .*Pocito/)
  })
  test('dicho que en el mapa queda afuera o excluido; uno mal oído queda como parecido (para revisar), no como coincidencia', () => {
    const m = { ...leido, excluidas: ['Pedernal'] }
    const z = M.combinarZonaConMapa({ lugares: ['Chimbas', 'Pedernal', 'Causete'], radio_km: null }, m)
    assert.deepEqual(z.mapa.discrepancias.dichos_afuera, ['Chimbas', 'Pedernal'])
    assert.deepEqual(z.mapa.coinciden, [])
    assert.deepEqual(z.mapa.parecidos, [{ dicho: 'Causete', visto: 'Caucete', donde: 'zona' }])
    assert.ok(!z.mapa.discrepancias.vistos_no_dichos.includes('Caucete'), 'el parecido no se cuenta como visto y no dicho')
    assert.match(M.lineaMapa(z.mapa), /ojo: Chimbas y Pedernal se nombraron pero en el mapa quedan afuera · revisar: se nombró Causete y en el mapa se lee Caucete/)
  })
  test('con marca, un lugar sin_marca no es de la zona: ni coincide ni va a mapa.lugares (queda sin verificar)', () => {
    const m = conLugares([{ nombre: 'Rawson', posicion: 'dentro' }, { nombre: 'Chimbas', posicion: 'sin_marca' }])
    const z = M.combinarZonaConMapa({ lugares: ['Chimbas'], radio_km: null }, m)
    assert.deepEqual(z.mapa.lugares, ['Rawson'])
    assert.deepEqual(z.mapa.sin_posicion, ['Chimbas'])
    assert.deepEqual(z.mapa.coinciden, [])
    assert.deepEqual(z.mapa.no_verificables, ['Chimbas'])
    assert.equal(z.mapa.hay_discrepancias, false)
    assert.match(M.lineaMapa(z.mapa), /En el video \(Google Maps, polígono, 00:17:33\): Rawson · se leen sin saber si quedan dentro: Chimbas/)
  })
  test('marca «ninguna»: nada queda "afuera" ni "no visto": todo lo dicho es no verificable', () => {
    const m = conLugares([{ nombre: 'Chimbas', posicion: 'fuera' }, { nombre: 'Caucete', posicion: 'dentro' }], { marca: 'ninguna' })
    const z = M.combinarZonaConMapa({ lugares: ['Chimbas', 'Caucete', 'Pedernal'], radio_km: null }, m)
    assert.deepEqual(z.mapa.discrepancias.dichos_afuera, [])
    assert.deepEqual(z.mapa.discrepancias.dichos_no_vistos, [])
    assert.deepEqual(z.mapa.discrepancias.vistos_no_dichos, [])
    assert.deepEqual(z.mapa.coinciden, [])
    assert.deepEqual(z.mapa.no_verificables, ['Chimbas', 'Caucete', 'Pedernal'])
    assert.deepEqual(z.mapa.lugares, [])
    assert.equal(z.mapa.hay_discrepancias, false)
    assert.match(M.lineaMapa(z.mapa), /sin marca, 00:17:33\): no hay una zona marcada · se leen: Chimbas, Caucete/)
  })
  test('ilegible o sin lugares leídos: lo dicho no se puede verificar (no es "no se lee")', () => {
    for (const m of [conLugares([], { legible: 'no' }), conLugares([], { legible: 'parcial' }), conLugares([{ nombre: 'Rawson', posicion: 'dentro' }], { legible: 'no' })]) {
      const z = M.combinarZonaConMapa({ lugares: ['Pedernal', 'Tres Esquinas'], radio_km: null }, m)
      assert.deepEqual(z.mapa.discrepancias.dichos_no_vistos, [])
      assert.deepEqual(z.mapa.no_verificables, ['Pedernal', 'Tres Esquinas'])
      assert.equal(z.mapa.hay_discrepancias, false)
      assert.match(M.lineaMapa(z.mapa), /el mapa no permite verificar Pedernal y Tres Esquinas/)
    }
  })
  test('nombres: departamento vs villa homónima es parecido (no coincide); 9 = Nueve', () => {
    const m = conLugares([{ nombre: 'VILLA DEL SARMIENTO', posicion: 'dentro' }, { nombre: 'Nueve de Julio', posicion: 'dentro' }, { nombre: 'Pocito', posicion: 'dentro' }])
    const z = M.combinarZonaConMapa({ lugares: ['Sarmiento', '9 de Julio'], radio_km: null }, m)
    assert.deepEqual(z.mapa.coinciden, ['9 de Julio'])
    assert.deepEqual(z.mapa.parecidos, [{ dicho: 'Sarmiento', visto: 'VILLA DEL SARMIENTO', donde: 'zona' }])
    assert.deepEqual(z.mapa.discrepancias.dichos_no_vistos, [])
    assert.deepEqual(z.mapa.discrepancias.vistos_no_dichos, ['Pocito'])
  })
  test('radio leído: 1 km de tolerancia (Meta lo muestra exacto); el estimado, 50 %', () => {
    const conRadio = km => ({ ...leido, marca: 'pin_con_radio', radio_km: km })
    const radio = (dicho, m) => M.combinarZonaConMapa({ lugares: [], radio_km: dicho }, m).mapa.discrepancias.radio
    assert.match(radio(20, conRadio(35)), /20 km.*35 km/)
    assert.match(radio(20, conRadio(17)), /se dijo 20 km y en el mapa se lee 17 km/)
    assert.match(radio(20, conRadio(19)), /19 km/)
    assert.equal(radio(20, conRadio(20)), null)
    assert.equal(radio(17.5, conRadio(17)), null)
    assert.equal(radio(20, { ...leido, radio_estimado_km: 25 }), null)
    assert.match(radio(20, { ...leido, radio_estimado_km: 40 }), /estimado/)
    const z = M.combinarZonaConMapa({ lugares: [], radio_km: 20 }, conRadio(17))
    assert.equal(z.mapa.hay_discrepancias, true)
    assert.match(M.lineaMapa(z.mapa), /radio 17 km.*ojo: se dijo 20 km y en el mapa se lee 17 km/)
  })
  test('Meta: ubicaciones con comas en la lista → coinciden por el nombre de antes de la coma y la línea separa con "; "', () => {
    const m = conLugares([
      { nombre: 'San Juan, San Juan, Argentina', posicion: 'lista_incluida' }, { nombre: 'Chimbas, San Juan, Argentina', posicion: 'lista_excluida' }, { nombre: 'Rivadavia', posicion: 'dentro' },
    ], { tipo: 'meta_ads', marca: 'pin_con_radio', radio_km: '17' })
    const z = M.combinarZonaConMapa({ lugares: ['San Juan', 'Chimbas'], radio_km: 20 }, m)
    assert.deepEqual(z.mapa.coinciden, ['San Juan'])
    assert.deepEqual(z.mapa.discrepancias.dichos_afuera, ['Chimbas'])
    const linea = M.lineaMapa(z.mapa)
    assert.ok(linea.startsWith('En el video (Meta Ads, pin con radio, 00:17:33): San Juan, San Juan, Argentina; Rivadavia · radio 17 km · excluidas: Chimbas, San Juan, Argentina'), linea)
  })
  test('sin mapa → mapa null', () => {
    const z = M.combinarZonaConMapa(FICHA.zona, M.validarMapa({ hay_mapa: false }, [1]).mapa)
    assert.equal(z.mapa, null)
  })
  test('compararLugares: igual (acentos, paréntesis, prefijos, números en letras) vs parecido vs distinto', () => {
    const igual = [
      ['El Bordón (de oído, verificar)', 'El Bordon'], ['Villa Krause (Rawson)', 'Rawson'], ['Pocito', 'Departamento Pocito'], ['RAWSÓN', 'Rawson'],
      ['9 de Julio', 'Nueve de Julio'], ['25 de Mayo', 'Veinticinco de Mayo'], ['1° de Mayo', 'Primero de Mayo'], ['Partido de La Matanza', 'La Matanza'],
      ['San Juan', 'San Juan, San Juan, Argentina'], ['Chimbas', 'Chimbas, San Juan, Argentina'],
    ]
    for (const [a, b] of igual) assert.equal(M.compararLugares(a, b), 'igual', `${a} / ${b}`)
    const parecido = [
      ['Causete', 'Caucete'], ['Sarmiento', 'VILLA DEL SARMIENTO'], ['San Juan', 'Provincia de San Juan'], ['Rivadavia', 'Villa Rivadavia'], ['Zonda', 'Ronda'],
    ]
    for (const [a, b] of parecido) {
      assert.equal(M.compararLugares(a, b), 'parecido', `${a} / ${b}`)
      assert.equal(M.mismoLugar(a, b), false, `${a} / ${b} no es el mismo`)
    }
    const distintos = [['San Juan', 'San Martín'], ['Rawson', 'Pocito'], ['Ullum', 'Zonda'], ['9 de Julio', '25 de Mayo'], ['San Juan', 'Rivadavia, San Juan, Argentina']]
    for (const [a, b] of distintos) assert.equal(M.compararLugares(a, b), null, `${a} / ${b}`)
  })
})

describe('zonaDesdeVideo (nunca lanza)', () => {
  const fathomOk = () => fetchFalso([resp(202, descarga('processing')), resp(200, conVideo())])
  test('ok: video → cuadros → Claude → zona con el mapa; sin cuadros ni la URL en el resultado', async () => {
    const d = depsBase({ fetch: fathomOk(), spawn: spawnFalso(), claude: claudeFalso() })
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, d)
    assert.equal(r.estado, 'ok', r.motivo)
    assert.deepEqual(r.momentos, [965, 1028, 1038, 1053, 1073, 1098, 1158, 1218])
    assert.equal(r.cuadros.sacados, 8)
    assert.equal(r.zona.mapa.fuente, 'video')
    assert.equal(r.zona.mapa.momento, '00:17:18')
    assert.deepEqual(r.zona.lugares, FICHA.zona.lugares)
    assert.equal(r.tokens.input_tokens, 9_000)
    assert.equal(r.tokens.costo_usd, 0.06)
    assert.equal(r.modelo, 'claude-opus-5-5')
    assert.equal(r.version, M.VERSION_MAPA)
    assert.match(r.linea, /En el video \(Google Maps, polígono/)
    const txt = JSON.stringify(r)
    assert.ok(!txt.includes('SECRETA') && !txt.includes('media.fathom.ai') && !txt.includes(JPEG.subarray(0, 64).toString('base64')))
    // Claude recibió los cuadros en orden, con su minuto, y SIN los lugares dichos
    const p = d.claude.llamadas[0]
    assert.equal(p.contenido.filter(b => b.type === 'image').length, 8)
    assert.equal(p.esfuerzo, 'medium')
    assert.ok(!JSON.stringify(p.contenido.filter(b => b.type === 'text')).includes('Pedernal'))
    assert.match(p.contenido[1].text, /Cuadro 1 · 00:16:05/)
  })
  test('sin key → sin_key, sin pedir nada a Fathom', async () => {
    const f = fetchFalso([])
    const r = await M.zonaDesdeVideo(ID, 'gero_m', FICHA, depsBase({ fetch: f, spawn: spawnFalso(), claude: claudeFalso() }))
    assert.equal(r.estado, 'sin_key')
    assert.match(r.motivo, /FATHOM_API_KEY_GERO_M/)
    assert.equal(f.pedidos.length, 0)
  })
  test('sin ffmpeg → error claro ANTES de pedirle el video a Fathom', async () => {
    const f = fetchFalso([])
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, { env: { FATHOM_API_KEY_TOMAS: KEY, PATH: '' }, requerir: () => { throw new Error('no') }, esEjecutable: () => false, fetch: f, claude: claudeFalso() })
    assert.equal(r.estado, 'error')
    assert.match(r.motivo, /ffmpeg/)
    assert.equal(f.pedidos.length, 0)
  })
  test('sin clave de Claude → error antes de Fathom', async () => {
    const f = fetchFalso([])
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: f, spawn: spawnFalso() }))
    assert.equal(r.estado, 'error')
    assert.match(r.motivo, /ANTHROPIC_API_KEY/)
    assert.equal(f.pedidos.length, 0)
  })
  test('422 → sin_video', async () => {
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fetchFalso([resp(422, {})]), spawn: spawnFalso(), claude: claudeFalso() }))
    assert.equal(r.estado, 'sin_video')
  })
  test('Claude no ve un mapa → sin_mapa (con lo que leyó)', async () => {
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fathomOk(), spawn: spawnFalso(), claude: claudeFalso({ hay_mapa: false, notas: 'videollamada' }) }))
    assert.equal(r.estado, 'sin_mapa')
    assert.equal(r.mapa.hay_mapa, false)
    assert.equal(r.zona, undefined)
  })
  test('Claude: error pasajero, salida no objeto, throw de cualquier cosa → error sin lanzar', async () => {
    let r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fathomOk(), spawn: spawnFalso(), claude: claudeFalso(() => { throw new ErrorTransitorio('Claude respondió 529 (overloaded_error)') }) }))
    assert.equal(r.estado, 'error')
    assert.equal(r.transitorio, true)
    r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fathomOk(), spawn: spawnFalso(), claude: claudeFalso('no soy un objeto') }))
    assert.equal(r.estado, 'error')
    assert.match(r.motivo, /no es un objeto/)
    r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fathomOk(), spawn: spawnFalso(), claude: claudeFalso(() => { throw 'cualquier cosa' }) }))
    assert.equal(r.estado, 'error')
  })
  test('ningún cuadro (spawn que lanza) → error con el motivo', async () => {
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fathomOk(), spawn: spawnFalso(() => ({ lanzar: 'EACCES' })), claude: claudeFalso() }))
    assert.equal(r.estado, 'error')
    assert.match(r.motivo, /ningún cuadro/)
  })
  test('algunos cuadros fallan → sigue con los demás y lo anota', async () => {
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fathomOk(), spawn: spawnFalso(seg => (seg > 1060 ? { code: 1, stderr: 'End of file' } : { jpg: JPEG })), claude: claudeFalso() }))
    assert.equal(r.estado, 'ok')
    assert.equal(r.cuadros.sacados, 4)
    assert.equal(r.cuadros.fallas.length, 4)
    assert.match(r.ajustes.join(' '), /no salieron/)
  })
  test('dry: verifica todo y corta ANTES de Fathom (ni video, ni ffmpeg, ni Claude) → listo', async () => {
    const f = fetchFalso([]), c = claudeFalso(), s = spawnFalso()
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: f, spawn: s, claude: c, dry: true, descargaId: 'dl_PRUEBA123' }))
    assert.equal(r.estado, 'listo', r.motivo)
    assert.match(r.motivo, /sin dry pediría el video a Fathom \(retomando la descarga\), sacaría 8 cuadros y llamaría a Claude/)
    assert.deepEqual(r.momentos, [965, 1028, 1038, 1053, 1073, 1098, 1158, 1218])
    assert.equal(f.pedidos.length, 0)
    assert.equal(c.llamadas.length, 0)
    assert.equal(s.llamadas.length, 0)
    assert.equal(r.tokens, null)
    // dry no saltea los controles: sin key sigue siendo sin_key
    assert.equal((await M.zonaDesdeVideo(ID, 'gero_m', FICHA, depsBase({ fetch: f, spawn: s, claude: c, dry: true }))).estado, 'sin_key')
  })
  test('ficha sin mapa en pantalla, sin timestamp, nula o id inválido → sin llamar a nada', async () => {
    const f = fetchFalso([]), c = claudeFalso()
    const d = depsBase({ fetch: f, spawn: spawnFalso(), claude: c })
    assert.equal((await M.zonaDesdeVideo(ID, 'tomas', { ...FICHA, zona: { ...FICHA.zona, mapa_en_pantalla: false } }, d)).estado, 'sin_mapa')
    // Sin el minuto de la zona es un error (no "sin mapa": eso diría que se miró y no estaba)
    const sinTs = await M.zonaDesdeVideo(ID, 'tomas', { ...FICHA, zona: { ...FICHA.zona, timestamp: null, aprox: null } }, d)
    assert.deepEqual([sinTs.estado, sinTs.motivo, !!sinTs.transitorio], ['error', 'la ficha no tiene el minuto en que se habló de la zona: no se sabe qué parte del video mirar', false])
    assert.equal((await M.zonaDesdeVideo(ID, 'tomas', null, d)).estado, 'error')
    assert.equal((await M.zonaDesdeVideo(-1, 'tomas', FICHA, d)).estado, 'error')
    assert.equal((await M.zonaDesdeVideo(ID, 'otro', FICHA, d)).estado, 'error')
    assert.equal(f.pedidos.length, 0)
    assert.equal(c.llamadas.length, 0)
  })
  test('el video tarda más que el plazo → error pasajero (para reintentar) CON el download_id para retomar', async () => {
    const d = depsBase({ fetch: fetchFalso(url => (url.endsWith('/download') ? resp(202, descarga('processing')) : resp(200, descarga('processing')))), spawn: spawnFalso(), claude: claudeFalso() })
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, { ...d, topeVideoMs: 30_000 })
    assert.equal(r.estado, 'error')
    assert.equal(r.transitorio, true)
    assert.match(r.motivo, /no terminó de generar el video/)
    assert.ok(d.reloj.t - 1_000_000 <= 30_000)
    assert.deepEqual(r.video, { download_id: 'dl_PRUEBA123', pedidos: 1, content_type: null, file_size_bytes: null, expires_at: null })
    // Con el plazo de la ruta (t0 + 285 s) pasa lo mismo
    const d2 = depsBase({ fetch: fetchFalso(url => (url.endsWith('/download') ? resp(202, descarga('processing')) : resp(200, descarga('processing')))), spawn: spawnFalso(), claude: claudeFalso() })
    const r2 = await M.zonaDesdeVideo(ID, 'tomas', FICHA, { ...d2, deadline: d2.reloj.t + 285_000 })
    assert.equal(r2.transitorio, true)
    assert.equal(r2.video.download_id, 'dl_PRUEBA123')
  })
  test('un error definitivo de Fathom (401) no trae download_id', async () => {
    const r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: fetchFalso([resp(202, descarga('processing')), resp(401, {})]), spawn: spawnFalso(), claude: claudeFalso() }))
    assert.equal(r.estado, 'error')
    assert.equal(r.transitorio, undefined)
    assert.equal(r.video, undefined)
  })
  test('urlVideo (prueba local) salta Fathom; http afuera no se acepta', async () => {
    const f = fetchFalso([])
    let r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: f, spawn: spawnFalso(), claude: claudeFalso(), urlVideo: 'http://127.0.0.1:9/v.mp4', permitirHttpLocal: true }))
    assert.equal(r.estado, 'ok')
    assert.equal(f.pedidos.length, 0)
    r = await M.zonaDesdeVideo(ID, 'tomas', FICHA, depsBase({ fetch: f, spawn: spawnFalso(), claude: claudeFalso(), urlVideo: 'http://ejemplo.test/v.mp4', permitirHttpLocal: true }))
    assert.equal(r.estado, 'error')
  })
})

describe('ruta POST /api/bot/kickoff/mapa', async () => {
  const CRON = 'cron-de-prueba-0123456789'
  process.env.CRON_SECRET = CRON
  const { POST } = await import('../app/api/bot/kickoff/mapa/route.ts')
  const post = (headers, body = '', qs = '') => POST(new Request(`https://despacho.test/api/bot/kickoff/mapa${qs}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))
  const auth = { authorization: `Bearer ${CRON}` }
  test('sin Bearer, con Bearer malo o con ?key= → 401', async () => {
    assert.equal((await post({}, '{}')).status, 401)
    assert.equal((await post({ authorization: 'Bearer otro' }, '{}')).status, 401)
    assert.equal((await post({}, '{}', `?key=${CRON}`)).status, 401)
  })
  test('cuerpo inválido → 400', async () => {
    assert.equal((await post(auth, 'no json')).status, 400)
    assert.equal((await post(auth, JSON.stringify({ recording_id: 'abc' }))).status, 400)
    assert.equal((await post(auth, JSON.stringify({ recording_id: ID, quien: 'pepe' }))).status, 400)
    assert.equal((await post(auth, JSON.stringify({ recording_id: ID, quien: 'tomas', timestamp_zona: '17:30' }))).status, 400)
    assert.equal((await post(auth, JSON.stringify({ recording_id: ID, quien: 'tomas', timestamp_zona: '00:30:00', duracion_s: 600 }))).status, 400)
    assert.equal((await post(auth, JSON.stringify({ recording_id: ID, quien: 'tomas', timestamp_zona: '00:00:45', descarga_id: '../x' }))).status, 400)
  })
  test('GET: sin Bearer 401; con Bearer, solo qué está configurado (sin valores) y ffmpeg sin correr si no está', async () => {
    const { GET } = await import('../app/api/bot/kickoff/mapa/route.ts')
    assert.equal((await GET(new Request('https://despacho.test/api/bot/kickoff/mapa'))).status, 401)
    process.env.FFMPEG_PATH = '/no/existe/ffmpeg'
    process.env.FATHOM_API_KEY_GERO_M = KEY
    try {
      const r = await GET(new Request('https://despacho.test/api/bot/kickoff/mapa', { headers: auth }))
      assert.equal(r.status, 200)
      const j = await r.json()
      assert.deepEqual(j.fathom_api, ['gero_m'])
      assert.equal(j.ffmpeg.ok, false)
      assert.equal(j.anthropic, false)
      assert.ok(!JSON.stringify(j).includes(KEY))
    } finally {
      delete process.env.FFMPEG_PATH
      delete process.env.FATHOM_API_KEY_GERO_M
    }
  })
  test('sin base ni timestamp_zona → 404', async () => {
    const r = await post(auth, JSON.stringify({ recording_id: ID, quien: 'tomas' }))
    assert.equal(r.status, 404)
  })
  test('con timestamp_zona pero sin la key de Fathom → 503 sin_key, sin red', async () => {
    const r = await post(auth, JSON.stringify({ recording_id: ID, quien: 'tomas', timestamp_zona: '00:00:45', duracion_s: 90, dry: true }))
    assert.equal(r.status, 503)
    const j = await r.json()
    assert.equal(j.estado, 'sin_key')
    assert.equal(j.guardado, false)
    assert.deepEqual(j.momentos, [35, 45, 60, 80, 89])
  })
  test('dry con todo configurado → 200 listo, sin tocar Fathom ni Claude (la red está bloqueada)', async () => {
    // FFMPEG_PATH: cualquier ejecutable absoluto alcanza para ubicarFfmpeg (con dry no se ejecuta)
    Object.assign(process.env, { FATHOM_API_KEY_TOMAS: KEY, ANTHROPIC_API_KEY: 'clave-falsa-de-prueba', FFMPEG_PATH: process.execPath })
    try {
      const r = await post(auth, JSON.stringify({ recording_id: ID, quien: 'tomas', timestamp_zona: '00:00:45', duracion_s: 90, dry: true }))
      const j = await r.json()
      assert.equal(r.status, 200, JSON.stringify(j))
      assert.equal(j.estado, 'listo')
      assert.equal(j.dry, true)
      assert.equal(j.guardado, false)
      assert.match(j.motivo, /sin dry pediría el video a Fathom, sacaría 5 cuadros/)
      assert.ok(!JSON.stringify(j).includes(KEY))
    } finally {
      for (const k of ['FATHOM_API_KEY_TOMAS', 'ANTHROPIC_API_KEY', 'FFMPEG_PATH']) delete process.env[k]
    }
  })
})
