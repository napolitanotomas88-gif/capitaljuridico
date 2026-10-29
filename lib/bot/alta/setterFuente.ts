// ── Bot "Capital Jurídico": Setter y Fuente del cliente (columnas H y K de Finanzas) ──────────────────────────────────
// Decisiones de Tomás:
//   · 24/10/2026: "Setter y Fuente se buscan en el CRM de ventas por el teléfono del lead".
//   · 25/10/2026: (1) lo que escriba el closer en "Setter:" (en el #ALTA o en una respuesta) se acepta si setterAOpcion lo
//     traduce a la lista ("Mai", "Maite" → "Mai"); si no, se le sigue preguntando. (2) La FUENTE la identifica el bot con
//     los 3 UTM del lead (utm_source, utm_medium, utm_campaign), no el closer. Lo que diga el closer en "Fuente:" queda de
//     respaldo (solo si los UTM no alcanzan) y, si no hay forma de saberla, se pregunta en Verificaciones C.J.
// De dónde salen los UTM: el escenario de Make 5924157 ("Calendly CRM - Nuevo flujo con Enrutamiento por Calificación")
// copia `tracking` del invitee de Calendly a la fila que agrega en la pestaña del closer (Ventas, "Closer 1/2/3" y
// "Gero-Xavi Rejunte"). Leído del blueprint el 25/10/2026 y comprobado contra el invitee de Calendly:
//   G "Fuente"  = utm_medium   (paid_social, paid, inbound, ig, enrutamiento, webinar, refe)
//   H "Campaña" = utm_campaign (VSL+Funnel+-+8/3/26, RETARGETING+…, ig, inbound, wsp, zoom, ids de Meta…)
//   I "Video"   = utm_content  (nombre del anuncio)
//   K "Setter"  = utm_source   (ig, fb, mai…; "mai" = la agendó Maite)
// Ojo: los encabezados engañan. La columna "Fuente" del CRM NO es la fuente de Finanzas (es utm_medium) y "Setter" es
// utm_source.
//   · Puro: setterAOpcion, fuenteDeUtm (la regla UTM → fuente), fuenteAOpcion (texto libre → fuente) y elegirFila.
//   · Servidor: buscarSetterFuente lee las pestañas de los closers con leerHojas (lib/crm/sheets/leer.ts: caché de 30 s,
//     solo lectura). Se importa adentro de la función para que el motor y los tests no carguen googleapis.
import { OPCIONES_FUENTE, OPCIONES_SETTER } from './finanzas'

export type OpcionSetter = (typeof OPCIONES_SETTER)[number]
export type OpcionFuente = (typeof OPCIONES_FUENTE)[number]

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Texto del setter (del closer o del CRM de ventas) → opción de la lista de Finanzas. "ENRU…" → "ENRU / Mai"; "Mai",
 *  "Maite" → "Mai"; "Tomi", "Tomás", "Gero" → "Tomi / Gero". Cualquier otro texto: null (se le pregunta al closer). */
export function setterAOpcion(texto: string | null | undefined): OpcionSetter | null {
  const t = normal(texto ?? '')
  if (!t) return null
  const exacta = OPCIONES_SETTER.find((o) => normal(o) === t)
  if (exacta) return exacta
  if (/\benru\b/.test(t)) return 'ENRU / Mai'
  if (/\bmai(te)?\b/.test(t)) return 'Mai'
  if (/\b(tomi|tomas|gero|geronimo)\b/.test(t)) return 'Tomi / Gero'
  return null
}

// ── Fuente ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Utm { source: string; medium: string; campaign: string }

/** Un UTM como lo guarda el CRM ("VSL+Funnel+-+8/3/26", "%C3%A1") → minúsculas, con espacios. Los parámetros de Meta que
 *  no se reemplazaron ("{{site_source_name}}", "{{campaign.name}}") cuentan como vacíos. */
export function utmNormal(s: string | null | undefined): string {
  let t = String(s ?? '').replace(/\+/g, ' ')
  try { t = decodeURIComponent(t) } catch { /* un % suelto: queda como está */ }
  t = t.trim().toLowerCase().replace(/\s+/g, ' ')
  return /^\{\{.*\}\}$/.test(t) ? '' : t
}

export interface FuenteUtm { fuente: OpcionFuente | null; regla: string }

