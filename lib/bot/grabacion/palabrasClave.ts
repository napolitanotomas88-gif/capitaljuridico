// ── Palabras clave para la transcripción (P5: de la ficha del kickoff, nunca el guion) ───────────────────────────────
// Junta lo de la ficha del kickoff del cliente (zona, lugares, cómo se presenta el estudio, subramas, el nombre del cliente)
// con una base fija de términos legales que el transcriptor suele errar. Máximo MAX_PALABRAS_CLAVE términos de hasta 6
// palabras. La ficha se lee con listarFichasCliente (lectura: no crea nada); sin ficha, solo la base.
import { MAX_PALABRAS_CLAVE } from '@/lib/edicion/config'

export const BASE_PALABRAS = ['ART', 'ANSES', 'indemnización', 'despido', 'telegrama', 'carta documento', 'liquidación final', 'monotributo',
  'aguinaldo', 'preaviso', 'en negro', 'en blanco', 'recibo de sueldo', 'antigüedad', 'abogado', 'abogada', 'estudio jurídico',
  'accidente de trabajo', 'despido indirecto', 'horas extra', 'jubilación', 'sucesión', 'divorcio', 'cuota alimentaria'] as const

/** Lo que interesa de una ficha de kickoff (forma de FichaKickoff de lib/bot/kickoff/tipos.ts, tolerando fichas viejas). */
interface FichaParcial {
  cliente?: { cliente_crm?: string | null; nombre_escuchado?: string; apodo?: string | null }
  zona?: { descripcion?: string; lugares?: string[]; presentarse_como?: { texto?: string } | null }
  rama?: { texto?: string; subramas?: { texto?: string }[] }
}

const corto = (s: string): string | null => {
  const t = s.replace(/[«»"“”()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  if (t.length < 3) return null
  const ws = t.split(' ')
  return ws.length <= 6 ? t : null
}

/** Puro: términos de una ficha (o de ninguna) + la base, sin repetir, hasta el máximo. */
export function terminosDeFicha(ficha: unknown): string[] {
  const f = (ficha ?? {}) as FichaParcial
  const xs: string[] = []
  const nombre = f.cliente?.cliente_crm ?? ''
  for (const w of nombre.split(/\s+/)) if (w.length >= 4) xs.push(w)
  if (f.cliente?.apodo) xs.push(f.cliente.apodo)
  for (const l of f.zona?.lugares ?? []) xs.push(l)
  if (f.zona?.presentarse_como?.texto) xs.push(f.zona.presentarse_como.texto)
  for (const s of f.rama?.subramas ?? []) if (s.texto) xs.push(s.texto)
  xs.push(...BASE_PALABRAS)
  const vistos = new Set<string>(), out: string[] = []
  for (const x of xs) {
    const c = corto(String(x))
    if (!c) continue
    const k = c.toLowerCase()
    if (vistos.has(k)) continue
    vistos.add(k); out.push(c)
    if (out.length >= MAX_PALABRAS_CLAVE) break
  }
  return out
}

/** Con la ficha más nueva del cliente (inyectable para los tests). */
export async function palabrasClave(id_crm: string, leerFichas: (id: string) => Promise<{ ficha: unknown }[]>): Promise<string[]> {
  try {
    const fichas = await leerFichas(id_crm)
    return terminosDeFicha(fichas[0]?.ficha ?? null)
  } catch {
    return terminosDeFicha(null)
  }
}
