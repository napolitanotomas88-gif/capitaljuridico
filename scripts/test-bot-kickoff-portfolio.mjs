// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-bot-kickoff-portfolio.mjs
// Chequeo del portfolio del cliente en Meta para la ficha de kickoff (lib/bot/kickoff/portfolio.ts). SIN red: Graph se
// simula con un fetch falso que arma la respuesta de la Batch API a partir de fixtures, y fetch global queda bloqueado.
// Fixtures completamente ficticias con la estructura de Graph; sin cuentas, IDs, nombres ni contactos reales.
// En los fixtures el token de lectura es META_CLIENTES_TOKEN (el de Gero, como hoy): sus user_tasks cuentan como los de Gero.
// Para probar solo el cruce por nombre se usa el system user (chequearSU), cuyos user_tasks no son de nadie del equipo.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['META_ANUNCIOS_TOKEN', 'META_CLIENTES_TOKEN', 'META_ADS_WRITE_TOKEN', 'META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

process.env.KICKOFF_EQUIPO_GERO_A_EMAIL = 'grabador.a@example.test'
process.env.KICKOFF_EQUIPO_VALENTINO_EMAIL = 'grabador.b@example.test'
process.env.KICKOFF_EQUIPO_GERO_A_NOMBRES = 'geronimo,gero'
process.env.KICKOFF_EQUIPO_GERO_A_APELLIDOS = 'ficticioa'
process.env.KICKOFF_EQUIPO_VALENTINO_NOMBRES = 'valentino'
process.env.KICKOFF_EQUIPO_VALENTINO_APELLIDOS = 'ficticiob,secundariob'

process.env.KICKOFF_EQUIPO_GERO_A_NOMBRE = 'Gerónimo FicticioA'
process.env.KICKOFF_EQUIPO_VALENTINO_NOMBRE = 'Valentino'

const P = await import('../lib/bot/kickoff/portfolio.ts')
const { ITEMS_PORTFOLIO, MAILS_ACCESOS_EQUIPO, EQUIPO_ACCESOS_BASE, NOMBRE_ITEM_PORTFOLIO } = await import('../lib/bot/kickoff/tipos.ts')
const { crearCruce } = await import('../lib/anuncios/cruce.ts')

