import type { EtapaTarjeta, TarjetaEdicion } from './tarjetasTipos'
import { ETAPAS_TARJETAS } from './tarjetasTipos'

export function buscarTarjeta(tarjetas: readonly TarjetaEdicion[], id: string): TarjetaEdicion | null {
  for (const tarjeta of tarjetas) {
    if (tarjeta.id === id) return tarjeta
    const hija = buscarTarjeta(tarjeta.hijos, id)
    if (hija) return hija
  }
  return null
}

/** Actualiza una tarjeta, conservando el estado y la relación de todos sus padres e hijos. */
export function reemplazarTarjeta(tarjetas: readonly TarjetaEdicion[], actual: TarjetaEdicion, conservarHijos = false): TarjetaEdicion[] {
  return tarjetas.map(t => t.id === actual.id ? { ...t, ...actual, hijos: conservarHijos ? t.hijos : actual.hijos ?? t.hijos } : { ...t, hijos: reemplazarTarjeta(t.hijos, actual, conservarHijos) })
}

export const cantidadDescendientes = (t: TarjetaEdicion): number => t.hijos.reduce((n, h) => n + 1 + cantidadDescendientes(h), 0)
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
export const coincideTarjeta = (t: TarjetaEdicion, consulta: string): boolean => norm(`${t.nombre} ${t.id_crm ?? ''}`).includes(norm(consulta.trim())) || t.hijos.some(h => coincideTarjeta(h, consulta))
export const esRegresoTarjeta = (de: EtapaTarjeta, a: EtapaTarjeta): boolean => ETAPAS_TARJETAS.indexOf(a) < ETAPAS_TARJETAS.indexOf(de)
