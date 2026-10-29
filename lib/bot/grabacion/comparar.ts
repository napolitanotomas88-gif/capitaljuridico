// ── Cruce simple guiones ↔ transcripciones (puro, e03) ──────────────────────────────────────────────────────────────
// Criterio (riesgo 4 del relevamiento): "cada frase del guion aparece AL MENOS UNA VEZ en algún crudo". Los crudos traen
// tomas repetidas y la voz de quien dirige: por eso se busca la mejor aparición de cada frase, no el orden.
//   · Normaliza: minúsculas, sin acentos ni puntuación.
//   · Por cada frase, ventanas de hasta 1,3 × su largo sobre cada transcripción, arrancando en una palabra de la frase que no
//     sea de relleno; puntaje = LCS(frase, ventana) / largo de la frase. ≥ 0,85 presente; 0,6–0,85 dudosa; menos, falta.
//   · Cada crudo va al guion que dice su carpeta o su nombre (`ubicados`); si no, al guion donde cae la mayoría de sus
//     frases; si queda ambiguo, a sin_ubicar (lo asigna Aylu). La cobertura de un guion se mide contra sus crudos ubicados
//     o, si no tiene ninguno, contra los que no tienen dueño.
//   · Mejor toma: el crudo y el segundo con más frases seguidas presentes.
//   · necesitaClaude: los guiones con frases dudosas (Claude solo para eso, y nunca pasa un video a Para editar).
import type { CoberturaGuion, GuionDoc } from '../../edicion/tipos'
import { UMBRAL_FRASE } from '../../edicion/config'
import { normalizar } from './guiones'

export interface TranscripcionCruce { archivo_id: number; palabras: [number, number, string][] }

const RELLENO = new Set(['que', 'de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'un', 'una', 'por', 'con', 'no', 'se', 'lo', 'te', 'es', 'tu', 'si',
  'me', 'mi', 'al', 'del', 'le', 'o', 'para', 'su', 'pero', 'mas', 'ya', 'eso', 'esto', 'como', 'muy', 'hay'])

export const tokens = (s: string): string[] => normalizar(s).split(' ').filter(Boolean)

