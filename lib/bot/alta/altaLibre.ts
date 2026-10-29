// ── Bot "Capital Jurídico": altas en FORMATO LIBRE (sin la etiqueta #ALTA) ─────────────────────────────────────────────
// Pedido de Tomás (26/10/2026): "esto por ejemplo es un alta, lo identificás por la información, como la cargan así o
// parecido". Ejemplo real (Ventas C.J., closer Yamila):
//     Completa PIF 1299 USD
//     Nombre: Nadia Blanco
//     Tel: +595 975 000001
//     mail: nadia.blanco@example.test
//     CI: 1234567
//     Dirección: Calle Ficticia 123, Ciudad del Este
// PURO: sin red, sin base y sin reloj. Lo usan el webhook (detectar), el parser (las mismas claves), el orquestador y los
// pasos (confirmación, Fee, cliente que ya está en el CRM). Ver docs/BOT-ALTA-CJ.md, "Altas en formato libre".
//
// Reglas (Tomás, 26/10/2026). Desde sus respuestas del mismo día, A, B y C valen IGUAL para el #ALTA (unificado):
//   · DETECCIÓN: un mensaje de Ventas sin #ALTA (y sin citar) es un alta probable si trae un nombre de cliente
//     ("Nombre:" / "Cliente:"), un contacto ("Tel:", "Cel:", "WhatsApp:"… o un correo) y una señal de pago (USD, U$S, $,
//     PIF, cuota, seña, pago, "completa"…). Mayúsculas, acentos, ":" o "-" y el orden no importan.
//   · CONFIRMACIÓN: antes de hacer nada, el bot pregunta en Verificaciones C.J ("¿Esto es un alta? …"). OK sigue igual que
//     un #ALTA; NO la descarta y no se vuelve a preguntar por ese mensaje.
//   · A: si la persona YA está en el CRM de Clientes (por nombre, teléfono o correo), no es un alta: es un pago de un cliente
//     existente y solo se carga en Finanzas (con el OK), como "2da Cuota", "3ra Cuota"… según sus pagos anteriores.
//     FINALIZADO = alta nueva; INACTIVO o sin estado = pago.
//   · Confirman Gero A, Aylu y Gero M: la lista BOT_ALTA_APROBADORES (quien: 'aprobadores').
//   · B: Fee = un pago de menos de USD 500 o, si se sabe, menor que la primera cuota (o que el total de un PIF). Con OK solo
//     se carga en Finanzas y se crea la comunidad de WhatsApp. Nada de CRM, Drive, Skool, bienvenida ni contrato.
//   · C: cuando los pagos del mismo cliente llegan a la primera cuota, se pregunta "¿Sigo con el alta completa?" y con OK
//     sigue el resto del alta.
//   · D: los pagos siguientes se reconocen por el nombre, el teléfono o el correo contra el alta abierta (o el CRM).
import type { AltaParseada } from './parsear'
import { MINIMO_USD, claveDeLinea, correosDe, telefonos } from './parsear'

/** La misma etiqueta que el parser y el webhook. */
const ETIQUETA_ALTA = /#\s*alta\b/i

/** Un comprobante aparte del mismo autor, sin citar, se asocia al alta libre durante este tiempo (Tomás, 26/10/2026). */
export const VENTANA_ADJUNTO_LIBRE_MS = 30 * 60_000

/** Pasos de un Fee en formato libre, con el OK de Verificaciones: Finanzas y la comunidad ("el grupo sí lo podemos armar
 *  sin problema, total después lo podemos borrar rápido"). Nada de Drive, contrato, Skool ni bienvenida. */
export const PASOS_FEE_LIBRE = ['finanzas', 'comunidad'] as const

/** Decisión de Tomás (26/10/2026): el Fee NO da el alta en el CRM de Clientes; el CRM se carga al completar la primera cuota.
 *  Si algún día se cambia a true, crm.ts igual lo frena con menos de USD 500 (bloqueo 'fee'): habría que levantarlo. */
