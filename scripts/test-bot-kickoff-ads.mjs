// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-ads.mjs
// El aviso a Valentino «🚀 Para lanzar» (24/10, lib/bot/kickoff/aviso-ads.ts): el texto (lo que lleva y lo que NO: ni ideas
// ni ganadores; menciones, escape y largo), la marca de la columna aviso_ads (una sola vez por grabación), cuándo sale
// (procesar.ts al quedar lista, la ruta del mapa al terminar la lectura en cualquier estado final, el barrido si se cuelga,
// a mano con aviso_ads=1 / forzar, dry), el canal y la mención (entorno.ts) y el SQL contra un Neon falso. SIN red (fetch
// bloqueado y fakes), SIN base, SIN Discord, Fathom ni Claude. Los nombres, ids y webhooks de acá son inventados.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) {
  if (/^FATHOM_|^DISCORD_|^KICKOFF_/.test(k) || ['ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'DATABASE_URL', 'CRON_SECRET', 'META_ANUNCIOS_TOKEN', 'META_CLIENTES_TOKEN', 'DESPACHO_URL', 'FFMPEG_PATH'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const A = await import('../lib/bot/kickoff/aviso-ads.ts')
const E = await import('../lib/bot/kickoff/entorno.ts')
const registro = await import('../lib/bot/kickoff/registro.ts')
const { procesarKickoff, zvMapa } = await import('../lib/bot/kickoff/procesar.ts')
const { atenderMapa } = await import('../lib/bot/kickoff/mapa-api.ts')
const M = await import('../lib/bot/kickoff/mapa.ts')
const { FICHA_EJEMPLO, filasDemo } = await import('../lib/bot/kickoff/demo.ts')
const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')
const { formatearTranscripcion } = await import('../lib/fathomAnuncios/transcripcion.ts')
const { validarSalida, normTexto, emailsExternos } = await import('../lib/bot/kickoff/extraer.ts')
const { ITEMS_PORTFOLIO } = await import('../lib/bot/kickoff/tipos.ts')
const { kbDeRama } = await import('../lib/bot/kickoff/kb/index.ts')
const { MAX_DISCORD } = await import('../lib/bot/kickoff/mensaje.ts')
const { existsSync, readFileSync } = await import('node:fs')

const VALENTINO = '366996417782218754', TOMI = '111111111111111111', GERO = '222222222222222222'
const AHORA = Date.parse('2026-10-24T15:00:00Z')
const BASE = 'https://despacho.ejemplo.test'
const CFG = { valentino: VALENTINO, urlBase: BASE, pantalla: true }
const clonar = x => JSON.parse(JSON.stringify(x))
const hms = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')

// ── Datos de prueba ──
/** Una fila "lista" de la clienta de ejemplo (demo.ts), sin lectura del mapa ni marcas (como la recién armada). */
const filaEjemplo = (over = {}) => ({ ...A.filaParaAviso(clonar(FICHA_EJEMPLO), null, '2026-10-24T14:00:00.000Z'), ...over })
const mapaLeido = (over = {}) => ({
  hay_mapa: true, tipo: 'google_maps', marca: 'poligono', marca_detalle: 'polígono', radio_km: null, radio_estimado_km: null, radio_como: '',
  limites: 'al norte la ruta 5, al sur el río', excluidas: [], mejor_cuadro: 3, momento: '00:17:30', legible: 'si', notas: '',
  lugares: [{ nombre: 'Colonia Ejemplo', posicion: 'dentro' }, { nombre: 'Paraje Norte', posicion: 'dentro' }, { nombre: 'Villa Inventada', posicion: 'dentro' }, { nombre: 'El Molino', posicion: 'dentro' }],
  ...over,
})
const zonaDicha = () => ({ lugares: FICHA_EJEMPLO.zona.lugares, radio_km: FICHA_EJEMPLO.zona.radio_km })
const zvOk = (over = {}) => zvMapa('ok', 'tomas', '2026-10-24T14:30:00.000Z', { mapa: M.combinarZonaConMapa(zonaDicha(), mapaLeido(over)).mapa, download_id: 'dl_1' })
const lineaDe = (t, emoji) => t.split('\n').find(l => l.startsWith(emoji)) ?? ''

// ── 1. El texto ────────────────────────────────────────────────────────────────────────────────────
describe('textoAvisoAds: lo que necesita Valentino para lanzar (y nada de ideas ni ganadores)', () => {
  test('cabecera con la mención, quién y cuándo, cuenta, rama, a quién le habla, zona, mapa, presentarse, presupuesto, lanzamiento, portfolio y links', () => {
    const t = A.textoAvisoAds(filaEjemplo(), CFG, AHORA)
    const l = t.split('\n')
    assert.equal(l[0], `<@${VALENTINO}> 🚀 **Para lanzar · Clienta Ejemplo (ejemplo)**`)
    assert.match(l[1], /^📞 Kickoff de Tomás · \w{3} \d{2}\/\d{2} \d{2}:\d{2} · \[Fathom\]\(<https:\/\/fathom\.video\/calls\/100000001>\)$/)
    assert.match(lineaDe(t, '🏦'), /^🏦 \*\*Cuenta:\*\* `act_100000000000001` \(«USD ESTUDIO JURIDICO EJEMPLO»\) · factura en USD · hora de Argentina/)
    assert.match(lineaDe(t, '⚖️'), /^⚖️ \*\*Rama:\*\* Laboral \(despidos\) — subramas: /)
    assert.match(lineaDe(t, '👤'), /^👤 \*\*A quién le habla \(para el copy\):\*\* .+ · ✋ afuera: /)
    // La provincia y el país delante (en Meta hay localidades homónimas en otras provincias) y la distancia al estudio
    assert.equal(lineaDe(t, '📍'), '📍 **Zona:** Provincia de La Pampa, Argentina: Colonia Ejemplo · Paraje Norte · Villa Inventada · El Molino (de oído) · El estudio está en Pueblo Ejemplo; Clara dice que queda a 50 km de la capital (cuarenta minutos)')
    assert.match(lineaDe(t, '🗺️'), /⚠️ se marcó en un mapa en pantalla y no se leyó del video: confirmar el recorte con Tomi antes de lanzar \[▶ ≈?\d{2}:\d{2}\]\(<https:\/\/fathom\.video\/calls\/100000001\?timestamp=\d+>\)$/)
    assert.match(lineaDe(t, '🗣️'), /^🗣️ \*\*Presentarse como:\*\* «Santa Rosa capital»/)
    assert.match(lineaDe(t, '💵'), /^💵 \*\*Presupuesto:\*\* USD \d/)
    assert.match(lineaDe(t, '📅'), /^📅 \*\*Lanzamiento:\*\* /)
    assert.match(lineaDe(t, '🧾'), /^🧾 \*\*Portfolio:\*\* /)
    assert.equal(l.at(-1), `👉 [Ficha](<${BASE}/clientes/E157/kickoff>) · [Tablero de anuncios](<${BASE}/anuncios>)`)
    assert.ok(t.length <= MAX_DISCORD)
  })
  test('NADA de las ideas de guiones ni de los ganadores de otros clientes', () => {
    const t = A.textoAvisoAds(filaEjemplo(), CFG, AHORA)
    for (const x of FICHA_EJEMPLO.ideas_guiones.ideas) {
      assert.ok(!t.includes(x.titulo), `sin la idea «${x.titulo}»`)
      assert.ok(!t.includes(x.gancho.slice(0, 30)), 'sin ganchos')
    }
    for (const g of FICHA_EJEMPLO.ganadores.lista) assert.ok(!t.includes(g.anuncio), 'sin anuncios de otros clientes')
    assert.ok(!/💡|🏆|\bG\d{1,2}\b|ganador/i.test(t))
  })
  test('sin ID de Valentino: "Valentino" en texto, sin <@…>; sin ID del CRM o con la pantalla apagada: solo el tablero', () => {
    const t = A.textoAvisoAds(filaEjemplo(), { ...CFG, valentino: null }, AHORA)
    assert.ok(t.startsWith('Valentino 🚀 **Para lanzar · '))
    assert.ok(!t.includes('<@'))
    const sinId = A.textoAvisoAds(filaEjemplo({ ficha: { ...clonar(FICHA_EJEMPLO), cliente: { ...FICHA_EJEMPLO.cliente, id_crm: null, cliente_crm: null } } }), CFG, AHORA)
    assert.equal(sinId.split('\n').at(-1), `👉 [Tablero de anuncios](<${BASE}/anuncios>)`)
    assert.match(sinId.split('\n')[0], /CLIENTA EJEMPLO \(sin cruzar con el CRM\)\*\*$/)
    assert.equal(A.textoAvisoAds(filaEjemplo(), { ...CFG, pantalla: false }, AHORA).split('\n').at(-1), `👉 [Tablero de anuncios](<${BASE}/anuncios>)`)
  })
  test('lo que viene del modelo o de Meta va escapado: sin markdown propio ni menciones', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.cliente.cliente_crm = '**Ana** @everyone <@999999999999999999>'
    f.portfolio_meta.nombre = 'Estudio __raro__'
    f.zona.lugares = ['San *Juan*', '`código`']
    const t = A.textoAvisoAds(filaEjemplo({ ficha: f }), CFG, AHORA)
    assert.ok(!t.includes('@everyone'))
    assert.ok(!t.includes('<@999999999999999999>'))
    assert.ok(t.includes('\\*\\*Ana\\*\\*'))
    assert.ok(t.includes('Estudio \\_\\_raro\\_\\_'))
    assert.ok(t.includes('San \\*Juan\\*') && t.includes('\\`código\\`'))
    assert.equal([...t.matchAll(/<@(\d+)>/g)].map(m => m[1]).join(), VALENTINO, 'la única mención es la de Valentino')
  })
  test('ninguna ficha que no sea un kickoff legible: null', () => {
    assert.equal(A.textoAvisoAds(filaEjemplo({ ficha: { ...clonar(FICHA_EJEMPLO), tipo_reunion: 'seguimiento' } }), CFG, AHORA), null)
    assert.equal(A.textoAvisoAds(filaEjemplo({ ficha: { cualquier: 'cosa' } }), CFG, AHORA), null)
  })
})

describe('textoAvisoAds: el mapa del video, el portfolio, el presupuesto y el lanzamiento', () => {
  test('mapa leído que coincide: ✅ con lo leído (lugares y límites) y el ▶ al cuadro de la marca', () => {
    const t = lineaDe(A.textoAvisoAds(filaEjemplo({ zona_video: zvOk() }), CFG, AHORA), '🗺️')
    assert.match(t, /^🗺️ \*\*Mapa:\*\* ✅ el mapa del video coincide con lo dicho · leído: Colonia Ejemplo · Paraje Norte · Villa Inventada · El Molino · límites: al norte la ruta 5, al sur el río \[▶ 17:30\]\(<https:\/\/fathom\.video\/calls\/100000001\?timestamp=1050>\)$/)
  })
  test('mapa con diferencias: ⚠️ nombrando los lugares, para que Tomi confirme el recorte', () => {
    const zv = zvOk({ lugares: [{ nombre: 'Colonia Ejemplo', posicion: 'dentro' }, { nombre: 'Paraje Norte', posicion: 'dentro' }, { nombre: 'El Molino', posicion: 'fuera' }] })
    const t = lineaDe(A.textoAvisoAds(filaEjemplo({ zona_video: zv }), CFG, AHORA), '🗺️')
    assert.match(t, /⚠️ el mapa del video no muestra Villa Inventada; deja afuera El Molino: confirmar el recorte con Tomi antes de lanzar/)
    assert.match(t, / · leído: Colonia Ejemplo · Paraje Norte/)
  })
  test('pin con radio de Meta: lo leído es la ubicación configurada con su radio y lo excluido', () => {
    const zv = zvMapa('ok', 'tomas', '2026-10-24T14:30:00.000Z', {
      mapa: M.combinarZonaConMapa({ lugares: ['Colonia Ejemplo'], radio_km: 30 }, mapaLeido({
        tipo: 'meta_ads', marca: 'pin_con_radio', radio_km: 30, limites: '', excluidas: ['El Molino'],
        lugares: [{ nombre: 'Colonia Ejemplo, La Pampa, Argentina', posicion: 'lista_incluida' }, { nombre: 'Paraje Norte', posicion: 'dentro' }],
      })).mapa,
    })
    const f = clonar(FICHA_EJEMPLO)
    f.zona.lugares = ['Colonia Ejemplo']
    f.zona.radio_km = 30
    const t = lineaDe(A.textoAvisoAds(filaEjemplo({ ficha: f, zona_video: zv }), CFG, AHORA), '🗺️')
    assert.match(t, /leído: Colonia Ejemplo, La Pampa, Argentina \+30 km · sin El Molino/)
    assert.ok(!/Paraje Norte/.test(t), 'no los nombres que se leen dentro del círculo')
  })
  test('sin mapa en esos minutos, sin video, con error o colgada: ⚠️ con el porqué y "confirmar el recorte con Tomi"', () => {
    const casos = [
      [zvMapa('sin_mapa', 'tomas', '2026-10-24T14:30:00.000Z'), /en el video no se ve el mapa de la zona/],
      [zvMapa('sin_video', 'tomas', '2026-10-24T14:30:00.000Z'), /la grabación no tiene video para leer el mapa/],
      [zvMapa('error', 'tomas', '2026-10-24T14:30:00.000Z', { motivo: 'Fathom: failed' }), /no se pudo leer el mapa del video/],
      [zvMapa('sin_key', 'gero_m', '2026-10-24T14:30:00.000Z', { motivo: 'conectar la API key de Fathom de Gero M para leer el mapa' }), /no se pudo leer el mapa del video/],
      [{ ...zvMapa('leyendo', 'tomas', new Date(AHORA - 60_000).toISOString()), vence_ms: AHORA + 1 }, /la lectura del mapa del video no terminó/],
    ]
    for (const [zv, re] of casos) {
      const t = lineaDe(A.textoAvisoAds(filaEjemplo({ zona_video: zv }), CFG, AHORA), '🗺️')
      assert.match(t, re)
      assert.match(t, /confirmar el recorte con Tomi antes de lanzar/)
      assert.ok(!/API key|FATHOM_/.test(t), 'sin nombres de variables ni lo que es de Tomi')
    }
  })
  test('el recorte anotado a mano en la ficha va primero; si el video dice otra cosa, el ojo', () => {
    const [fila] = filasDemo('E157')        // demo: mapa leído con El Molino afuera y la nota del recorte marcada como hecha
    const t = lineaDe(A.textoAvisoAds(fila, CFG, AHORA), '🗺️')
    assert.match(t, /^🗺️ \*\*Mapa:\*\* recorte anotado: «/)
    const sinVideo = lineaDe(A.textoAvisoAds({ ...filaEjemplo(), faltantes_checks: { zona_mapa: { nota: 'de la ruta 5 al río', quien: 'Tomi', email: 't@x.test', cuando: '2026-10-24T14:40:00.000Z' } } }, CFG, AHORA), '🗺️')
    assert.match(sinVideo, /^🗺️ \*\*Mapa:\*\* recorte anotado: «de la ruta 5 al río»/)
    assert.ok(!sinVideo.includes('confirmar el recorte'), 'ya lo anotó Tomi: no se le pide confirmarlo')
    assert.ok(!sinVideo.includes('t@x.test'))
  })
  test('portfolio: lo que FRENA primero (accesos, tarjeta…) con el porqué, lo tildado a mano y lo que nadie confirmó', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.portfolio_final.accesos_equipo = { ...f.portfolio_final.accesos_equipo, estado: 'falta', fuente: 'meta', detalle: 'Valentino no tiene acceso a la cuenta · detalle técnico' }
    f.portfolio_final.tarjeta = { ...f.portfolio_final.tarjeta, estado: 'problema', fuente: 'meta', detalle: 'La cuenta tiene deuda' }
    const t = lineaDe(A.textoAvisoAds(filaEjemplo({ ficha: f }), CFG, AHORA), '🧾')
    assert.match(t, /^🧾 \*\*Portfolio:\*\* ⛔ frena: Accesos del equipo: falta — Valentino no tiene acceso a la cuenta · Tarjeta: problema — La cuenta tiene deuda/)
    assert.ok(!t.includes('detalle técnico'), 'solo la primera parte del detalle')
    // Sin frenos de Meta pero con WhatsApp Business sin confirmar (es el destino de los anuncios): no dice "sin frenos"
    const ok = lineaDe(A.textoAvisoAds(filaEjemplo(), CFG, AHORA), '🧾')
    assert.equal(ok, '🧾 **Portfolio:** ⚠️ WhatsApp Business sin confirmar (es el destino de los anuncios) · 5/7 ok según Meta · sin confirmar: Instagram')
    // Meta no pudo leer la cuenta: que se confirme con Tomi
    const g = clonar(FICHA_EJEMPLO)
    g.portfolio_meta = { ...g.portfolio_meta, leido: false, motivo: 'error' }
    for (const k of ITEMS_PORTFOLIO) g.portfolio_final[k] = { ...g.portfolio_final[k], estado: 'sin_dato', fuente: 'ninguna' }
    assert.match(lineaDe(A.textoAvisoAds(filaEjemplo({ ficha: g }), CFG, AHORA), '🧾'), /Meta no pudo leer la cuenta: confirmar accesos y tarjeta con Tomi · ⚠️ WhatsApp Business sin confirmar \(es el destino de los anuncios\) · sin confirmar: /)
  })
  test('presupuesto por día y por mes; la cuenta que factura en otra moneda lo dice; lanzamiento con la fecha cargada a mano y el WhatsApp', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.portfolio_meta.moneda = 'ARS'
    const fila = filaEjemplo({ ficha: f, faltantes_checks: {
      fecha_lanzamiento: { nota: 'lun 2/11', quien: 'Tomi', email: 't@x.test', cuando: '2026-10-24T14:40:00.000Z' },
      whatsapp_destino: { nota: '+54 9 2954 000000', quien: 'Tomi', email: 't@x.test', cuando: '2026-10-24T14:41:00.000Z' },
    } })
    const t = A.textoAvisoAds(fila, CFG, AHORA)
    assert.match(lineaDe(t, '💵'), /por día.*por mes.* · la cuenta factura en ARS: pasarlo a ARS al cargarlo/)
    assert.match(lineaDe(t, '📅'), /^📅 \*\*Lanzamiento:\*\* estimado lun 2\/11 \(cuando estén los videos\) · guiones para .+ · 📲 WhatsApp de destino: \+54 9 2954 000000$/)
    // Sin fecha: sale cuando estén los videos, con lo que se acordó
    assert.match(lineaDe(A.textoAvisoAds(filaEjemplo(), CFG, AHORA), '📅'), /^📅 \*\*Lanzamiento:\*\* sin fecha todavía: sale cuando estén los videos/)
  })
  test('con la ficha de Laura (si está la salida de la prueba): entra, sin ideas ni ganadores', { skip: !existsSync('.cache/kickoff-prueba/salida-195704214.json') }, () => {
    const s = JSON.parse(readFileSync('.cache/kickoff-prueba/salida-195704214.json', 'utf8'))
    const t = A.textoAvisoAds(A.filaParaAviso(s.ficha, null), CFG, AHORA)
    assert.ok(t.length <= MAX_DISCORD)
    assert.ok(t.startsWith(`<@${VALENTINO}> 🚀 **Para lanzar · Laura`))
    for (const x of s.ficha.ideas_guiones.ideas) assert.ok(!t.includes(x.titulo))
    assert.ok(!/\bG\d{1,2}\b/.test(t))
  })
})

