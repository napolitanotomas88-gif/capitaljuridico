// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-e01-whatsapp.mjs
// e01 por WhatsApp (lib/bot/grabacion/e01Whatsapp.ts): apagado por defecto y con fecha de activación, horario y día hábil, qué
// escalones salen, el grupo por palabras enteras, la verificación justo antes, reclamar → mandar → confirmar, fallas seguras y
// dudosas, colgados y la pantalla de pendientes. Whapi y la base son de juguete: SIN red. Todo inventado.
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const W = await import('../lib/bot/grabacion/e01Whatsapp.ts')
const S = await import('../lib/edicion/db/seguimientos.ts')
const V = await import('../lib/edicion/vista.ts')

// 2026-10-27 es martes; 13:00 de Argentina = 16:00 UTC
const AHORA = new Date('2026-10-27T16:00:00Z')
const HOY = '2026-10-27'
const ENV = { E01_WHATSAPP: 'real', E01_WHATSAPP_DESDE: '2026-10-27' }
const CFG = W.configE01Whatsapp(ENV)
const habil = d => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
const paso = (x = {}) => ({ id: 1, id_crm: 'A1', cliente: 'Lucía Benítez', ciclo: HOY, motivo: 'para_grabar', escalon: 'dia0', debido: HOY, dias_habiles: 0,
  videos: [1, 2], responsable: 'aylu', texto: '', hecho: null, decision: null, estado: 'abierto', version: 3, frenado: null, ...x })
const GRUPOS = [{ id: '120363000000000001@g.us', nombre: 'Contenido - Lucía Benítez' }, { id: '120363000000000009@g.us', nombre: 'General - Lucía Benítez' }]

function juguete({ pasos = [paso()], env = ENV, grupos = GRUPOS, enviar = null, reclamar = true, vigente = true, colgados = [] } = {}) {
  const log = { enviados: [], reclamados: [], confirmados: [], soltados: [], anotados: [], lecturasGrupos: 0 }
  const deps = {
    pasosAbiertos: async () => pasos,
    docs: async () => new Map([['A1', 'DocGuiones000000000001']]),
    grupos: async () => { log.lecturasGrupos++; if (grupos instanceof Error) throw grupos; return grupos },
    vigente: async () => vigente,
    enviar: enviar ?? (async (chatId, texto) => { log.enviados.push({ chatId, texto }); return { id: 'MSG-1' } }),
    reclamar: async (id, version, texto) => { log.reclamados.push({ id, version, texto }); return reclamar },
    confirmar: async (id, nota) => { log.confirmados.push({ id, nota }) },
    soltar: async (id, motivo) => { log.soltados.push({ id, motivo }) },
    anotarNoSalio: async (id, version, motivo) => { log.anotados.push({ id, version, motivo }) },
    colgados: async () => colgados,
    env, esHabil: habil,
  }
  return { deps, log }
}
const correr = (deps, ahora = AHORA, modo = 'real') => W.enviarE01(deps, { ahora, modo, deadline: Date.now() + 600_000 })

test('apagado por defecto: sin E01_WHATSAPP=real o sin fecha de activación no lee ni manda nada', async () => {
  for (const env of [{}, { E01_WHATSAPP: '1', E01_WHATSAPP_DESDE: HOY }, { E01_WHATSAPP: 'real' }, { E01_WHATSAPP: 'real', E01_WHATSAPP_DESDE: 'mañana' }]) {
    const j = juguete({ env })
    const r = await correr(j.deps)
    assert.ok(r.apagado, JSON.stringify(env))
    assert.deepEqual(j.log.enviados, [])
    assert.equal(j.log.lecturasGrupos, 0)
  }
  assert.match((await correr(juguete().deps, AHORA, 'dry')).apagado, /modo real/)
})

test('solo en día hábil y de 10 a 19 de Argentina', async () => {
  assert.match((await correr(juguete().deps, new Date('2026-10-25T16:00:00Z'))).apagado, /hábil/)        // domingo
  assert.match((await correr(juguete().deps, new Date('2026-10-27T12:30:00Z'))).apagado, /horario/)      // 9:30
  assert.match((await correr(juguete().deps, new Date('2026-10-27T22:00:00Z'))).apagado, /horario/)      // 19:00
})

