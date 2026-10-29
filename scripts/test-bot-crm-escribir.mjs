// node --experimental-strip-types --import ./scripts/ts-resolve.mjs --no-warnings scripts/test-bot-crm-escribir.mjs
// Escritura del alta en el CRM de Clientes (lib/bot/alta/crmEscribir.ts) y limpieza de pruebas (crmLimpiar.ts).
// SIN RED: sin credenciales de Google, con una planilla de juguete en memoria que imita lo que importa de la API
// (FORMULA / UNFORMATTED_VALUE, USER_ENTERED con apóstrofo, copyPaste con referencias relativas, batchClear) y una
// vista previa de juguete. Datos inventados.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CLIENTES_CACHE_DIR = mkdtempSync(join(tmpdir(), 'bot-crm-escribir-'))
for (const k of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SHEET_ID_CLIENTES', 'VERCEL', 'VERCEL_ENV']) delete process.env[k]

const {
  armarEscritura, celdaUserEntered, escribirAltaCrm, formulaDeLaFila, lecturaPreviaDesde, mismoValor, parsearRango,
  rangosDeCeldas, rangosLecturaPrevia, verificarEscritura,
} = await import('../lib/bot/alta/crmEscribir.ts')
const { controlarCeldasAjenas, controlarFilasDePrueba, escritoDesdePedidos, limpiarFilaPrueba, pedidosDeRestauracion, verificarLimpieza } = await import('../lib/bot/alta/crmLimpiar.ts')
const { planAlta } = await import('../lib/clientes/altas.ts')
const { ymdASerial } = await import('../lib/clientes/fechas.ts')

const HOY = '2026-10-24'
const S = ymdASerial(HOY)
const ID_AGENCIA = 0, ID_RENOV = 122907432

// ── CRM de juguete con la forma real (24/10/2026) ──
const ENC_AGENCIA = ['', '', 'Estado', 'Celular', 'Mail', 'Closer', 'Fuente', 'Contrato', 'Día 1', 'Fin período actual', 'Renovó',
  'LTV contratado', 'LTV cobrado', 'Duración (días)', 'Promesa alcanzada', 'Semaforo de Clientes', 'Testimonio', 'Notas renovación',
  'Anotaciones', 'Próximo cobro', 'Llamada agendada', 'Fecha de baja']
const ENC_RENOV = ['ID Cliente', 'Nombre', 'Período (0=inicial)', 'Día 1', 'Finalización', 'Precio', 'Notas', 'Meses (vacío = 120 días)']
const F2 = {   // fórmulas de la fila 2 de Agencia (J:N), simplificadas
  9: '=IF($A2="","",MAXIFS(Renovaciones!$E:$E,Renovaciones!$A:$A,$A2))',
  10: '=IF($A2="","","NO")',
  11: '=IF($A2="","",SUMIF(Renovaciones!$A:$A,$A2,Renovaciones!$F:$F))',
  12: '=IF($A2="","",0)',
  13: '=IF(OR($I2="",$J2=""),"",$J2-$I2)',
}
const FORMULAS_SONDEO = { 'J Fin período actual': F2[9], 'K Renovó': F2[10], 'L LTV contratado': F2[11], 'M LTV cobrado': F2[12], 'N Duración (días)': F2[13] }
const precargadaJ = (n) => `=IF($A${n}="","",MAXIFS(Renovaciones!$E:$E,Renovaciones!$A:$A,$A${n}))`
const precargadaE = (n) => `=IF(ISNUMBER($D${n}),IF($H${n}="",$D${n}+120,EDATE($D${n},$H${n})),"")`

const filaCliente = (id, nombre, cel, conFormulas) => {
  const r = [id, nombre, 'ACTIVO', cel, `${id.toLowerCase()}@example.com`, 'Gero', 'Anuncios', 'Firmado', S - 100]
  if (conFormulas) for (const [c, f] of Object.entries(F2)) r[+c] = f.replaceAll('2', String(conFormulas))
  return r
}
/** Estado inicial: 3 clientes (filas 2–4), fórmulas precargadas en J5:J7 y E5:E7, destino = fila 5 en las dos. */
function crmInicial() {
  const agencia = [ENC_AGENCIA, filaCliente('A001', 'Ana Inventada', '+5491130001111', 2), filaCliente('A002', 'Beto Inventado', '+5491130002222', 3), filaCliente('A003', 'Caro Inventada', '+5491130003333', 4)]
  for (const n of [5, 6, 7]) { const r = []; r[9] = precargadaJ(n); agencia[n - 1] = r }
  const renovaciones = [ENC_RENOV, ['A001', 'Ana Inventada', 0, S - 100, S - 20, 3300, 'x'], ['A002', 'Beto Inventado', 0, S - 100, S - 20, 3300, 'x'], ['A003', 'Caro Inventada', 0, S - 100, S - 20, 3300, 'x']]
  for (const n of [5, 6, 7]) { const r = []; r[4] = precargadaE(n); renovaciones[n - 1] = r }
  return { Agencia: agencia, Renovaciones: renovaciones }
}

// ── Planilla de juguete ──
const vacia = (c) => c === undefined || c === null || c === ''
const esF = (c) => typeof c === 'string' && c.startsWith('=')
function recortar(filas) {
  const out = filas.map(f => { const r = [...f]; while (r.length && vacia(r[r.length - 1])) r.pop(); return r.map(c => (c === undefined ? '' : c)) })
  while (out.length && !out[out.length - 1].length) out.pop()
  return out
}
function planillaDeJuguete(hojas, { fallar = {} } = {}) {
  const llamadas = []
  const tab = (p) => { if (!hojas[p]) throw new Error(`Unable to parse range: ${p}`); return hojas[p] }
  const celda = (p, f, c) => tab(p)[f - 1]?.[c]
  const calcular = (p, f, c) => {
    const v = celda(p, f, c)
    if (!esF(v)) return v
    if (p === 'Renovaciones' && c === 4) { const d = calcular(p, f, 3); return typeof d === 'number' ? d + 120 : '' }
    if (p === 'Agencia') {
      const id = celda(p, f, 0)
      if (vacia(id)) return ''
      const periodos = Array.from(hojas.Renovaciones, (_, i) => i).filter(i => i > 0 && hojas.Renovaciones[i]?.[0] === id)
      if (c === 9) { const es = periodos.map(i => calcular('Renovaciones', i + 1, 4)).filter(x => typeof x === 'number'); return es.length ? Math.max(...es) : '' }
      if (c === 10) return 'NO'
      if (c === 11) return periodos.reduce((s, i) => s + (Number(hojas.Renovaciones[i][5]) || 0), 0)
      if (c === 12) return 0
      if (c === 13) { const i = calcular(p, f, 8), j = calcular(p, f, 9); return typeof i === 'number' && typeof j === 'number' ? j - i : '' }
    }
    return ''
  }
  const leerRango = (rango, render) => {
    const r = parsearRango(rango)
    const t = tab(r.pestana)
    const f0 = r.f0 ?? 1, f1 = r.f1 ?? Math.max(t.length, 1)
    const anchos = Array.from(t, x => x?.length ?? 0)
    const c0 = r.c0 ?? 0, c1 = r.c1 ?? Math.max(0, ...anchos) - 1
    const filas = []
    for (let f = f0; f <= f1; f++) {
      const fila = []
      for (let c = c0; c <= c1; c++) fila.push(render === 'FORMULA' ? celda(r.pestana, f, c) : calcular(r.pestana, f, c))
      filas.push(fila)
    }
    return recortar(filas)
  }
  const interpretar = (v) => {   // USER_ENTERED
    if (typeof v !== 'string') return v
    if (v === '') return undefined
    if (v.startsWith("'")) return v.slice(1)
    if (v.startsWith('=')) return v
    if (/^[+-]?\d+(\.\d+)?$/.test(v.trim())) return Number(v)   // así pierde el "+" un celular sin apóstrofo
    return v
  }
  const poner = (p, f, c, v) => { const t = tab(p); while (t.length < f) t.push([]); t[f - 1] ??= []; t[f - 1][c] = v }
  const ajustar = (formula, delta) => formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, a, col, b, fila) => (b ? m : `${a}${col}${Number(fila) + delta}`))
  return {
    llamadas, hojas,
    async leer(rangos, render) { llamadas.push({ tipo: 'leer', rangos, render }); if (fallar.leer) throw fallar.leer; return rangos.map(r => leerRango(r, render)) },
    async idsDePestanas() { llamadas.push({ tipo: 'ids' }); return { Agencia: ID_AGENCIA, Renovaciones: ID_RENOV } },
    async escribirValores(data) {
      llamadas.push({ tipo: 'valores', data })
      if (fallar.valores) throw fallar.valores
      for (const d of data) {
        const r = parsearRango(d.range)
        d.values.forEach((fila, i) => fila.forEach((v, j) => poner(r.pestana, r.f0 + i, r.c0 + j, interpretar(v))))
      }
    },
    async batchUpdate(requests) {
      llamadas.push({ tipo: 'batchUpdate', requests })
      if (fallar.batchUpdate) throw fallar.batchUpdate
      for (const { copyPaste: { source: s, destination: d, pasteType } } of requests) {
        assert.equal(pasteType, 'PASTE_FORMULA')
        const p = s.sheetId === ID_AGENCIA ? 'Agencia' : s.sheetId === ID_RENOV ? 'Renovaciones' : null
        if (!p || typeof s.sheetId !== 'number' || d.sheetId !== s.sheetId) throw Object.assign(new Error('sheetId inválido'), { code: 400 })
        for (let c = s.startColumnIndex; c < s.endColumnIndex; c++) {
          const v = celda(p, s.startRowIndex + 1, c)
          poner(p, d.startRowIndex + 1, c, esF(v) ? ajustar(v, d.startRowIndex - s.startRowIndex) : v)
        }
      }
    },
    async limpiar(rangos) {   // values.batchClear: solo las columnas del rango ("'Agencia'!5:5" = fila entera)
      llamadas.push({ tipo: 'limpiar', rangos })
      for (const rango of rangos) {
        const r = parsearRango(rango), t = tab(r.pestana)
        for (let f = r.f0; f <= r.f1; f++) {
          if (!t[f - 1]) continue
          if (r.c0 === null) { t[f - 1] = []; continue }
          for (let c = r.c0; c <= r.c1; c++) delete t[f - 1][c]
        }
      }
    },
  }
}

