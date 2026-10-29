// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-whatsapp-seguro.mjs
// WhatsApp seguro (26/10/2026): el número del bot (Whapi) fue suspendido horas después de prender la comunidad. Acá se prueba:
//   · la guardia de salud (lib/bot/whapi/salud.ts) dentro del cliente real de Whapi: GET /health con caché de 60 s, nada
//     sale si no está en AUTH, 401 / 403 / "banned", /health caído, un solo aviso a Discord con @Tomás;
//   · que la guardia cubre TODOS los envíos (Anuncios, Guiones, Grabación e01) y no solo el alta;
//   · el webhook: groups_participants → EventoIngreso; channel / users.delete → la guardia frena y avisa.
// La parte del motor (comunidad solo con el equipo, link al closer, bienvenida al entrar, tope, ritmo) está en
// scripts/test-bot-orquestador.mjs (describe "WhatsApp seguro"). SIN red: fetch bloqueado y falsos; sin base; sin Discord.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of Object.keys(process.env)) {
  if (/^(BOT_|WHAPI_|DISCORD_|GUIONES_|E01_)/.test(k) || ['DATABASE_URL', 'CRON_SECRET'].includes(k)) delete process.env[k]
}
const RED_BLOQUEADA = async () => { throw new Error('red bloqueada en los tests') }
globalThis.fetch = RED_BLOQUEADA

const S = await import('../lib/bot/whapi/salud.ts')
const C = await import('../lib/bot/whapi/cliente.ts')
const W = await import('../lib/bot/whapi/webhook.ts')
const R = await import('../lib/bot/whapi/ruta.ts')
const AJ = await import('../lib/bot/whapi/ajustes.ts')
const { textoLinkCloser } = await import('../lib/bot/alta/motor/mensajes.ts')

const TOKEN = `tok-${randomBytes(16).toString('hex')}`
const T0 = Date.parse('2026-10-26T15:00:00Z')
const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const GENERAL = '120363000000000777@g.us'
const AUTH = { status: 200, json: { channel_id: 'DAREDL-UHNK8', status: { code: 4, text: 'AUTH' } } }
const QR = { status: 200, json: { channel_id: 'DAREDL-UHNK8', status: { code: 3, text: 'QR' } } }
const ENVIADO = { status: 200, json: { sent: true, message: { id: 'abcd1234-ok' } } }

