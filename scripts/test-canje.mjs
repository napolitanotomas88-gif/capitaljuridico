// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-canje.mjs
// Canje de créditos (simulación) y contrato de afiliados externos. SOLO lógica pura: no toca red, Sheets ni base de datos.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validarCanje, decidirCanje, huellaCanje, huellaPedidoCanje, relacionConPrevia, estadoEscrituraCanje, rolPuedeCanjear } from '../lib/clientes/canje.ts'
import { esIdAfiliadoExterno, validarReferidoExterno, decidirReferidoExterno, soloDeClientes, puedeAcreditarAfiliadoExterno, rolGestionaAfiliados, RECOMPENSA_AFILIADO_EXTERNO } from '../lib/clientes/afiliadosExternos.ts'
import { calcularCreditos, calcularCreditosDeTodos } from '../lib/clientes/creditos.ts'
import { calcularCreditosDeDatos, resumirPrograma } from '../lib/clientes/programa.ts'
import { REGLAS_REFERIDOS } from '../lib/clientes/reglasReferidos.ts'
import { sumarDias } from '../lib/clientes/fechas.ts'

const HOY = '2026-10-06'
const R0 = { ...REGLAS_REFERIDOS, vigenteDesde: '2000-01-01' }
const REF = (o = {}) => ({
  id: 'R001', fila: 2, fechaPedido: null, momento: '', idReferidor: 'A001', nombre: 'Lead', telefono: '', mail: '', estudio: '',
  estado: 'No cerró', fechaLlamada: '2026-08-01', idClienteNuevo: '', fechaPrimerPago: null, fechaLiberacion: null, reembolso: false, notas: '', cargadoPor: '', ...o,
})
const intentos = n => Array.from({ length: n }, (_, i) => REF({ id: `S${String(i + 1).padStart(3, '0')}`, fechaLlamada: sumarDias('2026-08-01', i) }))
const cierres = n => Array.from({ length: n }, (_, i) => REF({ id: `R${String(i + 1).padStart(3, '0')}`, estado: 'Cerró', fechaLlamada: '2026-09-01', fechaPrimerPago: '2026-09-10' }))
const resumen = (referidos, movimientos = []) => calcularCreditos({ idCliente: 'A001', referidos, hoy: HOY, movimientos }, R0)
const entrada = (o = {}) => ({ idCliente: 'a001', renovacionAplicada: '  Renovación   2026-11 ', fecha: HOY, claveEnvio: 'k1', ...o })
const valida = (o = {}) => { const v = validarCanje(entrada(o), HOY, R0); assert.ok(v.ok, JSON.stringify(v)); return v.canje }

describe('validarCanje', () => {
  test('normaliza el ID, el texto y usa hoy si no hay fecha', () => {
    const c = valida({ fecha: undefined })
    assert.deepEqual(c, { idCliente: 'A001', renovacionAplicada: 'Renovación 2026-11', fecha: HOY, contexto: 'renovacion', claveEnvio: 'k1' })
  })
  test('rechaza cliente mal escrito, afiliado externo, renovación vacía, fecha futura/inválida/anterior al programa y falta de clave', () => {
    const e = (o) => { const v = validarCanje(entrada(o), HOY, REGLAS_REFERIDOS); assert.equal(v.ok, false); return v.errores }
    assert.ok(e({ idCliente: 'xx' }).idCliente)
    assert.match(e({ idCliente: 'X001' }).idCliente, /afiliados externos/)
    assert.ok(e({ renovacionAplicada: ' a ' }).renovacionAplicada)
    assert.ok(e({ fecha: '2026-10-07' }).fecha)
    assert.ok(e({ fecha: '2026-02-30' }).fecha)
    assert.match(e({ fecha: '2026-10-05' }).fecha, /retroactiva/)   // la fecha pasada ya no se admite
    assert.match(e({ fecha: '2026-09-30' }).fecha, /retroactiva/)
    assert.ok(e({ claveEnvio: '' }).claveEnvio)
  })
  test('nunca en efectivo y contexto desconocido inválido; "renovacion" explícito vale', () => {
    assert.match(validarCanje(entrada({ contexto: 'efectivo' }), HOY, R0).errores.contexto, /efectivo/)
    assert.ok(validarCanje(entrada({ contexto: 'cheque' }), HOY, R0).errores.contexto)
    assert.ok(validarCanje(entrada({ contexto: 'renovacion' }), HOY, R0).ok)
  })
})

