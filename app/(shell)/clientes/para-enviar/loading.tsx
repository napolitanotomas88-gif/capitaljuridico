import { EsqueletoPantalla } from '@/components/shell/Esqueleto'

// Mientras se lee la lista de mensajes para enviar. La sección la exige antes el proxy ('/clientes/*'); la página la repite.
export default function CargandoParaEnviar() {
  return <EsqueletoPantalla etiqueta="Leyendo los mensajes para enviar…" />
}
