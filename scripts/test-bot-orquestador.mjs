// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-orquestador.mjs
// Motor del bot de altas "Capital Jurídico" (BLOQUE O): modo, fusión de respuestas, lectura del comprobante (pura y con un
// Claude falso), setter/fuente, máquina de estados, interpretación de cada paso, flujos completos con el almacén en memoria y
// dependencias de juguete (Finanzas, CRM, Drive, PandaDoc, MEP, Claude y un Whapi de juguete propio), concurrencia, tiempo,
// modos seco/ensayo/real, el almacén de Neon con un cliente SQL falso y la ruta /api/bot/alta/motor sin Next.
// SIN red (fetch bloqueado), SIN base real y SIN Claude. Los nombres, teléfonos e ids son inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

for (const k of Object.keys(process.env)) {
  if (/^(BOT_|WHAPI_|PANDADOC_|PUENTE_DRIVE_|SHEET_ID_)/.test(k) || ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'CRON_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'VERCEL_ENV', 'DESPACHO_URL', 'PLANTILLA_GUIONES_ID'].includes(k)) delete process.env[k]
}
process.env.PANDADOC_PLANTILLA_NORMAL = 'plantilla-ficticia-normal'
process.env.PANDADOC_PLANTILLA_GARANTIA = 'plantilla-ficticia-garantia'
const RED_BLOQUEADA = async () => { throw new Error('red bloqueada en los tests') }
globalThis.fetch = RED_BLOQUEADA

const M = await import('../lib/bot/alta/motor/modo.ts')
const F = await import('../lib/bot/alta/motor/fusion.ts')
const C = await import('../lib/bot/alta/comprobante.ts')
const CC = await import('../lib/bot/alta/comprobanteClaude.ts')
const SF = await import('../lib/bot/alta/setterFuente.ts')
const E = await import('../lib/bot/alta/motor/estado.ts')
const P = await import('../lib/bot/alta/motor/pasos.ts')
const A = await import('../lib/bot/alta/motor/almacen.ts')
const O = await import('../lib/bot/alta/motor/orquestador.ts')
const N = await import('../lib/bot/alta/motor/almacenNeon.ts')
const R = await import('../lib/bot/alta/motor/rutaMotor.ts')
const S = await import('../lib/bot/alta/motor/servidor.ts')
const { parsearAlta, claveDeLinea } = await import('../lib/bot/alta/parsear.ts')
const { buscarRepetido, armarCarga } = await import('../lib/bot/alta/finanzasEscribir.ts')
const { duplicadoVigenteDe } = await import('../lib/bot/alta/crmEscribir.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')
const { ErrorBorrador } = await import('../lib/bot/alta/pandadoc.ts')

const sha = (s) => createHash('sha256').update(s).digest('hex')
const T0 = Date.parse('2026-10-26T13:00:00Z')   // lunes, 10:00 en Argentina
const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
const TOMI = '5491111111111', AYLU = '5492222222222', CLOSER = '5497777777777'
const EQUIPO = { 'Gero M': '5493333333333', Aylu: AYLU, 'Tomás': TOMI, 'Valentino Zalazar': '5494444444444', 'Francisco Girándola': '5495555555555', 'Faustino Gamarra': '5496666666666' }

const TEXTO = `#ALTA
Closer: Marcos
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
const TEL_ANA = '5491130001111'

// ── Whapi de juguete (propio: no depende de lib/bot/whapi) ──────────────────────────────────────────────────────────
function whapiJuguete(op = {}) {
  let n = 0
  const llamadas = [], enviados = []
  const fallas = op.fallas ?? {}
  const medios = op.medios ?? {}
  const err = (tipo, aplicado = tipo === 'dudoso' ? null : false) => Object.assign(new Error(`juguete: ${tipo}`), { name: 'ErrorWhapi', tipo, status: null, aplicado })
  const falla = (m) => { const f = fallas[m]; if (f?.length) { const x = f.shift(); if (x) throw typeof x === 'string' ? err(x) : x } }
  const anotar = (m, p) => { llamadas.push({ m, p }); falla(m) }
  return {
    modo: 'juguete', llamadas, enviados, err,
    async enviarTexto(p) { anotar('enviarTexto', p); const id = op.sinId ? null : `jg-${++n}`; enviados.push({ id, tipo: 'texto', ...p }); return { id, simulado: false } },
    async enviarVideo(p) { anotar('enviarVideo', p); const id = `jg-${++n}`; enviados.push({ id, tipo: 'video', ...p }); return { id, simulado: false } },
    async descargarMedio(m) {
      anotar('descargarMedio', m.id)
      const contenido = medios[m.id] ?? `contenido del archivo ${m.id}`
      return { base64: Buffer.from(contenido).toString('base64'), mime: m.mime, nombre: m.nombreArchivo ?? 'comprobante.jpg', bytes: Buffer.byteLength(contenido), sha256: sha(contenido) }
    },
    async crearComunidad(p) { anotar('crearComunidad', p); return { id: `com-${++n}@g.us`, nombre: p.nombre, codigoInvitacion: null } },
    async subgruposComunidad(id) { anotar('subgruposComunidad', id); return { avisos: { id: `avisos-${id}`, nombre: 'Avisos', codigoInvitacion: null }, otros: op.generalChat ? [{ id: 'general-auto@g.us', nombre: 'Comunidad', codigoInvitacion: 'GENAUTO', generalChat: true }] : (op.otros ?? []) } },
    async crearGrupoEnComunidad(p) { anotar('crearGrupoEnComunidad', p); return { id: `grupo-${++n}@g.us`, nombre: p.nombre, codigoInvitacion: `INV${n}`, agregados: p.participantes, fallidos: op.fallidos ?? [] } },
    async agregarParticipantes(p) { anotar('agregarParticipantes', p); return { agregados: p.participantes, fallidos: [] } },
    async ponerFoto(p) { anotar('ponerFoto', p) },
    async cambiarInfoGrupo(p) { anotar('cambiarInfoGrupo', p) },
    async linkInvitacion(id) { anotar('linkInvitacion', id); return `https://chat.whatsapp.com/L${id}` },
    async verificarNumeros(ns) { anotar('verificarNumeros', ns); return Object.fromEntries(ns.map((x) => [x, 'valido'])) },
    async agendarContacto(p) { anotar('agendarContacto', p) },
    ...(op.buscarComunidades ? { async buscarComunidades(p) { anotar('buscarComunidades', p); return op.buscarComunidades(p) } } : {}),
    registro: () => [],
  }
}

// ── Dependencias de juguete de los pasos ──
const lecturaOk = (over = {}) => ({ es_comprobante: true, legible: 'si', monto_texto: '1.100,00', moneda: 'USD', fecha: '2026-10-26', numero_operacion: 'OP-1', destinatario: 'Napolitano Tomás', ordenante: 'Ana Pérez', medio: 'Galicia', notas: '', ...over })
const finOk = (over = {}) => ({ ok: true, modo: 'real', etapa: 'listo', motivo: null, escribio: true, fila: 2, verificacion: null, comprobanteId: 'id-comprobante-123456789012', comprobanteUrl: 'https://drive.google.com/file/d/x/view', comprobanteYaExistia: false, noReintentarAntesDe: null, nombreArchivo: 'Ana Pérez - PP 1/3.jpeg', chip: 'puesto', pedidos: [], filaAnterior: [], controles: [], avisos: [], repetido: null, ...over })
const crmOk = (over = {}) => ({ ok: true, modo: 'real', etapa: 'listo', motivo: null, escribio: true, id: 'C-200', filaAgencia: 170, filaRenovaciones: 400, verificacion: null, pedidos: null, omitidas: [], formulasPrevias: null, avisos: [], previa: { faltantes: [], bloqueos: [], motivosNoApto: [], lectura: null, aptoParaEscribir: true }, duplicadoVigente: null, ...over })
const ID_CARPETA = 'carpeta_ana_1234567890123'
const driveOk = (over = {}) => ({ modo: 'real', ok: true, completo: true, esperaOk: null, nombres: { cliente: 'Ana Pérez', carpeta: 'Ana Pérez - C.J' }, carpeta: { nombre: 'Ana Pérez - C.J', estado: 'creado', id: ID_CARPETA, url: 'https://drive/c' }, crudos: {}, editados: {}, guiones: {}, bienvenida: {}, guardar: { carpeta: { id: ID_CARPETA, url: 'https://drive/c' } }, intentoCarpeta: null, noReintentarAntesDe: null, pendientes: [], errores: [], llamadas: [], ...over })

function depsJuguete(over = {}) {
  const llamadas = { finanzas: [], crm: [], drive: [], contrato: [], mep: [], vision: [], setter: [] }
  const colas = { finanzas: [], crm: [], drive: [], vision: [], contrato: [] }
  const tomar = (k, def) => (colas[k].length ? colas[k].shift() : def)
  const pasos = {
    finanzas: async (fila, comprobante, op) => { llamadas.finanzas.push({ fila, comprobante, op }); const r = tomar('finanzas', finOk({ modo: op.modo })); if (r instanceof Error) throw r; return typeof r === 'function' ? r(fila) : r },
    crm: async (a, extras, op) => { llamadas.crm.push({ a, extras, op }); const r = tomar('crm', crmOk({ modo: op.modo })); if (r instanceof Error) throw r; return r },
    drive: async (a, op) => { llamadas.drive.push({ a, op }); const r = tomar('drive', op.modo === 'simulacion' ? driveOk({ modo: 'simulacion', guardar: {} }) : driveOk()); if (r instanceof Error) throw r; return r },
    contrato: {
      hayClave: () => over.hayClave ?? true,
      crear: async (a, op) => { llamadas.contrato.push({ a, op }); const r = tomar('contrato', null); if (r instanceof Error) { if (r.alCrear) await op.alCrear(r.alCrear); throw r } await op.alCrear('doc-123'); return { id: 'doc-123', estado: 'document.draft', link: 'https://app.pandadoc.com/a/#/documents/doc-123', nombre: 'Contrato - Ana Pérez - C.J', plantilla: 'x', faltantes: [], clave: 'PANDADOC_API_KEY', direccion: null } },
      estado: async () => 'document.draft',
      buscar: async (nombre, desde) => { llamadas.contrato.push({ buscar: nombre, desde }); return over.buscarContrato ? over.buscarContrato(nombre, desde) : [] },
    },
    mep: async (f) => { llamadas.mep.push(f); return over.mep ? over.mep(f) : { venta: 1500, diaAnterior: '2026-10-25', fechaCotizacion: '2026-10-24' } },
    vision: async (m) => { llamadas.vision.push(m.sha256); const r = tomar('vision', { modelo: 'claude-haiku-5-5', salida: lecturaOk(), tokens: { entrada: 1, salida: 1 } }); if (r instanceof Error) throw r; return r },
    setterFuente: async (tel) => { llamadas.setter.push(tel); return over.setterFuente !== undefined ? over.setterFuente : { setter: 'Mai', setterTexto: 'Mai', fuente: 'Inbound IG', hoja: 'Closer 2', fila: 500, coincidencias: 1 } },
    plantillaGuionesId: () => 'plantilla_guiones_12345678901',
    modeloVision: 'claude-haiku-5-5',
    equipo: EQUIPO, aprobadores: [TOMI], operaciones: [AYLU],
    fotos: { comunidad: { url: 'https://d/bot/foto-grupo-cj-640.jpg' }, General: { url: 'https://d/bot/grupo-general.jpg' }, Ventas: { url: 'https://d/bot/grupo-ventas.jpg' }, Contenido: { url: 'https://d/bot/grupo-contenido.jpg' } },
    maxComunidadesDia: over.maxComunidadesDia ?? 2,
    esperar: async () => {}, azar: () => 0,
    ...(over.pasos ?? {}),
  }
  return { pasos, llamadas, colas }
}

const TODAS = new Set(M.CAPACIDADES)
let relojGlobal = T0
function motorDe(over = {}) {
  const reloj = { t: over.t ?? T0 }
  const ahora = () => reloj.t
  const almacen = over.almacen ?? A.almacenEnMemoria({ ahora })
  const whapi = over.whapi ?? whapiJuguete(over.whapiOp)
  const dj = depsJuguete(over)
  const continuaciones = [], despertadores = []
  const logs = []
  const motor = O.crearOrquestador({
    whapi, modo: over.modo ?? 'real', capacidades: over.capacidades ?? TODAS, grupos: GRUPOS, ahora, almacen, pasos: dj.pasos,
    entorno: 'test', produccion: over.produccion ?? true,
    dispararContinuacion: async (d) => { continuaciones.push(d) }, dispararDespertador: async (d) => { despertadores.push(d) }, despertador: true,
    dormir: async () => {}, log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  })
  const op = () => ({ hasta: reloj.t + 285_000, invocacion: `inv-${Math.random().toString(36).slice(2, 8)}` })
  const correr = async (evs) => { const r = await motor.registrar(evs); return motor.procesar(r.nuevos, op()) }
  return { motor, almacen, whapi, dj, reloj, continuaciones, despertadores, logs, op, correr }
}

let nMsg = 0
const iso = (ms) => new Date(ms).toISOString()
const base = (over = {}) => {
  const id = over.id ?? `MSG${++nMsg}`
  return { clave: over.clave ?? id, mensajeId: id, chatId: over.chatId ?? GRUPOS.ventas, grupo: over.grupo ?? 'ventas', autor: over.autor ?? { telefono: CLOSER, lid: null, nombre: 'Marcos' }, enviadoEn: over.enviadoEn ?? iso(relojGlobal + nMsg), recibidoEn: iso(relojGlobal), citado: over.citado ?? null }
}
const medio = (id = 'img1', over = {}) => ({ id, tipo: 'image', mime: 'image/jpeg', tamano: 200_000, sha256Whapi: null, nombreArchivo: `${id}.jpg`, link: null, paginas: null, pie: null, ...over })
const evAlta = (texto = TEXTO, over = {}) => ({ ...base(over), tipo: 'alta', grupo: 'ventas', texto, medios: over.medios ?? [medio(`img-${nMsg + 1}`)] })
const evAdjunto = (over = {}) => ({ ...base(over), tipo: 'adjunto', grupo: 'ventas', medios: over.medios ?? [medio(`adj-${nMsg + 1}`)], albumEsperado: null })
const verOk = (resto = '') => ({ tipo: 'ok', resto })
const verNo = (motivo = '') => ({ tipo: 'no', motivo })
const evResp = (texto, over = {}) => ({ ...base({ grupo: 'verificaciones', chatId: GRUPOS.verificaciones, autor: { telefono: TOMI, lid: null, nombre: 'Tomi' }, ...over }), tipo: 'respuesta', texto, veredicto: over.veredicto !== undefined ? over.veredicto : O.veredictoDe(texto) })
const evEco = (texto, id, over = {}) => ({ ...base({ id, ...over }), tipo: 'eco', texto })

/** El id del mensaje con el que se pidió la espera abierta de ese motivo (para citarlo). */
async function pedidoDe(m, altaId, motivo) {
  const alta = await m.almacen.leerAlta(altaId)
  const e = alta.esperas.find((x) => x.motivo === motivo && x.estado === 'abierta')
  assert.ok(e, `no hay espera abierta de ${motivo}: ${JSON.stringify(alta.esperas.map((x) => [x.motivo, x.estado]))}`)
  assert.ok(e.mensajes.length, `la espera ${e.id} no tiene mensaje`)
  return e.mensajes[0]
}
const pasosDe = (m, id) => m.almacen.leerPasos(id)
/** Reglas del 26/10/2026 (Tomás: el #ALTA usa las mismas reglas que el formato libre): un Fee pide un OK en Verificaciones
 *  ("¿Lo cargo en Finanzas y creo la comunidad?") y después corre la comunidad, que espera el OK de Aylu. Responde los dos. */
async function aprobarFee(m, id) {
  for (let i = 0; i < 4; i++) {
    const e = (await m.almacen.leerAlta(id)).esperas.find((x) => x.estado === 'abierta' && ((x.motivo === 'confirmacion' && x.datos?.fee) || x.motivo === 'comunidad'))
    if (!e) return
    const autor = e.motivo === 'comunidad' ? { telefono: AYLU, lid: null, nombre: 'Aylu' } : undefined
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null }, ...(autor ? { autor } : {}) })])
  }
}
const estadosPasos = async (m, id) => Object.fromEntries(Object.entries(await pasosDe(m, id)).map(([k, v]) => [k, v.estado]))

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('modo (contrato del día 0)', () => {
  test('sin BOT_ALTA_MODO o mal escrito → seco; solo "real" y "ensayo" exactos', () => {
    assert.equal(M.modoDesdeEntorno({}), 'seco')
    assert.equal(M.modoDesdeEntorno({ BOT_ALTA_MODO: 'Real' }), 'seco')
    assert.equal(M.modoDesdeEntorno({ BOT_ALTA_MODO: 'real ' }), 'seco')
    assert.equal(M.modoDesdeEntorno({ BOT_ALTA_MODO: 'real' }), 'real')
    assert.equal(M.modoDesdeEntorno({ BOT_ALTA_MODO: 'ensayo' }), 'ensayo')
  })
  test('capacidades: seco vacío, ensayo solo el reporte, real lo que se pide (los nombres desconocidos se ignoran)', () => {
    const env = { BOT_ALTA_PASOS_REALES: 'finanzas, crm,drive,inventada,reporte_verificaciones' }
    const warn = console.warn; console.warn = () => {}
    try {
      assert.deepEqual([...M.capacidadesReales('seco', env)], [])
      assert.deepEqual([...M.capacidadesReales('ensayo', env)], ['reporte_verificaciones'])
      assert.deepEqual([...M.capacidadesReales('real', env)].sort(), ['crm', 'drive', 'finanzas', 'reporte_verificaciones'])
    } finally { console.warn = warn }
    assert.deepEqual(M.capacidadesDesconocidas(env), ['inventada'])
  })
  test('puede() y menorModo: el entorno solo baja', () => {
    const caps = new Set(['finanzas', 'reporte_verificaciones'])
    assert.equal(M.puede('finanzas', 'seco', caps), false)
    assert.equal(M.puede('finanzas', 'ensayo', caps), false)
    assert.equal(M.puede('reporte_verificaciones', 'ensayo', caps), true)
    assert.equal(M.puede('finanzas', 'real', caps), true)
    assert.equal(M.puede('crm', 'real', caps), false)
    assert.equal(M.menorModo('real', 'seco'), 'seco')
    assert.equal(M.menorModo('ensayo', 'real'), 'ensayo')
    assert.equal(M.modoMenorQue('seco', 'real'), true)
  })
})

describe('fusión de la respuesta del closer', () => {
  test('claveDeLinea usa la tabla del parser', () => {
    assert.equal(claveDeLinea('Teléfono: +54 9 11 1234-5678'), 'telefono')
    assert.equal(claveDeLinea('Nombre completo del lead: Ana'), 'nombre')
    assert.equal(claveDeLinea('Setter: Mai'), null)
    assert.equal(claveDeLinea('sin clave'), null)
  })
  test('reemplaza la línea (sin duplicar teléfonos) y suma las nuevas antes de "Cuotas:"', () => {
    const sinDni = TEXTO.replace('DNI: 30111222\n', '')
    const f = F.fusionarRespuesta(sinDni, 'Teléfono: +54 9 11 3000-2222\nDNI: 30111222')
    const a = parsearAlta(f.texto)
    assert.equal(a.telefonos.length, 1)
    assert.equal(a.telefonos[0].numero, '5491130002222')
    assert.equal(a.dni, '30111222')
    assert.ok(f.texto.indexOf('DNI:') < f.texto.indexOf('Cuotas:'))
    assert.deepEqual(f.cambios.map((c) => [c.campo, c.tipo]), [['telefono', 'corrige'], ['dni', 'completa']])
  })
  test('"Cuotas:" en la respuesta reemplaza el bloque entero (no se acumulan)', () => {
    const f = F.fusionarRespuesta(TEXTO, 'Cuotas:\n26/11/2026 2200')
    const a = parsearAlta(f.texto)
    assert.deepEqual(a.cuotas.map((c) => [c.fecha, c.montoUsd]), [['2026-11-26', 2200]])
    assert.equal(f.cambios[0].campo, 'cuotas')
    assert.equal(f.cambios[0].tipo, 'corrige')
  })
  test('extras (Setter, Fuente, Cuenta) y líneas reconocidas', () => {
    assert.deepEqual(F.extrasDeRespuesta('Setter: Mai\nFuente: Inbound IG\nCuenta que recibió: Empresa\nHola'), { setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Empresa' })
    assert.equal(F.lineasReconocidas('Buen día equipo'), 0)
    assert.equal(F.lineasReconocidas('DNI: 1\nSetter: Mai'), 2)
  })
})

describe('comprobante (parte pura)', () => {
  const a = parsearAlta(TEXTO)
  const hoy = '2026-10-26'
  test('coincide con ±1 % y saca destinatario, fecha y n.º de operación', () => {
    const r = C.compararComprobante(C.leerSalida(lecturaOk({ monto_texto: 'USD 1,105.00' })), a, { hoy })
    assert.equal(r.resultado, 'coincide')
    assert.deepEqual(r.extras, { destinatario: 'Napolitano Tomás', numeroOperacion: 'OP-1', fechaPago: '2026-10-26' })
  })
  test('difiere: monto, pesos contra USD, fecha futura o vieja, operación ya usada', () => {
    assert.match(C.compararComprobante(lecturaOk({ monto_texto: '900' }), a, { hoy }).diferencias[0], /Monto/)
    const pesos = C.compararComprobante(lecturaOk({ moneda: 'ARS', monto_texto: '1.650.000' }), a, { hoy })
    assert.equal(pesos.resultado, 'difiere'); assert.equal(pesos.extras.pesosArs, 1650000)
    assert.match(C.compararComprobante(lecturaOk({ fecha: '2026-10-30' }), a, { hoy }).diferencias.join(), /posterior/)
    assert.match(C.compararComprobante(lecturaOk({ fecha: '2026-08-01' }), a, { hoy }).diferencias.join(), /30 días/)
    assert.match(C.compararComprobante(lecturaOk(), a, { hoy, operacionUsadaEn: 'alta_x' }).diferencias.join(), /operación/)
    assert.equal(C.compararComprobante(lecturaOk({ moneda: 'USDT' }), a, { hoy }).resultado, 'coincide')
  })
  test('pago en pesos en el #ALTA contra comprobante en pesos', () => {
    const ap = parsearAlta(TEXTO.replace('Este pago: 1100 USD · Transferencia USD (Galicia)', 'Este pago: $1.650.000 ARS · Mercado Pago'))
    const r = C.compararComprobante(lecturaOk({ moneda: 'ARS', monto_texto: '1.650.000,00' }), ap, { hoy })
    assert.equal(r.resultado, 'coincide'); assert.equal(r.extras.pesosArs, 1650000)
  })
  test('campos vacíos → avisos; no es comprobante / ilegible', () => {
    const r = C.compararComprobante(lecturaOk({ monto_texto: '', fecha: '', destinatario: '' }), a, { hoy })
    assert.equal(r.resultado, 'coincide'); assert.equal(r.avisos.length, 3)
    assert.equal(C.compararComprobante(lecturaOk({ es_comprobante: false }), a, { hoy }).resultado, 'no_es_comprobante')
    assert.equal(C.compararComprobante(lecturaOk({ legible: 'no' }), a, { hoy }).resultado, 'ilegible')
  })
  // Tomás, 1/11/2026: Nadia Blanco, #ALTA de USD 1.299 con un comprobante de ₲ 3.107.995 (unos USD 500 por dLocal)
  test('otra moneda: se pasa a USD con la cotización y se compara con el #ALTA', () => {
    const pyg = { iso: 'PYG', porUsd: 5762.89, fecha: '2026-10-26', fuente: 'currency-api' }
    const nadia = (usdAlta, extra = {}) => C.compararComprobante(C.leerSalida(lecturaOk({ moneda: 'otra', moneda_iso: 'PYG', monto_texto: '3.107.995' })),
      parsearAlta(TEXTO.replace('Este pago: 1100 USD', `Este pago: ${usdAlta} USD`)), { hoy, cotizacion: pyg, ...extra })
    const mal = nadia(1299)
    assert.equal(mal.resultado, 'difiere')
    assert.match(mal.diferencias[0], /PYG 3\.107\.995 \(≈ USD 539 al cambio del 26\/10\/2026\) y el #ALTA USD 1\.299/)
    assert.equal(mal.extras.usdEstimado, 539)
    const bien = nadia(500)   // dLocal cobró a ₲ 6.216: 8 % de diferencia con el mercado, dentro del margen
    assert.equal(bien.resultado, 'coincide'); assert.match(bien.avisos.join(), /coincide con el #ALTA/)
    // Sin cotización (o de otra moneda): no se puede comparar → lo mira un humano
    assert.match(nadia(500, { cotizacion: null }).diferencias.join(), /no se pudo pasar a USD/)
    assert.equal(nadia(500, { cotizacion: { ...pyg, iso: 'UYU' } }).resultado, 'difiere')
  })
  test('moneda_iso: solo con "otra" y si es un código válido; las lecturas viejas no lo traen', () => {
    assert.equal(C.leerSalida(lecturaOk({ moneda: 'otra', moneda_iso: 'pyg' })).moneda_iso, 'PYG')
    assert.equal(C.leerSalida(lecturaOk({ moneda: 'USD', moneda_iso: 'PYG' })).moneda_iso, '')
    assert.equal(C.leerSalida(lecturaOk({ moneda: 'otra', moneda_iso: 'guaraní' })).moneda_iso, '')
    const vieja = lecturaOk({ moneda: 'otra' }); delete vieja.moneda_iso
    assert.equal(C.leerSalida(vieja).moneda_iso, '')
  })
  test('sin moneda visible: igual se compara el número', () => {
    assert.match(C.compararComprobante(lecturaOk({ moneda: 'desconocida', monto_texto: '3.107.995' }), a, { hoy }).diferencias.join(), /sin moneda visible/)
    assert.equal(C.compararComprobante(lecturaOk({ moneda: 'desconocida', monto_texto: '1100' }), a, { hoy }).resultado, 'coincide')
  })
  test('cotizacionDe: lee el JSON de currency-api', async () => {
    const K = await import('../lib/bot/alta/cotizacion.ts')
    assert.deepEqual(K.cotizacionDe({ date: '2026-10-26', usd: { pyg: 5762.89 } }, 'PYG'), { iso: 'PYG', porUsd: 5762.89, fecha: '2026-10-26', fuente: 'currency-api' })
    assert.equal(K.cotizacionDe({ usd: { pyg: 0 } }, 'PYG'), null)
    assert.equal(K.cotizacionDe({ usd: {} }, 'PYG'), null)
    assert.equal(K.cotizacionDe({ usd: { pyg: 1 } }, 'pyg'), null)
  })
  test('formatos: HEIC no; imagen de más de 5 MB no; PDF de más de 10 páginas no', () => {
    assert.equal(C.formatoComprobante('image/heic', 100, null).ok, false)
    assert.equal(C.formatoComprobante('image/jpeg', 6 * 1024 * 1024, null).ok, false)
    assert.equal(C.formatoComprobante('application/pdf', 1000, 11).ok, false)
    assert.deepEqual(C.formatoComprobante('image/jpg', 1000, null), { ok: true, tipo: 'image', mime: 'image/jpeg' })
  })
  test('leerSalida rechaza lo que no tiene la forma del esquema', () => {
    assert.throws(() => C.leerSalida({ es_comprobante: 'si' }))
    assert.throws(() => C.leerSalida({ ...lecturaOk(), moneda: 'EUR' }))
    assert.equal(C.leerSalida({ ...lecturaOk(), notas: 'x\u0000y' }).notas, 'x y')
  })
})

describe('lectura con Claude (cliente falso)', () => {
  const medioDesc = { base64: Buffer.from('jpg').toString('base64'), mime: 'image/jpeg', bytes: 3 }
  const cliente = (respuesta) => { const pedidos = []; return { pedidos, beta: { messages: { create: async (b, o) => { pedidos.push({ b, o }); if (respuesta instanceof Error) throw respuesta; return respuesta } } } } }
  const fin = (texto, over = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], usage: { input_tokens: 10, output_tokens: 5 }, ...over })
  test('arma el pedido con la imagen, el esquema y sin fallback en Haiku', async () => {
    const c = cliente(fin(JSON.stringify(lecturaOk())))
    const r = await CC.leerComprobanteConClaude(medioDesc, { cliente: c, modelo: 'claude-haiku-5-5' })
    assert.equal(r.salida.destinatario, 'Napolitano Tomás')
    const b = c.pedidos[0].b
    assert.equal(b.model, 'claude-haiku-5-5'); assert.equal(b.fallbacks, undefined)
    assert.equal(b.messages[0].content[0].type, 'image'); assert.equal(b.output_config.format.type, 'json_schema')
    assert.equal(c.pedidos[0].o.maxRetries, 0)
  })
  test('con Opus 5.5: fallbacks "default"; vale el texto después del último bloque fallback', async () => {
    const c = cliente({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'basura' }, { type: 'fallback' }, { type: 'text', text: JSON.stringify(lecturaOk({ medio: 'Stripe' })) }] })
    const r = await CC.leerComprobanteConClaude({ ...medioDesc, mime: 'application/pdf' }, { cliente: c, modelo: 'claude-opus-5-5' })
    assert.equal(r.salida.medio, 'Stripe')
    assert.equal(c.pedidos[0].b.fallbacks, 'default'); assert.deepEqual(c.pedidos[0].b.betas, ['server-side-fallback-2026-07-01'])
    assert.equal(c.pedidos[0].b.messages[0].content[0].type, 'document')
  })
  test('refusal, max_tokens y JSON roto son errores comunes; 529 es transitorio', async () => {
    await assert.rejects(CC.leerComprobanteConClaude(medioDesc, { cliente: cliente(fin('{}', { stop_reason: 'refusal', stop_details: { category: 'cyber' } })) }), /rechazo/)
    await assert.rejects(CC.leerComprobanteConClaude(medioDesc, { cliente: cliente(fin('{}', { stop_reason: 'max_tokens' })) }), /max_tokens/)
    await assert.rejects(CC.leerComprobanteConClaude(medioDesc, { cliente: cliente(fin('no json')) }), /JSON/)
    const e529 = Object.assign(new Error('overloaded'), { status: 529 })
    await assert.rejects(CC.leerComprobanteConClaude(medioDesc, { cliente: cliente(e529) }), (e) => e instanceof ErrorTransitorio)
    await assert.rejects(CC.leerComprobanteConClaude({ ...medioDesc, mime: 'image/heic' }, { cliente: cliente(fin('{}')) }), /formato/)
  })
  test('sin clave y sin cliente no sale a la red', async () => {
    await assert.rejects(CC.leerComprobanteConClaude(medioDesc, {}), /falta BOT_ANTHROPIC_API_KEY/)
  })
})

