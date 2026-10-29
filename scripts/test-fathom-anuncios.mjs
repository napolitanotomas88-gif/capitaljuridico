// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-fathom-anuncios.mjs
// Fathom → cambios de anuncios → Discord (lib/fathomAnuncios y app/api/fathom-anuncios). SIN red, SIN base y SIN Claude:
// el orquestador se prueba con dependencias falsas, Discord con un fetch falso, y fetch global queda bloqueado para que
// un descuido no le escriba a nadie. Los secretos, IDs y nombres de acá son inventados.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Antes de importar nada: entorno limpio (que ninguna variable real del shell active una llamada de verdad)
for (const k of ['ANTHROPIC_API_KEY', 'FATHOM_WEBHOOK_SECRET', 'DISCORD_WEBHOOK_CAMBIOS_ANUNCIOS', 'DISCORD_WEBHOOK_ANUNCIOS',
  'DISCORD_ID_VALENTINO', 'DATABASE_URL', 'CUOTAS_DATABASE_URL', 'CRON_SECRET', 'SHEET_ID_CLIENTES', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) delete process.env[k]
for (const k of ['HUB_CONFIG_FINANZAS_CUENTAS_JSON', 'HUB_CONFIG_ANUNCIOS_CUENTAS_JSON', 'HUB_CONFIG_ANUNCIOS_PRESUPUESTOS_JSON', 'HUB_CONFIG_FATHOM_ALIAS_JSON']) delete process.env[k]
process.env.HUB_CONFIG_FATHOM_ALIAS_JSON = '[]'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const { claveDeSecreto, firmar, verificarFirma } = await import('../lib/fathomAnuncios/firma.ts')
const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')
const { segundos, linkFathom, horaCorta, formatearTranscripcion, duracionGrabacionS, fechaLargaAR, fechaCortaAR } = await import('../lib/fathomAnuncios/transcripcion.ts')
const { armarMensajes, escaparDiscord, sinMenciones, partir, textoAviso, textoSinTranscripcion, clavesUnicas, MAX_DISCORD } = await import('../lib/fathomAnuncios/mensaje.ts')
const { enviarDiscord, idDiscord, ErrorEnvio } = await import('../lib/fathomAnuncios/discord.ts')
const {
  procesarReunion, reintentarPendientes, reintentoDe, motivoDe, ID_TOMAS, PLAZO_MS, MARGEN_ENVIO_MS, ESPERA_REINTENTO_MS,
  PREFIJO_AGOTADA, PREFIJO_SIN_PAYLOAD, PREFIJO_SIN_TRANSCRIPCION, TOPE_INTENTOS_CRON,
} = await import('../lib/fathomAnuncios/procesar.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')
const { validarSalida, mensajeUsuario, extraerCambios, lineasAlias, SCHEMA_SALIDA } = await import('../lib/fathomAnuncios/extraer.ts')
const { aliasValidos } = await import('../lib/fathomAnuncios/servidor.ts')
const { aliasDesdeNota } = await import('./fathom-alias-desde-boveda.mjs')
const { armarClientesConocidos, lineasClientes } = await import('../lib/fathomAnuncios/contexto.ts')
const { PROMPT_SISTEMA, VERSION_PROMPT } = await import('../lib/fathomAnuncios/prompt.ts')

const VALENTINO = '111111111111111111'
const AHORA = Date.parse('2026-10-12T22:10:00Z')
const SECRETO_B64 = randomBytes(24).toString('base64')
const SECRETO = `whsec_${SECRETO_B64}`

// ── Datos de prueba ──
const hms = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
const renglones = (n, cada = 30) => Array.from({ length: n }, (_, i) => ({
  speaker: { display_name: i % 4 < 2 ? 'Tomás Napolitano' : 'Laura Pérez', matched_calendar_invitee_email: null },
  text: `frase número ${i}`,
  timestamp: hms(i * cada),
}))
const reunion = (over = {}) => ({
  title: 'Seguimiento Laura Pérez', meeting_title: 'Seguimiento', recording_id: 123456789,
  url: 'https://fathom.video/calls/123456789', share_url: 'https://fathom.video/share/abc',
  created_at: '2026-10-12T22:05:00Z', recording_start_time: '2026-10-12T21:32:00Z', recording_end_time: '2026-10-12T22:02:00Z',
  calendar_invitees_domains_type: 'one_or_more_external',
  transcript: renglones(40),
  default_summary: { template_name: 'General', markdown_formatted: '## Summary\nBudget goes up.' },
  action_items: [{ description: 'Raise budget', recording_timestamp: '00:05:00', recording_playback_url: 'https://fathom.video/calls/123456789?timestamp=300', assignee: { name: 'Tomás', email: 't@x.com', team: null } }],
  calendar_invitees: [{ name: 'Laura Pérez', email: 'laura@estudio.com', email_domain: 'estudio.com', is_external: true }],
  recorded_by: { name: 'Tomás Napolitano', email: 'tomas@skyward.com', email_domain: 'skyward.com', team: null },
  ...over,
})
const cambio = (over = {}) => ({ tipo: 'presupuesto', detalle: 'Subí el presupuesto a USD 10 por día.', cuando: null, certeza: 'confirmado', timestamp: '00:05:00', cita: 'subilo a diez dólares', ...over })
const clienteEx = (over = {}) => ({ nombre_escuchado: 'Laura', cliente_crm: 'Laura Pérez', cuenta_publicitaria: 'act_123', cambios: [cambio()], pendientes: [], ...over })
const extraccion = (over = {}) => ({
  extraccion: { tipo_reunion: 'cliente', resumen_corto: 'Seguimiento con Laura', clientes: [clienteEx()], ...over },
  modelo: 'claude-opus-5-5', usage: { input_tokens: 12000, output_tokens: 800 }, ajustes: [],
})

/** Lo que devuelve reclamar() para una fila nueva (sin nada de antes). */
const reclamoNuevo = (over = {}) => ({
  intentos: 1, error_previo: null, resultado: null, version_prompt: null, modelo: null, tokens_in: null, tokens_out: null,
  clientes_enviados: [], mensajes: [], ...over,
})

/** Dependencias falsas que anotan cada llamada. El reloj es falso: cada lectura avanza 1 ms y esperar() lo adelanta. */
function fakes(over = {}) {
  const log = { reclamar: [], guardar: [], anotar: [], marcar: [], contexto: 0, extraer: [], enviar: [], avisar: [], esperas: [] }
  const reloj = { t: AHORA }
  let n = 0
  const deps = {
    reclamar: async (...a) => { log.reclamar.push(a); return reclamoNuevo() },
    guardarExtraccion: async (id, x) => { log.guardar.push({ id, ...x }) },
    anotarEnviados: async (id, clientes, mensajes) => { log.anotar.push({ id, clientes, mensajes }) },
    marcar: async (id, m) => { log.marcar.push({ id, ...m }) },
    contexto: async () => { log.contexto++; return { clientes: [{ nombre: 'Laura Pérez', estado: 'ACTIVO', email: 'laura@estudio.com', cuentas: ['act_123'] }], estado: 'ok' } },
    extraer: async (e, tope) => { log.extraer.push({ ...e, tope }); return extraccion() },
    enviar: async (m, deadline) => { log.enviar.push(m); log.deadline = deadline; return m.map(() => `msg${++n}`) },
    avisar: async t => { log.avisar.push(t) },
    esperar: async ms => { log.esperas.push(ms); reloj.t += ms },
    alias: [],
    valentino: VALENTINO,
    discordListo: true,
    ahora: () => (reloj.t += 1),
    ...over,
  }
  return { deps, log, reloj }
}

// ── Firma (Standard Webhooks) ─────────────────────────────────────────────────────────────────
describe('firma Standard Webhooks', () => {
  const cuerpo = JSON.stringify({ recording_id: 1, title: 'x' })
  const ts = String(Math.floor(AHORA / 1000))
  // Vector calculado acá, sin pasar por firmar(): HMAC-SHA256 base64 de `${id}.${ts}.${cuerpo}` con la clave decodificada
  const vector = `v1,${createHmac('sha256', Buffer.from(SECRETO_B64, 'base64')).update(`msg_abc.${ts}.${cuerpo}`).digest('base64')}`
  const cab = (firma, extra = {}) => ({ id: 'msg_abc', timestamp: ts, firma, ...extra })

  test('válida con un vector generado en el test (y firmar() da lo mismo)', () => {
    assert.deepEqual(verificarFirma(SECRETO, cab(vector), cuerpo, AHORA), { ok: true })
    assert.equal(firmar(SECRETO, 'msg_abc', ts, cuerpo), vector)
  })
  test('inválida: cuerpo tocado, otro secreto, otro id, firma basura o de otro largo', () => {
    assert.equal(verificarFirma(SECRETO, cab(vector), cuerpo + ' ', AHORA).ok, false)
    assert.equal(verificarFirma(`whsec_${randomBytes(24).toString('base64')}`, cab(vector), cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, cab(vector, { id: 'msg_otro' }), cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, cab('v1,abc'), cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, cab(vector.replace('v1,', 'v2,')), cuerpo, AHORA).ok, false)   // otra versión no cuenta
    assert.equal(verificarFirma(SECRETO, cab(vector.slice(0, -2)), cuerpo, AHORA).ok, false)
  })
  test('timestamp viejo o adelantado más de 5 minutos, o no numérico: rechazado', () => {
    const viejo = String(Number(ts) - 301), futuro = String(Number(ts) + 301)
    assert.equal(verificarFirma(SECRETO, { id: 'msg_abc', timestamp: viejo, firma: firmar(SECRETO, 'msg_abc', viejo, cuerpo) }, cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, { id: 'msg_abc', timestamp: futuro, firma: firmar(SECRETO, 'msg_abc', futuro, cuerpo) }, cuerpo, AHORA).ok, false)
    const justo = String(Number(ts) - 299)
    assert.equal(verificarFirma(SECRETO, { id: 'msg_abc', timestamp: justo, firma: firmar(SECRETO, 'msg_abc', justo, cuerpo) }, cuerpo, AHORA).ok, true)
    assert.equal(verificarFirma(SECRETO, cab(vector, { timestamp: `${ts}.0` }), cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, cab(vector, { timestamp: 'NaN' }), cuerpo, AHORA).ok, false)
  })
  test('varias firmas en la cabecera (rotación de secreto): alcanza con una', () => {
    const otra = `v1,${randomBytes(32).toString('base64')}`
    assert.equal(verificarFirma(SECRETO, cab(`${otra} ${vector}`), cuerpo, AHORA).ok, true)
    assert.equal(verificarFirma(SECRETO, cab(`v1a,xyz ${otra} ${vector}`), cuerpo, AHORA).ok, true)
    assert.equal(verificarFirma(SECRETO, cab(`${otra} ${otra}`), cuerpo, AHORA).ok, false)
  })
  test('secreto sin el prefijo whsec_ funciona igual; secreto roto falla cerrado', () => {
    assert.equal(verificarFirma(SECRETO_B64, cab(vector), cuerpo, AHORA).ok, true)
    assert.equal(claveDeSecreto('whsec_'), null)
    assert.equal(claveDeSecreto('no es base64!'), null)
    assert.deepEqual(verificarFirma('whsec_', cab(vector), cuerpo, AHORA), { ok: false, motivo: 'secreto mal configurado' })
  })
  test('faltan cabeceras: rechazado', () => {
    assert.equal(verificarFirma(SECRETO, { id: null, timestamp: ts, firma: vector }, cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, { id: 'msg_abc', timestamp: null, firma: vector }, cuerpo, AHORA).ok, false)
    assert.equal(verificarFirma(SECRETO, { id: 'msg_abc', timestamp: ts, firma: null }, cuerpo, AHORA).ok, false)
  })
})

// ── Payload ──────────────────────────────────────────────────────────────────────────────────
describe('validarReunion', () => {
  test('solo acepta grabaciones de fathom.video (los links de Discord salen de ahí)', () => {
    assert.equal(validarReunion(reunion({ url: 'https://evil.example.com/calls/1' })).ok, false)
    assert.equal(validarReunion(reunion({ url: 'https://fathom.video.evil.com/x' })).ok, false)
    assert.equal(validarReunion(reunion({ url: 'https://app.fathom.video/calls/1' })).ok, true)
  })
  test('payload completo: válido y acotado', () => {
    const v = validarReunion(reunion())
    assert.equal(v.ok, true)
    assert.equal(v.reunion.recording_id, 123456789)
    assert.equal(v.reunion.transcript.length, 40)
    assert.equal(v.reunion.calendar_invitees[0].is_external, true)
  })
  test('recording_id no entero o no positivo, url no https: inválido', () => {
    for (const recording_id of ['123', 1.5, 0, -3, null, 2 ** 60]) assert.equal(validarReunion(reunion({ recording_id })).ok, false, String(recording_id))
    for (const url of ['http://fathom.video/calls/1', 'javascript:alert(1)', '', null]) assert.equal(validarReunion(reunion({ url })).ok, false, String(url))
    assert.equal(validarReunion('hola').ok, false)
    assert.equal(validarReunion([]).ok, false)
  })
  test('renglones malformados se descartan; strings largas se recortan; título de respaldo', () => {
    const t = [...renglones(3), { speaker: {}, text: 'sin ts', timestamp: '1:2' }, { text: 123, timestamp: '00:00:10' }, null]
    const v = validarReunion(reunion({ transcript: t, title: '', meeting_title: 'x'.repeat(500) }))
    assert.equal(v.reunion.transcript.length, 3)
    assert.equal(v.reunion.title.length, 300)
    assert.equal(validarReunion(reunion({ title: null, meeting_title: null })).reunion.title, 'Grabación 123456789')
  })
  test('si viene envuelto en { data } se desenvuelve', () => {
    assert.equal(validarReunion({ data: reunion() }).ok, true)
  })
})

// ── Transcripción, links y fechas ─────────────────────────────────────────────────────────────
describe('transcripción y links', () => {
  test('segundos y hora corta', () => {
    assert.equal(segundos('00:12:30'), 750)
    assert.equal(segundos('01:00:01'), 3601)
    assert.equal(segundos('12:30'), null)
    assert.equal(segundos('00:61:00'), null)
    assert.equal(horaCorta('00:12:30'), '12:30')
    assert.equal(horaCorta('01:02:03'), '1:02:03')
  })
  test('linkFathom: ?timestamp= o &timestamp= si ya hay query', () => {
    assert.equal(linkFathom('https://fathom.video/calls/1', '00:12:30'), 'https://fathom.video/calls/1?timestamp=750')
    assert.equal(linkFathom('https://fathom.video/share/x?tab=summary', '00:00:05'), 'https://fathom.video/share/x?tab=summary&timestamp=5')
  })
  test('junta renglones seguidos del mismo hablante con el timestamp del primero', () => {
    const tr = formatearTranscripcion(renglones(6))
    assert.equal(tr.texto, [
      '[00:00:00] Tomás Napolitano: frase número 0 frase número 1',
      '[00:01:00] Laura Pérez: frase número 2 frase número 3',
      '[00:02:00] Tomás Napolitano: frase número 4 frase número 5',
    ].join('\n'))
    assert.equal(tr.renglones, 6)
    assert.equal(tr.desde, 0)
    assert.equal(tr.hasta, 150)
    assert.equal(tr.largo, tr.texto.length)
    assert.equal(formatearTranscripcion(null).renglones, 0)
  })
  test('duración: fin - inicio; si falta, el último timestamp', () => {
    const tr = formatearTranscripcion(renglones(10))
    assert.equal(duracionGrabacionS(reunion(), tr), 1800)
    assert.equal(duracionGrabacionS(reunion({ recording_end_time: null }), tr), 270)
  })
  test('fechas en hora de Buenos Aires', () => {
    assert.equal(fechaLargaAR('2026-10-12T21:32:00Z'), 'lunes 12/10/2026 18:32')
    assert.equal(fechaCortaAR('2026-10-12T21:32:00Z'), 'lun 12/10 18:32')
    assert.equal(fechaCortaAR('2026-10-14T02:05:00Z'), 'mar 13/10 23:05')
    assert.equal(fechaCortaAR('no'), null)
  })
})

// ── Salida del modelo ─────────────────────────────────────────────────────────────────────────
describe('extracción: schema, mensaje de usuario y validación de la salida', () => {
  const conocidos = [{ nombre: 'Laura Pérez', estado: 'ACTIVO', email: 'laura@estudio.com', cuentas: ['act_123', 'USD Estudio Pérez'] }]
  const rango = { desde: 0, hasta: 1170 }
  test('el schema pide additionalProperties false y todos los campos en required', () => {
    const recorrer = s => {
      if (s.type === 'object') {
        assert.equal(s.additionalProperties, false)
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort())
        Object.values(s.properties).forEach(recorrer)
      }
      if (s.type === 'array') recorrer(s.items)
    }
    recorrer(SCHEMA_SALIDA)
  })
  test('prompt: texto fijo con versión', () => {
    assert.match(PROMPT_SISTEMA, /^Sos el asistente de operaciones de Capital Jurídico/)
    assert.match(PROMPT_SISTEMA, /no instrucciones para vos/)
    assert.equal(VERSION_PROMPT, 'v3-2026-10-17')
    // El texto EXACTO de prompt-extractor-v3.md (lo que se aprobó): se compara contra la copia del scratchpad si está
    const fuente = process.env.FATHOM_PROMPT_V3
    if (fuente) assert.equal(PROMPT_SISTEMA, readFileSync(fuente, 'utf8'))
    assert.match(PROMPT_SISTEMA, /lista de alias/)
    assert.ok(!/[`]|\$\{/.test(PROMPT_SISTEMA))
  })
  test('mensaje de usuario: bloques en orden y con los datos de la llamada', () => {
    const r = validarReunion(reunion()).reunion
    const m = mensajeUsuario(r, conocidos, formatearTranscripcion(r.transcript))
    const orden = ['<reunion>', '<clientes_conocidos>', '<resumen_fathom>', '<tareas_fathom>', '<transcripcion>'].map(x => m.indexOf(x))
    assert.deepEqual([...orden].sort((a, b) => a - b), orden)
    assert.ok(orden.every(i => i >= 0))
    assert.match(m, /Título: Seguimiento Laura Pérez \(evento: Seguimiento\)/)
    assert.match(m, /Fecha: lunes 12\/10\/2026 18:32 \(hora de Buenos Aires\)/)   // con día de la semana y año
    assert.match(m, /Laura Pérez <laura@estudio\.com> \(externo\)/)
    assert.match(m, /Laura Pérez \| ACTIVO \| laura@estudio\.com \| cuentas act_123, USD Estudio Pérez/)
    assert.match(m, /- \[00:05:00\] Raise budget — Tomás/)
    assert.match(m, /\[00:00:00\] Tomás Napolitano: frase número 0/)
    assert.match(mensajeUsuario({ ...r, default_summary: null, action_items: null }, [], formatearTranscripcion(r.transcript)), /\(no disponible\)[\s\S]*\(sin resumen\)[\s\S]*\(sin tareas\)/)
  })
  test('alias de la bóveda: dentro de <clientes_conocidos>, después de la lista', () => {
    const r = validarReunion(reunion()).reunion
    const alias = [{ escrito: ['Lau Peres', 'Laurita'], cliente: 'Laura Pérez' }, { escrito: ['  '], cliente: 'Nadie' }, { escrito: ['X\ny'], cliente: 'Otra' }]
    const m = mensajeUsuario(r, conocidos, formatearTranscripcion(r.transcript), alias)
    const bloque = m.slice(m.indexOf('<clientes_conocidos>'), m.indexOf('</clientes_conocidos>'))
    assert.match(bloque, /Laura Pérez \| ACTIVO[^\n]*\nAlias \(así lo escribió Fathom antes → cliente\):\nLau Peres \/ Laurita → Laura Pérez\nX y → Otra\n$/)
    assert.ok(!bloque.includes('Nadie'))
    assert.deepEqual(lineasAlias([]), [])
    assert.ok(!mensajeUsuario(r, conocidos, formatearTranscripcion(r.transcript)).includes('Alias'))
  })
  test('el alias solo ayuda a elegir: un cliente_crm que no está en el CRM sigue pasando a null', () => {
    const json = { tipo_reunion: 'cliente', resumen_corto: 'x', clientes: [clienteEx({ cliente_crm: 'Laurita' })] }
    assert.equal(validarSalida(json, rango, conocidos).extraccion.clientes[0].cliente_crm, null)
  })
  test('timestamp mal formado o fuera de la llamada: el cambio queda sin link', () => {
    const json = { tipo_reunion: 'cliente', resumen_corto: 'x', clientes: [clienteEx({ cambios: [cambio({ timestamp: '00:05:00' }), cambio({ timestamp: '5:00' }), cambio({ timestamp: '02:00:00' })] })] }
    const { extraccion: e, ajustes } = validarSalida(json, rango, conocidos)
    assert.deepEqual(e.clientes[0].cambios.map(c => c.timestamp), ['00:05:00', null, null])
    assert.equal(ajustes.length, 2)
  })
  test('cliente_crm y cuenta: solo si están en la lista (sin lista, nunca)', () => {
    const json = { tipo_reunion: 'cliente', resumen_corto: 'x', clientes: [clienteEx({ cliente_crm: 'laura perez', cuenta_publicitaria: 'usd estudio perez' }), clienteEx({ cliente_crm: 'Inventada García', cuenta_publicitaria: 'act_999' })] }
    const { extraccion: e } = validarSalida(json, rango, conocidos)
    assert.equal(e.clientes[0].cliente_crm, 'Laura Pérez')
    assert.equal(e.clientes[0].cuenta_publicitaria, 'USD Estudio Pérez')
    assert.equal(e.clientes[1].cliente_crm, null)
    assert.equal(e.clientes[1].cuenta_publicitaria, null)
    assert.equal(validarSalida(json, rango, []).extraccion.clientes[0].cliente_crm, null)
  })
  test('valores fuera del enum, textos largos y vacíos', () => {
    const json = { tipo_reunion: 'charla', resumen_corto: 'y'.repeat(500), clientes: [clienteEx({ cambios: [cambio({ tipo: 'bidding', certeza: 'quizas', detalle: 'z'.repeat(2000) }), cambio({ detalle: '   ' })], pendientes: ['', 'Esperar videos'] })] }
    const { extraccion: e } = validarSalida(json, rango, conocidos)
    assert.equal(e.tipo_reunion, 'otra')
    assert.equal(e.resumen_corto.length, 200)
    assert.equal(e.clientes[0].cambios.length, 1)
    assert.equal(e.clientes[0].cambios[0].tipo, 'otro')
    assert.equal(e.clientes[0].cambios[0].certeza, 'a_confirmar')
    assert.equal(e.clientes[0].cambios[0].detalle.length, 600)
    assert.deepEqual(e.clientes[0].pendientes, ['Esperar videos'])
    assert.throws(() => validarSalida([], rango, conocidos))
  })
})

describe('extraerCambios con un fetch falso (sin red: la "API" es un stream SSE armado acá)', () => {
  const r = validarReunion(reunion()).reunion
  const tr = formatearTranscripcion(r.transcript)
  const conocidos = [{ nombre: 'Laura Pérez', estado: 'ACTIVO', email: '', cuentas: ['act_123'] }]
  const salida = { tipo_reunion: 'cliente', resumen_corto: 'x', clientes: [clienteEx()] }
  const sse = (stop, texto, extra = {}) => {
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    return [
      ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 0 } } }),
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: texto } }),
      ev('content_block_stop', { index: 0 }),
      ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null, ...extra }, usage: { output_tokens: 70 } }),
      ev('message_stop', {}),
    ].join('')
  }
  const conApi = async (cuerpoSSE, fn) => {
    const original = globalThis.fetch
    const pedidos = []
    process.env.ANTHROPIC_API_KEY = 'sk-ant-de-prueba'
    globalThis.fetch = async (url, init) => {
      pedidos.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
      return new Response(cuerpoSSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    try { return await fn(pedidos) } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY }
  }
  test('pedido: Opus 5.5, thinking adaptativo, esfuerzo high, salida estructurada, fallback "default", streaming', async () => {
    await conApi(sse('end_turn', JSON.stringify(salida)), async pedidos => {
      const res = await extraerCambios({ reunion: r, transcripcion: tr, clientes: conocidos })
      assert.equal(res.extraccion.clientes[0].cliente_crm, 'Laura Pérez')
      assert.equal(res.modelo, 'claude-opus-5-5')
      assert.deepEqual(res.usage, { input_tokens: 900, output_tokens: 70 })
      const [p] = pedidos
      assert.equal(pedidos.length, 1)
      assert.match(p.url, /\/v1\/messages\?beta=true$/)
      assert.equal(p.headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01')
      assert.equal(p.body.model, 'claude-opus-5-5')
      assert.equal(p.body.max_tokens, 32000)
      assert.equal(p.body.stream, true)
      assert.equal(p.body.fallbacks, 'default')
      assert.deepEqual(p.body.thinking, { type: 'adaptive' })
      assert.equal(p.body.output_config.effort, 'high')
      assert.deepEqual(p.body.output_config.format, { type: 'json_schema', schema: JSON.parse(JSON.stringify(SCHEMA_SALIDA)) })
      assert.equal(p.body.system, PROMPT_SISTEMA)
      assert.ok(!('temperature' in p.body) && !('top_p' in p.body))
      assert.match(p.body.messages[0].content, /^<reunion>\n/)
    })
  })
  test('rechazo y max_tokens: error, nunca un resultado a medias; sin clave: error sin llamar', async () => {
    await conApi(sse('refusal', '', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }), () =>
      assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: [] }), /Claude rechazó la llamada \(categoría cyber\)/))
    await conApi(sse('max_tokens', '{"tipo_reunion":'), () =>
      assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: [] }), /max_tokens/))
    await conApi(sse('end_turn', 'no es json'), () =>
      assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: [] }), /JSON válido/))
    await assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: [] }), /falta ANTHROPIC_API_KEY/)
  })
  test('529 overloaded y 500: error transitorio (procesar.ts lo reintenta); 400: definitivo; el alias va en el pedido', async () => {
    const conEstado = async (status, fn) => {
      const original = globalThis.fetch
      process.env.ANTHROPIC_API_KEY = 'sk-ant-de-prueba'
      const pedidos = []
      globalThis.fetch = async (url, init) => {
        pedidos.push(JSON.parse(init.body))
        return new Response(JSON.stringify({ type: 'error', error: { type: status === 529 ? 'overloaded_error' : 'api_error', message: 'x' } }), { status, headers: { 'content-type': 'application/json' } })
      }
      try { return await fn(pedidos) } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY }
    }
    const alias = [{ escrito: ['Lau Peres'], cliente: 'Laura Pérez' }]
    await conEstado(529, async pedidos => {
      await assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: conocidos, alias }), e => e instanceof ErrorTransitorio && /529/.test(e.message))
      assert.equal(pedidos.length, 1, 'sin reintentos del SDK: el único reintento lo decide procesar.ts')
      assert.match(pedidos[0].messages[0].content, /Lau Peres → Laura Pérez/)
    })
    await conEstado(500, () => assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: [] }), e => e.transitorio === true))
    await conEstado(400, () => assert.rejects(extraerCambios({ reunion: r, transcripcion: tr, clientes: [] }), e => !e.transitorio && /400/.test(e.message)))
  })
})

describe('alias de nombres (bóveda → alias.json)', () => {
  test('aliasDesdeNota: separa comas fuera de paréntesis y respeta texto visible de la ficha', () => {
    const nota = [
      '## Alias conocidos (así los escribe mal Fathom)',
      '| Como aparece en transcripciones | Cliente real (CRM) | Ficha |',
      '| --- | --- | --- |',
      '| FicticioUno, Uno (caso, de prueba) | Cliente Ficticio Uno | |',
      '| FicticioDos | — | [[clientes/ficha-ficticia\\|Cliente Ficticio Dos]] |',
    ].join('\n')
    assert.deepEqual(aliasDesdeNota(nota), [
      { escrito: ['FicticioUno', 'Uno (caso, de prueba)'], cliente: 'Cliente Ficticio Uno' },
      { escrito: ['FicticioDos'], cliente: 'Cliente Ficticio Dos' },
    ])
    assert.throws(() => aliasDesdeNota('# nada'), /Alias conocidos/)
  })
  test('alias.json del árbol: forma { escrito[], cliente } sin datos de más', () => {
    const json = JSON.parse(readFileSync(new URL('../private-config.example/fathom-alias.json', import.meta.url), 'utf8'))
    assert.ok(json.length > 0)
    for (const a of json) {
      assert.deepEqual(Object.keys(a).sort(), ['cliente', 'escrito'])
      assert.ok(a.escrito.length && a.escrito.every(e => typeof e === 'string' && e.trim()))
      assert.ok(!/\[\[|\]\]|https?:/.test(JSON.stringify(a)), 'sin enlaces')
    }
    assert.deepEqual(aliasValidos(json), json)
    assert.deepEqual(aliasValidos([{ escrito: 'x', cliente: 'y' }, null, { escrito: ['', 3], cliente: 'z' }, { escrito: ['ok'], cliente: 'Z' }]), [{ escrito: ['ok'], cliente: 'Z' }])
  })
})

describe('contexto del CRM (parte pura)', () => {
  test('un cliente por nombre (gana el vigente), cuentas de AJUSTES y de "Cuentas Meta", vigentes primero', () => {
    const lista = armarClientesConocidos({
      clientes: [
        { nombre: 'Zoe Ruiz', estado: 'FINALIZADO', mail: '' },
        { nombre: 'Ana Gómez', estado: 'INACTIVO', mail: 'ana@viejo.com' },
        { nombre: 'Ana  Gómez', estado: 'ACTIVO', mail: '' },
        { nombre: 'Bruno Díaz', estado: 'PAUSADO', mail: 'b@x.com' },
        { nombre: '', estado: 'ACTIVO', mail: '' },
      ],
      cuentasMeta: [{ cuenta: 'USD Ana', actual: true, clienteCRM: 'ana gomez' }, { cuenta: 'act_9', actual: false, clienteCRM: 'Bruno Díaz' }],
      ajustes: { act_1: { cliente: 'Ana Gómez' }, act_2: {} },
    })
    assert.deepEqual(lista.map(c => c.nombre), ['Ana Gómez', 'Bruno Díaz', 'Zoe Ruiz'])
    assert.deepEqual(lista[0], { nombre: 'Ana Gómez', estado: 'ACTIVO', email: 'ana@viejo.com', cuentas: ['act_1', 'USD Ana'] })
    assert.deepEqual(lista[1].cuentas, [])
    assert.equal(lineasClientes([]), '(no disponible)')
    assert.equal(lineasClientes([{ nombre: 'A | B', estado: '', email: '', cuentas: [] }]), 'A B | sin estado | sin email | sin cuentas')
  })
})

// ── Mensajes de Discord ───────────────────────────────────────────────────────────────────────
describe('mensajes de Discord', () => {
  const r = validarReunion(reunion()).reunion
  test('formato: mención, título, cuenta, cambio con link al momento', () => {
    const [m] = armarMensajes(extraccion().extraccion, r, VALENTINO)
    assert.equal(m.partes.length, 1)
    assert.equal(m.partes[0], [
      `<@${VALENTINO}> 🎯 **Cambios de anuncios · Laura Pérez**`,
      '📞 Seguimiento Laura Pérez · lun 12/10 18:32 · [Fathom](<https://fathom.video/calls/123456789>)',
      '🧾 Cuenta: act\\_123',
      '',
      '💵 **Presupuesto:** Subí el presupuesto a USD 10 por día. [▶ 05:00](<https://fathom.video/calls/123456789?timestamp=300>)',
    ].join('\n'))
    assert.ok(!m.partes[0].includes('subilo a diez'), 'la cita no va en el mensaje')
  })
  test('nombre sin verificar, sin cuenta, sin Valentino: sin mención', () => {
    const ex = extraccion({ clientes: [clienteEx({ cliente_crm: null, nombre_escuchado: 'Lau Peres', cuenta_publicitaria: null })] }).extraccion
    const [m] = armarMensajes(ex, r, null)
    assert.match(m.partes[0], /^🎯 \*\*Cambios de anuncios · Lau Peres \(nombre sin verificar\)\*\*/)
    assert.ok(!m.partes[0].includes('Cuenta:'))
    assert.ok(!m.partes[0].includes('<@'))
  })
  test('orden: confirmados por momento de la llamada, después a confirmar, después pendientes; "cuando" si el detalle no lo dice', () => {
    const ex = extraccion({ clientes: [clienteEx({
      cambios: [
        cambio({ tipo: 'apagar', detalle: 'Pausá todo hasta el lunes.', timestamp: '00:10:00', certeza: 'a_confirmar' }),
        cambio({ tipo: 'ubicacion', detalle: 'Sumá Quilmes.', timestamp: '00:08:00', cuando: 'desde mañana' }),
        cambio({ tipo: 'rama', detalle: 'Pasá a Familia desde mañana.', timestamp: '00:02:00', cuando: 'desde mañana' }),
        cambio({ tipo: 'guion', detalle: 'Usá el guion 3.', timestamp: null }),
      ],
      pendientes: ['Esperar los videos nuevos del cliente.'],
    })] }).extraccion
    const cuerpo = armarMensajes(ex, r, VALENTINO)[0].partes[0].split('\n').slice(4)
    assert.deepEqual(cuerpo.map(l => l.split(' ')[0]), ['⚖️', '📍', '🎬', '❓', '⏳'])
    assert.ok(cuerpo[0].endsWith('[▶ 02:00](<https://fathom.video/calls/123456789?timestamp=120>)'))
    assert.ok(!cuerpo[0].includes('🗓️'), 'el detalle ya dice "desde mañana"')
    assert.match(cuerpo[1], /Sumá Quilmes\. · 🗓️ desde mañana \[▶ 08:00\]/)
    assert.equal(cuerpo[2], '🎬 **Guion:** Usá el guion 3.')
    assert.match(cuerpo[3], /^❓ \*\*A confirmar:\*\* ⏸️ \*\*Apagar:\*\* Pausá todo hasta el lunes\./)
    assert.equal(cuerpo[4], '⏳ **Pendiente:** Esperar los videos nuevos del cliente.')
  })
  test('un mensaje por cliente con algo; los que no tienen nada no van', () => {
    const ex = extraccion({ clientes: [clienteEx(), clienteEx({ cliente_crm: 'Otro', cambios: [], pendientes: [] }), clienteEx({ cliente_crm: 'Tercero', cambios: [], pendientes: ['Pedir accesos'] })] }).extraccion
    assert.deepEqual(armarMensajes(ex, r, VALENTINO).map(m => m.cliente), ['Laura Pérez', 'Tercero'])
  })
  test('escapa markdown y neutraliza menciones en lo que escribe el modelo', () => {
    assert.equal(escaparDiscord('**negrita** _x_ ~~y~~ `z` ||spoiler|| [link](http://a)'), '\\*\\*negrita\\*\\* \\_x\\_ \\~\\~y\\~\\~ \\`z\\` \\|\\|spoiler\\|\\| \\[link\\](http://a)')
    assert.equal(escaparDiscord('> cita'), '\\> cita')
    assert.equal(escaparDiscord('a > b'), 'a > b')
    assert.equal(escaparDiscord('dos\nrenglones'), 'dos renglones')
    assert.equal(sinMenciones('@everyone y @here'), '@​everyone y @​here')
    const ex = extraccion({ clientes: [clienteEx({ cliente_crm: '@everyone', cambios: [cambio({ detalle: 'Avisale a <@222222222222222222> y <@&333> y @here' })] })] }).extraccion
    const texto = armarMensajes(ex, r, VALENTINO)[0].partes.join('\n')
    assert.equal((texto.match(/<@\d/g) ?? []).length, 1, 'la única mención real es la de Valentino')
    assert.ok(texto.startsWith(`<@${VALENTINO}>`))
    assert.ok(!/@everyone|@here|<@&/.test(texto))
  })
  test('más de 2000 caracteres: se parte por renglones y solo el primero menciona', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => cambio({ detalle: `Cambio ${i} ${'x'.repeat(400)}`, timestamp: hms(60 + i) }))
    const [m] = armarMensajes(extraccion({ clientes: [clienteEx({ cambios: muchos })] }).extraccion, r, VALENTINO)
    assert.ok(m.partes.length >= 3)
    for (const p of m.partes) assert.ok(p.length <= MAX_DISCORD, `parte de ${p.length}`)
    assert.ok(m.partes[0].startsWith(`<@${VALENTINO}>`))
    for (const p of m.partes.slice(1)) { assert.ok(!p.includes('<@')); assert.match(p, /^🎯 \*\*Laura Pérez\*\* \(sigue\)/) }
    const todos = m.partes.join('\n')
    for (let i = 0; i < 12; i++) assert.ok(todos.includes(`Cambio ${i} `), `falta el cambio ${i}`)
    assert.deepEqual(partir('cab', ['a', 'b'], 'sigue'), ['cab\na\nb'])
  })
  test('aviso de error: menciona a Tomás, sin URLs ni claves, y dice la verdad sobre el reintento', () => {
    const auto = { tipo: 'automatico', cuando: 'mañana' }
    const t = textoAviso('Llamada **x**', 5, motivoDe(new Error('falló https://discord.com/api/webhooks/1/secreto con sk-ant-api03-abc')), ID_TOMAS, auto)
    assert.ok(t.startsWith(`<@${ID_TOMAS}> ⚠️ No pude sacar los cambios de anuncios de «Llamada \\*\\*x\\*\\*» (grabación 5): falló \\[url\\] con \\[clave\\].`))
    assert.ok(!t.includes('discord.com') && !t.includes('sk-ant'))
    assert.ok(t.endsWith('Se reintenta sola mañana entre las 8 y las 9 (o si Fathom la reenvía). Si es urgente, pedile a Claude que reintente la grabación 5.'))
    assert.ok(!/forzar|payload|reenvi(á|ar) el/i.test(t), 'nada de "reenviar el payload"')
    assert.match(textoAviso('x', 5, 'm', ID_TOMAS, { tipo: 'sin_mas', intentos: 4 }), /Ya van 4 intentos: no se reintenta más sola\. Pedile a Claude que reintente la grabación 5\./)
    assert.match(textoAviso('x', 5, 'm', ID_TOMAS, { tipo: 'sin_registro' }), /no se reintenta sola/)
  })
  test('reintentoDe: según intentos y la hora de Buenos Aires', () => {
    assert.deepEqual(reintentoDe(null, AHORA), { tipo: 'sin_registro' })
    assert.deepEqual(reintentoDe({ intentos: TOPE_INTENTOS_CRON }, AHORA), { tipo: 'sin_mas', intentos: TOPE_INTENTOS_CRON })
    assert.deepEqual(reintentoDe({ intentos: 1 }, Date.parse('2026-10-12T22:10:00Z')), { tipo: 'automatico', cuando: 'mañana' })   // 19:10 AR
    assert.deepEqual(reintentoDe({ intentos: 1 }, Date.parse('2026-10-13T05:00:00Z')), { tipo: 'automatico', cuando: 'hoy' })     // 2:00 AR
  })
  test('sin transcripción: aviso con el paso a paso de Fathom', () => {
    assert.match(textoSinTranscripcion('x', 9, ID_TOMAS), /el webhook de Fathom llega sin transcripción: en Fathom → Settings → API Access → el webhook, activá Transcript\./)
  })
  test('clavesUnicas: estables, normalizadas y sin repetir', () => {
    const cs = [clienteEx(), clienteEx({ cliente_crm: null, nombre_escuchado: 'Lau Peres!' }), clienteEx({ cambios: [], pendientes: [] }), clienteEx({ cliente_crm: 'LAURA PÉREZ' })]
    assert.deepEqual(clavesUnicas(cs), ['laura perez', 'lau peres', 'laura perez#2'])
  })
})

// ── Envío a Discord (fetch falso) ─────────────────────────────────────────────────────────────
describe('envío a Discord', () => {
  const WEBHOOK = 'https://discord.com/api/webhooks/1/SECRETO-NO-LOGUEAR'
  const respuesta = (status, cuerpo = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
  test('?wait=true, flags 4, allowed_mentions solo de los usuarios pedidos, en orden y con pausa', async () => {
    const pedidos = [], esperas = []
    const ids = await enviarDiscord(WEBHOOK, ['uno', 'dos'], [VALENTINO], {
      fetch: async (url, init) => { pedidos.push({ url, cuerpo: JSON.parse(init.body) }); return respuesta(200, { id: `id${pedidos.length}` }) },
      esperar: async ms => { esperas.push(ms) },
    })
    assert.deepEqual(ids, ['id1', 'id2'])
    assert.equal(pedidos[0].url, `${WEBHOOK}?wait=true`)
    assert.deepEqual(pedidos[0].cuerpo, { content: 'uno', flags: 4, allowed_mentions: { parse: [], users: [VALENTINO] } })
    assert.equal(pedidos[1].cuerpo.content, 'dos')
    assert.deepEqual(esperas, [400])
  })
  test('429: espera retry_after y reintenta una vez', async () => {
    let n = 0; const esperas = []
    const ids = await enviarDiscord(`${WEBHOOK}?thread_id=9`, ['uno'], [], {
      fetch: async url => { n++; assert.equal(url, `${WEBHOOK}?thread_id=9&wait=true`); return n === 1 ? respuesta(429, { retry_after: 1.5 }) : respuesta(200, { id: 'ok' }) },
      esperar: async ms => { esperas.push(ms) },
    })
    assert.deepEqual(ids, ['ok'])
    assert.deepEqual(esperas, [1500])
    await assert.rejects(enviarDiscord(WEBHOOK, ['x'], [], { fetch: async () => respuesta(429, { retry_after: 1 }), esperar: async () => {} }), /429/)
  })
  test('error a mitad: lleva los ids enviados y nunca la URL del webhook', async () => {
    let n = 0
    const p = enviarDiscord(WEBHOOK, ['a', 'b', 'c'], [], {
      fetch: async () => (++n === 2 ? new Response(`bad ${WEBHOOK}`, { status: 400 }) : respuesta(200, { id: `i${n}` })),
      esperar: async () => {},
    })
    await assert.rejects(p, e => e instanceof ErrorEnvio && e.enviados.join() === 'i1' && !e.message.includes('SECRETO') && /400/.test(e.message))
    await assert.rejects(enviarDiscord(WEBHOOK, ['a'], [], { fetch: async () => { throw new Error(`fetch failed ${WEBHOOK}`) } }), e => !e.message.includes('SECRETO'))
  })
  test('timeout de cada pedido: Discord colgado → error transitorio con los ids que sí salieron', async () => {
    let n = 0
    const colgado = (url, init) => new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(init.signal.reason)))
    const p = enviarDiscord(WEBHOOK, ['a', 'b'], [], {
      fetch: async (url, init) => (++n === 1 ? respuesta(200, { id: 'i1' }) : colgado(url, init)),
      esperar: async () => {}, timeoutMs: 30,
    })
    await assert.rejects(p, e => e instanceof ErrorEnvio && e.transitorio === true && e.enviados.join() === 'i1' && /no respondió/.test(e.message))
  })
  test('deadline: el timeout de cada pedido se recorta a lo que queda, y vencido no se manda nada', async () => {
    let t = 1_000, tope = null
    const ids = await enviarDiscord(WEBHOOK, ['a'], [], {
      fetch: async (url, init) => { tope = init.signal; return respuesta(200, { id: 'ok' }) },
      ahora: () => t, deadline: 1_000 + 5_000,
    })
    assert.deepEqual(ids, ['ok'])
    assert.ok(tope instanceof AbortSignal)
    let pedidos = 0
    await assert.rejects(
      enviarDiscord(WEBHOOK, ['a'], [], { fetch: async () => { pedidos++; return respuesta(200, { id: 'x' }) }, ahora: () => t, deadline: t - 1 }),
      e => e instanceof ErrorEnvio && e.transitorio && /se acabó el tiempo/.test(e.message))
    assert.equal(pedidos, 0)
  })
  test('429 con retry_after largo: lo espera COMPLETO si entra en el deadline; si no, corta sin esperar', async () => {
    let t = 0, n = 0
    const esperas = []
    const op = deadline => ({
      fetch: async () => (++n % 2 === 1 ? respuesta(429, { retry_after: 30 }) : respuesta(200, { id: `ok${n}` })),
      esperar: async ms => { esperas.push(ms); t += ms }, ahora: () => t, deadline,
    })
    assert.deepEqual(await enviarDiscord(WEBHOOK, ['a'], [], op(60_000)), ['ok2'])
    assert.deepEqual(esperas, [30_000], 'sin deadline se recortaría a 10 s; con deadline se respeta entero')
    n = 0; t = 0; esperas.length = 0
    await assert.rejects(enviarDiscord(WEBHOOK, ['a'], [], op(20_000)), e => e instanceof ErrorEnvio && e.transitorio && /429/.test(e.message))
    assert.deepEqual(esperas, [])
  })
  test('5xx: 2 reintentos con espera de 1 s y 3 s; al tercero, error transitorio', async () => {
    const esperas = []
    let n = 0
    const ids = await enviarDiscord(WEBHOOK, ['a'], [], {
      fetch: async () => (++n <= 2 ? new Response('caído', { status: n === 1 ? 500 : 502 }) : respuesta(200, { id: 'ok' })),
      esperar: async ms => { esperas.push(ms) },
    })
    assert.deepEqual(ids, ['ok'])
    assert.deepEqual(esperas, [1_000, 3_000])
    n = 0
    await assert.rejects(enviarDiscord(WEBHOOK, ['a'], [], { fetch: async () => { n++; return new Response('', { status: 503 }) }, esperar: async () => {} }),
      e => e instanceof ErrorEnvio && e.transitorio === true && /503/.test(e.message))
    assert.equal(n, 3)
  })
  test('400: error definitivo (no se reintenta)', async () => {
    await assert.rejects(enviarDiscord(WEBHOOK, ['a'], [], { fetch: async () => new Response('{}', { status: 400 }) }), e => e instanceof ErrorEnvio && e.transitorio === false)
  })
  test('idDiscord: solo snowflakes', () => {
    assert.equal(idDiscord(` ${VALENTINO} `), VALENTINO)
    for (const x of ['', 'valentino', '<@1>', '123', undefined, null]) assert.equal(idDiscord(x), null)
  })
})

// ── Orquestador con fakes ─────────────────────────────────────────────────────────────────────
describe('procesarReunion', () => {
  let f
  beforeEach(() => { f = fakes() })

  test('enviado: reclama (con el payload), lee el CRM, extrae, guarda ANTES de mandar, manda y registra', async () => {
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.reclamar.length, 1)
    const [id, op, datos] = f.log.reclamar[0]
    assert.equal(id, 123456789)
    assert.deepEqual(op, { forzar: false, topeIntentos: undefined })
    assert.equal(datos.titulo, 'Seguimiento Laura Pérez')
    assert.equal(datos.url, 'https://fathom.video/calls/123456789')
    assert.equal(datos.payload.recording_id, 123456789)
    assert.equal(datos.payload.transcript.length, 40, 'el payload (la reunión validada) se guarda para poder reintentar')
    assert.equal(f.log.contexto, 1)
    assert.equal(f.log.extraer[0].clientes[0].nombre, 'Laura Pérez')
    assert.deepEqual(f.log.extraer[0].alias, [])
    // la extracción se guarda antes del primer envío
    assert.equal(f.log.guardar.length, 1)
    assert.equal(f.log.guardar[0].version_prompt, 'v3-2026-10-17')
    assert.equal(f.log.guardar[0].resultado.clientes[0].cambios[0].cita, 'subilo a diez dólares')
    assert.equal(f.log.enviar.length, 1)
    assert.ok(f.log.enviar[0][0].startsWith(`<@${VALENTINO}>`))
    assert.deepEqual(f.log.anotar, [{ id: 123456789, clientes: ['laura perez'], mensajes: ['msg1'] }])
    const m = f.log.marcar.at(-1)
    assert.equal(m.estado, 'enviado')
    assert.deepEqual(m.mensajes, ['msg1'])
    assert.deepEqual(m.clientes_enviados, ['laura perez'])
    assert.equal(m.clientes, 1); assert.equal(m.cambios, 1)
    assert.equal(m.tokens_in, 12000); assert.equal(m.tokens_out, 800)
    assert.equal(m.version_prompt, 'v3-2026-10-17')
    assert.equal(m.resultado.contexto, 'ok')
    assert.ok(!JSON.stringify(m).includes('frase número'), 'la transcripción no va en el registro final')
    assert.ok(m.duracion_ms > 0)
    assert.equal(r.reutilizado, false)
    assert.equal(f.log.avisar.length, 0)
  })
  test('duplicada: si no se pudo reclamar no hace nada más', async () => {
    f = fakes({ reclamar: async () => null })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'duplicada')
    assert.equal(f.log.extraer.length + f.log.enviar.length + f.log.marcar.length + f.log.avisar.length + f.log.contexto, 0)
  })
  test('forzar y el tope de intentos se le pasan a reclamar', async () => {
    await procesarReunion(reunion(), f.deps, { forzar: true })
    assert.deepEqual(f.log.reclamar[0][1], { forzar: true, topeIntentos: undefined })
    await procesarReunion(reunion(), f.deps, { topeIntentos: 4 })
    assert.deepEqual(f.log.reclamar[1][1], { forzar: false, topeIntentos: 4 })
  })
  test('omitida: transcripción corta (menos de 6 renglones) o menos de 3 minutos, sin llamar a Claude', async () => {
    const r1 = await procesarReunion(reunion({ transcript: renglones(5) }), f.deps)
    assert.equal(r1.estado, 'omitida'); assert.match(r1.motivo, /5 renglones/)
    const r2 = await procesarReunion(reunion({ recording_end_time: '2026-10-12T21:34:00Z' }), f.deps)
    assert.equal(r2.estado, 'omitida'); assert.match(r2.motivo, /120 s/)
    const r3 = await procesarReunion(reunion({ transcript: [] }), f.deps)
    assert.equal(r3.estado, 'omitida', 'presente pero vacía = corta')
    assert.equal(f.log.extraer.length + f.log.enviar.length + f.log.contexto + f.log.avisar.length, 0)
    assert.deepEqual(f.log.marcar.map(m => m.estado), ['omitida', 'omitida', 'omitida'])
  })
  test('transcripción AUSENTE (null) ≠ llamada corta: error con aviso a Tomás de activar Transcript, una sola vez', async () => {
    const r = await procesarReunion(reunion({ transcript: null }), f.deps)
    assert.equal(r.estado, 'error')
    assert.ok(r.motivo.startsWith(PREFIJO_SIN_TRANSCRIPCION))
    assert.equal(f.log.marcar.at(-1).estado, 'error')
    assert.ok(f.log.marcar.at(-1).error.startsWith(PREFIJO_SIN_TRANSCRIPCION))
    assert.equal(f.log.avisar.length, 1)
    assert.match(f.log.avisar[0], /en Fathom → Settings → API Access → el webhook, activá Transcript/)
    assert.equal(f.log.extraer.length + f.log.contexto + f.log.enviar.length, 0)
    // Fathom la reenvía igual de sin transcripción: la fila ya tiene ese error → no se repite el aviso
    f = fakes({ reclamar: async () => reclamoNuevo({ intentos: 2, error_previo: `${PREFIJO_SIN_TRANSCRIPCION} el webhook…` }) })
    assert.equal((await procesarReunion(reunion({ transcript: null }), f.deps)).estado, 'error')
    assert.equal(f.log.avisar.length, 0)
    // y si falta el campo directamente, igual
    const sinCampo = reunion()
    delete sinCampo.transcript
    f = fakes()
    assert.equal((await procesarReunion(sinCampo, f.deps)).estado, 'error')
    assert.equal(f.log.avisar.length, 1)
  })
  test('sin_cambios: ningún cliente con cambios ni pendientes → no se manda nada', async () => {
    f = fakes({ extraer: async () => extraccion({ clientes: [clienteEx({ cambios: [], pendientes: [] })] }) })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'sin_cambios')
    assert.equal(f.log.enviar.length, 0)
    assert.equal(f.log.marcar.at(-1).estado, 'sin_cambios')
  })
  test('venta: aunque el modelo devuelva clientes, no se manda nada', async () => {
    f = fakes({ extraer: async () => extraccion({ tipo_reunion: 'venta' }) })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'sin_cambios')
    assert.equal(f.log.enviar.length, 0)
  })
  test('error definitivo → registro en error, sin reintento, y UN aviso a Tomás que dice cuándo se reintenta', async () => {
    f = fakes({ extraer: async () => { throw new Error('falta ANTHROPIC_API_KEY') } })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'error'); assert.equal(r.motivo, 'falta ANTHROPIC_API_KEY')
    assert.equal(f.log.marcar.at(-1).estado, 'error')
    assert.equal(f.log.marcar.at(-1).error, 'falta ANTHROPIC_API_KEY')
    assert.deepEqual(f.log.esperas, [], 'un error definitivo no se reintenta')
    assert.equal(f.log.avisar.length, 1)
    assert.ok(f.log.avisar[0].startsWith(`<@${ID_TOMAS}> ⚠️`))
    assert.match(f.log.avisar[0], /falta ANTHROPIC\\_API\\_KEY/)
    assert.match(f.log.avisar[0], /Se reintenta sola mañana entre las 8 y las 9 \(o si Fathom la reenvía\)\. Si es urgente, pedile a Claude que reintente la grabación 123456789\./)
    assert.equal(f.log.enviar.length, 0)
  })
  test('error transitorio de Claude: espera y reintenta UNA vez el paso (sin volver a leer el CRM)', async () => {
    let n = 0
    f = fakes({ extraer: async (e, tope) => { f.log.extraer.push({ ...e, tope }); if (++n === 1) throw new ErrorTransitorio('Claude respondió 529 (overloaded_error)'); return extraccion() } })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.extraer.length, 2)
    assert.equal(f.log.contexto, 1)
    assert.deepEqual(f.log.esperas.filter(ms => ms === ESPERA_REINTENTO_MS), [ESPERA_REINTENTO_MS])
    // si vuelve a fallar: error y aviso (no un tercer intento)
    f = fakes({ extraer: async () => { throw new ErrorTransitorio('Claude respondió 500') } })
    const r2 = await procesarReunion(reunion(), f.deps)
    assert.equal(r2.estado, 'error')
    assert.equal(f.log.esperas.length, 1)
    assert.equal(f.log.avisar.length, 1)
  })
  test('deadline: Claude recibe deadline − ahora − 30 s; sin tiempo suficiente ni se lo llama', async () => {
    await procesarReunion(reunion(), f.deps)
    const tope = f.log.extraer[0].tope
    assert.ok(tope <= PLAZO_MS - MARGEN_ENVIO_MS && tope > PLAZO_MS - MARGEN_ENVIO_MS - 100, `tope ${tope}`)
    assert.ok(f.log.deadline > AHORA && f.log.deadline <= AHORA + PLAZO_MS + 5, 'Discord recibe el mismo deadline')
    f = fakes()
    const r = await procesarReunion(reunion(), f.deps, { deadline: AHORA + 50_000 })
    assert.equal(r.estado, 'error'); assert.match(r.motivo, /no queda tiempo para llamar a Claude/)
    assert.equal(f.log.extraer.length, 0)
    assert.deepEqual(f.log.esperas, [], 'sin tiempo tampoco se espera para reintentar')
  })
  test('error de la base al reclamar: igual avisa (no hay fila que marcar) y dice que no se reintenta sola', async () => {
    f = fakes({ reclamar: async () => { throw new Error('falta DATABASE_URL') } })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'error')
    assert.equal(f.log.marcar.length, 0)
    assert.equal(f.log.avisar.length, 1)
    assert.match(f.log.avisar[0], /no se reintenta sola/)
    assert.equal(f.log.extraer.length, 0)
  })
  test('Neon que no responde (transitorio) al reclamar: un reintento y sigue', async () => {
    let n = 0
    f = fakes({ reclamar: async () => { if (++n === 1) throw new ErrorTransitorio('la base no respondió en 10 s (reclamar)'); return reclamoNuevo() } })
    assert.equal((await procesarReunion(reunion(), f.deps)).estado, 'enviado')
    assert.equal(n, 2)
  })
  test('sin webhook de Discord: error antes de gastar en Claude', async () => {
    f = fakes({ discordListo: false })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'error'); assert.match(r.motivo, /DISCORD_WEBHOOK/)
    assert.equal(f.log.extraer.length, 0)
  })
  test('si no se puede guardar la extracción, no se manda nada (un reintento duplicaría)', async () => {
    f = fakes({ guardarExtraccion: async () => { throw new Error('Neon: permiso denegado') } })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'error')
    assert.equal(f.log.enviar.length, 0)
  })
  test('envío cortado a mitad (definitivo): error con los ids que sí salieron; si falla el aviso, no rompe', async () => {
    f = fakes({
      enviar: async () => { throw new ErrorEnvio('Discord respondió 400', ['msg1']) },
      avisar: async () => { throw new Error('Discord caído') },
    })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'error')
    assert.deepEqual(r.ids, ['msg1'])
    assert.deepEqual(f.log.marcar.at(-1).mensajes, ['msg1'])
    assert.deepEqual(f.log.marcar.at(-1).clientes_enviados, [], 'el cliente no salió entero: no se anota')
  })
  test('envío cortado a mitad (transitorio): reintenta desde la parte que faltaba, sin repetir la que salió', async () => {
    const muchos = Array.from({ length: 12 }, (_, i) => cambio({ detalle: `Cambio ${i} ${'x'.repeat(400)}`, timestamp: hms(60 + i) }))
    let n = 0
    const lotes = []
    f = fakes({
      extraer: async () => extraccion({ clientes: [clienteEx({ cambios: muchos })] }),
      enviar: async m => { lotes.push(m.length); if (++n === 1) throw new ErrorEnvio('Discord no respondió en 15 s', ['p1'], true); return m.map((_, i) => `p${i + 2}`) },
    })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.ok(lotes[0] >= 3 && lotes[1] === lotes[0] - 1, `lotes ${lotes}`)
    assert.equal(r.ids[0], 'p1')
    assert.equal(r.ids.length, lotes[0])
  })
  test('el CRM que falla no frena: sigue con lista vacía y queda "sin_crm"', async () => {
    f = fakes({ contexto: async () => { throw new Error('Sheets 429') } })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.extraer[0].clientes.length, 0)
    assert.equal(f.log.marcar.at(-1).resultado.contexto, 'sin_crm')
  })
  test('si falla solo el registro final, los mensajes ya salieron y quedaron anotados: enviado y sin aviso', async () => {
    f = fakes({ marcar: async () => { throw new Error('Neon caído') } })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.anotar.length, 1)
    assert.equal(f.log.avisar.length, 0)
  })
  test('dry: no toca la base ni Discord y devuelve los mensajes y el resultado', async () => {
    const r = await procesarReunion(reunion(), f.deps, { dry: true })
    assert.equal(r.estado, 'dry')
    assert.equal(r.mensajes.length, 1)
    assert.ok(r.mensajes[0].includes('Presupuesto'))
    assert.equal(r.resultado.clientes.length, 1)
    assert.equal(f.log.reclamar.length + f.log.guardar.length + f.log.anotar.length + f.log.marcar.length + f.log.enviar.length + f.log.avisar.length, 0)
    f = fakes({ extraer: async () => { throw new Error('x') } })
    assert.equal((await procesarReunion(reunion(), f.deps, { dry: true })).estado, 'error')
    assert.equal(f.log.avisar.length + f.log.marcar.length, 0)
    f = fakes()
    assert.equal((await procesarReunion(reunion({ transcript: renglones(2) }), f.deps, { dry: true })).estado, 'omitida')
    assert.equal(f.log.marcar.length, 0)
  })
  test('payload inválido: no hace nada', async () => {
    const r = await procesarReunion({ recording_id: 'x' }, f.deps)
    assert.equal(r.estado, 'invalida')
    assert.equal(f.log.reclamar.length, 0)
  })
  test('el payload guardado (la reunión ya validada) se puede volver a validar igual', () => {
    const v = validarReunion(reunion()).reunion
    assert.deepEqual(validarReunion(JSON.parse(JSON.stringify(v))).reunion, v)
  })
})

describe('retomar sin duplicar (reintentos)', () => {
  const dosClientes = () => extraccion({ clientes: [clienteEx(), clienteEx({ cliente_crm: null, nombre_escuchado: 'Juan Gómez', cuenta_publicitaria: null, cambios: [cambio({ tipo: 'rama', detalle: 'Pasá a Laboral.' })] })] })
  /** Lo que habría quedado en la fila después de un intento que extrajo y mandó solo al primer cliente. */
  const filaAMedias = (over = {}) => {
    const ex = dosClientes().extraccion
    return reclamoNuevo({
      intentos: 2, error_previo: 'Discord respondió 503',
      resultado: { ...ex, ajustes: [], contexto: 'ok', renglones: 40, largo: 999 },
      version_prompt: 'v3-2026-10-17', modelo: 'claude-opus-5-5', tokens_in: 12000, tokens_out: 800,
      clientes_enviados: ['laura perez'], mensajes: ['viejo1'], ...over,
    })
  }

  test('reusa la extracción guardada (misma versión del prompt) y manda SOLO los clientes que faltaban', async () => {
    const f = fakes({ reclamar: async () => filaAMedias() })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.reutilizado, true)
    assert.equal(f.log.extraer.length + f.log.contexto + f.log.guardar.length, 0, 'no se vuelve a pagar Claude ni a leer el CRM')
    assert.equal(f.log.enviar.length, 1)
    assert.match(f.log.enviar[0][0], /Juan Gómez \(nombre sin verificar\)/)
    assert.ok(!f.log.enviar.flat().some(t => t.includes('Laura Pérez**')), 'Laura ya había salido')
    const m = f.log.marcar.at(-1)
    assert.equal(m.estado, 'enviado')
    assert.deepEqual(m.mensajes, ['viejo1', 'msg1'])
    assert.deepEqual(m.clientes_enviados, ['laura perez', 'juan gomez'])
    assert.equal(m.clientes, 2)
    assert.ok(!('resultado' in m) || m.resultado === undefined, 'el resultado guardado no se pisa')
    assert.deepEqual(r.usage, { input_tokens: 12000, output_tokens: 800 })
  })
  test('todos ya mandados (se cortó antes del registro final): no manda nada y queda enviado', async () => {
    const f = fakes({ reclamar: async () => filaAMedias({ clientes_enviados: ['laura perez', 'juan gomez'], mensajes: ['v1', 'v2'] }) })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.enviar.length, 0)
    assert.deepEqual(f.log.marcar.at(-1).mensajes, ['v1', 'v2'])
  })
  test('otra versión del prompt o un resultado con otra forma: se vuelve a extraer', async () => {
    let f = fakes({ reclamar: async () => filaAMedias({ version_prompt: 'v1-2026-10-13' }), extraer: async () => dosClientes() })
    let r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.reutilizado, false)
    assert.equal(f.log.contexto, 1)
    assert.equal(f.log.guardar.length, 1)
    assert.equal(f.log.enviar.length, 1, 'igual no repite a Laura (la clave es la misma)')
    f = fakes({ reclamar: async () => filaAMedias({ resultado: { tipo_reunion: 'cliente', clientes: 'roto' } }) })
    r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.reutilizado, false)
  })
  test('forzar: re-extrae y manda TODO de nuevo (duplica a propósito)', async () => {
    // reclamar() con forzar ya devuelve la fila sin resultado ni clientes_enviados (registro.ts), pero aunque viniera
    // con ellos, procesar no reusa nada
    const f = fakes({ reclamar: async () => filaAMedias(), extraer: async () => dosClientes() })
    const r = await procesarReunion(reunion(), f.deps, { forzar: true })
    assert.equal(r.reutilizado, false)
    assert.equal(f.log.contexto, 1)
    assert.equal(f.log.enviar.length, 1, 'Laura sigue anotada en esta fila falsa')
  })
  test('un cliente anotado recién cuando salió entero: si se corta en el segundo, el reintento manda solo el segundo', async () => {
    let n = 0
    const f = fakes({
      extraer: async () => dosClientes(),
      enviar: async m => { if (++n === 2) throw new ErrorEnvio('Discord respondió 400', []); return m.map(() => `id${n}`) },
    })
    const r = await procesarReunion(reunion(), f.deps)
    assert.equal(r.estado, 'error')
    assert.deepEqual(f.log.anotar, [{ id: 123456789, clientes: ['laura perez'], mensajes: ['id1'] }])
    assert.deepEqual(f.log.marcar.at(-1).clientes_enviados, ['laura perez'])
    assert.equal(f.log.guardar.length, 1, 'la extracción quedó guardada para el reintento')
  })
})

describe('cron de reintentos (reintentarPendientes) con filas falsas', () => {
  const fila = (over = {}) => ({ recording_id: 1, estado: 'error', titulo: 'Llamada', intentos: 1, error: 'Claude respondió 529', tiene_payload: true, ...over })
  function cron(filas, over = {}) {
    const f = fakes(over)
    const log = { pendientes: [], leer: [], sinPayload: [] }
    const marcadas = new Set()
    f.deps.pendientes = async (...a) => { log.pendientes.push(a); return filas }
    f.deps.leerPayload = async id => { log.leer.push(id); return { payload: reunion({ recording_id: id, url: `https://fathom.video/calls/${id}` }), estado: 'error', intentos: 1 } }
    f.deps.marcarSinPayload = async (id, error) => { log.sinPayload.push({ id, error }); if (marcadas.has(id)) return false; marcadas.add(id); return true }
    log.agotadas = []
    f.deps.marcarAgotada = async (id, error) => { log.agotadas.push({ id, error }); if (marcadas.has(`a${id}`)) return false; marcadas.add(`a${id}`); return true }
    return { ...f, cronLog: log, marcadas }
  }

  test('una colgada que ya llegó al tope se cierra con un solo aviso y no se reprocesa', async () => {
    const c = cron([fila({ recording_id: 33, estado: 'procesando', intentos: 4, error: null, titulo: 'Trabada' })])
    const r = await reintentarPendientes(c.deps)
    assert.deepEqual(r.procesadas, [{ recording_id: 33, estado: 'error', motivo: 'agotada' }])
    assert.equal(c.cronLog.agotadas.length, 1)
    assert.match(c.cronLog.agotadas[0].error, /^agotada:/)
    assert.deepEqual(c.cronLog.leer, [])
    assert.equal(c.log.avisar.length, 1)
    assert.match(c.log.avisar[0], /«Trabada» \(33\) se cortó 4 veces/)
    await reintentarPendientes(c.deps)
    assert.equal(c.log.avisar.length, 1, 'el segundo cron no repite el aviso')
  })

  test('pide hasta 5 filas con intentos < 4, sin las de sin_payload ni sin_transcripcion', async () => {
    const c = cron([])
    const r = await reintentarPendientes(c.deps)
    assert.deepEqual(r, { revisadas: 0, procesadas: [] })
    assert.deepEqual(c.cronLog.pendientes, [[5, 4, [PREFIJO_SIN_PAYLOAD, PREFIJO_SIN_TRANSCRIPCION, PREFIJO_AGOTADA]]])
  })
  test('en serie: la de error se retoma con el payload guardado y el tope de intentos; la colgada además avisa', async () => {
    const c = cron([fila({ recording_id: 11 }), fila({ recording_id: 22, estado: 'procesando', error: null, titulo: 'Colgada' })])
    const r = await reintentarPendientes(c.deps)
    assert.deepEqual(r.procesadas.map(p => [p.recording_id, p.estado]), [[11, 'enviado'], [22, 'enviado']])
    assert.deepEqual(c.cronLog.leer, [11, 22])
    assert.deepEqual(c.log.reclamar.map(x => [x[0], x[1].topeIntentos, x[1].forzar]), [[11, 4, false], [22, 4, false]])
    assert.equal(c.log.avisar.length, 1)
    assert.match(c.log.avisar[0], /«Colgada» \(22\) había quedado a medias \(la función se cortó\) y la reintenté: mandé lo que faltaba \(1 mensaje para Valentino\)/)
  })
  test('sin payload: se marca con el prefijo y se avisa a Tomás UNA vez (la segunda pasada ya no avisa)', async () => {
    const c = cron([fila({ recording_id: 33, tiene_payload: false, error: 'Discord respondió 500' })])
    await reintentarPendientes(c.deps)
    await reintentarPendientes(c.deps)
    assert.equal(c.cronLog.sinPayload.length, 2)
    assert.ok(c.cronLog.sinPayload[0].error.startsWith(`${PREFIJO_SIN_PAYLOAD} Discord respondió 500`))
    assert.equal(c.log.avisar.length, 1)
    assert.match(c.log.avisar[0], /no tiene guardado lo que mandó Fathom/)
    assert.equal(c.cronLog.leer.length + c.log.reclamar.length, 0)
  })
  test('respeta el deadline: sin tiempo para otra fila, la deja para mañana', async () => {
    const c = cron([fila({ recording_id: 44 }), fila({ recording_id: 55 })])
    const r = await reintentarPendientes(c.deps, { deadline: AHORA + 60_000 })
    assert.deepEqual(r.procesadas.map(p => p.estado), ['sin_tiempo', 'sin_tiempo'])
    assert.equal(c.log.reclamar.length, 0)
  })
  test('si la base falla al leer un payload, sigue con la siguiente', async () => {
    const c = cron([fila({ recording_id: 66 }), fila({ recording_id: 77 })])
    const leer = c.deps.leerPayload
    c.deps.leerPayload = async id => { if (id === 66) throw new Error('Neon caído'); return leer(id) }
    const r = await reintentarPendientes(c.deps)
    assert.deepEqual(r.procesadas.map(p => [p.recording_id, p.estado]), [[66, 'error'], [77, 'enviado']])
  })
})

// ── La ruta: todo lo que tiene que rechazar (sin llegar a after(), la base, Claude ni Discord) ──
describe('app/api/fathom-anuncios: falla cerrado', async () => {
  const { GET, POST } = await import('../app/api/fathom-anuncios/route.ts')
  const URL_RUTA = 'http://localhost:3101/api/fathom-anuncios'
  const CRON = 'cron-de-prueba-' + randomBytes(8).toString('hex')
  const cuerpo = JSON.stringify(reunion())
  const firmado = (c = cuerpo, ts = String(Math.floor(Date.now() / 1000))) => ({ 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': firmar(SECRETO, 'msg_1', ts, c) })
  const post = (headers, body = cuerpo, qs = '') => POST(new Request(URL_RUTA + qs, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))
  beforeEach(() => { process.env.CRON_SECRET = CRON; delete process.env.FATHOM_WEBHOOK_SECRET; delete process.env.DATABASE_URL })

  test('sin cabeceras de webhook ni Bearer: 401; ?key= no sirve', async () => {
    assert.equal((await post({})).status, 401)
    assert.equal((await post({}, cuerpo, `?key=${CRON}`)).status, 401)
    assert.equal((await post({ authorization: 'Bearer otra' })).status, 401)
  })
  test('webhook sin FATHOM_WEBHOOK_SECRET (o con uno roto): 503 (nunca acepta sin firma)', async () => {
    const r = await post(firmado())
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'no configurado' }, 'el 503 no dice qué variable falta')
    process.env.FATHOM_WEBHOOK_SECRET = 'whsec_no es base64!'
    assert.equal((await post(firmado())).status, 503)
  })
  test('firma inválida, timestamp viejo o cuerpo tocado: 401', async () => {
    process.env.FATHOM_WEBHOOK_SECRET = SECRETO
    assert.equal((await post({ ...firmado(), 'webhook-signature': 'v1,abc' })).status, 401)
    assert.equal((await post(firmado(cuerpo, String(Math.floor(Date.now() / 1000) - 600)))).status, 401)
    assert.equal((await post(firmado(), cuerpo.replace('Laura', 'Lara'))).status, 401)
    // Con Bearer válido pero cabeceras de webhook, manda la firma (no se puede saltear con el Bearer)
    assert.equal((await post({ ...firmado(), 'webhook-signature': 'v1,abc', authorization: `Bearer ${CRON}` })).status, 401)
  })
  test('firma válida con JSON roto o payload inválido: 400', async () => {
    process.env.FATHOM_WEBHOOK_SECRET = SECRETO
    assert.equal((await post(firmado('{no'), '{no')).status, 400)
    const malo = JSON.stringify(reunion({ recording_id: 'x' }))
    const r = await post(firmado(malo), malo)
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /recording_id/)
  })
  test('modo manual con Bearer: JSON roto o payload inválido → 400', async () => {
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, '{no', '?dry=1')).status, 400)
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, JSON.stringify({ recording_id: 1, url: 'http://x' }), '?dry=1')).status, 400)
  })
  test('GET: 401 sin Bearer; con Bearer dice qué falta configurar', async () => {
    assert.equal((await GET(new Request(URL_RUTA))).status, 401)
    assert.equal((await GET(new Request(`${URL_RUTA}?key=${CRON}`))).status, 401)
    const r = await GET(new Request(URL_RUTA, { headers: { authorization: `Bearer ${CRON}` } }))
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await r.json(), { configurado: { anthropic: false, firma_fathom: false, discord: false, valentino: false, base: false }, ultimas: [] })
  })
  test('POST ?recording_id= (modo manual por id): solo con Bearer; id inválido 400; sin base 503 (sin tocar nada)', async () => {
    assert.equal((await post({}, '', '?recording_id=123')).status, 401)
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, '', '?recording_id=abc')).status, 400)
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, '', '?recording_id=-1&forzar=1')).status, 400)
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, '', '?recording_id=1.5')).status, 400)
    const r = await post({ authorization: `Bearer ${CRON}` }, '', '?recording_id=123&forzar=1')
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'falta DATABASE_URL' })
    // Con cabeceras de webhook, el recording_id de la query no saltea la firma
    assert.equal((await post({ ...firmado(), 'webhook-signature': 'v1,abc', authorization: `Bearer ${CRON}` }, cuerpo, '?recording_id=123')).status, 503)
  })
  test('GET ?reintentar=1 y la ruta hija del cron: 401 sin Bearer (ni con ?key=); con Bearer y sin base, 503', async () => {
    const { GET: GET_CRON } = await import('../app/api/fathom-anuncios/reintentar/route.ts')
    const URL_CRON = `${URL_RUTA}/reintentar`
    assert.equal((await GET(new Request(`${URL_RUTA}?reintentar=1`))).status, 401)
    assert.equal((await GET_CRON(new Request(URL_CRON))).status, 401)
    assert.equal((await GET_CRON(new Request(`${URL_CRON}?key=${CRON}`))).status, 401)
    assert.equal((await GET_CRON(new Request(URL_CRON, { headers: { authorization: 'Bearer otra' } }))).status, 401)
    const r = await GET_CRON(new Request(URL_CRON, { headers: { authorization: `Bearer ${CRON}` } }))
    assert.equal(r.status, 503)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal((await GET(new Request(`${URL_RUTA}?reintentar=1`, { headers: { authorization: `Bearer ${CRON}` } }))).status, 503)
    delete process.env.CRON_SECRET
    assert.equal((await GET_CRON(new Request(URL_CRON, { headers: { authorization: 'Bearer undefined' } }))).status, 401)
  })
  test('vercel.json: el cron de reintentos es diario (Hobby) y apunta a la ruta hija', () => {
    const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons
    const c = crons.find(x => x.path.startsWith('/api/fathom-anuncios'))
    assert.deepEqual(c, { path: '/api/fathom-anuncios/reintentar', schedule: '30 11 * * *' })
    for (const x of crons) assert.match(x.schedule, /^\d+ \d+ /, `${x.path}: en Hobby solo una vez por día`)
  })
})
