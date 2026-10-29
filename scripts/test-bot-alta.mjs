// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-alta.mjs
// Parser del mensaje de alta del bot "Capital Jurídico" (docs/BOT-ALTA-CJ.md). Los casos copian el FORMATO de
// mensajes reales de "Ventas C.J." (19–21/10/2026) con datos INVENTADOS: nombres genéricos, teléfonos 54 9 11 3000-xxxx,
// DNI/CUIT de fantasía y direcciones "Calle N …". Nunca pegar datos de la planilla ni de los chats.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsearAlta, monto, fecha, telefonos, leerSocios, esSocioSkool, esContinuacionSocios, sinSocios } from '../lib/bot/alta/parsear.ts'

test('formato nuevo #ALTA completo', () => {
  const r = parsearAlta(`#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Juan Pérez
Teléfono: +54 9 11 3000-1111
Correo: Juan.Perez@example.test
Socios:
Ana Gómez · +54 9 11 3000-2222 · Ana.Gomez@example.test
Dirección: Calle 1 123, Mar del Plata
DNI: 30.111.222
CUIT: 20-30111222-3
Inicio del servicio: 19/10/2026
Cuotas:
19/11/2026 1100
19/12/2026 1100`)
  assert.equal(r.etiquetaAlta, true)
  assert.equal(r.closer, 'Marcos')
  assert.equal(r.modalidad, 'PP')
  assert.equal(r.totalUsd, 3300)
  assert.equal(r.estePagoUsd, 1100)
  assert.equal(r.medioPago, 'Transferencia USD (Galicia)')
  assert.deepEqual(r.telefonos.map(t => t.numero), ['5491130001111', '5491130002222'])
  assert.equal(r.correo, 'juan.perez@example.test')
  assert.deepEqual(leerSocios(r.socios), [{ nombre: 'Ana Gómez', telefono: '5491130002222', correo: 'ana.gomez@example.test' }])
  assert.equal(r.dni, '30111222')
  assert.equal(r.cuit, '20-30111222-3')
  assert.equal(r.inicio, '2026-10-19')
  assert.equal(r.cuotas.length, 2)
  assert.deepEqual(r.faltantes, [])
  assert.deepEqual(r.avisos, [])
})

test('formato de antes con cronograma ✅/⏳', () => {
  const r = parsearAlta(`Tipo de pago:  PP $3300
Nombre completo del lead: Juan Pérez
Teléfono y de los socios: +54 9 11 3000-1111
Correo principal: juan@example.test
Dirección: Calle 2 456 mar del plata
DNI :  30.111.222
CUIT :  20 30.111.222 3
Fecha de inicio del servicio: 19/10/2026

19/10/2026: inicio $1100 ✅
19/11/2026 cuota $1100⏳
19/12/2026 finaliza pago $1100⏳`)
  assert.equal(r.etiquetaAlta, false)
  assert.equal(r.totalUsd, 3300)
  assert.equal(r.estePagoUsd, 1100)
  assert.equal(r.cuit, '20-30111222-3')
  assert.deepEqual(r.cuotas.map(c => c.pagada), [true, false, false])
  assert.deepEqual(r.faltantes, [])
  assert.deepEqual(r.avisos, [])
})

test('cliente del exterior sin DNI/CUIT: no los pide; cuotas desparejas que suman el total', () => {
  const r = parsearAlta(`Tipo de pago:  PP $3300
Nombre completo del lead: María López
Teléfono y de los socios: +1 (849) 000-0000
Correo principal: maria@example.test
Dirección:  Calle 10 500, Santo Domingo

Fecha de inicio del servicio: 19/10/2026

19/10/2026 inicio $1000✅
20/10/2026 cuota $650⏳
19/11/2026 finaliza pag $1650⏳`)
  assert.equal(r.telefonos[0].numero, '18490000000')
  assert.equal(r.estePagoUsd, 1000)
  assert.deepEqual(r.faltantes, [])
  assert.deepEqual(r.avisos, [])
  const mal = parsearAlta('#ALTA\nTipo de pago: PP 3300\nEste pago: 1000 USD\nCuotas:\n19/11/2026 1000')
  assert.match(mal.avisos.join(' '), /cronograma suma 2000 USD y el total dice 3300/)
})

test('pago menor al mínimo y sin cronograma: pide cuotas y avisa', () => {
  const r = parsearAlta(`Tipo de pago: PP $3300
Nombre completo del lead: Pedro Ruiz
Teléfono y de los socios: +54 9 2215 00-1111 pedro  +54 9 2214 00 2222 estudio
Correo principal: pedro@example.test
Dirección: Calle 3 789, La Plata
DNI: 36.000.111
CUIT: 20  36.000.111 4
Fecha de inicio del servicio: 21/10/2026`)
  assert.deepEqual(r.telefonos, [{ numero: '5492215001111', etiqueta: 'pedro' }, { numero: '5492214002222', etiqueta: 'estudio' }])
  assert.ok(r.faltantes.includes('Este pago (monto en USD y medio)'))
  assert.ok(r.faltantes.includes('Cuotas (fecha y monto)'))
  const r2 = parsearAlta('#ALTA\nCloser: Marcos\nTipo de pago: PP 3300\nEste pago: 200 USD · Transferencia')
  assert.ok(r2.avisos.includes('Pago de 200 USD: es un Fee (seña). Se registra en Finanzas y el alta arranca cuando el pago llegue a USD 500'))
  assert.ok(!r2.avisos.some((a) => /OK de Tomi o Gero|menos del mínimo/.test(a)))
  // En pesos el parser no avisa del Fee: lo decide plan.ts con el USD calculado con el MEP
  const r3 = parsearAlta('#ALTA\nCloser: Marcos\nTipo de pago: PP 3300\nEste pago: 200 USD · Mercado Pago (pesos)')
  assert.ok(!r3.avisos.some((a) => /es un Fee/.test(a)))
})

test('formato libre (como Carlos): PIF en efectivo + transferencia', () => {
  const r = parsearAlta(`Ingresa pago PIF 2400 usd efectivo + 200 usd en transferencia en pesos
Juan Pérez
Tel:+54 9 11 3000-1111
mail: juan@example.test
DNI: 30111222
CUIT: 20-30111222-3
Domicilio: Calle 4 1000 2B, CABA`)
  assert.equal(r.nombre, 'Juan Pérez')
  assert.equal(r.modalidad, 'PIF')
  assert.equal(r.totalUsd, 2600)
  assert.equal(r.estePagoUsd, 2600)
  assert.match(r.avisos.join(' '), /2400 \+ 200 = 2600/)
  assert.deepEqual(r.faltantes, ['Inicio del servicio'])
})

test('auxiliares', () => {
  assert.equal(monto('USD 1.100'), 1100)
  assert.equal(monto('$1100,50'), 1100.5)
  assert.equal(monto('1,100.00'), 1100)
  assert.equal(fecha('5/1/26'), '2026-01-05')
  assert.equal(fecha('31/13/2026'), null)
  assert.deepEqual(telefonos('sin teléfono'), [])
})

test('teléfono sin código de país: los argentinos claros se completan con 549; si no, se le pide al closer', () => {
  const num = (t) => parsearAlta(`#ALTA\nTeléfono: ${t}`).telefonos[0].numero
  assert.equal(num('11 3000-5555'), '5491130005555')
  assert.equal(num('011 3000-5555'), '5491130005555')
  assert.equal(num('11 15 3000-5555'), '5491130005555')
  assert.equal(num('0223 15 500-1111'), '5492235001111')
  assert.equal(num('2235001111'), '5492235001111')
  assert.equal(num('0054 9 11 3000-5555'), '5491130005555')
  assert.equal(num('54 9 11 3000-5555'), '5491130005555')
  assert.equal(num('+1 (849) 000-0000'), '18490000000')
  const ar = parsearAlta('#ALTA\nTeléfono: 11 3000-5555')
  assert.ok(ar.faltantes.includes('DNI'))   // ahora se sabe que es argentino
  const dudoso = parsearAlta('#ALTA\nTeléfono: 15 3000-1111')
  assert.equal(dudoso.telefonos[0].numero, '1530001111')
  assert.ok(dudoso.faltantes.includes('Teléfono con código de país (ej. +54 9 11 …)'))
})

test('este pago en pesos: un monto en ARS no se toma como USD', () => {
  const ars = parsearAlta('#ALTA\nTipo de pago: PP 3300 USD\nEste pago: $3.500.000 ARS (Mercado Pago)')
  assert.equal(ars.estePagoUsd, null)
  assert.deepEqual(ars.pagoEnPesos, { ars: 3500000, usdDelCloser: null, usdAparte: 0 })
  assert.ok(!ars.faltantes.includes('Este pago (monto en USD y medio)'))   // el USD sale del MEP
  const mp = parsearAlta('#ALTA\nTipo de pago: PIF 2400 USD\nEste pago: 2400 USD MP pesos')
  assert.equal(mp.medioPago, null)
  assert.deepEqual(mp.pagoEnPesos, { ars: null, usdDelCloser: 2400, usdAparte: 0 })
  const usd = parsearAlta('#ALTA\nTipo de pago: PP 3300 USD\nEste pago: 1100 USD · Transferencia USD (Galicia)')
  assert.equal(usd.pagoEnPesos, null)
  const libre = parsearAlta('Ingresa pago PIF 2400 usd efectivo + 200 usd en transferencia en pesos\nJuan Pérez')
  assert.deepEqual(libre.pagoEnPesos, { ars: null, usdDelCloser: 200, usdAparte: 2400 })
  // Más de 6 cifras sin decir USD: son pesos (no van a E como USD) y se avisa para confirmar con el comprobante
  const mucho = parsearAlta('#ALTA\nTipo de pago: PIF 2400 USD\nEste pago: 3500000 · Transferencia')
  assert.deepEqual(mucho.pagoEnPesos, { ars: 3500000, usdDelCloser: 2400, usdAparte: 0 })   // PIF: el closer dijo el total
  assert.match(mucho.avisos.join(' '), /trae 3\.500\.000 sin decir la moneda: por la cantidad de cifras se toma como pesos/)
  assert.ok(!mucho.avisos.some((a) => /más que el total/.test(a)))
  // En USD explícito y más que el total: avisa
  const usdDeMas = parsearAlta('#ALTA\nTipo de pago: PIF 2400 USD\nEste pago: 3000 USD · Transferencia')
  assert.match(usdDeMas.avisos.join(' '), /es más que el total .*¿el monto está en pesos\?/)
})

