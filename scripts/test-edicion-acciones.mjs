// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-acciones.mjs
// API de la pantalla de Edición (lib/edicion/acciones.ts): la barrera HTTP entera (atenderPost), la decisión (atenderAccion)
// con la matriz rol × acción sacada de TRANSICIONES, el modo prueba que no escribe, el 409 por versión, el usuario de
// prueba, el lote con resultados parciales, P6 (la 3.ª ronda de Aylu frente a la de Tomás) y los avisos después de
// responder que no rompen nada. SIN red y SIN base: el repositorio, el motor, la marca y los pedidos son de juguete.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['DATABASE_URL', 'EDICION_MODO']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const A = await import('../lib/edicion/acciones.ts')
const { TRANSICIONES } = await import('../lib/edicion/estados.ts')
const { ErrorTransitorio } = await import('../lib/fathomAnuncios/errores.ts')

const ENV = { NODE_ENV: 'production', EDICION_REVISOR_AYLU: 'aylu@ejemplo.test', EDICION_REVISOR_TOMAS: 'tomas@ejemplo.test', EDICION_EDITOR_RENE: 'rene@ejemplo.test' }
const SES = {
  aylu: { email: 'aylu@ejemplo.test', nombre: 'Aylu' },
  tomas: { email: 'tomas@ejemplo.test', nombre: 'Tomás' },
  rene: { email: 'rene@ejemplo.test', nombre: 'René' },
  lector: { email: 'socio@ejemplo.test', nombre: 'Socio' },
}
const AHORA = '2026-10-24T15:00:00.000Z'

function video(o = {}) {
  return {
    id: 7, id_crm: 'A101', cliente: 'Cliente Prueba', clave: 'T1-V2', tanda_guion: 1, numero: 2, guion: null, guion_texto: '', gancho: '',
    estado: 'para_editar', estado_previo: null, estado_desde: AHORA, prioridad: 'normal', bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null,
    ronda_interna: 0, ronda_cliente: 0, editado: null, envio_link: null, ok_cliente: null, origen: 'doc', clickup_id: null, version: 5, creado: AHORA, actualizado: AHORA, ...o,
  }
}
const crudo = (o = {}) => ({ id: 31, id_crm: 'A101', tipo: 'crudo', drive_id: 'DEMOcrudo0000000031', nombre: 'IMG_1.MOV', mime: 'video/quicktime', carpeta_id: 'x', ruta: [], bytes: 1, duracion_ms: 1, ancho: 1, alto: 1, creado: AHORA, modificado: AHORA, subio: 'cliente', tanda_id: null, inferido: { tanda_guion: null, numero: null, por: null }, video_id: 7, asignado_por: 'bot', propuesta_video_id: null, transcripcion: { estado: 'lista', proveedor_id: null, intentos: 0, motivo: '' }, borrado: null, visto: AHORA, ...o })
const evento = (v, accion = 'x') => ({ id: 1, video_id: v.id, id_crm: v.id_crm, cliente: v.cliente, tipo: 'estado', de: null, a: v.estado, actor: { tipo: 'bot', proceso: 'vigia' }, nota: '', datos: { accion }, cuando: AHORA })

