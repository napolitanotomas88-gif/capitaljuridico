'use client'

// ── A revisar: pruebas y cambios con fecha de revisión (test con/sin intereses, conjuntos Winners/Charlie…), 8/11/2026 ──
// Va arriba de todo: cada fila dice qué se hizo, en qué día va (día X de N) y cuántos faltan para revisarlo.
// Los datos salen de la pestaña «Ads Revisiones» de la planilla de Clientes; «revisado» en la columna H la oculta.
import { useEffect, useState } from 'react'
import type { RevisionVista } from '@/lib/anuncios/revisiones'

const dm = (ymd: string) => `${+ymd.slice(8, 10)}/${+ymd.slice(5, 7)}`

function cuando(r: RevisionVista): { txt: string; color: string } {
  if (r.vencida) return { txt: `Vencida hace ${-r.faltan} día${r.faltan === -1 ? '' : 's'}`, color: 'var(--borgona)' }
  if (r.hoyToca) return { txt: 'Hoy toca revisar', color: 'var(--laton)' }
  return { txt: `Faltan ${r.faltan} día${r.faltan === 1 ? '' : 's'}`, color: 'var(--hueso)' }
}

export function PanelRevisiones() {
  const [lista, setLista] = useState<RevisionVista[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/anuncios/revisiones', { cache: 'no-store' })
      .then(r => r.json().then(j => (r.ok ? setLista(j.revisiones ?? []) : setError(j.error ?? 'No se pudieron leer las revisiones'))))
      .catch(() => setError('No se pudieron leer las revisiones'))
  }, [])
  if (error) return <section aria-label="A revisar" className="mb-8"><p style={{ fontSize: 13, color: 'var(--humo)' }}>A revisar: {error}</p></section>
  if (!lista?.length) return null
  const urgentes = lista.filter(r => r.vencida || r.hoyToca).length
  return (
    <section id="a-revisar" aria-label="A revisar" className="mb-8" style={{ borderLeft: '2px solid var(--laton)', paddingLeft: 16 }}>
      <p className="etq-laton">A revisar · {lista.length}{urgentes ? ` · ${urgentes} para hoy` : ''}</p>
      <p className="mt-1" style={{ fontSize: 13, color: 'var(--humo)' }}>Pruebas y cambios en curso: no tocarlos hasta la fecha de revisión, así terminan de aprender.</p>
      <ul className="mt-3 flex flex-col">
        {lista.map(r => {
          const c = cuando(r)
          const avance = Math.min(1, Math.max(0, (r.dia - 1) / r.total))
          return (
            <li key={r.fila} className="py-3 grid gap-x-6 gap-y-1 lg:grid-cols-[minmax(0,1fr)_260px]" style={{ borderTop: '1px solid var(--filete)', fontSize: 14 }}>
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span style={{ color: 'var(--hueso)', fontWeight: 600 }}>{r.cliente}</span>
                  {r.tipo && <span style={{ fontSize: 12, color: 'var(--laton)' }}>{r.tipo}</span>}
                </div>
                {r.hecho && <p className="mt-1">{r.hecho}</p>}
                {r.mirar && <p className="mt-1" style={{ fontSize: 13, color: 'var(--humo)' }}>Mirar: {r.mirar}</p>}
                {r.conjuntos && <p className="mt-1" style={{ fontSize: 12, color: 'var(--humo)' }}>{r.conjuntos}</p>}
              </div>
              <div className="lg:text-right">
                <div className="num" style={{ color: c.color, fontWeight: 600 }}>{c.txt}</div>
                <div className="num" style={{ fontSize: 12, color: 'var(--humo)' }}>Día {Math.min(r.dia, r.total)} de {r.total} · desde el {dm(r.inicio)} · revisar el {dm(r.revisar)}</div>
                <div aria-hidden="true" className="mt-2" style={{ height: 4, background: 'var(--filete)' }}>
                  <div style={{ height: 4, width: `${Math.round(avance * 100)}%`, background: c.color }} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
