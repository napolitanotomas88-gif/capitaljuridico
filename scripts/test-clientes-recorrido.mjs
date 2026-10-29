// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-clientes-recorrido.mjs
// Línea de tiempo de la cartera (lib/clientes/recorrido.ts): en qué etapa cae cada cliente, frenados, éxito y filtros. Puro.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const R = await import('../lib/clientes/recorrido.ts')
const HOY = '2026-10-25'
const LEE = { meta: true, despacho: true, clickup: true }
const cli = (o = {}) => ({ id: 'A001', nombre: 'Ana Pérez', closer: 'Gero', estado: 'ACTIVO', dia1: '2026-10-20', diasParaVencer: 60, fechaBaja: null, promesa: '', satisfaccion: null, ...o })
const nada = (o = {}) => ({ kickoff: null, tanda: null, videos: null, meta: null, clickup: null, puntaje: null, ...o })
const vid = (o = {}) => ({ grabacion: 0, edicion: 0, aprobados: 0, pausados: 0, ultimoGrabacion: null, ultimoEdicion: null, ultimoAprobado: null, ...o })
const u = (c, f, l = LEE) => R.ubicarCliente(cli(c), nada(f), HOY, l)

test('el CRM manda en pausa y baja aunque Meta tenga campaña', () => {
  assert.equal(u({ estado: 'PAUSADO' }, { meta: { activa: true, ultimoLanzamiento: '2026-09-01', semaforo: 'verde' } }).etapa, 'pausa')
  assert.equal(u({ estado: 'FINALIZADO' }).etapa, 'baja')
  assert.equal(u({ estado: 'INACTIVO' }).etapa, 'baja')
})

test('sin nada: alta si es reciente, sin dato si es viejo', () => {
  assert.equal(u({}).etapa, 'alta')
  assert.equal(u({ dia1: '2026-06-01' }).etapa, 'sin_dato')
  assert.equal(u({ dia1: null }).etapa, 'alta')
})

test('Despacho: ficha → kickoff, tanda → guiones o grabación, videos → grabación / edición / por lanzar', () => {
  assert.equal(u({}, { kickoff: { fecha: '2026-10-24', frenos: 0, ideas: '' } }).etapa, 'kickoff')
  assert.equal(u({}, { tanda: { tanda: 1, estado: 'a_revisar', actualizado: HOY, guiones: 6 } }).etapa, 'guiones')
  assert.equal(u({}, { tanda: { tanda: 1, estado: 'enviada', actualizado: HOY, guiones: 6 } }).etapa, 'grabacion')
  assert.equal(u({}, { videos: vid({ grabacion: 2, ultimoGrabacion: HOY }) }).etapa, 'grabacion')
  assert.equal(u({}, { videos: vid({ grabacion: 2, edicion: 1, ultimoEdicion: HOY }) }).etapa, 'edicion')
  assert.equal(u({}, { videos: vid({ aprobados: 5, ultimoAprobado: HOY }) }).etapa, 'por_lanzar')
})

test('Meta activa: lanzado; contento → éxito; vence pronto → renovación', () => {
  const meta = { activa: true, ultimoLanzamiento: '2026-08-01', semaforo: 'verde' }
  assert.equal(u({}, { meta }).etapa, 'lanzado')
  assert.equal(u({}, { meta, puntaje: { valor: 9, dia: HOY } }).etapa, 'exito')
  assert.equal(u({ satisfaccion: 8 }, { meta }).etapa, 'exito', 'sin puntaje usa la satisfacción del CRM')
  assert.equal(u({ satisfaccion: 9, promesa: 'No' }, { meta }).etapa, 'lanzado', 'promesa incumplida no es éxito')
  assert.equal(u({}, { meta: { ...meta, semaforo: 'rojo' }, puntaje: { valor: 9, dia: HOY } }).etapa, 'lanzado')
  assert.equal(u({ diasParaVencer: 10 }, { meta, puntaje: { valor: 9, dia: HOY } }).etapa, 'renovacion')
})

