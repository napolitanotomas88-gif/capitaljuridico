// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-vigia.mjs
// El vigía (lib/bot/grabacion/vigia.ts) contra un Drive de JUGUETE con un árbol de 4 niveles y un repositorio EN MEMORIA:
// filtro por fecha con solapamiento, subcarpetas nuevas recorridas en la misma corrida, archivos viejos sin tanda, quién
// subió sin que quede un mail, vínculo por carpeta, cierre de la tanda a los 45 minutos (con las carpetas consultadas
// después), llegaron_crudos, comparación y aviso de la tanda, propuesta de editados, corte por deadline con barrido
// rotativo, modo dry sin escrituras, la pasada completa (vínculos, aviso de vínculo una vez, carpetas a confirmar que no
// procesan, línea de base del doc, altas, borrados con bloqueo) y el aviso de vigía callado. SIN red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { repoMemoria, videoJuguete, RED_BLOQUEADA } from './edicion-juguetes.mjs'

globalThis.fetch = RED_BLOQUEADA
const V = await import('../lib/bot/grabacion/vigia.ts')
const D = await import('../lib/bot/grabacion/drive.ts')
const CF = await import('../lib/edicion/config.ts')
const { esHabil } = await import('../lib/anuncios/feriados.ts')

const MIME_CARPETA = D.MIME_CARPETA
const dormir = ms => new Promise(r => setTimeout(r, ms))

/** Drive de juguete: nodos { id, padre, nombre, carpeta?, creado, mime?, size?, owner?, dur? }. */
function driveJuguete(nodos, op = {}) {
  let n = 0
  const llamadas = []
  const equipo = D.equipoDrive({ EDICION_EQUIPO_DRIVE: '@skyward.test' })
  const api = x => ({ id: x.id, name: x.nombre, mimeType: x.carpeta ? MIME_CARPETA : (x.mime ?? 'video/quicktime'), size: x.size ? String(x.size) : undefined,
    createdTime: x.creado, modifiedTime: x.creado, owners: x.owner ? [{ emailAddress: x.owner }] : undefined, videoMediaMetadata: x.dur ? { durationMillis: String(x.dur) } : undefined })
  const lector = {
    async listarCambios(c, desde) {
      n++; llamadas.push({ id: c.drive_id, desde })
      if (op.espera) await dormir(op.espera)
      if (op.falla?.has(c.drive_id)) throw new Error('Google respondió 500')
      const xs = nodos.filter(x => x.padre === c.drive_id && (!desde || x.creado > desde)).map(api)
      return { archivos: xs.filter(f => f.mimeType !== MIME_CARPETA).map(f => D.aArchivoDrive(f, c, equipo)), carpetas: xs.filter(f => f.mimeType === MIME_CARPETA).map(f => D.subcarpeta(f, c)) }
    },
    async listarArbol(raiz, max) {
      const archivos = [], carpetas = []
      let nivel = [raiz]
      for (let k = 0; k <= max && nivel.length; k++) {
        const sig = []
        for (const c of nivel) { const r = await lector.listarCambios(c, null); archivos.push(...r.archivos); carpetas.push(...r.carpetas); sig.push(...r.carpetas) }
        nivel = k < max ? sig : []
      }
      return { archivos, carpetas, completo: true }
    },
    carpetasClientes: async () => op.clientes ?? [],
    metadatosDoc: async () => ({ modificado: '' }),
    exportarTexto: async id => op.docs?.[id] ?? '',
    consultas: () => n,
  }
  return { lector, llamadas }
}

const raiz = (drive_id, raizTipo, over = {}) => ({ drive_id, nombre: raizTipo === 'crudos' ? 'Crudos' : 'Editados', padre_id: 'cli1', nivel: 0, ruta: [], id_crm: 'A101', tipo: raizTipo, raiz: raizTipo,
  raiz_id: drive_id, vinculo: 'aylu', candidatos: [], vigilar: true, creada: null, ultimo_archivo: null, consultada: null, borrada: null, ...over })

/** El escenario base: Ana (A101) con Crudos y Editados vigilados, dos videos esperando crudos y un árbol de 4+ niveles. */
async function escenario(op = {}) {
  let ahora = new Date(op.desde ?? '2026-10-24T13:20:00.000Z')
  const { s, repo } = await repoMemoria({ reloj: () => ahora })
  for (const c of [raiz('cru1', 'crudos'), raiz('edi1', 'editados')]) s.carpetas.set(c.drive_id, { ...c })
  s.videos.set(1, videoJuguete({ id: 1, clave: 'T1-V4', tanda_guion: 1, numero: 4 }))
  s.videos.set(2, videoJuguete({ id: 2, clave: 'T2-V1', tanda_guion: 2, numero: 1 }))
  const nodos = [
    { id: 'tan1', padre: 'cru1', nombre: 'Tanda 1', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'vid4', padre: 'tan1', nombre: 'Video 4', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'f1', padre: 'vid4', nombre: 'IMG_0249.MOV', creado: '2026-10-24T13:05:00.000Z', size: 900_000_000, owner: 'ana.cliente@gmail.test', dur: 40_000 },
    { id: 'f2', padre: 'vid4', nombre: 'IMG_0250.MOV', creado: '2026-10-24T13:10:00.000Z', size: 800_000_000, owner: 'aylu@skyward.test' },
    { id: 'fviejo', padre: 'cru1', nombre: 'IMG_0001.MOV', creado: '2026-10-18T13:00:00.000Z', size: 100, owner: 'ana.cliente@gmail.test' },
    { id: 'tan2', padre: 'cru1', nombre: 'Tanda 2', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'v21', padre: 'tan2', nombre: 'Video 1', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'tom', padre: 'v21', nombre: 'Tomas', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'ext', padre: 'tom', nombre: 'Extra', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'f4', padre: 'ext', nombre: 'toma final.mp4', mime: 'video/mp4', creado: '2026-10-24T13:12:00.000Z', size: 10, owner: 'ana.cliente@gmail.test' },
    { id: 'mas', padre: 'ext', nombre: 'Mas', carpeta: true, creado: '2026-10-24T13:00:00.000Z' },
    { id: 'f5', padre: 'mas', nombre: 'muy abajo.mp4', mime: 'video/mp4', creado: '2026-10-24T13:12:00.000Z', size: 10 },
    { id: 'e1', padre: 'edi1', nombre: 'video 4 final.mp4', mime: 'video/mp4', creado: '2026-10-24T13:15:00.000Z', size: 10, owner: 'aylu@skyward.test' },
  ]
  const drive = driveJuguete(nodos, op.drive)
  const avisos = [], eventos = []
  const deps = over => ({ drive: drive.lector, repo, transcripcion: null, claude: null, crm: async () => op.crm ?? [], altas: async () => [],
    avisar: async (ev, ex) => { eventos.push(...ev); avisos.push(...ex) }, despachar: async () => {}, ahora: () => ahora, modo: 'real', esHabil, env: op.env ?? {}, ...over })
  return { s, repo, nodos, drive, avisos, eventos, deps, mover: iso => { ahora = new Date(iso) }, ahora: () => ahora }
}
const correr = (e, over = {}, tipo = 'vigia') => V.correrVigia(e.deps(over), { tipo, origen: 'puente', deadline: Date.now() + 200_000 })

