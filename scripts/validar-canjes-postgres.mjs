// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/validar-canjes-postgres.mjs
// VALIDACIÓN REAL de las reservas durables del CANJE (migración 002, lib/clientes/reservasCanje.ts) contra una base de PRUEBA SEPARADA.
// Gemelo de validar-reservas-postgres.mjs (que valida la 001). Nunca contra producción. No toca Google Sheets. Crea un esquema temporal propio,
// corre la migración 002 ahí adentro, verifica el comportamiento REAL de Postgres (lock, índices únicos parciales, CHECKs, concurrencia) y borra
// el esquema al final.
//
// Requisitos (todos obligatorios; si falta uno, el script se niega a correr):
//   TEST_DATABASE_URL        URL de una base de prueba; el nombre de la base DEBE contener "test" o "prueba"
//   CJ_TEST_DB_CONFIRMADO=si confirma que no es la base de producción
//   (no usa DATABASE_URL a propósito, para no apuntar a producción por accidente; no imprime la URL ni credenciales)
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'

const url = process.env.TEST_DATABASE_URL
if (!url || process.env.CJ_TEST_DB_CONFIRMADO !== 'si') { console.error('Falta TEST_DATABASE_URL o CJ_TEST_DB_CONFIRMADO=si. No se hizo nada.'); process.exit(2) }
let u; try { u = new URL(url) } catch { console.error('TEST_DATABASE_URL inválida. No se hizo nada.'); process.exit(2) }
if (!/^postgres(ql)?:$/.test(u.protocol) || !/(test|prueba)/i.test(u.pathname)) { console.error('El nombre de la base tiene que contener "test" o "prueba". No se hizo nada.'); process.exit(2) }
if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) { console.error('TEST_DATABASE_URL es igual a DATABASE_URL: se niega a correr.'); process.exit(2) }

const { default: pg } = await import('pg')
const { crearReservasCanjePostgres, CLAVE_LOCK_CANJE } = await import('../lib/clientes/reservasCanje.ts')
const { CLAVE_LOCK } = await import('../lib/clientes/coordinadorPostgres.ts')
const esquema = `cj_prueba_canje_${randomBytes(4).toString('hex')}`
const admin = new pg.Pool({ connectionString: url, max: 1 })
const pool = new pg.Pool({ connectionString: url, max: 6, options: `-c search_path=${esquema}` })
const SECRETO = randomBytes(24).toString('hex')
const R = crearReservasCanjePostgres({ conectar: () => pool.connect(), secreto: SECRETO })
const pausa = ms => new Promise(r => setTimeout(r, ms))
// Un pedido de canje: cliente propio por n (salvo que se pise), ciclo '' (nunca canjeó), 2 meses y USD 300, cada uno en su columna
const pedido = (n, extra = {}) => ({
  actor: `u${n % 3}@x.com`, clave: `k${n}`, huellaPedido: `hp${n}`, huella: `h${n}`, cliente: `A${String(100 + n).padStart(3, '0')}`, cicloClave: '',
  meses: 2, usd: 300, extra: 'USD 300', pisoFila: 2, pisoIdNumero: 0, ...extra,
})
const resultadoDe = r => ({ estado: 'guardado', id: r.id, fila: r.fila, meses: r.meses, usd: r.usd, avisos: [], mensaje: `Canje asentado como ${r.id}` })
let hechos = 0
const ok = (nombre) => { hechos++; console.log(`  ok  ${nombre}`) }

