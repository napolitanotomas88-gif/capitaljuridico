// ── La tarjeta del cliente en la URL de la cartera (velocidad 3, 13/11/2026) ──────────────────────────────
// La cartera abre la tarjeta de un cliente con ?cliente=<ID> (se puede compartir) y la cambia con history.pushState, sin
// pedirle la página al servidor (app/(shell)/clientes/(cartera)/_componentes/LineaTiempo.tsx). Puro: lo usa el navegador.

/** La dirección de la cartera con la tarjeta de `id` abierta (o cerrada con null), conservando los demás parámetros. */
export function urlConCliente(ruta: string, busqueda: string, id: string | null): string {
  const q = new URLSearchParams(busqueda)
  if (id) q.set('cliente', id)
  else q.delete('cliente')
  const s = q.toString()
  return `${ruta}${s ? `?${s}` : ''}`
}

/** El cliente cuya tarjeta va abierta: el ?cliente= de la URL, solo si está en el recorrido (si no, lo avisa el servidor). */
export function clienteDelPanel(pedido: string | null, filas: readonly { id: string }[]): string | null {
  const id = pedido?.trim().toUpperCase() || null
  return id && filas.some(x => x.id === id) ? id : null
}
