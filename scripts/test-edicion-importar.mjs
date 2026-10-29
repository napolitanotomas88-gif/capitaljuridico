// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-edicion-importar.mjs
// Importación desde ClickUp en modo prueba (lib/edicion/importar.ts y scripts/edicion-importar-clickup.mjs): un volcado DE
// JUGUETE → propuesta en JSON, las equivalencias de estado, la clave (T-V o CU-), crudo y editado de Drive, la paleta (hex,
// URL, texto y capturas SIN la URL del adjunto), el cruce con el CRM y lo que queda sin cruzar, y cargarPropuesta contra un
// repositorio falso (idempotente por clickup_id). SIN red. Los nombres, ids y links son inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const I = await import('../lib/edicion/importar.ts')

const D1 = 'fixture-google-id-000000000000000000000005', D2 = 'fixture-google-id-000000000000000000000007', D3 = 'fixture-google-id-000000000000000000000008'
const cu = (id, name, status, over = {}) => ({
  id, name, status: { status }, parent: null, url: `https://app.clickup.com/t/${id}`, priority: null, date_created: '1761000000000', date_updated: '1761200000000',
  custom_fields: [{ name: '1 - Paleta de Color', value: null }, { name: '2 - Crudo', value: null }, { name: '3 - Editado', value: null }], tags: [], ...over,
})
const campos = (paleta, crudo, editado) => [{ name: '1 - Paleta de Color', value: paleta }, { name: '2 - Crudo', value: crudo }, { name: '3 - Editado', value: editado }]
const com = (texto, extra = {}) => ({ comment_text: texto, date: '1761100000000', comment: [], user: { username: 'Alguien', email: 'alguien@ejemplo.test' }, ...extra })

const CRUDAS = [
  cu('p1', 'Ana Pérez', 'para editar', { custom_fields: campos('Verde petróleo #1E4740 Bordó #6B2737', null, null) }),
  cu('v1', 'video 1', 'para editar', { parent: 'p1', priority: { priority: 'urgent' }, custom_fields: campos(null, `https://drive.google.com/file/d/${D1}/view?usp=drive_link`, null) }),
  cu('v2', 'video 2 tanda 3', 'revisión', { parent: 'p1', custom_fields: campos(null, `https://drive.google.com/drive/folders/${D2}?usp=drive_link`, `https://drive.google.com/file/d/${D3}/view?usp=drive_link`) }),
  cu('v3', 'video 3', 'publicado', { parent: 'p1' }),
  cu('v4', 'video 4', 'en espera de datos', { parent: 'p1' }),
  cu('p2', 'Bruno Gómez y Asociados', 'revisión', { custom_fields: campos('https://t9017906266.p.clickup-attachments.com/t9017906266/xyz/paleta.png', null, null) }),
  cu('v5', 'video 1', 'editado', { parent: 'p2', custom_fields: campos(null, 'https://fromsmash.com/VIDEO-1-X', `https://drive.google.com/file/d/${D3}/view?usp=sharing`) }),
  cu('p3', 'Cliente Misterioso', 'para editar'),
  cu('v6', 'video 1', 'para editar', { parent: 'p3' }),
  cu('p4', 'Carla Díaz', 'corregido', { custom_fields: campos('Azul oscuro noche o gris', null, null) }),
  cu('v7', 'video 2', 'corregido', { parent: 'p4' }),
  cu('v8', 'video 9', 'estado raro', { parent: 'p4' }),
]
const COMENTARIOS = {
  v1: [com('¿Te despidieron sin causa?\n'), com('¿Te despidieron sin causa y no te pagaron?\n\nPROBLEMA\nVelocidad 3\nSOLUCIÓN\nTe ayudamos.\nCTA\nEscribinos al 11 5555-1234'), com('seg 7 "mora"')],
  p4: [com('image.png\n', { comment: [{ type: 'image' }] })],
}
const CRM = [
  { id: 'a101', nombre: 'Ana Pérez', estado: 'ACTIVO' },
  { id: 'A102', nombre: 'Bruno Gómez', estado: 'PAUSADO' },
  { id: 'A103', nombre: 'Carla Díaz', estado: 'ACTIVO' },
  { id: 'A104', nombre: 'Misterio Fernández', estado: 'ACTIVO' },
]
const tareas = () => CRUDAS.map(t => I.tareaDesdeClickUp(t, COMENTARIOS[t.id] ?? []))
const AHORA = '2026-10-24T20:00:00.000Z'