describe('vigía: consulta, archivos y tandas', () => {
  test('primera corrida: carpeta nunca consultada → se lista entera; las subcarpetas nuevas se recorren en la misma corrida hasta 4 niveles', async () => {
    const e = await escenario()
    const r = await correr(e)
    assert.equal(r.ok, true, r.errores.join())
    assert.equal(e.drive.llamadas.find(l => l.id === 'cru1').desde, null)
    for (const id of ['tan1', 'vid4', 'tan2', 'v21', 'tom', 'ext']) assert.ok(e.s.carpetas.get(id), id)
    assert.equal(e.s.carpetas.get('ext').nivel, 4)
    assert.equal(e.s.carpetas.get('mas'), undefined, 'el nivel 5 no se baja')
    assert.deepEqual(e.s.carpetas.get('ext').ruta, ['Tanda 2', 'Video 1', 'Tomas', 'Extra'])
    const nombres = [...e.s.archivos.values()].map(a => a.nombre).sort()
    assert.deepEqual(nombres, ['IMG_0001.MOV', 'IMG_0249.MOV', 'IMG_0250.MOV', 'toma final.mp4', 'video 4 final.mp4'])
  })
  test('quién subió: cliente o equipo, y ningún mail queda guardado', async () => {
    const e = await escenario()
    await correr(e)
    const porNombre = n => [...e.s.archivos.values()].find(a => a.nombre === n)
    assert.equal(porNombre('IMG_0249.MOV').subio, 'cliente')
    assert.equal(porNombre('IMG_0250.MOV').subio, 'equipo')
    assert.ok(!JSON.stringify([...e.s.archivos.values(), ...e.s.carpetas.values(), ...e.s.tandas.values()]).includes('@'))
  })
  test('archivo viejo (más de 48 h): se guarda como `vieja`, sin tanda; los nuevos arman UNA tanda y se vinculan por carpeta', async () => {
    const e = await escenario()
    await correr(e)
    const a = n => [...e.s.archivos.values()].find(x => x.nombre === n)
    assert.equal(a('IMG_0001.MOV').transcripcion.estado, 'vieja'); assert.equal(a('IMG_0001.MOV').tanda_id, null)
    assert.equal(a('IMG_0249.MOV').transcripcion.estado, 'pendiente')
    const tandas = [...e.s.tandas.values()].filter(t => t.tipo === 'crudos')
    assert.equal(tandas.length, 1); assert.equal(tandas[0].archivos, 3); assert.equal(tandas[0].subio, 'mixto')
    assert.equal(a('IMG_0249.MOV').video_id, 1); assert.equal(a('IMG_0249.MOV').inferido.por, 'carpeta')
    assert.equal(a('toma final.mp4').video_id, 2, 'Tanda 2 / Video 1 / Tomas / Extra → T2-V1')
    assert.equal(e.s.videos.get(1).estado, 'esperando_crudos', 'vincular no mueve el estado: lo mueve el cierre de la tanda')
  })
  test('editado nuevo en "Editados": se propone vincularlo al video (evento editado_propuesto)', async () => {
    const e = await escenario()
    e.s.videos.get(1).estado = 'para_editar'    // "video 4 final" no dice la tanda: solo se propone a un video que espera el editado
    await correr(e)
    const ed = [...e.s.archivos.values()].find(x => x.nombre === 'video 4 final.mp4')
    assert.equal(ed.tipo, 'editado'); assert.equal(ed.propuesta_video_id, 1); assert.equal(ed.video_id, null)
    assert.ok(e.s.eventos.some(x => x.tipo === 'editado_propuesto' && x.video_id === 1))
  })
  test('segunda corrida: filtra por fecha con 120 minutos de solapamiento y no duplica lo ya visto', async () => {
    const e = await escenario()
    await correr(e)
    e.nodos.push({ id: 'f3', padre: 'vid4', nombre: 'IMG_0251.MOV', creado: '2026-10-24T13:25:00.000Z', size: 10, owner: 'ana.cliente@gmail.test' })
    e.mover('2026-10-24T13:30:00.000Z')
    e.drive.llamadas.length = 0
    const r = await correr(e)
    const consultadaAntes = Date.parse(e.drive.llamadas.find(l => l.id === 'vid4').desde) + 120 * 60_000
    assert.ok(Math.abs(consultadaAntes - Date.parse('2026-10-24T13:20:00.000Z')) < 60_000, 'desde = consultada − 120 min')
    assert.equal(r.archivos_nuevos, 1)
    assert.equal([...e.s.archivos.values()].length, 6)
  })
  test('cierre de la tanda a los 45 minutos con todas las carpetas consultadas después → llegaron_crudos; a los 20 minutos, comparación y aviso (sin transcripción: demorado)', async () => {
    const e = await escenario()
    await correr(e)
    e.mover('2026-10-24T13:40:00.000Z')
    let r = await correr(e)
    assert.equal(r.tandas_cerradas, 0, 'todavía no pasaron 45 minutos desde el último archivo (13:15)')
    e.mover('2026-10-24T14:05:00.000Z')
    r = await correr(e)
    const crudos = () => [...e.s.tandas.values()].find(t => t.tipo === 'crudos')
    assert.equal(r.tandas_cerradas, 2, 'la de crudos y la de editados')
    assert.notEqual(crudos().estado, 'abierta')
    assert.equal(e.s.videos.get(1).estado, 'crudo_a_revisar'); assert.equal(e.s.videos.get(2).estado, 'crudo_a_revisar')
    assert.ok(e.eventos.some(x => x.datos?.accion === 'llegaron_crudos' && x.actor.tipo === 'bot'))
    assert.equal(e.avisos.filter(a => a.tipo === 'tanda_crudos').length, 0, 'recién cerrada y sin transcripción: espera 20 minutos')
    e.mover('2026-10-24T14:30:00.000Z')
    r = await correr(e)
    const av = e.avisos.filter(a => a.tipo === 'tanda_crudos')
    assert.equal(av.length, 1)
    assert.equal(av[0].demorada, true)
    assert.equal(av[0].tanda.resultado.sin_transcribir.length, 3)
    assert.equal([...e.s.tandas.values()].find(t => t.tipo === 'crudos').estado, 'avisada')
    e.mover('2026-10-24T14:50:00.000Z')
    await correr(e)
    assert.equal(e.avisos.filter(a => a.tipo === 'tanda_crudos').length, 1, 'una sola vez')
  })
  test('una tanda no se cierra si alguna carpeta vigilada del cliente no se consultó después de hasta + 45 (falla de Drive)', async () => {
    const e = await escenario({ drive: { falla: new Set() } })
    await correr(e)
    e.mover('2026-10-24T14:05:00.000Z')
    const falla = new Set(['tom'])
    const d2 = driveJuguete(e.nodos, { falla })
    const r = await V.correrVigia(e.deps({ drive: d2.lector }), { tipo: 'vigia', origen: 'puente', deadline: Date.now() + 200_000 })
    assert.equal([...e.s.tandas.values()].find(t => t.tipo === 'crudos').estado, 'abierta')
    assert.equal(r.tandas_cerradas, 1, 'solo la de editados (sus carpetas sí se consultaron)')
    assert.ok(r.errores.some(x => /Tomas/.test(x)))
  })
})

