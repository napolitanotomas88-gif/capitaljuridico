// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-limpiar-cliente-prueba.mjs
// Limpieza COMPLETA del cliente de prueba (scripts/limpiar-cliente-prueba.mjs). SIN red ni base: Neon falso, CRM falso y
// limpiezas por etapa falsas. Todo es inventado.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const L = await import('./limpiar-cliente-prueba.mjs')

const NOMBRE = 'PRUEBA BOT Ensayo'

function neonFalso({ filas = {}, sinTabla = [], carpetas = [] } = {}) {
  const lecturas = [], transacciones = []
  const tabla = (texto) => (texto.match(/FROM (\w+)/) ?? [])[1]
  const q = {
    async query(texto, params) {
      const t = tabla(texto)
      lecturas.push({ texto, params })
      if (sinTabla.includes(t)) throw Object.assign(new Error(`relation "${t}" does not exist`), { code: '42P01' })
      if (/^SELECT resultado/.test(texto.trim())) return carpetas
      if (/^SELECT count/.test(texto)) return [{ n: filas[t] ?? 0 }]
      return { texto, params }
    },
    async transaction(lista) { transacciones.push(await Promise.all(lista)) },
  }
  return { q, lecturas, transacciones }
}

function deps(over = {}) {
  const llamadas = []
  const n = over.neon ?? neonFalso()
  return {
    llamadas, neon: n,
    deps: {
      q: n.q,
      filasCrm: over.filasCrm ?? (async () => [{ fila: 900, id: 'Z001', nombre: NOMBRE, estado: 'ACTIVO' }]),
      limpiarBajas: async (id, modo) => { llamadas.push(['bajas', id, modo]); return over.bajas ?? { abortado: false } },
      limpiarExito: async (id, modo) => { llamadas.push(['exito', id, modo]); return over.exito ?? 0 },
      papeleraCarpeta: over.sinPuente ? undefined : async (id) => { llamadas.push(['papelera', id]); if (over.puenteFalla) throw new Error('puente caído') },
    },
  }
}
const correr = async (argv, d, env = { BOT_CLIENTES_PRUEBA: 'Z001' }) => {
  const salida = []
  let inf = null
  const codigo = await L.main(argv, { env, deps: d.deps, log: (t) => salida.push(t), informe: (i) => { inf = i } })
  return { codigo, salida: salida.join('\n'), inf }
}

describe('argumentos', () => {
  test('exige --nombre "PRUEBA BOT …"', () => {
    assert.throws(() => L.parsearArgs(['--id', 'Z001']), /PRUEBA BOT/)
    assert.throws(() => L.parsearArgs(['--id', 'Z001', '--nombre', 'Juan Pérez']), /PRUEBA BOT/)
    assert.throws(() => L.parsearArgs(['--id', 'Z001', '--nombre', 'PRUEBA BOT']), /PRUEBA BOT/)
  })
  test('ID del CRM de 1 a 5 dígitos; sin --id toma BOT_CLIENTES_PRUEBA solo si tiene uno', () => {
    assert.equal(L.parsearArgs(['--nombre', NOMBRE], { BOT_CLIENTES_PRUEBA: 'z001' }).id, 'Z001')
    assert.throws(() => L.parsearArgs(['--nombre', NOMBRE], { BOT_CLIENTES_PRUEBA: 'Z001,Z002' }), /--id/)
    assert.throws(() => L.parsearArgs(['--id', 'Z123456', '--nombre', NOMBRE]), /--id/)
    assert.throws(() => L.parsearArgs(['--id', "Z1' OR 1=1", '--nombre', NOMBRE]), /--id/)
  })
  test('simular por defecto, nombre normalizado', () => {
    const a = L.parsearArgs(['--id', 'Z001', '--nombre', '  prueba   bot ensayo '])
    assert.equal(a.modo, 'simular')
    assert.equal(a.nombre, 'PRUEBA BOT ENSAYO')
  })
})

describe('consultas', () => {
  test('cada consulta lleva un solo parámetro (Postgres no acepta uno sin usar)', () => {
    for (const [, , where] of [...L.TABLAS_ETAPAS, ...L.TABLAS_ALTA]) {
      const c = L.consulta(where, 'Z001', 'PRUEBA BOT ENSAYO')
      assert.equal(c.params.length, 1)
      assert.ok(c.where.includes('$1') && !c.where.includes('$2') && !c.where.includes('$N'))
    }
  })
  test('los hijos se borran antes que los padres', () => {
    const orden = L.TABLAS_ETAPAS.map((t) => t[1])
    assert.ok(orden.indexOf('cj_video_notas') < orden.indexOf('cj_videos'))
    assert.ok(orden.indexOf('cj_edicion_tarjetas_outbox') < orden.indexOf('cj_edicion_tarjetas_historial'))
    assert.ok(orden.indexOf('cj_edicion_tarjetas_historial') < orden.indexOf('cj_edicion_tarjetas'))
    assert.ok(orden.indexOf('cj_grab_transcripciones') < orden.indexOf('cj_grab_archivos'))
    const alta = L.TABLAS_ALTA.map((t) => t[1])
    assert.ok(alta.indexOf('cj_altas_pasos') < alta.indexOf('cj_altas'))
  })
})