test('ClickUp solo de respaldo: gana el Despacho si está igual o más adelante, y ClickUp si está más adelante', () => {
  assert.equal(u({}, { clickup: { estado: 'grabación', actualizada: HOY } }).fuente, 'clickup')
  const r = u({}, { kickoff: { fecha: HOY, frenos: 0, ideas: '' }, clickup: { estado: 'onboarding', actualizada: HOY } })
  assert.equal(r.etapa, 'kickoff'); assert.equal(r.fuente, 'despacho')
  assert.equal(u({}, { kickoff: { fecha: HOY, frenos: 0, ideas: '' }, clickup: { estado: 'edición', actualizada: HOY } }).etapa, 'edicion')
  assert.equal(u({}, { clickup: { estado: 'final del servicio', actualizada: HOY } }).etapa, 'alta', 'la baja la decide el CRM')
})

test('ClickUp dice campaña pero Meta respondió sin anuncios: lanzado con alerta', () => {
  const r = u({ dia1: '2026-05-01' }, { clickup: { estado: 'verde', actualizada: '2026-10-01' } })
  assert.equal(r.etapa, 'lanzado'); assert.ok(r.alertas.includes('Sin anuncios activos')); assert.ok(r.frenado)
  const sinMeta = u({ dia1: '2026-05-01' }, { clickup: { estado: 'verde', actualizada: '2026-10-01' } }, { ...LEE, meta: false })
  assert.equal(sinMeta.etapa, 'lanzado'); assert.equal(sinMeta.alertas.length, 0)
})

test('lanzó antes y hoy no corre nada: lanzado con alerta, salvo que haya producción nueva', () => {
  const meta = { activa: false, ultimoLanzamiento: '2026-07-01', semaforo: null }
  assert.equal(u({ dia1: '2026-03-01' }, { meta }).etapa, 'lanzado')
  assert.equal(u({ dia1: '2026-03-01' }, { meta, tanda: { tanda: 3, estado: 'escribiendo', actualizado: HOY, guiones: 0 } }).etapa, 'guiones')
})

test('frenado: 7 días o más en producción, o alguna alerta', () => {
  const r = u({}, { tanda: { tanda: 1, estado: 'con_notas', actualizado: '2026-10-15', guiones: 6 } })
  assert.equal(r.diasEtapa, 10); assert.ok(r.frenado); assert.equal(r.alertas[0], '10 días sin moverse')
  assert.ok(!u({}, { tanda: { tanda: 1, estado: 'con_notas', actualizado: '2026-10-20', guiones: 6 } }).frenado)
  assert.ok(!u({}, { meta: { activa: true, ultimoLanzamiento: '2026-01-01', semaforo: 'verde' } }).frenado, 'lanzado hace mucho no es frenado')
  assert.ok(u({}, { meta: { activa: true, ultimoLanzamiento: '2026-09-01', semaforo: 'verde' }, puntaje: { valor: 4, dia: HOY } }).frenado)
})

test('filtros: closer, antigüedad, frenados, vencen y búsqueda sin tildes', () => {
  const fila = (id, o) => ({ id, nombre: `Cliente ${id}`, closer: 'Gero', ...R.ubicarCliente(cli({ id }), nada(), HOY, LEE), ...o })
  const filas = [fila('A1', { closer: 'Fer', diasCliente: 10 }), fila('A2', { frenado: true, diasCliente: 50 }), fila('A3', { nombre: 'Estudio Muñoz', venceEn: 5, diasCliente: 200 })]
  const F = R.FILTROS_RECORRIDO_INICIALES
  assert.deepEqual(R.filtrarRecorrido(filas, { ...F, closer: 'Fer' }).map(x => x.id), ['A1'])
  assert.deepEqual(R.filtrarRecorrido(filas, { ...F, antiguedad: 'medio' }).map(x => x.id), ['A2'])
  assert.deepEqual(R.filtrarRecorrido(filas, { ...F, frenados: true }).map(x => x.id), ['A2'])
  assert.deepEqual(R.filtrarRecorrido(filas, { ...F, vencen: true }).map(x => x.id), ['A3'])
  assert.deepEqual(R.filtrarRecorrido(filas, { ...F, texto: 'munoz' }).map(x => x.id), ['A3'])
  const g = R.agruparPorEtapa(filas)
  assert.equal(g.get('alta').length, 3); assert.equal(g.get('alta')[0].id, 'A2', 'el frenado va primero')
})

