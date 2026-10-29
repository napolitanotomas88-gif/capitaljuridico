// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-alta-referido.mjs
// "Registrar referido": validación, decisión, fila, idempotencia y autorización. SOLO con planillas simuladas: nunca toca la real.
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { validarAlta, decidirAlta, filaReferido, normalizarTelefono, siguienteId, claveTelefono } from '../lib/clientes/altaReferido.ts'
import { registrarReferido, escrituraRealPermitida, huellaAlta, coordinadorDurable } from '../lib/clientes/escribirReferido.ts'

const LOCAL = { vercel: false, produccion: false }
const VERCEL = { vercel: true, produccion: true }

const HOY = '2026-10-06'
const base = { idReferidor: 'a012', nombre: '  Laura   Gómez ', telefono: '+54 9 351 555-1234', mail: 'Laura@Estudio.com', estudio: 'Estudio Gómez', momento: 'Primer win', fechaPedido: '2026-10-05', notas: '', claveEnvio: 'k1' }
const clientes = [
  { id: 'A012', estado: 'ACTIVO', digitos: '5493515550000', mail: 'otro@x.com' },
  { id: 'A013', estado: 'ACTIVO', digitos: '5493515559999', mail: '' },
  { id: 'A014', estado: 'FINALIZADO', digitos: '5493515558888', mail: '' },
]
// Planilla simulada: guarda las "filas" escritas; cuenta lecturas y escrituras
function planillaFalsa({ existentes = [], falla403 = false, falla = false } = {}) {
  const p = { existentes: [...existentes], escrituras: [], lecturas: 0 }
  p.leerReferidos = async () => { p.lecturas++; if (falla) throw new Error('boom'); return { existentes: [...p.existentes], primeraFilaLibre: p.existentes.length + 2 } }
  p.leerClientes = async () => clientes
  p.escribir = async (fila, al, np) => {
    if (falla403) { const e = new Error('forbidden'); e.code = 403; throw e }
    await new Promise(r => setTimeout(r, 5))
    p.escrituras.push({ fila, al, np })
    p.existentes.push({ id: al[0], idReferidor: al[3], digitos: String(al[5]).replace(/\D/g, ''), fechaPedido: '2026-10-05', momento: al[2] })
  }
  return p
}