test('contrato: normal por defecto, garantía si lo dice, y tokens de PandaDoc', async () => {
  const { datosContrato, DIRECCION_ARGENTINA } = await import('../lib/bot/alta/contrato.ts')
  const base = '#ALTA\nCloser: Marcos\nNombre completo: Juan Manuel Pérez\nTeléfono: +54 9 11 3000-1111\nCorreo: juan@example.test\nDirección: Calle 1 123\nDNI: 30111222\nInicio del servicio: 19/10/2026'
  assert.equal(parsearAlta(base).contrato, 'normal')
  assert.equal(parsearAlta(base + '\nContrato: Garantía').contrato, 'garantia')
  const c = datosContrato(parsearAlta(base))
  const tok = Object.fromEntries(c.tokens.map(t => [t.name, t.value]))
  assert.equal(tok['Client.FirstName'], 'Juan Manuel')
  assert.equal(tok['Client.LastName'], 'Pérez')
  assert.equal(tok['Fecha de Inicio'], '19/10/2026')
  assert.equal(tok['TU DIRECCIÓN EN ARGENTINA'], DIRECCION_ARGENTINA)
  assert.equal(tok['Client.Country'], 'Argentina')
  // "Calle 1 123" no dice ciudad ni provincia: StreetAddress lleva la calle y se le piden al closer
  assert.equal(tok['Client.StreetAddress'], 'Calle 1 123')
  assert.equal(tok['Client.City'], '')
  assert.deepEqual(c.faltantes, ['Ciudad y provincia del cliente'])
  const conCiudad = datosContrato(parsearAlta(base.replace('Calle 1 123', 'Calle 1 123, Mar del Plata')))
  const tc = Object.fromEntries(conCiudad.tokens.map(t => [t.name, t.value]))
  assert.deepEqual([tc['Client.StreetAddress'], tc['Client.City'], tc['Client.State']], ['Calle 1 123', 'Mar del Plata', 'Buenos Aires'])
  assert.deepEqual(conCiudad.faltantes, [])
  assert.deepEqual(datosContrato(parsearAlta('Nombre completo: Juan')).faltantes.slice(0, 2), ['Apellido', 'Correo'])
})

// ── Finanzas: fila de "Registro de Pagos" (lib/bot/alta/finanzas.ts). Datos inventados. ──────────────────
const { filaRegistroPagos, cuentaPorMedio, telefonoPlanilla, fechaPlanilla, serialPlanilla, programaPlanilla, COLUMNAS_REGISTRO, OPCIONES_CUENTA, usdDesdePesos, fechaDiaAnterior, esPagoFee } = await import('../lib/bot/alta/finanzas.ts')
const { ymdASerial } = await import('../lib/clientes/fechas.ts')
const { planDeAlta, estadoAlta, respuestaAlCloser, LINK_SKOOL } = await import('../lib/bot/alta/plan.ts')