const ENTRADA = {
  nombre: 'PRUEBA BOT - borrar', celular: '+5491130009999', dia1: HOY, mail: 'prueba.bot@example.com', closer: 'Marcos',
  contrato: 'Hacer', anotaciones: 'Alta automática del bot C.J. (#ALTA de Marcos)', producto: 'inicial_3300', precioUSD: 3300,
}
async function planDe(hojas, entrada = ENTRADA) {
  // planAlta recibe lo calculado (UNFORMATTED_VALUE), como viene en el snapshot
  const pl = planillaDeJuguete(hojas)
  const [agencia, renovaciones] = await pl.leer(["'Agencia'!A1:AD", "'Renovaciones'!A1:L"], 'UNFORMATTED_VALUE')
  return planAlta(entrada, { hojas: { agencia, consultora: [['', '', 'Estado']], renovaciones }, clientes: [], formulasAgencia: FORMULAS_SONDEO })
}
const lecturaDe = async (hojas, plan) => lecturaPreviaDesde(await planillaDeJuguete(hojas).leer(rangosLecturaPrevia(plan.filaAgencia, plan.filaRenovaciones), 'FORMULA'))
const IDS = { Agencia: ID_AGENCIA, Renovaciones: ID_RENOV }

describe('utilidades', () => {
  test('celdaUserEntered: apóstrofo solo en lo que Sheets convertiría solo', () => {
    assert.equal(celdaUserEntered('+5491130009999'), "'+5491130009999")
    for (const t of ['ACTIVO', 'Hacer', 'Marcos', 'PRUEBA BOT - borrar', 'prueba.bot@example.com', 'período inicial cargado por el dashboard']) assert.equal(celdaUserEntered(t), t)
    for (const t of ['=HYPERLINK("x")', '-5', '@juan', '24/10/2026', '2026-10-24', '1100', '54 9 11 3000 9999', 'TRUE', 'falso', "'hola"]) assert.equal(celdaUserEntered(t), `'${t}`)
    assert.deepEqual([celdaUserEntered(''), celdaUserEntered(null), celdaUserEntered(3300), celdaUserEntered(0)], ['', '', 3300, 0])
  })

  test('parsearRango: celda, fila, columna abierta, fila entera y comillas', () => {
    assert.deepEqual(parsearRango("'Agencia'!A168:I168"), { pestana: 'Agencia', c0: 0, f0: 168, c1: 8, f1: 168 })
    assert.deepEqual(parsearRango("'Agencia'!A2:A"), { pestana: 'Agencia', c0: 0, f0: 2, c1: 0, f1: null })
    assert.deepEqual(parsearRango("'Agencia'!168:168"), { pestana: 'Agencia', c0: null, f0: 168, c1: null, f1: 168 })
    assert.deepEqual(parsearRango('Agencia!AD1'), { pestana: 'Agencia', c0: 29, f0: 1, c1: 29, f1: 1 })
    assert.equal(parsearRango("'Pagos ''25'!A1").pestana, "Pagos '25")
    assert.throws(() => parsearRango('A1:B2'), /Rango inválido/)
  })

  test('rangosDeCeldas: agrupa columnas consecutivas y corta donde falta una', () => {
    const celdas = [0, 1, 2, 3, 5, 6].map(col => ({ pestana: 'Renovaciones', fila: 5, col, valor: col === 3 ? '+549' : col }))
    assert.deepEqual(rangosDeCeldas(celdas), [
      { range: "'Renovaciones'!A5:D5", values: [[0, 1, 2, "'+549"]] },
      { range: "'Renovaciones'!F5:G5", values: [[5, 6]] },
    ])
  })

  test('mismoValor y formulaDeLaFila', () => {
    assert.equal(mismoValor('+5491130009999', '+5491130009999'), true)
    assert.equal(mismoValor('+5491130009999', 5491130009999), false)   // el celular convertido en número no pasa
    assert.equal(mismoValor(S, S), true)
    assert.equal(mismoValor('', undefined), true)
    assert.equal(mismoValor(0, ''), false)
    assert.equal(formulaDeLaFila(precargadaJ(168), 168), true)
    assert.equal(formulaDeLaFila(precargadaJ(168), 16), false)
    assert.equal(formulaDeLaFila('=SUM(Renovaciones!$F:$F)', 168), false)
  })
})