describe('decidirCanje: monedas separadas', () => {
  test('con 3 cierres y 4 intentos: meses y USD salen cada uno en su unidad, sin sumarse', () => {
    const d = decidirCanje(valida(), resumen([...cierres(3), ...intentos(4)]), 'ana@x.com', R0)
    assert.equal(d.tipo, 'simulable')
    assert.equal(d.saldo.meses, 4); assert.equal(d.saldo.usd, 600); assert.equal(d.saldo.renovacionGratis, true)
    assert.equal(d.movimiento.tipo, 'canje'); assert.equal(d.movimiento.meses, -4)
    assert.equal(d.movimiento.extra, 'renovación gratis + USD 600')
    assert.equal(d.referenciaMeses.pagoUnicoUSD, 2600); assert.equal(d.referenciaMeses.planDePagosUSD, 3800)
    assert.notEqual(d.saldo.usd, d.referenciaMeses.pagoUnicoUSD + d.saldo.usd)   // la referencia de los meses no se suma al saldo en USD
    assert.deepEqual(Object.keys(d.saldo).sort(), ['extras', 'meses', 'renovacionGratis', 'usd'])
  })
  test('solo USD (2 intentos): no hay meses y el movimiento no inventa meses', () => {
    const d = decidirCanje(valida(), resumen(intentos(2)), '', R0)
    assert.equal(d.saldo.meses, 0); assert.equal(d.saldo.usd, 300); assert.equal(d.movimiento.meses, 0); assert.equal(d.movimiento.extra, 'USD 300')
  })
  test('solo meses (1 cierre): sin USD', () => {
    const d = decidirCanje(valida(), resumen(cierres(1)), '', R0)
    assert.equal(d.saldo.meses, 1); assert.equal(d.saldo.usd, 0); assert.equal(d.movimiento.meses, -1); assert.equal(d.movimiento.extra, '')
  })
  test('sin saldo (solo web con 1 intento), sin resumen, afiliado externo y fecha anterior al último canje se rechazan', () => {
    assert.equal(decidirCanje(valida(), resumen(intentos(1)), '', R0).codigo, 'sin_saldo')
    assert.equal(decidirCanje(valida(), undefined, '', R0).codigo, 'cliente_inexistente')
    assert.equal(decidirCanje({ ...valida(), idCliente: 'X001' }, resumen(cierres(1)), '', R0).codigo, 'afiliado_externo')
    const conCanje = resumen(cierres(1), [{ id: 'M1', fila: 2, fecha: '2026-10-01', idCliente: 'A001', tipo: 'canje', idReferido: '', meses: -1, extra: '', vence: null, renovacionAplicada: 'R2', nota: '', cargadoPor: '' }])
    assert.equal(decidirCanje({ ...valida(), fecha: '2026-09-20' }, conCanje, '', R0).codigo, 'fecha_retroactiva')
  })
  test('idempotencia natural: tras asentar el canje el saldo del ciclo queda en cero y repetirlo se rechaza', () => {
    const antes = resumen([...cierres(1), ...intentos(2)])
    const d = decidirCanje(valida(), antes, '', R0); assert.equal(d.tipo, 'simulable')
    const asentado = { id: 'M1', fila: 2, ...d.movimiento }
    const despues = resumen([...cierres(1), ...intentos(2)], [asentado])
    assert.equal(decidirCanje(valida(), despues, '', R0).codigo, 'sin_saldo')
  })
  test('texto con fórmula no se cuela en la celda (renovación y cargado por)', () => {
    const d = decidirCanje(valida({ renovacionAplicada: '=HYPERLINK("x")' }), resumen(cierres(1)), '=cmd', R0)
    assert.equal(d.movimiento.renovacionAplicada.startsWith("'="), true); assert.equal(d.movimiento.cargadoPor, "'=cmd")
  })
  test('no modifica el resumen de entrada', () => {
    const r = resumen(cierres(2)); const copia = JSON.stringify(r)
    decidirCanje(valida(), r, '', R0); assert.equal(JSON.stringify(r), copia)
  })
})

