// ── Doc «Organización de ADS - Orgánico»: cuándo un cliente está LISTO para lanzar, con sus videos y su copy ─────────
// Pedido de Tomás (3/11/2026): «ahí tiene toda la información de cuando un cliente está listo para lanzar». El bot de
// borradores (g01, videos.ts) solo miraba «Editados - X» en Drive; los videos que René deja en SU Drive y anota en este
// Doc no los veía (un cliente con 6 videos cargados en el Doc tenía 1 solo en su carpeta de editados). El Doc se lee con la
// cuenta de servicio (export a texto, el mismo lector de los guiones) y su ID va por entorno (ANUNCIOS_DOC_ADS_ID): el
// repo es público y el Doc tiene los copys de los clientes.
// Estructura (la que usa el equipo, lo más nuevo arriba):
//   «<Nombre> - LISTO»                      ← encabezado del cliente: LISTO u otra nota («Hacer la campaña desde su perfil
//                                              de ig cuando estén todos publicados», «Revisión», «EN PAUSA»…); a veces con
//                                              número adelante («3- …») o algo después de LISTO («LISTO (Acceso portfolio)»)
//   «video 1:https://drive.google.com/file/d/<id>/view»
//   <copy del video 1: gancho ⬇️ · problema · «Enviame un mensaje 💬 …»>
//   «04/11 9HS»                             ← a veces, la fecha/hora (de la publicación orgánica)
//   «video 2: …»
// Acá, PURO (sin red; lo prueba scripts/test-bot-anuncios-doc-ads.mjs): el parser, el cruce del nombre con el CRM
// (tolerante a una letra: «Perezz» = «Perez») y los grupos del borrador (3:2:2) con el copy del Doc como texto 1.
import type { GrupoBorrador } from './borrador'

export interface VideoDoc {
  numero: number
  drive: string | null            // id del archivo en Drive (null = la línea no tenía link: «video 8: Publicado»)
  copy: string                    // el texto del anuncio (sus párrafos, separados por \n); '' si no tiene
  fecha: string | null            // «04/11 9HS», si la anotaron debajo
  nota: string | null             // lo que había en la línea del video además del link («(jubilación)», «Lunes 9am»)
}
export interface BloqueDoc {
  linea: number                   // 1 = primera línea del Doc (para ubicarlo)
  titulo: string                  // el encabezado tal cual
  nombre: string                  // la parte del cliente
  estado: string                  // lo que va después del nombre («LISTO», «LISTO (Acceso portfolio)», «Revisión»…)
  listo: boolean
  nota: string | null             // el estado sin la palabra LISTO, o el estado entero si no es LISTO
  videos: VideoDoc[]
}

const RE_VIDEO = /^\s*video\s*(\d{1,2})\s*[:;.\-–]?\s*(.*)$/i
const RE_FECHA = /^\s*(?:(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b.{0,24}$/i
const RE_DRIVE = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)|drive\.usercontent\.google\.com\/download\?id=)([A-Za-z0-9_-]{20,})/
const RE_URL = /https?:\/\/\S+/g
const EMOJIS_COPY = /[⬇💬]/u

/** El id de Drive de un link («…/file/d/<id>/view?usp=…»), o null. */
export const idDrive = (s: string): string | null => s.match(RE_DRIVE)?.[1] ?? null

const sinNumeroAdelante = (s: string) => s.replace(/^\s*\d{1,2}\s*[-.)]?\s+(?=\D)/, '')
const recortar = (s: string) => s.replace(/^[\s\-–.:|]+|[\s\-–.:|]+$/g, '').trim()

/** «Javier Pérez - LISTO» → { nombre, estado } · null si la línea no parece un encabezado de cliente. */
export function partirEncabezado(linea: string): { nombre: string; estado: string } | null {
  const t = sinNumeroAdelante(linea.trim())
  if (t.length < 3 || t.length > 120 || /https?:\/\//i.test(t) || EMOJIS_COPY.test(t) || /[¿?¡!]/.test(t)) return null
  let nombre: string, estado: string
  const listo = t.match(/(?:^|[\s\-–.:|])(listo)\b/i)
  if (listo && listo.index !== undefined) {
    const i = listo.index + listo[0].toLowerCase().lastIndexOf('listo')
    nombre = recortar(t.slice(0, i))
    estado = t.slice(i).trim()
  } else {
    const m = t.match(/^(.+?)\s+[-–.:]\s*(.+)$/) ?? t.match(/^(.+?)\s*[-–]\s+(.+)$/)
    if (!m) return null
    nombre = recortar(m[1]); estado = recortar(m[2])
  }
  const palabras = nombre.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean)
  if (!nombre || !estado || palabras.length > 7 || nombre.length > 60 || estado.length > 90) return null
  return { nombre, estado }
}