describe('armarEscritura (puro)', () => {
  test('caso real: fórmulas precargadas en Agencia J y Renovaciones E; la Finalización no se pisa', async () => {
    const hojas = crmInicial()
    const plan = await planDe(hojas)
    assert.deepEqual([plan.ok, plan.idNuevo, plan.filaAgencia, plan.filaRenovaciones], [true, 'A004', 5, 5])
    const esc = armarEscritura(plan, ENTRADA, await lecturaDe(hojas, plan), IDS)
    assert.deepEqual(esc.errores, [])
    assert.equal(esc.ok, true)
    assert.deepEqual(esc.valores, [
      { range: "'Agencia'!A5:I5", values: [['A004', 'PRUEBA BOT - borrar', 'ACTIVO', "'+5491130009999", 'prueba.bot@example.com', 'Marcos', '', 'Hacer', S]] },
      { range: "'Agencia'!S5:S5", values: [['Alta automática del bot C.J. (#ALTA de Marcos)']] },
      { range: "'Renovaciones'!A5:D5", values: [['A004', 'PRUEBA BOT - borrar', 0, S]] },
      { range: "'Renovaciones'!F5:H5", values: [[3300, 'período inicial cargado por el dashboard', '']] },
    ])
    assert.deepEqual(esc.copiarFormulas, [{ copyPaste: {
      source: { sheetId: ID_AGENCIA, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 9, endColumnIndex: 14 },
      destination: { sheetId: ID_AGENCIA, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 9, endColumnIndex: 14 },
      pasteType: 'PASTE_FORMULA', pasteOrientation: 'NORMAL',
    } }])
    assert.deepEqual(esc.omitidas.map(o => [o.pestana, o.col, o.fila, o.formula]), [['Renovaciones', 4, 5, precargadaE(5)]])
    assert.deepEqual(esc.formulasPrevias, { agencia: { J: precargadaJ(5) }, renovaciones: { E: precargadaE(5) } })
    assert.deepEqual(esc.formulas.map(f => f.col), [9, 10, 11, 12, 13])
    assert.match(esc.avisos.join(' '), /Finalización\) ya tiene la fórmula de la planilla: no se pisa/)
  })

  test('sin fórmula precargada en Renovaciones E: se escribe la Finalización del plan (A:H de corrido)', async () => {
    const hojas = crmInicial()
    hojas.Renovaciones[4] = []
    const plan = await planDe(hojas)
    const esc = armarEscritura(plan, ENTRADA, await lecturaDe(hojas, plan), IDS)
    assert.equal(esc.ok, true)
    assert.deepEqual(esc.omitidas, [])
    assert.deepEqual(esc.valores.filter(v => v.range.startsWith("'Renovaciones'")).map(v => v.range), ["'Renovaciones'!A5:H5"])
  })

  test('fila destino ocupada (alguien cargó algo en el medio) → no se escribe', async () => {
    const hojas = crmInicial()
    const plan = await planDe(hojas)
    hojas.Agencia[4][1] = 'Alguien Real'
    hojas.Renovaciones[4][0] = 'A777'
    const esc = armarEscritura(plan, ENTRADA, await lecturaDe(hojas, plan), IDS)
    assert.equal(esc.ok, false)
    assert.match(esc.errores.join(' '), /La fila 5 de Agencia ya tiene datos \(B\)/)
    assert.match(esc.errores.join(' '), /La fila 5 de Renovaciones ya tiene datos \(A\)/)
    assert.deepEqual([esc.valores, esc.copiarFormulas], [[], []])
  })

  test('fórmula donde el plan escribe un valor (fuera de la Finalización) → frena', async () => {
    const hojas = crmInicial()
    const plan = await planDe(hojas)
    hojas.Agencia[4][3] = '=A1'
    assert.match(armarEscritura(plan, ENTRADA, await lecturaDe(hojas, plan), IDS).errores.join(' '), /Agencia D5 tiene una fórmula/)
  })

  test('ID ya usado, sheetId que falta y fila 2 sin fórmula → frena', async () => {
    const hojas = crmInicial()
    const plan = await planDe(hojas)
    hojas.Agencia[10] = ['A004', 'Otro']
    hojas.Agencia[1][11] = 3300   // L2 con un valor en lugar de la fórmula
    const esc = armarEscritura(plan, ENTRADA, await lecturaDe(hojas, plan), { Renovaciones: ID_RENOV })
    const txt = esc.errores.join(' ')
    assert.match(txt, /El ID A004 ya está en Agencia/)
    assert.match(txt, /sheetId de la pestaña Agencia/)
    assert.match(txt, /La fila 2 de Agencia no tiene fórmula en L/)
    assert.equal(esc.ok, false)
  })

  test('columnas movidas entre el plan y la escritura → frena (no escribe en columnas equivocadas)', async () => {
    const hojas = crmInicial()
    const plan = await planDe(hojas)
    const lectura = await lecturaDe(hojas, plan)
    lectura.encAgencia = ['', '', 'Estado', 'Mail', 'Celular', ...ENC_AGENCIA.slice(5)]   // Celular y Mail intercambiados
    const esc = armarEscritura(plan, ENTRADA, lectura, IDS)
    assert.match(esc.errores.join(' '), /El plan no pone celular en la columna E de Agencia/)
    const otra = await lecturaDe(hojas, plan)
    otra.encAgencia = ['Nueva', ...ENC_AGENCIA]
    assert.match(armarEscritura(plan, ENTRADA, otra, IDS).errores.join(' '), /ID ya no está en la columna A|no pone ID/)
  })

  test('plan con errores → nada que escribir', async () => {
    const plan = await planDe(crmInicial(), { ...ENTRADA, nombre: '' })
    const esc = armarEscritura(plan, ENTRADA, await lecturaDe(crmInicial(), { filaAgencia: 5, filaRenovaciones: 5 }), IDS)
    assert.deepEqual([esc.ok, esc.errores], [false, ['El plan no está completo (sin ID, filas o payload): no hay nada que escribir.']])
  })
})

