'use client'

import { useEffect } from 'react'
import { Boton, SeccionTitulo } from '@/components/ui'

// Error inesperado en una pantalla del shell (los errores de lectura de la planilla ya se muestran en cada página).
// El detalle queda en la consola del servidor: acá no se muestra texto interno.
export default function ErrorPantalla({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Error" titulo="Algo salió mal" />
      <div className="cj-aviso" role="alert">
        <p>No pudimos armar esta pantalla. Probá de nuevo; si sigue pasando, avisale al equipo.</p>
      </div>
      <div>
        <Boton onClick={() => unstable_retry()}>Reintentar</Boton>
      </div>
    </div>
  )
}
