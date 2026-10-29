// ── Vigía de "Marca - X" (e05): lo que el cliente sube se lee con Claude y queda como propuesta de paleta ────────────
// Corre al final de la pasada completa (la del diario, una vez por día; también la manual con ?tipo=completa): la paleta
// no apura como un crudo, así que tiene su propio presupuesto (PRESUPUESTO_MS) y no le come el plazo al resto del diario.
// Por cada cliente ACTIVO con la carpeta Marca vinculada:
//   · si la ficha ya tiene colores, no se lee nada (la ficha manda y nunca se pisa);
//   · lista Marca (hasta un nivel de subcarpetas) y toma los archivos que no están cerrados en cj_marca_propuestas, los
//     más nuevos primero, como mucho MAX_POR_CLIENTE por cliente y MAX_POR_PASADA en total (costo acotado);
//   · cada uno: formato que no se lee o muy pesado → fila 'error'; si no, se baja con la cuenta de servicio, se mira el
//     tipo REAL por los primeros bytes y Claude lee la paleta → 'propuesta' (con colores) o 'sin_colores';
//   · una falla pasajera (Claude saturado o cortado, Google 429/5xx o 403 de cuota, red) suma un intento: se relee en la
//     pasada siguiente y al tercero queda 'error';
//   · con al menos una propuesta nueva del cliente, un aviso a Aylu (marca_propuesta) con el link a la ficha.
// Las fallas van en `errores` para el resumen, NUNCA como aviso de error a Tomás (se reintentan solas).
// Sin Claude (modo dry o sin clave) o sin descarga (lector de juguete), no lee ni escribe: solo cuenta lo que haría.
import { ErrorTransitorio } from '@/lib/fathomAnuncios/errores'
import type { AvisoMotor, CarpetaGrabacion, IdCrm } from '@/lib/edicion/tipos'
import type { PropuestaNueva } from '@/lib/edicion/db/marcaPropuestas'
import type { LectorDrive } from './drive'
import { formatoDe, leerMarcaConClaude, maxBytesDe, mimeReal, type LlamarClaudeMarca } from './marcaClaude'

export const MAX_POR_CLIENTE = 2
export const MAX_POR_PASADA = 3
export const PRESUPUESTO_MS = 120_000          // como mucho 2 minutos por pasada
export const MARGEN_FINAL_MS = 60_000          // y nunca más allá del plazo de la corrida menos 1 minuto
export const MIN_PARA_LEER_MS = 45_000         // una lectura (bajar + Claude) no arranca con menos que esto por delante

export interface RepoMarca {
  fichaConColores(id: IdCrm): Promise<boolean>
  yaLeidos(driveIds: readonly string[]): Promise<Set<string>>
  guardar(p: PropuestaNueva): Promise<boolean>
  reintento(p: { id_crm: IdCrm; drive_id: string; nombre: string; nota: string }): Promise<void>
}
export interface DepsMarca {
  esOperativo?(idCrm: string): Promise<boolean>
  drive: LectorDrive
  claude: LlamarClaudeMarca | null
  repo: RepoMarca
  modo: 'dry' | 'real'
}
export interface RaizMarca { id_crm: IdCrm; cliente: string; raiz: CarpetaGrabacion }
export interface ResultadoMarca {
  clientes: number; leidos: number; propuestas: number; por_leer: number
  extra: AvisoMotor[]; errores: string[]; cortado: boolean
}

/** Falla que conviene reintentar otro día: Claude saturado o cortado, Google 429/5xx o 403 (cuota), red o timeout. */
export function pasajero(e: unknown): boolean {
  if (e instanceof ErrorTransitorio) return true
  const status = (e as { status?: unknown })?.status
  if (typeof status === 'number' && (status === 403 || status === 429 || status >= 500)) return true
  const nombre = (e as Error)?.name ?? ''
  if (nombre === 'AbortError' || nombre === 'TimeoutError') return true
  return nombre === 'TypeError' && /fetch|network|socket/i.test((e as Error)?.message ?? '')
}
const motivo = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200)

