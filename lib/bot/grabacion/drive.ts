// ── Lector de Drive para el vigía (cuenta de servicio, solo lectura) ─────────────────────────────────────────────────
// Interfaz inyectable (LectorDrive): los tests usan un Drive de juguete; lectorReal() usa la cuenta de servicio con el
// permiso drive.readonly. Se copia el patrón de hijos() / enParalelo() de lib/clientes/drive.ts (de otra sesión: no se toca).
//   · listarCambios(carpeta, desde): `'<id>' in parents and createdTime > '<desde>' and trashed=false` (lo que probó el
//     relevamiento con carpetas compartidas por enlace; el `or` entre padres falla y modifiedTime puede traer la fecha local
//     del archivo). desde = null → la carpeta nunca se consultó: se lista entera. Lo movido o modificado lo ve la pasada
//     completa (listarArbol).
//   · `subio`: el dueño del archivo se compara con EDICION_EQUIPO_DRIVE (mails o @dominios, separados por coma) y el mail se
//     descarta enseguida: nunca sale de acá.
//   · exportarTexto: files/{id}/export?mimeType=text/plain (la API de Docs da 403 con estas carpetas).
// La URL, el token y los mails nunca van a un mensaje de error (googleJson ya devuelve solo el código).
import { createSign } from 'node:crypto'
import { googleJson } from '@/lib/auth/googleRest'
import type { ArchivoDrive, CarpetaGrabacion, Iso, QuienSubio } from '@/lib/edicion/tipos'
import { NIVELES_ARBOL } from '@/lib/edicion/config'

export const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.readonly'
export const MIME_CARPETA = 'application/vnd.google-apps.folder'
export const MIME_DOC = 'application/vnd.google-apps.document'
export const CARPETA_CLIENTES_POR_DEFECTO = ''
const API = 'https://www.googleapis.com/drive/v3'
const CAMPOS = 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents,owners(emailAddress),videoMediaMetadata(width,height,durationMillis))'

export interface ClienteDrive {
  carpeta: CarpetaGrabacion; crudos: string | null; editados: string | null; marca: string | null
  guiones_doc: string | null; guiones_modificado: Iso | null
}
export interface LectorDrive {
  listarCambios(carpeta: CarpetaGrabacion, desde: Iso | null): Promise<{ archivos: ArchivoDrive[]; carpetas: CarpetaGrabacion[] }>
  listarArbol(raiz: CarpetaGrabacion, maxNivel: number): Promise<{ archivos: ArchivoDrive[]; carpetas: CarpetaGrabacion[]; completo: boolean }>
  carpetasClientes(): Promise<ClienteDrive[]>
  metadatosDoc(docId: string): Promise<{ modificado: Iso }>
  exportarTexto(docId: string): Promise<string>
  /** Baja el contenido de un archivo (e05: lo que el cliente sube a "Marca - X"). Tira si pasa de maxBytes. Opcional: los
   *  lectores de juguete de los tests no lo traen. */
  descargar?(fileId: string, maxBytes: number): Promise<Buffer>
  consultas(): number
}

/** Un archivo crudo de la API de Drive (lo que piden los campos de arriba). */
export interface ArchivoApi {
  id: string; name: string; mimeType: string; size?: string; createdTime?: string; modifiedTime?: string; parents?: string[]
  owners?: { emailAddress?: string }[]; videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string | number }
}

// ── Quién subió (sin guardar el mail) ──────────────────────────────────────────────────────────────────────────────
export function equipoDrive(env: Record<string, string | undefined> = process.env): string[] {
  return (env.EDICION_EQUIPO_DRIVE ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
}
export function quienSubio(owners: ArchivoApi['owners'], equipo: readonly string[]): QuienSubio {
  const mail = owners?.find(o => typeof o.emailAddress === 'string')?.emailAddress?.trim().toLowerCase()
  if (!mail) return 'desconocido'
  const dominio = mail.slice(mail.indexOf('@'))
  return equipo.some(e => e === mail || (e.startsWith('@') && e === dominio)) ? 'equipo' : 'cliente'
}

const numero = (x: unknown): number | null => (x === undefined || x === null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x))

