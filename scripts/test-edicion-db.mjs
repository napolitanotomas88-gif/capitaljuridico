// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-db.mjs
// El repositorio de Grabación y Edición contra un Neon FALSO (lib/edicion/db/*): la migración versionada (la segunda vez no
// corre DDL, carrera entre arranques), lecturas sin tabla, moverVideo (conflicto, transición inválida, efectos: notas que se
// envían, bloqueo sin link), vínculos de otro cliente, notas (ronda abierta en corrección, solo sin enviar, tildes solo en
// corrección), pedidos del cliente (P6 en una sentencia), el candado de corridas, la tanda abierta única y la privacidad
// (el mail del actor se escribe solo en cj_video_eventos y nunca se lee). SIN red ni base real.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { neonFalso, param, errorPg, filaVideo, filaEvento, filaNota, AYLU, TOMAS, RENE, conTipo, RED_BLOQUEADA } from './edicion-juguetes.mjs'

delete process.env.DATABASE_URL
globalThis.fetch = RED_BLOQUEADA

const base = await import('../lib/edicion/db/base.ts')
const M = await import('../lib/edicion/db/migracion.ts')
const V = await import('../lib/edicion/db/videos.ts')
const A = await import('../lib/edicion/db/archivos.ts')
const T = await import('../lib/edicion/db/tandas.ts')
const C = await import('../lib/edicion/db/corridas.ts')
const S = await import('../lib/edicion/db/seguimientos.ts')
const K = await import('../lib/edicion/db/carpetas.ts')

const VERSION_OK = t => (t.startsWith('SELECT max(version)') ? [{ version: M.VERSION_ESQUEMA }] : null)
/** Neon falso con la migración ya hecha: `r` responde el resto. */
const usar = r => {
  const n = neonFalso((t, v, cs) => VERSION_OK(t) ?? r(t, v, cs) ?? [])
  base.sqlParaPruebas(n.fabrica)
  return n
}
beforeEach(() => { process.env.DATABASE_URL = 'postgres://falsa.test/db' })
afterEach(() => { base.sqlParaPruebas(null); delete process.env.DATABASE_URL })

describe('migración versionada', () => {
  test('sin esquema: corre todo el DDL en UNA transacción e inserta la versión; la segunda vez (otro arranque) no corre DDL', async () => {
    const n = neonFalso(t => { if (t.startsWith('SELECT max(version)')) throw errorPg('42P01'); return [] })
    base.sqlParaPruebas(n.fabrica)
    await base.asegurarTablas()
    const creates = n.consultas.filter(c => c.texto.startsWith('CREATE'))
    assert.equal(creates.length, M.SENTENCIAS_ESQUEMA.length)
    assert.ok(n.consultas.some(c => c.texto === 'TRANSACCION'))
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_edicion_esquema'))
    assert.deepEqual(ins.valores, [M.VERSION_ESQUEMA])
    for (const t of ['cj_videos', 'cj_video_eventos', 'cj_video_notas', 'cj_grab_archivos', 'cj_grab_transcripciones', 'cj_grab_tandas', 'cj_grab_corridas',
      'cj_grab_seguimientos', 'cj_grab_carpetas', 'cj_grab_guiones', 'cj_video_pedidos', 'cj_marca', 'cj_marca_propuestas', 'cj_edicion_avisos', 'cj_edicion_clientes']) assert.ok(M.TABLAS_EDICION.includes(t), t)
    // Índices que hacen de candado / unicidad
    const ddl = M.SENTENCIAS_ESQUEMA.join('\n')
    assert.match(ddl, /UNIQUE INDEX IF NOT EXISTS cj_grab_tandas_abierta ON cj_grab_tandas \(id_crm, tipo\) WHERE estado = 'abierta'/)
    assert.match(ddl, /UNIQUE INDEX IF NOT EXISTS cj_grab_corridas_candado ON cj_grab_corridas \(candado\) WHERE estado = 'corriendo'/)
    assert.match(ddl, /UNIQUE INDEX IF NOT EXISTS cj_edicion_avisos_pendiente ON cj_edicion_avisos \(base\) WHERE estado = 'pendiente'/)
    assert.match(ddl, /UNIQUE \(id_crm, clave\)/)
    assert.match(ddl, /clickup_id text UNIQUE/)
    assert.match(ddl, /UNIQUE \(id_crm, ciclo, escalon\)/)
    assert.match(ddl, /tr_id text UNIQUE/)
    // Una vez hecha, en el mismo proceso no se vuelve a preguntar
    const antes = n.consultas.length
    await base.asegurarTablas()
    assert.equal(n.consultas.length, antes)
    // Otro arranque en frío con la versión ya puesta: solo el SELECT
    const n2 = neonFalso(t => (t.startsWith('SELECT max(version)') ? [{ version: M.VERSION_ESQUEMA }] : []))
    base.sqlParaPruebas(n2.fabrica)
    await base.asegurarTablas()
    assert.equal(n2.consultas.length, 1)
    assert.ok(!n2.consultas.some(c => c.texto.startsWith('CREATE')))
  })

  test('carrera entre dos arranques (42P07): si el otro ya dejó la versión, no reintenta; si no, reintenta una vez', async () => {
    let versiones = 0, transacciones = 0
    const n = neonFalso(t => {
      if (t.startsWith('SELECT max(version)')) return versiones++ === 0 ? [{ version: null }] : [{ version: M.VERSION_ESQUEMA }]
      if (t.startsWith('CREATE TABLE IF NOT EXISTS cj_videos')) { transacciones++; throw errorPg('42P07') }
      return []
    })
    base.sqlParaPruebas(n.fabrica)
    await base.asegurarTablas()
    assert.equal(transacciones, 1)
    assert.equal(versiones, 2)
  })

  test('las migraciones futuras son aditivas: todo es CREATE … IF NOT EXISTS (nada de DROP ni ALTER … TYPE)', () => {
    for (const s of M.SENTENCIAS_ESQUEMA) assert.match(s, /^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/)
  })
})