describe('verificarEscritura (puro)', () => {
  async function escrito() {
    const hojas = crmInicial()
    const plan = await planDe(hojas)
    const esc = armarEscritura(plan, ENTRADA, await lecturaDe(hojas, plan), IDS)
    const pl = planillaDeJuguete(hojas)
    await pl.batchUpdate(esc.copiarFormulas)
    await pl.escribirValores(esc.valores)
    const leer = async () => {
      const r = ["'Agencia'!A5:AD5", "'Renovaciones'!A5:L5"]
      const [f, v] = [await pl.leer(r, 'FORMULA'), await pl.leer(r, 'UNFORMATTED_VALUE')]
      return { agenciaFormula: f[0][0], renovacionesFormula: f[1][0], agenciaValor: v[0][0], renovacionesValor: v[1][0] }
    }
    return { hojas, plan, esc, leer }
  }

  test('lo escrito por la planilla de juguete pasa todos los controles', async () => {
    const { plan, esc, leer } = await escrito()
    const v = verificarEscritura(esc, plan, await leer())
    assert.deepEqual(v.controles.filter(c => !c.ok).map(c => c.que), [])
    assert.equal(v.ok, true)
    assert.deepEqual(v.controles.map(c => c.que), ['ID en A', 'Nombre', 'Celular', 'Día 1', 'Resto de los valores de Agencia', 'Fórmulas J:N',
      'Renovaciones: período 0', 'Resto de los valores de Renovaciones', 'Renovaciones: E calculada por la planilla', 'LTV contratado = precio del período 0', 'Fin de período calculado'])
  })

  test('celular convertido en número, fórmula que falta o apunta a otra fila, período 0 ausente → falla', async () => {
    const { plan, esc, leer } = await escrito()
    const l = await leer()
    const malo = (cambiar) => { const x = structuredClone(l); cambiar(x); return verificarEscritura(esc, plan, x) }
    const fallidos = (v) => v.controles.filter(c => !c.ok && !c.informativo).map(c => c.que)
    assert.deepEqual(fallidos(malo(x => { x.agenciaValor[3] = 5491130009999 })), ['Celular'])
    assert.deepEqual(fallidos(malo(x => { x.agenciaFormula[11] = 3300 })), ['Fórmulas J:N'])
    assert.deepEqual(fallidos(malo(x => { x.agenciaFormula[12] = F2[12] })), ['Fórmulas J:N'])   // quedó apuntando a la fila 2
    assert.deepEqual(fallidos(malo(x => { x.renovacionesValor = []; x.renovacionesFormula = [] })), ['Renovaciones: período 0', 'Resto de los valores de Renovaciones', 'Renovaciones: E calculada por la planilla'])
    assert.deepEqual(fallidos(malo(x => { x.renovacionesFormula[4] = S + 120 })), ['Renovaciones: E calculada por la planilla'])
    const sinLtv = malo(x => { x.agenciaValor[11] = 0 })
    assert.equal(sinLtv.ok, true)   // informativo: no frena
    assert.equal(sinLtv.controles.find(c => c.que.startsWith('LTV')).ok, false)
  })
})

