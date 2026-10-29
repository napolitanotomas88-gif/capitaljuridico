// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff.mjs
// Fathom → ficha de kickoff → ideas → Discord (lib/bot/kickoff y app/api/bot/kickoff). SIN red, SIN base y SIN Claude: el
// orquestador se prueba con dependencias falsas, Claude con un stream SSE armado acá, y fetch global queda bloqueado para que
// un descuido no le escriba a nadie. Los nombres, IDs, mails y secretos de acá son inventados.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

// Antes de importar nada: entorno limpio (que ninguna variable real del shell active una llamada de verdad)
for (const k of ['ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'FATHOM_KICKOFF_WEBHOOK_SECRET', 'DISCORD_WEBHOOK_KICKOFF', 'DISCORD_ID_TOMAS',
  'DISCORD_ID_GERO_M', 'DATABASE_URL', 'CRON_SECRET', 'KICKOFF_MODELO', 'KICKOFF_ESFUERZO', 'META_ANUNCIOS_TOKEN', 'META_CLIENTES_TOKEN', 'AUTH_BASE_URL',
  'DESPACHO_URL', 'KICKOFF_PANTALLA']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const { firmar } = await import('../lib/fathomAnuncios/firma.ts')
const { formatearTranscripcion } = await import('../lib/fathomAnuncios/transcripcion.ts')
const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')
const { validarSalida, normTexto, citaTextual, mensajeUsuario, extraerFicha, SCHEMA_FICHA, emailsExternos, renglonesNorm, ubicarCita, partirEvidencia } = await import('../lib/bot/kickoff/extraer.ts')
const { validarIdeas, mensajeIdeas, SCHEMA_IDEAS, CANTIDAD_IDEAS } = await import('../lib/bot/kickoff/ideas.ts')
const { armarFicha, calcularFaltantes, fichaMarkdown, normalizarRama, normalizarPresupuesto, textoPresupuesto, quienGrabo, portfolioFinalDe, faltantesPortfolio, notaCorteGrabacion, renglonLanzamiento, claveFaltante, ETIQUETA_FALTANTE } = await import('../lib/bot/kickoff/ficha.ts')
const { agruparAnuncios, elegirGanadores, esDeLaRama, limpiarNombreAnuncio, ramaProbable, paisDeCuenta, paisDeTexto, anonimizar, batchConTokens, todasLasPaginas } = await import('../lib/bot/kickoff/ganadores.ts')
const { armarAviso, linkFicha, usuariosMencionados, textoErrorKickoff, textoAvisoSinAnotar, corto, subramaCorta, ganadoresCitados, resumenPortfolio, MAX_DISCORD } = await import('../lib/bot/kickoff/mensaje.ts')
const { procesarKickoff, fichaGuardada, extraccionDeFicha, chequeoPortfolio, MIN_CLAUDE_MS, MARGEN_ENVIO_MS, RESERVA_IDEAS_MS, TOPE_GANADORES_MS, TOPE_PORTFOLIO_MS, PLAZO_MS, PREFIJO_AVISO_ENVIADO, PREFIJO_AJUSTE_PORTFOLIO, avisoDeErrorPrevio, motivoDe } = await import('../lib/bot/kickoff/procesar.ts')
const { paraFicha, portfolioSinLectura } = await import('../lib/bot/kickoff/portfolio.ts')
const { pantallaFicha, urlDespacho, depsLectura, URL_DESPACHO } = await import('../lib/bot/kickoff/servidor.ts')
const registro = await import('../lib/bot/kickoff/registro.ts')
const { armarClientesKickoff } = await import('../lib/bot/kickoff/contexto.ts')
const { kbDeRama } = await import('../lib/bot/kickoff/kb/index.ts')
const { PROMPT_SISTEMA, VERSION_PROMPT } = await import('../lib/bot/kickoff/prompt.ts')
const { PROMPT_IDEAS, VERSION_IDEAS } = await import('../lib/bot/kickoff/prompt-ideas.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')
const { ITEMS_PORTFOLIO } = await import('../lib/bot/kickoff/tipos.ts')

const TOMI = '111111111111111111', GERO = '222222222222222222'
const AHORA = Date.parse('2026-10-23T12:30:00Z')
const SECRETO = `whsec_${randomBytes(24).toString('base64')}`

// ── Datos de prueba ──
const hms = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
const renglones = (n, cada = 30) => Array.from({ length: n }, (_, i) => ({
  speaker: { display_name: i % 2 ? 'Tomas Napolitano' : 'Abogada Ana Pérez', matched_calendar_invitee_email: null },
  text: `frase número ${i} de la llamada`,
  timestamp: hms(i * cada),
}))
const reunion = (over = {}) => ({
  title: 'ANA PEREZ y Tomas Napolitano', meeting_title: 'ANA PEREZ y Tomas Napolitano', recording_id: 987654321,
  url: 'https://fathom.video/calls/111', share_url: null,
  created_at: '2026-10-23T12:22:00Z', recording_start_time: '2026-10-23T12:00:00Z', recording_end_time: '2026-10-23T12:22:00Z',
  calendar_invitees_domains_type: 'one_or_more_external',
  transcript: renglones(40),
  default_summary: { template_name: 'General', markdown_formatted: '## Propósito\nArrancar con despidos laborales en Mendoza.' },
  action_items: [{ description: 'Redactar los guiones', recording_timestamp: '00:12:00', recording_playback_url: null, assignee: { name: 'Tomas Napolitano', email: 't@ejemplo.com', team: null } }],
  calendar_invitees: [
    { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: false },
    { name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true },
  ],
  recorded_by: { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', team: null },
  ...over,
})
const CONOCIDOS = [
  { id: 'A101', nombre: 'Ana Pérez', estado: 'ACTIVO', email: 'ana@estudio.test', cuentas: ['act_999'] },
  { id: 'A102', nombre: 'Bruno Díaz', estado: 'ACTIVO', email: 'bruno@estudio.test', cuentas: [] },
]
const salidaClaude = (over = {}) => ({
  tipo_reunion: 'kickoff', resumen_corto: 'Kickoff con Ana: laboral en Mendoza',
  cliente: { nombre_escuchado: 'Ana Pérez', cliente_crm: 'Ana Pérez', id_crm: 'A101' },
  rama: {
    principal: 'laboral', texto: 'Laboral: despidos', cita: 'frase número 10 de la llamada', timestamp: '00:05:00',
    subramas: [{ texto: 'despidos en blanco con 2 años o más', cita: 'frase número 12 de la llamada', timestamp: '00:06:00' }],
    descartadas: [{ texto: 'ART', motivo: 'no le interesa', cita: '', timestamp: '' }],
    a_futuro: [{ texto: 'Familia más adelante', cita: 'familia después', timestamp: '00:07:00' }],
  },
  avatar: { incluye: [{ texto: 'en blanco o parcialmente en blanco', cita: '', timestamp: '00:06:00' }], excluye: [{ texto: 'nada totalmente en negro', cita: '', timestamp: '' }] },
  zona: { descripcion: 'Mendoza capital y Godoy Cruz', lugares: ['Mendoza', 'Godoy Cruz'], radio_km: 20, presentarse_como: 'Mendoza capital', mapa_en_pantalla: true, cita: '', timestamp: '00:08:00' },
  presupuesto: { usd_dia_min: 10, usd_dia_max: 10, usd_mes: 300, moneda: 'USD', texto: 'USD 10 por día', deducido: false, certeza: 'confirmado', cita: 'frase número 18 de la llamada', timestamp: '00:09:00' },
  portfolio: [
    { item: 'instagram', estado: 'ok', detalle: 'tiene cuenta', cita: '', timestamp: '00:10:00' },
    { item: 'tarjeta', estado: 'falta', detalle: 'cargar una tarjeta en dólares', cita: '', timestamp: '00:11:00' },
  ],
  acuerdos: [{ quien: 'Tomás', que: 'mandar los guiones', cuando: '~25/10, estimado', cita: '', timestamp: '00:12:00' }],
  pendientes: ['confirmar el número de WhatsApp'],
  ...over,
})
const r0 = validarReunion(reunion()).reunion
const tr0 = formatearTranscripcion(r0.transcript)
const cx = (over = {}) => ({ rango: { desde: tr0.desde, hasta: tr0.hasta }, transcripcionNorm: normTexto(tr0.texto), conocidos: CONOCIDOS, emailsInvitados: emailsExternos(r0), ...over })
const extraccionDe = (over = {}, ctx = cx()) => validarSalida(salidaClaude(over), ctx)
const resultadoExtraccion = (over = {}) => {
  const { extraccion, ajustes } = extraccionDe(over)
  return { extraccion, ajustes, modelo: 'claude-opus-5-5', usage: { input_tokens: 15000, output_tokens: 4000 } }
}
const IDEAS_OK = Array.from({ length: 5 }, (_, i) => ({ titulo: `Idea ${i + 1}`, gancho: `¿Te despidieron en Mendoza? ${i}`, angulo: 'liquidación', subrama: 'despidos en blanco con 2 años o más', por_que: 'G1 (USD 0,40)' }))
const resultadoIdeas = (over = {}) => ({ ideas: IDEAS_OK, notas: '', ajustes: [], modelo: 'claude-opus-5-5', usage: { input_tokens: 6000, output_tokens: 2000 }, ...over })
const candidatos = (over = {}) => ({
  rama: 'laboral', generado: '2026-10-23T12:00:00Z', ventana: { desde: '2026-04-27', hasta: '2026-10-23', dias: 180 },
  cuentas: [{ id: 'act_1', cliente: 'Cliente Uno' }, { id: 'act_2', cliente: 'Cliente Dos' }, { id: 'act_999', cliente: 'Ana Pérez' }],
  candidatos: [
    { cuentaId: 'act_999', cliente: 'Ana Pérez', anuncio: '¿Te echaron en blanco?', moneda: 'USD', gasto: 50, gastoUSD: 50, mensajes: 200, cplUSD: 0.25, adIds: ['a0'], adPrincipal: 'a0', copy: 'despido' },
    { cuentaId: 'act_1', cliente: 'Cliente Uno', anuncio: '¿Trabajaste en negro y te echaron?', moneda: 'USD', gasto: 90, gastoUSD: 90, mensajes: 250, cplUSD: 0.36, adIds: ['a1'], adPrincipal: 'a1', copy: 'Aunque hayas trabajado en negro' },
    { cuentaId: 'act_1', cliente: 'Cliente Uno', anuncio: '¿Te separaste y no ves a tus hijos?', moneda: 'USD', gasto: 40, gastoUSD: 40, mensajes: 100, cplUSD: 0.4, adIds: ['a2'], adPrincipal: 'a2', copy: 'familia' },
    { cuentaId: 'act_1', cliente: 'Cliente Uno', anuncio: '¿Firmaste tu liquidación?', moneda: 'USD', gasto: 80, gastoUSD: 80, mensajes: 180, cplUSD: 0.44, adIds: ['a3'], adPrincipal: 'a3', copy: 'liquidación mal calculada' },
    { cuentaId: 'act_1', cliente: 'Cliente Uno', anuncio: '¿Te empujan a renunciar?', moneda: 'USD', gasto: 60, gastoUSD: 60, mensajes: 120, cplUSD: 0.5, adIds: ['a4'], adPrincipal: 'a4', copy: 'renunciar' },
    { cuentaId: 'act_2', cliente: 'Cliente Dos', anuncio: '¿Te despidieron y te pagaron menos?', moneda: 'ARS', gasto: 90000, gastoUSD: 60, mensajes: 100, cplUSD: 0.6, adIds: ['a5'], adPrincipal: 'a5', copy: 'liquidación' },
  ],
  erroresCuentas: 0, nota: '',
  ...over,
})

/**
 * Lo que devolvería portfolioDelCliente (portfolio.ts) para la cuenta de Ana, leída: IG y WhatsApp sin dato (como Laura), lo
 * demás ok. `items` pisa ítems sueltos; el resto de `over`, la cabecera (cuenta, leido, aviso, busqueda…).
 */
const lecturaMeta = ({ items = {}, ...over } = {}) => ({
  cuenta: 'act_999', nombre: 'USD Estudio Ana', negocio: { id: 'b1', nombre: 'Estudio Ana' }, leido: true, motivo: null, aviso: null,
  datos: null, llamadas: 1, ms: 5, token: 'META_CLIENTES_TOKEN', generado: '2026-10-23T12:40:00Z',
  items: Object.fromEntries(ITEMS_PORTFOLIO.map(k => [k, {
    estado: 'ok', detalle: `${k}: ok en Meta`, fuente: 'meta', campo: 'act',
    ...(k === 'instagram' ? { estado: 'sin_dato', detalle: 'No se ve Instagram' } : k === 'whatsapp_business' ? { estado: 'sin_dato', detalle: 'Sin anuncios a WhatsApp todavía' } : {}),
    ...(items[k] ?? {}),
  }])),
  busqueda: { cuentas: [{ id: 'act_999', nombre: 'USD Estudio Ana', estado: 1, negocio: null, origen: 'crm' }], origen: 'crm', aviso: null, avisos: [] },
  ...over,
})

/** Dependencias falsas que anotan cada llamada. Reloj falso: cada lectura avanza 1 ms y esperar() lo adelanta. */
function fakes(over = {}) {
  const log = { orden: [], reclamar: [], guardarFicha: [], guardarIdeas: [], anotarAviso: [], marcar: [], contexto: 0, extraer: [], candidatos: [], ideas: [], enviar: [], avisar: [], esperas: [], portfolio: [], preparar: [] }
  const reloj = { t: AHORA }
  const deps = {
    reclamar: async (...a) => { log.orden.push('reclamar'); log.reclamar.push(a); return { intentos: 1, error_previo: null, ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null } },
    guardarFicha: async (id, x) => { log.orden.push('guardarFicha'); log.guardarFicha.push({ id, ...x }) },
    guardarIdeas: async (id, x) => { log.orden.push('guardarIdeas'); log.guardarIdeas.push({ id, ...x }) },
    anotarAviso: async (id, m) => { log.orden.push('anotarAviso'); log.anotarAviso.push({ id, m }) },
    marcar: async (id, m) => { log.orden.push(`marcar:${m.estado}`); log.marcar.push({ id, ...m }) },
    contexto: async () => { log.contexto++; return { clientes: CONOCIDOS, estado: 'ok' } },
    extraer: async (e, tope) => { log.orden.push('extraer'); log.extraer.push({ e, tope }); return resultadoExtraccion() },
    candidatos: async rama => { log.candidatos.push(rama); return candidatos() },
    // El portfolio NO va a log.orden (corre en paralelo): se anota aparte, con lo que ya había pasado cuando arrancó
    portfolio: async (cliente, tope) => { log.portfolio.push({ cliente, tope, despuesDe: [...log.orden] }); return lecturaMeta() },
    prepararPortfolio: () => { log.preparar.push([...log.orden]) },
    kb: rama => kbDeRama(rama),
    ideas: async (e, tope) => { log.orden.push('ideas'); log.ideas.push({ e, tope }); return resultadoIdeas() },
    enviar: async (texto, menciones, deadline) => { log.orden.push('enviar'); log.enviar.push({ texto, menciones, deadline }); return 'msg1' },
    avisar: async t => { log.avisar.push(t) },
    esperar: async ms => { log.esperas.push(ms); reloj.t += ms },
    ahora: () => (reloj.t += 1),
    menciones: { tomi: TOMI, gero_m: GERO },
    tomas: TOMI,
    urlBase: 'https://despacho.ejemplo.test',
    discordListo: true,
    ...over,
  }
  return { deps, log, reloj }
}

// ── Validación de la salida de Claude ─────────────────────────────────────────────────────────
describe('validarSalida (extracción)', () => {
  test('salida completa: queda todo, el portfolio trae SIEMPRE los 7 ítems y lo que no vino es no_se_hablo', () => {
    const { extraccion, ajustes } = extraccionDe()
    assert.equal(extraccion.tipo_reunion, 'kickoff')
    assert.equal(extraccion.rama.principal, 'laboral')
    assert.deepEqual(Object.keys(extraccion.portfolio).sort(), [...ITEMS_PORTFOLIO].sort())
    assert.equal(extraccion.portfolio.instagram.estado, 'ok')
    assert.equal(extraccion.portfolio.whatsapp_business.estado, 'no_se_hablo')
    assert.equal(extraccion.rama.timestamp, '00:05:00')
    assert.equal(extraccion.rama.textual, true, 'la cita está tal cual en la transcripción')
    assert.equal(extraccion.rama.a_futuro[0].textual, false, '"familia después" no está en la transcripción')
    assert.ok(ajustes.some(a => /no aparece/.test(a)))
  })
  test('salidas raras: no objeto → error; enums fuera de lista y campos faltantes → valores seguros', () => {
    assert.throws(() => validarSalida([], cx()))
    assert.throws(() => validarSalida(null, cx()))
    const { extraccion } = validarSalida({ tipo_reunion: 'charla', rama: { principal: 7 }, portfolio: [{ item: 'tiktok', estado: 'ok' }, { item: 'tarjeta', estado: 'rarísimo' }, { item: 'tarjeta', estado: 'ok' }], acuerdos: [{ quien: 'x' }], pendientes: ['', 'algo'] }, cx())
    assert.equal(extraccion.tipo_reunion, 'otra')
    assert.equal(extraccion.rama.principal, null)
    assert.equal(extraccion.portfolio.tarjeta.estado, 'no_se_hablo', 'estado desconocido → no_se_hablo; el repetido se descarta')
    assert.equal(Object.keys(extraccion.portfolio).length, 7)
    assert.deepEqual(extraccion.acuerdos, [], 'un acuerdo sin "qué" no va')
    assert.deepEqual(extraccion.pendientes, ['algo'])
    assert.equal(extraccion.cliente.nombre_escuchado, 'Sin nombre')
    assert.equal(extraccion.presupuesto.certeza, 'a_confirmar')
  })
  test('timestamps: fuera de la llamada o mal formados → null con ajuste; vacío → null sin ajuste', () => {
    const { extraccion, ajustes } = extraccionDe({
      zona: { ...salidaClaude().zona, timestamp: '05:00:00' },
      presupuesto: { ...salidaClaude().presupuesto, timestamp: '9:00' },
    })
    assert.equal(extraccion.zona.timestamp, null)
    assert.equal(extraccion.presupuesto.timestamp, null)
    assert.equal(extraccion.rama.descartadas[0].timestamp, null)
    assert.ok(ajustes.some(a => /^2 timestamps .*sin link/.test(a)), ajustes.join(' | '))
  })
  test('cita de más de 25 palabras: se recorta; citaTextual con "…" mira cada pedazo', () => {
    const larga = Array.from({ length: 40 }, (_, i) => `p${i}`).join(' ')
    const { extraccion, ajustes } = extraccionDe({ rama: { ...salidaClaude().rama, cita: larga } })
    assert.equal(extraccion.rama.cita.split(' ').length, 25)
    assert.ok(extraccion.rama.cita.endsWith('…'))
    assert.ok(ajustes.some(a => /recortada/.test(a)))
    const t = normTexto(tr0.texto)
    assert.equal(citaTextual('frase número 3 … número 4 de la llamada', t), true)
    assert.equal(citaTextual('frase número 3 … algo inventado', t), false)
    assert.equal(citaTextual('hola', t), false, 'una sola palabra no alcanza para decir que es textual')
  })
  test('cliente fuera del CRM → sin verificar; id y nombre que no coinciden → sin verificar', () => {
    const sinMail = cx({ emailsInvitados: [] })
    let x = extraccionDe({ cliente: { nombre_escuchado: 'Carla', cliente_crm: 'Carla Inventada', id_crm: null } }, sinMail)
    assert.equal(x.extraccion.cliente.cliente_crm, null)
    assert.ok(x.ajustes.some(a => /no está en la lista del CRM/.test(a)))
    x = extraccionDe({ cliente: { nombre_escuchado: 'Ana', cliente_crm: 'Bruno Díaz', id_crm: 'A101' } }, sinMail)
    assert.equal(x.extraccion.cliente.cliente_crm, null)
    assert.ok(x.ajustes.some(a => /no coinciden/.test(a)))
    x = extraccionDe({ cliente: { nombre_escuchado: 'Ana', cliente_crm: 'ana perez', id_crm: null } }, sinMail)
    assert.equal(x.extraccion.cliente.cliente_crm, 'Ana Pérez', 'nombre normalizado → el canónico del CRM')
    assert.equal(x.extraccion.cliente.id_crm, 'A101')
    assert.deepEqual(x.extraccion.cliente.cuentas, ['act_999'])
    const sinLista = cx({ conocidos: [], emailsInvitados: [] })
    assert.equal(extraccionDe({}, sinLista).extraccion.cliente.cliente_crm, null, 'sin lista del CRM nunca hay cliente verificado')
  })
  test('el mail del invitado externo cruza con el CRM (y le gana a lo que dijo Claude)', () => {
    let x = extraccionDe({ cliente: { nombre_escuchado: 'Anita', cliente_crm: null, id_crm: null } })
    assert.equal(x.extraccion.cliente.cliente_crm, 'Ana Pérez')
    assert.equal(x.extraccion.cliente.como, 'email')
    x = extraccionDe({ cliente: { nombre_escuchado: 'Anita', cliente_crm: 'Bruno Díaz', id_crm: 'A102' } })
    assert.equal(x.extraccion.cliente.id_crm, 'A101')
    assert.ok(x.ajustes.some(a => /gana el mail/.test(a)))
    assert.equal(x.extraccion.cliente.email, 'ana@estudio.test')
  })
  test('rama desconocida → null con ajuste; normalizarRama acepta nombres y sinónimos', () => {
    const x = extraccionDe({ rama: { ...salidaClaude().rama, principal: 'derecho_del_mar' } })
    assert.equal(x.extraccion.rama.principal, null)
    assert.ok(x.ajustes.some(a => /rama desconocida/.test(a)))
    assert.equal(extraccionDe({ rama: { ...salidaClaude().rama, principal: 'ninguna' } }).extraccion.rama.principal, null)
    assert.equal(normalizarRama('Laboral'), 'laboral')
    assert.equal(normalizarRama('Tránsito'), 'transito')
    assert.equal(normalizarRama('ART / accidentes de trabajo'), 'art')
    assert.equal(normalizarRama('Ciudadanías'), 'internacional')
    assert.equal(normalizarRama('cualquier cosa'), null)
    assert.equal(normalizarRama(3), null)
  })
  test('presupuesto: un solo monto → min = max; mensual deducido del diario; absurdos → null', () => {
    let x = extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: 8, usd_dia_max: 10, usd_mes: null } })
    assert.equal(x.extraccion.presupuesto.usd_mes, 270)
    assert.equal(x.extraccion.presupuesto.deducido, true)
    assert.ok(x.ajustes.some(a => /mensual calculado/.test(a)))
    x = extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: null, usd_dia_max: 12, usd_mes: 360 } })
    assert.equal(x.extraccion.presupuesto.usd_dia_min, 12)
    assert.equal(x.extraccion.presupuesto.deducido, false, 'min = max no es deducir')
    x = extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: null, usd_dia_max: null, usd_mes: 300 } })
    assert.equal(x.extraccion.presupuesto.usd_dia_min, 10)
    assert.equal(x.extraccion.presupuesto.deducido, true)
    x = extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: -5, usd_dia_max: 999999, usd_mes: null } })
    assert.equal(x.extraccion.presupuesto.usd_dia_min, null)
    assert.equal(x.extraccion.presupuesto.usd_mes, null)
    assert.ok(x.ajustes.filter(a => /fuera de rango/.test(a)).length === 2)
    const inv = normalizarPresupuesto({ ...x.extraccion.presupuesto, usd_dia_min: 12, usd_dia_max: 8, usd_mes: 300 })
    assert.equal(inv.presupuesto.usd_dia_min, 8)
    assert.equal(textoPresupuesto({ ...inv.presupuesto, usd_mes: 300 }), 'USD 8–12 por día (~USD 240–360 por mes)', 'el mensual dentro del rango × 30 → el rango mensual entero')
    // 240 es el de 8 por día: es con cuánto se arranca (revisión del 24/10: Valentino necesita el monto de arranque)
    assert.equal(textoPresupuesto({ ...inv.presupuesto, usd_dia_min: 8, usd_dia_max: 10, usd_mes: 240 }), 'USD 8 por día para arrancar (hasta 10) · ~USD 240 por mes')
    assert.equal(textoPresupuesto({ ...inv.presupuesto, usd_dia_min: 8, usd_dia_max: 10, usd_mes: 240, deducido: true }), 'USD 8–10 por día (~USD 240–300 por mes)', 'deducido: no se sabe con cuánto se arranca')
    assert.equal(textoPresupuesto({ ...inv.presupuesto, usd_dia_min: 10, usd_dia_max: 10, usd_mes: 300 }), 'USD 10 por día (~USD 300 por mes)')
    assert.equal(textoPresupuesto({ ...inv.presupuesto, usd_dia_min: 8, usd_dia_max: 10, usd_mes: 900 }), 'USD 8–10 por día (~USD 900 por mes)', 'fuera del rango se muestra tal cual')
  })
  test('lo que no se dijo viene como "" y los montos como texto ("8", "8,5", "1.500")', () => {
    const x = extraccionDe({
      cliente: { nombre_escuchado: 'Ana', cliente_crm: '', id_crm: '' },
      zona: { ...salidaClaude().zona, radio_km: '', presentarse_como: '' },
      presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: '8', usd_dia_max: '9,5', usd_mes: '1.500', moneda: '' },
      acuerdos: [{ quien: 'Tomás', que: 'guiones', cuando: '', cita: '', timestamp: '' }],
    }, cx({ emailsInvitados: [] }))
    assert.equal(x.extraccion.cliente.cliente_crm, null)
    assert.equal(x.extraccion.zona.radio_km, null)
    assert.equal(x.extraccion.zona.presentarse_como, null)
    assert.equal(x.extraccion.presupuesto.usd_dia_min, 8)
    assert.equal(x.extraccion.presupuesto.usd_dia_max, 9.5)
    assert.equal(x.extraccion.presupuesto.usd_mes, 1500)
    assert.equal(x.extraccion.presupuesto.moneda, null)
    assert.equal(x.extraccion.acuerdos[0].cuando, null)
    assert.ok(!x.ajustes.some(a => /fuera de rango/.test(a)))
    assert.equal(extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: 'diez' } }).extraccion.presupuesto.usd_dia_min, 10, 'texto no numérico → vacío, y queda el máximo')
  })
  test('si no es kickoff no se deduce presupuesto', () => {
    const x = extraccionDe({ tipo_reunion: 'seguimiento', presupuesto: { ...salidaClaude().presupuesto, usd_dia_min: 8, usd_mes: null } })
    assert.equal(x.extraccion.presupuesto.usd_mes, null)
  })
})

