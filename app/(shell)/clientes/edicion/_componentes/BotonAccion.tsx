'use client'

import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'
import type { RutaEdicion } from './enviar'

// Un botón que manda una acción ya armada (lote, "guiones enviados", aceptar el editado, confirmar un vínculo…). Si lleva
// `confirmar`, lo pregunta antes (window.confirm: alcanza para algo que se hace pocas veces y se puede deshacer a mano).
type Props = {
  cuerpo: Record<string, unknown>
  etiqueta: string
  confirmar?: string
  variante?: 'primario' | 'secundario' | 'peligro'
  demo: boolean
  ruta?: RutaEdicion
  deshabilitado?: boolean
}

export function BotonAccion({ cuerpo, etiqueta, confirmar, variante = 'secundario', demo, ruta, deshabilitado }: Props) {
  const { enviando, msj, enviar } = useEnvio(demo)
  const clase = variante === 'primario' ? 'cj-boton cj-boton--primario' : variante === 'peligro' ? 'cj-boton cj-boton--secundario ed-boton-peligro' : 'cj-boton cj-boton--secundario'
  return (
    <span className="ed-botones">
      <button type="button" className={clase} disabled={enviando || deshabilitado} onClick={() => {
        if (confirmar && !window.confirm(confirmar)) return
        void enviar(cuerpo, { ruta })
      }}>
        {etiqueta}
      </button>
      <Mensaje msj={msj} enviando={enviando} />
    </span>
  )
}
