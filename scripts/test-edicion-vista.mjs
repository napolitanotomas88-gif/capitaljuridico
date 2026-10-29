// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-vista.mjs
// Pantalla de Edición (bloque B): la vista pura (lib/edicion/vista.ts), los roles (permisos.ts), la validación estricta de
// los pedidos (pedido.ts) y el ejemplo saneado (demo.ts). SIN red y SIN base: fetch global queda bloqueado.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

for (const k of ['DATABASE_URL', 'EDICION_REVISOR_AYLU', 'EDICION_REVISOR_TOMAS', 'EDICION_EDITOR_RENE', 'KICKOFF_REVISOR_TOMI', 'EDICION_MODO']) delete process.env[k]
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }

const V = await import('../lib/edicion/vista.ts')
const P = await import('../lib/edicion/permisos.ts')
const PE = await import('../lib/edicion/pedido.ts')
const { datosDemo, CLIENTES_DEMO } = await import('../lib/edicion/demo.ts')

// Viernes 23/10/2026, 15:00 de Argentina (18:00 UTC)
const AHORA = new Date('2026-10-23T18:00:00.000Z')
const D = datosDemo(AHORA)
const RE_MAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i
const RE_TELEFONO = /\+\d{1,3}[\s-]?\d[\d\s-]{7,}\d/
const RE_MONTO = /(US\$|USD|\$\s?\d|ARS)/
const sinPrivados = (x, que) => {
  const t = JSON.stringify(x)
  assert.doesNotMatch(t, RE_MAIL, `${que}: tiene un mail`)
  assert.doesNotMatch(t, RE_MONTO, `${que}: tiene un monto`)
}
// Lunes a viernes, sin feriados (para no depender del calendario en los tests de horas)
const esHabilSimple = ymd => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d !== 0 && d !== 6 }

describe('el ejemplo (demo.ts) está saneado', () => {
  test('clientes "(ejemplo)", ids E1xx, archivos DEMO y ningún mail ni teléfono', () => {
    for (const n of Object.values(CLIENTES_DEMO)) assert.match(n, /\(ejemplo\)$/)
    for (const f of D.filas) assert.match(f.id_crm, /^E1\d\d$/)
    for (const id of [3, 6, 7]) for (const a of [...D.detalle(id).crudos, ...D.detalle(id).editados]) assert.match(a.drive_id, /^DEMO/)
    const todo = { filas: D.filas, pasos: D.pasos, carpetas: D.carpetas, avisos: D.avisos, detalles: D.filas.map(f => D.detalle(f.id)) }
    assert.doesNotMatch(JSON.stringify(todo), RE_MAIL)
    assert.doesNotMatch(JSON.stringify(todo), RE_TELEFONO)
  })
})

