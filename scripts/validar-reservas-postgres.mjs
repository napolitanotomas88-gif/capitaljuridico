// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/validar-reservas-postgres.mjs
// VALIDACIÓN REAL de las reservas durables contra una base de PRUEBA SEPARADA. NO SE EJECUTÓ NUNCA (no hay base): se corre a mano
// cuando exista una. Nunca contra producción. No toca Google Sheets. Crea un esquema temporal propio, corre la migración ahí adentro,
// verifica el comportamiento REAL de Postgres (lock, índices únicos parciales, concurrencia, rollback) y borra el esquema.
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
const { crearReservasPostgres, CLAVE_LOCK } = await import('../lib/clientes/coordinadorPostgres.ts')
const esquema = `cj_prueba_${randomBytes(4).toString('hex')}`
const admin = new pg.Pool({ connectionString: url, max: 1 })
const pool = new pg.Pool({ connectionString: url, max: 6, options: `-c search_path=${esquema}` })
const SECRETO = randomBytes(24).toString('hex')
const R = crearReservasPostgres({ conectar: () => pool.connect(), secreto: SECRETO })
const pausa = ms => new Promise(r => setTimeout(r, ms))
const pedido = (n, extra = {}) => ({ actor: `u${n % 3}@x.com`, clave: `k${n}`, huella: `h${n}`, telefonoClave: String(10000000 + n), referidor: 'A012', pisoFila: 2, pisoIdNumero: 0, ...extra })
let hechos = 0
const ok = (nombre) => { hechos++; console.log(`  ok  ${nombre}`) }

