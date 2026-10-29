// ── Bot "Capital Jurídico": textos de la etapa ÉXITO (puros) ─────────────────────────────────────────────────────────────
// · TEXTO_TESTIMONIO: el texto EXACTO que pidió Tomás (25/10/2026). Solo cambian dos cosas: [CLIENTE] por el primer nombre y
//   el saludo inicial ("Buenas tardes") por el que corresponde a la hora de Argentina (saludoPorHora):
//     de 5:00 a 12:59 → "Buenos días" · de 13:00 a 19:59 → "Buenas tardes" · de 20:00 a 4:59 → "Buenas noches".
// · La encuesta y el recordatorio son los textos APROBADOS por Tomás (25/10/2026), tal cual. El agradecimiento con el Calendly
//   está "A APROBAR POR TOMÁS".
import { createHash } from 'node:crypto'

export const TZ_AR = 'America/Argentina/Buenos_Aires'

export const TEXTO_TESTIMONIO = `Buenas tardes [CLIENTE], ¿cómo estás? ¿Todo bien?

Estuvimos viendo que te está yendo muy bien y la idea es que podamos seguir sacándole el máximo provecho a todos estos resultados para no bajarnos del envión en el que estamos.

Por eso, nos gustaría que nos cuentes un poco como arrancaste con nosotros, que venías haciendo antes y que resultados venís teniendo ahora, grabando un breve video de testimonio.

Acá dejamos unos ejemplos: https://youtube.com/playlist?list=PL8LofN0YIBBB0FRT2OU5WIAESNAh4ig0Q&si=TdEGjTz2PUbYMH8G

Además, si podes enviarlo, a modo de agradecimiento, vas a poder tener una reunión de Análisis Estratégico y Proyección del estudio con Gero (Actis), así pueden plantear los próximos pasos para seguir escalando.

¿Te parece?`

/** APROBADO POR TOMÁS (25/10/2026): el agradecimiento cuando llega el video, tal cual. */
export const TEXTO_AGRADECIMIENTO = `Muchísimas gracias, [CLIENTE]! Ya nos llegó el video, de verdad lo valoramos un montón. Como te contamos, acá podés agendar tu reunión de Análisis Estratégico y Proyección del estudio con Gero Actis: [CALENDLY]`

/** APROBADO POR TOMÁS (25/10/2026): la encuesta mensual, tal cual. [CLIENTE] = primer nombre; [LINK] = el form bnvnMvVn. */
export const TEXTO_ENCUESTA = `Buenas [CLIENTE]!  Como todos los meses, queremos saber cómo te venís sintiendo con Capital Jurídico. Son 3 preguntas y te lleva menos de 3 minutos:
[LINK]
Tu respuesta nos ayuda a detectar dónde estamos fallando y qué debemos mejorar. Desde ya, muchas gracias!`

/** APROBADO POR TOMÁS (25/10/2026): el recordatorio a los 3 días, tal cual. */
export const TEXTO_RECORDATORIO = `[CLIENTE], te recordamos la encuesta de este mes. Son 3 minutos y nos sirve muchísimo para poder ayudarte de la mejor manera:
[LINK]`

export type Saludo = 'Buenos días' | 'Buenas tardes' | 'Buenas noches'

/** Hora (0-23) de Argentina en ese instante. */
export function horaAR(ms: number): number {
  const h = Number(new Date(ms).toLocaleString('en-US', { timeZone: TZ_AR, hour: 'numeric', hourCycle: 'h23' }))
  return Number.isFinite(h) ? h % 24 : new Date(ms - 3 * 3600_000).getUTCHours()
}
/** "AAAA-MM-DD" de Argentina. */
export const diaAR = (ms: number): string => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ_AR })

