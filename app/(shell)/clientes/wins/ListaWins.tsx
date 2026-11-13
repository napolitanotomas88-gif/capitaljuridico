'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ItemWin, useBorrarWin } from '@/components/clientes/WinsCliente'
import { filtrarWins, type Win } from '@/lib/clientes/wins/modelo'
import '@/components/clientes/puntaje.css'

// Lista de todos los wins con filtro por cliente y por «autorizado para usar» (del más nuevo al más viejo).
export function ListaWins({ wins, clientes, puedeBorrar }: { wins: Win[]; clientes: { id: string; nombre: string }[]; puedeBorrar: boolean }) {
  const router = useRouter()
  const [cliente, setCliente] = useState('')
  const [autorizado, setAutorizado] = useState<'' | 'si' | 'no'>('')
  const nombreDe = useMemo(() => new Map(clientes.map(c => [c.id, c.nombre])), [clientes])
  // En el filtro, solo los clientes que tienen algún win
  const conWins = useMemo(() => [...new Set(wins.map(w => w.idCrm))].map(id => ({ id, nombre: nombreDe.get(id) ?? id })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [wins, nombreDe])
  const visibles = filtrarWins(wins, { idCrm: cliente || null, autorizado: autorizado === '' ? null : autorizado === 'si' })
  const { borrar, dialogo, error } = useBorrarWin(() => router.refresh())
  return (
    <div className="pz">
      {dialogo}
      <div className="pz-filtros">
        <label className="pz-campo">
          <span className="cj-etiqueta">Cliente</span>
          <select className="pz-input" value={cliente} onChange={e => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {conWins.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.id})</option>)}
          </select>
        </label>
        <label className="pz-campo">
          <span className="cj-etiqueta">Autorizado para usar</span>
          <select className="pz-input" value={autorizado} onChange={e => setAutorizado(e.target.value as '' | 'si' | 'no')}>
            <option value="">Todos</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </label>
        <p className="cj-texto-2" role="status">{visibles.length === 1 ? '1 win' : `${visibles.length} wins`}</p>
      </div>
      {error && <p className="cj-aviso" role="alert">{error}</p>}
      {visibles.length === 0
        ? <p className="cj-texto-2">{wins.length ? 'Ningún win con esos filtros.' : 'Todavía no hay wins cargados.'}</p>
        : <ul className="pz-wins">{visibles.map(w => <ItemWin key={w.id} w={w} nombre={nombreDe.get(w.idCrm) ?? w.idCrm} alBorrar={puedeBorrar ? borrar : undefined} />)}</ul>}
    </div>
  )
}
