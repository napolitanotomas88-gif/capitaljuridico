// ── Importación desde ClickUp (lista "Sistema de Edición") en MODO PRUEBA (puro: sin red ni base) ─────────────────────
// Decisión de Tomás (P1, 24/10): entran todos los clientes activos desde una fecha de corte; se importan los ~37 videos
// activos de ClickUp y ClickUp queda SOLO de consulta (nunca se escribe en ClickUp). El script
// scripts/edicion-importar-clickup.mjs lee (o toma un volcado), llama a mapearTareas y escribe una PROPUESTA en JSON; en
// esta etapa no se escribe nada en Neon. cargarPropuesta queda lista (probada con un repositorio falso) para cuando Tomás
// dé el OK: se corre antes del primer diario real y la propuesta se regenera ese mismo día.
// Equivalencias de estado (relevamiento 2.10):
//   en espera de datos → esperando_crudos (e01 arranca en la fecha de corte) · para editar / editando → para_editar ·
//   editado → editado · corregido → corregido · revisión → con_cliente (marcado "confirmar con Aylu", con la constancia
//   de envío "importado de ClickUp") · publicar / publicado → no se importan.
// Lo demás:
//   · el video sale de las SUBTAREAS ("video 3", "video 2 tanda 3"); la tarjeta del cliente es la tarea padre;
//   · clave T{tanda}-V{n} solo si el nombre trae la tanda; "video N" sin tanda → CU-<id> (nunca "Tnull-V7");
//   · "2 - Crudo" (link de Drive, archivo o carpeta) → vínculo del crudo; "3 - Editado" → editado.url (link al ARCHIVO);
//   · "1 - Paleta de Color": los hexadecimales van a colores; una URL https a referencia; el resto, a las notas;
//   · las capturas de los comentarios quedan como referencia "captura en ClickUp (comentario del dd/mm)" con el link a la
//     TAREA, nunca la URL del adjunto (es firmada);
//   · el gancho y el guion salen de los comentarios de la subtarea (el primero corto y el largo con PROBLEMA/SOLUCIÓN/CTA);
//   · el cliente se cruza con el CRM con crearCruceCarpetas; si queda dudoso, va a `sin_cruzar` con sus candidatos.
// Privacidad: la propuesta no lleva mails ni teléfonos del CRM ni los autores de los comentarios.
import { claveNombre, crearCruceCarpetas } from '@/lib/clientes/prioridad'
import type { Actor, Constancia, EstadoVideo, FichaMarca, IdCrm, Iso, Prioridad, Video, Ymd } from './tipos'
import { coloresDeTexto, esAdjuntoClickUp, idDeDrive, urlHttps } from './marca'

export const VERSION_IMPORTACION = 'imp1-2026-10-24'
export const LISTA_EDICION_POR_DEFECTO = ''

export interface ComentarioClickUp { fecha: Iso; texto: string; imagenes: number }
export interface TareaClickUpEdicion {
  id: string; nombre: string; estado: string; padre: string | null; url: string
  prioridad: string | null                 // urgent | high | normal | low | null (como viene de ClickUp)
  creada: Iso | null; actualizada: Iso | null
  campos: { paleta: string | null; crudo: string | null; editado: string | null }
  comentarios: ComentarioClickUp[]
  etiquetas: string[]
}
export interface ClienteCrm { id: IdCrm; nombre: string; estado: string }

export interface VideoImportado {
  clickup_id: string; tarea_padre: string; url_tarea: string
  id_crm: IdCrm; cliente: string; clave: string; tanda_guion: number | null; numero: number | null
  estado: EstadoVideo; estado_clickup: string; estado_desde: Iso | null; prioridad: Prioridad
  gancho: string; guion_texto: string
  crudo: { drive_id: string | null; tipo: 'archivo' | 'carpeta' | 'otro'; url: string } | null
  editado: { drive_id: string | null; url: string } | null
  envio_link: Constancia | null
  confirmar_con_aylu: string[]
  origen: 'clickup'
}
export interface MarcaImportada { id_crm: IdCrm; cliente: string; ficha: Pick<FichaMarca, 'colores' | 'referencia' | 'notas' | 'fuentes'> }
export interface SinCruzar { tarea_id: string; nombre: string; candidatos: { id_crm: IdCrm; nombre: string; puntaje: number }[]; videos: number }
export interface PropuestaImportacion {
  version: string; generado: Iso; fecha_corte: Ymd
  clientes: { tarea_id: string; nombre_clickup: string; id_crm: IdCrm; cliente: string; estado_crm: string; videos: number }[]
  videos: VideoImportado[]
  marcas: MarcaImportada[]
  sin_cruzar: SinCruzar[]
  omitidas: { tarea_id: string; nombre: string; motivo: string }[]
  avisos: string[]
  conteo: Record<string, number>
}

