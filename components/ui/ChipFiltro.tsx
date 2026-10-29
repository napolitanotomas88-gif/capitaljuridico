import type { ButtonHTMLAttributes } from 'react'
import { clases } from './clases'

// Chip de filtro: botón con aria-pressed (activo = hueso sobre tinta).
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & { activo: boolean }

export function ChipFiltro({ activo, className, type = 'button', children, ...resto }: Props) {
  return (
    <button type={type} aria-pressed={activo} className={clases('cj-chip', className)} {...resto}>
      {children}
    </button>
  )
}