describe('tablero (armarTablero)', () => {
  test('ninguna vista lleva mails ni montos, para ningún rol', () => {
    for (const rol of ['aylu', 'tomas', 'rene', 'lector']) sinPrivados(V.armarTablero(D.filas, rol, AHORA, { marcas: D.marcas }), `tablero ${rol}`)
  })
  test('la cola de René: para editar y correcciones (sin las que esperan a Tomás); correcciones primero, después prioridad y lo más viejo', () => {
    const v = V.armarTablero(D.filas, 'rene', AHORA, { marcas: D.marcas })
    const tarjetas = v.cola.grupos.flatMap(g => g.tarjetas)
    assert.ok(tarjetas.every(t => t.estado === 'para_editar' || t.estado === 'correccion'))
    assert.ok(!tarjetas.some(t => t.bloqueo?.clave === 'tope_rondas_cliente'))
    assert.deepEqual(tarjetas.map(t => t.clave), ['T2-V3', 'T2-V1', 'T2-V2'], 'corrección, urgente, normal')
    assert.equal(v.cola.total, 3)
    // "Terminé los 2 para editar" del mismo cliente (las correcciones no van en el lote)
    assert.deepEqual(v.cola.grupos[0].lote, { transicion: 'listo', items: [{ video_id: 1, version: 3 }, { video_id: 2, version: 3 }] })
  })
  test('la cola de Tomás arranca por la 3.ª ronda que espera su OK; la de Aylu no la tiene', () => {
    const t = V.armarTablero(D.filas, 'tomas', AHORA, { marcas: D.marcas }).cola.grupos.flatMap(g => g.tarjetas)
    assert.equal(t[0].bloqueo?.clave, 'tope_rondas_cliente')
    const a = V.armarTablero(D.filas, 'aylu', AHORA, { marcas: D.marcas }).cola.grupos.flatMap(g => g.tarjetas)
    assert.ok(!a.some(x => x.bloqueo?.clave === 'tope_rondas_cliente'))
    assert.ok(a.some(x => x.estado === 'crudo_a_revisar') && a.some(x => x.estado === 'regrabar') && a.some(x => x.estado === 'corregido'))
    assert.ok(a.some(x => x.estado === 'con_cliente' && x.clave === 'T1-V4'), 'con el cliente y sin constancia de envío: a Aylu le toca mandar el link')
    assert.ok(!a.some(x => x.clave === 'CU-86a0demo1'), 'ya tiene constancia de envío')
  })
  test('el lector no tiene cola ni pestañas de escritura; René solo su cola y el tablero', () => {
    const l = V.armarTablero(D.filas, 'lector', AHORA)
    assert.equal(l.cola, null)
    assert.deepEqual(l.pestanas, ['estado'])
    assert.deepEqual(V.armarTablero(D.filas, 'lector', AHORA, { socio: true }).pestanas, ['estado', 'pendientes'])
    assert.deepEqual(V.armarTablero(D.filas, 'rene', AHORA).pestanas, ['cola', 'estado'])
    assert.deepEqual(V.armarTablero(D.filas, 'aylu', AHORA).pestanas, ['cola', 'estado', 'pendientes', 'vinculos', 'avisos'])
  })
  test('columnas en el orden del flujo, sin los finales; filtros por estado y cliente (los inválidos se ignoran)', () => {
    const v = V.armarTablero(D.filas, 'aylu', AHORA)
    assert.deepEqual(v.columnas.map(c => c.estado), ['esperando_crudos', 'crudo_a_revisar', 'regrabar', 'para_editar', 'editado', 'correccion', 'corregido', 'con_cliente', 'pausado'])
    const f = V.armarTablero(D.filas, 'aylu', AHORA, { filtro: { estado: 'para_editar', cliente: 'e101' } })
    assert.deepEqual(f.columnas.map(c => c.estado), ['para_editar'])
    assert.deepEqual(f.columnas[0].tarjetas.map(t => t.clave), ['T2-V1', 'T2-V2'])
    assert.equal(f.filtros.cliente, 'E101')
    const raro = V.armarTablero(D.filas, 'aylu', AHORA, { filtro: { estado: "x'; drop", cliente: '../x' } })
    assert.equal(raro.filtros.estado, null)
    assert.equal(raro.filtros.cliente, null)
  })
  test('la tarjeta: paleta con muestras o "sin paleta", prioridad, rondas, editado propuesto y posible duplicado', () => {
    const v = V.armarTablero(D.filas, 'aylu', AHORA, { marcas: D.marcas })
    const todas = v.columnas.flatMap(c => c.tarjetas)
    const t1 = todas.find(t => t.id === 1)
    assert.equal(t1.prioridad, 'urgente')
    assert.deepEqual(t1.paleta.map(c => c.hex), ['#1E4740', '#6B2737', '#F2EADC'])
    assert.equal(todas.find(t => t.id === 10).paleta, null, 'E103 no tiene paleta')
    assert.equal(todas.find(t => t.id === 7).rondas.texto, 'cliente 2/2')
    assert.equal(todas.find(t => t.id === 7).rondas.tope, true)
    assert.equal(todas.find(t => t.id === 6).editadoPropuesto, true)
    assert.deepEqual(todas.find(t => t.id === 15).posibleDuplicado, ['CU-86a0demo2'])
    assert.equal(t1.href, '/clientes/edicion/video/1')
    assert.equal(v.resumen.sinPaleta, 3, 'E103, E104 y E105')
  })
})

describe('tiempo y trabados', () => {
  test('horas hábiles: un fin de semana no cuenta', () => {
    // del viernes 23/10 20:00 AR al lunes 26/10 10:00 AR: 4 h del viernes + 10 h del lunes
    assert.equal(V.horasHabiles('2026-10-23T23:00:00.000Z', new Date('2026-10-26T13:00:00.000Z'), esHabilSimple), 14)
    assert.equal(V.horasHabiles('2026-10-26T13:00:00.000Z', new Date('2026-10-26T12:00:00.000Z'), esHabilSimple), 0)
  })
  test('días hábiles desde el día de entrada (sin contarlo)', () => {
    assert.equal(V.diasHabilesDesde('2026-10-23T15:00:00.000Z', new Date('2026-10-27T15:00:00.000Z'), esHabilSimple), 2)
    assert.equal(V.diasHabilesDesde('2026-10-23T15:00:00.000Z', new Date('2026-10-23T20:00:00.000Z'), esHabilSimple), 0)
  })
  test('umbrales: 24 h hábiles para René; 3 días hábiles con el cliente', () => {
    const lunes = new Date('2026-10-26T15:00:00.000Z')
    assert.equal(V.tiempoEnEstado({ estado: 'para_editar', estado_desde: '2026-10-23T18:00:00.000Z' }, lunes, esHabilSimple).trabado, false, 'viernes 15:00 → lunes 12:00 = 9 + 12 = 21 h hábiles')
    assert.equal(V.tiempoEnEstado({ estado: 'para_editar', estado_desde: '2026-10-23T15:00:00.000Z' }, lunes, esHabilSimple).trabado, true, 'viernes 12:00 → lunes 12:00 = 24 h hábiles')
    assert.equal(V.tiempoEnEstado({ estado: 'para_editar', estado_desde: '2026-10-22T15:00:00.000Z' }, lunes, esHabilSimple).trabado, true)
    assert.equal(V.tiempoEnEstado({ estado: 'con_cliente', estado_desde: '2026-10-22T15:00:00.000Z' }, lunes, esHabilSimple).trabado, false, 'jueves → lunes: 2 hábiles')
    assert.equal(V.tiempoEnEstado({ estado: 'con_cliente', estado_desde: '2026-10-21T15:00:00.000Z' }, lunes, esHabilSimple).trabado, true)
    assert.equal(V.tiempoEnEstado({ estado: 'esperando_crudos', estado_desde: '2026-01-01T00:00:00.000Z' }, lunes).trabado, false, 'sin umbral')
  })
  test('último vigía: verde, latón, bordó en horario y gris fuera de horario', () => {
    const c = (minutos, ahora) => V.estadoVigia({ id: 1, tipo: 'vigia', origen: 'puente', estado: 'ok', inicio: new Date(ahora.getTime() - minutos * 60_000).toISOString(), fin: new Date(ahora.getTime() - minutos * 60_000).toISOString(), consultas: 1, archivos_nuevos: 0, tandas_cerradas: 0, error: '', resumen: {} }, ahora)
    assert.equal(c(10, AHORA).tono, 'verde')
    assert.equal(c(60, AHORA).tono, 'amarillo')
    assert.equal(c(180, AHORA).tono, 'rojo')
    assert.equal(c(180, new Date('2026-10-24T02:30:00.000Z')).tono, 'gris', '23:30 AR: fuera del horario del vigía')
    assert.equal(V.estadoVigia(null, AHORA).tono, 'gris')
  })
})

