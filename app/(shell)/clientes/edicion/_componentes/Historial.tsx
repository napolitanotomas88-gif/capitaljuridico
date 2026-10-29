import type { FilaHistorial } from '@/lib/edicion/vista'

/** El historial del video: cuándo, quién (por su nombre, nunca el mail) y qué. Lo que ClickUp no guardaba. */
export function Historial({ filas }: { filas: FilaHistorial[] }) {
  if (!filas.length) return <p className="ed-vacio">Sin movimientos todavía.</p>
  return (
    <ol className="ed-historial">
      {filas.map(f => (
        <li key={f.id}>
          <time>{f.cuando}</time>
          <span><strong>{f.quien}</strong> · {f.texto}{f.nota ? <><br /><span className="ed-sub">{f.nota}</span></> : null}</span>
        </li>
      ))}
    </ol>
  )
}
