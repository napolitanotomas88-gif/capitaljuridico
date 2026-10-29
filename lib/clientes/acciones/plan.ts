// ── Plan de cada acción: qué celdas del CRM cambia (puro, sin red) ───────────────────────────────────────────────────────
// Se calcula sobre la fila leída del CRM (Cliente, con sus períodos de Renovaciones). Sirve igual para sombra ("esto se
// escribiría") que para cuando se escriba de verdad. Las extensiones siguen el formato que ya usan el Backend y Bajas:
// período n+1, Día 1 = fin actual, Finalización explícita, Precio 0, Notas "Extensión +X … · acción <id>".
import { diasEntre, esYmdValido, sumarDias, sumarMeses, type Ymd } from '../fechas'
import type { Cliente } from '../tipos'
import type { CambioPlan, CuerpoPausa, CuerpoReanudar, CuerpoServicio, PausaVigente } from './tipos'

export const MAX_DIAS_SERVICIO = 365
export const MOTIVO_MAX = 200

export interface PlanAccion { plan: CambioPlan[]; resumen: string; extension?: FilaExtension; estadoNuevo?: 'PAUSADO' | 'ACTIVO'; nota?: string }
/** La fila que se agrega en Renovaciones (en el orden de las columnas: ID, Nombre, Período, Día 1, Finalización, Precio, Notas, Meses). */
export interface FilaExtension { id: string; nombre: string; periodo: number; desde: Ymd; hasta: Ymd; notas: string; meses: number | '' }

const limpiar = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MOTIVO_MAX) : '')
const ddmm = (f: Ymd) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

/** Fin vigente del servicio: el mayor fin de Renovaciones; si no hay, el "Fin período" de Agencia. */
export function finActual(c: Cliente): Ymd | null {
  const fines = c.periodos.map(p => p.fin).filter((f): f is Ymd => !!f).sort()
  return fines.at(-1) ?? c.finPeriodo
}
const periodoSiguiente = (c: Cliente) => Math.max(-1, ...c.periodos.map(p => p.periodo)) + 1

function planExtension(c: Cliente, desde: Ymd, hasta: Ymd, etiqueta: string, motivo: string, accionId: string, meses: number | ''): PlanAccion {
  const periodo = periodoSiguiente(c)
  const notas = `Extensión ${etiqueta}${motivo ? ` — ${motivo}` : ''} · acción ${accionId}`
  const fila = 'Renovaciones · fila nueva'
  return {
    extension: { id: c.id, nombre: c.nombre, periodo, desde, hasta, notas, meses },
    resumen: `Sumar ${etiqueta}: el fin pasa de ${desde} a ${hasta}`,
    plan: [
      { hoja: fila, celda: 'ID / Nombre', antes: '', despues: `${c.id} · ${c.nombre}` },
      { hoja: fila, celda: 'Período', antes: '', despues: String(periodo) },
      { hoja: fila, celda: 'Día 1', antes: '', despues: desde },
      { hoja: fila, celda: 'Finalización', antes: '', despues: hasta },
      { hoja: fila, celda: 'Precio', antes: '', despues: '0' },
      { hoja: fila, celda: 'Notas', antes: '', despues: notas },
      ...(meses ? [{ hoja: fila, celda: 'Meses', antes: '', despues: String(meses) }] : []),
      { hoja: `${etiquetaHoja(c)} · fila ${c.fila}`, celda: 'Fin período (fórmula, se mueve sola)', antes: c.finPeriodo ?? '', despues: hasta },
    ],
  }
}
const etiquetaHoja = (c: Cliente) => (c.linea === 'agencia' ? 'Agencia' : 'Consultora')

