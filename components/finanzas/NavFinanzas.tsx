import Link from 'next/link'
import { VISTAS_SKWD } from './skwd/vistas'

/** Pestañas de Finanzas: Resumen (planilla) y las pantallas de la base de Finanzas SKWD. Estilos en skwd/estilos.tsx. */
export function NavFinanzas({ actual }: { actual: string }) {
  const items: readonly (readonly [string, string])[] = [['resumen', 'Resumen'], ...VISTAS_SKWD]
  return (
    <nav className="fin-nav no-print" aria-label="Secciones de Finanzas">
      {items.map(([id, nombre]) => (
        <Link key={id} href={id === 'resumen' ? '/finanzas' : `/finanzas/${id}`} aria-current={actual === id ? 'page' : undefined}>
          {nombre}
        </Link>
      ))}
    </nav>
  )
}
