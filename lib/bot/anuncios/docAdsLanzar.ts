// ── Lanzar desde el Doc de ADS: el cliente por lanzar marcado LISTO → campaña nueva EN PAUSA + aviso a Valen ────────
// Pedido de Tomás (3/11/2026). Corre con la alerta de las 9:05 (/api/alerta-anuncios), antes de g01, y desde el botón
// «Leer el Doc de ADS ahora» de /anuncios (/api/anuncios/doc-ads). Para cada cliente POR LANZAR (activo, sin campaña
// corriendo) cuyo bloque más nuevo del Doc dice LISTO (docAds.ts):
//   · Videos: los del Doc (links de Drive, aunque estén en el Drive de René; si la cuenta de servicio no puede leer alguno,
//     se avisa cuál) + los de «Editados - X» que no están en el Doc (mismo archivo = mismo md5), con el copy de su guion.
//   · Copy: el del Doc es el texto principal de cada anuncio (texto 1 del 3:2:2); la variación amplia y los 2 títulos los
//     escribe copys.ts con las reglas de variación fiel. Sin variación, va solo el copy del Doc.
//   · Armado: lanzamiento.ts (la ficha de kickoff: cuenta, zona, presupuesto). TODO EN PAUSA (crearEnPausa lo verifica
//     pieza por pieza). Nada se prende: Valen lo revisa y lo prende cuando confirma.
//   · Sin duplicar: una vez por cliente por juego de videos (clave docads:… en cj_anuncios_avisos) y nunca si la cuenta ya
//     tiene una campaña creada en los últimos DIAS_CAMPANA_RECIENTE días.
//   · Lo que falta para armar (sin ficha, sin cuenta, sin acceso del token, borrador apagado) sale UNA vez en el aviso,
//     con su propia clave: cuando se resuelve, arma en la corrida siguiente.
// Los estados distintos de LISTO no arman nada: se muestran tal cual en el tablero y en el resultado.
// `seco`: arma con un Graph que solo LEE de Meta (los POST se anotan y no se mandan) y devuelve qué borrador saldría.
import type { FilaAnuncio, PorLanzar, Tablero } from '@/lib/anuncios/tablero'
import { escaparDiscord } from '@/lib/fathomAnuncios/mensaje'
import type { Borrador, GrupoBorrador } from './borrador'
import { grupoConCopy, sinExtension } from './borrador'
import { armaDesdeDoc, claveDoc, estadoPorCliente, gruposDesdeDoc, parsearDocAds, textoEstadoDoc, type EstadoDoc } from './docAds'
import { lineasFicha, type Subida } from './videos'

export const DIAS_CAMPANA_RECIENTE = 45
export const MAX_ARMADOS_POR_CORRIDA = 3

/** publico: false = la cuenta de servicio lo lee pero Meta no lo puede bajar (no está «con cualquiera que tenga el enlace»). */
export interface ArchivoDrive { nombre: string; md5: string | null; video: boolean; publico?: boolean }
export interface PedidoSeco { ruta: string; cuerpo: Record<string, unknown> }
export interface ResumenSeco {
  campana: string | null
  conjuntos: { nombre: string; diario: string; zona: string }[]
  anuncios: { nombre: string; video: string; textos: string[]; titulos: string[] }[]
  motivo: string | null
  faltan: string[]
}

export interface DepsDocAds {
  leerDoc(): Promise<string>
  archivo(id: string): Promise<ArchivoDrive | null>
  /** Los videos de «Editados - X» del cliente (con md5), para sumar los que no están en el Doc. */
  editados(pl: PorLanzar): Promise<{ id: string; nombre: string; md5: string | null; guionesDoc: string | null }[]>
  /** Los grupos (con textos desde el guion) de los videos de Editados que no están en el Doc (copys.ts). */
  gruposExtra(s: Subida): Promise<GrupoBorrador[]>
  /** La variación amplia y los 2 títulos desde los copys del Doc (copys.ts). null = no se pudo. */
  variacion(copys: string[]): Promise<{ textos: string[]; titulos: string[] } | null>
  campanas(cuenta: string): Promise<{ nombre: string; creada: string }[]>
  permitido(cuenta: string): boolean
  armar(s: Subida, pl: PorLanzar, grupos: GrupoBorrador[], op: { seco: boolean; deadline: number }): Promise<{ borrador: Borrador; pedidos: PedidoSeco[] | null }>
  reclamar(clave: string, d: { tipo: string; cuenta: string; campana_id: string; cliente: string; texto_cliente: null }): Promise<boolean>
  marcarEnviado(clave: string, id: string): Promise<void>
  marcarDudoso(clave: string): Promise<void>
  soltar(clave: string): Promise<void>
  enviar(texto: string, deadline?: number): Promise<string>
  valentino: string | null
  tomas: string | null
  ahora(): number
}

