import Link from 'next/link'
import { Icono } from '@/components/shell/iconos'
import { puedeVer, type Quien } from '@/lib/auth/roles'

// Accesos rápidos de la ficha a lo de ESTE cliente en las otras pestañas del hub (25/10/2026). Cada enlace aparece solo si la
// persona tiene la sección de esa pestaña (la de siempre): no abre nada nuevo, solo ahorra buscar al cliente otra vez.
export function enlacesDelCliente(quien: Quien, id: string): { etiqueta: string; href: string; icono: string }[] {
  const enc = encodeURIComponent(id)
  return [
    { etiqueta: 'Kickoff', href: `/clientes/${enc}/kickoff`, icono: 'tarea', ok: puedeVer(quien, 'clientes') },
    { etiqueta: 'Guiones', href: `/guiones/${enc}`, icono: 'guiones', ok: puedeVer(quien, 'guiones') },
    { etiqueta: 'Edición', href: `/clientes/edicion/cliente/${enc}`, icono: 'edicion', ok: puedeVer(quien, 'edicion') },
  ].filter((e) => e.ok).map(({ etiqueta, href, icono }) => ({ etiqueta, href, icono }))
}

export function AccesosCliente({ quien, id }: { quien: Quien; id: string }) {
  const enlaces = enlacesDelCliente(quien, id)
  if (enlaces.length === 0) return null
  return (
    <nav className="cj-accesos" aria-label="Este cliente en las otras pestañas">
      <span className="cj-accesos__rotulo">Este cliente en</span>
      {enlaces.map((e) => (
        <Link key={e.href} href={e.href} className="cj-accesos__enlace">
          <Icono nombre={e.icono} />
          {e.etiqueta}
        </Link>
      ))}
    </nav>
  )
}
