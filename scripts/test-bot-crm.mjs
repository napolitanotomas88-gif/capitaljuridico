// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-crm.mjs
// Paso "Alta en el CRM de Clientes" del bot C.J. (lib/bot/alta/crm.ts): del #ALTA a la EntradaAlta de planAlta().
// Puro y sin red (datos inventados). Al final, una pasada por planAlta() con un CRM de juguete para ver que encajan.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parsearAlta } from '../lib/bot/alta/parsear.ts'
import { entradaCrmDesdeAlta, celularCrm, closerCanonico, CONTRATO_SIN_ENVIAR } from '../lib/bot/alta/crm.ts'
const HOY = '2026-10-24'   // el Día 1 de los ejemplos: así el control de "Día 1 lejano" no depende de cuándo se corre
import { planAlta } from '../lib/clientes/altas.ts'
import { ymdASerial } from '../lib/clientes/fechas.ts'

const ALTA = (o = {}) => {
  const c = {
    closer: 'Marcos', programa: 'Agencia', tipo: 'PP 3300 USD', pago: '1100 USD · Transferencia USD (Galicia)',
    nombre: 'Lucía Inventada', tel: '+54 9 11 3000-1111', socios: 'ninguno', correo: 'Lucia.Inventada@Example.com',
    dir: 'Calle Falsa 123, CABA', dni: '30111222', cuit: '27-30111222-4', inicio: '24/10/2026', contrato: '',
    cuotas: ['24/11/2026 1100', '24/12/2026 1100'], ...o,
  }
  return parsearAlta([
    '#ALTA', `Closer: ${c.closer}`, `Programa: ${c.programa}`, `Tipo de pago: ${c.tipo}`, `Este pago: ${c.pago}`,
    `Nombre completo: ${c.nombre}`, `Teléfono: ${c.tel}`, `Socios: ${c.socios}`, `Correo: ${c.correo}`, `Dirección: ${c.dir}`,
    `DNI: ${c.dni}`, `CUIT: ${c.cuit}`, `Inicio del servicio: ${c.inicio}`, ...(c.contrato ? [`Contrato: ${c.contrato}`] : []),
    'Cuotas:', ...c.cuotas,
  ].join('\n'))
}

