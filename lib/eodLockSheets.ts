// Implementación del lock sobre la pestaña "EOD Locks" del sheet de Ventas
import { cliente, PESTANAS } from './eodSetter'
import type { FilaLock, StoreLock } from './eodLock'

export function storeLockSheets(tab = PESTANAS.locks): StoreLock {
  const sheets = () => { const s = cliente(); if (!s) throw new Error('sin credenciales de Sheets'); return s }
  const id = () => process.env.SHEET_ID_VENTAS!
  return {
    async append(f) {
      const r = await sheets().spreadsheets.values.append({ spreadsheetId: id(), range: `'${tab}'!A:D`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[f.fecha, f.token, f.ts, f.estado]] } })
      const m = String(r.data.updates?.updatedRange ?? '').match(/!A(\d+)/)
      if (!m) throw new Error('no se pudo ubicar la fila del lock')
      return +m[1]
    },
    async rows() {
      const r = await sheets().spreadsheets.values.get({ spreadsheetId: id(), range: `'${tab}'!A2:D`, valueRenderOption: 'FORMATTED_VALUE' })
      return (r.data.values ?? []).map((v, i): FilaLock => ({ idx: i + 2, fecha: String(v[0] ?? ''), token: String(v[1] ?? ''), ts: String(v[2] ?? ''), estado: String(v[3] ?? '') }))
    },
    async update(idx, estado) {
      await sheets().spreadsheets.values.update({ spreadsheetId: id(), range: `'${tab}'!D${idx}`, valueInputOption: 'RAW', requestBody: { values: [[estado]] } })
    },
  }
}
