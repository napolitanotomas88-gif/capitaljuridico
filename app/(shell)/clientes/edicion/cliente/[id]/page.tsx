import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BotonEnlace, ChipSemaforo, SeccionTitulo, Vacio } from '@/components/ui'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import { baseConfigurada } from '@/lib/edicion/db/base'
import { leerMarca } from '@/lib/edicion/operativo'
import { lecturasDe, type PropuestaMarca } from '@/lib/edicion/db/marcaPropuestas'
import { lecturasDelCliente, type LecturaGuardada } from '@/lib/edicion/db/lecturas'
import { tienePermiso } from '@/lib/edicion/permisos'
import { armarLecturas, lecturasAbiertas } from '@/lib/edicion/vistaLecturas'
import { leerCliente, type DatosCliente } from '@/lib/edicion/operativo'
import type { FichaMarca } from '@/lib/edicion/tipos'
import { armarCliente, type EstadoCliente } from '@/lib/edicion/vista'
import { AccionesVideo } from '../../_componentes/AccionesVideo'
import { BotonAccion } from '../../_componentes/BotonAccion'
import { CierreTanda } from '../../_componentes/CierreTanda'
import { Cobertura } from '../../_componentes/Cobertura'
import { contextoEdicion, logLectura, type BusquedaPagina } from '../../_componentes/contexto'
import { Encabezado } from '../../_componentes/Encabezado'
import { conSufijo } from '../../_componentes/enlaces'
import { FormMarca } from '../../_componentes/FormMarca'
import { LecturasCliente } from '../../_componentes/LecturasCliente'
import { ListaCrudos } from '../../_componentes/ListaCrudos'
import { Paleta } from '../../_componentes/Paleta'
import { TextoParaCopiar } from '../../_componentes/TextoParaCopiar'
import '../../edicion.css'

// Un cliente en Edición: por tanda del guion, cada guion con su estado en el doc y el del video, la cobertura de e03 (qué
// frases aparecen en los crudos y la mejor toma) y el check de Aylu (e04: sirve, regrabar con motivo, pausa con
// devolución, o "sirven todos" en lote); "guiones enviados" (arranca el seguimiento e01); el texto de regrabación para
// copiar; el cierre de cada tanda (al cliente en lote, un solo link final con todos los videos y el OK del cliente en lote);
// los crudos y editados con su asignación; las subidas; y la ficha de marca (e05). René no recibe el link a la
// ficha del cliente (no tiene Clientes): lo decide armarCliente con `puedeVerClientes`.
// La propuesta de paleta (e05) sale de lo que el cliente subió a "Marca - X" y leyó el vigía: la ficha la ofrece para
// usar, nunca la guarda sola.
type Props = { params: Promise<{ id: string }>; searchParams: Promise<BusquedaPagina> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: ID_CLIENTE_VALIDO.test(id) ? `Edición ${id.toUpperCase()}` : 'Edición' }
}

// Modo demo: una propuesta de ejemplo para los clientes sin paleta (datos inventados)
const PROPUESTA_DEMO = (idCrm: string): PropuestaMarca => ({
  id: 0, id_crm: idCrm, drive_id: 'DEMO_MARCA_0000000001', nombre: 'logo estudio.png', estado: 'propuesta',
  colores: [{ hex: '#1E4740', nombre: 'Verde petróleo' }, { hex: '#B08D57', nombre: 'Dorado mate' }, { hex: '#F2EDE4', nombre: 'Marfil' }],
  tipografias: [], nota: 'logo', modelo: '', creado: '2026-10-26T12:00:00Z',
})

// Modo demo: un OK leído del grupo Contenido (texto inventado)
const LECTURA_DEMO = (idCrm: string, videoId: number): LecturaGuardada => ({
  id: 0, id_crm: idCrm, texto: 'Quedó buenísimo, me encanta. Adelante con ese!', enviado: '2026-11-01T15:20:00Z', estado: 'propuesta_ok',
  tipo: 'ok', sentido: 'razonable', motivo: '', resumen: 'Aprueba el video sin cambios.', video_ids: [videoId], por: 'unico', pedido_id: null,
  version: 1, resuelta: null, resuelta_por: null, creado: '2026-11-01T15:20:05Z',
})

const TONO_CLIENTE: Record<EstadoCliente, 'verde' | 'amarillo' | 'rojo' | 'gris'> = { grabando: 'amarillo', en_revision: 'amarillo', en_edicion: 'amarillo', con_cliente: 'amarillo', al_dia: 'verde', pausado: 'gris' }

