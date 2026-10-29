// Construye de cero el "CRM de Ventas SKWD — PRUEBA" (Google Sheet aparte; NO toca el sheet de Ventas real).
// Uso: node scripts/crm-prueba.js            → reconstruye todo (borra y recrea las 4 pestañas, con datos de ejemplo)
//      node scripts/crm-prueba.js --sin-datos → igual pero sin filas de ejemplo
// Idempotente: se puede correr las veces que haga falta.
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')

const SPREADSHEET_ID = process.env.SHEET_ID_PRUEBA?.trim()
if (!SPREADSHEET_ID) throw new Error('Falta SHEET_ID_PRUEBA')
const SIN_DATOS = process.argv.includes('--sin-datos')

const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '')
}
const auth = new google.auth.JWT({ email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
const sheets = google.sheets({ version: 'v4', auth })

// ── Identidad de las pestañas ────────────────────────────────────────────────
const S = { manual: 101, llamadas: 102, metricas: 103, listas: 104 }
const T = { manual: '📖 Cómo usar', llamadas: '📞 Llamadas', metricas: '📊 Métricas', listas: '⚙️ Listas' }
const FILAS = 2000            // filas de datos previstas en Llamadas
const F1 = 3                  // primera fila de datos (1 = bandas, 2 = encabezados)

// ── Listas (lo único que el dueño toca para agregar un closer, un canal, etc.) ──
const LISTAS = {
  closers: ['Carlos', 'Marcos', 'Gero'],
  agendo: ['Maite', 'Se agendó solo', 'Gero', 'Otro'],
  canal: ['VSL (anuncio)', 'VSL Uruguay', 'Instagram', 'Webinar', 'Referido', 'Enrutamiento WhatsApp', 'Otro'],
  presento: ['Sí', 'No', 'Reagendó', 'Canceló'],
  resultado: ['Cerró', 'Seguimiento', 'Quiere pensarlo', 'Decide con otra persona', 'Sin dinero', 'No le interesa', 'No califica'],
  calif: ['A', 'B', 'C', 'D', 'E'],
}

// ── Columnas de 📞 Llamadas ──────────────────────────────────────────────────
const COLS = [
  // LA LLAMADA (automático). Lead es la única columna congelada: en el celular queda fija y el bloque naranja a un scroll.
  { k: 'lead', h: 'Lead', w: 175, b: 'auto' },
  { k: 'fecha', h: 'Fecha y hora', w: 125, b: 'auto' },
  { k: 'closer', h: 'Closer', w: 85, b: 'auto' },
  // bloque CLOSER (lo único que se carga a mano)
  { k: 'presento', h: '¿Se presentó?', w: 120, b: 'closer' },
  { k: 'resultado', h: 'Resultado', w: 180, b: 'closer' },
  { k: 'valor', h: 'Valor del programa (USD)', w: 130, b: 'closer' },
  { k: 'cobrado', h: 'Cobrado (USD)', w: 110, b: 'closer' },
  { k: 'proximo', h: 'Próximo contacto', w: 120, b: 'closer' },
  { k: 'nota', h: 'Nota', w: 250, b: 'closer' },
  { k: 'grabacion', h: 'Grabación (link)', w: 150, b: 'closer' },
  // AUTOMÁTICO
  { k: 'estado', h: 'Estado', w: 160, b: 'auto' },
  { k: 'whatsapp', h: 'WhatsApp', w: 140, b: 'auto' },
  { k: 'email', h: 'Email', w: 190, b: 'auto' },
  { k: 'agendo', h: 'Agendó', w: 120, b: 'auto' },
  { k: 'canal', h: 'Canal', w: 150, b: 'auto' },
  { k: 'anuncio', h: 'Anuncio', w: 200, b: 'auto' },
  { k: 'calif', h: 'Calificación', w: 95, b: 'auto' },
  { k: 'link', h: 'Link de la reunión', w: 160, b: 'auto' },
  // FICHA DEL LEAD (plegada)
  { k: 'precall', h: 'Pre-call', w: 150, b: 'ficha' },
  { k: 'facturacion', h: 'Facturación mensual', w: 150, b: 'ficha' },
  { k: 'urgencia', h: 'Urgencia', w: 180, b: 'ficha' },
  { k: 'obstaculo', h: 'Obstáculo', w: 220, b: 'ficha' },
  { k: 'objetivo', h: 'Objetivo', w: 170, b: 'ficha' },
  { k: 'inversion', h: 'Inversión disponible', w: 190, b: 'ficha' },
  { k: 'contexto', h: 'Contexto del setter', w: 260, b: 'ficha' },
  { k: 'idcalendly', h: 'ID de Calendly', w: 150, b: 'ficha' },     // para que Make no duplique filas y pueda marcar "Canceló" solo
  // ayudantes de cálculo (ocultos)
  { k: 'mes', h: 'Mes', w: 100, b: 'calc' },
  { k: 'closern', h: 'Closer (cálculo)', w: 110, b: 'calc' },
  { k: 'fechan', h: 'Fecha (cálculo)', w: 130, b: 'calc' },
  { k: 'clave', h: 'Lead (clave)', w: 160, b: 'calc' },
  { k: 'nrolead', h: 'Llamada nº del lead', w: 110, b: 'calc' },
]
const IDX = Object.fromEntries(COLS.map((c, i) => [c.k, i]))
const L = i => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26))
const colL = k => L(IDX[k])

// ── Colores ─────────────────────────────────────────────────────────────────
const hex = h => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 })
const C = {
  navy: hex('#0F172A'), tinta: hex('#1E293B'), gris: hex('#64748B'), grisClaro: hex('#E2E8F0'), fondo: hex('#F1F5F9'), casiBlanco: hex('#F8FAFC'), blanco: hex('#FFFFFF'),
  azul: hex('#2563EB'), azulClaro: hex('#DBEAFE'), naranja: hex('#F59E0B'), naranjaOsc: hex('#B45309'), naranjaClaro: hex('#FFF7E6'),
  verde: hex('#16A34A'), verdeClaro: hex('#DCFCE7'), rojo: hex('#DC2626'), rojoClaro: hex('#FEE2E2'), amarilloClaro: hex('#FEF9C3'), violetaClaro: hex('#EDE9FE'),
}

