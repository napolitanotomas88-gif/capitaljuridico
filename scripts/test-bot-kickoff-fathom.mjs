// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-fathom.mjs
// Varios Fathom (Tomás y Gero M) para el bot de kickoff: secretos de webhook por persona (lib/bot/kickoff/grabadores.ts), el
// cliente de la API de Fathom (lib/bot/kickoff/fathomApi.ts), el modo manual ?recording_id=…&quien=… de
// app/api/bot/kickoff/route.ts y el CLI scripts/fathom-webhook-kickoff.mjs. SIN red (fetch falso con respuestas armadas con
// la forma de la doc oficial de Fathom), SIN base (Neon falso) y SIN Claude ni Discord. Las keys, secretos, nombres, mails
// e ids de acá son inventados.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Antes de importar nada: entorno limpio (que ninguna variable real del shell active una llamada de verdad)
for (const k of Object.keys(process.env)) {
  if (/^FATHOM_/.test(k) || ['ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'DISCORD_WEBHOOK_KICKOFF', 'DISCORD_ID_TOMAS', 'DISCORD_ID_GERO_M', 'DATABASE_URL',
    'CRON_SECRET', 'META_ANUNCIOS_TOKEN', 'META_CLIENTES_TOKEN', 'AUTH_BASE_URL', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'CLICKUP_TOKEN'].includes(k)) delete process.env[k]
}
const RED_BLOQUEADA = async () => { throw new Error('red bloqueada en los tests') }
globalThis.fetch = RED_BLOQUEADA

const { firmar } = await import('../lib/fathomAnuncios/firma.ts')
const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')
const G = await import('../lib/bot/kickoff/grabadores.ts')
const F = await import('../lib/bot/kickoff/fathomApi.ts')
const registro = await import('../lib/bot/kickoff/registro.ts')
const CLI = await import('./fathom-webhook-kickoff.mjs')

const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const nuevoSecreto = () => `whsec_${randomBytes(24).toString('base64')}`
const SEC_TOMAS = nuevoSecreto(), SEC_GERO = nuevoSecreto(), SEC_VIEJO = nuevoSecreto(), SEC_OTRO = nuevoSecreto()
const KEY_TOMAS = `fk-tomas-${randomBytes(12).toString('hex')}`, KEY_GERO = `fk-gero-${randomBytes(12).toString('hex')}`
const ID = 555000111
const ahoraS = () => String(Math.floor(Date.now() / 1000))

// ── Respuestas de la API con la forma de la doc (Meeting, TranscriptItem, MeetingSummary, ActionItem, Invitee) ──
const hms = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
const renglonesApi = (n, cada = 30) => Array.from({ length: n }, (_, i) => ({
  speaker: { display_name: i % 2 ? 'Gero Mozzi' : 'Ana Pérez', matched_calendar_invitee_email: i % 2 ? 'gero@ejemplo.test' : null },
  text: `frase número ${i} de la kickoff`,
  timestamp: hms(i * cada),
}))
const reunionApi = (over = {}) => ({
  title: 'ANA PEREZ y Gero Mozzi', meeting_title: 'ANA PEREZ y Gero Mozzi', meeting_type: null, recording_id: ID,
  url: 'https://fathom.video/calls/424242', share_url: 'https://fathom.video/share/abcDEF123',
  created_at: '2026-10-23T12:25:00Z', scheduled_start_time: '2026-10-23T12:00:00Z', scheduled_end_time: '2026-10-23T12:45:00Z',
  recording_start_time: '2026-10-23T12:01:00Z', recording_end_time: '2026-10-23T12:24:00Z',
  calendar_invitees_domains_type: 'one_or_more_external', shared_with: 'no_teams', transcript_language: 'es',
  recorded_by: { name: 'Gero Mozzi', email: 'gero@ejemplo.test', email_domain: 'ejemplo.test', team: null },
  calendar_invitees: [
    { name: 'Gero Mozzi', matched_speaker_display_name: 'Gero Mozzi', email: 'gero@ejemplo.test', email_domain: 'ejemplo.test', is_external: false },
    { name: 'Ana Pérez', matched_speaker_display_name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true },
  ],
  action_items: [{
    description: 'Mandar la primera entrega de guiones', user_generated: false, completed: false, recording_timestamp: '00:12:00',
    recording_playback_url: 'https://fathom.video/calls/424242?timestamp=720', assignee: { name: 'Gero Mozzi', email: 'gero@ejemplo.test', team: null },
  }],
  highlights: [{ type: 'Bookmark', summary: 'presupuesto', start_time: 600, end_time: 620 }],
  crm_matches: null,
  ...over,
})
const TRANSCRIPT = { transcript: renglonesApi(40) }
const SUMMARY = { summary: { template_name: 'general', markdown_formatted: '## Summary\nKickoff for labor law (dismissals) in Mendoza.' } }
/** Lo que manda el webhook "new meeting content ready" para la misma reunión (Meeting con transcript, summary y tareas). */
const webhookDe = m => {
  const { highlights, crm_matches, shared_with, ...resto } = m
  void highlights; void crm_matches; void shared_with
  return { ...resto, transcript: TRANSCRIPT.transcript, default_summary: SUMMARY.summary }
}

const jsonRes = (x, status = 200, headers = {}) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json', ...headers } })

/**
 * Fathom falso: /meetings paginado (cursor "c1", "c2"…), transcript y summary de ID. `fallas[ruta]` puede devolver una
 * Response (o undefined para seguir normal) según el número de pedido a esa ruta. Anota cada pedido (url, método, key).
 */
function fathomFalso({ paginas = [[reunionApi()]], clave = KEY_GERO, fallas = {}, transcript = TRANSCRIPT, summary = SUMMARY } = {}) {
  const pedidos = []
  const porRuta = {}
  const f = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.host !== 'api.fathom.ai') throw new Error(`red bloqueada en los tests (${url.host})`)
    const h = new Headers(init.headers)
    const ruta = url.pathname.replace(/^\/external\/v1/, '')
    porRuta[ruta] = (porRuta[ruta] ?? 0) + 1
    pedidos.push({ url: url.href, ruta, metodo: init.method ?? 'GET', clave: h.get('x-api-key'), query: Object.fromEntries(url.searchParams) })
    const falla = fallas[ruta]?.(porRuta[ruta])
    if (falla) return falla
    if (h.get('x-api-key') !== clave) return jsonRes({ error: 'unauthorized' }, 401)
    if (ruta === '/meetings') {
      const i = Number((url.searchParams.get('cursor') ?? 'c0').slice(1))
      return jsonRes({ limit: 10, next_cursor: i + 1 < paginas.length ? `c${i + 1}` : null, items: paginas[i] ?? [] })
    }
    if (ruta === `/recordings/${ID}/transcript`) return jsonRes(transcript)
    if (ruta === `/recordings/${ID}/summary`) return jsonRes(summary)
    return jsonRes({ error: 'not found' }, 404)
  }
  return { f, pedidos }
}
const otraReunion = n => reunionApi({ recording_id: ID + n, url: `https://fathom.video/calls/${900 + n}`, title: `Otra ${n}` })
const sinEspera = () => { const esperas = []; return { esperas, esperar: async ms => { esperas.push(ms) } } }

