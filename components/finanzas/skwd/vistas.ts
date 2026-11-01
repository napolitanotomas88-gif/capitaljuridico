// Pestañas de Finanzas en el Despacho (1/11/2026): "Resumen" es el tablero de siempre (planilla de Google) y el resto son
// las pantallas de Finanzas SKWD (base Supabase), en /finanzas/<vista>. Cuentas y Conciliación siguen ocultas, como en la
// app original (MOSTRAR_CUENTAS_Y_CONCILIACION = false): no se activan sin indicación del responsable.
export const VISTAS_SKWD = [
  ['pagos', 'Pagos'],
  ['gastos', 'Gastos'],
  ['equipo', 'Equipo'],
  ['pagos-equipo', 'Pagos del equipo'],
  ['correcciones', 'Correcciones'],
  ['estado', 'Estado de resultados'],
  ['tablero', 'Tablero'],
  ['personales', 'Gastos personales'],
] as const

export type VistaSkwd = (typeof VISTAS_SKWD)[number][0]
export const esVistaSkwd = (v: string): v is VistaSkwd => VISTAS_SKWD.some(([id]) => id === v)