describe('mapearTareas', () => {
  const prop = I.mapearTareas(tareas(), CRM, { fechaCorte: '2026-10-27', ahora: AHORA })
  const v = id => prop.videos.find(x => x.clickup_id === id)

  test('equivalencias: para editar → para_editar, revisión → con_cliente (confirmar con Aylu), espera → esperando_crudos; publicado no entra', () => {
    assert.equal(v('v1').estado, 'para_editar')
    assert.equal(v('v2').estado, 'con_cliente')
    assert.ok(v('v2').confirmar_con_aylu.some(x => /revisión/.test(x)))
    assert.equal(v('v4').estado, 'esperando_crudos')
    assert.equal(v('v4').estado_desde, '2026-10-27T03:00:00.000Z', 'e01 arranca en la fecha de corte (00:00 de Argentina)')
    assert.equal(v('v5').estado, 'editado')
    assert.equal(v('v7').estado, 'corregido')
    assert.equal(v('v3'), undefined, 'publicado no se importa')
    assert.equal(prop.conteo['omitido:publicado'], 1)
    assert.ok(prop.omitidas.some(o => o.tarea_id === 'v8' && /desconocido/.test(o.motivo)))
  })
  test('clave: "video 2 tanda 3" → T3-V2; "video 1" sin tanda → CU-<id> (nunca Tnull-V1)', () => {
    assert.equal(v('v2').clave, 'T3-V2')
    assert.equal(v('v2').tanda_guion, 3); assert.equal(v('v2').numero, 2)
    assert.equal(v('v1').clave, 'CU-v1')
    assert.ok(!prop.videos.some(x => /null/.test(x.clave)))
    assert.deepEqual(I.leerNombreVideo('Video 12 Tanda 2'), { numero: 12, tanda: 2 })
    assert.deepEqual(I.leerNombreVideo('T2 V4'), { numero: 4, tanda: 2 })
    assert.deepEqual(I.leerNombreVideo('video'), { numero: null, tanda: null })
  })
  test('crudo y editado de Drive: id y link normalizado; un crudo que no es de Drive queda como "otro" y se avisa', () => {
    assert.deepEqual(v('v1').crudo, { drive_id: D1, tipo: 'archivo', url: `https://drive.google.com/file/d/${D1}/view` })
    assert.deepEqual(v('v2').crudo, { drive_id: D2, tipo: 'carpeta', url: `https://drive.google.com/drive/folders/${D2}` })
    assert.deepEqual(v('v2').editado, { drive_id: D3, url: `https://drive.google.com/file/d/${D3}/view` })
    assert.equal(v('v5').crudo.tipo, 'otro')
    assert.ok(v('v5').confirmar_con_aylu.some(x => /no es un link de Drive/.test(x)))
    assert.ok(v('v7').confirmar_con_aylu.some(x => /falta el link al editado/.test(x)), 'corregido sin editado se avisa')
  })
  test('con el cliente lleva la constancia "importado de ClickUp"; prioridad urgent → urgente', () => {
    assert.match(v('v2').envio_link.texto, /importado de ClickUp/)
    assert.equal(v('v1').envio_link, null)
    assert.equal(v('v1').prioridad, 'urgente')
    assert.equal(v('v2').prioridad, 'normal')
  })
  test('gancho y guion de los comentarios (las correcciones "seg 7…" no cuentan)', () => {
    assert.equal(v('v1').gancho, '¿Te despidieron sin causa?')
    assert.match(v('v1').guion_texto, /^¿Te despidieron sin causa y no te pagaron\?\n\nPROBLEMA/)
    assert.ok(!/seg 7/.test(v('v1').guion_texto))
  })
  test('paleta: hex a colores; un adjunto de ClickUp NUNCA va como URL (va el link a la tarea); texto suelto a notas; captura en comentario', () => {
    const m = id => prop.marcas.find(x => x.id_crm === id)?.ficha
    assert.deepEqual(m('A101').colores, [{ hex: '#1E4740', nombre: 'Verde petróleo' }, { hex: '#6B2737', nombre: 'Bordó' }])
    assert.equal(m('A101').fuentes.colores.origen, 'clickup')
    assert.equal(m('A102').referencia.url, 'https://app.clickup.com/t/p2')
    assert.match(m('A103').notas, /Azul oscuro noche o gris/)
    assert.match(m('A103').referencia.descripcion, /captura en ClickUp \(comentario del \d\d\/\d\d\)/)
    assert.equal(m('A103').referencia.url, 'https://app.clickup.com/t/p4')
    assert.ok(!JSON.stringify(prop).includes('clickup-attachments'), 'ninguna URL de adjunto en la propuesta')
  })
  test('cruce con el CRM por nombre (id en mayúsculas); lo que no cruza va a sin_cruzar con sus candidatos', () => {
    assert.equal(v('v1').id_crm, 'A101')
    assert.equal(v('v5').id_crm, 'A102', '"Bruno Gómez y Asociados" cruza con Bruno Gómez')
    assert.ok(prop.avisos.some(a => /Bruno Gómez \(A102\).*PAUSADO/.test(a)), 'cliente no activo en el CRM')
    const s = prop.sin_cruzar.find(x => x.tarea_id === 'p3')
    assert.ok(s, 'Cliente Misterioso no cruza')
    assert.equal(s.videos, 1)
    assert.equal(v('v6'), undefined)
  })
  test('sin datos personales: ni mails, ni teléfonos del CRM, ni autores de comentarios', () => {
    const t = JSON.stringify(prop)
    assert.ok(!t.includes('alguien@ejemplo.test') && !t.includes('Alguien'))
  })
  test('candidatos por parecido: un tipeo ("Cempos"/"Campos") y un apodo ("Flor"/"Florencia") suman; las tarjetas cerradas solo se cuentan', () => {
    const crm = [{ id: 'A1', nombre: 'Javier De Campos', estado: 'ACTIVO' }, { id: 'A2', nombre: 'Javier Soler', estado: 'ACTIVO' }, { id: 'A3', nombre: 'Florencia Barros', estado: 'ACTIVO' }]
    const c = I.candidatos('Javier De Cempos', crm)
    assert.equal(c[0].id_crm, 'A1'); assert.equal(c[0].puntaje, 1.8)
    assert.equal(I.candidatos('Flor y Gianfranco', crm)[0].id_crm, 'A3')
    const p = I.mapearTareas([cu('pz', 'Ana Pérez', 'publicado'), cu('vz', 'video 1', 'publicado', { parent: 'pz' })].map(t => I.tareaDesdeClickUp(t)), CRM, { fechaCorte: '2026-10-27', ahora: AHORA })
    assert.equal(p.conteo.tarjetas_cerradas, 1); assert.equal(p.omitidas.length, 0)
  })
  test('una clave repetida en el mismo cliente pasa a CU-<id>', () => {
    const dos = [cu('p9', 'Ana Pérez', 'para editar'), cu('x1', 'video 1 tanda 1', 'para editar', { parent: 'p9' }), cu('x2', 'Video 1 Tanda 1', 'para editar', { parent: 'p9' })]
    const p = I.mapearTareas(dos.map(t => I.tareaDesdeClickUp(t)), CRM, { fechaCorte: '2026-10-27', ahora: AHORA })
    assert.deepEqual(p.videos.map(x => x.clave).sort(), ['CU-x2', 'T1-V1'])
  })
})

