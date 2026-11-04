// ── «Publicar» → el bot arma el anuncio EN PAUSA → «Publicado» (4/11/2026) ──────────────────────────────────────────
// Regla exacta de Tomás: «cuando está en PUBLICAR ahí se hace el anuncio, y cuando lo terminás de crear lo pasás a
// PUBLICADO». Para cada video que entró a «publicar» (desde el tablero o desde ClickUp, publicacionesDb.ts):
//   1. Copy: el del video en el Doc de ADS si ya está; si no, el directo (3:2:2) escrito desde su guion. Sin copy → la
//      tarjeta queda en Publicar con «falta copy» visible y aviso.
//   2. Doc de ADS: una vez creado el anuncio, se anota el video en el bloque del cliente (docAdsEscribir.ts) si hay permiso.
//   3. Cliente SIN campaña corriendo → la misma corrida del Doc (lanzarDesdeDoc, solo ese cliente y solo ese video, con su
//      línea de base): campaña nueva EN PAUSA. Cliente CON campaña → un conjunto nuevo EN PAUSA dentro de su campaña, con
//      este anuncio (rotación, armarBorrador; ANUNCIOS_ROTAR=real, si no queda en seco y Valen la suma a mano).
//   4. Todo se verifica pieza por pieza en pausa (verificarEnPausa). NUNCA se activa nada en Meta.
//   5. Creado y verificado → la tarjeta pasa a «publicado» en el Despacho y en ClickUp, con aviso a Valen (campanita +
//      #📣-ads). Si falla → queda en «publicar» con el error visible, aviso a Valen y a 🧰.
// Sin duplicar: una fila por tarjeta y archivo (publicacionesDb.ts) + la clave del Doc (docads:…) o de la rotación.
// EDICION_PUBLICAR=real crea en Meta; cualquier otro valor = seco (lee Meta, no escribe, no avisa, no mueve la tarjeta).
import type { Borrador } from '@/lib/bot/anuncios/borrador'
import type { ResultadoClienteDoc, ResumenSeco } from '@/lib/bot/anuncios/docAdsLanzar'
import type { EstadoPublicacion } from './publicacionesDb'

export interface PublicacionFila { id: string; tarjeta_id: string; archivo: string; id_crm: string | null; estado: string; intentos: number; detalle: string }
export interface TarjetaPublicar { id: string; nombre: string; etapa: string; id_crm: string | null; campos: { editado: string }; clickup_id: string | null; video_id: number | null }
export interface ClientePublicar { nombre: string; tipo: 'campana' | 'por_lanzar' | null; cuenta: string | null }
export interface CopyPublicar { copy: string | null; textos?: string[]; titulos?: string[]; fuente: string }
export interface DepsPublicar {
  modo: 'real' | 'seco'
  tarjeta(id: string): Promise<TarjetaPublicar | null>
  cliente(idCrm: string): Promise<ClientePublicar>
  video(drive: string): Promise<{ nombre: string; legible: boolean } | null>
  copy(t: TarjetaPublicar, drive: string): Promise<CopyPublicar>
  escribirDoc(x: { cliente: string; drive: string; copy: string }): Promise<string>
  lanzar(x: { cliente: string; idCrm: string; drive: string; copy: string; seco: boolean; nombre?: string }): Promise<{ r: ResultadoClienteDoc | null; errores: string[] }>
  rotar(x: { idCrm: string; drive: string; nombre: string; copy: string; textos?: string[]; titulos?: string[]; seco: boolean }): Promise<{ borrador: Borrador | null; seco: ResumenSeco | null; enSeco: string | null }>
  cerrarTarjeta(x: { tarjeta: TarjetaPublicar; anuncios: string[]; link: string | null; campana: string | null }): Promise<void>
  avisar(x: { ok: boolean; clave: string; tarjeta: TarjetaPublicar; cliente: string; lineas: string[]; link: string | null }): Promise<void>
}
export interface ResultadoPublicar {
  publicacion: string; tarjeta: string; cliente: string | null; estado: EstadoPublicacion; detalle: string
  camino: 'lanzamiento' | 'rotacion' | null; anuncios: string[]; link: string | null; campana: string | null
  copy: { fuente: string; texto: string | null } | null; doc: string | null; seco: ResumenSeco | null
  /** Lo que pasaría después (en seco) o lo que pasó (en real): la tarjeta a Publicado, ClickUp y el aviso a Valen. */
  despues: string[]
}

