'use client'

import { useEffect, useRef, useState } from 'react'

// Arrastrar hacia abajo desde arriba de todo para actualizar (en la app instalada de iOS no existe de fábrica).
// Solo en pantallas táctiles angostas. Avisa con el evento "cj:actualizar": el Resumen lo escucha y vuelve a pedir los
// datos; el resto de las pantallas recarga la página.
const UMBRAL = 72
// Con un diálogo abierto no actúa: recargar perdería lo cargado en el formulario sin preguntar. Cuenta el <dialog> nativo
// abierto (Cuotas), que tiene el rol de diálogo sin el atributo, y las hojas con role="dialog" (Ventas, "Más")
const DIALOGO = 'dialog[open], [role="dialog"]'
const hayDialogo = (e?: TouchEvent) =>
  !!document.querySelector(DIALOGO) || (e?.target instanceof Element && !!e.target.closest(`dialog, ${DIALOGO}`))
export function ArrastrarParaActualizar() {
  const [tirando, setTirando] = useState(0)
  const [cargando, setCargando] = useState(false)
  const inicio = useRef<number | null>(null)

  useEffect(() => {
    if (!window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches) return
    const alEmpezar = (e: TouchEvent) => { inicio.current = window.scrollY <= 0 && !hayDialogo(e) ? e.touches[0].clientY : null }
    const alMover = (e: TouchEvent) => {
      if (inicio.current === null) return
      const d = e.touches[0].clientY - inicio.current
      if (d <= 0) { setTirando(0); return }
      setTirando(Math.min(d * 0.5, UMBRAL + 24))
    }
    const alSoltar = () => {
      if (inicio.current === null) return
      inicio.current = null
      // Si mientras tanto se abrió un diálogo, el gesto no hace nada
      const cancelar = hayDialogo()
      setTirando((t) => {
        if (t >= UMBRAL * 0.5 && !cancelar) {
          setCargando(true)
          const manejado = !window.dispatchEvent(new CustomEvent('cj:actualizar', { cancelable: true }))
          if (manejado) setTimeout(() => setCargando(false), 900)
          else window.location.reload()
        }
        return 0
      })
    }
    window.addEventListener('touchstart', alEmpezar, { passive: true })
    window.addEventListener('touchmove', alMover, { passive: true })
    window.addEventListener('touchend', alSoltar)
    return () => { window.removeEventListener('touchstart', alEmpezar); window.removeEventListener('touchmove', alMover); window.removeEventListener('touchend', alSoltar) }
  }, [])

  if (!tirando && !cargando) return null
  return (
    <div className="cj-ptr" data-cargando={cargando} style={{ opacity: cargando ? 1 : Math.min(1, tirando / 40), transform: `translateY(${cargando ? 12 : tirando * 0.6}px)` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: cargando ? undefined : `rotate(${tirando * 3}deg)` }}>
        <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
      </svg>
    </div>
  )
}
