// node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-bot-guiones.mjs
// Etapa Guiones: revisor mecánico, provincia de la ficha, bloques del Doc, aprobadores y la orquestación por pasos
// (proceso.ts) con un registro y un Claude FALSOS. SIN red ni base: fetch bloqueado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
globalThis.fetch = async () => { throw new Error('red bloqueada en los tests') }
const R = await import('../lib/bot/guiones/revisar.ts')
const { CATALOGO } = await import('../lib/bot/guiones/formatos.ts')
const { ciudadDeFicha, iniciar, correrPaso, reanudar } = await import('../lib/bot/guiones/proceso.ts')
const { guionesParaChips, claveTanda } = await import('../lib/bot/guiones/envio.ts')
const { esAprobador, faltanVerificar } = await import('../lib/bot/guiones/aprobadores.ts')

const sec = (seccion, texto, indicacion = 'Levantá el sobre y mostralo') => ({ seccion, velocidad: seccion === 'HOOK' || seccion === 'CTA' ? 5 : 3, indicacion, texto })
const relleno = 'Trabajaste años ahí, una parte por recibo y otra en mano, y ahora te ofrecen una cuenta hecha solo con el recibo. '
function guion(numero, formato = 'objeto_simbolo', extra = {}) {
  return { numero, titulo: `G${numero}`, idea: 'x', formato, tipo_gancho: 'si_condicional', utileria: [], ganchos_alternativos: [], intencion: '', verificar: [],
    secciones: [sec('HOOK', 'Si te despidieron en San Juan y una parte del sueldo te la daban en un sobre, esperá.'), sec('PROBLEMA', relleno + relleno + 'Y si firmás apurado, perdés.'),
      sec('SOLUCION', 'Lo del sobre también es sueldo, y si se puede probar, entra en el reclamo.'),
      sec('CTA', 'Si sos de San Juan, escribime acá abajo (gesto con el dedo hacia abajo) así resolvemos juntos esta situación, antes de que firmes.')], ...extra }
}

test('revisor: un guion bueno no tiene errores', () => {
  const h = R.revisarGuion(guion(1), 'San Juan', CATALOGO)
  assert.deepEqual(R.errores(h), [], R.hallazgosEnTexto(h))
})
test('revisor: jerga de cámara en la indicación es error (preferencia 6)', () => {
  const g = guion(1); g.secciones[0].indicacion = 'Corte a plano medio, decilo firme'
  assert.ok(R.errores(R.revisarGuion(g, 'San Juan', CATALOGO)).some(x => x.regla === 'indicacion'))
})
test('revisor: sin la provincia en el HOOK es error', () => {
  const g = guion(1); g.secciones[0].texto = 'Si te despidieron y una parte del sueldo te la daban en un sobre, esperá.'
  assert.ok(R.errores(R.revisarGuion(g, 'San Juan', CATALOGO)).some(x => x.regla === 'ciudad'))
})
test('revisor: recursos repetidos en la tanda es error', () => {
  const t = { cliente: 'x', ciudad: 'San Juan', notas: '', guiones: [guion(1), guion(2)] }
  assert.ok(R.errores(R.revisarTanda(t, CATALOGO, 2)).some(x => x.regla === 'diversidad'))
})
test('provincia desde la ficha', () => {
  assert.equal(ciudadDeFicha({ zona: { descripcion: 'Provincia de San Juan: zona marcada…', presentarse_como: { texto: 'San Juan capital' }, lugares: [] } }), 'San Juan')
  assert.equal(ciudadDeFicha({ zona: { descripcion: '', presentarse_como: { texto: 'Mendoza capital' }, lugares: [] } }), 'Mendoza')
})
test('aprobadores: Tomi o Faus por mail', () => {
  const env = { KICKOFF_REVISOR_TOMI: 'tomi@x.com', GUIONES_REVISOR_FAUS: 'faus@x.com, otro@x.com' }
  assert.ok(esAprobador('Tomi@x.com', env)); assert.ok(esAprobador('faus@x.com', env)); assert.ok(!esAprobador('gero@x.com', env))
})
test('Doc: cada guion como va bajo su chip «Video:» (HOOK, Velocidad, indicación, texto, vacío)', () => {
  const fila = { recording_id: 7, tanda: 2, guiones: { 2: { guion: guion(2) }, 1: { guion: guion(1) } } }
  const c = guionesParaChips(fila)
  assert.deepEqual(c.map(x => x.numero), [1, 2])
  assert.deepEqual(c[0].parrafos.slice(0, 5).map(x => x.tipo), ['seccion', 'velocidad', 'indicacion', 'texto', 'vacio'])
  assert.equal(c[0].parrafos[0].texto, 'HOOK'); assert.equal(c[0].parrafos[1].texto, 'Velocidad 5'); assert.match(c[0].parrafos[2].texto, /^\(.*\)$/)
  assert.equal(c[0].parrafos[10].texto, 'SOLUCIÓN'); assert.equal(c[0].parrafos.length, 20)
  assert.equal(claveTanda(fila), 'cj-guiones-7-2')
})

