// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-crm-validaciones.mjs
// Controles del paso "Alta en el CRM de Clientes" del bot C.J. (lib/bot/alta/crm.ts y crmServidor.ts) que salieron de
// la revisión del 24/10/2026: total razonable, Fee, pago en pesos, renovaciones, Día 1, teléfono del socio, contrato,
// clientes repetidos INACTIVO, lectura vieja, columnas faltantes y el sondeo de fórmulas.
// SIN RED: la parte de servidor lee un snapshot de juguete en una carpeta temporal (CLIENTES_CACHE_DIR) y sin
// credenciales de Google, así que nunca llega a Sheets. Datos inventados.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirPrueba = mkdtempSync(join(tmpdir(), 'bot-crm-validaciones-'))
process.env.CLIENTES_CACHE_DIR = dirPrueba
for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SHEET_ID_CLIENTES', 'VERCEL']) delete process.env[k]

const { parsearAlta, esMontoFee } = await import('../lib/bot/alta/parsear.ts')
const { entradaCrmDesdeAlta, telefonoDelCliente, TOTAL_MAX_USD } = await import('../lib/bot/alta/crm.ts')
const { previsualizarAltaCrm, formulasParaPlan, reiniciarSondeo, LECTURA_FRESCA_MS } = await import('../lib/bot/alta/crmServidor.ts')
const { lecturasRealizadas, reiniciarEstadoDeLectura } = await import('../lib/clientes/leer.ts')
const { ymdASerial } = await import('../lib/clientes/fechas.ts')

const HOY = '2026-10-24'
const ALTA_TXT = (o = {}) => {
  const c = {
    closer: 'Marcos', programa: 'Agencia', tipo: 'PP 3300 USD', pago: '1100 USD · Transferencia USD (Galicia)',
    nombre: 'Lucía Inventada', tel: '+54 9 11 3000-1111', socios: 'ninguno', correo: 'lucia.inventada@example.com',
    dir: 'Calle Falsa 123, CABA', dni: '30111222', cuit: '27-30111222-4', inicio: '24/10/2026',
    cuotas: ['24/11/2026 1100', '24/12/2026 1100'], antesDelTelefono: [], ...o,
  }
  return [
    '#ALTA', `Closer: ${c.closer}`, ...(c.programa ? [`Programa: ${c.programa}`] : []), `Tipo de pago: ${c.tipo}`, `Este pago: ${c.pago}`,
    `Nombre completo: ${c.nombre}`, ...c.antesDelTelefono, `Teléfono: ${c.tel}`, `Socios: ${c.socios}`, `Correo: ${c.correo}`,
    `Dirección: ${c.dir}`, `DNI: ${c.dni}`, `CUIT: ${c.cuit}`, `Inicio del servicio: ${c.inicio}`, 'Cuotas:', ...c.cuotas,
  ].join('\n')
}
// Mapeo con el mensaje original (como lo va a llamar el webhook) y la fecha fija
const mapear = (o = {}, extras = {}) => { const m = ALTA_TXT(o); return entradaCrmDesdeAlta(parsearAlta(m), { mensaje: m, hoy: HOY, ...extras }) }
const motivos = (r) => r.bloqueos.map(b => b.motivo)

