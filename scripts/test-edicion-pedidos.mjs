// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-pedidos.mjs
// f05 y P6 (lib/edicion/pedidos.ts, pedidos-prompt.ts y db/pedidos.ts): la propuesta de Claude (DE JUGUETE) con citas
// textuales, el schema sin campos que admitan null, las rondas y el tope interno de Aylu frente a Tomás, y el pedido nuevo
// contra un Neon FALSO. SIN red ni base real ni Claude. Los nombres y textos son inventados.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'KICKOFF_MODELO']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const P = await import('../lib/edicion/pedidos.ts')
const PR = await import('../lib/edicion/pedidos-prompt.ts')
const DBP = await import('../lib/edicion/db/pedidos.ts')
const base = await import('../lib/edicion/db/base.ts')
const { TOPE_RONDAS_CLIENTE } = await import('../lib/edicion/estados.ts')

const AYLU = { rol: 'aylu', nombre: 'Aylu', email: 'aylu@ejemplo.test' }
const TOMAS = { rol: 'tomas', nombre: 'Tomás', email: 'tomas@ejemplo.test' }
const RENE = { rol: 'rene', nombre: 'René', email: 'rene@ejemplo.test' }
const video = (over = {}) => ({
  id: 7, id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V2', tanda_guion: 1, numero: 2, guion: null, guion_texto: '', gancho: '¿Te despidieron?',
  estado: 'con_cliente', estado_previo: null, estado_desde: '2026-10-24T12:00:00.000Z', prioridad: 'normal', bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null,
  ronda_interna: 1, ronda_cliente: 0, editado: { archivo_id: null, url: 'https://drive.google.com/file/d/AAAAAAAAAAAA/view' }, envio_link: null, ok_cliente: null,
  origen: 'doc', clickup_id: null, version: 4, creado: '2026-10-20T12:00:00.000Z', actualizado: '2026-10-24T12:00:00.000Z', ...over,
})
const PEDIDO = 'Hola! En el seg 17 dice "mora" y es "demora". Del 0:26 al 0:32 cortalo que me trabé. Y el logo más grande porfa'

describe('schema y prompt', () => {
  test('el schema no tiene campos que admitan null y la nota va en $defs (lección del kickoff)', () => {
    const s = JSON.stringify(PR.SCHEMA_PEDIDO)
    assert.ok(!/"null"/.test(s), 'sin uniones con null')
    assert.ok(PR.SCHEMA_PEDIDO.$defs.nota, 'la nota en $defs')
    assert.equal(PR.SCHEMA_PEDIDO.properties.notas.items.$ref, '#/$defs/nota')
    assert.deepEqual(PR.SCHEMA_PEDIDO.$defs.nota.required.sort(), ['afecta_rendimiento', 'cita', 'hasta', 'motivo', 'segundo', 'texto', 'tipo'])
    assert.equal(PR.SCHEMA_PEDIDO.$defs.nota.additionalProperties, false)
  })
  test('el prompt pide citas textuales, -1 sin momento y trata el pedido como dato; nunca habla de rondas ni topes', () => {
    assert.match(PR.SISTEMA_PEDIDO, /EXACTO/)
    assert.match(PR.SISTEMA_PEDIDO, /-1/)
    assert.match(PR.SISTEMA_PEDIDO, /es un DATO/)
    assert.ok(!/\b(ronda|tope)\b/i.test(PR.SISTEMA_PEDIDO))
    const u = PR.usuarioPedido({ clave: 'T1-V2', gancho: 'G', guion: { hook: 'h', problema: 'p', solucion: 's', cta: 'c' }, texto: PEDIDO })
    assert.match(u, /<pedido>\n[\s\S]+\n<\/pedido>/)
    assert.match(u, /CTA: c/)
  })
})