describe('lecturas: no crean nada y sin tabla devuelven vacío', () => {
  test('listarVideos, leerVideo, pasosAbiertos, ultimaCorrida, listarVinculos con 42P01', async () => {
    const n = neonFalso(() => { throw errorPg('42P01', 'relation "cj_videos" does not exist') })
    base.sqlParaPruebas(n.fabrica)
    assert.deepEqual(await V.listarVideos({}), [])
    assert.equal(await V.leerVideo(7), null)
    assert.deepEqual(await S.pasosAbiertos(), [])
    assert.equal(await C.ultimaCorrida(), null)
    assert.deepEqual(await K.listarVinculos(), [])
    assert.ok(!n.consultas.some(c => /^(CREATE|SELECT max\(version\))/.test(c.texto)), 'una lectura no migra')
  })
  test('un error que no es de tabla faltante se propaga; sin conexión → ErrorTransitorio sin la URL', async () => {
    base.sqlParaPruebas(neonFalso(() => { throw errorPg('42703', 'column "x" does not exist') }).fabrica)
    await assert.rejects(V.listarVideos({}), /column "x"/)
    base.sqlParaPruebas(neonFalso(() => { throw new Error('Error connecting to database: postgres://usuario:clave@host/db') }).fabrica)
    await assert.rejects(V.listarVideos({}), e => e.transitorio === true && !/clave@host/.test(e.message))
  })
  test('leerVideo nunca pide el mail del actor', async () => {
    const n = usar(t => (t.startsWith('SELECT * FROM cj_videos') ? [filaVideo()] : []))
    await V.leerVideo(7)
    const ev = n.consultas.find(c => c.texto.includes('FROM cj_video_eventos e'))
    assert.ok(ev && !ev.texto.includes('actor_email'))
  })
})