/** Dependencias de juguete. `escrituras` anota cada escritura (en dry no tiene que haber ninguna). */
function deps(o = {}) {
  const escrituras = []
  const anotar = (que, p) => escrituras.push({ que, p })
  let detalle = o.detalle ?? { video: video(), notas: [], crudos: [crudo()], editados: [] }
  const d = {
    escrituras,
    set detalle(x) { detalle = x },
    repo: {
      videos: {
        leerVideo: async id => (o.leer ? o.leer(id) : detalle && detalle.video.id === id ? structuredClone(detalle) : null),
        moverVideo: async m => {
          anotar('mover', m)
          if (o.mover) return o.mover(m)
          const v = { ...detalle.video, version: m.version + 1, estado: 'movido' }
          return { ok: true, actual: { video: v, evento: evento(v, m.accion) } }
        },
        actualizarVideo: async p => { anotar('actualizar', p); const v = { ...detalle.video, ...p.cambios, version: p.version + 1 }; return o.actualizar ? o.actualizar(p) : { ok: true, actual: { video: v, evento: evento(v) } } },
        registrarEnvio: async p => { anotar('envio', p); return p.items.map(it => (o.envio ? o.envio(it) : { ok: true, actual: { video: { ...detalle.video, version: it.version + 1 }, evento: evento(detalle.video) } })) },
        crearNota: async p => { anotar('nota_crear', p); return { ok: true, actual: { id: 1, version: 1, enviada: false, ...p.nota } } },
        editarNota: async p => { anotar('nota_editar', p); return { ok: true, actual: { id: p.id, version: p.version + 1 } } },
        borrarNota: async p => { anotar('nota_borrar', p); return { ok: true, actual: { id: p.id, version: p.version + 1 } } },
        tildarNota: async p => { anotar('nota_tildar', p); return { ok: true, actual: { id: p.id, version: p.version + 1 } } },
      },
      archivos: { vincularArchivo: async p => { anotar('vincular', p); if (o.alVincular) o.alVincular(p); return { ok: true, actual: crudo({ id: p.archivo_id, video_id: p.video_id }) } } },
      seguimientos: {
        marcarPaso: async p => { anotar('paso', p); return { ok: true, actual: {} } },
        decidirPaso: async p => { anotar('decision', p); return { ok: true, actual: {}, eventos: [] } },
      },
      carpetas: { confirmarVinculo: async p => { anotar('vinculo', p); return { ok: true, actual: {} } } },
    },
    motor: { iniciarTanda: async p => { anotar('tanda', p); return { videos: [video({ estado: 'esperando_crudos' })], eventos: [] } } },
    marca: {
      validarFicha: x => (x && Array.isArray(x.colores) ? { ok: true, ficha: { id_crm: x.id_crm, colores: x.colores, tipografias: [], logo: null, referencia: null, carpeta_marca: null, fuentes: {}, notas: '' } } : { ok: false, error: 'colores inválidos', campo: 'colores' }),
      guardarMarca: async (id, f, v, actor) => { anotar('marca', { id, f, v, actor }); return { ok: true, actual: { ...f, version: (v ?? 0) + 1, actualizado: AHORA } } },
    },
    pedidos: {
      confirmar: async p => { anotar('confirmar', p); return o.confirmar ? o.confirmar(p) : { ok: true, actual: { resultado: 'correccion', eventos: [evento(video())], extra: [] } } },
      autorizar: async p => { anotar('autorizar', p); return { ok: true, actual: { eventos: [evento(video())] } } },
      descartar: async p => { anotar('descartar', p); return { ok: true, actual: {} } },
    },
    modo: o.modo ?? 'real',
    env: ENV,
  }
  return d
}
const pedir = (d, cuerpo, rol = 'aylu', extra = {}) => A.atenderAccion(d, cuerpo, { ...SES[rol], ...extra })
const mover = (transicion, o = {}) => ({ accion: 'mover', video_id: 7, version: 5, transicion, motivo: 'duro', nota: 'una nota', cita: 'dale, perfecto', ...o })

describe('matriz rol × acción (sale de TRANSICIONES de estados.ts)', () => {
  const CON_FLUJO = ['pedido_cliente', 'autorizar_ronda', 'regrabar_enviado']
  const filas = TRANSICIONES.filter(t => !CON_FLUJO.includes(t.accion))
  for (const accion of [...new Set(filas.map(t => t.accion))]) {
    const estados = [...new Set(filas.filter(t => t.accion === accion).flatMap(t => t.de))]
    for (const de of estados) {
      for (const rol of ['aylu', 'tomas', 'rene', 'lector']) {
        const puedeEnEsteEstado = filas.some(t => t.accion === accion && t.de.includes(de) && t.quien.includes(rol))
        const tieneAlgunaFila = filas.some(t => t.accion === accion && t.quien.includes(rol))
        const esperado = rol === 'lector' ? 403 : puedeEnEsteEstado ? 200 : tieneAlgunaFila ? 409 : 403
        test(`${accion} desde ${de} como ${rol} → ${esperado}`, async () => {
          // Contexto que cumple todos los requisitos: crudo vinculado, una nota nueva, ninguna sin tildar, link al editado
          const d = deps({ detalle: { video: video({ estado: de, estado_previo: de === 'pausado' || de === 'descartado' ? 'editado' : null, editado: { archivo_id: null, url: 'https://drive.google.com/file/d/x/view' } }), notas: [{ id: 1, enviada: false, ronda: 1, tilde: null }], crudos: [crudo()], editados: [] } })
          const r = await pedir(d, mover(accion), rol)
          assert.equal(r.status, esperado, r.cuerpo.mensaje)
          assert.equal(d.escrituras.length, esperado === 200 ? 1 : 0)
          if (esperado === 200) {
            assert.equal(d.escrituras[0].p.actor.rol, rol, 'el actor sale de la sesión')
            assert.equal(d.escrituras[0].p.actor.nombre, SES[rol].nombre)
          }
        })
      }
    }
  }
})

