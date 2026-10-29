// Verifica el CRM de prueba: recalcula las métricas en JS desde 📞 Llamadas y las compara con lo que muestra 📊 Métricas,
// para cada combinación de mes × closer, más todas las tablas. También busca celdas con error.
// Lee las posiciones de scripts/crm-prueba-layout.json (lo escribe crm-prueba.js). Uso: node scripts/crm-prueba-verificar.js
const fs = require('fs'), path = require('path'), { google } = require('googleapis')
const ID = process.env.SHEET_ID_PRUEBA?.trim()
if (!ID) throw new Error('Falta SHEET_ID_PRUEBA')
const LAY = JSON.parse(fs.readFileSync(path.join(__dirname, 'crm-prueba-layout.json'), 'utf8'))
const { IDX, TAB, FILA, F1, FILAS, N_ANUNCIOS } = LAY
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '') }
const auth = new google.auth.JWT({ email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })
const get = async (range, render = 'UNFORMATTED_VALUE') => (await sheets.spreadsheets.values.get({ spreadsheetId: ID, range, valueRenderOption: render })).data.values ?? []
const set = (range, v) => sheets.spreadsheets.values.update({ spreadsheetId: ID, range, valueInputOption: 'RAW', requestBody: { values: [[v]] } })
const casi = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-6 : a === b
const ratio = (a, b) => (b > 0 ? a / b : '—')