const ALTA_PP = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Juan Pérez
Teléfono: +54 9 11 3000-1111
Correo: juan@example.test
Dirección: Calle 1 123
DNI: 30111222
CUIT: 20-30111222-3
Inicio del servicio: 19/10/2026
Cuotas:
19/11/2026 1100
19/12/2026 1100`

test('finanzas: PP con cuotas → DFY | PP | $3300, 1ra Cuota, PP 1/3, Payment Plan', () => {
  const f = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Tomi' })
  assert.equal(f.celdas.A, 46318)   // serial de Sheets del 23/10/2026
  assert.equal(f.fechaTexto, '10/23/2026')
  assert.equal(f.fechaLegible, '23/10/2026')
  assert.equal(f.celdas.B, 'DFY | PP | $3300')
  assert.equal(f.celdas.C, 'Juan Pérez')
  assert.equal(f.celdas.D, '54 9 11 3000-1111')
  assert.equal(f.celdas.E, 1100)
  assert.equal(f.celdas.F, '')
  assert.equal(f.celdas.G, 'Marcos')
  assert.equal(f.celdas.H, 'Mai')
  assert.equal(f.celdas.I, 'Juan Pérez - PP 1/3')
  assert.equal(f.celdas.J, '1ra Cuota')
  assert.equal(f.celdas.K, 'Inbound IG')
  assert.equal(f.celdas.M, '=IF(A2="";""; TEXT(A2; "yyyy-mmmm"))')
  assert.equal(f.celdas.N, 'Front-end')
  assert.equal(f.celdas.O, 'Payment Plan')
  assert.equal(f.celdas.R, 'Tomi')
  assert.equal(f.celdas.P, null)   // categoría vieja: no se toca
  assert.equal(f.celdas.Q, null)
  assert.equal(f.fila.length, 18)
  assert.deepEqual(f.fila, COLUMNAS_REGISTRO.map(c => f.celdas[c.col]))
  assert.deepEqual(f.pendientes, [])
  assert.deepEqual(f.avisos, [])
  // Formato de antes: la cuota ✅ es este pago; quedan 2 pendientes → también PP 1/3
  const viejo = parsearAlta('Tipo de pago: PP $3300\nNombre completo del lead: Juan Pérez\n19/10/2026: inicio $1100 ✅\n19/11/2026 cuota $1100⏳\n19/12/2026 finaliza pago $1100⏳')
  assert.equal(filaRegistroPagos(viejo, { fecha: '2026-10-23' }).celdas.I, 'Juan Pérez - PP 1/3')
})

test('finanzas: PIF → DFY | PIF | $2600, PIF, Upfront; pago en pesos: E = pesos ÷ MEP + lo pagado aparte en USD', () => {
  const a = parsearAlta('Ingresa pago PIF 2400 usd efectivo + 200 usd en transferencia en pesos\nJuan Pérez\nTel:+54 9 11 3000-1111')
  const f = filaRegistroPagos(a, { fecha: '2026-10-23' })
  assert.equal(f.celdas.B, 'DFY | PIF | $2600')
  assert.equal(f.celdas.J, 'PIF')
  assert.equal(f.celdas.I, 'Juan Pérez - PIF')
  assert.equal(f.celdas.O, 'Upfront')
  assert.equal(f.celdas.E, '')   // sin pesos ni cotización no se usa el USD del closer
  assert.ok(f.pendientes.includes('Monto en pesos del comprobante'))
  assert.ok(f.pendientes.some((p) => p.startsWith('Dólar MEP del día anterior')))
  const sinMep = filaRegistroPagos(a, { fecha: '2026-10-23', pesosArs: 310000 })
  assert.equal(sinMep.celdas.F, 310000)
  assert.equal(sinMep.celdas.E, '')
  assert.ok(!sinMep.pendientes.includes('Monto en pesos del comprobante'))
  const conMep = filaRegistroPagos(a, { fecha: '2026-10-23', pesosArs: 310000, mepDiaAnterior: 1550 })
  assert.equal(conMep.celdas.E, 2600)   // 2400 en efectivo + 310.000 / 1550
  assert.ok(!conMep.pendientes.some((p) => /MEP/.test(p)))
  assert.deepEqual(conMep.avisos, ['USD calculado con MEP 1.550 del 22/10'])   // informativo: MEP del día anterior
  // Todo en pesos, con monto en ARS: E sale solo de la conversión; si no coincide con lo que dijo el closer, avisa
  const ars = parsearAlta('#ALTA\nNombre completo: Juan Pérez\nTipo de pago: PIF 2400 USD\nEste pago: $3.720.000 ARS (Mercado Pago)')
  const fa = filaRegistroPagos(ars, { fecha: '2026-10-23', pesosArs: 3720000, mepDiaAnterior: 1550 })
  assert.equal(fa.celdas.E, 2400)
  assert.equal(fa.celdas.F, 3720000)
  assert.deepEqual(fa.avisos, ['USD calculado con MEP 1.550 del 22/10'])
  const otroMep = filaRegistroPagos(ars, { fecha: '2026-10-23', pesosArs: 3720000, mepDiaAnterior: 1700 })
  assert.match(otroMep.avisos.join(' '), /el closer puso 2\.400 USD: revisar/)
  const distinto = filaRegistroPagos(ars, { fecha: '2026-10-23', pesosArs: 3000000, mepDiaAnterior: 1250 })
  assert.match(distinto.avisos.join(' '), /El closer escribió \$3\.720\.000 y el comprobante dice \$3\.000\.000/)
  // "MP pesos" sin separador también pide el monto en pesos
  const mp = filaRegistroPagos(parsearAlta('#ALTA\nTipo de pago: PIF 2400 USD\nEste pago: 2400 USD MP pesos'), { fecha: '2026-10-23' })
  assert.ok(mp.pendientes.includes('Monto en pesos del comprobante'))
})

test('finanzas: pago de menos de USD 500 → Fee (el alta no arranca)', () => {
  const t = '#ALTA\nCloser: Marcos\nNombre completo: Juan Pérez\nTeléfono: +54 9 11 3000-1111\nTipo de pago: PP 3300 USD\nEste pago: 300 USD · Transferencia\nCuotas:\n19/11/2026 1500\n19/12/2026 1500'
  const f = filaRegistroPagos(parsearAlta(t), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Tomi' })
  assert.equal(f.celdas.J, 'Fee')
  assert.equal(f.celdas.I, 'Juan Pérez - Fee')
  assert.match(f.avisos.join(' '), /Fee: .*El alta no arranca hasta llegar a USD 500/)
  const pif = filaRegistroPagos(parsearAlta('#ALTA\nNombre completo: Juan Pérez\nTipo de pago: PIF 2400 USD\nEste pago: 200 USD'), { fecha: '2026-10-23' })
  assert.equal(pif.celdas.J, 'Fee')
  // En pesos: decide el USD de la conversión
  const pesos = parsearAlta('#ALTA\nNombre completo: Juan Pérez\nTipo de pago: PP 3300 USD\nEste pago: $465.000 ARS (Mercado Pago)\nCuotas:\n19/11/2026 1500')
  assert.equal(filaRegistroPagos(pesos, { fecha: '2026-10-23', pesosArs: 465000, mepDiaAnterior: 1550 }).celdas.J, 'Fee')
  assert.equal(esPagoFee(pesos, { pesosArs: 465000, mepDiaAnterior: 1550 }), true)   // 300 USD
  assert.equal(esPagoFee(pesos, { pesosArs: 930000, mepDiaAnterior: 1550 }), false)  // 600 USD
  assert.equal(filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23' }).celdas.J, '1ra Cuota')
})

test('finanzas: PP 1/n que no cierra con el total y nombre de una sola palabra', () => {
  const t = '#ALTA\nCloser: Marcos\nNombre completo: Juan Pérez\nTeléfono: +54 9 11 3000-1111\nTipo de pago: PP 3300 USD\nEste pago: 1100 USD · Transferencia\nCuotas:\n23/10/2026 1100\n19/11/2026 1100\n19/12/2026 1100'
  const f = filaRegistroPagos(parsearAlta(t), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Tomi' })
  assert.equal(f.celdas.I, 'Juan Pérez - PP 1/4')
  assert.match(f.avisos.join(' '), /PP 1\/4, pero este pago \+ las cuotas pendientes suman 4\.400 USD y el total es 3\.300 USD/)
  const juan = filaRegistroPagos(parsearAlta('#ALTA\nCloser: Marcos\nNombre completo: Juan\nTipo de pago: PIF 2400 USD\nTeléfono: +54 9 11 3000-1111'), { fecha: '2026-10-23' })
  assert.ok(juan.pendientes.includes('Nombre completo con una sola palabra: pedir el apellido'))
})

test('finanzas: programa fuera de la lista → se arma igual y avisa; $6.000 con punto como en la lista', () => {
  const fuera = filaRegistroPagos(parsearAlta('#ALTA\nTipo de pago: PP 3500 USD\nEste pago: 1000 USD'), { fecha: '2026-10-23' })
  assert.equal(fuera.celdas.B, 'DFY | PP | $3500')
  assert.match(fuera.avisos.join(' '), /El programa "DFY \| PP \| \$3500" no está en la lista de la planilla/)
  const seis = filaRegistroPagos(parsearAlta('#ALTA\nTipo de pago: PIF 6000 USD'), { fecha: '2026-10-23' })
  assert.equal(seis.celdas.B, 'DFY | PIF | $6.000')
  assert.deepEqual(seis.avisos, [])
  // DFY+R es una renovación: se arma el programa, pero no se carga como Front-end y avisa
  const dfyr = filaRegistroPagos(parsearAlta('#ALTA\nPrograma: DFY+R\nTipo de pago: PIF 3400 USD'), { fecha: '2026-10-23' })
  assert.equal(dfyr.celdas.B, 'DFY+R | PIF | $3400')
  assert.equal(dfyr.celdas.N, '')
  assert.match(dfyr.avisos.join(' '), /DFY\+R es una renovación, no un alta nueva/)
  assert.match(dfyr.pendientes.join(' '), /Tipos de venta: una renovación no va como "Front-end"/)
  // Decimales: mismo formato en las dos ramas (coma decimal, punto de miles solo desde $6.000)
  assert.equal(programaPlanilla({ programa: null, modalidad: 'PP', totalUsd: 3300.5 }).valor, 'DFY | PP | $3300,5')
  assert.equal(programaPlanilla({ programa: null, modalidad: 'PIF', totalUsd: 6000.5 }).valor, 'DFY | PIF | $6.000,5')
  const raro = filaRegistroPagos(parsearAlta('#ALTA\nPrograma: Mentoría\nTipo de pago: PIF 2400 USD'), { fecha: '2026-10-23' })
  assert.match(raro.avisos.join(' '), /"Mentoría \| PIF \| \$2400" no está en la lista/)
})

test('finanzas: una fuente fuera de la lista desplegable de K queda con aviso (25/10/2026)', () => {
  const ok = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Enrutamiento' })
  assert.equal(ok.celdas.K, 'Enrutamiento')
  assert.ok(!ok.avisos.some((x) => /fuente/i.test(x)))
  const mal = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', setter: 'Mai', fuente: 'paid_social' })
  assert.ok(mal.avisos.includes('La fuente "paid_social" no está en la lista de la planilla'))
})

test('finanzas: setter, fuente y cuenta faltantes quedan pendientes (no se inventan)', () => {
  const f = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23' })
  assert.equal(f.celdas.H, '')
  assert.equal(f.celdas.K, '')
  assert.equal(f.celdas.R, '')
  assert.equal(f.pendientes.length, 3)
  assert.match(f.pendientes[0], /^Setter: el bot lo busca en el CRM de ventas por teléfono \(\+5491130001111\); si no está, se lo pregunta al closer$/)
  assert.match(f.pendientes[1], /^Fuente: el bot la saca de los UTM del lead/)
  assert.equal(f.pendientes[2], 'Cuenta: se deduce del comprobante (si no está claro, pregunta en Verificaciones C.J)')
  // Si la cuenta es clara se escribe en R (no queda como pista)
  const stripe = filaRegistroPagos(parsearAlta(ALTA_PP.replace('Transferencia USD (Galicia)', 'Stripe')), { fecha: '2026-10-23' })
  assert.equal(stripe.celdas.R, 'Empresa')
  assert.equal(stripe.pendientes.length, 2)
  assert.ok(!stripe.pendientes.some((p) => p.startsWith('Cuenta')))
  const mal = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', setter: 'Pepe', cuenta: 'Banco' })
  assert.match(mal.avisos.join(' '), /setter "Pepe" no está en la lista/)
  assert.match(mal.avisos.join(' '), /cuenta "Banco" no está en la lista/)
  const empresa = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', setter: 'Mai', fuente: 'Inbound IG', cuenta: 'Empresa' })
  assert.deepEqual(empresa.avisos, [])
  const vieja = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', cuenta: 'Relay' })
  assert.match(vieja.avisos.join(' '), /cuenta "Relay" es de las filas viejas/)
  // PP sin cuotas: comprobante con "?" y pendiente
  const sinCuotas = filaRegistroPagos(parsearAlta('#ALTA\nNombre completo: Juan Pérez\nTipo de pago: PP 3300 USD\nEste pago: 1100 USD'), { fecha: '2026-10-23' })
  assert.equal(sinCuotas.celdas.I, 'Juan Pérez - PP 1/?')
  assert.match(sinCuotas.pendientes.join(' '), /Cuotas del plan/)
})

test('finanzas: teléfono argentino (área de 2, 3 y 4 dígitos), sin formato y extranjero', () => {
  assert.equal(telefonoPlanilla('5491130005555'), '54 9 11 3000-5555')
  assert.equal(telefonoPlanilla('5492235001111'), '54 9 223 500-1111')
  assert.equal(telefonoPlanilla('5492245501111'), '54 9 2245 50-1111')
  assert.equal(telefonoPlanilla('5493489123456'), '54 9 3489 12-3456')   // Campana: 4 dígitos aunque empiece como 348
  assert.equal(telefonoPlanilla('5492983123456'), '54 9 2983 12-3456')   // Tres Arroyos (298 es General Roca)
  assert.equal(telefonoPlanilla('541130005555'), '54 11 3000-5555')
  assert.equal(telefonoPlanilla('54911300055'), '54 9 11300055')
  // Extranjeros con apóstrofo: con USER_ENTERED, un "+" al principio Sheets lo toma como fórmula
  assert.equal(telefonoPlanilla('18490000000'), "'+1 8490000000")
  assert.equal(telefonoPlanilla('34600111222'), "'+34 600111222")
  assert.equal(telefonoPlanilla('598991234567'), "'+598 991234567")
})

test('finanzas: fecha de carga como serial de Sheets (se muestra M/D/YYYY), string o Date en hora de Argentina', () => {
  assert.equal(serialPlanilla('2026-10-23'), 46318)
  assert.equal(serialPlanilla('2026-11-05'), 46331)   // no depende del idioma de la planilla (nada de 11/5 vs 5/11)
  assert.equal(serialPlanilla('2026-02-31'), null)
  assert.equal(fechaPlanilla('2026-02-31'), null)
  assert.equal(fechaPlanilla('2026-10-23'), '10/23/2026')
  assert.equal(fechaPlanilla('2026-01-05'), '1/5/2026')
  assert.equal(fechaPlanilla(new Date('2026-10-23T15:00:00Z')), '10/23/2026')
  assert.equal(fechaPlanilla(new Date('2026-10-24T02:00:00Z')), '10/23/2026')   // 23 h en Argentina
  assert.equal(fechaPlanilla('23/10/2026'), null)
  const f = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: 'mañana' })
  assert.equal(f.celdas.A, '')
  assert.equal(f.fechaTexto, '')
  assert.match(f.avisos.join(' '), /Fecha de carga inválida/)
})

test('finanzas: cuentaPorMedio (Tomi · Gero · Empresa) a partir del medio o del destinatario', () => {
  assert.deepEqual([...OPCIONES_CUENTA], ['Tomi', 'Gero', 'Empresa'])
  // Tomi: Napolitano Tomás en cualquier banco o billetera
  assert.equal(cuentaPorMedio('Transferencia a Napolitano Tomás (Santander)'), 'Tomi')
  assert.equal(cuentaPorMedio('NAPOLITANO TOMAS EXEQUIEL - Banco Santander'), 'Tomi')
  assert.equal(cuentaPorMedio('Mercado Pago a nombre de Napolitano'), 'Tomi')
  // Gero: Gerónimo Actis en cualquier lado, y la cripto
  assert.equal(cuentaPorMedio('Gerónimo Actis (Galicia)'), 'Gero')
  assert.equal(cuentaPorMedio('Transferencia a Geronimo Actis'), 'Gero')
  assert.equal(cuentaPorMedio('USDT por Binance'), 'Gero')
  assert.equal(cuentaPorMedio('Cripto USDT'), 'Gero')
  assert.equal(cuentaPorMedio('crypto'), 'Gero')
  // Empresa: Stripe, dLocal Go, PayPal, Relay y la Financiera (con variantes de "Tecnos Ross")
  assert.equal(cuentaPorMedio('Stripe (link de pago)'), 'Empresa')
  assert.equal(cuentaPorMedio('dLocal Go'), 'Empresa')
  assert.equal(cuentaPorMedio('PayPal'), 'Empresa')
  assert.equal(cuentaPorMedio('Transferencia a Relay'), 'Empresa')
  assert.equal(cuentaPorMedio('Financiera'), 'Empresa')
  assert.equal(cuentaPorMedio('Asociación Mutual de Escribanos'), 'Empresa')
  assert.equal(cuentaPorMedio('Tecnos Ross'), 'Empresa')
  assert.equal(cuentaPorMedio('Tecno Cross'), 'Empresa')
  assert.equal(cuentaPorMedio('tecno-ross'), 'Empresa')
  assert.equal(cuentaPorMedio('TECNOROSS S.A.'), 'Empresa')
  // Ambiguo o sin datos → null (se pregunta en Verificaciones C.J)
  assert.equal(cuentaPorMedio('Transferencia USD (Galicia)'), null)
  assert.equal(cuentaPorMedio('Mercado Pago'), null)
  assert.equal(cuentaPorMedio('Efectivo'), null)
  assert.equal(cuentaPorMedio('PayPal de Napolitano'), null)            // dos cuentas distintas
  assert.equal(cuentaPorMedio('Napolitano o Actis, no sé'), null)
  assert.equal(cuentaPorMedio('Tecno Rosario'), null)                  // no es "Tecnos Ross"
  assert.equal(cuentaPorMedio(''), null)
  assert.equal(cuentaPorMedio(null), null)
  // En la fila: el destinatario del comprobante manda sobre el medio del #ALTA (y avisa si no coinciden)
  const tomi = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', destinatario: 'Napolitano Tomás - Santander' })
  assert.equal(tomi.celdas.R, 'Tomi')
  assert.ok(!tomi.pendientes.some((p) => p.startsWith('Cuenta')))
  const choque = filaRegistroPagos(parsearAlta(ALTA_PP.replace('Transferencia USD (Galicia)', 'Stripe')), { fecha: '2026-10-23', destinatario: 'Gerónimo Actis' })
  assert.equal(choque.celdas.R, 'Gero')
  assert.match(choque.avisos.join(' '), /El comprobante dice Gero y el medio de pago del #ALTA dice Empresa/)
  const dada = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23', cuenta: 'Empresa', destinatario: 'Napolitano Tomás' })
  assert.equal(dada.celdas.R, 'Empresa')   // la cuenta ya decidida manda
})

test('finanzas: pesos con y sin MEP del día anterior (E redondeado a 2 decimales)', () => {
  assert.equal(usdDesdePesos(310000, 1550), 200)
  assert.equal(usdDesdePesos(1000000, 1437.5), 695.65)    // 695,652… → 695,65
  assert.equal(usdDesdePesos(1000000, 1433), 697.84)      // 697,836… → 697,84
  assert.equal(usdDesdePesos(1000, 0), null)
  assert.equal(usdDesdePesos(Number.NaN, 1500), null)
  const t = '#ALTA\nCloser: Marcos\nNombre completo: Juan Pérez\nTeléfono: +54 9 11 3000-1111\nTipo de pago: PP 3300 USD\nEste pago: 1100 USD · Mercado Pago (pesos)\nCuotas:\n19/11/2026 1100\n19/12/2026 1100'
  const a = parsearAlta(t)
  const sinMep = filaRegistroPagos(a, { fecha: '2026-10-24', pesosArs: 1600000 })
  assert.equal(sinMep.celdas.F, 1600000)
  assert.equal(sinMep.celdas.E, '')                       // nunca el USD que escribió el closer
  assert.ok(sinMep.pendientes.some((p) => p.startsWith('Dólar MEP del día anterior')))
  const conMep = filaRegistroPagos(a, { fecha: '2026-10-24', pesosArs: 1600000, mepDiaAnterior: 1437.5 })
  assert.equal(conMep.celdas.E, 1113.04)                  // 1.600.000 / 1437,5 = 1113,043…
  assert.equal(conMep.celdas.F, 1600000)
  assert.equal(conMep.celdas.J, '1ra Cuota')
  assert.ok(conMep.avisos.includes('USD calculado con MEP 1.437,5 del 23/10'))
  assert.ok(!conMep.pendientes.some((p) => /MEP/.test(p)))
  // MEP inválido: avisa y queda pendiente
  const malMep = filaRegistroPagos(a, { fecha: '2026-10-24', pesosArs: 1600000, mepDiaAnterior: 0 })
  assert.equal(malMep.celdas.E, '')
  assert.match(malMep.avisos.join(' '), /Cotización MEP inválida: 0/)
  // El comprobante es en pesos aunque el closer no lo dijo: se calcula igual y avisa
  const sorpresa = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-24', pesosArs: 1600000, mepDiaAnterior: 1437.5 })
  assert.equal(sorpresa.celdas.E, 1113.04)
  assert.match(sorpresa.avisos.join(' '), /El comprobante es en pesos y "Este pago" no lo dice/)
})

test('finanzas: un monto en pesos escrito en "Este pago" no va a E como USD', () => {
  const base = '#ALTA\nCloser: Marcos\nNombre completo: Juan Pérez\nTeléfono: +54 9 11 3000-1111\nTipo de pago: PP 3300 USD\nCuotas:\n19/11/2026 1100\n19/12/2026 1100\nEste pago: '
  // "$" con más de 6 cifras, "pesos", "ARS" o un número grande en un tramo que dice pesos
  for (const [estePago, ars] of [['$3.500.000 · Transferencia', 3500000], ['3.500.000 pesos', 3500000], ['ARS 1.600.000', 1600000], ['$465.000 (pesos)', 465000], ['$465.000 · Transferencia', 465000], ['1ra cuota $1.650.000 · Transferencia', 1650000]]) {
    const a = parsearAlta(base + estePago)
    assert.equal(a.estePagoUsd, null, estePago)
    assert.equal(a.pagoEnPesos?.ars, ars, estePago)
    const sin = filaRegistroPagos(a, { fecha: '2026-10-24' })
    assert.equal(sin.celdas.E, '', estePago)
    assert.equal(sin.celdas.F, ars, estePago)              // mientras no llega el comprobante, los pesos del closer
    assert.ok(sin.pendientes.includes(`Monto en pesos del comprobante: confirmar los $${ars.toLocaleString('es-AR')} que escribió el closer`), estePago)
    assert.ok(sin.pendientes.some((p) => p.startsWith('Dólar MEP del día anterior')), estePago)
  }
  const a = parsearAlta(base + '$3.500.000 · Transferencia')
  const con = filaRegistroPagos(a, { fecha: '2026-10-24', mepDiaAnterior: 1400 })
  assert.equal(con.celdas.E, 2500)                         // 3.500.000 / 1400
  assert.equal(con.celdas.F, 3500000)
  // Un número chico en pesos es USD pagado en pesos (no se toma como ARS)
  const chico = parsearAlta(base + '1100 · Mercado Pago')
  assert.deepEqual(chico.pagoEnPesos, { ars: null, usdDelCloser: 1100, usdAparte: 0 })
  assert.equal(filaRegistroPagos(chico, { fecha: '2026-10-24' }).celdas.E, '')
})

test('finanzas: fecha como serial de Sheets (2026-10-24 → 46319) y fecha legible', () => {
  assert.equal(ymdASerial('2026-10-24'), 46319)            // helper de lib/clientes/fechas.ts
  assert.equal(serialPlanilla('2026-10-24'), 46319)
  const f = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-24' })
  assert.equal(f.celdas.A, 46319)
  assert.equal(typeof f.fila[0], 'number')                 // no se escribe texto M/D/YYYY
  assert.equal(f.fechaLegible, '24/10/2026')
  assert.equal(filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-01-05' }).fechaLegible, '05/01/2026')
})

test('finanzas: fechaDiaAnterior (cambio de mes, de año y bisiesto)', () => {
  assert.equal(fechaDiaAnterior('2026-10-24'), '2026-10-23')
  assert.equal(fechaDiaAnterior('2026-11-01'), '2026-10-31')
  assert.equal(fechaDiaAnterior('2027-01-01'), '2026-12-31')
  assert.equal(fechaDiaAnterior('2026-03-01'), '2026-02-28')
  assert.equal(fechaDiaAnterior('2028-03-01'), '2028-02-29')
  assert.equal(fechaDiaAnterior('2026-02-31'), null)
  assert.equal(fechaDiaAnterior('24/10/2026'), null)
})

test('mep: venta del día anterior al pago con el histórico (parte pura de lib/bot/alta/mep.ts)', async () => {
  const { mepDiaAnteriorDe } = await import('../lib/bot/alta/mep.ts')
  const historico = { '2026-10-21': 1540, '2026-10-22': 1550, '2026-10-23': 1560 }
  assert.deepEqual(mepDiaAnteriorDe(historico, '2026-10-23'), { venta: 1550, diaAnterior: '2026-10-22', fechaCotizacion: '2026-10-22' })
  // Lunes 26/10: el día anterior es domingo (sin cotización) → la del viernes 23
  assert.deepEqual(mepDiaAnteriorDe(historico, '2026-10-26'), { venta: 1560, diaAnterior: '2026-10-25', fechaCotizacion: '2026-10-23' })
  assert.equal(mepDiaAnteriorDe(historico, '2026-10-21'), null)   // no hay cotización hasta el 20
  assert.equal(mepDiaAnteriorDe(historico, 'mañana'), null)
})

test('plan: el paso de Finanzas muestra los valores de la fila y los pendientes', async () => {
  const paso = planDeAlta(parsearAlta(ALTA_PP), '2026-10-23').find(p => p.id === 'finanzas')
  const txt = paso.detalle.join('\n')
  assert.match(txt, /Fecha: 23\/10\/2026 \(va como serial de Sheets: 46318\)/)
  assert.match(txt, /Programa: DFY \| PP \| \$3300 · Concepto: 1ra Cuota · Tipo de pago: Payment Plan/)
  assert.match(txt, /Comprobante: Juan Pérez - PP 1\/3/)
  assert.ok(!/Cuenta que recibió:/.test(txt))   // sin cuenta clara: solo el pendiente, sin línea repetida
  assert.match(txt, /Pendiente: Cuenta: se deduce del comprobante \(si no está claro, pregunta en Verificaciones C\.J\)/)
  assert.match(txt, /Pendiente: Setter/)
  assert.match(txt, /Pendiente: Fuente/)
  // Con la cuenta clara por el medio de pago, aparece en el paso
  const stripe = planDeAlta(parsearAlta(ALTA_PP.replace('Transferencia USD (Galicia)', 'Stripe')), '2026-10-23').find(p => p.id === 'finanzas')
  assert.ok(stripe.detalle.includes('Cuenta que recibió: Empresa'))
  // Alta completa: estado "lista" y ningún paso en espera
  const a = parsearAlta(ALTA_PP)
  assert.equal(estadoAlta(a), 'lista')
  assert.ok(planDeAlta(a, '2026-10-23').every((p) => !p.enEspera))
})

const ALTA_FEE = `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 300 USD · Transferencia a Napolitano Tomás (Santander)
Nombre completo: Juan Pérez
Teléfono: +54 9 11 3000-1111
Correo: juan@example.test
Dirección: Calle 1 123
DNI: 30111222
CUIT: 20-30111222-3
Inicio del servicio: 26/10/2026
Cuotas:
26/11/2026 1500
26/12/2026 1500`

test('plan: Fee de menos de USD 500 → concepto Fee, estado fee, pasos en espera y respuesta al closer', () => {
  const a = parsearAlta(ALTA_FEE)
  assert.deepEqual(a.faltantes, [])
  assert.equal(estadoAlta(a), 'fee')
  const f = filaRegistroPagos(a, { fecha: '2026-10-24' })
  assert.equal(f.celdas.J, 'Fee')
  assert.equal(f.celdas.R, 'Tomi')                         // por el medio de pago
  const pasos = planDeAlta(a, '2026-10-24')
  const porId = Object.fromEntries(pasos.map((p) => [p.id, p]))
  // Reglas del 26/10/2026 (Tomás): con el OK de Verificaciones se valida, se registra el Fee y se arma la comunidad; todo lo
  // demás espera la primera cuota (antes la comunidad también esperaba y no había OK)
  assert.equal(porId.validar.enEspera, false)
  assert.equal(porId.finanzas.enEspera, false)
  assert.equal(porId.comunidad.enEspera, false)
  assert.equal(porId.finanzas.titulo, 'Registrar el Fee en Finanzas')
  assert.match(porId.finanzas.detalle.join(' '), /Concepto: Fee/)
  for (const id of ['crm', 'drive', 'bienvenida', 'skool', 'contrato', 'saludos']) {
    assert.equal(porId[id].enEspera, true, id)
    assert.equal(porId[id].detalle[0], 'En espera: arranca cuando se complete la primera cuota (como mínimo, USD 500).', id)
  }
  assert.match(porId.validar.detalle.join(' '), /Es un Fee \(seña\) de USD 300: con el OK de Verificaciones C\.J se registra en Finanzas y se arma la comunidad/)
  assert.equal(porId.validar.humano, 'OK en Verificaciones C.J (Fee: Finanzas y comunidad)')
  const resp = respuestaAlCloser(a)
  assert.match(resp, /^Recibí el pago de Juan Pérez: USD 300 es un Fee \(seña\)\. Con el OK de Verificaciones C\.J lo registro en Finanzas y armo la comunidad de WhatsApp\./)
  assert.match(resp, /arranca cuando se complete la primera cuota \(como mínimo, USD 500\)\.$/)
  // Con datos faltantes sigue siendo Fee, y la respuesta pide lo que falta
  const incompleto = parsearAlta('#ALTA\nCloser: Marcos\nNombre completo: Juan Pérez\nTipo de pago: PP 3300 USD\nEste pago: 200 USD · Transferencia')
  assert.equal(estadoAlta(incompleto), 'fee')
  assert.match(respuestaAlCloser(incompleto), /Para ese momento me falta: Teléfono, Correo/)
  // En pesos: decide el USD calculado con el MEP
  const pesos = parsearAlta(ALTA_FEE.replace('300 USD · Transferencia a Napolitano Tomás (Santander)', '$930.000 ARS (Mercado Pago)'))
  assert.equal(estadoAlta(pesos), 'falta_usd')                                           // sin MEP no se sabe el USD: no arranca
  assert.equal(estadoAlta(pesos, { pesosArs: 465000, mepDiaAnterior: 1550 }), 'fee')      // 300 USD
  assert.equal(estadoAlta(pesos, { pesosArs: 930000, mepDiaAnterior: 1550 }), 'lista')    // 600 USD
  assert.equal(planDeAlta(pesos, '2026-10-24', { pesosArs: 930000, mepDiaAnterior: 1550 }).every((p) => !p.enEspera), true)
})

test('plan: Skool por invitación por correo (Aylu invita desde Configuración → Invitar; sin solicitud)', () => {
  const skool = planDeAlta(parsearAlta(ALTA_PP), '2026-10-23').find((p) => p.id === 'skool')
  assert.equal(LINK_SKOOL, 'skool.com/skyward-consultoria-juridica-2017')
  assert.equal(skool.humano, 'Aylu envía la invitación')
  assert.deepEqual(skool.detalle, [
    'Aylu invita al cliente por correo desde Skool (Configuración → Invitar); acceso instantáneo, sin solicitud.',
    'Aviso en Verificaciones C.J: "Juan Pérez ya pagó. Invitalo a Skool: Configuración → Invitar → correo: juan@example.test"',
  ])
  assert.ok(!/solicite|pida entrar|aceptalo|lo acepta/i.test(skool.detalle.join('\n')))
})

test('plan: el contrato queda en borrador y el closer lo revisa y confirma antes de mandarlo a firmar (nunca se envía solo)', () => {
  const contrato = (texto) => planDeAlta(parsearAlta(texto), '2026-10-23').find((p) => p.id === 'contrato')
  const BORRADOR = 'Queda el borrador en PandaDoc; el closer lo revisa y confirma antes de mandarlo a firmar.'
  // Completo (dirección del catálogo, sin dudas): igual lo revisa y confirma el closer
  const completo = contrato(ALTA_PP.replace('Dirección: Calle 1 123', 'Dirección: Calle 1 123, Mar del Plata'))
  assert.ok(completo.detalle.includes(BORRADOR))
  assert.ok(!completo.detalle.some((x) => /Le falta/.test(x)))
  assert.equal(completo.humano, 'El closer revisa el borrador y confirma el envío')
  assert.ok(!/Se manda a firmar/.test(completo.detalle.join(' ')))
  // Sin ciudad: le falta, y el closer completa y confirma
  const sinCiudad = contrato(ALTA_PP)
  assert.ok(sinCiudad.detalle.includes('Le falta: Ciudad y provincia del cliente (el bot arroba al closer).'))
  assert.ok(sinCiudad.detalle.includes(BORRADOR))
  assert.equal(sinCiudad.humano, 'El closer completa lo que falta y confirma el envío')
  // Conjetura de las reglas (Córdoba sin teléfono que desempate entre Argentina y España): se pide confirmar
  const dudosa = contrato(ALTA_PP.replace('Dirección: Calle 1 123', 'Dirección: Av. Colón 1234, Córdoba').replace('Teléfono: +54 9 11 3000-1111\n', ''))
  assert.ok(dudosa.detalle.some((x) => x.startsWith('Le falta: Confirmar ciudad y provincia del cliente (deducidas sin verificar)')))
  // El nombre del contrato va limpio, como en Drive
  assert.match(contrato(ALTA_PP.replace('Juan Pérez', 'DRA. MARIA LAURA PEREZ')).detalle.join('\n'), /para Maria Laura Perez, a firmar por/)
})

test('plan: la bienvenida es el mensaje oficial fijo (sin aprobación) salvo que traiga avisos', () => {
  const bienvenida = (texto) => planDeAlta(parsearAlta(texto), '2026-10-23').find((p) => p.id === 'bienvenida')
  const b = bienvenida(ALTA_PP)
  assert.deepEqual(b.detalle, ['Mensaje oficial de Aylén en el grupo General con el video de Skool adjunto; bienvenido/a/os según el nombre; avisa que la invitación a Skool llega al correo del #ALTA.'])
  assert.equal(b.humano, null)
  assert.ok(!/Claude|Fathom|paleta|se aprueba/i.test(b.detalle.join(' ')))
  // "Socios: No tiene" no genera avisos: sigue sin aprobación
  assert.equal(bienvenida(ALTA_PP.replace('Correo:', 'Socios: No tiene\nCorreo:')).humano, null)
  // Socio con teléfono pero sin nombre, o nombre sin género claro: se revisa en Verificaciones C.J y se dice por qué
  const sinNombre = bienvenida(ALTA_PP.replace('Correo:', 'Socios: +54 9 11 3000-2222 (estudio)\nCorreo:'))
  assert.equal(sinNombre.humano, 'Revisar en Verificaciones C.J')
  assert.ok(sinNombre.detalle.some((x) => x.startsWith('Revisar: El #ALTA trae socios sin nombre')))
  const dudoso = bienvenida(ALTA_PP.replace('Juan Pérez', 'Alex Ruiz'))
  assert.equal(dudoso.humano, 'Revisar en Verificaciones C.J')
  assert.ok(dudoso.detalle.some((x) => x.includes('No se pudo deducir si Alex es hombre o mujer')))
})

test('finanzas: programa DFY deducido; DWY se respeta sin aviso si está en la lista', () => {
  assert.equal(filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-23' }).celdas.B, 'DFY | PP | $3300')
  const dwy = filaRegistroPagos(parsearAlta('#ALTA\nPrograma: DWY\nTipo de pago: PP 600 USD\nEste pago: 600 USD'), { fecha: '2026-10-23' })
  assert.equal(dwy.celdas.B, 'DWY | PP | $600')
  assert.ok(!dwy.avisos.some((a) => /no está en la lista/.test(a)))
})

// ── Hallazgos de la revisión (24/10/2026). Datos inventados. ──────────────────────────────────────────────
test('plan: pago en pesos sin el USD todavía → falta_usd (puede ser un Fee): nada arranca salvo validar', () => {
  const a = parsearAlta(ALTA_FEE.replace('300 USD · Transferencia a Napolitano Tomás (Santander)', '$465.000 ARS (Mercado Pago)'))
  assert.deepEqual(a.faltantes, [])
  assert.equal(estadoAlta(a), 'falta_usd')
  const pasos = planDeAlta(a, '2026-10-24')
  assert.deepEqual(pasos.filter((p) => !p.enEspera).map((p) => p.id), ['validar'])
  for (const p of pasos.filter((p) => p.enEspera)) {
    assert.equal(p.detalle[0], 'En espera: falta el dólar MEP del día anterior para saber si el pago llega a USD 500.', p.id)
  }
  const validar = pasos.find((p) => p.id === 'validar')
  assert.match(validar.detalle.join(' '), /Este pago: \$465\.000 en pesos/)
  assert.match(validar.detalle.join(' '), /Pago en pesos: falta el dólar MEP del día anterior para saber cuántos USD son y si es un Fee/)
  const resp = respuestaAlCloser(a)
  assert.doesNotMatch(resp, /^Listo, arranco/)
  assert.match(resp, /El pago es en pesos y falta el dólar MEP del día anterior para saber cuántos USD son: si no llega a USD 500 es un Fee/)
  // Con el MEP: 465.000 / 1550 = 300 USD → Fee; 930.000 / 1550 = 600 USD → lista
  assert.equal(estadoAlta(a, { pesosArs: 465000, mepDiaAnterior: 1550 }), 'fee')
  assert.equal(estadoAlta(a, { pesosArs: 930000, mepDiaAnterior: 1550 }), 'lista')
  // Con el MEP y todavía sin el comprobante: se usan los $465.000 que escribió el closer (300 USD → Fee)
  assert.equal(estadoAlta(a, { mepDiaAnterior: 1550 }), 'fee')
})

test('plan: DFY+R en un #ALTA es una renovación → aviso del parser, necesita_ok y nada arranca', () => {
  for (const prog of ['DFY+R', 'DFY+R++', 'Renovación']) {
    const a = parsearAlta(ALTA_PP.replace('Programa: Agencia', `Programa: ${prog}`))
    assert.match(a.avisos.join(' '), /es una renovación, no un alta nueva/, prog)
    assert.equal(estadoAlta(a), 'necesita_ok', prog)
    assert.ok(planDeAlta(a, '2026-10-24').filter((p) => p.id !== 'validar').every((p) => p.enEspera && p.detalle[0] === 'En espera: falta el OK de Tomi o Gero.'), prog)
    assert.match(respuestaAlCloser(a), /^Recibí el alta de Juan Pérez\. Antes de seguir, Tomi o Gero tienen que revisar: Programa DFY\+R(\+\+)?: es una renovación/, prog)
  }
})

test('finanzas: programa normalizado (Agencia., Done For You, Renovación…); DWY se respeta', () => {
  const B = (prog, tipo = 'PP 3300 USD') => filaRegistroPagos(parsearAlta(`#ALTA\nPrograma: ${prog}\nTipo de pago: ${tipo}\nEste pago: 1100 USD`), { fecha: '2026-10-24' })
  for (const prog of ['Agencia.', 'Agencia DFY', 'Done For You', 'dfy', 'agencia']) assert.equal(B(prog).celdas.B, 'DFY | PP | $3300', prog)
  const renov = B('Renovación', 'PP 3400 USD')
  assert.equal(renov.celdas.B, 'DFY+R | PP | $3400')
  assert.equal(renov.celdas.N, '')
  assert.match(renov.avisos.join(' '), /DFY\+R es una renovación, no un alta nueva/)
  assert.equal(B('DFY + R++', 'PIF 3800 USD').celdas.B, 'DFY+R++ | PIF | $3800')
  assert.equal(B('Done With You', 'PP 600 USD').celdas.B, 'DWY | PP | $600')
})

