// ── Ficha de kickoff que no se pierde: kickoffs en Fathom con más de 48 h y sin ficha «lista» ─────────────────────────
// Pedido de Tomás (3/11/2026): una kickoff del 10/10 nunca llegó al bot (el webhook no la entregó) y su ficha se armó recién
// 24 días después, a mano (POST /api/bot/kickoff?recording_id=…&quien=…). Ahora, en la corrida de las 9:05:
//   · se listan las reuniones de los últimos DIAS_MIRAR días de cada cuenta de Fathom con API key (Tomás, Gero M);
//   · las que parecen una reunión con un cliente («<Cliente> y Tomas Napolitano», o con invitados de afuera; nunca las
//     internas: Daily, Weekly, Team…), con más de HORAS_PERDIDA horas y SIN fila final en cj_kickoffs (lista, no_kickoff,
//     omitida, duplicada) son «perdidas»;
//   · UN aviso en #📝-kickoff con las nuevas (una vez por grabación: kickoff-perdida:<id> en cj_anuncios_avisos), mencionando a
//     Tomás y a Gero M;
//   · REINTENTO automático: el mismo POST manual que funcionó, como mucho MAX_REINTENTOS por corrida y una sola vez por
//     grabación (kickoff-reintento:<id>), con &sin_guiones=1: una kickoff vieja ya suele tener guiones hechos a mano, así
//     que el reintento NO arranca la tanda (si le faltan: POST /api/bot/guiones {recording_id}). Si no era una kickoff, el
//     bot la marca no_kickoff y no vuelve a salir.
// Desde el 3/11 (pedido de Tomás): solo kickoffs de los últimos DIAS_MIRAR (30) días y que NO tengan campaña ya lanzada (el
// cliente del título gasta en el tablero o tiene campaña en su cuenta en los últimos 120 días): esas ni se reintentan ni se avisan.
// KICKOFF_PERDIDAS=0 lo apaga. Con dry no reclama, no avisa ni reintenta. Nunca tira.
import type { ReunionListada } from './fathomApi'
import type { Quien } from './grabadores'
import type { Tablero } from '@/lib/anuncios/tablero'

export const HORAS_PERDIDA = 48
export const DIAS_MIRAR = 30
export const MAX_REINTENTOS = 3
const FINALES = new Set(['lista', 'no_kickoff', 'omitida', 'duplicada'])
const INTERNA = /\b(daily|weekly|team|equipo|impromptu|interna|standup|skwd|skyward|capacitaci[oó]n|onboarding interno)\b/i

export type Listada = ReunionListada & { quien: Quien }
export interface Perdida extends Listada { estado: string | null; horas: number }

/** ¿Parece una reunión con un cliente? (no las internas; «X y Tomas…» de Calendly o con invitados de afuera) Puro. */
export function pareceKickoff(r: Pick<ReunionListada, 'titulo' | 'externos'>): boolean {
  if (INTERNA.test(r.titulo)) return false
  if (r.externos === false) return false
  return /\S\s+y\s+\S/i.test(r.titulo) || r.externos === true
}

/** Las perdidas: parecen kickoff, tienen más de HORAS_PERDIDA horas (y menos de DIAS_MIRAR días) y no tienen fila final. Puro. */
export function kickoffsPerdidas(rs: readonly Listada[], estados: ReadonlyMap<number, string>, ahora: number): Perdida[] {
  const vistas = new Set<number>()
  const out: Perdida[] = []
  for (const r of rs) {
    if (vistas.has(r.recording_id)) continue
    vistas.add(r.recording_id)
    const t = r.creada ? Date.parse(r.creada) : NaN
    if (!Number.isFinite(t)) continue
    const horas = (ahora - t) / 3_600_000
    if (horas < HORAS_PERDIDA || horas > DIAS_MIRAR * 24) continue
    const estado = estados.get(r.recording_id) ?? null
    if (estado && FINALES.has(estado)) continue
    if (!pareceKickoff(r)) continue
    out.push({ ...r, estado, horas: Math.round(horas) })
  }
  return out.sort((a, b) => b.horas - a.horas)
}

/** El cliente del título de Fathom: «Juana Pérez y Tomas Napolitano» → «Juana Pérez». Puro. */
export function clienteDelTitulo(titulo: string): string | null {
  const t = titulo.replace(/\b(kick\s*-?off|reuni[oó]n|onboarding)\b/gi, ' ').replace(/^[\s\-–|:]+/, '').trim()
  const m = t.match(/^(.+?)\s+y\s+/i)
  const n = (m ? m[1] : t).trim()
  return n.length >= 3 ? n : null
}

