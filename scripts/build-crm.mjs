import { google } from 'googleapis'
import { readFileSync } from 'fs'
const env = {}
readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=')
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
})
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })
const ID = process.argv[2]
if (!ID) { console.error('Uso: node build-crm.mjs <spreadsheetId>'); process.exit(1) }

// ── 1. Migración desde el CRM viejo ─────────────────────────────────
const old = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-tomasexequielnapolitano-Dashboard-M-tricas-/68bc9228-dbe3-4d66-972d-98b7a69edc1d/scratchpad/clientes-old.json', 'utf8'))
const money = s => { const n = parseFloat((s??'').toString().replace(/[$,\s]/g,'')); return isFinite(n) && n > 0 ? n : null }
const txt = c => (c??'').toString().trim()
const estadoMap = e => { const v = txt(e).toUpperCase(); if (v === 'TERMINÓ' || v === 'TERMINO') return 'FINALIZADO'; return v || '' }

const agencia = [], consultora = [], renovaciones = []
let seqA = 0
for (const r of old['Agencia'].slice(1)) {
  if (!txt(r[0])) continue
  seqA++
  const id = 'A' + String(seqA).padStart(3, '0')
  const notasRenov = [txt(r[7]), txt(r[8]) ? `Pagos restantes: ${txt(r[8])}` : ''].filter(Boolean).join(' · ')
  agencia.push({ id, nombre: txt(r[0]), estado: estadoMap(r[1]), cel: txt(r[2]), mail: txt(r[3]), closer: txt(r[22]), contrato: txt(r[4]), gameplan: '', notasRenov, anot: txt(r[33]) })
  renovaciones.push([id, txt(r[0]), 0, txt(r[5]), txt(r[6]), money(r[9]), 'Programa inicial'])
  const bloques = [[12,13,14],[15,16,17],[18,19,20]]
  bloques.forEach(([d, f, p], i) => {
    if (txt(r[d]) || txt(r[f]) || money(r[p])) renovaciones.push([id, txt(r[0]), i+1, txt(r[d]), txt(r[f]), money(r[p]), ''])
  })
}
let seqC = 0
for (const r of old['Consultora'].slice(1)) {
  if (!txt(r[0])) continue
  seqC++
  const id = 'C' + String(seqC).padStart(3, '0')
  consultora.push({ id, nombre: txt(r[0]), estado: estadoMap(r[1]), cel: txt(r[2]), mail: txt(r[3]), closer: '', contrato: txt(r[4]), gameplan: txt(r[6]).replace(/^-+$/,''), notasRenov: txt(r[8]) ? `Renovó: ${txt(r[8])}` : '', anot: '' })
  renovaciones.push([id, txt(r[0]), 0, txt(r[5]), txt(r[7]), null, 'Programa inicial'])
}
console.log('agencia:', agencia.length, '| consultora:', consultora.length, '| períodos:', renovaciones.length)

// ── 2. Estructura de pestañas ───────────────────────────────────────
const meta = await sheets.spreadsheets.get({ spreadsheetId: ID })
console.log('destino:', meta.data.properties.title)
const existing = meta.data.sheets.map(s => s.properties)
const reqs0 = []
reqs0.push({ updateSpreadsheetProperties: { properties: { locale: 'en_GB', timeZone: 'America/Argentina/Buenos_Aires' }, fields: 'locale,timeZone' } })
reqs0.push({ updateSheetProperties: { properties: { sheetId: existing[0].sheetId, title: 'Agencia', gridProperties: { rowCount: 400, columnCount: 19, frozenRowCount: 1, frozenColumnCount: 2 } }, fields: 'title,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } })
const wanted = [['Consultora', 200, 19, 1], ['Renovaciones', 600, 7, 1], ['Métricas', 60, 10, 0], ['Config', 20, 5, 0]]
for (const [title, rows, cols, frozen] of wanted) {
  if (!existing.find(s => s.title === title)) reqs0.push({ addSheet: { properties: { title, gridProperties: { rowCount: rows, columnCount: cols, frozenRowCount: frozen } } } })
}
for (const s of existing.slice(1)) {
  if (!['Agencia','Consultora','Renovaciones','Métricas','Config'].includes(s.title)) reqs0.push({ deleteSheet: { sheetId: s.sheetId } })
}
await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs0 } })
const meta2 = await sheets.spreadsheets.get({ spreadsheetId: ID })
const sid = {}
for (const s of meta2.data.sheets) sid[s.properties.title] = s.properties.sheetId
console.log('pestañas:', Object.keys(sid).join(', '))

