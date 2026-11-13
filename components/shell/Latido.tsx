'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { EVENTO_CONECTADOS, INTERVALO_LATIDO_MS, seccionDeRuta } from '@/lib/presencia/intervalo'

/**
 * Avisa que esta pestaña sigue abierta (quién está conectado, 27/10/2026): al entrar, cada 45 s mientras la pestaña está a la
 * vista y al volver a ella. Con la pestaña escondida no avisa, así que a los 2 minutos la persona deja de figurar.
 * La respuesta trae quién está conectado y la reparte con el evento 'cj:conectados' (Conectados.tsx ya no consulta aparte).
 * No dibuja nada. Va en el marco (MarcoShell): una vez por pantalla.
 * Velocidad, tanda 2: el reloj ya no se reinicia en cada cambio de ruta. Al navegar solo avisa al toque si cambió la
 * SECCIÓN (lo único que muestra la lista de conectados); dentro de la misma sección, la ruta nueva va en el próximo aviso.
 */
export function Latido() {
  const ruta = usePathname()
  const rutaActual = useRef(ruta)
  const seccionAvisada = useRef<string | null>(null)
  const avisar = useRef<() => void>(() => {})

  useEffect(() => {
    avisar.current = () => {
      if (document.visibilityState !== 'visible') return
      seccionAvisada.current = seccionDeRuta(rutaActual.current)
      void fetch('/api/presencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta: rutaActual.current }),
        keepalive: true,
      })
        .then(async (r) => {
          if (!r.ok) return
          const j = (await r.json()) as { conectados?: unknown }
          if (Array.isArray(j.conectados)) window.dispatchEvent(new CustomEvent(EVENTO_CONECTADOS, { detail: j.conectados }))
        })
        .catch(() => {})
    }
    const tick = () => avisar.current()
    tick()
    const id = setInterval(tick, INTERVALO_LATIDO_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  useEffect(() => {
    rutaActual.current = ruta
    if (seccionAvisada.current !== null && seccionDeRuta(ruta) !== seccionAvisada.current) avisar.current()
  }, [ruta])

  return null
}
