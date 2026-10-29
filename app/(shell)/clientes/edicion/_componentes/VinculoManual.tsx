'use client'

import { useState } from 'react'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// Cuando ninguno de los candidatos es el cliente de la carpeta (o para corregir un vínculo ya hecho): se escribe el id del
// CRM a mano (A123). Siempre se pregunta antes: un vínculo equivocado manda crudos y avisos al cliente equivocado.
export function VinculoManual({ carpetaId, nombre, demo, etiqueta = 'Otro cliente (id)', boton = 'Vincular' }: { carpetaId: string; nombre: string; demo: boolean; etiqueta?: string; boton?: string }) {
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const [id, setId] = useState('')
  return (
    <div className="ed-form__fila">
      <label className="ed-campo ed-campo--chico"><span>{etiqueta}</span><input value={id} maxLength={7} placeholder="A123" onChange={e => setId(e.target.value)} autoComplete="off" /></label>
      <button type="button" className="cj-chip" disabled={enviando} onClick={() => {
        const x = id.trim().toUpperCase()
        if (!/^[A-Z]\d{1,6}$/.test(x)) { setMsj({ texto: 'El id del CRM es una letra y números (A123).', error: true }); return }
        if (!window.confirm(`¿La carpeta «${nombre}» es del cliente ${x}? Desde ahí el vigía procesa sus crudos y avisos para ese cliente.`)) return
        void enviar({ accion: 'vinculo_confirmar', carpeta_id: carpetaId, id_crm: x })
      }}>{boton}</button>
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}
