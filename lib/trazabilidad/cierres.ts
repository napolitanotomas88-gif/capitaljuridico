// ── Cierres del CRM de ventas (solo lectura) ──────────────────────────────────────────────────
// Lee las pestañas de closers de "2026 - CRM Ventas - SKWD" (A:AH): los cierres ("Cerrado…" o plata en Trato Cerrado) y,
// en la misma lectura, todas las agendas en versión liviana (para la vista de formatos). Caché de 2 minutos en memoria: la cuota de Sheets (60 lecturas/min) es compartida con producción.
import 'server-only'
import { google } from 'googleapis'
import { PESTANAS_VENTAS } from '@/lib/ventas/pendientes'
import { agendaDeFila, cierreDeFila, umbral, type AgendaLigera, type Cierre } from './modelo'

type Lectura = { cierres: Cierre[]; agendas: AgendaLigera[]; leidoEn: string }
let cache: { vence: number; datos: Lectura } | null = null
let enCurso: Promise<Lectura> | null = null

export async function leerCierres(): Promise<Lectura> {
  if (cache && cache.vence > Date.now()) return cache.datos
  if (enCurso) return enCurso
  enCurso = (async () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const spreadsheetId = process.env.SHEET_ID_VENTAS
    if (!email || !key || !spreadsheetId) throw new Error('Lectura de Ventas no configurada')
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: PESTANAS_VENTAS.map((p) => `'${p}'!A1:AH`), valueRenderOption: 'UNFORMATTED_VALUE' })
    const u = umbral()
    const agendas: AgendaLigera[] = []
    const cierres = PESTANAS_VENTAS.flatMap((p, i) => {
      const filas = res.data.valueRanges?.[i]?.values ?? []
      const cab = filas[0] ?? []
      // Ante un cambio de esquema no se lee plata de otra columna en silencio
      if (!String(cab[21] ?? '').includes('Situación') || !String(cab[24] ?? '').includes('Cash')) throw new Error(`Cambió el esquema de Ventas en "${p}": revisar columnas`)
      return filas.slice(1).flatMap((r, j) => {
        const c = cierreDeFila(p, j + 2, r, u)
        const a = agendaDeFila(r, c)
        if (a) agendas.push(a)
        return c ? [c] : []
      })
    })
    // Una misma persona puede figurar dos veces (reagenda en otra pestaña): gana la fila con más cobrado
    const unicos = new Map<string, Cierre>()
    for (const c of cierres) {
      const previo = unicos.get(c.clave)
      if (!previo || c.cobrado > previo.cobrado) unicos.set(c.clave, c)
    }
    const datos = { cierres: [...unicos.values()].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '')), agendas, leidoEn: new Date().toISOString() }
    cache = { vence: Date.now() + 120_000, datos }
    return datos
  })()
  try {
    return await enCurso
  } finally {
    enCurso = null
  }
}
