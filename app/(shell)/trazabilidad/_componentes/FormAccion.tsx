'use client'
// Formulario de una server action de Trazabilidad: muestra "Procesando…" mientras corre y el resultado al terminar.
// Las acciones que llaman a Claude o a Fathom tardan entre 20 s y 2 min: el botón queda deshabilitado mientras tanto.
import { useActionState, type ReactNode } from 'react'
import { Boton } from '@/components/ui'
import type { Estado } from '../acciones'

type Props = {
  accion: (previo: Estado, f: FormData) => Promise<Estado>
  boton: string
  pendiente?: string
  variante?: 'primario' | 'secundario'
  className?: string
  children?: ReactNode
}

export function FormAccion({ accion, boton, pendiente = 'Procesando…', variante = 'secundario', className = 'traz-form', children }: Props) {
  const [estado, enviar, enCurso] = useActionState(accion, {})
  return (
    <form action={enviar} className={className}>
      {children}
      <div className="traz-inline">
        <Boton type="submit" variante={variante} disabled={enCurso} aria-busy={enCurso}>{enCurso ? pendiente : boton}</Boton>
        <span role="status" aria-live="polite" className="traz-nota">
          {!enCurso && estado.ok}
        </span>
      </div>
      {!enCurso && estado.error && <p className="traz-error" role="alert">{estado.error}</p>}
    </form>
  )
}
