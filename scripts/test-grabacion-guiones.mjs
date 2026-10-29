// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-grabacion-guiones.mjs
// Docs "Guiones - X" de juguete (lib/bot/grabacion/guiones.ts): tandas, chips "Video: …", secciones, frases cortas, huella,
// y el plan de altas (línea de base, solo lo que PASA a "Para grabar", fecha de corte, freno de 10, vínculo con lo importado
// de ClickUp, guion cambiado y posible duplicado de CU-…). Puro: sin red ni base.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const G = await import('../lib/bot/grabacion/guiones.ts')

const DOC = `Guiones - AnaP

TANDA 1°

* Video: Para grabar
Despido sin causa
HOOK
(Cámara frontal, mirando fijo. Velocidad 5) ¿Te despidieron y trabajabas en negro? Eso no te deja afuera.
PROBLEMA
Velocidad 3 (sentate con una hoja) La empresa te dice que no te corresponde nada. Y vos firmás.
SOLUCIÓN
Estar en negro no te quita la indemnización. Te la agranda.
CTA
Escribime acá abajo y contame cuántos años trabajaste.

* Video: Grabado completo
HOOK
¿Firmaste la liquidación? Ojo.
PROBLEMA
Muchos creen que ya está.
SOLUCIÓN
Firmar no cierra la puerta al reclamo.
CTA
Escribime acá abajo.

* Video: No iniciado

TANDA 2°

* Video: No iniciado
HOOK
Si te empujan a renunciar, esperá.
PROBLEMA
Te cambian el horario.
SOLUCIÓN
Eso tiene nombre: despido indirecto.
CTA
Contame qué te hicieron.
`

describe('parsearDocGuiones', () => {
  const d = G.parsearDocGuiones(DOC, 'doc1', 'a101', '2026-10-24T10:00:00Z', '2026-10-24T11:00:00Z')
  test('tandas, numeración por tanda, chips y el desplegable vacío de la plantilla afuera', () => {
    assert.equal(d.id_crm, 'A101')
    assert.deepEqual(d.guiones.map(g => [g.ref, g.estado_doc]), [['T1-V1', 'para_grabar'], ['T1-V2', 'grabado_completo'], ['T2-V1', 'no_iniciado']])
    assert.deepEqual(d.avisos, [])
  })
  test('secciones sin indicaciones ni "Velocidad N"; título; frases de menos de 3 palabras juntas con la siguiente', () => {
    const g = d.guiones[0]
    assert.equal(g.titulo, 'Despido sin causa')
    assert.equal(g.secciones.hook, '¿Te despidieron y trabajabas en negro? Eso no te deja afuera.')
    assert.ok(!/velocidad|cámara|hoja/i.test(Object.values(g.secciones).join(' ')))
    assert.deepEqual(g.frases.slice(0, 3), ['¿Te despidieron y trabajabas en negro?', 'Eso no te deja afuera.', 'La empresa te dice que no te corresponde nada.'])
    assert.ok(g.frases.includes('Y vos firmás.'), '3 palabras: queda sola')
    assert.equal(d.guiones[1].frases[0], '¿Firmaste la liquidación? Ojo.', 'una frase de 1 palabra se junta (al final, con la anterior)')
    assert.ok(g.frases.every(f => G.normalizar(f).split(' ').length >= 3))
    assert.equal(G.ganchoGuion(g), '¿Te despidieron y trabajabas en negro?')
    assert.match(G.textoGuion(g), /^HOOK\n¿Te despidieron/)
  })
  test('la huella no cambia con acentos, mayúsculas ni signos; sí con el contenido', () => {
    assert.equal(G.huellaTexto('¿Te DESPIDIERON?'), G.huellaTexto('te despidieron'))
    assert.notEqual(G.huellaTexto('te despidieron'), G.huellaTexto('te contrataron'))
    const otra = G.parsearDocGuiones(DOC.replace('Te la agranda.', 'Te la duplica.'), 'doc1', 'A101', '', '')
    assert.notEqual(otra.guiones[0].huella, d.guiones[0].huella)
    assert.equal(otra.guiones[1].huella, d.guiones[1].huella)
  })
  test('sin títulos TANDA: todo en la tanda 1 y un aviso; refs repetidas avisan', () => {
    const x = G.parsearDocGuiones('* Video: Para grabar\nHOOK\nhola hola hola\n', 'd', 'A1', '', '')
    assert.equal(x.guiones[0].ref, 'T1-V1')
    assert.match(x.avisos[0], /TANDA/)
    const y = G.parsearDocGuiones('TANDA 1°\n* Video: Para grabar\nchau\n', 'd', 'A1', '', '')
    assert.match(y.avisos.join(), /secciones/)
  })
  test('estados del chip: "En grabación" cuenta como para grabar; uno desconocido es "otro"', () => {
    const x = G.parsearDocGuiones('TANDA 3°\n* Video: En grabación\nHOOK\nuna dos tres\n* Video: Revisar\nHOOK\nuna dos tres cuatro\n', 'd', 'A1', '', '')
    assert.deepEqual(x.guiones.map(g => [g.ref, g.estado_doc]), [['T3-V1', 'para_grabar'], ['T3-V2', 'otro']])
  })
})