describe('estado del cliente (se calcula de sus videos)', () => {
  const e = (...xs) => V.estadoCliente(xs.map(estado => ({ estado })))
  test('la etapa menos avanzada manda', () => {
    assert.equal(e('esperando_crudos', 'para_editar'), 'grabando')
    assert.equal(e('crudo_a_revisar', 'con_cliente'), 'en_revision')
    assert.equal(e('editado', 'con_cliente'), 'en_edicion')
    assert.equal(e('con_cliente', 'aprobado'), 'con_cliente')
    assert.equal(e('aprobado', 'descartado'), 'al_dia')
    assert.equal(e(), 'al_dia')
    assert.equal(e('pausado', 'pausado', 'aprobado'), 'pausado')
  })
})

describe('cliente (armarCliente)', () => {
  test('René no recibe ningún link a /clientes; quien ve Clientes, sí', () => {
    const rene = V.armarCliente(D.cliente('E101'), D.marcas.get('E101'), 'rene', false)
    assert.equal(rene.linkClientes, null)
    assert.doesNotMatch(JSON.stringify(rene), /\/clientes\/(?!edicion\/)/) // sus links son de la pestaña Edición (/clientes/edicion/…), nunca de la Cartera ni de la ficha
    assert.equal(rene.permisos.e04, false)
    assert.ok(rene.tandas.every(t => t.guiones.every(g => !g.video || !g.video.acciones.length)), 'René no ve el check de Aylu')
    const aylu = V.armarCliente(D.cliente('E101'), D.marcas.get('E101'), 'aylu', true)
    assert.equal(aylu.linkClientes, '/clientes/E101')
    sinPrivados(aylu, 'cliente E101')
  })
  test('por tanda del guion: la cobertura de e03 y el check de e04 en el crudo a revisar', () => {
    const v = V.armarCliente(D.cliente('E101'), D.marcas.get('E101'), 'aylu', true)
    const t2 = v.tandas.find(t => t.tanda === 2)
    assert.deepEqual(t2.guiones.map(g => g.ref), ['T2-V1', 'T2-V2', 'T2-V3', 'T2-V4', 'T2-V5'])
    const v4 = t2.guiones.find(g => g.ref === 'T2-V4')
    assert.equal(v4.cobertura.texto, '8 de 9 frases')
    assert.deepEqual(v4.cobertura.faltan, ['Escribinos y lo vemos juntos'])
    assert.equal(v4.cobertura.mejorToma, 'IMG_0253.MOV · 1:05')
    assert.deepEqual(v4.video.acciones.map(a => a.accion), ['sirve', 'regrabar', 'pausa_devolucion'])
    assert.equal(v4.video.acciones.find(a => a.accion === 'regrabar').pide, 'motivo')
    assert.deepEqual(t2.lote, [{ video_id: 4, version: 3 }])
    assert.equal(t2.ofrecerGuionesEnviados, false, 'ya hay un ciclo abierto')
  })
  test('crudos: transcripción (falta la key, grande con plan B), quién subió y asignación', () => {
    const v = V.armarCliente(D.cliente('E101'), null, 'aylu', true)
    const pend = v.crudos.find(a => a.nombre === 'IMG_0260.MOV')
    assert.equal(pend.transcripcion.texto, 'Pendiente (falta la key de AssemblyAI)')
    assert.equal(pend.asignado, null)
    const grande = v.crudos.find(a => a.nombre === 'C0045.MP4')
    assert.equal(grande.transcripcion.texto, 'Sin transcribir (5,6 GB, plan B)')
    assert.equal(grande.subio, 'lo subió el equipo')
    assert.match(grande.drive, /^https:\/\/drive\.google\.com\/file\/d\/DEMO/)
    assert.equal(v.marca.vacia, true)
  })
  test('el texto de regrabación para copiar (textos.ts de C) sale con los videos en "regrabar"', () => {
    const v = V.armarCliente(D.cliente('E103'), null, 'aylu', true)
    assert.ok(v.regrabar.texto.includes('Video 1'))
    assert.deepEqual(v.regrabar.items, [{ video_id: 10, version: 3 }])
    assert.equal(V.armarCliente(D.cliente('E103'), null, 'rene', false).regrabar, null)
  })
})

