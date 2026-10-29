// Las colas ya existentes también deben frenar un trabajo si el cliente fue archivado después de crear el pedido.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearNucleo } from '../lib/bot/exito/nucleo.ts'
import { crearNucleoBajas } from '../lib/bot/bajas/nucleo.ts'
import { avisarVideosNuevos } from '../lib/bot/anuncios/videos.ts'
import { clienteOperativo } from '../lib/clientes/colasOperativas.ts'
import { conArchivadosActuales } from '../lib/clientes/archivados.ts'

globalThis.fetch = async () => { throw new Error('Estas pruebas no usan red') }
const nombre = 'CLIENTE PRUEBA COLAS'
const ahora = Date.parse('2026-10-28T15:00:00Z')
const autor = { telefono: '5491100000001', lid: null, nombre: 'Equipo' }
const respuesta = { citado: 'pedido', mensajeId: 'respuesta', autor, veredicto: 'ok', resto: '' }
const config = { modo: 'real', capacidades: new Set(['exito_mensaje_cliente', 'baja_crm', 'baja_quitar_grupos']), aprobadores: [autor.telefono], despedida: [autor.telefono] }

test('Éxito ignora un OK viejo sin enviar testimonio ni cambiar el pedido archivado', async () => {
  let cambios = 0, envios = 0
  const deps = {
    config, ahora: () => ahora, log: console,
    clienteOperativo: async () => false,
    almacen: { pedidoPorMensaje: async () => ({ id: 'p', idCrm: 'Z001', cliente: nombre, estado: 'abierto' }), actualizarPedido: async () => { cambios++; return true } },
    enviarTexto: async () => { envios++; return { id: 'm' } },
  }
  const r = await crearNucleo(deps).procesarEventos({ respuestas: [respuesta], ecos: [], mensajes: [], videos: [] })
  assert.equal(r.ignorados, 1)
  assert.equal(cambios, 0)
  assert.equal(envios, 0)
})

test('Bajas ignora aprobaciones antiguas de archivo sin tocar CRM, grupos ni su historia', async () => {
  let efectos = 0
  const deps = {
    config, ahora: () => ahora, log: console,
    clienteOperativo: async () => false,
    almacen: { pedidoPorMensaje: async () => ({ id: 'p', tipo: 'confirmar_baja', idCrm: 'Z001', cliente: nombre, estado: 'abierto' }), actualizarPedido: async () => { efectos++; return true } },
    enviarTexto: async () => { efectos++; return { id: 'm' } }, crm: async () => { efectos++ }, quitar: async () => { efectos++ },
  }
  const r = await crearNucleoBajas(deps).procesarEventos({ respuestas: [respuesta], ecos: [] })
  assert.equal(r.ignorados, 1)
  assert.equal(efectos, 0)
})

test('Anuncios no reserva avisos ni arma borradores para una carpeta de cliente archivado', async () => {
  let controles = 0, efectos = 0
  const deps = {
    ahora: () => ahora, valentino: null,
    clienteOperativo: async () => { controles++; return false },
    editados: async () => [{ carpetaCliente: `${nombre} - SKWD`, editadosId: 'carpeta', tandas: [{ id: 'carpeta', nombre: 'Tanda', videos: [{ id: 'v', nombre: 'Video', creado: '2026-10-26T20:00:00Z' }] }] }],
    avisadoHasta: async () => new Map(), reclamar: async () => { efectos++; return true }, enviar: async () => { efectos++; return 'm' },
    borrador: { permitido: () => true, armar: async () => { efectos++ } },
  }
  const r = await avisarVideosNuevos({ filas: [], porLanzar: [] }, deps, { desde: '2026-10-26T00:00:00Z' })
  assert.equal(controles, 1)
  assert.equal(efectos, 0)
  assert.equal(r.avisos.length, 0)
})

test('la guardia real bloquea nombre legado y un CRM incierto jamás habilita una cola', async () => {
  const filas = [['ID', 'Nombre', 'Estado', 'Anotaciones'], ['Z001', nombre, 'FINALIZADO', '[[ARCHIVADO:ac_prueba estado=ACTIVO baja=vacia]]']]
  await conArchivadosActuales(async () => {
    assert.equal(await clienteOperativo('Z001', nombre), false)
    assert.equal(await clienteOperativo(null, nombre.toLowerCase()), false)
    await assert.rejects(clienteOperativo(null, 'Nombre inexistente'), e => e.code === 'ESTADO_CRM_INCIERTO')
  }, { leer: async () => filas })
  await assert.rejects(clienteOperativo('Z001', nombre), e => e.code === 'ESTADO_CRM_INCIERTO')
})
