// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-escribir-canje.mjs
// Escritor del libro "Créditos" (canje) y sus reservas durables, con una BASE FALSA EN MEMORIA y una PLANILLA FALSA. NO hay Postgres provisionado ni se
// escribe en ninguna planilla real. LÍMITES DEL MOCK: modela solo las sentencias que usa reservasCanje.ts (BEGIN/COMMIT/ROLLBACK, SET LOCAL, advisory lock
// global, SELECT/INSERT/UPDATE/DELETE de canjes_reservas) y sus restricciones únicas. Prueba la LÓGICA del protocolo (reserva antes de escribir, reintentos con
// saldo congelado, cortes, conflictos, doble gasto). NO prueba Postgres real (locks reales, pooler, timeouts del servidor, SSL, red) ni Google Sheets reales.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { crearReservasCanjePostgres, CLAVE_LOCK_CANJE, SQL_CANJE } from '../lib/clientes/reservasCanje.ts'
import { registrarCanje, filasCanje } from '../lib/clientes/escribirCanje.ts'
import { calcularCreditos } from '../lib/clientes/creditos.ts'
import { estadoEscrituraCanje } from '../lib/clientes/canje.ts'
import { REGLAS_REFERIDOS } from '../lib/clientes/reglasReferidos.ts'
import { serialAYmd, sumarDias } from '../lib/clientes/fechas.ts'

const SECRETO = 's'.repeat(40)
const HOY = '2026-10-06'
const R0 = { ...REGLAS_REFERIDOS, vigenteDesde: '2000-01-01' }
const pausa = ms => new Promise(r => setTimeout(r, ms))
const vivo = r => r.estado !== 'descartada'

function baseFalsa() {
  const db = { filas: [], abiertas: 0, liberadas: [], cola: Promise.resolve(), conexionesFallan: 0, sinLock: false, llamadas: 0 }
  db.fallarConexiones = n => { db.conexionesFallan = n }
  db.conectar = async () => {
    db.llamadas++
    if (db.conexionesFallan > 0 && --db.conexionesFallan === 0) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    const tx = { ops: [], libre: null }
    const unico = p => {
      const [id, fila, cliente, ciclo, a, k] = p
      const todas = [...db.filas, ...tx.ops.map(o => o.fila).filter(Boolean)]
      if (todas.some(r => r.fila === fila) || todas.some(r => r.id_numero === id)) throw Object.assign(new Error('duplicate key (fila/id)'), { code: '23505' })
      if (todas.some(r => vivo(r) && r.cliente === cliente && r.ciclo_clave === ciclo)) throw Object.assign(new Error('duplicate key (cliente, ciclo)'), { code: '23505' })
      if (todas.some(r => vivo(r) && r.actor_hash === a && r.clave_hash === k)) throw Object.assign(new Error('duplicate key (actor, clave)'), { code: '23505' })
    }
    const soltar = () => { if (tx.libre) { tx.libre(); tx.libre = null } }
    db.abiertas++
    return {
      async query(sql, p = []) {
        const ver = () => [...db.filas.filter(f => !tx.ops.some(o => o.borrar === f.id_numero)), ...tx.ops.map(o => o.fila).filter(Boolean)]
        if (/^BEGIN/.test(sql) || /^SET LOCAL/.test(sql)) return { rows: [], rowCount: 0 }
        if (/pg_advisory_xact_lock/.test(sql)) {
          assert.equal(p[0], CLAVE_LOCK_CANJE)
          if (db.sinLock) return { rows: [], rowCount: 0 }
          const turno = db.cola; let suelta; db.cola = new Promise(r => (suelta = r)); await turno; tx.libre = suelta; return { rows: [], rowCount: 0 }
        }
        if (/WHERE actor_hash = \$1 AND clave_hash = \$2/.test(sql)) return { rows: ver().filter(r => vivo(r) && r.actor_hash === p[0] && r.clave_hash === p[1]), rowCount: 0 }
        if (/WHERE cliente = \$1 AND ciclo_clave = \$2/.test(sql)) return { rows: ver().filter(r => vivo(r) && r.cliente === p[0] && r.ciclo_clave === p[1]), rowCount: 0 }
        if (/MAX\(fila\)/.test(sql)) { const v = ver(); return { rows: [{ max_fila: Math.max(0, ...v.map(r => r.fila)), max_id: Math.max(0, ...v.map(r => r.id_numero)) }], rowCount: 1 } }
        if (/^INSERT INTO canjes_reservas/.test(sql)) {
          if (db.sinLock) await pausa(2) // sin lock se abre la ventana de carrera: solo los índices únicos protegen
          unico(p); tx.ops.push({ fila: { id_numero: p[0], fila: p[1], cliente: p[2], ciclo_clave: p[3], actor_hash: p[4], clave_hash: p[5], huella_pedido: p[6], huella: p[7], meses: p[8], usd: p[9], extra: p[10], estado: 'pendiente', resultado: null } }); return { rows: [], rowCount: 1 }
        }
        if (/SET estado = 'confirmada'/.test(sql)) { const r = db.filas.find(x => x.id_numero === p[0] && x.estado === 'pendiente'); if (!r) return { rows: [], rowCount: 0 }; tx.ops.push({ mut: () => { r.estado = 'confirmada'; r.resultado = JSON.parse(p[1]) } }); return { rows: [], rowCount: 1 } }
        if (/SET estado = 'descartada'/.test(sql)) { const r = db.filas.find(x => x.id_numero === p[0] && x.estado === 'pendiente'); if (!r) return { rows: [], rowCount: 0 }; tx.ops.push({ mut: () => { r.estado = 'descartada' } }); return { rows: [], rowCount: 1 } }
        if (/^DELETE FROM canjes_reservas/.test(sql)) { const r = db.filas.find(x => x.id_numero === p[0] && x.estado === 'pendiente'); if (!r) return { rows: [], rowCount: 0 }; tx.ops.push({ borrar: p[0] }); return { rows: [], rowCount: 1 } }
        if (/^SELECT estado FROM/.test(sql)) return { rows: db.filas.filter(x => x.id_numero === p[0]).map(x => ({ estado: x.estado })), rowCount: 0 }
        if (/^COMMIT/.test(sql)) { for (const o of tx.ops) { if (o.fila) db.filas.push(o.fila); else if (o.mut) o.mut(); else if (o.borrar) db.filas = db.filas.filter(f => f.id_numero !== o.borrar) } tx.ops = []; soltar(); return { rows: [], rowCount: 0 } }
        if (/^ROLLBACK/.test(sql)) { tx.ops = []; soltar(); return { rows: [], rowCount: 0 } }
        throw new Error('sentencia no modelada: ' + sql)
      },
      release(destruir) { db.abiertas--; db.liberadas.push(!!destruir); soltar() },
    }
  }
  return db
}
const reservasDe = db => crearReservasCanjePostgres({ conectar: db.conectar, secreto: SECRETO })

