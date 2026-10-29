import type { Accion } from './acciones/tipos'
import { sumarDias } from './fechas'

/** Sólo para ?demo=1: muestra cómo se acumulan la pausa y la retoma sin consultar ni escribir la base. */
export function accionesDemoHistorial(hoy: string, fin: string | null): Accion[] {
  const desde = sumarDias(hoy, -14), fecha = sumarDias(hoy, -5)
  const base = { idCrm: 'DEMO', modo: 'prueba' as const, estado: 'aplicada' as const, quien: 'Equipo de ejemplo', anulada: null, error: null }
  return [
    { ...base, id: 'ac_demo_pausa', tipo: 'pausa', datos: { tipo: 'pausa', desde }, plan: [], resumen: 'Pausa de ejemplo', creada: `${desde}T15:00:00Z`, aplicada: `${desde}T15:00:00Z` },
    { ...base, id: 'ac_demo_retoma', tipo: 'reanudar', datos: { tipo: 'reanudar', fecha }, plan: fin ? [
      { hoja: 'Renovaciones · fila nueva', celda: 'Día 1', antes: '', despues: sumarDias(fin, -9) },
      { hoja: 'Renovaciones · fila nueva', celda: 'Finalización', antes: '', despues: fin },
    ] : [], resumen: 'Retoma de ejemplo', creada: `${fecha}T15:00:00Z`, aplicada: `${fecha}T15:00:00Z` },
  ]
}
