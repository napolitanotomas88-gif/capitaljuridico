// ── Alertas por Discord: el formato fijo de cada mensaje (2/11/2026). Puro, sin red ──────────────────────────────────────
//   1.ª línea: «<@…> {emoji} **{título} — {cliente}**»
//   hasta 6 viñetas («• …»)
//   si hay texto para pegarle al cliente: un bloque de código (en el celular se copia con un toque)
//   al final: «➡️ <link al Despacho>» (entre <> para que no arme vista previa)
// Nunca supera 1.900 caracteres (Discord corta en 2.000): primero se recortan las viñetas y después el texto a copiar.
// Las menciones solo salen a quienes se declaran (allowed_mentions.users): un @everyone o un <@id> dentro del texto no
// notifica a nadie.
export const MAX_CARACTERES = 1_900
export const MAX_LINEAS = 6
/** flags de Discord: 4 = sin vista previa de links; 4096 = silencioso (no notifica). */
export const FLAG_SIN_VISTA = 4
export const FLAG_SILENCIOSO = 4096
export const HORA_SILENCIO_DESDE = 20
export const HORA_SILENCIO_HASTA = 9

/** Discord no lleva teléfonos ni documentos: las menciones de WhatsApp («@549…») y los números de 8 dígitos o más se tapan. */
export const sinTelefonos = (t: string) => t.replace(/@\+?\d{8,15}\b/g, '@closer').replace(/\+?\d[\d\s.-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 && !/^\d{4}-\d{2}-\d{2}$/.test(m.trim()) ? '[número]' : m))

const limpia = (s: string, n: number) => {
  const t = sinTelefonos(String(s ?? '')).replace(/\s+/g, ' ').replace(/@(everyone|here)/gi, '＠$1').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export interface PartesAlerta {
  menciones: string          // «<@1> <@2> Aylu» (ya resuelto)
  emoji?: string | null
  titulo: string
  cliente?: string | null
  lineas?: readonly string[] | null
  copiar?: string | null
  link?: string | null
  prueba?: boolean
  /** «iba a #canal» cuando cayó al respaldo. */
  ibaA?: string | null
  /** true si cayó al respaldo porque Discord falló (429, 5xx) y no por falta del webhook. */
  porFalla?: boolean
}

/** El texto del mensaje (sin las opciones del envío). */
export function armarTexto(p: PartesAlerta): string {
  const cab = [
    p.prueba ? '🧪 PRUEBA ·' : '',
    p.prueba ? '' : p.menciones,
    p.emoji ?? '🔔',
    `**${limpia(p.titulo, 160)}${p.cliente ? ` — ${limpia(p.cliente, 80)}` : ''}**`,
  ].filter(Boolean).join(' ')
  const lineas = (p.lineas ?? []).map((l) => limpia(l, 300)).filter(Boolean).slice(0, MAX_LINEAS).map((l) => `• ${l}`)
  const extra = [p.ibaA ? `_(iba a ${p.ibaA}: ${p.porFalla ? 'Discord falló' : 'falta su webhook'})_` : '', p.prueba && p.menciones ? `_(mencionaría a ${p.menciones.replace(/<@\d+>/g, 'alguien')})_` : ''].filter(Boolean)
  const pie = p.link ? `➡️ <${p.link}>` : ''
  const copiar = (p.copiar ?? '').replace(/```/g, "'''").trim()
  const armar = (ls: string[], c: string) => [cab, ...ls, ...(c ? ['```', c, '```'] : []), ...extra, ...(pie ? [pie] : [])].join('\n')
  let ls = lineas
  let texto = armar(ls, copiar)
  while (texto.length > MAX_CARACTERES && ls.length) { ls = ls.slice(0, -1); texto = armar(ls, copiar) }
  if (texto.length > MAX_CARACTERES && copiar) {
    const sobra = texto.length - MAX_CARACTERES + 40
    texto = armar(ls, `${copiar.slice(0, Math.max(0, copiar.length - sobra))}… (sigue en el Despacho)`)
  }
  return texto.slice(0, MAX_CARACTERES)
}

/** Hora de Argentina (0–23). */
export function horaAR(ms: number): number {
  return Number(new Date(ms).toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false })) % 24
}

/** De 20 a 9 h (Argentina) la alerta sale igual, pero sin notificar (salvo urgente). */
export const esHoraSilenciosa = (ms: number): boolean => { const h = horaAR(ms); return h >= HORA_SILENCIO_DESDE || h < HORA_SILENCIO_HASTA }

export function flagsDe(ahora: number, urgente: boolean): number {
  return FLAG_SIN_VISTA | (!urgente && esHoraSilenciosa(ahora) ? FLAG_SILENCIOSO : 0)
}

/** Base del Despacho + ruta interna (o un link absoluto https tal cual). */
export function linkDespacho(base: string, ruta: string | null | undefined): string | null {
  if (!ruta) return null
  if (/^https:\/\//.test(ruta)) return ruta
  if (!ruta.startsWith('/') || ruta.startsWith('//')) return null
  return `${base.replace(/\/+$/, '')}${ruta}`
}