export async function revisarMarcas(deps: DepsMarca, raices: readonly RaizMarca[], op: { deadline: number }): Promise<ResultadoMarca> {
  const out: ResultadoMarca = { clientes: 0, leidos: 0, propuestas: 0, por_leer: 0, extra: [], errores: [], cortado: false }
  const puedeLeer = deps.modo === 'real' && !!deps.claude && !!deps.drive.descargar
  const corte = Math.min(op.deadline - MARGEN_FINAL_MS, Date.now() + PRESUPUESTO_MS)
  let presupuesto = MAX_POR_PASADA
  for (const x of raices) {
    if (Date.now() > corte - MIN_PARA_LEER_MS) { out.cortado = true; break }
    try {
      if (await deps.repo.fichaConColores(x.id_crm)) continue
      out.clientes++
      const arbol = await deps.drive.listarArbol(x.raiz, 1)
      const archivos = [...arbol.archivos].sort((a, b) => (b.creado ?? '').localeCompare(a.creado ?? ''))
      const ya = await deps.repo.yaLeidos(archivos.map(a => a.drive_id))
      const nuevos = archivos.filter(a => !ya.has(a.drive_id))
      out.por_leer += nuevos.length
      if (!puedeLeer) continue
      let propuestas = 0
      let ultima = ''
      for (const a of nuevos.slice(0, MAX_POR_CLIENTE)) {
        if (presupuesto <= 0 || Date.now() > corte - MIN_PARA_LEER_MS) { out.cortado = true; break }
        const base = { id_crm: x.id_crm, drive_id: a.drive_id, nombre: a.nombre, colores: [], tipografias: [], modelo: '' }
        const formato = formatoDe(a.mime)
        if (!formato) {
          await deps.repo.guardar({ ...base, estado: 'error', nota: `formato que no se lee (${a.mime.slice(0, 60)}): pedir PNG, JPG o PDF` })
          continue
        }
        const max = maxBytesDe(formato)
        if (a.bytes !== null && a.bytes > max) {
          await deps.repo.guardar({ ...base, estado: 'error', nota: `pesa más de ${(max / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB: pedir uno más liviano` })
          continue
        }
        presupuesto--
        try {
          const bytes = await deps.drive.descargar!(a.drive_id, max)
          // El tipo real manda sobre el que dice Drive (un JPG etiquetado PNG da 400 en la API)
          const real = formato === 'svg' ? 'image/svg+xml' : mimeReal(bytes)
          const formatoReal = real ? formatoDe(real) : null
          if (!real || !formatoReal) {
            await deps.repo.guardar({ ...base, estado: 'error', nota: `el archivo no es la imagen o el PDF que dice ser (${a.mime.slice(0, 40)}): pedirlo de nuevo` })
            continue
          }
          if (deps.esOperativo && !await deps.esOperativo(x.id_crm)) continue
          const l = await leerMarcaConClaude(deps.claude!, { formato: formatoReal, mime: real, bytes, nombre: a.nombre, topeMs: corte - Date.now() })
          const estado = l.colores.length ? 'propuesta' : 'sin_colores'
          const nota = [l.que_es !== 'otro' ? l.que_es.replace(/_/g, ' ') : '', l.nota].filter(Boolean).join(' · ')
          const nueva = await deps.repo.guardar({ ...base, estado, colores: l.colores, tipografias: l.tipografias, nota, modelo: l.modelo })
          out.leidos++
          if (nueva && estado === 'propuesta') { propuestas++; ultima = a.nombre }
        } catch (e) {
          out.errores.push(`marca de ${x.cliente} (${a.nombre.slice(0, 60)}): ${motivo(e)}`)
          if (pasajero(e)) await deps.repo.reintento({ id_crm: x.id_crm, drive_id: a.drive_id, nombre: a.nombre, nota: motivo(e) })
          else await deps.repo.guardar({ ...base, estado: 'error', nota: motivo(e) })
        }
      }
      if (propuestas) {
        out.propuestas += propuestas
        out.extra.push({ tipo: 'marca_propuesta', id_crm: x.id_crm, cliente: x.cliente, archivos: propuestas, archivo: ultima.slice(0, 120) })
      }
    } catch (e) { out.errores.push(`marca de ${x.cliente}: ${motivo(e)}`) }
  }
  return out
}