/** fetch falso: /health responde `salud()` (o la cola), lo demás `resto()`. Guarda cada pedido. */
function fetchFalso({ salud = () => AUTH, resto = () => ENVIADO } = {}) {
  const pedidos = []
  const f = async (url, init = {}) => {
    const u = new URL(String(url))
    const p = { ruta: u.pathname, metodo: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') }
    pedidos.push(p)
    const r = u.pathname === '/health' ? salud(p) : resto(p)
    if (r instanceof Error) throw r
    return new Response(typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  f.pedidos = pedidos
  f.de = (ruta) => pedidos.filter((p) => p.ruta === ruta)
  return f
}

/** Guardia nueva con avisos falsos (candado compartido en memoria, como el de Neon). */
function guardiaDe(op = {}) {
  const avisos = []
  let candadoHasta = 0
  const reloj = op.reloj ?? { t: T0 }
  const g = S.crearGuardiaSalud({
    deps: {
      avisar: async (texto, menciones) => { avisos.push({ texto, menciones }); return true },
      reclamarAviso: async (ttl) => { if (reloj.t < candadoHasta) return false; candadoHasta = reloj.t + ttl; return true },
      mencionTomas: () => op.tomas ?? '100000000000000001',
    },
  })
  return { g, avisos, reloj }
}
const clienteDe = (f, gd) => C.crearClienteWhapi({ token: TOKEN, fetch: f, esperar: async () => {}, ahora: () => gd.reloj.t, salud: gd.g })
async function rechaza(promesa, esperado) {
  try { await promesa } catch (e) {
    for (const [k, v] of Object.entries(esperado)) assert.equal(e[k], v, `${k}: ${e[k]} (${e.message})`)
    assert.ok(!e.message.includes(TOKEN), 'el mensaje tiene el token')
    return e
  }
  assert.fail('no tiró')
}

describe('guardia de salud: lectura de GET /health', () => {
  test('AUTH (code 4) es sano; QR, ERROR, code 4 con otro texto o "banned" no', () => {
    assert.equal(S.leerSalud({ status: { code: 4, text: 'AUTH' } }, T0).ok, true)
    assert.equal(S.leerSalud({ status: { text: 'AUTH' } }, T0).ok, true)
    assert.equal(S.leerSalud({ status: { code: 4 } }, T0).ok, true)
    for (const j of [{ status: { code: 3, text: 'QR' } }, { status: { code: 5, text: 'ERROR' } }, { status: { code: 4, text: 'LAUNCH' } }, { status: { code: 1, text: 'AUTH' } }, {}, { status: 'STOP' }]) {
      const s = S.leerSalud(j, T0)
      assert.equal(s.ok, false, JSON.stringify(j)); assert.match(s.motivo, /número del bot desconectado o suspendido/)
    }
    const ban = S.leerSalud({ status: { code: 4, text: 'AUTH', reason: 'banned' } }, T0)
    assert.equal(ban.ok, false); assert.equal(ban.baneado, true); assert.equal(ban.estado, 'BANNED')
    assert.equal(S.leerSalud({ status: { code: 4, text: 'AUTH' }, user: { status: 'BANNED' } }, T0).ok, false)
  })
  test('el aviso de Discord menciona a Tomás, explica qué hacer y dice que no se repite', () => {
    const t = S.textoAlerta({ estado: 'QR', motivo: 'x' }, '100000000000000001')
    assert.ok(t.startsWith('<@100000000000000001> 🚨 **WhatsApp del bot C.J: número del bot desconectado o suspendido** (QR).'))
    assert.match(t, /frenó TODOS los envíos por Whapi/); assert.match(t, /no se repite por 6 h/); assert.match(t, /NO lo vuelvas a vincular/)
  })
  test('la mención de Tomás sale de DISCORD_ID_TOMAS y, si falta o es inválida, su id de siempre', () => {
    try {
      assert.equal(S.depsAvisoReales.mencionTomas(), S.ID_TOMAS_POR_DEFECTO)
      process.env.DISCORD_ID_TOMAS = '123456789012345678'
      assert.equal(S.depsAvisoReales.mencionTomas(), '123456789012345678')
      process.env.DISCORD_ID_TOMAS = 'no-es-un-id'
      assert.equal(S.depsAvisoReales.mencionTomas(), S.ID_TOMAS_POR_DEFECTO)
    } finally { delete process.env.DISCORD_ID_TOMAS }
  })
  test('el aviso real va a DISCORD_WEBHOOK_URL (#alertas-dashboard) con allowed_mentions solo para Tomás; sin webhook no sale', async () => {
    assert.equal(await S.depsAvisoReales.avisar('hola', ['100000000000000001']), false)   // falta DISCORD_WEBHOOK_URL
    const previo = globalThis.fetch
    const pedidos = []
    try {
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/abc'
      globalThis.fetch = async (url, init) => { pedidos.push({ url: String(url), cuerpo: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: '999' }), { status: 200 }) }
      assert.equal(await S.depsAvisoReales.avisar('<@100000000000000001> hola', ['100000000000000001']), true)
      assert.equal(pedidos.length, 1)
      assert.ok(pedidos[0].url.startsWith('https://discord.test/api/webhooks/1/abc?wait=true'))
      assert.deepEqual(pedidos[0].cuerpo.allowed_mentions, { parse: [], users: ['100000000000000001'] })
    } finally { globalThis.fetch = previo; delete process.env.DISCORD_WEBHOOK_URL }
  })
})

describe('guardia de salud dentro del cliente real de Whapi', () => {
  test('sano: mira /health una vez y manda; con caché de 60 s no vuelve a mirar; a los 61 s sí', async () => {
    const gd = guardiaDe()
    const f = fetchFalso()
    const c = clienteDe(f, gd)
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'uno' })
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'dos' })
    assert.equal(f.de('/health').length, 1)
    assert.equal(f.de('/messages/text').length, 2)
    assert.equal(f.de('/health')[0].auth, `Bearer ${TOKEN}`)
    gd.reloj.t += 61_000
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'tres' })
    assert.equal(f.de('/health').length, 2)
    assert.equal(gd.avisos.length, 0)
  })
  test('las lecturas no miran /health (solo las escrituras: mandar, crear, agregar, foto, contacto…)', async () => {
    const gd = guardiaDe()
    const f = fetchFalso({ salud: () => QR, resto: () => ({ status: 200, json: { invite_code: 'AbCdEf123456' } }) })
    assert.equal(await clienteDe(f, gd).linkInvitacion(GENERAL), 'https://chat.whatsapp.com/AbCdEf123456')
    assert.equal(f.de('/health').length, 0)
  })
  test('número en QR: NINGUNA escritura sale (sin_numero, aplicado false) y avisa UNA sola vez a Discord con @Tomás', async () => {
    const gd = guardiaDe()
    const f = fetchFalso({ salud: () => QR })
    const c = clienteDe(f, gd)
    const e = await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' }), { name: 'ErrorWhapi', tipo: 'sin_numero', aplicado: false })
    assert.match(e.message, /número del bot desconectado o suspendido/)
    await rechaza(c.crearComunidad({ nombre: 'Ana Pérez - C.J', descripcion: 'x' }), { tipo: 'sin_numero' })
    await rechaza(c.crearGrupoEnComunidad({ comunidadId: GENERAL, nombre: 'General - Ana', participantes: ['5491111111111'] }), { tipo: 'sin_numero' })
    await rechaza(c.agregarParticipantes({ grupoId: GENERAL, participantes: ['5491111111111'] }), { tipo: 'sin_numero' })
    await rechaza(c.ponerFoto({ grupoId: GENERAL, foto: { url: 'https://x.test/a.jpg' } }), { tipo: 'sin_numero' })
    await rechaza(c.agendarContacto({ telefono: '5491111111111', nombre: 'Ana' }), { tipo: 'sin_numero' })
    await rechaza(c.enviarVideo({ chatId: GENERAL, url: 'https://x.test/v.mp4' }), { tipo: 'sin_numero' })
    assert.deepEqual(f.pedidos.filter((p) => p.ruta !== '/health'), [], 'salió una escritura con el número caído')
    assert.equal(c.registro().length, 0)
    assert.equal(gd.avisos.length, 1)
    assert.deepEqual(gd.avisos[0].menciones, ['100000000000000001'])
    assert.match(gd.avisos[0].texto, /^<@100000000000000001> 🚨 \*\*WhatsApp del bot C\.J: número del bot desconectado o suspendido\*\* \(QR\)\./)
    // Cada minuto vuelve a mirar, sigue caído: no se repite el aviso (6 h)
    for (let i = 0; i < 10; i++) { gd.reloj.t += 61_000; await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' }), { tipo: 'sin_numero' }) }
    assert.equal(gd.avisos.length, 1)
    // A las 6 h, si sigue caído, un recordatorio
    gd.reloj.t += 6 * 3600_000
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'hola' }), { tipo: 'sin_numero' })
    assert.equal(gd.avisos.length, 2)
  })
  test('el candado compartido evita el aviso repetido entre instancias (otra instancia ya avisó)', async () => {
    const reloj = { t: T0 }
    const a = guardiaDe({ reloj }), b = guardiaDe({ reloj })
    // Las dos comparten el candado "de Neon"
    let candado = 0
    for (const x of [a, b]) x.g = S.crearGuardiaSalud({ deps: { avisar: async (t, m) => { x.avisos.push({ t, m }); return true }, reclamarAviso: async (ttl) => { if (reloj.t < candado) return false; candado = reloj.t + ttl; return true }, mencionTomas: () => '1' } })
    await rechaza(clienteDe(fetchFalso({ salud: () => QR }), a).enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
    await rechaza(clienteDe(fetchFalso({ salud: () => QR }), b).enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
    assert.equal(a.avisos.length + b.avisos.length, 1)
  })
  test('cuando vuelve a AUTH, sale solo (sin intervención)', async () => {
    const gd = guardiaDe()
    let estado = QR
    const f = fetchFalso({ salud: () => estado })
    const c = clienteDe(f, gd)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
    estado = AUTH
    gd.reloj.t += 30_000
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })   // caché de 60 s
    gd.reloj.t += 31_000
    assert.deepEqual(await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { id: 'abcd1234-ok', simulado: false })
  })
  test('"banned" en /health (aunque diga AUTH) frena y avisa', async () => {
    const gd = guardiaDe()
    const f = fetchFalso({ salud: () => ({ status: 200, json: { status: { code: 4, text: 'AUTH', reason: 'banned' } } }) })
    await rechaza(clienteDe(f, gd).enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
    assert.equal(gd.avisos.length, 1); assert.match(gd.avisos[0].texto, /\(BANNED\)/)
  })
  test('/health que no responde (red o 5xx): no sale nada, pero NO se avisa (no se sabe); se vuelve a mirar a los 15 s', async () => {
    const gd = guardiaDe()
    let caido = true
    const f = fetchFalso({ salud: () => (caido ? new TypeError('fetch failed') : AUTH) })
    const c = clienteDe(f, gd)
    const e = await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero', aplicado: false })
    assert.match(e.message, /no se pudo confirmar que el número del bot esté conectado/)
    const f5 = fetchFalso({ salud: () => ({ status: 502, json: {} }) })
    await rechaza(clienteDe(f5, guardiaDe()).enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
    assert.equal(gd.avisos.length, 0)
    caido = false
    gd.reloj.t += 16_000
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' })
    assert.equal(f.de('/messages/text').length, 1)
  })
  test('un 401 de Whapi en cualquier respuesta: el número queda caído (la siguiente escritura ni sale) y avisa', async () => {
    const gd = guardiaDe()
    const f = fetchFalso({ resto: () => ({ status: 401, json: { error: { code: 401, message: 'Unauthorized' } } }) })
    const c = clienteDe(f, gd)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'auth' })
    assert.equal(gd.avisos.length, 1); assert.match(gd.avisos[0].texto, /HTTP 401/)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'y' }), { tipo: 'sin_numero' })
    assert.equal(f.de('/messages/text').length, 1)
    // Un 401 en una lectura también cuenta
    const gd2 = guardiaDe()
    await rechaza(clienteDe(fetchFalso({ resto: () => ({ status: 401, json: {} }) }), gd2).linkInvitacion(GENERAL), { tipo: 'auth' })
    assert.equal(gd2.avisos.length, 1)
  })
  test('"banned" en el error de una escritura: igual que un 401', async () => {
    const gd = guardiaDe()
    const f = fetchFalso({ resto: () => ({ status: 400, json: { error: { message: 'Channel is banned' } } }) })
    const c = clienteDe(f, gd)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'rechazo' })
    assert.equal(gd.avisos.length, 1)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'y' }), { tipo: 'sin_numero' })
  })
  test('un 403 obliga a mirar /health en el acto: si está en AUTH (p. ej. el bot no es admin) no se avisa ni se frena', async () => {
    const gd = guardiaDe()
    const f = fetchFalso({ resto: (p) => (p.ruta.startsWith('/groups/') ? { status: 403, json: { error: { message: 'Not permission' } } } : ENVIADO) })
    const c = clienteDe(f, gd)
    await rechaza(c.ponerFoto({ grupoId: GENERAL, foto: { url: 'https://x.test/a.jpg' } }), { tipo: 'prohibido' })
    assert.equal(f.de('/health').length, 2)   // la de antes de escribir y la forzada por el 403
    assert.equal(gd.avisos.length, 0)
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'sigue' })
    // Con el número caído, el 403 sí lo frena y avisa
    const gd2 = guardiaDe()
    let n = 0
    const f2 = fetchFalso({ salud: () => (n++ === 0 ? AUTH : QR), resto: () => ({ status: 403, json: {} }) })
    const c2 = clienteDe(f2, gd2)
    await rechaza(c2.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'prohibido' })
    assert.equal(gd2.avisos.length, 1)
    await rechaza(c2.enviarTexto({ chatId: GRUPOS.ventas, texto: 'y' }), { tipo: 'sin_numero' })
  })
  test('la caída que avisa el webhook (reportarCaida) frena hasta que /health diga AUTH, y avisa una vez', async () => {
    const gd = guardiaDe()
    let estado = AUTH
    const f = fetchFalso({ salud: () => estado })
    const c = clienteDe(f, gd)
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'antes' })
    estado = QR
    await gd.g.reportarCaida('webhook de Whapi: users.delete (LOGOUT)', { ahora: () => gd.reloj.t, estado: 'LOGOUT' })
    assert.equal(gd.avisos.length, 1); assert.match(gd.avisos[0].texto, /\(LOGOUT\)/)
    await rechaza(c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
    assert.equal(gd.avisos.length, 1)
    estado = AUTH
    gd.reloj.t += 61_000
    await c.enviarTexto({ chatId: GRUPOS.ventas, texto: 'volvió' })
    assert.equal(f.de('/messages/text').length, 2)
  })
  test('por defecto el cliente usa la guardia del proceso (todas las instancias de crearClienteWhapi la comparten)', async () => {
    const gd = guardiaDe()
    S.fijarGuardiaParaPruebas(gd.g)
    try {
      const f = fetchFalso({ salud: () => QR })
      const a = C.crearClienteWhapi({ token: TOKEN, fetch: f, ahora: () => gd.reloj.t })
      const b = C.crearClienteWhapi({ token: TOKEN, fetch: f, ahora: () => gd.reloj.t })
      await rechaza(a.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
      await rechaza(b.enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
      assert.equal(f.de('/health').length, 1)   // la segunda usa la caché compartida
      assert.equal(gd.avisos.length, 1)
    } finally { S.reiniciarGuardiaParaPruebas() }
  })
})