describe('setter y fuente del CRM de ventas', () => {
  test('setterAOpcion traduce a la lista de Finanzas', () => {
    assert.equal(SF.setterAOpcion('Mai'), 'Mai')
    assert.equal(SF.setterAOpcion('maite'), 'Mai')
    assert.equal(SF.setterAOpcion('ENRU'), 'ENRU / Mai')
    assert.equal(SF.setterAOpcion('Tomás'), 'Tomi / Gero')
    assert.equal(SF.setterAOpcion('Tomi / Gero'), 'Tomi / Gero')
    assert.equal(SF.setterAOpcion('Pepe'), null)
  })
  test('setterAOpcion: "Mai" y "Maite" son Maite (Tomás, 25/10/2026)', () => {
    assert.equal(SF.setterAOpcion('Maite'), 'Mai'); assert.equal(SF.setterAOpcion('MAI'), 'Mai'); assert.equal(SF.setterAOpcion('mai'), 'Mai')
    assert.equal(SF.setterAOpcion('Maitena'), null); assert.equal(SF.setterAOpcion(''), null); assert.equal(SF.setterAOpcion(null), null)
  })
  test('fuenteDeUtm: la regla UTM → fuente de Finanzas (cruce del 25/10/2026)', () => {
    const f = (medium, campaign = '', source = '') => SF.fuenteDeUtm({ medium, campaign, source }).fuente
    assert.equal(f('paid_social', 'VSL+Funnel+-+8/3/26', 'ig'), 'VSL Funnel')
    assert.equal(f('paid_social', 'RETARGETING+VSL+FUNNEL+-+13/8/26', 'fb'), 'VSL Funnel')
    assert.equal(f('paid', '120238067096030317', 'fb'), 'VSL Funnel')
    assert.equal(f('paid_social', '{{campaign.name}}', '{{site_source_name}}'), 'VSL Funnel')
    assert.equal(f('inbound', 'ig', 'mai'), 'Inbound IG')
    assert.equal(f('ig', 'inbound', 'mai'), 'Inbound IG')
    assert.equal(f('ig', 'vsl', 'ig'), 'BIO Página Web')
    assert.equal(f('enrutamiento', 'wsp', 'mai'), 'Enrutamiento')
    assert.equal(f('refe', 'wsp', 'mamá'), 'Referido')
    assert.equal(f('webinar', 'zoom', ''), 'Webinar')
    // lo que no tiene regla no se adivina
    assert.equal(f('ig', 'wsp', 'ig'), null)
    assert.equal(f('social', '', 'ig'), null)
    assert.equal(f('', 'wsp', 'mai'), null)
    assert.equal(f('', '', ''), null)
    assert.match(SF.fuenteDeUtm(null).regla, /no tiene UTM/)
    assert.match(SF.fuenteDeUtm({ medium: 'ig', campaign: 'wsp' }).regla, /Inbound IG o BIO Página Web/)
    assert.equal(SF.utmNormal('VSL+Funnel+-+8%2F3%2F26'), 'vsl funnel - 8/3/26')
  })
  test('fuenteAOpcion: texto libre del closer o de un aprobador → la lista (sin adivinar)', () => {
    assert.equal(SF.fuenteAOpcion('Anuncio'), 'VSL Funnel')
    assert.equal(SF.fuenteAOpcion('vsl funnel'), 'VSL Funnel')
    assert.equal(SF.fuenteAOpcion('Tomi VSL Funnel'), 'VSL Funnel')
    assert.equal(SF.fuenteAOpcion('instagram'), 'Inbound IG')
    assert.equal(SF.fuenteAOpcion('Inbound Tiktok'), 'Inbound Tiktok')
    assert.equal(SF.fuenteAOpcion('BIO pagina web'), 'BIO Página Web')
    assert.equal(SF.fuenteAOpcion('referida por un cliente'), 'Referido')
    assert.equal(SF.fuenteAOpcion('Outbound'), 'Outbound')
    assert.equal(SF.fuenteAOpcion('anuncio de IG'), null)   // dos fuentes: no se elige
    assert.equal(SF.fuenteAOpcion('no sé'), null)
    assert.equal(SF.fuenteAOpcion(''), null)
  })
  test('elegirFila: por los últimos dígitos (si no, por correo), la más reciente con UTM; la fuente sale de los UTM', async () => {
    const filas = [
      { hoja: 'Closer 1', numeroFila: 300, telefono: '+54 9 11 3000-1111', setter: '', fuente: '', campania: '' },
      { hoja: 'Closer 2', numeroFila: 480, telefono: '11 3000 1111', setter: 'mai', fuente: 'inbound', campania: 'ig', email: 'ana@ejemplo.com' },
      { hoja: 'Closer 2', numeroFila: 490, telefono: '5491199998888', setter: 'fb', fuente: 'paid_social', campania: 'VSL+Funnel+-+8/3/26', email: 'beto@ejemplo.com' },
    ]
    const r = SF.elegirFila(filas, TEL_ANA)
    assert.deepEqual([r.setter, r.fuente, r.fila, r.coincidencias, r.por], ['Mai', 'Inbound IG', 480, 2, 'telefono'])
    assert.deepEqual(r.utm, { source: 'mai', medium: 'inbound', campaign: 'ig' })
    assert.equal(SF.elegirFila(filas, '123'), null)
    const porCorreo = SF.elegirFila(filas, '5491170000000', 'BETO@ejemplo.com ')
    // utm_source "fb" → "Tomi / Gero" (Tomás, 25/10/2026)
    assert.deepEqual([porCorreo.setter, porCorreo.fuente, porCorreo.fila, porCorreo.por], ['Tomi / Gero', 'VSL Funnel', 490, 'correo'])
    // enrutamiento con utm_source "mai" → "ENRU / Mai"
    const enru = SF.elegirFila([{ hoja: 'Closer 1', numeroFila: 7, telefono: TEL_ANA, setter: 'mai', fuente: 'enrutamiento', campania: 'wsp' }], TEL_ANA)
    assert.deepEqual([enru.setter, enru.fuente], ['ENRU / Mai', 'Enrutamiento'])
    assert.deepEqual((await SF.buscarSetterFuente(TEL_ANA, { leer: async () => filas })).fila, 480)
    // sin regla: fuente vacía (el motor la resuelve con el closer o en Verificaciones)
    const raro = SF.elegirFila([{ hoja: 'Closer 1', numeroFila: 9, telefono: TEL_ANA, setter: 'ig', fuente: 'ig', campania: 'wsp' }], TEL_ANA)
    assert.equal(raro.fuente, ''); assert.match(raro.reglaFuente, /no alcanza/)
  })
})

describe('arreglos aditivos en los pasos existentes', () => {
  test('finanzasEscribir: armarCarga devuelve `repetido` con la fila', () => {
    const celdas = { A: 46321, C: 'Ana Pérez', E: 1100 }
    assert.equal(buscarRepetido([[46321, '', 'Ana Pérez', '', 1100]], celdas), 2)
    const fila = { celdas: { A: 46321, B: 'DFY | PP | $3300', C: 'Ana Pérez', D: '54 9 11 3000-1111', E: 1100, F: '', G: 'Marcos', H: 'Mai', I: 'Ana Pérez - PP 1/3', J: '1ra Cuota', K: 'Inbound IG', L: '', M: '=x', N: 'Front-end', O: 'Payment Plan', P: null, Q: null, R: 'Tomi' }, fila: new Array(18).fill(''), pendientes: [], avisos: [] }
    const enc = ['Fecha', 'Programa', 'Nombre del Cliente', 'Telefono', 'Efectivo Recaudado', 'Pesos ARS', 'Closer', 'Setter', 'Comprobante', 'Concepto', 'Fuente', 'Comisión', 'Mes', 'Tipos de venta', 'Tipo de pago', '', '', 'Cuenta que recibió']
    const carga = armarCarga(fila, { encabezados: enc, filas: [[46321, '', 'Ana Pérez', '', 1100]], estructura: { sheetId: 1, filasHoja: 100, validaciones: [], chips: [] } })
    assert.equal(carga.ok, false); assert.deepEqual(carga.repetido, { fila: 2 })
  })
  test('crmEscribir: duplicadoVigenteDe solo cuenta ACTIVO o PAUSADO', () => {
    assert.deepEqual(duplicadoVigenteDe({ duplicados: [{ id: 'C-1', linea: 'agencia', motivo: 'mail', estado: 'FINALIZADO' }, { id: 'C-2', linea: 'agencia', motivo: 'celular', estado: 'PAUSADO' }] }), { id: 'C-2', motivo: 'celular' })
    assert.equal(duplicadoVigenteDe({ duplicados: [{ id: 'C-1', linea: 'agencia', motivo: 'mail', estado: 'INACTIVO' }] }), null)
  })
})

describe('máquina de estados (siguienteAccion)', () => {
  const pasosCon = (estados = {}) => Object.fromEntries(['validar', 'finanzas', 'crm', 'drive', 'comunidad', 'bienvenida', 'skool', 'contrato'].map((p) => [p, { ...A.pasoVacio(p), ...(estados[p] ?? {}) }]))
  const altaCon = (plan, over = {}) => ({ estado: 'en_curso', esperas: [], medios: [medio()], creado: iso(T0), validacion: plan ? { ...A.validacionVacia(), estadoPlan: plan } : null, ...over })
  const PLAZO = T0 + 285_000
  const sigue = (alta, pasos, t = T0, plazo = PLAZO, ctx = { simulada: false }) => E.siguienteAccion(alta, pasos, t, plazo, ctx)
  test('validar primero; con lista, en el orden de PASOS', () => {
    assert.deepEqual(sigue(altaCon(null), pasosCon()), { tipo: 'correr', paso: 'validar', hasta: T0 + 75_000 })
    assert.equal(sigue(altaCon('lista'), pasosCon({ validar: { estado: 'hecho' } })).paso, 'finanzas')
    assert.equal(sigue(altaCon('lista'), pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'espera' } })).paso, 'crm')
  })
  test('validar en espera frena todo; el Fee solo corre Finanzas y termina en fee', () => {
    assert.deepEqual(sigue(altaCon(null), pasosCon({ validar: { estado: 'espera' } })), { tipo: 'esperar_humano' })
    const fee = pasosCon({ validar: { estado: 'hecho' } })
    assert.equal(sigue(altaCon('fee'), fee).paso, 'finanzas')
    // 26/10/2026: un Fee aprobado también arma la comunidad (nada de CRM, Drive, Skool, bienvenida ni contrato)
    assert.equal(sigue(altaCon('fee'), pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'hecho' } })).paso, 'comunidad')
    assert.deepEqual(sigue(altaCon('fee'), pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'hecho' }, comunidad: { estado: 'hecho' } })), { tipo: 'terminar', estado: 'fee' })
  })
  test('noReintentarAntesDe y un corriendo viejo (dudoso)', () => {
    const t = T0 + 60_000
    const p = pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'reintento', noAntesDe: iso(T0 + 600_000) }, crm: { estado: 'hecho' }, drive: { estado: 'hecho' }, comunidad: { estado: 'hecho' }, bienvenida: { estado: 'hecho' }, skool: { estado: 'hecho' }, contrato: { estado: 'hecho' } })
    assert.deepEqual(sigue(altaCon('lista'), p, t), { tipo: 'esperar_hasta', cuando: iso(T0 + 600_000) })
    const c = pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'corriendo', iniciado: iso(T0) } })
    assert.equal(sigue(altaCon('lista'), c, T0 + 60_000).paso, 'crm')
    assert.equal(sigue(altaCon('lista'), c, T0 + 661_000, T0 + 661_000 + 285_000).paso, 'finanzas')
    assert.equal(E.estadoListo(c.finanzas, T0 + 661_000).dudoso, true)
  })
  test('si no entra en lo que queda del plazo → otra invocación', () => {
    assert.deepEqual(sigue(altaCon('lista'), pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'hecho' }, crm: { estado: 'hecho' } }), T0 + 100_000), { tipo: 'otra_invocacion', paso: 'drive' })
  })
  test('la bienvenida espera la comunidad con el OK de Aylu; Skool no espera la bienvenida', () => {
    const p = pasosCon({ validar: { estado: 'hecho' }, finanzas: { estado: 'hecho' }, crm: { estado: 'hecho' }, drive: { estado: 'hecho' }, comunidad: { estado: 'espera' }, contrato: { estado: 'hecho' } })
    assert.equal(sigue(altaCon('lista'), p).paso, 'skool')
    p.skool.estado = 'hecho'
    assert.deepEqual(sigue(altaCon('lista'), p), { tipo: 'esperar_humano' })
    p.comunidad.estado = 'hecho'
    assert.equal(sigue(altaCon('lista'), p).paso, 'bienvenida')
  })
  test('simulada: el plan con faltantes corre igual como vista previa; pausados por el entorno esperan 1 h', () => {
    assert.equal(sigue(altaCon('faltan_datos'), pasosCon({ validar: { estado: 'simulado' } }), T0, PLAZO, { simulada: true }).paso, 'finanzas')
    const r = sigue(altaCon('lista'), pasosCon({ validar: { estado: 'hecho' }, crm: { estado: 'hecho' }, drive: { estado: 'hecho' }, comunidad: { estado: 'hecho' }, bienvenida: { estado: 'hecho' }, skool: { estado: 'hecho' }, contrato: { estado: 'hecho' } }), T0, PLAZO, { simulada: false, pausados: new Set(['finanzas']) })
    assert.deepEqual(r, { tipo: 'esperar_hasta', cuando: iso(T0 + 3600_000) })
  })
  test('recordatorios solo de 9 a 21 (Argentina)', () => {
    // 23:00 de Argentina → al otro día 9:00
    const noche = Date.parse('2026-10-27T02:00:00Z')
    assert.equal(iso(E.enHorario(noche)), '2026-10-27T12:00:00.000Z')
    assert.equal(E.enHorario(T0), T0)
    const madrugada = Date.parse('2026-10-27T08:00:00Z')   // 5:00 AR
    assert.equal(iso(E.enHorario(madrugada)), '2026-10-27T12:00:00.000Z')
  })
  test('algo escrito afuera: hecho, corriendo, revisar, reintento dudoso o una espera ok_dudoso', () => {
    assert.equal(E.algoEscritoAfuera(pasosCon({ validar: { estado: 'hecho' } }), []), false)
    assert.equal(E.algoEscritoAfuera(pasosCon({ finanzas: { estado: 'hecho' } }), []), true)
    assert.equal(E.algoEscritoAfuera(pasosCon({ drive: { estado: 'reintento', dudoso: true } }), []), true)
    assert.equal(E.algoEscritoAfuera(pasosCon({ drive: { estado: 'reintento' } }), []), false)
    assert.equal(E.algoEscritoAfuera(pasosCon(), [{ estado: 'abierta', tipos: ['ok_dudoso'] }]), true)
  })
})

describe('interpretación de cada paso (pura)', () => {
  const ctx = { huboCorriendo: false, intentos: 0, nombre: 'Ana Pérez', ahora: T0 }
  test('Finanzas: ok, repetido con y sin corrida cortada, escribio sin ok, noReintentarAntesDe, lectura con backoff', () => {
    assert.equal(P.interpretarFinanzas(finOk(), ctx).estado, 'hecho')
    assert.equal(P.interpretarFinanzas(finOk({ ok: false, escribio: false, etapa: 'control', repetido: { fila: 5 } }), { ...ctx, huboCorriendo: true }).estado, 'hecho')
    const rep = P.interpretarFinanzas(finOk({ ok: false, escribio: false, etapa: 'control', repetido: { fila: 5 } }), ctx)
    assert.equal(rep.estado, 'espera'); assert.equal(rep.esperas[0].motivo, 'finanzas_repetido')
    const medias = P.interpretarFinanzas(finOk({ ok: false, escribio: true, etapa: 'insercion', motivo: 'timeout' }), ctx)
    assert.equal(medias.estado, 'revisar'); assert.equal(medias.esperas[0].tipos[0], 'ok_revisar')
    const nr = P.interpretarFinanzas(finOk({ ok: false, escribio: false, etapa: 'comprobante', noReintentarAntesDe: iso(T0 + 700_000) }), ctx)
    assert.deepEqual([nr.estado, nr.noAntesDe, nr.dudoso], ['reintento', iso(T0 + 700_000), true])
    assert.equal(P.interpretarFinanzas(finOk({ ok: false, escribio: false, etapa: 'lectura' }), ctx).noAntesDe, iso(T0 + 60_000))
    assert.equal(P.interpretarFinanzas(finOk({ ok: false, escribio: false, etapa: 'lectura' }), { ...ctx, intentos: 3 }).estado, 'revisar')
    assert.equal(P.interpretarFinanzas(finOk({ ok: false, escribio: false, etapa: 'control', motivo: 'listas' }), ctx).estado, 'revisar')
  })
  test('CRM: el id se guarda solo si escribió; duplicado vigente; confirmar; lectura no fresca', () => {
    const alta = { nombreCliente: 'Ana Pérez', validacion: null }
    const c = { huboCorriendo: false, nombre: 'Ana Pérez', alta, ahora: T0, intentos: 0 }
    const noApta = P.interpretarCrm(crmOk({ ok: false, escribio: false, etapa: 'previa', motivo: 'No apta para escribir: x', id: 'C-201', duplicadoVigente: { id: 'C-100', motivo: 'celular' } }), c)
    assert.equal(noApta.parcial, undefined); assert.equal(noApta.esperas[0].motivo, 'crm_duplicado')
    assert.equal(P.interpretarCrm(crmOk({ ok: false, escribio: false, duplicadoVigente: { id: 'C-100', motivo: 'celular' } }), { ...c, huboCorriendo: true }).estado, 'revisar')
    assert.deepEqual(P.interpretarCrm(crmOk(), c).parcial, { id: 'C-200' })
    const conf = P.interpretarCrm(crmOk({ ok: false, escribio: false, motivo: 'No apta', previa: { bloqueos: [{ motivo: 'confirmar', detalle: 'Día 1 lejano' }], faltantes: [] } }), c)
    assert.equal(conf.esperas[0].motivo, 'crm_confirmar')
    const fresca = P.interpretarCrm(crmOk({ ok: false, escribio: false, etapa: 'previa', motivo: 'La lectura del CRM no es fresca (snapshot, 90 s)', previa: { bloqueos: [], faltantes: [] } }), c)
    assert.deepEqual([fresca.estado, fresca.noAntesDe], ['reintento', iso(T0 + 60_000)])
    assert.equal(P.interpretarCrm(crmOk({ ok: false, escribio: true, motivo: 'a medias' }), c).estado, 'revisar')
  })
  test('Drive: carpeta existente, nombre dudoso, noReintentarAntesDe, errores con backoff, pendientes', () => {
    const alta = { nombreCliente: 'Ana Pérez', validacion: null }
    const c = { real: true, nombre: 'Ana Pérez', alta, ahora: T0, intentos: 0 }
    const res = (over) => ({ ...driveOk(over), nombres: { carpeta: 'Ana Pérez - C.J' } })
    assert.equal(P.interpretarDrive(res({ esperaOk: 'carpeta_existente', ok: true, completo: false, guardar: {}, pendientes: ['Ya había…'] }), c).esperas[0].motivo, 'carpeta')
    assert.equal(P.interpretarDrive(res({ esperaOk: 'nombre_dudoso', completo: false, guardar: {}, pendientes: ['nombre'] }), c).esperas[0].motivo, 'nombre_drive')
    const nr = P.interpretarDrive(res({ ok: false, errores: ['x'], noReintentarAntesDe: iso(T0 + 600_000) }), c)
    assert.deepEqual([nr.estado, nr.noAntesDe], ['reintento', iso(T0 + 600_000)])
    assert.equal(P.interpretarDrive(res({ ok: false, errores: ['x'] }), c).noAntesDe, iso(T0 + 60_000))
    assert.equal(P.interpretarDrive(res({ ok: false, errores: ['x'] }), { ...c, intentos: 3 }).estado, 'revisar')
    const pend = P.interpretarDrive(res({ completo: false, pendientes: ['Falta la plantilla'] }), c)
    assert.equal(pend.estado, 'hecho'); assert.match(pend.avisos[0], /plantilla/)
    assert.deepEqual(P.guardadoAprobado(res({ esperaOk: 'carpeta_existente', guardar: {} })), { carpeta: { id: ID_CARPETA, url: 'https://drive/c' } })
  })
  test('leerRestoOk: cuenta y MEP del "OK"', () => {
    assert.deepEqual(P.leerRestoOk('Empresa'), { cuenta: 'Empresa', mep: null, texto: 'Empresa' })
    assert.deepEqual(P.leerRestoOk('tomi 1450,50'), { cuenta: 'Tomi', mep: 1450.5, texto: 'tomi 1450,50' })
    assert.equal(P.leerRestoOk('Gero').cuenta, 'Gero')
  })
  test('MEP: una cotización vieja de un día hábil reciente no se guarda', () => {
    assert.equal(P.mepFresco({ venta: 1, diaAnterior: '2026-10-23', fechaCotizacion: '2026-10-22' }, '2026-10-24'), false)   // viernes hábil
    assert.equal(P.mepFresco({ venta: 1, diaAnterior: '2026-10-25', fechaCotizacion: '2026-10-24' }, '2026-10-26'), true)    // domingo
    assert.equal(P.mepFresco({ venta: 1, diaAnterior: '2026-10-23', fechaCotizacion: '2026-10-23' }, '2026-10-24'), true)
  })
})

describe('flujos completos (real, almacén en memoria)', () => {
  test('camino feliz: valida, carga, arma la comunidad, espera a Aylu, manda la bienvenida y termina lista', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    const r1 = await m.correr([ev])
    assert.deepEqual(r1.errores, [])
    let alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'esperando_humano')
    assert.equal(alta.fechaPago, '2026-10-26')
    assert.deepEqual(await estadosPasos(m, id), { validar: 'hecho', finanzas: 'hecho', crm: 'hecho', drive: 'hecho', comunidad: 'espera', bienvenida: 'pendiente', skool: 'hecho', contrato: 'hecho' })
    // Finanzas recibió la fila congelada con setter/fuente del CRM de ventas y la cuenta por el destinatario
    const fila = m.dj.llamadas.finanzas[0].fila
    assert.deepEqual([fila.celdas.H, fila.celdas.K, fila.celdas.R, fila.celdas.E], ['Mai', 'Inbound IG', 'Tomi', 1100])
    assert.ok(m.dj.llamadas.finanzas[0].comprobante.base64)
    assert.equal(m.dj.llamadas.crm[0].op.modo, 'real')
    // Al closer: "Listo, arranco…" citando el #ALTA; a Aylu: aviso de Skool con mención y el pedido de la comunidad.
    // WhatsApp seguro (26/10): antes al closer le llegaba UN mensaje; ahora llegan dos: el segundo es el link del General
    // para que se lo pase al cliente (el bot ya no lo suma directo), también citando el #ALTA
    const alCloser = m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas)
    assert.equal(alCloser.length, 2); assert.equal(alCloser[0].citar, ev.mensajeId); assert.match(alCloser[0].texto, /arranco el alta de Ana Pérez/)
    const general = (await pasosDe(m, id)).comunidad.parcial.grupos.general
    assert.equal(alCloser[1].citar, ev.mensajeId)
    assert.equal(alCloser[1].texto, `Pasale este link a Ana para que entre a su grupo: https://chat.whatsapp.com/${general.invitacion}`)
    const skool = m.whapi.enviados.find((x) => /Skool/.test(x.texto) && x.chatId === GRUPOS.verificaciones)
    assert.ok(skool.texto.startsWith(`@${AYLU} `)); assert.deepEqual(skool.menciones, [AYLU])
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').length, 3)
    // Modo seguro: el cliente no está en ningún grupo, ni se lo verificó ni se lo agendó
    assert.ok(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').every((x) => !x.p.participantes.includes(TEL_ANA)))
    assert.equal(m.whapi.llamadas.filter((x) => ['verificarNumeros', 'agendarContacto'].includes(x.m)).length, 0)
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'ponerFoto').length, 4)
    // Aylu responde OK citando el pedido de la comunidad
    const pedido = await pedidoDe(m, id, 'comunidad')
    const r2 = await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: { telefono: AYLU, lid: null, nombre: 'Aylu' } })])
    assert.deepEqual(r2.errores, [])
    alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'lista')
    const video = m.whapi.enviados.find((x) => x.tipo === 'video')
    assert.match(video.pie, /Hola Ana! Cómo va\? Muy bienvenida a Capital Jurídico!/)
    assert.ok(video.chatId.startsWith('grupo-'))
    // Nada se repitió
    assert.equal(m.dj.llamadas.finanzas.length, 1); assert.equal(m.dj.llamadas.crm.length, 1); assert.equal(m.dj.llamadas.contrato.filter((x) => x.a).length, 1)
  })

  test('el #ALTA en texto y la imagen después (suelta): se suma sola; la espera de 3 minutos no pide nada', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO, { medios: [] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    let alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'esperando_comprobante')
    assert.equal((await pasosDe(m, id)).validar.estado, 'reintento')
    assert.equal(m.whapi.enviados.length, 0)
    assert.equal(m.despertadores.length, 1)   // en producción, despertador a los 3 minutos
    await m.correr([evAdjunto()])
    alta = await m.almacen.leerAlta(id)
    assert.equal(alta.medios.length, 1)
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
  })

  test('la imagen antes del #ALTA: el alta la reclama al nacer', async () => {
    const m = motorDe()
    await m.correr([evAdjunto({ medios: [medio('antes')] })])
    const ev = evAlta(TEXTO, { medios: [] })
    await m.correr([ev])
    const alta = await m.almacen.leerAlta(`alta_${ev.mensajeId}`)
    assert.deepEqual(alta.medios.map((x) => x.id), ['antes'])
    assert.equal((await pasosDe(m, alta.id)).validar.estado, 'hecho')
  })

  test('los dos a la vez en el mismo webhook', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO, { medios: [] })
    await m.correr([evAdjunto({ medios: [medio('junto')] }), ev])
    const alta = await m.almacen.leerAlta(`alta_${ev.mensajeId}`)
    assert.deepEqual(alta.medios.map((x) => x.id), ['junto'])
  })

  test('sin comprobante: a los 3 minutos se le pide al closer citando su #ALTA', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO, { medios: [] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(id, m.op())
    const pedido = m.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas)
    assert.match(pedido.texto, /Comprobante del pago/); assert.equal(pedido.citar, ev.mensajeId)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'esperando_comprobante')
    // El closer manda la imagen citando el pedido: sigue sola
    await m.correr([evAdjunto({ citado: { id: pedido.id, autor: null } })])
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
  })
})

describe('pasos humanos', () => {
  test('faltan datos y setter: un solo pedido al closer; la respuesta citando se fusiona sin duplicar y retoma', async () => {
    const m = motorDe({ setterFuente: null })
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', '').replace('Teléfono: +54 9 11 3000-1111', 'Teléfono: +54 9 11 3000-1111\nTeléfono: +54 9 11 3000-1111'))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = m.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas)
    assert.match(pedido.texto, /DNI/); assert.match(pedido.texto, /Setter/); assert.doesNotMatch(pedido.texto, /Fuente/)   // la fuente no se le pide al closer (25/10)
    assert.equal(pedido.citar, ev.mensajeId)
    assert.equal(m.whapi.enviados.filter((x) => x.chatId === GRUPOS.verificaciones).length, 0)
    await m.correr([evResp('DNI: 30111222\nTeléfono: +54 9 11 3000-1111\nSetter: maite\nFuente: Inbound IG', { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, citado: { id: pedido.id, autor: null }, veredicto: null })])
    const alta = await m.almacen.leerAlta(id)
    const a = parsearAlta(alta.textoVigente)
    assert.equal(a.dni, '30111222'); assert.equal(a.telefonos.length, 1)
    assert.equal(alta.validacion.setter, 'Mai'); assert.equal(alta.validacion.origenSetterFuente, 'closer')
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
    assert.ok(m.whapi.enviados.some((x) => /Lo sumé al alta de Ana Pérez/.test(x.texto)))
  })

  test('respuesta sin citar en Ventas: solo si trae "Clave: valor" y el closer tiene una sola espera', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const r = await m.motor.registrar([evResp('Buen día equipo', { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'M' }, veredicto: null })])
    assert.equal(r.nuevos.length, 0); assert.equal(r.ignorados.length, 1)   // la charla no se guarda
    await m.correr([evResp('DNI: 30111222', { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'M' }, veredicto: null })])
    assert.equal(parsearAlta((await m.almacen.leerAlta(id)).textoVigente).dni, '30111222')
  })

  test('cuenta sin decidir → un solo mensaje en Verificaciones; "OK" solo no alcanza; "OK Empresa" sí', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'claude-haiku-5-5', salida: lecturaOk({ destinatario: 'Juan Gómez' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'validar')
    const enVerif = m.whapi.enviados.filter((x) => x.chatId === GRUPOS.verificaciones)
    assert.equal(enVerif.length, 1); assert.match(enVerif[0].texto, /OK Tomi/)
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null } })])
    assert.ok(m.whapi.enviados.some((x) => /Falta la cuenta/.test(x.texto)))
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'pendiente')
    await m.correr([evResp('OK Empresa', { citado: { id: pedido, autor: null } })])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.validacion.cuenta, 'Empresa')
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.R, 'Empresa')
  })

  test('un OK de alguien que no aprueba no cuenta; un @lid desconocido recibe "no te reconozco" una vez', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'validar')
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: { telefono: '5498888888888', lid: null, nombre: 'Otro' } })])
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: { telefono: null, lid: '999@lid', nombre: '?' } })])
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: { telefono: null, lid: '999@lid', nombre: '?' } })])
    assert.equal(m.whapi.enviados.filter((x) => /No te reconozco/.test(x.texto)).length, 1)
    assert.equal((await pasosDe(m, id)).validar.estado, 'espera')
    assert.ok(m.logs.some((l) => /999@lid/.test(l)))
  })

  test('discrepancia: OK sigue con los datos del #ALTA; NO deja el alta rechazada y avisa al closer', async () => {
    const ok = motorDe()
    ok.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev = evAlta()
    await ok.correr([ev])
    const id = `alta_${ev.mensajeId}`
    await ok.correr([evResp('ok!!', { citado: { id: await pedidoDe(ok, id, 'validar'), autor: null } })])
    assert.equal((await pasosDe(ok, id)).finanzas.estado, 'hecho')
    assert.equal(ok.dj.llamadas.finanzas[0].fila.celdas.E, 1100)

    const no = motorDe()
    no.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev2 = evAlta()
    const id2 = `alta_${ev2.mensajeId}`
    await no.correr([ev2])
    const pedido = await pedidoDe(no, id2, 'validar')
    await no.correr([evResp('No, el monto no coincide', { citado: { id: pedido, autor: null } })])
    const alta = await no.almacen.leerAlta(id2)
    assert.equal(alta.estado, 'rechazada')
    const aviso = no.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas)
    assert.match(aviso.texto, /el monto no coincide/); assert.equal(aviso.citar, ev2.mensajeId)
    assert.equal(no.dj.llamadas.finanzas.length, 0)
    // Se reabre con un OK citado dentro de los 7 días
    await no.correr([evResp('OK', { citado: { id: pedido, autor: null } })])
    assert.equal((await pasosDe(no, id2)).finanzas.estado, 'hecho')
  })

  test('comprobante HEIC: no va a Claude y pide OK; un pedido viejo citado no aplica', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO, { medios: [medio('heic', { mime: 'image/heic' })] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal(m.dj.llamadas.vision.length, 0)
    const alta = await m.almacen.leerAlta(id)
    assert.match(alta.esperas[0].pedido.join(), /HEIC no/)
    const viejo = alta.esperas[0].mensajes[0]
    // Llega otro archivo: la ronda vieja queda superada y una respuesta a ella no aplica
    await m.correr([evAdjunto({ medios: [medio('otro')], citado: { id: ev.mensajeId, autor: null } })])
    await m.correr([evResp('OK Tomi', { citado: { id: viejo, autor: null } })])
    assert.ok(m.whapi.enviados.some((x) => /ya no está vigente/.test(x.texto)))
  })
})

