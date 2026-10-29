// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-transcripcion.mjs
// Transcripción con AssemblyAI (P5) con un AssemblyAI de JUGUETE: envío con palabras clave y SIN el guion, cabecera secreta,
// corte por tamaño, duplicados, tope diario, palabras clave rechazadas, sin key / sin secreto, dry; el webhook (secreto malo
// 401, sin configurar 503, guardar y después borrar en AssemblyAI, reintento del borrado, link privado, adopción y huérfanas);
// el barrido de colgadas; y el cliente real con un fetch de juguete (la key solo en Authorization). SIN red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const T = await import('../lib/bot/grabacion/transcripcion.ts')
const AAI = await import('../lib/bot/grabacion/assemblyai.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')

const SECRETO = 'x'.repeat(20) + 'y'.repeat(20)
const archivo = (id, over = {}) => ({ id, drive_id: `drive${id}aaaaaaa`, nombre: `IMG_00${id}.MOV`, mime: 'video/quicktime', carpeta_id: 'c1', ruta: ['Tanda 1'], bytes: 300_000_000,
  duracion_ms: 60_000, ancho: 1080, alto: 1920, creado: '2026-10-24T10:00:00Z', modificado: '2026-10-24T10:00:00Z', subio: 'cliente', id_crm: 'A101', tipo: 'crudo', tanda_id: 5,
  inferido: { tanda_guion: 1, numero: 1, por: 'carpeta' }, video_id: 7, asignado_por: 'bot', propuesta_video_id: null,
  transcripcion: { estado: 'pendiente', proveedor_id: null, intentos: 0, motivo: '' }, borrado: null, visto: '2026-10-24T10:05:00Z', ...over })

function repoFalso(archivos = []) {
  const log = { anotar: [], guardar: [], borradas: [], reclamar: [] }
  const porId = new Map(archivos.map(a => [a.id, a]))
  return {
    log,
    repo: {
      pendientesDeTranscribir: async () => archivos.filter(a => a.transcripcion.estado === 'pendiente'),
      reclamarTranscripcion: async (id, s) => { log.reclamar.push([id, s]); return true },
      anotarTranscripcion: async (id, c) => { log.anotar.push([id, c]); const a = porId.get(id); if (a) a.transcripcion = { ...a.transcripcion, estado: c.estado, proveedor_id: c.proveedor_id ?? a.transcripcion.proveedor_id, motivo: c.motivo ?? '' } },
      guardarTranscripcion: async t => { log.guardar.push(t) },
      anotarBorradaProveedor: async (id, b) => { log.borradas.push([id, b]) },
      porProveedorId: async pid => archivos.find(a => a.transcripcion.proveedor_id === pid) ?? null,
      leerArchivo: async id => porId.get(id) ?? null,
      colgadas: async () => ({
        enviando: archivos.filter(a => a.transcripcion.estado === 'enviando'), enviada: archivos.filter(a => a.transcripcion.estado === 'enviada'),
        sinBorrar: archivos.filter(a => a.transcripcion.estado === 'lista' && a.__sinBorrar),
      }),
      segundosEnviadosDesde: async () => 0,
      buscarGemelo: async a => (a.__gemelo ?? null),
    },
  }
}

function aaiFalso(over = {}) {
  const log = { enviar: [], traer: [], borrar: [] }
  return {
    log,
    tr: {
      enviar: async p => { log.enviar.push(p); if (over.enviar) return over.enviar(p, log); return { id: `tr_${log.enviar.length}aaaa` } },
      traer: async id => { log.traer.push(id); return over.traer ? over.traer(id) : { id, estado: 'completed', error: null, texto: 'hola que tal', palabras: [[0, 300, 'hola'], [400, 700, 'que'], [800, 1000, 'tal']], duracion_ms: 1000, idioma: 'es', modelo: 'universal' } },
      borrar: async id => { log.borrar.push(id); if (over.borrar) return over.borrar(id) },
      listar: over.listar,
    },
  }
}

const deps = (r, a, over = {}) => ({ transcriptor: a ? a.tr : null, repo: r.repo, palabras: async () => ['ART', 'San Juan'], cliente: () => 'Ana Pérez',
  env: { ASSEMBLYAI_WEBHOOK_SECRETO: SECRETO }, ahora: () => new Date('2026-10-24T12:00:00Z'), modo: 'real', urlBase: 'https://despacho.ejemplo.test/', ...over })
