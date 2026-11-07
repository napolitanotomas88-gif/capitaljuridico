// ── g03 · Los textos de cada anuncio (método 3:2:2), escritos desde los guiones de sus videos ───────────
// Alcance aprobado (27/10/2026, Hub + Tomás): el copy sale del guion. El doc «Guiones - X» tiene el texto HABLADO (HOOK →
// PROBLEMA → SOLUCIÓN → CTA, parseado por lib/bot/grabacion/guiones.ts); el copy del anuncio es otra cosa, corta, con el
// molde fijo de los que pasa Tomás (27/10):
//   «<gancho> ⬇️» · 1–2 frases con el problema y lo que se pierde si no actúa · «Enviame un mensaje 💬 y te ayudo a … antes
//   de que …». Voseo, sin promesas de resultado, sin precios.
// Qué guion es de qué video: el número del archivo («Laura Guzman 3.mp4» → 3) dentro de la tanda de la subida («2° Tanda»);
// si en esa tanda no hay un video con ese número, el N-ésimo del doc entero (a veces numeran seguido entre tandas). Si no
// aparece, no hay copy (va el del ganador con aviso). El aviso a Valen dice de qué guion salió cada copy, para que lo
// confirme. Claude con esfuerzo bajo; sin ANTHROPIC_API_KEY o si falla, sin copy (nunca frena el borrador).
// Método 3:2:2 (Hub + Tomás, 1/11/2026; reemplaza las 5 variaciones de copy): cada anuncio es UNO SOLO en formato flexible
// con 3 creativos del mismo formato y la misma idea, 2 textos principales (uno amplio/entretenido y uno directo, el molde de
// arriba) y 2 títulos, sin descripciones; Meta combina las 12 variantes. Los creativos son los videos que ya grabó el
// cliente, de a 3 en el orden de la tanda (Tomás no quiere pedirle a Guiones 3 ejecuciones por concepto).
import { llamarClaude } from '@/lib/bot/kickoff/claude'
import { parsearDocGuiones } from '@/lib/bot/grabacion/guiones'
import type { DocGuiones, GuionDoc } from '@/lib/edicion/tipos'
import { TAMANO_322, numeroVideo, type GrupoBorrador } from './borrador'
export { numeroVideo }
import type { Subida } from './videos'

export const TOPE_COPY_MS = 45_000

/** El número del video en el nombre del archivo: «Carlos Oliva 2.mp4» → 2 · «Lucas Tapia 4-1.mp4» → 4 · sin número → null. */

/** El guion de este video: por número en la tanda; si no, el N-ésimo del doc. null si no aparece. */
export function elegirGuion(doc: DocGuiones, tanda: number | null, nombre: string): GuionDoc | null {
  const n = numeroVideo(nombre)
  if (!n) return null
  const conTexto = doc.guiones.filter(g => g.secciones.hook || g.secciones.problema)
  const enTanda = tanda ? conTexto.find(g => g.tanda === tanda && g.numero === n) : null
  if (enTanda) return enTanda
  const orden = [...conTexto].sort((a, b) => a.tanda - b.tanda || a.numero - b.numero)
  return tanda && !conTexto.some(g => g.tanda === tanda) ? null : orden[n - 1] ?? null
}