describe('video (armarVideo)', () => {
  test('René ve solo las notas enviadas y no ve el pedido del cliente ni el texto para copiar', () => {
    const d = D.detalle(6)
    assert.ok(d.notas.some(n => !n.enviada))
    const r = V.armarVideo(d, null, null, 'rene', AHORA)
    assert.deepEqual(r.notasNuevas, [])
    assert.equal(r.rondasNotas.length, 0)
    assert.equal(r.envio, null)
    assert.equal(r.permisos.pedido, false)
    const a = V.armarVideo(d, null, null, 'aylu', AHORA)
    assert.equal(a.notasNuevas.length, 1)
    assert.equal(a.notasNuevas[0].puedeEditar, true)
  })
  test('en corrección: René tilda las enviadas; los botones salen de accionesPara', () => {
    const r = V.armarVideo(D.detalle(3), D.marcas.get('E101'), null, 'rene', AHORA)
    assert.equal(r.rondasNotas[0].notas.length, 3)
    assert.ok(r.rondasNotas[0].notas.every(n => n.puedeTildar))
    assert.deepEqual(r.acciones.map(a => a.accion), [], 'quedan 2 sin tildar: René todavía no puede marcar corregido')
    assert.equal(r.ctx.notasSinTildar, 2)
    const t = V.armarVideo(D.detalle(3), null, null, 'tomas', AHORA)
    const forzar = t.acciones.find(a => a.accion === 'corregido')
    assert.equal(forzar.etiqueta, 'Corregido (forzar)')
    assert.equal(forzar.pide, 'nota')
    assert.deepEqual(V.armarVideo(D.detalle(3), null, null, 'lector', AHORA).acciones, [])
  })
  test('para editar: René tiene "listo" (con el link opcional) y el bloqueo "otro"; Aylu además devolver y pausar', () => {
    const r = V.armarVideo(D.detalle(1), null, null, 'rene', AHORA)
    assert.deepEqual(r.acciones.map(a => a.accion), ['listo'])
    assert.equal(r.acciones[0].pide, 'link_opcional')
    assert.equal(r.permisos.bloqueo, 'otro')
    assert.equal(r.permisos.aceptarEditado, true)
    const a = V.armarVideo(D.detalle(1), null, null, 'aylu', AHORA)
    assert.deepEqual(a.acciones.map(x => x.accion), ['devolver', 'listo', 'pausar', 'descartar'])
    assert.equal(a.permisos.bloqueo, 'todo')
  })
  test('con el cliente: el link final para copiar, el pedido en espera de Tomás y el aviso interno', () => {
    const v = V.armarVideo(D.detalle(7), null, null, 'aylu', AHORA)
    assert.equal(v.envio.tipo, 'link_final')
    assert.match(v.envio.texto, /drive\.google\.com/)
    assert.match(v.envio.constancia, /^Enviado por Aylu/)
    assert.equal(v.esperaTomas.claveEstado, 'espera_tomas')
    assert.equal(v.bloqueo.clave, 'tope_rondas_cliente')
    // P6: al cliente nunca se le habla de rondas ni se le dice que no (el renglón del video lleva el gancho, que es contenido)
    assert.doesNotMatch(v.envio.texto, /ronda|tope/i)
    assert.doesNotMatch(v.envio.texto.split('\n').filter(l => !l.startsWith('•')).join('\n'), /\bno\b/i)
  })
  test('el editado que propone el bot y el historial con nombres (nunca mails)', () => {
    const d = D.detalle(6)
    const v = V.armarVideo(d, null, null, 'rene', AHORA)
    assert.equal(v.propuestas.length, 1)
    assert.equal(v.propuestas[0].nombre, 'T1 V1 final.mp4')
    const conMail = { ...D.detalle(3) }
    conMail.eventos = conMail.eventos.map(e => (e.actor.tipo === 'persona' ? { ...e, actor: { ...e.actor, email: 'rene.real@example.test' } } : e))
    conMail.video = { ...conMail.video, envio_link: { quien: 'aylu.real@example.test', cuando: AHORA.toISOString(), texto: 'x' } }
    const h = V.armarVideo(conMail, null, null, 'aylu', AHORA)
    sinPrivados(h, 'video con mails en la base')
    assert.ok(h.historial.some(x => x.quien === 'René'))
  })
})

