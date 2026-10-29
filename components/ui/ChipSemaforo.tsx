import type { ReactNode } from 'react'
import { clases } from './clases'

// Semáforo sin emojis: cuadradito sólido + palabra. Colores derivados de la paleta (ver cj.css).
// Regla de vencimiento: verde = fin a más de 14 días, amarillo = 14 días o menos, rojo = vencido sin renovar,
// gris = sin fecha. Para otros semáforos se puede pasar otro texto en children.
export type EstadoSemaforo = 'verde' | 'amarillo' | 'rojo' | 'gris'

const PALABRA: Record<EstadoSemaforo, string> = {
  verde: 'Al día',
  amarillo: 'Por vencer',
  rojo: 'Vencido',
  gris: 'Sin fecha',
}

export function ChipSemaforo({ estado, children, className }: { estado: EstadoSemaforo; children?: ReactNode; className?: string }) {
  return <span className={clases('cj-semaforo', `cj-semaforo--${estado}`, className)}>{children ?? PALABRA[estado]}</span>
}