const ALTA = { faltantes: [], avisos: [] }   // la vista previa de juguete no la mira
function preparar({ hojas = crmInicial(), previa = {}, fallar, ahora = Date.now() } = {}) {
  const pl = planillaDeJuguete(hojas, { fallar })
  let invalidaciones = 0, previas = 0
  const deps = {
    planilla: () => pl,
    ahora: () => ahora,
    invalidarCache: () => { invalidaciones++ },
    previsualizar: async (_a, _extras, op) => {
      previas++
      assert.deepEqual(op, { forzarLectura: true })
      const plan = await planDe(structuredClone(hojas))
      return {
        plan, entrada: ENTRADA, faltantes: [], bloqueos: [], avisos: [], parser: { faltantes: [], avisos: [] },
        lectura: { fuente: 'sheets', snapshotEn: ahora - 1000, edadSeg: 1, formulas: 'planilla', avisos: [] },
        aptoParaEscribir: true, motivosNoApto: [], ...previa,
      }
    },
  }
  return { pl, hojas, deps, cuenta: () => ({ invalidaciones, previas }) }
}
const escrituras = (pl) => pl.llamadas.filter(l => ['valores', 'batchUpdate', 'limpiar'].includes(l.tipo))

describe('escribirAltaCrm con planilla y vista previa de juguete', () => {
  test('simulación: solo lee y devuelve los pedidos exactos', async () => {
    const { pl, deps, cuenta } = preparar()
    const r = await escribirAltaCrm(ALTA, {}, { modo: 'simulacion', deps })
    assert.deepEqual([r.ok, r.etapa, r.escribio, r.id, r.filaAgencia, r.filaRenovaciones], [true, 'listo', false, 'A004', 5, 5])
    assert.deepEqual(escrituras(pl), [])
    assert.equal(r.pedidos.valores.length, 4)
    assert.equal(r.pedidos.copiarFormulas[0].copyPaste.source.sheetId, ID_AGENCIA)
    assert.equal(r.verificacion, null)
    assert.deepEqual(cuenta(), { invalidaciones: 0, previas: 1 })
  })

  test('real: copia las fórmulas ANTES que los valores, verifica todo y la limpieza deja la planilla como estaba', async () => {
    const { pl, hojas, deps, cuenta } = preparar()
    const original = structuredClone(hojas)
    const r = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps })
    assert.equal(r.motivo, null)
    assert.deepEqual([r.ok, r.etapa, r.escribio, r.id], [true, 'listo', true, 'A004'])
    assert.deepEqual(escrituras(pl).map(l => l.tipo), ['batchUpdate', 'valores'])
    assert.equal(r.verificacion.ok, true)
    assert.equal(hojas.Agencia[4][3], '+5491130009999')   // texto con "+", no número
    assert.equal(hojas.Renovaciones[4][4], precargadaE(5))   // la Finalización sigue siendo la fórmula de la planilla
    assert.equal(cuenta().invalidaciones, 1)

    const { escrito } = escritoDesdePedidos(r.id, r.pedidos, r.filaAgencia, r.filaRenovaciones)
    const l = await limpiarFilaPrueba(r.filaAgencia, r.filaRenovaciones, { escrito, formulasPrevias: r.formulasPrevias, planilla: () => pl, invalidarCache: () => {} })
    assert.equal(l.motivo, null)
    assert.deepEqual([l.ok, l.borro, l.renovacionesTocada, l.reintentable], [true, true, true, false])
    assert.deepEqual(l.restauradas, ["'Agencia'!J5", "'Renovaciones'!E5"])
    // batchClear solo de A:AD y A:L (lo mismo que se controla y se verifica), nunca la fila entera
    assert.deepEqual(pl.llamadas.filter(x => x.tipo === 'limpiar').map(x => x.rangos), [["'Agencia'!A5:AD5", "'Renovaciones'!A5:L5"]])
    assert.deepEqual(recortar(hojas.Agencia), recortar(original.Agencia))
    assert.deepEqual(recortar(hojas.Renovaciones), recortar(original.Renovaciones))
  })

  test('vista previa no apta o lectura vieja → no toca la planilla', async () => {
    const noApta = preparar({ previa: { aptoParaEscribir: false, motivosNoApto: ['Faltan datos del closer: Teléfono.'] } })
    const r1 = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: noApta.deps })
    assert.deepEqual([r1.ok, r1.etapa, r1.escribio], [false, 'previa', false])
    assert.match(r1.motivo, /Faltan datos del closer/)
    assert.deepEqual(noApta.pl.llamadas, [])

    const ahora = Date.now()
    const vieja = preparar({ ahora, previa: { lectura: { fuente: 'snapshot', snapshotEn: ahora - 120_000, edadSeg: 120, formulas: 'planilla', avisos: [] } } })
    const r2 = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: vieja.deps })
    assert.match(r2.motivo, /no es fresca/)
    assert.deepEqual(vieja.pl.llamadas, [])

    const respaldo = preparar({ previa: { lectura: { fuente: 'snapshot_viejo', snapshotEn: Date.now(), edadSeg: 0, formulas: 'planilla', avisos: [] } } })
    assert.match((await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: respaldo.deps })).motivo, /no es fresca/)
  })

  test('alguien cargó la fila destino después de la vista previa → aborta sin escribir', async () => {
    const p = preparar()
    const previsualizar = p.deps.previsualizar
    p.deps.previsualizar = async (...args) => { const r = await previsualizar(...args); p.hojas.Agencia[4][0] = 'A004'; p.hojas.Agencia[4][1] = 'Cliente Real'; return r }
    const r = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: p.deps })
    assert.deepEqual([r.ok, r.etapa, r.escribio], [false, 'control', false])
    assert.match(r.motivo, /ya tiene datos \(A, B\).*No se escribió nada/)
    assert.deepEqual(escrituras(p.pl), [])
  })

  test('falla de escritura: 403 → no escribió nada; 500 en los valores tras copiar → escribió (hay que limpiar)', async () => {
    const r403 = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: preparar({ fallar: { batchUpdate: Object.assign(new Error('The caller does not have permission'), { code: 403 }) } }).deps })
    assert.deepEqual([r403.ok, r403.etapa, r403.escribio], [false, 'escritura', false])
    assert.match(r403.motivo, /rechazó la escritura/)

    const p = preparar({ fallar: { valores: Object.assign(new Error('backend error'), { code: 500 }) } })
    const r500 = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: p.deps })
    assert.deepEqual([r500.ok, r500.etapa, r500.escribio, r500.filaAgencia, r500.filaRenovaciones], [false, 'escritura', true, 5, 5])
    assert.match(r500.motivo, /puede haber quedado a medias/)
    assert.equal(p.cuenta().invalidaciones, 1)
  })

  test('modo inválido → no hace nada', async () => {
    const p = preparar()
    const r = await escribirAltaCrm(ALTA, {}, { modo: 'escribir', deps: p.deps })
    assert.match(r.motivo, /Modo inválido/)
    assert.deepEqual(p.cuenta().previas, 0)
  })
})

