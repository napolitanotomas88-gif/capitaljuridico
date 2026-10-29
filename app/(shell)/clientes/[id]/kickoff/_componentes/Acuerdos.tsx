import { Etiqueta } from '@/components/ui'
import type { VistaKickoff } from '@/lib/bot/kickoff/vista'
import { SeccionFicha } from '../../_componentes/SeccionFicha'
import { Evidencia } from './Dato'

// Acuerdos (quién, qué y para cuándo, con su ▶ minuto) y pendientes que dejó la llamada.
export function Acuerdos({ acuerdos, pendientes }: { acuerdos: VistaKickoff['acuerdos']; pendientes: string[] }) {
  return (
    <SeccionFicha etiqueta="Acuerdos" titulo="Acuerdos y pendientes">
      {acuerdos.length ? (
        <ul className="cj-lista">
          {acuerdos.map((a, i) => (
            <li key={`${i}-${a.que.slice(0, 20)}`}>
              <div className="ko-dato">
                <p className="ko-dato__texto">
                  <strong>{a.quien || 'Sin responsable'}:</strong> {a.que}
                  {a.cuando && <span className="cj-texto-2"> · para {a.cuando}</span>}
                </p>
                <Evidencia d={a.dato} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ko-vacio">La llamada no dejó acuerdos.</p>
      )}
      <div className="ko-grupo">
        <Etiqueta como="h3">Pendientes</Etiqueta>
        {pendientes.length ? (
          <ul className="cj-lista">
            {pendientes.map(p => <li key={p}>{p}</li>)}
          </ul>
        ) : (
          <p className="ko-vacio">Ninguno.</p>
        )}
      </div>
    </SeccionFicha>
  )
}
