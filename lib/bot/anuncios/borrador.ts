// ── g03 · Borrador en Meta (EN PAUSA) para los videos nuevos de una rotación ────────────────────────
// Pedido de Tomás (25–26/10/2026), después de la prueba con Carlos Oliva: que el aviso de videos nuevos (g01, videos.ts)
// llegue con el borrador ya armado, para cualquier cliente. Valen lo revisa y lo prende: NADA se prende solo.
//   · Solo rotaciones (la cuenta gastó en los últimos 7 días). Los lanzamientos siguen con el plan de la ficha (plan.ts).
//   · Molde: el conjunto ACTIVO que más gastó en 7 días (campaña ABO: con presupuesto de campaña no se arma) y su anuncio
//     activo que más gastó. Del conjunto se copian la zona, las edades, las ubicaciones, el objetivo y el destino; del
//     anuncio, la página, Instagram, el botón de WhatsApp, el mensaje de bienvenida y las mejoras de Meta (sin
//     standard_enhancements: Meta ya no lo acepta) y el copy (⚠️ es el del ganador: Valen lo ajusta al video).
//   · Crea: los videos (por link de Drive), 1 conjunto nuevo con todos juntos y 1 anuncio por video, TODO con status PAUSED.
//     Sin attribution_spec (con este objetivo Meta solo acepta la ventana por defecto).
//   · APAGADO por defecto: solo con ANUNCIOS_BORRADOR=real; ANUNCIOS_BORRADOR_SOLO=<act_…,act_…> lo limita a esas cuentas.
// Token: META_ANUNCIOS_TOKEN (usuario de Gero A en dashboard-skwd, con ads_management), en la cabecera, nunca en la URL ni
// en un log. Fetch inyectable: los tests nunca llaman a Meta. Tira con un motivo corto si algo falla (lo muestra el aviso).
import type { FilaAnuncio } from '@/lib/anuncios/tablero'
import type { Subida } from './videos'

export const GRAPH = 'https://graph.facebook.com/v23.0'
export const TOPE_PEDIDO_MS = 20_000
export const ESPERA_VIDEO_PASO_MS = 5_000
// Monedas sin centavos para Meta (los montos van en la unidad entera)
const SIN_CENTAVOS = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'])

export const borradorEncendido = (env: NodeJS.ProcessEnv = process.env): boolean => env.ANUNCIOS_BORRADOR?.trim() === 'real'
export const borradorPermitido = (cuenta: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  const solo = new Set((env.ANUNCIOS_BORRADOR_SOLO ?? '').split(',').map(s => s.trim()).filter(s => /^act_\d+$/.test(s)))
  return borradorEncendido(env) && (!solo.size || solo.has(cuenta))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Graph devuelve objetos heterogéneos; los campos requeridos se validan al elegir el molde.
type Json = Record<string, any>
export interface Graph { get(ruta: string, q?: Record<string, string>): Promise<Json>; post(ruta: string, cuerpo: Record<string, unknown>): Promise<Json> }

export function crearGraph(token: string, f: typeof fetch = fetch): Graph {
  const pedir = async (url: string, init: RequestInit) => {
    const r = await f(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TOPE_PEDIDO_MS), cache: 'no-store' })
    const j = (await r.json().catch(() => ({}))) as Json
    if (!r.ok || j.error) {
      const e = j.error ?? {}
      throw new Error(`Meta #${e.code ?? r.status}: ${String(e.error_user_msg || e.message || 'error').replace(/access_token=[^&\s]+/gi, '[oculto]').slice(0, 180)}`)
    }
    return j
  }
  return {
    get: (ruta, q = {}) => pedir(`${GRAPH}/${ruta}?${new URLSearchParams(q)}`, { method: 'GET' }),
    post: (ruta, cuerpo) => {
      const b = new URLSearchParams()
      for (const [k, v] of Object.entries(cuerpo)) b.set(k, typeof v === 'string' ? v : JSON.stringify(v))
      return pedir(`${GRAPH}/${ruta}`, { method: 'POST', body: b })
    },
  }
}

