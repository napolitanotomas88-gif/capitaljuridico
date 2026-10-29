import { BotonEnlace, SeccionTitulo } from '@/components/ui'

// Cliente que no existe (ID mal escrito o fila borrada de la planilla)
export default function ClienteNoEncontrado() {
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Clientes" titulo="No encontramos ese cliente" />
      <p className="cj-parrafo">Ese ID no figura en la planilla del CRM. Puede estar mal escrito o la fila haber cambiado de ID.</p>
      <div>
        <BotonEnlace href="/clientes">Volver a clientes</BotonEnlace>
      </div>
    </div>
  )
}
