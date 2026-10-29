// ── Campaña nueva u optimización: la sugerencia que acompaña el aviso de "aprobado" a Valen (f06) ──────────────────────
// Criterio del doc "Sistema de tareas - C.J": si en la cuenta del cliente ya hay campañas recientes, lo aprobado parece
// una OPTIMIZACIÓN; si no, una CAMPAÑA NUEVA. Es una sugerencia: decide Valen (con Tomás si hace falta).
// Fuente: campanasMeta() de lib/clientes/produccion.ts (el tablero de /anuncios, con su caché; SOLO lectura). Cruza por
// NOMBRE del cliente (claveNombre): si el nombre no coincide, "sin dato de Meta: decidir con Tomás". Una caché propia de
// 10 minutos por proceso evita volver a pedirle el tablero en cada aviso. Nunca lanza.
import { hoyArgentina, diasEntre, type Ymd } from '@/lib/clientes/fechas'
import { claveNombre, type CampanaMeta } from '@/lib/clientes/prioridad'

export const SIN_DATO_META = 'sin dato de Meta: decidir con Tomás'
export const DIAS_LANZAMIENTO_RECIENTE = 30
const CACHE_MS = 10 * 60_000

const fechaCorta = (ymd: Ymd) => { const [, m, d] = ymd.split('-'); return `${Number(d)}/${Number(m)}` }

/** La sugerencia a partir de lo que dice Meta del cliente (pura). */
export function sugerenciaDe(c: CampanaMeta | null | undefined, hoy: Ymd): string {
  if (!c) return SIN_DATO_META
  if (c.activa) return 'parece optimización (hay campañas activas en los últimos 7 días)'
  if (c.ultimoLanzamiento && diasEntre(c.ultimoLanzamiento, hoy) <= DIAS_LANZAMIENTO_RECIENTE) {
    return `parece optimización (hubo un lanzamiento el ${fechaCorta(c.ultimoLanzamiento)}${c.lanzamientoAprox ? ', aproximado' : ''})`
  }
  return 'parece campaña nueva (sin campañas activas en los últimos 7 días)'
}

let cache: { cuando: number; porCliente: Map<string, CampanaMeta> } | null = null

/** Solo para los tests: olvida la caché. */
export function olvidarCacheMeta(): void { cache = null }

/** La sugerencia para un cliente (por su nombre del CRM). `leer` se inyecta en los tests; por defecto, campanasMeta(). */
export async function sugerenciaMeta(cliente: string, op: { leer?: () => Promise<{ porCliente: Map<string, CampanaMeta> }>; ahora?: Date } = {}): Promise<string> {
  const ahora = op.ahora ?? new Date()
  try {
    if (!cache || ahora.getTime() - cache.cuando > CACHE_MS) {
      const leer = op.leer ?? (async () => (await import('@/lib/clientes/produccion')).campanasMeta(6_000))
      const r = await leer()
      if (!r.porCliente.size) return SIN_DATO_META        // Meta tardó o falló: no se guarda en caché
      cache = { cuando: ahora.getTime(), porCliente: r.porCliente }
    }
    return sugerenciaDe(cache.porCliente.get(claveNombre(cliente)), hoyArgentina(ahora))
  } catch {
    return SIN_DATO_META
  }
}