const REF = (o = {}) => ({ id: 'S1', fila: 2, fechaPedido: null, momento: '', idReferidor: 'A001', nombre: 'Lead', telefono: '', mail: '', estudio: '', estado: 'No cerró', fechaLlamada: '2026-08-01', idClienteNuevo: '', fechaPrimerPago: null, fechaLiberacion: null, reembolso: false, notas: '', cargadoPor: '', ...o })
const intentos = n => Array.from({ length: n }, (_, i) => REF({ id: `S${i + 1}`, fechaLlamada: sumarDias('2026-08-01', i) }))
const cierres = n => Array.from({ length: n }, (_, i) => REF({ id: `R${i + 1}`, estado: 'Cerró', fechaLlamada: '2026-09-01', fechaPrimerPago: '2026-09-10' }))

// Planilla falsa del libro: el saldo se recalcula de verdad desde lo que hay escrito (como una lectura fresca del CRM)
function planillaFalsa(referidos = [...cierres(1), ...intentos(2)]) {
  const p = { rows: new Map([[2, { id: 'M001' }], [3, { id: 'M002' }]]), escrituras: [], pisadas: 0, antes: null, despues: null, retardo: 0, ocupar: new Map(), lecturas: 0, falloLectura: false }
  p.movimientos = () => [...p.rows.values()].filter(r => r.mov).map(r => r.mov)
  p.leerEstado = async idCliente => {
    p.lecturas++
    if (p.falloLectura) throw new Error('boom')
    await pausa(p.retardo)
    const resumen = calcularCreditos({ idCliente, referidos, hoy: HOY, movimientos: p.movimientos() }, R0)
    const filas = [...p.rows.keys(), ...p.ocupar.keys()]
    return { clienteExiste: idCliente === 'A001', resumen, primeraFilaLibre: Math.max(1, ...filas) + 1, mayorIdNumero: Math.max(0, ...[...p.rows.values(), ...[...p.ocupar.values()].map(id => ({ id }))].map(r => Number(/^M(\d+)$/.exec(r.id)?.[1] ?? 0))) }
  }
  p.leerIdDeFila = async f => (p.ocupar.get(f) ?? p.rows.get(f)?.id ?? '')
  p.escribir = async (fila, ag, ik) => {
    assert.equal(ag.length, 7); assert.equal(ik.length, 3) // A:G e I:K: H (Vence, fórmula) no se toca
    if (p.antes) { const e = p.antes; p.antes = null; throw e }
    if (p.retardo) await pausa(p.retardo)
    if (p.rows.has(fila) || p.ocupar.has(fila)) { p.pisadas++; throw new Error('PISADA de la fila ' + fila) }
    p.escrituras.push({ fila, ag, ik })
    p.rows.set(fila, { id: ag[0], ag, ik, mov: { id: ag[0], fila, fecha: serialAYmd(ag[1]), idCliente: ag[2], tipo: ag[3], idReferido: '', meses: ag[5], extra: ag[6], vence: null, renovacionAplicada: ik[0], nota: ik[1], cargadoPor: ik[2] } })
    if (p.despues) { const e = p.despues; p.despues = null; throw e }
  }
  return p
}
const ent = (o = {}) => ({ idCliente: 'A001', renovacionAplicada: 'Renovación 2026-11', fecha: HOY, claveEnvio: 'k1', ...o })
const canjear = (db, p, entrada = ent(), actor = 'ana@x.com', extra = {}) => registrarCanje(entrada, actor, { planilla: p, bandera: true, reservas: reservasDe(db), rol: 'csm', hoy: HOY, reglas: R0, ...extra })