test('parser: "Este pago" toma el monto pegado a la moneda, no el ordinal ("1ra cuota 1100 USD")', () => {
  const base = ALTA_PP.replace('Este pago: 1100 USD · Transferencia USD (Galicia)', 'Este pago: ')
  for (const estePago of ['1ra cuota 1100 USD · Transferencia', 'cuota 1 de 3 · 1100 · Transferencia', '1° cuota: 1.100 · Transferencia', 'Cuota 1/3 1100 · Transferencia']) {
    const a = parsearAlta(base.replace('Este pago: ', `Este pago: ${estePago}`))
    assert.equal(a.estePagoUsd, 1100, estePago)
    assert.equal(a.pagoEnPesos, null, estePago)
    assert.deepEqual(a.avisos, [], estePago)
    assert.equal(estadoAlta(a), 'lista', estePago)
  }
  // En pesos con ordinal: los pesos van a F (no 1 USD a E) y el concepto no es Fee mientras no se sepa el USD
  const p = parsearAlta('#ALTA\nTipo de pago: PP 3300 USD\nEste pago: 1ra cuota $1.650.000 · Transferencia\nNombre completo: Juan Pérez')
  assert.equal(p.estePagoUsd, null)
  assert.equal(p.pagoEnPesos?.ars, 1650000)
  const f = filaRegistroPagos(p, { fecha: '2026-10-24' })
  assert.equal(f.celdas.E, '')
  assert.equal(f.celdas.F, 1650000)
  assert.equal(f.celdas.J, '1ra Cuota')
  // "cuota 1.100" es un monto, no un número de cuota
  assert.equal(parsearAlta('#ALTA\nEste pago: cuota 1.100 · Transferencia').estePagoUsd, 1100)
  // Un número de operación en el medio no convierte el pago en pesos
  assert.equal(parsearAlta('#ALTA\nEste pago: 1100 · Transferencia op 123456789').pagoEnPesos, null)
})

