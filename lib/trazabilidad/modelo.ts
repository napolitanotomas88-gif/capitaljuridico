// ── Trazabilidad: tipos y reglas puras (sin red ni base: se prueban con scripts/test-trazabilidad.mjs) ──────
// Método de la clase de trazabilidad (Paolo, oct. 2026):
//   · Muestra = cierres de front-end que cobraron al menos la 1ª cuota del programa principal (UMBRAL, USD 1.100 =
//     1ª cuota del plan en 3 de 3.300). Lo que cobró menos (señas, parciales) es el GRUPO DE CONTRASTE.
//   · Tres capas por lead: setting (resumen de la botonera + etiquetas de ManyChat), closing (CRM de ventas) y llamada
//     (Fathom). Todo descriptivo: los números los calcula este código, nunca una conclusión de la IA.
//   · Con menos de META_N cierres en la muestra el análisis es DIRECCIONAL, no estadístico.
import type { Arquetipo } from './catalogo'

export const UMBRAL_POR_DEFECTO = 1100
export const META_N = 120

export function umbral(): number {
  const n = Number(process.env.TRAZ_UMBRAL)
  return Number.isFinite(n) && n > 0 ? n : UMBRAL_POR_DEFECTO
}

export type Grupo = 'muestra' | 'contraste'

export interface Cierre {
  clave: string
  pestana: string
  fila: number
  nombre: string
  telefono: string
  email: string
  fecha: string | null          // día de la llamada (YYYY-MM-DD)
  fuente: string
  campania: string
  video: string
  contextoAgenda: string
  setter: string
  situacion: string
  cashDia1: number
  cashTrato: number
  cobrado: number               // lo cobrado del trato: el mayor entre día 1 y trato cerrado
  valor: number
  concepto: string              // PIF completo · 1ª cuota o más · seña / parcial
  grupo: Grupo
  grabaciones: string[]         // links de Fathom de la planilla
}

export type TipoPieza = 'reel' | 'carrusel' | 'historia' | 'anuncio' | 'otro'
export type Origen = 'inbound_contenido' | 'outbound_historias' | 'nuevo_seguidor' | 'anuncio' | 'otro'
export const ETIQUETA_ORIGEN: Record<Origen, string> = {
  inbound_contenido: 'Inbound por contenido',
  outbound_historias: 'Outbound a historias',
  nuevo_seguidor: 'Nuevo seguidor / FM ads',
  anuncio: 'Anuncio',
  otro: 'Otro',
}

export interface PiezaConsumida { etiqueta: string; tipo: TipoPieza; angulo: string | null; fecha: string | null }

export interface AnalisisSetting {
  situacion: string | null
  dolor: string | null
  objetivo: string | null
  origen: Origen
  piezas: PiezaConsumida[]
  pieza_gatillo: string | null      // etiqueta de la última pieza orgánica antes de agendar
  primera_interaccion: string | null
  fecha_agenda: string | null
  ciclo_dias: number | null
  seguimientos: number | null
  material_enviado: string[]
  caso_exito_enviado: string | null
}

export interface DolorLlamada { tema: string; angulo: string | null; cita: string }
export interface AnalisisLlamada {
  meta: string | null
  situacion_actual: string | null
  oferta_propuesta: string | null
  motivo_decision: string | null
  habilidad_closer: string | null
  como_nos_conocio: string | null
  contenido_mencionado: string[]
  dolores: DolorLlamada[]
  objeciones: string[]
  arquetipo: Arquetipo
}

export interface FilaSetting {
  subscriberId: string
  nombre: string
  igUsuario: string
  telefono: string
  email: string
  etiquetas: string[]
  resumen: string
  analisis: AnalisisSetting | null
  error: string | null
  enviadoPor: string
  creado: string
  actualizado: string
}

export interface FilaLlamada {
  clave: string
  url: string
  resumen: string
  analisis: AnalisisLlamada | null
  error: string | null
  actualizado: string
}

export interface LeadTraz { cierre: Cierre; setting: FilaSetting | null; vinculoManual: boolean; llamada: FilaLlamada | null }