// ── 3. Valores ──────────────────────────────────────────────────────
// A ID | B Nombre | C Estado | D Celular | E Mail | F Closer | G Fuente | H Contrato
// I Día1(auto) | J Fin actual(auto) | K Renovó(auto) | L LTV(auto) | M Duración(auto)
// N Promesa | O Satisfacción | P Testimonio | Q GamePlan | R Notas renovación | S Anotaciones
const HEAD = ['ID','Nombre','Estado','Celular','Mail','Closer','Fuente','Contrato','Día 1','Fin período actual','Renovó','LTV','Duración (días)','Promesa alcanzada','Satisfacción (1-10)','Testimonio','GamePlan Video','Notas renovación','Anotaciones']
const rowsFor = (list) => list.map((c, i) => {
  const n = i + 2
  return [c.id, c.nombre, c.estado, c.cel, c.mail, c.closer, '', c.contrato,
    `=IF(COUNTIFS(Renovaciones!$A:$A,$A${n},Renovaciones!$D:$D,"<>")=0,"",MINIFS(Renovaciones!$D:$D,Renovaciones!$A:$A,$A${n},Renovaciones!$D:$D,"<>"))`,
    `=IF(COUNTIFS(Renovaciones!$A:$A,$A${n},Renovaciones!$E:$E,"<>")=0,"",MAXIFS(Renovaciones!$E:$E,Renovaciones!$A:$A,$A${n}))`,
    `=IF($A${n}="","",IF(COUNTIFS(Renovaciones!$A:$A,$A${n},Renovaciones!$C:$C,">0")=0,"NO","R"&COUNTIFS(Renovaciones!$A:$A,$A${n},Renovaciones!$C:$C,">0")))`,
    `=IF($A${n}="","",SUMIF(Renovaciones!$A:$A,$A${n},Renovaciones!$F:$F))`,
    `=IF(OR($I${n}="",$J${n}=""),"",$J${n}-$I${n})`,
    '', '', '', c.gameplan, c.notasRenov, c.anot]
})
const HEAD_REN = ['ID Cliente','Nombre','Período (0=inicial)','Día 1','Finalización','Precio','Notas']
const renRows = renovaciones.map(r => [r[0], r[1], r[2], r[3] || '', r[4] || '', r[5] ?? '', r[6]])