describe('apagado por defecto y permisos', () => {
  test('sin bandera: simulación pura, sin base y sin escribir; con bandera y sin base: bloqueada', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    const r = await registrarCanje(ent(), 'ana@x.com', { planilla: p, bandera: false, reservas: reservasDe(db), rol: 'csm', hoy: HOY, reglas: R0 })
    assert.equal(r.ok, true); assert.equal(r.estado, 'simulado'); assert.equal(db.llamadas, 0); assert.equal(p.escrituras.length, 0)
    const b = await registrarCanje(ent(), 'ana@x.com', { planilla: p, bandera: true, reservas: null, rol: 'csm', hoy: HOY, reglas: R0 })
    assert.equal(b.codigo, 'escritura_bloqueada'); assert.equal(p.escrituras.length, 0)
  })
  test('con bandera y base la ruta pasa a escritura real; sin base sigue bloqueada', () => {
    assert.equal(estadoEscrituraCanje(true, true).modo, 'real'); assert.equal(estadoEscrituraCanje(true, false).modo, 'bloqueada')
  })
  test('sin actor, con rol sin permiso o con datos inválidos no toca la base ni la planilla', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    assert.equal((await canjear(db, p, ent(), '  ')).codigo, 'sin_actor')
    assert.equal((await canjear(db, p, ent(), 'a@x.com', { rol: 'closer' })).codigo, 'sin_permiso')
    assert.equal((await canjear(db, p, ent({ fecha: '2026-10-05' }))).codigo, 'validacion')   // retroactiva
    assert.equal((await canjear(db, p, ent({ contexto: 'efectivo' }))).codigo, 'validacion')
    assert.equal(db.llamadas, 0); assert.equal(p.lecturas, 0); assert.equal(p.escrituras.length, 0)
  })
})