describe('Fee (menos de USD 500)', () => {
  const FEE = TEXTO.replace('Este pago: 1100 USD · Transferencia USD (Galicia)', 'Este pago: 300 USD · Transferencia USD (Galicia)').replace('Cuotas:\n26/11/2026 1100\n26/12/2026 1100', 'Cuotas:\n26/11/2026 1500\n26/12/2026 1500')
  test('el Fee pide el OK; con OK carga Finanzas, arma la comunidad, avisa y queda en fee (reglas del 26/10)', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300' }), tokens: {} })
    const ev = evAlta(FEE)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    // Antes del OK no se carga nada
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    assert.ok(m.whapi.enviados.some((x) => x.chatId === GRUPOS.verificaciones && /^💰 Fee de Ana Pérez \(300 USD, closer Marcos\)\. ¿Lo cargo en Finanzas y creo la comunidad\?/.test(x.texto)))
    await aprobarFee(m, id)
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'fee')
    assert.deepEqual(await estadosPasos(m, id), { validar: 'hecho', finanzas: 'hecho', crm: 'pendiente', drive: 'pendiente', comunidad: 'hecho', bienvenida: 'pendiente', skool: 'pendiente', contrato: 'pendiente' })
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.J, 'Fee')
    assert.ok(m.whapi.enviados.some((x) => x.chatId === GRUPOS.ventas && /es un Fee/.test(x.texto)))
    assert.ok(m.whapi.enviados.some((x) => x.chatId === GRUPOS.verificaciones && /Fee de Ana Pérez/.test(x.texto)))
    assert.equal(alta.proximoIntento, iso(Date.parse(alta.creado) + E.VENCE_FEE_MS))
  })
  test('segundo pago que llega solo a 500: alta normal y el Fee queda reemplazado', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300', numero_operacion: 'OP-F' }), tokens: {} })
    const fee = evAlta(FEE)
    await m.correr([fee])
    await aprobarFee(m, `alta_${fee.mensajeId}`)
    const ev = evAlta()
    await m.correr([ev])
    const nueva = await m.almacen.leerAlta(`alta_${ev.mensajeId}`)
    assert.equal(nueva.altaAnterior, `alta_${fee.mensajeId}`)
    assert.equal((await pasosDe(m, nueva.id)).crm.estado, 'hecho')
    assert.equal((await m.almacen.leerAlta(`alta_${fee.mensajeId}`)).estado, 'reemplazada')
  })
  test('segundo pago que solo llega sumando: OK de Tomi o Gero y el CRM recibe el total', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300', numero_operacion: 'OP-F' }), tokens: {} })
    const fee = evAlta(FEE)
    await m.correr([fee])
    await aprobarFee(m, `alta_${fee.mensajeId}`)
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-G' }), tokens: {} })
    const ev = evAlta(FEE.replace('Este pago: 300 USD', 'Este pago: 250 USD'))
    await m.correr([ev])
    const id = `alta_${ev.mensajeId}`
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.validacion.usdAcumulado, 550)
    // La suma con el Fee va en su propia ronda (su NO no rechaza el alta); el cronograma, en la ronda de siempre
    const e = alta.esperas.find((x) => x.motivo === 'fee_suma' && x.estado === 'abierta')
    // 26/10/2026: el mismo mensaje que el formato libre (regla C); sin "N cuotas de X" ni PIF no se sabe la primera cuota
    assert.match(e.pedido.join(), /los pagos suman 300 \+ 250 = 550 USD, pero no sé de cuánto es la primera cuota/)
    assert.match(e.datos.texto, /Con NO: este pago queda como Fee y espero otro/)
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null } })])
    assert.equal((await pasosDe(m, id)).crm.estado, 'pendiente')   // falta el OK de la otra ronda
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'validar'), autor: null } })])
    assert.equal((await pasosDe(m, id)).crm.estado, 'hecho')
    const llamadaCrm = m.dj.llamadas.crm.at(-1)
    assert.equal(llamadaCrm.a.estePagoUsd, 550)
    assert.equal((await m.almacen.leerAlta(`alta_${fee.mensajeId}`)).estado, 'reemplazada')
  })
})

describe('repetidos y correcciones', () => {
  test('el mismo mensaje dos veces (clave) no se registra dos veces; un envío a medias vuelve como nuevo', async () => {
    const m = motorDe()
    const ev = evAlta()
    const r1 = await m.motor.registrar([ev])
    const r2 = await m.motor.registrar([ev])
    assert.equal(r1.nuevos.length, 1); assert.deepEqual(r2.repetidos, [ev.clave]); assert.equal(r2.nuevos.length, 1)   // sigue 'nuevo'
    await m.motor.procesar(r2.nuevos, m.op())
    const r3 = await m.motor.registrar([ev])
    assert.equal(r3.nuevos.length, 0)
  })
  test('el mismo texto reenviado (huella): duplicada y "Ya lo tengo"', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const a1 = evAlta()
    await m.correr([a1])
    const a2 = evAlta(TEXTO + '\n')
    await m.correr([a2])
    assert.equal((await m.almacen.leerAlta(`alta_${a2.mensajeId}`)).estado, 'duplicada')
    assert.ok(m.whapi.enviados.some((x) => /Ya lo tengo/.test(x.texto) && x.citar === a2.mensajeId))
  })
  test('el mismo archivo o el mismo n.º de operación en otra alta → OK de comprobante', async () => {
    const m = motorDe()
    const a1 = evAlta(TEXTO, { medios: [medio('mismo')] })
    await m.correr([a1])
    const otro = TEXTO.replace('Ana Pérez', 'Beatriz Gómez').replace('+54 9 11 3000-1111', '+54 9 11 3000-9999').replace('ana@ejemplo.com', 'bea@ejemplo.com')
    const a2 = evAlta(otro, { medios: [medio('mismo')], autor: { telefono: '5497000000000', lid: null, nombre: 'Carlos' } })
    await m.correr([a2])
    const alta2 = await m.almacen.leerAlta(`alta_${a2.mensajeId}`)
    assert.match(alta2.esperas.find((e) => e.motivo === 'validar').pedido.join(), /mismo archivo/)
    const a3 = evAlta(otro.replace('Beatriz', 'Carla').replace('3000-9999', '3000-8888').replace('bea@', 'carla@'), { medios: [medio('distinto')], autor: { telefono: '5497000000001', lid: null, nombre: 'Yami' } })
    await m.correr([a3])
    assert.match((await m.almacen.leerAlta(`alta_${a3.mensajeId}`)).esperas.find((e) => e.motivo === 'validar').pedido.join(), /número de operación/)
  })
  test('corrección antes de escribir: reemplaza el texto y revalida sin volver a pagar Claude', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal(m.dj.llamadas.vision.length, 1)
    await m.correr([evAlta(TEXTO.replace('Closer: Marcos', 'Closer: Marcos P.'), { citado: { id: ev.mensajeId, autor: null }, medios: [] })])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(parsearAlta(alta.textoVigente).dni, '30111222')
    assert.equal(alta.mensajesAlta.length, 2)
    assert.equal(m.dj.llamadas.vision.length, 1)
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
  })
  test('corrección después de escribir: nada se rehace y un OK decide; una edición también', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const edit = { ...base({ id: ev.mensajeId, clave: `ed:${ev.mensajeId}:${sha('x')}` }), tipo: 'edicion', grupo: 'ventas', texto: TEXTO.replace('Av. Corrientes 1234', 'Av. Santa Fe 999') }
    await m.correr([edit])
    const alta = await m.almacen.leerAlta(id)
    const e = alta.esperas.find((x) => x.motivo === 'correccion')
    assert.ok(e); assert.match(e.pedido[0], /direccion/)
    assert.equal(m.dj.llamadas.finanzas.length, 1)
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null } })])
    assert.match((await m.almacen.leerAlta(id)).textoVigente, /Santa Fe/)
    assert.equal(m.dj.llamadas.finanzas.length, 1)
  })
  test('DFY+R: OK de Tomi o Gero → aviso a Aylu para cargarla a mano; no se crean CRM, Drive ni comunidad', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO.replace('Programa: Agencia', 'Programa: DFY+R').replace('PP 3300 USD', 'PP 3400 USD').replace('26/12/2026 1100', '26/12/2026 1200'))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'validar')
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null } })])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'lista')
    assert.deepEqual(await estadosPasos(m, id), { validar: 'hecho', finanzas: 'omitido', crm: 'omitido', drive: 'omitido', comunidad: 'omitido', bienvenida: 'omitido', skool: 'omitido', contrato: 'omitido' })
    assert.equal(m.dj.llamadas.finanzas.length, 0); assert.equal(m.dj.llamadas.crm.length, 0)
    assert.ok(m.whapi.enviados.some((x) => /cargala a mano/.test(x.texto)))
  })
})

describe('idempotencia', () => {
  test('la fecha queda congelada: un reintento "al día siguiente" usa la misma (y la misma fila)', async () => {
    const m = motorDe()
    m.dj.colas.finanzas.push(finOk({ ok: false, escribio: false, etapa: 'lectura', motivo: 'Sheets 503' }))
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'reintento')
    m.reloj.t += 86_400_000
    await m.motor.avanzar(id, m.op())
    assert.equal(m.dj.llamadas.finanzas.length, 2)
    assert.equal(m.dj.llamadas.finanzas[1].fila.celdas.A, m.dj.llamadas.finanzas[0].fila.celdas.A)
    assert.equal((await m.almacen.leerAlta(id)).fechaPago, '2026-10-26')
  })
  test('Finanzas: la fila congelada no cambia; si cambian los datos, pide OK', async () => {
    const m = motorDe()
    m.dj.colas.finanzas.push(finOk({ ok: false, escribio: false, etapa: 'comprobante', noReintentarAntesDe: iso(T0 + 600_000) }))
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const alta = await m.almacen.leerAlta(id)
    // Cambia el setter (lo corrige alguien) antes del reintento
    const otra = await m.almacen.reclamar(id, 'test', T0 + 999_999)
    await m.almacen.actualizarAlta(id, 'test', { validacion: { ...otra.validacion, setter: 'ENRU / Mai' } })
    await m.almacen.soltar(id, 'test')
    m.reloj.t += 700_000
    await m.motor.avanzar(id, m.op())
    const e = (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === 'finanzas_cambio')
    assert.ok(e)
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null } })])
    assert.equal(m.dj.llamadas.finanzas.length, 2)
    assert.equal(m.dj.llamadas.finanzas[1].fila.celdas.H, 'Mai')   // la congelada
    void alta
  })
  test('Finanzas "repetido" después de una corrida que quedó corriendo → hecho; escribio sin ok → revisar y no se reintenta', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    m.dj.colas.finanzas.push(finOk({ ok: false, escribio: true, etapa: 'insercion', motivo: 'timeout' }))
    await m.correr([ev])
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'revisar')
    m.reloj.t += 3 * 86_400_000
    await m.motor.avanzar(id, m.op())
    assert.equal(m.dj.llamadas.finanzas.length, 1)   // nunca se reintenta solo

    const m2 = motorDe()
    const ev2 = evAlta()
    const id2 = `alta_${ev2.mensajeId}`
    m2.dj.colas.finanzas.push(new Error('ignorado'))
    await m2.correr([ev2])
    // Una invocación que murió dejó Finanzas "corriendo"
    await m2.almacen.reclamar(id2, 'muerta', T0 + 1000)
    await m2.almacen.marcarCorriendo(id2, 'finanzas', 'muerta')
    m2.reloj.t += 30_000
    await m2.motor.avanzar(id2, m2.op())
    assert.equal((await pasosDe(m2, id2)).finanzas.estado, 'corriendo')   // espera la cola de 11 minutos
    m2.reloj.t += 700_000
    m2.dj.colas.finanzas.push(finOk({ ok: false, escribio: false, etapa: 'control', repetido: { fila: 2 } }))
    await m2.motor.avanzar(id2, m2.op())
    assert.equal((await pasosDe(m2, id2)).finanzas.estado, 'hecho')
  })
  test('CRM con id guardado no se vuelve a llamar; sin escribir, el id no se guarda', async () => {
    const m = motorDe()
    m.dj.colas.crm.push(crmOk({ ok: false, escribio: false, etapa: 'previa', motivo: 'La lectura del CRM no es fresca (snapshot_viejo, 400 s)', id: 'C-999', previa: { bloqueos: [], faltantes: [] } }))
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal((await pasosDe(m, id)).crm.parcial?.id, undefined)
    m.reloj.t += 61_000
    await m.motor.avanzar(id, m.op())
    assert.equal((await pasosDe(m, id)).crm.parcial.id, 'C-200')
    await m.motor.avanzar(id, { ...m.op(), forzarPaso: 'crm' })
    assert.equal(m.dj.llamadas.crm.length, 2)
  })
  test('Drive: guardado e intentoCarpeta (con la ventana de una corrida cortada) y noReintentarAntesDe', async () => {
    const m = motorDe()
    const intento = { nombre: 'Ana Pérez - C.J', padreId: 'fixture-google-id-000000000000000000000013', ventanas: [{ desde: iso(T0), hasta: iso(T0 + 1000), puedeSeguir: true }] }
    m.dj.colas.drive.push(driveOk({ ok: false, completo: false, errores: ['puente 500'], guardar: {}, intentoCarpeta: intento, noReintentarAntesDe: iso(T0 + 400_000), carpeta: { estado: 'error' } }))
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const d = await pasosDe(m, id)
    assert.deepEqual([d.drive.estado, d.drive.noAntesDe, d.drive.dudoso], ['reintento', iso(T0 + 400_000), true])
    m.reloj.t += 100_000
    await m.motor.avanzar(id, m.op())
    assert.equal(m.dj.llamadas.drive.length, 1)
    // Una corrida que quedó corriendo: su ventana se suma a la marca
    await m.almacen.reclamar(id, 'muerta', m.reloj.t + 500)
    const inicioMuerta = await m.almacen.marcarCorriendo(id, 'drive', 'muerta')
    m.reloj.t += 700_000
    await m.motor.avanzar(id, m.op())
    const op = m.dj.llamadas.drive[1].op
    assert.equal(op.intentoCarpeta.ventanas.length, 2); assert.equal(op.intentoCarpeta.ventanas[1].puedeSeguir, true)
    assert.equal(op.intentoCarpeta.ventanas[1].desde, inicioMuerta)   // la ventana es la de la corrida que murió
    assert.ok(op.hasta > m.reloj.t)
  })
  test('carpeta existente → OK → se sigue en esa (aprobarCarpetaExistente); "OK Nombre" → carpeta nueva', async () => {
    const m = motorDe()
    m.dj.colas.drive.push(driveOk({ ok: true, completo: false, esperaOk: 'carpeta_existente', guardar: {}, pendientes: ['Ya había una carpeta'], carpeta: { estado: 'pendiente', id: ID_CARPETA, url: 'https://drive/c' } }))
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'carpeta')
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null } })])
    assert.deepEqual(m.dj.llamadas.drive[1].op.guardado, { carpeta: { id: ID_CARPETA, url: 'https://drive/c' } })
    assert.equal((await pasosDe(m, id)).drive.estado, 'hecho')
  })
  test('PandaDoc: el id se guarda apenas se crea (antes del corte); un corte sin id busca y, si no encuentra, pregunta', async () => {
    const m = motorDe()
    m.dj.colas.contrato.push(Object.assign(new ErrorBorrador('doc-777', new Error('500')), { alCrear: 'doc-777' }))
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const c = await pasosDe(m, id)
    assert.deepEqual([c.contrato.estado, c.contrato.parcial.documentoId], ['hecho', 'doc-777'])

    const m2 = motorDe()
    m2.dj.colas.contrato.push(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }))
    const ev2 = evAlta()
    const id2 = `alta_${ev2.mensajeId}`
    await m2.correr([ev2])
    const p2 = await pasosDe(m2, id2)
    assert.equal(p2.contrato.estado, 'espera')
    assert.ok(m2.dj.llamadas.contrato.some((x) => x.buscar === 'Contrato - Ana Pérez - C.J'))
    assert.ok((await m2.almacen.leerAlta(id2)).esperas.some((e) => e.paso === 'contrato' && e.tipos.includes('ok_dudoso')))

    const m3 = motorDe({ buscarContrato: () => [{ id: 'doc-encontrado', estado: 'document.draft' }] })
    m3.dj.colas.contrato.push(Object.assign(new Error('fetch failed'), { name: 'TypeError' }))
    const ev3 = evAlta()
    await m3.correr([ev3])
    assert.equal((await pasosDe(m3, `alta_${ev3.mensajeId}`)).contrato.parcial.documentoId, 'doc-encontrado')
  })
  test('sin la clave de PandaDoc de producción: omitido con aviso', async () => {
    const m = motorDe({ hayClave: false })
    const ev = evAlta()
    await m.correr([ev])
    assert.equal((await pasosDe(m, `alta_${ev.mensajeId}`)).contrato.estado, 'omitido')
  })
  test('comunidad con ids parciales no recrea nada; un dudoso sin búsqueda pregunta', async () => {
    const m = motorDe({ whapiOp: { fallas: { crearGrupoEnComunidad: [null, 'dudoso'] } } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const p = await pasosDe(m, id)
    assert.equal(p.comunidad.estado, 'espera')
    assert.ok(p.comunidad.parcial.comunidadId); assert.ok(p.comunidad.parcial.grupos.general)
    const e = (await m.almacen.leerAlta(id)).esperas.find((x) => x.paso === 'comunidad' && x.motivo === 'dudoso')
    assert.ok(e)
    // NO = no existe: se crea de nuevo SOLO lo que faltaba
    await m.correr([evResp('NO', { citado: { id: e.mensajes[0], autor: null }, autor: { telefono: AYLU, lid: null, nombre: 'Aylu' } })])
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 1)
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').length, 4)   // General + Ventas (dudoso) + Ventas + Contenido
  })
  test('WhatsApp creó el General solo: se usa ese', async () => {
    const m = motorDe({ whapiOp: { generalChat: true } })
    const ev = evAlta()
    await m.correr([ev])
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').length, 2)
    assert.ok(m.whapi.llamadas.some((x) => x.m === 'agregarParticipantes' && x.p.grupoId === 'general-auto@g.us'))
  })
  test('mensaje "enviando" (cortado): un aviso se reenvía con "(repetido)"; la bienvenida queda dudosa y el eco la confirma', async () => {
    const { armarBienvenida } = await import('../lib/bot/alta/bienvenida.ts')
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'comunidad')
    const general = (await pasosDe(m, id)).comunidad.parcial.grupos.general.id
    const pie = armarBienvenida(parsearAlta(TEXTO)).mensajeGrupo
    // Una invocación anterior anotó el video y se cortó antes de confirmarlo
    await m.almacen.anotarSaliente({ altaId: id, proposito: 'bienvenida:video', chatId: general, huella: sha(F.textoNormalizado(pie)) })
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: { telefono: AYLU, lid: null, nombre: 'Aylu' } })])
    assert.equal((await pasosDe(m, id)).bienvenida.estado, 'espera')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 0)   // no se reenvía solo
    assert.ok((await m.almacen.leerAlta(id)).esperas.some((e) => e.paso === 'bienvenida' && e.tipos.includes('ok_dudoso') && e.estado === 'abierta'))
    // Llega el eco del video (mismo chat y mismo texto): se confirma y la bienvenida termina sin mandar otra
    await m.correr([{ ...evEco(pie, 'eco-1', { chatId: general }), grupo: null }])   // W lo emite con grupo null (General del cliente)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 0)

    // Un aviso cortado se reenvía marcado
    const m2 = motorDe()
    const ev2 = evAlta()
    const id2 = `alta_${ev2.mensajeId}`
    await m2.almacen.crearAlta({ id: id2, modo: 'real', capacidades: [...TODAS], entorno: 'test', chatId: GRUPOS.ventas, autor: ev2.autor, mensajeAltaId: ev2.mensajeId, textoOriginal: TEXTO, huella: 'x', telefonoCliente: TEL_ANA, nombreCliente: 'Ana Pérez', medios: ev2.medios, altaAnterior: null })
    await m2.almacen.anotarSaliente({ altaId: id2, proposito: 'skool:aviso', chatId: GRUPOS.verificaciones, huella: 'h' })
    await m2.motor.avanzar(id2, m2.op())
    assert.ok(m2.whapi.enviados.some((x) => /Skool/.test(x.texto) && /\(repetido\)$/.test(x.texto)))
  })
  test('el eco recupera el id de un envío que volvió sin id: la respuesta citada se resuelve', async () => {
    const m = motorDe({ whapiOp: { sinId: true } })
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = m.whapi.enviados.find((x) => x.chatId === GRUPOS.verificaciones)
    assert.equal(pedido.id, null)
    await m.correr([evEco(pedido.texto, 'wamid-eco', { chatId: GRUPOS.verificaciones, grupo: 'verificaciones' })])
    await m.correr([evResp('OK', { citado: { id: 'wamid-eco', autor: null } })])
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
  })
})

describe('concurrencia y tiempo', () => {
  test('dos avanzar en paralelo sobre la misma alta: uno corre, el otro sale marcando pendientes', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.motor.registrar([ev])
    // Se crea el alta sin avanzar (como si otra invocación estuviera en el medio)
    const r0 = await m.motor.procesar([ev], { hasta: T0 + 10_000, invocacion: 'corta' })   // sin tiempo: no avanza
    assert.match(r0.registro.join(), /sin tiempo/)
    const [a, b] = await Promise.all([m.motor.avanzar(id, { ...m.op(), invocacion: 'A' }), m.motor.avanzar(id, { ...m.op(), invocacion: 'B' })])
    const salio = [a, b].filter((r) => r.registro.some((x) => /otra invocación/.test(x)))
    assert.equal(salio.length, 1)
    assert.equal(m.dj.llamadas.finanzas.length, 1)
  })
  test('recurso Finanzas ocupado por otra alta: Finanzas reintenta en 60 s y la alta sigue con lo demás', async () => {
    const m = motorDe()
    await m.almacen.tomarRecurso('finanzas', 'otra-instancia', 200_000)
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const p = await pasosDe(m, id)
    assert.deepEqual([p.finanzas.estado, p.finanzas.noAntesDe, p.crm.estado], ['reintento', iso(T0 + 60_000), 'hecho'])
    assert.equal(m.dj.llamadas.finanzas.length, 0)
  })
  test('con poco plazo se dispara la continuación (después de soltar el candado); más de 8 por hora → revisar', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.motor.registrar([ev])
    await m.motor.procesar([ev], { hasta: T0 + 120_000, invocacion: 'inv-1' })
    assert.equal(m.continuaciones.length, 1); assert.deepEqual(m.continuaciones[0], { alta_id: id, cadena: 1 })
    const alta = await m.almacen.reclamar(id, 'verifica', T0 + 999_999)
    assert.ok(alta, 'el candado quedó libre antes de la continuación')
    await m.almacen.soltar(id, 'verifica')
    for (let i = 0; i < 9; i++) await m.motor.avanzar(id, { hasta: m.reloj.t + 60_000, invocacion: `c${i}` })
    assert.equal((await m.almacen.leerAlta(id)).estado, 'revisar')
  })
  test('fuera de producción no hay continuaciones (lo toma el barrido)', async () => {
    const m = motorDe({ produccion: false })
    const ev = evAlta()
    await m.motor.registrar([ev])
    const r = await m.motor.procesar([ev], { hasta: T0 + 120_000, invocacion: 'x' })
    assert.equal(m.continuaciones.length, 0)
    assert.match(r.registro.join(), /barrido/)
  })
  test('barrido: toma las altas con hora vencida y manda los recordatorios de 24 h (en horario) y vence a los 14 días', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const antes = m.whapi.enviados.length
    m.reloj.t += 24 * 3600_000 + 1000
    await m.motor.procesar([], m.op())
    const rec = m.whapi.enviados.slice(antes).find((x) => /Recordatorio/.test(x.texto))
    assert.ok(rec)
    const pedido = (await m.almacen.leerAlta(id)).esperas[0]
    assert.equal(pedido.recordatorios, 1); assert.equal(pedido.mensajes.length, 2)
    // Citar el recordatorio también vale
    await m.correr([evResp('OK', { citado: { id: rec.id, autor: null } })])
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')

    const v = motorDe()
    v.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev2 = evAlta()
    await v.correr([ev2])
    v.reloj.t += 15 * 86_400_000
    await v.motor.avanzar(`alta_${ev2.mensajeId}`, v.op())
    assert.equal((await v.almacen.leerAlta(`alta_${ev2.mensajeId}`)).estado, 'vencida')
  })
})

describe('modos', () => {
  test('seco: cero llamadas a dependencias reales y a Whapi, todo "haría", el alta termina simulada', async () => {
    const m = motorDe({ modo: 'seco', capacidades: new Set() })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    const r = await m.correr([ev])
    assert.equal(m.whapi.llamadas.length, 0)
    for (const k of Object.keys(m.dj.llamadas)) if (k !== 'drive') assert.equal(m.dj.llamadas[k].length, 0, k)
    assert.deepEqual(m.dj.llamadas.drive.map((x) => x.op.modo), ['simulacion'])   // prepararDriveCliente en simulación no llama al puente
    assert.equal((await m.almacen.leerAlta(id)).estado, 'simulada')
    const todo = r.registro.join('\n')
    assert.match(todo, /leería el comprobante/); assert.match(todo, /haría: Finanzas/); assert.match(todo, /armaría la comunidad/); assert.match(todo, /haría: borrador/)
  })
  test('seco: lo que pediría queda anotado; la ruta manual responde la espera y se vuelve a simular', async () => {
    const m = motorDe({ modo: 'seco', capacidades: new Set() })
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const id = `alta_${ev.mensajeId}`
    const r = await m.correr([ev])
    assert.match(r.registro.join(), /pediría al closer: .*DNI/)
    const e = (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === 'datos')
    assert.equal(e.estado, 'simulada')
    const r2 = await m.motor.responder(id, { esperaId: e.id, texto: 'DNI: 30111222', por: 'tomas' }, m.op())
    assert.deepEqual(r2.errores, [])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(parsearAlta(alta.textoVigente).dni, '30111222'); assert.equal(alta.estado, 'simulada')
  })
  test('un alta seca no corre en real cuando cambia el entorno; rehacer_en_real sí', async () => {
    const almacen = A.almacenEnMemoria({ ahora: () => T0 })
    const seco = motorDe({ modo: 'seco', capacidades: new Set(), almacen })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await seco.correr([ev])
    const real = motorDe({ almacen })
    await real.motor.avanzar(id, real.op())
    assert.equal(real.dj.llamadas.finanzas.length, 0)
    assert.equal((await almacen.leerAlta(id)).estado, 'simulada')
    await real.motor.avanzar(id, { ...real.op(), rehacerEnReal: true })
    assert.equal(real.dj.llamadas.finanzas.length, 1)
    assert.equal((await almacen.leerAlta(id)).modo, 'real')
  })
  test('interruptor: un alta real con el entorno en seco queda en pausa; sin una capacidad, ese paso espera', async () => {
    const almacen = A.almacenEnMemoria({ ahora: () => T0 })
    const real = motorDe({ almacen })
    real.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await real.correr([ev])
    const apagado = motorDe({ almacen, modo: 'seco', capacidades: new Set() })
    const r = await apagado.motor.avanzar(id, apagado.op())
    assert.match(r.registro.join(), /pausada por el entorno/)
    assert.equal(apagado.whapi.llamadas.length, 0)
    const sinFin = motorDe({ almacen, capacidades: new Set([...TODAS].filter((c) => c !== 'finanzas')) })
    const pedido = await pedidoDe(real, id, 'validar')
    await sinFin.correr([evResp('OK', { citado: { id: pedido, autor: null } })])
    const p = await pasosDe(sinFin, id)
    assert.deepEqual([p.finanzas.estado, p.crm.estado], ['pendiente', 'hecho'])
    assert.equal(sinFin.dj.llamadas.finanzas.length, 0)
  })
  test('real sin una capacidad desde que nace: ese paso corre en vista previa (simulado)', async () => {
    const m = motorDe({ capacidades: new Set([...TODAS].filter((c) => c !== 'drive')) })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const p = await pasosDe(m, id)
    assert.equal(p.drive.estado, 'simulado'); assert.equal(m.dj.llamadas.drive[0].op.modo, 'simulacion')
  })
  test('ensayo: lecturas reales en modo simulación y un solo reporte a Verificaciones con el prefijo', async () => {
    const m = motorDe({ modo: 'ensayo', capacidades: new Set(['reporte_verificaciones']) })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal(m.dj.llamadas.vision.length, 1)
    assert.equal(m.dj.llamadas.finanzas[0].op.modo, 'simulacion'); assert.equal(m.dj.llamadas.crm[0].op.modo, 'simulacion')
    assert.equal(m.whapi.enviados.length, 1)
    assert.equal(m.whapi.enviados[0].chatId, GRUPOS.verificaciones)
    assert.ok(m.whapi.enviados[0].texto.startsWith('SIMULACIÓN — no se cargó nada'))
    assert.equal((await m.almacen.leerAlta(id)).estado, 'simulada')
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 0)
  })
})

