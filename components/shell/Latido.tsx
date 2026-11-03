'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { EVENTO_CONECTADOS, INTERVALO_LATIDO_MS } from '@/lib/presencia/intervalo'

/**
 * Avisa que esta pestaña sigue abierta (quién está conectado, 27/10/2026): al entrar, cada 45 s mientras la pestaña está a la
 * vista y al volver a ella. Con la pestaña escondida no avisa, así que a los 2 minutos la persona deja de figurar.
 * La respuesta trae quién está conectado y la reparte con el evento 'cj:conectados' (Conectados.tsx ya no consulta aparte).
 * No dibuja nada. Va en el marco (MarcoShell): una vez por pantalla.
 */
export function Latido() {
  const ruta = usePathname()
  useEffect(() => {
    const avisar = () => {
      if (document.visibilityState !== 'visible') return
      void fetch('/api/presencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta }),
        keepalive: true,
      })
        .then(async (r) => {
          if (!r.ok) return
          const j = (await r.json()) as { conectados?: unknown }
          if (Array.isArray(j.conectados)) window.dispatchEvent(new CustomEvent(EVENTO_CONECTADOS, { detail: j.conectados }))
        })
        .catch(() => {})
    }
    avisar()
    const id = setInterval(avisar, INTERVALO_LATIDO_MS)
    document.addEventListener('visibilitychange', avisar)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', avisar)
    }
  }, [ruta])
  return null
}