// Estructura de cada texto (Tomás, 4/11/2026; reclamada de nuevo el 5/11 con A124): hook (avatar + problema) que termina en
// ⚠️⬇️ o 🚨⬇️ · línea en blanco · cuerpo (2–3 frases cortas, el dolor como pensamiento cotidiano) · línea en blanco · CTA con 💬.
// Texto 1 = amplio; texto 2 = directo de 180 caracteres o menos (saltos incluidos), mismo hook y mismas palabras, acortado.
// Títulos de hasta 40 caracteres que no repiten el hook. Solo los emojis ⬇️ 💬 ⚠️ 🚨.
const SISTEMA = `Escribís los textos de UN anuncio de Meta para un abogado. El anuncio muestra videos de la misma idea y Meta combina
2 textos principales con 2 títulos (método 3:2:2). Te paso los guiones (o el copy) de esos videos.

ESTRUCTURA DE CADA TEXTO (obligatoria, con los saltos de línea exactos):
1) HOOK: una sola línea que le habla a una persona concreta y marca un problema o una situación concreta. Termina en " ⚠️⬇️" o " 🚨⬇️".
2) Una línea en blanco.
3) CUERPO: el dolor planteado como un pensamiento cotidiano de la persona, en 2 o 3 frases cortas, en un solo párrafo. No expliques cómo se resuelve el caso.
4) Una línea en blanco.
5) CTA: cierre con urgencia suave y pedido de mensaje con 💬, en una sola línea: "Enviame un mensaje 💬 y te ayudo a ...".

Devolvés:
· "amplio" (TEXTO 1): hook + cuerpo + CTA completo. Entre 200 y 450 caracteres.
· "directo" (TEXTO 2): 180 caracteres o menos CONTANDO los saltos de línea. El MISMO hook (idéntico al del amplio) + una sola línea con la idea clave + un CTA corto. Mismas palabras y mismos emojis que el amplio, solo que acortado.
· "titulo1" y "titulo2": dos títulos distintos de 40 caracteres o menos cada uno (contalos). Concretos, con las palabras del problema, sin repetir el hook textual.

REGLAS:
· Frases cortas y lenguaje de todos los días. Sin jerga legal.
· Hablale a una persona concreta, no a "todos".
· Usá solo estos emojis: ⬇️ 💬 ⚠️ 🚨.
· Español rioplatense con "vos" (enviame, podés, mandame, revisá). Si el guion está en "tú" (Chile, Colombia), usá "tú" neutro (puedes, escríbeme, envíame).
· Prohibido: "no estás solo", "tenemos la solución", "contactanos hoy", "asesoramiento personalizado" y frases genéricas así.
· No prometas resultados ni montos. No menciones ciudades ni provincias. Sin precios, sin hashtags, sin mencionar el video.
· Son variaciones, no textos nuevos (Tomás, 3/11): usá las MISMAS palabras de los guiones; el hook sale literal (o casi) de un HOOK y el cuerpo, con las palabras del PROBLEMA. Nada de palabras raras ni sinónimos "de marketing".
· Si el CTA del guion pide otra acción (por ejemplo, seguir en Instagram), usá esa en lugar de "enviame un mensaje", con 💬.
Ejemplo de amplio:
¿Te despidieron y no sabés si te pagaron todo? ⚠️⬇️

Firmaste la liquidación y algo no te cierra. Pensás que ya está, que no hay nada para hacer.

Enviame un mensaje 💬 y te ayudo a revisar tu caso antes de que se te pase el plazo.
Ejemplo de directo:
¿Te despidieron y no sabés si te pagaron todo? ⚠️⬇️

Firmaste y algo no te cierra.

Enviame un mensaje 💬 y te ayudo a revisar tu caso.`
const SCHEMA = { type: 'object', additionalProperties: false, required: ['amplio', 'directo', 'titulo1', 'titulo2'], properties: { amplio: { type: 'string' }, directo: { type: 'string' }, titulo1: { type: 'string' }, titulo2: { type: 'string' } } }

const limpio = (x: unknown) => String(x ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
const largo = (t: string) => [...t].length
const EMOJIS_OK = new Set(['⬇', '💬', '⚠', '🚨'])

/** La estructura del 4/11: hook terminado en ⚠️⬇️/🚨⬇️ · línea en blanco · cuerpo · línea en blanco · CTA con 💬; solo ⬇️ 💬 ⚠️ 🚨. */
export function estructuraOk(t: string): boolean {
  const ps = t.split('\n\n')
  if (ps.length !== 3 || ps.some(p => !p.trim())) return false
  const [hook, cuerpo, cta] = ps
  if (hook.includes('\n') || cta.includes('\n') || cuerpo.split('\n').length > 3) return false
  if (!/(⚠️|🚨)\s*⬇️$/u.test(hook)) return false
  if (!cta.includes('💬')) return false
  return [...t.matchAll(/\p{Extended_Pictographic}/gu)].every(m => EMOJIS_OK.has(m[0]))
}

/** Valida el directo (texto 2): la estructura y 180 caracteres o menos con los saltos. null si no lo cumple. */
export function copyValido(x: unknown): string | null {
  const t = limpio(x)
  return estructuraOk(t) && largo(t) <= 180 ? t : null
}

/** Valida los 2 textos y los 2 títulos del 3:2:2. null si algo no cumple (va el copy del ganador o del Doc, con aviso). */
export function textosValidos(x: unknown): { textos: string[]; titulos: string[] } | null {
  const r = (x ?? {}) as Record<string, unknown>
  const directo = copyValido(r.directo)
  const amplio = limpio(r.amplio)
  const titulos = [limpio(r.titulo1), limpio(r.titulo2)].map(t => t.replace(/\n/g, ' '))
  if (!directo || !estructuraOk(amplio) || largo(amplio) < 150 || largo(amplio) > 700 || amplio === directo) return null
  const hook = amplio.split('\n')[0]
  if (directo.split('\n')[0] !== hook) return null
  const sinEmoji = (t: string) => t.replace(/[\s⬇️⚠️🚨?¿!¡.]+/gu, ' ').trim().toLowerCase()
  if (titulos.some(t => largo(t) < 5 || largo(t) > 40 || sinEmoji(t) === sinEmoji(hook)) || titulos[0].toLowerCase() === titulos[1].toLowerCase()) return null
  return { textos: [amplio, directo], titulos }
}

const palabras = (t: string) => new Set(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-zñ]+/).filter(w => w.length >= 5 && !COMUNES.has(w)))
const COMUNES = new Set(['sobre', 'tenes', 'podes', 'sabes', 'estas', 'tiene', 'cuando', 'porque', 'mensaje', 'enviame', 'ayudo'])
/** ¿El gancho del directo sale de un HOOK? Al menos una palabra de 5+ letras con contenido en común con alguno (variación, no texto nuevo). */
export function ganchoFiel(directo: string, hooks: readonly string[]): boolean {
  const g = palabras(directo.split('\n')[0] ?? '')
  return hooks.some(h => [...palabras(h)].some(w => g.has(w)))
}