describe('decisión: reglas que no son de la tabla', () => {
  test('el rol sale de la sesión: un "quien" en el cuerpo es un 422 y un mail que no figura es solo lectura', async () => {
    const d = deps()
    assert.equal((await pedir(d, { ...mover('listo'), quien: 'tomas' }, 'rene')).status, 422)
    const r = await pedir(d, mover('listo'), 'lector')
    assert.equal(r.status, 403)
    assert.equal(r.cuerpo.codigo, 'solo_lectura')
    assert.equal(d.escrituras.length, 0)
  })
  test('el usuario de prueba de desarrollo no escribe (aunque se llame como Aylu)', async () => {
    const d = deps()
    const r = await pedir(d, mover('listo'), 'aylu', { esDePrueba: true })
    assert.equal(r.status, 403)
    assert.equal(r.cuerpo.codigo, 'usuario_de_prueba')
    assert.equal(d.escrituras.length, 0)
  })
  test('409 si la versión que vio no es la de ahora (con la de ahora en la respuesta), sin escribir', async () => {
    const d = deps()
    const r = await pedir(d, mover('listo', { version: 4 }), 'rene')
    assert.equal(r.status, 409)
    assert.equal(r.cuerpo.codigo, 'conflicto')
    assert.deepEqual(r.cuerpo.actual, { version: 5, estado: 'para_editar' })
    assert.equal(d.escrituras.length, 0)
  })
  test('el conflicto que detecta el repositorio (otra escritura en el medio) también es 409', async () => {
    const d = deps({ mover: () => ({ ok: false, motivo: 'conflicto', actual: { video: video({ version: 9 }), evento: evento(video()) } }) })
    const r = await pedir(d, mover('listo'), 'rene')
    assert.equal(r.status, 409)
    assert.deepEqual(r.cuerpo.actual, { version: 9, estado: 'para_editar' })
  })
  test('no existe → 404; requisito que falta → 409 con el motivo', async () => {
    assert.equal((await pedir(deps({ leer: () => null }), mover('listo'), 'rene')).status, 404)
    const d = deps({ detalle: { video: video({ estado: 'crudo_a_revisar' }), notas: [], crudos: [], editados: [] } })
    const r = await pedir(d, mover('sirve'), 'aylu')
    assert.equal(r.status, 409)
    assert.match(r.cuerpo.mensaje, /crudos vinculados/)
  })
  test('listo con el link en el mismo pedido: el link va como cambio del editado', async () => {
    const d = deps()
    const r = await pedir(d, mover('listo', { editado_url: 'https://drive.google.com/file/d/abc/view' }), 'rene')
    assert.equal(r.status, 200)
    assert.deepEqual(d.escrituras[0].p.cambios, { editado: { archivo_id: null, url: 'https://drive.google.com/file/d/abc/view' } })
  })
  test('para_cliente sin link al editado no se puede; con el link en el pedido, sí', async () => {
    const det = { video: video({ estado: 'editado' }), notas: [], crudos: [crudo()], editados: [] }
    assert.equal((await pedir(deps({ detalle: det }), mover('para_cliente'), 'aylu')).status, 409)
    assert.equal((await pedir(deps({ detalle: det }), mover('para_cliente', { editado_url: 'https://drive.google.com/file/d/abc/view' }), 'aylu')).status, 200)
  })
})

