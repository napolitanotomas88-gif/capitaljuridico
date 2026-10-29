'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { puntuarCliente, type EstadoPuntaje } from '@/lib/seguimiento/acciones'

// "Cómo le va" a un cliente: se ve el último puntaje (1 a 10) con su tendencia frente al mes anterior; un toque abre los 10
// botones y una nota corta opcional. Se guarda en la pestaña Seguimiento del CRM (quién y cuándo).
export type PuntajeVista = { valor: number; tendencia: 'sube' | 'baja' | 'igual' | null; fuente: 'manual' | 'typeform'; dia: string } | null

const FLECHA = { sube: '↑', baja: '↓', igual: '→' } as const
const TEXTO_TENDENCIA = { sube: 'sube frente al mes anterior', baja: 'baja frente al mes anterior', igual: 'igual que el mes anterior' } as const
const tono = (v: number) => (v >= 8 ? 'alto' : v >= 5 ? 'medio' : 'bajo')
const fechaCorta = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${+d}/${+m}` }

// alGuardar: la lista se entera de cada puntaje guardado. Si la fila sale del filtro al guardarse (con «Sin respuesta este
// mes» prendido), este componente se desmonta con su mensaje y es la lista la que avisa
export function PuntajeRapido({ idCliente, nombre, actual, sinRespuesta = false, alGuardar }: { idCliente: string; nombre: string; actual: PuntajeVista; sinRespuesta?: boolean; alGuardar?: (mensaje: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const cajaRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const idForm = useId()
  // Cerrar sin guardar (Escape o "Cancelar") devuelve el foco al chip: si no, se pierde en la página
  const cerrar = () => { setAbierto(false); chipRef.current?.focus() }
  const [estado, accion, pendiente] = useActionState<EstadoPuntaje, FormData>(async (previo, datos) => {
    const r = await puntuarCliente(previo, datos)
    if (r.ok && r.mensaje) alGuardar?.(r.mensaje)
    return r
  }, {})
  // Al guardar bien se cierra (ajuste de estado durante el render, sin efecto)
  const [visto, setVisto] = useState(estado)
  if (visto !== estado) { setVisto(estado); if (estado.ok) setAbierto(false) }
  // ...y el foco también vuelve al chip (el número tocado desaparece con el formulario). Va en un efecto porque durante el
  // render el chip todavía no está en su lugar; el estado inicial ({}) no enfoca nada al montar. Guardar tarda unos segundos
  // (Sheets y la página que se vuelve a armar): si mientras tanto el usuario ya está en otra cosa, no se le roba el foco.
  // Solo vuelve si se perdió (quedó en <body>) o si sigue dentro de este puntaje
  useEffect(() => {
    if (!estado.ok) return
    const a = document.activeElement
    if (!a || a === document.body || cajaRef.current?.contains(a)) chipRef.current?.focus()
  }, [estado])
  const valor = estado.ok && estado.valor !== undefined && !estado.mensaje?.startsWith('Modo') ? estado.valor : actual?.valor ?? null

  return (
    <div ref={cajaRef} className="pt-caja">
      <button ref={chipRef} type="button" className={`pt-chip${valor !== null ? ` pt-chip--${tono(valor)}` : ''}`} aria-expanded={abierto} aria-controls={abierto ? idForm : undefined} onClick={e => { e.preventDefault(); e.stopPropagation(); setAbierto(v => !v) }}
        aria-label={valor !== null ? `Cómo le va a ${nombre}: ${valor} de 10${actual?.tendencia ? `, ${TEXTO_TENDENCIA[actual.tendencia]}` : ''}. Tocar para puntuar` : `Puntuar a ${nombre} (del 1 al 10)`}>
        {valor !== null ? (
          <>
            <strong>{valor}</strong>
            <span className="pt-chip__de">/10</span>
            {actual?.tendencia && <span className={`pt-flecha pt-flecha--${actual.tendencia}`} aria-hidden="true">{FLECHA[actual.tendencia]}</span>}
          </>
        ) : (
          <span>Puntuar</span>
        )}
      </button>
      {actual && !abierto && <span className="pt-sub">{actual.fuente === 'typeform' ? 'Typeform' : 'a mano'} · {fechaCorta(actual.dia)}</span>}
      {sinRespuesta && !abierto && <span className="pt-sub pt-sub--alerta">Sin respuesta este mes</span>}
      {abierto && (
        <form id={idForm} action={accion} className="pt-form" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar() } }}>
          <input type="hidden" name="idCliente" value={idCliente} />
          <fieldset className="pt-botones">
            <legend className="cj-etiqueta">¿Cómo le va? (1 a 10)</legend>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              // Al abrir, el foco va al puntaje actual (o al 1): se elige con Tab y Enter sin volver a buscar el formulario.
              // El Typeform admite 0 y no hay botón 0: ahí también va al 1 (si no, ningún botón tomaba el foco y Escape no cerraba)
              <button key={n} type="submit" name="valor" value={n} className={`pt-num pt-num--${tono(n)}`} disabled={pendiente} aria-label={`${n} de 10`} autoFocus={n === Math.max(1, valor ?? 1)}>{n}</button>
            ))}
          </fieldset>
          <label className="pt-nota">
            <span className="cj-etiqueta">Nota (opcional, se guarda con el número que toques)</span>
            <input name="nota" type="text" maxLength={200} autoComplete="off" />
          </label>
          <button type="button" className="pt-cancelar" onClick={cerrar}>Cancelar</button>
        </form>
      )}
      <p role="status" aria-live="polite" className={estado.error ? 'pt-msj pt-msj--error' : 'pt-msj'}>{pendiente ? 'Guardando…' : estado.error ?? (estado.ok ? estado.mensaje : '')}</p>
    </div>
  )
}
