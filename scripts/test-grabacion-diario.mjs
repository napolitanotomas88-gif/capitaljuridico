// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-diario.mjs
// El diario (lib/bot/grabacion/seguimiento.ts y diario.ts): días hábiles con feriados, los escalones de e01, recordatorios
// cada 4 días hábiles después de "seguir", cierre y cancelación del ciclo, freno por crudos sin ubicar, clientes que graba el
// equipo, regrabar con un ciclo abierto, importados desde la fecha de corte, videos trabados en horas hábiles, el resumen
// (una sola vez, solo martes a viernes y desde las 7:45) y las fases que retoma el vigía. SIN red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { repoMemoria, videoJuguete, RED_BLOQUEADA } from './edicion-juguetes.mjs'

globalThis.fetch = RED_BLOQUEADA
const S = await import('../lib/bot/grabacion/seguimiento.ts')
const D = await import('../lib/bot/grabacion/diario.ts')
const { esHabil } = await import('../lib/anuncios/feriados.ts')

const espera = (over = {}) => videoJuguete({ estado: 'esperando_crudos', estado_desde: '2026-10-16T15:00:00.000Z', ...over })
const paso = (over = {}) => ({ id: 1, id_crm: 'A101', cliente: 'Ana Pérez', ciclo: '2026-10-16', motivo: 'para_grabar', escalon: 'dia0', debido: '2026-10-16', dias_habiles: 0,
  videos: [1], responsable: 'aylu', texto: '', hecho: null, decision: null, estado: 'abierto', version: 1, ...over })

describe('días hábiles', () => {
  test('habilesEntre y sumarHabiles saltean fines de semana y feriados', () => {
    assert.equal(S.habilesEntre('2026-10-16', '2026-10-22', esHabil), 4)        // lun 19 a jue 22
    assert.equal(S.sumarHabiles('2026-10-16', 9, esHabil), '2026-10-29')
    assert.equal(S.sumarHabiles('2026-10-17', 0, esHabil), '2026-10-19', 'un sábado: el primer hábil')
    assert.equal(S.sumarHabiles('2026-11-20', 1, esHabil), '2026-11-24', 'el lunes 23/11 es feriado')
    assert.equal(S.habilesEntre('2026-10-09', '2026-10-13', esHabil), 1, 'el lunes 12/10 es feriado')
  })
})

