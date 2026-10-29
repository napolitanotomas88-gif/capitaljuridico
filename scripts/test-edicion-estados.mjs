// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-estados.mjs
// La máquina de estados del video (lib/edicion/estados.ts): toda la tabla de transiciones por rol, los requisitos, el tope de
// rondas del cliente (P6), reanudar y reabrir al estado previo, y los botones de accionesPara. Puro: sin red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const E = await import('../lib/edicion/estados.ts')
const { ESTADOS_VIDEO } = await import('../lib/edicion/tipos.ts')

const ctxVacio = { crudos: 0, notasNuevas: 0, notasSinTildar: 0, linkEditado: false }
const ctxLleno = { crudos: 2, notasNuevas: 3, notasSinTildar: 0, linkEditado: true, motivo: 'duro', nota: 'una nota', cita: '«dale, perfecto»' }
const video = (estado, extra = {}) => ({ estado, estado_previo: null, bloqueo: null, ronda_cliente: 0, ...extra })
const ROLES = ['aylu', 'tomas', 'rene', 'lector', 'bot']

describe('tabla de transiciones', () => {
  test('cada acción tiene al menos una fila y los estados de origen existen', () => {
    for (const a of E.ACCIONES_VIDEO) assert.ok(E.TRANSICIONES.some(t => t.accion === a), a)
    for (const t of E.TRANSICIONES) for (const d of t.de) assert.ok(ESTADOS_VIDEO.includes(d), `${t.accion}: ${d}`)
  })

  test('matriz rol × acción × estado: puede() coincide con la tabla (con todos los requisitos cumplidos)', () => {
    let casos = 0
    for (const rol of ROLES) for (const a of E.ACCIONES_VIDEO) for (const estado of ESTADOS_VIDEO) {
      const filas = E.TRANSICIONES.filter(t => t.accion === a && t.de.includes(estado) && t.quien.includes(rol))
      const v = video(estado, a === 'autorizar_ronda' ? { bloqueo: 'tope_rondas_cliente' } : { estado_previo: 'para_editar' })
      const r = E.puede(rol, a, v, ctxLleno)
      casos++
      if (rol === 'lector') { assert.equal(r.ok, false, `${rol} ${a} ${estado}`); continue }
      assert.equal(r.ok, filas.length > 0, `${rol} ${a} ${estado}: ${r.ok ? '' : r.motivo}`)
    }
    assert.ok(casos > 500)
  })

  test('el bot solo mueve llegaron_crudos y descarta lo que espera crudos (vínculo corregido); lector nada', () => {
    for (const a of E.ACCIONES_VIDEO) {
      const ok = ESTADOS_VIDEO.some(s => E.puede('bot', a, video(s, { bloqueo: 'tope_rondas_cliente' }), ctxLleno).ok)
      assert.equal(ok, a === 'llegaron_crudos' || a === 'descartar', a)
      assert.equal(ESTADOS_VIDEO.some(s => E.puede('lector', a, video(s), ctxLleno).ok), false)
    }
    // descartar: solo desde esperando_crudos y con nota
    assert.deepEqual(ESTADOS_VIDEO.filter(s => E.puede('bot', 'descartar', video(s), ctxLleno).ok), ['esperando_crudos'])
    assert.equal(E.puede('bot', 'descartar', video('esperando_crudos'), ctxVacio).ok, false)
  })
})

