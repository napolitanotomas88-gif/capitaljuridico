// ── «Campaña lanzada» como hito que no se olvida (puro: sin red ni base; lo prueba scripts/test-clientes-lanzamiento.mjs) ──────
// Pedido de Tomás (13/11/2026). La etapa «Lanzado» salía solo de lo que Meta muestra HOY: gasto en 7 días con anuncios
// activos. Un cliente que lanzó y después pausó volvía a «Por lanzar» si tenía videos aprobados, porque Meta informa los
// lanzamientos de los últimos 10 días y el gasto de las últimas 5 semanas, y nada lo guardaba.
// Ahora, la primera vez que el sistema ve gasto real en la cuenta vinculada de un cliente, se anota el hito «Campaña lanzada»
// en cj_hitos (la misma tabla de lo anotado a mano), firmado con QUIEN_AUTOMATICO para distinguirlo:
//   · Fecha: el primer día con gasto de la ventana de insights (o la creación de los anuncios que Meta ya informa, si es
//     anterior). Si la cuenta ya gastaba el primer día de la ventana, el lanzamiento fue antes y no se sabe cuándo: se guarda
//     sin fecha, con la nota «ya gastaba antes del DD/MM».
//   · Solo se escribe si el cliente no tiene ya ese hito (anotado a mano, automático o borrado: la escritura es INSERT … ON
//     CONFLICT DO NOTHING, así que un hito borrado a mano no vuelve). Lo anotado a mano después lo pisa, como cualquier anotación.
//   · hitos.ts lo lee como un dato de Meta (no como «anotado a mano») y recorrido.ts no devuelve a «Por lanzar» a quien ya lanzó.
// Quién escribe, cuándo y con qué tope: hitosRegistro.ts (anotarLanzamientosDeFondo).
import type { CampanaMeta } from './prioridad'
import type { HitoManual } from './hitos'
import type { Ymd } from './fechas'

/** La firma de los hitos que anota el sistema (columna quien de cj_hitos). */
export const QUIEN_AUTOMATICO = 'Despacho (Meta, automático)'
export const esHitoAutomatico = (m: Pick<HitoManual, 'quien'>): boolean => m.quien === QUIEN_AUTOMATICO

const dm = (f: Ymd) => f.split('-').reverse().slice(0, 2).join('/')

export interface LanzamientoVisto { fecha: Ymd | null; nota: string }
/**
 * Lo que dice Meta del lanzamiento de un cliente, con lo que el tablero ya lee (sin pedidos nuevos). null = no se ve gasto
 * real en sus cuentas (puede tener anuncios creados que todavía no gastaron: eso no es lanzar).
 */
export function lanzamientoVisto(m: Pick<CampanaMeta, 'primerLanzamiento' | 'primerGasto' | 'gastoAntesDe'> | null | undefined): LanzamientoVisto | null {
  if (!m?.primerGasto) return null
  if (m.gastoAntesDe) return { fecha: null, nota: `Ya gastaba en Meta antes del ${dm(m.gastoAntesDe)} (primer día que lee el tablero)` }
  const fecha = [m.primerGasto, m.primerLanzamiento].filter((x): x is Ymd => !!x).sort()[0]
  return { fecha, nota: `Primer gasto que vio el tablero de Anuncios${fecha < m.primerGasto ? ' (anuncios creados antes)' : ''}` }
}

export interface PedidoLanzamiento { id: string; fecha: Ymd | null; nota: string }
/**
 * A quiénes hay que anotarles el hito: con gasto visto en Meta, ID del CRM válido y sin el hito en cj_hitos (`anotados`: los
 * IDs en mayúscula que ya lo tienen, a mano o automático). Sin repetidos y con tope.
 */
export function pedidosLanzamiento(clientes: { id: string; meta: LanzamientoVisto | null }[], anotados: ReadonlySet<string>, tope: number): PedidoLanzamiento[] {
  const out: PedidoLanzamiento[] = [], vistos = new Set<string>()
  for (const c of clientes) {
    const id = c.id.trim().toUpperCase()
    if (!c.meta || !/^[A-Z]\d{1,6}$/.test(id) || anotados.has(id) || vistos.has(id)) continue
    vistos.add(id)
    out.push({ id, fecha: c.meta.fecha, nota: c.meta.nota })
    if (out.length >= tope) break
  }
  return out
}
