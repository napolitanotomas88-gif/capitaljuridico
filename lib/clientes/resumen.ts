// ── Resumen de la cartera de clientes (agregados puros, sin datos personales) ──────────────
// Respeta las reglas decididas por el usuario: métricas SOLO Agencia, "no clientes" afuera, semáforo
// por vencimiento, extensiones que no son renovación paga y hora argentina.
import type { Cliente, ColorSemaforo, EstadoCliente, Referido, Ymd } from './tipos'

type ConteoEstado = Record<EstadoCliente | 'SIN_ESTADO', number>
const conteoVacio = (): ConteoEstado => ({ ACTIVO: 0, FINALIZADO: 0, INACTIVO: 0, PAUSADO: 0, '': 0, SIN_ESTADO: 0 })
const contar = (cs: Cliente[]): ConteoEstado => {
  const o = conteoVacio()
  for (const c of cs) o[c.estado === '' ? 'SIN_ESTADO' : c.estado]++
  return o
}

export interface ResumenCartera {
  hoy: Ymd
  // Todas las filas del CRM (ambas líneas), con y sin ID
  filas: { total: number; conId: number; sinId: number; agencia: number; consultora: number }
  // Conteo "crudo" de las filas con ID de ambas líneas (así cuenta la bóveda: 127 = 117 + 10)
  crudo: { total: number; porEstado: ConteoEstado; agencia: number; consultora: number }
  // Lo que cuenta para las métricas: Agencia, con ID, sin los "no clientes"
  metricas: {
    clientes: number
    porEstado: ConteoEstado
    semaforo: Record<ColorSemaforo, number>          // solo ACTIVO
    vencenEn30Dias: number                           // ACTIVO con fin entre hoy y hoy + 30
    conLtvCobrado: number                            // con LTV cobrado > 0
    ltvCobradoTotal: number
    renovacionesPagas: number
    extensiones: number
  }
  noClientesExcluidos: number
  consultora: { total: number; porEstado: ConteoEstado }
  calidadDeDatos: { sinId: number; activosSinFin: number; sinLtv: number; sinPeriodos: number }
  referidos: { total: number; porEstado: Record<string, number> }
}

export function resumirCartera(clientes: Cliente[], referidos: Referido[], hoy: Ymd): ResumenCartera {
  const conId = clientes.filter(c => c.id)
  const agencia = clientes.filter(c => c.linea === 'agencia'), consultora = clientes.filter(c => c.linea === 'consultora')
  const metricas = clientes.filter(c => c.cuentaEnMetricas)
  const activos = metricas.filter(c => c.estado === 'ACTIVO')
  const semaforo: Record<ColorSemaforo, number> = { verde: 0, amarillo: 0, rojo: 0, gris: 0 }
  for (const c of activos) if (c.semaforo) semaforo[c.semaforo]++
  const ltv = metricas.map(c => c.ltvCobrado ?? 0).filter(n => n > 0)
  const porEstadoReferido: Record<string, number> = {}
  for (const r of referidos) porEstadoReferido[r.estado || 'sin estado'] = (porEstadoReferido[r.estado || 'sin estado'] ?? 0) + 1
  return {
    hoy,
    filas: { total: clientes.length, conId: conId.length, sinId: clientes.length - conId.length, agencia: agencia.length, consultora: consultora.length },
    crudo: { total: conId.length, porEstado: contar(conId), agencia: conId.filter(c => c.linea === 'agencia').length, consultora: conId.filter(c => c.linea === 'consultora').length },
    metricas: {
      clientes: metricas.length,
      porEstado: contar(metricas),
      semaforo,
      vencenEn30Dias: activos.filter(c => c.diasParaVencer !== null && c.diasParaVencer >= 0 && c.diasParaVencer <= 30).length,
      conLtvCobrado: ltv.length,
      ltvCobradoTotal: ltv.reduce((s, n) => s + n, 0),
      renovacionesPagas: metricas.reduce((s, c) => s + c.renovacionesPagas, 0),
      extensiones: metricas.reduce((s, c) => s + c.extensiones, 0),
    },
    noClientesExcluidos: clientes.filter(c => c.linea === 'agencia' && c.esNoCliente).length,
    consultora: { total: consultora.length, porEstado: contar(consultora) },
    calidadDeDatos: {
      sinId: clientes.filter(c => c.sinId).length,
      activosSinFin: clientes.filter(c => (c.estado === 'ACTIVO' || c.estado === 'PAUSADO') && !c.finPeriodo).length,
      sinLtv: clientes.filter(c => c.linea === 'agencia' && c.ltvContratado === null && c.ltvCobrado === null).length,
      // ACTIVO/PAUSADO de Agencia sin ninguna fila en Renovaciones (ni el período inicial): clientes recién cargados
      sinPeriodos: clientes.filter(c => c.linea === 'agencia' && c.id && (c.estado === 'ACTIVO' || c.estado === 'PAUSADO') && c.periodos.length === 0).length,
    },
    referidos: { total: referidos.length, porEstado: porEstadoReferido },
  }
}
