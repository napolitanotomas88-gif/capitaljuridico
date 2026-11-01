// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-coordinador-postgres.mjs
// Reservas durables del alta de referidos con una BASE FALSA EN MEMORIA y una PLANILLA FALSA (no hay Postgres local ni provisionado).
// LÍMITES DEL MOCK: modela solo las sentencias que usa el adapter (BEGIN/COMMIT/ROLLBACK, SET LOCAL, advisory lock global, SELECT/INSERT/
// UPDATE/DELETE de referidos_reservas) y las restricciones únicas. Prueba la LÓGICA del protocolo: reservar y commitear ANTES de escribir,
// reintentos con la misma fila, exclusividad por teléfono, pendiente vs confirmada, cortes simulados. NO prueba Postgres real (locks reales,
// pooler, timeouts del servidor, SSL, red) ni Google Sheets reales. Ninguna prueba toca la red.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { crearReservasPostgres, coordinadorDesdeEntorno, urlDeBaseValida, CLAVE_LOCK } from '../lib/clientes/coordinadorPostgres.ts'
import { registrarReferido } from '../lib/clientes/escribirReferido.ts'

const SECRETO = 'k'.repeat(40)
const pausa = ms => new Promise(r => setTimeout(r, ms))
const vivo = r => r.estado !== 'descartada'

