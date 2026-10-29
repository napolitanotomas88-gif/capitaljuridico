// POST /api/clientes/altas con un FormData (lib/bot/alta/despacho/acciones.ts). Nunca tira: devuelve el JSON o un error legible.
export type Respuesta = { ok: boolean; mensaje?: string; [k: string]: unknown }

export const nuevoId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32))

export async function enviarAccion(fd: FormData): Promise<Respuesta> {
  try {
    const r = await fetch('/api/clientes/altas', { method: 'POST', body: fd, cache: 'no-store' })
    const j = (await r.json().catch(() => ({}))) as Respuesta
    if (r.status === 401) return { ok: false, mensaje: 'Tu sesión venció. Recargá la página y entrá de nuevo.' }
    if (!r.ok) return { ok: false, mensaje: j.mensaje ?? `No se pudo (${r.status}).` }
    return { ...j, ok: j.ok !== false }
  } catch {
    return { ok: false, mensaje: 'No hay conexión con el servidor. No se mandó nada.' }
  }
}
