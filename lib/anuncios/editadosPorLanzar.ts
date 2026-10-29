// ── «Por lanzar»: solo los clientes que ya tienen videos editados ───────────────────────────────────
// Regla de Tomás (26/10/2026, vía CONSULTOR): el «🚀 Para lanzar» ya no sale en la kickoff sino cuando el cliente tiene
// videos editados (g01, lib/bot/anuncios/videos.ts). El bloque «Por lanzar» del tablero muestra lo mismo: los clientes
// sin fila cuya carpeta «Editados - X» (Drive «Clientes», lib/clientes/drive.ts) ya tiene archivos.
//   · Con 0 editados: no se muestran (quedan contados en `sinEditados`, para la línea de abajo del bloque).
//   · Si no se encuentra su carpeta (nombre distinto en Drive) o Drive no respondió, se muestran igual con la marca: no se
//     esconde a nadie por un dato que no se pudo leer.
// Puro: las carpetas entran ya leídas.
import type { CarpetaCliente } from '@/lib/clientes/drive'

export interface EditadosPorLanzar { cantidad: number; ultimo: string | null; url: string | null; carpeta: string | null }

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const IGNORAR = new Set(['estudio', 'juridico', 'abogado', 'abogada', 'abogados', 'asociados', 'legal', 'dra', 'dr', 'skwd'])
const palabras = (s: string) => normal(s).split(/[^a-zñ0-9]+/).filter(w => w.length >= 3 && !IGNORAR.has(w))

/** La carpeta de este cliente: la que comparte más palabras con su nombre del CRM, y tiene que ser una sola. */
export function carpetaDe(cliente: string, carpetas: CarpetaCliente[]): CarpetaCliente | null {
  const ps = new Set(palabras(cliente))
  let mejor: CarpetaCliente | null = null, puntos = 0, empate = false
  for (const c of carpetas) {
    const n = palabras(c.nombre).filter(w => ps.has(w)).length
    if (n > puntos) { mejor = c; puntos = n; empate = false } else if (n && n === puntos) empate = true
  }
  return puntos && !empate ? mejor : null
}

/**
 * Agrega `editados` a cada cliente por lanzar y deja afuera los que tienen la carpeta de editados vacía. `driveOk` = se
 * pudo leer Drive (si no, no se filtra nada).
 */
export function filtrarConEditados<T extends { cliente: string }>(xs: T[], carpetas: CarpetaCliente[], driveOk: boolean): { porLanzar: (T & { editados: EditadosPorLanzar | null })[]; sinEditados: string[] } {
  if (!driveOk) return { porLanzar: xs.map(x => ({ ...x, editados: null })), sinEditados: [] }
  const porLanzar: (T & { editados: EditadosPorLanzar | null })[] = [], sinEditados: string[] = []
  for (const x of xs) {
    const c = carpetaDe(x.cliente, carpetas)
    if (!c) { porLanzar.push({ ...x, editados: null }); continue }
    const cantidad = c.editados?.cantidad ?? 0
    if (!cantidad) { sinEditados.push(x.cliente); continue }
    porLanzar.push({ ...x, editados: { cantidad, ultimo: c.editados?.ultimo ?? null, url: c.editados?.url ?? null, carpeta: c.nombre } })
  }
  return { porLanzar, sinEditados }
}
