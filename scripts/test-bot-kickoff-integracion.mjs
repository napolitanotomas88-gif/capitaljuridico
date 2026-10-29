// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-integracion.mjs
// Lo del 24/10 (tarde) sobre la ficha de kickoff ya publicada: la misma kickoff grabada por los dos (dedupe.ts y la búsqueda
// de la gemela en registro.ts), quién firmó el webhook (columna grabador), la zona desde el video integrada al bot
// (procesar.ts pide el video temprano y dispara /api/bot/kickoff/mapa, que ahora es asincrónica: mapa-api.ts), lo que se
// muestra del mapa (ficha.ts, vista.ts, mensaje.ts) y el aviso sin cortes a mitad de frase. Y lo de la tercera revisión
// (sección 7): el link y los faltantes del aviso nunca se pierden, la misma cuenta de Fathom nunca es "la otra", Gero M por
// el link del Meet, las que no se procesan no ganan, la clave propia de lo que pide el mapa leído, el pin de Meta en "para
// lanzar", lo que se anota cuando la lectura no arranca, el reintento solo y el aviso del mapa. SIN red (fetch bloqueado y
// fakes), SIN base (Neon falso), SIN Fathom, ffmpeg ni Claude. Los nombres, mails, ids y secretos de acá son inventados.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) {
  if (/^FATHOM_/.test(k) || ['ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'DISCORD_WEBHOOK_KICKOFF', 'DISCORD_ID_TOMAS', 'DISCORD_ID_GERO_M', 'DATABASE_URL',
    'CRON_SECRET', 'KICKOFF_MODELO', 'KICKOFF_ESFUERZO', 'META_ANUNCIOS_TOKEN', 'META_CLIENTES_TOKEN', 'DESPACHO_URL', 'KICKOFF_PANTALLA', 'FFMPEG_PATH'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')
const { formatearTranscripcion } = await import('../lib/fathomAnuncios/transcripcion.ts')
const { validarSalida, normTexto, emailsExternos } = await import('../lib/bot/kickoff/extraer.ts')
const { procesarKickoff, planMapa, zvMapa } = await import('../lib/bot/kickoff/procesar.ts')
const D = await import('../lib/bot/kickoff/dedupe.ts')
const registro = await import('../lib/bot/kickoff/registro.ts')
const { armarFicha, conZonaVideo, fichaMarkdown, quienGrabo, cuentaDeGrabacion, claveFaltante, etiquetaFaltante, ETIQUETA_REVISAR_MAPA } = await import('../lib/bot/kickoff/ficha.ts')
const { armarAviso, encajar, sufijoMapa, subramaCorta, textoAvisoMapa, linkFicha, MAX_DISCORD } = await import('../lib/bot/kickoff/mensaje.ts')
const { entreComillas } = await import('../lib/bot/kickoff/ficha.ts')
const { textoParaLanzar } = await import('../lib/bot/kickoff/acciones.ts')
const { existsSync, readFileSync } = await import('node:fs')
const V = await import('../lib/bot/kickoff/vista.ts')
const Z = await import('../lib/bot/kickoff/mapa-zona.ts')
const M = await import('../lib/bot/kickoff/mapa.ts')
const { atenderMapa, CANDADO_LEYENDO_MS, ErrorDisparoMapa } = await import('../lib/bot/kickoff/mapa-api.ts')
const { dispararMapaReal } = await import('../lib/bot/kickoff/servidor.ts')
const { paraFicha } = await import('../lib/bot/kickoff/portfolio.ts')
const { FICHA_EJEMPLO } = await import('../lib/bot/kickoff/demo.ts')
const { ITEMS_PORTFOLIO } = await import('../lib/bot/kickoff/tipos.ts')
const { kbDeRama } = await import('../lib/bot/kickoff/kb/index.ts')

const TOMI = '111111111111111111', GERO = '222222222222222222'
const AHORA = Date.parse('2026-10-23T12:30:00Z')
const clonar = x => JSON.parse(JSON.stringify(x))
const hms = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')

// ── Datos de prueba (los mismos que test-bot-kickoff.mjs, con el horario agendado) ──
const renglones = (n, cada = 30) => Array.from({ length: n }, (_, i) => ({
  speaker: { display_name: i % 2 ? 'Tomas Napolitano' : 'Abogada Ana Pérez', matched_calendar_invitee_email: null }, text: `frase número ${i} de la llamada`, timestamp: hms(i * cada),
}))
const TOMAS = { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', team: null }
const GERO_M = { name: 'Gero Mozzi', email: 'gm@ejemplo.com', email_domain: 'ejemplo.com', team: null }
const reunion = (over = {}) => ({
  title: 'ANA PEREZ y Tomas Napolitano', meeting_title: 'ANA PEREZ y Tomas Napolitano', recording_id: 987654321,
  url: 'https://fathom.video/calls/111', share_url: null,
  created_at: '2026-10-23T12:22:00Z', scheduled_start_time: '2026-10-23T12:00:00Z', scheduled_end_time: '2026-10-23T12:45:00Z',
  recording_start_time: '2026-10-23T12:00:00Z', recording_end_time: '2026-10-23T12:22:00Z',
  calendar_invitees_domains_type: 'one_or_more_external',
  transcript: renglones(40),
  default_summary: { template_name: 'General', markdown_formatted: '## Propósito\nArrancar con despidos laborales en Mendoza.' },
  action_items: [],
  calendar_invitees: [
    { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: false },
    { name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true },
  ],
  recorded_by: TOMAS,
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
const IDEAS_OK = Array.from({ length: 5 }, (_, i) => ({ titulo: `Idea ${i + 1}`, gancho: `¿Te despidieron en Mendoza? ${i}`, angulo: 'liquidación', subrama: 'despidos', por_que: 'la base' }))
const IDEAS = { estado: 'a_revisar', revisores: ['Tomi', 'Gero M'], ideas: IDEAS_OK, notas: '' }
const lecturaMeta = () => ({
  cuenta: 'act_999', nombre: 'USD Estudio Ana', negocio: null, leido: true, motivo: null, aviso: null, datos: null, llamadas: 1, ms: 5, token: 'META_CLIENTES_TOKEN', generado: '2026-10-23T12:40:00Z',
  items: Object.fromEntries(ITEMS_PORTFOLIO.map(k => [k, { estado: 'ok', detalle: `${k}: ok en Meta`, fuente: 'meta', campo: 'act' }])),
  busqueda: { cuentas: [], origen: 'crm', aviso: null, avisos: [] },
})

/** Un bloque `mapa` combinado con la zona dicha de Ana (Mendoza y Godoy Cruz, 20 km). */
const mapaLeido = (over = {}) => ({
  hay_mapa: true, tipo: 'google_maps', marca: 'poligono', marca_detalle: 'polígono sobre el Gran Mendoza', radio_km: null, radio_estimado_km: null, radio_como: '',
  limites: 'de Las Heras a Luján de Cuyo', excluidas: [], mejor_cuadro: 3, momento: '00:09:30', legible: 'si', notas: '',
  lugares: [{ nombre: 'Mendoza', posicion: 'dentro' }, { nombre: 'Godoy Cruz', posicion: 'dentro' }, { nombre: 'Las Heras', posicion: 'borde' }],
  ...over,
})
const bloque = (over = {}, zona = { lugares: ['Mendoza', 'Godoy Cruz'], radio_km: null }) => M.combinarZonaConMapa(zona, mapaLeido(over)).mapa
const zvOk = (over = {}, b = bloque()) => ({ ...zvMapa('ok', 'tomas', '2026-10-23T12:40:00.000Z', { mapa: b, download_id: 'dl_hecho' }), ...over })

/** Dependencias falsas (como las de test-bot-kickoff.mjs) más las nuevas: gemela, keys de Fathom, video, zona y disparo. */
function fakes(over = {}) {
  const log = { orden: [], reclamar: [], marcar: [], gemela: [], extraer: 0, ideas: 0, enviar: [], avisar: [], pedirVideo: [], guardarZona: [], disparar: [] }
  const reloj = { t: AHORA }
  const reclamo = { intentos: 1, error_previo: null, ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null, grabador: null, zona_video: null }
  const deps = {
    reclamar: async (id, op, datos) => { log.orden.push('reclamar'); log.reclamar.push({ id, op, datos }); return { ...reclamo, ...(over.reclamo ?? {}) } },
    gemela: async (id, clave) => { log.orden.push('gemela'); log.gemela.push({ id, clave }); return null },
    guardarFicha: async () => { log.orden.push('guardarFicha') },
    guardarIdeas: async () => { log.orden.push('guardarIdeas') },
    anotarAviso: async () => { log.orden.push('anotarAviso') },
    marcar: async (id, m) => { log.orden.push(`marcar:${m.estado}`); log.marcar.push({ id, ...m }) },
    contexto: async () => ({ clientes: CONOCIDOS, estado: 'ok' }),
    extraer: async () => { log.orden.push('extraer'); log.extraer++; return { extraccion: extraccionDe(over.salida ?? {}), ajustes: [], modelo: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } },
    candidatos: async () => ({ rama: 'laboral', generado: '', ventana: { desde: '', hasta: '', dias: 180 }, cuentas: [], candidatos: [], erroresCuentas: 0, nota: '' }),
    portfolio: async () => lecturaMeta(),
    prepararPortfolio: () => {},
    kb: rama => kbDeRama(rama),
    ideas: async () => { log.orden.push('ideas'); log.ideas++; return { ideas: IDEAS_OK, notas: '', ajustes: [], modelo: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } },
    enviar: async texto => { log.orden.push('enviar'); log.enviar.push(texto); return 'msg1' },
    avisar: async t => { log.avisar.push(t) },
    esperar: async ms => { reloj.t += ms },
    ahora: () => (reloj.t += 1),
    menciones: { tomi: TOMI, gero_m: GERO },
    tomas: TOMI,
    urlBase: 'https://despacho.ejemplo.test',
    discordListo: true,
    hayApiKey: () => true,
    pedirVideo: async (id, quien) => { log.orden.push('pedirVideo'); log.pedirVideo.push({ id, quien }); return { ok: true, download_id: 'dl_1', status: 'processing' } },
    guardarZonaVideo: async (id, zv, op) => { log.orden.push(`zona:${zv.estado}`); log.guardarZona.push({ id, zv, op }); return true },
    dispararMapa: async (datos, tope) => { log.orden.push('dispararMapa'); log.disparar.push({ datos, tope }) },
    ...over,
  }
  delete deps.reclamo
  delete deps.salida
  return { deps, log, reloj }
}

// ── 1. La misma kickoff grabada por los dos ─────────────────────────────────────────────────────────
describe('dedupe (puro): ¿es la misma reunión?', () => {
  // A: la de Tomás (Gero M invitado, externo para el Fathom de Tomás). B: la misma, grabada por Gero M (Tomás externo para él)
  const A = reunion({ calendar_invitees: [
    { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: false },
    { name: 'Ana', email: 'ANA@estudio.test', email_domain: 'estudio.test', is_external: true },
    { name: 'Gero Mozzi', email: 'gm@ejemplo.com', email_domain: 'ejemplo.com', is_external: true },
    { name: 'Gero A', email: 'grabador.a@example.test', email_domain: 'gmail.com', is_external: true },
  ] })
  const B = reunion({ recording_id: 987654322, title: 'Kickoff Ana (Gero)', recorded_by: GERO_M, recording_start_time: '2026-10-23T12:01:10Z', recording_end_time: '2026-10-23T12:21:00Z', calendar_invitees: [
    { name: 'Gero Mozzi', email: 'gm@ejemplo.com', email_domain: 'ejemplo.com', is_external: false },
    { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: true },
    { name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true },
  ] })
  // C: otra kickoff de Gero M a la misma hora, con otro cliente (y Tomás invitado a las dos)
  const C = reunion({ recording_id: 987654323, meeting_title: 'BRUNO DIAZ y Gero Mozzi', recorded_by: GERO_M, calendar_invitees: [
    { name: 'Tomas Napolitano', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: true },
    { name: null, email: 'bruno@estudio.test', email_domain: 'estudio.test', is_external: true },
  ] })
  const clave = x => D.claveDeReunion(validarReunion(x).reunion, x)
  test('claveDeReunion: la hora es la agendada; huellas de los externos SIN el equipo ni quien grabó; ningún mail en la clave', () => {
    const k = clave(A)
    assert.equal(k.hora, '2026-10-23T12:00:00.000Z')
    assert.equal(k.agendado, '2026-10-23T12:00:00.000Z')
    assert.equal(k.evento, 'ana perez y tomas napolitano')
    assert.deepEqual(k.invitados, [D.huellaMail('ana@estudio.test'), D.huellaMail('gm@ejemplo.com')].sort(), 'Gero A (equipo) no cuenta; el mail va en minúsculas')
    assert.equal(k.grabo, D.huellaMail('t@ejemplo.com'))
    assert.ok(!JSON.stringify(k).includes('@'), 'sin mails')
    assert.match(D.huellaMail('x@y.test'), /^[0-9a-f]{16}$/)
    // Sin agenda: la hora es el inicio de la grabación
    const sin = { ...A, scheduled_start_time: undefined }
    assert.equal(clave(sin).hora, '2026-10-23T12:00:00.000Z')
    assert.equal(clave(sin).agendado, null)
  })
  test('la grabación de Tomás y la de Gero M de la misma llamada → la misma (por la invitada externa)', () => {
    assert.equal(D.mismaReunion(clave(A), clave(B)), 'invitado')
    assert.equal(D.mismaReunion(clave(B), clave(A)), 'invitado')
  })
  test('dos kickoffs distintas a la misma hora (Tomás invitado a las dos) → NO; tampoco con el mismo título si los invitados no se cruzan', () => {
    assert.equal(D.mismaReunion(clave(A), clave(C)), null)
    const C2 = { ...C, meeting_title: A.meeting_title }
    assert.equal(D.mismaReunion(clave(A), clave(C2)), null, 'con invitados para comparar, el título no alcanza')
  })
  test('sin invitados externos para comparar: el mismo título y el mismo horario agendado; otro título → no', () => {
    const solo = x => ({ ...x, calendar_invitees: [] })
    // En B hablan otras personas (si no, la regla de quienes hablan las juntaría: ver el test de Gero M por el link)
    const otrosHablan = x => ({ ...x, transcript: renglones(40).map(r => ({ ...r, speaker: { display_name: 'Bruno Díaz', matched_calendar_invitee_email: null } })) })
    assert.equal(D.mismaReunion(clave(solo(A)), clave(B)), 'evento')
    assert.equal(D.mismaReunion(clave(solo(A)), clave(otrosHablan({ ...B, meeting_title: 'Otra cosa' }))), null)
    assert.equal(D.mismaReunion(clave(solo(A)), clave(otrosHablan({ ...B, scheduled_start_time: undefined }))), null, 'sin agenda en las dos, el título no alcanza')
  })
  test('el MISMO Fathom (se cortó y se retomó): nunca es "la otra", aunque se pisen y compartan la invitada', () => {
    const parte1 = reunion({ recording_end_time: '2026-10-23T12:10:00Z' })
    const parte2 = reunion({ recording_id: 987654330, recording_start_time: '2026-10-23T12:10:40Z', recording_end_time: '2026-10-23T12:45:00Z' })
    assert.equal(D.mismaReunion(clave(parte1), clave(parte2)), null)
    // Sin el mail de quien grabó, por el nombre
    const sinMail = x => ({ ...x, recorded_by: { ...TOMAS, email: null } })
    assert.equal(D.mismaReunion(clave(sinMail(parte1)), clave(sinMail(parte2))), null)
  })
  test('Gero M entra por el link del Meet (sin el evento en su calendario): la misma por quienes hablan; otra reunión a la misma hora, no', () => {
    const G = reunion({ recording_id: 987654331, meeting_title: null, scheduled_start_time: undefined, calendar_invitees: [], recorded_by: GERO_M,
      recording_start_time: '2026-10-23T12:00:30Z', recording_end_time: '2026-10-23T12:22:00Z' })
    assert.equal(D.mismaReunion(clave(A), clave(G)), 'hablantes', 'la abogada habla en las dos')
    assert.equal(D.mismaReunion(clave(G), clave(A)), 'hablantes')
    // Solo habla el que grabó la otra (Tomás en la de Gero M): también
    const soloTomas = { ...G, transcript: renglones(40).map(r => ({ ...r, speaker: { display_name: 'Tomás Napolitano', matched_calendar_invitee_email: null } })) }
    assert.equal(D.mismaReunion(clave(A), clave(soloTomas)), 'hablantes', 'el que grabó una habla en la otra (sin acento igual)')
    // Otra reunión de Gero M a la misma hora, con otra persona: no
    const otra = { ...G, transcript: renglones(40).map(r => ({ ...r, speaker: { display_name: r.speaker.display_name === 'Tomas Napolitano' ? 'Gero Mozzi' : 'Bruno Díaz', matched_calendar_invitee_email: null } })) }
    assert.equal(D.mismaReunion(clave(A), clave(otra)), null)
    // Empieza 8 minutos después: no (sin calendario, la ventana es de 5)
    assert.equal(D.mismaReunion(clave(A), clave({ ...G, recording_start_time: '2026-10-23T12:08:00Z' })), null)
    // Las huellas de quienes hablan no son los nombres
    const k = clave(G)
    assert.ok(k.hablantes.length >= 1 && k.hablantes.every(h => /^[0-9a-f]{16}$/.test(h)))
    assert.ok(!JSON.stringify(k).includes('Napolitano') && !JSON.stringify(k).includes('Pérez'))
  })
  test('horarios: agendadas a otra hora → no; sin agenda, grabaciones que se pisan → sí; que no se pisan → no', () => {
    assert.equal(D.mismaReunion(clave(A), clave({ ...B, scheduled_start_time: '2026-10-23T12:30:00Z' })), null)
    const sinAgenda = x => ({ ...x, scheduled_start_time: undefined })
    assert.equal(D.mismaReunion(clave(sinAgenda(A)), clave(sinAgenda(B))), 'invitado')
    const despues = { ...sinAgenda(B), recording_start_time: '2026-10-23T12:40:00Z', recording_end_time: '2026-10-23T12:55:00Z' }
    assert.equal(D.mismaReunion(clave(sinAgenda(A)), clave(despues)), null, 'empieza 40 min después: otra llamada')
    const pegada = { ...B, recording_start_time: '2026-10-23T12:23:30Z', recording_end_time: '2026-10-23T12:40:00Z' }
    assert.equal(D.mismaReunion(clave(A), clave(pegada)), null, 'misma agenda pero las grabaciones no se pisan')
  })
  test('leerClave: basura → null; huellas inválidas se descartan; una clave de antes (sin hablantes ni procesable) se lee igual', () => {
    assert.equal(D.leerClave(null), null)
    assert.equal(D.leerClave({ invitados: ['x'] }), null)
    const k = D.leerClave({ ...clave(A), invitados: ['zz', D.huellaMail('a@b.test')], grabo: 'no', hablantes: ['zz'], procesable: false })
    assert.deepEqual(k.invitados, [D.huellaMail('a@b.test')])
    assert.equal(k.grabo, null)
    assert.deepEqual([k.hablantes, k.procesable], [[], false])
    const { hablantes: _h, grabo_nombre: _g, ...vieja } = clave(A)
    void _h; void _g
    const kv = D.leerClave(JSON.parse(JSON.stringify(vieja)))
    assert.deepEqual([kv.hablantes, kv.grabo_nombre, kv.procesable], [[], null, true])
  })
})

describe('procesarKickoff: la segunda grabación de la misma reunión queda duplicada', () => {
  test('hay gemela (la primera, aunque siga procesando) → duplicada con referencia, sin Claude ni aviso', async () => {
    const { deps, log } = fakes({ gemela: async (id, clave) => { log.gemela.push({ id, clave }); return { recording_id: 555, estado: 'procesando', grabador: 'tomas', por: 'invitado' } } })
    const r = await procesarKickoff(reunion({ recording_id: 987654322, recorded_by: GERO_M }), deps, { grabador: 'gero_m' })
    assert.equal(r.estado, 'duplicada')
    assert.equal(r.duplicada_de, 555)
    assert.match(r.motivo, /la misma reunión ya llegó en la grabación 555 \(Fathom de Tomás\)/)
    assert.equal(log.extraer, 0)
    assert.equal(log.ideas, 0)
    assert.deepEqual(log.enviar, [])
    assert.deepEqual(log.avisar, [])
    assert.deepEqual(log.pedirVideo, [])
    assert.equal(log.marcar.length, 1)
    assert.deepEqual([log.marcar[0].estado, log.marcar[0].duplicada_de], ['duplicada', 555])
    // Al reclamar se guardó quién firmó y la clave de la reunión (con la hora agendada)
    assert.equal(log.reclamar[0].datos.grabador, 'gero_m')
    assert.equal(log.reclamar[0].datos.clave.hora, '2026-10-23T12:00:00.000Z')
    assert.equal(log.gemela[0].clave, log.reclamar[0].datos.clave)
    // Antes de mirar Discord: una duplicada no necesita el webhook
    const sinDiscord = fakes({ discordListo: false, gemela: async () => ({ recording_id: 555, estado: 'lista', grabador: null, por: 'evento' }) })
    assert.equal((await procesarKickoff(reunion(), sinDiscord.deps)).estado, 'duplicada')
  })
  test('sin gemela → sigue normal; si la búsqueda falla, también (mejor dos fichas que ninguna)', async () => {
    let { deps, log } = fakes()
    assert.equal((await procesarKickoff(reunion(), deps)).estado, 'lista')
    assert.deepEqual(log.orden.slice(0, 2), ['reclamar', 'gemela'])
    ;({ deps, log } = fakes({ gemela: async () => { throw new Error('la base no respondió') } }))
    assert.equal((await procesarKickoff(reunion(), deps)).estado, 'lista')
    assert.equal(log.extraer, 1)
  })
  test('el payload guardado conserva el inicio agendado: un reintento arma la MISMA clave (no la pisa con el inicio de la grabación)', async () => {
    let { deps, log } = fakes()
    await procesarKickoff(reunion({ recording_start_time: '2026-10-23T12:03:00Z' }), deps)
    const guardado = log.reclamar[0].datos.payload
    assert.equal(guardado.scheduled_start_time, '2026-10-23T12:00:00Z')
    const primera = log.reclamar[0].datos.clave
    ;({ deps, log } = fakes())
    await procesarKickoff(guardado, deps)
    assert.deepEqual(log.reclamar[0].datos.clave, primera)
    assert.equal(primera.hora, '2026-10-23T12:00:00.000Z')
  })
  test('una grabación que no se va a procesar (sin transcripción o cortada) no busca gemela y lo anota en la clave', async () => {
    // Sin transcripción: queda en error (con su aviso de activar Transcript), no "duplicada" de la otra
    let { deps, log } = fakes({ gemela: async () => { throw new Error('no se tenía que buscar') } })
    let r = await procesarKickoff(reunion({ transcript: null }), deps)
    assert.equal(r.estado, 'error')
    assert.equal(log.reclamar[0].datos.clave.procesable, false, 'la que llegue después no la toma como la buena')
    ;({ deps, log } = fakes({ gemela: async () => { throw new Error('no se tenía que buscar') } }))
    r = await procesarKickoff(reunion({ transcript: renglones(3) }), deps)
    assert.equal(r.estado, 'omitida')
    assert.equal(log.reclamar[0].datos.clave.procesable, false)
    ;({ deps, log } = fakes())
    await procesarKickoff(reunion(), deps)
    assert.equal(log.reclamar[0].datos.clave.procesable, true)
    assert.equal(log.gemela.length, 1)
  })
  test('con forzar o en seco no se busca la gemela', async () => {
    let { deps, log } = fakes()
    await procesarKickoff(reunion(), deps, { forzar: true })
    assert.deepEqual(log.gemela, [])
    ;({ deps, log } = fakes())
    assert.equal((await procesarKickoff(reunion(), deps, { dry: true })).estado, 'dry')
    assert.deepEqual(log.gemela, [])
  })
})

// ── 2. Registro: columnas nuevas, gemela, duplicada, zona del video (SQL contra un Neon falso) ──────────
describe('registro: SQL de lo nuevo contra un Neon falso', () => {
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
  const fila = { intentos: 1, error: null, ficha: null, ideas: null, version_prompt: null, version_ideas: null, modelo: null, tokens_in: null, tokens_out: null, aviso_discord: null, grabador: 'gero_m', zona_video: null }
  const claveA = D.claveDeReunion(r0, reunion())

  test('migración SOLO aditiva: suma las columnas que faltan (ADD COLUMN IF NOT EXISTS, sin default ni NOT NULL) y no toca las que hay', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('SELECT column_name') ? [{ column_name: 'faltantes_checks' }, { column_name: 'grabador' }] : t.startsWith('INSERT') ? [fila] : []))
      registro.sqlParaPruebas(n.fabrica)
      await registro.reclamar(7, { forzar: false }, { titulo: 'T', url: 'https://fathom.video/calls/1', payload: {}, grabador: 'gero_m', clave: claveA })
      const crear = n.consultas.find(c => c.texto.startsWith('CREATE TABLE'))
      for (const col of ['grabador text', 'agendado timestamptz', 'dedupe jsonb', 'duplicada_de bigint', 'zona_video jsonb', 'aviso_ads text']) assert.ok(crear.texto.includes(col), col)
      const alter = n.consultas.filter(c => c.texto.startsWith('ALTER'))
      assert.deepEqual(alter.map(c => c.texto), [
        'ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS agendado timestamptz',
        'ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS dedupe jsonb',
        'ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS duplicada_de bigint',
        'ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS zona_video jsonb',
        'ALTER TABLE cj_kickoffs ADD COLUMN IF NOT EXISTS aviso_ads text',   // el aviso a Valentino (24/10, aviso-ads.ts)
      ])
      assert.ok(!n.consultas.some(c => /DROP|ALTER COLUMN|RENAME/.test(c.texto)))
      // El INSERT guarda quién firmó, la hora (para buscar) y la clave
      const ins = n.consultas.find(c => c.texto.startsWith('INSERT'))
      // …y la marca del aviso a Valentino en '' (fila nueva, todavía sin aviso: NULL queda para las de antes del aviso)
      assert.match(ins.texto, /INSERT INTO cj_kickoffs \(recording_id, estado, titulo, url, payload, grabador, agendado, dedupe, aviso_ads\) VALUES \(.*, ''\)/)
      assert.ok(ins.valores.includes('gero_m') && ins.valores.includes(claveA.hora) && ins.valores.includes(JSON.stringify(claveA)))
      assert.match(ins.texto, /RETURNING .*grabador, zona_video$/)
    } finally { limpiar() }
  })
  test('reclamar existente: grabador, agendado y clave con COALESCE (un reintento sin ellos conserva los de antes); forzar borra la lectura del mapa', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('UPDATE') ? [fila] : []))
      registro.sqlParaPruebas(n.fabrica)
      const r = await registro.reclamar(7, { forzar: true }, { titulo: 'T', url: 'u', payload: {} })
      assert.equal(r.grabador, 'gero_m')
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /grabador = COALESCE\(\$\d+, grabador\), agendado = COALESCE\(\$\d+::timestamptz, agendado\), dedupe = COALESCE\(\$\d+::jsonb, dedupe\)/)
      assert.match(u.texto, /zona_video = CASE WHEN \$\d+::boolean THEN NULL ELSE zona_video END/)
      assert.match(u.texto, /duplicada_de = CASE WHEN \$\d+::boolean THEN NULL ELSE duplicada_de END/)
    } finally { limpiar() }
  })
  test('buscarGemela: ventana de ±20 min sobre agendado, anteriores por (creado, recording_id), sin omitidas, duplicadas ni "sin transcripción"; afina con mismaReunion', async () => {
    try {
      const B = reunion({ recording_id: 987654322, recorded_by: GERO_M, calendar_invitees: [{ name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true }, { name: 'T', email: 't@ejemplo.com', email_domain: 'ejemplo.com', is_external: true }] })
      const claveB = D.claveDeReunion(validarReunion(B).reunion, B)
      const conBruno = reunion({ calendar_invitees: [{ name: null, email: 'bruno@estudio.test', email_domain: 'estudio.test', is_external: true }] })
      const otra = D.claveDeReunion(validarReunion(conBruno).reunion, conBruno)
      const n = neonFalso(t => (t.startsWith('SELECT c.recording_id') ? [
        { recording_id: '444', estado: 'lista', grabador: 'tomas', dedupe: otra },
        { recording_id: '555', estado: 'procesando', grabador: 'tomas', dedupe: claveA },
      ] : []))
      registro.sqlParaPruebas(n.fabrica)
      const g = await registro.buscarGemela(987654322, claveB)
      assert.deepEqual(g, { recording_id: 555, estado: 'procesando', grabador: 'tomas', por: 'invitado' })
      const c = n.consultas.find(x => x.texto.startsWith('SELECT c.recording_id'))
      assert.match(c.texto, /FROM cj_kickoffs c JOIN cj_kickoffs yo ON yo.recording_id = \$1 WHERE c.recording_id <> \$2 AND c.agendado BETWEEN \$3::timestamptz AND \$4::timestamptz/)
      assert.match(c.texto, /AND c.estado NOT IN \('omitida', 'duplicada'\) AND NOT \(c.estado = 'error' AND starts_with\(COALESCE\(c.error, ''\), \$5\)\)/)
      assert.match(c.texto, /AND NOT \(c.grabador IS NOT NULL AND yo.grabador IS NOT NULL AND c.grabador = yo.grabador\) AND \(c.creado, c.recording_id\) < \(yo.creado, yo.recording_id\) ORDER BY c.creado, c.recording_id LIMIT 10$/, 'la misma cuenta de Fathom no es "la otra"')
      assert.deepEqual(c.valores.slice(2), ['2026-10-23T11:40:00.000Z', '2026-10-23T12:20:00.000Z', 'sin_transcripcion:'])
      // Sin hora no se consulta nada; sin coincidencia → null
      const antes = n.consultas.length
      assert.equal(await registro.buscarGemela(1, { ...claveB, hora: null }), null)
      assert.equal(n.consultas.length, antes)
      assert.equal(await registro.buscarGemela(1, { ...claveB, invitados: [D.huellaMail('nadie@x.test')], evento: 'otra' }), null)
    } finally { limpiar() }
  })
  test('buscarGemela: una fila que según su clave no se va a procesar (procesable: false) no gana, aunque siga "procesando"', async () => {
    try {
      const B = reunion({ recording_id: 987654322, recorded_by: GERO_M, calendar_invitees: [{ name: null, email: 'ana@estudio.test', email_domain: 'estudio.test', is_external: true }] })
      const claveB = D.claveDeReunion(validarReunion(B).reunion, B)
      const n = neonFalso(t => (t.startsWith('SELECT c.recording_id') ? [{ recording_id: '555', estado: 'procesando', grabador: 'tomas', dedupe: { ...claveA, procesable: false } }] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.equal(await registro.buscarGemela(987654322, claveB), null)
    } finally { limpiar() }
  })
  test('la migración mira las columnas en el schema de la conexión (una copia en otro schema no cuenta)', async () => {
    try {
      const n = neonFalso(t => (t.startsWith('INSERT') ? [fila] : []))
      registro.sqlParaPruebas(n.fabrica)
      await registro.reclamar(7, { forzar: false }, { titulo: 'T', url: 'u', payload: {} })
      const c = n.consultas.find(x => x.texto.startsWith('SELECT column_name'))
      assert.match(c.texto, /FROM information_schema.columns WHERE table_schema = current_schema\(\) AND table_name = 'cj_kickoffs'/)
    } finally { limpiar() }
  })
  test('gemelasDe (pantalla): las duplicadas de una ficha por to_jsonb, sin crear nada; leerPayload trae duplicada_de', async () => {
    try {
      const n = neonFalso(t => (t.includes("estado = 'duplicada'") ? [{ recording_id: '987654322', url: 'https://fathom.video/calls/222', grabador: 'gero_m' }]
        : t.startsWith('SELECT payload') ? [{ payload: null, estado: 'duplicada', intentos: 1, grabador: 'gero_m', duplicada_de: '555' }] : []))
      registro.sqlParaPruebas(n.fabrica)
      assert.deepEqual(await registro.gemelasDe(555), [{ recording_id: 987654322, url: 'https://fathom.video/calls/222', grabador: 'gero_m' }])
      const c = n.consultas.find(x => x.texto.includes("estado = 'duplicada'"))
      assert.match(c.texto, /WHERE estado = 'duplicada' AND to_jsonb\(cj_kickoffs\) ->> 'duplicada_de' = \$1/)
      assert.deepEqual(c.valores, ['555'])
      assert.equal((await registro.leerPayload(9)).duplicada_de, 555)
      assert.deepEqual(await registro.gemelasDe(-1), [])
      assert.ok(!n.consultas.some(x => /CREATE|ALTER/.test(x.texto)))
      assert.deepEqual(V.gemelasVista([{ recording_id: 987654322, url: 'https://fathom.video/calls/222', grabador: 'gero_m' }, { recording_id: 3, url: 'javascript:alert(1)', grabador: null }]),
        [{ recording_id: 987654322, quien: 'Gero M', fathom: 'https://fathom.video/calls/222' }, { recording_id: 3, quien: 'el otro Fathom', fathom: null }])
    } finally { limpiar() }
  })
  test('marcar duplicada: guarda la referencia y borra el payload (es un estado final)', async () => {
    try {
      const n = neonFalso(() => [])
      registro.sqlParaPruebas(n.fabrica)
      await registro.marcar(9, { estado: 'duplicada', duplicada_de: 555, error: 'la misma reunión…' })
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /duplicada_de = COALESCE\(\$\d+::bigint, duplicada_de\)/)
      assert.ok(u.valores.includes(555))
      assert.ok(registro.ESTADOS_FINALES.includes('duplicada'))
      const i = u.texto.indexOf('payload = CASE WHEN')
      assert.ok(i > 0)
      assert.ok(u.valores.includes(true), 'final → payload NULL')
    } finally { limpiar() }
  })
  test('guardarZonaVideo: solo la columna zona_video (ni ficha, ni estado, ni actualizado); con libre, el candado de "leyendo" y la versión; dry no escribe', async () => {
    try {
      let n = neonFalso(t => (t.startsWith('UPDATE') ? [{ recording_id: 7 }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const zv = zvMapa('pedido', 'tomas', '2026-10-23T12:40:00.000Z', { download_id: 'dl_1' })
      assert.equal(await registro.guardarZonaVideo(7, zv, { libre: true, ahoraMs: 1234 }), true)
      const u = n.consultas.find(c => c.texto.startsWith('UPDATE'))
      assert.match(u.texto, /^UPDATE cj_kickoffs SET zona_video = \$1::jsonb WHERE recording_id = \$2 AND \(NOT \$3::boolean OR zona_video IS NULL OR COALESCE\(zona_video ->> 'version', ''\) <> \$4 OR COALESCE\(zona_video ->> 'estado', ''\) IN \('pedido', 'error', 'sin_key'\) OR \(zona_video ->> 'estado' = 'leyendo' AND CASE WHEN zona_video ->> 'vence_ms' ~ '\^\[0-9\]\{1,15\}\$' THEN \(zona_video ->> 'vence_ms'\)::bigint ELSE 0 END < \$5\)\) RETURNING recording_id$/)
      assert.ok(!/actualizado|ficha|SET estado/.test(u.texto))
      assert.deepEqual([JSON.parse(u.valores[0]).download_id, u.valores[1], u.valores[2], u.valores[3], u.valores[4]], ['dl_1', 7, true, M.VERSION_MAPA, 1234])
      n = neonFalso(() => [])
      registro.sqlParaPruebas(n.fabrica)
      assert.equal(await registro.guardarZonaVideo(7, zv, { libre: true }), false, 'otro la está leyendo (o no hay fila)')
      const antes = n.consultas.length
      assert.equal(await registro.guardarZonaVideo(7, zv, { dry: true }), true)
      assert.equal(n.consultas.length, antes, 'dry no toca la base')
    } finally { limpiar() }
  })
  test('lecturas: zona_video, grabador y duplicada_de por to_jsonb (andan sin la columna) y sin crear nada', async () => {
    try {
      const n = neonFalso(t => (t.includes('FROM cj_kickoffs WHERE recording_id') ? [{ recording_id: '7', estado: 'lista', payload: null, intentos: 1, grabador: 'tomas', duplicada_de: '5', creado: new Date(0), actualizado: new Date(0), zona_video: null }] : []))
      registro.sqlParaPruebas(n.fabrica)
      const k = await registro.leerKickoff(7)
      assert.equal(k.duplicada_de, 5)
      const p = await registro.leerPayload(7)
      assert.equal(p.grabador, 'tomas')
      await registro.listarFichasCliente('A101')
      for (const c of n.consultas) {
        assert.ok(!/CREATE|ALTER/.test(c.texto))
        if (/zona_video|grabador/.test(c.texto)) assert.match(c.texto, /to_jsonb\(cj_kickoffs\) -(>|>>) '(zona_video|grabador)'/)
      }
      assert.ok(n.consultas.some(c => /to_jsonb\(cj_kickoffs\) -> 'zona_video' AS zona_video/.test(c.texto) && /upper\(id_crm\)/.test(c.texto)), 'la pantalla lee la columna')
    } finally { limpiar() }
  })
})

// ── 3. Quién grabó (la cuenta que firmó el webhook) ─────────────────────────────────────────────────
describe('grabador: la cuenta de Fathom que firmó', () => {
  test('quienGrabo: recorded_by manda; si no alcanza (no vino u otro nombre), la cuenta que firmó', () => {
    assert.deepEqual(quienGrabo(null, 'gero_m'), { nombre: null, email: null, quien: 'Gero M', cuenta_fathom: 'gero_m' })
    assert.equal(quienGrabo({ name: 'Gerónimo', email: 'g@x.test' }, 'gero_m').quien, 'Gero M')
    assert.equal(quienGrabo({ name: 'Tomas Napolitano', email: null }, 'gero_m').quien, 'Tomás', 'por nombre gana recorded_by')
    assert.equal(quienGrabo({ name: 'Otra Persona', email: null }).quien, null)
    assert.equal(quienGrabo(null), null)
    assert.equal(cuentaDeGrabacion('gero_m', TOMAS), 'gero_m', 'la que firmó es la de la API key')
    assert.equal(cuentaDeGrabacion(null, GERO_M), 'gero_m')
    assert.equal(cuentaDeGrabacion(null, { name: 'Otra', email: null }), null)
  })
  test('procesarKickoff: el grabador va al reclamo y, sin recorded_by, el aviso dice "Kickoff de Gero M"; si no viene, el de la fila', async () => {
    let { deps, log } = fakes()
    let r = await procesarKickoff(reunion({ recorded_by: null }), deps, { grabador: 'gero_m' })
    assert.equal(r.estado, 'lista')
    assert.equal(log.reclamar[0].datos.grabador, 'gero_m')
    assert.equal(r.grabador, 'gero_m')
    assert.match(log.enviar[0], /\n📞 Kickoff de Gero M · /)
    assert.equal(r.ficha.grabo.cuenta_fathom, 'gero_m')
    ;({ deps, log } = fakes({ reclamo: { grabador: 'gero_m' } }))
    r = await procesarKickoff(reunion({ recorded_by: { name: 'Gerónimo', email: null, email_domain: null, team: null } }), deps)
    assert.equal(log.reclamar[0].datos.grabador, null, 'sin firma (modo manual) no se pisa')
    assert.equal(r.grabador, 'gero_m')
    assert.match(log.enviar[0], /Kickoff de Gero M/)
    assert.deepEqual(log.pedirVideo, [{ id: 987654321, quien: 'gero_m' }], 'el video se pide con la key de quien grabó')
  })
})

// ── 4. Zona desde el video, integrada al bot ────────────────────────────────────────────────────────
describe('procesarKickoff: zona desde el video', () => {
  test('con mapa en pantalla y la key: pide el video ANTES de las ideas, guarda el download_id y, con la ficha lista, dispara la lectura', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    const i = n => log.orden.indexOf(n)
    assert.ok(i('pedirVideo') > i('guardarFicha') && i('pedirVideo') < i('ideas'), log.orden.join(' → '))
    assert.ok(i('zona:pedido') > 0)
    assert.ok(i('dispararMapa') > i('marcar:lista'), 'el disparo va después de marcar "lista"')
    assert.deepEqual(log.pedirVideo, [{ id: 987654321, quien: 'tomas' }])
    assert.deepEqual(log.guardarZona[0].zv.download_id, 'dl_1')
    assert.equal(log.guardarZona[0].op.libre, true, 'no pisa una lectura en curso')
    assert.equal(log.guardarZona[0].zv.version, M.VERSION_MAPA)
    assert.deepEqual(log.disparar[0].datos, { recording_id: 987654321, quien: 'tomas', descarga_id: 'dl_1' })
    assert.ok(log.disparar[0].tope <= 8_000)
    assert.deepEqual(r.mapa, { plan: 'pedir', quien: 'tomas', estado: 'disparado', download_id: 'dl_1' })
    // El aviso dice que lo está leyendo el bot (no "se lee del video", que se entendía como "andá a mirarlo")
    assert.match(log.enviar[0], /📍 \*\*Zona:\*\* [^\n]* · 🗺️ marcada en el mapa \(el bot la está leyendo del video: el resultado queda en la ficha\)\n/)
    const fz = r.ficha.faltantes.find(x => claveFaltante(x) === 'zona_mapa')
    assert.equal(fz, 'Zona del mapa: se está leyendo del video (en unos minutos queda acá; si preferís, anotá el recorte a mano)', 'no pide anotarlo mientras lo lee el bot')
    assert.match(log.enviar[0], /⚠️ \*\*Falta completar \(\d+\):\*\* recorte de la zona \(lo está leyendo el bot\)/)
  })
  test('sin FATHOM_API_KEY de quien grabó: no se pide nada; queda "sin_key" y el faltante dice qué conectar', async () => {
    const { deps, log } = fakes({ hayApiKey: q => q === 'tomas' })
    const r = await procesarKickoff(reunion({ recorded_by: GERO_M }), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual(log.pedirVideo, [])
    assert.deepEqual(log.disparar, [])
    assert.equal(log.guardarZona[0].zv.estado, 'sin_key')
    assert.equal(log.guardarZona[0].zv.motivo, 'conectar la API key de Fathom de Gero M para leer el mapa')
    assert.match(r.ficha.faltantes.find(x => claveFaltante(x) === 'zona_mapa'), /conectar la API key de Fathom de Gero M para leer el mapa/)
    assert.equal(r.mapa.estado, 'sin_key')
  })
  test('no se sabe con qué cuenta se grabó (otra persona, sin firma): sin_key con el motivo', async () => {
    const { deps, log } = fakes()
    await procesarKickoff(reunion({ recorded_by: { name: 'Asistente', email: 'a@otro.test', email_domain: 'otro.test', team: null } }), deps)
    assert.deepEqual(log.pedirVideo, [])
    assert.match(log.guardarZona[0].zv.motivo, /no se sabe con qué cuenta de Fathom/)
  })
  test('en seco NO se pide el video (no se crean descargas en Fathom) ni se guarda o dispara nada', async () => {
    const { deps, log } = fakes()
    const r = await procesarKickoff(reunion(), deps, { dry: true })
    assert.equal(r.estado, 'dry')
    assert.deepEqual([log.pedirVideo, log.guardarZona, log.disparar], [[], [], []])
    assert.deepEqual(r.mapa, { plan: 'dry', quien: 'tomas', estado: null })
  })
  test('retomar: con el mapa ya leído (misma versión) no se repite y la ficha lo trae; el faltante del recorte queda resuelto', async () => {
    const { deps, log } = fakes({ reclamo: { zona_video: zvOk() } })
    const r = await procesarKickoff(reunion(), deps)
    assert.deepEqual([log.pedirVideo, log.disparar, log.guardarZona], [[], [], []])
    assert.equal(r.ficha.zona.mapa.lugares.join(', '), 'Mendoza, Godoy Cruz, Las Heras')
    assert.ok(!r.ficha.faltantes.some(x => claveFaltante(x) === 'zona_mapa'), r.ficha.faltantes.join(' | '))
    assert.match(log.enviar[0], /🗺️ coincide con el mapa del video\n/)
    assert.equal(r.mapa.plan, 'nada')
  })
  test('retomar: una descarga ya pedida (misma versión) se retoma sin pedir otra; con una versión vieja se vuelve a pedir; con forzar también', async () => {
    let { deps, log } = fakes({ reclamo: { zona_video: zvMapa('pedido', 'tomas', '2026-10-23T12:31:00.000Z', { download_id: 'dl_viejo' }) } })
    await procesarKickoff(reunion(), deps)
    assert.deepEqual(log.pedirVideo, [])
    assert.equal(log.disparar[0].datos.descarga_id, 'dl_viejo')
    ;({ deps, log } = fakes({ reclamo: { zona_video: zvOk({ version: 'm1-2026-10-24' }) } }))
    await procesarKickoff(reunion(), deps)
    assert.equal(log.pedirVideo.length, 1, 'versión vieja: se mira de nuevo')
    ;({ deps, log } = fakes({ reclamo: { zona_video: zvOk() } }))
    await procesarKickoff(reunion(), deps, { forzar: true })
    assert.equal(log.pedirVideo.length, 1)
    // Una lectura en curso (candado vigente) no se pisa ni se vuelve a disparar
    ;({ deps, log } = fakes({ reclamo: { zona_video: { ...zvMapa('leyendo', 'tomas', '2026-10-23T12:31:00.000Z'), vence_ms: AHORA + 60_000 } } }))
    await procesarKickoff(reunion(), deps)
    assert.deepEqual([log.pedirVideo, log.disparar], [[], []])
  })
  test('el disparo falla: queda anotado en zona_video (error, para reintentar, con el download_id) y la ficha sigue "lista"', async () => {
    const { deps, log } = fakes({ dispararMapa: async () => { throw new Error('la ruta del mapa respondió 502') } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    const ultimo = log.guardarZona.at(-1)
    assert.equal(ultimo.zv.estado, 'error')
    assert.equal(ultimo.zv.transitorio, true)
    assert.equal(ultimo.zv.download_id, 'dl_1')
    assert.equal(ultimo.zv.motivo, 'no se pudo disparar la lectura del mapa (la ruta del mapa respondió 502)')
    // Cómo reintentarla lo dice la ficha (con el recording_id), una sola vez
    assert.match(conZonaVideo(r.ficha, ultimo.zv).faltantes.find(x => claveFaltante(x) === 'zona_mapa'),
      /no se pudo leer del video \(no se pudo disparar la lectura del mapa \(la ruta del mapa respondió 502\)\): para reintentar, pedile a Claude que relea el mapa de la grabación 987654321\)$/)
    assert.equal(r.mapa.estado, 'error')
  })
  test('Fathom dice que no hay video (422 / solo audio): no se dispara; un error pasajero del pedido igual dispara (la ruta lo vuelve a pedir)', async () => {
    let { deps, log } = fakes({ pedirVideo: async () => ({ ok: false, estado: 'sin_video', motivo: 'la grabación no tiene video para bajar', transitorio: false }) })
    let r = await procesarKickoff(reunion(), deps)
    assert.deepEqual(log.disparar, [])
    assert.equal(log.guardarZona[0].zv.estado, 'sin_video')
    assert.equal(r.mapa.estado, 'sin_video')
    assert.match(r.ficha.faltantes.find(x => claveFaltante(x) === 'zona_mapa'), /la grabación no tiene video/)
    ;({ deps, log } = fakes({ pedirVideo: async () => ({ ok: false, estado: 'error', motivo: 'Fathom respondió 503', transitorio: true }) }))
    r = await procesarKickoff(reunion(), deps)
    assert.deepEqual(log.disparar[0].datos, { recording_id: 987654321, quien: 'tomas', descarga_id: null })
  })
  test('sin mapa en pantalla, o si no es un kickoff: nada del video', async () => {
    let { deps, log } = fakes({ salida: { zona: { ...salidaClaude().zona, mapa_en_pantalla: false } } })
    await procesarKickoff(reunion(), deps)
    assert.deepEqual([log.pedirVideo, log.guardarZona, log.disparar], [[], [], []])
    ;({ deps, log } = fakes({ salida: { tipo_reunion: 'seguimiento' } }))
    assert.equal((await procesarKickoff(reunion(), deps)).estado, 'no_kickoff')
    assert.deepEqual([log.pedirVideo, log.guardarZona, log.disparar], [[], [], []])
  })
  test('planMapa (puro): sin hayApiKey (fakes viejos) no hace nada; terminado con esta versión, tampoco', () => {
    const base = { mapaEnPantalla: true, previo: null, quien: 'tomas', hayApiKey: () => true, dry: false, ahoraMs: AHORA }
    assert.equal(planMapa({ ...base, hayApiKey: undefined }).tipo, 'nada')
    assert.deepEqual(planMapa(base), { tipo: 'pedir', quien: 'tomas', descarga: null, zv: null })
    for (const estado of ['ok', 'sin_mapa', 'sin_video']) assert.equal(planMapa({ ...base, previo: { ...zvOk(), estado } }).tipo, 'nada', estado)
    assert.equal(planMapa({ ...base, previo: zvMapa('error', 'tomas', '', { transitorio: true, download_id: 'dl_9' }) }).descarga, 'dl_9')
    assert.equal(planMapa({ ...base, previo: zvMapa('error', 'tomas', '', { transitorio: false, download_id: 'dl_9' }) }).descarga, null, 'un error definitivo se pide de nuevo')
    assert.equal(planMapa({ ...base, previo: zvMapa('pedido', 'gero_m', '', { download_id: 'dl_9' }) }).descarga, null, 'la descarga de otra cuenta no sirve')
    assert.equal(planMapa({ ...base, dry: true }).tipo, 'dry')
  })
})

describe('mapa en la ficha, el markdown, la pantalla y el aviso', () => {
  const ficha = (zv, over = {}) => armarFicha({ reunion: r0, extraccion: extraccionDe(over), ajustes: [], ideas: IDEAS, ganadores: null, portfolioMeta: paraFicha(lecturaMeta()), zonaVideo: zv })
  const faltMapa = f => f.faltantes.find(x => claveFaltante(x) === 'zona_mapa' || claveFaltante(x) === 'zona_mapa_video') ?? null
  test('faltante: mapa leído que coincide → resuelto; con diferencias → "revisar" (clave propia); se lee en parte → "confirmar"; sin leer → el porqué', () => {
    assert.equal(faltMapa(ficha(zvOk())), null)
    const conRadio = ficha(zvOk({}, bloque({ marca: 'pin_con_radio', radio_km: 17, lugares: [{ nombre: 'Mendoza', posicion: 'dentro' }] }, { lugares: ['Mendoza', 'Godoy Cruz'], radio_km: 20 })))
    const t = faltMapa(conRadio)
    assert.match(t, /^Zona del mapa: revisar las diferencias entre el mapa del video y lo dicho \(ojo: se nombró Godoy Cruz y en el mapa no aparece su nombre: puede estar dentro sin nombre, afuera o mal oído; ojo: se dijo 20 km y en el mapa se lee 17 km; el mapa se ve ▶ 09:30\)$/)
    assert.equal(claveFaltante(t), 'zona_mapa_video', 'una nota del recorte anotada antes no lo tapa')
    assert.equal(etiquetaFaltante(t), ETIQUETA_REVISAR_MAPA)
    assert.equal(etiquetaFaltante(faltMapa(ficha(null))), 'recorte de la zona (mapa)')
    // Coincide pero se lee en parte: confirmar lo leído (antes desaparecía y nadie lo revisaba)
    const parcial = faltMapa(ficha(zvOk({}, bloque({ legible: 'parcial' }))))
    assert.equal(parcial, 'Zona del mapa: confirmar el recorte leído del video (se lee en parte; el mapa se ve ▶ 09:30)')
    assert.deepEqual([claveFaltante(parcial), etiquetaFaltante(parcial)], ['zona_mapa_video', 'confirmar el recorte (mapa)'])
    // Sin mapa en esos minutos: el ▶ es a cuando se habló de la zona (no "se ve en la grabación")
    const sinMapa = faltMapa(ficha(zvMapa('sin_mapa', 'tomas', '')))
    assert.match(sinMapa, /\(se habló de la zona ▶ 08:00; se nombró Mendoza y Godoy Cruz; en los minutos de la zona el video no muestra el mapa\)$/)
    // Un error pasajero dice cómo reintentar (la pantalla no tiene botón)
    assert.match(faltMapa(ficha(zvMapa('error', 'tomas', '', { motivo: 'Fathom no respondió', transitorio: true }))), /no se pudo leer del video \(Fathom no respondió\): para reintentar, pedile a Claude que relea el mapa de la grabación 987654321\)$/)
    // Ilegible: el recorte sigue para anotar
    assert.match(faltMapa(ficha(zvOk({}, bloque({ legible: 'no' })))), /el mapa del video no deja leer el recorte\)$/)
    // Sin el minuto de la zona (lo guardó planMapa): el porqué
    assert.match(faltMapa(ficha(zvMapa('error', 'tomas', '', { motivo: Z.MOTIVO_SIN_MOMENTO }))), /no se pudo leer del video \(la ficha no tiene el minuto en que se habló de la zona: no se sabe qué parte del video mirar\)\)$/)
  })
  test('markdown: el bloque "Mapa según el video" con su ▶, lugares, límites, radio y lo que no coincide', () => {
    const md = fichaMarkdown(ficha(zvOk({}, bloque({ excluidas: ['Maipú'] }, { lugares: ['Mendoza', 'Tunuyán'], radio_km: null }))))
    assert.match(md, /- 🗺️ Mapa según el video \[▶ 09:30\]\(https:\/\/fathom\.video\/calls\/111\?timestamp=570\) \(Google Maps, polígono\):\n  - Zona marcada: Mendoza, Godoy Cruz, Las Heras\n  - Límites: de Las Heras a Luján de Cuyo\n  - Excluidas: Maipú\n  - Coincide con lo dicho: Mendoza/)
    assert.match(md, /  - ⚠️ Ojo: se nombró Tunuyán y en el mapa no aparece su nombre: puede estar dentro sin nombre, afuera o mal oído/)
    assert.ok(!md.includes('En el mapa también (no se dijo)'), 'con un polígono no se repite la zona marcada')
    // Con un pin de Meta: la ubicación configurada con su radio y aparte lo que se lee dentro del círculo
    const pin = bloque({ tipo: 'meta_ads', marca: 'pin_con_radio', radio_km: 20, lugares: [{ nombre: 'Mendoza, Mendoza, Argentina', posicion: 'lista_incluida' }, { nombre: 'Las Heras', posicion: 'dentro' }] })
    const mdPin = fichaMarkdown(ficha(zvOk({}, pin)))
    assert.match(mdPin, /  - Ubicación marcada: Mendoza, Mendoza, Argentina \+20 km\n  - Dentro del círculo se lee: Las Heras\n/)
    assert.ok(!/  - Radio: /.test(mdPin), 'el radio ya va con la ubicación')
    assert.ok(!md.includes('el recorte exacto no está en la transcripción'))
    assert.match(fichaMarkdown(ficha(zvMapa('pedido', 'tomas', ''))), /- 🗺️ Se marcó en un mapa en pantalla: el recorte exacto no está en la transcripción \(se está leyendo del video\)\./)
  })
  test('conZonaVideo: la lectura de la columna manda sobre la que traía la ficha y recalcula los faltantes', () => {
    const f = ficha(zvMapa('pedido', 'tomas', ''))
    assert.ok(faltMapa(f))
    const g = conZonaVideo(f, zvOk())
    assert.equal(g.zona_video.estado, 'ok')
    assert.equal(faltMapa(g), null)
    assert.equal(conZonaVideo(f, { basura: true }), f, 'lo que no tiene forma no cambia nada')
  })
  test('pantalla: el bloque del mapa (lugares, marca, ▶, lo que no coincide), el faltante con el ▶ del mapa y la columna manda', () => {
    const f = clonar(FICHA_EJEMPLO)
    const b = M.combinarZonaConMapa(f.zona, mapaLeido({ lugares: [{ nombre: 'Colonia Ejemplo', posicion: 'dentro' }, { nombre: 'Paraje Norte', posicion: 'dentro' }], momento: '00:18:05' })).mapa
    const fila = { recording_id: f.recording_id, estado: 'lista', titulo: f.titulo, url: f.url, cliente_crm: 'C', id_crm: 'E157', error: null, ideas: null, revision: null, portfolio_checks: null, faltantes_checks: null,
      creado: '2026-10-24T17:00:00.000Z', actualizado: '2026-10-24T17:00:00.000Z', ficha: { ...f, zona_video: zvMapa('sin_key', 'tomas', '', { motivo: 'x' }) }, zona_video: zvOk({}, b) }
    const v = V.armarVista(fila, Date.parse('2026-10-24T18:00:00Z'))
    const m = v.zona.video
    assert.equal(m.estado, 'ok', 'la columna manda')
    assert.deepEqual([m.fuente, m.lugares, m.coinciden], ['Google Maps · polígono', ['Colonia Ejemplo', 'Paraje Norte'], ['Colonia Ejemplo', 'Paraje Norte']])
    assert.equal(m.momento.href, 'https://fathom.video/calls/100000001?timestamp=1085')
    assert.equal(m.ojos.join(' | '), 'se nombraron Villa Inventada y El Molino y en el mapa no aparecen sus nombres: pueden estar dentro sin nombre, afuera o mal oídos (El Molino, de oído)')
    assert.equal(m.coincide, false)
    // Lo marcado, con ✓ lo que se dijo; con un polígono, «en el mapa, sin que se dijera» no repite la zona
    assert.deepEqual(m.marcados, [{ nombre: 'Colonia Ejemplo', dicho: true }, { nombre: 'Paraje Norte', dicho: true }])
    assert.deepEqual(m.tambien, [])
    const fz = v.faltantes.find(x => x.clave === 'zona_mapa_video')
    assert.match(fz.texto, /^Zona del mapa: revisar/)
    assert.equal(fz.momento.etiqueta, '18:05', 'el ▶ va al cuadro del mapa')
    assert.ok(!fz.texto.includes('▶'), 'un solo ▶ (el link), no también en el texto')
    // Con polígono, "para lanzar" lleva los lugares y los límites
    assert.equal(v.lanzar.zona.video, 'Colonia Ejemplo · Paraje Norte · límites: de Las Heras a Luján de Cuyo (revisar: no coincide del todo con lo dicho)')
    assert.equal(v.lanzar.zona.revisar, true)
  })
  test('pantalla: una lectura colgada en "leyendo" (más de 20 min) se muestra como cortada, para reintentar', () => {
    const f = clonar(FICHA_EJEMPLO)
    const fila = { recording_id: 1, estado: 'lista', titulo: '', url: f.url, cliente_crm: 'C', id_crm: 'E157', error: null, ideas: null, revision: null, portfolio_checks: null, faltantes_checks: null,
      creado: '', actualizado: '', ficha: f, zona_video: { ...zvMapa('leyendo', 'tomas', '2026-10-24T17:00:00.000Z'), vence_ms: 0 } }
    const v = V.armarVista(fila, Date.parse('2026-10-24T17:30:00Z'))
    assert.equal(v.zona.video.estado, 'error')
    assert.equal(v.zona.video.texto, 'No se pudo leer del video (la lectura del video no terminó): para reintentar, pedile a Claude que relea el mapa de la grabación 1')
    const leyendo = V.armarVista(fila, Date.parse('2026-10-24T17:05:00Z'))
    assert.equal(leyendo.zona.video.texto, 'Se está leyendo del video')
    assert.equal(leyendo.zona.video.leyendo, true, 'la pantalla se refresca sola y no pide anotarlo a mano')
    assert.equal(leyendo.lanzar.zona.leyendo, true)
    assert.match(leyendo.faltantes.find(x => x.clave === 'zona_mapa').texto, /^Zona del mapa: se está leyendo del video/)
  })
  test('aviso: el 📍 dice si el mapa del video coincide o hay que revisarlo; leerZonaVideo descarta lo que no tiene forma', () => {
    const z = { ...extraccionDe().zona }
    assert.equal(sufijoMapa(z, zvOk()), ' · 🗺️ coincide con el mapa del video', 'sin zona.mapa, el de la lectura')
    assert.equal(sufijoMapa({ ...z, mapa: bloque() }, zvOk()), ' · 🗺️ coincide con el mapa del video')
    // Nombra los lugares (antes "revisar (1)" contaba frases: con tres lugares que no aparecían decía 1)
    assert.equal(sufijoMapa({ ...z, mapa: bloque({}, { lugares: ['Tunuyán'], radio_km: null }) }, null), ' · 🗺️ el mapa del video no muestra Tunuyán: revisar')
    const tres = bloque({}, { lugares: ['Tres Esquinas (de oído, verificar)', 'Pedernal', 'el Bordón (de oído)'], radio_km: null })
    assert.equal(sufijoMapa({ ...z, mapa: tres }, null), ' · 🗺️ el mapa del video no muestra Tres Esquinas, Pedernal ni el Bordón: revisar')
    const cinco = bloque({}, { lugares: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'], radio_km: 20 })
    assert.equal(sufijoMapa({ ...z, mapa: cinco }, null), ' · 🗺️ el mapa del video no muestra Uno, Dos ni 3 más: revisar')
    assert.equal(sufijoMapa({ ...z, mapa: bloque({ legible: 'parcial' }) }, null), ' · 🗺️ coincide con el mapa del video (se lee en parte: confirmarlo)')
    assert.equal(sufijoMapa(z, zvMapa('leyendo', 'tomas', '')), ' · 🗺️ marcada en el mapa (el bot la está leyendo del video: el resultado queda en la ficha)')
    assert.equal(sufijoMapa(z, zvMapa('sin_key', 'gero_m', '')), ' · 🗺️ marcada en el mapa (no se lee sola: falta la API key de Fathom de Gero M)')
    assert.equal(sufijoMapa(z, zvMapa('sin_key', null, '')), ' · 🗺️ marcada en el mapa (no se lee sola: no se sabe con qué Fathom se grabó)')
    assert.equal(sufijoMapa({ ...z, mapa_en_pantalla: false }, null), '')
    assert.equal(Z.leerZonaVideo({ estado: 'ok', version: 'm2' }).estado, 'error', 'ok sin bloque legible → error')
    assert.equal(Z.leerZonaVideo({ estado: 'raro', version: 'm2' }), null)
    assert.equal(Z.leerZonaVideo(null), null)
    const leido = Z.leerZonaVideo(JSON.parse(JSON.stringify(zvOk())))
    assert.deepEqual(leido.mapa, bloque())
  })
})

// ── 5. La ruta del mapa: asincrónica (mapa-api.ts con fakes) ────────────────────────────────────────
describe('ruta /api/bot/kickoff/mapa (atenderMapa con fakes)', () => {
  const ID = 100000001
  const fichaRuta = () => clonar(FICHA_EJEMPLO)
  const resultadoOk = (op = {}) => ({
    estado: 'ok', version: M.VERSION_MAPA, momentos: [1028, 1038], cuadros: { pedidos: 2, sacados: 2, fallas: [] },
    tiempos: { total_ms: 10, video_ms: 5, cuadros_ms: 2, claude_ms: 3 }, tokens: { input_tokens: 100, output_tokens: 10, costo_usd: 0.001 }, modelo: 'claude-opus-5-5', ajustes: [],
    video: { download_id: op.descargaId ?? 'dl_nuevo', pedidos: 0, content_type: 'video/mp4', file_size_bytes: 1, expires_at: null },
    zona: { ...fichaRuta().zona, mapa: M.combinarZonaConMapa(fichaRuta().zona, mapaLeido()).mapa },
  })
  function depsRuta(over = {}) {
    const log = { zona: [], guardar: [], fondo: [] }
    const deps = {
      autorizado: r => r.headers.get('authorization') === 'Bearer ok',
      baseConfigurada: () => true,
      leerKickoff: async () => ({ ficha: fichaRuta(), zona_video: null, grabador: null }),
      guardarZonaVideo: async (id, zv, op) => { log.guardar.push({ id, zv, op }); return true },
      zonaDesdeVideo: async (id, quien, ficha, op) => {
        log.zona.push({ id, quien, op })
        return op.dry ? { ...resultadoOk(op), estado: 'listo', motivo: 'dry', video: undefined, zona: undefined, tokens: null } : resultadoOk(op)
      },
      enSegundoPlano: fn => { log.fondo.push(fn) },
      ahora: () => AHORA,
      ...over,
    }
    return { deps, log }
  }
  const pedir = (deps, cuerpo, auth = 'Bearer ok') => atenderMapa(new Request('https://despacho.test/api/bot/kickoff/mapa', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }), deps)

  test('con ficha guardada: verifica sin costo, toma el candado "leyendo", responde 202 y en segundo plano mira el video y guarda', async () => {
    const { deps, log } = depsRuta()
    const res = await pedir(deps, { recording_id: ID, quien: 'tomas', descarga_id: 'dl_1' })
    assert.equal(res.status, 202)
    const j = await res.json()
    assert.deepEqual([j.aceptado, j.estado, j.descarga_id, j.quien], [true, 'leyendo', 'dl_1', 'tomas'])
    assert.equal(log.zona.length, 1)
    assert.equal(log.zona[0].op.dry, true, 'primero la verificación sin costo')
    assert.equal(log.guardar[0].zv.estado, 'leyendo')
    assert.equal(log.guardar[0].zv.vence_ms, AHORA + CANDADO_LEYENDO_MS)
    assert.equal(log.guardar[0].op.libre, true)
    assert.equal(log.fondo.length, 1)
    await log.fondo[0]()
    assert.equal(log.zona[1].op.dry, undefined)
    assert.equal(log.zona[1].op.descargaId, 'dl_1')
    const final = log.guardar[1]
    assert.deepEqual([final.zv.estado, final.op.libre, final.zv.download_id], ['ok', false, 'dl_1'])
    assert.deepEqual(final.zv.mapa.lugares, ['Mendoza', 'Godoy Cruz', 'Las Heras'])
    assert.ok(!JSON.stringify(final.zv).includes('https://'), 'sin la URL del video')
  })
  test('ya leído con esta versión → 200 "ya_leido" sin hacer nada; con forzar, se vuelve a mirar', async () => {
    let { deps, log } = depsRuta({ leerKickoff: async () => ({ ficha: fichaRuta(), zona_video: zvOk(), grabador: 'tomas' }) })
    let res = await pedir(deps, { recording_id: ID })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).estado, 'ya_leido')
    assert.deepEqual([log.zona, log.guardar, log.fondo], [[], [], []])
    ;({ deps, log } = depsRuta({ leerKickoff: async () => ({ ficha: fichaRuta(), zona_video: zvOk(), grabador: 'tomas' }) }))
    res = await pedir(deps, { recording_id: ID, forzar: true })
    assert.equal(res.status, 202)
    assert.equal(log.guardar[0].op.libre, false, 'forzar no respeta el candado')
  })
  test('otra lectura en curso (no se pudo tomar el candado) → 409, sin segundo plano', async () => {
    const { deps, log } = depsRuta({ guardarZonaVideo: async () => false })
    const res = await pedir(deps, { recording_id: ID, quien: 'tomas' })
    assert.equal(res.status, 409)
    assert.deepEqual(log.fondo, [])
  })
  test('la verificación dice sin_key → 503 y queda anotado (la ficha dice qué conectar); dry → 200 "listo" y no escribe', async () => {
    let { deps, log } = depsRuta({ zonaDesdeVideo: async () => ({ ...resultadoOk(), estado: 'sin_key', motivo: 'falta FATHOM_API_KEY_TOMAS', zona: undefined, video: undefined }) })
    let res = await pedir(deps, { recording_id: ID, quien: 'tomas' })
    assert.equal(res.status, 503)
    assert.equal(log.guardar[0].zv.estado, 'sin_key')
    assert.equal(log.guardar[0].zv.motivo, 'conectar la API key de Fathom de Tomás para leer el mapa', 'sin nombres de variables')
    ;({ deps, log } = depsRuta())
    res = await pedir(deps, { recording_id: ID, quien: 'tomas', dry: true })
    assert.equal(res.status, 200)
    const j = await res.json()
    assert.deepEqual([j.estado, j.guardado], ['listo', false])
    assert.deepEqual([log.guardar, log.fondo], [[], []])
  })
  test('sin descarga_id en el cuerpo: retoma la de zona_video (misma versión y misma cuenta); quien sale de la columna grabador', async () => {
    const { deps, log } = depsRuta({ leerKickoff: async () => ({ ficha: { ...fichaRuta(), grabo: { nombre: 'X', email: null, quien: null } }, grabador: 'gero_m', zona_video: zvMapa('pedido', 'gero_m', '', { download_id: 'dl_guardado' }) }) })
    const res = await pedir(deps, { recording_id: ID })
    assert.equal(res.status, 202)
    assert.equal(log.zona[0].quien, 'gero_m')
    assert.equal(log.zona[0].op.descargaId, 'dl_guardado')
  })
  test('esperar: en el acto, con el resultado y guardado; sin ficha guardada (timestamp_zona) responde en el acto y no guarda', async () => {
    let { deps, log } = depsRuta()
    let res = await pedir(deps, { recording_id: ID, quien: 'tomas', esperar: true })
    assert.equal(res.status, 200)
    let j = await res.json()
    assert.deepEqual([j.estado, j.guardado], ['ok', true])
    assert.deepEqual(log.fondo, [])
    ;({ deps, log } = depsRuta({ leerKickoff: async () => undefined }))
    res = await pedir(deps, { recording_id: ID, quien: 'tomas', timestamp_zona: '00:00:45', duracion_s: 90 })
    j = await res.json()
    assert.deepEqual([res.status, j.guardado, j.origen_ficha], [200, false, 'cuerpo'])
    assert.deepEqual(log.guardar, [])
  })
  test('sin Bearer → 401; cuerpo raro → 400', async () => {
    const { deps } = depsRuta()
    assert.equal((await pedir(deps, { recording_id: ID }, 'Bearer otro')).status, 401)
    assert.equal((await pedir(deps, { recording_id: 'x' })).status, 400)
    assert.equal((await pedir(deps, { recording_id: ID, quien: 'pepe' })).status, 400)
  })
})

