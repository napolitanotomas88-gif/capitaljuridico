// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-sync.mjs
// Sincronización ClickUp ↔ tablero de Edición, alta de tarjetas y flujo Publicar → anuncio EN PAUSA → Publicado (4/11/2026).
// SIN red, SIN base, SIN ClickUp, SIN Meta. Todos los datos son inventados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { planSync, etapaDeClickUp, ordenarTareas, cruzarRaices, ecoTras, marcaDespacho } from '../lib/edicion/clickupSync.ts'
import { disparaPublicacion, publicarDesde, archivoEditado } from '../lib/edicion/publicacionesDb.ts'
import { planEscrituraDoc } from '../lib/bot/anuncios/docAdsEscribir.ts'
import { publicarUna, estadoDesdeDoc, seccionesDeGuion } from '../lib/edicion/publicar.ts'
import { validarNuevaTarjeta, etapaInicial } from '../lib/edicion/tarjetas.ts'
import { opClickUp, avisoPublicacion } from '../lib/edicion/tarjetasDb.ts'
import { firmaValida } from '../lib/edicion/clickupServidor.ts'
import { verificarEnPausa } from '../lib/bot/anuncios/borrador.ts'

const LISTA = '900100'
const DRIVE = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const tarea = (o = {}) => ({ id: 'tk1', nombre: 'video 1', estado: 'editado', padre: 'tkp', url: 'https://app.clickup.com/t/tk1', prioridad: null, creada: '2026-11-01T10:00:00.000Z', actualizada: '2026-11-04T12:00:00.000Z', campos: { paleta: null, crudo: null, editado: `https://drive.google.com/file/d/${DRIVE}/view` }, comentarios: [], etiquetas: [], asignados: ['Editor QA'], descripcion: '', lista: LISTA, ...o })
const tarjeta = (o = {}) => ({ id: 'cu_tk1', parent_id: 'cu_tkp', id_crm: 'Z001', video_id: null, nombre: 'video 1', etapa: 'para editar', campos: { paleta: '', crudo: '', editado: '' }, prioridad: null, asignados: ['Editor QA'], clickup_id: 'tk1', clickup_actualizado: '2026-11-02T10:00:00.000Z', clickup_eco: {}, actualizado: '2026-11-02T10:00:00.000Z', borrada: null, motor_bloqueado: null, origen: 'clickup', ...o })
const op = { lista: LISTA, publicarDesdeMs: Date.parse('2026-11-04T00:00:00Z') }
const aplicar = (t, plan, cu) => plan.tipo === 'actualizar' ? { ...t, ...(plan.cambios.etapa ? { etapa: plan.cambios.etapa } : {}), ...(plan.cambios.campos ? { campos: plan.cambios.campos } : {}), ...(plan.cambios.nombre ? { nombre: plan.cambios.nombre } : {}), ...('prioridad' in plan.cambios ? { prioridad: plan.cambios.prioridad } : {}), ...(plan.cambios.asignados ? { asignados: plan.cambios.asignados } : {}), clickup_actualizado: cu.actualizada, actualizado: '2026-11-04T12:00:05.000Z' } : t

test('etapas de ClickUp = columnas del tablero (con o sin tilde)', () => {
  assert.equal(etapaDeClickUp('revision'), 'revisión'); assert.equal(etapaDeClickUp('PUBLICAR'), 'publicar'); assert.equal(etapaDeClickUp('Publicado'), 'publicado'); assert.equal(etapaDeClickUp('otra'), null)
})

test('sincronización idempotente: aplicar la misma tarea dos veces no cambia nada la segunda', () => {
  const cu = tarea()
  const p1 = planSync(cu, tarjeta(), op)
  assert.equal(p1.tipo, 'actualizar'); assert.equal(p1.cambios.etapa, 'editado'); assert.equal(p1.cambios.campos.editado, cu.campos.editado)
  const despues = aplicar(tarjeta(), p1, cu)
  assert.deepEqual(planSync(cu, despues, op), { tipo: 'nada', motivo: 'ya aplicada' })
  // y una tarea nueva se crea una sola vez (la segunda vez ya existe la tarjeta)
  const nueva = planSync(tarea({ id: 'tk9' }), null, op)
  assert.equal(nueva.tipo, 'crear'); assert.equal(nueva.etapa, 'editado')
})