export type AccionDoc = 'armado' | 'seco' | 'plan' | 'ya_salio' | 'ya_tiene_campana' | 'falta_ficha' | 'falta_cuenta' | 'sin_acceso' | 'borrador_apagado'
  | 'sin_videos_legibles' | 'sin_copy' | 'error' | 'solo_estado' | 'sin_tiempo'
export interface ResultadoClienteDoc {
  cliente: string; idCrm: string | null; doc: string; listo: boolean; accion: AccionDoc; detalle: string | null
  videos: { numero: number | null; drive: string; nombre: string; legible: boolean; copy: boolean; origen: 'doc' | 'editados' }[]
  noLegibles: string[]
  texto: string | null
  seco?: ResumenSeco
  enviado?: boolean
}
export interface ResultadoDoc { leido: boolean; bloques: number; clientes: ResultadoClienteDoc[]; errores: string[] }

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 220)
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const linkDrive = (id: string) => `https://drive.google.com/file/d/${id}/view`
const RESERVA_MS = 15_000

/** El resumen de lo que se habría creado, desde los POST anotados por el Graph en seco. Puro. */
export function resumirSeco(pedidos: PedidoSeco[], b: Borrador, moneda = ''): ResumenSeco {
  const campana = pedidos.find(p => p.ruta.endsWith('/campaigns'))?.cuerpo.name
  const zonaDe = (t: unknown) => {
    const g = ((t as Record<string, unknown>)?.geo_locations ?? {}) as Record<string, unknown[]>
    const n = (k: string) => (g[k]?.length ?? 0)
    const radio = (g.cities?.[0] as { radius?: number } | undefined)?.radius
    return [n('cities') && `${n('cities')} ciudad(es)${radio ? ` a ${radio} km` : ''}`, n('regions') && `${n('regions')} provincia(s)`, n('subcities') && `${n('subcities')} subciudad(es)`, n('neighborhoods') && `${n('neighborhoods')} barrio(s)`].filter(Boolean).join(' + ') || 'sin zona'
  }
  const local = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? (n / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '?' }
  const conjuntos = pedidos.filter(p => p.ruta.endsWith('/adsets')).map(p => ({ nombre: String(p.cuerpo.name ?? ''), diario: `USD ${b.diarioUSD}/día ≈ ${local(p.cuerpo.daily_budget)} en la moneda de la cuenta${moneda ? ` (${moneda})` : ''}`, zona: zonaDe(p.cuerpo.targeting) }))
  const creativos = pedidos.filter(p => p.ruta.endsWith('/adcreatives'))
  const ads = pedidos.filter(p => p.ruta.endsWith('/ads'))
  const anuncios = creativos.map((c, i) => {
    const oss = (c.cuerpo.object_story_spec ?? {}) as { video_data?: { message?: string; title?: string } }
    const afs = (c.cuerpo.asset_feed_spec ?? {}) as { bodies?: { text: string }[]; titles?: { text: string }[] }
    return {
      nombre: String(ads[i]?.cuerpo.name ?? ''), video: String(c.cuerpo.name ?? ''),
      textos: afs.bodies?.map(x => x.text) ?? (oss.video_data?.message ? [oss.video_data.message] : []),
      titulos: afs.titles?.map(x => x.text) ?? (oss.video_data?.title ? [oss.video_data.title] : []),
    }
  })
  return { campana: campana ? String(campana) : null, conjuntos, anuncios, motivo: b.motivo ?? null, faltan: b.faltan }
}

