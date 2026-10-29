import type { ReactNode } from 'react'
import { Filete, SeccionTitulo } from '@/components/ui'

// Una sección de la ficha: filete fino arriba, etiqueta latón + título Bodoni (dos jerarquías) y el contenido.
// `id` (25/10/2026): ancla para los accesos del resumen de la ficha (#cobros, #creditos, #como-le-va)
export function SeccionFicha({ etiqueta, titulo, id, children }: { etiqueta: string; titulo: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="cj-ficha-seccion" aria-label={titulo}>
      <Filete fuerte />
      <SeccionTitulo etiqueta={etiqueta} titulo={titulo} nivel={2} />
      {children}
    </section>
  )
}