describe('la guardia cubre TODOS los envíos por Whapi, no solo el alta', () => {
  /** Con el fetch global falso: /health en QR. Ningún POST a /messages debe salir. */
  async function conNumeroCaido(fn) {
    const gd = guardiaDe()
    S.fijarGuardiaParaPruebas(gd.g)
    const previo = globalThis.fetch
    const f = fetchFalso({ salud: () => QR })
    globalThis.fetch = f
    process.env.WHAPI_TOKEN = TOKEN
    try { await fn(); return { f, gd } } finally {
      globalThis.fetch = previo
      delete process.env.WHAPI_TOKEN
      S.reiniciarGuardiaParaPruebas()
    }
  }
  test('Anuncios (enviarAlGrupo, g02/g04–g06)', async () => {
    const A = await import('../lib/bot/anuncios/whatsapp.ts')
    const { f, gd } = await conNumeroCaido(async () => {
      await rechaza(A.enviarAlGrupo('120363000000000888@g.us', 'optimización'), { tipo: 'sin_numero' })
    })
    assert.equal(f.de('/messages/text').length, 0); assert.equal(gd.avisos.length, 1)
  })
  test('Guiones (avisarCliente en el grupo Contenido)', async () => {
    const G = await import('../lib/bot/guiones/envio.ts')
    process.env.GUIONES_WHATSAPP = 'real'
    try {
      const { f } = await conNumeroCaido(async () => {
        let crmComprobado = false
        const r = await G.avisarCliente({ id_crm: 'Z001', cliente: 'PRUEBA BOT Guiones', guiones: { a: {} }, notas: [] }, '120363000000000889@g.us', 'https://docs.test/d', { exigirActivo: async id => { assert.equal(id, 'Z001'); crmComprobado = true } })
        assert.equal(crmComprobado, true)
        assert.equal(r.estado, 'error'); assert.match(r.motivo, /número del bot desconectado o suspendido/)
      })
      assert.equal(f.de('/messages/text').length, 0)
    } finally { delete process.env.GUIONES_WHATSAPP }
  })
  test('Grabación (e01 por WhatsApp): el envío tira con aplicado false (se suelta y se reintenta)', async () => {
    const GR = await import('../lib/bot/grabacion/servidor.ts')
    const { f } = await conNumeroCaido(async () => {
      const e = await rechaza(GR.e01WhatsappReal({}).enviar('120363000000000890@g.us', 'recordatorio'), { tipo: 'sin_numero', aplicado: false })
      assert.ok(e)
    })
    assert.equal(f.de('/messages/text').length, 0)
  })
})

