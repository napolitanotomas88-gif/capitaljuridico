'use client'

import { useActionState } from 'react'
import { quitarAccesoAccion, type EstadoForm } from '@/lib/auth/accionesAccesos'

export function BotonQuitar({ email, nombre }: { email: string; nombre: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoForm, FormData>(quitarAccesoAccion, {})
  return (
    <form action={accion} onSubmit={(e) => { if (!window.confirm(`¿Quitarle el acceso a ${nombre}?`)) e.preventDefault() }}>
      <input type="hidden" name="email" value={email} />
      <button type="submit" className="cj-boton cj-boton--secundario cfg-boton-chico" disabled={pendiente}>{pendiente ? '…' : 'Quitar'}</button>
      {estado.error && <p role="alert" className="cfg-error">{estado.error}</p>}
    </form>
  )
}
