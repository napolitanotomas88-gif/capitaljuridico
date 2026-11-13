// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-anuncios-vinculos.mjs
// Vínculos cuenta de Meta ↔ cliente (13/11/2026): apóstrofos, nombres de pila, la cuenta de la ficha de kickoff como vínculo y
// el bloque «Vínculos de cuentas» de Anuncios (lib/nombresPersona.ts, lib/anuncios/cruce.ts, porLanzar.ts y vinculos.ts).
// Puro: sin red ni base. Todos los nombres y cuentas son inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['DATABASE_URL']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const N = await import('../lib/nombresPersona.ts')
const { crearCruce, normTxt } = await import('../lib/anuncios/cruce.ts')
const P = await import('../lib/anuncios/porLanzar.ts')
const V = await import('../lib/anuncios/vinculos.ts')
const { claveNombre } = await import('../lib/clientes/prioridad.ts')

const CRM = {
  clientes: [
    { nombre: 'Marta Lucía D’Ambrosio', estado: 'ACTIVO', id: 'A901' },
    { nombre: 'Rodrigo Tadeo Quiroga Benn', estado: 'ACTIVO', id: 'A902' },
    { nombre: 'Rodrigo Esteban Zabalza', estado: 'PAUSADO', id: 'A903' },
    { nombre: 'Celina Ostrowski', estado: 'ACTIVO', id: 'A904' },
    { nombre: 'Hilario Pentland', estado: 'ACTIVO', id: 'A905' },
  ],
  cuentasMeta: [{ cuenta: '555000111', actual: true, clienteCRM: 'Hilario Pentland' }],
  alias: [], guiones: [], errores: [],
}

test('apóstrofos y comillas tipográficas: D’Ambrosio = D\'Ambrosio = DAmbrosio', () => {
  for (const x of ['D’Ambrosio', "D'Ambrosio", 'DAmbrosio', 'D‘Ambrosio', 'D`Ambrosio']) assert.equal(normTxt(x), 'dambrosio', x)
  assert.equal(claveNombre('Marta Lucía D’Ambrosio'), claveNombre('Marta Lucia DAmbrosio'))
  // el resto de la puntuación sigue separando palabras
  assert.equal(N.normNombre('Pérez & Asoc.'), 'perez asoc')
  // la cuenta «USD Lucía DAmbrosio» cruza con la clienta escrita con apóstrofo (dos palabras en común)
  const cruce = crearCruce(CRM)
  assert.equal(cruce.resolverCliente({ id: 'act_1', nombre: 'USD Marta DAmbrosio' }).cliente?.nombre, 'Marta Lucía D’Ambrosio')
})

test('nombres de pila: una lista común y nunca alcanzan solos', () => {
  assert.ok(N.NOMBRES_DE_PILA.has('rodrigo'))
  assert.equal(N.esApellidoDe('rodrigo', 'Rodrigo Tadeo Quiroga Benn'), false)
  assert.equal(N.esApellidoDe('quiroga', 'Rodrigo Tadeo Quiroga Benn'), true)
  // la primera palabra del nombre no es apellido aunque no esté en la lista
  assert.equal(N.esApellidoDe('celina', 'Celina Ostrowski'), false)
})

test('«Por lanzar» no sugiere la cuenta de otro por un nombre de pila (caso «Rodrigo»)', () => {
  // La cuenta es del otro Rodrigo: su portfolio lleva su nombre completo
  const visibles = [{ id: 'act_200', nombre: 'Estudio Zabalza Prieto', estado: 1, negocio: { nombre: 'Rodrigo Esteban Zabalza' } }]
  assert.deepEqual(P.cuentasDelCliente('Rodrigo Tadeo Quiroga Benn', visibles, { tokFilas: new Set() }), [])
  // un apellido real sí sugiere (débil)
  const suya = [{ id: 'act_300', nombre: 'USD Quiroga Benn Abogados', estado: 1 }]
  assert.deepEqual(P.cuentasDelCliente('Rodrigo Tadeo Quiroga Benn', suya, { tokFilas: new Set() }).map(c => c.por), ['nombre'])
  assert.deepEqual(P.cuentasDelCliente('Celina Ostrowski', [{ id: 'act_400', nombre: 'Dra Ostrowski', estado: 1 }], { tokFilas: new Set() }).map(c => c.por), ['apellido'])
  // la vinculada a mano puede venir como un conjunto de ids
  assert.deepEqual(P.cuentasDelCliente('Celina Ostrowski', [{ id: 'act_500', nombre: 'Cuenta sin nombre', estado: 1 }], { manual: new Set(['act_500']), tokFilas: new Set() }).map(c => c.por), ['manual'])
})