const gasto7 = (x: Json) => Number(x.insights?.data?.[0]?.spend ?? 0)

/** «CABA + radio», «Córdoba», «Mendoza + 2 zonas»: la zona del molde para el nombre del conjunto. */
export function zonaDe(t: Json): string {
  const g = t?.geo_locations ?? {}
  const nombres: string[] = [...(g.cities ?? []).map((c: Json) => c.name === 'Buenos Aires' && /aut[oó]noma/i.test(c.region ?? '') ? 'CABA' : c.name),
    ...(g.regions ?? []).map((r: Json) => r.name), ...(g.zips ?? []).map((z: Json) => z.name)].filter(Boolean)
  const pines = (g.custom_locations ?? []).length
  const base = nombres.slice(0, 2).join(' + ') || (pines ? `${pines} ${pines === 1 ? 'zona' : 'zonas'}` : (g.countries ?? []).join(' + ') || 'zona')
  return nombres.length && pines ? `${base} + radio` : base
}

/** La zona del nombre que le puso Valen al conjunto («2 -Broad | San Miguel 10 km | 18-64 | …» → «San Miguel 10 km»), o null. */
export function zonaDeNombre(nombre: string): string | null {
  const p = nombre.split('|').map(x => x.trim())
  return p.length >= 3 && /broad/i.test(p[0]) && p[1] && !/^\d{1,2}\s*-\s*\d{1,2}\+?$/.test(p[1]) ? p[1] : null
}

/** Monto diario en la moneda de la cuenta, en la unidad que pide Meta. */
export function montoMeta(usd: number, usdPor: number, moneda: string): number {
  const local = usd * usdPor
  return SIN_CENTAVOS.has(moneda.toUpperCase()) ? Math.round(local) : Math.round(local * 100)
}

export interface Molde { campana: { id: string; name: string }; conjunto: Json; anuncio: Json }

/** El conjunto activo que más gastó en 7 días (de una campaña ABO) y su anuncio activo que más gastó, con video. */
export async function leerMolde(g: Graph, cuenta: string): Promise<Molde> {
  const sets = await g.get(`${cuenta}/adsets`, {
    fields: 'id,name,effective_status,campaign{id,name,daily_budget,lifetime_budget},optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,targeting,insights.date_preset(last_7d){spend}',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]), limit: '100',
  })
  const activos = ((sets.data ?? []) as Json[]).sort((a, b) => gasto7(b) - gasto7(a))
  if (!activos.length) throw new Error('la cuenta no tiene conjuntos activos para copiar')
  const abo = activos.find(s => !s.campaign?.daily_budget && !s.campaign?.lifetime_budget)
  if (!abo) throw new Error('la campaña activa tiene presupuesto de campaña (CBO): el conjunto nuevo va a mano')
  // El anuncio: el de video simple (video_data) que más gastó, primero en ese conjunto y si no en toda la cuenta. Los que
  // Valen arma con una versión del video por ubicación (asset_feed_spec) no sirven de molde para un video solo.
  const campos = { fields: 'id,name,effective_status,creative{object_story_spec,degrees_of_freedom_spec},insights.date_preset(last_7d){spend}', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]), limit: '100' }
  const mejor = (x: Json) => ((x.data ?? []) as Json[]).filter(a => a.creative?.object_story_spec?.video_data).sort((a, b) => gasto7(b) - gasto7(a))[0]
  const anuncio = mejor(await g.get(`${abo.id}/ads`, campos)) ?? mejor(await g.get(`${cuenta}/ads`, campos))
  if (!anuncio) throw new Error('la cuenta no tiene ningún anuncio activo de un solo video para copiar el formato (los de video por ubicación van a mano)')
  return { campana: { id: abo.campaign.id, name: abo.campaign.name }, conjunto: abo, anuncio }
}