/** El Doc entero (export a texto) → un bloque por encabezado de cliente, en el orden del Doc (lo más nuevo arriba). */
export function parsearDocAds(texto: string): BloqueDoc[] {
  const lineas = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const indiceProxima = (i: number) => { for (let j = i + 1; j < Math.min(lineas.length, i + 4); j++) if (lineas[j].trim()) return j; return -1 }
  const proxima = (i: number) => { const j = indiceProxima(i); return j < 0 ? '' : lineas[j] }
  const bloques: BloqueDoc[] = []
  let actual: BloqueDoc | null = null
  let video: VideoDoc | null = null
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim()
    if (!l) continue
    const v = l.match(RE_VIDEO)
    if (v) {
      if (!actual) continue
      let resto = v[2] ?? ''
      let drive = idDrive(resto)
      // El link a veces queda en la línea de abajo («video 6: (jubilación)» + link)
      if (!drive) {
        const j = indiceProxima(i)
        const sig = j < 0 ? '' : lineas[j].trim()
        const d = idDrive(sig)
        if (d && sig.replace(RE_URL, '').trim() === '') { drive = d; i = j }
      }
      resto = resto.replace(RE_URL, '').trim()
      video = { numero: Number(v[1]), drive, copy: '', fecha: null, nota: recortar(resto) || null }
      actual.videos.push(video)
      continue
    }
    if (RE_FECHA.test(l) && l.length <= 32) {
      if (video && !video.fecha) video.fecha = l
      continue
    }
    const enc = partirEncabezado(l)
    const esEncabezado = enc && (/\blisto\b/i.test(enc.estado) || RE_VIDEO.test(proxima(i)))
    if (enc && esEncabezado) {
      const listo = /^listo\b/i.test(enc.estado)
      const nota = listo ? recortar(enc.estado.replace(/^listo\b/i, '')) || null : enc.estado
      actual = { linea: i + 1, titulo: l, nombre: enc.nombre, estado: enc.estado, listo, nota, videos: [] }
      bloques.push(actual)
      video = null
      continue
    }
    // Un link suelto debajo del encabezado (sin «video N:»): es el video siguiente
    const suelto = idDrive(l)
    if (suelto && actual && l.replace(RE_URL, '').trim() === '') {
      video = { numero: (actual.videos.at(-1)?.numero ?? 0) + 1, drive: suelto, copy: '', fecha: null, nota: null }
      actual.videos.push(video)
      continue
    }
    // Un renglón del copy del video en curso
    if (video && !/^https?:\/\//i.test(l)) video.copy = video.copy ? `${video.copy}\n${l}` : l
  }
  return bloques
}

// ── El cruce del nombre del Doc con el CRM ──
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'estudio', 'juridico', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'dra', 'dr', 'skwd'])
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const tokens = (s: string): string[] => normal(s.replace(/\([^)]*\)/g, ' ')).split(/[^a-zñ0-9]+/).filter(w => w.length >= 3 && !VACIAS.has(w))

/** Distancia de edición (para tolerar una letra: «perezz» ↔ «perez»). */
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const igual = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && distancia(a, b) <= 1)

/** Cuántas palabras del nombre del Doc aparecen (con una letra de tolerancia) en el nombre del CRM. */
export function puntosNombre(doc: string, crm: string): number {
  const c = tokens(crm)
  return tokens(doc).filter(w => c.some(x => igual(w, x))).length
}

/**
 * El cliente del CRM de un nombre del Doc. «firme» = comparte 2 palabras o más (nombre y apellido) y nadie empata; «debil»
 * = una sola palabra (el Doc a veces pone solo el nombre de pila): se muestra, pero NO arma nada.
 */
export function cruzarNombreDoc<T extends { cliente: string }>(doc: string, xs: readonly T[]): { x: T; fuerza: 'firme' | 'debil' } | null {
  let mejor: T | null = null, puntos = 0, empate = false
  for (const x of xs) {
    const n = puntosNombre(doc, x.cliente)
    if (n > puntos) { mejor = x; puntos = n; empate = false } else if (n && n === puntos && x !== mejor) empate = true
  }
  if (!mejor || !puntos || empate) return null
  return { x: mejor, fuerza: puntos >= 2 ? 'firme' : 'debil' }
}

