'use client'

import { useState } from 'react'
import { Boton, BotonEnlace, CampoBusqueda, ChipFiltro } from '@/components/ui'

// Demos con estado de la página /sistema: filtros (aria-pressed) y campo de búsqueda.
const FILTROS = ['Todos', 'Activos', 'Pausados', 'Finalizados']

export function DemoFiltros() {
  const [activo, setActivo] = useState('Todos')
  return (
    <div className="cj-fila" role="group" aria-label="Filtro de estado (demo)">
      {FILTROS.map((f) => (
        <ChipFiltro key={f} activo={activo === f} onClick={() => setActivo(f)}>
          {f}
        </ChipFiltro>
      ))}
    </div>
  )
}

export function DemoBusqueda() {
  const [texto, setTexto] = useState('')
  return <CampoBusqueda value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre o ID" etiqueta="Buscar cliente (demo)" />
}

export function DemoBotones() {
  const [clics, setClics] = useState(0)
  return (
    <div className="cj-fila">
      <Boton onClick={() => setClics((n) => n + 1)}>Guardar{clics ? ` (${clics})` : ''}</Boton>
      <Boton variante="secundario">Cancelar</Boton>
      <Boton disabled>Deshabilitado</Boton>
      <BotonEnlace href="/sistema">Enlace con aspecto de botón</BotonEnlace>
    </div>
  )
}