describe('total del período 0', () => {
  test('total en pesos ("PIF $3.500.000") → faltante y el precio no llega a la entrada', () => {
    const r = mapear({ tipo: 'PIF $3.500.000', pago: '$3.500.000', cuotas: [] })
    assert.match(r.faltantes.join(' '), /fuera de lo razonable/)
    assert.equal(r.entrada.precioUSD, undefined)
  })

  test('"Tipo de pago" que dice pesos → faltante aunque el número sea chico (solo con el mensaje original)', () => {
    const r = mapear({ tipo: 'PIF 3300 pesos', pago: '3300 USD · Transferencia', cuotas: [] })
    assert.match(r.faltantes.join(' '), /parece estar en pesos/)
    assert.equal(r.entrada.precioUSD, undefined)
  })

  test('la cuota en lugar del total ("PP 1100 x 3") → las cuotas no cierran → faltante', () => {
    const r = mapear({ tipo: 'PP 1100 x 3' })
    assert.match(r.faltantes.join(' '), /las cuotas \(2200\) más este pago \(1100\) dan 3300 y el total dice 1100/)
    assert.equal(r.entrada.precioUSD, undefined)
  })

  test('cuotas que cierran: solo las que faltan + este pago, o la lista completa con este pago incluido', () => {
    assert.equal(mapear().entrada.precioUSD, 3300)
    const incluida = mapear({ cuotas: ['24/10/2026 1100', '24/11/2026 1100', '24/12/2026 1100'] })
    assert.deepEqual(incluida.faltantes, [])
    assert.equal(incluida.entrada.precioUSD, 3300)
  })

  test('formato de antes con ✅: la cuota pagada está en la lista', () => {
    const viejo = 'Tipo de pago: PP $3300\nNombre completo del lead: Juan Pérez\nTeléfono: +54 9 11 3000-1111\n19/10/2026: inicio $1100 ✅\n19/11/2026 cuota $1100⏳\n19/12/2026 finaliza pago $1100⏳'
    const r = entradaCrmDesdeAlta(parsearAlta(viejo), { mensaje: viejo, hoy: '2026-10-19' })
    assert.deepEqual(r.faltantes, [])
    assert.equal(r.entrada.precioUSD, 3300)
  })

  test('menos de USD 500 o más de USD 10.000 → faltante; 2400, 3000 y 8000 pasan sin aviso', () => {
    assert.match(mapear({ tipo: 'PIF 300 USD', pago: '300 USD', cuotas: [] }).faltantes.join(' '), /fuera de lo razonable/)
    assert.match(mapear({ tipo: `PIF ${TOTAL_MAX_USD + 1} USD`, pago: `${TOTAL_MAX_USD + 1} USD`, cuotas: [] }).faltantes.join(' '), /fuera de lo razonable/)
    for (const total of [2400, 3000, 8000]) {
      const r = mapear({ tipo: `PIF ${total} USD`, pago: `${total} USD · Transferencia`, cuotas: [] })
      assert.deepEqual([r.faltantes, r.bloqueos, r.avisos, r.entrada.precioUSD], [[], [], [], total])
    }
  })
})

describe('pago mínimo (Fee) y pagos en pesos', () => {
  test('Fee: frena el alta como bloqueo (no es un dato que falte) y usa la misma regla que el parser', () => {
    const r = mapear({ pago: '300 USD · Transferencia', cuotas: ['24/11/2026 1500', '24/12/2026 1500'] })
    assert.deepEqual(r.faltantes, [])
    assert.deepEqual(motivos(r), ['fee'])
    assert.equal(esMontoFee(499), true)
    assert.deepEqual(motivos(mapear({ tipo: 'PP 3300 USD', pago: '500 USD', cuotas: ['24/11/2026 1400', '24/12/2026 1400'] })), [])
  })

  test('pago en pesos: espera el USD del MEP; con el MEP decide el mínimo (el USD del closer no cuenta)', () => {
    const pesos = { pago: '$1.300.000 ARS (Mercado Pago)' }
    assert.deepEqual(motivos(mapear(pesos)), ['espera_mep'])
    assert.deepEqual(motivos(mapear(pesos, { estePagoUsdMep: NaN })), ['espera_mep'])
    assert.deepEqual(motivos(mapear(pesos, { estePagoUsdMep: 1080 })), [])
    assert.deepEqual(motivos(mapear(pesos, { estePagoUsdMep: 450 })), ['fee'])
    // El closer dice 1100 USD pero pagó en pesos: igual espera el MEP
    assert.deepEqual(motivos(mapear({ pago: '1100 USD · Mercado Pago (pesos)' })), ['espera_mep'])
  })

  test('sin "Este pago" (y sin pesos) → faltante', () => {
    const r = mapear({ pago: 'Transferencia' })
    assert.ok(r.faltantes.includes('Este pago (monto en USD y medio)'))
  })
})

