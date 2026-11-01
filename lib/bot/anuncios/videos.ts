// ── g01 · Videos nuevos en «Editados - X» → aviso a Valentino en #📣-ads ─────────────────────────────
// Pedido de Tomás (25/10/2026, con la prueba en seco de Carlos Oliva aprobada): que el bot detecte solo los videos que
// René sube a «Editados - X» (carpeta del cliente en Drive «Clientes») y le avise a Valen con lo que tiene que cargar.
//   · Dónde mira: «Editados - X» y sus subcarpetas directas («2° Tanda», «Renovación»…). Una subcarpeta es una tanda; los
//     videos sueltos en la raíz cuentan como otra.
//   · Cuándo avisa: una vez por SUBIDA. La subida se da por terminada cuando pasaron CIERRE_HORAS sin videos nuevos en esa
//     carpeta (René sube de a uno). Si después caen más en la misma carpeta, sale otro aviso solo con los nuevos: la clave
//     guarda hasta qué video se avisó (`videos:<carpeta>:<createdTime del último>`).
//   · Desde cuándo: solo videos subidos después de ANUNCIOS_VIDEOS_DESDE (por defecto el 26/10/2026), así el primer día
//     no salen las tandas viejas que Valen ya cargó a mano.
//   · Qué dice (formato aprobado): 🔁 rotación si la cuenta del cliente gastó en los últimos 7 días (propuesta: 1 conjunto
//     nuevo en la campaña activa con todos los videos juntos, al diario que deja cerrar el mes en el presupuesto, mínimo
//     USD 3), 🚀 «Para lanzar» si todavía no lanzó (desde el 26/10 es EL aviso de lanzamiento: la kickoff ya no avisa; lleva
//     lo de la ficha que Valen necesita: cuenta, rama, a quién, zona, presupuesto, fecha, WhatsApp y lo del portfolio que
//     frena), y ⚠️ lo que falte (cuenta de Meta,
//     presupuesto, ficha).
//   · Con ANUNCIOS_BORRADOR=real, en las rotaciones el aviso llega con el borrador YA ARMADO en Meta, en pausa (g03,
//     borrador.ts): la propuesta se reemplaza por el link para revisarlo. Si no se pudo armar, va la propuesta y el motivo.
//     Desde el 27/10 (3:2:2 desde el 1/11: ideas de 3 videos con los mismos 2 textos y 2 títulos): conjunto por idea o todos juntos según la regla de Tomás, copy escrito desde el guion (copys.ts) y,
//     en los lanzamientos con ficha, la campaña nueva entera en pausa (lanzamiento.ts). Si la página no tiene WhatsApp, ⛔.
// El texto se arma acá (puro); Drive, la base y Discord entran por deps. Con dry no escribe nada. Nunca tira.
import type { FilaAnuncio, PorLanzar, Tablero } from '@/lib/anuncios/tablero'
import type { KickoffPorLanzar } from '@/lib/anuncios/porLanzar'
import { escaparDiscord } from '@/lib/fathomAnuncios/mensaje'
import { RAMA_CORTA, decidirEstructura } from './plan'
import { MOTIVO_SIN_WHATSAPP, cantidadAnuncios, type Borrador, type EstructuraBorrador } from './borrador'

export const CIERRE_HORAS = 12
export const DIAS_VENTANA = 14                 // más viejo que esto no se avisa nunca (la carpeta se cerró hace rato)
export const DESDE_POR_DEFECTO = '2026-10-26T03:00:00.000Z'   // 26/10/2026 00:00 en Argentina
export const MIN_CONJUNTO_USD = 3
export const MAX_AVISOS_VIDEOS = 10

export interface VideoDrive { id: string; nombre: string; creado: string }          // creado = createdTime (ISO)
export interface CarpetaTanda { id: string; nombre: string; videos: VideoDrive[] }   // subcarpeta o la raíz de Editados
export interface EditadosCliente { carpetaCliente: string; editadosId: string; guionesDoc?: string | null; tandas: CarpetaTanda[] }

