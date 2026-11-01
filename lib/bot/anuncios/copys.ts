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
import { TAMANO_322, type GrupoBorrador } from './borrador'
import type { Subida } from './videos'

export const TOPE_COPY_MS = 45_000

/** El número del video en el nombre del archivo: «Carlos Oliva 2.mp4» → 2 · «Lucas Tapia 4-1.mp4» → 4 · sin número → null. */
export function numeroVideo(nombre: string): number | null {
  const m = nombre.replace(/\.[a-z0-9]{2,4}$/i, '').match(/(\d{1,2})(?:\s*-\s*\d{1,2})?\s*$/)
  return m ? Number(m[1]) : null
}

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

const SISTEMA = `Escribís los textos de UN anuncio de Meta para un abogado argentino. El anuncio muestra 3 videos de la misma idea
y Meta combina 2 textos principales con 2 títulos (método 3:2:2). Te paso los guiones de esos videos.
Devolvés:
· "directo": el texto principal corto, formato EXACTO en tres párrafos separados por un salto de línea:
  1) El gancho en una línea, con la pregunta o la frase fuerte de un HOOK, terminado en " ⬇️" (podés sumar ⚠️ o 🚨 antes de la flecha si es una alerta).
  2) Una o dos frases con el problema concreto y lo que la persona puede perder si no actúa.
  3) "Enviame un mensaje 💬 y te ayudo a <qué> antes de que <qué se pierde o se complica>."
  Entre 250 y 450 caracteres.
· "amplio": el texto principal largo y entretenido: arranca con una escena o situación cotidiana que la persona reconoce,
  cuenta el problema como una historia breve (3 a 5 párrafos cortos, uno por línea) y cierra con la misma llamada
  "Enviame un mensaje 💬 …". Entre 450 y 900 caracteres. Que no repita el gancho del directo.
· "titulo1" y "titulo2": dos títulos distintos de hasta 40 caracteres, invitando a escribir (ej.: "Escribime y vemos tu caso").
Reglas para todo: voseo rioplatense, primera persona del abogado ("te ayudo"), sin promesas de resultado, sin precios, sin hashtags, sin mencionar el video.
Ejemplo de directo:
¿Te despidieron y no sabés si te pagan todo? ⬇️
Muchas liquidaciones tienen errores en la antigüedad, el preaviso o el sueldo, y si firmás sin revisar, podés perder plata que te corresponde.
Enviame un mensaje 💬 y te ayudo a revisar tu caso antes de que firmes algo que después no puedas reclamar.`
const SCHEMA = { type: 'object', additionalProperties: false, required: ['amplio', 'directo', 'titulo1', 'titulo2'], properties: { amplio: { type: 'string' }, directo: { type: 'string' }, titulo1: { type: 'string' }, titulo2: { type: 'string' } } }

const limpio = (x: unknown) => String(x ?? '').replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').trim()

/** Valida el directo (el molde): tres párrafos, gancho con ⬇️, llamada con 💬. null si no lo cumple. */
export function copyValido(x: unknown): string | null {
  const t = limpio(x)
  const ps = t.split('\n').filter(Boolean)
  return ps.length >= 3 && ps.length <= 4 && ps[0].includes('⬇️') && t.includes('💬') && t.length >= 150 && t.length <= 700 ? t : null
}

/** Valida los 2 textos y los 2 títulos del 3:2:2. null si algo no cumple (va el copy del ganador, con aviso). */
export function textosValidos(x: unknown): { textos: string[]; titulos: string[] } | null {
  const r = (x ?? {}) as Record<string, unknown>
  const directo = copyValido(r.directo)
  const amplio = limpio(r.amplio)
  const pa = amplio.split('\n').filter(Boolean).length
  const titulos = [limpio(r.titulo1), limpio(r.titulo2)].map(t => t.replace(/\n/g, ' '))
  if (!directo || pa < 3 || pa > 7 || !amplio.includes('💬') || amplio.length < 300 || amplio.length > 1_100 || amplio === directo) return null
  if (titulos.some(t => t.length < 5 || t.length > 45) || titulos[0].toLowerCase() === titulos[1].toLowerCase()) return null
  return { textos: [amplio, directo], titulos }
}

export async function escribirTextos(gs: GuionDoc[], topeMs = TOPE_COPY_MS): Promise<{ textos: string[]; titulos: string[] } | null> {
  const r = await llamarClaude({
    que: 'los textos del anuncio', sistema: SISTEMA, schema: SCHEMA, esfuerzo: 'low', topeMs, maxTokens: 3_000,
    usuario: gs.map((g, i) => `<guion n="${i + 1}">\nHOOK: ${g.secciones.hook}\nPROBLEMA: ${g.secciones.problema}\nSOLUCIÓN: ${g.secciones.solucion}\nCTA: ${g.secciones.cta}\n</guion>`).join('\n'),
  })
  return textosValidos(r.json)
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
