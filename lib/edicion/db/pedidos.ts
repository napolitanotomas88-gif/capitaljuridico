// ── Pedidos del cliente (f05): SQL sobre cj_video_pedidos (la tabla la crea la migración de A) ──────────────────────────
// Lo que escribe este archivo: el pedido NUEVO (estado `propuesto`, con la propuesta de Claude). Las decisiones (confirmar,
// esperar a Tomás, autorizar, descartar) van en UNA sentencia junto con las notas y el video: aplicarPedidoCliente,
// autorizarPedidoCliente y descartarPedidoCliente de db/videos.ts (bloque A).
// `creado_por` guarda el NOMBRE de quien pegó el pedido, nunca el mail. Las lecturas no crean la tabla (leer → vacío).
import type { NotaPropuesta, PedidoCliente, Persona } from '../tipos'
import { asegurarTablas, consulta, idPositivo, leer, type Fila } from './base'
import { aPedido } from './filas'

export interface NuevoPedido {
  video_id: number; ronda: number; texto: string; propuesta: NotaPropuesta[]
  modelo: string | null; version_prompt: string | null; actor: Persona
}

/** Guarda un pedido nuevo como `propuesto`. */
export async function crearPedido(p: NuevoPedido): Promise<PedidoCliente> {
  const video = idPositivo(p.video_id, 'video_id')
  const ronda = Number.isInteger(p.ronda) && p.ronda >= 0 ? p.ronda : 0
  await asegurarTablas()
  return consulta('crear pedido', async q => {
    const [f] = await q`INSERT INTO cj_video_pedidos (video_id, ronda, texto, propuesta, estado, modelo, version_prompt, creado_por)
      VALUES (${video}, ${ronda}, ${p.texto.slice(0, 4_000)}, ${JSON.stringify(p.propuesta ?? [])}::jsonb, 'propuesto', ${p.modelo}, ${p.version_prompt}, ${p.actor.nombre})
      RETURNING *` as Fila[]
    return aPedido(f)
  })
}

export async function leerPedido(id: number): Promise<PedidoCliente | null> {
  const pid = idPositivo(id, 'pedido_id')
  return leer('leer pedido', null, async q => {
    const [f] = await q`SELECT * FROM cj_video_pedidos WHERE id = ${pid}` as Fila[]
    return f ? aPedido(f) : null
  })
}

export async function pedidosDeVideo(video_id: number): Promise<PedidoCliente[]> {
  const v = idPositivo(video_id, 'video_id')
  return leer('pedidos del video', [] as PedidoCliente[], async q => ((await q`SELECT * FROM cj_video_pedidos WHERE video_id = ${v} ORDER BY id DESC LIMIT 50`) as Fila[]).map(aPedido))
}

/** Los pedidos que esperan el OK de Tomás (para la pantalla y el resumen). */
export async function pedidosEsperandoTomas(): Promise<PedidoCliente[]> {
  return leer('pedidos esperando a Tomás', [] as PedidoCliente[], async q => ((await q`SELECT * FROM cj_video_pedidos WHERE estado = 'espera_tomas' ORDER BY creado LIMIT 100`) as Fila[]).map(aPedido))
}