describe('textoAvisoAds: hasta 2000 caracteres con ítems enteros; la mención y los links no se pierden nunca', () => {
  const larga = () => {
    const f = clonar(FICHA_EJEMPLO)
    f.cliente.cliente_crm = 'Estudio Jurídico Integral de Abogadas y Abogados Asociados del Interior y la Capital (sede central)'
    f.rama.subramas = Array.from({ length: 12 }, (_, i) => ({ ...f.rama.subramas[0], texto: `subrama número ${i} con un nombre bastante largo para el renglón` }))
    f.avatar.incluye = Array.from({ length: 14 }, (_, i) => ({ ...f.avatar.incluye[0], texto: `filtro de inclusión ${i}: trabajadores con más de dos años en relación de dependencia registrada` }))
    f.avatar.excluye = Array.from({ length: 14 }, (_, i) => ({ ...f.avatar.incluye[0], texto: `nada de exclusión ${i}: monotributistas, pasantes, contratados por agencia o en período de prueba` }))
    f.zona.lugares = Array.from({ length: 40 }, (_, i) => `Localidad Inventada Número ${i}`)
    f.zona.presentarse_como = { ...f.zona.presentarse_como, texto: 'la capital de la provincia y alrededores', cuando: 'si un lead pregunta dónde queda el estudio o si atiende en su ciudad' }
    for (const k of ITEMS_PORTFOLIO) f.portfolio_final[k] = { ...f.portfolio_final[k], estado: 'problema', fuente: 'meta', detalle: `problema largo de ${k}: ${'la cuenta tiene una restricción que hay que revisar en la configuración del negocio '.repeat(2)}` }
    f.portfolio_meta.aviso = 'Revisar en el portfolio del cliente la configuración de pagos, la verificación del negocio y los accesos de la agencia antes de lanzar.'
    const zv = zvMapa('ok', 'tomas', '2026-10-24T14:30:00.000Z', {
      mapa: M.combinarZonaConMapa({ lugares: f.zona.lugares, radio_km: null }, mapaLeido({
        limites: 'Al norte: la ruta provincial 5 hasta el cruce con la 35; al este: el río y los campos; al sur: el límite con el departamento vecino; al oeste: la vía del tren. '.repeat(3).slice(0, 590),
        lugares: Array.from({ length: 30 }, (_, i) => ({ nombre: `Lugar Leído ${i}`, posicion: 'dentro' })),
      })).mapa,
    })
    return filaEjemplo({ ficha: f, zona_video: zv })
  }
  test('todo largo: entra en 2000, empieza con la mención y termina con los links; ningún ítem cortado a mitad (sin "…" en los renglones)', () => {
    const t = A.textoAvisoAds(larga(), CFG, AHORA)
    assert.ok(t.length <= MAX_DISCORD, `largo ${t.length}`)
    assert.ok(t.startsWith(`<@${VALENTINO}> 🚀 **Para lanzar · `))
    assert.equal(t.split('\n').at(-1), `👉 [Ficha](<${BASE}/clientes/E157/kickoff>) · [Tablero de anuncios](<${BASE}/anuncios>)`)
    assert.match(t, /\+\d+/, 'lo que no entra queda como "+N"')
    for (const l of t.split('\n').filter(x => /^(⚖️|👤|📍|🧾)/.test(x))) assert.ok(!l.includes('…'), `sin cortes: ${l.slice(0, 60)}`)
    assert.ok(lineaDe(t, '🗺️').includes('⚠️ el mapa del video no muestra'), 'las diferencias del mapa se ven siempre')
  })
  test('un solo ítem enorme (300 caracteres) no rompe: se acorta en un límite de palabra y los links quedan', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.avatar.incluye = [{ ...f.avatar.incluye[0], texto: 'palabra '.repeat(260).trim() }]
    f.zona.descripcion = 'zona '.repeat(300).trim()
    f.zona.lugares = []
    const t = A.textoAvisoAds(filaEjemplo({ ficha: f }), CFG, AHORA)
    assert.ok(t.length <= MAX_DISCORD)
    assert.ok(t.endsWith(`[Tablero de anuncios](<${BASE}/anuncios>)`))
  })
})