// ── Respuestas crudas de la sonda (24/10/2026) ──
const CRUDO = {"laura": {"cta": {"id": "act_2100000000000026", "name": "USD ESTUDIO JURIDICO CLIENTA UNO", "account_status": 1, "disable_reason": 0, "is_prepay_account": false, "funding_source_details": {"id": "1000000000000002", "type": 1}, "business": {"id": "2000000000000022", "name": "Estudio Clienta Uno", "verification_status": "not_verified"}, "owner": "2000000000000022", "user_tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, "agencias": [], "asignados": [{"id": "2000000000000012", "name": "Clienta Uno 1", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000010", "name": "Geronimo FicticioA", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000011", "name": "Valentino SecundarioB", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}], "propias": [{"id": "2000000000000020", "name": "Estudio Clienta Uno (página)"}], "cliente": [], "igNegocio": [], "igCuenta": [], "conjuntos": [], "creatividades": []}, "morales": {"cta": {"id": "act_2100000000000020", "name": "USD Cliente Dos", "account_status": 1, "disable_reason": 0, "is_prepay_account": false, "funding_source_details": {"id": "1000000000000005", "type": 1}, "business": {"id": "2000000000000021", "name": "Cliente Dos ADS", "verification_status": "not_verified"}, "owner": "2000000000000021", "user_tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, "agencias": [], "asignados": [{"id": "2000000000000015", "name": "Cliente Dos 1", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000019", "name": "Cliente Dos 2", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000016", "name": "Geronimo FicticioA", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000014", "name": "Valentino FicticioB SecundarioB", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}], "propias": [{"id": "2000000000000004", "name": "Cliente Dos (página)"}], "cliente": [], "igNegocio": [], "igCuenta": [], "conjuntos": [{"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000004"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000004"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000004"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "ACTIVE", "promoted_object": {"page_id": "2000000000000004"}}], "creatividades": [{"actor_id": "2000000000000004", "instagram_user_id": "2000000000000024"}, {"actor_id": "2000000000000004", "instagram_user_id": "2000000000000024"}, {"actor_id": "2000000000000004", "instagram_user_id": "2000000000000024"}, {"actor_id": "2000000000000004", "instagram_user_id": "2000000000000024", "object_story_spec": {"page_id": "2000000000000004", "instagram_user_id": "2000000000000024"}}, {"actor_id": "2000000000000004", "instagram_user_id": "2000000000000024"}]}, "estefi": {"cta": {"id": "act_2100000000000028", "name": "USD Clientes Tres", "account_status": 1, "disable_reason": 0, "is_prepay_account": false, "funding_source_details": {"id": "1000000000000007", "type": 1}, "business": {"id": "2000000000000025", "name": "Clientes Tres"}, "owner": "2000000000000025", "user_tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, "agencias": [{"id": "2000000000000009", "name": "Agencia Tres Asociados", "access_status": "CONFIRMED", "permitted_tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}], "asignados": [], "propias": [], "cliente": [], "igNegocio": {"error": {"code": 10, "message": "(#10) You do not have permission to perform this action. This action requires that you can VIEW_INSTAGRAM_ACCOUNTS for this business account."}}, "igCuenta": [{"id": "2000000000000023", "username": "estudio_clientes_tres"}], "conjuntos": [{"destination_type": "WHATSAPP", "effective_status": "ACTIVE", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}, {"destination_type": "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "effective_status": "PAUSED", "promoted_object": {"page_id": "2000000000000008"}}], "creatividades": [{"actor_id": "2000000000000008", "instagram_user_id": "2000000000000023", "object_story_spec": {"page_id": "2000000000000008", "instagram_user_id": "2000000000000023"}}, {"actor_id": "2000000000000008", "instagram_user_id": "2000000000000023", "object_story_spec": {"page_id": "2000000000000008", "instagram_user_id": "2000000000000023"}}, {"actor_id": "2000000000000008", "instagram_user_id": "2000000000000023", "object_story_spec": {"page_id": "2000000000000008", "instagram_user_id": "2000000000000023"}}, {"actor_id": "2000000000000008", "instagram_user_id": "2000000000000023", "object_story_spec": {"page_id": "2000000000000008", "instagram_user_id": "2000000000000023"}}, {"actor_id": "2000000000000008", "instagram_user_id": "2000000000000023"}], "viaAgencia": {"2000000000000009": [{"id": "2000000000000018", "name": "Persona Agencia 1", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000017", "name": "Geronimo FicticioA", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000007", "name": "Persona Agencia 2", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000005", "name": "Persona Agencia 3", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}, {"id": "2000000000000013", "name": "Valentino FicticioB SecundarioB", "tasks": ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]}]}}}
const AJENA = 'act_2000000000000006'
const ERROR_200 = { code: 200, message: '(#200) Ad account owner has NOT grant ads_management or ads_read permission' }

// ── Graph falso (Batch API) ──
const TOKEN_A = 'EAAprincipal' + 'x'.repeat(40), TOKEN_B = 'EAArespaldo' + 'y'.repeat(40)
const DOS = [{ nombre: 'META_ANUNCIOS_TOKEN', token: TOKEN_A }, { nombre: 'META_CLIENTES_TOKEN', token: TOKEN_B }]
const UNO = [{ nombre: 'META_CLIENTES_TOKEN', token: TOKEN_B }]
const clonar = x => JSON.parse(JSON.stringify(x))
const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } })
const ok = body => ({ code: 200, body: JSON.stringify(body) })
const mal = (error, code = 400) => ({ code, body: JSON.stringify({ error }) })
// 'NULO' = Graph no respondió ese subpedido (null en la respuesta del lote: timeout del lote)
const lista = x => (x === 'NULO' ? null : x && !Array.isArray(x) && x.error ? mal(x.error) : ok({ data: x ?? [] }))

/** Una respuesta de subpedido, como la daría Graph para el fixture `fx`. */
function responder(fx, p) {
  const u = p.relative_url
  if (/^act_\d+\?fields=/.test(u)) {
    if (fx.cta.error) return mal(fx.cta.error)
    if (p.name === 'cta' && p.omit_response_on_success !== false) return null   // Graph omite el cuerpo del pedido con nombre
    return ok(fx.cta)
  }
  if (u.includes('{result=cta:$.business.id}')) {
    if (fx.cta.error) return mal({ code: 100, message: 'Unable to resolve dependency cta' })
    if (!fx.cta.business?.id) return mal({ code: 100, message: 'Cannot resolve JSONPath $.business.id' })
  } else if (fx.cta.error) return mal(fx.cta.error)
  if (/\/agencies\?/.test(u)) return lista(fx.agencias)
  if (/\/assigned_users\?business=\{result/.test(u)) return lista(fx.asignados)
  const m = u.match(/\/assigned_users\?business=(\d+)&/)
  if (m) return lista(fx.viaAgencia?.[m[1]] ?? { error: { code: 2, message: 'Service temporarily unavailable' } })
  if (/owned_pages/.test(u)) return lista(fx.propias)
  if (/client_pages/.test(u)) return lista(fx.cliente)
  if (/^\{result=cta:\$\.business\.id\}\/instagram_accounts/.test(u)) return lista(fx.igNegocio)
  if (/^act_\d+\/instagram_accounts/.test(u)) return lista(fx.igCuenta)
  if (/\/adsets\?/.test(u)) return lista(fx.conjuntos)
  if (/\/adcreatives\?/.test(u)) return lista(fx.creatividades)
  return mal({ code: 100, message: `pedido desconocido: ${u}` })
}

/** porToken: token → fixture (o { lote: error } para un error de toda la llamada, o una función de la llamada n). */
function graph(porToken) {
  const registro = []
  const f = async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v23.0/')
    assert.equal(init.method, 'POST')
    const body = new URLSearchParams(init.body)
    const token = body.get('access_token')
    const pedidos = JSON.parse(body.get('batch'))
    registro.push({ token, pedidos })
    for (const p of pedidos) assert.equal(p.method, 'GET', 'todos los subpedidos son GET')
    let fx = porToken[token]
    if (typeof fx === 'function') fx = fx(registro.filter(x => x.token === token).length)
    if (!fx) return json({ error: { code: 190, message: `Invalid OAuth access token ${token}` } }, 400)
    if (fx.lote) return json({ error: fx.lote }, 400)
    return json(pedidos.map(p => responder(fx, p)))
  }
  f.registro = registro
  return f
}
const deps = (fetch, tokens = UNO, extra = {}) => ({ fetch, tokens, esperar: async () => {}, ...extra })
const estados = p => Object.fromEntries(ITEMS_PORTFOLIO.map(k => [k, p.items[k].estado]))

// ── Pedidos ──
describe('pedidos del lote', () => {
  test('9 GET encadenados por el business de la cuenta, el primero con nombre y su respuesta', () => {
    const ps = P.pedidosPortfolio('act_2100000000000026')
    assert.equal(ps.length, 9)
    assert.ok(ps.every(p => p.method === 'GET'))
    assert.equal(ps[0].name, 'cta')
    assert.equal(ps[0].omit_response_on_success, false)
    assert.equal(ps.filter(p => p.relative_url.includes('{result=cta:$.business.id}')).length, 4)
    assert.ok(ps.every(p => !/access_token|display_string/.test(p.relative_url)))
    assert.match(ps[0].relative_url, /funding_source_details\{id,type\}/)
    assert.match(ps[0].relative_url, /business\{id,name,verification_status\}/)
  })
  test('2.ª llamada: un assigned_users por agencia (máximo 5)', () => {
    const ps = P.pedidosAgencias('act_1', ['1', '2', '3', '4', '5', '6'])
    assert.equal(ps.length, 5)
    assert.equal(ps[0].relative_url, 'act_1/assigned_users?business=1&fields=id,name,tasks&limit=100')
  })
  test('idCuenta normaliza ids y rechaza nombres', () => {
    assert.equal(P.idCuenta('2100000000000026'), 'act_2100000000000026')
    assert.equal(P.idCuenta(' act_2100000000000026 '), 'act_2100000000000026')
    assert.equal(P.idCuenta('USD Estudio Pérez'), null)
    assert.equal(P.idCuenta('act_12'), null)
  })
})

// ── Cuentas reales de la investigación ──
describe('las 4 cuentas de la sonda', () => {
  test('Laura (act_2100000000000026): una llamada; IG y WhatsApp sin dato, lo demás ok', async () => {
    const g = graph({ [TOKEN_B]: CRUDO.laura })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g))
    assert.equal(p.leido, true)
    assert.equal(p.llamadas, 1)
    assert.equal(p.token, 'META_CLIENTES_TOKEN')
    assert.deepEqual(estados(p), { instagram: 'sin_dato', whatsapp_business: 'sin_dato', pagina_facebook: 'ok', portfolio_comercial: 'ok', tarjeta: 'ok', verificacion: 'ok', accesos_equipo: 'ok' })
    assert.match(p.items.portfolio_comercial.detalle, /«Estudio Clienta Uno», dueño de la cuenta/)
    assert.match(p.items.pagina_facebook.detalle, /Página en el portfolio: «Estudio Clienta Uno \(página\)»/)
    assert.equal(p.items.tarjeta.detalle, 'Hay medio de pago: sí (tarjeta de crédito/débito); sin deuda')
    // "Sin verificar" solo para la verificación de Meta, dicho entero y con que no frena nada
    assert.equal(p.items.verificacion.detalle, 'Cuenta publicitaria activa, sin restricciones · el portfolio no está verificado por Meta (no frena nada)')
    assert.match(p.items.accesos_equipo.detalle, /Gerónimo FicticioA y Valentino/)
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].fuente === 'meta'))
    assert.deepEqual(p.negocio, { id: '2000000000000022', nombre: 'Estudio Clienta Uno' })
    assert.equal(p.datos.hay_medio_pago, true)
    assert.equal(p.datos.verificacion_portfolio, 'not_verified')
    assert.equal(p.aviso, null)
  })
  test('Morales Ruiz: IG y WhatsApp salen de los anuncios; Valentino figura como "Valentino FicticioB SecundarioB"', async () => {
    const p = await P.chequearPortfolio('2100000000000020', deps(graph({ [TOKEN_B]: CRUDO.morales })))
    assert.equal(p.cuenta, 'act_2100000000000020')
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'ok'), JSON.stringify(estados(p)))
    assert.equal(p.items.instagram.detalle, 'Instagram: una cuenta usada en los anuncios')
    assert.equal(p.items.whatsapp_business.detalle, 'Deducido de los anuncios: 4 conjuntos con destino WhatsApp (1 activo)')
    assert.equal(p.llamadas, 1)
  })
  test('Estefi & Lean: accesos por la agencia (2.ª llamada); página e IG de los anuncios; verificación no visible', async () => {
    const g = graph({ [TOKEN_B]: CRUDO.estefi })
    const p = await P.chequearPortfolio('act_2100000000000028', deps(g))
    assert.equal(p.llamadas, 2)
    assert.equal(g.registro[1].token, TOKEN_B, 'la 2.ª llamada va con el mismo token')
    assert.equal(g.registro[1].pedidos[0].relative_url, 'act_2100000000000028/assigned_users?business=2000000000000009&fields=id,name,tasks&limit=100')
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'ok'), JSON.stringify(estados(p)))
    assert.equal(p.items.pagina_facebook.detalle, 'Los anuncios usan 1 página (no se ve en el portfolio con nuestro acceso)')
    assert.equal(p.items.instagram.detalle, 'Instagram: @estudio_clientes_tres')
    assert.match(p.items.whatsapp_business.detalle, /27 conjuntos con destino WhatsApp \(1 activo\)/)
    assert.equal(p.items.verificacion.detalle, 'Cuenta activa; portfolio: verificación no visible con este token')
    assert.match(p.items.accesos_equipo.detalle, /a través de la agencia «Agencia Tres Asociados»/)
    assert.equal(p.datos.token_miembro_portfolio, false)
    assert.deepEqual(p.datos.agencias, ['Agencia Tres Asociados'])
  })
  test('cuenta ajena (#200 con los dos tokens): seis sin dato y accesos "falta" para Gerónimo FicticioA', async () => {
    const g = graph({ [TOKEN_A]: { cta: { error: ERROR_200 } }, [TOKEN_B]: { cta: { error: ERROR_200 } } })
    const p = await P.chequearPortfolio(AJENA, deps(g, DOS))
    assert.equal(p.leido, false)
    assert.equal(p.motivo, 'sin_acceso')
    assert.equal(p.llamadas, 2, 'probó con el token de respaldo')
    assert.equal(p.token, 'META_CLIENTES_TOKEN', 'el "no" que cuenta es el del token de Gero')
    assert.deepEqual(g.registro.map(x => x.token), [TOKEN_A, TOKEN_B])
    for (const k of ITEMS_PORTFOLIO.filter(k => k !== 'accesos_equipo')) assert.equal(p.items[k].estado, 'sin_dato', k)
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.match(p.items.accesos_equipo.detalle, /falta darle acceso a Gerónimo FicticioA \(grabador\.a@example\.test\)/)
    assert.match(p.items.tarjeta.detalle, /Meta no deja leer la cuenta act_2000000000000006 con nuestro acceso \(#200\)/)
    assert.match(p.aviso, /Gerónimo FicticioA \(grabador\.a@example\.test\) y Valentino \(grabador\.b@example\.test\)/)
  })
})