describe('modo prueba (EDICION_MODO≠real o ?dry=1): valida, responde qué haría y NO escribe', () => {
  const casos = [
    ['mover', mover('listo'), 'rene'],
    ['mover_lote', { accion: 'mover_lote', transicion: 'listo', items: [{ video_id: 7, version: 5 }] }, 'rene'],
    ['vincular_archivo', { accion: 'vincular_archivo', archivo_id: 31, video_id: 7 }, 'aylu'],
    ['nota_crear', { accion: 'nota_crear', video_id: 7, segundo: 1, hasta: null, tipo: 'texto', texto: 'x', imagen_url: null }, 'aylu'],
    ['nota_tildar', { accion: 'nota_tildar', nota_id: 1, version: 1, tildada: true }, 'rene'],
    ['envio_registrado', { accion: 'envio_registrado', tipo: 'link_final', texto: 'hola', items: [{ video_id: 7, version: 5 }] }, 'aylu'],
    ['prioridad', { accion: 'prioridad', video_id: 7, version: 5, prioridad: 'urgente' }, 'aylu'],
    ['bloqueo', { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: 'otro', motivo: 'no abre el crudo' }, 'rene'],
    ['guiones_enviados', { accion: 'guiones_enviados', id_crm: 'A101', tanda_guion: 2 }, 'aylu'],
    ['paso_hecho', { accion: 'paso_hecho', paso_id: 1, version: 1, nota: '', texto: 'hola' }, 'aylu'],
    ['paso_decision', { accion: 'paso_decision', paso_id: 1, version: 1, decision: 'pausar' }, 'tomas'],
    ['pedido_confirmar', { accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [0] }, 'aylu'],
    ['ronda_autorizar', { accion: 'ronda_autorizar', pedido_id: 1, version: 1 }, 'tomas'],
    ['marca_guardar', { accion: 'marca_guardar', id_crm: 'A101', version: null, ficha: { colores: [{ hex: '#112233', nombre: '' }] } }, 'aylu'],
    ['vinculo_confirmar', { accion: 'vinculo_confirmar', carpeta_id: 'DEMOcarpeta000001', id_crm: 'A101' }, 'aylu'],
  ]
  for (const [que, cuerpo, rol] of casos) {
    test(`${que}: 200 dry sin escrituras`, async () => {
      const d = deps({ modo: 'dry' })
      const r = await pedir(d, cuerpo, rol)
      assert.equal(r.status, 200, r.cuerpo.mensaje)
      assert.equal(r.cuerpo.dry, true)
      assert.match(r.cuerpo.mensaje, /Modo prueba/)
      assert.deepEqual(d.escrituras, [])
    })
  }
  test('en dry igual se rechaza lo que no se puede (permiso y estado)', async () => {
    const d = deps({ modo: 'dry' })
    assert.equal((await pedir(d, mover('sirve'), 'rene')).status, 403)
    assert.equal((await pedir(d, mover('ok_cliente'), 'aylu')).status, 409)
  })
})

describe('lote: un resultado por video', () => {
  test('dos videos, uno cambió en el medio: se mueve el otro y se dice cuál no', async () => {
    const vs = { 7: video({ id: 7 }), 8: video({ id: 8, version: 2 }) }
    const d = deps({ leer: id => (vs[id] ? { video: vs[id], notas: [], crudos: [crudo({ video_id: id })], editados: [] } : null) })
    const r = await pedir(d, { accion: 'mover_lote', transicion: 'listo', items: [{ video_id: 7, version: 5 }, { video_id: 8, version: 1 }] }, 'rene')
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.ok, false)
    assert.deepEqual(r.cuerpo.resultados.map(x => [x.video_id, x.ok, x.codigo ?? null]), [[7, true, null], [8, false, 'conflicto']])
    assert.match(r.cuerpo.mensaje, /1 de 2/)
    assert.equal(r.eventos.length, 1)
  })
  test('René no puede "sirve" en lote', async () => {
    const r = await pedir(deps(), { accion: 'mover_lote', transicion: 'sirve', items: [{ video_id: 7, version: 5 }] }, 'rene')
    assert.equal(r.status, 403)
  })
})

describe('P6: la 3.ª ronda del cliente', () => {
  test('Aylu confirma y queda esperando a Tomás: el aviso del motor sale para Tomás y el mensaje lo dice', async () => {
    const extra = [{ tipo: 'tope_rondas', video_id: 7, id_crm: 'A101', cliente: 'Cliente Prueba', clave: 'T1-V2', ronda: 3, pedido_id: 1 }]
    const d = deps({ confirmar: () => ({ ok: true, actual: { resultado: 'espera_tomas', eventos: [evento(video())], extra } }) })
    const r = await pedir(d, { accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [0] }, 'aylu')
    assert.equal(r.status, 200)
    assert.match(r.cuerpo.mensaje, /OK de Tomás/)
    assert.match(r.cuerpo.mensaje, /Al cliente no se le dice nada/)
    assert.deepEqual(r.extra, extra)
    assert.equal(d.escrituras[0].p.actor.rol, 'aylu')
  })
  test('autorizar la ronda es solo de Tomás; descartar, de Aylu o Tomás; René no toca pedidos', async () => {
    assert.equal((await pedir(deps(), { accion: 'ronda_autorizar', pedido_id: 1, version: 1 }, 'aylu')).status, 403)
    assert.equal((await pedir(deps(), { accion: 'ronda_autorizar', pedido_id: 1, version: 1 }, 'tomas')).status, 200)
    assert.equal((await pedir(deps(), { accion: 'pedido_descartar', pedido_id: 1, version: 1, nota: '' }, 'aylu')).status, 200)
    assert.equal((await pedir(deps(), { accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [] }, 'rene')).status, 403)
  })
  test('el ErrorPedido de C (conflicto, no existe) pasa a 409 / 404', async () => {
    const lanza = motivo => () => { const e = new Error(motivo); e.name = 'ErrorPedido'; e.motivo = motivo; e.detalle = ''; throw e }
    assert.equal((await pedir(deps({ confirmar: lanza('conflicto') }), { accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [0] }, 'aylu')).status, 409)
    assert.equal((await pedir(deps({ confirmar: lanza('no_existe') }), { accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [0] }, 'aylu')).status, 404)
  })
})

