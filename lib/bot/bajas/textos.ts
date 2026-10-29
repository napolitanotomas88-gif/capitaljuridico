// ── Bot "Capital Jurídico": textos de la etapa BAJA DEL CLIENTE (puros) ──────────────────────────────────────────────────
// · El pedido del aviso de fin en Verificaciones es el texto de Tomás (25/10/2026): "<Cliente> termina el <fecha>. ¿Le mando
//   el mensaje de renovación? OK / NO".
// · TEXTO_RENOVACION (aviso de fin al cliente) y TEXTO_DESPEDIDA: APROBADOS por Tomás (25/10/2026), tal cual.
// · TEXTO_RECONTACTO: APROBADO por Tomás (25/10/2026, ronda 2), tal cual.
import { createHash } from 'node:crypto'

export const TZ_AR = 'America/Argentina/Buenos_Aires'

/** APROBADO POR TOMÁS (25/10/2026), tal cual: el aviso de fin al grupo General (i01, después del OK). [CLIENTE] = primer
 *  nombre; [FECHA] = la fecha de fin en dd/mm; [CALENDLY] = BAJA_CALENDLY_URL (por defecto, el Calendly de renovación de Tomi). */
export const TEXTO_RENOVACION = `Buenas [CLIENTE], cómo estás? El dia [FECHA] terminamos el período que teníamos acordado. Quiero que hagamos un balance con vos de lo que trabajamos y ver qué tiene sentido de acá en adelante junto a Tomi, por eso preparamos una llamada de proyección con tus números.

Te dejo el link con el calendario de Tomi, ahí vas a ver todos los horarios disponibles y elegir el mejor para vos: 

[CALENDLY]`

/** APROBADO POR TOMÁS (25/10/2026), tal cual: la despedida al General (después del OK de "no renueva" y de Aylu, ANTES de
 *  sacarlo de los grupos). */
export const TEXTO_DESPEDIDA = `[CLIENTE], muchas gracias por confiar en Capital Jurídico. Fue un gusto. Las puertas siempre estarán abiertas por si en algún momento querés retomar. Escribinos cuando quieras. Muchos éxitos en todo lo que venga!`

/** APROBADO POR TOMÁS (25/10/2026, ronda 2), tal cual: el texto sugerido para recontactar a un histórico (i05). Nunca lo
 *  manda el bot: va en la lista de Discord. */
export const TEXTO_RECONTACTO = `Hola [CLIENTE], ¿cómo estás? Hace un tiempo trabajamos juntos en Capital Jurídico y nos acordamos de vos. Tenemos novedades en la forma en que captamos clientes para estudios jurídicos y nos gustaría saber cómo viene tu estudio. ¿Te parece si coordinamos una charla corta esta semana?`

/** "AAAA-MM-DD" de Argentina. */
export const diaAR = (ms: number): string => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ_AR })
/** "AAAA-MM-DD" → "dd/mm/aaaa". */
export const fechaCorta = (ymd: string): string => ymd.split('-').reverse().join('/')