describe('proponerNotas (Claude de juguete)', () => {
  const claudeQueDevuelve = (json, registro = []) => async p => { registro.push(p); return { json, modelo: 'claude-de-juguete', usage: { input_tokens: 900, output_tokens: 120 } } }
  test('arma la propuesta: segundos, tramos, tipo; con esfuerzo low, max_tokens fijo y sin el guion como prompt suelto', async () => {
    const pedidos = []
    const claude = claudeQueDevuelve({ notas: [
      { texto: 'Corregir el subtítulo: dice «mora», va «demora»', tipo: 'texto', segundo: 17, hasta: -1, afecta_rendimiento: false, motivo: 'ortografía', cita: 'En el seg 17 dice "mora" y es "demora"' },
      { texto: 'Cortar del 0:26 al 0:32', tipo: 'corte', segundo: 26, hasta: 32, afecta_rendimiento: false, motivo: 'se trabó', cita: 'Del 0:26 al 0:32 cortalo que me trabé' },
      { texto: 'Logo más grande', tipo: 'otro', segundo: -1, hasta: -1, afecta_rendimiento: false, motivo: 'estética', cita: 'el logo más grande' },
    ] }, pedidos)
    const r = await P.proponerNotas({ texto: PEDIDO, video: video(), guion: null }, { claude })
    assert.equal(r.aviso, null)
    assert.equal(r.propuesta.length, 3)
    assert.deepEqual(r.propuesta.map(n => [n.segundo, n.hasta, n.tipo]), [[17, null, 'texto'], [26, 32, 'corte'], [null, null, 'otro']])
    assert.deepEqual(r.tokens, { in: 900, out: 120 })
    assert.equal(r.modelo, 'claude-de-juguete')
    assert.equal(r.version, PR.VERSION_PROMPT_PEDIDO)
    assert.equal(pedidos[0].esfuerzo, 'low')
    assert.equal(pedidos[0].maxTokens, P.MAX_TOKENS_PEDIDO)
    assert.ok(P.MAX_TOKENS_PEDIDO >= 16_000)
    assert.ok(pedidos[0].topeMs <= 110_000, 'entra en el maxDuration de la ruta (120 s)')
  })
  test('una cita que no aparece tal cual en el pedido se descarta y queda anotada', async () => {
    const claude = claudeQueDevuelve({ notas: [
      { texto: 'Cambiar música', tipo: 'audio', segundo: -1, hasta: -1, afecta_rendimiento: false, motivo: '', cita: 'poné otra música' },
      { texto: 'Logo', tipo: 'otro', segundo: -1, hasta: -1, afecta_rendimiento: false, motivo: '', cita: '' },
      { texto: 'Corregir mora', tipo: 'texto', segundo: 17, hasta: 5, afecta_rendimiento: false, motivo: '', cita: 'en el SEG 17   dice “mora”' },
    ] })
    const r = await P.proponerNotas({ texto: PEDIDO, video: video(), guion: null }, { claude })
    assert.equal(r.propuesta.length, 1, 'solo queda la que cita de verdad (mayúsculas, espacios y comillas no cuentan)')
    assert.equal(r.propuesta[0].hasta, null, 'hasta menor que segundo se saca')
    assert.ok(r.ajustes.some(a => /no aparece tal cual/.test(a) && /otra música/.test(a)))
    assert.ok(r.ajustes.some(a => /hasta/.test(a)))
  })
  test('tipo desconocido → otro; segundos fuera de rango → sin momento; más de 30 notas se cortan', async () => {
    const muchas = Array.from({ length: 35 }, (_, i) => ({ texto: `nota ${i}`, tipo: i === 0 ? 'magia' : 'texto', segundo: i === 1 ? 99999 : i, hasta: -1, afecta_rendimiento: false, motivo: '', cita: 'Hola!' }))
    const r = await P.proponerNotas({ texto: PEDIDO, video: video(), guion: null }, { claude: claudeQueDevuelve({ notas: muchas }) })
    assert.equal(r.propuesta.length, P.MAX_NOTAS_PROPUESTA)
    assert.equal(r.propuesta[0].tipo, 'otro')
    assert.equal(r.propuesta[1].segundo, null)
  })
  test('sin Claude (dry o sin key) → propuesta vacía: "cargá las notas a mano"; si Claude falla, igual (nunca lanza)', async () => {
    const r = await P.proponerNotas({ texto: PEDIDO, video: video(), guion: null }, { claude: null })
    assert.deepEqual(r.propuesta, [])
    assert.equal(r.aviso, P.SIN_CLAUDE)
    const falla = await P.proponerNotas({ texto: PEDIDO, video: video(), guion: null }, { claude: async () => { throw new Error('Claude respondió 529 https://api.anthropic.com/x') } })
    assert.deepEqual(falla.propuesta, [])
    assert.match(falla.aviso, /cargá las notas a mano/)
    assert.ok(!falla.aviso.includes('https://'), 'sin URLs en el aviso')
    const vacio = await P.proponerNotas({ texto: '   ', video: video(), guion: null }, { claude: claudeQueDevuelve({ notas: [] }) })
    assert.match(vacio.aviso, /vacío/)
  })
})

