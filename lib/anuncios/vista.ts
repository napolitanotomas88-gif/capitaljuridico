import type { FilaAnuncio } from './tablero'

export type PeriodoCPL = 'd7' | 'ayer'
export type OrdenCPL = 'prioridad' | 'alto' | 'bajo'

// Recibe filas ya convertidas a USD; una moneda sin cotización no es comparable.
export function ordenarCPL<T extends Pick<FilaAnuncio, 'moneda' | 'cpl' | 'cliente'> & { gasto?: Partial<FilaAnuncio['gasto']> }>(filas: T[], periodo: PeriodoCPL, orden: OrdenCPL): T[] {
  if (orden === 'prioridad') return filas
  // Gasto sin mensajes = CPL infinito: es el peor caso y va arriba en "más alto" (y último en "más bajo")
  const valor = (f: T) => {
    if (f.moneda !== 'USD') return null
    const c = f.cpl[periodo]
    if (c != null && Number.isFinite(c)) return c
    return c == null && (f.gasto?.[periodo === 'ayer' ? 'ayer' : 'd7'] ?? 0) > 0 ? Infinity : null
  }
  return [...filas].sort((a, b) => {
    const x = valor(a), y = valor(b)
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1
    if (x === y) return a.cliente.localeCompare(b.cliente, 'es')
    return orden === 'alto' ? (y > x ? 1 : -1) : (x > y ? 1 : -1)
  })
}

// Las dos evaluaciones llegan en una sola carga; el selector no consulta fuentes externas.
export function filasDelPeriodo(filas: FilaAnuncio[], periodo: PeriodoCPL): FilaAnuncio[] {
  if (periodo === 'ayer') return filas
  return filas.map(f => ({ ...f, ...f.estadoSemanal, cpl: { ...f.cpl, nivel: f.estadoSemanal.nivel } }))
    .sort((a, b) => b.prioridad - a.prioridad || b.gasto.d7 - a.gasto.d7 || a.cliente.localeCompare(b.cliente))
}
