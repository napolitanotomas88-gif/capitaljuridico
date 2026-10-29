import type { ReactNode } from 'react'
import { Vacio } from './Vacio'
import { clases } from './clases'

// Tabla densa: encabezados en etiqueta, números tabulares alineados a la derecha, y scroll horizontal
// dentro de su contenedor (la página nunca se desborda en móvil).
export type Columna<T> = {
  clave: string
  titulo: string
  /** true = número: alineado a la derecha y con cifras tabulares */
  numerica?: boolean
  alinear?: 'izq' | 'centro'
  /** true = texto largo (notas, anotaciones): se parte en varias líneas también en móvil */
  largo?: boolean
  /** Cómo dibujar la celda; sin esto se muestra fila[clave] */
  celda?: (fila: T) => ReactNode
}

type Props<T> = {
  /** Descripción para lectores de pantalla (la tabla no muestra título propio) */
  descripcion: string
  columnas: Columna<T>[]
  filas: T[]
  claveFila: (fila: T) => string
  /** Se muestra en lugar de la tabla cuando no hay filas */
  vacio?: ReactNode
  className?: string
}

export function Tabla<T>({ descripcion, columnas, filas, claveFila, vacio, className }: Props<T>) {
  if (filas.length === 0 && vacio) return <>{vacio}</>
  if (filas.length === 0) return <Vacio frase="No hay nada para mostrar." />

  const claseCol = (c: Columna<T>) => clases(c.numerica && 'cj-num', c.alinear === 'centro' && 'cj-centro', c.largo && 'cj-largo')
  return (
    // tabIndex=0: el contenedor con scroll tiene que poder enfocarse con teclado
    <div className={clases('cj-tabla-scroll', className)} role="region" aria-label={descripcion} tabIndex={0}>
      <table className="cj-tabla">
        <caption className="cj-solo-lectores">{descripcion}</caption>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th key={c.clave} scope="col" className={clases('cj-etiqueta', claseCol(c))}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={claveFila(fila)}>
              {columnas.map((c) => (
                <td key={c.clave} className={claseCol(c)}>
                  {c.celda ? c.celda(fila) : (fila as Record<string, ReactNode>)[c.clave]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
