// ── Paleta desde lo que el cliente sube a "Marca - X" (e05), con Claude ─────────────────────────────────────────────
// Mismo cliente y mismo modelo que el kickoff (llamarClaude de lib/bot/kickoff/claude.ts), esfuerzo low: es leer colores
// de un logo, un manual de marca o una captura. Puro salvo la llamada inyectada: arma el pedido, valida y normaliza.
//   · Formatos: PNG, JPG, GIF y WebP van como imagen; PDF como documento; SVG como texto (los colores están en el código).
//     El resto (HEIC, AI, PSD, ZIP, videos…) no se lee: queda 'error' con el formato, para que Aylu lo pida en otro.
//   · Claude nunca escribe la ficha: devuelve una PROPUESTA que Aylu usa (o no) desde la ficha del cliente.
//   · A la vuelta se valida todo: hex #RRGGBB en mayúsculas, sin repetidos, como mucho MAX_COLORES_PROPUESTA colores y
//     MAX_TIPOGRAFIAS_PROPUESTA tipografías.
import type { PedidoClaude, RespuestaClaude } from '@/lib/bot/kickoff/claude'
import type { ColorPropuesto } from '@/lib/edicion/db/marcaPropuestas'

export type LlamarClaudeMarca = (p: PedidoClaude) => Promise<RespuestaClaude>

export const MAX_COLORES_PROPUESTA = 8
export const MAX_TIPOGRAFIAS_PROPUESTA = 4
export const MAX_BYTES_IMAGEN = 3_700_000      // la API corta en 5 MiB de base64 (≈ 3,75 MB de archivo)
export const MAX_BYTES_PDF = 8_000_000
export const MAX_BYTES_SVG = 150_000
export const MAX_CARACTERES_SVG = 60_000       // sin imágenes embebidas, ≈ 20.000 tokens como mucho
export const TOPE_CLAUDE_MARCA_MS = 60_000
export const MAX_TOKENS_MARCA = 8_000

const IMAGENES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export type FormatoMarca = 'imagen' | 'pdf' | 'svg'

/** El tipo real por los primeros bytes (Drive a veces etiqueta mal: un JPG como PNG da 400 en la API). null = ni imagen
 *  conocida ni PDF (el SVG es texto: se decide por el mime). */
export function mimeReal(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  return null
}

/** El SVG sin imágenes embebidas (data:… en base64) y recortado: los colores están en fill/stroke/style. */
export function limpiarSvg(texto: string): string {
  return texto.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=\s]+/gi, 'data:…').slice(0, MAX_CARACTERES_SVG)
}

/** Cómo se le manda el archivo a Claude, o null si el formato no se lee. */
export function formatoDe(mime: string): FormatoMarca | null {
  const m = mime.toLowerCase().split(';')[0].trim()
  if (IMAGENES.has(m)) return 'imagen'
  if (m === 'application/pdf') return 'pdf'
  if (m === 'image/svg+xml') return 'svg'
  return null
}

export function maxBytesDe(f: FormatoMarca): number {
  return f === 'imagen' ? MAX_BYTES_IMAGEN : f === 'pdf' ? MAX_BYTES_PDF : MAX_BYTES_SVG
}

export const SCHEMA_MARCA = {
  type: 'object', additionalProperties: false, required: ['que_es', 'colores', 'tipografias', 'nota'],
  properties: {
    que_es: { type: 'string', enum: ['logo', 'manual_de_marca', 'paleta', 'captura', 'foto', 'otro'] },
    colores: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['hex', 'nombre'],
      properties: { hex: { type: 'string' }, nombre: { type: 'string' } } } },
    tipografias: { type: 'array', items: { type: 'string' } },
    nota: { type: 'string' },
  },
} as const

