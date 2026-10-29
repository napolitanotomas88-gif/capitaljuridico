import type { Metadata } from 'next'
import Link from 'next/link'
import { BotonEnlace, SeccionTitulo, Vacio } from '@/components/ui'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { ultimaCorrida } from '@/lib/edicion/db/corridas'
import { docsLeidos } from '@/lib/edicion/operativo'
import { listarPendientesE01 } from '@/lib/edicion/operativo'
import { pestanasDe, puedePestana } from '@/lib/edicion/permisos'
import type { Corrida, IdCrm, PasoSeguimiento } from '@/lib/edicion/tipos'
import { armarPendientes, estadoVigia } from '@/lib/edicion/vista'
import { configE01Whatsapp, loMandaElBot } from '@/lib/bot/grabacion/e01Whatsapp'
import { contextoEdicion, logLectura, type BusquedaPagina } from '../_componentes/contexto'
import { Encabezado } from '../_componentes/Encabezado'
import { conSufijo } from '../_componentes/enlaces'
import { PasoE01 } from '../_componentes/PasoE01'
import '../edicion.css'

// Grabaciones pendientes (e01, para la daily): los clientes que no grabaron, con el escalón de la escalera en días hábiles
// (día 0 mensaje con el guion y una fecha; día 2 audio de Gero M; día 4 llamada citando el contrato; día 9 decide Tomás; si
// sigue, un recordatorio cada 4 días hábiles). El texto para el cliente se arma al mostrarlo (textos.ts del bloque C) y se
// guarda recién cuando Aylu marca «hecho». Lo ven Aylu, Tomás y los socios en modo lectura; René no.
export const metadata: Metadata = { title: 'Grabaciones pendientes' }

export default async function PendientesPage({ searchParams }: { searchParams: Promise<BusquedaPagina> }) {
  const sp = await searchParams
  const c = await contextoEdicion(sp)
  const ahora = new Date()
  const comun = { modo: c.modo, demo: c.demo, rol: c.rol, sufijo: c.sufijo, rutaActual: '/clientes/edicion/pendientes', avisoRol: c.avisoRol, pestanas: pestanasDe(c.rol, c.socio), actual: 'pendientes' as const }
  if (!puedePestana(c.rol, c.socio, 'pendientes')) {
    return (
      <div className="ed-pila">
        <Encabezado etiqueta="Edición" titulo="Grabaciones pendientes" vigia={null} {...comun} />
        <Vacio frase="Esta parte es de Aylu y Tomás (el seguimiento de los clientes que no grabaron)." accion={<BotonEnlace href={conSufijo('/clientes/edicion', c.sufijo)}>Volver a tu cola</BotonEnlace>} />
      </div>
    )
  }
  let pasos: PasoSeguimiento[] = []
  let docs = new Map<IdCrm, string | null>()
  let corrida: Corrida | null = null
  let falla: string | null = null
  if (c.demo) {
    const d = (await import('@/lib/edicion/demo')).datosDemo(ahora)
    pasos = d.pasos; docs = d.docs; corrida = d.corrida
  } else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try {
      const [p, leidos, k] = await Promise.all([listarPendientesE01(), docsLeidos(), ultimaCorrida()])
      pasos = p; corrida = k
      for (const [docId, x] of leidos) docs.set(x.id_crm.toUpperCase(), docId)
    } catch (e) {
      logLectura('las grabaciones pendientes', e)
      falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.'
    }
  }
  if (falla) {
    return (
      <div className="ed-pila">
        <SeccionTitulo etiqueta="Edición" titulo="Grabaciones pendientes" />
        <div className="cj-aviso" role="alert"><p>{falla}</p></div>
      </div>
    )
  }
  const bot = c.demo ? null : configE01Whatsapp(process.env)
  const v = armarPendientes(pasos, c.rol, { ahora, docs, loMandaElBot: p => loMandaElBot(p, bot) })
  return (
    <div className="ed-pila">
      <Encabezado etiqueta="Edición" titulo="Grabaciones pendientes" vigia={estadoVigia(corrida, ahora)} contadores={{ pendientes: v.total }} {...comun} />
      <p className="ed-parrafo ed-sub">Escalera en días hábiles desde que los guiones quedaron «Para grabar» o se marcaron como enviados. Los textos son un borrador (versión tx1) que aprueba Tomás.</p>
      {v.clientes.length ? v.clientes.map(k => (
        <section key={k.id_crm} className="ed-seccion" aria-label={k.cliente}>
          <h2><Link href={conSufijo(k.href, c.sufijo)} className="ed-enlace-cliente">{k.cliente}</Link> <span className="ed-contador">{k.id_crm}</span></h2>
          <div className="ed-pasos">{k.pasos.map(p => <PasoE01 key={`${p.id}.${p.version}`} p={p} demo={c.demo} puedeMarcar={v.puedeMarcar} puedeDecidir={v.puedeDecidir} />)}</div>
        </section>
      )) : <Vacio frase="No hay clientes atrasados con la grabación. Cuando un guion queda «Para grabar» y no llegan crudos, aparece acá." />}
    </div>
  )
}