// ── Orquestación con dependencias falsas ──
function falso() {
  const filas = new Map(); let sig = 1
  const disparos = [], avisos = []
  const ficha = { cliente: { cliente_crm: 'Laura' }, zona: { descripcion: 'Provincia de San Juan', presentarse_como: null, lugares: [] }, rama: { principal: 'laboral', subramas: [] } }
  const registro = {
    async crearTanda(p) { for (const f of filas.values()) if (f.recording_id === p.recording_id) return { fila: f, nueva: false }
      const f = { id: sig++, ...p, tanda: 1, estado: 'mercado', mercado: null, plan: null, guiones: {}, notas: [], actualizado: 'x' }; filas.set(f.id, f); return { fila: f, nueva: true } },
    async leerTanda(id) { return structuredClone(filas.get(id)) },
    async avanzar(id, desde, hasta, d = {}) { const f = filas.get(id); if (f.estado !== desde) return false; f.estado = hasta; if (d.mercado) f.mercado = d.mercado; if (d.plan) f.plan = d.plan; return true },
    async guardarGuion(id, n, g) { const f = filas.get(id); if (f.estado !== 'escribiendo' || f.guiones[String(n)]?.estado === 'listo') return null; f.guiones[String(n)] = g; return { listos: Object.values(f.guiones).filter(x => x.estado === 'listo').length, total: f.plan.length } },
    async marcarError(id, m) { const f = filas.get(id); if (!['mercado', 'plan', 'escribiendo', 'con_notas', 'corrigiendo'].includes(f.estado)) return; f.estado = 'error'; f.error = m },
    async reclamar(id, hasta) { const f = filas.get(id); if (f.estado !== 'error' && !f.vencida) return false; f.estado = hasta; f.error = null; return true },
    async marcarEstado(id, desde, hasta) { const f = filas.get(id); if (!desde.includes(f.estado)) return false; f.estado = hasta; return true },
    async aplicarCorrecciones() { return true },
    async anotarAviso(id, m) { filas.get(id).aviso = m },
  }
  const deps = { motor: 'api', leerKickoff: async () => ({ recording_id: 1, id_crm: 'A157', cliente: 'Laura', ficha, ideas: [{ titulo: 'a', angulo: 'b', gancho: 'c' }] }),
    registro, analizarMercado: async () => ({ texto: 'mercado', usage: { input_tokens: 1, output_tokens: 1 } }), kb: () => null,
    disparar: async (paso, d) => { disparos.push([paso, d]) }, avisar: async (f, tipo) => { avisos.push([f.id, tipo]); return 'msg' }, ahora: () => 0 }
  return { filas, disparos, avisos, deps }
}
test('iniciar crea la tanda una sola vez y dispara mercado', async () => {
  const x = falso()
  const a = await iniciar(1, x.deps), b = await iniciar(1, x.deps)
  assert.equal(a.nueva, true); assert.equal(b.nueva, false)
  assert.deepEqual(x.disparos, [['mercado', { id: a.id }]])
})
test('mercado → plan y no se repite', async () => {
  const x = falso(); const { id } = await iniciar(1, x.deps)
  await correrPaso('mercado', { id }, 0, x.deps)
  assert.equal(x.filas.get(id).estado, 'plan'); assert.equal(x.filas.get(id).mercado, 'mercado')
  assert.match(await correrPaso('mercado', { id }, 0, x.deps), /ya pasó/)
})
test('un error deja la tanda en error y reanudar vuelve al paso que falta', async () => {
  const x = falso(); const { id } = await iniciar(1, x.deps)
  x.deps.analizarMercado = async () => { throw new Error('boom') }
  await assert.rejects(correrPaso('mercado', { id }, 0, x.deps))
  assert.equal(x.filas.get(id).estado, 'error')
  x.disparos.length = 0
  assert.match(await reanudar(id, x.deps), /mercado/); assert.equal(x.filas.get(id).estado, 'mercado'); assert.deepEqual(x.disparos[0][0], 'mercado')
})
test('el último guion listo cierra la tanda una sola vez y avisa al equipo', async () => {
  const { cerrar } = await import('../lib/bot/guiones/proceso.ts')
  const x = falso(); const { id } = await iniciar(1, x.deps)
  const f = x.filas.get(id); f.estado = 'escribiendo'; f.mercado = 'm'; f.plan = [{ numero: 1 }, { numero: 2 }]
  await x.deps.registro.guardarGuion(id, 1, { guion: guion(1), estado: 'listo' })
  const r = await x.deps.registro.guardarGuion(id, 2, { guion: guion(2, 'pizarra'), estado: 'listo' })
  assert.equal(r.listos, r.total)
  assert.equal(await cerrar(id, x.deps), true); assert.equal(await cerrar(id, x.deps), false)
  assert.deepEqual(x.avisos, [[id, 'revisar']])
  assert.equal(await x.deps.registro.guardarGuion(id, 2, { guion: guion(2), estado: 'listo' }), null, 'no pisa una tanda ya cerrada')
})
test('un error tardío no pisa una tanda ya para revisar', async () => {
  const x = falso(); const { id } = await iniciar(1, x.deps)
  x.filas.get(id).estado = 'a_revisar'
  await x.deps.registro.marcarError(id, 'tarde'); assert.equal(x.filas.get(id).estado, 'a_revisar')
})
test('reanudar con todos los guiones listos cierra la tanda', async () => {
  const x = falso(); const { id } = await iniciar(1, x.deps)
  const f = x.filas.get(id); f.estado = 'error'; f.mercado = 'm'; f.plan = [{ numero: 1 }]; f.guiones = { 1: { guion: guion(1), estado: 'listo' } }
  assert.match(await reanudar(id, x.deps), /lista para revisar/); assert.equal(f.estado, 'a_revisar')
})
test('reanudar redispara lo que falta según el estado de cada guion', async () => {
  const x = falso(); const { id } = await iniciar(1, x.deps)
  const f = x.filas.get(id); f.estado = 'error'; f.mercado = 'm'; f.plan = [{ numero: 1 }, { numero: 2 }, { numero: 3 }]
  f.guiones = { 1: { estado: 'escrito' }, 2: { estado: 'corrigiendo' } }
  x.disparos.length = 0
  await reanudar(id, x.deps)
  assert.deepEqual(x.disparos.map(d => `${d[0]} ${d[1].numero}`).sort(), ['corregir 2', 'guion 3', 'revisar 1'])
})
test('iniciar: si el primer disparo falla, la tanda queda en error (no colgada)', async () => {
  const x = falso(); x.deps.disparar = async () => { throw new Error('401') }
  await assert.rejects(iniciar(1, x.deps))
  assert.equal([...x.filas.values()][0].estado, 'error')
})
const tanda = '.cache/guiones/prueba/tanda-2026-10-25-15-23.json'
test('la tanda aprobada de Laura pasa el revisor (salvo la jerga que ya no se permite)', { skip: !existsSync(tanda) }, () => {
  const d = JSON.parse(readFileSync(tanda, 'utf8'))
  const e = R.errores(R.revisarTanda(d.tanda, CATALOGO, 6)).filter(h => h.regla !== 'indicacion')
  assert.deepEqual(e, [], R.hallazgosEnTexto(e))
})