describe('servidor: el disparo de la lectura y el pedido temprano del video', () => {
  test('dispararMapaReal: POST a <Despacho>/api/bot/kickoff/mapa con Bearer y {recording_id, quien, descarga_id}; 202/200/409 valen, lo demás lanza', async () => {
    const pedidos = []
    const f = status => async (url, init) => { pedidos.push({ url, init }); return new Response(null, { status }) }
    await dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: 'dl_1' }, 5_000, { fetch: f(202), base: 'https://despacho.test', cron: 'cron-x' })
    assert.equal(pedidos[0].url, 'https://despacho.test/api/bot/kickoff/mapa')
    assert.equal(pedidos[0].init.method, 'POST')
    assert.equal(pedidos[0].init.headers.authorization, 'Bearer cron-x')
    assert.deepEqual(JSON.parse(pedidos[0].init.body), { recording_id: 7, quien: 'tomas', descarga_id: 'dl_1' })
    await dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: null }, 5_000, { fetch: f(409), base: 'https://d.test', cron: 'c' })
    assert.deepEqual(JSON.parse(pedidos[1].init.body), { recording_id: 7, quien: 'tomas' })
    await assert.rejects(dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: null }, 5_000, { fetch: f(502), base: 'https://d.test', cron: 'c' }), /respondió 502/)
    await assert.rejects(dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: null }, 5_000, { fetch: f(202), base: 'https://d.test' }), /falta CRON_SECRET/)
    const lento = async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) }
    await assert.rejects(dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: null }, 3_000, { fetch: lento, base: 'https://d.test', cron: 'c' }), /no respondió en 3 s/)
  })
  test('pedirVideoSeguro: nunca lanza (processing → download_id; 422 → sin_video; sin key → sin_key; 401 → definitivo; 503 → pasajero)', async () => {
    const KEY = 'fk-test-0123456789abcdef'
    const env = { FATHOM_API_KEY_TOMAS: KEY }
    const fetchDe = (...rs) => { let i = 0; return async () => rs[Math.min(i++, rs.length - 1)]() }
    const resp = (status, cuerpo) => () => new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
    const op = f => ({ env, fetch: f, ahora: () => 0, esperar: async () => {}, limite: 60_000 })
    assert.deepEqual(await M.pedirVideoSeguro(7, 'tomas', op(fetchDe(resp(202, { download_id: 'dl_1', recording_id: 7, status: 'processing' })))), { ok: true, download_id: 'dl_1', status: 'processing' })
    assert.equal((await M.pedirVideoSeguro(7, 'tomas', op(fetchDe(resp(422))))).estado, 'sin_video')
    const sinKey = await M.pedirVideoSeguro(7, 'gero_m', op(fetchDe(resp(202, {}))))
    assert.deepEqual([sinKey.estado, sinKey.motivo], ['sin_key', 'conectar la API key de Fathom de Gero M para leer el mapa'])
    const r401 = await M.pedirVideoSeguro(7, 'tomas', op(fetchDe(resp(401))))
    assert.deepEqual([r401.estado, r401.transitorio], ['error', false])
    assert.ok(!r401.motivo.includes(KEY))
    const r503 = await M.pedirVideoSeguro(7, 'tomas', op(fetchDe(resp(503), resp(503))))
    assert.deepEqual([r503.estado, r503.transitorio], ['error', true])
  })
  test('aZonaVideo: ok con el bloque; sin_key con el motivo llano; error con el download_id; listo (dry) → nada', () => {
    const base = { version: M.VERSION_MAPA, momentos: [1], cuadros: { pedidos: 1, sacados: 1, fallas: [] }, tiempos: {}, tokens: null, modelo: null, ajustes: [] }
    const ok = M.aZonaVideo({ ...base, estado: 'ok', zona: { lugares: [], radio_km: null, mapa: bloque() }, video: { download_id: 'dl_2' } }, 'tomas', { generado: 'g' })
    assert.deepEqual([ok.estado, ok.download_id, ok.mapa.lugares.length, ok.generado], ['ok', 'dl_2', 3, 'g'])
    assert.equal(M.aZonaVideo({ ...base, estado: 'sin_key', motivo: 'falta FATHOM_API_KEY_GERO_M' }, 'gero_m').motivo, 'conectar la API key de Fathom de Gero M para leer el mapa')
    const err = M.aZonaVideo({ ...base, estado: 'error', motivo: 'video de Fathom: tardó', transitorio: true, video: { download_id: 'dl_3' } }, 'tomas')
    assert.deepEqual([err.estado, err.transitorio, err.download_id], ['error', true, 'dl_3'])
    assert.equal(M.aZonaVideo({ ...base, estado: 'listo' }, 'tomas'), null)
  })
})

