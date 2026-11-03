// ── Dependencias reales del Doc de ADS (Drive con la cuenta de servicio, Meta, Neon, Discord) ──────────────────────
// La lectura del Doc está en docAdsLeer.ts (ANUNCIOS_DOC_ADS_ID; ANUNCIOS_DOC_ADS=0 apaga la corrida). Solo servidor.
import type { PorLanzar, Tablero } from '@/lib/anuncios/tablero'
import { googleJson } from '@/lib/auth/googleRest'
import { clienteOperativo } from '@/lib/clientes/colasOperativas'
import { lectorReal } from '@/lib/bot/grabacion/drive'
import type { ZonaFicha } from '@/lib/bot/kickoff/tipos'
import { borradorPermitido, crearGraph, esErrorPausa, type DepsBorrador, type Graph } from './borrador'
import { escribirTextos, gruposConTextos } from './copys'
import { armarLanzamiento } from './lanzamiento'
import { estimarHabitantes } from './habitantes'
import { avisarSiNoQuedoEnPausa } from './avisoPausa'
import { alertar } from '@/lib/alertas'
import { mencionesKickoff } from '@/lib/bot/kickoff/entorno'
import { marcarAvisoDudoso, marcarAvisoEnviado, reclamarAviso, soltarAviso } from './registro'
import { depsSeguimiento } from './servidor'
import { guionDesdeCopy } from './docAds'
import { lanzarDesdeDoc, type DepsDocAds, type PedidoSeco, type ResultadoDoc } from './docAdsLanzar'
import type { GuionDoc } from '@/lib/edicion/tipos'
import { docAdsEncendido, leerDocAds } from './docAdsLeer'

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const API = 'https://www.googleapis.com/drive/v3'
const CARPETA = 'application/vnd.google-apps.folder'
const idValido = (id: string) => /^[A-Za-z0-9_-]{10,80}$/.test(id)


/** Nombre y md5 de un archivo de Drive, o null si la cuenta de servicio no lo puede leer (sin compartir / borrado). */
async function archivo(id: string): Promise<{ nombre: string; md5: string | null; video: boolean } | null> {
  if (!idValido(id)) return null
  try {
    const r = await googleJson<{ name?: string; mimeType?: string; md5Checksum?: string; trashed?: boolean }>(`${API}/files/${id}?fields=name,mimeType,md5Checksum,trashed&supportsAllDrives=true`, { scopes: SCOPE })
    if (r.trashed) return null
    return { nombre: r.name ?? id, md5: r.md5Checksum ?? null, video: (r.mimeType ?? '').startsWith('video/') }
  } catch {
    return null
  }
}

