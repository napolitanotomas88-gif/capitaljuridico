import type { RenovacionReferidosPublica, ResultadoEscritura } from './tipos'

export function resumenRenovacion(resultado: ResultadoEscritura | null | undefined): RenovacionReferidosPublica | undefined {
  const r = resultado?.renovacionReferidos
  if (!r) return undefined
  return { mesesContratados: r.mesesContratados, mesesReferidos: r.mesesReferidos, mesesTotales: r.mesesTotales, finContrato: r.finContrato, finServicio: r.finServicio, ...(resultado?.canje ? { canjeId: resultado.canje.id } : {}) }
}
