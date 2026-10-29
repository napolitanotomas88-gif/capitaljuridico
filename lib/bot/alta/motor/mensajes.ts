// ── Bot "Capital Jurídico": textos del motor de altas (closer en Ventas C.J. y equipo en Verificaciones C.J) ───────────
// Puro y sin red. Todo pedido termina diciendo cómo responder (citando el mensaje del bot: "OK …" / "NO motivo"), porque la
// respuesta citada se resuelve por el id de ESE mensaje. En ensayo cada mensaje lleva PREFIJO_ENSAYO (punto 36 de la
// revisión): el equipo no tiene que creer que el bot ya cargó el alta.
import type { Espera, Requisito } from './almacen'

export const PREFIJO_ENSAYO = 'SIMULACIÓN — no se cargó nada'

/** Recorta un texto sin partir un emoji (un surrogate suelto rompe el jsonb de Neon y el JSON que va a Whapi: revisión del
 *  24/10, ronda 2). */
export function recortar(t: string, max: number): string {
  if (t.length <= max) return t
  const partido = /[\ud800-\udbff]/.test(t[max - 1] ?? '') && /[\udc00-\udfff]/.test(t[max] ?? '')
  return t.slice(0, partido ? max - 1 : max)
}

const lista = (xs: string[]) => xs.map((x) => `• ${x}`).join('\n')
const quien = (nombre: string | null) => nombre?.trim() || 'este cliente'

/** Cómo se responde un pedido en Verificaciones C.J, según lo que requiera. */
export function comoResponder(requiere: Requisito[]): string {
  const ok: string[] = []
  if (requiere.includes('cuenta')) ok.push('la cuenta que recibió: "OK Tomi", "OK Gero" u "OK Empresa"')
  if (requiere.includes('mep')) ok.push('el dólar MEP del día anterior: "OK 1450"')
  if (requiere.includes('nombre')) ok.push('"OK" deja el nombre del #ALTA; "OK Nombre Apellido" (con mayúsculas) lo cambia')
  if (requiere.includes('fuente')) ok.push('la fuente: "OK VSL Funnel", "OK Inbound IG", "OK BIO Página Web", "OK Outbound"…')
  const forma = ok.length ? `OK con ${ok.join(' y ')}` : 'OK'
  return `Respondé citando este mensaje: ${forma} para seguir · NO y el motivo para frenar.`
}

export function textoPedidoCloser(nombre: string | null, faltan: string[], ejemplo: string[]): string {
  return [
    `Para dar de alta a ${quien(nombre)} me falta:`,
    lista(faltan),
    '',
    'Respondé citando este mensaje, con una línea por dato. Por ejemplo:',
    ...ejemplo,
  ].join('\n')
}

export function textoPedidoComprobante(nombre: string | null): string {
  return `Recibí el #ALTA de ${quien(nombre)} pero no el comprobante. Mandá la imagen o el PDF citando tu #ALTA.`
}

export function textoRondaVerificaciones(p: { nombre: string | null; closer: string | null; preguntas: string[]; requiere: Requisito[] }): string {
  return [
    `Alta de ${quien(p.nombre)}${p.closer ? ` (closer ${p.closer})` : ''}: antes de seguir hace falta un OK.`,
    lista(p.preguntas),
    '',
    comoResponder(p.requiere),
  ].join('\n')
}

export function textoPedidoEquipo(p: { nombre: string | null; titulo: string; detalle: string[]; ok: string; no: string }): string {
  return [
    `Alta de ${quien(p.nombre)}: ${p.titulo}`,
    ...(p.detalle.length ? [lista(p.detalle)] : []),
    '',
    `Respondé citando este mensaje: OK = ${p.ok} · NO y el motivo = ${p.no}.`,
  ].join('\n')
}

export function textoRecordatorio(e: Pick<Espera, 'pedido' | 'recordatorios'>, nombre: string | null): string {
  return `Recordatorio${e.recordatorios ? ` (${e.recordatorios + 1})` : ''} del alta de ${quien(nombre)}: sigue esperando respuesta.\n${lista(e.pedido)}\n\nRespondé citando este mensaje (o el pedido original).`
}

