// ── Historial operativo: una foto diaria del semáforo de clientes ──────────
// ClickUp (rojo/amarillo/verde/pausa/producción/finalizados) y el CRM (activos) son estados del
// MOMENTO: no guardan historia, así que al cambiar de mes el tablero no tenía con qué comparar.
// El cron diario (/api/resumen-diario, 8:00 AR) guarda una fila por día en la pestaña
// "Historial operativo" del sheet de Ventas; rawSheets la lee → RawData.historialOperativo.
// Idempotente por fecha (día argentino): si la fila del día ya existe, se actualiza.
import { google } from 'googleapis'
import type { RawData, FotoOperativa } from './rawSheets'

export const PESTANA_HISTORIAL = 'Historial operativo'
export const HEADER_HISTORIAL = ['Fecha', 'Rojo', 'Amarillo', 'Verde', 'Pausa', 'Producción', 'Finalizados', 'Activos CRM']

// Mismo patrón de auth que lib/enrutamientoSheet.ts (scope de ESCRITURA)
function clienteEscritura() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key) return null
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth })
}

// Día de HOY en Argentina como 'YYYY-MM-DD' (el server de Vercel corre en UTC)
export const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

export function fotoOperativa(raw: RawData, fecha = hoyAR()): FotoOperativa {
  const c = raw.clickup
  return {
    fecha, rojo: c.rojo, amarillo: c.amarillo, verde: c.verde, pausa: c.pausa,
    produccion: c.produccion, finalizados: c.finalizados, activosCRM: raw.backend.crm.activos,
  }
}

// La fecha puede volver como texto 'YYYY-MM-DD' (se escribe RAW) o como serial si alguien la editó a mano
const normFecha = (v: unknown): string => {
  if (typeof v === 'number') {
    const u = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-6) * 86_400_000)
    return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(u.getUTCDate()).padStart(2, '0')}`
  }
  return String(v ?? '').trim().slice(0, 10)
}

export async function guardarFotoOperativa(raw: RawData): Promise<{ ok: boolean; detalle: string }> {
  const sheets = clienteEscritura()
  const id = process.env.SHEET_ID_VENTAS
  if (!sheets || !id) return { ok: false, detalle: 'sin credenciales de Sheets o SHEET_ID_VENTAS' }
  // Sin ClickUp o sin CRM la foto saldría en 0 y ensuciaría el historial → no se guarda
  if (!raw.clickup.disponible) return { ok: false, detalle: 'ClickUp no disponible: no se guarda una foto en 0' }
  if (!raw.backend.crm.disponible) return { ok: false, detalle: 'CRM no disponible: no se guarda una foto en 0' }
  const f = fotoOperativa(raw)
  const fila = [f.fecha, f.rojo, f.amarillo, f.verde, f.pausa, f.produccion, f.finalizados, f.activosCRM]
  const rango = (r: string) => `'${PESTANA_HISTORIAL}'!${r}`
  try {
    // Columna A (fechas). Si la pestaña no existe todavía, se crea con su encabezado.
    let colA: unknown[] = []
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: rango('A:A'), valueRenderOption: 'UNFORMATTED_VALUE' })
      colA = (r.data.values ?? []).map(x => x[0])
    } catch (e) {
      if (!/unable to parse range/i.test((e as Error).message ?? '')) throw e
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: [{ addSheet: { properties: { title: PESTANA_HISTORIAL, gridProperties: { frozenRowCount: 1 } } } }] },
      })
      colA = []
    }
    if (!colA.length || normFecha(colA[0]) !== 'Fecha') {
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: rango('A1:H1'), valueInputOption: 'RAW', requestBody: { values: [HEADER_HISTORIAL] } })
      if (!colA.length) colA = ['Fecha']
    }
    const idx = colA.findIndex((v, i) => i > 0 && normFecha(v) === f.fecha)
    if (idx > 0) {
      const n = idx + 1
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: rango(`A${n}:H${n}`), valueInputOption: 'RAW', requestBody: { values: [fila] } })
      return { ok: true, detalle: `foto del ${f.fecha} actualizada (fila ${n})` }
    }
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: rango('A:H'), valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [fila] } })
    return { ok: true, detalle: `foto del ${f.fecha} guardada` }
  } catch (e) {
    return { ok: false, detalle: (e as Error).message }
  }
}
