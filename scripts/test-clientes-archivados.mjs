import { test } from 'node:test'
import assert from 'node:assert/strict'
import { archivadosDeAgencia, archivadosDeHojas, leerArchivados, conArchivadosActuales, excluirArchivados, exigirClienteNoArchivado, exigirClienteNoArchivadoPorNombre, ClienteArchivadoError, EstadoCrmInciertoError } from '../lib/clientes/archivados.ts'
import { sqlParaPruebas } from '../lib/edicion/db/base.ts'
import * as operativo from '../lib/edicion/operativo.ts'
import { despachar } from '../lib/edicion/avisos/cola.ts'

globalThis.fetch = async () => { throw new Error('Sin red en la auditoría de archivados') }
const header = ['ID', 'Nombre', 'Estado', 'Anotaciones']
const filas = [header, ['A149', 'Ana Pérez', 'FINALIZADO', '[[ARCHIVADO:ac_prueba estado=ACTIVO baja=vacia]]'], ['A150', 'Beto Activo', 'ACTIVO', ''], ['A151', 'Finalizado previo', 'FINALIZADO', ''], ['A152', 'Restaurada', 'FINALIZADO', '[[ARCHIVADO:ac_1 estado=ACTIVO]]\n[[RESTAURADO:ac_2]]']]
const leer = async () => structuredClone(filas)

test('sólo el archivo vigente excluye: un finalizado normal y un archivo restaurado conservan su flujo', async () => {
  const archivados = await leerArchivados({ leer })
  assert.deepEqual([...archivados], ['A149'])
  const datos = [{ id_crm: 'a149', historial: [1] }, { id_crm: 'A150', historial: [2] }]
  assert.deepEqual(excluirArchivados(datos, archivados, x => x.id_crm), [datos[1]])
  assert.deepEqual(datos[0].historial, [1], 'no borra datos del archivado')
  await assert.rejects(exigirClienteNoArchivado(' a149 ', archivados), ClienteArchivadoError)
  await exigirClienteNoArchivado('A150', archivados)
  await assert.rejects(exigirClienteNoArchivado('A999', archivados), EstadoCrmInciertoError)
})

test('sin ID sólo se acepta nombre único y actual; nombre ambiguo o CRM incierto nunca autoriza', async () => {
  const archivados = archivadosDeAgencia(filas)
  await assert.rejects(exigirClienteNoArchivadoPorNombre('ANA PEREZ', archivados), ClienteArchivadoError)
  await exigirClienteNoArchivadoPorNombre('beto activo', archivados)
  await assert.rejects(exigirClienteNoArchivadoPorNombre('desconocido', archivados), EstadoCrmInciertoError)
  const duplicado = archivadosDeAgencia([...filas, ['A153', 'Ana Perez', 'ACTIVO', '']])
  await assert.rejects(exigirClienteNoArchivadoPorNombre('Ana Pérez', duplicado), EstadoCrmInciertoError)
  await assert.rejects(leerArchivados({ leer: async () => { throw new Error('Google caído') } }), EstadoCrmInciertoError)
  assert.throws(() => archivadosDeAgencia([['ID', 'Nombre', 'Estado']]), EstadoCrmInciertoError)
  assert.throws(() => archivadosDeAgencia([...filas, filas[1]]), EstadoCrmInciertoError)
})

test('el estado de un lote no se reutiliza en el siguiente y no consulta snapshots', async () => {
  let lecturas = 0
  const fuente = async () => { lecturas++; return leer() }
  await conArchivadosActuales(async () => {
    assert.deepEqual([...await leerArchivados()], ['A149'])
    assert.deepEqual([...await leerArchivados()], ['A149'])
    assert.equal(lecturas, 1)
  }, { leer: fuente })
  await conArchivadosActuales(async () => { assert.equal(lecturas, 2) }, { leer: fuente })
})
test('Consultora usa sus encabezados propios y cualquier ID; duplicados entre ambas líneas no se adivinan', async () => {
  const headConsultora = ['ID', 'Nombre', 'Estado', ...Array(16).fill(''), 'Anotaciones']
  const consultora = [headConsultora, ['A777', 'Consultora Archivada', 'FINALIZADO', ...Array(16).fill(''), '[[ARCHIVADO:ac_cons estado=ACTIVO]]']]
  const archivados = archivadosDeHojas({ agencia: filas, consultora })
  assert.deepEqual([...archivados], ['A149', 'A777'])
  await assert.rejects(exigirClienteNoArchivado('A777', archivados), ClienteArchivadoError)
  await assert.rejects(exigirClienteNoArchivadoPorNombre('Consultora Archivada', archivados), ClienteArchivadoError)
  const duplicada = structuredClone(consultora); duplicada[1][0] = 'A149'
  assert.throws(() => archivadosDeHojas({ agencia: filas, consultora: duplicada }), EstadoCrmInciertoError)
})