const lejos = () => Date.now() + 60_000

describe('enviarPendientes', () => {
  test('manda el link de descarga de Drive con palabras clave y el webhook con ?archivo=; NUNCA el guion ni un prompt', async () => {
    const r = repoFalso([archivo(1)]), a = aaiFalso()
    const x = await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.equal(x.enviados, 1)
    const p = a.log.enviar[0]
    assert.equal(p.audioUrl, 'https://drive.usercontent.google.com/download?id=drive1aaaaaaa&export=download&confirm=t')
    assert.deepEqual(p.palabrasClave, ['ART', 'San Juan'])
    assert.equal(p.webhookUrl, 'https://despacho.ejemplo.test/api/bot/grabacion/transcripcion?archivo=1')
    assert.equal(p.secreto, SECRETO)
    assert.deepEqual(Object.keys(p).sort(), ['audioUrl', 'palabrasClave', 'secreto', 'webhookUrl'], 'sin guion ni prompt')
    assert.deepEqual(r.log.anotar.at(-1), [1, { estado: 'enviada', proveedor_id: 'tr_1aaaa', motivo: '' }])
    assert.deepEqual(r.log.reclamar, [[1, 60]])
  })
  test('corte por tamaño: más pesado que el tope → grande (plan B) y aviso, sin llamar a AssemblyAI', async () => {
    const r = repoFalso([archivo(2, { bytes: 6_000_000_000 })]), a = aaiFalso()
    const x = await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.equal(x.grandes, 1); assert.equal(a.log.enviar.length, 0)
    assert.equal(r.log.anotar[0][1].estado, 'grande'); assert.match(r.log.anotar[0][1].motivo, /6,0 GB: plan B/)
    assert.deepEqual(x.extra.map(e => [e.tipo, e.motivo]), [['transcripcion_fallida', 'grande']])
    // ASSEMBLYAI_MAX_BYTES pisa el tope
    const r2 = repoFalso([archivo(3, { bytes: 2_000_000_000 })])
    const y = await T.enviarPendientes(deps(r2, aaiFalso(), { env: { ASSEMBLYAI_WEBHOOK_SECRETO: SECRETO, ASSEMBLYAI_MAX_BYTES: '1000000000' } }), { deadline: lejos() })
    assert.equal(y.grandes, 1)
  })
  test('sin key: queda pendiente con el motivo, anotado UNA vez; sin secreto (o corto) tampoco se manda', async () => {
    const r = repoFalso([archivo(4)])
    await T.enviarPendientes(deps(r, null), { deadline: lejos() })
    await T.enviarPendientes(deps(r, null), { deadline: lejos() })
    assert.deepEqual(r.log.anotar, [[4, { estado: 'pendiente', motivo: 'falta ASSEMBLYAI_API_KEY' }]])
    const r2 = repoFalso([archivo(5)]), a = aaiFalso()
    await T.enviarPendientes(deps(r2, a, { env: { ASSEMBLYAI_WEBHOOK_SECRETO: 'corto' } }), { deadline: lejos() })
    assert.equal(a.log.enviar.length, 0); assert.match(r2.log.anotar[0][1].motivo, /ASSEMBLYAI_WEBHOOK_SECRETO/)
  })
  test('el mismo crudo subido dos veces no se transcribe de nuevo', async () => {
    const r = repoFalso([archivo(6, { __gemelo: 3 })]), a = aaiFalso()
    const x = await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.equal(x.duplicados, 1); assert.equal(a.log.enviar.length, 0)
    assert.deepEqual(r.log.anotar[0], [6, { estado: 'no_aplica', motivo: 'duplicado de #3' }])
  })
  test('tope de minutos por día: el que no entra hoy se saltea SIN frenar la cola; uno más corto entra igual', async () => {
    const r = repoFalso([archivo(7, { duracion_ms: 20 * 60_000 }), archivo(71, { duracion_ms: 5 * 60_000 })]), a = aaiFalso()
    r.repo.segundosEnviadosDesde = async () => 170 * 60
    const x = await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.equal(x.tope_diario, true)
    assert.equal(a.log.enviar.length, 1, 'el de 5 minutos entra en los 10 que quedan')
    assert.equal(r.log.reclamar[0][0], 71)
  })
  test('un crudo más largo que el tope ENTERO (Zoom de 3 h 10 min) pasa a `grande` (plan B) y no tapa la cola de todos', async () => {
    const r = repoFalso([archivo(70, { nombre: 'reunion-zoom.mp4', duracion_ms: 190 * 60_000, bytes: 650_000_000 }), archivo(72), archivo(73)]), a = aaiFalso()
    for (let k = 0; k < 2; k++) await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.deepEqual(r.log.anotar.find(([id]) => id === 70)[1].estado, 'grande')
    assert.match(r.log.anotar.find(([id]) => id === 70)[1].motivo, /más que el tope/)
    assert.equal(a.log.enviar.length, 2, 'los otros dos salen en la primera corrida')
  })
  test('duración estimada por el peso: a la baja del peso por minuto (sobreestima) y distinta para audio', () => {
    assert.equal(T.segundosEstimados({ duracion_ms: null, bytes: 60_000_000 }), 60)
    assert.equal(T.segundosEstimados({ duracion_ms: null, bytes: 150_000_000, mime: 'video/quicktime' }), 150)
    assert.equal(T.segundosEstimados({ duracion_ms: null, bytes: 90_000_000, mime: 'audio/mp4' }), 10_800, 'un m4a de 90 MB son unas 3 horas')
    assert.equal(T.segundosEstimados({ duracion_ms: 61_500, bytes: 1 }), 62)
  })
  test('pendiente de más de 48 h (el atraso de semanas sin key) → `vieja`, no se manda', async () => {
    const r = repoFalso([archivo(74, { creado: '2026-10-20T10:00:00Z' }), archivo(75)]), a = aaiFalso()
    const x = await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.equal(x.viejas, 1); assert.equal(a.log.enviar.length, 1)
    assert.equal(r.log.anotar.find(([id]) => id === 74)[1].estado, 'vieja')
  })
  test('palabras clave rechazadas (400): se reenvía una vez sin ellas y queda anotado', async () => {
    const r = repoFalso([archivo(8)])
    const a = aaiFalso({ enviar: (p, log) => { if (p.palabrasClave.length) throw new AAI.ErrorAssembly('AssemblyAI respondió 400: keyterms_prompt not supported', 400, 'palabras_clave'); return { id: 'tr_sinpalabras' } } })
    const x = await T.enviarPendientes(deps(r, a), { deadline: lejos() })
    assert.equal(x.enviados, 1); assert.equal(a.log.enviar.length, 2); assert.deepEqual(a.log.enviar[1].palabrasClave, [])
    assert.match(r.log.anotar.at(-1)[1].motivo, /sin ellas/)
  })
  test('error transitorio → vuelve a pendiente; error definitivo → error y aviso a Tomás', async () => {
    const r = repoFalso([archivo(9)])
    await T.enviarPendientes(deps(r, aaiFalso({ enviar: () => { throw new ErrorTransitorio('AssemblyAI respondió 503') } })), { deadline: lejos() })
    assert.equal(r.log.anotar.at(-1)[1].estado, 'pendiente')
    const r2 = repoFalso([archivo(10)])
    const x = await T.enviarPendientes(deps(r2, aaiFalso({ enviar: () => { throw new AAI.ErrorAssembly('AssemblyAI respondió 401', 401) } })), { deadline: lejos() })
    assert.equal(r2.log.anotar.at(-1)[1].estado, 'error'); assert.equal(x.extra[0].tipo, 'error')
  })
  test('dry: devuelve el plan sin reclamar, anotar ni llamar a AssemblyAI', async () => {
    const r = repoFalso([archivo(11), archivo(12, { bytes: 9e9 })]), a = aaiFalso()
    const x = await T.enviarPendientes(deps(r, a, { modo: 'dry' }), { deadline: lejos() })
    assert.equal(a.log.enviar.length, 0); assert.equal(r.log.anotar.length + r.log.reclamar.length, 0)
    assert.deepEqual(x.plan.map(p => p.accion), ['enviar a AssemblyAI', 'grande (9,0 GB): plan B'])
  })
})

