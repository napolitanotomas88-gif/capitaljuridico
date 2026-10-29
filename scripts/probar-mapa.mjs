// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/probar-mapa.mjs [--armar] [--solo-cuadros]
// Prueba de PUNTA A PUNTA de la zona desde el video (lib/bot/kickoff/mapa.ts) SIN Fathom: arma un MP4 que simula la kickoff,
// lo sirve por HTTP local (con Range, como la URL firmada de Fathom) y corre zonaDesdeVideo de verdad salteando solo
// pedirVideo / esperarVideo (urlVideo inyectada): momentos → cuadros con ffmpeg → Claude de verdad → combinarZonaConMapa.
// Tres casos, una llamada a Claude cada uno:
//   · google: el polígono de Google Maps contra la zona DICHA de Laura (salida-195704214.json). El polígono primero aparece a
//     medio dibujar y después terminado: el mejor cuadro tiene que ser el del estado final;
//   · meta: el selector de ubicaciones de Meta (pin con "+17 km", San Juan incluida y Chimbas excluida) contra una zona dicha
//     de 20 km: tiene que leer el radio y la excluida y marcar la diferencia de radio;
//   · sin_mapa: cuadros solo de la "videollamada".
// El video es PESIMISTA a propósito: 1920×1080, 30 cuadros por segundo y un keyframe cada 60 s (sin keyframes extra en los
// cambios de escena). Con -ss sobre HTTP, ffmpeg arranca del keyframe anterior y decodifica hasta el segundo pedido: así se
// mide el peor caso de una pantalla compartida real (keyframes cada 10 a 60 s).
// Todo en .cache/kickoff-prueba/addons/mapa-prueba/:
//   · mapa-san-juan.jpg (entrada: captura limpia de Google Maps de San Juan, 1180×480);
//   · zona-overlay.png (polígono terminado), zona-parcial.png (a medio dibujar) y meta-overlay.png (círculo del radio, pin y
//     el área excluida en rojo): generados acá (PNG armado a mano, sin dependencias);
//   · kickoff-simulada.mp4: 0–40 s videollamada · 40–75 s polígono a medio dibujar · 75–240 s polígono terminado ·
//     240–295 s videollamada · 295–520 s selector de ubicaciones de Meta. H.264, faststart;
//   · resultado.json: lo que devolvió zonaDesdeVideo en los tres casos, tiempos, tokens, verificaciones y lo que sirvió el
//     HTTP (por pedido: bytes entregados al socket y si ffmpeg cortó antes del final). SIN imágenes.
// Claude: carga de .env.local SOLO ANTHROPIC_API_KEY / BOT_ANTHROPIC_API_KEY / KICKOFF_MODELO / KICKOFF_ESFUERZO, sin
// imprimir nada; fetch solo puede salir a api.anthropic.com (Fathom, Neon, Discord y Meta quedan bloqueados).
// --armar: solo arma los PNG y el MP4. --solo-cuadros: sirve el MP4 y saca los cuadros (sin Claude), para medir ffmpeg.
// --recombinar: rehace zona_mapa, linea y la verificación de resultado.json con el mapa que ya leyó Claude (sin ffmpeg ni
// Claude): para cuando cambia solo el código puro (combinarZonaConMapa, lineaMapa).
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

const RAIZ = new URL('../', import.meta.url).pathname
const CARPETA = join(RAIZ, '.cache/kickoff-prueba/addons/mapa-prueba')
const MAPA = join(CARPETA, 'mapa-san-juan.jpg')
const OVERLAY = join(CARPETA, 'zona-overlay.png')
const PARCIAL = join(CARPETA, 'zona-parcial.png')
const META = join(CARPETA, 'meta-overlay.png')
const VIDEO = join(CARPETA, 'kickoff-simulada.mp4')
const RESULTADO = join(CARPETA, 'resultado.json')
const FUENTE = '/System/Library/Fonts/Supplemental/Arial.ttf'
const FUENTE_NEGRITA = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
const ARMAR = process.argv.includes('--armar'), SOLO_CUADROS = process.argv.includes('--solo-cuadros'), RECOMBINAR = process.argv.includes('--recombinar')
const ANCHO = 1920, ALTO = 1080, FPS = 30, KEYFRAME_CADA_S = 60
// Tramos del video (segundos)
const T = { llamada1: [0, 40], parcial: [40, 75], final: [75, 240], llamada2: [240, 295], meta: [295, 520] }
const DURACION_S = T.meta[1]
const TS_GOOGLE = '00:00:45', TS_META = '00:05:10'

