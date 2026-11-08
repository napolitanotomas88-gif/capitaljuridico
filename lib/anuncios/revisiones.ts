// Pruebas y cambios de anuncios para revisar en una fecha (tests de público, conjuntos Winners/Charlie…), 8/11/2026.
// Vive en la pestaña «Ads Revisiones» de la planilla de Clientes (no en el repo: el repo es público y lleva nombres de clientes).
// Columnas: A inicio (aaaa-mm-dd) · B revisar (aaaa-mm-dd) · C cliente · D tipo · E qué se hizo · F qué mirar · G conjuntos · H estado (vacío = pendiente; «revisado» = se oculta)
import { diasEntre } from './formato'

export const TAB_REVISIONES = 'Ads Revisiones'

export interface Revision { fila: number; inicio: string; revisar: string; cliente: string; tipo: string; hecho: string; mirar: string; conjuntos: string; estado: string }
export interface RevisionVista extends Revision { dia: number; total: number; faltan: number; vencida: boolean; hoyToca: boolean }

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function parsearRevisiones(valores: string[][]): Revision[] {
  return valores
    .map((r, i) => ({ fila: i + 2, inicio: (r[0] ?? '').trim(), revisar: (r[1] ?? '').trim(), cliente: (r[2] ?? '').trim(), tipo: (r[3] ?? '').trim(), hecho: (r[4] ?? '').trim(), mirar: (r[5] ?? '').trim(), conjuntos: (r[6] ?? '').trim(), estado: (r[7] ?? '').trim().toLowerCase() }))
    .filter(r => FECHA.test(r.inicio) && FECHA.test(r.revisar) && r.cliente)
}

// Día 1 = el día del cambio. Faltan = días hasta la fecha de revisión (0 = hoy toca, negativo = vencida).
export function vistaRevisiones(lista: Revision[], hoy: string): RevisionVista[] {
  return lista
    .filter(r => r.estado !== 'revisado')
    .map(r => {
      const total = Math.max(1, diasEntre(r.inicio, r.revisar))
      const faltan = diasEntre(hoy, r.revisar)
      return { ...r, dia: Math.max(1, diasEntre(r.inicio, hoy) + 1), total, faltan, vencida: faltan < 0, hoyToca: faltan === 0 }
    })
    .sort((a, b) => a.faltan - b.faltan || a.cliente.localeCompare(b.cliente))
}

export async function leerRevisiones(): Promise<Revision[]> {
  const { google } = await import('googleapis')
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key || !process.env.SHEET_ID_CLIENTES) throw new Error('Faltan credenciales para leer las revisiones')
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }) })
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID_CLIENTES, range: `'${TAB_REVISIONES}'!A2:H`, valueRenderOption: 'FORMATTED_VALUE' })
    return parsearRevisiones((r.data.values ?? []) as string[][])
  } catch (e) {
    if (/Unable to parse range/i.test((e as Error).message)) return [] // la pestaña todavía no existe
    throw e
  }
}
