import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BotonEnlace, SeccionTitulo, Vacio } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { baseConfigurada, gemelasDe, listarFichasCliente, type FilaFichaCliente, type GemelaDuplicada } from '@/lib/bot/kickoff/registro'
import { revisorDeSesion } from '@/lib/bot/kickoff/revision'
import { armarVista, elegirFila, gemelasVista, opcionesFichas } from '@/lib/bot/kickoff/vista'
import { pedidoDemo } from '@/lib/clientes/demo'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import { leerMarca } from '@/lib/edicion/db/marca'
import { lecturasDe } from '@/lib/edicion/db/marcaPropuestas'
import { Acuerdos } from './_componentes/Acuerdos'
import { Avatar, Presupuesto, Rama, Zona } from './_componentes/Campana'
import { Cabecera } from './_componentes/Cabecera'
import { Faltantes } from './_componentes/Faltantes'
import { Ganadores } from './_componentes/Ganadores'
import { Ideas } from './_componentes/Ideas'
import { MarcaKickoff, type EstadoMarcaKickoff } from './_componentes/MarcaKickoff'
import { ParaLanzar } from './_componentes/ParaLanzar'
import { Portfolio } from './_componentes/Portfolio'
import './kickoff.css'

// Ficha de kickoff de un cliente (24/10/2026): reemplaza la tarjeta de ClickUp "Seguimiento de Anuncios". La arma el bot
// después de la llamada de kickoff (Fathom de Tomás o de Gero M) y la guarda en Neon (cj_kickoffs); el aviso de Discord
// linkea acá. Muestra la última ficha del cliente (con un selector si hay más de una llamada registrada) y deja tildar a
// mano lo que el portfolio no resolvió, marcar los faltantes como hechos, cargar la fecha y el WhatsApp para lanzar y, a
// Tomi y Gero M, aprobar las ideas o pedir cambios (POST /api/clientes/<id>/kickoff). Arriba de todo, "Para lanzar": lo que
// usa Valentino para armar la campaña. Si la misma reunión la grabaron los dos, la otra grabación (quedó "duplicada", sin
// ficha) se nombra en la cabecera con su link a Fathom.
// Lo que se muestra sale de lib/bot/kickoff/vista.ts (que decide qué NO llega al navegador). Mismo permiso que la ficha
// del cliente: quien ve Clientes. Con ?demo=1 (solo en desarrollo) muestra la ficha ficticia de lib/bot/kickoff/demo.ts y
// no toca la base.

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// El título lleva solo el ID (no el nombre): queda en el historial del navegador
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: ID_CLIENTE_VALIDO.test(id) ? `Kickoff ${id.toUpperCase()}` : 'Kickoff' }
}