describe('vigía: deadline, dry y corridas', () => {
  test('corte por deadline: deja el resto para la próxima (barrido rotativo, de la consultada hace más tiempo a la más reciente)', async () => {
    const { s, repo } = await repoMemoria()
    for (let i = 0; i < 40; i++) s.carpetas.set(`c${String(i).padStart(2, '0')}`, raiz(`c${String(i).padStart(2, '0')}`, 'crudos'))
    const d = driveJuguete([], { espera: 40 })
    const deps = { drive: d.lector, repo, transcripcion: null, claude: null, crm: async () => [], altas: async () => [], avisar: async () => {}, despachar: async () => {},
      ahora: () => new Date('2026-10-24T15:00:00Z'), modo: 'real', esHabil, env: {} }
    const r1 = await V.correrVigia(deps, { tipo: 'vigia', origen: 'puente', deadline: Date.now() + CF.MARGEN_DEADLINE_MS + 60 })
    assert.ok(r1.consultadas > 0 && r1.consultadas < 40, `consultadas ${r1.consultadas}`)
    assert.equal(r1.pendientes, 40 - r1.consultadas)
    const primeras = new Set(d.llamadas.map(l => l.id))
    d.llamadas.length = 0
    const r2 = await V.correrVigia(deps, { tipo: 'vigia', origen: 'puente', deadline: Date.now() + CF.MARGEN_DEADLINE_MS + 60 })
    assert.ok(r2.consultadas > 0)
    assert.ok(d.llamadas.every(l => !primeras.has(l.id)), 'la segunda corrida arranca por las que nunca se consultaron')
  })
  test('modo dry: no abre corrida ni escribe nada; devuelve el plan', async () => {
    const e = await escenario()
    const r = await correr(e, { modo: 'dry' })
    assert.equal(r.dry, true)
    assert.equal(e.s.escrituras, 0)
    assert.equal(r.plan.carpetas, 2)
    assert.ok(r.plan.archivos_vistos >= 5)
    assert.equal(e.s.archivos.size, 0)
  })
  test('candado: con otra corrida en curso, se saltea', async () => {
    const e = await escenario()
    await e.repo.abrirCorrida('vigia', 'manual')
    const r = await correr(e)
    assert.equal(r.saltada, 'otra corrida en curso')
  })
  test('vigía callado: más de 2 horas de horario de trabajo sin corrida → aviso a Tomás', async () => {
    const e = await escenario({ desde: '2026-10-23T14:00:00.000Z' })
    await correr(e)
    e.mover('2026-10-23T18:30:00.000Z')
    await correr(e)
    const c = e.avisos.find(a => a.tipo === 'vigia_callado')
    assert.ok(c); assert.ok(c.horas > 4)
    assert.equal(V.horasCalladas(new Date('2026-10-24T01:30:00Z'), new Date('2026-10-24T10:30:00Z')), 0, 'de noche no cuenta')
  })
})

