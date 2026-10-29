'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Mientras el bot lee el mapa del video (zona_video "pedido" o "leyendo"), la ficha se vuelve a pedir cada 20 s (solo los
// datos del servidor: router.refresh no recarga la página ni pierde lo que se está escribiendo), hasta 8 minutos. El
// aviso de Discord sale ANTES de leer el mapa: así quien abrió la ficha desde el aviso ve el resultado sin recargar.
const CADA_MS = 20_000
const HASTA_MS = 8 * 60_000

export function RefrescoMapa() {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), CADA_MS)
    const fin = setTimeout(() => clearInterval(t), HASTA_MS)
    return () => { clearInterval(t); clearTimeout(fin) }
  }, [router])
  return null
}