const both = (f) => `${f('Agencia')}+${f('Consultora')}`
const M = [
  ['MÉTRICAS AUTOMÁTICAS — CRM CLIENTES SKWD', '', '', ''],
  ['', '', '', ''],
  ['Clientes totales', `=${both(t => `COUNTA(${t}!A2:A)`)}`, 'Agencia / Consultora', `=COUNTA(Agencia!A2:A)&" / "&COUNTA(Consultora!A2:A)`],
  ['Activos', `=${both(t => `COUNTIF(${t}!C2:C,"ACTIVO")`)}`, 'Pausados', `=${both(t => `COUNTIF(${t}!C2:C,"PAUSADO")`)}`],
  ['Finalizados', `=${both(t => `COUNTIF(${t}!C2:C,"FINALIZADO")`)}`, 'Inactivos', `=${both(t => `COUNTIF(${t}!C2:C,"INACTIVO")`)}`],
  ['', '', '', ''],
  ['LTV promedio (todos)', `=IFERROR((SUM(Agencia!L2:L)+SUM(Consultora!L2:L))/(COUNTIF(Agencia!L2:L,">0")+COUNTIF(Consultora!L2:L,">0")),"")`, 'LTV total contratado', `=SUM(Agencia!L2:L)+SUM(Consultora!L2:L)`],
  ['LTV promedio Agencia', `=IFERROR(AVERAGEIF(Agencia!L2:L,">0"),"")`, 'LTV promedio Consultora', `=IFERROR(AVERAGEIF(Consultora!L2:L,">0"),"sin precios cargados")`],
  ['', '', '', ''],
  ['Clientes que renovaron ≥1 vez', `=${both(t => `COUNTIF(${t}!K2:K,"R*")`)}`, 'Tasa de renovación', `=IFERROR((${both(t => `COUNTIF(${t}!K2:K,"R*")`)})/((${both(t => `COUNTIF(${t}!K2:K,"R*")`)})+(${both(t => `COUNTIFS(${t}!K2:K,"NO",${t}!C2:C,"<>ACTIVO")`)})),"")`],
  ['Duración promedio (días, no activos)', `=IFERROR((${both(t => `SUMIFS(${t}!M2:M,${t}!C2:C,"<>ACTIVO",${t}!M2:M,">0")`)})/(${both(t => `COUNTIFS(${t}!C2:C,"<>ACTIVO",${t}!M2:M,">0")`)}),"")`, '', ''],
  ['', '', '', ''],
  ['Tasa de éxito (promesa alcanzada)', `=IFERROR((${both(t => `COUNTIF(${t}!N2:N,"Sí")`)})/(${both(t => `COUNTIFS(${t}!N2:N,"<>")`)}),"sin datos aún")`, 'Satisfacción promedio', `=IFERROR((${both(t => `SUM(${t}!O2:O)`)})/(${both(t => `COUNT(${t}!O2:O)`)}),"sin datos aún")`],
  ['', '', '', ''],
  ['CHURN POR MES (2026)', '', '', ''],
  ['Mes', 'Finalizaron sin renovar', 'Renovaron', 'Churn %'],
]
for (let m = 0; m < 12; m++) {
  const n = M.length + 1
  M.push([
    ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][m],
    `=${both(t => `COUNTIFS(${t}!$J$2:$J,">="&DATE(2026,${m+1},1),${t}!$J$2:$J,"<"&DATE(2026,${m+2},1),${t}!$C$2:$C,"<>ACTIVO")`)}`,
    `=COUNTIFS(Renovaciones!$C$2:$C,">0",Renovaciones!$D$2:$D,">="&DATE(2026,${m+1},1),Renovaciones!$D$2:$D,"<"&DATE(2026,${m+2},1))`,
    `=IF(B${n}+C${n}=0,"",B${n}/(B${n}+C${n}))`,
  ])
}
const CONFIG = [
  ['ESTADO','CONTRATO','PROMESA','GAMEPLAN'],
  ['ACTIVO','Firmado','Sí','ENVIADO'],
  ['FINALIZADO','No hay','Parcial','PENDIENTE'],
  ['INACTIVO','Pendiente','No',''],
  ['PAUSADO','','',''],
]
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: {
  valueInputOption: 'USER_ENTERED',
  data: [
    { range: 'Agencia!A1', values: [HEAD, ...rowsFor(agencia)] },
    { range: 'Consultora!A1', values: [HEAD, ...rowsFor(consultora)] },
    { range: 'Renovaciones!A1', values: [HEAD_REN, ...renRows] },
    { range: 'Métricas!A1', values: M },
    { range: 'Config!A1', values: CONFIG },
  ],
}})
console.log('valores cargados')