test('parser: monto sin "USD" de más de USD 10.000 son pesos ("$465.000"); un Fee en pesos ya no pasa como 465.000 USD', () => {
  const a = parsearAlta(ALTA_FEE.replace('300 USD · Transferencia a Napolitano Tomás (Santander)', '$465.000 · Transferencia'))
  assert.equal(a.estePagoUsd, null)
  assert.deepEqual(a.pagoEnPesos, { ars: 465000, usdDelCloser: null, usdAparte: 0 })
  assert.match(a.avisos.join(' '), /trae 465\.000 sin decir la moneda: por la cantidad de cifras se toma como pesos/)
  assert.equal(filaRegistroPagos(a, { fecha: '2026-10-24' }).celdas.E, '')
  assert.equal(estadoAlta(a), 'falta_usd')                 // sin MEP no se sabe si es un Fee: no arranca
  assert.equal(estadoAlta(a, { pesosArs: 465000, mepDiaAnterior: 1550 }), 'fee')
  // Hasta USD 10.000 sin moneda sigue siendo USD (con aviso si es más que el total)
  const usd = parsearAlta('#ALTA\nTipo de pago: PIF 2400 USD\nEste pago: 9000 · Transferencia')
  assert.equal(usd.estePagoUsd, 9000)
  assert.match(usd.avisos.join(' '), /es más que el total/)
})

