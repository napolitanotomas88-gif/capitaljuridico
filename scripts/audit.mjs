// AUDITORÍA COMPLETA: recalcula cada métrica desde los sheets (independiente
// del código del dashboard) y la compara con lo que sirve /api/raw y /api/metrics.
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
})
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/analytics.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })
const FIN = env.SHEET_ID_FINANZAS, VEN = env.SHEET_ID_VENTAS
const M = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const PROD = 'https://dashboard-metricas-eight.vercel.app'

const issues = []
const ok = []
const flag = (sev, msg) => issues.push(`[${sev}] ${msg}`)
const pass = (msg) => ok.push(msg)
const near = (a, b, tol = 1.5) => Math.abs((a ?? 0) - (b ?? 0)) <= tol

// ── 1. Datos crudos de sheets ────────────────────────────────────────
const [pagoRes, erRes, cuotasRes, ...closerRes] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId: FIN, range: 'Registro de Pagos!A:P', valueRenderOption: 'UNFORMATTED_VALUE' }),
  sheets.spreadsheets.values.get({ spreadsheetId: FIN, range: 'Estado de Resultados!A1:X50', valueRenderOption: 'UNFORMATTED_VALUE' }),
  sheets.spreadsheets.values.get({ spreadsheetId: VEN, range: 'Cuotas a Cobrar!J4:M4', valueRenderOption: 'UNFORMATTED_VALUE' }),
  ...['Closer 1','Closer 2','Closer 3','Gero-Xavi Rejunte'].map(t =>
    sheets.spreadsheets.values.get({ spreadsheetId: VEN, range: `${t}!A:T` })),
])
const pago = (pagoRes.data.values ?? []).slice(1)
const er = erRes.data.values ?? []
const cuotasRow = cuotasRes.data.values?.[0] ?? []

const serialDate = s => typeof s === 'number' ? new Date(Date.UTC(1899, 11, 30) + Math.round(s) * 86400000) : null
const amt = c => typeof c === 'number' ? c : 0
const amtTxt = c => { // igual que amountFromCell del dashboard
  if (typeof c === 'number') return c
  if (typeof c !== 'string') return 0
  const s = c.replace(/[$\s]/g, '').trim(); if (!s) return 0
  if (/,\d{1,2}$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
  return parseFloat(s.replace(/,/g, '')) || 0
}

// ── 2. Recomputar transacciones por mes ─────────────────────────────
const z = () => Array.from({ length: 12 }, () => 0)
const cashByDate = z(), feccu = z(), feccp = z(), becc = z(), sinCat = z()
const textAmountCells = []
for (const r of pago) {
  const d = serialDate(r[0]); if (!d || d.getUTCFullYear() !== 2026) continue
  const m = d.getUTCMonth()
  const a = amtTxt(r[4])
  if (typeof r[4] === 'string' && r[4].trim() !== '') textAmountCells.push(`${d.toISOString().slice(0,10)} "${r[4]}" (${(r[2]||'').toString().slice(0,20)})`)
  cashByDate[m] += a
  const cat = (r[15] ?? '').toString().trim()
  if (cat === 'FECCU') feccu[m] += a
  else if (cat === 'FECCP') feccp[m] += a
  else if (cat === 'BECC' || cat === 'BECCU' || cat === 'BECCP') becc[m] += a
  else sinCat[m] += a
}

// ── 3. ER: filas clave ───────────────────────────────────────────────
const norm = v => (v ?? '').toString().trim().toLowerCase()
const erRow = l => er.find(r => norm(r[0]) === l.toLowerCase())
const months = row => Array.from({ length: 12 }, (_, i) => amt(row?.[2 * i + 1]))
const erCash = months(erRow('Cash Collected'))
const erGastos = months(erRow('Gastos Totales'))
const erBenef = months(erRow('Beneficios Netos'))
const erVentas = months(erRow('Ventas'))
const erMkt = months(erRow('Marketing'))
const erAds = ['Anuncios X','Anuncios Y','Anuncios Z'].map(l => months(erRow(l)))

// ── 4. Closers: recomputar métricas de llamadas ─────────────────────
const ag = z(), calif = z(), pres = z(), cerr = z(), vsl = z(), ig = z(), otras = z()
for (const res of closerRes) {
  for (const row of (res.data.values ?? [])) {
    const raw = (row[3] ?? '').toString(); const p = raw.split(' ')[0].split('/')
    if (p.length < 3) continue
    const dd = parseInt(p[0]), mm = parseInt(p[1]), yy = parseInt(p[2].substring(0, 4))
    if (isNaN(dd) || isNaN(mm) || yy !== 2026 || mm < 1 || mm > 12) continue
    const m = mm - 1
    ag[m]++
    const q = (row[16] ?? '').toString().trim().toUpperCase()
    if (q === 'A' || q === 'B' || q === 'C') calif[m]++
    if ((row[17] ?? '').toString().trim().toLowerCase() === 'si') pres[m]++
    const t = (row[19] ?? '').toString().trim().toLowerCase()
    if (t === 'cerrado en llamada' || t === 'cerrado en seguimiento') cerr[m]++
    const g = (row[6] ?? '').toString().toLowerCase().trim(), h = (row[7] ?? '').toString().toLowerCase().trim(), iv = (row[8] ?? '').toString().toLowerCase().trim()
    if (`${g}|${h}|${iv}`.includes('inbound')) otras[m]++
    else if (g === 'paid_social' || g === 'paid') vsl[m]++
    else if (g === 'refe') otras[m]++
    else if (iv === 'bio') ig[m]++
    else otras[m]++
  }
}

// ── 5. API de producción ─────────────────────────────────────────────
// /api/raw y /api/metrics piden sesión de Google: un script entra con "Authorization: Bearer CRON_SECRET" (de .env.local)
const apiProd = async (ruta) => {
  if (!env.CRON_SECRET) throw new Error('Falta CRON_SECRET en .env.local: /api/raw y /api/metrics piden Authorization: Bearer')
  const r = await fetch(`${PROD}${ruta}`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })
  if (r.status === 401 || r.status === 403) throw new Error(`${ruta}: ${r.status}. El Bearer CRON_SECRET no coincide con el de Vercel`)
  return r.json()
}
const [rawApi, metApi] = await Promise.all([apiProd('/api/raw'), apiProd('/api/metrics')])