describe('Claude con imágenes: llamarClaude acepta bloques (sin la copia que tenía mapa.ts)', () => {
  test('leerMapa → un solo pedido con texto + imágenes, max_tokens 16000, esfuerzo medium y salida estructurada', async () => {
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    const salida = JSON.stringify({ hay_mapa: false, tipo: 'ninguno', lugares: [], marca: 'ninguna', marca_detalle: '', radio_km: '', radio_estimado_km: '', radio_como: '', limites: '', excluidas: [], mejor_cuadro: 0, legible: 'no', notas: '' })
    const sse = [
      ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 0 } } }),
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: salida } }),
      ev('content_block_stop', { index: 0 }),
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }),
      ev('message_stop', {}),
    ].join('')
    const original = globalThis.fetch
    const pedidos = []
    process.env.ANTHROPIC_API_KEY = 'sk-ant-de-prueba'
    globalThis.fetch = async (url, init) => { pedidos.push(JSON.parse(init.body)); return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }) }
    try {
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2_000, 1)])
      const r = await M.leerMapa([{ seg: 30, jpg }, { seg: 10, jpg }])
      assert.equal(r.mapa.hay_mapa, false)
      assert.deepEqual(r.usage, { input_tokens: 3000, output_tokens: 40 })
      const [p] = pedidos
      assert.equal(pedidos.length, 1)
      assert.equal(p.max_tokens, 16_000)
      assert.equal(p.output_config.effort, 'medium')
      assert.equal(p.output_config.format.type, 'json_schema')
      const contenido = p.messages[0].content
      assert.ok(Array.isArray(contenido))
      assert.deepEqual(contenido.filter(b => b.type === 'image').map(b => b.source.media_type), ['image/jpeg', 'image/jpeg'])
      assert.match(contenido[1].text, /00:00:10/, 'los cuadros van en orden')
    } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY }
  })
})

