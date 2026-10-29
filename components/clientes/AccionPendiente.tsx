import { Boton } from '@/components/ui'

// Botón de una acción que todavía no existe (esta etapa es de solo lectura): se ve, está deshabilitado
// y dice por qué. La leyenda queda asociada al botón para lectores de pantalla.
export const LEYENDA_PROXIMA_ETAPA = 'Disponible en la próxima etapa'

export function AccionPendiente({ children }: { children: string }) {
  const id = `pendiente-${children.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="cj-pendiente">
      <Boton variante="secundario" disabled aria-describedby={id}>
        {children}
      </Boton>
      <span id={id} className="cj-etiqueta">
        {LEYENDA_PROXIMA_ETAPA}
      </span>
    </div>
  )
}
