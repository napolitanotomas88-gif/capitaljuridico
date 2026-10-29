'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { enviarEdicion, type RespuestaEnvio, type RutaEdicion } from './enviar'

// El envío de una acción desde un componente: estado "guardando", el mensaje (con aria-live en quien lo muestre) y el
// refresco de la página cuando salió bien o cuando otra persona cambió algo en el medio (409 conflicto). En el ejemplo
// (?demo=1) no manda nada: dice que no se guarda.
export interface Mensaje { texto: string; error: boolean }

export function useEnvio(demo: boolean) {
  const router = useRouter()
  const [enviando, setEnviando] = useState(false)
  const [msj, setMsj] = useState<Mensaje | null>(null)

  const enviar = useCallback(async (cuerpo: Record<string, unknown>, op: { ruta?: RutaEdicion; refrescar?: boolean } = {}): Promise<RespuestaEnvio | null> => {
    if (enviando) return null
    if (demo) {
      setMsj({ texto: 'Ejemplo: no se guarda.', error: false })
      return null
    }
    setEnviando(true)
    setMsj(null)
    const r = await enviarEdicion(cuerpo, op.ruta)
    setEnviando(false)
    setMsj({ texto: r.mensaje, error: !r.ok })
    if ((r.ok && op.refrescar !== false) || r.codigo === 'conflicto') router.refresh()
    return r
  }, [demo, enviando, router])

  return { enviando, msj, setMsj, enviar }
}