const ddmm = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' }) : '¿?')
const esc = (s: string) => s.replace(/([*_~`|>\\])/g, '\\$1')
const NOMBRE: Record<string, string> = { tomas: 'Tomás', gero_m: 'Gero M' }

/** El aviso de #📝-kickoff con las nuevas. '' = nada nuevo. Puro. */
export function textoPerdidas(nuevas: Perdida[], reintentadas: Set<number>, menciones: string[]): string {
  if (!nuevas.length) return ''
  const lineas = [`${menciones.map(m => `<@${m}>`).join(' ')}${menciones.length ? ' ' : ''}🕳️ **Kickoffs sin ficha** · más de ${HORAS_PERDIDA} h en Fathom y la ficha no está lista (${nuevas.length})`]
  for (const p of nuevas) {
    const estado = p.estado ? `quedó «${p.estado}»` : 'el bot nunca la recibió'
    lineas.push(`• **${esc(p.titulo || `grabación ${p.recording_id}`)}** · ${ddmm(p.creada)} · Fathom de ${NOMBRE[p.quien] ?? p.quien} · ${estado}${reintentadas.has(p.recording_id) ? ' · 🔁 la reintenté sola (sin arrancar guiones)' : ' · se reintenta en la próxima corrida'}${p.url ? ` · [Fathom](<${p.url}>)` : ''}`)
  }
  lineas.push('Si alguna no era una kickoff, el bot la descarta solo. Si a un cliente le faltan los guiones: POST /api/bot/guiones {recording_id}.')
  let txt = lineas.join('\n')
  while (txt.length > 1900 && lineas.length > 3) { lineas.splice(lineas.length - 2, 1); txt = `${lineas.join('\n')}\n…` }
  return txt.slice(0, 1900)
}

export interface DepsPerdidas {
  quienes(): Quien[]
  listar(quien: Quien, desde: string): Promise<ReunionListada[]>
  estados(ids: number[]): Promise<Map<number, string>>
  reclamar(clave: string, d: { tipo: string; cuenta: string; campana_id: string; cliente: string; texto_cliente: null }): Promise<boolean>
  marcarEnviado(clave: string, id: string): Promise<void>
  soltar(clave: string): Promise<void>
  reintentar(id: number, quien: Quien): Promise<void>
  /** ¿El cliente de esta reunión ya tiene campaña lanzada? null = no se sabe (no se cruzó con nadie). */
  conCampana?(p: Perdida): Promise<boolean | null>
  enviar(texto: string, menciones: string[]): Promise<string>
  menciones: string[]
  ahora(): number
}
export interface ResultadoPerdidas { conCampana?: number[]; perdidas: { recording_id: number; titulo: string; quien: string; creada: string | null; estado: string | null }[]; nuevas: number[]; reintentadas: number[]; texto: string; enviado: boolean; errores: string[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 200)

export async function vigilarKickoffs(deps: DepsPerdidas, op: { dry?: boolean } = {}): Promise<ResultadoPerdidas> {
  const errores: string[] = []
  const desde = new Date(deps.ahora() - DIAS_MIRAR * 86_400_000).toISOString()
  const todas: Listada[] = []
  for (const q of deps.quienes()) {
    try { todas.push(...(await deps.listar(q, desde)).map(r => ({ ...r, quien: q }))) } catch (e) { errores.push(`Fathom de ${NOMBRE[q] ?? q}: ${motivo(e)}`) }
  }
  let estados: Map<number, string>
  try { estados = await deps.estados([...new Set(todas.map(r => r.recording_id))]) } catch (e) { return { perdidas: [], nuevas: [], reintentadas: [], texto: '', enviado: false, errores: [...errores, `base: ${motivo(e)}`] } }
  const candidatas = kickoffsPerdidas(todas, estados, deps.ahora())
  // Las de clientes con campaña ya lanzada: fuera (ni reintento ni aviso)
  const perdidas: Perdida[] = [], conCampana: number[] = []
  for (const p of candidatas) {
    let con: boolean | null = null
    if (deps.conCampana) { try { con = await deps.conCampana(p) } catch (e) { errores.push(`campañas de «${p.titulo}»: ${motivo(e)}`) } }
    if (con === true) conCampana.push(p.recording_id); else perdidas.push(p)
  }
  const resumen = perdidas.map(p => ({ recording_id: p.recording_id, titulo: p.titulo, quien: p.quien, creada: p.creada, estado: p.estado }))
  if (op.dry) return { conCampana, perdidas: resumen, nuevas: perdidas.map(p => p.recording_id), reintentadas: [], texto: textoPerdidas(perdidas, new Set(), deps.menciones), enviado: false, errores }
  // Reintento: una vez por grabación, como mucho MAX_REINTENTOS por corrida
  const reintentadas = new Set<number>()
  for (const p of perdidas) {
    if (reintentadas.size >= MAX_REINTENTOS) break
    try {
      if (!await deps.reclamar(`kickoff-reintento:${p.recording_id}`, { tipo: 'kickoff-reintento', cuenta: '', campana_id: String(p.recording_id), cliente: p.titulo.slice(0, 120), texto_cliente: null })) continue
      await deps.reintentar(p.recording_id, p.quien)
      reintentadas.add(p.recording_id)
    } catch (e) { errores.push(`reintento ${p.recording_id}: ${motivo(e)}`) }
  }
  // El aviso: solo las que no se avisaron antes
  const nuevas: Perdida[] = []
  for (const p of perdidas) {
    try { if (await deps.reclamar(`kickoff-perdida:${p.recording_id}`, { tipo: 'kickoff-perdida', cuenta: '', campana_id: String(p.recording_id), cliente: p.titulo.slice(0, 120), texto_cliente: null })) nuevas.push(p) }
    catch (e) { errores.push(`reclamar ${p.recording_id}: ${motivo(e)}`) }
  }
  const texto = textoPerdidas(nuevas, reintentadas, deps.menciones)
  if (!texto) return { conCampana, perdidas: resumen, nuevas: [], reintentadas: [...reintentadas], texto: '', enviado: false, errores }
  try {
    const id = await deps.enviar(texto, deps.menciones)
    for (const p of nuevas) await deps.marcarEnviado(`kickoff-perdida:${p.recording_id}`, id).catch(() => {})
    return { conCampana, perdidas: resumen, nuevas: nuevas.map(p => p.recording_id), reintentadas: [...reintentadas], texto, enviado: true, errores }
  } catch (e) {
    errores.push(`discord: ${motivo(e)}`)
    for (const p of nuevas) await deps.soltar(`kickoff-perdida:${p.recording_id}`).catch(() => {})
    return { conCampana, perdidas: resumen, nuevas: nuevas.map(p => p.recording_id), reintentadas: [...reintentadas], texto, enviado: false, errores }
  }
}

/** Las dependencias reales. Solo servidor. */
export async function depsPerdidasReales(tablero?: Pick<Tablero, 'filas' | 'porLanzar' | 'porLanzarEsperando'>): Promise<DepsPerdidas> {
  const [{ listarReuniones, claveApi }, { QUIENES }, reg, avisos, entorno, { enviarDiscord }] = await Promise.all([
    import('./fathomApi'), import('./grabadores'), import('./registro'), import('@/lib/bot/anuncios/registro'), import('./entorno'), import('@/lib/fathomAnuncios/discord'),
  ])
  const mk = entorno.mencionesKickoff()
  const webhook = entorno.webhookKickoff()
  const secreto = process.env.CRON_SECRET?.trim() || ''
  return {
    quienes: () => QUIENES.filter(q => !!claveApi(q)),
    listar: (q, desde) => listarReuniones(q, { creadoDesde: desde }),
    estados: ids => reg.estadosKickoff(ids),
    reclamar: avisos.reclamarAviso,
    marcarEnviado: avisos.marcarAvisoEnviado,
    soltar: avisos.soltarAviso,
    // El mismo POST manual que funcionó a mano; corre en su propia invocación (hasta 300 s). Se espera poco: si el corte
    // es por tiempo, el proceso sigue del otro lado; un rechazo (4xx/5xx inmediato) sí se informa.
    reintentar: async (id, quien) => {
      if (!secreto) throw new Error('falta CRON_SECRET')
      try {
        const r = await fetch(`${entorno.urlDespacho()}/api/bot/kickoff?recording_id=${id}&quien=${quien}&sin_guiones=1`, { method: 'POST', headers: { authorization: `Bearer ${secreto}` }, signal: AbortSignal.timeout(8_000), cache: 'no-store' })
        if (r.status >= 400 && r.status !== 504) throw new Error(`el reintento respondió ${r.status}`)
      } catch (e) {
        const n = (e as Error)?.name
        if (n !== 'TimeoutError' && n !== 'AbortError') throw e
      }
    },
    enviar: async (texto, menciones) => {
      if (!webhook) throw new Error('falta DISCORD_WEBHOOK_KICKOFF')
      return (await enviarDiscord(webhook, [texto], menciones))[0] ?? ''
    },
    menciones: [mk.tomi, mk.gero_m].filter((x): x is string => !!x),
    ahora: () => Date.now(),
    conCampana: tablero ? async p => {
      const { cruzarNombreDoc } = await import('@/lib/bot/anuncios/docAds')
      const { tieneCampanaReciente } = await import('@/lib/bot/anuncios/docAdsServidor')
      const nombre = clienteDelTitulo(p.titulo)
      if (!nombre) return null
      const xs = [...tablero.filas.map(f => ({ cliente: f.clienteCRM ?? f.cliente, pl: null })), ...[...tablero.porLanzar, ...(tablero.porLanzarEsperando ?? [])].map(pl => ({ cliente: pl.cliente, pl }))]
      const c = cruzarNombreDoc(nombre, xs)
      if (!c || c.fuerza !== 'firme') return null
      return c.x.pl ? tieneCampanaReciente(c.x.pl) : true   // con fila en el tablero = gasta
    } : undefined,
  }
}

export const perdidasEncendido = (): boolean => process.env.KICKOFF_PERDIDAS?.trim() !== '0'

/** Lo que llama la alerta de las 9:05. Nunca tira. */
export async function correrKickoffsPerdidas(op: { dry?: boolean; tablero?: Pick<Tablero, 'filas' | 'porLanzar' | 'porLanzarEsperando'> } = {}): Promise<ResultadoPerdidas | { apagado: true }> {
  if (!perdidasEncendido()) return { apagado: true }
  try { return await vigilarKickoffs(await depsPerdidasReales(op.tablero), op) } catch (e) { return { perdidas: [], nuevas: [], reintentadas: [], texto: '', enviado: false, errores: [motivo(e)] } }
}