// ── 4. Formato SKWD ────────────────────────────────────────────────
const DARK = { red: 0.102, green: 0.102, blue: 0.102 }
const ORANGE = { red: 0.953, green: 0.573, blue: 0 }
const WHITE = { red: 1, green: 1, blue: 1 }
const GRAY = { red: 0.969, green: 0.969, blue: 0.969 }
const header = (sheetId, cols) => ({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
  cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { foregroundColor: ORANGE, bold: true, fontSize: 9 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
  fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)' } })
const cliFormat = (S, rows) => ([
  header(S, 19),
  { addBanding: { bandedRange: { range: { sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: 19 }, rowProperties: { firstBandColor: WHITE, secondBandColor: GRAY } } } },
  { setDataValidation: { range: { sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 2, endColumnIndex: 3 }, rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Config!$A$2:$A$5' }] }, showCustomUi: true, strict: false } } },
  { setDataValidation: { range: { sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 7, endColumnIndex: 8 }, rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Config!$B$2:$B$4' }] }, showCustomUi: true, strict: false } } },
  { setDataValidation: { range: { sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 13, endColumnIndex: 14 }, rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Config!$C$2:$C$4' }] }, showCustomUi: true, strict: false } } },
  ...[['ACTIVO', { red: 0.85, green: 0.94, blue: 0.85 }], ['FINALIZADO', { red: 0.93, green: 0.93, blue: 0.93 }], ['INACTIVO', { red: 0.99, green: 0.89, blue: 0.85 }], ['PAUSADO', { red: 1, green: 0.95, blue: 0.8 }]].map(([v, color]) => ({
    addConditionalFormatRule: { rule: { ranges: [{ sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 2, endColumnIndex: 3 }],
      booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: v }] }, format: { backgroundColor: color, textFormat: { bold: true } } } } },
  })),
  { repeatCell: { range: { sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } },
  { repeatCell: { range: { sheetId: S, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 8, endColumnIndex: 10 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } },
  { updateDimensionProperties: { range: { sheetId: S, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId: S, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
  { updateDimensionProperties: { range: { sheetId: S, dimension: 'COLUMNS', startIndex: 17, endIndex: 19 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } },
])
const reqs = [
  ...cliFormat(sid['Agencia'], 400),
  ...cliFormat(sid['Consultora'], 200),
  header(sid['Renovaciones'], 7),
  header(sid['Config'], 4),
  { addBanding: { bandedRange: { range: { sheetId: sid['Renovaciones'], startRowIndex: 1, endRowIndex: 600, startColumnIndex: 0, endColumnIndex: 7 }, rowProperties: { firstBandColor: WHITE, secondBandColor: GRAY } } } },
  { repeatCell: { range: { sheetId: sid['Renovaciones'], startRowIndex: 1, endRowIndex: 600, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } },
  { repeatCell: { range: { sheetId: sid['Renovaciones'], startRowIndex: 1, endRowIndex: 600, startColumnIndex: 3, endColumnIndex: 5 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } },
  { updateDimensionProperties: { range: { sheetId: sid['Renovaciones'], dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: sid['Métricas'], startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { foregroundColor: ORANGE, bold: true, fontSize: 11 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  { repeatCell: { range: { sheetId: sid['Métricas'], startRowIndex: 15, endRowIndex: 17, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.91, green: 0.306, blue: 0.059 }, textFormat: { foregroundColor: WHITE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  { repeatCell: { range: { sheetId: sid['Métricas'], startRowIndex: 17, endRowIndex: 29, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } }, fields: 'userEnteredFormat.numberFormat' } },
  { repeatCell: { range: { sheetId: sid['Métricas'], startRowIndex: 2, endRowIndex: 14, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { updateDimensionProperties: { range: { sheetId: sid['Métricas'], dimension: 'COLUMNS', startIndex: 0, endIndex: 4 }, properties: { pixelSize: 210 }, fields: 'pixelSize' } },
]
await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } })
console.log('formato aplicado')
console.log('URL: https://docs.google.com/spreadsheets/d/' + ID + '/edit')
