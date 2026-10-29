import { ClienteArchivadoError, exigirClienteNoArchivado, exigirClienteNoArchivadoPorNombre } from './archivados'

/** Cada llamada comprueba CRM fresco. Un archivo excluye el trabajo; un estado incierto frena la corrida. */
export async function clienteOperativo(idCrm: unknown, nombre: string): Promise<boolean> {
  try {
    if (typeof idCrm === 'string' && /^[A-Za-z]\d{1,6}$/.test(idCrm.trim())) await exigirClienteNoArchivado(idCrm)
    else await exigirClienteNoArchivadoPorNombre(nombre)
    return true
  } catch (e) {
    if (e instanceof ClienteArchivadoError) return false
    throw e
  }
}
