// Costo por seguidor real de FM (lib/anuncios/seguidoresCruce.ts): validación de la foto diaria y cálculo del cruce.
// Datos ficticios.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calcularCruce, costo, validarFoto, veredictoCosto } from '../lib/anuncios/seguidoresCruce.ts'

const RAIZ = join(import.meta.dirname, '..')

const posteo = (x = {}) => ({
  clave: 'ALFA', cuenta: 'principal', gastoAcum: 100, atribuidosAcum: 10, gastoAyer: 20, atribuidosAyer: 2,
  bsTotal: 50, bsAnuncios: 40, ...x,
})
const perfil = (x = {}) => ({
  usuario: 'perfil_prueba', cuenta: 'secundaria', seguidores: 60, seguidoresInicio: 20,
  gastoAcum: 40, atribuidosAcum: 1, gastoAyer: 10, atribuidosAyer: 0, ...x,
})
const foto = (x = {}) => ({ dia: '2026-01-10', tomada: '2026-01-10T11:30:00.000Z', posteos: [posteo()], perfiles: [perfil()], ...x })

describe('validarFoto', () => {
  test('acepta una foto completa y la devuelve limpia', () => {
    const v = validarFoto(foto({ notas: ['  algo  ', 3] }))
    assert.equal(v.ok, true)
    assert.equal(v.foto.posteos[0].clave, 'ALFA')
    assert.deepEqual(v.foto.notas, ['algo'])
  })
  test('bsTotal y bsAnuncios pueden venir en null (Business Suite sin dato)', () => {
    assert.equal(validarFoto(foto({ posteos: [posteo({ bsTotal: null, bsAnuncios: null })] })).ok, true)
  })
  test('quita la arroba del usuario', () => {
    const v = validarFoto(foto({ perfiles: [perfil({ usuario: '@perfil_prueba' })] }))
    assert.equal(v.foto.perfiles[0].usuario, 'perfil_prueba')
  })
  for (const [nombre, cambio] of [
    ['día mal escrito', { dia: '10/01/2026' }],
    ['tomada inválida', { tomada: 'ayer' }],
    ['posteos no es lista', { posteos: 'x' }],
    ['gasto negativo', { posteos: [posteo({ gastoAcum: -1 })] }],
    ['gasto como texto', { posteos: [posteo({ gastoAyer: '20' })] }],
    ['bsAnuncios mayor que bsTotal', { posteos: [posteo({ bsTotal: 5, bsAnuncios: 9 })] }],
    ['bsTotal ausente', { posteos: [posteo({ bsTotal: undefined })] }],
    ['posteo sin clave', { posteos: [posteo({ clave: ' ' })] }],
    ['perfil sin seguidores', { perfiles: [perfil({ seguidores: undefined })] }],
    ['demasiadas filas', { posteos: Array.from({ length: 201 }, () => posteo()) }],
  ]) {
    test(`rechaza: ${nombre}`, () => assert.equal(validarFoto(foto(cambio)).ok, false))
  }
  test('rechaza algo que no es objeto', () => {
    assert.equal(validarFoto(null).ok, false)
    assert.equal(validarFoto('hola').ok, false)
  })
})

