import type { ReactNode } from 'react'
import { clases } from './clases'

// Estado vacío: una frase y, si hay algo para hacer, una acción (un Boton o BotonEnlace).
export function Vacio({ frase, accion, className }: { frase: string; accion?: ReactNode; className?: string }) {
  return (
    <div className={clases('cj-vacio', className)}>
      <p>{frase}</p>
      {accion}
    </div>
  )
}