function baseFalsa() {
  const db = { filas: [], log: [], abiertas: 0, liberadas: [], cola: Promise.resolve(), conexionesFallan: 0, maxEnSeccion: 0, enSeccion: 0 }
  db.fallarConexiones = n => { db.conexionesFallan = n } // falla la n-ésima conexión que se pida desde ahora (n = 1: la próxima)
  db.conectar = async () => {
    if (db.conexionesFallan > 0 && --db.conexionesFallan === 0) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    const tx = { ops: [], libre: null }
    const unico = (fila, id, tel, a, k) => {
      const todas = [...db.filas, ...tx.ops.map(o => o.fila)]
      if (todas.some(r => r.fila === fila) || todas.some(r => r.id_numero === id)) throw Object.assign(new Error('duplicate key (fila/id)'), { code: '23505' })
      if (todas.some(r => vivo(r) && r.telefono_hash === tel) || todas.some(r => vivo(r) && r.actor_hash === a && r.clave_hash === k)) throw Object.assign(new Error('duplicate key (vivo)'), { code: '23505' })
    }
    const soltar = () => { if (tx.libre) { tx.libre(); tx.libre = null; db.enSeccion-- } }
    db.abiertas++
    return {
      async query(sql, p = []) {
        db.log.push(sql.replace(/\s+/g, ' ').slice(0, 60))
        const ver = () => [...db.filas.filter(f => !tx.ops.some(o => o.borrar === f.id_numero)), ...tx.ops.map(o => o.fila).filter(Boolean)]
        if (/^BEGIN/.test(sql) || /^SET LOCAL/.test(sql)) return { rows: [], rowCount: 0 }
        if (/pg_advisory_xact_lock/.test(sql)) {
          assert.equal(p[0], CLAVE_LOCK)
          const turno = db.cola; let suelta; db.cola = new Promise(r => (suelta = r)); await turno
          tx.libre = suelta; db.enSeccion++; db.maxEnSeccion = Math.max(db.maxEnSeccion, db.enSeccion); return { rows: [], rowCount: 0 }
        }
        if (/WHERE actor_hash = \$1 AND clave_hash = \$2/.test(sql)) return { rows: ver().filter(r => vivo(r) && r.actor_hash === p[0] && r.clave_hash === p[1]), rowCount: 0 }
        if (/WHERE telefono_hash = \$1/.test(sql)) return { rows: ver().filter(r => vivo(r) && r.telefono_hash === p[0]), rowCount: 0 }
        if (/MAX\(fila\)/.test(sql)) { const v = ver(); return { rows: [{ max_fila: Math.max(0, ...v.map(r => r.fila)), max_id: Math.max(0, ...v.map(r => r.id_numero)) }], rowCount: 1 } }
        if (/^INSERT INTO referidos_reservas/.test(sql)) { unico(p[1], p[0], p[2], p[3], p[4]); tx.ops.push({ fila: { id_numero: p[0], fila: p[1], telefono_hash: p[2], actor_hash: p[3], clave_hash: p[4], huella: p[5], referidor: p[6], estado: 'pendiente', resultado: null } }); return { rows: [], rowCount: 1 } }
        if (/SET estado = 'confirmada'/.test(sql)) { const r = db.filas.find(x => x.id_numero === p[0] && x.estado === 'pendiente'); if (!r) return { rows: [], rowCount: 0 }; tx.ops.push({ mut: () => { r.estado = 'confirmada'; r.resultado = JSON.parse(p[1]) } }); return { rows: [], rowCount: 1 } }
        if (/SET estado = 'descartada'/.test(sql)) { const r = db.filas.find(x => x.id_numero === p[0] && x.estado === 'pendiente'); if (!r) return { rows: [], rowCount: 0 }; tx.ops.push({ mut: () => { r.estado = 'descartada' } }); return { rows: [], rowCount: 1 } }
        if (/^DELETE FROM referidos_reservas/.test(sql)) { const r = db.filas.find(x => x.id_numero === p[0] && x.estado === 'pendiente'); if (!r) return { rows: [], rowCount: 0 }; tx.ops.push({ borrar: p[0] }); return { rows: [], rowCount: 1 } }
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
const reservasDe = db => crearReservasPostgres({ conectar: db.conectar, secreto: SECRETO })

// Planilla falsa compartida por varias "instancias": detecta cualquier pisada de una fila ocupada
function planillaFalsa() {
  const p = { rows: new Map(), escrituras: [], pisadas: 0, antes: null, despues: null, retardo: 0, ocupar: new Map() }
  p.leerReferidos = async () => {
    await pausa(1)
    const existentes = [...p.rows.entries()].map(([f, r]) => ({ id: r.id, idReferidor: r.ref, digitos: r.digitos, fechaPedido: '2026-10-05', momento: 'Primer win', fila: f }))
    return { existentes, primeraFilaLibre: Math.max(1, ...p.rows.keys()) + 1 }
  }
  p.leerClientes = async () => [{ id: 'A012', estado: 'ACTIVO', digitos: '5493510000000', mail: '' }, { id: 'A013', estado: 'ACTIVO', digitos: '5493510000001', mail: '' }]
  p.leerIdDeFila = async f => (p.ocupar.get(f) ?? p.rows.get(f)?.id ?? '')
  p.escribir = async (fila, al, np) => {
    assert.equal(al.length, 12); assert.equal(np.length, 3) // A:L y N:P: M y Q (fórmulas) no se tocan
    if (p.antes) { const e = p.antes; p.antes = null; throw e }
    if (p.retardo) await pausa(p.retardo)
    if (p.rows.has(fila) || p.ocupar.has(fila)) { p.pisadas++; throw new Error('PISADA de la fila ' + fila) }
    p.escrituras.push(fila); p.rows.set(fila, { id: al[0], ref: al[3], digitos: String(al[5]).replace(/\D/g, '') })
    if (p.despues) { const e = p.despues; p.despues = null; throw e }
  }
  return p
}
const HOY = '2026-10-06', ENT = { vercel: true, produccion: true }
const base = { idReferidor: 'A012', nombre: 'Laura Gómez', telefono: '+54 9 351 555 1234', estudio: 'Estudio Gómez', momento: 'Primer win', fechaPedido: '2026-10-05', claveEnvio: 'k1' }
const alta = (db, p, entrada, actor = 'ana@x.com') => registrarReferido(entrada, actor, { planilla: p, bandera: true, entorno: ENT, coordinador: reservasDe(db), hoy: HOY })

describe('la reserva se commitea ANTES de escribir en el Sheet', () => {
  test('al escribir en la planilla ya hay una reserva commiteada y ninguna transacción abierta', async () => {
    const db = baseFalsa(), p = planillaFalsa(); let visto
    const orig = p.escribir; p.escribir = async (...a) => { visto = { reservas: db.filas.map(f => ({ fila: f.fila, estado: f.estado })), abiertas: db.abiertas }; return orig(...a) }
    const r = await alta(db, p, base)
    assert.deepEqual(visto, { reservas: [{ fila: 2, estado: 'pendiente' }], abiertas: 0 }); assert.equal(r.estado, 'guardado')
    assert.equal(db.filas[0].estado, 'confirmada'); assert.equal(db.abiertas, 0)
  })
  test('el lock se toma solo en la reserva (transacción corta) y las 10 reservas concurrentes nunca se pisan', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.retardo = 3
    const reservas = [reservasDe(db), reservasDe(db), reservasDe(db)]
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => registrarReferido({ ...base, telefono: `+54 9 351 555 ${1000 + i}`, claveEnvio: `k${i}` }, `u${i % 3}@x.com`, { planilla: p, bandera: true, entorno: ENT, coordinador: reservas[i % 3], hoy: HOY })))
    assert.ok(rs.every(r => r.estado === 'guardado'), JSON.stringify(rs.map(r => r.codigo || r.estado)))
    assert.equal(db.maxEnSeccion, 1); assert.equal(p.pisadas, 0)
    assert.deepEqual([...p.escrituras].sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => i + 2))
    assert.equal(new Set(rs.map(r => r.id)).size, 10)
  })
})

