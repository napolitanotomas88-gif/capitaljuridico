// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-bot-alta-despacho.mjs
// «Cargar alta» del Despacho (26/10/2026): el bot del alta de Capital Jurídico sin WhatsApp. Prueba, SIN red, SIN base y SIN
// Claude (almacén en memoria, archivos en memoria, Whapi y pasos de juguete):
//   · parseo desde la pantalla: #ALTA y formato libre → el mismo EventoAlta del webhook, con el closer del selector;
//   · comprobantes: tipo, firma y tamaño; el motor los lee del Despacho, nunca de Whapi;
//   · permisos: quién carga, quién aprueba (por mail) y que un closer solo completa SUS altas;
//   · OK / NO desde la pantalla por el mismo camino que la ruta manual del motor;
//   · datos del closer ("Inicio del servicio: 26/10/2026") con y sin comprobante;
//   · aviso a Discord (canal Despacho y WhatsApp caído), una vez por espera, con el link y los aprobadores;
//   · "Hecho a mano" de comunidad, bienvenida y Skool: el alta queda lista.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

for (const k of Object.keys(process.env)) {
  if (/^(BOT_|WHAPI_|DISCORD_|KICKOFF_|EDICION_|PANDADOC_|PUENTE_DRIVE_|SHEET_ID_)/.test(k) || ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'CRON_SECRET', 'VERCEL_ENV', 'DESPACHO_URL'].includes(k)) delete process.env[k]
}
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const M = await import('../lib/bot/alta/motor/modo.ts')
const A = await import('../lib/bot/alta/motor/almacen.ts')
const O = await import('../lib/bot/alta/motor/orquestador.ts')
const EV = await import('../lib/bot/alta/despacho/evento.ts')
const AP = await import('../lib/bot/alta/despacho/aprobadores.ts')
const AR = await import('../lib/bot/alta/despacho/archivos.ts')
const AV = await import('../lib/bot/alta/despacho/aviso.ts')
const CA = await import('../lib/bot/alta/despacho/canal.ts')
const VI = await import('../lib/bot/alta/despacho/vista.ts')
const AC = await import('../lib/bot/alta/despacho/acciones.ts')

const sha = (b) => createHash('sha256').update(b).digest('hex')
const T0 = Date.parse('2026-10-26T13:00:00Z')
const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const ENV = {
  KICKOFF_REVISOR_TOMI: 'tomas@ejemplo.com', KICKOFF_REVISOR_GERO_M: 'gerom@ejemplo.com,gerom2@ejemplo.com', EDICION_REVISOR_AYLU: 'aylu@ejemplo.com',
  BOT_ALTA_APROBADORES_EMAIL: 'geroa@ejemplo.com', DESPACHO_URL: 'https://despacho.ejemplo.com',
  // Los closers cargando en el Despacho están APAGADOS por defecto (Tomás, 26/10): los tests de closers lo prenden acá
  BOT_ALTA_CLOSERS_DESPACHO: 'si',
}
const TOMAS = { email: 'tomas@ejemplo.com', nombre: 'Tomás Napolitano', rol: 'socio' }
const AYLU = { email: 'Aylu@Ejemplo.com', nombre: 'Aylén QA', rol: 'acceso' }
const GEROA = { email: 'geroa@ejemplo.com', nombre: 'Gerónimo Actis', rol: 'acceso' }
const MARCOS = { email: 'marcos@ejemplo.com', nombre: 'Marcos Ruiz', rol: 'closer' }
const CARLOS = { email: 'carlos@ejemplo.com', nombre: 'Carlos Gil', rol: 'closer' }
const OTRO = { email: 'otro@ejemplo.com', nombre: 'Otra Persona', rol: 'csm' }

const TEXTO = `#ALTA
Closer: Yami
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Ana Pérez
Teléfono: +54 9 11 3000-1111
Socios: ninguno
Correo: ana@ejemplo.com
Dirección: Av. Corrientes 1234, CABA
DNI: 30111222
CUIT: 27-30111222-4
Inicio del servicio: 26/10/2026
Cuotas:
26/11/2026 1100
26/12/2026 1100`
const SIN_DNI = TEXTO.replace('DNI: 30111222\n', '')
const LIBRE = 'Completa PIF 1299 USD\nNombre: Nadia Blanco\nTel: +54 9 11 4000 2222\nCorreo: nancy@ejemplo.com\nDNI: 28111333\nInicio: 26/10/2026\nPrograma: Agencia'
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5])
const PDF = new Uint8Array([...Buffer.from('%PDF-1.4 comprobante')])

