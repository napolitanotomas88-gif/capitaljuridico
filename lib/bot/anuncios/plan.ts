// ── g03 · Plan de campaña desde la ficha de kickoff (en seco: no escribe en Meta) ─────────────────────
// Lo que Valentino arma a mano hoy, propuesto por el bot para que lo revise. Dos fuentes:
//   · la REGLA de estructura de Tomás (24/10/2026, aprobada): depende del presupuesto mensual y de los habitantes de la
//     zona. Zona de menos de MIN_HABITANTES → primero ampliarla. Probar los videos 4 días cuesta videos × tarifa × 4
//     (tarifa por conjunto: USD 3,5 en zonas de hasta 1 millón, 6,5 en las más grandes); si eso pasa del 25 % del
//     mensual, va 1 conjunto con todos los videos ("Broad", diario = mensual / 30, mínimo USD 8); si no, un conjunto por
//     video (ABO). Ejemplos de Tomás: 300 + 500 mil → por video · 300 + 6 millones → todos juntos · 600 + 6 millones → por video;
//   · cómo las arma Valentino HOY (4 campañas reales del 22–23/10, leídas por Graph): «Rama | DM-WPP | ABO | dd/mm/aa [USD
//     N/MES]», objetivo Interacción, conjuntos «n- Broad | Zona radio km | 18-64 | USD X/día | dd/mm» que optimizan
//     conversaciones con destino WhatsApp, pines con radio, 18–64, Advantage+ apagado, solo Facebook e Instagram, solo
//     celular, anuncios con «Enviar mensaje de WhatsApp» y todas las mejoras de Meta apagadas.
// Ver la memoria reference_estrategia_campanas_clientes y docs/BOT-ANUNCIOS-CJ.md. Puro: los habitantes los estima
// estimarHabitantes (Claude) o vienen a mano.
import type { Rama } from '@/lib/anuncios/ramas'
import { escaparDiscord } from '@/lib/fathomAnuncios/mensaje'

export const MIN_HABITANTES = 400_000
export const ZONA_GRANDE = 1_000_000
export const TARIFA_CONJUNTO_USD = { chica: 3.5, grande: 6.5 }
export const DIAS_TESTEO = 4
export const TOPE_TESTEO = 0.25
export const MIN_DIARIO_USD = 8

export const RAMA_CORTA: Record<Rama, string> = {
  laboral: 'Laboral', art: 'ART', transito: 'Accidentes de tránsito', geriatrico: 'Geriátrico', salud: 'Salud', previsional: 'Previsional',
  familia: 'Familia', sucesiones: 'Sucesiones', penal: 'Penal', consumidor: 'Consumidor', internacional: 'Ciudadanías', empresas: 'Empresas',
}

export interface EntradaPlan {
  cliente: string
  rama: Rama | null
  mensualUSD: number | null
  zona: string                     // etiqueta corta para los nombres ("San Juan", "Córdoba capital 40 km")
  habitantes: number | null
  videos: string[]                 // nombre de cada video (el gancho), en el orden en que se lanzan
  fecha: string                    // AAAA-MM-DD del lanzamiento previsto
}

export type Estructura = 'por_video' | 'todos_juntos'
export interface ConjuntoPlan { nombre: string; diarioUSD: number; anuncios: string[] }
export interface PlanCampana {
  estructura: Estructura
  ampliarZona: boolean
  motivo: string
  campana: string
  conjuntos: ConjuntoPlan[]
  diarioTotalUSD: number
  testeoUSD: number | null         // lo que se gasta en los 4 días de prueba
  configuracion: string[]          // lo fijo, igual que hoy
  avisos: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
const fechaCorta = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(2, 4)}`
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
export const miles = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} millones` : `${Math.round(n / 1000)} mil`)

export const CONFIGURACION = [
  'Objetivo Interacción · presupuesto por conjunto (ABO) · puja de menor costo',
  'Conjuntos: optimizar conversaciones · destino WhatsApp · atribución 7 días clic',
  'Público: pines con radio según la ficha (nunca "Ciudad Autónoma" sola, sin excluir zonas) · 18–64 · Advantage+ apagado',
  'Ubicaciones: solo Facebook e Instagram · solo celular',
  'Anuncio: video subido (no publicación) · recorte cuadrado que muestre el recuadro · «Enviar mensaje de WhatsApp» · título «Chatea con nosotros» · todas las mejoras de Meta y el multianunciante apagados',
  'Saludo de WhatsApp: «Hola, ¿cómo estás? ¿Querés comentarme de dónde sos y qué situación estás atravesando?» (sin botón de llamada)',
]