describe('webhook: el cliente entra al grupo (groups_participants) y la caída del número', () => {
  const envio = (gp, extra = {}) => ({ groups_participants: gp, event: { type: 'groups', event: 'patch' }, channel_id: 'DAREDL-UHNK8', ...extra })
  const TS = Math.floor(T0 / 1000) - 30
  test('add / join en un grupo de cliente → EventoIngreso con teléfonos y @lid; Ventas / Verificaciones, otras acciones o viejos → descarte', () => {
    const r = W.clasificarEnvoltura(envio([{ group_id: GENERAL, participants: ['5491130001111@s.whatsapp.net', { id: '123456789012345@lid' }], action: 'add', timestamp: TS }]), GRUPOS, T0)
    assert.equal(r.eventos.length, 1)
    const e = r.eventos[0]
    assert.equal(e.tipo, 'ingreso'); assert.equal(e.chatId, GENERAL); assert.equal(e.grupo, null); assert.equal(e.accion, 'add')
    assert.deepEqual(e.participantes, ['5491130001111', '123456789012345@lid'])
    assert.equal(e.mensajeId, e.clave); assert.match(e.clave, /^in:[0-9a-f]{40}$/)
    assert.equal(W.clasificarEnvoltura(envio([{ group_id: GENERAL, participants: ['5491130001111'], action: 'join', timestamp: TS }]), GRUPOS, T0).eventos.length, 1)
    // El mismo ingreso dos veces = misma clave (Whapi reintenta)
    const otra = W.clasificarEnvoltura(envio([{ group_id: GENERAL, participants: [{ id: '123456789012345@lid' }, '5491130001111@s.whatsapp.net'], action: 'add', timestamp: TS }]), GRUPOS, T0)
    assert.equal(otra.eventos[0].clave, e.clave)
    const desc = (gp) => W.clasificarEnvoltura(envio([gp]), GRUPOS, T0).descartes
    assert.deepEqual(desc({ group_id: GRUPOS.ventas, participants: ['5491130001111'], action: 'add', timestamp: TS }), { otro_chat: 1 })
    assert.deepEqual(desc({ group_id: GENERAL, participants: ['5491130001111'], action: 'remove', timestamp: TS }), { accion: 1 })
    assert.deepEqual(desc({ group_id: GENERAL, participants: ['5491130001111'], action: 'add', timestamp: TS - 3 * 86400 }), { viejo: 1 })
    assert.deepEqual(desc({ group_id: 'no-es-un-grupo', participants: ['5491130001111'], action: 'add', timestamp: TS }), { forma: 1 })
    assert.deepEqual(desc({ group_id: GENERAL, participants: [], action: 'add', timestamp: TS }), { forma: 1 })
  })
  test('PATCH /settings pide groups.patch (para enterarse del ingreso)', () => {
    assert.ok(AJ.EVENTOS_BOT.some((e) => e.type === 'groups' && e.method === 'patch'))
  })
  test('users.delete por webhook: la ruta programa el aviso a la guardia (frena y avisa a Discord una vez)', async () => {
    const gd = guardiaDe()
    S.fijarGuardiaParaPruebas(gd.g)
    try {
      const SECRETO = randomBytes(24).toString('base64url')
      const env = { WHAPI_WEBHOOK_SECRETO: SECRETO, WHAPI_GRUPO_VENTAS: GRUPOS.ventas, WHAPI_GRUPO_VERIFICACIONES: GRUPOS.verificaciones }
      const tareas = []
      const deps = {
        crearMotor: () => { throw new Error('no debería armar el motor') }, clienteWhapi: () => { throw new Error('no') }, env, ahora: () => gd.reloj.t,
        log: { info() {}, warn() {}, error() {} }, programar: (t) => tareas.push(t), idInvocacion: () => 'x',
      }
      const req = new Request('https://x.test/api/bot/whapi', { method: 'POST', headers: { 'x-cj-bot-secreto': SECRETO, 'content-type': 'application/json' }, body: JSON.stringify({ event: { type: 'users', event: 'delete' }, user: { id: '5491100000000' }, channel_id: 'DAREDL-UHNK8' }) })
      const res = await R.atenderWebhook(req, deps)
      assert.equal(res.status, 200)
      assert.equal(tareas.length, 1)
      await Promise.all(tareas.map((t) => t()))
      assert.equal(gd.avisos.length, 1); assert.match(gd.avisos[0].texto, /\(LOGOUT\)/)
      // La guardia quedó frenando: la próxima escritura mira /health antes (y si sigue caído, no sale)
      const f = fetchFalso({ salud: () => QR })
      await rechaza(C.crearClienteWhapi({ token: TOKEN, fetch: f, ahora: () => gd.reloj.t }).enviarTexto({ chatId: GRUPOS.ventas, texto: 'x' }), { tipo: 'sin_numero' })
      assert.equal(gd.avisos.length, 1)
    } finally { S.reiniciarGuardiaParaPruebas() }
  })
})

describe('texto al closer con el link', () => {
  test('nombre de pila; sin nombre, "al cliente"', () => {
    assert.equal(textoLinkCloser('Nadia Blanco', 'https://chat.whatsapp.com/AbC123'), 'Pasale este link a Nadia para que entre a su grupo: https://chat.whatsapp.com/AbC123')
    assert.equal(textoLinkCloser(null, 'https://chat.whatsapp.com/AbC123'), 'Pasale este link al cliente para que entre a su grupo: https://chat.whatsapp.com/AbC123')
  })
})
