// ── Bot "Capital Jurídico": bajar el comprobante de Whapi (BLOQUE W) ────────────────────────────────────────────────────
// Siempre por GET /media/{MediaID} con el token (revisión del diseño, punto 29): NO se activa `auto_download`, que dejaría
// un link público de wasabi de cada archivo de los grupos donde está el número. Por eso `RefMedio.link` no se usa nunca.
//   · El MediaID tiene que tener la forma de la referencia (^[a-zA-Z0-9]+-[0-9a-fA-F-]+$): va en la ruta.
//   · Tope de 20 MB: por `content-length` (si viene) y contando mientras baja (se corta apenas se pasa).
//   · Redirecciones: solo a https://gate.whapi.cloud o a un host *.wasabisys.com (el almacenamiento de Whapi), como mucho 2,
//     y SIN el token cuando el host no es Whapi. Cualquier otra se rechaza.
//   · sha256 propio en hex: el de Whapi tiene un formato no documentado (base64) y solo es informativo.
import { createHash } from 'node:crypto'
import type { MedioDescargado, RefMedio } from '@/lib/bot/alta/motor/tipos'
import { ErrorWhapi } from './errores'

export const MAX_BYTES_MEDIO = 20 * 1024 * 1024
export const MAX_REDIRECCIONES_MEDIO = 2

/** ¿Se puede seguir una redirección de GET /media hacia este destino? */
export function destinoMedioPermitido(u: URL): 'whapi' | 'almacen' | null {
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  const host = u.hostname.toLowerCase()
  if (host === 'gate.whapi.cloud') return 'whapi'
  if (host === 'wasabisys.com' || host.endsWith('.wasabisys.com')) return 'almacen'
  return null
}

const SIN_TOPE = (bytes: number, max: number) =>
  new ErrorWhapi('rechazo', `el comprobante pesa más de ${Math.round(max / 1024 / 1024)} MB (${bytes > 0 ? `${bytes} bytes o más` : 'sin tamaño'}): no se baja`, 413, false)

/** Lee el cuerpo contando bytes; corta (cancela la descarga) apenas se pasa del tope. */
export async function leerConTope(res: Response, maxBytes: number): Promise<Buffer> {
  const largo = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(largo) && largo > maxBytes) {
    try { await res.body?.cancel() } catch { /* nada */ }
    throw SIN_TOPE(largo, maxBytes)
  }
  if (!res.body) return Buffer.alloc(0)
  const lector = res.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try { await lector.cancel() } catch { /* nada */ }
      throw SIN_TOPE(total, maxBytes)
    }
    partes.push(value)
  }
  return Buffer.concat(partes, total)
}

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf',
}

/** "image/jpeg; charset=…" → "image/jpeg" (minúsculas, sin parámetros). */
export const mimeLimpio = (m: string | null | undefined): string => (m ?? '').split(';')[0].trim().toLowerCase()

/** Arma el MedioDescargado: el mime de la respuesta si es concreto, si no el del mensaje; sha256 propio en hex. */
export function armarMedio(bytes: Buffer, ref: RefMedio, mimeRespuesta: string | null): MedioDescargado {
  const delRef = mimeLimpio(ref.mime)
  const deRespuesta = mimeLimpio(mimeRespuesta)
  const mime = deRespuesta && deRespuesta !== 'application/octet-stream' && !deRespuesta.startsWith('application/json') ? deRespuesta : delRef || 'application/octet-stream'
  const nombre = (ref.nombreArchivo ?? '').replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').trim().slice(0, 150)
    || `${ref.id}.${EXTENSIONES[mime] ?? 'bin'}`
  return {
    base64: bytes.toString('base64'),
    mime,
    nombre,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