// ── 2. La marca y cuándo está listo (puro) ──────────────────────────────────────────────────────────
describe('la marca aviso_ads y avisoAdsListo', () => {
  test('leerMarcaAds: NULL = ninguna; pendiente / enviando / dudoso / error con su hora; cualquier otro texto = salió', () => {
    assert.deepEqual(A.leerMarcaAds(null), { tipo: 'ninguna' })
    assert.deepEqual(A.leerMarcaAds('pendiente:123'), { tipo: 'pendiente', desde: 123 })
    assert.deepEqual(A.leerMarcaAds('enviando:5'), { tipo: 'enviando', desde: 5 })
    assert.deepEqual(A.leerMarcaAds('1300000000000000000'), { tipo: 'enviado', id: '1300000000000000000' })
    assert.deepEqual(A.leerMarcaAds('sin-id'), { tipo: 'enviado', id: 'sin-id' })
  })
  test('sin lectura del mapa guardada (no hubo mapa, o ficha de antes) → ya; terminada (ok, sin mapa, sin video, sin key, error definitivo) → ya; pedida, leyendo o con error pasajero → espera hasta el tope', () => {
    assert.deepEqual(A.avisoAdsListo({ zv: null, desde: AHORA, ahoraMs: AHORA }), { listo: true, por: 'sin_lectura' })
    for (const e of ['ok', 'sin_mapa', 'sin_video', 'sin_key']) {
      const zv = e === 'ok' ? zvOk() : zvMapa(e, 'tomas', '2026-10-24T14:30:00.000Z')
      assert.deepEqual(A.avisoAdsListo({ zv, desde: AHORA, ahoraMs: AHORA }), { listo: true, por: 'mapa_terminado' }, e)
    }
    assert.equal(A.avisoAdsListo({ zv: zvMapa('error', 'tomas', '', { transitorio: false }), desde: AHORA, ahoraMs: AHORA }).listo, true)
    for (const zv of [zvMapa('leyendo', 'tomas', ''), zvMapa('pedido', 'tomas', ''), zvMapa('error', 'tomas', '', { transitorio: true })]) {
      assert.deepEqual(A.avisoAdsListo({ zv, desde: AHORA, ahoraMs: AHORA + 60_000 }), { listo: false, por: 'esperando_mapa' })
      assert.deepEqual(A.avisoAdsListo({ zv, desde: AHORA, ahoraMs: AHORA + A.ESPERA_MAX_MAPA_MS }), { listo: true, por: 'espera_vencida' })
    }
  })
})

// ── 3. Mandarlo una sola vez (intentarAvisoAds con una base en memoria) ─────────────────────────────
/** Una "base" en memoria con UNA fila y las dependencias del aviso (las escrituras con condición, como registro.ts). */
function baseAds(fila0 = {}, over = {}) {
  const b = { fila: { ...filaEjemplo(), aviso_ads: `pendiente:${AHORA - 1000}`, ...fila0 }, envios: [], t: AHORA }
  const deps = {
    ...CFG,
    leer: async id => (id === b.fila.recording_id ? clonar(b.fila) : undefined),
    tomar: async (id, previo, marca) => {
      await null      // otro intento puede colarse entre la lectura y la escritura
      if (id !== b.fila.recording_id || b.fila.estado !== 'lista' || b.fila.aviso_ads !== previo) return null
      b.fila.aviso_ads = marca
      return clonar(b.fila)
    },
    anotar: async (id, valor, si) => (b.fila.aviso_ads === si ? ((b.fila.aviso_ads = valor), true) : false),
    pendiente: async (id, desde, op) => {
      const m = b.fila.aviso_ads
      const reciente = typeof m === 'string' && /^enviando:/.test(m) && Number(m.split(':')[1]) > op.ahoraMs - (op.recienteMs ?? 120_000)
      if (b.fila.estado !== 'lista' || !(m == null || m === '' || /^error:/.test(m) || (op.forzar && !reciente))) return false
      b.fila.aviso_ads = `pendiente:${desde}`
      return true
    },
    pendientes: async () => (/^pendiente:/.test(b.fila.aviso_ads ?? '') ? [b.fila.recording_id] : []),
    enviar: async (texto, menciones, deadline) => { b.envios.push({ texto, menciones, deadline }); return `msg_${b.envios.length}` },
    ahora: () => b.t,
    ...over,
  }
  return { b, deps }
}
const ID = FICHA_EJEMPLO.recording_id
const DEADLINE = AHORA + 60_000

describe('intentarAvisoAds: una sola vez por grabación', () => {
  test('pendiente y listo → sale UNA vez mencionando solo a Valentino; el id queda en la marca; otro intento → ya_salio', async () => {
    const { b, deps } = baseAds()
    const r = await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })
    assert.deepEqual([r.estado, r.aviso_id], ['enviado', 'msg_1'])
    assert.equal(b.envios.length, 1)
    assert.deepEqual(b.envios[0].menciones, [VALENTINO])
    assert.equal(b.envios[0].deadline, DEADLINE - A.RESERVA_ANOTAR_MS, 'deja tiempo para anotar cómo terminó')
    assert.ok(b.envios[0].texto.startsWith(`<@${VALENTINO}> 🚀`))
    assert.equal(b.fila.aviso_ads, 'msg_1')
    const otra = await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })
    assert.deepEqual([otra.estado, b.envios.length], ['ya_salio', 1])
  })
  test('dos a la vez (la ruta del mapa y el barrido) → sale una sola vez', async () => {
    const { b, deps } = baseAds()
    const rs = await Promise.all([A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true }), A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })])
    assert.deepEqual(rs.map(r => r.estado).sort(), ['en_curso', 'enviado'])
    assert.equal(b.envios.length, 1)
  })
  test('una fila de antes (la de Laura: sin marca) o que no está lista → no sale nada', async () => {
    let { b, deps } = baseAds({ aviso_ads: null })
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'no_corresponde')
    ;({ b, deps } = baseAds({ estado: 'procesando' }))
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'no_corresponde')
    assert.equal(b.envios.length, 0)
  })
  test('con la lectura del mapa en marcha espera (sin tomar nada); con listo (la lectura terminó) sale con la zona que se pasa', async () => {
    const { b, deps } = baseAds({ zona_video: { ...zvMapa('leyendo', 'tomas', new Date(AHORA).toISOString()), vence_ms: AHORA + 300_000 } })
    const r = await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE })
    assert.equal(r.estado, 'esperando_mapa')
    assert.match(b.fila.aviso_ads, /^pendiente:/, 'la marca no se toca')
    const ok = await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true, zv: zvOk() })
    assert.equal(ok.estado, 'enviado')
    assert.match(b.envios[0].texto, /✅ el mapa del video coincide con lo dicho/)
  })
  test('sin tiempo: no lo toma (queda pendiente para el barrido)', async () => {
    const { b, deps } = baseAds()
    const r = await A.intentarAvisoAds(ID, deps, { deadline: AHORA + 5_000, listo: true })
    assert.equal(r.estado, 'sin_tiempo')
    assert.match(b.fila.aviso_ads, /^pendiente:/)
    assert.equal(b.envios.length, 0)
  })
  test('Discord no responde → dudoso (no se repite solo); un 5xx → vuelve a pendiente y el próximo sale; un 404 → error', async () => {
    let { b, deps } = baseAds({}, { enviar: async () => { throw Object.assign(new Error('Discord no respondió en 15 s'), { transitorio: true }) } })
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'dudoso')
    assert.match(b.fila.aviso_ads, /^dudoso:/)
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'dudoso', 'no se repite solo')
    let falla = true
    ;({ b, deps } = baseAds({}, { enviar: async () => { if (falla) { falla = false; throw Object.assign(new Error('Discord respondió 503'), { transitorio: true }) } return 'msg_ok' } }))
    const previo = b.fila.aviso_ads
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'error')
    assert.equal(b.fila.aviso_ads, previo, 'vuelve a la marca pendiente de antes')
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'enviado')
    ;({ b, deps } = baseAds({}, { enviar: async () => { throw Object.assign(new Error('Discord respondió 404: Unknown Webhook'), { transitorio: false }) } }))
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'error')
    assert.match(b.fila.aviso_ads, /^error:/)
  })
  test('sin ID de Valentino: sin menciones (allowed_mentions vacío) y "Valentino" en texto', async () => {
    const { b, deps } = baseAds({}, { valentino: null })
    await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })
    assert.deepEqual(b.envios[0].menciones, [])
    assert.ok(b.envios[0].texto.startsWith('Valentino 🚀'))
  })
  test('la base no responde al leer: error, sin mandar, y la marca queda como estaba', async () => {
    const { b, deps } = baseAds({}, { leer: async () => { throw new Error('la base no respondió en 10 s (leer kickoff)') } })
    const r = await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })
    assert.equal(r.estado, 'error')
    assert.match(b.fila.aviso_ads, /^pendiente:/)
    assert.equal(b.envios.length, 0)
  })
})

describe('barrido y a mano', () => {
  test('barrerAvisosAds: manda las pendientes listas; una con la lectura en marcha espera; pasado el tope, sale igual (con "no terminó")', async () => {
    let { b, deps } = baseAds({ zona_video: zvOk() })
    assert.deepEqual((await A.barrerAvisosAds(deps, { deadline: DEADLINE })).map(x => x.ads.estado), ['enviado'])
    ;({ b, deps } = baseAds({ aviso_ads: `pendiente:${AHORA}`, zona_video: { ...zvMapa('leyendo', 'tomas', new Date(AHORA).toISOString()), vence_ms: AHORA + 360_000 } }))
    assert.deepEqual((await A.barrerAvisosAds(deps, { deadline: DEADLINE })).map(x => x.ads.estado), ['esperando_mapa'])
    b.t = AHORA + A.ESPERA_MAX_MAPA_MS
    assert.deepEqual((await A.barrerAvisosAds(deps, { deadline: b.t + 60_000 })).map(x => x.ads.estado), ['enviado'])
    assert.match(b.envios[0].texto, /la lectura del mapa del video no terminó: confirmar el recorte con Tomi/)
  })
  test('barrerAvisosAds: sin tiempo no toma nada; si la búsqueda falla, no lanza', async () => {
    const { b, deps } = baseAds()
    assert.deepEqual(await A.barrerAvisosAds(deps, { deadline: AHORA + 1_000 }), [])
    assert.equal(b.envios.length, 0)
    const { deps: d2 } = baseAds({}, { pendientes: async () => { throw new Error('la base no respondió') } })
    assert.deepEqual(await A.barrerAvisosAds(d2, { deadline: DEADLINE }), [])
  })
  test('a mano: aviso_ads=1 manda el que nunca salió (la ficha de Laura); otra vez → ya_salio; forzar lo vuelve a mandar; dry solo el texto', async () => {
    const { b, deps } = baseAds({ aviso_ads: null })
    const manual = (modo, dry = false) => A.avisoAdsManual(ID, modo, { dry, deps, leer: deps.leer, config: CFG, deadline: DEADLINE, ahora: () => AHORA })
    const seco = await manual('uno', true)
    assert.deepEqual([seco.estado, seco.marca, b.envios.length], ['dry', null, 0])
    assert.ok(seco.texto.startsWith(`<@${VALENTINO}> 🚀`) && seco.largo === seco.texto.length)
    assert.equal(b.fila.aviso_ads, null, 'dry no escribe')
    assert.equal((await manual('uno')).estado, 'enviado')
    assert.equal((await manual('uno')).estado, 'ya_salio')
    assert.equal(b.envios.length, 1)
    assert.equal((await manual('forzar')).estado, 'enviado')
    assert.equal(b.envios.length, 2)
  })
  test('a mano con forzar: no pisa un envío en curso de recién; apagado (sin canal) → "apagado" (con dry igual da el texto)', async () => {
    const { b, deps } = baseAds({ aviso_ads: `enviando:${AHORA - 10_000}` })
    const r = await A.avisoAdsManual(ID, 'forzar', { dry: false, deps, leer: deps.leer, config: CFG, deadline: DEADLINE })
    assert.equal(r.estado, 'en_curso')
    assert.equal(b.envios.length, 0)
    const apagado = await A.avisoAdsManual(ID, 'uno', { dry: false, deps: null, leer: deps.leer, config: CFG, deadline: DEADLINE })
    assert.equal(apagado.estado, 'apagado')
    assert.equal((await A.avisoAdsManual(ID, 'uno', { dry: true, deps: null, leer: deps.leer, config: CFG, deadline: DEADLINE })).estado, 'dry')
  })
})