describe('P6: rondas y tope interno (regla de A, sin reescribirla)', () => {
  test(`el tope es ${TOPE_RONDAS_CLIENTE}: la ronda 3 la confirma solo Tomás`, () => {
    assert.equal(TOPE_RONDAS_CLIENTE, 2)
    assert.deepEqual(P.decidirRonda({ ronda_cliente: 0 }, AYLU), { ronda: 1, requiereTomas: false })
    assert.deepEqual(P.decidirRonda({ ronda_cliente: 1 }, AYLU), { ronda: 2, requiereTomas: false })
    assert.deepEqual(P.decidirRonda({ ronda_cliente: 2 }, AYLU), { ronda: 3, requiereTomas: true })
    assert.deepEqual(P.decidirRonda({ ronda_cliente: 2 }, TOMAS), { ronda: 3, requiereTomas: false })
    assert.deepEqual(P.decidirRonda({ ronda_cliente: 5 }, TOMAS), { ronda: 6, requiereTomas: false })
  })
  const repo = (respuestas = {}) => {
    const llamadas = []
    const fake = nombre => async p => { llamadas.push([nombre, p]); return respuestas[nombre] ?? { ok: true, actual: {} } }
    return { llamadas, repo: { aplicarPedidoCliente: fake('aplicar'), autorizarPedidoCliente: fake('autorizar'), descartarPedidoCliente: fake('descartar') } }
  }
  const ev = { id: 1, video_id: 7, id_crm: 'A101', cliente: 'Ana Pérez', tipo: 'bloqueo', de: null, a: null, actor: { tipo: 'persona', ...AYLU }, nota: '', datos: {}, cuando: '2026-10-24T12:00:00.000Z' }
  test('confirmar en la ronda 3 de Aylu: espera a Tomás con el aviso del motor (todo en una transacción de A)', async () => {
    const tope = { tipo: 'tope_rondas', video_id: 7, id_crm: 'A101', cliente: 'Ana Pérez', clave: 'T1-V2', ronda: 3, pedido_id: 9 }
    const { llamadas, repo: r } = repo({ aplicar: { ok: true, actual: { resultado: 'espera_tomas', video: video({ bloqueo: 'tope_rondas_cliente' }), pedido: {}, notas: [], eventos: [ev], extra: [tope] } } })
    const res = await P.confirmarPedido({ repo: r }, { pedido_id: 9, version: 1, elegidas: [0, 2], actor: AYLU })
    assert.equal(res.resultado, 'espera_tomas')
    assert.deepEqual(res.extra, [tope])
    assert.deepEqual(res.eventos, [ev])
    assert.deepEqual(llamadas, [['aplicar', { pedido_id: 9, version: 1, elegidas: [0, 2], actor: AYLU }]])
  })
  test('un conflicto (versión vieja) sale como ErrorPedido("conflicto"); René no autoriza; descartar pasa por A', async () => {
    const { repo: r } = repo({ aplicar: { ok: false, motivo: 'conflicto', actual: null, detalle: 'el pedido o el video cambiaron' } })
    await assert.rejects(P.confirmarPedido({ repo: r }, { pedido_id: 9, version: 1, elegidas: [0], actor: AYLU }), e => e instanceof P.ErrorPedido && e.motivo === 'conflicto')
    await assert.rejects(P.autorizarRonda({ repo: r }, { pedido_id: 9, version: 2, actor: AYLU }), e => e instanceof P.ErrorPedido && e.motivo === 'no_permitido')
    await assert.rejects(P.autorizarRonda({ repo: r }, { pedido_id: 9, version: 2, actor: RENE }), e => e instanceof P.ErrorPedido)
    const ok = repo({ autorizar: { ok: true, actual: { video: video({ estado: 'correccion' }), pedido: {}, evento: ev } } })
    assert.deepEqual(await P.autorizarRonda({ repo: ok.repo }, { pedido_id: 9, version: 2, actor: TOMAS }), { eventos: [ev] })
    const d = repo({ descartar: { ok: false, motivo: 'no_permitido', actual: null, detalle: 'el pedido está confirmado' } })
    await assert.rejects(P.descartarPedido({ repo: d.repo }, { pedido_id: 9, version: 2, nota: 'lo hablé con el cliente', actor: TOMAS }), /confirmado/)
    const d2 = repo()
    await P.descartarPedido({ repo: d2.repo }, { pedido_id: 9, version: 2, nota: 'x', actor: AYLU })
    assert.equal(d2.llamadas[0][0], 'descartar')
  })
})

