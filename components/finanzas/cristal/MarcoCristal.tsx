'use client'
// Marco de Finanzas con el diseño de cristal (1/11/2026, el diseño oficial desde ese día; pedido de Tomás: «copiá todo el diseño literalmente…
// con los colores más apagados de Capital Jurídico, ese verde oscuro… junto con el logo de fondo»; «no es una sidebar, es
// todo el diseño en sí»). Fondo: el logo de Capital Jurídico grande sobre verde Toga con textura (hace de la foto del living
// del video); encima, la navegación de cristal (NavCristal) y las pantallas de siempre reestilizadas como paneles de cristal
// (cristal.css, todo bajo .fin-cristal). Solo presentación: las pantallas y su lógica son las mismas del diseño clásico (/finanzas/clasico).
import { useCallback, useState } from 'react'
import { NavCristal } from './NavCristal'
import './cristal.css'

export function MarcoCristal({ abiertaInicial, nocheInicial, children }: { abiertaInicial: boolean; nocheInicial: boolean; children: React.ReactNode }) {
  const [estado, setEstado] = useState({ abierta: abiertaInicial, noche: nocheInicial })
  const alCambiar = useCallback((e: { abierta: boolean; noche: boolean }) => setEstado(e), [])
  return (
    <div className="fin-cristal" data-nav={estado.abierta ? 'panel' : 'riel'} data-noche={estado.noche}>
      <div className="fin-cristal__fondo" aria-hidden="true">
        <span className="fin-cristal__manchas" />
        <span className="fin-cristal__logo" />
        <span className="fin-cristal__grano" />
      </div>
      <a href="#fin-cristal-contenido" className="fin-cristal__saltar">Saltar al contenido</a>
      <NavCristal abiertaInicial={abiertaInicial} nocheInicial={nocheInicial} onCambio={alCambiar} />
      <div id="fin-cristal-contenido" className="fin-cristal__contenido" tabIndex={-1}>
        {children}
      </div>
    </div>
  )
}