describe('webhook', () => {
  const cuerpo = (status = 'completed', id = 'tr_abcdef') => ({ transcript_id: id, status })
  test('sin el secreto configurado → 503; cabecera distinta → 401; status raro → 200 sin hacer nada', () => {
    const r = repoFalso(), a = aaiFalso()
    assert.equal(T.atenderWebhook(deps(r, a, { env: {} }), { cabecera: SECRETO, archivo: null, cuerpo: cuerpo() }).status, 503)
    assert.equal(T.atenderWebhook(deps(r, a), { cabecera: 'otro', archivo: null, cuerpo: cuerpo() }).status, 401)
    assert.equal(T.atenderWebhook(deps(r, a), { cabecera: null, archivo: null, cuerpo: cuerpo() }).status, 401)
    const x = T.atenderWebhook(deps(r, a), { cabecera: SECRETO, archivo: null, cuerpo: cuerpo('processing') })
    assert.equal(x.status, 200); assert.equal(x.trabajo, null)
  })
  test('completed: traer → guardar en Neon → BORRAR en AssemblyAI → anotar el borrado (en ese orden)', async () => {
    const r = repoFalso([archivo(20, { transcripcion: { estado: 'enviada', proveedor_id: 'tr_abcdef', intentos: 1, motivo: '' } })]), a = aaiFalso()
    const orden = []
    r.repo.guardarTranscripcion = async t => { orden.push('guardar'); r.log.guardar.push(t) }
    a.tr.borrar = async id => { orden.push('borrar'); a.log.borrar.push(id) }
    let listo = 0
    const x = T.atenderWebhook(deps(r, a, { alListo: async () => { listo++ } }), { cabecera: SECRETO, archivo: '20', cuerpo: cuerpo() })
    assert.equal(x.status, 200)
    const res = await x.trabajo()
    assert.deepEqual(orden, ['guardar', 'borrar'])
    assert.equal(res.estado, 'lista'); assert.equal(res.borrada, true)
    assert.deepEqual(r.log.borradas, [[20, true]])
    assert.deepEqual(r.log.guardar[0].palabras[0], [0, 300, 'hola'])
    assert.equal(listo, 1, 'después de guardar, la comparación (cruce simple) si la tanda está completa')
  })
  test('si el borrado falla, queda marcado para que lo reintente el vigía (no se anota como borrada)', async () => {
    const r = repoFalso([archivo(21, { transcripcion: { estado: 'enviada', proveedor_id: 'tr_abcdef', intentos: 1, motivo: '' } })])
    const a = aaiFalso({ borrar: () => { throw new Error('503') } })
    const res = await T.atenderWebhook(deps(r, a), { cabecera: SECRETO, archivo: null, cuerpo: cuerpo() }).trabajo()
    assert.equal(res.borrada, false); assert.deepEqual(r.log.borradas, [])
  })
  test('error de descarga → link_privado (plan B) y aviso', async () => {
    const r = repoFalso([archivo(22, { transcripcion: { estado: 'enviada', proveedor_id: 'tr_abcdef', intentos: 1, motivo: '' } })])
    const a = aaiFalso({ traer: id => ({ id, estado: 'error', error: 'Download error, unable to download https://drive…', texto: '', palabras: [], duracion_ms: null, idioma: null, modelo: 'u' }) })
    const res = await T.atenderWebhook(deps(r, a), { cabecera: SECRETO, archivo: null, cuerpo: cuerpo('error') }).trabajo()
    assert.equal(res.estado, 'error')
    assert.match(r.log.anotar[0][1].motivo, /^link_privado: /)
    assert.deepEqual(res.extra.map(e => e.motivo), ['link_privado'])
  })
  test('transcript desconocido con ?archivo=: si el archivo no tiene otra, se adopta; si ya tiene otra, se borra en AssemblyAI', async () => {
    const r = repoFalso([archivo(23, { transcripcion: { estado: 'pendiente', proveedor_id: null, intentos: 1, motivo: 'reintento' } })]), a = aaiFalso()
    const res = await T.atenderWebhook(deps(r, a), { cabecera: SECRETO, archivo: '23', cuerpo: cuerpo('completed', 'tr_nuevo1') }).trabajo()
    assert.equal(res.estado, 'lista')
    assert.deepEqual(r.log.anotar[0], [23, { estado: 'enviada', proveedor_id: 'tr_nuevo1', motivo: 'adoptada por el webhook' }])
    const r2 = repoFalso([archivo(24, { transcripcion: { estado: 'enviada', proveedor_id: 'tr_otraaa', intentos: 2, motivo: '' } })]), a2 = aaiFalso()
    const res2 = await T.atenderWebhook(deps(r2, a2), { cabecera: SECRETO, archivo: '24', cuerpo: cuerpo('completed', 'tr_viejo1') }).trabajo()
    assert.match(res2.ignorado, /huérfana/); assert.deepEqual(a2.log.borrar, ['tr_viejo1']); assert.equal(r2.log.guardar.length, 0)
  })
  test('dry: 200 con lo que haría, sin trabajo', () => {
    const x = T.atenderWebhook(deps(repoFalso(), aaiFalso(), { modo: 'dry' }), { cabecera: SECRETO, archivo: '5', cuerpo: cuerpo() })
    assert.equal(x.status, 200); assert.equal(x.trabajo, null); assert.equal(x.cuerpo.dry, true)
  })
})