const TITULOS = new Set(['dr', 'dra', 'dr.', 'dra.', 'doctor', 'doctora', 'lic', 'lic.', 'abog', 'abog.', 'estudio', 'sr', 'sra', 'sr.', 'sra.'])
const capital = (w: string) => (w ? w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es') : w)

/** Primer nombre para el saludo ("ANA MARÍA PÉREZ" → "Ana"; "Dra. Laura Gómez" → "Laura"). '' si no hay. */
export function primerNombre(nombre: string | null | undefined): string {
  const ws = (nombre ?? '').replace(/[|·,;()]/g, ' ').split(/\s+/).map((w) => w.trim()).filter(Boolean)
  const w = ws.find((x) => !TITULOS.has(x.toLowerCase()) && /\p{L}/u.test(x)) ?? ''
  return w.split('-').map(capital).join('-')
}

const conNombre = (t: string, nombre: string) =>
  nombre ? t.replaceAll('[CLIENTE]', nombre) : t.replaceAll(' [CLIENTE]', '').replace(/^\[CLIENTE\], (\p{Ll})/u, (_, l: string) => l.toLocaleUpperCase('es')).replaceAll('[CLIENTE]', '')

/** "AAAA-MM-DD" → "dd/mm" (el aviso de fin aprobado lleva la fecha sin año). */
export const fechaDiaMes = (ymd: string): string => fechaCorta(ymd).slice(0, 5)

export const textoRenovacion = (nombre: string, finYmd: string, calendly: string): string =>
  conNombre(TEXTO_RENOVACION, primerNombre(nombre)).replace('[FECHA]', fechaDiaMes(finYmd)).replace('[CALENDLY]', calendly)

export const textoDespedida = (nombre: string): string => conNombre(TEXTO_DESPEDIDA, primerNombre(nombre))

export const textoRecontactoSugerido = (nombre: string | null = null): string => conNombre(TEXTO_RECONTACTO, primerNombre(nombre))

/** Cita corta para Verificaciones (una línea, hasta `max` caracteres, sin partir emojis). */
export function citaCorta(t: string, max = 200): string {
  const l = t.replace(/\s+/g, ' ').trim()
  if (l.length <= max) return l
  return `${Array.from(l).slice(0, max - 1).join('')}…`
}

// ── Pedidos en Verificaciones C.J ──
/** i01 (texto de Tomás). */
export const textoPedidoAvisoFin = (cliente: string, finYmd: string): string =>
  `⏳ ${cliente} termina el ${fechaCorta(finYmd)}. ¿Le mando el mensaje de renovación? Respondé citando: OK / NO`

export type OrigenBaja =
  | { tipo: 'fathom'; decision: 'no_renueva' | 'dudoso'; fecha: string; cita: string; motivo: string; url: string | null }
  | { tipo: 'manual'; por: string; motivo: string }

export type EstadoCrmBaja = 'FINALIZADO' | 'INACTIVO'
/** Qué estado del CRM corresponde (fin.ts: estadoParaBaja). Sin dudas va propuesto dentro del mismo OK; con dudas se pregunta. */
export type PropuestaEstado = { dudoso: false; estado: EstadoCrmBaja; motivo: string } | { dudoso: true; motivo: string }

/** El cierre del pedido de baja: el estado del CRM propuesto (o la pregunta, si hay dudas) y cómo responder. */
export function pieEstadoCrm(e: PropuestaEstado): string {
  return e.dudoso
    ? `CRM: hay dudas sobre el estado (${e.motivo}). ¿Pasa a FINALIZADO o a INACTIVO? Respondé citando: OK FINALIZADO / OK INACTIVO (NO si no es baja)`
    : `CRM: pasa a ${e.estado} (${e.motivo}). ¿Confirmás la baja? Respondé citando: OK / NO`
}

/** i02: confirmación de la baja. SIEMPRE se pide, aunque el Fathom sea obvio (Tomás, 25/10). */
export function textoPedidoBaja(cliente: string, o: OrigenBaja, estado: PropuestaEstado = { dudoso: false, estado: 'FINALIZADO', motivo: 'terminó su período' }): string {
  if (o.tipo === 'manual') {
    return `🚪 Baja de ${cliente} (pedida a mano${o.por ? ` por ${o.por}` : ''})${o.motivo ? `\nMotivo: ${citaCorta(o.motivo, 160)}` : ''}\n\n${pieEstadoCrm(estado)}`
  }
  const cabeza = o.decision === 'no_renueva'
    ? `🚪 ${cliente} dijo que NO renueva (llamada con Tomi del ${fechaCorta(o.fecha)})`
    : `❓ No me queda claro si ${cliente} renueva (llamada con Tomi del ${fechaCorta(o.fecha)})`
  const lineas = [cabeza, o.cita ? `"${citaCorta(o.cita, 200)}"` : '', o.motivo ? `Motivo: ${citaCorta(o.motivo, 160)}` : '', o.url ?? ''].filter(Boolean)
  return `${lineas.join('\n')}\n\nNada avanza sin el OK (ni la despedida, ni los grupos, ni el CRM).\n${pieEstadoCrm(estado)}`
}

/** i03: el OK de la despedida (lo da Aylu). Muestra el texto y a quién se saca de los grupos. */
export function textoPedidoDespedida(cliente: string, despedida: string, aQuitar: string[], sinGrupos: boolean, conComunidad = false): string {
  const comunidad = conComunidad && !sinGrupos ? ' Y después elimino su comunidad (con el grupo de Avisos).' : ''
  const quienes = sinGrupos
    ? 'No conozco sus grupos: no saco a nadie (hay que hacerlo a mano).'
    : aQuitar.length ? `Después lo saco de General, Ventas y Contenido: ${aQuitar.join(', ')}.` : 'Después lo saco de General, Ventas y Contenido (la lista se arma al momento de sacarlo).'
  return `👋 Despedida para ${cliente} (grupo General):\n\n${despedida}\n\n${quienes}${comunidad}\nAylu: ¿la mando? Respondé citando: OK / NO ("OK sin mensaje" lo saca de los grupos sin despedida)`
}

export interface CampanaPausable { id: string; nombre: string; cuenta: string; cuentaNombre: string }

/** Ronda 2: el OK para pausar sus campañas activas en Meta (nunca se borra nada). */
export function textoPedidoMeta(cliente: string, campanas: readonly CampanaPausable[]): string {
  const lista = campanas.slice(0, 15).map((c) => `• ${citaCorta(c.nombre, 80)} (${citaCorta(c.cuentaNombre || c.cuenta, 40)})`).join('\n')
  const mas = campanas.length > 15 ? `\n… y ${campanas.length - 15} más` : ''
  return `📣 ¿Pauso las campañas activas de ${cliente} en Meta? Lista:\n${lista}${mas}\n\nSolo se pausan (no se borra nada). Respondé citando: OK / NO`
}

/** i03b: aviso a Aylu en Discord para Skool (no tiene API). */
export function textoDiscordSkool(p: { cliente: string; mencion: string | null; mail: string; por: string; fecha: string }): string {
  const quien = p.mencion ? `<@${p.mencion}>` : 'Aylu'
  return `${quien} 🚪 **${p.cliente}** se dio de baja (confirmado el ${p.fecha} por ${p.por}).\nSacalo de Skool a mano: ${p.mail || '(sin correo en el CRM: buscalo por nombre)'}\nSu carpeta de Drive queda intacta (no se borra nada).`
}

// ── i05: recontacto ──
export interface Historico { cliente: string; seFue: string; dias: number; puntaje: number | null; motivo: string | null }

const haceCuanto = (dias: number): string => (dias < 60 ? `hace ${dias} días` : `hace ${Math.round(dias / 30)} meses`)

/** La lista mensual para Discord (#🤝-exito-y-bajas), partida en mensajes de menos de 1.900 caracteres. */
export function textosRecontacto(mes: string, lista: readonly Historico[]): string[] {
  const cabeza = `📇 **Históricos para recontactar (${mes})** — ${lista.length} cliente${lista.length === 1 ? '' : 's'}. El bot no les escribe: lo decide el equipo.`
  const renglones = lista.map((h) => `• **${h.cliente}** · se fue ${haceCuanto(h.dias)} (${fechaCorta(h.seFue)}) · satisfacción ${h.puntaje === null ? 'sin dato' : `${h.puntaje}/10`}${h.motivo ? ` · motivo: ${citaCorta(h.motivo, 120)}` : ''}`)
  const pie = `Texto sugerido:\n> ${textoRecontactoSugerido().replace(/\n/g, '\n> ')}`
  const out: string[] = []
  let actual = cabeza
  for (const r of [...renglones, pie]) {
    if (actual.length + r.length + 1 > 1_900) { out.push(actual); actual = r } else actual = `${actual}\n${r}`
  }
  out.push(actual)
  return out
}

/** Huella de un texto (mismo criterio que el motor: espacios normalizados) para emparejar un eco sin id. */
export const huellaTexto = (t: string): string => createHash('sha256').update(t.replace(/\s+/g, ' ').trim(), 'utf8').digest('hex').slice(0, 32)

/** "5491155550099" → "…0099" (en Verificaciones no hace falta el número entero). */
export const telCorto = (id: string): string => (id.includes('@') ? `…${id.split('@')[0].slice(-4)}` : `…${id.slice(-4)}`)