// ── Tokens: respaldo, límite, transitorios, timeout ──
describe('tokens y errores de Meta', () => {
  test('permisos con el principal → el de respaldo, que sí ve la cuenta', async () => {
    const g = graph({ [TOKEN_A]: { cta: { error: { code: 100, error_subcode: 33, message: 'Unsupported get request' } } }, [TOKEN_B]: CRUDO.laura })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g, DOS))
    assert.equal(p.leido, true)
    assert.equal(p.token, 'META_CLIENTES_TOKEN')
    assert.equal(p.llamadas, 2)
  })
  test('token inválido en toda la llamada (#190) → el de respaldo', async () => {
    const g = graph({ [TOKEN_A]: { lote: { code: 190, message: 'Error validating access token' } }, [TOKEN_B]: CRUDO.morales })
    const p = await P.chequearPortfolio('act_2100000000000020', deps(g, DOS))
    assert.equal(p.token, 'META_CLIENTES_TOKEN')
    assert.equal(p.items.whatsapp_business.estado, 'ok')
  })
  test('#613 (límite): todo sin dato, aviso de reintentar y no insiste con el otro token', async () => {
    const g = graph({ [TOKEN_A]: { cta: { error: { code: 613, message: 'Calls to this api have exceeded the rate limit.' } } }, [TOKEN_B]: CRUDO.laura })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g, DOS))
    assert.equal(p.motivo, 'limite')
    assert.equal(g.registro.length, 1)
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'sin_dato'))
    assert.match(p.items.instagram.detalle, /Meta limitó las consultas \(#613\)/)
    assert.equal(p.aviso, 'Reintentar el chequeo en unos minutos')
  })
  test('#17 y #4 en toda la llamada también son límite', async () => {
    for (const code of [17, 4, 32, 80004]) {
      const p = await P.chequearPortfolio('act_2100000000000026', deps(graph({ [TOKEN_B]: { lote: { code, message: 'limit' } } })))
      assert.equal(p.motivo, 'limite', String(code))
    }
  })
  test('transitorio (#2): un reintento con el mismo token', async () => {
    const g = graph({ [TOKEN_B]: n => (n === 1 ? { cta: { error: { code: 2, message: 'Service temporarily unavailable' } } } : CRUDO.laura) })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g))
    assert.equal(p.leido, true)
    assert.equal(p.llamadas, 2)
  })
  test('transitorio dos veces → error, sin datos inventados', async () => {
    const g = graph({ [TOKEN_B]: { cta: { error: { code: 1, message: 'An unknown error occurred' } } } })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g))
    assert.equal(p.motivo, 'error')
    assert.equal(p.llamadas, 2)
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'sin_dato'))
  })
  test('timeout total: Meta colgada → se aborta el fetch (TimeoutError) y todo sin dato con motivo timeout', async () => {
    // Tope de 1 s (con menos de 300 ms chequearPortfolio corta antes de llamar y no se probaría el abort). El timer de
    // AbortSignal.timeout no retiene el event loop de Node: `guardia` lo mantiene vivo mientras el fetch está colgado.
    let llamado = 0
    const colgado = (url, init) => { llamado++; return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) }
    const guardia = setTimeout(() => {}, 5_000)
    try {
      const t0 = Date.now()
      const p = await P.chequearPortfolio('act_2100000000000026', deps(colgado, UNO, { timeoutMs: 1_000 }))
      const ms = Date.now() - t0
      assert.equal(llamado, 1, 'el fetch se llamó una vez y se abortó')
      assert.ok(ms >= 900 && ms < 3_000, `tardó ${ms} ms`)
      assert.equal(p.motivo, 'timeout')
      assert.equal(p.items.tarjeta.detalle, 'Meta no respondió en 1 s', 'el texto usa el tope real, no los 12 s por defecto')
      assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'sin_dato'))
    } finally { clearTimeout(guardia) }
  })
  test('sin tokens → sin_token, ni una llamada', async () => {
    const g = graph({})
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g, []))
    assert.equal(p.motivo, 'sin_token')
    assert.equal(g.registro.length, 0)
  })
  test('id inválido → error sin llamar a Meta', async () => {
    const g = graph({})
    const p = await P.chequearPortfolio('USD Estudio', deps(g))
    assert.equal(p.motivo, 'error')
    assert.equal(g.registro.length, 0)
  })
  test('por defecto usa tokensMeta() (lectura) y NUNCA META_ADS_WRITE_TOKEN', async () => {
    process.env.META_CLIENTES_TOKEN = 'EAAlectura_env_' + 'z'.repeat(30)
    process.env.META_ADS_WRITE_TOKEN = 'EAAescritura_NO_' + 'w'.repeat(30)
    try {
      const g = graph({ [process.env.META_CLIENTES_TOKEN]: CRUDO.laura })
      const p = await P.chequearPortfolio('act_2100000000000026', { fetch: g })
      assert.equal(p.token, 'META_CLIENTES_TOKEN')
      assert.ok(g.registro.every(x => x.token === process.env.META_CLIENTES_TOKEN))
      assert.ok(g.registro.every(x => !JSON.stringify(x).includes('escritura')))
    } finally {
      delete process.env.META_CLIENTES_TOKEN
      delete process.env.META_ADS_WRITE_TOKEN
    }
  })
  test('ningún token ni dato de tarjeta en la salida (ni siquiera en los errores)', async () => {
    const g = graph({ [TOKEN_B]: { cta: { error: { code: 1, message: `Invalid parameter ${TOKEN_B} https://x/?access_token=${TOKEN_B}&a=1` } } } })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g))
    const s = JSON.stringify(p)
    assert.ok(!s.includes(TOKEN_B))
    assert.match(p.items.tarjeta.detalle, /\*\*\*/)
    // Aunque Graph devolviera la marca y los últimos números (no se piden: CAMPOS_CUENTA es funding_source_details{id,type}),
    // no salen ni en los ítems ni en `datos`
    const conMarca = clonar(CRUDO.laura)
    conMarca.cta.funding_source_details = { id: '1000000000000002', type: 1, display_string: 'Mastercard *4242' }
    const bien = JSON.stringify(await P.chequearPortfolio('act_2100000000000026', deps(graph({ [TOKEN_B]: conMarca }))))
    assert.match(bien, /tarjeta de crédito\/débito/)
    assert.ok(!/display_string|Mastercard|4242|1000000000000002/.test(bien), 'ni la marca, ni los números, ni el id del medio de pago')
    assert.doesNotMatch(P.CAMPOS_CUENTA, /display_string|funding_source[^_]|balance/)
  })
})

// ── Token roto (vencido, revocado) ≠ cuenta sin acceso ──
describe('token roto vs. cuenta sin acceso', () => {
  const SU = 'META_ANUNCIOS_TOKEN'
  const vencido = { code: 190, error_subcode: 463, message: 'Error validating access token: Session has expired' }
  test('#190 en toda la llamada con todos los tokens → token_invalido: nunca "falta" ni aviso al cliente', async () => {
    const g = graph({ [TOKEN_A]: { lote: vencido }, [TOKEN_B]: { lote: vencido } })
    const p = await P.chequearPortfolio(AJENA, deps(g, DOS))
    assert.equal(p.motivo, 'token_invalido')
    assert.equal(p.llamadas, 2)
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'sin_dato'), JSON.stringify(estados(p)))
    assert.match(p.items.accesos_equipo.detalle, /El token de Meta META_ANUNCIOS_TOKEN y META_CLIENTES_TOKEN está vencido o es inválido \(#190\/463\)/)
    assert.equal(p.aviso, 'Renovar META_ANUNCIOS_TOKEN y META_CLIENTES_TOKEN y volver a chequear (no es un problema de la cuenta del cliente)')
    assert.doesNotMatch(p.aviso, /cliente que le dé acceso/)
  })
  test('un solo token (el de Gero, como hoy) vencido → token_invalido, no "falta"', async () => {
    const p = await P.chequearPortfolio(AJENA, deps(graph({ [TOKEN_B]: { lote: vencido } })))
    assert.equal(p.motivo, 'token_invalido')
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.aviso, /^Renovar META_CLIENTES_TOKEN/)
  })
  test('#190 en el subpedido de la cuenta (no en toda la llamada) también es del token', async () => {
    const p = await P.chequearPortfolio(AJENA, deps(graph({ [TOKEN_B]: { cta: { error: vencido } } })))
    assert.equal(p.motivo, 'token_invalido')
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
  })
  test('#200 del system user y #190 de Gero → sin_acceso, pero accesos sin dato (de Gero no se sabe nada)', async () => {
    const g = graph({ [TOKEN_A]: { cta: { error: ERROR_200 } }, [TOKEN_B]: { lote: vencido } })
    const p = await P.chequearPortfolio(AJENA, deps(g, DOS))
    assert.equal(p.motivo, 'sin_acceso')
    assert.equal(p.token, SU)
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.items.accesos_equipo.detalle, /así no se sabe si Gerónimo FicticioA y Valentino tienen acceso$/)
    assert.match(p.items.accesos_equipo.tecnico, /system user \(META_ANUNCIOS_TOKEN\)/, 'el detalle técnico va aparte (a los ajustes)')
    assert.doesNotMatch(p.aviso, /Pedirle al cliente/)
    assert.match(p.aviso, /el system user \(META_ANUNCIOS_TOKEN\) no ve la cuenta.*renovar META_CLIENTES_TOKEN \(vencido o inválido\)/)
  })
  test('solo el system user cargado y #200 → sin_acceso con accesos sin dato', async () => {
    const p = await P.chequearPortfolio(AJENA, deps(graph({ [TOKEN_A]: { cta: { error: ERROR_200 } } }), [DOS[0]]))
    assert.equal(p.motivo, 'sin_acceso')
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.aviso, /^Revisar a mano los accesos/)
  })
  test('#190 del system user y #200 de Gero → "falta" para Gero, y además renovar el del system user', async () => {
    const g = graph({ [TOKEN_A]: { lote: vencido }, [TOKEN_B]: { cta: { error: ERROR_200 } } })
    const p = await P.chequearPortfolio(AJENA, deps(g, DOS))
    assert.equal(p.motivo, 'sin_acceso')
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.match(p.aviso, /^Pedirle al cliente que le dé acceso a la cuenta a Gerónimo FicticioA.*; además, renovar META_ANUNCIOS_TOKEN \(vencido o inválido\)$/)
  })
  test('#200 de Gero y después #200 del system user (otro orden): igual cuenta el de Gero', async () => {
    const g = graph({ [TOKEN_B]: { cta: { error: ERROR_200 } }, [TOKEN_A]: { cta: { error: ERROR_200 } } })
    const p = await P.chequearPortfolio(AJENA, deps(g, [DOS[1], DOS[0]]))
    assert.equal(p.token, 'META_CLIENTES_TOKEN')
    assert.equal(p.items.accesos_equipo.estado, 'falta')
  })
  test('#100 SIN subcode «missing permission» (como lo da Graph) → prueba el de respaldo', async () => {
    const sinSub = { code: 100, message: '(#100) Object does not exist, cannot be loaded due to missing permission or reviewable feature, or does not support this operation' }
    const g = graph({ [TOKEN_A]: { cta: { error: sinSub } }, [TOKEN_B]: CRUDO.laura })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g, DOS))
    assert.equal(p.leido, true)
    assert.equal(p.llamadas, 2)
    assert.equal(p.token, 'META_CLIENTES_TOKEN')
  })
  test('#100/33 (también un id mal cargado) → sin_acceso que avisa revisar el id', async () => {
    const p = await P.chequearPortfolio('act_123456789', deps(graph({ [TOKEN_B]: { cta: { error: { code: 100, error_subcode: 33, message: 'Unsupported get request.' } } } })))
    assert.equal(p.motivo, 'sin_acceso')
    assert.match(p.items.tarjeta.detalle, /\(#100\/33\) \(o el id de la cuenta está mal: revisar Cuentas Meta\)$/)
    assert.match(p.aviso, /o el id de la cuenta está mal/)
  })
  test('sin lectura (puro): el "falta" de accesos depende del token que recibió el "no"', () => {
    assert.equal(P.portfolioSinLectura(AJENA, 'sin_acceso', ERROR_200, { token: 'META_CLIENTES_TOKEN' }).items.accesos_equipo.estado, 'falta')
    assert.equal(P.portfolioSinLectura(AJENA, 'sin_acceso', ERROR_200, { token: SU }).items.accesos_equipo.estado, 'sin_dato')
    assert.equal(P.portfolioSinLectura(AJENA, 'sin_acceso', ERROR_200).items.accesos_equipo.estado, 'sin_dato', 'sin saber el token, no se afirma nada')
    assert.equal(P.portfolioSinLectura(AJENA, 'timeout', null, { topeMs: 12_000 }).items.instagram.detalle, 'Meta no respondió en 12 s')
  })
})

