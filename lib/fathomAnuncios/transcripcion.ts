// ── Transcripción de Fathom → texto para el modelo, links al momento exacto y fechas en hora argentina ──
// El modelo recibe un renglón por intervención: "[HH:MM:SS] Nombre: texto". Los renglones seguidos del mismo
// hablante se juntan (Fathom corta cada frase en un renglón) y conservan el timestamp del primero: es el que el
// modelo tiene que copiar en cada cambio y el que se usa para el link "▶ 12:30" del mensaje.
// La transcripción NO se corta: Opus tiene 1M de contexto y una llamada de 2 horas ronda los 150.000 caracteres;
// si pasa de LARGO_AVISO se procesa igual y el largo queda en el registro.
import type { RenglonFathom, ReunionFathom } from './tipos'
import { RE_TIMESTAMP } from './tipos'

export const LARGO_AVISO = 250_000
const TZ = 'America/Argentina/Buenos_Aires'

/** '00:12:30' → 750. null si no es HH:MM:SS. */
export function segundos(ts: string): number | null {
  if (!RE_TIMESTAMP.test(ts)) return null
  const [h, m, s] = ts.split(':').map(Number)
  return h * 3600 + m * 60 + s
}

/** Link de Fathom que abre la grabación en ese momento. Si la url ya trae query, se agrega con "&". */
export function linkFathom(url: string, ts: string): string {
  const s = segundos(ts)
  if (s === null) return url
  return `${url}${url.includes('?') ? '&' : '?'}timestamp=${s}`
}

/** Para el botón del mensaje: '00:12:30' → '12:30', '01:02:03' → '1:02:03'. */
export function horaCorta(ts: string): string {
  const s = segundos(ts)
  if (s === null) return ts
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  const dos = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${dos(m)}:${dos(ss)}` : `${dos(m)}:${dos(ss)}`
}

export interface Transcripcion {
  texto: string
  renglones: number          // renglones válidos de Fathom (antes de juntar)
  largo: number              // caracteres del texto armado
  desde: number | null       // segundos del primer renglón
  hasta: number | null       // segundos del último renglón
}

export function formatearTranscripcion(t: RenglonFathom[] | null): Transcripcion {
  const lineas: { ts: string; quien: string; texto: string }[] = []
  let desde: number | null = null, hasta: number | null = null, renglones = 0
  for (const r of t ?? []) {
    const s = segundos(r.timestamp)
    const texto = r.text.replace(/\s+/g, ' ').trim()
    if (s === null || !texto) continue
    renglones++
    desde = desde === null ? s : Math.min(desde, s)
    hasta = hasta === null ? s : Math.max(hasta, s)
    const quien = r.speaker.display_name.replace(/\s+/g, ' ').trim() || 'Sin nombre'
    const ultima = lineas[lineas.length - 1]
    if (ultima && ultima.quien === quien) ultima.texto += ` ${texto}`
    else lineas.push({ ts: r.timestamp, quien, texto })
  }
  const texto = lineas.map(l => `[${l.ts}] ${l.quien}: ${l.texto}`).join('\n')
  return { texto, renglones, largo: texto.length, desde, hasta }
}

/** Duración de la grabación en segundos: fin - inicio; si faltan, el último timestamp de la transcripción. */
export function duracionGrabacionS(r: Pick<ReunionFathom, 'recording_start_time' | 'recording_end_time'>, tr: Transcripcion): number | null {
  const ini = r.recording_start_time ? Date.parse(r.recording_start_time) : NaN
  const fin = r.recording_end_time ? Date.parse(r.recording_end_time) : NaN
  if (Number.isFinite(ini) && Number.isFinite(fin) && fin > ini) return Math.round((fin - ini) / 1000)
  return tr.hasta
}

// ── Fechas en hora de Buenos Aires ──
function partesAR(iso: string | null): { dia: string; dd: string; mm: string; yyyy: string; hh: string; min: string } | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms))) p[x.type] = x.value
  return { dia: (p.weekday ?? '').toLowerCase(), dd: p.day, mm: p.month, yyyy: p.year, hh: p.hour, min: p.minute }
}

/** "lunes 12/10/2026 18:32" (para el modelo). null si no hay fecha válida. */
export function fechaLargaAR(iso: string | null): string | null {
  const p = partesAR(iso)
  return p ? `${p.dia} ${p.dd}/${p.mm}/${p.yyyy} ${p.hh}:${p.min}` : null
}

/** "lun 12/10 18:32" (para el mensaje de Discord). null si no hay fecha válida. */
export function fechaCortaAR(iso: string | null): string | null {
  const p = partesAR(iso)
  return p ? `${p.dia.slice(0, 3)} ${p.dd}/${p.mm} ${p.hh}:${p.min}` : null
}
