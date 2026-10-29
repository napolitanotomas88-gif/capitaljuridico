import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cruzarCobrosFinanzas, aplicarCobrosFinanzas, crearLectorCobrosFinanzas, normalizarNombreCobro, telefonoCobro, identidadesDeHojasCobros, TTL_COBROS_MS } from '../lib/clientes/cobrosFinanzas.ts'
import { sinMontos } from '../lib/clientes/ficha.ts'

globalThis.fetch = async () => { throw new Error('Las pruebas no consultan fuentes reales') }
const head = ['', '', 'Nombre del Cliente', 'Teléfono', 'Efectivo recaudado']
const head2025 = ['Cliente', 'Teléfono', 'Monto', 'telkey (auto)', 'nombre (auto)', 'Detalle (origen 2025)']
const cliente = (id = 'A149', nombre = 'Ana Pérez', celular = '+54 9 11 1234-5678') => ({ id, nombre, celular, linea: 'agencia', ltvCobrado: 987654, anotaciones: '', estado: 'ACTIVO' })
const fuentes = (pagos = [], anteriores = []) => ({ finanzas: [head, ...pagos.map(([n, t, m]) => ['', '', n, t, m])], pagos2025: [head2025, ...anteriores] })

test('el cruce replica M: últimos7, ASCII TRIM y sólo cinco acentos; conserva ñ, ü y puntuación', () => {
  assert.equal(normalizarNombreCobro("  PIÑÓN  GÜEZ ÁÉÍÓÚ O'Neil.  "), "piñon güez aeiou o'neil.")
  assert.notEqual(normalizarNombreCobro('Peña'), normalizarNombreCobro('Pena'))
  assert.notEqual(normalizarNombreCobro('Güemes'), normalizarNombreCobro('Guemes'))
  assert.equal(telefonoCobro('+54 9 11 1234-5678'), '2345678')
  assert.equal(telefonoCobro('12345'), '')
  assert.equal(telefonoCobro('1111111 / 2222222'), '2222222', 'se normaliza la celda completa como la fórmula')
})

test('teléfono OR nombre cuenta cada fila una vez y reemplaza MCRM con la suma completa2026+2025', () => {
  const f = fuentes([['ANA PEREZ', '112345678', 100], ['Ana Pérez', '', 200], ['Otro nombre', '2345678', 300]], [['ANA PEREZ', '2345678', 400]])
  const c = cliente(), nuevo = cruzarCobrosFinanzas([c], f)[0]
  assert.equal(nuevo.ltvCobrado, 1000)
  assert.equal(nuevo.cobrosAviso, null)
  assert.equal(c.ltvCobrado, 987654, 'no muta el snapshot del CRM ni usa su cifra')
  assert.equal(cruzarCobrosFinanzas([c], fuentes([['Ana Pérez', '2345678', 100], ['Ana Pérez', '2345678', 100]]))[0].ltvCobrado, 200, 'dos pagos físicos distintos no se deduplican por monto/nombre')
})

test('IDs/nombres/teléfonos duplicados y claves que apuntan a clientes diferentes nunca asignan un monto', () => {
  const casos = [
    [cliente(), cliente('A150', 'Ana Perez', '5555555')],
    [cliente(), cliente('A150', 'Beto', '2345678')],
    [cliente(), cliente('a149', 'Beto', '5555555')],
  ]
  for (const cs of casos) {
    const r = cruzarCobrosFinanzas(cs, fuentes([['Ana Pérez', '2345678', 500]]))
    assert.ok(r.every(c => c.ltvCobrado === null && /revisión/.test(c.cobrosAviso)))
  }
  const r = cruzarCobrosFinanzas([cliente(), cliente('A150', 'Beto', '5555555')], fuentes([['Ana Pérez', '5555555', 500]]))
  assert.ok(r.every(c => c.ltvCobrado === null))
})
test('la identidad fresca por ID supera el nombre/teléfono viejo del snapshot sin modificar lo mostrado', () => {
  const anterior = cliente('A149', 'Nombre anterior', '1111111')
  const f = { ...fuentes([['Nombre actual', '2222222', 700]]), identidades: [{ id: 'a149', nombre: 'Nombre actual', celular: '2222222' }] }
  const nuevo = cruzarCobrosFinanzas([anterior], f)[0]
  assert.equal(nuevo.ltvCobrado, 700)
  assert.equal(nuevo.nombre, 'Nombre anterior')
  assert.equal(nuevo.celular, '1111111')
  assert.equal(cruzarCobrosFinanzas([anterior], { ...f, identidades: [] })[0].ltvCobrado, null)
  assert.equal(cruzarCobrosFinanzas([anterior], { ...f, identidades: [f.identidades[0], f.identidades[0]] })[0].ltvCobrado, null)
})
test('la identidad incluye ambas líneas y detecta clientes frescos aún ausentes del snapshot', () => {
  const identidades = identidadesDeHojasCobros([['ID', 'Nombre', 'Celular'], ['A149', 'Ana Pérez', '2345678']], [['Nombre', 'ID', 'Teléfono'], ['Otro nuevo', 'A777', '5555555']])
  assert.deepEqual(identidades.map(c => c.id), ['A149', 'A777'])
  const f = { ...fuentes([['Ana Pérez', '5555555', 100]]), identidades }
  assert.equal(cruzarCobrosFinanzas([cliente()], f)[0].ltvCobrado, null, 'teléfono de otro cliente actual no se reasigna al nombre del snapshot')
})

