import type { Metadata } from 'next'
import Link from 'next/link'
import { BotonEnlace, ChipSemaforo, SeccionTitulo, Vacio } from '@/components/ui'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { leerMarca } from '@/lib/edicion/operativo'
import { leerVideo, type DetalleVideo } from '@/lib/edicion/operativo'
import { pasaTope } from '@/lib/edicion/estados'
import type { FichaMarca } from '@/lib/edicion/tipos'
import { ETIQUETA_PRIORIDAD, armarVideo } from '@/lib/edicion/vista'
import { AccionesVideo } from '../../_componentes/AccionesVideo'
import { BotonAccion } from '../../_componentes/BotonAccion'
import { contextoEdicion, logLectura, type BusquedaPagina } from '../../_componentes/contexto'
import { Encabezado } from '../../_componentes/Encabezado'
import { Historial } from '../../_componentes/Historial'
import { ListaCrudos } from '../../_componentes/ListaCrudos'
import { Notas } from '../../_componentes/Notas'
import { Paleta } from '../../_componentes/Paleta'
import { PedidoCliente } from '../../_componentes/PedidoCliente'
import { TextoParaCopiar } from '../../_componentes/TextoParaCopiar'
import '../../edicion.css'

// Un video: el gancho y el guion, los botones que le tocan al rol (accionesPara), el texto para el cliente (regrabación o
// link final) con su «enviado», el pedido del cliente (f05, con el tope interno de P6), las notas por ronda (Aylu escribe,
// René tilda), el editado y lo que propone el bot, los crudos, la paleta y el historial con nombres (nunca mails).
type Props = { params: Promise<{ id: string }>; searchParams: Promise<BusquedaPagina> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: /^\d{1,12}$/.test(id) ? `Video ${id}` : 'Video' }
}

