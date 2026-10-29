// ── Forma JSON de RawData (lo que devuelve /api/raw y consume el navegador) ──
// Las fechas de transacciones y llamadas viajan como día puro "YYYY-MM-DD" (sin hora ni zona
// horaria): un ISO con hora UTC corre las fechas un día atrás en navegadores UTC-3.
// La usan /api/raw, el analista (panel + Discord) y page.tsx, así todos ven exactamente lo mismo.
import type { RawData } from './rawSheets'

type ConFechaTexto<T> = Omit<T, 'date'> & { date: string }

export type RawSerializada = Omit<RawData, 'transactions' | 'calls'> & {
  transactions: ConFechaTexto<RawData['transactions'][number]>[]
  calls: ConFechaTexto<RawData['calls'][number]>[]
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function serializeRaw(data: RawData): RawSerializada {
  return {
    ...data,
    transactions: data.transactions.map(t => ({ ...t, date: ymd(t.date) })),
    calls: data.calls.map(c => ({ ...c, date: ymd(c.date) })),
  }
}
