// Lectura resiliente: un CRM caído impide reconciliar, pero no borra avisos persistidos (incluidos errores de los bots).
import { leerArchivados } from '../clientes/archivados'
import { reconciliarNotificaciones } from './reconciliar'
import { listarNotificaciones } from './registro'
import type { Seccion } from '../auth/roles'
import type { Notificacion } from './modelo'

type Pedido = { email: string; secciones: readonly Seccion[]; desde?: number; pendientes?: boolean; historial?: boolean }
interface Deps {
  archivados(): Promise<ReadonlySet<string>>
  reconciliar(secciones: readonly Seccion[], estado: ReadonlySet<string>): Promise<void>
  listar(p: Pedido): Promise<Notificacion[]>
}
const reales: Deps = { archivados: leerArchivados, reconciliar: reconciliarNotificaciones, listar: listarNotificaciones }
export async function leerBandejaNotificaciones(p: Pedido, deps: Deps = reales): Promise<{ notificaciones: Notificacion[]; avisoReconciliacion: string | null; estadoClientesVerificado: boolean }> {
  let archivados: ReadonlySet<string> | null = null
  let avisoReconciliacion: string | null = null
  try { archivados = await deps.archivados() }
  catch { avisoReconciliacion = 'No se pudo verificar el CRM actual. Se muestran los avisos guardados; no se generaron ni cerraron avisos automáticamente.' }
  if (archivados) {
    try { await deps.reconciliar(p.secciones, archivados) }
    catch { avisoReconciliacion = 'No se pudo actualizar alguna fuente de pendientes. Se muestran los avisos ya guardados.' }
  }
  const lista = await deps.listar(p)
  const notificaciones = !archivados ? lista : lista.filter(n => {
    if (n.hechaEn || n.paraSeccion === 'finanzas') return true
    const id = n.url?.match(/(?:\/clientes\/|\/guiones\/|[?&]cliente=)([A-Za-z]\d{1,6})(?:[/?&#]|$)/)?.[1]?.toUpperCase()
    return !id || !archivados.has(id)
  })
  return { notificaciones, avisoReconciliacion, estadoClientesVerificado: archivados !== null }
}
