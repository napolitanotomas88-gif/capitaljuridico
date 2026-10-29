// Catálogo privado de negocio: nunca se deduce del permiso auth `csm` ni concede accesos.
// Sin configuración explícita no se habilita ninguna asignación nueva.
export interface OpcionCsm { nombre: string; activo: boolean; nombresIdentidad: string[] }
export function leerCatalogoCsm(env: Record<string, string | undefined> = process.env) {
  let personas: OpcionCsm[] = []
  if (env.HUB_CSM_OPCIONES_JSON?.trim()) {
    const invalida = () => new Error('HUB_CSM_OPCIONES_JSON inválido: configurá el catálogo privado de CSM')
    let x: unknown
    try { x = JSON.parse(env.HUB_CSM_OPCIONES_JSON) } catch { throw invalida() }
    if (!Array.isArray(x) || x.length > 100) throw invalida()
    personas = x.map((p: unknown) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw invalida()
      const v = p as Record<string, unknown>
      if (typeof v.nombre !== 'string' || !v.nombre.trim() || v.nombre.length > 100 || typeof v.activo !== 'boolean' || !Array.isArray(v.nombresIdentidad) || v.nombresIdentidad.length > 20 || v.nombresIdentidad.some(n => typeof n !== 'string' || !n.trim() || n.length > 100)) throw invalida()
      return { nombre: v.nombre.trim(), activo: v.activo, nombresIdentidad: v.nombresIdentidad.map(n => String(n).trim()) }
    })
    if (new Set(personas.map(p => p.nombre.toLocaleLowerCase('es'))).size !== personas.length) throw invalida()
  }
  return { version: env.HUB_CSM_VERSION?.trim() || 'sin-configurar', fuente: env.HUB_CSM_FUENTE?.trim() || 'Catálogo privado de CSM', personas }
}