describe('calcularE01', () => {
  const base = over => ({ videos: [espera()], pasos: [], hoy: '2026-10-22', esHabil, ...over })
  test('un ciclo nuevo crea los escalones vencidos: dia0 (Aylu), dia2 y dia4 (Gero M); el texto queda vacío', () => {
    const r = S.calcularE01(base())
    assert.deepEqual(r.nuevos.map(p => [p.escalon, p.debido, p.responsable, p.dias_habiles]), [
      ['dia0', '2026-10-16', 'aylu', 0], ['dia2', '2026-10-20', 'gero_m', 2], ['dia4', '2026-10-22', 'gero_m', 4]])
    assert.ok(r.nuevos.every(p => p.texto === '' && p.ciclo === '2026-10-16' && p.motivo === 'para_grabar'))
  })
  test('el día 9 es de Tomás; si decide "seguir", recordatorio cada 4 días hábiles desde la decisión', () => {
    const pasos = ['dia0', 'dia2', 'dia4'].map((e, i) => paso({ id: i + 1, escalon: e }))
    const r9 = S.calcularE01(base({ pasos, hoy: '2026-10-29' }))
    assert.deepEqual(r9.nuevos.map(p => [p.escalon, p.responsable]), [['dia9', 'tomas']])
    const conDecision = [...pasos, paso({ id: 9, escalon: 'dia9', debido: '2026-10-29', decision: 'seguir', decidido: { quien: 'Tomás', cuando: '2026-10-29T15:00:00.000Z' } })]
    assert.deepEqual(S.calcularE01(base({ pasos: conDecision, hoy: '2026-11-03' })).nuevos, [])
    const r = S.calcularE01(base({ pasos: conDecision, hoy: '2026-11-04' }))
    assert.deepEqual(r.nuevos.map(p => [p.escalon, p.debido, p.responsable]), [['r1', '2026-11-04', 'aylu']])
    const r2 = S.calcularE01(base({ pasos: [...conDecision, paso({ id: 10, escalon: 'r1', debido: '2026-11-04' })], hoy: '2026-11-11' }))
    assert.deepEqual(r2.nuevos.map(p => [p.escalon, p.debido]), [['r2', '2026-11-10']], 'ocho hábiles desde el 29/10: el 10/11')
  })
  test('se cierra cuando ningún video del ciclo espera crudos (resuelto) o si quedaron pausados (cancelado)', () => {
    const pasos = [paso()]
    assert.deepEqual(S.calcularE01(base({ videos: [espera({ estado: 'crudo_a_revisar' })], pasos })).cerrar, [{ id_crm: 'A101', ciclo: '2026-10-16', estado: 'resuelto' }])
    assert.deepEqual(S.calcularE01(base({ videos: [espera({ estado: 'pausado' })], pasos })).cerrar, [{ id_crm: 'A101', ciclo: '2026-10-16', estado: 'cancelado' }])
  })
  test('freno: crudos del cliente sin ubicar después del inicio → no avanza; el paso queda para Aylu ("ubicar crudos")', () => {
    const pasos = [paso()]
    const r = S.calcularE01(base({ pasos, sinUbicar: [{ id_crm: 'A101', creado: '2026-10-19T14:00:00.000Z', subio: 'cliente' }] }))
    assert.deepEqual(r.nuevos, [])
    assert.deepEqual(r.actualizar, [{ id: 1, videos: [1], frenado: 'crudos_sin_ubicar' }])
    const sinPasos = S.calcularE01(base({ sinUbicar: [{ id_crm: 'A101', creado: '2026-10-19T14:00:00.000Z', subio: 'cliente' }] }))
    assert.deepEqual(sinPasos.nuevos.map(p => [p.escalon, p.responsable, p.frenado]), [['dia0', 'aylu', 'crudos_sin_ubicar']])
    const delEquipo = S.calcularE01(base({ pasos, sinUbicar: [{ id_crm: 'A101', creado: '2026-10-19T14:00:00.000Z', subio: 'equipo' }] }))
    assert.equal(delEquipo.nuevos.length, 2, 'lo que subió el equipo no frena')
    const destrabado = S.calcularE01(base({ pasos: [paso({ frenado: 'crudos_sin_ubicar' })] }))
    assert.deepEqual(destrabado.actualizar, [{ id: 1, videos: [1], frenado: null }])
  })
  test('clientes que graba el equipo: afuera (y un ciclo abierto se cancela)', () => {
    assert.deepEqual(S.calcularE01(base({ excluidos: new Set(['A101']) })).nuevos, [])
    assert.deepEqual(S.calcularE01(base({ excluidos: new Set(['A101']), pasos: [paso()] })).cerrar.map(c => c.estado), ['cancelado'])
  })
  test('un regrabar con el ciclo abierto suma el video sin reiniciar el escalón', () => {
    const pasos = [paso(), paso({ id: 2, escalon: 'dia2', debido: '2026-10-20' })]
    const r = S.calcularE01(base({ videos: [espera(), espera({ id: 5, motivo_regrabar: 'audio', estado_desde: '2026-10-21T15:00:00.000Z' })], pasos }))
    assert.deepEqual(r.nuevos.map(p => [p.escalon, p.ciclo, p.videos]), [['dia4', '2026-10-16', [1, 5]]])
    assert.ok(r.actualizar.every(a => a.videos.join() === '1,5'))
  })
  test('importados de ClickUp en espera arrancan en la fecha de corte; motivo según cómo entró', () => {
    const r = S.calcularE01(base({ videos: [espera({ origen: 'clickup', estado_desde: '2026-10-01T15:00:00.000Z' })], corte: '2026-10-20', hoy: '2026-10-20' }))
    assert.deepEqual(r.nuevos.map(p => [p.escalon, p.ciclo]), [['dia0', '2026-10-20']])
    assert.equal(S.motivoDe(espera({ origen: 'aylu' })), 'guiones_enviados')
    assert.equal(S.motivoDe(espera({ motivo_regrabar: 'duro' })), 'regrabar')
  })
  test('revisión: un ciclo que arranca un sábado no se comprime (dia2, dia4 y dia9 cuentan desde el dia0 del lunes)', () => {
    const r = S.calcularE01(base({ videos: [espera({ estado_desde: '2026-10-24T15:00:00.000Z' })], hoy: '2026-11-06' }))
    assert.deepEqual(r.nuevos.map(p => [p.escalon, p.debido]), [['dia0', '2026-10-26'], ['dia2', '2026-10-28'], ['dia4', '2026-10-30'], ['dia9', '2026-11-06']])
    const vie = S.calcularE01(base({ videos: [espera({ estado_desde: '2026-10-23T15:00:00.000Z' })], hoy: '2026-11-06' }))
    assert.notDeepEqual(vie.nuevos.map(p => p.debido), r.nuevos.map(p => p.debido), 'viernes y sábado ya no dan las mismas fechas')
  })
  test('revisión: el pedido de regrabación manda sobre "guiones enviados" (motivo y texto del día 0)', () => {
    assert.equal(S.motivoDe(espera({ origen: 'aylu', motivo_regrabar: 'audio' })), 'regrabar')
  })
  test('revisión: un ciclo que abrió un envío con constancia (regrabación o "guiones enviados") nace con el día 0 hecho', () => {
    const r = S.calcularE01(base({ videos: [espera({ motivo_regrabar: 'audio', estado_desde: '2026-10-22T18:00:00.000Z' })], hoy: '2026-10-23' }))
    const d0 = r.nuevos.find(p => p.escalon === 'dia0')
    assert.ok(d0.hecho, 'el día 0 nace hecho')
    assert.equal(d0.hecho.cuando, '2026-10-22T18:00:00.000Z'); assert.match(d0.hecho.nota, /regrabación/)
    const g = S.calcularE01(base({ videos: [espera({ origen: 'aylu', estado_desde: '2026-10-22T18:00:00.000Z' })], hoy: '2026-10-23' }))
    assert.match(g.nuevos.find(p => p.escalon === 'dia0').hecho.nota, /guiones enviados/)
    const doc = S.calcularE01(base())
    assert.equal(doc.nuevos.find(p => p.escalon === 'dia0').hecho, undefined, 'si el guion pasó a "Para grabar" en el doc, el día 0 lo hace Aylu')
  })
})

