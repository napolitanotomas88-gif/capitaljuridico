// ── Portal del cliente: qué se guarda y qué ve el cliente (puro: sin red ni base; lo prueba scripts/test-portal-cliente.mjs) ──
// 2/11/2026. El equipo arma el acompañamiento (objetivo, plan por etapas, seguimiento y próximos pasos) y el cliente lo lee.
// Los guiones y el proceso salen de lo que ya está en el Despacho, filtrado para el cliente: solo tandas aprobadas o enviadas
// y nada interno (intención del guion, cosas a verificar, hallazgos del revisor, quién aprobó, costos, notas del bot).
import type { Hito, ClaveHito } from '../hitos'

export const ESTADOS_ETAPA = ['pendiente', 'en_curso', 'hecha'] as const
export type EstadoEtapa = (typeof ESTADOS_ETAPA)[number]
export const NOMBRE_ESTADO_ETAPA: Record<EstadoEtapa, string> = { pendiente: 'Próximamente', en_curso: 'En curso', hecha: 'Lograda' }

export interface EtapaPlan { titulo: string; detalle: string; estado: EstadoEtapa; fecha: string | null }
export interface NotaSeguimiento { fecha: string | null; titulo: string; texto: string }
export interface ProximoPaso { texto: string; fecha: string | null; hecho: boolean }
export interface DatosPortal {
  /** Cómo se lo saluda en el portal ("Estudio Pérez"). Vacío = el nombre del CRM. */
  nombre: string
  objetivo: { texto: string; metrica: string; fecha: string | null }
  etapas: EtapaPlan[]
  notas: NotaSeguimiento[]
  proximos: ProximoPaso[]
}
export interface PortalGuardado { datos: DatosPortal; version: number; actualizado: string | null }

export const PORTAL_VACIO: DatosPortal = { nombre: '', objetivo: { texto: '', metrica: '', fecha: null }, etapas: [], notas: [], proximos: [] }

// Topes: el portal es para leer de un vistazo (y una fila de Neon no tiene que crecer sin límite)
export const TOPES = { nombre: 80, objetivo: 600, metrica: 120, titulo: 120, detalle: 800, nota: 2000, paso: 300, etapas: 12, notas: 40, proximos: 12 } as const
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const fechaReal = (f: unknown): f is string => typeof f === 'string' && FECHA.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f

const texto = (x: unknown, tope: number, multilinea = false): string | null => {
  if (x === undefined || x === null) return ''
  if (typeof x !== 'string') return null
  const limpio = (multilinea ? x.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n') : x.replace(/\s+/g, ' ')).trim()
  // Sin caracteres de control (salvo el salto de línea en los textos largos)
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(limpio)) return null
  return limpio.length > tope ? null : limpio
}
const fecha = (x: unknown): string | null | undefined => (x === undefined || x === null || x === '' ? null : fechaReal(x) ? x : undefined)