describe('P1: canje con fecha retroactiva no abre doble gasto (regresión del revisor)', () => {
  // intento 1 el 1/10 (web) e intento 2 el 6/10 (USD 300), hoy = 6/10
  const rep = [REF({ id: 'S1', fechaLlamada: '2026-10-01' }), REF({ id: 'S2', fechaLlamada: '2026-10-06' })]
  test('con fecha 5/10 se rechaza (antes tomaba el USD 300 ganado el 6/10 y al asentarse volvía a quedar disponible)', () => {
    assert.equal(validarCanje(entrada({ fecha: '2026-10-05' }), HOY, R0).ok, false)
    assert.equal(decidirCanje({ ...valida(), fecha: '2026-10-05' }, resumen(rep), 'ana@x.com', R0).codigo, 'fecha_retroactiva')
  })
  test('con la fecha de hoy se simula USD 300 y, al asentar el movimiento, el saldo queda en cero: no se puede repetir', () => {
    const d = decidirCanje(valida(), resumen(rep), 'ana@x.com', R0)
    assert.equal(d.tipo, 'simulable'); assert.equal(d.saldo.usd, 300); assert.equal(d.saldo.meses, 0)
    const despues = resumen(rep, [{ id: 'M1', fila: 2, ...d.movimiento }])
    assert.equal(despues.usd.disponible, 0)
    assert.equal(decidirCanje(valida({ claveEnvio: 'otra' }), despues, 'ana@x.com', R0).codigo, 'sin_saldo')
  })
  test('la política de saldo completo está confirmada por Tomás (27/10/2026)', () => {
    const d = decidirCanje(valida(), resumen(rep), '', R0)
    assert.equal(d.politicaSaldo.estado, 'confirmada'); assert.match(d.politicaSaldo.texto, /confirmada por Tomás/)
  })
})

describe('huella e idempotencia por clave', () => {
  test('el actor entra en la huella del pedido y del contenido', () => {
    const c = valida(); const saldo = { meses: 1, usd: 0, renovacionGratis: false, extras: [] }
    assert.notEqual(huellaPedidoCanje(c, 'a@x.com'), huellaPedidoCanje(c, 'b@x.com')); assert.equal(huellaPedidoCanje(c, ' A@x.com '), huellaPedidoCanje(c, 'a@x.com'))
    assert.notEqual(huellaCanje(c, saldo, 'v1', null, 'a@x.com'), huellaCanje(c, saldo, 'v1', null, 'b@x.com'))
  })
  const saldo = { meses: 1, usd: 300, renovacionGratis: false, extras: [] }
  test('la huella es estable y cambia con cualquier dato relevante', () => {
    const c = valida(); const h = huellaCanje(c, saldo, 'v1', null)
    assert.equal(h, huellaCanje({ ...c }, { ...saldo }, 'v1', null))
    for (const otro of [huellaCanje({ ...c, fecha: '2026-10-04' }, saldo, 'v1', null), huellaCanje({ ...c, renovacionAplicada: 'otra' }, saldo, 'v1', null), huellaCanje(c, { ...saldo, usd: 450 }, 'v1', null), huellaCanje(c, { ...saldo, meses: 2 }, 'v1', null), huellaCanje(c, saldo, 'v2', null), huellaCanje(c, saldo, 'v1', '2026-09-01'), huellaCanje({ ...c, idCliente: 'A002' }, saldo, 'v1', null)]) assert.notEqual(otro, h)
  })
  test('misma clave y mismo contenido = misma operación; misma clave con otro contenido = conflicto; otra clave = nueva', () => {
    assert.equal(relacionConPrevia(null, { clave: 'k', huella: 'h' }), 'nueva')
    assert.equal(relacionConPrevia({ clave: 'k', huella: 'h' }, { clave: 'k', huella: 'h' }), 'misma_operacion')
    assert.equal(relacionConPrevia({ clave: 'k', huella: 'h' }, { clave: 'k', huella: 'otra' }), 'clave_reutilizada')
    assert.equal(relacionConPrevia({ clave: 'k', huella: 'h' }, { clave: 'k2', huella: 'h' }), 'nueva')
  })
})