export interface ConjuntoBorrador { id: string; nombre: string; anuncios: string[] }
export interface Borrador {
  campana: string; campanaId: string; nueva: boolean; conjuntos: ConjuntoBorrador[]; diarioLocal: number; diarioUSD: number; link: string; faltan: string[]
  motivo?: string                // por qué esa estructura (regla de Tomás), para el renglón 📐 del aviso
  conjuntoId: string; conjunto: string; anuncios: string[]   // el primero (compatibilidad con el texto de una sola línea)
}
export interface DepsBorrador { graph: Graph; esperar(ms: number): Promise<void>; ahora(): number }
/** Cómo se arma: un conjunto con todos los videos o uno por video (regla de Tomás, plan.ts) y el diario de CADA conjunto. */
export interface EstructuraBorrador { porVideo: boolean; diarioUSD: number }
/** Un video a cargar: el archivo de Drive y, si se pudo escribir desde el guion, su copy (copys.ts). */
export interface VideoBorrador { nombre: string; drive: string; copy: string | null; guion: string | null }

const ddmm = (ms: number) => new Date(ms).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })
const ddmmaa = (ms: number) => new Date(ms).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: '2-digit' })
export const sinExtension = (s: string) => s.replace(/\.[a-z0-9]{2,4}$/i, '')
/** El nombre del anuncio = el gancho del copy (su primera línea, sin flechas ni emojis al final), como los nombra Valen. */
export const nombreAnuncio = (copy: string, n: number) => `${n}- ${copy.split('\n')[0].replace(/[\s⬇️⚠️🚨💬👇]+$/u, '').trim().slice(0, 80)}`
const usdTxt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

/** El error de Meta cuando la página no tiene WhatsApp vinculado (pasó con Lucas Quiroga y Herchhoren el 27/10). */
export const sinWhatsApp = (m: string) => /no est[aá] vinculada a una cuenta de WhatsApp|not (?:linked|connected) to a WhatsApp/i.test(m)
export const MOTIVO_SIN_WHATSAPP = 'la página no está vinculada a WhatsApp: reconectá el WhatsApp de la página o armá los conjuntos desde el Administrador (los videos ya quedaron subidos)'

export interface PlantillaConjunto { billing_event: string; optimization_goal: string; destination_type: string; bid_strategy: string; promoted_object: Json; targeting: Json; zona: string }
export interface PlantillaAnuncio { page_id: string; instagram_user_id?: string; video_data: Json; mejoras: Json }

/**
 * El corazón de g03: sube los videos, crea (si hace falta) la campaña y los conjuntos y un anuncio por video, TODO en
 * PAUSED, y lo relee para verificar. Lo usan las rotaciones (armarBorrador, molde de la cuenta) y los lanzamientos
 * (lanzamiento.ts, desde la ficha). Tira con un motivo corto; nunca prende nada.
 */