describe('planDoc (altas de videos desde el doc)', () => {
  const doc = G.parsearDocGuiones(DOC, 'doc1', 'A101', '', '')
  const op = { hoy: '2026-10-27', corte: '2026-10-26', maxAltas: 10 }
  const video = over => ({ id: 1, id_crm: 'A101', cliente: 'Ana', clave: 'T1-V1', tanda_guion: 1, numero: 1, guion: null, guion_texto: '', gancho: '',
    estado: 'para_editar', estado_previo: null, estado_desde: '', prioridad: 'normal', bloqueo: null, motivo_bloqueo: '', motivo_regrabar: null, ronda_interna: 0,
    ronda_cliente: 0, editado: null, envio_link: null, ok_cliente: null, origen: 'clickup', clickup_id: '86x', version: 1, creado: '', actualizado: '', ...over })
  test('línea de base (primera lectura): no crea videos aunque haya chips en "Para grabar"', () => {
    const p = G.planDoc(doc, null, [], op)
    assert.equal(p.lineaBase, true)
    assert.deepEqual(p.altas, [])
  })
  test('después: crea solo el guion que PASÓ a "Para grabar" (o apareció ya así)', () => {
    const antes = { ...doc, guiones: doc.guiones.map(g => (g.ref === 'T1-V1' ? { ...g, estado_doc: 'no_iniciado' } : g)) }
    const p = G.planDoc(doc, antes, [], op)
    assert.deepEqual(p.altas.map(a => a.guion.ref), ['T1-V1'])
    const igual = G.planDoc(doc, doc, [], op)
    assert.deepEqual(igual.altas, [], 'ya estaba en "Para grabar" en la lectura anterior: no se crea de nuevo')
    const nuevo = G.planDoc(doc, { ...doc, guiones: [] }, [], op)
    assert.deepEqual(nuevo.altas.map(a => a.guion.ref), ['T1-V1'])
  })
  test('antes de la fecha de corte no crea nada', () => {
    const p = G.planDoc(doc, { ...doc, guiones: [] }, [], { ...op, hoy: '2026-10-25' })
    assert.deepEqual(p.altas, [])
  })
  test('revisión: lo que pasa a "Para grabar" antes del corte queda pospuesto (y se crea desde el corte, aunque el doc no cambie)', async () => {
    const antes = { ...doc, modificado: '2026-10-20T10:00:00.000Z', guiones: doc.guiones.map(g => ({ ...g, estado_doc: 'no_iniciado' })) }
    const ahora = { ...doc, modificado: '2026-10-24T10:00:00.000Z' }
    const p = G.planDoc(ahora, antes, [], { ...op, hoy: '2026-10-24' })
    assert.deepEqual(p.altas, []); assert.deepEqual(p.pospuestos, ['T1-V1'])
    assert.ok(p.avisos.some(a => /antes de la fecha de corte/.test(a)))
    // procesarDoc guarda el doc con el estado de antes y la fecha de modificación vieja: el lunes se relee y se crea
    const { repoMemoria } = await import('./edicion-juguetes.mjs')
    const V = await import('../lib/bot/grabacion/vigia.ts')
    const { s, repo } = await repoMemoria()
    s.docs.set('doc1', antes)
    const deps = d => ({ repo, env: { EDICION_FECHA_CORTE: '2026-10-26' }, ahora: () => d })
    await V.procesarDoc(deps(new Date('2026-10-24T15:00:00Z')), ahora, 'Ana', new Date('2026-10-24T15:00:00Z'))
    assert.equal(s.videos.size, 0)
    assert.equal(s.docs.get('doc1').modificado, '2026-10-20T10:00:00.000Z', 'fuerza otra lectura')
    assert.equal(s.docs.get('doc1').guiones.find(g => g.ref === 'T1-V1').estado_doc, 'no_iniciado')
    const r = await V.procesarDoc(deps(new Date('2026-10-26T15:00:00Z')), ahora, 'Ana', new Date('2026-10-26T15:00:00Z'))
    assert.equal(r.altas, 1)
    assert.deepEqual([...s.videos.values()].map(v => v.clave), ['T1-V1'])
  })
  test('freno: más de maxAltas en una pasada → ninguna y un aviso para Aylu', () => {
    const p = G.planDoc(doc, { ...doc, guiones: [] }, [], { ...op, maxAltas: 0 })
    assert.deepEqual(p.altas, []); assert.equal(p.frenadas, 1); assert.match(p.avisos[0], /no se crearon/)
  })
  test('con un importado de ClickUp por clave: lo vincula (sin alta), también en la línea de base', () => {
    const p = G.planDoc(doc, null, [video({ clave: 'T1-V1' })], op)
    assert.deepEqual(p.vincular.map(v => [v.clave, v.guion.ref, v.motivo]), [['T1-V1', 'T1-V1', 'sin_guion']])
  })
  test('un CU-… sin ubicar con el mismo gancho se vincula; si no se parece, el alta sale como posible duplicado', () => {
    const cu = video({ id: 2, clave: 'CU-86abc', tanda_guion: null, numero: null, gancho: '¿Te despidieron y trabajabas en negro?' })
    const p = G.planDoc(doc, { ...doc, guiones: [] }, [cu], op)
    assert.deepEqual(p.vincular.map(v => [v.clave, v.motivo]), [['CU-86abc', 'importado']])
    assert.deepEqual(p.altas, [])
    const otro = video({ id: 3, clave: 'CU-86zzz', tanda_guion: null, numero: null, gancho: 'nada que ver con esto' })
    const q = G.planDoc(doc, { ...doc, guiones: [] }, [otro], op)
    assert.deepEqual(q.altas.map(a => [a.guion.ref, a.posible_duplicado]), [['T1-V1', ['CU-86zzz']]])
    assert.match(q.avisos.join(), /posible duplicado de CU-86zzz/)
  })
  test('guion cambiado: con el video esperando crudos se actualiza; si ya se grabó, aviso', () => {
    const viejo = { doc_id: 'doc1', ref: 'T1-V1', huella: 'otra' }
    const enEspera = G.planDoc(doc, doc, [video({ origen: 'doc', guion: viejo, estado: 'esperando_crudos' })], op)
    assert.deepEqual(enEspera.vincular.map(v => v.motivo), ['cambio_en_espera'])
    const grabado = G.planDoc(doc, doc, [video({ origen: 'doc', guion: viejo, estado: 'para_editar' })], op)
    assert.deepEqual(grabado.cambiados.map(c => c.clave), ['T1-V1'])
    assert.match(grabado.avisos.join(), /cambió en el doc/)
    const igual = G.planDoc(doc, doc, [video({ origen: 'doc', guion: { ...viejo, huella: doc.guiones[0].huella } })], op)
    assert.deepEqual([igual.vincular.length, igual.cambiados.length, igual.altas.length], [0, 0, 0])
  })
  test('parecido: por palabras, sin acentos', () => {
    assert.equal(G.parecido('¿Te despidieron en negro?', 'te DESPIDIERON en negro'), 1)
    assert.ok(G.parecido('hola mundo', 'chau gente') === 0)
  })
})