describe('permisos fuera de la máquina de estados', () => {
  test('notas: las escriben Aylu y Tomás; las tilda también René', async () => {
    const nota = { accion: 'nota_crear', video_id: 7, segundo: 17, hasta: null, tipo: 'texto', texto: 'mora → demora', imagen_url: null }
    assert.equal((await pedir(deps(), nota, 'rene')).status, 403)
    const d = deps()
    assert.equal((await pedir(d, nota, 'aylu')).status, 200)
    assert.equal(d.escrituras[0].p.nota.origen, 'aylu')
    assert.equal((await pedir(deps(), { accion: 'nota_tildar', nota_id: 1, version: 1, tildada: true }, 'rene')).status, 200)
  })
  test('bloqueo: René solo "otro" con motivo; el del tope lo maneja Tomás', async () => {
    assert.equal((await pedir(deps(), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: 'otro', motivo: 'no abre' }, 'rene')).status, 200)
    assert.equal((await pedir(deps(), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: 'crudo_borrado', motivo: 'xxx' }, 'rene')).status, 403)
    assert.equal((await pedir(deps(), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: null, motivo: '' }, 'rene')).status, 403)
    const conTope = { video: video({ estado: 'con_cliente', bloqueo: 'tope_rondas_cliente' }), notas: [], crudos: [], editados: [] }
    assert.equal((await pedir(deps({ detalle: conTope }), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: null, motivo: '' }, 'aylu')).status, 403)
    assert.equal((await pedir(deps({ detalle: conTope }), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: null, motivo: '' }, 'tomas')).status, 200)
    assert.equal((await pedir(deps(), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: 'tope_rondas_cliente', motivo: 'a mano' }, 'aylu')).status, 403)
    assert.equal((await pedir(deps(), { accion: 'bloqueo', video_id: 7, version: 5, bloqueo: null, motivo: '' }, 'aylu')).status, 409, 'no tiene bloqueo')
  })
  test('la decisión del día 9 es de Tomás', async () => {
    assert.equal((await pedir(deps(), { accion: 'paso_decision', paso_id: 1, version: 1, decision: 'pausar' }, 'aylu')).status, 403)
    assert.equal((await pedir(deps(), { accion: 'paso_decision', paso_id: 1, version: 1, decision: 'seguir' }, 'tomas')).status, 200)
    assert.equal((await pedir(deps(), { accion: 'paso_hecho', paso_id: 1, version: 1, nota: 'audio mandado', texto: '' }, 'rene')).status, 403)
  })
  test('aceptar el editado: en Para editar vincula y marca listo; en Corrección solo vincula; otro archivo es 404', async () => {
    const ed = crudo({ id: 90, tipo: 'editado', video_id: null, propuesta_video_id: 7, drive_id: 'DEMOeditado00000090' })
    let det = { video: video({ estado: 'para_editar' }), notas: [], crudos: [crudo()], editados: [ed] }
    const d = deps({ leer: () => structuredClone(det), alVincular: p => { det = { ...det, video: { ...det.video, version: det.video.version + 1, editado: { archivo_id: p.archivo_id, url: 'https://drive.google.com/file/d/DEMOeditado00000090/view' } } } } })
    const r = await pedir(d, { accion: 'aceptar_editado', archivo_id: 90, video_id: 7, version: 5 }, 'rene')
    assert.equal(r.status, 200, r.cuerpo.mensaje)
    assert.deepEqual(d.escrituras.map(e => e.que), ['vincular', 'mover'])
    assert.equal(d.escrituras[1].p.accion, 'listo')
    assert.equal(d.escrituras[1].p.version, 6, 'con la versión de después de vincular')
    det = { video: video({ estado: 'correccion' }), notas: [], crudos: [crudo()], editados: [ed] }
    const d2 = deps({ leer: () => structuredClone({ ...det, video: { ...det.video, editado: { archivo_id: 90, url: 'https://x.y/z' } } }) })
    d2.repo.videos.leerVideo = (() => { let n = 0; return async () => (n++ === 0 ? structuredClone(det) : structuredClone({ ...det, video: { ...det.video, editado: { archivo_id: 90, url: 'https://x.y/z' } } })) })()
    assert.equal((await pedir(d2, { accion: 'aceptar_editado', archivo_id: 90, video_id: 7, version: 5 }, 'rene')).status, 200)
    assert.deepEqual(d2.escrituras.map(e => e.que), ['vincular'])
    assert.equal((await pedir(deps({ detalle: det }), { accion: 'aceptar_editado', archivo_id: 91, video_id: 7, version: 5 }, 'rene')).status, 404)
  })
  test('marca: la valida C (422 con el campo) y la guarda con la persona de la sesión', async () => {
    const r = await pedir(deps(), { accion: 'marca_guardar', id_crm: 'A101', version: null, ficha: { colores: 'rojo' } }, 'aylu')
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.campo, 'ficha.colores')
    const d = deps()
    assert.equal((await pedir(d, { accion: 'marca_guardar', id_crm: 'a101', version: 2, ficha: { id_crm: 'Z9', colores: [] } }, 'tomas')).status, 200)
    assert.equal(d.escrituras[0].p.id, 'A101')
    assert.equal(d.escrituras[0].p.f.id_crm, 'A101', 'el cliente sale del pedido, no de la ficha')
    assert.equal(d.escrituras[0].p.actor.rol, 'tomas')
  })
  test('"guiones enviados" arranca el seguimiento de la tanda (motor de A)', async () => {
    const d = deps()
    const r = await pedir(d, { accion: 'guiones_enviados', id_crm: 'A101', tanda_guion: 2 }, 'aylu')
    assert.equal(r.status, 200)
    assert.deepEqual(d.escrituras[0].p, { id_crm: 'A101', tanda_guion: 2, actor: { rol: 'aylu', nombre: 'Aylu', email: 'aylu@ejemplo.test' } })
  })
  test('errores del repositorio: entrada inválida → 422; la base caída → 503', async () => {
    const entrada = deps({ mover: () => { const e = new Error('x'); e.name = 'ErrorEntradaEdicion'; e.campo = 'editado_url'; throw e } })
    const r = await pedir(entrada, mover('listo'), 'rene')
    assert.equal(r.status, 422)
    assert.equal(r.cuerpo.campo, 'editado_url')
    assert.equal((await pedir(deps({ mover: () => { throw new ErrorTransitorio('la base no respondió') } }), mover('listo'), 'rene')).status, 503)
  })
})

