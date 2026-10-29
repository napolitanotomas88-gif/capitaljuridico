// ── Base de conocimiento de guiones por rama (para el prompt de ideas) ─────────────────────────────
// Una por rama, en .ts (no .md): así entra en el bundle de Next sin loaders y es determinista (no depende de Drive ni le
// manda a Claude docs enteros con otras ramas o con datos de otros clientes). Por ahora solo laboral; para una rama sin
// base, kbDeRama devuelve null y las ideas salen igual (con la ficha y los ganadores), y queda anotado.
// Más adelante (docs/BOT-KICKOFF-CJ.md): refrescar con los guiones de los ganadores nuevos leídos de Drive.
import type { Rama } from '@/lib/anuncios/ramas'
import { KB_LABORAL, VERSION_KB_LABORAL } from './laboral'

const BASES: Partial<Record<Rama, { texto: string; version: string }>> = {
  laboral: { texto: KB_LABORAL, version: VERSION_KB_LABORAL },
}

export function kbDeRama(rama: Rama | null): { texto: string; version: string } | null {
  return rama ? BASES[rama] ?? null : null
}
