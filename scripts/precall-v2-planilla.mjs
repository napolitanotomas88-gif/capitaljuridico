// Pre-call v2 (docs/ENCENDIDO-PRECALL-V2.md): prepara la planilla «2026 - CRM Ventas - SKWD» para el flujo nuevo.
//   1. En las pestañas de closers agrega las columnas AM–AV (si hace falta, agranda la grilla), con encabezado y desplegables.
//      No borra ni mueve nada: AL («Cómo ejerce», la carga Make) y todo lo anterior quedan igual.
//   2. Crea la pestaña «Pre-caller»: SOLO LECTURA, una fórmula que junta los leads de todos los closers que el pre-caller
//      todavía no pasó. Se trabaja desde el Despacho (vista «Pre-caller · todos los closers»), no a mano en esta pestaña.
//
// Por defecto NO escribe nada: muestra lo que haría. Con --aplicar lo hace (correr desde la raíz del repo, con .env.local).
//   node scripts/precall-v2-planilla.mjs            → en seco
//   node scripts/precall-v2-planilla.mjs --aplicar  → escribe
//   --closers=Marcos,Nahuel (por defecto) → quiénes entran a la pestaña «Pre-caller» (igual que PRECALL_V2_CLOSERS)
import { google } from 'googleapis'
import { readFileSync } from 'fs'

const APLICAR = process.argv.includes('--aplicar')
const env = {}
readFileSync('.env.local', 'utf8').split('\n').forEach(linea => {
  const [k, ...v] = linea.split('=')
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
})
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: [`https://www.googleapis.com/auth/spreadsheets${APLICAR ? '' : '.readonly'}`],
})
const sheets = google.sheets({ version: 'v4', auth })
const ID = env.SHEET_ID_VENTAS

// Todas las pestañas de ventas (PESTANAS_VENTAS) llevan AM–AV: con PRECALL_V2=1 el CRM lee hasta AV en todas, y una grilla más
// corta da error de Sheets. Solo las de los closers de --closers (PRECALL_V2_CLOSERS) entran a la pestaña «Pre-caller».
const PESTANAS = { 'Closer 1': 'Carlos', 'Closer 2': 'Marcos', 'Closer 3': 'Yamila', 'Closer 4': 'Nahuel', 'Closer 5': 'Brenda', 'Gero-Xavi Rejunte': null }
const pedidos_ = (process.argv.find(a => a.startsWith('--closers=')) ?? '--closers=Marcos,Nahuel').slice('--closers='.length).split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
const CLOSERS = Object.fromEntries(Object.entries(PESTANAS).filter(([, c]) => c && pedidos_.includes(c.toLowerCase())))
console.log(`Vista «Pre-caller» con: ${Object.values(CLOSERS).join(', ') || '(ninguno)'}\n`)

// AM–AV: tienen que coincidir con ENCABEZADOS_ESPERADOS de lib/crm/sheets/columnas.ts y los valores con lib/crm/config/precallV2.ts.
const COLUMNAS = [
  ['AM', 'Pre-caller · Contacto', ['No atendió 1ª', 'No atendió 2ª', 'Llamada efectiva', 'Pre-call por chat']],
  ['AN', 'Pre-caller · ¿Confirmó?', ['Si', 'Reprograma']],
  ['AO', 'Pre-caller · Decisores', ['Decide solo', 'Vienen decisores']],
  ['AP', 'Pre-caller · Facturación confirmada', null],
  ['AQ', 'Pre-caller · Situación del estudio', null],
  ['AR', 'Pre-caller · Urgencia confirmada', null],
  ['AS', 'Pre-caller · Seguimientos', ['S1', 'S2', 'S3', 'S4']],
  ['AT', 'Pre-caller · Estado', ['Pendiente', 'Pasado al closer', 'Liberado']],
  ['AU', 'Pre-caller · Pasado al closer', null],
  ['AV', 'Pre-caller · Notas para el closer', null],
]
const indice = letra => [...letra].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
const ULTIMA = indice('AV') + 1 // columnas que necesita la grilla (48)

const meta = await sheets.spreadsheets.get({ spreadsheetId: ID, fields: 'sheets.properties(sheetId,title,gridProperties)' })
const props = Object.fromEntries(meta.data.sheets.map(s => [s.properties.title, s.properties]))
const pedidos = []

