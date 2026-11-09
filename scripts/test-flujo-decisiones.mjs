// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-flujo-decisiones.mjs
// Decisiones de Tomás del 2/11/2026 sobre el flujo guiones → grabación (todo de juguete, SIN red ni base):
//   1. un solo «para enviar» con el link de los guiones y el pedido de grabar (el día 0 de e01 ya no sale aparte);
//   2. los días 2 y 4 siguen siendo de Gero M;
//   3. el aviso de 48 h sin «Enviado» menciona a Tomás, Gero M y Aylu;
//   4. si falla la carga de la tanda en el Doc, alerta en #🧰-sistema-bot a Gero M y Aylu con el link para reintentar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textoGuionesParaGrabar, urlTanda } from '../lib/bot/guiones/envio.ts'
import { textoD02Unificado } from '../lib/bot/guiones/whatsappCliente.ts'
import { paraEnviarE01 } from '../lib/bot/grabacion/e01Whatsapp.ts'
import { RESPONSABLE } from '../lib/bot/grabacion/seguimiento.ts'
import { MENCIONES_ATRASADO } from '../lib/bot/canal/salidaCliente.ts'
import { responsablesDe } from '../lib/alertas/personas.ts'
import { alertaFallaPublicacion, alertaChipsSinMarcar, publicarParaEntrega } from '../lib/bot/guiones/publicacion.ts'

const URL = 'https://docs.google.com/document/d/doc_de_prueba_123/edit'
const fila = (x = {}) => ({ id: 7, id_crm: 'Z001', cliente: 'Lucía Benítez', estado: 'aprobada', tanda: 1, doc: { id: 'doc_de_prueba_123', url: URL, tanda: 3 },
  guiones: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }, notas: [], aprobacion: { quien: 'Faus', cuando: '2026-11-02T12:00:00Z' }, actualizado: '2026-11-02T12:01:00Z', ...x })

test('1 · el texto unificado lleva el link, la tanda del Doc y el pedido de grabar con la fecha sugerida', () => {
  // lunes 2/11/2026 12 h de Argentina → dos días hábiles después: miércoles 4/11
  const t = textoD02Unificado(fila(), new Date('2026-11-02T15:00:00Z'))
  assert.match(t, /^¡Hola Lucía!/)
  assert.ok(t.includes(URL)); assert.match(t, /Tanda 3/); assert.match(t, /6 guiones nuevos/)
  assert.match(t, /¿Te queda bien grabarlos para el miércoles 4\/11\?/)
  assert.match(t, /carpeta de Crudos/)
})
test('1 · texto exacto de Tomás (9/11), con la tanda, el link y la fecha', () => {
  const t = textoGuionesParaGrabar(fila(), URL, 'el jueves 5/11')
  assert.equal(t, `¡Hola Lucía! Ya están los 6 guiones nuevos. Los dejé en tu documento de guiones, en la Tanda 3: ${URL}\n`
    + 'Leelos y comentanos si necesitan alguna modificación. Cuando estén ok, grabalos siguiendo las indicaciones.\n'
    + '¿Te queda bien grabarlos para el jueves 5/11? Cuando los subas a tu carpeta de Crudos, avisanos por acá y arrancamos con la edición.')
  assert.equal(textoGuionesParaGrabar(fila({ notas: [{ aplicada: true }] }), URL, 'el jueves 5/11'), t, 'el mismo texto en la 2.ª ronda')
})
test('1 · el link va directo a la tanda cuando el puente devuelve el ancla', () => {
  assert.equal(urlTanda('DOC1', { tab: 't.0', heading: 'h.abc123' }), 'https://docs.google.com/document/d/DOC1/edit?tab=t.0#heading=h.abc123')
  assert.equal(urlTanda('DOC1', { tab: null, heading: 'h.abc123' }), 'https://docs.google.com/document/d/DOC1/edit#heading=h.abc123')
  assert.equal(urlTanda('DOC1', null), 'https://docs.google.com/document/d/DOC1/edit')
  assert.equal(urlTanda('DOC1', { tab: 't.0', heading: 'javascript:x' }), 'https://docs.google.com/document/d/DOC1/edit')
})
test('1 · el «para enviar» unificado menciona a Aylu y Gero M', () => {
  assert.deepEqual(responsablesDe('d02', {}), ['aylu', 'gero_m'])
})

const HOY = '2026-11-02'
const paso = (x = {}) => ({ id: 11, id_crm: 'Z001', cliente: 'Lucía Benítez', ciclo: HOY, motivo: 'para_grabar', escalon: 'dia0', debido: HOY, dias_habiles: 0,
  responsable: 'aylu', videos: [1, 2], texto: '', hecho: null, decision: null, estado: 'abierto', frenado: null, version: 1, ...x })
const depsE01 = (pasos, d02) => {
  const log = []
  return { log, deps: {
    pasosAbiertos: async () => pasos, docs: async () => new Map([['Z001', 'doc_de_prueba_123']]), vigente: async () => true,
    paraEnviar: async (p) => { log.push(`para-enviar ${p.escalon}`); return true },
    d02DelCiclo: async (p) => { log.push(`d02? ${p.escalon}`); return d02 },
    cumplirDia0: async (p) => { log.push(`día 0 hecho ${p.id}`) },
    env: {}, esHabil: () => true,
  } }
}
const correr = (d) => paraEnviarE01(d, { ahora: new Date('2026-11-02T15:00:00Z'), modo: 'real', deadline: Date.now() + 60_000 })