test('monto inválido compatible oculta el total incompleto; cero y ajustes negativos son cifras verificables', () => {
  assert.equal(cruzarCobrosFinanzas([cliente()], fuentes([['Ana Pérez', '', 100], ['Ana Pérez', '', '500 usd']]))[0].ltvCobrado, null)
  assert.equal(cruzarCobrosFinanzas([cliente()], fuentes([['Ana Pérez', '', '500']]))[0].ltvCobrado, null, 'texto numérico en rango de sumas requiere revisión')
  assert.equal(cruzarCobrosFinanzas([cliente()], fuentes([['Ana Pérez', '', 100], ['Ana Pérez', '', -20], ['Ana Pérez', '', 0]]))[0].ltvCobrado, 80)
})

test('Pagos2025 vacío suma cero; fuente ausente o encabezado cambiado no se presenta como cero', async () => {
  const f = fuentes([['Ana Pérez', '', 100]])
  assert.equal(cruzarCobrosFinanzas([cliente()], { ...f, pagos2025: [] })[0].ltvCobrado, 100)
  assert.equal(cruzarCobrosFinanzas([cliente()], f)[0].ltvCobrado, 100)
  const lector = crearLectorCobrosFinanzas(async () => { throw new Error('Pagos2025 ausente') })
  assert.equal((await lector.leer()).ok, false)
  assert.throws(() => cruzarCobrosFinanzas([cliente()], { ...f, pagos2025: [['Cliente', 'Teléfono', 'Otro campo']] }), /Encabezados/)
})

test('cache45s deduplica lecturas simultáneas; después de un fallo no retorna la cifra vieja como actual', async () => {
  let reloj = 0, lecturas = 0, falla = false
  const lector = crearLectorCobrosFinanzas(async () => { lecturas++; if (falla) throw new Error('Finance caído'); return fuentes([['Ana Pérez', '', 100]]) }, { ahora: () => reloj })
  const rs = await Promise.all([lector.leer(), lector.leer(), lector.leer()])
  assert.equal(lecturas, 1); assert.ok(rs.every(r => r.ok))
  reloj = TTL_COBROS_MS - 1; await lector.leer(); assert.equal(lecturas, 1)
  reloj++; falla = true
  const r = await lector.leer()
  assert.equal(r.ok, false)
  const datos = { clientes: [cliente()], avisos: [] }
  const actual = await aplicarCobrosFinanzas(datos, { leer: async () => r })
  assert.equal(actual.clientes[0].ltvCobrado, null)
  assert.match(actual.clientes[0].cobrosAviso, /No se pudieron verificar/)
  assert.equal(actual.avisos.length, 1)
})

test('invalidación durante una lectura previa al pago fuerza lectura nueva y no repuebla un saldo viejo', async () => {
  let soltar, lecturas = 0
  const lector = crearLectorCobrosFinanzas(async () => {
    lecturas++
    if (lecturas === 1) return new Promise(resolve => { soltar = resolve })
    return fuentes([['Ana Pérez', '', 300]])
  })
  const vieja = lector.leer()
  lector.invalidar()
  soltar(fuentes([['Ana Pérez', '', 100]]))
  const r = await vieja
  assert.equal(lecturas, 2)
  assert.equal(cruzarCobrosFinanzas([cliente()], r.fuentes)[0].ltvCobrado, 300)
  await lector.leer(); assert.equal(lecturas, 2)
})

test('sin Finanzas se ocultan cobrado, saldo y aviso de esa cifra', () => {
  const f = sinMontos({ periodos: [], cobros: { contratado: 2000, cobrado: 1000, saldo: 1000, saldoRelevante: true, aviso: 'Cobro a revisar' }, notas: { anotaciones: '', renovacion: '' } })
  assert.equal(f.cobros.cobrado, null)
  assert.equal(f.cobros.saldo, null)
  assert.equal(f.cobros.aviso, null)
})
