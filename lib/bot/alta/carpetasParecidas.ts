// ── Carpetas de Clientes que pueden ser de un cliente aunque no tengan su nombre exacto (puro, sin red) ─────────────────
// Lo usan la revisión diaria (driveCompleto.ts) y el paso Drive del alta (driveCliente.ts). Caso que lo motivó (5/11/2026):
// Aylu había armado «Ruben & Ariel - C.J» y el alta de «Ariel Ojeda Aguilera» creó otra carpeta con su nombre completo; la
// duplicada se sacó de Clientes y Drive la mandó sola a Mi unidad. Regla: antes de crear, ninguna carpeta de Clientes
// puede compartir una palabra del nombre (solo el primer nombre, "Nombre - SKWD", o una dupla "Nombre y Socio - C.J").
import { claveNombre } from '../../clientes/prioridad'

const GENERICAS = new Set(['estudio', 'juridico', 'juridica', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'skwd'])
/** Palabras con peso de un nombre (4 letras o más, sin las genéricas). */
export const palabrasDe = (s: string) => claveNombre(s).split(' ').filter((w) => w.length >= 4 && !GENERICAS.has(w))
const SUFIJO = /\s*-\s*(skwd|c\.?\s*j\.?|capital jur[ií]dico)\s*$/i
export const sinSufijo = (s: string) => s.replace(SUFIJO, '').trim()

/** Carpetas que comparten alguna palabra con el nombre del cliente, de la más parecida a la menos (el apellido pesa 3, una
 *  palabra del medio 2 y el primer nombre 1). Deja afuera la de nombre exacto (esa la resuelve quien llama). */
export function carpetasParecidas<T extends { nombre: string }>(nombre: string, carpetas: readonly T[]): T[] {
  const ps = palabrasDe(nombre)
  const ws = new Set(ps)
  const primero = ps[0]
  const ultimo = ps.at(-1)
  const exacto = claveNombre(sinSufijo(nombre))
  const peso = (x: T) => palabrasDe(sinSufijo(x.nombre)).reduce((n, w) => n + (ws.has(w) ? (w === ultimo ? 3 : w === primero ? 1 : 2) : 0), 0)
  return carpetas
    .filter((x) => claveNombre(sinSufijo(x.nombre)) !== exacto && peso(x) > 0)
    .sort((a, b) => peso(b) - peso(a))
}