describe('moverVideo', () => {
  const contexto = over => [{ ...filaVideo(over), n_crudos: '1', n_nuevas: '0', n_sin_tildar: '0' }]
  const responderMover = (over, extra = () => null) => (t, v, cs) => {
    if (t.startsWith('SELECT v.*, (SELECT count(*) FROM cj_grab_archivos')) return contexto(over)
    if (t.startsWith('WITH m AS ( UPDATE cj_videos SET')) {
      const c = cs[cs.length - 1]
      const estado = param(c, 'SET estado = ')
      return [{ video: { ...filaVideo(over), estado, bloqueo: param(c, 'bloqueo = '), version: (over.version ?? 3) + 1, ronda_interna: param(c, 'ronda_interna = ') },
        evento: filaEvento({ de: over.estado, a: estado }), notas_enviadas: '2' }]
    }
    return extra(t, v, cs)
  }

  test('transición válida: una sola sentencia (UPDATE con versión + evento); el evento lleva la acción', async () => {
    const n = usar(responderMover({ estado: 'para_editar', editado_url: 'https://drive.google.com/file/d/abc/view', editado_archivo_id: '5' }))
    const r = await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(RENE), ctx: {} })
    assert.equal(r.ok, true)
    assert.equal(r.actual.video.estado, 'editado')
    const w = n.consultas.find(c => c.texto.startsWith('WITH m AS'))
    assert.match(w.texto, /WHERE id = \$\d+ AND version = \$\d+ AND estado = \$\d+/)
    assert.match(w.texto, /INSERT INTO cj_video_eventos/)
    assert.equal(param(w, 'bloqueo = '), null, 'con link no hay bloqueo')
    const datos = JSON.parse(w.valores.find(x => typeof x === 'string' && x.includes('"accion"')))
    assert.equal(datos.accion, 'listo')
    assert.ok(w.valores.includes('rene@ejemplo.test'), 'el mail se escribe en el evento (auditoría)')
  })

  test('listo sin link al editado: pasa igual con el bloqueo sin_link_editado', async () => {
    const n = usar(responderMover({ estado: 'para_editar' }))
    const r = await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(RENE), ctx: {} })
    assert.equal(r.ok, true)
    const w = n.consultas.find(c => c.texto.startsWith('WITH m AS'))
    assert.equal(param(w, 'bloqueo = '), 'sin_link_editado')
  })

  test('listo con el link en el MISMO pedido (cambios.editado): no queda bloqueado', async () => {
    const n = usar(responderMover({ estado: 'para_editar' }))
    const r = await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(AYLU), ctx: {}, cambios: { editado: { archivo_id: null, url: 'https://drive.google.com/file/d/xyz/view' } } })
    assert.equal(r.ok, true)
    const w = n.consultas.find(c => c.texto.startsWith('WITH m AS'))
    assert.equal(param(w, 'bloqueo = '), null)
    assert.equal(param(w, 'editado_url = '), 'https://drive.google.com/file/d/xyz/view')
  })

  test('pedir_correccion: ronda interna + 1 y las notas nuevas pasan a enviadas EN LA MISMA sentencia', async () => {
    const n = usar((t, v, cs) => {
      if (t.startsWith('SELECT v.*, (SELECT count(*) FROM cj_grab_archivos')) return [{ ...filaVideo({ estado: 'editado' }), n_crudos: '1', n_nuevas: '2', n_sin_tildar: '0' }]
      if (t.startsWith('WITH m AS')) return responderMover({ estado: 'editado' })(t, v, cs)
      return null
    })
    const r = await V.moverVideo({ id: 7, version: 3, accion: 'pedir_correccion', actor: conTipo(AYLU), ctx: {} })
    assert.equal(r.ok, true)
    const w = n.consultas.find(c => c.texto.startsWith('WITH m AS'))
    assert.equal(param(w, 'ronda_interna = '), 1)
    assert.match(w.texto, /UPDATE cj_video_notas SET enviada = true, ronda = \$\d+/)
    assert.equal(param(w, 'UPDATE cj_video_notas SET enviada = true, ronda = '), 1)
    assert.equal(r.actual.evento.datos.notas_enviadas, 2)
  })

  test('versión vieja → conflicto con lo de ahora (sin escribir)', async () => {
    const n = usar((t) => {
      if (t.startsWith('SELECT v.*, (SELECT count(*) FROM cj_grab_archivos')) return [{ ...filaVideo({ version: 5, estado: 'editado' }), n_crudos: '0', n_nuevas: '0', n_sin_tildar: '0' }]
      if (t.startsWith('SELECT * FROM cj_videos WHERE id')) return [filaVideo({ version: 5, estado: 'editado' })]
      if (t.startsWith('SELECT e.id')) return [{ ...filaEvento(), cliente: 'Ana Pérez' }]
      return null
    })
    const r = await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(RENE), ctx: {} })
    assert.equal(r.ok, false)
    assert.equal(r.motivo, 'conflicto')
    assert.equal(r.actual.video.version, 5)
    assert.equal(r.actual.evento.actor.email, '', 'el mail no vuelve')
    assert.ok(!n.consultas.some(c => c.texto.startsWith('WITH m AS')))
  })

  test('transición inválida o rol sin permiso → no_permitido con el motivo (sin escribir)', async () => {
    const n = usar(responderMover({ estado: 'crudo_a_revisar' }))
    const r1 = await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(RENE), ctx: {} })
    assert.equal(r1.ok, false); assert.equal(r1.motivo, 'no_permitido'); assert.match(r1.detalle, /crudo_a_revisar/)
    const r2 = await V.moverVideo({ id: 7, version: 3, accion: 'sirve', actor: conTipo(RENE), ctx: {} })
    assert.equal(r2.motivo, 'no_permitido'); assert.match(r2.detalle, /rene/)
    assert.ok(!n.consultas.some(c => c.texto.startsWith('WITH m AS')))
  })

  test('no existe → no_existe; el UPDATE que no prendió (alguien se adelantó) → conflicto', async () => {
    usar(() => [])
    assert.equal((await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(RENE), ctx: {} })).motivo, 'no_existe')
    usar(t => {
      if (t.startsWith('SELECT v.*, (SELECT count(*) FROM cj_grab_archivos')) return [{ ...filaVideo(), n_crudos: '0', n_nuevas: '0', n_sin_tildar: '0' }]
      if (t.startsWith('SELECT * FROM cj_videos WHERE id')) return [filaVideo({ version: 4, estado: 'editado' })]
      return null
    })
    const r = await V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(RENE), ctx: {} })
    assert.equal(r.motivo, 'conflicto')
  })

  test('pausar guarda el previo; reanudar lo limpia', async () => {
    const n = usar(responderMover({ estado: 'editado' }))
    await V.moverVideo({ id: 7, version: 3, accion: 'pausar', actor: conTipo(AYLU), ctx: { nota: 'viaja' } })
    assert.equal(param(n.consultas.find(c => c.texto.startsWith('WITH m AS')), 'estado_previo = '), 'editado')
    const n2 = usar(responderMover({ estado: 'pausado', estado_previo: 'editado' }))
    await V.moverVideo({ id: 7, version: 3, accion: 'reanudar', actor: conTipo(AYLU), ctx: {} })
    const w = n2.consultas.find(c => c.texto.startsWith('WITH m AS'))
    assert.equal(param(w, 'SET estado = '), 'editado')
    assert.equal(param(w, 'estado_previo = '), null)
  })

  test('validación antes de tocar la base: un link que no es https se rechaza', async () => {
    const n = usar(() => null)
    await assert.rejects(V.moverVideo({ id: 7, version: 3, accion: 'listo', actor: conTipo(AYLU), ctx: {}, cambios: { editado: { archivo_id: null, url: 'http://x.test' } } }), /https/)
    assert.equal(n.consultas.length, 0)
  })
})