// ── Reglas de cada ítem ──
const laura = (cambios = {}) => ({ ...clonar(CRUDO.laura), cta: { ...clonar(CRUDO.laura.cta), ...cambios } })
const chequear = fx => P.chequearPortfolio(fx.cta.id ?? 'act_2100000000000026', deps(graph({ [TOKEN_B]: fx })))

describe('tarjeta y verificación', () => {
  test('deuda (account_status 3): tarjeta "problema" y verificación "problema" (ver Tarjeta)', async () => {
    const p = await chequear(laura({ account_status: 3 }))
    assert.equal(p.items.tarjeta.estado, 'problema')
    assert.match(p.items.tarjeta.detalle, /con pago pendiente \(deuda\): hay que regularizar el pago/)
    assert.equal(p.items.verificacion.estado, 'problema')
    assert.match(p.items.verificacion.detalle, /ver Tarjeta/)
  })
  test('8 y 9 también son deuda', async () => {
    for (const st of [8, 9]) assert.equal((await chequear(laura({ account_status: st }))).items.tarjeta.estado, 'problema', String(st))
  })
  test('balance > 0 en pospago NO es deuda (guardia: balance ni se pide, la deuda sale de account_status)', async () => {
    assert.doesNotMatch(P.CAMPOS_CUENTA, /(^|,)balance(,|$)/)
    assert.doesNotMatch(P.pedidosPortfolio('act_2100000000000026')[0].relative_url, /balance/)
    const p = await chequear(laura({ balance: '5193', is_prepay_account: false }))
    assert.equal(p.items.tarjeta.estado, 'ok')
  })
  test('tipos que en el enum de Meta son "sin medio de pago" (14 FS_NULL, 18 DUMMY) → "falta", no "ok"', async () => {
    for (const type of [14, 18]) {
      const p = await chequear(laura({ funding_source_details: { id: '1', type } }))
      assert.equal(p.items.tarjeta.estado, 'falta', String(type))
      assert.equal(p.datos.hay_medio_pago, false)
    }
  })
  test('tipos que no son un medio de pago (9 FEE, 10 FX, 11, 15, 16) o desconocidos → sin dato a revisar', async () => {
    for (const type of [9, 10, 11, 15, 16, 99]) {
      const p = await chequear(laura({ funding_source_details: { id: '1', type } }))
      assert.equal(p.items.tarjeta.estado, 'sin_dato', String(type))
      assert.equal(p.items.tarjeta.detalle, `Meta informa un medio de pago de tipo ${type}, que no es uno reconocido: revisar a mano`)
      assert.equal(p.datos.hay_medio_pago, null)
    }
  })
  test('un "falta" de la llamada no lo pisa un medio de pago tipo 14', async () => {
    const meta = await chequear(laura({ funding_source_details: { id: '1', type: 14 } }))
    const c = P.combinarPortfolio(meta, { tarjeta: { estado: 'falta', detalle: 'todavía no cargó la tarjeta' } })
    assert.equal(c.tarjeta.estado, 'falta')
    assert.equal(c.tarjeta.discrepancia, null)
  })
  test('sin medio de pago → "falta" (sin funding_source_details o tipo 0)', async () => {
    const sin = laura(); delete sin.cta.funding_source_details
    assert.equal((await chequear(sin)).items.tarjeta.estado, 'falta')
    const p = await chequear(laura({ funding_source_details: { id: '1', type: 0 } }))
    assert.equal(p.items.tarjeta.estado, 'falta')
    assert.equal(p.items.tarjeta.detalle, 'Hay medio de pago: no (la cuenta no tiene tarjeta cargada)')
    assert.equal(p.datos.hay_medio_pago, false)
  })
  test('sin MANAGE no se ve el medio de pago → sin dato (no "falta")', async () => {
    const sin = laura({ user_tasks: ['ANALYZE'] }); delete sin.cta.funding_source_details
    assert.equal((await chequear(sin)).items.tarjeta.estado, 'sin_dato')
  })
  test('prepaga con saldo prepago → ok con la nota', async () => {
    const p = await chequear(laura({ is_prepay_account: true, funding_source_details: { id: '1', type: 20 } }))
    assert.equal(p.items.tarjeta.detalle, 'Hay medio de pago: sí (saldo prepago, cuenta prepaga); sin deuda')
  })
  test('cuenta deshabilitada por riesgo en los pagos → verificación y tarjeta "problema"', async () => {
    const p = await chequear(laura({ account_status: 2, disable_reason: 3 }))
    assert.equal(p.items.verificacion.estado, 'problema')
    assert.equal(p.items.verificacion.detalle, 'Cuenta deshabilitada (motivo: riesgo en los pagos); portfolio: sin verificar')
    assert.equal(p.items.tarjeta.estado, 'problema')
    assert.equal(p.items.tarjeta.detalle, 'Cuenta deshabilitada por riesgo en los pagos: revisar el medio de pago')
  })
  test('deshabilitada por otro motivo (políticas) → la tarjeta sigue "ok"', async () => {
    const p = await chequear(laura({ account_status: 2, disable_reason: 1 }))
    assert.equal(p.items.verificacion.estado, 'problema')
    assert.equal(p.items.tarjeta.estado, 'ok')
  })
  test('cuenta comprometida, en revisión, cerrada', async () => {
    assert.match((await chequear(laura({ account_status: 2, disable_reason: 15 }))).items.verificacion.detalle, /comprometida/)
    assert.match((await chequear(laura({ account_status: 7 }))).items.verificacion.detalle, /en revisión de riesgo/)
    assert.match((await chequear(laura({ account_status: 101 }))).items.verificacion.detalle, /^Cuenta cerrada/)
  })
  test('portfolio verificado / rechazado / sin verificar (decisión de Tomás: ok con la nota, no frena nada)', async () => {
    const neg = v => ({ ...CRUDO.laura.cta.business, verification_status: v })
    const verificado = await chequear(laura({ business: neg('verified') }))
    assert.equal(verificado.items.verificacion.detalle, 'Cuenta activa; portfolio: verificado')
    assert.ok(!/sin verificar/.test(verificado.items.portfolio_comercial.detalle), 'verificado: sin la nota')
    const sinVerif = await chequear(laura({ business: neg('not_verified') }))
    assert.equal(sinVerif.items.portfolio_comercial.estado, 'ok')
    assert.match(sinVerif.items.portfolio_comercial.detalle, / · sin verificar \(no frena nada\)$/)
    const r = await chequear(laura({ business: neg('rejected') }))
    assert.equal(r.items.verificacion.estado, 'problema')
    assert.equal(P.ESTADO_PORTFOLIO_SIN_VERIFICAR, 'ok')
    assert.equal((await chequear(laura({ business: neg('not_verified') }))).items.verificacion.estado, 'ok')
  })
})