export interface EstadoDoc {
  titulo: string; linea: number; listo: boolean; nota: string | null; fuerza: 'firme' | 'debil'
  videos: number                  // con link de Drive
  bloque: BloqueDoc
}

/**
 * El estado de cada cliente en el Doc: el bloque MÁS ARRIBA que se le cruza (lo más nuevo). El cruce se hace contra todos
 * los clientes (`todos`: corriendo y por lanzar), así un bloque de «Lucas Otro» no cae en «Lucas Uno». Clave = el cliente.
 */
export function estadoPorCliente<T extends { cliente: string }>(bloques: readonly BloqueDoc[], todos: readonly T[]): Map<T, EstadoDoc> {
  const out = new Map<T, EstadoDoc>()
  for (const b of bloques) {
    const c = cruzarNombreDoc(b.nombre, todos)
    if (!c || out.has(c.x)) continue
    out.set(c.x, { titulo: b.titulo, linea: b.linea, listo: b.listo, nota: b.nota, fuerza: c.fuerza, videos: b.videos.filter(v => v.drive).length, bloque: b })
  }
  return out
}

/** ¿Arma borrador? Solo LISTO, con cruce firme y al menos un video con link. */
export const armaDesdeDoc = (e: EstadoDoc | null | undefined): boolean => !!e && e.listo && e.fuerza === 'firme' && e.videos > 0

/** Lo que se muestra del Doc en el tablero / los avisos: «LISTO · 3 videos» o la nota tal cual. */
export function textoEstadoDoc(e: EstadoDoc): string {
  const vids = `${e.videos} ${e.videos === 1 ? 'video' : 'videos'}`
  if (e.listo) return `LISTO${e.nota ? ` (${e.nota})` : ''} · ${vids}${e.fuerza === 'debil' ? ' · ⚠️ el nombre del Doc no alcanza para confirmar el cliente' : ''}`
  return `«${e.nota ?? e.titulo}»${e.videos ? ` · ${vids}` : ''}`
}

// ── Los grupos del borrador (3:2:2) con el copy del Doc ──
export interface VideoParaArmar { drive: string; nombre: string; copy: string }

/**
 * Los videos del Doc en su orden, UNO POR GRUPO: cada video del Doc trae su propio copy, así que es su propia idea y va en
 * su propio conjunto si el presupuesto alcanza (regla de estructura, plan.ts). Antes iban de a 3 como una sola idea y la
 * campaña de A133 (4/11) salió con 1 conjunto y 3 anuncios. El copy de cada video es el texto principal de SU anuncio
 * (copyPorVideo); `textos`/`titulos` (la variación amplia y los 2 títulos, copys.ts) se completan después. Puro.
 */
export function gruposDesdeDoc(videos: readonly VideoParaArmar[]): GrupoBorrador[] {
  return videos.map(v => ({
    videos: [{ nombre: v.nombre, drive: v.drive }], textos: [], titulos: [], guiones: [],
    copyPorVideo: v.copy.trim() ? { [v.drive]: v.copy.trim() } : {},
  }))
}

/** El copy del Doc como «guion» para escribir la variación amplia y los 2 títulos (copys.ts): gancho, problema y llamada. */
export function guionDesdeCopy(copy: string, n: number): { ref: string; tanda: number; numero: number; secciones: { hook: string; problema: string; solucion: string; cta: string } } {
  const ps = copy.split('\n').map(x => x.trim()).filter(Boolean)
  return {
    ref: `Doc de ADS · video ${n}`, tanda: 0, numero: n,
    secciones: { hook: (ps[0] ?? '').replace(/[\s⬇️⚠️🚨]+$/u, ''), problema: ps.slice(1, -1).join(' ') || (ps[1] ?? ''), solucion: '', cta: ps.length > 1 ? ps[ps.length - 1] : '' },
  }
}

/** La clave del aviso/armado: una vez por cliente por conjunto de videos (si suman videos, sale de nuevo). */
export function claveDoc(cliente: { idCrm: string | null; cliente: string }, drives: readonly string[]): string {
  const id = cliente.idCrm?.trim().toUpperCase() || tokens(cliente.cliente).join('-')
  const lista = [...new Set(drives)].sort().join(',')
  let h = 0
  for (let i = 0; i < lista.length; i++) h = (Math.imul(h, 31) + lista.charCodeAt(i)) | 0
  return `docads:${id}:${drives.length}:${(h >>> 0).toString(36)}`
}
