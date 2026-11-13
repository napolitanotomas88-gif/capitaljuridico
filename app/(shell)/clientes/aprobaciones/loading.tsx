import { EsqueletoPantalla } from '@/components/shell/Esqueleto'

// Mientras se leen las aprobaciones pendientes. La sección la exige antes el proxy ('/clientes/*'); la página la repite.
export default function CargandoAprobaciones() {
  return <EsqueletoPantalla etiqueta="Leyendo las aprobaciones…" />
}