// ── 4. procesarKickoff: cuándo sale ─────────────────────────────────────────────────────────────────
const renglones = (n, cada = 30) => Array.from({ length: n }, (_, i) => ({
  speaker: { display_name: i % 2 ? 'Tomas Napolitano' : 'Abogada Ana Pérez', matched_calendar_invitee_email: null }, text: `frase número ${i} de la llamada`, timestamp: hms(i * cada),
}))
const reunion = (over = {}) => ({
  title: 'ANA PEREZ y Tomas Napolitano', meeting_title: 'ANA PEREZ y Tomas Napolitano', recording_id: 987654321,
  url: 'https://fathom.video/calls/111', share_url: null,
  created_at: '2026-10-23T12:22:00Z', scheduled_start_time: '2026-10-23T12:00:00Z', scheduled_end_time: '2026-10-23T12:45:00Z',
  recording_start_time: '2026-10-23T12:00:00Z', recording_end_time: '2026-10-23T12:22:00Z',
  calendar_invitees_domains_type: 'one_or_more_external', transcript: renglones(40),
  default_summary: { template_name: 'General', markdown_formatted: '## Propósito\nArrancar con despidos laborales en Mendoza.' }, action_items: [],
  calendar_invitees: [{ name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: false }, { name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true }],
  recorded_by: { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', team: null },
  ...over,
})
const CONOCIDOS = [{ id: 'A101', nombre: 'Ana Pérez', estado: 'ACTIVO', email: 'ana@estudio.test', cuentas: ['act_999'] }]
const salidaClaude = (over = {}) => ({
  tipo_reunion: 'kickoff', resumen_corto: 'Kickoff con Ana: laboral en Mendoza',
  cliente: { nombre_escuchado: 'Ana Pérez', cliente_crm: 'Ana Pérez', id_crm: 'A101' },
  rama: { principal: 'laboral', texto: 'Laboral: despidos', cita: 'frase número 10 de la llamada', timestamp: '00:05:00', subramas: [{ texto: 'despidos', cita: '', timestamp: '00:06:00' }], descartadas: [], a_futuro: [] },
  avatar: { incluye: [{ texto: 'en blanco o parcialmente en blanco', cita: '', timestamp: '00:06:00' }], excluye: [{ texto: 'nada totalmente en negro', cita: '', timestamp: '' }] },
  zona: { descripcion: 'Mendoza capital y Godoy Cruz', lugares: ['Mendoza', 'Godoy Cruz'], radio_km: 20, presentarse_como: 'Mendoza capital', mapa_en_pantalla: true, cita: '', timestamp: '00:08:00' },
  presupuesto: { usd_dia_min: 10, usd_dia_max: 10, usd_mes: 300, moneda: 'USD', texto: 'USD 10 por día', deducido: false, certeza: 'confirmado', cita: 'frase número 18 de la llamada', timestamp: '00:09:00' },
  portfolio: [{ item: 'instagram', estado: 'ok', detalle: 'tiene cuenta', cita: '', timestamp: '00:10:00' }],
  acuerdos: [{ quien: 'Tomás', que: 'mandar los guiones', cuando: '~25/10, estimado', cita: '', timestamp: '00:12:00' }],
  pendientes: [],
  ...over,
})
const r0 = validarReunion(reunion()).reunion
const tr0 = formatearTranscripcion(r0.transcript)
const cx = () => ({ rango: { desde: tr0.desde, hasta: tr0.hasta }, transcripcionNorm: normTexto(tr0.texto), conocidos: CONOCIDOS, emailsInvitados: emailsExternos(r0) })
const extraccionDe = (over = {}) => validarSalida(salidaClaude(over), cx()).extraccion
const IDEAS_OK = Array.from({ length: 5 }, (_, i) => ({ titulo: `Idea secreta ${i + 1}`, gancho: `¿Te despidieron en Mendoza? ${i}`, angulo: 'liquidación', subrama: 'despidos', por_que: 'la base' }))
const lecturaMeta = () => ({
  cuenta: 'act_999', nombre: 'USD Estudio Ana', negocio: null, leido: true, motivo: null, aviso: null, datos: null, llamadas: 1, ms: 5, token: 'META_CLIENTES_TOKEN', generado: '2026-10-23T12:40:00Z',
  items: Object.fromEntries(ITEMS_PORTFOLIO.map(k => [k, { estado: 'ok', detalle: `${k}: ok en Meta`, fuente: 'meta', campo: 'act' }])),
  busqueda: { cuentas: [], origen: 'crm', aviso: null, avisos: [] }, moneda: 'USD', zona_horaria: 'America/Argentina/Mendoza',
})

/** procesarKickoff con fakes y una fila en memoria que comparten marcar y el aviso a Valentino. */
function fakesProceso(over = {}) {
  const log = { orden: [], marcar: [], disparar: [], adsEnvios: [] }
  const reloj = { t: AHORA }
  const fila = { recording_id: 987654321, estado: 'procesando', titulo: 'T', url: 'https://fathom.video/calls/111', cliente_crm: null, id_crm: null, error: null,
    // Una fila nueva entra con '' (reclamar); avisoPrevio: null = una fila de antes del aviso (la de Laura)
    ficha: null, ideas: null, revision: null, portfolio_checks: null, faltantes_checks: null, zona_video: null, aviso_ads: 'avisoPrevio' in over ? over.avisoPrevio : '', creado: '', actualizado: '' }
  const ads = {
    ...CFG, ahora: () => reloj.t,
    leer: async () => clonar(fila),
    tomar: async (id, previo, marca) => (fila.estado === 'lista' && fila.aviso_ads === previo ? ((fila.aviso_ads = marca), clonar(fila)) : null),
    anotar: async (id, v, si) => (fila.aviso_ads === si ? ((fila.aviso_ads = v), true) : false),
    pendiente: async () => false, pendientes: async () => [],
    enviar: async (texto, menciones) => { log.orden.push('ads'); log.adsEnvios.push({ texto, menciones }); return 'msg_ads' },
  }
  const deps = {
    reclamar: async () => { log.orden.push('reclamar'); return { intentos: 1, error_previo: null, ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null, grabador: null, zona_video: null } },
    gemela: async () => null,
    guardarFicha: async () => {}, guardarIdeas: async () => {}, anotarAviso: async () => {},
    marcar: async (id, m) => {
      log.orden.push(`marcar:${m.estado}`); log.marcar.push(m)
      fila.estado = m.estado
      if (m.ficha) { fila.ficha = m.ficha; fila.id_crm = m.ficha.cliente.id_crm; fila.cliente_crm = m.ficha.cliente.cliente_crm }
      // Como registro.marcar: solo una fila nueva sin aviso ('') o pendiente; la de antes (NULL) no se toca
      if (m.estado === 'lista' && typeof m.aviso_ads_desde === 'number' && (fila.aviso_ads === '' || fila.aviso_ads?.startsWith('pendiente:'))) fila.aviso_ads = `pendiente:${m.aviso_ads_desde}`
    },
    contexto: async () => ({ clientes: CONOCIDOS, estado: 'ok' }),
    extraer: async () => ({ extraccion: extraccionDe(over.salida ?? {}), ajustes: [], modelo: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } }),
    candidatos: async () => ({ rama: 'laboral', generado: '', ventana: { desde: '', hasta: '', dias: 180 }, cuentas: [], candidatos: [], erroresCuentas: 0, nota: '' }),
    portfolio: async () => lecturaMeta(), prepararPortfolio: () => {},
    kb: rama => kbDeRama(rama),
    ideas: async () => ({ ideas: IDEAS_OK, notas: '', ajustes: [], modelo: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } }),
    enviar: async () => { log.orden.push('enviar'); return 'msg1' },
    avisar: async () => {},
    esperar: async ms => { reloj.t += ms },
    ahora: () => (reloj.t += 1),
    menciones: { tomi: TOMI, gero_m: GERO }, tomas: TOMI, urlBase: BASE, discordListo: true,
    hayApiKey: () => true,
    pedirVideo: async () => ({ ok: true, download_id: 'dl_1', status: 'processing' }),
    guardarZonaVideo: async (id, zv) => { fila.zona_video = zv; return true },
    dispararMapa: async datos => { log.orden.push('dispararMapa'); log.disparar.push(datos) },
    avisoAds: ads,
    valentino: VALENTINO,
    ...over,
  }
  for (const k of ['salida', 'avisoPrevio']) delete deps[k]
  return { deps, log, fila }
}

describe('procesarKickoff: cuándo sale el aviso a Valentino', () => {
  test('sin mapa en pantalla: la marca "pendiente" va en el mismo UPDATE de "lista" y el aviso sale enseguida, después del de #📝-kickoff', async () => {
    const { deps, log, fila } = fakesProceso({ salida: { zona: { ...salidaClaude().zona, mapa_en_pantalla: false } } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual([r.ads.estado, r.ads.aviso_id], ['enviado', 'msg_ads'])
    assert.equal(typeof log.marcar.at(-1).aviso_ads_desde, 'number')
    assert.deepEqual(log.orden.filter(x => ['enviar', 'marcar:lista', 'ads'].includes(x)), ['enviar', 'marcar:lista', 'ads'])
    assert.equal(fila.aviso_ads, 'msg_ads')
    assert.deepEqual(log.adsEnvios[0].menciones, [VALENTINO])
    const t = log.adsEnvios[0].texto
    assert.ok(t.startsWith(`<@${VALENTINO}> 🚀 **Para lanzar · Ana Pérez**`))
    assert.ok(!t.includes('Idea secreta') && !t.includes('¿Te despidieron'), 'sin ideas')
    assert.match(t, /`act_999` \(«USD Estudio Ana»\)/)
  })
  test('con mapa y la lectura aceptada por la ruta: queda esperando (la manda la ruta al terminar); no sale acá', async () => {
    const { deps, log, fila } = fakesProceso()
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.mapa.estado, 'disparado')
    assert.equal(r.ads.estado, 'esperando_mapa')
    assert.equal(log.adsEnvios.length, 0)
    assert.match(fila.aviso_ads, /^pendiente:\d+$/, 'quedó pendiente ANTES del disparo (la ruta la encuentra aunque termine enseguida)')
    assert.ok(log.orden.indexOf('marcar:lista') < log.orden.indexOf('dispararMapa'))
  })
  test('el disparo no respondió a tiempo (puede haberla aceptado): espera; la ruta no la aceptó o no se pudo conectar: sale ya', async () => {
    let { deps, log } = fakesProceso({ dispararMapa: async () => { throw new Error('la ruta del mapa no respondió en 8 s') } })
    assert.equal((await procesarKickoff(reunion(), deps)).ads.estado, 'esperando_mapa')
    assert.equal(log.adsEnvios.length, 0)
    ;({ deps, log } = fakesProceso({ dispararMapa: async () => { throw new Error('no se pudo conectar con la ruta del mapa') } }))
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.ads.estado, 'enviado')
    assert.match(log.adsEnvios[0].texto, /no se pudo leer el mapa del video: confirmar el recorte con Tomi/)
  })
  test('sin la API key de Fathom (no se lee el mapa): sale enseguida, diciendo que el recorte lo confirma Tomi', async () => {
    const { deps, log } = fakesProceso({ hayApiKey: () => false })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.mapa.plan, 'sin_key')
    assert.equal(r.ads.estado, 'enviado')
    assert.match(log.adsEnvios[0].texto, /no se pudo leer el mapa del video: confirmar el recorte con Tomi/)
    assert.ok(!/API key/.test(log.adsEnvios[0].texto))
  })
  test('retomar o forzar el kickoff con el aviso ya salido: no se repite', async () => {
    const { deps, log, fila } = fakesProceso({ avisoPrevio: '1300000000000000001', salida: { zona: { ...salidaClaude().zona, mapa_en_pantalla: false } } })
    const r = await procesarKickoff(reunion(), deps, { forzar: true })
    assert.equal(r.ads.estado, 'ya_salio')
    assert.equal(log.adsEnvios.length, 0)
    assert.equal(fila.aviso_ads, '1300000000000000001')
  })
  test('dry: no marca ni manda nada y devuelve el texto (mensaje_ads)', async () => {
    const { deps, log } = fakesProceso()
    const r = await procesarKickoff(reunion(), deps, { dry: true })
    assert.equal(r.estado, 'dry')
    assert.ok(r.mensaje_ads.startsWith(`<@${VALENTINO}> 🚀 **Para lanzar · Ana Pérez**`))
    assert.ok(r.mensaje_ads.length <= MAX_DISCORD)
    assert.deepEqual([log.marcar.length, log.adsEnvios.length], [0, 0])
    assert.equal(r.ads, undefined)
  })
  test('no es un kickoff o la misma reunión ya llegó: nada del aviso; apagado (sin avisoAds): ni la marca', async () => {
    let { deps, log } = fakesProceso({ salida: { tipo_reunion: 'seguimiento' } })
    let r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'no_kickoff')
    assert.deepEqual([r.ads, log.adsEnvios.length, log.marcar.at(-1).aviso_ads_desde], [undefined, 0, undefined])
    ;({ deps, log } = fakesProceso({ gemela: async () => ({ recording_id: 5, estado: 'lista', grabador: 'gero_m', por: 'invitado' }) }))
    r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'duplicada')
    assert.equal(log.adsEnvios.length, 0)
    ;({ deps, log } = fakesProceso({ avisoAds: null, salida: { zona: { ...salidaClaude().zona, mapa_en_pantalla: false } } }))
    r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual([r.ads, log.marcar.at(-1).aviso_ads_desde], [undefined, undefined])
  })
})