export interface Subida {
  clave: string; carpetaId: string; carpetaCliente: string; cliente: string; tanda: string; numero: number | null
  videos: VideoDrive[]; hasta: string; guionesDoc?: string | null
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const IGNORAR = new Set(['estudio', 'juridico', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'dra', 'dr', 'skwd'])
const palabras = (s: string) => normal(s).split(/[^a-zñ0-9]+/).filter(w => w.length >= 3 && !IGNORAR.has(w))
export const sinSufijo = (s: string) => s.replace(/\s*-\s*(skwd|c\.?\s*j\.?|capital jur[ií]dico)\s*$/i, '').trim()

export const desdeVideos = (env: NodeJS.ProcessEnv = process.env): string => {
  const d = env.ANUNCIOS_VIDEOS_DESDE?.trim()
  return d && !Number.isNaN(Date.parse(d)) ? new Date(d).toISOString() : DESDE_POR_DEFECTO
}

/** «2° Tanda» → 2 · «tanda 3» → 3 · «Renovación» → null. */
export function numeroTanda(nombre: string): number | null {
  const m = nombre.match(/(\d{1,2})\s*[°ºª]?\s*tanda/i) ?? nombre.match(/tanda\s*(\d{1,2})/i)
  return m ? Number(m[1]) : null
}

/** La clave del último aviso de cada carpeta → hasta qué video ya se avisó. */
export const hastaDeClave = (clave: string): string | null => clave.match(/^videos:[^:]+:(.+)$/)?.[1] ?? null

/**
 * Las subidas terminadas que todavía no se avisaron. `avisadoHasta` = por carpeta, el createdTime del último video ya
 * avisado (de la base). Puro.
 */
export function subidasNuevas(clientes: EditadosCliente[], avisadoHasta: Map<string, string>, ahora: number, desde: string): Subida[] {
  const out: Subida[] = []
  const piso = Math.max(Date.parse(desde), ahora - DIAS_VENTANA * 86_400_000)
  for (const c of clientes) {
    for (const t of c.tandas) {
      const ya = avisadoHasta.get(t.id)
      const nuevos = t.videos.filter(v => Date.parse(v.creado) >= piso && (!ya || v.creado > ya)).sort((a, b) => a.creado.localeCompare(b.creado))
      if (!nuevos.length) continue
      const hasta = nuevos[nuevos.length - 1].creado
      // Todavía está subiendo: algún video (también uno viejo de la carpeta) es de hace menos de CIERRE_HORAS
      const ultimo = t.videos.reduce((m, v) => (v.creado > m ? v.creado : m), '')
      if (ahora - Date.parse(ultimo) < CIERRE_HORAS * 3_600_000) continue
      const cliente = sinSufijo(c.carpetaCliente)
      out.push({ clave: `videos:${t.id}:${hasta}`, carpetaId: t.id, carpetaCliente: c.carpetaCliente, cliente, tanda: t.id === c.editadosId ? 'sin carpeta de tanda' : t.nombre.trim(), numero: numeroTanda(t.nombre), videos: nuevos, hasta, guionesDoc: c.guionesDoc ?? null })
    }
  }
  return out.sort((a, b) => a.hasta.localeCompare(b.hasta))
}

/**
 * La fila del tablero (o el cliente por lanzar) de esta carpeta: el que comparte más palabras con el nombre de la
 * carpeta («Carlos Oliva - SKWD» ↔ «Carlos Oliva»). Tiene que ser uno solo; empate o nada = null.
 */
export function cruzarCliente<T extends { cliente: string }>(carpeta: string, xs: T[]): T | null {
  const ps = new Set(palabras(sinSufijo(carpeta)))
  if (!ps.size) return null
  let mejor: T | null = null, puntos = 0, empate = false
  for (const x of xs) {
    const n = palabras(x.cliente).filter(w => ps.has(w)).length
    if (n > puntos) { mejor = x; puntos = n; empate = false } else if (n && n === puntos && x !== mejor) empate = true
  }
  return puntos && !empate ? mejor : null
}

/** El cruce se apoya en una sola palabra de varias («Bautista & Guido» ↔ «Bautista Escudero»): que Valen lo confirme. */
export function cruceParcial(carpeta: string, cliente: string): boolean {
  const ps = palabras(sinSufijo(carpeta)), cs = new Set(palabras(cliente))
  return ps.length > 1 && ps.filter(w => cs.has(w)).length === 1
}

const usd = (n: number) => `USD ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Diario del conjunto nuevo: lo que deja cerrar el mes en el presupuesto, sacando lo que ya gasta la cuenta. */
export function diarioConjunto(f: Pick<FilaAnuncio, 'presupuesto'>): { usd: number; calculado: boolean } {
  const { ajusteDiarioUSD: ajuste, realDiarioUSD: real } = f.presupuesto
  if (ajuste == null || real == null) return { usd: MIN_CONJUNTO_USD, calculado: false }
  return { usd: Math.max(MIN_CONJUNTO_USD, Math.round(ajuste - real)), calculado: true }
}

/**
 * Rotación: un conjunto por idea (3:2:2, de a 3 videos) o todos juntos, con la regla de Tomás (plan.ts; sin habitantes se toma la tarifa de
 * zona chica). Por video: cada conjunto a la tarifa de prueba. Juntos: el diario que deja cerrar el mes.
 */
export function estructuraRotacion(f: Pick<FilaAnuncio, 'presupuesto'>, videos: number): EstructuraBorrador & { motivo: string } {
  const d = decidirEstructura(f.presupuesto.mensualUSD, null, cantidadAnuncios(videos), 'anuncios')
  return d.estructura === 'por_video' ? { porAnuncio: true, diarioUSD: d.tarifa, motivo: d.motivo } : { porAnuncio: false, diarioUSD: diarioConjunto(f).usd, motivo: d.motivo }
}

/** El renglón del armado en Meta (rotación o lanzamiento), o el motivo por el que no se pudo. */
export function lineaBorrador(b: ResultadoBorrador, diarioUSD: number): { linea: string | null; falta: string | null } {
  if ('error' in b) return b.error.includes(MOTIVO_SIN_WHATSAPP.slice(0, 40))
    ? { linea: `⛔ **No pude armarlo en Meta:** ${MOTIVO_SIN_WHATSAPP}.`, falta: null }
    : { linea: null, falta: `no pude armarlo en Meta (${b.error})` }
  const x = b.ok, n = x.anuncios.length
  const sets = x.conjuntos.length === 1 ? `1 conjunto «${escaparDiscord(x.conjuntos[0].nombre)}» con ${plural(n, 'anuncio', 'anuncios')}` : `${x.conjuntos.length} conjuntos, uno por idea`
  return { linea: `📝 **Armado en Meta, todo EN PAUSA:** ${x.nueva ? `campaña nueva «${escaparDiscord(x.campana)}»` : `en «${escaparDiscord(x.campana)}»`}, ${sets}, a ${usd(diarioUSD)}/día cada conjunto · [Abrir en el Administrador](<${x.link}>). Revisalo y prendelo vos${x.nueva ? '' : '; el ganador sigue como está'}.`, falta: null }
}

const corto = (x: string, n = 220) => { const t = x.replace(/\s+/g, ' ').trim(); return escaparDiscord(t.length > n ? `${t.slice(0, n - 1)}…` : t) }

/** Lo de la ficha de kickoff que Valen necesita para armar la campaña (lo que antes traía el «🚀 Para lanzar» de la kickoff). */
export function lineasFicha(k: KickoffPorLanzar): string[] {
  const r: string[] = []
  r.push(`🏦 **Cuenta:** ${k.cuenta ? `\`${k.cuenta.id}\`${k.cuenta.nombre ? ` («${corto(k.cuenta.nombre, 80)}»)` : ''}${k.cuenta.monedaHora ? ` · ${corto(k.cuenta.monedaHora, 60)}` : ''}` : corto(k.cuentaAviso ?? 'sin identificar en la ficha')}`)
  const rama = [k.rama.nombre, k.rama.texto && k.rama.texto !== k.rama.nombre ? k.rama.texto : '', k.rama.subramas.length ? `subramas: ${k.rama.subramas.join('; ')}` : ''].filter(Boolean).join(' — ')
  r.push(`⚖️ **Rama:** ${corto(rama || 'sin definir')}`)
  if (k.avatar.incluye.length || k.avatar.excluye.length) r.push(`👤 **A quién (para el copy):** ${corto([k.avatar.incluye.join('; '), k.avatar.excluye.length ? `✋ afuera: ${k.avatar.excluye.join('; ')}` : ''].filter(Boolean).join(' · '))}`)
  const zona = [k.zona.lugares.length ? k.zona.lugares.join(' · ') : k.zona.descripcion, k.zona.radioKm != null ? `radio ${k.zona.radioKm} km` : ''].filter(Boolean).join(' · ')
  r.push(`📍 **Zona:** ${corto(zona || 'sin definir')}${k.zona.mapa?.estado === 'revisar' || k.zona.mapa?.estado === 'pendiente' ? ' (⚠️ el mapa de la llamada está para revisar)' : ''}`)
  if (k.zona.presentarse) r.push(`🗣️ **Presentarse como:** «${corto(k.zona.presentarse.texto, 120)}»`)
  r.push(`💵 **Presupuesto:** ${corto(k.presupuesto.texto || 'sin dato')}${k.presupuesto.aConfirmar ? ' (a confirmar)' : ''}`)
  const lanz = [k.lanzamiento.fecha, k.lanzamiento.texto.replace(/^Lanzamiento:\s*/, '')].filter(Boolean).join(' · ')
  if (lanz) r.push(`📅 **Lanzamiento:** ${corto(lanz)}`)
  if (k.whatsapp) r.push(`📲 **WhatsApp de destino:** ${corto(k.whatsapp, 40)}`)
  const frenan = k.frenos.filter(f => f.frena), tildar = k.frenos.filter(f => !f.frena)
  r.push(`🧾 **Portfolio:** ${frenan.length ? `⛔ ${corto(frenan.map(f => `${f.nombre}: ${f.detalle}`).join(' · '), 300)}` : 'nada que frene'}${tildar.length ? ` · para tildar: ${corto(tildar.map(f => f.nombre).join(', '), 120)}` : ''}${k.ojos.length ? ` · 👀 ${corto(k.ojos.join(' · '), 160)}` : ''}`)
  const links = [k.link ? `[Ficha](<${k.link}>)` : '', k.fathom ? `[Kickoff en Fathom](<${k.fathom}>)` : ''].filter(Boolean)
  if (links.length) r.push(`👉 ${links.join(' · ')}`)
  return r
}

export type ResultadoBorrador = { ok: Borrador } | { error: string }

export function textoVideos(s: Subida, fila: FilaAnuncio | null, porLanzar: PorLanzar | null, valentino: string | null, ahora: number, borrador: ResultadoBorrador | null = null): string {
  const n = s.videos.length
  const cliente = escaparDiscord(fila?.cliente ?? porLanzar?.cliente ?? s.cliente)
  const tanda = s.numero ? `tanda ${s.numero}` : escaparDiscord(s.tanda)
  const titulo = fila ? '📦 **Videos nuevos para cargar**' : '🚀 **Para lanzar**'
  const lineas = [`${valentino ? `<@${valentino}> ` : ''}${titulo} · ${cliente} (${tanda} · ${plural(n, 'video', 'videos')}, editados el ${ddmm(s.hasta)})`]
  const faltan: string[] = []
  const rotacion = !!fila && !fila.pausado && fila.gasto.d7 > 0
  if (rotacion) {
    const rama = fila.rama ? RAMA_CORTA[fila.rama.id] : null
    const cpl = fila.cpl.d7 != null && fila.usdPor ? fila.cpl.d7 / fila.usdPor : null
    const nivel = cpl != null && fila.rama ? (cpl <= fila.rama.umbral.ok ? `${rama}: normal hasta ${usd(fila.rama.umbral.ok)}` : `${rama}: arriba de lo normal (${usd(fila.rama.umbral.ok)})`) : null
    lineas.push(`🔁 **Rotación, no lanzamiento:** la cuenta está corriendo${cpl != null ? ` · ${usd(cpl)} por mensaje en 7 días${nivel ? ` (${nivel})` : ''}` : ''}.`)
  } else if (fila) {
    lineas.push(`🔁 **Relanzamiento:** la cuenta ${fila.pausado ? 'está pausada' : 'no gastó en los últimos 7 días'}.`)
  } else {
    lineas.push('🚀 **Lanzamiento:** todavía no tiene campaña corriendo; los videos ya están listos.')
  }
  lineas.push(`🎬 ${s.videos.map(v => `[${escaparDiscord(v.nombre.replace(/\.[a-z0-9]{2,4}$/i, ''))}](<https://drive.google.com/file/d/${v.id}/view>)`).join(' · ')}`)
  const conBorrador = (diario: number) => {
    if (!borrador) return false
    const r = lineaBorrador(borrador, diario)
    if (r.linea) lineas.push(r.linea)
    if (r.falta) faltan.push(r.falta)
    if ('ok' in borrador) faltan.push(...borrador.ok.faltan)
    return 'ok' in borrador
  }
  if (rotacion) {
    const e = estructuraRotacion(fila, n)
    const d = diarioConjunto(fila)
    const mes = fila.presupuesto.mensualUSD
    if (!conBorrador(e.diarioUSD)) {
      const nombre = `Broad | <zona del conjunto activo> | Tanda ${s.numero ?? '?'} | ${ddmm(new Date(ahora).toISOString())}`
      const a = cantidadAnuncios(n)
      const ads = a === 1 ? (n === 1 ? '1 anuncio con el video' : `los ${n} videos (1 idea, un anuncio por video)`) : `${a} ideas de hasta 3 videos (un anuncio por video)`
      lineas.push(e.porAnuncio
        ? `📋 **Propuesta:** en la misma campaña, ${a} conjuntos nuevos, uno por idea de 3 videos («1- ${nombre}»…), a ${usd(e.diarioUSD)}/día cada uno, con la misma zona del conjunto activo; el ganador sigue como está.`
        : `📋 **Propuesta:** en la misma campaña, 1 conjunto nuevo «${nombre}» con ${ads}, a ${usd(e.diarioUSD)}/día, con la misma zona del conjunto activo; el ganador sigue como está${mes != null && d.calculado ? `; así el mes cierra en ~${usd(mes)}` : ''}.`)
      lineas.push('🧩 **3:2:2:** cada idea son 3 videos (un anuncio cada uno) con los mismos 2 textos (uno amplio y uno directo) + 2 títulos, sin descripción.')
    }
    lineas.push(`📐 ${escaparDiscord(e.motivo)}`)
    if (mes == null) faltan.push('sin presupuesto mensual cargado: va todo junto, al diario mínimo')
    else if (!e.porAnuncio && !d.calculado) faltan.push('no pude medir el gasto del mes: el diario es el mínimo')
  } else if (porLanzar?.kickoff) {
    lineas.push(...lineasFicha(porLanzar.kickoff))
    if (borrador) conBorrador('ok' in borrador ? borrador.ok.diarioUSD : 0)
    if (borrador && 'ok' in borrador && borrador.ok.motivo) lineas.push(`📐 ${escaparDiscord(borrador.ok.motivo)}`)
  } else if (!fila) {
    faltan.push(porLanzar ? 'sin ficha de kickoff: no tengo zona ni presupuesto para el plan' : 'no encontré a este cliente en el tablero de anuncios (ni corriendo ni por lanzar)')
  }
  if (porLanzar && porLanzar.acceso === 'no') faltan.push('el token no ve su cuenta de Meta')
  const quien = fila?.cliente ?? porLanzar?.cliente
  if (quien && cruceParcial(s.carpetaCliente, quien)) faltan.unshift(`revisá que la carpeta «${escaparDiscord(s.carpetaCliente)}» sea de este cliente`)
  if (faltan.length) lineas.push(`⚠️ ${faltan.map(x => x[0].toUpperCase() + x.slice(1)).join(' · ')}.`)
  // Si no entra en un mensaje, primero se van los renglones de la ficha que menos hacen falta para armar (y nunca el ⚠️)
  for (const prefijo of ['👤', '🗣️', '📅', '📐', '🧾']) {
    if (lineas.join('\n').length <= 1900) break
    const i = lineas.findIndex(l => l.startsWith(prefijo))
    if (i > 0) lineas.splice(i, 1)
  }
  return lineas.join('\n').slice(0, 1900)
}

// ── Orquestador ──
export interface DepsVideos {
  clienteOperativo?(idCrm: string | null, nombre: string): Promise<boolean>
  editados(desde: string): Promise<EditadosCliente[]>
  avisadoHasta(carpetas: string[]): Promise<Map<string, string>>
  reclamar(clave: string, d: { tipo: string; cuenta: string; campana_id: string; cliente: string; texto_cliente: null }): Promise<boolean>
  marcarEnviado(clave: string, id: string): Promise<void>
  marcarDudoso(clave: string): Promise<void>
  soltar(clave: string): Promise<void>
  enviar(texto: string, deadline?: number): Promise<string>
  /** g03: arma el borrador en pausa (borrador.ts). Sin esto, o si la cuenta no está permitida, va solo la propuesta. */
  borrador?: { permitido(cuenta: string): boolean; armar(s: Subida, fila: FilaAnuncio, estructura: EstructuraBorrador, deadline: number): Promise<Borrador> }
  /** g03: lanzamiento desde la ficha de kickoff (lanzamiento.ts): campaña nueva, todo en pausa. Mismo interruptor. */
  lanzar?: { armar(s: Subida, pl: PorLanzar, deadline: number): Promise<Borrador> }
  valentino: string | null
  ahora(): number
}
export interface AvisoVideos { clave: string; cliente: string; texto: string; estado: 'enviado' | 'ya_salio' | 'dudoso' | 'rechazado' | 'error' | 'dry' | 'sin_tiempo'; motivo?: string }
export interface ResultadoVideos { carpetas: number; avisos: AvisoVideos[]; errores: string[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 200)
const RESERVA_MS = 8_000

export async function avisarVideosNuevos(t: Pick<Tablero, 'filas' | 'porLanzar'>, deps: DepsVideos, op: { dry?: boolean; deadline?: number; desde?: string } = {}): Promise<ResultadoVideos> {
  const errores: string[] = [], avisos: AvisoVideos[] = []
  let clientes: EditadosCliente[]
  try { clientes = await deps.editados(op.desde ?? desdeVideos()) } catch (e) { return { carpetas: 0, avisos, errores: [`drive: ${motivo(e)}`] } }
  const carpetas = clientes.flatMap(c => c.tandas.map(x => x.id))
  let hasta: Map<string, string>
  try { hasta = await deps.avisadoHasta(carpetas) } catch (e) { return { carpetas: carpetas.length, avisos, errores: [`base: ${motivo(e)}`] } }
  const subidas = subidasNuevas(clientes, hasta, deps.ahora(), op.desde ?? desdeVideos())
  for (const s of subidas.slice(0, MAX_AVISOS_VIDEOS)) {
    // Corriendo y por lanzar juntos: «Lucas Tapia» (por lanzar) no se tiene que cruzar con «Lucas Quiroga» (corriendo)
    const c = cruzarCliente(s.carpetaCliente, [...t.filas.map(f => ({ cliente: f.cliente, fila: f, pl: null })), ...t.porLanzar.map(p => ({ cliente: p.cliente, fila: null, pl: p }))])
    const fila = c?.fila ?? null, pl = c?.pl ?? null
    let texto = textoVideos(s, fila, pl, deps.valentino, deps.ahora())
    const cliente = fila?.cliente ?? pl?.cliente ?? s.cliente
    if (deps.clienteOperativo && !await deps.clienteOperativo(pl?.kickoff?.idCrm ?? null, fila?.clienteCRM ?? cliente)) continue
    if (op.dry) { avisos.push({ clave: s.clave, cliente, texto, estado: 'dry' }); continue }
    if (op.deadline && deps.ahora() > op.deadline - RESERVA_MS) { avisos.push({ clave: s.clave, cliente, texto, estado: 'sin_tiempo' }); continue }
    try {
      if (!(await deps.reclamar(s.clave, { tipo: 'videos', cuenta: fila?.id ?? '', campana_id: s.carpetaId, cliente, texto_cliente: null }))) { avisos.push({ clave: s.clave, cliente, texto, estado: 'ya_salio' }); continue }
    } catch (e) { errores.push(`reclamar ${s.clave}: ${motivo(e)}`); continue }
    // El borrador se arma DESPUÉS de reclamar: una sola vez por subida aunque el cron corra dos veces
    const tope = (op.deadline ?? deps.ahora() + 240_000) - RESERVA_MS - 5_000
    let intentoMeta = false
    if (fila && !fila.pausado && fila.gasto.d7 > 0 && deps.borrador?.permitido(fila.id)) {
      let b: ResultadoBorrador
      intentoMeta = true
      try { b = { ok: await deps.borrador.armar(s, fila, estructuraRotacion(fila, s.videos.length), tope) } } catch (e) { b = { error: motivo(e) } }
      texto = textoVideos(s, fila, pl, deps.valentino, deps.ahora(), b)
    } else if (!fila && pl?.kickoff?.cuenta && pl.acceso === 'si' && deps.lanzar && deps.borrador?.permitido(pl.kickoff.cuenta.id)) {
      let b: ResultadoBorrador
      intentoMeta = true
      try { b = { ok: await deps.lanzar.armar(s, pl, tope) } } catch (e) { b = { error: motivo(e) } }
      texto = textoVideos(s, fila, pl, deps.valentino, deps.ahora(), b)
    }
    try {
      if (deps.clienteOperativo && !await deps.clienteOperativo(pl?.kickoff?.idCrm ?? null, fila?.clienteCRM ?? cliente)) continue
      const id = await deps.enviar(texto, op.deadline)
      try { await deps.marcarEnviado(s.clave, id) } catch (e) { errores.push(`anotar ${s.clave}: ${motivo(e)}`) }
      avisos.push({ clave: s.clave, cliente, texto, estado: 'enviado' })
    } catch (err) {
      const m = motivo(err)
      const rechazado = (err as { transitorio?: boolean })?.transitorio === false
      // Meta puede haber creado todo o parte del borrador. No liberar la reserva por un fallo posterior de Discord:
      // la próxima corrida lo duplicaría. Queda dudoso para revisión, incluso con un rechazo o 429 confirmado.
      const soltar = !intentoMeta && (rechazado || /429|se acabó el tiempo|pausa entre mensajes/i.test(m))
      try { await (soltar ? deps.soltar(s.clave) : deps.marcarDudoso(s.clave)) } catch (e2) { errores.push(`anotar ${s.clave}: ${motivo(e2)}`) }
      avisos.push({ clave: s.clave, cliente, texto, estado: intentoMeta ? 'dudoso' : rechazado ? 'rechazado' : soltar ? 'error' : 'dudoso', motivo: m })
    }
  }
  if (subidas.length > MAX_AVISOS_VIDEOS) errores.push(`quedaron ${subidas.length - MAX_AVISOS_VIDEOS} subidas para la próxima corrida`)
  return { carpetas: carpetas.length, avisos, errores }
}