/** Valida lo que manda la pantalla del equipo. Devuelve los datos limpios o el motivo del rechazo (en castellano, para mostrar). */
export function validarDatosPortal(x: unknown): { ok: true; datos: DatosPortal } | { ok: false; error: string } {
  const o = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null
  if (!o) return { ok: false, error: 'Datos inválidos.' }
  const nombre = texto(o.nombre, TOPES.nombre)
  if (nombre === null) return { ok: false, error: `El nombre puede tener hasta ${TOPES.nombre} caracteres.` }
  const obj = o.objetivo && typeof o.objetivo === 'object' ? (o.objetivo as Record<string, unknown>) : {}
  const objetivo = { texto: texto(obj.texto, TOPES.objetivo, true), metrica: texto(obj.metrica, TOPES.metrica), fecha: fecha(obj.fecha) }
  if (objetivo.texto === null) return { ok: false, error: `El objetivo puede tener hasta ${TOPES.objetivo} caracteres.` }
  if (objetivo.metrica === null) return { ok: false, error: `La métrica puede tener hasta ${TOPES.metrica} caracteres.` }
  if (objetivo.fecha === undefined) return { ok: false, error: 'La fecha del objetivo tiene que ser una fecha real.' }

  const lista = (v: unknown, tope: number, que: string): unknown[] | string => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) return `${que}: formato inválido.`
    return v.length > tope ? `${que}: hasta ${tope}.` : v
  }
  const etapasCrudas = lista(o.etapas, TOPES.etapas, 'Etapas')
  if (typeof etapasCrudas === 'string') return { ok: false, error: etapasCrudas }
  const etapas: EtapaPlan[] = []
  for (const [i, e] of etapasCrudas.entries()) {
    const r = e && typeof e === 'object' ? (e as Record<string, unknown>) : {}
    const titulo = texto(r.titulo, TOPES.titulo), detalle = texto(r.detalle, TOPES.detalle, true), f = fecha(r.fecha)
    if (!titulo) return { ok: false, error: `Etapa ${i + 1}: falta el título (hasta ${TOPES.titulo} caracteres).` }
    if (detalle === null) return { ok: false, error: `Etapa ${i + 1}: el detalle puede tener hasta ${TOPES.detalle} caracteres.` }
    if (!(ESTADOS_ETAPA as readonly unknown[]).includes(r.estado)) return { ok: false, error: `Etapa ${i + 1}: estado inválido.` }
    if (f === undefined) return { ok: false, error: `Etapa ${i + 1}: la fecha tiene que ser una fecha real.` }
    etapas.push({ titulo, detalle, estado: r.estado as EstadoEtapa, fecha: f })
  }
  const notasCrudas = lista(o.notas, TOPES.notas, 'Notas')
  if (typeof notasCrudas === 'string') return { ok: false, error: notasCrudas }
  const notas: NotaSeguimiento[] = []
  for (const [i, n] of notasCrudas.entries()) {
    const r = n && typeof n === 'object' ? (n as Record<string, unknown>) : {}
    const titulo = texto(r.titulo, TOPES.titulo), cuerpo = texto(r.texto, TOPES.nota, true), f = fecha(r.fecha)
    if (titulo === null || cuerpo === null) return { ok: false, error: `Nota ${i + 1}: demasiado larga.` }
    if (!titulo && !cuerpo) return { ok: false, error: `Nota ${i + 1}: está vacía.` }
    if (f === undefined) return { ok: false, error: `Nota ${i + 1}: la fecha tiene que ser una fecha real.` }
    notas.push({ fecha: f, titulo, texto: cuerpo })
  }
  const pasosCrudos = lista(o.proximos, TOPES.proximos, 'Próximos pasos')
  if (typeof pasosCrudos === 'string') return { ok: false, error: pasosCrudos }
  const proximos: ProximoPaso[] = []
  for (const [i, p] of pasosCrudos.entries()) {
    const r = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
    const t = texto(r.texto, TOPES.paso), f = fecha(r.fecha)
    if (!t) return { ok: false, error: `Próximo paso ${i + 1}: falta el texto (hasta ${TOPES.paso} caracteres).` }
    if (f === undefined) return { ok: false, error: `Próximo paso ${i + 1}: la fecha tiene que ser una fecha real.` }
    proximos.push({ texto: t, fecha: f, hecho: r.hecho === true })
  }
  return { ok: true, datos: { nombre, objetivo: { texto: objetivo.texto, metrica: objetivo.metrica, fecha: objetivo.fecha }, etapas, notas, proximos } }
}

/** Lo guardado en Neon, leído sin confiar: si algo no valida, vale el portal vacío (nunca rompe la página del cliente). */
export function leerDatosGuardados(x: unknown): DatosPortal {
  const r = validarDatosPortal(x)
  return r.ok ? r.datos : PORTAL_VACIO
}

/** Avance del plan: etapas logradas sobre el total (null sin etapas). */
export function avancePlan(etapas: readonly EtapaPlan[]): { hechas: number; total: number; porcentaje: number } | null {
  if (!etapas.length) return null
  const hechas = etapas.filter(e => e.estado === 'hecha').length
  return { hechas, total: etapas.length, porcentaje: Math.round((hechas / etapas.length) * 100) }
}

// ── Guiones para el cliente ──────────────────────────────────────────────────────────────────────────────────────────────
/** Estados de tanda que el cliente puede ver: el equipo ya la aprobó (o ya se la mandó, o él ya la está corrigiendo). */
export const ESTADOS_TANDA_VISIBLES = ['aprobada', 'enviada', 'con_notas', 'corrigiendo'] as const

export interface SeccionGuionPortal { seccion: string; indicacion: string; texto: string }
export interface GuionPortal { numero: number; titulo: string; secciones: SeccionGuionPortal[]; ganchos: string[] }
export interface TandaPortal { tanda: number; fecha: string | null; guiones: GuionPortal[] }

/** Lo mínimo de una fila de cj_guiones que hace falta (lib/bot/guiones/registro.ts FilaTanda). */
export interface TandaCruda {
  tanda: number; estado: string; creado: string
  aprobacion?: { cuando?: string } | null
  guiones: Record<string, { guion?: { numero?: unknown; titulo?: unknown; secciones?: unknown; ganchos_alternativos?: unknown } | null } | null>
}

