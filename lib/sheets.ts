import { google } from 'googleapis'

// /api/metrics — SOLO la hoja "Cuotas a Cobrar" (Ventas) y el cash del mes en curso (Estado de Resultados).
// Ya no lee la hoja NFCF (obsoleta, clavada en ABRIL) ni "Dashboard Ventas": las métricas del mes salen
// de /api/raw (lib/rawSheets.ts). Son 2 lecturas de Sheets por carga en frío (caché 60 s).

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Faltan credenciales de Google')
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
}

function parse(raw: string | undefined | null): number | null {
  if (!raw || raw === '#DIV/0!' || raw === '#REF!' || raw === '#N/A') return null
  let s = raw.replace(/[$%\s]/g, '')
  // Detectar formato europeo: termina en ,XX (ej: "29.941,02")
  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// Mes actual (1-12) en HORA ARGENTINA: el server de Vercel corre en UTC y entre las 21:00 y las 23:59 AR
// del último día del mes ya estaría en el mes siguiente (Cash In del mes en $0 durante 3 horas).
function mesActualArgentina(): number {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })).getMonth() + 1
}

// Último valor bueno por lote (spreadsheet + rangos): ante un 429 u otro error, después de
// 1 reintento corto se devuelve lo último que se leyó bien en vez de todo null (cuota: 60 lecturas/min).
const ultimoBueno = new Map<string, (string | null)[]>()

async function batchGet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  ranges: string[]
): Promise<(string | null)[]> {
  const clave = `${spreadsheetId}|${ranges.join(',')}`
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
      const valores = ranges.map((_, i) => (res.data.valueRanges?.[i]?.values?.[0]?.[0] as string | undefined) ?? null)
      ultimoBueno.set(clave, valores)
      return valores
    } catch (e) {
      if (intento === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
      const previo = ultimoBueno.get(clave)
      console.error(`Sheets (metrics): falló batchGet de ${ranges.length} rangos (${(e as Error).message?.slice(0, 120)}) → ${previo ? 'uso el último valor bueno' : 'sin valor previo'}`)
      return previo ?? ranges.map(() => null)
    }
  }
  return ultimoBueno.get(clave) ?? ranges.map(() => null)
}

// Tipo de tarjeta genérica (lo sigue importando components/MetricCard.tsx)
export interface Metric {
  label: string
  value: number | null
  format: 'currency' | 'number' | 'percent'
  category: 'finance' | 'sales' | 'agenda'
}

export interface DashboardData {
  monthlyRevenue: number | null   // Cash Collected del mes en curso (ER fila 4, mes en hora AR)
  cuotasPendiente: number | null  // 'Cuotas a Cobrar'!J4 = Σ col E "Monto por Cobrar" (lo PENDIENTE)
  cuotasCobradas: number | null   // 'Cuotas a Cobrar'!M4 = Σ col F "Monto Cobrado"
  cuotasNoPaga: number | null     // 'Cuotas a Cobrar'!J17 = pendiente de filas "No Paga" (null si no es numérica)
  cuotasTotal: number | null      // J4 + M4 (compatibilidad: antes este campo era solo J4, que es lo pendiente)
  lastUpdated: string
}

// Caché del resultado completo (60 s) + deduplicación de requests concurrentes (misma promesa en vuelo)
let cache: { at: number; data: DashboardData } | null = null
let enVuelo: Promise<DashboardData> | null = null

export async function fetchDashboardData(): Promise<DashboardData> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data
  if (enVuelo) return enVuelo
  enVuelo = construirDashboardData()
    .then(data => { cache = { at: Date.now(), data }; return data })
    .finally(() => { enVuelo = null })
  return enVuelo
}

async function construirDashboardData(): Promise<DashboardData> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const VENTAS   = process.env.SHEET_ID_VENTAS    ?? ''
  const FINANZAS = process.env.SHEET_ID_FINANZAS  ?? ''

  // Estado de Resultados: Ene=B4, Feb=D4, Mar=F4... col = chr(64 + 2*month)
  const colER = (m: number) => String.fromCharCode(64 + 2 * m)
  const mes = mesActualArgentina()

  const [cuotas, cashMes] = await Promise.all([
    batchGet(sheets, VENTAS, [
      'Cuotas a Cobrar!J4',    // Σ col E "Monto por Cobrar" → PENDIENTE
      'Cuotas a Cobrar!M4',    // Σ col F "Monto Cobrado"
      'Cuotas a Cobrar!J17',   // "No Paga" (pendiente que no se va a cobrar)
    ]),
    batchGet(sheets, FINANZAS, [`Estado de Resultados!${colER(mes)}4`]),
  ])

  const cuotasPendiente = parse(cuotas[0])
  const cuotasCobradas = parse(cuotas[1])
  const cuotasNoPaga = parse(cuotas[2])

  return {
    monthlyRevenue: parse(cashMes[0]),
    cuotasPendiente,
    cuotasCobradas,
    cuotasNoPaga,
    cuotasTotal: cuotasPendiente != null || cuotasCobradas != null ? (cuotasPendiente ?? 0) + (cuotasCobradas ?? 0) : null,
    lastUpdated: new Date().toISOString(),
  }
}