test('lanzó y pausó: la ficha de kickoff de antes del lanzamiento no lo devuelve a Kickoff', () => {
  const meta = { activa: false, ultimoLanzamiento: '2026-07-01', semaforo: null }
  const r = u({ dia1: '2026-05-01' }, { meta, kickoff: { fecha: '2026-06-10', frenos: 0, ideas: '' } })
  assert.equal(r.etapa, 'lanzado'); assert.ok(r.alertas.includes('Sin anuncios activos'))
  assert.equal(u({ dia1: '2026-05-01' }, { meta, kickoff: { fecha: '2026-10-20', frenos: 0, ideas: '' } }).etapa, 'kickoff', 'una ficha nueva sí')
})

test('pausa y baja nunca cuentan como frenadas; tanda pendiente tiene texto', () => {
  assert.ok(!u({ estado: 'FINALIZADO' }, { puntaje: { valor: 3, dia: HOY } }).frenado)
  assert.match(u({}, { tanda: { tanda: 1, estado: 'pendiente', actualizado: HOY, guiones: 0 } }).detalle, /por arrancar/)
})

test('sin Meta, Por lanzar no se marca frenado por días', () => {
  const f = { videos: vid({ aprobados: 3, ultimoAprobado: '2026-10-01' }) }
  assert.ok(u({}, f).frenado)
  assert.ok(!u({}, f, { ...LEE, meta: false }).frenado)
})

test('eje de tiempo: tramos de 30 días de 0 a 4 meses, más de 4 y sin fecha', () => {
  assert.equal(R.tramoDe(0), 'm0'); assert.equal(R.tramoDe(30), 'm0'); assert.equal(R.tramoDe(31), 'm1')
  assert.equal(R.tramoDe(120), 'm3'); assert.equal(R.tramoDe(121), 'm4'); assert.equal(R.tramoDe(400), 'm4'); assert.equal(R.tramoDe(null), 'sin_fecha')
  assert.equal(R.posicionEnEje(75), 0.5); assert.equal(R.posicionEnEje(900), 1); assert.equal(R.posicionEnEje(-3), 0)
  const fila = (id, d) => ({ id, nombre: id, closer: '', ...R.ubicarCliente(cli({ id }), nada(), HOY, LEE), diasCliente: d })
  const g = R.agruparPorTramo([fila('B', 50), fila('A', 40), fila('C', null), fila('D', 200)])
  assert.deepEqual(g.get('m1').map(x => x.id), ['A', 'B']); assert.equal(g.get('sin_fecha').length, 1); assert.equal(g.get('m4').length, 1)
})

const H = await import('../lib/clientes/hitos.ts')
const ev = (o = {}) => ({ dia1: '2026-09-01', renovo: 'NO', inicioPeriodo2: null, kickoff: null, tanda: null, videos: null, drive: null, clickupGuiones: null, lanzamiento: null, campanaActiva: false, exito: null, manuales: [], ...o })
const hito = (hs, k) => hs.find(h => h.clave === k)

test('hitos: Drive con crudos y Meta lanzado completan el registro sin Fathom (infiere kickoff y guiones)', () => {
  const hs = H.hitosDelCliente(ev({ drive: { guion: '2026-09-10', guionCreado: '2026-09-08', crudos: '2026-09-20', editados: null }, lanzamiento: '2026-10-01', campanaActiva: true }))
  assert.equal(hito(hs, 'guiones').fecha, '2026-09-10'); assert.equal(hito(hs, 'guiones').fuente, 'drive')
  assert.equal(hito(hs, 'grabacion').fecha, '2026-09-20')
  assert.equal(hito(hs, 'kickoff').hecho, true); assert.equal(hito(hs, 'kickoff').fuente, 'inferido')
  assert.equal(hito(hs, 'edicion').fuente, 'inferido', 'lanzó: la edición se da por hecha')
  assert.equal(hito(hs, 'exito').hecho, false)
  assert.equal(H.etapaPorHitos(hs).etapa, 'lanzado')
})

