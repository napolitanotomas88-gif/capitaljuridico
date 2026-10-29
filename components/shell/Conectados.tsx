'use client'

import { useEffect, useRef, useState } from 'react'
import { INTERVALO_LATIDO_MS } from '@/lib/presencia/intervalo'

type Conectado = { email: string; nombre: string; seccion: string; ultima: string }

const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || n

/**
 * Quién está conectado ahora (lo ve todo el equipo, decisión de Tomás del 27/10/2026). Una línea "● 3 conectados" que se despliega con la lista
 * (nombre y sección). Se actualiza cada 45 s mientras la pestaña está a la vista y el elemento se ve (en el celular la barra
 * lateral no se muestra: ahí está en la hoja "Más").
 */
export function Conectados() {
  const [lista, setLista] = useState<Conectado[] | null>(null)
  const [abierta, setAbierta] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    const leer = async () => {
      if (document.visibilityState !== 'visible' || !ref.current || ref.current.offsetParent === null) return
      try {
        const r = await fetch('/api/presencia', { cache: 'no-store' })
        if (!r.ok) return
        const j = (await r.json()) as { conectados?: Conectado[] }
        if (vivo) setLista(j.conectados ?? [])
      } catch {
        /* sin red: queda la última lista */
      }
    }
    void leer()
    const id = setInterval(leer, INTERVALO_LATIDO_MS)
    document.addEventListener('visibilitychange', leer)
    return () => {
      vivo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', leer)
    }
  }, [])

  const n = lista?.length ?? 0
  return (
    <div ref={ref} className="cj-conectados">
      <button type="button" className="cj-conectados__resumen" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)} disabled={!lista}>
        <span className="cj-conectados__punto" aria-hidden="true" />
        {lista === null ? 'Conectados…' : n === 1 ? '1 conectado' : `${n} conectados`}
      </button>
      {abierta && lista && (
        <ul className="cj-conectados__lista">
          {lista.length === 0 && <li>Nadie más por ahora</li>}
          {lista.map((c) => (
            <li key={c.email} title={c.email}>
              <strong>{primerNombre(c.nombre)}</strong> · {c.seccion}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
