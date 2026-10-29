import type { FaltanteVista, VistaKickoff } from '@/lib/bot/kickoff/vista'
import { Momento } from './Dato'
import { MarcaFaltante } from './MarcaFaltante'

// "Falta completar": lo que calculó ficha.ts, con lo del portfolio rehecho según los tildes. Cada faltante con clave se
// puede marcar como hecho con una nota (faltantes_checks): pasa a "Hechos" y el número baja; así una ficha de hace una
// semana no queda en amarillo para siempre. La zona del mapa lleva su ▶ (uno solo: el texto ya no lo repite) y, si el mapa
// del video pide revisar algo que se había anotado a mano antes, esa nota como contexto. Los del portfolio que se tildan
// (Instagram, WhatsApp…) se resuelven en la tabla del portfolio, no acá.
type Props = { v: Pick<VistaKickoff, 'faltantes' | 'hechos'>; idCliente: string; recordingId: number; demo: boolean }

function Item({ x, idCliente, recordingId, demo }: { x: FaltanteVista; idCliente: string; recordingId: number; demo: boolean }) {
  return (
    <li className="ko-faltante">
      <p className="ko-dato__texto">
        {x.texto}
        {x.momento && <> <Momento m={x.momento} que={x.texto} /></>}
      </p>
      {x.contexto && <p className="ko-sub">{x.contexto}</p>}
      {x.marca?.nota && <p className="ko-sub">Nota: {x.marca.nota}</p>}
      {x.clave && (
        <MarcaFaltante idCliente={idCliente} recordingId={recordingId} clave={x.clave} demo={demo}
          actual={x.marca ? { nota: x.marca.nota, quien: x.marca.quien, cuandoTexto: x.marca.cuandoTexto, cuando: x.marca.cuando } : null} />
      )}
    </li>
  )
}

export function Faltantes({ v, idCliente, recordingId, demo }: Props) {
  return (
    <>
      {v.faltantes.length ? (
        <div className="cj-aviso ko-faltantes" role="status">
          <h2>Falta completar ({v.faltantes.length})</h2>
          <ul>{v.faltantes.map(x => <Item key={x.texto} x={x} idCliente={idCliente} recordingId={recordingId} demo={demo} />)}</ul>
        </div>
      ) : (
        <div className="cj-panel ko-faltantes"><p>Nada para completar: la ficha quedó completa.</p></div>
      )}
      {v.hechos.length > 0 && (
        <details className="cj-detalles ko-hechos">
          <summary className="cj-etiqueta">Hechos ({v.hechos.length})</summary>
          <ul>{v.hechos.map(x => <Item key={x.texto} x={x} idCliente={idCliente} recordingId={recordingId} demo={demo} />)}</ul>
        </details>
      )}
    </>
  )
}
