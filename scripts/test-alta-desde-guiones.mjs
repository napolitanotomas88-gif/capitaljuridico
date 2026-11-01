// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-alta-desde-guiones.mjs
// d05 (lib/bot/grabacion/altaDesdeGuiones.ts): con el check final, los videos de la tanda entran solos a Edición en Esperando
// crudos. El Doc armado tiene la misma clave T-V y la misma huella que va a leer el vigía (no se duplican), es idempotente,
// una reaprobación solo actualiza el guion de los que esperan crudos, respeta el modo dry, la fecha de corte y el freno.
// Puro: repo de juguete, sin red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const A = await import('../lib/bot/grabacion/altaDesdeGuiones.ts')
const G = await import('../lib/bot/grabacion/guiones.ts')

const guion = (n, extra = '') => ({
  numero: n,
  secciones: [
    { seccion: 'HOOK', velocidad: 5, indicacion: 'mirando a cámara con una carpeta', texto: `¿Te despidieron en San Juan? Guion ${n}${extra}.` },
    { seccion: 'PROBLEMA', velocidad: 3, indicacion: 'caminando', texto: 'La empresa te dice que no te corresponde nada y vos firmás.' },
    { seccion: 'SOLUCION', velocidad: 3, indicacion: 'señalando la hoja', texto: 'Antes de firmar, revisamos juntos cuánto te corresponde.' },
    { seccion: 'CTA', velocidad: 4, indicacion: 'de frente', texto: 'Escribime acá abajo (gesto con el dedo hacia abajo) y lo vemos.' },
  ],
})
const SEIS = [1, 2, 3, 4, 5, 6].map(n => guion(n))
const AHORA = new Date('2026-11-02T15:00:00Z')

function repoJuguete(videos = []) {
  const log = []
  let id = 100
  return {
    log, videos,
    repo: {
      listarVideos: async () => videos.map(v => ({ ...v })),
      crearVideoSiFalta: async (v, actor) => {
        log.push(['crear', v.clave, actor.proceso])
        if (videos.some(x => x.clave === v.clave)) return { creado: false, evento: null }
        videos.push({ ...v, id: ++id, version: 1 })
        return { creado: true, evento: null }
      },
      actualizarVideo: async x => { log.push(['actualizar', x.id]); const v = videos.find(y => y.id === x.id); Object.assign(v, x.cambios, { version: v.version + 1 }); return { ok: true } },
      vigilarCrudosDe: async idCrm => { log.push(['vigilar', idCrm]) },
    },
  }
}
const op = (o = {}) => ({ id_crm: 'A149', cliente: 'Ana Pérez', doc_id: 'doc_guiones_1234567890', tanda: 2, guiones: SEIS, ahora: AHORA, corte: null, maxAltas: 10, modo: 'real', ...o })

describe('el Doc de la tanda es el mismo que lee el vigía', () => {
  test('clave T<tanda>-V<n>, en «Para grabar», sin indicaciones ni «Velocidad N» en el texto', () => {
    const d = A.docDeTanda({ id_crm: 'a149', doc_id: 'd', tanda: 2, guiones: SEIS, ahora: AHORA.toISOString() })
    assert.deepEqual(d.guiones.map(g => [g.ref, g.estado_doc]), [1, 2, 3, 4, 5, 6].map(n => [`T2-V${n}`, 'para_grabar']))
    assert.deepEqual(d.avisos, [])
    assert.equal(d.guiones[0].secciones.cta, 'Escribime acá abajo y lo vemos.')
    assert.ok(!/velocidad|carpeta/i.test(d.guiones[0].secciones.hook))
  })
  test('la huella coincide con la del Doc exportado (con más tandas, chips vacíos y otros títulos alrededor)', () => {
    const exportado = `Guiones - AnaP\n\nTANDA 1°\n\n* Video: Grabado completo\nHOOK\nUn guion viejo cargado a mano.\nCTA\nEscribime.\n\n${A.textoDocDeTanda(2, SEIS)}\nTANDA 3°\n\n* Video: No iniciado\n`
    const leido = G.parsearDocGuiones(exportado, 'd', 'A149', AHORA.toISOString())
    const nuestro = A.docDeTanda({ id_crm: 'A149', doc_id: 'd', tanda: 2, guiones: SEIS, ahora: AHORA.toISOString() })
    for (const g of nuestro.guiones) assert.equal(leido.guiones.find(x => x.ref === g.ref)?.huella, g.huella, g.ref)
  })
})

