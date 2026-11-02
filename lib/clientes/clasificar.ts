// ── Reglas de clasificación del CRM de clientes (ya decididas por el usuario) ─────────────
//  1. Las métricas de clientes son SOLO Agencia; Consultora es una línea aparte.
//  2. "No clientes": FINALIZADO/INACTIVO que cobraron menos de UMBRAL_CLIENTE_USD no cuentan.
//  3. Semáforo por vencimiento (semaforo.ts).
//  4. Extensión de servicio = período con Notas "Extensión…" (precio 0): no es renovación paga.
//  5. Hora argentina para "hoy".
// No se inventan reglas nuevas: acá solo se aplican.
import { UMBRAL_CLIENTE_USD } from '../rawSheets'
import type { Cliente, ClienteBase, Periodo } from './tipos'
import type { Ymd } from './fechas'
import { semaforoDeCliente } from './semaforo'
import { diasEntre } from './fechas'
import { clavesTelefono, normTxt } from './texto'
import { clientesSinFin, esSinFin } from './sinFin'

export { UMBRAL_CLIENTE_USD }
export { esExtension, esRenovacionPaga, parsearRenovo } from './renovaciones'

// ── "No clientes" ──
// FINALIZADO/INACTIVO con cobrado menor al umbral. Cobrado = LTV cobrado de la planilla; si se
// pasa `cobradoExterno` (id → total del Registro de Pagos de Finanzas) se usa el MAYOR de los dos:
// producción lo hace así porque la columna "LTV cobrado" quedó vieja en algunos clientes.
// Una fila vieja de alguien que volvió (otra fila ACTIVO/PAUSADO con el mismo nombre o teléfono)
// no es "no cliente". Solo Agencia: Consultora no tiene precios cargados y su cobrado no es comparable.
export interface OpcionesNoCliente {
  umbral?: number; cobradoExterno?: ReadonlyMap<string, number>
  /** IDs sin fecha de fin (servicio por objetivos, lib/clientes/sinFin.ts). Por defecto, los de BOT_CLIENTES_SIN_FIN. */
  sinFin?: readonly string[]
}

export function marcarNoClientes(clientes: ClienteBase[], op: OpcionesNoCliente = {}): Set<ClienteBase> {
  const umbral = op.umbral ?? UMBRAL_CLIENTE_USD
  const vigentes = clientes.filter(c => c.linea === 'agencia' && (c.estado === 'ACTIVO' || c.estado === 'PAUSADO'))
  const nombresVigentes = new Set<string>(), telsVigentes = new Set<string>()
  for (const c of vigentes) {
    const n = normTxt(c.nombre)
    if (n.length >= 5) nombresVigentes.add(n)
    for (const k of clavesTelefono(c.celular)) telsVigentes.add(k)
  }
  const out = new Set<ClienteBase>()
  for (const c of clientes) {
    if (c.linea !== 'agencia') continue
    if (c.estado !== 'FINALIZADO' && c.estado !== 'INACTIVO') continue
    if (nombresVigentes.has(normTxt(c.nombre)) || clavesTelefono(c.celular).some(k => telsVigentes.has(k))) continue
    const cobrado = Math.max(c.ltvCobrado ?? 0, op.cobradoExterno?.get(c.id) ?? 0)
    if (cobrado < umbral) out.add(c)
  }
  return out
}

// ── Campos derivados ──
// Recibe lo leído de la planilla y devuelve los Cliente completos a la fecha `hoy`.
export function derivarClientes(base: ClienteBase[], hoy: Ymd, op: OpcionesNoCliente = {}): Cliente[] {
  const noClientes = marcarNoClientes(base, op)
  const listaSinFin = op.sinFin ?? clientesSinFin()
  return base.map(c => {
    const sinId = !c.id
    // Sin fecha de fin (servicio por objetivos): el fin del CRM se muestra pero no vence: semáforo «Sin fecha», sin días
    const sinFin = esSinFin(c.id, listaSinFin)
    const info = semaforoDeCliente(sinFin ? { estado: c.estado, finPeriodo: null } : c, hoy)
    const faltantes: string[] = []
    if (sinId) faltantes.push('id')
    if (!c.finPeriodo && !sinFin) faltantes.push('fin_periodo')
    if (c.linea === 'agencia' && c.ltvContratado === null && c.ltvCobrado === null) faltantes.push('ltv')
    const esNoCliente = noClientes.has(c)
    const inicial = c.periodos.find(p => p.periodo === 0)
    return {
      ...c,
      sinId,
      faltantes,
      semaforo: info?.color ?? null,
      diasParaVencer: c.finPeriodo && !sinFin ? diasEntre(hoy, c.finPeriodo) : null,
      sinFin,
      esNoCliente,
      cuentaEnMetricas: c.linea === 'agencia' && !sinId && !esNoCliente,
      renovacionesPagas: c.periodos.filter((p: Periodo) => p.esRenovacionPaga).length,
      extensiones: c.periodos.filter((p: Periodo) => p.esExtension).length,
      precioInicial: inicial?.precio ?? null,
    }
  })
}