describe('portfolio, página e Instagram', () => {
  test('cuenta personal (sin portfolio): portfolio "falta"; página y accesos sin dato', async () => {
    const fx = laura(); delete fx.cta.business; fx.cta.owner = '999'
    const p = await chequear(fx)
    assert.equal(p.items.portfolio_comercial.estado, 'falta')
    assert.match(p.items.portfolio_comercial.detalle, /cuenta personal/)
    assert.equal(p.items.pagina_facebook.estado, 'sin_dato')
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.equal(p.items.verificacion.detalle, 'Cuenta activa; portfolio: sin portfolio')
  })
  test('la cuenta figura a nombre de otro dueño → ok con "revisar"', async () => {
    const p = await chequear(laura({ owner: '123' }))
    assert.match(p.items.portfolio_comercial.detalle, /otro dueño: revisar/)
  })
  test('nombres con espacios de más (como «Alfredo Morales Ruiz ») salen recortados', async () => {
    const p = await chequear(laura({ name: ' USD Cuenta Uno ', business: { ...CRUDO.laura.cta.business, name: 'Estudio Clienta Uno ' } }))
    assert.equal(p.items.portfolio_comercial.detalle, 'Portfolio «Estudio Clienta Uno», dueño de la cuenta · sin verificar (no frena nada)')
    assert.equal(p.nombre, 'USD Cuenta Uno')
    assert.equal(p.negocio.nombre, 'Estudio Clienta Uno')
  })
  test('portfolio sin páginas y sin anuncios: "falta" si el token es miembro; si no, sin dato', async () => {
    const fx = laura(); fx.propias = []
    assert.equal((await chequear(fx)).items.pagina_facebook.estado, 'falta')
    const ajeno = laura({ business: { id: '2000000000000022', name: 'Estudio Clienta Uno' } }); ajeno.propias = []
    const p = await chequear(ajeno)
    assert.equal(p.items.pagina_facebook.estado, 'sin_dato')
    assert.match(p.items.pagina_facebook.detalle, /^No se ven las páginas del portfolio con nuestro acceso y la cuenta no tiene anuncios: revisalo/)
    assert.match(p.items.pagina_facebook.tecnico, /el token no es miembro del portfolio/)
  })
  test('Instagram vacío NUNCA es "falta"', async () => {
    const p = await chequear(laura())
    assert.equal(p.items.instagram.estado, 'sin_dato')
    // Sin nombres de permisos en la pantalla: qué revisar a mano; el permiso que falta, en el detalle técnico
    assert.match(p.items.instagram.detalle, /Meta no nos deja ver el Instagram vinculado solo a la página: revisalo en el portfolio del cliente/)
    assert.doesNotMatch(p.items.instagram.detalle, /instagram_basic|token/)
    assert.match(p.items.instagram.tecnico, /instagram_basic \/ pages_read_engagement/)
  })
  test('WhatsApp: solo de conjuntos con destino WHATSAPP; si no se pudieron leer, sin dato con el código', async () => {
    const fx = laura(); fx.conjuntos = [{ destination_type: 'MESSENGER', effective_status: 'ACTIVE' }]
    assert.equal((await chequear(fx)).items.whatsapp_business.estado, 'sin_dato')
    fx.conjuntos = { error: { code: 17, message: 'User request limit reached' } }
    const w = (await chequear(fx)).items.whatsapp_business
    assert.match(w.detalle, /^No se pudieron leer los anuncios de la cuenta y Meta no nos deja leer el número de la página: revisalo en la página/)
    assert.match(w.tecnico, /adsets: #17/)
  })
})

describe('accesos del equipo (por nombre y por el token de Gero)', () => {
  const conAsignados = asignados => { const fx = laura(); fx.asignados = asignados; return fx }
  const todo = ['DRAFT', 'ANALYZE', 'ADVERTISE', 'MANAGE']
  // Con el system user (META_ANUNCIOS_TOKEN) los user_tasks de la cuenta NO son de Gero: solo cuenta el cruce por nombre
  const SU = [{ nombre: 'META_ANUNCIOS_TOKEN', token: TOKEN_A }]
  const chequearSU = fx => P.chequearPortfolio(fx.cta.id ?? 'act_2100000000000026', deps(graph({ [TOKEN_A]: fx }), SU))
  // Estefi con el token miembro del portfolio dueño (verification_status visible)
  const estefiMiembro = () => { const fx = clonar(CRUDO.estefi); fx.cta.business.verification_status = 'verified'; return fx }
  test('falta Valentino → "falta" diciendo quién (con su mail) y el aviso', async () => {
    const p = await chequear(conAsignados([{ id: '1', name: 'Geronimo FicticioA', tasks: todo }]))
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.equal(p.items.accesos_equipo.detalle, 'Falta darle acceso a Valentino (grabador.b@example.test)')
    assert.equal(p.aviso, 'Pedirle al cliente: darle acceso a Valentino (grabador.b@example.test)')
  })
  test('faltan los dos (system user: sin la señal del token)', async () => {
    const p = await chequearSU(conAsignados([{ id: '1', name: 'Clienta Uno', tasks: todo }]))
    assert.match(p.items.accesos_equipo.detalle, /^Falta darle acceso a Gerónimo FicticioA \(grabador\.a@example\.test\) y Valentino/)
  })
  test('con META_CLIENTES_TOKEN, user_tasks ADVERTISE/MANAGE = Gero tiene acceso aunque no figure por nombre', async () => {
    const fx = conAsignados([{ id: '1', name: 'Clienta Uno', tasks: todo }, { id: '2', name: 'Valentino SecundarioB', tasks: todo }])
    const p = await chequear(fx)
    assert.equal(p.items.accesos_equipo.estado, 'ok')
    assert.equal(p.items.accesos_equipo.detalle, 'Con acceso para anunciar: Gerónimo FicticioA y Valentino (Gerónimo FicticioA según los permisos de su token)')
    const su = await chequearSU(fx)
    assert.equal(su.items.accesos_equipo.estado, 'falta', 'con el system user esos user_tasks no son de Gero')
    assert.match(su.items.accesos_equipo.detalle, /^Falta darle acceso a Gerónimo FicticioA/)
  })
  test('con META_CLIENTES_TOKEN pero solo ANALYZE en user_tasks → no alcanza para dar a Gero por bueno', async () => {
    const fx = conAsignados([{ id: '2', name: 'Valentino SecundarioB', tasks: todo }]); fx.cta.user_tasks = ['ANALYZE']
    const p = await chequear(fx)
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.match(p.items.accesos_equipo.detalle, /^Falta darle acceso a Gerónimo FicticioA/)
  })
  test('nombres con tildes y mayúsculas cuentan', async () => {
    const p = await chequearSU(conAsignados([{ id: '1', name: 'GERÓNIMO  FicticioA', tasks: todo }, { id: '2', name: 'Valentino FicticioB Monsú', tasks: ['ADVERTISE'] }]))
    assert.equal(p.items.accesos_equipo.estado, 'ok')
  })
  test('otro Valentino u otro Gerónimo (o Gero Mozzi) no cuentan', async () => {
    const p = await chequearSU(conAsignados([{ id: '1', name: 'Gerónimo Martínez', tasks: todo }, { id: '2', name: 'Valentino Pérez', tasks: todo }, { id: '3', name: 'Gero Mozzi', tasks: todo }]))
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.match(p.items.accesos_equipo.detalle, /Gerónimo FicticioA .* y Valentino/)
  })
  test('nombre parcial con permiso de anunciar («Valentino F.», «Valen FicticioB») → sin dato a confirmar, sin aviso al cliente', async () => {
    for (const nombre of ['Valentino F.', 'Valen FicticioB', 'Valentino']) {
      const p = await chequearSU(conAsignados([{ id: '1', name: 'Geronimo FicticioA', tasks: todo }, { id: '2', name: nombre, tasks: ['ADVERTISE'] }]))
      assert.equal(p.items.accesos_equipo.estado, 'sin_dato', nombre)
      assert.equal(p.items.accesos_equipo.detalle, `Aparece «${nombre}» con permiso de anunciar: confirmar que sea Valentino (grabador.b@example.test) (Gerónimo FicticioA sí tiene acceso para anunciar)`)
      assert.equal(p.aviso, null)
    }
  })
  test('parcial de uno y falta el otro → "falta" por el que seguro falta, con la nota del dudoso', async () => {
    const p = await chequearSU(conAsignados([{ id: '2', name: 'Valentino F.', tasks: ['ADVERTISE'] }]))
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.equal(p.items.accesos_equipo.detalle, 'Falta darle acceso a Gerónimo FicticioA (grabador.a@example.test) · aparece «Valentino F.» con permiso de anunciar: confirmar que sea Valentino (grabador.b@example.test)')
    assert.equal(p.aviso, 'Pedirle al cliente: darle acceso a Gerónimo FicticioA (grabador.a@example.test)')
  })
  test('coincidenciaNombre: exacta, parcial y otra persona', () => {
    const [gero, valen] = P.EQUIPO_ACCESOS
    assert.equal(P.coincidenciaNombre('Geronimo FicticioA', gero), 'exacta')
    assert.equal(P.coincidenciaNombre('Gero FicticioA', gero), 'exacta')
    assert.equal(P.coincidenciaNombre('Valentino SecundarioB', valen), 'exacta')
    assert.equal(P.coincidenciaNombre('Valentino FicticioB SecundarioB', valen), 'exacta')
    assert.equal(P.coincidenciaNombre('Valentino F.', valen), 'parcial')
    assert.equal(P.coincidenciaNombre('Valen FicticioB', valen), 'parcial')
    assert.equal(P.coincidenciaNombre('FicticioA', gero), 'parcial')
    assert.equal(P.coincidenciaNombre('Valentino Pérez', valen), 'no')
    assert.equal(P.coincidenciaNombre('Gero Mozzi', gero), 'no')
    assert.equal(P.coincidenciaNombre('Gerónimo Martínez', gero), 'no')
    assert.equal(P.coincidenciaNombre('', gero), 'no')
  })
  test('los mails del equipo son los de tipos.ts (MAILS_ACCESOS_EQUIPO), en el mismo orden', () => {
    assert.deepEqual(P.EQUIPO_ACCESOS.map(m => m.mail), [...MAILS_ACCESOS_EQUIPO])
  })
  test('una sola lista del equipo: EQUIPO_ACCESOS_BASE (tipos.ts) da los mails, los nombres y el nombre del ítem', () => {
    assert.deepEqual(P.EQUIPO_ACCESOS.map(m => [m.quien, m.mail]), EQUIPO_ACCESOS_BASE.map(m => [m.quien, m.mail]))
    assert.deepEqual([...MAILS_ACCESOS_EQUIPO], ['grabador.a@example.test', 'grabador.b@example.test'])
    assert.equal(NOMBRE_ITEM_PORTFOLIO.accesos_equipo, 'Accesos del equipo (Gero A y Valentino)')
    assert.equal(P.EQUIPO_ACCESOS[0].token, 'META_CLIENTES_TOKEN', 'el token de Gerónimo FicticioA sigue siendo el suyo')
  })
  test('acceso solo para ver (ANALYZE) → "falta" sin permiso para anunciar', async () => {
    const p = await chequear(conAsignados([{ id: '1', name: 'Geronimo FicticioA', tasks: todo }, { id: '2', name: 'Valentino SecundarioB', tasks: ['ANALYZE'] }]))
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.match(p.items.accesos_equipo.detalle, /Valentino \(tiene acceso pero sin permiso para anunciar\)/)
  })
  test('agencia que no se pudo leer → sin dato (no una falsa "falta")', async () => {
    const fx = clonar(CRUDO.estefi); delete fx.viaAgencia
    const p = await P.chequearPortfolio('act_2100000000000028', deps(graph({ [TOKEN_B]: fx })))
    assert.equal(p.llamadas, 2)
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.items.accesos_equipo.detalle, /no se pudo leer el acceso por .*la agencia «Agencia Tres Asociados»/)
    assert.equal(p.aviso, null)
  })
  test('token NO miembro del portfolio dueño (asignados [] sin error, como Estefi): agencia sin el equipo → sin dato', async () => {
    const fx = clonar(CRUDO.estefi); fx.viaAgencia = { 2000000000000009: [{ id: '9', name: 'Persona Agencia 1', tasks: todo }] }
    const p = await chequearSU(fx)
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.items.accesos_equipo.detalle, /^No se ve a Gerónimo FicticioA .* y Valentino .*, pero no se pudo leer el acceso por el portfolio dueño \(el token no es miembro: Meta devuelve la lista vacía\)$/)
    assert.equal(p.aviso, null)
  })
  test('token no miembro, la agencia muestra solo a Gero → Valentino sin dato (puede estar asignado en el dueño, que no se ve)', async () => {
    const fx = clonar(CRUDO.estefi); fx.viaAgencia = { 2000000000000009: [{ id: '9', name: 'Geronimo FicticioA', tasks: todo }] }
    const p = await chequearSU(fx)
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.items.accesos_equipo.detalle, /^No se ve a Valentino .*\(Gerónimo FicticioA sí tiene acceso para anunciar\)$/)
  })
  test('token miembro: agencia leída sin el equipo → "falta" (todo se pudo leer)', async () => {
    const fx = estefiMiembro(); fx.viaAgencia = { 2000000000000009: [{ id: '9', name: 'Persona Agencia 1', tasks: todo }] }
    const p = await chequearSU(fx)
    assert.equal(p.llamadas, 2)
    assert.equal(p.items.accesos_equipo.estado, 'falta')
    assert.match(p.items.accesos_equipo.detalle, /^Falta darle acceso a Gerónimo FicticioA .* y Valentino/)
  })
  test('token miembro, agencia que no muestra a nadie → sin dato', async () => {
    const fx = estefiMiembro(); fx.viaAgencia = { 2000000000000009: [] }
    const p = await chequearSU(fx)
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato')
    assert.match(p.items.accesos_equipo.detalle, /la agencia «Agencia Tres Asociados» \(no muestra a nadie/)
  })
  test('/agencies con error o sin respuesta (null del lote) → sin dato, nunca "falta" (aunque el token sea miembro)', async () => {
    for (const agencias of [{ error: { code: 80004, message: 'There have been too many calls' } }, 'NULO']) {
      const fx = estefiMiembro(); fx.agencias = agencias
      const p = await chequearSU(fx)
      assert.equal(p.llamadas, 1, 'sin agencias legibles no hay 2.ª llamada')
      assert.equal(p.items.accesos_equipo.estado, 'sin_dato', JSON.stringify(agencias))
      assert.match(p.items.accesos_equipo.detalle, /las agencias de la cuenta \(\/agencies, #(80004|2)\)/)
      assert.equal(p.aviso, null)
    }
    const fx = conAsignados([{ id: '1', name: 'Geronimo FicticioA', tasks: todo }]); fx.agencias = { error: { code: 10, message: 'no' } }
    const p = await chequear(fx)
    assert.equal(p.items.accesos_equipo.estado, 'sin_dato', 'Laura (miembro) con /agencies en #10 y sin Valentino')
  })
  test('si el equipo ya está en el portfolio dueño no se hace la 2.ª llamada aunque haya agencias', async () => {
    const fx = laura(); fx.agencias = clonar(CRUDO.estefi.agencias)
    const g = graph({ [TOKEN_B]: fx })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g))
    assert.equal(p.llamadas, 1)
    assert.equal(p.items.accesos_equipo.estado, 'ok')
  })
  test('agencias pendientes (no CONFIRMED) no cuentan', () => {
    const r = [{ ok: true, body: CRUDO.laura.cta }, { ok: true, body: { data: [{ id: '5', name: 'X', access_status: 'PENDING' }] } }, { ok: true, body: { data: [] } }]
    assert.deepEqual(P.agenciasParaLeer(r), [])
  })
})

