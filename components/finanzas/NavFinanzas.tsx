import Link from 'next/link'
import { VISTAS_SKWD } from './skwd/vistas'

/** Pestañas de Finanzas: Resumen (planilla) y las pantallas de la base de Finanzas SKWD. Estilos en skwd/estilos.tsx. */
export function NavFinanzas({ actual, base = '/finanzas' }: { actual: string; base?: string }) {
  const items: readonly (readonly [string, string])[] = [['resumen', 'Resumen'], ...VISTAS_SKWD]
  return (
    <nav className="fin-nav no-print" aria-label="Secciones de Finanzas">
      {items.map(([id, nombre]) => (
        <Link key={id} href={id === 'resumen' ? base : `${base}/${id}`} aria-current={actual === id ? 'page' : undefined}>
          {nombre}
        </Link>
      ))}
      {/* En el diseño clásico (/finanzas/clasico): volver al diseño de cristal, que es el de /finanzas */}
      {base !== '/finanzas' && <Link href={actual === 'resumen' ? '/finanzas' : `/finanzas/${actual}`}>Diseño nuevo →</Link>}
    </nav>
  )
}
