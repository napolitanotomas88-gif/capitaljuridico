import { BotonEnlace, SeccionTitulo } from '@/components/ui'

// Pantalla cuando no hay forma de leer la planilla y tampoco hay datos guardados.
// El motivo exacto queda en el log del servidor: acá no se muestra texto interno del error.
export function ErrorLectura({ etiqueta, titulo, volver }: { etiqueta: string; titulo: string; volver: string }) {
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta={etiqueta} titulo={titulo} />
      <div className="cj-aviso" role="alert">
        <p>No se pudo leer la planilla de clientes y todavía no hay datos guardados para mostrar. Probá de nuevo en un minuto.</p>
      </div>
      <div>
        <BotonEnlace href={volver}>Reintentar</BotonEnlace>
      </div>
    </div>
  )
}
