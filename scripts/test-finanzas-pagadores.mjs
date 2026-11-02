// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-finanzas-pagadores.mjs
// «Pagado por» repartido en Pagos del equipo (pedido de Tomás, 1/11/2026: «Carlos comisionó 4 mil y Gero le paga 80 % y Tomi
// 20 %»): validación de la suma, resumen legible (igual al de la base), montos en USD, backfill, alta de la línea, cierre de
// mes, el reparto en el Resumen (lib/finanzasApp.ts + lib/finanzasCalc.ts) y la llamada rpc del shim. Sin red, datos inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const R = await import('../components/finanzas/skwd/calculoPagadores.js')
const P = await import('../components/finanzas/skwd/calculoPayroll.js')
const A = await import('../lib/finanzasApp.ts')
const C = await import('../lib/finanzasCalc.ts')
const B = await import('../lib/finanzasSkwd/baseNeon.ts')

const f = (quien, porcentaje) => ({ quien, porcentaje: String(porcentaje) })

describe('validarReparto: tiene que sumar 100 %', () => {
  test('Gero 80 % + Tomi 20 %: válido, ordenado de mayor a menor', () => {
    const v = R.validarReparto([f('Tomi', 20), f('Gero', 80)])
    assert.deepEqual(v.errores, [])
    assert.deepEqual(v.reparto, [{ quien: 'Gero', porcentaje: 80 }, { quien: 'Tomi', porcentaje: 20 }])
  })
  test('suma 90 % o 110 %: error con «Pagado por» y la suma', () => {
    for (const [a, b, suma] of [[50, 40, '90'], [60, 50, '110']]) {
      const v = R.validarReparto([f('Tomi', a), f('Gero', b)])
      assert.equal(v.errores.length, 1)
      assert.match(v.errores[0], /«Pagado por»/)
      assert.match(v.errores[0], new RegExp(`suman ${suma}%`))
      assert.deepEqual(v.reparto, [])
    }
  })
  test('tercios: 33,33 + 33,33 + 33,34 = 100; 3 × 33,33 = 99,99 entra en la tolerancia de 0,01; 3 × 33,3 = 99,9 no', () => {
    assert.deepEqual(R.validarReparto([f('Tomi', 33.33), f('Gero', 33.33), f('Empresa', 33.34)]).errores, [])
    assert.deepEqual(R.validarReparto([f('Tomi', 33.33), f('Gero', 33.33), f('Empresa', 33.33)]).errores, [])   // 99,99: tolerancia 0,01 (igual que la base)
    assert.equal(R.validarReparto([f('Tomi', 33.3), f('Gero', 33.3), f('Empresa', 33.3)]).errores.length, 1)    // 99,9
  })
  test('una sola fila sin «quién» = sin dato (se puede guardar sin pagador); varias filas: cada una necesita «quién»', () => {
    assert.deepEqual(R.validarReparto(R.repartoInicial()), { errores: [], reparto: [] })
    assert.match(R.validarReparto([f('Tomi', 50), f('', 50)]).errores.join(' '), /elegí quién paga/)
  })
  test('repetido, porcentaje 0, negativo, > 100 o con 3 decimales: error', () => {
    assert.match(R.validarReparto([f('Tomi', 50), f('Tomi', 50)]).errores.join(' '), /aparece dos veces/)
    for (const malo of [0, -10, 120, 33.333, 'abc', '']) assert.ok(R.validarReparto([f('Gero', malo)]).errores.length, `porcentaje ${malo}`)
  })
  test('acepta coma decimal («80,5»)', () => {
    assert.deepEqual(R.validarReparto([f('Gero', '80,5'), f('Tomi', '19,5')]).reparto, [{ quien: 'Gero', porcentaje: 80.5 }, { quien: 'Tomi', porcentaje: 19.5 }])
  })
  test('solo Tomi, Gero, Financiera o Empresa', () => {
    assert.match(R.validarReparto([f('Otro', 100)]).errores.join(' '), /solo Tomi, Gero, Financiera, Empresa/)
  })
})

