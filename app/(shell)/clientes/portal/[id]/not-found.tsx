import { SeccionTitulo } from '@/components/ui'

// Portal que no existe (ID mal escrito o cliente que ya no figura en el CRM). Sin enlaces: lo puede ver el cliente.
export default function PortalNoEncontrado() {
  return (
    <div className="cj-pila">
      <SeccionTitulo etiqueta="Portal del cliente" titulo="No encontramos este portal" />
      <p className="cj-parrafo">Revisá el enlace o escribinos y lo vemos.</p>
    </div>
  )
}
