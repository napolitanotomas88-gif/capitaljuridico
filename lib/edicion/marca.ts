// ── Ficha de marca del cliente (e05): validación y armado (puro: sin red ni base) ─────────────────────────────────────
// La ficha (cj_marca, ver db/marca.ts) junta la paleta, la tipografía, el logo, una referencia y la carpeta "Marca - X",
// con DE DÓNDE salió cada dato (fuentes: clickup, kickoff, aylu, tomas o cliente). NO FRENA NADA: si falta cuando un video
// pasa a Para editar, se le avisa a Aylu (aviso marca_falta) y el video sigue.
// Reglas:
//   · los colores van en hexadecimal #RRGGBB y se normalizan (mayúsculas; "#abc" → "#AABBCC"; sin "#" también vale);
//   · las URLs, solo https (un "www.algo.com" suelto se completa con https://); nunca un link a un adjunto de ClickUp;
//   · `quien` guarda el NOMBRE de la persona, nunca el mail;
//   · la paleta desde el kickoff queda pendiente A PROPÓSITO: el schema de la ficha del kickoff está en el límite de la
//     gramática de la API y no se le suma un campo.
import type { FichaMarca, IdCrm, Iso, OrigenDato, Persona } from './tipos'

export type FichaMarcaEntrada = Omit<FichaMarca, 'version' | 'actualizado'>
export type CampoMarca = 'colores' | 'tipografias' | 'logo' | 'referencia'
export const CAMPOS_CON_FUENTE: readonly CampoMarca[] = ['colores', 'tipografias', 'logo', 'referencia']
export const ORIGENES_DATO: readonly OrigenDato[] = ['clickup', 'kickoff', 'aylu', 'tomas', 'cliente']

export const MAX_COLORES = 12
export const MAX_TIPOGRAFIAS = 6
export const LARGO_NOMBRE = 60
export const LARGO_DESCRIPCION = 300
export const LARGO_NOTAS = 1_000
export const LARGO_URL = 2_000

const ID_CRM = /^[A-Za-z]\d{1,6}$/
const ID_DRIVE = /^[A-Za-z0-9_-]{10,200}$/

/** "#abc", "abc123", "#AbC123" → "#AABBCC" / "#ABC123"; cualquier otra cosa → null. */
export function normalizarHex(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const t = x.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(t)) return `#${t.split('').map(c => c + c).join('')}`.toUpperCase()
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t}`.toUpperCase()
  return null
}

/** Una URL https válida (un "www.x.com" suelto se completa con https://) o null. Los adjuntos de ClickUp no valen. */
export function urlHttps(x: unknown): string | null {
  if (typeof x !== 'string') return null
  let t = x.trim()
  if (!t || t.length > LARGO_URL) return null
  if (/^www\./i.test(t)) t = `https://${t}`
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return null
    if (esAdjuntoClickUp(u.href)) return null
    return u.href
  } catch {
    return null
  }
}

/** Los adjuntos de ClickUp (capturas subidas a un comentario) tienen URL firmada: nunca se guardan ni se muestran. */
export const esAdjuntoClickUp = (url: string): boolean => /(^|\.)clickup-attachments\.com$/i.test(hostDe(url)) || /attachments\.clickup\.com/i.test(url)
const hostDe = (url: string): string => { try { return new URL(url).hostname } catch { return '' } }

/** El id de un archivo o carpeta de Drive en un link (o el id suelto). */
export function idDeDrive(x: string): string | null {
  const t = x.trim()
  const m = /\/(?:file\/d|folders|document\/d|spreadsheets\/d|presentation\/d)\/([A-Za-z0-9_-]{10,200})/.exec(t) ?? /[?&]id=([A-Za-z0-9_-]{10,200})/.exec(t)
  if (m) return m[1]
  return ID_DRIVE.test(t) ? t : null
}

const texto = (x: unknown, max: number): string | null => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : null)
const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const esIso = (x: unknown): x is Iso => typeof x === 'string' && Number.isFinite(Date.parse(x))

