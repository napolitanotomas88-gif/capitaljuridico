// ── g03 · Lanzamiento desde la ficha de kickoff: la campaña entera EN PAUSA ─────────────────────────
// Alcance aprobado (27/10/2026, Hub + Tomás): cuando un cliente que todavía no gasta tiene videos editados y ficha de
// kickoff, el bot arma la campaña nueva en pausa para que Valen la revise y la prenda. Nunca prende nada.
//   · Cuenta: la de la ficha (la que el tablero ve). Página e Instagram: las páginas que la cuenta puede promocionar (o, si
//     no devuelve ninguna, las del portfolio de la cuenta); si hay varias, la que comparte palabras con el cliente; si no queda una sola, no arma.
//   · Zona: cada lugar de la ficha buscado en Meta (adgeolocation, país de la ficha o AR) con el radio de la ficha; si no se
//     ubica ninguno, no arma.
//   · Estructura: la regla de Tomás (plan.ts) con el presupuesto mensual de la ficha y los habitantes estimados (Claude,
//     habitantes.ts). Nomenclatura de Valen: «Rama | DM-WPP | ABO | dd/mm/aa [USD N/MES]».
//   · Conjunto como los de Valen: conversaciones a WhatsApp, 18–64, Advantage+ apagado, FB+IG, solo celular. Anuncio:
//     «Enviar mensaje de WhatsApp», título «Chatea con nosotros», el saludo de plan.ts y todas las mejoras apagadas. Sin
//     copy desde el guion no arma (un cliente nuevo no tiene ganador del que copiar).
import type { PorLanzar } from '@/lib/anuncios/tablero'
import { DIAS_TESTEO, MIN_DIARIO_USD, decidirEstructura } from './plan'
import { crearEnPausa, montoMeta, type Borrador, type DepsBorrador, type Graph, type VideoBorrador } from './borrador'
import type { Subida } from './videos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Payloads de Meta: la selección de página, país y zona valida los datos usados.
type Json = Record<string, any>
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const palabras = (s: string) => normal(s).split(/[^a-zñ0-9]+/).filter(w => w.length >= 3 && !['estudio', 'juridico', 'abogado', 'abogada', 'abogados', 'asociados', 'legal'].includes(w))

export const MEJORAS_APAGADAS = Object.fromEntries(['ads_with_benefits', 'advantage_plus_creative', 'enhance_cta', 'inline_comment', 'pac_relaxation', 'show_destination_blurbs', 'text_optimizations', 'video_auto_crop', 'video_filtering', 'video_uncrop'].map(k => [k, { enroll_status: 'OPT_OUT' }]))
const SALUDO = 'Hola, ¿cómo estás? ¿Querés comentarme de dónde sos y qué situación estás atravesando?'
export const BIENVENIDA = JSON.stringify({
  type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text',
  text_format: { customer_action_type: 'autofill_message', message: { text: SALUDO, autofill_message: { content: '¡Hola! Quiero más información.' } } },
  user_edit: true, surface: 'visual_editor_new',
})

/** El presupuesto mensual en USD de la ficha: primero el que dice «por mes»; si no, el diario × 30; si no, el número suelto.
 *  «USD 8 por día (hasta 10) · ~USD 240 por mes» → 240 · «USD 10 por día» → 300 · «USD 300» → 300. null si no se entiende. */
export function mensualDeFicha(texto: string): number | null {
  const t = normal(texto).replace(/(\d)\.(\d{3})/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2')
  const num = (x: string | undefined) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null }
  const MON = '(?:usd|u\\$s|us\\$|\\$|dolares)'
  const mes = t.match(new RegExp(`${MON}\\s*([\\d.]+)\\s*(?:\\/|por|al|x)?\\s*(?:mes|mensual)`)) ?? t.match(/([\d.]+)\s*(?:usd|dolares)\s*(?:\/|por|al|x)?\s*(?:mes|mensual)/)
  if (mes && num(mes[1])) return num(mes[1])
  const dia = t.match(new RegExp(`${MON}\\s*([\\d.]+)\\s*(?:\\/|por|al|x)?\\s*(?:dia|diario)`)) ?? t.match(/([\d.]+)\s*(?:usd|dolares)\s*(?:\/|por|al|x)?\s*(?:dia|diario)/)
  if (dia && num(dia[1])) return Math.round(num(dia[1])! * 30)
  const suelto = t.match(new RegExp(`${MON}\\s*([\\d.]+)`)) ?? t.match(/([\d.]+)\s*(?:usd|dolares)/)
  return suelto ? num(suelto[1]) : null
}

