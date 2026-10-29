// ── Ideas de guiones después de un kickoff (Claude) ──────────────────────────────────────────────
// Solo se piden si la llamada fue un kickoff (procesar.ts). Entra: la ficha ya validada (sin citas: no hacen falta para
// idear y achican el pedido), los anuncios ganadores de la misma rama (de OTRAS cuentas: van SIN el nombre del cliente,
// identificados como G1, G2…) y la base de conocimiento de la rama (kb/), si existe. Si no hay ganadores o no hay base,
// se pide igual y queda anotado. Esfuerzo "medium" (KICKOFF_ESFUERZO lo pisa): son 6 ideas cortas, no la extracción.
// A la vuelta: hasta 6 ideas con todos los campos, textos acotados y sin menciones. Queda anotado en ajustes (la idea no se
// descarta: Tomi y Gero M la ven igual): un "G7" que no existe en la lista, un costo por mensaje citado que no es el del
// ganador (±0,01) y una subrama que no es ninguna de las de la ficha.
import { acotar } from '@/lib/fathomAnuncios/tipos'
import { sinMenciones } from '@/lib/fathomAnuncios/mensaje'
import { NOMBRE_RAMA } from '@/lib/anuncios/ramas'
import { llamarClaude, esfuerzoDe, TOPE_CLAUDE_MS } from './claude'
import { PROMPT_IDEAS } from './prompt-ideas'
import type { ExtraccionKickoff, Ganador, IdeaGuion, ResultadoIdeas } from './tipos'

export const CANTIDAD_IDEAS = 6   // Tomás, 25/10: ~6 guiones por tanda

const str = { type: 'string' } as const
export const SCHEMA_IDEAS = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas', 'notas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'gancho', 'angulo', 'subrama', 'por_que'],
        properties: { titulo: str, gancho: str, angulo: str, subrama: str, por_que: str },
      },
    },
    notas: str,
  },
} as const

export interface EntradaIdeas {
  ficha: ExtraccionKickoff
  ganadores: Ganador[]
  kb: string | null
  /** Qué pasó con los ganadores (para que Claude sepa por qué no hay): 'sin datos de Meta', 'pocos datos'… */
  notaGanadores: string
  /** El país del cliente si la ficha no lo trae (deducido de la zona en procesar.ts). */
  paisCliente?: string | null
}

/** La ficha en texto, sin citas ni timestamps: solo lo que hace falta para idear. */
export function fichaParaIdeas(f: ExtraccionKickoff, paisCliente: string | null = f.zona.pais): string {
  const l = (xs: { texto: string }[]) => (xs.length ? xs.map(x => `  - ${x.texto}`).join('\n') : '  (ninguno)')
  const p = f.presupuesto
  const monto = p.usd_dia_min !== null
    ? `USD ${p.usd_dia_min}${p.usd_dia_max !== null && p.usd_dia_max !== p.usd_dia_min ? `–${p.usd_dia_max}` : ''} por día`
    : p.usd_mes !== null ? `USD ${p.usd_mes} por mes` : 'sin monto'
  return [
    `Cliente: ${f.cliente.cliente_crm ?? f.cliente.nombre_escuchado}`,
    `Rama principal: ${f.rama.principal ? NOMBRE_RAMA[f.rama.principal] : 'sin definir'}${f.rama.texto ? ` — ${f.rama.texto}` : ''}`,
    'Subramas:', l(f.rama.subramas),
    'Descartadas:', f.rama.descartadas.length ? f.rama.descartadas.map(d => `  - ${d.texto}${d.motivo ? ` (${d.motivo})` : ''}`).join('\n') : '  (ninguna)',
    'A futuro:', l(f.rama.a_futuro),
    'Avatar, incluye:', l(f.avatar.incluye),
    'Avatar, excluye:', l(f.avatar.excluye),
    `Zona: ${f.zona.descripcion || 'sin definir'}${f.zona.lugares.length ? ` (${f.zona.lugares.join(', ')})` : ''}${f.zona.presentarse_como ? ` · se presenta como «${f.zona.presentarse_como.texto}»${f.zona.presentarse_como.cuando ? ` (${f.zona.presentarse_como.cuando})` : ''}` : ''}`,
    ...(f.zona.contexto?.length ? ['Contexto de la zona:', l(f.zona.contexto)] : []),
    `País del cliente: ${paisCliente ?? 'sin dato'}`,
    `Presupuesto: ${monto}`,
    `Resumen: ${f.resumen_corto}`,
  ].join('\n')
}