export const FEE_LIBRE_CON_CRM = false

/** Pasos que corren con un Fee libre aprobado (según FEE_LIBRE_CON_CRM). */
export const pasosFeeLibre = (): string[] => (FEE_LIBRE_CON_CRM ? [...PASOS_FEE_LIBRE, 'crm'] : [...PASOS_FEE_LIBRE])

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const normClave = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Claves (normalizadas) de lo que identifica a un alta libre. El parser acepta las mismas (lib/bot/alta/parsear.ts).
const CLAVES_NOMBRE = new Set(['nombre', 'nombre completo', 'nombre y apellido', 'nombre del cliente', 'cliente', 'nombre completo del lead'])
const CLAVES_TELEFONO = new Set(['tel', 'telefono', 'cel', 'celular', 'whatsapp', 'wsp', 'wpp', 'whats app', 'numero', 'telefono del cliente'])
const CLAVES_CORREO = new Set(['mail', 'email', 'e mail', 'correo', 'correo electronico'])

/** "Clave: valor" o "Clave - valor" (también con "–" o "—", viñetas y negritas de WhatsApp). null si no tiene esa forma. */
export function claveValorLibre(linea: string): { clave: string; valor: string } | null {
  const m = /^\s*[*_•·\-–—>]*\s*([\p{L}][\p{L} .º°/]{0,30}?)\s*[*_]*\s*(?::|\s[-–—]\s|[-–—]\s)\s*[*_]*\s*(.*?)\s*[*_]*\s*$/u.exec(linea)
  if (!m) return null
  return { clave: normClave(m[1]), valor: m[2].trim() }
}

