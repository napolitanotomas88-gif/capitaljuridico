import Link from 'next/link'

// Fila del Doc de guiones del cliente (2/11/2026, Tomás: «la franja está vacía, solo el título y una raya»). Va en la tarjeta
// de la cartera y en la ficha completa: con el link si el Doc está; si no, «Sin documento de guiones» y adónde ir.
// Estilos en components/shell/cristal.css (.rc-doc).
/** El Doc de guiones del cliente: con link si está; si no, «Sin documento» y adónde ir (2/11/2026: antes era un rótulo suelto). */
export function DocGuiones({ url, guionesHref }: { url: string | null; guionesHref: string | null }) {
  const icono = (
    <span className="rc-doc__ico" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
    </span>
  )
  if (url) {
    return (
      <div className="rc-doc">
        {icono}
        <div className="rc-doc__textos">
          <span className="rc-doc__titulo">Documento de guiones del cliente</span>
          <span className="rc-doc__detalle">Google Docs: los guiones de todas las tandas</span>
        </div>
        <a className="rc-doc__accion" href={url} target="_blank" rel="noreferrer">Abrir el Doc <span aria-hidden="true">↗</span><span className="cj-solo-lectores"> (se abre en otra pestaña)</span></a>
      </div>
    )
  }
  return (
    <div className="rc-doc rc-doc--vacio">
      {icono}
      <div className="rc-doc__textos">
        <span className="rc-doc__titulo">Sin documento de guiones</span>
        <span className="rc-doc__detalle">Todavía no hay un Doc vinculado a este cliente (o Drive tardó en responder).</span>
      </div>
      {guionesHref && <Link className="rc-doc__accion" href={guionesHref}>Ir a Guiones</Link>}
    </div>
  )
}
