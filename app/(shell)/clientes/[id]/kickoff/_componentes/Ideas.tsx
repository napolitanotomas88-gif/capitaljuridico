import { ChipSemaforo, Etiqueta } from '@/components/ui'
import { entreComillas } from '@/lib/bot/kickoff/ficha'
import type { ClaveRevisor } from '@/lib/bot/kickoff/revision'
import type { RevisorVista, VistaKickoff } from '@/lib/bot/kickoff/vista'
import { SeccionFicha } from '../../_componentes/SeccionFicha'
import { RevisionIdeas, type RevisorPropio } from './RevisionIdeas'

// Ideas de guiones (c06) y su revisión: el estado de Tomi y de Gero M (con su historial: "pidió cambios el … → aprobó el
// …"), las 6 ideas (título, gancho, ángulo, subrama y en qué ganador se apoyan) y, si quien entró es uno de los dos, los
// botones para aprobar o pedir cambios. Una revisión de otra versión de las ideas (el bot las rehizo) no cuenta: se
// muestra como "anterior". A quien no es revisor se le dice con qué nombre entró y qué variable falta cargar si es uno de
// ellos (en producción, sin KICKOFF_REVISOR_TOMI / _GERO_M nadie aprueba: falla cerrado). Nunca su mail.
const TONO = { pendiente: 'gris', aprobada: 'verde', cambios: 'rojo' } as const
const TEXTO = { pendiente: 'Pendiente', aprobada: 'Aprobó', cambios: 'Pidió cambios' } as const

const propio = (r: RevisorVista): RevisorPropio => ({ clave: r.clave, nombre: r.nombre, estado: r.estado, comentario: r.comentario, cuandoTexto: r.cuandoTexto, previo: r.previo })

type Props = { i: VistaKickoff['ideas']; idCliente: string; recordingId: number; revisor: ClaveRevisor | null; nombreSesion: string | null; demo: boolean }

export function Ideas({ i, idCliente, recordingId, revisor, nombreSesion, demo }: Props) {
  const mio = i.revisores.find(r => r.clave === revisor)
  const hay = i.lista.length > 0
  return (
    <SeccionFicha etiqueta="Ideas de guiones" titulo={hay ? `${i.lista.length} ideas` : 'Sin ideas'}>
      {/* 27/10: la tanda de guiones arranca sola con la ficha lista; la revisión de las ideas queda como comentario */}
      {hay && <p className="ko-sub">Los guiones ya se escriben con estas ideas: aprobar o pedir cambios queda como comentario para la etapa Guiones.</p>}
      <p className="ko-dato__texto">{i.texto}</p>
      {hay && (
        <ul className="ko-revisores" aria-label="Revisión de Tomi y Gero M">
          {i.revisores.map(r => (
            <li key={r.clave}>
              <ChipSemaforo estado={TONO[r.estado]}>{`${r.nombre}: ${TEXTO[r.estado]}`}</ChipSemaforo>
              {r.cuandoTexto && <span className="ko-sub">{r.cuandoTexto}</span>}
              {r.comentario && <span className="ko-dato__texto">«{r.comentario}»</span>}
              {r.anterior && <span className="ko-sub">Antes {r.anterior}: no cuenta.</span>}
              {r.historial.length > 0 && (
                <details className="ko-historial">
                  <summary className="ko-sub">Historial ({r.historial.length})</summary>
                  <ul>{r.historial.map(h => <li key={h} className="ko-sub">{h}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {!hay && i.motivo && <p className="ko-vacio">Motivo: {i.motivo}</p>}
      {hay && (
        <ol className="ko-ideas">
          {i.lista.map(x => (
            <li key={x.n} className="ko-idea">
              <Etiqueta tono="laton">{`Idea ${x.n}${x.subrama ? ` · ${x.subrama}` : ''}`}</Etiqueta>
              <h3 className="ko-idea__titulo">{x.titulo}</h3>
              <p className="ko-gancho">{entreComillas(x.gancho)}</p>
              <dl>
                <div>
                  <dt className="cj-etiqueta">Ángulo</dt>
                  <dd>{x.angulo}</dd>
                </div>
                <div>
                  <dt className="cj-etiqueta">En qué se apoya</dt>
                  <dd>{x.por_que}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}
      {i.notas && (
        <div className="ko-grupo">
          <Etiqueta como="h3">Notas de Claude</Etiqueta>
          <p className="ko-dato__texto">{i.notas}</p>
        </div>
      )}
      {hay && demo && <RevisionIdeas idCliente={idCliente} recordingId={recordingId} revisores={i.revisores.map(propio)} huella={i.huella} demo />}
      {hay && !demo && mio && <RevisionIdeas idCliente={idCliente} recordingId={recordingId} revisores={[propio(mio)]} huella={i.huella} demo={false} />}
      {hay && !demo && !mio && (
        <p className="ko-sub">
          {`Entraste como ${nombreSesion || 'otro usuario'}: solo Tomi y Gero M aprueban las ideas. Si sos uno de ellos, falta cargar tu mail de entrada en KICKOFF_REVISOR_TOMI o KICKOFF_REVISOR_GERO_M (Vercel).`}
        </p>
      )}
    </SeccionFicha>
  )
}
