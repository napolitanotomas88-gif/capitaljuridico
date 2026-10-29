// POST /api/clientes/<id>/kickoff desde el navegador (tildes del portfolio y revisión de las ideas). Nunca lanza: devuelve el
// mensaje para mostrar. El 401 llega si la sesión se venció (el proxy responde JSON en las rutas /api).
export interface RespuestaEnvio { ok: boolean; status: number; mensaje: string; codigo?: string; cuando?: string }

export async function enviarKickoff(idCliente: string, cuerpo: Record<string, unknown>): Promise<RespuestaEnvio> {
  try {
    const r = await fetch(`/api/clientes/${encodeURIComponent(idCliente)}/kickoff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store',
    })
    const j = (await r.json().catch(() => null)) as { ok?: unknown; mensaje?: unknown; codigo?: unknown; cuando?: unknown } | null
    const mensaje = typeof j?.mensaje === 'string' ? j.mensaje
      : r.status === 401 ? 'Se cerró la sesión: volvé a entrar y probá de nuevo.' : 'No se pudo guardar. Probá de nuevo en un minuto.'
    return {
      ok: r.ok && j?.ok === true, status: r.status, mensaje,
      codigo: typeof j?.codigo === 'string' ? j.codigo : undefined,
      cuando: typeof j?.cuando === 'string' ? j.cuando : undefined,
    }
  } catch {
    return { ok: false, status: 0, mensaje: 'Sin conexión: no se guardó.' }
  }
}
