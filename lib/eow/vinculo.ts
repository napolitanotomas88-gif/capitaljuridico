// ── EOW ↔ Cartera de clientes: emparejamiento y estado (14/11/2026). Puro: se prueba con node:test ─────────────────────
// Pedido de Tomás: que el EOW muestre el estado de la Cartera (/clientes) de cada cliente. La pausa NO se sincroniza sola:
// pausar/reanudar en la Cartera es una acción de la tarjeta (lib/clientes/acciones) que, en modo real, escribe el CRM de Sheets
// (Estado PAUSADO + nota, y al reanudar una fila de extensión en Renovaciones que corre el fin del servicio). Por eso el EOW
// solo LEE ese estado y ofrece el link «pausar / reanudar en la Cartera» (ver docs/ACCESO-Y-ROLES.md, sección EOW).
// Emparejamiento: el ID puesto a mano en la fila manda; si no, el nombre normalizado igual a UN solo cliente de la Cartera, o
// el cruce estricto de nombres de la cartera (crearCruce: todas las palabras, o nombre + apellido; nunca adivina ante un
// empate). Los dudosos quedan «sin vincular» y se vinculan a mano.
import { claveNombre, crearCruce } from '@/lib/clientes/prioridad'
import type { FilaEow } from './modelo'

export type EstadoCartera = 'activo' | 'pausado' | 'finalizado' | 'otro'
export interface ClienteCartera {
  id: string
  nombre: string
  estado: EstadoCartera
  /** Estado tal como figura en el CRM (ACTIVO, PAUSADO, FINALIZADO…) */
  estadoCrm: string
  /** Pausa abierta registrada en el Despacho (tarjeta del cliente), aunque el CRM siga en ACTIVO (modo sombra) */
  pausaDesde: string | null
}

export type Vinculo =
  | { tipo: 'manual' | 'auto'; cliente: ClienteCartera }
  | { tipo: 'ninguno'; motivo: 'quitado' | 'sin_coincidencia' | 'id_desconocido' }

export const NOMBRE_ESTADO_CARTERA: Record<EstadoCartera, string> = { activo: 'Activo', pausado: 'Pausado', finalizado: 'Finalizado', otro: 'Sin estado' }

/** ACTIVO / PAUSADO / FINALIZADO del CRM + la pausa abierta del Despacho → estado único que se muestra. */
export function estadoDe(estadoCrm: string, pausaDesde: string | null): EstadoCartera {
  const e = estadoCrm.trim().toUpperCase()
  if (e === 'PAUSADO' || (e === 'ACTIVO' && pausaDesde)) return 'pausado'
  if (e === 'ACTIVO') return 'activo'
  if (e === 'FINALIZADO' || e === 'INACTIVO' || e === 'BAJA') return 'finalizado'
  return 'otro'
}

/** Arma la función que vincula una fila del EOW con la Cartera. */
export function crearVinculador(cartera: readonly ClienteCartera[]) {
  const porId = new Map(cartera.map((c) => [c.id.toUpperCase(), c]))
  // Por nombre normalizado: solo si hay UN cliente con ese nombre (preferidos los activos o pausados)
  const porNombre = new Map<string, ClienteCartera[]>()
  for (const c of cartera) porNombre.set(claveNombre(c.nombre), [...(porNombre.get(claveNombre(c.nombre)) ?? []), c])
  const vigentes = cartera.filter((c) => c.estado === 'activo' || c.estado === 'pausado')
  const cruceVigentes = crearCruce(vigentes, (c) => c.nombre)
  const cruceTodos = crearCruce([...cartera], (c) => c.nombre)
  return (f: Pick<FilaEow, 'cliente' | 'idCrm' | 'noVincular'>): Vinculo => {
    if (f.noVincular) return { tipo: 'ninguno', motivo: 'quitado' }
    if (f.idCrm) {
      const c = porId.get(f.idCrm.toUpperCase())
      return c ? { tipo: 'manual', cliente: c } : { tipo: 'ninguno', motivo: 'id_desconocido' }
    }
    const iguales = porNombre.get(claveNombre(f.cliente)) ?? []
    const igualesVigentes = iguales.filter((c) => c.estado === 'activo' || c.estado === 'pausado')
    if (igualesVigentes.length === 1) return { tipo: 'auto', cliente: igualesVigentes[0] }
    if (iguales.length === 1) return { tipo: 'auto', cliente: iguales[0] }
    if (iguales.length > 1) return { tipo: 'ninguno', motivo: 'sin_coincidencia' }
    // Nombres con paréntesis o apodos («Mara (Teres Santoni)»): se prueba también lo de adentro del paréntesis
    const partes = [f.cliente, ...[...f.cliente.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]), f.cliente.replace(/\([^)]*\)/g, ' ')]
    for (const p of partes) {
      const c = cruceVigentes(p) ?? cruceTodos(p)
      if (c) return { tipo: 'auto', cliente: c }
    }
    return { tipo: 'ninguno', motivo: 'sin_coincidencia' }
  }
}

/** ¿El EOW dice algo distinto que la Cartera sobre la pausa? (para avisar «no coincide») */
export const difiereDeCartera = (f: Pick<FilaEow, 'pausado'>, v: Vinculo): boolean =>
  v.tipo !== 'ninguno' && (v.cliente.estado === 'pausado') !== f.pausado && v.cliente.estado !== 'finalizado'

/** Link a la tarjeta del cliente en la Cartera (ahí están «Pausar» y «Reanudar»). */
export const linkCartera = (id: string): string => `/clientes?cliente=${encodeURIComponent(id.toUpperCase())}`
