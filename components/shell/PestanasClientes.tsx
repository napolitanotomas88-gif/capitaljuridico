'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { pestanaActiva, type PestanaClientes } from '@/lib/auth/hubClientes'
import { Icono } from './iconos'
import { MenuRapido } from '@/components/clientes/MenuRapido'
import { useEffect, useRef, useState } from 'react'
import './pestanasClientes.css'
import '@/components/ui/tarjetas.css'
// Cristal del hub (26/10/2026): se carga con las pestañas porque están en todas las páginas del hub
import '@/components/ui/cristal.css'

// Pestañas del hub Clientes (25/10/2026): Cartera, Guiones, Edición, Anuncios y Referidos. Llegan YA filtradas por el
// servidor (lib/auth/hubClientes.ts: pestanasVisibles), así que acá solo se dibujan. Son enlaces entre páginas, no paneles
// de una misma página: por eso van en un <nav> con aria-current y no con role="tablist".
// Escritorio: fila con subrayado latón en la activa. Celular: las pestañas se reparten el ancho (ícono arriba, nombre abajo),
// sin desplazamiento horizontal y con área de toque de 56 px.
export function PestanasClientes({ pestanas, portales = [], oscuro = false, puedeEditarCliente = false, puedeFinanzas = false, puedeEntregarGuiones = false }: { pestanas: PestanaClientes[]; portales?: PestanaPortal[]; oscuro?: boolean; puedeEditarCliente?: boolean; puedeFinanzas?: boolean; puedeEntregarGuiones?: boolean }) {
  const ruta = usePathname() ?? ''
  const enPortal = portales.find((p) => ruta === p.href || ruta.startsWith(`${p.href}/`))
  // En un portal no se marca la Cartera: la activa es la pestaña del portal
  const actual = enPortal ? null : pestanaActiva(ruta)
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
      {portales.length > 0 && <PestanasPortal portales={portales} activo={enPortal?.href ?? null} />}
      {/* Menú rápido (27/10/2026): pendientes de la persona y accesos; en Anuncios (verde) no va */}
      {!oscuro && <MenuRapido accesos={pestanas.map(p => ({ href: p.href, etiqueta: p.etiqueta }))} puedeEditarCliente={puedeEditarCliente} puedeFinanzas={puedeFinanzas} puedeEntregarGuiones={puedeEntregarGuiones} />}
    </nav>
  )
}

export type PestanaPortal = { href: string; etiqueta: string }

// Portales del cliente (2/11/2026): con uno, una pestaña más con su título; con varios, se agrupan en «Estrategias ▾» (un menú
// que se despliega), así la barra no se rompe en el celular. Se cierra al elegir, con Escape o tocando afuera.
function PestanasPortal({ portales, activo }: { portales: PestanaPortal[]; activo: string | null }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!abierto) return
    const afuera = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAbierto(false); boton.current?.focus() } }
    document.addEventListener('pointerdown', afuera)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('pointerdown', afuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])
  if (portales.length === 1) {
    const p = portales[0]
    return (
      <div className="cj-hub__portales">
        <Link href={p.href} className="cj-hub__pestana cj-hub__portal" aria-current={activo === p.href ? 'page' : undefined} title={p.etiqueta}>
          <Icono nombre="estrategia" />
          <span className="cj-hub__txt">{p.etiqueta}</span>
        </Link>
      </div>
    )
  }
  const elegido = portales.find((p) => p.href === activo)
  return (
    <div className="cj-hub__portales" ref={caja}>
      <button ref={boton} type="button" className="cj-hub__pestana cj-hub__portal" aria-expanded={abierto} aria-controls="cj-hub-portales" aria-current={elegido ? 'page' : undefined} onClick={() => setAbierto((v) => !v)}>
        <Icono nombre="estrategia" />
        <span className="cj-hub__txt">{elegido ? elegido.etiqueta : 'Estrategias'}</span>
        <span aria-hidden="true" className="cj-hub__flecha">▾</span>
      </button>
      {abierto && (
        <ul id="cj-hub-portales" className="cj-hub__menu">
          {portales.map((p) => (
            <li key={p.href}>
              <Link href={p.href} aria-current={activo === p.href ? 'page' : undefined} onClick={() => setAbierto(false)}>{p.etiqueta}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