describe('resumenReparto (mismo texto que finanzas.resumen_pagadores en la base)', () => {
  test('casos verificados contra Neon dentro de una transacción con rollback', () => {
    assert.equal(R.resumenReparto([{ quien: 'Tomi', porcentaje: 20 }, { quien: 'Gero', porcentaje: 80 }]), 'Gero 80% · Tomi 20%')
    assert.equal(R.resumenReparto([{ quien: 'Tomi', porcentaje: 33.33 }, { quien: 'Gero', porcentaje: 33.33 }, { quien: 'Empresa', porcentaje: 33.34 }]), 'Empresa 33,34% · Tomi 33,33% · Gero 33,33%')
    assert.equal(R.resumenReparto([{ quien: 'Gero', porcentaje: 100 }]), 'Gero')
    assert.equal(R.resumenReparto([{ quien: 'Gero', porcentaje: 50 }, { quien: 'Tomi', porcentaje: 50 }]), 'Tomi 50% · Gero 50%')
    assert.equal(R.resumenReparto([{ quien: 'Gero', porcentaje: 80.5 }, { quien: 'Tomi', porcentaje: 19.5 }]), 'Gero 80,5% · Tomi 19,5%')
    assert.equal(R.resumenReparto([]), null)
  })
  test('el resumen cumple el check de pagos_equipo.pagado_por de la migración', () => {
    const sql = fs.readFileSync(new URL('../db/finanzas/migraciones/2026-11-01-pagadores.sql', import.meta.url), 'utf8')
    const re = new RegExp(sql.match(/pagado_por ~ '([^']+)'/)[1])
    for (const r of ['Gero 80% · Tomi 20%', 'Empresa 33,34% · Tomi 33,33% · Gero 33,33%', 'Gero 80,5% · Tomi 19,5%']) assert.match(r, re)
    assert.doesNotMatch('Gero 80%', re)   // un solo pagador va con el nombre solo
  })
})

describe('montosReparto: la parte en USD de cada uno', () => {
  test('USD 4.000, Gero 80 % y Tomi 20 % → 3.200 y 800', () => {
    assert.deepEqual(R.montosReparto(4000, [f('Gero', 80), f('Tomi', 20)]), [3200, 800])
  })
  test('centavos exactos: las partes suman el total', () => {
    const m = R.montosReparto(100.01, [f('Tomi', 33.33), f('Gero', 33.33), f('Empresa', 33.34)])
    assert.equal(Math.round(m.reduce((s, x) => s + x, 0) * 100), 10001)
  })
  test('mientras no suma 100 cada fila muestra su % del total (sin ajustar la última)', () => {
    assert.deepEqual(R.montosReparto(1000, [f('Gero', 50), f('Tomi', '')]), [500, 0])
  })
})

describe('backfill de las líneas existentes', () => {
  const sql = fs.readFileSync(new URL('../db/finanzas/migraciones/2026-11-01-pagadores.sql', import.meta.url), 'utf8')
  const backfill = sql.slice(sql.indexOf('-- Backfill:'))
  test('las cuatro opciones reciben una fila al 100 %; «Tomi y Gero» → 50/50; solo líneas sin reparto (idempotente)', () => {
    assert.match(backfill, /select e\.id, e\.pagado_por, 100 from finanzas\.pagos_equipo e\s+where e\.pagado_por = any \(array\['Tomi', 'Gero', 'Financiera', 'Empresa'\]\)/)
    assert.match(backfill, /values \('Tomi'\), \('Gero'\)\) x\(quien\)\s+where e\.pagado_por = 'Tomi y Gero'/)
    assert.equal((backfill.match(/and not exists \(select 1 from finanzas\.pagos_equipo_pagadores p where p\.pago_equipo_id = e\.id\)/g) ?? []).length, 2)
    assert.doesNotMatch(backfill, /\bupdate\b|\bdelete\b/i)   // no toca los valores existentes
  })
  test('una línea backfilleada (pagado_por Gero + fila 100 %) se edita como «Gero 100 %»; «Otro» o vacío arrancan sin pagador', () => {
    assert.deepEqual(R.repartoDeLinea({ pagado_por: 'Gero', pagadores: [{ quien: 'Gero', porcentaje: 100 }] }), [{ quien: 'Gero', porcentaje: '100' }])
    assert.deepEqual(R.repartoDeLinea({ pagado_por: 'Financiera', pagadores: [] }), [{ quien: 'Financiera', porcentaje: '100' }])
    assert.deepEqual(R.repartoDeLinea({ pagado_por: 'Otro', pagadores: [] }), R.repartoInicial())
    assert.deepEqual(R.repartoDeLinea({ pagado_por: null }), R.repartoInicial())
  })
})

