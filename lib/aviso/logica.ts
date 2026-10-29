// ── Aviso emergente con sonido (marco del Despacho, 27/10/2026) ─────────────────────────────────────────────
// Lógica pura del cartel (components/shell/Aviso.tsx): qué notificaciones son nuevas, cuáles suenan y cuándo hay silencio.
// La fuente es la API del Hub (/api/notificaciones, lib/notificaciones). Sin imports de React ni de la base: se prueba con node.

export const INTERVALO_AVISO_MS = 30_000
export const MAX_CARTELES = 3
/** Silencio nocturno del sonido (hora de Buenos Aires): el cartel igual aparece. */
export const SILENCIO = { desde: 23, hasta: 8 }

export type AvisoNotificacion = { id: number; titulo: string; cuerpo: string; url: string | null; urgente: boolean; hechaEn: string | null; vista: boolean }

/** Las que hay que mostrar: posteriores a la última que ya se conocía, sin hacer y sin ver. */
export function nuevas(lista: readonly AvisoNotificacion[], ultimoConocido: number): AvisoNotificacion[] {
  return lista.filter((n) => n.id > ultimoConocido && !n.hechaEn && !n.vista).sort((a, b) => a.id - b.id)
}

/** El id más alto de la lista (o el anterior si viene vacía). */
export const ultimoId = (lista: readonly { id: number }[], anterior: number): number => lista.reduce((m, n) => Math.max(m, n.id), anterior)

/** Hora de Buenos Aires (0–23). */
export function horaAR(ahora: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hourCycle: 'h23' }).format(ahora)) % 24
}

/** Suena si alguna de las nuevas es urgente y no es de noche. */
export function debeSonar(lista: readonly AvisoNotificacion[], ahora: Date): boolean {
  const h = horaAR(ahora)
  const deNoche = h >= SILENCIO.desde || h < SILENCIO.hasta
  return !deNoche && lista.some((n) => n.urgente)
}

/** Solo rutas internas del Despacho ("/algo"): nunca un dominio externo ni "//otro". */
export const urlSegura = (url: string | null): string | null => (url && /^\/(?!\/)[^\s]*$/.test(url) ? url : null)