describe('videos trabados (horas hábiles)', () => {
  test('para_editar desde el viernes a la tarde: el fin de semana no cuenta', () => {
    const v = videoJuguete({ estado: 'para_editar', estado_desde: '2026-10-23T21:00:00.000Z' })      // vie 18:00 AR
    assert.deepEqual(D.videosTrabados([v], new Date('2026-10-26T15:00:00.000Z'), esHabil), [], 'lunes 12:00 AR: 3 + 12 horas hábiles')
    const t = D.videosTrabados([v], new Date('2026-10-26T22:00:00.000Z'), esHabil)
    assert.equal(t.length, 1); assert.equal(t[0].quien, 'rene'); assert.ok(t[0].horas >= 24)
  })
  test('con_cliente: 3 días hábiles, a cargo del cliente; aprobado nunca', () => {
    const v = videoJuguete({ estado: 'con_cliente', estado_desde: '2026-10-19T15:00:00.000Z' })
    assert.equal(D.videosTrabados([v], new Date('2026-10-21T15:00:00.000Z'), esHabil).length, 0)
    assert.equal(D.videosTrabados([v], new Date('2026-10-22T15:00:00.000Z'), esHabil)[0].quien, 'cliente')
    assert.equal(D.videosTrabados([videoJuguete({ estado: 'aprobado', estado_desde: '2026-01-01T00:00:00Z' })], new Date(), esHabil).length, 0)
  })
})