describe('alta de la línea y cierre de mes', () => {
  const personas = [{ id: 1, nombre: 'Carlos Prueba', activo: true }, { id: 2, nombre: 'Persona Dos', activo: true }]
  const form = (extra = {}) => ({ persona_id: '1', mes: '2026-10', honorarios_base: '', bonuses: '', comision: '4000', extras: '', pagado: true, nota: '', confirmaAdicional: false, pagadores: [f('Gero', 80), f('Tomi', 20)], ...extra })
  test('validarLinea: el error de la suma sale con «Pagado por» (va al lado del campo); armarLinea guarda el resumen', () => {
    const mal = P.validarLinea(form({ pagadores: [f('Gero', 80), f('Tomi', 10)] }), { personas, lineas: [] })
    assert.ok(mal.errores.some(e => /«Pagado por»/.test(e) && /suman 90%/.test(e)))
    const ok = P.validarLinea(form(), { personas, lineas: [] })
    assert.deepEqual(ok.errores, [])
    assert.deepEqual(ok.reparto, [{ quien: 'Gero', porcentaje: 80 }, { quien: 'Tomi', porcentaje: 20 }])
    assert.equal(P.armarLinea(form(), personas[0]).pagado_por, 'Gero 80% · Tomi 20%')
    assert.equal(P.armarLinea(form({ pagadores: R.repartoUno('Financiera') }), personas[0]).pagado_por, 'Financiera')
    assert.equal(P.armarLinea(form({ pagadores: R.repartoInicial() }), personas[0]).pagado_por, null)
  })
  test('cierreDeMes: cuánto pone cada pagador (con y sin reparto) y la mezcla por persona', () => {
    const lineas = [
      { id: 1, persona_id: 1, mes: '2026-10-01', total_usd: 4000, comision: 4000, pagado: true, pagado_por: 'Gero 80% · Tomi 20%', pagadores: [{ quien: 'Gero', porcentaje: 80 }, { quien: 'Tomi', porcentaje: 20 }] },
      { id: 2, persona_id: 2, mes: '2026-10-01', total_usd: 500, honorarios_base: 500, pagado: false, pagado_por: 'Financiera', pagadores: [] },
      { id: 3, persona_id: 2, mes: '2026-10-01', total_usd: 100, honorarios_base: 100, pagado: false, pagado_por: null, pagadores: [] },
    ]
    const c = P.cierreDeMes(lineas, personas, '2026-10')
    assert.deepEqual(c.porPagador, { Tomi: 800, Gero: 3200, Financiera: 500, Empresa: 0, otro: 0, sinDato: 100 })
    const carlos = c.filas.find(x => x.persona_id === 1)
    assert.deepEqual(carlos.pagadores, [{ quien: 'Gero', usd: 3200, porcentaje: 80 }, { quien: 'Tomi', usd: 800, porcentaje: 20 }])
    const dos = c.filas.find(x => x.persona_id === 2)
    assert.deepEqual(dos.pagadores.map(x => x.quien), ['Financiera', 'Sin dato'])
  })
})