try {
  await admin.query(`CREATE SCHEMA ${esquema}`)
  const sql = readFileSync(new URL('../lib/clientes/migraciones/001_referidos_alta.sql', import.meta.url), 'utf8')
  const c = await pool.connect(); try { await c.query(sql) } finally { c.release() }
  console.log(`Esquema temporal ${esquema} creado y migración aplicada (solo ahí).`)

  // 1. Concurrencia real: 20 reservas simultáneas, filas e IDs distintos y consecutivos
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => R.reservar(pedido(i))))
  assert.ok(rs.every(r => r.tipo === 'nueva')); assert.equal(new Set(rs.map(r => r.reserva.fila)).size, 20); assert.equal(new Set(rs.map(r => r.reserva.id)).size, 20)
  assert.deepEqual(rs.map(r => r.reserva.fila).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2)); ok('20 reservas concurrentes: filas e IDs únicos y consecutivos')

  // 2. Mismo teléfono en paralelo (claves/actores distintos): una sola reserva viva
  const mismas = await Promise.all(Array.from({ length: 8 }, (_, i) => R.reservar(pedido(100 + i, { telefonoClave: '55555555' }))))
  assert.equal(mismas.filter(r => r.tipo === 'nueva').length, 1); assert.equal(mismas.filter(r => r.tipo === 'misma_persona').length, 7); ok('8 reservas simultáneas del mismo teléfono: 1 nueva, 7 misma_persona')
  const otro = await R.reservar(pedido(200, { telefonoClave: '55555555', referidor: 'A013' })); assert.equal(otro.tipo, 'conflicto_telefono'); ok('mismo teléfono con otro referidor: conflicto explícito')

  // 3. Misma clave: reintento = misma reserva; otro contenido = conflicto
  const a = await R.reservar(pedido(300)); const b = await R.reservar(pedido(300))
  assert.equal(b.tipo, 'misma_clave'); assert.equal(b.reserva.fila, a.reserva.fila); assert.equal(b.reserva.id, a.reserva.id)
  assert.equal((await R.reservar(pedido(300, { huella: 'otra' }))).tipo, 'conflicto_clave'); ok('misma clave: misma fila e ID; otro contenido: conflicto')

  // 4. Pendiente → confirmada; no se puede confirmar dos veces ni liberar una confirmada
  const resultado = { estado: 'guardado', id: a.reserva.id, fila: a.reserva.fila, avisos: [], mensaje: 'ok' }
  assert.equal(await R.confirmar(a.reserva.idNumero, resultado), true); assert.equal(await R.liberar(a.reserva.idNumero), false)
  assert.equal((await R.reservar(pedido(300))).reserva.estado, 'confirmada'); ok('confirmar y no liberar una confirmada')

  // 5. Liberar libera fila-ID-teléfono; descartar NO reusa fila ni ID
  const l = await R.reservar(pedido(400)); assert.equal(await R.liberar(l.reserva.idNumero), true)
  const l2 = await R.reservar(pedido(400)); assert.equal(l2.tipo, 'nueva'); ok('liberar: se puede reservar de nuevo')
  const d = await R.reservar(pedido(500)); assert.equal(await R.descartar(d.reserva.idNumero), true)
  const d2 = await R.reservar(pedido(500)); assert.ok(d2.reserva.fila > d.reserva.fila && d2.reserva.idNumero > d.reserva.idNumero); ok('descartar: la fila y el ID no se reusan')

  // 6. Piso desde el Sheet: respeta filas ya ocupadas
  const p = await R.reservar(pedido(600, { pisoFila: 500, pisoIdNumero: 480 })); assert.ok(p.reserva.fila >= 500 && p.reserva.idNumero >= 481); ok('piso del Sheet respetado')

  // 7. El lock REAL serializa y la reserva sobrevive a un corte de conexión (la reserva ya está commiteada)
  const c1 = await pool.connect(); await c1.query('BEGIN'); await c1.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK])
  const t0 = Date.now(); const espera = R.reservar(pedido(700)); await pausa(300); await c1.query('COMMIT'); c1.release(); const r7 = await espera
  assert.ok(Date.now() - t0 >= 250 && r7.tipo === 'nueva'); ok('pg_advisory_xact_lock real: la reserva espera al otro dueño del lock')
  const cc = await pool.connect(); await cc.query('BEGIN'); await cc.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK])
  const sinSoltar = R.reservar(pedido(701)); await pausa(100); cc.release(true) /* destruye la conexión: Postgres suelta el lock */; assert.equal((await sinSoltar).tipo, 'nueva'); ok('conexión destruida con el lock tomado: el lock se libera y la reserva sigue')

  // 8. Índices únicos parciales (red de seguridad), saltando la lógica del adapter
  const dup = await pool.connect()
  try {
    await assert.rejects(() => dup.query("INSERT INTO referidos_reservas (id_numero, fila, telefono_hash, actor_hash, clave_hash, huella, referidor) VALUES (9001, 9001, 'telRep', 'a', 'k', 'h', 'A1'), (9002, 9002, 'telRep', 'a2', 'k2', 'h', 'A1')"), /duplicate key|unique/i)
    await assert.rejects(() => dup.query("INSERT INTO referidos_reservas (id_numero, fila, telefono_hash, actor_hash, clave_hash, huella, referidor) VALUES (9003, 2, 'tx', 'a3', 'k3', 'h', 'A1')"), /duplicate key|unique/i)
  } finally { dup.release() }
  ok('índices únicos reales: teléfono vivo, fila y (actor, clave)')

  // 9. Sin datos privados en la tabla
  const cols = (await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'referidos_reservas'", [esquema])).rows.map(x => x.column_name)
  assert.ok(!cols.some(x => /nombre|mail|tel(efono)?$|estudio|email/.test(x))); ok('la tabla no tiene columnas de contacto')

  // 10. Timeout del lock real (lock_timeout 8 s): se verifica sin esperar los 8 s reales solo si LOCK_LARGO=1
  if (process.env.LOCK_LARGO === '1') {
    const held = await pool.connect(); await held.query('BEGIN'); await held.query('SELECT pg_advisory_xact_lock($1::bigint)', [CLAVE_LOCK])
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