export function textoVencida(e: Pick<Espera, 'pedido'>, nombre: string | null): string {
  return `Pasaron 14 días sin respuesta en el alta de ${quien(nombre)}: la dejo en pausa.\n${lista(e.pedido)}\nPara retomarla, responder el pedido citándolo (hasta 30 días); después, pedirle a Tomás que la retome (todavía no hay pantalla de altas en el Despacho).`
}

/** Un #ALTA de otro nombre que respondía al #ALTA (o a un pedido) de un alta abierta: se toma como alta nueva (revisión de la
 *  integración, ronda 3: antes pisaba el alta citada). */
export function textoAltaCitandoOtra(nombre: string | null, citada: string | null): string {
  return `Lo tomé como un alta nueva de ${quien(nombre)}: respondía al alta de ${quien(citada)}, pero el nombre es otro. Si querías corregir el nombre del alta de ${quien(citada)}, editá ese #ALTA o respondé su pedido con "Nombre completo: …", y avisá en Verificaciones para frenar esta.`
}
export function textoAvisoAltaCitandoOtra(nombre: string | null, citada: string | null, closer: string | null): string {
  return `Alta de ${quien(nombre)}${closer ? ` (closer ${closer})` : ''}: el #ALTA respondía al alta abierta de ${quien(citada)}, pero con otro nombre. Se tomó como un alta nueva (no se tocó el alta de ${quien(citada)}). Si era una corrección, frenar esta alta.`
}

export const textoDuplicada = (nombre: string | null, estado: string) => `Ya lo tengo: es el alta de ${quien(nombre)} (estado: ${estado}). No hace falta mandarla de nuevo.`
export const textoSumado = (nombre: string | null) => `Lo sumé al alta de ${quien(nombre)}.`
export const TEXTO_CITAR = 'Tenés más de un alta esperando datos: respondé citando el mensaje del bot que corresponde.'
export const TEXTO_NO_VIGENTE = 'Ese pedido ya no está vigente (hubo uno más nuevo o ya se resolvió): citá el último mensaje del bot.'
export const TEXTO_NO_RECONOCIDO = 'No te reconozco para aprobar altas: Tomás tiene que sumar tu número (o tu id) a la lista del bot.'
export const TEXTO_CITAR_COMPROBANTE = 'Tenés más de un alta esperando el comprobante: mandalo citando el #ALTA que corresponde.'
/** Un dato sin citar para un alta que no es la última del closer (revisión del 24/10, ronda 2). */
export const TEXTO_CITAR_DATO_OTRA = 'No sé de qué alta es ese dato (mandaste otro #ALTA después del pedido): respondé citando el mensaje del bot que lo pide.'
/** Un correo suelto ("Mail: …") cuando faltan los de varios socios (revisión del 24/10, ronda 2). */
export const TEXTO_CORREO_SOCIO_AMBIGUO = 'Falta el correo de más de un socio y no sé de quién es ese: respondé citando el pedido con una línea por socio, por ejemplo:\nSocios:\nLaura Gómez · laura@ejemplo.com'
/** La respuesta citó el pedido pero no trae ningún dato que el bot entienda (revisión del 24/10, ronda 2). */
export const TEXTO_DATOS_NO_ENTENDIDOS = 'No encontré ningún dato en tu respuesta: mandá cada uno en su línea "Clave: valor", como en el ejemplo del pedido (por ejemplo "DNI: 30111222"), citando el pedido.'
/** Lo que vino después del "OK" no parece un nombre (revisión del 24/10: "OK, gracias" dejaba al cliente llamado "gracias"). */
export const TEXTO_NOMBRE_NO_ENTENDIDO = 'No entendí el nombre: respondé citando el pedido con "OK" solo para dejar el del #ALTA, o con "OK Nombre Apellido" (con mayúsculas) para cambiarlo.'
export const textoFaltaCuenta = 'Falta la cuenta que recibió: respondé citando el pedido con "OK Tomi", "OK Gero" u "OK Empresa".'
export const textoFaltaFuente = 'Falta la fuente: respondé citando el pedido con "OK" y una de la lista de Finanzas (Inbound IG, Inbound Tiktok, VSL Funnel, BIO Página Web, Referido, Outbound, Webinar o Enrutamiento). Por ejemplo: "OK VSL Funnel".'
export const textoFaltaMep = 'Falta el dólar MEP: respondé citando el pedido con "OK 1450" (el número es el MEP de venta del día anterior al pago).'