describe('limpiarFilaPrueba (solo pruebas)', () => {
  const enc = { encAgencia: ENC_AGENCIA, encRenovaciones: ENC_RENOV }
  test('controlarFilasDePrueba: solo filas "PRUEBA BOT" y Renovaciones vacía o de la misma prueba', () => {
    const prueba = ['A004', 'PRUEBA BOT - borrar']
    assert.deepEqual(controlarFilasDePrueba({ ...enc, agencia: prueba, renovaciones: ['A004', 'PRUEBA BOT - borrar', 0] }), { ok: true, errores: [], limpiarRenovaciones: true, filaSinNombre: false })
    assert.deepEqual(controlarFilasDePrueba({ ...enc, agencia: prueba, renovaciones: ['', '', '', '', ''] }).limpiarRenovaciones, false)
    assert.match(controlarFilasDePrueba({ ...enc, agencia: ['A004', 'Cliente Real'], renovaciones: [] }).errores.join(' '), /no es una prueba del bot/)
    assert.match(controlarFilasDePrueba({ ...enc, agencia: prueba, renovaciones: ['A100', 'Cliente Real', 0] }).errores.join(' '), /no es de una prueba del bot/)
    assert.match(controlarFilasDePrueba({ ...enc, agencia: prueba, renovaciones: ['A100', 'PRUEBA BOT - otra', 0] }).errores.join(' '), /es de otro ID/)
    assert.match(controlarFilasDePrueba({ ...enc, agencia: ['A004', ' prueba bot - borrar'], renovaciones: [] }).errores.join(' '), /no empieza con "PRUEBA BOT"/)
    // con el ID que escribió la prueba: el de Agencia y el de Renovaciones tienen que ser ese
    assert.equal(controlarFilasDePrueba({ ...enc, agencia: prueba, renovaciones: ['A004', 'PRUEBA BOT - borrar', 0] }, 'A004').ok, true)
    assert.match(controlarFilasDePrueba({ ...enc, agencia: prueba, renovaciones: [] }, 'A005').errores.join(' '), /ID de la fila de Agencia \(A004\) no es el que escribió la prueba \(A005\)/)
    assert.match(controlarFilasDePrueba({ ...enc, agencia: ['A005', 'PRUEBA BOT - borrar'], renovaciones: ['A005', 'PRUEBA BOT - borrar', 0] }, 'A004').errores.join(' '), /es de otro ID \(A005\) que el de la prueba \(A004\)/)
    assert.equal(controlarFilasDePrueba({ ...enc, agencia: [], renovaciones: [] }, 'A004').filaSinNombre, true)
  })

  /** Alta de prueba escrita en la planilla de juguete (fila 5 de las dos pestañas) y lo que escribió. */
  async function escritaDePrueba() {
    const p = preparar()
    const original = structuredClone(p.hojas)
    const r = await escribirAltaCrm(ALTA, {}, { modo: 'real', deps: p.deps })
    assert.equal(r.ok, true)
    const { escrito } = escritoDesdePedidos(r.id, r.pedidos, r.filaAgencia, r.filaRenovaciones)
    /** Corre la limpieza; `escrituras` = lo que mandó la limpieza que no fue lectura (batchClear, restauración). */
    const limpiar = async (cambios = {}) => {
      const n = p.pl.llamadas.length
      const l = await limpiarFilaPrueba(r.filaAgencia, r.filaRenovaciones, { escrito, formulasPrevias: r.formulasPrevias, planilla: () => p.pl, invalidarCache: () => {}, ...cambios })
      return { l, escrituras: p.pl.llamadas.slice(n).filter(x => x.tipo !== 'leer') }
    }
    return { ...p, r, escrito, original, limpiar }
  }

  test('escritoDesdePedidos: columnas de los valores y de las fórmulas copiadas; rechaza lo que no es de las filas de la prueba', async () => {
    const { r, escrito } = await escritaDePrueba()
    assert.deepEqual(escrito, { id: 'A004', agencia: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 18], renovaciones: [0, 1, 2, 3, 5, 6, 7] })
    assert.match(escritoDesdePedidos(r.id, r.pedidos, 6, 5).errores.join(' '), /no es la fila 6 de Agencia/)
    assert.match(escritoDesdePedidos(r.id, r.pedidos, 5, 9).errores.join(' '), /no es la fila 9 de Renovaciones/)
    assert.match(escritoDesdePedidos('', r.pedidos, 5, 5).errores.join(' '), /qué ID/)
    assert.match(escritoDesdePedidos('A004', null, 5, 5).errores.join(' '), /pedidos de escritura/)
    const fuera = { ...r.pedidos, valores: [...r.pedidos.valores, { range: "'Agencia'!AE5:AE5", values: [['x']] }] }
    assert.match(escritoDesdePedidos(r.id, fuera, 5, 5).errores.join(' '), /fuera de A:AD \(AE\)/)
    assert.equal(escritoDesdePedidos(r.id, fuera, 5, 5).escrito, null)
  })

  test('sin lo que escribió la prueba (ID y columnas) → aborta sin leer ni borrar', async () => {
    const pl = planillaDeJuguete(crmInicial())
    assert.match((await limpiarFilaPrueba(5, 5, { planilla: () => pl })).motivo, /Falta el ID que escribió la prueba/)
    assert.match((await limpiarFilaPrueba(5, 5, { escrito: { id: 'A004', agencia: [1, 2], renovaciones: [] }, planilla: () => pl })).motivo, /no escribió la columna A/)
    assert.match((await limpiarFilaPrueba(5, 5, { escrito: { id: 'A004', agencia: [0, 40], renovaciones: [] }, planilla: () => pl })).motivo, /fuera de A:AD/)
    assert.deepEqual(pl.llamadas, [])
  })

  test('nombre que no es de prueba → aborta sin borrar nada', async () => {
    const hojas = crmInicial()
    const pl = planillaDeJuguete(hojas)
    const escrito = { id: 'A003', agencia: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], renovaciones: [0, 1, 2, 3, 4, 5, 6] }
    const r = await limpiarFilaPrueba(4, 4, { escrito, planilla: () => pl, invalidarCache: () => {} })   // fila 4 = cliente "real" de juguete
    assert.deepEqual([r.ok, r.borro, r.reintentable], [false, false, false])
    assert.match(r.motivo, /no es una prueba del bot/)
    assert.deepEqual(pl.llamadas.map(l => l.tipo), ['leer', 'leer'])
  })

  test('ID de Agencia distinto del que escribió la prueba → aborta sin borrar', async () => {
    const { hojas, escrito, limpiar } = await escritaDePrueba()
    const antes = structuredClone(hojas)
    const { l, escrituras } = await limpiar({ escrito: { ...escrito, id: 'A005' } })
    assert.deepEqual([l.ok, l.borro, l.reintentable], [false, false, false])
    assert.match(l.motivo, /no es el que escribió la prueba \(A005\)/)
    assert.deepEqual(hojas, antes)
    assert.deepEqual(escrituras, [])
  })

  test('alguien cargó algo en una columna que la prueba no escribió → aborta sin borrar (Agencia y Renovaciones)', async () => {
    const casos = [
      ['Agencia', 19, 'Llamar el lunes', /Agencia: hay datos en T, columnas que la prueba no escribió/],
      ['Agencia', 20, '=TODAY()', /Agencia: hay fórmulas en U que no puso la prueba/],
      ['Renovaciones', 8, 'nota a mano', /Renovaciones: hay datos en I/],
      ['Renovaciones', 4, '=D5+90', /Renovaciones: hay fórmulas en E/],   // la precargada cambiada a mano
    ]
    for (const [pestana, col, valor, re] of casos) {
      const { hojas, limpiar } = await escritaDePrueba()
      hojas[pestana][4][col] = valor
      const antes = structuredClone(hojas)
      const { l, escrituras } = await limpiar()
      assert.deepEqual([l.ok, l.borro], [false, false], `${pestana} ${col}`)
      assert.match(l.motivo, re)
      assert.deepEqual(hojas, antes)
      assert.deepEqual(escrituras, [])
    }
  })

  test('controlarCeldasAjenas: la precargada igual a la de antes pasa; sin formulasPrevias, no', () => {
    const escrito = { id: 'A004', agencia: [0, 1], renovaciones: [0, 1] }
    const filas = { agencia: ['A004', 'PRUEBA BOT - borrar'], renovaciones: ['A004', 'PRUEBA BOT - borrar', '', '', precargadaE(5)] }
    assert.deepEqual(controlarCeldasAjenas(filas, escrito, { agencia: {}, renovaciones: { E: precargadaE(5) } }, true), [])
    assert.match(controlarCeldasAjenas(filas, escrito, null, true).join(' '), /Renovaciones: hay fórmulas en E/)
    assert.deepEqual(controlarCeldasAjenas(filas, escrito, null, false), [])   // Renovaciones vacía: no se toca ni se mira
  })

  test('datos a la derecha de AD / L no se borran: el batchClear es el mismo rango que se controla', async () => {
    const { hojas, original, limpiar } = await escritaDePrueba()
    hojas.Agencia[4][30] = 'columna nueva del equipo'   // AE
    hojas.Renovaciones[4][12] = 'otra columna'          // M
    const { l, escrituras } = await limpiar()
    assert.equal(l.motivo, null)
    assert.equal(l.ok, true)
    assert.deepEqual(escrituras.filter(x => x.tipo === 'limpiar').map(x => x.rangos), [["'Agencia'!A5:AD5", "'Renovaciones'!A5:L5"]])
    assert.equal(hojas.Agencia[4][30], 'columna nueva del equipo')
    assert.equal(hojas.Renovaciones[4][12], 'otra columna')
    const aGrilla = (fila) => recortar([Array.from(fila.slice(0, 30))])
    assert.deepEqual(aGrilla(hojas.Agencia[4]), aGrilla(original.Agencia[4]))   // A:AD quedó como antes de la prueba (J precargada)
  })

  test('fila todavía sin nombre (los valores llegaron tarde) → aborta sin borrar y avisa que vale reintentar', async () => {
    const hojas = crmInicial()
    hojas.Agencia[4] = []
    for (const [c, f] of Object.entries(F2)) hojas.Agencia[4][+c] = f.replaceAll('2', '5')   // solo las fórmulas copiadas
    const pl = planillaDeJuguete(hojas)
    const escrito = { id: 'A004', agencia: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 18], renovaciones: [0, 1, 2, 3, 5, 6, 7] }
    const l = await limpiarFilaPrueba(5, 5, { escrito, planilla: () => pl, invalidarCache: () => {} })
    assert.deepEqual([l.ok, l.borro, l.reintentable], [false, false, true])
    assert.match(l.motivo, /no empieza con "PRUEBA BOT"/)
    assert.deepEqual(pl.llamadas.filter(x => x.tipo !== 'leer'), [])
  })

  test('filas 1 y 2, o en Vercel → aborta sin leer', async () => {
    const pl = planillaDeJuguete(crmInicial())
    const escrito = { id: 'A004', agencia: [0, 1], renovaciones: [0, 1] }
    assert.match((await limpiarFilaPrueba(2, 5, { escrito, planilla: () => pl })).motivo, /nunca se tocan las filas 1 y 2/)
    process.env.VERCEL = '1'
    try { assert.match((await limpiarFilaPrueba(5, 5, { escrito, planilla: () => pl })).motivo, /no corre en Vercel/) } finally { delete process.env.VERCEL }
    assert.deepEqual(pl.llamadas, [])
  })

  test('pedidosDeRestauracion valida lo que se vuelve a poner; verificarLimpieza detecta restos', () => {
    assert.deepEqual(pedidosDeRestauracion({ agencia: { J: precargadaJ(5) }, renovaciones: { E: precargadaE(5) } }, 5, 5, false).data, [{ range: "'Agencia'!J5", values: [[precargadaJ(5)]] }])
    assert.match(pedidosDeRestauracion({ agencia: { J: 'hola' }, renovaciones: {} }, 5, 5, true).errores.join(' '), /no es una fórmula/)
    assert.match(pedidosDeRestauracion({ agencia: { J: precargadaJ(6) }, renovaciones: {} }, 5, 5, true).errores.join(' '), /no apunta a la fila 5/)
    assert.match(pedidosDeRestauracion({ agencia: { j1: '=A5' }, renovaciones: {} }, 5, 5, true).errores.join(' '), /Columna inválida/)
    const v = verificarLimpieza({ agenciaFormula: ['', '', '', '', '', '', '', '', '', precargadaJ(5), F2[10]], agenciaValor: ['A004'], renovacionesFormula: [], renovacionesValor: [] }, { agencia: { J: precargadaJ(5) }, renovaciones: {} }, true)
    assert.equal(v.ok, false)
    assert.deepEqual(v.controles.filter(c => !c.ok).map(c => c.detalle), ['quedaron valores en A', 'sobran K'])
  })
})