describe('pasada completa', () => {
  const DOC = 'TANDA 1°\n* Video: Para grabar\nHOOK\n¿Te despidieron y trabajabas en negro?\nCTA\nEscribime acá abajo.\n* Video: No iniciado\nHOOK\nSi firmaste la liquidación esperá un poco.\n'
  const clientes = () => [
    { carpeta: { drive_id: 'cli1', nombre: 'Ana Pérez', padre_id: 'raiz', nivel: 0, ruta: [], id_crm: null, tipo: 'cliente', raiz: null, raiz_id: null, vinculo: 'a_confirmar', candidatos: [], vigilar: false, creada: null, ultimo_archivo: null, consultada: null, borrada: null },
      crudos: 'cru1', editados: 'edi1', marca: null, guiones_doc: 'doc1', guiones_modificado: '2026-10-24T09:00:00.000Z' },
    { carpeta: { drive_id: 'cli2', nombre: 'Bea', padre_id: 'raiz', nivel: 0, ruta: [], id_crm: null, tipo: 'cliente', raiz: null, raiz_id: null, vinculo: 'a_confirmar', candidatos: [], vigilar: false, creada: null, ultimo_archivo: null, consultada: null, borrada: null },
      crudos: 'cru2', editados: null, marca: null, guiones_doc: null, guiones_modificado: null },
  ]
  const CRM = [{ id: 'A101', nombre: 'Ana Pérez', estado: 'ACTIVO' }, { id: 'A102', nombre: 'Bea Martínez', estado: 'ACTIVO' }, { id: 'A103', nombre: 'Beatriz Gómez', estado: 'ACTIVO' }]

  test('vínculos: nombre exacto y único → bot (procesa); dudoso → a_confirmar con candidatos, un aviso una sola vez, y NO procesa', async () => {
    const e = await escenario({ crm: CRM, drive: { clientes: clientes(), docs: { doc1: DOC } } })
    e.s.carpetas.clear()
    e.nodos.push({ id: 'b1', padre: 'cru2', nombre: 'IMG_9.MOV', creado: '2026-10-24T13:00:00.000Z', size: 10 })
    const r = await correr(e, {}, 'completa')
    assert.equal(r.ok, true, r.errores.join())
    assert.equal(e.s.carpetas.get('cli1').vinculo, 'bot'); assert.equal(e.s.carpetas.get('cli1').id_crm, 'A101')
    assert.equal(e.s.carpetas.get('cru1').vinculo, 'bot')
    const cli2 = e.s.carpetas.get('cli2')
    assert.equal(cli2.vinculo, 'a_confirmar'); assert.equal(cli2.id_crm, null)
    assert.ok(cli2.candidatos.some(c => c.id_crm === 'A102'))
    assert.ok(![...e.s.archivos.values()].some(a => a.nombre === 'IMG_9.MOV'), 'una carpeta a confirmar no genera nada')
    assert.equal(e.avisos.filter(a => a.tipo === 'vinculo_pendiente').length, 1)
    assert.equal(e.s.carpetas.get('cru1').vigilar, true, 'la raíz de un activo con vínculo queda vigilada')
    e.mover('2026-10-24T14:30:00.000Z')
    await correr(e, {}, 'completa')
    assert.equal(e.avisos.filter(a => a.tipo === 'vinculo_pendiente').length, 1, 'el aviso del vínculo sale una vez por carpeta')
  })
  test('un vínculo confirmado por Aylu no lo pisa la pasada', async () => {
    const e = await escenario({ crm: CRM, drive: { clientes: clientes() } })
    e.s.carpetas.set('cli2', { ...clientes()[1].carpeta, id_crm: 'A103', vinculo: 'aylu' })
    await correr(e, {}, 'completa')
    assert.equal(e.s.carpetas.get('cli2').id_crm, 'A103'); assert.equal(e.s.carpetas.get('cli2').vinculo, 'aylu')
  })
  test('doc de guiones: la primera lectura es línea de base (sin altas); cuando un guion pasa a "Para grabar", se crea el video', async () => {
    const e = await escenario({ crm: CRM, drive: { clientes: clientes(), docs: { doc1: DOC } } })
    e.s.videos.clear()
    await correr(e, {}, 'completa')
    assert.ok(e.s.docs.get('doc1'))
    assert.equal(e.s.videos.size, 0, 'línea de base')
    const cl = clientes(); cl[0].guiones_modificado = '2026-10-24T15:00:00.000Z'
    const d2 = driveJuguete(e.nodos, { clientes: cl, docs: { doc1: DOC.replace('* Video: No iniciado', '* Video: Para grabar') } })
    e.mover('2026-10-24T15:10:00.000Z')
    await V.correrVigia(e.deps({ drive: d2.lector }), { tipo: 'completa', origen: 'manual', deadline: Date.now() + 200_000 })
    const vs = [...e.s.videos.values()]
    assert.deepEqual(vs.map(v => [v.clave, v.estado, v.origen]), [['T1-V2', 'esperando_crudos', 'doc']])
    assert.match(vs[0].guion_texto, /^HOOK\nSi firmaste/)
    assert.ok(e.eventos.some(x => x.tipo === 'creado' && x.datos.motivo === 'para_grabar'))
  })
  test('crudo borrado de Drive con el video sin aprobar → bloqueo crudo_borrado y aviso', async () => {
    const e = await escenario({ crm: CRM, drive: { clientes: clientes() } })
    await correr(e)                                  // vincula f1 y f2 al video 1
    e.s.videos.get(1).estado = 'para_editar'
    const sinF1 = e.nodos.filter(n => n.id !== 'f1')
    const d2 = driveJuguete(sinF1, { clientes: clientes() })
    e.mover('2026-10-24T16:00:00.000Z')
    await V.correrVigia(e.deps({ drive: d2.lector }), { tipo: 'completa', origen: 'manual', deadline: Date.now() + 200_000 })
    assert.ok([...e.s.archivos.values()].find(a => a.drive_id === 'f1').borrado)
    assert.equal(e.s.videos.get(1).bloqueo, 'crudo_borrado')
    assert.deepEqual(e.avisos.filter(a => a.tipo === 'crudo_borrado').map(a => [a.video_id, a.archivo]), [[1, 'IMG_0249.MOV']])
  })
})

