// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-alta-libre.mjs
// Altas en FORMATO LIBRE (sin #ALTA, Tomás 26/10/2026): detección, no-detección con charla real del grupo, parseo del ejemplo
// real, closer del autor, primera cuota y Fee, cliente que ya está en el CRM, textos de Verificaciones y la clasificación del
// webhook. Puro: sin red, sin base y sin Claude. Los flujos del motor (OK / NO, comprobante aparte, Fee y pago siguiente)
// están en scripts/test-bot-orquestador.mjs ("alta en formato libre").
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const L = await import('../lib/bot/alta/altaLibre.ts')
const { parsearAlta } = await import('../lib/bot/alta/parsear.ts')
const W = await import('../lib/bot/whapi/webhook.ts')
const FIN = await import('../lib/bot/alta/finanzas.ts')
const C = await import('../lib/bot/alta/comprobante.ts')

// El ejemplo real (Ventas C.J., 26/10 16:31, closer Yamila)
const NADIA = `Completa PIF 1299 USD
Nombre: Nadia Blanco
Tel: +595 975 000001
mail: nadia.blanco@example.test
CI: 1234567
Dirección: Calle Ficticia 123, Ciudad del Este`

describe('detección', () => {
  test('el ejemplo real es un alta libre', () => {
    assert.equal(L.esAltaLibre(NADIA), true)
    assert.deepEqual(L.leerLibre(NADIA), { nombre: 'Nadia Blanco', telefono: true, correo: true, pago: true, monto: true })
  })
  test('tolera mayúsculas, acentos, ":" o "-", otro orden y campos extra', () => {
    const variantes = [
      'NOMBRE: Nadia Blanco\nTELÉFONO: +595 975 000001\nPIF 1299 USD',
      'Cliente - Juan Pérez\nCel - +54 9 11 3000 1111\nSeña 300 usd',
      'Programa: Agencia\nCloser: Marcos\nSocios: ninguno\nCorreo: juan@estudio.com\nNombre completo: Juan Pérez\nPago: U$S 1.100 transferencia',
      '*Nombre:* Ana María Gómez\n*WhatsApp:* +54 9 351 555 1234\nDNI: 30111222\n2 cuotas de 1300 – abonó la primera',
      'Completa el pago\nnombre y apellido: Lucía Benítez\nmail: lucia@x.com\n$1300',
      'Dirección: Calle 123\nCI: 1234567\nNombre: Pedro Ruiz\nwsp: +598 99 123 456\nPP 2600 USD',
    ]
    for (const v of variantes) assert.equal(L.esAltaLibre(v), true, v)
  })
  test('charla común del grupo NO es un alta (sin falsos positivos)', () => {
    const charla = [
      'son 800 usd que entraron hoy y mañana 1800 para completar',
      'me ayudan? en stripe el número está mal',
      'Buen día equipo!',
      'Nombre: Juan Pérez\nTel: +54 9 11 3000 1111',                       // un lead: sin pago
      'Pasame el mail de Nadia: nadia.blanco@example.test',
      'Ya pagó el cliente de ayer?',
      'Hoy entraron 1299 USD por dLocal',
      'Nombre: Nadia Blanco pagó 300 USD',                                     // sin contacto (y el valor no es un nombre)
      'Tel: +54 9 11 3000 1111 pago 300 usd',                                // sin nombre
      'Cliente: no sé, preguntale a Tomi. El pago fue de 500 USD, mail tomi@x.com',
      'Link de pago: https://checkout.dlocalgo.com/xyz',
      'Recordatorio: mañana a las 10 reunión con Nadia Blanco, tel +595 975 000001',
      'Chicos el PIF de Marcos entra el lunes, completa 1300 USD',
      '#ALTA\nNombre: Ana Pérez\nTel: +54 9 11 3000 1111\nPIF 1300 USD',     // con la etiqueta lo toma el #ALTA de siempre
      '',
    ]
    for (const c of charla) assert.equal(L.esAltaLibre(c), false, c)
  })
  test('pago siguiente sin contacto (regla D): nombre + pago + monto, pero solo no alcanza para ser un alta', () => {
    assert.equal(L.esPagoLibre('Pago 1000 USD\nNombre: Nadia Blanco'), true)
    assert.equal(L.esAltaLibre('Pago 1000 USD\nNombre: Nadia Blanco'), false)
    assert.equal(L.esPagoLibre('Nombre: Nadia Blanco\nya pagó?'), false)
  })
  test('una fila con #ALTA no es libre; una sin texto tampoco', () => {
    assert.equal(L.esAltaLibreFila({ textoOriginal: NADIA }), true)
    assert.equal(L.esAltaLibreFila({ textoOriginal: `#ALTA\n${NADIA}` }), false)
    assert.equal(L.esAltaLibreFila({}), false)
  })
})