describe('almacén de Neon (cliente SQL falso: no se toca ninguna base)', () => {
  const crearFalso = (responder = () => []) => {
    const consultas = []
    const q = (strings, ...vals) => {
      let texto = ''
      const params = []
      strings.forEach((s, i) => {
        texto += s
        if (i < vals.length) { const v = vals[i]; if (v && typeof v === 'object' && 'raw' in v && Object.keys(v).length === 1) texto += v.raw; else { params.push(v); texto += `$${params.length}` } }
      })
      const c = { texto: texto.replace(/\s+/g, ' ').trim(), params }
      consultas.push(c)
      return (async () => responder(c))()
    }
    q.unsafe = (raw) => ({ raw })
    return { q, consultas }
  }
  const conBase = async (f) => {
    process.env.DATABASE_URL = 'postgres://usuario:clave@base.inventada/db'
    try { return await f() } finally { delete process.env.DATABASE_URL; N.sqlParaPruebas(null) }
  }
  const TODAS_COLUMNAS = Object.entries(N.COLUMNAS_AGREGABLES).flatMap(([t, cs]) => cs.map(([c]) => ({ table_name: t, column_name: c })))

  test('la primera escritura crea las tablas (IF NOT EXISTS) y mira information_schema; con todo ya creado no hay ALTER', async () => conBase(async () => {
    const f = crearFalso((c) => (/information_schema/.test(c.texto) ? TODAS_COLUMNAS : /INSERT INTO cj_altas_mensajes/.test(c.texto) ? [{ clave: 'k' }] : []))
    N.sqlParaPruebas(() => f.q)
    const almacen = N.almacenNeon()
    await almacen.registrarEntrantes([evAlta()])
    const textos = f.consultas.map((c) => c.texto)
    for (const t of ['cj_altas (', 'cj_altas_pasos (', 'cj_altas_mensajes (', 'cj_altas_recursos (']) assert.ok(textos.some((x) => x.includes(`CREATE TABLE IF NOT EXISTS ${t}`)), t)
    assert.ok(textos.some((x) => /information_schema\.columns/.test(x)))
    assert.ok(!textos.some((x) => /ALTER TABLE/.test(x)))
    assert.ok(!textos.some((x) => /DROP|ALTER COLUMN|TYPE /i.test(x)))
    // Una vez por proceso
    const antes = f.consultas.length
    await almacen.registrarEntrantes([evAlta()])
    assert.equal(f.consultas.slice(antes).filter((c) => /CREATE TABLE/.test(c.texto)).length, 0)
  }))
  test('una tabla vieja recibe solo ADD COLUMN IF NOT EXISTS de lo que falta', async () => conBase(async () => {
    const f = crearFalso((c) => (/information_schema/.test(c.texto) ? TODAS_COLUMNAS.filter((x) => x.column_name !== 'esperas' && x.column_name !== 'dudoso') : []))
    N.sqlParaPruebas(() => f.q)
    await N.asegurarTablas()
    const alters = f.consultas.filter((c) => /ALTER TABLE/.test(c.texto)).map((c) => c.texto)
    assert.deepEqual(alters, ["ALTER TABLE cj_altas ADD COLUMN IF NOT EXISTS esperas jsonb NOT NULL DEFAULT '[]'::jsonb", 'ALTER TABLE cj_altas_pasos ADD COLUMN IF NOT EXISTS dudoso boolean NOT NULL DEFAULT false'])
  }))
  test('las lecturas no crean nada: una tabla que no existe (42P01) cuenta como vacía', async () => conBase(async () => {
    const f = crearFalso(() => { throw Object.assign(new Error('relation "cj_altas" does not exist'), { code: '42P01' }) })
    N.sqlParaPruebas(() => f.q)
    const almacen = N.almacenNeon()
    assert.equal(await almacen.leerAlta('alta_x'), null)
    assert.deepEqual(await almacen.buscarAltas({ huella: 'h' }), [])
    assert.equal((await almacen.leerPasos('alta_x')).finanzas.estado, 'pendiente')
    assert.deepEqual(await almacen.vencidas(3, 'test', iso(T0)), [])
    assert.ok(!f.consultas.some((c) => /CREATE/.test(c.texto)))
  }))
  test('guardarPaso es compare-and-set sobre iniciado (sin exigir el candado); reclamar es un arriendo', async () => conBase(async () => {
    const f = crearFalso((c) => (/information_schema/.test(c.texto) ? TODAS_COLUMNAS : /UPDATE cj_altas_pasos s/.test(c.texto) ? [] : /UPDATE cj_altas SET candado_dueno/.test(c.texto) ? [] : []))
    N.sqlParaPruebas(() => f.q)
    const almacen = N.almacenNeon()
    const ok = await almacen.guardarPaso('alta_x', 'finanzas', '2026-10-26T13:00:00.123456Z', { estado: 'hecho', resultado: { ok: true } })
    assert.equal(ok, false)
    const cas = f.consultas.find((c) => /UPDATE cj_altas_pasos s/.test(c.texto))
    assert.match(cas.texto, /s\.iniciado = \$\d+::timestamptz/)
    assert.ok(cas.params.includes('2026-10-26T13:00:00.123456Z'))
    assert.ok(!/candado_dueno/.test(cas.texto))
    assert.equal(await almacen.reclamar('alta_x', 'inv-1', T0 + 330_000), null)
    const arriendo = f.consultas.find((c) => /UPDATE cj_altas SET candado_dueno/.test(c.texto))
    assert.match(arriendo.texto, /candado_hasta IS NULL OR candado_hasta < now\(\) OR candado_dueno = \$\d+/)
    // soltar exige que no haya pendientes
    await almacen.soltar('alta_x', 'inv-1')
    assert.ok(f.consultas.some((c) => /AND NOT hay_pendientes/.test(c.texto)))
  }))
  test('medios: solo se suman, en una sentencia atómica, y actualizarAlta nunca los escribe', async () => conBase(async () => {
    const f = crearFalso((c) => (/information_schema/.test(c.texto) ? TODAS_COLUMNAS : [{ id: 'alta_x' }]))
    N.sqlParaPruebas(() => f.q)
    const almacen = N.almacenNeon()
    await almacen.adjuntarMedio({ chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: '1@lid', nombre: null }, desde: iso(T0 - 900_000), medios: [medio('m1')], ahora: iso(T0) })
    const adj = f.consultas.find((c) => /UPDATE cj_altas a SET medios = a\.medios \|\|/.test(c.texto))
    assert.match(adj.texto, /FOR UPDATE SKIP LOCKED/); assert.match(adj.texto, /autor_lid/)
    await almacen.actualizarAlta('alta_x', 'inv', { estado: 'en_curso', esperas: [] })
    const upd = f.consultas.find((c) => /UPDATE cj_altas a SET estado = CASE/.test(c.texto))
    assert.ok(!/medios/.test(upd.texto)); assert.match(upd.texto, /candado_dueno = \$\d+ AND a\.candado_hasta > now\(\)/)
  }))
  test('un error de conexión sale como ErrorTransitorio y sin la URL; sin DATABASE_URL no se intenta', async () => {
    await conBase(async () => {
      N.sqlParaPruebas(() => crearFalso(() => { throw new Error('Error connecting to database: fetch failed postgres://usuario:clave@base.inventada/db') }).q)
      await assert.rejects(N.almacenNeon().crearAlta({ id: 'alta_x', modo: 'seco', capacidades: [], entorno: 'test', chatId: 'c', autor: { telefono: null, lid: null, nombre: null }, mensajeAltaId: 'x', textoOriginal: 't', huella: 'h', telefonoCliente: null, nombreCliente: null, medios: [], altaAnterior: null }),
        (e) => e instanceof ErrorTransitorio && !/postgres:\/\//.test(e.message) && !/clave/.test(e.message))
    })
    await assert.rejects(N.almacenNeon().leerAlta('alta_x'), /falta DATABASE_URL/)
  })
})

describe('servidor (dependencias reales, sin red)', () => {
  test('listas de personas, equipo y URL del Despacho', () => {
    assert.deepEqual(S.listaPersonas('+54 9 11 1111-1111, 123@lid ; corto'), ['5491111111111', '123@lid'])
    assert.deepEqual(S.equipoDesdeEntorno('{"Aylu":"+54 9 11 2222-2222","Mal":"x"}'), { Aylu: '5491122222222' })
    const err = console.error; console.error = () => {}
    try { assert.deepEqual(S.equipoDesdeEntorno('no json'), {}) } finally { console.error = err }
    assert.equal(S.urlDespacho({ DESPACHO_URL: 'http://inseguro' }), S.URL_DESPACHO)
    assert.equal(S.urlDespacho({ DESPACHO_URL: 'https://otro.vercel.app/' }), 'https://otro.vercel.app')
  })
  test('en seco no hay ninguna dependencia de lectura externa; en ensayo sí', () => {
    const seco = S.depsPasosServidor({ modo: 'seco' }, {})
    for (const k of ['finanzas', 'crm', 'mep', 'vision', 'setterFuente', 'contrato']) assert.equal(seco[k], undefined, k)
    assert.equal(typeof seco.drive, 'function')
    assert.equal(seco.maxComunidadesDia, 2)
    const ensayo = S.depsPasosServidor({ modo: 'ensayo' }, { BOT_ALTA_MAX_COMUNIDADES_DIA: '5' })
    assert.equal(typeof ensayo.vision, 'function'); assert.equal(ensayo.maxComunidadesDia, 5)
    assert.match(ensayo.fotos.General.url, /\/bot\/grupo-general\.jpg$/)
  })
  test('dispararMotor: Bearer CRON_SECRET, espera solo el 202; sin CRON_SECRET no sale', async () => {
    const pedidos = []
    const fetchFalso = async (url, init) => { pedidos.push({ url, init }); return new Response(null, { status: 202 }) }
    await S.dispararMotor({ alta_id: 'alta_1', cadena: 2 }, { env: { CRON_SECRET: 'secreto-de-prueba' }, fetch: fetchFalso })
    assert.equal(pedidos[0].url, `${S.URL_DESPACHO}/api/bot/alta/motor`); assert.equal(pedidos[0].init.headers.authorization, 'Bearer secreto-de-prueba')
    await assert.rejects(S.dispararMotor({}, { env: { CRON_SECRET: 'x' }, fetch: async () => new Response(null, { status: 500 }) }), /500/)
    await assert.rejects(S.dispararMotor({}, { env: {}, fetch: fetchFalso }), /CRON_SECRET/)
  })
})

describe('ruta /api/bot/alta/motor (sin Next)', () => {
  const armar = (over = {}) => {
    const m = motorDe(over)
    const fondo = [], disparos = [], sueños = []
    const deps = {
      autorizado: (r) => r.headers.get('authorization') === 'Bearer ok',
      baseConfigurada: () => over.base ?? true,
      motor: () => m.motor, almacen: () => m.almacen,
      motorSimulacion: () => {
        const almacen = A.almacenEnMemoria({ ahora: () => T0 })
        const motor = O.crearOrquestador({ whapi: whapiJuguete(), modo: 'seco', capacidades: new Set(), grupos: GRUPOS, ahora: () => T0, almacen, pasos: S.depsPasosServidor({ modo: 'seco' }, {}), entorno: 'simulacion', produccion: false, log: { info() {}, warn() {}, error() {} } })
        return { motor, almacen }
      },
      modoEntorno: over.modoEntorno ?? 'seco',
      enSegundoPlano: (fn) => { fondo.push(fn) },
      dispararMotor: async (c) => { disparos.push(c) },
      despertador: over.despertador ?? true,
      dormir: async (ms) => { sueños.push(ms) },
      ahora: () => m.reloj.t,
      log: () => {},
    }
    const pedir = (cuerpo, auth = 'Bearer ok') => R.atenderMotor(new Request('https://x/api/bot/alta/motor', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }), deps)
    return { m, deps, fondo, disparos, sueños, pedir }
  }
  test('sin Bearer → 401; JSON roto → 400; sin base → 503', async () => {
    const r = armar()
    assert.equal((await r.pedir({ barrer: true }, 'Bearer mal')).status, 401)
    assert.equal((await r.pedir('{roto')).status, 400)
    assert.equal((await armar({ base: false }).pedir({ barrer: true })).status, 503)
    assert.equal((await r.pedir({ alta_id: 'x' })).status, 400)
  })
  test('simular: sincrónico, en memoria y en seco (sin red); devuelve el plan y lo que haría', async () => {
    const r = armar()
    const res = await r.pedir({ simular: { texto: TEXTO } })
    assert.equal(res.status, 200)
    const j = await res.json()
    assert.equal(j.modo, 'seco'); assert.equal(j.alta.estado, 'simulada')
    assert.ok(j.haria.some((x) => /haría: Finanzas/.test(x)))
    assert.equal(j.plan.length, 9)
    assert.ok(!JSON.stringify(j.alta).includes('30111222'))   // sin datos sensibles en la vista
  })
  test('avanzar, forzar paso, responder y barrer van en segundo plano (202)', async () => {
    const r = armar()
    const ev = evAlta()
    await r.m.correr([ev])
    const id = `alta_${ev.mensajeId}`
    assert.equal((await r.pedir({ alta_id: id, cadena: 1 })).status, 202)
    assert.equal((await r.pedir({ alta_id: id, forzar_paso: 'crm' })).status, 202)
    assert.equal((await r.pedir({ alta_id: id, forzar_paso: 'inventado' })).status, 400)
    assert.equal((await r.pedir({ alta_id: id, responder: { espera_id: 'comunidad-1', texto: 'OK', por: 'tomas' } })).status, 202)
    assert.equal((await r.pedir({ barrer: true })).status, 202)
    assert.equal(r.fondo.length, 4)
    for (const fn of r.fondo) await fn()
    assert.equal((await r.m.almacen.leerAlta(id)).estado, 'lista')
  })
  test('rehacer_en_real solo con el entorno en real', async () => {
    assert.equal((await armar().pedir({ alta_id: 'alta_prueba', rehacer_en_real: true })).status, 409)
    assert.equal((await armar({ modoEntorno: 'real' }).pedir({ alta_id: 'alta_prueba', rehacer_en_real: true })).status, 202)
  })
  test('despertador: duerme lo que falta y dispara una invocación nueva; si falta más, salta (como mucho 3)', async () => {
    const r = armar()
    await r.pedir({ alta_id: 'alta_prueba', no_antes_de: iso(T0 + 100_000) })
    await r.fondo[0]()
    assert.deepEqual(r.sueños, [100_000]); assert.deepEqual(r.disparos, [{ alta_id: 'alta_prueba' }])
    const r2 = armar()
    await r2.pedir({ alta_id: 'alta_prueba', no_antes_de: iso(T0 + 600_000) })
    await r2.fondo[0]()
    assert.deepEqual(r2.sueños, [270_000]); assert.deepEqual(r2.disparos, [{ alta_id: 'alta_prueba', no_antes_de: iso(T0 + 600_000), salto: 1 }])
    const r3 = armar()
    await r3.pedir({ alta_id: 'alta_prueba', no_antes_de: iso(T0 + 900_000), salto: 2 })
    await r3.fondo[0]()
    assert.deepEqual(r3.disparos, [])
    const apagado = armar({ despertador: false })
    assert.equal((await (await apagado.pedir({ alta_id: 'alta_prueba', no_antes_de: iso(T0) })).json()).aceptado, false)
  })
  test('GET: estado sin textos sensibles', async () => {
    const r = armar()
    const ev = evAlta()
    await r.m.correr([ev])
    const res = await R.estadoMotor(new Request(`https://x/api/bot/alta/motor?alta_id=alta_${ev.mensajeId}`, { headers: { authorization: 'Bearer ok' } }), r.deps)
    const j = await res.json()
    assert.equal(j.alta.pasos.finanzas.estado, 'hecho')
    assert.ok(!JSON.stringify(j).includes('ana@ejemplo.com'))
    assert.equal((await R.estadoMotor(new Request('https://x/api/bot/alta/motor', { headers: {} }), r.deps)).status, 401)
  })
})

