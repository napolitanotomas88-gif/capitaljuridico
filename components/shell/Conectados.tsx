'use client'

import { useEffect, useState } from 'react'
import { EVENTO_CONECTADOS } from '@/lib/presencia/intervalo'

type Conectado = { email: string; nombre: string; seccion: string; ultima: string }

// La última lista que llegó: la hoja «Más» del celular se monta al abrirla y muestra lo último sin esperar al próximo latido
let ultimaLista: Conectado[] | null = null

const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || n

/**
 * Quién está conectado ahora (lo ve todo el equipo, decisión de Tomás del 27/10/2026). Una línea "● 3 conectados" que se despliega con la lista
 * (nombre y sección). Se actualiza con cada latido (cada 45 s mientras la pestaña está a la vista; en el celular la barra
 * lateral no se muestra: ahí está en la hoja "Más").
 */
export function Conectados() {
  const [lista, setLista] = useState<Conectado[] | null>(ultimaLista)
  const [abierta, setAbierta] = useState(false)

  useEffect(() => {
    // La lista llega con cada latido (Latido.tsx, cada 45 s con la pestaña a la vista): sin consulta propia. Antes había un
    // GET aparte cada 45 s por pestaña; era la segunda función que más se invocaba en Vercel (3/11/2026).
    const alLlegar = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail
      if (Array.isArray(d)) { ultimaLista = d as Conectado[]; setLista(ultimaLista) }
    }
    window.addEventListener(EVENTO_CONECTADOS, alLlegar)
    return () => window.removeEventListener(EVENTO_CONECTADOS, alLlegar)
  }, [])

  const n = lista?.length ?? 0
  return (
    <div className="cj-conectados">
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