// ── 5. La ruta del mapa: lo manda cuando la lectura termina (en cualquier estado final) ───────────────
describe('ruta del mapa: el aviso a Valentino al terminar la lectura', () => {
  const resultado = (over = {}) => ({
    estado: 'ok', version: M.VERSION_MAPA, momentos: [1028, 1038], cuadros: { pedidos: 2, sacados: 2, fallas: [] },
    tiempos: { total_ms: 10, video_ms: 5, cuadros_ms: 2, claude_ms: 3 }, tokens: { input_tokens: 100, output_tokens: 10, costo_usd: 0.001 }, modelo: 'claude-opus-5-5', ajustes: [],
    video: { download_id: 'dl_nuevo', pedidos: 0, content_type: 'video/mp4', file_size_bytes: 1, expires_at: null },
    zona: { ...clonar(FICHA_EJEMPLO).zona, mapa: M.combinarZonaConMapa(zonaDicha(), mapaLeido()).mapa },
    ...over,
  })
  function depsRuta(over = {}) {
    const log = { fondo: [], ads: [], redisparo: [] }
    const deps = {
      autorizado: r => r.headers.get('authorization') === 'Bearer ok',
      baseConfigurada: () => true,
      leerKickoff: async () => ({ ficha: clonar(FICHA_EJEMPLO), zona_video: null, grabador: 'tomas' }),
      guardarZonaVideo: async () => true,
      zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined, video: undefined }) : resultado()),
      enSegundoPlano: fn => { log.fondo.push(fn) },
      ahora: () => AHORA,
      redisparar: async datos => { log.redisparo.push(datos) },
      avisarAds: async (id, zv, deadline) => { log.ads.push({ id, zv, deadline }) },
      ...over,
    }
    return { deps, log }
  }
  const pedir = (deps, cuerpo) => atenderMapa(new Request('https://despacho.test/api/bot/kickoff/mapa', { method: 'POST', headers: { authorization: 'Bearer ok', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }), deps)
  const correrFondo = async log => { for (let i = 0; i < log.fondo.length; i++) await log.fondo[i]() }

  test('lectura ok → al terminar, el aviso con la zona leída (dentro de los 300 s de la invocación)', async () => {
    const { deps, log } = depsRuta()
    assert.equal((await pedir(deps, { recording_id: ID })).status, 202)
    await correrFondo(log)
    assert.equal(log.ads.length, 1)
    assert.deepEqual([log.ads[0].id, log.ads[0].zv.estado, log.ads[0].deadline], [ID, 'ok', AHORA + 293_000])
  })
  test('sin mapa, sin video o con error (sin reintento): sale igual; con el reintento solo en camino, NO (lo manda el reintento)', async () => {
    for (const estado of ['sin_mapa', 'sin_video']) {
      const { deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : resultado({ estado, zona: undefined, video: undefined })) })
      await pedir(deps, { recording_id: ID })
      await correrFondo(log)
      assert.deepEqual(log.ads.map(x => x.zv.estado), [estado])
    }
    const pasajero = resultado({ estado: 'error', transitorio: true, motivo: 'video de Fathom: tardó más de 4 minutos', zona: undefined, video: { download_id: 'dl_9', pedidos: 1, content_type: null, file_size_bytes: null, expires_at: null } })
    let { deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : pasajero) })
    await pedir(deps, { recording_id: ID })
    await correrFondo(log)
    assert.equal(log.redisparo.length, 1)
    assert.equal(log.ads.length, 0, 'el reintento lo manda al terminar')
    // El reintento (que no se vuelve a reintentar) sí lo manda, con el error
    ;({ deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : pasajero) }))
    await pedir(deps, { recording_id: ID, reintento: true })
    await correrFondo(log)
    assert.deepEqual(log.ads.map(x => x.zv.estado), ['error'])
    // Si el reintento no se pudo disparar, sale ya
    ;({ deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : pasajero), redisparar: async () => { throw new Error('no se pudo conectar') } }))
    await pedir(deps, { recording_id: ID })
    await correrFondo(log)
    assert.equal(log.ads.length, 1)
  })
  test('la verificación corta la lectura (sin key, sin ffmpeg): queda anotado y el aviso sale con eso; ya leído → sale; dry y 409 → no', async () => {
    let { deps, log } = depsRuta({ zonaDesdeVideo: async () => resultado({ estado: 'sin_key', motivo: 'falta FATHOM_API_KEY_TOMAS', zona: undefined, video: undefined }) })
    assert.equal((await pedir(deps, { recording_id: ID })).status, 503)
    await correrFondo(log)
    assert.deepEqual(log.ads.map(x => x.zv.estado), ['sin_key'])
    ;({ deps, log } = depsRuta({ leerKickoff: async () => ({ ficha: clonar(FICHA_EJEMPLO), zona_video: zvOk(), grabador: 'tomas' }) }))
    assert.equal((await (await pedir(deps, { recording_id: ID })).json()).estado, 'ya_leido')
    await correrFondo(log)
    assert.deepEqual(log.ads.map(x => x.zv.estado), ['ok'])
    ;({ deps, log } = depsRuta())
    await pedir(deps, { recording_id: ID, dry: true })
    await correrFondo(log)
    assert.equal(log.ads.length, 0)
    ;({ deps, log } = depsRuta({ guardarZonaVideo: async () => false }))
    assert.equal((await pedir(deps, { recording_id: ID })).status, 409)
    await correrFondo(log)
    assert.equal(log.ads.length, 0)
  })
  test('si el aviso falla, la lectura igual queda guardada y no rompe', async () => {
    const guardado = []
    const { deps, log } = depsRuta({ guardarZonaVideo: async (id, zv) => { guardado.push(zv.estado); return true }, avisarAds: async () => { throw new Error('Discord no respondió') } })
    await pedir(deps, { recording_id: ID })
    await correrFondo(log)
    assert.deepEqual(guardado, ['leyendo', 'ok'])
  })
})

// ── 6. Canal, mención e interruptor (entorno.ts y las dependencias reales, con fetch falso) ─────────────
describe('canal, mención e interruptor', () => {
  // Prendido (KICKOFF_AVISO_ADS=1) para probar el canal y el envío: desde el 26/10 viene apagado (ver el test del interruptor)
  const limpiar = () => { for (const k of ['DISCORD_WEBHOOK_KICKOFF_ADS', 'DISCORD_WEBHOOK_ANUNCIOS', 'DISCORD_ID_VALENTINO', 'KICKOFF_AVISO_ADS']) delete process.env[k]; process.env.KICKOFF_AVISO_ADS = '1' }
  beforeEach(limpiar)
  test('canal: DISCORD_WEBHOOK_KICKOFF_ADS o, si no, DISCORD_WEBHOOK_ANUNCIOS; sin ninguno, sin dependencias (no sale nada)', () => {
    assert.equal(E.webhookKickoffAds(), '')
    assert.equal(A.depsAvisoAdsReales(), null)
    process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/anuncios'
    assert.equal(E.webhookKickoffAds(), 'https://discord.test/api/webhooks/1/anuncios')
    assert.equal(E.varCanalAds(), 'DISCORD_WEBHOOK_ANUNCIOS')
    process.env.DISCORD_WEBHOOK_KICKOFF_ADS = 'https://discord.test/api/webhooks/2/propio'
    assert.equal(E.webhookKickoffAds(), 'https://discord.test/api/webhooks/2/propio')
    assert.equal(E.varCanalAds(), 'DISCORD_WEBHOOK_KICKOFF_ADS')
    assert.ok(A.depsAvisoAdsReales())
    limpiar()
  })
  test('apagado por defecto desde el 26/10 (sale con los videos editados, g01): solo KICKOFF_AVISO_ADS=1 lo prende', () => {
    delete process.env.KICKOFF_AVISO_ADS
    process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/anuncios'
    assert.equal(E.avisoAdsEncendido(), false)
    assert.equal(A.depsAvisoAdsReales(), null)
    process.env.KICKOFF_AVISO_ADS = '0'
    assert.equal(E.avisoAdsEncendido(), false)
    process.env.KICKOFF_AVISO_ADS = 'si'
    assert.equal(E.avisoAdsEncendido(), false)
    process.env.KICKOFF_AVISO_ADS = '1'
    assert.equal(E.avisoAdsEncendido(), true)
    assert.ok(A.depsAvisoAdsReales())
    limpiar()
  })
  test('el envío real: al webhook de #📣-ads con ?wait=true y allowed_mentions SOLO con Valentino (fetch falso, sin Discord)', async () => {
    process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/anuncios'
    process.env.DISCORD_ID_VALENTINO = VALENTINO
    const pedidos = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => { pedidos.push({ url: String(url), cuerpo: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: '1300000000000000009' }), { status: 200 }) }
    try {
      const d = A.depsAvisoAdsReales()
      assert.equal(d.valentino, VALENTINO)
      assert.equal(await d.enviar('<@366996417782218754> 🚀 hola @everyone', [VALENTINO], Date.now() + 20_000), '1300000000000000009')
      assert.equal(pedidos[0].url, 'https://discord.test/api/webhooks/1/anuncios?wait=true')
      assert.deepEqual(pedidos[0].cuerpo.allowed_mentions, { parse: [], users: [VALENTINO] })
      assert.equal(pedidos[0].cuerpo.flags, 4)
      // Sin ID (o uno que no es de Discord): sin mención
      process.env.DISCORD_ID_VALENTINO = 'valentino'
      assert.equal(A.depsAvisoAdsReales().valentino, null)
    } finally {
      globalThis.fetch = original
      limpiar()
    }
  })
})