describe('schema y mensaje de usuario', () => {
  const todosRequeridos = s => {
    if (s && s.type === 'object') {
      assert.equal(s.additionalProperties, false)
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort())
      Object.values(s.properties).forEach(todosRequeridos)
    }
    if (s && s.type === 'array') todosRequeridos(s.items)
  }
  test('schemas estrictos: additionalProperties false, todo en required, sin uniones con null y $defs resueltos', () => {
    todosRequeridos(SCHEMA_FICHA)
    Object.values(SCHEMA_FICHA.$defs).forEach(todosRequeridos)
    todosRequeridos(SCHEMA_IDEAS)
    const texto = JSON.stringify(SCHEMA_FICHA)
    assert.ok(!texto.includes('"null"'), 'una unión con null agranda la gramática hasta que la API la rechaza')
    for (const [, d] of texto.matchAll(/"#\/\$defs\/(\w+)"/g)) assert.ok(SCHEMA_FICHA.$defs[d], d)
    assert.ok(!/"cita"|"timestamp"/.test(texto), 'la evidencia va junta ("[HH:MM:SS] cita"): separada, la gramática no entra')
    assert.ok(texto.length < 3800, `el schema de k2 entra con poco margen en la gramática (${texto.length} caracteres): probar contra la API antes de agrandarlo`)
    assert.ok(SCHEMA_FICHA.properties.rama.properties.principal.enum.includes('ninguna'))
  })
  test('prompts: texto fijo con versión y las reglas de la kickoff real', () => {
    assert.equal(VERSION_PROMPT, 'k3-2026-10-24')
    assert.equal(VERSION_IDEAS, 'i4-2026-10-25')
    // k3: la kickoff la hacen Tomás o Gero M (quién grabó va en <reunion>); los pendientes no repiten el portfolio
    assert.match(PROMPT_SISTEMA, /la hace Tomás Napolitano o Gerónimo Mozzi \(Gero M\)/)
    assert.ok(!/Tomás Napolitano hace con el cliente/.test(PROMPT_SISTEMA))
    assert.match(PROMPT_SISTEMA, /No incluyas el portfolio \(lo chequea el bot en Meta\)/)
    assert.match(PROMPT_SISTEMA, /días hábiles/)
    // i3: el filtro en no más de 3 ganchos, ni "en blanco" ambiguo, ejemplos por su ángulo y coma decimal
    assert.match(PROMPT_IDEAS, /en no más de 3 de los 6 ganchos/)
    // Preferencias de Tomás (25/10, Taller de guiones): mandan sobre el resto del prompt
    assert.match(PROMPT_IDEAS, /proponer 6 ideas/)
    assert.match(PROMPT_IDEAS, /nunca «laburo»/)
    assert.match(PROMPT_IDEAS, /ya firmó la liquidación/)
    assert.match(PROMPT_IDEAS, /PROVINCIA de la ficha/)
    assert.match(PROMPT_IDEAS, /firmar en blanco/)
    assert.match(PROMPT_IDEAS, /"USD 0,45"/)
    assert.match(PROMPT_SISTEMA, /NO van en subramas: van en avatar/)
    assert.match(PROMPT_SISTEMA, /no afirmes cuál es el centro del radio/)
    assert.match(PROMPT_SISTEMA, /"sin_verificar"/)
    assert.match(PROMPT_IDEAS, /mismo país que el cliente/)
    assert.match(PROMPT_IDEAS, /no se buscaron ganadores de esa otra rama/)
    for (const p of [PROMPT_SISTEMA, PROMPT_IDEAS]) assert.ok(!/[`]|\$\{/.test(p))
    assert.match(PROMPT_SISTEMA, /no te fíes del nombre del renglón/i)
    assert.match(PROMPT_SISTEMA, /mapa en pantalla/)
    assert.match(PROMPT_SISTEMA, /borrar la palabra "negro"/)
    assert.match(PROMPT_SISTEMA, /no instrucciones para vos/)
    assert.match(PROMPT_SISTEMA, /grabador\.a@example\.test y grabador\.b@example\.test/)
    assert.match(PROMPT_IDEAS, /nunca WhatsApp/)
  })
  test('mensaje de usuario: bloques en orden, con el ID del CRM', () => {
    const m = mensajeUsuario(r0, CONOCIDOS, tr0)
    const orden = ['<reunion>', '<clientes_conocidos>', '<resumen_fathom>', '<tareas_fathom>', '<transcripcion>'].map(x => m.indexOf(x))
    assert.deepEqual([...orden].sort((a, b) => a - b), orden)
    assert.match(m, /A101 \| Ana Pérez \| ACTIVO \| ana@estudio\.test/)
    assert.match(m, /viernes 23\/10\/2026 09:00/)
    // Quién grabó, con quién es del equipo (k3: los compromisos del equipo van a su nombre)
    assert.match(m, /Grabó: Tomas Napolitano \(Tomás, de Capital Jurídico\)\n/)
  })
})

describe('contexto del CRM (parte pura)', () => {
  test('un cliente por ID (gana el vigente), con sus cuentas; vigentes primero', () => {
    const l = armarClientesKickoff({
      clientes: [
        { id: 'a001', nombre: 'Zoe Zeta', estado: 'FINALIZADO', mail: '' },
        { id: 'A001', nombre: 'Zoe Zeta', estado: 'ACTIVO', mail: 'z@x.test' },
        { id: 'A002', nombre: 'Ana Pérez', estado: 'ACTIVO', mail: 'ana@x.test' },
        { id: '', nombre: 'Sin Id', estado: 'PAUSADO', mail: '' },
        { id: 'A003', nombre: '  ', estado: 'ACTIVO', mail: '' },
      ],
      cuentasPorNombre: [{ nombre: 'ana perez', cuentas: ['act_1'] }],
    })
    assert.deepEqual(l.map(c => c.id), ['A002', 'A001', ''])
    assert.equal(l[1].estado, 'ACTIVO')
    assert.deepEqual(l[0].cuentas, ['act_1'])
  })
})

// ── Ficha, faltantes y markdown ─────────────────────────────────────────────────────────────────
describe('ficha: faltantes y markdown', () => {
  const gan = elegirGanadores(candidatos(), { excluirCuentas: ['act_999'] })
  const ideas = { estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], ideas: IDEAS_OK, notas: '' }
  test('faltantes calculados en código: mapa, portfolio sin hablar y con faltas', () => {
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe().extraccion, ajustes: [], ideas, ganadores: gan })
    assert.ok(f.faltantes.some(x => /^Zona del mapa: anotar el recorte exacto para la campaña \(se ve en la grabación ▶ \d\d:\d\d; se nombró /.test(x)), f.faltantes.join(' | '))
    assert.ok(f.faltantes.some(x => /tildar a mano.*WhatsApp Business/.test(x)))
    assert.ok(f.faltantes.some(x => /Tarjeta.*falta.*dólares/.test(x)))
    assert.ok(!f.faltantes.some(x => /Cliente sin verificar|Rama principal|Presupuesto sin monto/.test(x)))
  })
  test('ficha vacía: cliente sin verificar, rama, subramas, avatar, zona, presupuesto, ideas', () => {
    const vacia = validarSalida({ tipo_reunion: 'kickoff', cliente: { nombre_escuchado: 'Carla' } }, cx({ conocidos: [], emailsInvitados: [] })).extraccion
    const f = calcularFaltantes({ ...vacia, ideas_guiones: { estado: 'sin_ideas', revisores: [], ideas: [], notas: '', motivo: 'Claude no devolvió ideas válidas' } })
    for (const re of [/Cliente sin verificar.*Carla/, /Rama principal sin definir/, /Subramas/, /Avatar/, /Zona sin definir/, /Presupuesto sin monto/, /Ideas de guiones: no salieron/]) assert.ok(f.some(x => re.test(x)), String(re))
    assert.deepEqual(calcularFaltantes({ ...vacia, tipo_reunion: 'seguimiento', ideas_guiones: { estado: 'no_corresponde', revisores: [], ideas: [], notas: '' } }), [])
  })
  test('presupuesto deducido aparece como faltante para confirmar', () => {
    const ex = extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_mes: null } }).extraccion
    const f = armarFicha({ reunion: r0, extraccion: ex, ajustes: [], ideas, ganadores: gan })
    assert.ok(f.faltantes.some(x => /deducidos/.test(x)))
  })
  test('markdown: secciones, links al momento, ganadores SIN el nombre del otro cliente', () => {
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe().extraccion, ajustes: ['algo corregido'], ideas, ganadores: gan })
    const md = fichaMarkdown(f)
    for (const s of ['# Ficha de kickoff · Ana Pérez (A101)', '## Falta completar (Tomi)', '## Rama', '## Zona', '## Presupuesto', '## Portfolio', '## Ideas de guiones (a revisar: Tomi y Gero M)', '## Ganadores de la rama', '## Ajustes de la validación']) assert.ok(md.includes(s), s)
    assert.match(md, /\[▶ 05:00\]\(https:\/\/fathom\.video\/calls\/111\?timestamp=300\)/)
    assert.ok(!/Cliente Uno|Cliente Dos/.test(md), 'el nombre de otro cliente no va al markdown')
    assert.ok(f.ganadores.lista.every(g => g.cliente), 'pero queda en el JSON')
    assert.match(md, /\| Tarjeta .* \| ⬜ falta \|/)
  })
  test('no kickoff: markdown corto, ideas no_corresponde y ganadores no_pedido', () => {
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe({ tipo_reunion: 'seguimiento' }).extraccion, ajustes: [], ideas: null, ganadores: null })
    assert.equal(f.ideas_guiones.estado, 'no_corresponde')
    assert.equal(f.ganadores.estado, 'no_pedido')
    assert.deepEqual(f.faltantes, [])
    assert.match(fichaMarkdown(f), /No es un kickoff/)
  })
})

// ── Ganadores (parte pura) ──────────────────────────────────────────────────────────────────────
describe('ganadores por rama', () => {
  test('agruparAnuncios: mismo guion en la misma cuenta se suma; mínimos de gasto y mensajes; ordenado por CPL', () => {
    const f = (o) => ({ cuentaId: 'act_1', cliente: 'C', adId: 'x', nombre: '1 - ¿Te echaron? ⬇️', moneda: 'USD', gasto: 15, mensajes: 30, ...o })
    const g = agruparAnuncios([
      f({ adId: 'a' }), f({ adId: 'b', nombre: '¿Te echaron?', gasto: 25 }),                 // 40 USD, 60 mensajes → 0,67
      f({ adId: 'c', nombre: 'Barato', gasto: 30000, moneda: 'ARS', mensajes: 100 }),           // 20 USD, 100 → 0,20
      f({ adId: 'd', nombre: 'Poco gasto', gasto: 5, mensajes: 50 }),                           // no pasa el mínimo de gasto
      f({ adId: 'e', nombre: 'Pocos mensajes', gasto: 100, mensajes: 3 }),                      // no pasa el mínimo de mensajes
      f({ adId: 'f', nombre: 'Moneda rara', moneda: 'XYZ', gasto: 1000, mensajes: 100 }),       // sin cotización: 0 USD
    ], m => (m === 'USD' ? 1 : m === 'ARS' ? 1500 : null))
    assert.deepEqual(g.map(x => x.anuncio), ['Barato', '¿Te echaron?'])
    assert.equal(g[1].adIds.length, 2)
    assert.equal(g[1].adPrincipal, 'b', 'el de más gasto')
    assert.equal(g[1].cplUSD, 0.67)
    assert.equal(limpiarNombreAnuncio('12 - ¿Te despidieron? ⬇️'), '¿Te despidieron?')
  })
  test('elegirGanadores: sin el propio cliente, sin otra rama, máximo 2 por cliente, ids G1…', () => {
    const g = elegirGanadores(candidatos(), { excluirCuentas: ['999'], excluirCliente: 'Ana Pérez' })
    assert.deepEqual(g.lista.map(x => x.id), ['G1', 'G2', 'G3'])
    assert.deepEqual(g.lista.map(x => x.anuncio), ['¿Trabajaste en negro y te echaron?', '¿Firmaste tu liquidación?', '¿Te despidieron y te pagaron menos?'])
    assert.equal(g.estado, 'ok')
    assert.match(g.nota, /1 de otra rama descartados · 1 del propio cliente afuera/)
    assert.equal(g.lista[0].subtema, 'trabajo en negro / en gris')
    assert.equal(g.lista[1].subtema, 'liquidación mal calculada / firmar sin revisar')
  })
  test('pocos datos y sin datos', () => {
    const c = candidatos()
    assert.equal(elegirGanadores({ ...c, candidatos: c.candidatos.slice(0, 2) }).estado, 'pocos_datos')
    assert.equal(elegirGanadores({ ...c, candidatos: [] }).estado, 'sin_datos')
  })
  test('esDeLaRama y ramaProbable', () => {
    assert.equal(esDeLaRama('laboral', '¿Te separaste?', null), false)
    assert.equal(esDeLaRama('laboral', 'cuidado', 'te despidieron'), true)
    assert.equal(esDeLaRama('laboral', 'cuidado', 'algo genérico'), false)
    assert.equal(esDeLaRama('familia', '¿Te separaste?', null), true)
    assert.equal(esDeLaRama('familia', '¿Te despidieron?', null), false)
    assert.equal(ramaProbable('Priorizar los despidos laborales', 'familia'), 'laboral')
    assert.equal(ramaProbable(null, 'una sucesión'), 'sucesiones')
  })
})

// ── Ideas ───────────────────────────────────────────────────────────────────────────────────────
describe('ideas: validación y mensaje', () => {
  const gan = elegirGanadores(candidatos(), { excluirCuentas: ['act_999'] })
  test('más de 6 se recortan; un Gx que no existe queda anotado; sin menciones', () => {
    const muchas = [...IDEAS_OK, { ...IDEAS_OK[0], titulo: 'Sexta' }, { ...IDEAS_OK[0], titulo: '@everyone <@123> idea', por_que: 'G9' }]
    const v = validarIdeas({ ideas: [{ ...IDEAS_OK[0], por_que: 'G9 y G1' }, ...muchas], notas: 'ok' }, gan.lista)
    assert.equal(v.ideas.length, CANTIDAD_IDEAS)
    assert.ok(v.ajustes.some(a => /G9/.test(a)))
    assert.ok(v.ajustes.some(a => /quedan las primeras 6/.test(a)))
    const m = validarIdeas({ ideas: [{ ...IDEAS_OK[0], titulo: '@everyone <@123> idea' }], notas: '' }, gan.lista)
    assert.ok(!/@everyone|<@1/.test(m.ideas[0].titulo))
    assert.ok(m.ajustes.some(a => /vinieron 1 ideas/.test(a)))
    assert.throws(() => validarIdeas('nada', []))
    assert.equal(validarIdeas({ ideas: [{ titulo: '', gancho: 'x' }], notas: '' }, []).ideas.length, 0)
  })
  test('mensaje de ideas: la ficha sin citas, los ganadores SIN el nombre del cliente y la base de la rama', () => {
    const ex = extraccionDe().extraccion
    const m = mensajeIdeas({ ficha: ex, ganadores: gan.lista, kb: kbDeRama('laboral').texto, notaGanadores: gan.nota })
    assert.match(m, /<ficha>[\s\S]*Rama principal: Laboral \(despidos\)[\s\S]*<\/ficha>/)
    assert.match(m, /G1 · «¿Trabajaste en negro y te echaron\?»/)
    assert.ok(!/Cliente Uno|Cliente Dos|act_1\b/.test(m), 'nada que identifique a otros clientes')
    assert.ok(!m.includes('frase número 10'), 'las citas no van')
    assert.match(mensajeIdeas({ ficha: ex, ganadores: [], kb: null, notaGanadores: 'Meta tardó' }), /\(no hay: Meta tardó\)[\s\S]*no hay base de conocimiento/)
  })
  test('la base de laboral no trae nombres de clientes ni ids de docs', () => {
    const kb = kbDeRama('laboral').texto
    for (const n of ['Natalia', 'Salas', 'Oliva', 'Godoy', 'Lopez', 'Ortiz', 'Delaporte', 'Asurmendi', 'NatiS', 'CarlosO', 'DaiG', 'CrisL', 'CrisO', 'FlorDV', 'Jujuy']) assert.ok(!kb.includes(n), n)
    assert.ok(!/[A-Za-z0-9_-]{40,}/.test(kb), 'sin ids de Drive')
    assert.equal(kbDeRama('penal'), null)
    assert.equal(kbDeRama(null), null)
  })
})

// ── Discord ─────────────────────────────────────────────────────────────────────────────────────
describe('aviso de Discord', () => {
  const gan = elegirGanadores(candidatos(), { excluirCuentas: ['act_999'] })
  const fichaCon = (ideas = IDEAS_OK, over = {}) => armarFicha({ reunion: r0, extraccion: extraccionDe(over).extraccion, ajustes: [], ideas: { estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], ideas, notas: '' }, ganadores: gan })
  test('formato: menciona a Tomi y Gero M, rama, zona, presupuesto, ideas y faltantes, con link a la ficha (si hay pantalla)', () => {
    const f = fichaCon()
    const link = linkFicha('https://despacho.ejemplo.test/', f, true)
    assert.equal(link, 'https://despacho.ejemplo.test/clientes/A101/kickoff')
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, link)
    assert.ok(t.startsWith(`<@${TOMI}> <@${GERO}> 📝 **Kickoff · Ana Pérez — ideas de guiones para revisar**`))
    for (const s of ['⚖️ **Rama:** Laboral (despidos)', '📍 **Zona:**', '💵 **Presupuesto:** USD 10 por día', '💡 **Ideas para revisar:**', '1. **Idea 1**', '⚠️ **Falta completar', `(<${link}>)`]) assert.ok(t.includes(s), s)
    assert.ok(!/Cliente Uno|Cliente Dos/.test(t), 'sin nombres de otros clientes')
    assert.ok(t.length <= MAX_DISCORD)
    assert.deepEqual(usuariosMencionados({ tomi: TOMI, gero_m: GERO }), [TOMI, GERO])
  })
  test('sin IDs de Discord: los nombres van en texto y no queda ninguna mención colgada', () => {
    const t = armarAviso(fichaCon(), { tomi: null, gero_m: null }, 'https://x.test/f')
    assert.ok(t.startsWith('Tomi Gero M 📝'))
    assert.ok(!/<@/.test(t))
    assert.deepEqual(usuariosMencionados({ tomi: null, gero_m: GERO }), [GERO])
  })
  test('lo que escribe el modelo no puede mencionar ni romper el formato; siempre ≤ 2000', () => {
    const malas = IDEAS_OK.map(i => ({ ...i, titulo: '@everyone **ojo** <@999999999999999999>', gancho: '@here '.repeat(200) }))
    const f = fichaCon(malas, { resumen_corto: '<@&123> rol', rama: { ...salidaClaude().rama, texto: '@everyone [link](http://malo)' } })
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, 'https://x.test/f')
    assert.ok(t.length <= MAX_DISCORD, String(t.length))
    assert.ok(!/@everyone|@here|<@9|<@&/.test(t), 'menciones neutralizadas')
    assert.equal((t.match(/<@\d+>/g) ?? []).length, 2, 'solo las dos nuestras')
    assert.ok(!/(?<!\\)\]\(http:\/\/malo\)/.test(t), 'sin links del modelo (los corchetes van escapados)')
  })
  test('sin pantalla (o sin ID del CRM): sin link a la ficha, nunca a la API con Bearer; con los pendientes en el aviso', () => {
    const sinId = armarFicha({ reunion: r0, extraccion: extraccionDe({ cliente: { nombre_escuchado: 'X', cliente_crm: null, id_crm: null } }, cx({ emailsInvitados: [] })).extraccion, ajustes: [], ideas: null, ganadores: null })
    assert.equal(linkFicha('https://d.test', sinId, true), null)
    const f = fichaCon(IDEAS_OK, { pendientes: ['confirmar el número de WhatsApp', 'ver la subrama de accidentes', 'verificar El Bordón', 'un cuarto'] })
    assert.equal(linkFicha('https://d.test', f, false), null)
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, null)
    assert.ok(!/Ficha|api\/bot\/kickoff|detalle en la ficha|el detalle está en la ficha/.test(t), t)
    assert.match(t, /❓ \*\*Pendientes \(3 de 4\):\*\* confirmar el número de WhatsApp · ver la subrama de accidentes · verificar El Bordón/)
    assert.ok(!t.includes('un cuarto'))
    // Con pantalla, los pendientes no van (están en la ficha)
    assert.ok(!armarAviso(f, { tomi: TOMI, gero_m: GERO }, 'https://d.test/clientes/A101/kickoff').includes('Pendientes'))
  })
  test('rama con subramas cortas (sin filtros), zona con los lugares primero y al final cómo se presenta; sin cortes a mitad de frase', () => {
    const f = fichaCon(IDEAS_OK, {
      rama: { ...salidaClaude().rama, subramas: [
        { texto: 'Despidos de trabajadores en blanco o parcialmente en blanco (mitad en negro, mitad en blanco) con 1,5 años', cita: '', timestamp: '' },
        { texto: 'Despidos con accidente de trabajo: a confirmar', cita: '', timestamp: '' },
      ] },
      zona: { ...salidaClaude().zona, descripcion: 'Mendoza capital, Godoy Cruz y Mendoza capital otra vez', presentarse_como: 'Mendoza capital', presentarse_cuando: 'si un lead pregunta', presentarse_evidencia: '' },
    })
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, null)
    // La subrama va entera (solo el tema, sin el paréntesis): si no entrara, se saca entera y queda "+N" (24/10)
    // "a confirmar" queda (es una decisión pendiente: el prompt no la repite en los pendientes)
    assert.match(t, /⚖️ \*\*Rama:\*\* Laboral \(despidos\) — subramas: Despidos de trabajadores en blanco o parcialmente en blanco; Despidos con accidente de trabajo \(a confirmar\)\n/)
    assert.ok(!/mitad en negro/.test(t.split('\n').find(l => l.startsWith('⚖️'))), 'los filtros no van en la rama')
    // Primero los lugares (la presentación no es la zona: "📍 Zona: Mendoza capital" se leía como la zona), sin el contexto
    assert.match(t, /📍 \*\*Zona:\*\* Mendoza · Godoy Cruz · radio 20 km · se presenta como «Mendoza capital» · 🗺️/)
    assert.ok(!/si un lead pregunta/.test(t), 'en qué contexto se dijo está en la ficha')
    assert.equal(corto('una frase bastante larga para cortar', 20), 'una frase bastante…')
    assert.equal(subramaCorta('Despidos (en blanco)'), 'Despidos')
    assert.equal(subramaCorta('Despidos de trabajadores en blanco o parcialmente en blanco con 1,5 años o más de antigüedad'), 'Despidos de trabajadores en blanco o parcialmente en blanco con 1,5 años o más de antigüedad', 'sin cortar')
  })
  test('ganadores: cuenta solo los que las ideas citan', () => {
    const ideas = [{ ...IDEAS_OK[0], por_que: 'G1 (USD 0,36) y G2' }, { ...IDEAS_OK[1], por_que: 'G2' }, { ...IDEAS_OK[2], por_que: 'la base' }, { ...IDEAS_OK[3], por_que: 'G9 que no existe' }]
    const f = fichaCon(ideas)
    assert.deepEqual(ganadoresCitados(f), { ids: ['G1', 'G2'], ideas: 2 })
    assert.match(armarAviso(f, { tomi: TOMI, gero_m: GERO }, null), /🏆 2 de 4 ideas se apoyan en 2 ganadores de Laboral \(despidos\) en Meta \(180 días\): G1, G2\n/)
  })
  test('aviso de error: corto, menciona a Tomás, sin URLs ni claves (motivoDe), y dice si la grabación quedó registrada', () => {
    const motivo = motivoDe(new Error('falló https://sheets.googleapis.com/v4/spreadsheets/1AbCdEf/values con sk-ant-api03-abcDEF_123'))
    const t = textoErrorKickoff('Título', 5, motivo, TOMI)
    assert.ok(t.startsWith(`<@${TOMI}> ⚠️`))
    assert.match(t, /reintente el kickoff 5/)
    assert.ok(!/https?:\/\/|sk-ant-|1AbCdEf/.test(t), t)
    const sinFila = textoErrorKickoff('Título', 5, 'la base no respondió', TOMI, { registrada: false })
    assert.ok(!/quedó guardado|reintente el kickoff/.test(sinFila))
    assert.match(sinFila, /no quedó registrada.*reenviala desde Fathom/)
    assert.match(textoErrorKickoff('T', 5, 'x', null, { avisoDudoso: true }), /fijate en el canal si salió/)
    assert.match(textoAvisoSinAnotar('T', 5, 'la base no respondió', TOMI), /ya salió.*No hace falta reintentar/)
  })
})

// ── Orquestador con fakes ─────────────────────────────────────────────────────────────────────────
describe('procesarKickoff', () => {
  test('un cliente archivado después de la llamada no genera ideas, envíos ni tandas nuevas', async () => {
    let tandas = 0
    const { deps, log } = fakes({ clienteOperativo: async () => false, dispararGuiones: async () => { tandas++; return 'disparado' } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(log.ideas.length, 0)
    assert.equal(log.enviar.length, 0)
    assert.equal(tandas, 0)
    assert.ok(log.marcar.some(x => x.estado === 'omitida'))
  })
  test('kickoff → reclama, extrae, guarda la ficha, pide ganadores e ideas, guarda, avisa a Tomi y Gero M y queda lista', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista', r.motivo)
    assert.deepEqual(log.orden, ['reclamar', 'extraer', 'guardarFicha', 'ideas', 'guardarIdeas', 'enviar', 'anotarAviso', 'marcar:lista'])
    assert.equal(log.reclamar[0][2].payload.recording_id, 987654321, 'guarda el payload para reintentar')
    assert.deepEqual(log.candidatos, ['laboral'], 'un solo pedido a Meta (el de la rama probable, que era la de la ficha)')
    assert.deepEqual(log.enviar[0].menciones, [TOMI, GERO])
    assert.ok(log.enviar[0].texto.length <= MAX_DISCORD)
    assert.equal(log.guardarFicha[0].id_crm, 'A101')
    assert.equal(log.guardarFicha[0].version_prompt, VERSION_PROMPT)
    assert.equal(log.guardarIdeas[0].version_ideas, VERSION_IDEAS)
    const g = log.ideas[0].e.ganadores
    assert.ok(g.length >= 3 && g.every(x => x.cuentaId !== 'act_999'), 'sin la cuenta del propio cliente')
    assert.ok(log.ideas[0].e.kb.includes('Guiones de laboral'))
    assert.equal(r.ficha.ideas_guiones.estado, 'a_revisar')
    assert.equal(r.ficha.ganadores.estado, 'ok')
    assert.equal(r.aviso_id, 'msg1')
    assert.deepEqual(r.usage, { extraccion: { input_tokens: 15000, output_tokens: 4000 }, ideas: { input_tokens: 6000, output_tokens: 2000 } })
    assert.ok(log.extraer[0].tope >= MIN_CLAUDE_MS && log.extraer[0].tope <= PLAZO_MS - MARGEN_ENVIO_MS - RESERVA_IDEAS_MS - TOPE_GANADORES_MS)
    assert.ok(MARGEN_ENVIO_MS >= 20_000 + 10_000 + 15_000, 'después de las ideas: guardar (10 s) + Discord (reserva de 20 s) + envío')
    assert.equal(log.marcar.at(-1).ficha.recording_id, 987654321)
    assert.equal(log.avisar.length, 0)
  })
  test('27/10: con la ficha lista y con ideas, arranca sola la tanda de guiones (después del aviso y de marcar lista; una vez)', async () => {
    const disparos = []
    const { deps, log } = fakes({ dispararGuiones: async id => { log.orden.push('guiones'); disparos.push(id); return 'disparado' } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista', r.motivo)
    assert.deepEqual(disparos, [987654321])
    assert.equal(log.orden.at(-1), 'guiones')
    assert.ok(log.orden.indexOf('marcar:lista') < log.orden.indexOf('guiones'))
    assert.equal(r.guiones, 'disparado')
  })
  test('27/10: la tanda NO arranca en seco, sin ideas, si no es kickoff, ni sin la dependencia; un disparo que falla no rompe la ficha', async () => {
    const correr = async (over, payload = reunion(), op = {}) => {
      const disparos = []
      const { deps } = fakes({ dispararGuiones: async id => { disparos.push(id); return 'disparado' }, ...over })
      const r = await procesarKickoff(payload, deps, op)
      return { r, disparos }
    }
    let x = await correr({}, reunion(), { dry: true })
    assert.equal(x.r.estado, 'dry'); assert.deepEqual(x.disparos, [])
    x = await correr({ ideas: async () => ({ ...resultadoIdeas(), ideas: [] }) })
    assert.equal(x.r.estado, 'lista'); assert.deepEqual(x.disparos, []); assert.equal(x.r.guiones, undefined)
    x = await correr({ extraer: async () => resultadoExtraccion({ tipo_reunion: 'seguimiento' }) }, reunion({ default_summary: { template_name: null, markdown_formatted: 'Revisión de resultados.' }, transcript: renglones(40).map(y => ({ ...y, text: 'resultados de la campaña' })) }))
    assert.equal(x.r.estado, 'no_kickoff'); assert.deepEqual(x.disparos, [])
    const { deps } = fakes()
    assert.equal((await procesarKickoff(reunion(), deps)).guiones, undefined, 'sin dispararGuiones (apagado): nada')
    const mal = fakes({ dispararGuiones: async () => { throw new Error('red caída') } })
    const r = await procesarKickoff(reunion(), mal.deps)
    assert.equal(r.estado, 'lista'); assert.match(r.guiones, /^error: /)
  })
  test('seguimiento → no_kickoff: sin ganadores, sin ideas ni aviso', async () => {
    const { deps, log } = fakes({ extraer: async () => resultadoExtraccion({ tipo_reunion: 'seguimiento' }) })
    const r = await procesarKickoff(reunion({ default_summary: { template_name: null, markdown_formatted: 'Revisión de resultados.' }, transcript: renglones(40).map(x => ({ ...x, text: 'resultados de la campaña' })) }), deps)
    assert.equal(r.estado, 'no_kickoff')
    assert.equal(log.ideas.length, 0)
    assert.equal(log.enviar.length, 0)
    assert.deepEqual(log.candidatos, [], 'sin rama probable no se le pide nada a Meta')
    assert.equal(log.marcar[0].estado, 'no_kickoff')
    assert.equal(r.mensaje, null)
  })
  test('duplicada: si no se pudo reclamar no hace nada más', async () => {
    const { deps, log } = fakes({ reclamar: async () => null })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'duplicada')
    assert.equal(log.extraer.length + log.ideas.length + log.enviar.length + log.marcar.length + log.contexto, 0)
  })
  test('retomar: con la ficha y las ideas guardadas (misma versión) no se llama a Claude; con el aviso ya salido, no se repite', async () => {
    const primero = fakes()
    await procesarKickoff(reunion(), primero.deps)
    const guardado = {
      intentos: 2, error_previo: 'algo', ficha: primero.log.guardarFicha[0].ficha, ideas: primero.log.guardarIdeas[0].ideas,
      version_prompt: VERSION_PROMPT, version_ideas: VERSION_IDEAS, modelo: 'claude-opus-5-5', tokens_in: 1, tokens_out: 1, aviso_discord: 'msg1',
    }
    const { deps, log } = fakes({ reclamar: async () => guardado })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual(r.reutilizado, { ficha: true, ideas: true })
    assert.equal(log.extraer.length + log.ideas.length + log.enviar.length, 0)
    assert.equal(log.marcar[0].estado, 'lista')
    // Otra versión del prompt: se vuelve a extraer
    assert.equal(fichaGuardada({ ...guardado, version_prompt: 'k0' }, false), null)
    assert.equal(fichaGuardada(guardado, true), null, 'con forzar no se reusa')
    assert.equal(fichaGuardada({ ...guardado, ficha: { tipo_reunion: 'kickoff' } }, false), null, 'forma rara: no se reusa')
  })
  test('Claude caído (definitivo) → error, registro en error y UN aviso a Tomás; sin ideas ni aviso de ficha', async () => {
    const { deps, log } = fakes({ extraer: async () => { throw new Error('Claude respondió 400 (invalid_request_error)') } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'error')
    assert.match(r.motivo, /400/)
    assert.equal(log.marcar.at(-1).estado, 'error')
    assert.equal(log.avisar.length, 1)
    assert.ok(log.avisar[0].startsWith(`<@${TOMI}> ⚠️`))
    assert.equal(log.enviar.length + log.ideas.length, 0)
  })
  test('Claude con error pasajero: espera y reintenta UNA vez el paso', async () => {
    let n = 0
    const { deps, log } = fakes({ extraer: async () => { if (++n === 1) throw new ErrorTransitorio('Claude respondió 529 (overloaded_error)'); return resultadoExtraccion() } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.equal(n, 2)
    assert.ok(log.esperas.includes(6000))
    assert.equal(log.contexto, 1, 'el CRM no se vuelve a leer')
  })
  test('las ideas fallan → error, pero la ficha ya quedó guardada (un reintento la reusa)', async () => {
    const { deps, log } = fakes({ ideas: async () => { throw new Error('Claude rechazó las ideas (categoría x)') } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'error')
    assert.equal(log.guardarFicha.length, 1)
    assert.equal(log.enviar.length, 0)
  })
  test('Meta caído → sigue sin ganadores y lo anota; Meta lento (> tope) → igual', async () => {
    let { deps, log } = fakes({ candidatos: async () => { throw new Error('falta META_CLIENTES_TOKEN') } })
    let r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.equal(r.ficha.ganadores.estado, 'error')
    assert.match(r.ficha.ganadores.nota, /META_CLIENTES_TOKEN/)
    assert.deepEqual(log.ideas[0].e.ganadores, [])
    assert.match(log.enviar[0].texto, /Sin ganadores de Meta/)
    ;({ deps, log } = fakes({ candidatos: () => new Promise(() => {}), topeGanadoresMs: 20 }))
    r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.match(r.ficha.ganadores.nota, /tardó más de/)
  })
  test('la rama de la ficha no es la probable: se piden los ganadores de la de la ficha', async () => {
    const { deps, log } = fakes({ extraer: async () => resultadoExtraccion({ rama: { ...salidaClaude().rama, principal: 'familia' } }), candidatos: async rama => { log.candidatos.push(rama); return candidatos({ rama }) } })
    const r = await procesarKickoff(reunion(), deps)
    assert.deepEqual(log.candidatos, ['laboral', 'familia'])
    assert.equal(r.ficha.rama.principal, 'familia')
    assert.ok(r.ficha.ajustes.some(a => /sin base de conocimiento para la rama familia/.test(a)))
  })
  test('sin rama principal: no se buscan ganadores, las ideas salen igual', async () => {
    const { deps, log } = fakes({ extraer: async () => resultadoExtraccion({ rama: { ...salidaClaude().rama, principal: 'ninguna' } }) })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.ficha.ganadores.estado, 'sin_rama')
    assert.equal(log.ideas.length, 1)
  })
  test('dry: no toca la base ni Discord y devuelve ficha, markdown y mensaje', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff(reunion(), deps, { dry: true })
    assert.equal(r.estado, 'dry')
    assert.equal(log.reclamar.length + log.guardarFicha.length + log.guardarIdeas.length + log.marcar.length + log.enviar.length + log.anotarAviso.length + log.avisar.length, 0)
    assert.ok(r.mensaje.includes('📝 **Kickoff · Ana Pérez'))
    assert.match(r.markdown, /# Ficha de kickoff/)
    // Un error en dry tampoco avisa ni marca
    const { deps: d2, log: l2 } = fakes({ extraer: async () => { throw new Error('x') } })
    assert.equal((await procesarKickoff(reunion(), d2, { dry: true })).estado, 'error')
    assert.equal(l2.avisar.length + l2.marcar.length, 0)
  })
  test('sin transcripción → error con aviso de Transcript (una vez); corta → omitida sin Claude', async () => {
    let { deps, log } = fakes()
    let r = await procesarKickoff(reunion({ transcript: null }), deps)
    assert.equal(r.estado, 'error')
    assert.match(log.avisar[0], /activá Transcript/)
    ;({ deps, log } = fakes({ reclamar: async () => ({ intentos: 2, error_previo: 'sin_transcripcion: x', ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null }) }))
    await procesarKickoff(reunion({ transcript: null }), deps)
    assert.equal(log.avisar.length, 0, 'la segunda vez ya no avisa')
    ;({ deps, log } = fakes())
    r = await procesarKickoff(reunion({ transcript: renglones(4) }), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(log.extraer.length, 0)
    r = await procesarKickoff(reunion({ recording_end_time: '2026-10-23T12:02:00Z', transcript: renglones(10, 5) }), deps)
    assert.equal(r.estado, 'omitida')
  })
  test('sin webhook de Discord: error antes de gastar en Claude; payload inválido: no hace nada', async () => {
    const { deps, log } = fakes({ discordListo: false })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'error')
    assert.match(r.motivo, /DISCORD_WEBHOOK_KICKOFF/)
    assert.equal(log.extraer.length, 0)
    assert.equal((await procesarKickoff({ recording_id: 'x' }, fakes().deps)).estado, 'invalida')
    assert.equal((await procesarKickoff(reunion({ url: 'https://otro.test/x' }), fakes().deps)).estado, 'invalida')
  })
  test('Discord publicó pero la base no anotó el aviso: error con el id, aviso distinto a Tomás y el reintento NO lo repite', async () => {
    const { deps, log } = fakes({ anotarAviso: async () => { throw new Error('la base dijo que no') } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'error')
    assert.equal(log.enviar.length, 1)
    const error = log.marcar.at(-1).error
    assert.ok(error.startsWith(`${PREFIJO_AVISO_ENVIADO}msg1 `), error)
    assert.equal(avisoDeErrorPrevio(error), 'msg1')
    assert.match(log.avisar[0], /ya salió.*No hace falta reintentar/)
    // Reintento: misma ficha e ideas guardadas, aviso_discord NULL pero el error dice que salió
    const guardado = { intentos: 2, error_previo: error, ficha: log.guardarFicha[0].ficha, ideas: log.guardarIdeas[0].ideas, version_prompt: VERSION_PROMPT, version_ideas: VERSION_IDEAS, modelo: 'claude-opus-5-5', tokens_in: 1, tokens_out: 1, aviso_discord: null }
    const otro = fakes({ reclamar: async () => guardado })
    const r2 = await procesarKickoff(reunion(), otro.deps)
    assert.equal(r2.estado, 'lista')
    assert.equal(otro.log.enviar.length, 0, 'no se vuelve a mandar')
    assert.deepEqual(otro.log.anotarAviso, [{ id: 987654321, m: 'msg1' }])
    assert.equal(r2.aviso_id, 'msg1')
    // Con forzar sí se manda de nuevo
    const tercero = fakes({ reclamar: async () => ({ ...guardado, ficha: null, ideas: null }) })
    await procesarKickoff(reunion(), tercero.deps, { forzar: true })
    assert.equal(tercero.log.enviar.length, 1)
  })
  test('Discord sin respuesta (timeout): no se reintenta el POST y a Tomás le llega que el aviso es dudoso', async () => {
    let n = 0
    const { deps, log } = fakes({ enviar: async () => { n++; throw Object.assign(new Error('Discord no respondió en 15 s'), { transitorio: true }) } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'error')
    assert.equal(n, 1, 'un timeout puede haber publicado: un segundo POST duplicaría')
    assert.match(log.avisar[0], /fijate en el canal si salió/)
  })
  test('ficha re-extraída (otra versión del prompt): las ideas guardadas NO se reusan', async () => {
    const primero = fakes()
    await procesarKickoff(reunion(), primero.deps)
    const guardado = {
      intentos: 2, error_previo: 'algo', ficha: primero.log.guardarFicha[0].ficha, ideas: primero.log.guardarIdeas[0].ideas,
      version_prompt: 'k0-vieja', version_ideas: VERSION_IDEAS, modelo: 'claude-opus-5-5', tokens_in: 1, tokens_out: 1, aviso_discord: null,
    }
    const { deps, log } = fakes({ reclamar: async () => guardado, extraer: async () => resultadoExtraccion({ rama: { ...salidaClaude().rama, principal: 'familia' } }) })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual(r.reutilizado, { ficha: false, ideas: false })
    assert.equal(log.ideas.length, 1, 'se vuelven a pedir con la ficha nueva')
    assert.equal(r.ficha.rama.principal, 'familia')
  })
  test('si reclamar falla (base caída): el aviso a Tomás no dice que quedó guardado', async () => {
    const { deps, log } = fakes({ reclamar: async () => { throw new Error('Error connecting to database: fetch failed') } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'error')
    assert.equal(log.marcar.length, 0)
    assert.match(log.avisar[0], /no quedó registrada/)
    assert.ok(!/quedó guardado/.test(log.avisar[0]))
  })
  test('el fin agendado del payload se guarda para reintentar y, si la grabación cortó mucho antes, va como nota (no como faltante)', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff({ ...reunion(), scheduled_end_time: '2026-10-23T12:45:00Z' }, deps)
    assert.equal(log.reclamar[0][2].payload.scheduled_end_time, '2026-10-23T12:45:00Z')
    assert.equal(notaCorteGrabacion(r.ficha), 'La grabación cortó a las 09:22; el evento iba hasta las 09:45')
    assert.ok(!r.ficha.faltantes.some(x => /cortó|terminó a las/.test(x)), 'quien hizo la llamada sabe si hubo algo después: no es para completar')
    assert.match(r.markdown, /⏱️ La grabación cortó a las 09:22; el evento iba hasta las 09:45/)
    const sinCorte = await procesarKickoff({ ...reunion(), scheduled_end_time: '2026-10-23T12:25:00Z' }, fakes().deps)
    assert.equal(notaCorteGrabacion(sinCorte.ficha), null)
  })
})

// ── Claude con un fetch falso (stream SSE armado acá) ─────────────────────────────────────────────
describe('extraerFicha con un fetch falso', () => {
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
  const conApi = async (cuerpo, fn, clave = 'BOT_ANTHROPIC_API_KEY') => {
    const original = globalThis.fetch
    const pedidos = []
    process.env[clave] = 'sk-ant-de-prueba'
    globalThis.fetch = async (url, init) => {
      pedidos.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
      return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    try { return await fn(pedidos) } finally { globalThis.fetch = original; delete process.env[clave] }
  }
  const e = { reunion: r0, transcripcion: tr0, clientes: CONOCIDOS }
  test('pedido: Opus 5.5, thinking adaptativo, esfuerzo high, schema estricto, fallback, streaming; la clave de Vercel sirve', async () => {
    await conApi(sse('end_turn', JSON.stringify(salidaClaude())), async pedidos => {
      const res = await extraerFicha(e)
      assert.equal(res.extraccion.cliente.id_crm, 'A101')
      assert.deepEqual(res.usage, { input_tokens: 900, output_tokens: 70 })
      const [p] = pedidos
      assert.equal(pedidos.length, 1)
      assert.match(p.url, /\/v1\/messages\?beta=true$/)
      assert.equal(p.headers.get('x-api-key'), 'sk-ant-de-prueba')
      assert.equal(p.headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01')
      assert.equal(p.body.model, 'claude-opus-5-5')
      assert.equal(p.body.stream, true)
      assert.equal(p.body.fallbacks, 'default')
      assert.deepEqual(p.body.thinking, { type: 'adaptive' })
      assert.equal(p.body.output_config.effort, 'high')
      assert.deepEqual(p.body.output_config.format, { type: 'json_schema', schema: JSON.parse(JSON.stringify(SCHEMA_FICHA)) })
      assert.equal(p.body.system, PROMPT_SISTEMA)
      assert.ok(!('temperature' in p.body) && !('top_p' in p.body))
    })
  })
  test('KICKOFF_ESFUERZO y KICKOFF_MODELO pisan los de por defecto', async () => {
    process.env.KICKOFF_ESFUERZO = 'medium'; process.env.KICKOFF_MODELO = 'claude-otro'
    try {
      await conApi(sse('end_turn', JSON.stringify(salidaClaude())), async pedidos => {
        await extraerFicha(e)
        assert.equal(pedidos[0].body.output_config.effort, 'medium')
        assert.equal(pedidos[0].body.model, 'claude-otro')
      }, 'ANTHROPIC_API_KEY')
    } finally { delete process.env.KICKOFF_ESFUERZO; delete process.env.KICKOFF_MODELO }
  })
  test('rechazo, max_tokens y JSON roto: error, nunca un resultado a medias; sin clave: error sin llamar', async () => {
    await conApi(sse('refusal', '', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }), () => assert.rejects(extraerFicha(e), /rechazó la ficha \(categoría cyber\)/))
    await conApi(sse('max_tokens', '{"tipo_reunion":'), () => assert.rejects(extraerFicha(e), /max_tokens/))
    await conApi(sse('end_turn', 'no es json'), () => assert.rejects(extraerFicha(e), /JSON válido/))
    await assert.rejects(extraerFicha(e), /falta ANTHROPIC_API_KEY/)
  })
  test('529 → transitorio (sin reintentos del SDK); 400 → definitivo', async () => {
    const conEstado = async (status, fn) => {
      const original = globalThis.fetch
      process.env.ANTHROPIC_API_KEY = 'sk-ant-de-prueba'
      let n = 0
      globalThis.fetch = async () => { n++; return new Response(JSON.stringify({ type: 'error', error: { type: status === 529 ? 'overloaded_error' : 'invalid_request_error', message: 'x' } }), { status, headers: { 'content-type': 'application/json' } }) }
      try { await fn(); return n } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY }
    }
    assert.equal(await conEstado(529, () => assert.rejects(extraerFicha(e), x => x instanceof ErrorTransitorio)), 1)
    await conEstado(400, () => assert.rejects(extraerFicha(e), x => !x.transitorio && /400/.test(x.message)))
  })
})

// ── La ruta: todo lo que tiene que rechazar (sin llegar a after(), la base, Claude ni Discord) ──
describe('app/api/bot/kickoff: falla cerrado', async () => {
  const { GET, POST } = await import('../app/api/bot/kickoff/route.ts')
  const URL_RUTA = 'http://localhost:3101/api/bot/kickoff'
  const CRON = 'cron-de-prueba-' + randomBytes(8).toString('hex')
  const cuerpo = JSON.stringify(reunion())
  const firmado = (c = cuerpo, ts = String(Math.floor(Date.now() / 1000))) => ({ 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': firmar(SECRETO, 'msg_1', ts, c) })
  const post = (headers, body = cuerpo, qs = '') => POST(new Request(URL_RUTA + qs, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }))
  beforeEach(() => { process.env.CRON_SECRET = CRON; delete process.env.FATHOM_KICKOFF_WEBHOOK_SECRET; delete process.env.FATHOM_WEBHOOK_SECRET; delete process.env.DATABASE_URL })

  test('sin cabeceras de webhook ni Bearer: 401; ?key= no sirve', async () => {
    assert.equal((await post({})).status, 401)
    assert.equal((await post({}, cuerpo, `?key=${CRON}`)).status, 401)
    assert.equal((await post({ authorization: 'Bearer otra' })).status, 401)
  })
  test('webhook sin FATHOM_KICKOFF_WEBHOOK_SECRET: 503 (aunque esté el secreto de fathom-anuncios)', async () => {
    process.env.FATHOM_WEBHOOK_SECRET = SECRETO
    const r = await post(firmado())
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'no configurado' })
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET = 'whsec_no es base64!'
    assert.equal((await post(firmado())).status, 503)
  })
  test('firma inválida, timestamp viejo o cuerpo tocado: 401; el Bearer no saltea la firma', async () => {
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET = SECRETO
    assert.equal((await post({ ...firmado(), 'webhook-signature': 'v1,abc' })).status, 401)
    assert.equal((await post(firmado(cuerpo, String(Math.floor(Date.now() / 1000) - 600)))).status, 401)
    assert.equal((await post(firmado(), cuerpo.replace('ANA', 'ANO'))).status, 401)
    assert.equal((await post({ ...firmado(), 'webhook-signature': 'v1,abc', authorization: `Bearer ${CRON}` })).status, 401)
  })
  test('firma válida con JSON roto, payload inválido o url que no es de Fathom: 400', async () => {
    process.env.FATHOM_KICKOFF_WEBHOOK_SECRET = SECRETO
    assert.equal((await post(firmado('{no'), '{no')).status, 400)
    const malo = JSON.stringify(reunion({ url: 'https://otro.test/calls/1' }))
    const r = await post(firmado(malo), malo)
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /fathom\.video/)
  })
  test('modo manual con Bearer: JSON roto o payload inválido → 400; ?recording_id= sin base → 503; id inválido → 400', async () => {
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, '{no', '?dry=1')).status, 400)
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, JSON.stringify({ recording_id: 1, url: 'http://x' }), '?dry=1')).status, 400)
    assert.equal((await post({ authorization: `Bearer ${CRON}` }, '', '?recording_id=abc')).status, 400)
    const r = await post({ authorization: `Bearer ${CRON}` }, '', '?recording_id=123')
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'falta DATABASE_URL' })
  })
  test('GET: 401 sin Bearer; con Bearer dice qué falta configurar', async () => {
    assert.equal((await GET(new Request(URL_RUTA))).status, 401)
    assert.equal((await GET(new Request(`${URL_RUTA}?key=${CRON}`))).status, 401)
    const r = await GET(new Request(URL_RUTA, { headers: { authorization: `Bearer ${CRON}` } }))
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await r.json(), { configurado: { anthropic: false, firma_fathom: false, discord: false, tomi: false, gero_m: false, meta: false, base: false }, ultimas: [] })
    assert.equal((await GET(new Request(`${URL_RUTA}?recording_id=5`, { headers: { authorization: `Bearer ${CRON}` } }))).status, 503)
    assert.equal((await GET(new Request(`${URL_RUTA}?recording_id=x`, { headers: { authorization: `Bearer ${CRON}` } }))).status, 400)
  })
})

// ── Revisión de la prueba de Laura (24/10): lo que se corrigió ─────────────────────────────────────
describe('extracción: cita en su renglón, segundo estimado, portfolio sin verificar, zona y mensual', () => {
  // Un renglón largo (como los de 2 minutos de Fathom) y el siguiente a los 120 s
  const texto = [
    '[00:00:00] Tomas Napolitano: arranque de la llamada con una frase cualquiera',
    `[00:01:00] Abogada Ana Pérez: ${Array.from({ length: 30 }, (_, i) => `relleno${i}`).join(' ')} hasta Godoy Cruz y Las Heras ${Array.from({ length: 30 }, (_, i) => `cola${i}`).join(' ')}`,
    '[00:03:00] Tomas Napolitano: el siguiente renglón empieza acá',
  ].join('\n')
  const rs = renglonesNorm(texto)
  test('partirEvidencia: "[HH:MM:SS] cita" (con o sin corchetes y comillas); sin timestamp, todo es cita', () => {
    assert.deepEqual(partirEvidencia('[00:12:00] le voy a dar prioridad'), { cita: 'le voy a dar prioridad', timestamp: '00:12:00' })
    assert.deepEqual(partirEvidencia('0:12:00 — «hasta acá»'), { cita: 'hasta acá', timestamp: '00:12:00' })
    assert.deepEqual(partirEvidencia('"sin hora"'), { cita: 'sin hora', timestamp: '' })
    // validarSalida con la forma del schema (evidencia junta)
    const x = extraccionDe({ rama: { ...salidaClaude().rama, cita: undefined, timestamp: undefined, evidencia: '[00:05:00] frase número 10 de la llamada' } })
    assert.equal(x.extraccion.rama.timestamp, '00:05:00')
    assert.equal(x.extraccion.rama.textual, true)
  })
  test('renglonesNorm y ubicarCita: en su renglón o en el de al lado; aprox interpolado dentro del renglón', () => {
    assert.deepEqual(rs.map(r => r.s), [0, 60, 180])
    const u = ubicarCita('hasta Godoy Cruz y Las Heras', '00:01:00', rs)
    assert.equal(u.en_renglon, true)
    const seg = Number(u.aprox.slice(3, 5)) * 60 + Number(u.aprox.slice(6))
    assert.ok(seg >= 105 && seg <= 135, `a mitad del renglón (entre 01:00 y 03:00), cerca de 02:00: ${u.aprox}`)
    assert.equal(ubicarCita('el siguiente renglón empieza', '00:01:00', rs).en_renglon, true, 'el de al lado cuenta')
    assert.equal(ubicarCita('arranque de la llamada', '00:03:00', rs).en_renglon, false, 'dos renglones más allá: no')
    assert.equal(ubicarCita('arranque de la llamada', '00:00:00', rs).aprox, null, 'al principio del renglón no hace falta')
    assert.equal(ubicarCita('el siguiente renglón', '00:03:00', rs).aprox, null, 'el último renglón no se puede interpolar')
  })
  test('validarSalida: cita fuera de su renglón → ajuste; aprox en la evidencia; el link del markdown va con "≈"', () => {
    const ctx = cx({ renglones: renglonesNorm(tr0.texto) })
    const x = extraccionDe({ rama: { ...salidaClaude().rama, cita: 'frase número 30 de la llamada', timestamp: '00:05:00' } }, ctx)
    assert.ok(x.ajustes.some(a => /fuera del renglón de su timestamp/.test(a)), x.ajustes.join(' | '))
    const f = armarFicha({ reunion: r0, extraccion: { ...x.extraccion, rama: { ...x.extraccion.rama, aprox: '00:05:20' } }, ajustes: [], ideas: null, ganadores: null })
    assert.match(fichaMarkdown(f), /\[▶ ≈05:20\]\(https:\/\/fathom\.video\/calls\/111\?timestamp=320\)/)
  })
  test('portfolio: "no se habló" con cita → sin_verificar (y va a los faltantes como mencionado)', () => {
    const x = extraccionDe({ portfolio: [{ item: 'tarjeta', estado: 'no_se_hablo', detalle: 'solo un consejo', cita: 'frase número 22 de la llamada', timestamp: '00:11:00' }, { item: 'instagram', estado: 'sin_verificar', detalle: '', cita: '', timestamp: '' }] })
    assert.equal(x.extraccion.portfolio.tarjeta.estado, 'sin_verificar')
    assert.equal(x.extraccion.portfolio.instagram.estado, 'sin_verificar')
    assert.ok(x.ajustes.some(a => /tarjeta.*sin verificar/.test(a)))
    const falt = calcularFaltantes({ ...x.extraccion, ideas_guiones: { estado: 'a_revisar', revisores: [], ideas: IDEAS_OK, notas: '' } })
    assert.ok(falt.some(l => /^Portfolio para tildar a mano \(sin chequeo de Meta y en la llamada no se confirmaron\): los 7 ítems \(Instagram y Tarjeta solo se nombraron\)$/.test(l)), falt.join(' | '))
    const algo = calcularFaltantes({ ...x.extraccion, portfolio: { ...x.extraccion.portfolio, pagina_facebook: { ...x.extraccion.portfolio.pagina_facebook, estado: 'ok' } }, ideas_guiones: { estado: 'a_revisar', revisores: [], ideas: IDEAS_OK, notas: '' } })
    assert.ok(algo.some(l => /^Portfolio para tildar a mano \(sin chequeo de Meta y en la llamada no se confirmaron\): Instagram, WhatsApp Business, Portfolio comercial, Tarjeta, Verificación \/ resumen de la cuenta y Accesos del equipo \(Instagram y Tarjeta solo se nombraron\)$/.test(l)), algo.join(' | '))
  })
  test('con chequeo de Meta: a mano solo lo que ni Meta ni la llamada resolvieron, y lo que Meta da en falta va aparte', () => {
    const ex = validarSalida({ tipo_reunion: 'kickoff', cliente: { nombre_escuchado: 'Ana', cliente_crm: 'Ana Pérez', id_crm: 'A101' } }, cx()).extraccion
    const meta = paraFicha(lecturaMeta({ items: { accesos_equipo: { estado: 'falta', detalle: 'falta Valentino' } } }))
    const f = armarFicha({ reunion: r0, extraccion: ex, ajustes: [], ideas: { estado: 'a_revisar', revisores: [], ideas: IDEAS_OK, notas: '' }, ganadores: null, portfolioMeta: meta })
    const aMano = f.faltantes.find(l => /tildar a mano/.test(l))
    assert.equal(aMano, 'Portfolio para tildar a mano (Meta no los pudo leer y en la llamada no se confirmaron): Instagram y WhatsApp Business', f.faltantes.join(' | '))
    assert.ok(f.faltantes.some(l => /^Portfolio · Accesos del equipo \(Gero A y Valentino\): falta según Meta \(falta Valentino\)$/.test(l)), f.faltantes.join(' | '))
  })
  test('zona: presentarse_como con su contexto y su cita, contexto, país; mensual con su propia evidencia; apodo', () => {
    const x = extraccionDe({
      cliente: { nombre_escuchado: 'Ana Pérez', apodo: 'Anita', cliente_crm: 'Ana Pérez', id_crm: 'A101' },
      zona: { ...salidaClaude().zona, presentarse_cuando: 'si un lead pregunta', presentarse_evidencia: '[00:08:00] «frase número 16 de la llamada»', contexto: [{ texto: 'el estudio está a 60 km; acepta viajar', evidencia: '' }] },
      presupuesto: { ...salidaClaude().presupuesto, evidencia_mes: '[00:09:30] frase número 19 de la llamada' },
    })
    const z = x.extraccion.zona
    assert.deepEqual({ texto: z.presentarse_como.texto, cuando: z.presentarse_como.cuando, ts: z.presentarse_como.timestamp, textual: z.presentarse_como.textual }, { texto: 'Mendoza capital', cuando: 'si un lead pregunta', ts: '00:08:00', textual: true })
    assert.equal(z.pais, 'AR', 'lo deduce el código de la zona (Mendoza)')
    assert.equal(z.contexto[0].texto, 'el estudio está a 60 km; acepta viajar')
    assert.equal(x.extraccion.presupuesto.evidencia_mes.timestamp, '00:09:30')
    assert.equal(x.extraccion.presupuesto.evidencia_mes.textual, true)
    assert.equal(x.extraccion.cliente.apodo, 'Anita')
    assert.equal(extraccionDe({ zona: { ...salidaClaude().zona, descripcion: 'Montevideo y Canelones', lugares: ['Montevideo'], presentarse_como: '' } }).extraccion.zona.pais, 'UY')
    assert.equal(extraccionDe().extraccion.presupuesto.evidencia_mes, null)
    const md = fichaMarkdown(armarFicha({ reunion: r0, extraccion: x.extraccion, ajustes: [], ideas: null, ganadores: null }))
    assert.match(md, /Se presenta como: «Mendoza capital» \(si un lead pregunta\) \[▶ 08:00\]/)
    assert.match(md, /le dicen «Anita»/)
    assert.match(md, /El mensual se dijo aparte: \[▶ 09:30\]/)
  })
})

describe('ganadores: país y anonimización', () => {
  test('paisDeCuenta: moneda de un país, o el país o la provincia en el nombre de las campañas; dos países → sin dato', () => {
    assert.equal(paisDeCuenta('UYU', ['[DM][ABO][BSAS]']), 'UY', 'la moneda manda')
    assert.equal(paisDeCuenta('ARS', []), 'AR')
    assert.equal(paisDeCuenta('USD', ['[DM][Bahia][ABO][TEST] [$300]']), 'AR')
    assert.equal(paisDeCuenta('USD', ['[DM][ABO][URUGUAY][$200]']), 'UY')
    assert.equal(paisDeCuenta('USD', ['[D.LABORAL] | [DM-WPP | [ABO]']), null)
    assert.equal(paisDeCuenta('USD', ['[DM][ABO][URUGUAY]', '[DM][ABO][CORDOBA]']), null)
    assert.equal(paisDeTexto('Media Agua, San Juan'), 'AR')
  })
  test('elegirGanadores con país: primero los del mismo país, después sin dato; los de otro país solo para llegar a 3, marcados', () => {
    const base = candidatos()
    const conPais = { ...base, candidatos: base.candidatos.map(x => ({ ...x, pais: x.cuentaId === 'act_2' ? 'AR' : x.cuentaId === 'act_1' ? 'UY' : null })) }
    let g = elegirGanadores(conPais, { excluirCuentas: ['act_999'], pais: 'AR' })
    assert.deepEqual(g.lista.map(x => [x.anuncio, x.pais]), [['¿Te despidieron y te pagaron menos?', 'AR'], ['¿Trabajaste en negro y te echaron?', 'UY'], ['¿Firmaste tu liquidación?', 'UY']])
    assert.match(g.nota, /3 de otro país \(no AR\): 2 usados para completar, marcados/)
    // Con suficientes del mismo país, los de otro país quedan afuera
    const muchos = { ...conPais, candidatos: [...conPais.candidatos, ...['a', 'b', 'c'].map((k, i) => ({ ...conPais.candidatos[5], cuentaId: `act_ar${k}`, cliente: `AR ${k}`, anuncio: `¿Te despidieron en blanco ${k}?`, cplUSD: 0.7 + i / 100, pais: 'AR' }))] }
    g = elegirGanadores(muchos, { excluirCuentas: ['act_999'], pais: 'AR' })
    assert.ok(g.lista.every(x => x.pais === 'AR'), g.lista.map(x => x.pais).join(','))
    assert.match(g.nota, /3 de otro país \(no AR\) quedaron afuera/)
    // El mensaje de ideas dice el país de cada uno y marca el de otro país
    const ex = extraccionDe({ zona: { ...salidaClaude().zona, pais: 'AR' } }).extraccion
    const m = mensajeIdeas({ ficha: ex, ganadores: elegirGanadores(conPais, { pais: 'AR' }).lista, kb: null, notaGanadores: '' })
    assert.match(m, /país: AR · USD 0,60 por mensaje/, 'con coma decimal, como lo pide el prompt (i3)')
    assert.match(m, /país: UY \(OTRO país que el cliente\)/)
    assert.match(m, /País del cliente: AR/)
    assert.match(m, /solo de la rama Laboral \(despidos\)/)
  })
  test('anonimizar: sin teléfonos, @usuarios, "Dra. Fulana" ni el nombre del otro cliente (con o sin acentos)', () => {
    const t = anonimizar('Soy la Dra. María Pérez, escribime al +54 9 11 5555-1234 o a @estudio.perez. Perez te ayuda.', 'María Pérez')
    assert.ok(!/María|Maria|Pérez|Perez|5555|@estudio/.test(t), t)
    assert.match(t, /Dra\. \[nombre\]/)
    assert.match(t, /\[teléfono\]/)
    assert.match(t, /\[usuario\]/)
    assert.equal(anonimizar('¿Te despidieron y te pagaron menos?', 'Cliente Dos'), '¿Te despidieron y te pagaron menos?')
    const g = elegirGanadores({ ...candidatos(), candidatos: [{ ...candidatos().candidatos[1], copy: 'Soy Cliente Uno, abogada. Llamame al 2615551234' }] })
    assert.ok(!/Cliente Uno|2615551234/.test(g.lista[0].copy), g.lista[0].copy)
  })
})

describe('ideas: controles nuevos', () => {
  const gan = elegirGanadores(candidatos(), { excluirCuentas: ['act_999'] })
  test('costo por mensaje citado distinto del de la lista y subrama que no está en la ficha → ajustes', () => {
    const v = validarIdeas({ ideas: [
      { ...IDEAS_OK[0], por_que: 'G1 (USD 0,36 por mensaje)', subrama: 'despidos en blanco con 2 años o más' },
      { ...IDEAS_OK[1], titulo: 'Mal', por_que: 'G1 (USD 0,50 por mensaje) y G2 (USD 0.44)', subrama: 'accidentes de tránsito' },
    ], notas: '' }, gan.lista, ['despidos en blanco con 2 años o más'])
    assert.ok(!v.ajustes.some(a => /Idea 1/.test(a)), v.ajustes.join(' | '))
    assert.ok(v.ajustes.some(a => /«Mal» dice que G1 cuesta USD 0,50.*0\.36/.test(a)), v.ajustes.join(' | '))
    assert.ok(!v.ajustes.some(a => /G2 cuesta/.test(a)), 'G2 a 0.44 está bien')
    assert.ok(v.ajustes.some(a => /«Mal» apunta a «accidentes de tránsito», que no es una subrama/.test(a)))
  })
})

describe('registro (SQL contra un Neon falso)', () => {
  /** Un q`` falso: anota cada consulta (texto con $n y valores) y responde lo que diga `responder`. */
  const neonFalso = responder => {
    const consultas = []
    const q = async (strings, ...valores) => {
      const texto = strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, '').replace(/\s+/g, ' ').trim()
      consultas.push({ texto, valores })
      return responder(texto, valores)
    }
    return { consultas, fabrica: () => q }
  }
  const fila = { intentos: 2, error: 'x', ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null }
  beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
  const limpiar = () => { registro.sqlParaPruebas(null); delete process.env.DATABASE_URL }

  test('reclamar: nueva → se queda; existente → solo si está en error, colgada 10 min o con forzar; si no, duplicada', async () => {
    try {
      let n = neonFalso(t => (t.startsWith('INSERT') ? [fila] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.equal((await registro.reclamar(7, { forzar: false }, { titulo: 'T', url: 'https://fathom.video/calls/1', payload: { a: 1 } })).intentos, 2)
      assert.ok(n.consultas.some(c => /CREATE TABLE IF NOT EXISTS cj_kickoffs/.test(c.texto)), 'una escritura crea la tabla')
      n = neonFalso(() => [])
      registro.sqlParaPruebas(n.fabrica)
      assert.equal(await registro.reclamar(7, { forzar: false }, { titulo: 'T', url: 'u', payload: {} }), null, 'ni nueva ni re-reclamable → duplicada')
      const upd = n.consultas.find(c => c.texto.startsWith('UPDATE cj_kickoffs SET estado = \'procesando\''))
      assert.ok(upd, n.consultas.map(c => c.texto).join('\n'))
      assert.match(upd.texto, /WHERE recording_id = \$\d+ AND \(\$\d+::boolean OR estado = 'error' OR \(estado = 'procesando' AND actualizado < now\(\) - interval '10 minutes'\)\)/)
      assert.ok(upd.valores.includes(false) && !upd.valores.includes(true))
      n = neonFalso(t => (t.startsWith('UPDATE') ? [fila] : []))
      registro.sqlParaPruebas(n.fabrica)
      await registro.reclamar(7, { forzar: true }, { titulo: 'T', url: 'u', payload: {} })
      const conForzar = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(conForzar.texto, /aviso_discord = CASE WHEN \$\d+::boolean THEN NULL ELSE aviso_discord END/)
      assert.ok(conForzar.valores.filter(v => v === true).length >= 4, 'forzar descarta ficha, ideas y aviso')
    } finally { limpiar() }
  })
  test('las lecturas no crean la tabla: si no existe, vacío', async () => {
    try {
      const n = neonFalso(() => { throw Object.assign(new Error('relation "cj_kickoffs" does not exist'), { code: '42P01' }) })
      registro.sqlParaPruebas(n.fabrica)
      assert.equal(await registro.leerPayload(5), undefined)
      assert.deepEqual(await registro.ultimas(), [])
      assert.equal(await registro.leerKickoff(5), undefined)
      assert.ok(!n.consultas.some(c => /CREATE/.test(c.texto)), 'nada de CREATE desde una lectura')
    } finally { limpiar() }
  })
  test('purgarPayloadsViejos: borra el payload de las filas en error o colgadas de más de N días', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('UPDATE') ? [{ recording_id: 1 }, { recording_id: 2 }] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.equal(await registro.purgarPayloadsViejos(14), 2)
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /SET payload = NULL WHERE estado IN \('error', 'procesando'\) AND payload IS NOT NULL AND actualizado < now\(\) - make_interval\(days => \$1::int\)/)
      assert.deepEqual(u.valores, [14])
    } finally { limpiar() }
  })
})

describe('Meta (ganadores): solo GET por la Batch API, token en el cuerpo, otro token si falta permiso', () => {
  test('batchConTokens: POST a la raíz de Graph con subpedidos GET; el token nunca en la URL; reintento con el segundo token', async () => {
    const original = globalThis.fetch
    process.env.META_ANUNCIOS_TOKEN = 'tok-uno-de-prueba'; process.env.META_CLIENTES_TOKEN = 'tok-dos-de-prueba'
    const pedidos = []
    globalThis.fetch = async (url, init) => {
      const body = init.body
      const lote = JSON.parse(body.get('batch'))
      pedidos.push({ url: String(url), method: init.method, token: body.get('access_token'), lote })
      // Con el primer token, la cuenta act_2 da error de permisos (#200); con el segundo, ok
      return new Response(JSON.stringify(lote.map(p => (body.get('access_token') === 'tok-uno-de-prueba' && p.relative_url.startsWith('act_2')
        ? { code: 400, body: JSON.stringify({ error: { message: 'sin permiso', code: 200 } }) }
        : { code: 200, body: JSON.stringify({ data: [{ ad_id: '1' }] }) }))), { status: 200 })
    }
    try {
      const r = await batchConTokens([{ id: 'act_1', url: 'act_1/insights?level=ad' }, { id: 'act_2', url: 'act_2/insights?level=ad' }])
      assert.deepEqual(Object.keys(r.ok).sort(), ['act_1', 'act_2'])
      assert.equal(r.ok.act_1.token, 'META_ANUNCIOS_TOKEN')
      assert.equal(r.ok.act_2.token, 'META_CLIENTES_TOKEN')
      assert.equal(pedidos.length, 2)
      for (const p of pedidos) {
        assert.equal(p.url, 'https://graph.facebook.com/v23.0/')
        assert.equal(p.method, 'POST')
        assert.ok(p.lote.every(x => x.method === 'GET'), 'cada subpedido es GET')
        assert.ok(!p.url.includes('tok-') && p.lote.every(x => !x.relative_url.includes('access_token')), 'el token va en el cuerpo')
      }
      assert.deepEqual(pedidos[1].lote.map(x => x.relative_url), ['act_2/insights?level=ad'], 'el segundo token solo para lo que falló por permisos')
    } finally {
      globalThis.fetch = original; delete process.env.META_ANUNCIOS_TOKEN; delete process.env.META_CLIENTES_TOKEN
    }
  })
  test('todasLasPaginas: sigue paging.next solo si es de graph.facebook.com', async () => {
    const original = globalThis.fetch
    const pedidos = []
    globalThis.fetch = async url => { pedidos.push(String(url)); return new Response(JSON.stringify({ data: [{ n: 2 }] }), { status: 200 }) }
    try {
      const filas = await todasLasPaginas({ data: [{ n: 1 }], paging: { next: 'https://graph.facebook.com/v23.0/act_1/insights?after=x' } })
      assert.deepEqual(filas, [{ n: 1 }, { n: 2 }])
      assert.equal(pedidos.length, 1)
      assert.deepEqual(await todasLasPaginas({ data: [{ n: 1 }], paging: { next: 'https://otro.test/robar' } }), [{ n: 1 }])
      assert.equal(pedidos.length, 1, 'a otro host no se le pide nada')
    } finally { globalThis.fetch = original }
  })
})

// ── Portfolio de Meta en la ficha, el aviso y el orquestador (24/10) ─────────────────────────────────
describe('ficha: portfolio de Meta cruzado con la llamada (una sola verdad: portfolio_final)', () => {
  const ideas = { estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], ideas: IDEAS_OK, notas: '' }
  const fichaCon = (meta, over = {}) => armarFicha({ reunion: r0, extraccion: extraccionDe(over).extraccion, ajustes: [], ideas, ganadores: null, portfolioMeta: meta })
  test('armarFicha: portfolio_meta es solo la cabecera y portfolio_final cruza Meta con la llamada', () => {
    const f = fichaCon(paraFicha(lecturaMeta()))
    assert.deepEqual(f.portfolio_meta, { cuenta: 'act_999', nombre: 'USD Estudio Ana', leido: true, motivo: null, aviso: null, generado: '2026-10-23T12:40:00Z', origen_cuenta: 'crm', moneda: null, zona_horaria: null })
    assert.deepEqual(Object.keys(f.portfolio_final).sort(), [...ITEMS_PORTFOLIO].sort())
    // La llamada dijo instagram ok y Meta no lo ve → llamada; tarjeta falta en la llamada y ok en Meta → Meta, con el ojo
    assert.deepEqual([f.portfolio_final.instagram.estado, f.portfolio_final.instagram.fuente], ['ok', 'llamada'])
    assert.deepEqual([f.portfolio_final.tarjeta.estado, f.portfolio_final.tarjeta.fuente], ['ok', 'meta'])
    assert.match(f.portfolio_final.tarjeta.discrepancia, /«falta» \(cargar una tarjeta en dólares\)/)
    assert.deepEqual([f.portfolio_final.whatsapp_business.estado, f.portfolio_final.whatsapp_business.fuente], ['sin_dato', 'ninguna'])
    assert.equal(f.portfolio.tarjeta.estado, 'falta', '"portfolio" sigue siendo lo de la llamada, tal cual')
  })
  test('faltantes: tildar a mano, falta con su fuente, ojo Meta vs llamada y el aviso de Meta', () => {
    const f = fichaCon(paraFicha(lecturaMeta({
      aviso: 'Pedirle al cliente: darle acceso a Valentino (grabador.b@example.test) · el cliente tiene 2 cuentas en Meta: se revisa «USD Estudio Ana»',
      items: { accesos_equipo: { estado: 'falta', detalle: 'Falta darle acceso a Valentino (grabador.b@example.test)' } },
    })))
    const p = f.faltantes.filter(x => x.startsWith('Portfolio'))
    assert.deepEqual(p, [
      'Portfolio para tildar a mano (Meta no los pudo leer y en la llamada no se confirmaron): WhatsApp Business',
      'Portfolio · Tarjeta (medio de pago de la cuenta publicitaria): ojo: Meta dice «ok», en la llamada se dijo «falta» (cargar una tarjeta en dólares): revisar',
      'Portfolio · Accesos del equipo (Gero A y Valentino): falta según Meta (Falta darle acceso a Valentino (grabador.b@example.test))',
      'Portfolio en Meta (act_999): el cliente tiene 2 cuentas en Meta: se revisa «USD Estudio Ana»',
    ], 'el pedido de accesos no se repite en el renglón del aviso')
  })
  test('faltantes: con deuda no se repite verificación (dice "ver Tarjeta"); un ok débil de Meta pierde contra un falta de la llamada', () => {
    const f = fichaCon(paraFicha(lecturaMeta({ items: {
      tarjeta: { estado: 'problema', detalle: 'Cuenta con pago pendiente (deuda): hay que regularizar el pago' },
      verificacion: { estado: 'problema', detalle: 'Cuenta con pago pendiente (deuda) (ver Tarjeta); portfolio: sin verificar' },
      whatsapp_business: { estado: 'ok', detalle: 'Deducido de los anuncios: 2 conjuntos con destino WhatsApp (1 activo)', debil: true },
    } })), { portfolio: [{ item: 'whatsapp_business', estado: 'falta', detalle: 'pasar el número a WhatsApp Business', cita: '', timestamp: '00:10:00' }] })
    const p = f.faltantes.filter(x => x.startsWith('Portfolio'))
    assert.ok(p.some(x => /^Portfolio · Tarjeta.*: problema según Meta \(Cuenta con pago pendiente/.test(x)), p.join(' | '))
    assert.ok(!p.some(x => /Verificación/.test(x)), 'verificación no se repite')
    assert.ok(p.some(x => x === 'Portfolio · WhatsApp Business: falta según la llamada (pasar el número a WhatsApp Business) · ojo: Meta dice «ok», pero lo deduce de los anuncios'), p.join(' | '))
  })
  test('Meta no pudo leer la cuenta (sin cuenta): todo a mano lo que la llamada no resolvió, con el porqué y qué hacer', () => {
    const sin = paraFicha(portfolioSinLectura(null, 'sin_cuenta', 'No apareció ninguna cuenta publicitaria de Ana Pérez en Meta'))
    const f = fichaCon(sin)
    const p = f.faltantes.filter(x => x.startsWith('Portfolio'))
    assert.equal(p[0], 'Portfolio para tildar a mano (Meta no pudo leer la cuenta: no se encontró la cuenta del cliente, y en la llamada no se confirmaron): WhatsApp Business, Página de Facebook, Portfolio comercial, Verificación / resumen de la cuenta y Accesos del equipo')
    assert.ok(p.includes('Portfolio · Tarjeta (medio de pago de la cuenta publicitaria): falta según la llamada (cargar una tarjeta en dólares)'), p.join(' | '))
    assert.equal(p.at(-1), 'Portfolio en Meta: Cargar la cuenta publicitaria en Cuentas Meta (CRM) y volver a chequear')
  })
  test('lo que solo se mencionó (sin_verificar) queda a mano, aclarado, y no discute con Meta', () => {
    const f = fichaCon(paraFicha(lecturaMeta()), { portfolio: [{ item: 'whatsapp_business', estado: 'sin_verificar', detalle: 'los mensajes llegan a WhatsApp', cita: 'frase número 22 de la llamada', timestamp: '00:11:00' }, { item: 'tarjeta', estado: 'sin_verificar', detalle: 'tenela cargada', cita: '', timestamp: '' }] })
    assert.equal(f.portfolio_final.tarjeta.fuente, 'meta')
    assert.equal(f.portfolio_final.tarjeta.discrepancia, null)
    assert.ok(f.faltantes.includes('Portfolio para tildar a mano (Meta no los pudo leer y en la llamada no se confirmaron): Instagram y WhatsApp Business (WhatsApp Business solo se nombró)'), f.faltantes.join(' | '))
  })
  test('markdown: columna Fuente, Momento solo cuando la fila habla de la llamada, y debajo la cuenta y el aviso', () => {
    const f = fichaCon(paraFicha(lecturaMeta({ aviso: 'Reintentar el chequeo en unos minutos', busqueda: { cuentas: [{ id: 'act_999', nombre: 'USD Estudio Ana', estado: 1, negocio: null, origen: 'descubrimiento' }], origen: 'descubrimiento', aviso: null, avisos: [] } })))
    const md = fichaMarkdown(f)
    assert.ok(md.includes('| Ítem | Estado | Fuente | Detalle | Momento |'))
    assert.match(md, /\| Instagram \| ✅ ok \| llamada \| tiene cuenta \| \[▶ 10:00\]/, 'fuente llamada: con el momento')
    assert.match(md, /\| Página de Facebook \| ✅ ok \| Meta \| pagina_facebook: ok en Meta \| — \|/, 'fuente Meta: sin momento')
    assert.match(md, /\| Tarjeta .* \| ✅ ok \| Meta \| tarjeta: ok en Meta · ojo: en la llamada se dijo «falta» .* \| \[▶ 11:00\]\(https:\/\/fathom\.video\/calls\/111\?timestamp=660\) \|/, 'con discrepancia: el momento de la llamada')
    assert.match(md, /\| WhatsApp Business \| — para tildar \| — \|/, '"sin verificar" queda solo para la verificación de Meta')
    assert.match(md, /- Cuenta revisada en Meta: act_999 \(«USD Estudio Ana»\) · la encontró el tablero de anuncios \(no está en «Cuentas Meta» del CRM\) · chequeo del vie 23\/10 09:40/)
    // La encontró el tablero: el faltante de cargarla en el CRM (empieza con Portfolio: el aviso lo resume en 🧾)
    assert.ok(f.faltantes.includes('Portfolio · cargar act_999 en «Cuentas Meta» del CRM: hoy la encontró sola el tablero de anuncios'), f.faltantes.join(' | '))
    assert.equal(claveFaltante('Portfolio · cargar act_999 en «Cuentas Meta» del CRM: hoy la encontró sola el tablero de anuncios'), 'cuenta_crm')
    assert.match(resumenPortfolio(f), /➜ cargar la cuenta en «Cuentas Meta» del CRM/)
    assert.match(md, /- ⚠️ Qué hacer según Meta: Reintentar el chequeo en unos minutos/)
    assert.match(md, /Grabada con el Fathom de: \*\*Tomás\*\* \(Tomas Napolitano en Fathom\)/)
  })
  test('ficha vieja (sin portfolio_meta ni portfolio_final, como las guardadas antes): faltantes, markdown y aviso no se rompen', () => {
    const vieja = { ...armarFicha({ reunion: r0, extraccion: extraccionDe().extraccion, ajustes: [], ideas, ganadores: null }) }
    delete vieja.portfolio_meta; delete vieja.portfolio_final; delete vieja.grabo
    assert.deepEqual(portfolioFinalDe(vieja).tarjeta.fuente, 'llamada')
    assert.ok(calcularFaltantes(vieja).some(x => /^Portfolio para tildar a mano \(sin chequeo de Meta y en la llamada no se confirmaron\)/.test(x)))
    assert.match(fichaMarkdown(vieja), /- Meta: sin chequeo \(ficha anterior al chequeo del portfolio\)/)
    const t = armarAviso({ ...vieja, faltantes: calcularFaltantes(vieja) }, { tomi: TOMI, gero_m: GERO }, null)
    assert.match(t, /🧾 \*\*Portfolio:\*\* 1\/7 ok \(sin chequeo de Meta\) · falta: Tarjeta · a tildar: /)
    assert.ok(!/Kickoff de/.test(t), 'sin recorded_by no dice quién')
    assert.deepEqual(faltantesPortfolio({ portfolio: vieja.portfolio, portfolio_final: { roto: true } }).length > 0, true, 'un portfolio_final con forma rara se rearma de la llamada')
  })
  test('quienGrabo: Tomás y Gero M por nombre o mail; otra persona con su nombre; sin dato → null', () => {
    assert.equal(quienGrabo({ name: 'Tomas Napolitano', email: 't@ejemplo.com' }).quien, 'Tomás')
    assert.equal(quienGrabo({ name: null, email: 'napolitano@example.test' }).quien, 'Tomás')
    assert.equal(quienGrabo({ name: 'Gero Mozzi', email: 'gm@ejemplo.com' }).quien, 'Gero M')
    assert.equal(quienGrabo({ name: 'Gerónimo  Mozzi', email: null }).nombre, 'Gerónimo Mozzi')
    assert.deepEqual(quienGrabo({ name: 'Gerónimo Actis', email: 'ga@ejemplo.com' }), { nombre: 'Gerónimo Actis', email: 'ga@ejemplo.com', quien: null }, 'Gero A no es Gero M')
    assert.equal(quienGrabo(null), null)
    assert.equal(quienGrabo({ name: '', email: '' }), null)
  })
})

describe('aviso: renglón del portfolio, quién hizo la kickoff y link a la ficha', () => {
  const gan = elegirGanadores(candidatos(), { excluirCuentas: ['act_999'] })
  const ideas = { estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], ideas: IDEAS_OK, notas: '' }
  const fichaCon = (meta, over = {}, reunionOver = {}) => armarFicha({ reunion: { ...r0, ...reunionOver }, extraccion: extraccionDe(over).extraccion, ajustes: [], ideas, ganadores: gan, portfolioMeta: meta })
  test('🧾 Portfolio: conteo, falta/problema, qué hacer según Meta, ojo y sin dato; los faltantes del portfolio no se repiten en ⚠️', () => {
    const f = fichaCon(paraFicha(lecturaMeta({ aviso: 'Pedirle al cliente: darle acceso a Valentino (grabador.b@example.test)', items: { accesos_equipo: { estado: 'falta', detalle: 'Falta darle acceso a Valentino' } } })))
    assert.equal(resumenPortfolio(f), '5/7 ok (4 según Meta, 1 en la llamada) · falta: Accesos del equipo · ➜ Pedirle al cliente: darle acceso a Valentino (grabador.b@example.test) · ojo, Meta y la llamada no coinciden: Tarjeta · a tildar: WhatsApp')
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, linkFicha('https://d.test', f, true))
    const linea = t.split('\n').find(l => l.startsWith('🧾'))
    assert.ok(linea && linea.startsWith('🧾 **Portfolio:** 5/7 ok'), t)
    const falt = t.split('\n').find(l => l.startsWith('⚠️'))
    // Cuántos del portfolio (si son varios): "(4)" con dos cosas a la vista parecía que faltaba una
    assert.match(falt, /^⚠️ \*\*Falta completar \(4\):\*\* recorte de la zona \(mapa\) · portfolio \(3\): ver 🧾$/)
    assert.ok(!/Portfolio ·|tildar a mano/.test(falt), 'los del portfolio van en 🧾')
    assert.ok(t.length <= MAX_DISCORD)
  })
  test('como Laura: 5/7 ok según Meta, a tildar Instagram y WhatsApp', () => {
    const f = fichaCon(paraFicha(lecturaMeta()), { portfolio: [] })
    assert.equal(resumenPortfolio(f), '5/7 ok según Meta · a tildar: Instagram, WhatsApp')
  })
  test('Meta no pudo leer la cuenta: lo dice en 🧾 con el porqué y qué hacer', () => {
    const f = fichaCon(paraFicha(portfolioSinLectura(null, 'sin_cuenta', 'No apareció ninguna cuenta')))
    assert.match(resumenPortfolio(f), /^1\/7 ok \(Meta no pudo leer la cuenta: no se encontró la cuenta del cliente\) · falta: Tarjeta · ➜ Cargar la cuenta publicitaria en Cuentas Meta \(CRM\) y volver a chequear · a tildar: /)
  })
  test('📞 dice quién hizo la kickoff (Tomás / Gero M); el link a la ficha va en ✍️ «comentalas en la ficha»', () => {
    let f = fichaCon(paraFicha(lecturaMeta()))
    const link = linkFicha(URL_DESPACHO, f, true)
    assert.equal(link, 'https://despacho-capital-juridico.vercel.app/clientes/A101/kickoff')
    let t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, link)
    assert.match(t, /\n📞 Kickoff de Tomás · vie 23\/10 09:00 · \[Fathom\]\(<https:\/\/fathom\.video\/calls\/111>\)\n/)
    // La aprobación queda en la ficha (un "ok" en Discord no se registra): se dice dónde, después de las ideas
    assert.match(t, /\n🏆 [^\n]*\n✍️ Los guiones ya se están escribiendo con estas ideas · comentalas en la \[ficha\]\(<https:\/\/despacho-capital-juridico\.vercel\.app\/clientes\/A101\/kickoff>\)\n/)
    assert.ok(!/👉/.test(armarAviso(f, { tomi: TOMI, gero_m: GERO }, null)), 'sin link no hay 👉')
    f = fichaCon(paraFicha(lecturaMeta()), {}, { recorded_by: { name: 'Gero Mozzi', email: 'gm@ejemplo.com', email_domain: 'ejemplo.com', team: null } })
    t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, null)
    assert.match(t, /\n📞 Kickoff de Gero M · /)
    f = fichaCon(paraFicha(lecturaMeta()), {}, { recorded_by: { name: '@everyone *Otra*', email: null, email_domain: null, team: null } })
    t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, null)
    assert.ok(!/@everyone/.test(t) && /Kickoff de .*Otra/.test(t), 'el nombre de Fathom va escapado')
  })
  test('todo largo: sigue entrando en 2000 y conserva el 🧾', () => {
    const largas = IDEAS_OK.map((x, i) => ({ ...x, titulo: `Idea larga ${i} `.repeat(6), gancho: 'palabra '.repeat(60) }))
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe({ pendientes: ['p '.repeat(80), 'q '.repeat(80)] }).extraccion, ajustes: [], ideas: { ...ideas, ideas: largas }, ganadores: gan,
      portfolioMeta: paraFicha(lecturaMeta({ aviso: 'Pedirle al cliente: ' + 'x '.repeat(150), items: { tarjeta: { estado: 'problema', detalle: 'deuda' } } })) })
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, null)
    assert.ok(t.length <= MAX_DISCORD, String(t.length))
    // El "qué hacer según Meta" de más de 300 caracteres no entra: sale ENTERO (queda "+N", está en la ficha), no a la mitad
    assert.match(t, /\n🧾 \*\*Portfolio:\*\* 5\/7 ok \(4 según Meta, 1 en la llamada\) · problema: Tarjeta · \+\d\n/)
    assert.ok(!t.split('\n').find(l => l.startsWith('🧾')).includes('…'))
    // Los faltantes que arma el código van con su etiqueta corta fija: entran todos, sin "y N más"
    assert.match(t, /⚠️ \*\*Falta completar \(\d+\):\*\* recorte de la zona \(mapa\) · portfolio( \(\d+\))?: ver 🧾/)
    assert.ok(!/y \d+ más/.test(t.split('\n').find(l => l.startsWith('⚠️'))))
    const conLink = armarAviso(f, { tomi: TOMI, gero_m: GERO }, 'https://despacho-capital-juridico.vercel.app/clientes/A101/kickoff')
    assert.ok(conLink.length <= MAX_DISCORD, String(conLink.length))
    assert.match(conLink, /⚠️ \*\*Falta completar \(\d+\):\*\* recorte de la zona \(mapa\)/)
  })
  test('los ganchos se cuidan: con link y 🧾, se achican primero faltantes, avatar y zona', () => {
    const ganchos = IDEAS_OK.map((x, i) => ({ ...x, titulo: `Idea número ${i + 1} con título`, gancho: `¿Estabas en blanco hace más de un año y medio en Mendoza, te despidieron y ya firmaste la liquidación? Ojo, esperá ${i}.` }))
    const ex = extraccionDe({
      pendientes: ['Confirmar si se suman guiones de despido después de un accidente de trabajo', 'otro pendiente'],
      avatar: { incluye: [{ texto: 'al menos un año y medio trabajando', cita: '', timestamp: '' }, { texto: 'prioridad a gente en blanco o mitad en negro y mitad en blanco', cita: '', timestamp: '' }], excluye: ['nada de pasantes', 'nada de gente con pocos meses de trabajo', 'nada de trabajo totalmente en negro', 'contexto: en la zona hay muchos trabajadores rurales en negro'].map(t => ({ texto: t, cita: '', timestamp: '' })) },
    }).extraccion
    const f = armarFicha({ reunion: { ...r0, recording_end_time: '2026-10-23T12:22:00Z', scheduled_end_time: '2026-10-23T12:45:00Z' }, extraccion: ex, ajustes: [], ideas: { ...ideas, ideas: ganchos }, ganadores: gan, portfolioMeta: paraFicha(lecturaMeta()) })
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, linkFicha(URL_DESPACHO, f, true))
    assert.ok(t.length <= MAX_DISCORD, String(t.length))
    for (const g of ganchos) assert.ok(t.includes(g.gancho), `gancho entero: ${g.gancho}`)
  })
})

describe('procesarKickoff: portfolio de Meta', () => {
  test('kickoff: precalienta antes de Claude, chequea después de la extracción y la ficha y el aviso lo traen', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista', r.motivo)
    assert.deepEqual(log.preparar, [['reclamar']], 'una vez, antes de extraer (mientras Claude lee la llamada)')
    assert.equal(log.portfolio.length, 1)
    assert.deepEqual(log.portfolio[0].despuesDe, ['reclamar', 'extraer', 'guardarFicha'], 'después de la extracción, antes de las ideas')
    assert.deepEqual(log.portfolio[0].cliente, { cliente_crm: 'Ana Pérez', cuentas: ['act_999'] })
    assert.equal(log.portfolio[0].tope, TOPE_PORTFOLIO_MS)
    assert.equal(r.ficha.portfolio_meta.cuenta, 'act_999')
    assert.equal(r.ficha.portfolio_final.pagina_facebook.fuente, 'meta')
    assert.equal(r.ficha.grabo.quien, 'Tomás')
    assert.match(log.enviar[0].texto, /\n🧾 \*\*Portfolio:\*\* /)
    assert.match(log.enviar[0].texto, /\n📞 Kickoff de Tomás · /)
    assert.match(log.enviar[0].texto, /✍️ Los guiones ya se están escribiendo con estas ideas · comentalas en la \[ficha\]\(<https:\/\/despacho\.ejemplo\.test\/clientes\/A101\/kickoff>\)/, 'link encendido por defecto')
    assert.equal(log.marcar.at(-1).ficha.portfolio_final.tarjeta.fuente, 'meta', 'la ficha final que se guarda lleva el portfolio')
    assert.equal(log.guardarFicha[0].ficha.portfolio_meta, null, 'la base (antes del chequeo) todavía no')
    // La extracción reserva el mayor de los topes de Meta (ganadores y portfolio corren en paralelo)
    assert.ok(log.extraer[0].tope <= PLAZO_MS - MARGEN_ENVIO_MS - RESERVA_IDEAS_MS - Math.max(TOPE_GANADORES_MS, TOPE_PORTFOLIO_MS))
  })
  test('pantallaFicha false: sin link; sin id_crm: sin link aunque esté encendido', async () => {
    let { deps, log } = fakes({ pantallaFicha: false })
    await procesarKickoff(reunion(), deps)
    assert.ok(!/🗂️|👉|clientes\/A101\/kickoff/.test(log.enviar[0].texto))
    ;({ deps, log } = fakes({ extraer: async () => ({ ...resultadoExtraccion(), extraccion: extraccionDe({ cliente: { nombre_escuchado: 'X', cliente_crm: null, id_crm: null } }, cx({ emailsInvitados: [] })).extraccion }) }))
    await procesarKickoff(reunion(), deps)
    assert.ok(!/🗂️|👉|\/kickoff>/.test(log.enviar[0].texto))
  })
  test('no es kickoff: ni portfolio ni precalentar al reusar una ficha que no es kickoff', async () => {
    const { deps, log } = fakes({ extraer: async () => resultadoExtraccion({ tipo_reunion: 'seguimiento' }) })
    await procesarKickoff(reunion(), deps)
    assert.equal(log.portfolio.length, 0)
    const ficha = armarFicha({ reunion: r0, extraccion: extraccionDe({ tipo_reunion: 'seguimiento' }).extraccion, ajustes: [], ideas: null, ganadores: null })
    const otro = fakes({ reclamar: async () => ({ intentos: 2, error_previo: 'x', ficha, ideas: null, version_prompt: VERSION_PROMPT, version_ideas: null, modelo: 'm', tokens_in: 1, tokens_out: 1, aviso_discord: null }) })
    await procesarKickoff(reunion(), otro.deps)
    assert.equal(otro.log.preparar.length + otro.log.portfolio.length, 0)
  })
  test('dry: también chequea el portfolio (es lectura) y no toca la base ni Discord', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff(reunion(), deps, { dry: true })
    assert.equal(r.estado, 'dry')
    assert.equal(log.portfolio.length, 1)
    assert.match(r.mensaje, /🧾 \*\*Portfolio:\*\* 6\/7 ok \(5 según Meta, 1 en la llamada\) · ojo, Meta y la llamada no coinciden: Tarjeta · a tildar: WhatsApp\n/)
    assert.equal(log.marcar.length + log.enviar.length, 0)
  })
  test('el portfolio falla o tarda: la ficha sale igual, "Meta no pudo leer" y queda en los ajustes; nunca frena', async () => {
    let { deps } = fakes({ portfolio: async () => { throw new Error('falló https://graph.facebook.com/v23.0/?access_token=EAAsecreto123') } })
    let r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.equal(r.ficha.portfolio_meta.leido, false)
    assert.equal(r.ficha.portfolio_meta.motivo, 'error')
    assert.equal(r.ficha.portfolio_final.instagram.fuente, 'llamada', 'lo de la llamada sigue mandando')
    const aj = r.ficha.ajustes.find(a => a.startsWith(PREFIJO_AJUSTE_PORTFOLIO))
    assert.match(aj, /el chequeo no salió/)
    assert.ok(!/EAAsecreto|graph\.facebook\.com/.test(JSON.stringify(r.ficha)), 'el motivo va limpio (motivoDe)')
    ;({ deps } = fakes({ portfolio: () => new Promise(() => {}), topePortfolioMs: 20 }))
    r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.equal(r.ficha.portfolio_meta.motivo, 'timeout')
    assert.ok(r.ficha.ajustes.some(a => /Meta tardó más de 0 s/.test(a)), r.ficha.ajustes.join(' | '))
    assert.match(r.mensaje, /🧾 \*\*Portfolio:\*\* .*\(Meta no pudo leer la cuenta: Meta no respondió a tiempo\)/)
  })
  test('ganadores: también sin las cuentas que encontró la búsqueda del portfolio (a Laura su cuenta solo aparece así)', async () => {
    // Una cuenta de la rama que el CRM no le asigna a Ana, pero que la búsqueda del portfolio encontró como suya
    const SUYA = 'act_1000001'
    const { deps, log } = fakes({
      candidatos: async () => { const c = candidatos(); return { ...c, candidatos: c.candidatos.map(x => (x.cuentaId === 'act_1' ? { ...x, cuentaId: SUYA } : x)) } },
      portfolio: async () => lecturaMeta({ cuenta: SUYA, busqueda: { cuentas: [{ id: SUYA, nombre: 'USD Estudio Ana', estado: 1, negocio: null, origen: 'descubrimiento' }], origen: 'descubrimiento', aviso: null, avisos: ['sin CRM: no se pudo cruzar'] } }),
    })
    const r = await procesarKickoff(reunion(), deps)
    assert.ok(log.ideas[0].e.ganadores.every(g => g.cuentaId !== SUYA && g.cuentaId !== 'act_999'), log.ideas[0].e.ganadores.map(g => g.cuentaId).join(','))
    // Sin el portfolio, esa cuenta SÍ entraba (control)
    const control = fakes({ candidatos: deps.candidatos })
    await procesarKickoff(reunion(), control.deps)
    assert.ok(control.log.ideas[0].e.ganadores.some(g => g.cuentaId === SUYA))
    assert.ok(r.ficha.ganadores.lista.length >= 1)
    assert.equal(r.ficha.portfolio_meta.origen_cuenta, 'descubrimiento')
    assert.ok(r.ficha.ajustes.includes(`${PREFIJO_AJUSTE_PORTFOLIO} sin CRM: no se pudo cruzar`))
  })
  test('al reusar la ficha y las ideas guardadas: se vuelve a chequear el portfolio (sin Claude) y sus ajustes viejos no se arrastran', async () => {
    const primero = fakes()
    await procesarKickoff(reunion(), primero.deps)
    const fichaFinal = primero.log.marcar.at(-1).ficha
    const guardado = {
      intentos: 2, error_previo: 'algo', ficha: { ...fichaFinal, ajustes: [...fichaFinal.ajustes, `${PREFIJO_AJUSTE_PORTFOLIO} viejo`] }, ideas: primero.log.guardarIdeas[0].ideas,
      version_prompt: VERSION_PROMPT, version_ideas: VERSION_IDEAS, modelo: 'claude-opus-5-5', tokens_in: 1, tokens_out: 1, aviso_discord: 'msg1',
    }
    const { deps, log } = fakes({ reclamar: async () => guardado, portfolio: async c => { log.portfolio.push({ cliente: c }); return lecturaMeta({ items: { tarjeta: { estado: 'falta', detalle: 'Hay medio de pago: no' } } }) } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual(r.reutilizado, { ficha: true, ideas: true })
    assert.equal(log.extraer.length + log.ideas.length + log.enviar.length, 0)
    assert.equal(log.portfolio.length, 1, 'el portfolio se chequea de nuevo')
    assert.equal(r.ficha.portfolio_final.tarjeta.estado, 'falta', 'con lo que dice Meta ahora')
    assert.ok(!r.ficha.ajustes.includes(`${PREFIJO_AJUSTE_PORTFOLIO} viejo`))
    assert.equal(extraccionDeFicha(guardado.ficha).ajustes.some(a => a.startsWith(PREFIJO_AJUSTE_PORTFOLIO)), false)
  })
  test('chequeoPortfolio: el porqué técnico de cada ítem (permiso, código de Graph) va a los ajustes, no al detalle', async () => {
    const p = await chequeoPortfolio({ topePortfolioMs: 500, portfolio: async () => lecturaMeta({ items: { instagram: { estado: 'sin_dato', detalle: 'No se ve Instagram', tecnico: 'Instagram: el token no tiene instagram_basic' } } }) }, { cliente: { cliente_crm: 'Ana', cuentas: [] } })
    assert.deepEqual(p.ajustes, [`${PREFIJO_AJUSTE_PORTFOLIO} Instagram: el token no tiene instagram_basic`])
    assert.ok(!('tecnico' in p.lectura.items.instagram), 'la ficha no lo guarda en el ítem')
  })
  test('chequeoPortfolio: pasa el cliente y el tope, y junta las cuentas encontradas (normalizadas, sin repetir)', async () => {
    const pedidos = []
    const p = await chequeoPortfolio({ topePortfolioMs: 500, portfolio: async (c, t) => { pedidos.push([c, t]); return lecturaMeta({ cuenta: 'act_5555555', busqueda: { cuentas: [{ id: 'act_5555555', nombre: 'a', estado: 1, negocio: null, origen: 'crm' }, { id: '7777777', nombre: 'b', estado: 101, negocio: null, origen: 'crm' }], origen: 'crm', aviso: 'x', avisos: [] } }) } }, { cliente: { cliente_crm: 'Ana', cuentas: ['Cuenta por nombre'] } })
    assert.deepEqual(pedidos, [[{ cliente_crm: 'Ana', cuentas: ['Cuenta por nombre'] }, 500]])
    assert.deepEqual(p.cuentas, ['act_5555555', 'act_7777777'])
    assert.equal(p.lectura.cuenta, 'act_5555555')
  })
})

describe('revisión de la pantalla (24/10): pendientes, moneda, lanzamiento, claves de faltantes y aviso', () => {
  const ideas = { estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], ideas: IDEAS_OK, notas: '' }
  const PEND = ['No se revisó el portfolio en Meta: Instagram, página de Facebook ni accesos para grabador.a@example.test', 'Confirmar la tarjeta en dólares', 'Laura tiene que estudiar la reforma']
  test('pendientes del portfolio: con Meta se sacan (lo cubre el chequeo) y quedan en los ajustes; sin Meta, quedan', () => {
    const ex = extraccionDe({ pendientes: PEND }).extraccion
    const con = armarFicha({ reunion: r0, extraccion: ex, ajustes: [], ideas, ganadores: null, portfolioMeta: paraFicha(lecturaMeta()) })
    assert.deepEqual(con.pendientes, ['Laura tiene que estudiar la reforma'])
    assert.equal(con.ajustes.filter(a => /^pendiente del portfolio sacado \(«.*»\): lo cubre el chequeo de Meta$/.test(a)).length, 2)
    assert.ok(!con.ajustes.join(' ').includes('@'), 'el ajuste corta antes del mail')
    const sin = armarFicha({ reunion: r0, extraccion: ex, ajustes: [], ideas, ganadores: null })
    assert.equal(sin.pendientes.length, 3)
  })
  test('la cuenta factura en otra moneda que el presupuesto → faltante para pasarlo (en pesos, con el rango)', () => {
    const ars = paraFicha(lecturaMeta({ datos: { moneda: 'ARS', zona_horaria: 'America/Argentina/San_Juan' } }))
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe().extraccion, ajustes: [], ideas, ganadores: null, portfolioMeta: ars })
    assert.ok(f.faltantes.includes('La cuenta factura en ARS: pasar USD 10 por día a pesos al cargar el presupuesto'), f.faltantes.join(' | '))
    assert.equal(claveFaltante('La cuenta factura en ARS: pasar USD 10 por día a pesos al cargar el presupuesto'), 'moneda')
    assert.match(fichaMarkdown(f), /- Cuenta revisada en Meta: act_999 \(«USD Estudio Ana»\) · factura en ARS · hora de Argentina · de «Cuentas Meta» del CRM/)
    const usd = armarFicha({ reunion: r0, extraccion: extraccionDe().extraccion, ajustes: [], ideas, ganadores: null, portfolioMeta: paraFicha(lecturaMeta({ datos: { moneda: 'USD' } })) })
    assert.ok(!usd.faltantes.some(x => /factura en/.test(x)))
  })
  test('renglonLanzamiento: desde los acuerdos (guiones, grabación, edición) o la fecha de lanzamiento si se dijo', () => {
    const a = (quien, que, cuando = null) => ({ quien, que, cuando })
    assert.equal(renglonLanzamiento([a('Tomás / equipo', 'Primera entrega de guiones', 'lun 26/10'), a('Laura (Cris)', 'Grabar los videos'), a('Editor', 'Editar los videos y publicarlos')]),
      'Lanzamiento: sin fecha (guiones para lun 26/10; después graba Laura y se edita)')
    assert.equal(renglonLanzamiento([a('Tomás', 'Lanzar la campaña', 'jue 29/10'), a('Ana', 'Grabar')]), 'Lanzamiento: jue 29/10')
    assert.equal(renglonLanzamiento([]), 'Lanzamiento: sin fecha')
  })
  test('cada faltante que arma el código (fuera del portfolio que se tilda) tiene clave y etiqueta corta', () => {
    const vacia = validarSalida({ tipo_reunion: 'kickoff', cliente: { nombre_escuchado: 'Carla' } }, cx({ conocidos: [], emailsInvitados: [] })).extraccion
    const todos = [
      ...calcularFaltantes({ ...vacia, ideas_guiones: { estado: 'sin_ideas', revisores: [], ideas: [], notas: '', motivo: 'x' } }),
      ...armarFicha({ reunion: r0, extraccion: extraccionDe({ presupuesto: { ...salidaClaude().presupuesto, usd_mes: null, certeza: 'a_confirmar' } }).extraccion, ajustes: [], ideas, ganadores: null }).faltantes,
    ].filter(x => !/^Portfolio/.test(x))
    assert.ok(todos.length >= 9, todos.join(' | '))
    for (const x of todos) {
      const k = claveFaltante(x)
      assert.ok(k, `sin clave: ${x}`)
      assert.ok(ETIQUETA_FALTANTE[k], k)
    }
    assert.equal(claveFaltante('Zona marcada en un mapa en pantalla: verificar el recorte exacto en la grabación o en la cuenta'), 'zona_mapa', 'el texto de las fichas viejas')
  })
  test('aviso: avatar con «✋ afuera:» sin la doble negación ni el contexto del mercado; la zona sin el paréntesis de cuándo se dijo', () => {
    const ex = extraccionDe({
      avatar: { incluye: [{ texto: 'al menos un año y medio trabajando', cita: '', timestamp: '' }], excluye: ['nada de pasantes', 'nada de trabajo totalmente en negro (igual puede escribir)', 'contexto de la zona: hay muchos rurales en negro'].map(t => ({ texto: t, cita: '', timestamp: '' })) },
      zona: { ...salidaClaude().zona, presentarse_como: 'Mendoza capital', presentarse_cuando: 'si un lead pregunta', presentarse_evidencia: '' },
    }).extraccion
    const f = armarFicha({ reunion: r0, extraccion: ex, ajustes: [], ideas, ganadores: null, portfolioMeta: paraFicha(lecturaMeta()) })
    const t = armarAviso(f, { tomi: TOMI, gero_m: GERO }, 'https://d.test/clientes/A101/kickoff')
    assert.match(t, /👤 \*\*Avatar:\*\* al menos un año y medio trabajando · ✋ afuera: pasantes · trabajo totalmente en negro\n/)
    assert.ok(!/✋ sin:|contexto de la zona/.test(t))
    assert.match(t, /📍 \*\*Zona:\*\* Mendoza · Godoy Cruz · radio 20 km · se presenta como «Mendoza capital» · 🗺️ marcada en el mapa\n/)
  })
})

describe('servidor: link a la ficha y dependencias del portfolio', () => {
  test('pantallaFicha encendida por defecto (KICKOFF_PANTALLA=0 la apaga); urlDespacho = el Despacho o DESPACHO_URL https', () => {
    try {
      assert.equal(pantallaFicha(), true)
      process.env.KICKOFF_PANTALLA = '0'
      assert.equal(pantallaFicha(), false)
      process.env.KICKOFF_PANTALLA = '1'
      assert.equal(pantallaFicha(), true)
      assert.equal(urlDespacho(), 'https://despacho-capital-juridico.vercel.app')
      process.env.DESPACHO_URL = 'https://otro.despacho.test/'
      assert.equal(urlDespacho(), 'https://otro.despacho.test')
      process.env.DESPACHO_URL = 'http://inseguro.test'
      assert.equal(urlDespacho(), URL_DESPACHO, 'sin https no se usa')
      process.env.AUTH_BASE_URL = 'https://dashboard-metricas-eight.vercel.app'
      assert.equal(urlDespacho(), URL_DESPACHO, 'el dominio viejo no va en links nuevos')
    } finally { delete process.env.KICKOFF_PANTALLA; delete process.env.DESPACHO_URL; delete process.env.AUTH_BASE_URL }
  })
  test('depsLectura trae el portfolio real y el precalentado (sin llamarlos acá: harían red)', () => {
    const l = depsLectura()
    assert.equal(typeof l.portfolio, 'function')
    assert.equal(typeof l.prepararPortfolio, 'function')
    assert.equal(l.pantallaFicha, true)
    assert.equal(l.urlBase, URL_DESPACHO)
  })
})