describe('archivos y vínculos', () => {
  test('vincularArchivo: exige que el video sea del mismo cliente; si no prende, dice por qué', async () => {
    const n = usar(t => (t.startsWith('SELECT * FROM cj_grab_archivos WHERE id') ? [{ id: '3', drive_id: 'd1', id_crm: 'A101', tipo: 'crudo', asignado_por: null, tr_estado: 'pendiente' }] : null))
    const r = await A.vincularArchivo({ archivo_id: 3, video_id: 99, actor: { tipo: 'bot', proceso: 'vigia' }, por: 'carpeta' })
    assert.equal(r.ok, false); assert.match(r.detalle, /otro cliente/)
    const w = n.consultas.find(c => c.texto.startsWith('WITH antes AS'))
    assert.match(w.texto, /v\.id_crm = f\.id_crm/)
    assert.match(w.texto, /NOT \$\d+::boolean OR f\.asignado_por IS NULL OR f\.asignado_por = 'bot'/)
  })
  test('el bot no pisa un vínculo de una persona', async () => {
    usar(t => (t.startsWith('SELECT * FROM cj_grab_archivos WHERE id') ? [{ id: '3', drive_id: 'd1', id_crm: 'A101', tipo: 'crudo', asignado_por: 'aylu', tr_estado: 'pendiente' }] : null))
    const r = await A.vincularArchivo({ archivo_id: 3, video_id: 7, actor: { tipo: 'bot', proceso: 'vigia' } })
    assert.equal(r.ok, false); assert.match(r.detalle, /persona/)
  })
  test('guardarArchivos: upsert por drive_id que solo actualiza si cambió algo; separa nuevos de movidos', async () => {
    const n = usar(t => (t.startsWith('INSERT INTO cj_grab_archivos') ? [
      { id: '1', drive_id: 'n1', id_crm: 'A101', tipo: 'crudo', ruta: ['Tanda 1'], nombre: 'IMG_1.MOV', insertado: true, tr_estado: 'pendiente', creado_drive: new Date('2026-10-24T10:00:00Z') },
      { id: '2', drive_id: 'v1', id_crm: 'A101', tipo: 'crudo', ruta: ['Tanda 2'], nombre: 'IMG_0.MOV', insertado: false, tr_estado: 'lista', creado_drive: new Date('2026-10-01T10:00:00Z') },
    ] : null))
    const r = await A.guardarArchivos('a101', 'crudo', [{ drive_id: 'n1', nombre: 'IMG_1.MOV', mime: 'video/quicktime', carpeta_id: 'c1', ruta: ['Tanda 1'], bytes: 10, duracion_ms: null, ancho: null, alto: null, creado: '2026-10-24T10:00:00Z', modificado: '2026-10-24T10:00:00Z', subio: 'cliente' }])
    assert.equal(r.nuevos.length, 1); assert.equal(r.movidos.length, 1); assert.equal(r.actualizados, 1)
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_grab_archivos'))
    assert.match(ins.texto, /ON CONFLICT \(drive_id\) DO UPDATE SET/)
    assert.match(ins.texto, /IS DISTINCT FROM/)
    assert.equal(ins.valores[0], 'A101', 'el id del CRM va en mayúsculas')
    assert.ok(!JSON.stringify(ins.valores).includes('@'), 'ningún mail')
  })
  test('reclamarTranscripcion: pendiente → enviando con condición', async () => {
    const n = usar(t => (t.startsWith('UPDATE cj_grab_archivos SET tr_estado = \'enviando\'') ? [] : null))
    assert.equal(await A.reclamarTranscripcion(3, 60), false)
    assert.match(n.consultas.at(-1).texto, /WHERE id = \$\d+ AND tr_estado = 'pendiente'/)
  })
})

describe('notas', () => {
  const conVideo = (estado, extra = () => null) => usar((t, v, cs) => {
    if (t.startsWith('SELECT * FROM cj_videos WHERE id')) return [filaVideo({ estado, ronda_interna: 1, ronda_cliente: 1 })]
    if (t.startsWith('INSERT INTO cj_video_notas')) {
      const c = cs.at(-1)
      return [filaNota({ ronda: c.valores[1], enviada: c.valores[3] })]
    }
    return extra(t, v, cs)
  })
  test('con el video editado: la nota nace en la ronda que viene, sin enviar', async () => {
    const n = conVideo('editado')
    const r = await V.crearNota({ video_id: 7, actor: AYLU, nota: { segundo: 17, hasta: null, tipo: 'texto', texto: 'mora', imagen_url: null, origen: 'aylu' } })
    assert.equal(r.ok, true)
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_video_notas'))
    assert.equal(ins.valores[1], 3, 'ronda = interna + cliente + 1'); assert.equal(ins.valores[3], false)
    assert.equal(ins.valores.at(-1), 'Aylén QA', 'creado_por = nombre, nunca el mail')
  })
  test('con el video EN corrección: se suma a la ronda abierta, ya enviada (no gasta ronda)', async () => {
    const n = conVideo('correccion')
    await V.crearNota({ video_id: 7, actor: AYLU, nota: { segundo: null, hasta: null, tipo: 'corte', texto: 'cortá el final', imagen_url: null, origen: 'cliente' } })
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_video_notas'))
    assert.equal(ins.valores[1], 2); assert.equal(ins.valores[3], true)
    const ev = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_video_eventos'))
    assert.ok(ev.valores.some(x => typeof x === 'string' && x.includes('"ronda_abierta":true')))
  })
  test('René no carga notas; imagen solo https; video aprobado no acepta notas', async () => {
    conVideo('editado')
    assert.equal((await V.crearNota({ video_id: 7, actor: RENE, nota: { segundo: 1, hasta: null, tipo: 'texto', texto: 'x', imagen_url: null, origen: 'aylu' } })).motivo, 'no_permitido')
    await assert.rejects(V.crearNota({ video_id: 7, actor: AYLU, nota: { segundo: 1, hasta: null, tipo: 'texto', texto: 'x', imagen_url: 'javascript:alert(1)', origen: 'aylu' } }), /https/)
    conVideo('aprobado')
    assert.equal((await V.crearNota({ video_id: 7, actor: AYLU, nota: { segundo: 1, hasta: null, tipo: 'texto', texto: 'x', imagen_url: null, origen: 'aylu' } })).motivo, 'no_permitido')
  })
  test('editar una nota ya enviada → no_permitido', async () => {
    usar(t => (t.startsWith('SELECT * FROM cj_video_notas WHERE id') ? [filaNota({ enviada: true })] : null))
    const r = await V.editarNota({ id: 30, version: 1, actor: AYLU, cambios: { texto: 'otra' } })
    assert.equal(r.motivo, 'no_permitido')
  })
  test('tildar: solo con el video en corrección y sobre notas enviadas', async () => {
    usar(t => (t.startsWith('SELECT n.*, v.estado AS estado_video') ? [{ ...filaNota({ enviada: true }), estado_video: 'editado' }] : null))
    let r = await V.tildarNota({ id: 30, version: 1, tildada: true, actor: RENE })
    assert.equal(r.motivo, 'no_permitido'); assert.match(r.detalle, /corrección/)
    usar(t => (t.startsWith('SELECT n.*, v.estado AS estado_video') ? [{ ...filaNota({ enviada: false }), estado_video: 'correccion' }] : null))
    r = await V.tildarNota({ id: 30, version: 1, tildada: true, actor: RENE })
    assert.equal(r.motivo, 'no_permitido'); assert.match(r.detalle, /no se mandó/)
    const n = usar(t => (t.startsWith('UPDATE cj_video_notas n SET tilde') ? [filaNota({ enviada: true, tilde: { quien: 'René', cuando: '2026-10-24T12:00:00Z' } })] : null))
    r = await V.tildarNota({ id: 30, version: 1, tildada: true, actor: RENE })
    assert.equal(r.ok, true)
    const up = n.consultas.find(c => c.texto.startsWith('UPDATE cj_video_notas n SET tilde'))
    assert.match(up.texto, /v\.estado = 'correccion'/)
    assert.ok(!up.valores.some(x => typeof x === 'string' && x.includes('rene@')), 'el tilde guarda el nombre')
  })
})

