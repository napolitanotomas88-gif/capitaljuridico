'use server'

import { cookies } from 'next/headers'
import { puedeVer } from '@/lib/auth/roles'
import { exigirAcceso } from '@/lib/auth/sesion'
import { modoCobros } from '@/lib/clientes/cobrosFrescos'
import { pedidoDemo } from '@/lib/clientes/demo'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import { cargarVista } from '@/lib/clientes/vista'
import { tarjetaSola, type TarjetaSola } from './EnVivo'

// Abrir la tarjeta de un cliente sin rearmar la cartera (velocidad 3, 13/11/2026). Al tocar un cliente, LineaTiempo cambia
// la URL a ?cliente=<ID> con history.pushState (Next no le pide nada al servidor) y trae SOLO la tarjeta con esta función:
// la respuesta es el RSC de DetalleCliente, sin la línea de tiempo, las cifras ni la lista. El enlace directo y el
// router.refresh() de las acciones de la tarjeta siguen armando la página entera con la tarjeta adentro (page.tsx).
// Mismas barreras que la página: sesión y sección Clientes; los cobros, solo con Finanzas; ?demo=1 solo en desarrollo.
// Next despacha las funciones de servidor de a una: mientras llega una tarjeta, otra acción o navegación espera su turno.

export async function tarjetaDelCliente(id: string, opciones: { demo?: string | null; accion?: string | null } = {}): Promise<TarjetaSola> {
  const sesion = await exigirAcceso('clientes')
  if (typeof id !== 'string' || !ID_CLIENTE_VALIDO.test(id)) return { ok: false, aviso: 'Ese no es un ID de cliente válido.' }
  const demo = pedidoDemo(opciones.demo ?? undefined)
  const verCobros = puedeVer(sesion, 'finanzas')
  try {
    const vista = await cargarVista(demo, !verCobros ? 'omitir' : modoCobros(await cookies()))
    const accion = typeof opciones.accion === 'string' && opciones.accion ? opciones.accion.slice(0, 40) : undefined
    return await tarjetaSola(vista, id.toUpperCase(), sesion, accion)
  } catch (e) {
    console.error('[cartera] tarjeta sola:', String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160))
    return { ok: false, aviso: 'No se pudo leer el CRM. Cerrá la tarjeta y probá de nuevo en un minuto.' }
  }
}