const { inferirUbicacion, agrupar } = await import('../lib/bot/grabacion/tandas.ts')
describe('inferencia de ubicación', () => {
  test('carpeta, nombre, T2V4, sin datos', () => {
    assert.deepEqual(inferirUbicacion(['Tanda 1', 'Video 4'], 'IMG_0249.MOV'), { tanda_guion: 1, numero: 4, por: 'carpeta' })
    assert.deepEqual(inferirUbicacion(['TANDA 2°'], 'video 3 toma 2.mov'), { tanda_guion: 2, numero: 3, por: 'nombre' })
    assert.deepEqual(inferirUbicacion([], 'T2V4.mp4'), { tanda_guion: 2, numero: 4, por: 'nombre' })
    assert.deepEqual(inferirUbicacion([], 'T3-V1 final.mp4'), { tanda_guion: 3, numero: 1, por: 'nombre' })
    assert.deepEqual(inferirUbicacion([], 'V5.mp4'), { tanda_guion: null, numero: 5, por: 'nombre' })
    assert.deepEqual(inferirUbicacion([], 'IMG_0249.MOV'), { tanda_guion: null, numero: null, por: null })
    assert.deepEqual(inferirUbicacion(['Crudos viejos'], 'DJI_0012.MP4'), { tanda_guion: null, numero: null, por: null })
  })
  test('agrupar: el hueco de 45 minutos corta la tanda; dentro de la abierta se suma', () => {
    const t = (id, h) => ({ id, creado: `2026-10-24T${h}:00.000Z`, subio: 'cliente' })
    const g = agrupar([t(1, '10:00'), t(2, '10:40'), t(3, '11:40')], [], new Date())
    assert.deepEqual(g.map(x => x.archivos), [[1, 2], [3]])
    const abierta = { id: 9, id_crm: 'A1', tipo: 'crudos', desde: '2026-10-24T09:30:00.000Z', hasta: '2026-10-24T09:50:00.000Z', archivos: 2, subio: 'equipo', estado: 'abierta', cerrada: null, resultado: null, version: 1 }
    const h = agrupar([t(4, '10:20')], [abierta], new Date())
    assert.deepEqual(h.map(x => [x.tanda_id, x.subio]), [[9, 'mixto']])
  })
})

const AC = await import('../lib/bot/grabacion/acceso.ts')
describe('acceso de las rutas propias (vigía y diario)', () => {
  const h = v => ({ get: k => (k === 'authorization' ? v : null) })
  const VIGIA = 'v'.repeat(40), CRON = 'cron-corto'
  test('vigía: Bearer VIGIA_SECRETO → puente; Bearer CRON_SECRET → manual; otro → 401; sin ninguno → 503', () => {
    const env = { VIGIA_SECRETO: VIGIA, CRON_SECRET: CRON }
    assert.deepEqual(AC.autorizarVigia(h(`Bearer ${VIGIA}`), env), { ok: true, origen: 'puente' })
    assert.deepEqual(AC.autorizarVigia(h(`Bearer ${CRON}`), env), { ok: true, origen: 'manual' })
    assert.deepEqual(AC.autorizarVigia(h('Bearer otro'), env), { ok: false, status: 401 })
    assert.deepEqual(AC.autorizarVigia(h(null), env), { ok: false, status: 401 })
    assert.deepEqual(AC.autorizarVigia(h(`Bearer ${VIGIA}`), {}), { ok: false, status: 503 })
  })
  test('un VIGIA_SECRETO de menos de 32 caracteres no autentica (mal configurado); CRON_SECRET no tiene mínimo', () => {
    assert.deepEqual(AC.autorizarVigia(h('Bearer corto'), { VIGIA_SECRETO: 'corto' }), { ok: false, status: 503 })
    assert.deepEqual(AC.autorizarVigia(h('Bearer corto'), { VIGIA_SECRETO: 'corto', CRON_SECRET: CRON }), { ok: false, status: 401 })
    assert.deepEqual(AC.autorizarCron(h(`Bearer ${CRON}`), { CRON_SECRET: CRON }), { ok: true, origen: 'manual' })
  })
  test('diario: solo CRON_SECRET (el de VIGIA no sirve); sin CRON_SECRET → 503', () => {
    assert.deepEqual(AC.autorizarCron(h(`Bearer ${VIGIA}`), { VIGIA_SECRETO: VIGIA, CRON_SECRET: CRON }), { ok: false, status: 401 })
    assert.deepEqual(AC.autorizarCron(h(`Bearer ${CRON}`), {}), { ok: false, status: 503 })
  })
  test('el estado de las variables dice sí/no, nunca el valor', () => {
    const e = AC.estadoVariables({ VIGIA_SECRETO: VIGIA, CRON_SECRET: CRON, ASSEMBLYAI_API_KEY: 'clave', EDICION_MODO: 'real', EDICION_FECHA_CORTE: '2026-11-02' })
    assert.equal(e.VIGIA_SECRETO, true); assert.equal(e.ASSEMBLYAI_WEBHOOK_SECRETO, false); assert.equal(e.EDICION_MODO, 'real')
    assert.ok(!JSON.stringify(e).includes(VIGIA) && !JSON.stringify(e).includes('clave'))
  })
})