describe('pedidos del cliente (P6) en una sentencia', () => {
  const pedido = (over = {}) => ({ id: '40', video_id: '7', ronda: 0, texto: 'cambiá el título', propuesta: [{ texto: 'título más corto', tipo: 'titulo', segundo: -1, hasta: -1, afecta_rendimiento: false, motivo: '', cita: 'cambiá el título' }],
    elegidas: [], estado: 'propuesto', modelo: null, version_prompt: null, creado_por: 'Aylén QA', creado: new Date(), decidido: null, version: 1, ...over })
  const responder = (videoOver) => (t, v, cs) => {
    if (t.startsWith('SELECT p.*, row_to_json(v) AS video')) return [{ ...pedido(), video: filaVideo({ estado: 'con_cliente', ...videoOver }) }]
    if (t.startsWith('WITH g AS')) {
      const c = cs.at(-1)
      return [{ video: filaVideo({ estado: param(c, 'UPDATE cj_videos SET estado = '), bloqueo: param(c, 'bloqueo = '), ...videoOver, version: 4 }),
        pedido: pedido({ estado: param(c, 'UPDATE cj_video_pedidos SET estado = ') }), evento: filaEvento(), notas: [filaNota({ origen: 'cliente' })], viejas: '0' }]
    }
    return null
  }
  test('3.ª ronda confirmada por Aylu: el pedido espera a Tomás, bloqueo del tope y aviso (el video sigue con el cliente)', async () => {
    const n = usar(responder({ ronda_cliente: 2 }))
    const r = await V.aplicarPedidoCliente({ pedido_id: 40, version: 1, elegidas: [0], actor: AYLU })
    assert.equal(r.ok, true)
    assert.equal(r.actual.resultado, 'espera_tomas')
    assert.deepEqual(r.actual.extra.map(x => x.tipo), ['tope_rondas'])
    const w = n.consultas.find(c => c.texto.startsWith('WITH g AS'))
    assert.equal(param(w, 'UPDATE cj_video_pedidos SET estado = '), 'espera_tomas')
    assert.equal(param(w, 'UPDATE cj_videos SET estado = '), 'con_cliente')
    assert.equal(param(w, 'bloqueo = '), 'tope_rondas_cliente')
    assert.match(w.texto, /FOR UPDATE OF pp, vv/)
    assert.match(w.texto, /INSERT INTO cj_video_notas/)
  })
  test('la misma 3.ª ronda confirmada por Tomás: pasa a corrección', async () => {
    const n = usar(responder({ ronda_cliente: 2 }))
    const r = await V.aplicarPedidoCliente({ pedido_id: 40, version: 1, elegidas: [0], actor: TOMAS })
    assert.equal(r.actual.resultado, 'correccion')
    const w = n.consultas.find(c => c.texto.startsWith('WITH g AS'))
    assert.equal(param(w, 'UPDATE cj_videos SET estado = '), 'correccion')
    assert.equal(param(w, 'ronda_cliente = '), 3)
  })
  test('ninguna nota elegida = nada que corregir (no cuenta como ronda ni toca el video)', async () => {
    const n = usar((t, v, cs) => {
      if (t.startsWith('SELECT p.*, row_to_json(v) AS video')) return [{ ...pedido(), video: filaVideo({ estado: 'con_cliente' }) }]
      if (t.startsWith('WITH p AS')) return [{ pedido: pedido({ estado: 'confirmado' }), evento: filaEvento({ tipo: 'pedido' }) }]
      return null
    })
    const r = await V.aplicarPedidoCliente({ pedido_id: 40, version: 1, elegidas: [], actor: AYLU })
    assert.equal(r.actual.resultado, 'nada')
    assert.ok(!n.consultas.some(c => c.texto.includes('UPDATE cj_videos')))
  })
  test('René no confirma pedidos; autorizar es solo de Tomás', async () => {
    usar(() => null)
    assert.equal((await V.aplicarPedidoCliente({ pedido_id: 40, version: 1, elegidas: [0], actor: RENE })).motivo, 'no_permitido')
    assert.equal((await V.autorizarPedidoCliente({ pedido_id: 40, version: 1, actor: AYLU })).motivo, 'no_permitido')
  })
  test('decidirRondaCliente usa la regla de estados.ts (sin reescribirla)', () => {
    assert.deepEqual(V.decidirRondaCliente({ estado: 'con_cliente', estado_previo: null, bloqueo: null, ronda_cliente: 2 }, AYLU), { ronda: 3, requiereTomas: true })
    assert.deepEqual(V.decidirRondaCliente({ estado: 'con_cliente', estado_previo: null, bloqueo: null, ronda_cliente: 2 }, TOMAS), { ronda: 3, requiereTomas: false })
  })
})

