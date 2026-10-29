// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-bajas.mjs
// Etapa BAJA DEL CLIENTE del bot "Capital Jurídico" (lib/bot/bajas/*, docs/BOT-BAJAS-CJ.md).
// SIN red ni base: el fetch global está bloqueado, Whapi / Claude / Discord / CRM son falsos y el almacén es el de memoria (o un
// cliente SQL falso para la versión de Neon). Los teléfonos, nombres, ids y secretos de acá son inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

for (const k of Object.keys(process.env)) {
  if (/^(WHAPI_|BOT_ALTA_|BOT_BAJAS|BAJA_|DISCORD_|FATHOM_)/.test(k) || ['CRON_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'BOT_ANTHROPIC_API_KEY', 'SHEET_ID_CLIENTES', 'SHEET_ID_TYPEFORM'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const CFG = await import('../lib/bot/bajas/config.ts')
const T = await import('../lib/bot/bajas/textos.ts')
const FIN = await import('../lib/bot/bajas/fin.ts')
const G = await import('../lib/bot/bajas/grupos.ts')
const F = await import('../lib/bot/bajas/filtro.ts')
const CL = await import('../lib/bot/bajas/claude.ts')
const CRM = await import('../lib/bot/bajas/crm.ts')
const A = await import('../lib/bot/bajas/almacen.ts')
const AN = await import('../lib/bot/bajas/almacenNeon.ts')
const N = await import('../lib/bot/bajas/nucleo.ts')
const S = await import('../lib/bot/bajas/servidor.ts')
const { conArchivadosActuales } = await import('../lib/clientes/archivados.ts')
const RB = await import('../lib/bot/bajas/ruta.ts')
const L = await import('../lib/bot/bajas/lectura.ts')
const R = await import('../lib/bot/whapi/ruta.ts')
const W = await import('../lib/bot/whapi/cliente.ts')
// WhatsApp seguro (26/10/2026): la guardia de salud (GET /health antes de cada escritura) tiene sus propios tests
// (scripts/test-whatsapp-seguro.mjs); acá queda abierta para no romper los fetch falsos que cuentan pedidos
;(await import('../lib/bot/whapi/salud.ts')).fijarGuardiaParaPruebas((await import('../lib/bot/whapi/salud.ts')).GUARDIA_ABIERTA)
const MIG = await import('./bot-bajas-migrar.mjs')
const ME = await import('../lib/bot/bajas/meta.ts')
const PU = await import('../lib/bot/alta/puenteDrive.ts')
const { validarReunion } = await import('../lib/fathomAnuncios/tipos.ts')
const { enLista: enListaMotor } = await import('../lib/bot/alta/motor/orquestador.ts')

const RAIZ = fileURLToPath(new URL('../', import.meta.url))
const VERIF = '120363000000000002@g.us', VENTAS_CJ = '120363000000000001@g.us'
const GRUPOS = { ventas: VENTAS_CJ, verificaciones: VERIF }
const GENERAL = '120363000000000101@g.us', VENTAS_C = '120363000000000102@g.us', CONTENIDO = '120363000000000103@g.us'
const CLIENTE_TEL = '5491155550099', SOCIO_TEL = '5491155550088', TOMI = '5491100000001', GERO_A = '5491100000002', AYLU = '5491100000003', EXTRANO = '5491100000009', BOT = '5491100000000'
const CAL = 'https://calendly.com/tomi-prueba/renovacion'
const AHORA = Date.parse('2026-11-01T13:30:00Z')   // 10:30 de Argentina, día 1
const DIA = 86_400_000
const TS = Math.floor(AHORA / 1000) - 30
const SILENCIO = { info() {}, warn() {}, error() {} }
const TODAS = ['baja_aviso_fin', 'baja_mensaje_cliente', 'baja_fathom', 'baja_quitar_grupos', 'baja_aviso_skool', 'baja_crm', 'baja_recontacto']
let n = 0
const msg = (over = {}) => ({ id: `msg-${++n}-AbCd`, from_me: false, type: 'text', chat_id: VERIF, timestamp: TS, source: 'mobile', text: { body: 'hola' }, from: TOMI, from_name: 'Tomi', ...over })
const envio = (messages) => ({ messages, event: { type: 'messages', event: 'post' }, channel_id: 'MANTIS-PRUEBA1' })
const responde = (citado, from, body) => F.candidatosBajas(envio([msg({ from, text: { body }, context: { quoted_id: citado } })]), GRUPOS, AHORA)

const cliente = (over = {}) => ({ id: 'A100', nombre: 'Ana Pérez', estado: 'ACTIVO', linea: 'agencia', mail: 'ana@estudio.test', celular: CLIENTE_TEL, dia1: '2026-07-14', finPeriodo: '2026-11-11', periodos: [], fechaBaja: null, satisfaccion: 7, esNoCliente: false, ...over })
const CLIENTES = [
  cliente(),
  cliente({ id: 'A101', nombre: 'Luis Gómez', mail: 'luis@x.test', finPeriodo: '2026-12-20' }),
  cliente({ id: 'A102', nombre: 'Marta Ruiz', estado: 'FINALIZADO', mail: 'marta@x.test', finPeriodo: '2026-09-01', fechaBaja: '2026-09-01', satisfaccion: 9 }),
  cliente({ id: 'A103', nombre: 'Pedro Sosa', estado: 'INACTIVO', finPeriodo: '2025-08-01', fechaBaja: '2025-08-01' }),
  cliente({ id: 'A104', nombre: 'Laura Díaz', estado: 'FINALIZADO', finPeriodo: '2026-07-15', fechaBaja: null, satisfaccion: 4 }),
  cliente({ id: 'C001', nombre: 'Consultora X', linea: 'consultora', finPeriodo: '2026-11-05' }),
]
const COMUNIDAD = '120363000000000100@g.us', CARPETA = 'fixture-google-id-000000000000000000000009'
const FICHA_ANA = { cliente: 'Ana Pérez', idCrm: 'A100', grupos: { general: GENERAL, ventas: VENTAS_C, contenido: CONTENIDO }, origen: 'motor', comunidad: COMUNIDAD, carpeta: CARPETA, correos: ['ana@estudio.test', 'socio@estudio.test', 'aylu@skyward.test'] }
const PARTICIPANTES = {
  [GENERAL]: [{ id: BOT, rango: 'creador' }, { id: TOMI, rango: 'admin' }, { id: AYLU, rango: 'miembro' }, { id: CLIENTE_TEL, rango: 'miembro' }, { id: SOCIO_TEL, rango: 'miembro' }],
  [VENTAS_C]: [{ id: BOT, rango: 'creador' }, { id: CLIENTE_TEL, rango: 'miembro' }],
  [CONTENIDO]: [{ id: BOT, rango: 'creador' }, { id: GERO_A, rango: 'miembro' }],
}

function armar(op = {}) {
  const env = { BOT_BAJAS_MODO: op.modo ?? 'real', BOT_BAJAS_CAPACIDADES: (op.caps ?? TODAS).join(','), BOT_ALTA_APROBADORES: `${TOMI},${GERO_A}`, BAJA_APROBADORES_DESPEDIDA: AYLU, WHAPI_GRUPO_VERIFICACIONES: VERIF, BAJA_CALENDLY_URL: CAL, ...(op.env ?? {}) }
  const almacen = op.almacen ?? A.almacenBajasEnMemoria()
  const enviados = [], quitados = [], discord = [], crm = [], orden = [], clasificadas = []
  let reloj = op.ahora ?? AHORA
  const deps = {
    config: CFG.configBajas(env),
    almacen,
    grupos: { deCliente: async (id) => (id === 'A100' ? FICHA_ANA : op.fichas?.[id] ?? null) },
    enviarTexto: async (p) => {
      const f = op.fallaEnvio?.(p)
      if (f) throw f
      enviados.push(p); orden.push(`texto:${p.chatId}`)
      return { id: op.sinId ? null : `out-${enviados.length}` }
    },
    participantes: async (chat) => op.participantes?.[chat] ?? PARTICIPANTES[chat] ?? [],
    quitar: async (chat, ids) => { orden.push(`quitar:${chat}`); quitados.push({ chat, ids }); if (op.fallaQuitar) throw Object.assign(new Error('no'), { aplicado: false }); return { quitados: ids, fallidos: [] } },
    clasificar: op.clasificar === null ? undefined : async (p) => { clasificadas.push(p); return op.clasificar ? op.clasificar(p) : { esRenovacion: true, decision: 'no_renueva', confianza: 'alta', cita: 'no voy a renovar', motivo: 'no sigue', motivoBaja: 'el precio' } },
    discord: async (t, m) => { discord.push({ t, m }); return `d-${discord.length}` },
    crm: async (p, modo) => { crm.push({ p, modo }); return op.crm ? op.crm(p, modo) : { estado: modo === 'real' ? 'hecho' : 'simulado', fila: 10, detalle: `fila 10 ${modo}`, escrituras: [] } },
    leerClientes: async () => op.clientes ?? CLIENTES,
    puntajes: op.puntajes ? async () => op.puntajes : undefined,
    meta: op.meta,
    quitarAccesoDrive: op.drive,
    eliminarComunidad: op.comunidad,
    buscarComunidad: op.buscarComunidad,
    mencionAylu: '777777777777777777',
    equipo: new Set([TOMI, GERO_A, AYLU]),
    ahora: () => reloj,
    esperar: async (ms) => { orden.push(`espera:${ms}`) },
    log: SILENCIO,
  }
  return { deps, N: N.crearNucleoBajas(deps), almacen, enviados, quitados, discord, crm, orden, clasificadas, mover: (ms) => { reloj += ms } }
}
const pedidoDe = (x, tipo) => x.almacen._pedidos.find((p) => p.tipo === tipo)
const reunion = (over = {}) => validarReunion({
  recording_id: 555001, url: 'https://fathom.video/calls/555001', share_url: 'https://fathom.video/share/abc', title: 'Ana Pérez y Tomas Napolitano',
  recording_start_time: '2026-10-30T15:00:00Z', calendar_invitees: [{ name: 'Ana', email: 'ana@estudio.test', is_external: true }],
  transcript: [{ speaker: { display_name: 'Ana' }, text: 'Mirá Tomi, no voy a renovar por ahora.', timestamp: '00:10:00' }], ...over,
}).reunion

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('config: nace en seco y las capacidades se respetan', () => {
  test('sin variables: seco, sin capacidades, sin Calendly, recontacto el día 1', () => {
    const c = CFG.configBajas({})
    assert.equal(c.modo, 'seco'); assert.equal(c.capacidades.size, 0); assert.equal(c.calendlyUrl, ''); assert.equal(c.diaRecontacto, 1)
  })
  test('modo mal escrito → seco; seco ignora las capacidades; nombres raros se ignoran', () => {
    assert.equal(CFG.modoBajas({ BOT_BAJAS_MODO: 'REAL' }), 'seco')
    assert.equal(CFG.capacidadesBajas('seco', { BOT_BAJAS_CAPACIDADES: 'baja_crm' }).size, 0)
    assert.deepEqual([...CFG.capacidadesBajas('real', { BOT_BAJAS_CAPACIDADES: 'baja_crm, otra' })], ['baja_crm'])
    assert.deepEqual(CFG.capacidadesBajasDesconocidas({ BOT_BAJAS_CAPACIDADES: 'baja_crm, otra' }), ['otra'])
  })
  test('ensayo: solo reportes (aviso, fathom, recontacto); nunca mensajes al cliente, grupos ni CRM', () => {
    const caps = CFG.capacidadesBajas('ensayo', { BOT_BAJAS_CAPACIDADES: TODAS.join(',') })
    for (const k of TODAS) assert.equal(CFG.saleReal(k, 'ensayo', caps), false, k)
    assert.deepEqual(TODAS.filter((k) => CFG.reporteEnsayo(k, 'ensayo', caps)), ['baja_aviso_fin', 'baja_fathom', 'baja_recontacto'])
  })
  test('la despedida la confirma Aylu (BAJA_APROBADORES_DESPEDIDA) y también los aprobadores', () => {
    const c = CFG.configBajas({ BOT_ALTA_APROBADORES: TOMI, BAJA_APROBADORES_DESPEDIDA: AYLU })
    assert.deepEqual(c.aprobadores, [TOMI]); assert.deepEqual(c.despedida.sort(), [AYLU, TOMI].sort())
    // Sin la variable: Aylu por defecto (su teléfono de BOT_ALTA_OPERACIONES), sin cargar nada más
    assert.deepEqual(CFG.configBajas({ BOT_ALTA_APROBADORES: TOMI }).despedida, [TOMI])
    assert.deepEqual(CFG.configBajas({ BOT_ALTA_APROBADORES: TOMI, BOT_ALTA_OPERACIONES: AYLU }).despedida.sort(), [AYLU,TOMI].sort())
    assert.ok(!CFG.faltantesBajas({ BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: TODAS.join(',') }).includes('BAJA_APROBADORES_DESPEDIDA'))
  })
  test('faltantes: solo NOMBRES, según las capacidades', () => {
    assert.deepEqual(CFG.faltantesBajas({}), ['DATABASE_URL'])
    const f = CFG.faltantesBajas({ BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: TODAS.join(',') })
    for (const k of ['SHEET_ID_CLIENTES', 'WHAPI_TOKEN', 'WHAPI_GRUPO_VERIFICACIONES', 'BOT_ALTA_APROBADORES', 'BOT_ANTHROPIC_API_KEY', 'FATHOM_API_KEY_TOMAS', 'DISCORD_WEBHOOK_CLIENTES', 'DISCORD_ID_AYLU']) assert.ok(f.includes(k), k)
  })
  test('BOT_BAJAS=no apaga; un link que no es https no cuenta', () => {
    assert.equal(CFG.bajasApagado({ BOT_BAJAS: 'no' }), true)
    assert.equal(CFG.configBajas({ BAJA_CALENDLY_URL: 'http://calendly.com/x' }).calendlyUrl, CFG.URL_CALENDLY_POR_DEFECTO)
    assert.equal(CFG.configBajas({ BAJA_CALENDLY_URL: CAL }).calendlyUrl, CAL)
  })
})

describe('textos', () => {
  test('aviso de fin al cliente: el texto APROBADO tal cual, con primer nombre, fecha dd/mm y el Calendly de Tomi', () => {
    const t = T.textoRenovacion('DRA. ANA MARÍA PÉREZ', '2026-11-11', CAL)
    assert.equal(t, `Buenas Ana, cómo estás? El dia 11/11 terminamos el período que teníamos acordado. Quiero que hagamos un balance con vos de lo que trabajamos y ver qué tiene sentido de acá en adelante junto a Tomi, por eso preparamos una llamada de proyección con tus números.

Te dejo el link con el calendario de Tomi, ahí vas a ver todos los horarios disponibles y elegir el mejor para vos: 

${CAL}`)
    assert.match(T.textoRenovacion('', '2026-11-11', CAL), /^Buenas, cómo estás\?/)
  })
  test('despedida APROBADA tal cual; sin nombre empieza con mayúscula; nunca menciona Drive', () => {
    assert.equal(T.textoDespedida('Ana Pérez'), 'Ana, muchas gracias por confiar en Capital Jurídico. Fue un gusto. Las puertas siempre estarán abiertas por si en algún momento querés retomar. Escribinos cuando quieras. Muchos éxitos en todo lo que venga!')
    assert.match(T.textoDespedida(''), /^Muchas gracias por confiar/)
    assert.doesNotMatch(T.TEXTO_DESPEDIDA, /drive/i)
  })
  test('pedido del aviso de fin: el texto de Tomás', () => {
    assert.match(T.textoPedidoAvisoFin('Ana Pérez', '2026-11-11'), /Ana Pérez termina el 11\/11\/2026\. ¿Le mando el mensaje de renovación\? Respondé citando: OK \/ NO/)
  })
  test('pedido de baja: no renueva / dudoso, con cita y "nada avanza sin el OK"', () => {
    const t = T.textoPedidoBaja('Ana', { tipo: 'fathom', decision: 'no_renueva', fecha: '2026-10-30', cita: 'no voy a renovar', motivo: 'precio', url: 'https://fathom.video/share/x' })
    assert.match(t, /dijo que NO renueva/); assert.match(t, /"no voy a renovar"/); assert.match(t, /Nada avanza sin el OK/)
    assert.match(T.textoPedidoBaja('Ana', { tipo: 'fathom', decision: 'dudoso', fecha: '2026-10-30', cita: '', motivo: '', url: null }), /No me queda claro/)
  })
  test('lista de recontacto partida en mensajes de menos de 2.000 caracteres, con el texto sugerido', () => {
    const lista = Array.from({ length: 40 }, (_, i) => ({ cliente: `Cliente Número ${i} Con Nombre Largo`, seFue: '2026-08-01', dias: 92, puntaje: i % 2 ? 9 : null, motivo: 'precio y tiempos que no le daban para grabar' }))
    const ms = T.textosRecontacto('2026-11', lista)
    assert.ok(ms.length > 1); for (const m of ms) assert.ok(m.length < 2000)
    assert.match(ms.at(-1), /Texto sugerido/); assert.match(ms[0], /El bot no les escribe/)
    assert.equal(T.TEXTO_RECONTACTO, 'Hola [CLIENTE], ¿cómo estás? Hace un tiempo trabajamos juntos en Capital Jurídico y nos acordamos de vos. Tenemos novedades en la forma en que captamos clientes para estudios jurídicos y nos gustaría saber cómo viene tu estudio. ¿Te parece si coordinamos una charla corta esta semana?')
  })
})

describe('fin real, avisos, históricos y cruce de la llamada (puro)', () => {
  test('el fin real toma la mayor fecha (columna del CRM y Extensiones de Renovaciones) y, sin nada, Día 1 + 120', () => {
    assert.equal(FIN.finReal({ dia1: '2026-07-01', finPeriodo: '2026-10-29', periodos: [{ fin: '2026-10-29', meses: null, periodo: 0 }, { fin: '2026-11-19', meses: null, periodo: 1 }] }), '2026-11-19')
    assert.equal(FIN.finReal({ dia1: '2026-07-01', finPeriodo: null, periodos: [] }), '2026-10-29')
    assert.equal(FIN.finReal({ dia1: null, finPeriodo: null, periodos: [] }), null)
  })
  test('avisos: solo ACTIVOS de Agencia con fin entre hoy y 14 días', () => {
    const c = FIN.candidatosAvisoFin([...CLIENTES, cliente({ id: 'A105', nombre: 'Venció Ayer', finPeriodo: '2026-10-31' }), cliente({ id: 'A106', nombre: 'Justo 14', finPeriodo: '2026-11-15' }), cliente({ id: 'A107', nombre: 'Pausada', estado: 'PAUSADO' })], '2026-11-01')
    assert.deepEqual(c.map((x) => x.cliente.id), ['A100', 'A106'])
  })
  test('históricos para recontactar: FINALIZADO / INACTIVO hace 30 a 365 días (fecha de baja o fin)', () => {
    assert.deepEqual(FIN.historicosParaRecontacto(CLIENTES, '2026-11-01').map((x) => x.cliente.id).sort(), ['A102', 'A104'])
  })
  test('la llamada calza por mail del invitado o por 2 palabras del nombre en el título; nunca elige entre dos', () => {
    const l = { titulo: 'Reunión', mails: ['ANA@estudio.test'], fecha: '2026-10-30' }
    assert.equal(FIN.clienteDeLlamada(CLIENTES, l)?.id, 'A100')
    assert.equal(FIN.clienteDeLlamada(CLIENTES, { titulo: 'Ana Pérez y Tomas Napolitano', mails: [], fecha: '2026-10-30' })?.id, 'A100')
    assert.equal(FIN.clienteDeLlamada([...CLIENTES, cliente({ id: 'A110', nombre: 'Ana Pérez Gil', mail: '' })], { titulo: 'Ana Pérez y Tomas', mails: [], fecha: '2026-10-30' }), null)
    // Lejos del fin no calza (sin aviso enviado), salvo que ya tenga el mensaje de renovación
    assert.equal(FIN.clienteDeLlamada(CLIENTES, { titulo: 'Luis Gómez y Tomas', mails: [], fecha: '2026-08-01' }), null)
    assert.equal(FIN.clienteDeLlamada(CLIENTES, { titulo: 'Luis Gómez y Tomas', mails: [], fecha: '2026-08-01' }, new Set(['A101']))?.id, 'A101')
    // Un histórico no es una llamada de renovación
    assert.equal(FIN.clienteDeLlamada(CLIENTES, { titulo: 'Marta Ruiz', mails: ['marta@x.test'], fecha: '2026-09-01' }), null)
  })
})

describe('grupos del cliente (motor y nombres de Whapi)', () => {
  test('del motor, por ID; por nombre de grupo; nunca entre dos', () => {
    const motor = G.fichasDelMotor([{ nombre: 'Ana Pérez', id_crm: 'a100', general: GENERAL, ventas: VENTAS_C, contenido: null, creado: '2026-07-01' }])
    assert.equal(G.fichaDe('A100', 'otro nombre', motor)?.grupos.general, GENERAL)
    const porNombre = G.fichasPorNombre([{ id: CONTENIDO, nombre: 'Contenido - Ana Pérez' }, { id: '120363000000000201@g.us', nombre: 'General - Luis Gómez' }, { id: '120363000000000202@g.us', nombre: 'Equipo' }])
    assert.equal(G.fichaDe('A999', 'Ana Pérez', porNombre)?.grupos.contenido, CONTENIDO)
    assert.equal(G.fichaDe('A999', 'Gómez Luis', porNombre)?.grupos.general, '120363000000000201@g.us')
    assert.equal(G.fichaDe('A999', 'Ruiz Ana Gómez', G.fichasPorNombre([{ id: '120363000000000203@g.us', nombre: 'General - Ana Gómez' }, { id: '120363000000000204@g.us', nombre: 'General - Ana Gómez Paz' }])), null)
  })
  test('el directorio completa con Whapi lo que le falta al motor; sin Whapi (seco) solo el motor', async () => {
    const fuentes = (conWhapi) => ({ conWhapi, filasMotor: async () => [{ nombre: 'Ana Pérez', id_crm: 'A100', general: GENERAL, creado: '1' }], listarGrupos: async () => [{ id: VENTAS_C, nombre: 'Ventas - Ana Pérez' }, { id: CONTENIDO, nombre: 'Contenido - Ana Pérez' }] })
    assert.deepEqual((await G.crearDirectorioGrupos(fuentes(true)).deCliente('A100', 'Ana Pérez')).grupos, { general: GENERAL, ventas: VENTAS_C, contenido: CONTENIDO })
    assert.deepEqual((await G.crearDirectorioGrupos(fuentes(false)).deCliente('A100', 'Ana Pérez')).grupos, { general: GENERAL })
  })
})

describe('filtro del webhook (puro)', () => {
  test('solo respuestas citadas con OK / NO en Verificaciones y los ecos del bot por la API', () => {
    const c = F.candidatosBajas(envio([
      msg({ text: { body: 'OK' }, context: { quoted_id: 'p-1' } }),
      msg({ text: { body: 'no, que lo piense' }, context: { quoted_id: 'p-2' } }),
      msg({ text: { body: 'OK' } }),                                                          // sin cita
      msg({ text: { body: 'buen día' }, context: { quoted_id: 'p-3' } }),                    // no es OK/NO
      msg({ chat_id: GENERAL, text: { body: 'OK' }, context: { quoted_id: 'p-4' } }),         // otro grupo
      msg({ from_me: true, source: 'api', text: { body: '⏳ Ana termina…' } }),
      msg({ from_me: true, source: 'mobile', text: { body: 'algo' } }),
      msg({ timestamp: TS - 3 * 86400, text: { body: 'OK' }, context: { quoted_id: 'p-5' } }), // viejo
    ]), GRUPOS, AHORA)
    assert.deepEqual(c.respuestas.map((x) => [x.citado, x.veredicto]), [['p-1', 'ok'], ['p-2', 'no']])
    assert.equal(c.ecos.length, 1)
  })
})

describe('Claude (salida validada; cliente falso)', () => {
  const T0 = 'Ana: Mirá Tomi, no voy a renovar por ahora.'
  test('"no_renueva" con confianza baja → dudoso; sin renovación → no_se_hablo; cita inventada → vacía', () => {
    assert.equal(CL.leerSalidaLlamada({ es_renovacion: true, decision: 'no_renueva', confianza: 'baja', cita: 'no voy a renovar', motivo: '', motivo_baja: '' }, T0).decision, 'dudoso')
    assert.equal(CL.leerSalidaLlamada({ es_renovacion: false, decision: 'no_renueva', confianza: 'alta', cita: '', motivo: '', motivo_baja: '' }, T0).decision, 'no_se_hablo')
    assert.equal(CL.leerSalidaLlamada({ es_renovacion: true, decision: 'renueva', confianza: 'alta', cita: 'sí, renuevo seguro', motivo: '', motivo_baja: '' }, T0).cita, '')
    assert.throws(() => CL.leerSalidaLlamada({ decision: 'otra' }, T0))
  })
  test('el pedido a Claude: JSON estricto, esfuerzo bajo, transcripción recortada', async () => {
    let pedido
    const cliente = { messages: { create: async (p) => { pedido = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ es_renovacion: true, decision: 'no_renueva', confianza: 'alta', cita: 'no voy a renovar', motivo: 'no sigue', motivo_baja: 'precio' }) }] } } } }
    const l = await CL.clasificarLlamadaConClaude({ cliente: 'Ana', fecha: '2026-10-30', transcripcion: T0 + 'x'.repeat(100_000), resumen: null }, { cliente, apiKey: 'k' })
    assert.equal(l.decision, 'no_renueva')
    assert.equal(pedido.output_config.effort, 'low'); assert.equal(pedido.output_config.format.type, 'json_schema')
    assert.ok(pedido.messages[0].content.length < 70_000)
    await assert.rejects(CL.clasificarLlamadaConClaude({ cliente: 'Ana', fecha: 'x', transcripcion: '   ', resumen: null }, { cliente, apiKey: 'k' }), /transcripción/)
  })
})

