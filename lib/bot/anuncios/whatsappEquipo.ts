// ── Avisos de Anuncios al grupo ADS del equipo por WhatsApp (Whapi) ─────────────────────────────────
// Pedido de Tomás (1/11/2026): además de #📣-ads en Discord, los avisos le llegan a Valen por WhatsApp, en el grupo
// interno ADS (WHAPI_GRUPO_ADS), mencionándolo. Solo grupos del equipo: nunca escribe a un cliente.
//   · APAGADO por defecto: sale solo con ANUNCIOS_WHATSAPP_EQUIPO=real. La mención usa ANUNCIOS_WHATSAPP_TEL_VALENTINO
//     (solo dígitos); sin eso, el mensaje sale sin mención.
//   · WhatsApp seguro (el número del bot ya fue suspendido una vez): la alerta diaria manda UN solo mensaje con el
//     resumen de lo que salió por Discord (nunca un mensaje por aviso). Entre dos mensajes pasan al menos 5 minutos
//     y hay un tope por día (ANUNCIOS_WHATSAPP_EQUIPO_MAX_DIA, 6 por defecto), con el candado en Neon para que no lo
//     salteen dos instancias de Vercel. Si no hay turno, no se manda: el aviso ya está en Discord.
//   · El cliente de Whapi chequea /health antes de escribir: si el número no está conectado, no sale nada.
// Los textos no llevan teléfonos ni tokens en el log. Solo servidor.

export const ESPACIO_MIN_MS = 5 * 60_000
export const MAX_DIA_POR_DEFECTO = 6
export const MAX_LINEAS_RESUMEN = 20
/** Cómo le habla el bot a Valen (pedido de Tomás, 1/11): «Pelado». */
export const SALUDO = 'Pelado'
const encabezado = (tel: string | null) => `${tel ? `@${tel} ` : ''}${SALUDO}, `

export const equipoEncendido = (env: NodeJS.ProcessEnv = process.env): boolean => env.ANUNCIOS_WHATSAPP_EQUIPO?.trim() === 'real'
export const telValentino = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const t = (env.ANUNCIOS_WHATSAPP_TEL_VALENTINO ?? '').replace(/\D/g, '')
  return t.length >= 7 && t.length <= 15 ? t : null
}
export const maxPorDia = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.ANUNCIOS_WHATSAPP_EQUIPO_MAX_DIA)
  return Number.isInteger(n) && n > 0 ? n : MAX_DIA_POR_DEFECTO
}

/** Pasa un aviso escrito para Discord a WhatsApp: sin la mención de Discord, negrita con un asterisco, links a la vista. */
export function discordAWhatsapp(texto: string): string {
  return texto
    .replace(/<@!?\d+>\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\(<?([^)>\s]+)>?\)/g, '$1: $2')
    .replace(/\\([|_*~`])/g, '$1')
    .trim()
}

const ETIQUETA: Record<string, string> = {
  optimizar: 'Optimizar', ganadores: 'Elegir ganadores', optimizada: 'Optimización hecha (avisar al cliente)',
  lanzada: 'Campaña al aire (avisar al cliente)', videos: 'Videos nuevos para subir',
}
export interface ItemResumen { tipo: string; cliente: string }

/** El único mensaje de la alerta diaria: qué salió hoy por Discord, por cliente. null si no salió nada. */
export function textoResumen(items: readonly ItemResumen[], link: string, tel: string | null): string | null {
  if (!items.length) return null
  const lineas = items.slice(0, MAX_LINEAS_RESUMEN).map(i => `• ${i.cliente} — ${ETIQUETA[i.tipo] ?? i.tipo}`)
  if (items.length > MAX_LINEAS_RESUMEN) lineas.push(`• … y ${items.length - MAX_LINEAS_RESUMEN} más`)
  return [
    `${encabezado(tel)}📣 *Anuncios de hoy* · ${items.length} aviso${items.length === 1 ? '' : 's'}`,
    ...lineas,
    `El detalle de cada uno está en #📣-ads de Discord. Tablero: ${link}`,
  ].join('\n')
}

/** Un aviso suelto (p. ej. una nota del cliente): el texto de Discord pasado a WhatsApp, con la mención adelante. */
export const textoSuelto = (textoDiscord: string, tel: string | null): string => `${encabezado(tel)}${discordAWhatsapp(textoDiscord)}`

export interface DepsEquipo {
  encendido: boolean
  tel: string | null
  /** Candado compartido: true = toca mandar (pasaron 5 min del último y no se llegó al tope del día). */
  reclamarTurno(): Promise<boolean>
  enviar(texto: string, menciones: string[]): Promise<string | null>
}
export type EstadoEquipo = 'enviado' | 'apagado' | 'nada' | 'sin_turno' | 'error'

/** Manda un mensaje al grupo ADS si está encendido y hay turno. Nunca tira. */
export async function avisarEquipo(texto: string | null, deps: DepsEquipo): Promise<{ estado: EstadoEquipo; motivo?: string }> {
  if (!deps.encendido) return { estado: 'apagado' }
  if (!texto) return { estado: 'nada' }
  try {
    if (!(await deps.reclamarTurno())) return { estado: 'sin_turno' }
    await deps.enviar(texto, deps.tel ? [deps.tel] : [])
    return { estado: 'enviado' }
  } catch (e) {
    return { estado: 'error', motivo: String((e as Error)?.message ?? e).replace(/\d{7,}/g, '[número]').slice(0, 160) }
  }
}
