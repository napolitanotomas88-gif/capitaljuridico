import { google } from 'googleapis'
import { diasEntre } from './formato'

const TAB = 'Ads Optimizaciones'
// origen (columna I, desde el 24/10): vacío = botón del tablero; "auto: …" = el bot lo vio en el historial de Meta (lib/bot/anuncios)
export interface Optimizacion { cuenta: string; campanaId: string; campana: string; cliente: string; fechaLanzada: string; fecha: string; confirmado: string; accion?: 'optimizacion' | 'revision_competencia'; origen?: string }
function clienteSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_CLIENTES) throw new Error('Faltan credenciales para registrar optimizaciones')
  return google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
}
export async function leerOptimizaciones(): Promise<Optimizacion[]> {
  const sheets = clienteSheets()
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_CLIENTES!, range: `'${TAB}'!A2:H`, valueRenderOption: 'FORMATTED_VALUE' })
  return (r.data.values ?? []).filter(r => r.length >= 7).map(r => ({ cuenta: r[0], campanaId: r[1], campana: r[2], cliente: r[3], fechaLanzada: r[4], fecha: r[5], confirmado: r[6], accion: r[7] === 'revision_competencia' ? 'revision_competencia' : 'optimizacion' }))
}
export async function registrarOptimizacion(o: Optimizacion): Promise<void> {
  const sheets = clienteSheets()
  const r = await sheets.spreadsheets.values.append({ spreadsheetId: process.env.SHEET_ID_CLIENTES!, range: `'${TAB}'!A:I`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[o.cuenta, o.campanaId, o.campana, o.cliente, o.fechaLanzada, o.fecha, o.confirmado, o.accion ?? 'optimizacion', o.origen ?? '']] } })
  if (!r.data.updates?.updatedRange) throw new Error('No se confirmó el registro')
  const lectura = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_CLIENTES!, range: r.data.updates.updatedRange })
  if (lectura.data.values?.[0]?.[6] !== o.confirmado) throw new Error('No se pudo verificar la optimización guardada')
}
export function etapaOptimizacion(fecha: string | null, hoy: string): 'competencia' | 'ganador' | null {
  if (!fecha) return null
  return diasEntre(fecha, hoy) >= 7 ? 'ganador' : 'competencia'
}

export function fechaUltimaRevision(fechaOpt: string | null, fechaRev: string | null, inicio: string): string {
  return [fechaOpt, fechaRev].filter((f): f is string => !!f).sort().at(-1) ?? inicio
}
export function requiereRevision(l: { fecha: string; inicioCompetencia?: string; dm?: boolean; anuncios: number }, fechaOpt: string | null, fechaRev: string | null, hoy: string): boolean {
  if (!fechaOpt && !fechaRev && diasEntre(l.fecha, hoy) + 1 >= 4) return true
  // Sin optimización ni revisión vigentes se cuenta desde la tanda (l.fecha): con una tanda nueva, primero va el día 4
  return !!l.dm && l.anuncios >= 2 && diasEntre(fechaUltimaRevision(fechaOpt, fechaRev, l.fecha), hoy) >= 7
}