describe('grabaciones pendientes (armarPendientes)', () => {
  test('día 0: texto para el grupo con el link al doc; día 2 y día 9: guías internas; solo Tomás decide', () => {
    const v = V.armarPendientes(D.pasos, 'aylu', { ahora: AHORA, docs: D.docs })
    const dia0 = v.clientes.flatMap(c => c.pasos).find(p => p.claveEscalon === 'dia0' && p.id === 3)
    assert.equal(dia0.texto.para, 'grupo_contenido')
    assert.match(dia0.texto.texto, /docs\.google\.com\/document\/d\/DEMOdocE101/)
    const dia2 = v.clientes.flatMap(c => c.pasos).find(p => p.claveEscalon === 'dia2')
    assert.equal(dia2.texto.para, 'interno')
    assert.equal(dia2.responsable, 'Gero M')
    assert.equal(v.puedeMarcar, true)
    assert.equal(v.puedeDecidir, false)
    assert.equal(V.armarPendientes(D.pasos, 'tomas', { ahora: AHORA }).puedeDecidir, true)
    assert.equal(V.armarPendientes(D.pasos, 'rene', { ahora: AHORA }).puedeMarcar, false)
    assert.ok(v.clientes.flatMap(c => c.pasos).some(p => p.frenado), 'el paso frenado por crudos sin ubicar se ve')
    sinPrivados(v, 'pendientes')
  })
})

describe('vínculos y avisos', () => {
  test('vínculos: solo los "a confirmar", con candidatos por puntaje', () => {
    const v = V.armarVinculos(D.carpetas, 'aylu')
    assert.equal(v.pendientes.length, 2)
    assert.deepEqual(v.pendientes.find(p => p.nombre === 'Crudos - De Ejemplo').candidatos.map(k => [k.id_crm, k.puntaje]), [['E102', '82 %'], ['E104', '41 %']])
    assert.equal(v.confirmados, 1)
    assert.equal(V.armarVinculos(D.carpetas, 'rene').puedeConfirmar, false)
  })
  test('avisos: estado con tono y las menciones tapadas', () => {
    const f = V.armarAvisos([...D.avisos, { ...D.avisos[0], id: 99, texto: '<@100000000000000001> hola', creado: AHORA.toISOString() }])
    assert.equal(f[0].texto, '@… hola')
    assert.ok(f.some(a => a.estado === 'Dudoso: revisar en Discord' && a.tono === 'amarillo'))
    assert.ok(f.some(a => a.tono === 'rojo' && /404/.test(a.error)))
  })
})

describe('roles de edición (permisos.ts)', () => {
  const PROD = { NODE_ENV: 'production', EDICION_REVISOR_AYLU: 'aylu@ejemplo.test', EDICION_REVISOR_TOMAS: 'tomas@ejemplo.test, otro@ejemplo.test', EDICION_EDITOR_RENE: 'rene@ejemplo.test' }
  const s = (email, nombre = 'X') => ({ email, nombre })
  test('en producción: solo por mail exacto (varios por coma); sin la variable o en dos listas, lector', () => {
    assert.equal(P.rolEdicion(s('AYLU@ejemplo.test'), PROD), 'aylu')
    assert.equal(P.rolEdicion(s('otro@ejemplo.test'), PROD), 'tomas')
    assert.equal(P.rolEdicion(s('rene@ejemplo.test'), PROD), 'rene')
    assert.equal(P.rolEdicion(s('nadie@ejemplo.test', 'René Napolitano'), PROD), 'lector', 'en producción el nombre no cuenta')
    assert.equal(P.rolEdicion(s('rene@ejemplo.test'), { NODE_ENV: 'production' }), 'lector')
    assert.equal(P.rolEdicion(s('aylu@ejemplo.test'), { ...PROD, EDICION_EDITOR_RENE: 'aylu@ejemplo.test' }), 'lector', 'en dos listas: falla cerrado')
    assert.equal(P.rolEdicion(s('ts@ejemplo.test'), { NODE_ENV: 'production', KICKOFF_REVISOR_TOMI: 'ts@ejemplo.test' }), 'tomas', 'Tomás cae en la variable del kickoff')
    assert.equal(P.rolEdicion({ ...s('aylu@ejemplo.test'), esDePrueba: true }, PROD), 'lector', 'el usuario de prueba nunca escribe')
    assert.equal(P.rolEdicion(null, PROD), 'lector')
  })
  test('fuera de producción: el nombre o el apellido como palabra entera (nunca el mail)', () => {
    assert.equal(P.rolEdicion(s('x@ejemplo.test', 'Aylén QA'), {}), 'aylu')
    assert.equal(P.rolEdicion(s('x@ejemplo.test', 'Tomás Napolitano'), {}), 'tomas')
    assert.equal(P.rolEdicion(s('x@ejemplo.test', 'René'), {}), 'rene')
    assert.equal(P.rolEdicion(s('rene@ejemplo.test', 'Renata'), {}), 'lector')
    assert.equal(P.rolEdicion(s('x@ejemplo.test', 'Napolitanos'), {}), 'lector')
  })
  test('la persona firma con el nombre de la sesión; el lector no tiene persona', () => {
    assert.deepEqual(P.personaDeSesion(s('rene@ejemplo.test', '  René  Gómez '), PROD), { rol: 'rene', nombre: 'René Gómez', email: 'rene@ejemplo.test' })
    assert.equal(P.personaDeSesion(s('nadie@ejemplo.test'), PROD), null)
    assert.deepEqual(P.variablesFaltantes({ NODE_ENV: 'production' }), ['EDICION_REVISOR_AYLU', 'EDICION_REVISOR_TOMAS', 'EDICION_EDITOR_RENE'])
  })
  test('René no ve Clientes (sin links) y no tiene permisos de Aylu', () => {
    assert.equal(P.veClientes({ rol: 'acceso', secciones: ['edicion'] }), false)
    assert.equal(P.veClientes('socio'), true)
    assert.equal(P.tienePermiso('rene', 'nota'), false)
    assert.equal(P.tienePermiso('rene', 'tildar'), true)
    assert.equal(P.tienePermiso('aylu', 'decidir_paso'), false)
    assert.equal(P.tienePermiso('tomas', 'decidir_paso'), true)
    assert.equal(P.tienePermiso('lector', 'tildar'), false)
  })
})

