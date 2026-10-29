// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-whapi.mjs
// BLOQUE W del bot de altas: webhook de Whapi (lib/bot/whapi/webhook.ts y ruta.ts), cliente real (cliente.ts y medios.ts),
// compuerta del modo (compuerta.ts e index.ts), cliente de juguete (juguete.ts) y el CLI scripts/bot-whapi-configurar.mjs.
// SIN red: el fetch global está bloqueado y cada prueba usa un fetch falso con respuestas armadas con la forma de la
// referencia de Whapi (OpenAPI 1.8.7) y de los ejemplos de soporte. SIN base ni motor real: la ruta se prueba con un motor
// de juguete. Los tokens, secretos, teléfonos, nombres e ids de acá son inventados.
import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Antes de importar nada: entorno limpio (que ninguna variable real del shell active una llamada de verdad)
for (const k of Object.keys(process.env)) {
  if (/^(WHAPI_|BOT_ALTA_)/.test(k) || ['CRON_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'DESPACHO_URL'].includes(k)) delete process.env[k]
}
const RED_BLOQUEADA = async () => { throw new Error('red bloqueada en los tests') }
globalThis.fetch = RED_BLOQUEADA

const W = await import('../lib/bot/whapi/webhook.ts')
const R = await import('../lib/bot/whapi/ruta.ts')
const C = await import('../lib/bot/whapi/cliente.ts')
const M = await import('../lib/bot/whapi/medios.ts')
const P = await import('../lib/bot/whapi/compuerta.ts')
const I = await import('../lib/bot/whapi/index.ts')
const J = await import('../lib/bot/whapi/juguete.ts')
const CFG = await import('../lib/bot/whapi/config.ts')
const E = await import('../lib/bot/whapi/errores.ts')
const AJ = await import('../lib/bot/whapi/ajustes.ts')
const CLI = await import('./bot-whapi-configurar.mjs')
const { PLAZO_INVOCACION_MS } = await import('../lib/bot/alta/motor/tipos.ts')
// WhatsApp seguro (26/10/2026): estos tests prueban el mapeo HTTP, la compuerta y la ruta, no la guardia de salud del número
// (que antes de cada escritura pide GET /health y rompería las colas de respuestas de los fetch falsos). La guardia queda
// abierta acá; sus pruebas están en scripts/test-whatsapp-seguro.mjs.
const SALUD = await import('../lib/bot/whapi/salud.ts')
SALUD.fijarGuardiaParaPruebas(SALUD.GUARDIA_ABIERTA)

const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const SECRETO = randomBytes(24).toString('base64url')
const TOKEN = `tok-${randomBytes(16).toString('hex')}`
const AHORA = Date.parse('2026-10-24T15:00:00Z')
const TS = Math.floor(AHORA / 1000) - 30
const CLOSER = '5491155550001'
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex')

const TEXTO_ALTA = [
  '#ALTA', 'Closer: Marcos', 'Programa: Agencia', 'Tipo de pago: PP 3300 USD', 'Este pago: 1100 USD · Transferencia USD (Galicia)',
  'Nombre completo: Ana Pérez Inventada', 'Teléfono: +54 9 11 5555 0099', 'Correo: ana@ejemplo.test',
].join('\n')

/** Un mensaje de Whapi (forma de Message de la referencia). */
const msg = (over = {}) => ({
  id: `msg-${randomBytes(6).toString('hex')}-AbCd`, from_me: false, type: 'text', chat_id: GRUPOS.ventas, timestamp: TS,
  source: 'mobile', text: { body: 'hola' }, from: CLOSER, from_name: 'Marcos', ...over,
})
const envio = (messages, extra = {}) => ({ messages, event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-PRUEBA1', ...extra })
const clasificarUno = (m, ahora = AHORA) => W.clasificar(W.normalizarMensaje(m), GRUPOS, ahora)

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('envoltura y normalización (ejemplos de la ficha de Whapi)', () => {
  test('texto en grupo (ejemplo textual de la doc de grupos): id, chat, autor y texto', () => {
    const ej = { messages: [{ id: '.juaBlBX6cgpT8UKLNnVEw-kh8Bq53B6TdEoQ-E8JdK1c', from_me: false, type: 'text', chat_id: '120363000000001001@g.us', timestamp: 1713791337, source: 'mobile', text: { body: "Hey, what's up" }, from: '919984351847', from_name: 'Gerald' }], event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-M72HC' }
    const env = W.leerEnvoltura(ej)
    assert.equal(env.canalId, 'MANTIS-M72HC')
    assert.deepEqual(env.evento, { tipo: 'messages', metodo: 'post' })
    const m = W.normalizarMensaje(env.mensajes[0])
    assert.equal(m.id, '.juaBlBX6cgpT8UKLNnVEw-kh8Bq53B6TdEoQ-E8JdK1c')
    assert.equal(m.chatId, '120363000000001001@g.us')
    assert.deepEqual(m.autor, { telefono: '919984351847', lid: null, nombre: 'Gerald' })
    assert.equal(m.texto, "Hey, what's up")
    assert.equal(m.enviadoEn, new Date(1713791337000).toISOString())
  })
  test('documento PDF con link (ejemplo de la doc): RefMedio completo y el link NO se guarda (auto_download apagado)', () => {
    const m = W.normalizarMensaje(msg({
      type: 'document', text: undefined,
      document: { id: 'pdf-b487668896662779cbdb29a3c29c0a9a-804713c25d2b57', mime_type: 'application/pdf', file_size: 1438781, sha256: 'TdxdgX8lBzV6/SYW96F/BEh19ob0eFAn4wKAWhWpUyk=', file_name: 'File_example.pdf', link: 'https://s3.eu-central-1.wasabisys.com/in-files/61371989950/pdf.pdf', caption: 'This is text with file', filename: 'File_example.pdf', page_count: 14, preview: 'data:image/jpeg;base64,xx' },
    }))
    assert.deepEqual(m.medio, {
      id: 'pdf-b487668896662779cbdb29a3c29c0a9a-804713c25d2b57', tipo: 'document', mime: 'application/pdf', tamano: 1438781,
      sha256Whapi: 'TdxdgX8lBzV6/SYW96F/BEh19ob0eFAn4wKAWhWpUyk=', nombreArchivo: 'File_example.pdf', link: null, paginas: 14, pie: 'This is text with file',
    })
    assert.equal(m.texto, 'This is text with file')
  })
  test('mensaje citado (context de la doc): quoted_id y quoted_author; quoted_author como { id, phone } también', () => {
    const m = W.normalizarMensaje(msg({ context: { quoted_id: 'yqJRppZk7BI-wNoTwl0rVw', quoted_author: '61371989950', quoted_content: { body: 'Hello from API' }, quoted_type: 'text' } }))
    assert.deepEqual(m.citado, { id: 'yqJRppZk7BI-wNoTwl0rVw', autor: '61371989950' })
    const m2 = W.normalizarMensaje(msg({ context: { quoted_id: 'abcd-efgh', quoted_author: { id: '123456789012@lid', phone: '5491100000000' } } }))
    assert.deepEqual(m2.citado, { id: 'abcd-efgh', autor: '5491100000000' })
  })
  test('autor @lid: sin phone queda solo el lid; con phone (data_mode extend) quedan los dos', () => {
    assert.deepEqual(W.normalizarMensaje(msg({ from: '208163112345678@lid' })).autor, { telefono: null, lid: '208163112345678@lid', nombre: 'Marcos' })
    assert.deepEqual(W.normalizarMensaje(msg({ from: '208163112345678@lid', phone: '972559645430' })).autor, { telefono: '972559645430', lid: '208163112345678@lid', nombre: 'Marcos' })
    assert.equal(W.normalizarMensaje(msg({ from: '5491155550001@s.whatsapp.net' })).autor.telefono, '5491155550001')
  })
  test('forma mínima: sin id, chat, timestamp o from_me no hay mensaje', () => {
    for (const k of ['id', 'chat_id', 'timestamp', 'from_me', 'type']) assert.equal(W.normalizarMensaje(msg({ [k]: undefined })), null, k)
    assert.equal(W.normalizarMensaje('texto'), null)
    assert.equal(W.leerEnvoltura([1, 2]), null)
  })
  test('envoltura con varios mensajes: #ALTA + comprobante + charla → 2 eventos y 1 descarte', () => {
    const r = W.clasificarEnvoltura(envio([
      msg({ id: 'a-1111', text: { body: TEXTO_ALTA } }),
      msg({ id: 'a-2222', type: 'image', text: undefined, image: { id: 'jpeg-0a1b2c3d4e5f', mime_type: 'image/jpeg', file_size: 120000, sha256: 'x' } }),
      msg({ id: 'a-3333', text: { body: 'buen día equipo' } }),
    ]), GRUPOS, AHORA)
    assert.deepEqual(r.eventos.map((e) => e.tipo), ['alta', 'adjunto'])
    assert.deepEqual(r.descartes, { charla: 1 })
    assert.equal(r.total, 3)
    assert.equal(W.resumenEventos(r.eventos), 'alta:1 adjunto:1')
  })
  test('statuses (sin messages) → ningún evento; un messages_updates de forma desconocida se descarta', () => {
    const s = W.clasificarEnvoltura({ statuses: [{ id: 'x', status: 'read' }], event: { type: 'statuses', event: 'post' } }, GRUPOS, AHORA)
    assert.equal(s.eventos.length, 0)
    assert.equal(s.total, 0)
    const u = W.clasificarEnvoltura({ messages_updates: [{ id: 'x', algo: 1 }, { id: 'y', after_update: msg(), changes: ['poll'] }], event: { type: 'messages', event: 'patch' } }, GRUPOS, AHORA)
    assert.equal(u.eventos.length, 0)
    assert.deepEqual(u.descartes, { forma: 1, accion: 1 })
  })
  test('álbum (ejemplo de la doc) en Ventas → EventoAdjunto sin medios y con albumEsperado', () => {
    const c = clasificarUno(msg({ type: 'album', text: undefined, album: { expectedImageCount: 10, expectedVideoCount: 0 } }))
    assert.equal(c.evento.tipo, 'adjunto')
    assert.deepEqual(c.evento.medios, [])
    assert.equal(c.evento.albumEsperado, 10)
    assert.deepEqual(clasificarUno(msg({ type: 'album', text: undefined, album: { expectedImageCount: 0, expectedVideoCount: 2 } })), { descarte: 'tipo' })
  })
  test('mensajes propios: from_me de la API en los grupos → eco (con el id y el texto); desde el teléfono o en otro chat → descarte', () => {
    const eco = clasificarUno(msg({ id: 'eco-1234', from_me: true, source: 'api', chat_id: GRUPOS.verificaciones, text: { body: 'Alta de Ana: hace falta un OK' }, from: '5490000000000' }))
    assert.equal(eco.evento.tipo, 'eco')
    assert.equal(eco.evento.grupo, 'verificaciones')
    assert.equal(eco.evento.mensajeId, 'eco-1234')
    assert.equal(eco.evento.texto, 'Alta de Ana: hace falta un OK')
    const video = clasificarUno(msg({ from_me: true, source: 'api', type: 'video', text: undefined, video: { id: 'mp4-0a1b2c', mime_type: 'video/mp4', caption: 'Hola Ana!' } }))
    assert.equal(video.evento.tipo, 'eco')
    assert.equal(video.evento.texto, 'Hola Ana!')
    assert.deepEqual(clasificarUno(msg({ from_me: true, source: 'mobile' })), { descarte: 'propio' })
    // Revisión del 24/10: el eco de la API en otro grupo (el General de un cliente: la bienvenida) también pasa, con grupo null
    const general = clasificarUno(msg({ id: 'eco-general-1', from_me: true, source: 'api', type: 'video', chat_id: '120363999999999999@g.us', text: undefined, video: { id: 'mp4-aa-bb', caption: 'Hola Ana! Cómo va?' } }))
    assert.deepEqual([general.evento.tipo, general.evento.grupo, general.evento.texto], ['eco', null, 'Hola Ana! Cómo va?'])
    assert.deepEqual(clasificarUno(msg({ from_me: true, source: 'api', chat_id: '120363999999999999@g.us', type: 'sticker', text: undefined })), { descarte: 'propio' })
    assert.deepEqual(clasificarUno(msg({ from_me: true, source: 'api', chat_id: `${CLOSER}@s.whatsapp.net` })), { descarte: 'propio' })   // un privado no
  })
  test('edición por type "action" (edit) de un #ALTA → EventoEdicion con mensajeId = el editado y clave ed:<id>:<sha>', () => {
    const c = clasificarUno(msg({ id: 'acc-9999', type: 'action', text: undefined, action: { type: 'edit', target: 'orig-1234', edited_content: { body: `${TEXTO_ALTA}\nDNI: 30111222` } } }))
    assert.equal(c.evento.tipo, 'edicion')
    assert.equal(c.evento.mensajeId, 'orig-1234')
    assert.equal(c.evento.clave, `ed:orig-1234:${sha(`${TEXTO_ALTA}\nDNI: 30111222`)}`)
    assert.equal(c.evento.citado, null)
    // Otra acción (reacción) o una edición de charla: se descartan
    assert.deepEqual(clasificarUno(msg({ type: 'action', text: undefined, action: { type: 'reaction', target: 'x', emoji: '👍' } })), { descarte: 'accion' })
    assert.deepEqual(clasificarUno(msg({ type: 'action', text: undefined, action: { type: 'edited', target: 'x', edited_content: { body: 'jaja' } } })), { descarte: 'charla' })
  })
  test('la misma edición por type "action" y por messages.patch (after_update) se guarda UNA vez (misma clave)', () => {
    const nuevo = `${TEXTO_ALTA}\nCUIT: 20-30111222-3`
    const r = W.clasificarEnvoltura({
      messages: [msg({ type: 'action', text: undefined, action: { type: 'edit', target: 'orig-5555', edited_content: { body: nuevo } } })],
      messages_updates: [{
        id: 'orig-5555',
        trigger: msg({ type: 'action', text: undefined, action: { type: 'edit', target: 'orig-5555', edited_content: { body: nuevo } } }),
        before_update: msg({ id: 'orig-5555', text: { body: TEXTO_ALTA } }),
        after_update: msg({ id: 'orig-5555', text: { body: nuevo } }),
        changes: ['text'],
      }],
    }, GRUPOS, AHORA)
    assert.equal(r.eventos.length, 1)
    assert.equal(r.eventos[0].clave, W.claveEdicion('orig-5555', nuevo))
    assert.deepEqual(r.descartes, { repetido: 1 })
  })
  test('messages.patch: sin cambio de texto, del propio bot o en Verificaciones → descarte', () => {
    const base = { id: 'orig-1', trigger: msg({ type: 'action', text: undefined, action: { type: 'edit', target: 'orig-1' } }) }
    assert.deepEqual(W.clasificarActualizacion({ ...base, before_update: msg({ text: { body: TEXTO_ALTA } }), after_update: msg({ text: { body: TEXTO_ALTA } }) }, GRUPOS, AHORA), { descarte: 'charla' })
    assert.deepEqual(W.clasificarActualizacion({ ...base, after_update: msg({ from_me: true, text: { body: TEXTO_ALTA } }) }, GRUPOS, AHORA), { descarte: 'propio' })
    assert.deepEqual(W.clasificarActualizacion({ ...base, after_update: msg({ chat_id: GRUPOS.verificaciones, text: { body: 'OK' } }) }, GRUPOS, AHORA), { descarte: 'tipo' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('filtro: qué genera evento y qué no', () => {
  test('otro grupo y un privado no generan evento', () => {
    assert.deepEqual(clasificarUno(msg({ chat_id: '120363111111111111@g.us', text: { body: TEXTO_ALTA } })), { descarte: 'otro_chat' })
    assert.deepEqual(clasificarUno(msg({ chat_id: `${CLOSER}@s.whatsapp.net`, text: { body: TEXTO_ALTA } })), { descarte: 'otro_chat' })
  })
  test('más de 48 h de atraso (sincronización al reconectar) → descarte; 47 h pasa', () => {
    assert.deepEqual(clasificarUno(msg({ timestamp: TS - 49 * 3600, text: { body: TEXTO_ALTA } })), { descarte: 'viejo' })
    assert.equal(clasificarUno(msg({ timestamp: Math.floor(AHORA / 1000) - 47 * 3600, text: { body: TEXTO_ALTA } })).evento.tipo, 'alta')
  })
  test('#ALTA en texto → EventoAlta sin medios; en el pie de una imagen → EventoAlta con el medio', () => {
    const t = clasificarUno(msg({ text: { body: TEXTO_ALTA } }))
    assert.equal(t.evento.tipo, 'alta')
    assert.equal(t.evento.texto, TEXTO_ALTA)
    assert.deepEqual(t.evento.medios, [])
    assert.equal(t.evento.autor.telefono, CLOSER)
    const i = clasificarUno(msg({ type: 'image', text: undefined, image: { id: 'jpeg-0a1b2c', mime_type: 'image/jpeg', file_size: 9000, caption: TEXTO_ALTA } }))
    assert.equal(i.evento.tipo, 'alta')
    assert.equal(i.evento.medios.length, 1)
    assert.equal(i.evento.medios[0].id, 'jpeg-0a1b2c')
    assert.equal(i.evento.texto, TEXTO_ALTA)
    // link_preview (un #ALTA con un link) y documentWithCaption también
    assert.equal(clasificarUno(msg({ type: 'link_preview', text: undefined, link_preview: { body: `${TEXTO_ALTA}\nhttps://ejemplo.test` } })).evento.tipo, 'alta')
    assert.equal(clasificarUno(msg({ type: 'documentWithCaption', text: undefined, document: { id: 'pdf-0a1b', mime_type: 'application/pdf', caption: TEXTO_ALTA } })).evento.medios.length, 1)
  })
  test('imagen sola o PDF sin #ALTA → EventoAdjunto; un .docx suelto se descarta, pero con #ALTA en el pie pasa', () => {
    const img = clasificarUno(msg({ type: 'image', text: undefined, image: { id: 'jpeg-0a1b2c', mime_type: 'image/jpeg' } }))
    assert.equal(img.evento.tipo, 'adjunto')
    assert.equal(img.evento.albumEsperado, null)
    assert.equal(clasificarUno(msg({ type: 'document', text: undefined, document: { id: 'pdf-0a1b', mime_type: 'application/pdf' } })).evento.tipo, 'adjunto')
    assert.equal(clasificarUno(msg({ type: 'document', text: undefined, document: { id: 'png-0a1b', mime_type: 'image/png' } })).evento.tipo, 'adjunto')
    const docx = { id: 'docx-0a1b', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    assert.deepEqual(clasificarUno(msg({ type: 'document', text: undefined, document: docx })), { descarte: 'tipo' })
    assert.equal(clasificarUno(msg({ type: 'document', text: undefined, document: { ...docx, caption: TEXTO_ALTA } })).evento.tipo, 'alta')
    // Una imagen sin id no se puede bajar
    assert.deepEqual(clasificarUno(msg({ type: 'image', text: undefined, image: { mime_type: 'image/jpeg' } })), { descarte: 'forma' })
  })
  test('Ventas: texto sin #ALTA solo pasa si cita algo o trae "Clave: valor" (la charla no se guarda)', () => {
    assert.deepEqual(clasificarUno(msg({ text: { body: 'Buen día equipo!' } })), { descarte: 'charla' })
    assert.deepEqual(clasificarUno(msg({ text: { body: 'https://ejemplo.test/algo' } })), { descarte: 'charla' })
    const kv = clasificarUno(msg({ text: { body: 'Setter: Mai\nFuente: Instagram' } }))
    assert.equal(kv.evento.tipo, 'respuesta')
    assert.equal(kv.evento.grupo, 'ventas')
    assert.equal(kv.evento.veredicto, null)
    const cita = clasificarUno(msg({ text: { body: 'el DNI es 30111222' }, context: { quoted_id: 'bot-msg-1234' } }))
    assert.equal(cita.evento.tipo, 'respuesta')
    assert.deepEqual(cita.evento.citado, { id: 'bot-msg-1234', autor: null })
    // Audio, sticker o encuesta: tipo
    assert.deepEqual(clasificarUno(msg({ type: 'voice', text: undefined, voice: { id: 'ogg-0a1b' } })), { descarte: 'tipo' })
  })
  test('Verificaciones: solo OK / NO que citan; una imagen, un OK sin cita o charla citando se descartan', () => {
    const v = (over) => clasificarUno(msg({ chat_id: GRUPOS.verificaciones, from: '5491155550002', ...over }))
    const ok = v({ text: { body: 'OK Empresa' }, context: { quoted_id: 'bot-msg-1' } })
    assert.equal(ok.evento.tipo, 'respuesta')
    assert.equal(ok.evento.grupo, 'verificaciones')
    assert.deepEqual(ok.evento.veredicto, { tipo: 'ok', resto: 'Empresa' })
    assert.deepEqual(v({ text: { body: 'OK' } }), { descarte: 'sin_cita' })
    assert.deepEqual(v({ text: { body: 'lo veo mañana' }, context: { quoted_id: 'bot-msg-1' } }), { descarte: 'charla' })
    assert.deepEqual(v({ type: 'image', text: undefined, image: { id: 'jpeg-0a1b', mime_type: 'image/jpeg', caption: 'OK' }, context: { quoted_id: 'bot-msg-1' } }), { descarte: 'tipo' })
    const nombre = v({ text: { body: 'OK Juan Pablo de la Vega' }, context: { quoted_id: 'bot-msg-2' } })
    assert.deepEqual(nombre.evento.veredicto, { tipo: 'ok', resto: 'Juan Pablo de la Vega' })
  })
  test('el mismo id dos veces en el mismo envío → un solo evento', () => {
    const m = msg({ id: 'dup-1234', text: { body: TEXTO_ALTA } })
    const r = W.clasificarEnvoltura(envio([m, { ...m }]), GRUPOS, AHORA)
    assert.equal(r.eventos.length, 1)
    assert.deepEqual(r.descartes, { repetido: 1 })
  })
  test('tope de mensajes por envío', () => {
    const muchos = Array.from({ length: W.MAX_MENSAJES_POR_ENVIO + 5 }, (_, i) => msg({ id: `m-${i}-xxxx`, text: { body: 'charla' } }))
    const r = W.clasificarEnvoltura(envio(muchos), GRUPOS, AHORA)
    assert.equal(r.descartes.exceso, 5)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('veredictos', () => {
  const casos = [
    ['OK', { tipo: 'ok', resto: '' }],
    ['ok!!', { tipo: 'ok', resto: '' }],
    ['Ok.', { tipo: 'ok', resto: '' }],
    ['OK Tomi', { tipo: 'ok', resto: 'Tomi' }],
    ['  ok,   1450 ', { tipo: 'ok', resto: '1450' }],
    ['OK\nGero', { tipo: 'ok', resto: 'Gero' }],
    ['NO', { tipo: 'no', motivo: '' }],
    ['No, falta el DNI', { tipo: 'no', motivo: 'falta el DNI' }],
    ['no sé', { tipo: 'no', motivo: 'sé' }],
    ['NO: el monto no coincide', { tipo: 'no', motivo: 'el monto no coincide' }],
    ['okey', null],
    ['nota', null],
    ['👍', null],
    ['', null],
  ]
  for (const [t, esperado] of casos) test(JSON.stringify(t), () => assert.deepEqual(W.veredicto(t), esperado))
  test('"Clave: valor"', () => {
    assert.equal(W.tieneClaveValor('Setter: Mai'), true)
    assert.equal(W.tieneClaveValor('hola\nTeléfono: +54 9 11'), true)
    assert.equal(W.tieneClaveValor('https://x.test'), false)
    assert.equal(W.tieneClaveValor('a las 10:30'), false)
    assert.equal(W.tieneClaveValor('sin dos puntos'), false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// La ruta POST/GET con un motor de juguete
function motorDeJuguete(op = {}) {
  const llamadas = { crear: [], registrar: [], procesar: [] }
  const crear = (deps) => {
    llamadas.crear.push(deps)
    return {
      modo: deps.modo,
      async registrar(evs) {
        llamadas.registrar.push(evs)
        return op.registrar ? op.registrar(evs) : { nuevos: evs, repetidos: [] }
      },
      async procesar(evs, o) {
        llamadas.procesar.push({ evs, o })
        if (op.procesar) return op.procesar(evs, o)
        return { altas: [], continuaciones: 0, errores: [], registro: [] }
      },
      async avanzar() { return { altas: [], continuaciones: 0, errores: [], registro: [] } },
      async barrer() { return { altas: [], continuaciones: 0, errores: [], registro: [] } },
    }
  }
  return { crear, llamadas }
}
const ENV_OK = { WHAPI_WEBHOOK_SECRETO: SECRETO, WHAPI_GRUPO_VENTAS: GRUPOS.ventas, WHAPI_GRUPO_VERIFICACIONES: GRUPOS.verificaciones, WHAPI_TOKEN: TOKEN }
function armarRuta({ env = ENV_OK, motor = motorDeJuguete() } = {}) {
  const tareas = [], lineas = []
  const log = { info: (m) => lineas.push(['info', m]), warn: (m) => lineas.push(['warn', m]), error: (m) => lineas.push(['error', m]) }
  const clientes = []
  const deps = {
    crearMotor: motor.crear, env, ahora: () => AHORA, log, programar: (t) => tareas.push(t), idInvocacion: () => 'wh-prueba',
    clienteWhapi: (o) => { clientes.push(o); return J.clienteWhapiDeJuguete() },
  }
  return { deps, tareas, lineas, motor, clientes, correr: () => Promise.all(tareas.map((t) => t())) }
}
const pedido = (cuerpo, { secreto = SECRETO, cabeceras = {} } = {}) => new Request('https://despacho.test/api/bot/whapi', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(secreto ? { 'x-cj-bot-secreto': secreto } : {}), ...cabeceras },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
})
const leer = async (res) => ({ status: res.status, json: await res.json(), cache: res.headers.get('cache-control') })

describe('ruta POST /api/bot/whapi (con un motor de juguete)', () => {
  test('503 sin secreto, con un secreto corto, con un grupo inválido o con los dos grupos iguales (falla cerrado; el log dice solo nombres)', async () => {
    const variantes = [
      { ...ENV_OK, WHAPI_WEBHOOK_SECRETO: '' },
      { ...ENV_OK, WHAPI_WEBHOOK_SECRETO: 'corto-123' },
      { ...ENV_OK, WHAPI_WEBHOOK_SECRETO: 'a'.repeat(40) },
      { ...ENV_OK, WHAPI_GRUPO_VENTAS: 'ventas' },
      { ...ENV_OK, WHAPI_GRUPO_VERIFICACIONES: undefined },
      { ...ENV_OK, WHAPI_GRUPO_VERIFICACIONES: GRUPOS.ventas },
      { ...ENV_OK, WHAPI_CANAL_ID: 'canal con espacios' },
    ]
    for (const env of variantes) {
      const r = armarRuta({ env })
      const res = await leer(await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), r.deps))
      assert.equal(res.status, 503)
      assert.equal(res.cache, 'no-store')
      assert.equal(r.motor.llamadas.crear.length, 0)
      assert.match(r.lineas[0][1], /WHAPI_/)
      assert.ok(!r.lineas.some(([, l]) => l.includes(SECRETO)))
    }
  })
  test('401 con el header incorrecto o sin header', async () => {
    for (const secreto of ['otro-secreto-que-no-es-0123456789', null]) {
      const r = armarRuta()
      const res = await leer(await R.atenderWebhook(pedido(envio([]), { secreto }), r.deps))
      assert.equal(res.status, 401)
      assert.equal(r.motor.llamadas.crear.length, 0)
    }
  })
  test('lo permanente responde 200 { ignorado } (con callback_persist todo lo demás se reintenta 24 h): cuerpo grande, JSON roto, no-objeto, canal ajeno', async () => {
    const grande = armarRuta()
    const falso = { headers: new Headers({ 'x-cj-bot-secreto': SECRETO, 'content-length': String(R.MAX_CUERPO_BYTES + 1) }), text: async () => { throw new Error('no debería leer') } }
    assert.deepEqual((await leer(await R.atenderWebhook(falso, grande.deps))).json, { recibido: false, ignorado: 'cuerpo_grande' })
    const real = armarRuta()
    const res = await leer(await R.atenderWebhook(pedido(`{"x":"${'a'.repeat(R.MAX_CUERPO_BYTES)}"}`), real.deps))
    assert.equal(res.status, 200)
    assert.equal(res.json.ignorado, 'cuerpo_grande')
    assert.deepEqual((await leer(await R.atenderWebhook(pedido('{roto'), armarRuta().deps))).json, { recibido: false, ignorado: 'json' })
    assert.deepEqual((await leer(await R.atenderWebhook(pedido('[1,2]'), armarRuta().deps))).json, { recibido: false, ignorado: 'forma' })
    const canal = armarRuta({ env: { ...ENV_OK, WHAPI_CANAL_ID: 'MANTIS-OTRO99' } })
    const rc = await leer(await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), canal.deps))
    assert.deepEqual(rc, { status: 200, json: { recibido: false, ignorado: 'canal' }, cache: 'no-store' })
    assert.equal(canal.motor.llamadas.registrar.length, 0)
    // El canal correcto pasa
    const bien = armarRuta({ env: { ...ENV_OK, WHAPI_CANAL_ID: 'MANTIS-PRUEBA1' } })
    assert.equal((await leer(await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), bien.deps))).json.recibido, true)
  })
  test('sin eventos → 200 y after() igual llama a procesar([]) (barrido oportunista sin cron)', async () => {
    const r = armarRuta()
    const res = await leer(await R.atenderWebhook(pedido(envio([msg({ text: { body: 'charla' } })])), r.deps))
    assert.deepEqual(res.json, { recibido: true, eventos: 0, descartados: 1 })
    assert.equal(r.motor.llamadas.registrar.length, 0)
    assert.equal(r.tareas.length, 1)
    await r.correr()
    assert.equal(r.motor.llamadas.procesar.length, 1)
    assert.deepEqual(r.motor.llamadas.procesar[0].evs, [])
    assert.equal(r.motor.llamadas.procesar[0].o.hasta, AHORA + PLAZO_INVOCACION_MS)
  })
  test('200 con eventos: registrar en el camino síncrono y procesar(nuevos) en after(), con hasta = t0 + 285 s', async () => {
    const pendiente = { tipo: 'adjunto', clave: 'viejo-1' }
    const motor = motorDeJuguete({ registrar: (evs) => ({ nuevos: [...evs, pendiente], repetidos: ['otra-clave'] }) })
    const r = armarRuta({ motor })
    const res = await leer(await R.atenderWebhook(pedido(envio([msg({ id: 'alta-0001', text: { body: TEXTO_ALTA } })])), r.deps))
    assert.deepEqual(res.json, { recibido: true, eventos: 1, nuevos: 2, repetidos: 1, descartados: 0 })
    assert.equal(motor.llamadas.registrar.length, 1)
    assert.equal(motor.llamadas.registrar[0][0].clave, 'alta-0001')
    assert.equal(motor.llamadas.procesar.length, 0, 'procesar va recién en after()')
    await r.correr()
    assert.equal(motor.llamadas.procesar[0].evs.length, 2)
    assert.equal(motor.llamadas.procesar[0].evs[1], pendiente)
    assert.deepEqual(motor.llamadas.procesar[0].o, { hasta: AHORA + PLAZO_INVOCACION_MS, invocacion: 'wh-prueba' })
  })
  test('el motor nace en SECO por defecto (sin capacidades); con BOT_ALTA_MODO=real toma las capacidades pedidas', async () => {
    const r = armarRuta()
    await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), r.deps)
    assert.equal(r.motor.llamadas.crear[0].modo, 'seco')
    assert.equal(r.motor.llamadas.crear[0].capacidades.size, 0)
    assert.deepEqual(r.clientes[0].grupos, GRUPOS)
    const real = armarRuta({ env: { ...ENV_OK, BOT_ALTA_MODO: 'real', BOT_ALTA_PASOS_REALES: 'finanzas, crm' } })
    await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), real.deps)
    assert.equal(real.motor.llamadas.crear[0].modo, 'real')
    assert.deepEqual([...real.motor.llamadas.crear[0].capacidades].sort(), ['crm', 'finanzas'])
    for (const mal of ['REAL', 'reales', ' ', 'true']) {
      const x = armarRuta({ env: { ...ENV_OK, BOT_ALTA_MODO: mal } })
      await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), x.deps)
      assert.equal(x.motor.llamadas.crear[0].modo, 'seco', mal)
    }
  })
  test('503 si registrar tira (Whapi reintenta) y no se programa nada', async () => {
    const motor = motorDeJuguete({ registrar: () => { throw new Error('Neon caído: ECONNRESET') } })
    const r = armarRuta({ motor })
    const res = await leer(await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), r.deps))
    assert.equal(res.status, 503)
    assert.equal(r.tareas.length, 0)
    assert.match(r.lineas.find(([n]) => n === 'error')[1], /Neon caído/)
  })
  test('503 si registrar tarda más de 8 s', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const motor = motorDeJuguete({ registrar: () => { queueMicrotask(() => mock.timers.tick(R.TOPE_REGISTRO_MS + 1)); return new Promise(() => {}) } })
      const r = armarRuta({ motor })
      const res = await leer(await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), r.deps))
      assert.equal(res.status, 503)
      assert.match(r.lineas.find(([n]) => n === 'error')[1], /más de 8 s/)
    } finally {
      mock.timers.reset()
    }
  })
  test('si procesar tira dentro de after(), se loguea y no escapa', async () => {
    const motor = motorDeJuguete({ procesar: () => { throw new Error('se rompió algo') } })
    const r = armarRuta({ motor })
    await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), r.deps)
    await r.correr()
    assert.match(r.lineas.find(([n]) => n === 'error')[1], /se rompió algo/)
  })
  test('el log no lleva el secreto, el token, textos, teléfonos ni nombres (solo conteos)', async () => {
    const r = armarRuta()
    await R.atenderWebhook(pedido(envio([
      msg({ text: { body: TEXTO_ALTA } }),
      msg({ text: { body: 'charla privada de Marcos' } }),
      msg({ chat_id: GRUPOS.verificaciones, text: { body: 'OK Tomi' }, context: { quoted_id: 'bot-1' } }),
    ])), r.deps)
    await r.correr()
    const todo = r.lineas.map(([, l]) => l).join('\n')
    assert.match(todo, /3 mensaje\(s\) → eventos alta:1 respuesta:1 · descartados charla:1/)
    for (const prohibido of [SECRETO, TOKEN, 'Ana Pérez', 'Marcos', CLOSER, '5555 0099', 'ana@ejemplo.test', 'charla privada', 'Tomi']) {
      assert.ok(!todo.includes(prohibido), `el log tiene "${prohibido}"`)
    }
  })
  test('app/api/bot/whapi/route.ts: dynamic, maxDuration 300, runtime nodejs y usa after()', () => {
    const fuente = readFileSync(join(RAIZ, 'app', 'api', 'bot', 'whapi', 'route.ts'), 'utf8')
    assert.match(fuente, /export const dynamic = 'force-dynamic'/)
    assert.match(fuente, /export const maxDuration = 300/)
    assert.match(fuente, /export const runtime = 'nodejs'/)
    assert.match(fuente, /programar: \(tarea\) => after\(tarea\)/)
  })
})