describe('resumen y fases', () => {
  test('armarResumen: escalones (el último vencido sin hacer por ciclo), colas, cola de René, grabados sin crudos y avisos del día', () => {
    const fila = over => ({ ...videoJuguete(over), crudos: 0, editado_propuesto: false, paleta: false, notas_abiertas: 0 })
    const r = D.armarResumen({
      hoy: '2026-10-27', ahora: new Date('2026-10-27T11:00:00Z'), esHabil,
      pasos: [paso(), paso({ id: 2, escalon: 'dia2', debido: '2026-10-20', responsable: 'gero_m' }), paso({ id: 3, id_crm: 'A102', cliente: 'Bea', escalon: 'dia0', hecho: { quien: 'Aylén', cuando: '', nota: '' } })],
      videos: [fila({ id: 1, estado: 'para_editar', prioridad: 'urgente' }), fila({ id: 2, estado: 'correccion' }), fila({ id: 3, estado: 'con_cliente', bloqueo: 'tope_rondas_cliente' }), fila({ id: 4, clave: 'T1-V2', estado: 'esperando_crudos' })],
      docs: [{ id_crm: 'A101', doc_id: 'd', modificado: '', leido: '2026-10-27T10:00:00Z', avisos: ['el guion T1-V3 cambió en el doc después de grabarse (T1-V3): revisar', 'el doc no tiene títulos'],
        guiones: [{ ref: 'T1-V2', tanda: 1, numero: 2, estado_doc: 'grabado_completo', huella: 'h', frases: [], titulo: '', secciones: {} }] }],
      archivos: { sinUbicar: [], editadosPorVincular: 3, sinTranscribir: [{ id_crm: 'A101', archivos: 2, motivo: 'grande' }] }, vinculosPorConfirmar: 4, nombres: new Map(),
    })
    assert.deepEqual(r.escalones.map(e => [e.escalon, e.clientes.map(c => c.id_crm)]), [['dia2', ['A101']]])
    assert.equal(r.escalones[0].clientes[0].dias, 7)
    assert.deepEqual(r.colas, { para_editar: 1, correccion: 1, con_cliente: 1, esperando_crudos: 1 })
    assert.deepEqual(r.cola_rene, [{ id_crm: 'A101', cliente: 'Ana Pérez', videos: 2, urgente: true }])
    assert.deepEqual(r.grabado_sin_crudos, [{ id_crm: 'A101', cliente: 'Ana Pérez', refs: ['T1-V2'] }])
    assert.equal(r.editados_por_vincular, 3); assert.equal(r.vinculos_por_confirmar, 4)
    assert.deepEqual(r.sin_transcribir.map(x => [x.archivos, x.motivo]), [[2, 'grande']])
    assert.deepEqual(r.avisos_guiones[0].avisos, ['el guion T1-V3 cambió en el doc después de grabarse (T1-V3): revisar'])
  })
  test('día de daily y hora: martes a viernes hábiles, desde las 7:45 de Argentina', () => {
    assert.equal(D.esDiaDeDaily('2026-10-27', esHabil), true)      // martes
    assert.equal(D.esDiaDeDaily('2026-10-26', esHabil), false)     // lunes
    assert.equal(D.esDiaDeDaily('2026-10-31', esHabil), false)     // sábado
    assert.equal(D.yaEsHoraDelResumen(new Date('2026-10-27T10:44:00Z')), false)
    assert.equal(D.yaEsHoraDelResumen(new Date('2026-10-27T10:45:00Z')), true)
  })

  async function armar(iso) {
    let ahora = new Date(iso)
    const { s, repo } = await repoMemoria({ reloj: () => ahora })
    s.videos.set(1, espera())
    const extra = []
    const deps = { drive: { carpetasClientes: async () => [], listarArbol: async () => ({ archivos: [], carpetas: [], completo: true }), listarCambios: async () => ({ archivos: [], carpetas: [] }), metadatosDoc: async () => ({ modificado: '' }), exportarTexto: async () => '', consultas: () => 0 },
      repo, transcripcion: null, claude: null, crm: async () => [], altas: async () => [], avisar: async (ev, ex) => { extra.push(...ex) }, despachar: async () => {},
      ahora: () => ahora, modo: 'real', esHabil, env: {}, listarDocs: repo.listarDocs }
    return { s, repo, deps, extra, mover: x => { ahora = new Date(x) } }
  }
  test('el cron de las 7:00 hace la pasada completa y e01 pero no el resumen; la primera corrida del vigía después de las 7:45 lo manda, UNA vez', async () => {
    const e = await armar('2026-10-27T10:05:00.000Z')
    const r = await D.correrDiario(e.deps, { origen: 'cron', deadline: Date.now() + 200_000 })
    assert.equal(r.ok, true, r.errores.join())
    assert.ok(r.fases.includes('diario:2026-10-27:completa') && r.fases.includes('diario:2026-10-27:e01'))
    assert.ok(!r.fases.includes('diario:2026-10-27:resumen'))
    assert.ok(e.s.pasos.length > 0, 'e01 creó los pasos')
    assert.equal(e.extra.filter(x => x.tipo === 'resumen_daily').length, 0)
    e.mover('2026-10-27T11:00:00.000Z')
    const deps = { ...e.deps }
    deps.retomar = o => D.retomarDiario(deps, o)
    const { correrVigia } = await import('../lib/bot/grabacion/vigia.ts')
    await correrVigia(deps, { tipo: 'vigia', origen: 'puente', deadline: Date.now() + 200_000 })
    assert.equal(e.extra.filter(x => x.tipo === 'resumen_daily').length, 1)
    e.mover('2026-10-27T11:15:00.000Z')
    await correrVigia(deps, { tipo: 'vigia', origen: 'puente', deadline: Date.now() + 200_000 })
    assert.equal(e.extra.filter(x => x.tipo === 'resumen_daily').length, 1, 'una sola vez por día')
    const resumen = e.extra.find(x => x.tipo === 'resumen_daily').resumen
    assert.equal(resumen.fecha, '2026-10-27')
    assert.ok(resumen.escalones.length > 0)
  })
  test('el vigía retoma e01 antes del resumen si el cron no corrió; un lunes no hay resumen', async () => {
    const e = await armar('2026-10-28T11:00:00.000Z')
    const deps = { ...e.deps }
    const r = await D.retomarDiario(deps, { deadline: Date.now() + 200_000, ahora: new Date('2026-10-28T11:00:00.000Z'), corrida: null })
    assert.deepEqual(r.fases.filter(f => /e01|resumen/.test(f)), ['diario:2026-10-28:e01', 'diario:2026-10-28:resumen'])
    assert.ok(!r.fases.includes('diario:2026-10-28:completa'), 'antes de las 9 el vigía no hace la pasada completa')
    const lunes = await armar('2026-10-26T11:00:00.000Z')
    const r2 = await D.retomarDiario(lunes.deps, { deadline: Date.now() + 200_000, ahora: new Date('2026-10-26T11:00:00.000Z'), corrida: null })
    assert.ok(!r2.fases.some(f => f.endsWith(':resumen')))
  })
  test('huecos de ayer: solo si el puente corrió en la última semana', () => {
    const c = (inicio, fin, origen = 'puente') => ({ id: 1, tipo: 'vigia', origen, estado: 'ok', inicio, fin, consultas: 0, archivos_nuevos: 0, tandas_cerradas: 0, error: '', resumen: {} })
    assert.deepEqual(D.huecosDe([c('2026-10-26T12:00:00.000Z', '2026-10-26T12:01:00.000Z', 'manual')], '2026-10-26'), [])
    const h = D.huecosDe([c('2026-10-26T11:00:00.000Z', '2026-10-26T11:01:00.000Z'), c('2026-10-26T11:15:00.000Z', '2026-10-26T11:16:00.000Z'), c('2026-10-26T15:00:00.000Z', '2026-10-26T15:01:00.000Z'), c('2026-10-27T00:50:00.000Z', '2026-10-27T00:51:00.000Z')], '2026-10-26')
    assert.deepEqual(h.map(x => x.desde), ['2026-10-26T11:16:00.000Z', '2026-10-26T15:01:00.000Z'])
  })
  test('modo dry: el diario devuelve el plan sin escribir', async () => {
    const e = await armar('2026-10-27T10:05:00.000Z')
    const r = await D.correrDiario({ ...e.deps, modo: 'dry' }, { origen: 'manual', deadline: Date.now() + 200_000 })
    assert.equal(r.dry, true)
    assert.equal(e.s.escrituras, 0)
    assert.equal(r.plan_diario.e01.nuevos, 3, 'dia0, dia2 y dia4 (el dia9 vence el 29)')
  })
})