describe('más pasos humanos y antibaneo', () => {
  test('nombre dudoso: "OK" deja el del #ALTA y "OK Nombre Apellido" lo cambia (va a Finanzas, CRM, Drive…)', async () => {
    const dos = TEXTO.replace('Nombre completo: Ana Pérez', 'Nombre completo: Ana Pérez y Luis Gómez')
    const m = motorDe()
    const ev = evAlta(dos)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'nombre')
    await m.correr([evResp('OK Ana Pérez', { citado: { id: pedido, autor: null }, autor: { telefono: AYLU, lid: null, nombre: 'Aylu' } })])
    assert.equal((await m.almacen.leerAlta(id)).validacion.nombreConfirmado, 'Ana Pérez')
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.C, 'Ana Pérez')
    assert.equal(m.dj.llamadas.drive[0].op.nombreConfirmado, 'Ana Pérez')

    const m2 = motorDe()
    const ev2 = evAlta(dos)
    const id2 = `alta_${ev2.mensajeId}`
    await m2.correr([ev2])
    await m2.correr([evResp('OK', { citado: { id: await pedidoDe(m2, id2, 'nombre'), autor: null }, autor: { telefono: AYLU, lid: null, nombre: 'Aylu' } })])
    assert.equal((await m2.almacen.leerAlta(id2)).validacion.nombreConfirmado, 'Ana Pérez y Luis Gómez')
  })
  test('NO de Aylu a la comunidad: la comunidad queda a revisar y la bienvenida frenada', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([evResp('NO falta la foto', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: { telefono: AYLU, lid: null, nombre: 'Aylu' } })])
    const p = await pasosDe(m, id)
    assert.deepEqual([p.comunidad.estado, p.bienvenida.estado], ['revisar', 'pendiente'])
    assert.equal((await m.almacen.leerAlta(id)).estado, 'revisar')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 0)
  })
  test('429 al armar la comunidad: pausa global de 24 h (nadie escribe) y aviso', async () => {
    const m = motorDe({ whapiOp: { fallas: { crearComunidad: ['soft_ban'] } } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const p = await pasosDe(m, id)
    assert.equal(p.comunidad.estado, 'reintento'); assert.equal(p.comunidad.noAntesDe, iso(T0 + 24 * 3600_000))
    const pausa = await m.almacen.leerRecurso('whapi_pausa')
    assert.equal(pausa.datos.hasta, iso(T0 + 24 * 3600_000))
    assert.ok(m.whapi.enviados.some((x) => /429/.test(x.texto)) === false)   // en pausa no sale ni el aviso
  })
  test('tope de comunidades por día: la tercera espera a que se abra lugar', async () => {
    const m = motorDe({ maxComunidadesDia: 1 })
    const a1 = evAlta()
    await m.correr([a1])
    const otro = TEXTO.replace('Ana Pérez', 'Beatriz Gómez').replace('+54 9 11 3000-1111', '+54 9 11 3000-9999').replace('ana@ejemplo.com', 'bea@ejemplo.com')
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ numero_operacion: 'OP-2' }), tokens: {} })
    const a2 = evAlta(otro, { autor: { telefono: '5497000000000', lid: null, nombre: 'Carlos' } })
    await m.correr([a2])
    const p = await pasosDe(m, `alta_${a2.mensajeId}`)
    assert.equal(p.comunidad.estado, 'reintento'); assert.match(p.comunidad.error, /tope 1/)
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 1)
  })
  test('el Fee vence a los 60 días con aviso', async () => {
    const FEE = TEXTO.replace('Este pago: 1100 USD', 'Este pago: 300 USD')
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300' }), tokens: {} })
    const ev = evAlta(FEE)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await aprobarFee(m, id)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'fee')
    m.reloj.t += 61 * 86_400_000
    await m.motor.procesar([], m.op())
    assert.equal((await m.almacen.leerAlta(id)).estado, 'vencida')
    assert.ok(m.whapi.enviados.some((x) => /60 días/.test(x.texto)))
  })
  test('purga: los payloads de entrada a los 14 días y los textos de altas terminadas a los 60', async () => {
    const m = motorDe({ modo: 'seco', capacidades: new Set() })
    const ev = evAlta()
    await m.correr([ev])
    const n = await m.almacen.purgar(iso(T0 + 61 * 86_400_000))
    assert.ok(n >= 2)
    const alta = await m.almacen.leerAlta(`alta_${ev.mensajeId}`)
    assert.equal(alta.textoOriginal, ''); assert.equal(alta.textoVigente, '')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Revisión del 24/10/2026: un test por cada hallazgo confirmado de los tres revisores (H1…H33, como en el informe).
describe('revisión del 24/10 (hallazgos de los revisores)', () => {
  const conPago = (n) => TEXTO.replace('Este pago: 1100 USD', `Este pago: ${n} USD`).replace('Cuotas:\n26/11/2026 1100\n26/12/2026 1100', `Cuotas:\n26/11/2026 ${(3300 - n) / 2}\n26/12/2026 ${(3300 - n) / 2}`)
  const TEXTO_B = TEXTO.replace('Ana Pérez', 'Bruno Díaz').replace('+54 9 11 3000-1111', '+54 9 11 4000-2222').replace('ana@ejemplo.com', 'bruno@ejemplo.com').replace('30111222', '30999888').replace('27-30111222-4', '20-30999888-1')
  const aylu = { telefono: AYLU, lid: null, nombre: 'Aylu' }
  const deCloser = (texto, over = {}) => evResp(texto, { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, veredicto: null, ...over })
  const abiertaDe = async (m, id, motivo) => (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === motivo && x.estado === 'abierta')

  test('H1 · un Fee y después el MISMO texto con otro comprobante: es el pago siguiente (no "duplicada") y llega a Finanzas', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-1' }), tokens: {} })
    const a1 = evAlta(conPago(250), { medios: [medio('pago-1')] })
    await m.correr([a1])
    await aprobarFee(m, `alta_${a1.mensajeId}`)
    assert.equal((await m.almacen.leerAlta(`alta_${a1.mensajeId}`)).estado, 'fee')
    m.reloj.t += 2 * 86_400_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-2' }), tokens: {} })
    const a2 = evAlta(conPago(250), { medios: [medio('pago-2')] })
    const id2 = `alta_${a2.mensajeId}`
    await m.correr([a2])
    const x2 = await m.almacen.leerAlta(id2)
    assert.equal(x2.altaAnterior, `alta_${a1.mensajeId}`); assert.notEqual(x2.estado, 'duplicada')
    assert.equal(m.dj.llamadas.vision.length, 2)
    assert.ok(!m.whapi.enviados.some((x) => /Ya lo tengo/.test(x.texto)))
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id2, 'fee_suma'), autor: null } })])
    assert.equal(m.dj.llamadas.finanzas.length, 2)
    assert.equal((await m.almacen.leerAlta(`alta_${a1.mensajeId}`)).estado, 'reemplazada')
  })

  test('H1 · el mismo comprobante del Fee mandado con un #ALTA nuevo se pregunta (no se suma como otro pago)', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-1' }), tokens: {} })
    await m.correr([evAlta(conPago(250), { medios: [medio('pago-igual')] })])
    m.reloj.t += 86_400_000
    const a2 = evAlta(conPago(250).replace('Closer: Marcos', 'Closer: Marcos P.'), { medios: [medio('pago-igual')] })
    await m.correr([a2])
    assert.match((await abiertaDe(m, `alta_${a2.mensajeId}`, 'validar')).pedido.join(), /mismo archivo/)
  })

  test('H2 · el comprobante sin citar 20 minutos después del pedido va al alta que lo espera; con dos esperando, pide citar', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO, { medios: [] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(id, m.op())
    m.reloj.t += 20 * 60_000
    // Ronda 2: primero queda suelto 15 minutos (lo puede reclamar el #ALTA que suele llegar enseguida); después va al alta
    const ahoraT = iso(m.reloj.t)
    await m.correr([{ ...evAdjunto(), enviadoEn: ahoraT, recibidoEn: ahoraT }])
    assert.equal((await m.almacen.leerAlta(id)).medios.length, 0)
    m.reloj.t += 16 * 60_000
    await m.motor.procesar([], m.op())
    assert.equal((await m.almacen.leerAlta(id)).medios.length, 1)
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')

    const m2 = motorDe()
    const e1 = evAlta(TEXTO, { medios: [] }), e2 = evAlta(TEXTO_B, { medios: [] })
    await m2.correr([e1, e2])
    m2.reloj.t += 181_000
    for (const e of [e1, e2]) await m2.motor.avanzar(`alta_${e.mensajeId}`, m2.op())
    m2.reloj.t += 20 * 60_000
    await m2.correr([evAdjunto()])
    assert.ok(m2.whapi.enviados.some((x) => /más de un alta esperando el comprobante/.test(x.texto)))
    for (const e of [e1, e2]) assert.equal((await m2.almacen.leerAlta(`alta_${e.mensajeId}`)).medios.length, 0)
  })

  test('H2 · datos sin citar para un alta de hace 3 días que sigue esperando al closer: se toman', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 3 * 86_400_000
    await m.correr([deCloser('DNI: 30111222')])
    assert.equal(parsearAlta((await m.almacen.leerAlta(id)).textoVigente).dni, '30111222')
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
  })

  test('H3/H29 · aviso de Skool: un dudoso se reenvía una vez (sin bucle); con errores, a revisar al cuarto; sin "mensajes_equipo" no sale', async () => {
    const w = whapiJuguete()
    let fallo = false
    const orig = w.enviarTexto
    w.enviarTexto = async (p) => { if (!fallo && /ya pagó/.test(p.texto)) { fallo = true; w.llamadas.push({ m: 'enviarTexto', p }); throw w.err('dudoso') } return orig(p) }
    const m = motorDe({ whapi: w })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal((await pasosDe(m, id)).skool.estado, 'reintento')
    m.reloj.t += 61_000
    await m.motor.avanzar(id, m.op())
    assert.equal((await pasosDe(m, id)).skool.estado, 'hecho')
    const avisos = w.enviados.filter((x) => /ya pagó/.test(x.texto))
    assert.equal(avisos.length, 1); assert.match(avisos[0].texto, /\(repetido\)$/)

    const w2 = whapiJuguete()
    const o2 = w2.enviarTexto
    w2.enviarTexto = async (p) => { if (/ya pagó/.test(p.texto)) { w2.llamadas.push({ m: 'enviarTexto', p }); throw w2.err('rechazo') } return o2(p) }
    const m2 = motorDe({ whapi: w2 })
    const ev2 = evAlta()
    const id2 = `alta_${ev2.mensajeId}`
    await m2.correr([ev2])
    for (const ms of [61_000, 301_000, 1_801_000]) { m2.reloj.t += ms; await m2.motor.avanzar(id2, m2.op()) }
    assert.equal((await pasosDe(m2, id2)).skool.estado, 'revisar')
    assert.equal(w2.llamadas.filter((x) => x.m === 'enviarTexto' && /ya pagó/.test(x.p.texto)).length, 4)
    assert.ok(await abiertaDe(m2, id2, 'revisar'))

    const m3 = motorDe({ capacidades: new Set(['finanzas', 'crm', 'reporte_verificaciones']) })
    const ev3 = evAlta()
    await m3.correr([ev3])
    assert.equal((await pasosDe(m3, `alta_${ev3.mensajeId}`)).skool.estado, 'simulado')
    assert.ok(!m3.whapi.enviados.some((x) => /ya pagó/.test(x.texto)))
  })

  test('H4 · una espera vencida se retoma citando el pedido (closer o Aylu) o forzando el paso desde el Despacho', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = m.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas && /me falta/.test(x.texto))
    m.reloj.t = T0 + 15 * 86_400_000
    await m.motor.avanzar(id, m.op())
    assert.equal((await m.almacen.leerAlta(id)).estado, 'vencida')
    await m.correr([deCloser('DNI: 30111222', { citado: { id: pedido.id, autor: null } })])
    assert.equal(parsearAlta((await m.almacen.leerAlta(id)).textoVigente).dni, '30111222')
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')

    const f = motorDe()
    const evf = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const idf = `alta_${evf.mensajeId}`
    await f.correr([evf])
    f.reloj.t = T0 + 15 * 86_400_000
    await f.motor.avanzar(idf, f.op())
    assert.equal((await f.almacen.leerAlta(idf)).estado, 'vencida')
    await f.motor.avanzar(idf, { ...f.op(), forzarPaso: 'validar' })
    assert.notEqual((await f.almacen.leerAlta(idf)).estado, 'vencida')

    const c = motorDe()
    const evc = evAlta()
    const idc = `alta_${evc.mensajeId}`
    await c.correr([evc])
    const pc = await pedidoDe(c, idc, 'comunidad')
    c.reloj.t = T0 + 15 * 86_400_000
    await c.motor.avanzar(idc, c.op())
    assert.equal((await pasosDe(c, idc)).comunidad.estado, 'revisar')
    await c.correr([evResp('OK', { citado: { id: pc, autor: null }, autor: aylu })])
    assert.equal((await c.almacen.leerAlta(idc)).estado, 'lista')

    // El comprobante que faltaba, citando el pedido, retoma un alta vencida; un "gracias" citado no
    const z = motorDe()
    const evz = evAlta(TEXTO, { medios: [] })
    const idz = `alta_${evz.mensajeId}`
    await z.correr([evz])
    z.reloj.t += 181_000
    await z.motor.avanzar(idz, z.op())
    const pz = z.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas)
    z.reloj.t = T0 + 15 * 86_400_000
    await z.motor.avanzar(idz, z.op())
    assert.equal((await z.almacen.leerAlta(idz)).estado, 'vencida')
    await z.correr([deCloser('gracias', { citado: { id: pz.id, autor: null } })])
    assert.equal((await z.almacen.leerAlta(idz)).estado, 'vencida')
    await z.correr([evAdjunto({ citado: { id: pz.id, autor: null } })])
    assert.equal((await pasosDe(z, idz)).finanzas.estado, 'hecho')

    // Una respuesta incompleta a una espera vencida la retoma (y no vuelve a vencer en la misma corrida)
    const k = motorDe()
    k.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ destinatario: 'Juan Gómez' }), tokens: {} })
    const evk = evAlta()
    const idk = `alta_${evk.mensajeId}`
    await k.correr([evk])
    const pk = await pedidoDe(k, idk, 'validar')
    k.reloj.t = T0 + 15 * 86_400_000
    await k.motor.avanzar(idk, k.op())
    assert.equal((await k.almacen.leerAlta(idk)).estado, 'vencida')
    await k.correr([evResp('OK', { citado: { id: pk, autor: null } })])   // sin la cuenta
    const ak = await k.almacen.leerAlta(idk)
    assert.equal(ak.estado, 'esperando_humano'); assert.equal(ak.esperas.find((x) => x.id === 'validar-1').estado, 'abierta')
    assert.ok(k.whapi.enviados.some((x) => /Falta la cuenta/.test(x.texto)))
  })

  test('H5/H32 · un pedido que vuelve dudoso se reenvía a los 5 minutos; uno que sale sin id cuenta como enviado (corren los recordatorios)', async () => {
    const m = motorDe({ whapiOp: { fallas: { enviarTexto: ['dudoso'] } } })
    const ev = evAlta(TEXTO, { medios: [] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(id, m.op())
    let alta = await m.almacen.leerAlta(id)
    assert.deepEqual([alta.esperas[0].mensajes.length, alta.esperas[0].intentosEnvio], [0, 1])
    assert.equal(alta.proximoIntento, iso(m.reloj.t + 300_000))
    m.reloj.t += 301_000
    await m.motor.procesar([], m.op())
    alta = await m.almacen.leerAlta(id)
    assert.equal(alta.esperas[0].mensajes.length, 1)
    assert.match(m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas).at(-1).texto, /\(repetido\)$/)

    const s = motorDe({ whapiOp: { sinId: true } })
    s.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const evs = evAlta()
    await s.correr([evs])
    const antes = s.whapi.enviados.length
    for (const h of [25, 50, 75, 100]) { s.reloj.t = T0 + h * 3600_000; await s.motor.avanzar(`alta_${evs.mensajeId}`, s.op()) }
    assert.equal(s.whapi.enviados.slice(antes).filter((x) => /Recordatorio/.test(x.texto)).length, 2)
  })

  test('H6 · si la base falla a mitad de un OK, el evento queda sin procesar y se reaplica solo; después de una hora se descarta con aviso', async () => {
    let m = null
    let fallas = 0
    const base0 = A.almacenEnMemoria({ ahora: () => (m ? m.reloj.t : T0) })
    const almacen = { ...base0, async fijarPaso(...a) { if (fallas > 0 && a[1] === 'comunidad') { fallas--; throw new Error('la base no respondió (fijar paso)') } return base0.fijarPaso(...a) } }
    m = motorDe({ almacen })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'comunidad')
    fallas = 1
    const ok = evResp('OK', { citado: { id: pedido, autor: null }, autor: aylu })
    const r = await m.correr([ok])
    assert.ok(r.errores.length)
    assert.equal(base0.volcado().entrantes.find((e) => e.evento.clave === ok.clave).estado, 'nuevo')
    m.reloj.t += 301_000
    await m.motor.procesar([], m.op())   // barrido: sin otro OK
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    assert.ok(!m.whapi.enviados.some((x) => /ya no está vigente/.test(x.texto)))

    // Falla para siempre: a la hora se descarta, con aviso
    let m2 = null
    const b2 = A.almacenEnMemoria({ ahora: () => (m2 ? m2.reloj.t : T0) })
    const alm2 = { ...b2, async fijarPaso(...a) { if (a[1] === 'comunidad' && a[3]?.estado === 'hecho') throw new Error('la base no respondió'); return b2.fijarPaso(...a) } }
    m2 = motorDe({ almacen: alm2 })
    const ev2 = evAlta()
    const id2 = `alta_${ev2.mensajeId}`
    await m2.correr([ev2])
    const ok2 = evResp('OK', { citado: { id: await pedidoDe(m2, id2, 'comunidad'), autor: null }, autor: aylu })
    await m2.correr([ok2])
    m2.reloj.t += 3601_000
    await m2.motor.avanzar(id2, m2.op())
    assert.equal(b2.volcado().entrantes.find((e) => e.evento.clave === ok2.clave).estado, 'ignorado')
    assert.ok(m2.whapi.enviados.some((x) => /No pude aplicar un mensaje/.test(x.texto)))

    // Se aplicó entero pero falló marcarlo procesado: al reaplicarlo no se repite nada (ni "no vigente" ni otra bienvenida)
    let m3 = null
    let fallaMarca = false
    const b3 = A.almacenEnMemoria({ ahora: () => (m3 ? m3.reloj.t : T0) })
    const alm3 = { ...b3, async marcarProcesado(claves, estado) { if (fallaMarca && claves.length === 1 && claves[0].startsWith('OK3')) { fallaMarca = false; throw new Error('la base no respondió') } return b3.marcarProcesado(claves, estado) } }
    m3 = motorDe({ almacen: alm3 })
    const ev3 = evAlta()
    const id3 = `alta_${ev3.mensajeId}`
    await m3.correr([ev3])
    fallaMarca = true
    await m3.correr([evResp('OK', { id: 'OK3-1', citado: { id: await pedidoDe(m3, id3, 'comunidad'), autor: null }, autor: aylu })])
    m3.reloj.t += 301_000
    await m3.motor.procesar([], m3.op())
    assert.equal(b3.volcado().entrantes.find((e) => e.evento.clave === 'OK3-1').estado, 'procesado')
    assert.equal(m3.whapi.enviados.filter((x) => x.tipo === 'video').length, 1)
    assert.ok(!m3.whapi.enviados.some((x) => /ya no está vigente/.test(x.texto)))
  })

  test('H7 · el General que creó WhatsApp se guarda antes de sumar a la gente: un 409 o un dudoso no crean otro General', async () => {
    for (const falla of ['ya_existe', 'dudoso']) {
      const m = motorDe({ whapiOp: { generalChat: true, fallas: { agregarParticipantes: [falla] } } })
      const ev = evAlta()
      const id = `alta_${ev.mensajeId}`
      await m.correr([ev])
      assert.deepEqual(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').map((x) => x.p.nombre), ['Ventas - Ana Pérez', 'Contenido - Ana Pérez'])
      assert.equal((await pasosDe(m, id)).comunidad.parcial.grupos.general.id, 'general-auto@g.us')
      const texto = (await abiertaDe(m, id, 'comunidad')).datos.texto
      if (falla === 'dudoso') assert.match(texto, /No sé si se sumó la gente al General/)
      else assert.doesNotMatch(texto, /General: .*no entraron/)
    }
  })

  test('H8 · OK a un grupo dudoso: lo busca y sigue con lo que falta (otro grupo, fotos, OK de Aylu); si no lo encuentra, a revisar sin crear otro', async () => {
    const ventas = { id: 'grupo-ventas-real@g.us', nombre: 'Ventas - Ana Pérez', codigoInvitacion: 'VENTAS1' }
    const m = motorDe({ whapiOp: { otros: [ventas], fallas: { crearGrupoEnComunidad: [null, 'dudoso'] } } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const e = await abiertaDe(m, id, 'dudoso')
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null }, autor: aylu })])
    assert.deepEqual(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').map((x) => x.p.nombre), ['General - Ana Pérez', 'Ventas - Ana Pérez', 'Contenido - Ana Pérez'])
    assert.equal((await pasosDe(m, id)).comunidad.parcial.grupos.ventas.id, 'grupo-ventas-real@g.us')
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'ponerFoto').length, 4)
    const okAylu = await abiertaDe(m, id, 'comunidad')
    assert.match(okAylu.datos.texto, /revisá que estén todos/)
    await m.correr([evResp('OK', { citado: { id: okAylu.mensajes[0], autor: null }, autor: aylu })])
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 1)

    const n = motorDe({ whapiOp: { fallas: { crearGrupoEnComunidad: [null, 'dudoso'] } } })
    const evn = evAlta()
    const idn = `alta_${evn.mensajeId}`
    await n.correr([evn])
    const en = await abiertaDe(n, idn, 'dudoso')
    await n.correr([evResp('OK', { citado: { id: en.mensajes[0], autor: null }, autor: aylu })])
    assert.equal((await pasosDe(n, idn)).comunidad.estado, 'revisar')
    assert.equal(n.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').length, 2)
  })

  test('H9/H25 · lo que sigue al "OK" solo cambia el nombre si parece un nombre ("OK, gracias" deja el del #ALTA)', async () => {
    assert.deepEqual(P.nombreDeResto(', gracias'), { tipo: 'vacio' })
    assert.deepEqual(P.nombreDeResto('👍'), { tipo: 'vacio' })
    assert.deepEqual(P.nombreDeResto('está bien'), { tipo: 'vacio' })
    assert.deepEqual(P.nombreDeResto('Ana Pérez'), { tipo: 'nombre', nombre: 'Ana Pérez' })
    assert.deepEqual(P.nombreDeResto('María de los Ángeles Gómez'), { tipo: 'nombre', nombre: 'María de los Ángeles Gómez' })
    assert.deepEqual(P.nombreDeResto('es una sola persona'), { tipo: 'no_entendido' })
    assert.deepEqual(P.nombreDeResto('ana pérez'), { tipo: 'no_entendido' })
    assert.deepEqual(P.nombreDeResto('Ana'), { tipo: 'no_entendido' })

    const DOS = TEXTO.replace('Nombre completo: Ana Pérez', 'Nombre completo: Ana Pérez y Luis Gómez')
    const m = motorDe()
    const ev = evAlta(DOS)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'nombre')
    await m.correr([evResp('OK, es una sola persona', { citado: { id: pedido, autor: null }, autor: aylu })])
    assert.ok(m.whapi.enviados.some((x) => /No entendí el nombre/.test(x.texto)))
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    assert.ok(await abiertaDe(m, id, 'nombre'))
    await m.correr([evResp('Ok, gracias', { citado: { id: pedido, autor: null }, autor: aylu })])
    assert.equal((await m.almacen.leerAlta(id)).validacion.nombreConfirmado, 'Ana Pérez y Luis Gómez')
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.C, 'Ana Pérez y Luis Gómez')

    const c = motorDe()
    c.dj.colas.drive.push(driveOk({ ok: true, completo: false, esperaOk: 'carpeta_existente', guardar: {}, pendientes: ['Ya había una carpeta'], carpeta: { estado: 'pendiente', id: ID_CARPETA, url: 'https://drive/c' } }))
    const evc = evAlta()
    const idc = `alta_${evc.mensajeId}`
    await c.correr([evc])
    const pc = await pedidoDe(c, idc, 'carpeta')
    await c.correr([evResp('OK, es la de ella', { citado: { id: pc, autor: null }, autor: aylu })])
    assert.equal(c.dj.llamadas.drive.length, 1)
    await c.correr([evResp('OK 👍', { citado: { id: pc, autor: null }, autor: aylu })])
    assert.deepEqual([c.dj.llamadas.drive[1].op.guardado, c.dj.llamadas.drive[1].op.nombreConfirmado], [{ carpeta: { id: ID_CARPETA, url: 'https://drive/c' } }, null])
  })

  test('H10/H24 · el MEP con el separador de miles argentino ("OK 1.450") se lee entero', async () => {
    for (const [t, mep] of [['1.450', 1450], ['$1.450', 1450], ['1.450,50', 1450.5], ['Tomi 1.485', 1485], ['1450', 1450], ['1,450.50', 1450.5], ['1.45', null], ['12.345.678', null]]) assert.equal(P.leerRestoOk(t).mep, mep, t)
    assert.equal(P.leerRestoOk('Tomi 1.485').cuenta, 'Tomi')
  })

  test('H11 · el mismo #ALTA reenviado con la imagen que faltaba: la imagen va al alta original', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO, { medios: [] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(id, m.op())
    m.reloj.t += 60_000
    const ev2 = evAlta(TEXTO, { medios: [medio('img-reenvio')] })
    await m.correr([ev2])
    assert.deepEqual((await m.almacen.leerAlta(id)).medios.map((x) => x.id), ['img-reenvio'])
    assert.equal(await m.almacen.leerAlta(`alta_${ev2.mensajeId}`), null)
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
    assert.ok(!m.whapi.enviados.some((x) => /Ya lo tengo/.test(x.texto)))
  })

  test('H12/H28 · un Fee en tres partes suma todo (150 + 160 + 250 = 560): los Fee anteriores quedan reemplazados y nada vence a los 60 días', async () => {
    const m = motorDe()
    const ids = []
    for (const [usd, op] of [[150, 'OP-A'], [160, 'OP-B'], [250, 'OP-C']]) {
      m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: String(usd), numero_operacion: op }), tokens: {} })
      const ev = evAlta(conPago(usd))
      await m.correr([ev])
      ids.push(`alta_${ev.mensajeId}`)
      await aprobarFee(m, ids.at(-1))
      m.reloj.t += 3600_000
    }
    const e = await abiertaDe(m, ids[2], 'fee_suma')
    assert.match(e.pedido[0], /los pagos suman 150 \+ 160 \+ 250 = 560 USD/)
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null } })])
    assert.equal(m.dj.llamadas.crm.at(-1).a.estePagoUsd, 560)
    assert.deepEqual((await Promise.all(ids.slice(0, 2).map((i) => m.almacen.leerAlta(i)))).map((a) => a.estado), ['reemplazada', 'reemplazada'])
    m.reloj.t = T0 + 61 * 86_400_000
    await m.motor.procesar([], m.op())
    assert.ok(!m.whapi.enviados.some((x) => /60 días/.test(x.texto)))
  })

  test('H13 · el comprobante del alta siguiente (mandado antes de su #ALTA) no se lo queda la anterior ya validada; Neon igual que memoria', async () => {
    const m = motorDe()
    const a = evAlta(TEXTO, { medios: [] })
    await m.correr([a])
    m.reloj.t += 10_000
    await m.correr([evAdjunto({ medios: [medio('img-A')] })])
    m.reloj.t += 20_000
    await m.correr([evAdjunto({ medios: [medio('img-B')] })])
    m.reloj.t += 20_000
    const b = evAlta(TEXTO_B, { medios: [] })
    await m.correr([b])
    assert.deepEqual((await m.almacen.leerAlta(`alta_${a.mensajeId}`)).medios.map((x) => x.id), ['img-A'])
    assert.deepEqual((await m.almacen.leerAlta(`alta_${b.mensajeId}`)).medios.map((x) => x.id), ['img-B'])
    // Un álbum de verdad (las fotos juntas, antes de validar) sí se suma
    const alm = A.almacenEnMemoria({ ahora: () => T0 })
    await alm.crearAlta({ id: 'alta_x', modo: 'real', capacidades: [], entorno: 'test', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: null }, mensajeAltaId: 'x', textoOriginal: TEXTO, huella: 'h', telefonoCliente: TEL_ANA, nombreCliente: 'Ana', medios: [medio('p1')], altaAnterior: null })
    assert.equal(await alm.adjuntarMedio({ chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: null }, desde: iso(T0 - 900_000), medios: [medio('p2')], ahora: iso(T0 + 5_000) }), 'alta_x')
    // Neon (cliente SQL falso): misma condición y medios_actualizado al nacer con medios
    process.env.DATABASE_URL = 'postgres://usuario:clave@base.inventada/db'
    try {
      const consultas = []
      const q = (strings, ...vals) => { consultas.push(strings.join('$').replace(/\s+/g, ' ')); return (async () => (/information_schema/.test(strings.join('')) ? Object.entries(N.COLUMNAS_AGREGABLES).flatMap(([t, cs]) => cs.map(([c]) => ({ table_name: t, column_name: c }))) : []))() }
      q.unsafe = (raw) => ({ raw })
      N.sqlParaPruebas(() => q)
      const neon = N.almacenNeon()
      await neon.adjuntarMedio({ chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: null }, desde: iso(T0), medios: [medio('z')], ahora: iso(T0) })
      assert.ok(consultas.some((c) => /medios = '\[\]'::jsonb OR \(validacion IS NULL AND medios_actualizado >/.test(c)))
      await neon.crearAlta({ id: 'alta_n', modo: 'real', capacidades: [], entorno: 'test', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: null }, mensajeAltaId: 'n', textoOriginal: 'x', huella: 'h', telefonoCliente: null, nombreCliente: null, medios: [medio('m')], altaAnterior: null }).catch(() => null)
      assert.ok(consultas.some((c) => /INSERT INTO cj_altas \(.*medios_actualizado.*CASE WHEN \$::boolean THEN now\(\) ELSE NULL END/.test(c)))
      await neon.reclamarEdiciones({ altaId: 'alta_n', mensajeId: 'n' })
      assert.ok(consultas.some((c) => /tipo = 'edicion' AND whapi_id = \$/.test(c)))
    } finally { delete process.env.DATABASE_URL; N.sqlParaPruebas(null) }
  })

  test('H14 · un alta nacida en seco y rehecha en real usa la fecha del comprobante (en seco no se congela nada)', async () => {
    const almacen = A.almacenEnMemoria({ ahora: () => T0 })
    const seco = motorDe({ almacen, modo: 'seco', capacidades: new Set() })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await seco.correr([ev])
    assert.equal((await almacen.leerAlta(id)).fechaPago, null)
    const real = motorDe({ almacen })
    real.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ fecha: '2026-10-23' }), tokens: {} })
    await real.motor.avanzar(id, { ...real.op(), rehacerEnReal: true })
    assert.equal((await almacen.leerAlta(id)).fechaPago, '2026-10-23')
    assert.equal(real.dj.llamadas.finanzas[0].fila.celdas.A, 46318)
  })

  test('H15 · un Fee que espera un OK y llega el #ALTA del pago siguiente: alta nueva (no corrección); el Fee termina reemplazado', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300', numero_operacion: 'OP-F', destinatario: 'Fulano' }), tokens: {} })
    const fee = evAlta(conPago(300), { medios: [medio('fee-img')] })
    const idFee = `alta_${fee.mensajeId}`
    await m.correr([fee])
    const pedidoCuenta = await pedidoDe(m, idFee, 'validar')
    m.reloj.t += 3600_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900', numero_operacion: 'OP-2' }), tokens: {} })
    const seg = evAlta(conPago(900), { medios: [medio('seg-img')] })
    await m.correr([seg])
    const nueva = await m.almacen.leerAlta(`alta_${seg.mensajeId}`)
    assert.equal(nueva.altaAnterior, idFee)
    const f = await m.almacen.leerAlta(idFee)
    assert.equal(parsearAlta(f.textoVigente).estePagoUsd, 300); assert.deepEqual(f.medios.map((x) => x.id), ['fee-img'])
    assert.ok(!m.whapi.enviados.some((x) => /Tomé la corrección/.test(x.texto)))
    await m.correr([evResp('OK Empresa', { citado: { id: pedidoCuenta, autor: null } })])
    await aprobarFee(m, idFee)   // 26/10: el Fee pide su OK (Finanzas + comunidad)
    assert.equal((await m.almacen.leerAlta(idFee)).estado, 'reemplazada')
  })

  test('H16 · una edición que llega antes que su #ALTA se aplica; una corrección de un alta rechazada no dice "Tomé la corrección"', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    const ed = { ...base({}), tipo: 'edicion', grupo: 'ventas', mensajeId: ev.mensajeId, clave: `ed:${ev.mensajeId}:y`, citado: null, texto: TEXTO.replace('DNI: 30111222', 'DNI: 30999888') }
    await m.correr([ed])
    await m.correr([ev])
    assert.equal(parsearAlta((await m.almacen.leerAlta(id)).textoVigente).dni, '30999888')

    const r = motorDe()
    r.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const evr = evAlta()
    const idr = `alta_${evr.mensajeId}`
    await r.correr([evr])
    await r.correr([evResp('NO, el monto no coincide', { citado: { id: await pedidoDe(r, idr, 'validar'), autor: null } })])
    await r.correr([{ ...base({}), tipo: 'edicion', grupo: 'ventas', mensajeId: evr.mensajeId, clave: `ed:${evr.mensajeId}:z`, citado: null, texto: TEXTO.replace('1100 USD · Transferencia', '900 USD · Transferencia') }])
    const alCloser = r.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas).map((x) => x.texto)
    assert.ok(alCloser.some((t) => /está rechazada: no tomé la corrección/.test(t)))
    assert.ok(!alCloser.some((t) => /Tomé la corrección/.test(t)))
  })

  test('H17 · el mismo #ALTA procesado por dos invocaciones a la vez: ningún "Ya lo tengo" falso', async () => {
    for (const desfase of [0, 1, 2, 3, 5, 8]) {
      const m = motorDe()
      const ev = evAlta()
      await m.motor.registrar([ev])
      const demora = async (n) => { for (let i = 0; i < n; i++) await null }
      await Promise.all([m.motor.procesar([ev], m.op()), (async () => { await demora(desfase); return m.motor.procesar([ev], m.op()) })()])
      const alCloser = m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas).map((x) => x.texto)
      assert.ok(!alCloser.some((t) => /Ya lo tengo|Tomé la corrección/.test(t)), `desfase ${desfase}: ${alCloser.join(' | ')}`)
    }
  })

  test('H18 · bienvenida en dos mensajes con el texto dudoso: el NO reenvía solo el texto (el video no se repite)', async () => {
    const LARGO = TEXTO.replace('ana@ejemplo.com', `ana.${'x'.repeat(400)}@ejemplo.com`)
    const w = whapiJuguete()
    let fallo = false
    const orig = w.enviarTexto
    w.enviarTexto = async (p) => { if (!fallo && p.chatId.startsWith('grupo-')) { fallo = true; w.llamadas.push({ m: 'enviarTexto', p }); throw w.err('dudoso') } return orig(p) }
    const m = motorDe({ whapi: w })
    const ev = evAlta(LARGO)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: aylu })])
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'bienvenida'), autor: null }, autor: aylu })])
    const d = await abiertaDe(m, id, 'dudoso')
    assert.equal(d.datos.proposito, 'bienvenida:texto')
    await m.correr([evResp('NO', { citado: { id: d.mensajes[0], autor: null }, autor: aylu })])
    assert.equal(w.enviados.filter((x) => x.tipo === 'video').length, 1)
    assert.equal(w.enviados.filter((x) => x.tipo === 'texto' && x.chatId.startsWith('grupo-')).length, 1)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
  })

  test('H19 · una edición que no cambia los datos (un emoji) no frena el alta', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([{ ...base({ id: ev.mensajeId, clave: `ed:${ev.mensajeId}:${sha('emoji')}` }), tipo: 'edicion', grupo: 'ventas', texto: TEXTO.replace('Closer: Marcos', 'Closer: Marcos 🙌') }])
    assert.equal(await abiertaDe(m, id, 'correccion'), undefined)
    assert.equal((await pasosDe(m, id)).validar.estado, 'hecho')
  })

  test('H20 · si bajar el comprobante para Finanzas falla, la fila no queda congelada: una corrección se carga con los datos nuevos', async () => {
    // Solo Finanzas de verdad (los demás pasos en vista previa): así nada más quedó escrito afuera
    const m = motorDe({ capacidades: new Set(['finanzas', 'reporte_verificaciones', 'mensajes_equipo']), whapiOp: { fallas: { descargarMedio: [null, 'pasajero'] } } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const fin = (await pasosDe(m, id)).finanzas
    assert.equal(fin.estado, 'reintento'); assert.equal(fin.parcial.fila, undefined)
    await m.correr([evAlta(TEXTO.replace('Nombre completo: Ana Pérez', 'Nombre completo: Ana María Pérez'), { citado: { id: ev.mensajeId, autor: null }, medios: [] })])
    assert.ok(m.whapi.enviados.some((x) => /Tomé la corrección/.test(x.texto)))
    m.reloj.t += 61_000
    await m.motor.avanzar(id, m.op())
    assert.equal(m.dj.llamadas.finanzas.length, 1)
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.C, 'Ana María Pérez')
    assert.equal(await abiertaDe(m, id, 'finanzas_cambio'), undefined)
  })

  test('H21 · un OK de alguien que no aprueba no deshace el NO de Tomi', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '900' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'validar')
    await m.correr([evResp('No, el monto no coincide', { citado: { id: pedido, autor: null } })])
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' } })])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'rechazada'); assert.equal(alta.esperas[0].estado, 'rechazada')
    m.reloj.t += 25 * 3600_000
    const antes = m.whapi.enviados.length
    await m.motor.procesar([], m.op())
    assert.ok(!m.whapi.enviados.slice(antes).some((x) => /Recordatorio/.test(x.texto)))
  })

  test('H22 · "Cuenta: Gero" mandada en Ventas no pisa la cuenta del comprobante: se pregunta a Tomi o Gero', async () => {
    const m = motorDe({ setterFuente: null })
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ destinatario: 'Napolitano Tomás' }), tokens: {} })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'datos')
    await m.correr([deCloser('Setter: Mai\nFuente: Inbound IG\nCuenta: Gero', { autor: { telefono: '5498888888888', lid: null, nombre: 'Otro' }, citado: { id: pedido, autor: null } })])
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    const e = await abiertaDe(m, id, 'validar')
    assert.match(e.pedido.join(), /dijeron que la cuenta que recibió es Gero, pero el comprobante indica Tomi/)
    assert.ok(e.requiere.includes('cuenta'))
    await m.correr([evResp('OK Tomi', { citado: { id: e.mensajes[0], autor: null } })])
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.R, 'Tomi')
  })

  test('H30 · NO a la suma Fee + este pago: el pago se carga igual en Finanzas como Fee y el alta espera otro pago', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300', numero_operacion: 'OP-F' }), tokens: {} })
    const fee = evAlta(conPago(300))
    await m.correr([fee])
    await aprobarFee(m, `alta_${fee.mensajeId}`)
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-G' }), tokens: {} })
    const ev = evAlta(conPago(250))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([evResp('NO, que siga como seña por ahora', { citado: { id: await pedidoDe(m, id, 'fee_suma'), autor: null } })])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'fee')
    assert.equal(m.dj.llamadas.finanzas.length, 2); assert.equal(m.dj.llamadas.finanzas[1].fila.celdas.J, 'Fee')
    assert.equal((await m.almacen.leerAlta(`alta_${fee.mensajeId}`)).estado, 'reemplazada')
    assert.equal(alta.validacion.usdAcumulado, 550)
  })

  test('H31 · el eco de la bienvenida en el General del cliente (clasificado por el webhook de W) confirma un envío dudoso', async () => {
    const W = await import('../lib/bot/whapi/webhook.ts')
    const { armarBienvenida } = await import('../lib/bot/alta/bienvenida.ts')
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = await pedidoDe(m, id, 'comunidad')
    const general = (await pasosDe(m, id)).comunidad.parcial.grupos.general.id
    const pie = armarBienvenida(parsearAlta(TEXTO)).mensajeGrupo
    await m.almacen.anotarSaliente({ altaId: id, proposito: 'bienvenida:video', chatId: general, huella: sha(F.textoNormalizado(pie)) })
    await m.correr([evResp('OK', { citado: { id: pedido, autor: null }, autor: aylu })])
    assert.equal((await pasosDe(m, id)).bienvenida.estado, 'espera')
    const r = W.clasificarEnvoltura({ messages: [{ id: 'eco-bienvenida-1', from_me: true, source: 'api', type: 'video', chat_id: general, timestamp: Math.floor(m.reloj.t / 1000), video: { id: 'mp4-aa-bb', caption: pie }, from: '5490000000000' }] }, GRUPOS, m.reloj.t)
    assert.deepEqual([r.eventos.length, r.eventos[0].tipo, r.eventos[0].grupo], [1, 'eco', null])
    await m.correr(r.eventos)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 0)
  })

  test('checklist del chip · scripts/bot-alta-migrar.mjs: --simular no se conecta; --real mira; --real --confirmar crea (cliente falso)', async () => {
    const MG = await import('./bot-alta-migrar.mjs')
    const out = []
    const salida = (t) => out.push(t)
    assert.equal(process.env.DATABASE_URL, undefined)
    assert.equal(await MG.main(['--simular'], { salida }), 0)
    const todo = out.join('\n')
    assert.match(todo, /CREATE TABLE IF NOT EXISTS cj_altas \(/); assert.match(todo, /cj_altas_recursos/)
    assert.doesNotMatch(todo, /DROP|ALTER TABLE/)
    assert.equal(process.env.DATABASE_URL, undefined, 'la simulación no deja DATABASE_URL puesta')
    out.length = 0
    assert.equal(await MG.main(['--real'], { salida }), 1)
    assert.equal(await MG.main(['--confirmar'], { salida }), 1)
    // Con una "base" falsa: primero sin tablas, después de asegurarTablas con todas
    const URL_FALSA = 'postgres://usuario:clave@base.inventada/db'
    process.env.DATABASE_URL = URL_FALSA
    try {
      let creadas = false
      const sentencias = []
      const crearSql = () => {
        const q = (strings, ...vals) => {
          const t = strings.join('$')
          sentencias.push(t)
          if (/CREATE TABLE/.test(t)) creadas = true
          const cols = Object.entries(N.COLUMNAS_AGREGABLES).flatMap(([tb, cs]) => cs.map(([c]) => ({ table_name: tb, column_name: c })))
          return (async () => (/information_schema/.test(t) ? (creadas ? [...cols, { table_name: 'cj_altas_recursos', column_name: 'nombre' }] : []) : []))()
        }
        q.unsafe = (raw) => ({ raw })
        return q
      }
      out.length = 0
      assert.equal(await MG.main(['--real'], { salida, crearSql }), 0)
      assert.match(out.join('\n'), /Faltan: tabla cj_altas, tabla cj_altas_pasos/)
      assert.ok(!sentencias.some((x) => /CREATE/.test(x)), '--real sin --confirmar no crea nada')
      out.length = 0
      assert.equal(await MG.main(['--real', '--confirmar'], { salida, crearSql }), 0)
      assert.match(out.join('\n'), /✔ Tablas del motor listas/)
      assert.ok(!out.join('\n').includes('base.inventada') && !out.join('\n').includes('clave'))
    } finally { delete process.env.DATABASE_URL; N.sqlParaPruebas(null) }
  })

  test('H33 · el video de la bienvenida lleva el plazo de la invocación y el paso solo arranca con tiempo para el peor caso', async () => {
    const CL = await import('../lib/bot/whapi/cliente.ts')
    assert.ok(E.DURACION_MAX_MS.bienvenida >= 2 * CL.CORTE_VIDEO_MS + CL.CORTE_PEDIDO_MS)
    assert.ok(E.DURACION_MAX_MS.bienvenida <= 285_000)
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: aylu })])
    const v = m.whapi.llamadas.find((x) => x.m === 'enviarVideo')
    assert.equal(typeof v.p.hasta, 'number'); assert.ok(v.p.hasta > m.reloj.t && v.p.hasta <= m.reloj.t + 285_000)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Socios con correo (Tomás, 24/10/2026): los socios también reciben la invitación a Skool. El #ALTA trae el correo de cada