// ── 7. El SQL contra un Neon falso ──────────────────────────────────────────────────────────────────
describe('registro: la columna aviso_ads (aditiva) y las escrituras con condición', () => {
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    return { consultas, fabrica: () => q }
  }
  beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
  const limpiar = () => { registro.sqlParaPruebas(null); delete process.env.DATABASE_URL }

  test('marcar lista con aviso_ads_desde: la marca pendiente en el mismo UPDATE, solo en una fila nueva sin aviso (\'\') o pendiente; la de antes (NULL) no se toca', async () => {
    try {
      const n = neonFalso(() => [])
      registro.sqlParaPruebas(n.fabrica)
      await registro.marcar(9, { estado: 'lista', ficha: { x: 1 }, aviso_ads_desde: 1234 })
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /aviso_ads = CASE WHEN \$(\d+)::bigint IS NOT NULL AND \(aviso_ads = '' OR aviso_ads LIKE 'pendiente:%'\) THEN 'pendiente:' \|\| \$(\d+)::bigint ELSE aviso_ads END/)
      assert.ok(u.valores.includes(1234))
      await registro.marcar(9, { estado: 'error', error: 'x', aviso_ads_desde: 99 })
      const e = n.consultas.filter(c => c.texto.startsWith('UPDATE')).at(-1)
      assert.ok(!e.valores.includes(99), 'solo con lista')
      // La migración suma la columna, solo aditiva
      assert.ok(n.consultas.some(c => c.texto === 'ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS aviso_ads text'))
      assert.ok(!n.consultas.some(c => /DROP|ALTER COLUMN|RENAME|SET DEFAULT/.test(c.texto)))
    } finally { limpiar() }
  })
  test('tomarAvisoAds: solo una ficha lista y con la MISMA marca que se leyó; devuelve lo de la pantalla; una marca rara no consulta', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('UPDATE') ? [{ recording_id: '9', estado: 'lista', titulo: 'T', url: 'u', ficha: {}, aviso_ads: 'enviando:5', creado: new Date(0), actualizado: new Date(0) }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const f = await registro.tomarAvisoAds(9, 'pendiente:1', 'enviando:5')
      assert.deepEqual([f.recording_id, f.aviso_ads], [9, 'enviando:5'])
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /^UPDATE cj_kickoffs SET aviso_ads = \$1 WHERE recording_id = \$2 AND estado = 'lista' AND aviso_ads = \$3 RETURNING .*portfolio_checks, faltantes_checks, zona_video, aviso_ads, creado, actualizado$/)
      assert.deepEqual(u.valores, ['enviando:5', 9, 'pendiente:1'])
      const antes = n.consultas.length
      assert.equal(await registro.tomarAvisoAds(9, '1300', 'enviando:5'), null)
      assert.equal(n.consultas.length, antes)
    } finally { limpiar() }
  })
  test('ponerAvisoAdsPendiente: sin forzar, solo desde NULL, \'\' o error; con forzar, sobre todo menos un envío de recién; anotar con condición', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('UPDATE') ? [{ recording_id: 9 }] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.equal(await registro.ponerAvisoAdsPendiente(9, 5000, { forzar: true, ahoraMs: 5000 }), true)
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /WHERE recording_id = \$2 AND estado = 'lista' AND \(aviso_ads IS NULL OR aviso_ads = '' OR aviso_ads LIKE 'error:%' OR \(\$3::boolean AND NOT \(CASE WHEN aviso_ads ~ '\^enviando:\[0-9\]\{1,15\}\$' THEN split_part\(aviso_ads, ':', 2\)::bigint ELSE 0 END > \$4\)\)\)/)
      assert.deepEqual(u.valores, [5000, 9, true, 5000 - 120_000])
      assert.equal(await registro.anotarAvisoAds(9, '1300000000000000001', 'enviando:5'), true)
      const a = n.consultas.filter(c => c.texto.startsWith('UPDATE')).at(-1)
      assert.match(a.texto, /^UPDATE cj_kickoffs SET aviso_ads = \$1 WHERE recording_id = \$2 AND aviso_ads = \$3 RETURNING recording_id$/)
    } finally { limpiar() }
  })
  test('pendientesAvisoAds y las lecturas: por to_jsonb (andan sin la columna), sin crear nada, con el cast protegido', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('SELECT recording_id FROM') ? [{ recording_id: '9' }, { recording_id: 'x' }] : t.includes('FROM cj_kickoffs WHERE recording_id') ? [{ recording_id: '9', estado: 'lista', aviso_ads: 'pendiente:1', creado: new Date(0), actualizado: new Date(0) }] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.deepEqual(await registro.pendientesAvisoAds(50, 777), [9])
      const s = n.consultas.find(c => c.texto.startsWith('SELECT recording_id FROM'))
      assert.match(s.texto, /WHERE estado = 'lista' AND COALESCE\(to_jsonb\(cj_kickoffs\) ->> 'aviso_ads', ''\) ~ '\^pendiente:\[0-9\]\{1,15\}\$' AND CASE WHEN .* THEN split_part\(to_jsonb\(cj_kickoffs\) ->> 'aviso_ads', ':', 2\)::bigint ELSE 0 END >= \$1 ORDER BY actualizado LIMIT \$2$/)
      assert.deepEqual(s.valores, [777, 10])
      assert.equal((await registro.leerKickoff(9)).aviso_ads, 'pendiente:1')
      assert.ok(n.consultas.some(c => /to_jsonb\(cj_kickoffs\) ->> 'aviso_ads' AS aviso_ads/.test(c.texto)))
      assert.ok(!n.consultas.some(c => /CREATE|ALTER/.test(c.texto)), 'las lecturas no crean nada')
    } finally { limpiar() }
  })
})

// ── 8. La ruta /api/bot/kickoff: el modo manual aviso_ads y el GET de estado (sin base ni Discord) ─────────
describe('app/api/bot/kickoff: aviso_ads a mano y el estado', async () => {
  const { GET, POST } = await import('../app/api/bot/kickoff/route.ts')
  const URL_RUTA = 'http://localhost:3101/api/bot/kickoff'
  const CRON = 'cron-de-prueba-ads-1234567890'
  const post = qs => POST(new Request(URL_RUTA + qs, { method: 'POST', headers: { authorization: `Bearer ${CRON}` } }))
  beforeEach(() => { process.env.CRON_SECRET = CRON; delete process.env.DATABASE_URL; for (const k of ['DISCORD_WEBHOOK_KICKOFF_ADS', 'DISCORD_WEBHOOK_ANUNCIOS', 'DISCORD_ID_VALENTINO', 'KICKOFF_AVISO_ADS']) delete process.env[k] })

  test('aviso_ads: valor raro o sin recording_id → 400; sin base → 503 (no se llega a nada)', async () => {
    assert.equal((await post('?recording_id=1&aviso_ads=2')).status, 400)
    assert.equal((await post('?aviso_ads=1')).status, 400)
    const r = await post('?recording_id=1&aviso_ads=forzar')
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'falta DATABASE_URL' })
  })
  test('GET: con canal, el bloque aviso_ads con el NOMBRE de la variable y si el webhook existe (un GET que no publica; nunca la URL ni el token); sin canal, no aparece', async () => {
    const pedir = async () => (await GET(new Request(URL_RUTA, { headers: { authorization: `Bearer ${CRON}` } }))).json()
    assert.equal((await pedir()).aviso_ads, undefined)
    process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/secreto-del-canal'
    process.env.DISCORD_ID_VALENTINO = VALENTINO
    process.env.KICKOFF_AVISO_ADS = '0'
    const original = globalThis.fetch
    const pedidos = []
    try {
      // El webhook se borró o se regeneró: 404 → canal_ok false (cada aviso terminaría rechazado)
      globalThis.fetch = async (url, init) => { pedidos.push({ url: String(url), metodo: init?.method }); return new Response('{"message": "Unknown Webhook"}', { status: 404 }) }
      const j = await pedir()
      assert.deepEqual(j.aviso_ads, { encendido: false, canal: 'DISCORD_WEBHOOK_ANUNCIOS', canal_ok: false, canal_motivo: 'Discord respondió 404: el webhook no existe (se borró o se regeneró)', valentino: true })
      assert.deepEqual(pedidos, [{ url: 'https://discord.test/api/webhooks/1/secreto-del-canal', metodo: 'GET' }], 'un GET al webhook: no publica nada')
      assert.ok(!JSON.stringify(j).includes('secreto-del-canal'))
      // Existe: Discord devuelve los datos del webhook (con su token): ni el token ni la URL van en la respuesta
      globalThis.fetch = async () => new Response(JSON.stringify({ id: '1', channel_id: '2', token: 'secreto-del-canal', name: 'ads' }), { status: 200 })
      const k = await pedir()
      assert.equal(k.aviso_ads.canal_ok, true)
      assert.ok(!JSON.stringify(k).includes('secreto-del-canal'))
      // Sin red: no se pudo comprobar (null), sin romper el estado
      globalThis.fetch = async () => { throw new TypeError('fetch failed') }
      assert.equal((await pedir()).aviso_ads.canal_ok, null)
    } finally {
      globalThis.fetch = original
    }
  })
})

// ── 9. Revisión del 24/10 (noche): fallas que avisan a Tomás, la zona para segmentar, WhatsApp, marcas viejas y tiempos ──
const V = await import('../lib/bot/kickoff/vista.ts')
const P = await import('../lib/bot/kickoff/procesar.ts')
const SIN_MAPA = { zona: { ...salidaClaude().zona, mapa_en_pantalla: false } }

describe('si el aviso falla para siempre, UN aviso corto a Tomás en #📝-kickoff (nunca en el modo manual)', () => {
  const conTomas = (over = {}) => {
    const avisos = []
    const r = baseAds({}, { avisarTomas: async (texto, deadline) => { avisos.push({ texto, deadline }) }, tomas: TOMI, ...over })
    return { ...r, avisos }
  }
  const rechazo = () => { throw Object.assign(new Error('Discord respondió 404: Unknown Webhook'), { transitorio: false }) }
  test('Discord lo rechaza (el webhook se borró o se regeneró): error, no se repite solo y a Tomás le llega UNA vez con cómo reintentarlo', async () => {
    const { b, deps, avisos } = conTomas({ enviar: async () => rechazo() })
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'error')
    assert.match(b.fila.aviso_ads, /^error:/)
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'error', 'la marca error no se repite sola')
    assert.equal((await A.barrerAvisosAds(deps, { deadline: DEADLINE })).length, 0, 'ni el barrido')
    assert.equal(avisos.length, 1)
    assert.ok(avisos[0].texto.startsWith(`<@${TOMI}> ⚠️ No salió el aviso a Valentino «🚀 Para lanzar» de «Clienta Ejemplo`), avisos[0].texto)
    assert.match(avisos[0].texto, new RegExp(`\\(grabación ${ID}\\): Discord lo rechazó .*webhook de #📣-ads se borró o se regeneró.*recording_id=${ID}&aviso_ads=1\\)`))
    assert.equal(avisos[0].deadline, DEADLINE)
  })
  test('Discord no confirma (timeout) o se corta la conexión a mitad (ECONNRESET): dudoso, no se repite solo, y a Tomás le llega con forzar', async () => {
    for (const m of ['Discord no respondió en 15 s', 'no se pudo conectar con Discord (TypeError)']) {
      const { b, deps, avisos } = conTomas({ enviar: async () => { throw Object.assign(new Error(m), { transitorio: true }) } })
      assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })).estado, 'dudoso', m)
      assert.match(b.fila.aviso_ads, /^dudoso:/, 'pudo haber publicado: no vuelve a pendiente')
      assert.equal((await A.barrerAvisosAds(deps, { deadline: DEADLINE })).length, 0, 'el barrido no lo repite')
      assert.equal(avisos.length, 1)
      assert.match(avisos[0].texto, /puede haber salido\. Fijate en #📣-ads/)
      assert.match(avisos[0].texto, /aviso_ads=forzar/)
    }
  })
  test('un error pasajero que seguro no publicó (503): vuelve a pendiente y NO se le avisa a Tomás (lo manda el barrido)', async () => {
    const { b, deps, avisos } = conTomas({ enviar: async () => { throw Object.assign(new Error('Discord respondió 503'), { transitorio: true }) } })
    const previo = b.fila.aviso_ads
    await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })
    assert.deepEqual([b.fila.aviso_ads, avisos.length], [previo, 0])
  })
  test('a mano no avisa por Discord (la respuesta ya lo dice); si el aviso a Tomás falla, no rompe', async () => {
    const { deps, avisos } = conTomas({ enviar: async () => rechazo() })
    const r = await A.avisoAdsManual(ID, 'forzar', { dry: false, deps, leer: deps.leer, config: CFG, deadline: DEADLINE })
    assert.deepEqual([r.estado, avisos.length], ['error', 0])
    const { deps: d2 } = conTomas({ enviar: async () => rechazo(), avisarTomas: async () => { throw new Error('Discord no respondió en 15 s') } })
    assert.equal((await A.intentarAvisoAds(ID, d2, { deadline: DEADLINE, listo: true })).estado, 'error')
  })
  test('armar el texto lanza (una ficha rara) con la marca ya tomada: queda en error (no "enviando" para siempre) y se le avisa a Tomás', async () => {
    const { b, deps, avisos } = conTomas()
    const tomar = deps.tomar
    deps.tomar = async (...a) => { const f = await tomar(...a); return f && { ...f, get ficha() { throw new Error('ficha rara') } } }
    const r = await A.intentarAvisoAds(ID, deps, { deadline: DEADLINE, listo: true })
    assert.equal(r.estado, 'no_corresponde')
    assert.match(b.fila.aviso_ads, /^error:/)
    assert.equal(b.envios.length, 0)
    assert.equal(avisos.length, 1)
    assert.match(avisos[0].texto, /la ficha guardada no se puede leer/)
  })
  test('textoFallaAvisoAds: el cliente escapado, sin menciones de más, hasta 2000 caracteres', () => {
    const t = A.textoFallaAvisoAds({ id: 5, cliente: '**Ana** @everyone', falla: 'rechazado', motivo: 'x'.repeat(3000), tomas: null })
    assert.ok(t.startsWith('⚠️ No salió el aviso a Valentino «🚀 Para lanzar» de «\\*\\*Ana\\*\\*'))
    assert.ok(!t.includes('@everyone') && !t.includes('<@'))
    assert.ok(t.length <= MAX_DISCORD)
  })
  test('las dependencias reales: el aviso a Tomás va por DISCORD_WEBHOOK_KICKOFF mencionándolo solo a él; sin ese canal, no hay', async () => {
    const vars = ['DISCORD_WEBHOOK_KICKOFF_ADS', 'DISCORD_WEBHOOK_ANUNCIOS', 'DISCORD_WEBHOOK_KICKOFF', 'DISCORD_ID_TOMAS', 'KICKOFF_AVISO_ADS']
    const limpiar = () => { for (const k of vars) delete process.env[k] }
    limpiar()
    process.env.KICKOFF_AVISO_ADS = '1'
    process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/anuncios'
    assert.equal(A.depsAvisoAdsReales().avisarTomas, undefined)
    process.env.DISCORD_WEBHOOK_KICKOFF = 'https://discord.test/api/webhooks/3/kickoff'
    process.env.DISCORD_ID_TOMAS = TOMI
    const pedidos = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => { pedidos.push({ url: String(url), cuerpo: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: '9' }), { status: 200 }) }
    try {
      const d = A.depsAvisoAdsReales()
      assert.equal(d.tomas, TOMI)
      await d.avisarTomas('aviso de prueba', Date.now() + 20_000)
      assert.equal(pedidos[0].url, 'https://discord.test/api/webhooks/3/kickoff?wait=true')
      assert.deepEqual(pedidos[0].cuerpo.allowed_mentions, { parse: [], users: [TOMI] })
    } finally {
      globalThis.fetch = original
      limpiar()
    }
  })
})