describe('candado de corridas, tanda abierta única y otros', () => {
  test('abrirCorrida: primero marca colgadas las de más de 6 minutos; si el INSERT no prende (otra en curso) → null', async () => {
    const n = usar(t => (t.startsWith('INSERT INTO cj_grab_corridas') ? [] : null))
    assert.equal(await C.abrirCorrida('vigia', 'puente'), null)
    const [up, ins] = n.consultas.filter(c => !c.texto.startsWith('SELECT max'))
    assert.match(up.texto, /SET estado = 'colgada'/)
    assert.match(ins.texto, /ON CONFLICT \(candado\) WHERE estado = 'corriendo' DO NOTHING/)
  })
  test('asignarATanda: si otra corrida abrió la tanda (el INSERT no prende), se suma a esa', async () => {
    const n = usar(t => {
      if (t.startsWith('SELECT * FROM cj_grab_tandas WHERE id_crm')) return []
      if (t.startsWith('INSERT INTO cj_grab_tandas')) return []
      if (t.startsWith('SELECT id FROM cj_grab_tandas')) return [{ id: '12' }]
      if (t.startsWith('UPDATE cj_grab_tandas t SET')) return [{ id: '12', id_crm: 'A101', tipo: 'crudos', desde: new Date(), hasta: new Date(), archivos: 1, subio: 'cliente', estado: 'abierta', version: 2 }]
      return null
    })
    const t = await T.asignarATanda('A101', 'crudos', [{ id: 5, creado: '2026-10-24T10:00:00Z', subio: 'cliente' }], new Date('2026-10-24T10:10:00Z'))
    assert.equal(t.id, 12)
    assert.match(n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_grab_tandas')).texto, /ON CONFLICT \(id_crm, tipo\) WHERE estado = 'abierta' DO NOTHING/)
    const asig = n.consultas.find(c => c.texto.startsWith('UPDATE cj_grab_archivos SET tanda_id'))
    assert.equal(asig.valores[0], 12)
  })
  test('tandasParaCerrar: 45 minutos sin archivos Y todas las carpetas vigiladas consultadas después', async () => {
    const n = usar(() => [])
    await T.tandasParaCerrar(new Date('2026-10-24T12:00:00Z'))
    const q = n.consultas.at(-1)
    assert.match(q.texto, /c\.consultada < t\.hasta \+ make_interval\(mins => \$\d+::int\)/)
    assert.equal(q.valores[0], '2026-10-24T11:15:00.000Z')
  })
  test('decidirPaso: solo Tomás; "pausar" pausa los videos del ciclo y cancela el ciclo en la misma sentencia', async () => {
    usar(() => null)
    assert.equal((await S.decidirPaso({ id: 1, version: 1, actor: AYLU, decision: 'pausar' })).motivo, 'no_permitido')
    const n = usar(t => {
      if (t.startsWith('WITH s AS')) return [{ paso: { id: '1', id_crm: 'A101', cliente: 'Ana', ciclo: '2026-10-10', motivo: 'para_grabar', escalon: 'dia9', debido: '2026-10-23', dias_habiles: 9, videos: ['7'], responsable: 'tomas', texto: '', hecho: null, decision: 'pausar', estado: 'abierto', version: 2 },
        eventos: [filaEvento({ de: 'esperando_crudos', a: 'pausado' })], videos: [{ id: 7, cliente: 'Ana' }] }]
      if (t.startsWith('UPDATE cj_grab_seguimientos SET estado = \'cancelado\'')) return [{ id: '1', id_crm: 'A101', cliente: 'Ana', ciclo: '2026-10-10', motivo: 'para_grabar', escalon: 'dia9', debido: '2026-10-23', dias_habiles: 9, videos: ['7'], responsable: 'tomas', estado: 'cancelado', decision: 'pausar', version: 3 }]
      return null
    })
    const r = await S.decidirPaso({ id: 1, version: 1, actor: TOMAS, decision: 'pausar' })
    assert.equal(r.ok, true)
    assert.equal(r.actual.paso.estado, 'cancelado')
    assert.equal(r.actual.eventos.length, 1)
    const w = n.consultas.find(c => c.texto.startsWith('WITH s AS'))
    assert.match(w.texto, /UPDATE cj_videos SET estado = 'pausado', estado_previo = 'esperando_crudos'/)
    assert.match(w.texto, /UPDATE cj_grab_seguimientos SET estado = 'cancelado'/)
  })
  test('registrarEnvio link_final con un video que no está con el cliente → no_permitido', async () => {
    usar(t => (t.startsWith('SELECT * FROM cj_videos WHERE id') ? [filaVideo({ estado: 'editado' })] : null))
    const [r] = await V.registrarEnvio({ items: [{ id: 7, version: 3 }], tipo: 'link_final', texto: 'Hola, acá está tu video', actor: AYLU })
    assert.equal(r.motivo, 'no_permitido')
  })
  test('crearVideoSiFalta: clave T-V o CU-; ON CONFLICT DO NOTHING y, si ya estaba, lo devuelve sin evento', async () => {
    usar(() => null)
    await assert.rejects(V.crearVideoSiFalta({ id_crm: 'A101', cliente: 'Ana', clave: 'Tnull-V7', tanda_guion: null, numero: 7, guion: null, guion_texto: '', gancho: '', estado: 'esperando_crudos', prioridad: 'normal', origen: 'clickup', clickup_id: '86abc' }, { tipo: 'bot', proceso: 'importacion' }), /clave/)
    const n = usar(t => (t.startsWith('WITH v AS') ? [] : t.startsWith('SELECT * FROM cj_videos WHERE (id_crm') ? [filaVideo({ clave: 'T1-V2' })] : null))
    const r = await V.crearVideoSiFalta({ id_crm: 'a101', cliente: 'Ana', clave: 'T1-V2', tanda_guion: 1, numero: 2, guion: null, guion_texto: '', gancho: '', estado: 'esperando_crudos', prioridad: 'normal', origen: 'doc', clickup_id: null }, { tipo: 'bot', proceso: 'diario' })
    assert.equal(r.creado, false); assert.equal(r.evento, null)
    assert.match(n.consultas.find(c => c.texto.startsWith('WITH v AS')).texto, /ON CONFLICT DO NOTHING/)
  })
})

describe('revisión (24/10)', () => {
  test('guardarArchivos: el mismo drive_id dos veces en el lote va UNA vez (si no, Postgres da 21000); movido de raíz o de cliente toma tipo e id_crm', async () => {
    const n = usar(() => null)
    const a = { drive_id: 'n1', nombre: 'IMG_1.MOV', mime: 'video/quicktime', carpeta_id: 'c1', ruta: ['Tanda 1'], bytes: 10, duracion_ms: null, ancho: null, alto: null, creado: '2026-10-24T10:00:00Z', modificado: '2026-10-24T10:00:00Z', subio: 'cliente' }
    await A.guardarArchivos('a101', 'crudo', [a, { ...a }, { ...a, drive_id: 'n2' }])
    const ins = n.consultas.find(c => c.texto.startsWith('INSERT INTO cj_grab_archivos'))
    const lote = JSON.parse(ins.valores.find(x => typeof x === 'string' && x.startsWith('[')))
    assert.deepEqual(lote.map(x => x.drive_id), ['n1', 'n2'])
    assert.match(ins.texto, /tipo = EXCLUDED\.tipo, id_crm = EXCLUDED\.id_crm/)
    assert.match(ins.texto, /video_id = CASE WHEN \(cj_grab_archivos\.tipo, cj_grab_archivos\.id_crm\) IS DISTINCT FROM/)
  })
  test('guardarArbol y anotarConsultas: una fila por carpeta', async () => {
    const n = usar(() => null)
    const c = { drive_id: 'sub1', nombre: 'Video 1', padre_id: 't3', nivel: 2, ruta: ['Tanda 3', 'Video 1'], id_crm: 'A101', tipo: 'sub', raiz: 'crudos', raiz_id: 'cru1', vinculo: 'aylu', candidatos: [], vigilar: true, creada: null, ultimo_archivo: null, consultada: null, borrada: null }
    await K.guardarArbol([c, { ...c }])
    const lote = JSON.parse(n.consultas.find(x => x.texto.startsWith('INSERT INTO cj_grab_carpetas')).valores[0])
    assert.equal(lote.length, 1)
    await K.anotarConsultas([{ drive_id: 'sub1', cuando: '2026-10-24T10:00:00Z', ultimo_archivo: null }, { drive_id: 'sub1', cuando: '2026-10-24T10:00:00Z', ultimo_archivo: '2026-10-24T09:00:00Z' }])
    const xs = JSON.parse(n.consultas.find(x => x.texto.startsWith('UPDATE cj_grab_carpetas c SET consultada')).valores[0])
    assert.deepEqual(xs, [{ drive_id: 'sub1', cuando: '2026-10-24T10:00:00Z', ultimo_archivo: '2026-10-24T09:00:00Z' }])
  })
  test('tandas: una "comparando" colgada vuelve a la lista; soltarComparacion la devuelve a "cerrada"', async () => {
    const n = usar(() => null)
    await T.tandasParaComparar(new Date('2026-10-24T15:00:00Z'))
    assert.match(n.consultas.at(-1).texto, /t\.estado = 'comparando' AND \(t\.comparando_desde IS NULL OR t\.comparando_desde < \$\d+::timestamptz\)/)
    await T.soltarComparacion(5)
    assert.match(n.consultas.at(-1).texto, /SET estado = 'cerrada'.*WHERE id = \$\d+ AND estado = 'comparando'/)
  })
  test('P6: con un pedido ya esperando a Tomás, otro pedido no se confirma (ni Aylu ni Tomás): no quedan dos colgados', async () => {
    const pedido = { id: '41', video_id: '7', ronda: 0, texto: 'otro', propuesta: [{ texto: 'x', tipo: 'texto', segundo: -1, hasta: -1, afecta_rendimiento: false, motivo: '', cita: 'otro' }],
      elegidas: [], estado: 'propuesto', modelo: null, version_prompt: null, creado_por: 'Aylu', creado: new Date(), decidido: null, version: 1 }
    for (const actor of [AYLU, TOMAS]) {
      const n = usar(t => (t.startsWith('SELECT p.*, row_to_json(v) AS video') ? [{ ...pedido, video: filaVideo({ estado: 'con_cliente', ronda_cliente: 2, bloqueo: 'tope_rondas_cliente' }) }] : null))
      const r = await V.aplicarPedidoCliente({ pedido_id: 41, version: 1, elegidas: [0], actor })
      assert.equal(r.ok, false); assert.equal(r.motivo, 'no_permitido'); assert.match(r.detalle, /esperando el OK de Tomás/)
      assert.ok(!n.consultas.some(c => c.texto.startsWith('WITH g AS')), 'no escribe nada')
    }
  })
  test('crearNota con el video en corrección devuelve su evento (para el aviso a René)', async () => {
    usar(t => {
      if (t.startsWith('SELECT * FROM cj_videos WHERE id')) return [filaVideo({ estado: 'correccion', ronda_interna: 1 })]
      if (t.startsWith('INSERT INTO cj_video_notas')) return [filaNota({ enviada: true, ronda: 1 })]
      if (t.startsWith('INSERT INTO cj_video_eventos')) return [filaEvento({ tipo: 'nota' })]
      return null
    })
    const r = await V.crearNota({ video_id: 7, actor: AYLU, nota: { segundo: 17, hasta: null, tipo: 'texto', texto: 'mora', imagen_url: null, origen: 'aylu' } })
    assert.equal(r.evento.tipo, 'nota'); assert.equal(r.evento.cliente, 'Ana Pérez')
    assert.ok(!JSON.stringify(r.evento).includes('@'), 'el evento leído no trae el mail del actor')
  })
})

describe('revisión de la integración, ronda 3', () => {
  const archivo = { drive_id: 'ed1', nombre: 'Video 3 final.mp4', mime: 'video/mp4', carpeta_id: 'editadosB', ruta: [], bytes: 1, duracion_ms: null, ancho: null, alto: null, creado: '2026-10-24T10:00:00Z', modificado: '2026-10-24T12:00:00Z', subio: 'equipo' }
  const filaArchivo = { id: '55', drive_id: 'ed1', nombre: 'Video 3 final.mp4', mime: 'video/mp4', carpeta_id: 'editadosB', ruta: [], tipo: 'editado', id_crm: 'B202', video_id: null, asignado_por: null,
    propuesta_video_id: null, tanda_id: null, tr_estado: 'no_aplica', creado_drive: new Date(), modificado_drive: new Date(), visto: new Date(), insertado: false }
  test('t01 · un editado que pasa a los Editados de OTRO cliente suelta el link del video del cliente anterior', async () => {
    const n = usar(t => (t.startsWith('INSERT INTO cj_grab_archivos') ? [filaArchivo] : null))
    const r = await A.guardarArchivos('B202', 'editado', [archivo])
    assert.equal(r.movidos.length, 1)
    const s = n.consultas.find(c => c.texto.includes('editado_archivo_id = NULL'))
    assert.ok(s, 'se manda la sentencia que suelta el link')
    assert.deepEqual(s.valores[0], [55])
    assert.match(s.texto, /a\.tipo <> 'editado' OR a\.id_crm <> v\.id_crm/)
    assert.match(s.texto, /pasó a los Editados de otro cliente/)
  })

  test('t02 · corregir el cliente de una carpeta suelta video, propuesta y tanda de los archivos, el editado y bloquea los videos del anterior, en UNA sentencia', async () => {
    const n = usar(t => (t.startsWith('WITH c AS') ? [{ carpeta: { drive_id: 'carpetaCliente01', id_crm: 'B202', tipo: 'cliente', vinculo: 'aylu', nombre: 'Juan Pérez' }, hijas: 3, archivos: 2, videos: 1 }] : null))
    const r = await K.confirmarVinculo({ drive_id: 'carpetaCliente01', id_crm: 'b202', actor: conTipo(AYLU) })
    assert.equal(r.ok, true)
    const q = n.consultas.find(c => c.texto.startsWith('WITH c AS'))
    assert.match(q.texto, /video_id = NULL, asignado_por = NULL, propuesta_video_id = NULL, tanda_id = NULL, modificado_drive = NULL/)
    assert.match(q.texto, /editado_archivo_id = CASE WHEN p\.editado THEN NULL/)
    assert.match(q.texto, /THEN 'crudo_borrado' ELSE v\.bloqueo END/)
    assert.match(q.texto, /INSERT INTO cj_video_eventos/)
    assert.match(q.texto, /UPDATE cj_grab_tandas t SET estado = 'avisada'/)
    // Un solo UPDATE sobre cj_videos (dos sobre la misma fila en una sentencia: Postgres aplica uno solo)
    assert.equal((q.texto.match(/UPDATE cj_videos/g) ?? []).length, 1)
    assert.ok(q.valores.includes(K.MOTIVO_VINCULO_CORREGIDO))
    assert.ok(!q.valores.includes(AYLU.email) || q.texto.includes('actor_email'), 'el mail solo va a cj_video_eventos')
  })

  test('t06 · crudos sin ubicar: solo videos y audios, sin las copias marcadas como duplicado', async () => {
    const n = usar(() => null)
    await A.estadoArchivos('2026-10-01T00:00:00Z')
    const q = n.consultas.find(c => c.texto.startsWith('SELECT id_crm, creado_drive, subio'))
    assert.match(q.texto, /\(mime LIKE 'video\/%' OR mime LIKE 'audio\/%'\)/)
    assert.match(q.texto, /NOT \(tr_estado = 'no_aplica' AND tr_motivo LIKE \$\d+\)/)
    assert.ok(q.valores.includes('duplicado de #%'))
  })

  test('t05 · actualizarVideo: origen solo pasa de doc a aylu (y se escribe)', async () => {
    const n = usar(t => {
      if (t.startsWith('SELECT * FROM cj_videos WHERE id')) return [filaVideo({ estado: 'esperando_crudos', origen: 'doc' })]
      if (t.startsWith('WITH m AS')) return [{ video: filaVideo({ estado: 'esperando_crudos', origen: 'aylu', version: 2 }), evento: filaEvento({ tipo: 'envio_cliente' }), notas_enviadas: 0 }]
      return null
    })
    const r = await V.actualizarVideo({ id: 7, version: 3, actor: conTipo(AYLU), cambios: { origen: 'aylu' }, tipo: 'envio_cliente' })
    assert.equal(r.ok, true)
    const w = n.consultas.find(c => c.texto.startsWith('WITH m AS'))
    assert.equal(param(w, 'origen = '), 'aylu')
    await assert.rejects(V.actualizarVideo({ id: 7, version: 1, actor: conTipo(AYLU), cambios: { origen: 'clickup' }, tipo: 'envio_cliente' }), /origen/)
  })
})