export default async function EdicionVideoPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const c = await contextoEdicion(sp)
  const n = /^\d{1,12}$/.test(id) ? Number(id) : NaN
  const ruta = `/clientes/edicion/video/${encodeURIComponent(id)}`
  let d: DetalleVideo | null = null
  let marca: FichaMarca | null = null
  let falla: string | null = null
  if (!Number.isSafeInteger(n) || n <= 0) falla = null
  else if (c.demo) {
    const demo = (await import('@/lib/edicion/demo')).datosDemo(new Date())
    d = demo.detalle(n); marca = d ? demo.marcas.get(d.video.id_crm) ?? null : null
  } else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try {
      d = await leerVideo(n)
      marca = d ? await leerMarca(d.video.id_crm) : null
    } catch (e) {
      logLectura(`el video ${n}`, e)
      falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.'
    }
  }
  if (falla) {
    return (
      <div className="ed-pila">
        <SeccionTitulo etiqueta="Edición · Video" titulo="Video" />
        <div className="cj-aviso" role="alert"><p>{falla}</p></div>
        <div className="cj-fila"><BotonEnlace href={ruta}>Reintentar</BotonEnlace><BotonEnlace href="/clientes/edicion">Volver al tablero</BotonEnlace></div>
      </div>
    )
  }
  if (!d) {
    return (
      <div className="ed-pila">
        <SeccionTitulo etiqueta="Edición · Video" titulo="Ese video no está" />
        <Vacio frase="Puede que el link esté mal o que el video se haya borrado." accion={<BotonEnlace href="/clientes/edicion">Volver al tablero</BotonEnlace>} />
      </div>
    )
  }

  const v = armarVideo(d, marca, null, c.rol)
  const conSufijoRuta = (h: string) => (c.sufijo ? `${h}${h.includes('?') ? '&' : '?'}${c.sufijo}` : h)
  const seriaTercera = v.estado === 'con_cliente' && pasaTope(v.rondas.cliente)
  const alerta = !!v.bloqueo || v.tiempo.trabado

  return (
    <div className="ed-pila">
      <Encabezado etiqueta={`Edición · ${v.cliente} · ${v.id_crm}`} titulo={`${v.clave}`} vigia={null} modo={c.modo} demo={c.demo} rol={c.rol} pestanas={[]} actual={null}
        sufijo={c.sufijo} rutaActual={ruta} avisoRol={c.avisoRol} volver={{ href: v.hrefCliente, texto: `Volver a ${v.cliente}` }} />
      <p className="ed-barra">
        <ChipSemaforo estado={alerta ? 'rojo' : v.estado === 'aprobado' ? 'verde' : 'amarillo'}>{v.etiquetaEstado}</ChipSemaforo>
        <span title={v.tiempo.detalle || undefined}>{v.tiempo.trabado ? `Trabado · ${v.tiempo.texto}` : v.tiempo.texto}</span>
        {v.prioridad !== 'normal' && <span className={v.prioridad === 'urgente' ? 'ed-marca ed-marca--alerta' : 'ed-marca ed-marca--laton'}>{ETIQUETA_PRIORIDAD[v.prioridad]}</span>}
        {v.rondas.texto && <span className="ed-sub">Rondas: {v.rondas.texto}</span>}
        <Link href={conSufijoRuta('/clientes/edicion')} className="cj-enlace">Tablero</Link>
      </p>
      {v.bloqueo && <div className="cj-aviso" role="status"><p><strong>{v.bloqueo.texto}</strong>{v.bloqueo.motivo ? ` · ${v.bloqueo.motivo}` : ''}</p></div>}
      {v.posibleDuplicado.length > 0 && <p className="ed-interno"><strong>Revisar</strong>Puede ser el mismo video que {v.posibleDuplicado.join(', ')} (importado de ClickUp). Si es así, descartá uno de los dos.</p>}

      <div className="ed-dos">
        <div className="ed-columna-pila">
          <section className="ed-seccion" aria-labelledby="ed-acc">
            <h2 id="ed-acc">Qué sigue</h2>
            <AccionesVideo videoId={v.id} version={v.version} acciones={v.acciones} demo={c.demo} prioridad={v.prioridad} puedePrioridad={v.permisos.prioridad}
              bloqueo={v.bloqueo} permisoBloqueo={v.permisos.bloqueo} puedeTope={v.permisos.tope} vacio={v.queSigue} />
          </section>

          {v.envio && (
            <section className="ed-seccion" aria-labelledby="ed-envio">
              <h2 id="ed-envio">{v.envio.tipo === 'regrabar' ? 'Pedido de regrabación' : 'Link final para el cliente'}</h2>
              <TextoParaCopiar key={`${v.envio.tipo}-${v.version}`} texto={v.envio.texto} etiqueta="Texto para el grupo Contenido" demo={c.demo} constancia={v.envio.constancia}
                envio={{ cuerpo: { accion: 'envio_registrado', tipo: v.envio.tipo, items: [{ video_id: v.id, version: v.version }] }, boton: v.envio.tipo === 'regrabar' ? 'Enviado: vuelve a Esperando crudos' : v.envio.constancia ? 'Enviado otra vez' : 'Enviado' }} />
            </section>
          )}

          {c.rol !== 'rene' && (v.permisos.pedido || v.pedidos.length > 0) && (
            <section className="ed-seccion" aria-labelledby="ed-pedido">
              <h2 id="ed-pedido">Pedido del cliente</h2>
              <PedidoCliente videoId={v.id} demo={c.demo} puedeCargar={v.permisos.pedido} esTomas={v.permisos.autorizar} pedidos={v.pedidos} esperaTomas={v.esperaTomas} seriaTercera={seriaTercera} />
            </section>
          )}

          <section className="ed-seccion" aria-labelledby="ed-notas">
            <h2 id="ed-notas">Notas de corrección</h2>
            <Notas videoId={v.id} demo={c.demo} rondas={v.rondasNotas} nuevas={v.notasNuevas} puedeEscribir={v.permisos.notas} enCorreccion={v.estado === 'correccion'} />
          </section>

          {v.okCliente && (
            <section className="ed-seccion" aria-labelledby="ed-ok">
              <h2 id="ed-ok">OK del cliente</h2>
              <p className="ed-cita">{v.okCliente.cita}</p>
              <p className="ed-sub">Lo registró {v.okCliente.quien || 'alguien'} · {v.okCliente.cuando}</p>
            </section>
          )}

          <section className="ed-seccion" aria-labelledby="ed-hist">
            <h2 id="ed-hist">Historial</h2>
            <Historial filas={v.historial} />
          </section>
        </div>

        <div className="ed-columna-pila">
          <section className="ed-seccion" aria-labelledby="ed-guion">
            <h2 id="ed-guion">Guion{v.guionRef ? <span className="ed-contador">{v.guionRef}</span> : null}</h2>
            {v.gancho ? <p className="ed-gancho">{v.gancho}</p> : null}
            {v.guion ? <p className="ed-guion">{v.guion}</p> : <p className="ed-vacio">Sin guion cargado.</p>}
          </section>

          <section className="ed-seccion" aria-labelledby="ed-editado">
            <h2 id="ed-editado">Editado</h2>
            {v.editado ? <p><a className="ed-link" href={v.editado.url} target="_blank" rel="noopener noreferrer">{v.editado.nombre ?? 'Abrir el editado en Drive'}</a></p> : <p className="ed-vacio">Todavía no hay editado vinculado.</p>}
            {v.propuestas.map(a => (
              <div key={a.id} className="ed-panel-accion">
                <p className="ed-sub">El bot vio un archivo nuevo en «Editados»: <strong>{a.nombre}</strong> · {a.creado} · <a className="ed-link" href={a.drive} target="_blank" rel="noopener noreferrer">Ver</a></p>
                {v.permisos.aceptarEditado && (
                  <BotonAccion demo={c.demo} variante="primario" etiqueta={v.estado === 'para_editar' ? `Es este: vincular ${a.nombre} y marcar listo` : `Es este: vincular ${a.nombre}`}
                    cuerpo={{ accion: 'aceptar_editado', archivo_id: a.id, video_id: v.id, version: v.version }} />
                )}
              </div>
            ))}
          </section>

          <section className="ed-seccion" aria-labelledby="ed-crudos-v">
            <h2 id="ed-crudos-v">Crudos <span className="ed-contador">{v.crudos.length}</span></h2>
            <ListaCrudos archivos={v.crudos} videos={[]} puedeVincular={false} demo={c.demo} tipo="crudo" vacio="Sin crudos vinculados. Se asignan desde la página del cliente." />
          </section>

          <section className="ed-seccion" aria-labelledby="ed-paleta">
            <h2 id="ed-paleta">Paleta</h2>
            <Paleta m={v.marca} />
          </section>
        </div>
      </div>
    </div>
  )
}