test('plan: el aviso de Fee del closer no queda si el USD calculado con el MEP llega a 500', () => {
  const a = parsearAlta(ALTA_PP.replace('1100 USD · Transferencia USD (Galicia)', '200 USD · Mercado Pago (pesos)'))
  assert.ok(!a.avisos.some((x) => /es un Fee/.test(x)))
  const extras = { pesosArs: 1007500, mepDiaAnterior: 1550 }   // 650 USD
  assert.notEqual(estadoAlta(a, extras), 'fee')
  assert.doesNotMatch(respuestaAlCloser(a, extras), /es un Fee/)
  // Fee con otros avisos: sigue siendo Fee, pero la respuesta los lista para Tomi o Gero
  const conAviso = parsearAlta(ALTA_FEE.replace('26/12/2026 1500', '26/12/2026 1000'))
  assert.equal(estadoAlta(conAviso), 'fee')
  assert.match(respuestaAlCloser(conAviso), /Además, Tomi o Gero tienen que revisar: El cronograma suma 2800 USD y el total dice 3300 USD\./)
  assert.doesNotMatch(respuestaAlCloser(conAviso), /revisar: Pago de 300/)
  assert.equal(planDeAlta(conAviso, '2026-10-24').find((p) => p.id === 'validar').humano, 'OK en Verificaciones C.J (Fee: Finanzas y comunidad)')   // 26/10: el Fee siempre pide OK
})

