import { EsqueletoCifras, EsqueletoFilas, EsqueletoTitulo, EsqueletoZona } from '@/components/shell/Esqueleto'

// Mientras se lee el reporte EOW de la base del Despacho: título, los contadores del semáforo y las filas de clientes.
// La barrera por mail la aplica antes el proxy (lib/auth/rutas.ts, regla '/eow/*'); la página la repite.
export default function CargandoEow() {
  return (
    <EsqueletoZona etiqueta="Leyendo el reporte EOW…" chica>
      <EsqueletoTitulo />
      <EsqueletoCifras cantidad={4} />
      <EsqueletoFilas filas={8} />
    </EsqueletoZona>
  )
}