type ArchivoApi = { id: string; name: string; mimeType: string; md5Checksum?: string }
async function hijos(id: string): Promise<ArchivoApi[]> {
  const out: ArchivoApi[] = []
  let token = ''
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`)
    const r = await googleJson<{ files?: ArchivoApi[]; nextPageToken?: string }>(`${API}/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,md5Checksum)&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? `&pageToken=${token}` : ''}`, { scopes: SCOPE })
    out.push(...(r.files ?? []))
    token = r.nextPageToken ?? ''
  } while (token)
  return out
}

/** Los videos de «Editados - X» del cliente (la carpeta que ya encontró el tablero) y el doc de guiones. */
async function editados(pl: PorLanzar): Promise<{ id: string; nombre: string; md5: string | null; guionesDoc: string | null }[]> {
  const carpeta = pl.editados?.url?.match(/folders\/([A-Za-z0-9_-]{10,80})/)?.[1]
  if (!carpeta) return []
  const n1 = await hijos(carpeta)
  const n2 = (await Promise.all(n1.filter(x => x.mimeType === CARPETA).map(s => hijos(s.id)))).flat()
  let guionesDoc: string | null = null
  try {
    const { carpetasDrive } = await import('@/lib/clientes/drive')
    const { carpetaDe } = await import('@/lib/anuncios/editadosPorLanzar')
    const c = carpetaDe(pl.cliente, (await carpetasDrive(20_000)).carpetas)
    guionesDoc = c?.guion?.url.match(/document\/d\/([A-Za-z0-9_-]{10,80})/)?.[1] ?? null
  } catch { guionesDoc = null }
  return [...n1, ...n2].filter(x => x.mimeType.startsWith('video/')).map(x => ({ id: x.id, nombre: x.name, md5: x.md5Checksum ?? null, guionesDoc }))
}

/**
 * Un Graph que LEE de Meta de verdad y NO escribe: cada POST se anota y devuelve un id falso («seco_N»); lo que se lee de
 * esos ids (estado del video, miniaturas, estado de pausa) se contesta acá. Para la prueba en seco del armado.
 */
export function graphSeco(real: Graph): { graph: Graph; pedidos: PedidoSeco[] } {
  const pedidos: PedidoSeco[] = []
  let n = 0
  return {
    pedidos,
    graph: {
      get: async (ruta, q) => {
        if (ruta.startsWith('seco_')) {
          if (ruta.endsWith('/thumbnails')) return { data: [{ uri: 'https://example.invalid/miniatura.jpg', is_preferred: true }] }
          return q?.fields === 'status' ? { status: { video_status: 'ready' } } : { status: 'PAUSED', effective_status: 'PAUSED' }
        }
        return real.get(ruta, q)
      },
      post: async (ruta, cuerpo) => { pedidos.push({ ruta, cuerpo }); return { id: `seco_${++n}` } },
    },
  }
}

export function depsDocAdsReales(t: Pick<Tablero, 'filas'>): DepsDocAds {
  const s = depsSeguimiento()
  const token = process.env.META_ANUNCIOS_TOKEN?.trim() || ''
  const usdPor = (m: string) => m.toUpperCase() === 'USD' ? 1 : t.filas.find(f => f.moneda?.toUpperCase() === m.toUpperCase() && f.usdPor)?.usdPor ?? null
  const copys = { exportarTexto: (id: string) => lectorReal().exportarTexto(id), escribir: escribirTextos }
  return {
    leerDoc: leerDocAds,
    archivo,
    editados,
    gruposExtra: async sub => (await gruposConTextos(sub, sub.guionesDoc ?? null, copys)).grupos,
    variacion: async cs => escribirTextos(cs.map((c, i) => ({ ...guionDesdeCopy(c, i + 1), estado_doc: 'ok', titulo: '', frases: [], huella: '' }) as unknown as GuionDoc)),
    campanas: async cuenta => {
      if (!token) throw new Error('falta META_ANUNCIOS_TOKEN')
      const r = await crearGraph(token).get(`${cuenta}/campaigns`, { fields: 'name,created_time,effective_status', limit: '50' })
      return ((r.data ?? []) as { name?: string; created_time?: string; effective_status?: string }[])
        .filter(c => c.effective_status !== 'DELETED' && c.effective_status !== 'ARCHIVED')
        .map(c => ({ nombre: c.name ?? '', creada: c.created_time ?? '' }))
    },
    permitido: c => !!token && borradorPermitido(c),
    armar: async (sub, pl, grupos, op) => {
      if (!token) throw new Error('falta META_ANUNCIOS_TOKEN')
      const real = crearGraph(token)
      const seco = op.seco ? graphSeco(real) : null
      const graph: Graph = seco ? seco.graph : { ...real, post: async (ruta, cuerpo) => {
        if (!await clienteOperativo(null, pl.cliente)) throw Object.assign(new Error('Cliente archivado: no se crean anuncios nuevos'), { transitorio: false })
        return real.post(ruta, cuerpo)
      } }
      const base: DepsBorrador = { graph, esperar: ms => new Promise<void>(r => setTimeout(r, ms)), ahora: () => Date.now() }
      const z = pl.kickoff!.zona
      const habitantes = async () => (await estimarHabitantes({ descripcion: z.descripcion, lugares: z.lugares, radio_km: z.radioKm, pais: z.pais ?? null } as ZonaFicha, 40_000)).habitantes
      const armar = () => armarLanzamiento(sub, pl, grupos, { ...base, usdPor, habitantes }, op.deadline)
      const borrador = seco ? await armar() : await avisarSiNoQuedoEnPausa(armar, { cliente: pl.cliente, cuenta: pl.kickoff!.cuenta?.id ?? '' }, { alertar, esErrorPausa })
      return { borrador, pedidos: seco?.pedidos ?? null }
    },
    reclamar: reclamarAviso,
    marcarEnviado: marcarAvisoEnviado,
    marcarDudoso: marcarAvisoDudoso,
    soltar: soltarAviso,
    enviar: s.enviar,
    valentino: s.valentino,
    tomas: mencionesKickoff().tomi,
    ahora: () => Date.now(),
  }
}

/** Lo que llaman la alerta de las 9:05 y el botón de /anuncios. Nunca tira. */
export async function correrDocAds(t: Tablero, op: { dry?: boolean; seco?: boolean; solo?: string | null; deadline?: number } = {}): Promise<ResultadoDoc | { apagado: true }> {
  if (!docAdsEncendido() && !op.seco && !op.dry) return { apagado: true }
  try {
    return await lanzarDesdeDoc(t, depsDocAdsReales(t), op)
  } catch (e) {
    return { leido: false, bloques: 0, clientes: [], errores: [String((e as Error)?.message ?? e).slice(0, 200)] }
  }
}