test('día 0: reclama, manda el texto del día 0 al grupo Contenido y confirma con el id del mensaje', async () => {
  const j = juguete()
  const r = await correr(j.deps)
  assert.equal(r.enviados, 1)
  assert.equal(j.log.enviados[0].chatId, '120363000000000001@g.us')
  assert.match(j.log.enviados[0].texto, /Lucía/)
  assert.match(j.log.enviados[0].texto, /docs\.google\.com\/document\/d\/DocGuiones000000000001/)
  assert.deepEqual(j.log.reclamados.map(x => [x.id, x.version]), [[1, 3]])
  assert.equal(j.log.reclamados[0].texto, j.log.enviados[0].texto, 'se guarda el texto que salió')
  assert.match(j.log.confirmados[0].nota, /enviado por WhatsApp a «Contenido - Lucía Benítez» \(mensaje MSG-1\)/)
})

test('qué escalones salen: día 0 y recordatorios; nunca el audio, la llamada ni el día 9', () => {
  const pasos = ['dia0', 'dia2', 'dia4', 'dia9', 'r1'].map((e, i) => paso({ id: i + 1, id_crm: `C${i}`, escalon: e }))
  assert.deepEqual(W.elegibles(pasos, HOY, CFG).map(p => p.escalon), ['dia0', 'r1'])
  assert.deepEqual(W.elegibles(pasos, HOY, W.configE01Whatsapp({ ...ENV, E01_WHATSAPP_ESCALONES: 'recordatorio' })).map(p => p.escalon), ['r1'])
})

test('elegibles: sin hacer, sin freno, desde la fecha de activación, uno por cliente; lo anotado no se reintenta', () => {
  const cfg = W.configE01Whatsapp({ ...ENV, E01_WHATSAPP_DESDE: '2026-10-24' })
  const ps = [
    paso({ id: 1, hecho: { quien: 'Aylu', cuando: '', nota: '' } }),
    paso({ id: 2, id_crm: 'B', frenado: 'crudos_sin_ubicar' }),
    paso({ id: 3, id_crm: 'C', debido: '2026-10-28' }),
    paso({ id: 4, id_crm: 'D', debido: '2026-10-23' }),                 // antes de activarlo: lo manda Aylu
    paso({ id: 5, id_crm: 'E', texto: `${W.PREFIJO_NO_SALIO}: x` }),
    paso({ id: 6, id_crm: 'F', debido: '2026-10-26' }), paso({ id: 7, id_crm: 'F', escalon: 'r1' }),
    paso({ id: 8, id_crm: 'G', estado: 'resuelto' }),
  ]
  assert.deepEqual(W.elegibles(ps, HOY, cfg).map(p => p.id), [6])
  for (const k of ['PREFIJO_NO_SALIO', 'NOTA_ENVIANDO', 'QUIEN_BOT_WHATSAPP']) assert.equal(W[k], S[k], k)
})

test('el grupo: «Contenido - …» con todas las palabras ENTERAS («Ana» no es «Mariana»); si hay dos, ninguno', () => {
  const gs = [{ id: '1@g.us', nombre: 'Contenido - Mariana Ruiz' }, { id: '2@g.us', nombre: 'General - Ana Ruiz' }]
  assert.equal(W.grupoDe('Ana Ruiz', gs), null)
  assert.equal(W.grupoDe('Ana Ruiz', [...gs, { id: '3@g.us', nombre: 'Contenido - Ana Ruiz' }]).id, '3@g.us')
  assert.equal(W.grupoDe('Estudio Hammer', [{ id: '4@g.us', nombre: 'Contenido - Estudio Hammer' }, { id: '5@g.us', nombre: 'CONTENIDO - Estudio Hammer y Asoc.' }]), null)
  assert.equal(W.grupoDe('Lucía Benítez', [{ id: '6@g.us', nombre: 'Contenido - Lucia Benitez' }]).id, '6@g.us', 'sin acentos también')
  assert.equal(W.grupoDe('Lucía Benítez', [{ id: 'no-es-grupo', nombre: 'Contenido - Lucía Benítez' }]), null)
})

