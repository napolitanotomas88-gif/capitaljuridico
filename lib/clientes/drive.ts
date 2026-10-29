// ── Drive: la carpeta de cada cliente (Clientes / "Nombre - SKWD" o "- C.J") (SOLO servidor) ─────────────────────
// Pedido de Tomás (9/10/2026): medir los guiones con lo que REALMENTE se hizo. Cada carpeta de cliente tiene:
//   · "Guiones - X" (Google Doc): fecha de la última modificación y quién lo tocó = el último guion escrito.
//   · "Crudos - X": los videos grabados en bruto = la prueba de que SE GRABÓ (y cuándo).
//   · "Editados - X": los videos editados.
// La carpeta Clientes se configura por entorno y requiere acceso explícito de la cuenta de servicio; se recorre
// carpeta por carpeta (Drive no permite consultas "o" sobre carpetas compartidas por enlace), en paralelo y con caché de 30 min.
import { googleJson } from '../auth/googleRest'
import { conCache } from '../anuncios/cache'
import type { Ymd } from './fechas'

export const CARPETA_CLIENTES = process.env.DRIVE_CARPETA_CLIENTES?.trim() ?? ''
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const CARPETA = 'application/vnd.google-apps.folder'

export interface ArchivosCarpeta { cantidad: number; ultimo: Ymd | null; url: string; primero?: Ymd | null }   // primero: el archivo más viejo (registro de hitos)
export interface CarpetaCliente {
  id: string
  nombre: string               // el nombre de la carpeta sin el sufijo ("Jonathan Correa")
  url: string
  guion: { modificado: Ymd; creado: Ymd | null; por: string | null; url: string } | null
  crudos: ArchivosCarpeta | null
  editados: ArchivosCarpeta | null
}

type Archivo = { id: string; name: string; mimeType: string; createdTime?: string; modifiedTime?: string; lastModifyingUser?: { displayName?: string } }
const ymd = (iso?: string): Ymd | null => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) : null)

async function hijos(id: string): Promise<Archivo[]> {
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(id)) throw new Error('Falta una carpeta Drive configurada válida');
  const out: Archivo[] = []
  let token = ''
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`)
    const r = await googleJson<{ files?: Archivo[]; nextPageToken?: string }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,lastModifyingUser(displayName))&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? `&pageToken=${token}` : ''}`,
      { scopes: SCOPE })
    out.push(...(r.files ?? []))
    token = r.nextPageToken ?? ''
  } while (token)
  return out
}

/** Ejecuta en paralelo con un máximo de `n` a la vez */
async function enParalelo<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

/** Archivos (no carpetas) de una carpeta y de sus subcarpetas directas (a veces los crudos van por fecha) */
async function resumirArchivos(dir: Archivo): Promise<ArchivosCarpeta> {
  const n1 = await hijos(dir.id)
  const subs = n1.filter(x => x.mimeType === CARPETA)
  const n2 = (await enParalelo(subs, 4, s => hijos(s.id))).flat()
  const archivos = [...n1, ...n2].filter(x => x.mimeType !== CARPETA)
  const fechas = archivos.map(a => ymd(a.createdTime)).filter((x): x is string => !!x).sort()
  return { cantidad: archivos.length, ultimo: fechas.at(-1) ?? null, primero: fechas[0] ?? null, url: `https://drive.google.com/drive/folders/${dir.id}` }
}

export async function leerDeDrive(): Promise<CarpetaCliente[]> {
  const carpetas = (await hijos(CARPETA_CLIENTES)).filter(c => c.mimeType === CARPETA && !/^ex\s*clientes?$/i.test(c.name.trim()))
  return enParalelo(carpetas, 8, async c => {
    const h = await hijos(c.id)
    const doc = h.filter(x => /gui[oó]n/i.test(x.name) && x.mimeType === 'application/vnd.google-apps.document').sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))[0]
    const dirCrudos = h.find(x => x.mimeType === CARPETA && /crudo/i.test(x.name))
    const dirEditados = h.find(x => x.mimeType === CARPETA && /editad/i.test(x.name))
    const [crudos, editados] = await Promise.all([dirCrudos ? resumirArchivos(dirCrudos) : null, dirEditados ? resumirArchivos(dirEditados) : null])
    return {
      id: c.id, nombre: c.name.replace(/\s*-\s*(skwd|c\.?\s*j\.?|capital jur[ií]dico)\s*$/i, '').trim(), url: `https://drive.google.com/drive/folders/${c.id}`,
      guion: doc ? { modificado: ymd(doc.modifiedTime)!, creado: ymd(doc.createdTime), por: doc.lastModifyingUser?.displayName ?? null, url: `https://docs.google.com/document/d/${doc.id}` } : null,
      crudos, editados,
    }
  })
}

/** Carpetas de clientes en Drive (caché de 30 min compartida). Espera hasta `esperaMs`; si no llega, sigue sin Drive y avisa. */
export async function carpetasDrive(esperaMs = 9000): Promise<{ carpetas: CarpetaCliente[]; aviso: string | null }> {
  try {
    const r = await Promise.race([conCache('drive-clientes-v2', 1800, leerDeDrive), new Promise<null>(res => setTimeout(() => res(null), esperaMs))])
    if (!r) return { carpetas: [], aviso: 'Drive tardó en responder: se muestra sin el dato de guiones y videos grabados reales (recargá en un minuto).' }
    return { carpetas: r.data, aviso: r.viejo ? 'Drive no respondió: datos de la última lectura.' : null }
  } catch (e) {
    console.error('[drive] no se pudo leer:', (e as Error).message?.slice(0, 120))
    return { carpetas: [], aviso: 'No se pudo leer Drive: sin el dato de guiones y videos grabados reales.' }
  }
}