const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 220)
/** El resultado de la corrida del Doc para ESTE video → estado de la publicación. Puro. */
export function estadoDesdeDoc(r: ResultadoClienteDoc | null): { estado: EstadoPublicacion | 'reintentar'; detalle: string } {
  if (!r) return { estado: 'error', detalle: 'el bot de anuncios no encontró al cliente en /anuncios (ni con campaña ni por lanzar)' }
  switch (r.accion) {
    case 'armado': return { estado: 'creado', detalle: 'campaña nueva armada EN PAUSA y verificada' }
    case 'seco': return { estado: 'seco', detalle: 'prueba en seco: no se creó nada en Meta' }
    case 'sin_tiempo': return { estado: 'reintentar', detalle: r.detalle ?? 'sin tiempo en esta corrida' }
    case 'historico': return { estado: 'error', detalle: 'el video ya estaba en el Doc de ADS antes de la línea de base (o ya se procesó): no se arma otra vez. Si falta, armalo a mano y pasala a Publicado con el ID del anuncio' }
    case 'ya_salio': return { estado: 'dudoso', detalle: 'este video ya se armó o se avisó antes: verificá en Meta y pasala a Publicado con el ID del anuncio' }
    case 'videos_nuevos': return { estado: 'error', detalle: `${r.detalle ?? 'la cuenta ya tiene campaña'}; no tiene un conjunto activo para sumarlo: sumalo a mano y pasala a Publicado con el ID` }
    case 'falta_ficha': case 'falta_cuenta': case 'sin_acceso': case 'borrador_apagado': case 'sin_copy': case 'sin_videos_legibles': case 'error': case 'solo_estado': case 'plan':
      return { estado: 'error', detalle: r.detalle ?? r.accion }
    default: return { estado: 'error', detalle: r.detalle ?? String(r.accion) }
  }
}

export async function publicarUna(p: PublicacionFila, d: DepsPublicar): Promise<ResultadoPublicar & { reintentar?: boolean }> {
  const seco = d.modo !== 'real'
  const res: ResultadoPublicar & { reintentar?: boolean } = { publicacion: p.id, tarjeta: p.tarjeta_id, cliente: null, estado: 'error', detalle: '', camino: null, anuncios: [], link: null, campana: null, copy: null, doc: null, seco: null, despues: [] }
  const t = await d.tarjeta(p.tarjeta_id)
  if (!t) return { ...res, detalle: 'la tarjeta ya no existe' }
  if (!seco && t.etapa !== 'publicar') return { ...res, detalle: `la tarjeta salió de Publicar (está en «${t.etapa}»): no se arma nada` }
  if (!t.id_crm) return { ...res, detalle: 'la tarjeta no está vinculada a un cliente del CRM' }
  if (p.archivo.startsWith('sin_drive:')) return { ...res, detalle: 'el link del editado no es un archivo de Drive' }
  const drive = p.archivo
  const cli = await d.cliente(t.id_crm)
  res.cliente = cli.nombre
  const fallo = async (estado: EstadoPublicacion, detalle: string) => {
    res.estado = estado; res.detalle = detalle
    const lineas = [`🎬 ${t.nombre} · [video](<https://drive.google.com/file/d/${drive}/view>)`, `⚠️ ${detalle}`, 'La tarjeta sigue en Publicar. Nada se activó en Meta.']
    if (seco) res.despues.push(`avisaría a Valen (campanita + #📣-ads) y a 🧰: «${detalle}»`)
    else await d.avisar({ ok: false, clave: `publicar-error:${p.id}:${estado}:${detalle.slice(0, 60)}`, tarjeta: t, cliente: cli.nombre, lineas, link: null }).catch(() => {})
    return res
  }
  if (!cli.tipo) return fallo('error', 'el cliente no figura en /anuncios (ni con campaña corriendo ni por lanzar)')
  const v = await d.video(drive).catch(() => null)
  if (!v?.legible) return fallo('error', 'no puedo leer el video del editado en Drive (o no está «con cualquiera que tenga el enlace»): Meta lo baja de ahí')
  let c: CopyPublicar
  try { c = await d.copy(t, drive) } catch (e) { c = { copy: null, fuente: `error: ${motivo(e)}` } }
  res.copy = { fuente: c.fuente, texto: c.copy }
  if (!c.copy) return fallo('falta_copy', 'no encontré el copy: ni en el Doc de ADS ni un guion del video para escribirlo. Cargá el guion (comentario «Guion:» en la tarjeta o en ClickUp) o el copy en el Doc')
  // El Doc de ADS se escribe DESPUÉS de crear en Meta (y de marcar la huella del video): si se escribiera antes, la corrida
  // del Doc podía ver el video como nuevo en el medio y avisar «sumalo a mano» o armarlo por su lado (anuncio doble).
  res.doc = seco ? 'seco: no se escribe el Doc de ADS' : 'pendiente: se escribe cuando el anuncio quede creado'
  if (cli.tipo === 'campana') {
    res.camino = 'rotacion'
    let r: Awaited<ReturnType<DepsPublicar['rotar']>>
    try { r = await d.rotar({ idCrm: t.id_crm, drive, nombre: v.nombre === 'Video' ? `${cli.nombre} ${t.nombre}` : v.nombre, copy: c.copy, textos: c.textos, titulos: c.titulos, seco }) } catch (e) { return fallo('error', `no pude armar la rotación en Meta (${motivo(e)})`) }
    res.seco = r.seco
    if (!r.borrador) return fallo('error', r.enSeco ?? 'no se armó la rotación')
    if (r.enSeco) res.detalle = r.enSeco
    if (r.enSeco && !seco) {
      res.estado = 'seco'
      if (!seco) await d.avisar({ ok: false, clave: `publicar-rotar-seco:${p.id}`, tarjeta: t, cliente: cli.nombre, lineas: [`🎬 ${t.nombre} · [video](<https://drive.google.com/file/d/${drive}/view>)`, `✍️ Copy (${c.fuente}):\n${c.copy}`, `⚠️ ${res.detalle}. Sumalo vos a su campaña y pasala a Publicado con el ID del anuncio.`], link: null }).catch(() => {})
      return res
    }
    res.anuncios = r.borrador.anuncios; res.link = r.borrador.link; res.campana = r.borrador.campana
  } else {
    res.camino = 'lanzamiento'
    let out: Awaited<ReturnType<DepsPublicar['lanzar']>>
    try { out = await d.lanzar({ cliente: cli.nombre, idCrm: t.id_crm, drive, copy: c.copy, seco, nombre: t.nombre }) } catch (e) { return fallo('error', `no pude armar la campaña (${motivo(e)})`) }
    const e = estadoDesdeDoc(out.r)
    res.seco = out.r?.seco ?? null
    if (e.estado === 'reintentar') return { ...res, estado: 'pendiente', detalle: e.detalle, reintentar: true }
    if (e.estado === 'seco') { res.estado = 'seco'; res.detalle = e.detalle }
    else if (e.estado !== 'creado') return fallo(e.estado, e.detalle + (out.errores.length ? ` (${out.errores.join(' · ').slice(0, 160)})` : ''))
    else { const b = out.r!.borrador; res.anuncios = b?.anuncios ?? []; res.link = b?.link ?? null; res.campana = b?.campana ?? null }
  }
  const lineas = [`🎬 ${t.nombre} · [video](<https://drive.google.com/file/d/${drive}/view>)`, `📝 ${res.camino === 'rotacion' ? 'Conjunto nuevo EN PAUSA dentro de' : 'Campaña nueva EN PAUSA'} «${res.campana ?? '?'}»${res.link ? ` · [Abrir en el Administrador](<${res.link}>)` : ''}`, `✍️ Copy (${c.fuente}):\n${c.copy}`, 'Revisalo y prendelo vos cuando lo confirmes: nada se activó en Meta.']
  if (seco) {
    res.estado = 'seco'; res.detalle ||= 'prueba en seco: no se creó nada en Meta'
    res.despues.push('la tarjeta pasaría a «publicado» en el Despacho', t.clickup_id ? 'y en ClickUp (outbox: estado → publicado)' : 'y en ClickUp cuando tenga su tarea', 'avisaría a Valen: campanita del Despacho + #📣-ads con el link al Administrador')
    return res
  }
  res.doc = await d.escribirDoc({ cliente: cli.nombre, drive, copy: c.copy }).catch(e => `no se pudo escribir el Doc (${motivo(e)})`)
  await d.cerrarTarjeta({ tarjeta: t, anuncios: res.anuncios, link: res.link, campana: res.campana })
  res.estado = 'creado'; res.detalle = `${res.camino === 'rotacion' ? 'conjunto nuevo EN PAUSA en su campaña' : 'campaña nueva EN PAUSA'}, verificado: la tarjeta pasó a Publicado`
  await d.avisar({ ok: true, clave: `publicar:${t.id}:${drive}`, tarjeta: t, cliente: cli.nombre, lineas, link: res.link }).catch(() => {})
  res.despues.push('tarjeta en Publicado (Despacho + ClickUp)', 'aviso a Valen (campanita + #📣-ads)')
  return res
}