/** La regla de Tomás: cuánto cuesta probar y si va un conjunto por video o todos juntos. */
export function decidirEstructura(mensualUSD: number | null, habitantes: number | null, videos: number, unidad: 'videos' | 'anuncios' = 'videos'): { estructura: Estructura; ampliarZona: boolean; tarifa: number; testeoUSD: number | null; motivo: string } {
  const tarifa = habitantes !== null && habitantes > ZONA_GRANDE ? TARIFA_CONJUNTO_USD.grande : TARIFA_CONJUNTO_USD.chica
  const ampliarZona = habitantes !== null && habitantes < MIN_HABITANTES
  const n = Math.max(1, videos)
  const testeo = r2(n * tarifa * DIAS_TESTEO)
  if (mensualUSD === null || mensualUSD <= 0) return { estructura: 'todos_juntos', ampliarZona, tarifa, testeoUSD: null, motivo: 'Sin presupuesto mensual en la ficha: no se puede calcular; por las dudas, todos juntos.' }
  const [uno, varios] = unidad === 'anuncios' ? ['anuncio', 'anuncios'] : ['video', 'videos']
  if (n === 1) return { estructura: 'todos_juntos', ampliarZona, tarifa, testeoUSD: null, motivo: `Un solo ${uno}: un solo conjunto.` }
  const pct = testeo / mensualUSD
  const zona = habitantes === null ? 'zona sin habitantes estimados (se toma como chica)' : `zona de ~${miles(habitantes)} de habitantes`
  const cuenta = `probar ${n} ${varios} ${DIAS_TESTEO} días a ${usd(tarifa)} por conjunto = ${usd(testeo)}, el ${Math.round(pct * 100)} % de ${usd(mensualUSD)}/mes (${zona})`
  return pct <= TOPE_TESTEO
    ? { estructura: 'por_video', ampliarZona, tarifa, testeoUSD: testeo, motivo: `Un conjunto por ${uno}: ${cuenta}, entra en el 25 %.` }
    : { estructura: 'todos_juntos', ampliarZona, tarifa, testeoUSD: testeo, motivo: `Todos juntos: ${cuenta}, pasa del 25 %: el presupuesto no alcanza para probarlos por separado.` }
}

export function armarPlan(e: EntradaPlan): PlanCampana {
  const d = decidirEstructura(e.mensualUSD, e.habitantes, e.videos.length)
  const ramaTxt = e.rama ? RAMA_CORTA[e.rama] : 'General'
  const campana = `${ramaTxt} | DM-WPP | ABO | ${fechaCorta(e.fecha)} [${e.mensualUSD ? `USD ${e.mensualUSD}` : 'USD ?'}/MES]`
  const zona = e.zona.trim() || 'zona sin definir'
  // Nombre del anuncio = el gancho, corto (como los nombra Valentino: «4-¿Te chocaron yendo al trabajo en moto?»)
  const corto = (v: string) => (v.length > 60 ? `${v.slice(0, 57).trimEnd()}…` : v)
  const videos = (e.videos.length ? e.videos : ['(video 1)']).map(corto)
  const conjuntos: ConjuntoPlan[] = d.estructura === 'por_video'
    ? videos.map((v, i) => ({ nombre: `${i + 1}- Broad | ${zona} | 18-64 | USD ${d.tarifa}/día | ${dm(e.fecha)}`, diarioUSD: d.tarifa, anuncios: [`${i + 1}- ${v}`] }))
    : (() => {
      const diario = Math.max(MIN_DIARIO_USD, Math.ceil((e.mensualUSD ?? 0) / 30))
      return [{ nombre: `Broad | ${zona} | 18-64 | USD ${diario}/día | ${dm(e.fecha)}`, diarioUSD: diario, anuncios: videos.map((v, i) => `${i + 1}- ${v}`) }]
    })()
  const diarioTotal = r2(conjuntos.reduce((s, c) => s + c.diarioUSD, 0))
  const avisos: string[] = []
  if (d.ampliarZona) avisos.push(`La zona tiene ~${miles(e.habitantes!)} de habitantes (menos de ${miles(MIN_HABITANTES)}): antes de lanzar, ver con Tomi de ampliarla.`)
  if (e.habitantes === null) avisos.push('No hay habitantes estimados de la zona: la estructura sale solo por presupuesto.')
  if (!e.mensualUSD) avisos.push('La ficha no tiene presupuesto mensual: confirmarlo con Tomi.')
  if (!e.rama) avisos.push('La ficha no tiene rama: el nombre va con «General».')
  if (e.mensualUSD && d.estructura === 'por_video') avisos.push(`Después de los ${DIAS_TESTEO} días de prueba hay que bajar el gasto para cerrar el mes en ${usd(e.mensualUSD)} (queda ~${usd(Math.max(0, r2((e.mensualUSD - (d.testeoUSD ?? 0)) / 26)))}/día).`)
  return { estructura: d.estructura, ampliarZona: d.ampliarZona, motivo: d.motivo, campana, conjuntos, diarioTotalUSD: diarioTotal, testeoUSD: d.testeoUSD, configuracion: CONFIGURACION, avisos }
}

/** El plan como texto para Discord / la ficha (≤ 2000). */
export function textoPlan(p: PlanCampana, cliente: string, valentino: string | null): string {
  const lineas = [
    `${valentino ? `<@${valentino}> ` : ''}📋 **Plan de campaña · ${escaparDiscord(cliente)}** (propuesta del bot: revisala antes de armar)`,
    `**${p.estructura === 'por_video' ? `${p.conjuntos.length} conjuntos, un video cada uno` : `1 conjunto con los ${p.conjuntos[0].anuncios.length} videos`}** · ${usd(p.diarioTotalUSD)}/día · ${escaparDiscord(p.motivo)}`,
    `🗂️ Campaña: ${escaparDiscord(p.campana)}`,
    ...p.conjuntos.flatMap(c => [`• ${escaparDiscord(c.nombre)}`, ...(p.estructura === 'todos_juntos' ? c.anuncios.map(a => `   ◦ ${escaparDiscord(a)}`) : [])]),
    ...p.avisos.map(a => `⚠️ ${escaparDiscord(a)}`),
    `⚙️ ${p.configuracion.map(escaparDiscord).join(' · ')}`,
  ]
  let t = lineas.join('\n')
  if (t.length > 1900) t = `${t.slice(0, 1890)}…`
  return t
}