test('conflictos: el rebote del Despacho se ignora y gana el cambio más reciente', () => {
  // ClickUp todavía tiene lo que escribió el Despacho (eco) y la tarjeta ya cambió de nuevo: no se pisa
  const eco = planSync(tarea({ estado: 'editado' }), tarjeta({ etapa: 'revisión', campos: { paleta: '', crudo: '', editado: tarea().campos.editado }, clickup_eco: { etapa: 'editado' }, actualizado: '2026-11-04T11:00:00.000Z' }), op)
  assert.equal(eco.tipo, 'nada'); assert.match(eco.motivo, /rebote/)
  // El Despacho cambió DESPUÉS que ClickUp: gana el Despacho
  const despacho = planSync(tarea({ estado: 'editando', actualizada: '2026-11-04T10:00:00.000Z' }), tarjeta({ etapa: 'editado', actualizado: '2026-11-04T11:00:00.000Z' }), op)
  assert.equal(despacho.tipo, 'nada'); assert.match(despacho.motivo, /Despacho es más reciente/)
  // ClickUp cambió después: gana ClickUp
  const clickup = planSync(tarea({ estado: 'editando', actualizada: '2026-11-04T12:00:00.000Z' }), tarjeta({ etapa: 'editado', actualizado: '2026-11-04T11:00:00.000Z' }), op)
  assert.equal(clickup.tipo, 'actualizar'); assert.equal(clickup.cambios.etapa, 'editando')
  // Una tarea que salió de la lista se oculta (nunca se borra el historial)
  assert.equal(planSync(tarea({ lista: '999' }), tarjeta(), op).tipo, 'borrar')
})

test('Publicar dispara SOLO al entrar y SOLO desde el corte (línea de base: lo anterior no arma nada)', () => {
  const desde = Date.parse('2026-11-04T00:00:00Z')
  assert.equal(disparaPublicacion({ antes: 'revisión', despues: 'publicar', cuandoMs: desde + 1, desdeMs: desde }), true)
  assert.equal(disparaPublicacion({ antes: 'publicar', despues: 'publicar', cuandoMs: desde + 1, desdeMs: desde }), false)
  assert.equal(disparaPublicacion({ antes: 'revisión', despues: 'publicar', cuandoMs: desde - 1, desdeMs: desde }), false)
  assert.equal(disparaPublicacion({ antes: 'revisión', despues: 'publicar', cuandoMs: desde + 1, desdeMs: null }), false)
  assert.equal(disparaPublicacion({ antes: 'editado', despues: 'publicado', cuandoMs: desde + 1, desdeMs: desde }), false)
  // desde ClickUp: un movimiento viejo que se lee hoy (puesta al día) no dispara
  assert.equal(planSync(tarea({ estado: 'publicar', actualizada: '2026-11-03T12:00:00.000Z' }), tarjeta({ etapa: 'revisión', actualizado: '2026-11-01T00:00:00.000Z', clickup_actualizado: null }), op).publicar, false)
  assert.equal(planSync(tarea({ estado: 'publicar' }), tarjeta({ etapa: 'revisión' }), op).publicar, true)
  assert.equal(publicarDesde({ EDICION_PUBLICAR_DESDE: '2026-11-04T15:00:00Z' }), Date.parse('2026-11-04T15:00:00Z'))
  assert.equal(publicarDesde({}), null)
  assert.equal(archivoEditado(`https://drive.google.com/file/d/${DRIVE}/view?usp=sharing`).drive, DRIVE)
  assert.equal(archivoEditado('https://vimeo.com/123').drive, null)
})

test('padres antes que hijos y cruce de clientes sin adivinar', () => {
  const o = ordenarTareas([tarea({ id: 'h', padre: 'p' }), tarea({ id: 'p', padre: null })])
  assert.deepEqual(o.map(t => t.id), ['p', 'h'])
  const m = cruzarRaices([{ id: 'p', nombre: 'Estudio Ficticio Pereyra' }], [{ id: 'Z001', nombre: 'Juana Pereyra' }, { id: 'Z002', nombre: 'Otro Cliente Inventado' }])
  assert.ok(!m.has('x'))
})