describe('f05: la propuesta de notas (atenderPropuesta)', () => {
  function depsProp(o = {}) {
    const guardados = []
    const llamadas = []
    return {
      guardados, llamadas,
      leerVideo: async id => (id === 7 ? { video: video({ estado: o.estado ?? 'con_cliente', ronda_cliente: 1 }), notas: [], crudos: [], editados: [] } : null),
      leerGuion: async () => null,
      proponer: async p => { llamadas.push(p); return { propuesta: [{ texto: 'Agrandar el logo', tipo: 'otro', segundo: 20, hasta: -1, afecta_rendimiento: false, motivo: '', cita: 'el logo' }], modelo: 'm', version: 'p1', tokens: null, aviso: null } },
      guardar: async p => { guardados.push(p); return { id: 44, version: 1, ...p } },
      modo: o.modo ?? 'real', env: ENV,
    }
  }
  const prop = (d, cuerpo, rol = 'aylu') => A.atenderPropuesta(d, cuerpo, SES[rol])
  test('?dry=1 en /api/edicion/pedido tampoco llama a Claude (aunque EDICION_MODO sea real)', async () => {
    const d = depsProp()
    const res = await A.atenderPostPropuesta(new Request('http://localhost:3101/api/edicion/pedido?dry=1', {
      method: 'POST', headers: { host: 'localhost:3101', origin: 'http://localhost:3101', 'content-type': 'application/json' }, body: JSON.stringify({ video_id: 7, texto: 'cambien algo' }),
    }), { exigirAcceso: () => null, sesion: () => SES.aylu, baseLista: () => true, accion: d })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).dry, true)
    assert.equal(d.llamadas.length, 0)
    assert.equal(d.guardados.length, 0)
  })
  test('Aylu: propone y guarda el pedido como propuesto, con la ronda que sigue', async () => {
    const d = depsProp()
    const r = await prop(d, { video_id: 7, texto: 'en el 0:20 el logo sale chiquito' })
    assert.equal(r.status, 200)
    assert.equal(r.cuerpo.pedido_id, 44)
    assert.equal(d.guardados[0].ronda, 2)
    assert.equal(d.guardados[0].actor.rol, 'aylu')
  })
  test('René no carga pedidos; el video tiene que estar con el cliente', async () => {
    assert.equal((await prop(depsProp(), { video_id: 7, texto: 'cambien algo' }, 'rene')).status, 403)
    assert.equal((await prop(depsProp({ estado: 'editado' }), { video_id: 7, texto: 'cambien algo' })).status, 409)
    assert.equal((await prop(depsProp(), { video_id: 8, texto: 'cambien algo' })).status, 404)
  })
  test('modo prueba: no guarda; notas a mano: no llama a Claude', async () => {
    const d = depsProp({ modo: 'dry' })
    const r = await prop(d, { video_id: 7, texto: 'cambien algo' })
    assert.equal(r.cuerpo.dry, true)
    assert.equal(d.guardados.length, 0)
    assert.equal(d.llamadas.length, 0, 'en modo prueba no se llama a Claude')
    const m = depsProp()
    const r2 = await prop(m, { video_id: 7, texto: 'cambien el 0:12', notas: [{ texto: 'Cambiar ART', tipo: 'guion', segundo: 12, hasta: null, afecta_rendimiento: true }] })
    assert.equal(r2.status, 200)
    assert.equal(m.llamadas.length, 0)
    assert.deepEqual(m.guardados[0].propuesta, [{ texto: 'Cambiar ART', tipo: 'guion', segundo: 12, hasta: null, afecta_rendimiento: true, motivo: 'cargada a mano', cita: '' }])
    assert.equal(m.guardados[0].version_prompt, 'a_mano')
  })
})