describe('parseo a la estructura del #ALTA', () => {
  test('el ejemplo real: PIF 1299 USD de la primera línea, CI como documento, closer del autor', () => {
    const texto = L.textoAltaLibre(NADIA, L.closerDeAutor({ telefono: '595981000001', lid: null }, { Yamila: '595 981 000 001', Marcos: '5491100000000' }))
    const a = parsearAlta(texto)
    assert.equal(a.etiquetaAlta, false)
    assert.equal(a.closer, 'Yamila')
    assert.equal(a.modalidad, 'PIF'); assert.equal(a.totalUsd, 1299); assert.equal(a.estePagoUsd, 1299)
    assert.equal(a.nombre, 'Nadia Blanco')
    assert.deepEqual(a.telefonos.map((t) => t.numero), ['595975000001'])
    assert.equal(a.correo, 'nadia.blanco@example.test')
    assert.equal(a.dni, '1234567')
    assert.equal(a.direccion, 'Calle Ficticia 123, Ciudad del Este')
    // Lo que falta queda como faltante (se lo pide al closer el flujo de siempre); paraguayo: sin DNI ni CUIT argentinos
    assert.deepEqual(a.faltantes, ['Inicio del servicio'])
    assert.equal(L.textoAltaLibre(`Closer: Marcos\n${NADIA}`, 'Yamila').startsWith('Closer: Marcos'), true)
    assert.equal(L.closerDeAutor({ telefono: '5490000000000', lid: null }, { Yamila: '595981000001' }), null)
  })
  test('"Clave - valor", seña, "N cuotas de X" y una seña después del PIF', () => {
    const a = parsearAlta('Seña 300 USD\nCliente - Juan Pérez\nCel - +54 9 11 3000 1111\n2 cuotas de 1300')
    assert.equal(a.nombre, 'Juan Pérez'); assert.equal(a.estePagoUsd, 300)
    assert.equal(a.modalidad, 'PP'); assert.equal(a.totalUsd, 2600); assert.equal(a.primeraCuotaUsd, 1300)
    const b = parsearAlta('PIF 1300 USD\nSeña 300 USD\nNombre: Nadia Blanco')
    assert.equal(b.totalUsd, 1300); assert.equal(b.estePagoUsd, 300)
  })
  test('el #ALTA de siempre no cambia con las claves nuevas', () => {
    const a = parsearAlta('#ALTA\nCloser: Marcos\nTipo de pago: PP 3300 USD\nEste pago: 1100 USD · Transferencia\nNombre completo: Ana Pérez\nTeléfono: +54 9 11 3000-1111\nCorreo: ana@x.com')
    assert.equal(a.totalUsd, 3300); assert.equal(a.estePagoUsd, 1100); assert.equal(a.primeraCuotaUsd, undefined)
  })
})

