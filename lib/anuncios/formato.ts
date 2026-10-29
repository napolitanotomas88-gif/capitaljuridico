// Formatos compartidos (servidor, pantalla y Discord). Sin dependencias de Node.

const TZ = 'America/Argentina/Buenos_Aires'

export function hoyAR(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: TZ })
}

export function sumarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)
}

export const dm = (ymd: string) => `${+ymd.slice(8, 10)}/${+ymd.slice(5, 7)}`

// Monto con la moneda: "USD 1,50", "ARS 1.500", "UYU 45,48"
export function fmtMonto(v: number | null | undefined, moneda: string, opciones?: { sinMoneda?: boolean }): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const decimales = moneda === 'USD' || moneda === 'EUR' ? 2 : Math.abs(v) >= 100 ? 0 : 2
  const n = v.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return opciones?.sinMoneda ? n : `${moneda} ${n}`
}

// Gasto redondeado ("USD 189", "ARS 124.352")
export function fmtGasto(v: number | null | undefined, moneda: string, opciones?: { sinMoneda?: boolean }): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = Math.round(v).toLocaleString('es-AR')
  return opciones?.sinMoneda ? n : `${moneda} ${n}`
}

export function fmtPct(v: number | null | undefined, conSigno = true): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const p = Math.round(v * 100)
  return `${conSigno && p > 0 ? '+' : ''}${p}%`
}

export const fmtEntero = (v: number) => Math.round(v).toLocaleString('es-AR')

export function haceTiempo(iso: string | number | null | undefined, ahora: number = Date.now()): string {
  if (iso == null) return 'nunca'
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  const s = Math.max(0, Math.round((ahora - t) / 1000))
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  return `hace ${Math.floor(h / 24)} d`
}
