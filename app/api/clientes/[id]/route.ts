import type { NextRequest } from 'next/server'
import { puedeVer } from '@/lib/auth/roles'
import { json, exigirClientes } from '@/lib/clientes/api'
import { ID_CLIENTE_VALIDO, armarFicha, sinMontos } from '@/lib/clientes/ficha'
import { cargarVista } from '@/lib/clientes/vista'

export const dynamic = 'force-dynamic'

// Ficha de un cliente (solo lectura): la misma que muestra /clientes/[id]. Los teléfonos y mails solo salen
// si el rol puede ver Clientes (hoy es la misma condición de entrada: se deja explícita por si se afloja después).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const acceso = await exigirClientes()
  if ('error' in acceso) return acceso.error

  const { id } = await ctx.params
  if (!ID_CLIENTE_VALIDO.test(id)) return json({ error: 'No encontrado' }, 404)

  let vista
  try {
    vista = await cargarVista(false, puedeVer(acceso.sesion, 'finanzas') ? 'fresco' : 'omitir')
  } catch (e) {
    console.error('API cliente: no se pudo leer el CRM:', (e as Error).message?.slice(0, 200))
    return json({ error: 'No se pudo leer la planilla de clientes' }, 503)
  }

  const ficha = armarFicha(vista.datos, vista.creditos, id, { conContacto: puedeVer(acceso.sesion, 'clientes') })
  if (!ficha) return json({ error: 'No encontrado' }, 404)
  // Sin Finanzas, sin montos (26/10/2026)
  return json(puedeVer(acceso.sesion, 'finanzas') ? ficha : sinMontos(ficha))
}