describe('validación estricta de los pedidos (pedido.ts)', () => {
  const ok = x => { const r = PE.validarPedido(x); assert.ok(r.ok, JSON.stringify(r)); return r.pedido }
  const malo = (x, campo) => { const r = PE.validarPedido(x); assert.equal(r.ok, false, JSON.stringify(x)); if (campo) assert.equal(r.campo, campo) }
  test('campos de más, acciones que no existen, tipos raros', () => {
    malo(null, 'cuerpo'); malo([], 'cuerpo'); malo({ accion: 'borrar_todo' }, 'accion')
    malo({ accion: 'mover', video_id: 1, version: 1, transicion: 'listo', quien: 'tomas' }, 'quien')
    malo({ accion: 'mover', video_id: '1', version: 1, transicion: 'listo' }, 'video_id')
    malo({ accion: 'mover', video_id: 1, transicion: 'listo' }, 'version')
    malo({ accion: 'mover', video_id: 1, version: 1, transicion: 'volar' }, 'transicion')
  })
  test('pedido_cliente, autorizar_ronda y regrabar_enviado no van por "mover"', () => {
    for (const t of ['pedido_cliente', 'autorizar_ronda', 'regrabar_enviado']) malo({ accion: 'mover', video_id: 1, version: 1, transicion: t }, 'transicion')
  })
  test('mover: motivo, nota, cita y link https', () => {
    assert.deepEqual(ok({ accion: 'mover', video_id: 1, version: 2, transicion: 'regrabar', motivo: 'duro', nota: '  se  traba ' }), { accion: 'mover', video_id: 1, version: 2, transicion: 'regrabar', motivo: 'duro', nota: 'se traba' })
    malo({ accion: 'mover', video_id: 1, version: 2, transicion: 'regrabar', motivo: 'feo' }, 'motivo')
    malo({ accion: 'mover', video_id: 1, version: 2, transicion: 'listo', editado_url: 'http://drive.google.com/x' }, 'editado_url')
    malo({ accion: 'mover', video_id: 1, version: 2, transicion: 'listo', editado_url: 'javascript:alert(1)' }, 'editado_url')
    malo({ accion: 'mover', video_id: 1, version: 2, transicion: 'ok_cliente', cita: 'x'.repeat(PE.LARGO_CITA + 1) }, 'cita')
    assert.equal(ok({ accion: 'mover', video_id: 1, version: 2, transicion: 'listo', editado_url: 'https://drive.google.com/file/d/abc/view' }).editado_url, 'https://drive.google.com/file/d/abc/view')
  })
  test('lotes: hasta 30, sin repetidos, solo sirve o listo', () => {
    const items = n => Array.from({ length: n }, (_, i) => ({ video_id: i + 1, version: 1 }))
    assert.equal(ok({ accion: 'mover_lote', transicion: 'sirve', items: items(30) }).items.length, 30)
    malo({ accion: 'mover_lote', transicion: 'sirve', items: items(31) }, 'items')
    malo({ accion: 'mover_lote', transicion: 'sirve', items: [{ video_id: 1, version: 1 }, { video_id: 1, version: 1 }] }, 'items')
    malo({ accion: 'mover_lote', transicion: 'pausar', items: items(2) }, 'transicion')
    // revisión: el cierre de la tanda va en lote (al cliente y el OK del cliente con UNA cita)
    assert.equal(ok({ accion: 'mover_lote', transicion: 'para_cliente', items: items(8) }).items.length, 8)
    malo({ accion: 'mover_lote', transicion: 'ok_cliente', items: items(2) }, 'cita')
    assert.equal(ok({ accion: 'mover_lote', transicion: 'ok_cliente', items: items(8), cita: 'perfecto, todos' }).cita, 'perfecto, todos')
    malo({ accion: 'mover_lote', transicion: 'sirve', items: items(2), cita: 'x' }, 'cita')
  })
  test('notas: segundo y hasta en orden, imagen https, tipo conocido', () => {
    assert.deepEqual(ok({ accion: 'nota_crear', video_id: 3, segundo: 17.04, hasta: null, tipo: 'texto', texto: 'mora → demora', imagen_url: null }),
      { accion: 'nota_crear', video_id: 3, segundo: 17, hasta: null, tipo: 'texto', texto: 'mora → demora', imagen_url: null })
    malo({ accion: 'nota_crear', video_id: 3, segundo: 30, hasta: 20, tipo: 'corte', texto: 'x', imagen_url: null }, 'hasta')
    malo({ accion: 'nota_crear', video_id: 3, segundo: null, hasta: null, tipo: 'magia', texto: 'x', imagen_url: null }, 'tipo')
    malo({ accion: 'nota_crear', video_id: 3, segundo: null, hasta: null, tipo: 'otro', texto: 'x', imagen_url: 'http://x.com/a.png' }, 'imagen_url')
    malo({ accion: 'nota_editar', nota_id: 1, version: 1, cambios: { origen: 'cliente' } }, 'cambios.origen')
    malo({ accion: 'nota_editar', nota_id: 1, version: 1, cambios: {} }, 'cambios')
  })
  test('bloqueo: motivo obligatorio para poner; null para sacar', () => {
    malo({ accion: 'bloqueo', video_id: 1, version: 1, bloqueo: 'otro', motivo: '' }, 'motivo')
    assert.equal(ok({ accion: 'bloqueo', video_id: 1, version: 1, bloqueo: null, motivo: '' }).bloqueo, null)
    malo({ accion: 'bloqueo', video_id: 1, version: 1, bloqueo: 'roto', motivo: 'xxx' }, 'bloqueo')
  })
  test('pedido del cliente: texto, y notas a mano opcionales', () => {
    assert.equal(PE.validarPropuesta({ video_id: 1, texto: 'cambien el 0:12' }).ok, true)
    assert.equal(PE.validarPropuesta({ video_id: 1, texto: 'x' }).ok, false)
    assert.equal(PE.validarPropuesta({ video_id: 1, texto: 'cambien', modelo: 'otro' }).ok, false)
    const r = PE.validarPropuesta({ video_id: 1, texto: 'cambien el 0:12', notas: [{ texto: 'Cambiar ART', tipo: 'guion', segundo: 12, hasta: null, afecta_rendimiento: false }] })
    assert.deepEqual(r.pedido.notas, [{ texto: 'Cambiar ART', tipo: 'guion', segundo: 12, hasta: null, afecta_rendimiento: false }])
    assert.equal(PE.validarPropuesta({ video_id: 1, texto: 'cambien', notas: [] }).ok, false)
    assert.equal(PE.validarPropuesta({ video_id: 1, texto: 'cambien', notas: [{ texto: 'x', tipo: 'guion', cita: 'y' }] }).ok, false)
  })
  test('ids de CRM y de Drive, tandas, elegidas', () => {
    assert.equal(ok({ accion: 'guiones_enviados', id_crm: 'a101', tanda_guion: 2 }).id_crm, 'A101')
    malo({ accion: 'guiones_enviados', id_crm: 'A101', tanda_guion: 0 }, 'tanda_guion')
    malo({ accion: 'vinculo_confirmar', carpeta_id: '../..', id_crm: 'A1' }, 'carpeta_id')
    assert.deepEqual(ok({ accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [2, 0] }).elegidas, [0, 2])
    malo({ accion: 'pedido_confirmar', pedido_id: 1, version: 1, elegidas: [1, 1] }, 'elegidas')
  })
  test('tiempos mm:ss', () => {
    assert.equal(PE.leerTiempo('1:05'), 65)
    assert.equal(PE.leerTiempo('17'), 17)
    assert.equal(PE.leerTiempo('0:12,5'), 12.5)
    assert.equal(PE.leerTiempo(''), null)
    assert.equal(PE.leerTiempo('1:75'), undefined)
    assert.equal(PE.leerTiempo('abc'), undefined)
    assert.equal(PE.mmss(65), '1:05')
    assert.equal(PE.mmss(65.5), '1:05.5')
  })
})