describe('calcularCruce', () => {
  test('sin foto anterior: acumulados y costos, sin seguidores del día', () => {
    const c = calcularCruce(validarFoto(foto()).foto)
    const p = c.posteos[0]
    assert.equal(p.costoAtribuido, 10)
    assert.equal(p.costoReal, 2.5)            // solo seguidores de anuncios (40)
    assert.equal(p.costoConOrganicos, 2)      // con los orgánicos (50), como referencia
    assert.equal(p.costoAtribuidoAyer, 10)
    assert.equal(p.bsNuevos, null)
    assert.equal(p.costoRealAyer, null)
    assert.equal(c.diaAnterior, null)
    assert.equal(c.perfiles[0].nuevosAcum, 40)
    assert.equal(c.perfiles[0].costoRealAcum, 1)
    assert.equal(c.perfiles[0].nuevosAyer, null)
  })

  test('con la foto del día anterior: seguidores nuevos y costo real del día', () => {
    const ayer = validarFoto(foto({ dia: '2026-01-09', posteos: [posteo({ bsTotal: 40, bsAnuncios: 32 })], perfiles: [perfil({ seguidores: 55 })] })).foto
    const hoy = validarFoto(foto()).foto
    const c = calcularCruce(hoy, ayer)
    assert.equal(c.diaAnterior, '2026-01-09')
    assert.equal(c.posteos[0].bsNuevos, 10)
    assert.equal(c.posteos[0].bsAnunciosNuevos, 8)
    assert.equal(c.posteos[0].costoRealAyer, 2.5)   // 20 ÷ 8 de anuncios: los 2 orgánicos del día no cuentan
    assert.equal(c.perfiles[0].nuevosAyer, 5)
    assert.equal(c.perfiles[0].costoRealAyer, 2)
  })

  test('una foto anterior del mismo día no cuenta como día previo', () => {
    const c = calcularCruce(validarFoto(foto()).foto, validarFoto(foto()).foto)
    assert.equal(c.diaAnterior, null)
  })

  test('posteo nuevo que no estaba en la foto anterior: sin seguidores del día', () => {
    const ayer = validarFoto(foto({ dia: '2026-01-09', posteos: [posteo({ clave: 'BETA' })] })).foto
    const c = calcularCruce(validarFoto(foto()).foto, ayer)
    assert.equal(c.posteos[0].bsNuevos, null)
  })

  test('si Business Suite baja (corrige), el día no da negativo', () => {
    const ayer = validarFoto(foto({ dia: '2026-01-09', posteos: [posteo({ bsTotal: 60, bsAnuncios: 45 })] })).foto
    const c = calcularCruce(validarFoto(foto()).foto, ayer)
    assert.equal(c.posteos[0].bsNuevos, 0)
    assert.equal(c.posteos[0].bsAnunciosNuevos, 0)
    assert.equal(c.posteos[0].costoRealAyer, null)
  })

  test('perfil: al crecimiento se le restan los orgánicos de sus posteos (acumulado y del día)', () => {
    const ayer = validarFoto(foto({ dia: '2026-01-09', perfiles: [perfil({ seguidores: 50, organicosAcum: 2 })] })).foto
    const hoy = validarFoto(foto({ perfiles: [perfil({ seguidores: 60, organicosAcum: 5 })] })).foto
    const pf = calcularCruce(hoy, ayer).perfiles[0]
    assert.equal(pf.crecimientoAcum, 40)
    assert.equal(pf.organicosAcum, 5)
    assert.equal(pf.nuevosAcum, 35)
    assert.ok(Math.abs(pf.costoRealAcum - 40 / 35) < 1e-9)
    assert.equal(pf.nuevosAyer, 7)            // creció 10, 3 fueron orgánicos
    assert.ok(Math.abs(pf.costoRealAyer - 10 / 7) < 1e-9)
  })

  test('rechaza organicosAcum negativo', () => {
    assert.equal(validarFoto(foto({ perfiles: [perfil({ organicosAcum: -1 })] })).ok, false)
  })

  test('totales por cuenta: principal primero, cada una con lo suyo, y el total suma las dos', () => {
    const f = validarFoto(foto({ posteos: [posteo(), posteo({ clave: 'BETA', cuenta: 'secundaria', gastoAcum: 30, atribuidosAcum: 1, bsTotal: 12, bsAnuncios: 10 })] })).foto
    const c = calcularCruce(f)
    assert.deepEqual(c.porCuenta.map(x => x.cuenta), ['principal', 'secundaria'])
    const [pri, sec] = c.porCuenta.map(x => x.totales)
    assert.equal(pri.gastoAcum, 100)
    assert.equal(pri.seguidoresReales, 40)
    assert.equal(sec.gastoAcum, 70)               // posteo BETA 30 + perfil 40
    assert.equal(sec.seguidoresReales, 50)        // 10 de anuncios + 40 de crecimiento del perfil
    assert.equal(c.totales.gastoAcum, pri.gastoAcum + sec.gastoAcum)
    assert.equal(c.totales.seguidoresReales, 90)
  })

  test('costo real del día: solo con foto anterior y solo sobre lo que tiene dato', () => {
    const ayer = validarFoto(foto({ dia: '2026-01-09', posteos: [posteo({ bsTotal: 40, bsAnuncios: 32 })], perfiles: [perfil({ seguidores: 55 })] })).foto
    const t = calcularCruce(validarFoto(foto()).foto, ayer).totales
    assert.equal(t.seguidoresRealesAyer, 13)      // 8 del posteo + 5 del perfil
    assert.equal(t.gastoAyerConDato, 30)
    assert.ok(Math.abs(t.costoRealAyer - 30 / 13) < 1e-9)
    assert.equal(calcularCruce(validarFoto(foto()).foto).totales.costoRealAyer, null)
  })

  test('totales: el costo real solo usa lo que tiene dato real', () => {
    const f = validarFoto(foto({ posteos: [posteo(), posteo({ clave: 'BETA', gastoAcum: 300, bsTotal: null, bsAnuncios: null })] })).foto
    const t = calcularCruce(f).totales
    assert.equal(t.gastoAcum, 440)
    assert.equal(t.atribuidosAcum, 21)
    assert.equal(t.seguidoresReales, 80)        // 40 de anuncios del posteo con dato + 40 del perfil
    assert.equal(t.seguidoresConOrganicos, 90)  // 50 totales del posteo + 40 del perfil
    assert.equal(t.gastoConDato, 140)           // 100 + 40: el posteo sin dato queda afuera
    assert.ok(Math.abs(t.costoReal - 140 / 80) < 1e-9)
  })

  test('ordena por gasto del día y después por acumulado', () => {
    const f = validarFoto(foto({ posteos: [posteo({ clave: 'A', gastoAyer: 0, gastoAcum: 900 }), posteo({ clave: 'B', gastoAyer: 5 })] })).foto
    assert.deepEqual(calcularCruce(f).posteos.map(p => p.clave), ['B', 'A'])
  })
})