test('Doc de ADS: sin duplicar bloques ni videos', () => {
  const doc = [
    { texto: 'Juana Pereyra - LISTO\n', inicio: 1, fin: 23 },
    { texto: 'video 1: https://drive.google.com/file/d/ZZZZZZZZZZZZZZZZZZZZZZZZZZZZ1/view\n', inicio: 23, fin: 80 },
    { texto: '¿Te despidieron? ⬇️\n', inicio: 80, fin: 100 },
    { texto: '\n', inicio: 100, fin: 101 },
    { texto: 'Pedro Inventado - Revisión\n', inicio: 101, fin: 128 },
    { texto: 'video 1: https://drive.google.com/file/d/YYYYYYYYYYYYYYYYYYYYYYYYYYYY1/view\n', inicio: 128, fin: 185 },
  ]
  const ya = planEscrituraDoc([...doc, { texto: `video 2: https://drive.google.com/file/d/${DRIVE}/view\n`, inicio: 185, fin: 247 }], { cliente: 'Pedro Inventado', drive: DRIVE, copy: 'x' })
  assert.deepEqual(ya, { tipo: 'nada', motivo: 'el video ya está en el Doc de ADS' })
  const sumar = planEscrituraDoc(doc, { cliente: 'Juana Pereyra', drive: DRIVE, copy: 'Gancho ⬇️\nProblema\nEnviame un mensaje 💬' })
  assert.equal(sumar.tipo, 'insertar'); assert.equal(sumar.bloque, 'existente'); assert.equal(sumar.indice, 99); assert.match(sumar.texto, /^\nvideo 2: /)
  const nuevo = planEscrituraDoc(doc, { cliente: 'Pedro Inventado', drive: DRIVE, copy: 'copy' })
  assert.equal(nuevo.bloque, 'nuevo'); assert.equal(nuevo.indice, 1); assert.match(nuevo.texto, /^Pedro Inventado - LISTO\nvideo 1: /)
})

const fila = { id: 'pub_1', tarjeta_id: 'cu_tk1', archivo: DRIVE, id_crm: 'Z001', estado: 'pendiente', intentos: 0, detalle: '' }
function deps(o = {}) {
  const llamadas = { cerrar: 0, avisos: [], lanzar: 0, rotar: 0, doc: 0 }
  const d = {
    modo: 'real', tarjeta: async () => ({ id: 'cu_tk1', nombre: 'video 1', etapa: 'publicar', id_crm: 'Z001', campos: { editado: `https://drive.google.com/file/d/${DRIVE}/view` }, clickup_id: 'tk1', video_id: null }),
    cliente: async () => ({ nombre: 'Juana Pereyra', tipo: 'por_lanzar', cuenta: 'act_1' }), video: async () => ({ nombre: 'Juana 1.mp4', legible: true }),
    copy: async () => ({ copy: 'Gancho ⬇️\nProblema\nEnviame un mensaje 💬', fuente: 'Doc de ADS' }), escribirDoc: async () => { llamadas.doc++; return 'escrito' },
    lanzar: async () => { llamadas.lanzar++; return { r: { cliente: 'Juana Pereyra', idCrm: 'Z001', doc: '', listo: true, accion: 'armado', detalle: null, videos: [], noLegibles: [], texto: null, borrador: { campana: 'C', campanaId: '1', nueva: true, conjuntos: [], diarioLocal: 1, diarioUSD: 30, faltan: [], link: 'https://adsmanager.facebook.com/x', conjuntoId: '2', conjunto: 'k', anuncios: ['120200000000000001'] } }, errores: [] } },
    rotar: async () => { llamadas.rotar++; return { borrador: { campana: 'Activa', anuncios: ['120200000000000002'], link: 'https://adsmanager.facebook.com/y' }, seco: null, enSeco: null } },
    cerrarTarjeta: async () => { llamadas.cerrar++ }, avisar: async a => { llamadas.avisos.push(a) }, ...o,
  }
  return { d, llamadas }
}

test('Publicar → armado EN PAUSA → la tarjeta pasa a Publicado una vez y avisa a Valen', async () => {
  const { d, llamadas } = deps()
  const r = await publicarUna(fila, d)
  assert.equal(r.estado, 'creado'); assert.equal(r.camino, 'lanzamiento'); assert.deepEqual(r.anuncios, ['120200000000000001'])
  assert.equal(llamadas.cerrar, 1); assert.equal(llamadas.avisos.length, 1); assert.equal(llamadas.avisos[0].ok, true)
  // con campaña corriendo: rotación (conjunto nuevo en pausa dentro de su campaña), nunca campaña nueva
  const rot = deps({ cliente: async () => ({ nombre: 'Juana Pereyra', tipo: 'campana', cuenta: 'act_1' }) })
  const r2 = await publicarUna(fila, rot.d)
  assert.equal(r2.camino, 'rotacion'); assert.equal(rot.llamadas.lanzar, 0); assert.equal(rot.llamadas.rotar, 1); assert.equal(rot.llamadas.cerrar, 1)
})

