// ── g01 · Lectura de «Editados - X» en Drive (cuenta de servicio, solo lectura) ─────────────────────
// Carpeta «Clientes» (DRIVE_CARPETA_CLIENTES, compartida por enlace: se recorre carpeta por carpeta, ver
// lib/clientes/drive.ts) → «<Cliente> - SKWD / - C.J» → la subcarpeta con «editad» en el nombre → sus videos sueltos y
// los de sus subcarpetas directas (las tandas). Solo trae videos subidos después de `desde`. Solo servidor.
import { googleJson } from '@/lib/auth/googleRest'
import { CARPETA_CLIENTES } from '@/lib/clientes/drive'
import type { CarpetaTanda, EditadosCliente } from './videos'

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const CARPETA = 'application/vnd.google-apps.folder'
const DOC = 'application/vnd.google-apps.document'
type Archivo = { id: string; name: string; mimeType: string; createdTime?: string }

async function hijos(id: string, filtro = ''): Promise<Archivo[]> {
  const out: Archivo[] = []
  let token = ''
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false${filtro}`)
    const r = await googleJson<{ files?: Archivo[]; nextPageToken?: string }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? `&pageToken=${token}` : ''}`,
      { scopes: SCOPE })
    out.push(...(r.files ?? []))
    token = r.nextPageToken ?? ''
  } while (token)
  return out
}

async function enParalelo<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

const videos = (xs: Archivo[]) => xs.filter(x => x.mimeType.startsWith('video/') && x.createdTime).map(x => ({ id: x.id, nombre: x.name, creado: x.createdTime! }))

export async function leerEditados(desde: string): Promise<EditadosCliente[]> {
  const soloNuevos = ` and (mimeType = '${CARPETA}' or (mimeType contains 'video/' and createdTime > '${new Date(desde).toISOString().replace(/\.\d{3}Z$/, 'Z')}'))`
  const clientes = (await hijos(CARPETA_CLIENTES, ` and mimeType = '${CARPETA}'`)).filter(c => !/^ex\s*clientes?$/i.test(c.name.trim()))
  const leidos = await enParalelo(clientes, 8, async (c): Promise<EditadosCliente | null> => {
    const h = await hijos(c.id, ` and (mimeType = '${CARPETA}' or mimeType = '${DOC}')`)
    const ed = h.find(x => x.mimeType === CARPETA && /editad/i.test(x.name))
    const guionesDoc = h.find(x => x.mimeType === DOC && /gui[oó]n/i.test(x.name))?.id ?? null   // «Guiones - X» (copys.ts)
    if (!ed) return null
    const n1 = await hijos(ed.id, soloNuevos)
    const subs = n1.filter(x => x.mimeType === CARPETA)
    const tandas: CarpetaTanda[] = [{ id: ed.id, nombre: ed.name, videos: videos(n1) }]
    for (const s of subs) tandas.push({ id: s.id, nombre: s.name, videos: videos(await hijos(s.id, soloNuevos)) })
    return { carpetaCliente: c.name, editadosId: ed.id, guionesDoc, tandas: tandas.filter(t => t.videos.length) }
  })
  return leidos.filter((x): x is EditadosCliente => !!x && x.tandas.length > 0)
}
