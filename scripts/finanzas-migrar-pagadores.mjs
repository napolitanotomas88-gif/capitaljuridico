// node scripts/finanzas-migrar-pagadores.mjs [--aplicar]
// Migración «Pagado por» repartido (db/finanzas/migraciones/2026-11-01-pagadores.sql) en la base de Finanzas (Neon).
// Sin --aplicar: corre TODO dentro de una transacción, prueba el reparto (suma, duplicados, resumen, trigger diferido) sobre
// una línea real dentro de un savepoint y hace ROLLBACK: no queda nada escrito. Con --aplicar: la misma migración + COMMIT.
// Muestra conteos antes / después. Lee DATABASE_URL de .env.local (o del entorno) y nunca la muestra.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
let url = process.env.DATABASE_URL?.trim()
if (!url && fs.existsSync(path.join(raiz, '.env.local'))) {
  const m = fs.readFileSync(path.join(raiz, '.env.local'), 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)
  url = m?.[1]?.trim()
}
if (!url) { console.error('Falta DATABASE_URL'); process.exit(1) }
const aplicar = process.argv.includes('--aplicar')
const migracion = fs.readFileSync(path.join(raiz, 'db/finanzas/migraciones/2026-11-01-pagadores.sql'), 'utf8')

const cli = new pg.Client({ connectionString: url })
await cli.connect()
const q = async (t, p = []) => (await cli.query(t, p)).rows

async function conteos(conTabla) {
  const porValor = await q(`select coalesce(pagado_por, '(vacío)') as pagado_por, count(*)::int as n from finanzas.pagos_equipo group by 1 order by 1`)
  const total = (await q('select count(*)::int as n from finanzas.pagos_equipo'))[0].n
  const out = { lineas: total, pagado_por: Object.fromEntries(porValor.map((r) => [r.pagado_por, r.n])) }
  if (conTabla) {
    const r = (await q(`select count(*)::int as filas, count(distinct pago_equipo_id)::int as lineas from finanzas.pagos_equipo_pagadores`))[0]
    const porQuien = await q(`select quien, count(*)::int as n from finanzas.pagos_equipo_pagadores group by 1 order by 1`)
    const malas = (await q(`select count(*)::int as n from (select pago_equipo_id from finanzas.pagos_equipo_pagadores group by 1 having abs(sum(porcentaje) - 100) > 0.01) x`))[0].n
    const distintas = (await q(`select count(*)::int as n from finanzas.pagos_equipo e where exists (select 1 from finanzas.pagos_equipo_pagadores p where p.pago_equipo_id = e.id) and e.pagado_por is distinct from finanzas.resumen_pagadores(e.id)`))[0].n
    Object.assign(out, { pagadores: { filas: r.filas, lineas: r.lineas, porQuien: Object.fromEntries(porQuien.map((x) => [x.quien, x.n])), sumaDistintaDe100: malas, resumenDistintoDePagadoPor: distintas } })
  }
  return out
}

const existe = async () => (await q(`select to_regclass('finanzas.pagos_equipo_pagadores') is not null as e`))[0].e
let ok = false
try {
  await cli.query('begin')
  const antes = await conteos(await existe())
  console.log('ANTES', JSON.stringify(antes))
  await cli.query(migracion)
  await cli.query('set constraints all immediate')   // controla ya la suma del backfill (y libera los eventos diferidos)
  await cli.query(migracion)   // idempotente: una segunda pasada no cambia nada
  await cli.query('set constraints all immediate')
  const despues = await conteos(true)
  console.log('DESPUÉS', JSON.stringify(despues))

  if (!aplicar) {
    // Pruebas del reparto sobre una línea real, como finanzas_app, dentro de un savepoint (se deshace).
    const [l] = await q(`select id, pagado_por from finanzas.pagos_equipo order by id limit 1`)
    const prueba = async (nombre, fn) => {
      await cli.query('savepoint s')
      try { console.log('·', nombre, '→', await fn()) } catch (e) { console.log('·', nombre, '→ ERROR:', e.message) }
      await cli.query('rollback to savepoint s')
    }
    const comoApp = async (sqlTexto, params) => {
      await cli.query('set local role finanzas_app')
      await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ email: 'prueba@finanzas.despacho' })])
      const r = await q(sqlTexto, params)
      await cli.query('set constraints all immediate')   // dispara el trigger diferido ahora
      return r
    }
    await prueba('80/20 Gero y Tomi (resumen y pagado_por)', async () => {
      const r = await comoApp(`select finanzas.reemplazar_pagadores($1, $2::jsonb) as resumen`, [l.id, JSON.stringify([{ quien: 'Tomi', porcentaje: 20 }, { quien: 'Gero', porcentaje: 80 }])])
      const v = await q(`select pagado_por, pagadores from finanzas.pagos_equipo_vigentes where id = $1`, [l.id])
      return JSON.stringify({ resumen: r[0].resumen, vista: v[0] })
    })
    await prueba('33,33 / 33,33 / 33,34', async () => (await comoApp(`select finanzas.reemplazar_pagadores($1, $2::jsonb) as r`, [l.id, JSON.stringify([{ quien: 'Tomi', porcentaje: 33.33 }, { quien: 'Gero', porcentaje: 33.33 }, { quien: 'Empresa', porcentaje: 33.34 }])]))[0].r)
    await prueba('suma 90 (tiene que fallar)', async () => (await comoApp(`select finanzas.reemplazar_pagadores($1, $2::jsonb) as r`, [l.id, JSON.stringify([{ quien: 'Tomi', porcentaje: 50 }, { quien: 'Gero', porcentaje: 40 }])]))[0].r)
    await prueba('duplicado (tiene que fallar)', async () => (await comoApp(`select finanzas.reemplazar_pagadores($1, $2::jsonb) as r`, [l.id, JSON.stringify([{ quien: 'Tomi', porcentaje: 50 }, { quien: 'Tomi', porcentaje: 50 }])]))[0].r)
    await prueba('insert directo que no suma 100 (trigger diferido, tiene que fallar)', async () => {
      await comoApp(`delete from finanzas.pagos_equipo_pagadores where pago_equipo_id = $1`, [l.id])
      return JSON.stringify(await comoApp(`insert into finanzas.pagos_equipo_pagadores (pago_equipo_id, quien, porcentaje) values ($1, 'Gero', 70) returning quien`, [l.id]))
    })
    await prueba('vaciar el reparto → pagado_por null', async () => {
      await comoApp(`select finanzas.reemplazar_pagadores($1, '[]'::jsonb)`, [l.id])
      return JSON.stringify(await q(`select pagado_por, pagadores from finanzas.pagos_equipo_vigentes where id = $1`, [l.id]))
    })
  }
  await cli.query(aplicar ? 'commit' : 'rollback')
  ok = true
  console.log(aplicar ? 'APLICADA (commit).' : 'PRUEBA: rollback, no quedó nada escrito.')
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error('ERROR (rollback):', e.message)
} finally {
  await cli.end()
}
if (aplicar && ok) {
  const c2 = new pg.Client({ connectionString: url })
  await c2.connect()
  const r = await c2.query(`select count(*)::int as n from finanzas.pagos_equipo_pagadores`)
  console.log('Verificación tras commit: filas en pagos_equipo_pagadores =', r.rows[0].n)
  await c2.end()
}
process.exit(ok ? 0 : 1)
