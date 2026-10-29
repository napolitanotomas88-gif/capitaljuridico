import { clases } from './clases'

// Filete fino (hairline). "fuerte" usa el 22% de hueso en vez del 12%.
export function Filete({ fuerte = false, className }: { fuerte?: boolean; className?: string }) {
  return <hr className={clases('cj-filete', fuerte && 'cj-filete--fuerte', className)} />
}
