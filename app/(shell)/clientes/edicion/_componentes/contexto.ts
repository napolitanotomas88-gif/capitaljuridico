// Lo que necesita cada página de /clientes/edicion antes de leer datos (solo servidor):
//   · la barrera: exigirAcceso('edicion') en CADA página (el layout del shell no frena nada);
//   · el rol de edición (de la sesión; en el ejemplo, de ?como=), si es socio y si ve Clientes (para armar o no los links);
//   · el modo (EDICION_MODO) y el modo de ejemplo (?demo=1, solo en desarrollo), con el sufijo para los enlaces.
import { exigirAcceso, type Sesion } from '@/lib/auth/sesion'
import { pedidoDemo } from '@/lib/clientes/demo'
import { modoEdicion } from '@/lib/edicion/config'
import { NOMBRE_ROL, enProduccion, esSocio, rolEdicion, variablesFaltantes, veClientes } from '@/lib/edicion/permisos'
import type { RolEdicion } from '@/lib/edicion/tipos'

export type BusquedaPagina = Record<string, string | string[] | undefined>
export interface ContextoPagina {
  sesion: Sesion; demo: boolean; rol: RolEdicion; socio: boolean; modo: 'dry' | 'real'; sufijo: string; veClientes: boolean; avisoRol: string | null
}

const ROLES: readonly RolEdicion[] = ['aylu', 'tomas', 'rene', 'lector']
export const uno = (x: string | string[] | undefined): string => (Array.isArray(x) ? x[0] ?? '' : x ?? '')

export async function contextoEdicion(sp: BusquedaPagina): Promise<ContextoPagina> {
  const sesion = await exigirAcceso('edicion')
  const demo = pedidoDemo(sp.demo)
  const como = uno(sp.como) as RolEdicion
  const rol: RolEdicion = demo ? (ROLES.includes(como) ? como : 'aylu') : rolEdicion(sesion)
  let avisoRol: string | null = null
  if (!demo && rol === 'lector') {
    if (sesion.esDePrueba) avisoRol = 'El usuario de prueba de desarrollo solo mira (no escribe en la base). Para probar los botones usá ?demo=1.'
    else {
      const faltan = variablesFaltantes()
      avisoRol = `Entraste como «${sesion.nombre}»: estás en modo lectura. Para mover videos, tu mail tiene que estar en ${['EDICION_REVISOR_AYLU', 'EDICION_REVISOR_TOMAS', 'EDICION_EDITOR_RENE'].join(', ')}${enProduccion(process.env) && faltan.length ? ` (faltan cargar: ${faltan.join(', ')})` : ''}.`
    }
  }
  return {
    sesion, demo, rol, socio: demo ? rol !== 'rene' : esSocio(sesion), modo: demo ? 'dry' : modoEdicion(),
    sufijo: demo ? `demo=1&como=${rol}` : '', veClientes: demo ? rol !== 'rene' : veClientes(sesion), avisoRol,
  }
}

export const nombreRol = (r: RolEdicion) => NOMBRE_ROL[r]

/** El mensaje de una lectura que falló, sin la URL de la base ni mails. */
export function logLectura(que: string, e: unknown): void {
  console.error(`Edición: no se pudo leer ${que}:`, ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').replace(/[^\s@]+@[^\s@]+/g, '[mail]').slice(0, 200))
}