// ── 6. COMPARACIONES ─────────────────────────────────────────────────
// 6a. Cash mensual: ER vs API vs suma por fecha del Registro
for (let i = 0; i < 7; i++) {
  if (!near(erCash[i], rawApi.monthlyCash[i])) flag('ERROR', `monthlyCash ${M[i]}: API=${rawApi.monthlyCash[i]} vs ER=${erCash[i]}`)
  else pass(`monthlyCash ${M[i]} = ER (${Math.round(erCash[i])})`)
  if (!near(erCash[i], cashByDate[i], 2)) flag('DATO', `Cash ${M[i]}: ER=${Math.round(erCash[i])} vs Registro-por-fecha=${Math.round(cashByDate[i])} (dif ${Math.round(cashByDate[i]-erCash[i])}) — probable celda en texto o fecha`)
}
if (textAmountCells.length) flag('DATO', `Montos como TEXTO en Registro (el ER los ignora): ${textAmountCells.join(' | ')}`)

// 6b. Categorías por mes (por fecha) vs API transactions
const apiFeccu = z(), apiFeccp = z(), apiBecc = z(), apiSinCat = z()
for (const t of rawApi.transactions) {
  const m = new Date(t.date).getUTCMonth()
  if (t.category === 'FECCU') apiFeccu[m] += t.amount
  else if (t.category === 'FECCP') apiFeccp[m] += t.amount
  else if (['BECC','BECCU','BECCP'].includes(t.category)) apiBecc[m] += t.amount
  else apiSinCat[m] += t.amount
}
for (let i = 0; i < 7; i++) {
  if (!near(feccu[i], apiFeccu[i])) flag('ERROR', `FECCU ${M[i]}: API=${Math.round(apiFeccu[i])} vs sheet=${Math.round(feccu[i])}`)
  if (sinCat[i] > 1) flag('DATO', `${M[i]}: $${Math.round(sinCat[i])} SIN categoría en Registro`)
}
pass('Categorías FECCU/FECCP/BECC por mes coinciden API↔sheet')

// 6c. monthlyFECCU del API (para FECCU:CAC)
for (let i = 0; i < 7; i++) {
  if (!near(feccu[i], rawApi.monthlyFECCU[i])) flag('ERROR', `monthlyFECCU ${M[i]}: API=${Math.round(rawApi.monthlyFECCU[i])} vs sheet=${Math.round(feccu[i])}`)
}
pass('monthlyFECCU coincide')