describe('validación', () => {
  test('limpia y normaliza', () => {
    const v = validarAlta(base, HOY); assert.ok(v.ok)
    assert.equal(v.alta.idReferidor, 'A012'); assert.equal(v.alta.nombre, 'Laura Gómez'); assert.equal(v.alta.telefono, '+5493515551234'); assert.equal(v.alta.mail, 'laura@estudio.com')
  })
  test('campos obligatorios y formatos', () => {
    const v = validarAlta({ idReferidor: '', nombre: 'a', telefono: '12', mail: 'x', estudio: '', momento: 'otro', fechaPedido: '2099-01-01' }, HOY)
    assert.ok(!v.ok); for (const k of ['idReferidor', 'nombre', 'telefono', 'mail', 'estudio', 'momento', 'fechaPedido']) assert.ok(v.errores[k], k)
  })
  test('fecha por defecto = hoy; futura o inválida no', () => {
    assert.equal(validarAlta({ ...base, fechaPedido: undefined }, HOY).alta.fechaPedido, HOY)
    assert.ok(!validarAlta({ ...base, fechaPedido: '2026-02-30' }, HOY).ok)
  })
  test('tipos raros no rompen ni inyectan', () => {
    const v = validarAlta({ ...base, nombre: { a: 1 }, estudio: ['x'], notas: 5 }, HOY); assert.ok(!v.ok)
    const w = validarAlta({ ...base, nombre: '=HYPERLINK("http://x")' }, HOY); assert.ok(w.ok)
    assert.match(filaReferido(w.alta, 'R001', 'a@b.c').bloqueAL[4], /^'=/) // no queda como fórmula
  })
  test('teléfono: clave de 8 dígitos reconoce el mismo número con y sin código de país', () => {
    assert.equal(claveTelefono(normalizarTelefono('+54 9 351 555 1234').digitos), claveTelefono(normalizarTelefono('3515551234').digitos))
  })
})

describe('decisión', () => {
  const alta = validarAlta(base, HOY).alta
  test('nuevo: ID siguiente', () => {
    const d = decidirAlta(alta, [{ id: 'R001', idReferidor: 'A013', digitos: '1', fechaPedido: null, momento: '' }, { id: 'R007', idReferidor: 'A013', digitos: '2', fechaPedido: null, momento: '' }], clientes)
    assert.equal(d.tipo, 'nuevo'); assert.equal(d.id, 'R008')
  })
  test('primer ID R001 con la pestaña vacía', () => assert.equal(siguienteId([]), 'R001'))
  test('mismo referidor y mismo teléfono = duplicado (idempotente)', () => {
    const d = decidirAlta(alta, [{ id: 'R003', idReferidor: 'A012', digitos: '5493515551234', fechaPedido: null, momento: '' }], clientes)
    assert.deepEqual(d, { tipo: 'duplicado', id: 'R003' })
  })
  test('el mismo teléfono con otro referidor se rechaza', () => {
    const d = decidirAlta(alta, [{ id: 'R003', idReferidor: 'A013', digitos: '03515551234', fechaPedido: null, momento: '' }], clientes)
    assert.equal(d.tipo, 'rechazado'); assert.equal(d.codigo, 'otro_referidor')
  })
  test('ya es cliente (teléfono o mail), referidor inexistente o inactivo', () => {
    assert.equal(decidirAlta({ ...alta, digitos: '5493515559999' }, [], clientes).codigo, 'ya_es_cliente')
    assert.equal(decidirAlta({ ...alta, mail: 'otro@x.com' }, [], clientes).codigo, 'ya_es_cliente')
    assert.equal(decidirAlta({ ...alta, idReferidor: 'A999' }, [], clientes).codigo, 'referidor_inexistente')
    assert.equal(decidirAlta({ ...alta, idReferidor: 'A014' }, [], clientes).tipo, 'nuevo') // 27/10: cualquier cliente puede referir, con aviso
    assert.match(decidirAlta({ ...alta, idReferidor: 'A014' }, [], clientes).avisos.join(' '), /se cargó igual/)
  })
  test('4.º nombre del mismo pedido: aviso, no bloqueo; fecha anterior al programa: aviso', () => {
    const ex = [1, 2, 3].map(i => ({ id: `R00${i}`, idReferidor: 'A012', digitos: `55555550${i}`, fechaPedido: '2026-10-05', momento: 'Primer win' }))
    const d = decidirAlta(alta, ex, clientes); assert.equal(d.tipo, 'nuevo'); assert.match(d.avisos[0], /máximo previsto/)
    assert.ok(validarAlta({ ...base, fechaPedido: '2026-09-30' }, '2026-10-20').errores.fechaPedido) // 27/10: antes del 1/10 no se carga
  })
})

describe('fila para la planilla', () => {
  test('A:L y N:P; estado Presentado; sin tocar M ni Q (fórmulas); fecha como serie', () => {
    const f = filaReferido(validarAlta(base, HOY).alta, 'R001', 'tomas@x.com')
    assert.equal(f.bloqueAL.length, 12); assert.equal(f.bloqueNP.length, 3)
    assert.deepEqual([f.bloqueAL[0], f.bloqueAL[2], f.bloqueAL[3], f.bloqueAL[8]], ['R001', 'Primer win', 'A012', 'Presentado'])
    assert.equal(f.bloqueAL[1], 46300) // 5/10/2026 como serie de Sheets
    assert.equal(f.bloqueNP[2], 'tomas@x.com'); assert.equal(f.bloqueAL[9], ''); assert.equal(f.bloqueAL[10], '')
  })
})

describe('escritor (planilla simulada)', () => {
  test('modo de revisión (por defecto): no escribe nada', async () => {
    const p = planillaFalsa(); const r = await registrarReferido(base, 'a@b.c', { planilla: p, bandera: false, hoy: HOY })
    assert.ok(r.ok); assert.equal(r.estado, 'simulado'); assert.equal(p.escrituras.length, 0); assert.match(r.mensaje, /no se guardó nada/i)
  })
  test('modo real: guarda una fila en la primera libre con ID siguiente', async () => {
    const p = planillaFalsa({ existentes: [{ id: 'R001', idReferidor: 'A013', digitos: '1', fechaPedido: null, momento: '' }] })
    const r = await registrarReferido({ ...base, claveEnvio: 'k-a' }, 'a@b.c', { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY })
    assert.equal(r.estado, 'guardado'); assert.equal(r.id, 'R002'); assert.equal(p.escrituras.length, 1); assert.equal(p.escrituras[0].fila, 3)
  })
  test('doble envío con la misma clave: una sola escritura y la misma respuesta', async () => {
    const p = planillaFalsa(); const o = { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY }
    const [a, b] = await Promise.all([registrarReferido({ ...base, claveEnvio: 'k-b' }, 'a@b.c', o), registrarReferido({ ...base, claveEnvio: 'k-b' }, 'a@b.c', o)])
    assert.equal(p.escrituras.length, 1); assert.equal(a.id, b.id)
  })
  test('dos envíos distintos del mismo referido a la vez: una sola fila', async () => {
    const p = planillaFalsa(); const o = { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY }
    const rs = await Promise.all([registrarReferido({ ...base, claveEnvio: 'k-c1' }, 'a@b.c', o), registrarReferido({ ...base, claveEnvio: 'k-c2' }, 'a@b.c', o)])
    assert.equal(p.escrituras.length, 1); assert.deepEqual(rs.map(r => r.estado).sort(), ['guardado', 'ya_existia'])
  })
  test('reintento después de un alta: ya_existia, sin fila nueva', async () => {
    const p = planillaFalsa(); const o = { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY }
    await registrarReferido({ ...base, claveEnvio: 'k-d1' }, 'a@b.c', o)
    const r = await registrarReferido({ ...base, claveEnvio: 'k-d2' }, 'a@b.c', o)
    assert.equal(r.estado, 'ya_existia'); assert.equal(p.escrituras.length, 1)
  })
  test('validación: ni siquiera lee la planilla', async () => {
    const p = planillaFalsa(); const r = await registrarReferido({ ...base, nombre: '' }, 'a@b.c', { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY })
    assert.equal(r.codigo, 'validacion'); assert.equal(p.lecturas, 0)
  })
  test('rechazos de negocio no escriben', async () => {
    const p = planillaFalsa(); const r = await registrarReferido({ ...base, idReferidor: 'A999', claveEnvio: 'k-e' }, 'a@b.c', { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY })
    assert.equal(r.codigo, 'rechazado'); assert.equal(p.escrituras.length, 0)
  })
  test('sin permiso de edición (403) se dice y no se guarda; falla de lectura no escribe', async () => {
    const r = await registrarReferido({ ...base, claveEnvio: 'k-f' }, 'a@b.c', { planilla: planillaFalsa({ falla403: true }), bandera: true, entorno: LOCAL, hoy: HOY })
    assert.equal(r.codigo, 'sin_permiso_planilla')
    const p = planillaFalsa({ falla: true }); const r2 = await registrarReferido({ ...base, claveEnvio: 'k-g' }, 'a@b.c', { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY })
    assert.equal(r2.codigo, 'planilla_no_disponible'); assert.equal(p.escrituras.length, 0)
  })
})

describe('idempotencia atada a actor y contenido', () => {
  test('dos actores con la misma clave: cada uno su alta, sin devolverse el resultado del otro', async () => {
    const p = planillaFalsa(); const o = { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY }
    const a = await registrarReferido({ ...base, claveEnvio: 'k-x', telefono: '+54 9 351 555 1111' }, 'ana@x.com', o)
    const b = await registrarReferido({ ...base, claveEnvio: 'k-x', telefono: '+54 9 351 555 2222', nombre: 'Otra Persona' }, 'beto@x.com', o)
    assert.equal(a.estado, 'guardado'); assert.equal(b.estado, 'guardado'); assert.notEqual(a.id, b.id); assert.equal(p.escrituras.length, 2)
    assert.equal(p.escrituras[1].np[2], 'beto@x.com') // "Cargado por" es el actor real, no el de la otra alta
  })
  test('misma clave, mismo actor, datos distintos: se rechaza y no se guarda', async () => {
    const p = planillaFalsa(); const o = { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY }
    await registrarReferido({ ...base, claveEnvio: 'k-y' }, 'ana@x.com', o)
    const r = await registrarReferido({ ...base, claveEnvio: 'k-y', telefono: '+54 9 351 555 3333', nombre: 'Distinta Persona' }, 'ana@x.com', o)
    assert.equal(r.codigo, 'clave_reutilizada'); assert.equal(p.escrituras.length, 1)
  })
  test('misma clave, mismo actor, mismo contenido (aunque cambie el formato): misma respuesta', async () => {
    const p = planillaFalsa(); const o = { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY }
    const a = await registrarReferido({ ...base, claveEnvio: 'k-z' }, 'ana@x.com', o)
    const b = await registrarReferido({ ...base, claveEnvio: 'k-z', telefono: '5493515551234', nombre: 'laura gómez', idReferidor: 'A012' }, 'ANA@x.com', o)
    assert.deepEqual(a, b); assert.equal(p.escrituras.length, 1)
  })
  test('la huella es canónica y distingue contenido', () => {
    const h = x => huellaAlta(validarAlta({ ...base, ...x }, HOY).alta)
    assert.equal(h({}), h({ telefono: '+5493515551234', nombre: 'LAURA GÓMEZ' }))
    assert.notEqual(h({}), h({ estudio: 'Otro' })); assert.notEqual(h({}), h({ momento: 'Post-kickoff' }))
  })
  test('sin actor identificado: no se hace nada', async () => {
    const p = planillaFalsa(); const r = await registrarReferido(base, '  ', { planilla: p, bandera: true, entorno: LOCAL, hoy: HOY })
    assert.equal(r.codigo, 'sin_actor'); assert.equal(p.lecturas, 0)
  })
})

describe('producción sin coordinación durable: escritura real bloqueada', () => {
  test('hoy no existe coordinador durable en el proyecto', () => { delete process.env.DATABASE_URL; assert.equal(coordinadorDurable(), null) })
  test('la bandera sola NO habilita escribir en Vercel/producción', () => {
    assert.equal(escrituraRealPermitida(true, null, VERCEL), false)
    assert.equal(escrituraRealPermitida(true, null, { vercel: true, produccion: false }), false)
    assert.equal(escrituraRealPermitida(true, null, { vercel: false, produccion: true }), false)
    assert.equal(escrituraRealPermitida(false, { durable: true }, VERCEL), false)
    assert.equal(escrituraRealPermitida(true, { durable: true }, VERCEL), true) // solo con coordinación durable real
    assert.equal(escrituraRealPermitida(true, null, LOCAL), true) // un único proceso local
  })
  test('con bandera real en producción y sin lock: bloquea ANTES de leer o escribir', async () => {
    const p = planillaFalsa(); const r = await registrarReferido({ ...base, claveEnvio: 'k-p' }, 'ana@x.com', { planilla: p, bandera: true, entorno: VERCEL, coordinador: null, hoy: HOY })
    assert.equal(r.ok, false); assert.equal(r.codigo, 'escritura_bloqueada'); assert.equal(p.lecturas, 0); assert.equal(p.escrituras.length, 0)
  })
  test('en producción sin bandera sigue funcionando la simulación (no escribe)', async () => {
    const p = planillaFalsa(); const r = await registrarReferido({ ...base, claveEnvio: 'k-q' }, 'ana@x.com', { planilla: p, bandera: false, entorno: VERCEL, hoy: HOY })
    assert.equal(r.estado, 'simulado'); assert.equal(p.escrituras.length, 0)
  })
})

describe('ruta POST /api/referidos: autorización y entrada', () => {
  let POST
  beforeEach(async () => { process.env.NODE_ENV = 'development'; delete process.env.VERCEL_ENV; ;({ POST } = await import('../app/api/referidos/route.ts')) })
  const pedir = (rol, extra = {}, cuerpo = JSON.stringify(base)) => {
    if (rol) process.env.CRM_DEV_ROL = rol; else delete process.env.CRM_DEV_ROL
    return POST(new Request('http://localhost:3101/api/referidos', { method: 'POST', headers: { host: 'localhost:3101', origin: 'http://localhost:3101', 'content-type': 'application/json', ...extra }, body: cuerpo }))
  }
  test('sin sesión: 401', async () => assert.equal((await pedir(null)).status, 401))
  test('closer y setter: 403; socio y csm pasan la barrera', async () => {
    assert.equal((await pedir('closer')).status, 403); assert.equal((await pedir('setter')).status, 403)
    for (const rol of ['socio', 'csm']) { const s = (await pedir(rol)).status; assert.ok(![401, 403].includes(s), `${rol}: ${s}`) }
  })
  test('origen ajeno o ausente: 403; no JSON: 415; JSON roto: 400', async () => {
    assert.equal((await pedir('socio', { origin: 'https://evil.com' })).status, 403)
    assert.equal((await pedir('socio', { origin: '' })).status, 403)
    assert.equal((await pedir('socio', { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await pedir('socio', {}, '{no')).status, 400)
    assert.equal((await pedir('socio', {}, '[]')).status, 400)
  })
  test('validación del servidor: 422 con errores por campo', async () => {
    const r = await pedir('socio', {}, JSON.stringify({ ...base, nombre: '', telefono: '1' })); assert.equal(r.status, 422)
    const j = await r.json(); assert.ok(j.errores.nombre && j.errores.telefono)
  })
})

test('el código del alta no usa credenciales ni escribe fuera de Referidos', async () => {
  const { readFileSync } = await import('node:fs')
  const e = readFileSync(new URL('../lib/clientes/escribirReferido.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(e, /values\.append|values\.clear|batchClear|deleteDimension|sheets\.spreadsheets\.batchUpdate/)
  assert.equal((e.match(/'Referidos'!/g) ?? []).length, 4) // lectura A2:Q + lectura de UNA fila (A) + 2 rangos de escritura (A:L y N:P); ninguna otra pestaña se escribe
  assert.equal((e.match(/values: \[bloque/g) ?? []).length, 2)
  const c = readFileSync(new URL('../components/clientes/RegistrarReferido.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(c, /process\.env|GOOGLE_|SHEET_ID/)
})