// socio ("Socios:" y uno por línea); sin correo, el bot se lo pide al closer y la respuesta se SUMA al socio que ya estaba.
describe('socios con correo (24/10)', () => {
  const aylu = { telefono: AYLU, lid: null, nombre: 'Aylu' }
  const enVentas = (pedidoId) => ({ grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, citado: { id: pedidoId, autor: null }, veredicto: null })
  const CON_SOCIA = TEXTO.replace('Socios: ninguno', 'Socios:\nBeatriz Gómez · +54 9 11 3000-4444 · bea@ejemplo.com')
  const SOCIA_SIN_CORREO = TEXTO.replace('Socios: ninguno', 'Socios: Beatriz Gómez +54 9 11 3000-4444')

  test('fusión: "Socios:" con "Nombre · correo" completa al socio que ya estaba, sin perder su teléfono ni tocar el correo del cliente', () => {
    const f = F.fusionarRespuesta(SOCIA_SIN_CORREO, 'Socios:\nBeatriz Gómez · bea@ejemplo.com')
    const a = parsearAlta(f.texto)
    assert.deepEqual(a.faltantes, [])
    assert.equal(a.correo, 'ana@ejemplo.com')
    assert.deepEqual(a.telefonos.map((t) => t.numero), [TEL_ANA, '5491130004444'])
    assert.deepEqual(f.cambios.map((c) => [c.campo, c.tipo]), [['socios', 'completa']])
    assert.ok(f.texto.indexOf('Socios:') < f.texto.indexOf('Correo:'), 'el bloque queda donde estaba')
    // Solo el nombre de pila, o el correo solo (si hay un único socio sin correo), también se suman
    assert.deepEqual(parsearAlta(F.fusionarRespuesta(SOCIA_SIN_CORREO, 'Socios: Beatriz bea@ejemplo.com').texto).faltantes, [])
    assert.deepEqual(parsearAlta(F.fusionarRespuesta(SOCIA_SIN_CORREO, 'Socios: bea@ejemplo.com').texto).faltantes, [])
    // Un nombre escrito distinto ("Bea Gómez") va a la única socia sin correo que se le parece: no queda duplicada
    const bea = parsearAlta(F.fusionarRespuesta(SOCIA_SIN_CORREO, 'Socios: Bea Gómez · bea@ejemplo.com').texto)
    assert.deepEqual(bea.faltantes, [])
    assert.equal(bea.socios, 'Beatriz Gómez · +5491130004444 · bea@ejemplo.com')
  })

  test('fusión: un teléfono o un correo distinto corrige; un socio nuevo o "Socios: ninguno" también; repetir lo mismo no cambia nada', () => {
    const otroTel = F.fusionarRespuesta(CON_SOCIA, 'Socios:\nBeatriz Gómez · +54 9 11 3000-5555')
    assert.deepEqual(otroTel.cambios.map((c) => c.tipo), ['corrige'])
    assert.deepEqual(parsearAlta(otroTel.texto).telefonos.map((t) => t.numero), [TEL_ANA, '5491130005555'])
    assert.equal(F.fusionarRespuesta(CON_SOCIA, 'Socios:\nBeatriz Gómez · bea.nueva@ejemplo.com').cambios[0].tipo, 'corrige')
    const nuevo = F.fusionarRespuesta(CON_SOCIA, 'Socios:\nCarla Paz · +54 9 11 3000-6666 · carla@ejemplo.com')
    assert.equal(nuevo.cambios[0].tipo, 'corrige')
    assert.equal(parsearAlta(nuevo.texto).socios.split('; ').length, 2)
    const ninguno = F.fusionarRespuesta(CON_SOCIA, 'Socios: ninguno')
    assert.equal(ninguno.cambios[0].tipo, 'corrige')
    assert.equal(parsearAlta(ninguno.texto).socios, null)
    assert.deepEqual(parsearAlta(ninguno.texto).telefonos.map((t) => t.numero), [TEL_ANA])
    const igual = F.fusionarRespuesta(CON_SOCIA, 'Socios:\nBeatriz Gómez · bea@ejemplo.com')
    assert.equal(igual.cambios[0].tipo, 'igual')
    assert.equal(igual.texto, CON_SOCIA, 'sin cambios, el texto queda tal cual')
    // Sin bloque de socios en el #ALTA: se suma antes de "Cuotas:" y completa
    const sinBloque = F.fusionarRespuesta(TEXTO.replace('Socios: ninguno\n', ''), 'Socios:\nBeatriz Gómez · +54 9 11 3000-4444 · bea@ejemplo.com')
    assert.equal(sinBloque.cambios[0].tipo, 'completa')
    assert.ok(sinBloque.texto.indexOf('Socios:') < sinBloque.texto.indexOf('Cuotas:'))
    // Las otras líneas de la respuesta siguen igual ("DNI:" después del bloque de socios)
    const conDni = F.fusionarRespuesta(SOCIA_SIN_CORREO.replace('DNI: 30111222\n', ''), 'Socios:\nBeatriz Gómez · bea@ejemplo.com\nDNI: 30111222')
    assert.deepEqual(conDni.cambios.map((c) => [c.campo, c.tipo]), [['socios', 'completa'], ['dni', 'completa']])
    assert.equal(F.lineasReconocidas('Socios:\nBeatriz Gómez · bea@ejemplo.com'), 1)
  })

  test('el pedido al closer nombra al socio sin correo y da el ejemplo de "Socios:" (no "Correo:", que pisaría el del cliente); la respuesta citando lo completa', async () => {
    const m = motorDe()
    const ev = evAlta(SOCIA_SIN_CORREO)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = m.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas)
    assert.match(pedido.texto, /• Correo de cada socio \(falta el de Beatriz Gómez\)/)
    assert.match(pedido.texto, /Por ejemplo:\nSocios:\nLaura Gómez · laura@ejemplo\.com/)
    assert.ok(!/Correo: ana@ejemplo\.com/.test(pedido.texto))
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'pendiente')
    await m.correr([evResp('Socios:\nBeatriz Gómez · bea@ejemplo.com', enVentas(pedido.id))])
    const a = parsearAlta((await m.almacen.leerAlta(id)).textoVigente)
    assert.deepEqual(a.faltantes, [])
    assert.equal(a.correo, 'ana@ejemplo.com')
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
    assert.ok(m.whapi.enviados.some((x) => /Lo sumé al alta de Ana Pérez/.test(x.texto)))
  })

  test('camino feliz con una socia: Skool con los dos correos ("Invitalo"), la socia en los grupos y la bienvenida "a sus correos (…)"', async () => {
    // WhatsApp seguro (26/10): sumar a la socia a los grupos es el modo viejo, que ahora solo corre con
    // BOT_COMUNIDAD_AGREGAR_DIRECTO=si (agregarDirecto). Este test lo prende para seguir cubriéndolo
    const m = motorDe({ pasos: { agregarDirecto: true } })
    const ev = evAlta(CON_SOCIA)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const skool = m.whapi.enviados.find((x) => /Skool/.test(x.texto) && x.chatId === GRUPOS.verificaciones)
    assert.equal(skool.texto, `@${AYLU} Ana Pérez ya pagó. Invitalo a Skool con su socia Beatriz Gómez: Configuración → Invitar → correos: ana@ejemplo.com, bea@ejemplo.com`)
    assert.ok(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').every((x) => JSON.stringify(x.p.participantes).includes('5491130004444')))
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: aylu })])
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    const video = m.whapi.enviados.find((x) => x.tipo === 'video')
    assert.match(video.pie, /^Hola Ana y Beatriz! Cómo va\? Muy bienvenidos a Capital Jurídico!/)
    assert.ok(video.pie.endsWith('\nLes va a llegar una invitación a sus correos (ana@ejemplo.com, bea@ejemplo.com) para entrar a la plataforma.'))
    assert.ok(video.pie.length <= 1024)
  })

  test('seco: el registro dice a quiénes invitaría (cliente y socios)', async () => {
    const m = motorDe({ modo: 'seco' })
    const ev = evAlta(CON_SOCIA)
    await m.correr([ev])
    const pasos = await pasosDe(m, `alta_${ev.mensajeId}`)
    assert.equal(pasos.skool.estado, 'simulado')
    assert.match(pasos.skool.resultado.aviso, /correos: ana@ejemplo\.com, bea@ejemplo\.com$/)
    assert.equal(m.whapi.enviados.length, 0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Revisión del 24/10, ronda 2: los hallazgos de la segunda revisión (scripts de ronda2/ del scratchpad, pasados a tests).
describe('revisión del 24/10, ronda 2', () => {
  const aylu = { telefono: AYLU, lid: null, nombre: 'Aylu' }
  const conPago = (n) => TEXTO.replace('Este pago: 1100 USD', `Este pago: ${n} USD`).replace('Cuotas:\n26/11/2026 1100\n26/12/2026 1100', `Cuotas:\n26/11/2026 ${(3300 - n) / 2}\n26/12/2026 ${(3300 - n) / 2}`)
  const otroCliente = (nombre, tel, mail, dni, cuit) => TEXTO.replace('Ana Pérez', nombre).replace('+54 9 11 3000-1111', tel).replace('ana@ejemplo.com', mail).replace('30111222', dni).replace('27-30111222-4', cuit)
  const TEXTO_B = otroCliente('Bruno Díaz', '+54 9 11 4000-2222', 'bruno@ejemplo.com', '30999888', '20-30999888-1')
  const TEXTO_Z = otroCliente('Zoe Ruiz', '+54 9 11 5000-3333', 'zoe@ejemplo.com', '31222333', '27-31222333-5')
  /** El evento con la hora del reloj del motor (recibidoEn = cuando llega el webhook). */
  const ya = (m, ev, mas = 0) => ({ ...ev, enviadoEn: iso(m.reloj.t + mas), recibidoEn: iso(m.reloj.t) })
  const deCloser = (texto, over = {}) => evResp(texto, { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, veredicto: null, ...over })
  const enVentas = (m) => m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas)
  /** Alta sin comprobante a la que el bot ya le pidió el comprobante (a los 3 minutos). */
  async function esperandoComprobante(m, texto = TEXTO) {
    const ev = ya(m, evAlta(texto, { medios: [] }))
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(`alta_${ev.mensajeId}`, m.op())
    return `alta_${ev.mensajeId}`
  }

  test('C1 · el comprobante del cliente siguiente (sin citar, 20 min después del pedido) y enseguida su #ALTA: va al alta nueva, separados o en el mismo webhook', async () => {
    for (const mismoWebhook of [false, true]) {
      const m = motorDe()
      const idA = await esperandoComprobante(m)
      m.reloj.t += 20 * 60_000
      m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ ordenante: 'Bruno Díaz', numero_operacion: 'OP-B' }), tokens: {} })
      const adj = ya(m, evAdjunto({ medios: [medio('comprobante-de-bruno')] }))
      const b = ya(m, evAlta(TEXTO_B, { medios: [] }), 1000)
      if (mismoWebhook) await m.correr([adj, b])
      else { await m.correr([adj]); m.reloj.t += 30_000; await m.correr([ya(m, b)]) }
      assert.deepEqual((await m.almacen.leerAlta(idA)).medios, [], `Ana no se queda con el de Bruno (mismo webhook: ${mismoWebhook})`)
      assert.deepEqual((await m.almacen.leerAlta(`alta_${b.mensajeId}`)).medios.map((x) => x.id), ['comprobante-de-bruno'])
      assert.deepEqual(m.dj.llamadas.finanzas.map((f) => f.fila.celdas.C), ['Bruno Díaz'])
    }
  })

  test('C1/t04 · un comprobante sin citar que pagó otra persona se pregunta (ya no sale "coincide") y Finanzas no carga', async () => {
    const m = motorDe()
    const z = ya(m, evAlta(TEXTO_Z, { medios: [] }))
    const idZ = `alta_${z.mensajeId}`
    await m.correr([z])
    m.reloj.t += 120_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ ordenante: 'Ana Pérez' }), tokens: {} })
    await m.correr([ya(m, evAdjunto({ medios: [medio('comprobante-de-ana')] }))])
    const Z = await m.almacen.leerAlta(idZ)
    assert.deepEqual(Z.medios.map((x) => [x.id, x.sinCitar]), [['comprobante-de-ana', true]])
    assert.equal(Z.validacion.comparacion.resultado, 'difiere')
    assert.match(Z.esperas.find((e) => e.motivo === 'validar' && e.estado === 'abierta').pedido.join(), /llegó sin citar el #ALTA y lo pagó "Ana Pérez", que no es Zoe Ruiz/)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    // Parte pura: citado no se compara; sin citar, un apellido en común (o un socio) alcanza
    const a = parsearAlta(TEXTO.replace('Socios: ninguno', 'Socios: Beatriz Gómez · +54 9 11 3000-4444 · bea@ejemplo.com'))
    const cmp = (ordenante, sinCitar) => C.compararComprobante(lecturaOk({ ordenante }), a, { hoy: '2026-10-26', sinCitar, nombres: [a.nombre, 'Beatriz Gómez'] }).resultado
    assert.equal(cmp('Bruno Díaz', false), 'coincide')
    assert.equal(cmp('Bruno Díaz', true), 'difiere')
    assert.equal(cmp('PEREZ ANA MARIA', true), 'coincide')
    assert.equal(cmp('Estudio Jurídico Pérez & Asoc.', true), 'coincide')
    assert.equal(cmp('GOMEZ BEATRIZ', true), 'coincide')
    assert.equal(cmp('', true), 'coincide')
    assert.equal(C.nombresCompatibles('Ana Pérez', 'Beto Gómez'), false)
    assert.equal(C.nombresCompatibles('Ana Peres', 'Ana Pérez'), true)
  })

  test('C2 · con dos altas esperando, el comprobante sin citar se descarta enseguida (pide citar) y el barrido no se lo da después a la que queda', async () => {
    const m = motorDe()
    const idA = await esperandoComprobante(m)
    const idB = await esperandoComprobante(m, TEXTO_B)
    m.reloj.t += 16 * 60_000   // fuera de los 15 minutos en que el alta más nueva sin comprobante lo toma sola
    const suelto = ya(m, evAdjunto({ medios: [medio('img-ana-1')] }))
    await m.correr([suelto])
    assert.ok(enVentas(m).some((x) => /más de un alta esperando el comprobante/.test(x.texto)))
    assert.equal(m.almacen.volcado().entrantes.find((e) => e.evento.clave === suelto.clave).estado, 'ignorado')
    // El closer lo reenvía citando el #ALTA de Ana; 11 minutos después llega cualquier webhook (barrido)
    m.reloj.t += 60_000
    await m.correr([ya(m, evAdjunto({ medios: [medio('img-ana-2')], citado: { id: idA.replace('alta_', ''), autor: null } }))])
    m.reloj.t += 11 * 60_000
    await m.motor.procesar([], m.op())
    assert.deepEqual((await m.almacen.leerAlta(idA)).medios.map((x) => x.id), ['img-ana-2'])
    assert.deepEqual((await m.almacen.leerAlta(idB)).medios, [])
  })

  test('C1 · con una sola esperando: el adjunto suelto espera 15 min; si el closer manda otro #ALTA en el medio, no va a la vieja', async () => {
    const m = motorDe()
    const idA = await esperandoComprobante(m)
    m.reloj.t += 20 * 60_000
    await m.correr([ya(m, evAdjunto({ medios: [medio('suelto')] }))])
    assert.deepEqual((await m.almacen.leerAlta(idA)).medios, [])
    assert.ok(!enVentas(m).some((x) => /citando/.test(x.texto) && /más de un alta/.test(x.texto)))
    // 20 minutos después (fuera de la ventana de reclamarAdjuntos) llega el #ALTA de otro cliente, completo y con su imagen
    m.reloj.t += 20 * 60_000
    await m.correr([ya(m, evAlta(TEXTO_B, { medios: [medio('de-bruno')] }))])
    await m.motor.procesar([], m.op())
    assert.deepEqual((await m.almacen.leerAlta(idA)).medios, [], 'Ana ya no es la última alta del closer: se pide citar')
    assert.ok(enVentas(m).some((x) => /esperando el comprobante: mandalo citando/.test(x.texto)))
  })

  test('A1 · el eco llega y se procesa ANTES del error dudoso: el aviso de Skool sale una vez y la bienvenida sigue sin preguntarle a Aylu', async () => {
    function whapiConEco(patron, quien) {
      const w = whapiJuguete()
      let hecho = false
      for (const metodo of ['enviarTexto', 'enviarVideo']) {
        const orig = w[metodo]
        w[metodo] = async (p) => {
          const texto = metodo === 'enviarVideo' ? (p.pie ?? '') : p.texto
          if (hecho || !patron.test(texto)) return orig(p)
          hecho = true
          const r = await orig(p)
          const grupo = p.chatId === GRUPOS.verificaciones ? 'verificaciones' : p.chatId === GRUPOS.ventas ? 'ventas' : null
          await quien.m.correr([{ ...evEco(texto, r.id, { chatId: p.chatId, autor: { telefono: '5490000000000', lid: null, nombre: null } }), grupo, enviadoEn: iso(quien.m.reloj.t), recibidoEn: iso(quien.m.reloj.t) }])
          throw w.err('dudoso')
        }
      }
      return w
    }
    { // (a) aviso de Skool
      const quien = {}
      const w = whapiConEco(/ya pagó/, quien)
      const m = motorDe({ whapi: w }); quien.m = m
      const ev = evAlta()
      const id = `alta_${ev.mensajeId}`
      await m.correr([ev])
      assert.equal(m.almacen.volcado().salientes.find((s) => s.proposito === 'skool:aviso').estado, 'enviado')
      assert.equal((await pasosDe(m, id)).skool.estado, 'hecho')
      m.reloj.t += 61_000
      await m.motor.avanzar(id, m.op())
      assert.equal(w.enviados.filter((x) => /ya pagó/.test(x.texto ?? '')).length, 1)
    }
    { // (b) bienvenida (video con pie)
      const quien = {}
      const w = whapiConEco(/Cómo va\?/, quien)
      const m = motorDe({ whapi: w }); quien.m = m
      const ev = evAlta()
      const id = `alta_${ev.mensajeId}`
      await m.correr([ev])
      await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: aylu })])
      assert.equal((await pasosDe(m, id)).bienvenida.estado, 'hecho')
      assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
      assert.ok(!m.whapi.enviados.some((x) => /no sé si llegó la bienvenida/i.test(x.texto ?? '')))
    }
    // El NO de una persona sí baja un 'enviado' (forzar), para reenviar
    const alm = A.almacenEnMemoria({ ahora: () => T0 })
    await alm.anotarSaliente({ altaId: 'a', proposito: 'p', chatId: 'c', huella: 'h' })
    await alm.confirmarSaliente({ altaId: 'a', proposito: 'p', whapiId: 'w1', estado: 'enviado' })
    assert.deepEqual(await alm.confirmarSaliente({ altaId: 'a', proposito: 'p', whapiId: null, estado: 'dudoso' }), { estado: 'enviado', whapiId: 'w1' })
    assert.deepEqual(await alm.confirmarSaliente({ altaId: 'a', proposito: 'p', whapiId: null, estado: 'fallido', forzar: true }), { estado: 'fallido', whapiId: 'w1' })
  })

  test('B1/B2 · la copia "(repetido)" empareja con su eco (no sale otra) y la respuesta que la cita se toma; una cita desconocida con datos, también', async () => {
    const w = whapiJuguete()
    const orig = w.enviarTexto
    let intento = 0
    const ecos = []
    w.enviarTexto = async (p) => {
      if (!/Para dar de alta/.test(p.texto)) return orig(p)
      intento++
      if (intento === 1) { w.llamadas.push({ m: 'enviarTexto', p }); throw w.err('dudoso') }
      const r = await orig(p); ecos.push({ id: r.id, texto: p.texto }); throw w.err('dudoso')
    }
    const m = motorDe({ whapi: w })
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])                                   // intento 1: dudoso, no salió
    m.reloj.t += 301_000
    await m.motor.procesar([], m.op())                     // intento 2: "(repetido)", salió, dudoso
    assert.equal(ecos.length, 1); assert.ok(ecos[0].texto.endsWith('\n(repetido)'))
    await m.correr([{ ...evEco(ecos[0].texto, ecos[0].id, { autor: { telefono: '5490000000000', lid: null, nombre: null } }), grupo: 'ventas', enviadoEn: iso(m.reloj.t), recibidoEn: iso(m.reloj.t) }])
    const espera = (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === 'datos')
    assert.deepEqual(espera.mensajes, [ecos[0].id])
    m.reloj.t += 1_801_000
    await m.motor.procesar([], m.op())
    assert.equal(w.enviados.filter((x) => /Para dar de alta/.test(x.texto ?? '')).length, 1, 'no sale otra copia')
    await m.correr([deCloser('DNI: 30111222', { citado: { id: ecos[0].id, autor: null } })])
    assert.equal(parsearAlta((await m.almacen.leerAlta(id)).textoVigente).dni, '30111222')
    // Una cita a un mensaje que el bot no conoce, con datos, en Ventas: se trata como sin cita (va a la única que espera)
    const m2 = motorDe()
    const ev2 = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    await m2.correr([ev2])
    await m2.correr([deCloser('DNI: 30111222', { citado: { id: 'id-que-nadie-conoce', autor: null } })])
    assert.equal(parsearAlta((await m2.almacen.leerAlta(`alta_${ev2.mensajeId}`)).textoVigente).dni, '30111222')
  })

  test('F1 · Fee en tres partes con el del medio esperando un OK: el tercero se encadena al más nuevo y la suma da 560', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '150', numero_operacion: 'OP-1' }), tokens: {} })
    const a1 = evAlta(conPago(150), { medios: [medio('p1')] })
    await m.correr([a1])
    await aprobarFee(m, `alta_${a1.mensajeId}`)
    assert.equal((await m.almacen.leerAlta(`alta_${a1.mensajeId}`)).estado, 'fee')
    m.reloj.t += 86_400_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '160', numero_operacion: 'OP-2', destinatario: 'Fulano' }), tokens: {} })
    const a2 = evAlta(conPago(160), { medios: [medio('p2')] })
    await m.correr([a2])
    const id2 = `alta_${a2.mensajeId}`
    assert.equal((await m.almacen.leerAlta(id2)).validacion.estadoPlan, 'fee')
    assert.equal((await m.almacen.leerAlta(id2)).estado, 'esperando_humano')
    m.reloj.t += 86_400_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-3' }), tokens: {} })
    const a3 = evAlta(conPago(250), { medios: [medio('p3')] })
    await m.correr([a3])
    const x3 = await m.almacen.leerAlta(`alta_${a3.mensajeId}`)
    assert.equal(x3.altaAnterior, id2)
    assert.equal(x3.validacion.usdAcumulado, 560)
    // OK a la suma (el tercero arranca) y OK Tomi al segundo: la cadena se cierra entera
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, x3.id, 'fee_suma'), autor: null } })])
    await m.correr([evResp('OK Tomi', { citado: { id: await pedidoDe(m, id2, 'validar'), autor: null } })])
    await aprobarFee(m, id2)
    const estados = await Promise.all([a1, a2].map(async (e) => (await m.almacen.leerAlta(`alta_${e.mensajeId}`)).estado))
    assert.deepEqual(estados, ['reemplazada', 'reemplazada'])
  })

  test('F2 · Fee que espera un OK y el mismo texto con otro comprobante: es el pago siguiente (no "Ya lo tengo")', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-1', destinatario: 'Fulano' }), tokens: {} })
    const a1 = evAlta(conPago(250), { medios: [medio('pago-1')] })
    await m.correr([a1])
    assert.equal((await m.almacen.leerAlta(`alta_${a1.mensajeId}`)).estado, 'esperando_humano')
    m.reloj.t += 2 * 86_400_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-2' }), tokens: {} })
    const a2 = evAlta(conPago(250), { medios: [medio('pago-2')] })
    await m.correr([a2])
    const x2 = await m.almacen.leerAlta(`alta_${a2.mensajeId}`)
    assert.notEqual(x2.estado, 'duplicada')
    assert.equal(x2.altaAnterior, `alta_${a1.mensajeId}`)
    assert.equal(m.dj.llamadas.vision.length, 2)
    assert.ok(!m.whapi.enviados.some((x) => /Ya lo tengo/.test(x.texto)))
    // Sin comprobante nuevo, el mismo texto sigue siendo un reenvío
    const a3 = evAlta(conPago(250), { medios: [] })
    await m.correr([a3])
    assert.equal((await m.almacen.leerAlta(`alta_${a3.mensajeId}`)).estado, 'duplicada')
  })

  test('D1 · correo de un socio contestado como "Mail:", "Correo de X:" o "X:": va al socio (nunca pisa el del cliente); con dos socios sin correo, se pregunta', async () => {
    const SOCIA = TEXTO.replace('Socios: ninguno', 'Socios: Beatriz Gómez +54 9 11 3000-4444')
    for (const resp of ['Mail: bea@ejemplo.com', 'Correo de Beatriz: bea@ejemplo.com', 'Beatriz Gómez: bea@ejemplo.com', 'E-mail de la socia Beatriz Gómez: bea@ejemplo.com']) {
      const ad = F.adaptarRespuestaSocios(SOCIA, resp)
      const a = parsearAlta(F.fusionarRespuesta(SOCIA, ad.texto).texto)
      assert.equal(a.correo, 'ana@ejemplo.com', resp)
      assert.deepEqual(a.faltantes, [], resp)
      assert.equal(a.socios, 'Beatriz Gómez · +5491130004444 · bea@ejemplo.com', resp)
    }
    // El mismo correo del cliente, o sin socios que lo necesiten: queda como está
    assert.equal(F.adaptarRespuestaSocios(SOCIA, 'Correo: ana@ejemplo.com').texto, 'Correo: ana@ejemplo.com')
    assert.equal(F.adaptarRespuestaSocios(TEXTO, 'Correo: otra@ejemplo.com').texto, 'Correo: otra@ejemplo.com')
    assert.equal(F.adaptarRespuestaSocios(SOCIA, 'Correo de Ana Pérez: ana2@ejemplo.com').texto, 'Correo: ana2@ejemplo.com')
    const DOS = TEXTO.replace('Socios: ninguno', 'Socios:\nBeatriz Gómez +54 9 11 3000-4444\nCarla Paz +54 9 11 3000-5555')
    assert.equal(F.adaptarRespuestaSocios(DOS, 'Mail: x@ejemplo.com').ambiguo, true)
    // Por el motor: el pedido citado con "Mail:" completa a la socia y no toca el correo del cliente
    const m = motorDe()
    const ev = evAlta(SOCIA)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = enVentas(m)[0]
    await m.correr([deCloser('Mail: bea@ejemplo.com', { citado: { id: pedido.id, autor: null } })])
    const a = parsearAlta((await m.almacen.leerAlta(id)).textoVigente)
    assert.equal(a.correo, 'ana@ejemplo.com'); assert.deepEqual(a.faltantes, [])
    assert.deepEqual(m.dj.llamadas.crm.map((c) => c.a.correo), ['ana@ejemplo.com'])
    // Dos socios sin correo: se pregunta de quién es; una respuesta sin datos citando el pedido: se le explica el formato
    const m2 = motorDe()
    const e2 = evAlta(DOS)
    await m2.correr([e2])
    const p2 = enVentas(m2)[0]
    await m2.correr([deCloser('Mail: x@ejemplo.com', { citado: { id: p2.id, autor: null } })])
    assert.ok(enVentas(m2).some((x) => /no sé de quién es ese/.test(x.texto)))
    assert.equal(parsearAlta((await m2.almacen.leerAlta(`alta_${e2.mensajeId}`)).textoVigente).correo, 'ana@ejemplo.com')
    await m2.correr([deCloser('dale, ya te lo paso', { citado: { id: p2.id, autor: null } })])
    assert.ok(enVentas(m2).some((x) => /No encontré ningún dato en tu respuesta/.test(x.texto)))
  })

  test('E1 · un dato sin citar no va a un alta vieja si el closer mandó otro #ALTA después: se pide citar', async () => {
    const m = motorDe()
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    const idA = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 4 * 86_400_000
    const b = ya(m, evAlta(TEXTO_B))
    await m.correr([b])
    await m.correr([deCloser('DNI: 30999888')])
    assert.equal(parsearAlta((await m.almacen.leerAlta(idA)).textoVigente).dni, null)
    assert.ok(enVentas(m).some((x) => /mandaste otro #ALTA después del pedido/.test(x.texto)))
  })

  test('MEP · pesos con el USD del closer al lado: se busca el MEP, Finanzas carga E con él y el Fee se decide con ese USD', async () => {
    const enPesos = (ars, usd) => TEXTO.replace('Este pago: 1100 USD · Transferencia USD (Galicia)', `Este pago: $${ars} ARS (${usd} USD) · Transferencia`)
    const m = motorDe({ mep: () => ({ venta: 1500, diaAnterior: '2026-10-25', fechaCotizacion: '2026-10-24' }) })
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '1.650.000', moneda: 'ARS' }), tokens: {} })
    const ev = evAlta(enPesos('1.650.000', 1100))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal(m.dj.llamadas.mep.length, 1)
    const f = m.dj.llamadas.finanzas[0].fila
    assert.equal(f.celdas.E, 1100); assert.equal(f.celdas.F, 1650000)
    assert.deepEqual(f.pendientes, [])
    assert.equal(m.dj.llamadas.crm[0].extras.estePagoUsdMep, 1100)
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
    // $700.000 con "500 USD" del closer: con el MEP son 466,67 → Fee (el alta no arranca)
    const m2 = motorDe({ mep: () => ({ venta: 1500, diaAnterior: '2026-10-25', fechaCotizacion: '2026-10-24' }) })
    m2.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '700.000', moneda: 'ARS' }), tokens: {} })
    const e2 = evAlta(enPesos('700.000', 500))
    await m2.correr([e2])
    await aprobarFee(m2, `alta_${e2.mensajeId}`)
    assert.equal((await m2.almacen.leerAlta(`alta_${e2.mensajeId}`)).validacion.estadoPlan, 'fee')
    assert.equal(m2.dj.llamadas.crm.length, 0)
    assert.equal(m2.dj.llamadas.finanzas[0].fila.celdas.J, 'Fee')
  })

  test('MEP · se pide con la fecha del comprobante (no la de llegada) y se vuelve a pedir si esa fecha cambia; sin poder leer, se espera', async () => {
    const mep = (f) => ({ venta: f === '2026-10-22' ? 1400 : 1500, diaAnterior: { '2026-10-22': '2026-10-21', '2026-10-26': '2026-10-25' }[f] ?? '2026-10-25', fechaCotizacion: f === '2026-10-22' ? '2026-10-21' : '2026-10-24' })
    const m = motorDe({ mep })
    const texto = TEXTO.replace('Este pago: 1100 USD · Transferencia USD (Galicia)', 'Este pago: $1.650.000 ARS · Transferencia')
    const ev = ya(m, evAlta(texto, { medios: [] }))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(id, m.op())
    assert.equal(m.dj.llamadas.mep.length, 0, 'sin comprobante no se pide el MEP de la fecha de llegada')
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '1.650.000', moneda: 'ARS', fecha: '2026-10-22' }), tokens: {} })
    await m.correr([ya(m, evAdjunto({ medios: [medio('comp')], citado: { id: ev.mensajeId, autor: null } }))])
    assert.deepEqual(m.dj.llamadas.mep, ['2026-10-22'])
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.E, 1178.57)
    // Un MEP guardado de otro día se descarta y se vuelve a pedir
    const v = (await m.almacen.leerAlta(id)).validacion
    assert.deepEqual(v.mep, { venta: 1400, fechaCotizacion: '2026-10-21', diaAnterior: '2026-10-21' })
  })

  test('t10 · Claude no responde: no se pregunta la cuenta (el comprobante puede decirla) y la lectura se reintenta; una cuenta dada distinta del destinatario queda avisada', async () => {
    const m = motorDe()
    m.dj.colas.vision.push(new ErrorTransitorio('529'), new ErrorTransitorio('529'))
    const ev = evAlta(TEXTO.replace('Transferencia USD (Galicia)', 'Transferencia'))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const p = (await pasosDe(m, id)).validar
    assert.equal(p.estado, 'reintento'); assert.ok(p.noAntesDe)
    assert.ok(!(await m.almacen.leerAlta(id)).esperas.some((e) => e.estado === 'abierta' && e.grupo === 'verificaciones'))
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ destinatario: 'Actis Gerónimo' }), tokens: {} })
    m.reloj.t = Date.parse(p.noAntesDe) + 1
    await m.motor.procesar([], m.op())
    assert.equal(m.dj.llamadas.finanzas[0].fila.celdas.R, 'Gero')
    // Una caída larga de Claude no queda en silencio: a la tercera lectura fallida, un aviso (una sola vez)
    const m2 = motorDe()
    for (let i = 0; i < 8; i++) m2.dj.colas.vision.push(new ErrorTransitorio('529'))
    const e2 = evAlta()
    const id2 = `alta_${e2.mensajeId}`
    await m2.correr([e2])
    for (let i = 0; i < 3; i++) { m2.reloj.t = Date.parse((await pasosDe(m2, id2)).validar.noAntesDe) + 1; await m2.motor.procesar([], m2.op()) }
    const avisosLectura = m2.whapi.enviados.filter((x) => /No pude leer el comprobante de Ana Pérez/.test(x.texto ?? ''))
    assert.equal(avisosLectura.length, 1)
    assert.equal((await m2.almacen.leerAlta(id2)).validacion.fallasLectura, 4)
    // Parte pura: la cuenta dada (OK Tomi) contra un destinatario de Gero → aviso
    const { filaRegistroPagos } = await import('../lib/bot/alta/finanzas.ts')
    const fila = filaRegistroPagos(parsearAlta(TEXTO), { fecha: '2026-10-26', cuenta: 'Tomi', destinatario: 'Actis Gerónimo', setter: 'Mai', fuente: 'Inbound IG' })
    assert.ok(fila.avisos.some((x) => /no coincide con el destinatario del comprobante \(Gero\)/.test(x)))
  })

  test('t06/t09 · un #ALTA con el teléfono de un alta abierta de OTRO nombre: alta nueva (no corrección ni pago del Fee) y se pregunta por el teléfono', async () => {
    const BETO = TEXTO.replace('Ana Pérez', 'Beto Gómez').replace('ana@ejemplo.com', 'beto@ejemplo.com').replace('30111222', '30555666').replace('27-30111222-4', '20-30555666-7')
    const m = motorDe()
    const idA = await esperandoComprobante(m)
    const b = ya(m, evAlta(BETO))
    await m.correr([b])
    const A_ = await m.almacen.leerAlta(idA)
    assert.equal(A_.nombreCliente, 'Ana Pérez'); assert.deepEqual(A_.medios, [])
    const B_ = await m.almacen.leerAlta(`alta_${b.mensajeId}`)
    assert.ok(B_); assert.equal(B_.altaAnterior, null)
    assert.match(B_.esperas.find((e) => e.motivo === 'validar' && e.estado === 'abierta').pedido.join(), /mismo del alta abierta de Ana Pérez/)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    // Con un OK sigue (y no se vuelve a preguntar)
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, B_.id, 'validar'), autor: null } })])
    assert.equal(m.dj.llamadas.finanzas.length, 1)
    // El Fee de Ana no se cierra con el pago de otro cliente que trae su teléfono
    const m2 = motorDe()
    m2.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '200' }), tokens: {} })
    const fee = evAlta(conPago(200))
    await m2.correr([fee])
    await aprobarFee(m2, `alta_${fee.mensajeId}`)
    assert.equal((await m2.almacen.leerAlta(`alta_${fee.mensajeId}`)).estado, 'fee')
    m2.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ ordenante: 'Beto Gómez' }), tokens: {} })
    const b2 = evAlta(BETO)
    await m2.correr([b2])
    assert.equal((await m2.almacen.leerAlta(`alta_${fee.mensajeId}`)).estado, 'fee')
    assert.equal((await m2.almacen.leerAlta(`alta_${b2.mensajeId}`)).altaAnterior, null)
  })

  test('t07 · #ALTA corregido que trae el comprobante como pie: valida con ese comprobante en la misma vuelta (no lo vuelve a pedir)', async () => {
    const m = motorDe()
    const ev = ya(m, evAlta(TEXTO.replace('DNI: 30111222\n', ''), { medios: [] }))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t += 181_000
    await m.motor.avanzar(id, m.op())
    assert.match(enVentas(m).at(-1).texto, /Comprobante del pago/)
    await m.correr([ya(m, evAlta(TEXTO, { medios: [medio('comprobante-ana')], citado: { id: ev.mensajeId, autor: null } }))])
    assert.deepEqual((await m.almacen.leerAlta(id)).medios.map((x) => x.id), ['comprobante-ana'])
    assert.equal(m.dj.llamadas.vision.length, 1)
    assert.equal((await pasosDe(m, id)).finanzas.estado, 'hecho')
    assert.ok(!enVentas(m).slice(1).some((x) => /Comprobante del pago/.test(x.texto)))
  })

  test('t08 · el CRM chocó con otra carga sin escribir nada: reintento con lectura nueva (no a revisar); al cuarto, revisar', () => {
    const motivo = 'La fila 171 de Agencia ya tiene datos (A, B, C, D): alguien cargó algo en el medio; no se escribe. No se escribió nada.'
    const alta = { id: 'alta_x', validacion: null, nombreCliente: 'Beto Gómez' }
    const r = crmOk({ ok: false, etapa: 'control', escribio: false, id: 'C-201', motivo })
    const s = P.interpretarCrm(r, { huboCorriendo: false, nombre: 'Beto Gómez', alta, ahora: T0, intentos: 0 })
    assert.equal(s.estado, 'reintento'); assert.ok(Date.parse(s.noAntesDe) - T0 >= 90_000)
    assert.equal(P.interpretarCrm(r, { huboCorriendo: false, nombre: 'Beto Gómez', alta, ahora: T0, intentos: 3 }).estado, 'revisar')
    // Si escribió algo, sigue yendo a revisar
    assert.equal(P.interpretarCrm(crmOk({ ok: false, etapa: 'escritura', escribio: true, motivo }), { huboCorriendo: false, nombre: 'Beto', alta, ahora: T0, intentos: 0 }).estado, 'revisar')
  })

  test('t05 · la segunda seña de una cadena va como "<Nombre> - Fee 2" y el primer intento pide un archivo nuevo; los reintentos, el mismo nombre', async () => {
    const m = motorDe()
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '200', numero_operacion: 'OP-1' }), tokens: {} })
    const s1 = evAlta(conPago(200), { medios: [medio('sena-1')] })
    await m.correr([s1])
    await aprobarFee(m, `alta_${s1.mensajeId}`)
    m.reloj.t += 86_400_000
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '250', numero_operacion: 'OP-2', fecha: '2026-10-27' }), tokens: {} })
    m.dj.colas.finanzas.push(finOk({ ok: false, etapa: 'insercion', escribio: false, motivo: 'se cortó', comprobanteId: 'id-x', nombreArchivo: 'Ana Pérez - Fee 2 (2).jpeg', noReintentarAntesDe: iso(m.reloj.t + 1000) }))
    const e2 = evAlta(conPago(250).replace('Socios: ninguno', 'Socios: ninguno.'), { medios: [medio('sena-2')] })
    await m.correr([e2])
    await aprobarFee(m, `alta_${e2.mensajeId}`)
    const [l1, l2] = m.dj.llamadas.finanzas
    assert.equal(l1.fila.celdas.I, 'Ana Pérez - Fee'); assert.equal(l1.op.archivoNuevo, true)
    assert.equal(l2.fila.celdas.I, 'Ana Pérez - Fee 2'); assert.equal(l2.fila.fila[8], 'Ana Pérez - Fee 2'); assert.equal(l2.op.archivoNuevo, true)
    m.reloj.t += 600_000
    await m.motor.procesar([], m.op())
    const l3 = m.dj.llamadas.finanzas[2]
    assert.equal(l3.op.archivoNuevo, false); assert.equal(l3.op.nombreArchivo, 'Ana Pérez - Fee 2 (2).jpeg')
  })

  test('op01/op02/op07 · un alta que ninguna invocación terminó la retoma el barrido (nace con hora y el candado deja un lease)', async () => {
    // (op07) Sin tiempo en la invocación: la segunda alta queda para el barrido, y el barrido la ve
    const m = motorDe()
    const e1 = evAlta(), e2 = evAlta(TEXTO_B)
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk(), tokens: {} }, { modelo: 'x', salida: lecturaOk({ ordenante: 'Bruno Díaz', numero_operacion: 'OP-2' }), tokens: {} })
    const r = await m.motor.registrar([e1, e2])
    await m.motor.procesar(r.nuevos, { hasta: m.reloj.t + 19_000, invocacion: 'corta' })
    const id2 = `alta_${e2.mensajeId}`
    assert.ok((await m.almacen.leerAlta(id2)).proximoIntento, 'nace con proximo_intento')
    m.reloj.t += 60_000
    const b = await m.motor.procesar([], m.op())
    assert.ok(b.altas.includes(id2))
    assert.equal((await pasosDe(m, id2)).finanzas.estado, 'hecho')
    // (op01/op02) La invocación muere a la mitad (Neon se cae y no se puede guardar nada): cuando vence el candado, el lease
    const reloj = { t: T0 }
    const mem = A.almacenEnMemoria({ ahora: () => reloj.t })
    let caida = false
    const almacen = new Proxy(mem, { get(o, k) { const v = o[k]; return typeof v !== 'function' ? v : (...a) => (caida ? Promise.reject(new Error('la base no respondió')) : v.apply(o, a)) } })
    const m3 = motorDe({ almacen, t: T0 })
    m3.reloj.t = T0
    m3.dj.colas.finanzas.push(() => { caida = true; return finOk() })
    const e3 = evAlta()
    const id3 = `alta_${e3.mensajeId}`
    await m3.correr([e3])
    caida = false
    const x = await mem.leerAlta(id3)
    assert.ok(x.proximoIntento && Date.parse(x.proximoIntento) <= T0 + 285_000 + 45_000 + A.MARGEN_LEASE_MS)
    // Pasada la cola dudosa de Finanzas (11 min desde que empezó), el barrido la retoma y repite Finanzas como dudoso
    reloj.t = m3.reloj.t = T0 + 12 * 60_000
    const b3 = await m3.motor.procesar([], m3.op())
    assert.ok(b3.altas.includes(id3), 'el barrido la retoma')
    assert.notEqual((await pasosDe({ almacen: mem }, id3)).finanzas.estado, 'corriendo')
  })

  test('op06 · Neon falla una vez al confirmar un envío que salió: queda "enviado" (sin "fallido" ni un segundo mensaje)', async () => {
    const reloj = { t: T0 }
    const mem = A.almacenEnMemoria({ ahora: () => reloj.t })
    let fallas = 1
    const almacen = new Proxy(mem, { get(o, k) { const v = o[k]; if (typeof v !== 'function') return v; return (...a) => (k === 'confirmarSaliente' && fallas-- > 0 ? Promise.reject(new Error('la base no respondió en 10 s')) : v.apply(o, a)) } })
    const m = motorDe({ almacen })
    const ev = evAlta(TEXTO.replace('DNI: 30111222\n', ''))
    await m.correr([ev])
    m.reloj.t += 301_000; reloj.t = m.reloj.t
    await m.motor.procesar([], m.op())
    assert.equal(enVentas(m).filter((x) => /Para dar de alta/.test(x.texto)).length, 1)
    assert.equal(mem.volcado().salientes.find((s) => s.proposito.startsWith('espera:validar')).estado, 'enviado')
  })

  test('op03 · el barrido purga como mucho una vez por día y el recurso "crm" se toma por 300 s', async () => {
    const m = motorDe()
    let purgas = 0
    const orig = m.almacen.purgar
    m.almacen.purgar = async (t) => { purgas++; return orig(t) }
    await m.motor.procesar([], m.op())
    m.reloj.t += 3600_000
    await m.motor.procesar([], m.op())
    assert.equal(purgas, 1)
    m.reloj.t += 86_400_000
    await m.motor.procesar([], m.op())
    assert.equal(purgas, 2)
    const fuente = readFileSync(new URL('../lib/bot/alta/motor/orquestador.ts', import.meta.url), 'utf8')
    assert.match(fuente, /const TTL_RECURSO_CRM_MS = 300_000/)
  })

  test('Neon (cliente SQL falso): alta con proximo_intento, lease en reclamar, huella de la copia y confirmación que no pisa al eco', async () => {
    process.env.DATABASE_URL = 'postgres://usuario:clave@base.inventada/db'
    try {
      const consultas = []
      const q = (strings, ...vals) => {
        const t = strings.join('$').replace(/\s+/g, ' ')
        consultas.push({ t, vals })
        const cols = Object.entries(N.COLUMNAS_AGREGABLES).flatMap(([tb, cs]) => cs.map(([c]) => ({ table_name: tb, column_name: c })))
        return (async () => (/information_schema/.test(t) ? cols : /RETURNING estado, whapi_id/.test(t) ? [{ estado: 'enviado', whapi_id: 'w1' }] : []))()
      }
      q.unsafe = (raw) => ({ raw })
      N.sqlParaPruebas(() => q)
      const neon = N.almacenNeon()
      await neon.crearAlta({ id: 'alta_n', modo: 'real', capacidades: [], entorno: 'test', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: null }, mensajeAltaId: 'n', textoOriginal: 'x', huella: 'h', telefonoCliente: null, nombreCliente: null, medios: [], altaAnterior: null }).catch(() => null)
      assert.ok(consultas.some((c) => /INSERT INTO cj_altas \(.*proximo_intento\).*CASE WHEN \$::boolean THEN NULL ELSE now\(\) END\)/.test(c.t)))
      await neon.reclamar('alta_n', 'inv', T0)
      assert.ok(consultas.some((c) => /proximo_intento = CASE WHEN estado = ANY\(\$\) THEN proximo_intento ELSE LEAST\(COALESCE\(proximo_intento, \$::timestamptz\), \$::timestamptz\) END/.test(c.t)))
      assert.ok(consultas.find((c) => /UPDATE cj_altas SET candado_dueno/.test(c.t)).vals.includes(iso(T0 + A.MARGEN_LEASE_MS)))
      await neon.anotarSaliente({ altaId: 'a', proposito: 'p', chatId: 'c', huella: 'h1', huellaSiRepite: 'h2' })
      assert.ok(consultas.some((c) => /SET huella = \$ WHERE clave = \$ AND estado IN \('enviando', 'dudoso'\)/.test(c.t) && c.vals.includes('h2')))
      const r = await neon.confirmarSaliente({ altaId: 'a', proposito: 'p', whapiId: null, estado: 'dudoso' })
      assert.deepEqual(r, { estado: 'enviado', whapiId: 'w1' })
      assert.ok(consultas.some((c) => /estado = CASE WHEN \$::boolean AND estado = 'enviado' THEN estado ELSE \$ END/.test(c.t)))
      // jsonb con un surrogate suelto: se escribe U+FFFD (Postgres rechazaría el JSON)
      assert.equal(N.jsonSeguro({ t: 'a\ud83d' }), '{"t":"a�"}')
      assert.equal(N.jsonSeguro({ t: 'ok 😀' }), '{"t":"ok 😀"}')
    } finally { delete process.env.DATABASE_URL; N.sqlParaPruebas(null) }
  })
})