describe('barrerColgadas', () => {
  test('enviando de más de 10 min → pendiente; enviada → GET; listas sin borrar → se borran; huérfanas del proveedor → se borran', async () => {
    const arch = [
      archivo(30, { transcripcion: { estado: 'enviando', proveedor_id: null, intentos: 1, motivo: '' } }),
      archivo(31, { transcripcion: { estado: 'enviada', proveedor_id: 'tr_31aaaa', intentos: 1, motivo: '' } }),
      { ...archivo(32, { transcripcion: { estado: 'lista', proveedor_id: 'tr_32aaaa', intentos: 1, motivo: '' } }), __sinBorrar: true },
    ]
    const r = repoFalso(arch)
    const a = aaiFalso({ listar: async () => [{ id: 'tr_huerfa', estado: 'completed', creado: '' }, { id: 'tr_cola00', estado: 'processing', creado: '' }] })
    const x = await T.barrerColgadas(deps(r, a), { deadline: lejos(), listarProveedor: true })
    assert.equal(x.reenviar, 1); assert.equal(x.consultadas, 1); assert.equal(x.huerfanas, 1)
    assert.deepEqual(r.log.anotar[0], [30, { estado: 'pendiente', motivo: 'reintento: quedó enviando' }])
    assert.deepEqual(a.log.traer, ['tr_31aaaa'])
    assert.ok(a.log.borrar.includes('tr_31aaaa') && a.log.borrar.includes('tr_32aaaa') && a.log.borrar.includes('tr_huerfa'))
    assert.ok(!a.log.borrar.includes('tr_cola00'), 'una en proceso no se toca')
  })
  test('en dry o sin key no hace nada', async () => {
    const r = repoFalso([archivo(33, { transcripcion: { estado: 'enviando', proveedor_id: null, intentos: 1, motivo: '' } })])
    await T.barrerColgadas(deps(r, aaiFalso(), { modo: 'dry' }), { deadline: lejos() })
    await T.barrerColgadas(deps(r, null), { deadline: lejos() })
    assert.equal(r.log.anotar.length, 0)
  })
})