describe('programa: renovaciones y otros programas', () => {
  test('DFY+R en el programa, +R o "renov" en el tipo de pago → bloqueo de renovación', () => {
    assert.deepEqual(motivos(mapear({ programa: 'DFY+R', tipo: 'PP 3400 USD', cuotas: ['24/11/2026 1150', '24/12/2026 1150'] })), ['renovacion'])
    assert.deepEqual(motivos(mapear({ programa: 'DFY+R++', tipo: 'PIF 3800 USD', pago: '3800 USD', cuotas: [] })), ['renovacion'])
    assert.deepEqual(motivos(mapear({ tipo: 'PP 3400 USD +R', cuotas: ['24/11/2026 1150', '24/12/2026 1150'] })), ['renovacion'])
    assert.deepEqual(motivos(mapear({ programa: '', tipo: 'PIF 3400 USD renovación', pago: '3400 USD', cuotas: [] })), ['renovacion'])
    const libre = 'Ingresa pago PIF 3400 usd renovación efectivo\nJuan Pérez\nTel: +54 9 11 3000-1111'
    assert.deepEqual(motivos(entradaCrmDesdeAlta(parsearAlta(libre), { mensaje: libre, hoy: HOY })), ['renovacion'])
  })

  test('DWY u otro programa → bloqueo; Agencia, DFY o sin programa → nada', () => {
    assert.deepEqual(motivos(mapear({ programa: 'DWY' })), ['otro_programa'])
    for (const programa of ['Agencia', 'DFY', '']) assert.deepEqual(motivos(mapear({ programa })), [])
  })
})

describe('Día 1', () => {
  test('fecha imposible ("31/02/2026") → faltante claro para el closer', () => {
    const r = mapear({ inicio: '31/02/2026' })
    assert.ok(r.faltantes.includes('Inicio del servicio: 31/02/2026 no es una fecha válida (dd/mm/aaaa)'))
  })

  test('a más de 30 días de hoy (¿año mal escrito?) → lo confirma un humano; dentro de 30 días, nada', () => {
    const atras = mapear({ inicio: '24/10/2025' })
    assert.deepEqual(motivos(atras), ['confirmar'])
    assert.match(atras.bloqueos[0].detalle, /365 días antes de hoy \(24\/10\/2026\)/)
    assert.deepEqual(motivos(mapear({ inicio: '25/11/2026' })), ['confirmar'])
    assert.deepEqual(motivos(mapear({ inicio: '20/11/2026' })), [])
  })
})

describe('teléfono del cliente y contrato', () => {
  test('"Socios:" antes que "Teléfono:" → igual va el del cliente', () => {
    const m = ALTA_TXT({ socios: 'ninguno', antesDelTelefono: ['Socios: Ana Socia +54 9 223 400-2222'] }).replace('\nSocios: ninguno', '')
    const a = parsearAlta(m)
    assert.equal(a.telefonos[0].numero, '5492234002222')   // el parser los deja en orden de aparición
    const r = entradaCrmDesdeAlta(a, { mensaje: m, hoy: HOY })
    assert.equal(r.entrada.celular, '+5491130001111')
    assert.match(r.avisos.join(' '), /1 teléfono\(s\) más/)
  })

  test('solo vinieron teléfonos de socios → faltante; "Teléfono y de los socios" → el primero', () => {
    const soloSocio = parsearAlta('#ALTA\nNombre completo: Juan Pérez\nSocios: Ana +54 9 223 400-2222')
    assert.equal(telefonoDelCliente(soloSocio), null)
    assert.ok(entradaCrmDesdeAlta(soloSocio, { hoy: HOY }).faltantes.includes('Teléfono del cliente (solo vinieron los de los socios)'))
    const viejo = parsearAlta('Teléfono y de los socios: +54 9 11 3000-1111, +54 9 223 400-2222 nicolas')
    assert.equal(telefonoDelCliente(viejo).numero, '5491130001111')
  })

  test('contrato: "Hacer" sin el estado de PandaDoc; el estado real si está en la lista de Config', () => {
    assert.equal(mapear().entrada.contrato, 'Hacer')
    assert.equal(mapear({}, { contrato: 'enviado' }).entrada.contrato, 'Enviado')
    const raro = mapear({}, { contrato: 'Mandado' })
    assert.equal(raro.entrada.contrato, 'Hacer')
    assert.match(raro.avisos.join(' '), /"Mandado" fuera de la lista de Config/)
  })
})