export async function escribirTextos(gs: GuionDoc[], topeMs = TOPE_COPY_MS): Promise<{ textos: string[]; titulos: string[] } | null> {
  const r = await llamarClaude({
    que: 'los textos del anuncio', sistema: SISTEMA, schema: SCHEMA, esfuerzo: 'low', topeMs, maxTokens: 3_000,
    usuario: gs.map((g, i) => `<guion n="${i + 1}">\nHOOK: ${g.secciones.hook}\nPROBLEMA: ${g.secciones.problema}\nSOLUCIÓN: ${g.secciones.solucion}\nCTA: ${g.secciones.cta}\n</guion>`).join('\n'),
  })
  const t = textosValidos(r.json)
  const hooks = gs.map(g => g.secciones.hook).filter(Boolean)
  return t && (!hooks.length || ganchoFiel(t.textos[1], hooks)) ? t : null
}

export interface DepsCopys { exportarTexto(docId: string): Promise<string>; escribir(gs: GuionDoc[]): Promise<{ textos: string[]; titulos: string[] } | null> }

/** Los videos en orden, de a 3 (el último grupo puede quedar con 1 o 2). */
export function agrupar322<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += TAMANO_322) out.push(xs.slice(i, i + TAMANO_322))
  return out
}

/** Los anuncios de la subida (de a 3 videos) con sus textos (o sin) y de qué guiones salieron. Nunca tira. */
export async function gruposConTextos(s: Subida, docId: string | null, deps: DepsCopys): Promise<{ grupos: GrupoBorrador[]; aviso: string | null }> {
  const base = (vs: Subida['videos']): GrupoBorrador => ({ videos: vs.map(v => ({ nombre: v.nombre, drive: v.id })), textos: [], titulos: [], guiones: [] })
  const ordenados = [...s.videos].sort((a, b) => (numeroVideo(a.nombre) ?? 99) - (numeroVideo(b.nombre) ?? 99) || a.nombre.localeCompare(b.nombre))
  const grupos = agrupar322(ordenados)
  if (!docId) return { grupos: grupos.map(base), aviso: 'no encontré el doc «Guiones - X» en la carpeta del cliente' }
  let doc: DocGuiones
  try { doc = parsearDocGuiones(await deps.exportarTexto(docId), docId, 'X', new Date().toISOString()) } catch (e) { return { grupos: grupos.map(base), aviso: `no pude leer el doc de guiones (${String((e as Error).message).slice(0, 80)})` } }
  const out: GrupoBorrador[] = []
  for (const vs of grupos) {
    const g = base(vs)
    const gs = vs.map(v => elegirGuion(doc, s.numero, v.nombre)).filter((x): x is GuionDoc => !!x)
    let t: { textos: string[]; titulos: string[] } | null = null
    if (gs.length) { try { t = await deps.escribir(gs) } catch { t = null } }
    out.push(t ? { ...g, ...t, guiones: gs.map(x => x.ref) } : g)
  }
  const sin = out.filter(g => !g.textos.length).length
  return { grupos: out, aviso: sin ? `${sin === out.length ? 'ningún anuncio' : `${sin} de ${out.length} anuncios`} sin textos desde el guion` : null }
}