describe('la reserva se commitea ANTES de escribir; monedas explícitas', () => {
  test('al escribir ya hay una reserva commiteada, sin transacción abierta; la fila va después del último ID del libro', async () => {
    const db = baseFalsa(), p = planillaFalsa(); let visto
    const orig = p.escribir; p.escribir = async (...a) => { visto = { reservas: db.filas.map(f => ({ fila: f.fila, id: f.id_numero, estado: f.estado, meses: f.meses, usd: f.usd })), abiertas: db.abiertas }; return orig(...a) }
    const r = await canjear(db, p)
    assert.deepEqual(visto, { reservas: [{ fila: 4, id: 3, estado: 'pendiente', meses: 1, usd: 300 }], abiertas: 0 })
    assert.equal(r.ok, true); assert.equal(r.estado, 'guardado'); assert.equal(r.id, 'M003'); assert.equal(r.fila, 4)
    assert.equal(db.filas[0].estado, 'confirmada'); assert.equal(db.abiertas, 0)
  })
  test('meses en F (negativos) y USD solo como texto en Extra; nunca sumados; H no se escribe', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    await canjear(db, p)
    const { ag, ik } = p.escrituras[0]
    assert.deepEqual([ag[0], ag[2], ag[3], ag[4], ag[5], ag[6]], ['M003', 'A001', 'canje', '', -1, 'USD 300'])
    assert.deepEqual([ik[0], ik[2]], ['Renovación 2026-11', 'ana@x.com'])
    assert.equal(db.filas[0].meses, 1); assert.equal(db.filas[0].usd, 300)   // en la base también son columnas separadas
  })
  test('solo USD: meses = 0; solo meses: Extra vacío', async () => {
    const dbA = baseFalsa(), pA = planillaFalsa(intentos(2)); await canjear(dbA, pA)
    assert.deepEqual([pA.escrituras[0].ag[5], pA.escrituras[0].ag[6]], [0, 'USD 300'])
    const dbB = baseFalsa(), pB = planillaFalsa(cierres(1)); await canjear(dbB, pB)
    assert.deepEqual([pB.escrituras[0].ag[5], pB.escrituras[0].ag[6]], [-1, ''])
  })
  test('un texto con "=" no se escribe como fórmula (renovación y actor)', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    await canjear(db, p, ent({ renovacionAplicada: '=HYPERLINK("x")' }), '=cmd@x.com')
    assert.equal(p.escrituras[0].ik[0].startsWith("'="), true); assert.equal(p.escrituras[0].ik[2], "'=cmd@x.com")
  })
  test('filasCanje usa el saldo CONGELADO de la reserva, no el estado actual', () => {
    const f = filasCanje({ id: 'M009', cliente: 'A001', meses: 4, usd: 0, extra: 'renovación gratis' }, { fecha: HOY, renovacionAplicada: 'R2' }, 'a@x.com', R0)
    assert.deepEqual(f.bloqueAG.slice(5), [-4, 'renovación gratis'])
  })
})

describe('reintentos e idempotencia', () => {
  test('mismo envío repetido tras confirmarse: mismo ID, sin segunda fila ni segunda escritura (aunque el saldo ya es cero)', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    const a = await canjear(db, p), b = await canjear(db, p)
    assert.equal(a.id, b.id); assert.equal(b.estado, 'guardado'); assert.equal(p.escrituras.length, 1); assert.equal(db.filas.length, 1)
  })
  test('misma clave con OTRO pedido (otra renovación) = conflicto 409, no escribe', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    await canjear(db, p)
    const c = await canjear(db, p, ent({ renovacionAplicada: 'Otra renovación' }))
    assert.equal(c.codigo, 'clave_reutilizada'); assert.equal(p.escrituras.length, 1)
  })
  test('el actor es parte de la clave: otro actor con la misma clave no hereda la reserva', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    await canjear(db, p, ent(), 'ana@x.com')
    const r = await canjear(db, p, ent(), 'bruno@x.com')   // saldo ya en cero: se rechaza, nunca devuelve el resultado de Ana
    assert.equal(r.ok, false); assert.equal(r.codigo, 'rechazado'); assert.equal(r.motivo, 'sin_saldo'); assert.equal(p.escrituras.length, 1)
  })
})