// ── grabadores.ts: varios secretos de webhook ────────────────────────────────────────────────────
describe('grabadores: quién graba y con qué secreto', () => {
  test('quienDe y los nombres de las variables (iguales en el CLI)', () => {
    assert.equal(G.quienDe('gero_m'), 'gero_m')
    assert.equal(G.quienDe(' Gero-M '), 'gero_m')
    assert.equal(G.quienDe('GERO M'), 'gero_m')
    assert.equal(G.quienDe('Tomas'), 'tomas')
    assert.equal(G.quienDe('geroa'), null)
    assert.equal(G.quienDe(7), null)
    assert.equal(G.varSecreto('gero_m'), 'FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M')
    assert.equal(G.varApiKey('tomas'), 'FATHOM_API_KEY_TOMAS')
    assert.deepEqual(CLI.GRABADORES, JSON.parse(JSON.stringify(G.GRABADORES)), 'el CLI (.mjs puro) tiene que usar las mismas personas y sufijos')
    for (const q of G.QUIENES) {
      assert.equal(CLI.varSecreto(q), G.varSecreto(q))
      assert.equal(CLI.varApiKey(q), G.varApiKey(q))
    }
  })
  test('secretosWebhook: los de cada persona por nombre, el de compatibilidad al final (es de Tomás); vacíos y otras variables afuera', () => {
    const s = G.secretosWebhook({
      FATHOM_KICKOFF_WEBHOOK_SECRET: SEC_VIEJO, FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS: SEC_TOMAS, FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: ` ${SEC_GERO} `,
      FATHOM_KICKOFF_WEBHOOK_SECRET_VALEN: '  ', FATHOM_WEBHOOK_SECRET: SEC_OTRO, FATHOM_KICKOFF_WEBHOOK_SECRETX: SEC_OTRO,
    })
    assert.deepEqual(s.map(x => [x.variable, x.quien]), [
      ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M', 'gero_m'], ['FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS', 'tomas'], ['FATHOM_KICKOFF_WEBHOOK_SECRET', 'tomas'],
    ])
    assert.equal(s[0].valor, SEC_GERO, 'se recorta')
    assert.deepEqual(G.secretosWebhook({}), [])
  })
  test('lista cerrada: otra variable con el prefijo (un secreto viejo renombrado) NO autentica y queda en ignoradas', () => {
    const env = { FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO: SEC_VIEJO, FATHOM_KICKOFF_WEBHOOK_SECRET_OTRA_PERSONA: SEC_OTRO, FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: SEC_GERO, FATHOM_KICKOFF_WEBHOOK_SECRET_VACIA: ' ' }
    assert.deepEqual(G.secretosWebhook(env).map(x => x.variable), ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M'])
    assert.deepEqual(G.variablesIgnoradas(env), ['FATHOM_KICKOFF_WEBHOOK_SECRET_OTRA_PERSONA', 'FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO'])
    const ts = ahoraS(), c = '{}'
    const r = G.verificarFirmaVarios(G.secretosWebhook(env), { id: 'm', timestamp: ts, firma: firmar(SEC_VIEJO, 'm', ts, c) }, c)
    assert.deepEqual([r.ok, r.configurado], [false, true], 'firmado con el secreto viejo renombrado: 401')
    assert.deepEqual(G.estadoGrabadores(env).ignoradas, ['FATHOM_KICKOFF_WEBHOOK_SECRET_OTRA_PERSONA', 'FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO'])
    // Sin tope que deje afuera al de compatibilidad: con muchas variables ignoradas, el de compatibilidad sigue
    const muchas = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`FATHOM_KICKOFF_WEBHOOK_SECRET_X${i}`, SEC_OTRO]))
    assert.deepEqual(G.secretosWebhook({ ...muchas, FATHOM_KICKOFF_WEBHOOK_SECRET: SEC_VIEJO }).map(x => x.variable), ['FATHOM_KICKOFF_WEBHOOK_SECRET'])
  })
  test('un secreto corto (whsec_AA: 1 byte) es mal configurado: solo → 503; con otro bueno → 401 a la firma forjada', () => {
    const ts = ahoraS(), c = '{}'
    // Con una clave de 1 byte, un atacante prueba las 256: acá se firma con la clave verdadera del placeholder
    const forjada = { id: 'm', timestamp: ts, firma: firmar('whsec_AA', 'm', ts, c) }
    for (const corto of ['whsec_AA', 'whsec_dGVzdA==', `whsec_${randomBytes(23).toString('base64')}`]) {
      const solo = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: corto })
      const r = G.verificarFirmaVarios(solo, { id: 'm', timestamp: ts, firma: firmar(corto, 'm', ts, c) }, c)
      assert.deepEqual([r.ok, r.configurado, r.malConfigurados], [false, false, ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M']], corto)
    }
    const conBueno = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: 'whsec_AA', FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS: SEC_TOMAS })
    const r = G.verificarFirmaVarios(conBueno, forjada, c)
    assert.deepEqual([r.ok, r.configurado, r.malConfigurados], [false, true, ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M']])
    assert.equal(G.verificarFirmaVarios(conBueno, { id: 'm', timestamp: ts, firma: firmar(SEC_TOMAS, 'm', ts, c) }, c).ok, true)
    assert.equal(G.secretoUsable(`whsec_${randomBytes(24).toString('base64')}`), true, '24 bytes: el mínimo de Standard Webhooks')
    const e = G.estadoGrabadores({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: 'whsec_AA', FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS: SEC_TOMAS })
    assert.deepEqual([e.firmas, e.firmas_invalidas], [['FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS'], ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M']])
  })

  const cuerpo = JSON.stringify({ recording_id: ID, url: 'https://fathom.video/calls/1' })
  const cab = (secreto, ts = ahoraS(), c = cuerpo) => ({ id: 'msg_1', timestamp: ts, firma: firmar(secreto, 'msg_1', ts, c) })
  const ambos = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS: SEC_TOMAS, FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: SEC_GERO })

  test('Tomás válido y Gero M válido: cada uno verifica con el suyo y se sabe cuál (el nombre)', () => {
    assert.deepEqual(G.verificarFirmaVarios(ambos, cab(SEC_TOMAS), cuerpo), { ok: true, variable: 'FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS', quien: 'tomas', malConfigurados: [] })
    assert.deepEqual(G.verificarFirmaVarios(ambos, cab(SEC_GERO), cuerpo), { ok: true, variable: 'FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M', quien: 'gero_m', malConfigurados: [] })
    const r = G.verificarFirmaVarios(ambos, cab(SEC_GERO), cuerpo)
    assert.ok(!JSON.stringify(r).includes(SEC_GERO.slice(6)), 'el resultado no lleva el valor del secreto')
  })
  test('el de compatibilidad (FATHOM_KICKOFF_WEBHOOK_SECRET) sigue valiendo, como de Tomás', () => {
    const s = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET: SEC_VIEJO, FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: SEC_GERO })
    assert.deepEqual(G.verificarFirmaVarios(s, cab(SEC_VIEJO), cuerpo), { ok: true, variable: 'FATHOM_KICKOFF_WEBHOOK_SECRET', quien: 'tomas', malConfigurados: [] })
  })
  test('ninguno configurado → no configurado (503); firma de un secreto que no está → firma inválida (401)', () => {
    assert.deepEqual(G.verificarFirmaVarios([], cab(SEC_TOMAS), cuerpo), { ok: false, configurado: false, motivo: 'sin secretos configurados', malConfigurados: [] })
    const r = G.verificarFirmaVarios(ambos, cab(SEC_OTRO), cuerpo)
    assert.equal(r.ok, false)
    assert.equal(r.configurado, true)
    assert.equal(r.motivo, 'firma inválida')
  })
  test('firma vieja (más de 5 minutos) o cuerpo tocado: inválida aunque el secreto sea el bueno', () => {
    const viejo = String(Math.floor(Date.now() / 1000) - 600)
    const r = G.verificarFirmaVarios(ambos, cab(SEC_GERO, viejo), cuerpo)
    assert.equal(r.ok, false)
    assert.equal(r.configurado, true)
    assert.match(r.motivo, /5 minutos/)
    assert.equal(G.verificarFirmaVarios(ambos, cab(SEC_GERO), cuerpo.replace('1', '2')).ok, false)
  })
  test('uno solo configurado: la cuenta configurada entra, la otra no', () => {
    const solo = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: SEC_GERO })
    assert.equal(G.verificarFirmaVarios(solo, cab(SEC_GERO), cuerpo).ok, true)
    assert.equal(G.verificarFirmaVarios(solo, cab(SEC_TOMAS), cuerpo).ok, false)
  })
  test('se prueban TODOS (no corta en el primero que coincide): un mal formado posterior queda anotado igual', () => {
    const s = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: SEC_GERO, FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS: 'whsec_no es base64!' })
    const r = G.verificarFirmaVarios(s, cab(SEC_GERO), cuerpo)
    assert.equal(r.ok, true)
    assert.deepEqual(r.malConfigurados, ['FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS'], 'el de Tomás va después del de Gero M y se revisó igual')
    const todosMal = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: 'mal formado!', FATHOM_KICKOFF_WEBHOOK_SECRET: 'whsec_!!' })
    assert.deepEqual(G.verificarFirmaVarios(todosMal, cab(SEC_GERO), cuerpo), { ok: false, configurado: false, motivo: 'secreto mal configurado', malConfigurados: ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M', 'FATHOM_KICKOFF_WEBHOOK_SECRET'] })
  })
  test('estadoGrabadores: solo nombres (secretos usables, mal formados y de quién hay API key), nunca valores', () => {
    const e = G.estadoGrabadores({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: SEC_GERO, FATHOM_KICKOFF_WEBHOOK_SECRET: 'roto!', FATHOM_API_KEY_GERO_M: KEY_GERO, FATHOM_API_KEY_TOMAS: ' ' })
    assert.deepEqual(e, { firmas: ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M'], firmas_invalidas: ['FATHOM_KICKOFF_WEBHOOK_SECRET'], ignoradas: [], api: ['gero_m'] })
    assert.ok(!JSON.stringify(e).includes(KEY_GERO) && !JSON.stringify(e).includes(SEC_GERO))
  })
})