const NOMBRE_SECCION: Record<string, string> = { HOOK: 'Gancho', PROBLEMA: 'Problema', SOLUCION: 'Solución', CTA: 'Llamado a la acción' }
const str = (x: unknown, tope = 4000) => (typeof x === 'string' ? x.trim().slice(0, tope) : '')
const dia = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null)

/**
 * Las tandas que ve el cliente: solo las aprobadas o enviadas, y de cada guion solo lo que él graba (título, secciones con su
 * indicación y texto, y los ganchos alternativos). Lo interno (intención, verificar, hallazgos, revisión, quién editó o aprobó,
 * notas, WhatsApp, Doc, tokens) no sale de acá. Una tanda repetida (misma numeración) queda la más nueva.
 */
export function tandasParaCliente(filas: readonly TandaCruda[]): TandaPortal[] {
  const porNumero = new Map<number, TandaPortal & { orden: string }>()
  for (const f of filas) {
    if (!(ESTADOS_TANDA_VISIBLES as readonly string[]).includes(f.estado)) continue
    const guiones: GuionPortal[] = Object.values(f.guiones ?? {})
      .map(g => g?.guion)
      .filter((g): g is NonNullable<typeof g> => !!g && typeof g === 'object')
      .map(g => ({
        numero: Number.isInteger(g.numero) ? (g.numero as number) : 0,
        titulo: str(g.titulo, 200),
        secciones: (Array.isArray(g.secciones) ? g.secciones : [])
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .map(s => ({ seccion: NOMBRE_SECCION[str(s.seccion, 20).toUpperCase()] ?? str(s.seccion, 40), indicacion: str(s.indicacion, 400), texto: str(s.texto) }))
          .filter(s => s.texto),
        ganchos: (Array.isArray(g.ganchos_alternativos) ? g.ganchos_alternativos : []).map(x => str(x, 400)).filter(Boolean).slice(0, 5),
      }))
      .filter(g => g.titulo || g.secciones.length)
      .sort((a, b) => a.numero - b.numero)
    if (!guiones.length) continue
    const previa = porNumero.get(f.tanda)
    if (previa && previa.orden >= f.creado) continue
    porNumero.set(f.tanda, { tanda: f.tanda, fecha: dia(f.aprobacion?.cuando) ?? dia(f.creado), guiones, orden: f.creado })
  }
  return [...porNumero.values()].sort((a, b) => b.tanda - a.tanda).map(t => ({ tanda: t.tanda, fecha: t.fecha, guiones: t.guiones }))
}

// ── Proceso (hitos del registro del cliente, en su idioma) ───────────────────────────────────────────────────────────────
export const NOMBRE_HITO_CLIENTE: Record<ClaveHito, string> = {
  alta: 'Empezamos a trabajar juntos',
  kickoff: 'Reunión de inicio',
  guiones: 'Guiones escritos',
  revision: 'Revisaste los guiones',
  grabacion: 'Grabaste los videos',
  edicion: 'Videos editados',
  lanzamiento: 'Contenido en marcha',
  exito: 'Primer objetivo cumplido',
  renovacion: 'Seguimos juntos',
}
export interface PasoProceso { clave: ClaveHito; titulo: string; hecho: boolean; fecha: string | null; actual: boolean }

/**
 * Los hitos del registro (lib/clientes/hitos.ts) en lenguaje para el cliente: sin fuentes, sin detalles internos, sin quién
 * anotó. Éxito y renovación solo aparecen cuando pasaron (no se le muestran como "pendientes"). `actual` = el primero que falta.
 */
export function procesoParaCliente(hitos: readonly Hito[]): PasoProceso[] {
  const visibles = hitos.filter(h => (h.clave === 'exito' || h.clave === 'renovacion' ? h.hecho : true))
  const primeroQueFalta = visibles.find(h => !h.hecho)?.clave ?? null
  return visibles.map(h => ({ clave: h.clave, titulo: NOMBRE_HITO_CLIENTE[h.clave], hecho: h.hecho, fecha: h.hecho ? h.fecha : null, actual: h.clave === primeroQueFalta }))
}

/** "2026-11-02" → "2 de noviembre de 2026" (null → ''). */
export function fechaLarga(f: string | null): string {
  if (!f || !FECHA.test(f)) return ''
  const [a, m, d] = f.split('-').map(Number)
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${d} de ${MESES[m - 1]} de ${a}`
}