// ── PNG RGBA mínimo (IHDR + IDAT + IEND), pintado píxel por píxel ──
function png(w, h, rgba) {
  const chunk = (tipo, datos) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length)
    const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([largo, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const crudo = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(crudo, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(crudo)), chunk('IEND', Buffer.alloc(0))])
}
/** Un PNG del tamaño del mapa (1180×480): color(x, y) → [r, g, b, a] o null (transparente). */
function pintar(color, w = 1180, h = 480) {
  const px = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = color(x + 0.5, y + 0.5)
      if (c) px.set(c, (y * w + x) * 4)
    }
  }
  return png(w, h, px)
}

// El polígono de la zona, en coordenadas del mapa (1180×480): de Villa Krause / Médano de Oro al norte, Pocito al oeste,
// hasta Caucete al este (deja afuera la ciudad de San Juan, La Rinconada, Pie de Palo y Los Médanos)
const POLIGONO = [[330, 250], [430, 250], [520, 285], [600, 315], [625, 345], [600, 372], [500, 365], [420, 395], [330, 400], [300, 360], [310, 290]]
const dentroDe = (puntos, x, y) => {
  let c = false
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [xi, yi] = puntos[i], [xj, yj] = puntos[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const distTrazo = (puntos, cerrado, x, y) => {
  let d = Infinity
  const n = cerrado ? puntos.length : puntos.length - 1
  for (let k = 0; k < n; k++) {
    const [x1, y1] = puntos[k], [x2, y2] = puntos[(k + 1) % puntos.length]
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2))
    d = Math.min(d, Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1))))
  }
  return d
}
const AZUL = [26, 115, 232], ROJO = [217, 48, 37]
// Terminado: borde azul de Google y relleno ~22 %
const overlayZona = () => pintar((x, y) => (distTrazo(POLIGONO, true, x, y) <= 1.6 ? [...AZUL, 240] : dentroDe(POLIGONO, x, y) ? [...AZUL, 56] : null))
// A medio dibujar: solo los primeros 7 vértices, abierto y sin relleno, con los puntos de los vértices
const MEDIO = POLIGONO.slice(0, 7)
const overlayParcial = () => pintar((x, y) => (MEDIO.some(([px, py]) => Math.hypot(x - px, y - py) <= 4) || distTrazo(MEDIO, false, x, y) <= 1.6 ? [...AZUL, 240] : null))
// Meta: radio alrededor de San Juan (pin al centro) y Chimbas excluida en rojo
const CENTRO = [370, 213], RADIO_PX = 125, CHIMBAS = [373, 170], RADIO_EXCL_PX = 22
const overlayMeta = () => pintar((x, y) => {
  const dc = Math.hypot(x - CENTRO[0], y - CENTRO[1]), de = Math.hypot(x - CHIMBAS[0], y - CHIMBAS[1])
  if (dc <= 3) return [255, 255, 255, 255]
  if (dc <= 9) return [...AZUL, 255]
  if (Math.abs(de - RADIO_EXCL_PX) <= 1.5) return [...ROJO, 230]
  if (de < RADIO_EXCL_PX) return [...ROJO, 64]
  if (Math.abs(dc - RADIO_PX) <= 1.6) return [...AZUL, 230]
  if (dc < RADIO_PX) return [...AZUL, 46]
  return null
})

