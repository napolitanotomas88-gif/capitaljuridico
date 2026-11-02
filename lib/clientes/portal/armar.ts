// ── Portal del cliente: arma la página de UN cliente (servidor) ────────────────────────────────────────────────────────────
// Junta lo que el equipo cargó (cj_portal_cliente), las tandas de guiones que ya puede ver (cj_guiones, filtradas en modelo.ts) y
// el registro de hitos (CRM + Despacho + lo anotado a mano). Todo filtrado por SU ID: nunca se arma ni se manda la lista de
// clientes al navegador. Sin montos: el CRM se lee sin cobros de Finanzas. Si una fuente falla, esa parte sale vacía.
import { hitosDelCliente, type Hito } from '@/lib/clientes/hitos'
import { leerAnotaciones } from '@/lib/clientes/hitosRegistro'
import { leerDespachoRecorrido } from '@/lib/clientes/recorridoFuentes'
import { cargarVista } from '@/lib/clientes/vista'
import { tandasDelCliente } from '@/lib/bot/guiones/registro'
import { documentoVinculadoCliente } from '@/lib/bot/guiones/documento'
import { unstable_cache } from 'next/cache'
import { leerPortal } from './base'
import { leerAnunciosPortal } from './meta'
import { armarReporte, type Reporte } from './reporte'
import { PORTAL_VACIO, procesoParaCliente, tandasParaCliente, type PasoProceso, type PortalGuardado, type TandaPortal } from './modelo'

export interface PaginaPortal {
  id: string
  /** Nombre del CRM: solo para el equipo (el cliente ve portal.datos.nombre o, si está vacío, esto mismo). */
  nombreCRM: string
  portal: PortalGuardado
  tandas: TandaPortal[]
  proceso: PasoProceso[]
  documento: string | null
  hoy: string
  /** Qué no se pudo leer (solo se le muestra al equipo). */
  avisos: string[]
  /** Reporte de anuncios: null sin cuentas cargadas; 'error' si Meta no respondió (al cliente: «lo estamos actualizando»). */
  reporte: { datos: Reporte; leido: string } | 'error' | null
}

/** Meta, cacheado 1 h por juego de cuentas (compartido entre instancias). Solo las cuentas guardadas en el portal de ese ID. */
const CACHE_S = 3600
const anunciosCacheados = (cuentas: string[]) => {
  const clave = [...cuentas].sort().join(',')
  return unstable_cache(async () => ({ ...(await leerAnunciosPortal(cuentas)), leido: new Date().toISOString() }), ['portal-anuncios-v1', clave], { revalidate: CACHE_S, tags: ['portal-anuncios'] })()
}

const corto = (e: unknown) => String((e as Error)?.message ?? e).replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 160)

/** null = ese ID no está en el CRM (la página da 404). */
export async function armarPortal(idCrudo: string): Promise<PaginaPortal | null> {
  const id = idCrudo.toUpperCase()
  const vista = await cargarVista(false, 'omitir')
  const c = vista.datos.clientes.find(x => x.id.toUpperCase() === id)
  if (!c) return null
  const avisos: string[] = []
  const [portal, filas, despacho, anotaciones, doc] = await Promise.all([
    leerPortal(id).catch(e => { console.error('[portal] leer:', corto(e)); avisos.push('No se pudo leer lo cargado del portal: recargá en un minuto antes de editar.'); return null }),
    tandasDelCliente(id).catch(e => { console.error('[portal] guiones:', corto(e)); avisos.push('No se pudieron leer los guiones del Despacho.'); return [] }),
    leerDespachoRecorrido().catch(() => null),
    leerAnotaciones().catch(() => null),
    documentoVinculadoCliente(id).catch(() => null),
  ])
  const tanda = despacho?.tandaDe(id) ?? null
  const videos = despacho?.videosDe(id) ?? null
  const hitos: Hito[] = hitosDelCliente({
    dia1: c.dia1, renovo: c.renovo, inicioPeriodo2: c.periodos.find(p => p.periodo === 1)?.dia1 ?? null,
    kickoff: despacho?.kickoffDe(c.id, c.nombre)?.fecha ?? null,
    tanda: tanda ? { creado: tanda.creado ?? null, estado: tanda.estado, aprobada: tanda.aprobada ?? null, enviada: tanda.enviada ?? null, notaCliente: tanda.notaCliente ?? null } : null,
    videos: videos ? { crudos: videos.crudoRecibido ?? null, editados: videos.editado ?? null } : null,
    drive: null, clickupGuiones: null, clickupEstado: null, lanzamiento: null, campanaActiva: false, exito: null,
    manuales: anotaciones?.hitos.get(id) ?? [],
  })
  let reporte: PaginaPortal['reporte'] = null
  const datosPortal = portal?.datos
  if (datosPortal?.reporte.cuentas.length) {
    try {
      const lectura = await anunciosCacheados(datosPortal.reporte.cuentas)
      for (const e of lectura.errores) avisos.push(`Anuncios: ${e}`)
      const p = datosPortal.progreso
      reporte = { datos: armarReporte(lectura.filas, { casos: p.casos, historial: p.historial, valorCaso: datosPortal.reporte.valorCaso, mesActual: vista.datos.hoy.slice(0, 7) }), leido: lectura.leido }
    } catch (e) {
      console.error('[portal] anuncios:', corto(e))
      avisos.push(`No se pudieron leer los anuncios de Meta: ${corto(e)}`)
      reporte = 'error'
    }
  }
  return {
    id, nombreCRM: c.nombre, reporte,
    portal: portal ?? { datos: PORTAL_VACIO, version: -1, actualizado: null },
    tandas: tandasParaCliente(filas),
    proceso: procesoParaCliente(hitos),
    documento: doc?.url ?? null,
    hoy: vista.datos.hoy,
    avisos,
  }
}
