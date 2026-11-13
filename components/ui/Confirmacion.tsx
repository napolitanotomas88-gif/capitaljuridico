'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { clases } from './clases'
import './confirmacion.css'

// Confirmación propia en lugar de window.confirm (tanda visual 2, 13/11/2026). <dialog> nativo con showModal: va a la capa
// superior (queda arriba aunque se abra desde otro <dialog>, como el de Cuotas), vuelve inerte el resto de la página y
// Escape cancela. El foco empieza en «Cancelar» y no sale de los dos botones.
// Uso: const [confirmar, dialogo] = useConfirmacion(); … if (!(await confirmar({ titulo, detalle, accion }))) return; … {dialogo}

export type PedidoConfirmacion = {
  /** La pregunta, corta: «¿Borrar esta nota?» */
  titulo: string
  /** Qué pasa al confirmar y si se puede deshacer */
  detalle?: string
  /** El verbo exacto del botón: «Borrar», «Pasar a Aprobado» */
  accion: string
  /** Acción que borra, descarta o quita: el botón va en bordó */
  peligro?: boolean
}

export function useConfirmacion(): [(p: PedidoConfirmacion) => Promise<boolean>, ReactNode] {
  const [pedido, setPedido] = useState<PedidoConfirmacion | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirmar = useCallback((p: PedidoConfirmacion) => new Promise<boolean>(resolve => {
    resolver.current?.(false) // si había otra abierta, esa queda cancelada
    resolver.current = resolve
    setPedido(p)
  }), [])

  const responder = useCallback((ok: boolean) => {
    const r = resolver.current
    resolver.current = null
    setPedido(null)
    r?.(ok)
  }, [])

  // Si el componente se desmonta con la pregunta abierta, cuenta como cancelada
  useEffect(() => () => { resolver.current?.(false); resolver.current = null }, [])

  return [confirmar, pedido ? <DialogoConfirmacion {...pedido} onResponder={responder} /> : null]
}

function DialogoConfirmacion({ titulo, detalle, accion, peligro, onResponder }: PedidoConfirmacion & { onResponder: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelarRef = useRef<HTMLButtonElement>(null)
  const aceptarRef = useRef<HTMLButtonElement>(null)
  const respondido = useRef(false)
  const idTitulo = useId()
  const idDetalle = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    const antes = document.activeElement as HTMLElement | null
    if (!d.open) d.showModal()
    cancelarRef.current?.focus()
    return () => {
      if (d.open) d.close()
      if (antes?.isConnected) antes.focus()
    }
  }, [])

  const responder = (ok: boolean) => {
    if (respondido.current) return
    respondido.current = true
    onResponder(ok)
  }

  // Tab y Mayús+Tab giran entre los dos botones. Ninguna tecla sale del diálogo: si no, el Escape o el Tab también
  // los atiende el panel de atrás (la hoja de Mi día escucha el Escape en document)
  const alTeclear = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation()
    if (e.key !== 'Tab') return
    const primero = cancelarRef.current
    const ultimo = aceptarRef.current
    if (!primero || !ultimo) return
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    else if (document.activeElement !== primero && document.activeElement !== ultimo) { e.preventDefault(); primero.focus() }
  }

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={idTitulo}
      aria-describedby={detalle ? idDetalle : undefined}
      className="cj-confirmar"
      onCancel={() => responder(false)}
      // El close que dispara el ciclo doble de efectos en desarrollo llega con el diálogo ya reabierto: ese no cuenta
      onClose={() => { if (!ref.current?.open) responder(false) }}
      onKeyDown={alTeclear}
      // Los toques tampoco suben: el fondo de un panel que cierra al tocarlo volvería a preguntar
      onClick={e => e.stopPropagation()}
    >
      <h2 id={idTitulo} className="cj-confirmar__titulo">{titulo}</h2>
      {detalle && <p id={idDetalle} className="cj-confirmar__detalle">{detalle}</p>}
      <div className="cj-confirmar__botones">
        <button ref={cancelarRef} type="button" className="cj-boton cj-boton--secundario" onClick={() => responder(false)}>Cancelar</button>
        <button ref={aceptarRef} type="button" className={clases('cj-boton', peligro ? 'cj-boton--peligro' : 'cj-boton--primario')} onClick={() => responder(true)}>{accion}</button>
      </div>
    </dialog>
  )
}