test('sin grupo: se anota «No salió» (para Aylu) y no tapa a los demás; los grupos se leen una vez por vuelta', async () => {
  const pasos = [paso({ id: 1, id_crm: 'X', cliente: 'Cliente Sin Grupo' }), paso({ id: 2 })]
  const j = juguete({ pasos })
  const r = await correr(j.deps)
  assert.deepEqual(r.sin_grupo, ['Cliente Sin Grupo'])
  assert.equal(j.log.anotados[0].id, 1)
  assert.equal(r.enviados, 1)
  assert.equal(j.log.lecturasGrupos, 1)
})

test('si ya no está vigente (subió crudos, lo graba el equipo) o alguien lo marcó recién, no manda', async () => {
  const j = juguete({ vigente: false })
  await correr(j.deps)
  assert.deepEqual(j.log.reclamados, [])
  const j2 = juguete({ reclamar: false })
  assert.equal((await correr(j2.deps)).enviados, 0)
  assert.deepEqual(j2.log.enviados, [])
})

test('si Whapi falla: rechazo seguro → se suelta; no se sabe (5xx/corte) → queda dudoso, NO se suelta', async () => {
  const j = juguete({ enviar: async () => { throw Object.assign(new Error('Whapi respondió 400'), { aplicado: false }) } })
  const r = await correr(j.deps)
  assert.equal(j.log.soltados.length, 1)
  assert.match(j.log.soltados[0].motivo, /Mandalo a mano/)
  assert.match(r.avisar[0], /no salió/)
  const j2 = juguete({ enviar: async () => { throw Object.assign(new Error('Whapi no respondió'), { aplicado: null }) } })
  const r2 = await correr(j2.deps)
  assert.deepEqual(j2.log.soltados, [])
  assert.match(j2.log.confirmados[0].nota, /^dudoso: /)
  assert.match(r2.avisar[0], /no se sabe si salió/)
  const j3 = juguete()
  j3.deps.confirmar = async () => { throw new Error('la base no respondió') }
  const r3 = await correr(j3.deps)
  assert.equal(r3.enviados, 1)
  assert.deepEqual(j3.log.soltados, [])
})

test('«enviando…» colgado: pasa a dudoso con un aviso; si no se pueden leer los grupos, no manda ni anota', async () => {
  const j = juguete({ colgados: [{ id: 9, cliente: 'Otro' }], pasos: [] })
  const r = await correr(j.deps)
  assert.match(j.log.confirmados[0].nota, /^dudoso/)
  assert.match(r.avisar[0], /Otro/)
  const j2 = juguete({ grupos: new Error('Whapi respondió 401') })
  const r2 = await correr(j2.deps)
  assert.equal(r2.errores.length, 1)
  assert.deepEqual(j2.log.anotados, [])
  assert.deepEqual(j2.log.reclamados, [])
})

test('pantalla de pendientes: lo que manda el bot no se ofrece para copiar; lo que no salió muestra el motivo', () => {
  const ps = [paso({ id: 1 }), paso({ id: 2, id_crm: 'B', cliente: 'Otro Cliente', texto: `${W.PREFIJO_NO_SALIO}: el bot no encontró un solo grupo` })]
  const v = V.armarPendientes(ps, 'aylu', { ahora: AHORA, loMandaElBot: p => W.loMandaElBot(p, CFG) })
  const filas = v.clientes.flatMap(c => c.pasos)
  assert.equal(filas.find(f => f.id === 1).bot, true)
  assert.equal(filas.find(f => f.id === 2).bot, false)
  assert.match(filas.find(f => f.id === 2).noSalio, /no encontró/)
  const apagado = V.armarPendientes(ps, 'aylu', { ahora: AHORA, loMandaElBot: p => W.loMandaElBot(p, W.configE01Whatsapp({})) })
  assert.ok(apagado.clientes.flatMap(c => c.pasos).every(f => !f.bot))
})