describe('la barrera HTTP (atenderPost)', () => {
  const URL_API = 'http://localhost:3101/api/edicion'
  const peticion = (cuerpo, o = {}) => new Request(o.url ?? URL_API, {
    method: 'POST',
    headers: { host: 'localhost:3101', origin: o.origin ?? 'http://localhost:3101', 'content-type': o.tipo ?? 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  })
  const post = (req, o = {}) => {
    const d = o.deps ?? deps()
    const avisos = []
    const res = A.atenderPost(req, {
      exigirAcceso: () => o.rechazo ?? null,
      sesion: () => (o.sinSesion ? null : SES[o.rol ?? 'rene']),
      baseLista: () => o.base ?? true,
      accion: d,
      avisar: o.avisar ?? ((e, x) => avisos.push([e, x])),
    })
    return { res, d, avisos }
  }
  const estado = async p => (await p.res).status
  test('401/403 de la sección (exigirAccesoApi) cortan antes de todo', async () => {
    const r = new Response('{}', { status: 403 })
    assert.equal(await estado(post(peticion(mover('listo')), { rechazo: r })), 403)
  })
  test('mismo origen exacto: otro host, otro puerto o sin Origin → 403', async () => {
    assert.equal(await estado(post(peticion(mover('listo'), { origin: 'https://malo.test' }))), 403)
    assert.equal(await estado(post(peticion(mover('listo'), { origin: 'http://localhost:9999' }))), 403)
    assert.equal(await estado(post(peticion(mover('listo'), { origin: 'http://localhost:3101.malo.test' }))), 403)
  })
  test('JSON: otro Content-Type 415; más de 8.000 caracteres 413; JSON roto 400', async () => {
    assert.equal(await estado(post(peticion(mover('listo'), { tipo: 'text/plain' }))), 415)
    assert.equal(await estado(post(peticion({ ...mover('listo'), nota: 'x'.repeat(8100) }))), 413)
    assert.equal(await estado(post(peticion('{roto'))), 400)
  })
  test('sin sesión 401; sin base 503', async () => {
    assert.equal(await estado(post(peticion(mover('listo')), { sinSesion: true })), 401)
    assert.equal(await estado(post(peticion(mover('listo')), { base: false })), 503)
  })
  test('ok: 200 con la versión nueva y los avisos se programan después, con los eventos', async () => {
    const p = post(peticion(mover('listo')))
    const res = await p.res
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const j = await res.json()
    assert.equal(j.version, 6)
    assert.equal(p.avisos.length, 1)
    assert.equal(p.avisos[0][0][0].datos.accion, 'listo')
  })
  test('?dry=1 fuerza el modo prueba aunque EDICION_MODO sea real', async () => {
    const p = post(peticion(mover('listo'), { url: `${URL_API}?dry=1` }))
    const j = await (await p.res).json()
    assert.equal(j.dry, true)
    assert.deepEqual(p.d.escrituras, [])
    assert.equal(p.avisos.length, 0)
  })
  test('si programar los avisos falla, la respuesta sale igual', async () => {
    const res = await post(peticion(mover('listo')), { avisar: () => { throw new Error('discord caído') } }).res
    assert.equal(res.status, 200)
  })
  test('un error inesperado es un 500 sin detalles (ni URLs ni mails)', async () => {
    const d = deps({ mover: () => { throw new Error('postgres://usuario:clave@host/db falló para aylu@ejemplo.test') } })
    const res = await post(peticion(mover('listo')), { deps: d }).res
    assert.equal(res.status, 500)
    const t = await res.text()
    assert.doesNotMatch(t, /postgres|@/)
  })
  test('mismoOrigen no se deja engañar por prefijos', () => {
    const h = (origin, host) => ({ get: n => (n === 'origin' ? origin : n === 'host' ? host : null) })
    assert.equal(A.mismoOrigen(h('https://despacho.test', 'despacho.test')), true)
    assert.equal(A.mismoOrigen(h('https://despacho.test.malo.io', 'despacho.test')), false)
    assert.equal(A.mismoOrigen(h(null, 'despacho.test')), false)
    assert.equal(A.mismoOrigen(h('no es url', 'despacho.test')), false)
  })
})

describe('revisión (24/10)', () => {
  test('una nota que Aylu suma con el video en corrección sale como evento para avisarle a René (antes no salía ninguno)', async () => {
    const d = deps({ detalle: { video: video({ estado: 'correccion', ronda_interna: 1 }), notas: [], crudos: [crudo()], editados: [] } })
    const ev = { id: 5, video_id: 7, id_crm: 'A101', cliente: 'Cliente Prueba', tipo: 'nota', de: null, a: null, actor: { tipo: 'persona', rol: 'aylu', nombre: 'Aylu', email: '' }, nota: '', datos: { ronda_abierta: true }, cuando: AHORA }
    d.repo.videos.crearNota = async p => ({ ok: true, actual: { id: 9, version: 1, enviada: true, ...p.nota }, evento: ev })
    const r = await pedir(d, { accion: 'nota_crear', video_id: 7, segundo: 17, hasta: null, tipo: 'texto', texto: 'seg 17: dice mora', imagen_url: null })
    assert.equal(r.status, 200); assert.match(r.cuerpo.mensaje, /le avisamos a René/)
    assert.deepEqual(r.eventos.map(e => e.tipo), ['nota'])
    // Si el repositorio no devuelve el evento, se arma con el video leído
    d.repo.videos.crearNota = async p => ({ ok: true, actual: { id: 9, version: 1, enviada: true, ...p.nota } })
    const r2 = await pedir(d, { accion: 'nota_crear', video_id: 7, segundo: 17, hasta: null, tipo: 'texto', texto: 'otra', imagen_url: null })
    assert.equal(r2.eventos.length, 1); assert.equal(r2.eventos[0].id_crm, 'A101')
    // Sin corrección en curso, la nota queda guardada (sin aviso)
    const r3 = await pedir(deps(), { accion: 'nota_crear', video_id: 7, segundo: 17, hasta: null, tipo: 'texto', texto: 'x', imagen_url: null })
    assert.equal(r3.eventos, undefined)
  })
  test('el cierre de la tanda: el OK del cliente en lote lleva la misma cita a cada video; al cliente en lote', async () => {
    const d = deps({ detalle: { video: video({ estado: 'con_cliente', editado: { archivo_id: null, url: 'https://drive.google.com/file/d/x/view' } }), notas: [], crudos: [crudo()], editados: [] } })
    const r = await pedir(d, { accion: 'mover_lote', transicion: 'ok_cliente', items: [{ video_id: 7, version: 5 }], cita: 'perfecto, todos' })
    assert.equal(r.status, 200, r.cuerpo.mensaje)
    const m = d.escrituras.find(e => e.que === 'mover')
    assert.equal(m.p.accion, 'ok_cliente'); assert.equal(m.p.ctx.cita, 'perfecto, todos')
    const d2 = deps({ detalle: { video: video({ estado: 'corregido', editado: { archivo_id: null, url: 'https://drive.google.com/file/d/x/view' } }), notas: [], crudos: [crudo()], editados: [] } })
    const r2 = await pedir(d2, { accion: 'mover_lote', transicion: 'para_cliente', items: [{ video_id: 7, version: 5 }] })
    assert.equal(r2.status, 200, r2.cuerpo.mensaje)
    assert.equal((await pedir(deps(), { accion: 'mover_lote', transicion: 'ok_cliente', items: [{ video_id: 7, version: 5 }] })).status, 422, 'sin cita')
  })
})