describe('conexión a la base perdida durante una escritura lenta en el Sheet', () => {
  test('la segunda instancia no elige la misma fila ni el mismo ID; no hay pisadas', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.retardo = 40
    const A = alta(db, p, { ...base, claveEnvio: 'kA' })
    await pausa(10); db.fallarConexiones(2) // B reserva (1.ª conexión) y se cae la base cuando A quiere confirmar (2.ª): A ya había commiteado su reserva
    const B = await alta(db, p, { ...base, telefono: '+54 9 351 555 7777', nombre: 'Otra', claveEnvio: 'kB' }, 'beto@x.com')
    const a = await A
    assert.equal(B.estado, 'guardado'); assert.notEqual(B.id, a.id); assert.equal(p.pisadas, 0); assert.equal(p.rows.size, 2)
    assert.equal(a.ok, true); assert.equal(a.estado, 'guardado'); assert.match(a.avisos.join(' '), /falta confirmarla/) // la fila está escrita, la confirmación falló
    assert.equal(db.filas.find(f => f.id_numero === 1).estado, 'pendiente') // en la base sigue pendiente
  })
  test('reintentar A después: la fila ya está en el Sheet (ya_existia), sin segunda escritura', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.retardo = 5; db.fallarConexiones(0)
    const orig = p.escribir; let cortado = false
    p.escribir = async (...a) => { await orig(...a); if (!cortado) { cortado = true; db.fallarConexiones(1) } }
    const a = await alta(db, p, base); assert.match(a.avisos.join(' '), /falta confirmarla/)
    const re = await alta(db, p, base)
    assert.equal(re.estado, 'ya_existia'); assert.equal(p.escrituras.length, 1)
  })
})

describe('corte ambiguo y reintentos: se conserva la reserva, nunca se recalcula la fila', () => {
  test('timeout ANTES de que llegue la escritura: pendiente_confirmacion (no guardado); el reintento escribe en la MISMA fila aunque otro ya haya avanzado', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    p.antes = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
    const a = await alta(db, p, base)
    assert.equal(a.ok, false); assert.equal(a.codigo, 'pendiente_confirmacion'); assert.equal(a.fila, 2); assert.equal(p.rows.size, 0); assert.equal(db.filas[0].estado, 'pendiente')
    const b = await alta(db, p, { ...base, telefono: '+54 9 351 555 8888', claveEnvio: 'kB' }, 'beto@x.com') // otro avanza: fila 3
    assert.equal(b.fila, 3)
    const re = await alta(db, p, base) // reintento de A: misma reserva → fila 2 (no 4)
    assert.equal(re.estado, 'guardado'); assert.equal(re.fila, 2); assert.equal(re.id, a.id); assert.equal(p.pisadas, 0); assert.equal(db.filas.find(f => f.id_numero === 1).estado, 'confirmada')
  })
  test('timeout DESPUÉS de que la escritura llegó: no se declara guardado; el reintento lo reconoce y no escribe de nuevo', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.despues = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
    const a = await alta(db, p, base); assert.equal(a.codigo, 'pendiente_confirmacion'); assert.equal(p.rows.size, 1)
    const re = await alta(db, p, base)
    assert.equal(p.escrituras.length, 1); assert.ok(['ya_existia', 'guardado'].includes(re.estado))
  })
  test('reintento con lectura vieja del Sheet pero la fila reservada ya tiene el ID: se confirma sin reescribir', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.despues = new Error('corte'); await alta(db, p, base)
    const vieja = { ...p, leerReferidos: async () => ({ existentes: [], primeraFilaLibre: 2 }) } // réplica atrasada: no ve la fila
    const re = await registrarReferido(base, 'ana@x.com', { planilla: vieja, bandera: true, entorno: ENT, coordinador: reservasDe(db), hoy: HOY })
    assert.equal(re.estado, 'guardado'); assert.equal(re.fila, 2); assert.equal(p.escrituras.length, 1); assert.equal(db.filas[0].estado, 'confirmada')
  })
  test('el estado "pendiente" nunca se reporta como guardado', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = new Error('corte')
    const a = await alta(db, p, base); assert.equal(a.ok, false); assert.notEqual(a.estado, 'guardado'); assert.equal(db.filas[0].resultado, null)
  })
})

