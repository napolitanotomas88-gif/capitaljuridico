// ── Mensajes de Discord para Valentino: uno por cliente con cambios o pendientes ────────────────
// Puro (sin red) para poder probarlo. Formato:
//   <@VALENTINO> 🎯 **Cambios de anuncios · Cliente**
//   📞 Título · lun 12/10 18:32 · [Fathom](<url>)
//   🧾 Cuenta: act_…                                   (solo si hay)
//
//   ⚖️ **Rama:** Pasá los anuncios a Familia. [▶ 12:30](<link al momento>)
//   ❓ **A confirmar:** 💵 **Presupuesto:** … (los dudosos, al final)
//   ⏳ **Pendiente:** …
// Lo que escribió el modelo (y el título de Fathom) se escapa: sin markdown propio y sin menciones (@everyone, @here,
// <@…>): la ÚNICA mención es la de Valentino, que ponemos nosotros. La cita textual no va (queda en el registro): el
// link al momento exacto de la grabación alcanza. Máximo 2000 caracteres por mensaje: si un cliente se pasa, se parte
// por renglones y solo el primero lleva la mención.
import type { Cambio, ClienteExtraido, Extraccion, ReunionFathom, TipoCambio } from './tipos'
import { fechaCortaAR, horaCorta, linkFathom, segundos } from './transcripcion'

export const MAX_DISCORD = 2000

export const ETIQUETAS: Record<TipoCambio, { emoji: string; etiqueta: string }> = {
  rama: { emoji: '⚖️', etiqueta: 'Rama' },
  ubicacion: { emoji: '📍', etiqueta: 'Ubicación' },
  presupuesto: { emoji: '💵', etiqueta: 'Presupuesto' },
  guion: { emoji: '🎬', etiqueta: 'Guion' },
  apagar: { emoji: '⏸️', etiqueta: 'Apagar' },
  prender: { emoji: '▶️', etiqueta: 'Prender' },
  publico: { emoji: '👥', etiqueta: 'Público' },
  copy_cta: { emoji: '✍️', etiqueta: 'Texto/CTA' },
  destino: { emoji: '📲', etiqueta: 'Destino' },
  pago_cuenta: { emoji: '💳', etiqueta: 'Pago/cuenta' },
  accesos: { emoji: '🔑', etiqueta: 'Accesos' },
  lanzamiento: { emoji: '🚀', etiqueta: 'Lanzamiento' },
  otro: { emoji: '📌', etiqueta: 'Otro' },
}