export function textoRechazoCloser(nombre: string | null, motivo: string): string {
  return `El alta de ${quien(nombre)} quedó frenada: ${motivo}. Si se corrige, mandá el #ALTA de nuevo citando el anterior.`
}

/** Una corrección (edición o #ALTA citando) de un alta que ya terminó: no se toma (revisión del 24/10). */
export function textoCorreccionFinal(nombre: string | null, estado: string): string {
  if (estado === 'duplicada') return `Ese #ALTA era un reenvío del alta de ${quien(nombre)}: no tomé la corrección. Corregí el #ALTA original (editalo o mandalo de nuevo citándolo).`
  if (estado === 'lista') return `El alta de ${quien(nombre)} ya terminó: no tomé la corrección. Avisá en Verificaciones qué cambió para corregirlo a mano.`
  return `El alta de ${quien(nombre)} está ${estado}: no tomé la corrección. Mandá el #ALTA corregido de nuevo citando el anterior.`
}

export function textoAvisos(nombre: string | null, avisos: string[]): string {
  return `Alta de ${quien(nombre)}:\n${lista(avisos)}`
}

export function textoAvisoSkool(base: string, mencion: string | null): string {
  return mencion ? `@${mencion} ${base}` : base
}

/** Reporte del ensayo en Verificaciones C.J: corto y ordenado (Tomás, 25/10/2026: el volcado paso por paso era un
 *  "choclo"). Qué leyó del comprobante, qué quedaría listo, qué le pediría al closer y qué OK pediría acá. */
export interface ResumenEnsayo {
  nombre: string | null
  closer: string | null
  comprobante: string | null       // "$929.652 del 24/10 a Diaz Rangel" o null si no se leyó
  listos: string[]                 // pasos que quedarían hechos
  pediriaAlCloser: string[]
  pediriaOk: string[]
}
export function textoReporteEnsayo(r: ResumenEnsayo): string {
  const lineas = [
    PREFIJO_ENSAYO,
    `Alta de ${quien(r.nombre)}${r.closer ? ` · closer ${r.closer}` : ''}`,
    '',
    `🧾 Comprobante: ${r.comprobante ?? 'no se pudo leer'}`,
  ]
  if (r.listos.length) lineas.push(`✅ Quedaría listo: ${r.listos.join(', ')}`)
  if (r.pediriaAlCloser.length) lineas.push(`✋ Le pediría al closer: ${r.pediriaAlCloser.join(', ')}`)
  if (r.pediriaOk.length) lineas.push('⚠️ Pediría OK acá:', ...r.pediriaOk.map((x) => `• ${x}`))
  if (!r.pediriaAlCloser.length && !r.pediriaOk.length) lineas.push('Todo en orden: en real se cargaría sin preguntar nada.')
  return lineas.join('\n')
}

export const conPrefijoEnsayo = (texto: string) => (texto.startsWith(PREFIJO_ENSAYO) ? texto : `${PREFIJO_ENSAYO}\n${texto}`)

/** WhatsApp seguro (26/10/2026): el link del grupo General que el closer le pasa al cliente (el bot no lo suma directo).
 *  Va al closer en Ventas C.J, citando su #ALTA. Con el nombre de pila del cliente ("Nadia Blanco" → "Nadia"). */
export function textoLinkCloser(nombre: string | null, link: string): string {
  const pila = nombre?.trim().split(/\s+/)[0] ?? ''
  return `Pasale este link ${pila ? `a ${pila}` : 'al cliente'} para que entre a su grupo: ${link}`
}