describe('revisión de la integración, ronda 3', () => {
  const base = over => ({ videos: [espera()], pasos: [], hoy: '2026-10-22', esHabil, ...over })
  test('t06 · freno con todos los pasos del ciclo hechos (el día 0 nació hecho): el escalón vencido queda como «ubicar crudos» para Aylu', () => {
    const hecho = { quien: 'Aylu', cuando: '2026-10-16T15:00:00.000Z', nota: 'x' }
    const sin = [{ id_crm: 'A101', creado: '2026-10-19T14:00:00.000Z', subio: 'cliente' }]
    const r = S.calcularE01(base({ pasos: [paso({ hecho })], sinUbicar: sin }))
    assert.deepEqual(r.nuevos.map(p => [p.escalon, p.responsable, p.frenado]), [['dia2', 'aylu', 'crudos_sin_ubicar']])
    // Con un paso pendiente sigue como antes: se marca frenado ese, sin crear otro
    const r2 = S.calcularE01(base({ pasos: [paso({ hecho }), paso({ id: 2, escalon: 'dia2', debido: '2026-10-20', responsable: 'gero_m' })], sinUbicar: sin }))
    assert.deepEqual(r2.nuevos, [])
    assert.deepEqual(r2.actualizar, [{ id: 2, videos: [1], frenado: 'crudos_sin_ubicar' }])
  })

  test('t05 · «guiones enviados» sobre videos que ya creó el doc: pasan a origen aylu (el día 0 del ciclo nuevo nace hecho) y un día 0 pendiente se marca', async () => {
    const AYLU = { rol: 'aylu', nombre: 'Aylén QA', email: 'aylu@ejemplo.test' }
    const videos = [1, 2].map(n => videoJuguete({ id: n, clave: `T1-V${n}`, numero: n, tanda_guion: 1, origen: 'doc', estado: 'esperando_crudos', estado_desde: '2026-10-26T10:00:00.000Z', creado: '2026-10-26T10:00:00.000Z',
      guion: { doc_id: 'doc1', ref: `T1-V${n}`, huella: `h${n}` } }))
    const cambios = [], marcados = []
    const pasos = [paso({ id: 9, ciclo: '2026-10-26', debido: '2026-10-26', videos: [1, 2] })]
    const repo = {
      leerDoc: async () => ({ doc_id: 'doc1', guiones: [1, 2].map(n => ({ ref: `T1-V${n}`, tanda: 1, numero: n, huella: `h${n}`, estado_doc: 'para_grabar', texto: 'x', gancho: 'g' })) }),
      listarVideos: async () => videos,
      crearVideoSiFalta: async () => { throw new Error('no debería crear') },
      actualizarVideo: async (p) => { cambios.push(p.cambios); const v = videos.find(x => x.id === p.id); Object.assign(v, p.cambios); return { ok: true, actual: { video: v, evento: { tipo: p.tipo } } } },
      vigilarCrudosDe: async () => {}, carpetasDeCliente: async () => [],
      pasosAbiertos: async () => pasos, marcarPaso: async (p) => { marcados.push(p); return { ok: true, actual: null } },
    }
    await S.iniciarTandaCon(repo, { id_crm: 'a101', tanda_guion: 1, actor: AYLU })
    assert.deepEqual(cambios, [{ origen: 'aylu' }, { origen: 'aylu' }])
    assert.deepEqual(marcados.map(m => [m.id, m.actor.rol]), [[9, 'aylu']])
    assert.match(marcados[0].nota, /guiones enviados/)
    // Sin ciclo todavía: el e01 del día siguiente abre el ciclo con el día 0 hecho
    const e = S.calcularE01({ videos, pasos: [], hoy: '2026-10-27', esHabil })
    const d0 = e.nuevos.find(p => p.escalon === 'dia0')
    assert.equal(d0.motivo, 'guiones_enviados'); assert.ok(d0.hecho)
  })
})