/** Neutraliza menciones: @everyone, @here y <@id>, <@!id>, <@&rol>, <#canal> (un espacio de ancho cero las rompe). */
export function sinMenciones(t: string): string {
  return t.replace(/@(everyone|here)/gi, '@​$1').replace(/<([@#][!&]?)/g, '<​$1')
}

/** Texto de afuera listo para Discord: una línea, sin markdown propio y sin menciones. */
export function escaparDiscord(t: string): string {
  const linea = t.replace(/\s+/g, ' ').trim()
  const escapado = linea.replace(/[\\*_~`|[\]]/g, m => `\\${m}`).replace(/^>/, '\\>')
  return sinMenciones(escapado)
}

const normalizado = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

function lineaCambio(c: Cambio, url: string): string {
  const { emoji, etiqueta } = ETIQUETAS[c.tipo] ?? ETIQUETAS.otro
  // "cuando" solo si el detalle no lo dice ya (el prompt pide la fecha dentro del detalle)
  const cuando = c.cuando && !normalizado(c.detalle).includes(normalizado(c.cuando)) ? ` · 🗓️ ${escaparDiscord(c.cuando)}` : ''
  const link = c.timestamp ? ` [▶ ${horaCorta(c.timestamp)}](<${linkFathom(url, c.timestamp)}>)` : ''
  return `${c.certeza === 'a_confirmar' ? '❓ **A confirmar:** ' : ''}${emoji} **${etiqueta}:** ${escaparDiscord(c.detalle)}${cuando}${link}`
}

/** Orden de la llamada; los que no tienen timestamp, al final de su grupo (orden estable). */
const porMomento = (a: Cambio, b: Cambio) => (a.timestamp ? segundos(a.timestamp)! : Infinity) - (b.timestamp ? segundos(b.timestamp)! : Infinity)

export const tieneAlgo = (c: ClienteExtraido) => c.cambios.length > 0 || c.pendientes.length > 0
export const nombreCliente = (c: ClienteExtraido) => c.cliente_crm ?? `${c.nombre_escuchado} (nombre sin verificar)`

export interface MensajeCliente { cliente: string; partes: string[] }

/** Parte una lista de renglones en mensajes de hasta MAX_DISCORD; los que siguen arrancan con "(sigue)" y sin mención. */
export function partir(cabecera: string, cuerpo: string[], cabeceraSigue: string): string[] {
  const partes: string[] = []
  let actual = cabecera
  for (const l of cuerpo) {
    const renglon = l.length > MAX_DISCORD - cabeceraSigue.length - 2 ? `${l.slice(0, MAX_DISCORD - cabeceraSigue.length - 3)}…` : l
    if ((actual + '\n' + renglon).length > MAX_DISCORD) { partes.push(actual); actual = cabeceraSigue }
    actual += '\n' + renglon
  }
  partes.push(actual)
  return partes
}

export function armarMensajes(
  ext: Extraccion,
  r: Pick<ReunionFathom, 'title' | 'recording_start_time' | 'created_at' | 'url'>,
  valentino: string | null,
): MensajeCliente[] {
  const fecha = fechaCortaAR(r.recording_start_time) ?? fechaCortaAR(r.created_at)
  const llamada = `📞 ${escaparDiscord(r.title)}${fecha ? ` · ${fecha}` : ''} · [Fathom](<${r.url}>)`
  return ext.clientes.filter(tieneAlgo).map(c => {
    const nombre = escaparDiscord(nombreCliente(c))
    const cabecera = [
      `${valentino ? `<@${valentino}> ` : ''}🎯 **Cambios de anuncios · ${nombre}**`,
      llamada,
      ...(c.cuenta_publicitaria ? [`🧾 Cuenta: ${escaparDiscord(c.cuenta_publicitaria)}`] : []),
      '',
    ].join('\n')
    const confirmados = c.cambios.filter(x => x.certeza === 'confirmado').sort(porMomento)
    const dudosos = c.cambios.filter(x => x.certeza !== 'confirmado').sort(porMomento)
    const cuerpo = [
      ...confirmados.map(x => lineaCambio(x, r.url)),
      ...dudosos.map(x => lineaCambio(x, r.url)),
      ...c.pendientes.map(p => `⏳ **Pendiente:** ${escaparDiscord(p)}`),
    ]
    return { cliente: nombreCliente(c), partes: partir(cabecera, cuerpo, `🎯 **${nombre}** (sigue)`) }
  })
}

/** Clave estable de un cliente para clientes_enviados: el nombre del CRM o el escuchado, normalizado. */
export const claveCliente = (c: ClienteExtraido): string => normalizado(c.cliente_crm ?? c.nombre_escuchado).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() || 'sin nombre'

/** Una clave por cliente con algo para mandar, en el mismo orden que armarMensajes; si dos se repiten, "#2", "#3"… */
export function clavesUnicas(clientes: ClienteExtraido[]): string[] {
  const vistas = new Map<string, number>()
  return clientes.filter(tieneAlgo).map(c => {
    const k = claveCliente(c), n = (vistas.get(k) ?? 0) + 1
    vistas.set(k, n)
    return n === 1 ? k : `${k}#${n}`
  })
}

// ── Avisos para Tomás (mismo canal, mencionándolo). Solo el título y el motivo: nada de la llamada. ──
/** Cuándo se vuelve a intentar sola una grabación en error, para que el aviso diga la verdad. */
export type Reintento =
  | { tipo: 'automatico'; cuando: 'hoy' | 'mañana' }   // la toma el cron (Hobby: corre entre las 8 y las 9 de AR)
  | { tipo: 'sin_mas'; intentos: number }              // ya llegó al tope de intentos del cron
  | { tipo: 'sin_registro' }                           // ni siquiera quedó la fila (la base no respondió al reclamar)

function textoReintento(r: Reintento, recordingId: number): string {
  switch (r.tipo) {
    case 'automatico':
      return `Se reintenta sola ${r.cuando} entre las 8 y las 9 (o si Fathom la reenvía). Si es urgente, pedile a Claude que reintente la grabación ${recordingId}.`
    case 'sin_mas':
      return `Ya van ${r.intentos} intentos: no se reintenta más sola. Pedile a Claude que reintente la grabación ${recordingId}.`
    case 'sin_registro':
      return `No quedó guardada en la base, así que no se reintenta sola: pedile a Claude que reprocese la grabación ${recordingId} (la puede traer de Fathom).`
  }
}

/** Aviso corto de error para Tomás (sin datos de la llamada más allá del título). */
export function textoAviso(titulo: string, recordingId: number, motivo: string, tomas: string, reintento: Reintento): string {
  const t = `<@${tomas}> ⚠️ No pude sacar los cambios de anuncios de «${escaparDiscord(titulo)}» (grabación ${recordingId}): ${escaparDiscord(motivo).slice(0, 300)}. ` +
    textoReintento(reintento, recordingId)
  return t.slice(0, MAX_DISCORD)
}

/** El webhook llegó sin transcripción: es la configuración del webhook en Fathom, no un error pasajero (se avisa una vez). */
export function textoSinTranscripcion(titulo: string, recordingId: number, tomas: string): string {
  return (`<@${tomas}> ⚠️ «${escaparDiscord(titulo)}» (grabación ${recordingId}): el webhook de Fathom llega sin transcripción: ` +
    'en Fathom → Settings → API Access → el webhook, activá Transcript. Esta grabación no se reintenta sola; si hace falta, ' +
    `pedile a Claude que la reprocese.`).slice(0, MAX_DISCORD)
}

/** Fila en error o colgada que no tiene el payload guardado: el cron no la puede reintentar (se avisa una vez). */
export function textoSinPayload(titulo: string, recordingId: number, estado: string, tomas: string): string {
  return (`<@${tomas}> ⚠️ La grabación «${escaparDiscord(titulo)}» (${recordingId}) quedó en ${escaparDiscord(estado)} y no tiene guardado lo que mandó Fathom, ` +
    'así que no se puede reintentar sola. Si hace falta, pedile a Claude que la reprocese (la puede traer de Fathom).').slice(0, MAX_DISCORD)
}

/** Una colgada que ya llegó al tope de intentos: el cron la cierra y avisa una sola vez. */
export function textoAgotada(titulo: string, recordingId: number, intentos: number, tomas: string): string {
  return (`<@${tomas}> ⚠️ La grabación «${escaparDiscord(titulo)}» (${recordingId}) se cortó ${intentos} veces sin terminar y ya no se reintenta sola. ` +
    'Si hace falta, pedile a Claude que la reintente a mano.').slice(0, MAX_DISCORD)
}

/** Una grabación que había quedado colgada (la función se cortó) y el cron la terminó. */
export function textoColgadaReintentada(titulo: string, recordingId: number, resultado: string, tomas: string): string {
  return `<@${tomas}> 🔁 La grabación «${escaparDiscord(titulo)}» (${recordingId}) había quedado a medias (la función se cortó) y la reintenté: ${escaparDiscord(resultado)}.`.slice(0, MAX_DISCORD)
}
