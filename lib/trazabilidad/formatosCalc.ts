// ── Formatos y ángulos de anuncios contra agendas y pagadores (puro: se prueba sin red) ─────────
// Cada agenda del CRM se atribuye a un concepto por la columna Video (nombre del anuncio o id de Meta). Las agendas sin
// anuncio (DM con la setter, bio) quedan aparte: son la mayoría de los que pagan y esta vista no las explica.
import { claveAnuncio, type AgendaLigera } from './modelo'

export interface ConceptoMin { clave: string; formato: string; angulo: string | null; gasto: number }
export interface FilaGrupo {
  grupo: string; conceptos: number; gasto: number; agendas: number; presentadas: number; ventas: number; pagadores: number; cash: number
  cashPorAgenda: number; cashPorDolar: number | null; pisoPagadores: number
}

export const wilson = (k: number, n: number) => {
  if (!n) return 0
  const z = 1.96, p = k / n
  return Math.max(0, (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n))
}

/** Concepto de una agenda por su columna Video: nombre de anuncio normalizado o id numérico de Meta */
export function conceptoDeVideo(video: string, anuncios: Map<string, string>): string | null {
  const v = video.trim()
  if (!v || v.toLowerCase() === 'bio') return null
  return anuncios.get(/^\d{10,}$/.test(v) ? v : claveAnuncio(v)) ?? null
}

export function agruparFormatos(agendas: AgendaLigera[], conceptos: ConceptoMin[], anuncios: Map<string, string>, clave: (c: ConceptoMin) => string | null, conGasto: boolean) {
  const porClave = new Map(conceptos.map((c) => [c.clave, c]))
  const g = new Map<string, FilaGrupo & { claves: Set<string> }>()
  let sinAnuncio = 0, sinClasificar = 0
  const nueva = (grupo: string) => ({ grupo, conceptos: 0, gasto: 0, agendas: 0, presentadas: 0, ventas: 0, pagadores: 0, cash: 0, cashPorAgenda: 0, cashPorDolar: null, pisoPagadores: 0, claves: new Set<string>() })
  for (const a of agendas) {
    const cc = conceptoDeVideo(a.video, anuncios)
    if (!cc) { sinAnuncio++; continue }
    const c = porClave.get(cc)
    const k = c ? clave(c) : null
    if (!c || !k) { sinClasificar++; continue }
    const e = g.get(k) ?? nueva(k)
    e.agendas++; if (a.presento) e.presentadas++
    if (a.closed) { e.ventas++; e.cash += a.cobrado }
    if (a.grupo === 'muestra') e.pagadores++
    e.claves.add(c.clave)
    g.set(k, e)
  }
  // El gasto es de todos los conceptos del grupo (también los que no trajeron agendas en la ventana)
  for (const c of conceptos) {
    const k = clave(c)
    if (!k) continue
    const e = g.get(k) ?? nueva(k)
    if (conGasto) e.gasto += c.gasto
    e.claves.add(c.clave)
    g.set(k, e)
  }
  const filas: FilaGrupo[] = [...g.values()].map(({ claves, ...e }) => ({
    ...e, conceptos: claves.size, cashPorAgenda: e.agendas ? e.cash / e.agendas : 0,
    cashPorDolar: conGasto && e.gasto > 0 ? e.cash / e.gasto : null, pisoPagadores: wilson(e.pagadores, e.agendas),
  })).sort((x, y) => y.cash - x.cash || y.agendas - x.agendas)
  return { filas, sinAnuncio, sinClasificar, total: agendas.length }
}