describe('cortes y fallos', () => {
  test('escritura con error ambiguo (corte antes de llegar): pendiente_confirmacion, nunca guardado; el reintento completa la MISMA fila', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    const a = await canjear(db, p)
    assert.equal(a.ok, false); assert.equal(a.codigo, 'pendiente_confirmacion'); assert.equal(db.filas[0].estado, 'pendiente'); assert.equal(p.escrituras.length, 0)
    const b = await canjear(db, p)
    assert.equal(b.estado, 'guardado'); assert.equal(b.id, a.id); assert.equal(b.fila, a.fila); assert.equal(p.escrituras.length, 1)
  })
  test('la escritura LLEGÓ pero la respuesta se perdió: el reintento reconoce su ID y confirma sin reescribir, pese a que el saldo del libro ya es cero', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.despues = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    const a = await canjear(db, p)
    assert.equal(a.codigo, 'pendiente_confirmacion'); assert.equal(p.escrituras.length, 1)
    assert.equal((await p.leerEstado('A001')).resumen.usd.disponible, 0)   // el libro ya refleja el canje: una relectura lo rechazaría
    const b = await canjear(db, p)
    assert.equal(b.estado, 'guardado'); assert.equal(b.id, a.id); assert.equal(p.escrituras.length, 1); assert.equal(db.filas[0].estado, 'confirmada')
  })
  test('falla al confirmar en la base: la fila ya está escrita, se avisa y el reintento confirma sin duplicar', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    const orig = p.escribir; p.escribir = async (...a) => { await orig(...a); db.fallarConexiones(1) } // la próxima conexión (confirmar) cae
    const a = await canjear(db, p)
    assert.equal(a.ok, true); assert.equal(a.estado, 'guardado'); assert.match(a.avisos.join(' '), /falta confirmarla/); assert.equal(db.filas[0].estado, 'pendiente')
    const b = await canjear(db, p)
    assert.equal(b.estado, 'guardado'); assert.equal(p.escrituras.length, 1); assert.equal(db.filas[0].estado, 'confirmada')
  })
  test('403 de la planilla: se libera la reserva sin escribir y un reintento posterior usa de nuevo esa fila', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = Object.assign(new Error('forbidden'), { code: 403 })
    const a = await canjear(db, p)
    assert.equal(a.codigo, 'sin_permiso_planilla'); assert.equal(db.filas.length, 0); assert.equal(p.escrituras.length, 0)
    const b = await canjear(db, p)
    assert.equal(b.estado, 'guardado'); assert.equal(b.fila, 4)
  })
  test('fila reservada ocupada por una edición manual: se descarta, no se pisa, y su fila e ID no se reusan', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    const orig = p.leerIdDeFila; p.leerIdDeFila = async f => { if (f === 4 && !p.ocupar.size) p.ocupar.set(4, 'M777'); return orig(f) }
    const a = await canjear(db, p)
    assert.equal(a.codigo, 'rechazado'); assert.equal(a.motivo, 'fila_ocupada'); assert.equal(p.pisadas, 0); assert.equal(db.filas[0].estado, 'descartada')
    const b = await canjear(db, p, ent({ claveEnvio: 'k2' }))
    assert.equal(b.estado, 'guardado'); assert.ok(b.fila > 4); assert.notEqual(b.id, 'M003'); assert.equal(p.pisadas, 0)
  })
  test('la base cae al reservar: nada se escribe y el reintento funciona', async () => {
    const db = baseFalsa(), p = planillaFalsa(); db.fallarConexiones(2) // 1.ª conexión = búsqueda por clave, 2.ª = reserva
    const a = await canjear(db, p)
    assert.equal(a.codigo, 'escritura_bloqueada'); assert.equal(p.escrituras.length, 0); assert.equal(db.filas.length, 0)
    const b = await canjear(db, p); assert.equal(b.estado, 'guardado'); assert.equal(p.escrituras.length, 1)
  })
  test('la base cae en la búsqueda por clave: bloqueada, no se lee ni se escribe la planilla', async () => {
    const db = baseFalsa(), p = planillaFalsa(); db.fallarConexiones(1)
    const a = await canjear(db, p); assert.equal(a.codigo, 'escritura_bloqueada'); assert.equal(p.lecturas, 0); assert.equal(p.escrituras.length, 0)
  })
  test('falla la lectura del libro: planilla_no_disponible, sin reservar', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.falloLectura = true
    const a = await canjear(db, p); assert.equal(a.codigo, 'planilla_no_disponible'); assert.equal(db.filas.length, 0)
  })
  test('cualquier fallo deja el pool limpio: ninguna conexión abierta', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = new Error('boom')
    await canjear(db, p); await canjear(db, p)
    assert.equal(db.abiertas, 0)
  })
})

