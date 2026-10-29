import { ChipSemaforo } from '@/components/ui'
import type { VistaVigia } from '@/lib/edicion/vista'

// "Último vigía hace X": verde con menos de 30 minutos, latón con menos de 2 horas y bordó desde 2 horas dentro del horario
// del vigía (8 a 22). El detalle (qué corrió, de dónde vino) va en el title y para los lectores de pantalla.
export function UltimoVigia({ v }: { v: VistaVigia }) {
  return (
    <span title={v.detalle}>
      <ChipSemaforo estado={v.tono}>{v.texto}</ChipSemaforo>
      <span className="cj-solo-lectores">. {v.detalle}</span>
    </span>
  )
}
