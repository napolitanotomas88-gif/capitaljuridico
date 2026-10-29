// Asignación operativa: el catálogo de negocio no concede permisos de acceso.
import { listarAccesos, normalizarEmail } from '@/lib/auth/usuarios'
import { leerCatalogoCsm } from './csmConfig'

interface IdentidadActiva { nombre: string; email: string }
const nombreClave = (v: string): string => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es')

/** La identidad se enlaza sólo si coincide de forma única con el catálogo. Su rol de acceso no define el cargo. */
export function rosterCsmDeAccesos(accesos: readonly IdentidadActiva[]) {
  const catalogo = leerCatalogoCsm()
  return {
    fuente: catalogo.fuente,
    version: catalogo.version,
    personas: catalogo.personas.filter(p => p.activo).map(p => {
      const candidatos = accesos.filter(a => p.nombresIdentidad.some(n => nombreClave(n) === nombreClave(a.nombre)))
      const emails = [...new Set(candidatos.map(a => normalizarEmail(a.email)).filter((e): e is string => !!e))]
      return { nombre: p.nombre, ...(emails.length === 1 ? { email: emails[0] } : {}) }
    }),
  }
}

/** La CSM operativa puede asignarse aunque todavía no tenga una cuenta de Google habilitada. */
export function nombresCsmDeAccesos(accesos: readonly IdentidadActiva[]): string[] {
  return rosterCsmDeAccesos(accesos).personas.map(p => p.nombre)
}
export const nombresCsmVigentes = (): string[] => nombresCsmDeAccesos(listarAccesos())