describe('revisión (24/10)', () => {
  test('P6: René no recibe la 3.ª ronda que espera a Tomás (ni pedidos propuestos o descartados)', () => {
    const r = V.armarVideo(D.detalle(7), null, null, 'rene', AHORA)
    assert.deepEqual(r.pedidos, []); assert.equal(r.esperaTomas, null)
    assert.doesNotMatch(JSON.stringify(r), /aseguradora/, 'el mensaje del cliente no llega al navegador de René')
    const t = V.armarVideo(D.detalle(7), null, null, 'tomas', AHORA)
    assert.equal(t.esperaTomas.claveEstado, 'espera_tomas')
  })
  test('René en corrección con notas sin tildar: «Qué sigue» le explica que tilde las notas', () => {
    const r = V.armarVideo(D.detalle(3), null, null, 'rene', AHORA)
    assert.match(r.queSigue, /tildala/); assert.match(r.queSigue, /quedan 2 sin tildar/)
    assert.equal(V.armarVideo(D.detalle(3), null, null, 'tomas', AHORA).queSigue, null)
  })
  test('importados de ClickUp: la tarjeta, la ficha y la lista del cliente dicen «Video N · ClickUp», nunca la clave CU-…', () => {
    assert.equal(V.claveVisible({ clave: 'CU-86b6xyz', numero: 3 }), 'Video 3 · ClickUp')
    assert.equal(V.claveVisible({ clave: 'CU-86b6xyz', numero: null }), 'Video de ClickUp')
    assert.equal(V.claveVisible({ clave: 'T2-V4', numero: 4 }), 'T2-V4')
    const f = { ...D.filas.find(x => x.id === 13), numero: 3 }
    assert.equal(V.tarjeta(f, AHORA).clave, 'Video 3 · ClickUp')
    const d = D.detalle(13); d.video = { ...d.video, numero: 3 }
    const v = V.armarVideo(d, null, null, 'aylu', AHORA)
    assert.equal(v.clave, 'Video 3 · ClickUp')
    assert.match(v.envio.texto, /• Video 3/, 'el link final al cliente lleva el número')
  })
  test('cierre de la tanda: al cliente en lote, UN link final con los que faltan mandar y el OK en lote (sin el que espera a Tomás)', () => {
    const v = V.armarCliente(D.cliente('E102'), null, 'aylu', true)
    const t1 = v.tandas.find(t => t.tanda === 1)
    assert.deepEqual(t1.cierre.alCliente, [{ video_id: 8, version: t1.cierre.alCliente[0].version }])
    assert.deepEqual(t1.cierre.linkFinal.items.map(i => i.video_id), [9], 'el 7 ya tiene la constancia de envío')
    assert.match(t1.cierre.linkFinal.texto, /¡Ya está listo el video de la tanda 1!/)
    assert.deepEqual(t1.cierre.ok.map(i => i.video_id), [9], 'el 7 espera el OK de Tomás')
    assert.equal(V.armarCliente(D.cliente('E102'), null, 'rene', false).tandas.find(t => t.tanda === 1).cierre, null)
  })
  test('el detalle que escribió Aylu al marcar «Regrabar» llega al texto para el cliente', () => {
    const datos = { ...D.cliente('E103'), detallesRegrabar: { 10: 'grabá con luz de frente' } }
    assert.match(V.armarCliente(datos, null, 'aylu', true).regrabar.texto, /grabá con luz de frente/)
    const ev = [{ video_id: 10, tipo: 'estado', datos: { accion: 'regrabar' }, nota: 'la frase del CTA', cuando: '2026-10-23T12:00:00.000Z' },
      { video_id: 10, tipo: 'estado', datos: { accion: 'regrabar' }, nota: 'vieja', cuando: '2026-10-20T12:00:00.000Z' }]
    assert.deepEqual(V.detallesRegrabar(ev), { 10: 'la frase del CTA' })
  })
  test('«Guiones enviados» se ofrece POR TANDA: un ciclo abierto de la tanda 1 no tapa la tanda 2 que todavía no tiene videos', () => {
    const base = D.cliente('E105')
    const g = (tanda, numero) => ({ ref: `T${tanda}-V${numero}`, tanda, numero, estado_doc: 'no_iniciado', titulo: `Guion ${numero}`, secciones: { hook: 'Hook', problema: '', solucion: '', cta: '' }, frases: ['Hook'], huella: `h${tanda}${numero}` })
    const doc = { id_crm: 'E105', doc_id: 'docDEMO000001', modificado: AHORA.toISOString(), leido: AHORA.toISOString(), guiones: [g(1, 1), g(1, 2), g(2, 1), g(2, 2)], avisos: [] }
    const pasos = [{ id: 1, id_crm: 'E105', cliente: 'x', ciclo: '2026-10-10', motivo: 'para_grabar', escalon: 'dia2', debido: '2026-10-14', dias_habiles: 2, videos: [16, 17], responsable: 'gero_m', texto: '', hecho: null, decision: null, estado: 'abierto', version: 1 }]
    const v = V.armarCliente({ ...base, doc, seguimientos: pasos }, null, 'aylu', true)
    assert.equal(v.tandas.find(t => t.tanda === 2).ofrecerGuionesEnviados, true)
    assert.equal(v.tandas.find(t => t.tanda === 1).ofrecerGuionesEnviados, false, 'la tanda 1 ya está en el ciclo')
  })
  test('el contador de Grabaciones pendientes cuenta solo lo que falta hacer', () => {
    const pasos = [{ estado: 'abierto', hecho: { quien: 'Aylu', cuando: '', nota: '' } }, { estado: 'abierto', hecho: { quien: 'Aylu', cuando: '', nota: '' } }, { estado: 'abierto', hecho: null }]
    assert.equal(V.pasosPorHacer(pasos), 1)
  })
  test('vínculos: las ya vinculadas se listan para corregirlas (las del bot primero, para revisar)', () => {
    const carp = [...D.carpetas, { ...D.carpetas[2], drive_id: 'DEMObot00000001', nombre: 'Ana (ejemplo)', id_crm: 'E106', vinculo: 'bot', tipo: 'cliente', raiz: null }]
    const v = V.armarVinculos(carp, 'aylu')
    assert.equal(v.vinculadas[0].revisar, true); assert.equal(v.vinculadas[0].id_crm, 'E106')
    assert.ok(v.vinculadas.some(x => x.id_crm === 'E101' && x.por === 'el alta'))
  })
  test('tiempos desde el teclado numérico del celular: 1,05 y 1.05 son 1:05; 1,5 es un error (antes era 1,5 segundos)', () => {
    assert.equal(PE.leerTiempo('1,05'), 65); assert.equal(PE.leerTiempo('1.05'), 65); assert.equal(PE.leerTiempo('1:05'), 65)
    assert.equal(PE.leerTiempo('1,5'), undefined); assert.equal(PE.leerTiempo('17.5'), undefined)
    assert.equal(PE.leerTiempo('1:05,5'), 65.5)
  })
})