describe('requisitos', () => {
  test('llegaron_crudos y sirve piden crudo vinculado', () => {
    assert.equal(E.puede('bot', 'llegaron_crudos', video('esperando_crudos'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('bot', 'llegaron_crudos', video('regrabar'), { ...ctxVacio, crudos: 1 }), { ok: true, a: 'crudo_a_revisar' })
    assert.equal(E.puede('aylu', 'sirve', video('crudo_a_revisar'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('aylu', 'sirve', video('crudo_a_revisar'), { ...ctxVacio, crudos: 1 }), { ok: true, a: 'para_editar' })
  })
  test('regrabar pide un motivo válido; pausa con devolución y pausar piden nota', () => {
    assert.equal(E.puede('aylu', 'regrabar', video('crudo_a_revisar'), ctxVacio).ok, false)
    assert.equal(E.puede('aylu', 'regrabar', video('crudo_a_revisar'), { ...ctxVacio, motivo: 'inventado' }).ok, false)
    assert.deepEqual(E.puede('aylu', 'regrabar', video('crudo_a_revisar'), { ...ctxVacio, motivo: 'audio' }), { ok: true, a: 'regrabar' })
    assert.equal(E.puede('tomas', 'pausa_devolucion', video('crudo_a_revisar'), { ...ctxVacio, nota: '   ' }).ok, false)
    assert.equal(E.puede('tomas', 'pausar', video('editado'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('tomas', 'pausar', video('editado'), { ...ctxVacio, nota: 'el cliente viaja' }), { ok: true, a: 'pausado' })
  })
  test('listo no exige link (el repositorio pone el bloqueo); para_cliente sí', () => {
    assert.deepEqual(E.puede('rene', 'listo', video('para_editar'), ctxVacio), { ok: true, a: 'editado' })
    assert.equal(E.puede('aylu', 'para_cliente', video('editado'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('aylu', 'para_cliente', video('corregido'), { ...ctxVacio, linkEditado: true }), { ok: true, a: 'con_cliente' })
  })
  test('pedir_correccion pide notas nuevas; René corrige solo con todo tildado; Aylu y Tomás fuerzan con nota', () => {
    assert.equal(E.puede('aylu', 'pedir_correccion', video('editado'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('aylu', 'pedir_correccion', video('editado'), { ...ctxVacio, notasNuevas: 2 }), { ok: true, a: 'correccion' })
    const pendientes = { ...ctxVacio, notasSinTildar: 2 }
    assert.equal(E.puede('rene', 'corregido', video('correccion'), pendientes).ok, false)
    assert.equal(E.puede('rene', 'corregido', video('correccion'), { ...pendientes, nota: 'forzar' }).ok, false, 'René no fuerza')
    assert.equal(E.puede('aylu', 'corregido', video('correccion'), pendientes).ok, false)
    assert.deepEqual(E.puede('aylu', 'corregido', video('correccion'), { ...pendientes, nota: 'lo vi yo' }), { ok: true, a: 'corregido' })
    assert.deepEqual(E.puede('rene', 'corregido', video('correccion'), ctxVacio), { ok: true, a: 'corregido' })
  })
  test('ok_cliente pide la cita', () => {
    assert.equal(E.puede('aylu', 'ok_cliente', video('con_cliente'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('aylu', 'ok_cliente', video('con_cliente'), { ...ctxVacio, cita: 'quedó genial' }), { ok: true, a: 'aprobado' })
  })
})

describe('P6: tope de 2 rondas del cliente (interno)', () => {
  const ctx = { ...ctxVacio, notasNuevas: 1 }
  test('rondas 1 y 2 las confirma Aylu; la 3.ª no tiene transición para Aylu (motivo tope) y sí para Tomás', () => {
    assert.equal(E.TOPE_RONDAS_CLIENTE, 2)
    assert.deepEqual(E.puede('aylu', 'pedido_cliente', video('con_cliente', { ronda_cliente: 0 }), ctx), { ok: true, a: 'correccion' })
    assert.deepEqual(E.puede('aylu', 'pedido_cliente', video('con_cliente', { ronda_cliente: 1 }), ctx), { ok: true, a: 'correccion' })
    assert.deepEqual(E.puede('aylu', 'pedido_cliente', video('con_cliente', { ronda_cliente: 2 }), ctx), { ok: false, motivo: 'tope' })
    assert.deepEqual(E.puede('tomas', 'pedido_cliente', video('con_cliente', { ronda_cliente: 2 }), ctx), { ok: true, a: 'correccion' })
    assert.equal(E.pasaTope(1), false)
    assert.equal(E.pasaTope(2), true)
  })
  test('autorizar_ronda: solo Tomás y solo con el bloqueo del tope', () => {
    assert.equal(E.puede('tomas', 'autorizar_ronda', video('con_cliente'), ctxVacio).ok, false)
    assert.deepEqual(E.puede('tomas', 'autorizar_ronda', video('con_cliente', { bloqueo: 'tope_rondas_cliente' }), ctxVacio), { ok: true, a: 'correccion' })
    assert.equal(E.puede('aylu', 'autorizar_ronda', video('con_cliente', { bloqueo: 'tope_rondas_cliente' }), ctxVacio).ok, false)
  })
})

describe('previo, reabrir y devolver', () => {
  test('reanudar vuelve al estado previo (y si no hay uno válido, a esperando_crudos)', () => {
    assert.deepEqual(E.puede('aylu', 'reanudar', video('pausado', { estado_previo: 'editado' }), ctxVacio), { ok: true, a: 'editado' })
    assert.deepEqual(E.puede('aylu', 'reanudar', video('pausado', { estado_previo: null }), ctxVacio), { ok: true, a: 'esperando_crudos' })
    assert.deepEqual(E.puede('aylu', 'reanudar', video('pausado', { estado_previo: 'aprobado' }), ctxVacio), { ok: true, a: 'esperando_crudos' })
  })
  test('reabrir: desde aprobado va a con_cliente; desde descartado, al previo; solo Tomás y con nota', () => {
    assert.deepEqual(E.puede('tomas', 'reabrir', video('aprobado'), { ...ctxVacio, nota: 'pidió otro cambio' }), { ok: true, a: 'con_cliente' })
    assert.deepEqual(E.puede('tomas', 'reabrir', video('descartado', { estado_previo: 'para_editar' }), { ...ctxVacio, nota: 'se retoma' }), { ok: true, a: 'para_editar' })
    assert.equal(E.puede('aylu', 'reabrir', video('aprobado'), { ...ctxVacio, nota: 'x' }).ok, false)
    assert.equal(E.puede('tomas', 'reabrir', video('aprobado'), ctxVacio).ok, false)
  })
  test('devolver: de para_editar a crudo_a_revisar, Aylu y Tomás (René no)', () => {
    assert.deepEqual(E.puede('aylu', 'devolver', video('para_editar'), ctxVacio), { ok: true, a: 'crudo_a_revisar' })
    assert.equal(E.puede('rene', 'devolver', video('para_editar'), ctxVacio).ok, false)
  })
  test('previoAGuardar: descartar un pausado conserva el de antes de la pausa', () => {
    assert.equal(E.previoAGuardar({ estado: 'editado', estado_previo: null }), 'editado')
    assert.equal(E.previoAGuardar({ estado: 'pausado', estado_previo: 'correccion' }), 'correccion')
    assert.ok(E.GUARDAN_PREVIO.includes('descartar') && E.GUARDAN_PREVIO.includes('pausar') && E.GUARDAN_PREVIO.includes('pausa_devolucion'))
  })
  test('pausar no aplica a finales ni a pausados; descartar sí a pausados', () => {
    assert.equal(E.puede('aylu', 'pausar', video('pausado'), { ...ctxVacio, nota: 'x' }).ok, false)
    assert.equal(E.puede('aylu', 'pausar', video('aprobado'), { ...ctxVacio, nota: 'x' }).ok, false)
    assert.equal(E.puede('aylu', 'descartar', video('pausado'), { ...ctxVacio, nota: 'x' }).ok, true)
    assert.equal(E.puede('aylu', 'descartar', video('descartado'), { ...ctxVacio, nota: 'x' }).ok, false)
  })
})

describe('accionesPara (los botones)', () => {
  const v = (estado, extra = {}) => ({ id: 1, id_crm: 'A101', cliente: 'X', clave: 'T1-V1', estado, estado_previo: null, bloqueo: null, ronda_cliente: 0, ...extra })
  test('René en para_editar ve listo; en corrección, corregido solo con todo tildado', () => {
    assert.deepEqual(E.accionesPara('rene', v('para_editar'), ctxVacio), ['listo'])
    assert.deepEqual(E.accionesPara('rene', v('correccion'), { ...ctxVacio, notasSinTildar: 1 }), [])
    assert.deepEqual(E.accionesPara('rene', v('correccion'), ctxVacio), ['corregido'])
  })
  test('Aylu en crudo_a_revisar: sirve (con crudos), regrabar, pausa con devolución, pausar y descartar', () => {
    assert.deepEqual(E.accionesPara('aylu', v('crudo_a_revisar'), { ...ctxVacio, crudos: 1 }), ['sirve', 'regrabar', 'pausa_devolucion', 'pausar', 'descartar'])
    assert.ok(!E.accionesPara('aylu', v('crudo_a_revisar'), ctxVacio).includes('sirve'))
  })
  test('pedido_cliente y autorizar_ronda nunca salen como botón (van por los pedidos); lector no ve nada', () => {
    for (const r of ['aylu', 'tomas']) {
      const xs = E.accionesPara(r, v('con_cliente', { bloqueo: 'tope_rondas_cliente' }), { ...ctxVacio, notasNuevas: 2, linkEditado: true })
      assert.ok(!xs.includes('pedido_cliente') && !xs.includes('autorizar_ronda'))
      assert.ok(xs.includes('ok_cliente'))
    }
    assert.deepEqual(E.accionesPara('lector', v('editado'), ctxLleno), [])
  })
})

describe('revisión (24/10)', () => {
  const v = (estado, extra = {}) => ({ id: 7, id_crm: 'A101', cliente: 'Lucas', clave: 'T2-V3', tanda_guion: 2, numero: 3, guion: null, guion_texto: '', gancho: '',
    estado, estado_previo: null, estado_desde: '2026-10-20T12:00:00.000Z', prioridad: 'normal', bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null,
    ronda_interna: 0, ronda_cliente: 1, editado: { archivo_id: null, url: 'https://drive.google.com/file/d/x/view' },
    envio_link: { quien: 'Aylu', cuando: '2026-10-22T12:00:00.000Z', texto: 'link' }, ok_cliente: null, origen: 'doc', clickup_id: null, version: 3,
    creado: '2026-10-18T12:00:00.000Z', actualizado: '2026-10-20T12:00:00.000Z', ...extra })
  test('Aylu encuentra un error con el video ya en el cliente: «Pedir corrección» propia (no gasta una ronda del cliente)', async () => {
    const r = E.puede('aylu', 'pedir_correccion', v('con_cliente'), { ...ctxVacio, notasNuevas: 1, linkEditado: true })
    assert.deepEqual(r, { ok: true, a: 'correccion' })
    assert.equal(E.puede('rene', 'pedir_correccion', v('con_cliente'), { ...ctxVacio, notasNuevas: 1 }).ok, false)
    assert.ok(E.accionesPara('aylu', v('con_cliente'), { ...ctxVacio, notasNuevas: 1, linkEditado: true }).includes('pedir_correccion'))
    const { aplicarAccion } = await import('../lib/edicion/db/videos.ts')
    const { nuevo } = aplicarAccion(v('con_cliente'), 'pedir_correccion', 'correccion', { actor: { tipo: 'persona', rol: 'aylu', nombre: 'Aylu', email: '' }, ctx: {} }, '2026-10-24T12:00:00.000Z', true)
    assert.equal(nuevo.ronda_cliente, 1, 'la ronda del cliente no cambia'); assert.equal(nuevo.ronda_interna, 1)
    assert.equal(nuevo.envio_link, null, 'el link corregido se vuelve a mandar')
  })
})

describe('revisión de la integración, ronda 3', () => {
  test('t07 · con el pedido del cliente esperando a Tomás (tope), nadie puede "pedir corrección": no sale el botón y puede() lo frena', () => {
    const conTope = video('con_cliente', { bloqueo: 'tope_rondas_cliente', ronda_cliente: 2 })
    for (const rol of ['aylu', 'tomas']) {
      const r = E.puede(rol, 'pedir_correccion', conTope, { ...ctxVacio, notasNuevas: 3 })
      assert.equal(r.ok, false, rol); assert.match(r.motivo, /Tomás/)
      const v = { id: 1, id_crm: 'A101', cliente: 'X', clave: 'T1-V1', ...conTope }
      assert.ok(!E.accionesPara(rol, v, { ...ctxVacio, notasNuevas: 3, linkEditado: true }).includes('pedir_correccion'), rol)
    }
    // Tomás sí autoriza la ronda; sin el tope, Aylu pide su corrección con el video en el cliente como antes
    assert.deepEqual(E.puede('tomas', 'autorizar_ronda', conTope, ctxVacio), { ok: true, a: 'correccion' })
    assert.deepEqual(E.puede('aylu', 'pedir_correccion', video('con_cliente'), { ...ctxVacio, notasNuevas: 1 }), { ok: true, a: 'correccion' })
  })
})