describe('seguros', () => {
  test('una fila del CRM con ese ID y otro nombre: aborta sin tocar nada', async () => {
    const d = deps({ filasCrm: async () => [{ fila: 12, id: 'Z001', nombre: 'Juan Pérez', estado: 'ACTIVO' }] })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.equal(r.codigo, 1)
    assert.deepEqual(d.llamadas, [])
    assert.equal(d.neon.transacciones.length, 0)
  })
  test('sin poder leer el CRM no toca nada', async () => {
    const d = deps({ filasCrm: async () => { throw new Error('Sheets caído') } })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.equal(r.codigo, 1)
    assert.deepEqual(d.llamadas, [])
  })
})

describe('simular', () => {
  test('cuenta pero no borra ni manda a la papelera', async () => {
    const neon = neonFalso({ filas: { cj_kickoffs: 1, cj_guiones: 2, cj_videos: 6, cj_altas: 1, cj_altas_pasos: 8 }, carpetas: [{ id: 'carpetaPrueba123456', nombre: 'PRUEBA BOT Ensayo - C.J' }] })
    const d = deps({ neon })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE], d)
    assert.equal(r.codigo, 0)
    assert.deepEqual(d.llamadas, [['bajas', 'Z001', 'simular'], ['exito', 'Z001', 'simular']])
    assert.equal(neon.transacciones.length, 0)
    assert.match(r.salida, /cj_kickoffs 1/)
    assert.match(r.salida, /Simulación/)
    assert.match(r.salida, /PandaDoc/)
  })
})

describe('real', () => {
  test('orden inverso: Bajas, Éxito, etapas, Drive y alta; una transacción por bloque', async () => {
    const neon = neonFalso({ filas: { cj_kickoffs: 1, cj_videos: 6, cj_video_notas: 2, cj_altas: 1, cj_altas_pasos: 8 }, carpetas: [{ id: 'carpetaPrueba123456', nombre: 'PRUEBA BOT Ensayo - C.J' }] })
    const d = deps({ neon })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.equal(r.codigo, 0)
    assert.deepEqual(d.llamadas, [['bajas', 'Z001', 'real'], ['exito', 'Z001', 'real'], ['papelera', 'carpetaPrueba123456']])
    assert.equal(neon.transacciones.length, 2)
    const etapas = neon.transacciones[0].map((x) => x.texto.match(/DELETE FROM (\w+)/)[1])
    assert.deepEqual(etapas, ['cj_video_notas', 'cj_videos', 'cj_kickoffs'])
    const alta = neon.transacciones[1].map((x) => x.texto.match(/DELETE FROM (\w+)/)[1])
    assert.deepEqual(alta, ['cj_altas_pasos', 'cj_altas'])
    assert.deepEqual(neon.transacciones[1][1].params, ['PRUEBA BOT ENSAYO'])
  })
  test('una carpeta que no se llama PRUEBA BOT nunca va a la papelera', async () => {
    const neon = neonFalso({ carpetas: [{ id: 'carpetaReal12345678', nombre: 'Juan Pérez - C.J' }] })
    const d = deps({ neon })
    await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.ok(!d.llamadas.some((x) => x[0] === 'papelera'))
  })
  test('si el puente falla, las filas del alta se conservan (tienen el id de la carpeta) y sale con 2', async () => {
    const neon = neonFalso({ filas: { cj_altas: 1 }, carpetas: [{ id: 'carpetaPrueba123456', nombre: 'PRUEBA BOT Ensayo - C.J' }] })
    const d = deps({ neon, puenteFalla: true })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.equal(r.codigo, 2)
    assert.equal(neon.transacciones.length, 0)
    assert.match(r.salida, /se conservan/)
  })
  test('una tabla que no existe no frena ni entra al borrado', async () => {
    const neon = neonFalso({ filas: { cj_kickoffs: 1 }, sinTabla: ['cj_marca', 'cj_altas_pasos', 'cj_altas_mensajes', 'cj_altas'] })
    const d = deps({ neon })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.equal(r.codigo, 0)
    assert.equal(neon.transacciones.length, 1)
    assert.deepEqual(neon.transacciones[0].map((x) => x.texto.match(/DELETE FROM (\w+)/)[1]), ['cj_kickoffs'])
  })
  test('Bajas abortada o Éxito con rastros pendientes: sigue con el resto y sale con 2', async () => {
    const d = deps({ bajas: { abortado: true }, exito: 2 })
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE, '--real'], d)
    assert.equal(r.codigo, 2)
    assert.equal(r.inf.pendientes.length, 2)
  })
  test('no imprime URLs ni tokens', async () => {
    const d = deps()
    const r = await correr(['--id', 'Z001', '--nombre', NOMBRE], d, { BOT_CLIENTES_PRUEBA: 'Z001', WHAPI_TOKEN: 'tok-secreto', DISCORD_WEBHOOK_CLIENTES: 'https://discord.test/x' })
    assert.ok(!/tok-secreto|discord\.test/.test(r.salida))
  })
})
