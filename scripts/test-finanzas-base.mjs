// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-finanzas-base.mjs
// Base de Finanzas SKWD en Neon (lib/finanzasSkwd/baseNeon.ts): la traducción de los pedidos a SQL y la respuesta con la
// forma de supabase-js, con un Neon falso. Sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const B = await import('../lib/finanzasSkwd/baseNeon.ts')

describe('armarConsulta', () => {
  test('select con columnas, filtros, orden y límite: valores como parámetros', () => {
    const q = B.armarConsulta({ tabla: 'pagos_vigentes', accion: 'select', columnas: 'id, fecha, monto_usd',
      filtros: [['gte', 'fecha', '2026-10-01'], ['in', 'id', [1, 2]]], orden: [['fecha', false], ['id', true]], limite: 50 })
    assert.match(q.texto, /select "id", "fecha", "monto_usd" from finanzas\."pagos_vigentes" where "fecha" >= \$1 and "id" = any\(\$2\) order by "fecha" desc, "id" asc limit 50/)
    assert.deepEqual(q.params, ['2026-10-01', [1, 2]])
    assert.match(q.texto, /json_agg/)
  })
  test('tablas fuera de la lista y nombres raros se rechazan', () => {
    assert.throws(() => B.armarConsulta({ tabla: 'cj_altas', accion: 'select' }), /Tabla desconocida/)
    assert.throws(() => B.armarConsulta({ tabla: 'pagos', accion: 'select', columnas: 'id; drop table x' }), /Nombre no válido/)
    assert.throws(() => B.armarConsulta({ tabla: 'pagos', accion: 'select', filtros: [['eq', 'id" or 1=1 --', 1]] }), /Nombre no válido/)
  })
  test('insert sin select: no devuelve filas; con select: returning', () => {
    const a = B.armarConsulta({ tabla: 'pago_quien_recibio', accion: 'insert', columnas: null, datos: { pago_id: 9, quien: 'Tomi' } })
    assert.match(a.texto, /insert into finanzas\."pago_quien_recibio" \("pago_id", "quien"\) select "pago_id", "quien" from json_populate_recordset/)
    assert.match(a.texto, /select null::json as filas/)
    assert.deepEqual(JSON.parse(a.params[0]), [{ pago_id: 9, quien: 'Tomi' }])
    const b = B.armarConsulta({ tabla: 'pagos', accion: 'insert', columnas: 'id', datos: [{ cliente: 'x' }, { cliente: 'y', monto_usd: 1 }] })
    assert.match(b.texto, /\("cliente", "monto_usd"\).* returning "id"/)
  })
  test('update y delete piden filtro; upsert usa la clave primaria', () => {
    assert.throws(() => B.armarConsulta({ tabla: 'pagos', accion: 'delete', columnas: null }), /sin filtro/)
    assert.throws(() => B.armarConsulta({ tabla: 'pagos', accion: 'update', columnas: null, datos: { revisar: true } }), /sin filtro/)
    const u = B.armarConsulta({ tabla: 'pagos', accion: 'update', columnas: null, datos: { revisar: true }, filtros: [['eq', 'id', 3]] })
    assert.match(u.texto, /update finanzas\."pagos" set \("revisar"\) = \(select "revisar" from json_populate_record\(null::finanzas\."pagos", \$2::json\)\) where "id" = \$1/)
    const s = B.armarConsulta({ tabla: 'estado_parametros', accion: 'upsert', columnas: null, datos: { anio: 2026, saldo_inicial: 5 } })
    assert.match(s.texto, /on conflict \("anio"\) do update set "saldo_inicial" = excluded\."saldo_inicial"/)
  })
})

describe('correrPedido', () => {
  const falso = (filas, alVer = () => {}) => async (qs) => { alVer(qs); return [[], [{}], [{ filas }]] }
  test('corre con el rol de la app y el correo en request.jwt.claims', async () => {
    let vistas
    const r = await B.correrPedido({ tabla: 'personas', accion: 'select', columnas: 'id' }, 'tomas@x.com', falso([{ id: 1 }], (q) => { vistas = q }))
    assert.deepEqual(r, { data: [{ id: 1 }], error: null })
    assert.equal(vistas[0].texto, 'set local role finanzas_app')
    assert.deepEqual(JSON.parse(vistas[1].params[0]), { email: 'tomas@x.com', role: 'authenticated' })
  })
  test('single y maybeSingle', async () => {
    const p = { tabla: 'personas', accion: 'select', columnas: '*', uno: 'single' }
    assert.deepEqual((await B.correrPedido(p, 'a@b.c', falso([{ id: 1 }]))).data, { id: 1 })
    assert.equal((await B.correrPedido(p, 'a@b.c', falso([]))).error.code, 'PGRST116')
    assert.deepEqual(await B.correrPedido({ ...p, uno: 'maybeSingle' }, 'a@b.c', falso([])), { data: null, error: null })
  })
  test('los errores de la base vuelven como { error } (no se tiran)', async () => {
    const r = await B.correrPedido({ tabla: 'pagos', accion: 'select' }, 'a@b.c', async () => { throw Object.assign(new Error('permiso denegado'), { code: '42501' }) })
    assert.deepEqual(r, { data: null, error: { message: 'permiso denegado', code: '42501' } })
    assert.equal((await B.correrPedido({ tabla: 'nada', accion: 'select' }, 'a@b.c', falso([]))).error.code, 'PEDIDO')
  })
})
