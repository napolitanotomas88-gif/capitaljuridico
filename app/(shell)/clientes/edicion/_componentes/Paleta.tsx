import type { VistaPaleta } from '@/lib/edicion/vista'

/** Muestras chicas para la tarjeta (con el hex en el title y para lectores de pantalla) o "sin paleta". */
export function PaletaChica({ colores }: { colores: { hex: string; nombre: string }[] | null }) {
  if (colores === null) return <span className="ed-marca ed-marca--laton">sin paleta</span>
  if (!colores.length) return <span className="ed-marca">con paleta</span>
  return (
    <ul className="ed-paleta" aria-label={`Paleta: ${colores.map(c => c.nombre || c.hex).join(', ')}`}>
      {colores.map(c => <li key={c.hex} style={{ background: c.hex }} title={`${c.nombre ? `${c.nombre} ` : ''}${c.hex}`} />)}
    </ul>
  )
}

/** La ficha de marca completa (lectura): colores con nombre y hex, tipografías, logo, referencia, carpeta y de dónde salió. */
export function Paleta({ m }: { m: VistaPaleta }) {
  if (m.vacia) return <p className="ed-vacio">Sin ficha de marca todavía. No frena nada: si falta cuando un video pasa a Para editar, le avisamos a Aylu.</p>
  return (
    <div className="ed-seccion" style={{ gap: 14 }}>
      {m.colores.length > 0 && (
        <ul className="ed-paleta ed-paleta--grande">
          {m.colores.map(c => (
            <li key={c.hex}>
              <span className="ed-muestra" style={{ background: c.hex }} aria-hidden="true" />
              <span><span>{c.nombre || 'Sin nombre'}</span><br /><span className="ed-sub ed-num">{c.hex}</span></span>
            </li>
          ))}
        </ul>
      )}
      <dl className="ed-datos">
        {m.tipografias.length > 0 && <div><dt className="cj-etiqueta">Tipografías</dt><dd>{m.tipografias.join(', ')}</dd></div>}
        {m.logo && <div><dt className="cj-etiqueta">Logo</dt><dd><a className="ed-link" href={m.logo} target="_blank" rel="noopener noreferrer">Abrir el logo</a></dd></div>}
        {m.referencia && <div><dt className="cj-etiqueta">Referencia</dt><dd><a className="ed-link" href={m.referencia.url} target="_blank" rel="noopener noreferrer">{m.referencia.descripcion || 'Abrir la referencia'}</a></dd></div>}
        {m.carpeta && <div><dt className="cj-etiqueta">Carpeta de marca</dt><dd><a className="ed-link" href={m.carpeta} target="_blank" rel="noopener noreferrer">Abrir en Drive</a></dd></div>}
      </dl>
      {m.notas && <p className="ed-parrafo">{m.notas}</p>}
      {m.fuentes.length > 0 && <p className="ed-sub">De dónde salió: {m.fuentes.join(' · ')}</p>}
    </div>
  )
}