test('Si falla, la tarjeta queda en Publicar con el error y aviso; en seco no mueve ni avisa nada', async () => {
  for (const [o, estado] of [[{ copy: async () => ({ copy: null, fuente: 'sin guion' }) }, 'falta_copy'], [{ cliente: async () => ({ nombre: 'X', tipo: null, cuenta: null }) }, 'error'], [{ video: async () => ({ nombre: 'v', legible: false }) }, 'error']]) {
    const { d, llamadas } = deps(o)
    const r = await publicarUna(fila, d)
    assert.equal(r.estado, estado); assert.equal(llamadas.cerrar, 0); assert.equal(llamadas.avisos.length, 1); assert.equal(llamadas.avisos[0].ok, false)
  }
  const hist = deps({ lanzar: async () => ({ r: { cliente: 'J', idCrm: 'Z001', accion: 'historico', detalle: null, videos: [], noLegibles: [], texto: null, listo: true, doc: '' }, errores: [] }) })
  const rh = await publicarUna(fila, hist.d)
  assert.equal(rh.estado, 'error'); assert.match(rh.detalle, /línea de base/); assert.equal(hist.llamadas.cerrar, 0)
  const seco = deps({ modo: 'seco', lanzar: async () => ({ r: { cliente: 'J', idCrm: 'Z001', accion: 'seco', detalle: null, videos: [], noLegibles: [], texto: null, listo: true, doc: '' }, errores: [] }) })
  const rs = await publicarUna(fila, seco.d)
  assert.equal(rs.estado, 'seco'); assert.equal(seco.llamadas.cerrar, 0); assert.equal(seco.llamadas.avisos.length, 0); assert.equal(seco.llamadas.doc, 0); assert.ok(rs.despues.some(x => /publicado/.test(x)))
  // fuera de Publicar no se arma nada
  const fuera = deps({ tarjeta: async () => ({ id: 'cu_tk1', nombre: 'v', etapa: 'revisión', id_crm: 'Z001', campos: { editado: '' }, clickup_id: null, video_id: null }) })
  assert.match((await publicarUna(fila, fuera.d)).detalle, /salió de Publicar/); assert.equal(fuera.llamadas.lanzar, 0)
  assert.equal(estadoDesdeDoc({ accion: 'ya_salio' }).estado, 'dudoso'); assert.equal(estadoDesdeDoc(null).estado, 'error')
})