/** La regla UTM → fuente de Finanzas. Sale del cruce del 25/10/2026 entre la columna Fuente de "Registro de Pagos" y los
 *  UTM de los mismos leads en el CRM de ventas (por teléfono; 123 clientes con UTM, 4 más sin UTM):
 *    utm_medium paid_social / paid (anuncios de Meta, cualquier campaña) → VSL Funnel        (51 de 55)
 *    utm_medium inbound (campaña "ig", source "mai")                      → Inbound IG         (35 de 35)
 *    utm_medium ig + campaña "inbound"                                    → Inbound IG         (10 de 11)
 *    utm_medium ig + campaña con "vsl" (el link de la BIO)                → BIO Página Web     (15 de 16)
 *    utm_medium enrutamiento                                              → Enrutamiento       (5 de 5)
 *    utm_medium refe                                                      → Referido           (1 de 1)
 *    utm_medium webinar                                                   → Webinar            (sin casos cruzados: por nombre)
 *  Todo lo demás (sin UTM, ig con otra campaña, medium desconocido) → null: no se adivina. "Outbound" e "Inbound Tiktok" no
 *  tienen UTM propio: nunca salen de acá. */
export function fuenteDeUtm(utm: Partial<Utm> | null | undefined): FuenteUtm {
  const medium = utmNormal(utm?.medium), campaign = utmNormal(utm?.campaign), source = utmNormal(utm?.source)
  if (!medium && !campaign && !source) return { fuente: null, regla: 'el lead no tiene UTM en el CRM de ventas' }
  const desc = `utm_medium "${medium || '—'}", utm_campaign "${campaign || '—'}", utm_source "${source || '—'}"`
  if (medium === 'paid_social' || medium === 'paid') return { fuente: 'VSL Funnel', regla: `${desc}: anuncio pago → VSL Funnel` }
  if (medium === 'inbound') return { fuente: 'Inbound IG', regla: `${desc}: inbound → Inbound IG` }
  if (medium === 'ig') {
    if (campaign === 'inbound') return { fuente: 'Inbound IG', regla: `${desc}: ig + campaña inbound → Inbound IG` }
    if (/\bvsl\b/.test(campaign)) return { fuente: 'BIO Página Web', regla: `${desc}: ig + campaña VSL (link de la BIO) → BIO Página Web` }
    return { fuente: null, regla: `${desc}: con utm_medium "ig" la campaña no alcanza para saber si es Inbound IG o BIO Página Web` }
  }
  if (medium === 'enrutamiento') return { fuente: 'Enrutamiento', regla: `${desc}: enrutamiento → Enrutamiento` }
  if (/^refe(rido|ridos|rida|ridas|rencia)?$/.test(medium)) return { fuente: 'Referido', regla: `${desc}: referido → Referido` }
  if (medium === 'webinar') return { fuente: 'Webinar', regla: `${desc}: webinar → Webinar` }
  return { fuente: null, regla: `${desc}: no hay regla para estos UTM` }
}

// Sinónimos para el texto libre (respaldo del closer, respuesta de un aprobador). Palabras enteras, sin acentos.
const SINONIMOS_FUENTE: [RegExp, OpcionFuente][] = [
  [/\btik ?tok\b/, 'Inbound Tiktok'],
  [/\b(bio|pagina web|web)\b/, 'BIO Página Web'],
  [/\b(vsl|anuncios?|ads|paid|paid social|publicidad|pauta)\b/, 'VSL Funnel'],
  [/\b(instagram|ig|inbound)\b/, 'Inbound IG'],
  [/\b(referid[oa]s?|referencia|refe)\b/, 'Referido'],
  [/\b(enru|enrutamiento|enrutado)\b/, 'Enrutamiento'],
  [/\b(webinar|webi)\b/, 'Webinar'],
  [/\boutbound\b/, 'Outbound'],
]

/** Texto libre ("Fuente: Anuncio", "OK VSL Funnel", "OK Tomi Inbound IG") → una opción de la lista de Finanzas. Primero
 *  busca los nombres exactos de la lista adentro del texto; si no, los sinónimos. Si aparecen dos fuentes distintas
 *  ("anuncio de IG") o ninguna: null (no se adivina). */
export function fuenteAOpcion(texto: string | null | undefined): OpcionFuente | null {
  const t = ` ${normal(texto ?? '')} `
  if (!t.trim()) return null
  const exactas = new Set(OPCIONES_FUENTE.filter((o) => t.includes(` ${normal(o)} `)))
  // "Inbound Tiktok" contiene "inbound": si están las dos, manda la más larga
  if (exactas.has('Inbound Tiktok')) exactas.delete('Inbound IG')
  if (exactas.size === 1) return [...exactas][0]
  if (exactas.size > 1) return null
  const porSinonimo = new Set(SINONIMOS_FUENTE.filter(([re]) => re.test(t)).map(([, o]) => o))
  if (porSinonimo.has('Inbound Tiktok')) porSinonimo.delete('Inbound IG')
  return porSinonimo.size === 1 ? [...porSinonimo][0] : null
}

