// POST /api/edicion (y /api/edicion/pedido) desde el navegador. Nunca lanza: devuelve el mensaje para mostrar. El 401 llega
// si la sesión se venció (el proxy responde JSON en las rutas /api).
export interface ResultadoItemEnvio { video_id: number; ok: boolean; mensaje: string; codigo?: string; version?: number }
export interface RespuestaEnvio {
  ok: boolean; status: number; mensaje: string; codigo?: string; campo?: string; version?: number; dry?: boolean
  pedido_id?: number; resultados?: ResultadoItemEnvio[]
}
export type RutaEdicion = '/api/edicion' | '/api/edicion/pedido'

export async function enviarEdicion(cuerpo: Record<string, unknown>, ruta: RutaEdicion = '/api/edicion'): Promise<RespuestaEnvio> {
  try {
    const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null
    const mensaje = typeof j?.mensaje === 'string' ? j.mensaje
      : r.status === 401 ? 'Se cerró la sesión: volvé a entrar y probá de nuevo.'
        : r.status === 403 ? 'No tenés permiso para esto.' : 'No se pudo guardar. Probá de nuevo en un minuto.'
    return {
      ok: r.ok && j?.ok === true, status: r.status, mensaje,
      codigo: typeof j?.codigo === 'string' ? j.codigo : undefined,
      campo: typeof j?.campo === 'string' ? j.campo : undefined,
      version: typeof j?.version === 'number' ? j.version : undefined,
      dry: j?.dry === true,
      pedido_id: typeof j?.pedido_id === 'number' ? j.pedido_id : undefined,
      resultados: Array.isArray(j?.resultados) ? (j!.resultados as ResultadoItemEnvio[]) : undefined,
    }
  } catch {
    return { ok: false, status: 0, mensaje: 'Sin conexión: no se guardó.' }
  }
}