describe('altaDesdeTanda', () => {
  test('crea los 6 videos en Esperando crudos (origen doc, bot «guiones») y prende la vigilancia de Crudos', async () => {
    const j = repoJuguete()
    const r = await A.altaDesdeTanda(j.repo, op())
    assert.deepEqual(r.altas, ['T2-V1', 'T2-V2', 'T2-V3', 'T2-V4', 'T2-V5', 'T2-V6'])
    assert.ok(j.videos.every(v => v.estado === 'esperando_crudos' && v.origen === 'doc' && v.tanda_guion === 2 && v.cliente === 'Ana Pérez'))
    assert.ok(j.log.filter(x => x[0] === 'crear').every(x => x[2] === 'guiones'))
    assert.deepEqual(j.log.at(-1), ['vigilar', 'A149'])
  })
  test('idempotente: una segunda corrida no crea ni actualiza nada', async () => {
    const j = repoJuguete()
    await A.altaDesdeTanda(j.repo, op())
    j.log.length = 0
    const r = await A.altaDesdeTanda(j.repo, op())
    assert.deepEqual(r.altas, []); assert.deepEqual(r.actualizados, []); assert.deepEqual(j.log, [])
    assert.equal(j.videos.length, 6)
  })
  test('después, la pasada del vigía reconoce los videos y no crea otros (aunque sea su primera lectura del Doc)', async () => {
    const j = repoJuguete()
    await A.altaDesdeTanda(j.repo, op())
    const leido = G.parsearDocGuiones(A.textoDocDeTanda(2, SEIS), 'doc_guiones_1234567890', 'A149', AHORA.toISOString())
    for (const anterior of [null, { ...leido, guiones: [] }]) {
      const plan = G.planDoc(leido, anterior, j.videos, { hoy: '2026-11-02', corte: null, maxAltas: 10 })
      assert.deepEqual(plan.altas, []); assert.deepEqual(plan.vincular, [])
    }
  })
  test('reaprobación con correcciones: actualiza el guion de los que esperan crudos y no toca los ya grabados', async () => {
    const j = repoJuguete()
    await A.altaDesdeTanda(j.repo, op())
    j.videos.find(v => v.clave === 'T2-V2').estado = 'crudo_a_revisar'
    j.log.length = 0
    const corregidos = SEIS.map(g => g.numero <= 2 ? guion(g.numero, ' corregido por el cliente') : g)
    const r = await A.altaDesdeTanda(j.repo, op({ guiones: corregidos }))
    assert.deepEqual(r.altas, []); assert.deepEqual(r.actualizados, ['T2-V1'])
    assert.ok(j.videos.find(v => v.clave === 'T2-V1').guion_texto.includes('corregido'))
    assert.ok(!j.videos.find(v => v.clave === 'T2-V2').guion_texto.includes('corregido'))
    assert.ok(r.avisos.some(a => /T2-V2/.test(a) && /revisar/.test(a)))
  })
  test('modo dry: devuelve el plan y no escribe', async () => {
    const j = repoJuguete()
    const r = await A.altaDesdeTanda(j.repo, op({ modo: 'dry' }))
    assert.equal(r.modo, 'dry'); assert.equal(r.altas.length, 6); assert.deepEqual(j.log, []); assert.equal(j.videos.length, 0)
  })
  test('antes de la fecha de corte no crea (queda para el vigía); con más del freno no crea ninguno y avisa', async () => {
    const j = repoJuguete()
    const r = await A.altaDesdeTanda(j.repo, op({ corte: '2026-11-10' }))
    assert.deepEqual(r.altas, []); assert.equal(r.pospuestos.length, 6); assert.equal(j.videos.length, 0)
    const f = await A.altaDesdeTanda(j.repo, op({ maxAltas: 5 }))
    assert.deepEqual(f.altas, []); assert.equal(f.frenadas, 6); assert.ok(f.avisos.some(a => /de una vez/.test(a))); assert.equal(j.videos.length, 0)
  })
  test('sin guiones o con la tanda inválida no consulta nada', async () => {
    const j = repoJuguete()
    j.repo.listarVideos = async () => { throw new Error('No debe consultar') }
    assert.deepEqual((await A.altaDesdeTanda(j.repo, op({ guiones: [] }))).altas, [])
    assert.deepEqual((await A.altaDesdeTanda(j.repo, op({ tanda: 0 }))).altas, [])
  })
})