for (const hoja of Object.keys(PESTANAS)) {
  const p = props[hoja]
  if (!p) { console.log(`✗ no existe la pestaña ${hoja}`); continue }
  const actuales = (await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: `'${hoja}'!AL1:AV1` }).catch(() => ({ data: {} }))).data.values?.[0] ?? []
  if (actuales[0] !== 'Cómo ejerce') console.log(`⚠ ${hoja}: AL1 dice "${actuales[0] ?? ''}" (se esperaba "Cómo ejerce"); AL no se toca igual`)
  const ocupadas = COLUMNAS.filter(([l, titulo], i) => actuales[i + 1] && actuales[i + 1] !== titulo)
  if (ocupadas.length) { console.log(`✗ ${hoja}: ${ocupadas.map(([l]) => l).join(', ')} ya tienen otro encabezado. No se toca esta pestaña.`); continue }
  if (p.gridProperties.columnCount < ULTIMA) {
    console.log(`· ${hoja}: agrandar la grilla de ${p.gridProperties.columnCount} a ${ULTIMA} columnas`)
    pedidos.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: ULTIMA - p.gridProperties.columnCount } })
  }
  for (const [letra, titulo, lista] of COLUMNAS) {
    const col = indice(letra)
    pedidos.push({
      updateCells: {
        range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        rows: [{ values: [{ userEnteredValue: { stringValue: titulo } }] }],
        fields: 'userEnteredValue',
      },
    })
    if (lista) {
      pedidos.push({
        setDataValidation: {
          range: { sheetId: p.sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
          rule: { condition: { type: 'ONE_OF_LIST', values: lista.map(v => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true },
        },
      })
    }
  }
  console.log(`· ${hoja}: encabezados AM–AV y desplegables de AM, AN, AO, AS y AT`)
}

// «Pre-caller»: cada pestaña con el nombre del closer adelante, apiladas, y QUERY con los que siguen con el pre-caller.
// Columnas del bloque: Col1 = closer, Col2.. = A..AV (Col2 = A, Col5 = D, Col47 = AT).
const c = letra => `Col${indice(letra) + 2}`
const bloques = Object.entries(CLOSERS).map(([hoja, closer]) => `{ARRAYFORMULA(IF('${hoja}'!A2:A<>"";"${closer}";""))\\'${hoja}'!A2:AV}`)
const columnas = [c('D'), 'Col1', c('A'), c('B'), c('G'), c('L'), c('AP'), c('J'), c('AQ'), c('AO'), c('M'), c('AR'), c('AM'), c('AN'), c('AS'), c('AT'), c('AU'), c('AV')]
// En QUERY una celda vacía no cumple "<>": cada condición sobre AT y F acepta el vacío. Solo leads del flujo nuevo (AT con algo,
// o F y AI vacías, igual que `esLeadV2`) y no pasados, liberados ni olvidados.
const consulta = [
  `select ${columnas.join(', ')}`,
  `where Col1 <> '' and ${c('D')} is not null`,
  `and (${c('AT')} is not null or (${c('F')} is null and ${c('AI')} is null))`,
  `and (${c('AT')} is null or (${c('AT')} <> 'Pasado al closer' and ${c('AT')} <> 'Liberado'))`,
  `and (${c('F')} is null or ${c('F')} <> 'Olvidar')`,
  `order by ${c('D')} desc`,
].join(' ')
const formula = `=QUERY({${bloques.join(';')}};"${consulta}";0)`
const encabezados = ['Llamada (día y hora)', 'Closer', 'Lead', 'WhatsApp', 'Origen', 'Facturación (calendario)', 'Facturación confirmada', 'Situación (calendario)', 'Situación confirmada', 'Decisores', 'Urgencia (calendario)', 'Urgencia confirmada', 'Contacto', '¿Confirmó?', 'Seguimientos', 'Estado', 'Pasado al closer', 'Notas para el closer']

console.log(props['Pre-caller'] ? '· La pestaña «Pre-caller» ya existe: se reescriben encabezados y fórmula' : '· Crear la pestaña «Pre-caller» (solo lectura)')
console.log(`  Fórmula de A2:\n  ${formula}\n`)

if (!APLICAR) {
  console.log(`EN SECO: ${pedidos.length} cambios en las pestañas de closers, nada escrito. Para hacerlo: --aplicar`)
  process.exit(0)
}
if (pedidos.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: pedidos } })
if (!props['Pre-caller']) await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: 'Pre-caller', gridProperties: { frozenRowCount: 1 } } } }] } })
await sheets.spreadsheets.values.update({ spreadsheetId: ID, range: `'Pre-caller'!A1:R2`, valueInputOption: 'USER_ENTERED', requestBody: { values: [encabezados, [formula]] } })
console.log('✓ Planilla lista para el pre-call v2')
