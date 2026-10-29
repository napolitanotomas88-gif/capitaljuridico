import { google } from 'googleapis'
import { pendientesDeFilas, type PestanaVentas, type PendienteVenta } from './pendientes'

type Lectura = { pendientes: PendienteVenta[]; leidoEn: string }
const cache = new Map<string, { vence: number; datos: Lectura }>()
const enCurso = new Map<string, Promise<Lectura>>()

export async function leerPendientesVentas(pestanas: PestanaVentas[]): Promise<Lectura> {
  if (!pestanas.length) return { pendientes: [], leidoEn: '' }
  const clave = [...pestanas].sort().join('|')
  const previo = cache.get(clave)
  if (previo && previo.vence > Date.now()) return previo.datos
  const actual = enCurso.get(clave)
  if (actual) return actual
  const lectura = (async () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const spreadsheetId = process.env.SHEET_ID_VENTAS
    if (!email || !key || !spreadsheetId) throw new Error('Lectura de Ventas no configurada')
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: pestanas.map(p => `'${p}'!A1:AG`), valueRenderOption: 'UNFORMATTED_VALUE' })
    const pendientes = pestanas.flatMap((p, i) => {
      const filas = res.data.valueRanges?.[i]?.values ?? []
      const cabecera = filas[0] ?? []
      // Ante un cambio de esquema no asociar un estado a otra columna silenciosamente.
      if (!String(cabecera[3] ?? '').includes('Call') || !String(cabecera[21] ?? '').includes('Situación') || !String(cabecera[22] ?? '').includes('post-call')) throw new Error('Cambió el esquema de Ventas: revisar columnas')
      return pendientesDeFilas(p, filas.slice(1))
    })
    const datos = { pendientes, leidoEn: new Date().toISOString() }
    cache.set(clave, { vence: Date.now() + 120_000, datos })
    return datos
  })()
  enCurso.set(clave, lectura)
  try { return await lectura } finally { enCurso.delete(clave) }
}
