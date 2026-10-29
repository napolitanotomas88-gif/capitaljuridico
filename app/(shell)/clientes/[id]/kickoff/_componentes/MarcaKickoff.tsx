import Link from 'next/link'
import { SeccionFicha } from '../../_componentes/SeccionFicha'

// e05 de Grabación (26/10/2026): la paleta se pide ANTES de editar. En la ficha de kickoff, un recuadro chico con el estado de
// la ficha de marca del cliente (cj_marca) y de lo que leyó el vigía de su carpeta «Marca» (cj_marca_propuestas), para
// preguntarla en la llamada si falta. Solo lectura: se carga y se confirma en Edición. Si la base falla, la página no lo
// muestra (lo decide page.tsx: estado null).
export type EstadoMarcaKickoff =
  | { tipo: 'cargada'; colores: { hex: string; nombre: string }[] }
  | { tipo: 'propuesta'; colores: { hex: string; nombre: string }[]; archivo: string }
  | { tipo: 'falta'; problema: string | null }

export function MarcaKickoff({ estado, idCliente, sufijo }: { estado: EstadoMarcaKickoff; idCliente: string; sufijo: string }) {
  const href = `/clientes/edicion/cliente/${encodeURIComponent(idCliente)}${sufijo ? `?${sufijo}` : ''}`
  const muestras = (cs: { hex: string; nombre: string }[]) => (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex' }} aria-label={`Paleta: ${cs.map(c => c.nombre || c.hex).join(', ')}`}>
      {cs.map(c => <li key={c.hex} style={{ background: c.hex, display: 'inline-block', width: 22, height: 22, borderRadius: 4, marginRight: 6, border: '1px solid var(--cj-borde, #0002)' }} title={`${c.nombre ? `${c.nombre} ` : ''}${c.hex}`} />)}
    </ul>
  )
  return (
    <SeccionFicha etiqueta="Para la edición" titulo="Marca del cliente">
      {estado.tipo === 'cargada' && (
        <>
          <p>Paleta cargada ✓</p>
          {muestras(estado.colores)}
        </>
      )}
      {estado.tipo === 'propuesta' && (
        <>
          <p>El bot leyó una paleta de «{estado.archivo}» (carpeta Marca). Falta que Aylu la revise y la guarde.</p>
          {muestras(estado.colores)}
        </>
      )}
      {estado.tipo === 'falta' && (
        <p>
          Falta la paleta. Preguntala en la llamada (colores, tipografía, si tiene logo) o pedile que suba el logo a su carpeta «Marca» de Drive.
          {estado.problema ? ` Lo último que subió no sirvió: ${estado.problema}.` : ''}
        </p>
      )}
      <p><Link href={href}>Ver la ficha de marca en Edición</Link></p>
    </SeccionFicha>
  )
}
