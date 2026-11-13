// ── Cierres del CRM de ventas (solo lectura) ──────────────────────────────────────────────────
// Lee las pestañas de closers de "2026 - CRM Ventas - SKWD" (A:AH): los cierres ("Cerrado…" o plata en Trato Cerrado) y,
// en la misma lectura, todas las agendas en versión liviana (para la vista de formatos). Caché de 2 minutos COMPARTIDA entre
// instancias (conCache), con la anterior mientras se renueva de fondo: la cuota de Sheets (60 lecturas/min) es compartida
// con producción. `alDia` lee directo (para lo que decide qué procesar).
import 'server-only'
import { google } from 'googleapis'
import { conCache } from '../anuncios/cache'
import { PESTANAS_VENTAS } from '@/lib/ventas/pendientes'
import { agendaDeFila, cierreDeFila, umbral, type AgendaLigera, type Cierre } from './modelo'

type Lectura = { cierres: Cierre[]; agendas: AgendaLigera[]; leidoEn: string }
const CACHE_SEG = 120

export async function leerCierres(o: { alDia?: boolean } = {}): Promise<Lectura> {
  if (o.alDia) return leerDeSheets()
  return (await conCache('traz-cierres-v1', CACHE_SEG, leerDeSheets)).data
}

async function leerDeSheets(): Promise<Lectura> {
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
      const a = agendaDeFila(r, c, p)
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
  return { cierres: [...unicos.values()].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '')), agendas, leidoEn: new Date().toISOString() }
}