describe('revisión de la integración, ronda 3', () => {
  const otro = (nombre, tel, mail, dni, cuit) => TEXTO.replace('Ana Pérez', nombre).replace('+54 9 11 3000-1111', tel).replace('ana@ejemplo.com', mail).replace('30111222', dni).replace('27-30111222-4', cuit)
  const SIN_DNI = TEXTO.replace('DNI: 30111222\n', '')
  const BETO = otro('Beto Gómez', '+54 9 11 4000-2222', 'beto@ejemplo.com', '28999111', '20-28999111-3')
  const deCloser = (texto, over = {}) => evResp(texto, { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, veredicto: null, ...over })
  const a = (m, chat) => m.whapi.enviados.filter((x) => x.chatId === chat).map((x) => x.texto)

  test('mismaPersona: todas las palabras del nombre más corto en el otro (una letra de tolerancia en las largas); el nombre de pila solo no alcanza', () => {
    assert.equal(C.mismaPersona('Ana Pérez', 'Ana Gómez'), false)
    assert.equal(C.mismaPersona('María López', 'María Gallardo'), false)
    assert.equal(C.mismaPersona('Ana Pérez', 'Beto Gómez'), false)
    assert.equal(C.mismaPersona('Ana Pérez', 'PEREZ ANA MARIA'), true)
    assert.equal(C.mismaPersona('Ana Pérez', 'Ana María Pérez'), true)
    assert.equal(C.mismaPersona('Ana Peres', 'Ana Pérez'), true)
    assert.equal(C.mismaPersona('Juan Gomes', 'Juan Gómez'), true)
    assert.equal(C.mismaPersona('Ana Pérez', null), true)
    // nombresCompatibles (comprobante) sigue igual de amplio
    assert.equal(C.nombresCompatibles('Ana Pérez', 'Ana Gómez'), true)
  })

  test('t03/t03b · el #ALTA de otro cliente respondido sobre el de un alta abierta: alta nueva (con o sin comprobante) y el alta citada queda intacta', async () => {
    for (const conComprobante of [false, true]) {
      const m = motorDe()
      const evA = evAlta(SIN_DNI, { medios: [medio('comprobante-ana')] })
      await m.correr([evA])
      const idA = `alta_${evA.mensajeId}`
      m.reloj.t += 30 * 60_000
      if (conComprobante) m.dj.colas.vision.push({ modelo: 'm', salida: lecturaOk({ ordenante: 'Beto Gómez', numero_operacion: 'OP-BETO' }), tokens: {} })
      const evB = evAlta(BETO, { medios: conComprobante ? [medio('comprobante-beto')] : [], citado: { id: evA.mensajeId } })
      await m.correr([evB])
      const A_ = await m.almacen.leerAlta(idA), B_ = await m.almacen.leerAlta(`alta_${evB.mensajeId}`)
      assert.ok(B_, 'se crea el alta de Beto')
      assert.equal(A_.nombreCliente, 'Ana Pérez'); assert.equal(A_.telefonoCliente, TEL_ANA)
      assert.deepEqual(A_.medios.map((x) => x.id), ['comprobante-ana'])
      assert.equal(parsearAlta(A_.textoVigente).nombre, 'Ana Pérez')
      assert.ok(!m.dj.llamadas.finanzas.some((l) => l.fila.celdas.C === 'Beto Gómez' && /ana/.test(l.comprobante?.nombre ?? '')), 'el comprobante de Ana no va al alta de Beto')
      assert.ok(!a(m, GRUPOS.ventas).some((t) => /Tomé la corrección/.test(t)))
      assert.ok(a(m, GRUPOS.ventas).some((t) => /alta nueva de Beto Gómez: respondía al alta de Ana Pérez/.test(t)))
      assert.ok(a(m, GRUPOS.verificaciones).some((t) => /respondía al alta abierta de Ana Pérez, pero con otro nombre/.test(t)))
      assert.equal(B_.medios.length, conComprobante ? 1 : 0)
    }
  })

  test('t03 · una corrección citando con el MISMO nombre (otro teléfono, o "Ana María Pérez") sigue siendo corrección', async () => {
    const m = motorDe()
    const evA = evAlta(SIN_DNI, { medios: [medio('comprobante-ana')] })
    await m.correr([evA])
    const idA = `alta_${evA.mensajeId}`
    m.reloj.t += 10 * 60_000
    const evC = evAlta(TEXTO.replace('Ana Pérez', 'Ana María Pérez').replace('+54 9 11 3000-1111', '+54 9 11 3000-2222'), { medios: [], citado: { id: evA.mensajeId } })
    await m.correr([evC])
    assert.equal(await m.almacen.leerAlta(`alta_${evC.mensajeId}`), null)
    const A_ = await m.almacen.leerAlta(idA)
    assert.equal(A_.nombreCliente, 'Ana María Pérez'); assert.equal(A_.telefonoCliente, '5491130002222')
    assert.ok(a(m, GRUPOS.ventas).some((t) => /Tomé la corrección del alta de Ana María Pérez/.test(t)))
  })

  test('t09 · mismo teléfono y mismo nombre de pila (Ana Pérez / Ana Gómez): alta nueva y se pregunta por el teléfono repetido', async () => {
    const m = motorDe()
    const evA = evAlta(SIN_DNI, { medios: [medio('comprobante-ana-perez')] })
    await m.correr([evA])
    const idA = `alta_${evA.mensajeId}`
    m.reloj.t += 40 * 60_000
    m.dj.colas.vision.push({ modelo: 'm', salida: lecturaOk({ ordenante: 'Ana Gómez', numero_operacion: 'OP-AG' }), tokens: {} })
    const evB = evAlta(otro('Ana Gómez', '+54 9 11 3000-1111', 'anagomez@ejemplo.com', '28999111', '27-28999111-3'), { medios: [medio('comprobante-ana-gomez')] })
    await m.correr([evB])
    const A_ = await m.almacen.leerAlta(idA), B_ = await m.almacen.leerAlta(`alta_${evB.mensajeId}`)
    assert.ok(B_)
    assert.equal(A_.nombreCliente, 'Ana Pérez'); assert.deepEqual(A_.medios.map((x) => x.id), ['comprobante-ana-perez'])
    assert.match(B_.esperas.find((e) => e.motivo === 'validar' && e.estado === 'abierta').pedido.join(), /mismo del alta abierta de Ana Pérez/)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
  })

  test('t04 · una corrección del teléfono vuelve a buscar setter y fuente en el CRM de ventas (lo que dijo el closer queda)', async () => {
    const CRM = { '5491130001111': { setter: 'Mai', setterTexto: 'Mai', fuente: 'Inbound IG', hoja: 'Closer 2', fila: 500, coincidencias: 1 },
      '5491140009999': { setter: 'Luli', setterTexto: 'Luli', fuente: 'Outbound', hoja: 'Closer 1', fila: 80, coincidencias: 1 } }
    const consultados = []
    const m = motorDe({ pasos: { setterFuente: async (tel) => { consultados.push(tel); return CRM[tel] ?? null } } })
    const ev = evAlta(SIN_DNI, { medios: [medio('comp-ana')] })
    await m.correr([ev])
    const id = `alta_${ev.mensajeId}`
    m.reloj.t += 10 * 60_000
    await m.correr([deCloser('Teléfono: +54 9 11 4000-9999\nDNI: 30111222', { citado: { id: await pedidoDe(m, id, 'datos'), autor: null } })])
    assert.deepEqual(consultados, ['5491130001111', '5491140009999'])
    const f = m.dj.llamadas.finanzas.at(-1)
    assert.equal(f.fila.celdas.H, 'Luli'); assert.equal(f.fila.celdas.K, 'Outbound')
    // El setter que dio el closer no se pisa con el del CRM aunque cambie el teléfono
    const c2 = []
    const m2 = motorDe({ pasos: { setterFuente: async (tel) => { c2.push(tel); return CRM[tel] ?? null } } })
    const ev2 = evAlta(SIN_DNI, { medios: [medio('comp-ana2')] })
    await m2.correr([ev2])
    const id2 = `alta_${ev2.mensajeId}`
    const v = (await m2.almacen.leerAlta(id2)).validacion
    assert.equal(v.busquedaSetter.telefono, '5491130001111')
    m2.reloj.t += 10 * 60_000
    await m2.correr([deCloser('Setter: Cami\nTeléfono: +54 9 11 4000-9999\nDNI: 30111222', { citado: { id: await pedidoDe(m2, id2, 'datos'), autor: null } })])
    const v2 = (await m2.almacen.leerAlta(id2)).validacion
    assert.notEqual(v2.setter, 'Mai'); assert.equal(v2.fuente, 'Outbound')
  })

  test('el aviso de alta vencida ya no manda a "retomarla desde el Despacho" (no hay pantalla)', async () => {
    const { textoVencida } = await import('../lib/bot/alta/motor/mensajes.ts')
    const t = textoVencida({ pedido: ['DNI'] }, 'Ana Pérez')
    assert.doesNotMatch(t, /o desde el Despacho/)
    assert.match(t, /citándolo \(hasta 30 días\)/)
  })
})