/** Sumar servicio. Devuelve el plan o el motivo del rechazo. */
export function planServicio(c: Cliente, b: CuerpoServicio, accionId: string): PlanAccion | string {
  const desde = finActual(c)
  if (!desde) return 'El cliente no tiene fecha de fin en el CRM: cargala antes de sumar servicio.'
  const motivo = limpiar(b.motivo)
  if (b.duracion === '1m') return planExtension(c, desde, sumarMeses(desde, 1), '+1 mes', motivo, accionId, 1)
  if (b.duracion === '2s') return planExtension(c, desde, sumarDias(desde, 14), '+2 semanas', motivo, accionId, '')
  let hasta: Ymd
  if (b.hasta !== undefined) {
    if (!esYmdValido(b.hasta)) return 'La fecha "hasta" tiene que ser una fecha real (AAAA-MM-DD).'
    hasta = b.hasta
  } else if (Number.isInteger(b.dias) && (b.dias as number) > 0) {
    hasta = sumarDias(desde, b.dias as number)
  } else return 'Para personalizado mandá "hasta" (AAAA-MM-DD) o "dias" (entero mayor a 0).'
  const dias = diasEntre(desde, hasta)
  if (dias <= 0) return `La nueva fecha tiene que ser posterior al fin actual (${desde}).`
  if (dias > MAX_DIAS_SERVICIO) return `Como máximo ${MAX_DIAS_SERVICIO} días de una vez.`
  return planExtension(c, desde, hasta, `+${dias} días`, motivo, accionId, '')
}

function planEstado(c: Cliente, nuevo: 'PAUSADO' | 'ACTIVO', nota: string, resumen: string, extra: CambioPlan[] = []): PlanAccion {
  const hoja = `${etiquetaHoja(c)} · fila ${c.fila}`
  return {
    estadoNuevo: nuevo, nota, resumen,
    plan: [
      { hoja, celda: 'Estado', antes: c.estado, despues: nuevo },
      { hoja, celda: 'Notas renovación (se agrega al final)', antes: c.notasRenov ? '…' : '', despues: nota },
      ...extra,
    ],
  }
}

/** Pausar: solo un cliente ACTIVO y sin otra pausa abierta en el Despacho. */
export function planPausa(c: Cliente, b: CuerpoPausa, hoy: Ymd, abierta: PausaVigente | null): PlanAccion | string {
  if (abierta) return `Ya está pausado desde ${abierta.desde}.`
  if (c.estado !== 'ACTIVO') return `Solo se pausa un cliente ACTIVO (está ${c.estado || 'sin estado'}).`
  const desde = b.desde ?? hoy
  if (!esYmdValido(desde)) return 'La fecha "desde" tiene que ser una fecha real (AAAA-MM-DD).'
  if (desde > hoy) return 'La pausa no puede empezar en el futuro.'
  if (diasEntre(desde, hoy) > 60) return 'La pausa no puede empezar hace más de 60 días.'
  const motivo = limpiar(b.motivo)
  return planEstado(c, 'PAUSADO', `[${ddmm(hoy)}] Pausado desde ${ddmm(desde)}${motivo ? ` — ${motivo}` : ''} (Despacho)`, `Pausar desde ${desde}`)
}

/** Reanudar: cierra la pausa abierta y suma como extensión los días que estuvo pausado. */
export function planReanudar(c: Cliente, b: CuerpoReanudar, hoy: Ymd, abierta: PausaVigente | null, accionId: string): PlanAccion | string {
  if (!abierta) return 'No hay una pausa abierta para reanudar.'
  const fecha = b.fecha ?? hoy
  if (!esYmdValido(fecha)) return 'La fecha tiene que ser una fecha real (AAAA-MM-DD).'
  if (fecha > hoy) return 'No se puede reanudar en el futuro.'
  const dias = diasEntre(abierta.desde, fecha)
  if (dias < 0) return `La fecha de reanudación es anterior a la pausa (${abierta.desde}).`
  const motivo = limpiar(b.motivo)
  const nota = `[${ddmm(hoy)}] Reanudado ${ddmm(fecha)} tras ${dias} días de pausa${motivo ? ` — ${motivo}` : ''} (Despacho)`
  const desde = finActual(c)
  if (dias === 0 || !desde) {
    return planEstado(c, 'ACTIVO', nota, dias === 0 ? 'Reanudar (la pausa duró 0 días: no se suma tiempo)' : `Reanudar (sin fecha de fin en el CRM: los ${dias} días hay que sumarlos a mano)`)
  }
  const ext = planExtension(c, desde, sumarDias(desde, dias), `+${dias} días`, 'compensa pausa', accionId, '')
  const estado = planEstado(c, 'ACTIVO', nota, '')
  return { ...ext, estadoNuevo: 'ACTIVO', nota, plan: [...estado.plan, ...ext.plan], resumen: `Reanudar tras ${dias} días: el fin pasa de ${desde} a ${sumarDias(desde, dias)}` }
}