// ── Fusión con la llamada ──
describe('combinarPortfolio(meta, llamada)', () => {
  const metaDe = async fx => P.chequearPortfolio('act_2100000000000026', deps(graph({ [TOKEN_B]: fx })))
  const ev = { cita: 'ya tengo la tarjeta cargada', timestamp: '00:10:00', textual: true }
  test('manda Meta; si la llamada dijo otra cosa queda anotado', async () => {
    const c = P.combinarPortfolio(await metaDe(laura()), { tarjeta: { estado: 'falta', detalle: 'cargar tarjeta en dólares', ...ev } })
    assert.equal(c.tarjeta.estado, 'ok')
    assert.equal(c.tarjeta.fuente, 'meta')
    assert.equal(c.tarjeta.discrepancia, 'en la llamada se dijo «falta» (cargar tarjeta en dólares)')
    assert.match(c.tarjeta.detalle, /sin deuda · ojo: en la llamada se dijo «falta»/)
    assert.deepEqual(c.tarjeta.llamada, { estado: 'falta', detalle: 'cargar tarjeta en dólares', ...ev })
  })
  test('Meta sin dato → queda lo de la llamada (instagram, whatsapp y también los "fuertes")', async () => {
    const meta = await metaDe(laura())
    const c = P.combinarPortfolio(meta, {
      instagram: { estado: 'ok', detalle: 'tiene @estudio', ...ev },
      whatsapp_business: { estado: 'falta', detalle: 'pasar el número a WhatsApp Business', ...ev },
    })
    assert.equal(c.instagram.estado, 'ok'); assert.equal(c.instagram.fuente, 'llamada'); assert.equal(c.instagram.detalle, 'tiene @estudio')
    assert.equal(c.whatsapp_business.estado, 'falta'); assert.equal(c.whatsapp_business.fuente, 'llamada')
    assert.equal(c.instagram.meta.estado, 'sin_dato')
    const ajena = P.portfolioSinLectura('act_1', 'limite', { code: 613, message: 'x' })
    const c2 = P.combinarPortfolio(ajena, { tarjeta: { estado: 'ok', detalle: 'ya la cargó', ...ev } })
    assert.equal(c2.tarjeta.estado, 'ok'); assert.equal(c2.tarjeta.fuente, 'llamada')
  })
  test('ni Meta ni la llamada → sin dato, fuente "ninguna"', async () => {
    const c = P.combinarPortfolio(await metaDe(laura()), { instagram: { estado: 'no_se_hablo', detalle: '', cita: '', timestamp: null, textual: false } })
    assert.equal(c.instagram.estado, 'sin_dato')
    assert.equal(c.instagram.fuente, 'ninguna')
    assert.match(c.instagram.detalle, /en la llamada no se habló$/)
    assert.equal(c.instagram.llamada, null)
  })
  test('cuenta ilegible con el token de Gero: el "falta" de accesos de Meta le gana a un "ok" de la llamada', () => {
    const meta = P.portfolioSinLectura(AJENA, 'sin_acceso', ERROR_200, { token: 'META_CLIENTES_TOKEN' })
    const c = P.combinarPortfolio(meta, { accesos_equipo: { estado: 'ok', detalle: 'dice que ya dio acceso', ...ev } })
    assert.equal(c.accesos_equipo.estado, 'falta')
    assert.equal(c.accesos_equipo.fuente, 'meta')
    assert.match(c.accesos_equipo.discrepancia, /«ok»/)
  })
  test('token vencido: no pisa el "ok" de accesos de la llamada', () => {
    const meta = P.portfolioSinLectura(AJENA, 'token_invalido', { code: 190, message: 'expired' }, { tokensInvalidos: ['META_CLIENTES_TOKEN'] })
    const c = P.combinarPortfolio(meta, { accesos_equipo: { estado: 'ok', detalle: 'dice que ya dio acceso', ...ev } })
    assert.equal(c.accesos_equipo.estado, 'ok')
    assert.equal(c.accesos_equipo.fuente, 'llamada')
  })
  test('"ok" débil (WhatsApp e IG deducidos de los anuncios) no le gana a un "falta"/"problema" de la llamada', async () => {
    const meta = await P.chequearPortfolio('act_2100000000000020', deps(graph({ [TOKEN_B]: CRUDO.morales })))
    assert.equal(meta.items.whatsapp_business.debil, true)
    assert.equal(meta.items.instagram.debil, true, 'el IG de Morales sale solo de las creatividades')
    const c = P.combinarPortfolio(meta, {
      whatsapp_business: { estado: 'falta', detalle: 'pasar el número a WhatsApp Business', ...ev },
      instagram: { estado: 'problema', detalle: 'el IG no está vinculado', ...ev },
    })
    assert.equal(c.whatsapp_business.estado, 'falta')
    assert.equal(c.whatsapp_business.fuente, 'llamada')
    assert.match(c.whatsapp_business.detalle, /^pasar el número a WhatsApp Business · ojo: Meta dice «ok» \(Deducido de los anuncios: 4 conjuntos con destino WhatsApp \(1 activo\)\), pero lo deduce de los anuncios: revisar$/)
    assert.match(c.whatsapp_business.discrepancia, /lo deduce de los anuncios/)
    assert.equal(c.instagram.estado, 'problema')
    // Con la llamada en "ok" o sin hablarse, el "ok" débil de Meta queda
    const c2 = P.combinarPortfolio(meta, { whatsapp_business: { estado: 'ok', detalle: 'tiene WhatsApp Business', ...ev } })
    assert.equal(c2.whatsapp_business.fuente, 'meta')
    assert.equal(P.combinarPortfolio(meta, {}).instagram.estado, 'ok')
  })
  test('IG listado por la cuenta (con @usuario, como Estefi) es seguro: Meta le gana a la llamada', async () => {
    const meta = await P.chequearPortfolio('act_2100000000000028', deps(graph({ [TOKEN_B]: CRUDO.estefi })))
    assert.equal(meta.items.instagram.debil, undefined)
    const c = P.combinarPortfolio(meta, { instagram: { estado: 'falta', detalle: 'no tiene IG', ...ev } })
    assert.equal(c.instagram.estado, 'ok')
    assert.equal(c.instagram.fuente, 'meta')
  })
  test('sin Meta (null) → todo de la llamada; estado desconocido se ignora; siempre los 7 ítems', () => {
    const c = P.combinarPortfolio(null, { tarjeta: { estado: 'problema', detalle: 'tarjeta rechazada' }, instagram: { estado: 'quizas', detalle: '?' } })
    assert.deepEqual(Object.keys(c).sort(), [...ITEMS_PORTFOLIO].sort())
    assert.equal(c.tarjeta.estado, 'problema'); assert.equal(c.tarjeta.fuente, 'llamada')
    assert.equal(c.instagram.estado, 'sin_dato'); assert.equal(c.instagram.fuente, 'ninguna')
    assert.match(c.verificacion.detalle, /^Meta no se consultó/)
    assert.equal(P.combinarPortfolio(null, null).tarjeta.fuente, 'ninguna')
  })
  test('"sin_verificar" de la llamada (se mencionó, no se comprobó): no le discute a Meta; sin Meta, sin dato con la mención', async () => {
    const meta = await metaDe(laura())
    const sv = { estado: 'sin_verificar', detalle: 'Tomás le pidió tenerla cargada', ...ev }
    const c = P.combinarPortfolio(meta, { tarjeta: sv, whatsapp_business: { ...sv, detalle: 'los mensajes llegan a WhatsApp' } })
    assert.equal(c.tarjeta.estado, 'ok'); assert.equal(c.tarjeta.fuente, 'meta')
    assert.equal(c.tarjeta.discrepancia, null, 'una mención no es una opinión')
    assert.equal(c.tarjeta.llamada.estado, 'sin_verificar', 'pero queda anotada')
    assert.equal(c.whatsapp_business.estado, 'sin_dato'); assert.equal(c.whatsapp_business.fuente, 'ninguna')
    assert.match(c.whatsapp_business.detalle, /· en la llamada se mencionó sin verificar \(los mensajes llegan a WhatsApp\)$/)
    // Un "ok" débil de Meta no lo pisa una mención (solo un falta/problema)
    const morales = await P.chequearPortfolio('act_2100000000000020', deps(graph({ [TOKEN_B]: CRUDO.morales })))
    const c2 = P.combinarPortfolio(morales, { whatsapp_business: sv })
    assert.equal(c2.whatsapp_business.fuente, 'meta')
    assert.equal(c2.whatsapp_business.discrepancia, null)
    // Sin Meta: la mención queda como sin dato, fuente ninguna
    assert.equal(P.combinarPortfolio(null, { tarjeta: sv }).tarjeta.fuente, 'ninguna')
  })
  test('moneda y zona horaria de la cuenta (currency, timezone_name): en el mismo GET, a la cabecera de la ficha; lo raro → null', async () => {
    assert.match(P.CAMPOS_CUENTA, /,currency,timezone_name$/)
    const conMoneda = laura({ currency: 'USD', timezone_name: 'America/Argentina/San_Juan' })
    const g = graph({ [TOKEN_B]: conMoneda })
    const p = await P.chequearPortfolio('act_2100000000000026', deps(g))
    assert.deepEqual([p.datos.moneda, p.datos.zona_horaria], ['USD', 'America/Argentina/San_Juan'])
    const f = P.paraFicha(p)
    assert.deepEqual([f.moneda, f.zona_horaria], ['USD', 'America/Argentina/San_Juan'])
    const raro = await P.chequearPortfolio('act_2100000000000026', deps(graph({ [TOKEN_B]: laura({ currency: 'dólares<script>', timezone_name: '../../etc' }) })))
    assert.deepEqual([raro.datos.moneda, raro.datos.zona_horaria], [null, null])
    assert.deepEqual([P.paraFicha(raro).moneda, P.paraFicha(P.portfolioSinLectura(null, 'sin_cuenta')).moneda], [null, null])
  })
  test('paraFicha: la cabecera y los 7 ítems, sin lo crudo de Graph (datos, negocio, token) y con el origen de la cuenta', async () => {
    const p = await P.portfolioDelCliente({ cliente_crm: 'Ana', cuentas: [] }, {
      ...deps(graph({ [TOKEN_B]: CRUDO.laura })),
      fuentes: async () => ({ descubiertas: [{ id: 'act_2100000000000026', nombre: 'USD Estudio', estado: 1, negocio: null }], resolver: () => ({ cliente: { nombre: 'Ana' }, nombreColC: '' }), excluidas: [], esPropia: () => false, avisos: [] }),
    })
    const f = P.paraFicha(p)
    assert.deepEqual(Object.keys(f).sort(), ['aviso', 'cuenta', 'generado', 'items', 'leido', 'moneda', 'motivo', 'nombre', 'origen_cuenta', 'zona_horaria'])
    assert.equal(f.cuenta, 'act_2100000000000026')
    assert.equal(f.origen_cuenta, 'descubrimiento')
    assert.equal(f.leido, true)
    assert.deepEqual(Object.keys(f.items).sort(), [...ITEMS_PORTFOLIO].sort())
    assert.deepEqual(Object.keys(f.items.tarjeta).sort(), ['detalle', 'estado'], 'sin campo ni fuente')
    assert.ok(!/1000000000000002|EAA|META_CLIENTES_TOKEN/.test(JSON.stringify(f)), 'ni el id del medio de pago ni tokens')
    const sin = P.paraFicha(P.portfolioSinLectura(null, 'sin_cuenta', 'No apareció ninguna cuenta'))
    assert.equal(sin.cuenta, null); assert.equal(sin.origen_cuenta, null); assert.equal(sin.leido, false); assert.equal(sin.motivo, 'sin_cuenta')
    // La fusión acepta la lectura de la ficha igual que la salida de chequearPortfolio
    assert.deepEqual(P.combinarPortfolio(f, {}), P.combinarPortfolio(p, {}))
  })
  test('misma opinión: sin discrepancia', async () => {
    const c = P.combinarPortfolio(await metaDe(laura()), { tarjeta: { estado: 'ok', detalle: 'tiene tarjeta', ...ev } })
    assert.equal(c.tarjeta.discrepancia, null)
    assert.equal(c.tarjeta.detalle, 'Hay medio de pago: sí (tarjeta de crédito/débito); sin deuda')
  })
})