// ── Ayudantes de requests ───────────────────────────────────────────────────
const rng = (sheetId, r1, c1, r2, c2) => ({ sheetId, startRowIndex: r1 - 1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 + 1 })   // filas 1-based, columnas 0-based inclusivas
const fmt = (sheetId, r1, c1, r2, c2, f) => ({ repeatCell: { range: rng(sheetId, r1, c1, r2, c2), cell: { userEnteredFormat: f }, fields: 'userEnteredFormat(' + Object.keys(f).join(',') + ')' } })
const merge = (sheetId, r1, c1, r2, c2) => ({ mergeCells: { range: rng(sheetId, r1, c1, r2, c2), mergeType: 'MERGE_ALL' } })
const ancho = (sheetId, c1, c2, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c1, endIndex: c2 + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })
const alto = (sheetId, r1, r2, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: r1 - 1, endIndex: r2 }, properties: { pixelSize: px }, fields: 'pixelSize' } })
const borde = (sheetId, r1, c1, r2, c2, color = C.grisClaro) => {
  const b = { style: 'SOLID', color }
  return { updateBorders: { range: rng(sheetId, r1, c1, r2, c2), top: b, bottom: b, left: b, right: b } }
}
const txt = (o = {}) => ({ fontFamily: o.font ?? 'Roboto', fontSize: o.size ?? 10, bold: !!o.bold, italic: !!o.italic, foregroundColor: o.color ?? C.tinta })
const lista = (sheetId, r1, c1, r2, c2, rangoA1, msg) => ({
  setDataValidation: { range: rng(sheetId, r1, c1, r2, c2), rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=${rangoA1}` }] }, strict: true, showCustomUi: true, inputMessage: msg } },
})

// ── Datos de ejemplo (ficticios y determinísticos) ──────────────────────────
function datosDeEjemplo() {
  let seed = 20260919
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const pick = (arr, pesos) => { const tot = pesos.reduce((a, b) => a + b, 0); let x = rnd() * tot; for (let i = 0; i < arr.length; i++) { x -= pesos[i]; if (x <= 0) return arr[i] } return arr[arr.length - 1] }
  const nombres = ['Laura', 'Martín', 'Sofía', 'Diego', 'Valentina', 'Andrés', 'Camila', 'Julián', 'Paula', 'Ricardo', 'Florencia', 'Esteban', 'Mariana', 'Pablo', 'Carolina', 'Gustavo', 'Natalia', 'Hernán', 'Lucía', 'Federico']
  const anuncios = ['Ni consulta ni presupuestar', 'Pizarra free', 'Testimonio directo', 'Acting feria', 'Abg tradicional vs líder', 'bio', '']
  const ahora = Date.now()
  const serial = ms => (ms - 3 * 3600_000) / 86_400_000 + 25569            // hora de pared de Argentina (UTC-3) → número de fecha de Sheets
  const filas = []
  let cierresEj = 0
  const pendientes = []
  const inicio = Date.UTC(2026, 6, 1, 12), fin = Date.UTC(2026, 8, 27, 12)   // 1-jul a 27-sep (las últimas quedan a futuro)
  const total = 84
  for (let i = 0; i < total; i++) {
    const dia = inicio + Math.floor((fin - inicio) * (i / total) / 86_400_000) * 86_400_000
    const horaAR = pick([9, 10, 11, 12, 14, 15, 16, 17, 18, 19], [1, 2, 2, 1, 2, 3, 3, 2, 2, 1]), min = pick([0, 30], [3, 2])
    const ms = dia - 12 * 3600_000 + (horaAR + 3) * 3600_000 + min * 60_000
    const paso = ms <= ahora
    const closer = pick(LISTAS.closers, [5, 5, 2])
    const calif = pick(LISTAS.calif, [1, 3, 6, 5, 1])
    const canal = pick(LISTAS.canal, [10, 1, 6, 1, 1, 1, 0.5])
    const agendo = canal === 'Instagram' ? pick(LISTAS.agendo, [8, 1, 1, 0]) : pick(LISTAS.agendo, [1, 8, 0, 0.3])
    let presento = '', resultado = '', valor = '', cobrado = '', proximo = '', nota = ''
    const reciente = paso && ahora - ms < 3 * 86_400_000
    if (paso && !(reciente && rnd() < 0.55)) {
      const bueno = calif === 'A' || calif === 'B'
      presento = pick(LISTAS.presento, [bueno ? 75 : 58, bueno ? 12 : 26, 9, 6])
      if (presento === 'Sí') {
        resultado = pick(LISTAS.resultado, [bueno ? 30 : 9, 16, 24, 12, bueno ? 6 : 20, 10, 4])
        if (resultado === 'Cerró') {
          valor = pick([2600, 3200, 4000], [5, 3, 2])
          cobrado = ++cierresEj === 4 ? 0 : pick([valor, 1300, 750], [4, 3, 2])     // el 4º queda "de palabra" para mostrar la alerta
          nota = cobrado === 0 ? 'Dijo que sí, paga el lunes' : cobrado < valor ? 'Pagó una parte, resto en cuotas' : 'Pago completo'
        } else if (['Seguimiento', 'Quiere pensarlo', 'Decide con otra persona'].includes(resultado)) {
          proximo = Math.floor(serial(ms)) + pick([2, 3, 5, 7], [3, 3, 2, 1])
          nota = resultado === 'Decide con otra persona' ? 'Lo habla con su socio' : 'Volver a llamar'
        }
      } else if (presento === 'Reagendó') { proximo = Math.floor(serial(ms)) + 2; nota = 'Pidió pasar la llamada' }
    }
    // Un lead que reagendó vuelve a aparecer dos llamadas después (misma persona → otra fila): así "leads distintos" < "agendadas"
    const repetido = pendientes.length && i - pendientes[0].i >= 2 ? pendientes.shift() : null
    const nombre = repetido?.nombre ?? `${nombres[i % nombres.length]} ${String.fromCharCode(65 + (i * 7) % 26)}. (ejemplo)`
    if (presento === 'Reagendó') pendientes.push({ i, nombre, n: repetido?.n ?? i })
    const nLead = repetido?.n ?? i
    const fila = new Array(COLS.length).fill('')
    fila[IDX.fecha] = serial(ms); fila[IDX.lead] = nombre; fila[IDX.closer] = closer
    fila[IDX.presento] = presento; fila[IDX.resultado] = resultado; fila[IDX.valor] = valor; fila[IDX.cobrado] = cobrado; fila[IDX.proximo] = proximo; fila[IDX.nota] = nota
    fila[IDX.grabacion] = presento === 'Sí' ? 'https://fathom.video/share/ejemplo' : ''
    fila[IDX.whatsapp] = `+54 9 11 5555-${String(1000 + nLead).slice(1)}`; fila[IDX.email] = `ejemplo${nLead + 1}@ejemplo.com`
    fila[IDX.precall] = pick(['Hecho - link a call', 'CONF + DECISORES', 'VIDEOS CONF', 'Olvidar'], [6, 1, 1, 2]); fila[IDX.idcalendly] = `ejemplo-${String(i + 1).padStart(3, '0')}`
    fila[IDX.agendo] = agendo; fila[IDX.canal] = canal; fila[IDX.anuncio] = canal.startsWith('VSL') ? pick(anuncios, [5, 4, 4, 3, 3, 0, 2]) : canal === 'Instagram' ? 'bio' : ''
    fila[IDX.calif] = calif; fila[IDX.link] = 'https://meet.google.com/ejemplo'
    fila[IDX.facturacion] = pick(['$0 - $750 USD', '$750 - $1.500 USD', '$1.500 - $3.000 USD', '$3.000 - $5.000 USD'], [4, 3, 2, 1])
    fila[IDX.urgencia] = pick(['Lo quiero resolver YA mismo', 'Quiero verlo en 2 - 4 semanas', 'Quiero resolverlo en unos meses', 'Aún no sé cuándo resolverlo'], [4, 5, 2, 1])
    fila[IDX.obstaculo] = pick(['Dependo 100% de referidos', 'No me están entrando suficientes consultas', 'Me escriben, pero no termino cerrando'], [4, 4, 2])
    fila[IDX.objetivo] = pick(['$5.000 - $10.000 USD al mes', '$10.000 - $25.000 USD al mes', '$25.000 - $50.000 USD al mes'], [6, 3, 1])
    fila[IDX.inversion] = pick(['Tengo de USD 0 a USD 750 disponibles', 'Tengo de USD 750 a USD 1500 disponibles', 'Tengo más de USD 3000 disponibles'], [5, 3, 1])
    fila[IDX.contexto] = agendo === 'Maite' ? 'Trabaja de forma independiente, quiere más consultas' : ''
    filas.push(fila)
  }
  return filas
}

// ── Fórmulas de 📊 Métricas ─────────────────────────────────────────────────
// Locale es_AR → separador de argumentos ";". Todas filtran por el mes y el closer elegidos arriba.
const BASE = 'MES;CRIT_MES;CLOSERN;CRIT_CLOSER'
const cuenta = (extra = '') => `COUNTIFS(${BASE}${extra ? ';' + extra : ''})`
const M = {
  agendadas: cuenta(),
  ocurridas: cuenta('FECHA;"<="&AHORA'),
  proximas: cuenta('FECHA;">"&AHORA'),
  calificadas: `(${cuenta('CALIF;"A"')}+${cuenta('CALIF;"B"')}+${cuenta('CALIF;"C"')})`,
  presentadas: cuenta('PRESENTO;"Sí"'),
  noShow: cuenta('PRESENTO;"No"'),
  reagendo: cuenta('PRESENTO;"Reagendó"'),
  cancelo: cuenta('PRESENTO;"Canceló"'),
  faltaCargar: cuenta('FECHA;"<="&AHORA;PRESENTO;""'),
  cierres: cuenta('RESULTADO;"Cerró";COBRADO;">0"'),
  cierresTotal: cuenta('RESULTADO;"Cerró"'),
  cobrado: `SUMIFS(COBRADO;${BASE};RESULTADO;"Cerró")`,
  leads: cuenta('NROLEAD;1'),
  contratado: `SUMIFS(VALOR;${BASE};RESULTADO;"Cerró")`,
}
const div = (a, b) => `=IFERROR((${a})/(${b});"—")`

// Tarjetas: [etiqueta, fórmula, formato, explicación corta]
const TARJETAS = {
  volumen: [
    ['Agendadas', `=${M.agendadas}`, 'n', `="de "&${M.leads}&" leads distintos · "&${M.proximas}&" a futuro"`],
    ['Calificadas', `=${M.calificadas}`, 'n', 'leads A, B o C'],
    ['Presentadas', `=${M.presentadas}`, 'n', 'el lead apareció'],
    ['No se presentaron', `=${M.noShow}`, 'n', 'no-shows'],
    ['Cierres', `=${M.cierres}`, 'n', 'cerró y ya pagó algo'],
    ['⚠️ Falta cargar', `=${M.faltaCargar}`, 'n', 'ya pasaron y nadie cargó'],
  ],
  tasas: [
    ['Calificación', div(M.calificadas, M.agendadas), 'p', 'calificadas ÷ agendadas'],
    ['Show up', div(M.presentadas, M.ocurridas), 'p', 'presentadas ÷ llamadas que ya pasaron'],
    ['Cierre s/ presentadas', div(M.cierres, M.presentadas), 'p', 'cierres ÷ presentadas'],
    ['Cierre s/ agendadas', div(M.cierres, M.ocurridas), 'p', 'cierres ÷ llamadas que ya pasaron'],
    ['Cierre por lead', div(M.cierres, M.leads), 'p', 'cierres ÷ leads distintos (no cuenta reagendas)'],
    ['Reagendó o canceló', div(`${M.reagendo}+${M.cancelo}`, M.ocurridas), 'p', 'sobre las que ya pasaron'],
  ],
  plata: [
    ['Cobrado', `=${M.cobrado}`, 'u', 'cash que entró'],
    ['Valor contratado', `=${M.contratado}`, 'u', 'suma de los programas vendidos'],
    ['Ticket promedio', div(M.cobrado, M.cierres), 'u', 'cobrado ÷ cierres'],
    ['% cobrado', div(M.cobrado, M.contratado), 'p', 'cobrado ÷ contratado'],
    ['Cobrado por presentada', div(M.cobrado, M.presentadas), 'u', 'cuánto rinde cada llamada'],
    ['Cierres de palabra', `=${M.cierresTotal}-${M.cierres}`, 'n', 'dijo que sí y aún no pagó'],
  ],
}

// Tablas: cada fila filtra por un valor de una lista. {usaCloser:false} → ignora el selector de closer (compara a todos).
const tabla = (campo, celda, usaCloser = true) => {
  const base = usaCloser ? `${BASE};${campo};${celda}` : `MES;CRIT_MES;${campo};${celda}`
  const c = (extra = '') => `COUNTIFS(${base}${extra ? ';' + extra : ''})`
  return {
    agendadas: c(), calificadas: `(${c('CALIF;"A"')}+${c('CALIF;"B"')}+${c('CALIF;"C"')})`, presentadas: c('PRESENTO;"Sí"'), noShow: c('PRESENTO;"No"'),
    cierres: c('RESULTADO;"Cerró";COBRADO;">0"'), falta: c('FECHA;"<="&AHORA;PRESENTO;""'), cobrado: `SUMIFS(COBRADO;${base};RESULTADO;"Cerró")`, ocurridas: c('FECHA;"<="&AHORA'),
  }
}

async function main() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(sheetId,title),namedRanges(namedRangeId)' })
  const existentes = meta.data.sheets.map(s => s.properties.sheetId)

  // 1) Estructura: borrar lo viejo, crear pestañas, configuración regional
  const pre = []
  for (const nr of meta.data.namedRanges ?? []) pre.push({ deleteNamedRange: { namedRangeId: nr.namedRangeId } })
  pre.push({ updateSpreadsheetProperties: { properties: { title: 'CRM de Ventas SKWD — PRUEBA', locale: 'es_AR', timeZone: 'America/Argentina/Buenos_Aires' }, fields: 'title,locale,timeZone' } })
  pre.push({ addSheet: { properties: { sheetId: 999, title: '_tmp' } } })
  for (const id of existentes) pre.push({ deleteSheet: { sheetId: id } })
  const nueva = (sheetId, title, index, rows, cols, extra = {}) => ({ addSheet: { properties: { sheetId, title, index, gridProperties: { rowCount: rows, columnCount: cols, ...extra.grid }, tabColorStyle: { rgbColor: extra.color } } } })
  pre.push(nueva(S.manual, T.manual, 0, 60, 8, { grid: { hideGridlines: true }, color: C.azul }))
  pre.push(nueva(S.llamadas, T.llamadas, 1, FILAS + 2, COLS.length, { grid: { frozenRowCount: 2, frozenColumnCount: 1 }, color: C.naranja }))
  pre.push(nueva(S.metricas, T.metricas, 2, 150, 16, { grid: { hideGridlines: true }, color: C.verde }))
  pre.push(nueva(S.listas, T.listas, 3, 70, 10, { color: C.gris }))
  pre.push({ deleteSheet: { sheetId: 999 } })
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: pre } })

  // 2) Rangos con nombre (hacen legibles las fórmulas de Métricas)
  const nombrado = (name, sheetId, r1, c1, r2, c2) => ({ addNamedRange: { namedRange: { name, range: rng(sheetId, r1, c1, r2, c2) } } })
  const colNom = (name, k) => nombrado(name, S.llamadas, F1, IDX[k], FILAS + 2, IDX[k])
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
    colNom('FECHA', 'fechan'), colNom('PRESENTO', 'presento'), colNom('RESULTADO', 'resultado'), colNom('VALOR', 'valor'), colNom('COBRADO', 'cobrado'),
    colNom('AGENDO', 'agendo'), colNom('ANUNCIO', 'anuncio'), colNom('NROLEAD', 'nrolead'), colNom('CANAL', 'canal'), colNom('CALIF', 'calif'), colNom('MES', 'mes'), colNom('CLOSERN', 'closern'),
    nombrado('CRIT_MES', S.metricas, 4, 14, 4, 14), nombrado('CRIT_CLOSER', S.metricas, 5, 14, 5, 14), nombrado('AHORA', S.metricas, 6, 14, 6, 14),
  ] } })

  // 3) Contenido
  const data = [], dataRaw = []
  const put = (tab, a1, values) => data.push({ range: `'${tab}'!${a1}`, values })
  const putRaw = (tab, a1, values) => dataRaw.push({ range: `'${tab}'!${a1}`, values })

  // ⚙️ Listas
  put(T.listas, 'A1', [['Closers', 'Agendó', 'Canal', '¿Se presentó?', 'Resultado', 'Calificación', '', 'Meses (automático)', 'Anuncios (automático)']])
  const maxLista = Math.max(...Object.values(LISTAS).map(l => l.length))
  put(T.listas, 'A2', Array.from({ length: maxLista }, (_, i) => [LISTAS.closers[i] ?? '', LISTAS.agendo[i] ?? '', LISTAS.canal[i] ?? '', LISTAS.presento[i] ?? '', LISTAS.resultado[i] ?? '', LISTAS.calif[i] ?? '']))
  put(T.listas, 'H2', [['Todo'], ['=IFERROR(SORT(UNIQUE(FILTER(MES;MES<>""));1;FALSE);"")']])
  put(T.listas, 'I2', [['=IFERROR(SORT(UNIQUE(FILTER(ANUNCIO;ANUNCIO<>"")));"")']])
  put(T.listas, 'A14', [['Para sumar un closer: escribilo debajo del último nombre de la columna A. Aparece solo en los desplegables y en las métricas.']])
  put(T.listas, 'A15', [['No cambies el texto de "¿Se presentó?" ni de "Resultado": las métricas cuentan esas palabras exactas.']])

  // 📞 Llamadas
  const bandas = new Array(COLS.length).fill('')
  bandas[IDX.lead] = '📅  LA LLAMADA'; bandas[IDX.fecha] = 'llega sola'; bandas[IDX.presento] = '✍️  ESTO LO CARGA EL CLOSER  ·  solo lo naranja'; bandas[IDX.estado] = '🤖  AUTOMÁTICO  ·  llega solo, no tocar'
  bandas[IDX.precall] = '📋  FICHA DEL LEAD  ·  lo que respondió en el formulario'; bandas[IDX.mes] = '🧮 cálculo'
  put(T.llamadas, 'A1', [bandas, COLS.map(c => c.h)])
  const e = colL('presento'), r = colL('resultado'), a = colL('fecha'), cz = colL('closer'), fn = colL('fechan')
  // Fecha de cálculo: si Make la manda como texto ISO ("2026-09-26T18:00:00Z", hora UTC) se convierte a hora de Argentina;
  // si no se puede convertir queda vacía y el Estado lo grita, en vez de contar mal en silencio.
  put(T.llamadas, `${fn}${F1}`, [[`=ARRAYFORMULA(IF(${a}${F1}:${a}="";"";IF(ISNUMBER(${a}${F1}:${a});${a}${F1}:${a};IFERROR(DATEVALUE(LEFT(${a}${F1}:${a};10))+TIMEVALUE(MID(${a}${F1}:${a};12;8))-IF(RIGHT(${a}${F1}:${a};1)="Z";3/24;0);""))))`]])
  put(T.llamadas, `${colL('estado')}${F1}`, [[`=ARRAYFORMULA(IF(${a}${F1}:${a}="";"";IF(${fn}${F1}:${fn}="";"⛔ Fecha mal cargada";IF(${r}${F1}:${r}="Cerró";IF(N(${colL('cobrado')}${F1}:${colL('cobrado')})>0;"✅ Cerrada";"🟡 Cerró, falta cobrar");IF(${e}${F1}:${e}="Sí";"🟢 Presentada";IF(${e}${F1}:${e}="No";"🔴 No se presentó";IF(${e}${F1}:${e}="Reagendó";"🔁 Reagendó";IF(${e}${F1}:${e}="Canceló";"⚪ Canceló";IF(${fn}${F1}:${fn}>AHORA;"🕒 Próxima";"⚠️ Falta cargar")))))))))`]])
  put(T.llamadas, `${colL('mes')}${F1}`, [[`=ARRAYFORMULA(IF(${fn}${F1}:${fn}="";"";TEXT(${fn}${F1}:${fn};"yyyy-mm")&" "&TEXT(${fn}${F1}:${fn};"mmm")))`]])
  // Misma persona = mismo email (o WhatsApp, o nombre). "Llamada nº" 1 = primera vez que agenda; 2, 3… = reagendas o 2ª llamada.
  const ld = colL('lead'), em = colL('email'), wa = colL('whatsapp'), cl = colL('clave'), U = FILAS + 2
  put(T.llamadas, `${cl}${F1}`, [[`=ARRAYFORMULA(IF(${ld}${F1}:${ld}="";"";IF(${em}${F1}:${em}<>"";LOWER(${em}${F1}:${em});IF(${wa}${F1}:${wa}<>"";${wa}${F1}:${wa};LOWER(${ld}${F1}:${ld})))))`]])
  put(T.llamadas, `${colL('nrolead')}${F1}`, [[`=ARRAYFORMULA(IF(${fn}${F1}:${fn}${U}="";"";COUNTIFS(${cl}${F1}:${cl}${U};${cl}${F1}:${cl}${U};${fn}${F1}:${fn}${U};"<="&${fn}${F1}:${fn}${U})))`]])
  put(T.llamadas, `${colL('closern')}${F1}`, [[`=ARRAYFORMULA(IF(${a}${F1}:${a}="";"";IF(${cz}${F1}:${cz}="";"(sin closer)";${cz}${F1}:${cz})))`]])
  if (!SIN_DATOS) {
    const filas = datosDeEjemplo()
    // Las columnas con ARRAYFORMULA (estado, mes, closern) no se escriben: se parte en tramos
    const tramo = (k1, k2) => putRaw(T.llamadas, `${colL(k1)}${F1}`, filas.map(f => f.slice(IDX[k1], IDX[k2] + 1)))
    tramo('lead', 'grabacion'); tramo('whatsapp', 'idcalendly')      // entre medio queda Estado, que es fórmula
  }

  // 📊 Métricas
  put(T.metricas, 'B1', [['📊  Métricas de ventas']])
  put(T.metricas, 'B2', [['Elegí el mes y el closer. Todo lo demás se calcula solo desde la pestaña 📞 Llamadas.']])
  put(T.metricas, 'B4', [['MES', 'Todo', '', '', 'CLOSER', 'Todos']])
  // "?*" y no "*": el asterisco solo también matchea el "" que devuelven las ARRAYFORMULA en las filas vacías (daba 2.000 agendadas)
  put(T.metricas, 'O4', [['=IF(C4="Todo";"?*";C4)'], ['=IF(G4="Todos";"?*";G4)'], ['=NOW()']])     // O6 = AHORA: un solo reloj para todo el archivo
  const FILA = { volumen: 7, tasas: 13, plata: 19 }
  for (const [bloque, fila0] of Object.entries(FILA)) {
    put(T.metricas, `B${fila0}`, [[{ volumen: 'VOLUMEN', tasas: 'TASAS', plata: 'PLATA  (en USD)' }[bloque]]])
    TARJETAS[bloque].forEach(([label, formula, , sub], i) => {
      const col = L(1 + i * 2)
      put(T.metricas, `${col}${fila0 + 1}`, [[label], [formula], [sub]])
    })
  }
  // Tabla por closer (ignora el selector de closer: es la comparación entre todos)
  const N_ANUNCIOS = 15
  const TAB = { closer: 25, canal: 36, calif: 48, agendo: 58, anuncio: 67, motivos: 87, evol: 100, embudo: 117, como: 140 }
  put(T.metricas, `B${TAB.closer}`, [['POR CLOSER  ·  compara a todos en el mes elegido']])
  put(T.metricas, `B${TAB.closer + 1}`, [['Closer', 'Agendadas', 'Presentadas', 'No-shows', 'Show up', 'Cierres', 'Cierre s/ pres.', 'Cobrado', 'Ticket prom.', '⚠️ Falta cargar']])
  for (let i = 0; i < 6; i++) {
    const f = TAB.closer + 2 + i, t = tabla('CLOSERN', `$B${f}`, false), vacio = x => `=IF($B${f}="";"";${x})`
    put(T.metricas, `B${f}`, [[`=IFERROR(INDEX('${T.listas}'!$A$2:$A$12;${i + 1});"")`, vacio(t.agendadas), vacio(t.presentadas), vacio(t.noShow),
      vacio(`IFERROR(${t.presentadas}/${t.ocurridas};"—")`), vacio(t.cierres), vacio(`IFERROR(${t.cierres}/${t.presentadas};"—")`), vacio(t.cobrado), vacio(`IFERROR(${t.cobrado}/${t.cierres};"—")`), vacio(t.falta)]])
  }
  // Control: si Make manda un closer que no está en ⚙️ Listas ("Carlos Roletto"), esa llamada NO desaparece: cae acá y se ve
  { const f = TAB.closer + 8; put(T.metricas, `B${f}`, [['⚠️ Closer sin reconocer', `=COUNTIFS(MES;CRIT_MES)-SUM(C${TAB.closer + 2}:C${TAB.closer + 7})`]]) }
  const tablaSimple = (fila0, titulo, headers, valores, campo, extraCols) => {
    put(T.metricas, `B${fila0}`, [[titulo]]); put(T.metricas, `B${fila0 + 1}`, [headers])
    valores.forEach((v, i) => { const f = fila0 + 2 + i, t = tabla(campo, `$B${f}`); put(T.metricas, `B${f}`, [[v, ...extraCols(t)]]) })
  }
  const colsEmbudo = t => [`=${t.agendadas}`, `=${t.calificadas}`, `=${t.presentadas}`, `=IFERROR(${t.presentadas}/${t.ocurridas};"—")`, `=${t.cierres}`, `=IFERROR(${t.cierres}/${t.presentadas};"—")`, `=${t.cobrado}`]
  const headEmbudo = x => [x, 'Agendadas', 'Calificadas', 'Presentadas', 'Show up', 'Cierres', 'Cierre s/ pres.', 'Cobrado']
  tablaSimple(TAB.canal, 'POR CANAL  ·  de dónde vienen los que compran', headEmbudo('Canal'), LISTAS.canal, 'CANAL', colsEmbudo)
  { const f = TAB.canal + 2 + LISTAS.canal.length; put(T.metricas, `B${f}`, [['⚠️ Canal sin reconocer', `=${M.agendadas}-SUM(C${TAB.canal + 2}:C${f - 1})`]]) }
  tablaSimple(TAB.calif, 'POR CALIFICACIÓN DEL LEAD  ·  ¿los A y B cierran más?', headEmbudo('Calificación'), LISTAS.calif, 'CALIF', colsEmbudo)
  tablaSimple(TAB.agendo, 'POR QUIÉN AGENDÓ  ·  el trabajo del setter', headEmbudo('Agendó'), LISTAS.agendo, 'AGENDO', colsEmbudo)
  put(T.metricas, `B${TAB.anuncio}`, [['POR ANUNCIO  ·  qué creativo trae llamadas y cierres']]); put(T.metricas, `B${TAB.anuncio + 1}`, [headEmbudo('Anuncio')])
  for (let i = 0; i < N_ANUNCIOS; i++) {
    const f = TAB.anuncio + 2 + i, t = tabla('ANUNCIO', `$B${f}`), v = x => `=IF($B${f}="";"";${x})`
    put(T.metricas, `B${f}`, [[`=IFERROR(INDEX('${T.listas}'!$I$2:$I$60;${i + 1});"")`, v(t.agendadas), v(t.calificadas), v(t.presentadas), v(`IFERROR(${t.presentadas}/${t.ocurridas};"—")`), v(t.cierres), v(`IFERROR(${t.cierres}/${t.presentadas};"—")`), v(t.cobrado)]])
  }
  put(T.metricas, `B${TAB.motivos}`, [['POR QUÉ NO CIERRAN  ·  qué pasó con las llamadas presentadas']])
  put(T.metricas, `B${TAB.motivos + 1}`, [['Resultado', 'Cantidad', '% de las presentadas']])
  LISTAS.resultado.forEach((v, i) => { const f = TAB.motivos + 2 + i; put(T.metricas, `B${f}`, [[v, `=${cuenta(`RESULTADO;$B${f}`)}`, `=IFERROR(C${f}/${M.presentadas};"—")`]]) })
  put(T.metricas, `B${TAB.motivos + 2 + LISTAS.resultado.length}`, [['Presentadas sin resultado cargado', `=${cuenta('PRESENTO;"Sí";RESULTADO;""')}`, `=IFERROR(C${TAB.motivos + 2 + LISTAS.resultado.length}/${M.presentadas};"—")`]])
  // Evolución mes a mes (respeta el closer elegido, ignora el mes)
  put(T.metricas, `B${TAB.evol}`, [['EVOLUCIÓN MES A MES  ·  del closer elegido arriba']])
  put(T.metricas, `B${TAB.evol + 1}`, [['Mes', 'Agendadas', 'Presentadas', 'Show up', 'Cierres', 'Cierre s/ pres.', 'Cobrado']])
  put(T.metricas, `B${TAB.evol + 2}`, [[`=IFERROR(SORT(ARRAY_CONSTRAIN(FILTER('${T.listas}'!$H$3:$H$38;'${T.listas}'!$H$3:$H$38<>"");12;1));"")`]])      // los últimos 12 meses
  for (let i = 0; i < 12; i++) {
    const f = TAB.evol + 2 + i, b = `MES;$B${f};CLOSERN;CRIT_CLOSER`, c = x => `COUNTIFS(${b}${x ? ';' + x : ''})`, v = x => `=IF($B${f}="";"";${x})`
    put(T.metricas, `C${f}`, [[v(c()), v(c('PRESENTO;"Sí"')), v(`IFERROR(${c('PRESENTO;"Sí"')}/${c('FECHA;"<="&AHORA')};"—")`), v(c('RESULTADO;"Cerró";COBRADO;">0"')),
      v(`IFERROR(${c('RESULTADO;"Cerró";COBRADO;">0"')}/${c('PRESENTO;"Sí"')};"—")`), v(`SUMIFS(COBRADO;${b};RESULTADO;"Cerró")`)]])
  }
  put(T.metricas, `B${TAB.embudo}`, [['EMBUDO  ·  del período y closer elegidos']])
  put(T.metricas, `B${TAB.embudo + 1}`, [['Etapa', 'Llamadas'], ['Agendadas', `=${M.agendadas}`], ['Calificadas', `=${M.calificadas}`], ['Presentadas', `=${M.presentadas}`], ['Cierres', `=${M.cierres}`]])
  put(T.metricas, `B${TAB.como}`, [['CÓMO SE MIDE CADA COSA']])
  put(T.metricas, `B${TAB.como + 1}`, [
    ['• Cierre = el closer marcó "Cerró" Y hay plata cobrada. Un "sí" sin pago aparece aparte como "Cierre de palabra" hasta que entre el primer pago.'],
    ['• Show up = presentadas ÷ llamadas que ya pasaron (la misma cuenta que el dashboard). Una llamada sin cargar baja el show up: cargar al día también cuida el número del closer.'],
    ['• Leads distintos y "Cierre por lead": si una persona reagenda o tiene 2ª llamada aparece en 2 filas, pero cuenta como 1 lead. Así las reagendas no inflan las agendadas ni hunden la tasa de cierre.'],
    ['• "Falta cargar" = llamadas que ya pasaron y nadie marcó si el lead se presentó. Tiene que estar en 0 todos los días.'],
    ['• Cobrado = la plata de los cierres, anotada en el MES DE LA LLAMADA que la originó (mide al closer). La caja real de cada mes, con cuotas y fechas de pago, sigue siendo Finanzas.'],
    ['• "⚠️ Closer / Canal sin reconocer" tiene que estar en 0: si aparece un número, llegó un nombre que no está escrito igual que en ⚙️ Listas.'],
    ['• El % de agenda del setter (agendas de Maite ÷ chats asignados) lo sigue mostrando el dashboard web, porque necesita los datos de ManyChat.'],
  ])

  // 📖 Cómo usar
  put(T.manual, 'B2', [['Cómo usar este CRM']])
  put(T.manual, 'B3', [['Se aprende en 2 minutos. Tu única tarea: después de cada llamada, completar lo NARANJA de tu fila.']])
  put(T.manual, 'B5', [
    ['1', 'Abrí 📞 Llamadas y buscá tu llamada.', 'En la compu: menú Datos → Vistas de filtro → tu nombre (lo más nuevo queda arriba). En el celular: tocá la lupa 🔍 y escribí el nombre del lead.'],
    ['2', 'Marcá si el lead se presentó.', 'Columna "¿Se presentó?": Sí · No · Reagendó · Canceló. Es un desplegable: no se escribe nada. Si el casillero está rojo, te falta cargarlo.'],
    ['3', 'Si se presentó, elegí el resultado.', 'Columna "Resultado": Cerró, Seguimiento, Quiere pensarlo, Decide con otra persona, Sin dinero, No le interesa, No califica.'],
    ['4', 'Si cerró, cargá la plata.', '"Valor del programa" = precio total que contrató. "Cobrado" = todo lo que pagó hasta hoy (si después entra otra cuota, actualizá el número). Solo números, en dólares. Ej.: 2600'],
    ['5', 'Opcional: próximo contacto, nota y grabación.', 'Si hay que volver a hablarle, poné la fecha. La nota, en una línea. Pegá el link de Fathom.'],
  ])
  put(T.manual, 'B11', [['Eso es todo. Lo gris llega solo y las métricas se calculan solas.']])
  put(T.manual, 'B13', [['Las 5 reglas']])
  put(T.manual, 'B14', [
    ['✅', 'Cargá el mismo día de la llamada.', 'Una llamada sin cargar aparece como "⚠️ Falta cargar" y te baja el show up.'],
    ['✅', 'Tocá solo lo naranja.', 'Lo gris lo completa el sistema. Si algo gris está mal, avisá; no lo corrijas a mano.'],
    ['✅', 'Nunca borres una fila.', 'Si el lead canceló o no apareció, se marca. Borrar arruina las métricas de todos.'],
    ['✅', 'Nunca ordenes la hoja.', 'Ordenar mueve las fórmulas y rompe las métricas de todos. Para ver solo lo tuyo usá las vistas de filtro.'],
    ['✅', 'Una fila = una llamada.', 'Si el lead reagenda por Calendly aparece una fila nueva con la nueva fecha; la vieja queda como "Reagendó". Si cierra días después por WhatsApp, volvé a la fila de la llamada y cambiá el resultado a "Cerró".'],
  ])
  put(T.manual, 'B20', [['¿Qué opción elijo?']])
  put(T.manual, 'B21', [
    ['Sí', 'El lead entró a la llamada.', ''],
    ['No', 'No apareció y no avisó antes de la hora (no-show).', ''],
    ['Reagendó', 'Avisó ANTES de la hora y pidió otro día. Si lo arreglaron por WhatsApp, poné la nueva fecha en "Próximo contacto".', ''],
    ['Canceló', 'Avisó antes de la hora que no la va a tener, y no la pasó para otro día.', ''],
    ['Cerró', 'Dijo que sí y compra. Cargá "Valor del programa" y "Cobrado".', ''],
    ['Seguimiento', 'Hay interés y quedó una FECHA concreta para volver a hablar (ponela en "Próximo contacto").', ''],
    ['Quiere pensarlo', 'Dijo que lo piensa y no quedó ninguna fecha.', ''],
    ['Decide con otra persona', 'Tiene que consultarlo con su socio, su pareja, etc.', ''],
    ['Sin dinero', 'Quiere, pero hoy no tiene cómo pagarlo.', ''],
    ['No le interesa', 'No quiere el programa.', ''],
    ['No califica', 'No es el tipo de cliente que buscamos.', ''],
  ])
  put(T.manual, 'B33', [['Para Tomás y Gero']])
  put(T.manual, 'B34', [
    ['📊', 'Las métricas están en 📊 Métricas.', 'Arriba elegís mes y closer. Al final de esa pestaña está explicado, en una línea cada una, cómo se mide cada cosa.'],
    ['⚙️', 'Para sumar un closer, un canal o un setter:', 'Pestaña ⚙️ Listas → escribilo debajo del último. Aparece solo en los desplegables y en las métricas.'],
    ['🔌', 'Para conectarlo a Make (todavía NO está conectado):', 'Una sola ruta "Agregar fila" a 📞 Llamadas. Fecha en formato DD/MM/AAAA HH:mm, hora de Argentina. Teléfono con un apóstrofo adelante (\'+54…) para que no dé error. Closer, Canal y Agendó con el texto EXACTO de ⚙️ Listas. No escribir nada en "Estado" ni en las columnas de cálculo.'],
    ['💵', '"Cobrado" mide al closer, no a la caja.', 'La plata se anota en el mes de la LLAMADA que la originó. La caja real de cada mes (cuotas, fechas de pago) sigue siendo Finanzas.'],
    ['🧪', 'Esto es una PRUEBA con datos inventados.', 'Todos los leads dicen "(ejemplo)". Para empezar en serio se borran las filas de ejemplo y se conecta Make a esta hoja.'],
  ])

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } })
  // RAW: un WhatsApp "+54 9 11…" escrito como USER_ENTERED se toma por fórmula y da #ERROR!
  if (dataRaw.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: dataRaw } })

  // 4) Formato
  const q = []
  const LL = S.llamadas, ME = S.metricas, MA = S.manual, LI = S.listas
  const ultima = FILAS + 2
  // Llamadas: anchos, bandas y encabezados por bloque
  COLS.forEach((c, i) => q.push(ancho(LL, i, i, c.w)))
  q.push(alto(LL, 1, 1, 30), alto(LL, 2, 2, 44))
  const bloques = [
    { d: 'lead', h: 'lead', fondo: C.navy, color: C.blanco },     // la columna congelada no se puede combinar con el resto
    { d: 'fecha', h: 'closer', fondo: C.navy, color: C.blanco },
    { d: 'presento', h: 'grabacion', fondo: C.naranja, color: C.navy },
    { d: 'estado', h: 'link', fondo: C.tinta, color: C.blanco },
    { d: 'precall', h: 'idcalendly', fondo: C.gris, color: C.blanco },
    { d: 'mes', h: 'nrolead', fondo: C.grisClaro, color: C.gris },
  ]
  for (const b of bloques) {
    if (b.d !== b.h) q.push(merge(LL, 1, IDX[b.d], 1, IDX[b.h]))
    q.push(fmt(LL, 1, IDX[b.d], 1, IDX[b.h], { backgroundColor: b.fondo, textFormat: txt({ font: 'Poppins', size: 10, bold: true, color: b.color }), horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', padding: { left: 10 } }))
    q.push(fmt(LL, 2, IDX[b.d], 2, IDX[b.h], { backgroundColor: b.fondo, textFormat: txt({ size: 10, bold: true, color: b.color }), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }))
  }
  // Cuerpo: gris muy claro lo automático, naranja claro lo del closer
  q.push(fmt(LL, F1, 0, ultima, COLS.length - 1, { backgroundColor: C.casiBlanco, textFormat: txt({ color: C.gris }), verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' }))
  q.push(fmt(LL, F1, IDX.lead, ultima, IDX.lead, { backgroundColor: C.casiBlanco, textFormat: txt({ bold: true, color: C.tinta }), verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' }))
  q.push(fmt(LL, F1, IDX.presento, ultima, IDX.grabacion, { backgroundColor: C.naranjaClaro, textFormat: txt({ color: C.tinta }), verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' }))
  q.push(fmt(LL, F1, IDX.estado, ultima, IDX.estado, { backgroundColor: C.blanco, textFormat: txt({ bold: true, color: C.tinta }), verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT' }))
  q.push(fmt(LL, F1, IDX.fecha, ultima, IDX.fecha, { numberFormat: { type: 'DATE_TIME', pattern: 'ddd dd/mm  hh:mm' }, horizontalAlignment: 'LEFT' }))
  q.push(fmt(LL, F1, IDX.proximo, ultima, IDX.proximo, { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' }, horizontalAlignment: 'CENTER' }))
  q.push(fmt(LL, F1, IDX.valor, ultima, IDX.cobrado, { numberFormat: { type: 'NUMBER', pattern: '"USD "#,##0' }, horizontalAlignment: 'RIGHT' }))
  q.push(fmt(LL, F1, IDX.whatsapp, ultima, IDX.whatsapp, { numberFormat: { type: 'TEXT', pattern: '@' } }))   // "+54…" tiene que quedar texto, no fórmula
  q.push(fmt(LL, F1, IDX.closer, ultima, IDX.closer, { horizontalAlignment: 'CENTER' }), fmt(LL, F1, IDX.calif, ultima, IDX.calif, { horizontalAlignment: 'CENTER' }))
  q.push({ updateBorders: { range: rng(LL, F1, 0, ultima, COLS.length - 1), innerHorizontal: { style: 'SOLID', color: C.grisClaro } } })
  q.push({ updateBorders: { range: rng(LL, 1, IDX.presento, ultima, IDX.grabacion), left: { style: 'SOLID_MEDIUM', color: C.naranja }, right: { style: 'SOLID_MEDIUM', color: C.naranja } } })
  // Desplegables y validaciones
  const lst = (col, n) => `'${T.listas}'!$${col}$2:$${col}$${n}`
  q.push(lista(LL, F1, IDX.closer, ultima, IDX.closer, lst('A', 12)), lista(LL, F1, IDX.presento, ultima, IDX.presento, lst('D', 12), 'Elegí una opción'),
    lista(LL, F1, IDX.resultado, ultima, IDX.resultado, lst('E', 12), 'Solo si el lead se presentó'), lista(LL, F1, IDX.agendo, ultima, IDX.agendo, lst('B', 12)),
    lista(LL, F1, IDX.canal, ultima, IDX.canal, lst('C', 12)), lista(LL, F1, IDX.calif, ultima, IDX.calif, lst('F', 12)))
  q.push({ setDataValidation: { range: rng(LL, F1, IDX.valor, ultima, IDX.cobrado), rule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0' }] }, strict: true, inputMessage: 'Solo el número, en dólares. Ej.: 2600' } } })
  q.push({ setDataValidation: { range: rng(LL, F1, IDX.proximo, ultima, IDX.proximo), rule: { condition: { type: 'DATE_IS_VALID' }, strict: true, inputMessage: 'Una fecha. Ej.: 25/09/2026' } } })
  // Colores automáticos
  const regla = (rango, cond, formato, i) => ({ addConditionalFormatRule: { index: i, rule: { ranges: [rango], booleanRule: { condition: cond, format: formato } } } })
  const contiene = s => ({ type: 'TEXT_CONTAINS', values: [{ userEnteredValue: s }] })
  const formula = f => ({ type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] })
  const rEstado = rng(LL, F1, IDX.estado, ultima, IDX.estado)
  const colE = colL('estado'), colP = colL('presento'), colR = colL('resultado'), colV = colL('valor'), colC = colL('cobrado')
  let n = 0
  q.push(regla(rEstado, contiene('Fecha mal cargada'), { backgroundColor: C.rojo, textFormat: { foregroundColor: C.blanco, bold: true } }, n++))
  q.push(regla(rEstado, contiene('Falta cargar'), { backgroundColor: C.rojoClaro, textFormat: { foregroundColor: C.rojo, bold: true } }, n++))
  q.push(regla(rEstado, contiene('falta cobrar'), { backgroundColor: C.amarilloClaro, textFormat: { foregroundColor: C.naranjaOsc, bold: true } }, n++))
  q.push(regla(rEstado, contiene('Cerrada'), { backgroundColor: C.verdeClaro, textFormat: { foregroundColor: C.verde, bold: true } }, n++))
  q.push(regla(rEstado, contiene('Presentada'), { backgroundColor: C.azulClaro }, n++))
  q.push(regla(rEstado, contiene('No se presentó'), { backgroundColor: C.amarilloClaro }, n++))
  q.push(regla(rEstado, contiene('Próxima'), { backgroundColor: C.violetaClaro }, n++))
  // Casilleros naranjas que FALTAN: se pintan fuerte hasta que se completan
  q.push(regla(rng(LL, F1, IDX.presento, ultima, IDX.presento), formula(`=$${colE}${F1}="⚠️ Falta cargar"`), { backgroundColor: C.rojoClaro }, n++))
  q.push(regla(rng(LL, F1, IDX.resultado, ultima, IDX.resultado), formula(`=AND($${colP}${F1}="Sí";$${colR}${F1}="")`), { backgroundColor: C.rojoClaro }, n++))
  q.push(regla(rng(LL, F1, IDX.valor, ultima, IDX.valor), formula(`=AND($${colR}${F1}="Cerró";$${colV}${F1}="")`), { backgroundColor: C.rojoClaro }, n++))
  q.push(regla(rng(LL, F1, IDX.cobrado, ultima, IDX.cobrado), formula(`=AND($${colR}${F1}="Cerró";$${colC}${F1}="")`), { backgroundColor: C.rojoClaro }, n++))
  q.push(regla(rng(LL, F1, IDX.resultado, ultima, IDX.resultado), formula(`=AND(N(${colC}${F1})>0;${colR}${F1}<>"Cerró")`), { backgroundColor: C.rojoClaro }, n++))
  // Vistas por closer (cada uno ve lo suyo sin molestar al resto)
  const rTabla = rng(LL, 2, 0, ultima, COLS.length - 1)
  // SIN filtro básico: es compartido (le cambia la vista a todos) y "Ordenar hoja" mueve las ARRAYFORMULA de la fila 3. Solo vistas de filtro.
  const vista = (title, specs) => ({ addFilterView: { filter: { title, range: rTabla, sortSpecs: [{ dimensionIndex: IDX.fecha, sortOrder: 'DESCENDING' }], filterSpecs: specs } } })
  for (const c of LISTAS.closers) q.push(vista(`👤 ${c}`, [{ columnIndex: IDX.closer, filterCriteria: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: c }] } } }]))
  q.push(vista('⚠️ Falta cargar', [{ columnIndex: IDX.estado, filterCriteria: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Falta cargar' }] } } }]))
  q.push(vista('📞 Seguimientos pendientes', [{ columnIndex: IDX.proximo, filterCriteria: { condition: { type: 'NOT_BLANK' } } }]))
  // Ficha del lead plegada y cálculo oculto
  q.push({ addDimensionGroup: { range: { sheetId: LL, dimension: 'COLUMNS', startIndex: IDX.precall, endIndex: IDX.idcalendly + 1 } } })
  q.push({ updateDimensionGroup: { dimensionGroup: { range: { sheetId: LL, dimension: 'COLUMNS', startIndex: IDX.precall, endIndex: IDX.idcalendly + 1 }, depth: 1, collapsed: true }, fields: 'collapsed' } })
  q.push({ updateDimensionProperties: { range: { sheetId: LL, dimension: 'COLUMNS', startIndex: IDX.mes, endIndex: IDX.nrolead + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } })
  // Aviso al editar lo automático (no bloquea a Make)
  const aviso = (range, description) => ({ addProtectedRange: { protectedRange: { range, description, warningOnly: true } } })
  q.push(aviso(rng(LL, 1, IDX.lead, ultima, IDX.closer), 'Esto llega solo. Tocá solo lo naranja.'), aviso(rng(LL, 1, IDX.estado, ultima, IDX.nrolead), 'Esto llega solo. Tocá solo lo naranja.'))

  // Métricas
  q.push(ancho(ME, 0, 0, 24), ancho(ME, 1, 1, 210), ancho(ME, 2, 12, 118), ancho(ME, 13, 13, 24), { updateDimensionProperties: { range: { sheetId: ME, dimension: 'COLUMNS', startIndex: 14, endIndex: 16 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } })
  q.push(fmt(ME, 1, 0, 150, 15, { backgroundColor: C.fondo, textFormat: txt(), verticalAlignment: 'MIDDLE' }))
  q.push(merge(ME, 1, 1, 1, 12), fmt(ME, 1, 1, 1, 12, { backgroundColor: C.fondo, textFormat: txt({ font: 'Poppins', size: 22, bold: true, color: C.navy }) }), alto(ME, 1, 1, 48))
  q.push(merge(ME, 2, 1, 2, 12), fmt(ME, 2, 1, 2, 12, { backgroundColor: C.fondo, textFormat: txt({ size: 11, color: C.gris }) }))
  // Selectores
  q.push(alto(ME, 4, 4, 40), merge(ME, 4, 2, 4, 3), merge(ME, 4, 6, 4, 7))
  q.push(fmt(ME, 4, 1, 4, 1, { backgroundColor: C.fondo, textFormat: txt({ font: 'Poppins', size: 10, bold: true, color: C.gris }), horizontalAlignment: 'RIGHT' }), fmt(ME, 4, 5, 4, 5, { backgroundColor: C.fondo, textFormat: txt({ font: 'Poppins', size: 10, bold: true, color: C.gris }), horizontalAlignment: 'RIGHT' }))
  for (const [c1, c2] of [[2, 3], [6, 7]]) q.push(fmt(ME, 4, c1, 4, c2, { backgroundColor: C.naranjaClaro, textFormat: txt({ font: 'Poppins', size: 13, bold: true, color: C.navy }), horizontalAlignment: 'CENTER' }), borde(ME, 4, c1, 4, c2, C.naranja))
  q.push(fmt(ME, 4, 2, 4, 7, { numberFormat: { type: 'TEXT', pattern: '@' } }))
  q.push(lista(ME, 4, 2, 4, 3, `'${T.listas}'!$H$2:$H$38`, 'Elegí un mes o "Todo"'))
  q.push({ setDataValidation: { range: rng(ME, 4, 6, 4, 7), rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Todos' }, ...LISTAS.closers.map(c => ({ userEnteredValue: c }))] }, strict: true, showCustomUi: true } } })
  // Tarjetas
  const seccion = f => fmt(ME, f, 1, f, 12, { backgroundColor: C.fondo, textFormat: txt({ font: 'Poppins', size: 11, bold: true, color: C.azul }) })
  for (const [bloque, fila0] of Object.entries(FILA)) {
    q.push(merge(ME, fila0, 1, fila0, 12), seccion(fila0), alto(ME, fila0 + 1, fila0 + 1, 26), alto(ME, fila0 + 2, fila0 + 2, 46), alto(ME, fila0 + 3, fila0 + 3, 24), alto(ME, fila0 + 4, fila0 + 4, 14))
    TARJETAS[bloque].forEach(([label, , tipo], i) => {
      const c1 = 1 + i * 2, c2 = c1 + 1, alerta = label.includes('Falta cargar') || label.includes('de palabra')
      for (let k = 1; k <= 3; k++) q.push(merge(ME, fila0 + k, c1, fila0 + k, c2))
      q.push(fmt(ME, fila0 + 1, c1, fila0 + 1, c2, { backgroundColor: C.blanco, textFormat: txt({ size: 10, bold: true, color: alerta ? C.rojo : C.gris }), horizontalAlignment: 'CENTER', verticalAlignment: 'BOTTOM' }))
      q.push(fmt(ME, fila0 + 2, c1, fila0 + 2, c2, { backgroundColor: C.blanco, textFormat: txt({ font: 'Poppins', size: 24, bold: true, color: bloque === 'plata' ? C.verde : C.navy }), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        numberFormat: tipo === 'p' ? { type: 'PERCENT', pattern: '0%' } : tipo === 'u' ? { type: 'NUMBER', pattern: '"USD "#,##0' } : { type: 'NUMBER', pattern: '#,##0' } }))
      q.push(fmt(ME, fila0 + 3, c1, fila0 + 3, c2, { backgroundColor: C.blanco, textFormat: txt({ size: 8, color: C.gris }), horizontalAlignment: 'CENTER', verticalAlignment: 'TOP', wrapStrategy: 'WRAP' }))
      q.push(borde(ME, fila0 + 1, c1, fila0 + 3, c2), { updateBorders: { range: rng(ME, fila0 + 1, c1, fila0 + 3, c2), innerHorizontal: { style: 'NONE' }, innerVertical: { style: 'NONE' }, top: { style: 'SOLID_THICK', color: alerta ? C.rojo : bloque === 'plata' ? C.verde : bloque === 'tasas' ? C.naranja : C.azul } } })
    })
  }
  // Tablas
  const estiloTabla = (fila0, nFilas, nCols, pct, usd) => {
    q.push(merge(ME, fila0, 1, fila0, 12), seccion(fila0))
    q.push(fmt(ME, fila0 + 1, 1, fila0 + 1, nCols, { backgroundColor: C.navy, textFormat: txt({ size: 10, bold: true, color: C.blanco }), horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }), alto(ME, fila0 + 1, fila0 + 1, 34))
    q.push(fmt(ME, fila0 + 2, 1, fila0 + 1 + nFilas, nCols, { backgroundColor: C.blanco, textFormat: txt({ size: 10 }), horizontalAlignment: 'CENTER', numberFormat: { type: 'NUMBER', pattern: '#,##0' } }))
    q.push(fmt(ME, fila0 + 2, 1, fila0 + 1 + nFilas, 1, { backgroundColor: C.blanco, textFormat: txt({ size: 10, bold: true }), horizontalAlignment: 'LEFT', padding: { left: 10 } }))
    for (const c of pct) q.push(fmt(ME, fila0 + 2, c, fila0 + 1 + nFilas, c, { numberFormat: { type: 'PERCENT', pattern: '0%' }, textFormat: txt({ size: 10, bold: true, color: C.naranjaOsc }) }))
    for (const c of usd) q.push(fmt(ME, fila0 + 2, c, fila0 + 1 + nFilas, c, { numberFormat: { type: 'NUMBER', pattern: '"USD "#,##0' }, textFormat: txt({ size: 10, bold: true, color: C.verde }) }))
    q.push(borde(ME, fila0 + 1, 1, fila0 + 1 + nFilas, nCols), { updateBorders: { range: rng(ME, fila0 + 2, 1, fila0 + 1 + nFilas, nCols), innerHorizontal: { style: 'SOLID', color: C.grisClaro } } })
  }
  estiloTabla(TAB.closer, 7, 10, [5, 7], [8, 9])
  q.push(fmt(ME, TAB.closer + 8, 1, TAB.closer + 8, 10, { textFormat: txt({ size: 9, italic: true, color: C.gris }) }), fmt(ME, TAB.canal + 2 + LISTAS.canal.length, 1, TAB.canal + 2 + LISTAS.canal.length, 8, { textFormat: txt({ size: 9, italic: true, color: C.gris }) }))
  for (const [f, c] of [[TAB.closer + 8, 2], [TAB.canal + 2 + LISTAS.canal.length, 2]]) q.push(regla(rng(ME, f, c, f, c), { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] }, { backgroundColor: C.rojoClaro, textFormat: { foregroundColor: C.rojo, bold: true } }, 0))
  q.push(regla(rng(ME, TAB.closer + 2, 10, TAB.closer + 7, 10), { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] }, { backgroundColor: C.rojoClaro, textFormat: { foregroundColor: C.rojo, bold: true } }, 0))
  estiloTabla(TAB.canal, LISTAS.canal.length + 1, 8, [5, 7], [8]); estiloTabla(TAB.anuncio, N_ANUNCIOS, 8, [5, 7], [8]); estiloTabla(TAB.calif, LISTAS.calif.length, 8, [5, 7], [8]); estiloTabla(TAB.agendo, LISTAS.agendo.length, 8, [5, 7], [8])
  estiloTabla(TAB.motivos, LISTAS.resultado.length + 1, 3, [3], []); estiloTabla(TAB.evol, 12, 7, [4, 6], [7]); estiloTabla(TAB.embudo, 4, 2, [], [])
  q.push(merge(ME, TAB.como, 1, TAB.como, 12), seccion(TAB.como))
  for (let f = TAB.como + 1; f <= TAB.como + 7; f++) q.push(merge(ME, f, 1, f, 12), fmt(ME, f, 1, f, 12, { backgroundColor: C.blanco, textFormat: txt({ size: 10, color: C.tinta }), wrapStrategy: 'WRAP', padding: { left: 12, top: 6, bottom: 6 } }), alto(ME, f, f, 40))
  q.push(borde(ME, TAB.como + 1, 1, TAB.como + 7, 12))
  // Gráficos
  const src = (r1, c1, r2, c2) => ({ sources: [rng(ME, r1, c1, r2, c2)] })
  const grafico = (title, chartType, fila, col, dominio, series, w, h) => ({ addChart: { chart: {
    spec: { title, titleTextFormat: { fontFamily: 'Poppins', bold: true, fontSize: 12, foregroundColor: C.navy }, fontName: 'Roboto', backgroundColor: C.blanco,
      basicChart: { chartType, legendPosition: series.length > 1 ? 'BOTTOM_LEGEND' : 'NO_LEGEND', headerCount: 1, domains: [{ domain: { sourceRange: dominio } }],
        series: series.map(s => ({ series: { sourceRange: s.r }, targetAxis: chartType === 'BAR' ? 'BOTTOM_AXIS' : 'LEFT_AXIS', color: s.color, dataLabel: { type: 'DATA', textFormat: { bold: true, fontSize: 10 } } })) } },
    position: { overlayPosition: { anchorCell: { sheetId: ME, rowIndex: fila - 1, columnIndex: col }, widthPixels: w, heightPixels: h } } } } })
  q.push(grafico('Embudo de ventas', 'BAR', TAB.embudo + 1, 4, src(TAB.embudo + 1, 1, TAB.embudo + 5, 1), [{ r: src(TAB.embudo + 1, 2, TAB.embudo + 5, 2), color: C.azul }], 560, 300))
  q.push(grafico('Cobrado por mes (USD)', 'COLUMN', TAB.embudo + 1, 9, src(TAB.evol + 1, 1, TAB.evol + 13, 1), [{ r: src(TAB.evol + 1, 7, TAB.evol + 13, 7), color: C.verde }], 470, 300))
  for (let f = TAB.embudo + 7; f <= TAB.embudo + 22; f++) q.push(alto(ME, f, f, 21))
  q.push({ addProtectedRange: { protectedRange: { range: { sheetId: ME }, description: 'Las métricas se calculan solas. Solo se cambian el mes y el closer de arriba.', warningOnly: true, unprotectedRanges: [rng(ME, 4, 2, 4, 3), rng(ME, 4, 6, 4, 7)] } } })

  // Manual
  q.push(ancho(MA, 0, 0, 30), ancho(MA, 1, 1, 70), ancho(MA, 2, 2, 400), ancho(MA, 3, 3, 640), ancho(MA, 4, 7, 30))
  q.push(fmt(MA, 1, 0, 60, 7, { backgroundColor: C.fondo, textFormat: txt(), verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' }))
  q.push(merge(MA, 2, 1, 2, 3), fmt(MA, 2, 1, 2, 3, { backgroundColor: C.fondo, textFormat: txt({ font: 'Poppins', size: 26, bold: true, color: C.navy }) }), alto(MA, 2, 2, 56))
  q.push(merge(MA, 3, 1, 3, 3), fmt(MA, 3, 1, 3, 3, { backgroundColor: C.naranjaClaro, textFormat: txt({ size: 13, bold: true, color: C.naranjaOsc }), padding: { left: 14 } }), alto(MA, 3, 3, 44), borde(MA, 3, 1, 3, 3, C.naranja))
  const bloqueManual = (f1, f2, colorNum, altoFila) => {
    q.push(fmt(MA, f1, 1, f2, 1, { backgroundColor: colorNum, textFormat: txt({ font: 'Poppins', size: 18, bold: true, color: C.blanco }), horizontalAlignment: 'CENTER' }))
    q.push(fmt(MA, f1, 2, f2, 2, { backgroundColor: C.blanco, textFormat: txt({ size: 13, bold: true, color: C.navy }), wrapStrategy: 'WRAP', padding: { left: 14 } }))
    q.push(fmt(MA, f1, 3, f2, 3, { backgroundColor: C.blanco, textFormat: txt({ size: 11, color: C.gris }), wrapStrategy: 'WRAP', padding: { left: 14 } }))
    q.push(alto(MA, f1, f2, altoFila), borde(MA, f1, 1, f2, 3), { updateBorders: { range: rng(MA, f1, 1, f2, 3), innerHorizontal: { style: 'SOLID', color: C.grisClaro } } })
  }
  bloqueManual(5, 9, C.naranja, 62)
  q.push(merge(MA, 11, 1, 11, 3), fmt(MA, 11, 1, 11, 3, { backgroundColor: C.verdeClaro, textFormat: txt({ size: 13, bold: true, color: C.verde }), horizontalAlignment: 'CENTER' }), alto(MA, 11, 11, 44))
  for (const f of [13, 20, 33]) q.push(merge(MA, f, 1, f, 3), fmt(MA, f, 1, f, 3, { backgroundColor: C.fondo, textFormat: txt({ font: 'Poppins', size: 15, bold: true, color: C.navy }) }), alto(MA, f, f, 40))
  bloqueManual(14, 18, C.verde, 52)
  q.push(fmt(MA, 21, 1, 31, 1, { backgroundColor: C.navy, textFormat: txt({ size: 10, bold: true, color: C.blanco }), horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }))
  q.push(fmt(MA, 21, 2, 31, 3, { backgroundColor: C.blanco, textFormat: txt({ size: 11, color: C.tinta }), wrapStrategy: 'WRAP', padding: { left: 14 } }), alto(MA, 21, 31, 36), borde(MA, 21, 1, 31, 3), { updateBorders: { range: rng(MA, 21, 1, 31, 3), innerHorizontal: { style: 'SOLID', color: C.grisClaro } } })
  for (let f = 21; f <= 31; f++) q.push(merge(MA, f, 2, f, 3))
  q.push(ancho(MA, 1, 1, 150))
  bloqueManual(34, 38, C.azul, 62)

  // Listas
  q.push(ancho(LI, 0, 5, 190), ancho(LI, 6, 6, 30), ancho(LI, 7, 7, 160), ancho(LI, 8, 8, 260))
  q.push(fmt(LI, 1, 0, 1, 8, { backgroundColor: C.navy, textFormat: txt({ size: 10, bold: true, color: C.blanco }), horizontalAlignment: 'CENTER' }), alto(LI, 1, 1, 32))
  q.push(fmt(LI, 2, 0, 12, 5, { backgroundColor: C.naranjaClaro, textFormat: txt({ size: 10 }) }), fmt(LI, 2, 7, 60, 8, { backgroundColor: C.casiBlanco, textFormat: txt({ size: 10, color: C.gris }) }))
  q.push(merge(LI, 14, 0, 14, 7), merge(LI, 15, 0, 15, 7), fmt(LI, 14, 0, 15, 7, { textFormat: txt({ size: 10, italic: true, color: C.gris }), wrapStrategy: 'WRAP' }))

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: q } })
  fs.writeFileSync(path.join(__dirname, 'crm-prueba-layout.json'), JSON.stringify({ IDX, TAB, FILA, F1, FILAS, N_ANUNCIOS, canales: LISTAS.canal.length, resultados: LISTAS.resultado.length }, null, 1))
  console.log(`OK · ${q.length} operaciones de formato · https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`)
}

main().catch(e => { console.error('ERROR:', e.errors?.[0]?.message ?? e.message); process.exit(1) })