describe('cargarPropuesta (repositorio falso: NO se ejecuta en esta etapa)', () => {
  const repoFalso = (existentes = []) => {
    const videos = [...existentes], marcas = new Map(), llamadas = []
    let n = 100
    return {
      videos, llamadas, marcas,
      repo: {
        listarVideos: async f => videos.filter(x => x.id_crm === f.id_crm),
        crearVideoSiFalta: async (nv, actor) => {
          llamadas.push(['crear', nv.clave, actor])
          const ya = videos.find(x => x.id_crm === nv.id_crm && x.clave === nv.clave)
          if (ya) return { video: ya, creado: false }
          const v = { id: ++n, version: 1, ...nv }
          videos.push(v)
          return { video: v, creado: true }
        },
        actualizarVideo: async p => { llamadas.push(['actualizar', p.id, p.tipo, p.cambios, p.datos]); const v = videos.find(x => x.id === p.id); if (v) Object.assign(v, p.cambios); return { ok: true } },
        tieneAccionesDePersonas: async () => false,
        leerMarca: async id => marcas.get(id) ?? null,
        guardarMarca: async (id, ficha) => { marcas.set(id, ficha); return { ok: true } },
      },
    }
  }
  const prop = I.mapearTareas(tareas(), CRM, { fechaCorte: '2026-10-27', ahora: AHORA })
  test('crea con origen clickup y anota el editado, la constancia y el crudo en el evento "importado"; la segunda vez no duplica', async () => {
    const f = repoFalso()
    const r = await I.cargarPropuesta(prop, f.repo)
    assert.equal(r.creados, prop.videos.length)
    assert.ok(f.videos.every(x => x.origen === 'clickup' && x.clickup_id))
    const act = f.llamadas.find(l => l[0] === 'actualizar' && l[3].envio_link)
    assert.equal(act[2], 'importado')
    assert.ok(act[3].editado.url.startsWith('https://drive.google.com/file/d/'))
    assert.ok(f.llamadas.filter(l => l[0] === 'actualizar').every(l => l[4].clickup.id && 'crudo' in l[4]))
    assert.equal(r.marcas, prop.marcas.length)
    const otra = await I.cargarPropuesta(prop, f.repo)
    assert.equal(otra.creados, 0)
    assert.equal(otra.ya_estaban, prop.videos.length, 'idempotente por clickup_id')
    assert.equal(otra.marcas, 0, 'no pisa una marca existente')
  })
  test('un video del doc en espera y sin acciones de personas se completa; si ya avanzó, queda como conflicto para Aylu', async () => {
    const T3V2 = prop.videos.find(x => x.clave === 'T3-V2')
    const enEspera = { id: 5, version: 2, id_crm: T3V2.id_crm, clave: 'CU-v4', origen: 'doc', estado: 'esperando_crudos', clickup_id: null }
    const avanzado = { id: 6, version: 3, id_crm: T3V2.id_crm, clave: 'T3-V2', origen: 'doc', estado: 'para_editar', clickup_id: null }
    const f = repoFalso([enEspera, avanzado])
    const r = await I.cargarPropuesta(prop, f.repo)
    assert.equal(r.completados, 1)
    assert.ok(r.conflictos.some(c => c.clave === 'T3-V2' && /lo decide Aylu/.test(c.motivo)))
  })
  test('revisión: "completado con ClickUp" completa de verdad (id de ClickUp, prioridad, gancho vacío) y la segunda carga no repite el evento', async () => {
    const enEspera = prop.videos.find(x => x.estado === 'esperando_crudos')
    assert.ok(enEspera, 'la propuesta de juguete trae un video en espera')
    const delDoc = { id: 7, version: 1, id_crm: enEspera.id_crm, clave: enEspera.clave, origen: 'doc', estado: 'esperando_crudos', clickup_id: null, gancho: '' }
    const f = repoFalso([delDoc])
    const solo = { ...prop, videos: [enEspera], marcas: [] }
    const r1 = await I.cargarPropuesta(solo, f.repo)
    assert.equal(r1.completados, 1)
    const act = f.llamadas.find(l => l[0] === 'actualizar' && l[1] === 7)
    assert.equal(act[3].clickup_id, enEspera.clickup_id)
    assert.equal(act[3].prioridad, enEspera.prioridad)
    if (enEspera.gancho) assert.equal(act[3].gancho, enEspera.gancho)
    const r2 = await I.cargarPropuesta(solo, f.repo)
    assert.equal(r2.completados, 0); assert.equal(r2.ya_estaban, 1)
    assert.equal(f.llamadas.filter(l => l[0] === 'actualizar' && l[1] === 7).length, 1, 'un solo evento "importado"')
  })
})