describe('primera cuota y Fee (reglas B y C)', () => {
  test('primera cuota: PIF = total; "N cuotas de X" = X; un PP sin detalle no se sabe', () => {
    assert.equal(L.primeraCuotaDe({ modalidad: 'PIF', totalUsd: 1299 }), 1299)
    assert.equal(L.primeraCuotaDe({ modalidad: 'PP', totalUsd: 2600, primeraCuotaUsd: 1300 }), 1300)
    assert.equal(L.primeraCuotaDe({ modalidad: 'PP', totalUsd: 3300 }), null)
  })
  test('Fee: menos de USD 500 siempre; si se sabe la primera cuota, menos que ella', () => {
    assert.equal(L.esFeeLibre(300, null), true)
    assert.equal(L.esFeeLibre(300, 1300), true)
    assert.equal(L.esFeeLibre(800, 2600), true)       // "son 800 usd que entraron hoy y mañana 1800 para completar"
    assert.equal(L.esFeeLibre(800, null), false)
    assert.equal(L.esFeeLibre(1299, 1299), false)
    assert.equal(L.umbralAltaCompleta(1300), 1300)
    assert.equal(L.umbralAltaCompleta(null), 500)
  })
  test('pago siguiente: los datos del Fee pasan, la seña no', () => {
    const fee = 'Closer: Yamila\nSeña 300 USD\nPIF 1300 USD\nNombre: Nadia Blanco\nTel: +595 975 000001\nmail: nadia.blanco@example.test'
    const t = L.textoPagoSiguiente('Pago 1000 USD\nNombre: Nadia Blanco', fee)
    const a = parsearAlta(t)
    assert.equal(a.estePagoUsd, 1000); assert.equal(a.totalUsd, 1300); assert.equal(a.closer, 'Yamila')
    assert.equal(a.correo, 'nadia.blanco@example.test'); assert.equal(a.telefonos[0].numero, '595975000001')
    assert.doesNotMatch(t, /Seña/)
    assert.equal(t.match(/Nombre:/g).length, 1)
  })
})

describe('cliente que ya está en el CRM (regla A)', () => {
  const CLIENTES = [
    { id: 'A001', nombre: 'Nadia Blanco', celular: '+595 975 000001', mail: 'otra@x.com', estado: 'ACTIVO' },
    { id: 'A002', nombre: 'Juan Pérez', celular: '11 3000 1111', mail: 'juan@x.com', estado: 'FINALIZADO' },
    { id: 'A003', nombre: 'Lucía Benítez', celular: '', mail: 'lucia@x.com', estado: 'PAUSADO' },
  ]
  test('por teléfono, correo o nombre; un FINALIZADO vuelve como cliente nuevo', () => {
    assert.deepEqual(L.buscarClienteEnCrm(CLIENTES, { nombre: 'N. B.', telefono: '595975000001', correo: null }), { id: 'A001', nombre: 'Nadia Blanco', estado: 'ACTIVO', motivo: 'teléfono' })
    assert.equal(L.buscarClienteEnCrm(CLIENTES, { nombre: null, telefono: null, correo: 'LUCIA@x.com' }).id, 'A003')
    assert.equal(L.buscarClienteEnCrm(CLIENTES, { nombre: 'Nadia Blancó', telefono: null, correo: null }).motivo, 'nombre')
    assert.equal(L.buscarClienteEnCrm(CLIENTES, { nombre: 'Juan Pérez', telefono: '5491130001111', correo: 'juan@x.com' }), null)
    assert.equal(L.buscarClienteEnCrm(CLIENTES, { nombre: 'Ana Gómez', telefono: '5491199998888', correo: 'ana@x.com' }), null)
  })
})

