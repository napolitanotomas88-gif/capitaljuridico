import type { EstadoLectura } from '@/lib/clientes/vista'

// Aviso cuando la planilla no respondió y se muestran datos guardados. Con datos al día no dice nada
// (la hora de la lectura va en el encabezado de cada pantalla).
export function AvisoLectura({ lectura }: { lectura: EstadoLectura }) {
  if (lectura.tipo !== 'guardados') return null
  return (
    <div className="cj-aviso" role="status">
      <p>
        No se pudo leer la planilla ahora{lectura.motivo ? `: ${lectura.motivo}` : ''}. Estás viendo datos del {lectura.hora} del {lectura.dia}
        {lectura.haceMin > 0 ? ` (de hace ${lectura.haceMin} min)` : ''}. Se vuelve a intentar al recargar.
      </p>
    </div>
  )
}
