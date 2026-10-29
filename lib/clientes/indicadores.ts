// ── Cifras de la franja de /clientes (puro) ───────────────────────────────────────────────
// Mismas definiciones que el dashboard de producción (lib/rawSheets.ts), para que "/" y "/clientes" no se contradigan:
//  · Solo Agencia, con ID y sin los "no clientes" (cuentaEnMetricas).
//  · A cobrar = saldo (LTV contratado − LTV cobrado) de los ACTIVO y PAUSADO, contando solo saldos mayores a USD 50.
//  · Tasa de renovación = renovadores ÷ (renovadores + no renovaron): renovó si la columna "Renovó" empieza con R;
//    no renovó si no renovó y su estado ya no es ACTIVO.
import type { Cliente, Referido, Ymd } from './tipos'
import { sumarDias } from './fechas'
import { resumirCartera, type ResumenCartera } from './resumen'
import { UMBRAL_SALDO_USD } from './listado'

export interface Indicadores {
  hoy: Ymd
  corte30: Ymd                  // hoy + 30 días: hasta cuándo cuenta "vencen en 30 días"
  clientes: number              // los que cuentan para las métricas
  activos: number
  pausados: number
  vencen30: number
  aCobrarUSD: number
  conSaldo: number
  renovadores: number
  noRenovaron: number
  tasaRenovacion: number | null // 0 a 100; null si todavía no hubo decisiones
  noClientesExcluidos: number
  consultora: number
  calidad: ResumenCartera['calidadDeDatos']
}

export function indicadoresDeCartera(clientes: Cliente[], referidos: Referido[], hoy: Ymd): Indicadores {
  const r = resumirCartera(clientes, referidos, hoy)
  const metricas = clientes.filter(c => c.cuentaEnMetricas)
  let aCobrar = 0, conSaldo = 0, renovadores = 0, noRenovaron = 0
  for (const c of metricas) {
    if ((c.estado === 'ACTIVO' || c.estado === 'PAUSADO') && c.ltvContratado !== null && c.ltvCobrado !== null) {
      const saldo = c.ltvContratado - c.ltvCobrado
      if (saldo > UMBRAL_SALDO_USD) { aCobrar += saldo; conSaldo++ }
    }
    if (c.renovo.trim().toUpperCase().startsWith('R')) renovadores++
    else if (c.estado && c.estado !== 'ACTIVO') noRenovaron++
  }
  return {
    hoy,
    corte30: sumarDias(hoy, 30),
    clientes: r.metricas.clientes,
    activos: r.metricas.porEstado.ACTIVO,
    pausados: r.metricas.porEstado.PAUSADO,
    vencen30: r.metricas.vencenEn30Dias,
    aCobrarUSD: aCobrar,
    conSaldo,
    renovadores,
    noRenovaron,
    tasaRenovacion: renovadores + noRenovaron > 0 ? (renovadores / (renovadores + noRenovaron)) * 100 : null,
    noClientesExcluidos: r.noClientesExcluidos,
    consultora: r.consultora.total,
    calidad: r.calidadDeDatos,
  }
}
