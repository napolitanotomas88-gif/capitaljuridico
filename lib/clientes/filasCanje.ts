import { ymdASerial } from './fechas'
import { REGLAS_REFERIDOS, type ReglasReferidos } from './reglasReferidos'
import type { ReservaCanje } from './reservasCanje'
import type { CanjeLimpio } from './canje'

const sinFormula = (s: string): string => (/^[=+\-@]/.test(s) ? `'${s}` : s)
/** Formato único del libro: no escribe H (fórmula Vence) y mantiene las monedas separadas. */
export function filasCanje(r: ReservaCanje, c: CanjeLimpio, actor: string, reglas: ReglasReferidos = REGLAS_REFERIDOS): { bloqueAG: (string | number)[]; bloqueIK: (string | number)[] } {
  return {
    bloqueAG: [r.id, ymdASerial(c.fecha), r.cliente, 'canje', '', r.meses > 0 ? -r.meses : 0, sinFormula(r.extra)],
    bloqueIK: [sinFormula(c.renovacionAplicada), `Canje contra renovación (reglas ${reglas.version})`, sinFormula(actor)],
  }
}
