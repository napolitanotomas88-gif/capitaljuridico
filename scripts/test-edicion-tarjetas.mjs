import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arbolTarjetas, planTarjeta, validarPedidoTarjeta } from '../lib/edicion/tarjetas.ts'
import { cargarTarjetasEdicion, ejecutarTarjetaEdicion } from '../lib/edicion/tarjetasServidor.ts'
import { despacharTarjetasPendientes, salidaTarjetaVigente } from '../lib/edicion/tarjetasAvisos.ts'
const aylu = { rol: 'aylu', nombre: 'Aylu QA', email: 'aylu@example.test' }, rene = { rol: 'rene', nombre: 'René QA', email: 'rene@example.test' }, tomas = { rol: 'tomas', nombre: 'Tomás QA', email: 'tomas@example.test' }
const env = { NODE_ENV: 'production', EDICION_REVISOR_AYLU: aylu.email, EDICION_EDITOR_RENE: rene.email, EDICION_REVISOR_TOMAS: tomas.email }
const tarjeta = (o = {}) => ({ id: 'cu_video1', parent_id: 'cu_padre1', id_crm: 'Z001', video_id: null, nombre: 'Video 1', etapa: 'para editar', version: 1, ronda_cliente: 0, actualizado: '2026-10-29T12:00:00Z', campos: { paleta: '#123456', crudo: 'https://example.test/crudo', editado: 'https://example.test/editado' }, ...o })
const mover = (etapa, o = {}) => ({ id: 'cu_video1', version: 1, clave: 'qa-tarjeta-0001', accion: 'mover', etapa, ...o })
test('jerarquía literal recursiva: mover el padre no altera hijos ni subtarea anidada', () => {
  const padre = tarjeta({ id: 'cu_padre1', parent_id: null, nombre: 'Cliente', etapa: 'publicado' }), hijo = tarjeta(), nieto = tarjeta({ id: 'cu_nieto1', parent_id: hijo.id })
  const arbol = arbolTarjetas([padre, hijo, nieto]); assert.equal(arbol.length, 1); assert.equal(arbol[0].hijos[0].hijos[0].id, nieto.id)
  const cambio = planTarjeta(padre, { ...mover('para editar', { comentario: 'Reabrir sólo esta tarjeta' }), id: padre.id }, tomas)
  assert.equal(cambio.tarjeta.etapa, 'para editar'); assert.equal(hijo.etapa, 'para editar'); assert.equal(nieto.version, 1); assert.equal(padre.etapa, 'publicado')
  assert.throws(() => arbolTarjetas([tarjeta({ id: 'cu_ciclo1', parent_id: 'cu_ciclo2' }), tarjeta({ id: 'cu_ciclo2', parent_id: 'cu_ciclo1' })]), /ciclo/)
})
test('validación estricta: links HTTPS, clave estable y actor del servidor', () => {
  const p = validarPedidoTarjeta({ ...mover('editando'), actor: tomas }); assert.equal(p.actor, undefined)
  assert.throws(() => validarPedidoTarjeta({ ...mover('editando'), clave: 'corta' }), /clave/)
  assert.throws(() => validarPedidoTarjeta({ ...mover('editando'), version: 0 }), /versión/)
  assert.throws(() => validarPedidoTarjeta({ ...mover('editando'), accion: 'campos', campos: { paleta: '#fff', crudo: 'javascript:alert(1)', editado: '' } }), /HTTPS/)
})
test('René termina/corrige con link; Aylu revisa antes de encolar el cliente', () => {
  const terminado = planTarjeta(tarjeta(), mover('editado'), rene)
  assert.equal(terminado.tarjeta.etapa, 'editado'); assert.ok(terminado.avisos.every(a => a.destino === 'aylu')); assert.ok(!terminado.avisos.some(a => a.canal === 'cliente'))
  assert.throws(() => planTarjeta(tarjeta(), mover('revisión'), rene), /permiso/)
  assert.throws(() => planTarjeta(tarjeta(), mover('revisión'), aylu), /revisar/)
  const revision = planTarjeta(tarjeta({ etapa: 'editado' }), mover('revisión'), aylu)
  assert.equal(revision.avisos.filter(a => a.canal === 'cliente').length, 1)
  assert.equal(revision.avisos.find(a => a.canal === 'cliente').link, 'https://example.test/editado')
  assert.throws(() => planTarjeta(tarjeta({ etapa: 'editado', campos: { paleta: '', crudo: '', editado: '' } }), mover('revisión'), aylu), /link/)
})
test('Publicar no manda a Ads ni inventa OK; Publicado exige cita y no activa Meta', () => {
  const lista = planTarjeta(tarjeta({ etapa: 'revisión' }), mover('publicar'), aylu); assert.deepEqual(lista.avisos, [])
  assert.throws(() => planTarjeta(tarjeta({ etapa: 'revisión' }), mover('publicado'), aylu), /cita/)
  const ok = planTarjeta(tarjeta({ etapa: 'revisión' }), mover('publicado', { comentario: 'Cliente: «está perfecto, aprobado»' }), aylu)
  assert.ok(ok.avisos.every(a => a.destino === 'valen')); assert.equal(ok.avisos.some(a => a.canal === 'cliente'), false)
  assert.throws(() => planTarjeta(tarjeta({ etapa: 'publicado' }), mover('para editar', { comentario: 'Reabrir' }), aylu), /Tomás/)
})
test('retroceso exige nota, notifica a René y la tercera ronda requiere a Tomás', () => {
  const t = tarjeta({ etapa: 'revisión', ronda_cliente: 2 })
  assert.throws(() => planTarjeta(t, mover('para editar'), aylu), /motivo/)
  assert.throws(() => planTarjeta(t, mover('para editar', { comentario: 'Ajuste del cliente', origen: 'cliente' }), aylu), /tercera/)
  assert.throws(() => planTarjeta(t, mover('para editar', { comentario: 'Ajuste', origen: 'cliente', autorizarTercera: true }), aylu), /Tomás/)
  const tercera = planTarjeta(t, mover('para editar', { comentario: 'Cliente pide ajustar texto', origen: 'cliente', autorizarTercera: true }), tomas)
  assert.equal(tercera.tarjeta.ronda_cliente, 3); assert.ok(tercera.avisos.every(a => a.destino === 'rene' && a.tipo_aviso === 'correccion'))
  const interna = planTarjeta(t, mover('para editar', { comentario: 'Error propio de edición', origen: 'interno' }), aylu); assert.equal(interna.tarjeta.ronda_cliente, 2)
})
test('sin cruce único/version vieja no hay acción; René sólo modifica link editado', () => {
  assert.throws(() => planTarjeta(tarjeta({ id_crm: null }), mover('editado'), aylu), /CRM único/)
  assert.throws(() => planTarjeta(tarjeta({ version: 2 }), mover('editado'), aylu), /Recargá/)
  assert.throws(() => planTarjeta(tarjeta(), { ...mover('editado'), accion: 'campos', campos: { paleta: '#fff', crudo: '', editado: 'https://example.test/new' } }, rene), /crudos y la paleta/)
})
test('publicado histórico sin cita queda en cuarentena; sólo Tomás lo reabre explícitamente', () => {
  const t = tarjeta({ etapa: 'publicado', motor_bloqueado: 'finalizado_en_clickup' })
  assert.throws(() => planTarjeta(t, mover('para editar', { comentario: 'Reabrir' }), aylu), /Tomás/)
  assert.throws(() => planTarjeta(t, mover('para editar'), tomas), /Tomás/)
  const r = planTarjeta(t, mover('para editar', { comentario: 'Reabrimos este histórico para corregirlo' }), tomas)
  assert.equal(r.tarjeta.motor_bloqueado, null); assert.equal(r.tarjeta.etapa, 'para editar'); assert.ok(r.avisos.every(a => a.destino === 'rene'))
  assert.equal(salidaTarjetaVigente(salida(), { ...t, etapa: 'revisión', entrega_evento: 'evt_review_1' }), false)
})
const servidor = (filas, o = {}) => {
  const escritos = [], d = { listar: async () => structuredClone(filas), leer: async id => structuredClone(filas.find(t => t.id === id) ?? null), historial: async () => [], cambiar: async p => { escritos.push(p); return { ...filas.find(t => t.id === p.id), version: 2, etapa: p.etapa, hijos: [] } }, archivados: async () => new Set(), exigirActivo: async (id, set) => { if (!id) throw Object.assign(new Error('sin CRM'), { status: 503 }); if (set.has(id)) throw Object.assign(new Error('Archivado'), { status: 409, code: 'CLIENTE_ARCHIVADO' }) }, modo: 'real', env, ...o }; return { d, escritos }
}
test('APIcore: sólo lectores, dry y archivado propio/padre no escriben; GET nunca devuelve stale ante fallo CRM', async () => {
  const padre = tarjeta({ id: 'cu_padre1', parent_id: null, id_crm: 'Z002' }), hijo = tarjeta(), a = servidor([padre, hijo])
  assert.equal((await ejecutarTarjetaEdicion({ email: 'otro@example.test', nombre: 'Otro' }, mover('editado'), { deps: a.d })).status, 403)
  assert.equal((await ejecutarTarjetaEdicion(aylu, mover('editado'), { deps: a.d })).status, 409); assert.deepEqual(a.escritos, [])
  const b = servidor([tarjeta()], { modo: 'dry' }); assert.equal((await ejecutarTarjetaEdicion(aylu, mover('editado'), { deps: b.d })).cuerpo.dry, true); assert.deepEqual(b.escritos, [])
  const c = servidor([padre, hijo], { archivados: async () => new Set(['Z002']) }); assert.equal((await ejecutarTarjetaEdicion(aylu, mover('editado'), { deps: c.d })).status, 409); assert.deepEqual(c.escritos, [])
  assert.deepEqual((await cargarTarjetasEdicion(aylu, undefined, { deps: c.d })).tarjetas, [])
  const fallo = servidor([tarjeta()], { archivados: async () => { throw new Error('CRM caído') } }); const r = await cargarTarjetasEdicion(aylu, undefined, { deps: fallo.d }); assert.equal(r.ok, false); assert.equal(r.tarjetas, undefined)
})
const salida = (o = {}) => ({ id: 'salida_1', tarjeta_id: 'cu_video1', evento_id: 'evt_review_1', canal: 'cliente', destino: 'cliente', datos: { id_crm: 'Z001', tarjeta: 'Video 1', evento_id: 'evt_review_1', link: 'https://example.test/editado', texto: 'Listo', tipo_aviso: 'revisión', lote_id: 'lote_1' }, ...o })
test('token de revisión: comentarios no reenvían ni invalidan; retroceso/link distinto/evento viejo nunca sale', () => {
  const s = salida(), t = tarjeta({ etapa: 'revisión', entrega_evento: 'evt_review_1', version: 9 })
  assert.equal(salidaTarjetaVigente(s, t), true)
  for (const cambio of [{ etapa: 'para editar' }, { entrega_evento: 'evt_review_2' }, { campos: { ...t.campos, editado: 'https://example.test/corregido' } }, { id_crm: 'Z002' }]) assert.equal(salidaTarjetaVigente(s, { ...t, ...cambio }), false)
})
const worker = (salidas, tarjetas, o = {}) => {
  const cerradas = [], llamadas = [], d = { modo: 'real', tomar: async () => salidas, leer: async id => tarjetas.find(t => t.id === id) ?? null, cerrar: async (...p) => { cerradas.push(p) }, activo: async () => {}, hub: async (...p) => { llamadas.push(['hub', ...p]) }, discord: async (...p) => { llamadas.push(['discord', ...p]); return 'mensaje' }, cliente: async (...p) => { llamadas.push(['cliente', ...p]); return 'mensaje' }, ...o }; return { d, cerradas, llamadas }
}
test('outbox agrupa dos videos en un Discord del cliente; modo dry no toma nada', async () => {
  const a = salida({ canal: 'discord', destino: 'rene', datos: { ...salida().datos, tipo_aviso: 'correccion' } }), b = { ...a, id: 'salida_2', tarjeta_id: 'cu_video2', datos: { ...a.datos, tarjeta: 'Video 2' } }
  const w = worker([a, b], [tarjeta(), tarjeta({ id: 'cu_video2' })]); const r = await despacharTarjetasPendientes({ deps: w.d })
  assert.equal(w.llamadas.length, 1); assert.equal(w.llamadas[0][0], 'discord'); assert.match(w.llamadas[0][2], /Video 1/); assert.match(w.llamadas[0][2], /Video 2/); assert.equal(r.enviados, 2)
  await despacharTarjetasPendientes({ deps: { ...w.d, modo: 'dry', tomar: async () => { throw new Error('No debe tomar') } } })
})
test('WhatsApp apagado queda pendiente; resultado externo ambiguo queda dudoso y el interno 500 sí reintenta', async () => {
  for (const [canal, error, esperado] of [['cliente', Object.assign(new Error('apagado'), { antesEnvio: true }), 'espera_conexion'], ['cliente', Object.assign(new Error('timeout'), { aplicado: null }), 'dudoso'], ['discord', new Error('timeout'), 'dudoso'], ['hub', new Error('500 interno'), 'pendiente']]) {
    const s = salida({ canal, destino: canal === 'cliente' ? 'cliente' : 'aylu' }), t = tarjeta({ etapa: 'revisión', entrega_evento: s.evento_id })
    const w = worker([s], [t], { [canal]: async () => { throw error } }); await despacharTarjetasPendientes({ deps: w.d }); assert.equal(w.cerradas[0][1], esperado)
  }
})
test('si retrocede, se archiva o falla la lectura fresca no envía al cliente', async () => {
  for (const o of [{ tarjeta: tarjeta({ etapa: 'para editar' }) }, { tarjeta: tarjeta({ etapa: 'revisión', entrega_evento: 'evt_review_1' }), activo: async () => { throw Object.assign(new Error('archivado'), { code: 'CLIENTE_ARCHIVADO' }) } }, { tarjeta: tarjeta({ etapa: 'revisión', entrega_evento: 'evt_review_1' }), activo: async () => { throw new Error('CRM caído') } }]) {
    const w = worker([salida()], [o.tarjeta], o.activo ? { activo: o.activo } : {}); await despacharTarjetasPendientes({ deps: w.d }); assert.deepEqual(w.llamadas, []); assert.ok(['pendiente', 'descartado'].includes(w.cerradas[0][1]))
  }
})