describe('ruta GET /api/bot/whapi (estado)', () => {
  test('401 sin Bearer CRON_SECRET; con Bearer: modo, capacidades y NOMBRES de lo que falta, sin valores', async () => {
    const previo = process.env.CRON_SECRET
    process.env.CRON_SECRET = `cron-${randomBytes(12).toString('hex')}`
    try {
      const sin = await R.atenderEstado(new Request('https://despacho.test/api/bot/whapi'), { env: ENV_OK })
      assert.equal(sin.status, 401)
      const con = await R.atenderEstado(new Request('https://despacho.test/api/bot/whapi', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), { env: { ...ENV_OK, WHAPI_TOKEN: '' } })
      const j = await con.json()
      assert.equal(con.status, 200)
      assert.equal(j.modo, 'seco')
      assert.deepEqual(j.capacidades, [])
      assert.deepEqual(j.whapi.faltan, ['WHAPI_TOKEN'])
      assert.equal(j.whapi.token, false)
      assert.equal(j.webhook_configurado, true)
      const texto = JSON.stringify(j)
      assert.ok(!texto.includes(SECRETO) && !texto.includes(GRUPOS.ventas))
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = previo
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Cliente real contra un fetch falso
function fetchFalso(respuestas) {
  const pedidos = []
  const f = async (url, init = {}) => {
    const p = { url: String(url), metodo: init.method ?? 'GET', headers: new Headers(init.headers), cuerpo: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect }
    pedidos.push(p)
    const r = typeof respuestas === 'function' ? await respuestas(p, pedidos.length) : respuestas.shift()
    if (r instanceof Error) throw r
    if (r instanceof Response) return r
    return new Response(JSON.stringify(r?.json ?? {}), { status: r?.status ?? 200, headers: { 'content-type': 'application/json', ...(r?.headers ?? {}) } })
  }
  f.pedidos = pedidos
  return f
}
const errorRed = () => new TypeError('fetch failed')
const errorCorte = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
const real = (f, extra = {}) => C.crearClienteWhapi({ token: TOKEN, fetch: f, esperar: async () => {}, ahora: () => AHORA, ...extra })
async function rechaza(promesa, esperado) {
  try {
    await promesa
  } catch (e) {
    assert.ok(E.esErrorWhapi(e), `no es ErrorWhapi: ${e?.message}`)
    for (const [k, v] of Object.entries(esperado)) assert.equal(e[k], v, `${k}: ${e[k]} (${e.message})`)
    assert.ok(!e.message.includes(TOKEN), 'el mensaje tiene el token')
    return e
  }
  assert.fail('no tiró')
}

describe('cliente real (fetch falso con la forma de la referencia)', () => {
  test('enviarTexto: POST /messages/text con Bearer, to, body, quoted y mentions; el id sale de message.id', async () => {
    const f = fetchFalso([{ json: { sent: true, message: { id: 'p.w30M7fgwWD4XwHu-g4CA-gBgTwl0rVw', status: 'pending' } } }])
    const c = real(f)
    const r = await c.enviarTexto({ chatId: GRUPOS.verificaciones, texto: 'Aylu @5491155550003 invitá a Ana', citar: 'abcd1234-wxyz', menciones: ['5491155550003'] })
    assert.deepEqual(r, { id: 'p.w30M7fgwWD4XwHu-g4CA-gBgTwl0rVw', simulado: false })
    const p = f.pedidos[0]
    assert.equal(p.url, 'https://gate.whapi.cloud/messages/text')
    assert.equal(p.metodo, 'POST')
    assert.equal(p.headers.get('authorization'), `Bearer ${TOKEN}`)
    assert.equal(p.redirect, 'error')
    assert.deepEqual(p.cuerpo, { to: GRUPOS.verificaciones, body: 'Aylu @5491155550003 invitá a Ana', quoted: 'abcd1234-wxyz', mentions: ['5491155550003'] })
    // El registro: sin token y con el texto recortado
    const reg = c.registro()
    assert.equal(reg.length, 1)
    assert.equal(reg[0].ruta, '/messages/text')
    assert.equal(reg[0].simulada, false)
    assert.ok(!JSON.stringify(reg).includes(TOKEN))
  })
  test('sent: true sin `message` → id null (lo recupera el eco); sent: false → rechazo', async () => {
    assert.deepEqual(await real(fetchFalso([{ json: { sent: true } }])).enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' }), { id: null, simulado: false })
    await rechaza(real(fetchFalso([{ json: { sent: false } }])).enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' }), { tipo: 'rechazo', aplicado: false })
  })
  test('menciones sin "@<número>" en el texto, ids seco-/jg- y chats inválidos → config SIN salir a la red', async () => {
    const f = fetchFalso(() => assert.fail('salió a la red'))
    const c = real(f)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'Aylu invitá a Ana', menciones: ['5491155550003'] }), { tipo: 'config', aplicado: false })
    assert.match((await rechaza(c.enviarTexto({ chatId: 'seco-3', texto: 'x' }), { tipo: 'config' })).message, /id simulado/)
    assert.match((await rechaza(c.agregarParticipantes({ grupoId: 'jg-grupo-2@g.us', participantes: ['5491100000001'] }), { tipo: 'config' })).message, /id simulado/)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x', citar: 'jg-msg-1' }), { tipo: 'config' })
    await rechaza(c.enviarTexto({ chatId: 'no es un chat', texto: 'x' }), { tipo: 'config' })
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: '   ' }), { tipo: 'config' })
    await rechaza(c.enviarVideo({ chatId: GRUPOS.ventas, url: 'seco-2' }), { tipo: 'config' })
    await rechaza(c.enviarVideo({ chatId: GRUPOS.ventas, url: 'http://inseguro.test/v.mp4' }), { tipo: 'config' })
    await rechaza(c.subgruposComunidad('jg-com-1@g.us'), { tipo: 'config' })
    await rechaza(c.ponerFoto({ grupoId: 'seco-4', foto: { url: 'https://x.test/a.jpg' } }), { tipo: 'config' })
    await rechaza(c.descargarMedio({ id: 'seco-1', tipo: 'image', mime: 'image/jpeg' }), { tipo: 'config' })
    await rechaza(c.descargarMedio({ id: '../../settings', tipo: 'image', mime: 'image/jpeg' }), { tipo: 'config' })
    await rechaza(c.crearGrupoEnComunidad({ comunidadId: '120363000000000099@g.us', nombre: 'General', participantes: ['hola'] }), { tipo: 'config' })
    assert.equal(f.pedidos.length, 0)
    assert.equal(c.registro().length, 0)
    assert.throws(() => C.crearClienteWhapi({ token: '' }), (e) => e.tipo === 'config')
  })
  test('errores HTTP → tipo de ErrorWhapi (y una escritura NUNCA se reintenta)', async () => {
    const casos = [[400, 'rechazo', false], [401, 'auth', false], [402, 'limite', false], [403, 'prohibido', false], [404, 'no_encontrado', false], [409, 'ya_existe', false], [413, 'rechazo', false], [429, 'soft_ban', false], [500, 'dudoso', null], [503, 'dudoso', null], [524, 'dudoso', null]]
    for (const [status, tipo, aplicado] of casos) {
      const f = fetchFalso([{ status, json: { error: { code: status, message: `algo con Bearer ${TOKEN} adentro` } } }, { json: { sent: true, message: { id: 'no-deberia' } } }])
      const e = await rechaza(real(f).enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' }), { tipo, aplicado, status })
      assert.equal(f.pedidos.length, 1, `${status}: se reintentó una escritura`)
      assert.match(e.message, new RegExp(`HTTP ${status}`))
    }
  })
  test('red caída o corte por tiempo: en una escritura es dudoso (sin reintento); en una lectura, pasajero con un reintento', async () => {
    for (const falla of [errorRed, errorCorte]) {
      const f = fetchFalso([falla(), { json: {} }])
      await rechaza(real(f).crearComunidad({ nombre: 'Ana Pérez - C.J', descripcion: 'x' }), { tipo: 'dudoso', aplicado: null })
      assert.equal(f.pedidos.length, 1)
    }
    const f = fetchFalso([errorRed(), { json: { invite_code: 'AbCdEf123456' } }])
    assert.equal(await real(f).linkInvitacion('120363000000000010@g.us'), 'https://chat.whatsapp.com/AbCdEf123456')
    assert.equal(f.pedidos.length, 2)
  })
  test('lectura con 500: un reintento; si vuelve a fallar, pasajero (aplicado: false)', async () => {
    const f = fetchFalso([{ status: 500 }, { status: 502 }, { json: {} }])
    await rechaza(real(f).linkInvitacion('120363000000000010@g.us'), { tipo: 'pasajero', aplicado: false, status: 502 })
    assert.equal(f.pedidos.length, 2)
  })
  test('sin tiempo hasta el plazo: no sale (pasajero, aplicado: false)', async () => {
    const f = fetchFalso(() => assert.fail('salió a la red'))
    await rechaza(real(f).descargarMedio({ id: 'jpeg-0a1b2c', tipo: 'image', mime: 'image/jpeg' }, { hasta: AHORA + 1000 }), { tipo: 'pasajero', aplicado: false })
    await rechaza(real(f, { ahora: () => AHORA + 10 }).descargarMedio({ id: 'jpeg-0a1b2c', tipo: 'image', mime: 'image/jpeg' }, { hasta: AHORA }), { tipo: 'pasajero', aplicado: false })
    assert.equal(f.pedidos.length, 0)
  })
  test('enviarVideo con URL: sube UNA vez con POST /media y manda por MediaID (no_encode); con MediaID no sube', async () => {
    const f = fetchFalso((p) => {
      if (p.url.endsWith('/media')) return { json: { media: [{ id: 'mp4-0a1b2c3d4e5f' }] } }
      return { json: { sent: true, message: { id: 'vid-1234-abcd' } } }
    })
    const c = real(f)
    const url = 'https://despacho.test/v/bienvenida.mp4'
    assert.deepEqual(await c.enviarVideo({ chatId: '120363000000000077@g.us', url, pie: 'Hola Ana!', citar: null }), { id: 'vid-1234-abcd', simulado: false })
    assert.deepEqual(f.pedidos[0].cuerpo, { media: url, no_encode: true })
    assert.deepEqual(f.pedidos[1].cuerpo, { to: '120363000000000077@g.us', media: 'mp4-0a1b2c3d4e5f', no_encode: true, caption: 'Hola Ana!' })
    await c.enviarVideo({ chatId: '120363000000000078@g.us', url })
    assert.equal(f.pedidos.filter((p) => p.url.endsWith('/media')).length, 1, 'el segundo envío reusa el MediaID')
    await c.enviarVideo({ chatId: '120363000000000079@g.us', url: 'mp4-ffff0000' })
    assert.equal(f.pedidos.at(-1).cuerpo.media, 'mp4-ffff0000')
    assert.equal(f.pedidos.filter((p) => p.url.endsWith('/media')).length, 1)
  })
  test('enviarVideo: si falla la subida no se mandó nada (aplicado: false) y no sale el POST del video; un 524 del envío es dudoso', async () => {
    const f = fetchFalso([{ status: 500 }])
    await rechaza(real(f).enviarVideo({ chatId: GRUPOS.ventas, url: 'https://despacho.test/v/b.mp4' }), { tipo: 'pasajero', aplicado: false })
    assert.equal(f.pedidos.length, 1)
    const g = fetchFalso([{ json: { media: [{ id: 'mp4-0a1b' }] } }, { status: 524 }])
    await rechaza(real(g).enviarVideo({ chatId: GRUPOS.ventas, url: 'https://despacho.test/v/b.mp4' }), { tipo: 'dudoso', aplicado: null, status: 524 })
  })
  test('enviarVideo con `hasta` (revisión del 24/10): la subida y el envío respetan el plazo de la invocación; sin tiempo no sale', async () => {
    const cortes = []
    const f = fetchFalso((p) => (p.url.endsWith('/media') ? { json: { media: [{ id: 'mp4-0a1b2c3d4e5f' }] } } : { json: { sent: true, message: { id: 'vid-9999-abcd' } } }))
    const c = real(f, { senal: (ms) => { cortes.push(ms); return new AbortController().signal } })
    await c.enviarVideo({ chatId: '120363000000000077@g.us', url: 'https://despacho.test/v/plazo.mp4', hasta: AHORA + 40_000 })
    assert.deepEqual(cortes, [40_000, 40_000])
    const g = fetchFalso(() => assert.fail('salió a la red'))
    await rechaza(real(g).enviarVideo({ chatId: '120363000000000077@g.us', url: 'https://despacho.test/v/otro.mp4', hasta: AHORA + 1000 }), { tipo: 'pasajero', aplicado: false })
    assert.equal(g.pedidos.length, 0)
  })
  test('crearComunidad y subgruposComunidad (ejemplo de la doc, con el General que WhatsApp crea solo)', async () => {
    const f = fetchFalso([
      { json: { id: '120363000000001002@g.us', name: 'Ana Pérez - C.J', type: 'group', participants: [], participants_count: 1, created_at: 1761318000 } },
      { json: { announceGroupInfo: { title: 'Ana Pérez - C.J', id: '120363000000001003@g.us', inviteCode: 'Avisos123456' }, otherGroups: [{ title: 'General', id: '120363000000001004@g.us', inviteCode: 'Gral12345678', properties: { general_chat: true } }, { title: 'Ventas', id: '120363000000001005@g.us' }] } },
    ])
    const c = real(f)
    const com = await c.crearComunidad({ nombre: 'Ana Pérez - C.J', descripcion: 'Comunidad de Ana' })
    assert.deepEqual(com, { id: '120363000000001002@g.us', nombre: 'Ana Pérez - C.J', codigoInvitacion: null, creadoEn: new Date(1761318000000).toISOString() })
    assert.deepEqual(f.pedidos[0].cuerpo, { subject: 'Ana Pérez - C.J', description: 'Comunidad de Ana' })
    const sub = await c.subgruposComunidad(com.id)
    assert.equal(f.pedidos[1].url, 'https://gate.whapi.cloud/communities/120363000000001002%40g.us/subgroups')
    assert.equal(sub.avisos.id, '120363000000001003@g.us')
    assert.equal(sub.avisos.codigoInvitacion, 'Avisos123456')
    assert.deepEqual(sub.otros.map((g) => [g.nombre, g.generalChat, g.codigoInvitacion]), [['General', true, 'Gral12345678'], ['Ventas', false, null]])
  })
  test('crearComunidad: un 200 sin id es dudoso (pudo haberse creado)', async () => {
    await rechaza(real(fetchFalso([{ json: { name: 'x' } }])).crearComunidad({ nombre: 'Ana - C.J', descripcion: '' }), { tipo: 'dudoso', aplicado: null })
  })
  test('crearGrupoEnComunidad: los fallidos salen de comparar los pedidos con los participants (Group no trae failed)', async () => {
    const f = fetchFalso([{ json: { id: '120363000000000050@g.us', name: 'Ventas', participants: [{ id: '5491100000001', rank: 'creator' }, { id: { id: '1234567890@lid', phone: '5491100000002' }, rank: 'member' }, { id: '5491100000003@s.whatsapp.net', rank: 'member' }], unprocessed_participants: ['5491100000003'] } }])
    const r = await real(f).crearGrupoEnComunidad({ comunidadId: '120363000000000049@g.us', nombre: 'Ventas', participantes: ['+5491100000002', '5491100000003', '5491100000004'] })
    assert.deepEqual(f.pedidos[0].cuerpo, { subject: 'Ventas', participants: ['5491100000002', '5491100000003', '5491100000004'] })
    assert.equal(f.pedidos[0].url, 'https://gate.whapi.cloud/communities/120363000000000049%40g.us')
    assert.deepEqual(r.agregados, ['5491100000002'])
    assert.deepEqual(r.fallidos, ['5491100000003', '5491100000004'])
    assert.equal(r.id, '120363000000000050@g.us')
  })
  test('agregarParticipantes: processed / failed (grupo o comunidad)', async () => {
    const f = fetchFalso([{ json: { success: true, failed: ['5491100000009@s.whatsapp.net'], processed: ['5491100000008@s.whatsapp.net'] } }, { json: { success: true } }])
    const c = real(f)
    assert.deepEqual(await c.agregarParticipantes({ grupoId: '120363000000000050@g.us', participantes: ['5491100000008', '5491100000009'] }), { agregados: ['5491100000008'], fallidos: ['5491100000009'] })
    assert.equal(f.pedidos[0].url, 'https://gate.whapi.cloud/groups/120363000000000050%40g.us/participants')
    assert.deepEqual(await c.agregarParticipantes({ grupoId: '120363000000000049@g.us', participantes: ['5491100000008'], esComunidad: true }), { agregados: ['5491100000008'], fallidos: [] })
    assert.equal(f.pedidos[1].url, 'https://gate.whapi.cloud/communities/120363000000000049%40g.us/participants')
  })
  test('ponerFoto (URL o base64), cambiarInfoGrupo, verificarNumeros y agendarContacto: rutas, verbos y cuerpos', async () => {
    const f = fetchFalso(() => ({ json: { success: true, contacts: [{ input: '5491100000001', status: 'valid', wa_id: '5491100000001' }, { input: '5491100000002', status: 'invalid' }] } }))
    const c = real(f)
    await c.ponerFoto({ grupoId: '120363000000000050@g.us', foto: { url: 'https://despacho.test/bot/grupo-ventas.jpg' } })
    await c.ponerFoto({ grupoId: '120363000000000050@g.us', foto: { base64: 'AAAA', mime: 'image/png' } })
    await c.cambiarInfoGrupo({ grupoId: '120363000000000050@g.us', descripcion: 'Grupo de ventas' })
    const v = await c.verificarNumeros(['5491100000001', '5491100000002'])
    await c.agendarContacto({ telefono: '+54 9 11 0000-0001'.replace(/\D/g, ''), nombre: 'Ana Pérez' })
    const [foto1, foto2, info, verif, contacto] = f.pedidos
    assert.deepEqual([foto1.metodo, foto1.url, foto1.cuerpo], ['PUT', 'https://gate.whapi.cloud/groups/120363000000000050%40g.us/icon', { media: 'https://despacho.test/bot/grupo-ventas.jpg' }])
    assert.deepEqual(foto2.cuerpo, { media: 'data:image/png;base64,AAAA', mime_type: 'image/png' })
    assert.deepEqual([info.metodo, info.cuerpo], ['PUT', { description: 'Grupo de ventas' }])
    assert.deepEqual([verif.metodo, verif.url, verif.cuerpo], ['POST', 'https://gate.whapi.cloud/contacts', { blocking: 'wait', contacts: ['5491100000001', '5491100000002'], force_check: false }])
    assert.deepEqual(v, { 5491100000001: 'valido', 5491100000002: 'invalido' })
    assert.deepEqual([contacto.metodo, contacto.cuerpo], ['PUT', { phone: '5491100000001', name: 'Ana Pérez' }])
    await rechaza(c.ponerFoto({ grupoId: '120363000000000050@g.us', foto: { url: 'http://x.test/a.jpg' } }), { tipo: 'config' })
    await rechaza(c.cambiarInfoGrupo({ grupoId: '120363000000000050@g.us' }), { tipo: 'config' })
    await rechaza(real(fetchFalso([{ json: { success: false } }])).cambiarInfoGrupo({ grupoId: '120363000000000050@g.us', nombre: 'x' }), { tipo: 'rechazo', aplicado: false })
  })
  test('buscarComunidades: GET /communities paginado, por nombre exacto y creadas desde la fecha', async () => {
    const desde = '2026-10-24T14:00:00.000Z', d = Date.parse(desde) / 1000
    const pagina1 = Array.from({ length: 100 }, (_, i) => ({ id: `1203630000000${String(i).padStart(5, '0')}@g.us`, name: `Otra ${i}`, created_at: d + 10 }))
    pagina1[7] = { id: '120363000000077777@g.us', name: 'Ana Pérez - C.J', created_at: d - 3600 }   // homónima vieja
    const pagina2 = [{ id: '120363000000088888@g.us', name: ' Ana  Pérez - C.J ', created_at: d + 60 }, { id: '120363000000099999@g.us', name: 'Ana Pérez - C.J', invite_code: 'Xx123456' }]
    const f = fetchFalso([{ json: { groups: pagina1, count: 100, total: 102, offset: 0 } }, { json: { groups: pagina2, count: 100, total: 102, offset: 100 } }])
    const r = await real(f).buscarComunidades({ nombre: 'Ana Pérez - C.J', desde })
    assert.deepEqual(f.pedidos.map((p) => p.url), ['https://gate.whapi.cloud/communities?count=100&offset=0', 'https://gate.whapi.cloud/communities?count=100&offset=100'])
    assert.deepEqual(r.map((g) => [g.id, g.creadoEn]), [['120363000000088888@g.us', new Date((d + 60) * 1000).toISOString()], ['120363000000099999@g.us', null]])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('bajar el comprobante (medios.ts)', () => {
  const ref = (over = {}) => ({ id: 'jpeg-0a1b2c3d', tipo: 'image', mime: 'image/jpeg', tamano: 5, sha256Whapi: null, nombreArchivo: null, link: 'https://s3.eu-central-1.wasabisys.com/in-files/x.jpeg', paginas: null, pie: null, ...over })
  test('siempre GET /media/{id} con el token (el link de wasabi del mensaje no se usa); sha256 propio, mime y nombre', async () => {
    const bytes = Buffer.from('comprobante de prueba')
    const f = fetchFalso([new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) } })])
    const m = await real(f).descargarMedio(ref())
    assert.equal(f.pedidos.length, 1)
    assert.equal(f.pedidos[0].url, 'https://gate.whapi.cloud/media/jpeg-0a1b2c3d')
    assert.equal(f.pedidos[0].headers.get('authorization'), `Bearer ${TOKEN}`)
    assert.equal(f.pedidos[0].redirect, 'manual')
    assert.deepEqual(m, { base64: bytes.toString('base64'), mime: 'image/jpeg', nombre: 'jpeg-0a1b2c3d.jpg', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    const pdf = await real(fetchFalso([new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })])).descargarMedio(ref({ id: 'pdf-0a1b', tipo: 'document', mime: 'application/pdf', nombreArchivo: 'comprobante.pdf' }))
    assert.equal(pdf.mime, 'application/pdf')
    assert.equal(pdf.nombre, 'comprobante.pdf')
  })
  test('más de 20 MB por content-length → rechazo sin bajar; contando mientras baja → se corta', async () => {
    const f = fetchFalso([new Response('x', { headers: { 'content-length': String(21 * 1024 * 1024) } })])
    await rechaza(real(f).descargarMedio(ref()), { tipo: 'rechazo', aplicado: false, status: 413 })
    let partes = 0
    const infinito = new ReadableStream({ pull(c) { partes++; c.enqueue(new Uint8Array(256 * 1024)) } })
    const g = fetchFalso([new Response(infinito, { headers: { 'content-type': 'image/jpeg' } })])
    await rechaza(real(g).descargarMedio(ref(), { maxBytes: 1024 * 1024 }), { tipo: 'rechazo', status: 413 })
    assert.ok(partes <= 8, `siguió bajando: ${partes} partes`)
    assert.equal(M.MAX_BYTES_MEDIO, 20 * 1024 * 1024)
  })
  test('redirecciones: a wasabisys.com por https sí (sin el token); a otro host o por http no', async () => {
    const f = fetchFalso([new Response(null, { status: 302, headers: { location: 'https://s3.eu-central-1.wasabisys.com/in-files/x.jpeg?firma=abc' } }), new Response('ok', { headers: { 'content-type': 'image/jpeg' } })])
    const m = await real(f).descargarMedio(ref())
    assert.equal(m.bytes, 2)
    assert.equal(f.pedidos[1].url, 'https://s3.eu-central-1.wasabisys.com/in-files/x.jpeg?firma=abc')
    assert.equal(f.pedidos[1].headers.get('authorization'), null, 'el token no viaja al almacenamiento')
    for (const destino of ['https://evil.test/x.jpeg', 'http://s3.wasabisys.com/x.jpeg', 'https://wasabisys.com.evil.test/x']) {
      const g = fetchFalso([new Response(null, { status: 302, headers: { location: destino } })])
      await rechaza(real(g).descargarMedio(ref()), { tipo: 'rechazo', aplicado: false })
      assert.equal(g.pedidos.length, 1)
    }
    assert.equal(M.destinoMedioPermitido(new URL('https://gate.whapi.cloud/media/x')), 'whapi')
    assert.equal(M.destinoMedioPermitido(new URL('https://usuario:clave@s3.wasabisys.com/x')), null)
  })
  test('404 → no_encontrado (el archivo venció); 500 y después 200 → un reintento', async () => {
    await rechaza(real(fetchFalso([{ status: 404, json: { error: { code: 404, message: 'Specified media not found' } } }])).descargarMedio(ref()), { tipo: 'no_encontrado', aplicado: false })
    const f = fetchFalso([{ status: 500 }, new Response('ok', { headers: { 'content-type': 'image/jpeg' } })])
    assert.equal((await real(f).descargarMedio(ref())).bytes, 2)
    assert.equal(f.pedidos.length, 2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('compuerta del modo (compuerta.ts) y clienteWhapiDesdeEntorno', () => {
  const todoOk = () => fetchFalso((p) => {
    if (p.url.endsWith('/media')) return { json: { media: [{ id: 'mp4-0a1b' }] } }
    if (p.url.includes('/media/')) return new Response('img', { headers: { 'content-type': 'image/jpeg' } })
    if (p.url.endsWith('/invite')) return { json: { invite_code: 'Codigo123456' } }
    if (p.url.endsWith('/communities') && p.metodo === 'POST') return { json: { id: '120363000000000060@g.us', name: 'x' } }
    if (/\/communities\/[^/]+$/.test(p.url)) return { json: { id: '120363000000000061@g.us', name: 'x', participants: [] } }
    return { json: { sent: true, message: { id: 'm-1234-abcd' }, success: true } }
  })
  const operaciones = (c) => ({
    textoVerif: () => c.enviarTexto({ chatId: GRUPOS.verificaciones, texto: 'reporte' }),
    textoVentas: () => c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'pedido al closer' }),
    textoCliente: () => c.enviarTexto({ chatId: '120363000000000070@g.us', texto: 'bienvenida aparte' }),
    video: () => c.enviarVideo({ chatId: '120363000000000070@g.us', url: 'https://despacho.test/v/b.mp4', pie: 'Hola' }),
    medio: () => c.descargarMedio({ id: 'jpeg-0a1b', tipo: 'image', mime: 'image/jpeg', tamano: null, sha256Whapi: null, nombreArchivo: null, link: null, paginas: null, pie: null }),
    comunidad: () => c.crearComunidad({ nombre: 'Ana - C.J', descripcion: 'x' }),
    grupo: () => c.crearGrupoEnComunidad({ comunidadId: '120363000000000060@g.us', nombre: 'General', participantes: ['5491100000001'] }),
    link: () => c.linkInvitacion('120363000000000061@g.us'),
  })
  async function quePasa(modo, caps) {
    const f = todoOk()
    const c = P.aplicarCompuerta(real(f), { modo, capacidades: new Set(caps), grupos: GRUPOS, ahora: () => AHORA })
    const salida = {}
    for (const [k, op] of Object.entries(operaciones(c))) {
      const antes = f.pedidos.length
      try {
        const r = await op()
        salida[k] = f.pedidos.length > antes ? 'sale' : 'simulado'
        if (salida[k] === 'simulado' && r && typeof r === 'object' && 'id' in r) assert.match(String(r.id), /^seco-\d+$/, `${k}: un simulado devuelve un id seco-`)
      } catch (e) {
        salida[k] = e.tipo === 'bloqueado' ? 'bloqueado' : `error:${e.tipo}`
      }
    }
    return { salida, f, c }
  }
  test('seco: CERO pedidos a la red; todo queda simulado en el registro y bajar el comprobante tira "bloqueado"', async () => {
    const { salida, f, c } = await quePasa('seco', ['finanzas', 'crm', 'comunidad', 'bienvenida', 'mensajes_equipo', 'reporte_verificaciones'])
    assert.equal(f.pedidos.length, 0)
    assert.deepEqual(salida, { textoVerif: 'simulado', textoVentas: 'simulado', textoCliente: 'simulado', video: 'simulado', medio: 'bloqueado', comunidad: 'simulado', grupo: 'simulado', link: 'simulado' })
    assert.equal(c.modo, 'seco')
    const reg = c.registro()
    assert.equal(reg.length, 8)
    assert.ok(reg.every((l) => l.simulada === true && /no sale: modo seco/.test(l.resumen)))
    const env = await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' })
    assert.equal(env.simulado, true)
    assert.match(env.id, /^seco-\d+$/)
  })
  test('ensayo: solo el reporte a Verificaciones (con el prefijo SIMULACIÓN) y bajar el comprobante; sin la capacidad, nada', async () => {
    const { salida, f } = await quePasa('ensayo', ['reporte_verificaciones', 'mensajes_equipo', 'comunidad', 'bienvenida'])
    assert.deepEqual(salida, { textoVerif: 'sale', textoVentas: 'simulado', textoCliente: 'simulado', video: 'simulado', medio: 'sale', comunidad: 'simulado', grupo: 'simulado', link: 'simulado' })
    const texto = f.pedidos.find((p) => p.url.endsWith('/messages/text')).cuerpo.body
    assert.equal(texto, `${P.PREFIJO_ENSAYO}\n\nreporte`)
    const sin = await quePasa('ensayo', [])
    assert.equal(sin.salida.textoVerif, 'simulado')
    assert.equal(sin.salida.medio, 'sale', 'bajar el comprobante es una lectura: anda en ensayo')
  })
  test('ensayo: el prefijo no se duplica si el texto ya lo trae (el del orquestador termina con punto)', async () => {
    const f = todoOk()
    const c = P.aplicarCompuerta(real(f), { modo: 'ensayo', capacidades: new Set(['reporte_verificaciones']), grupos: GRUPOS })
    await c.enviarTexto({ chatId: GRUPOS.verificaciones, texto: 'SIMULACIÓN — no se cargó nada.\n\nreporte' })
    assert.equal(f.pedidos[0].cuerpo.body, 'SIMULACIÓN — no se cargó nada.\n\nreporte')
  })
  test('real: cada capacidad abre solo lo suyo', async () => {
    const solo = async (caps) => (await quePasa('real', caps)).salida
    assert.deepEqual(await solo([]), { textoVerif: 'simulado', textoVentas: 'simulado', textoCliente: 'simulado', video: 'simulado', medio: 'sale', comunidad: 'simulado', grupo: 'simulado', link: 'simulado' })
    assert.deepEqual(await solo(['reporte_verificaciones']), { textoVerif: 'sale', textoVentas: 'simulado', textoCliente: 'simulado', video: 'simulado', medio: 'sale', comunidad: 'simulado', grupo: 'simulado', link: 'simulado' })
    assert.deepEqual(await solo(['mensajes_equipo']), { textoVerif: 'sale', textoVentas: 'sale', textoCliente: 'simulado', video: 'simulado', medio: 'sale', comunidad: 'simulado', grupo: 'simulado', link: 'simulado' })
    assert.deepEqual(await solo(['bienvenida']), { textoVerif: 'simulado', textoVentas: 'simulado', textoCliente: 'sale', video: 'sale', medio: 'sale', comunidad: 'simulado', grupo: 'simulado', link: 'simulado' })
    assert.deepEqual(await solo(['comunidad']), { textoVerif: 'simulado', textoVentas: 'simulado', textoCliente: 'simulado', video: 'simulado', medio: 'sale', comunidad: 'sale', grupo: 'sale', link: 'sale' })
    // finanzas, crm, drive y contrato no abren nada de WhatsApp
    assert.deepEqual(await solo(['finanzas', 'crm', 'drive', 'contrato']), await solo([]))
  })
  test('real: en el texto real no va el prefijo de ensayo', async () => {
    const { f } = await quePasa('real', ['mensajes_equipo'])
    assert.equal(f.pedidos.find((p) => p.url.endsWith('/messages/text')).cuerpo.body, 'reporte')
  })
  test('en seco igual se controla la forma del texto (menciones sin "@<número>" → config)', async () => {
    const c = P.aplicarCompuerta(J.clienteWhapiDeJuguete(), { modo: 'seco', capacidades: new Set(), grupos: GRUPOS })
    await rechaza(c.enviarTexto({ chatId: GRUPOS.verificaciones, texto: 'Aylu invitá', menciones: ['5491155550003'] }), { tipo: 'config' })
    assert.equal(c.permite('enviarTexto', { chatId: GRUPOS.verificaciones }), false)
  })
  test('clienteWhapiDesdeEntorno: seco no toca la red; real sin token tira config (nada sale); real con token sale', async () => {
    const f = todoOk()
    const seco = I.clienteWhapiDesdeEntorno({ modo: 'seco', capacidades: new Set(['mensajes_equipo']), grupos: GRUPOS, env: ENV_OK, fetch: f })
    assert.equal((await seco.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' })).simulado, true)
    const sinToken = I.clienteWhapiDesdeEntorno({ modo: 'real', capacidades: new Set(['mensajes_equipo']), grupos: GRUPOS, env: { ...ENV_OK, WHAPI_TOKEN: '' }, fetch: f })
    await rechaza(sinToken.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'config', aplicado: false })
    assert.equal(f.pedidos.length, 0)
    const conToken = I.clienteWhapiDesdeEntorno({ modo: 'real', capacidades: new Set(['mensajes_equipo']), grupos: GRUPOS, env: ENV_OK, fetch: f })
    assert.deepEqual(await conToken.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { id: 'm-1234-abcd', simulado: false })
    assert.equal(f.pedidos.length, 1)
    assert.equal(f.pedidos[0].headers.get('authorization'), `Bearer ${TOKEN}`)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('cliente de juguete (juguete.ts, para los tests del orquestador)', () => {
  test('sin red, ids "jg-…" y registro de cada llamada', async () => {
    const j = J.clienteWhapiDeJuguete({ ahora: () => AHORA })
    const r = await j.enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' })
    assert.match(r.id, /^jg-msg-\d+$/)
    assert.equal(r.simulado, false)
    assert.equal(j.modo, 'juguete')
    assert.equal(j.registro()[0].ruta, '/messages/text')
    assert.equal(j.llamadas('enviarTexto').length, 1)
    assert.equal(j.mensajes()[0].texto, 'hola')
  })
  test('fallas programables por método: status → tipo (escritura vs lectura), red, veces e Infinity', async () => {
    const j = J.clienteWhapiDeJuguete({ fallas: { enviarTexto: [{ status: 429 }, { status: 524 }], linkInvitacion: { status: 500, veces: 2 }, subgruposComunidad: { red: 'corte', veces: Infinity } } })
    await rechaza(j.enviarTexto({ chatId: GRUPOS.ventas, texto: 'a' }), { tipo: 'soft_ban', aplicado: false })
    await rechaza(j.enviarTexto({ chatId: GRUPOS.ventas, texto: 'a' }), { tipo: 'dudoso', aplicado: null, status: 524 })
    assert.match((await j.enviarTexto({ chatId: GRUPOS.ventas, texto: 'a' })).id, /^jg-/)
    const com = await j.crearComunidad({ nombre: 'Ana - C.J', descripcion: '' })
    const grupo = await j.crearGrupoEnComunidad({ comunidadId: com.id, nombre: 'General', participantes: ['5491100000001'] })
    await rechaza(j.linkInvitacion(grupo.id), { tipo: 'pasajero', aplicado: false })
    await rechaza(j.linkInvitacion(grupo.id), { tipo: 'pasajero' })
    assert.match(await j.linkInvitacion(grupo.id), /^https:\/\/chat\.whatsapp\.com\//)
    for (let i = 0; i < 3; i++) await rechaza(j.subgruposComunidad(com.id), { tipo: 'pasajero' })
    j.fallar('agendarContacto', { status: 401 })
    await rechaza(j.agendarContacto({ telefono: '5491100000001', nombre: 'Ana' }), { tipo: 'auth' })
    for (const status of [403, 409]) {
      j.fallar('agregarParticipantes', { status })
      await rechaza(j.agregarParticipantes({ grupoId: grupo.id, participantes: ['5491100000002'] }), { tipo: status === 403 ? 'prohibido' : 'ya_existe' })
    }
  })
  test('dudoso de verdad (aplicar: true): la comunidad se crea aunque la respuesta falle, y buscarComunidades la encuentra', async () => {
    let t = AHORA
    const j = J.clienteWhapiDeJuguete({ ahora: () => t, fallas: { crearComunidad: { status: 524, aplicar: true } } })
    await rechaza(j.crearComunidad({ nombre: 'Ana Pérez - C.J', descripcion: 'x' }), { tipo: 'dudoso', aplicado: null })
    t += 1000
    const halladas = await j.buscarComunidades({ nombre: 'Ana Pérez - C.J', desde: new Date(AHORA - 60_000).toISOString() })
    assert.equal(halladas.length, 1)
    assert.equal((await j.buscarComunidades({ nombre: 'Ana Pérez - C.J', desde: new Date(AHORA + 60_000).toISOString() })).length, 0)
  })
  test('generalAutomatico, noAgregables e invalidos', async () => {
    const j = J.clienteWhapiDeJuguete({ generalAutomatico: true, noAgregables: ['5491100000009'], invalidos: ['5491100000008'] })
    const com = await j.crearComunidad({ nombre: 'Ana - C.J', descripcion: '' })
    const sub = await j.subgruposComunidad(com.id)
    assert.ok(sub.avisos)
    assert.deepEqual(sub.otros.map((g) => [g.nombre, g.generalChat]), [['General', true]])
    const g = await j.crearGrupoEnComunidad({ comunidadId: com.id, nombre: 'Ventas', participantes: ['5491100000001', '5491100000009'] })
    assert.deepEqual([g.agregados, g.fallidos], [['5491100000001'], ['5491100000009']])
    assert.deepEqual(await j.verificarNumeros(['5491100000001', '5491100000008']), { 5491100000001: 'valido', 5491100000008: 'invalido' })
    await rechaza(j.subgruposComunidad('120363000000000000@g.us'), { tipo: 'no_encontrado' })
  })
  test('sinIdEnEnvios: el envío vuelve con id null y el eco trae el id (igual que lo clasificaría el webhook real)', async () => {
    const j = J.clienteWhapiDeJuguete({ sinIdEnEnvios: true, ahora: () => AHORA, telefonoBot: '5490000000000' })
    const r = await j.enviarTexto({ chatId: GRUPOS.verificaciones, texto: 'Alta de Ana: OK?', citar: 'abcd1234-x' })
    assert.deepEqual(r, { id: null, simulado: false })
    await j.enviarTexto({ chatId: '120363000000000070@g.us', texto: 'a otro grupo: eco con grupo null' })
    const [eco, otro] = j.ecos(GRUPOS)
    assert.equal(j.ecos(GRUPOS).length, 2)
    assert.deepEqual([otro.grupo, otro.chatId], [null, '120363000000000070@g.us'])
    const id = j.mensajes()[0].id
    // El mismo mensaje como llegaría por el webhook real
    const delWebhook = clasificarUno({ id, from_me: true, source: 'api', type: 'text', chat_id: GRUPOS.verificaciones, timestamp: AHORA / 1000, text: { body: 'Alta de Ana: OK?' }, from: '5490000000000', context: { quoted_id: 'abcd1234-x' } })
    assert.deepEqual({ ...eco, recibidoEn: null }, { ...delWebhook.evento, autor: { ...delWebhook.evento.autor, nombre: 'Capital Jurídico' }, recibidoEn: null })
  })
  test('rechaza ids "seco-…", menciones sin "@" y descarga más grande que el tope; reiniciar borra todo', async () => {
    const j = J.clienteWhapiDeJuguete({ medios: { 'jpeg-0a1b': { contenido: 'x'.repeat(100), mime: 'image/jpeg' } } })
    await rechaza(j.enviarTexto({ chatId: 'seco-1', texto: 'x' }), { tipo: 'config' })
    await rechaza(j.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x', menciones: ['5491100000001'] }), { tipo: 'config' })
    assert.equal(j.registro().length, 0, 'lo que no pasa la validación no cuenta como salida')
    const m = await j.descargarMedio({ id: 'jpeg-0a1b', tipo: 'image', mime: 'image/png' })
    assert.equal(m.bytes, 100)
    assert.equal(m.mime, 'image/jpeg')
    assert.equal(m.sha256, createHash('sha256').update('x'.repeat(100)).digest('hex'))
    await rechaza(j.descargarMedio({ id: 'jpeg-0a1b', tipo: 'image', mime: 'image/png' }, { maxBytes: 10 }), { tipo: 'rechazo', status: 413 })
    const sintetico = await j.descargarMedio({ id: 'pdf-ffff', tipo: 'document', mime: 'application/pdf' })
    assert.equal(sintetico.mime, 'application/pdf')
    j.reiniciar()
    assert.equal(j.registro().length, 0)
    assert.equal(j.llamadas().length, 0)
  })
  test('envuelto en la compuerta en seco, el juguete no recibe nada', async () => {
    const j = J.clienteWhapiDeJuguete()
    const c = P.aplicarCompuerta(j, { modo: 'seco', capacidades: new Set(), grupos: GRUPOS })
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' })
    await c.crearComunidad({ nombre: 'x', descripcion: '' })
    assert.equal(j.llamadas().length, 0)
    assert.equal(c.registro().length, 2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('configuración y errores', () => {
  test('configWebhook: secreto (24+, sin espacios, no repetitivo), grupos con forma de @g.us y canal opcional', () => {
    assert.equal(CFG.configWebhook(ENV_OK).ok, true)
    assert.deepEqual(CFG.configWebhook({}), { ok: false, faltan: ['WHAPI_WEBHOOK_SECRETO', 'WHAPI_GRUPO_VENTAS', 'WHAPI_GRUPO_VERIFICACIONES'], invalidas: [] })
    assert.deepEqual(CFG.configWebhook({ ...ENV_OK, WHAPI_WEBHOOK_SECRETO: `${SECRETO} con espacio` }).invalidas, ['WHAPI_WEBHOOK_SECRETO'])
    assert.equal(CFG.configWebhook({ ...ENV_OK, WHAPI_GRUPO_VENTAS: ` ${GRUPOS.ventas}\n` }).ok, true, 'espacios alrededor se toleran')
    assert.equal(CFG.tokenWhapi({ WHAPI_TOKEN: 'corto' }), null)
    assert.equal(CFG.tokenWhapi(ENV_OK), TOKEN)
  })
  test('tipoPorStatus y esErrorWhapi', () => {
    assert.equal(E.tipoPorStatus(500, true), 'dudoso')
    assert.equal(E.tipoPorStatus(500, false), 'pasajero')
    assert.equal(E.tipoPorStatus(408, true), 'dudoso')
    assert.equal(E.tipoPorStatus(418, true), 'rechazo')
    assert.equal(E.esErrorWhapi(new E.ErrorWhapi('auth', 'x', 401)), true)
    assert.equal(E.esErrorWhapi({ name: 'ErrorWhapi', tipo: 'auth', aplicado: false }), true)
    assert.equal(E.esErrorWhapi(new Error('x')), false)
    assert.equal(E.limpiarDetalle(`algo ${TOKEN} y Bearer abc.def`, TOKEN), 'algo ••• y Bearer •••')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('scripts/bot-whapi-configurar.mjs y el PATCH /settings (ajustes.ts)', () => {
  const cuerpoDe = (texto) => {
    const lineas = texto.split('\n')
    const i = lineas.indexOf('{')
    return JSON.parse(lineas.slice(i, lineas.indexOf('}', i) + 1).join('\n'))
  }
  const correr = async (argv, { env = {}, fetch = fetchFalso(() => assert.fail('salió a la red')) } = {}) => {
    const lineas = []
    const codigo = await CLI.main(argv, { env, fetch, salida: (t) => lineas.push(t) })
    return { codigo, texto: lineas.join('\n'), fetch }
  }
  test('--simular (por defecto): sin red, cuerpo con TODOS los campos de la trampa y el secreto tapado', async () => {
    const { codigo, texto, fetch } = await correr([], { env: { WHAPI_WEBHOOK_SECRETO: SECRETO } })
    assert.equal(codigo, 0)
    assert.equal(fetch.pedidos.length, 0)
    assert.ok(!texto.includes(SECRETO), 'imprimió el secreto')
    const cuerpo = cuerpoDe(texto)
    for (const k of ['pdo_sync', 'offline_mode', 'full_history', 'auto_read_messages', 'callback_persist', 'callback_backoff_delay_ms', 'max_callback_backoff_delay_ms', 'media', 'webhooks']) assert.ok(k in cuerpo, k)
    assert.deepEqual([cuerpo.pdo_sync, cuerpo.offline_mode, cuerpo.full_history, cuerpo.auto_read_messages], [true, false, false, false])
    assert.equal(cuerpo.callback_persist, true)
    assert.deepEqual(cuerpo.media.auto_download, [])
    // Ronda 2 (24/10): también channel.post y users.delete, para enterarse si la sesión del número se cae.
    // WhatsApp seguro (26/10): y groups.patch (groups_participants), para ver cuándo el cliente entra al General por el link
    assert.deepEqual(cuerpo.webhooks, [{ url: AJ.URL_WEBHOOK_POR_DEFECTO, mode: 'body', events: [{ type: 'messages', method: 'post' }, { type: 'messages', method: 'patch' }, { type: 'channel', method: 'post' }, { type: 'users', method: 'delete' }, { type: 'groups', method: 'patch' }], headers: { 'x-cj-bot-secreto': '•••(oculto)' }, webhook_max_age_seconds: 86400 }])
    assert.match(texto, /REINICIAR/)
  })
  test('--simular --actual: parte de lo leído (campos desconocidos, otros webhooks y pdo_sync false quedan) y apaga auto_download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whapi-ajustes-'))
    try {
      const archivo = join(dir, 'settings.json')
      writeFileSync(archivo, JSON.stringify({ pdo_sync: false, locale: 'es-AR', proxy: 'socks5://usuario:clave@1.2.3.4:1080', callback_persist: true, media: { auto_download: ['image', 'document'], init_avatars: true }, webhooks: [{ url: 'https://otro.test/hook?clave=xyz', mode: 'method', headers: { Authorization: 'Bearer otro' } }] }))
      const { codigo, texto } = await correr([`--actual=${archivo}`, '--url=https://despacho.test/api/bot/whapi'], { env: {} })
      assert.equal(codigo, 0)
      const cuerpo = cuerpoDe(texto)
      assert.equal(cuerpo.pdo_sync, false)
      assert.equal(cuerpo.locale, 'es-AR')
      assert.equal(cuerpo.proxy, '•••(oculto)')
      assert.deepEqual(cuerpo.media, { auto_download: [], init_avatars: true })
      assert.equal(cuerpo.webhooks.length, 2)
      assert.equal(cuerpo.webhooks[0].url, 'https://otro.test/•••')   // de otro webhook solo el host (el token puede ir en la ruta)
      assert.deepEqual(cuerpo.webhooks[0].headers, { Authorization: '•••(oculto)' })
      assert.equal(cuerpo.webhooks[1].url, 'https://despacho.test/api/bot/whapi')
      assert.ok(!texto.includes('clave@') && !texto.includes('Bearer otro') && !texto.includes('xyz'))
      assert.match(texto, /Se apaga auto_download/)
      assert.doesNotMatch(texto, /REINICIAR/, 'callback_persist ya estaba en true')
      assert.match(texto, /WHAPI_WEBHOOK_SECRETO no está/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('--real sin --confirmar: solo GET /settings y la diferencia tapada; con --confirmar: PATCH con el secreto real y webhook_test', async () => {
    const actual = { pdo_sync: true, offline_mode: false, callback_persist: false, webhooks: [] }
    const env = { WHAPI_TOKEN: TOKEN, WHAPI_WEBHOOK_SECRETO: SECRETO }
    const solo = await correr(['--real'], { env, fetch: fetchFalso([{ json: actual }]) })
    assert.equal(solo.codigo, 0)
    assert.equal(solo.fetch.pedidos.length, 1)
    assert.equal(solo.fetch.pedidos[0].metodo, 'GET')
    assert.match(solo.texto, /repetí con --confirmar/)
    assert.ok(!solo.texto.includes(SECRETO) && !solo.texto.includes(TOKEN))
    const f = fetchFalso([{ json: actual }, { json: { before_update: {}, after_update: {}, changes: ['webhooks', 'callback_persist'] } }, { json: { success: true } }])
    const todo = await correr(['--real', '--confirmar'], { env, fetch: f })
    assert.equal(todo.codigo, 0)
    assert.deepEqual(f.pedidos.map((p) => `${p.metodo} ${p.url.replace('https://gate.whapi.cloud', '')}`), ['GET /settings', 'PATCH /settings', 'POST /settings/webhook_test'])
    assert.equal(f.pedidos[1].cuerpo.webhooks[0].headers['x-cj-bot-secreto'], SECRETO, 'el PATCH lleva el secreto de verdad')
    assert.equal(f.pedidos[1].cuerpo.full_history, false)
    assert.equal(f.pedidos[1].cuerpo.auto_read_messages, false)
    // Ronda 2 (24/10): la prueba lleva el header del secreto (webhook_test no usa los del webhook guardado: sin él, 401)
    assert.deepEqual(f.pedidos[2].cuerpo, { type: 'messages', url: AJ.URL_WEBHOOK_POR_DEFECTO, mode: 'body', headers: { 'x-cj-bot-secreto': SECRETO } })
    assert.match(todo.texto, /SIN "\(401\)"/)
    assert.ok(!todo.texto.includes(SECRETO) && !todo.texto.includes(TOKEN))
    assert.match(todo.texto, /reiniciar el canal/)
  })
  test('--real sin token o sin secreto, --url inválida o un argumento desconocido: código 1 y sin red', async () => {
    assert.equal((await correr(['--real'], { env: { WHAPI_WEBHOOK_SECRETO: SECRETO } })).codigo, 1)
    assert.equal((await correr(['--real'], { env: { WHAPI_TOKEN: TOKEN } })).codigo, 1)
    assert.equal((await correr(['--url=http://despacho.test/api/bot/whapi'])).codigo, 1)
    assert.equal((await correr(['--url=https://despacho.test/api/otra'])).codigo, 1)
    assert.equal((await correr(['--borrar'])).codigo, 1)
  })
  test('diferencias() y taparSecretos()', () => {
    const d = AJ.diferencias({ a: 1, webhooks: [{ url: 'https://x.test/h', headers: { 'x-cj-bot-secreto': 'viejo' } }] }, { a: 1, b: 2, webhooks: [{ url: 'https://x.test/h', headers: { 'x-cj-bot-secreto': 'nuevo' } }] })
    assert.deepEqual(d, ['b: (sin valor) → 2'])
    assert.deepEqual(AJ.taparSecretos({ mock_pairing_code: 'ABCD1234', headers: { X: 'y' } }), { mock_pairing_code: '•••(oculto)', headers: { X: '•••(oculto)' } })
    // Revisión del 24/10: un webhook de Make lleva el token en la ruta; de los ajenos se muestra solo el host
    const make = AJ.taparSecretos({ webhooks: [{ url: 'https://hook.us2.make.com/ab12cd34ef56gh78ij90kl12mn34op56' }, { url: 'https://despacho.test/api/bot/whapi?x=1' }, { url: 'no es una url' }] })
    assert.deepEqual(make.webhooks.map((w) => w.url), ['https://hook.us2.make.com/•••', 'https://despacho.test/api/bot/whapi?•••', '•••(oculto)'])
    assert.ok(!JSON.stringify(make).includes('ab12cd34'))
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('revisión del 24/10, ronda 2 (W)', () => {
  test('recortes sin partir un emoji: el veredicto de 500 caracteres y los textos quedan bien formados (Postgres rechaza un surrogate suelto)', () => {
    const largo = `No ${'x'.repeat(496)}😀 y más`   // el emoji cae justo en el carácter 500
    const v = W.veredicto(largo)
    assert.equal(v.tipo, 'no')
    assert.ok(v.motivo.isWellFormed(), 'quedó un surrogate suelto')
    assert.ok(!JSON.stringify(v).includes('\\ud83d'))
    assert.equal(W.cortar('ab😀cd', 3), 'ab')
    assert.equal(W.cortar('ab😀cd', 4), 'ab😀')
    assert.equal(W.cortar('roto \ud83d al medio', 100), 'roto � al medio')
    // Por la ruta entera: el evento que se registraría es JSON bien formado
    const r = W.clasificarEnvoltura(envio([msg({ chat_id: GRUPOS.verificaciones, text: { body: largo }, context: { quoted_id: 'x-1' } })]), GRUPOS, AHORA)
    assert.equal(r.eventos.length, 1)
    assert.ok(!JSON.stringify(r.eventos[0]).match(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i))
  })
  test('sesión del número: channel con QR/ERROR o users.delete → log de ERROR y 200 sin tocar el motor; AUTH → info', async () => {
    assert.deepEqual(W.estadoDelCanal({ event: { type: 'channel', event: 'post' }, health: { status: { code: 4, text: 'AUTH' } } }), { tipo: 'channel', metodo: 'post', estado: 'AUTH', caido: false })
    assert.equal(W.estadoDelCanal({ event: { type: 'channel', event: 'post' }, health: { status: { text: 'QR' } } }).caido, true)
    assert.equal(W.estadoDelCanal({ event: { type: 'channel', event: 'post' }, qr: { base64: 'x' } }).caido, true)
    assert.deepEqual(W.estadoDelCanal({ event: { type: 'users', event: 'delete' }, user: { id: '549111', name: 'Bot' } }), { tipo: 'users', metodo: 'delete', estado: 'LOGOUT', caido: true })
    assert.equal(W.estadoDelCanal(envio([msg()])), null)
    const r = armarRuta()
    const res = await leer(await R.atenderWebhook(pedido({ event: { type: 'users', event: 'delete' }, user: { id: '5491100000000', name: 'Capital Jurídico' }, channel_id: 'MANTIS-PRUEBA1' }), r.deps))
    assert.deepEqual(res.json, { recibido: true, canal: 'LOGOUT', caido: true })
    // WhatsApp seguro (26/10): antes no se programaba nada; ahora UNA tarea en after() avisa la caída a la guardia de salud
    // (frena todos los envíos y manda el aviso único a Discord). El motor sigue sin tocarse
    assert.equal(r.tareas.length, 1)
    assert.equal(r.motor.llamadas.crear.length, 0)
    assert.ok(r.lineas.some(([n, l]) => n === 'error' && /se cayó/.test(l)))
    assert.ok(!r.lineas.some(([, l]) => l.includes('5491100000000')), 'el log no lleva el teléfono')
    const bien = armarRuta()
    await R.atenderWebhook(pedido({ event: { type: 'channel', event: 'post' }, health: { status: { text: 'AUTH' } } }), bien.deps)
    assert.ok(bien.lineas.some(([n]) => n === 'info') && !bien.lineas.some(([n]) => n === 'error'))
  })
  test('freno del barrido: sin eventos nuevos, como mucho uno cada 10 min por instancia; con eventos nuevos, siempre (y cuenta como barrido)', async () => {
    const freno = { ultimo: 0, intervaloMs: R.INTERVALO_BARRIDO_VACIO_MS }
    let t = AHORA
    const r = armarRuta()
    r.deps.frenoBarrido = freno
    r.deps.ahora = () => t
    const charla = () => R.atenderWebhook(pedido(envio([msg({ chat_id: '120363999999999999@g.us', text: { body: 'Buen día equipo' } })])), r.deps)
    await charla()
    assert.equal(r.tareas.length, 1, 'el primero barre')
    t += 60_000; await charla()
    assert.equal(r.tareas.length, 1, 'al minuto no')
    // Charla de Ventas que el motor no guarda (registrar devuelve nuevos: []): tampoco
    const sinNuevos = armarRuta({ motor: motorDeJuguete({ registrar: () => ({ nuevos: [], repetidos: [], ignorados: ['x'] }) }) })
    sinNuevos.deps.frenoBarrido = freno; sinNuevos.deps.ahora = () => t
    await R.atenderWebhook(pedido(envio([msg({ text: { body: 'Teléfono: lo paso luego' } })])), sinNuevos.deps)
    assert.equal(sinNuevos.tareas.length, 0)
    // Un #ALTA siempre se procesa (y reinicia el intervalo)
    t += 60_000
    await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } })])), r.deps)
    assert.equal(r.tareas.length, 2)
    assert.equal(freno.ultimo, t)
    t += R.INTERVALO_BARRIDO_VACIO_MS - 1; await charla()
    assert.equal(r.tareas.length, 2)
    t += 1; await charla()
    assert.equal(r.tareas.length, 3, 'pasados los 10 min vuelve a barrer')
    // La ruta de Next usa el freno compartido de la instancia
    assert.match(readFileSync(join(RAIZ, 'app/api/bot/whapi/route.ts'), 'utf8'), /frenoBarrido: FRENO_BARRIDO/)
  })
  test('webhook de prueba: cuerpo con el header del secreto (cuerpoPrueba)', () => {
    assert.deepEqual(CLI.cuerpoPrueba('https://despacho.test/api/bot/whapi', 's3cr3t'), { type: 'messages', url: 'https://despacho.test/api/bot/whapi', mode: 'body', headers: { 'x-cj-bot-secreto': 's3cr3t' } })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Reenvío a Guiones de los grupos «Contenido - <cliente>» (lib/bot/whapi/guiones.ts, 25/10/2026). Sin red ni base: fetch y
// Neon falsos. Los teléfonos, nombres e ids son inventados.
const G = await import('../lib/bot/whapi/guiones.ts')
const CONTENIDO = '120363000000000077@g.us'
const GENERAL = '120363000000000088@g.us'
const CLIENTE = '5491166660001'
const EQUIPO_TEL = '5491177770001', APROBADOR = '5491177770002', OPERACIONES_LID = '99887766554433@lid'
const ENV_EQUIPO = {
  BOT_ALTA_EQUIPO_TELEFONOS: JSON.stringify({ 'Gero M': `+54 9 11 7777-0001`, Aylu: 'sin teléfono' }),
  BOT_ALTA_APROBADORES: `${APROBADOR}`, BOT_ALTA_OPERACIONES: `${OPERACIONES_LID}, 12`,
}
const msgC = (over = {}) => msg({ chat_id: CONTENIDO, from: CLIENTE, from_name: 'Claudia', text: { body: 'El video 2 cambiale el gancho' }, ...over })

/** Neon falso: pasos de comunidad y la tabla de reenvíos (ON CONFLICT con un Set). */
function neonFalsoG({ contenido = [CONTENIDO], faltaPasos = false, caido = false } = {}) {
  const reclamados = new Set(), marcas = [], consultas = []
  const q = async (strings, ...vals) => {
    const t = strings.join('$')
    consultas.push(t.replace(/\s+/g, ' ').slice(0, 60))
    if (caido) throw Object.assign(new Error('fetch failed'), { name: 'TypeError' })
    if (/FROM cj_altas_pasos/.test(t)) {
      if (faltaPasos) throw Object.assign(new Error('relation "cj_altas_pasos" does not exist'), { code: '42P01' })
      return [...contenido.map((id) => ({ id })), { id: null }, { id: 'basura' }]
    }
    if (/CREATE TABLE IF NOT EXISTS cj_guiones_reenvios/.test(t)) return []
    if (/INSERT INTO cj_guiones_reenvios/.test(t)) {
      assert.match(t, /ON CONFLICT \(mensaje_id\) DO NOTHING RETURNING/)
      if (reclamados.has(vals[0])) return []
      reclamados.add(vals[0]); return [{ mensaje_id: vals[0] }]
    }
    if (/UPDATE cj_guiones_reenvios/.test(t)) { marcas.push({ estado: vals[0], id: vals[1] }); return [] }
    throw new Error(`consulta inesperada: ${t.slice(0, 80)}`)
  }
  return { q, reclamados, marcas, consultas }
}

/** fetch falso: GET /groups/{id} de Whapi y POST a la ruta de Guiones. */
function fetchFalsoG({ nombres = {}, respuesta = { status: 200, cuerpo: { ok: true, tanda: 7 } }, whapiFalla = false } = {}) {
  const llamadas = []
  const f = async (url, init = {}) => {
    llamadas.push({ url: String(url), init })
    const u = new URL(String(url))
    if (u.hostname === 'gate.whapi.cloud') {
      if (whapiFalla) throw new TypeError('fetch failed')
      const id = decodeURIComponent(u.pathname.replace('/groups/', ''))
      if (!(id in nombres)) return new Response('{"error":{"code":404}}', { status: 404 })
      return Response.json({ id, name: nombres[id], type: 'group' })
    }
    return Response.json(respuesta.cuerpo, { status: respuesta.status })
  }
  return { f, llamadas, posts: () => llamadas.filter((l) => l.init.method === 'POST') }
}
const logFalsoG = () => { const lineas = []; return { lineas, log: { info: (m) => lineas.push(['info', m]), warn: (m) => lineas.push(['warn', m]), error: (m) => lineas.push(['error', m]) } } }
const ENV_REENVIO = { CRON_SECRET: 'cron-de-prueba-0123456789abcdef', DATABASE_URL: 'postgres://u:p@base.ejemplo.test/db', WHAPI_TOKEN: TOKEN, DESPACHO_URL: 'https://despacho.ejemplo.test' }

describe('reenvío a Guiones: qué mensajes pueden ir (candidatosGuiones, puro)', () => {
  const equipo = G.personasDelEquipo(ENV_EQUIPO)
  const cands = (mensajes, ahora = AHORA) => G.candidatosGuiones(envio(mensajes), GRUPOS, ahora, equipo)
  test('texto del cliente en un grupo: grupo, texto, mensaje_id, autor, citado y fecha', () => {
    const m = msgC({ id: 'cli-0001', context: { quoted_id: 'aviso-tanda-1', quoted_author: '5491100000000' } })
    const { candidatos } = cands([m])
    assert.deepEqual(candidatos, [{ grupo: CONTENIDO, texto: 'El video 2 cambiale el gancho', mensaje_id: 'cli-0001', autor: 'Claudia', citado: 'aviso-tanda-1', fecha: new Date(TS * 1000).toISOString() }])
    const sinNombre = cands([msgC({ from_name: undefined, context: undefined })]).candidatos[0]
    assert.equal(sinNombre.autor, CLIENTE)
    assert.ok(!('citado' in sinNombre))
  })
  test('imagen solo con su pie (sin pie, nada); audio, sticker, documento, video, reacción y edición no', () => {
    const conPie = msgC({ type: 'image', text: undefined, image: { id: 'jpeg-ab12-cd34', mime_type: 'image/jpeg', caption: 'Así quedó la toma' } })
    const sinPie = msgC({ type: 'image', text: undefined, image: { id: 'jpeg-ab12-cd35', mime_type: 'image/jpeg' } })
    const otros = [
      msgC({ type: 'voice', text: undefined, voice: { id: 'oga-1-2' } }), msgC({ type: 'audio', text: undefined, audio: { id: 'mp3-1-2' } }),
      msgC({ type: 'sticker', text: undefined }), msgC({ type: 'document', text: undefined, document: { id: 'pdf-1-2', mime_type: 'application/pdf', caption: 'guion.pdf' } }),
      msgC({ type: 'video', text: undefined, video: { id: 'mp4-1-2', caption: 'mirá' } }), msgC({ type: 'reaction', text: undefined }),
      msgC({ type: 'action', text: undefined, action: { type: 'edit', target: 'x', edited_content: { body: 'otro' } } }),
    ]
    const r = cands([conPie, sinPie, ...otros])
    assert.deepEqual(r.candidatos.map((c) => c.texto), ['Así quedó la toma'])
    assert.equal(r.descartes.sin_texto, 1)
    assert.equal(r.descartes.tipo, otros.length)
  })
  test('nunca lo del bot (from_me, de la API o del teléfono) ni lo del equipo (teléfono, aprobadores, operaciones por lid)', () => {
    const r = cands([
      msgC({ from_me: true, source: 'api' }), msgC({ from_me: true, source: 'mobile' }),
      msgC({ from: EQUIPO_TEL }), msgC({ from: `${APROBADOR}@s.whatsapp.net` }), msgC({ from: OPERACIONES_LID }),
      msgC({ from: 'otro@lid', phone: EQUIPO_TEL }),
    ])
    assert.equal(r.candidatos.length, 0)
    assert.equal(r.descartes.propio, 2)
    assert.equal(r.descartes.equipo, 4)
  })
  test('Ventas C.J., Verificaciones C.J y los chats privados no; más de 48 h no; el mismo id dos veces, una', () => {
    const r = cands([
      msgC({ chat_id: GRUPOS.ventas }), msgC({ chat_id: GRUPOS.verificaciones }), msgC({ chat_id: `${CLIENTE}@s.whatsapp.net` }),
      msgC({ timestamp: TS - 49 * 3600 }), msgC({ id: 'dos-veces' }), msgC({ id: 'dos-veces' }),
    ])
    assert.deepEqual(r.candidatos.map((c) => c.mensaje_id), ['dos-veces'])
    assert.deepEqual(r.descartes, { grupo_bot: 2, no_grupo: 1, viejo: 1, repetido: 1 })
  })
  test('el grupo de guiones del equipo (WHAPI_GRUPO_COPYWRITING) tampoco', async () => {
    const COPY = '120363000000000099@g.us'
    assert.deepEqual(G.gruposDelEquipo({ WHAPI_GRUPO_COPYWRITING: COPY }), [COPY])
    assert.deepEqual(G.gruposDelEquipo({ WHAPI_GRUPO_COPYWRITING: 'cualquier cosa' }), [])
    const r = G.candidatosGuiones(envio([msgC({ chat_id: COPY })]), GRUPOS, AHORA, equipo, G.gruposDelEquipo({ WHAPI_GRUPO_COPYWRITING: COPY }))
    assert.equal(r.candidatos.length, 0); assert.equal(r.descartes.grupo_bot, 1)
    const ruta = armarRuta({ env: { ...ENV_OK, WHAPI_GRUPO_COPYWRITING: COPY } })
    let llamado = false
    ruta.deps.reenviarGuiones = async () => { llamado = true; return null }
    await R.atenderWebhook(pedido(envio([msgC({ chat_id: COPY })])), ruta.deps)
    await ruta.correr()
    assert.equal(llamado, false)
  })
  test('texto vacío o solo espacios no; texto larguísimo se recorta; un cuerpo raro no tira', () => {
    const r = cands([msgC({ text: { body: '   ' } }), msgC({ text: { body: 'x'.repeat(10_000) } })])
    assert.equal(r.candidatos.length, 1)
    assert.equal(r.candidatos[0].texto.length, G.MAX_TEXTO_REENVIO)
    assert.deepEqual(G.candidatosGuiones(null, GRUPOS, AHORA, equipo).candidatos, [])
    assert.deepEqual(G.candidatosGuiones({ messages: [1, 'x', null] }, GRUPOS, AHORA, equipo).candidatos, [])
  })
  test('personasDelEquipo da lo mismo que listaPersonas / equipoDesdeEntorno del motor (servidor.ts)', async () => {
    const S = await import('../lib/bot/alta/motor/servidor.ts')
    const esperado = new Set([...Object.values(S.equipoDesdeEntorno(ENV_EQUIPO.BOT_ALTA_EQUIPO_TELEFONOS)), ...S.listaPersonas(ENV_EQUIPO.BOT_ALTA_APROBADORES), ...S.listaPersonas(ENV_EQUIPO.BOT_ALTA_OPERACIONES)])
    assert.deepEqual([...G.personasDelEquipo(ENV_EQUIPO)].sort(), [...esperado].sort())
    assert.deepEqual([...G.personasDelEquipo({ BOT_ALTA_EQUIPO_TELEFONOS: '{roto', BOT_ALTA_APROBADORES: APROBADOR })], [APROBADOR])
  })
})

describe('reenvío a Guiones: la ruta de Whapi', () => {
  const armar = (op = {}) => {
    const r = armarRuta(op)
    const llamadas = []
    const estado = { tira: false }
    r.deps.reenviarGuiones = async (c, o) => { llamadas.push({ c, o }); if (estado.tira) throw new Error('falló'); return null }
    return { ...r, llamadas, estado }
  }
  test('un texto de un grupo cualquiera: misma respuesta de antes y el reenvío va en segundo plano, con el origen propio', async () => {
    const r = armar()
    const res = await leer(await R.atenderWebhook(pedido(envio([msgC({ id: 'cli-ruta-1' })])), r.deps))
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { recibido: true, eventos: 0, descartados: 1 })
    assert.equal(r.llamadas.length, 0, 'nada antes de responder')
    await r.correr()
    assert.equal(r.llamadas.length, 1)
    assert.deepEqual(r.llamadas[0].c.map((x) => x.mensaje_id), ['cli-ruta-1'])
    assert.equal(r.llamadas[0].o.origen, 'https://despacho.test')
    assert.ok(r.lineas.some(([, l]) => /1 candidato\(s\) a Guiones/.test(l)))
    assert.ok(!r.lineas.some(([, l]) => l.includes('cambiale') || l.includes(CLIENTE)), 'el log no trae textos ni teléfonos')
  })
  test('sin el secreto o de otro canal: no se reenvía nada', async () => {
    const a = armar()
    assert.equal((await R.atenderWebhook(pedido(envio([msgC()]), { secreto: 'otro-secreto-que-no-es-0123456789' }), a.deps)).status, 401)
    const b = armar({ env: { ...ENV_OK, WHAPI_CANAL_ID: 'MANTIS-OTRO99' } })
    assert.equal((await leer(await R.atenderWebhook(pedido(envio([msgC()])), b.deps))).json.ignorado, 'canal')
    const c = armar({ env: { ...ENV_OK, WHAPI_WEBHOOK_SECRETO: '' } })
    assert.equal((await R.atenderWebhook(pedido(envio([msgC()])), c.deps)).status, 503)
    for (const x of [a, b, c]) { await x.correr(); assert.equal(x.llamadas.length, 0) }
  })
  test('un #ALTA de Ventas sigue yendo solo al motor; la charla del equipo en un grupo Contenido no se reenvía', async () => {
    const r = armar({ env: { ...ENV_OK, ...ENV_EQUIPO } })
    await R.atenderWebhook(pedido(envio([msg({ text: { body: TEXTO_ALTA } }), msgC({ from: EQUIPO_TEL })])), r.deps)
    await r.correr()
    assert.equal(r.llamadas.length, 0)
    assert.equal(r.motor.llamadas.registrar.length, 1)
  })
  test('si el motor no se puede armar (503), el reenvío ya quedó programado (el reintento de Whapi no duplica: dedupe)', async () => {
    const r = armar({ motor: { crear: () => { throw new Error('sin base') }, llamadas: { crear: [], registrar: [], procesar: [] } } })
    assert.equal((await R.atenderWebhook(pedido(envio([msgC()])), r.deps)).status, 503)
    await r.correr()
    assert.equal(r.llamadas.length, 1)
  })
  test('si el reenvío tira, queda en el log y no rompe nada', async () => {
    const r = armar()
    r.estado.tira = true
    assert.equal((await R.atenderWebhook(pedido(envio([msgC()])), r.deps)).status, 200)
    await r.correr()
    assert.ok(r.lineas.some(([n, l]) => n === 'error' && /guiones — el reenvío tiró/.test(l)))
  })
  test('la ruta de Next pasa el reenvío real', () => {
    assert.match(readFileSync(join(RAIZ, 'app/api/bot/whapi/route.ts'), 'utf8'), /reenviarGuiones: reenviarGuionesReal/)
  })
})

describe('reenvío a Guiones: reenviarAGuiones (dependencias falsas)', () => {
  const depsFalsasG = (op = {}) => {
    const enviados = [], marcas = [], reclamados = new Set()
    const { log, lineas } = logFalsoG()
    const deps = {
      log, recuerdo: new Set(),
      esGrupoContenido: async (g) => (op.contenido ?? [CONTENIDO]).includes(g),
      reclamar: async (id) => { if (op.reclamarTira) throw new Error('sin base'); if (reclamados.has(id)) return false; reclamados.add(id); return true },
      marcar: async (id, estado) => { marcas.push([id, estado]) },
      enviar: async (m) => { enviados.push(m); if (op.enviarTira) throw Object.assign(new Error('x'), { name: 'TimeoutError' }); return op.respuesta ?? { status: 200, cuerpo: { ok: true, tanda: 3 } } },
    }
    return { deps, enviados, marcas, lineas }
  }
  const c = (over = {}) => ({ grupo: CONTENIDO, texto: 'cambiá el 2', mensaje_id: 'm-1', autor: 'Claudia', fecha: '2026-10-25T12:00:00.000Z', ...over })
  test('manda los de grupos Contenido y marca la nota; los de otros grupos no', async () => {
    const d = depsFalsasG()
    const r = await G.reenviarAGuiones([c(), c({ grupo: GENERAL, mensaje_id: 'm-2' })], d.deps)
    assert.deepEqual(d.enviados.map((x) => x.mensaje_id), ['m-1'])
    assert.deepEqual(d.marcas, [['m-1', 'nota']])
    assert.equal(r.notas, 1); assert.equal(r.otroGrupo, 1)
  })
  test('el mismo mensaje_id no se manda dos veces (ni en la misma instancia ni si la base ya lo tenía)', async () => {
    const d = depsFalsasG()
    await G.reenviarAGuiones([c()], d.deps)
    const r2 = await G.reenviarAGuiones([c()], d.deps)
    assert.equal(r2.repetidos, 1)
    d.deps.recuerdo = new Set()   // otra instancia: la base frena
    const r3 = await G.reenviarAGuiones([c()], d.deps)
    assert.equal(r3.repetidos, 1)
    assert.equal(d.enviados.length, 1)
  })
  test('sin tanda en el grupo (ignorado), error HTTP o sin respuesta: queda el estado y no se reintenta', async () => {
    const a = depsFalsasG({ respuesta: { status: 200, cuerpo: { ok: true, ignorado: 'no hay una tanda avisada en ese grupo' } } })
    assert.equal((await G.reenviarAGuiones([c()], a.deps)).ignorados, 1)
    assert.deepEqual(a.marcas, [['m-1', 'ignorado']])
    const b = depsFalsasG({ respuesta: { status: 503, cuerpo: { ok: false } } })
    assert.equal((await G.reenviarAGuiones([c()], b.deps)).errores, 1)
    assert.deepEqual(b.marcas, [['m-1', 'error_http_503']])
    assert.ok(b.lineas.some(([n]) => n === 'warn'))
    const e = depsFalsasG({ enviarTira: true })
    assert.equal((await G.reenviarAGuiones([c()], e.deps)).errores, 1)
    assert.deepEqual(e.marcas, [['m-1', 'error_TimeoutError']])
    assert.equal(e.enviados.length, 1)
  })
  test('sin base para reclamar: no se manda (sin dedupe no sale nada) y no tira', async () => {
    const d = depsFalsasG({ reclamarTira: true })
    const r = await G.reenviarAGuiones([c()], d.deps)
    assert.equal(d.enviados.length, 0); assert.equal(r.errores, 1)
  })
})

describe('reenvío a Guiones: lo real con Neon y fetch falsos', () => {
  const real = (op = {}) => {
    G.olvidarCachesGuiones()
    const db = neonFalsoG(op.db), red = fetchFalsoG(op.red), { log, lineas } = logFalsoG()
    const env = { ...ENV_REENVIO, ...(op.env ?? {}) }
    const opciones = { env, origen: 'https://despacho.test', log, fetch: red.f, sql: db.q, ahora: () => AHORA }
    return { db, red, lineas, env, opciones }
  }
  test('grupo guardado por el paso comunidad: no pregunta a Whapi; POST con Bearer CRON_SECRET y el contrato exacto', async () => {
    const x = real()
    const cand = { grupo: CONTENIDO, texto: 'cambiá el 2', mensaje_id: 'cli-real-1', autor: 'Claudia', citado: 'aviso-1', fecha: '2026-10-25T12:00:00.000Z' }
    const r = await G.reenviarGuionesReal([cand], x.opciones)
    assert.equal(r.notas, 1)
    assert.equal(x.red.llamadas.filter((l) => l.url.includes('whapi')).length, 0)
    const [p] = x.red.posts()
    assert.equal(p.url, 'https://despacho.ejemplo.test/api/bot/guiones/respuesta')
    assert.equal(p.init.headers.authorization, `Bearer ${ENV_REENVIO.CRON_SECRET}`)
    assert.deepEqual(JSON.parse(p.init.body), cand)
    assert.deepEqual(x.db.marcas, [{ estado: 'nota', id: 'cli-real-1' }])
    for (const [, l] of x.lineas) assert.ok(!l.includes(ENV_REENVIO.CRON_SECRET) && !l.includes('cambiá'))
  })
  test('grupo que no está en el motor: GET /groups/{id} de Whapi (Bearer WHAPI_TOKEN); «Contenido - …» sí, otro nombre no; con caché', async () => {
    const x = real({ db: { contenido: [] }, red: { nombres: { [CONTENIDO]: 'Contenido - Claudia R', [GENERAL]: 'General - Claudia R' } } })
    const d = G.depsReenvioReal(x.opciones).deps
    assert.equal(await d.esGrupoContenido(CONTENIDO), true)
    assert.equal(await d.esGrupoContenido(GENERAL), false)
    const gets = x.red.llamadas.filter((l) => l.url.startsWith('https://gate.whapi.cloud/groups/'))
    assert.equal(gets.length, 2)
    assert.equal(gets[0].init.headers.authorization, `Bearer ${TOKEN}`)
    assert.equal(await d.esGrupoContenido(CONTENIDO), true)
    assert.equal(await d.esGrupoContenido(GENERAL), false)
    assert.equal(x.red.llamadas.length, 2, 'la segunda vez sale de la caché')
    assert.equal(x.db.consultas.filter((t) => /SELECT DISTINCT COALESCE/.test(t)).length, 1, 'los grupos del motor se leen una vez')
  })
  test('sin la tabla de pasos, Whapi que falla o un 404: no es Contenido (y no tira)', async () => {
    const x = real({ db: { faltaPasos: true }, red: { whapiFalla: true } })
    assert.equal(await G.depsReenvioReal(x.opciones).deps.esGrupoContenido(CONTENIDO), false)
    const y = real({ db: { contenido: [] } })
    assert.equal(await G.depsReenvioReal(y.opciones).deps.esGrupoContenido(CONTENIDO), false)
  })
  test('sin DESPACHO_URL usa el origen del pedido; sin CRON_SECRET o sin base no reenvía (log con NOMBRES); BOT_GUIONES_REENVIO=no lo apaga', async () => {
    const cand = { grupo: CONTENIDO, texto: 'hola', mensaje_id: 'cli-real-2', autor: null }
    const a = real({ env: { DESPACHO_URL: '' } })
    await G.reenviarGuionesReal([cand], a.opciones)
    assert.equal(a.red.posts()[0].url, 'https://despacho.test/api/bot/guiones/respuesta')
    assert.equal(G.baseDespacho({ DESPACHO_URL: 'http://inseguro.test' }, 'https://propio.test/api/bot/whapi'), 'https://propio.test')
    assert.equal(G.baseDespacho({}, 'nada'), null)
    const b = real({ env: { CRON_SECRET: '' } })
    assert.equal(await G.reenviarGuionesReal([cand], b.opciones), null)
    assert.equal(b.red.llamadas.length, 0)
    assert.ok(b.lineas.some(([, l]) => /sin CRON_SECRET/.test(l)))
    const c = real({ env: { BOT_GUIONES_REENVIO: 'no' } })
    assert.equal(await G.reenviarGuionesReal([cand], c.opciones), null)
    assert.equal(c.red.llamadas.length + c.db.consultas.length, 0)
  })
  test('de punta a punta: el webhook reenvía una vez; el mismo mensaje otra vez (reintento de Whapi) no sale de nuevo', async () => {
    const x = real()
    const r = armarRuta({ env: { ...ENV_OK, ...ENV_EQUIPO } })
    r.deps.reenviarGuiones = (c, o) => G.reenviarGuionesReal(c, { ...x.opciones, log: o.log })
    const cuerpo = envio([msgC({ id: 'cli-e2e-1' }), msgC({ id: 'cli-e2e-eq', from: EQUIPO_TEL }), msgC({ id: 'cli-e2e-gen', chat_id: GENERAL })])
    for (let i = 0; i < 2; i++) {
      assert.equal((await R.atenderWebhook(pedido(cuerpo), r.deps)).status, 200)
      await r.correr(); r.tareas.length = 0
    }
    assert.deepEqual(x.red.posts().map((p) => JSON.parse(p.init.body).mensaje_id), ['cli-e2e-1'])
    assert.equal(x.red.llamadas.filter((l) => l.url.includes(encodeURIComponent(GENERAL))).length, 1, 'el General se pregunta una vez y se ignora')
  })
})