/** De archivo de la API a ArchivoDrive (el mail del dueño se usa y se descarta acá). */
export function aArchivoDrive(f: ArchivoApi, carpeta: CarpetaGrabacion, equipo: readonly string[]): ArchivoDrive {
  const v = f.videoMediaMetadata
  return {
    drive_id: f.id, nombre: f.name ?? '', mime: f.mimeType ?? '', carpeta_id: carpeta.drive_id,
    ruta: carpeta.tipo === 'sub' ? carpeta.ruta : [],
    bytes: numero(f.size), duracion_ms: numero(v?.durationMillis), ancho: numero(v?.width), alto: numero(v?.height),
    creado: f.createdTime ?? '', modificado: f.modifiedTime ?? f.createdTime ?? '', subio: quienSubio(f.owners, equipo),
  }
}

/** Una subcarpeta nueva debajo de `padre` (hereda cliente, raíz y vínculo; vigilar = true). */
export function subcarpeta(f: ArchivoApi, padre: CarpetaGrabacion): CarpetaGrabacion {
  return {
    drive_id: f.id, nombre: f.name ?? '', padre_id: padre.drive_id, nivel: padre.nivel + 1,
    ruta: [...(padre.tipo === 'sub' ? padre.ruta : []), f.name ?? ''],
    id_crm: padre.id_crm, tipo: 'sub', raiz: padre.raiz, raiz_id: padre.raiz_id ?? padre.drive_id,
    vinculo: padre.vinculo, candidatos: [], vigilar: true, creada: f.createdTime ?? null, ultimo_archivo: null, consultada: null, borrada: null,
  }
}

/** Drive quiere RFC 3339 sin milisegundos (UTC). */
export const fechaDrive = (iso: Iso): string => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z')

const sufijoCliente = /\s*-\s*(skwd|c\.?\s*j\.?|capital jur[ií]dico)\s*$/i
export const nombreSinSufijo = (s: string): string => s.replace(sufijoCliente, '').trim()

// ── Implementación real ─────────────────────────────────────────────────────────────────────────────────────────
async function enParalelo<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