test('la cuenta de la ficha de kickoff vincula: debajo del ajuste y de «Cuentas Meta», arriba del nombre', () => {
  const fichas = V.cuentasDeFichas([
    { idCrm: 'A904', clienteCRM: 'Celina O.', cuenta: { id: 'act_700' } },
    { idCrm: null, clienteCRM: 'Celina Ostrowski', cuenta: { id: 'act_555000111' } },
    { idCrm: 'A902', clienteCRM: null, cuenta: { id: 'act_800' } },
    { idCrm: 'A905', clienteCRM: null, cuenta: { id: 'act_800' } },   // la misma cuenta en dos fichas de clientes distintos: no se usa
  ], CRM.clientes)
  assert.equal(fichas.get('act_700'), 'Celina Ostrowski', 'con id del CRM manda el nombre de Agencia')
  assert.equal(fichas.has('act_800'), false)
  const cruce = crearCruce(CRM, { cuentasFicha: fichas })
  const r = cruce.resolverCliente({ id: 'act_700', nombre: 'Cuenta publicitaria 1' })
  assert.equal(r.cliente?.nombre, 'Celina Ostrowski')
  assert.equal(r.vinculo, 'ficha')
  // «Cuentas Meta» le gana a la ficha
  const planilla = cruce.resolverCliente({ id: 'act_555000111', nombre: 'Otra cuenta' })
  assert.equal(planilla.cliente?.nombre, 'Hilario Pentland')
  assert.equal(planilla.vinculo, 'planilla')
  // la ficha le gana al nombre de la cuenta
  const conNombre = crearCruce(CRM, { cuentasFicha: new Map([['act_900', 'Hilario Pentland']]) }).resolverCliente({ id: 'act_900', nombre: 'USD Celina Ostrowski' })
  assert.equal(conNombre.cliente?.nombre, 'Hilario Pentland')
  // sin vínculo firme, por nombre; sin nada, null
  assert.equal(crearCruce(CRM).resolverCliente({ id: 'act_901', nombre: 'USD Celina Ostrowski' }).vinculo, 'nombre')
  assert.equal(crearCruce(CRM).resolverCliente({ id: 'act_902', nombre: 'Cuenta 902' }).vinculo, null)
})

test('bloque de vínculos: clientes sin cuenta, cuentas con gasto sin cliente y qué cargar', () => {
  const sin = V.clientesSinCuenta([
    { cliente: 'Celina Ostrowski', idCrm: 'A904', cuentas: [{ id: 'act_400', nombre: 'Dra Ostrowski', estado: 1, por: 'apellido' }] },
    { cliente: 'Hilario Pentland', idCrm: 'A905', cuentas: [{ id: 'act_1', nombre: 'x', estado: 1, por: 'manual' }] },
    { cliente: 'Abel Nadie', cuentas: [], cuentaFicha: { estado: 'no_visible' } },
    { cliente: 'Berta Gasta', cuentas: [], cuentaFicha: { estado: 'con_fila', cliente: 'Otro' } },
  ])
  assert.deepEqual(sin.map(c => c.cliente), ['Abel Nadie', 'Celina Ostrowski'])
  assert.deepEqual(sin[1].sugerida, { id: 'act_400', nombre: 'Dra Ostrowski' })
  assert.match(sin[0].nota, /no se ve con el token/)
  assert.equal(V.filaCuentasMeta('act_400', 'Celina Ostrowski'), '«Cuentas Meta»: A = 400 · B = SI · C = Celina Ostrowski')
  const filas = [
    { id: 'act_10', cuenta: 'USD Sin Dueño', clienteCRM: null, negocio: { nombre: 'Portfolio X' }, moneda: 'USD', gasto: { d7: 12 } },
    { id: 'act_11', cuenta: 'USD Quieta', clienteCRM: null, negocio: null, moneda: 'USD', gasto: { d7: 0 } },
    { id: 'act_12', cuenta: 'USD Con Dueño', clienteCRM: 'Celina Ostrowski', negocio: null, moneda: 'USD', gasto: { d7: 50 } },
  ]
  assert.deepEqual(V.cuentasSinCliente(filas).map(c => [c.id, c.negocio, c.gastoD7]), [['act_10', 'Portfolio X', 12]])
})