describe('textos para Verificaciones C.J', () => {
  test('"¿Esto es un alta? Nadia Blanco · closer Yamila · PIF 1299 USD" y cómo responder', () => {
    const t = L.textoConfirmarAltaLibre({ nombre: 'Nadia Blanco', closer: 'Yamila', pago: L.resumenPago(parsearAlta(NADIA)) })
    assert.match(t, /^¿Esto es un alta\? Nadia Blanco · closer Yamila · PIF 1299 USD\n/)
    assert.match(t, /Respondé citando este mensaje: OK \/ NO$/)
  })
  test('Fee, cliente existente y primera cuota completa', () => {
    assert.match(L.textoConfirmarFeeLibre({ nombre: 'Nadia Blanco', closer: 'Yamila', usd: 300 }), /^💰 Fee de Nadia Blanco \(300 USD, closer Yamila\)\. ¿Lo cargo en Finanzas y creo la comunidad\?/)
    assert.match(L.textoConfirmarPagoCliente({ nombre: 'Nadia Blanco', closer: 'Yamila', usd: 1000, cliente: { id: 'A001', estado: 'ACTIVO', motivo: 'teléfono' } }), /ya está en el CRM de Clientes \(A001, ACTIVO, por teléfono\): no es un alta, es un pago de 1000 USD/)
    assert.match(L.textoCompletoPrimeraCuota({ nombre: 'Nadia Blanco', pagos: [300, 1000], total: 1300, primeraCuota: 1300 }), /^Nadia Blanco completó la primera cuota \(300 \+ 1000 = 1300 USD\)\. ¿Sigo con el alta completa\?/)
    assert.match(L.textoCompletoPrimeraCuota({ nombre: 'Nadia Blanco', pagos: [300, 300], total: 600, primeraCuota: null }), /no sé de cuánto es la primera cuota/)
  })
})

describe('webhook (clasificación)', () => {
  const GRUPOS = { ventas: '120363000000000001@g.us', verificaciones: '120363000000000002@g.us' }
  const T = Date.parse('2026-10-26T19:31:00Z')
  const msj = (over) => W.normalizarMensaje({ id: `m${Math.random()}`, type: 'text', chat_id: GRUPOS.ventas, from_me: false, timestamp: Math.floor(T / 1000), from: '595981000001', from_name: 'Yam Capital Jurídico', ...over })
  test('texto libre sin citar → EventoAlta con libre: true', () => {
    const c = W.clasificar(msj({ text: { body: NADIA } }), GRUPOS, T)
    assert.equal(c.evento.tipo, 'alta'); assert.equal(c.evento.libre, true); assert.equal(c.evento.texto, NADIA); assert.deepEqual(c.evento.medios, [])
  })
  test('citando un mensaje sigue siendo una respuesta (puede ser un pedido del bot)', () => {
    const c = W.clasificar(msj({ text: { body: NADIA }, context: { quoted_id: 'bot-1', quoted_author: '5490000' } }), GRUPOS, T)
    assert.equal(c.evento.tipo, 'respuesta')
  })
  test('como pie de un PDF → alta libre con el medio; la charla se descarta; el #ALTA sigue igual', () => {
    const c = W.clasificar(msj({ type: 'document', document: { id: 'doc-1', mime_type: 'application/pdf', file_name: 'comprobante_payment.pdf', caption: NADIA } }), GRUPOS, T)
    assert.equal(c.evento.tipo, 'alta'); assert.equal(c.evento.libre, true); assert.equal(c.evento.medios[0].id, 'doc-1')
    assert.deepEqual(W.clasificar(msj({ text: { body: 'son 800 usd que entraron hoy y mañana 1800 para completar' } }), GRUPOS, T), { descarte: 'charla' })
    const alta = W.clasificar(msj({ text: { body: `#ALTA\n${NADIA}` } }), GRUPOS, T)
    assert.equal(alta.evento.tipo, 'alta'); assert.equal(alta.evento.libre, undefined)
  })
  test('el documento suelto del mismo autor sigue siendo un adjunto', () => {
    const c = W.clasificar(msj({ type: 'document', document: { id: 'doc-2', mime_type: 'application/pdf', file_name: 'dLocal Go - Checkout.pdf' } }), GRUPOS, T)
    assert.equal(c.evento.tipo, 'adjunto')
  })
})

