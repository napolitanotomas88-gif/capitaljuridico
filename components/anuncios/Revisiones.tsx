'use client'

// ── A revisar: pruebas y cambios con fecha de revisión (test con/sin intereses, conjuntos Winners/Charlie…), 8/11/2026 ──
// Va arriba de todo: cada fila dice qué se hizo, en qué día va (día X de N) y cuántos faltan para revisarlo.
// 10/11: plegable (el panel entero y cada cliente) y con links al Administrador de anuncios.
// Los datos salen de la pestaña «Ads Revisiones» de la planilla de Clientes; «revisado» en la columna H la oculta.
import { useEffect, useState } from 'react'
import type { RevisionVista } from '@/lib/anuncios/revisiones'

const dm = (ymd: string) => `${+ymd.slice(8, 10)}/${+ymd.slice(5, 7)}`

function cuando(r: RevisionVista): { txt: string; color: string } {
  if (r.vencida) return { txt: `Vencida hace ${-r.faltan} día${r.faltan === -1 ? '' : 's'}`, color: 'var(--borgona)' }
  if (r.hoyToca) return { txt: 'Hoy toca revisar', color: 'var(--laton)' }
  return { txt: `Faltan ${r.faltan} día${r.faltan === 1 ? '' : 's'}`, color: 'var(--hueso)' }
}

const CLAVE_ABIERTO = 'anuncios-revisiones-abierto'

function Fila({ r }: { r: RevisionVista }) {
  const c = cuando(r)
  const avance = Math.min(1, Math.max(0, (r.dia - 1) / r.total))
  return (
    <li style={{ borderTop: '1px solid var(--filete)', fontSize: 14 }}>
      <details open={r.vencida || r.hoyToca} className="group">
        <summary className="py-3 grid gap-x-6 gap-y-1 lg:grid-cols-[minmax(0,1fr)_260px] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90" style={{ color: 'var(--laton)', fontSize: 11 }}>▶</span>
            <span style={{ color: 'var(--hueso)', fontWeight: 600 }}>{r.cliente}</span>
            {r.tipo && <span style={{ fontSize: 12, color: 'var(--laton)' }}>{r.tipo}</span>}
          </div>
          <div className="lg:text-right">
            <div className="num" style={{ color: c.color, fontWeight: 600 }}>{c.txt}</div>
            <div aria-hidden="true" className="mt-1 lg:ml-auto" style={{ height: 3, background: 'var(--filete)', maxWidth: 260 }}>
              <div style={{ height: 3, width: `${Math.round(avance * 100)}%`, background: c.color }} />
            </div>
          </div>
        </summary>
        <div className="pb-3 pl-5 grid gap-x-6 gap-y-1 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            {r.hecho && <p>{r.hecho}</p>}
            {r.mirar && <p className="mt-1" style={{ fontSize: 13, color: 'var(--humo)' }}>Mirar: {r.mirar}</p>}
            {r.links?.length ? (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 13 }}>
                {r.links.map(l => l.url
                  ? <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--laton)', textDecoration: 'underline' }}>Abrir {l.etiqueta} ↗</a>
                  : <span key={l.id} style={{ color: 'var(--humo)' }}>{l.etiqueta} {l.id}</span>)}
              </p>
            ) : r.conjuntos ? <p className="mt-1" style={{ fontSize: 12, color: 'var(--humo)' }}>{r.conjuntos}</p> : null}
          </div>
          <div className="lg:text-right num" style={{ fontSize: 12, color: 'var(--humo)' }}>Día {Math.min(r.dia, r.total)} de {r.total} · desde el {dm(r.inicio)} · revisar el {dm(r.revisar)}</div>
        </div>
      </details>
    </li>
  )
}

export function PanelRevisiones() {
  const [lista, setLista] = useState<RevisionVista[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbiertoEstado] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem(CLAVE_ABIERTO) === 'no') setAbiertoEstado(false) } catch { /* nada */ }
    fetch('/api/anuncios/revisiones', { cache: 'no-store' })
      .then(r => r.json().then(j => (r.ok ? setLista(j.revisiones ?? []) : setError(j.error ?? 'No se pudieron leer las revisiones'))))
      .catch(() => setError('No se pudieron leer las revisiones'))
  }, [])
  const setAbierto = (v: boolean) => { setAbiertoEstado(v); try { localStorage.setItem(CLAVE_ABIERTO, v ? 'si' : 'no') } catch { /* nada */ } }
  if (error) return <section aria-label="A revisar" className="mb-8"><p style={{ fontSize: 13, color: 'var(--humo)' }}>A revisar: {error}</p></section>
  if (!lista?.length) return null
  const urgentes = lista.filter(r => r.vencida || r.hoyToca).length
  return (
    <section id="a-revisar" aria-label="A revisar" className="mb-8" style={{ borderLeft: '2px solid var(--laton)', paddingLeft: 16 }}>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="flex items-center gap-2 text-left">
        <span aria-hidden="true" className="inline-block transition-transform" style={{ color: 'var(--laton)', fontSize: 11, transform: abierto ? 'rotate(90deg)' : 'none' }}>▶</span>
        <span className="etq-laton">A revisar · {lista.length}{urgentes ? ` · ${urgentes} para hoy` : ''}</span>
      </button>
      {abierto && (
        <>
          <p className="mt-1" style={{ fontSize: 13, color: 'var(--humo)' }}>Pruebas y cambios en curso: no tocarlos hasta la fecha de revisión, así terminan de aprender. Tocá cada cliente para ver el detalle.</p>
          <ul className="mt-3 flex flex-col">
            {lista.map(r => <Fila key={r.fila} r={r} />)}
          </ul>
        </>
      )}
    </section>
  )
}