/** ¿Parece un nombre de persona? Dos palabras o más, solo letras (sin números ni correos), hasta 60 caracteres. */
export function pareceNombre(valor: string): boolean {
  const v = valor.trim()
  if (!v || v.length > 60 || /[\d@]/.test(v)) return false
  const palabras = v.split(/\s+/).filter((p) => /^\p{L}[\p{L}'’.-]*$/u.test(p))
  return palabras.length >= 2 && palabras.length === v.split(/\s+/).length
}

/** Señal de pago sobre el texto normalizado (sin acentos, en minúscula). "$" seguido de un número también cuenta. */
const RE_SENAL_PAGO = /\b(usd|u\$s|us\$|usdt|dolares?|pif|pp|cuotas?|sena|senas|fee|pagos?|pago|pagado|pagada|pago|abono|abona|abonado|completa|completo|completado|anticipo|transferencia|deposito|ingresa|ingreso)\b|u\$s|us\$|\$\s*\d/
export const tieneSenalPago = (texto: string): boolean => RE_SENAL_PAGO.test(norm(texto))

/** Monto con moneda o con palabra de pago al lado ("1299 USD", "U$S 300", "$1.300", "seña 300", "pago 1000"). */
const RE_MONTO_PAGO = /(\d[\d.,]*)\s*(?:usd|u\$s|us\$|dolares?)\b|(?:usd|u\$s|us\$|\$)\s*(\d[\d.,]*)|\b(?:sena|fee|pago|pagos|abono|abona|anticipo|pif|pp|completa|completo|cuota)\s*(?:de\s*)?(\d{2,}[\d.,]*)/
export const tieneMontoPago = (texto: string): boolean => RE_MONTO_PAGO.test(norm(texto))

export interface LecturaLibre {
  nombre: string | null
  telefono: boolean       // trae un "Tel:" (o Cel, WhatsApp…) con 8 dígitos o más
  correo: boolean         // trae un correo (con o sin "Mail:")
  pago: boolean           // trae una señal de pago
  monto: boolean          // trae un monto pegado a la moneda o a una palabra de pago
}

/** Lo que el detector ve en un mensaje (para los tests y para el log, sin datos personales en el log). */
export function leerLibre(texto: string | null | undefined): LecturaLibre {
  const t = texto ?? ''
  let nombre: string | null = null, telefono = false
  for (const l of t.split(/\r?\n/)) {
    const kv = claveValorLibre(l)
    if (!kv) continue
    if (!nombre && CLAVES_NOMBRE.has(kv.clave) && pareceNombre(kv.valor)) nombre = kv.valor
    if (CLAVES_TELEFONO.has(kv.clave) && telefonos(kv.valor).length) telefono = true
  }
  return { nombre, telefono, correo: correosDe(t).length > 0, pago: tieneSenalPago(t), monto: tieneMontoPago(t) }
}

/** ¿Es un alta probable en formato libre? Sin #ALTA, con nombre de cliente, un contacto y una señal de pago. */
export function esAltaLibre(texto: string | null | undefined): boolean {
  if (!texto || ETIQUETA_ALTA.test(texto)) return false
  const l = leerLibre(texto)
  return !!l.nombre && (l.telefono || l.correo) && l.pago
}

/** ¿Es el pago siguiente de un cliente, sin el contacto? ("Pago 1000 USD\nNombre: Nadia Blanco"). Solo sirve si hay un alta
 *  abierta de esa persona (lo decide el orquestador): sola no alcanza para ser un alta. Regla D (Tomás, 26/10/2026). */
export function esPagoLibre(texto: string | null | undefined): boolean {
  if (!texto || ETIQUETA_ALTA.test(texto)) return false
  const l = leerLibre(texto)
  return !!l.nombre && l.pago && l.monto
}

/** ¿Esta alta nació de un mensaje en formato libre? (el texto original no trae #ALTA). Así no hace falta otra columna. */
export const esAltaLibreFila = (alta: { textoOriginal?: string | null }): boolean => typeof alta.textoOriginal === 'string' && !!alta.textoOriginal.trim() && !ETIQUETA_ALTA.test(alta.textoOriginal)

// ── Pago siguiente de un Fee (reglas C y D) ──

// Lo que identifica al cliente y al plan: pasa del mensaje del Fee al del pago siguiente. "Este pago" y las cuotas no.
const CAMPOS_QUE_PASAN = new Set(['closer', 'programa', 'tipoPago', 'nombre', 'telefono', 'correo', 'direccion', 'dni', 'cuit', 'inicio', 'contrato'])
const RE_SENA = /\b(sena|senas|fee|anticipo|parcial)\b/

/** El texto del pago siguiente de un Fee, con los datos del Fee que no repite ("Pago 1000 USD · Nombre: Nadia Blanco" + el
 *  teléfono, el correo y "PIF 1300 USD" del Fee). Las líneas del mensaje nuevo van primero y mandan: una clave que ya trae
 *  no se copia. Las líneas de seña del Fee ("Seña 300 USD") no pasan. */
export function textoPagoSiguiente(textoNuevo: string, textoFee: string): string {
  const nuevas = textoNuevo.split(/\r?\n/)
  const claves = new Set(nuevas.map((l) => claveDeLinea(l)).filter(Boolean))
  const pasan = textoFee.split(/\r?\n/).filter((l) => {
    if (ETIQUETA_ALTA.test(l)) return false
    const c = claveDeLinea(l)
    if (c) return CAMPOS_QUE_PASAN.has(c) && !claves.has(c)
    // Sin clave: solo el plan ("PIF 1300 USD", "2 cuotas de 1300"), nunca una seña
    return /\b(pif|pp)\b|\bcuotas?\s*de\b/i.test(l) && !RE_SENA.test(norm(l)) && !claves.has('tipoPago')
  })
  return [...nuevas, ...pasan].join('\n')
}

// ── Closer ──

const soloDigitos = (s: string) => s.replace(/\D/g, '')

/** El closer sale del autor del mensaje: su teléfono contra BOT_ALTA_CLOSERS ({ "Yamila": "595…" }). null si no está. */
export function closerDeAutor(autor: { telefono: string | null; lid: string | null }, closers: Record<string, string>): string | null {
  for (const [nombre, x] of Object.entries(closers)) {
    const t = x.trim()
    if (t.includes('@')) { if (autor.lid && autor.lid === t) return nombre; continue }
    const d = soloDigitos(t)
    if (autor.telefono && d.length >= 8 && soloDigitos(autor.telefono).slice(-10) === d.slice(-10)) return nombre
  }
  return null
}

/** El texto con el que nace el alta libre: el del closer, con "Closer: X" arriba si se sabe y el mensaje no lo trae. */
export function textoAltaLibre(texto: string, closer: string | null): string {
  if (!closer || /^\s*closer\s*[:\-–—]/im.test(texto)) return texto
  return `Closer: ${closer}\n${texto}`
}

// ── Primera cuota y Fee (reglas B y C) ──

/** La primera cuota del plan: el total de un PIF o el monto de "N cuotas de X". null si no se puede saber (se pregunta en
 *  Verificaciones al sumar los pagos). Un PP con el cronograma del #ALTA no alcanza: ahí "Cuotas:" lista solo las que faltan. */
export function primeraCuotaDe(a: Pick<AltaParseada, 'modalidad' | 'totalUsd'> & { primeraCuotaUsd?: number | null }): number | null {
  if (a.primeraCuotaUsd != null && a.primeraCuotaUsd > 0) return a.primeraCuotaUsd
  if (a.modalidad === 'PIF' && a.totalUsd != null && a.totalUsd > 0) return a.totalUsd
  return null
}

/** Fee de un alta libre: menos de USD 500 (definición principal) o, si se sabe, menos que la primera cuota. */
export function esFeeLibre(usd: number | null | undefined, primeraCuota: number | null): boolean {
  if (usd == null) return false
  return usd < MINIMO_USD || (primeraCuota !== null && usd < primeraCuota - 1)
}

/** Lo que hace falta juntar para dar el alta completa: la primera cuota si se sabe; si no, el mínimo de USD 500. */
export const umbralAltaCompleta = (primeraCuota: number | null): number => Math.max(MINIMO_USD, primeraCuota ?? 0)

// ── Cliente que ya está en el CRM de Clientes (regla A) ──

export interface ClienteCrm { id: string; nombre: string; celular: string; mail: string; estado: string }
export interface ClienteEncontrado { id: string; nombre: string; estado: string; motivo: 'teléfono' | 'correo' | 'nombre' }

const clavesTel = (cel: string) => cel.split('/').map(soloDigitos).filter((p) => p.length >= 7).map((p) => p.slice(-7))
const normNombre = (s: string) => normClave(s)

/** ¿La persona ya está en el CRM de Clientes? Mismo criterio que los repetidos del alta (lib/clientes/altas.ts): teléfono
 *  por los últimos 7 dígitos, correo exacto o nombre exacto (sin acentos). Un cliente FINALIZADO no cuenta: vuelve como
 *  cliente nuevo y lleva un ID nuevo (como en planAlta). El primero que coincida, prefiriendo ACTIVO y PAUSADO. */
export function buscarClienteEnCrm(clientes: readonly ClienteCrm[], p: { nombre: string | null; telefono: string | null; correo: string | null }): ClienteEncontrado | null {
  const tels = new Set(p.telefono ? clavesTel(p.telefono) : [])
  const correo = (p.correo ?? '').trim().toLowerCase()
  const nom = normNombre(p.nombre ?? '')
  const hallados: ClienteEncontrado[] = []
  for (const c of clientes) {
    if ((c.estado ?? '').toUpperCase() === 'FINALIZADO') continue
    const motivo = clavesTel(c.celular ?? '').some((k) => tels.has(k)) ? 'teléfono'
      : correo && (c.mail ?? '').trim().toLowerCase() === correo ? 'correo'
        : nom.length >= 5 && normNombre(c.nombre ?? '') === nom ? 'nombre' : null
    if (motivo) hallados.push({ id: c.id, nombre: c.nombre, estado: c.estado, motivo })
  }
  return hallados.find((h) => ['ACTIVO', 'PAUSADO'].includes((h.estado ?? '').toUpperCase())) ?? hallados[0] ?? null
}

// ── Textos para Verificaciones C.J ──

// Como lo escriben los closers: "1299", sin punto de miles
const usd = (n: number | null | undefined) => (n == null ? '?' : String(Math.round(n * 100) / 100))

/** "PIF 1299 USD", "PP 2600 USD", "pago de 300 USD" o "sin monto". */
export function resumenPago(a: Pick<AltaParseada, 'modalidad' | 'totalUsd' | 'estePagoUsd'>): string {
  if (a.modalidad && a.totalUsd != null) return `${a.modalidad} ${usd(a.totalUsd)} USD${a.estePagoUsd != null && a.estePagoUsd !== a.totalUsd ? ` (este pago: ${usd(a.estePagoUsd)} USD)` : ''}`
  if (a.estePagoUsd != null) return `pago de ${usd(a.estePagoUsd)} USD`
  return 'sin monto claro'
}

const COMO = 'Respondé citando este mensaje: OK / NO'

export function textoConfirmarAltaLibre(p: { nombre: string | null; closer: string | null; pago: string }): string {
  return `¿Esto es un alta? ${p.nombre ?? '(sin nombre)'} · closer ${p.closer ?? '?'} · ${p.pago}\nLlegó en Ventas C.J. sin #ALTA: con OK sigue como un #ALTA; con NO no hago nada.\n${COMO}`
}

export function textoConfirmarFeeLibre(p: { nombre: string | null; closer: string | null; usd: number | null }): string {
  return `💰 Fee de ${p.nombre ?? '(sin nombre)'} (${usd(p.usd)} USD, closer ${p.closer ?? '?'}). ¿Lo cargo en Finanzas y creo la comunidad?\nCon OK: Finanzas y la comunidad de WhatsApp, nada más (el alta completa sigue al completar la primera cuota). Con NO: no hago nada.\n${COMO}`
}

export function textoConfirmarPagoCliente(p: { nombre: string | null; closer: string | null; usd: number | null; cliente: { id: string; estado: string; motivo: string } }): string {
  return `💳 ${p.nombre ?? '(sin nombre)'} ya está en el CRM de Clientes (${p.cliente.id}, ${p.cliente.estado || 'sin estado'}, por ${p.cliente.motivo}): no es un alta, es un pago de ${usd(p.usd)} USD (closer ${p.closer ?? '?'}). ¿Lo cargo en Finanzas como pago de un cliente existente (la cuota que sigue: 2da, 3ra…, según sus pagos en Finanzas)?\nCon OK: solo Finanzas. Con NO: no hago nada.\n${COMO}`
}

/** Regla C: los pagos llegaron a la primera cuota (o al mínimo, si no se sabe la cuota). */
export function textoCompletoPrimeraCuota(p: { nombre: string | null; pagos: number[]; total: number; primeraCuota: number | null }): string {
  const suma = `${p.pagos.map(usd).join(' + ')} = ${usd(p.total)} USD`
  const titulo = p.primeraCuota !== null
    ? `${p.nombre ?? 'El cliente'} completó la primera cuota (${suma}). ¿Sigo con el alta completa?`
    : `${p.nombre ?? 'El cliente'}: los pagos suman ${suma}, pero no sé de cuánto es la primera cuota. Si con esto la completó, ¿sigo con el alta completa?`
  return `${titulo}\nCon OK: CRM, Drive, Skool, bienvenida y contrato. Con NO: este pago queda como Fee y espero otro.\n${COMO}`
}