export const SISTEMA_MARCA = `Trabajás en el equipo de edición de Capital Jurídico, una agencia de marketing para abogados. Un cliente subió este archivo a su carpeta "Marca" para que los videos y los anuncios salgan con los colores de su estudio.
Tu tarea: leer la paleta de su marca.
- colores: los colores de la marca en hexadecimal #RRGGBB, del principal al secundario, como mucho 6. Si el archivo trae los códigos escritos (un manual o una paleta), usá esos tal cual. Si no, tomalos del logo o de los elementos de marca, no de fotos, sombras ni degradados.
- No cuentes el blanco o el negro del fondo; sí, si son parte de la marca (por ejemplo, el texto del logo).
- nombre: un nombre corto en español para cada color ("Verde petróleo", "Dorado mate").
- tipografias: solo si el nombre está escrito en el archivo o la reconocés con seguridad; si no, vacío.
- que_es: qué tipo de archivo es.
- nota: una línea para el equipo (por ejemplo "el logo tiene dos versiones" o "es una foto del estudio, sin marca"). Vacía si no hace falta.
Si el archivo no muestra una marca (una foto, un documento sin logo), devolvé colores vacío y explicalo en la nota. No inventes colores.`

/** Los bloques del mensaje de usuario para cada formato. */
export function armarUsuario(formato: FormatoMarca, mime: string, bytes: Buffer, nombre: string): PedidoClaude['usuario'] {
  const intro = { type: 'text' as const, text: `Archivo: «${nombre.slice(0, 120)}». Leé la paleta de la marca.` }
  if (formato === 'imagen') {
    const media = mime.toLowerCase().split(';')[0].trim() as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    return [{ type: 'image', source: { type: 'base64', media_type: media, data: bytes.toString('base64') } }, intro]
  }
  if (formato === 'pdf') return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }, intro]
  return [intro, { type: 'text', text: `Código SVG del archivo:\n${limpiarSvg(bytes.toString('utf8'))}` }]
}

/** "#abc" / "abc" / "#aabbcc" → "#AABBCC"; null si no es un hex. */
export function normalizarHex(x: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(x.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return `#${h.toUpperCase()}`
}

export interface LecturaMarca { colores: ColorPropuesto[]; tipografias: string[]; nota: string; que_es: string }

/** Valida y normaliza lo que devolvió Claude (nunca confía en el schema solo). */
export function validarLectura(j: unknown): LecturaMarca {
  const o = (j ?? {}) as Record<string, unknown>
  const vistos = new Set<string>()
  const colores: ColorPropuesto[] = []
  for (const c of Array.isArray(o.colores) ? o.colores : []) {
    const hex = typeof (c as { hex?: unknown })?.hex === 'string' ? normalizarHex((c as { hex: string }).hex) : null
    if (!hex || vistos.has(hex)) continue
    vistos.add(hex)
    const nombre = typeof (c as { nombre?: unknown }).nombre === 'string' ? (c as { nombre: string }).nombre.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    colores.push({ hex, nombre })
    if (colores.length >= MAX_COLORES_PROPUESTA) break
  }
  const tipografias = [...new Set((Array.isArray(o.tipografias) ? o.tipografias : [])
    .filter((t): t is string => typeof t === 'string').map(t => t.replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_TIPOGRAFIAS_PROPUESTA)
  const nota = typeof o.nota === 'string' ? o.nota.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  const que_es = typeof o.que_es === 'string' ? o.que_es.slice(0, 30) : 'otro'
  return { colores, tipografias, nota, que_es }
}

/** Lee la paleta de un archivo ya bajado. Tira lo que tire la llamada (ErrorTransitorio = reintentar otro día). */
export async function leerMarcaConClaude(claude: LlamarClaudeMarca, a: { formato: FormatoMarca; mime: string; bytes: Buffer; nombre: string; topeMs: number }): Promise<LecturaMarca & { modelo: string }> {
  const r = await claude({
    que: 'la paleta de la marca', sistema: SISTEMA_MARCA, usuario: armarUsuario(a.formato, a.mime, a.bytes, a.nombre),
    schema: SCHEMA_MARCA as unknown as Record<string, unknown>, esfuerzo: 'low', topeMs: Math.min(a.topeMs, TOPE_CLAUDE_MARCA_MS), maxTokens: MAX_TOKENS_MARCA,
  })
  return { ...validarLectura(r.json), modelo: r.modelo }
}