test('finanzas: cuenta (col R) con dLocalGo/Pay-Pal; Gero pide "Actis" y la Financiera una frase; aviso si sale solo del medio', () => {
  for (const t of ['dLocalGo', 'DLOCALGO', 'dlocal-go', 'Pay-Pal', 'pay pal']) assert.equal(cuentaPorMedio(t), 'Empresa', t)
  assert.equal(cuentaPorMedio('Mutual de Escribanos'), 'Empresa')
  assert.equal(cuentaPorMedio('Gerónimo Mozzi'), null)               // el otro Gero del equipo
  assert.equal(cuentaPorMedio('Transferencia a Gerónimo'), null)     // sin apellido: se pregunta
  assert.equal(cuentaPorMedio('Escribano Gómez (cliente)'), null)
  assert.equal(cuentaPorMedio('Transferencia del escribano Gómez'), null)
  assert.equal(cuentaPorMedio('Mutual'), null)
  const dlocal = filaRegistroPagos(parsearAlta(ALTA_PP.replace('Transferencia USD (Galicia)', 'dLocalGo')), { fecha: '2026-10-24' })
  assert.equal(dlocal.celdas.R, 'Empresa')
  assert.ok(dlocal.avisos.includes('Cuenta Empresa deducida del medio de pago del #ALTA: confirmar con el destinatario del comprobante'))
  const porComprobante = filaRegistroPagos(parsearAlta(ALTA_PP), { fecha: '2026-10-24', destinatario: 'DLOCALGO' })
  assert.equal(porComprobante.celdas.R, 'Empresa')
  assert.ok(!porComprobante.avisos.some((x) => /deducida del medio/.test(x)))
})

test('finanzas: el aviso del MEP cita la fecha de la cotización usada (fechaMep), no un domingo', () => {
  const a = parsearAlta(ALTA_FEE.replace('300 USD · Transferencia a Napolitano Tomás (Santander)', '$465.000 ARS (Mercado Pago)'))
  const lunes = filaRegistroPagos(a, { fecha: '2026-10-26', pesosArs: 465000, mepDiaAnterior: 1560, fechaMep: '2026-10-23' })
  assert.ok(lunes.avisos.includes('USD calculado con MEP 1.560 del 23/10'))
  const sinFecha = filaRegistroPagos(a, { fecha: '2026-10-26', pesosArs: 465000, mepDiaAnterior: 1560 })
  assert.ok(sinFecha.avisos.includes('USD calculado con MEP 1.560 del 25/10'))   // sin fechaMep: el día anterior
})

test('plan: cada paso en espera dice por qué (faltan datos u OK pendiente), no solo el Fee', () => {
  const falta = parsearAlta('#ALTA\nCloser: Marcos\nNombre completo: Juan Pérez\nTipo de pago: PP 3300 USD\nEste pago: 1100 USD · Transferencia')
  assert.equal(estadoAlta(falta), 'faltan_datos')
  assert.ok(planDeAlta(falta, '2026-10-24').filter((p) => p.enEspera).every((p) => p.detalle[0] === 'En espera: faltan datos que tiene que mandar el closer.'))
  assert.ok(planDeAlta(parsearAlta(ALTA_PP), '2026-10-24').every((p) => !p.detalle[0].startsWith('En espera')))
})

// ── Socios con correo (Tomás, 24/10/2026: los socios también reciben la invitación a Skool). Datos inventados. ─────────
const CON_SOCIOS = (socios) => `#ALTA
Closer: Marcos
Programa: Agencia
Tipo de pago: PP 3300 USD
Este pago: 1100 USD · Transferencia USD (Galicia)
Nombre completo: Juan Pérez
Teléfono: +54 9 11 3000-1111
Correo: juan@ejemplo.com
${socios}
Dirección: Calle 1 123, Rosario
DNI: 30111222
CUIT: 20-30111222-3
Inicio del servicio: 19/10/2026
Cuotas:
19/11/2026 1100
19/12/2026 1100`

test('socios: formato nuevo, uno por línea con nombre, teléfono y correo (separados por "·", coma o espacio)', () => {
  const r = parsearAlta(CON_SOCIOS(`Socios:
Ana Gómez · +54 9 11 3000-2222 · ana@ejemplo.com
Pedro Ruiz, +54 9 11 3000-3333, Pedro.Ruiz@Ejemplo.com
Dra. Laura Paz +54 9 11 3000-4444 laura.paz@ejemplo.com.ar`))
  assert.deepEqual(r.faltantes, [])
  assert.deepEqual(r.avisos, [])
  assert.equal(r.correo, 'juan@ejemplo.com', 'el correo del cliente no cambia')
  assert.deepEqual(leerSocios(r.socios), [
    { nombre: 'Ana Gómez', telefono: '5491130002222', correo: 'ana@ejemplo.com' },
    { nombre: 'Pedro Ruiz', telefono: '5491130003333', correo: 'pedro.ruiz@ejemplo.com' },
    { nombre: 'Laura Paz', telefono: '5491130004444', correo: 'laura.paz@ejemplo.com.ar' },
  ])
  // Los teléfonos, en orden de aparición, con el nombre del socio como etiqueta (el primero sigue siendo el del cliente)
  assert.deepEqual(r.telefonos, [
    { numero: '5491130001111', etiqueta: '' }, { numero: '5491130002222', etiqueta: 'Ana Gómez' },
    { numero: '5491130003333', etiqueta: 'Pedro Ruiz' }, { numero: '5491130004444', etiqueta: 'Laura Paz' },
  ])
  // `socios` guarda las líneas unidas con "; " (crm.ts y la comunidad releen sus teléfonos)
  assert.equal(r.socios.split('; ').length, 3)
  // El bloque termina en la próxima "Clave: valor": la dirección y las cuotas no se toman como socios
  assert.equal(r.direccion, 'Calle 1 123, Rosario')
  assert.equal(r.cuotas.length, 2)
})