test('mutaciones por video, nota, pedido, archivo y paso del archivado se frenan antes de escribir', async () => {
  process.env.DATABASE_URL = 'postgresql://fixture.invalid/test'
  let escrituras = 0
  sqlParaPruebas(() => async (s) => {
    const texto = s.join('?')
    if (/^SELECT/.test(texto)) return [{ id_crm: 'A149' }]
    escrituras++; throw new Error('Nunca debería llegar a una escritura')
  })
  try {
    await conArchivadosActuales(async () => {
      const persona = { rol: 'aylu', nombre: 'Equipo', email: 'equipo@ejemplo.test' }
      for (const accion of [
        () => operativo.moverVideo({ id: 1, version: 1, accion: 'listo', actor: { tipo: 'persona', ...persona }, ctx: {} }),
        () => operativo.editarNota({ id: 2, version: 1, actor: persona, cambios: { texto: 'Cambio' } }),
        () => operativo.autorizarPedidoCliente({ pedido_id: 3, version: 1, actor: { ...persona, rol: 'tomas' } }),
        () => operativo.vincularArchivo({ archivo_id: 4, video_id: 1, actor: { tipo: 'persona', ...persona } }),
        () => operativo.marcarPaso({ id: 5, version: 1, actor: persona, nota: '', texto: '' }),
      ]) await assert.rejects(accion(), ClienteArchivadoError)
    }, { leer })
    assert.equal(escrituras, 0)
  } finally { sqlParaPruebas(null); delete process.env.DATABASE_URL }
})

test('la consulta de tablero excluye archivados en SQL antes del límite', async () => {
  process.env.DATABASE_URL = 'postgresql://fixture.invalid/test'
  let consulta = ''
  sqlParaPruebas(() => async (s, ...valores) => {
    if (/FROM cj_edicion_tarjetas/.test(s.join('?'))) return []
    consulta = s.join('?')
    assert.ok(valores.some(v => Array.isArray(v) && v.includes('A149')))
    return []
  })
  try {
    await conArchivadosActuales(() => operativo.listarVideos({ incluirFinales: false }), { leer })
    assert.ok(consulta.indexOf('upper(v.id_crm)') < consulta.indexOf('LIMIT'))
  } finally { sqlParaPruebas(null); delete process.env.DATABASE_URL }
})

test('un aviso encolado antes del archivo se descarta individualmente y no sale por Discord', async () => {
  let enviados = 0
  const cerrados = []
  const aviso = { id: 1, tipo: 'marca_falta', canal: 'edicion', datos: { id_crm: 'A149', cliente: 'Ana Pérez' }, intentos: 1 }
  const r = await despachar({
    repo: { marcarDudosos: async () => [], reclamarVencidos: async () => [aviso], cerrarAviso: async (id, v) => cerrados.push({ id, ...v }) },
    lector: {}, enviar: async () => { enviados++; return ['1'] }, ahora: () => new Date('2026-10-28T12:00:00Z'),
    env: { EDICION_MODO: 'real', EDICION_AVISOS: 'real', DISCORD_WEBHOOK_EDICION: 'https://discord.com/api/webhooks/1/fixture' },
    esOperativo: async () => false,
  })
  assert.equal(enviados, 0)
  assert.equal(r.descartados, 1)
  assert.equal(cerrados[0].estado, 'descartado')
})