// ── fathomApi.ts: armado del payload ────────────────────────────────────────────────────────────
describe('fathomApi: armado del payload (el mismo del webhook)', () => {
  test('aHHMMSS: HH:MM:SS tal cual; M:SS, H:MM:SS y segundos se completan; lo raro → null', () => {
    assert.equal(F.aHHMMSS('00:05:32'), '00:05:32')
    assert.equal(F.aHHMMSS('5:32'), '00:05:32')
    assert.equal(F.aHHMMSS('75:10'), '01:15:10', 'minutos de más en M:SS pasan a horas')
    assert.equal(F.aHHMMSS('1:05:32'), '01:05:32')
    assert.equal(F.aHHMMSS('01:05:32.500'), '01:05:32')
    assert.equal(F.aHHMMSS(332), '00:05:32')
    assert.equal(F.aHHMMSS(332.9), '00:05:32')
    assert.equal(F.aHHMMSS('100:00:00'), '100:00:00')
    for (const x of ['00:61:00', '00:00:60', 'x', '', -1, NaN, null, undefined, {}]) assert.equal(F.aHHMMSS(x), null, String(x))
  })
  test('lista + transcripción + resumen → mismo resultado de validarReunion que el webhook de esa reunión', () => {
    const { payload, reunion } = F.armarPayload(reunionApi(), TRANSCRIPT, SUMMARY)
    const delWebhook = validarReunion(webhookDe(reunionApi()))
    assert.equal(delWebhook.ok, true)
    assert.deepEqual(reunion, delWebhook.reunion)
    // Los campos del payload: los del Meeting del webhook, sin highlights, crm_matches ni shared_with
    assert.deepEqual(Object.keys(payload).sort(), Object.keys(webhookDe(reunionApi())).sort())
    assert.equal(payload.scheduled_end_time, '2026-10-23T12:45:00Z', 'procesar.ts lo lee del payload crudo (fin agendado)')
    assert.equal(payload.transcript.length, 40)
    assert.deepEqual(payload.transcript[3], { speaker: { display_name: 'Gero Mozzi', matched_calendar_invitee_email: 'gero@ejemplo.test' }, text: 'frase número 3 de la kickoff', timestamp: '00:01:30' })
    assert.deepEqual(payload.default_summary, SUMMARY.summary)
    assert.equal(payload.action_items[0].description, 'Mandar la primera entrega de guiones')
    assert.deepEqual(payload.recorded_by, reunionApi().recorded_by)
  })
  test('transcripción como arreglo suelto o con timestamps en otro formato; renglones vacíos o sin hora afuera', () => {
    const tr = [
      { speaker: { display_name: 'Ana' }, text: 'hola', timestamp: '0:05' },
      { speaker: {}, text: '   ', timestamp: '00:00:10' },
      { speaker: { display_name: 'Gero' }, text: 'sin hora', timestamp: 'mañana' },
      { text: 'sin hablante', timestamp: 75 },
    ]
    const { payload } = F.armarPayload(reunionApi(), tr, null)
    assert.deepEqual(payload.transcript.map(r => [r.speaker.display_name, r.timestamp]), [['Ana', '00:00:05'], ['Sin nombre', '00:01:15']])
    assert.equal(payload.default_summary, null, 'sin resumen: null (como un webhook sin summary)')
  })
  test('el resumen que ya viene en la reunión se usa si no hay otro; tareas ausentes → null', () => {
    const { payload } = F.armarPayload(reunionApi({ default_summary: { template_name: 'x', markdown_formatted: 'y' }, action_items: undefined }), TRANSCRIPT, null)
    assert.deepEqual(payload.default_summary, { template_name: 'x', markdown_formatted: 'y' })
    assert.equal(payload.action_items, null)
  })
  test('sin transcripción, reunión que no es objeto o url que no es de fathom.video → ErrorFathomApi respuesta_invalida', () => {
    const esInvalida = re => e => e instanceof F.ErrorFathomApi && e.codigo === 'respuesta_invalida' && re.test(e.message)
    assert.throws(() => F.armarPayload(reunionApi(), { otra: 1 }, SUMMARY), esInvalida(/transcripción/))
    assert.throws(() => F.armarPayload(null, TRANSCRIPT, SUMMARY), esInvalida(/objeto/))
    assert.throws(() => F.armarPayload(reunionApi({ url: 'https://otro.test/calls/1' }), TRANSCRIPT, SUMMARY), esInvalida(/fathom\.video/))
  })
  test('transcripción vacía o con más de la mitad de las horas ilegibles → ErrorFathomApi (502): no se procesa ni queda "omitida"', () => {
    const esInvalida = re => e => e instanceof F.ErrorFathomApi && e.codigo === 'respuesta_invalida' && re.test(e.message)
    assert.throws(() => F.armarPayload(reunionApi(), { transcript: [] }, SUMMARY), esInvalida(/vacía: reintentá en unos minutos/))
    assert.throws(() => F.armarPayload(reunionApi(), [{ text: '  ', timestamp: '00:00:01' }], SUMMARY), esInvalida(/vacía/))
    const raras = renglonesApi(10).map((r, i) => (i < 6 ? { ...r, timestamp: `T+${i}s` } : r))
    assert.throws(() => F.armarPayload(reunionApi(), raras, SUMMARY), esInvalida(/horas ilegibles \(6 de 10 renglones\)/))
    // La mitad justa todavía pasa (los renglones con hora alcanzan); el resto se descarta como antes
    const mitad = renglonesApi(10).map((r, i) => (i < 5 ? { ...r, timestamp: 'x' } : r))
    assert.equal(F.armarPayload(reunionApi(), mitad, SUMMARY).payload.transcript.length, 5)
    assert.equal(F.estadoHttpDe(new F.ErrorFathomApi('respuesta_invalida', 'x')), 502)
  })
})