describe('el GET de estado: si el canal existe y qué avisos hay que revisar', () => {
  test('comprobarCanalAds: 200 → existe; 401/403/404 → no (se borró o se regeneró); 5xx, 429 o sin red → no se sabe; nunca devuelve lo que contesta Discord', async () => {
    const con = (status, cuerpo = '{}') => ({ fetch: async () => new Response(cuerpo, { status }) })
    assert.deepEqual(await A.comprobarCanalAds('https://discord.test/api/webhooks/1/x', con(200, '{"token":"secreto"}')), { ok: true })
    for (const s of [401, 403, 404]) assert.equal((await A.comprobarCanalAds('https://discord.test/w', con(s))).ok, false, String(s))
    for (const s of [500, 429]) assert.equal((await A.comprobarCanalAds('https://discord.test/w', con(s))).ok, null, String(s))
    assert.deepEqual(await A.comprobarCanalAds('https://discord.test/w', { fetch: async () => { throw new TypeError('fetch failed') } }), { ok: null, motivo: 'no se pudo conectar con Discord' })
    assert.equal((await A.comprobarCanalAds('')).ok, false)
  })
  test('revisarAvisosAds: rechazados, dudosos, colgados a mitad y pendientes viejos, con cómo reintentarlos; lo que anda, no', () => {
    const filas = [
      { recording_id: 1, aviso_ads: `error:${AHORA - 1000}` },
      { recording_id: 2, aviso_ads: `dudoso:${AHORA - 1000}` },
      { recording_id: 3, aviso_ads: `enviando:${AHORA - A.ENVIO_RECIENTE_MS - 1}` },
      { recording_id: 4, aviso_ads: `enviando:${AHORA - 1000}` },
      { recording_id: 5, aviso_ads: `pendiente:${AHORA - A.PENDIENTE_VIEJO_MS - 1}` },
      { recording_id: 6, aviso_ads: `pendiente:${AHORA - 60_000}` },
      { recording_id: 7, aviso_ads: '1300000000000000001' },
      { recording_id: 8, aviso_ads: null },
      { recording_id: 9, aviso_ads: '' },
    ]
    assert.deepEqual(A.revisarAvisosAds(filas, AHORA).map(x => [x.recording_id, x.que, x.reintentar]), [
      [1, 'rechazado', '&aviso_ads=1'], [2, 'dudoso', '&aviso_ads=forzar'], [3, 'colgado', '&aviso_ads=forzar'], [5, 'pendiente_viejo', '&aviso_ads=1'],
    ])
  })
})

describe('la zona para segmentar: provincia y país, el "desde… hasta…" tal como se dijo y la distancia al estudio', () => {
  test('regionDeZona: "Provincia de X" donde esté, o lo de antes de ":" si es una provincia; si no se dijo, null (no se inventa)', () => {
    assert.equal(A.regionDeZona('Provincia de San Juan: zona marcada desde A hasta B'), 'Provincia de San Juan')
    assert.equal(A.regionDeZona('Zona marcada en el mapa en la provincia de La Pampa: Colonia Ejemplo'), 'Provincia de La Pampa')
    assert.equal(A.regionDeZona('en la provincia del Chaco, sobre la ruta'), 'Provincia del Chaco')
    assert.equal(A.regionDeZona('Mendoza: Godoy Cruz y Guaymallén'), 'Mendoza')
    assert.equal(A.regionDeZona('Mendoza capital y Godoy Cruz'), null, 'la ciudad no es la provincia')
    assert.equal(A.regionDeZona('Zona sur: Lanús y Banfield'), null)
  })
  test('areaDicha: el tramo con "(de oído)" donde corresponde y qué lugares nombra; con menos de dos lugares de la lista, nada', () => {
    const a = A.areaDicha('Provincia de La Pampa: zona marcada desde Colonia Ejemplo y Paraje Norte hasta Villa Inventada y El Molino; los límites quedaron en el mapa.',
      ['Colonia Ejemplo', 'Paraje Norte (de oído, verificar)', 'Villa Inventada', 'El Molino', 'Otro Lugar'])
    assert.equal(a.texto, 'desde Colonia Ejemplo y Paraje Norte (de oído) hasta Villa Inventada y El Molino')
    assert.deepEqual([...a.usados].sort(), [0, 1, 2, 3])
    assert.equal(A.areaDicha('desde el centro hasta 30 km', ['Colonia Ejemplo']), null)
    assert.equal(A.areaDicha('Colonia Ejemplo, Paraje Norte y Villa Inventada', ['Colonia Ejemplo', 'Paraje Norte']), null)
  })
  test('el renglón 📍: provincia y país delante, el área como se dijo, los lugares que el tramo no nombra y la distancia al estudio', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.zona.descripcion = 'Provincia de La Pampa: zona marcada en el mapa desde Colonia Ejemplo y Paraje Norte hasta Villa Inventada y El Molino; los límites exactos quedaron en el mapa.'
    f.zona.lugares = ['Colonia Ejemplo (de oído, verificar)', 'Paraje Norte', 'Villa Inventada', 'El Molino (de oído, verificar)', 'Pueblo Aparte']
    assert.equal(lineaDe(A.textoAvisoAds(filaEjemplo({ ficha: f }), CFG, AHORA), '📍'),
      '📍 **Zona:** Provincia de La Pampa, Argentina: desde Colonia Ejemplo (de oído) y Paraje Norte hasta Villa Inventada y El Molino (de oído) · Pueblo Aparte · El estudio está en Pueblo Ejemplo; Clara dice que queda a 50 km de la capital (cuarenta minutos)')
    // Sin provincia ni país en la ficha: sin prefijo, como antes
    f.zona.descripcion = 'Colonia Ejemplo y alrededores'
    f.zona.pais = null
    assert.match(lineaDe(A.textoAvisoAds(filaEjemplo({ ficha: f }), CFG, AHORA), '📍'), /^📍 \*\*Zona:\*\* Colonia Ejemplo \(de oído\) · Paraje Norte · /)
  })
  test('con la ficha de Laura (si está la salida): San Juan en el renglón 📍, el área entre esos lugares y los 60 km', { skip: !existsSync('.cache/kickoff-prueba/salida-195704214.json') }, () => {
    const s = JSON.parse(readFileSync('.cache/kickoff-prueba/salida-195704214.json', 'utf8'))
    const t = lineaDe(A.textoAvisoAds(A.filaParaAviso(s.ficha, null), CFG, AHORA), '📍')
    assert.match(t, /^📍 \*\*Zona:\*\* Provincia de San Juan, Argentina: desde Tres Esquinas \(de oído\) y Pedernal hasta Caucete y [eE]l Bordón \(de oído\)/)   // la mayúscula la decide Claude en cada corrida
    assert.match(t, /60 km/)
  })
})

describe('WhatsApp, el destino de los anuncios, y los mails en las notas de los tildes', () => {
  test('WhatsApp Business sin confirmar: no dice "sin frenos"; confirmado (Meta o un tilde ok): sí; el número de destino, cargado o "pedíselo a Tomi"', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.portfolio_final.whatsapp_business = { ...f.portfolio_final.whatsapp_business, estado: 'ok', fuente: 'meta', detalle: 'hay anuncios a WhatsApp' }
    const porMeta = lineaDe(A.textoAvisoAds(filaEjemplo({ ficha: f }), CFG, AHORA), '🧾')
    assert.match(porMeta, /^🧾 \*\*Portfolio:\*\* sin frenos: \d\/7 ok/)
    assert.ok(!porMeta.includes('WhatsApp'))
    const tildado = lineaDe(A.textoAvisoAds(filaEjemplo({ portfolio_checks: { whatsapp_business: { valor: 'ok', nota: '', quien: 'Tomi', email: 't@x.test', cuando: '2026-10-24T14:40:00.000Z' } } }), CFG, AHORA), '🧾')
    assert.match(tildado, /sin frenos: /)
    assert.ok(!tildado.includes('WhatsApp Business sin confirmar'))
    assert.match(lineaDe(A.textoAvisoAds(filaEjemplo(), CFG, AHORA), '📅'), / · 📲 WhatsApp de destino: sin cargar \(pedíselo a Tomi\)$/)
  })
  test('la nota de un tilde con un mail no llega a #📣-ads ni a la pantalla (checkVista la tapa, como las marcas)', () => {
    const fila = filaEjemplo({ portfolio_checks: { whatsapp_business: { valor: 'falta', nota: 'pedirle el número a ana@estudio.test', quien: 'Tomi', email: 't@x.test', cuando: '2026-10-24T14:40:00.000Z' } } })
    const t = A.textoAvisoAds(fila, CFG, AHORA)
    assert.match(lineaDe(t, '🧾'), /⛔ frena: WhatsApp Business: falta \(tildado a mano\) — pedirle el número a \\\[mail\\\]/)
    assert.ok(!t.includes('@estudio.test'))
    assert.equal(V.armarVista(fila, AHORA).portfolio.filas.find(x => x.item === 'whatsapp_business').check.nota, 'pedirle el número a [mail]')
  })
})

describe('marcas viejas, lecturas viejas y tiempos', () => {
  test('forzar el kickoff de una fila de antes del aviso (NULL, la de Laura): ni la marca ni el aviso; una fila nueva en error que se retoma: sale', async () => {
    let { deps, log, fila } = fakesProceso({ avisoPrevio: null, salida: SIN_MAPA })
    let r = await procesarKickoff(reunion(), deps, { forzar: true })
    assert.deepEqual([r.estado, r.ads.estado, fila.aviso_ads, log.adsEnvios.length], ['lista', 'no_corresponde', null, 0])
    const enError = { intentos: 2, error_previo: 'Claude respondió 529', ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null, grabador: null, zona_video: null }
    ;({ deps, log, fila } = fakesProceso({ salida: SIN_MAPA, reclamar: async () => enError }))
    r = await procesarKickoff(reunion(), deps)
    assert.deepEqual([r.estado, r.ads.estado, fila.aviso_ads], ['lista', 'enviado', 'msg_ads'])
  })
  test('una lectura vieja (un "pedido" o un error pasajero de hace horas) no se espera: aviso_ads=1 sobre la fila de antes sale enseguida', async () => {
    const vieja = new Date(AHORA - 3 * 3600_000).toISOString()
    for (const zv of [zvMapa('pedido', 'tomas', vieja), zvMapa('error', 'tomas', vieja, { transitorio: true, motivo: 'video de Fathom: tardó más de 4 minutos' })]) {
      assert.deepEqual(A.avisoAdsListo({ zv, desde: AHORA, ahoraMs: AHORA }), { listo: true, por: 'lectura_vieja' }, zv.estado)
    }
    const { b, deps } = baseAds({ aviso_ads: null, zona_video: zvMapa('error', 'tomas', vieja, { transitorio: true }) })
    const r = await A.avisoAdsManual(ID, 'uno', { dry: false, deps, leer: deps.leer, config: CFG, deadline: DEADLINE })
    assert.equal(r.estado, 'enviado')
    assert.match(b.envios[0].texto, /no se pudo leer el mapa del video: confirmar el recorte con Tomi/)
    // Una lectura recién escrita, en cambio, se espera (puede venir el reintento solo)
    assert.equal(A.avisoAdsListo({ zv: zvMapa('error', 'tomas', new Date(AHORA - 60_000).toISOString(), { transitorio: true }), desde: AHORA - 60_000, ahoraMs: AHORA }).listo, false)
  })
  test('con menos de 15 s no toma nada (queda pendiente); el barrido sin tiempo ni siquiera busca; busca los pendientes de los últimos 7 días', async () => {
    const { b, deps } = baseAds()
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: AHORA + A.MIN_TIEMPO_ADS_MS - 1, listo: true })).estado, 'sin_tiempo')
    assert.match(b.fila.aviso_ads, /^pendiente:/)
    let buscadas = 0, desde = null
    const { deps: d2 } = baseAds({}, { pendientes: async (n, d) => { buscadas++; desde = d; return [] } })
    assert.deepEqual(await A.barrerAvisosAds(d2, { deadline: AHORA + 5_000 }), [])
    assert.equal(buscadas, 0)
    await A.barrerAvisosAds(d2, { deadline: DEADLINE })
    assert.equal(AHORA - desde, 7 * 24 * 3600_000)
    assert.equal(b.envios.length, 0)
  })
})