// ── Hallazgos de la revisión (24/10): cada uno con su escenario ────────────────────────────────────────────────────
describe('revisión: vigía y tandas', () => {
  /** El repositorio en memoria tolera filas repetidas; Postgres no: un upsert con el mismo drive_id dos veces da 21000. */
  const comoPostgres = (s, repo) => {
    const dup = xs => { const ids = xs.map(x => x.drive_id); return ids.filter((x, i) => ids.indexOf(x) !== i) }
    const tirar = d => { throw Object.assign(new Error(`ON CONFLICT DO UPDATE command cannot affect row a second time (${d})`), { code: '21000' }) }
    return { ...repo,
      guardarArbol: async (xs, o) => { const d = dup(xs); if (d.length) tirar(d); return repo.guardarArbol(xs, o) },
      guardarArchivos: async (id, tipo, xs) => { const d = dup(xs); if (d.length) tirar(d); return repo.guardarArchivos(id, tipo, xs) },
    }
  }
  test('Aylu arma "Tanda 3/Video 1" de antemano: la subcarpeta ya vigilada NO se vuelve a bajar y ningún lote lleva un drive_id repetido', async () => {
    let ahora = new Date('2026-10-23T13:00:00.000Z')
    const { s, repo } = await repoMemoria({ reloj: () => ahora })
    s.carpetas.set('cru1', raiz('cru1', 'crudos', { consultada: '2026-10-23T12:45:00.000Z' }))
    s.videos.set(1, videoJuguete({ id: 1, clave: 'T3-V1', tanda_guion: 3, numero: 1 }))
    const nodos = [
      { id: 'tan3', padre: 'cru1', nombre: 'Tanda 3', carpeta: true, creado: '2026-10-23T12:50:00.000Z' },
      { id: 'v1', padre: 'tan3', nombre: 'Video 1', carpeta: true, creado: '2026-10-23T12:51:00.000Z' },
      { id: 'f1', padre: 'v1', nombre: 'IMG_1.MOV', creado: '2026-10-23T13:05:00.000Z', size: 10 },
    ]
    const visibles = () => nodos.filter(n => n.creado <= ahora.toISOString())
    const lector = { ...driveJuguete([]).lector,
      async listarCambios(c, desde) { const d = driveJuguete(visibles()); return d.lector.listarCambios(c, desde) } }
    const deps = () => ({ drive: lector, repo: comoPostgres(s, repo), transcripcion: null, claude: null, crm: async () => [], altas: async () => [], avisar: async () => {},
      despachar: async () => {}, ahora: () => ahora, modo: 'real', esHabil, env: {} })
    for (let k = 0; k < 4; k++) {
      const r = await V.correrVigia(deps(), { tipo: 'vigia', origen: 'puente', deadline: Date.now() + 200_000 })
      assert.equal(r.ok, true, `${k}: ${r.errores.join(' · ')}`)
      ahora = new Date(ahora.getTime() + 15 * 60_000)
    }
    assert.ok(s.carpetas.get('cru1').consultada > '2026-10-23T13:30:00', 'la consultada de la raíz avanza')
    assert.equal([...s.archivos.values()].filter(a => a.drive_id === 'f1').length, 1)
    assert.equal([...s.archivos.values()].find(a => a.drive_id === 'f1').video_id, 1)
  })
  test('el cliente sube a las 21:20 y a las 23:10: la tanda que cierra asignarATanda por el hueco también mueve su video', async () => {
    let ahora = new Date('2026-10-23T00:45:00.000Z')
    const { s, repo } = await repoMemoria({ reloj: () => ahora })
    s.carpetas.set('cru1', raiz('cru1', 'crudos', { consultada: '2026-10-22T23:00:00.000Z' }))
    s.carpetas.set('tan1', { ...raiz('tan1', 'crudos'), tipo: 'sub', nivel: 1, ruta: ['Tanda 1'], raiz_id: 'cru1', padre_id: 'cru1', nombre: 'Tanda 1', consultada: '2026-10-22T23:00:00.000Z' })
    for (const [id, n] of [['v1', 1], ['v2', 2]]) s.carpetas.set(id, { ...raiz(id, 'crudos'), tipo: 'sub', nivel: 2, ruta: ['Tanda 1', `Video ${n}`], raiz_id: 'cru1', padre_id: 'tan1', nombre: `Video ${n}`, consultada: '2026-10-22T23:00:00.000Z' })
    s.videos.set(1, videoJuguete({ id: 1, clave: 'T1-V1', tanda_guion: 1, numero: 1 }))
    s.videos.set(2, videoJuguete({ id: 2, clave: 'T1-V2', tanda_guion: 1, numero: 2 }))
    const nodos = [
      { id: 'a', padre: 'v1', nombre: 'IMG_1.MOV', creado: '2026-10-23T00:20:00.000Z', size: 10 },
      { id: 'b', padre: 'v2', nombre: 'IMG_2.MOV', creado: '2026-10-23T02:10:00.000Z', size: 10 },
    ]
    const lector = { ...driveJuguete([]).lector, async listarCambios(c, desde) { return driveJuguete(nodos.filter(n => n.creado <= ahora.toISOString())).lector.listarCambios(c, desde) } }
    const deps = () => ({ drive: lector, repo, transcripcion: null, claude: null, crm: async () => [], altas: async () => [], avisar: async () => {},
      despachar: async () => {}, ahora: () => ahora, modo: 'real', esHabil, env: {} })
    const correrA = async iso => { ahora = new Date(iso); return V.correrVigia(deps(), { tipo: 'vigia', origen: 'puente', deadline: Date.now() + 200_000 }) }
    await correrA('2026-10-23T00:45:00.000Z')
    for (const h of ['11:00', '11:15', '11:30', '11:45', '12:00', '12:15', '12:30']) await correrA(`2026-10-23T${h}:00.000Z`)
    assert.equal(s.videos.get(1).estado, 'crudo_a_revisar', 'T1-V1 (tanda cerrada por el hueco de 45 minutos)')
    assert.equal(s.videos.get(2).estado, 'crudo_a_revisar')
  })
  test('una comparación que falla vuelve la tanda a "cerrada" y la próxima corrida la compara y avisa', async () => {
    const e = await escenario()
    await correr(e)
    e.mover('2026-10-24T14:20:00.000Z'); await correr(e)                 // cierra la tanda (se compara 20 minutos después)
    let fallar = true
    const repoMalo = { ...e.repo, crudosDeCliente: async (...a) => { if (fallar) throw new Error('la base no respondió en 10 s'); return e.repo.crudosDeCliente(...a) } }
    e.mover('2026-10-24T14:45:00.000Z')
    const r1 = await correr(e, { repo: repoMalo })
    const t = [...e.s.tandas.values()].find(x => x.tipo === 'crudos')
    assert.equal(r1.comparadas, 0)
    assert.equal(t.estado, 'cerrada', 'vuelve a cerrada (antes quedaba "comparando" para siempre)')
    fallar = false
    e.mover('2026-10-24T15:00:00.000Z')
    await correr(e, { repo: repoMalo })
    assert.equal(t.estado, 'avisada')
    assert.equal(e.avisos.filter(a => a.tipo === 'tanda_crudos').length, 1)
  })
  test('una tanda colgada en "comparando" (la función se cortó) la retoma tandasParaComparar pasados 10 minutos', async () => {
    const e = await escenario()
    await correr(e)
    const t = [...e.s.tandas.values()].find(x => x.tipo === 'crudos')
    Object.assign(t, { estado: 'comparando', comparando_desde: '2026-10-24T13:00:00.000Z', cerrada: '2026-10-24T13:00:00.000Z' })
    e.mover('2026-10-24T14:30:00.000Z')
    assert.deepEqual((await e.repo.tandasParaComparar(e.ahora())).map(x => x.id), [t.id])
    await correr(e)
    assert.equal(t.estado, 'avisada')
  })
  test('primera pasada: un crudo histórico ("Video 4/" sin tanda, de mayo) no se vincula al importado "video 4" que está en edición', async () => {
    const { s, repo } = await repoMemoria({ reloj: () => new Date('2026-10-24T13:00:00Z') })
    s.videos.set(9, videoJuguete({ id: 9, clave: 'CU-86abc', tanda_guion: null, numero: 4, estado: 'para_editar', origen: 'clickup', creado: '2026-10-20T12:00:00.000Z' }))
    const c = raiz('cru1', 'crudos'), sub = { ...raiz('v4', 'crudos'), tipo: 'sub', nivel: 1, ruta: ['Video 4'], raiz_id: 'cru1', padre_id: 'cru1', nombre: 'Video 4' }
    const deps = { drive: driveJuguete([]).lector, repo, transcripcion: null, claude: null, crm: async () => [], altas: async () => [], avisar: async () => {}, despachar: async () => {},
      ahora: () => new Date('2026-10-24T13:00:00Z'), modo: 'real', esHabil, env: {} }
    const arch = { drive_id: 'mayo1', nombre: 'IMG_0100.MOV', mime: 'video/quicktime', carpeta_id: 'v4', ruta: ['Video 4'], bytes: 10, duracion_ms: null, ancho: null, alto: null,
      creado: '2026-05-20T15:00:00.000Z', modificado: '2026-05-20T15:00:00.000Z', subio: 'cliente' }
    const r = await V.procesarArchivos(deps, [arch], new Map([['cru1', c], ['v4', sub]]), new Date('2026-10-24T13:00:00Z'))
    assert.equal(r.vinculados, 0)
    assert.equal([...s.archivos.values()][0].video_id, null)
    assert.equal(V.anteriorAlVideo({ creado: '2026-05-20T15:00:00Z' }, { creado: '2026-10-20T12:00:00Z' }), true)
    assert.equal(V.anteriorAlVideo({ creado: '2026-10-19T15:00:00Z' }, { creado: '2026-10-20T12:00:00Z' }), false)
  })
  test('Aylu ordena en Drive un crudo que el cliente tiró en la raíz: se vincula y el video sale de "esperando crudos" (su tanda ya se avisó)', async () => {
    const e = await escenario()
    e.nodos.push({ id: 'suelto', padre: 'cru1', nombre: 'IMG_0300.MOV', creado: '2026-10-24T13:14:00.000Z', size: 10 })
    await correr(e)
    e.mover('2026-10-24T14:30:00.000Z'); await correr(e)
    e.mover('2026-10-24T15:00:00.000Z'); await correr(e)
    const t = [...e.s.tandas.values()].find(x => x.tipo === 'crudos')
    assert.equal(t.estado, 'avisada')
    e.s.videos.get(1).estado = 'esperando_crudos'; e.s.videos.get(1).version++
    // Aylu lo mueve a "Tanda 1/Video 4": la pasada completa lo ve movido
    const n = e.nodos.find(x => x.id === 'suelto'); n.padre = 'vid4'
    const r = await V.procesarArchivos(e.deps(), [{ drive_id: 'suelto', nombre: 'IMG_0300.MOV', mime: 'video/quicktime', carpeta_id: 'vid4', ruta: ['Tanda 1', 'Video 4'], bytes: 10,
      duracion_ms: null, ancho: null, alto: null, creado: '2026-10-24T13:14:00.000Z', modificado: '2026-10-24T13:14:00.000Z', subio: 'cliente' }],
      new Map([...e.s.carpetas.values()].map(c => [c.drive_id, c])), e.ahora())
    assert.equal(r.vinculados, 1)
    assert.equal(e.s.videos.get(1).estado, 'crudo_a_revisar')
    assert.ok(r.eventos.some(x => x.a === 'crudo_a_revisar'))
  })
  test('un crudo de la primera grabación no destraba un video que volvió a esperar por un pedido de regrabación', () => {
    const v = { estado: 'esperando_crudos', estado_desde: '2026-10-24T15:00:00.000Z', motivo_regrabar: 'audio' }
    assert.equal(V.crudoDestraba(v, { creado: '2026-10-24T13:00:00.000Z' }), false)
    assert.equal(V.crudoDestraba(v, { creado: '2026-10-24T16:00:00.000Z' }), true)
    assert.equal(V.crudoDestraba({ ...v, motivo_regrabar: null }, { creado: '2026-10-01T13:00:00.000Z' }), true)
  })
  test('pasada completa: René sube el editado a Crudos y Aylu lo pasa a Editados → toma el tipo editado, no queda "borrado" ni bloquea el video', async () => {
    const CRM = [{ id: 'A101', nombre: 'Ana Pérez', estado: 'ACTIVO' }]
    const cl = [{ carpeta: { drive_id: 'cli1', nombre: 'Ana Pérez', padre_id: 'raiz', nivel: 0, ruta: [], id_crm: 'A101', tipo: 'cliente', raiz: null, raiz_id: null, vinculo: 'aylu', candidatos: [], vigilar: false, creada: null, ultimo_archivo: null, consultada: null, borrada: null },
      crudos: 'cru1', editados: 'edi1', marca: null, guiones_doc: null, guiones_modificado: null }]
    const e = await escenario({ crm: CRM, drive: { clientes: cl } })
    e.s.carpetas.set('cli1', { ...cl[0].carpeta })
    e.nodos.push({ id: 'ren', padre: 'vid4', nombre: 'T1-V4 final.mp4', mime: 'video/mp4', creado: '2026-10-24T13:16:00.000Z', size: 10 })
    await correr(e, {}, 'completa')
    const ren = () => [...e.s.archivos.values()].find(a => a.drive_id === 'ren')
    assert.equal(ren().tipo, 'crudo')
    e.s.videos.get(1).estado = 'para_editar'
    e.nodos.find(x => x.id === 'ren').padre = 'edi1'
    e.mover('2026-10-25T13:00:00.000Z')
    await correr(e, {}, 'completa')
    assert.equal(ren().tipo, 'editado'); assert.equal(ren().borrado, null); assert.equal(ren().video_id, null)
    assert.equal(ren().propuesta_video_id, 1, 'ahora se propone como editado')
    assert.equal(e.s.videos.get(1).bloqueo, null)
    assert.equal(e.avisos.filter(a => a.tipo === 'crudo_borrado').length, 0)
  })
})

