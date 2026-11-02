// ── Bot "Capital Jurídico": etapa ÉXITO — lectura del estado para otras pantallas (SOLO lectura, solo servidor) ────────────
// Para la sesión "Hub de Clientes" (dueña de app/(shell)/clientes/(cartera)/*): esta etapa NO toca la cartera. Si la quieren
// mostrar, usan leerEstadoExito() desde el servidor (o GET /api/bot/exito?estado=1 con Bearer CRON_SECRET) y cruzan por
// `idCrm` (el ID del CRM, "A123"), o por `cliente` (nombre) cuando el ID no se conoce. Nunca tira: sin base, vuelve vacío.
//   · estado: 'pedido_abierto' (esperando OK en Verificaciones) · 'testimonio_pedido' (se le mandó el mensaje) ·
//     'testimonio_recibido' (mandó el video) · 'rechazado' · 'vencido' · 'error' · 'simulado' (ensayo).
import { almacenExitoNeon } from './almacenNeon'
import type { AlmacenExito, Pedido } from './almacen'
import { clientesPrueba } from '@/lib/bot/clientesPrueba'
import { configExito, configPruebaExito, faltantesExito, VENTANA_MEDIDOR_MS } from './config'
import { medirContento, type Medicion } from './medidor'

export type EstadoExitoCliente = 'pedido_abierto' | 'testimonio_pedido' | 'testimonio_recibido' | 'rechazado' | 'vencido' | 'error' | 'simulado'
export interface ExitoCliente {
  clave: string; idCrm: string | null; cliente: string; estado: EstadoExitoCliente
  motivo: 'mensaje' | 'encuesta' | 'contento'; desde: string; testimonioEn: string | null
}
export interface EstadoExito {
  modo: string; capacidades: string[]; faltan: string[]
  clientes: ExitoCliente[]
  conteos: Record<string, number>
  /** h01: clientes contentos (racha buena vigente), con los días que llevan y si ya toca pedir el testimonio. */
  medidor?: Medicion[]
  /** Corrida de prueba (BOT_CLIENTES_PRUEBA): qué IDs y qué falta para que salga (nombres de variables). */
  prueba?: { clientes: string[]; faltan: string[]; diasContento: number }
}

export function estadoDePedido(p: Pedido): EstadoExitoCliente {
  if (p.testimonioMensaje) return p.estado === 'aprobado_simulado' ? 'simulado' : 'testimonio_recibido'
  switch (p.estado) {
    case 'abierto': case 'aprobado': return 'pedido_abierto'
    case 'enviado': case 'dudoso': return 'testimonio_pedido'
    case 'aprobado_simulado': return 'simulado'
    case 'rechazado': return 'rechazado'
    case 'vencido': return 'vencido'
    default: return 'error'
  }
}

/** El último pedido de cada cliente, con su estado. PURO sobre la lista de pedidos. */
export function resumirPedidos(pedidos: readonly Pedido[]): { clientes: ExitoCliente[]; conteos: Record<string, number> } {
  const ultimo = new Map<string, Pedido>()
  for (const p of [...pedidos].sort((a, b) => a.creado.localeCompare(b.creado))) ultimo.set(p.clave, p)
  const clientes = [...ultimo.values()].map((p) => ({
    clave: p.clave, idCrm: p.idCrm, cliente: p.cliente, estado: estadoDePedido(p), motivo: p.motivo.tipo,
    desde: p.resuelto ?? p.creado, testimonioEn: p.testimonioEn,
  }))
  const conteos: Record<string, number> = {}
  for (const x of clientes) conteos[x.estado] = (conteos[x.estado] ?? 0) + 1
  return { clientes, conteos }
}

export async function leerEstadoExito(op: { almacen?: AlmacenExito; env?: NodeJS.ProcessEnv } = {}): Promise<EstadoExito> {
  const env = op.env ?? process.env
  const c = configExito(env)
  const ids = [...clientesPrueba(env)]
  const base = {
    modo: c.modo, capacidades: [...c.capacidades], faltan: faltantesExito(env),
    ...(ids.length ? { prueba: { clientes: ids, faltan: faltantesExito(env, true), diasContento: configPruebaExito(env).diasContento } } : {}),
  }
  if (!env.DATABASE_URL?.trim() && !op.almacen) return { ...base, clientes: [], conteos: {} }
  try {
    const al = op.almacen ?? almacenExitoNeon()
    const ahora = Date.now()
    const medidor = medirContento(await al.senalesDesde(new Date(ahora - VENTANA_MEDIDOR_MS).toISOString()), ahora, c.diasContento)
    return { ...base, ...resumirPedidos(await al.listarPedidos(500)), medidor }
  } catch {
    return { ...base, clientes: [], conteos: {} }
  }
}