/** Los ganadores sin el cliente: id, gancho, subtema, país, CPL, mensajes y el copy recortado. */
export function ganadoresParaIdeas(gs: Ganador[], paisCliente: string | null = null): string {
  if (!gs.length) return ''
  const pais = (g: Ganador) => (g.pais ?? 'sin dato') + (paisCliente && g.pais && g.pais !== paisCliente ? ' (OTRO país que el cliente)' : '')
  return gs.map(g => [
    `${g.id} · «${g.anuncio}» · subtema: ${g.subtema} · país: ${pais(g)} · USD ${g.cplUSD.toFixed(2).replace('.', ',')} por mensaje · ${g.mensajes} mensajes · USD ${Math.round(g.gastoUSD)} gastados`,
    g.copy ? `   Texto del anuncio: ${g.copy.replace(/\s+/g, ' ').slice(0, 400)}` : '',
  ].filter(Boolean).join('\n')).join('\n')
}

export function mensajeIdeas(e: EntradaIdeas): string {
  const pais = e.ficha.zona.pais ?? e.paisCliente ?? null
  const rama = e.ficha.rama.principal ? NOMBRE_RAMA[e.ficha.rama.principal] : null
  return [
    '<ficha>', fichaParaIdeas(e.ficha, pais), '</ficha>',
    '<ganadores>',
    ...(rama && e.ganadores.length ? [`(solo de la rama ${rama}: no se buscaron ganadores de otras ramas)`] : []),
    ganadoresParaIdeas(e.ganadores, pais) || `(no hay: ${e.notaGanadores || 'sin datos'})`,
    '</ganadores>',
    '<base_rama>', e.kb ?? '(no hay base de conocimiento para esta rama todavía)', '</base_rama>',
  ].join('\n')
}

const esObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const limpio = (x: unknown, max: number) => sinMenciones(acotar(x, max) ?? '').replace(/\s+/g, ' ').trim()

const normSub = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function validarIdeas(json: unknown, ganadores: Ganador[], subramas: string[] = []): { ideas: IdeaGuion[]; notas: string; ajustes: string[] } {
  if (!esObj(json)) throw new Error('la salida de Claude (ideas) no es un objeto JSON')
  const ajustes: string[] = []
  const ids = new Set(ganadores.map(g => g.id))
  const cpl = new Map(ganadores.map(g => [g.id, g.cplUSD]))
  const subs = subramas.map(normSub).filter(Boolean)
  const crudas = Array.isArray(json.ideas) ? json.ideas : []
  const ideas: IdeaGuion[] = []
  for (const x of crudas.filter(esObj)) {
    const idea = { titulo: limpio(x.titulo, 120), gancho: limpio(x.gancho, 300), angulo: limpio(x.angulo, 500), subrama: limpio(x.subrama, 200), por_que: limpio(x.por_que, 400) }
    if (!idea.titulo || !idea.gancho) { ajustes.push('idea sin título o sin gancho: descartada'); continue }
    const t = idea.titulo.slice(0, 40)
    const citados = [...idea.por_que.matchAll(/\bG(\d{1,2})\b/g)].map(m => `G${m[1]}`).filter(g => !ids.has(g))
    if (citados.length) ajustes.push(`la idea «${t}» cita ${citados.join(', ')}, que no está en la lista de ganadores`)
    // "G10 (USD 0,87 por mensaje)": el costo citado tiene que ser el del ganador (el primer USD dentro de los 40 caracteres)
    for (const m of idea.por_que.matchAll(/\bG(\d{1,2})\b[^G]{0,40}?USD\s*(\d+(?:[.,]\d+)?)/g)) {
      const real = cpl.get(`G${m[1]}`), dicho = Number(m[2].replace(',', '.'))
      if (real !== undefined && Number.isFinite(dicho) && Math.abs(real - dicho) > 0.011) ajustes.push(`la idea «${t}» dice que G${m[1]} cuesta USD ${m[2]} por mensaje y en la lista es ${real.toFixed(2)}`)
    }
    const sub = normSub(idea.subrama)
    if (subs.length && !(sub && subs.some(s => sub === s || sub.includes(s) || s.includes(sub)))) {
      ajustes.push(`la idea «${t}» apunta a «${idea.subrama.slice(0, 60)}», que no es una subrama de la ficha`)
    }
    ideas.push(idea)
  }
  if (ideas.length > CANTIDAD_IDEAS) { ajustes.push(`vinieron ${ideas.length} ideas: quedan las primeras ${CANTIDAD_IDEAS}`); ideas.length = CANTIDAD_IDEAS }
  if (ideas.length < CANTIDAD_IDEAS) ajustes.push(`vinieron ${ideas.length} ideas (se pidieron ${CANTIDAD_IDEAS})`)
  return { ideas, notas: limpio(json.notas, 500), ajustes }
}

export async function generarIdeas(e: EntradaIdeas, topeMs: number = TOPE_CLAUDE_MS): Promise<ResultadoIdeas> {
  const res = await llamarClaude({ que: 'las ideas', sistema: PROMPT_IDEAS, usuario: mensajeIdeas(e), schema: SCHEMA_IDEAS, esfuerzo: esfuerzoDe('medium'), topeMs })
  const v = validarIdeas(res.json, e.ganadores, e.ficha.rama.subramas.map(x => x.texto))
  return { ...v, modelo: res.modelo, usage: res.usage }
}
