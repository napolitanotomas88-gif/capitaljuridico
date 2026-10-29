// ── Seguimiento: "cómo le va" a cada cliente, puntaje de 1 a 10 (puro: sin red; lo prueban los tests) ──────────────
// Pedido de Tomás (8/10/2026). Cada puntaje es una fila de la pestaña "Seguimiento" del CRM de clientes: fecha, cliente, valor,
// fuente (manual o typeform), nota y quién lo cargó. El Typeform mensual pregunta del 1 al 10 y se usa tal cual (sin convertir).
import { esYmdValido, type Ymd } from '../clientes/fechas'

export const PESTANA_SEGUIMIENTO = 'Seguimiento'
export const ENCABEZADOS_SEGUIMIENTO = ['Fecha', 'ID cliente', 'Puntaje (1-10)', 'Fuente', 'Nota', 'Cargado por', 'Mes'] as const
export const PUNTAJE_MIN = 1
export const PUNTAJE_MAX = 10
export type Fuente = 'manual' | 'typeform'
export type Tendencia = 'sube' | 'baja' | 'igual' | null

export interface Puntaje {
  fecha: string          // 'AAAA-MM-DD HH:mm' (hora argentina) o 'AAAA-MM-DD'
  dia: Ymd
  mes: string            // 'AAAA-MM'
  idCliente: string
  valor: number          // 1..10
  fuente: Fuente
  nota: string
  quien: string
}

const txt = (c: unknown): string => (c === null || c === undefined ? '' : String(c).trim())

function diaDe(c: unknown): Ymd | null {
  if (typeof c === 'number' && c > 20000 && c < 80000) return new Date(Math.round((c - 25569) * 86400000)).toISOString().slice(0, 10)
  const s = txt(c)
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1]
  if (iso && esYmdValido(iso)) return iso
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) { const r = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return esYmdValido(r) ? r : null }
  return null
}

// A mano se puntúa del 1 al 10; el Typeform permite 0 ("Puntaje (0-10)"), así que al LEER se acepta del 0 al 10
export const puntajeValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= PUNTAJE_MIN && v <= PUNTAJE_MAX
export const puntajeLeible = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= PUNTAJE_MAX

export function leerPuntaje(celdas: unknown[]): Puntaje | null {
  const dia = diaDe(celdas[0])
  const idCliente = txt(celdas[1]).toUpperCase()
  const valor = Number(String(celdas[2] ?? '').replace(',', '.'))
  if (!dia || !idCliente || !puntajeLeible(valor)) return null
  return {
    fecha: typeof celdas[0] === 'number' ? dia : txt(celdas[0]), dia, mes: dia.slice(0, 7), idCliente, valor,
    fuente: /typeform/i.test(txt(celdas[3])) ? 'typeform' : 'manual', nota: txt(celdas[4]), quien: txt(celdas[5]),
  }
}

export interface EstadoSeguimiento {
  ultimo: Puntaje | null
  anterior: Puntaje | null     // el último puntaje de un mes ANTERIOR al del último
  tendencia: Tendencia
  respondioTypeformEsteMes: boolean
  historial: Puntaje[]         // del más nuevo al más viejo
}

// Por el día (AAAA-MM-DD); a igual día, por el texto de la fecha (que puede traer la hora). El texto crudo solo no sirve:
// mezcla "2026-10-20 10:00" con "5/9/2026" y un 9 del 20/10 perdía contra un 3 del 5/9 (revisión del Hub, 26/10/2026)
const masNuevoPrimero = (a: Puntaje, b: Puntaje) => (a.dia !== b.dia ? (a.dia < b.dia ? 1 : -1) : a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? 1 : -1)

/** Último puntaje, tendencia frente al mes anterior y si el Typeform de este mes ya respondió, por cliente */
export function estadoPorCliente(puntajes: Puntaje[], hoy: Ymd): Map<string, EstadoSeguimiento> {
  const mesActual = hoy.slice(0, 7)
  const porCliente = new Map<string, Puntaje[]>()
  for (const p of puntajes) porCliente.set(p.idCliente, [...(porCliente.get(p.idCliente) ?? []), p])
  const out = new Map<string, EstadoSeguimiento>()
  for (const [id, lista] of porCliente) {
    const historial = [...lista].sort(masNuevoPrimero)
    const ultimo = historial[0] ?? null
    const anterior = ultimo ? historial.find(p => p.mes < ultimo.mes) ?? null : null
    const tendencia: Tendencia = !ultimo || !anterior ? null : ultimo.valor > anterior.valor ? 'sube' : ultimo.valor < anterior.valor ? 'baja' : 'igual'
    out.set(id, { ultimo, anterior, tendencia, historial, respondioTypeformEsteMes: historial.some(p => p.fuente === 'typeform' && p.mes === mesActual) })
  }
  return out
}

export const ESTADO_VACIO: EstadoSeguimiento = { ultimo: null, anterior: null, tendencia: null, respondioTypeformEsteMes: false, historial: [] }

// ── Validación de un puntaje cargado a mano ──
export type Validacion = { ok: true; idCliente: string; valor: number; nota: string } | { ok: false; error: string }
export function validarPuntaje(e: { idCliente: unknown; valor: unknown; nota?: unknown }): Validacion {
  const idCliente = String(e.idCliente ?? '').trim().toUpperCase()
  if (!/^[AC]\d{3,4}$/.test(idCliente)) return { ok: false, error: 'Cliente inválido.' }
  const valor = Number(e.valor)
  if (!puntajeValido(valor)) return { ok: false, error: `Elegí un puntaje del ${PUNTAJE_MIN} al ${PUNTAJE_MAX}.` }
  const nota = String(e.nota ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return { ok: true, idCliente, valor, nota }
}