test('hitos: lo anotado a mano manda y la etapa sale del último hito', () => {
  const hs = H.hitosDelCliente(ev({ drive: { guion: '2026-09-10', guionCreado: '2026-09-01', crudos: null, editados: null }, manuales: [{ hito: 'grabacion', fecha: '2026-10-05', nota: 'grabó 6', quien: 'Tomás', cuando: '' }] }))
  assert.equal(hito(hs, 'grabacion').fuente, 'manual'); assert.equal(hito(hs, 'grabacion').fecha, '2026-10-05')
  assert.equal(H.etapaPorHitos(hs).etapa, 'edicion')
  assert.equal(H.etapaPorHitos(H.hitosDelCliente(ev())), null, 'solo el alta: sin etapa por hitos')
})

test('ubicar: Drive con guiones y sin Fathom lo saca de Alta; Meta activa manda', () => {
  // El doc creado y no tocado (plantilla del alta) no cuenta; editado días después, sí
  assert.equal(H.etapaPorHitos(H.hitosDelCliente(ev({ drive: { guion: '2026-10-10', guionCreado: '2026-10-10', crudos: null, editados: null } }))), null)
  const hs = H.hitosDelCliente(ev({ drive: { guion: '2026-10-14', guionCreado: '2026-10-10', crudos: null, editados: null } }))
  const r = R.ubicarCliente(cli({ dia1: '2026-09-01' }), nada({ hitos: hs }), HOY, LEE)
  assert.equal(r.etapa, 'grabacion'); assert.equal(r.fuente, 'drive')
  const exito = H.hitosDelCliente(ev({ manuales: [{ hito: 'exito', fecha: '2026-10-20', nota: '', quien: 'Tomás', cuando: '' }] }))
  assert.equal(R.ubicarCliente(cli(), nada({ hitos: exito, meta: { activa: true, ultimoLanzamiento: '2026-10-01', semaforo: 'amarillo' } }), HOY, LEE).etapa, 'exito', 'éxito anotado a mano')
})

test('pedido de hito: valida hito, fecha y futuro', async () => {
  const { leerPedidoHito } = await import('../lib/clientes/hitosRegistro.ts')
  assert.equal(typeof leerPedidoHito({ hito: 'nada' }, HOY), 'string')
  assert.equal(typeof leerPedidoHito({ hito: 'kickoff', fecha: '2026-12-01' }, HOY), 'string')
  assert.deepEqual(leerPedidoHito({ hito: 'kickoff', fecha: '2026-10-01', nota: '  hola  ' }, HOY), { hito: 'kickoff', fecha: '2026-10-01', nota: 'hola', borrar: false })
  assert.deepEqual(leerPedidoHito({ hito: 'exito', borrar: true }, HOY), { hito: 'exito', fecha: null, nota: '', borrar: true })
})

test('regresiones de la revisión: tanda a revisar sigue en Guiones; éxito o renovación no empujan hacia adelante', () => {
  // Tanda «a revisar» del mismo día: todavía no son guiones hechos (creado = null: ninguna aprobada ni enviada)
  const tanda = { tanda: 1, estado: 'a_revisar', actualizado: HOY, guiones: 6, creado: null, aprobada: null, enviada: null }
  const hs = H.hitosDelCliente(ev({ tanda: { creado: null, estado: 'a_revisar', aprobada: null, enviada: null } }))
  assert.equal(R.ubicarCliente(cli(), nada({ tanda, hitos: hs }), HOY, LEE).etapa, 'guiones')
  // Un 9 en Seguimiento con la tanda escribiendo: no se infiere edición ni lanzamiento
  const conExito = H.hitosDelCliente(ev({ exito: '2026-10-20' }))
  assert.equal(hito(conExito, 'edicion').hecho, false); assert.equal(hito(conExito, 'lanzamiento').hecho, false)
  const escribiendo = { ...tanda, estado: 'escribiendo' }
  assert.equal(R.ubicarCliente(cli(), nada({ tanda: escribiendo, hitos: conExito }), HOY, LEE).etapa, 'guiones')
  // Renovó (R1) con la tanda 2 en curso: sigue en Guiones
  assert.equal(R.ubicarCliente(cli(), nada({ tanda: escribiendo, hitos: H.hitosDelCliente(ev({ renovo: 'R1' })) }), HOY, LEE).etapa, 'guiones')
  // La revisión es la primera nota del cliente, no la aprobación interna
  const rev = H.hitosDelCliente(ev({ tanda: { creado: '2026-10-05', estado: 'con_notas', aprobada: '2026-10-06', enviada: null, notaCliente: '2026-10-09' } }))
  assert.equal(hito(rev, 'revision').fecha, '2026-10-09')
  assert.equal(hito(H.hitosDelCliente(ev({ tanda: { creado: '2026-10-05', estado: 'aprobada', aprobada: '2026-10-06', enviada: null } })), 'revision').hecho, false)
})