describe('el script (sin red): volcado de juguete → propuesta en JSON', () => {
  test('--desde-volcado con --crm escribe la propuesta (en --salida) y no sale a la red', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edicion-importar-'))
    try {
      writeFileSync(join(dir, 'tareas.json'), JSON.stringify({ edicion: CRUDAS, comentarios: COMENTARIOS }))
      writeFileSync(join(dir, 'crm.json'), JSON.stringify(CRM))
      const raiz = fileURLToPath(new URL('../', import.meta.url))
      const env = { ...process.env, CLICKUP_TOKEN: '', DATABASE_URL: 'postgres://no-se-usa.test/db' }
      const salida = execFileSync(process.execPath, ['--experimental-strip-types', '--import', './scripts/ts-resolve.mjs', '--no-warnings', 'scripts/edicion-importar-clickup.mjs',
        '--desde-volcado', join(dir, 'tareas.json'), '--crm', join(dir, 'crm.json'), '--fecha-corte', '2026-10-27', '--salida', join(dir, 'salida')], { cwd: raiz, env, encoding: 'utf8' })
      assert.match(salida, /Propuesta imp1-.*: 5 videos de 3 clientes · 3 fichas de marca · 1 tarjetas sin cruzar/)
      const archivo = salida.match(/Archivo: (.+\.json)/)[1]
      const prop = JSON.parse(readFileSync(archivo, 'utf8'))
      assert.equal(prop.fecha_corte, '2026-10-27')
      assert.ok(!JSON.stringify(prop).includes('clickup-attachments'))
      assert.ok(readdirSync(join(dir, 'salida')).some(n => n.startsWith('propuesta-')))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