function lcs(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0
  let prev = new Array<number>(b.length + 1).fill(0), cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

interface Tok { t: string; ms: number }
const tokensDe = (tr: TranscripcionCruce): Tok[] => tr.palabras.flatMap(([ini, , txt]) => tokens(txt).map(t => ({ t, ms: ini })))

/** La mejor aparición de una frase en una transcripción: puntaje (0 a 1) y en qué milisegundo arranca. */
export function mejorAparicion(frase: readonly string[], trans: readonly Tok[]): { puntaje: number; ms: number } {
  const n = frase.length
  if (!n || !trans.length) return { puntaje: 0, ms: 0 }
  const todas = new Set(frase)
  const ancla = new Set(frase.filter(w => !RELLENO.has(w)))
  const set = ancla.size ? ancla : todas
  const largo = Math.max(n, Math.ceil(n * 1.3))
  let mejor = { puntaje: 0, ms: 0 }
  const vistas = new Set<number>()
  // La ventana arranca en una palabra de la frase (puede ser de relleno: "te despidieron…") que tenga un ancla cerca
  for (let i = 0; i < trans.length; i++) {
    if (!set.has(trans[i].t)) continue
    for (let s = Math.max(0, i - n); s <= i; s++) {
      if (vistas.has(s) || !todas.has(trans[s].t)) continue
      vistas.add(s)
      const p = lcs(frase, trans.slice(s, s + largo).map(x => x.t)) / n
      if (p > mejor.puntaje) { mejor = { puntaje: p, ms: trans[s].ms }; if (p >= 1) return mejor }
    }
  }
  return mejor
}

const nivel = (p: number): 'presente' | 'dudosa' | 'falta' => (p >= UMBRAL_FRASE.presente ? 'presente' : p >= UMBRAL_FRASE.dudosa ? 'dudosa' : 'falta')

export interface ResultadoCruce {
  coberturas: CoberturaGuion[]
  necesitaClaude: string[]
  /** archivo → guion asignado (por carpeta/nombre o por contenido) */
  asignacion: Map<number, { ref: string; por: 'carpeta' | 'contenido' }>
  sin_ubicar: number[]
}

/**
 * guiones: los de la tanda del guion; trans: las transcripciones disponibles; ubicados: archivo → ref del guion (por la
 * carpeta, el nombre o el vínculo ya hecho); videoDe: ref → id del video (si existe).
 */
export function cruceSimple(guiones: readonly GuionDoc[], trans: readonly TranscripcionCruce[], op: { ubicados?: Map<number, string>; videoDe?: Map<string, number> } = {}): ResultadoCruce {
  const ubicados = op.ubicados ?? new Map<number, string>()
  const toks = new Map(trans.map(t => [t.archivo_id, tokensDe(t)]))
  const frases = new Map(guiones.map(g => [g.ref, g.frases.map(tokens).filter(f => f.length)]))
  // Puntajes de cada frase de cada guion en cada transcripción
  const puntajes = new Map<string, Map<number, { puntaje: number; ms: number }[]>>()
  for (const g of guiones) {
    const porArchivo = new Map<number, { puntaje: number; ms: number }[]>()
    for (const t of trans) porArchivo.set(t.archivo_id, (frases.get(g.ref) ?? []).map(f => mejorAparicion(f, toks.get(t.archivo_id) ?? [])))
    puntajes.set(g.ref, porArchivo)
  }
  // Asignación de cada crudo
  const asignacion = new Map<number, { ref: string; por: 'carpeta' | 'contenido' }>()
  const sin_ubicar: number[] = []
  const refs = new Set(guiones.map(g => g.ref))
  for (const t of trans) {
    const u = ubicados.get(t.archivo_id)
    if (u && refs.has(u)) { asignacion.set(t.archivo_id, { ref: u, por: 'carpeta' }); continue }
    const conteo = guiones.map(g => ({ ref: g.ref, n: (puntajes.get(g.ref)?.get(t.archivo_id) ?? []).filter(x => x.puntaje >= UMBRAL_FRASE.presente).length }))
      .sort((a, b) => b.n - a.n)
    if (conteo.length && conteo[0].n > 0 && (conteo.length === 1 || conteo[0].n > conteo[1].n)) asignacion.set(t.archivo_id, { ref: conteo[0].ref, por: 'contenido' })
    else sin_ubicar.push(t.archivo_id)
  }
  const coberturas: CoberturaGuion[] = []
  const necesitaClaude: string[] = []
  for (const g of guiones) {
    const fs = frases.get(g.ref) ?? []
    const propios = trans.filter(t => asignacion.get(t.archivo_id)?.ref === g.ref).map(t => t.archivo_id)
    const candidatos = propios.length ? propios : sin_ubicar
    const base: CoberturaGuion = { guion_ref: g.ref, video_id: op.videoDe?.get(g.ref) ?? null, frases: g.frases.length, presentes: 0, faltan: [], dudosas: [], mejor_toma: null, por: 'cruce', estado: 'sin_transcripcion' }
    if (!candidatos.length || !fs.length) { coberturas.push(base); continue }
    const porArchivo = puntajes.get(g.ref)!
    const mejores = fs.map((_, i) => {
      let m = { archivo_id: candidatos[0], puntaje: 0, ms: 0 }
      for (const a of candidatos) { const x = porArchivo.get(a)?.[i]; if (x && x.puntaje > m.puntaje) m = { archivo_id: a, ...x } }
      return m
    })
    mejores.forEach((m, i) => {
      const n = nivel(m.puntaje)
      if (n === 'presente') base.presentes++
      else if (n === 'dudosa') base.dudosas.push(g.frases[i])
      else base.faltan.push(g.frases[i])
    })
    // Mejor toma: el crudo con la racha más larga de frases seguidas presentes
    let toma: { archivo_id: number; segundo: number; racha: number } | null = null
    for (const a of candidatos) {
      const xs = porArchivo.get(a) ?? []
      let racha = 0, inicio = 0
      xs.forEach((x, i) => {
        if (x.puntaje >= UMBRAL_FRASE.presente) { if (racha === 0) inicio = i; racha++ } else racha = 0
        if (racha && (!toma || racha > toma.racha)) toma = { archivo_id: a, segundo: Math.floor((xs[inicio].ms ?? 0) / 1000), racha }
      })
    }
    const t = toma as { archivo_id: number; segundo: number; racha: number } | null
    base.mejor_toma = t ? { archivo_id: t.archivo_id, segundo: t.segundo } : null
    base.estado = base.presentes === g.frases.length ? 'completo' : 'incompleto'
    if (base.dudosas.length) necesitaClaude.push(g.ref)
    coberturas.push(base)
  }
  return { coberturas, necesitaClaude, asignacion, sin_ubicar }
}

/**
 * Los tramos de transcripción alrededor (±20 s) de CADA aparición de las palabras clave de un guion: lo único que va a Claude.
 * Las ventanas que se tocan se unen; después se eligen las que tienen más palabras clave distintas (de cualquier crudo) hasta
 * maxChars, salteando la que no entra (una toma larga del primer crudo no deja afuera a la toma buena del segundo).
 */
export function tramosCandidatos(g: GuionDoc, trans: readonly TranscripcionCruce[], margenMs = 20_000, maxChars = 6_000): { archivo_id: number; desde_s: number; texto: string }[] {
  const claves = new Set(g.frases.flatMap(tokens).filter(w => !RELLENO.has(w) && w.length > 3))
  const ventanas: { archivo_id: number; orden: number; desde: number; texto: string; puntaje: number }[] = []
  trans.forEach((t, orden) => {
    const hits = t.palabras.filter(([, , w]) => tokens(w).some(x => claves.has(x))).map(([ini]) => ini).sort((a, b) => a - b)
    if (!hits.length) return
    // Intervalos [hit − margen, hit + margen] unidos cuando se tocan
    const tramos: [number, number][] = []
    for (const h of hits) {
      const a = Math.max(0, h - margenMs), b = h + margenMs
      const u = tramos[tramos.length - 1]
      if (u && a <= u[1]) u[1] = Math.max(u[1], b)
      else tramos.push([a, b])
    }
    for (const [desde, hasta] of tramos) {
      const ws = t.palabras.filter(([ini]) => ini >= desde && ini <= hasta).map(([, , w]) => w)
      const distintas = new Set(ws.flatMap(tokens).filter(x => claves.has(x))).size
      ventanas.push({ archivo_id: t.archivo_id, orden, desde, texto: ws.join(' '), puntaje: distintas })
    }
  })
  const elegidas: typeof ventanas = []
  let total = 0
  for (const v of [...ventanas].sort((a, b) => b.puntaje - a.puntaje || a.texto.length - b.texto.length || a.orden - b.orden || a.desde - b.desde)) {
    if (!v.texto || total + v.texto.length > maxChars) continue
    total += v.texto.length
    elegidas.push(v)
  }
  return elegidas.sort((a, b) => a.orden - b.orden || a.desde - b.desde).map(v => ({ archivo_id: v.archivo_id, desde_s: Math.floor(v.desde / 1000), texto: v.texto }))
}