export async function crearEnPausa(cuenta: string, x: {
  campana: { id: string; name: string } | { crear: string }
  conjunto: PlantillaConjunto; anuncio: PlantillaAnuncio
  videos: VideoBorrador[]; estructura: EstructuraBorrador; tanda: number | null; diarioLocal: number
}, deps: DepsBorrador, deadline: number): Promise<Borrador> {
  // Cada pedido respeta el tiempo que queda; un copy lento no puede iniciar escrituras fuera del plazo del cron.
  const conTiempo = () => { if (deps.ahora() + TOPE_PEDIDO_MS > deadline) throw new Error('se acabó el tiempo para armar el borrador en Meta') }
  const g: Graph = {
    get: (ruta, q) => { conTiempo(); return deps.graph.get(ruta, q) },
    post: (ruta, cuerpo) => { conTiempo(); return deps.graph.post(ruta, cuerpo) },
  }
  const faltan: string[] = []
  // 1) Videos (Meta los baja de Drive: la carpeta «Clientes» está compartida por enlace)
  const vids: { nombre: string; id: string; v: VideoBorrador }[] = []
  for (const v of x.videos) {
    const r = await g.post(`${cuenta}/advideos`, { name: sinExtension(v.nombre), file_url: `https://drive.usercontent.google.com/download?id=${v.drive}&export=download&confirm=t` })
    vids.push({ nombre: sinExtension(v.nombre), id: String(r.id), v })
  }
  for (const v of vids) {
    for (;;) {
      const st = await g.get(v.id, { fields: 'status' })
      if (st.status?.video_status === 'ready') break
      if (st.status?.video_status === 'error') throw new Error(`Meta no pudo procesar «${v.nombre}»`)
      if (deps.ahora() + ESPERA_VIDEO_PASO_MS > deadline) throw new Error('los videos quedaron subidos pero Meta no terminó de procesarlos a tiempo: los conjuntos van a mano')
      await deps.esperar(ESPERA_VIDEO_PASO_MS)
    }
  }
  // 2) Campaña: la activa (rotación) o una nueva, EN PAUSA (lanzamiento: ABO, objetivo Interacción)
  const nueva = 'crear' in x.campana
  const campana = 'crear' in x.campana
    ? { id: String((await g.post(`${cuenta}/campaigns`, { name: x.campana.crear, objective: 'OUTCOME_ENGAGEMENT', special_ad_categories: [], buying_type: 'AUCTION', status: 'PAUSED', is_adset_budget_sharing_enabled: false })).id), name: x.campana.crear }
    : x.campana
  // 3) Conjuntos en pausa: uno por video o uno con todos
  const t = x.conjunto.targeting
  const grupos = x.estructura.porVideo ? vids.map(v => [v]) : [vids]
  const edad = `${t.age_min ?? 18}-${t.age_max ?? 65}`
  const conjuntos: ConjuntoBorrador[] = []
  let n = 0
  for (const [i, grupo] of grupos.entries()) {
    const nombre = `${x.estructura.porVideo ? `${i + 1}- ` : ''}Broad | ${x.conjunto.zona} | ${edad} | USD ${usdTxt(x.estructura.diarioUSD)}/día | Tanda ${x.tanda ?? '?'} | ${nueva ? ddmmaa(deps.ahora()) : ddmm(deps.ahora())}`
    let set: Json
    try {
      set = await g.post(`${cuenta}/adsets`, {
        name: nombre, campaign_id: campana.id, status: 'PAUSED', daily_budget: String(x.diarioLocal),
        billing_event: x.conjunto.billing_event, optimization_goal: x.conjunto.optimization_goal, destination_type: x.conjunto.destination_type,
        bid_strategy: x.conjunto.bid_strategy, promoted_object: x.conjunto.promoted_object, targeting: t,
      })
    } catch (e) {
      if (sinWhatsApp(String((e as Error).message))) throw new Error(MOTIVO_SIN_WHATSAPP)
      throw e
    }
    // 4) Un anuncio por video, en pausa: el copy del guion, o el del molde con aviso
    const anuncios: string[] = []
    for (const v of grupo) {
      n++
      const th = await g.get(`${v.id}/thumbnails`, { fields: 'uri,is_preferred' })
      const uri = ((th.data ?? []) as Json[]).find(z => z.is_preferred)?.uri ?? th.data?.[0]?.uri
      const vd: Json = { ...x.anuncio.video_data, video_id: v.id, image_url: uri, ...(v.v.copy ? { message: v.v.copy } : {}) }
      delete vd.image_hash
      const nombreAd = v.v.copy ? nombreAnuncio(v.v.copy, n) : v.nombre
      const cr = await g.post(`${cuenta}/adcreatives`, {
        name: `${v.nombre} · Tanda ${x.tanda ?? '?'}`,
        object_story_spec: { page_id: x.anuncio.page_id, ...(x.anuncio.instagram_user_id ? { instagram_user_id: x.anuncio.instagram_user_id } : {}), video_data: vd },
        degrees_of_freedom_spec: { creative_features_spec: x.anuncio.mejoras }, contextual_multi_ads: { enroll_status: 'OPT_OUT' },
      })
      const ad = await g.post(`${cuenta}/ads`, { name: nombreAd, adset_id: set.id, creative: { creative_id: cr.id }, status: 'PAUSED' })
      anuncios.push(String(ad.id))
    }
    conjuntos.push({ id: String(set.id), nombre, anuncios })
  }
  // 5) Verificación: todo tiene que haber quedado en pausa
  if (nueva) {
    const c = await g.get(campana.id, { fields: 'status' })
    if (c.status !== 'PAUSED') throw new Error(`¡la campaña ${campana.id} no quedó en pausa! Revisala ya`)
  }
  for (const c of conjuntos) {
    const chk = await g.get(c.id, { fields: 'status,ads{status}' })
    if (chk.status !== 'PAUSED' || ((chk.ads?.data ?? []) as Json[]).some(a => a.status !== 'PAUSED')) throw new Error(`¡el conjunto ${c.id} no quedó en pausa! Revisalo ya`)
  }
  const sinCopy = vids.filter(v => !v.v.copy).map(v => v.nombre)
  if (sinCopy.length) faltan.push(`${sinCopy.length === vids.length ? 'el copy' : `el copy de ${sinCopy.join(', ')}`} es el del anuncio ganador: ajustalo al video`)
  const conGuion = vids.filter(v => v.v.copy && v.v.guion).map(v => `${v.nombre} ← ${v.v.guion}`)
  if (conGuion.length) faltan.push(`copys escritos desde el guion (${conGuion.join(' · ')}): confirmá que cada guion sea el de su video`)
  const act = cuenta.replace(/^act_/, '')
  return {
    campana: campana.name, campanaId: campana.id, nueva, conjuntos, diarioLocal: x.diarioLocal, diarioUSD: x.estructura.diarioUSD, faltan,
    link: nueva ? `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${act}&selected_campaign_ids=${campana.id}` : `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_adset_ids=${conjuntos.map(c => c.id).join(',')}`,
    conjuntoId: conjuntos[0]?.id ?? '', conjunto: conjuntos[0]?.nombre ?? '', anuncios: conjuntos.flatMap(c => c.anuncios),
  }
}

