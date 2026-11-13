// ── Wins de clientes: modelo y validación (puro: sin red ni base; lo prueba scripts/test-clientes-puntaje.mjs) ──────────
// Especificación v1 de Tomás (13/11/2026). Un win es algo bueno que dijo el cliente, cargado a mano desde su tarjeta:
// cliente, fecha, lo que dijo TEXTUAL (obligatorio), captura del chat (imagen opcional), de dónde salió, quién lo cargó y si
// el cliente autorizó usarlo como caso de éxito. Cada win suma al puntaje interno (bloque Resultados, lib/clientes/puntaje.ts).
// La captura la achica el navegador (máx. ~1600 px de lado, JPEG o WebP) y el servidor vuelve a validar tipo, firma y tamaño
// antes de guardarla en Neon (bytea). Se sirve solo por una ruta con sesión y permiso de la Cartera: nunca es pública.
import { esYmdValido, type Ymd } from '../fechas'

export const FUENTES_WIN = ['whatsapp', 'llamada', 'encuesta', 'otro'] as const
export type FuenteWin = (typeof FUENTES_WIN)[number]
export const NOMBRE_FUENTE_WIN: Record<FuenteWin, string> = { whatsapp: 'WhatsApp', llamada: 'Llamada', encuesta: 'Encuesta', otro: 'Otro' }

export const TOPE_TEXTO = 4_000
export const TOPE_CAPTURA_BYTES = 600 * 1024
export const LADO_MAXIMO_CAPTURA = 1600
export const TIPOS_CAPTURA = ['image/jpeg', 'image/webp', 'image/png'] as const
export type TipoCaptura = (typeof TIPOS_CAPTURA)[number]
const ID_CRM = /^[A-Za-z]\d{1,6}$/
const CLAVE = /^[A-Za-z0-9_-]{8,64}$/

export interface Win {
  id: number
  idCrm: string
  fecha: Ymd
  texto: string
  fuente: FuenteWin
  autorizado: boolean
  cargadoPor: string
  creado: string | null      // ISO
  conCaptura: boolean
}

export interface WinNuevo {
  clave: string              // idempotencia: el mismo pedido reintentado no duplica el win
  idCrm: string
  fecha: Ymd
  texto: string
  fuente: FuenteWin
  autorizado: boolean
  captura: { tipo: TipoCaptura; bytes: Uint8Array } | null
}

export const esFuenteWin = (x: unknown): x is FuenteWin => typeof x === 'string' && (FUENTES_WIN as readonly string[]).includes(x)

/** El texto tal cual lo dijo el cliente: se conservan los saltos de línea, se sacan los caracteres de control y se recorta. */
export function textoTextual(x: unknown): string {
  return String(x ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, TOPE_TEXTO)
}

/** Base64 (con o sin el prefijo data:) → bytes. null si no es base64 válido. */
export function deBase64(s: string): Uint8Array | null {
  const limpio = s.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!limpio || limpio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) return null
  try { return new Uint8Array(Buffer.from(limpio, 'base64')) } catch { return null }
}

/** El tipo real de la imagen por su firma (los primeros bytes), sin confiar en lo que dice el navegador. */
export function tipoPorFirma(b: Uint8Array): TipoCaptura | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export type ValidacionWin = { ok: true; win: WinNuevo } | { ok: false; error: string }

/** Valida lo que manda la tarjeta. `hoy` limita la fecha (no se cargan wins del futuro). */
export function validarWin(entrada: unknown, hoy: Ymd): ValidacionWin {
  if (!entrada || typeof entrada !== 'object') return { ok: false, error: 'Faltan los datos del win.' }
  const o = entrada as Record<string, unknown>
  const clave = typeof o.clave === 'string' ? o.clave.trim() : ''
  if (!CLAVE.test(clave)) return { ok: false, error: 'Falta la clave del pedido: recargá la página.' }
  const idCrm = typeof o.idCrm === 'string' ? o.idCrm.trim().toUpperCase() : ''
  if (!ID_CRM.test(idCrm)) return { ok: false, error: 'Cliente inválido.' }
  const texto = textoTextual(o.texto)
  if (!texto) return { ok: false, error: 'Pegá lo que dijo el cliente, textual.' }
  if (String(o.texto ?? '').length > TOPE_TEXTO + 200) return { ok: false, error: `El texto es demasiado largo (máximo ${TOPE_TEXTO} caracteres).` }
  const fecha = typeof o.fecha === 'string' ? o.fecha.trim() : ''
  if (!esYmdValido(fecha)) return { ok: false, error: 'Elegí la fecha del win.' }
  if (fecha > hoy) return { ok: false, error: 'La fecha no puede ser posterior a hoy.' }
  if (fecha < '2024-01-01') return { ok: false, error: 'La fecha es demasiado vieja.' }
  if (!esFuenteWin(o.fuente)) return { ok: false, error: 'Elegí de dónde salió (WhatsApp, llamada, encuesta u otro).' }
  if (typeof o.autorizado !== 'boolean') return { ok: false, error: 'Indicá si el cliente autorizó usarlo como caso de éxito.' }
  let captura: WinNuevo['captura'] = null
  if (o.captura !== null && o.captura !== undefined) {
    const c = o.captura as Record<string, unknown>
    if (typeof c !== 'object' || typeof c.base64 !== 'string') return { ok: false, error: 'La captura no llegó bien. Probá de nuevo.' }
    if (c.base64.length > Math.ceil(TOPE_CAPTURA_BYTES / 3) * 4 + 100) return { ok: false, error: 'La captura pesa demasiado (máximo 600 KB).' }
    const bytes = deBase64(c.base64)
    if (!bytes) return { ok: false, error: 'La captura no llegó bien. Probá de nuevo.' }
    if (bytes.length > TOPE_CAPTURA_BYTES) return { ok: false, error: 'La captura pesa demasiado (máximo 600 KB).' }
    const tipo = tipoPorFirma(bytes)
    if (!tipo) return { ok: false, error: 'La captura tiene que ser una imagen JPEG, WebP o PNG.' }
    captura = { tipo, bytes }
  }
  return { ok: true, win: { clave, idCrm, fecha, texto, fuente: o.fuente, autorizado: o.autorizado, captura } }
}

/** Cuántos wins tiene cada cliente desde `desde` (inclusive). Las claves van en mayúscula. */
export function contarWinsDesde(wins: readonly { idCrm: string; fecha: Ymd }[], desde: Ymd): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of wins) if (w.fecha >= desde) m.set(w.idCrm.toUpperCase(), (m.get(w.idCrm.toUpperCase()) ?? 0) + 1)
  return m
}

export interface FiltroWins { idCrm: string | null; autorizado: boolean | null }
/** Filtra y ordena del más nuevo al más viejo (por fecha y, a igual fecha, por carga). */
export function filtrarWins(wins: readonly Win[], f: FiltroWins): Win[] {
  return wins
    .filter(w => (!f.idCrm || w.idCrm.toUpperCase() === f.idCrm.toUpperCase()) && (f.autorizado === null || w.autorizado === f.autorizado))
    .sort((a, b) => (a.fecha !== b.fecha ? (a.fecha < b.fecha ? 1 : -1) : (b.creado ?? '').localeCompare(a.creado ?? '') || b.id - a.id))
}