describe('Resumen: el reparto 50/50 usa los porcentajes', () => {
  const equipo = (id, nombre, total, extra = {}) => ({ id, mes: '2026-10', nombre, puesto: 'Puesto', honorarios_base: 0, bonuses: 0, comision: total, total_usd: total, pagado: true, pagado_por: null, pagadores: [], ...extra })
  const entrada = (payroll) => ({ mes: '2026-10', hoy: '2026-10-31', registro: [], gastos: [], payroll: [], er: [], anioPlanillas: 2026, metaSpend: {}, mep: [], app: { pagos: [], gastos: [], payroll } })

  test('Carlos USD 4.000 (Gero 80 % · Tomi 20 %): Gero carga 3.200 y Tomi 800', () => {
    const m = A.payrollDesdeApp([equipo(7, 'Carlos Prueba', 4000, { pagado_por: 'Gero 80% · Tomi 20%', pagadores: [{ quien: 'Gero', porcentaje: 80 }, { quien: 'Tomi', porcentaje: '20' }] })])
    const fila = m.get('2026-10')[0]
    assert.deepEqual(fila.partes.map(p => [p.pagador, p.monto]), [['Gero', 3200], ['Tomi', 800]])
    assert.equal(fila.pagador, 'Gero')
    const r = C.calcularFinanzas(entrada(m)).reparto
    assert.deepEqual(r.gastos, { Tomi: 800, Gero: 3200 })
    assert.deepEqual(r.detalleGastos.map(d => [d.quien, d.monto, d.concepto]), [['Gero', 3200, 'Payroll: Carlos Prueba (Gero 80%)'], ['Tomi', 800, 'Payroll: Carlos Prueba (Tomi 20%)']])
    assert.equal(r.faltantes.gastosSinPagador, 0)
  })
  test('la parte de Financiera / Empresa queda fuera del reparto (es la empresa)', () => {
    const m = A.payrollDesdeApp([equipo(8, 'Persona Ocho', 1000, { pagadores: [{ quien: 'Empresa', porcentaje: 60 }, { quien: 'Tomi', porcentaje: 30 }, { quien: 'Financiera', porcentaje: 10 }] })])
    const r = C.calcularFinanzas(entrada(m)).reparto
    assert.deepEqual(r.gastos, { Tomi: 300, Gero: 0 })
    assert.equal(r.faltantes.gastosSinPagador, 0)
  })
  test('sin filas de reparto pero con el resumen en pagado_por: se lee el resumen', () => {
    const m = A.payrollDesdeApp([equipo(9, 'Persona Nueve', 1000, { pagado_por: 'Tomi 50% · Gero 50%' })])
    assert.deepEqual(C.calcularFinanzas(entrada(m)).reparto.gastos, { Tomi: 500, Gero: 500 })
  })
  test('líneas sin reparto: igual que antes (pagado_por entero; Financiera = empresa; vacío = sin pagador)', () => {
    const m = A.payrollDesdeApp([
      equipo(1, 'Uno', 200, { pagado_por: 'Gero' }), equipo(2, 'Dos', 300, { pagado_por: 'Financiera' }),
      equipo(3, 'Tres', 50, { pagado_por: null, pagadores: undefined }),
    ])
    assert.ok(m.get('2026-10').every(x => x.partes === undefined))
    const r = C.calcularFinanzas(entrada(m)).reparto
    assert.deepEqual(r.gastos, { Tomi: 0, Gero: 200 })
    assert.equal(r.faltantes.gastosSinPagador, 50)
    assert.deepEqual(r.detalleGastos.map(d => d.concepto), ['Payroll: Uno'])
  })
  test('la consulta del Resumen lee la columna pagadores', () => {
    assert.match(A.CONSULTAS_APP.equipo, /e\.pagadores/)
  })
})

describe('base: rpc reemplazar_pagadores y la tabla nueva', () => {
  test('rpc de la lista blanca: argumentos con nombre y el reparto como JSON', () => {
    const q = B.armarConsulta({ accion: 'rpc', funcion: 'reemplazar_pagadores', args: { p_pago_equipo_id: 7, p_reparto: [{ quien: 'Gero', porcentaje: 80 }] } })
    assert.equal(q.texto, 'select to_json(finanzas."reemplazar_pagadores"("p_pago_equipo_id" => $1, "p_reparto" => $2)) as filas')
    assert.deepEqual(q.params, [7, '[{"quien":"Gero","porcentaje":80}]'])
  })
  test('una función fuera de la lista o un nombre raro: rechazado', () => {
    assert.throws(() => B.armarConsulta({ accion: 'rpc', funcion: 'bloquear_vaciado', args: {} }), /Función desconocida/)
    assert.throws(() => B.armarConsulta({ accion: 'rpc', funcion: 'reemplazar_pagadores', args: { 'x; drop': 1 } }), /Nombre no válido/)
  })
  test('correrPedido devuelve lo que devuelve la función (el resumen) con el rol de la app', async () => {
    let consultas
    const r = await B.correrPedido({ accion: 'rpc', funcion: 'reemplazar_pagadores', args: { p_pago_equipo_id: 7, p_reparto: [] } }, 'x@prueba', async (qs) => { consultas = qs; return [[], [], [{ filas: 'Gero 80% · Tomi 20%' }]] })
    assert.deepEqual(r, { data: 'Gero 80% · Tomi 20%', error: null })
    assert.equal(consultas[0].texto, 'set local role finanzas_app')
  })
  test('pagos_equipo_pagadores está en la lista de tablas', () => {
    assert.ok(B.TABLAS_FINANZAS.includes('pagos_equipo_pagadores'))
  })
})
