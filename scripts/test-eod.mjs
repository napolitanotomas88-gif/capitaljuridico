// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-eod.mjs  (cálculo, snapshot, lock y envío del EOD; sin red)
import assert from 'node:assert/strict'
import { calcularDesdeFilas, snapshotCongelado, textoEOD, ymdDeCelda, atribucionHistorias, pctFmt } from '../lib/eodSetter.ts'
import { ejecutarEOD } from '../lib/eodRun.ts'
const S = (ymd, h = 0) => Math.floor(Date.UTC(+ymd.slice(0,4), +ymd.slice(5,7)-1, +ymd.slice(8,10)) / 86400000) + 25569 + h
const fila = (f, nombre, user, id, ult) => [f, nombre, user, id, ult ?? f]
const base = { agendas: [], calendarios: [], outbound: [], agendasHistorias: [], resumen: [] }
const calc = (d, f, hoy) => calcularDesdeFilas({ ...base, ...d }, f, hoy)
let n = 0; const ok = (nombre, fn) => { fn(); n++ }
const okA = async (nombre, fn) => { await fn(); n++ }

ok('día de agenda ≠ día de interacción', () => {
  const e = calc({ agendas: [fila(S('2026-10-03'), 'A', 'a', 1, S('2026-10-02', .5)), fila(S('2026-10-04'), 'B', 'b', 2, S('2026-10-03', .9))] }, '2026-10-03', '2026-10-04')
  assert.equal(e.agendas.length, 1); assert.equal(e.agendas[0].id, '1')
})
ok('duplicados por día y mismo contacto en otro día', () => {
  const e = calc({ agendas: [fila(S('2026-10-03'), 'A', 'a', 1), fila(S('2026-10-03'), 'A', 'a', 1), fila(S('2026-10-03'), 'X', 'x', ''), fila(S('2026-10-03'), 'x', 'x', ''), fila(S('2026-10-02'), 'A', 'a', 1)] }, '2026-10-03', '2026-10-04')
  assert.equal(e.agendas.length, 2); assert.equal(e.serie.find(d => d.fecha === '2026-10-02').agendas, 1); assert.equal(e.mes.agendas, 3)
})
ok('outbound por CAMPO (EOD Outbound campo): únicos por día, mes y serie; ignora la etiqueta', () => {
  const oc = [fila(S('2026-10-03'), 'A', 'a', 1), fila(S('2026-10-03'), 'A', 'a', 1), fila(S('2026-10-03'), 'B', 'b', 2), fila(S('2026-10-02'), 'A', 'a', 1), fila(S('2026-10-09'), 'F', 'f', 9)]
  const e = calc({ outboundCampo: oc, outbound: [['', '', 'x', 5]] }, '2026-10-03', '2026-10-04')
  assert.equal(e.aperturasModo, 'campo'); assert.equal(e.aperturasHistorias, 2); assert.equal(e.mes.outbound, 3)
  assert.equal(e.serie.find(d => d.fecha === '2026-10-02').outbound, 1)
  const t = textoEOD(e).join('\n'); assert.match(t, /Recursos enviados por outbound de historias \(campo Recurso OUTBOUND\): \*\*2\*\*/); assert.match(t, /3 recursos de outbound enviados/)
  const v = calc({ outboundCampo: [] }, '2026-10-03', '2026-10-04'); assert.equal(v.aperturasHistorias, 0); assert.equal(v.aperturasModo, 'campo')
})
ok('outbound por el campo NUEVO (EOD Outbound historia): únicos por día; el campo viejo pasa a "recursos enviados"', () => {
  const oh = [fila(S('2026-10-20'), 'A', 'a', 1), fila(S('2026-10-20'), 'A', 'a', 1), fila(S('2026-10-20'), 'B', 'b', 2), fila(S('2026-10-19'), 'C', 'c', 3), fila(S('2026-10-09'), 'D', 'd', 4)]
  const oc = [fila(S('2026-10-20'), 'X', 'x', 9), fila(S('2026-10-19'), 'Y', 'y', 8)]
  const e = calc({ outboundHistoria: oh, outboundCampo: oc }, '2026-10-20', '2026-10-21')
  assert.equal(e.aperturasModo, 'campo-outbound'); assert.equal(e.aperturasHistorias, 2); assert.equal(e.recursosEnviados, 1)
  assert.equal(e.mes.outbound, 4); assert.equal(e.mes.recursos, 2)
  assert.equal(e.serie.find(d => d.fecha === '2026-10-19').outbound, 1)
  const t = textoEOD(e).join('\n')
  assert.match(t, /Outbound en historias \(contactos con el campo OUTBOUND Historia x Día de hoy\): \*\*2\*\*/)
  assert.match(t, /Recursos enviados \(respuestas al outbound; campo Recurso OUTBOUND\): \*\*1\*\*/)
  assert.match(t, /4 outbound en historias · 2 recursos enviados/)
})
ok('campo nuevo: antes del 8/10 sin dato (no 0); del 8 al 19 nota de cifra mínima; hoy sin filas = 0 válido', () => {
  const e1 = calc({ outboundHistoria: [] }, '2026-10-07', '2026-10-21'); assert.equal(e1.aperturasHistorias, null)
  const e2 = calc({ outboundHistoria: [fila(S('2026-10-09'), 'D', 'd', 4)] }, '2026-10-09', '2026-10-21')
  assert.equal(e2.aperturasHistorias, 1); assert.match(e2.aperturasNota, /mínima/)
  const e3 = calc({ outboundHistoria: [] }, '2026-10-20', '2026-10-21'); assert.equal(e3.aperturasHistorias, 0); assert.equal(e3.aperturasNota, undefined)
  assert.match(textoEOD(e1).join('\n'), /sin dato/)
})
ok('fechas: texto ISO / DD/MM, inexistentes y futuras', () => {
  assert.equal(ymdDeCelda('2026-02-30'), null); assert.equal(ymdDeCelda('31/04/2026'), null); assert.equal(ymdDeCelda('03/10/2026'), '2026-10-03')
  const e = calc({ calendarios: [['2026-10-03 21:15:00', 'A', 'a', 1], ['03/10/2026', 'B', 'b', 2], ['', 'C', 'c', 3], ['2026-02-30', 'D', 'd', 4], ['2026-10-09', 'E', 'e', 5]] }, '2026-10-03', '2026-10-04')
  assert.equal(e.calendarios, 2); assert.ok(e.avisos.some(a => /futura/.test(a))); assert.ok(e.avisos.some(a => /ilegible/.test(a)))
})
ok('fecha inválida o futura se rechaza', () => {
  assert.throws(() => calc({}, '2026-02-30', '2026-10-04')); assert.throws(() => calc({}, '2026-10-05', '2026-10-04'))
})
ok('etiqueta mensual de historias: se marca por ID y NO se presenta como atribución', () => {
  const e = calc({ agendas: [fila(S('2026-10-04'), 'L', 'l', 7)], agendasHistorias: [fila(S('2026-10-04'), 'L', 'l', 7), fila(S('2026-10-03'), 'Z', 'z', 9)] }, '2026-10-04', '2026-10-05')
  const t = textoEOD(e).join('\n'); assert.equal(e.etiquetaHistorias.length, 1); assert.match(t, /📲/); assert.match(t, /Contactos con etiqueta de historias \(mensual\): \*\*1\*\*/); assert.match(t, /referencial: NO es origen verificado/); assert.doesNotMatch(t, /vinieron de historias/)
})
// ── outbound
const R = (id, f = '') => [f, '', `u${id}`, id]
ok('outbound sin base y sin fechas → null (no 0)', () => {
  const e = calc({ outbound: [R(11), R(11), R(12), [S('2026-10-01', .3), 'N', 'u3', 13]] }, '2026-10-03', '2026-10-04')
  assert.equal(e.aperturasHistorias, null); assert.equal(e.aperturasModo, 'sin-base'); assert.match(textoEOD(e)[0], /sin dato del día/)
})
ok('outbound por fecha de fila si no hay base pero hay filas de ese día', () => {
  const e = calc({ outbound: [R(11), R(13, S('2026-10-01', .3))] }, '2026-10-01', '2026-10-04')
  assert.equal(e.aperturasHistorias, 1); assert.equal(e.aperturasModo, 'fecha')
})
const cierre = (f, filas, ts) => [f, 0, 0, '', 0, 0, filas, 'm', ts ?? '', '']
ok('delta por posición con cierre del día anterior; repite id en el mismo día cuenta una vez', () => {
  const d = { outbound: [R(1), R(2), R(3), R(3), R(4)], resumen: [cierre('03/10/2026', 2, '2026-10-04T03:10:00Z')] }
  const e = calc(d, '2026-10-04', '2026-10-05'); assert.equal(e.aperturasHistorias, 2); assert.equal(e.aperturasModo, 'delta'); assert.equal(e.filasOutbound, 5)
  assert.equal(e.aperturasNota, undefined)
  assert.deepEqual(calc(d, '2026-10-04', '2026-10-05'), e)   // reejecución idéntica
})
ok('reapertura del mismo contacto en días distintos cuenta en cada día', () => {
  const dia1 = calc({ outbound: [R(1), R(2)], resumen: [cierre('02/10/2026', 0, '2026-10-03T03:00:00Z')] }, '2026-10-03', '2026-10-04')
  assert.equal(dia1.aperturasHistorias, 2)
  const dia2 = calc({ outbound: [R(1), R(2), R(1), R(5)], resumen: [cierre('03/10/2026', 2, '2026-10-04T03:00:00Z')] }, '2026-10-04', '2026-10-05')
  assert.equal(dia2.aperturasHistorias, 2)   // el contacto 1 reabre y cuenta de nuevo
})
ok('hueco: el cierre previo NO es el día anterior → sin base', () => {
  const e = calc({ outbound: [R(1), R(2), R(3)], resumen: [cierre('01/10/2026', 1, '2026-10-02T03:00:00Z')] }, '2026-10-04', '2026-10-05')
  assert.equal(e.aperturasHistorias, null); assert.match(e.aperturasNota, /hueco/)
})
ok('día cerrado no incluye filas de días posteriores (fecha de fila > día) ni cambia al reejecutar', () => {
  const d = { outbound: [R(1), R(2), R(3, S('2026-10-05', .2)), R(4)], resumen: [cierre('03/10/2026', 0, '2026-10-04T03:00:00Z')] }
  const e = calc(d, '2026-10-04', '2026-10-05'); assert.equal(e.aperturasHistorias, 2); assert.equal(e.filasOutbound, 2)
})
ok('fecha vieja (≠ hoy/ayer) no usa delta; filas borradas → sin dato', () => {
  const d = { outbound: [R(1), R(2)], resumen: [cierre('03/10/2026', 1, '2026-10-04T03:00:00Z')] }
  assert.equal(calc(d, '2026-10-04', '2026-10-09').aperturasHistorias, null)
  const e = calc({ outbound: [R(1)], resumen: [cierre('03/10/2026', 5, '2026-10-04T03:00:00Z')] }, '2026-10-04', '2026-10-05')
  assert.equal(e.aperturasHistorias, null); assert.match(e.aperturasNota, /disminuyeron/)
})
ok('base tomada tarde (o sin hora) se avisa', () => {
  const d = { outbound: [R(1), R(2)], resumen: [cierre('03/10/2026', 1, '2026-10-04T21:21:00Z')] }
  assert.match(calc(d, '2026-10-04', '2026-10-05').aperturasNota, /tarde/)
  assert.match(calc({ ...d, resumen: [cierre('03/10/2026', 1, '')] }, '2026-10-04', '2026-10-05').aperturasNota, /tarde|sin hora/)
})
// ── snapshot congelado
ok('snapshot cerrado: se devuelve el guardado aunque los datos hayan cambiado', () => {
  const e0 = calc({ agendas: [fila(S('2026-10-03'), 'A', 'a', 1)] }, '2026-10-03', '2026-10-04')
  const res = [['03/10/2026', 1, 0, '', 0, 0, 0, '', '2026-10-04T03:00:00Z', JSON.stringify(e0)]]
  assert.deepEqual(snapshotCongelado(res, '2026-10-03'), e0)
  assert.equal(snapshotCongelado([['03/10/2026', 1]], '2026-10-03'), null)   // legado sin JSON: no congelado
  assert.equal(snapshotCongelado([['03/10/2026', 1, 0, '', 0, 0, 0, '', '', '{roto']], '2026-10-03'), null)
})
// ── % setter
const CFG = [['asignacion_cobertura_desde', '2026-10-05', 'verificado']]
ok('% agenda setter = agendas ÷ asignados SOLO con fecha real (col A) y desde la cobertura verificada', () => {
  const setterIG = [[S('2026-10-05'), '', '', '', '', 'u1', 'i1'], [S('2026-10-05'), '', '', '', '', 'u2', 'i2'], [S('2026-10-05'), '', '', '', '', 'u2', 'i2'], [S('2026-10-06'), '', '', '', '', 'u3', 'i3']]
  const e = calc({ config: CFG, setterIG, agendas: [fila(S('2026-10-05'), 'A', 'a', 1)] }, '2026-10-05', '2026-10-06')
  assert.deepEqual([e.setterDia.agendas, e.setterDia.asignados, e.setterDia.pct], [1, 2, 0.5])
  assert.equal(e.setterMes.pct, null); assert.match(e.setterMes.motivo, /desde 05\/10\/2026/)   // el mes empieza antes de la cobertura → sin dato, nunca parcial
  assert.doesNotMatch(textoEOD(e).join('\n'), /terminó en agenda/)
  // asignados < agendas → el denominador no cubre: sin dato
  const f = calc({ config: CFG, setterIG: [setterIG[0]], agendas: [fila(S('2026-10-05'), 'A', 'a', 1), fila(S('2026-10-05'), 'B', 'b', 2)] }, '2026-10-05', '2026-10-06')
  assert.equal(f.setterDia.pct, null); assert.match(f.setterDia.motivo, /no cubren/)
})
ok('REAL Setter IG: 147 filas de octubre sin fecha A y con C "Suscrito" → sin dato, jamás 56/152 ni 0', () => {
  // forma real: A vacía, C = fecha de suscripción (ruido), F usuario, G id; + 5 filas con A real en octubre
  const sinA = Array.from({ length: 147 }, (_, i) => ['', '', S(i % 2 ? '2026-10-03' : '2026-10-01', .3 + i / 1000), '', '', `u${i}`, 1000 + i])
  const conA = [S('2026-10-01'), S('2026-10-03'), S('2026-10-03'), S('2026-10-03'), S('2026-10-03')].map((a, i) => [a, `N${i}`, S('2026-09-01'), '', '', `a${i}`, 5000 + i])
  const ag3 = [fila(S('2026-10-03'), 'X', 'x', 1)]
  // sin cobertura verificada: sin dato aunque haya 4 filas con A el 3/10 (las 41 de C no cuentan)
  const e = calc({ setterIG: [...sinA, ...conA], agendas: ag3 }, '2026-10-03', '2026-10-05')
  assert.equal(e.setterDia.pct, null); assert.equal(e.setterDia.asignados, null); assert.match(e.setterDia.motivo, /fecha de asignación ausente/)
  assert.equal(e.setterMes.pct, null); assert.equal(e.setterMes.asignados, null)
  const t = textoEOD(e)[0]; assert.match(t, /% agenda setter[^\n]*\*\*sin dato\*\*/); assert.doesNotMatch(t, /\d+\/\d+ = /)
  // con cobertura posterior al día: sigue sin dato; con cobertura anterior: cuenta SOLO las filas con A
  assert.equal(calc({ config: [['asignacion_cobertura_desde', '2026-10-05', '']], setterIG: [...sinA, ...conA], agendas: ag3 }, '2026-10-03', '2026-10-05').setterDia.pct, null)
  const ok3 = calc({ config: [['asignacion_cobertura_desde', '2026-10-01', '']], setterIG: [...sinA, ...conA], agendas: ag3 }, '2026-10-03', '2026-10-05')
  assert.deepEqual([ok3.setterDia.asignados, ok3.setterMes.asignados], [4, 5])   // 4 el 3/10 y 5 en el mes: las 147 sin A no se cuentan
})
ok('mes: no mezcla meses', () => {
  const e = calc({ agendas: [fila(S('2026-09-30'), 'A', 'a', 1), fila(S('2026-10-01'), 'B', 'b', 2)] }, '2026-10-03', '2026-10-04'); assert.equal(e.mes.agendas, 1)
})
// ── atribución por historia (esquema)
ok('atribución por historia: D+1 solo con cobertura verificada; sin cobertura → null, nunca 0', () => {
  const hist = [['H1', '2026-10-02', 'hist_h1', 'link', '', '2026-10-02'], ['H2', '2026-10-03', 'hist_h2', '', '', '']]
  const conF = [[S('2026-10-03'), 'A', 'a', 1, 0, 'hist_h1'], [S('2026-10-03'), 'B', 'b', 2, 0, 'HIST_H1 '], [S('2026-10-03'), 'B', 'b', 2, 0, 'hist_h1'], [S('2026-10-03'), 'C', 'c', 3, 0, 'hist_h2']]
  const a = atribucionHistorias(hist, conF, '2026-10-03', '2026-10-04')
  assert.deepEqual(a.items.map(i => [i.id, i.agendasD1]), [['H1', 2]]); assert.equal(a.configurado, true)
  // H2 sin cobertura aunque haya filas con su etiqueta → sin medir (no 0, no 1)
  const b = atribucionHistorias(hist, conF, '2026-10-04', '2026-10-05'); assert.equal(b.items[0].agendasD1, null); assert.match(b.items[0].motivo, /sin fecha de cobertura/)
  // con cobertura y cero filas → 0 real
  assert.equal(atribucionHistorias(hist, [], '2026-10-03', '2026-10-04').items[0].agendasD1, 0)
  // cobertura posterior a la publicación → sin medir
  const c = atribucionHistorias([['H3', '2026-10-02', 'x', '', '', '2026-10-03']], conF, '2026-10-03', '2026-10-04'); assert.equal(c.items[0].agendasD1, null); assert.match(c.items[0].motivo, /posterior/)
  // filas con F pero ninguna historia con cobertura: configurado=false
  assert.equal(atribucionHistorias([['H4', '2026-10-02', 'y', '', '', '']], conF, '2026-10-03', '2026-10-04').configurado, false)
  assert.equal(atribucionHistorias([], [], '2026-10-03', '2026-10-04').configurado, false)
})
ok('Historias publicadas: ID único (duplicado ignorado con aviso) y texto "sin medir"', () => {
  const hs = [['H1', '2026-10-03', 'a', '', '', ''], ['h1', '2026-10-03', 'b', '', '', '2026-10-01']]
  const a = atribucionHistorias(hs, [], '2026-10-04', '2026-10-05'); assert.equal(a.items.length, 1); assert.match(a.nota, /duplicados/)
  const e = calc({ historias: hs }, '2026-10-04', '2026-10-05'); assert.match(textoEOD(e)[0], /sin medir\*\* \(sin fecha de cobertura verificada\)/)
})
// ── lock / envío
const demora = () => new Promise(r => setTimeout(r, Math.random() * 15))
function mundo({ hoy = '2026-10-04', min = 12 * 60, fallaSnapshot = false, fallaEnvio = false, fallaMarca = false, previo, ahora0 = Date.parse('2026-10-04T15:00:00Z') } = {}) {
  const filas = []; const w = { filas, envios: [], t: ahora0, espejos: [] }
  w.deps = {
    ahora: () => w.t, hoyYMD: () => hoy, minutosAR: () => min,
    lock: {
      async append(f) { await demora(); filas.push({ ...f, idx: filas.length + 2 }); return filas.length + 1 },
      async rows() { await demora(); return filas.map(f => ({ ...f })) },
      async update(idx, estado) { await demora(); if (fallaMarca && estado.startsWith('enviado:')) throw new Error('sheets caído'); filas.find(f => f.idx === idx).estado = estado },
    },
    enviadoPrevio: async () => previo,
    snapshot: async f => { await demora(); if (fallaSnapshot) throw new Error('quota'); return calcularDesdeFilas({ ...base }, f, hoy) },
    enviar: async () => {
      await demora(); w.envios.push(1)
      if (fallaEnvio === true || fallaEnvio === 'rechazo') return { enviado: false, error: 'discord 400', rechazo: true, ambiguo: false }
      if (fallaEnvio === '500') return { enviado: false, error: 'discord 503', rechazo: false, ambiguo: true }
      if (fallaEnvio === 'sinid') return { enviado: false, error: 'discord 200 sin id', ambiguo: true }
      if (fallaEnvio === 'throw') throw new Error('ECONNRESET')
      return { enviado: true, ids: [`m${w.envios.length}`] }
    },
    espejo: async (f, ids) => { w.espejos.push(ids) },
  }
  return w
}
await okA('concurrencia: 12 requests simultáneos → 1 solo envío', async () => {
  for (let k = 0; k < 20; k++) {
    const w = mundo(); const rs = await Promise.all(Array.from({ length: 12 }, () => ejecutarEOD(w.deps, '2026-10-03')))
    assert.equal(w.envios.length, 1, `ronda ${k}`); assert.equal(rs.filter(r => r.enviado).length, 1)
    assert.ok(w.filas.some(f => f.estado.startsWith('enviado:')))
  }
})
await okA('reejecución tras éxito no reenvía (lock y Resumen)', async () => {
  const w = mundo(); await ejecutarEOD(w.deps, '2026-10-03'); const r = await ejecutarEOD(w.deps, '2026-10-03')
  assert.equal(w.envios.length, 1); assert.equal(r.enviado, false); assert.equal(r.motivo, 'yaEnviado')
  const w2 = mundo({ previo: 'm9' }); const r2 = await ejecutarEOD(w2.deps, '2026-10-03'); assert.equal(w2.envios.length, 0); assert.equal(r2.yaEnviado, true)
})
await okA('guardado de snapshot fallido → NO se envía; reintento posterior sí', async () => {
  const w = mundo({ fallaSnapshot: true }); const r = await ejecutarEOD(w.deps, '2026-10-03')
  assert.equal(w.envios.length, 0); assert.equal(r.status, 500); assert.match(w.filas[0].estado, /^fallo:/)
  w.deps.snapshot = async f => calcularDesdeFilas({ ...base }, f, '2026-10-04'); const r2 = await ejecutarEOD(w.deps, '2026-10-03')
  assert.equal(r2.enviado, true); assert.equal(w.envios.length, 1)
})
await okA('Discord falla sin ids → reintento libre; marca de lock falla tras enviar → no reenvía solo', async () => {
  const w = mundo({ fallaEnvio: true }); const r = await ejecutarEOD(w.deps, '2026-10-03'); assert.equal(r.enviado, false); assert.match(w.filas[0].estado, /^fallo-envio/)
  w.deps.enviar = async () => { w.envios.push(1); return { enviado: true, ids: ['x'] } }; assert.equal((await ejecutarEOD(w.deps, '2026-10-03')).enviado, true)
  const m = mundo({ fallaMarca: true }); const rm = await ejecutarEOD(m.deps, '2026-10-03'); assert.equal(rm.enviado, true); assert.ok(rm.aviso)
  m.t += 30 * 60_000; const rr = await ejecutarEOD(m.deps, '2026-10-03'); assert.equal(m.envios.length, 1); assert.equal(rr.motivo, 'incierto'); assert.equal(rr.status, 409)
  const rf = await ejecutarEOD(m.deps, '2026-10-03', true); assert.equal(rf.enviado, true); assert.equal(m.envios.length, 2)   // el humano decidió
})
await okA('envío ambiguo (5xx, 2xx sin id, transporte sin respuesta) → incierto, NO reintentable; solo rechazo 4xx lo es', async () => {
  for (const modo of ['500', 'sinid', 'throw']) {
    const w = mundo({ fallaEnvio: modo }); const r = await ejecutarEOD(w.deps, '2026-10-03')
    assert.equal(r.enviado, false, modo); assert.equal(r.incierto, true, modo); assert.equal(w.filas[0].estado, 'enviando', modo)
    w.t += 30 * 60_000; const r2 = await ejecutarEOD(w.deps, '2026-10-03'); assert.equal(w.envios.length, 1, modo); assert.equal(r2.motivo, 'incierto', modo)
  }
  const w = mundo({ fallaEnvio: 'rechazo' }); await ejecutarEOD(w.deps, '2026-10-03'); assert.match(w.filas[0].estado, /^fallo-envio/)
})
await okA('caída del proceso: antes de enviar se reintenta solo; en "enviando" no', async () => {
  const w = mundo(); w.filas.push({ idx: 2, fecha: '2026-10-03', token: 't', ts: new Date(w.t - 20 * 60_000).toISOString(), estado: 'snapshot-ok' })
  assert.equal((await ejecutarEOD(w.deps, '2026-10-03')).enviado, true)
  const v = mundo(); v.filas.push({ idx: 2, fecha: '2026-10-03', token: 't', ts: new Date(v.t - 60_000).toISOString(), estado: 'en-curso' })   // vivo, reciente → en curso
  const rv = await ejecutarEOD(v.deps, '2026-10-03'); assert.equal(rv.enviado, false); assert.equal(rv.motivo, 'enCurso')
  const u = mundo(); u.filas.push({ idx: 2, fecha: '2026-10-03', token: 't', ts: new Date(u.t - 20 * 60_000).toISOString(), estado: 'enviando' })
  const ru = await ejecutarEOD(u.deps, '2026-10-03'); assert.equal(u.envios.length, 0); assert.equal(ru.motivo, 'incierto')
})
await okA('validaciones: futura/inválida, y HOY solo desde 23:30', async () => {
  const w = mundo(); assert.equal((await ejecutarEOD(w.deps, '2026-10-05')).status, 400); assert.equal((await ejecutarEOD(w.deps, '2026-02-30')).status, 400)
  assert.equal((await ejecutarEOD(w.deps, '2026-10-04')).status, 409); assert.equal(w.envios.length, 0)
  const t = mundo({ min: 23 * 60 + 59 }); assert.equal((await ejecutarEOD(t.deps, '2026-10-04')).enviado, true)
})
ok('porcentaje con precisión útil: 1/41 = 2,44% y 6/96 = 6,25% (no 2% / 6%)', () => {
  assert.equal(pctFmt(1 / 41), '2,44%'); assert.equal(pctFmt(6 / 96), '6,25%')
  const e = calc({ config: [['asignacion_cobertura_desde', '2026-10-01', '']], setterIG: Array.from({ length: 41 }, (_, i) => [S('2026-10-03'), '', '', '', '', `u${i}`, `i${i}`]), agendas: [fila(S('2026-10-03'), 'A', 'a', 1)] }, '2026-10-03', '2026-10-04')
  assert.match(textoEOD(e)[0], /día 1\/41 = 2,44%/)
})
ok('outbound: col F "Fecha evento outbound" manda sobre col A y permite contar por día con reaperturas', () => {
  const O = (id, a, f) => [a, '', `u${id}`, id, '', f]
  const e = calc({ outbound: [O(1, '', S('2026-10-03')), O(2, S('2026-09-01'), S('2026-10-03')), O(3, '', S('2026-10-03')), O(3, '', S('2026-10-03')), O(1, '', S('2026-10-04'))] }, '2026-10-03', '2026-10-09')
  assert.equal(e.aperturasHistorias, 3); assert.equal(e.aperturasModo, 'fecha'); assert.equal(e.filasOutbound, 4)   // el evento del 4/10 queda fuera del corte
})
ok('atribución: la col F es el campo "Historia origen EOD" y matchea por etiqueta o por ID', () => {
  const a = atribucionHistorias([['H1', '2026-10-02', 'hist_a', '', '', '2026-10-01']], [[S('2026-10-03'), 'A', 'a', 1, 0, 'H1'], [S('2026-10-03'), 'B', 'b', 2, 0, 'hist_a']], '2026-10-03', '2026-10-04')
  assert.equal(a.items[0].agendasD1, 2)
})
// ── auditoría 6/10 (sesión EOD): fechas, rangos y origen
ok('fecha anterior al inicio de los registros (30/9) → sin dato, no ceros', () => {
  const e = calc({ agendas: [fila(S('2026-10-01'), 'A', 'a', 1)] }, '2026-09-30', '2026-10-06')
  assert.ok(e.sinRegistros); assert.equal(e.aperturasHistorias, null)
  const t = textoEOD(e).join('\n'); assert.match(t, /Sin dato/); assert.doesNotMatch(t, /: \*\*0\*\*/)
  assert.ok(calc({}, '2026-09-15', '2026-10-06').sinRegistros)
  assert.equal(calc({}, '2026-10-01', '2026-10-06').sinRegistros, undefined)   // el 1/10 ya es medible
})
ok('últimos 7 días: los días previos al 1/10 salen "s/d", no 0/0', () => {
  const e = calc({ agendas: [fila(S('2026-10-01'), 'A', 'a', 1)] }, '2026-10-03', '2026-10-06')
  assert.deepEqual(e.serie.map(d => !!d.sinDato), [true, true, true, true, false, false, false])   // 27–30/9 sin registros; 1–3/10 medibles
  assert.equal(e.serie.filter(d => d.sinDato).length, 4)   // 27, 28, 29 y 30 de septiembre
  const t = textoEOD(e).join('\n'); assert.match(t, /mar 29: s\/d/); assert.doesNotMatch(t, /mar 29: 0\/0/)
  assert.equal(e.serie.at(-1).agendas, 0); assert.equal(e.serie.find(d => d.fecha === '2026-10-01').agendas, 1)
})
ok('rangos: mes y serie cuadran, y el mes no arrastra el mes anterior', () => {
  const ags = [['2026-10-30', 1], ['2026-10-31', 2], ['2026-11-01', 3], ['2026-11-01', 4], ['2026-11-02', 5]].map(([d, id]) => fila(S(d), `N${id}`, `u${id}`, id))
  const cals = [['2026-10-31', 1], ['2026-11-02', 2], ['2026-11-02', 3]].map(([d, id]) => fila(S(d), `N${id}`, `u${id}`, id))
  const e = calc({ agendas: ags, calendarios: cals }, '2026-11-02', '2026-11-03')
  assert.deepEqual([e.mes.desde, e.mes.agendas, e.mes.calendarios], ['2026-11-01', 3, 2])
  assert.equal(e.serie.length, 7); assert.equal(e.serie[0].fecha, '2026-10-27'); assert.equal(e.serie.reduce((n, d) => n + d.agendas, 0), 5)   // 7 días cruzan de mes: 30/10, 31/10 y noviembre
  const octubre = calc({ agendas: ags, calendarios: cals }, '2026-10-31', '2026-11-03'); assert.deepEqual([octubre.mes.agendas, octubre.mes.calendarios], [2, 1])
  assert.equal(calc({ agendas: ags }, '2026-11-02', '2026-11-02').agendas.length, 1)   // hoy = el día pedido sigue siendo válido
})
ok('origen: la marca de historia solo vale para el mismo día e ID; otro día no se mezcla', () => {
  const ags = [fila(S('2026-10-04'), 'L', 'l', 7), fila(S('2026-10-04'), 'M', 'm', 8), fila(S('2026-10-05'), 'L', 'l', 7)]
  const agH = [fila(S('2026-10-04'), 'L', 'l', 7)]
  const e4 = calc({ agendas: ags, agendasHistorias: agH }, '2026-10-04', '2026-10-06'), e5 = calc({ agendas: ags, agendasHistorias: agH }, '2026-10-05', '2026-10-06')
  assert.equal(e4.etiquetaHistorias.length, 1); assert.equal(e5.etiquetaHistorias.length, 0)
  assert.equal((textoEOD(e4).join('\n').match(/📲/g) ?? []).length, 1); assert.equal((textoEOD(e5).join('\n').match(/📲/g) ?? []).length, 0)
  assert.ok(e4.etiquetaHistorias.length <= e4.agendas.length)
})
ok('outbound por campo: del 1 al 5/10 es carga manual (cifra mínima); desde el 6/10 sin esa nota', () => {
  const oc = [['2026-10-02', 1], ['2026-10-02', 2], ['2026-10-06', 3]].map(([d, id]) => fila(S(d), `(carga inicial 6/10)`, `u${id}`, id))
  const e2 = calc({ outboundCampo: oc }, '2026-10-02', '2026-10-06'); assert.equal(e2.aperturasModo, 'campo'); assert.equal(e2.aperturasHistorias, 2); assert.match(e2.aperturasNota, /cifra mínima/)
  const e6 = calc({ outboundCampo: oc }, '2026-10-06', '2026-10-06'); assert.equal(e6.aperturasHistorias, 1); assert.equal(e6.aperturasNota, undefined)
  assert.ok(e6.avisos.some(a => /carga inicial manual/.test(a)))   // la serie de 7 días del 6/10 todavía incluye el 1–5/10
  const e13 = calc({ outboundCampo: oc }, '2026-10-13', '2026-10-13'); assert.ok(!e13.avisos.some(a => /carga inicial manual/.test(a)))
  assert.equal(calc({ outboundCampo: [] }, '2026-10-02', '2026-10-06').aperturasHistorias, 0)   // con registros y sin filas ese día sí es 0 (día medible)
})
console.log(`OK: ${n} casos del EOD`)
