'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { pestanaActiva, type PestanaClientes } from '@/lib/auth/hubClientes'
import { Icono } from './iconos'
import { MenuRapido } from '@/components/clientes/MenuRapido'
import './pestanasClientes.css'
import '@/components/ui/tarjetas.css'
// Cristal del hub (26/10/2026): se carga con las pestañas porque están en todas las páginas del hub
import '@/components/ui/cristal.css'

// Pestañas del hub Clientes (25/10/2026): Cartera, Guiones, Edición, Anuncios y Referidos. Llegan YA filtradas por el
// servidor (lib/auth/hubClientes.ts: pestanasVisibles), así que acá solo se dibujan. Son enlaces entre páginas, no paneles
// de una misma página: por eso van en un <nav> con aria-current y no con role="tablist".
// Escritorio: fila con subrayado latón en la activa. Celular: las pestañas se reparten el ancho (ícono arriba, nombre abajo),
// sin desplazamiento horizontal y con área de toque de 56 px.
export function PestanasClientes({ pestanas, oscuro = false, puedeEditarCliente = false, puedeFinanzas = false, puedeEntregarGuiones = false }: { pestanas: PestanaClientes[]; oscuro?: boolean; puedeEditarCliente?: boolean; puedeFinanzas?: boolean; puedeEntregarGuiones?: boolean }) {
  const actual = pestanaActiva(usePathname() ?? '')
  if (pestanas.length === 0) return null
  return (
    <nav className={`cj-hub${oscuro ? ' cj-hub--oscuro' : ''}`} aria-label="Clientes" data-pestanas={pestanas.length}>
      <ul className="cj-hub__lista">
        {pestanas.map((p) => (
          <li key={p.clave}>
            <Link href={p.href} className="cj-hub__pestana" aria-current={p.clave === actual ? 'page' : undefined}>
              <Icono nombre={p.icono} />
              <span className="cj-hub__txt">{p.etiqueta}</span>
            </Link>
          </li>
        ))}
      </ul>
      {/* Menú rápido (27/10/2026): pendientes de la persona y accesos; en Anuncios (verde) no va */}
      {!oscuro && <MenuRapido accesos={pestanas.map(p => ({ href: p.href, etiqueta: p.etiqueta }))} puedeEditarCliente={puedeEditarCliente} puedeFinanzas={puedeFinanzas} puedeEntregarGuiones={puedeEntregarGuiones} />}
    </nav>
  )
}