// ── Whapi y pasos de juguete ──
function whapiJuguete(op = {}) {
  let n = 0
  const enviados = [], llamadas = []
  const err = (tipo) => Object.assign(new Error(`juguete: ${tipo}`), { name: 'ErrorWhapi', tipo, status: null, aplicado: false })
  const anotar = (m, p) => { llamadas.push({ m, p }); if (op.caido?.includes(m)) throw err('sin_numero') }
  return {
    modo: 'juguete', enviados, llamadas,
    async enviarTexto(p) { anotar('enviarTexto', p); enviados.push(p); return { id: `jg-${++n}`, simulado: false } },
    async enviarVideo(p) { anotar('enviarVideo', p); enviados.push(p); return { id: `jg-${++n}`, simulado: false } },
    async descargarMedio(m) { anotar('descargarMedio', m.id); throw new Error('el comprobante del Despacho no puede pedirse a Whapi') },
    async crearComunidad(p) { anotar('crearComunidad', p); return { id: `com-${++n}@g.us`, nombre: p.nombre, codigoInvitacion: null } },
    async subgruposComunidad(id) { anotar('subgruposComunidad', id); return { avisos: { id: `avisos-${id}`, nombre: 'Avisos', codigoInvitacion: null }, otros: [] } },
    async crearGrupoEnComunidad(p) { anotar('crearGrupoEnComunidad', p); return { id: `grupo-${++n}@g.us`, nombre: p.nombre, codigoInvitacion: `INV${n}`, agregados: p.participantes, fallidos: [] } },
    async agregarParticipantes(p) { anotar('agregarParticipantes', p); return { agregados: p.participantes, fallidos: [] } },
    async ponerFoto(p) { anotar('ponerFoto', p) },
    async cambiarInfoGrupo(p) { anotar('cambiarInfoGrupo', p) },
    async linkInvitacion(id) { anotar('linkInvitacion', id); return `https://chat.whatsapp.com/L${id}` },
    async verificarNumeros(ns) { anotar('verificarNumeros', ns); return Object.fromEntries(ns.map((x) => [x, 'valido'])) },
    async agendarContacto(p) { anotar('agendarContacto', p) },
    registro: () => [],
  }
}
const lectura = { es_comprobante: true, legible: 'si', monto_texto: '1.100,00', moneda: 'USD', fecha: '2026-10-26', numero_operacion: 'OP-1', destinatario: 'Napolitano Tomás', ordenante: 'Ana Pérez', medio: 'Galicia', notas: '' }
function pasosJuguete(vistos) {
  return {
    finanzas: async (fila, comprobante, op) => ({ ok: true, modo: op.modo, etapa: 'listo', motivo: null, escribio: true, fila: 2, verificacion: null, comprobanteId: 'id-comprobante-123456789012', comprobanteUrl: 'https://drive/x', comprobanteYaExistia: false, noReintentarAntesDe: null, nombreArchivo: 'x.jpeg', chip: 'puesto', pedidos: [], filaAnterior: [], controles: [], avisos: [], repetido: null }),
    crm: async (a, ex, op) => ({ ok: true, modo: op.modo, etapa: 'listo', motivo: null, escribio: true, id: 'C-200', filaAgencia: 170, filaRenovaciones: 400, verificacion: null, pedidos: null, omitidas: [], formulasPrevias: null, avisos: [], previa: { faltantes: [], bloqueos: [], motivosNoApto: [], lectura: null, aptoParaEscribir: true }, duplicadoVigente: null }),
    drive: async () => ({ modo: 'real', ok: true, completo: true, esperaOk: null, nombres: { cliente: 'Ana Pérez', carpeta: 'Ana Pérez - C.J' }, carpeta: { nombre: 'Ana Pérez - C.J', estado: 'creado', id: 'carpeta_ana_1234567890123', url: 'https://drive/c' }, crudos: {}, editados: {}, guiones: {}, bienvenida: {}, guardar: { carpeta: { id: 'carpeta_ana_1234567890123', url: 'https://drive/c' } }, intentoCarpeta: null, noReintentarAntesDe: null, pendientes: [], errores: [], llamadas: [] }),
    contrato: { hayClave: () => false, crear: async () => { throw new Error('no') }, estado: async () => 'document.draft', buscar: async () => [] },
    mep: async () => ({ venta: 1500, diaAnterior: '2026-10-25', fechaCotizacion: '2026-10-24' }),
    vision: async (m) => { vistos.push(m.sha256); return { modelo: 'claude-haiku-5-5', salida: lectura, tokens: { entrada: 1, salida: 1 } } },
    setterFuente: async () => ({ setter: 'Mai', setterTexto: 'Mai', fuente: 'Inbound IG', hoja: 'Closer 2', fila: 500, coincidencias: 1 }),
    plantillaGuionesId: () => 'plantilla_guiones_12345678901', modeloVision: 'claude-haiku-5-5',
    equipo: { 'Gero M': '5493333333333', Aylu: '5492222222222', 'Tomás': '5491111111111' }, aprobadores: ['5491111111111'], operaciones: ['5492222222222'],
    closers: { Yamila: '5491100000021', Marcos: '5491100000034' },
    fotos: { comunidad: { url: 'https://d/a.jpg' }, General: { url: 'https://d/b.jpg' }, Ventas: { url: 'https://d/c.jpg' }, Contenido: { url: 'https://d/d.jpg' } },
    maxComunidadesDia: 2, esperar: async () => {}, azar: () => 0,
  }
}

