import { EsqueletoPantalla } from '@/components/shell/Esqueleto'

// La tanda de un cliente no tiene la forma del listado: sin esto quedaba el esqueleto de /guiones (tandas, cifras y tabla).
export default function CargandoTanda() {
  return <EsqueletoPantalla etiqueta="Leyendo los guiones del cliente…" filas={6} />
}
