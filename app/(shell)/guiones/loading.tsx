import { EsqueletoCifras, EsqueletoFilas, EsqueletoTitulo, EsqueletoZona } from '@/components/shell/Esqueleto'

// Mientras llega Guiones (queda debajo de la barrera de acceso del layout de la sección): título, tandas, cifras y tabla.
export default function CargandoGuiones() {
  return (
    <EsqueletoZona etiqueta="Leyendo guiones…">
      <EsqueletoTitulo />
      <EsqueletoFilas filas={3} />
      <EsqueletoCifras cantidad={4} />
      <EsqueletoFilas filas={8} />
    </EsqueletoZona>
  )
}
