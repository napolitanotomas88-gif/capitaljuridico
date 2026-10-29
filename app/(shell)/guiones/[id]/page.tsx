import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BotonEnlace, SeccionTitulo, Vacio } from '@/components/ui'
import { exigirAcceso } from '@/lib/auth/sesion'
import { ID_CLIENTE_VALIDO } from '@/lib/clientes/ficha'
import { baseConfigurada, tandasDelCliente, type FilaTanda } from '@/lib/bot/guiones/registro'
import { documentoVinculadoCliente, asegurarDocumentoCliente } from '@/lib/bot/guiones/documento'
import { asegurarVinculoTanda } from '@/lib/bot/guiones/vinculo'
import { esAprobador } from '@/lib/bot/guiones/aprobadores'
import { largoHablado } from '@/lib/bot/guiones/revisar'
import { Tanda, type TandaVista } from './_componentes/Tanda'
import { leerArchivados } from '@/lib/clientes/archivados'
import { puedeHacerAcciones } from '@/lib/clientes/acciones/permisos'
import './guiones.css'

// Tanda de guiones de un cliente (/guiones/<id>) (etapa Guiones del bot Capital Jurídico, docs/BOT-GUIONES-CJ.md). La arma el bot apenas
// el kickoff tiene sus ideas (27/10: sin esperar la aprobación) y la guarda en Neon (cj_guiones); el aviso al equipo linkea acá.
// Tomi o Faus verifican guion por guion (editan texto e indicaciones; editar saca el «✓ Verificado»), y UNO de los dos da el
// check final con todos verificados (el bot la escribe en el Doc del cliente y avisa al grupo Contenido)
// y cargan o revisan las notas del cliente, que el bot aplica (vuelve a revisión). Permiso: la sección Guiones (Faus la ve sin ver la ficha del cliente, que muestra cobros).

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: ID_CLIENTE_VALIDO.test(id) ? `Guiones ${id.toUpperCase()}` : 'Guiones' }
}

const ESTADO: Record<string, string> = {
  pendiente: 'Esperando a la Mac de Tomás (se arma con el plan Max)',
  mercado: 'Analizando el mercado de la zona', plan: 'Planificando la tanda', escribiendo: 'Escribiendo los guiones',
  a_revisar: 'Lista para revisar', aprobada: 'Aprobada · escribiendo en el Doc', enviada: 'Entrega al cliente confirmada',
  con_notas: 'El cliente respondió', corrigiendo: 'El bot está corrigiendo con lo que pidió el cliente', error: 'Se frenó',
}

function vista(f: FilaTanda): TandaVista {
  const guiones = Object.values(f.guiones).sort((a, b) => a.guion.numero - b.guion.numero).map(g => ({
    numero: g.guion.numero, titulo: g.guion.titulo, formato: g.guion.formato, utileria: g.guion.utileria, secciones: g.guion.secciones,
    ganchos: g.guion.ganchos_alternativos, verificar: g.guion.verificar, largo: largoHablado(g.guion), editado: g.editado?.quien ?? null, estado: g.estado, verificado: g.verificado?.quien ?? null,
  }))
  return {
    id: f.id, tanda: f.tanda, estado: f.estado, error: f.error, previo: f.actualizado,
    estadoTexto: f.estado === 'aprobada' && f.doc?.publicacion ? `Publicación pendiente: ${f.doc.publicacion.motivo ?? 'preparando el documento'}` : f.estado === 'aprobada' && f.doc?.publicada === f.aprobacion?.cuando ? 'Escrita en el Doc · Aylu/Gero deben entregar el link' : f.estado === 'a_revisar' && f.notas.some(n => n.aplicada) ? 'Corregida con lo que pidió el cliente · lista para revisar' : ESTADO[f.estado] ?? f.estado,
    esperandoMac: f.estado === 'pendiente' && Date.now() - Date.parse(f.actualizado) > 2 * 3600_000,
    colgada: ['mercado', 'plan', 'escribiendo', 'con_notas', 'corrigiendo'].includes(f.estado) && Date.now() - Date.parse(f.actualizado) > 6 * 60_000,
    total: f.plan?.length ?? 0, guiones, aprobacion: f.aprobacion ? `${f.aprobacion.quien}` : null,
    docPendiente: f.documento_pendiente ?? null, doc: f.doc?.url ?? null, whatsapp: !!f.whatsapp, notas: f.notas.map(n => ({ id: n.id, texto: n.texto, guion: n.guion, aplicada: !!n.aplicada, guiones: n.guiones ?? [], origen: n.origen })), tieneDoc: !!f.doc?.id,
  }
}

export default async function GuionesClientePage({ params }: Props) {
  const sesion = await exigirAcceso('guiones')
  const { id } = await params
  if (!ID_CLIENTE_VALIDO.test(id)) notFound()
  const idCrm = id.toUpperCase()
  const volver = `/clientes/${encodeURIComponent(idCrm)}`
  let filas: FilaTanda[] = []
  let falla: string | null = null
  let soloLectura = true, motivoLectura: string | null = null
  try {
    soloLectura = (await leerArchivados()).has(idCrm)
    if (soloLectura) motivoLectura = 'Cliente archivado: sus guiones se conservan como historial. Restauralo para retomar acciones.'
  } catch { motivoLectura = 'No se pudo verificar el estado actual del cliente. El historial está disponible; las acciones esperan la confirmación del CRM.' }
  if (!baseConfigurada()) falla = 'La base del Despacho no está configurada (falta DATABASE_URL).'
  else {
    try { filas = await tandasDelCliente(idCrm) } catch (e) {
      console.error('Guiones: no se pudo leer cj_guiones:', ((e as Error)?.message ?? '').slice(0, 200))
      falla = 'No se pudo leer la base del Despacho. Probá de nuevo en un minuto.'
    }
  }
  if (!soloLectura) filas = await Promise.all(filas.map(f => asegurarVinculoTanda(f)))
  const cabecera = <SeccionTitulo etiqueta={`Guiones · Cliente ${idCrm}`} titulo={filas[0]?.cliente ?? 'Guiones'} acciones={<BotonEnlace href={volver}>Volver a la ficha</BotonEnlace>} />
  if (falla) return <div className="cj-pila">{cabecera}<div className="cj-aviso" role="alert"><p>{falla}</p></div></div>
  if (!filas.length) {
    const puedeVincular = !soloLectura && (esAprobador(sesion.email) || puedeHacerAcciones(sesion.email))
    const { documento, pendiente } = await (puedeVincular ? asegurarDocumentoCliente(idCrm) : documentoVinculadoCliente(idCrm)).then(documento => ({ documento, pendiente: false }), () => ({ documento: null, pendiente: puedeVincular }))
    return <div className="cj-pila">{cabecera}{motivoLectura && <p className="cj-aviso" role="status">{motivoLectura}</p>}{documento && <p><a className="cj-enlace" href={documento.url} target="_blank" rel="noreferrer">Abrir el documento de guiones del cliente</a></p>}{pendiente && <p className="cj-aviso" role="status">El documento de guiones todavía no pudo vincularse. El resto de la ficha está disponible.</p>}<Vacio frase="Todavía no hay guiones. Salen solos cuando el kickoff tiene sus ideas." /></div>
  }
  return (
    <div className="cj-pila">
      {cabecera}
      {motivoLectura && <div className="cj-aviso" role="status"><p>{motivoLectura}</p></div>}
      {filas.map(f => <Tanda key={f.id} idCliente={idCrm} t={vista(f)} aprobador={esAprobador(sesion.email)} soloLectura={soloLectura} />)}
    </div>
  )
}
