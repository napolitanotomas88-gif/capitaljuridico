// ── Línea de base del Doc de ADS: lo que YA ESTABA en el Doc no se procesa nunca ────────────────────────────────────────
// Pedido de Tomás (3/11/2026): «solo tenés que avanzar cuando aparecen nuevos en el documento, porque la mayoría de los que
// me nombraste ya están lanzados, solo que permanecieron en el documento». El Doc «Organización de ADS - Orgánico» guarda
// los bloques viejos de clientes ya lanzados: el bot no les arma nada ni avisa por ellos.
// Una «huella» por bloque (cliente) y por video (su archivo de Drive, o el número si no tiene link), guardada en Neon
// (cj_anuncios_doc_base, docAdsBaseNeon.ts) con su estado:
//   · base       → estaba en el Doc el día de la línea de base: no se procesa nunca;
//   · procesado  → el bot ya lo armó o ya avisó: tampoco se vuelve a procesar;
//   · pendiente  → excepción explícita (se trata como nuevo hasta que se procese).
// Es NUEVO: un bloque (cliente) que no estaba, un bloque que antes no decía LISTO y ahora sí, o un video que no estaba.
// Acá, PURO (lo prueba scripts/test-bot-anuncios-doc-ads.mjs).
import { tokens, type BloqueDoc, type VideoDoc } from './docAds'

export type EstadoHuella = 'base' | 'pendiente' | 'procesado'
export interface FilaBase { huella: string; tipo: 'bloque' | 'video'; bloque: string; listo: boolean; estado: EstadoHuella; nombre: string }
export interface LineaBase { bloques: Map<string, { listo: boolean; estado: EstadoHuella }>; videos: Map<string, EstadoHuella> }

/** La clave de un bloque: las palabras del nombre, normalizadas y ordenadas («Pérez Juana» = «Juana Perez»). */
export const claveBloque = (nombre: string): string => [...new Set(tokens(nombre))].sort().join('-') || nombre.trim().toLowerCase()
/** La huella de un video: su archivo de Drive (el mismo archivo en otro bloque es el mismo video) o bloque + número. */
export const huellaVideo = (bloque: string, v: Pick<VideoDoc, 'drive' | 'numero'>): string => v.drive ? `v:${v.drive}` : `v:${bloque}#${v.numero}`
export const huellaBloque = (bloque: string): string => `b:${bloque}`

/** Las filas de la línea de base del Doc de hoy. El estado del bloque es el de su bloque MÁS ARRIBA (lo más nuevo). */
export function filasLineaBase(bloques: readonly BloqueDoc[], pendiente: (b: BloqueDoc) => boolean = () => false): FilaBase[] {
  const out = new Map<string, FilaBase>()
  for (const b of bloques) {
    const k = claveBloque(b.nombre)
    const estado: EstadoHuella = pendiente(b) ? 'pendiente' : 'base'
    const hb = huellaBloque(k)
    if (!out.has(hb)) out.set(hb, { huella: hb, tipo: 'bloque', bloque: k, listo: b.listo, estado, nombre: b.nombre })
    else if (estado === 'pendiente') out.get(hb)!.estado = 'pendiente'
    for (const v of b.videos) {
      const hv = huellaVideo(k, v)
      const ya = out.get(hv)
      if (!ya) out.set(hv, { huella: hv, tipo: 'video', bloque: k, listo: b.listo, estado, nombre: b.nombre })
      else if (estado === 'pendiente') ya.estado = 'pendiente'
    }
  }
  return [...out.values()]
}

export function lineaBaseDe(filas: readonly Pick<FilaBase, 'huella' | 'tipo' | 'bloque' | 'listo' | 'estado'>[]): LineaBase {
  const bloques = new Map<string, { listo: boolean; estado: EstadoHuella }>(), videos = new Map<string, EstadoHuella>()
  for (const f of filas) {
    if (f.tipo === 'bloque') bloques.set(f.bloque, { listo: f.listo, estado: f.estado })
    else videos.set(f.huella, f.estado)
  }
  return { bloques, videos }
}

export interface Novedad {
  /** El bloque es nuevo: no estaba, estaba pendiente o pasó a LISTO (antes decía otra cosa). Todos sus videos cuentan como nuevos. */
  bloqueNuevo: boolean
  /** Por qué es nuevo (para el tablero y el resultado). */
  motivo: 'no_estaba' | 'pendiente' | 'paso_a_listo' | 'videos_nuevos' | null
  videosNuevos: VideoDoc[]
  /** Todo lo del bloque ya estaba (línea de base) o ya se procesó: el bot no hace nada. */
  historico: boolean
}

const vigente = (e: EstadoHuella | undefined) => e === 'base' || e === 'procesado'

/** Qué hay de nuevo en un bloque respecto de la línea de base. Puro. */
export function novedad(b: BloqueDoc, base: LineaBase): Novedad {
  const k = claveBloque(b.nombre)
  const eb = base.bloques.get(k)
  // Un bloque «nuevo» cuyos videos (con link) ya estaban todos: es un bloque viejo renombrado o repetido (corrigieron el
  // nombre, lo copiaron arriba): sigue siendo histórico
  const conLink = b.videos.filter(v => v.drive)
  if (!eb && conLink.length && conLink.every(v => vigente(base.videos.get(huellaVideo(k, v))))) return { bloqueNuevo: false, motivo: null, videosNuevos: [], historico: true }
  const motivo: Novedad['motivo'] = !eb ? 'no_estaba' : eb.estado === 'pendiente' ? 'pendiente' : b.listo && !eb.listo ? 'paso_a_listo' : null
  if (motivo) return { bloqueNuevo: true, motivo, videosNuevos: [...b.videos], historico: false }
  const videosNuevos = b.videos.filter(v => !vigente(base.videos.get(huellaVideo(k, v))))
  return { bloqueNuevo: false, motivo: videosNuevos.length ? 'videos_nuevos' : null, videosNuevos, historico: !videosNuevos.length }
}

/** Las huellas a marcar «procesado» después de armar o avisar: el bloque (con su LISTO) y los videos usados. */
export function filasProcesadas(b: BloqueDoc, videos: readonly Pick<VideoDoc, 'drive' | 'numero'>[]): FilaBase[] {
  const k = claveBloque(b.nombre)
  return [
    { huella: huellaBloque(k), tipo: 'bloque', bloque: k, listo: b.listo, estado: 'procesado', nombre: b.nombre },
    ...videos.map(v => ({ huella: huellaVideo(k, v), tipo: 'video' as const, bloque: k, listo: b.listo, estado: 'procesado' as const, nombre: b.nombre })),
  ]
}