describe('el comprobante manda cuando no contradice al mensaje (4/11/2026)', () => {
  const lect = (o) => ({ es_comprobante: true, legible: 'si', monto_texto: '', moneda: 'USD', moneda_iso: '', fecha: '2026-11-04', numero_operacion: 'OP-9', destinatario: 'ACTIS GERONIMO', ordenante: '', medio: '', notas: '', ...o })
  const DARC = 'Closer: Nahuel\nTipo de pago: Completa 1er cuota $360\n( FEE de $300 pagado en efectivo )\nNombre completo del lead: María Laura D’Arcangelo.\nTeléfono: +54 9 11 5509-8826'
  test('D\'Arcangelo: si el mensaje dice 300 y el comprobante 360, frena y el aviso dice qué carga el OK; «completó 1ra» = 1ra Cuota', () => {
    const a = parsearAlta(DARC)
    const r = C.compararComprobante(lect({ monto_texto: 'u$s 360.00' }), a, { hoy: '2026-11-04' })
    assert.equal(r.resultado, 'difiere')
    assert.equal(r.extras.usdComprobante, undefined)
    for (const t of [DARC, 'completó la 1era cuota', 'Completó 1er cuota $360', 'Completa 1ra', 'completa la primera cuota']) assert.equal(FIN.completaPrimeraCuota(t), true, t)
    for (const t of ['Ingresa pago - 2º cuota 825', 'Completa pago PIF', 'completa 10 cuotas']) assert.equal(FIN.completaPrimeraCuota(t), false, t)
  })
  test('Lia Parra: el mensaje no trae monto → se toma el del comprobante (antes frenaba sin cargar)', () => {
    const LIA = 'Closer: Marcos\nTipo de pago: PP $3300\nNombre completo del lead: Lia Karina Parra\nTeléfono: +54 9 11 6173-8900'
    const a = parsearAlta(LIA)
    const r = C.compararComprobante(lect({ monto_texto: 'US$ 300' }), a, { hoy: '2026-11-04', texto: LIA })
    assert.equal(r.extras.usdComprobante, 300)
    const f = FIN.filaRegistroPagos(a, { fecha: '2026-11-04', setter: 'Mai', fuente: 'Webinar', cuenta: 'Gero', usdComprobante: 300 })
    assert.equal(f.celdas.E, 300)
    assert.ok(!f.pendientes.some((x) => x.startsWith('Efectivo recaudado')))
  })
  test('si de verdad no coinciden, frena y el aviso dice qué carga el OK; no usa el del comprobante', () => {
    const T = 'Closer: Marcos\nEste pago: 1100 USD\nNombre: Ana Pérez\nTel: +54 9 11 3000 1111'
    const a = parsearAlta(T)
    const r = C.compararComprobante(lect({ monto_texto: '900' }), a, { hoy: '2026-11-04', texto: T })
    assert.equal(r.resultado, 'difiere')
    assert.match(r.diferencias[0], /con OK se carga USD 1\.100/)
    assert.equal(r.extras.usdComprobante, undefined)
  })
  test('closer en la lista de la col G: «Yamila» → «Yami» (Nancy Báez frenada el 26/10)', () => {
    assert.equal(FIN.closerPlanilla('Yamila'), 'Yami')
    assert.equal(FIN.closerPlanilla('Nahuel'), 'Nahuel')
    assert.equal(FIN.closerPlanilla(null), '')
  })
  test('si el mensaje trae monto, manda el mensaje aunque el comprobante difiera por una comisión (umbral del Fee)', () => {
    const T = 'Closer: Marcos\nEste pago: 497 USD\nNombre: Ana Pérez\nTel: +54 9 11 3000 1111'
    const r = C.compararComprobante(lect({ monto_texto: 'USD 500' }), parsearAlta(T), { hoy: '2026-11-04' })
    assert.equal(r.extras.usdComprobante, undefined)
  })
  test('con varios comprobantes, el monto del primero no reemplaza al del mensaje (sería una parte)', () => {
    const T = 'Closer: Marcos\nNombre: Ana Pérez\nTel: +54 9 11 3000 1111'
    const r = C.compararComprobante(lect({ monto_texto: 'USD 200' }), parsearAlta(T), { hoy: '2026-11-04', archivos: 2 })
    assert.equal(r.extras.usdComprobante, undefined)
  })
})

