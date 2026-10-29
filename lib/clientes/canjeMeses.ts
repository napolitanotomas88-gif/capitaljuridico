import type { MovimientoCredito } from './tipos'

/** Marca persistente: canje contra renovación que consume meses y conserva todos los USD. */
export const MARCA_CANJE_SOLO_MESES = 'auto_meses_renovacion_v1'
export const esCanjeSoloMeses = (m: Pick<MovimientoCredito, 'tipo' | 'extra'>): boolean => m.tipo === 'canje' && String(m.extra ?? '').trim() === MARCA_CANJE_SOLO_MESES