// ── Encontrar la cuenta del cliente ──
describe('buscarCuentaCliente', () => {
  const nunca = { fuentes: async () => { throw new Error('no debería buscar') } }
  const desc = (id, nombre, estado = 1, negocio = null) => ({ id, nombre, estado, negocio: negocio ? { id: 'b' + id, nombre: negocio } : null })
  // Cruce real de lib/anuncios/cruce.ts con un CRM inventado
  const cruce = crearCruce({
    clientes: [{ nombre: 'Ana Lucía Pérez Galván', estado: 'ACTIVO' }, { nombre: 'Bruno Díaz Ocampo', estado: 'ACTIVO' }, { nombre: 'Carla Pérez Ruiz', estado: 'FINALIZADO' }],
    cuentasMeta: [], alias: [], guiones: [], errores: [],
  })
  const fuentes = (descubiertas, extra = {}) => ({
    fuentes: async () => ({ descubiertas, resolver: c => cruce.resolverCliente(c), excluidas: ['act_500500'], esPropia: id => id === 'act_900900', avisos: [], ...extra }),
  })
  test('1) las cuentas del contexto (ids, con o sin act_) sin buscar nada', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana Lucía Pérez Galván', cuentas: ['2100000000000026', 'act_2100000000000026'] }, nunca)
    assert.equal(b.origen, 'crm')
    assert.deepEqual(b.cuentas.map(c => c.id), ['act_2100000000000026'])
  })
  test('1) varias cuentas en el CRM: se cruzan con lo descubierto y va primero la activa, con aviso', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana Lucía Pérez Galván', cuentas: ['act_111111', 'act_222222'] },
      fuentes([desc('act_111111', 'ARS Pérez Galván (vieja)', 101), desc('act_222222', 'USD Pérez Galván', 1)]))
    assert.equal(b.origen, 'crm')
    assert.deepEqual(b.cuentas.map(c => c.id), ['act_222222', 'act_111111'])
    assert.deepEqual(b.cuentas.map(c => c.estado), [1, 101])
    assert.equal(b.aviso, 'el cliente tiene 2 cuentas en el CRM: se revisa «USD Pérez Galván»')
  })
  test('1) varias cuentas en el CRM y el descubrimiento falla: orden del CRM, con aviso', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana', cuentas: ['act_111111', '222222'] }, { fuentes: async () => { throw new Error('Meta 500') } })
    assert.deepEqual(b.cuentas.map(c => c.id), ['act_111111', 'act_222222'])
    assert.equal(b.aviso, 'el cliente tiene 2 cuentas en el CRM: se revisa «act_111111» (sin saber cuál está activa)')
    assert.deepEqual(b.avisos, ['Meta 500'])
  })
  test('1b) "Cuentas Meta" con el NOMBRE de la cuenta → se resuelve contra lo descubierto', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana Lucía Pérez Galván', cuentas: ['USD Estudio Pérez Galván'] }, fuentes([desc('act_111111', 'USD ESTUDIO PEREZ GALVAN'), desc('act_222222', 'Otra')]))
    assert.equal(b.origen, 'crm')
    assert.deepEqual(b.cuentas.map(c => c.id), ['act_111111'])
  })
  test('2) descubrimiento + cruce del tablero, filtrado por el cliente del CRM (como Laura)', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'ana lucia perez galvan', cuentas: [] }, fuentes([
      desc('act_2100000000000026', 'USD ESTUDIO JURIDICO PEREZ GALVAN', 1, 'Estudio Pérez Galván'),
      desc('act_333333', 'USD Bruno Díaz Ocampo'),
      desc('act_500500', 'Pérez Galván vieja'),          // excluida
      desc('act_900900', 'Pérez Galván propia'),         // la cuenta propia de la agencia
      desc('act_444444', 'Estudio Carla Pérez Ruiz'),     // otra Pérez (ex-cliente): no es ella
    ]))
    assert.equal(b.origen, 'descubrimiento')
    assert.deepEqual(b.cuentas.map(c => c.id), ['act_2100000000000026'])
    assert.equal(b.cuentas[0].negocio, 'Estudio Pérez Galván')
    assert.equal(b.aviso, null)
  })
  test('2) varias cuentas: activas primero, cerradas al final, con aviso', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana Lucía Pérez Galván' }, fuentes([
      desc('act_100001', 'ARS Pérez Galván', 101), desc('act_100002', 'USD Pérez Galván', 1), desc('act_100003', 'USD2 Pérez Galván', 2),
    ]))
    assert.deepEqual(b.cuentas.map(c => c.id), ['act_100002', 'act_100003', 'act_100001'])
    assert.match(b.aviso, /tiene 3 cuentas en Meta: se revisa «USD Pérez Galván»/)
  })
  test('3) no aparece → aviso de cargarla en Cuentas Meta', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana Lucía Pérez Galván', cuentas: [] }, fuentes([desc('act_333333', 'USD Bruno Díaz Ocampo')], { avisos: ['sin descubrimiento de cuentas de Meta'] }))
    assert.deepEqual(b.cuentas, [])
    assert.match(b.aviso, /No apareció ninguna cuenta publicitaria de Ana Lucía Pérez Galván en Meta \(sin descubrimiento de cuentas de Meta\): cargar la cuenta publicitaria en Cuentas Meta$/)
  })
  test('cliente sin verificar en el CRM y sin cuentas → no adivina', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: null, cuentas: [] }, nunca)
    assert.deepEqual(b.cuentas, [])
    assert.match(b.aviso, /no está verificado en el CRM.*cargar la cuenta publicitaria en Cuentas Meta/)
  })
  test('fuentes que fallan o tardan → aviso, nunca lanza', async () => {
    const b = await P.buscarCuentaCliente({ cliente_crm: 'Ana' }, { fuentes: async () => { throw new Error('Sheets 503') } })
    assert.match(b.aviso, /No se pudo buscar la cuenta \(Sheets 503\)/)
    const lento = await P.buscarCuentaCliente({ cliente_crm: 'Ana' }, { fuentes: () => new Promise(() => {}), topeMs: 30 })
    assert.match(lento.aviso, /tardó más de/)
  })
})

