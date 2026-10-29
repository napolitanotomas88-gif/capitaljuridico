// ── g03 · El copy de cada anuncio, escrito desde el guion del video ─────────────────────────────────
// Alcance aprobado (27/10/2026, Hub + Tomás): el copy sale del guion. El doc «Guiones - X» tiene el texto HABLADO (HOOK →
// PROBLEMA → SOLUCIÓN → CTA, parseado por lib/bot/grabacion/guiones.ts); el copy del anuncio es otra cosa, corta, con el
// molde fijo de los que pasa Tomás (27/10):
//   «<gancho> ⬇️» · 1–2 frases con el problema y lo que se pierde si no actúa · «Enviame un mensaje 💬 y te ayudo a … antes
//   de que …». Voseo, sin promesas de resultado, sin precios.
// Qué guion es de qué video: el número del archivo («Laura Guzman 3.mp4» → 3) dentro de la tanda de la subida («2° Tanda»);
// si en esa tanda no hay un video con ese número, el N-ésimo del doc entero (a veces numeran seguido entre tandas). Si no
// aparece, no hay copy (va el del ganador con aviso). El aviso a Valen dice de qué guion salió cada copy, para que lo
// confirme. Claude con esfuerzo bajo; sin ANTHROPIC_API_KEY o si falla, sin copy (nunca frena el borrador).
import { llamarClaude } from '@/lib/bot/kickoff/claude'
import { parsearDocGuiones } from '@/lib/bot/grabacion/guiones'
import type { DocGuiones, GuionDoc } from '@/lib/edicion/tipos'
import type { VideoBorrador } from './borrador'
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

const SISTEMA = `Escribís el texto principal (copy) de un anuncio de Meta para un abogado argentino, a partir del guion del video.
Formato EXACTO, tres párrafos separados por un salto de línea:
1) El gancho en una línea, con la pregunta o la frase fuerte del HOOK, terminado en " ⬇️" (podés sumar un ⚠️ o 🚨 antes de la flecha si el gancho es una alerta).
2) Una o dos frases con el problema concreto y lo que la persona puede perder si no actúa.
3) La llamada a la acción: "Enviame un mensaje 💬 y te ayudo a <qué> antes de que <qué se pierde o se complica>."
Reglas: voseo rioplatense, primera persona del abogado ("te ayudo"), sin promesas de resultado, sin precios, sin hashtags, sin mencionar el video. Entre 250 y 450 caracteres en total.
Ejemplo:
¿Te despidieron y no sabés si te pagan todo? ⬇️
Muchas liquidaciones tienen errores en la antigüedad, el preaviso o el sueldo, y si firmás sin revisar, podés perder plata que te corresponde.
Enviame un mensaje 💬 y te ayudo a revisar tu caso antes de que firmes algo que después no puedas reclamar.`
const SCHEMA = { type: 'object', additionalProperties: false, required: ['copy'], properties: { copy: { type: 'string' } } }

/** Valida el molde: tres párrafos, gancho con ⬇️, llamada con 💬. null si no lo cumple. */
export function copyValido(x: unknown): string | null {
  const t = String(x ?? '').replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').trim()
  const ps = t.split('\n').filter(Boolean)
  return ps.length >= 3 && ps.length <= 4 && ps[0].includes('⬇️') && t.includes('💬') && t.length >= 150 && t.length <= 700 ? t : null
}

export async function escribirCopy(g: GuionDoc, topeMs = TOPE_COPY_MS): Promise<string | null> {
  const r = await llamarClaude({
    que: 'el copy del anuncio', sistema: SISTEMA, schema: SCHEMA, esfuerzo: 'low', topeMs, maxTokens: 2_000,
    usuario: `<guion>\nHOOK: ${g.secciones.hook}\nPROBLEMA: ${g.secciones.problema}\nSOLUCIÓN: ${g.secciones.solucion}\nCTA: ${g.secciones.cta}\n</guion>`,
  })
  return copyValido((r.json as { copy?: unknown })?.copy)
}

export interface DepsCopys { exportarTexto(docId: string): Promise<string>; escribir(g: GuionDoc): Promise<string | null> }

/** Los videos de la subida con su copy (o null) y de qué guion salió. Nunca tira: sin doc o sin copy, va sin copy. */
export async function videosConCopy(s: Subida, docId: string | null, deps: DepsCopys): Promise<{ videos: VideoBorrador[]; aviso: string | null }> {
  const base = s.videos.map(v => ({ nombre: v.nombre, drive: v.id, copy: null as string | null, guion: null as string | null }))
  if (!docId) return { videos: base, aviso: 'no encontré el doc «Guiones - X» en la carpeta del cliente' }
  let doc: DocGuiones
  try { doc = parsearDocGuiones(await deps.exportarTexto(docId), docId, 'X', new Date().toISOString()) } catch (e) { return { videos: base, aviso: `no pude leer el doc de guiones (${String((e as Error).message).slice(0, 80)})` } }
  const out: VideoBorrador[] = []
  for (const v of base) {
    const g = elegirGuion(doc, s.numero, v.nombre)
    let copy: string | null = null
    if (g) { try { copy = await deps.escribir(g) } catch { copy = null } }
    out.push({ ...v, copy, guion: g && copy ? g.ref : null })
  }
  const sin = out.filter(v => !v.copy).length
  return { videos: out, aviso: sin ? `${sin === out.length ? 'ningún video' : `${sin} de ${out.length} videos`} sin copy desde el guion` : null }
}