describe('exclusividad por persona y por clave', () => {
  test('claves distintas, mismo teléfono y mismo referidor: UNA sola reserva y una sola fila', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = new Error('corte') // la primera queda pendiente
    const a = await alta(db, p, { ...base, claveEnvio: 'k1' })
    const b = await alta(db, p, { ...base, claveEnvio: 'k2', nombre: 'Laura G.' }, 'beto@x.com')
    assert.equal(a.codigo, 'pendiente_confirmacion'); assert.equal(b.codigo, 'pendiente_confirmacion'); assert.equal(b.id, a.id); assert.equal(db.filas.length, 1); assert.equal(p.escrituras.length, 0)
  })
  test('dos actores, mismo teléfono, otro referidor: conflicto explícito, sin segunda reserva', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = new Error('corte')
    await alta(db, p, base)
    const r = await alta(db, p, { ...base, idReferidor: 'A013', claveEnvio: 'k9' }, 'beto@x.com')
    assert.equal(r.codigo, 'rechazado'); assert.equal(r.motivo, 'telefono_reservado_por_otro'); assert.equal(db.filas.length, 1)
  })
  test('misma clave, mismo actor, datos distintos: clave_reutilizada y sin cambios', async () => {
    const db = baseFalsa(), p = planillaFalsa(); await alta(db, p, base)
    const r = await alta(db, p, { ...base, nombre: 'Otra Persona', telefono: '+54 9 351 555 9999' })
    assert.equal(r.codigo, 'clave_reutilizada'); assert.equal(db.filas.length, 1); assert.equal(p.escrituras.length, 1)
  })
  test('dos actores con la misma clave y personas distintas: cada uno su fila', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    const a = await alta(db, p, base, 'ana@x.com'), b = await alta(db, p, { ...base, telefono: '+54 9 351 555 4321' }, 'beto@x.com')
    assert.equal(a.estado, 'guardado'); assert.equal(b.estado, 'guardado'); assert.notEqual(a.fila, b.fila)
  })
})

describe('fila ocupada a mano, permisos y falla de la base', () => {
  test('si la fila reservada aparece ocupada por otra cosa: se descarta, no se escribe, y el reintento usa una fila posterior', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.ocupar.set(2, 'MANUAL')
    const a = await alta(db, p, base); assert.equal(a.motivo, 'fila_ocupada'); assert.equal(p.escrituras.length, 0); assert.equal(db.filas[0].estado, 'descartada')
    p.ocupar.clear(); p.rows.set(2, { id: 'MANUAL', ref: 'A013', digitos: '1' })
    const re = await alta(db, p, base); assert.equal(re.estado, 'guardado'); assert.equal(re.fila, 3); assert.ok(re.id !== 'R001')
  })
  test('403: se libera la reserva (fila, ID y teléfono) y se puede reintentar', async () => {
    const db = baseFalsa(), p = planillaFalsa(); p.antes = Object.assign(new Error('forbidden'), { code: 403 })
    const a = await alta(db, p, base); assert.equal(a.codigo, 'sin_permiso_planilla'); assert.equal(db.filas.length, 0)
    const re = await alta(db, p, base); assert.equal(re.estado, 'guardado'); assert.equal(re.fila, 2)
  })
  test('base caída al reservar: no se escribe nada en el Sheet', async () => {
    const db = baseFalsa(), p = planillaFalsa(); db.fallarConexiones(1)
    const a = await alta(db, p, base); assert.equal(a.codigo, 'escritura_bloqueada'); assert.equal(p.escrituras.length, 0)
  })
  test('el piso sale del Sheet: filas cargadas a mano antes del primer alta se respetan', async () => {
    const db = baseFalsa(), p = planillaFalsa(); for (let f = 2; f <= 6; f++) p.rows.set(f, { id: `R00${f - 1}`, ref: 'A013', digitos: `351000000${f}` })
    const a = await alta(db, p, base); assert.equal(a.fila, 7); assert.equal(a.id, 'R006')
  })
})

