import type { InputHTMLAttributes } from 'react'
import { clases } from './clases'

// Campo de búsqueda con solo borde inferior. La etiqueta es para lectores de pantalla (no se ve).
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { etiqueta?: string }

export function CampoBusqueda({ etiqueta = 'Buscar', className, placeholder = 'Buscar', ...resto }: Props) {
  return (
    <label className={clases('cj-campo', className)}>
      <span className="cj-solo-lectores">{etiqueta}</span>
      <input type="search" className="cj-campo__entrada" placeholder={placeholder} autoComplete="off" {...resto} />
    </label>
  )
}
