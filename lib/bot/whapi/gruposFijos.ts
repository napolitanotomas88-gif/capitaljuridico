// ── Grupo «Contenido» fijo por cliente (2/11/2026) ───────────────────────────────────────────────────────────────────────
// Los grupos de las comunidades tienen nombres cortos («Contenido - CrisO») que la búsqueda por TODAS las palabras del nombre
// del CRM nunca encuentra. WHAPI_GRUPOS_CONTENIDO fija el grupo de cada cliente, sin adivinar:
//   WHAPI_GRUPOS_CONTENIDO = {"<ID del CRM o nombre del cliente en el CRM>":"…@g.us", …}
// La clave se compara sin mayúsculas ni acentos. El valor va en Vercel (nunca en el repo: es dato privado de clientes).
// Lo usan d02 (link de guiones), e01 (seguimiento de grabación) y f04 (video final). Sin la variable, todo sigue igual.
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export function mapaGruposContenido(env: Record<string, string | undefined> = process.env): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const j = JSON.parse(env.WHAPI_GRUPOS_CONTENIDO || '{}') as Record<string, unknown>
    for (const [k, v] of Object.entries(j ?? {})) if (typeof v === 'string' && /^\d+@g\.us$/.test(v.trim()) && normal(k)) out.set(normal(k), v.trim())
  } catch { /* JSON roto: como si no estuviera */ }
  return out
}

/** El chat_id fijado para el cliente (por ID del CRM o por nombre exacto), o null. */
export function grupoContenidoFijo(cliente: string | null | undefined, idCrm?: string | null, env: Record<string, string | undefined> = process.env): string | null {
  const m = mapaGruposContenido(env)
  if (!m.size) return null
  return (idCrm && m.get(normal(idCrm))) || (cliente && m.get(normal(cliente))) || null
}