function armar() {
  if (!existsSync(MAPA)) throw new Error(`falta ${MAPA}`)
  writeFileSync(OVERLAY, overlayZona())
  writeFileSync(PARCIAL, overlayParcial())
  writeFileSync(META, overlayMeta())
  const txt = (t, x, y, tam = 42, color = 'white', fuente = FUENTE) => `drawtext=fontfile='${fuente}':text='${t}':x=${x}:y=${y}:fontsize=${tam}:fontcolor=${color}`
  const llamada = (d, salida) =>
    `color=c=0x202124:s=${ANCHO}x${ALTO}:r=${FPS}:d=${d},` +
    `drawbox=x=90:y=225:w=840:h=570:color=0x3c4043:t=fill,drawbox=x=990:y=225:w=840:h=570:color=0x3c4043:t=fill,` +
    `${txt('TN', 450, 450, 120, '0x8ab4f8')},${txt('LO', 1350, 450, 120, '0xf28b82')},` +
    `${txt('Tomás Napolitano', 120, 735)},${txt('Laura Ortiz', 1020, 735)},${txt('Kickoff - Capital Jurídico', '(w-tw)/2', 90, 48, '0xe8eaed')}[${salida}]`
  const google = (iMapa, iMarca, d, salida) => [
    `[${iMapa}:v][${iMarca}:v]overlay=0:0:format=auto,scale=${ANCHO}:-2,format=yuv420p[m${salida}]`,
    `color=c=0x202124:s=${ANCHO}x${ALTO}:r=${FPS}:d=${d}[f${salida}]`,
    `[f${salida}][m${salida}]overlay=x=0:y=(H-h)/2+30:shortest=1,${txt('Tomás Napolitano está compartiendo pantalla', 30, 30, 36)}[${salida}]`,
  ]
  // El selector de ubicaciones de Meta: panel a la izquierda (incluidas con "+17 km", excluidas) y el mapa a la derecha
  const oscuro = '0x1c2b33', gris = '0x65676b'
  const meta = (iMapa, iMarca, d, salida) => [
    `[${iMapa}:v][${iMarca}:v]overlay=0:0:format=auto,scale=1220:-2,format=yuv420p[mm]`,
    `color=c=0xf0f2f5:s=${ANCHO}x${ALTO}:r=${FPS}:d=${d},drawbox=x=40:y=110:w=600:h=900:color=white:t=fill,` +
      `drawbox=x=505:y=293:w=110:h=44:color=0xced0d4:t=2,drawbox=x=70:y=488:w=540:h=52:color=0xced0d4:t=2,` +
      `${txt('Ubicaciones', 70, 140, 36, oscuro, FUENTE_NEGRITA)},${txt('Personas que viven en esta ubicación', 70, 200, 22, gris)},` +
      `${txt('Incluidas', 70, 255, 24, oscuro, FUENTE_NEGRITA)},${txt('San Juan, San Juan, Argentina', 90, 303, 24, oscuro)},${txt('+17 km', 520, 303, 24, oscuro, FUENTE_NEGRITA)},` +
      `${txt('Excluidas', 70, 375, 24, '0xd93025', FUENTE_NEGRITA)},${txt('Chimbas, San Juan, Argentina', 90, 423, 24, oscuro)},` +
      `${txt('Buscar ubicaciones', 90, 502, 22, gris)}[fm]`,
    `[fm][mm]overlay=x=670:y=(H-h)/2:shortest=1,${txt('Tomás Napolitano está compartiendo pantalla', 30, 30, 30, oscuro)}[${salida}]`,
  ]
  const largo = ([a, b]) => b - a
  const filtro = [
    llamada(largo(T.llamada1), 'a'),
    ...google(0, 1, largo(T.parcial), 'b'),
    ...google(2, 3, largo(T.final), 'c'),
    llamada(largo(T.llamada2), 'd'),
    ...meta(4, 5, largo(T.meta), 'e'),
    '[a][b][c][d][e]concat=n=5:v=1:a=0,format=yuv420p[v]',
  ].join(';')
  const imagen = (ruta, d) => ['-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', ruta]
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y',
    ...imagen(MAPA, largo(T.parcial)), ...imagen(PARCIAL, largo(T.parcial)),
    ...imagen(MAPA, largo(T.final)), ...imagen(OVERLAY, largo(T.final)),
    ...imagen(MAPA, largo(T.meta)), ...imagen(META, largo(T.meta)),
    '-filter_complex', filtro, '-map', '[v]', '-an',
    // Un keyframe cada 60 s y ninguno extra en los cambios de escena (sc_threshold 0): el peor caso para -ss
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', String(FPS),
    '-g', String(FPS * KEYFRAME_CADA_S), '-keyint_min', String(FPS * KEYFRAME_CADA_S), '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(DURACION_S), VIDEO,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`ffmpeg no pudo armar el video: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`)
  console.log(`armado: ${VIDEO} (${(statSync(VIDEO).size / 1024).toFixed(0)} KB), ${OVERLAY}, ${PARCIAL} y ${META}`)
}

