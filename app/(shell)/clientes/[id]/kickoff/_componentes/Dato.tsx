import type { DatoVista, Momento as MomentoVista } from '@/lib/bot/kickoff/vista'

// El "▶ minuto" de un dato: abre la grabación en Fathom en ese segundo (≈ = estimado dentro de un renglón largo de Fathom).
export function Momento({ m, que }: { m: MomentoVista; que?: string }) {
  return (
    <a className="ko-momento" href={m.href} target="_blank" rel="noopener noreferrer"
      aria-label={`Ver en Fathom${que ? ` «${que.slice(0, 60)}»` : ''}, minuto ${m.aprox ? 'aproximado ' : ''}${m.etiqueta.replace('≈', '')}`}>
      ▶ {m.etiqueta}
    </a>
  )
}

/** La evidencia de un dato: ▶ minuto y la cita textual (o "no textual" si Claude la parafraseó). */
export function Evidencia({ d }: { d: DatoVista }) {
  if (!d.momento && !d.cita) return null
  return (
    <p className="ko-dato__evidencia">
      {d.momento && <Momento m={d.momento} que={d.texto} />}
      {d.cita && <q className="ko-cita">{d.cita}</q>}
      {d.cita && !d.textual && <span>(no textual)</span>}
    </p>
  )
}

/** Un dato de la llamada: el texto (con un agregado opcional) y debajo su evidencia. */
export function Dato({ d, extra }: { d: DatoVista; extra?: string }) {
  return (
    <div className="ko-dato">
      <p className="ko-dato__texto">
        {d.texto}
        {extra && <span className="cj-texto-2"> · {extra}</span>}
      </p>
      <Evidencia d={d} />
    </div>
  )
}

/** Una lista de datos, o la frase de "no hay". */
export function ListaDatos({ datos, vacio, extra }: { datos: (DatoVista & { motivo?: string })[]; vacio: string; extra?: (d: DatoVista & { motivo?: string }) => string | undefined }) {
  if (!datos.length) return <p className="ko-vacio">{vacio}</p>
  return (
    <ul className="ko-datos">
      {datos.map((d, i) => (
        <li key={`${i}-${d.texto.slice(0, 20)}`}>
          <Dato d={d} extra={extra?.(d)} />
        </li>
      ))}
    </ul>
  )
}