type Resultado = { ok: true; ficha: FichaMarcaEntrada } | { ok: false; error: string; campo: string }
const mal = (campo: string, error: string): Resultado => ({ ok: false, error, campo })

/** Valida la ficha que llega de la pantalla o de la importación. No inventa datos: lo que no vale, error con el campo. */
export function validarFicha(x: unknown): Resultado {
  if (!esObj(x)) return mal('ficha', 'la ficha tiene que ser un objeto')
  const id = typeof x.id_crm === 'string' && ID_CRM.test(x.id_crm.trim()) ? x.id_crm.trim().toUpperCase() : null
  if (!id) return mal('id_crm', 'ID del CRM inválido')

  const coloresIn = x.colores ?? []
  if (!Array.isArray(coloresIn)) return mal('colores', 'los colores tienen que ser una lista')
  if (coloresIn.length > MAX_COLORES) return mal('colores', `como máximo ${MAX_COLORES} colores`)
  const colores: FichaMarca['colores'] = []
  for (const [i, c] of coloresIn.entries()) {
    const hex = normalizarHex(esObj(c) ? c.hex : c)
    if (!hex) return mal(`colores.${i}`, 'cada color va en hexadecimal (#RRGGBB)')
    const nombre = esObj(c) ? texto(c.nombre ?? '', LARGO_NOMBRE) ?? '' : ''
    if (!colores.some(k => k.hex === hex)) colores.push({ hex, nombre })
  }

  const tipIn = x.tipografias ?? []
  if (!Array.isArray(tipIn)) return mal('tipografias', 'las tipografías tienen que ser una lista')
  if (tipIn.length > MAX_TIPOGRAFIAS) return mal('tipografias', `como máximo ${MAX_TIPOGRAFIAS} tipografías`)
  const tipografias: string[] = []
  for (const [i, t] of tipIn.entries()) {
    const v = texto(t, LARGO_NOMBRE)
    if (v === null) return mal(`tipografias.${i}`, 'cada tipografía es un texto')
    if (v && !tipografias.includes(v)) tipografias.push(v)
  }

  let logo: FichaMarca['logo'] = null
  if (x.logo !== null && x.logo !== undefined) {
    if (!esObj(x.logo)) return mal('logo', 'el logo tiene que tener url')
    const url = urlHttps(x.logo.url)
    if (!url) return mal('logo.url', 'el link del logo tiene que ser https')
    const d = typeof x.logo.drive_id === 'string' ? x.logo.drive_id.trim() : ''
    if (d && !ID_DRIVE.test(d)) return mal('logo.drive_id', 'id de Drive inválido')
    const deDrive = /^(drive|docs)\.google\.com$/.test(hostDe(url)) ? idDeDrive(url) : null
    logo = { url, drive_id: d || deDrive }
  }

  let referencia: FichaMarca['referencia'] = null
  if (x.referencia !== null && x.referencia !== undefined) {
    if (!esObj(x.referencia)) return mal('referencia', 'la referencia tiene que tener url')
    const url = urlHttps(x.referencia.url)
    if (!url) return mal('referencia.url', 'el link de la referencia tiene que ser https (los adjuntos de ClickUp no valen)')
    referencia = { url, descripcion: texto(x.referencia.descripcion ?? '', LARGO_DESCRIPCION) ?? '' }
  }

  let carpeta_marca: FichaMarca['carpeta_marca'] = null
  if (x.carpeta_marca !== null && x.carpeta_marca !== undefined) {
    if (!esObj(x.carpeta_marca)) return mal('carpeta_marca', 'la carpeta tiene que tener id y url')
    const cid = typeof x.carpeta_marca.id === 'string' ? x.carpeta_marca.id.trim() : ''
    const url = urlHttps(x.carpeta_marca.url)
    if (!ID_DRIVE.test(cid)) return mal('carpeta_marca.id', 'id de carpeta de Drive inválido')
    if (!url) return mal('carpeta_marca.url', 'el link de la carpeta tiene que ser https')
    carpeta_marca = { id: cid, url }
  }

  const fuentes: FichaMarca['fuentes'] = {}
  if (x.fuentes !== null && x.fuentes !== undefined) {
    if (!esObj(x.fuentes)) return mal('fuentes', 'las fuentes tienen que ser un objeto')
    for (const [k, v] of Object.entries(x.fuentes)) {
      if (!(CAMPOS_CON_FUENTE as readonly string[]).includes(k)) return mal(`fuentes.${k}`, 'campo desconocido')
      if (v === null || v === undefined) continue
      if (!esObj(v) || !(ORIGENES_DATO as readonly unknown[]).includes(v.origen) || !esIso(v.cuando)) return mal(`fuentes.${k}`, 'fuente inválida (origen, quien y cuando)')
      const quien = texto(v.quien ?? '', LARGO_NOMBRE) ?? ''
      if (/@/.test(quien)) return mal(`fuentes.${k}.quien`, 'va el nombre, nunca el mail')
      fuentes[k as CampoMarca] = { origen: v.origen as OrigenDato, quien, cuando: new Date(v.cuando).toISOString() }
    }
  }

  const notas = texto(x.notas ?? '', LARGO_NOTAS)
  if (notas === null) return mal('notas', 'las notas son un texto')
  return { ok: true, ficha: { id_crm: id, colores, tipografias, logo, referencia, carpeta_marca, fuentes, notas } }
}