test('1 · con el mensaje de guiones pendiente, el día 0 NO sale aparte (espera al «Enviado»)', async () => {
  const a = depsE01([paso()], 'pendiente'); const r = await correr(a.deps)
  assert.deepEqual(a.log, ['d02? dia0']); assert.equal(r.registrados, 0); assert.equal(r.conGuiones, 1)
})
test('1 · con el mensaje de guiones ya enviado, el día 0 queda hecho sin otro mensaje', async () => {
  const a = depsE01([paso()], 'enviado'); await correr(a.deps)
  assert.deepEqual(a.log, ['d02? dia0', 'día 0 hecho 11'])
})
test('1 · sin mensaje de guiones (chips cambiados a mano), el día 0 sale como antes', async () => {
  const a = depsE01([paso()], null); const r = await correr(a.deps)
  assert.deepEqual(a.log, ['d02? dia0', 'para-enviar dia0']); assert.equal(r.registrados, 1)
})
test('1 · los recordatorios no se tocan: salen aunque haya mensaje de guiones', async () => {
  const a = depsE01([paso({ escalon: 'r1', responsable: 'aylu' })], 'enviado'); await correr(a.deps)
  assert.deepEqual(a.log, ['para-enviar r1'])
})
test('2 · el seguimiento de los días 2 y 4 sigue siendo de Gero M', () => {
  assert.equal(RESPONSABLE.dia2, 'gero_m'); assert.equal(RESPONSABLE.dia4, 'gero_m')
})
test('3 · el aviso de 48 h sin «Enviado» menciona a Tomás, Gero M y Aylu', () => {
  assert.deepEqual([...MENCIONES_ATRASADO].sort(), ['aylu', 'gero_m', 'tomas'])
})

test('4 · la alerta de la carga fallida: 🧰-sistema-bot, Gero M y Aylu, cliente, tanda y link para reintentar', () => {
  const a = alertaFallaPublicacion({ ...fila(), tanda: 3 }, 'El puente de Drive no respondió', false)
  assert.equal(a.canal, 'sistema'); assert.deepEqual(a.menciones, ['gero_m', 'aylu'])
  assert.equal(a.cliente, 'Lucía Benítez'); assert.equal(a.idCrm, 'Z001'); assert.equal(a.link, '/guiones/Z001')
  assert.ok(a.lineas.some(l => /Tanda 3/.test(l))); assert.ok(a.lineas.some(l => /Revisar publicación y aviso/.test(l)))
  assert.equal(a.clave, 'guiones_publicacion:7:2026-11-02T12:00:00Z')
  const d = alertaFallaPublicacion({ id: 9 }, 'x', true)
  assert.match(d.titulo, /DUDOSA/); assert.equal(d.link, '/guiones')
  const c = alertaChipsSinMarcar({ ...fila(), tanda: 3 }, 'API caída')
  assert.equal(c.canal, 'sistema'); assert.deepEqual(c.menciones, ['gero_m', 'aylu'])
})

const publicador = (o = {}) => {
  const log = [], alertas = []; let actual = fila({ doc: null })
  return { log, alertas, deps: {
    reservar: async () => true, leer: async () => actual,
    resolver: async () => ({ id: 'doc_de_prueba_123', url: 'x' }),
    escribir: async () => ({ estado: 'ok', id: 'doc_de_prueba_123', tanda: 3 }),
    guardar: async (_i, doc) => { actual = { ...actual, doc } }, notificar: async () => { log.push('notificar') },
    error: async (_i, _m, dudoso) => log.push(dudoso ? 'dudoso' : 'error'), alertar: async a => { alertas.push(a) }, ...o,
  } }
}
test('4 · si el puente de Drive falla al cargar la tanda, sale la alerta (y no queda silencioso)', async () => {
  const a = publicador({ escribir: async () => ({ estado: 'error', motivo: 'agregarTanda: el puente devolvió 500' }) })
  await publicarParaEntrega(7, Date.now() + 1000, a.deps)
  assert.deepEqual(a.log, ['error']); assert.equal(a.alertas.length, 1)
  assert.equal(a.alertas[0].canal, 'sistema'); assert.match(a.alertas[0].lineas[1], /agregarTanda/)
  const b = publicador({ escribir: async () => { throw new Error('timeout') } })
  await publicarParaEntrega(7, Date.now() + 1000, b.deps); assert.equal(b.alertas.length, 1)
  const c = publicador({ escribir: async () => ({ estado: 'dudoso', motivo: 'sin respuesta' }) })
  await publicarParaEntrega(7, Date.now() + 1000, c.deps); assert.match(c.alertas[0].titulo, /DUDOSA/)
})
test('4 · los chips que no pasan a «Para grabar» también avisan; una publicación sana no avisa', async () => {
  const a = publicador({ marcarChips: async () => ({ estado: 'error', motivo: 'API caída' }) })
  await publicarParaEntrega(7, Date.now() + 1000, a.deps)
  assert.deepEqual(a.log, ['notificar']); assert.equal(a.alertas.length, 1); assert.equal(a.alertas[0].tipo, 'guiones_chips_falla')
  const b = publicador(); await publicarParaEntrega(7, Date.now() + 1000, b.deps); assert.equal(b.alertas.length, 0)
})
test('4 · un cliente archivado no es una falla de la carga: no avisa', async () => {
  const err = Object.assign(new Error('archivado'), { code: 'CLIENTE_ARCHIVADO' })
  const a = publicador({ exigirActivo: async () => { throw err } })
  await publicarParaEntrega(7, 1, a.deps); assert.equal(a.alertas.length, 0)
})