describe('estado de la escritura: bloqueo sin Postgres, real con bandera y base', () => {
  test('sin bandera: simulación', () => assert.equal(estadoEscrituraCanje(false, false).modo, 'simulacion'))
  test('sin bandera aunque haya base: sigue siendo simulación', () => assert.equal(estadoEscrituraCanje(false, true).modo, 'simulacion'))
  test('con bandera y sin Postgres: bloqueada por falta de base', () => {
    const e = estadoEscrituraCanje(true, false); assert.equal(e.modo, 'bloqueada'); assert.equal(e.codigo, 'sin_base_de_datos'); assert.match(e.motivo, /Postgres/)
  })
  test('con bandera y con Postgres: escritura real (la ruta conecta el escritor; conectado 27/10/2026)', () => {
    const e = estadoEscrituraCanje(true, true); assert.equal(e.modo, 'real'); assert.equal('codigo' in e, false)
  })
})

describe('permisos', () => {
  test('canjean los roles que ven Referidos (socio y csm); closer, setter y nadie, no', () => {
    assert.equal(rolPuedeCanjear('socio'), true); assert.equal(rolPuedeCanjear('csm'), true)
    for (const r of ['closer', 'setter', null, undefined, 'admin', '__proto__']) assert.equal(rolPuedeCanjear(r), false)
  })
})

describe('P2: los afiliados externos no entran al pipeline real de créditos', () => {
  const X = [REF({ id: 'R900', idReferidor: 'X001', estado: 'Cerró', fechaPrimerPago: '2026-09-10', fechaLlamada: '2026-09-01' }), REF({ id: 'S900', idReferidor: 'X001' }), ...cierres(1)]
  const movX = [{ id: 'M9', fila: 2, fecha: '2026-09-30', idCliente: 'X001', tipo: 'ajuste', idReferido: '', meses: 3, extra: '', vence: null, renovacionAplicada: '', nota: '', cargadoPor: '' }]
  test('calcularCreditosDeTodos no genera créditos para X### (ni por referidos ni por movimientos) y sigue calculando A001', () => {
    const m = calcularCreditosDeTodos({ referidos: X, movimientos: movX, hoy: HOY }, R0)
    assert.equal(m.has('X001'), false); assert.equal(m.has('A001'), true)
  })
  test('calcularCreditosDeDatos (programa.ts, el camino de las pantallas) tampoco', () => {
    const m = calcularCreditosDeDatos({ clientes: [], referidos: X, movimientos: movX, hoy: HOY, reglas: R0 })
    assert.deepEqual([...m.keys()].sort(), ['A001'])
  })
  test('calcularCreditos con un X### directo falla; resumirPrograma no lo cuenta en embudo, ranking ni totales', () => {
    assert.throws(() => calcularCreditos({ idCliente: 'X001', referidos: X, hoy: HOY }, R0), /afiliados externos/)
    const creditos = calcularCreditosDeDatos({ clientes: [], referidos: X, movimientos: movX, hoy: HOY, reglas: R0 })
    const sinX = resumirPrograma({ clientes: [], referidos: cierres(1), movimientos: [], creditos: calcularCreditosDeDatos({ clientes: [], referidos: cierres(1), movimientos: [], hoy: HOY, reglas: R0 }), hoy: HOY }, R0)
    const conX = resumirPrograma({ clientes: [], referidos: X, movimientos: movX, creditos: new Map([...creditos, ['X001', resumen(X)]]), hoy: HOY }, R0)
    assert.equal(conX.ranking.some(f => f.idCliente === 'X001'), false)
    assert.deepEqual(conX.embudo, sinX.embudo); assert.deepEqual(conX.creditos, sinX.creditos); assert.equal(conX.referidoresActivos, 1)
  })
})