test('pedido de hito: una fecha que no existe es 400 (no llega a la base)', async () => {
  const { leerPedidoHito } = await import('../lib/clientes/hitosRegistro.ts')
  assert.equal(typeof leerPedidoHito({ hito: 'kickoff', fecha: '2026-02-31' }, HOY), 'string')
  assert.equal(typeof leerPedidoHito({ hito: 'kickoff', fecha: '2026-02-28' }, HOY), 'object')
})

test('corregir etapa: manda sobre la automática (salvo Pausa y Baja) y guarda cuál era la automática', async () => {
  const manual = { etapa: 'edicion', nota: 'ya grabó', quien: 'Tomás', cuando: '2026-10-24T12:00:00.000Z' }
  const r = u({}, { etapaManual: manual })
  assert.equal(r.etapa, 'edicion'); assert.equal(r.fuente, 'manual'); assert.equal(r.automatica, 'alta'); assert.equal(r.desde, '2026-10-24')
  assert.match(r.detalle, /Corregida a mano por Tomás · «ya grabó»/)
  assert.equal(u({ estado: 'PAUSADO' }, { etapaManual: manual }).etapa, 'pausa', 'la pausa la decide el CRM')
  assert.equal(u({}, { etapaManual: { ...manual, etapa: 'alta' } }).automatica, undefined, 'si coincide, no hay "automática" distinta')
  const { leerPedidoEtapa } = await import('../lib/clientes/hitosRegistro.ts')
  assert.deepEqual(leerPedidoEtapa({ etapa: 'lanzado', nota: ' x ' }), { etapa: 'lanzado', nota: 'x' })
  assert.deepEqual(leerPedidoEtapa({ etapa: null }), { etapa: null, nota: '' })
  assert.equal(typeof leerPedidoEtapa({ etapa: 'baja' }), 'string', 'Baja sale del CRM')
  assert.equal(typeof leerPedidoEtapa({}), 'string')
})

test('renovación: lanzó (aunque hoy sin anuncios) y vence en 30 días o menos, o ya venció', () => {
  const meta = { activa: false, ultimoLanzamiento: '2026-07-01', semaforo: null }
  assert.equal(u({ dia1: '2026-05-01', diasParaVencer: 12 }, { meta }).etapa, 'renovacion')
  assert.equal(u({ dia1: '2026-05-01', diasParaVencer: -3 }, { meta }).etapa, 'renovacion')
  assert.equal(u({ dia1: '2026-05-01', diasParaVencer: 45 }, { meta }).etapa, 'lanzado')
  assert.equal(u({ dia1: '2026-10-01', diasParaVencer: 10 }, { tanda: { tanda: 1, estado: 'escribiendo', actualizado: HOY, guiones: 0 } }).etapa, 'guiones', 'en producción no pasa a renovación')
})

