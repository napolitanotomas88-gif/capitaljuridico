// ── EOW: estado de la Cartera de clientes, SOLO lectura (14/11/2026). Solo servidor ─────────────────────────────────────
// Lee el CRM (el snapshot de 10 min de lib/clientes/leer.ts, el mismo de /clientes) y las pausas abiertas registradas desde la
// tarjeta del cliente (cj_cliente_acciones, SELECT). No escribe nada: pausar o reanudar se hace en la Cartera.
import { neon } from '@neondatabase/serverless'
import { estadoDe, type ClienteCartera } from './vinculo'

/** Por cliente, la pausa abierta del Despacho (la última pausa/reanudar vigente es una pausa). Sin tabla: ninguna. */
async function pausasAbiertas(): Promise<Map<string, string>> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return new Map()
  try {
    const q = neon(url, { fetchOptions: { signal: AbortSignal.timeout(6_000) } })
    const filas = (await q`SELECT DISTINCT ON (id_crm) id_crm, tipo, datos->>'desde' AS desde, creada FROM cj_cliente_acciones
      WHERE tipo IN ('pausa', 'reanudar') AND estado NOT IN ('anulada', 'error') ORDER BY id_crm, creada DESC`) as Record<string, unknown>[]
    const m = new Map<string, string>()
    for (const f of filas) {
      if (f.tipo !== 'pausa') continue
      const desde = typeof f.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.desde) ? f.desde : new Date(String(f.creada)).toISOString().slice(0, 10)
      m.set(String(f.id_crm).toUpperCase(), desde)
    }
    return m
  } catch {
    return new Map()
  }
}

/** Clientes de Agencia con ID (los de prueba no). null = no se pudo leer el CRM (el EOW se muestra sin el estado). */
export async function leerCartera(): Promise<ClienteCartera[] | null> {
  try {
    const { leerClientes } = await import('@/lib/clientes/leer')
    const [datos, pausas] = await Promise.all([leerClientes(), pausasAbiertas()])
    const vistos = new Set<string>()
    const salida: ClienteCartera[] = []
    for (const c of datos.clientes) {
      if (c.linea !== 'agencia' || !c.id || /^\s*PRUEBA\b/i.test(c.nombre)) continue
      const id = c.id.toUpperCase()
      if (vistos.has(id)) continue
      vistos.add(id)
      const pausaDesde = pausas.get(id) ?? null
      salida.push({ id, nombre: c.nombre, estadoCrm: c.estado || '', pausaDesde, estado: estadoDe(c.estado || '', pausaDesde) })
    }
    return salida
  } catch (e) {
    console.error(`[eow] cartera: ${String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 140)}`)
    return null
  }
}
