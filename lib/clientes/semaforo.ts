// ── Semáforo de clientes por vencimiento (regla ya decidida por el usuario) ───────────────
//   verde    = el período termina en MÁS de 14 días
//   amarillo = vence en 14 días o menos (incluye "vence hoy")  → mandar llamada de proyección
//   rojo     = ya venció sin renovar
//   gris     = sin fecha de fin
// Solo los clientes ACTIVO tienen semáforo (igual que el CRM de producción: PAUSADO, FINALIZADO e
// INACTIVO quedan fuera). Todo en hora argentina: `hoy` viene de hoyArgentina().
import type { ColorSemaforo, EstadoCliente } from './tipos'
import type { Ymd } from './fechas'
import { diasEntre } from './fechas'

export const DIAS_AMARILLO = 14

export interface InfoSemaforo {
  color: ColorSemaforo
  dias: number | null   // fin − hoy: negativo = días de atraso; null = sin fecha
}

export function semaforoVencimiento(finPeriodo: Ymd | null, hoy: Ymd): InfoSemaforo {
  if (!finPeriodo) return { color: 'gris', dias: null }
  const dias = diasEntre(hoy, finPeriodo)
  if (dias < 0) return { color: 'rojo', dias }
  if (dias <= DIAS_AMARILLO) return { color: 'amarillo', dias }
  return { color: 'verde', dias }
}

// null = el semáforo no aplica a este estado
export function semaforoDeCliente(c: { estado: EstadoCliente; finPeriodo: Ymd | null }, hoy: Ymd): InfoSemaforo | null {
  return c.estado === 'ACTIVO' ? semaforoVencimiento(c.finPeriodo, hoy) : null
}

// Palabras para la interfaz (siempre cuadradito + palabra, nunca emoji ni solo color)
export const ETIQUETA_SEMAFORO: Record<ColorSemaforo, string> = {
  verde: 'Al día', amarillo: 'Por vencer', rojo: 'Vencido', gris: 'Sin fecha',
}