// ── 6. El aviso sin cortes a mitad de frase ─────────────────────────────────────────────────────────
describe('aviso: ítems enteros o "+N", nunca una frase cortada', () => {
  const avisoDe = (over, link = 'https://despacho-capital-juridico.vercel.app/clientes/A101/kickoff', ideas = IDEAS, faltantes = null) => {
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe(over), ajustes: [], ideas, ganadores: null, portfolioMeta: paraFicha(lecturaMeta()) })
    if (faltantes) f.faltantes = faltantes
    return { f, t: armarAviso(f, { tomi: TOMI, gero_m: GERO }, link) }
  }
  const linea = (t, emoji) => t.split('\n').find(l => l.startsWith(emoji))
  test('encajar: el primero siempre, después los que entran; lo de cada grupo que no entra, "+N" al final del grupo', () => {
    assert.equal(encajar([{ items: ['aaa', 'bbb', 'ccc'] }], 9), 'aaa · +2')
    assert.equal(encajar([{ items: ['aaa', 'bbb'] }], 9), 'aaa · bbb')
    assert.equal(encajar([{ items: ['x'.repeat(30)] }], 5), 'x'.repeat(30), 'el primero no se corta')
    assert.equal(encajar([{ items: ['xxxxxxxxxx'] }, { prefijo: '✋ afuera: ', items: ['yy', 'zz'] }], 20), 'xxxxxxxxxx · ✋ afuera: +2')
    assert.equal(encajar([{ items: ['a'] }, { prefijo: 'subramas: ', items: ['uno', 'dos', 'tres'], sep: '; ' }], 26), 'a · subramas: uno; dos; +1')
    assert.equal(encajar([{ items: [] }, { items: ['solo'] }], 10), 'solo')
    // Primero entra el primer ítem de cada grupo; lo que sobra de los grupos sin prefijo va en un "+N" después del último
    assert.equal(encajar([{ items: ['lugar uno', 'lugar dos', 'lugar tres'] }, { items: ['radio 5 km'] }, { items: ['se presenta como «X»'] }], 50), 'lugar uno · radio 5 km · se presenta como «X» · +2')
    assert.equal(encajar([{ items: ['inc uno', 'inc dos'] }, { prefijo: '✋ afuera: ', items: ['exc uno', 'exc dos'] }], 37), 'inc uno · +1 · ✋ afuera: exc uno · +1')
  })
  test('avatar como el de producción ("… y trabajadores rurales: el…"): cada filtro entra entero o queda en "+N"', () => {
    const largo = 'en la zona hay mucha gente en negro a la que despiden y trabajadores rurales: el anuncio filtra a los que estaban en blanco'
    const excluye = ['nada de pasantes', 'nada de gente con pocos meses de trabajo', 'nada de trabajo totalmente en negro', largo,
      'nada de casos de más de diez años de antigüedad que ya cobraron la indemnización completa', 'nada de empleados públicos ni municipales de la provincia']
    const incluye = ['al menos un año y medio trabajando en relación de dependencia', 'prioridad a gente en blanco o mitad en negro y mitad en blanco']
    const { f, t } = avisoDe({ avatar: { incluye: incluye.map(x => ({ texto: x, cita: '', timestamp: '' })), excluye: excluye.map(x => ({ texto: x, cita: '', timestamp: '' })) } })
    assert.ok(t.length <= MAX_DISCORD)
    const l = linea(t, '👤')
    assert.ok(!l.includes('…'), l)
    const sinNada = x => x.replace(/^nada de\s+/i, '')
    const todos = [...incluye, ...excluye.map(sinNada)]
    const dentro = todos.filter(x => l.includes(x))
    const mas = Number(/\+(\d+)$/.exec(l)?.[1] ?? 0)
    assert.equal(dentro.length + mas, todos.length, `${l}`)
    assert.ok(mas >= 1, 'algo quedó afuera (como «+N»)')
    assert.ok(!/trabajadores rurales: el(?! anuncio)/.test(l), 'nunca la frase a la mitad')
    // Para todos los ítems del avatar de la ficha: entero o ausente
    for (const x of [...f.avatar.incluye, ...f.avatar.excluye]) {
      const s = sinNada(x.texto)
      const pedazo = s.split(' ').slice(0, 4).join(' ')
      if (l.includes(pedazo)) assert.ok(l.includes(s), `cortado: ${s}`)
    }
  })
  test('zona con muchos lugares: los que entran enteros + "+N"; la presentación igual va; faltantes sin etiqueta: enteros o "+N"', () => {
    const lugares = Array.from({ length: 16 }, (_, i) => `Localidad de Ejemplo Número ${i + 1}`)
    const { t } = avisoDe({ zona: { ...salidaClaude().zona, lugares } }, null)
    const z = linea(t, '📍')
    assert.ok(!z.includes('…'))
    // Lo que no entra de los grupos sin prefijo va en un solo "+N", después de la presentación (que igual entra)
    assert.match(z, / · radio 20 km · se presenta como «Mendoza capital» · \+\d+ · 🗺️ marcada en el mapa$/)
    const partes = z.replace('📍 **Zona:** ', '').split(' · ')
    const mas = Number(partes.find(x => /^\+\d+$/.test(x)).slice(1))
    assert.equal(partes.filter(x => /^Localidad de Ejemplo Número \d+$/.test(x)).length + mas, lugares.length, 'cada lugar, entero o contado en +N')
    // Faltantes que no tienen etiqueta fija (de una ficha vieja, por ejemplo): enteros mientras entren
    const raros = Array.from({ length: 6 }, (_, i) => `Algo para completar que no tiene etiqueta fija y es bastante largo, número ${i + 1}`)
    const sinLink = avisoDe({}, null, IDEAS, raros).t
    const fl = linea(sinLink, '⚠️')
    assert.ok(!fl.includes('…'), fl)
    const enteros = raros.filter(x => fl.includes(x)).length
    assert.ok(enteros >= 1)
    assert.match(fl, new RegExp(`\\+${raros.length - enteros}$`))
    // Con link y sin lugar, solo el número (el detalle está en la ficha)
    const largas = IDEAS_OK.map(x => ({ ...x, titulo: 'Título largo de idea '.repeat(3), gancho: 'palabra '.repeat(26) }))
    const conLink = avisoDe({}, 'https://d.test/clientes/A101/kickoff', { ...IDEAS, ideas: largas }, raros).t
    assert.ok(conLink.length <= MAX_DISCORD)
    assert.ok(!linea(conLink, '⚠️').includes('…'))
  })
})

