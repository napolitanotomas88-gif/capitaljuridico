// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-fathom-anuncios-kickoff.mjs
// fathom-anuncios en las kickoffs (24/10/2026): Valentino recibe SOLO el «🚀 Para lanzar» del bot de kickoff, así que
// fathom-anuncios no manda nada de una grabación que el bot de kickoff clasificó como kickoff (lib/fathomAnuncios/kickoff.ts).
// SIN red, SIN base y SIN Claude: dependencias falsas, Neon falso para el SQL y fetch global bloqueado.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(
  "export async function load(url, ctx, next) { if (url.endsWith('.json') && !ctx.importAttributes?.type) return next(url, { ...ctx, importAttributes: { ...ctx.importAttributes, type: 'json' } }); return next(url, ctx) }"))

for (const k of ['ANTHROPIC_API_KEY', 'FATHOM_WEBHOOK_SECRET', 'DISCORD_WEBHOOK_CAMBIOS_ANUNCIOS', 'DISCORD_WEBHOOK_ANUNCIOS',
  'DISCORD_ID_VALENTINO', 'DATABASE_URL', 'CRON_SECRET', 'SHEET_ID_CLIENTES', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const { decidirKickoff, MOTIVO_KICKOFF, PREFIJO_KICKOFF, ESPERA_KICKOFF_MAX_MS, ESPERA_KICKOFF_PASO_MS } = await import('../lib/fathomAnuncios/kickoff.ts')
const { procesarReunion, PLAZO_MS, MARGEN_ENVIO_MS } = await import('../lib/fathomAnuncios/procesar.ts')
const registro = await import('../lib/fathomAnuncios/registro.ts')
const { depsReales } = await import('../lib/fathomAnuncios/servidor.ts')

const AHORA = Date.parse('2026-10-24T22:10:00Z')
const hms = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
const reunion = (over = {}) => ({
  title: 'Laura Pérez y Tomas Napolitano', meeting_title: 'Kickoff', recording_id: 555,
  url: 'https://fathom.video/calls/555', share_url: 'https://fathom.video/share/abc',
  created_at: '2026-10-24T22:05:00Z', recording_start_time: '2026-10-24T21:32:00Z', recording_end_time: '2026-10-24T22:02:00Z',
  calendar_invitees_domains_type: 'one_or_more_external',
  transcript: Array.from({ length: 40 }, (_, i) => ({ speaker: { display_name: i % 2 ? 'Laura Pérez' : 'Tomás Napolitano', matched_calendar_invitee_email: null }, text: `frase ${i}`, timestamp: hms(i * 30) })),
  default_summary: { template_name: 'General', markdown_formatted: '## Summary' },
  action_items: [],
  calendar_invitees: [{ name: 'Laura Pérez', email: 'laura@estudio.com', email_domain: 'estudio.com', is_external: true }],
  recorded_by: { name: 'Tomás Napolitano', email: 'tomas@example.test', email_domain: 'example.test', team: null },
  ...over,
})
const extraccion = (over = {}) => ({
  extraccion: {
    tipo_reunion: 'cliente', resumen_corto: 'Arranque con Laura',
    clientes: [{ nombre_escuchado: 'Laura', cliente_crm: 'Laura Pérez', cuenta_publicitaria: 'act_123', pendientes: [],
      cambios: [{ tipo: 'presupuesto', detalle: 'Cargá USD 10 por día.', cuando: null, certeza: 'confirmado', timestamp: '00:05:00', cita: 'diez dólares' }] }],
    ...over,
  },
  modelo: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, ajustes: [],
})
const reclamoNuevo = () => ({ intentos: 1, error_previo: null, resultado: null, version_prompt: null, modelo: null, tokens_in: null, tokens_out: null, clientes_enviados: [], mensajes: [] })
const fila = (estado, tipo = null, duplicada_de = null) => ({ estado, tipo, duplicada_de })
const consulta = (f, original = null) => ({ fila: f, original })

/** Dependencias falsas. kickoffs: lista de respuestas de deps.kickoff, en orden (la última se repite); una Error se lanza. */
function fakes(kickoffs, over = {}) {
  const log = { extraer: 0, guardar: 0, marcar: [], enviar: [], esperas: [], kickoff: 0, enviarEn: null }
  const reloj = { t: AHORA }
  const deps = {
    reclamar: async () => reclamoNuevo(),
    guardarExtraccion: async () => { log.guardar++ },
    anotarEnviados: async () => {},
    marcar: async (id, m) => { log.marcar.push(m) },
    contexto: async () => ({ clientes: [{ nombre: 'Laura Pérez', estado: 'ACTIVO', email: null, cuentas: ['act_123'] }], estado: 'ok' }),
    extraer: async () => { log.extraer++; reloj.t += 50_000; return extraccion() },   // Claude tarda ~50 s
    enviar: async m => { log.enviar.push(m); log.enviarEn = reloj.t; return m.map((_, i) => `m${i}`) },
    avisar: async () => {},
    esperar: async ms => { log.esperas.push(ms); reloj.t += ms },
    ...(kickoffs ? {
      kickoff: async () => {
        const r = kickoffs[Math.min(log.kickoff++, kickoffs.length - 1)]
        if (r instanceof Error) throw r
        return r
      },
    } : {}),
    alias: [], valentino: '111', discordListo: true,
    ahora: () => (reloj.t += 1),
    ...over,
  }
  return { deps, log, reloj }
}

describe('decidirKickoff', () => {
  test('lo que dice cada fila de cj_kickoffs', () => {
    assert.equal(decidirKickoff(null), 'desconocido')
    assert.equal(decidirKickoff(consulta(null)), 'desconocido')
    assert.equal(decidirKickoff(consulta(fila('lista', 'kickoff'))), 'kickoff')
    assert.equal(decidirKickoff(consulta(fila('lista'))), 'kickoff', 'lista solo existe para kickoffs')
    assert.equal(decidirKickoff(consulta(fila('procesando'))), 'pendiente')
    assert.equal(decidirKickoff(consulta(fila('procesando', 'kickoff'))), 'pendiente', 'ficha de kickoff, pero el «Para lanzar» sale recién en lista')
    assert.equal(decidirKickoff(consulta({ ...fila('procesando'), colgada: true })), 'desconocido', 'el bot de kickoff murió: se manda')
    assert.equal(decidirKickoff(consulta({ ...fila('procesando', 'kickoff'), colgada: true })), 'desconocido')
    assert.equal(decidirKickoff(consulta(fila('procesando', 'seguimiento'))), 'no_kickoff')
    assert.equal(decidirKickoff(consulta(fila('no_kickoff', 'seguimiento'))), 'no_kickoff')
    assert.equal(decidirKickoff(consulta(fila('no_kickoff'))), 'no_kickoff')
    assert.equal(decidirKickoff(consulta(fila('omitida'))), 'desconocido')
    assert.equal(decidirKickoff(consulta(fila('error'))), 'desconocido')
    assert.equal(decidirKickoff(consulta(fila('error', 'kickoff'))), 'desconocido', 'falló después de la ficha: el «Para lanzar» no salió, se manda')
    assert.equal(decidirKickoff(consulta(fila('error', 'seguimiento'))), 'no_kickoff')
  })
  test('duplicada: decide la original; sin original o con cadena de duplicadas → desconocido', () => {
    assert.equal(decidirKickoff(consulta(fila('duplicada', null, 9), fila('lista', 'kickoff'))), 'kickoff')
    assert.equal(decidirKickoff(consulta(fila('duplicada', null, 9), fila('no_kickoff', 'equipo'))), 'no_kickoff')
    assert.equal(decidirKickoff(consulta(fila('duplicada', null, 9), fila('procesando'))), 'pendiente')
    assert.equal(decidirKickoff(consulta(fila('duplicada', null, 9))), 'desconocido')
    assert.equal(decidirKickoff(consulta(fila('duplicada', null, 9), fila('duplicada', null, 8))), 'desconocido')
  })
  test('el motivo empieza con el prefijo y nombra el aviso que sí sale', () => {
    assert.ok(MOTIVO_KICKOFF.startsWith(PREFIJO_KICKOFF))
    assert.match(MOTIVO_KICKOFF, /Para lanzar/)
  })
})

describe('procesarReunion con el bot de kickoff', () => {
  test('ya decidido kickoff antes de Claude: omitida, sin Claude ni Discord', async () => {
    const { deps, log } = fakes([consulta(fila('lista', 'kickoff'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(r.motivo, MOTIVO_KICKOFF)
    assert.equal(r.kickoff, 'kickoff')
    assert.equal(log.extraer, 0)
    assert.equal(log.enviar.length, 0)
    assert.deepEqual(log.marcar.map(m => [m.estado, m.error]), [['omitida', MOTIVO_KICKOFF]])
  })
  test('no es kickoff: sale como siempre y no espera', async () => {
    const { deps, log } = fakes([consulta(fila('no_kickoff', 'seguimiento'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.kickoff, 'no_kickoff')
    assert.equal(log.enviar.length, 1)
    assert.equal(log.kickoff, 1, 'decidido antes de Claude: no se vuelve a consultar')
    assert.deepEqual(log.esperas, [])
  })
  test('pendiente al principio y lista después de Claude: omitida, con la extracción guardada, sin Discord', async () => {
    const { deps, log } = fakes([consulta(fila('procesando')), consulta(fila('lista', 'kickoff'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(log.extraer, 1)
    assert.equal(log.guardar, 1)
    assert.equal(log.enviar.length, 0)
    const m = log.marcar.at(-1)
    assert.equal(m.estado, 'omitida')
    assert.equal(m.error, MOTIVO_KICKOFF)
    assert.ok(m.resultado, 'la extracción queda en el registro')
    assert.deepEqual(log.esperas, [])
  })
  test('ficha de kickoff todavía procesando: espera a que quede lista y no manda', async () => {
    const { deps, log } = fakes([consulta(fila('procesando')), consulta(fila('procesando', 'kickoff')), consulta(fila('procesando', 'kickoff')), consulta(fila('lista', 'kickoff'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(log.enviar.length, 0)
    assert.deepEqual(log.esperas, [ESPERA_KICKOFF_PASO_MS, ESPERA_KICKOFF_PASO_MS])
  })
  test('el bot de kickoff falló después de la ficha: se manda (Valentino no se queda sin nada)', async () => {
    const { deps, log } = fakes([consulta(fila('procesando')), consulta(fila('error', 'kickoff'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.kickoff, 'desconocido')
    assert.equal(log.enviar.length, 1)
  })
  test('ignorarKickoff (a mano): no consulta y manda', async () => {
    const { deps, log } = fakes([consulta(fila('lista', 'kickoff'))])
    const r = await procesarReunion(reunion(), deps, { ignorarKickoff: true })
    assert.equal(r.estado, 'enviado')
    assert.equal(log.kickoff, 0)
  })
  test('sin margen para leer y mandar (cron al límite): no consulta', async () => {
    const f = fakes([consulta(fila('procesando'))])
    f.deps.extraer = async () => { f.log.extraer++; f.reloj.t += 55_000; return extraccion() }
    const r = await procesarReunion(reunion(), f.deps, { deadline: AHORA + 91_000 })
    assert.equal(r.estado, 'enviado')
    assert.equal(f.log.kickoff, 1, 'solo la de antes de Claude: después ya no queda margen')
    assert.deepEqual(f.log.esperas, [])
  })
  test('pendiente: espera de a ESPERA_KICKOFF_PASO_MS hasta que decide (no kickoff) y manda', async () => {
    const { deps, log } = fakes([consulta(fila('procesando')), consulta(fila('procesando')), consulta(fila('procesando')), consulta(fila('procesando', 'seguimiento'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.kickoff, 'no_kickoff')
    assert.deepEqual(log.esperas, [ESPERA_KICKOFF_PASO_MS, ESPERA_KICKOFF_PASO_MS])
  })
  test('nunca decide: espera hasta el tope desde el arranque y manda igual, con tiempo para mandar', async () => {
    const { deps, log } = fakes([consulta(fila('procesando'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.kickoff, 'pendiente')
    const esperado = log.esperas.reduce((a, b) => a + b, 0)
    assert.ok(esperado > 0 && esperado <= ESPERA_KICKOFF_MAX_MS - 50_000, `esperó ${esperado} ms`)
    assert.ok(log.enviarEn - AHORA <= ESPERA_KICKOFF_MAX_MS + 1_000, 'manda apenas pasa el tope')
    assert.ok(log.enviarEn < AHORA + PLAZO_MS - MARGEN_ENVIO_MS)
  })
  test('el cron con poco plazo: no espera más allá del deadline menos el margen para mandar', async () => {
    const { deps, log } = fakes([consulta(fila('procesando'))])
    const r = await procesarReunion(reunion(), deps, { deadline: AHORA + 130_000 })
    assert.equal(r.estado, 'enviado')
    assert.ok(log.enviarEn <= AHORA + 130_000 - MARGEN_ENVIO_MS, `mandó a los ${log.enviarEn - AHORA} ms`)
  })
  test('sin fila (el bot de kickoff no la recibió): no espera y manda', async () => {
    const { deps, log } = fakes([consulta(null)])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.kickoff, 'desconocido')
    assert.deepEqual(log.esperas, [])
  })
  test('la base no responde: se reintenta como pendiente y, si después contesta kickoff, no manda', async () => {
    const { deps, log } = fakes([new Error('la base no respondió'), new Error('otra vez'), consulta(fila('lista', 'kickoff'))])
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(log.enviar.length, 0)
    assert.deepEqual(log.esperas, [ESPERA_KICKOFF_PASO_MS])
  })
  test('venta o nada para Valentino: sin_cambios sin esperar al bot de kickoff', async () => {
    const { deps, log } = fakes([consulta(fila('procesando'))], { extraer: async () => extraccion({ tipo_reunion: 'venta', clientes: [] }) })
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'sin_cambios')
    assert.deepEqual(log.esperas, [])
  })
  test('dry: no espera ni escribe; con kickoff ya decidido no llama a Claude; pendiente devuelve los mensajes', async () => {
    const a = fakes([consulta(fila('lista', 'kickoff'))])
    const ra = await procesarReunion(reunion(), a.deps, { dry: true })
    assert.equal(ra.estado, 'omitida')
    assert.equal(a.log.extraer, 0)
    assert.equal(a.log.marcar.length, 0)
    const b = fakes([consulta(fila('procesando'))])
    const rb = await procesarReunion(reunion(), b.deps, { dry: true })
    assert.equal(rb.estado, 'dry')
    assert.equal(rb.kickoff, 'pendiente')
    assert.ok(rb.mensajes.length > 0)
    assert.deepEqual(b.log.esperas, [])
    assert.equal(b.log.marcar.length, 0)
  })
  test('sin la dependencia kickoff (como antes): manda sin consultar', async () => {
    const { deps, log } = fakes(null)
    const r = await procesarReunion(reunion(), deps)
    assert.equal(r.estado, 'enviado')
    assert.equal(r.kickoff, 'desconocido')
    assert.deepEqual(log.esperas, [])
  })
  test('las dependencias reales miran SIEMPRE el bot de kickoff (26/10: las kickoffs no van a Valentino; lo de lanzar sale con los videos editados)', () => {
    try {
      assert.equal(typeof depsReales().kickoff, 'function', 'sin canal ni interruptor')
      process.env.DISCORD_WEBHOOK_ANUNCIOS = 'https://discord.test/api/webhooks/1/x'
      process.env.KICKOFF_AVISO_ADS = '0'
      assert.equal(typeof depsReales().kickoff, 'function', 'con el «Para lanzar» de la kickoff apagado')
      process.env.KICKOFF_AVISO_ADS = '1'
      assert.equal(typeof depsReales().kickoff, 'function', 'prendido')
    } finally { delete process.env.DISCORD_WEBHOOK_ANUNCIOS; delete process.env.KICKOFF_AVISO_ADS }
  })
})

describe('leerKickoff contra un Neon falso (solo lectura)', () => {
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    return { consultas, fabrica: () => q }
  }
  const correr = async (responder, fn) => {
    process.env.DATABASE_URL = 'postgres://falsa.test/db'
    const n = neonFalso(responder)
    registro.sqlParaPruebas(n.fabrica)
    try { return { r: await fn(), consultas: n.consultas } } finally { registro.sqlParaPruebas(null); delete process.env.DATABASE_URL }
  }

  test('una fila: estado, tipo de la ficha y colgada; solo SELECT, nunca crea ni escribe cj_kickoffs', async () => {
    const { r, consultas } = await correr(() => [{ estado: 'procesando', tipo: 'kickoff', duplicada_de: null, colgada: true }], () => registro.leerKickoff(555))
    assert.deepEqual(r, { fila: { estado: 'procesando', tipo: 'kickoff', duplicada_de: null, colgada: true }, original: null })
    assert.equal(consultas.length, 1)
    assert.match(consultas[0].texto, /^SELECT estado, ficha ->> 'tipo_reunion' AS tipo, duplicada_de, \(actualizado < now\(\) - interval '10 minutes'\) AS colgada FROM cj_kickoffs WHERE recording_id = \$1$/)
    assert.deepEqual(consultas[0].valores, [555])
    assert.ok(!consultas.some(c => /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i.test(c.texto)))
  })
  test('duplicada: lee también la original', async () => {
    const { r, consultas } = await correr((t, v) => (v[0] === 555 ? [{ estado: 'duplicada', tipo: null, duplicada_de: '444' }] : [{ estado: 'lista', tipo: 'kickoff', duplicada_de: null }]), () => registro.leerKickoff(555))
    assert.deepEqual(r.original, { estado: 'lista', tipo: 'kickoff', duplicada_de: null, colgada: false })
    assert.equal(r.fila.duplicada_de, 444)
    assert.deepEqual(consultas.map(c => c.valores[0]), [555, 444])
    assert.equal(decidirKickoff(r), 'kickoff')
  })
  test('sin la columna duplicada_de en esta base: se lee por to_jsonb (y se recuerda)', async () => {
    const sinCol = Object.assign(new Error('column "duplicada_de" does not exist'), { code: '42703' })
    const { r, consultas } = await correr(t => { if (!t.includes('to_jsonb')) throw sinCol; return [{ estado: 'no_kickoff', tipo: 'seguimiento', duplicada_de: null, colgada: false }] }, () => registro.leerKickoff(7))
    assert.equal(r.fila.estado, 'no_kickoff')
    assert.match(consultas.at(-1).texto, /to_jsonb\(k\) ->> 'duplicada_de'/)
    const segunda = await correr(() => [], () => registro.leerKickoff(8))
    assert.ok(segunda.consultas.every(c => c.texto.includes('to_jsonb')), 'no vuelve a probar la columna')
  })
  test('sin fila o sin la tabla todavía: nada (no rompe)', async () => {
    assert.deepEqual((await correr(() => [], () => registro.leerKickoff(1))).r, { fila: null, original: null })
    const sinTabla = Object.assign(new Error('relation "cj_kickoffs" does not exist'), { code: '42P01' })
    assert.deepEqual((await correr(() => { throw sinTabla }, () => registro.leerKickoff(1))).r, { fila: null, original: null })
  })
  test('otro error de la base: se propaga (procesar.ts lo toma como pendiente)', async () => {
    await assert.rejects(correr(() => { throw new Error('permission denied') }, () => registro.leerKickoff(1)), /permission denied/)
  })
})