// ── Normalización ─────────────────────────────────────────────────────────────────────────
export const normNombre = (s: string) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
export const normTelefono = (s: string) => String(s ?? '').replace(/\D/g, '').slice(-8)
export const normEmail = (s: string) => String(s ?? '').trim().toLowerCase()

export const numero = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const t = String(v ?? '').replace(/[^\d,.-]/g, '')
  if (!t) return 0
  // "1.100" o "1.100,50" (formato AR) vs "1100.5"
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : /\.\d{3}($|\.)/.test(t) ? Number(t.replace(/\./g, '')) : Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Celda de fecha de Sheets (serial UNFORMATTED o texto dd/mm/aaaa) → YYYY-MM-DD */
export function fechaDeCelda(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10)
  const t = String(v ?? '').trim()
  let m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function claveCierre(pestana: string, nombre: string, fecha: string | null): string {
  return `${pestana}|${normNombre(nombre)}|${fecha ?? 's-f'}`
}

export function concepto(cobrado: number, valor: number, umbralUSD: number): string {
  if (valor > 0 && cobrado >= valor - 1) return 'PIF completo'
  if (cobrado >= umbralUSD) return '1ª cuota o más'
  return 'Seña / parcial'
}

/** Fila del CRM de ventas (A:AH) → cierre, o null si no está cerrada */
export function cierreDeFila(pestana: string, fila: number, r: unknown[], umbralUSD: number): Cierre | null {
  const situacion = String(r[21] ?? '').trim()
  const cashDia1 = numero(r[24]), cashTrato = numero(r[25]), valor = numero(r[26])
  // Misma regla que el dashboard y el motor de contenido: "Cerrado…" o plata en Trato Cerrado (hay ventas con la
  // Situación vacía y USD 2.600 cobrados). Un "Fee" sin trato cerrado no es venta.
  if (!situacion.toLowerCase().startsWith('cerrado') && !(cashTrato > 0)) return null
  const nombre = String(r[0] ?? '').trim()
  if (!nombre) return null
  const fecha = fechaDeCelda(r[3])
  const cobrado = Math.max(cashDia1, cashTrato)
  const grabaciones = [r[29], r[30], r[31], r[32]].map((x) => String(x ?? '').trim()).filter((x) => /fathom\.video\//i.test(x))
  return {
    clave: claveCierre(pestana, nombre, fecha), pestana, fila, nombre,
    telefono: String(r[1] ?? '').trim(), email: String(r[2] ?? '').trim(), fecha,
    fuente: String(r[6] ?? '').trim(), campania: String(r[7] ?? '').trim(), video: String(r[8] ?? '').trim(),
    contextoAgenda: String(r[9] ?? '').trim(), setter: String(r[10] ?? '').trim(), situacion,
    cashDia1, cashTrato, cobrado, valor, concepto: concepto(cobrado, valor, umbralUSD),
    grupo: cobrado >= umbralUSD ? 'muestra' : 'contraste', grabaciones,
  }
}

/** Agenda del CRM en versión liviana: lo justo para medir anuncios y formatos (todas las filas, cerradas o no) */
export interface AgendaLigera { fecha: string; video: string; fuente: string; presento: boolean; closed: boolean; cobrado: number; grupo: Grupo | 'no_cierre' }
export function agendaDeFila(r: unknown[], cierre: Cierre | null): AgendaLigera | null {
  if (!String(r[0] ?? '').trim()) return null
  const fecha = fechaDeCelda(r[3])
  if (!fecha) return null
  return {
    fecha, video: String(r[8] ?? '').trim(), fuente: String(r[6] ?? '').trim(),
    presento: [r[17], r[19], r[20]].some((x) => String(x ?? '').trim().toLowerCase().startsWith('s')),
    closed: !!cierre, cobrado: cierre?.cobrado ?? 0, grupo: cierre?.grupo ?? 'no_cierre',
  }
}

/** Nombre de anuncio o valor de la columna Video normalizado para cruzarlos (el CRM lo guarda como utm, con "+" y %xx) */
export function claveAnuncio(s: string): string {
  let t = String(s ?? '')
  try { t = decodeURIComponent(t.replace(/\+/g, ' ')) } catch { t = t.replace(/\+/g, ' ') }
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// ── Emparejar el setting (botonera) con el cierre ─────────────────────────────────────────
/** Puntaje de parecido entre un cierre y un envío de la botonera: teléfono o mail = seguro; nombre = por palabras. */
export function puntajeVinculo(c: Pick<Cierre, 'nombre' | 'telefono' | 'email'>, s: Pick<FilaSetting, 'nombre' | 'igUsuario' | 'telefono' | 'email'>): number {
  const tc = normTelefono(c.telefono), ts = normTelefono(s.telefono)
  if (tc.length >= 8 && tc === ts) return 1
  if (normEmail(c.email) && normEmail(c.email) === normEmail(s.email)) return 1
  const a = new Set(normNombre(c.nombre).split(' ').filter((p) => p.length > 2))
  const b = new Set([...normNombre(s.nombre).split(' '), ...normNombre(s.igUsuario).split(' ')].filter((p) => p.length > 2))
  if (!a.size || !b.size) return 0
  const comunes = [...a].filter((p) => b.has(p)).length
  return comunes / Math.min(a.size, b.size) >= 1 && comunes >= Math.min(2, a.size) ? 0.9 : comunes >= 2 ? 0.7 : 0
}

/** El envío que mejor coincide (≥ 0,9), o null si hay dudas: empate o ninguno seguro */
export function mejorVinculo(c: Cierre, envios: FilaSetting[]): FilaSetting | null {
  const puntuados = envios.map((s) => ({ s, p: puntajeVinculo(c, s) })).filter((x) => x.p >= 0.9).sort((x, y) => y.p - x.p)
  if (!puntuados.length) return null
  if (puntuados.length > 1 && puntuados[1].p === puntuados[0].p && puntuados[1].s.subscriberId !== puntuados[0].s.subscriberId) return null
  return puntuados[0].s
}

// ── Buscar el cierre en ManyChat (puro; la red está en manychat.ts) ─────────────────────────
/** Variantes de teléfono para buscar en ManyChat (que lo guarda con +código de país) */
export function variantesTelefono(crudo: string): string[] {
  const d = String(crudo ?? '').split('/')[0].replace(/\D/g, '')
  if (d.length < 8) return []
  const v = new Set<string>([`+${d}`])
  if (d.startsWith('549')) v.add(`+54${d.slice(3)}`)
  else if (d.startsWith('54')) v.add(`+549${d.slice(2)}`)
  if (d.length === 10) v.add(`+549${d}`)
  return [...v]
}

/** ¿El suscriptor es esta persona? Todas las palabras del nombre del CRM (de 3+ letras) tienen que estar en su nombre o usuario */
export function nombreCoincide(nombreCRM: string, s: { name?: string; first_name?: string; last_name?: string; ig_username?: string }): boolean {
  const a = normNombre(nombreCRM).split(' ').filter((p) => p.length > 2)
  if (a.length < 2) return false
  const b = new Set(normNombre([s.name, s.first_name, s.last_name, (s.ig_username ?? '').replace(/[._]/g, ' ')].join(' ')).split(' '))
  return a.every((p) => b.has(p))
}

// ── Ciclo de agenda ───────────────────────────────────────────────────────────────────────
export const TRAMOS_CICLO = [
  { id: '0', etiqueta: 'Mismo día', hasta: 0 },
  { id: '1-5', etiqueta: '1 a 5 días', hasta: 5 },
  { id: '6-16', etiqueta: '6 a 16 días', hasta: 16 },
  { id: '17-60', etiqueta: '17 días a 2 meses', hasta: 60 },
  { id: '61-150', etiqueta: '2 a 5 meses', hasta: 150 },
  { id: '151-365', etiqueta: '5 meses a 1 año', hasta: 365 },
  { id: '366+', etiqueta: 'Más de 1 año', hasta: Infinity },
] as const
export function tramoCiclo(dias: number | null): (typeof TRAMOS_CICLO)[number] | null {
  if (dias == null || !Number.isFinite(dias) || dias < 0) return null
  return TRAMOS_CICLO.find((t) => dias <= t.hasta) ?? null
}

export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)

/** Mes YYYY-MM de un cierre; null si no tiene fecha */
export const mesDe = (c: Pick<Cierre, 'fecha'>) => (c.fecha ? c.fecha.slice(0, 7) : null)