describe('revisión de la integración, ronda 3', () => {
  test('una copia marcada como duplicado no cuenta como "crudo sin transcribir" en el aviso de la tanda', async () => {
    const e = await escenario()
    await correr(e)
    e.mover('2026-10-24T14:05:00.000Z')
    await correr(e)
    const copia = [...e.s.archivos.values()].find(a => a.drive_id === 'f2')
    copia.transcripcion = { ...copia.transcripcion, estado: 'no_aplica', motivo: `${CF.MOTIVO_DUPLICADO}1` }
    e.mover('2026-10-24T14:30:00.000Z')
    await correr(e)
    const av = e.avisos.filter(a => a.tipo === 'tanda_crudos')
    assert.equal(av.length, 1)
    assert.equal(av[0].tanda.resultado.sin_transcribir.length, 2)
    assert.ok(!av[0].tanda.resultado.sin_transcribir.includes(copia.id))
  })

  test('t02 · vínculo corregido: el doc se vuelve a leer sin cambios en Drive, el video del cliente anterior se descarta y el correcto lo recibe (la línea de base sigue)', async () => {
    const DOC = 'TANDA 1°\n* Video: Para grabar\nHOOK\n¿Te despidieron y trabajabas en negro?\nCTA\nEscribime acá abajo.\n* Video: No iniciado\nHOOK\nSi firmaste la liquidación esperá un poco.\n'
    const CRM = [{ id: 'A101', nombre: 'Juan Pérez', estado: 'ACTIVO' }, { id: 'A104', nombre: 'Juan Pérez García', estado: 'ACTIVO' }]
    const cl = (id_crm, vinculo, modificado) => [{ carpeta: { drive_id: 'cli1', nombre: 'Juan Pérez', padre_id: 'raiz', nivel: 0, ruta: [], id_crm, tipo: 'cliente', raiz: null, raiz_id: null, vinculo, candidatos: [], vigilar: false, creada: null, ultimo_archivo: null, consultada: null, borrada: null },
      crudos: 'cru1', editados: 'edi1', marca: null, guiones_doc: 'doc1', guiones_modificado: modificado }]
    const e = await escenario({ crm: CRM, drive: { clientes: cl(null, 'a_confirmar', '2026-10-24T09:00:00.000Z'), docs: { doc1: DOC } } })
    e.s.videos.clear(); e.s.carpetas.clear()
    await correr(e, {}, 'completa')                                       // línea de base con el cliente equivocado (A101, por nombre exacto)
    assert.equal(e.s.docs.get('doc1').id_crm, 'A101')
    const DOC2 = DOC.replace('* Video: No iniciado', '* Video: Para grabar')
    const d2 = driveJuguete(e.nodos, { clientes: cl(null, 'a_confirmar', '2026-10-24T15:00:00.000Z'), docs: { doc1: DOC2 } })
    e.mover('2026-10-24T15:10:00.000Z')
    await V.correrVigia(e.deps({ drive: d2.lector }), { tipo: 'completa', origen: 'manual', deadline: Date.now() + 200_000 })
    const deA = [...e.s.videos.values()].filter(v => v.id_crm === 'A101')
    assert.deepEqual(deA.map(v => [v.clave, v.estado]), [['T1-V2', 'esperando_crudos']])
    // Aylu corrige la carpeta a A104 en Vínculos (confirmarVinculo baja el cliente a la carpeta y sus raíces)
    for (const c of e.s.carpetas.values()) if (c.drive_id === 'cli1' || c.padre_id === 'cli1' || ['cru1', 'edi1'].includes(c.raiz_id)) Object.assign(c, { id_crm: 'A104', vinculo: 'aylu' })
    const d3 = driveJuguete(e.nodos, { clientes: cl(null, 'a_confirmar', '2026-10-24T15:00:00.000Z'), docs: { doc1: DOC2 } })   // el doc NO cambió en Drive
    e.mover('2026-10-25T10:10:00.000Z')
    const r = await V.correrVigia(e.deps({ drive: d3.lector }), { tipo: 'completa', origen: 'manual', deadline: Date.now() + 200_000 })
    assert.equal(r.ok, true, r.errores?.join())
    assert.equal(e.s.docs.get('doc1').id_crm, 'A104', 'el doc se volvió a leer con el cliente nuevo')
    assert.equal(e.s.videos.get(deA[0].id).estado, 'descartado', 'el video del cliente anterior se descarta')
    assert.ok(e.eventos.some(x => x.video_id === deA[0].id && x.datos?.accion === 'descartar' && x.actor.tipo === 'bot'))
    const deB = [...e.s.videos.values()].filter(v => v.id_crm === 'A104')
    assert.deepEqual(deB.map(v => [v.clave, v.estado, v.origen]), [['T1-V2', 'esperando_crudos', 'doc']], 'solo el guion que había creado video; T1-V1 sigue en la línea de base')
  })
})
