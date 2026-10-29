import { leerFinanzasPrivadas } from './configPrivada'

export type CuentaComprobante = 'Tomi' | 'Gero' | 'Relay' | 'Financiera' | 'Otro'
export type PagoComprobante = [fecha: string, cliente: string, montoUsd: number, cuenta: CuentaComprobante | [CuentaComprobante, number][], confianza: 'alta' | 'media' | 'baja']

// Los comprobantes históricos son datos privados, no código. Ausencia de configuración detiene el informe.
export const leerMesesConComprobantes = () => leerFinanzasPrivadas().meses
export const leerComprobantes = () => leerFinanzasPrivadas().comprobantes