async function main() {
  const crudo = (await get(`'📞 Llamadas'!A${F1}:AZ${FILAS + 2}`)).filter(f => f[IDX.lead] || f[IDX.fecha])
  const ahora = (await get("'📊 Métricas'!O6"))[0][0]                 // el mismo reloj que usa la hoja
  const v = (f, k) => f[IDX[k]] ?? ''
  const L = crudo.map(f => ({ lead: v(f, 'lead'), fecha: v(f, 'fechan'), closer: v(f, 'closer') || '(sin closer)', estado: v(f, 'estado'), presento: v(f, 'presento'), resultado: v(f, 'resultado'),
    valor: Number(v(f, 'valor')) || 0, cobrado: Number(v(f, 'cobrado')) || 0, agendo: v(f, 'agendo'), canal: v(f, 'canal'), anuncio: v(f, 'anuncio'), calif: v(f, 'calif'), email: v(f, 'email'), mes: v(f, 'mes'), nro: v(f, 'nrolead') }))
  console.log(`Llamadas: ${L.length} · meses: ${[...new Set(L.map(x => x.mes))].join(', ')} · leads distintos: ${new Set(L.map(x => x.email)).size}`)

  // 1) Columnas automáticas fila por fila
  let malEstado = 0, malNro = 0
  const vistos = {}
  for (const x of [...L].sort((a, b) => a.fecha - b.fecha)) { vistos[x.email] = (vistos[x.email] ?? 0) + 1; if (x.nro !== vistos[x.email]) malNro++ }
  for (const x of L) {
    const esp = x.resultado === 'Cerró' ? (x.cobrado > 0 ? '✅ Cerrada' : '🟡 Cerró, falta cobrar') : x.presento === 'Sí' ? '🟢 Presentada' : x.presento === 'No' ? '🔴 No se presentó' : x.presento === 'Reagendó' ? '🔁 Reagendó'
      : x.presento === 'Canceló' ? '⚪ Canceló' : x.fecha > ahora ? '🕒 Próxima' : '⚠️ Falta cargar'
    if (esp !== x.estado) malEstado++
  }
  console.log(`Estado: ${L.length - malEstado}/${L.length} ok · "Llamada nº del lead": ${L.length - malNro}/${L.length} ok · filas de 2ª/3ª llamada: ${L.filter(x => x.nro > 1).length}`)

  const esCierre = x => x.resultado === 'Cerró' && x.cobrado > 0
  const cobradoDe = s => s.filter(x => x.resultado === 'Cerró').reduce((a, x) => a + x.cobrado, 0)
  const calc = sel => {
    const n = f => sel.filter(f).length
    const ag = sel.length, oc = n(x => x.fecha <= ahora), cal = n(x => ['A', 'B', 'C'].includes(x.calif)), pr = n(x => x.presento === 'Sí'), ns = n(x => x.presento === 'No')
    const rc = n(x => x.presento === 'Reagendó' || x.presento === 'Canceló'), falta = n(x => x.fecha <= ahora && x.presento === ''), ci = n(esCierre), leads = n(x => x.nro === 1)
    const cob = cobradoDe(sel), con = sel.filter(x => x.resultado === 'Cerró').reduce((a, x) => a + x.valor, 0)
    return { volumen: [ag, cal, pr, ns, ci, falta], tasas: [ratio(cal, ag), ratio(pr, oc), ratio(ci, pr), ratio(ci, oc), ratio(ci, leads), ratio(rc, oc)],
      plata: [cob, con, ratio(cob, ci), ratio(cob, con), ratio(cob, pr), n(x => x.resultado === 'Cerró') - ci], sub: `de ${leads} leads distintos · ${n(x => x.fecha > ahora)} a futuro` }
  }
  const leerTarjetas = async () => {
    const t = await get(`'📊 Métricas'!B${FILA.volumen + 2}:M${FILA.plata + 2}`)
    const fila = i => [0, 2, 4, 6, 8, 10].map(c => t[i]?.[c] ?? '')
    return { volumen: fila(0), tasas: fila(FILA.tasas - FILA.volumen), plata: fila(FILA.plata - FILA.volumen), sub: t[1]?.[0] ?? '' }
  }

  // 2) Tarjetas para cada mes × closer
  const meses = ['Todo', ...new Set(L.map(x => x.mes))], closers = ['Todos', ...new Set(L.map(x => x.closer))]
  let ok = 0, mal = 0
  for (const mes of meses) for (const closer of closers) {
    await set("'📊 Métricas'!C4", mes); await set("'📊 Métricas'!G4", closer)
    const hoja = await leerTarjetas(), esp = calc(L.filter(x => (mes === 'Todo' || x.mes === mes) && (closer === 'Todos' || x.closer === closer)))
    for (const b of ['volumen', 'tasas', 'plata']) esp[b].forEach((e, i) => { if (casi(e, hoja[b][i])) ok++; else { mal++; if (mal <= 10) console.log(`  ✗ ${mes} / ${closer} · ${b}[${i}]: hoja=${hoja[b][i]} esperado=${e}`) } })
    if (hoja.sub === esp.sub) ok++; else { mal++; if (mal <= 10) console.log(`  ✗ ${mes} / ${closer} · subtítulo: "${hoja.sub}" ≠ "${esp.sub}"`) }
  }
  console.log(`Tarjetas: ${ok} correctas, ${mal} distintas (${meses.length} meses × ${closers.length} closers × 19)`)

  // 3) Tablas, con Todo / Todos
  await set("'📊 Métricas'!C4", 'Todo'); await set("'📊 Métricas'!G4", 'Todos')
  const T0 = TAB.closer, Tt = await get(`'📊 Métricas'!B${T0}:K${TAB.embudo + 6}`), fila = n => Tt[n - T0] ?? []
  let tOk = 0, tMal = 0
  const cmp = (que, hoja, esp) => { if (casi(hoja ?? '', esp)) tOk++; else { tMal++; if (tMal <= 10) console.log(`  ✗ ${que}: hoja=${hoja} esperado=${esp}`) } }
  const embudo = s => { const pr = s.filter(x => x.presento === 'Sí').length, oc = s.filter(x => x.fecha <= ahora).length, ci = s.filter(esCierre).length
    return [s.length, s.filter(x => ['A', 'B', 'C'].includes(x.calif)).length, pr, ratio(pr, oc), ci, ratio(ci, pr), cobradoDe(s)] }
  for (let f = TAB.closer + 2; f <= TAB.closer + 7; f++) {
    const r = fila(f); if (!r[0]) continue
    const s = L.filter(x => x.closer === r[0]), pr = s.filter(x => x.presento === 'Sí').length, oc = s.filter(x => x.fecha <= ahora).length, ci = s.filter(esCierre).length, cob = cobradoDe(s)
    ;[s.length, pr, s.filter(x => x.presento === 'No').length, ratio(pr, oc), ci, ratio(ci, pr), cob, ratio(cob, ci), s.filter(x => x.fecha <= ahora && x.presento === '').length].forEach((e, i) => cmp(`closer ${r[0]} col ${i + 1}`, r[i + 1], e))
  }
  cmp('control closer sin reconocer', fila(TAB.closer + 8)[1], 0); cmp('control canal sin reconocer', fila(TAB.canal + 2 + LAY.canales)[1], 0)
  const recorrer = (desde, n, campo) => { for (let f = desde; f < desde + n; f++) { const r = fila(f); if (!r[0]) continue; embudo(L.filter(x => x[campo] === r[0])).forEach((e, i) => cmp(`${campo} "${r[0]}" col ${i + 1}`, r[i + 1], e)) } }
  recorrer(TAB.canal + 2, LAY.canales, 'canal'); recorrer(TAB.calif + 2, 5, 'calif'); recorrer(TAB.agendo + 2, 4, 'agendo'); recorrer(TAB.anuncio + 2, N_ANUNCIOS, 'anuncio')
  const anunciosHoja = Array.from({ length: N_ANUNCIOS }, (_, i) => fila(TAB.anuncio + 2 + i)[0]).filter(Boolean), anunciosReales = [...new Set(L.map(x => x.anuncio).filter(Boolean))]
  cmp('cantidad de anuncios listados', anunciosHoja.length, Math.min(anunciosReales.length, N_ANUNCIOS))
  const pres = L.filter(x => x.presento === 'Sí').length
  for (let f = TAB.motivos + 2; f < TAB.motivos + 2 + LAY.resultados; f++) { const r = fila(f), c = L.filter(x => x.resultado === r[0]).length; cmp(`motivo ${r[0]}`, r[1], c); cmp(`motivo % ${r[0]}`, r[2], ratio(c, pres)) }
  for (let f = TAB.evol + 2; f < TAB.evol + 14; f++) {
    const r = fila(f); if (!r[0]) continue
    const s = L.filter(x => x.mes === r[0]), pr = s.filter(x => x.presento === 'Sí').length, oc = s.filter(x => x.fecha <= ahora).length, ci = s.filter(esCierre).length
    ;[s.length, pr, ratio(pr, oc), ci, ratio(ci, pr), cobradoDe(s)].forEach((e, i) => cmp(`mes ${r[0]} col ${i + 1}`, r[i + 1], e))
  }
  console.log(`Tablas: ${tOk} correctas, ${tMal} distintas · anuncios en la tabla: ${anunciosHoja.join(' | ')}`)

  // 4) Celdas con error
  const errores = []
  for (const tab of ['📖 Cómo usar', '📞 Llamadas', '📊 Métricas', '⚙️ Listas']) {
    const t = await get(`'${tab}'!A1:AZ${tab.includes('Llamadas') ? FILAS + 2 : 150}`, 'FORMATTED_VALUE')
    t.forEach((r, i) => r.forEach((c, j) => { if (/^#(ERROR|NAME|VALUE|REF|N\/A|DIV\/0|NUM)/.test(String(c))) errores.push(`${tab}!c${j + 1}f${i + 1}=${c}`) }))
  }
  console.log(`Celdas con error: ${errores.length}${errores.length ? ' → ' + errores.slice(0, 8).join(' · ') : ''}`)
  const vista = await get(`'📊 Métricas'!B${FILA.volumen + 1}:M${FILA.plata + 3}`, 'FORMATTED_VALUE')
  console.log('\nTarjetas (Todo / Todos):')
  for (const i of [0, FILA.tasas - FILA.volumen, FILA.plata - FILA.volumen]) console.log('  ' + [0, 2, 4, 6, 8, 10].map(c => `${vista[i]?.[c]}: ${vista[i + 1]?.[c]}`).join('  |  '))
  console.log('  ↳ ' + vista[2]?.[0])
  process.exitCode = mal || tMal || errores.length || malEstado || malNro ? 1 : 0
}
main().catch(e => { console.error('ERROR:', e.errors?.[0]?.message ?? e.message); process.exit(1) })