describe('portfolioDelCliente', () => {
  test('sin cuenta → todo sin dato, por qué y qué hacer', async () => {
    const p = await P.portfolioDelCliente({ cliente_crm: 'Ana Lucía Pérez Galván', cuentas: [] }, {
      fuentes: async () => ({ descubiertas: [], resolver: () => ({ cliente: null, nombreColC: '' }), excluidas: [], esPropia: () => false, avisos: [] }),
      fetch: graph({}), tokens: UNO,
    })
    assert.equal(p.motivo, 'sin_cuenta')
    assert.equal(p.cuenta, null)
    assert.ok(ITEMS_PORTFOLIO.every(k => p.items[k].estado === 'sin_dato'))
    assert.equal(p.items.tarjeta.detalle, 'No apareció ninguna cuenta publicitaria de Ana Lucía Pérez Galván en Meta')
    assert.equal(p.aviso, 'Cargar la cuenta publicitaria en Cuentas Meta (CRM) y volver a chequear')
    assert.equal(p.llamadas, 0)
  })
  test('con la cuenta en el contexto → la chequea', async () => {
    const p = await P.portfolioDelCliente({ cliente_crm: 'Ana', cuentas: ['act_2100000000000026'] }, deps(graph({ [TOKEN_B]: CRUDO.laura })))
    assert.equal(p.leido, true)
    assert.equal(p.busqueda.origen, 'crm')
    assert.equal(p.items.portfolio_comercial.estado, 'ok')
  })
  test('varias cuentas en el CRM (la vieja cerrada primero) → chequea la activa y lo avisa', async () => {
    const g = graph({ [TOKEN_B]: CRUDO.laura })
    const p = await P.portfolioDelCliente({ cliente_crm: 'Ana', cuentas: ['act_2000000000000006', 'act_2100000000000026'] }, {
      ...deps(g),
      fuentes: async () => ({
        descubiertas: [{ id: 'act_2000000000000006', nombre: 'ARS vieja', estado: 101, negocio: null }, { id: 'act_2100000000000026', nombre: 'USD nueva', estado: 1, negocio: null }],
        resolver: () => ({ cliente: null, nombreColC: '' }), excluidas: [], esPropia: () => false, avisos: [],
      }),
    })
    assert.equal(p.cuenta, 'act_2100000000000026')
    assert.equal(g.registro[0].pedidos[0].relative_url.split('?')[0], 'act_2100000000000026')
    assert.equal(p.items.verificacion.estado, 'ok')
    assert.equal(p.aviso, 'el cliente tiene 2 cuentas en el CRM: se revisa «USD nueva»')
  })
})

describe('lectura del lote', () => {
  test('null en un subpedido = timeout del lote (transitorio); error general del lote', () => {
    const r = P.leerLote([null, { code: 200, body: '{"data":[]}' }, { code: 400, body: '{"error":{"code":10,"error_subcode":5,"message":"no"}}' }], 3)
    assert.equal(r.ok, true)
    assert.equal(r.resp[0].error.code, 2)
    assert.equal(r.resp[1].ok, true)
    assert.deepEqual(r.resp[2].error, { code: 10, subcode: 5, message: 'no' })
    const e = P.leerLote({ error: { code: 190, message: 'mal' } }, 3)
    assert.equal(e.ok, false)
    assert.equal(e.error.code, 190)
  })
})