describe('privacidad, llave y entorno', () => {
  test('la base guarda solo HMACs y metadatos: nada de contactos', async () => {
    const db = baseFalsa(), p = planillaFalsa(); await alta(db, p, base)
    const f = db.filas[0]; const json = JSON.stringify(f)
    assert.doesNotMatch(json, /laura|gómez|gomez|5493515551234|3515551234|estudio|ana@x\.com/i)
    for (const h of [f.telefono_hash, f.actor_hash, f.clave_hash, f.huella]) assert.match(h, /^[0-9a-f]{64}$/)
    assert.equal(f.referidor, 'A012'); assert.deepEqual(Object.keys(f.resultado).sort(), ['avisos', 'estado', 'fila', 'id', 'mensaje'])
  })
  test('sin llave HMAC propia (o corta) no hay coordinador ni llave pública por defecto', () => {
    assert.throws(() => crearReservasPostgres({ conectar: async () => null, secreto: '' }), /REFERIDOS_HMAC_SECRET/)
    assert.throws(() => crearReservasPostgres({ conectar: async () => null, secreto: 'corta' }), /REFERIDOS_HMAC_SECRET/)
    const PROD = { vercel: true, produccion: true }
    assert.equal(coordinadorDesdeEntorno({ DATABASE_URL: 'postgres://u:p@db.ejemplo.com:5432/cj' }, PROD), null)
    assert.equal(coordinadorDesdeEntorno({ DATABASE_URL: 'postgres://u:p@db.ejemplo.com:5432/cj', REFERIDOS_HMAC_SECRET: 'x'.repeat(31) }, PROD), null)
    assert.equal(coordinadorDesdeEntorno({ DATABASE_URL: 'postgres://u:p@db.ejemplo.com:5432/cj', REFERIDOS_HMAC_SECRET: SECRETO }, PROD)?.durable, true)
  })
  test('sin DATABASE_URL apropiada: null y queda la simulación; una base local no vale en Vercel', () => {
    const PROD = { vercel: true, produccion: true }
    for (const u of [undefined, '', 'mysql://u:p@h/db', 'http://x', 'no-es-url', 'postgres://u:p@host', 'postgres://u:p@host/']) assert.equal(coordinadorDesdeEntorno({ DATABASE_URL: u, REFERIDOS_HMAC_SECRET: SECRETO }, PROD), null, String(u))
    assert.equal(urlDeBaseValida('postgres://u:p@localhost:5432/db', PROD), null)
  })
  test('el SQL de la migración coincide con las tablas y columnas que usa el adapter y no guarda contactos', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync(new URL('../lib/clientes/migraciones/001_referidos_alta.sql', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    for (const c of ['id_numero', 'fila', 'telefono_hash', 'actor_hash', 'clave_hash', 'huella', 'referidor', 'estado', 'resultado']) assert.match(sql, new RegExp(`\\b${c}\\b`), c)
    assert.match(sql, /UNIQUE INDEX[^;]*telefono_hash\) WHERE estado <> 'descartada'/); assert.match(sql, /UNIQUE INDEX[^;]*actor_hash, clave_hash\) WHERE estado <> 'descartada'/)
    assert.match(sql, /fila\s+integer\s+NOT NULL UNIQUE/); assert.doesNotMatch(sql, /\b(nombre|telefono|mail|estudio|email)\b\s+(text|varchar)/i)
  })
})

describe('sin teléfono (vacío o de relleno): cada alta tiene su propia reserva', () => {
  test('dos altas del mismo cliente sin teléfono no chocan en la base ni se toman como la misma persona', async () => {
    const db = baseFalsa(), p = planillaFalsa()
    const a = await alta(db, p, { ...base, telefono: '', nombre: 'Persona Uno', claveEnvio: 's1' })
    const b = await alta(db, p, { ...base, telefono: '+54 000000000', nombre: 'Persona Dos', claveEnvio: 's2' })
    assert.equal(a.estado, 'guardado'); assert.equal(b.estado, 'guardado'); assert.notEqual(a.id, b.id); assert.equal(p.escrituras.length, 2)
    const c = await alta(db, p, { ...base, telefono: '+54 000000000', nombre: 'Persona Dos', claveEnvio: 's2' })   // reintento del mismo envío
    assert.equal(c.id, b.id); assert.equal(p.escrituras.length, 2)
  })
})
