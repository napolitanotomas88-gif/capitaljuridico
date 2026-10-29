import type { ReactNode } from 'react'
import { clases } from './clases'

// Etiqueta latón + título Bodoni: dos jerarquías, ninguna más. "acciones" va a la derecha (botones, filtros).
type Props = {
  etiqueta: string
  titulo: string
  /** 1 = título de página (h1, grande); 2 = título de sección (h2, más chico) */
  nivel?: 1 | 2
  acciones?: ReactNode
  className?: string
}

export function SeccionTitulo({ etiqueta, titulo, nivel = 1, acciones, className }: Props) {
  const Titulo = nivel === 1 ? 'h1' : 'h2'
  return (
    <header className={clases('cj-seccion', className)}>
      <div className="cj-seccion__texto">
        <span className="cj-etiqueta cj-etiqueta--laton">{etiqueta}</span>
        <Titulo className={clases('cj-titulo', nivel === 2 && 'cj-titulo--seccion')}>{titulo}</Titulo>
      </div>
      {acciones}
    </header>
  )
}
