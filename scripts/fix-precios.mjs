import { google } from 'googleapis'
import { readFileSync } from 'fs'
const env = {}
readFileSync('.env.local', 'utf8').split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '') })
const auth = new google.auth.JWT({ email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })
const ID = process.env.SHEET_ID_CLIENTES?.trim()
if (!ID) throw new Error('Falta SHEET_ID_CLIENTES')
// precios que SÍ están en el producto del Registro (los otros 3 son montos sueltos sin producto)
const fix = { A055: 6000, A097: 3300 }
const ren = (await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: 'Renovaciones!A1:H300', valueRenderOption: 'UNFORMATTED_VALUE' })).data.values || []
const data = []
ren.forEach((r, i) => {
  const id = (r[0] ?? '').toString()
  if (fix[id] && Number(r[2]) === 0 && !r[5]) {
    data.push({ range: `Renovaciones!F${i + 1}`, values: [[fix[id]]] })
    data.push({ range: `Renovaciones!G${i + 1}`, values: [['Programa inicial · precio del producto en Registro']] })
    console.log('completado', id, '→ $' + fix[id])
  }
})
if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: 'RAW', data } })

// Vistas de filtro rápidas (punto 4 del usuario)
const meta = await sheets.spreadsheets.get({ spreadsheetId: ID })
const S = meta.data.sheets.find(s => s.properties.title === 'Agencia').properties.sheetId
const existentes = new Set((meta.data.sheets.find(s => s.properties.title === 'Agencia').filterViews || []).map(f => f.title))
const R = { sheetId: S, startRowIndex: 0, endRowIndex: 400, startColumnIndex: 0, endColumnIndex: 20 }
const vistas = [
  { title: '🔴 EN RIESGO — vencidos', criteria: { 2: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'ACTIVO' }] } }, 9: { condition: { type: 'DATE_BEFORE', values: [{ relativeDate: 'TODAY' }] } } } },
  { title: '🟡 POR VENCER — 14 días', criteria: { 2: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'ACTIVO' }] } }, 9: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($J2>=TODAY(),$J2<=TODAY()+14)' }] } } } },
  { title: '🟠 SILENCIO +10 días', criteria: { 2: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'ACTIVO' }] } }, 19: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=OR($T2="",$T2<TODAY()-10)' }] } } } },
  { title: '🆕 ONBOARDING — primeros 14 días', criteria: { 2: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'ACTIVO' }] } }, 8: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($I2<>"",$I2>=TODAY()-14)' }] } } } },
  { title: '⚠️ MES 2-3 — momento crítico', criteria: { 2: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'ACTIVO' }] } }, 8: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($I2<=TODAY()-30,$I2>=TODAY()-90)' }] } } } },
  { title: '🎬 CANDIDATOS A TESTIMONIO', criteria: { 2: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'ACTIVO' }] } }, 14: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Sí' }] } }, 16: { condition: { type: 'NOT_TEXT_EQ', values: [{ userEnteredValue: 'Sí' }] } } } },
  { title: '💰 SIN PRECIO CARGADO', criteria: { 11: { condition: { type: 'NUMBER_LESS_THAN_EQ', values: [{ userEnteredValue: '0' }] } } } },
]
const reqs = vistas.filter(v => !existentes.has(v.title)).map(v => ({ addFilterView: { filter: { title: v.title, range: R, criteria: v.criteria } } }))
if (reqs.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } })
console.log('vistas de filtro creadas:', reqs.length)