describe('doble gasto y concurrencia', () => {
  test('dos instancias con la MISMA lectura (saldo 600) y claves distintas: una sola fila en el libro', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.retardo = 5 // ambas leen el saldo antes de que alguna reserve
    const [a, b] = await Promise.all([canjear(db, p, ent({ claveEnvio: 'kA' })), canjear(db, p, ent({ claveEnvio: 'kB' }))])
    assert.equal(p.escrituras.length, 1); assert.equal(db.filas.filter(vivo).length, 1); assert.equal(p.pisadas, 0)
    const res = [a, b]
    assert.equal(res.filter(r => r.ok && r.estado === 'guardado').length, 1)
    assert.equal(res.filter(r => !r.ok && r.codigo === 'pendiente_confirmacion').length, 1)   // el idéntico no reserva dos veces
  })
  test('lectura vieja con otro contenido sobre el mismo ciclo (otra renovación): conflicto de ciclo, no se escribe', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.retardo = 5
    const [a, b] = await Promise.all([canjear(db, p, ent({ claveEnvio: 'kA' })), canjear(db, p, ent({ claveEnvio: 'kB', renovacionAplicada: 'Otra renovación' }))])
    assert.equal(p.escrituras.length, 1); assert.equal([a, b].filter(r => !r.ok && r.codigo === 'conflicto_ciclo').length, 1)
  })
  test('otro actor con el mismo canje exacto sobre el mismo ciclo: conflicto (el actor es parte del contenido)', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.retardo = 5
    const [a, b] = await Promise.all([canjear(db, p, ent({ claveEnvio: 'kA' }), 'ana@x.com'), canjear(db, p, ent({ claveEnvio: 'kB' }), 'bruno@x.com')])
    assert.equal(p.escrituras.length, 1); assert.equal([a, b].filter(r => !r.ok && r.codigo === 'conflicto_ciclo').length, 1)
  })
  test('SIN el lock (corte, conexión nueva, otra instancia): los índices únicos siguen impidiendo el doble gasto', async () => {
    const db = baseFalsa(), p = planillaFalsa(); db.sinLock = true; p.retardo = 5
    const rs = await Promise.all([1, 2, 3, 4].map(i => canjear(db, p, ent({ claveEnvio: `k${i}` }))))
    assert.equal(p.escrituras.length, 1); assert.equal(db.filas.filter(vivo).length, 1); assert.equal(p.pisadas, 0)
    assert.equal(rs.filter(r => r.ok).length, 1)   // el resto: error de índice único (bloqueada) o reserva idéntica pendiente; nunca otra fila
    assert.ok(rs.filter(r => !r.ok).every(r => ['escritura_bloqueada', 'pendiente_confirmacion', 'conflicto_ciclo'].includes(r.codigo)))
  })
  test('un lock tomado y soltado a la fuerza no abre la puerta: la reserva commiteada sigue ahí tras el corte', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = new Error('corte')
    await canjear(db, p)   // queda pendiente (commiteada)
    const otra = reservasDe(db)
    const s = await otra.reservar({ actor: 'x@x.com', clave: 'otra', huellaPedido: 'p', huella: 'h', cliente: 'A001', cicloClave: '', meses: 1, usd: 300, extra: 'USD 300', pisoFila: 4, pisoIdNumero: 2 })
    assert.equal(s.tipo, 'conflicto_ciclo')   // el ciclo está ocupado por la reserva pendiente
  })
  test('ciclos distintos de un mismo cliente sí pueden reservar (tras un canje asentado empieza otro ciclo)', async () => {
    const db = baseFalsa(), r = reservasDe(db)
    const base = { actor: 'a@x.com', huellaPedido: 'p', huella: 'h', cliente: 'A001', meses: 1, usd: 0, extra: '', pisoFila: 2, pisoIdNumero: 0 }
    assert.equal((await r.reservar({ ...base, clave: 'k1', cicloClave: '' })).tipo, 'nueva')
    assert.equal((await r.reservar({ ...base, clave: 'k2', cicloClave: '2026-10-06', huella: 'h2' })).tipo, 'nueva')
  })
  test('filas e IDs de 20 canjes de 20 clientes simultáneos: únicos y consecutivos', async () => {
    const db = baseFalsa(), r = reservasDe(db)
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => r.reservar({ actor: 'a@x.com', clave: `k${i}`, huellaPedido: `p${i}`, huella: `h${i}`, cliente: `A${100 + i}`, cicloClave: '', meses: 1, usd: 0, extra: '', pisoFila: 2, pisoIdNumero: 0 })))
    assert.ok(rs.every(x => x.tipo === 'nueva')); assert.deepEqual(rs.map(x => x.reserva.fila).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2))
  })
  test('la tabla no guarda datos de contacto y hashea actor y clave', async () => {
    const db = baseFalsa(), p = planillaFalsa(); await canjear(db, p)
    const f = db.filas[0]; assert.ok(!JSON.stringify(f).includes('ana@x.com')); assert.ok(!JSON.stringify(f).includes('k1"') || f.clave_hash.length === 64)
    assert.equal(f.actor_hash.length, 64)
  })
  test('el SQL del adapter nombra la tabla de la migración 002 y no suma meses con USD', () => {
    for (const q of Object.values(SQL_CANJE)) if (/canjes_reservas/.test(q)) assert.ok(!/meses\s*\+\s*usd|usd\s*\+\s*meses/i.test(q))
    assert.match(SQL_CANJE.insertar, /meses, usd, extra/)
  })
})
