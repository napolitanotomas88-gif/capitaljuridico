// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-edicion-contenido.mjs
// f05 / f06 (lib/edicion/contenido.ts y vistaLecturas.ts): qué mensajes del grupo Contenido se leen, cómo se clasifican,
// a qué video van, qué se guarda y qué ve Aylu. Sin red: directorio, Claude, base y Discord falsos.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const C = await import('../lib/edicion/contenido.ts')
const VL = await import('../lib/edicion/vistaLecturas.ts')
const P = await import('../lib/edicion/pedido.ts')
const S = await import('../lib/edicion/contenidoServidor.ts')

const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const CONTENIDO = '120363000000000011@g.us', GENERAL = '120363000000000010@g.us', EQUIPO = '120363000000000020@g.us'
const CLIENTE_TEL = '5491155550099', AYLU_TEL = '5491100000002'
const AHORA = Date.parse('2026-11-01T15:00:00Z')
const TS = Math.floor(AHORA / 1000) - 30
let n = 0
const msg = (over = {}) => ({ id: `msg-${++n}-AbCd`, from_me: false, type: 'text', chat_id: CONTENIDO, timestamp: TS, source: 'mobile', text: { body: 'hola' }, from: CLIENTE_TEL, from_name: 'Ana', ...over })
const envio = messages => ({ messages, event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-PRUEBA1' })

describe('filtro barato y lectura gruesa', () => {
  test('pasa el OK y los cambios; no la cortesía ni la charla', () => {
    for (const t of ['Perfecto, me encanta!', 'Quedó buenísimo', 'dale, publiquen', '👍', 'En el seg 12 dice mora, va demora', 'Cambiá la música por favor', 'el video 3 tiene un error en el título'])
      assert.equal(C.pareceDeEdicion(t), true, t)
    for (const t of ['gracias chicos!', 'hola', 'buen dia', 'mañana grabo los que faltan', ''])
      assert.equal(C.pareceDeEdicion(t), false, t)
  })
  test('clasificarRapido sin Claude', () => {
    assert.equal(C.clasificarRapido('Perfecto, me encanta'), 'ok')
    assert.equal(C.clasificarRapido('Sacá la parte del seg 20'), 'correccion')
    assert.equal(C.clasificarRapido('Está genial, solo cambiá el subtítulo'), 'ok_con_cambios')
    assert.equal(C.clasificarRapido('mañana grabo'), 'otro')
  })
  test('videos nombrados', () => {
    assert.deepEqual(C.videosNombrados('El video 3 está perfecto'), [3])
    assert.deepEqual(C.videosNombrados('los videos 2 y 4 me encantan, el video nro 5 cambiale el título'), [2, 4, 5])
    assert.deepEqual(C.videosNombrados('me encanta'), [])
  })
  test('candidatos: solo el cliente, en grupos de clientes, con texto o pie y menos de 48 h', () => {
    const c = C.candidatosContenido(envio([
      msg({ text: { body: 'Me encantó, adelante!' } }),
      msg({ text: { body: 'Perfecto' }, context: { quoted_id: 'wamid-entrega-1' } }),
      msg({ from_me: true, source: 'api', text: { body: 'Ya revisamos tu video y está listo' } }),
      msg({ from: AYLU_TEL, text: { body: 'Perfecto, lo subimos' } }),
      msg({ chat_id: GRUPOS.ventas, text: { body: 'Perfecto' } }),
      msg({ chat_id: EQUIPO, text: { body: 'Perfecto' } }),
      msg({ timestamp: TS - 3 * 86400, text: { body: 'Perfecto' } }),
      msg({ text: { body: 'gracias!' } }),
      msg({ type: 'image', image: { id: 'i', mime_type: 'image/jpeg', caption: 'Así quiero el logo' } }),
      msg({ type: 'voice', voice: { id: 'v' } }),
    ]), GRUPOS, AHORA, new Set([AYLU_TEL]), [EQUIPO])
    assert.deepEqual(c.map(x => x.texto), ['Me encantó, adelante!', 'Perfecto', 'Así quiero el logo'])
    assert.equal(c[1].citado, 'wamid-entrega-1')
    assert.equal(c[0].citado, null)
  })
})

describe('Claude y elección del video', () => {
  test('lectura válida: tipos, videos y sentido', () => {
    assert.deepEqual(C.lecturaContenidoValida({ tipo: 'ok', videos: [3, 3, -1, 1.5], resumen: 'Aprueba.', sentido: 'razonable', motivo: '' }), { tipo: 'ok', videos: [3], resumen: 'Aprueba.', sentido: 'razonable', motivo: '' })
    assert.equal(C.lecturaContenidoValida({ tipo: 'raro' }), null)
    assert.equal(C.lecturaContenidoValida({ tipo: 'correccion', videos: 'x', sentido: 'cualquiera' }).sentido, 'razonable')
    assert.equal(C.lecturaContenidoValida({ tipo: 'correccion', videos: [], sentido: 'revisar', motivo: 'Implica regrabar' }).sentido, 'revisar')
  })
  const V = (id, numero, tanda = 1) => ({ id, version: 4, numero, tanda_guion: tanda, nombre: `Video ${numero}` })
  test('el citado manda; después el número; si hay uno solo, ese', () => {
    const conCliente = [V(10, 1), V(11, 2), V(12, 3)]
    assert.deepEqual(C.elegirVideos({ nombrados: [], citados: [10, 11], conCliente }).videos.map(v => v.id), [10, 11])
    assert.deepEqual(C.elegirVideos({ nombrados: [2], citados: [10, 11], conCliente }).videos.map(v => v.id), [11])
    assert.deepEqual(C.elegirVideos({ nombrados: [9], citados: [10, 11], conCliente }).videos.map(v => v.id), [10, 11])
    assert.deepEqual(C.elegirVideos({ nombrados: [3], citados: [], conCliente }), { videos: [V(12, 3)], por: 'numero' })
    assert.deepEqual(C.elegirVideos({ nombrados: [], citados: [], conCliente }), { videos: [], por: null })
    assert.deepEqual(C.elegirVideos({ nombrados: [], citados: [], conCliente: [V(10, 1)] }).por, 'unico')
    // dos tandas con el mismo «video 1»: no se elige a ciegas
    assert.deepEqual(C.elegirVideos({ nombrados: [1], citados: [], conCliente: [V(10, 1, 1), V(20, 1, 2)] }).videos, [])
    // un citado que ya no está «Con el cliente» no cuenta
    assert.deepEqual(C.elegirVideos({ nombrados: [], citados: [99], conCliente: [V(10, 1)] }).por, 'unico')
  })
  test('el aviso a Aylu: mención, cita, sentido y link; sin @ sueltos', () => {
    const l = { tipo: 'correccion', videos: [], resumen: '', sentido: 'revisar', motivo: 'Implica regrabar' }
    const t = C.textoAvisoContenido({ cliente: 'Ana Pérez', estado: 'pedido', lectura: l, videos: [V(10, 1)], texto: 'Cambiá @todos lo del seg 3' }, 'https://despacho/clientes/edicion/cliente/A001#lecturas', '123')
    assert.match(t, /^<@123> ✏️ \*\*Ana Pérez\*\* pidió cambios en Video 1/)
    assert.match(t, /> Cambiá \\@todos lo del seg 3/)
    assert.match(t, /⚠️ Mirarlo antes de pasarlo a René: Implica regrabar/)
    assert.match(t, /\[Abrir en el Despacho\]\(<https:\/\/despacho\/clientes\/edicion\/cliente\/A001#lecturas>\)/)
    assert.match(C.textoAvisoContenido({ cliente: 'Ana', estado: 'propuesta_ok', lectura: { ...l, tipo: 'ok', sentido: 'razonable' }, videos: [V(10, 1), V(11, 2)], texto: 'Perfecto' }, 'l', null), /^Aylu ✅ \*\*Ana\*\* dio el OK a Video 1, Video 2\. Confirmalo/)
    assert.match(C.textoAvisoContenido({ cliente: 'Ana', estado: 'sin_video', lectura: l, videos: [], texto: 'x' }, 'l', null), /no queda claro de cuál habla/)
  })
})

// ── Orquestador con deps falsas ──
function falsas(over = {}) {
  const reg = { reclamados: [], guardados: [], pedidos: [], avisos: [], leidos: [] }
  const vistos = new Set()
  const deps = {
    deChat: async chat => (chat === CONTENIDO ? { idCrm: 'A001', cliente: 'Ana Pérez', grupo: 'contenido' } : chat === GENERAL ? { idCrm: 'A001', cliente: 'Ana Pérez', grupo: 'general' } : null),
    idPorNombre: async () => null,
    videosConCliente: async () => [{ id: 10, version: 4, numero: 1, tanda_guion: 1, nombre: 'Video 1' }],
    videosDelCitado: async () => [],
    reclamar: async m => { if (vistos.has(m.mensajeId)) return null; vistos.add(m.mensajeId); reg.reclamados.push(m.mensajeId); return reg.reclamados.length },
    leer: async texto => { reg.leidos.push(texto); return { tipo: C.clasificarRapido(texto), videos: [], resumen: 'r', sentido: 'razonable', motivo: '' } },
    crearPedido: async (v, texto) => { reg.pedidos.push({ video: v.id, texto }); return 77 },
    guardar: async (id, r, modelo) => { reg.guardados.push({ id, estado: r.estado, videos: r.videos.map(v => v.id), pedido: r.pedidoId, modelo, sentido: r.lectura.sentido }) },
    avisar: async t => { reg.avisos.push(t); return 'd1' },
    link: id => `https://despacho/clientes/edicion/cliente/${id}#lecturas`,
    aylu: '123',
    ...over,
  }
  return { deps, reg }
}
const cand = (texto, over = {}) => ({ mensajeId: `m-${++n}`, chatId: CONTENIDO, texto, citado: null, autor: { telefono: CLIENTE_TEL, lid: null, nombre: 'Ana' }, enviadoEn: '2026-11-01T14:59:00Z', ...over })

describe('procesarContenido', () => {
  test('OK con un solo video con el cliente → propuesta de OK y aviso a Aylu (no aprueba nada)', async () => {
    const { deps, reg } = falsas()
    const r = await C.procesarContenido([cand('Perfecto, me encanta!')], deps)
    assert.deepEqual({ leidos: r.leidos, ok: r.ok, pedidos: r.pedidos, avisos: r.avisos }, { leidos: 1, ok: 1, pedidos: 0, avisos: 1 })
    assert.deepEqual(reg.guardados[0], { id: 1, estado: 'propuesta_ok', videos: [10], pedido: null, modelo: C.VERSION_PROMPT_CONTENIDO, sentido: 'razonable' })
    assert.equal(reg.pedidos.length, 0)
    assert.match(reg.avisos[0], /dio el OK a Video 1/)
  })
  test('cambios para un video → pedido propuesto (Aylu tilda y confirma)', async () => {
    const { deps, reg } = falsas()
    await C.procesarContenido([cand('En el seg 12 dice mora, va demora')], deps)
    assert.deepEqual(reg.pedidos, [{ video: 10, texto: 'En el seg 12 dice mora, va demora' }])
    assert.equal(reg.guardados[0].estado, 'pedido')
    assert.equal(reg.guardados[0].pedido, 77)
  })
  test('cambios con dos videos con el cliente y sin decir cuál → sin video, aviso para que Aylu elija', async () => {
    const { deps, reg } = falsas({ videosConCliente: async () => [{ id: 10, version: 4, numero: 1, tanda_guion: 1, nombre: 'Video 1' }, { id: 11, version: 2, numero: 2, tanda_guion: 1, nombre: 'Video 2' }] })
    const r = await C.procesarContenido([cand('Cambiá la música')], deps)
    assert.equal(r.sinVideo, 1)
    assert.equal(reg.pedidos.length, 0)
    assert.equal(reg.guardados[0].estado, 'sin_video')
  })
  test('OK citando la entrega del bot con dos videos → propuesta de OK para los dos', async () => {
    const dos = [{ id: 10, version: 4, numero: 1, tanda_guion: 1, nombre: 'Video 1' }, { id: 11, version: 2, numero: 2, tanda_guion: 1, nombre: 'Video 2' }]
    const { deps, reg } = falsas({ videosConCliente: async () => dos, videosDelCitado: async id => (id === 'wamid-entrega' ? [10, 11] : []) })
    await C.procesarContenido([cand('Perfectos los dos!', { citado: 'wamid-entrega' })], deps)
    assert.deepEqual(reg.guardados[0].videos, [10, 11])
    assert.equal(reg.guardados[0].estado, 'propuesta_ok')
  })
  test('sin videos con el cliente, otro grupo o mensaje repetido → no se guarda nada', async () => {
    const { deps, reg } = falsas({ videosConCliente: async () => [] })
    await C.procesarContenido([cand('Perfecto')], deps)
    assert.equal(reg.reclamados.length, 0)
    const f = falsas()
    const repetido = cand('Perfecto')
    await C.procesarContenido([cand('Perfecto', { chatId: GENERAL }), cand('Perfecto', { chatId: '120363000000000099@g.us' }), repetido, repetido], f.deps)
    assert.equal(f.reg.reclamados.length, 1)
    assert.equal(f.reg.leidos.length, 1)
  })
  test('lo que no es de los videos se guarda como «otro» y no avisa', async () => {
    const { deps, reg } = falsas({ leer: async () => ({ tipo: 'otro', videos: [], resumen: '', sentido: 'razonable', motivo: '' }) })
    await C.procesarContenido([cand('Perfecto, mañana te paso el comprobante')], deps)
    assert.equal(reg.guardados[0].estado, 'otro')
    assert.equal(reg.avisos.length, 0)
  })
  test('sin Claude (Mac apagada): lectura gruesa, marcada para revisar', async () => {
    const { deps, reg } = falsas({ leer: async () => { throw new Error('APIConnectionError') } })
    const r = await C.procesarContenido([cand('Perfecto')], deps)
    assert.equal(reg.guardados[0].estado, 'propuesta_ok')
    assert.equal(reg.guardados[0].sentido, 'revisar')
    assert.equal(reg.guardados[0].modelo, null)
    assert.match(r.errores[0], /^claude: APIConnectionError/)
  })
  test('el grupo sin id del CRM se resuelve por el nombre (si es único)', async () => {
    const { deps, reg } = falsas({ deChat: async () => ({ idCrm: null, cliente: 'Ana Pérez', grupo: 'contenido' }), idPorNombre: async x => (x === 'Ana Pérez' ? 'A001' : null) })
    await C.procesarContenido([cand('Perfecto')], deps)
    assert.equal(reg.guardados.length, 1)
    const g = falsas({ deChat: async () => ({ idCrm: null, cliente: 'Otro', grupo: 'contenido' }) })
    await C.procesarContenido([cand('Perfecto')], g.deps)
    assert.equal(g.reg.reclamados.length, 0)
  })
  test('si falla el pedido (el video cambió), queda sin video para Aylu; si falla Discord, la lectura queda guardada', async () => {
    const { deps, reg } = falsas({ crearPedido: async () => { throw new Error('el video ya no está «Con el cliente»') }, avisar: async () => { throw new Error('Discord 500') } })
    const r = await C.procesarContenido([cand('Sacá el seg 4')], deps)
    assert.equal(reg.guardados[0].estado, 'sin_video')
    assert.equal(r.avisos, 0)
    assert.equal(r.errores.length, 2)
  })
})

describe('interruptor', () => {
  test('la lectura solo corre con EDICION_LECTURA=real y EDICION_MODO=real', async () => {
    assert.equal(S.lecturaEncendida({}), false)
    assert.equal(S.lecturaEncendida({ EDICION_LECTURA: 'real' }), false)
    assert.equal(S.lecturaEncendida({ EDICION_MODO: 'real' }), false)
    assert.equal(S.lecturaEncendida({ EDICION_LECTURA: 'real', EDICION_MODO: 'real' }), true)
    assert.equal(await S.procesarContenidoReal([cand('Perfecto')], { env: { EDICION_MODO: 'real' }, log: { info() {}, warn() {}, error() {} } }), null)
  })
})

describe('pantalla (vistaLecturas) y acción', () => {
  const L = (over = {}) => ({ id: 1, id_crm: 'A001', texto: 'Perfecto!', enviado: '2026-11-01T14:59:00Z', estado: 'propuesta_ok', tipo: 'ok', sentido: 'razonable', motivo: '', resumen: 'Aprueba.', video_ids: [10, 11], por: 'cita', pedido_id: null, version: 1, resuelta: null, resuelta_por: null, creado: '2026-11-01T15:00:00Z', ...over })
  const videos = [{ id: 10, clave: 'T1-V1', numero: 1, estado: 'con_cliente', version: 4 }, { id: 11, clave: 'T1-V2', numero: 2, estado: 'aprobado', version: 6 }]
  test('OK pendiente solo con los videos que siguen con el cliente', () => {
    const [v] = VL.armarLecturas([L()], videos, h => `${h}?demo=1`)
    assert.equal(v.estado, 'ok_pendiente')
    assert.deepEqual(v.okItems, [{ video_id: 10, version: 4 }])
    assert.equal(v.videos[0].href, '/clientes/edicion/video/10?demo=1')
    assert.equal(v.cita, 'Perfecto!')
  })
  test('OK ya resuelto (los videos salieron de «Con el cliente»), pedido con link y descartada', () => {
    assert.equal(VL.armarLecturas([L({ video_ids: [11] })], videos)[0].estado, 'resuelta')
    const p = VL.armarLecturas([L({ estado: 'pedido', tipo: 'correccion', video_ids: [10], pedido_id: 77 })], videos)[0]
    assert.equal(p.pedidoHref, '/clientes/edicion/video/10#ed-pedido')
    assert.equal(VL.armarLecturas([L({ estado: 'descartada' })], videos)[0].estado, 'descartada')
    assert.equal(VL.lecturasAbiertas(VL.armarLecturas([L(), L({ id: 2, estado: 'descartada' }), L({ id: 3, estado: 'sin_video', video_ids: [] })], videos)).length, 2)
  })
  test('lectura_resolver: validación', () => {
    assert.deepEqual(P.validarPedido({ accion: 'lectura_resolver', lectura_id: 3, version: 1, estado: 'descartada' }), { ok: true, pedido: { accion: 'lectura_resolver', lectura_id: 3, version: 1, estado: 'descartada' } })
    assert.equal(P.validarPedido({ accion: 'lectura_resolver', lectura_id: 3, version: 1, estado: 'aprobada' }).ok, false)
    assert.equal(P.validarPedido({ accion: 'lectura_resolver', lectura_id: 0, version: 1, estado: 'usada' }).ok, false)
  })
})