// ── fathomApi.ts: traer una reunión (fetch falso) ──────────────────────────────────────────────────
describe('fathomApi: traerReunion', () => {
  const env = { FATHOM_API_KEY_GERO_M: KEY_GERO, FATHOM_API_KEY_TOMAS: KEY_TOMAS }
  const op = (fake, extra = {}) => ({ env, fetch: fake.f, ...sinEspera(), ...extra })
  const sinKey = e => !e.message.includes(KEY_GERO) && !e.message.includes(KEY_TOMAS)

  test('pagina /meetings hasta encontrarla y pide transcripción y resumen; la key va SOLO en X-Api-Key', async () => {
    const fake = fathomFalso({ paginas: [[otraReunion(1), otraReunion(2)], [otraReunion(3), reunionApi()]] })
    const r = await F.traerReunion(ID, 'gero_m', op(fake, { creadoDesde: '2026-10-20' }))
    assert.equal(r.paginas, 2)
    assert.equal(r.quien, 'gero_m')
    assert.deepEqual(r.notas, [])
    assert.equal(r.reunion.recording_id, ID)
    assert.equal(r.reunion.url, 'https://fathom.video/calls/424242')
    assert.deepEqual(fake.pedidos.map(p => p.ruta), ['/meetings', '/meetings', `/recordings/${ID}/transcript`, `/recordings/${ID}/summary`])
    assert.ok(fake.pedidos.every(p => p.metodo === 'GET' && p.clave === KEY_GERO && !p.url.includes(KEY_GERO)))
    assert.ok(fake.pedidos.every(p => p.url.startsWith('https://api.fathom.ai/external/v1/')))
    assert.deepEqual(fake.pedidos[0].query, { include_action_items: 'true', created_after: '2026-10-20T00:00:00.000Z' })
    assert.equal(fake.pedidos[1].query.cursor, 'c1')
    assert.ok(!('include_transcript' in fake.pedidos[0].query), 'la transcripción no se pide en la lista (pedido pesado en cada página)')
    assert.deepEqual(r.reunion, validarReunion(webhookDe(reunionApi())).reunion)
  })
  test('con la key de Tomás usa la de Tomás', async () => {
    const fake = fathomFalso({ clave: KEY_TOMAS })
    await F.traerReunion(ID, 'tomas', op(fake))
    assert.ok(fake.pedidos.every(p => p.clave === KEY_TOMAS))
  })
  test('no está en ninguna página → no_encontrada (404) con la pista de la otra cuenta; con tope de páginas lo dice', async () => {
    const fake = fathomFalso({ paginas: [[otraReunion(1)], [otraReunion(2)]] })
    await assert.rejects(F.traerReunion(ID, 'gero_m', op(fake)), e => e.codigo === 'no_encontrada' && e.status === 404 && /cuenta de Fathom de Gero M.*otra persona/.test(e.message))
    assert.equal(fake.pedidos.length, 2, 'sin transcripción ni resumen si no la encontró')
    const muchas = fathomFalso({ paginas: Array.from({ length: 10 }, (_, i) => [otraReunion(i + 1)]) })
    await assert.rejects(F.traerReunion(ID, 'gero_m', op(muchas, { maxPaginas: 3 })), e => e.codigo === 'no_encontrada' && /se cortó en 3 páginas/.test(e.message))
    assert.equal(muchas.pedidos.length, 3)
  })
  test('un cursor repetido corta (no se queda dando vueltas)', async () => {
    let n = 0
    const f = async () => { n++; return jsonRes({ limit: 1, next_cursor: 'siempre', items: [otraReunion(n)] }) }
    await assert.rejects(F.traerReunion(ID, 'gero_m', { env, fetch: f, ...sinEspera() }), e => e.codigo === 'no_encontrada')
    assert.equal(n, 2)
  })
  test('sin la API key: sin_clave, sin llamar a Fathom', async () => {
    const fake = fathomFalso()
    await assert.rejects(F.traerReunion(ID, 'gero_m', { env: {}, fetch: fake.f }), e => e.codigo === 'sin_clave' && /FATHOM_API_KEY_GERO_M/.test(e.message) && /Settings → API Access/.test(e.message))
    assert.equal(fake.pedidos.length, 0)
    await assert.rejects(F.traerReunion(0, 'gero_m', { env, fetch: fake.f }), e => e.codigo === 'pedido_invalido')
    await assert.rejects(F.traerReunion(ID, 'geroa', { env, fetch: fake.f }), e => e.codigo === 'pedido_invalido')
  })
  test('401 y 403: errores claros, definitivos y sin la key', async () => {
    const e401 = await F.traerReunion(ID, 'gero_m', op(fathomFalso({ clave: 'otra-key' }))).catch(e => e)
    assert.equal(e401.codigo, 'no_autorizada')
    assert.equal(e401.transitorio, false)
    assert.match(e401.message, /API key de Fathom de Gero M \(FATHOM_API_KEY_GERO_M\) no es válida o se revocó \(401\)/)
    assert.ok(sinKey(e401))
    const e403 = await F.traerReunion(ID, 'gero_m', op(fathomFalso({ fallas: { '/meetings': () => jsonRes({}, 403) } }))).catch(e => e)
    assert.equal(e403.codigo, 'sin_permiso')
    assert.ok(sinKey(e403))
  })
  test('404 en la transcripción → no_encontrada; el resumen que falla no frena (queda en notas), salvo 401/403', async () => {
    const sinTr = fathomFalso({ fallas: { [`/recordings/${ID}/transcript`]: () => jsonRes({}, 404) } })
    await assert.rejects(F.traerReunion(ID, 'gero_m', op(sinTr)), e => e.codigo === 'no_encontrada' && /transcripción de la grabación 555000111/.test(e.message))
    const sinRes = fathomFalso({ fallas: { [`/recordings/${ID}/summary`]: () => jsonRes({}, 500) } })
    const r = await F.traerReunion(ID, 'gero_m', op(sinRes))
    assert.equal(r.payload.default_summary, null)
    assert.equal(r.notas.length, 1)
    assert.match(r.notas[0], /sin resumen de Fathom \(Fathom respondió 500/)
    const resProhibido = fathomFalso({ fallas: { [`/recordings/${ID}/summary`]: () => jsonRes({}, 403) } })
    await assert.rejects(F.traerReunion(ID, 'gero_m', op(resProhibido)), e => e.codigo === 'sin_permiso')
  })
  test('429 con Retry-After corto: espera y reintenta una vez; largo: error limite (transitorio) con los segundos, sin esperar', async () => {
    const corto = fathomFalso({ fallas: { '/meetings': n => (n === 1 ? jsonRes({}, 429, { 'retry-after': '2' }) : undefined) } })
    const espera = sinEspera()
    const r = await F.traerReunion(ID, 'gero_m', { env, fetch: corto.f, esperar: espera.esperar })
    assert.equal(r.reunion.recording_id, ID)
    assert.deepEqual(espera.esperas, [2000])
    const largo = fathomFalso({ fallas: { '/meetings': () => jsonRes({}, 429, { 'retry-after': '60' }) } })
    const e2 = sinEspera()
    const e = await F.traerReunion(ID, 'gero_m', { env, fetch: largo.f, esperar: e2.esperar }).catch(x => x)
    assert.equal(e.codigo, 'limite')
    assert.equal(e.transitorio, true)
    assert.equal(e.reintentarEnS, 60)
    assert.match(e.message, /429\): reintentar en 60 s/)
    assert.deepEqual(e2.esperas, [])
    assert.equal(F.estadoHttpDe(e), 429)
  })
  test('5xx: un reintento; si sigue, servidor (transitorio)', async () => {
    const una = fathomFalso({ fallas: { [`/recordings/${ID}/transcript`]: n => (n === 1 ? jsonRes({}, 502) : undefined) } })
    assert.equal((await F.traerReunion(ID, 'gero_m', op(una))).payload.transcript.length, 40)
    const siempre = fathomFalso({ fallas: { '/meetings': () => jsonRes({}, 503) } })
    const e = await F.traerReunion(ID, 'gero_m', op(siempre)).catch(x => x)
    assert.equal(e.codigo, 'servidor')
    assert.equal(e.transitorio, true)
    assert.equal(siempre.pedidos.length, 2)
    assert.equal(F.estadoHttpDe(e), 502)
  })
  test('timeout, red caída, JSON roto, lista sin items y deadline vencido: errores claros', async () => {
    const conFetch = f => F.traerReunion(ID, 'gero_m', { env, fetch: f, ...sinEspera() }).catch(e => e)
    const to = await conFetch(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) })
    assert.equal(to.codigo, 'timeout')
    assert.equal(F.estadoHttpDe(to), 504)
    const red = await conFetch(async () => { throw new TypeError('fetch failed') })
    assert.equal(red.codigo, 'red')
    assert.equal(red.transitorio, true)
    const roto = await conFetch(async () => new Response('<html>', { status: 200 }))
    assert.equal(roto.codigo, 'respuesta_invalida')
    const sinItems = await conFetch(async () => jsonRes({ limit: 1 }))
    assert.equal(sinItems.codigo, 'respuesta_invalida')
    let llamadas = 0
    const tarde = await F.traerReunion(ID, 'gero_m', { env, fetch: async () => { llamadas++; return jsonRes({}) }, deadline: Date.now() - 1 }).catch(e => e)
    assert.equal(tarde.codigo, 'timeout')
    assert.equal(llamadas, 0)
    for (const e of [to, red, roto, sinItems, tarde]) assert.ok(sinKey(e))
  })
  test('estadoHttpDe: sin clave 503, pedido inválido 400, no encontrada 404, 401/403 de Fathom → 502', () => {
    const e = c => new F.ErrorFathomApi(c, 'x')
    assert.deepEqual(['sin_clave', 'pedido_invalido', 'no_encontrada', 'no_autorizada', 'sin_permiso', 'respuesta_invalida'].map(c => F.estadoHttpDe(e(c))), [503, 400, 404, 502, 502, 502])
  })
})