/** La página: la única que puede promocionar la cuenta, o la que comparte palabras con el cliente. */
export function elegirPagina(paginas: Json[], cliente: string): Json | null {
  if (paginas.length === 1) return paginas[0]
  const ps = new Set(palabras(cliente))
  const con = paginas.filter(p => palabras(String(p.name ?? '')).some(w => ps.has(w)))
  return con.length === 1 ? con[0] : null
}

/**
 * La zona en Meta: cada lugar buscado (ciudad, barrio, partido o provincia) con el radio de la ficha. Como hay lugares con
 * el mismo nombre en varias provincias («Pedernal» está en San Juan y en Entre Ríos), primero se elige la provincia: la
 * que comparten más lugares (y suma si la ficha la nombra); después cada lugar se toma solo de esa provincia.
 */
export async function geoDeFicha(g: Graph, lugares: string[], radioKm: number | null, pais: string, pista = ''): Promise<{ geo: Json; ubicados: string[]; sinUbicar: string[] }> {
  const geo: Json = {}, ubicados: string[] = [], sinUbicar: string[] = []
  const buscados: { q: string; opciones: Json[] }[] = []
  for (const l of lugares.slice(0, 10)) {
    const q = l.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()   // «Tres Esquinas (de oído, verificar)» → «Tres Esquinas»
    if (!q) continue
    const r = await g.get('search', { type: 'adgeolocation', q, location_types: JSON.stringify(['city', 'subcity', 'neighborhood', 'region']), country_code: pais, limit: '10' })
    buscados.push({ q, opciones: ((r.data ?? []) as Json[]).filter(x => x?.key) })
  }
  const region = (x: Json) => String(x.type === 'region' ? x.name : x.region ?? '')
  const puntos = new Map<string, number>()
  const p = normal(pista)
  for (const b of buscados) for (const r of new Set(b.opciones.map(region).filter(Boolean))) puntos.set(r, (puntos.get(r) ?? 0) + 1 + (p.includes(normal(r)) ? 0.5 : 0))
  for (const r of puntos.keys()) if (p.includes(normal(r))) puntos.set(r, (puntos.get(r) ?? 0) + 1)
  const elegida = [...puntos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  for (const b of buscados) {
    const x = b.opciones.find(o => !elegida || region(o) === elegida)
    if (!x) { sinUbicar.push(b.q); continue }
    ubicados.push(`${x.name}${x.type !== 'region' && x.region ? ` (${x.region})` : ''}`)
    if (x.type === 'city') (geo.cities ??= []).push({ key: x.key, radius: Math.min(80, Math.max(10, radioKm ?? 10)), distance_unit: 'kilometer' })
    else if (x.type === 'region') (geo.regions ??= []).push({ key: x.key })
    else if (x.type === 'subcity') (geo.subcities ??= []).push({ key: x.key })
    else (geo.neighborhoods ??= []).push({ key: x.key })
  }
  if (ubicados.length) geo.location_types = ['home', 'recent']
  return { geo, ubicados, sinUbicar }
}

export interface DepsLanzamiento extends DepsBorrador {
  usdPor(moneda: string): number | null
  habitantes(pl: PorLanzar): Promise<number | null>
}

export async function armarLanzamiento(s: Subida, pl: PorLanzar, videos: VideoBorrador[], deps: DepsLanzamiento, deadline: number): Promise<Borrador> {
  const k = pl.kickoff
  if (!k?.cuenta) throw new Error('la ficha no tiene la cuenta de Meta identificada')
  const pais = k.zona.pais?.trim().toUpperCase()
  if (!pais || !/^[A-Z]{2}$/.test(pais)) throw new Error('falta confirmar el país de la zona en la ficha')
  const mensual = mensualDeFicha(k.presupuesto.texto)
  if (!mensual || k.presupuesto.aConfirmar) throw new Error('falta confirmar el presupuesto mensual de la ficha')
  const sinCopy = videos.filter(v => !v.copy).map(v => v.nombre)
  if (sinCopy.length) throw new Error(`falta el copy de ${sinCopy.join(', ')} (no encontré su guion): un cliente nuevo no tiene anuncio del que copiar`)
  const g = deps.graph, cuenta = k.cuenta.id
  const cta = await g.get(cuenta, { fields: 'currency,account_status' })
  if (cta.account_status !== 1) throw new Error(`la cuenta no está activa en Meta (estado ${cta.account_status})`)
  const usdPor = deps.usdPor(String(cta.currency ?? 'USD'))
  if (!usdPor) throw new Error(`no tengo la cotización de ${cta.currency}`)
  // Las páginas que la cuenta promociona; si no devuelve ninguna (pasa con cuentas nuevas), las del portfolio de la cuenta
  let pags = ((await g.get(`${cuenta}/promote_pages`, { fields: 'id,name,instagram_business_account{id}', limit: '25' })).data ?? []) as Json[]
  if (!pags.length) {
    const b = (await g.get(cuenta, { fields: 'business{owned_pages.limit(25){id,name,instagram_business_account{id}},client_pages.limit(25){id,name,instagram_business_account{id}}}' })).business ?? {}
    pags = [...(b.owned_pages?.data ?? []), ...(b.client_pages?.data ?? [])] as Json[]
  }
  const pagina = elegirPagina(pags, pl.cliente)
  if (!pagina) throw new Error(`no sé qué página usar (${pags.length} páginas en la cuenta y su portfolio)`)
  const lugares = k.zona.lugares.length ? k.zona.lugares : [k.zona.descripcion].filter(Boolean)
  const pista = [k.zona.descripcion, k.zona.presentarse?.texto ?? '', k.cuenta.nombre ?? '', pl.cliente].join(' ')
  const { geo, ubicados, sinUbicar } = await geoDeFicha(g, lugares, k.zona.radioKm, pais, pista)
  if (!ubicados.length) throw new Error('no pude ubicar en Meta ningún lugar de la zona de la ficha')
  let habitantes: number | null = null
  try { habitantes = await deps.habitantes(pl) } catch { habitantes = null }
  const d = decidirEstructura(mensual, habitantes, videos.length)
  const diarioUSD = d.estructura === 'por_video' ? d.tarifa : Math.max(MIN_DIARIO_USD, Math.ceil((mensual ?? 0) / 30))
  const hoy = new Date(deps.ahora()).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: '2-digit' })
  const zona = `${ubicados[0].replace(/\s*\(.*\)$/, '')}${ubicados.length > 1 ? ` +${ubicados.length - 1}` : ''}${k.zona.radioKm ? ` ${k.zona.radioKm} km` : ''}`
  const b = await crearEnPausa(cuenta, {
    campana: { crear: `${k.rama.nombre ?? 'General'} | DM-WPP | ABO | ${hoy} [${mensual ? `USD ${mensual}` : 'USD ?'}/MES]` },
    conjunto: {
      billing_event: 'IMPRESSIONS', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      promoted_object: { page_id: pagina.id }, zona,
      targeting: {
        age_min: 18, age_max: 64, geo_locations: geo, targeting_automation: { advantage_audience: 0 },
        publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed', 'story', 'facebook_reels', 'profile_feed'],
        instagram_positions: ['stream', 'story', 'reels', 'profile_feed'], device_platforms: ['mobile'],
      },
    },
    anuncio: {
      page_id: pagina.id, instagram_user_id: pagina.instagram_business_account?.id, mejoras: MEJORAS_APAGADAS,
      video_data: { title: 'Chatea con nosotros', call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP', link: 'https://api.whatsapp.com/send' } }, page_welcome_message: BIENVENIDA },
    },
    videos, estructura: { porVideo: d.estructura === 'por_video', diarioUSD }, tanda: s.numero, diarioLocal: montoMeta(diarioUSD, usdPor, String(cta.currency ?? 'USD')),
  }, deps, deadline)
  b.motivo = d.motivo
  if (d.estructura === 'por_video' && mensual) b.faltan.push(`después de los ${DIAS_TESTEO} días de prueba hay que bajar el gasto para cerrar el mes en USD ${mensual}`)
  if (d.ampliarZona) b.faltan.push('la zona tiene menos de 400 mil habitantes: ver con Tomás de ampliarla antes de prender')
  b.faltan.push(`zona cargada en Meta: ${ubicados.join(', ')}${k.zona.radioKm ? ` (radio ${k.zona.radioKm} km)` : ''}: verificá que sean esos lugares`)
  if (sinUbicar.length) b.faltan.push(`no ubiqué en Meta: ${sinUbicar.join(', ')} (sumalos a mano)`)
  if (!mensual) b.faltan.push('la ficha no tiene presupuesto mensual claro: confirmalo con Tomás')
  if (k.frenos.some(f => f.frena)) b.faltan.push(`el portfolio tiene frenos (${k.frenos.filter(f => f.frena).map(f => f.nombre).join(', ')}): no lo prendas hasta resolverlos`)
  return b
}