// Token propio solo para exportar texto (googleJson parsea JSON y el export devuelve texto plano)
let tokenTexto: { valor: string; vence: number } | null = null
async function tokenDrive(): Promise<string> {
  if (tokenTexto && tokenTexto.vence > Date.now() + 60_000) return tokenTexto.valor
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  let k = (process.env.GOOGLE_PRIVATE_KEY ?? '').trim()
  if (!email || !k) throw new Error('Falta la cuenta de servicio de Google')
  const m = /^(["'])([\s\S]*)\1$/.exec(k)
  if (m) k = m[2].trim()
  k = `${k.replace(/\\r\\n|\\n/g, '\n').trim()}\n`
  const b64u = (b: string) => Buffer.from(b).toString('base64url')
  const ahora = Math.floor(Date.now() / 1000)
  const aud = 'https://oauth2.googleapis.com/token'
  const cab = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const carga = b64u(JSON.stringify({ iss: email, scope: SCOPE_DRIVE, aud, iat: ahora, exp: ahora + 3600 }))
  const firma = createSign('RSA-SHA256').update(`${cab}.${carga}`).sign(k).toString('base64url')
  const r = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cab}.${carga}.${firma}` }),
    signal: AbortSignal.timeout(8_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`Google rechazó la cuenta de servicio (${r.status})`)
  const j = (await r.json()) as { access_token: string; expires_in: number }
  tokenTexto = { valor: j.access_token, vence: Date.now() + j.expires_in * 1000 }
  return tokenTexto.valor
}

export function lectorReal(env: Record<string, string | undefined> = process.env): LectorDrive {
  let n = 0
  const equipo = equipoDrive(env)
  const raizClientes = env.DRIVE_CARPETA_CLIENTES?.trim() || CARPETA_CLIENTES_POR_DEFECTO

  async function listar(q: string, campos = CAMPOS): Promise<ArchivoApi[]> {
    const out: ArchivoApi[] = []
    let token = ''
    do {
      n++
      const r = await googleJson<{ files?: ArchivoApi[]; nextPageToken?: string }>(
        `${API}/files?q=${encodeURIComponent(q)}&pageSize=1000&fields=${encodeURIComponent(campos)}&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
        { scopes: SCOPE_DRIVE })
      out.push(...(r.files ?? []))
      token = r.nextPageToken ?? ''
    } while (token)
    return out
  }
  const idSeguro = (id: string) => { if (!/^[A-Za-z0-9_-]{10,80}$/.test(id)) throw new Error('id de Drive inválido'); return id }

  async function listarCambios(c: CarpetaGrabacion, desde: Iso | null) {
    const filtro = desde ? ` and createdTime > '${fechaDrive(desde)}'` : ''
    const xs = await listar(`'${idSeguro(c.drive_id)}' in parents${filtro} and trashed=false`)
    return {
      archivos: xs.filter(f => f.mimeType !== MIME_CARPETA).map(f => aArchivoDrive(f, c, equipo)),
      carpetas: xs.filter(f => f.mimeType === MIME_CARPETA).map(f => subcarpeta(f, c)),
    }
  }

  async function listarArbol(raiz: CarpetaGrabacion, maxNivel: number) {
    const archivos: ArchivoDrive[] = [], carpetas: CarpetaGrabacion[] = []
    let completo = true
    let nivel: CarpetaGrabacion[] = [raiz]
    const tope = Math.min(maxNivel, NIVELES_ARBOL)
    for (let k = 0; k <= tope && nivel.length; k++) {
      const res = await enParalelo(nivel, 4, async c => {
        try { return await listarCambios(c, null) } catch { completo = false; return { archivos: [], carpetas: [] } }
      })
      const siguientes: CarpetaGrabacion[] = []
      for (const r of res) {
        archivos.push(...r.archivos)
        for (const s of r.carpetas) { carpetas.push(s); siguientes.push(s) }
      }
      if (k === tope && siguientes.length) completo = false   // hay más niveles de los que se bajan
      nivel = k < tope ? siguientes : []
    }
    return { archivos, carpetas, completo }
  }

  async function carpetasClientes(): Promise<ClienteDrive[]> {
    const raiz = await listar(`'${idSeguro(raizClientes)}' in parents and trashed=false`, 'nextPageToken,files(id,name,mimeType,createdTime)')
    const clientes = raiz.filter(c => c.mimeType === MIME_CARPETA && !/^ex\s*clientes?$/i.test((c.name ?? '').trim()))
    return enParalelo(clientes, 8, async c => {
      const h = await listar(`'${idSeguro(c.id)}' in parents and trashed=false`, 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)')
      const doc = h.filter(x => /gui[oó]n/i.test(x.name) && x.mimeType === MIME_DOC).sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))[0]
      const dir = (re: RegExp) => h.find(x => x.mimeType === MIME_CARPETA && re.test(x.name))?.id ?? null
      const carpeta: CarpetaGrabacion = {
        drive_id: c.id, nombre: nombreSinSufijo(c.name ?? ''), padre_id: raizClientes, nivel: 0, ruta: [], id_crm: null, tipo: 'cliente',
        raiz: null, raiz_id: null, vinculo: 'a_confirmar', candidatos: [], vigilar: false, creada: c.createdTime ?? null, ultimo_archivo: null,
        consultada: null, borrada: null,
      }
      return { carpeta, crudos: dir(/crudo/i), editados: dir(/editad/i), marca: dir(/^marca\b/i), guiones_doc: doc?.id ?? null, guiones_modificado: doc?.modifiedTime ?? null }
    })
  }

  return {
    listarCambios, listarArbol, carpetasClientes,
    async metadatosDoc(docId) {
      n++
      const r = await googleJson<{ modifiedTime?: string }>(`${API}/files/${idSeguro(docId)}?fields=modifiedTime&supportsAllDrives=true`, { scopes: SCOPE_DRIVE })
      return { modificado: r.modifiedTime ?? '' }
    },
    async exportarTexto(docId) {
      n++
      const r = await fetch(`${API}/files/${idSeguro(docId)}/export?mimeType=text/plain`, {
        headers: { Authorization: `Bearer ${await tokenDrive()}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store',
      })
      if (!r.ok) throw Object.assign(new Error(`Google respondió ${r.status} al exportar el doc`), { status: r.status })
      return (await r.text()).slice(0, 2_000_000)
    },
    async descargar(fileId, maxBytes) {
      n++
      const r = await fetch(`${API}/files/${idSeguro(fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${await tokenDrive()}` }, signal: AbortSignal.timeout(20_000), cache: 'no-store',
      })
      if (!r.ok) throw Object.assign(new Error(`Google respondió ${r.status} al bajar el archivo`), { status: r.status })
      const largo = Number(r.headers.get('content-length') ?? 0)
      if (largo > maxBytes) { await r.body?.cancel(); throw new Error(`el archivo pesa más de ${Math.round(maxBytes / 1e6)} MB`) }
      const b = Buffer.from(await r.arrayBuffer())
      if (b.length > maxBytes) throw new Error(`el archivo pesa más de ${Math.round(maxBytes / 1e6)} MB`)
      return b
    },
    consultas: () => n,
  }
}