/** Un guion suelto (comentario «Guion:», el del motor o el de ClickUp) → sus secciones para escribir el copy. Puro. */
export function seccionesDeGuion(texto: string, gancho = ''): { hook: string; problema: string; solucion: string; cta: string } | null {
  const t = texto.replace(/^\s*guion\s*:\s*/i, '').replace(/\r\n?/g, '\n').trim()
  if (!t && !gancho.trim()) return null
  const re = /(?:^|\n)\s*(hook|gancho|problema|soluci[oó]n|cta)\s*[:\-–]\s*/gi
  const marcas = [...t.matchAll(re)]
  const s = { hook: '', problema: '', solucion: '', cta: '' }
  if (marcas.length) {
    for (const [i, m] of marcas.entries()) {
      const k = m[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const valor = t.slice(m.index! + m[0].length, marcas[i + 1]?.index ?? t.length).replace(/\s+/g, ' ').trim()
      const campo = k === 'gancho' ? 'hook' : (k as keyof typeof s)
      s[campo] = s[campo] ? `${s[campo]} ${valor}` : valor
    }
  } else {
    const ps = t.split('\n').map(x => x.trim()).filter(Boolean)
    s.hook = ps[0] ?? ''; s.problema = ps.slice(1, -1).join(' ') || (ps[1] ?? ''); s.cta = ps.length > 2 ? ps[ps.length - 1] : ''
  }
  if (gancho.trim() && !s.hook) s.hook = gancho.trim()
  return s.hook || s.problema ? s : null
}