export default async function KickoffClientePage({ params, searchParams }: Props) {
  const sesion = await exigirAcceso('clientes')
  const { id } = await params
  if (!ID_CLIENTE_VALIDO.test(id)) notFound()
  const sp = await searchParams
  const demo = pedidoDemo(sp.demo)
  const idCrm = id.toUpperCase()
  const sufijo = demo ? 'demo=1' : ''
  const volver = `/clientes/${encodeURIComponent(idCrm)}${demo ? '?demo=1' : ''}`

  let filas: FilaFichaCliente[] = []
  let falla: string | null = null
  // El ejemplo se carga solo si se pide (en producción pedidoDemo siempre da false)
  if (demo) filas = (await import('@/lib/bot/kickoff/demo')).filasDemo(idCrm)
  else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try {
      filas = await listarFichasCliente(idCrm)
    } catch (e) {
      console.error('Ficha de kickoff: no se pudo leer cj_kickoffs:', ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
      falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.'
    }
  }

  if (falla) {
    return (
      <div className="cj-pila">
        <SeccionTitulo etiqueta={`Kickoff · Cliente ${idCrm}`} titulo="Ficha de kickoff" />
        <div className="cj-aviso" role="alert"><p>{falla}</p></div>
        <div className="cj-fila">
          <BotonEnlace href={`/clientes/${encodeURIComponent(idCrm)}/kickoff`}>Reintentar</BotonEnlace>
          <BotonEnlace href={volver}>Volver a la ficha del cliente</BotonEnlace>
        </div>
      </div>
    )
  }

  const elegida = elegirFila(filas, sp.grabacion)
  const v = elegida ? armarVista(elegida) : null
  if (!elegida || !v) {
    return (
      <div className="cj-pila">
        <SeccionTitulo etiqueta={`Kickoff · Cliente ${idCrm}`} titulo="Todavía no hay ficha de kickoff" />
        <Vacio
          frase={filas.length
            ? 'Las llamadas registradas de este cliente no tienen una ficha que se pueda leer. Puede ser una ficha de una versión vieja del bot: se rehace reprocesando la grabación.'
            : 'La arma el bot después de la llamada de kickoff (con el Fathom de Tomás o de Gero M) y avisa por Discord con el link a esta página. Si el kickoff ya fue y no aparece, puede que el cliente no se haya cruzado con el CRM: la ficha queda sin ID y no llega acá.'}
          accion={<BotonEnlace href={volver}>Volver a la ficha del cliente</BotonEnlace>}
        />
      </div>
    )
  }

  const opciones = opcionesFichas(filas, elegida)
  // La otra grabación de la misma reunión (si la hubo): es solo un renglón de la cabecera, así que si la base falla se sigue
  let gemelas: GemelaDuplicada[] = []
  if (!demo) {
    try {
      gemelas = await gemelasDe(elegida.recording_id)
    } catch (e) {
      console.error('Ficha de kickoff: no se pudo leer si hubo otra grabación de la misma reunión:', ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    }
  }
  // Marca del cliente (e05 de Grabación): es un recuadro de ayuda, así que si la base falla no se muestra y la ficha sigue
  let marca: EstadoMarcaKickoff | null = null
  if (demo) marca = { tipo: 'falta', problema: null }
  else {
    try {
      const [ficha, lecturas] = await Promise.all([leerMarca(idCrm), lecturasDe(idCrm, 3)])
      const propuesta = lecturas.find(l => l.estado === 'propuesta' && l.colores.length)
      const problema = lecturas.find(l => l.estado === 'error' || l.estado === 'sin_colores')
      marca = ficha?.colores.length ? { tipo: 'cargada', colores: ficha.colores }
        : propuesta ? { tipo: 'propuesta', colores: propuesta.colores, archivo: propuesta.nombre }
        : { tipo: 'falta', problema: problema ? `«${problema.nombre}»${problema.nota ? ` (${problema.nota})` : ''}` : null }
    } catch (e) {
      console.error('Ficha de kickoff: no se pudo leer la marca:', ((e as Error)?.message ?? '').replace(/\b[a-z]+:\/\/\S+/gi, '[url]').slice(0, 200))
    }
  }
  const revisor = demo ? null : revisorDeSesion(sesion)
  const esKickoff = v.encabezado.esKickoff

  return (
    <div className="cj-pila">
      <Cabecera v={v} idCliente={idCrm} volver={volver} opciones={opciones} sufijo={sufijo} gemelas={gemelasVista(gemelas)} />

      {demo && (
        <div className="cj-panel">
          <p><span className="cj-etiqueta cj-etiqueta--laton">Datos de ejemplo</span></p>
          <p>Esta ficha es ficticia y solo existe en desarrollo (?demo=1): sirve para revisar el diseño. No sale de la base y los tildes y la revisión no se guardan.</p>
        </div>
      )}

      {esKickoff && <Faltantes v={v} idCliente={idCrm} recordingId={v.recording_id} demo={demo} />}

      {esKickoff && (
        <>
          <ParaLanzar l={v.lanzar} idCliente={idCrm} recordingId={v.recording_id} demo={demo} />
          <Rama r={v.rama} />
          <Avatar a={v.avatar} />
          <Zona z={v.zona} />
          <Presupuesto p={v.presupuesto} />
          <Portfolio p={v.portfolio} idCliente={idCrm} recordingId={v.recording_id} demo={demo} puedeTildar={esKickoff} />
        </>
      )}
      <Acuerdos acuerdos={v.acuerdos} pendientes={v.pendientes} />
      {esKickoff && (
        <>
          <Ideas i={v.ideas} idCliente={idCrm} recordingId={v.recording_id} revisor={revisor} nombreSesion={demo ? null : sesion.nombre} demo={demo} />
          <Ganadores g={v.ganadores} />
          {marca && <MarcaKickoff estado={marca} idCliente={idCrm} sufijo={sufijo} />}
        </>
      )}
      {v.ajustes.length > 0 && (
        <details className="cj-detalles">
          <summary className="cj-etiqueta">Ajustes de la validación ({v.ajustes.length})</summary>
          <ul className="cj-lista">{v.ajustes.map(x => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
