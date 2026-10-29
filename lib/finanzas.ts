// ── Dashboard de Finanzas: lectura de datos (Sheets + Meta + dólar MEP) ────────────────────
// SOLO lo usan /api/finanzas (protegido con contraseña) y /api/finanzas-cierre (CRON_SECRET). No se expone nada de esto en /api/raw.
// El cálculo está en lib/finanzasCalc.ts (puro, testeable sin red).
//
// Cuota de Sheets (60 lecturas/min compartida con el dashboard): 1 values.batchGet por carga en frío,
// caché de 60 s + deduplicación de requests concurrentes + último valor bueno ante un error (igual
// criterio que lib/rawSheets.ts, pero con su propio caché para no tocar ese módulo).
import { google } from 'googleapis'
import { calcularFinanzas, type Fila } from './finanzasCalc'
import { leerComprobantes } from './finanzasCuentas'

const ANIO_PLANILLAS = 2026   // Payroll y Estado de Resultados del sheet de Finanzas son de 2026

const RANGOS = {
  registro: "'Registro de Pagos'!A1:AF",   // hasta AF: si algún día se agrega "Cuenta que recibió", se busca por encabezado
  gastos: 'Gastos!A1:L',
  er: "'Estado de Resultados'!A1:X50",
  payroll: 'Payroll!A1:Z400',
}
type ClaveRango = keyof typeof RANGOS

// escritura=true solo para la automatización de fin de mes (/api/finanzas-cierre), que carga filas en Gastos
function getAuth(escritura = false) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Faltan credenciales de Google')
  const scope = escritura ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'
  return new google.auth.JWT({ email, key, scopes: [scope] })
}

const esperar = (ms: number) => new Promise(res => setTimeout(res, ms))

// ── Sheets ──
type Hojas = Record<ClaveRango, Fila[]>
let hojasCache: { at: number; data: Hojas; avisos: string[] } | null = null
let hojasEnVuelo: Promise<{ data: Hojas; avisos: string[] }> | null = null
let ultimoBueno: Hojas | null = null

async function leerHojasSinCache(): Promise<{ data: Hojas; avisos: string[] }> {
  const id = process.env.SHEET_ID_FINANZAS
  if (!id) throw new Error('Falta SHEET_ID_FINANZAS')
  const sheets = google.sheets({ version: 'v4', auth: getAuth() })
  const claves = Object.keys(RANGOS) as ClaveRango[]
  let ultimoError = ''
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: id,
        ranges: claves.map(k => RANGOS[k]),
        valueRenderOption: 'UNFORMATTED_VALUE',
      })
      const vrs = res.data.valueRanges ?? []
      const data = Object.fromEntries(claves.map((k, i) => [k, (vrs[i]?.values ?? []) as Fila[]])) as Hojas
      ultimoBueno = data
      return { data, avisos: [] }
    } catch (e) {
      ultimoError = (e as Error).message ?? 'error'
      if (intento === 0) await esperar(1500)
    }
  }
  if (ultimoBueno) {
    console.error(`Finanzas: falló la lectura de Sheets (${ultimoError.slice(0, 120)}) → uso el último valor bueno`)
    return { data: ultimoBueno, avisos: ['No se pudo leer el sheet de Finanzas: se muestran los últimos datos leídos.'] }
  }
  throw new Error(`No se pudo leer el sheet de Finanzas: ${ultimoError.slice(0, 160)}`)
}

async function leerHojas() {
  if (hojasCache && Date.now() - hojasCache.at < 60_000) return hojasCache
  if (hojasEnVuelo) return hojasEnVuelo
  hojasEnVuelo = leerHojasSinCache()
    .then(r => { hojasCache = { at: Date.now(), ...r }; return r })
    .finally(() => { hojasEnVuelo = null })
  return hojasEnVuelo
}

// ── Meta: gasto mensual de la cuenta publicitaria (estimado de Anuncios cuando Gastos no los tiene) ──
let metaCache: { at: number; data: Record<string, number> } | null = null
async function gastoMetaMensual(hoy: string): Promise<Record<string, number>> {
  const token = process.env.META_ACCESS_TOKEN, acct = process.env.META_AD_ACCOUNT_ID
  if (!token || !acct) return {}
  if (metaCache && Date.now() - metaCache.at < 30 * 60_000) return metaCache.data
  try {
    const desde = `${Number(hoy.slice(0, 4)) - 1}-${hoy.slice(5, 7)}-01`
    const rango = encodeURIComponent(JSON.stringify({ since: desde, until: hoy }))
    let url: string | null = `https://graph.facebook.com/v23.0/act_${acct}/insights?level=account&fields=spend` +
      `&time_increment=monthly&time_range=${rango}&limit=100&access_token=${token}`
    const data: Record<string, number> = {}
    for (let pag = 0; url && pag < 3; pag++) {
      const res: Response = await fetch(url, { cache: 'no-store' })
      const json = await res.json() as { error?: unknown; data?: { spend?: string; date_start?: string }[]; paging?: { next?: string } }
      if (json.error) return metaCache?.data ?? {}
      for (const r of json.data ?? []) {
        const mes = (r.date_start ?? '').slice(0, 7)
        if (mes) data[mes] = (data[mes] ?? 0) + (parseFloat(r.spend ?? '0') || 0)
      }
      url = json.paging?.next ?? null
    }
    metaCache = { at: Date.now(), data }
    return data
  } catch {
    return metaCache?.data ?? {}
  }
}