test('socios: el formato de antes (todo en la línea de "Socios:") se sigue leyendo; un socio sin correo es un faltante', () => {
  const uno = parsearAlta(CON_SOCIOS('Socios: Ana Gómez +54 9 11 3000-2222'))
  assert.deepEqual(uno.faltantes, ['Correo de cada socio (falta el de Ana Gómez)'])
  assert.deepEqual(uno.telefonos.map((t) => t.numero), ['5491130001111', '5491130002222'])
  assert.equal(uno.socios, 'Ana Gómez +54 9 11 3000-2222')
  const dos = parsearAlta(CON_SOCIOS('Socios: Ana Gómez +54 9 11 3000-2222, Pedro Ruiz +54 9 11 3000-3333'))
  assert.deepEqual(dos.faltantes, ['Correo de cada socio (faltan los de Ana Gómez y Pedro Ruiz)'])
  assert.equal(estadoAlta(dos), 'faltan_datos')
  assert.match(respuestaAlCloser(dos), /me falta: Correo de cada socio \(faltan los de Ana Gómez y Pedro Ruiz\)/)
  // En la misma línea, con los correos: completo
  const enLinea = parsearAlta(CON_SOCIOS('Socios: Ana Gómez +54 9 11 3000-2222 ana@ejemplo.com, Pedro Ruiz +54 9 11 3000-3333 pedro@ejemplo.com'))
  assert.deepEqual(enLinea.faltantes, [])
  assert.deepEqual(leerSocios(enLinea.socios).map((s) => s.correo), ['ana@ejemplo.com', 'pedro@ejemplo.com'])
  // Un socio con correo y el otro no: solo se pide el que falta
  const mitad = parsearAlta(CON_SOCIOS('Socios:\nAna Gómez · +54 9 11 3000-2222 · ana@ejemplo.com\nPedro Ruiz · +54 9 11 3000-3333'))
  assert.deepEqual(mitad.faltantes, ['Correo de cada socio (falta el de Pedro Ruiz)'])
  // Sin socios, o un teléfono suelto (el del estudio): no se pide ningún correo
  for (const sin of ['Socios: ninguno', 'Socios: No tiene', 'Socios: -', 'Socios: +54 9 11 3000-2222 (estudio)', '']) {
    assert.deepEqual(parsearAlta(CON_SOCIOS(sin)).faltantes, [], sin)
  }
  // "No tiene…" con un teléfono: como antes, el número se guarda (va a los grupos) pero no es un socio para Skool
  const frase = parsearAlta(CON_SOCIOS('Socios: No tiene, pero sumar a la secretaria +54 9 11 3000-2222'))
  assert.deepEqual(frase.telefonos.map((t) => t.numero), ['5491130001111', '5491130002222'])
  assert.deepEqual(leerSocios(frase.socios), [])
  assert.deepEqual(frase.faltantes, [])
  // "Teléfono y de los socios" (formato de antes): no hay "Socios:", así que no se pide nada de más
  const viejo = parsearAlta('Tipo de pago: PIF 2100\nNombre completo del lead: Juan Pérez\nTeléfono y de los socios: +54 9 11 3000-1111, +54 9 11 3000-2222 nicolas\nCorreo principal: juan@ejemplo.com')
  assert.ok(!viejo.faltantes.some((f) => /socio/i.test(f)))
})

test('socios: el bloque nuevo arranca con "Socios:" vacío; un nombre solo cuenta y "ninguno" debajo también vale', () => {
  const soloNombre = parsearAlta(CON_SOCIOS('Socios:\nAna Gómez'))
  assert.deepEqual(leerSocios(soloNombre.socios), [{ nombre: 'Ana Gómez', telefono: null, correo: null }])
  assert.deepEqual(soloNombre.faltantes, ['Correo de cada socio (falta el de Ana Gómez)'])
  const ninguno = parsearAlta(CON_SOCIOS('Socios:\nninguno'))
  assert.equal(ninguno.socios, null)
  assert.deepEqual(ninguno.faltantes, [])
  // "Socios:" vacío y después la próxima clave: sin socios
  assert.equal(parsearAlta(CON_SOCIOS('Socios:')).socios, null)
  // Con "Socios: Ana …" en la línea, la de abajo solo sigue el bloque si trae teléfono o correo
  const sigue = parsearAlta(CON_SOCIOS('Socios: Ana Gómez · +54 9 11 3000-2222 · ana@ejemplo.com\nPedro Ruiz · pedro@ejemplo.com'))
  assert.deepEqual(leerSocios(sigue.socios).map((s) => s.nombre), ['Ana Gómez', 'Pedro Ruiz'])
  assert.equal(esContinuacionSocios('Pedro Ruiz', false), false)
  assert.equal(esContinuacionSocios('Pedro Ruiz', true), true)
  assert.equal(esContinuacionSocios('19/11/2026 1100', true), false, 'una cuota no es un socio')
  assert.equal(esContinuacionSocios('Correo: ana@ejemplo.com', true), false, 'una clave cierra el bloque')
  assert.equal(esContinuacionSocios('Ojo: paga el 10', true), false)
})

test('socios: el correo de un socio escrito como "Correo:"/"Mail:" no pisa el del cliente: dos correos se preguntan', () => {
  const r = parsearAlta(CON_SOCIOS('Socios: Ana Gómez +54 9 11 3000-2222\nMail: ana@ejemplo.com'))
  assert.ok(r.faltantes.includes('Correo del cliente (vinieron 2: juan@ejemplo.com, ana@ejemplo.com; el de cada socio va en su línea de "Socios:")'))
  assert.ok(r.faltantes.includes('Correo de cada socio (falta el de Ana Gómez)'))
  // Dos correos en la misma línea "Correo:" también
  assert.ok(parsearAlta(CON_SOCIOS('').replace('Correo: juan@ejemplo.com', 'Correo: juan@ejemplo.com / juan.estudio@ejemplo.com')).faltantes.some((f) => f.startsWith('Correo del cliente (vinieron 2')))
  // El mismo correo repetido no es un problema
  assert.deepEqual(parsearAlta(CON_SOCIOS('Correo: Juan@Ejemplo.com')).faltantes, [])
})

test('socios: los dígitos de un correo no son un teléfono (ni en "Socios:" ni en "Teléfono:")', () => {
  const r = parsearAlta(CON_SOCIOS('Socios:\nAna Gómez · +54 9 11 3000-2222 · estudio2215001111@ejemplo.com'))
  assert.deepEqual(r.telefonos.map((t) => t.numero), ['5491130001111', '5491130002222'])
  assert.deepEqual(r.faltantes, [])
  assert.deepEqual(telefonos('+54 9 11 3000-1111 juan3413001111@ejemplo.com'), [{ numero: '5491130001111', etiqueta: '' }])
  // Un correo solo ya es un socio (no "sin socios")
  assert.equal(sinSocios('ana@ejemplo.com'), false)
})

test('leerSocios: en orden, en columnas, con títulos y aclaraciones; un teléfono suelto no entra a Skool', () => {
  const t1 = '+54 9 11 3000-2222', t2 = '+54 9 11 3000-3333'
  const casos = [
    [`Ana Gómez ${t1}, Pedro Ruiz ${t2}`, [['Ana Gómez', '5491130002222', null], ['Pedro Ruiz', '5491130003333', null]]],
    [`${t1} Ana, ${t2} Pedro`, [['Ana', '5491130002222', null], ['Pedro', '5491130003333', null]]],
    [`Ana y Pedro: ${t1}, ${t2}`, [['Ana', '5491130002222', null], ['Pedro', '5491130003333', null]]],
    [`Ana Gómez, Pedro Ruiz · ana@ejemplo.com, pedro@ejemplo.com`, [['Ana Gómez', null, 'ana@ejemplo.com'], ['Pedro Ruiz', null, 'pedro@ejemplo.com']]],
    [`socia Dra. Ana Gómez (estudio) ${t1} ana@ejemplo.com`, [['Ana Gómez', '5491130002222', 'ana@ejemplo.com']]],
    [`Tel. de Ana: ${t1}`, [['Ana', '5491130002222', null]]],
    ['Juan de la Vega · juan@ejemplo.com', [['Juan de la Vega', null, 'juan@ejemplo.com']]],
    [`ana gómez ${t1} ana@ejemplo.com`, [['ana gómez', '5491130002222', 'ana@ejemplo.com']]],
    [`${t1} (estudio)`, [[null, '5491130002222', null]]],
    ['ninguno', []], ['No tiene', []], ['-', []], [null, []],
  ]
  for (const [texto, esperado] of casos) {
    assert.deepEqual(leerSocios(texto).map((s) => [s.nombre, s.telefono, s.correo]), esperado, String(texto))
  }
  assert.equal(esSocioSkool({ nombre: null, telefono: '5491130002222', correo: null }), false)
  assert.equal(esSocioSkool({ nombre: null, telefono: null, correo: 'ana@ejemplo.com' }), true)
  assert.equal(esSocioSkool({ nombre: 'Ana', telefono: null, correo: null }), true)
})

test('plan con socios: Skool invita al cliente y a sus socios con los correos de todos ("Invitalo"); la bienvenida lo dice', () => {
  const a = parsearAlta(CON_SOCIOS('Socios:\nAna Gómez · +54 9 11 3000-2222 · ana@ejemplo.com\nPedro Ruiz · +54 9 11 3000-3333 · pedro@ejemplo.com'))
  assert.equal(estadoAlta(a), 'lista')
  const pasos = planDeAlta(a, '2026-10-24')
  const skool = pasos.find((p) => p.id === 'skool')
  assert.deepEqual(skool.detalle, [
    'Aylu invita al cliente y a sus socios por correo desde Skool (Configuración → Invitar); acceso instantáneo, sin solicitud.',
    'Aviso en Verificaciones C.J: "Juan Pérez ya pagó. Invitalo a Skool con sus socios Ana Gómez y Pedro Ruiz: Configuración → Invitar → correos: juan@ejemplo.com, ana@ejemplo.com, pedro@ejemplo.com"',
  ])
  assert.match(pasos.find((p) => p.id === 'bienvenida').detalle[0], /llega a los correos del cliente y de los socios\.$/)
  // Un teléfono suelto (el del estudio) no cambia nada de Skool
  const estudio = planDeAlta(parsearAlta(CON_SOCIOS('Socios: +54 9 11 3000-2222 (estudio)')), '2026-10-24').find((p) => p.id === 'skool')
  assert.equal(estudio.detalle[0], 'Aylu invita al cliente por correo desde Skool (Configuración → Invitar); acceso instantáneo, sin solicitud.')
  assert.match(estudio.detalle[1], /Invitalo a Skool: Configuración → Invitar → correo: juan@ejemplo\.com"$/)
  // Con un socio sin correo, el alta espera los datos del closer (y la vista previa dice a quién le falta)
  const falta = planDeAlta(parsearAlta(CON_SOCIOS('Socios: Ana Gómez +54 9 11 3000-2222')), '2026-10-24').find((p) => p.id === 'skool')
  assert.equal(falta.enEspera, true)
  assert.match(falta.detalle.join(' '), /Falta el correo de Ana Gómez: pedíselo al closer\./)
})