export const esOpcionFuente = (s: string | null | undefined): s is OpcionFuente => (OPCIONES_FUENTE as readonly string[]).includes(String(s ?? ''))

// ── Búsqueda en el CRM de ventas ─────────────────────────────────────────────────────────────────────────────────

/** Una fila de las pestañas de los closers. `setter` es la columna K (utm_source), `fuente` la G (utm_medium) y `campania`
 *  la H (utm_campaign): ver el comentario de arriba. */
export interface FilaVentas { hoja: string; numeroFila: number; telefono: string; setter: string; fuente: string; campania?: string; email?: string }
export interface SetterFuente {
  setter: OpcionSetter | null; setterTexto: string
  /** La fuente de Finanzas que sale de los UTM ('' si no se pudo identificar). */
  fuente: string
  utm?: Utm
  reglaFuente?: string
  por?: 'telefono' | 'correo'
  hoja: string; fila: number; coincidencias: number
}

/** Últimos 8 dígitos (alcanza para distinguir y tolera "+54 9", "011 15" y demás). */
const cola = (t: string) => t.replace(/\D/g, '').slice(-8)
const correoNormal = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase()

/** La fila del lead por teléfono (si no aparece, por correo). Si hay varias, la de número de fila más alto (la más reciente)
 *  que tenga algún UTM. null si no hay ninguna. */
export function elegirFila(filas: readonly FilaVentas[], telefono: string | null | undefined, correo?: string | null): SetterFuente | null {
  const c = cola(telefono ?? '')
  let iguales: FilaVentas[] = c.length >= 8 ? filas.filter((f) => cola(f.telefono) === c) : []
  let por: 'telefono' | 'correo' = 'telefono'
  const m = correoNormal(correo)
  if (!iguales.length && m.includes('@')) { iguales = filas.filter((f) => correoNormal(f.email) === m); por = 'correo' }
  if (!iguales.length) return null
  const conDatos = iguales.filter((f) => f.setter.trim() || f.fuente.trim() || (f.campania ?? '').trim())
  const f = [...(conDatos.length ? conDatos : iguales)].sort((a, b) => b.numeroFila - a.numeroFila)[0]
  const utm: Utm = { source: f.setter.trim(), medium: f.fuente.trim(), campaign: (f.campania ?? '').trim() }
  const r = fuenteDeUtm(utm)
  return { setter: setterDeUtm(utm), setterTexto: f.setter.trim(), fuente: r.fuente ?? '', utm, reglaFuente: r.regla, por, hoja: f.hoja, fila: f.numeroFila, coincidencias: iguales.length }
}

/** Setter desde los UTM del CRM de ventas (Tomás, 25/10/2026): utm_source "ig" o "fb" → "Tomi / Gero"; un enrutamiento
 *  (utm_medium "enrutamiento") con utm_source "mai" → "ENRU / Mai" (los enrutamientos perdidos que recupera Mai). El resto,
 *  como el texto libre (setterAOpcion). Outbound no se mide: ya no se hace. */
export function setterDeUtm(utm: Utm): OpcionSetter | null {
  const source = normal(utm.source), medium = normal(utm.medium)
  if (medium === 'enrutamiento' && /\bmai(te)?\b/.test(source)) return 'ENRU / Mai'
  if (/^(ig|fb|instagram|facebook)$/.test(source)) return 'Tomi / Gero'
  return setterAOpcion(utm.source)
}

/** Con red (solo servidor): busca el lead en las pestañas de los closers. `leer` se cambia en los tests. */
export async function buscarSetterFuente(telefono: string, op: { correo?: string | null; leer?: () => Promise<FilaVentas[]> } = {}): Promise<SetterFuente | null> {
  const leer = op.leer ?? (async () => {
    const { leerHojas } = await import('../../crm/sheets/leer')
    const { hojasClosers } = await import('../../crm/config')
    const hojas = await leerHojas(hojasClosers())
    return [...hojas.values()].flat().map((f) => ({
      hoja: f.hoja, numeroFila: f.numeroFila, telefono: f.valores.telefono, setter: f.valores.setter, fuente: f.valores.fuente,
      campania: f.valores.campania, email: f.valores.email,
    }))
  })
  return elegirFila(await leer(), telefono, op.correo)
}