test('motor local: iniciar deja la tanda pendiente y no dispara nada', async () => {
  const x = falso(); x.deps.motor = 'local'
  x.deps.registro.crearTanda = async p => { const f = { id: 9, ...p, tanda: 1, estado: p.estado, guiones: {}, notas: [] }; x.filas.set(9, f); return { fila: f, nueva: true } }
  const r = await iniciar(1, x.deps)
  assert.equal(r.estado, 'pendiente'); assert.deepEqual(x.disparos, [])
  assert.match(await reanudar(9, x.deps), /Mac/)
  x.deps.motor = 'api'
  assert.match(await reanudar(9, x.deps), /API/); assert.deepEqual(x.disparos[0][0], 'mercado')
})

test('nombres: palabras enteras, no pedazos (Ana Ruiz ≠ Mariana Ruiz)', () => {
  assert.equal(R.contienePalabras('Contenido - Mariana Ruiz', 'Ana Ruiz'), false)
  assert.equal(R.contienePalabras('Contenido - Ana Ruiz', 'Ana Ruiz'), true)
  assert.equal(R.contienePalabras('Contenido - Estudio Cova', 'Estudio Hammer'), false)
  assert.equal(R.contienePalabras('Laura Cristina Ortiz Molina', 'Laura Ortiz'), true)
  assert.equal(R.contienePalabras('Contenido - Laura Ortiz', ''), false)
})

test('verificación por guion: el check final se habilita solo con todos verificados (27/10)', () => {
  const v = { quien: 'Faus', email: 'f@x', cuando: '2026-10-27T10:00:00Z' }
  assert.deepEqual(faltanVerificar({ 1: { verificado: v }, 2: {}, 10: { verificado: null } }), [2, 10])
  assert.deepEqual(faltanVerificar({ 1: { verificado: v }, 2: { verificado: v } }), [])
})
