// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-exito.mjs
// Etapa ÉXITO DEL CLIENTE del bot "Capital Jurídico" (lib/bot/exito/*, docs/BOT-EXITO-CJ.md).
// SIN red ni base: el fetch global está bloqueado, Whapi / Claude / Discord son falsos y el almacén es el de memoria (o un
// cliente SQL falso para la versión de Neon). Los teléfonos, nombres, ids y secretos de acá son inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

for (const k of Object.keys(process.env)) {
  if (/^(WHAPI_|BOT_ALTA_|BOT_EXITO|EXITO_|DISCORD_)/.test(k) || ['CRON_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'DESPACHO_URL', 'SHEET_ID_CLIENTES', 'SHEET_ID_TYPEFORM'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const CFG = await import('../lib/bot/exito/config.ts')
const T = await import('../lib/bot/exito/textos.ts')
const F = await import('../lib/bot/exito/filtro.ts')
const CL = await import('../lib/bot/exito/claude.ts')
const A = await import('../lib/bot/exito/almacen.ts')
const AN = await import('../lib/bot/exito/almacenNeon.ts')
const D = await import('../lib/bot/exito/directorio.ts')
const N = await import('../lib/bot/exito/nucleo.ts')
const S = await import('../lib/bot/exito/servidor.ts')
const L = await import('../lib/bot/exito/lectura.ts')
const RE = await import('../lib/bot/exito/ruta.ts')
const R2 = await import('../lib/bot/exito/rondas.ts')
const R = await import('../lib/bot/whapi/ruta.ts')
const G = await import('../lib/bot/whapi/guiones.ts')
const MIG = await import('./bot-exito-migrar.mjs')
const { enLista: enListaMotor } = await import('../lib/bot/alta/motor/orquestador.ts')

const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const GENERAL = '120363000000000101@g.us', VENTAS_C = '120363000000000102@g.us', CONTENIDO = '120363000000000103@g.us'
const OTRO = '120363000000000999@g.us'
const CLIENTE_TEL = '5491155550099', TOMI = '5491100000001', GERO_A = '5491100000002', AYLU = '5491100000003', EXTRANO = '5491100000009'
const AHORA = Date.parse('2026-10-24T18:00:00Z')   // 15:00 de Argentina
const DIA = 86_400_000
const TS = Math.floor(AHORA / 1000) - 30
let n = 0
const msg = (over = {}) => ({ id: `msg-${++n}-AbCd`, from_me: false, type: 'text', chat_id: CONTENIDO, timestamp: TS, source: 'mobile', text: { body: 'hola' }, from: CLIENTE_TEL, from_name: 'Ana', ...over })
const envio = (messages) => ({ messages, event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-PRUEBA1' })
const equipo = new Set([TOMI, GERO_A, AYLU])

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('config: nace en seco y las capacidades se respetan', () => {
  test('sin variables: seco, sin capacidades, con los links por defecto', () => {
    const c = CFG.configExito({})
    assert.equal(c.modo, 'seco')
    assert.equal(c.capacidades.size, 0)
    assert.equal(c.calendlyUrl, 'https://calendly.com/skywardconsultoriajuridica/analisisyproyeccion')
    assert.equal(c.typeformUrl, 'https://form.typeform.com/to/bnvnMvVn')
    assert.equal(c.diaEncuesta, 1)
  })
  test('modo mal escrito → seco; seco ignora las capacidades', () => {
    assert.equal(CFG.modoExito({ BOT_EXITO_MODO: 'REAL' }), 'seco')
    assert.equal(CFG.capacidadesExito('seco', { BOT_EXITO_CAPACIDADES: 'exito_pedido_ok' }).size, 0)
  })
  test('ensayo: solo reportes (pedido, testimonio, encuesta), nunca el mensaje al cliente', () => {
    const caps = CFG.capacidadesExito('ensayo', { BOT_EXITO_CAPACIDADES: CFG.CAPACIDADES_EXITO.join(',') })
    assert.equal(CFG.reporteEnsayo('exito_pedido_ok', 'ensayo', caps), true)
    assert.equal(CFG.reporteEnsayo('exito_mensaje_cliente', 'ensayo', caps), false)
    for (const c of CFG.CAPACIDADES_EXITO) assert.equal(CFG.saleReal(c, 'ensayo', caps), false, c)
  })
  test('real: sale solo lo que dice BOT_EXITO_CAPACIDADES; los nombres desconocidos se cuentan', () => {
    const env = { BOT_EXITO_MODO: 'real', BOT_EXITO_CAPACIDADES: 'exito_pedido_ok, comunidad ,encuesta_mensual' }
    const caps = CFG.capacidadesExito('real', env)
    assert.deepEqual([...caps].sort(), ['encuesta_mensual', 'exito_pedido_ok'])
    assert.deepEqual(CFG.capacidadesExitoDesconocidas(env), ['comunidad'])
    assert.equal(CFG.saleReal('exito_mensaje_cliente', 'real', caps), false)
  })
  test('faltantes: solo NOMBRES; EXITO_* inválidas caen a lo de por defecto', () => {
    const env = { BOT_EXITO_MODO: 'real', BOT_EXITO_CAPACIDADES: 'exito_testimonio,encuesta_mensual', EXITO_CALENDLY_URL: 'http://inseguro', EXITO_ENCUESTA_DIA: '40' }
    const f = CFG.faltantesExito(env)
    for (const k of ['DATABASE_URL', 'WHAPI_TOKEN', 'WHAPI_GRUPO_VERIFICACIONES', 'BOT_ALTA_APROBADORES', 'BOT_ANTHROPIC_API_KEY', 'DISCORD_WEBHOOK_CLIENTES', 'SHEET_ID_CLIENTES', 'SHEET_ID_TYPEFORM']) assert.ok(f.includes(k), k)
    const c = CFG.configExito(env)
    assert.equal(c.calendlyUrl, CFG.URL_CALENDLY_POR_DEFECTO)
    assert.equal(c.diaEncuesta, 1)
  })
  test('BOT_EXITO=no la apaga', () => {
    assert.equal(CFG.exitoApagado({ BOT_EXITO: 'no' }), true)
    assert.equal(CFG.exitoApagado({}), false)
  })
})

describe('textos', () => {
  test('el mensaje de testimonio es el texto EXACTO de Tomás, con el primer nombre y el saludo de la hora', () => {
    const esperado = CFG && T.TEXTO_TESTIMONIO.replace('[CLIENTE]', 'Ana')
    assert.equal(T.textoTestimonio('ANA MARÍA PÉREZ', Date.parse('2026-10-24T18:00:00Z')), esperado)   // 15:00 AR
    assert.ok(T.textoTestimonio('Ana', Date.parse('2026-10-24T13:00:00Z')).startsWith('Buenos días Ana, ¿cómo estás? ¿Todo bien?'))   // 10:00 AR
    assert.ok(T.textoTestimonio('Ana', Date.parse('2026-10-25T00:30:00Z')).startsWith('Buenas noches Ana,'))   // 21:30 AR
    const t = T.textoTestimonio('Ana', AHORA)
    assert.ok(t.includes('https://youtube.com/playlist?list=PL8LofN0YIBBB0FRT2OU5WIAESNAh4ig0Q&si=TdEGjTz2PUbYMH8G'))
    assert.ok(t.includes('con Gero (Actis)'))
    assert.ok(t.endsWith('¿Te parece?'))
    assert.ok(!t.includes('[CLIENTE]'))
  })
  test('saludo: 5 a 12:59 días, 13 a 19:59 tardes, 20 a 4:59 noches (hora de Argentina, UTC-3)', () => {
    const h = (hhAR) => Date.parse(`2026-10-24T${String((hhAR + 3) % 24).padStart(2, '0')}:00:00Z`) + (hhAR + 3 >= 24 ? DIA : 0)
    assert.equal(T.saludoPorHora(h(4)), 'Buenas noches')
    assert.equal(T.saludoPorHora(h(5)), 'Buenos días')
    assert.equal(T.saludoPorHora(h(12)), 'Buenos días')
    assert.equal(T.saludoPorHora(h(13)), 'Buenas tardes')
    assert.equal(T.saludoPorHora(h(19)), 'Buenas tardes')
    assert.equal(T.saludoPorHora(h(20)), 'Buenas noches')
    assert.equal(T.saludoPorHora(h(23)), 'Buenas noches')
  })
  test('primer nombre: saltea títulos y arregla mayúsculas', () => {
    assert.equal(T.primerNombre('Dra. LAURA gómez'), 'Laura')
    assert.equal(T.primerNombre('juan-pablo ruiz'), 'Juan-Pablo')
    assert.equal(T.primerNombre(''), '')
    assert.ok(T.textoTestimonio('', AHORA).startsWith('Buenas tardes, ¿cómo estás?'))
  })
  test('pedido de OK: cliente, por qué y la instrucción OK / NO; cita recortada', () => {
    const t = T.textoPedidoOk('Ana Pérez', { tipo: 'mensaje', cita: 'x'.repeat(400), grupo: 'contenido' })
    assert.ok(t.startsWith('🏆 Éxito de cliente: Ana Pérez\nEscribió en el grupo Contenido: "'))
    assert.ok(t.endsWith('¿Le mando el mensaje de testimonio? Respondé citando: OK / NO'))
    assert.ok(t.length < 320)
    assert.match(T.textoPedidoOk('Ana', { tipo: 'encuesta', puntaje: 9, fecha: '02/10/2026' }), /Encuesta mensual: 9\/10 \(02\/10\/2026\)/)
  })
  test('encuesta y recordatorio: los textos APROBADOS por Tomás, tal cual, con el primer nombre y el link', () => {
    const L = 'https://form.typeform.com/to/bnvnMvVn'
    assert.equal(T.textoEncuesta('ANA PÉREZ', L), `Buenas Ana!  Como todos los meses, queremos saber cómo te venís sintiendo con Capital Jurídico. Son 3 preguntas y te lleva menos de 3 minutos:\n${L}\nTu respuesta nos ayuda a detectar dónde estamos fallando y qué debemos mejorar. Desde ya, muchas gracias!`)
    assert.equal(T.textoRecordatorio('Ana Pérez', L), `Ana, te recordamos la encuesta de este mes. Son 3 minutos y nos sirve muchísimo para poder ayudarte de la mejor manera:\n${L}`)
    assert.ok(T.textoEncuesta('', L).startsWith('Buenas!  Como todos'))
    assert.ok(T.textoRecordatorio('', L).startsWith('Te recordamos la encuesta'))
    const lista = T.textoListaEncuesta('2026-11', ['Ana Pérez', 'Luis Gómez'], ['Sin Grupo'])
    assert.match(lista, /^📋 Encuesta mensual \(2026-11\): la mando a estos 2 clientes activos: Ana Pérez, Luis Gómez/)
    assert.match(lista, /Sin grupo General conocido \(no les llega\): Sin Grupo/)
    assert.match(lista, /¿Mando\? Respondé citando OK \/ NO/)
    assert.ok(T.textoAgradecimiento('Ana', 'https://cal.test/x').includes('https://cal.test/x'))
  })
  test('Discord: menciona a Gero M por id y lleva el link del grupo (WhatsApp no tiene link a un mensaje)', () => {
    const t = T.textoDiscordTestimonio({ cliente: 'Ana', mencion: '123456789012345678', grupo: 'general', link: 'https://chat.whatsapp.com/abc', mensajeId: 'm1', fecha: '24/10/2026' })
    assert.ok(t.startsWith('<@123456789012345678> 🎥 **Ana** mandó su testimonio'))
    assert.ok(t.includes('https://chat.whatsapp.com/abc'))
    assert.ok(T.textoDiscordTestimonio({ cliente: 'Ana', mencion: null, grupo: 'contenido', link: null, mensajeId: 'm1', fecha: 'x' }).startsWith('Gero M'))
  })
})

describe('filtro barato y candidatos del webhook (puro)', () => {
  test('pareceResultado: resultados sí; "gracias" y cortesías no', () => {
    for (const t of ['Cerré 3 casos esta semana!!', 'me entraron muchas consultas', 'Excelente, no paran de escribirme chicos', 'firmamos 2 contratos', 'ya van 12 llamadas hoy']) assert.equal(F.pareceResultado(t), true, t)
    for (const t of ['gracias', 'Gracias!!', 'ok', 'dale', 'Perfecto', 'Excelente', 'genial 🙌', '👍', 'mañana lo grabo']) assert.equal(F.pareceResultado(t), false, t)
  })
  test('texto de un cliente en Contenido: candidato a Éxito Y a Guiones (conviven sin pisarse)', () => {
    const e = envio([msg({ text: { body: 'Cerré 3 casos esta semana' } })])
    const c = F.candidatosExito(e, GRUPOS, AHORA, equipo)
    assert.equal(c.mensajes.length, 1)
    assert.equal(c.mensajes[0].chatId, CONTENIDO)
    const g = G.candidatosGuiones(e, GRUPOS, AHORA, equipo)
    assert.equal(g.candidatos.length, 1)
    assert.equal(g.candidatos[0].mensaje_id, c.mensajes[0].mensajeId)
  })
  test('nunca: del equipo, del bot, de Ventas C.J., de un grupo del equipo, viejo o sin pasar el filtro', () => {
    const c = F.candidatosExito(envio([
      msg({ from: AYLU, text: { body: 'cerramos 3 casos' } }),
      msg({ from_me: true, source: 'api', text: { body: 'cerré casos' } }),
      msg({ chat_id: GRUPOS.ventas, text: { body: 'cerré 2 casos' } }),
      msg({ chat_id: OTRO, text: { body: 'cerré 2 casos' } }),
      msg({ timestamp: TS - 3 * 86400, text: { body: 'cerré 2 casos' } }),
      msg({ text: { body: 'gracias!' } }),
      msg({ chat_id: '5491100000000@s.whatsapp.net', text: { body: 'cerré casos' } }),
    ]), GRUPOS, AHORA, equipo, [OTRO])
    assert.equal(c.mensajes.length, 0)
    assert.deepEqual(c.descartes, { equipo: 1, propio: 1, grupo_equipo: 2, viejo: 1, filtro: 1, no_grupo: 1 })
  })
  test('videos (video, short o documento video/*) de un cliente: candidatos a testimonio; el pie, también a Éxito', () => {
    const c = F.candidatosExito(envio([
      msg({ type: 'video', video: { id: 'mp4-aa11-bb22', mime_type: 'video/mp4', seconds: 75, file_size: 9000000, caption: 'Acá va mi testimonio, cerré 5 casos' } }),
      msg({ type: 'document', document: { id: 'doc-1', mime_type: 'video/quicktime', file_name: 'testimonio.mov' } }),
      msg({ type: 'document', document: { id: 'doc-2', mime_type: 'application/pdf' } }),
      msg({ type: 'video', from: AYLU, video: { id: 'v-x', mime_type: 'video/mp4' } }),
    ]), GRUPOS, AHORA, equipo)
    assert.equal(c.videos.length, 2)
    assert.equal(c.videos[0].medio.segundos, 75)
    assert.equal(c.videos[1].medio.mime, 'video/quicktime')
    assert.equal(c.mensajes.length, 1)
  })
  test('Verificaciones: OK / NO citando → respuestas; sin cita o charla no; ecos de la API', () => {
    const c = F.candidatosExito(envio([
      msg({ chat_id: GRUPOS.verificaciones, from: TOMI, text: { body: 'OK' }, context: { quoted_id: 'pedido-1' } }),
      msg({ chat_id: GRUPOS.verificaciones, from: GERO_A, text: { body: 'no, todavía no' }, context: { quoted_id: 'pedido-2' } }),
      msg({ chat_id: GRUPOS.verificaciones, from: TOMI, text: { body: 'OK' } }),
      msg({ chat_id: GRUPOS.verificaciones, from: TOMI, text: { body: 'buen día' }, context: { quoted_id: 'x' } }),
      msg({ chat_id: GRUPOS.verificaciones, from_me: true, source: 'api', text: { body: '🏆 Éxito de cliente: Ana' } }),
    ]), GRUPOS, AHORA, equipo)
    assert.deepEqual(c.respuestas.map((r) => [r.citado, r.veredicto, r.resto]), [['pedido-1', 'ok', ''], ['pedido-2', 'no', 'todavía no']])
    assert.equal(c.ecos.length, 1)
    assert.equal(c.descartes.verificaciones, 2)
  })
  test('gruposEquipoExito: los WHAPI_GRUPO_* bien formados', () => {
    assert.deepEqual(F.gruposEquipoExito({ WHAPI_GRUPO_ADS: OTRO, WHAPI_GRUPO_CSM: 'mal', WHAPI_GRUPO_COPYWRITING: '120363000000000888@g.us' }), [OTRO, '120363000000000888@g.us'])
  })
})

describe('Claude (cliente falso)', () => {
  const falso = (respuesta) => ({ messages: { create: async (body) => { falso.ultimo = body; return respuesta } } })
  const ok = (j) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(j) }] })
  test('éxito: habla de resultados, son buenos y la confianza no es baja; la cita tiene que estar en el mensaje', async () => {
    const r = await CL.clasificarConClaude('Cerré 3 casos esta semana!', { cliente: falso(ok({ habla_de_resultados: true, resultados_buenos: true, confianza: 'alta', cita: 'Cerré 3 casos', motivo: 'casos' })) })
    assert.equal(r.exito, true)
    assert.equal(r.cita, 'Cerré 3 casos')
    assert.equal(falso.ultimo.model, CL.modeloExito())
    assert.equal(falso.ultimo.output_config.format.type, 'json_schema')
    const inventada = CL.leerSalidaExito({ habla_de_resultados: true, resultados_buenos: true, confianza: 'media', cita: 'otra cosa', motivo: '' }, 'me entraron 10 consultas')
    assert.equal(inventada.cita, 'me entraron 10 consultas')
    assert.equal(CL.leerSalidaExito({ habla_de_resultados: true, resultados_buenos: true, confianza: 'baja', cita: '', motivo: '' }, 'x').exito, false)
    assert.equal(CL.leerSalidaExito({ habla_de_resultados: true, resultados_buenos: false, confianza: 'alta', cita: '', motivo: '' }, 'x').exito, false)
  })
  test('rechazo, corte o JSON roto → error; sin clave → error sin salir a la red', async () => {
    await assert.rejects(CL.clasificarConClaude('x casos', { cliente: falso({ stop_reason: 'refusal', content: [] }) }), /rechazó/)
    await assert.rejects(CL.clasificarConClaude('x casos', { cliente: falso({ stop_reason: 'max_tokens', content: [] }) }), /max_tokens/)
    await assert.rejects(CL.clasificarConClaude('x casos', { cliente: falso({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no' }] }) }), /JSON/)
    await assert.rejects(CL.clasificarConClaude('x casos', {}), /BOT_ANTHROPIC_API_KEY/)
  })
})

describe('directorio de grupos de cliente (General, Ventas y Contenido)', () => {
  test('nombres de grupo: "General - X", "Ventas - X", "Contenido - X"', () => {
    assert.deepEqual(D.parsearNombreGrupo('General - Ana Pérez'), { grupo: 'general', cliente: 'Ana Pérez' })
    assert.deepEqual(D.parsearNombreGrupo('Contenido - Ana'), { grupo: 'contenido', cliente: 'Ana' })
    assert.equal(D.parsearNombreGrupo('Ventas C.J.'), null)
    assert.equal(D.parsearNombreGrupo('General - '), null)
  })
  test('fichas del motor: los 3 grupos, el ID del CRM como clave y el link de invitación', () => {
    const f = D.fichasDelMotor([{ nombre: 'Ana Pérez', id_crm: 'a123', general: GENERAL, ventas: VENTAS_C, contenido: CONTENIDO, invitacion: 'AbCdEf123', creado: '2026-10-01' }, { nombre: 'Seco', general: 'seco-1' }])
    assert.equal(f.length, 1)
    assert.equal(f[0].clave, 'A123')
    assert.deepEqual(f[0].grupos, { general: GENERAL, ventas: VENTAS_C, contenido: CONTENIDO })
    assert.equal(f[0].invitacionGeneral, 'https://chat.whatsapp.com/AbCdEf123')
  })
  const fuentes = (over = {}) => {
    const llamadas = { nombre: 0, lista: 0 }
    return {
      llamadas,
      f: {
        conWhapi: true, ahora: () => AHORA,
        filasMotor: async () => [{ nombre: 'Ana Pérez', id_crm: 'A123', general: GENERAL, ventas: VENTAS_C, contenido: CONTENIDO }],
        nombreGrupo: async (id) => { llamadas.nombre++; return { [OTRO]: 'Contenido - Luis Gómez', '120363000000000777@g.us': 'Familia' }[id] ?? null },
        listarGrupos: async () => { llamadas.lista++; return [{ id: '120363000000000555@g.us', nombre: 'General - Luis Gómez' }, { id: OTRO, nombre: 'Contenido - Luis Gómez' }] },
        ...over,
      },
    }
  }
  test('por el motor: cualquiera de los 3 grupos da la misma ficha, sin preguntar a Whapi', async () => {
    const { f, llamadas } = fuentes()
    const d = D.crearDirectorio(f)
    for (const [chat, g] of [[GENERAL, 'general'], [VENTAS_C, 'ventas'], [CONTENIDO, 'contenido']]) {
      const e = await d.deChat(chat)
      assert.equal(e.grupo, g)
      assert.equal(e.ficha.clave, 'A123')
      assert.equal(e.ficha.grupos.general, GENERAL)
    }
    assert.equal(llamadas.nombre, 0)
  })
  test('por el nombre (cliente de antes del bot): el General se busca en la lista de grupos; con caché', async () => {
    const { f, llamadas } = fuentes()
    const d = D.crearDirectorio(f)
    const e = await d.deChat(OTRO)
    assert.equal(e.grupo, 'contenido')
    assert.equal(e.ficha.cliente, 'Luis Gómez')
    assert.equal(e.ficha.grupos.general, '120363000000000555@g.us')
    await d.deChat(OTRO)
    assert.equal(llamadas.nombre, 1)
    assert.equal(await d.deChat('120363000000000777@g.us'), null)
    const todas = await d.todas()
    assert.deepEqual(todas.map((x) => x.cliente).sort(), ['Ana Pérez', 'Luis Gómez'])
  })
  test('sin Whapi (seco) solo cuenta el motor; si Whapi falla, no es de un cliente', async () => {
    const a = D.crearDirectorio(fuentes({ conWhapi: false }).f)
    assert.equal(await a.deChat(OTRO), null)
    const b = D.crearDirectorio(fuentes({ nombreGrupo: async () => { throw new Error('caído') } }).f)
    assert.equal(await b.deChat(OTRO), null)
  })
  test('fichaDeCliente: por ID, por nombre igual o por palabras si es la única; nunca adivina entre dos', () => {
    const fichas = [
      { clave: 'A1', cliente: 'Ana Pérez', idCrm: 'A1', grupos: { general: GENERAL }, invitacionGeneral: null, origen: 'motor' },
      { clave: 'n:luis gomez', cliente: 'Luis Gómez', idCrm: null, grupos: { general: OTRO }, invitacionGeneral: null, origen: 'nombre' },
      { clave: 'n:juan ruiz', cliente: 'Juan Ruiz', idCrm: null, grupos: {}, invitacionGeneral: null, origen: 'nombre' },
      { clave: 'n:juan ruiz 2', cliente: 'Juan Ruiz Díaz', idCrm: null, grupos: {}, invitacionGeneral: null, origen: 'nombre' },
    ]
    assert.equal(N.fichaDeCliente({ id: 'a1', nombre: 'otro' }, fichas).clave, 'A1')
    assert.equal(N.fichaDeCliente({ id: 'A9', nombre: 'LUIS GOMEZ' }, fichas).clave, 'n:luis gomez')
    assert.equal(N.fichaDeCliente({ id: 'A9', nombre: 'Luis Alberto Gómez' }, fichas).clave, 'n:luis gomez')
    assert.equal(N.fichaDeCliente({ id: 'A9', nombre: 'Juan Ruiz Díaz Pérez' }, fichas), null)
  })
})

// ── Núcleo con almacén en memoria, directorio fijo y Whapi / Claude / Discord falsos ──
const FICHA = { clave: 'A123', cliente: 'Ana Pérez', idCrm: 'A123', grupos: { general: GENERAL, ventas: VENTAS_C, contenido: CONTENIDO }, invitacionGeneral: 'https://chat.whatsapp.com/AbCd1234', origen: 'motor' }
function armar({ modo = 'real', caps = CFG.CAPACIDADES_EXITO, exito = true, sinId = false, fallaEnvio = null, sinDiscord = false, almacen = null, fichas = [FICHA], diasContento = 0, ambito, prueba = false, clasificar } = {}) {
  const reloj = { t: AHORA }
  const enviados = [], discord = [], claude = []
  const al = almacen ?? A.almacenExitoEnMemoria()
  const config = { ...CFG.configExito({}), modo, capacidades: new Set(modo === 'seco' ? [] : caps), aprobadores: [TOMI, GERO_A], verificaciones: GRUPOS.verificaciones, diasContento, prueba }
  const deps = {
    config, almacen: al, ambito,
    directorio: { deChat: async (chat) => { for (const f of fichas) for (const [g, id] of Object.entries(f.grupos)) if (id === chat) return { ficha: f, grupo: g }; return null }, todas: async () => fichas },
    async enviarTexto(p) {
      if (fallaEnvio && fallaEnvio(p)) { const e = fallaEnvio(p); throw e }
      enviados.push(p); return { id: sinId ? null : `wa-${enviados.length}` }
    },
    clasificar: modo === 'seco' ? undefined : clasificar ? async (t) => { claude.push(t); return clasificar(t) } : async (t) => { claude.push(t); if (exito === 'tira') throw new Error('Claude caído'); return { exito, hablaDeResultados: true, buenos: exito, confianza: 'alta', cita: t.slice(0, 40), motivo: '' } },
    discord: sinDiscord ? undefined : async (texto, menciones) => { discord.push({ texto, menciones }); return 'dc-1' },
    mencionGeroM: '100000000000000004', ahora: () => reloj.t, esperar: async () => {}, log: { info() {}, warn() {}, error() {} },
  }
  return { nucleo: N.crearNucleo(deps), al, enviados, discord, claude, reloj, deps }
}
const vacio = () => ({ mensajes: [], videos: [], respuestas: [], ecos: [], descartes: {} })
const mensaje = (texto = 'Cerré 3 casos esta semana', chat = CONTENIDO, id = `m-${++n}`, enviadoEn = new Date(AHORA - 60_000).toISOString()) => ({ ...vacio(), mensajes: [{ mensajeId: id, chatId: chat, texto, autor: { telefono: CLIENTE_TEL, lid: null, nombre: 'Ana' }, enviadoEn }] })
const respuesta = (citado, veredicto = 'ok', de = TOMI) => ({ ...vacio(), respuestas: [{ mensajeId: `r-${++n}`, citado, veredicto, resto: '', autor: { telefono: de, lid: null, nombre: 'Tomi' }, enviadoEn: new Date(AHORA).toISOString() }] })
const video = (chat = CONTENIDO, enviadoEn) => ({ ...vacio(), videos: [{ mensajeId: `v-${++n}`, chatId: chat, autor: { telefono: CLIENTE_TEL, lid: null, nombre: 'Ana' }, enviadoEn, medio: { id: 'mp4-aa', mime: 'video/mp4', segundos: 60, bytes: 1, pie: null } }] })

describe('núcleo: detección → pedido de OK → mensaje de testimonio → video', () => {
  test('seco: nada sale, no se llama a Claude y no se escribe nada', async () => {
    const x = armar({ modo: 'seco' })
    const r = await x.nucleo.procesarEventos(mensaje())
    assert.equal(x.enviados.length, 0)
    assert.equal(x.al._senales.length + x.al._pedidos.length, 0)
    assert.match(r.registro[0], /^seco:/)
  })
  test('real: éxito en Contenido → pedido corto en Verificaciones; el segundo mensaje no llama a Claude (pedido abierto)', async () => {
    const x = armar()
    const r = await x.nucleo.procesarEventos(mensaje())
    assert.equal(r.detectados, 1)
    assert.equal(r.pedidos, 1)
    assert.equal(x.enviados.length, 1)
    assert.equal(x.enviados[0].chatId, GRUPOS.verificaciones)
    assert.match(x.enviados[0].texto, /^🏆 Éxito de cliente: Ana Pérez\nEscribió en el grupo Contenido: "Cerré 3 casos/)
    assert.match(x.enviados[0].texto, /Respondé citando: OK \/ NO$/)
    assert.equal(x.al._pedidos[0].mensajePedidoId, 'wa-1')
    await x.nucleo.procesarEventos(mensaje('me entraron muchas consultas', VENTAS_C))
    assert.equal(x.claude.length, 1)
    assert.equal(x.al._pedidos.length, 1)
  })
  test('el mismo mensaje dos veces (reintento de Whapi): Claude una sola vez', async () => {
    const x = armar({ exito: false })
    const m = mensaje('cerré 3 casos', CONTENIDO, 'mismo-id')
    await x.nucleo.procesarEventos(m)
    await x.nucleo.procesarEventos(m)
    assert.equal(x.claude.length, 1)
  })
  test('tope de evaluaciones por cliente y día', async () => {
    const x = armar({ exito: false })
    for (let i = 0; i < CFG.MAX_CLAUDE_CLIENTE_DIA + 3; i++) await x.nucleo.procesarEventos(mensaje(`cerré ${i} casos`))
    assert.equal(x.claude.length, CFG.MAX_CLAUDE_CLIENTE_DIA)
  })
  test('Claude falla → señal con error, sin pedido; un grupo que no es de cliente se ignora', async () => {
    const x = armar({ exito: 'tira' })
    const r = await x.nucleo.procesarEventos(mensaje())
    assert.equal(r.pedidos, 0)
    assert.equal(x.al._senales[0].estado, 'error')
    const y = armar()
    await y.nucleo.procesarEventos(mensaje('cerré 3 casos', OTRO))
    assert.equal(y.claude.length, 0)
  })
  test('OK de un aprobador → el texto EXACTO al General y "Listo" en Verificaciones; OK de otro → nada', async () => {
    const x = armar()
    await x.nucleo.procesarEventos(mensaje())
    await x.nucleo.procesarEventos(respuesta('wa-1', 'ok', EXTRANO))
    assert.equal(x.al._pedidos[0].estado, 'abierto')
    assert.equal(x.enviados.length, 1)
    const r = await x.nucleo.procesarEventos(respuesta('wa-1', 'ok', GERO_A))
    assert.equal(r.aprobados, 1)
    assert.equal(x.enviados[1].chatId, GENERAL)
    assert.equal(x.enviados[1].texto, T.textoTestimonio('Ana Pérez', AHORA))
    assert.equal(x.enviados[2].chatId, GRUPOS.verificaciones)
    assert.match(x.enviados[2].texto, /^Listo: le mandé el mensaje de testimonio a Ana Pérez/)
    assert.equal(x.al._pedidos[0].estado, 'enviado')
    // Un segundo OK al mismo pedido no manda nada
    await x.nucleo.procesarEventos(respuesta('wa-1', 'ok', TOMI))
    assert.equal(x.enviados.length, 3)
  })
  test('una cita a otro mensaje (p. ej. un pedido del motor de altas) no es de esta etapa', async () => {
    const x = armar()
    const r = await x.nucleo.procesarEventos(respuesta('pedido-del-motor'))
    assert.equal(r.ignorados, 0)
    assert.equal(x.enviados.length, 0)
  })
  test('el video del cliente (en cualquiera de sus grupos) dentro de 30 días → agradecimiento con Calendly al General + Discord; una sola vez', async () => {
    const x = armar()
    await x.nucleo.procesarEventos(mensaje())
    await x.nucleo.procesarEventos(respuesta('wa-1'))
    // Un video ANTERIOR al mensaje de testimonio no cuenta
    await x.nucleo.procesarEventos(video(CONTENIDO, new Date(AHORA - DIA).toISOString()))
    assert.equal(x.al._testimonios.length, 0)
    x.reloj.t = AHORA + 2 * DIA
    const r = await x.nucleo.procesarEventos(video(VENTAS_C, new Date(AHORA + 2 * DIA - 1000).toISOString()))
    assert.equal(r.testimonios, 1)
    const agradecimiento = x.enviados.at(-1)
    assert.equal(agradecimiento.chatId, GENERAL)
    assert.ok(agradecimiento.texto.includes(CFG.URL_CALENDLY_POR_DEFECTO))
    assert.equal(agradecimiento.citar, null)   // el video vino por Ventas: no se cita desde el General
    assert.equal(x.discord.length, 1)
    assert.deepEqual(x.discord[0].menciones, ['100000000000000004'])
    assert.match(x.discord[0].texto, /Ana Pérez\*\* mandó su testimonio/)
    assert.match(x.discord[0].texto, /https:\/\/chat\.whatsapp\.com\/AbCd1234/)
    assert.equal(x.al._testimonios[0].estado, 'agradecido')
    assert.equal(x.al._testimonios[0].medio.mime, 'video/mp4')
    await x.nucleo.procesarEventos(video(GENERAL, new Date(AHORA + 2 * DIA).toISOString()))
    assert.equal(x.discord.length, 1)
    // Fuera de los 30 días, nada
    const y = armar()
    await y.nucleo.procesarEventos(mensaje())
    await y.nucleo.procesarEventos(respuesta('wa-1'))
    y.reloj.t = AHORA + 31 * DIA
    await y.nucleo.procesarEventos(video(GENERAL, new Date(y.reloj.t).toISOString()))
    assert.equal(y.al._testimonios.length, 0)
  })
  test('NO → rechazado: 30 días sin volver a pedir; enviado: 60 días', async () => {
    const x = armar()
    await x.nucleo.procesarEventos(mensaje())
    const r = await x.nucleo.procesarEventos(respuesta('wa-1', 'no'))
    assert.equal(r.rechazados, 1)
    x.reloj.t = AHORA + 29 * DIA
    await x.nucleo.procesarEventos(mensaje())
    assert.equal(x.al._pedidos.length, 1)
    x.reloj.t = AHORA + 31 * DIA
    await x.nucleo.procesarEventos(mensaje())
    assert.equal(x.al._pedidos.length, 2)
    const y = armar()
    await y.nucleo.procesarEventos(mensaje())
    await y.nucleo.procesarEventos(respuesta('wa-1'))
    y.reloj.t = AHORA + 59 * DIA
    await y.nucleo.procesarEventos(mensaje())
    assert.equal(y.al._pedidos.length, 1)
    y.reloj.t = AHORA + 61 * DIA
    await y.nucleo.procesarEventos(mensaje())
    assert.equal(y.al._pedidos.length, 2)
  })
  test('pedido sin id (Whapi no lo devolvió) → el eco lo recupera y el OK citado funciona', async () => {
    const x = armar({ sinId: true })
    await x.nucleo.procesarEventos(mensaje())
    assert.equal(x.al._pedidos[0].mensajePedidoId, null)
    const r = await x.nucleo.procesarEventos({ ...vacio(), ecos: [{ mensajeId: 'eco-77', texto: x.enviados[0].texto, enviadoEn: new Date(AHORA).toISOString() }] })
    assert.equal(r.ecos, 1)
    await x.nucleo.procesarEventos(respuesta('eco-77'))
    assert.equal(x.al._pedidos[0].estado, 'enviado')
  })
  test('envío dudoso del mensaje de testimonio → "dudoso" (cuenta como enviado) y aviso en Verificaciones', async () => {
    const x = armar({ fallaEnvio: (p) => (p.chatId === GENERAL ? Object.assign(new Error('Whapi enviarTexto: 524'), { tipo: 'dudoso', aplicado: null }) : null) })
    await x.nucleo.procesarEventos(mensaje())
    const r = await x.nucleo.procesarEventos(respuesta('wa-1'))
    assert.equal(x.al._pedidos[0].estado, 'dudoso')
    assert.equal(r.errores.length, 1)
    assert.match(x.enviados.at(-1).texto, /No sé si le llegó/)
  })
  test('real sin exito_mensaje_cliente: el OK queda "aprobado_simulado" y no sale nada al cliente', async () => {
    const x = armar({ caps: ['exito_pedido_ok'] })
    await x.nucleo.procesarEventos(mensaje())
    await x.nucleo.procesarEventos(respuesta('wa-1'))
    assert.equal(x.al._pedidos[0].estado, 'aprobado_simulado')
    assert.ok(x.enviados.every((e) => e.chatId === GRUPOS.verificaciones))
  })
  test('real sin exito_pedido_ok: no se pide nada ni se crea el pedido', async () => {
    const x = armar({ caps: ['exito_mensaje_cliente'] })
    const r = await x.nucleo.procesarEventos(mensaje())
    assert.equal(x.enviados.length, 0)
    assert.equal(x.al._pedidos.length, 0)
    assert.match(r.registro.join('\n'), /haría: pedir el OK/)
  })
  test('sin grupo General conocido no se pide el OK', async () => {
    const x = armar({ fichas: [{ ...FICHA, grupos: { contenido: CONTENIDO } }] })
    await x.nucleo.procesarEventos(mensaje())
    assert.equal(x.al._pedidos.length, 0)
  })
  test('ensayo: el pedido sale como SIMULACIÓN en Verificaciones; el OK no manda nada al cliente; el video deja un reporte', async () => {
    const x = armar({ modo: 'ensayo' })
    await x.nucleo.procesarEventos(mensaje())
    assert.ok(x.enviados[0].texto.startsWith('SIMULACIÓN — no se cargó nada\n\n🏆 Éxito de cliente'))
    await x.nucleo.procesarEventos(respuesta('wa-1'))
    assert.equal(x.al._pedidos[0].estado, 'aprobado_simulado')
    assert.equal(x.enviados.length, 1)
    await x.nucleo.procesarEventos(video(GENERAL, new Date(AHORA + 1000).toISOString()))
    assert.equal(x.enviados.length, 2)
    assert.equal(x.enviados[1].chatId, GRUPOS.verificaciones)
    assert.match(x.enviados[1].texto, /^SIMULACIÓN/)
    assert.equal(x.discord.length, 0)
  })
  test('dos mensajes a la vez del mismo cliente: un solo pedido (el almacén lo garantiza)', async () => {
    const x = armar()
    await Promise.all([x.nucleo.procesarEventos(mensaje('cerré 3 casos')), x.nucleo.procesarEventos(mensaje('entraron 10 consultas', VENTAS_C))])
    assert.equal(x.al._pedidos.filter((p) => p.estado === 'abierto').length, 1)
  })
  test('enLista es la misma regla que la del orquestador del motor', () => {
    const casos = [[{ telefono: '5491100000001', lid: null }, ['1100000001']], [{ telefono: null, lid: '123@lid' }, ['123@lid']], [{ telefono: '549110', lid: null }, ['549110']], [{ telefono: '5491100000009', lid: null }, [TOMI]]]
    for (const [a, l] of casos) assert.equal(N.enLista(a, l), enListaMotor(a, l), JSON.stringify([a, l]))
  })
})

describe('rondas de la encuesta: una respuesta vieja nunca cuenta para la ronda actual (puro)', () => {
  const ronda = (mes, enviadaEn, extra = {}) => ({ id: `${mes}:A123`, mes, clave: 'A123', idCrm: 'A123', cliente: 'Ana Pérez', general: GENERAL, estado: 'enviada', enviadaEn, mensajeId: null, recordatorioEn: null, recordatorioEstado: null, respondida: false, respuestaId: null, puntaje: null, respondidaEn: null, creado: enviadaEn, ...extra })
  const sep = ronda('2026-09', '2026-09-01T13:00:00.000Z'), oct = ronda('2026-10', '2026-10-01T13:00:00.000Z'), nov = ronda('2026-11', '2026-11-01T13:00:00.000Z')
  const resp = (clave, enviadaEn, valor = 9, idCliente = 'A123') => ({ clave, enviadaEn, valor, idCliente, quien: 'Ana Pérez · Estudio', motivo: null })
  test('cada respuesta va a la ronda cuyo envío es anterior y cuyo siguiente envío es posterior', () => {
    assert.equal(R2.rondaDeRespuesta([sep, oct, nov], '2026-11-02T15:00:00.000Z').id, '2026-11:A123')   // hoy
    assert.equal(R2.rondaDeRespuesta([sep, oct, nov], '2026-10-20T15:00:00.000Z').id, '2026-10:A123')   // el mes pasado
    assert.equal(R2.rondaDeRespuesta([sep, oct, nov], '2026-09-05T15:00:00.000Z').id, '2026-09:A123')   // hace dos meses
    assert.equal(R2.rondaDeRespuesta([sep, oct, nov], '2026-08-20T15:00:00.000Z'), null)                // antes del primer envío
    assert.equal(R2.rondaDeRespuesta([nov], '2026-11-01T12:59:59.000Z'), null)                         // minutos antes del envío
    assert.equal(R2.rondaDeRespuesta([nov], '2026-11-01T13:00:00.000Z').id, '2026-11:A123')
  })
  test('vínculos: respuesta de hoy, del mes pasado y de hace dos meses, cada una a su ronda; la vigente solo tiene la de hoy', () => {
    const v = R2.vinculos([sep, oct, nov], [resp('hoy', '2026-11-02T15:00:00.000Z', 6), resp('mes-pasado', '2026-10-20T15:00:00.000Z', 10), resp('dos-meses', '2026-09-05T15:00:00.000Z', 9)])
    assert.deepEqual(v.map((x) => [x.ronda.mes, x.respuesta.clave]).sort(), [['2026-09', 'dos-meses'], ['2026-10', 'mes-pasado'], ['2026-11', 'hoy']])
    // Sin respuesta este mes: la del mes pasado NO marca "respondió" en noviembre
    const solo = R2.vinculos([sep, oct, nov], [resp('mes-pasado', '2026-10-20T15:00:00.000Z', 10)])
    assert.deepEqual(solo.map((x) => x.ronda.mes), ['2026-10'])
    // Dos respuestas en la misma ronda: la primera; una ronda ya vinculada no cambia
    const dos = R2.vinculos([nov], [resp('b', '2026-11-03T10:00:00.000Z'), resp('a', '2026-11-02T10:00:00.000Z')])
    assert.deepEqual(dos.map((x) => x.respuesta.clave), ['a'])
    assert.equal(R2.vinculos([{ ...nov, respuestaId: 'ya' }], [resp('c', '2026-11-04T10:00:00.000Z')]).length, 0)
    // Sin cliente (dudosa) no se vincula
    assert.equal(R2.vinculos([nov], [resp('d', '2026-11-04T10:00:00.000Z', 9, null)]).length, 0)
  })
  test('ronda vigente: la última enviada de cada cliente', () => {
    assert.deepEqual(R2.rondasVigentes([nov, sep, oct]).map((x) => x.mes), ['2026-11'])
  })
  test('planilla → respuestas: hora de la columna Fecha (AR), Response ID, cruce por Nombre + Apellido + Estudio, dudosas', () => {
    const filas = [
      ['Fecha (AR)', 'Response ID', 'Nombre', 'Apellido', 'Estudio', 'Puntaje (0-10)', 'Área a mejorar', 'Qué cambiaría', 'Formulario', 'ID cliente (CRM)'],
      ['2/11/2026, 12:30:00', 'r1', 'Ána', 'PEREZ', 'Estudio Pérez', 9, '', '', 'Encuesta mensual de satisfacción', ''],
      ['2/11/2026, 12:30:00', 'r1', 'Ána', 'PEREZ', 'Estudio Pérez', 9, '', '', 'Encuesta mensual de satisfacción', ''],
      ['3/11/2026, 09:00:00', 'r2', 'Juan', 'Ruiz', '', 8, '', '', 'Encuesta mensual de satisfacción', ''],
      ['3/11/2026, 09:00:00', 'r3', 'Prueba', 'Test', '', 5, '', '', 'x', ''],
    ]
    const clientes = [{ id: 'A123', nombre: 'Ana Pérez', mail: '', celular: '' }, { id: 'A200', nombre: 'Juan Ruiz', mail: '', celular: '' }, { id: 'A201', nombre: 'Juan Ruiz Díaz', mail: '', celular: '' }]
    const r = R2.respuestasDeFilas(filas, clientes)
    assert.deepEqual(r.map((x) => [x.clave, x.idCliente, x.valor, x.enviadaEn]), [['r1', 'A123', 9, '2026-11-02T15:30:00.000Z'], ['r2', null, 8, '2026-11-03T12:00:00.000Z']])
    assert.equal(R2.instanteDeCelda('basura'), null)
  })
})

describe('cron diario: vencimientos, lista con OK, rondas, éxito por la encuesta, dudosas y recordatorio', () => {
  const CLIENTES = [{ id: 'A123', nombre: 'Ana Pérez', mail: '', celular: '' }, { id: 'A200', nombre: 'Sin Grupo', mail: '', celular: '' }]
  const LUIS = { ...FICHA, clave: 'A300', idCrm: 'A300', cliente: 'Luis Gómez', grupos: { general: OTRO } }
  const lectores = (respuestas = [], clientes = CLIENTES) => ({ clientesActivos: async () => clientes, respuestasTypeform: async () => respuestas })
  const dia1 = Date.parse('2026-11-01T13:00:00Z')   // 10:00 AR
  const resp = (clave, enviadaEn, valor = 9, idCliente = 'A123', quien = 'Ana Pérez · Estudio') => ({ clave, enviadaEn, valor, idCliente, quien, motivo: null })
  const okLista = async (x, texto = '', de = TOMI) => {
    const lote = x.al._lotes[0]
    return x.nucleo.procesarEventos({ ...vacio(), respuestas: [{ mensajeId: `r-${++n}`, citado: lote.mensajeId, veredicto: texto.startsWith('NO') ? 'no' : 'ok', resto: texto.replace(/^(OK|NO)\s*/, ''), autor: { telefono: de, lid: null, nombre: 'Tomi' }, enviadoEn: new Date(x.reloj.t).toISOString() }] })
  }
  test('seco: no lee el CRM ni manda nada', async () => {
    const x = armar({ modo: 'seco' })
    let leyo = false
    const r = await x.nucleo.correrDiario({ clientesActivos: async () => { leyo = true; return [] }, respuestasTypeform: async () => null })
    assert.equal(leyo, false)
    assert.match(r.registro[0], /^seco/)
  })
  test('vence los pedidos abiertos de más de 14 días', async () => {
    const x = armar()
    await x.nucleo.procesarEventos(mensaje())
    x.reloj.t = AHORA + 15 * DIA
    const r = await x.nucleo.correrDiario(lectores())
    assert.equal(r.vencidos, 1)
    assert.equal(x.al._pedidos[0].estado, 'vencido')
  })
  test('día 1: publica la lista de ACTIVOS en Verificaciones y NO manda nada sin el OK; una sola lista por mes', async () => {
    const x = armar()
    x.reloj.t = dia1
    await x.nucleo.correrDiario(lectores())
    assert.equal(x.enviados.length, 1)
    assert.equal(x.enviados[0].chatId, GRUPOS.verificaciones)
    assert.match(x.enviados[0].texto, /la mando a estos 1 clientes activos: Ana Pérez/)
    assert.match(x.enviados[0].texto, /Sin grupo General conocido \(no les llega\): Sin Grupo/)
    assert.equal(x.al._encuestas.length, 0)
    x.reloj.t = dia1 + DIA
    await x.nucleo.correrDiario(lectores())
    assert.equal(x.enviados.length, 1)
    // Otro día que no es el 1, sin lote, no publica (salvo ?lista=1)
    const y = armar()
    y.reloj.t = dia1 + 4 * DIA
    await y.nucleo.correrDiario(lectores())
    assert.equal(y.enviados.length, 0)
    await y.nucleo.correrDiario(lectores(), { forzarLista: true })
    assert.equal(y.enviados.length, 1)
  })
  test('OK de un aprobador → la encuesta (texto aprobado) a cada cliente del lote; una ronda por cliente; OK de otro no', async () => {
    const x = armar({ fichas: [FICHA, LUIS] })
    x.reloj.t = dia1
    await x.nucleo.correrDiario(lectores([], [...CLIENTES, { id: 'A300', nombre: 'Luis Gómez', mail: '', celular: '' }]))
    await okLista(x, 'OK', EXTRANO)
    assert.equal(x.al._lotes[0].estado, 'pedido')
    const r = await okLista(x, 'OK')
    assert.equal(r.encuestas, 2)
    const aClientes = x.enviados.filter((e) => e.chatId !== GRUPOS.verificaciones)
    assert.deepEqual(aClientes.map((e) => e.chatId).sort(), [GENERAL, OTRO].sort())
    assert.equal(aClientes.find((e) => e.chatId === GENERAL).texto, T.textoEncuesta('Ana Pérez', CFG.URL_TYPEFORM_POR_DEFECTO))
    assert.match(x.enviados.find((e) => e.chatId === GRUPOS.verificaciones && /^Listo/.test(e.texto)).texto, /mando la encuesta a 2 cliente/)
    assert.deepEqual(x.al._encuestas.map((e) => [e.id, e.estado, e.enviadaEn !== null]).sort(), [['2026-11:A123', 'enviada', true], ['2026-11:A300', 'enviada', true]])
    assert.equal(x.al._lotes[0].estado, 'completo')
    // El cron del día siguiente no vuelve a mandar
    x.reloj.t = dia1 + DIA
    await x.nucleo.correrDiario(lectores())
    assert.equal(x.enviados.filter((e) => e.chatId !== GRUPOS.verificaciones).length, 2)
  })
  test('"OK sin Luis Gómez" deja afuera a ese cliente; un nombre que no está en la lista frena y pregunta; NO no manda', async () => {
    const x = armar({ fichas: [FICHA, LUIS] })
    x.reloj.t = dia1
    const clientes = [...CLIENTES, { id: 'A300', nombre: 'Luis Gómez', mail: '', celular: '' }]
    await x.nucleo.correrDiario(lectores([], clientes))
    await okLista(x, 'OK sin Pedro Inexistente')
    assert.equal(x.al._lotes[0].estado, 'pedido')
    assert.match(x.enviados.at(-1).texto, /No encontré a Pedro Inexistente/)
    await okLista(x, 'OK menos luis gomez')
    assert.deepEqual(x.al._lotes[0].excluidos, ['A300'])
    assert.deepEqual(x.enviados.filter((e) => e.chatId !== GRUPOS.verificaciones).map((e) => e.chatId), [GENERAL])
    assert.deepEqual(N.exclusionesDe('sin A123 y Luis', [{ id: 'A123', nombre: 'Ana Pérez', general: GENERAL }, { id: 'A300', nombre: 'Luis Gómez', general: OTRO }]), { ids: ['A123', 'A300'], noEncontrados: [] })
    const y = armar()
    y.reloj.t = dia1
    await y.nucleo.correrDiario(lectores())
    await okLista(y, 'NO este mes no')
    assert.equal(y.al._lotes[0].estado, 'rechazado')
    assert.equal(y.enviados.length, 1)
  })
  const conRonda = async (respuestas = []) => {
    const x = armar()
    x.reloj.t = dia1
    await x.nucleo.correrDiario(lectores())
    await okLista(x, 'OK')
    return x
  }
  test('recordatorio a los 3 días solo si la ronda de este mes no tiene respuesta; la respuesta del mes pasado no cuenta', async () => {
    const x = await conRonda()
    x.reloj.t = dia1 + 2 * DIA
    await x.nucleo.correrDiario(lectores())
    const antes = x.enviados.length
    x.reloj.t = dia1 + 3 * DIA
    const sinPlanilla = await x.nucleo.correrDiario({ clientesActivos: async () => CLIENTES, respuestasTypeform: async () => null })
    assert.equal(x.enviados.length, antes)
    assert.match(sinPlanilla.registro.join('\n'), /sin la planilla del Typeform/)
    // Una respuesta del mes pasado (y otra de hace dos meses) NO marcan "respondió" en noviembre
    const r = await x.nucleo.correrDiario(lectores([resp('mes-pasado', '2026-10-20T15:00:00.000Z', 10), resp('dos-meses', '2026-09-05T15:00:00.000Z', 9)]))
    assert.equal(r.recordatorios, 1)
    assert.equal(x.enviados.at(-1).texto, T.textoRecordatorio('Ana Pérez', CFG.URL_TYPEFORM_POR_DEFECTO))
    assert.equal(x.al._encuestas[0].respuestaId, null)
    x.reloj.t = dia1 + 4 * DIA
    await x.nucleo.correrDiario(lectores())
    assert.equal(x.enviados.length, antes + 1)
    // Quien respondió en esta ronda no recibe recordatorio y la ronda guarda la respuesta y el puntaje
    const y = await conRonda()
    y.reloj.t = dia1 + 3 * DIA
    const antesY = y.enviados.length
    await y.nucleo.correrDiario(lectores([resp('hoy', new Date(dia1 + DIA).toISOString(), 6)]))
    assert.equal(y.enviados.length, antesY)
    assert.deepEqual([y.al._encuestas[0].respuestaId, y.al._encuestas[0].puntaje, y.al._encuestas[0].respondida], ['hoy', 6, true])
  })
  test('éxito por la encuesta: SOLO el puntaje de la ronda vigente (8+); un 10 del mes pasado no cuenta', async () => {
    const x = await conRonda()
    x.reloj.t = dia1 + DIA
    let r = await x.nucleo.correrDiario(lectores([resp('mes-pasado', '2026-10-20T15:00:00.000Z', 10)]))
    assert.equal(r.pedidos, 0)
    r = await x.nucleo.correrDiario(lectores([resp('hoy', new Date(dia1 + 3600_000).toISOString(), 9)]))
    assert.equal(r.pedidos, 1)
    const pedido = x.al._pedidos[0]
    assert.equal(pedido.motivo.tipo, 'encuesta')
    assert.equal(pedido.motivo.puntaje, 9)
    // Al día siguiente no vuelve a pedir por la misma ronda
    x.reloj.t = dia1 + 2 * DIA
    await x.nucleo.correrDiario(lectores([resp('hoy', new Date(dia1 + 3600_000).toISOString(), 9)]))
    assert.equal(x.al._pedidos.length, 1)
    // Un 7 en la ronda vigente no es éxito
    const y = await conRonda()
    y.reloj.t = dia1 + DIA
    assert.equal((await y.nucleo.correrDiario(lectores([resp('hoy', new Date(dia1 + 3600_000).toISOString(), 7)]))).pedidos, 0)
  })
  test('respuesta dudosa (no cruza con un único cliente) de la ronda vigente → consulta en Verificaciones; "OK A123" la asigna y el próximo cron la vincula', async () => {
    const x = await conRonda()
    x.reloj.t = dia1 + DIA
    const dudosa = resp('dud-1', new Date(dia1 + 3600_000).toISOString(), 9, null, 'Ana P. · Estudio')
    const vieja = resp('dud-vieja', '2026-10-10T15:00:00.000Z', 9, null, 'Alguien · Viejo')
    await x.nucleo.correrDiario(lectores([dudosa, vieja]))
    const consulta = x.enviados.at(-1)
    assert.match(consulta.texto, /^📋 Encuesta: no sé de qué cliente es esta respuesta\.\nAna P\. · Estudio · 9\/10/)
    assert.equal(x.al._senales.filter((s) => s.tipo === 'dudosa').length, 1)   // la vieja ni se consulta
    await x.nucleo.procesarEventos({ ...vacio(), respuestas: [{ mensajeId: 'r-dud', citado: 'wa-' + x.enviados.length, veredicto: 'ok', resto: 'A123', autor: { telefono: GERO_A, lid: null, nombre: 'Gero' }, enviadoEn: new Date(x.reloj.t).toISOString() }] })
    assert.equal(x.al._senales.find((s) => s.tipo === 'dudosa').estado, 'asignada')
    x.reloj.t = dia1 + 2 * DIA
    const r = await x.nucleo.correrDiario(lectores([dudosa]))
    assert.equal(x.al._encuestas[0].respuestaId, 'dud-1')
    assert.equal(r.pedidos, 1)
  })
  test('ensayo: la lista sale como SIMULACIÓN y el OK no manda nada a los clientes', async () => {
    const x = armar({ modo: 'ensayo' })
    x.reloj.t = dia1
    await x.nucleo.correrDiario(lectores())
    assert.match(x.enviados[0].texto, /^SIMULACIÓN — no se cargó nada\n\n📋 Encuesta mensual/)
    await okLista(x, 'OK')
    assert.ok(x.enviados.every((e) => e.chatId === GRUPOS.verificaciones))
    assert.equal(x.al._encuestas.length, 0)
  })
  test('?dry=1 (almacén de solo lectura y sin capacidades): no manda ni escribe', async () => {
    const base = A.almacenExitoEnMemoria()
    const env = { BOT_EXITO_MODO: 'real', BOT_EXITO_CAPACIDADES: CFG.CAPACIDADES_EXITO.join(','), WHAPI_GRUPO_VERIFICACIONES: GRUPOS.verificaciones, BOT_ALTA_APROBADORES: TOMI }
    const r = await S.correrDiarioReal({ env, almacen: base, dry: true, ahora: () => dia1, lectores: lectores([resp('x', new Date(dia1).toISOString(), 10)]), log: { info() {}, warn() {}, error() {} } })
    assert.equal(r.modo, 'ensayo')
    assert.equal(base._pedidos.length + base._encuestas.length + base._senales.length + base._lotes.length, 0)
    assert.equal(r.encuestas + r.pedidos, 0)
  })
})

describe('integración con el webhook de Whapi (ruta.ts)', () => {
  const SECRETO = 'Secreto-De-Prueba-1234567890-abcdefgh'
  const env = { WHAPI_WEBHOOK_SECRETO: SECRETO, WHAPI_GRUPO_VENTAS: GRUPOS.ventas, WHAPI_GRUPO_VERIFICACIONES: GRUPOS.verificaciones, BOT_ALTA_EQUIPO_TELEFONOS: JSON.stringify({ Aylu: AYLU }) }
  const motorJuguete = (falla = false) => ({ crear: () => ({ modo: 'seco', registrar: async () => { if (falla) throw new Error('caída'); return { nuevos: [], repetidos: [] } }, procesar: async () => ({ altas: [], continuaciones: 0, errores: [], registro: [] }), avanzar: async () => ({}), barrer: async () => ({}) }) })
  const pedir = (cuerpo) => new Request('https://despacho.test/api/bot/whapi', { method: 'POST', headers: { 'x-cj-bot-secreto': SECRETO, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const armarRuta = (falla = false) => {
    const tareas = [], llamadas = []
    const deps = { crearMotor: motorJuguete(falla).crear, clienteWhapi: () => ({}), env, ahora: () => AHORA, log: { info() {}, warn() {}, error() {} }, programar: (t) => tareas.push(t), procesarExito: async (c, o) => { llamadas.push({ c, o }); return null } }
    return { deps, tareas, llamadas }
  }
  test('un resultado en Contenido se programa para Éxito en after(), con los candidatos ya filtrados', async () => {
    const x = armarRuta()
    const res = await R.atenderWebhook(pedir(envio([msg({ text: { body: 'cerré 4 casos' } }), msg({ from: AYLU, text: { body: 'cerramos casos' } })])), x.deps)
    assert.equal(res.status, 200)
    for (const t of x.tareas) await t()
    assert.equal(x.llamadas.length, 1)
    assert.equal(x.llamadas[0].c.mensajes.length, 1)
  })
  test('sin candidatos no se programa nada; con el motor caído (503) igual se programa', async () => {
    const x = armarRuta()
    await R.atenderWebhook(pedir(envio([msg({ text: { body: 'gracias!' } })])), x.deps)
    for (const t of x.tareas) await t()
    assert.equal(x.llamadas.length, 0)
    const y = armarRuta(true)
    const res = await R.atenderWebhook(pedir(envio([msg({ chat_id: GRUPOS.ventas, text: { body: '#ALTA\nNombre completo: X' } }), msg({ text: { body: 'cerré 4 casos' } })])), y.deps)
    assert.equal(res.status, 503)
    for (const t of y.tareas) await t()
    assert.equal(y.llamadas.length, 1)
  })
  test('sin el secreto correcto no se programa nada', async () => {
    const x = armarRuta()
    const req = new Request('https://despacho.test/api/bot/whapi', { method: 'POST', headers: { 'x-cj-bot-secreto': 'otro' }, body: JSON.stringify(envio([msg({ text: { body: 'cerré 4 casos' } })])) })
    assert.equal((await R.atenderWebhook(req, x.deps)).status, 401)
    assert.equal(x.tareas.length, 0)
  })
  test('la ruta de Next pasa procesarExitoReal', () => {
    assert.match(readFileSync(join(RAIZ, 'app/api/bot/whapi/route.ts'), 'utf8'), /procesarExito: procesarExitoReal/)
  })
  test('procesarExitoReal: en seco, con BOT_EXITO=no o sin base no hace nada (y no sale a la red)', async () => {
    const c = F.candidatosExito(envio([msg({ text: { body: 'cerré 4 casos' } })]), GRUPOS, AHORA, equipo)
    const log = { info() {}, warn() {}, error() {} }
    assert.equal(await S.procesarExitoReal(c, { env: { DATABASE_URL: 'postgres://x.invalid/db' }, log }), null)
    assert.equal(await S.procesarExitoReal(c, { env: { BOT_EXITO: 'no', BOT_EXITO_MODO: 'real' }, log }), null)
    assert.equal(await S.procesarExitoReal(c, { env: { BOT_EXITO_MODO: 'real' }, log }), null)
  })
})

describe('/api/bot/exito (ruta.ts de la etapa) y lectura para la cartera', () => {
  const h = (v) => ({ get: (k) => (k === 'authorization' ? v : null) })
  test('solo Bearer CRON_SECRET, falla cerrado', () => {
    assert.deepEqual(RE.autorizarExito(h('Bearer x'), {}), { ok: false, status: 503 })
    assert.deepEqual(RE.autorizarExito(h('Bearer otro'), { CRON_SECRET: 'secreto-1' }), { ok: false, status: 401 })
    assert.deepEqual(RE.autorizarExito(h(null), { CRON_SECRET: 'secreto-1' }), { ok: false, status: 401 })
    assert.deepEqual(RE.autorizarExito(h('Bearer secreto-1'), { CRON_SECRET: 'secreto-1' }), { ok: true })
  })
  test('?estado=1: modo, faltantes (nombres) y el estado por cliente; sin base, 503 para correr', async () => {
    const al = A.almacenExitoEnMemoria()
    await al.crearPedido({ id: 'p1', clave: 'A123', cliente: 'Ana', idCrm: 'A123', general: GENERAL, invitacion: null, motivo: { tipo: 'encuesta', puntaje: 9, fecha: null }, modo: 'real', mensajePedidoId: 'w1', huella: 'h', creado: new Date(AHORA).toISOString() })
    const r = await RE.atenderExito(new URLSearchParams('estado=1'), { env: {}, almacen: al })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.modo, 'seco')
    assert.deepEqual(r.cuerpo.clientes.map((x) => [x.idCrm, x.estado]), [['A123', 'pedido_abierto']])
    assert.equal(JSON.stringify(r.cuerpo).includes('postgres'), false)
    assert.equal((await RE.atenderExito(new URLSearchParams(''), { env: {} })).status, 503)
  })
  test('estado por cliente: testimonio recibido, rechazado, simulado', () => {
    const base = { id: 'p', clave: 'A1', cliente: 'Ana', idCrm: 'A1', general: GENERAL, invitacion: null, motivo: { tipo: 'mensaje', cita: '', grupo: 'general' }, modo: 'real', mensajePedidoId: null, huella: 'h', por: null, respuesta: null, mensajeClienteId: null, resuelto: null, testimonioMensaje: null, testimonioEn: null, error: null, creado: '2026-10-01T00:00:00Z', actualizado: '2026-10-01T00:00:00Z' }
    assert.equal(L.estadoDePedido({ ...base, estado: 'enviado', testimonioMensaje: 'v1' }), 'testimonio_recibido')
    assert.equal(L.estadoDePedido({ ...base, estado: 'enviado' }), 'testimonio_pedido')
    assert.equal(L.estadoDePedido({ ...base, estado: 'rechazado' }), 'rechazado')
    assert.equal(L.estadoDePedido({ ...base, estado: 'aprobado_simulado' }), 'simulado')
    const r = L.resumirPedidos([{ ...base, estado: 'vencido' }, { ...base, id: 'p2', estado: 'abierto', creado: '2026-10-20T00:00:00Z' }])
    assert.deepEqual(r.clientes.map((x) => x.estado), ['pedido_abierto'])
  })
})

describe('almacén en Neon (cliente SQL falso) y script de migración', () => {
  const sqlFalso = (sentencias, respuesta = async () => []) => {
    const q = (strings, ...vals) => {
      const t = strings.reduce((a, s, i) => a + s + (i < vals.length ? (vals[i] && typeof vals[i] === 'object' && 'raw' in vals[i] ? vals[i].raw : `$${i + 1}`) : ''), '')
      sentencias.push(t.replace(/\s+/g, ' ').trim())
      return respuesta(t, vals)
    }
    q.unsafe = (raw) => ({ raw })
    q.query = async () => []
    return q
  }
  test('la primera escritura crea las 4 tablas y el índice único de "un pedido abierto por cliente"', async () => {
    const s = []
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    AN.sqlExitoParaPruebas(() => sqlFalso(s, async (t) => (/RETURNING/.test(t) ? [{ id: 'x' }] : [])))
    try {
      assert.equal(await AN.almacenExitoNeon().reclamarSenal({ id: 'm:1', tipo: 'mensaje', clave: 'A1', chatId: GENERAL, detalle: {} }, new Date(AHORA).toISOString()), true)
      for (const t of AN.TABLAS_EXITO) assert.ok(s.some((x) => x.startsWith(`CREATE TABLE IF NOT EXISTS ${t}`)), t)
      assert.ok(s.some((x) => /CREATE UNIQUE INDEX IF NOT EXISTS cj_exito_pedidos_uno_abierto ON cj_exito_pedidos \(clave\) WHERE estado IN \('abierto', 'aprobado'\)/.test(x)))
      assert.ok(!s.some((x) => /DROP|ALTER TABLE .* TYPE/i.test(x)))
    } finally { AN.sqlExitoParaPruebas(null); delete process.env.DATABASE_URL }
  })
  test('crearPedido con el índice único violado (23505) → false; una lectura sin tabla (42P01) → vacía', async () => {
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    AN.sqlExitoParaPruebas(() => sqlFalso([], async (t) => {
      if (/INSERT INTO cj_exito_pedidos/.test(t)) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      if (/SELECT/.test(t)) throw Object.assign(new Error('relation "cj_exito_pedidos" does not exist'), { code: '42P01' })
      return []
    }))
    try {
      const a = AN.almacenExitoNeon()
      assert.equal(await a.crearPedido({ id: 'p1', clave: 'A1', cliente: 'Ana', idCrm: null, general: GENERAL, invitacion: null, motivo: { tipo: 'encuesta', puntaje: 9, fecha: null }, modo: 'real', mensajePedidoId: null, huella: 'h', creado: new Date(AHORA).toISOString() }), false)
      assert.equal(await a.bloqueo('A1', AHORA), null)
      assert.deepEqual(await a.listarPedidos(10), [])
    } finally { AN.sqlExitoParaPruebas(null); delete process.env.DATABASE_URL }
  })
  test('actualizarPedido con estado esperado: reclamo atómico; las columnas salen de una lista fija', async () => {
    const s = []
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    AN.sqlExitoParaPruebas(() => sqlFalso(s, async (t) => (/RETURNING/.test(t) ? [{ id: 'p1' }] : [])))
    try {
      assert.equal(await AN.almacenExitoNeon().actualizarPedido('p1', { estado: 'rechazado', por: 'Tomi', inventada: 'x' }, ['abierto']), true)
      assert.ok(s.some((x) => /UPDATE cj_exito_pedidos SET estado = COALESCE\(\$1, estado\).*estado = ANY\(\$3::text\[\]\) RETURNING id/.test(x)))
      assert.ok(s.some((x) => x === 'UPDATE cj_exito_pedidos SET por = $3 WHERE id = $5'))
      assert.ok(!s.some((x) => x.includes('inventada')))
    } finally { AN.sqlExitoParaPruebas(null); delete process.env.DATABASE_URL }
  })
  test('scripts/bot-exito-migrar.mjs: simula sin base; --real sin DATABASE_URL falla; args raros', async () => {
    const out = []
    assert.equal(await MIG.main([], { salida: (t) => out.push(t) }), 0)
    assert.ok(out.join('\n').includes('CREATE TABLE IF NOT EXISTS cj_exito_pedidos'))
    assert.equal(await MIG.main(['--real'], { salida: () => {} }), 1)
    assert.equal(await MIG.main(['--confirmar'], { salida: () => {} }), 1)
    assert.equal(await MIG.main(['--x'], { salida: () => {} }), 1)
    const s = []
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    try {
      assert.equal(await MIG.main(['--real'], { salida: (t) => out.push(t), crearSql: () => sqlFalso(s, async () => [{ table_name: 'cj_exito_senales' }]) }), 0)
      assert.match(out.at(-2), /Faltan: cj_exito_pedidos, cj_exito_testimonios, cj_exito_encuestas, cj_exito_lotes/)
    } finally { delete process.env.DATABASE_URL }
  })
})

describe('documentación', () => {
  const doc = readFileSync(join(RAIZ, 'docs', 'BOT-EXITO-CJ.md'), 'utf8')
  test('trae el texto exacto del testimonio, los textos a aprobar y todas las variables y capacidades', () => {
    assert.ok(doc.includes(T.TEXTO_TESTIMONIO.split('\n')[0]))
    assert.ok(doc.includes('## Textos'))
    assert.ok(doc.includes('## Variables'))
    assert.ok(doc.includes(T.TEXTO_ENCUESTA.split('\n')[0]))
    assert.ok(doc.includes('bnvnMvVn'))
    for (const k of ['BOT_EXITO_MODO', 'BOT_EXITO_CAPACIDADES', 'BOT_EXITO', 'EXITO_CALENDLY_URL', 'EXITO_TYPEFORM_URL', 'EXITO_ENCUESTA_DIA', 'BOT_EXITO_MODELO', 'DISCORD_WEBHOOK_CLIENTES', 'DISCORD_ID_GERO_M', 'BOT_ALTA_APROBADORES', ...CFG.CAPACIDADES_EXITO]) assert.ok(doc.includes(`\`${k}\``), k)
    assert.ok(doc.includes('`/api/bot/exito`'))
    assert.ok(doc.includes('leerEstadoExito'))
  })
  test('vercel.json tiene el cron diario de la etapa, sin query', () => {
    const c = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons.find((x) => x.path.startsWith('/api/bot/exito'))
    assert.deepEqual(c, { path: '/api/bot/exito', schedule: '0 13 * * *' })
  })
})