// ── Dólar MEP (bolsa) venta diario: histórico de argentinadatos.com + el de hoy de dolarapi.com ──
let mepCache: { at: number; data: [string, number][] } | null = null
async function serieMep(hoy: string): Promise<[string, number][]> {
  if (mepCache && Date.now() - mepCache.at < 6 * 3600_000) return mepCache.data
  const desde = `${Number(hoy.slice(0, 4)) - 2}-01-01`
  const mapa = new Map<string, number>()
  try {
    const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa', { cache: 'no-store' })
    const arr = await res.json() as { fecha?: string; venta?: number }[]
    for (const x of Array.isArray(arr) ? arr : []) if (x.fecha && x.fecha >= desde && typeof x.venta === 'number' && x.venta > 0) mapa.set(x.fecha, x.venta)
  } catch { /* se sigue con lo que haya */ }
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/bolsa', { cache: 'no-store' })
    const x = await res.json() as { venta?: number; fechaActualizacion?: string }
    if (typeof x.venta === 'number' && x.venta > 0) {
      const f = new Date(x.fechaActualizacion ?? Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      if (!mapa.has(f)) mapa.set(f, x.venta)
    }
  } catch { /* idem */ }
  const data = [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  if (data.length) mepCache = { at: Date.now(), data }
  return data.length ? data : (mepCache?.data ?? [])
}

export function hoyArgentina(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })   // 'YYYY-MM-DD'
}

// Datos crudos de un mes de cálculo (Sheets + Meta + MEP). Lo usan /api/finanzas y /api/finanzas-cierre.
export async function leerDatosFinanzas() {
  const hoy = hoyArgentina()
  const [hojas, metaSpend, mep] = await Promise.all([leerHojas(), gastoMetaMensual(hoy), serieMep(hoy)])
  return { hoy, hojas: hojas.data, avisosHojas: hojas.avisos, metaSpend, mep }
}
export type DatosFinanzas = Awaited<ReturnType<typeof leerDatosFinanzas>>

export function calcularMes(d: DatosFinanzas, mes: string, gastos: Fila[] = d.hojas.gastos) {
  const f = calcularFinanzas({
    mes, hoy: d.hoy,
    registro: d.hojas.registro, gastos, payroll: d.hojas.payroll, er: d.hojas.er,
    anioPlanillas: ANIO_PLANILLAS, metaSpend: d.metaSpend, mep: d.mep,
    comprobantes: leerComprobantes(),   // cuenta que recibió cada pago de jul–sep 2026 (dato fijo, ver lib/finanzasCuentas.ts)
  })
  const avisos = [...d.avisosHojas]
  if (!d.mep.length) avisos.push('No se pudo obtener el dólar MEP: los montos en ARS del monotributo quedan incompletos.')
  if (!Object.keys(d.metaSpend).length) avisos.push('No se pudo leer el gasto de Meta (sin estimado de anuncios).')
  return { ...f, avisos, generado: new Date().toISOString() }
}

export async function obtenerFinanzas(mesPedido?: string | null) {
  const d = await leerDatosFinanzas()
  const mes = mesPedido && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesPedido) ? mesPedido : d.hoy.slice(0, 7)
  return calcularMes(d, mes)
}

// ── Escritura en la pestaña Gastos (solo /api/finanzas-cierre) ──
// Reglas del usuario (30/9/2026): en el sheet de Finanzas SOLO se escriben gastos en la pestaña Gastos, columnas A:D,
// como lo hacía él: A fecha (serial), B concepto, C monto USD (número), D tipo (Software / Anuncios / Otros).
// Se escribe RAW (sin interpretar) y, en una fila nueva, se copia el formato de A:D de la fila anterior (igual que
// las filas 92–122 cargadas el 30/9). Después de escribir se descarta el caché para que /finanzas lo vea enseguida.
const RANGO_PERMITIDO = /^Gastos!(A(\d+):D\2|C(\d+))$/
export async function escribirEnGastos(rango: string, valores: (string | number)[][], copiarFormatoDeArriba = false) {
  const id = process.env.SHEET_ID_FINANZAS
  if (!id) throw new Error('Falta SHEET_ID_FINANZAS')
  const m = RANGO_PERMITIDO.exec(rango)
  if (!m) throw new Error(`Rango no permitido (${rango}): solo una fila de Gastos A:D o una celda de monto (C)`)
  const sheets = google.sheets({ version: 'v4', auth: getAuth(true) })
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: id, range: rango, valueInputOption: 'RAW', requestBody: { values: valores },
  })
  hojasCache = null
  const fila = Number(m[2] ?? m[3])
  if (copiarFormatoDeArriba && m[2] && fila > 2) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' })
    const sheetId = meta.data.sheets?.find(x => x.properties?.title === 'Gastos')?.properties?.sheetId
    if (sheetId != null) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ copyPaste: {
      source: { sheetId, startRowIndex: fila - 2, endRowIndex: fila - 1, startColumnIndex: 0, endColumnIndex: 4 },
      destination: { sheetId, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 0, endColumnIndex: 4 },
      pasteType: 'PASTE_FORMAT',
    } }] } })
  }
  return { rango: res.data.updatedRange ?? rango, celdas: res.data.updatedCells ?? 0 }
}

export type FinanzasApi = Awaited<ReturnType<typeof obtenerFinanzas>>