test('nunca se activa nada en Meta: la verificación solo vuelve a PAUSAR y el código nuevo no escribe ACTIVE', async () => {
  const posts = []
  const g = { get: async id => (id === 'a2' && !posts.length ? { status: 'ACTIVE' } : { status: 'PAUSED' }), post: async (id, c) => { posts.push([id, c]); return {} } }
  await assert.rejects(verificarEnPausa(g, [{ id: 'a1', tipo: 'anuncio' }, { id: 'a2', tipo: 'anuncio' }]), /lo volví a pausar|pausa/i)
  assert.deepEqual(posts, [['a2', { status: 'PAUSED' }]])
  for (const f of ['lib/edicion/publicar.ts', 'lib/edicion/publicarServidor.ts', 'lib/edicion/clickupSync.ts', 'lib/bot/anuncios/docAdsEscribir.ts']) assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /['"]ACTIVE['"]/)
})

test('alta desde el tablero: validación, etapa inicial y réplica a ClickUp', () => {
  const n = validarNuevaTarjeta({ accion: 'crear', clave: 'alta_qa_0001', id_crm: 'z001', cliente: 'Juana Pereyra', videos: [{ nombre: 'Video 1', crudo: 'https://drive.google.com/x', editado: '', prioridad: 'urgent', asignado: 'rene' }] })
  assert.equal(n.id_crm, 'Z001'); assert.equal(etapaInicial(n.videos[0]), 'para editar')
  assert.equal(etapaInicial({ crudo: '', editado: 'https://x.test/e' }), 'editado'); assert.equal(etapaInicial({ crudo: '', editado: '' }), 'en espera de datos')
  assert.throws(() => validarNuevaTarjeta({ accion: 'crear', clave: 'alta_qa_0001', id_crm: 'Z001', cliente: 'J', videos: [] }), /entre 1/)
  assert.throws(() => validarNuevaTarjeta({ accion: 'crear', clave: 'alta_qa_0001', id_crm: 'Z001', cliente: 'J', videos: [{ crudo: 'javascript:alert(1)' }] }), /HTTPS/)
  assert.throws(() => validarNuevaTarjeta({ accion: 'crear', clave: 'alta_qa_0001', id_crm: 'Z001', cliente: 'J', videos: Array.from({ length: 13 }, () => ({})) }), /entre 1/)
  assert.deepEqual(opClickUp({ accion: 'mover', etapa: 'publicar', comentario: 'ok', id: 'x', version: 1, clave: 'k' }, {}, { nombre: 'Aylu QA' }), { op: 'estado', etapa: 'publicar', comentario: 'Aylu QA (Despacho): ok' })
  assert.equal(avisoPublicacion('publicar', 'error', 'falta ficha'), 'Anuncio sin crear: falta ficha'); assert.equal(avisoPublicacion('editado', 'error', 'x'), null)
})

test('copy desde el guion y firma del webhook', () => {
  const s = seccionesDeGuion('Guion:\nHOOK: ¿Te despidieron?\nPROBLEMA: firmaste sin revisar\nSOLUCIÓN: revisamos\nCTA: escribime')
  assert.deepEqual(s, { hook: '¿Te despidieron?', problema: 'firmaste sin revisar', solucion: 'revisamos', cta: 'escribime' })
  assert.equal(seccionesDeGuion(''), null)
  const cuerpo = '{"event":"taskStatusUpdated","task_id":"tk1"}', secreto = 'secreto-de-prueba'
  assert.equal(firmaValida(cuerpo, createHmac('sha256', secreto).update(cuerpo).digest('hex'), secreto), true)
  assert.equal(firmaValida(cuerpo, createHmac('sha256', 'otro').update(cuerpo).digest('hex'), secreto), false)
  assert.equal(firmaValida(cuerpo, null, secreto), false)
})

test('revisión 4/11: el eco se consume (un regreso real en ClickUp al valor que escribió el Despacho no se ignora)', () => {
  // El Despacho escribió «para editar» (eco). En ClickUp la movieron a «editado» → se aplica y el eco deja de valer.
  const t0 = tarjeta({ etapa: 'para editar', clickup_eco: { etapa: 'para editar' } })
  const cu1 = tarea({ estado: 'editado', actualizada: '2026-11-04T12:00:00.000Z' })
  const p1 = planSync(cu1, t0, op)
  assert.equal(p1.cambios.etapa, 'editado')
  assert.deepEqual(ecoTras(cu1, t0, p1.cambios), {})
  // Después vuelven a «para editar» en ClickUp (una corrección): sin eco viejo, se aplica.
  const t1 = { ...aplicar(t0, p1, cu1), clickup_eco: ecoTras(cu1, t0, p1.cambios) }
  const p2 = planSync(tarea({ estado: 'para editar', actualizada: '2026-11-04T13:00:00.000Z' }), t1, op)
  assert.equal(p2.cambios.etapa, 'para editar')
  // El rebote verdadero se sigue ignorando: el Despacho escribió B, la tarjeta ya va por C, ClickUp todavía muestra B.
  const t2 = tarjeta({ etapa: 'revisión', clickup_eco: { etapa: 'editado' }, campos: { paleta: '', crudo: '', editado: tarea().campos.editado } })
  const cuB = tarea({ estado: 'editado', actualizada: '2026-11-04T14:00:00.000Z' })
  assert.equal(planSync(cuB, t2, op).tipo, 'nada')
  assert.deepEqual(ecoTras(cuB, t2), { etapa: 'editado' })
})

test('revisión 4/11: una tarea dada de alta desde el Despacho se reconoce por su marca (no se duplica)', () => {
  assert.equal(marcaDespacho('Creada desde el Despacho. despacho:dsp_0123456789abcdef01234567'), 'dsp_0123456789abcdef01234567')
  assert.equal(marcaDespacho('sin marca'), null)
  assert.equal(marcaDespacho('despacho:otra_cosa'), null)
})

test('revisión 4/11: el Doc de ADS se escribe solo después de crear el anuncio (si falla, no se toca)', async () => {
  const orden = []
  const ok = deps({ escribirDoc: async () => { orden.push('doc'); return 'escrito' }, lanzar: async (...a) => { orden.push('meta'); return deps().d.lanzar(...a) }, cerrarTarjeta: async () => { orden.push('cerrar') } })
  await publicarUna(fila, ok.d)
  assert.deepEqual(orden, ['meta', 'doc', 'cerrar'])
  const mal = deps({ lanzar: async () => ({ r: { cliente: 'J', idCrm: 'Z001', accion: 'error', detalle: 'x', videos: [], noLegibles: [], texto: null, listo: true, doc: '' }, errores: [] }) })
  await publicarUna(fila, mal.d)
  assert.equal(mal.llamadas.doc, 0)
  const rotSeco = deps({ cliente: async () => ({ nombre: 'J', tipo: 'campana', cuenta: 'act_1' }), rotar: async () => ({ borrador: { campana: 'A', anuncios: [], link: null }, seco: null, enSeco: 'rotación en seco' }) })
  await publicarUna(fila, rotSeco.d)
  assert.equal(rotSeco.llamadas.doc, 0); assert.equal(rotSeco.llamadas.cerrar, 0)
})