describe('mapeo #ALTA → EntradaAlta', () => {
  test('alta completa: todos los campos, sin faltantes', () => {
    const { entrada, faltantes, bloqueos, avisos } = entradaCrmDesdeAlta(ALTA(), { fuente: 'Anuncios', hoy: HOY })
    assert.deepEqual(faltantes, [])
    assert.deepEqual(bloqueos, [])
    assert.deepEqual(avisos, [])
    assert.deepEqual(entrada, {
      nombre: 'Lucía Inventada', celular: '+5491130001111', dia1: '2026-10-24', mail: 'lucia.inventada@example.com',
      closer: 'Marcos', fuente: 'Anuncios', contrato: 'Hacer', producto: 'inicial_3300', precioUSD: 3300,
      anotaciones: 'Alta automática del bot C.J. (#ALTA de Marcos)',
    })
    assert.equal(CONTRATO_SIN_ENVIAR, 'Hacer')   // sin el estado real de PandaDoc no dice "Enviado"
    assert.equal('meses' in entrada, false)   // meses por defecto: los del producto
  })

  test('el total pisa la tabla aunque no sea un precio conocido (sin aviso: 2400 y 3000 son comunes)', () => {
    const { entrada, avisos } = entradaCrmDesdeAlta(ALTA({ tipo: 'PIF 3000 USD', pago: '3000 USD · Transferencia', cuotas: [] }), { hoy: HOY })
    assert.equal(entrada.precioUSD, 3000)
    assert.equal(entrada.producto, undefined)
    assert.deepEqual(avisos, [])
  })

  test('sin total en USD → faltante', () => {
    const { entrada, faltantes } = entradaCrmDesdeAlta(ALTA({ tipo: 'PP', cuotas: [] }))
    assert.equal(entrada.precioUSD, undefined)
    assert.ok(faltantes.some(f => /Total en USD/.test(f)))
  })

  test('sin nombre, sin teléfono, sin inicio → faltantes', () => {
    const { entrada, faltantes } = entradaCrmDesdeAlta(ALTA({ nombre: '', tel: '', inicio: '', cuotas: [] }))
    assert.deepEqual(faltantes, ['Nombre completo', 'Teléfono', 'Inicio del servicio'])
    assert.equal(entrada.celular, '')
    assert.equal(entrada.dia1, '')
  })

  test('celular: solo el del cliente, con + y código de país; los socios no van', () => {
    const { entrada, avisos } = entradaCrmDesdeAlta(ALTA({ socios: 'Ana Socia +54 9 223 400-2222' }))
    assert.equal(entrada.celular, '+5491130001111')
    assert.match(avisos.join(' '), /1 teléfono\(s\) más/)
    assert.equal(celularCrm('34600111222'), '+34600111222')
    assert.equal(celularCrm('1530001111'), '1530001111')   // sin país: queda como vino
    assert.equal(celularCrm(''), '')
  })

  test('teléfono sin código de país → faltante (igual que en el parser)', () => {
    const a = ALTA({ tel: '15 3000-1111' })
    const { entrada, faltantes } = entradaCrmDesdeAlta(a)
    assert.equal(entrada.celular, '1530001111')
    assert.ok(faltantes.includes('Teléfono con código de país (ej. +54 9 11 …)'))
    assert.ok(a.faltantes.includes('Teléfono con código de país (ej. +54 9 11 …)'))
  })

  test('los últimos 7 dígitos del celular coinciden con los del pago (LTV cobrado)', () => {
    const { entrada } = entradaCrmDesdeAlta(ALTA({ tel: '011 15 3000-1111' }))
    assert.equal(entrada.celular, '+5491130001111')
    assert.equal(entrada.celular.replace(/\D/g, '').slice(-7), '0001111')
  })

  test('closer: se escribe como figura en Agencia; si no figura, como vino y con aviso', () => {
    const conocidos = ['Gero', 'Fer', 'Marcos', 'Carlos']
    assert.equal(entradaCrmDesdeAlta(ALTA({ closer: 'marcos' }), { closersConocidos: conocidos }).entrada.closer, 'Marcos')
    assert.equal(entradaCrmDesdeAlta(ALTA({ closer: 'Carlos Inventado' }), { closersConocidos: conocidos }).entrada.closer, 'Carlos')
    const r = entradaCrmDesdeAlta(ALTA({ closer: 'Rodrigo' }), { closersConocidos: conocidos })
    assert.equal(r.entrada.closer, 'Rodrigo')
    assert.match(r.avisos.join(' '), /"Rodrigo" no figura en Agencia/)
    assert.equal(closerCanonico('GÉRO', ['Gero']), 'Gero')
    assert.equal(closerCanonico('', ['Gero']), null)
  })

  test('anotaciones: closer, sin closer y contrato con garantía', () => {
    assert.equal(entradaCrmDesdeAlta(ALTA({ contrato: 'Garantía' })).entrada.anotaciones, 'Alta automática del bot C.J. (#ALTA de Marcos) · contrato con GARANTÍA')
    const sin = entradaCrmDesdeAlta(ALTA({ closer: '' }))
    assert.equal(sin.entrada.anotaciones, 'Alta automática del bot C.J. (#ALTA sin closer)')
    assert.equal('closer' in sin.entrada, false)
    assert.match(sin.avisos.join(' '), /Sin closer/)
  })

  test('sin correo, sin fuente: no se mandan vacíos (aviso por el correo)', () => {
    const { entrada, avisos } = entradaCrmDesdeAlta(ALTA({ correo: '' }))
    assert.equal('mail' in entrada, false)
    assert.equal('fuente' in entrada, false)
    assert.match(avisos.join(' '), /Sin correo/)
  })

  test('programa que no es Agencia y pago menor al mínimo → bloqueos (frenan el alta)', () => {
    const r = entradaCrmDesdeAlta(ALTA({ programa: 'Consultora', pago: '300 USD · Transferencia', cuotas: ['24/11/2026 1500', '24/12/2026 1500'] }), { hoy: HOY })
    assert.deepEqual(r.bloqueos.map(b => b.motivo), ['otro_programa', 'fee'])
    assert.match(r.bloqueos[0].detalle, /Programa "Consultora"/)
    assert.match(r.bloqueos[1].detalle, /Fee \(menos de USD 500\)/)
    const dfy = entradaCrmDesdeAlta(ALTA({ programa: 'DFY' }), { hoy: HOY })
    assert.equal(dfy.avisos.length + dfy.bloqueos.length, 0)
  })
})