// 6d. Llamadas
const pairs = [['monthlyAgendadas', ag], ['monthlyCalificadas', calif], ['monthlyPresentadas', pres], ['monthlyCerradas', cerr], ['monthlyVSL', vsl], ['monthlyIG', ig], ['monthlyOtrasFuentes', otras]]
for (const [key, arr] of pairs) {
  for (let i = 0; i < 8; i++) {
    if (arr[i] !== rawApi[key][i]) flag('ERROR', `${key} ${M[i]}: API=${rawApi[key][i]} vs sheet=${arr[i]}`)
  }
}
pass('Agendadas/Calificadas/Presentadas/Cerradas y canales coinciden (4 closers)')
// consistencia interna: canales suman agendadas
for (let i = 0; i < 8; i++) {
  const s = rawApi.monthlyVSL[i] + rawApi.monthlyIG[i] + rawApi.monthlyOtrasFuentes[i]
  if (s !== rawApi.monthlyAgendadas[i]) flag('ERROR', `Canales ${M[i]}: VSL+IG+Otras=${s} ≠ Agendadas=${rawApi.monthlyAgendadas[i]}`)
}
pass('VSL+IG+Otras = Agendadas en todos los meses')
// calls array consistente con agregados
const cAg = z(), cCer = z()
for (const c of rawApi.calls) { const m = new Date(c.date).getUTCMonth(); cAg[m]++; if (c.closed) cCer[m]++ }
for (let i = 0; i < 8; i++) {
  if (cAg[i] !== rawApi.monthlyAgendadas[i]) flag('ERROR', `calls[] ${M[i]}: ${cAg[i]} llamadas ≠ agregado ${rawApi.monthlyAgendadas[i]}`)
  if (cCer[i] !== rawApi.monthlyCerradas[i]) flag('ERROR', `calls[] cerradas ${M[i]}: ${cCer[i]} ≠ ${rawApi.monthlyCerradas[i]}`)
}
pass('Array calls[] consistente con agregados mensuales')

// 6e. NFCF / Margen / CAC / FECCU:CAC
for (let i = 0; i < 7; i++) {
  const expNFCF = erGastos[i] > 0 ? erBenef[i] : null
  const gotNFCF = rawApi.monthlyNFCF[i]
  if ((expNFCF === null) !== (gotNFCF === null) || (expNFCF !== null && !near(expNFCF, gotNFCF))) {
    flag('ERROR', `NFCF ${M[i]}: API=${gotNFCF} vs esperado=${expNFCF}`)
  }
  const adq = erAds.reduce((s, a) => s + a[i], 0) + erVentas[i] + erMkt[i]
  const expCAC = adq > 0 && cerr[i] > 0 ? adq / cerr[i] : null
  const gotCAC = rawApi.monthlyCAC[i]
  if ((expCAC === null) !== (gotCAC === null) || (expCAC !== null && !near(expCAC, gotCAC, 2))) {
    flag('ERROR', `CAC ${M[i]}: API=${gotCAC} vs esperado=${expCAC}`)
  }
  const expFC = adq > 0 && feccu[i] > 0 ? feccu[i] / adq : null
  const gotFC = rawApi.monthlyFeccuCac[i]
  if ((expFC === null) !== (gotFC === null) || (expFC !== null && !near(expFC, gotFC, 0.05))) {
    flag('ERROR', `FECCU:CAC ${M[i]}: API=${gotFC} vs esperado=${expFC?.toFixed(2)}`)
  }
}
pass('NFCF/Margen/CAC/FECCU:CAC coinciden con el ER')

// 6f. /api/metrics: monthlyRevenue = ER mes actual; cuotas
const curM = new Date().getMonth()
if (!near(metApi.monthlyRevenue, erCash[curM])) flag('ERROR', `monthlyRevenue (metrics): API=${metApi.monthlyRevenue} vs ER ${M[curM]}=${erCash[curM]}`)
else pass(`monthlyRevenue = ER ${M[curM]} (${Math.round(erCash[curM])})`)
const cuotasTotal = amt(cuotasRow[0]), cuotasCobradas = amt(cuotasRow[3])
if (!near(metApi.cuotasTotal ?? 0, cuotasTotal) || !near(metApi.cuotasCobradas ?? 0, cuotasCobradas)) {
  flag('WARN', `Cuotas: API total=${metApi.cuotasTotal}/cobradas=${metApi.cuotasCobradas} vs sheet J4=${cuotasTotal}/M4=${cuotasCobradas}`)
} else pass(`Cuotas a Cobrar: total=${cuotasTotal}, cobradas=${cuotasCobradas}`)

// 6g. GA4 (VSL) — probar conexión
try {
  const ga = google.analyticsdata({ version: 'v1beta', auth })
  const res = await ga.properties.runReport({
    property: 'properties/526875241',
    requestBody: { dateRanges: [{ startDate: '2026-01-01', endDate: 'today' }], dimensions: [{ name: 'yearMonth' }], metrics: [{ name: 'totalUsers' }] },
  })
  const rows = res.data.rows ?? []
  pass(`GA4 CONECTADO ✓ — visitantes por mes: ${rows.map(r => `${r.dimensionValues[0].value.slice(4)}=${r.metricValues[0].value}`).join(' ')}`)
} catch (e) {
  flag('PENDIENTE', `GA4 aún no accesible: ${e.message.split('.')[0]}`)
}

// ── RESULTADO ────────────────────────────────────────────────────────
console.log('══════════ AUDITORÍA ══════════\n')
console.log('✅ CORRECTO:')
ok.forEach(m => console.log('  ✓', m))
console.log(`\n${issues.length ? '⚠️  HALLAZGOS:' : '🎉 SIN HALLAZGOS'}`)
issues.forEach(m => console.log('  •', m))