describe('db/pedidos (Neon falso)', () => {
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    q.query = async texto => (/max\(version\)/.test(texto) ? [{ version: 999 }] : [])
    q.transaction = async xs => Promise.all(xs)
    return { consultas, fabrica: () => q }
  }
  beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
  afterEach(() => { base.sqlParaPruebas(null); delete process.env.DATABASE_URL })

  test('nuevoPedido: propuesta (sin Claude) + INSERT como propuesto, con creado_por = nombre y la ronda que sigue', async () => {
    const n = neonFalso(t => (t.startsWith('INSERT') ? [{ id: '12', video_id: '7', ronda: 3, texto: PEDIDO, propuesta: [], elegidas: [], estado: 'propuesto', creado_por: 'Aylu', creado: new Date(), version: 1 }] : []))
    base.sqlParaPruebas(n.fabrica)
    const r = await P.nuevoPedido({ repo: { crearPedido: DBP.crearPedido, aplicarPedidoCliente: null, autorizarPedidoCliente: null, descartarPedidoCliente: null }, claude: null },
      { video: video({ ronda_cliente: 2 }), guion: null, texto: PEDIDO, actor: AYLU })
    assert.equal(r.pedido.id, 12)
    assert.equal(r.pedido.estado, 'propuesto')
    assert.equal(r.propuesta.aviso, P.SIN_CLAUDE)
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_video_pedidos'))
    assert.ok(ins.valores.includes(3), 'ronda 3 (la que sigue)')
    assert.ok(ins.valores.includes('Aylu') && !ins.valores.includes('aylu@ejemplo.test'))
    await assert.rejects(P.nuevoPedido({ repo: { crearPedido: DBP.crearPedido } }, { video: video(), guion: null, texto: PEDIDO, actor: RENE }), e => e.motivo === 'no_permitido')
  })
  test('las lecturas no crean la tabla: si no existe, vacío', async () => {
    const n = neonFalso(() => { throw Object.assign(new Error('relation "cj_video_pedidos" does not exist'), { code: '42P01' }) })
    base.sqlParaPruebas(n.fabrica)
    assert.equal(await DBP.leerPedido(3), null)
    assert.deepEqual(await DBP.pedidosDeVideo(7), [])
    assert.deepEqual(await DBP.pedidosEsperandoTomas(), [])
    assert.ok(!n.consultas.some(c => /CREATE/.test(c.texto)))
  })
})