/** Rotación: el molde es la propia cuenta (conjunto y anuncio que más gastan). */
export async function armarBorrador(s: Subida, fila: FilaAnuncio, videos: VideoBorrador[], estructura: EstructuraBorrador, deps: DepsBorrador, deadline: number): Promise<Borrador> {
  if (!fila.usdPor) throw new Error('no tengo la cotización de la moneda de la cuenta')
  const m = await leerMolde(deps.graph, fila.id)
  const c = m.conjunto, oss = m.anuncio.creative.object_story_spec
  const mejoras = { ...(m.anuncio.creative.degrees_of_freedom_spec?.creative_features_spec ?? {}) }
  delete mejoras.standard_enhancements
  return crearEnPausa(fila.id, {
    campana: m.campana,
    conjunto: { billing_event: c.billing_event, optimization_goal: c.optimization_goal, destination_type: c.destination_type, bid_strategy: c.bid_strategy, promoted_object: c.promoted_object, targeting: c.targeting ?? {}, zona: zonaDeNombre(String(c.name ?? '')) ?? zonaDe(c.targeting) },
    anuncio: { page_id: oss.page_id, instagram_user_id: oss.instagram_user_id, video_data: oss.video_data, mejoras },
    videos, estructura, tanda: s.numero, diarioLocal: montoMeta(estructura.diarioUSD, fila.usdPor, fila.moneda),
  }, deps, deadline)
}
