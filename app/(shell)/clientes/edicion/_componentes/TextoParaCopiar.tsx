'use client'

import { useId, useRef, useState } from 'react'
import { LARGO_NOTA_PASO, LARGO_TEXTO_ENVIO } from '@/lib/edicion/pedido'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// Lo que le toca al cliente, mientras no hay chip de WhatsApp: el bot arma el texto, Aylu lo copia en el grupo Contenido y
// toca «Enviado», que deja la constancia (quién y cuándo) con el texto que se copió. Cuando llegue el chip, este mismo botón
// pasa a «Enviar». El texto se puede retocar antes de copiar (la fecha propuesta, un detalle): se guarda el que se copió.
type Props = {
  texto: string
  etiqueta: string
  demo: boolean
  editable?: boolean
  /** La acción de "enviado": el cuerpo sin el texto (se suma el de la caja). null = solo copiar. */
  envio: { cuerpo: Record<string, unknown>; boton: string; conNota?: boolean } | null
  constancia?: string | null
}

export function TextoParaCopiar({ texto, etiqueta, demo, editable = true, envio, constancia }: Props) {
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const [valor, setValor] = useState(texto)
  const [nota, setNota] = useState('')
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setMsj({ texto: 'Copiado: pegalo en el grupo Contenido del cliente.', error: false })
    } catch {
      area.current?.select()
      setMsj({ texto: 'No se pudo copiar solo: quedó seleccionado, copialo con Cmd+C o mantené apretado.', error: true })
    }
  }

  return (
    <div className="ed-copiar">
      <label className="ed-campo" htmlFor={`${id}-t`}>
        <span>{etiqueta}</span>
      </label>
      <textarea id={`${id}-t`} ref={area} className="ed-texto" value={valor} readOnly={!editable} maxLength={LARGO_TEXTO_ENVIO} rows={Math.min(12, Math.max(4, valor.split('\n').length + 1))} onChange={e => setValor(e.target.value)} />
      {envio?.conNota && (
        <label className="ed-campo">
          <span>Nota (opcional: qué respondió, qué se acordó)</span>
          <input value={nota} maxLength={LARGO_NOTA_PASO} onChange={e => setNota(e.target.value)} autoComplete="off" />
        </label>
      )}
      <div className="ed-botones">
        <button type="button" className="cj-boton cj-boton--secundario" onClick={() => void copiar()}>{copiado ? 'Copiar de nuevo' : 'Copiar'}</button>
        {envio && (
          <button type="button" className="cj-boton cj-boton--primario" disabled={enviando || !valor.trim()} onClick={async () => {
            const cuerpo = { ...envio.cuerpo, texto: valor.trim(), ...(envio.conNota ? { nota: nota.trim() } : {}) }
            await enviar(cuerpo)
          }}>{envio.boton}</button>
        )}
      </div>
      {constancia && <p className="ed-constancia">{constancia}</p>}
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}