// ── 7. Segunda revisión del 24/10 (tarde): lo que se corrigió ───────────────────────────────────────
describe('aviso: el link y los faltantes no se pierden nunca, aunque todo sea largo', () => {
  const palabras = n => Array.from({ length: n }, (_, i) => `palabra${i % 7}`).join(' ')
  const M2 = { tomi: TOMI, gero_m: GERO }, L = 'https://despacho-capital-juridico.vercel.app/clientes/E001/kickoff'
  const casos = {
    'avatar con un primer filtro de 290 y la zona sin lugares con una descripción de 399': f => {
      f.avatar.incluye[0].texto = palabras(40).slice(0, 290); f.zona.lugares = []; f.zona.descripcion = palabras(55).slice(0, 399)
      for (const i of f.ideas_guiones.ideas) i.gancho = palabras(40)
    },
    'avatar de 290, rama de 199 y títulos de 80': f => {
      f.avatar.incluye[0].texto = palabras(40).slice(0, 290); f.rama.texto = palabras(28).slice(0, 199)
      for (const i of f.ideas_guiones.ideas) { i.gancho = palabras(40); i.titulo = palabras(14).slice(0, 80) }
    },
  }
  for (const [nombre, mod] of Object.entries(casos)) {
    test(nombre, () => {
      const f = clonar(FICHA_EJEMPLO)
      mod(f)
      const t = armarAviso(f, M2, L)
      assert.ok(t.length <= MAX_DISCORD, String(t.length))
      assert.ok(!t.endsWith('…'), 'sin el corte duro de la cola')
      assert.ok(t.includes(`✍️ Los guiones ya se están escribiendo con estas ideas · comentalas en la [ficha](<${L}>)`), 'el link queda')
      assert.match(t, /\n⚠️ \*\*Falta completar \(\d+\):\*\* /, 'los faltantes quedan')
      // Lo que se acortó, en un límite de palabra: nunca un "palabr…" (las palabras enteras son "palabra0" a "palabra6")
      assert.ok(!/(?:^|[^a-z\d])(?:p|pa|pal|pala|palab|palabr|palabra)…/.test(t), t)
    })
  }
  test('con muchas ideas largas y todo largo: si no entra, se sacan ideas enteras desde la última ("y N más en la ficha")', () => {
    const f = clonar(FICHA_EJEMPLO)
    f.avatar.incluye[0].texto = palabras(40).slice(0, 290); f.zona.lugares = []; f.zona.descripcion = palabras(55).slice(0, 399)
    f.rama.texto = palabras(28).slice(0, 199)
    f.ideas_guiones.ideas = Array.from({ length: 12 }, (_, i) => ({ ...f.ideas_guiones.ideas[0], titulo: palabras(14).slice(0, 80), gancho: palabras(40), por_que: `G${i}` }))
    const t = armarAviso(f, M2, L)
    assert.ok(t.length <= MAX_DISCORD, String(t.length))
    assert.match(t, /\n… y \d+ ideas? más en la ficha\n/)
    assert.ok(t.includes('✍️ Los guiones ya se están escribiendo con estas ideas · comentalas en la [ficha]'))
    assert.match(t, /\n⚠️ \*\*Falta completar/)
  })
  test('subrama "a confirmar": lo conserva (con Laura: «despido después de un accidente de trabajo (a confirmar)»)', () => {
    assert.equal(subramaCorta('despido después de un accidente de trabajo (doble causa), a confirmar'), 'despido después de un accidente de trabajo (a confirmar)')
    assert.equal(subramaCorta('despidos'), 'despidos')
    assert.equal(subramaCorta('despidos (a confirmar)'), 'despidos (a confirmar)')
    assert.equal(subramaCorta('despidos: en blanco'), 'despidos')
  })
  test('un gancho que ya trae comillas: adentro van “…” (no «««…» … »»)', () => {
    assert.equal(entreComillas('«Mirá, mañana no hace falta que vengas.» ¿Te lo dijeron así?'), '«“Mirá, mañana no hace falta que vengas.” ¿Te lo dijeron así?»')
    const f = armarFicha({ reunion: r0, extraccion: extraccionDe(), ajustes: [], ideas: { ...IDEAS, ideas: [{ ...IDEAS_OK[0], gancho: '«No vengas más.» ¿Te lo dijeron así?' }] }, ganadores: null, portfolioMeta: paraFicha(lecturaMeta()) })
    assert.match(armarAviso(f, M2, L), /— «“No vengas más\.” ¿Te lo dijeron así\?»\n/)
    assert.match(fichaMarkdown(f), /— «“No vengas más\.” ¿Te lo dijeron así\?»/)
  })
  const salida = '.cache/kickoff-prueba/salida-195704214.json'
  test('con la ficha de Laura (si está la salida de la prueba): con el mapa leyéndose o sin la API key, sigue por debajo de 2000', { skip: !existsSync(salida) }, () => {
    const f = JSON.parse(readFileSync(salida, 'utf8')).ficha
    const link = linkFicha('https://despacho-capital-juridico.vercel.app', f, true)
    for (const zv of [zvMapa('pedido', 'tomas', '2026-10-24T12:00:00.000Z', { download_id: 'dl' }), zvMapa('sin_key', 'gero_m', '2026-10-24T12:00:00.000Z')]) {
      const t = armarAviso(conZonaVideo(f, zv), M2, link)
      assert.ok(t.length <= MAX_DISCORD, `${zv.estado}: ${t.length}`)
      assert.ok(!t.endsWith('…'))
      assert.match(t, /subramas: despidos; despido después de un accidente de trabajo \(a confirmar\)/)
    }
  })
})