// ── La ruta: varios secretos y modo manual con quien ─────────────────────────────────────────────
describe('app/api/bot/kickoff: varios Fathom', async () => {
  const { GET, POST } = await import('../app/api/bot/kickoff/route.ts')
  const URL_RUTA = 'http://localhost:3101/api/bot/kickoff'
  const CRON = 'cron-de-prueba-' + randomBytes(8).toString('hex')
  const firmado = (secreto, c, ts = ahoraS()) => ({ 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': firmar(secreto, 'msg_1', ts, c) })
  const post = (headers, body = '', qs = '') => POST(new Request(URL_RUTA + qs, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))
  const manual = qs => post({ authorization: `Bearer ${CRON}` }, '', qs)
  const limpiarFathom = () => { for (const k of Object.keys(process.env)) if (/^FATHOM_/.test(k)) delete process.env[k] }
  beforeEach(() => { process.env.CRON_SECRET = CRON; limpiarFathom(); delete process.env.DATABASE_URL; globalThis.fetch = RED_BLOQUEADA })
  afterEach(() => { registro.sqlParaPruebas(null); globalThis.fetch = RED_BLOQUEADA })

  // Un cuerpo firmado que NO es JSON: si la firma pasa, la ruta contesta 400 (JSON inválido) sin llegar a after()
  const ROTO = '{no'
  test('webhook: Tomás válido y Gero M válido pasan la firma; un secreto que no está, 401', async () => {
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS = SEC_TOMAS
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M = SEC_GERO
    assert.equal((await post(firmado(SEC_TOMAS, ROTO), ROTO)).status, 400)
    assert.equal((await post(firmado(SEC_GERO, ROTO), ROTO)).status, 400)
    const r = await post(firmado(SEC_OTRO, ROTO), ROTO)
    assert.equal(r.status, 401)
    assert.deepEqual(await r.json(), { error: 'firma inválida' })
  })
  test('webhook: sin ningún secreto → 503; firma vieja → 401; uno solo configurado → solo esa cuenta entra', async () => {
    let r = await post(firmado(SEC_TOMAS, ROTO), ROTO)
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'no configurado' })
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M = SEC_GERO
    assert.equal((await post(firmado(SEC_GERO, ROTO, String(Math.floor(Date.now() / 1000) - 600)), ROTO)).status, 401)
    assert.equal((await post(firmado(SEC_GERO, ROTO), ROTO)).status, 400)
    assert.equal((await post(firmado(SEC_TOMAS, ROTO), ROTO)).status, 401)
  })
  test('webhook: el secreto viejo (sin sufijo) sigue valiendo; uno mal formado no tapa al bueno; todos mal formados → 503', async () => {
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET = SEC_VIEJO
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M = 'whsec_no es base64!'
    const errores = []
    const original = console.error
    console.error = (...a) => errores.push(a.join(' '))
    try {
      assert.equal((await post(firmado(SEC_VIEJO, ROTO), ROTO)).status, 400)
      process.env.FATHOM_KICKOFF_WEBHOOK_SECRET = 'roto!'
      assert.equal((await post(firmado(SEC_VIEJO, ROTO), ROTO)).status, 503)
    } finally { console.error = original }
    assert.ok(errores.some(l => /FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M no es un secreto whsec_<base64> válido/.test(l)), errores.join('\n'))
  })
  test('webhook: un placeholder corto (whsec_AA) solo → 503; con otro bueno, la firma forjada con él → 401; una variable ignorada se loguea', async () => {
    const avisos = [], errores = []
    const [w, e] = [console.warn, console.error]
    console.warn = (...a) => avisos.push(a.join(' ')); console.error = (...a) => errores.push(a.join(' '))
    try {
      process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M = 'whsec_AA'
      assert.equal((await post(firmado('whsec_AA', ROTO), ROTO)).status, 503)
      process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS = SEC_TOMAS
      process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO = SEC_VIEJO
      assert.equal((await post(firmado('whsec_AA', ROTO), ROTO)).status, 401)
      assert.equal((await post(firmado(SEC_VIEJO, ROTO), ROTO)).status, 401, 'el secreto viejo renombrado no autentica')
      assert.equal((await post(firmado(SEC_TOMAS, ROTO), ROTO)).status, 400)
    } finally { console.warn = w; console.error = e }
    assert.ok(errores.some(l => /FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M no es un secreto whsec_<base64> válido \(de 24 bytes o más\)/.test(l)), errores.join('\n'))
    assert.ok(avisos.some(l => /FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO no autentica/.test(l)), avisos.join('\n'))
    assert.ok(![...avisos, ...errores].join('\n').includes(SEC_VIEJO.slice(6)), 'nunca el valor')
  })
  test('webhook válido: el log dice el NOMBRE del secreto que verificó (nunca el valor)', async () => {
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS = SEC_TOMAS
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M = SEC_GERO
    const cuerpo = JSON.stringify(webhookDe(reunionApi()))
    const logs = []
    const original = console.log
    console.log = (...a) => logs.push(a.join(' '))
    try {
      // Fuera de un pedido de Next, after() tira ("outside a request scope"): el log de la firma sale ANTES, y nada se procesa
      await post(firmado(SEC_GERO, cuerpo), cuerpo).catch(() => {})
    } finally { console.log = original }
    const linea = logs.find(l => /firmada con/.test(l))
    assert.equal(linea, `bot-kickoff: grabación ${ID} recibida, firmada con FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M (gero_m)`)
    assert.ok(!logs.join('\n').includes(SEC_GERO.slice(6)))
  })

  test('manual: quien inválido, quien sin recording_id o fechas raras → 400', async () => {
    assert.equal((await manual('?recording_id=123&quien=geroa')).status, 400)
    assert.match((await (await manual('?quien=gero_m')).json()).error, /quien va con recording_id/)
    assert.equal((await manual('?recording_id=123&quien=gero_m&desde=ayer')).status, 400)
  })
  test('manual: sin base y sin dry → 503 aunque venga quien; sin quien, el 503 de siempre', async () => {
    let r = await manual(`?recording_id=${ID}&quien=gero_m`)
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'falta DATABASE_URL' })
    r = await manual(`?recording_id=${ID}`)
    assert.deepEqual(await r.json(), { error: 'falta DATABASE_URL' })
  })
  test('manual con quien y dry, sin base ni API key → 503 que dice qué variable falta (sin llamar a Fathom)', async () => {
    let llamadas = 0
    globalThis.fetch = async () => { llamadas++; throw new Error('no debería salir') }
    const r = await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)
    assert.equal(r.status, 503)
    const j = await r.json()
    assert.equal(j.fathom, 'sin_clave')
    assert.match(j.error, /falta FATHOM_API_KEY_GERO_M/)
    assert.equal(llamadas, 0)
  })
  test('manual con quien y dry: la trae de Fathom (key de Gero M) y la procesa en seco; origen "fathom"', async () => {
    process.env.FATHOM_API_KEY_GERO_M = KEY_GERO
    const fake = fathomFalso()
    globalThis.fetch = fake.f
    const r = await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)
    const j = await r.json()
    assert.equal(j.origen, 'fathom')
    assert.deepEqual(j.fathom, { quien: 'gero_m', paginas: 1, notas: [] })
    assert.equal(j.recording_id, ID)
    // Sin clave de Claude en los tests: llega hasta la extracción y corta ahí, en seco (sin base ni Discord)
    assert.equal(j.estado, 'error')
    assert.equal(r.status, 500)
    assert.ok(fake.pedidos.length >= 3 && fake.pedidos.every(p => p.clave === KEY_GERO))
    assert.ok(!JSON.stringify(j).includes(KEY_GERO))
  })
  test('manual: errores de Fathom → estado HTTP claro (401 → 502, 404 → 404, 429 → 429 con Retry-After), sin la key', async () => {
    process.env.FATHOM_API_KEY_GERO_M = KEY_GERO
    globalThis.fetch = fathomFalso({ clave: 'revocada' }).f
    let r = await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)
    assert.equal(r.status, 502)
    let j = await r.json()
    assert.equal(j.fathom, 'no_autorizada')
    assert.match(j.error, /FATHOM_API_KEY_GERO_M/)
    assert.ok(!JSON.stringify(j).includes(KEY_GERO))
    globalThis.fetch = fathomFalso({ paginas: [[otraReunion(1)]] }).f
    r = await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)
    assert.equal(r.status, 404)
    globalThis.fetch = fathomFalso({ fallas: { '/meetings': () => jsonRes({}, 429, { 'retry-after': '45' }) } }).f
    r = await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)
    assert.equal(r.status, 429)
    assert.equal(r.headers.get('retry-after'), '45')
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  // Neon falso: solo responde la lectura del payload (las lecturas no crean la tabla)
  const conFila = fila => {
    process.env.DATABASE_URL = 'postgres://falsa.test/db'
    const consultas = []
    registro.sqlParaPruebas(() => async strings => {
      const texto = strings.join('?').replace(/\s+/g, ' ').trim()
      consultas.push(texto)
      // Desde el 24/10 la lectura trae también el grabador y duplicada_de (por to_jsonb: anda aunque la columna no exista)
      if (/^SELECT payload, estado, intentos, to_jsonb\(cj_kickoffs\) ->> 'grabador' AS grabador, to_jsonb\(cj_kickoffs\) ->> 'duplicada_de' AS duplicada_de FROM cj_kickoffs/.test(texto)) return fila ? [fila] : []
      throw new Error(`consulta inesperada en el test: ${texto}`)
    })
    return consultas
  }
  test('manual: con payload guardado se usa el del registro (no se le pide nada a Fathom), aunque venga quien', async () => {
    conFila({ payload: webhookDe(reunionApi()), estado: 'error', intentos: 2 })
    process.env.FATHOM_API_KEY_GERO_M = KEY_GERO
    const fake = fathomFalso()
    globalThis.fetch = fake.f
    const j = await (await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)).json()
    assert.equal(j.origen, 'registro')
    assert.equal(fake.pedidos.length, 0)
  })
  test('manual: fila terminada sin payload y sin forzar → "duplicada" sin pedirle nada a Fathom', async () => {
    const consultas = conFila({ payload: null, estado: 'lista', intentos: 1 })
    process.env.FATHOM_API_KEY_GERO_M = KEY_GERO
    const fake = fathomFalso()
    globalThis.fetch = fake.f
    const r = await manual(`?recording_id=${ID}&quien=gero_m`)
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.estado, 'duplicada')
    assert.match(j.motivo, /forzar=1/)
    assert.equal(fake.pedidos.length, 0)
    assert.equal(consultas.length, 1)
  })
  test('manual: una duplicada nombra la grabación que ganó (para reintentar esa) y no empuja a forzar; sin pedirle nada a Fathom', async () => {
    for (const q of ['', '&quien=gero_m']) {
      conFila({ payload: null, estado: 'duplicada', intentos: 1, grabador: 'gero_m', duplicada_de: '555' })
      process.env.FATHOM_API_KEY_GERO_M = KEY_GERO
      const fake = fathomFalso()
      globalThis.fetch = fake.f
      const r = await manual(`?recording_id=${ID}${q}`)
      assert.equal(r.status, 200, q)
      const j = await r.json()
      assert.deepEqual([j.estado, j.duplicada_de], ['duplicada', 555], q)
      assert.match(j.motivo, /es la misma reunión que la grabación 555: la ficha y el aviso son de esa \(para reintentar, usá recording_id=555\)/)
      assert.match(j.motivo, /Con &forzar=1 se arma OTRA ficha de la misma reunión y sale otro aviso/)
      assert.equal(fake.pedidos.length, 0)
    }
  })
  test('manual: fila en error sin payload (purgado) + quien + dry → la trae de Fathom', async () => {
    conFila({ payload: null, estado: 'error', intentos: 3 })
    process.env.FATHOM_API_KEY_GERO_M = KEY_GERO
    globalThis.fetch = fathomFalso().f
    const j = await (await manual(`?recording_id=${ID}&quien=gero_m&dry=1`)).json()
    assert.equal(j.origen, 'fathom')
  })
  test('manual sin quien: 404 / 409 que sugieren &quien= para traerla de Fathom', async () => {
    conFila(null)
    let r = await manual(`?recording_id=${ID}`)
    assert.equal(r.status, 404)
    assert.match((await r.json()).error, /&quien=tomas o &quien=gero_m/)
    conFila({ payload: null, estado: 'lista', intentos: 1 })
    r = await manual(`?recording_id=${ID}`)
    assert.equal(r.status, 409)
    assert.match((await r.json()).error, /&quien=/)
  })
  test('GET: sin nada de Fathom, igual que antes; con secretos y keys, sus NOMBRES (nunca valores)', async () => {
    const get = () => GET(new Request(URL_RUTA, { headers: { authorization: `Bearer ${CRON}` } }))
    let j = await (await get()).json()
    assert.equal(j.configurado.firma_fathom, false)
    assert.ok(!('fathom' in j))
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M = SEC_GERO
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS = 'roto!'
    process.env.FATHOM_API_KEY_TOMAS = KEY_TOMAS
    const texto = await (await get()).text()
    j = JSON.parse(texto)
    assert.equal(j.configurado.firma_fathom, true)
    assert.deepEqual(j.fathom, { firmas: ['FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M'], firmas_invalidas: ['FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS'], ignoradas: [], api: ['tomas'] })
    // Un secreto corto también es inválido, y una variable de más sale en ignoradas (solo nombres)
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS = 'whsec_AA'
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO = SEC_VIEJO
    j = await (await get()).json()
    assert.deepEqual([j.fathom.firmas_invalidas, j.fathom.ignoradas], [['FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS'], ['FATHOM_KICKOFF_WEBHOOK_SECRET_TOMAS_VIEJO']])
    assert.ok(!texto.includes(SEC_GERO.slice(6)) && !texto.includes(KEY_TOMAS))
  })
})