/** El aviso de #📣-ads (≤ 1900). Puro. */
export function textoDoc(x: {
  pl: PorLanzar; e: EstadoDoc; videos: ResultadoClienteDoc['videos']; noLegibles: string[]; valentino: string | null; tomas: string | null
  borrador?: Borrador | null; error?: string | null; falta?: string | null; extrasSinCopy?: string[]
}): string {
  const { pl, e } = x
  const menc = [x.valentino, x.falta ? x.tomas : null].filter(Boolean).map(m => `<@${m}>`).join(' ')
  const lineas = [`${menc ? `${menc} ` : ''}🗂️ **Para lanzar desde el Doc de ADS** · ${escaparDiscord(pl.cliente)}${pl.idCrm ? ` (${pl.idCrm})` : ''} · «${escaparDiscord(e.titulo)}» · ${plural(x.videos.filter(v => v.legible).length, 'video', 'videos')}`]
  lineas.push(`🎬 ${x.videos.filter(v => v.legible).map(v => `[${v.origen === 'doc' ? `Video ${v.numero}` : escaparDiscord(sinExtension(v.nombre))}](<${linkDrive(v.drive)}>)`).join(' · ')}`)
  lineas.push('✍️ **Copy:** el de cada video en el Doc va de texto principal; la variación amplia y los 2 títulos (3:2:2) los escribió el bot con las mismas palabras.')
  if (pl.kickoff) lineas.push(...lineasFicha(pl.kickoff))
  const faltan: string[] = []
  if (x.borrador) {
    const b = x.borrador
    lineas.push(`📝 **Armado en Meta, todo EN PAUSA:** campaña nueva «${escaparDiscord(b.campana)}», ${b.conjuntos.length === 1 ? `1 conjunto con ${plural(b.anuncios.length, 'anuncio', 'anuncios')}` : `${b.conjuntos.length} conjuntos, uno por idea`}, a USD ${b.diarioUSD}/día cada conjunto · [Abrir en el Administrador](<${b.link}>). Revisalo y prendelo vos cuando lo confirmes.`)
    if (b.motivo) lineas.push(`📐 ${escaparDiscord(b.motivo)}`)
    faltan.push(...b.faltan)
  } else if (x.error) {
    faltan.push(`no pude armarlo en Meta (${x.error})`)
  } else if (x.falta) {
    faltan.push(`no armé nada: ${x.falta}`)
  }
  if (x.noLegibles.length) faltan.push(`no puedo leer ${x.noLegibles.join(', ')} del Doc: compartí esos archivos «con cualquiera que tenga el enlace» (Meta los baja de ahí)`)
  if (x.extrasSinCopy?.length) faltan.push(`en «Editados» hay videos que no están en el Doc y no tienen guion para el copy: ${x.extrasSinCopy.map(escaparDiscord).join(', ')} (quedan afuera)`)
  if (faltan.length) lineas.push(`⚠️ ${faltan.map(f => escaparDiscord(f[0].toUpperCase() + f.slice(1))).join(' · ')}.`)
  lineas.push('Nada se activa en Meta: queda todo en pausa hasta que Valen confirme.')
  for (const prefijo of ['👤', '🗣️', '📅', '📐', '🧾', '✍️']) {
    if (lineas.join('\n').length <= 1900) break
    const i = lineas.findIndex(l => l.startsWith(prefijo))
    if (i > 0) lineas.splice(i, 1)
  }
  return lineas.join('\n').slice(0, 1900)
}

/** Los clientes por lanzar con su estado en el Doc (el bloque más nuevo que se les cruza). Puro. */
export function estadosPorLanzar(t: Pick<Tablero, 'filas' | 'porLanzar' | 'porLanzarEsperando'>, texto: string): { porLanzar: { pl: PorLanzar; e: EstadoDoc }[]; bloques: number } {
  const bloques = parsearDocAds(texto)
  const pls = [...t.porLanzar, ...(t.porLanzarEsperando ?? [])]
  const todos: { cliente: string; pl: PorLanzar | null; fila: FilaAnuncio | null }[] = [
    ...t.filas.map(f => ({ cliente: f.clienteCRM ?? f.cliente, pl: null, fila: f })),
    ...pls.map(pl => ({ cliente: pl.cliente, pl, fila: null })),
  ]
  const m = estadoPorCliente(bloques, todos)
  const out: { pl: PorLanzar; e: EstadoDoc }[] = []
  for (const [x, e] of m) if (x.pl) out.push({ pl: x.pl, e })
  return { porLanzar: out, bloques: bloques.length }
}

