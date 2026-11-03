// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-anuncios-trabados.mjs
// Clientes trabados antes de lanzar (lib/anuncios/trabados.ts), el chequeo temprano de la cuenta (cuentaTemprana.ts) y las
// kickoffs perdidas (kickoffPerdida.ts). Puro, sin red.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const T = await import('../lib/anuncios/trabados.ts')
const C = await import('../lib/bot/kickoff/cuentaTemprana.ts')
const K = await import('../lib/bot/kickoff/kickoffPerdida.ts')

const e = (o = {}) => ({ cliente: 'Juana Perez', idCrm: 'Z001', kickoff: { fechaIso: '2026-10-10T18:00:00Z', cuenta: true }, sinFicha: false, acceso: 'si', tanda: { tanda: 1, estado: 'aprobada', aprobada: '2026-10-15' }, crudos: 0, editados: 0, ...o })

describe('diagnosticar', () => {
  test('sin ficha → kickoff (Tomás / Gero M)', () => {
    const d = T.diagnosticar(e({ kickoff: null, sinFicha: true }))
    assert.deepEqual([d.etapa, d.motivo, d.responsable], ['kickoff', 'sin ficha de kickoff', 'Tomás / Gero M'])
  })
  test('guiones sin aprobar → Faus', () => {
    const d = T.diagnosticar(e({ tanda: { tanda: 2, estado: 'a_revisar', aprobada: null } }))
    assert.deepEqual([d.etapa, d.responsable], ['guiones', 'Faus'])
    assert.match(d.motivo, /tanda 2: a revisar/)
  })
  test('N crudos, 0 editados → René', () => {
    const d = T.diagnosticar(e({ crudos: 4 }))
    assert.deepEqual([d.etapa, d.motivo, d.responsable], ['edicion', '4 crudos, 0 editados', 'René'])
  })
  test('con editados y sin cuenta en la ficha → cuenta (Tomás / Valen); la cuenta también va como «además»', () => {
    assert.equal(T.diagnosticar(e({ editados: 3, kickoff: { fechaIso: null, cuenta: false } })).etapa, 'cuenta')
    const d = T.diagnosticar(e({ crudos: 2, acceso: 'no' }))
    assert.equal(d.etapa, 'edicion')
    assert.match(d.ademas[0], /sin acceso del token/)
  })
  test('LISTO en el Doc de ADS cuenta como videos listos aunque «Editados» esté vacío', () => {
    const d = T.diagnosticar(e({ crudos: 1, editados: 0, doc: { listo: true, videos: 6, texto: 'LISTO · 6 videos' } }))
    assert.equal(d.etapa, 'armado')
    assert.match(d.motivo, /6 videos LISTOS en el Doc de ADS/)
  })
  test('una nota del Doc distinta de LISTO va tal cual en «además»', () => {
    const d = T.diagnosticar(e({ crudos: 2, doc: { listo: false, videos: 3, texto: '«esperar a que estén publicados»' } }))
    assert.ok(d.ademas.some(x => x.includes('esperar a que estén publicados')))
  })
})

describe('clientesTrabados y el texto', () => {
  const xs = [
    e({ cliente: 'Uno Uno', idCrm: 'Z001' }),
    e({ cliente: 'Dos Dos', idCrm: 'Z002', kickoff: { fechaIso: '2026-11-01T12:00:00Z', cuenta: true } }),   // hace 2 días
    e({ cliente: 'Tres Tres', idCrm: 'Z003', kickoff: null, sinFicha: true, dia1: '2026-02-01' }),
    e({ cliente: 'Sin Fin', idCrm: 'Z004' }),
  ]
  const ts = T.clientesTrabados(xs, { hoy: '2026-11-03', sinFin: ['Z004'] })
  test('más de 7 días, sin los sin fecha de fin', () => {
    assert.deepEqual(ts.map(t => t.cliente), ['Tres Tres', 'Uno Uno'])
    assert.equal(ts.find(t => t.cliente === 'Uno Uno').clave, 'trabado:Z001:grabacion')
  })
  test('los viejos (alta de hace más de 45 días, sin kickoff) van en una sola línea', () => {
    const txt = T.textoTrabados(ts, [], ['1'])
    assert.match(txt, /^<@1> 🧱/)
    assert.match(txt, /🕰️ .*Tres Tres \(Z003\)/)
    assert.ok(!txt.includes('**Tres Tres**'))
    assert.match(txt, /\*\*Uno Uno\*\*/)
    assert.equal(T.textoTrabados([], ts), '')
  })
  test('partirMensaje: corta entre renglones sin perder ninguno', () => {
    const txt = Array.from({ length: 60 }, (_, i) => `renglón ${i} ${'x'.repeat(60)}`).join('\n')
    const ps = T.partirMensaje(txt, 1900)
    assert.ok(ps.length > 1 && ps.every(p => p.length <= 1900))
    assert.equal(ps.join('\n'), txt)
  })
})

