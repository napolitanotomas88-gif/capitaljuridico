// ── Formato de números, fechas y textos para las pantallas del CRM (puro: sin red ni reloj) ──
// Todo en español rioplatense: punto de miles, coma decimal, fechas d/m/aaaa y hora argentina.
// El separador de miles se arma a mano: Intl 'es-AR' no agrupa los números de 4 cifras ("4000"),
// y en la planilla y en las ofertas se escribe "4.000".
import { diasEntre, ymdAFechaAR, esYmdValido } from './fechas'
import type { Ymd } from './fechas'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** 36762 → "36.762" (redondea a entero; para plata en USD) */
export function numeroAR(n: number): string {
  const r = Math.round(Math.abs(n))
  return `${n < 0 && r !== 0 ? '-' : ''}${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** 4000 → "USD 4.000"; null (sin cargar) → "—" */
export const usd = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : `USD ${numeroAR(n)}`)

/** '2026-10-06' → "6 de octubre de 2026" */
export function fechaLarga(ymd: Ymd): string {
  if (!esYmdValido(ymd)) return '—'
  const [y, m, d] = ymd.split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${y}`
}

/** '2026-10-06' → "6/10/2026"; null o inválida → "—" */
export const fechaCorta = (ymd: Ymd | null | undefined): string => (ymd && esYmdValido(ymd) ? ymdAFechaAR(ymd) : '—')

const ZONA = 'America/Argentina/Buenos_Aires'

/** epoch ms → "15:05" (hora argentina, 24 h) */
export const horaAR = (ms: number): string =>
  new Date(ms).toLocaleTimeString('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** epoch ms → "6/10/2026" (día argentino) */
export const diaAR = (ms: number): string => new Date(ms).toLocaleDateString('es-AR', { timeZone: ZONA, day: 'numeric', month: 'numeric', year: 'numeric' })

/** días hasta una fecha → "hoy", "mañana", "en 6 días", "ayer", "hace 12 días"; null → "" */
export function textoDias(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return ''
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  if (dias === -1) return 'ayer'
  return dias > 0 ? `en ${dias} días` : `hace ${-dias} días`
}

/** Días entre hoy y una fecha, para armar textoDias en el servidor (null si no hay fecha) */
export const diasHasta = (hoy: Ymd, ymd: Ymd | null): number | null => (ymd && esYmdValido(ymd) ? diasEntre(hoy, ymd) : null)

/** 1 → "1 mes"; 8 → "8 meses" */
export const mesesTexto = (n: number): string => `${n} ${n === 1 ? 'mes' : 'meses'}`

/** 'ACTIVO' → "Activo" */
export const ETIQUETA_ESTADO: Record<string, string> = { ACTIVO: 'Activo', PAUSADO: 'Pausado', FINALIZADO: 'Finalizado', INACTIVO: 'Inactivo', '': 'Sin estado' }
