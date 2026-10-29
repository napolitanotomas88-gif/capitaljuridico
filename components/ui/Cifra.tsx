import type { ReactNode } from 'react'
import { clases } from './clases'

// Cifra estilo "expediente": etiqueta chica en latón, cifra grande en Bodoni, contexto corto en humo.
// El contexto lleva la fecha o el período cuando corresponda ("al 6/10/2026", "septiembre 2026").
type Props = {
  etiqueta: string
  valor: ReactNode
  contexto?: ReactNode
  tamano?: 'grande' | 'media'
  className?: string
}

export function Cifra({ etiqueta, valor, contexto, tamano = 'grande', className }: Props) {
  return (
    <dl className={clases('cj-cifra', tamano === 'media' && 'cj-cifra--media', className)}>
      <dt className="cj-etiqueta cj-etiqueta--laton">{etiqueta}</dt>
      <dd className="cj-cifra__valor">{valor}</dd>
      {contexto != null && <dd className="cj-cifra__contexto">{contexto}</dd>}
    </dl>
  )
}