export async function lanzarDesdeDoc(t: Pick<Tablero, 'filas' | 'porLanzar' | 'porLanzarEsperando'>, deps: DepsDocAds, op: { dry?: boolean; seco?: boolean; solo?: string | null; deadline?: number } = {}): Promise<ResultadoDoc> {
  const errores: string[] = [], clientes: ResultadoClienteDoc[] = []
  let texto: string
  try { texto = await deps.leerDoc() } catch (e) { return { leido: false, bloques: 0, clientes, errores: [`Doc de ADS: ${motivo(e)}`] } }
  const { porLanzar, bloques } = estadosPorLanzar(t, texto)
  const solo = op.solo?.trim().toUpperCase() || null
  let armados = 0
  for (const { pl, e } of porLanzar) {
    if (solo && (pl.idCrm ?? '').toUpperCase() !== solo && !pl.cliente.toUpperCase().includes(solo)) continue
    const base: ResultadoClienteDoc = { cliente: pl.cliente, idCrm: pl.idCrm ?? null, doc: textoEstadoDoc(e), listo: e.listo, accion: 'solo_estado', detalle: null, videos: [], noLegibles: [], texto: null }
    if (!armaDesdeDoc(e)) { clientes.push({ ...base, detalle: e.listo ? (e.fuerza === 'debil' ? 'el nombre del Doc comparte una sola palabra con el CRM: no armo' : 'sin videos con link') : 'no está LISTO en el Doc' }); continue }
    // Los videos del Doc (con link), en su orden, y si se pueden leer
    const delDoc = [...e.bloque.videos].filter(v => v.drive).sort((a, b) => a.numero - b.numero)
    const videos: ResultadoClienteDoc['videos'] = [], md5s = new Set<string>(), noLegibles: string[] = []
    const copys = new Map<string, string>()
    for (const v of delDoc) {
      let a: ArchivoDrive | null = null
      try { a = await deps.archivo(v.drive!) } catch { a = null }
      // Meta lo baja del enlace público: si no es público, el armado fallaría a mitad de camino (y el reclamo ya no se suelta)
      const legible = !!a && a.video && a.publico !== false
      if (!legible) noLegibles.push(`video ${v.numero}`)
      if (a?.md5) md5s.add(a.md5)
      if (legible && !videos.some(x => x.drive === v.drive)) {
        videos.push({ numero: v.numero, drive: v.drive!, nombre: a!.nombre, legible, copy: !!v.copy.trim(), origen: 'doc' })
        if (v.copy.trim()) copys.set(v.drive!, v.copy)
      }
    }
    // Los de «Editados - X» que no están en el Doc (mismo md5 = mismo archivo copiado)
    let extras: { id: string; nombre: string; md5: string | null; guionesDoc: string | null }[] = []
    try { extras = (await deps.editados(pl)).filter(x => !x.md5 || !md5s.has(x.md5)).filter(x => !videos.some(v => v.drive === x.id)) } catch (err) { errores.push(`Editados de «${pl.cliente}»: ${motivo(err)}`) }
    for (const x of extras) videos.push({ numero: null, drive: x.id, nombre: x.nombre, legible: true, copy: false, origen: 'editados' })
    const r: ResultadoClienteDoc = { ...base, videos, noLegibles }
    clientes.push(r)
    const docVideos = videos.filter(v => v.origen === 'doc')
    if (!docVideos.length) { r.accion = 'sin_videos_legibles'; r.detalle = `no puedo leer ningún video del Doc (${noLegibles.join(', ')})`; continue }
    const k = pl.kickoff
    const clave = claveDoc({ idCrm: pl.idCrm ?? k?.idCrm ?? null, cliente: pl.cliente }, videos.map(v => v.drive))
    const falta = !k ? 'sin ficha de kickoff (no tengo cuenta, zona ni presupuesto)' : !k.cuenta ? 'la ficha no tiene la cuenta de Meta' : pl.acceso === 'no' ? 'el token no ve su cuenta de Meta' : null
    const accionFalta: AccionDoc | null = !k ? 'falta_ficha' : !k.cuenta ? 'falta_cuenta' : pl.acceso === 'no' ? 'sin_acceso' : null
    // ¿Ya tiene una campaña creada hace poco? (puede ser el borrador de una corrida anterior o una que armó Valen)
    if (k?.cuenta && !accionFalta) {
      try {
        const desde = deps.ahora() - DIAS_CAMPANA_RECIENTE * 86_400_000
        const recientes = (await deps.campanas(k.cuenta.id)).filter(c => Date.parse(c.creada) >= desde)
        if (recientes.length) { r.accion = 'ya_tiene_campana'; r.detalle = `la cuenta ya tiene ${recientes.map(c => `«${c.nombre}» (${ddmm(c.creada)})`).join(', ')}: no armo otra`; continue }
      } catch (err) { r.accion = 'error'; r.detalle = `no pude ver las campañas de la cuenta (${motivo(err)}): no armo por las dudas`; continue }
    }
    // Los grupos: los del Doc (copy propio de cada video) + los de Editados que tengan copy del guion
    const gruposDoc = gruposDesdeDoc(docVideos.map(v => ({ drive: v.drive, nombre: sinExtension(v.nombre), copy: copys.get(v.drive) ?? '' })))
    let gruposExtra: GrupoBorrador[] = []
    const extrasSinCopy: string[] = []
    if (extras.length) {
      const sub: Subida = { clave, carpetaId: 'editados', carpetaCliente: pl.cliente, cliente: pl.cliente, tanda: 'Editados', numero: null, videos: extras.map(x => ({ id: x.id, nombre: x.nombre, creado: new Date(deps.ahora()).toISOString() })), hasta: new Date(deps.ahora()).toISOString(), guionesDoc: extras[0].guionesDoc }
      try { gruposExtra = await deps.gruposExtra(sub) } catch { gruposExtra = [] }
      for (const g of gruposExtra) if (!grupoConCopy(g)) extrasSinCopy.push(...g.videos.map(v => v.nombre))
      gruposExtra = gruposExtra.filter(grupoConCopy)
    }
    if (op.dry && !op.seco) { r.accion = 'plan'; r.detalle = accionFalta ? falta : `armaría ${plural(docVideos.length + gruposExtra.reduce((s, g) => s + g.videos.length, 0), 'anuncio', 'anuncios')} en pausa`; continue }
    const conTexto = (y: Partial<Parameters<typeof textoDoc>[0]>) => textoDoc({ pl, e, videos, noLegibles, valentino: deps.valentino, tomas: deps.tomas, extrasSinCopy, ...y })
    if (accionFalta) {
      r.accion = accionFalta; r.detalle = falta
      r.texto = conTexto({ falta })
      // Sin ficha no se avisa acá: lo dice el aviso de clientes trabados (y la ficha perdida se reintenta sola)
      if (op.seco || op.dry || accionFalta === 'falta_ficha') continue
      await mandar(deps, `${clave}:${accionFalta}`, pl, r, errores, op.deadline)
      continue
    }
    if (!op.seco && !deps.permitido(k!.cuenta!.id)) {
      r.accion = 'borrador_apagado'; r.detalle = 'el armado en Meta está apagado (ANUNCIOS_BORRADOR) o la cuenta no está en ANUNCIOS_BORRADOR_SOLO'
      r.texto = conTexto({ falta: 'el armado automático en Meta está apagado para esta cuenta: armalo a mano con estos videos y copys' })
      await mandar(deps, `${clave}:apagado`, pl, r, errores, op.deadline)
      continue
    }
    if (armados >= MAX_ARMADOS_POR_CORRIDA) { r.accion = 'sin_tiempo'; r.detalle = `ya armé ${MAX_ARMADOS_POR_CORRIDA} en esta corrida: sigue en la próxima`; continue }
    const tope = (op.deadline ?? deps.ahora() + 240_000) - RESERVA_MS
    if (deps.ahora() > tope - 60_000) { r.accion = 'sin_tiempo'; r.detalle = 'no queda tiempo en esta corrida: sigue en la próxima'; continue }
    // Sin duplicar: se reclama ANTES de crear nada (en seco no se reclama)
    if (!op.seco) {
      try {
        if (!await deps.reclamar(clave, { tipo: 'docads', cuenta: k!.cuenta!.id, campana_id: 'doc', cliente: pl.cliente, texto_cliente: null })) { r.accion = 'ya_salio'; r.detalle = 'este juego de videos ya se armó o se avisó'; continue }
      } catch (err) { errores.push(`reclamar ${clave}: ${motivo(err)}`); r.accion = 'error'; r.detalle = motivo(err); continue }
    }
    // La variación amplia y los 2 títulos desde los copys del Doc (si falla, va solo el copy del Doc)
    for (const g of gruposDoc) {
      const cs = g.videos.map(v => g.copyPorVideo?.[v.drive]).filter((c): c is string => !!c)
      if (!cs.length) continue
      try {
        const v = await deps.variacion(cs)
        if (v) { g.textos = [v.textos[0]]; g.titulos = v.titulos }
      } catch { /* va solo el copy del Doc */ }
    }
    const grupos = [...gruposDoc, ...gruposExtra]
    if (!grupos.every(grupoConCopy)) { r.accion = 'sin_copy'; r.detalle = 'hay videos del Doc sin copy debajo'; if (!op.seco) await deps.soltar(clave).catch(() => {}); continue }
    const sub: Subida = { clave, carpetaId: 'doc', carpetaCliente: e.titulo, cliente: pl.cliente, tanda: 'Doc de ADS', numero: 1, videos: videos.map(v => ({ id: v.drive, nombre: v.nombre, creado: new Date(deps.ahora()).toISOString() })), hasta: new Date(deps.ahora()).toISOString(), guionesDoc: null }
    armados++
    let borrador: Borrador | null = null, error: string | null = null, pedidos: PedidoSeco[] | null = null
    try { const a = await deps.armar(sub, pl, grupos, { seco: !!op.seco, deadline: tope }); borrador = a.borrador; pedidos = a.pedidos } catch (err) { error = motivo(err) }
    if (op.seco) {
      r.accion = error ? 'error' : 'seco'; r.detalle = error
      if (borrador && pedidos) r.seco = resumirSeco(pedidos, borrador, k?.cuenta?.monedaHora ?? '')
      r.texto = conTexto({ borrador: null, error, falta: error ? null : 'prueba en seco: no se creó nada en Meta' })
      continue
    }
    r.accion = error ? 'error' : 'armado'; r.detalle = error
    r.texto = conTexto({ borrador, error })
    try {
      const id = await deps.enviar(r.texto, op.deadline)
      r.enviado = true
      await deps.marcarEnviado(clave, id).catch(err => errores.push(`anotar ${clave}: ${motivo(err)}`))
    } catch (err) {
      errores.push(`discord (${pl.cliente}): ${motivo(err)}`)
      // Meta puede haber creado parte: no se suelta (la próxima corrida lo duplicaría); queda dudoso para revisar
      await deps.marcarDudoso(clave).catch(() => {})
    }
  }
  return { leido: true, bloques, clientes, errores }
}

async function mandar(deps: DepsDocAds, clave: string, pl: PorLanzar, r: ResultadoClienteDoc, errores: string[], deadline?: number): Promise<void> {
  try {
    if (!await deps.reclamar(clave, { tipo: 'docads', cuenta: pl.kickoff?.cuenta?.id ?? '', campana_id: 'doc', cliente: pl.cliente, texto_cliente: null })) return
  } catch (err) { errores.push(`reclamar ${clave}: ${motivo(err)}`); return }
  try {
    const id = await deps.enviar(r.texto ?? '', deadline)
    r.enviado = true
    await deps.marcarEnviado(clave, id).catch(err => errores.push(`anotar ${clave}: ${motivo(err)}`))
  } catch (err) {
    errores.push(`discord (${pl.cliente}): ${motivo(err)}`)
    await deps.soltar(clave).catch(() => {})
  }
}

/** Los clientes por lanzar que el Doc cubre (LISTO firme): g01 no les arma otro lanzamiento desde «Editados». */
export function cubiertosPorDoc(r: ResultadoDoc | null | undefined): Set<string> {
  return new Set((r?.clientes ?? []).filter(c => c.listo && c.accion !== 'solo_estado' && c.accion !== 'sin_videos_legibles').map(c => c.cliente))
}
