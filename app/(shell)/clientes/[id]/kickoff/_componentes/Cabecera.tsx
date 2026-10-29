import Link from 'next/link'
import { ChipSemaforo, SeccionTitulo } from '@/components/ui'
import type { GemelaVista, OpcionFicha, Tono, VistaKickoff } from '@/lib/bot/kickoff/vista'

// Cabecera de la ficha de kickoff: cliente, cuándo fue la llamada, con qué Fathom se grabó, link a Fathom, estado de la
// ficha y de la revisión de las ideas, el selector cuando el cliente tiene más de una llamada registrada y, si la grabación
// cortó bastante antes de lo agendado, esa nota (no es un faltante: quien hizo la llamada sabe si hubo algo después).
// "Grabada con el Fathom de" (no "la hizo"): si los dos la grabaron, gana la que llegó primero, que no es necesariamente la
// de quien llevó la llamada. La otra grabación de la misma reunión (quedó "duplicada", sin ficha propia) se nombra con su
// link: así no parece que se perdió.
const TONO_IDEAS: Record<VistaKickoff['ideas']['general'], Tono> = { sin_ideas: 'gris', pendiente: 'amarillo', a_medias: 'amarillo', cambios: 'rojo', aprobadas: 'verde' }
const TEXTO_IDEAS: Record<VistaKickoff['ideas']['general'], string> = { sin_ideas: 'Sin ideas', pendiente: 'Ideas a revisar', a_medias: 'Ideas a medio aprobar', cambios: 'Ideas con cambios', aprobadas: 'Ideas aprobadas' }

export function Cabecera({ v, idCliente, volver, opciones, sufijo, gemelas = [] }: { v: VistaKickoff; idCliente: string; volver: string; opciones: OpcionFicha[]; sufijo: string; gemelas?: GemelaVista[] }) {
  const e = v.encabezado
  return (
    <div className="ko-cabecera">
      <Link href={volver} className="cj-enlace" style={{ alignSelf: 'flex-start' }}>
        Volver a la ficha del cliente
      </Link>
      <SeccionTitulo etiqueta={`Kickoff · Cliente ${e.idCrm ?? idCliente}`} titulo={e.verificado ? e.cliente : `${e.cliente} (sin verificar)`} />
      <p className="ko-cabecera__fila">
        <ChipSemaforo estado={v.registro.tono}>{v.registro.etiqueta}</ChipSemaforo>
        {e.esKickoff && <ChipSemaforo estado={TONO_IDEAS[v.ideas.general]}>{TEXTO_IDEAS[v.ideas.general]}</ChipSemaforo>}
        {e.fecha && <span className="cj-num">{e.fecha}</span>}
        <span>{e.quien ? `Grabada con el Fathom de ${e.quien}` : 'Sin dato de con qué Fathom se grabó'}</span>
        {e.fathom && (
          <a className="cj-enlace" href={e.fathom} target="_blank" rel="noopener noreferrer">
            Abrir la llamada en Fathom
          </a>
        )}
      </p>
      <p className="ko-cabecera__fila cj-texto-2">
        <span>«{e.titulo}»</span>
        {e.apodo && <span>Le dicen «{e.apodo}»</span>}
        <span>{e.como}</span>
      </p>
      {gemelas.map(g => (
        <p key={g.recording_id} className="ko-sub" role="note">
          También la grabó {g.quien}
          {g.fathom ? <> (<a className="cj-enlace" href={g.fathom} target="_blank" rel="noopener noreferrer">Fathom</a>)</> : null}
          : es la misma reunión, no se procesa aparte.
        </p>
      ))}
      {e.resumen && <p className="ko-resumen">{e.resumen}</p>}
      {e.corte && <p className="ko-sub" role="note">⏱️ {e.corte}: si después se habló o se hizo algo más, no está en la ficha.</p>}
      {opciones.length > 1 && (
        <nav className="ko-selector" aria-label="Fichas de este cliente">
          <span className="cj-etiqueta">Llamadas registradas ({opciones.length})</span>
          <ul>
            {opciones.map(o => (
              <li key={o.recording_id}>
                <Link href={`/clientes/${encodeURIComponent(idCliente)}/kickoff?${sufijo ? `${sufijo}&` : ''}grabacion=${o.recording_id}`} className="cj-chip ko-selector__opcion" aria-current={o.actual ? 'page' : undefined}>
                  {o.etiqueta}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {v.registro.aviso && (
        <div className={v.registro.tono === 'rojo' ? 'cj-aviso' : 'cj-panel'} role="status">
          <p>{v.registro.aviso}</p>
        </div>
      )}
      {v.ideas.desdeRegistro && (
        <div className="cj-panel" role="note">
          <p>Las ideas de abajo salieron antes de que la ficha quedara terminada (se guardaron aparte apenas Claude las devolvió).</p>
        </div>
      )}
    </div>
  )
}