/** Todo armado: motor real (modo real, todas las capacidades) con el Despacho, y las dependencias de la API. */
function armar(op = {}) {
  const reloj = { t: T0 }
  const ahora = () => reloj.t
  const almacen = A.almacenEnMemoria({ ahora })
  const archivos = AR.archivosEnMemoria()
  const whapi = whapiJuguete(op.whapi)
  const vistos = [], avisos = [], pendientes = []
  const motor = O.crearOrquestador({
    whapi: AR.clienteConArchivosDespacho(whapi, () => archivos), modo: 'real', capacidades: new Set(M.CAPACIDADES), grupos: GRUPOS, ahora, almacen,
    pasos: pasosJuguete(vistos), entorno: 'test', produccion: false, dormir: async () => {}, log: { info() {}, warn() {}, error() {} },
    canal: () => op.canal ?? 'despacho',
    avisarEspera: async (d) => { if (op.discordFalla) throw new Error('Discord caído'); avisos.push({ ...d, texto: AV.textoAvisoEspera({ ...d, base: ENV.DESPACHO_URL, menciones: AV.mencionesDe(d.espera.quien, ENV) }) }) },
  })
  const deps = {
    sesion: () => op.sesion === undefined ? TOMAS : op.sesion, baseLista: () => true, almacen: () => almacen, archivos: () => archivos, motor: () => motor,
    simulacion: () => { const al = A.almacenEnMemoria({ ahora }); return { almacen: al, motor: O.crearOrquestador({ whapi: whapiJuguete(), modo: 'seco', capacidades: new Set(), grupos: GRUPOS, ahora, almacen: al, pasos: { ...pasosJuguete([]), finanzas: undefined, crm: undefined, vision: undefined }, entorno: 'sim', produccion: false }) } },
    enSegundoPlano: (fn) => { pendientes.push(fn()) }, closers: { Yamila: '5491100000021', Marcos: '5491100000034' }, ahora, env: ENV, log: () => {},
  }
  const esperar = async () => { while (pendientes.length) await pendientes.shift() }
  /** POST /api/clientes/altas como lo manda la pantalla, y espera lo que quedó en segundo plano. */
  async function post(campos, archivosSubidos = [], sesion) {
    if (sesion !== undefined) deps.sesion = () => sesion
    const fd = new FormData()
    for (const [k, v] of Object.entries(campos)) fd.set(k, v)
    for (const [nombre, bytes, tipo] of archivosSubidos) fd.append('archivos', new File([bytes], nombre, { type: tipo }))
    const req = new Request('https://despacho.ejemplo.com/api/clientes/altas', { method: 'POST', body: fd, headers: { origin: 'https://despacho.ejemplo.com', host: 'despacho.ejemplo.com' } })
    const r = await AC.atenderAcciones(req, deps)
    await esperar()
    return { status: r.status, json: await r.json() }
  }
  return { almacen, archivos, whapi, motor, deps, reloj, vistos, avisos, post }
}
let n = 0
const nuevoId = () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
const cargar = (m, texto = TEXTO, over = {}) => m.post({ accion: 'cargar', id: over.id ?? nuevoId(), texto, closer: over.closer ?? 'Yami' }, over.archivos ?? [['comprobante.jpg', JPG, 'image/jpeg']], over.sesion)
const abierta = async (m, altaId, f) => (await m.almacen.leerAlta(altaId)).esperas.find((e) => e.estado === 'abierta' && f(e))
const estados = async (m, id) => Object.fromEntries(Object.entries(await m.almacen.leerPasos(id)).map(([k, v]) => [k, v.estado]))

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('parseo desde la pantalla: el mismo evento que arma el webhook', () => {
  test('#ALTA: el closer del selector reemplaza al del texto; origen despacho, id único', () => {
    const r = EV.eventoAltaDespacho({ id: 'despacho-abc', texto: TEXTO, closer: 'Marcos', archivos: [], ahora: T0, closers: { Marcos: '5491100000034' } })
    assert.equal(r.ok, true)
    assert.equal(r.tipo, '#ALTA')
    assert.equal(r.evento.tipo, 'alta'); assert.equal(r.evento.grupo, 'ventas'); assert.equal(r.evento.chatId, 'despacho')
    assert.equal(r.evento.clave, 'despacho-abc'); assert.equal(r.evento.mensajeId, 'despacho-abc'); assert.equal(r.evento.libre, undefined)
    assert.match(r.evento.texto, /^#ALTA\nCloser: Marcos\n/)
    assert.equal((r.evento.texto.match(/closer:/gi) ?? []).length, 1)
    assert.deepEqual(r.evento.autor, { telefono: '5491100000034', lid: 'despacho:marcos', nombre: 'Marcos' })
  })
  test('#ALTA sin "Closer:": se suma debajo de la etiqueta', () => {
    const r = EV.eventoAltaDespacho({ id: 'despacho-x', texto: TEXTO.replace('Closer: Yami\n', ''), closer: 'Nahuel', archivos: [], ahora: T0, closers: {} })
    assert.match(r.evento.texto, /^#ALTA\nCloser: Nahuel\nPrograma/)
    assert.equal(r.evento.autor.telefono, null)
  })
  test('formato libre: libre:true con "Closer:" arriba; Yami usa el teléfono de Yamila', () => {
    const r = EV.eventoAltaDespacho({ id: 'despacho-l', texto: LIBRE, closer: 'Yami', archivos: [], ahora: T0, closers: { Yamila: '5491100000021' } })
    assert.equal(r.tipo, 'libre'); assert.equal(r.evento.libre, true)
    assert.match(r.evento.texto, /^Closer: Yami\nCompleta PIF/)
    assert.equal(r.evento.autor.telefono, '5491100000021')
  })
  test('lo que no es un alta (charla, vacío) se rechaza con el motivo', () => {
    assert.equal(EV.eventoAltaDespacho({ id: 'd', texto: 'son 800 usd que entraron hoy', closer: 'Carlos', archivos: [], ahora: T0, closers: {} }).ok, false)
    assert.equal(EV.eventoAltaDespacho({ id: 'd', texto: '   ', closer: 'Carlos', archivos: [], ahora: T0, closers: {} }).ok, false)
  })
  test('closer del selector: solo los cinco; id del envío con forma de uuid', () => {
    assert.equal(EV.closerValido('marcos'), 'Marcos'); assert.equal(EV.closerValido('Pedro'), null)
    assert.equal(EV.idDespacho('0a1b2c3d-0000-4000-8000-000000000000'), 'despacho-0a1b2c3d000040008000000000000000')
    assert.equal(EV.idDespacho('x; DROP'), null)
  })
  test('comprobantes: imagen o PDF de verdad, hasta 4 MB; un .exe con nombre .jpg no pasa', () => {
    const ok = EV.prepararArchivos([{ nombre: 'a.jpg', mime: 'image/jpeg', bytes: JPG }, { nombre: 'b.pdf', mime: '', bytes: PDF }])
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.archivos.map((a) => a.mime), ['image/jpeg', 'application/pdf'])
    assert.equal(ok.archivos[0].id, `despacho-arch-${sha(JPG).slice(0, 40)}`)
    assert.equal(EV.refMedio(ok.archivos[1]).tipo, 'document')
    assert.equal(EV.prepararArchivos([{ nombre: 'virus.jpg', mime: 'image/jpeg', bytes: new Uint8Array([0x4d, 0x5a, 1, 2]) }]).ok, false)
    assert.equal(EV.prepararArchivos([{ nombre: 'g.jpg', mime: 'image/jpeg', bytes: new Uint8Array(EV.MAX_ARCHIVO_BYTES + 1).fill(0xff) }]).ok, false)
    assert.equal(EV.prepararArchivos([{ nombre: 'f.heic', mime: 'image/heic', bytes: JPG }]).ok, false)
  })
  test('vista previa: dice qué entendió y no escribe nada', async () => {
    const m = armar()
    const r = await m.post({ accion: 'previsualizar', texto: SIN_DNI, closer: 'Yami' }, [['c.jpg', JPG, 'image/jpeg']])
    assert.equal(r.status, 200)
    assert.equal(r.json.tipo, '#ALTA')
    assert.equal(r.json.datos.nombre, 'Ana Pérez'); assert.equal(r.json.datos.closer, 'Yami'); assert.equal(r.json.datos.estePagoUsd, 1100)
    assert.ok(r.json.faltantes.some((f) => /dni/i.test(f)))
    assert.equal(r.json.comprobantes.length, 1)
    assert.deepEqual(await m.almacen.ultimas(5), []); assert.deepEqual(m.archivos.lista(), []); assert.deepEqual(m.whapi.llamadas, [])
    const no = await m.post({ accion: 'previsualizar', texto: 'hola', closer: 'Yami' })
    assert.equal(no.status, 422)
  })
})

describe('permisos', () => {
  test('aprobadores por mail: Tomás, Gero M (dos cuentas), Aylu y Gero A (BOT_ALTA_APROBADORES_EMAIL)', () => {
    assert.equal(AP.aprobadorDe(TOMAS, ENV).nombre, 'Tomás')
    assert.equal(AP.aprobadorDe({ ...TOMAS, email: 'gerom2@ejemplo.com' }, ENV).nombre, 'Gero M')
    assert.equal(AP.aprobadorDe(AYLU, ENV).nombre, 'Aylu')
    assert.equal(AP.aprobadorDe(GEROA, ENV).nombre, 'Gerónimo')
    assert.equal(AP.aprobadorDe(MARCOS, ENV), null); assert.equal(AP.aprobadorDe(OTRO, ENV), null)
    assert.equal(AP.aprobadorDe({ ...TOMAS, email: 'tomas@ejemplo.com.ar' }, ENV), null)
    assert.deepEqual(AP.faltantesAprobadores(ENV), [])
    assert.deepEqual(AP.faltantesAprobadores({ KICKOFF_REVISOR_TOMI: 'a@b.co' }), ['Gero M', 'Aylu', 'Gero A'])
  })
  test('cargan closers y aprobadores; nadie más. El usuario de prueba solo fuera de producción', () => {
    assert.equal(AP.puedeCargar(MARCOS, ENV), true); assert.equal(AP.puedeCargar(AYLU, ENV), true); assert.equal(AP.puedeCargar(OTRO, ENV), false)
    assert.equal(AP.closerDeSesion({ ...MARCOS, nombre: 'Yamila Pérez' }), 'Yami')
    // Por defecto (sin BOT_ALTA_CLOSERS_DESPACHO) un closer NO carga: lo hacen Aylu, Gero A, Tomás o Gero M
    const { BOT_ALTA_CLOSERS_DESPACHO: _, ...sinCloser } = ENV
    assert.equal(AP.puedeCargar(MARCOS, sinCloser), false); assert.equal(AP.puedeCargar(AYLU, sinCloser), true)
    const prueba = { email: 'dev@localhost', nombre: 'Usuario de prueba', rol: 'socio', esDePrueba: true }
    assert.ok(AP.aprobadorDe(prueba, {}))
    assert.equal(AP.aprobadorDe(prueba, { VERCEL_ENV: 'production' }), null)
  })
  test('sin sesión 401, otro origen 403, quien no carga 403; un closer carga solo a su nombre', async () => {
    const m = armar()
    assert.equal((await cargar(m, TEXTO, { sesion: null })).status, 401)
    assert.equal((await cargar(m, TEXTO, { sesion: OTRO })).status, 403)
    assert.equal((await cargar(m, TEXTO, { sesion: MARCOS, closer: 'Carlos' })).status, 403)
    const fd = new FormData(); fd.set('accion', 'cargar')
    const req = new Request('https://despacho.ejemplo.com/api/clientes/altas', { method: 'POST', body: fd, headers: { origin: 'https://otro.com', host: 'despacho.ejemplo.com' } })
    m.deps.sesion = () => TOMAS
    assert.equal((await AC.atenderAcciones(req, m.deps)).status, 403)
    const r = await cargar(m, TEXTO, { sesion: MARCOS, closer: '' })
    assert.equal(r.status, 202)
    assert.match((await m.almacen.leerAlta(r.json.altaId)).textoVigente, /Closer: Marcos/)
  })
  test('sin comprobante no se carga', async () => {
    const m = armar()
    assert.equal((await cargar(m, TEXTO, { archivos: [] })).status, 422)
  })
})

describe('cargar: el motor procesa el alta del Despacho', () => {
  test('el comprobante sale del Despacho (no de Whapi); con el canal Despacho nada sale a Ventas ni a Verificaciones', async () => {
    const m = armar()
    const r = await cargar(m)
    assert.equal(r.status, 202)
    assert.equal(m.vistos[0], sha(JPG))
    assert.ok(!m.whapi.llamadas.some((l) => l.m === 'descargarMedio'))
    assert.ok(!m.whapi.enviados.some((e) => Object.values(GRUPOS).includes(e.chatId)))
    const p = await estados(m, r.json.altaId)
    assert.equal(p.validar, 'hecho'); assert.equal(p.finanzas, 'hecho'); assert.equal(p.crm, 'hecho')
    // El mismo id otra vez no crea otra alta
    const again = await m.post({ accion: 'cargar', id: `${(n).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`, texto: TEXTO, closer: 'Yami' }, [['c.jpg', JPG, 'image/jpeg']])
    assert.equal(again.json.repetida, true)
    assert.equal((await m.almacen.ultimas(10)).length, 1)
  })
})

describe('OK / NO desde la pantalla (mismo camino que la ruta manual)', () => {
  test('alta libre: "¿Esto es un alta?" → OK de Aylu la arranca, a su nombre', async () => {
    const m = armar()
    const r = await cargar(m, LIBRE, { closer: 'Yami' })
    const e = await abierta(m, r.json.altaId, (x) => x.motivo === 'confirmacion')
    assert.ok(e, 'tiene que preguntar si es un alta')
    assert.equal((await estados(m, r.json.altaId)).finanzas, 'pendiente')
    // Un closer no aprueba
    assert.equal((await m.post({ accion: 'responder', alta_id: r.json.altaId, espera_id: e.id, texto: 'OK' }, [], { ...MARCOS, nombre: 'Yamila X' })).status, 403)
    const ok = await m.post({ accion: 'responder', alta_id: r.json.altaId, espera_id: e.id, texto: 'OK' }, [], AYLU)
    assert.equal(ok.status, 202)
    const alta = await m.almacen.leerAlta(r.json.altaId)
    const resp = alta.esperas.find((x) => x.id === e.id).respuesta
    assert.equal(resp.veredicto, 'ok'); assert.equal(resp.por, 'manual:Aylu')
    // Confirmada: sigue como un #ALTA (pide lo que le falta al closer y lo que difiere del comprobante)
    assert.ok(alta.esperas.some((x) => x.estado === 'abierta' && x.quien === 'closer' && x.pedido.some((p) => /CUIT/.test(p))))
    assert.ok(alta.esperas.some((x) => x.estado === 'abierta' && x.motivo === 'validar'))
    // Ya respondida: 409
    assert.equal((await m.post({ accion: 'responder', alta_id: r.json.altaId, espera_id: e.id, texto: 'OK' }, [], AYLU)).status, 409)
  })
  test('NO con motivo: el alta libre queda rechazada', async () => {
    const m = armar()
    const r = await cargar(m, LIBRE)
    const e = await abierta(m, r.json.altaId, (x) => x.motivo === 'confirmacion')
    await m.post({ accion: 'responder', alta_id: r.json.altaId, espera_id: e.id, texto: 'NO es charla' }, [], GEROA)
    const alta = await m.almacen.leerAlta(r.json.altaId)
    assert.equal(alta.estado, 'rechazada')
    assert.equal(alta.esperas.find((x) => x.id === e.id).respuesta.por, 'manual:Gerónimo')
  })
  test('una respuesta que no empieza con OK o NO se rechaza', async () => {
    const m = armar()
    const r = await cargar(m, LIBRE)
    const e = await abierta(m, r.json.altaId, (x) => x.motivo === 'confirmacion')
    assert.equal((await m.post({ accion: 'responder', alta_id: r.json.altaId, espera_id: e.id, texto: 'dale' })).status, 422)
  })
  test('botones de la espera: cuenta → OK Tomi / OK Gero / OK Empresa; fuente → lista; siempre NO', () => {
    const cuenta = VI.opcionesDe({ quien: 'aprobadores', motivo: 'validar', requiere: ['cuenta'], tipos: ['ok_cuenta'], pedido: [] })
    assert.deepEqual(cuenta.filter((o) => o.tipo === 'boton').map((o) => o.texto), ['OK Tomi', 'OK Gero', 'OK Empresa'])
    assert.equal(cuenta.at(-1).tipo, 'no')
    assert.ok(VI.opcionesDe({ quien: 'aprobadores', motivo: 'validar', requiere: ['fuente'], tipos: [], pedido: [] }).some((o) => o.tipo === 'lista' && o.opciones.includes('VSL Funnel')))
    assert.ok(VI.opcionesDe({ quien: 'equipo', motivo: 'nombre', requiere: [], tipos: [], pedido: [] }).some((o) => o.tipo === 'nombre'))
    const datos = VI.opcionesDe({ quien: 'closer', motivo: 'datos', requiere: [], tipos: ['datos_closer'], pedido: ['Inicio del servicio (dd/mm/aaaa)'] })
    assert.deepEqual(datos, [{ tipo: 'datos', plantilla: 'Inicio del servicio: ', conArchivos: false }])
  })
})

describe('datos que faltan del closer', () => {
  test('"DNI: 30111222" desde el formulario completa el alta; otro closer no puede', async () => {
    const m = armar()
    const r = await cargar(m, SIN_DNI, { sesion: MARCOS, closer: 'Marcos' })
    const e = await abierta(m, r.json.altaId, (x) => x.quien === 'closer')
    assert.ok(e && e.pedido.some((p) => /dni/i.test(p)))
    assert.equal((await m.post({ accion: 'datos', alta_id: r.json.altaId, espera_id: e.id, texto: 'DNI: 30111222' }, [], CARLOS)).status, 404, 'Carlos ni la ve')
    const ok = await m.post({ accion: 'datos', alta_id: r.json.altaId, espera_id: e.id, texto: 'DNI: 30111222' }, [], MARCOS)
    assert.equal(ok.status, 202)
    const alta = await m.almacen.leerAlta(r.json.altaId)
    assert.match(alta.textoVigente, /DNI: 30111222/)
    assert.equal((await estados(m, r.json.altaId)).validar, 'hecho')
  })
  test('con el comprobante que faltaba (y el dato), en la misma vuelta', async () => {
    const m = armar()
    const r = await cargar(m, SIN_DNI, { sesion: AYLU })
    const e = await abierta(m, r.json.altaId, (x) => x.quien === 'closer')
    await m.post({ accion: 'datos', alta_id: r.json.altaId, espera_id: e.id, id: nuevoId(), texto: 'DNI: 30111222' }, [['otro.pdf', PDF, 'application/pdf']], AYLU)
    const alta = await m.almacen.leerAlta(r.json.altaId)
    assert.equal(alta.medios.length, 2)
    assert.match(alta.textoVigente, /DNI: 30111222/)
  })
})

describe('aviso a Discord', () => {
  test('canal Despacho: un aviso por espera, con el link a la espera y los cuatro aprobadores', async () => {
    const m = armar()
    const r = await cargar(m, SIN_DNI)
    assert.equal(m.avisos.length, 1)
    const a = m.avisos[0]
    assert.equal(a.motivo, 'despacho'); assert.equal(a.espera.quien, 'closer')
    assert.ok(a.texto.includes(`https://despacho.ejemplo.com/clientes/altas?alta=${r.json.altaId}#espera-${a.espera.id}`))
    for (const id of AV.IDS_APROBADORES_DISCORD) assert.ok(a.texto.includes(`<@${id}>`), id)
    assert.match(a.texto, /faltan datos del closer/)
    assert.ok((await m.almacen.leerAlta(r.json.altaId)).esperas.find((x) => x.id === a.espera.id).avisoDespacho)
    await m.post({ accion: 'reintentar', alta_id: r.json.altaId })
    assert.equal(m.avisos.length, 1, 'no se repite')
  })
  test('canal ambos con el número caído: el pedido no sale y avisa; canal whatsapp: no avisa', async () => {
    const caido = armar({ canal: 'ambos', whapi: { caido: ['enviarTexto'] } })
    await cargar(caido, SIN_DNI)
    assert.equal(caido.avisos.length, 1); assert.equal(caido.avisos[0].motivo, 'sin_whatsapp')
    assert.match(caido.avisos[0].texto, /no está disponible/)
    const sano = armar({ canal: 'ambos' })
    await cargar(sano, SIN_DNI)
    assert.equal(sano.avisos.length, 0)
    assert.ok(sano.whapi.enviados.some((e) => e.chatId === GRUPOS.ventas && e.citar === null), 'sale por Ventas, sin citar el id del Despacho')
    const wa = armar({ canal: 'whatsapp', whapi: { caido: ['enviarTexto'] } })
    await cargar(wa, SIN_DNI)
    assert.equal(wa.avisos.length, 0)
  })
  test('si Discord falla, el aviso se reintenta en la vuelta siguiente', async () => {
    const m = armar({ discordFalla: true })
    const r = await cargar(m, SIN_DNI)
    assert.equal(m.avisos.length, 0)
    assert.equal((await m.almacen.leerAlta(r.json.altaId)).esperas.find((x) => x.estado === 'abierta').avisoDespacho, undefined)
  })
  test('canal: BOT_ALTA_CANAL manda; sin ella, despacho con el número caído y ambos si no se sabe', () => {
    assert.equal(CA.canalDesdeEntorno({ BOT_ALTA_CANAL: 'WhatsApp' }), 'whatsapp')
    assert.equal(CA.canalDesdeEntorno({}, { ok: false, conocido: true }), 'despacho')
    assert.equal(CA.canalDesdeEntorno({}, { ok: false, conocido: false }), 'ambos')
    assert.equal(CA.canalDesdeEntorno({}, null), 'ambos')
    assert.equal(AV.webhookAvisos({ DISCORD_WEBHOOK_URL: 'https://a', DISCORD_WEBHOOK_VERIFICACIONES: 'https://b' }), 'https://b')
    assert.equal(AV.webhookAvisos({ DISCORD_WEBHOOK_URL: 'https://a' }), 'https://a')
    assert.deepEqual(AV.mencionesDe('closer', { BOT_ALTA_APROBADORES_DISCORD: '123456789012345678, x' }), ['123456789012345678'])
  })
})

describe('Hecho a mano: comunidad, bienvenida y Skool con el número caído', () => {
  test('la comunidad queda en reintento; con "Hecho a mano" en los tres, el alta queda lista', async () => {
    const m = armar({ whapi: { caido: ['crearComunidad', 'enviarVideo', 'enviarTexto'] } })
    const r = await cargar(m)
    const id = r.json.altaId
    assert.equal((await estados(m, id)).comunidad, 'reintento')
    let v = VI.vistaDeAlta(await m.almacen.leerAlta(id), await m.almacen.leerPasos(id))
    assert.deepEqual(v.aMano.map((x) => x.paso), ['comunidad', 'bienvenida', 'skool'])
    assert.equal(v.aMano[0].titulo, 'A mano: crear grupos')
    assert.match(v.aMano[2].detalle[0], /ana@ejemplo\.com/)
    // Un closer no marca
    assert.equal((await m.post({ accion: 'a_mano', alta_id: id, paso: 'comunidad' }, [], { ...MARCOS, nombre: 'Yamila' })).status, 403)
    assert.equal((await m.post({ accion: 'a_mano', alta_id: id, paso: 'finanzas' }, [], AYLU)).status, 400)
    for (const paso of ['comunidad', 'bienvenida', 'skool']) assert.equal((await m.post({ accion: 'a_mano', alta_id: id, paso }, [], AYLU)).status, 202)
    const alta = await m.almacen.leerAlta(id)
    const p = await m.almacen.leerPasos(id)
    assert.equal(p.comunidad.estado, 'hecho'); assert.equal(p.comunidad.resultado.hechoAMano.por, 'Aylu')
    assert.equal(p.bienvenida.estado, 'hecho'); assert.equal(p.skool.estado, 'hecho')
    assert.equal(alta.estado, 'lista')
    v = VI.vistaDeAlta(alta, p)
    assert.deepEqual(v.aMano, [])
  })
  test('Skool con el canal Despacho (WhatsApp sano) queda a mano: el aviso no sale a Verificaciones', async () => {
    const m = armar()
    const r = await cargar(m)
    const id = r.json.altaId
    const e = await abierta(m, id, (x) => x.motivo === 'comunidad')
    assert.ok(e, 'la comunidad espera el OK de Aylu')
    await m.post({ accion: 'responder', alta_id: id, espera_id: e.id, texto: 'OK' }, [], AYLU)
    const p = await m.almacen.leerPasos(id)
    assert.equal(p.bienvenida.estado, 'hecho')
    assert.equal(p.skool.estado, 'reintento'); assert.equal(p.skool.error, CA.MOTIVO_CANAL_DESPACHO)
    assert.deepEqual(VI.vistaDeAlta(await m.almacen.leerAlta(id), p).aMano.map((x) => x.paso), ['skool'])
    await m.post({ accion: 'a_mano', alta_id: id, paso: 'skool' }, [], TOMAS)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
  })
})

describe('archivos del Despacho', () => {
  test('el cliente envuelto lee los ids del Despacho del almacén; en seco no lee; lo demás va a Whapi', async () => {
    const archivos = AR.archivosEnMemoria()
    const pa = EV.prepararArchivos([{ nombre: 'a.jpg', mime: 'image/jpeg', bytes: JPG }])
    await archivos.guardar(pa.archivos)
    const w = whapiJuguete()
    const c = AR.clienteConArchivosDespacho(w, () => archivos)
    const d = await c.descargarMedio(EV.refMedio(pa.archivos[0]))
    assert.equal(d.sha256, sha(JPG)); assert.equal(Buffer.from(d.base64, 'base64').length, JPG.length)
    await assert.rejects(c.descargarMedio({ ...EV.refMedio(pa.archivos[0]), id: 'despacho-arch-0000000000000000000000000000000000000000' }), (e) => e.tipo === 'no_encontrado')
    await assert.rejects(c.descargarMedio({ id: 'whapi-1', tipo: 'image', mime: 'image/jpeg' }), /no puede pedirse a Whapi/)
    const seco = AR.clienteConArchivosDespacho({ ...w, modo: 'seco' }, () => archivos)
    await assert.rejects(seco.descargarMedio(EV.refMedio(pa.archivos[0])), (e) => e.tipo === 'bloqueado')
  })
})
