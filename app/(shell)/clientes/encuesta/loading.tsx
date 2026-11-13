import { EsqueletoPantalla } from '@/components/shell/Esqueleto'

// Mientras se lee la encuesta mensual. La sección la exige antes el proxy ('/clientes/*'); la página la repite.
export default function CargandoEncuesta() {
  return <EsqueletoPantalla etiqueta="Leyendo la encuesta…" />
}