export const ESTADOS_CLICKUP: Record<string, EstadoVideo | null> = {
  'en espera de datos': 'esperando_crudos',
  'para editar': 'para_editar',
  editando: 'para_editar',
  editado: 'editado',
  corregido: 'corregido',
  'revisión': 'con_cliente',
  revision: 'con_cliente',
  publicar: null,
  publicado: null,
}
const PRIORIDAD: Record<string, Prioridad> = { urgent: 'urgente', high: 'alta' }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const ddmm = (iso: Iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' }) : '?' }

// ── Normalización de lo que devuelve la API de ClickUp (GET /list/{id}/task y /task/{id}/comment) ──────────────────────
interface CampoCU { name?: unknown; value?: unknown }
export interface TareaCruda {
  id?: unknown; name?: unknown; status?: { status?: unknown }; parent?: unknown; url?: unknown; priority?: { priority?: unknown } | null
  date_created?: unknown; date_updated?: unknown; custom_fields?: CampoCU[]; tags?: { name?: unknown }[]
}
export interface ComentarioCrudo { comment_text?: unknown; date?: unknown; comment?: { type?: unknown }[]; text?: unknown; fecha?: unknown }
const isoDeMs = (x: unknown): Iso | null => { const n = Number(x); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null }
const campo = (t: TareaCruda, nombre: RegExp): string | null => {
  const c = (t.custom_fields ?? []).find(f => typeof f.name === 'string' && nombre.test(f.name))
  return c && typeof c.value === 'string' && c.value.trim() ? c.value.trim() : null
}
/** Una tarea cruda de ClickUp (y sus comentarios) → TareaClickUpEdicion. Los autores de los comentarios no se guardan. */
export function tareaDesdeClickUp(t: TareaCruda, comentarios: ComentarioCrudo[] = []): TareaClickUpEdicion {
  return {
    id: String(t.id ?? ''), nombre: String(t.name ?? '').trim(), estado: String(t.status?.status ?? '').trim().toLowerCase(),
    padre: typeof t.parent === 'string' && t.parent ? t.parent : null, url: typeof t.url === 'string' ? t.url : '',
    prioridad: typeof t.priority?.priority === 'string' ? t.priority.priority : null,
    creada: isoDeMs(t.date_created), actualizada: isoDeMs(t.date_updated),
    campos: { paleta: campo(t, /^1\s*-\s*paleta/i), crudo: campo(t, /^2\s*-\s*crudo/i), editado: campo(t, /^3\s*-\s*editado/i) },
    comentarios: comentarios.map(c => ({
      fecha: isoDeMs(c.date) ?? (typeof c.fecha === 'string' ? c.fecha : ''),
      texto: String(c.comment_text ?? c.text ?? ''),
      imagenes: (c.comment ?? []).filter(x => x?.type === 'image' || x?.type === 'attachment').length,
    })),
    etiquetas: (t.tags ?? []).map(x => String(x.name ?? '')).filter(Boolean),
  }
}
/** ¿Hay que leer los comentarios de esta tarea? Solo las activas (lo publicado no se importa). */
export const esActiva = (t: TareaClickUpEdicion): boolean => !!ESTADOS_CLICKUP[norm(t.estado)] || (!t.padre && norm(t.estado) !== 'publicado')

/** "video 3" → {numero 3, tanda null}; "video 2 tanda 3" / "T3 V2" → {numero 2, tanda 3}. */
export function leerNombreVideo(nombre: string): { numero: number | null; tanda: number | null } {
  const t = norm(nombre)
  const v = /\bv(?:ideo)?\s*(\d{1,3})\b/.exec(t)
  const ta = /\bt(?:anda)?\s*(\d{1,3})\b/.exec(t.replace(/\bv(?:ideo)?\s*\d{1,3}\b/, ' '))
  return { numero: v ? Number(v[1]) : null, tanda: ta ? Number(ta[1]) : null }
}

/** La clave del video: T{tanda}-V{n} solo con las dos; si no, CU-<id de ClickUp>. */
export const claveImportada = (t: TareaClickUpEdicion, n: { numero: number | null; tanda: number | null }): string =>
  n.numero !== null && n.tanda !== null ? `T${n.tanda}-V${n.numero}` : `CU-${t.id}`

/** Link de Drive → id y tipo (archivo o carpeta); cualquier otro link queda como "otro" (sin id). */
export function linkDrive(x: string | null): { drive_id: string | null; tipo: 'archivo' | 'carpeta' | 'otro'; url: string } | null {
  const t = (x ?? '').trim()
  if (!t) return null
  const url = urlHttps(t)
  if (!url) return null
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  if (!/^(drive|docs)\.google\.com$/.test(host)) return { drive_id: null, tipo: 'otro', url }
  const id = idDeDrive(url)
  if (!id) return { drive_id: null, tipo: 'otro', url }
  return /\/folders\//.test(url) ? { drive_id: id, tipo: 'carpeta', url: `https://drive.google.com/drive/folders/${id}` }
    : { drive_id: id, tipo: 'archivo', url: `https://drive.google.com/file/d/${id}/view` }
}

const ES_CAPTURA = /\.(png|jpe?g|webp|heic|gif)\b/i
const ES_GUION = /\b(problema|solucion|soluci[oó]n|cta|hook)\b/i
/** Gancho y guion desde los comentarios de la subtarea: el primero corto (una línea) y el largo con las secciones. */
export function ganchoYGuion(comentarios: ComentarioClickUp[]): { gancho: string; guion: string } {
  const textos = comentarios.map(c => c.texto.trim()).filter(t => t && !ES_CAPTURA.test(t.split('\n')[0]) && !/^seg(undo)?\s*\d/i.test(t))
  const guion = textos.find(t => ES_GUION.test(norm(t))) ?? textos.find(t => t.length > 200) ?? ''
  const gancho = textos.find(t => t !== guion && !t.includes('\n') && t.length <= 160) ?? textos.find(t => t !== guion && t.split('\n')[0].length <= 160)?.split('\n')[0] ?? ''
  return { gancho: gancho.replace(/\s+/g, ' ').trim(), guion: guion.replace(/[ \t]+\n/g, '\n').trim() }
}

/** La paleta de un cliente: campo "1 - Paleta de Color" (de la tarjeta o de sus videos) y capturas en los comentarios de la tarjeta. */
export function paletaDeCliente(tarjeta: TareaClickUpEdicion, videos: TareaClickUpEdicion[], ahora: Iso): MarcaImportada['ficha'] | null {
  const valores = [tarjeta, ...videos].map(t => t.campos.paleta?.trim()).filter((x): x is string => !!x)
  const colores: FichaMarca['colores'] = []
  let referencia: FichaMarca['referencia'] = null
  const notas: string[] = []
  for (const v of [...new Set(valores)]) {
    for (const c of coloresDeTexto(v)) if (!colores.some(k => k.hex === c.hex)) colores.push(c)
    const urlCruda = /(https?:\/\/\S+|www\.\S+)/i.exec(v)?.[1] ?? null
    const url = urlCruda ? urlHttps(urlCruda) : null
    if (urlCruda && esAdjuntoClickUp(urlCruda)) {
      referencia ??= { url: tarjeta.url, descripcion: 'archivo adjunto en ClickUp (paleta)' }
    } else if (url) {
      referencia ??= { url, descripcion: 'paleta de ClickUp' }
    } else if (!coloresDeTexto(v).length) {
      notas.push(`paleta en ClickUp: «${v.replace(/\s+/g, ' ').slice(0, 200)}»`)
    } else if (urlCruda && !url) {
      notas.push('la paleta de ClickUp trae un link que no es https')
    }
  }
  const captura = tarjeta.comentarios.find(c => c.imagenes > 0 || ES_CAPTURA.test(c.texto))
  if (captura && !referencia) referencia = { url: tarjeta.url, descripcion: `captura en ClickUp (comentario del ${ddmm(captura.fecha)})` }
  if (!colores.length && !referencia && !notas.length) return null
  const fuentes: FichaMarca['fuentes'] = {}
  if (colores.length) fuentes.colores = { origen: 'clickup', quien: 'importación de ClickUp', cuando: ahora }
  if (referencia) fuentes.referencia = { origen: 'clickup', quien: 'importación de ClickUp', cuando: ahora }
  return { colores, referencia, notas: notas.join(' · ').slice(0, 1000), fuentes }
}

const palabras = (s: string) => claveNombre(s).split(' ').filter(w => w.length >= 3)
/** Distancia de edición (para "De Cempos" ↔ "De Campos"). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length][b.length]
}
/** Cuánto se parece una palabra de ClickUp a una del CRM: igual 1; un tipeo (5+ letras, 1 cambio) 0,8; un apodo que es el comienzo (4+ letras) 0,6. */
function parecido(w: string, c: string): number {
  if (w === c) return 1
  if (w.length >= 5 && c.length >= 5 && distancia(w, c) <= 1) return 0.8
  if (w.length >= 4 && c.length > w.length && c.startsWith(w)) return 0.6
  return 0
}
/** Candidatos para una tarjeta que no cruzó: los clientes del CRM que más se parecen (palabras iguales, tipeos, apodos). */
export function candidatos(nombre: string, crm: ClienteCrm[], max = 3): SinCruzar['candidatos'] {
  const ws = palabras(nombre)
  return crm.map(c => {
    const cs = palabras(c.nombre)
    const puntaje = ws.reduce((s, w) => s + Math.max(0, ...cs.map(x => parecido(w, x))), 0)
    return { id_crm: c.id.toUpperCase(), nombre: c.nombre, puntaje: Math.round(puntaje * 10) / 10 }
  }).filter(c => c.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje || a.nombre.localeCompare(b.nombre)).slice(0, max)
}

/** Arma la propuesta de importación (pura). `fechaCorte` es EDICION_FECHA_CORTE: ahí arranca e01 de los que esperan crudos. */
export function mapearTareas(t: TareaClickUpEdicion[], crm: ClienteCrm[], op: { fechaCorte: Ymd; ahora?: Iso }): PropuestaImportacion {
  const ahora = op.ahora ?? new Date().toISOString()
  const corteIso = `${op.fechaCorte}T03:00:00.000Z`        // 00:00 de Argentina
  const avisos: string[] = []
  const omitidas: PropuestaImportacion['omitidas'] = []
  const tarjetas = t.filter(x => !x.padre)
  const hijas = t.filter(x => x.padre)
  const porId = new Map(t.map(x => [x.id, x]))

  // Cruce tarjeta (nombre de ClickUp) ↔ cliente del CRM: crearCruceCarpetas mira desde el CRM; se invierte
  const buscar = crearCruceCarpetas(tarjetas, x => x.nombre, crm.map(c => c.nombre))
  const clienteDeTarjeta = new Map<string, ClienteCrm>()
  const dobles = new Set<string>()
  for (const c of crm) {
    const tj = buscar(c.nombre)
    if (!tj) continue
    if (clienteDeTarjeta.has(tj.id) && clienteDeTarjeta.get(tj.id)!.id !== c.id) dobles.add(tj.id)
    else clienteDeTarjeta.set(tj.id, c)
  }
  for (const id of dobles) clienteDeTarjeta.delete(id)

  const videos: VideoImportado[] = []
  const sinCruzar = new Map<string, SinCruzar>()
  const conteo: Record<string, number> = {}
  for (const h of hijas) {
    const est = norm(h.estado)
    if (!(est in ESTADOS_CLICKUP)) { omitidas.push({ tarea_id: h.id, nombre: h.nombre, motivo: `estado de ClickUp desconocido: ${h.estado}` }); continue }
    const estado = ESTADOS_CLICKUP[est]
    if (!estado) { conteo[`omitido:${est}`] = (conteo[`omitido:${est}`] ?? 0) + 1; continue }
    const tarjeta = porId.get(h.padre!)
    if (!tarjeta) { omitidas.push({ tarea_id: h.id, nombre: h.nombre, motivo: 'la tarjeta del cliente no está en la lista' }); continue }
    const cliente = clienteDeTarjeta.get(tarjeta.id)
    if (!cliente) {
      const s = sinCruzar.get(tarjeta.id) ?? { tarea_id: tarjeta.id, nombre: tarjeta.nombre, candidatos: candidatos(tarjeta.nombre, crm), videos: 0 }
      s.videos++
      sinCruzar.set(tarjeta.id, s)
      continue
    }
    const n = leerNombreVideo(h.nombre)
    const clave = claveImportada(h, n)
    const { gancho, guion } = ganchoYGuion(h.comentarios)
    const crudo = linkDrive(h.campos.crudo)
    const edit = linkDrive(h.campos.editado)
    const confirmar: string[] = []
    if (est === 'revisión' || est === 'revision') confirmar.push('«revisión» se importa como Con el cliente: confirmar con Aylu')
    if (n.numero === null) confirmar.push(`no se pudo leer el número del video en «${h.nombre}»`)
    else if (n.tanda === null) confirmar.push(`«${h.nombre}» no dice la tanda: queda como ${clave} hasta ubicarlo`)
    if (crudo?.tipo === 'otro') confirmar.push('el crudo no es un link de Drive (queda el link)')
    if (h.campos.editado?.trim() && edit?.tipo !== 'archivo') confirmar.push('el link del editado no es un archivo de Drive')
    if ((estado === 'editado' || estado === 'corregido' || estado === 'con_cliente') && edit?.tipo !== 'archivo') confirmar.push('falta el link al editado')
    if (h.creada && h.creada > corteIso) confirmar.push('la tarea se creó en ClickUp después de la fecha de corte')
    const cuando = h.actualizada ?? ahora
    videos.push({
      clickup_id: h.id, tarea_padre: tarjeta.id, url_tarea: h.url,
      id_crm: cliente.id.toUpperCase(), cliente: cliente.nombre, clave, tanda_guion: n.tanda, numero: n.numero,
      estado, estado_clickup: h.estado, estado_desde: estado === 'esperando_crudos' ? corteIso : h.actualizada,
      prioridad: PRIORIDAD[norm(h.prioridad ?? '')] ?? 'normal',
      gancho, guion_texto: guion,
      crudo, editado: edit?.tipo === 'archivo' ? { drive_id: edit.drive_id, url: edit.url } : null,
      envio_link: estado === 'con_cliente' ? { quien: 'importación de ClickUp', cuando, texto: 'importado de ClickUp (estaba en «revisión»)' } : null,
      confirmar_con_aylu: confirmar, origen: 'clickup',
    })
    conteo[estado] = (conteo[estado] ?? 0) + 1
  }

  // Claves repetidas dentro del mismo cliente (dos "video 3 tanda 1"): la segunda pasa a CU-<id>
  const vistas = new Set<string>()
  for (const v of videos) {
    const k = `${v.id_crm}:${v.clave}`
    if (vistas.has(k)) {
      v.confirmar_con_aylu.push(`clave ${v.clave} repetida en el cliente: queda como CU-${v.clickup_id}`)
      v.clave = `CU-${v.clickup_id}`
    }
    vistas.add(`${v.id_crm}:${v.clave}`)
  }

  const clientes: PropuestaImportacion['clientes'] = []
  const marcas: MarcaImportada[] = []
  for (const tj of tarjetas) {
    const c = clienteDeTarjeta.get(tj.id)
    const suyos = videos.filter(v => v.tarea_padre === tj.id)
    const activa = norm(tj.estado) !== 'publicado' && norm(tj.estado) !== 'publicar'
    if (!c) {
      if (!sinCruzar.has(tj.id) && hijas.some(h => h.padre === tj.id && ESTADOS_CLICKUP[norm(h.estado)])) {
        sinCruzar.set(tj.id, { tarea_id: tj.id, nombre: tj.nombre, candidatos: candidatos(tj.nombre, crm), videos: 0 })
      }
      continue
    }
    // La paleta se importa de TODOS los clientes cruzados (también los que hoy no tienen videos activos: "las 21 paletas")
    const ficha = paletaDeCliente(tj, hijas.filter(h => h.padre === tj.id), ahora)
    if (ficha && !marcas.some(m => m.id_crm === c.id.toUpperCase())) marcas.push({ id_crm: c.id.toUpperCase(), cliente: c.nombre, ficha })
    if (!suyos.length) {
      if (activa) omitidas.push({ tarea_id: tj.id, nombre: tj.nombre, motivo: 'tarjeta activa sin videos activos' })
      else conteo['tarjetas_cerradas'] = (conteo['tarjetas_cerradas'] ?? 0) + 1
      continue
    }
    clientes.push({ tarea_id: tj.id, nombre_clickup: tj.nombre, id_crm: c.id.toUpperCase(), cliente: c.nombre, estado_crm: c.estado, videos: suyos.length })
    if (!/^activo$/i.test(c.estado.trim())) avisos.push(`${c.nombre} (${c.id.toUpperCase()}) tiene videos activos en ClickUp pero en el CRM está «${c.estado}»`)
  }
  if (dobles.size) avisos.push(`${dobles.size} tarjeta(s) de ClickUp calzan con más de un cliente del CRM: quedan sin cruzar`)
  for (const s of sinCruzar.values()) if (!s.candidatos.length) avisos.push(`«${s.nombre}»: sin candidatos en el CRM`)

  return {
    version: VERSION_IMPORTACION, generado: ahora, fecha_corte: op.fechaCorte,
    clientes, videos, marcas, sin_cruzar: [...sinCruzar.values()], omitidas, avisos, conteo,
  }
}

// ── Carga (NO se ejecuta en esta etapa; probada solo con un repositorio falso) ─────────────────────────────────────────
export interface RepoCarga {
  listarVideos(f: { id_crm: IdCrm; incluirFinales: boolean }): Promise<Pick<Video, 'id' | 'clave' | 'clickup_id' | 'origen' | 'estado' | 'version' | 'gancho'>[]>
  crearVideoSiFalta(v: {
    id_crm: IdCrm; cliente: string; clave: string; tanda_guion: number | null; numero: number | null; guion: Video['guion']
    guion_texto: string; gancho: string; estado: EstadoVideo; prioridad: Prioridad; origen: Video['origen']; clickup_id: string | null
  }, actor: Actor): Promise<{ video: Pick<Video, 'id' | 'version' | 'origen' | 'estado' | 'clickup_id' | 'gancho'>; creado: boolean }>
  actualizarVideo(p: { id: number; version: number; actor: Actor; cambios: Partial<Pick<Video, 'editado' | 'envio_link' | 'gancho' | 'prioridad' | 'clickup_id'>>; tipo: 'importado'; nota?: string; datos?: Record<string, unknown> }): Promise<{ ok: boolean }>
  /** ¿El video tiene acciones de personas? (un video del doc sin acciones de personas se completa con lo de ClickUp). */
  tieneAccionesDePersonas(video_id: number): Promise<boolean>
  leerMarca(id: IdCrm): Promise<unknown | null>
  guardarMarca(id: IdCrm, ficha: { id_crm: IdCrm; colores: FichaMarca['colores']; tipografias: string[]; logo: null; referencia: FichaMarca['referencia']; carpeta_marca: null; fuentes: FichaMarca['fuentes']; notas: string }, version: null, actor: { rol: 'tomas'; nombre: string; email: string }): Promise<{ ok: boolean }>
}
export interface ResultadoCarga { creados: number; completados: number; ya_estaban: number; conflictos: { clickup_id: string; clave: string; motivo: string }[]; marcas: number }

/** Carga la propuesta: idempotente por clickup_id, con origen clickup. Nunca pisa un video con acciones de personas ni una marca existente. */
export async function cargarPropuesta(prop: PropuestaImportacion, repo: RepoCarga): Promise<ResultadoCarga> {
  const actor: Actor = { tipo: 'bot', proceso: 'importacion' }
  const r: ResultadoCarga = { creados: 0, completados: 0, ya_estaban: 0, conflictos: [], marcas: 0 }
  const porCliente = new Map<IdCrm, Awaited<ReturnType<RepoCarga['listarVideos']>>>()
  for (const v of prop.videos) {
    const existentes = porCliente.get(v.id_crm) ?? await repo.listarVideos({ id_crm: v.id_crm, incluirFinales: true })
    porCliente.set(v.id_crm, existentes)
    if (existentes.some(e => e.clickup_id === v.clickup_id)) { r.ya_estaban++; continue }
    const datos = { clickup: { id: v.clickup_id, url: v.url_tarea, estado: v.estado_clickup, version: prop.version }, crudo: v.crudo, confirmar_con_aylu: v.confirmar_con_aylu }
    const cambios = { editado: v.editado ? { archivo_id: null, url: v.editado.url } : null, envio_link: v.envio_link, gancho: v.gancho }
    const res = await repo.crearVideoSiFalta({
      id_crm: v.id_crm, cliente: v.cliente, clave: v.clave, tanda_guion: v.tanda_guion, numero: v.numero, guion: null,
      guion_texto: v.guion_texto, gancho: v.gancho, estado: v.estado, prioridad: v.prioridad, origen: 'clickup', clickup_id: v.clickup_id,
    }, actor)
    if (res.creado) {
      await repo.actualizarVideo({ id: res.video.id, version: res.video.version, actor, cambios, tipo: 'importado', nota: 'importado de ClickUp', datos })
      r.creados++
      continue
    }
    // Ya había un video con esa clave: si salió del doc, sigue esperando crudos y nadie lo tocó, se completa con lo de ClickUp
    const e = res.video
    if (e.clickup_id === v.clickup_id) { r.ya_estaban++; continue }
    if (e.origen === 'doc' && e.estado === 'esperando_crudos' && v.estado === 'esperando_crudos' && !e.clickup_id && !(await repo.tieneAccionesDePersonas(e.id))) {
      // Completar de verdad: el id de ClickUp (la próxima carga lo reconoce y no repite), la prioridad y lo que el doc no
      // trae (gancho vacío, link al editado). El guion del doc manda sobre el de los comentarios.
      const completar: Parameters<RepoCarga['actualizarVideo']>[0]['cambios'] = { clickup_id: v.clickup_id, prioridad: v.prioridad,
        ...(!e.gancho?.trim() && v.gancho ? { gancho: v.gancho } : {}), ...(v.editado ? { editado: { archivo_id: null, url: v.editado.url } } : {}) }
      const u = await repo.actualizarVideo({ id: e.id, version: e.version, actor, cambios: completar, tipo: 'importado', nota: 'completado con ClickUp', datos })
      if (u.ok) { r.completados++; continue }
      r.conflictos.push({ clickup_id: v.clickup_id, clave: v.clave, motivo: `${v.clave} cambió mientras se completaba: volver a correr la carga` })
      continue
    }
    r.conflictos.push({ clickup_id: v.clickup_id, clave: v.clave, motivo: `ya existe ${v.clave} (${e.origen}, ${e.estado}): lo decide Aylu` })
  }
  for (const m of prop.marcas) {
    if (await repo.leerMarca(m.id_crm)) continue
    const g = await repo.guardarMarca(m.id_crm, { id_crm: m.id_crm, colores: m.ficha.colores, tipografias: [], logo: null, referencia: m.ficha.referencia, carpeta_marca: null, fuentes: m.ficha.fuentes, notas: m.ficha.notas },
      null, { rol: 'tomas', nombre: 'importación de ClickUp', email: '' })
    if (g.ok) r.marcas++
  }
  return r
}
