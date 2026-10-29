import { Etiqueta } from '@/components/ui'
import type { FichaCliente } from '@/lib/clientes/ficha'
import { SeccionFicha } from './SeccionFicha'

// Anotaciones libres y notas de renovación tal como están en la planilla (texto plano, con sus saltos de línea).
export function Notas({ f, puedeEditarCliente = false }: { f: FichaCliente; puedeEditarCliente?: boolean }) {
  const { anotaciones, renovacion } = f.notas
  return (
    <SeccionFicha etiqueta="Notas" titulo="Anotaciones del equipo">
      {!anotaciones && !renovacion && <p className="cj-parrafo cj-texto-2">Este cliente no tiene notas cargadas.</p>}
      {anotaciones && (
        <div className="cj-pila cj-pila--chica" style={{ gap: 12 }}>
          <Etiqueta como="h3">Anotaciones</Etiqueta>
          <p className="cj-notas">{anotaciones}</p>
        </div>
      )}
      {renovacion && (
        <div className="cj-pila cj-pila--chica" style={{ gap: 12 }}>
          <Etiqueta como="h3">Notas de renovación</Etiqueta>
          <p className="cj-notas">{renovacion}</p>
        </div>
      )}
      {puedeEditarCliente && <a className="cj-enlace" href="#rc-acciones">Editar notas</a>}
    </SeccionFicha>
  )
}