describe('setter del closer y fuente por UTM (Tomás, 25/10/2026)', () => {
  const CON_SF = (setter, fuente) => TEXTO.replace('Closer: Marcos', `Closer: Marcos${setter ? `\nSetter: ${setter}` : ''}${fuente ? `\nFuente: ${fuente}` : ''}`)
  const deCloser = (texto, over = {}) => evResp(texto, { grupo: 'ventas', chatId: GRUPOS.ventas, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, veredicto: null, ...over })
  const abiertaDe = async (m, id, motivo) => (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === motivo && x.estado === 'abierta')
  const crmUtm = (medium, campaign, source, over = {}) => ({ ...SF.elegirFila([{ hoja: 'Closer 2', numeroFila: 700, telefono: TEL_ANA, setter: source, fuente: medium, campania: campaign }], TEL_ANA), ...over })

  test('la prueba en seco del 25/10: "Setter: Maite" y "Fuente: Anuncio" en el #ALTA → no se le pide nada al closer', async () => {
    const m = motorDe({ modo: 'seco', capacidades: new Set() })
    const ev = evAlta(CON_SF('Maite', 'Anuncio'))
    const id = `alta_${ev.mensajeId}`
    const r = await m.correr([ev])
    const todo = r.registro.join('\n')
    assert.doesNotMatch(todo, /pediría al closer/)
    assert.doesNotMatch(todo, /pediría en Verificaciones: .*fuente/i)
    assert.match(todo, /buscaría el setter y los UTM del lead/)
    const v = (await m.almacen.leerAlta(id)).validacion
    assert.equal(v.setter, 'Mai'); assert.equal(v.origenSetterFuente, 'closer')
    assert.equal(v.fuente, 'VSL Funnel'); assert.equal(v.origenFuente, 'closer'); assert.equal(v.fuenteCloser, 'Anuncio')
    assert.match(todo, /haría: Finanzas/)
  })

  test('seco sin "Fuente:": la fuente se pediría en Verificaciones, nunca al closer', async () => {
    const m = motorDe({ modo: 'seco', capacidades: new Set() })
    const ev = evAlta(CON_SF('Mai', null))
    const r = await m.correr([ev])
    const todo = r.registro.join('\n')
    assert.doesNotMatch(todo, /pediría al closer/)
    assert.match(todo, /pediría en Verificaciones: .*No pude identificar la fuente del lead: en seco no se buscan los UTM/)
  })

  test('real: los UTM mandan sobre lo que dijo el closer; el setter del #ALTA manda sobre el del CRM', async () => {
    const m = motorDe({ setterFuente: crmUtm('paid_social', 'VSL+Funnel+-+8/3/26', 'ig') })
    const ev = evAlta(CON_SF('Maite', 'Inbound IG'))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.deepEqual(m.dj.llamadas.setter, [TEL_ANA])
    const f = m.dj.llamadas.finanzas.at(-1).fila
    assert.equal(f.celdas.H, 'Mai'); assert.equal(f.celdas.K, 'VSL Funnel')
    const v = (await m.almacen.leerAlta(id)).validacion
    assert.equal(v.origenFuente, 'utm'); assert.deepEqual(v.utm, { source: 'ig', medium: 'paid_social', campaign: 'VSL+Funnel+-+8/3/26' })
    assert.equal(m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas && /me falta/.test(x.texto)).length, 0)
  })

  test('real: el setter del CRM es "mai" (utm_source) y la fuente sale de inbound → sin #ALTA de setter/fuente no se pregunta nada', async () => {
    const m = motorDe({ setterFuente: crmUtm('inbound', 'ig', 'mai') })
    const ev = evAlta()
    await m.correr([ev])
    const f = m.dj.llamadas.finanzas.at(-1).fila
    assert.equal(f.celdas.H, 'Mai'); assert.equal(f.celdas.K, 'Inbound IG')
  })

  test('real: UTM que no alcanzan → respaldo del closer; sin respaldo → Verificaciones ("OK" solo no alcanza, "OK VSL Funnel" sí)', async () => {
    const m1 = motorDe({ setterFuente: crmUtm('ig', 'wsp', 'ig') })
    await m1.correr([evAlta(CON_SF('Mai', 'BIO'))])
    assert.equal(m1.dj.llamadas.finanzas.at(-1).fila.celdas.K, 'BIO Página Web')

    const m = motorDe({ setterFuente: null })
    const ev = evAlta(CON_SF('Mai', null))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    assert.equal(m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas && /me falta/.test(x.texto)).length, 0)
    const e = await abiertaDe(m, id, 'validar')
    assert.ok(e.requiere.includes('fuente')); assert.ok(e.tipos.includes('ok_fuente'))
    assert.match(e.pedido.join(), /No pude identificar la fuente del lead: el lead no tiene UTM en el CRM de ventas/)
    const ronda = m.whapi.enviados.find((x) => x.chatId === GRUPOS.verificaciones && /fuente/.test(x.texto))
    assert.match(ronda.texto, /"OK VSL Funnel"/)
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null } })])
    assert.ok(m.whapi.enviados.some((x) => /^Falta la fuente/.test(x.texto)))
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    await m.correr([evResp('OK VSL Funnel', { citado: { id: e.mensajes[0], autor: null } })])
    assert.equal(m.dj.llamadas.finanzas.at(-1).fila.celdas.K, 'VSL Funnel')
    assert.equal((await m.almacen.leerAlta(id)).validacion.origenFuente, 'aprobadores')
  })

  test('el "Fuente:" del closer que no está en la lista no se escribe: se pregunta en Verificaciones con lo que dijo', async () => {
    const m = motorDe({ setterFuente: null })
    const ev = evAlta(CON_SF('Mai', 'un amigo de la facu'))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const e = await abiertaDe(m, id, 'validar')
    assert.match(e.pedido.join(), /El closer dijo: "un amigo de la facu"/)
    assert.ok(m.whapi.enviados.some((x) => x.chatId === GRUPOS.verificaciones && /La fuente que dijo el closer \("un amigo de la facu"\) no está en la lista/.test(x.texto)))
  })

  test('un setter que no se traduce (en el #ALTA o en la respuesta) se le sigue preguntando al closer', async () => {
    const m = motorDe({ setterFuente: null })
    const ev = evAlta(CON_SF('Pepe', 'VSL Funnel'))
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const pedido = m.whapi.enviados.find((x) => x.chatId === GRUPOS.ventas && /me falta/.test(x.texto))
    assert.match(pedido.texto, /Setter/); assert.doesNotMatch(pedido.texto, /Fuente/)
    await m.correr([deCloser('Setter: Luli', { citado: { id: await pedidoDe(m, id, 'datos'), autor: null } })])
    assert.equal((await m.almacen.leerAlta(id)).validacion.setter, null)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    await m.correr([deCloser('Setter: Maite', { citado: { id: await pedidoDe(m, id, 'datos'), autor: null } })])
    const f = m.dj.llamadas.finanzas.at(-1).fila
    assert.equal(f.celdas.H, 'Mai'); assert.equal(f.celdas.K, 'VSL Funnel')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Altas en FORMATO LIBRE (sin #ALTA, Tomás 26/10/2026): nada antes del OK de Verificaciones; NO descarta; comprobante aparte
// del mismo autor (30 min); Fee = Finanzas + comunidad con OK; pago siguiente que completa la primera cuota; cliente que
// ya está en el CRM = solo Finanzas. La parte pura está en scripts/test-bot-alta-libre.mjs.
describe('alta en formato libre', () => {
  const NADIA = 'Completa PIF 1299 USD\nNombre: Nadia Blanco\nTel: +595 975 000001\nmail: nadia.blanco@example.test\nCI: 1234567\nDirección: Calle Ficticia 123, Ciudad del Este'
  const YAMILA = '595981000001'
  const deYamila = { telefono: YAMILA, lid: null, nombre: 'Yam Capital Jurídico' }
  const libreDe = (over = {}) => motorDe({ ...over, pasos: { closers: { Yamila: YAMILA }, clienteCrm: async () => null, ...(over.pasos ?? {}) } })
  const evLibre = (texto = NADIA, over = {}) => ({ ...evAlta(texto, { medios: [], autor: deYamila, ...over }), libre: true })
  const pdf = (id, nombre) => medio(id, { tipo: 'document', mime: 'application/pdf', nombreArchivo: nombre })
  const docDeYamila = (id, nombre) => evAdjunto({ autor: deYamila, medios: [pdf(id, nombre)] })
  const aVerif = (m) => m.whapi.enviados.filter((x) => x.chatId === GRUPOS.verificaciones)
  const aVentas = (m) => m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas)
  const citando = async (m, id, motivo, texto = 'OK', autor) => evResp(texto, { citado: { id: await pedidoDe(m, id, motivo), autor: null }, ...(autor ? { autor } : {}) })
  const deCloserLibre = (texto, over = {}) => ({ ...base({ autor: deYamila, ...over }), tipo: 'respuesta', texto, veredicto: null })

  test('antes del OK no hace NADA: solo pregunta en Verificaciones "¿Esto es un alta? Nadia Blanco · closer Yamila · PIF 1299 USD"', async () => {
    const m = libreDe()
    const ev = evLibre()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'esperando_humano')
    assert.match(alta.textoOriginal, /^Closer: Yamila\n/)
    assert.equal(m.dj.llamadas.finanzas.length + m.dj.llamadas.crm.length + m.dj.llamadas.drive.length + m.dj.llamadas.vision.length, 0)
    assert.equal(aVentas(m).length, 0)
    const pregunta = aVerif(m)
    assert.equal(pregunta.length, 1)
    assert.match(pregunta[0].texto, /^¿Esto es un alta\? Nadia Blanco · closer Yamila · PIF 1299 USD\n/)
    assert.match(pregunta[0].texto, /Respondé citando este mensaje: OK \/ NO/)
    assert.deepEqual(await estadosPasos(m, id), { validar: 'espera', finanzas: 'pendiente', crm: 'pendiente', drive: 'pendiente', comunidad: 'pendiente', bienvenida: 'pendiente', skool: 'pendiente', contrato: 'pendiente' })
  })

  test('comprobante aparte: los 2 documentos del mismo autor (12 y 13 min después, sin citar) se asocian; con OK sigue como un #ALTA', async () => {
    const m = libreDe()
    const ev = evLibre()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t = T0 + 12 * 60_000
    await m.correr([docDeYamila('doc-pago', 'comprobante_payment.pdf')])
    m.reloj.t = T0 + 13 * 60_000
    await m.correr([docDeYamila('doc-checkout', 'dLocal Go - Checkout.pdf')])
    assert.deepEqual((await m.almacen.leerAlta(id)).medios.map((x) => x.id), ['doc-pago', 'doc-checkout'])
    assert.equal(aVerif(m).length, 1)   // la pregunta no se repite
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '1.299,00', ordenante: 'Nadia Blanco', destinatario: 'dLocal Go' }), tokens: {} })
    await m.correr([await citando(m, id, 'confirmacion')])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.validacion.confirmacion.ok, true)
    // Lo que falta se lo pide al closer el flujo de siempre (citando su mensaje)
    const pedido = aVentas(m).find((x) => /me falta/.test(x.texto))
    assert.match(pedido.texto, /Inicio del servicio/)
    assert.equal(pedido.citar, ev.mensajeId)
    await m.correr([deCloserLibre('Inicio del servicio: 27/10/2026', { citado: { id: await pedidoDe(m, id, 'datos'), autor: null } })])
    // Dos archivos: se aprueba usar el primero (la ronda de siempre)
    const abierta = (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === 'validar' && x.estado === 'abierta')
    if (abierta) await m.correr([await citando(m, id, 'validar', 'OK Empresa')])
    const f = m.dj.llamadas.finanzas.at(-1).fila
    assert.equal(f.celdas.C, 'Nadia Blanco'); assert.equal(f.celdas.G, 'Yamila'); assert.equal(f.celdas.E, 1299); assert.equal(f.celdas.J, 'PIF')
    assert.equal((await pasosDe(m, id)).crm.estado, 'hecho')
  })

  test('comprobante aparte a los 20 minutos: también va al alta libre (ventana de 30); a los 31 ya no', async () => {
    const m = libreDe()
    const ev = evLibre()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    m.reloj.t = T0 + 20 * 60_000
    await m.correr([docDeYamila('doc-20', 'comprobante.pdf')])
    assert.deepEqual((await m.almacen.leerAlta(id)).medios.map((x) => x.id), ['doc-20'])
    const m2 = libreDe()
    const ev2 = evLibre()
    await m2.correr([ev2])
    m2.reloj.t = T0 + 31 * 60_000
    await m2.correr([docDeYamila('doc-31', 'comprobante.pdf')])
    assert.equal((await m2.almacen.leerAlta(`alta_${ev2.mensajeId}`)).medios.length, 0)
  })

  test('NO: se descarta sin escribirle al closer, sin cargar nada, y no se vuelve a preguntar por ese mensaje', async () => {
    const m = libreDe()
    const ev = evLibre()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([await citando(m, id, 'confirmacion', 'NO, es un resumen')])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.estado, 'rechazada')
    assert.equal(aVentas(m).length, 0)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    await m.correr([{ ...ev, clave: `${ev.clave}-reenvio` }])   // Whapi lo vuelve a mandar
    await m.correr([{ ...base({ autor: deYamila }), tipo: 'edicion', grupo: 'ventas', clave: 'ed:x', mensajeId: ev.mensajeId, citado: null, texto: `${NADIA}\n.` }])
    assert.equal(aVerif(m).length, 1)
    assert.equal(aVentas(m).length, 0)
  })

  test('cliente que ya está en el CRM (regla A): no es un alta, es un pago; con OK solo Finanzas ("2da Cuota")', async () => {
    const m = libreDe({ pasos: { clienteCrm: async () => ({ id: 'A123', nombre: 'Nadia Blanco', estado: 'ACTIVO', motivo: 'teléfono' }) } })
    const ev = evLibre(NADIA.replace('Completa PIF 1299 USD', 'Pago cuota 1000 USD'), { medios: [pdf('doc-c', 'comprobante.pdf')] })
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.match(aVerif(m)[0].texto, /^💳 Nadia Blanco ya está en el CRM de Clientes \(A123, ACTIVO, por teléfono\): no es un alta, es un pago de 1000 USD/)
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '1000', ordenante: 'Nadia Blanco' }), tokens: {} })
    await m.correr([await citando(m, id, 'confirmacion')])
    const alta = await m.almacen.leerAlta(id)
    assert.equal(alta.validacion.estadoPlan, 'pago_cliente')
    assert.equal(alta.estado, 'lista')
    assert.equal(m.dj.llamadas.finanzas.at(-1).fila.celdas.J, '2da Cuota')
    assert.equal(m.dj.llamadas.crm.length + m.dj.llamadas.drive.length, 0)
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 0)
    assert.deepEqual(await estadosPasos(m, id), { validar: 'hecho', finanzas: 'hecho', crm: 'pendiente', drive: 'pendiente', comunidad: 'pendiente', bienvenida: 'pendiente', skool: 'pendiente', contrato: 'pendiente' })
  })

  test('Fee (regla B) y pago siguiente que completa la primera cuota (reglas C y D)', async () => {
    const m = libreDe()
    const FEE = 'Seña 300 USD\nPIF 1300 USD\nNombre: Nadia Blanco\nTel: +595 975 000001\nmail: nadia.blanco@example.test'
    const ev = evLibre(FEE, { medios: [pdf('doc-fee', 'comprobante.pdf')] })
    const idFee = `alta_${ev.mensajeId}`
    await m.correr([ev])
    // La primera pregunta ya es la del Fee: con su OK, Finanzas y la comunidad. Nada más.
    assert.match(aVerif(m)[0].texto, /^💰 Fee de Nadia Blanco \(300 USD, closer Yamila\)\. ¿Lo cargo en Finanzas y creo la comunidad\?/)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '300', ordenante: 'Nadia Blanco', numero_operacion: 'OP-FEE' }), tokens: {} })
    await m.correr([await citando(m, idFee, 'confirmacion')])
    assert.equal(m.dj.llamadas.finanzas.at(-1).fila.celdas.J, 'Fee')
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 1)
    assert.equal(m.dj.llamadas.crm.length + m.dj.llamadas.drive.length + m.dj.llamadas.contrato.length, 0)
    assert.ok(aVentas(m).some((x) => /es un Fee \(seña\)\. Lo cargo en Finanzas y armo la comunidad/.test(x.texto)))
    await m.correr([await citando(m, idFee, 'comunidad', 'OK', { telefono: AYLU, lid: null, nombre: 'Aylu' })])
    assert.equal((await m.almacen.leerAlta(idFee)).estado, 'fee')
    const pasosFee = await estadosPasos(m, idFee)
    assert.equal(pasosFee.comunidad, 'hecho'); assert.equal(pasosFee.crm, 'pendiente'); assert.equal(pasosFee.bienvenida, 'pendiente'); assert.equal(pasosFee.skool, 'pendiente')

    // Pago siguiente sin contacto (regla D): "Pago 1000 USD · Nombre: Nadia Blanco" y su comprobante
    m.reloj.t = T0 + 86_400_000
    const pago = deCloserLibre('Pago 1000 USD\nNombre: Nadia Blanco')
    const id2 = `alta_${pago.mensajeId}`
    await m.correr([pago])
    const nueva = await m.almacen.leerAlta(id2)
    assert.equal(nueva.altaAnterior, idFee)
    assert.equal(parsearAlta(nueva.textoVigente).correo, 'nadia.blanco@example.test')   // los datos salen del Fee
    m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '1000', ordenante: 'Nadia Blanco', numero_operacion: 'OP-2' }), tokens: {} })
    await m.correr([docDeYamila('doc-2', 'comprobante2.pdf')])
    // Regla C: no se vuelve a preguntar si es un alta; se pregunta si sigue con el alta completa
    const c = (await m.almacen.leerAlta(id2)).esperas.find((x) => x.motivo === 'fee_suma' && x.estado === 'abierta')
    assert.match(c.datos.texto, /^Nadia Blanco completó la primera cuota \(300 \+ 1000 = 1300 USD\)\. ¿Sigo con el alta completa\?/)
    assert.equal((await m.almacen.leerAlta(id2)).esperas.some((x) => x.motivo === 'confirmacion'), false)
    await m.correr([await citando(m, id2, 'fee_suma')])
    // Lo que falta para el alta completa se lo pide al closer
    const datos = (await m.almacen.leerAlta(id2)).esperas.find((x) => x.motivo === 'datos' && x.estado === 'abierta')
    if (datos) await m.correr([deCloserLibre('Inicio del servicio: 27/10/2026\nCI: 1234567\nDirección: Calle Ficticia 123, Ciudad del Este', { citado: { id: await pedidoDe(m, id2, 'datos'), autor: null } })])
    const ronda = (await m.almacen.leerAlta(id2)).esperas.find((x) => x.motivo === 'validar' && x.estado === 'abierta')
    if (ronda) await m.correr([await citando(m, id2, 'validar')])
    const pasos2 = await estadosPasos(m, id2)
    assert.equal(pasos2.crm, 'hecho'); assert.equal(pasos2.drive, 'hecho')
    const p2 = await pasosDe(m, id2)
    assert.equal(p2.comunidad.estado, 'hecho'); assert.equal(p2.comunidad.resultado.heredadaDe, idFee)
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 1)   // no se armó otra
    assert.equal((await m.almacen.leerAlta(idFee)).estado, 'reemplazada')
  })

  test('el Fee libre también vale si pasa los 500 pero no llega a la primera cuota (800 de un PIF de 2600)', async () => {
    const m = libreDe()
    const ev = evLibre('PIF 2600 USD\nAnticipo 800 USD\nNombre: Nadia Blanco\nTel: +595 975 000001', { medios: [pdf('doc-800', 'c.pdf')] })
    await m.correr([ev])
    assert.match(aVerif(m)[0].texto, /^💰 Fee de Nadia Blanco \(800 USD/)
  })

  test('seco: la pregunta queda anotada y el resto corre como vista previa (no sale nada)', async () => {
    const m = libreDe({ modo: 'seco', capacidades: new Set() })
    const ev = evLibre()
    const r = await m.correr([ev])
    assert.equal(m.whapi.enviados.length, 0)
    assert.ok(r.registro.some((x) => /pediría en Verificaciones: ¿Esto es un alta\? Nadia Blanco/.test(x)))
    assert.equal((await m.almacen.leerAlta(`alta_${ev.mensajeId}`)).estado, 'simulada')
  })

  test('datos sin citar que parecen un alta libre, del closer de un #ALTA que los espera: se suman a esa alta (no es otra)', async () => {
    const m = libreDe()
    const alta = evAlta(TEXTO.replace('Correo: ana@ejemplo.com\n', ''))
    const id = `alta_${alta.mensajeId}`
    await m.correr([alta])
    assert.ok((await m.almacen.leerAlta(id)).esperas.some((x) => x.quien === 'closer' && x.estado === 'abierta'))
    const ev = evLibre('Nombre completo: Ana Pérez\nTeléfono: +54 9 11 3000-1111\nCorreo: ana@ejemplo.com\nEste pago: 1100 USD', { autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' } })
    await m.correr([ev])
    assert.equal(await m.almacen.leerAlta(`alta_${ev.mensajeId}`), null)
    const a = parsearAlta((await m.almacen.leerAlta(id)).textoVigente)
    assert.equal(a.correo, 'ana@ejemplo.com'); assert.equal(a.totalUsd, 3300)
  })

  test('#ALTA unificado (26/10): cliente que ya está en el CRM = pago con OK, como la cuota que sigue a las suyas ("3ra Cuota")', async () => {
    const m = libreDe({ pasos: { clienteCrm: async () => ({ id: 'A045', nombre: 'Ana Pérez', estado: 'INACTIVO', motivo: 'teléfono' }), cuotasAnteriores: async () => 2 } })
    const ev = evAlta(TEXTO)
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    assert.match(aVerif(m)[0].texto, /^💳 Ana Pérez ya está en el CRM de Clientes \(A045, INACTIVO, por teléfono\): no es un alta, es un pago de 1100 USD/)
    assert.equal(m.dj.llamadas.finanzas.length, 0)
    await m.correr([await citando(m, id, 'confirmacion')])
    assert.equal(m.dj.llamadas.finanzas.at(-1).fila.celdas.J, '3ra Cuota')
    assert.equal((await pasosDe(m, id)).finanzas.parcial.conceptoCuota, '3ra Cuota')
    assert.equal(m.dj.llamadas.crm.length + m.dj.llamadas.drive.length, 0)
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
  })

  test('#ALTA sin cliente en el CRM no pregunta "¿Esto es un alta?"; un PIF pagado en parte (800 de 2600) es un Fee', async () => {
    const m = libreDe()
    const ev = evAlta(TEXTO)
    await m.correr([ev])
    assert.ok(!aVerif(m).some((x) => /¿Esto es un alta\?/.test(x.texto)))
    assert.equal((await pasosDe(m, `alta_${ev.mensajeId}`)).crm.estado, 'hecho')
    const m2 = libreDe()
    m2.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ monto_texto: '800' }), tokens: {} })
    const pif = evAlta(TEXTO.replace('Tipo de pago: PP 3300 USD', 'Tipo de pago: PIF 2600 USD').replace('Este pago: 1100 USD', 'Este pago: 800 USD').replace('Cuotas:\n26/11/2026 1100\n26/12/2026 1100', ''))
    await m2.correr([pif])
    assert.equal((await m2.almacen.leerAlta(`alta_${pif.mensajeId}`)).validacion.estadoPlan, 'fee')
    assert.ok(aVerif(m2).some((x) => /^💰 Fee de Ana Pérez \(800 USD/.test(x.texto)))
  })

  test('confirman solo los de BOT_ALTA_APROBADORES (Gero A, Aylu, Gero M): el OK de otro número no cuenta', async () => {
    const m = libreDe()
    const ev = evLibre()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([await citando(m, id, 'confirmacion', 'OK', { telefono: '5499999999999', lid: null, nombre: 'Otro' })])
    assert.equal((await m.almacen.leerAlta(id)).validacion.confirmacion?.ok ?? false, false)
    await m.correr([await citando(m, id, 'confirmacion')])
    assert.equal((await m.almacen.leerAlta(id)).validacion.confirmacion.ok, true)
  })

  test('un alta libre de alguien con un alta abierta (no Fee) se ignora sin tocarla', async () => {
    const m = libreDe()
    const alta = evAlta(TEXTO)
    await m.correr([alta])
    const antes = aVerif(m).length
    const ev = evLibre('Completa PP 3300 USD\nNombre: Ana Pérez\nTel: +54 9 11 3000-1111')
    await m.correr([ev])
    assert.equal(await m.almacen.leerAlta(`alta_${ev.mensajeId}`), null)
    assert.equal(aVerif(m).length, antes)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// WhatsApp seguro (26/10/2026): WhatsApp suspendió el número del bot horas después de prender la comunidad, que sumaba al
// cliente directo. Ahora: comunidad solo con el equipo, link del General al closer, bienvenida cuando el cliente entra,
// tope diario que espera (no falla), ritmo de 20 a 40 s entre creaciones y guardia de salud ('sin_numero' → reintento).
// La guardia en sí (GET /health, avisos a Discord) y el webhook de ingreso se prueban en scripts/test-whatsapp-seguro.mjs.
describe('WhatsApp seguro (26/10/2026)', () => {
  const CON_SOCIA_SEGURO = TEXTO.replace('Socios: ninguno', 'Socios:\nBeatriz Gómez · +54 9 11 3000-4444 · bea@ejemplo.com')
  const aylu = { telefono: AYLU, lid: null, nombre: 'Aylu' }
  const ingreso = (chatId, participantes, t = relojGlobal) => {
    const clave = `in:prueba-${++nMsg}`
    return { tipo: 'ingreso', grupo: null, clave, mensajeId: clave, chatId, autor: { telefono: null, lid: null, nombre: null }, enviadoEn: iso(t + nMsg), recibidoEn: iso(t), citado: null, participantes, accion: 'add' }
  }
  const aVerif = (m) => m.whapi.enviados.filter((x) => x.chatId === GRUPOS.verificaciones)

  test('modo seguro (por defecto): grupos solo con el equipo (y el closer en General), sin verificar ni agendar al cliente', async () => {
    const m = motorDe()
    const ev = evAlta(CON_SOCIA_SEGURO)
    await m.correr([ev])
    const creados = m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad')
    assert.equal(creados.length, 3)
    for (const c of creados) {
      assert.ok(!c.p.participantes.includes(TEL_ANA), 'el cliente no se suma directo')
      assert.ok(!c.p.participantes.includes('5491130004444'), 'la socia tampoco')
      assert.ok(c.p.participantes.every((n) => Object.values(EQUIPO).includes(n) || n === CLOSER), `${c.p.nombre}: solo equipo y closer`)
    }
    assert.ok(creados.find((x) => /^General/.test(x.p.nombre)).p.participantes.includes(CLOSER))
    assert.ok(!creados.find((x) => /^Ventas/.test(x.p.nombre)).p.participantes.includes(CLOSER))
    assert.equal(m.whapi.llamadas.filter((x) => ['verificarNumeros', 'agendarContacto'].includes(x.m)).length, 0)
    // El pedido a Aylu dice que el link lo tiene el closer y que la bienvenida sale sola cuando el cliente entra
    const pedido = (await m.almacen.leerAlta(`alta_${ev.mensajeId}`)).esperas.find((x) => x.motivo === 'comunidad')
    assert.match(pedido.datos.texto, /solo con el equipo/); assert.match(pedido.datos.texto, /la bienvenida sale sola/)
  })

  test('el link del General le llega al closer en Ventas C.J, citando su #ALTA, con el texto exacto', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const g = (await pasosDe(m, id)).comunidad.parcial.grupos.general
    const link = m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas && /^Pasale este link/.test(x.texto))
    assert.equal(link.length, 1)
    assert.equal(link[0].texto, `Pasale este link a Ana para que entre a su grupo: https://chat.whatsapp.com/${g.invitacion}`)
    assert.equal(link[0].citar, ev.mensajeId)
    assert.equal((await pasosDe(m, id)).comunidad.parcial.linkCloser, 'enviado')
    // Otra corrida no lo repite
    await m.motor.avanzar(id, m.op())
    assert.equal(m.whapi.enviados.filter((x) => /^Pasale este link/.test(x.texto)).length, 1)
  })

  test('con el General que crea WhatsApp solo (sin invite_code): el link sale de GET /groups/{id}/invite y se suma solo al equipo', async () => {
    const m = motorDe({ whapiOp: { generalChat: true } })
    const ev = evAlta()
    await m.correr([ev])
    const agregar = m.whapi.llamadas.filter((x) => x.m === 'agregarParticipantes')
    assert.equal(agregar.length, 1); assert.ok(!agregar[0].p.participantes.includes(TEL_ANA))
    const link = m.whapi.enviados.find((x) => /^Pasale este link/.test(x.texto))
    assert.match(link.texto, /https:\/\/chat\.whatsapp\.com\/GENAUTO$/)
  })

  test('sin link del General: no se le manda nada al closer y queda en el pedido a Aylu', async () => {
    const m = motorDe()
    m.whapi.linkInvitacion = async () => { throw Object.assign(new Error('juguete: sin link'), { name: 'ErrorWhapi', tipo: 'pasajero', status: 500, aplicado: false }) }
    m.whapi.crearGrupoEnComunidad = async (p) => { m.whapi.llamadas.push({ m: 'crearGrupoEnComunidad', p }); return { id: `grupo-${m.whapi.llamadas.length}@g.us`, nombre: p.nombre, codigoInvitacion: null, agregados: p.participantes, fallidos: [] } }
    const ev = evAlta()
    await m.correr([ev])
    assert.equal(m.whapi.enviados.filter((x) => /^Pasale este link/.test(x.texto)).length, 0)
    const pedido = (await m.almacen.leerAlta(`alta_${ev.mensajeId}`)).esperas.find((x) => x.motivo === 'comunidad')
    assert.match(pedido.datos.texto, /No pude sacar el link del General/)
  })

  test('el cliente entra al General por el link → la bienvenida sale sin el OK de Aylu; si entra alguien del equipo, nada', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const gid = (await pasosDe(m, id)).comunidad.parcial.grupos.general.id
    assert.equal((await m.almacen.leerRecurso(`general:${gid}`)).datos.altaId, id)
    // Entra Aylu (equipo): no cuenta
    await m.correr([ingreso(gid, [AYLU])])
    assert.equal((await pasosDe(m, id)).comunidad.estado, 'espera')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 0)
    // Alguien entra a un grupo que no es de ningún alta: nada
    await m.correr([ingreso('120363999999999999@g.us', [TEL_ANA])])
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 0)
    // Entra Ana
    const r = await m.correr([ingreso(gid, [TEL_ANA])])
    assert.deepEqual(r.errores, [])
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    const video = m.whapi.enviados.find((x) => x.tipo === 'video')
    assert.equal(video.chatId, gid)
    assert.ok(aVerif(m).some((x) => /Ana Pérez entró a su grupo General por el link: sale la bienvenida/.test(x.texto)))
    // La espera de Aylu quedó resuelta por WhatsApp; un OK tardío de Aylu ya no reenvía nada
    const e = (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === 'comunidad')
    assert.equal(e.estado, 'resuelta'); assert.equal(e.respuesta.por, 'whatsapp: entró al grupo')
    await m.correr([evResp('OK', { citado: { id: e.mensajes[0], autor: null }, autor: aylu })])
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 1)
  })

  test('un @lid desconocido que entra al General cuenta como el cliente (no se puede comparar el teléfono)', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const gid = (await pasosDe(m, id)).comunidad.parcial.grupos.general.id
    await m.correr([ingreso(gid, ['123456789012345@lid'])])
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
  })

  test('sin el evento de ingreso, el OK de Aylu sigue mandando la bienvenida (como antes)', async () => {
    const m = motorDe()
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: aylu })])
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    assert.equal(m.whapi.enviados.filter((x) => x.tipo === 'video').length, 1)
  })

  test('BOT_COMUNIDAD_AGREGAR_DIRECTO=si (agregarDirecto): el modo viejo suma al cliente y no manda el link al closer', async () => {
    const m = motorDe({ pasos: { agregarDirecto: true } })
    const ev = evAlta()
    await m.correr([ev])
    assert.ok(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').every((x) => x.p.participantes.includes(TEL_ANA)))
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'verificarNumeros').length, 1)
    assert.equal(m.whapi.enviados.filter((x) => /^Pasale este link/.test(x.texto)).length, 0)
  })

  test('servidor: agregarDirecto SOLO con BOT_COMUNIDAD_AGREGAR_DIRECTO=si (sin variable, con "no" o "1": apagado)', () => {
    for (const [v, esperado] of [[undefined, false], ['', false], ['no', false], ['1', false], ['true', false], ['si', true], [' SI ', true]]) {
      const env = v === undefined ? {} : { BOT_COMUNIDAD_AGREGAR_DIRECTO: v }
      assert.equal(S.depsPasosServidor({ modo: 'seco' }, env).agregarDirecto, esperado, String(v))
    }
  })

  test('tope diario: la que se pasa queda en reintento hasta que se libera el cupo (al día siguiente), nunca fallada', async () => {
    const m = motorDe({ maxComunidadesDia: 2 })
    const ids = []
    for (const [i, nombre] of ['Beatriz Gómez', 'Carla Díaz', 'Dora Ruiz'].entries()) {
      const texto = TEXTO.replace('Ana Pérez', nombre).replace('+54 9 11 3000-1111', `+54 9 11 3000-900${i}`).replace('ana@ejemplo.com', `c${i}@ejemplo.com`)
      m.dj.colas.vision.push({ modelo: 'x', salida: lecturaOk({ numero_operacion: `OP-T${i}`, ordenante: nombre }), tokens: {} })
      const ev = evAlta(texto, { autor: { telefono: `549700000000${i}`, lid: null, nombre: `Closer ${i}` } })
      await m.correr([ev])
      ids.push(`alta_${ev.mensajeId}`)
    }
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 2)
    const tercera = (await pasosDe(m, ids[2])).comunidad
    assert.equal(tercera.estado, 'reintento')
    assert.match(tercera.error, /tope 2\): espera al día siguiente/)
    assert.equal(tercera.noAntesDe, iso(m.reloj.t + 24 * 3600_000))
    assert.notEqual((await m.almacen.leerAlta(ids[2])).estado, 'revisar')
    // Varias vueltas antes de tiempo: sigue esperando, sin crear ni fallar
    for (let i = 0; i < 3; i++) { m.reloj.t += 3600_000; await m.motor.avanzar(ids[2], m.op()) }
    assert.equal((await pasosDe(m, ids[2])).comunidad.estado, 'reintento')
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 2)
    // Al día siguiente se crea
    m.reloj.t = T0 + 24 * 3600_000 + 1000
    await m.motor.avanzar(ids[2], m.op())
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 3)
    assert.equal((await pasosDe(m, ids[2])).comunidad.estado, 'espera')
  })

  test('tope: el chequeo y la creación van bajo el candado comunidad_cupo (otra alta creando → reintento en 1 min)', async () => {
    const m = motorDe()
    assert.equal(await m.almacen.tomarRecurso('comunidad_cupo', 'otra-alta', 120_000), true)
    const ev = evAlta()
    await m.correr([ev])
    const p = (await pasosDe(m, `alta_${ev.mensajeId}`)).comunidad
    assert.equal(p.estado, 'reintento'); assert.match(p.error, /otra alta está creando su comunidad/)
    assert.equal(p.noAntesDe, iso(m.reloj.t + 60_000))
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 0)
    // Suelto el candado: la crea y lo suelta
    await m.almacen.soltarRecurso('comunidad_cupo', 'otra-alta')
    m.reloj.t += 61_000
    await m.motor.avanzar(`alta_${ev.mensajeId}`, m.op())
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 1)
    assert.equal(await m.almacen.tomarRecurso('comunidad_cupo', 'otra-alta', 120_000), true)
  })

  test('ritmo: de 20 a 40 s entre crear la comunidad y cada grupo (azar 0 → 20 s, azar 1 → 40 s), nada de ráfagas', async () => {
    for (const [azar, ms] of [[0, 20_000], [1, 40_000], [0.5, 30_000]]) {
      const esperas = []
      const m = motorDe({ pasos: { esperar: async (x) => { esperas.push(x) }, azar: () => azar } })
      const ev = evAlta()
      await m.correr([ev])
      const largas = esperas.filter((x) => x >= 20_000)
      assert.deepEqual(largas, [ms, ms, ms], `azar ${azar}`)   // antes de General, Ventas y Contenido
      assert.ok(esperas.every((x) => x <= 40_000))
      assert.ok((await pasosDe(m, `alta_${ev.mensajeId}`)).comunidad.parcial.ultimaCreacion)
    }
  })

  test('ritmo entre invocaciones: si la pausa no entra en el plazo, sigue en otra (y la respeta desde la última creación)', async () => {
    const C2 = await import('../lib/bot/alta/motor/comunidad.ts')
    assert.equal(C2.ENTRE_CREACIONES_MIN_MS, 20_000); assert.equal(C2.ENTRE_CREACIONES_MAX_MS, 40_000)
    const t = T0
    const pasoBase = { ...A.pasoVacio('comunidad'), estado: 'corriendo', iniciado: iso(t), parcial: { comunidadId: '120363000000000500@g.us', avisosId: null, grupos: {}, fotos: {}, intentoGrupo: {}, pendientes: [], ultimaCreacion: iso(t - 5_000) } }
    const alta = { id: 'alta_r', altaAnterior: null, textoVigente: TEXTO, autor: { telefono: CLOSER, lid: null, nombre: 'Marcos' }, mensajeAltaId: 'M1', mensajesAlta: ['M1'], validacion: null }
    const dj = depsJuguete({ pasos: { esperar: async () => { throw new Error('no debería esperar') }, azar: () => 0 } })
    const w = whapiJuguete()
    const ctx = {
      alta, paso: pasoBase, pasos: {}, modo: 'real', real: true, capacidades: TODAS, huboCorriendo: false, iniciadoAnterior: null, ahora: () => t, hasta: t + 30_000,
      deps: dj.pasos, whapi: w, grupos: GRUPOS, almacen: A.almacenEnMemoria({ ahora: () => t }), dueno: 'inv', anteriorUsd: null,
      enviar: async () => ({ estado: 'enviado', id: 'x' }), guardarParcial: async () => {},
    }
    const s = await C2.pasoComunidad(ctx)
    assert.equal(s.estado, 'reintento'); assert.equal(s.otraInvocacion, true)
    assert.equal(s.noAntesDe, iso(t + 15_000))   // faltaban 15 s de los 20 s desde la última creación
    assert.equal(w.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').length, 0)
  })

  test('guardia de salud en el motor: sin_numero al crear la comunidad → reintento en 10 min con el motivo, sin crear nada más', async () => {
    const m = motorDe({ whapiOp: { fallas: { crearComunidad: ['sin_numero'] } } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    const p = (await pasosDe(m, id)).comunidad
    assert.equal(p.estado, 'reintento')
    assert.match(p.error, /número del bot desconectado o suspendido/)
    assert.equal(p.noAntesDe, iso(m.reloj.t + 10 * 60_000))
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearGrupoEnComunidad').length, 0)
    // Vuelve el número: sigue sola
    m.reloj.t += 11 * 60_000
    await m.motor.avanzar(id, m.op())
    assert.equal((await pasosDe(m, id)).comunidad.estado, 'espera')
  })

  test('guardia de salud en el motor: la bienvenida frenada queda en reintento con el motivo y sale cuando vuelve el número', async () => {
    const fallas = {}
    const m = motorDe({ whapiOp: { fallas } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    fallas.enviarVideo = ['sin_numero']
    await m.correr([evResp('OK', { citado: { id: await pedidoDe(m, id, 'comunidad'), autor: null }, autor: aylu })])
    const b = (await pasosDe(m, id)).bienvenida
    assert.equal(b.estado, 'reintento'); assert.equal(b.error, 'número del bot desconectado o suspendido')
    assert.equal(b.noAntesDe, iso(m.reloj.t + 10 * 60_000))
    m.reloj.t += 11 * 60_000
    await m.motor.avanzar(id, m.op())
    assert.equal((await m.almacen.leerAlta(id)).estado, 'lista')
    // Salió una sola vez y sin "(repetido)" (el frenado quedó 'fallido', no 'dudoso')
    const videos = m.whapi.enviados.filter((x) => x.tipo === 'video')
    assert.equal(videos.length, 1); assert.ok(!/\(repetido\)/.test(videos[0].pie))
  })

  test('guardia de salud en el motor: un pedido al equipo frenado se reintenta (no se pierde)', async () => {
    const fallas = { enviarTexto: ['sin_numero', 'sin_numero', 'sin_numero', 'sin_numero', 'sin_numero', 'sin_numero'] }
    const m = motorDe({ whapiOp: { fallas } })
    const ev = evAlta()
    const id = `alta_${ev.mensajeId}`
    await m.correr([ev])
    // El link al closer no salió: la comunidad (ya armada) queda en reintento con el motivo, sin perder lo hecho
    const c = (await pasosDe(m, id)).comunidad
    assert.equal(c.estado, 'reintento'); assert.equal(c.error, 'link al closer: número del bot desconectado o suspendido')
    assert.ok(c.parcial.grupos.general.id)
    assert.equal(m.whapi.enviados.filter((x) => x.chatId === GRUPOS.ventas).length, 0)
    fallas.enviarTexto.length = 0
    m.reloj.t += 3 * 3600_000
    await m.motor.avanzar(id, m.op())
    const pedido = (await m.almacen.leerAlta(id)).esperas.find((x) => x.motivo === 'comunidad')
    assert.ok(pedido.mensajes.length || pedido.enviado, 'el pedido a Aylu terminó saliendo')
    assert.equal(m.whapi.llamadas.filter((x) => x.m === 'crearComunidad').length, 1)   // no se rehízo nada
    assert.equal(m.whapi.enviados.filter((x) => /^Pasale este link/.test(x.texto)).length, 1)
  })
})