describe('cuenta temprana', () => {
  const cuentas = [
    { id: 'act_1', nombre: 'Estudio Jurídico Zubirri y Asociados', negocio: null, paginas: [], asignada: null },
    { id: 'act_2', nombre: 'Otra Cuenta', negocio: null, paginas: ['Zubiri Abogados'], asignada: 'Otro Cliente' },
    { id: 'act_3', nombre: 'Juana', negocio: null, paginas: [], asignada: null },
    { id: 'act_4', nombre: 'Luis Gomez', negocio: null, paginas: [], asignada: null },
  ]
  test('el apellido (con una letra de tolerancia) en el nombre de la cuenta; las asignadas a otro no cuentan', () => {
    const ps = C.puntuarCuentas({ nombre: 'Juana Zubiri' }, cuentas)
    assert.equal(ps[0].id, 'act_1')
    assert.ok(!ps.some(p => p.id === 'act_2'))
    assert.equal(C.candidataClara(ps).id, 'act_1')
  })
  test('por la página que promociona', () => {
    const ps = C.puntuarCuentas({ nombre: 'Juana Zubiri' }, [{ id: 'act_9', nombre: 'Cuenta 9', negocio: null, paginas: ['Zubiri & Asoc.'], asignada: null }])
    assert.deepEqual(ps[0].por, ['apellido «zubiri» en la página'])
  })
  test('un apellido muy común solo no alcanza para una candidata clara', () => {
    const ps = C.puntuarCuentas({ nombre: 'Ana Barros Lopez' }, [{ id: 'act_8', nombre: 'Estudio Lopez Otro', negocio: null, paginas: [], asignada: null }])
    assert.equal(ps[0].puntos, 1)
    assert.equal(C.candidataClara(ps), null)
  })
  test('un segundo nombre común no es apellido; dos candidatas iguales no son clara', () => {
    assert.ok(!C.puntuarCuentas({ nombre: 'Jorge Luis Sosa' }, cuentas).some(p => p.id === 'act_4' && p.puntos >= 2))
    const dos = C.puntuarCuentas({ nombre: 'Ana Ruiz' }, [{ id: 'act_5', nombre: 'Ruiz ARS', negocio: null, paginas: [], asignada: null }, { id: 'act_6', nombre: 'Ruiz USD', negocio: null, paginas: [], asignada: null }])
    assert.equal(C.candidataClara(dos), null)
  })
  test('el aviso propone la clara con cómo cargarla y menciona a Valen y Tomás', () => {
    const txt = C.textoCuentaTemprana({ cliente: 'Juana Zubiri', idCrm: 'Z001', recordingId: 5, problema: 'sin_cuenta', cuenta: null, candidatas: C.puntuarCuentas({ nombre: 'Juana Zubiri' }, cuentas), menciones: ['1', '2'], ficha: null })
    assert.match(txt, /^<@1> <@2> ⚠️ \*\*Sin cuenta de Meta\*\*/)
    assert.match(txt, /Propuesta:.*act_1.*recording_id=5&cuenta=act_1/)
    const acc = C.textoCuentaTemprana({ cliente: 'X', idCrm: null, recordingId: 5, problema: 'sin_acceso', cuenta: 'act_7', candidatas: [], menciones: [], ficha: null })
    assert.match(acc, /Sin acceso.*\n.*act_7/)
  })
})

describe('kickoffs perdidas', () => {
  const AHORA = Date.parse('2026-11-03T12:00:00Z')
  const r = (id, titulo, horas, o = {}) => ({ recording_id: id, titulo, url: null, creada: new Date(AHORA - horas * 3_600_000).toISOString(), externos: null, quien: 'tomas', ...o })
  test('más de 48 h, parece kickoff y sin fila final', () => {
    const rs = [r(1, 'Juana Perez y Tomas Napolitano', 72), r(2, 'Daily - TEAM SKWD', 72), r(3, 'Ana Ruiz y Tomas Napolitano', 10), r(4, 'Pepe Lopez y Tomas Napolitano', 100), r(5, 'Impromptu Google Meet Meeting', 80, { externos: true }), r(6, 'Viejo y Tomas', 24 * 40)]
    const p = K.kickoffsPerdidas(rs, new Map([[4, 'lista']]), AHORA)
    assert.deepEqual(p.map(x => x.recording_id), [1])
    const err = K.kickoffsPerdidas([r(7, 'X Y y Tomas', 50)], new Map([[7, 'error']]), AHORA)
    assert.equal(err[0].estado, 'error')
  })
  test('vigilarKickoffs: avisa una vez y reintenta como mucho MAX_REINTENTOS, una vez por grabación', async () => {
    const reclamadas = new Set(), enviados = [], reintentos = []
    const deps = {
      quienes: () => ['tomas'], listar: async () => [1, 2, 3, 4].map(i => r(i, `Cliente ${i} y Tomas`, 60 + i)),
      estados: async () => new Map(), reclamar: async c => (reclamadas.has(c) ? false : (reclamadas.add(c), true)),
      marcarEnviado: async () => {}, soltar: async c => { reclamadas.delete(c) }, reintentar: async id => { reintentos.push(id) },
      enviar: async t => { enviados.push(t); return 'm' }, menciones: ['9'], ahora: () => AHORA,
    }
    const a = await K.vigilarKickoffs(deps)
    assert.equal(a.reintentadas.length, K.MAX_REINTENTOS)
    assert.equal(enviados.length, 1)
    assert.match(enviados[0], /Kickoffs sin ficha.*\(4\)/)
    const b = await K.vigilarKickoffs(deps)
    assert.equal(enviados.length, 1)
    assert.deepEqual(b.reintentadas, [1])
    assert.equal(new Set(reintentos).size, reintentos.length)
  })
})