describe('mapa: clave propia para lo que pide el video, pin de Meta en "para lanzar", sin mapa y aviso al terminar', () => {
  const filaCon = (zv, marcas = null, f = clonar(FICHA_EJEMPLO)) => ({
    recording_id: f.recording_id, estado: 'lista', titulo: f.titulo, url: f.url, cliente_crm: 'C', id_crm: 'E157', error: null, ideas: null, revision: null,
    portfolio_checks: null, faltantes_checks: marcas, creado: '2026-10-24T17:00:00.000Z', actualizado: '2026-10-24T17:00:00.000Z', ficha: f, zona_video: zv,
  })
  const ahora = Date.parse('2026-10-24T18:00:00Z')
  const marca = (nota, cuando = '2026-10-24T17:01:00.000Z') => ({ nota, quien: 'Tomi', email: 't@ejemplo.test', cuando })
  const conDiferencias = () => {
    const f = clonar(FICHA_EJEMPLO)
    return zvOk({ generado: '2026-10-24T17:04:00.000Z' }, M.combinarZonaConMapa(f.zona, mapaLeido({ lugares: [{ nombre: 'Colonia Ejemplo', posicion: 'dentro' }], momento: '00:18:05' })).mapa)
  }
  test('una nota del recorte anotada ANTES de leer el video no tapa la diferencia que el video encontró después', () => {
    const v = V.armarVista(filaCon(conDiferencias(), { zona_mapa: marca('de Colonia Ejemplo a Villa Inventada') }), ahora)
    const rev = v.faltantes.find(x => x.clave === 'zona_mapa_video')
    assert.ok(rev, 'queda en «Falta completar», no en «Hechos»')
    assert.match(rev.contexto, /Antes se anotó a mano el recorte «de Colonia Ejemplo a Villa Inventada»: el mapa del video lo contradice o hay que confirmarlo/)
    assert.ok(!v.hechos.some(x => x.clave === 'zona_mapa_video'))
    // "Para lanzar" muestra la nota y avisa que el video dice otra cosa
    assert.equal(v.lanzar.zona.nota, 'de Colonia Ejemplo a Villa Inventada')
    assert.equal(v.lanzar.zona.revisar, true)
    assert.match(textoParaLanzar(v), /recorte: de Colonia Ejemplo a Villa Inventada \(ojo: el mapa del video dice otra cosa: confirmarlo con Tomi\)/)
    assert.equal(V.claveMarcable(v, 'zona_mapa_video'), true)
    // Marcado como revisado (con su nota): pasa a «Hechos», esa nota manda en "para lanzar" y ya no hay "ojo"
    const w = V.armarVista(filaCon(conDiferencias(), { zona_mapa: marca('viejo'), zona_mapa_video: marca('confirmado con Clara: el de Colonia Ejemplo', '2026-10-24T17:30:00.000Z') }), ahora)
    assert.deepEqual(w.hechos.map(x => x.clave), ['zona_mapa_video'])
    assert.deepEqual([w.lanzar.zona.nota, w.lanzar.zona.revisar], ['confirmado con Clara: el de Colonia Ejemplo', false])
  })
  test('pin con radio de Meta: "para lanzar" lleva la ubicación configurada con su radio, no los nombres que se leen dentro del círculo', () => {
    const f = clonar(FICHA_EJEMPLO)
    const b = M.combinarZonaConMapa({ ...f.zona, lugares: ['Colonia Ejemplo'], radio_km: 30 }, mapaLeido({
      tipo: 'meta_ads', marca: 'pin_con_radio', radio_km: 30, limites: 'círculo de 30 km', excluidas: ['Paraje Sur, La Pampa, Argentina'],
      lugares: [{ nombre: 'Colonia Ejemplo, La Pampa, Argentina', posicion: 'lista_incluida' }, { nombre: 'Paraje Norte', posicion: 'dentro' }, { nombre: 'Laguna Quieta', posicion: 'borde' }],
    })).mapa
    f.zona = { ...f.zona, lugares: ['Colonia Ejemplo'], radio_km: 30 }
    const v = V.armarVista(filaCon(zvOk({}, b), null, f), ahora)
    const m = v.zona.video
    assert.equal(m.conPin, true)
    assert.deepEqual(m.marcados, [{ nombre: 'Colonia Ejemplo, La Pampa, Argentina', dicho: true }])
    assert.deepEqual(m.dentroCirculo, ['Paraje Norte', 'Laguna Quieta'])
    assert.deepEqual(m.tambien, [], 'lo de adentro del círculo no se repite como «sin que se dijera»')
    assert.equal(v.lanzar.zona.video, 'Colonia Ejemplo, La Pampa, Argentina +30 km · sin Paraje Sur, La Pampa, Argentina')
  })
  test('sin mapa en los minutos que miró el bot: la pantalla dice cuáles (para buscarlo en otro momento)', () => {
    const v = V.armarVista(filaCon(zvMapa('sin_mapa', 'tomas', '2026-10-24T17:04:00.000Z', { momentos: [1028, 1038, 1218] })), ahora)
    assert.equal(v.zona.video.rango, 'de 17:08 a 20:18')
    assert.equal(v.zona.video.estado, 'sin_mapa')
    assert.equal(Z.rangoMomentos([]), null)
    assert.equal(Z.rangoMomentos([3725]), 'el 1:02:05')
  })
  test('textoAvisoMapa: solo cuando hay algo que mirar (no coincide, no se lee, no aparece); sin menciones y con el link', () => {
    const f = clonar(FICHA_EJEMPLO)
    const op = { base: 'https://despacho.test', pantalla: true }
    const t = textoAvisoMapa(f, conDiferencias(), op)
    assert.equal(t, '🗺️ Clienta Ejemplo (ejemplo): el mapa del video no muestra Paraje Norte, Villa Inventada ni El Molino (lo que se nombró en la llamada): revisar la zona antes de lanzar · [ficha](<https://despacho.test/clientes/E157/kickoff>)')
    assert.ok(!/<@/.test(t))
    assert.equal(textoAvisoMapa(f, zvOk({}, M.combinarZonaConMapa({ lugares: ['Colonia Ejemplo'], radio_km: null }, mapaLeido({ lugares: [{ nombre: 'Colonia Ejemplo', posicion: 'dentro' }] })).mapa), op), null, 'coincide: no hace ruido')
    assert.match(textoAvisoMapa(f, zvMapa('sin_mapa', 'tomas', ''), op), /^🗺️ Clienta Ejemplo \(ejemplo\): en los minutos en que se habló de la zona el video no muestra el mapa: buscarlo en la grabación y anotar el recorte · \[ficha\]/)
    assert.equal(textoAvisoMapa(f, zvMapa('error', 'tomas', '', { transitorio: true }), op), null)
    assert.equal(textoAvisoMapa(f, { basura: 1 }, op), null)
    assert.ok(!textoAvisoMapa(f, zvMapa('sin_mapa', 'tomas', ''), { ...op, pantalla: false }).includes('[ficha]'))
  })
})