describe('columna O: las cuotas son Payment Plan (Tomás, 4/11/2026)', () => {
  test('regla: cuota → Payment Plan; PIF → Upfront; Fee según el programa; sin decidir → null', () => {
    assert.equal(FIN.tipoPagoDe('2da Cuota', ''), 'Payment Plan')
    assert.equal(FIN.tipoPagoDe('1ra Cuota', 'DFY | PIF | $2600'), 'Payment Plan')
    assert.equal(FIN.tipoPagoDe('PIF', 'DFY | PIF | $2600'), 'Upfront')
    assert.equal(FIN.tipoPagoDe('PIF', 'DFY | PP | $3300'), null)
    assert.equal(FIN.tipoPagoDe('Fee', 'DFY | PP | $3300'), 'Payment Plan')
    assert.equal(FIN.tipoPagoDe('Fee', 'DFY | PIF | $2400'), 'Upfront')
    assert.equal(FIN.tipoPagoDe('Fee', ''), null)
    assert.equal(FIN.tipoPagoDe('Renovación', 'DFY+R | PP | $3400'), null)
  })
  test('pago de cliente: la 2da cuota va Payment Plan aunque sus pagos anteriores digan Upfront (Adriana/Leandro, 4/11)', () => {
    const a = parsearAlta('Closer: Carlos\nIngresa pago - 2º cuota 825 USD\nNombre: Leandro Arabia\nTel: +54 351 512-1372')
    const f = FIN.filaRegistroPagos(a, { fecha: '2026-11-04', setter: 'Tomi / Gero', fuente: 'BIO Página Web', cuenta: 'Empresa' })
    f.celdas.J = '2da Cuota'
    FIN.ajustarFilaPagoCliente(f, { nombre: a.nombre, concepto: '2da Cuota', programa: null, tipoPago: 'Upfront' })
    assert.equal(f.celdas.O, 'Payment Plan')
    assert.equal(f.fila[14], 'Payment Plan')
  })
  test('fijarTipoPago: Fee de un plan PP pasa a Payment Plan y la fila queda alineada', () => {
    const a = parsearAlta('#ALTA\nCloser: Yami\nNombre: Noelia Vera\nTel: +54 9 11 3000 2222\nEste pago: 300 USD')
    const f = FIN.filaRegistroPagos(a, { fecha: '2026-11-02', setter: 'Tomi / Gero', fuente: 'VSL Funnel', cuenta: 'Empresa' })
    f.celdas.B = 'DFY | PP | $3300'; f.celdas.J = 'Fee'; f.celdas.O = 'Upfront'
    f.fila = FIN.COLUMNAS_REGISTRO.map(({ col }) => f.celdas[col])
    FIN.fijarTipoPago(f)
    assert.equal(f.celdas.O, 'Payment Plan')
    assert.equal(f.fila[14], 'Payment Plan')
    f.celdas.B = 'DFY | PIF | $2600'; FIN.fijarTipoPago(f)
    assert.equal(f.celdas.O, 'Upfront')
    assert.equal(f.fila[14], 'Upfront')
  })
})

