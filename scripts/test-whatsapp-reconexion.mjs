// Sin red, base ni mensajes: barreras de habilitación y cadencia al reconectar WhatsApp.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { despacharTarjetasPendientes, exigirEntregaTarjetasHabilitada, MAX_ANTIGUEDAD_ENTREGA_MS } from '../lib/edicion/tarjetasAvisos.ts'
import { tarjetaDesdeFila } from '../lib/edicion/tarjetasDb.ts'
globalThis.fetch = async () => { throw new Error('La prueba no puede salir a la red') }
const ahora = Date.parse('2026-10-29T19:00:00Z')
const env = { EDICION_WHATSAPP: 'real', EDICION_WHATSAPP_DESDE: '2026-10-29T18:00:00Z' }
const salida = (id = 'uno', idCrm = 'Z001', fecha = '2026-10-29T18:30:00Z') => ({ id, tarjeta_id: `tarjeta_${id}`, evento_id: `evt_${id}`, evento_fecha: fecha, canal: 'cliente', destino: 'cliente', datos: { id_crm: idCrm, tarjeta: `Video ${id}`, evento_id: `evt_${id}`, link: 'https://example.test/editado', texto: 'Listo', tipo_aviso: 'revisión', lote_id: `lote_${idCrm}` } })
const cerradaAntesEnvio = (s, config = env) => assert.throws(() => exigirEntregaTarjetasHabilitada(s, config, ahora), e => e.antesEnvio === true)
test('AUTH no habilita por sí solo: exige flag real y corte ISO UTC explícito válido', () => {
  const s = [salida()]
  for (const e of [{}, { EDICION_WHATSAPP: 'real' }, { ...env, EDICION_WHATSAPP: 'dry' }, { ...env, EDICION_WHATSAPP_DESDE: '2026-10-29' }, { ...env, EDICION_WHATSAPP_DESDE: '2026-02-30T18:00:00Z' }, { ...env, EDICION_WHATSAPP_DESDE: '2026-10-29T20:00:00Z' }, { ...env, EDICION_WHATSAPP_DESDE: '2026-10-29T15:00:00-03:00' }]) cerradaAntesEnvio(s, e)
  assert.doesNotThrow(() => exigirEntregaTarjetasHabilitada(s, env, ahora))
  assert.doesNotThrow(() => exigirEntregaTarjetasHabilitada(s, { ...env, EDICION_WHATSAPP_DESDE: '2026-10-29T18:00:00.000Z' }, ahora))
})
test('la fecha del evento original frena backlog aunque el último reintento sea de hoy', () => {
  const viejo = { ...salida('viejo', 'Z001', '2026-10-28T18:30:00Z'), disponible: '2026-10-29T18:59:00Z', tomado: '2026-10-29T18:59:00Z' }
  cerradaAntesEnvio([viejo])
  cerradaAntesEnvio([salida('anterior', 'Z001', '2026-10-29T17:59:59Z')])
  cerradaAntesEnvio([salida('sin_fecha', 'Z001', undefined)].map(s => ({ ...s, evento_fecha: undefined })))
  cerradaAntesEnvio([salida('futuro', 'Z001', '2026-10-29T19:00:01Z')])
  const corteAnterior = { ...env, EDICION_WHATSAPP_DESDE: '2026-10-01T00:00:00Z' }
  const limite = new Date(ahora - MAX_ANTIGUEDAD_ENTREGA_MS).toISOString()
  assert.doesNotThrow(() => exigirEntregaTarjetasHabilitada([salida('limite', 'Z001', limite)], corteAnterior, ahora))
  cerradaAntesEnvio([salida('vencido', 'Z001', new Date(ahora - MAX_ANTIGUEDAD_ENTREGA_MS - 1).toISOString())], corteAnterior)
})
test('un lote no mezcla clientes ni libera un video viejo junto a uno nuevo', () => {
  cerradaAntesEnvio([])
  cerradaAntesEnvio([salida('a'), salida('b', 'Z002')])
  cerradaAntesEnvio([{ ...salida(), canal: 'discord' }])
  cerradaAntesEnvio([salida('a'), salida('b', 'Z001', '2026-10-28T19:00:00Z')])
  assert.doesNotThrow(() => exigirEntregaTarjetasHabilitada([salida('a'), salida('b')], env, ahora))
})
function worker(salidas, cliente = async () => 'mensaje') {
  const cierres = [], envios = []
  return { cierres, envios, deps: { modo: 'real', tomar: async () => salidas, leer: async id => {
    const s = salidas.find(s => s.tarjeta_id === id)
    return { id, id_crm: s.datos.id_crm, etapa: 'revisión', entrega_evento: s.evento_id, campos: { editado: s.datos.link } }
  }, activo: async () => {}, cerrar: async (...args) => cierres.push(args), validarCliente: grupo => exigirEntregaTarjetasHabilitada(grupo, env, ahora), hub: async () => envios.push('hub'), discord: async () => { envios.push('discord'); return 'discord-id' }, cliente: async grupo => { envios.push(grupo.map(s => s.id)); return cliente(grupo) } } }
}
test('dispatcher conserva revisiones anteriores sin llamar al transporte ni marcar enviado', async () => {
  const w = worker([salida('vieja', 'Z001', '2026-10-28T18:00:00Z')])
  const r = await despacharTarjetasPendientes({ deps: w.deps })
  assert.deepEqual(w.envios, []); assert.equal(r.pendientes, 1)
  assert.equal(w.cierres[0][1], 'espera_revision'); assert.match(w.cierres[0][2], /nueva revisión/)
})
test('una pasada manda un solo lote cliente agrupado y deja los demás pendientes, sin bloquear internos', async () => {
  const interno = { ...salida('hub', 'Z003'), canal: 'hub' }
  const w = worker([salida('a'), salida('b'), salida('c', 'Z002'), interno])
  const r = await despacharTarjetasPendientes({ deps: w.deps })
  assert.deepEqual(w.envios, [['a', 'b'], 'hub']); assert.equal(r.enviados, 3); assert.equal(r.pendientes, 1)
  assert.equal(w.cierres.find(c => c[0] === 'c')[1], 'espera_conexion')
})
test('un resultado incierto consume el límite y no permite enviarle al siguiente cliente', async () => {
  const w = worker([salida('a'), salida('b', 'Z002')], async () => { throw Object.assign(new Error('timeout'), { aplicado: null }) })
  const r = await despacharTarjetasPendientes({ deps: w.deps })
  assert.deepEqual(w.envios, [['a']]); assert.equal(r.dudosos, 1); assert.equal(r.pendientes, 1)
  assert.equal(w.cierres.find(c => c[0] === 'a')[1], 'dudoso'); assert.equal(w.cierres.find(c => c[0] === 'b')[1], 'espera_conexion')
})
test('las revisiones aparcadas se notifican internamente y no consumen el único lote nuevo', async () => {
  const viejas = Array.from({ length: 25 }, (_, i) => ({ ...salida(`vieja${i}`, `Z${100 + i}`, '2026-10-25T18:00:00Z'), requiere_revision: true }))
  const w = worker([...viejas, salida('nueva')]), avisos = []
  w.deps.revision = async (grupo, motivo) => avisos.push([grupo[0].id, motivo])
  const r = await despacharTarjetasPendientes({ deps: w.deps })
  assert.deepEqual(w.envios, [['nueva']]); assert.equal(avisos.length, 25)
  assert.equal(r.enviados, 1); assert.equal(r.pendientes, 25)
  assert.ok(w.cierres.filter(c => c[1] === 'espera_revision').length === 25)
})
test('si falla el aviso interno no se da por notificado ni se reenvía al cliente', async () => {
  const s = { ...salida('vieja', 'Z001', '2026-10-25T18:00:00Z'), requiere_revision: true }
  const w = worker([s]); w.deps.revision = async () => { throw new Error('base no disponible') }
  const r = await despacharTarjetasPendientes({ deps: w.deps })
  assert.deepEqual(w.envios, []); assert.equal(r.pendientes, 1)
  assert.ok(!w.cierres.some(c => c[1] === 'espera_revision' || c[1] === 'enviado'))
})
test('la ficha conserva la espera y explica que la entrega anterior requiere revisión', () => {
  const t = tarjetaDesdeFila({ id: 'tarjeta_antigua', nombre: 'Video QA', etapa: 'revisión', version: 3, actualizado: new Date(ahora), espera_whatsapp: true, revision_entrega: true })
  assert.equal(t.espera_whatsapp, true); assert.match(t.avisos.join(' '), /nueva revisión de Aylu o Tomás/)
})