describe('ruta del mapa: el redisparo sin respuesta, el barrido al final, la verificación sin ffmpeg y un reloj que avanza', () => {
  const resultado = (over = {}) => ({
    estado: 'ok', version: M.VERSION_MAPA, momentos: [1028, 1038], cuadros: { pedidos: 2, sacados: 2, fallas: [] },
    tiempos: { total_ms: 10, video_ms: 5, cuadros_ms: 2, claude_ms: 3 }, tokens: { input_tokens: 100, output_tokens: 10, costo_usd: 0.001 }, modelo: 'claude-opus-5-5', ajustes: [],
    video: { download_id: 'dl_nuevo', pedidos: 0, content_type: 'video/mp4', file_size_bytes: 1, expires_at: null },
    zona: { ...clonar(FICHA_EJEMPLO).zona, mapa: M.combinarZonaConMapa(zonaDicha(), mapaLeido()).mapa },
    ...over,
  })
  const listo = () => resultado({ estado: 'listo', zona: undefined, video: undefined })
  function depsMapa(over = {}) {
    const log = { fondo: [], ads: [], barridos: [] }
    const deps = {
      autorizado: r => r.headers.get('authorization') === 'Bearer ok',
      baseConfigurada: () => true,
      leerKickoff: async () => ({ ficha: clonar(FICHA_EJEMPLO), zona_video: null, grabador: 'tomas' }),
      guardarZonaVideo: async () => true,
      zonaDesdeVideo: async (id, q, f, op) => (op.dry ? listo() : resultado()),
      enSegundoPlano: fn => { log.fondo.push(fn) },
      ahora: () => AHORA,
      redisparar: async () => {},
      avisarAds: async (id, zv, deadline) => { log.ads.push({ id, zv, deadline }) },
      barrerAds: async deadline => { log.barridos.push(deadline) },
      ...over,
    }
    return { deps, log }
  }
  const pedir = (deps, cuerpo) => atenderMapa(new Request('https://despacho.test/api/bot/kickoff/mapa', { method: 'POST', headers: { authorization: 'Bearer ok', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }), deps)
  const correrFondo = async log => { for (let i = 0; i < log.fondo.length; i++) await log.fondo[i]() }
  const pasajero = () => resultado({ estado: 'error', transitorio: true, motivo: 'video de Fathom: tardó más de 4 minutos', zona: undefined, video: { download_id: 'dl_9', pedidos: 1, content_type: null, file_size_bytes: null, expires_at: null } })

  test('el redisparo del reintento no responde a tiempo (puede haber arrancado): NO manda el aviso con el error; si no se pudo conectar, sí', async () => {
    let { deps, log } = depsMapa({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? listo() : pasajero()), redisparar: async () => { throw new Error('la ruta del mapa no respondió en 8 s') } })
    await pedir(deps, { recording_id: ID })
    await correrFondo(log)
    assert.equal(log.ads.length, 0, 'lo manda el reintento o, si no arrancó, el barrido')
    ;({ deps, log } = depsMapa({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? listo() : pasajero()), redisparar: async () => { throw new Error('no se pudo conectar con la ruta del mapa') } }))
    await pedir(deps, { recording_id: ID })
    await correrFondo(log)
    assert.deepEqual(log.ads.map(x => x.zv.estado), ['error'])
  })
  test('al final de la lectura corre el barrido de los pendientes de otras grabaciones (hasta los 293 s); en dry o con 409, no', async () => {
    const { deps, log } = depsMapa()
    await pedir(deps, { recording_id: ID })
    await correrFondo(log)
    assert.deepEqual(log.barridos, [AHORA + 293_000])
    for (const [cuerpo, over] of [[{ recording_id: ID, dry: true }, {}], [{ recording_id: ID }, { guardarZonaVideo: async () => false }]]) {
      const d = depsMapa(over)
      await pedir(d.deps, cuerpo)
      await correrFondo(d.log)
      assert.deepEqual(d.log.barridos, [])
    }
  })
  test('la verificación corta por falta de ffmpeg: queda anotado en palabras (sin nombres de variables) y el aviso sale con eso', async () => {
    const guardado = []
    const { deps, log } = depsMapa({
      zonaDesdeVideo: async () => resultado({ estado: 'error', transitorio: false, motivo: 'no se encontró ffmpeg (FFMPEG_PATH)', zona: undefined, video: undefined }),
      guardarZonaVideo: async (id, zv) => { guardado.push(zv); return true },
    })
    assert.equal((await pedir(deps, { recording_id: ID })).status, 502)
    await correrFondo(log)
    assert.deepEqual(guardado.map(z => z.motivo), ['el servidor no tiene ffmpeg para sacar los cuadros del video: avisale a Tomás'])
    assert.deepEqual(log.ads.map(x => [x.zv.estado, x.zv.motivo]), [['error', 'el servidor no tiene ffmpeg para sacar los cuadros del video: avisale a Tomás']])
  })
  test('con un reloj que avanza: si la lectura termina a los 283 s, el aviso va con el tope de 293 s; a los 291 s ya no (queda para el barrido)', async () => {
    for (const [fin, esperados] of [[283_000, 1], [291_000, 0]]) {
      const reloj = { t: AHORA }
      const { deps, log } = depsMapa({
        ahora: () => reloj.t,
        zonaDesdeVideo: async (id, q, f, op) => { if (op.dry) return listo(); reloj.t = AHORA + fin; return resultado() },
      })
      await pedir(deps, { recording_id: ID })
      await correrFondo(log)
      assert.equal(log.ads.length, esperados, `termina a los ${fin / 1000} s`)
      if (esperados) assert.equal(log.ads[0].deadline, AHORA + 293_000)
    }
    // Y con 10 s hasta el tope, el aviso no se toma: queda pendiente (nunca "enviando" a mitad de camino)
    const { b, deps } = baseAds()
    b.t = AHORA + 283_000
    assert.equal((await A.intentarAvisoAds(ID, deps, { deadline: AHORA + 293_000, listo: true })).estado, 'sin_tiempo')
    assert.match(b.fila.aviso_ads, /^pendiente:/)
  })
})

describe('después de cada grabación del webhook (trasWebhook de procesar.ts): procesar, purgar y barrer', () => {
  test('el barrido corre después de procesar y purgar, aunque el proceso o la purga fallen; sin las dependencias del aviso (apagado), no hay barrido', async () => {
    const pasos = []
    const { b, deps } = baseAds()
    await P.trasWebhook(ID, 'FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS (tomas)', {
      procesar: async () => { pasos.push('procesar'); throw new Error('se cayó') },
      purgar: async () => { pasos.push('purgar'); throw new Error('la base no respondió') },
      ads: deps, deadline: DEADLINE,
    })
    assert.deepEqual(pasos, ['procesar', 'purgar'])
    assert.deepEqual([b.envios.length, b.fila.aviso_ads], [1, 'msg_1'], 'el pendiente salió en el barrido')
    const { b: b2 } = baseAds()
    await P.trasWebhook(ID, 'X (tomas)', { procesar: async () => ({ estado: 'lista' }), purgar: async () => 0, ads: null, deadline: DEADLINE })
    assert.equal(b2.envios.length, 0)
  })
})

describe('POST ?recording_id=<una ficha lista> sin quien: corre el barrido y responde 200 con lo que hizo (no el 409 de "sin payload")', async () => {
  const { POST } = await import('../app/api/bot/kickoff/route.ts')
  const CRON = 'cron-de-prueba-ads-1234567890'
  const vars = ['CRON_SECRET', 'DATABASE_URL', 'DISCORD_WEBHOOK_ANUNCIOS', 'DISCORD_ID_VALENTINO', 'DISCORD_WEBHOOK_KICKOFF', 'DISCORD_WEBHOOK_KICKOFF_ADS', 'KICKOFF_AVISO_ADS']
  test('Neon y Discord falsos: el pendiente sale, la marca queda con el id; otra vez → ya salió, también 200', async () => {
    for (const k of vars) delete process.env[k]
    process.env.KICKOFF_AVISO_ADS = '1'
    process.env.CRON_SECRET = CRON
    process.env.DATABASE_URL = 'postgres://falsa.test/db'
    process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/anuncios'
    process.env.DISCORD_ID_VALENTINO = VALENTINO
    const marca = { v: `pendiente:${Date.now() - 1000}` }
    const filaDb = () => ({
      recording_id: String(ID), estado: 'lista', titulo: 'T', url: FICHA_EJEMPLO.url, intentos: 1, cliente_crm: FICHA_EJEMPLO.cliente.cliente_crm, id_crm: 'E157',
      aviso_discord: '1300000000000000005', tiene_payload: false, error: null, ficha: clonar(FICHA_EJEMPLO), ideas: null, revision: null, portfolio_checks: {}, faltantes_checks: {},
      zona_video: null, grabador: 'tomas', duplicada_de: null, aviso_ads: marca.v, creado: new Date(0), actualizado: new Date(0),
    })
    const q = async (strings, ...valores) => {
      const t = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      if (t.startsWith('SELECT column_name')) return ['faltantes_checks', 'grabador', 'agendado', 'dedupe', 'duplicada_de', 'zona_video', 'aviso_ads'].map(c => ({ column_name: c }))
      if (t.startsWith('SELECT payload')) return [{ payload: null, estado: 'lista', intentos: 1, grabador: 'tomas', duplicada_de: null }]
      if (t.startsWith('SELECT recording_id, estado, titulo')) return [filaDb()]
      if (t.startsWith("UPDATE cj_kickoffs SET aviso_ads = $1 WHERE recording_id = $2 AND estado = 'lista' AND aviso_ads = $3")) {
        if (valores[2] !== marca.v) return []
        marca.v = valores[0]
        return [filaDb()]
      }
      if (t.startsWith('UPDATE cj_kickoffs SET aviso_ads = $1 WHERE recording_id = $2 AND aviso_ads = $3')) {
        if (valores[2] !== marca.v) return []
        marca.v = valores[0]
        return [{ recording_id: ID }]
      }
      return []
    }
    const envios = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => { envios.push({ url: String(url), cuerpo: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: '1300000000000000077' }), { status: 200 }) }
    registro.sqlParaPruebas(() => q)
    try {
      const { conArchivadosActuales } = await import('../lib/clientes/archivados.ts')
      const post = () => conArchivadosActuales(() => POST(new Request(`http://localhost:3101/api/bot/kickoff?recording_id=${ID}`, { method: 'POST', headers: { authorization: `Bearer ${CRON}` } })), { leer: async () => [['ID', 'Nombre', 'Estado', 'Anotaciones'], ['E157', FICHA_EJEMPLO.cliente.cliente_crm, 'ACTIVO', '']] })
      const r = await post()
      assert.equal(r.status, 200)
      const j = await r.json()
      assert.deepEqual([j.estado, j.aviso_ads.estado, j.aviso_ads.aviso_id], ['lista', 'enviado', '1300000000000000077'])
      assert.equal(j.error, undefined)
      assert.equal(marca.v, '1300000000000000077')
      assert.equal(envios.length, 1)
      assert.equal(envios[0].url, 'https://discord.test/api/webhooks/1/anuncios?wait=true')
      assert.deepEqual(envios[0].cuerpo.allowed_mentions, { parse: [], users: [VALENTINO] })
      const otra = await post()
      assert.equal(otra.status, 200)
      assert.equal((await otra.json()).aviso_ads.estado, 'ya_salio')
      assert.equal(envios.length, 1, 'no se repite')
    } finally {
      globalThis.fetch = original
      registro.sqlParaPruebas(null)
      for (const k of vars) delete process.env[k]
    }
  })
})
