import { ChipSemaforo } from '@/components/ui'
import type { VistaKickoff } from '@/lib/bot/kickoff/vista'
import { SeccionFicha } from '../../_componentes/SeccionFicha'
import { Evidencia } from './Dato'
import { TildePortfolio } from './TildePortfolio'

// Portfolio (c01): los 7 ítems fijos con el estado final (Meta cruzado con la llamada, portfolio_final de la ficha), de dónde
// salió, el detalle y, si la llamada dijo otra cosa que Meta, el "ojo". Lo que ni Meta ni la llamada resolvieron se tilda a
// mano acá mismo (el tilde manda sobre "sin dato" en lo que se ve). Abajo, qué cuenta se revisó en Meta y el aviso de Meta.
export function Portfolio({ p, idCliente, recordingId, demo, puedeTildar }: { p: VistaKickoff['portfolio']; idCliente: string; recordingId: number; demo: boolean; puedeTildar: boolean }) {
  return (
    <SeccionFicha etiqueta="Portfolio" titulo="Cuenta, página y accesos">
      <p className="ko-dato__texto">{p.resumen.texto}</p>
      <ul className="ko-portfolio">
        {p.filas.map(x => (
          <li key={x.item}>
            <div className="ko-portfolio__item">
              <p className="ko-portfolio__nombre">{x.nombre}</p>
              <ChipSemaforo estado={x.visto.tono}>{x.visto.texto}</ChipSemaforo>
              <span className="ko-sub">Fuente: {x.visto.aMano ? 'a mano' : x.etiquetaFuente === '—' ? 'ni Meta ni la llamada' : x.etiquetaFuente}</span>
            </div>
            <div className="ko-portfolio__detalle">
              {x.detalle ? <p>{x.detalle}</p> : <p className="cj-texto-2">Sin detalle.</p>}
              {x.discrepancia && <p className="ko-ojo">Ojo: {x.discrepancia}</p>}
              {x.dato && <Evidencia d={x.dato} />}
            </div>
            <div>
              {x.tildable && puedeTildar && (
                <TildePortfolio idCliente={idCliente} recordingId={recordingId} item={x.item} nombre={x.nombre} demo={demo}
                  actual={x.check ? { valor: x.check.valor, nota: x.check.nota, quien: x.check.quien, cuandoTexto: x.check.cuandoTexto, cuando: x.check.cuando } : null} />
              )}
              {!x.tildable && x.check && (
                <p className="ko-sub">
                  Tildado a mano antes («{x.check.etiqueta.toLowerCase()}», {x.check.quien}{x.check.cuandoTexto ? ` · ${x.check.cuandoTexto}` : ''}): ahora lo resuelve {x.etiquetaFuente === 'Meta' ? 'Meta' : 'la llamada'}.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ul className="ko-pie">
        {p.meta.lineas.map(l => <li key={l}>{l}</li>)}
        {p.meta.aviso && <li><strong>Qué hacer según Meta:</strong> {p.meta.aviso}</li>}
      </ul>
    </SeccionFicha>
  )
}
