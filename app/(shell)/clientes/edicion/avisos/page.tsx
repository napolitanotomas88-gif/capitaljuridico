import type { Metadata } from 'next'
import { BotonEnlace, ChipSemaforo, SeccionTitulo, Vacio } from '@/components/ui'
import { avisosReales } from '@/lib/edicion/config'
import { listarAvisos } from '@/lib/edicion/operativo'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { pestanasDe, puedePestana } from '@/lib/edicion/permisos'
import type { Aviso } from '@/lib/edicion/tipos'
import { armarAvisos } from '@/lib/edicion/vista'
import { contextoEdicion, logLectura, type BusquedaPagina } from '../_componentes/contexto'
import { Encabezado } from '../_componentes/Encabezado'
import { conSufijo } from '../_componentes/enlaces'
import '../edicion.css'

// Avisos de Discord que no salieron (o que hay que mirar): los de modo prueba (con el texto que habrían llevado), los
// dudosos (un timeout de Discord pudo haberlos publicado igual: no se reintentan solos) y los errores. Solo Aylu y Tomás.
export const metadata: Metadata = { title: 'Avisos de Edición' }

export default async function AvisosPage({ searchParams }: { searchParams: Promise<BusquedaPagina> }) {
  const sp = await searchParams
  const c = await contextoEdicion(sp)
  const comun = { modo: c.modo, demo: c.demo, rol: c.rol, sufijo: c.sufijo, rutaActual: '/clientes/edicion/avisos', avisoRol: c.avisoRol, pestanas: pestanasDe(c.rol, c.socio), actual: 'avisos' as const }
  if (!puedePestana(c.rol, c.socio, 'avisos')) {
    return (
      <div className="ed-pila">
        <Encabezado etiqueta="Edición" titulo="Avisos" vigia={null} {...comun} />
        <Vacio frase="Esta parte es de Aylu y Tomás." accion={<BotonEnlace href={conSufijo('/clientes/edicion', c.sufijo)}>Volver al tablero</BotonEnlace>} />
      </div>
    )
  }
  let avisos: Aviso[] = []
  let falla: string | null = null
  if (c.demo) avisos = (await import('@/lib/edicion/demo')).datosDemo(new Date()).avisos
  else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try { avisos = await listarAvisos({ estados: ['dry', 'dudoso', 'error', 'pendiente', 'enviando'], limite: 100 }) } catch (e) { logLectura('los avisos', e); falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.' }
  }
  if (falla) return <div className="ed-pila"><SeccionTitulo etiqueta="Edición" titulo="Avisos" /><div className="cj-aviso" role="alert"><p>{falla}</p></div></div>
  const filas = armarAvisos(avisos)
  return (
    <div className="ed-pila">
      <Encabezado etiqueta="Edición" titulo="Avisos" vigia={null} contadores={{ avisos: filas.length }} {...comun} />
      <p className="ed-parrafo ed-sub">{c.demo || !avisosReales() ? 'Los avisos están en modo prueba: no salen a Discord y quedan acá con el texto que habrían llevado.' : 'Los avisos salen a Discord (#✂️-edicion y, para Valen, #ads). Acá quedan los que esperan agruparse, los dudosos y los que dieron error.'}</p>
      {filas.length ? (
        <ul className="ed-avisos">
          {filas.map(a => (
            <li key={a.id} className="ed-aviso">
              <p className="ed-barra"><ChipSemaforo estado={a.tono}>{a.estado}</ChipSemaforo><span className="ed-sub">{a.tipo} · {a.canal} · {a.creado}</span></p>
              <p className="ed-aviso__texto">{a.texto}</p>
              {a.error && <p className="ed-sub" style={{ color: 'var(--cj-error)' }}>{a.error}</p>}
            </li>
          ))}
        </ul>
      ) : <Vacio frase="No hay avisos para revisar." />}
    </div>
  )
}