describe('pago de un cliente existente: qué cuota es (Tomás, 26/10/2026)', () => {
  test('cuenta las cuotas y PIF del mismo cliente (nombre o teléfono) en el Registro; los Fee no; como mínimo la 2da', () => {
    const filas = [
      [46300, 'DFY | PP | $3900', 'Nadia Blancó', '595 975 000001', 1300, '', 'Yamila', 'Mai', 'Nadia Blanco - PP 1/3', '1ra Cuota'],
      [46301, 'Fee', 'Nadia Blanco', '', 300, '', 'Yamila', 'Mai', 'Nadia Blanco - Fee', 'Fee'],
      [46330, 'DFY | PP | $3900', 'N. Blanco', '+595975000001', 1300, '', 'Yamila', 'Mai', '', '2da Cuota'],
      [46331, 'DFY | PP | $3300', 'Ana Pérez', '5491130001111', 1100, '', 'Marcos', 'Mai', '', '1ra Cuota'],
    ]
    const n = FIN.cuotasAnterioresEn(filas, { nombre: 'Nadia Blanco', telefono: '595975000001' })
    assert.equal(n, 2)
    assert.equal(FIN.conceptoPagoCliente(n), '3ra Cuota')
    assert.equal(FIN.conceptoPagoCliente(0), '2da Cuota')
    assert.equal(FIN.conceptoPagoCliente(1), '2da Cuota')
    assert.equal(FIN.conceptoCuota(4), '4ta Cuota')
    assert.equal(FIN.conceptoCuota(13), 'Cuota 13')
  })

  test('historial: programa (B) y tipo de pago (O) del pago más NUEVO (arriba en el Registro), sin renovaciones ni homónimos (4/11/2026)', () => {
    // Como en la planilla: el pago más nuevo en la fila 2 (arriba)
    const filas = [
      [46340, 'DFY+R | PP | $3400', 'Nadia Blanco', '595975000001', 1300, '', 'Yamila', 'Mai', '', 'Renovación', '', '', '', 'Back-end', 'Payment Plan'],
      [46330, '', 'Nadia Blanco', '595975000001', 1300, '', 'Yamila', 'Mai', '', '2da Cuota', '', '', '', 'Front-end', ''],
      [46320, 'DFY | PP | $3300', 'Nadia Blanco', '5491100000000', 1100, '', 'Marcos', 'Mai', '', '1ra Cuota', '', '', '', 'Front-end', 'Upfront'],
      [46300, 'DFY | PP | $3900', 'Nadia Blanco', '595975000001', 1300, '', 'Yamila', 'Mai', '', '1ra Cuota', '', '', '', 'Front-end', 'Payment Plan'],
      [46290, 'DFY | PIF | $2600', 'Nadia Blanco', '595975000001', 300, '', 'Yamila', 'Mai', '', 'Fee', '', '', '', 'Front-end', 'Upfront'],
    ]
    // La homónima de otro teléfono (fila 46320) y la renovación no cuentan; manda el pago más nuevo con dato (46300)
    assert.deepEqual(FIN.historialClienteEn(filas, { nombre: 'Nadia Blanco', telefono: '595975000001' }), { cuotas: 2, programa: 'DFY | PP | $3900', tipoPago: 'Payment Plan' })
    // Sin teléfono, por nombre (todas las filas de ese nombre)
    assert.equal(FIN.historialClienteEn(filas, { nombre: 'Nadia Blanco', telefono: null }).programa, 'DFY | PP | $3300')
    assert.deepEqual(FIN.historialClienteEn(filas, { nombre: 'Nadie', telefono: null }), { cuotas: 0, programa: null, tipoPago: null })
  })

  test('fila de un pago de cliente: sin pedir programa ni plan, col I con la cuota, B del historial o vacío con aviso (4/11/2026)', () => {
    // "2º cuota 825" sin USD ni plan (Leandro Arabia, 4/11): antes frenaba con "Programa: falta el tipo de pago"
    const a = parsearAlta('Closer: Carlos\nIngresa pago - 2º cuota 825\nNombre: Leandro Arabia\nTel: +54 351 512-1372')
    const extras = { fecha: '2026-11-04', pesosArs: 1291331, mepDiaAnterior: 1579.9, setter: 'Tomi / Gero', fuente: 'BIO Página Web', destinatario: 'Diaz Rangel Rosanthony' }
    const f1 = FIN.filaRegistroPagos(a, extras)
    assert.ok(f1.pendientes.some((x) => x.startsWith('Programa:')))
    FIN.ajustarFilaPagoCliente(f1, { nombre: a.nombre, concepto: '2da Cuota', programa: null, tipoPago: 'Upfront' })
    assert.deepEqual(f1.pendientes, [])
    assert.equal(f1.celdas.I, 'Leandro Arabia - 2da Cuota')
    assert.equal(f1.fila[8], 'Leandro Arabia - 2da Cuota')
    assert.equal(f1.celdas.O, 'Payment Plan')   // una cuota es Payment Plan aunque el historial diga Upfront (4/11)
    assert.equal(f1.celdas.E, 817.35)
    assert.ok(f1.avisos.some((x) => x.startsWith('Programa (col B) vacío')))
    // PIF con plan (Adriana De Feo, 4/11): el programa del historial manda y no se pide nada del plan
    const b = parsearAlta('Closer: Carlos\nCompleta Pago PIF\nPago 3: 400 usd\nNombre: Adriana De Feo\nTel: +54 341 596-3816')
    const f2 = FIN.filaRegistroPagos(b, { fecha: '2026-11-03', setter: 'Tomi / Gero', fuente: 'Webinar', cuenta: 'Empresa' })
    FIN.ajustarFilaPagoCliente(f2, { nombre: b.nombre, concepto: '3ra Cuota', programa: 'DFY | PIF | $2600', tipoPago: 'Upfront' })
    assert.ok(!f2.pendientes.some((x) => /^(Programa|Cuotas del plan)/.test(x)), f2.pendientes.join(' | '))
    assert.equal(f2.celdas.B, 'DFY | PIF | $2600')
    assert.equal(f2.fila[1], 'DFY | PIF | $2600')
    assert.ok(!f2.avisos.some((x) => x.startsWith('Programa (col B) vacío')))
    // Plan escrito por el closer ("PP … total 3300"): B y O salen igual del pago anterior, coherentes, sin avisos del plan
    const c = parsearAlta('Closer: Carlos\nIngresa pago PP 2/3 de 1100 usd, total 3300\nNombre: Ana Pérez\nTel: +54 9 11 3000 1111')
    const f3 = FIN.filaRegistroPagos(c, { fecha: '2026-11-03', setter: 'Mai', fuente: 'Webinar', cuenta: 'Tomi' })
    FIN.ajustarFilaPagoCliente(f3, { nombre: c.nombre, concepto: '2da Cuota', programa: 'DFY | PIF | $2600', tipoPago: 'Upfront' })
    assert.equal(f3.celdas.B, 'DFY | PIF | $2600')
    assert.equal(f3.celdas.O, 'Payment Plan')
    assert.ok(!f3.avisos.some((x) => /^(El programa "|El closer declaró )/.test(x)), f3.avisos.join(' | '))
    assert.ok(!f3.pendientes.some((x) => /^(Programa|Cuotas del plan)/.test(x)), f3.pendientes.join(' | '))
    // Sin programa anterior: B vacío (nunca el armado con el texto del closer), con aviso
    FIN.ajustarFilaPagoCliente(f3, { nombre: c.nombre, concepto: '2da Cuota', programa: null, tipoPago: null })
    assert.equal(f3.celdas.B, '')
    assert.equal(f3.celdas.O, 'Payment Plan')
    // Programa viejo fuera de la lista de la col B: vacío con aviso (si no, la lista estricta frena la carga)
    FIN.ajustarFilaPagoCliente(f3, { nombre: c.nombre, concepto: '2da Cuota', programa: 'DFY | PP | $9999', tipoPago: 'Payment Plan' })
    assert.equal(f3.celdas.B, '')
    assert.ok(f3.avisos.some((x) => x.includes('no está en la lista de la columna B')))
  })
})
