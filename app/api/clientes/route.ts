import type { NextRequest } from 'next/server'
import { puedeVer } from '@/lib/auth/roles'
import { json, exigirClientes } from '@/lib/clientes/api'
import { aListado, filtrarListado, ordenarListado, parsearFiltros } from '@/lib/clientes/listado'
import { marcaDe, marcasBackend } from '@/lib/clientes/marcasBackend'
import { cargarVista } from '@/lib/clientes/vista'

export const dynamic = 'force-dynamic'

// Lista de clientes (solo lectura). Mismos filtros que la pantalla /clientes, por query string:
// q, estado (actuales por defecto; todos para ver todo), semaforo, closer, vencen=15|30, renovacion=1, linea, noclientes=1, orden. Sin teléfonos, mails ni notas
// (salvo la "Llamada agendada" de las marcas de renovación, igual que en la página).
// sincampana=1 y sinrespuesta=1 NO: necesitan ClickUp, Meta y el Typeform, que esta API no lee (responde 400 en vez de una lista vacía engañosa).
// La lectura de la planilla va por el snapshot de 10 min (a lo sumo una lectura batch por carga en frío).
export async function GET(req: NextRequest) {
  const acceso = await exigirClientes()
  if ('error' in acceso) return acceso.error

  const filtros = parsearFiltros(Object.fromEntries(req.nextUrl.searchParams))
  // Sin Finanzas, sin montos (26/10/2026): contratado, cobrado y saldo en null, y el orden por cobrado no se acepta
  const verMontos = puedeVer(acceso.sesion, 'finanzas')
  if (!verMontos && filtros.orden === 'cobrado') filtros.orden = 'vencimiento'
  if (filtros.sinCampana || filtros.sinRespuesta) return json({ error: 'sincampana y sinrespuesta solo funcionan en la pantalla /clientes' }, 400)

  let vista
  try {
    vista = await cargarVista(false, verMontos ? 'cache' : 'omitir')
  } catch (e) {
    console.error('API clientes: no se pudo leer el CRM:', (e as Error).message?.slice(0, 200))
    return json({ error: 'No se pudo leer la planilla de clientes' }, 503)
  }

  const { datos } = vista
  // Marcas de renovación y proyección (lo que era Backend): las mismas que la página, para que renovacion=1 no dé siempre 0
  const marcas = marcasBackend(datos.hoy, datos.clientes)
  const filas = datos.clientes.map((c, i) => aListado(c, i, vista.creditos.get(c.id), undefined, { backend: marcaDe(marcas, c) }))
  const clientes = ordenarListado(filtrarListado(filas, filtros), filtros.orden).map(f => {
    const { clave, ...publico } = f
    void clave   // clave de lista: solo sirve para la interfaz
    return verMontos ? publico : { ...publico, contratado: null, cobrado: null, cobrosAviso: null, saldo: null }
  })
  return json({ hoy: datos.hoy, fuente: datos.fuente, datosDe: datos.snapshotEn, total: clientes.length, clientes })
}