test('montos solo con Finanzas en la cartera (guarda del código fuente)', async () => {
  const { readFileSync } = await import('node:fs')
  const pagina = readFileSync(new URL('../app/(shell)/clientes/(cartera)/page.tsx', import.meta.url), 'utf8')
  assert.match(pagina, /const verCobros = puedeVer\(sesion, 'finanzas'\)/)
  assert.match(pagina, /\.\.\.\(!verCobros \? \[\] : \[\{ etiqueta: 'A cobrar \(USD\)'/)
  const enVivo = readFileSync(new URL('../app/(shell)/clientes/(cartera)/_componentes/EnVivo.tsx', import.meta.url), 'utf8')
  assert.match(enVivo, /verCobros \? c\.filas : c\.filas\.map\(f => \(\{ \.\.\.f, contratado: null, cobrado: null, (?:cobrosAviso: null, )?saldo: null(?:, cobrosAviso: null)? \}\)\)/)
  const detalle = readFileSync(new URL('../app/(shell)/clientes/(cartera)/_componentes/DetalleCliente.tsx', import.meta.url), 'utf8')
  assert.match(detalle, /\{ver\.finanzas && <Periodos f=\{ficha\}[^\n]*?\/>\}/)
  assert.match(detalle, /\{ver\.finanzas && <Cobros f=\{ficha\}[^\n]*?\/>\}/)
})

test('éxito del bot (OK en Verificaciones): manda sobre el puntaje y lleva a Éxito con campaña activa', () => {
  const hs = H.hitosDelCliente(ev({ exito: '2026-10-01', exitoBot: { fecha: '2026-10-20', testimonio: '2026-10-22', por: 'Gero A' } }))
  assert.equal(hito(hs, 'exito').fuente, 'exito_bot'); assert.equal(hito(hs, 'exito').fecha, '2026-10-20')
  assert.match(hito(hs, 'exito').detalle, /OK de Gero A · testimonio recibido el 22\/10\/2026/)
  const meta = { activa: true, ultimoLanzamiento: '2026-09-01', semaforo: 'rojo' }
  assert.equal(R.ubicarCliente(cli(), nada({ meta, hitos: hs }), HOY, LEE).etapa, 'exito', 'el OK confirmado vale aunque el semáforo esté rojo')
})

test('corrección a mano: se vuelve a la automática si el registro avanzó después; Renovación le gana; marca corregida', () => {
  const corr = (etapa, cuando = '2026-10-10T15:00:00.000Z') => ({ etapa, nota: '', quien: 'Tomás', cuando })
  // Corregida a Guiones el 10/10 y después lanzó en Meta el 20/10: manda Meta
  const r = u({}, { etapaManual: corr('guiones'), meta: { activa: true, ultimoLanzamiento: '2026-10-20', semaforo: 'verde' } })
  assert.equal(r.etapa, 'lanzado'); assert.equal(r.corregida, undefined)
  // Corregida a Éxito y ahora vence en 10 días: Renovación
  assert.equal(u({ diasParaVencer: 10 }, { etapaManual: corr('exito'), meta: { activa: true, ultimoLanzamiento: '2026-08-01', semaforo: 'verde' } }).etapa, 'renovacion')
  // Sigue mandando si el registro no avanzó después
  const sigue = u({}, { etapaManual: corr('edicion') })
  assert.equal(sigue.etapa, 'edicion'); assert.equal(sigue.corregida, true)
  // Corrección después de las 21 h de Argentina: el día es el argentino
  assert.equal(u({}, { etapaManual: corr('edicion', '2026-10-11T01:30:00.000Z') }).desde, '2026-10-10')
})

test('renovación: sin anuncios y vencido hace más de 30 días queda en Lanzado con alerta', () => {
  const meta = { activa: false, ultimoLanzamiento: '2026-03-01', semaforo: null }
  const r = u({ dia1: '2026-01-01', diasParaVencer: -200 }, { meta })
  assert.equal(r.etapa, 'lanzado'); assert.ok(r.alertas.some(a => /revisar el estado en el CRM/.test(a)))
})

test('revisión profunda del Hub (26/10): hito anotado sin fecha, estado vacío, descontento, primeras fechas', () => {
  // 1. Anotado sin fecha: conserva la fecha automática y no hace retroceder al cliente
  const hs = H.hitosDelCliente(ev({ lanzamiento: '2026-10-01', manuales: [{ hito: 'lanzamiento', fecha: null, nota: '', quien: 'Tomás', cuando: '2026-10-20T12:00:00.000Z' }] }))
  assert.equal(hito(hs, 'lanzamiento').fecha, '2026-10-01'); assert.equal(hito(hs, 'lanzamiento').fuente, 'manual')
  const enCursoViejo = { tanda: 1, estado: 'escribiendo', actualizado: '2026-10-05', guiones: 0 }
  assert.equal(R.ubicarCliente(cli({ dia1: '2026-08-01' }), nada({ tanda: enCursoViejo, hitos: hs }), HOY, { ...LEE, meta: false }).etapa, 'lanzado', 'lo en curso anterior a la anotación no le gana')
  // 7. Estado vacío en el CRM: Sin dato
  assert.equal(u({ estado: '' }, { meta: { activa: true, ultimoLanzamiento: '2026-09-01', semaforo: 'verde' } }).etapa, 'sin_dato')
  // 8. Descontento con la misma regla que "contento" (sin puntaje usa la satisfacción del CRM)
  assert.ok(u({ satisfaccion: 2 }).alertas.includes('Descontento (2/10)'))
  // 5. Guiones hechos: la primera aprobación/envío/nota, no la creación
  const g = H.hitosDelCliente(ev({ tanda: { creado: '2026-10-01', estado: 'enviada', aprobada: '2026-10-04', enviada: '2026-10-05', notaCliente: null } }))
  assert.equal(hito(g, 'guiones').fecha, '2026-10-04')
  // 4. Registro histórico: el primer crudo entre Despacho y Drive
  const c = H.hitosDelCliente(ev({ videos: { crudos: '2026-10-12', editados: null }, drive: { guion: null, guionCreado: null, crudos: '2026-10-08', editados: null } }))
  assert.equal(hito(c, 'grabacion').fecha, '2026-10-08')
})

test('seguimiento: el último puntaje se ordena por día, no por el texto crudo de la fecha', async () => {
  const M = await import('../lib/seguimiento/modelo.ts')
  const p = (fecha, dia, valor) => ({ fecha, dia, mes: dia.slice(0, 7), idCliente: 'A001', valor, fuente: 'manual', nota: '', quien: '' })
  const e = M.estadoPorCliente([p('5/9/2026', '2026-09-05', 3), p('2026-10-20 10:00', '2026-10-20', 9)], HOY).get('A001')
  assert.equal(e.ultimo.valor, 9)
})

test('ocultar montos (v8): el botón solo con Finanzas y las cifras envueltas en <Monto> (guarda del código fuente)', async () => {
  const { readFileSync } = await import('node:fs')
  const pagina = readFileSync(new URL('../app/(shell)/clientes/(cartera)/page.tsx', import.meta.url), 'utf8')
  assert.match(pagina, /\{verCobros && <BotonMontos \/>\}/)
  assert.match(pagina, /valor: (?:cobrosPorVerificar \? '—' : )?<Monto>\{numeroAR\(ind\.aCobrarUSD\)\}<\/Monto>/)
  const lista = readFileSync(new URL('../app/(shell)/clientes/(cartera)/_componentes/ListaClientes.tsx', import.meta.url), 'utf8')
  assert.match(lista, /<Monto>\{f\.cobrado === null/)
  assert.match(lista, /saldo <Monto>\{numeroAR\(f\.saldo\)\}<\/Monto>/)
  const boton = readFileSync(new URL('../components/clientes/BotonMontos.tsx', import.meta.url), 'utf8')
  assert.match(boton, /try \{ return localStorage\.getItem\(CLAVE\) === '1' \} catch \{ return false \}/, 'localStorage en try/catch y visibles por defecto')
  const css = readFileSync(new URL('../components/clientes/montos.css', import.meta.url), 'utf8')
  assert.match(css, /\.cj-boton-montos/, 'el control de montos conserva su estilo compartido')
  assert.match(boton, /CSS_OCULTOS = '\.cj-monto,\.cj-monto \*\{color:transparent!important/)
})