export function saludoPorHora(ms: number): Saludo {
  const h = horaAR(ms)
  if (h >= 5 && h < 13) return 'Buenos días'
  if (h >= 13 && h < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

const TITULOS = new Set(['dr', 'dra', 'dr.', 'dra.', 'doctor', 'doctora', 'lic', 'lic.', 'abog', 'abog.', 'estudio', 'sr', 'sra', 'sr.', 'sra.'])
const capital = (w: string) => (w ? w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es') : w)

/** Primer nombre para el saludo ("ANA MARÍA PÉREZ" → "Ana"; "Dra. Laura Gómez" → "Laura"). '' si no hay. */
export function primerNombre(nombre: string | null | undefined): string {
  const ws = (nombre ?? '').replace(/[|·,;()]/g, ' ').split(/\s+/).map((w) => w.trim()).filter(Boolean)
  const w = ws.find((x) => !TITULOS.has(x.toLowerCase()) && /\p{L}/u.test(x)) ?? ''
  return w.split('-').map(capital).join('-')
}

const conNombre = (t: string, nombre: string) => (nombre ? t.replaceAll('[CLIENTE]', nombre) : t.replaceAll(' [CLIENTE]', '').replaceAll('[CLIENTE], ', '').replaceAll('[CLIENTE]', ''))

/** El texto exacto del pedido de testimonio, con el primer nombre y el saludo de la hora de Argentina. */
export function textoTestimonio(nombre: string | null | undefined, ahora: number): string {
  const t = TEXTO_TESTIMONIO.replace(/^Buenas tardes/, saludoPorHora(ahora))
  return conNombre(t, primerNombre(nombre))
}

export const textoAgradecimiento = (nombre: string | null | undefined, calendly: string): string =>
  conNombre(TEXTO_AGRADECIMIENTO, primerNombre(nombre)).replace('[CALENDLY]', calendly)

export function textoEncuesta(nombre: string | null | undefined, link: string): string {
  const n = primerNombre(nombre)
  return TEXTO_ENCUESTA.replace('Buenas [CLIENTE]!', n ? `Buenas ${n}!` : 'Buenas!').replace('[LINK]', link)
}

export function textoRecordatorio(nombre: string | null | undefined, link: string): string {
  const n = primerNombre(nombre)
  const t = n ? TEXTO_RECORDATORIO.replace('[CLIENTE]', n) : TEXTO_RECORDATORIO.replace('[CLIENTE], te recordamos', 'Te recordamos')
  return t.replace('[LINK]', link)
}

/** El pedido de OK de la encuesta del mes en Verificaciones C.J (lista de clientes ACTIVOS del CRM con grupo General). */
export function textoListaEncuesta(mes: string, van: readonly string[], sinGrupo: readonly string[]): string {
  const lista = van.length ? van.join(', ') : '(ninguno)'
  const sin = sinGrupo.length ? `\n\nSin grupo General conocido (no les llega): ${sinGrupo.join(', ')}` : ''
  return `📋 Encuesta mensual (${mes}): la mando a estos ${van.length} clientes activos: ${lista}${sin}\n\n¿Mando? Respondé citando OK / NO (para dejar afuera a alguien: "OK sin Nombre Apellido")`
}

export type GrupoCliente = 'general' | 'ventas' | 'contenido'
const NOMBRE_GRUPO: Record<GrupoCliente, string> = { general: 'General', ventas: 'Ventas', contenido: 'Contenido' }

/** Cita corta para Verificaciones (una línea, hasta 160 caracteres, sin partir emojis). */
export function citaCorta(t: string, max = 160): string {
  const l = t.replace(/\s+/g, ' ').trim()
  if (l.length <= max) return l
  const corte = Array.from(l).slice(0, max - 1).join('')
  return `${corte}…`
}

export type MotivoExito = { tipo: 'mensaje'; cita: string; grupo: GrupoCliente } | { tipo: 'encuesta'; puntaje: number; fecha: string | null }

/** El pedido de permiso en Verificaciones C.J (corto). */
export function textoPedidoOk(cliente: string, motivo: MotivoExito): string {
  const por = motivo.tipo === 'mensaje'
    ? `Escribió en el grupo ${NOMBRE_GRUPO[motivo.grupo]}: "${citaCorta(motivo.cita)}"`
    : `Encuesta mensual: ${motivo.puntaje}/10${motivo.fecha ? ` (${motivo.fecha})` : ''}`
  return `🏆 Éxito de cliente: ${cliente}\n${por}\n\n¿Le mando el mensaje de testimonio? Respondé citando: OK / NO`
}

/** Aviso en Discord #🤝-exito-y-bajas cuando llega el video. WhatsApp no tiene links a un mensaje: va el link del grupo. */
export function textoDiscordTestimonio(p: { cliente: string; mencion: string | null; grupo: GrupoCliente; link: string | null; mensajeId: string; fecha: string }): string {
  const quien = p.mencion ? `<@${p.mencion}>` : 'Gero M'
  const donde = p.link ? `Link del grupo ${NOMBRE_GRUPO[p.grupo]}: ${p.link}` : `En el grupo ${NOMBRE_GRUPO[p.grupo]} de WhatsApp`
  return `${quien} 🎥 **${p.cliente}** mandó su testimonio (${p.fecha}).\n${donde} · mensaje ${p.mensajeId}\nYa le respondimos con el link de la reunión de Análisis y Proyecciones.`
}

/** Huella de un texto (mismo criterio que el motor: espacios normalizados) para emparejar un eco sin id. */
export const huellaTexto = (t: string): string => createHash('sha256').update(t.replace(/\s+/g, ' ').trim(), 'utf8').digest('hex').slice(0, 32)