describe('encaja con planAlta() (CRM de juguete, sin red)', () => {
  const S = ymd => ymdASerial(ymd)
  const AG_HEAD = ['', '', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó', 'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Semaforo de Clientes', 'Testimonio', 'Notas renovación', 'Anotaciones']
  const RE_HEAD = ['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 4)']
  const CO_HEAD = ['ID', 'Nombre', 'Estado', 'Celular']
  const FORMULAS = { 'J Fin período actual': '=…', 'K Renovó': '=…', 'L LTV contratado': '=…', 'M LTV cobrado': '=…', 'N Duración (días)': '=…' }
  const ctx = (clientes = []) => ({
    hojas: {
      agencia: [AG_HEAD, ['A009', 'Otro Cliente', 'FINALIZADO', '+5491144445555', '', 'Gero', '', 'Firmado', S('2026-01-01')]],
      consultora: [CO_HEAD],
      renovaciones: [RE_HEAD, ['A009', 'Otro Cliente', 0, S('2026-01-01'), S('2026-05-01'), 2600, '']],
    },
    clientes, formulasAgencia: FORMULAS,
  })

  test('plan ok: ID nuevo, celular en D, contrato Enviado (si PandaDoc lo mandó), precio del #ALTA en el período 0', () => {
    const { entrada } = entradaCrmDesdeAlta(ALTA(), { contrato: 'Enviado' })
    const plan = planAlta(entrada, ctx())
    assert.equal(plan.ok, true, plan.errores.join(' '))
    assert.equal(plan.idNuevo, 'A010')
    assert.equal(plan.filaAgencia, 3)
    assert.deepEqual(plan.precio, { clave: 'inicial_3300', precioUSD: 3300, meses: 4, origen: 'entrada', asumido: false })
    const [a1, a2, renov] = plan.payload.valores.data
    assert.equal(a1.range, "'Agencia'!A3:I3")
    assert.deepEqual(a1.values[0], ['A010', 'Lucía Inventada', 'ACTIVO', '+5491130001111', 'lucia.inventada@example.com', 'Marcos', '', 'Enviado', S('2026-10-24')])
    assert.equal(a2.range, "'Agencia'!S3:S3")
    assert.deepEqual(a2.values[0], ['Alta automática del bot C.J. (#ALTA de Marcos)'])
    assert.equal(renov.values[0][5], 3300)
    assert.equal(plan.advertencias.some(x => /tabla de precios/.test(x)), false)   // el precio vino del #ALTA, no de la tabla
  })

  test('duplicado vigente por celular → error; finalizado → advertencia', () => {
    const { entrada } = entradaCrmDesdeAlta(ALTA({ tel: '+54 9 11 4444-5555' }))
    const vigente = planAlta(entrada, ctx([{ id: 'A009', linea: 'agencia', nombre: 'Otro Cliente', celular: '+5491144445555', mail: '', estado: 'ACTIVO' }]))
    assert.equal(vigente.ok, false)
    assert.deepEqual(vigente.duplicados.map(d => [d.id, d.motivo]), [['A009', 'celular']])
    const viejo = planAlta(entrada, ctx([{ id: 'A009', linea: 'agencia', nombre: 'Otro Cliente', celular: '54 9 11 4444-5555', mail: '', estado: 'FINALIZADO' }]))
    assert.equal(viejo.ok, true)
    assert.match(viejo.advertencias.join(' '), /A009 \(FINALIZADO, por celular\)/)
  })

  test('con faltantes del mapeo, planAlta tampoco arma el payload', () => {
    const { entrada, faltantes } = entradaCrmDesdeAlta(ALTA({ nombre: '', tel: '', inicio: '', cuotas: [] }))
    assert.equal(faltantes.length, 3)
    const plan = planAlta(entrada, ctx())
    assert.equal(plan.ok, false)
    assert.equal(plan.payload, null)
  })
})