/** ¿La ficha tiene paleta? (lo que mira el aviso marca_falta y la tarjeta del video). */
export const tienePaleta = (f: Pick<FichaMarca, 'colores'> | null | undefined): boolean => !!f && f.colores.length > 0

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Las fuentes al guardar desde la pantalla: los campos que cambiaron quedan a nombre de quien guarda (aylu / tomas). */
export function fuentesAlGuardar(previa: Pick<FichaMarca, CampoMarca | 'fuentes'> | null, nueva: FichaMarcaEntrada, actor: Persona, ahora: Iso): FichaMarca['fuentes'] {
  const origen: OrigenDato = actor.rol === 'tomas' ? 'tomas' : 'aylu'
  const fuentes: FichaMarca['fuentes'] = { ...(previa?.fuentes ?? {}), ...nueva.fuentes }
  for (const c of CAMPOS_CON_FUENTE) {
    const vacio = c === 'colores' || c === 'tipografias' ? (nueva[c] as unknown[]).length === 0 : nueva[c] === null
    if (vacio) { delete fuentes[c]; continue }
    const cambio = !previa || !igual(previa[c], nueva[c])
    if (cambio && !nueva.fuentes[c]) fuentes[c] = { origen, quien: actor.nombre, cuando: ahora }
  }
  return fuentes
}

/** El nombre de la carpeta de marca que crea la sesión del alta al lado de "Crudos - X". */
export const nombreCarpetaMarca = (sufijo: string): string => `Marca - ${sufijo.replace(/\s+/g, ' ').trim()}`

/** Una ficha vacía para un cliente (lo que muestra la pantalla antes de cargar nada). */
export const fichaVacia = (id_crm: IdCrm): FichaMarcaEntrada =>
  ({ id_crm, colores: [], tipografias: [], logo: null, referencia: null, carpeta_marca: null, fuentes: {}, notas: '' })

// ── Paleta en texto libre (la del campo "1 - Paleta de Color" de ClickUp) ────────────────────────────────────────────
/** "Verde petróleo #1E4740 Bordó #6B2737" → [{hex:'#1E4740', nombre:'Verde petróleo'}, {hex:'#6B2737', nombre:'Bordó'}]. */
export function coloresDeTexto(t: string): FichaMarca['colores'] {
  const out: FichaMarca['colores'] = []
  const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi
  let desde = 0, m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const hex = normalizarHex(m[1])!
    const nombre = t.slice(desde, m.index).replace(/[,;:·|\-–]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LARGO_NOMBRE)
    if (!out.some(c => c.hex === hex)) out.push({ hex, nombre })
    desde = m.index + m[0].length
    if (out.length >= MAX_COLORES) break
  }
  return out
}
