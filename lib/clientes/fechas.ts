// ── Fechas del CRM de clientes ─────────────────────────────────────────────────────────────
// Todas las fechas de esta capa son TEXTO 'AAAA-MM-DD' (día argentino): se pueden comparar con
// < y >, viajan en JSON/snapshot sin que la zona horaria las corra, y no hay Date sueltos.
// Replica el mínimo de lib/rawSheets.ts (serialToDate, nowArgentina, ymdLocal), que no se exportan
// y ese archivo es compartido con producción: acá se calcula con Date.UTC y se lee con getUTC*
// (no hay conversión local→UTC, por eso es seguro) y NUNCA con toISOString sobre fechas locales.
export type Ymd = string

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_DIA = 86_400_000

const aTexto = (n: number, largo = 2) => String(n).padStart(largo, '0')

// ¿Es una fecha real del calendario? ('2026-02-30' no lo es)
export function esYmdValido(s: unknown): s is Ymd {
  if (typeof s !== 'string') return false
  const m = RE_YMD.exec(s)
  if (!m) return false
  const y = +m[1], mes = +m[2], d = +m[3]
  const u = new Date(Date.UTC(y, mes - 1, d))
  return u.getUTCFullYear() === y && u.getUTCMonth() === mes - 1 && u.getUTCDate() === d
}

// Valida y devuelve el mismo texto; si no es una fecha real, error (es un bug del que llama)
export function exigirYmd(s: unknown, que = 'fecha'): Ymd {
  if (!esYmdValido(s)) throw new TypeError(`${que} inválida: se esperaba 'AAAA-MM-DD' y llegó ${JSON.stringify(s)}`)
  return s
}

// Hoy en Argentina (UTC-3). El server de Vercel corre en UTC: sin esto, de 21 a 24 hs ya sería "mañana".
export function hoyArgentina(ahora: Date = new Date()): Ymd {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

// Número de día (días desde 1970-01-01) de una fecha 'AAAA-MM-DD'
export function numeroDeDia(ymd: Ymd): number {
  const m = RE_YMD.exec(exigirYmd(ymd))!
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DIA)
}

function desdeNumeroDeDia(n: number): Ymd {
  const u = new Date(n * MS_DIA)
  return `${aTexto(u.getUTCFullYear(), 4)}-${aTexto(u.getUTCMonth() + 1)}-${aTexto(u.getUTCDate())}`
}

// Días entre dos fechas: positivo si `hasta` es posterior a `desde`
export const diasEntre = (desde: Ymd, hasta: Ymd): number => numeroDeDia(hasta) - numeroDeDia(desde)

export const sumarDias = (ymd: Ymd, dias: number): Ymd => desdeNumeroDeDia(numeroDeDia(ymd) + dias)

// Suma meses de calendario; si el día no existe en el mes de destino se pasa al último día
// ('2028-02-29' + 12 meses = '2029-02-28').
export function sumarMeses(ymd: Ymd, meses: number): Ymd {
  const m = RE_YMD.exec(exigirYmd(ymd))!
  const total = (+m[1]) * 12 + (+m[2] - 1) + meses
  const y = Math.floor(total / 12), mes = total % 12
  const ultimo = new Date(Date.UTC(y, mes + 1, 0)).getUTCDate()
  return `${aTexto(y, 4)}-${aTexto(mes + 1)}-${aTexto(Math.min(+m[3], ultimo))}`
}

// Serial de Sheets (días desde 1899-12-30) → 'AAAA-MM-DD'. La parte decimal es la HORA: se trunca
// (no se redondea) o todo lo posterior al mediodía caería al día siguiente. El épsilon cubre el
// error de float en seriales enteros (46234.9999999).
export function serialAYmd(serial: number): Ymd | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null   // 2958465 = 31/12/9999
  return desdeNumeroDeDia(Math.round(Date.UTC(1899, 11, 30) / MS_DIA) + Math.floor(serial + 1e-6))
}

// 'AAAA-MM-DD' → serial de Sheets (para escribir fechas como número, sin depender del idioma de la planilla)
export const ymdASerial = (ymd: Ymd): number => numeroDeDia(ymd) + 25569   // 25569 = 1/1/1970 en el calendario de Sheets

// Fecha de una celda del CRM: serial (UNFORMATTED), 'd/m/aaaa' (el formato de la planilla) o ISO.
// Cualquier otra cosa ("Agendada (10/9)", vacío) → null.
export function fechaDeCelda(c: unknown): Ymd | null {
  if (typeof c === 'number') return serialAYmd(c)
  if (typeof c !== 'string') return null
  const t = c.trim()
  if (!t) return null
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(t)
  if (iso) return esYmdValido(iso[1]) ? iso[1] : null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D|$)/.exec(t)
  if (!m) return null
  let y = +m[3]
  if (y < 100) y += 2000
  const ymd = `${aTexto(y, 4)}-${aTexto(+m[2])}-${aTexto(+m[1])}`
  return esYmdValido(ymd) ? ymd : null
}

// 'AAAA-MM-DD' → 'd/m/aaaa' (para textos de interfaz y reportes)
export function ymdAFechaAR(ymd: Ymd): string {
  const m = RE_YMD.exec(exigirYmd(ymd))!
  return `${+m[3]}/${+m[2]}/${m[1]}`
}
