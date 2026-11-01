// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-exito-prueba.mjs
// Etapa ÉXITO: h01 (medidor, 5 días contento), corrida de PRUEBA con BOT_CLIENTES_PRUEBA (solo el cliente ficticio, en real,
// aunque el modo general esté apagado), rastros y limpieza (scripts/limpiar-cliente-prueba-exito.mjs).
// SIN red ni base: fetch bloqueado, Whapi / Claude / Discord falsos, almacén en memoria y SQL falso. Todo inventado.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const k of Object.keys(process.env)) {
  if (/^(WHAPI_|BOT_ALTA_|BOT_EXITO|BOT_CLIENTES_PRUEBA|EXITO_|DISCORD_)/.test(k) || ['CRON_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'SHEET_ID_CLIENTES', 'SHEET_ID_TYPEFORM'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const P = await import('../lib/bot/clientesPrueba.ts')
const CFG = await import('../lib/bot/exito/config.ts')
const A = await import('../lib/bot/exito/almacen.ts')
const M = await import('../lib/bot/exito/medidor.ts')
const N = await import('../lib/bot/exito/nucleo.ts')
const S = await import('../lib/bot/exito/servidor.ts')
const T = await import('../lib/bot/exito/textos.ts')
const L = await import('../lib/bot/exito/lectura.ts')
const RS = await import('../lib/bot/rastrosPrueba.ts')
const LIMPIAR = await import('./limpiar-cliente-prueba-exito.mjs')

const VERIF = '120363000000000002@g.us'
const GEN_REAL = '120363000000000101@g.us', CONT_REAL = '120363000000000103@g.us'
const GEN_PRUEBA = '120363000000000201@g.us', CONT_PRUEBA = '120363000000000203@g.us'
const TOMI = '5491100000001', CLIENTE = '5491155550099'
const AHORA = Date.parse('2026-11-01T18:00:00Z')
const DIA = 86_400_000
let n = 0
const SILENCIO = { info() {}, warn() {}, error() {} }

const FICHA_REAL = { clave: 'A123', cliente: 'Ana Pérez', idCrm: 'A123', grupos: { general: GEN_REAL, contenido: CONT_REAL }, invitacionGeneral: null, origen: 'motor' }
// El cliente ficticio: grupos armados a mano ("General - Cliente Prueba"), sin ID: lo reconoce por el nombre del CRM
const FICHA_PRUEBA = { clave: 'n:cliente prueba', cliente: 'Cliente Prueba', idCrm: null, grupos: { general: GEN_PRUEBA, contenido: CONT_PRUEBA }, invitacionGeneral: null, origen: 'nombre' }

const vacio = () => ({ mensajes: [], videos: [], respuestas: [], ecos: [], descartes: {} })
const mensaje = (chat, texto = 'Cerré 3 casos esta semana', t = AHORA) => ({ ...vacio(), mensajes: [{ mensajeId: `m-${++n}`, chatId: chat, texto, autor: { telefono: CLIENTE, lid: null, nombre: 'X' }, enviadoEn: new Date(t - 60_000).toISOString() }] })
const respuesta = (citado, veredicto = 'ok', resto = '') => ({ ...vacio(), respuestas: [{ mensajeId: `r-${++n}`, citado, veredicto, resto, autor: { telefono: TOMI, lid: null, nombre: 'Tomi' }, enviadoEn: new Date(AHORA).toISOString() }] })
const video = (chat, t) => ({ ...vacio(), videos: [{ mensajeId: `v-${++n}`, chatId: chat, autor: { telefono: CLIENTE, lid: null, nombre: 'X' }, enviadoEn: new Date(t).toISOString(), medio: { id: 'mp4', mime: 'video/mp4', segundos: 30, bytes: 1, pie: null } }] })

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('BOT_CLIENTES_PRUEBA (común a las etapas)', () => {
  test('solo IDs del CRM; vacío o basura = ninguno (nunca "todos")', () => {
    assert.deepEqual([...P.clientesPrueba({ BOT_CLIENTES_PRUEBA: 'z001, Z002 ; *, todos, 123' })], ['Z001', 'Z002'])
    assert.equal(P.clientesPrueba({}).size, 0)
    assert.equal(P.clientesPrueba({ BOT_CLIENTES_PRUEBA: '*' }).size, 0)
    assert.equal(P.esClientePrueba('z001', new Set(['Z001'])), true)
    assert.equal(P.esClientePrueba(null, new Set(['Z001'])), false)
  })
  test('config de prueba: real con todas las capacidades; el medidor y el recordatorio se pueden acortar', () => {
    const c = CFG.configPruebaExito({ EXITO_DIAS_CONTENTO_PRUEBA: '0' })
    assert.equal(c.modo, 'real')
    assert.equal(c.prueba, true)
    assert.deepEqual([...c.capacidades].sort(), [...CFG.CAPACIDADES_EXITO].sort())
    assert.equal(c.diasContento, 0)
    assert.equal(CFG.configExito({}).diasContento, 5)
    assert.equal(CFG.configExito({ EXITO_DIAS_CONTENTO: '99' }).diasContento, 5)
    assert.equal(CFG.configExito({}).maxEncuestasCorrida, 10)
  })
})

describe('h01: medidor de éxito (5 días contento → pedir testimonio)', () => {
  const s = (clave, estado, dias, detalle = {}, tipo = 'mensaje') => ({ id: `s-${++n}`, tipo, clave, chatId: CONT_REAL, estado, detalle, creado: new Date(AHORA - dias * DIA).toISOString() })
  test('racha desde la primera señal buena; listo a los 5 días', () => {
    const [m] = M.medirContento([s('A123', 'exito', 6, { cita: 'cerré 3', grupo: 'contenido' }), s('A123', 'exito', 1, { cita: 'otro caso', grupo: 'ventas' })], AHORA, 5)
    assert.equal(m.dias, 6)
    assert.equal(m.senales, 2)
    assert.equal(m.listo, true)
    assert.deepEqual(m.ultima, { cita: 'otro caso', grupo: 'ventas', puntaje: null })
    assert.equal(M.medirContento([s('A123', 'exito', 4)], AHORA, 5)[0].listo, false)
  })
  test('una señal mala (habla de resultados malos) corta la racha; un "no" que no habla de resultados, no', () => {
    const lista = [s('A123', 'exito', 8), s('A123', 'no', 3, { habla: true, buenos: false }), s('A123', 'exito', 2)]
    const [m] = M.medirContento(lista, AHORA, 5)
    assert.equal(m.dias, 2)
    assert.equal(m.listo, false)
    const [m2] = M.medirContento([s('A123', 'exito', 8), s('A123', 'no', 3, { habla: false, buenos: false })], AHORA, 5)
    assert.equal(m2.listo, true)
    assert.equal(M.medirContento([s('A123', 'exito', 8), s('A123', 'no', 1, { habla: true, buenos: false })], AHORA, 5).length, 0)
  })
  test('texto del pedido por el medidor', () => {
    const t = T.textoPedidoOk('Ana Pérez', { tipo: 'contento', dias: 6, senales: 2, desde: '2026-10-26', cita: 'cerré 3 casos', grupo: 'contenido', puntaje: null })
    assert.match(t, /^🏆 Éxito de cliente: Ana Pérez\nContento hace 6 días \(desde el 26\/10\/2026, 2 señales buenas, ninguna mala\)\nÚltima: en el grupo Contenido: "cerré 3 casos"/)
  })

  function armar(diasContento = 5) {
    const reloj = { t: AHORA }
    const enviados = [], al = A.almacenExitoEnMemoria()
    const config = { ...CFG.configExito({}), modo: 'real', capacidades: new Set(CFG.CAPACIDADES_EXITO), aprobadores: [TOMI], verificaciones: VERIF, diasContento }
    const deps = {
      config, almacen: al,
      directorio: { deChat: async (c) => (Object.values(FICHA_REAL.grupos).includes(c) ? { ficha: FICHA_REAL, grupo: c === GEN_REAL ? 'general' : 'contenido' } : null), todas: async () => [FICHA_REAL] },
      async enviarTexto(p) { enviados.push(p); return { id: `wa-${enviados.length}` } },
      clasificar: async (t) => ({ exito: true, hablaDeResultados: true, buenos: true, confianza: 'alta', cita: t.slice(0, 30), motivo: '' }),
      discord: async () => 'dc-1', mencionGeroM: null, ahora: () => reloj.t, esperar: async () => {}, log: SILENCIO,
    }
    // las señales se guardan con el reloj del núcleo
    const reclamar = al.reclamarSenal.bind(al)
    al.reclamarSenal = (x) => reclamar(x, new Date(reloj.t).toISOString())
    return { nucleo: N.crearNucleo(deps), al, enviados, reloj }
  }
  test('un mensaje bueno NO pide enseguida; el cron del día 5 sí (una vez)', async () => {
    const x = armar()
    const r = await x.nucleo.procesarEventos(mensaje(CONT_REAL))
    assert.equal(r.detectados, 1)
    assert.equal(x.enviados.length, 0)
    assert.match(r.registro.join('\n'), /medidor: A123 contento hace 0 día/)
    x.reloj.t = AHORA + 4 * DIA
    assert.equal((await x.nucleo.correrDiario({ clientesActivos: async () => [], respuestasTypeform: async () => null })).pedidos, 0)
    x.reloj.t = AHORA + 5 * DIA
    const r2 = await x.nucleo.correrDiario({ clientesActivos: async () => [], respuestasTypeform: async () => null })
    assert.equal(r2.pedidos, 1)
    assert.match(x.enviados[0].texto, /Contento hace 5 días/)
    assert.equal(x.al._pedidos[0].motivo.tipo, 'contento')
    x.reloj.t = AHORA + 6 * DIA
    await x.nucleo.correrDiario({ clientesActivos: async () => [], respuestasTypeform: async () => null })
    assert.equal(x.al._pedidos.length, 1)
  })
  test('EXITO_DIAS_CONTENTO=0: como antes, pide en la primera señal', async () => {
    const x = armar(0)
    assert.equal((await x.nucleo.procesarEventos(mensaje(CONT_REAL))).pedidos, 1)
  })
})

// ── Corrida de PRUEBA con los dos núcleos (servidor.ts) ──
function entorno({ modoGeneral, diasPrueba = '0', extra = {} } = {}) {
  const reloj = { t: AHORA }
  const enviados = [], discord = [], al = A.almacenExitoEnMemoria(), rastros = RS.rastrosEnMemoria()
  const env = { BOT_CLIENTES_PRUEBA: 'Z001', WHAPI_GRUPO_VERIFICACIONES: VERIF, BOT_ALTA_APROBADORES: TOMI, EXITO_DIAS_CONTENTO_PRUEBA: diasPrueba, ...(modoGeneral ? { BOT_EXITO_MODO: modoGeneral, BOT_EXITO_CAPACIDADES: CFG.CAPACIDADES_EXITO.join(',') } : {}), ...extra }
  const fichas = [FICHA_REAL, FICHA_PRUEBA]
  const op = {
    env, almacen: al, rastros, log: SILENCIO, ahora: () => reloj.t, esperar: async () => {},
    directorio: { deChat: async (c) => { for (const f of fichas) for (const [g, id] of Object.entries(f.grupos)) if (id === c) return { ficha: f, grupo: g }; return null }, todas: async () => fichas },
    nombresPrueba: async () => [{ id: 'Z001', nombre: 'Cliente Prueba' }],
    enviarTexto: async (p) => { enviados.push(p); return { id: `wa-${enviados.length}` } },
    discord: async (texto) => { discord.push(texto); return `dc-${discord.length}` },
    clasificar: async (t) => ({ exito: true, hablaDeResultados: true, buenos: true, confianza: 'alta', cita: t.slice(0, 30), motivo: '' }),
    clienteOperativo: async () => true,
  }
  return { op, al, enviados, discord, rastros, reloj, env }
}
const lectores = (clientes) => ({ clientesActivos: async () => clientes, respuestasTypeform: async () => [] })
const CLIENTES = [{ id: 'A123', nombre: 'Ana Pérez', mail: '', celular: '' }, { id: 'Z001', nombre: 'Cliente Prueba', mail: '', celular: '' }]

describe('corrida de PRUEBA: solo el cliente ficticio, en real, con el modo general apagado', () => {
  test('modo general en seco: el cliente REAL no recibe nada; el de prueba hace todo el caminito', async () => {
    const x = entorno()
    // Cliente real: nada
    assert.equal(await S.procesarExitoReal(mensaje(CONT_REAL), x.op).then((r) => r?.pedidos ?? 0), 0)
    assert.equal(x.enviados.length, 0)
    // Cliente de prueba: pedido de OK en Verificaciones, marcado como PRUEBA
    const r = await S.procesarExitoReal(mensaje(CONT_PRUEBA), x.op)
    assert.equal(r.pedidos, 1)
    assert.equal(x.enviados[0].chatId, VERIF)
    assert.match(x.enviados[0].texto, /^🧪 PRUEBA \(cliente ficticio\)\n\n🏆 Éxito de cliente: Cliente Prueba/)
    assert.equal(x.al._pedidos[0].clave, 'Z001')
    // OK → mensaje de testimonio (texto exacto) al General de PRUEBA
    await S.procesarExitoReal(respuesta('wa-1'), x.op)
    const aCliente = x.enviados.filter((e) => e.chatId !== VERIF)
    assert.deepEqual(aCliente.map((e) => e.chatId), [GEN_PRUEBA])
    assert.equal(aCliente[0].texto, T.textoTestimonio('Cliente Prueba', AHORA))
    // Video → agradecimiento con Calendly + Discord marcado como PRUEBA
    x.reloj.t = AHORA + DIA
    const rv = await S.procesarExitoReal(video(CONT_PRUEBA, AHORA + DIA - 60_000), x.op)
    assert.equal(rv.testimonios, 1)
    assert.ok(x.enviados.some((e) => e.chatId === GEN_PRUEBA && e.texto.includes(CFG.URL_CALENDLY_POR_DEFECTO)))
    assert.match(x.discord[0], /^🧪 PRUEBA/)
    // Nunca un mensaje a un grupo del cliente real
    assert.ok(x.enviados.every((e) => e.chatId !== GEN_REAL && e.chatId !== CONT_REAL))
    // Cada salida dejó su rastro
    assert.equal(x.rastros.lista.filter((z) => z.tipo === 'whatsapp').length, x.enviados.length)
    assert.equal(x.rastros.lista.filter((z) => z.tipo === 'discord').length, 1)
    assert.ok(x.rastros.lista.every((z) => z.etapa === 'exito' && z.idCrm === 'Z001' && (z.tipo !== 'discord' || z.destino === 'DISCORD_WEBHOOK_CLIENTES')))
  })
  test('sin BOT_CLIENTES_PRUEBA y en seco: nada (como siempre)', async () => {
    const x = entorno({ extra: { BOT_CLIENTES_PRUEBA: '' } })
    assert.equal(await S.procesarExitoReal(mensaje(CONT_PRUEBA), x.op), null)
    assert.equal(x.enviados.length, 0)
  })
  test('modo general en ensayo: el real solo deja SIMULACIÓN; el de prueba sale en real', async () => {
    const x = entorno({ modoGeneral: 'ensayo', extra: { EXITO_DIAS_CONTENTO: '0' } })
    await S.procesarExitoReal(mensaje(CONT_REAL), x.op)
    await S.procesarExitoReal(mensaje(CONT_PRUEBA), x.op)
    assert.equal(x.enviados.length, 2)
    assert.match(x.enviados[0].texto, /^SIMULACIÓN — no se cargó nada/)
    assert.match(x.enviados[1].texto, /^🧪 PRUEBA/)
    // El OK al pedido real (ensayo) no manda nada al cliente; el OK al de prueba, sí
    await S.procesarExitoReal(respuesta('wa-1'), x.op)
    await S.procesarExitoReal(respuesta('wa-2'), x.op)
    const aClientes = x.enviados.filter((e) => e.chatId !== VERIF)
    assert.deepEqual(aClientes.map((e) => e.chatId), [GEN_PRUEBA])
    assert.equal(x.al._pedidos.find((p) => p.clave === 'A123').estado, 'aprobado_simulado')
    // Rastros: exactamente lo que salió por el de prueba (lo de Verificaciones va marcado 🧪, lo otro a su General)
    assert.equal(x.rastros.lista.length, x.enviados.filter((e) => /^🧪/.test(e.texto) || e.chatId === GEN_PRUEBA).length)
    assert.ok(x.enviados.filter((e) => e.chatId === VERIF && !/^SIMULACIÓN/.test(e.texto)).every((e) => /^🧪/.test(e.texto)))
  })
  test('modo general en real: el núcleo general NO atiende al de prueba (y viceversa): un solo pedido por cliente', async () => {
    const x = entorno({ modoGeneral: 'real', extra: { EXITO_DIAS_CONTENTO: '0' } })
    await S.procesarExitoReal(mensaje(CONT_PRUEBA), x.op)
    await S.procesarExitoReal(mensaje(CONT_REAL), x.op)
    assert.equal(x.al._pedidos.length, 2)
    assert.equal(x.rastros.lista.length, 1)   // solo el pedido de prueba deja rastro
  })
  test('medidor en la prueba: EXITO_DIAS_CONTENTO_PRUEBA=5 espera; el cron del día 5 pide', async () => {
    const x = entorno({ diasPrueba: '5' })
    const al = x.al
    const reclamar = al.reclamarSenal.bind(al)
    al.reclamarSenal = (s) => reclamar(s, new Date(x.reloj.t).toISOString())
    await S.procesarExitoReal(mensaje(CONT_PRUEBA), x.op)
    assert.equal(x.enviados.length, 0)
    x.reloj.t = AHORA + 5 * DIA
    const r = await S.correrDiarioReal({ ...x.op, lectores: lectores(CLIENTES) })
    assert.equal(r.pedidos, 1)
    assert.match(x.enviados[0].texto, /Contento hace 5 días/)
  })
  test('encuesta de prueba: ?lista=prueba publica SOLO al de prueba (lote "-prueba"); OK → encuesta; recordatorio acortado', async () => {
    const x = entorno({ extra: { EXITO_RECORDATORIO_HORAS_PRUEBA: '1' } })
    await S.correrDiarioReal({ ...x.op, lectores: lectores(CLIENTES), forzarLista: 'prueba' })
    assert.equal(x.enviados.length, 1)
    assert.match(x.enviados[0].texto, /^🧪 PRUEBA[\s\S]*📋 Encuesta mensual \(2026-11\): la mando a estos 1 clientes activos: Cliente Prueba/)
    assert.deepEqual(x.al._lotes.map((l) => l.mes), ['2026-11-prueba'])
    // ?lista=1 (general) no lo publica en seco, y el general no ve el lote de prueba
    await S.correrDiarioReal({ ...x.op, lectores: lectores(CLIENTES), forzarLista: true })
    assert.equal(x.enviados.length, 1)
    const r = await S.procesarExitoReal(respuesta('wa-1'), x.op)
    assert.equal(r.encuestas, 1)
    const enc = x.enviados.find((e) => e.chatId === GEN_PRUEBA)
    assert.equal(enc.texto, T.textoEncuesta('Cliente Prueba', CFG.URL_TYPEFORM_POR_DEFECTO))
    assert.deepEqual(x.al._encuestas.map((e) => e.id), ['2026-11-prueba:Z001'])
    x.reloj.t = AHORA + 2 * 3600_000
    const r2 = await S.correrDiarioReal({ ...x.op, lectores: lectores(CLIENTES) })
    assert.equal(r2.recordatorios, 1)
    assert.ok(x.enviados.every((e) => e.chatId === VERIF || e.chatId === GEN_PRUEBA))
  })
  test('?dry=1 con prueba: no manda ni escribe', async () => {
    const x = entorno()
    await S.correrDiarioReal({ ...x.op, lectores: lectores(CLIENTES), forzarLista: 'prueba', dry: true })
    assert.equal(x.enviados.length + x.al._lotes.length + x.rastros.lista.length, 0)
  })
  test('?estado=1 muestra la prueba y el medidor', async () => {
    const x = entorno()
    const e = await L.leerEstadoExito({ env: x.env, almacen: x.al })
    assert.deepEqual(e.prueba.clientes, ['Z001'])
    assert.ok(Array.isArray(e.medidor))
  })
})

describe('limpieza: scripts/limpiar-cliente-prueba-exito.mjs', () => {
  test('argumentos: --simular por defecto, IDs de --id o BOT_CLIENTES_PRUEBA; IDs raros frenan', () => {
    assert.deepEqual(LIMPIAR.parsearArgs([], { BOT_CLIENTES_PRUEBA: 'z001' }), { modo: 'simular', ids: ['Z001'] })
    assert.deepEqual(LIMPIAR.parsearArgs(['--real', '--id', 'Z002'], { BOT_CLIENTES_PRUEBA: 'Z001' }), { modo: 'real', ids: ['Z002'] })
    assert.throws(() => LIMPIAR.parsearArgs(['--id', '*']))
    assert.throws(() => LIMPIAR.parsearArgs(['--borrar-todo']))
  })
  // SQL falso: anota sentencias y responde según la tabla
  function sqlFalso() {
    const sentencias = []
    const q = (strings, ...vals) => {
      const t = strings.join('$').replace(/\s+/g, ' ').trim()
      sentencias.push({ t, vals })
      if (/^SELECT id, tipo, destino, ref FROM cj_prueba_rastros/.test(t)) return Promise.resolve([
        { id: 1, tipo: 'whatsapp', destino: VERIF, ref: 'wa-1' }, { id: 2, tipo: 'whatsapp', destino: GEN_PRUEBA, ref: 'wa-2' },
        { id: 3, tipo: 'whatsapp', destino: GEN_PRUEBA, ref: null }, { id: 4, tipo: 'discord', destino: 'DISCORD_WEBHOOK_CLIENTES', ref: 'dc-1' },
      ])
      if (/^SELECT count/.test(t)) return Promise.resolve([{ n: 2 }])
      if (/cj_exito_lotes/.test(t) && /^DELETE/.test(t)) return Promise.reject(Object.assign(new Error('relation "cj_exito_lotes" does not exist'), { code: '42P01' }))
      return Promise.resolve([])
    }
    return { q, sentencias }
  }
  test('--simular: solo lee, no borra nada ni sale a la red', async () => {
    const { q, sentencias } = sqlFalso()
    const out = []
    const c = await LIMPIAR.main([], { env: { BOT_CLIENTES_PRUEBA: 'Z001' }, sql: q, salida: (t) => out.push(t), fetch: async () => { throw new Error('no') } })
    assert.equal(c, 0)
    assert.ok(sentencias.every((s) => /^SELECT/.test(s.t)))
    assert.match(out.join('\n'), /3 de WhatsApp \(1 sin id\), 1 de Discord/)
    assert.match(out.join('\n'), /Simulación: no se borró nada/)
  })
  test('--real: borra los mensajes del bot (Whapi con health AUTH, Discord) y las filas; lo que no se pudo queda listado', async () => {
    const { q, sentencias } = sqlFalso()
    const llamadas = []
    const f = async (url, init = {}) => {
      llamadas.push(`${init.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`)
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: { code: 4, text: 'AUTH' } }), { status: 200 })
      return new Response(null, { status: url.includes('wa-2') ? 404 : 200 })
    }
    const out = []
    const c = await LIMPIAR.main(['--real'], { env: { BOT_CLIENTES_PRUEBA: 'Z001', WHAPI_TOKEN: 'tok-falso', DISCORD_WEBHOOK_CLIENTES: 'https://discord.invalid/api/webhooks/1/abc' }, sql: q, salida: (t) => out.push(t), fetch: f, esperar: async () => {} })
    assert.equal(c, 2)   // queda el dudoso sin id
    assert.deepEqual(llamadas, ['GET /health', 'DELETE /messages/wa-1', 'DELETE /messages/wa-2', 'DELETE /api/webhooks/1/abc/messages/dc-1'])
    const borra = sentencias.filter((s) => /^DELETE/.test(s.t)).map((s) => s.t.split(' WHERE')[0])
    assert.deepEqual(borra, ['DELETE FROM cj_exito_testimonios', 'DELETE FROM cj_exito_pedidos', 'DELETE FROM cj_exito_senales', 'DELETE FROM cj_exito_encuestas', 'DELETE FROM cj_exito_lotes', 'DELETE FROM cj_prueba_rastros'])
    assert.deepEqual(sentencias.find((s) => /^DELETE FROM cj_prueba_rastros/.test(s.t)).vals[0], ['1', '2', '4'])
    assert.match(out.join('\n'), /whatsapp #3: sin id/)
    assert.ok(!out.join('\n').includes('tok-falso'))
  })
  test('--real con el número caído: no borra en WhatsApp y lo deja listado', async () => {
    const { q } = sqlFalso()
    const out = []
    const f = async (url) => (url.endsWith('/health') ? new Response(JSON.stringify({ status: { code: 3, text: 'QR' } }), { status: 200 }) : new Response(null, { status: 200 }))
    await LIMPIAR.main(['--real'], { env: { BOT_CLIENTES_PRUEBA: 'Z001', WHAPI_TOKEN: 't' }, sql: q, salida: (t) => out.push(t), fetch: f, esperar: async () => {} })
    assert.match(out.join('\n'), /whatsapp #1: el número del bot no está conectado/)
    assert.match(out.join('\n'), /discord #4: falta DISCORD_WEBHOOK_CLIENTES/)
  })
  test('sin IDs no hace nada', async () => {
    const out = []
    assert.equal(await LIMPIAR.main([], { env: {}, salida: (t) => out.push(t) }), 1)
  })
})

describe('documentación', () => {
  test('docs/BOT-EXITO-CJ.md explica el medidor, la prueba, los rastros y la limpieza, con todas las variables nuevas', () => {
    const doc = readFileSync(new URL('../docs/BOT-EXITO-CJ.md', import.meta.url), 'utf8')
    for (const k of ['BOT_CLIENTES_PRUEBA', 'EXITO_DIAS_CONTENTO', 'EXITO_DIAS_CONTENTO_PRUEBA', 'EXITO_RECORDATORIO_HORAS_PRUEBA', 'EXITO_ENCUESTA_MAX_CORRIDA', 'cj_prueba_rastros']) assert.ok(doc.includes(`\`${k}\``), k)
    assert.ok(doc.includes('scripts/limpiar-cliente-prueba-exito.mjs'))
    assert.ok(doc.includes('?lista=prueba'))
  })
})