describe('CRM: pasar a FINALIZADO (planilla falsa)', () => {
  const CAB = ['', '', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó', 'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Semaforo de Clientes', 'Testimonio', 'Notas renovación', 'Anotaciones', 'Próximo cobro', 'Llamada agendada', 'Fecha de baja']
  const fila = (id, nombre, estado, over = {}) => { const f = Array(22).fill(''); f[0] = id; f[1] = nombre; f[2] = estado; f[9] = '=IF($A2="","",…)'; Object.entries(over).forEach(([k, v]) => { f[Number(k)] = v }); return f }
  const planilla = (filas, op = {}) => {
    const escritas = []
    let datos = filas.map((f) => [...f])
    return {
      escritas,
      async leer(rangos, render) {
        if (rangos.length === 2) return [[CAB], datos]
        const m = /A(\d+):/.exec(rangos[0]); const i = Number(m[1]) - 2
        const f = [...datos[i]]
        if (render === 'UNFORMATTED_VALUE' && !op.noVerifica) for (const e of escritas) { const c = /!([A-Z]+)(\d+)$/.exec(e.range); if (Number(c[2]) - 2 === i) f[c[1].charCodeAt(0) - 65] = typeof e.values[0][0] === 'string' ? e.values[0][0].replace(/^'/, '') : e.values[0][0] }
        return [[f]]
      },
      async escribirValores(d) { escritas.push(...d) },
      async idsDePestanas() { return {} }, async batchUpdate() {}, async limpiar() {},
    }
  }
  const P = { id: 'A100', nombre: 'Ana Pérez', fecha: '2026-11-01', nota: 'No renueva: precio. Baja confirmada por Tomi (bot).' }
  test('simulación: dice lo que escribiría (Estado, Fecha de baja como serial, nota agregada al final) y no escribe', async () => {
    const pl = planilla([fila('A099', 'Otro', 'ACTIVO'), fila('A100', 'Ana Pérez', 'ACTIVO', { 17: 'nota vieja' })])
    const r = await CRM.marcarBajaCrm(pl, P, { modo: 'simulacion' })
    assert.equal(r.estado, 'simulado'); assert.equal(r.fila, 3); assert.equal(pl.escritas.length, 0)
    assert.deepEqual(r.escrituras.map((e) => e.range), ["'Agencia'!C3", "'Agencia'!V3", "'Agencia'!R3"])
    assert.equal(r.escrituras[1].values[0][0], 46327)
    assert.equal(r.escrituras[2].values[0][0], "'nota vieja | [01/11/2026] No renueva: precio. Baja confirmada por Tomi (bot).")
  })
  test('real: escribe y relee; si al releer no quedó, error para revisar a mano', async () => {
    const pl = planilla([fila('A100', 'Ana Pérez', 'PAUSADO')])
    assert.equal((await CRM.marcarBajaCrm(pl, P, { modo: 'real' })).estado, 'hecho')
    assert.equal(pl.escritas.length, 3)
    const mal = planilla([fila('A100', 'Ana Pérez', 'ACTIVO')], { noVerifica: true })
    assert.match((await CRM.marcarBajaCrm(mal, P, { modo: 'real' })).detalle, /al releer/)
  })
  test('no escribe: ya FINALIZADO, ID repetido o ausente, otro nombre, una fórmula, fecha de baja ya cargada se respeta, modo prueba', async () => {
    assert.equal((await CRM.marcarBajaCrm(planilla([fila('A100', 'Ana Pérez', 'FINALIZADO')]), P, { modo: 'real' })).estado, 'ya_estaba')
    assert.match((await CRM.marcarBajaCrm(planilla([fila('A100', 'Ana Pérez', 'ACTIVO'), fila('A100', 'Ana Pérez', 'ACTIVO')]), P, { modo: 'real' })).detalle, /2 filas/)
    assert.match((await CRM.marcarBajaCrm(planilla([fila('A101', 'X', 'ACTIVO')]), P, { modo: 'real' })).detalle, /no está/)
    assert.match((await CRM.marcarBajaCrm(planilla([fila('A100', 'Juan Gómez', 'ACTIVO')]), P, { modo: 'real' })).detalle, /otro nombre/)
    assert.match((await CRM.marcarBajaCrm(planilla([fila('A100', 'Ana Pérez', 'ACTIVO', { 17: '=A1' })]), P, { modo: 'real' })).detalle, /fórmula/)
    const conFecha = await CRM.marcarBajaCrm(planilla([fila('A100', 'Ana Pérez', 'ACTIVO', { 21: 46300 })]), P, { modo: 'simulacion' })
    assert.ok(!conFecha.escrituras.some((e) => e.range.endsWith('V2')))
    assert.match((await CRM.marcarBajaCrm(planilla([fila('A100', 'Ana Pérez', 'ACTIVO')]), P, { modo: 'real', soloPrueba: true })).detalle, /PRUEBA BOT/)
    assert.equal((await CRM.marcarBajaCrm(planilla([fila('A100', 'PRUEBA BOT Ana Pérez', 'ACTIVO')]), { ...P, nombre: 'PRUEBA BOT Ana Pérez' }, { modo: 'simulacion', soloPrueba: true })).estado, 'simulado')
  })
})

describe('Whapi: leer participantes y quitarlos (cliente real con fetch falso)', () => {
  const TOKEN = 'TokenDePrueba1234567890abcdefXYZ'
  const cliente = (respuesta) => {
    const pedidos = []
    const c = W.crearClienteWhapi({ token: TOKEN, esperar: async () => {}, fetch: async (url, init) => { pedidos.push({ url: String(url), metodo: init.method, cuerpo: init.body ? JSON.parse(init.body) : null }); return respuesta(pedidos.length) } })
    return { c, pedidos }
  }
  const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
  test('participantesGrupo: GET /groups/{id} con rangos', async () => {
    const { c, pedidos } = cliente(() => json(200, { id: GENERAL, participants: [{ id: '5491155550099', rank: 'member' }, { id: '5491100000000', rank: 'creator' }, { id: '123456789@lid', rank: 'admin' }] }))
    assert.deepEqual(await c.participantesGrupo(GENERAL), [{ id: '5491155550099', rango: 'miembro' }, { id: '5491100000000', rango: 'creador' }, { id: '123456789@lid', rango: 'admin' }])
    assert.equal(pedidos[0].metodo, 'GET'); assert.match(pedidos[0].url, /\/groups\/120363000000000101%40g\.us$/)
  })
  test('quitarParticipantes: DELETE /groups/{id}/participants; fallidos; un 500 es dudoso y NO se reintenta', async () => {
    const ok = cliente(() => json(200, { processed: ['5491155550099'], failed: ['5491155550088'] }))
    assert.deepEqual(await ok.c.quitarParticipantes({ grupoId: GENERAL, participantes: ['5491155550099', '5491155550088'] }), { quitados: ['5491155550099'], fallidos: ['5491155550088'] })
    assert.equal(ok.pedidos[0].metodo, 'DELETE'); assert.deepEqual(ok.pedidos[0].cuerpo, { participants: ['5491155550099', '5491155550088'] })
    const mal = cliente(() => json(500, { error: { message: 'x' } }))
    await assert.rejects(mal.c.quitarParticipantes({ grupoId: GENERAL, participantes: [CLIENTE_TEL] }), (e) => e.aplicado === null)
    assert.equal(mal.pedidos.length, 1)
    await assert.rejects(ok.c.quitarParticipantes({ grupoId: 'seco-1@g.us', participantes: [CLIENTE_TEL] }), /simulado|grupo/)
  })
  test('nunca se saca a un admin, al creador (el bot) ni a alguien del equipo', () => {
    assert.deepEqual(N.aQuitarDe(PARTICIPANTES[GENERAL], new Set([TOMI, GERO_A, AYLU])), [CLIENTE_TEL, SOCIO_TEL])
    assert.equal(N.esDelEquipo('+54 9 11 0000-0003', new Set([AYLU])), true)
  })
})

describe('núcleo — i01 aviso de fin', () => {
  test('seco: no lee el CRM ni manda nada', async () => {
    const x = armar({ modo: 'seco' })
    const r = await x.N.correrDiario()
    assert.equal(x.enviados.length, 0); assert.match(r.registro[0], /seco/)
  })
  test('real: pide el OK 14 días antes (una vez por período), con OK manda la renovación al General con el Calendly', async () => {
    const x = armar()
    const r = await x.N.correrDiario()
    assert.equal(r.avisos, 1)
    assert.equal(x.enviados[0].chatId, VERIF); assert.match(x.enviados[0].texto, /Ana Pérez termina el 11\/11\/2026/)
    assert.equal((await x.N.correrDiario()).avisos, 0)   // el mismo período no se pide dos veces
    const p = pedidoDe(x, 'aviso_fin')
    const res = await x.N.procesarEventos(responde(p.mensajePedidoId, TOMI, 'OK'))
    assert.equal(res.renovaciones, 1)
    const aCliente = x.enviados.find((e) => e.chatId === GENERAL)
    assert.ok(aCliente.texto.includes(CAL)); assert.match(aCliente.texto, /^Buenas Ana, cómo estás\? El dia 11\/11 terminamos/)
    assert.match(x.enviados.at(-1).texto, /^Listo: le mandé el mensaje de renovación/)
    assert.equal(pedidoDe(x, 'aviso_fin').estado, 'enviado')
  })
  test('NO no manda nada; alguien que no aprueba se ignora; sin grupo General avisa y no manda', async () => {
    const x = armar()
    await x.N.correrDiario()
    const p = pedidoDe(x, 'aviso_fin')
    assert.equal((await x.N.procesarEventos(responde(p.mensajePedidoId, EXTRANO, 'OK'))).ignorados, 1)
    assert.equal((await x.N.procesarEventos(responde(p.mensajePedidoId, AYLU, 'OK'))).ignorados, 1)   // Aylu aprueba la despedida, no esto
    await x.N.procesarEventos(responde(p.mensajePedidoId, GERO_A, 'NO'))
    assert.equal(pedidoDe(x, 'aviso_fin').estado, 'rechazado'); assert.ok(!x.enviados.some((e) => e.chatId === GENERAL))
    const y = armar({ clientes: [cliente({ id: 'A300', nombre: 'Sin Grupo Conocido' })] })
    await y.N.correrDiario()
    assert.match(y.enviados[0].texto, /No conozco su grupo General/)
    await y.N.procesarEventos(responde(pedidoDe(y, 'aviso_fin').mensajePedidoId, TOMI, 'OK'))
    assert.equal(y.enviados.length, 2); assert.match(y.enviados.at(-1).texto, /no conozco su grupo General/)
  })
  test('el eco recupera el id de un pedido que volvió sin id', async () => {
    const x = armar({ sinId: true })
    await x.N.correrDiario()
    const p = pedidoDe(x, 'aviso_fin')
    assert.equal(p.mensajePedidoId, null)
    const eco = F.candidatosBajas(envio([msg({ id: 'eco-1', from_me: true, source: 'api', text: { body: x.enviados[0].texto } })]), GRUPOS, AHORA)
    assert.equal((await x.N.procesarEventos(eco)).ecos, 1)
    assert.equal(pedidoDe(x, 'aviso_fin').mensajePedidoId, 'eco-1')
  })
  test('ensayo: el pedido sale como SIMULACIÓN y el OK no le escribe al cliente', async () => {
    const x = armar({ modo: 'ensayo' })
    await x.N.correrDiario()
    assert.match(x.enviados[0].texto, /SIMULACI/)
    await x.N.procesarEventos(responde(pedidoDe(x, 'aviso_fin').mensajePedidoId, TOMI, 'OK'))
    assert.equal(pedidoDe(x, 'aviso_fin').estado, 'aprobado_simulado'); assert.ok(!x.enviados.some((e) => e.chatId === GENERAL))
  })
  test('tope de 5 avisos por día', async () => {
    const muchos = Array.from({ length: 8 }, (_, i) => cliente({ id: `A2${i}0`, nombre: `Cliente ${i} Apellido${i}`, finPeriodo: '2026-11-10' }))
    const x = armar({ clientes: muchos })
    assert.equal((await x.N.correrDiario()).avisos, 5)
  })
})

describe('núcleo — i02 Fathom → confirmación (SIEMPRE con OK)', () => {
  test('"no renueva" (aunque sea obvio) abre el pedido de confirmación y NO toca nada más', async () => {
    const x = armar()
    const r = await x.N.procesarLlamada(reunion())
    assert.equal(r.pedidosBaja, 1)
    assert.equal(x.enviados.length, 1); assert.equal(x.enviados[0].chatId, VERIF); assert.match(x.enviados[0].texto, /NO renueva/)
    assert.equal(x.crm.length, 0); assert.equal(x.quitados.length, 0); assert.equal(x.discord.length, 0)
    assert.equal(x.almacen._llamadas[0].decision, 'no_renueva')
  })
  test('"dudoso" también pregunta; "renueva" solo deja la nota', async () => {
    const x = armar({ clasificar: () => ({ esRenovacion: true, decision: 'dudoso', confianza: 'media', cita: '', motivo: 'lo piensa', motivoBaja: 'tiempos' }) })
    assert.equal((await x.N.procesarLlamada(reunion())).pedidosBaja, 1); assert.match(x.enviados[0].texto, /No me queda claro/)
    const y = armar({ clasificar: () => ({ esRenovacion: true, decision: 'renueva', confianza: 'alta', cita: '', motivo: 'sigue', motivoBaja: '' }) })
    assert.equal((await y.N.procesarLlamada(reunion())).pedidosBaja, 0); assert.equal(y.enviados.length, 0); assert.equal(y.almacen._llamadas[0].decision, 'renueva')
  })
  test('sin cliente cerca del fin no se llama a Claude; la misma grabación no se mira dos veces; sin baja_fathom no se hace nada', async () => {
    const x = armar()
    await x.N.procesarLlamada(reunion({ recording_id: 9, title: 'Daily del equipo', calendar_invitees: [] }))
    assert.equal(x.clasificadas.length, 0); assert.equal(x.almacen._llamadas.length, 0)   // ni Claude ni escrituras
    await x.N.procesarLlamada(reunion()); await x.N.procesarLlamada(reunion())
    assert.equal(x.clasificadas.length, 1)
    const y = armar({ caps: ['baja_crm'] })
    await y.N.procesarLlamada(reunion())
    assert.equal(y.almacen._llamadas.length, 0); assert.equal(y.clasificadas.length, 0)
  })
  test('un NO a la confirmación: no pasa nada', async () => {
    const x = armar()
    await x.N.procesarLlamada(reunion())
    await x.N.procesarEventos(responde(pedidoDe(x, 'confirmar_baja').mensajePedidoId, TOMI, 'NO, renueva al final'))
    assert.equal(pedidoDe(x, 'confirmar_baja').estado, 'rechazado')
    assert.equal(x.crm.length + x.quitados.length + x.discord.length, 0); assert.equal(x.almacen._bajas.length, 0)
  })
  test('baja manual: abre el mismo pedido (no da de baja sola)', async () => {
    const x = armar()
    const r = await x.N.pedirBajaManual('a100', 'pedido manual', 'avisó por mail')
    assert.equal(r.pedidosBaja, 1); assert.match(x.enviados[0].texto, /pedida a mano/)
    assert.equal(x.almacen._bajas.length, 0)
    assert.equal((await x.N.pedirBajaManual('A999', 'x', '')).errores.length, 1)
  })
})

describe('i02 comparte la invocación con el kickoff: descarte barato, tope propio e idempotencia por recording_id', () => {
  test('descarte barato: una reunión interna ni lee el CRM; una kickoff de un cliente nuevo (fin a ~120 días) no llama a Claude ni escribe', async () => {
    let lecturas = 0
    const x = armar()
    x.deps.leerClientes = async () => { lecturas++; return CLIENTES }
    await x.N.procesarLlamada(reunion({ calendar_invitees_domains_type: 'only_internal' }))
    assert.equal(lecturas, 0); assert.equal(x.clasificadas.length, 0)
    const nuevo = cliente({ id: 'A400', nombre: 'Nuevo Cliente Kickoff', mail: 'nuevo@x.test', dia1: '2026-10-28', finPeriodo: '2027-02-25' })
    const y = armar({ clientes: [...CLIENTES, nuevo] })
    const r = await y.N.procesarLlamada(reunion({ recording_id: 600, title: 'Nuevo Cliente Kickoff y Tomas Napolitano', calendar_invitees: [{ email: 'nuevo@x.test' }] }))
    assert.equal(y.clasificadas.length, 0); assert.equal(y.almacen._llamadas.length, 0); assert.equal(y.enviados.length, 0); assert.equal(r.llamadas, 0)
  })
  test('tope: sin margen al empezar no reclama nada (queda para reintentar) y el reintento con tiempo sí la mira', async () => {
    const x = armar()
    const r = await x.N.procesarLlamada(reunion(), { deadline: AHORA + 30_000 })
    assert.match(r.registro.at(-1), /sin tiempo/); assert.equal(x.almacen._llamadas.length, 0); assert.equal(x.clasificadas.length, 0)
    assert.equal((await x.N.procesarLlamada(reunion(), { deadline: AHORA + 275_000 })).pedidosBaja, 1)
  })
  test('tope: Claude recibe el tiempo que queda; si se acaba antes de abrir el pedido, queda "cortada" sin decisión a medias y el reintento abre UN pedido', async () => {
    const x = armar()
    let topeVisto = 0
    x.deps.clasificar = async (p) => { topeVisto = p.topeMs; x.mover(250_000); return { esRenovacion: true, decision: 'no_renueva', confianza: 'alta', cita: '', motivo: '', motivoBaja: 'precio' } }
    await x.N.procesarLlamada(reunion(), { deadline: AHORA + 275_000 })
    assert.ok(topeVisto <= 275_000 - 35_000 && topeVisto > 0)
    assert.equal(x.almacen._llamadas[0].estado, 'cortada'); assert.equal(x.almacen._llamadas[0].decision, null); assert.equal(x.enviados.length, 0)
    x.deps.clasificar = async () => ({ esRenovacion: true, decision: 'no_renueva', confianza: 'alta', cita: '', motivo: '', motivoBaja: 'precio' })
    const r = await x.N.procesarLlamada(reunion(), { deadline: x.deps.ahora() + 275_000 })
    assert.equal(r.pedidosBaja, 1); assert.equal(x.enviados.length, 1)
  })
  test('tope de la tarea: procesarLlamadaBajasReal termina a tiempo aunque algo se cuelgue (y no deja nada reclamado)', async () => {
    const almacen = A.almacenBajasEnMemoria()
    const env2 = { BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: 'baja_fathom', WHAPI_GRUPO_VERIFICACIONES: VERIF, BOT_ALTA_APROBADORES: TOMI }
    const t = Date.now()
    const r = await S.procesarLlamadaBajasReal({ recording_id: 555001, url: 'https://fathom.video/calls/555001', title: 'Ana Pérez', transcript: [{ speaker: { display_name: 'Ana' }, text: 'no renuevo', timestamp: '00:00:01' }] },
      { env: env2, almacen, log: SILENCIO, leerClientes: () => new Promise(() => {}), deadline: t + 150, margenes: { inicio: 50, envio: 20 } })
    assert.equal(r, null); assert.ok(Date.now() - t < 2_000); assert.equal(almacen._llamadas.length, 0)
  })
  test('la ruta de kickoff le pasa su propio deadline (t0 + 275 s) en un after() aparte', () => {
    assert.equal(CFG.PLAZO_BAJAS_MS, 275_000)
    assert.match(readFileSync(join(RAIZ, 'app/api/bot/kickoff/route.ts'), 'utf8'), /after\(\(\) => procesarLlamadaBajasReal\(p\.datos, \{ deadline: t0 \+ PLAZO_BAJAS_MS \}\)/)
  })
  test('idempotencia: Fathom reenvía y Kickoff reprocesa a mano → un solo Claude, un solo pedido, un solo mensaje', async () => {
    const almacen = A.almacenBajasEnMemoria()
    const x = armar({ almacen })
    await x.N.procesarLlamada(reunion())
    await x.N.procesarLlamada(reunion())            // reenvío del webhook
    const y = armar({ almacen })                     // otra invocación (reproceso a mano con ?recording_id=)
    const r = await y.N.procesarLlamada(reunion())
    assert.equal(r.ignorados, 1)
    assert.equal(x.clasificadas.length + y.clasificadas.length, 1)
    assert.equal(almacen._pedidos.filter((p) => p.tipo === 'confirmar_baja').length, 1)
    assert.equal(x.enviados.length + y.enviados.length, 1)
    // Aun si la llamada quedó "cortada" DESPUÉS de abrir el pedido, el reintento no manda otro (id fijo por grabación)
    almacen._llamadas[0].estado = 'cortada'
    almacen._pedidos[0].estado = 'rechazado'
    const z = armar({ almacen })
    await z.N.procesarLlamada(reunion())
    assert.equal(z.enviados.length, 0); assert.equal(almacen._pedidos.length, 1)
  })
})

describe('núcleo — confirmación → CRM, Skool, despedida y grupos (en ese orden)', () => {
  async function confirmada(op = {}) {
    const x = armar(op)
    await x.N.procesarLlamada(reunion())
    await x.N.procesarEventos(responde(pedidoDe(x, 'confirmar_baja').mensajePedidoId, TOMI, 'OK'))
    return x
  }
  test('con el OK: CRM real a FINALIZADO, aviso a Aylu con el correo y pedido de la despedida (al cliente todavía nada)', async () => {
    const x = await confirmada()
    assert.equal(x.almacen._bajas.length, 1)
    assert.deepEqual(x.crm.map((c) => c.modo), ['real']); assert.match(x.crm[0].p.nota, /No renueva: el precio/)
    assert.match(x.discord[0].t[0], /<@777777777777777777>.*Ana Pérez.*se dio de baja/s); assert.match(x.discord[0].t[0], /ana@estudio\.test/); assert.match(x.discord[0].t[0], /carpeta de Drive queda intacta/)
    assert.deepEqual(x.discord[0].m, ['777777777777777777'])
    const desp = pedidoDe(x, 'despedida')
    assert.ok(desp); assert.match(x.enviados.find((e) => /Despedida para/.test(e.texto)).texto, /…0099, …0088/)
    assert.ok(!x.enviados.some((e) => e.chatId === GENERAL)); assert.equal(x.quitados.length, 0)
    assert.match(x.enviados.at(-1).texto, /Listo: baja de Ana Pérez confirmada/)
    const b = x.almacen._bajas[0]
    assert.equal(b.pasos.crm.estado, 'hecho'); assert.equal(b.pasos.skool.estado, 'hecho'); assert.equal(b.pasos.despedida.estado, 'pendiente')
  })
  test('OK de Aylu a la despedida: PRIMERO el mensaje al General, DESPUÉS sacarlo (sin admins ni equipo) de los 3 grupos', async () => {
    const x = await confirmada()
    x.orden.length = 0
    const r = await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.equal(r.quitados, 3)
    assert.deepEqual(x.orden.slice(0, 3), [`texto:${GENERAL}`, 'espera:5000', `quitar:${GENERAL}`])
    assert.deepEqual(x.quitados, [{ chat: GENERAL, ids: [CLIENTE_TEL, SOCIO_TEL] }, { chat: VENTAS_C, ids: [CLIENTE_TEL] }])
    assert.match(x.enviados.find((e) => e.chatId === GENERAL).texto, /^Ana, muchas gracias por confiar en Capital Jurídico/)
    const b = x.almacen._bajas[0]
    assert.equal(b.pasos.despedida.estado, 'hecho'); assert.equal(b.pasos.grupos.estado, 'hecho')
  })
  test('si la despedida no salió, no se saca a nadie; "OK sin mensaje" lo saca sin despedida', async () => {
    const x = await confirmada({ fallaEnvio: (p) => (p.chatId === GENERAL ? Object.assign(new Error('rechazado'), { aplicado: false }) : null) })
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.equal(x.quitados.length, 0); assert.equal(x.almacen._bajas[0].pasos.despedida.estado, 'error')
    assert.match(x.enviados.at(-1).texto, /no lo saqué de los grupos/)
    const y = await confirmada()
    await y.N.procesarEventos(responde(pedidoDe(y, 'despedida').mensajePedidoId, TOMI, 'OK sin mensaje'))
    assert.ok(!y.enviados.some((e) => e.chatId === GENERAL)); assert.equal(y.quitados.length, 2)
  })
  test('una despedida dudosa (WhatsApp no confirmó) cuenta como mandada: después se saca', async () => {
    const x = await confirmada({ fallaEnvio: (p) => (p.chatId === GENERAL ? Object.assign(new Error('524'), { aplicado: null, tipo: 'dudoso' }) : null) })
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.equal(x.almacen._bajas[0].pasos.despedida.estado, 'dudoso'); assert.equal(x.quitados.length, 2)
  })
  test('más de 6 "clientes" en un grupo: no se saca a nadie de ese grupo; NO a la despedida: nada', async () => {
    const muchos = Array.from({ length: 8 }, (_, i) => ({ id: `54911666600${i}0`, rango: 'miembro' }))
    const x = await confirmada({ participantes: { [GENERAL]: muchos } })
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.ok(!x.quitados.some((q) => q.chat === GENERAL)); assert.equal(x.almacen._bajas[0].pasos.grupos.estado, 'error')
    const y = await confirmada()
    await y.N.procesarEventos(responde(pedidoDe(y, 'despedida').mensajePedidoId, AYLU, 'NO'))
    assert.ok(!y.enviados.some((e) => e.chatId === GENERAL)); assert.equal(y.quitados.length, 0)
  })
  test('alguien que no es Aylu ni aprobador no confirma la despedida', async () => {
    const x = await confirmada()
    assert.equal((await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, EXTRANO, 'OK'))).ignorados, 1)
    assert.equal(x.quitados.length, 0)
  })
  test('real con solo baja_fathom: la baja queda confirmada y todo lo demás se avisa "a mano"', async () => {
    const x = await confirmada({ caps: ['baja_fathom'] })
    assert.equal(x.crm.length + x.discord.length, 0); assert.equal(pedidoDe(x, 'despedida'), undefined)
    assert.match(x.enviados.at(-1).texto, /CRM: pasarlo a FINALIZADO a mano/)
  })
  test('sin baja_mensaje_cliente, el OK de la despedida no saca a nadie (la despedida va primero)', async () => {
    const x = await confirmada({ caps: ['baja_fathom', 'baja_quitar_grupos'] })
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.equal(x.quitados.length, 0); assert.match(x.enviados.at(-1).texto, /OK sin mensaje/)
  })
  test('ensayo: el OK a la confirmación solo deja un reporte SIMULACIÓN (CRM en simulación, sin tocar grupos)', async () => {
    const x = await confirmada({ modo: 'ensayo' })
    assert.deepEqual(x.crm.map((c) => c.modo), ['simulacion'])
    assert.equal(x.almacen._bajas.length, 0); assert.equal(x.quitados.length, 0); assert.equal(x.discord.length, 0)
    assert.match(x.enviados.at(-1).texto, /SIMULACI.*Baja de Ana Pérez: con el OK se haría esto/s)
    assert.match(x.enviados.at(-1).texto, /sacaría a …0099, …0088/)
  })
  test('un pedido abierto en ensayo y aprobado ya en real no toca nada', async () => {
    const almacen = A.almacenBajasEnMemoria()
    const e = armar({ modo: 'ensayo', almacen })
    await e.N.procesarLlamada(reunion())
    const x = armar({ almacen })
    await x.N.procesarEventos(responde(pedidoDe(x, 'confirmar_baja').mensajePedidoId, TOMI, 'OK'))
    assert.equal(x.almacen._bajas.length, 0); assert.equal(x.crm[0]?.modo ?? 'ninguno', 'simulacion')
  })
})

describe('núcleo — i05 recontacto y vencimientos', () => {
  test('el día 1 publica en Discord los históricos (mejor puntaje primero, con motivo), una vez por mes', async () => {
    const x = armar({ puntajes: new Map([['A104', 6]]) })
    await x.almacen.crearBaja({ id: 'A102:2026-09-01', clave: 'A102', idCrm: 'A102', cliente: 'Marta Ruiz', general: null, mail: '', motivo: 'cerró el estudio', origen: { tipo: 'manual', por: '', motivo: '' }, por: 'Tomi', modo: 'real', confirmada: '2026-09-01T00:00:00Z', creado: '2026-09-01T00:00:00Z' })
    const r = await x.N.correrDiario()
    assert.equal(r.recontactos, 2)
    const t = x.discord[0].t.join('\n')
    assert.ok(t.indexOf('Marta Ruiz') < t.indexOf('Laura Díaz')); assert.match(t, /satisfacción 9\/10 · motivo: cerró el estudio/); assert.match(t, /satisfacción 6\/10/)
    assert.ok(!/Pedro Sosa/.test(t))
    assert.equal((await x.N.correrDiario()).recontactos, 0)
    assert.ok(!x.enviados.some((e) => e.chatId !== VERIF))   // a ningún cliente
  })
  test('otro día no publica (salvo forzado); en ensayo solo un SIMULACIÓN corto en Verificaciones', async () => {
    const x = armar({ ahora: AHORA + 3 * DIA })
    await x.N.correrDiario(); assert.equal(x.discord.length, 0)
    await x.N.correrDiario({ forzarRecontacto: true }); assert.equal(x.discord.length, 1)
    const y = armar({ modo: 'ensayo' })
    await y.N.correrDiario()
    assert.equal(y.discord.length, 0); assert.match(y.enviados.at(-1).texto, /SIMULACI.*lista de recontacto/s)
  })
  test('un pedido sin respuesta vence a los 14 días', async () => {
    const x = armar()
    await x.N.correrDiario()
    x.mover(15 * DIA)
    assert.equal((await x.N.correrDiario()).vencidos, 1)
    assert.equal(pedidoDe(x, 'aviso_fin').estado, 'vencido')
  })
  test('enLista es la misma regla que la del motor', () => {
    for (const [a, l] of [[{ telefono: TOMI, lid: null }, [TOMI]], [{ telefono: '+54 9 11 0000-0001', lid: null }, ['1100000001']], [{ telefono: null, lid: '1@lid' }, ['1@lid']], [{ telefono: EXTRANO, lid: null }, [TOMI]]]) {
      assert.equal(N.enLista(a, l), enListaMotor(a, l))
    }
  })
})

describe('integración: webhook de Whapi y webhook de Fathom de kickoff', () => {
  const SECRETO = 'Secreto-De-Prueba-1234567890-abcdefgh'
  const env = { WHAPI_WEBHOOK_SECRETO: SECRETO, WHAPI_GRUPO_VENTAS: VENTAS_CJ, WHAPI_GRUPO_VERIFICACIONES: VERIF }
  const motorJuguete = (falla = false) => () => ({ modo: 'seco', registrar: async () => { if (falla) throw new Error('caída'); return { nuevos: [], repetidos: [] } }, procesar: async () => ({ altas: [], continuaciones: 0, errores: [], registro: [] }), avanzar: async () => ({}), barrer: async () => ({}) })
  const pedir = (cuerpo) => new Request('https://despacho.test/api/bot/whapi', { method: 'POST', headers: { 'x-cj-bot-secreto': SECRETO, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const armarRuta = (falla = false) => {
    const tareas = [], llamadas = []
    return { tareas, llamadas, deps: { crearMotor: motorJuguete(falla), clienteWhapi: () => ({}), env, ahora: () => AHORA, log: SILENCIO, programar: (t) => tareas.push(t), procesarBajas: async (c, o) => { llamadas.push({ c, o }); return null } } }
  }
  test('un OK citado en Verificaciones se programa para Bajas en after(); con el motor caído (503) igual', async () => {
    const x = armarRuta(true)
    const res = await R.atenderWebhook(pedir(envio([msg({ text: { body: 'OK' }, context: { quoted_id: 'p-1' } })])), x.deps)
    assert.equal(res.status, 503)
    for (const t of x.tareas) await t()
    assert.equal(x.llamadas.length, 1); assert.equal(x.llamadas[0].c.respuestas[0].citado, 'p-1')
  })
  test('convive con Éxito: el mismo OK citado se programa para las dos etapas (cada una busca la cita entre SUS pedidos)', async () => {
    const x = armarRuta()
    const exito = []
    x.deps.procesarExito = async (c) => { exito.push(c); return null }
    await R.atenderWebhook(pedir(envio([msg({ text: { body: 'OK' }, context: { quoted_id: 'p-9' } })])), x.deps)
    for (const t of x.tareas) await t()
    assert.equal(x.llamadas.length, 1); assert.equal(exito.length, 1)
    // y un pedido de Éxito citado no es de Bajas: el núcleo lo ignora sin tocar nada
    const y = armar()
    const r = await y.N.procesarEventos(responde('pedido-de-exito', TOMI, 'OK'))
    assert.equal(r.aprobados + r.ignorados, 0); assert.equal(y.enviados.length, 0)
  })
  test('sin candidatos (charla) no se programa nada; sin el secreto, tampoco', async () => {
    const x = armarRuta()
    await R.atenderWebhook(pedir(envio([msg({ text: { body: 'buen día' } })])), x.deps)
    for (const t of x.tareas) await t()
    assert.equal(x.llamadas.length, 0)
    const req = new Request('https://despacho.test/api/bot/whapi', { method: 'POST', headers: { 'x-cj-bot-secreto': 'otro' }, body: '{}' })
    assert.equal((await R.atenderWebhook(req, x.deps)).status, 401)
  })
  test('las rutas de Next pasan procesarBajasReal (Whapi) y procesarLlamadaBajasReal (Fathom de kickoff, sin otro webhook)', () => {
    assert.match(readFileSync(join(RAIZ, 'app/api/bot/whapi/route.ts'), 'utf8'), /procesarBajas: procesarBajasReal/)
    const k = readFileSync(join(RAIZ, 'app/api/bot/kickoff/route.ts'), 'utf8')
    assert.match(k, /after\(\(\) => procesarLlamadaBajasReal\(p\.datos, /)
  })
  test('procesarBajasReal / procesarLlamadaBajasReal: en seco, con BOT_BAJAS=no, sin base o sin baja_fathom no hacen nada (ni red)', async () => {
    const c = responde('p-1', TOMI, 'OK')
    assert.equal(await S.procesarBajasReal(c, { env: { DATABASE_URL: 'postgres://x.invalid/db' }, log: SILENCIO }), null)
    assert.equal(await S.procesarBajasReal(c, { env: { BOT_BAJAS: 'no', BOT_BAJAS_MODO: 'real' }, log: SILENCIO }), null)
    assert.equal(await S.procesarBajasReal(c, { env: { BOT_BAJAS_MODO: 'real' }, log: SILENCIO }), null)
    assert.equal(await S.procesarLlamadaBajasReal({ recording_id: 1 }, { env: { BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: 'baja_crm', DATABASE_URL: 'postgres://x.invalid/db' }, log: SILENCIO }), null)
  })
  test('procesarLlamadaBajasReal con almacén en memoria: payload inválido → null; válido → mira la llamada', async () => {
    const env2 = { BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: 'baja_fathom', WHAPI_GRUPO_VERIFICACIONES: VERIF, BOT_ALTA_APROBADORES: TOMI }
    const almacen = A.almacenBajasEnMemoria()
    assert.equal(await S.procesarLlamadaBajasReal({ nada: 1 }, { env: env2, almacen, log: SILENCIO }), null)
    const r = await S.procesarLlamadaBajasReal({ recording_id: 77, url: 'https://fathom.video/calls/77', title: 'Daily' }, { env: env2, almacen, log: SILENCIO, leerClientes: async () => CLIENTES })
    assert.equal(r.llamadas, 0); assert.equal(almacen._llamadas.length, 0)
  })
})

describe('/api/bot/bajas (ruta) y lectura para la cartera', () => {
  test('estado: modo, capacidades y faltantes (nombres); sin base, vacío', async () => {
    const r = await RB.atenderBajas(new URLSearchParams('estado=1'), { env: {} })
    assert.equal(r.status, 200); assert.equal(r.cuerpo.modo, 'seco'); assert.deepEqual(r.cuerpo.clientes, [])
  })
  test('sin base 503; parámetros inválidos 400; dry en seco no hace nada', async () => {
    assert.equal((await RB.atenderBajas(new URLSearchParams(''), { env: {} })).status, 503)
    const almacen = A.almacenBajasEnMemoria()
    assert.equal((await RB.atenderBajas(new URLSearchParams('baja=Juan'), { env: {}, almacen })).status, 400)
    assert.equal((await RB.atenderBajas(new URLSearchParams('recording_id=-1'), { env: {}, almacen })).status, 400)
    assert.equal((await RB.atenderBajas(new URLSearchParams('recording_id=1&quien=otro'), { env: {}, almacen })).status, 400)
    const d = await RB.atenderBajas(new URLSearchParams('dry=1'), { env: {}, almacen, leerClientes: async () => CLIENTES })
    assert.equal(d.status, 200); assert.equal(d.cuerpo.dry, true); assert.equal(d.cuerpo.modo, 'seco')
  })
  test('dry en real: lee, arma los pedidos y NO guarda ni manda nada', async () => {
    const almacen = A.almacenBajasEnMemoria()
    const env2 = { BOT_BAJAS_MODO: 'real', BOT_BAJAS_CAPACIDADES: 'baja_aviso_fin', WHAPI_GRUPO_VERIFICACIONES: VERIF, BOT_ALTA_APROBADORES: TOMI }
    const d = await conArchivadosActuales(() => RB.atenderBajas(new URLSearchParams('dry=1'), { env: env2, almacen, leerClientes: async () => CLIENTES, ahora: () => AHORA, log: SILENCIO }), { leer: async () => [['ID', 'Nombre', 'Estado', 'Anotaciones'], ...CLIENTES.map(c => [c.id, c.nombre, c.estado, ''])] })
    assert.equal(d.cuerpo.avisos, 1); assert.equal(almacen._pedidos.length, 0)
  })
  test('lectura: estado por cliente (pedido, confirmada, cerrada)', async () => {
    const x = armar()
    await x.N.procesarLlamada(reunion())
    let e = await L.leerEstadoBajas({ env: {}, almacen: x.almacen })
    assert.equal(e.clientes.find((k) => k.idCrm === 'A100').estado, 'baja_pedida')
    await x.N.procesarEventos(responde(pedidoDe(x, 'confirmar_baja').mensajePedidoId, TOMI, 'OK'))
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    e = await L.leerEstadoBajas({ env: {}, almacen: x.almacen })
    assert.equal(e.clientes.find((k) => k.idCrm === 'A100').estado, 'cerrada')
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
  const PED = { id: 'aviso:A100:2026-11-11', tipo: 'aviso_fin', clave: 'A100', cliente: 'Ana', idCrm: 'A100', general: GENERAL, fin: '2026-11-11', modo: 'real', mensajePedidoId: null, huella: 'h', detalle: {}, creado: new Date(AHORA).toISOString() }
  test('la primera escritura crea las 4 tablas y el índice único de "un pedido abierto por cliente y tipo"; nunca DROP', async () => {
    const s = []
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    AN.sqlBajasParaPruebas(() => sqlFalso(s, async (t) => (/RETURNING/.test(t) ? [{ id: 'x' }] : [])))
    try {
      assert.equal(await AN.almacenBajasNeon().crearPedido(PED), true)
      for (const t of AN.TABLAS_BAJAS) assert.ok(s.some((x) => x.startsWith(`CREATE TABLE IF NOT EXISTS ${t}`)), t)
      assert.ok(s.some((x) => /CREATE UNIQUE INDEX IF NOT EXISTS cj_bajas_pedidos_uno_abierto ON cj_bajas_pedidos \(clave, tipo\) WHERE estado IN \('abierto', 'aprobado'\)/.test(x)))
      assert.ok(!s.some((x) => /DROP|ALTER TABLE .* TYPE/i.test(x)))
    } finally { AN.sqlBajasParaPruebas(null); delete process.env.DATABASE_URL }
  })
  test('índice único violado (23505) → false; una lectura sin tabla (42P01) → vacía; columnas de una lista fija', async () => {
    const s = []
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    AN.sqlBajasParaPruebas(() => sqlFalso(s, async (t) => {
      if (/INSERT INTO cj_bajas_pedidos/.test(t)) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      if (/SELECT/.test(t)) throw Object.assign(new Error('relation "cj_bajas_pedidos" does not exist'), { code: '42P01' })
      return /RETURNING/.test(t) ? [{ id: 'p' }] : []
    }))
    try {
      const a = AN.almacenBajasNeon()
      assert.equal(await a.crearPedido(PED), false)
      assert.equal(await a.pedido('x'), null); assert.deepEqual(await a.listarBajas(5), []); assert.equal((await a.conAvisoDesde('2026-01-01')).size, 0)
      assert.equal(await a.actualizarPedido('p', { estado: 'enviado', mensajeClienteId: 'm1', huella: 'no-se-cambia' }, ['aprobado']), true)
      assert.ok(s.some((x) => /UPDATE cj_bajas_pedidos SET mensaje_cliente_id = \$\d/.test(x)))
      assert.ok(!s.some((x) => /SET huella/.test(x)))
    } finally { AN.sqlBajasParaPruebas(null); delete process.env.DATABASE_URL }
  })
  test('reclamarLlamada en Neon: ON CONFLICT solo vuelve a reclamar una llamada cortada o en error', async () => {
    const s2 = []
    process.env.DATABASE_URL = 'postgres://prueba.invalid/db'
    AN.sqlBajasParaPruebas(() => sqlFalso(s2, async (t) => (/RETURNING/.test(t) ? [{ recording_id: 1 }] : [])))
    try {
      assert.equal(await AN.almacenBajasNeon().reclamarLlamada({ recordingId: 1, fecha: '2026-10-30', url: null }, new Date(AHORA).toISOString()), true)
      assert.ok(s2.some((x) => /INSERT INTO cj_bajas_llamadas .* ON CONFLICT \(recording_id\) DO UPDATE SET estado = 'reclamada', creado = EXCLUDED\.creado WHERE cj_bajas_llamadas\.estado IN \('cortada', 'error'\)/.test(x)))
    } finally { AN.sqlBajasParaPruebas(null); delete process.env.DATABASE_URL }
  })
  test('migración: --simular no se conecta y muestra las sentencias; argumentos raros fallan', async () => {
    const out = []
    assert.equal(await MIG.main([], { salida: (t) => out.push(t) }), 0)
    assert.match(out[0], /Simulación: no se conectó/); assert.ok(out.some((l) => l.includes('cj_bajas_recontactos')))
    assert.equal(await MIG.main(['--confirmar'], { salida: () => {} }), 1)
    assert.equal(await MIG.main(['--real'], { salida: () => {} }), 1)   // sin DATABASE_URL
  })
})

describe('documentación', () => {
  test('docs/BOT-BAJAS-CJ.md: flujo, variables, textos a aprobar, preguntas y checklist', () => {
    const p = join(RAIZ, 'docs', 'BOT-BAJAS-CJ.md')
    assert.ok(existsSync(p))
    const d = readFileSync(p, 'utf8')
    for (const s of ['## Flujo', '## Variables', '## Modo y capacidades']) assert.ok(d.includes(s), s)
    for (const v of ['BOT_BAJAS_MODO', 'BOT_BAJAS_CAPACIDADES', 'BAJA_CALENDLY_URL', 'BAJA_APROBADORES_DESPEDIDA', 'DISCORD_ID_AYLU', 'BAJA_RECONTACTO_DIA']) assert.ok(d.includes(v), v)
    for (const c of CFG.CAPACIDADES_BAJA) assert.ok(d.includes(c), c)
    assert.ok(d.includes(T.TEXTO_DESPEDIDA.split('\n')[0].replace('[CLIENTE]', '[CLIENTE]')))
  })
})

// ═══════════════════════════════════ RONDA 2 (Tomás, 25/10/2026) ═══════════════════════════════════════════════════════
const R2 = [...TODAS, 'baja_eliminar_comunidad', 'baja_pausar_meta', 'baja_quitar_drive']
const CAMPANAS = [{ id: '120200000000001', nombre: 'CJ Laboral', cuenta: 'act_111', cuentaNombre: 'Ana Pérez Abogada' }, { id: '120200000000002', nombre: 'CJ ART', cuenta: 'act_111', cuentaNombre: 'Ana Pérez Abogada' }]
const metaJuguete = (over = {}) => {
  const pausas = []
  return { pausas, campanasActivas: async () => ({ campanas: CAMPANAS, errores: [], tokenCaido: false, ...over.lectura }), pausar: async (ids) => { pausas.push(ids); return over.pausa ?? { pausadas: ids, fallidas: [], tokenCaido: false } } }
}
async function confirmar2(op = {}, ok = 'OK') {
  const x = armar({ caps: R2, ...op })
  await x.N.procesarLlamada(reunion())
  await x.N.procesarEventos(responde(pedidoDe(x, 'confirmar_baja').mensajePedidoId, TOMI, ok))
  return x
}

describe('ronda 2 — FINALIZADO o INACTIVO (regla de dudas)', () => {
  test('terminó (o termina en 14 días) su período → FINALIZADO sin dudas; pausa, se va antes o sin fin → dudoso', () => {
    assert.deepEqual(FIN.estadoParaBaja(cliente(), '2026-11-01'), { dudoso: false, estado: 'FINALIZADO', motivo: 'su período termina el 11/11/2026' })
    assert.equal(FIN.estadoParaBaja(cliente({ finPeriodo: '2026-10-20' }), '2026-11-01').estado, 'FINALIZADO')
    assert.equal(FIN.estadoParaBaja(cliente({ estado: 'PAUSADO' }), '2026-11-01').dudoso, true)
    assert.match(FIN.estadoParaBaja(cliente({ finPeriodo: '2026-12-31' }), '2026-11-01').motivo, /se va 60 días antes del fin/)
    assert.equal(FIN.estadoParaBaja(cliente({ dia1: null, finPeriodo: null }), '2026-11-01').dudoso, true)
  })
  test('sin dudas: el pedido propone FINALIZADO y el OK lo usa (o "OK INACTIVO" lo cambia)', async () => {
    const x = await confirmar2()
    assert.match(x.enviados[0].texto, /CRM: pasa a FINALIZADO \(su período termina el 11\/11\/2026\)\. ¿Confirmás la baja\? Respondé citando: OK \/ NO/)
    assert.equal(x.crm[0].p.estado, 'FINALIZADO')
    const y = await confirmar2({}, 'OK INACTIVO')
    assert.equal(y.crm[0].p.estado, 'INACTIVO'); assert.match(y.crm[0].p.nota, /INACTIVO/)
  })
  test('con dudas: pregunta "OK FINALIZADO / OK INACTIVO"; un OK solo NO avanza (pide el estado) y "OK INACTIVO" sí', async () => {
    const pausada = [cliente({ estado: 'PAUSADO' }), ...CLIENTES.slice(1)]
    const x = armar({ caps: R2, clientes: pausada })
    await x.N.procesarLlamada(reunion())
    const p = pedidoDe(x, 'confirmar_baja')
    assert.match(x.enviados[0].texto, /¿Pasa a FINALIZADO o a INACTIVO\? Respondé citando: OK FINALIZADO \/ OK INACTIVO/)
    await x.N.procesarEventos(responde(p.mensajePedidoId, TOMI, 'OK'))
    assert.equal(x.almacen._bajas.length, 0); assert.equal(pedidoDe(x, 'confirmar_baja').estado, 'abierto'); assert.match(x.enviados.at(-1).texto, /OK FINALIZADO \/ OK INACTIVO/)
    await x.N.procesarEventos(responde(p.mensajePedidoId, TOMI, 'ok inactivo'))
    assert.equal(x.almacen._bajas.length, 1); assert.equal(x.crm[0].p.estado, 'INACTIVO')
  })
  test('CRM: escribe INACTIVO y verifica INACTIVO', async () => {
    const f = Array(22).fill(''); f[0] = 'A100'; f[1] = 'Ana Pérez'; f[2] = 'ACTIVO'
    const CAB = ['', '', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó', 'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Semaforo de Clientes', 'Testimonio', 'Notas renovación', 'Anotaciones', 'Próximo cobro', 'Llamada agendada', 'Fecha de baja']
    const escritas = []
    const pl = { async leer(r, render) { if (r.length === 2) return [[CAB], [f]]; const v = [...f]; if (render === 'UNFORMATTED_VALUE') { v[2] = 'INACTIVO'; v[21] = 46327; v[17] = escritas.find((e) => e.range.endsWith('R2')).values[0][0].slice(1) } return [[v]] }, async escribirValores(d) { escritas.push(...d) } }
    const r = await CRM.marcarBajaCrm(pl, { id: 'A100', nombre: 'Ana Pérez', fecha: '2026-11-01', nota: 'No renueva', estado: 'INACTIVO' }, { modo: 'real' })
    assert.equal(r.estado, 'hecho'); assert.equal(escritas[0].values[0][0], 'INACTIVO')
  })
})

describe('ronda 2 — Drive: se le saca el acceso a su carpeta (la carpeta queda intacta)', () => {
  test('con la baja confirmada: Puente con la carpeta y los correos del CRM y del #ALTA (sin los del equipo); avisa si la carpeta es pública', async () => {
    const llamadas = []
    const x = await confirmar2({ drive: async (carpeta, correos) => { llamadas.push({ carpeta, correos }); return { carpeta: 'Ana Pérez - C.J', quitados: [{ correo: 'ana@estudio.test', como: 'editor' }], noTenian: ['socio@estudio.test'], protegidos: [], acceso: 'ANYONE_WITH_LINK', enlacePublico: true } } })
    assert.deepEqual(llamadas, [{ carpeta: CARPETA, correos: ['ana@estudio.test', 'socio@estudio.test'] }])
    const b = x.almacen._bajas[0]
    assert.equal(b.pasos.drive.estado, 'hecho'); assert.match(b.pasos.drive.detalle, /acceso general \(ANYONE_WITH_LINK\): no lo cambié/)
  })
  test('puente viejo (acción desconocida) → avisa que falta publicar 2026-10-26a; sin carpeta conocida → a mano', async () => {
    const x = await confirmar2({ drive: async () => { throw new PU.ErrorPuente('El puente rechazó quitarAccesoCliente: acción desconocida: quitarAccesoCliente', false, 'accion_desconocida') } })
    assert.match(x.almacen._bajas[0].pasos.drive.detalle, /falta publicar el Puente Drive 2026-10-26a/)
    const y = armar({ caps: R2, drive: async () => { throw new Error('no debería llamarse') } })
    y.deps.grupos = { deCliente: async () => ({ ...FICHA_ANA, carpeta: null }) }
    await y.N.procesarLlamada(reunion())
    await y.N.procesarEventos(responde(pedidoDe(y, 'confirmar_baja').mensajePedidoId, TOMI, 'OK'))
    assert.equal(y.almacen._bajas[0].pasos.drive.estado, 'error'); assert.match(y.almacen._bajas[0].pasos.drive.detalle, /no conozco su carpeta/)
  })
  test('cliente del Puente: manda quitarAccesoCliente con los correos normalizados y lee la respuesta', async () => {
    const previo = globalThis.fetch
    process.env.PUENTE_DRIVE_URL = 'https://script.google.com/macros/s/prueba/exec'; process.env.PUENTE_DRIVE_SECRETO = 'secreto-de-prueba'
    let cuerpo
    globalThis.fetch = async (_u, init) => { cuerpo = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, carpeta: 'Ana Pérez - C.J', quitados: [{ correo: 'ana@estudio.test', como: 'lector' }], noTenian: [], protegidos: [], acceso: 'PRIVATE', enlacePublico: false }), { status: 200 }) }
    try {
      const r = await PU.puenteDriveReal().quitarAccesoCliente({ carpetaId: CARPETA, correos: [' ANA@estudio.test', 'no-es-correo', 'ana@estudio.test'] })
      assert.equal(cuerpo.accion, 'quitarAccesoCliente'); assert.deepEqual(cuerpo.correos, ['ana@estudio.test']); assert.equal(cuerpo.carpetaId, CARPETA)
      assert.deepEqual(r.quitados, [{ correo: 'ana@estudio.test', como: 'lector' }]); assert.equal(r.enlacePublico, false)
      await assert.rejects(PU.puenteDriveReal().quitarAccesoCliente({ carpetaId: 'corto', correos: ['a@b.co'] }), /Id de Drive inválido/)
    } finally { globalThis.fetch = previo; delete process.env.PUENTE_DRIVE_URL; delete process.env.PUENTE_DRIVE_SECRETO }
  })
})

describe('ronda 2 — Meta: con la baja confirmada, OK y PAUSA (nunca borra), con verificación', () => {
  test('pide el OK con la lista; con el OK pausa esas campañas y responde', async () => {
    const meta = metaJuguete()
    const x = await confirmar2({ meta })
    const p = pedidoDe(x, 'pausar_meta')
    assert.match(x.enviados.find((e) => /Pauso las campañas/.test(e.texto)).texto, /¿Pauso las campañas activas de Ana Pérez en Meta\? Lista:\n• CJ Laboral \(Ana Pérez Abogada\)\n• CJ ART/)
    assert.equal(meta.pausas.length, 0)   // nada sin el OK
    await x.N.procesarEventos(responde(p.mensajePedidoId, GERO_A, 'OK'))
    assert.deepEqual(meta.pausas, [['120200000000001', '120200000000002']])
    assert.match(x.enviados.at(-1).texto, /Listo: pausé 2 campaña\(s\) de Ana Pérez en Meta \(verificadas\)/)
    assert.equal(x.almacen._bajas[0].pasos.meta.estado, 'hecho')
  })
  test('NO: no pausa nada; Aylu no aprueba esto; sin campañas activas no pide; token caído → falla cerrado con aviso', async () => {
    const meta = metaJuguete()
    const x = await confirmar2({ meta })
    const p = pedidoDe(x, 'pausar_meta')
    assert.equal((await x.N.procesarEventos(responde(p.mensajePedidoId, AYLU, 'OK'))).ignorados, 1)
    await x.N.procesarEventos(responde(p.mensajePedidoId, TOMI, 'NO'))
    assert.equal(meta.pausas.length, 0); assert.equal(x.almacen._bajas[0].pasos.meta.estado, 'omitido')
    const y = await confirmar2({ meta: metaJuguete({ lectura: { campanas: [] } }) })
    assert.equal(pedidoDe(y, 'pausar_meta'), undefined); assert.match(y.almacen._bajas[0].pasos.meta.detalle, /no tenía campañas activas/)
    const z = await confirmar2({ meta: metaJuguete({ lectura: { campanas: [], tokenCaido: true, errores: ['#190 expired'] } }) })
    assert.equal(pedidoDe(z, 'pausar_meta'), undefined); assert.match(z.enviados.at(-1).texto, /token de Meta \(META_ANUNCIOS_TOKEN\) venció/)
  })
  test('el token cae al pausar: no sigue y avisa en Verificaciones', async () => {
    const x = await confirmar2({ meta: metaJuguete({ pausa: { pausadas: [], fallidas: [{ id: '120200000000001', motivo: '#190' }, { id: '120200000000002', motivo: 'no se intentó' }], tokenCaido: true } }) })
    await x.N.procesarEventos(responde(pedidoDe(x, 'pausar_meta').mensajePedidoId, TOMI, 'OK'))
    assert.match(x.enviados.at(-1).texto, /No pausé ninguna campaña de Ana Pérez: el token de Meta \(META_ANUNCIOS_TOKEN\) venció/)
    assert.equal(pedidoDe(x, 'pausar_meta').estado, 'error')
  })
  test('meta.ts con fetch falso: lee ACTIVE, pausa con POST status=PAUSED (nunca DELETE), relee y verifica; el token va en la cabecera', async () => {
    const pedidos = []
    const estado = new Map()
    const f = async (url, init) => {
      pedidos.push({ url, metodo: init.method, cuerpo: init.body ?? null, auth: init.headers.authorization })
      if (url.includes('/campaigns')) return Response.json({ data: [{ id: '1202000000001', name: 'A', effective_status: 'ACTIVE' }, { id: '1202000000009', name: 'B', effective_status: 'PAUSED' }] })
      const id = url.split('/').pop().split('?')[0]
      if (init.method === 'POST') { estado.set(id, new URLSearchParams(init.body).get('status')); return Response.json({ success: true }) }
      return Response.json({ id, status: estado.get(id) ?? 'ACTIVE' })
    }
    const m = ME.crearMetaBajas({ token: 'EAAprueba', fetch: f, cuentasDelCliente: async () => [{ id: 'act_111', nombre: 'Ana' }] })
    const l = await m.campanasActivas('Ana Pérez')
    assert.deepEqual(l.campanas.map((c) => c.id), ['1202000000001'])
    const r = await m.pausar(['1202000000001'])
    assert.deepEqual(r, { pausadas: ['1202000000001'], fallidas: [], tokenCaido: false })
    assert.ok(pedidos.every((p) => p.metodo !== 'DELETE' && !p.url.includes('access_token') && p.auth === 'Bearer EAAprueba'))
    assert.equal(pedidos.find((p) => p.metodo === 'POST').cuerpo, 'status=PAUSED')
  })
  test('meta.ts: sin token o con 190 falla cerrado; si al releer no quedó PAUSED, es una falla', async () => {
    const sin = ME.crearMetaBajas({ token: null, cuentasDelCliente: async () => [{ id: 'act_1', nombre: 'x' }] })
    assert.equal((await sin.campanasActivas('x')).tokenCaido, true)
    const vencido = ME.crearMetaBajas({ token: 't', cuentasDelCliente: async () => [], fetch: async () => Response.json({ error: { code: 190, message: 'Error validating access token' } }, { status: 400 }) })
    const r = await vencido.pausar(['1202000000001', '1202000000002'])
    assert.equal(r.tokenCaido, true); assert.equal(r.pausadas.length, 0); assert.match(r.fallidas[1].motivo, /no se intentó/)
    const terco = ME.crearMetaBajas({ token: 't', cuentasDelCliente: async () => [], fetch: async (u, i) => (i.method === 'POST' ? Response.json({ success: true }) : Response.json({ status: 'ACTIVE' })) })
    assert.match((await terco.pausar(['1202000000001'])).fallidas[0].motivo, /quedó ACTIVE/)
  })
})

describe('ronda 2 — comunidad: se elimina SIEMPRE al final (después de la despedida y de los grupos)', () => {
  test('orden: despedida → sacarlo de los grupos → eliminar la comunidad (con Avisos)', async () => {
    const x = await confirmar2({ comunidad: async (id) => { x.orden.push(`comunidad:${id}`) } })
    x.orden.length = 0
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.deepEqual(x.orden, [`texto:${GENERAL}`, 'espera:5000', `quitar:${GENERAL}`, `quitar:${VENTAS_C}`, `comunidad:${COMUNIDAD}`, `texto:${VERIF}`])
    assert.equal(x.almacen._bajas[0].pasos.comunidad.estado, 'hecho')
    assert.match(x.enviados.find((e) => /Despedida para/.test(e.texto)).texto, /elimino su comunidad/)
  })
  test('si no se lo pudo sacar de los grupos, la comunidad NO se elimina; 403 → a mano; sin id la busca por nombre', async () => {
    const borradas = []
    const x = await confirmar2({ fallaQuitar: true, comunidad: async (id) => { borradas.push(id) } })
    await x.N.procesarEventos(responde(pedidoDe(x, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.equal(borradas.length, 0); assert.equal(x.almacen._bajas[0].pasos.comunidad.estado, 'omitido')
    const y = await confirmar2({ comunidad: async () => { throw Object.assign(new Error('Not permission'), { status: 403, aplicado: false }) } })
    await y.N.procesarEventos(responde(pedidoDe(y, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.match(y.almacen._bajas[0].pasos.comunidad.detalle, /no es admin/)
    const otra = { ...FICHA_ANA, comunidad: null }
    const z = armar({ caps: R2, comunidad: async (id) => { borradas.push(id) }, buscarComunidad: async () => '120363000000000199@g.us' })
    z.deps.grupos = { deCliente: async () => otra }
    await z.N.procesarLlamada(reunion())
    await z.N.procesarEventos(responde(pedidoDe(z, 'confirmar_baja').mensajePedidoId, TOMI, 'OK'))
    await z.N.procesarEventos(responde(pedidoDe(z, 'despedida').mensajePedidoId, AYLU, 'OK'))
    assert.deepEqual(borradas, ['120363000000000199@g.us'])
  })
  test('cliente de Whapi: DELETE /communities/{id}, sin reintento; success:false es un rechazo', async () => {
    const TOKEN = 'TokenDePrueba1234567890abcdefXYZ'
    const pedidos = []
    const mk = (resp) => W.crearClienteWhapi({ token: TOKEN, esperar: async () => {}, fetch: async (url, init) => { pedidos.push({ url: String(url), metodo: init.method }); return resp() } })
    await mk(() => Response.json({ success: true })).eliminarComunidad(COMUNIDAD)
    assert.equal(pedidos[0].metodo, 'DELETE'); assert.match(pedidos[0].url, /\/communities\/120363000000000100%40g\.us$/)
    await assert.rejects(mk(() => Response.json({ success: false })).eliminarComunidad(COMUNIDAD), /success: false/)
    pedidos.length = 0
    await assert.rejects(mk(() => Response.json({ error: { message: 'x' } }, { status: 500 })).eliminarComunidad(COMUNIDAD), (e) => e.aplicado === null)
    assert.equal(pedidos.length, 1)
  })
  test('el motor guarda la comunidad, la carpeta y los correos del #ALTA (directorio)', () => {
    const f = G.fichasDelMotor([{ nombre: 'Ana Pérez', id_crm: 'A100', general: GENERAL, comunidad: COMUNIDAD, carpeta: CARPETA, texto: '#ALTA\nCorreo: Ana@Estudio.test\nSocios: Juan, socio@estudio.test', creado: '1' }])[0]
    assert.equal(f.comunidad, COMUNIDAD); assert.equal(f.carpeta, CARPETA); assert.deepEqual(f.correos, ['ana@estudio.test', 'socio@estudio.test'])
    assert.match(G.CONSULTA_MOTOR_BAJAS, /comunidadId/); assert.match(G.CONSULTA_MOTOR_BAJAS, /pd\.paso = 'drive'/)
  })
})
