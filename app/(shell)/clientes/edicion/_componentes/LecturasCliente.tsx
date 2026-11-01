import Link from 'next/link'
import type { VistaLectura } from '@/lib/edicion/vistaLecturas'
import { BotonAccion } from './BotonAccion'

// f05 / f06: lo que el cliente escribió en su grupo Contenido y cómo lo leyó el bot. Todo es una propuesta: el OK se
// confirma con un botón (con la cita del mensaje) y los cambios esperan en el pedido del video, para tildar las notas.
// René no ve esta sección (P6: no recibe pedidos del cliente, solo notas confirmadas).
type Props = { lecturas: VistaLectura[]; demo: boolean; puede: boolean }

const MARCA: Record<VistaLectura['estado'], { texto: string; clase: string }> = {
  ok_pendiente: { texto: 'OK por confirmar', clase: 'ed-marca ed-marca--laton' },
  pedido: { texto: 'Notas propuestas', clase: 'ed-marca ed-marca--laton' },
  sin_video: { texto: 'Falta elegir el video', clase: 'ed-marca ed-marca--alerta' },
  resuelta: { texto: 'Resuelto', clase: 'ed-marca ed-marca--ok' },
  descartada: { texto: 'Descartado', clase: 'ed-marca' },
}

export function LecturasCliente({ lecturas, demo, puede }: Props) {
  if (!lecturas.length) return <p className="ed-vacio">El bot todavía no leyó mensajes del grupo Contenido sobre videos entregados.</p>
  return (
    <ul className="ed-guiones">
      {lecturas.map(l => {
        const abierta = l.estado === 'ok_pendiente' || l.estado === 'pedido' || l.estado === 'sin_video'
        const n = l.okItems.length
        return (
          <li key={l.id} className="ed-pedido">
            <p className="cj-etiqueta cj-etiqueta--laton">{l.etiqueta} · {l.cuando} <span className={MARCA[l.estado].clase}>{MARCA[l.estado].texto}</span></p>
            <p className="ed-cita">{l.texto}</p>
            {l.resumen && <p className="ed-sub">El bot entendió: {l.resumen}</p>}
            {l.videos.length > 0 && <p className="ed-sub">Videos: {l.videos.map((v, i) => <span key={v.id}>{i ? ', ' : ''}<Link href={v.href} className="ed-link">{v.nombre}</Link></span>)}</p>}
            {abierta && l.sentido === 'revisar' && <p className="ed-interno"><strong>Mirarlo</strong>{l.motivo || 'El bot no está seguro de haberlo entendido.'}</p>}
            {abierta && puede && (
              <div className="ed-botones">
                {n > 0 && (
                  <BotonAccion demo={demo} variante="primario"
                    etiqueta={n === 1 ? 'Confirmar el OK' : `Confirmar el OK de los ${n}`}
                    confirmar={`¿El cliente dio el OK a ${n === 1 ? l.videos.find(v => v.id === l.okItems[0].video_id)?.nombre ?? 'este video' : `estos ${n} videos`}? Pasa${n === 1 ? '' : 'n'} a Aprobado y le avisamos a Valen.`}
                    cuerpo={n === 1 ? { accion: 'mover', video_id: l.okItems[0].video_id, version: l.okItems[0].version, transicion: 'ok_cliente', cita: l.cita } : { accion: 'mover_lote', transicion: 'ok_cliente', items: l.okItems, cita: l.cita }} />
                )}
                {l.pedidoHref && <Link href={l.pedidoHref} className="cj-boton cj-boton--primario">Revisar las notas</Link>}
                {l.estado === 'sin_video' && <span className="ed-sub">Abrí el video que corresponde y pegá este mensaje en «Pedido del cliente» (o confirmá el OK desde ahí).</span>}
                <BotonAccion demo={demo} etiqueta={l.estado === 'sin_video' ? 'Ya lo cargué' : 'Descartar'} cuerpo={{ accion: 'lectura_resolver', lectura_id: l.id, version: l.version, estado: l.estado === 'sin_video' ? 'usada' : 'descartada' }} />
              </div>
            )}
            {!abierta && l.resueltaPor && <p className="ed-sub">Lo cerró {l.resueltaPor}.</p>}
          </li>
        )
      })}
    </ul>
  )
}
