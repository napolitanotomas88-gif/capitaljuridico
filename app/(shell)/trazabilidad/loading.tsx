import { EsqueletoCifras, EsqueletoFilas, EsqueletoTitulo, EsqueletoZona } from '@/components/shell/Esqueleto'

// Mientras llega cualquier pantalla de Trazabilidad (queda debajo de la barrera de acceso del layout de la sección):
// título, las pestañas, las cifras y la tabla.
export default function CargandoTrazabilidad() {
  return (
    <EsqueletoZona etiqueta="Leyendo Trazabilidad…">
      <EsqueletoTitulo />
      <EsqueletoFilas filas={1} alto={40} />
      <EsqueletoCifras cantidad={4} />
      <EsqueletoFilas filas={8} />
    </EsqueletoZona>
  )
}
