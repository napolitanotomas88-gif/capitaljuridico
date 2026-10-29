import type { ElementType, ReactNode } from 'react'
import { clases } from './clases'

// Etiqueta de sistema: 11px, mayúscula, tracking .16em. En latón solo para etiquetas de sección.
type Props = {
  children: ReactNode
  tono?: 'humo' | 'laton'
  como?: ElementType
  className?: string
}

export function Etiqueta({ children, tono = 'humo', como: Tag = 'span', className }: Props) {
  return <Tag className={clases('cj-etiqueta', tono === 'laton' && 'cj-etiqueta--laton', className)}>{children}</Tag>
}
