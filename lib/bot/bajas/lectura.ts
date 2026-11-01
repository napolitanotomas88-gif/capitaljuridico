// ── Bot "Capital Jurídico": etapa BAJA — estado para la cartera y para GET /api/bot/bajas?estado=1 ─────────────────────────
// No toca app/(shell)/clientes/(cartera)/*. Para mostrarlo (sesión "Hub de Clientes"): import { leerEstadoBajas } from
// '@/lib/bot/bajas/lectura'. Se cruza por idCrm ("A123"). Nunca tira: sin base, vuelve vacío.
import type { AlmacenBajas, Baja, Pedido } from './almacen'
import { capacidadesBajasDesconocidas, configBajas, configPruebaBajas, faltantesBajas } from './config'

export type EstadoBajaCliente = 'aviso_pedido' | 'renovacion_enviada' | 'baja_pedida' | 'baja_confirmada' | 'despedida_pedida' | 'cerrada'

export interface EstadoBajas {
  modo: string; capacidades: string[]; desconocidas: number; faltan: string[]
  /** Modo prueba (BOT_CLIENTES_PRUEBA): IDs y capacidades. null = apagado. */
  prueba: { clientes: string[]; capacidades: string[] } | null
  clientes: { idCrm: string; cliente: string; estado: EstadoBajaCliente; desde: string; pasos?: Baja['pasos'] }[]
  pedidosAbiertos: { tipo: Pedido['tipo']; cliente: string; creado: string }[]
}

export async function leerEstadoBajas(op: { env?: NodeJS.ProcessEnv; almacen?: AlmacenBajas } = {}): Promise<EstadoBajas> {
  const env = op.env ?? process.env
  const c = configBajas(env)
  const p = configPruebaBajas(env)
  const base: EstadoBajas = { modo: c.modo, capacidades: [...c.capacidades], desconocidas: capacidadesBajasDesconocidas(env).length, faltan: faltantesBajas(env), prueba: p ? { clientes: p.clientesPrueba ?? [], capacidades: [...p.capacidades] } : null, clientes: [], pedidosAbiertos: [] }
  if (!op.almacen && !env.DATABASE_URL?.trim()) return base
  try {
    const almacen = op.almacen ?? (await import('./almacenNeon')).almacenBajasNeon()
    const [pedidos, bajas] = await Promise.all([almacen.listarPedidos(300), almacen.listarBajas(200)])
    const por = new Map<string, EstadoBajas['clientes'][number]>()
    for (const p of [...pedidos].reverse()) {
      const estado: EstadoBajaCliente | null = p.tipo === 'aviso_fin'
        ? (p.estado === 'abierto' ? 'aviso_pedido' : ['enviado', 'dudoso'].includes(p.estado) ? 'renovacion_enviada' : null)
        : p.tipo === 'confirmar_baja' ? (p.estado === 'abierto' ? 'baja_pedida' : null)
          : p.tipo === 'despedida' && p.estado === 'abierto' ? 'despedida_pedida' : null
      if (estado) por.set(p.idCrm, { idCrm: p.idCrm, cliente: p.cliente, estado, desde: p.creado })
    }
    for (const b of [...bajas].reverse()) {
      const cerrada = b.pasos.grupos?.estado === 'hecho' || b.pasos.despedida?.estado === 'omitido'
      const actual = por.get(b.idCrm)
      if (actual?.estado === 'despedida_pedida' && actual.desde >= b.creado) { actual.pasos = b.pasos; continue }
      por.set(b.idCrm, { idCrm: b.idCrm, cliente: b.cliente, estado: cerrada ? 'cerrada' : 'baja_confirmada', desde: b.confirmada, pasos: b.pasos })
    }
    base.clientes = [...por.values()]
    base.pedidosAbiertos = pedidos.filter((p) => p.estado === 'abierto').map((p) => ({ tipo: p.tipo, cliente: p.cliente, creado: p.creado }))
  } catch { /* sin base: vacío */ }
  return base
}
