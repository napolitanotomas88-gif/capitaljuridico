'use client'

import { useActionState, useRef } from 'react'
import { useConfirmacion } from '@/components/ui/Confirmacion'
import { quitarAccesoAccion, type EstadoForm } from '@/lib/auth/accionesAccesos'

export function BotonQuitar({ email, nombre }: { email: string; nombre: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(quitarAccesoAccion, {})
  const [confirmar, dialogo] = useConfirmacion()
  const formRef = useRef<HTMLFormElement>(null)
  // El primer envío se frena para preguntar; si confirma, se reenvía el formulario y ese pasa derecho a la acción
  const confirmado = useRef(false)
  return (
    <form ref={formRef} action={accion} onSubmit={async (e) => {
      if (confirmado.current) { confirmado.current = false; return }
      e.preventDefault()
      const ok = await confirmar({
        titulo: `¿Quitarle el acceso a ${nombre}?`,
        detalle: 'Deja de poder entrar al Despacho. Se le puede volver a dar acceso desde esta misma pantalla.',
        accion: 'Quitar el acceso',
        peligro: true,
      })
      if (ok) { confirmado.current = true; formRef.current?.requestSubmit() }
    }}>
      <input type="hidden" name="email" value={email} />
      <button type="submit" className="cj-boton cj-boton--secundario cfg-boton-chico" disabled={pendiente}>{pendiente ? '…' : 'Quitar'}</button>
      {estado.error && <p role="alert" className="cfg-error">{estado.error}</p>}
      {dialogo}
    </form>
  )
}