describe('contrato de afiliados externos (sin recompensa)', () => {
  const ok = { idAfiliado: 'x001', nombre: ' Pablo  Díaz ', telefono: '+54 9 11 5555-1234' }
  test('IDs propios X###: no se confunden con clientes ni con los ejemplos E###', () => {
    assert.equal(esIdAfiliadoExterno('X001'), true); assert.equal(esIdAfiliadoExterno(' x123 '), true)
    for (const id of ['A001', 'C012', 'E001', 'X', 'X1', '', null, 5]) assert.equal(esIdAfiliadoExterno(id), false)
  })
  test('alta válida normaliza; el teléfono se reduce a sus últimos 8 dígitos', () => {
    const v = validarReferidoExterno(ok); assert.ok(v.ok)
    assert.deepEqual([v.idAfiliado, v.nombre, v.telefonoClave], ['X001', 'Pablo Díaz', '55551234'])
  })
  test('rechaza un cliente como afiliado, nombre corto y teléfono inválido', () => {
    const v = validarReferidoExterno({ idAfiliado: 'A001', nombre: 'ab', telefono: '12' }); assert.equal(v.ok, false)
    assert.ok(v.errores.idAfiliado && v.errores.nombre && v.errores.telefono)
  })
  test('cualquier campo de recompensa se RECHAZA (no se ignora): nada de premios inventados', () => {
    for (const campo of ['recompensa', 'comision', 'comisión', 'descuento', 'creditos', 'créditos', 'monto', 'usd', 'meses', 'premio', 'bono']) {
      const v = validarReferidoExterno({ ...ok, [campo]: 100 }); assert.equal(v.ok, false, campo); assert.match(v.errores.recompensa, /no está definida/)
    }
  })
  test('la recompensa es "por definir" y no acredita nada; solo el socio gestiona', () => {
    assert.deepEqual({ ...RECOMPENSA_AFILIADO_EXTERNO }, { definida: false, moneda: null, monto: null, estado: 'por_definir' })
    assert.equal(Object.isFrozen(RECOMPENSA_AFILIADO_EXTERNO), true); assert.equal(puedeAcreditarAfiliadoExterno(), false)
    assert.equal(rolGestionaAfiliados('socio'), true); for (const r of ['csm', 'closer', 'setter', null]) assert.equal(rolGestionaAfiliados(r), false)
  })
  test('idempotencia por persona: mismo afiliado y teléfono = duplicado; otro afiliado = conflicto; inactivo o inexistente = rechazo', () => {
    const afiliados = [{ id: 'X001', nombre: 'a', contacto: '', estado: 'activo', alta: '2026-10-01' }, { id: 'X002', nombre: 'b', contacto: '', estado: 'activo', alta: '2026-10-01' }, { id: 'X003', nombre: 'c', contacto: '', estado: 'baja', alta: '2026-10-01' }]
    const existentes = [{ id: 'P1', idAfiliado: 'X001', telefonoClave: '55551234' }]
    assert.deepEqual(decidirReferidoExterno({ idAfiliado: 'X001', telefonoClave: '99999999' }, afiliados, existentes), { tipo: 'nuevo' })
    assert.deepEqual(decidirReferidoExterno({ idAfiliado: 'X001', telefonoClave: '55551234' }, afiliados, existentes), { tipo: 'duplicado', idExistente: 'P1' })
    assert.equal(decidirReferidoExterno({ idAfiliado: 'X002', telefonoClave: '55551234' }, afiliados, existentes).codigo, 'otro_afiliado')
    assert.equal(decidirReferidoExterno({ idAfiliado: 'X003', telefonoClave: '1' }, afiliados, existentes).codigo, 'afiliado_inactivo')
    assert.equal(decidirReferidoExterno({ idAfiliado: 'X009', telefonoClave: '1' }, afiliados, existentes).codigo, 'afiliado_inexistente')
  })
  test('separación de monedas y de origen: los referidos de afiliados externos no entran al cálculo de créditos de clientes', () => {
    const todos = [...cierres(1), REF({ id: 'R900', idReferidor: 'X001', estado: 'Cerró', fechaPrimerPago: '2026-09-10' })]
    assert.equal(soloDeClientes(todos).length, 1)
    assert.equal(resumen(soloDeClientes(todos)).cierresLiberados, 1)
    // calcularCreditos solo cuenta los referidos del idReferidor pedido: pedir el de un externo no produce crédito de cliente
    assert.throws(() => calcularCreditos({ idCliente: 'X001', referidos: [], hoy: HOY }, R0), /afiliados externos/)
  })
})
