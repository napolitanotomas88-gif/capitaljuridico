'use client'

import { useConfirmacion, type PedidoConfirmacion } from '@/components/ui/Confirmacion'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'
import type { RutaEdicion } from './enviar'

// Un botón que manda una acción ya armada (lote, "guiones enviados", aceptar el editado, confirmar un vínculo…). Si lleva
// `confirmar`, lo pregunta antes con la confirmación propia (pregunta, qué pasa y el verbo del botón).
type Props = {
  cuerpo: Record<string, unknown>
  etiqueta: string
  confirmar?: PedidoConfirmacion
  variante?: 'primario' | 'secundario' | 'peligro'
  demo: boolean
  ruta?: RutaEdicion
  deshabilitado?: boolean
}

export function BotonAccion({ cuerpo, etiqueta, confirmar, variante = 'secundario', demo, ruta, deshabilitado }: Props) {
  const { enviando, msj, enviar } = useEnvio(demo)
  const [preguntar, dialogo] = useConfirmacion()
  const clase = variante === 'primario' ? 'cj-boton cj-boton--primario' : variante === 'peligro' ? 'cj-boton cj-boton--secundario ed-boton-peligro' : 'cj-boton cj-boton--secundario'
  return (
    <span className="ed-botones">
      <button type="button" className={clase} disabled={enviando || deshabilitado} onClick={async () => {
        if (confirmar && !(await preguntar(confirmar))) return
        void enviar(cuerpo, { ruta })
      }}>
        {etiqueta}
      </button>
      <Mensaje msj={msj} enviando={enviando} />
      {dialogo}
    </span>
  )
}
