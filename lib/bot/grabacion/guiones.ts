// ── Doc "Guiones - X": de texto plano a guiones (puro) ───────────────────────────────────────────────────────────────
// El texto sale de files/{id}/export?mimeType=text/plain. Estructura que se repite (relevamiento y ejemplos de laboral):
//   · títulos "TANDA 1°", "TANDA 2°"… (a veces "Guiones 1° Tanda");
//   · cada video arranca con el desplegable "Video: <estado>" (en el texto exportado: "* Video: Para grabar"). Estados:
//     No iniciado, Para grabar, En grabación (cuenta como para_grabar) y Grabado completo;
//   · secciones HOOK → PROBLEMA → SOLUCIÓN → CTA (a veces "### HOOK"), con "Velocidad N" y una indicación entre paréntesis
//     que no se dice: las dos se sacan.
// Frases: cada sección se parte por la puntuación y los saltos de línea; una frase de menos de 3 palabras se junta con la
// siguiente. La huella es un sha256 del texto normalizado del guion (sirve para reconocer el mismo guion aunque cambie de
// lugar y para saber si cambió).
import { createHash } from 'node:crypto'
import type { DocGuiones, EstadoGuionDoc, GuionDoc, IdCrm, Iso, Video, Ymd } from '../../edicion/tipos'

export const normalizar = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

export const huellaTexto = (s: string): string => createHash('sha256').update(normalizar(s)).digest('hex').slice(0, 32)

function estadoDoc(s: string): EstadoGuionDoc {
  const t = normalizar(s)
  if (/^no iniciad/.test(t)) return 'no_iniciado'
  if (/^para grabar|^en grabacion|^grabando/.test(t)) return 'para_grabar'
  if (/^grabad[oa] completo|^grabado$/.test(t)) return 'grabado_completo'
  return 'otro'
}