// ── Servidor HTTP con Range (206), como la URL firmada de Fathom ──
// Cada pedido anota su Range, los bytes que se le entregaron al socket (bytesWritten: lo que salió del proceso hacia el
// kernel; lo que ffmpeg leyó de verdad es eso o algo menos, porque corta en cuanto tiene el cuadro) y si cortó antes del
// final de la respuesta.
function servir(ruta) {
  const tam = statSync(ruta).size
  const est = { tamano: tam, pedidos: [] }
  const srv = createServer((req, res) => {
    const p = { range: req.headers.range ?? null, bytes: 0, cortado: false }
    est.pedidos.push(p)
    const inicio = req.socket.bytesWritten
    res.on('close', () => { p.bytes = req.socket.bytesWritten - inicio; p.cortado = !res.writableFinished })
    if (req.url !== '/video.mp4' || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return }
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    let ini = 0, fin = tam - 1, status = 200
    if (m) {
      if (m[1] === '' && m[2] !== '') { ini = Math.max(0, tam - Number(m[2])) } else { ini = Number(m[1] || 0); if (m[2] !== '') fin = Math.min(tam - 1, Number(m[2])) }
      if (ini > fin || ini >= tam) { res.writeHead(416, { 'Content-Range': `bytes */${tam}` }).end(); return }
      status = 206
    }
    res.writeHead(status, {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': fin - ini + 1,
      ...(status === 206 ? { 'Content-Range': `bytes ${ini}-${fin}/${tam}` } : {}),
    })
    if (req.method === 'HEAD') { res.end(); return }
    const s = createReadStream(ruta, { start: ini, end: fin })
    s.pipe(res)
    res.on('close', () => s.destroy())
  })
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}/video.mp4`, est })))
}
/** Lo que sirvió el HTTP desde el pedido número `desde` (para medir cada caso por separado). */
const resumenHttp = (est, desde = 0) => {
  const ps = est.pedidos.slice(desde)
  const bytes = ps.reduce((a, p) => a + p.bytes, 0)
  return { pedidos: ps.length, con_range: ps.filter(p => p.range).length, cortados: ps.filter(p => p.cortado).length, bytes_al_socket: bytes, fraccion_del_archivo: Math.round((bytes / est.tamano) * 100) / 100 }
}

// ── .env.local: solo lo de Claude, sin imprimir nada ──
function cargarClaude() {
  const QUERIDAS = new Set(['ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'KICKOFF_MODELO', 'KICKOFF_ESFUERZO'])
  for (const linea of readFileSync(join(RAIZ, '.env.local'), 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || !QUERIDAS.has(m[1]) || process.env[m[1]]) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
  // Nada de Fathom, base ni Discord en esta prueba
  for (const k of Object.keys(process.env)) if (/^FATHOM_|^DATABASE_URL$|^CUOTAS_DATABASE_URL$|^DISCORD_WEBHOOK/.test(k)) delete process.env[k]
}

const llamadas = {}
function bloquearRed() {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const host = new URL(url).host
    if (host !== 'api.anthropic.com') throw new Error(`prueba: ${host} no está permitido`)
    llamadas[host] = (llamadas[host] ?? 0) + 1
    return original(input, init)
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
if (!RECOMBINAR && (ARMAR || ![VIDEO, OVERLAY, PARCIAL, META].every(existsSync))) armar()
if (ARMAR) process.exit(0)

if (!SOLO_CUADROS && !RECOMBINAR) cargarClaude()
bloquearRed()
const M = await import('../lib/bot/kickoff/mapa.ts')
const salida = JSON.parse(readFileSync(join(RAIZ, '.cache/kickoff-prueba/salida-195704214.json'), 'utf8'))
const zonaLaura = salida.ficha.zona
const inicio = '2026-10-23T12:00:00Z'
const fin = new Date(Date.parse(inicio) + DURACION_S * 1000).toISOString()
// google: la zona dicha de Laura, con el momento de la zona movido a los 45 s del video simulado
const FICHA_GOOGLE = { fecha: inicio, fin_grabacion: fin, zona: { ...zonaLaura, timestamp: TS_GOOGLE, aprox: null, mapa_en_pantalla: true } }
// meta: una zona dicha de 20 km alrededor de San Juan (en pantalla se configuró +17 km)
const FICHA_META = {
  fecha: inicio, fin_grabacion: fin,
  zona: { descripcion: '20 km alrededor de San Juan capital, sin Chimbas', lugares: ['San Juan'], radio_km: 20, timestamp: TS_META, aprox: null, mapa_en_pantalla: true },
}
const SEGS_SIN_MAPA = M.momentosMapa({ timestampZona: 12, duracion: T.llamada1[1] })

const resumen = r => ({
  estado: r.estado, motivo: r.motivo ?? null, momentos: r.momentos, cuadros: r.cuadros, tiempos: r.tiempos, tokens: r.tokens, modelo: r.modelo,
  ajustes: r.ajustes, mapa: r.mapa ?? null, zona_mapa: r.zona?.mapa ?? null, linea: r.linea ?? null,
})
// Que ningún texto de lo leído nombre a las personas de la llamada (el prompt pide describir solo el mapa)
const PERSONAS = /tom[aá]s|napolitano|laura|ortiz/i
const sinPersonas = r => !PERSONAS.test(JSON.stringify(r.mapa ?? {}))
const segDe = (r, m) => (m.mejor_cuadro ? r.momentos[m.mejor_cuadro - 1] : null)
const dentro = (s, [a, b]) => s !== null && s >= a && s < b
/** g, m, s: {estado, momentos, mapa, zona: {mapa}} de los tres casos. */
const verificar = (g, m, s) => ({
  google: {
    ok: g.estado === 'ok',
    poligono: g.mapa?.marca === 'poligono',
    mejor_cuadro_en_el_estado_final: dentro(g.mapa ? segDe(g, g.mapa) : null, T.final),
    caucete_coincide: !!g.zona?.mapa?.coinciden.includes('Caucete'),
    sin_nombres_de_personas: sinPersonas(g),
  },
  meta: {
    ok: m.estado === 'ok',
    tipo: m.mapa?.tipo ?? null,
    radio_17_leido: m.mapa?.radio_km === 17,
    chimbas_excluida: !!m.zona?.mapa?.excluidas.some(n => M.mismoLugar('Chimbas', n)),
    san_juan_coincide: !!m.zona?.mapa?.coinciden.includes('San Juan'),
    discrepancia_de_radio: m.zona?.mapa?.discrepancias.radio ?? null,
    sin_nombres_de_personas: sinPersonas(m),
  },
  sin_mapa: { estado: s.estado, notas_vacias: (s.mapa?.notas ?? '') === '' },
})

if (RECOMBINAR) {
  const res = JSON.parse(readFileSync(RESULTADO, 'utf8'))
  const otra = {}
  for (const k of ['google', 'meta']) {
    const x = res[k]
    if (x.estado !== 'ok' || !x.mapa) continue
    const z = M.combinarZonaConMapa(res.zona_dicha[k], x.mapa)
    x.zona_mapa = z.mapa
    x.linea = z.mapa ? M.lineaMapa(z.mapa) : null
    otra[k] = { estado: x.estado, momentos: x.momentos, mapa: x.mapa, zona: z }
  }
  res.verificacion = verificar(otra.google ?? res.google, otra.meta ?? res.meta, res.sin_mapa)
  res.recombinado = { generado: new Date().toISOString(), version: M.VERSION_MAPA, nota: 'zona_mapa, linea y verificacion rehechos con el código actual sobre el mapa que ya había leído Claude (sin ffmpeg ni Claude)' }
  writeFileSync(RESULTADO, JSON.stringify(res, null, 2))
  for (const k of ['google', 'meta']) console.log(`${k}: ${res[k].linea}`)
  console.log(`verificación: ${JSON.stringify(res.verificacion)}`)
  process.exit(0)
}

const ff = M.ubicarFfmpeg()
const { srv, url, est } = await servir(VIDEO)

try {
  if (SOLO_CUADROS) {
    for (const [nombre, segs] of [['google', M.momentosMapa(FICHA_GOOGLE)], ['meta', M.momentosMapa(FICHA_META)], ['sin_mapa', SEGS_SIN_MAPA]]) {
      const desde = est.pedidos.length
      const c = await M.sacarCuadros(url, segs, { permitirHttpLocal: true })
      console.log(`${nombre} · ffmpeg (${ff.origen}): ${c.cuadros.length}/${segs.length} cuadros en ${c.ms} ms · ${c.cuadros.map(x => `${x.seg}s ${Math.round(x.jpg.length / 1024)} KB ${x.ms} ms`).join(' · ')}`)
      if (c.fallas.length) console.log('  fallas:', c.fallas)
      console.log(`  HTTP: ${JSON.stringify(resumenHttp(est, desde))}`)
    }
  } else {
    const t0 = Date.now()
    const correr = async (ficha, extra = {}) => {
      const desde = est.pedidos.length
      const r = await M.zonaDesdeVideo(195704214, 'tomas', ficha, { urlVideo: url, permitirHttpLocal: true, ...extra })
      return { r, http: resumenHttp(est, desde) }
    }
    const google = await correr(FICHA_GOOGLE)
    const meta = await correr(FICHA_META)
    const sinMapa = await correr(FICHA_GOOGLE, { segundos: SEGS_SIN_MAPA })
    const g = google.r, m = meta.r
    const verificacion = verificar(g, m, sinMapa.r)
    const costo = [g, m, sinMapa.r].reduce((a, r) => a + (r.tokens?.costo_usd ?? 0), 0)
    const resultado = {
      generado: new Date().toISOString(),
      version: M.VERSION_MAPA,
      ffmpeg: { origen: ff.origen },
      video: {
        archivo: 'kickoff-simulada.mp4', resolucion: `${ANCHO}x${ALTO}`, fps: FPS, keyframe_cada_s: KEYFRAME_CADA_S, duracion_s: DURACION_S,
        tramos: T, timestamp_google: TS_GOOGLE, timestamp_meta: TS_META, tamano_bytes: est.tamano,
      },
      zona_dicha: {
        google: { lugares: zonaLaura.lugares, radio_km: zonaLaura.radio_km, descripcion: zonaLaura.descripcion },
        meta: { lugares: FICHA_META.zona.lugares, radio_km: FICHA_META.zona.radio_km, descripcion: FICHA_META.zona.descripcion },
      },
      google: { ...resumen(g), http: google.http },
      meta: { ...resumen(m), http: meta.http },
      sin_mapa: { ...resumen(sinMapa.r), http: sinMapa.http },
      verificacion,
      llamadas_http: llamadas,
      costo_usd: Math.round(costo * 10_000) / 10_000,
      segundos: Math.round((Date.now() - t0) / 100) / 10,
    }
    writeFileSync(RESULTADO, JSON.stringify(resultado, null, 2))
    for (const [nombre, x] of [['google', google], ['meta', meta], ['sin mapa', sinMapa]]) {
      console.log(`${nombre}: ${x.r.estado}${x.r.motivo ? ` (${x.r.motivo})` : ''} · ${JSON.stringify(x.r.tiempos)} · tokens ${JSON.stringify(x.r.tokens)} · HTTP ${JSON.stringify(x.http)}`)
      if (x.r.linea) console.log(`  ${x.r.linea}`)
    }
    console.log(`verificación: ${JSON.stringify(verificacion)}`)
    console.log(`costo ~USD ${resultado.costo_usd} · ${resultado.segundos} s · guardado: ${RESULTADO}`)
  }
} finally {
  srv.close()
}
