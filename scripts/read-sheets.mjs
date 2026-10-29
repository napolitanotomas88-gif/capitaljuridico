import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=')
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
})

const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })

const FINANZAS = env.SHEET_ID_FINANZAS?.trim()
if (!FINANZAS) throw new Error('Falta SHEET_ID_FINANZAS')

try {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: FINANZAS })
  console.log('✅ Acceso OK — Pestañas:', meta.data.sheets.map(s => s.properties.title).join(', '))

  for (const tab of meta.data.sheets.slice(0, 5)) {
    const name = tab.properties.title
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: FINANZAS, range: `${name}!A1:Z5` })
    console.log(`\n[${name}]`)
    ;(res.data.values || []).forEach((row, i) => console.log(`  ${i+1}: ${JSON.stringify(row)}`))
  }
} catch(e) {
  console.log('❌ Sin acceso:', e.message)
}