const RE_TANDA = /^\s*(?:#+\s*)?(?:guiones\s+)?(?:tanda\s*(?:n[°ºo.]?\s*)?(\d{1,2})\s*[°º]?|(\d{1,2})\s*[°º]\s*tanda)\b/i
const RE_VIDEO = /^\s*[*•\-–]?\s*video\s*:\s*(.*)$/i
const RE_SECCION = /^\s*(?:#+\s*)?(hook|gancho|problema|soluci[oó]n|cta|llamad[ao] a la acci[oó]n)\s*:?\s*(.*)$/i

const clave = (s: string): keyof GuionDoc['secciones'] | null => {
  const t = normalizar(s)
  if (t === 'hook' || t === 'gancho') return 'hook'
  if (t === 'problema') return 'problema'
  if (t === 'solucion') return 'solucion'
  if (t === 'cta' || t.startsWith('llamad')) return 'cta'
  return null
}

/** Lo que no se dice: indicaciones entre paréntesis o corchetes y "Velocidad N". */
export function textoHablado(s: string): string {
  return s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\bvelocidad\s*:?\s*\d(?:[.,]\d)?\b/gi, ' ')
    .replace(/[ \t]+/g, ' ').trim()
}

export function partirFrases(s: string): string[] {
  const crudas = textoHablado(s).split(/[\n\r]+|(?<=[.!?¿¡;:…])\s+|(?<=[.!?…])(?=\S)/).map(x => x.replace(/^[\s\-–•*"“”«»]+|[\s"“”«»]+$/g, '').trim()).filter(x => normalizar(x).length > 0)
  const out: string[] = []
  let pendiente = ''
  for (const f of crudas) {
    const junta = pendiente ? `${pendiente} ${f}` : f
    if (normalizar(junta).split(' ').length < 3) { pendiente = junta; continue }
    out.push(junta); pendiente = ''
  }
  if (pendiente) { if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${pendiente}`; else out.push(pendiente) }
  return out
}

interface GuionCrudo { tanda: number; numero: number; estado: string; lineas: string[] }

export function parsearDocGuiones(texto: string, doc_id: string, id_crm: IdCrm, modificado: Iso, leido: Iso = new Date().toISOString()): DocGuiones {
  const lineas = texto.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n')
  const avisos: string[] = []
  const crudos: GuionCrudo[] = []
  let tanda = 1, numeroEnTanda = 0, vioTanda = false
  let actual: GuionCrudo | null = null
  for (const l of lineas) {
    const t = RE_TANDA.exec(l)
    if (t && !RE_VIDEO.test(l) && l.trim().length <= 40) {
      const n = Number(t[1] ?? t[2])
      if (Number.isInteger(n) && n > 0) { tanda = n; numeroEnTanda = 0; vioTanda = true; actual = null; continue }
    }
    const v = RE_VIDEO.exec(l)
    if (v) {
      numeroEnTanda++
      actual = { tanda, numero: numeroEnTanda, estado: v[1].trim(), lineas: [] }
      crudos.push(actual)
      continue
    }
    if (actual) actual.lineas.push(l)
  }
  if (!vioTanda && crudos.length) avisos.push('el doc no tiene títulos "TANDA N°": todos los guiones quedan en la tanda 1')
  const guiones: GuionDoc[] = []
  const vistas = new Set<string>()
  for (const g of crudos) {
    const secciones = { hook: '', problema: '', solucion: '', cta: '' }
    let sec: keyof typeof secciones | null = null
    let titulo = ''
    for (const l of g.lineas) {
      const s = RE_SECCION.exec(l)
      const k = s ? clave(s[1]) : null
      if (s && k) { sec = k; if (s[2]?.trim()) secciones[k] += `${s[2].trim()}\n`; continue }
      if (!sec) { if (!titulo && l.trim()) titulo = l.trim().slice(0, 140); continue }
      secciones[sec] += `${l}\n`
    }
    for (const k of Object.keys(secciones) as (keyof typeof secciones)[]) secciones[k] = textoHablado(secciones[k]).replace(/\n{2,}/g, '\n').trim()
    const vacio = !secciones.hook && !secciones.problema && !secciones.solucion && !secciones.cta
    if (vacio && estadoDoc(g.estado) === 'no_iniciado') continue      // desplegable de la plantilla sin escribir
    const ref = `T${g.tanda}-V${g.numero}`
    if (vistas.has(ref)) { avisos.push(`${ref} aparece dos veces en el doc`); continue }
    vistas.add(ref)
    const frases = (['hook', 'problema', 'solucion', 'cta'] as const).flatMap(k => partirFrases(secciones[k]))
    if (vacio) avisos.push(`${ref}: no se encontraron las secciones HOOK / PROBLEMA / SOLUCIÓN / CTA`)
    guiones.push({
      ref, tanda: g.tanda, numero: g.numero, estado_doc: estadoDoc(g.estado), titulo: titulo || (secciones.hook.split('\n')[0] ?? '').slice(0, 140),
      secciones, frases, huella: huellaTexto([secciones.hook, secciones.problema, secciones.solucion, secciones.cta].join('\n')),
    })
  }
  return { id_crm: id_crm.toUpperCase(), doc_id, modificado, leido, guiones, avisos }
}

/** El texto completo del guion (lo que se guarda en el video) y el gancho (la primera frase del HOOK). */
export const textoGuion = (g: GuionDoc): string =>
  [['HOOK', g.secciones.hook], ['PROBLEMA', g.secciones.problema], ['SOLUCIÓN', g.secciones.solucion], ['CTA', g.secciones.cta]]
    .filter(([, t]) => t).map(([k, t]) => `${k}\n${t}`).join('\n\n')
export const ganchoGuion = (g: GuionDoc): string => (partirFrases(g.secciones.hook)[0] ?? g.titulo ?? '').slice(0, 500)

/** Parecido entre dos textos por palabras (0 a 1): sirve para reconocer un importado de ClickUp por su gancho. */
export function parecido(a: string, b: string): number {
  const pa = new Set(normalizar(a).split(' ').filter(w => w.length > 2)), pb = new Set(normalizar(b).split(' ').filter(w => w.length > 2))
  if (!pa.size || !pb.size) return 0
  let comunes = 0
  for (const w of pa) if (pb.has(w)) comunes++
  return comunes / Math.min(pa.size, pb.size)
}

// ── Qué hacer con un doc leído (puro) ─────────────────────────────────────────────────────────────────────────────
// Línea de base: la PRIMERA lectura de un doc no crea videos (con unos 45 activos y chips viejos en "Para grabar", el
// primer diario crearía videos fantasma y abriría e01 a todos el mismo día). Solo vincula los guiones a los videos que ya
// existen (los importados de ClickUp: por clave T-V o, los CU-…, por el parecido del gancho).
// Después: crea video el guion que PASA a "Para grabar" (o aparece ya en "Para grabar") desde la lectura anterior, si hoy
// es la fecha de corte o después; si todavía no llegó el corte, queda pospuesto (procesarDoc lo guarda con su estado de antes
// y fuerza otra lectura, así desde el corte se ve pasar y se crea). Freno: más de `maxAltas` altas de un cliente en una pasada → no se crea ninguna y se avisa.
// Un guion que cambió: con el video esperando crudos se actualiza; si ya se grabó, va como aviso para Aylu.

export interface PlanDoc {
  lineaBase: boolean
  altas: { guion: GuionDoc; posible_duplicado: string[] }[]
  vincular: { video_id: number; version: number; clave: string; guion: GuionDoc; motivo: 'importado' | 'sin_guion' | 'cambio_en_espera' }[]
  cambiados: { video_id: number; clave: string; guion: GuionDoc }[]
  frenadas: number
  avisos: string[]
  /** Guiones que pasaron a "Para grabar" ANTES de la fecha de corte: se guardan con su estado de antes (procesarDoc) para que
   *  desde el corte se vean pasar y se creen. */
  pospuestos: string[]
}

export function planDoc(doc: DocGuiones, anterior: DocGuiones | null, videos: readonly Video[], op: { hoy: Ymd; corte: Ymd | null; maxAltas: number }): PlanDoc {
  const lineaBase = anterior === null
  const plan: PlanDoc = { lineaBase, altas: [], vincular: [], cambiados: [], frenadas: 0, avisos: [], pospuestos: [] }
  const usados = new Set<number>()
  const previo = new Map((anterior?.guiones ?? []).map(g => [g.ref, g]))
  const cuSueltos = () => videos.filter(v => v.clave.startsWith('CU-') && !v.guion && !usados.has(v.id))
  const corteOk = op.corte === null || op.hoy >= op.corte
  for (const g of doc.guiones) {
    let v = videos.find(x => !usados.has(x.id) && x.guion?.huella === g.huella) ?? videos.find(x => !usados.has(x.id) && x.clave === g.ref) ?? null
    let motivo: PlanDoc['vincular'][number]['motivo'] = 'sin_guion'
    if (!v) {
      const cu = cuSueltos().map(x => ({ x, p: parecido(ganchoGuion(g), x.gancho) })).filter(c => c.p >= 0.6).sort((a, b) => b.p - a.p)
      if (cu.length && (cu.length === 1 || cu[0].p > cu[1].p)) { v = cu[0].x; motivo = 'importado' }
    }
    if (v) {
      usados.add(v.id)
      if (v.guion?.huella === g.huella) continue
      if (!v.guion) plan.vincular.push({ video_id: v.id, version: v.version, clave: v.clave, guion: g, motivo })
      else if (v.estado === 'esperando_crudos') plan.vincular.push({ video_id: v.id, version: v.version, clave: v.clave, guion: g, motivo: 'cambio_en_espera' })
      else plan.cambiados.push({ video_id: v.id, clave: v.clave, guion: g })
      continue
    }
    if (lineaBase || g.estado_doc !== 'para_grabar') continue
    if (previo.get(g.ref)?.estado_doc === 'para_grabar') continue
    if (!corteOk) { plan.pospuestos.push(g.ref); continue }
    plan.altas.push({ guion: g, posible_duplicado: cuSueltos().map(x => x.clave) })
  }
  if (plan.altas.length > op.maxAltas) {
    plan.frenadas = plan.altas.length
    plan.avisos.push(`${plan.altas.length} guiones pasaron a "Para grabar" de una vez: no se crearon los videos (confirmar con Aylu)`)
    plan.altas = []
  }
  for (const c of plan.cambiados) plan.avisos.push(`el guion ${c.guion.ref} cambió en el doc después de grabarse (${c.clave}): revisar`)
  for (const a of plan.altas) if (a.posible_duplicado.length) plan.avisos.push(`${a.guion.ref}: posible duplicado de ${a.posible_duplicado.join(', ')} (importado de ClickUp)`)
  if (plan.pospuestos.length) plan.avisos.push(`${plan.pospuestos.join(', ')}: ${plan.pospuestos.length === 1 ? 'pasó' : 'pasaron'} a "Para grabar" antes de la fecha de corte (${op.corte}): el video se crea desde ese día`)
  return plan
}
