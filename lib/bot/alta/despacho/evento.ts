// ── Bot "Capital Jurídico": el alta cargada en el Despacho → el mismo evento que arma el webhook de Whapi (26/10/2026) ────
// Con el número del bot suspendido, el alta se pega en /clientes/altas/nueva tal cual la manda el closer (#ALTA o formato
// libre), se elige el closer y se suben los comprobantes. De acá sale un EventoAlta igual al de lib/bot/whapi/webhook.ts:
//   · #ALTA → tipo 'alta'; sin #ALTA, si es un alta en formato libre (altaLibre.ts: nombre, contacto y pago) → 'alta' con
//     `libre: true` (el motor pide el "¿Esto es un alta?" en Verificaciones antes de hacer nada, como siempre);
//   · el closer del selector queda como "Closer: X" (reemplaza el que traiga el texto: ya no sale del teléfono);
//   · los comprobantes van como RefMedio con id "despacho-<sha256>" (el motor los baja de cj_altas_archivos, no de Whapi);
//   · origen: chatId "despacho" e id único "despacho-<uuid>" (lo genera la pantalla al abrir el formulario, así un doble
//     envío no crea dos altas: el motor no repite por clave).
// Mismo parseo, mismas reglas de Fee, cliente existente y primera cuota: todo lo decide el motor. Puro, sin red.
import { createHash } from 'node:crypto'
import { esAltaLibre } from '../altaLibre'
import { formatoComprobante } from '../comprobante'
import type { AutorWhapi, EventoAdjunto, EventoAlta, EventoRespuesta, RefMedio } from '../motor/tipos'

export const CHAT_DESPACHO = 'despacho'
export const PREFIJO_ID = 'despacho-'
export const PREFIJO_ARCHIVO = 'despacho-arch-'
export const ETIQUETA_ALTA = /#\s*alta\b/i
/** Los closers del selector (Tomás, 26/10/2026). */
export const CLOSERS_DESPACHO = ['Carlos', 'Marcos', 'Yami', 'Nahuel', 'Brenda'] as const
/** "Yami" en el selector es "Yamila" en BOT_ALTA_CLOSERS (y en el CRM). */
const ALIAS_CLOSER: Record<string, string[]> = { Yami: ['Yamila', 'Yami'] }

export const MAX_TEXTO = 20_000
/** Por archivo y en total: Vercel corta el cuerpo de una función en 4,5 MB. Claude lee imágenes de hasta 5 MB. */
export const MAX_ARCHIVO_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_BYTES = 4_400_000
export const MAX_ARCHIVOS = 5

/** El id que manda la pantalla (un uuid) → la clave del evento. null si no tiene forma. */
export function idDespacho(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null
  const t = crudo.trim().toLowerCase()
  return /^[a-f0-9-]{16,40}$/.test(t) ? `${PREFIJO_ID}${t.replace(/-/g, '')}` : null
}
export const esIdArchivoDespacho = (id: unknown): id is string => typeof id === 'string' && id.startsWith(PREFIJO_ARCHIVO) && /^[a-z0-9-]{20,80}$/.test(id)
export const esAltaDelDespacho = (alta: { chatId?: string | null; mensajeAltaId?: string | null }) => alta.chatId === CHAT_DESPACHO || !!alta.mensajeAltaId?.startsWith(PREFIJO_ID)

/** El closer del selector, o null si no es uno de la lista. */
export function closerValido(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const t = x.trim().toLowerCase()
  return CLOSERS_DESPACHO.find((c) => c.toLowerCase() === t) ?? null
}

/** El texto con "Closer: X": reemplaza la línea que traiga o la suma (debajo del #ALTA, o arriba en el formato libre). */
export function conCloser(texto: string, closer: string): string {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n')
  const i = lineas.findIndex((l) => /^\s*\**\s*closer\s*\**\s*[:\-–—]/i.test(l))
  if (i >= 0) { lineas[i] = `Closer: ${closer}`; return lineas.join('\n') }
  const j = lineas.findIndex((l) => ETIQUETA_ALTA.test(l))
  if (j >= 0) { lineas.splice(j + 1, 0, `Closer: ${closer}`); return lineas.join('\n') }
  return [`Closer: ${closer}`, ...lineas].join('\n')
}

/** El autor del evento: el teléfono del closer si está en BOT_ALTA_CLOSERS (así un dato que mande después por WhatsApp
 *  sin citar encuentra su alta) y un lid propio del Despacho, por closer (mismoAutor entre sus altas del Despacho). */
export function autorDespacho(closer: string, closers: Record<string, string>): AutorWhapi {
  const nombres = [closer, ...(ALIAS_CLOSER[closer] ?? [])].map((n) => n.toLowerCase())
  const tel = Object.entries(closers).find(([n]) => nombres.includes(n.trim().toLowerCase()))?.[1] ?? null
  return { telefono: tel && /^\d{8,}$/.test(tel) ? tel : null, lid: `${CHAT_DESPACHO}:${closer.toLowerCase()}`, nombre: closer }
}

export interface ArchivoSubido { nombre: string; mime: string; bytes: Uint8Array }
export interface ArchivoGuardable { id: string; nombre: string; mime: string; bytes: number; sha256: string; base64: string }

const MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] as const
const mimeDe = (mime: string, nombre: string): string => {
  const m = mime.trim().toLowerCase().replace('image/jpg', 'image/jpeg')
  if ((MIMES as readonly string[]).includes(m)) return m
  const ext = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' } as Record<string, string>)[ext ?? ''] ?? m
}
/** ¿Empieza como dice el tipo? (JPEG FF D8, PNG 89 50 4E 47, GIF "GIF8", WEBP "RIFF…WEBP", PDF "%PDF") */
function firmaCoincide(mime: string, b: Uint8Array): boolean {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n))
  switch (mime) {
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8
    case 'image/png': return b[0] === 0x89 && s(1, 3) === 'PNG'
    case 'image/gif': return s(0, 4) === 'GIF8'
    case 'image/webp': return s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP'
    case 'application/pdf': return s(0, 5) === '%PDF-'
    default: return false
  }
}

/** Valida los comprobantes (tipo, firma, tamaño) y los deja listos para guardar. */
export function prepararArchivos(archivos: readonly ArchivoSubido[]): { ok: true; archivos: ArchivoGuardable[] } | { ok: false; error: string } {
  if (archivos.length > MAX_ARCHIVOS) return { ok: false, error: `Como mucho ${MAX_ARCHIVOS} archivos por carga.` }
  let total = 0
  const out: ArchivoGuardable[] = []
  for (const a of archivos) {
    const nombre = (a.nombre || 'comprobante').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 120) || 'comprobante'
    const mime = mimeDe(a.mime, nombre)
    if (!a.bytes.length) return { ok: false, error: `"${nombre}" está vacío.` }
    if (a.bytes.length > MAX_ARCHIVO_BYTES) return { ok: false, error: `"${nombre}" pesa más de 4 MB: mandá una captura más liviana o el PDF.` }
    total += a.bytes.length
    if (total > MAX_TOTAL_BYTES) return { ok: false, error: 'Entre todos los archivos pasan los 4,4 MB: subilos en dos veces (el segundo, desde el pedido del alta).' }
    const f = formatoComprobante(mime, a.bytes.length, null)
    if (!f.ok || !firmaCoincide(mime, a.bytes)) return { ok: false, error: `"${nombre}" no es una imagen (JPEG, PNG, GIF o WEBP) ni un PDF.` }
    const sha256 = createHash('sha256').update(a.bytes).digest('hex')
    out.push({ id: `${PREFIJO_ARCHIVO}${sha256.slice(0, 40)}`, nombre, mime, bytes: a.bytes.length, sha256, base64: Buffer.from(a.bytes).toString('base64') })
  }
  return { ok: true, archivos: out }
}

export const refMedio = (a: Omit<ArchivoGuardable, 'base64'>): RefMedio => ({
  id: a.id, tipo: a.mime === 'application/pdf' ? 'document' : 'image', mime: a.mime, tamano: a.bytes, sha256Whapi: null,
  nombreArchivo: a.nombre, link: null, paginas: null, pie: null,
})

export type ResultadoEvento = { ok: true; evento: EventoAlta; tipo: '#ALTA' | 'libre' } | { ok: false; error: string }

/** El EventoAlta del Despacho, o el motivo por el que no es un alta. */
export function eventoAltaDespacho(p: {
  id: string; texto: string; closer: string; archivos: readonly Omit<ArchivoGuardable, 'base64'>[]; ahora: number; closers: Record<string, string>
}): ResultadoEvento {
  const texto = p.texto.replace(/\r\n?/g, '\n').trim()
  if (!texto) return { ok: false, error: 'Pegá el alta como la mandó el closer.' }
  if (texto.length > MAX_TEXTO) return { ok: false, error: 'El texto es demasiado largo.' }
  const etiqueta = ETIQUETA_ALTA.test(texto)
  if (!etiqueta && !esAltaLibre(texto)) {
    return { ok: false, error: 'No lo reconozco como un alta: tiene que traer #ALTA o, en formato libre, el nombre del cliente ("Nombre: …"), un teléfono o correo y el pago (USD, PIF, PP, seña, cuota…).' }
  }
  const final = conCloser(texto, p.closer)
  const en = new Date(p.ahora).toISOString()
  return {
    ok: true, tipo: etiqueta ? '#ALTA' : 'libre',
    evento: {
      tipo: 'alta', grupo: 'ventas', clave: p.id, mensajeId: p.id, chatId: CHAT_DESPACHO, texto: final, medios: p.archivos.map(refMedio),
      autor: autorDespacho(p.closer, p.closers), enviadoEn: en, recibidoEn: en, citado: null, ...(etiqueta ? {} : { libre: true }),
    },
  }
}

/** Datos del closer completados en el Despacho con comprobantes: el texto como una respuesta citando el alta y los archivos
 *  como un adjunto citándola (el motor los aplica en ese orden, en la misma vuelta). */
export function eventosDatosDespacho(p: {
  id: string; alta: { mensajeAltaId: string; autor: AutorWhapi }; texto: string; archivos: readonly Omit<ArchivoGuardable, 'base64'>[]; ahora: number
}): (EventoRespuesta | EventoAdjunto)[] {
  const t0 = new Date(p.ahora).toISOString(), t1 = new Date(p.ahora + 1).toISOString()
  const citado = { id: p.alta.mensajeAltaId, autor: null }
  const base = { chatId: CHAT_DESPACHO, autor: p.alta.autor, citado, grupo: 'ventas' as const }
  const out: (EventoRespuesta | EventoAdjunto)[] = []
  const texto = p.texto.replace(/\r\n?/g, '\n').trim()
  if (texto) out.push({ ...base, tipo: 'respuesta', clave: `${p.id}-t`, mensajeId: `${p.id}-t`, texto, veredicto: null, enviadoEn: t0, recibidoEn: t0 })
  if (p.archivos.length) out.push({ ...base, tipo: 'adjunto', clave: `${p.id}-a`, mensajeId: `${p.id}-a`, medios: p.archivos.map(refMedio), albumEsperado: null, enviadoEn: t1, recibidoEn: t1 })
  return out
}