// ── Servidor: snapshot de juguete, sin red ──
const S = (ymd) => ymdASerial(ymd)
const AG_HEAD = ['', '', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó', 'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Semaforo de Clientes', 'Testimonio', 'Notas renovación', 'Anotaciones']
const RE_HEAD = ['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 4)']
const AGENCIA = [
  AG_HEAD,
  ['A001', 'Cliente Inactivo', 'INACTIVO', '+5491144445555', 'inactivo@example.com', 'Gero', '', 'Firmado', S('2026-01-10')],
  ['A002', 'Cliente Vigente', 'ACTIVO', '+5491155556666', 'vigente@example.com', 'Marcos', '', 'Firmado', S('2026-09-01')],
  ['A003', 'Cliente Finalizado', 'FINALIZADO', '54 9 11 6666-7777', 'finalizado@example.com', 'Gero', '', 'Firmado', S('2026-01-01')],
]
const RENOV = [RE_HEAD, ['A001', 'Cliente Inactivo', 0, S('2026-01-10'), S('2026-05-10'), 2600, ''], ['A002', 'Cliente Vigente', 0, S('2026-09-01'), S('2027-01-01'), 3300, ''], ['A003', 'Cliente Finalizado', 0, S('2026-01-01'), S('2026-05-01'), 2400, '']]
let mtime = 1_700_000_000
function escribirSnapshot({ edadMs = 0, agencia = AGENCIA, formulasAgencia = null, reintentarDesde = 0 } = {}) {
  const ruta = join(dirPrueba, 'clientes-snapshot.json')
  writeFileSync(ruta, JSON.stringify({
    version: 1, guardadoEn: Date.now() - edadMs, invalidado: false, ausentes: {}, reintentarDesde,
    hojas: { agencia, consultora: [['ID', 'Nombre', 'Estado', 'Celular']], renovaciones: RENOV, referidos: null, creditos: null, config: null },
    formulasAgencia, formulasRenovaciones: null,
  }))
  mtime += 10; utimesSync(ruta, mtime, mtime)   // el snapshot se cachea en memoria por mtime: cada prueba, uno distinto
}
const previa = (o = {}, extras = {}) => { const m = ALTA_TXT(o); return previsualizarAltaCrm(parsearAlta(m), { mensaje: m, hoy: HOY, ...extras }) }

describe('vista previa contra un CRM de juguete (crmServidor.ts, sin red)', () => {
  before(() => { reiniciarEstadoDeLectura(); reiniciarSondeo() })
  after(() => rmSync(dirPrueba, { recursive: true, force: true }))

  test('lectura fresca, sin repetidos: apta para escribir, fórmulas deducidas sin sondear, 0 llamadas a Sheets', async () => {
    escribirSnapshot()
    const p = await previa()
    assert.equal(p.plan.ok, true, p.plan.errores.join(' '))
    assert.equal(p.plan.idNuevo, 'A004')
    assert.deepEqual([p.faltantes, p.bloqueos, p.parser.faltantes], [[], [], []])
    assert.equal(p.lectura.fuente, 'snapshot')
    assert.equal(p.lectura.formulas, 'deducidas')
    assert.equal(p.aptoParaEscribir, true, p.motivosNoApto.join(' | '))
    assert.equal(lecturasRealizadas(), 0)
  })

  test('coincide con un cliente INACTIVO → check humano; con uno FINALIZADO → solo la advertencia de planAlta', async () => {
    escribirSnapshot()
    const inactivo = await previa({ tel: '+54 9 11 4444-5555' })
    assert.equal(inactivo.plan.ok, true)   // planAlta solo frena ACTIVO y PAUSADO
    assert.deepEqual(motivos(inactivo), ['confirmar'])
    assert.match(inactivo.bloqueos[0].detalle, /A001 \(INACTIVO, por celular\)/)
    assert.equal(inactivo.aptoParaEscribir, false)
    const finalizado = await previa({ tel: '+54 9 11 6666-7777' })
    assert.deepEqual(finalizado.bloqueos, [])
    assert.match(finalizado.plan.advertencias.join(' '), /A003 \(FINALIZADO, por celular\)/)
    assert.equal(finalizado.aptoParaEscribir, true)
  })

  test('lectura de hace 2 min: el plan sale, pero no es apta para escribir (hay que releer forzando)', async () => {
    escribirSnapshot({ edadMs: 2 * 60_000 })
    const p = await previa()
    assert.equal(p.plan.ok, true)
    assert.ok(p.lectura.edadSeg >= 120)
    assert.equal(p.aptoParaEscribir, false)
    assert.match(p.motivosNoApto.join(' '), new RegExp(`máximo ${LECTURA_FRESCA_MS / 1000} s`))
  })

  test('snapshot viejo tras un error (429): no se sondean fórmulas, no se llama a Sheets y no es apta', async () => {
    escribirSnapshot({ edadMs: 30 * 60_000, reintentarDesde: Date.now() + 60_000 })
    const p = await previa()
    assert.equal(p.lectura.fuente, 'snapshot_viejo')
    assert.equal(p.lectura.formulas, 'deducidas')
    assert.ok(p.lectura.avisos.some(x => /error reciente/.test(x)))
    assert.equal(p.aptoParaEscribir, false)
    assert.equal(lecturasRealizadas(), 0)
  })

  test('sin la columna "Celular" en Agencia → bloqueo de lectura (si no, los repetidos por celular se apagan sin avisar)', async () => {
    escribirSnapshot({ agencia: AGENCIA.map((f, i) => (i === 0 ? f.map(h => (h === 'Celular' ? 'Número' : h)) : f)) })
    const p = await previa({ tel: '+54 9 11 4444-5555' })
    assert.ok(p.bloqueos.some(b => b.motivo === 'lectura' && /"Celular"/.test(b.detalle)))
    assert.equal(p.aptoParaEscribir, false)
  })

  test('faltantes y avisos del parser también viajan en la respuesta', async () => {
    escribirSnapshot()
    const p = await previa({ dni: '', cuit: '' })
    assert.ok(p.parser.faltantes.includes('DNI'))
    assert.match(p.motivosNoApto.join(' '), /Faltan datos del closer: DNI, CUIT/)
    assert.equal(p.aptoParaEscribir, false)
  })
})

describe('sondeo de fórmulas: mismas precauciones de cuota que la lectura', () => {
  before(() => reiniciarSondeo())
  const FORM = { agencia: { 'J Fin período actual': '=…' }, renovaciones: {} }

  test('si el snapshot ya las tiene no se sondea; con un snapshot guardado tampoco', async () => {
    let llamadas = 0
    const sondear = async () => { llamadas++; return FORM }
    assert.deepEqual((await formulasParaPlan({ formulasAgencia: { 'K Renovó': '=…' } }, 'sheets', sondear)).formulas, { 'K Renovó': '=…' })
    assert.equal((await formulasParaPlan({ formulasAgencia: null }, 'snapshot', sondear)).formulas, null)
    assert.equal((await formulasParaPlan({ formulasAgencia: null }, 'snapshot_viejo', sondear)).formulas, null)
    assert.equal(llamadas, 0)
    assert.deepEqual((await formulasParaPlan({ formulasAgencia: null }, 'sheets', sondear)).formulas, FORM.agencia)
    assert.equal(llamadas, 1)
  })

  test('si el sondeo falla, no se reintenta por 60 s', async () => {
    let llamadas = 0
    const falla = async () => { llamadas++; throw new Error('429 Too Many Requests') }
    const r1 = await formulasParaPlan({ formulasAgencia: null }, 'sheets', falla)
    assert.equal(r1.formulas, null)
    assert.match(r1.aviso, /5 conocidas/)
    const r2 = await formulasParaPlan({ formulasAgencia: null }, 'sheets', falla)
    assert.deepEqual([r2.formulas, r2.aviso, llamadas], [null, undefined, 1])
    await formulasParaPlan({ formulasAgencia: null }, 'sheets', falla, Date.now() + 61_000)
    assert.equal(llamadas, 2)
  })
})