describe('mapa: el plan, el disparo y la ruta (lo que se anota, el reintento solo y el aviso)', () => {
  test('planMapa: sin el minuto de la zona no se pide el video; queda anotado el porqué', async () => {
    const base = { mapaEnPantalla: true, previo: null, quien: 'tomas', hayApiKey: () => true, dry: false, ahoraMs: AHORA }
    const p = planMapa({ ...base, hayMomento: false })
    assert.equal(p.tipo, 'sin_momento')
    assert.deepEqual([p.zv.estado, p.zv.motivo, p.zv.transitorio], ['error', Z.MOTIVO_SIN_MOMENTO, false])
    assert.equal(planMapa({ ...base, hayMomento: false, previo: zvOk() }).tipo, 'nada', 'ya leído: nada')
    // procesar: la zona con un minuto fuera de la llamada (40 renglones de 30 s = 19:30)
    const { deps, log } = fakes({ salida: { zona: { ...salidaClaude().zona, timestamp: '02:00:00' } } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.deepEqual([log.pedirVideo, log.disparar], [[], []])
    assert.equal(log.guardarZona[0].zv.motivo, Z.MOTIVO_SIN_MOMENTO)
    assert.equal(r.mapa.plan, 'sin_momento')
  })
  test('el disparo: si la ruta del mapa ya anotó la causa (sin ffmpeg), procesar no la pisa con "no se pudo disparar"', async () => {
    const { deps, log } = fakes({ dispararMapa: async () => { throw new ErrorDisparoMapa(502, 'falta ffmpeg', true, 'error') } })
    const r = await procesarKickoff(reunion(), deps)
    assert.equal(r.estado, 'lista')
    assert.ok(!log.guardarZona.some(x => /no se pudo disparar/.test(x.zv.motivo ?? '')), log.guardarZona.map(x => x.zv.motivo).join(' | '))
    assert.equal(r.mapa.estado, 'error')
  })
  test('el disparo con poco tiempo: se acota al deadline y, sin tiempo ni para escribir, no escribe', async () => {
    const { deps, log, reloj } = fakes()
    // Las ideas tardan casi todo: al disparo le quedan menos de 12 s
    deps.ideas = async () => { reloj.t = AHORA + 275_000; return { ideas: IDEAS_OK, notas: '', ajustes: [], modelo: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } } }
    const r = await procesarKickoff(reunion(), deps, { deadline: AHORA + 280_000 })
    assert.deepEqual(log.disparar, [], 'no se dispara')
    assert.ok(!log.guardarZona.some(x => x.zv.estado === 'error'), 'ni se escribe el error')
    assert.equal(r.mapa.estado, 'error')
  })
  test('dispararMapaReal: lo que no acepta la ruta lanza ErrorDisparoMapa con lo que dijo (y si ya lo anotó); manda el reintento', async () => {
    const pedidos = []
    const f = (status, cuerpo) => async (url, init) => { pedidos.push({ url, init }); return new Response(cuerpo ? JSON.stringify(cuerpo) : null, { status }) }
    await assert.rejects(dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: null }, 5_000, { fetch: f(502, { estado: 'error', motivo: 'no se encontró ffmpeg', guardado: true }), base: 'https://d.test', cron: 'c' }),
      e => e instanceof ErrorDisparoMapa && e.guardado === true && e.status === 502 && e.estado === 'error' && /respondió 502: no se encontró ffmpeg/.test(e.message))
    await assert.rejects(dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: null }, 5_000, { fetch: f(500), base: 'https://d.test', cron: 'c' }),
      e => e instanceof ErrorDisparoMapa && e.guardado === false && /respondió 500$/.test(e.message))
    await dispararMapaReal({ recording_id: 7, quien: 'tomas', descarga_id: 'dl_1', reintento: true }, 5_000, { fetch: f(202), base: 'https://d.test', cron: 'c' })
    assert.deepEqual(JSON.parse(pedidos.at(-1).init.body), { recording_id: 7, quien: 'tomas', descarga_id: 'dl_1', reintento: true })
  })

  const ID = 100000001
  const resultado = (over = {}) => ({
    estado: 'ok', version: M.VERSION_MAPA, momentos: [1028], cuadros: { pedidos: 1, sacados: 1, fallas: [] }, tiempos: { total_ms: 1, video_ms: 1, cuadros_ms: 1, claude_ms: 1 },
    tokens: null, modelo: null, ajustes: [], zona: { ...clonar(FICHA_EJEMPLO).zona, mapa: M.combinarZonaConMapa(clonar(FICHA_EJEMPLO).zona, mapaLeido()).mapa }, ...over,
  })
  function depsRuta(over = {}) {
    const log = { zona: [], guardar: [], fondo: [], redisparo: [], aviso: [] }
    const deps = {
      autorizado: () => true, baseConfigurada: () => true,
      leerKickoff: async () => ({ ficha: clonar(FICHA_EJEMPLO), zona_video: null, grabador: 'tomas' }),
      guardarZonaVideo: async (id, zv, op) => { log.guardar.push({ zv, op }); return true },
      zonaDesdeVideo: async (id, quien, ficha, op) => { log.zona.push(op); return op.dry ? resultado({ estado: 'listo', zona: undefined }) : resultado() },
      enSegundoPlano: fn => { log.fondo.push(fn) },
      ahora: () => AHORA,
      redisparar: async (datos, tope) => { log.redisparo.push({ datos, tope }) },
      avisarMapa: async (ficha, zv, deadline) => { log.aviso.push({ ficha, zv, deadline }) },
      ...over,
    }
    return { deps, log }
  }
  const pedir = (deps, cuerpo) => atenderMapa(new Request('https://d.test/api/bot/kickoff/mapa', { method: 'POST', headers: { authorization: 'Bearer ok' }, body: JSON.stringify(cuerpo) }), deps)
  test('lo que corta la verificación queda anotado, en palabras (sin ffmpeg, sin la clave de Claude, sin el minuto de la zona)', async () => {
    for (const [motivo, llano] of [
      ['no se encontró ffmpeg (FFMPEG_PATH, ffmpeg-static ni el PATH)', 'el servidor no tiene ffmpeg para sacar los cuadros del video: avisale a Tomás'],
      ['falta ANTHROPIC_API_KEY (o BOT_ANTHROPIC_API_KEY)', 'el servidor no tiene la clave de Claude: avisale a Tomás'],
      [Z.MOTIVO_SIN_MOMENTO, Z.MOTIVO_SIN_MOMENTO],
    ]) {
      const { deps, log } = depsRuta({ zonaDesdeVideo: async () => resultado({ estado: 'error', motivo, zona: undefined }) })
      const res = await pedir(deps, { recording_id: ID, quien: 'tomas' })
      assert.equal(res.status, 502)
      const j = await res.json()
      assert.equal(j.guardado, true)
      assert.deepEqual([log.guardar[0].zv.estado, log.guardar[0].zv.motivo, log.guardar[0].op.libre], ['error', llano, true])
      assert.ok(!/FFMPEG_PATH|ANTHROPIC_API_KEY/.test(log.guardar[0].zv.motivo), 'sin nombres de variables en la ficha')
      assert.deepEqual(log.fondo, [])
    }
  })
  test('un error pasajero con la descarga ya pedida se reintenta UNA vez solo (con esa descarga); el reintento no se reintenta', async () => {
    const pasajero = resultado({ estado: 'error', transitorio: true, motivo: 'video de Fathom: tardó más de 4 minutos', zona: undefined, video: { download_id: 'dl_9', pedidos: 1, content_type: null, file_size_bytes: null, expires_at: null } })
    let { deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : pasajero) })
    assert.equal((await pedir(deps, { recording_id: ID, quien: 'tomas' })).status, 202)
    await log.fondo[0]()
    assert.deepEqual(log.redisparo.map(x => x.datos), [{ recording_id: ID, quien: 'tomas', descarga_id: 'dl_9', reintento: true }])
    assert.equal(log.guardar.at(-1).zv.estado, 'error', 'el error queda anotado antes de reintentar')
    ;({ deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : pasajero) }))
    await pedir(deps, { recording_id: ID, quien: 'tomas', reintento: true })
    await log.fondo[0]()
    assert.deepEqual(log.redisparo, [], 'el reintento no se vuelve a disparar')
    // Sin descarga (no hay nada que retomar) tampoco
    ;({ deps, log } = depsRuta({ zonaDesdeVideo: async (id, q, f, op) => (op.dry ? resultado({ estado: 'listo', zona: undefined }) : { ...pasajero, video: undefined }) }))
    await pedir(deps, { recording_id: ID, quien: 'tomas' })
    await log.fondo[0]()
    assert.deepEqual(log.redisparo, [])
  })
  test('al terminar, el aviso del mapa recibe la ficha guardada y lo que quedó (lo decide textoAvisoMapa); si falla, no rompe', async () => {
    let { deps, log } = depsRuta()
    await pedir(deps, { recording_id: ID, quien: 'tomas' })
    await log.fondo[0]()
    assert.equal(log.aviso.length, 1)
    assert.equal(log.aviso[0].zv.estado, 'ok')
    assert.equal(log.aviso[0].ficha.recording_id, FICHA_EJEMPLO.recording_id)
    assert.equal(log.aviso[0].deadline, AHORA + 293_000, 'dentro de los 300 s de la invocación')
    ;({ deps, log } = depsRuta({ avisarMapa: async () => { throw new Error('Discord no respondió') } }))
    await pedir(deps, { recording_id: ID, quien: 'tomas' })
    await log.fondo[0]()
    assert.equal(log.guardar.at(-1).zv.estado, 'ok')
  })
})
