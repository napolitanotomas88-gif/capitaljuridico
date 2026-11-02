// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-bajas-prueba.mjs
// Etapa BAJA — MODO PRUEBA (BOT_CLIENTES_PRUEBA, lib/bot/bajas/prueba.ts) y su limpieza (lib/bot/bajas/limpieza.ts,
// scripts/limpiar-cliente-prueba-bajas.mjs). SIN red ni base: fetch falso (Whapi y Discord), almacén en memoria y CRM falso.
// Todo lo de acá es inventado (teléfonos, ids, nombres).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of Object.keys(process.env)) {
  if (/^(WHAPI_|BOT_ALTA_|BOT_BAJAS|BOT_CLIENTES|BAJA_|DISCORD_|FATHOM_)/.test(k) || ['CRON_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'SHEET_ID_CLIENTES', 'SHEET_ID_TYPEFORM', 'META_ANUNCIOS_TOKEN', 'PUENTE_DRIVE_URL'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const CP = await import('../lib/bot/bajas/prueba.ts')
const CFG = await import('../lib/bot/bajas/config.ts')
const A = await import('../lib/bot/bajas/almacen.ts')
const N = await import('../lib/bot/bajas/nucleo.ts')
const S = await import('../lib/bot/bajas/servidor.ts')
const F = await import('../lib/bot/bajas/filtro.ts')
const L = await import('../lib/bot/bajas/lectura.ts')
const LI = await import('../lib/bot/bajas/limpieza.ts')
const CRM = await import('../lib/bot/bajas/crm.ts')
const SCRIPT = await import('./limpiar-cliente-prueba-bajas.mjs')
const { conArchivadosActuales } = await import('../lib/clientes/archivados.ts')
const SAL = await import('../lib/bot/whapi/salud.ts')
SAL.fijarGuardiaParaPruebas(SAL.GUARDIA_ABIERTA)

const VERIF = '120363000000000002@g.us', VENTAS_CJ = '120363000000000001@g.us'
const GRUPOS = { ventas: VENTAS_CJ, verificaciones: VERIF }
const G_PRUEBA = { general: '120363000000000201@g.us', ventas: '120363000000000202@g.us', contenido: '120363000000000203@g.us' }
const G_REAL = { general: '120363000000000101@g.us', ventas: '120363000000000102@g.us', contenido: '120363000000000103@g.us' }
const TOMI = '5491100000001', AYLU = '5491100000003', BOT = '5491100000000', FICTICIO = '5491155550077'
const AHORA = Date.parse('2026-11-01T13:30:00Z')
const TS = Math.floor(AHORA / 1000) - 30
const SILENCIO = { info() {}, warn() {}, error() {} }
const WEBHOOK = 'https://discord.test/api/webhooks/1/abc'

const cliente = (over = {}) => ({ id: 'A100', nombre: 'Ana Pérez', estado: 'ACTIVO', linea: 'agencia', mail: 'ana@estudio.test', celular: '5491155550099', dia1: '2026-07-14', finPeriodo: '2026-11-11', periodos: [], fechaBaja: null, satisfaccion: 7, esNoCliente: false, ...over })
const PRUEBA = cliente({ id: 'Z001', nombre: 'PRUEBA BOT Uno', mail: 'ficticio@prueba.test', celular: FICTICIO })
const CLIENTES = [
  cliente(),                                                      // real, termina en 10 días: el modo prueba NUNCA lo toca
  PRUEBA,                                                         // de prueba, termina en 10 días
  cliente({ id: 'Z002', nombre: 'Juan Real', mail: 'j@x.test' }), // en la lista por error, pero NO es fila "PRUEBA BOT…"
]
const ARCHIVO = { leer: async () => [['ID', 'Nombre', 'Estado', 'Anotaciones'], ...CLIENTES.map((c) => [c.id, c.nombre, c.estado, ''])] }

let nMsg = 0
const msg = (over = {}) => ({ id: `in-${++nMsg}-AbCd`, from_me: false, type: 'text', chat_id: VERIF, timestamp: TS, source: 'mobile', text: { body: 'OK' }, from: TOMI, from_name: 'Tomi', ...over })
const envio = (messages) => ({ messages, event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-PRUEBA1' })
const responde = (citado, from, body) => F.candidatosBajas(envio([msg({ from, text: { body }, context: { quoted_id: citado } })]), GRUPOS, AHORA)

/** fetch falso: Whapi (grupos, participantes, envío, DELETE) y Discord. Anota todo. */
function redFalsa() {
  const llamadas = []
  let n = 0
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  const f = async (url, init = {}) => {
    const u = String(url), metodo = init.method ?? 'GET'
    const cuerpo = init.body ? JSON.parse(init.body) : null
    llamadas.push({ metodo, url: u, cuerpo })
    if (u.startsWith('https://discord.test')) return json({ id: `9990001112223${++n}` })
    if (u.includes('/health')) return json({ status: { code: 4, text: 'AUTH' } })
    if (u.includes('/groups?')) return json({ groups: [
      ...Object.entries(G_PRUEBA).map(([g, id]) => ({ id, name: `${g[0].toUpperCase()}${g.slice(1)} - PRUEBA BOT Uno` })),
      ...Object.entries(G_REAL).map(([g, id]) => ({ id, name: `${g[0].toUpperCase()}${g.slice(1)} - Ana Pérez` })),
    ] })
    if (u.includes('/messages/text')) return json({ sent: true, message: { id: `wa-${++n}-XyZw` } })
    if (/\/groups\/[^/?]+$/.test(u) && metodo === 'GET') return json({ id: decodeURIComponent(u.split('/').pop()), participants: [{ id: BOT, rank: 'creator' }, { id: TOMI, rank: 'admin' }, { id: FICTICIO, rank: 'member' }] })
    return json({ success: true })
  }
  return { f, llamadas, enviosA: (chat) => llamadas.filter((x) => x.url.includes('/messages/text') && x.cuerpo?.to === chat) }
}

const ENV_BASE = { BOT_ALTA_APROBADORES: TOMI, BAJA_APROBADORES_DESPEDIDA: AYLU, WHAPI_GRUPO_VERIFICACIONES: VERIF, WHAPI_TOKEN: 'token-falso-de-prueba-123', BAJA_CALENDLY_URL: 'https://calendly.com/x/renovacion', DISCORD_WEBHOOK_CLIENTES: WEBHOOK }

describe('lista blanca común BOT_CLIENTES_PRUEBA', () => {
  test('parseo: IDs del CRM en mayúsculas, sin repetidos; lo demás se ignora', () => {
    assert.deepEqual(CP.clientesPrueba({ BOT_CLIENTES_PRUEBA: 'z001, Z001;Z002  basura 12 A1234567' }), ['Z001', 'Z002'])
    assert.deepEqual(CP.clientesPrueba({}), [])
    assert.equal(CP.esClientePrueba('z001', ['Z001']), true)
    assert.equal(CP.esClientePrueba('A100', ['Z001']), false)
  })
  test('doble seguro: en la lista Y fila "PRUEBA BOT…"', () => {
    assert.equal(CP.clienteDePrueba({ id: 'Z001', nombre: '  prueba  bot Uno' }, ['Z001']), true)
    assert.equal(CP.clienteDePrueba({ id: 'Z002', nombre: 'Juan Real' }, ['Z002']), false)
    assert.equal(CP.clienteDePrueba({ id: 'A100', nombre: 'PRUEBA BOT X' }, ['Z001']), false)
  })
})

describe('config del modo prueba', () => {
  test('sin lista o con BOT_BAJAS=no: no hay modo prueba', () => {
    assert.equal(CFG.configPruebaBajas({}), null)
    assert.equal(CFG.configPruebaBajas({ BOT_CLIENTES_PRUEBA: 'Z001', BOT_BAJAS: 'no' }), null)
  })
  test('con lista: real, todas las capacidades menos Meta (nunca en prueba), aunque el general esté en seco', () => {
    const c = CFG.configPruebaBajas({ BOT_CLIENTES_PRUEBA: 'Z001' })
    assert.equal(c.modo, 'real'); assert.equal(c.prueba, true); assert.deepEqual(c.clientesPrueba, ['Z001'])
    assert.equal(c.capacidades.has('baja_pausar_meta'), false)
    assert.equal(c.capacidades.size, CFG.CAPACIDADES_BAJA.length - 1)
    assert.equal(CFG.configBajas({ BOT_CLIENTES_PRUEBA: 'Z001' }).modo, 'seco')
  })
  test('BOT_BAJAS_PRUEBA_CAPACIDADES recorta (y Meta igual queda afuera)', () => {
    const c = CFG.configPruebaBajas({ BOT_CLIENTES_PRUEBA: 'Z001', BOT_BAJAS_PRUEBA_CAPACIDADES: 'baja_aviso_fin,baja_pausar_meta,otra' })
    assert.deepEqual([...c.capacidades], ['baja_aviso_fin'])
  })
  test('faltantes: con la lista, se miran las variables de las capacidades de prueba aunque el general esté en seco', () => {
    const f = CFG.faltantesBajas({ BOT_CLIENTES_PRUEBA: 'Z001' })
    assert.ok(f.includes('WHAPI_TOKEN')); assert.ok(f.includes('DISCORD_WEBHOOK_CLIENTES'))
    assert.ok(!f.includes('META_ANUNCIOS_TOKEN'))
  })
  test('estado (?estado=1) muestra el modo prueba', async () => {
    const e = await L.leerEstadoBajas({ env: { BOT_CLIENTES_PRUEBA: 'Z001' } })
    assert.deepEqual(e.prueba.clientes, ['Z001']); assert.equal(e.modo, 'seco')
    assert.equal((await L.leerEstadoBajas({ env: {} })).prueba, null)
  })
})

describe('servidor: general en SECO + modo prueba', () => {
  const env = { ...ENV_BASE, BOT_CLIENTES_PRUEBA: 'Z001,Z002' }
  test('núcleos: sin lista solo el general; con lista, prueba + general', () => {
    assert.deepEqual(S.nucleosBajas({ env: ENV_BASE, almacen: A.almacenBajasEnMemoria() }).map((x) => x.prueba), [false])
    assert.deepEqual(S.nucleosBajas({ env, almacen: A.almacenBajasEnMemoria() }).map((x) => x.prueba), [true, false])
    assert.deepEqual(S.nucleosBajas({ env: { ...env, BOT_BAJAS: 'no' } }), [])
  })
  test('cron: SOLO el cliente de prueba recibe el pedido del aviso de fin; el real y el "Z002" que no es PRUEBA BOT, nada', async () => {
    const almacen = A.almacenBajasEnMemoria(), red = redFalsa()
    const r = await conArchivadosActuales(() => S.correrDiarioBajasReal({ env, almacen, fetch: red.f, leerClientes: async () => CLIENTES, ahora: () => AHORA, log: SILENCIO }), ARCHIVO)
    assert.equal(r.avisos, 1, JSON.stringify(r))
    assert.deepEqual(almacen._pedidos.map((p) => p.idCrm), ['Z001'])
    assert.equal(almacen._pedidos[0].modo, 'real')
    assert.equal(red.enviosA(VERIF).length, 1)
    assert.match(red.enviosA(VERIF)[0].cuerpo.body, /PRUEBA BOT Uno/)
    assert.ok(!red.llamadas.some((x) => JSON.stringify(x.cuerpo ?? '').includes('Ana')))
    assert.ok(r.registro.some((x) => x.startsWith('[prueba] ')))
    assert.deepEqual(almacen._rastros.map((x) => [x.idCrm, x.tipo]), [['Z001', 'whatsapp']])
  })
  test('OK citado → el aviso de renovación va SOLO al General de prueba (por nombre idéntico) y queda el rastro', async () => {
    const almacen = A.almacenBajasEnMemoria(), red = redFalsa()
    const op = { env, almacen, fetch: red.f, leerClientes: async () => CLIENTES, ahora: () => AHORA, log: SILENCIO }
    await conArchivadosActuales(() => S.correrDiarioBajasReal(op), ARCHIVO)
    const p = almacen._pedidos[0]
    const r = await conArchivadosActuales(() => S.procesarBajasReal(responde(p.mensajePedidoId, TOMI, 'OK'), op), ARCHIVO)
    assert.equal(r.renovaciones, 1, JSON.stringify(r))
    assert.equal(red.enviosA(G_PRUEBA.general).length, 1)
    assert.equal(red.enviosA(G_REAL.general).length, 0)
    assert.ok(almacen._rastros.filter((x) => x.tipo === 'whatsapp').length >= 3)   // pedido, aviso al cliente y "Listo"
  })
  test('baja manual: ?baja=Z001 la abre en real (prueba); ?baja=A100 sigue en seco y no toca nada', async () => {
    const almacen = A.almacenBajasEnMemoria(), red = redFalsa()
    const op = { env, almacen, fetch: red.f, leerClientes: async () => CLIENTES, ahora: () => AHORA, log: SILENCIO }
    const r1 = await conArchivadosActuales(() => S.pedirBajaManualReal('Z001', 'pedido manual', 'prueba', op), ARCHIVO)
    assert.equal(r1.pedidosBaja, 1, JSON.stringify(r1))
    const r2 = await conArchivadosActuales(() => S.pedirBajaManualReal('A100', 'pedido manual', 'x', op), ARCHIVO)
    assert.equal(r2.pedidosBaja, 0); assert.ok(r2.registro[0].startsWith('seco'))
    assert.deepEqual(almacen._pedidos.map((p) => p.idCrm), ['Z001'])
  })
  test('un OK que cita un pedido del general no lo toca el núcleo de prueba (y al revés)', async () => {
    const almacen = A.almacenBajasEnMemoria(), red = redFalsa()
    await almacen.crearPedido({ id: 'aviso:A100:2026-11-11', tipo: 'aviso_fin', clave: 'A100', cliente: 'Ana Pérez', idCrm: 'A100', general: G_REAL.general, fin: '2026-11-11', modo: 'real', mensajePedidoId: 'wa-real-1', huella: 'h', detalle: {}, creado: new Date(AHORA).toISOString() })
    const r = await conArchivadosActuales(() => S.procesarBajasReal(responde('wa-real-1', TOMI, 'OK'), { env, almacen, fetch: red.f, leerClientes: async () => CLIENTES, ahora: () => AHORA, log: SILENCIO }), ARCHIVO)
    assert.equal(r.aprobados, 0); assert.equal(almacen._pedidos[0].estado, 'abierto'); assert.equal(red.llamadas.length, 0)
  })
  test('sin la lista y en seco: no corre nada (igual que antes)', async () => {
    assert.equal(await S.procesarBajasReal(responde('x', TOMI, 'OK'), { env: { ...ENV_BASE, DATABASE_URL: 'postgres://x.invalid/db' }, log: SILENCIO }), null)
  })
})

describe('servidor: general en REAL + modo prueba (no se pisan)', () => {
  test('el general pide el aviso del real y el de prueba el del ficticio; ninguno dos veces', async () => {
    const env = { ...ENV_BASE, BOT_CLIENTES_PRUEBA: 'Z001', BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: 'baja_aviso_fin' }
    const almacen = A.almacenBajasEnMemoria(), red = redFalsa()
    const r = await conArchivadosActuales(() => S.correrDiarioBajasReal({ env, almacen, fetch: red.f, leerClientes: async () => CLIENTES.slice(0, 2), ahora: () => AHORA, log: SILENCIO }), ARCHIVO)
    assert.equal(r.avisos, 2)
    assert.deepEqual(almacen._pedidos.map((p) => p.idCrm).sort(), ['A100', 'Z001'])
    assert.deepEqual(almacen._rastros.map((x) => x.idCrm), ['Z001'])   // el real no deja rastros de prueba
  })
})

describe('núcleo en modo prueba: la baja completa deja rastros de todo', () => {
  function armarPrueba(op = {}) {
    const config = CFG.configPruebaBajas({ ...ENV_BASE, BOT_CLIENTES_PRUEBA: 'Z001' })
    const almacen = A.almacenBajasEnMemoria(), enviados = [], discord = [], meta = []
    let n = 0
    const deps = {
      config, almacen, alcance: (id) => id === 'Z001',
      grupos: { deCliente: async () => ({ cliente: 'PRUEBA BOT Uno', idCrm: 'Z001', grupos: G_PRUEBA, origen: 'motor', comunidad: '120363000000000200@g.us', carpeta: 'carpeta-prueba-000000000000000001', correos: ['ficticio@prueba.test'] }) },
      enviarTexto: async (p) => { enviados.push(p); return { id: `wa-${++n}` } },
      participantes: async () => [{ id: BOT, rango: 'creador' }, { id: TOMI, rango: 'admin' }, { id: FICTICIO, rango: 'miembro' }],
      quitar: async (_c, ids) => ({ quitados: ids, fallidos: [] }),
      discord: async (t) => { discord.push(t); return `d-${discord.length}` },
      crm: async (p, modo) => ({ estado: modo === 'real' ? 'hecho' : 'simulado', fila: 50, detalle: 'fila 50', escrituras: [{ range: "'Agencia'!C50", values: [['FINALIZADO']] }], anterior: { estado: 'ACTIVO', fechaBaja: null, notas: '', celdas: { estado: "'Agencia'!C50", fechaBaja: "'Agencia'!V50", notas: "'Agencia'!R50" } } }),
      meta: { campanasActivas: async () => { meta.push('leer'); return { campanas: [{ id: '1', nombre: 'x' }], errores: [], tokenCaido: false } }, pausar: async () => { meta.push('pausar'); return { pausadas: [], fallidas: [], tokenCaido: false } } },
      quitarAccesoDrive: async () => ({ quitados: ['ficticio@prueba.test'], noTenian: [], protegidos: [], enlacePublico: false }),
      eliminarComunidad: async () => {},
      leerClientes: async () => [PRUEBA],
      mencionAylu: null, equipo: new Set([TOMI, AYLU]), ahora: () => AHORA, esperar: async () => {}, log: SILENCIO,
      ...op,
    }
    return { N: N.crearNucleoBajas(deps), almacen, enviados, discord, meta }
  }
  test('confirmación → CRM (con lo anterior), Skool, Drive, despedida, grupos y comunidad: todo con rastro; Meta nunca', async () => {
    const x = armarPrueba()
    await x.N.pedirBajaManual('Z001', 'pedido manual', 'prueba')
    const pb = x.almacen._pedidos.find((p) => p.tipo === 'confirmar_baja')
    await x.N.procesarEventos(responde(pb.mensajePedidoId, TOMI, 'OK FINALIZADO'))
    const pd = x.almacen._pedidos.find((p) => p.tipo === 'despedida')
    assert.ok(pd, 'pidió la despedida')
    await x.N.procesarEventos(responde(pd.mensajePedidoId, AYLU, 'OK'))
    const tipos = new Set(x.almacen._rastros.map((r) => r.tipo))
    for (const t of ['whatsapp', 'crm', 'discord', 'drive', 'grupos', 'comunidad']) assert.ok(tipos.has(t), t)
    assert.deepEqual(x.almacen._rastros.find((r) => r.tipo === 'crm').datos.anterior.estado, 'ACTIVO')
    assert.deepEqual(x.meta, [])
    assert.equal(x.almacen._bajas[0].pasos.meta.estado, 'omitido')
    assert.ok(x.enviados.some((e) => e.chatId === G_PRUEBA.general))
    assert.ok(x.almacen._rastros.every((r) => r.idCrm === 'Z001'))
  })
  test('recontacto de prueba: lista con clave "prueba:AAAA-MM" y sin los 30 días de espera', async () => {
    const fin = cliente({ ...PRUEBA, estado: 'FINALIZADO', fechaBaja: '2026-11-01' })
    const x = armarPrueba({ leerClientes: async () => [fin] })
    const r = await x.N.correrDiario({ forzarRecontacto: true })
    assert.equal(r.recontactos, 1, JSON.stringify(r))
    assert.equal(x.almacen._recontactos[0].mes, 'prueba:2026-11')
    assert.ok(x.almacen._rastros.some((z) => z.tipo === 'discord'))
  })
  test('directorio de prueba: rechaza grupos "parecidos" de otro cliente', async () => {
    const d = S.directorioSoloPrueba({ deCliente: async () => ({ cliente: 'Juan Pérez', idCrm: null, grupos: G_REAL, origen: 'nombre' }) })
    assert.equal(await d.deCliente('Z001', 'PRUEBA BOT Juan Pérez'), null)
    const ok = S.directorioSoloPrueba({ deCliente: async () => ({ cliente: 'PRUEBA BOT Uno', idCrm: null, grupos: G_PRUEBA, origen: 'nombre' }) })
    assert.ok(await ok.deCliente('Z001', 'PRUEBA BOT Uno'))
  })
})

describe('CRM: guarda lo anterior para poder volver atrás', () => {
  test('marcarBajaCrm devuelve anterior con las celdas', async () => {
    const cab = ['ID', 'Nombre', 'Estado', 'Notas renovación', 'Fecha de baja']
    const planilla = {
      leer: async (rangos) => rangos.length === 2 ? [[cab], [['Z001', 'PRUEBA BOT Uno', 'ACTIVO', 'nota vieja', '']]] : [[['Z001', 'PRUEBA BOT Uno', 'FINALIZADO', 'nota vieja | [01/11/2026] x', 46327]]],
      escribirValores: async () => {},
    }
    const r = await CRM.marcarBajaCrm(planilla, { id: 'Z001', nombre: 'PRUEBA BOT Uno', fecha: '2026-11-01', nota: 'x' }, { modo: 'simulacion', soloPrueba: true })
    assert.equal(r.estado, 'simulado')
    assert.equal(r.anterior.estado, 'ACTIVO'); assert.equal(r.anterior.notas, 'nota vieja'); assert.ok(r.anterior.celdas.estado.includes('Agencia'))
  })
})

describe('limpieza del cliente de prueba', () => {
  const RASTROS = [
    { idCrm: 'Z001', tipo: 'whatsapp', datos: { chatId: VERIF, mensajeId: 'wa-1' }, creado: '' },
    { idCrm: 'Z001', tipo: 'whatsapp', datos: { chatId: G_PRUEBA.general, mensajeId: 'wa-2' }, creado: '' },
    { idCrm: 'Z001', tipo: 'whatsapp', datos: { chatId: VERIF, mensajeId: 'wa-1' }, creado: '' },
    { idCrm: 'Z001', tipo: 'discord', datos: { mensajeId: '111' }, creado: '' },
    { idCrm: 'Z001', tipo: 'discord', datos: { mensajeId: '222' }, creado: '' },
    { idCrm: 'Z001', tipo: 'crm', datos: { fila: 50, anterior: { estado: 'ACTIVO', fechaBaja: null, notas: 'vieja', celdas: { estado: "'Agencia'!C50", fechaBaja: "'Agencia'!V50", notas: "'Agencia'!R50" } } }, creado: '' },
    { idCrm: 'Z001', tipo: 'grupos', datos: { grupo: 'general', quitados: [FICTICIO] }, creado: '' },
    { idCrm: 'Z001', tipo: 'comunidad', datos: { comunidadId: 'x' }, creado: '' },
  ]
  const deps = (over = {}) => {
    const hecho = { wa: [], dc: [], crm: [], borrar: [] }
    return {
      hecho,
      d: {
        esPrueba: CP.nombreDePrueba,
        rastros: async () => RASTROS,
        contar: async () => ({ pedidos: 3, rastros: RASTROS.length }),
        borrar: async (ids, conRastros) => { hecho.borrar.push({ ids, conRastros }); return { pedidos: 3, rastros: conRastros ? RASTROS.length : 0 } },
        filasCrm: async () => [{ fila: 50, id: 'Z001', nombre: 'PRUEBA BOT Uno', estado: 'FINALIZADO' }],
        escribirCrm: async (x) => { hecho.crm.push(...x) },
        whatsappSano: async () => true,
        borrarWhatsapp: async (id) => { hecho.wa.push(id) },
        borrarDiscord: async (id) => { hecho.dc.push(id); if (id === '222') throw Object.assign(new Error('no'), { status: 404 }) },
        ...over,
      },
    }
  }
  test('simular: cuenta, no toca nada', async () => {
    const x = deps()
    const i = await LI.limpiarPruebaBajas(['Z001'], 'simular', x.d)
    assert.equal(i.whatsapp.mensajes, 2); assert.equal(i.discord.mensajes, 2); assert.equal(i.crm.filas, 1)
    assert.deepEqual(x.hecho, { wa: [], dc: [], crm: [], borrar: [] })
    assert.equal(i.noSeDeshace.length, 2)
    assert.match(LI.textoInforme(i), /simulación/)
  })
  test('real: borra WhatsApp (una vez cada uno), Discord (404 = ya no estaba), vuelve atrás el CRM y borra Neon con los rastros', async () => {
    const x = deps()
    const i = await LI.limpiarPruebaBajas(['z001'], 'real', x.d)
    assert.deepEqual(x.hecho.wa, ['wa-1', 'wa-2']); assert.equal(i.discord.borrados, 2)
    assert.deepEqual(x.hecho.crm.map((c) => c.values[0][0]), ['ACTIVO', '', "'vieja"])
    assert.deepEqual(x.hecho.borrar, [{ ids: ['Z001'], conRastros: true }])
  })
  test('seguro: si un ID es de una fila que NO es PRUEBA BOT, no toca nada', async () => {
    const x = deps({ filasCrm: async () => [{ fila: 9, id: 'A100', nombre: 'Ana Pérez', estado: 'ACTIVO' }] })
    const i = await LI.limpiarPruebaBajas(['A100'], 'real', x.d)
    assert.match(i.abortado, /NO es "PRUEBA BOT/)
    assert.deepEqual(x.hecho, { wa: [], dc: [], crm: [], borrar: [] })
  })
  test('WhatsApp no sano: no borra mensajes y conserva los rastros para reintentar', async () => {
    const x = deps({ whatsappSano: async () => false })
    const i = await LI.limpiarPruebaBajas(['Z001'], 'real', x.d)
    assert.deepEqual(x.hecho.wa, []); assert.equal(x.hecho.borrar[0].conRastros, false); assert.equal(i.neon.rastros_conservados, 1)
  })
  test('CRM: si la fila ya no está en FINALIZADO/INACTIVO, no la toca', async () => {
    const x = deps({ filasCrm: async () => [{ fila: 50, id: 'Z001', nombre: 'PRUEBA BOT Uno', estado: 'ACTIVO' }] })
    await LI.limpiarPruebaBajas(['Z001'], 'real', x.d)
    assert.deepEqual(x.hecho.crm, [])
  })
  test('script: --simular por defecto, IDs de BOT_CLIENTES_PRUEBA si no se pasan, argumentos raros fallan', async () => {
    assert.deepEqual(SCRIPT.parsearArgs([], { BOT_CLIENTES_PRUEBA: 'Z001' }), { modo: 'simular', ids: ['Z001'] })
    assert.deepEqual(SCRIPT.parsearArgs(['z002', '--real'], {}), { modo: 'real', ids: ['Z002'] })
    assert.throws(() => SCRIPT.parsearArgs(['--borrar-todo'], {}))
    const x = deps(), out = []
    const i = await SCRIPT.main(['Z001'], { deps: x.d, env: {}, log: (t) => out.push(t) })
    assert.equal(i.modo, 'simular'); assert.match(out[0], /Z001/)
    assert.equal(await SCRIPT.main([], { deps: x.d, env: {}, log: () => {} }), null)
  })
})
