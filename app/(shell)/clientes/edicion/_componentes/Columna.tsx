import type { ColumnaTablero } from '@/lib/edicion/vista'
import { Tarjeta } from './Tarjeta'

/** Una columna del tablero "Por estado" (en el celular queda como un grupo de la lista). */
export function Columna({ c, sufijo }: { c: ColumnaTablero; sufijo: string }) {
  const id = `col-${c.estado}`
  return (
    <section className="ed-columna" aria-labelledby={id}>
      <div className="ed-columna__cab">
        <h3 id={id}>{c.etiqueta}</h3>
        <span className="ed-contador">{c.tarjetas.length}</span>
      </div>
      <ul className="ed-tarjetas">
        {c.tarjetas.map(t => <Tarjeta key={t.id} t={t} sufijo={sufijo} />)}
      </ul>
    </section>
  )
}
