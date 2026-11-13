// ── Puntaje con ?demo=1 (solo en desarrollo): señales FICTICIAS para revisar el diseño, armadas sobre recorridoDemo.ts ──────
// No lee la base ni Meta. Deja a propósito un cliente sin respuesta (estimado), uno con brecha y uno sin presupuesto cargado.
import type { CampanaMeta } from './prioridad'
import type { FuentesCliente } from './recorrido'
import type { FuentesPuntaje, PuntajeLeido } from './puntajeSenales'
import { sumarDias, type Ymd } from './fechas'

const CPL: Record<string, 'verde' | 'amarillo' | 'rojo'> = { verde: 'verde', amarillo: 'amarillo', rojo: 'rojo' }

export function puntajeDemo(fuentes: Map<string, FuentesCliente>, hoy: Ymd) {
  const ids = [...fuentes.keys()].filter(id => fuentes.get(id)?.meta)
  const historial = new Map<string, PuntajeLeido[]>()
  const campanas = new Map<string, CampanaMeta>()
  ids.forEach((id, i) => {
    const f = fuentes.get(id)!
    const m = f.meta!
    // El de puntaje 8 queda como puntaje del EQUIPO (manual): el cliente no respondió y se ve el «estimado»
    if (f.puntaje) historial.set(id, [{ valor: f.puntaje.valor, dia: f.puntaje.dia ?? hoy, fecha: f.puntaje.dia ?? hoy, fuente: f.puntaje.valor === 8 ? 'manual' : 'typeform' }])
    campanas.set(id, {
      activa: m.activa, ultimoLanzamiento: m.ultimoLanzamiento, lanzamientoAprox: false, semaforo: m.semaforo, aGrabar: null,
      cpl: m.semaforo ? CPL[m.semaforo] ?? null : null,
      gastoRealDiarioUSD: m.activa ? [18, 30, 9, 25][i % 4] : 0, gastoObjetivoDiarioUSD: i % 5 === 3 ? null : 25,
      errorPago: false,
    })
  })
  const winsFechas = ids.flatMap((id, i) => (i % 3 === 0 ? [] : i % 3 === 1 ? [{ idCrm: id, fecha: sumarDias(hoy, -10) }] : [{ idCrm: id, fecha: sumarDias(hoy, -5) }, { idCrm: id, fecha: sumarDias(hoy, -40) }]))
  const colores = ['verde', 'amarillo', 'rojo'] as const
  const demo: FuentesPuntaje = {
    winsFechas,
    eow: { filas: ids.map((id, i) => ({ id: `d${i}`, cliente: id, comentario: '', color: colores[i % 3], pausado: false, idCrm: id, lanzado: null, origen: 'manual' as const })), tarjetas: { pesadilla: [], cancelaciones: [], pausados: [], testimoniosPedidos: [], testimoniosObtenidos: [], servicioTerminado: [], observaciones: [] } },
    planes: null,
  }
  return { fuentes: demo, historialDe: (id: string) => historial.get(id) ?? [], campanaDe: (id: string) => campanas.get(id) ?? null }
}