// ── El CLI (scripts/fathom-webhook-kickoff.mjs) ──────────────────────────────────────────────────
describe('CLI fathom-webhook-kickoff', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kickoff-fathom-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
  const correr = (args, env = {}) => {
    const limpio = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^FATHOM_/.test(k)))
    return spawnSync(process.execPath, ['scripts/fathom-webhook-kickoff.mjs', ...args, '--raiz', dir], { cwd: RAIZ, env: { ...limpio, ...env }, encoding: 'utf8', timeout: 20_000 })
  }
  const enMemoria = async (args, fetchImpl = RED_BLOQUEADA) => {
    const out = [], err = []
    const codigo = await CLI.main([...args, '--raiz', dir], { fetch: fetchImpl, log: t => out.push(t), err: t => err.push(t), env: {} })
    return { codigo, out: out.join('\n'), err: err.join('\n') }
  }

  test('parsearArgs: --quien normalizado, --opción=valor, desconocidas y faltantes con error', () => {
    assert.equal(CLI.parsearArgs(['--quien', 'Gero-M']).quien, 'gero_m')
    assert.equal(CLI.parsearArgs(['--quien=tomas', '--dry']).dry, true)
    assert.equal(CLI.parsearArgs(['--url=https://x.test/api/bot/kickoff?a=b']).url, 'https://x.test/api/bot/kickoff?a=b')
    assert.equal(CLI.parsearArgs([]).url, CLI.URL_POR_DEFECTO)
    assert.equal(CLI.URL_POR_DEFECTO, 'https://despacho-capital-juridico.vercel.app/api/bot/kickoff')
    assert.match(CLI.parsearArgs(['--quien', 'geroa']).error, /tomas o gero_m/)
    for (const heredado of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.match(CLI.parsearArgs(['--quien', heredado]).error, /tomas o gero_m/, heredado)
    assert.match(CLI.parsearArgs(['--borrar']).error, /necesita un valor/)
    assert.match(CLI.parsearArgs(['--quien', '--dry']).error, /necesita un valor/)
    assert.match(CLI.parsearArgs(['--nada']).error, /desconocida/)
  })
  test('--dry (proceso real): muestra el POST con el cuerpo de la doc y la key como marcador; sin key avisa; código 0', () => {
    const r = correr(['--quien', 'gero_m', '--dry'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /POST https:\/\/api\.fathom\.ai\/external\/v1\/webhooks/)
    assert.match(r.stdout, /X-Api-Key: <FATHOM_API_KEY_GERO_M, FALTA>/)
    assert.match(r.stdout, /"destination_url": "https:\/\/despacho-capital-juridico\.vercel\.app\/api\/bot\/kickoff"/)
    assert.match(r.stdout, /"triggered_for": \[\s*"my_recordings"\s*\]/)
    for (const k of ['include_transcript', 'include_summary', 'include_action_items']) assert.match(r.stdout, new RegExp(`"${k}": true`))
    assert.match(r.stdout, /FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M \(sin mostrarlo\)/)
    assert.match(r.stdout, /Settings → API Access/)
    assert.ok(!existsSync(join(dir, '.env.local')), 'en seco no escribe nada')
  })
  test('--dry con la key en .env.local: dice dónde está y no la muestra', () => {
    writeFileSync(join(dir, '.env.local'), `OTRA=1\nFATHOM_API_KEY_GERO_M="${KEY_GERO}"\n`)
    const r = correr(['--quien', 'gero_m', '--dry', '--url', 'https://preview.test/api/bot/kickoff'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /X-Api-Key: <FATHOM_API_KEY_GERO_M, en \.env\.local>/)
    assert.match(r.stdout, /no es el del Despacho/)
    assert.ok(!r.stdout.includes(KEY_GERO) && !r.stderr.includes(KEY_GERO))
    const b = correr(['--quien', 'gero_m', '--borrar', 'ikEoQ4bVoq4JYUmc', '--dry'])
    assert.equal(b.status, 0, b.stderr)
    assert.match(b.stdout, /DELETE https:\/\/api\.fathom\.ai\/external\/v1\/webhooks\/ikEoQ4bVoq4JYUmc/)
    assert.ok(!b.stdout.includes(KEY_GERO))
  })
  test('sin la API key (proceso real, sin --dry): explica qué falta y sale con 1; opciones malas también 1', () => {
    const r = correr(['--quien', 'tomas'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Falta FATHOM_API_KEY_TOMAS/)
    assert.match(r.stderr, /Fathom → Settings → API Access → Generate API key/)
    assert.equal(correr(['--quien', 'tomas', '--borrar', 'abc']).status, 1)
    assert.equal(correr([]).status, 1, 'sin --quien')
    assert.equal(correr(['--quien', 'geroa']).status, 1)
    assert.equal(correr(['--quien', 'tomas', '--url', 'http://inseguro.test/api/bot/kickoff']).status, 1)
  })
  test('--listar (proceso real): sin red, dice que la API no lista y qué hay por persona (sí/no)', () => {
    writeFileSync(join(dir, '.env.local'), `FATHOM_API_KEY_TOMAS=${KEY_TOMAS}\n`)
    const r = correr(['--listar'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /no tiene un pedido para listar webhooks/)
    assert.match(r.stdout, /FATHOM_API_KEY_TOMAS: sí \(en \.env\.local\)/)
    assert.match(r.stdout, /FATHOM_API_KEY_GERO_M: no/)
    assert.ok(!r.stdout.includes(KEY_TOMAS))
  })

  // Fathom falso para POST/DELETE /webhooks
  const fathomWebhooks = ({ status = 201, cuerpo } = {}) => {
    const pedidos = []
    const secreto = nuevoSecreto()
    const f = async (input, init = {}) => {
      const url = new URL(input)
      const h = new Headers(init.headers)
      pedidos.push({ url: url.href, metodo: init.method, clave: h.get('x-api-key'), cuerpo: init.body ? JSON.parse(init.body) : null })
      if (url.host !== 'api.fathom.ai') throw new Error('red bloqueada')
      if (init.method === 'POST') {
        const b = JSON.parse(init.body)
        return jsonRes(cuerpo ?? { id: 'ikEoQ4bVoq4JYUmc', url: b.destination_url, secret: secreto, created_at: '2026-10-24T18:00:00Z', include_transcript: true, include_crm_matches: false, include_summary: true, include_action_items: true, triggered_for: b.triggered_for }, status)
      }
      return new Response(null, { status: status === 201 ? 204 : status })
    }
    return { f, pedidos, secreto }
  }
  test('crear (fetch falso): POST con la key en X-Api-Key; el secreto va a .env.local SIN mostrarse; registro sin secretos', async () => {
    writeFileSync(join(dir, '.env.local'), `OTRA=1\nFATHOM_API_KEY_GERO_M=${KEY_GERO}`)   // sin salto de línea final: se agrega uno
    const fake = fathomWebhooks()
    const r = await enMemoria(['--quien', 'gero_m'], fake.f)
    assert.equal(r.codigo, 0, r.err)
    assert.equal(fake.pedidos.length, 1)
    assert.deepEqual(fake.pedidos[0], {
      url: 'https://api.fathom.ai/external/v1/webhooks', metodo: 'POST', clave: KEY_GERO,
      cuerpo: { destination_url: CLI.URL_POR_DEFECTO, triggered_for: ['my_recordings'], include_transcript: true, include_summary: true, include_action_items: true, include_crm_matches: false },
    })
    const env = readFileSync(join(dir, '.env.local'), 'utf8')
    assert.equal(env, `OTRA=1\nFATHOM_API_KEY_GERO_M=${KEY_GERO}\nFATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M=${fake.secreto}\n`)
    for (const t of [r.out, r.err]) assert.ok(!t.includes(fake.secreto) && !t.includes(fake.secreto.slice(6)) && !t.includes(KEY_GERO), 'ni el secreto ni la key en la salida')
    assert.match(r.out, /secreto guardado en \.env\.local como FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M \(no se muestra\)/)
    assert.match(r.out, /Cargar FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M en Vercel/)
    assert.match(r.out, /vercel env add FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M production/)
    const reg = readFileSync(join(dir, '.cache/fathom-webhooks-kickoff.json'), 'utf8')
    assert.ok(!reg.includes(fake.secreto.slice(6)) && !reg.includes(KEY_GERO))
    assert.equal(JSON.parse(reg)[0].id, 'ikEoQ4bVoq4JYUmc')
    // Y el secreto guardado es el que verifica los envíos de Gero M en la ruta
    const s = G.secretosWebhook({ FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: CLI.leerEnv(join(dir, '.env.local')).get('FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M') })
    const ts = ahoraS()
    assert.equal(G.verificarFirmaVarios(s, { id: 'm', timestamp: ts, firma: firmar(fake.secreto, 'm', ts, '{}') }, '{}').quien, 'gero_m')

    // Otra vez: la variable ya está → no se crea nada ni se pisa
    const otra = fathomWebhooks()
    const r2 = await enMemoria(['--quien', 'gero_m'], otra.f)
    assert.equal(r2.codigo, 1)
    assert.match(r2.err, /ya está en \.env\.local: no creo otro webhook/)
    assert.equal(otra.pedidos.length, 0)
    assert.equal(readFileSync(join(dir, '.env.local'), 'utf8'), env)

    // --listar muestra el creado
    const l = await enMemoria(['--listar', '--quien', 'gero_m'])
    assert.match(l.out, /webhook ikEoQ4bVoq4JYUmc → https:\/\/despacho-capital-juridico\.vercel\.app\/api\/bot\/kickoff/)
    assert.match(l.out, /FATHOM_KICKOFF_WEBHOOK_SECRET_GERO_M: sí/)

    // --borrar: DELETE con la key; queda anotado en el registro y avisa qué hacer con la variable
    const b = fathomWebhooks()
    const rb = await enMemoria(['--quien', 'gero_m', '--borrar', 'ikEoQ4bVoq4JYUmc'], b.f)
    assert.equal(rb.codigo, 0, rb.err)
    assert.deepEqual([b.pedidos[0].metodo, b.pedidos[0].url, b.pedidos[0].clave], ['DELETE', 'https://api.fathom.ai/external/v1/webhooks/ikEoQ4bVoq4JYUmc', KEY_GERO])
    assert.match(rb.out, /sigue en \.env\.local/)
    assert.ok(JSON.parse(readFileSync(join(dir, '.cache/fathom-webhooks-kickoff.json'), 'utf8'))[0].borrado)
  })
  test('crear: 401, 429, sin secreto en la respuesta o red caída → código 1, nada escrito y sin la key', async () => {
    const base = `FATHOM_API_KEY_TOMAS=${KEY_TOMAS}\n`
    writeFileSync(join(dir, '.env.local'), base)
    const casos = [
      [fathomWebhooks({ status: 401, cuerpo: { error: 'unauthorized' } }).f, /API key de Fathom de Tomás \(FATHOM_API_KEY_TOMAS\) no es válida/],
      [async () => jsonRes({}, 429, { 'retry-after': '30' }), /429\): probá de nuevo en 30 s/],
      [fathomWebhooks({ cuerpo: { id: 'sinSecreto1', url: CLI.URL_POR_DEFECTO } }).f, /sin un secreto whsec_… válido \(webhook sinSecreto1\).*--borrar sinSecreto1/],
      [async () => { throw new TypeError('fetch failed') }, /no se pudo conectar con Fathom/],
      [async () => jsonRes({ message: `destination_url inválida (${KEY_TOMAS})` }, 400), /400\): .*\[clave\]/],
    ]
    for (const [f, re] of casos) {
      const r = await enMemoria(['--quien', 'tomas'], f)
      assert.equal(r.codigo, 1)
      assert.match(r.err, re)
      assert.ok(!r.err.includes(KEY_TOMAS) && !r.out.includes(KEY_TOMAS))
      assert.equal(readFileSync(join(dir, '.env.local'), 'utf8'), base, 'no escribe nada')
    }
    const b = await enMemoria(['--quien', 'tomas', '--borrar', 'noExiste'], async () => new Response(null, { status: 404 }))
    assert.equal(b.codigo, 1)
    assert.match(b.err, /no encontró el webhook noExiste \(404\)/)
    assert.equal((await enMemoria(['--quien', 'tomas', '--borrar', 'id con espacios'])).codigo, 1)
  })
})