try {
  await admin.query(`CREATE SCHEMA ${esquema}`)
  const sql = readFileSync(new URL('../lib/clientes/migraciones/002_canjes_reservas.sql', import.meta.url), 'utf8')
  const c = await pool.connect(); try { await c.query(sql) } finally { c.release() }
  console.log(`Esquema temporal ${esquema} creado y migración 002 aplicada (solo ahí).`)

  // 1. Concurrencia real: 20 canjes simultáneos de clientes distintos → filas e IDs únicos y consecutivos
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => R.reservar(pedido(i))))
  assert.ok(rs.every(r => r.tipo === 'nueva')); assert.equal(new Set(rs.map(r => r.reserva.fila)).size, 20); assert.equal(new Set(rs.map(r => r.reserva.id)).size, 20)
  assert.deepEqual(rs.map(r => r.reserva.fila).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2))
  assert.deepEqual(rs.map(r => r.reserva.idNumero).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1)); ok('20 reservas concurrentes: filas e IDs (M###) únicos y consecutivos')

  // 2. Anti doble gasto: mismo (cliente, ciclo) en paralelo con claves/actores distintos → un solo canje vivo
  const ciclo = await Promise.all(Array.from({ length: 8 }, (_, i) => R.reservar(pedido(100 + i, { cliente: 'B001', cicloClave: '2026-09-01' }))))
  assert.equal(ciclo.filter(r => r.tipo === 'nueva').length, 1); assert.equal(ciclo.filter(r => r.tipo === 'conflicto_ciclo').length, 7)
  ok('8 canjes simultáneos del mismo cliente y ciclo con otro contenido: 1 nueva, 7 conflicto_ciclo')
  const igual = await Promise.all(Array.from({ length: 6 }, (_, i) => R.reservar(pedido(150 + i, { cliente: 'B002', huella: 'mismo-canje' }))))
  assert.equal(igual.filter(r => r.tipo === 'nueva').length, 1); assert.equal(igual.filter(r => r.tipo === 'mismo_canje_en_ciclo').length, 5)
  assert.equal(new Set(igual.map(r => r.reserva.idNumero)).size, 1); ok('6 envíos simultáneos del MISMO canje con claves distintas: una sola reserva (mismo_canje_en_ciclo)')
  const otroCiclo = await R.reservar(pedido(160, { cliente: 'B001', cicloClave: '2026-10-27' })); assert.equal(otroCiclo.tipo, 'nueva'); ok('el mismo cliente en OTRO ciclo sí puede reservar')

  // 3. Misma (actor, clave) y mismo pedido → la misma reserva con el saldo CONGELADO; otro pedido → conflicto
  const a = await R.reservar(pedido(300))
  const b = await R.reservar(pedido(300, { meses: 7, usd: 900, huella: 'saldo-cambiado' }))
  assert.equal(b.tipo, 'misma_clave'); assert.equal(b.reserva.idNumero, a.reserva.idNumero); assert.equal(b.reserva.fila, a.reserva.fila)
  assert.equal(b.reserva.meses, 2); assert.equal(b.reserva.usd, 300); assert.equal(b.reserva.extra, 'USD 300')
  const bp = await R.buscarPorClave(pedido(300).actor, 'k300', 'hp300'); assert.equal(bp.tipo, 'misma_clave'); assert.equal(bp.reserva.meses, 2); assert.equal(bp.reserva.usd, 300)
  ok('reintento por clave: misma fila, mismo ID y saldo congelado (meses y USD por separado), aunque el saldo leído cambie')
  assert.equal((await R.reservar(pedido(300, { huellaPedido: 'otro-pedido' }))).tipo, 'conflicto_clave')
  assert.equal((await R.buscarPorClave(pedido(300).actor, 'k300', 'otro-pedido')).tipo, 'conflicto_clave')
  assert.equal(await R.buscarPorClave(pedido(300).actor, 'k-inexistente', 'hp300'), null)
  assert.equal(await R.buscarPorClave('otra@x.com', 'k300', 'hp300'), null); ok('misma clave con otro pedido: conflicto; otra clave u otro actor: no existe')

  // 4. Confirmar: pendiente → confirmada (idempotente); una confirmada no se libera ni se descarta; el reintento trae el resultado
  assert.equal(await R.confirmar(a.reserva.idNumero, resultadoDe(a.reserva)), true)
  assert.equal(await R.confirmar(a.reserva.idNumero, resultadoDe(a.reserva)), true)
  assert.equal(await R.liberar(a.reserva.idNumero), false); assert.equal(await R.descartar(a.reserva.idNumero), false)
  const tras = await R.reservar(pedido(300)); assert.equal(tras.reserva.estado, 'confirmada'); assert.equal(tras.reserva.resultado?.id, a.reserva.id)
  assert.equal((await R.reservar(pedido(301, { cliente: a.reserva.cliente }))).tipo, 'conflicto_ciclo'); ok('confirmar (dos veces = true), no liberar ni descartar una confirmada; el ciclo sigue ocupado')

  // 5. Liberar libera fila, ID y ciclo; descartar libera el ciclo pero NO reusa fila ni ID
  const l = await R.reservar(pedido(400)); assert.equal(await R.liberar(l.reserva.idNumero), true); assert.equal(await R.liberar(l.reserva.idNumero), false)
  const l2 = await R.reservar(pedido(400)); assert.equal(l2.tipo, 'nueva'); ok('liberar: se borra y el mismo canje se puede reservar de nuevo')
  const d = await R.reservar(pedido(500)); assert.equal(await R.descartar(d.reserva.idNumero), true)
  const d2 = await R.reservar(pedido(500)); assert.equal(d2.tipo, 'nueva'); assert.ok(d2.reserva.fila > d.reserva.fila && d2.reserva.idNumero > d.reserva.idNumero)
  assert.equal(await R.confirmar(d.reserva.idNumero, resultadoDe(d.reserva)), false); ok('descartar: libera el ciclo y la clave, la fila y el ID no se reusan, y no se puede confirmar')

  // 6. Piso desde el libro: respeta filas e IDs ya ocupados
  const p = await R.reservar(pedido(600, { pisoFila: 500, pisoIdNumero: 480 })); assert.ok(p.reserva.fila >= 500 && p.reserva.idNumero >= 481); assert.equal(p.reserva.id, `M${p.reserva.idNumero}`)
  ok('piso del libro Créditos respetado')

  // 7. El lock REAL serializa; el de altas de referidos es OTRO lock; una conexión destruida suelta el lock y la reserva sigue
  const c1 = await pool.connect(); await c1.query('BEGIN'); await c1.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK_CANJE])
  const t0 = Date.now(); const espera = R.reservar(pedido(700)); await pausa(300); await c1.query('COMMIT'); c1.release(); const r7 = await espera
  assert.ok(Date.now() - t0 >= 250 && r7.tipo === 'nueva'); ok('pg_advisory_xact_lock real: la reserva espera al otro dueño del lock del canje')
  const cr = await pool.connect(); await cr.query('BEGIN'); await cr.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK])
  try { const t1 = Date.now(); assert.equal((await R.reservar(pedido(701))).tipo, 'nueva'); assert.ok(Date.now() - t1 < 3000) } finally { await cr.query('ROLLBACK'); cr.release() }
  ok('el lock de altas de referidos no frena al canje (claves de lock distintas)')
  const cc = await pool.connect(); await cc.query('BEGIN'); await cc.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK_CANJE])
  const sinSoltar = R.reservar(pedido(702)); await pausa(100); cc.release(true) /* destruye la conexión: Postgres suelta el lock */; assert.equal((await sinSoltar).tipo, 'nueva'); ok('conexión destruida con el lock tomado: el lock se libera y la reserva sigue')

  // 8. Red de seguridad en la base (saltando la lógica del adapter): índices únicos parciales y CHECKs
  const dup = await pool.connect()
  const ins = (id, fila, cliente, ciclo, a, k, meses = 1, usd = 0, estado = 'pendiente') =>
    dup.query("INSERT INTO canjes_reservas (id_numero, fila, cliente, ciclo_clave, actor_hash, clave_hash, huella_pedido, huella, meses, usd, estado) VALUES ($1, $2, $3, $4, $5, $6, 'hp', 'h', $7, $8, $9)", [id, fila, cliente, ciclo, a, k, meses, usd, estado])
  try {
    await assert.rejects(() => ins(9001, 9001, 'Z001', '', 'a1', 'k1').then(() => ins(9002, 9002, 'Z001', '', 'a2', 'k2')), /duplicate key|unique/i)
    await assert.rejects(() => ins(9003, 2, 'Z002', '', 'a3', 'k3'), /duplicate key|unique/i)
    await assert.rejects(() => ins(9004, 9004, 'Z003', '', 'a1', 'k1'), /duplicate key|unique/i)
    await assert.rejects(() => ins(9001, 9005, 'Z004', '', 'a5', 'k5'), /duplicate key|unique/i)
    await ins(9006, 9006, 'Z005', '', 'a6', 'k6', 1, 0, 'descartada'); await ins(9007, 9007, 'Z005', '', 'a6', 'k6')
    await assert.rejects(() => ins(9008, 9008, 'Z006', '', 'a8', 'k8', 0, 0), /check/i)
    await assert.rejects(() => ins(9009, 9009, 'Z007', '', 'a9', 'k9', -1, 100), /check/i)
    await assert.rejects(() => ins(9010, 1, 'Z008', '', 'a10', 'k10'), /check/i)
    await assert.rejects(() => ins(9011, 9011, 'Z009', '', 'a11', 'k11', 1, 0, 'guardado'), /check/i)
  } finally { dup.release() }
  ok('índices únicos reales: (cliente, ciclo) vivo, (actor, clave) vivo, fila e ID; una descartada no bloquea; CHECKs de montos, fila y estado')

  // 9. Monedas separadas y sin datos privados en la tabla
  const cols = (await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'canjes_reservas'", [esquema])).rows.map(x => x.column_name)
  assert.ok(cols.includes('meses') && cols.includes('usd')); assert.ok(!cols.some(x => /nombre|mail|tel(efono)?$|estudio|email|celular|whatsapp/.test(x))); ok('meses y USD en columnas separadas; la tabla no tiene columnas de contacto')

  // 10. Timeout del lock real (lock_timeout 8 s): se verifica sin esperar los 8 s reales solo si LOCK_LARGO=1
  if (process.env.LOCK_LARGO === '1') {
    const held = await pool.connect(); await held.query('BEGIN'); await held.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK_CANJE])
    await assert.rejects(() => R.reservar(pedido(800)), /lock timeout|55P03/i); await held.query('ROLLBACK'); held.release(); ok('lock_timeout real (8 s): falla y libera la conexión')
  } else console.log('  --  lock_timeout de 8 s no probado (correr con LOCK_LARGO=1)')

  console.log(`\nVALIDACIÓN REAL OK: ${hechos} comprobaciones en el esquema ${esquema} (se borra a continuación).`)
} catch (e) {
  console.error(`\nFALLÓ: ${e.message}`); process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
  await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`).catch(() => {})
  await admin.end().catch(() => {})
}