export default async function EdicionClientePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const c = await contextoEdicion(sp)
  if (!ID_CLIENTE_VALIDO.test(id)) notFound()
  const idCrm = id.toUpperCase()
  const ruta = `/clientes/edicion/cliente/${encodeURIComponent(idCrm)}`
  let datos: DatosCliente | null = null
  let marca: FichaMarca | null = null
  let lecturas: PropuestaMarca[] = []
  let contenido: LecturaGuardada[] = []
  let falla: string | null = null
  if (c.demo) {
    const d = (await import('@/lib/edicion/demo')).datosDemo(new Date())
    datos = d.cliente(idCrm); marca = d.marcas.get(idCrm) ?? null
    if (!marca?.colores.length) lecturas = [PROPUESTA_DEMO(idCrm)]
    const conCliente = datos?.videos.find(x => x.estado === 'con_cliente')
    if (conCliente) contenido = [LECTURA_DEMO(idCrm, conCliente.id)]
  } else if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try {
      ;[datos, marca, lecturas, contenido] = await Promise.all([leerCliente(idCrm), leerMarca(idCrm), lecturasDe(idCrm).catch(() => [] as PropuestaMarca[]),
        lecturasDelCliente(idCrm).catch(() => [] as LecturaGuardada[])])
    } catch (e) {
      logLectura(`el cliente ${idCrm}`, e)
      falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.'
    }
  }
  if (falla || !datos) {
    return (
      <div className="ed-pila">
        <SeccionTitulo etiqueta={`Edición · Cliente ${idCrm}`} titulo="Cliente" />
        <div className="cj-aviso" role="alert"><p>{falla}</p></div>
        <div className="cj-fila"><BotonEnlace href={ruta}>Reintentar</BotonEnlace><BotonEnlace href="/clientes/edicion">Volver al tablero</BotonEnlace></div>
      </div>
    )
  }

  const v = armarCliente(datos, marca, c.rol, c.veClientes)
  const vacio = !datos.videos.length && !datos.doc && !datos.archivos.length
  const titulo = v.cliente || `Cliente ${idCrm}`
  // f05 / f06: René no ve lo que escribe el cliente (P6); solo aparece si hay algo leído o videos esperando su respuesta
  const verLecturas = c.rol !== 'rene' && (contenido.length > 0 || datos.videos.some(x => x.estado === 'con_cliente'))
  const vLecturas = verLecturas ? armarLecturas(contenido, datos.videos, h => conSufijo(h, c.sufijo)) : []
  const comun = { modo: c.modo, demo: c.demo, rol: c.rol, sufijo: c.sufijo, rutaActual: ruta, avisoRol: c.avisoRol }

  if (vacio) {
    return (
      <div className="ed-pila">
        <Encabezado etiqueta={`Edición · Cliente ${idCrm}`} titulo={titulo} vigia={null} pestanas={[]} actual={null} volver={{ href: '/clientes/edicion', texto: 'Volver al tablero' }} {...comun} />
        <Vacio frase="Este cliente todavía no tiene videos, guiones leídos ni crudos en Edición. Entra cuando un guion pasa a «Para grabar» en su doc, cuando se marcan los guiones como enviados o cuando el vigía ve su carpeta de Crudos." />
        {v.permisos.marca && <section className="ed-seccion"><h2>Ficha de marca</h2><Paleta m={v.marca} /><FormMarca idCrm={idCrm} ficha={marca} lecturas={lecturas} demo={c.demo} /></section>}
      </div>
    )
  }

  return (
    <div className="ed-pila">
      <Encabezado etiqueta={`Edición · Cliente ${idCrm}`} titulo={titulo} vigia={null} pestanas={[]} actual={null} volver={{ href: '/clientes/edicion', texto: 'Volver al tablero' }} {...comun} />
      <p className="ed-barra">
        <ChipSemaforo estado={TONO_CLIENTE[v.estado]}>{v.etiquetaEstado}</ChipSemaforo>
        {v.linkClientes && <Link href={v.linkClientes} className="cj-enlace">Ficha del cliente</Link>}
        {v.doc?.link && <a className="cj-enlace" href={v.doc.link} target="_blank" rel="noopener noreferrer">Doc de guiones</a>}
        {v.carpetas.map(k => <a key={k.link} className="cj-enlace" href={k.link} target="_blank" rel="noopener noreferrer">{k.nombre}</a>)}
      </p>
      {v.seguimiento && (
        <p className={v.seguimiento.frenado ? 'ed-interno' : 'ed-modo'} role="note">
          <strong>Seguimiento</strong> {v.seguimiento.escalon} · a cargo de {v.seguimiento.responsable} · para el {v.seguimiento.debido.split('-').reverse().slice(0, 2).join('/')}
          {v.seguimiento.frenado ? ' · frenado: hay crudos sin ubicar' : ''} · <Link href={conSufijo('/clientes/edicion/pendientes', c.sufijo)} className="ed-link">Grabaciones pendientes</Link>
        </p>
      )}
      {v.doc && v.doc.avisos.length > 0 && <ul className="ed-guia" aria-label="Avisos del doc de guiones">{v.doc.avisos.map(a => <li key={a} className="ed-sub">{a}</li>)}</ul>}

      {v.regrabar && (
        <section className="ed-seccion" aria-labelledby="ed-regrabar">
          <h2 id="ed-regrabar">Pedido de regrabación <span className="ed-contador">{v.regrabar.items.length}</span></h2>
          <TextoParaCopiar key={v.regrabar.items.map(i => `${i.video_id}.${i.version}`).join('-')} texto={v.regrabar.texto} etiqueta="Texto para el grupo Contenido" demo={c.demo}
            envio={v.permisos.envio ? { cuerpo: { accion: 'envio_registrado', tipo: 'regrabar', items: v.regrabar.items }, boton: 'Enviado: vuelven a Esperando crudos' } : null} />
        </section>
      )}

      {verLecturas && (
        <section className="ed-seccion" id="lecturas" aria-labelledby="ed-lecturas">
          <h2 id="ed-lecturas">Lo que dijo el cliente en Contenido <span className="ed-contador">{lecturasAbiertas(vLecturas).length}</span></h2>
          <LecturasCliente lecturas={vLecturas} demo={c.demo} puede={c.rol !== 'lector' && tienePermiso(c.rol, 'pedido')} />
        </section>
      )}

      <section className="ed-seccion" aria-labelledby="ed-guiones">
        <h2 id="ed-guiones">Guiones y videos</h2>
        {v.tandas.map(t => (
          <div key={String(t.tanda)} className="ed-tanda">
            <div className="ed-tanda__cab">
              <h3>{t.titulo}</h3>
              <div className="ed-botones">
                {v.permisos.e04 && t.lote.length >= 2 && (
                  <BotonAccion demo={c.demo} variante="primario" etiqueta={`Sirven los ${t.lote.length}: a edición`} confirmar={`¿Pasar los ${t.lote.length} videos a Para editar?`} cuerpo={{ accion: 'mover_lote', transicion: 'sirve', items: t.lote }} />
                )}
                {v.permisos.guiones && t.ofrecerGuionesEnviados && t.tanda !== null && (
                  <BotonAccion demo={c.demo} etiqueta="Guiones enviados" confirmar={`¿Marcar los guiones de la tanda ${t.tanda} como enviados? Arranca el seguimiento si no graba.`} cuerpo={{ accion: 'guiones_enviados', id_crm: idCrm, tanda_guion: t.tanda }} />
                )}
              </div>
            </div>
            <ul className="ed-guiones">
              {t.guiones.map(g => (
                <li key={g.ref} className="ed-guion-fila">
                  <div>
                    <p className="cj-etiqueta">{g.ref} · doc: {g.estadoDoc}</p>
                    <h4>{g.titulo || 'Sin título'}</h4>
                    {g.video ? (
                      <p className="ed-sub">
                        <Link href={conSufijo(g.video.href, c.sufijo)} className="ed-link">{g.video.clave} · {g.video.etiqueta}</Link>
                        {` · ${g.video.crudos} crudo${g.video.crudos === 1 ? '' : 's'}`}{g.video.motivo ? ` · regrabar: ${g.video.motivo}` : ''}
                      </p>
                    ) : <p className="ed-sub">Sin video todavía</p>}
                    {g.video?.bloqueo && <span className="ed-marca ed-marca--alerta">{g.video.bloqueo}</span>}
                  </div>
                  <Cobertura c={g.cobertura} />
                  <div>
                    {g.video && g.video.acciones.length > 0 ? (
                      <AccionesVideo videoId={g.video.id} version={g.video.version} acciones={g.video.acciones} demo={c.demo} prioridad="normal" puedePrioridad={false} bloqueo={null} permisoBloqueo={null} puedeTope={false} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {t.cierre && <CierreTanda tanda={t.tanda} cierre={t.cierre} demo={c.demo} puedeEnvio={v.permisos.envio} />}
          </div>
        ))}
      </section>

      <section className="ed-seccion" aria-labelledby="ed-crudos">
        <h2 id="ed-crudos">Crudos <span className="ed-contador">{v.crudos.length}</span></h2>
        <ListaCrudos archivos={v.crudos} videos={v.videosAsignables} puedeVincular={v.permisos.vincular} demo={c.demo} tipo="crudo" vacio="Todavía no llegaron crudos a «Crudos - …»." />
      </section>

      <section className="ed-seccion" aria-labelledby="ed-editados">
        <h2 id="ed-editados">Editados <span className="ed-contador">{v.editados.length}</span></h2>
        <ListaCrudos archivos={v.editados} videos={v.videosAsignables} puedeVincular={v.permisos.vincular} demo={c.demo} tipo="editado" vacio="Sin archivos en «Editados - …»." />
      </section>

      {v.subidas.length > 0 && (
        <section className="ed-seccion" aria-labelledby="ed-subidas">
          <h2 id="ed-subidas">Subidas</h2>
          <ul className="ed-historial">
            {v.subidas.map(s => (
              <li key={s.id}><time>{s.desde}</time><span><strong>{s.tipo}</strong> · {s.archivos} archivo{s.archivos === 1 ? '' : 's'} · {s.subio} · {s.estado}{s.resumen ? ` · ${s.resumen}` : ''}</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="ed-seccion" aria-labelledby="ed-marca">
        <h2 id="ed-marca">Ficha de marca</h2>
        <Paleta m={v.marca} />
        {v.permisos.marca && <FormMarca idCrm={idCrm} ficha={v.marcaFicha} lecturas={lecturas} demo={c.demo} />}
      </section>
    </div>
  )
}
