'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { INTERVALO_LATIDO_MS } from '@/lib/presencia/intervalo'

/**
 * Avisa que esta pestaña sigue abierta (quién está conectado, 27/10/2026): al entrar, cada 45 s mientras la pestaña está a la
 * vista y al volver a ella. Con la pestaña escondida no avisa, así que a los 2 minutos la persona deja de figurar.
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
      }).catch(() => {})
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