describe('costo y semáforo', () => {
  test('sin divisor da null, nunca infinito ni 0', () => {
    assert.equal(costo(50, 0), null)
    assert.equal(costo(50, null), null)
    assert.equal(costo(0, 5), 0)
  })
  test('umbrales del CPL Instagram', () => {
    assert.equal(veredictoCosto(2.2).etiqueta, 'Winner')
    assert.equal(veredictoCosto(2.5).etiqueta, 'Escalar')
    assert.equal(veredictoCosto(4).etiqueta, 'Regular')
    assert.equal(veredictoCosto(5.01).etiqueta, 'Bajo')
  })
})

describe('ruta', () => {
  const fuente = readFileSync(join(RAIZ, 'app', 'api', 'ads', 'seguidores', 'route.ts'), 'utf8')
  test('el POST exige el Bearer de máquina aunque haya sesión', () => {
    const post = fuente.slice(fuente.indexOf('export async function POST'))
    assert.match(post, /accesoMaquina\(request\.headers\)/)
    assert.doesNotMatch(post, /exigirAccesoApi/)
  })
  test('el GET pasa por exigirAccesoApi con la sección Resumen', () => {
    const get = fuente.slice(fuente.indexOf('export async function GET'), fuente.indexOf('export async function POST'))
    assert.match(get, /exigirAccesoApi\(request, 'resumen', \{ maquina: true \}\)/)
  })
  test('el Resumen lee el cruce con leerJsonDeDatos', () => {
    const resumen = readFileSync(join(RAIZ, 'components', 'ResumenDashboard.tsx'), 'utf8')
    const i = resumen.indexOf("fetch('/api/ads/seguidores'")
    assert.ok(i > 0)
    assert.match(resumen.slice(i, i + 160), /leerJsonDeDatos\(r, irAlLogin\)/)
  })
})