describe('cliente real de AssemblyAI (con fetch de juguete)', () => {
  test('sin key → null; POST con es, modelo, keyterms_prompt y el webhook; la key SOLO en Authorization; nunca prompt', async () => {
    assert.equal(AAI.transcriptorReal({}), null)
    const pedidos = []
    const f = async (url, init) => { pedidos.push({ url, init }); return new Response(JSON.stringify({ id: 'tr_123456' }), { status: 200 }) }
    const tr = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'clave-de-juguete' }, f)
    const r = await tr.enviar({ audioUrl: 'https://drive.usercontent.google.com/download?id=x', palabrasClave: ['ART'], webhookUrl: 'https://d.test/api/bot/grabacion/transcripcion?archivo=1', secreto: SECRETO })
    assert.equal(r.id, 'tr_123456')
    const p = pedidos[0], b = JSON.parse(p.init.body)
    assert.equal(p.url, 'https://api.assemblyai.com/v2/transcript')
    assert.equal(p.init.headers.Authorization, 'clave-de-juguete')
    assert.equal(b.language_code, 'es'); assert.deepEqual(b.keyterms_prompt, ['ART'])
    assert.deepEqual(b.speech_models, ['universal-3-5-pro', 'universal-2'], 'speech_models (lista); speech_model en singular está deprecado')
    assert.ok(!('speech_model' in b))
    assert.equal(b.webhook_auth_header_name, 'X-Edicion-Secreto'); assert.equal(b.webhook_auth_header_value, SECRETO)
    assert.ok(!('prompt' in b)); assert.ok(!p.url.includes('clave-de-juguete')); assert.ok(!p.init.body.includes('clave-de-juguete'))
  })
  test('ASSEMBLYAI_MODELO acepta una lista; un 400 que rechaza el modelo se reenvía UNA vez sin modelos (y queda el aviso)', async () => {
    assert.deepEqual(AAI.modelosConfigurados({ ASSEMBLYAI_MODELO: ' universal-2 , universal-3-5-pro ' }), ['universal-2', 'universal-3-5-pro'])
    assert.deepEqual(AAI.modelosConfigurados({ ASSEMBLYAI_MODELO: 'mal modelo!' }), ['universal-3-5-pro', 'universal-2'])
    const cuerpos = []
    const f = async (url, init) => {
      const b = JSON.parse(init.body); cuerpos.push(b)
      if (b.speech_models) return new Response(JSON.stringify({ error: 'Invalid speech_models value: universal-9' }), { status: 400 })
      return new Response(JSON.stringify({ id: 'tr_sinmodelo' }), { status: 200 })
    }
    const tr = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k', ASSEMBLYAI_MODELO: 'universal-9' }, f)
    const r = await tr.enviar({ audioUrl: 'https://a', palabrasClave: [], webhookUrl: 'https://b', secreto: SECRETO })
    assert.equal(r.id, 'tr_sinmodelo'); assert.equal(cuerpos.length, 2); assert.ok(!('speech_models' in cuerpos[1])); assert.match(r.aviso, /rechazó el modelo/)
    const t = await AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k' }, async () => new Response(JSON.stringify({ id: 'tr_123456', status: 'completed', text: '', words: [], speech_model_used: 'universal-2' }), { status: 200 })).traer('tr_123456')
    assert.equal(t.modelo, 'universal-2', 'el modelo que corrió sale de speech_model_used')
  })
  test('429 se reintenta una vez; dos 5xx seguidos → ErrorTransitorio; un 400 explica sin la URL; DELETE 404 está bien', async () => {
    let n = 0
    const tr = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k' }, async () => (++n === 1 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ id: 'tr_reint1' }), { status: 200 })))
    assert.equal((await tr.enviar({ audioUrl: 'https://a', palabrasClave: [], webhookUrl: 'https://b', secreto: SECRETO })).id, 'tr_reint1')
    const tr2 = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k' }, async () => new Response('', { status: 502 }))
    await assert.rejects(tr2.traer('tr_123456'), e => e.transitorio === true)
    const tr3 = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k' }, async () => new Response(JSON.stringify({ error: 'bad audio_url https://secreto.test/x' }), { status: 400 }))
    await assert.rejects(tr3.enviar({ audioUrl: 'https://a', palabrasClave: [], webhookUrl: 'https://b', secreto: SECRETO }), e => e.status === 400 && !e.message.includes('secreto.test'))
    const tr4 = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k' }, async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    await tr4.borrar('tr_123456')
  })
  test('traer: palabras [inicio_ms, fin_ms, texto] y duración en ms', async () => {
    const tr = AAI.transcriptorReal({ ASSEMBLYAI_API_KEY: 'k' }, async () => new Response(JSON.stringify({ id: 'tr_123456', status: 'completed', text: 'hola', words: [{ text: 'hola', start: 10, end: 300 }], audio_duration: 12.5, language_code: 'es' }), { status: 200 }))
    const t = await tr.traer('tr_123456')
    assert.deepEqual(t.palabras, [[10, 300, 'hola']]); assert.equal(t.duracion_ms, 12_500); assert.equal(t.estado, 'completed')
  })
  test('esFallaDescarga reconoce los errores de descarga', () => {
    assert.equal(AAI.esFallaDescarga('Download error: 403 Forbidden'), true)
    assert.equal(AAI.esFallaDescarga('Transcription failed: audio too short'), false)
  })
})
