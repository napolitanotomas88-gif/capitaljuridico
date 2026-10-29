import { google } from 'googleapis'
import { readFileSync } from 'fs'
const env = {}
readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=')
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
})
const auth = new google.auth.JWT({ email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
const sheets = google.sheets({ version: 'v4', auth })
const id = env.SHEET_ID_VENTAS
for (const tab of ['Closer 1','Closer 2','Closer 3','Gero-Xavi Rejunte']) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A1:AB1` })
  const h = (res.data.values||[[]])[0]
  console.log(`\n[${tab}]`)
  h.forEach((x,i)=> x && console.log(`  ${i<26?String.fromCharCode(65+i):'A'+String.fromCharCode(65+i-26)} (${i}): ${x}`))
}
// distinct values per column 17..23 for each tab
for (const tab of ['Closer 1','Closer 2','Closer 3','Gero-Xavi Rejunte']) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A2:AB` })
  const d = {}
  for (const row of (res.data.values||[])) {
    if (!row[3]) continue
    for (let i = 17; i <= 23; i++) {
      const v = (row[i]??'').toString().trim()
      d[i] = d[i] || {}; d[i][v] = (d[i][v]??0)+1
    }
  }
  console.log(`\n[${tab}] distinct:`)
  for (const [i, vals] of Object.entries(d)) console.log(`  col ${i}:`, JSON.stringify(vals))
}
