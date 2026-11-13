'use client'

// ── Notas del cliente: lo que cada cliente dijo de sus anuncios en su grupo de WhatsApp (lib/bot/anuncios/notas.ts) ──────
// Fecha, lo que dijo y lo que pide; latón = hay que hacer algo (el aviso fue a Valen en #📣-ads). El link del aviso trae
// ?nota=<id>#notas: esa nota se resalta y el panel se abre. Mismo estilo que el resto del tablero: filetes finos, sin sombras.
import { useEffect, useState } from 'react'
import type { NotaCliente } from '@/lib/bot/anuncios/notasNeon'
import { etiquetaTipo } from '@/lib/bot/anuncios/notas'

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })
const VISIBLES = 8
// 10/11/2026 (Tomás): solo las que sirven para cambiar la estrategia — cómo vienen las consultas (bien o mal), zona, tipo de caso,
// presupuesto, pausas, horarios, videos/copy. Los temas de pago/tarjeta y los comentarios sueltos quedan detrás de «ver también».
export const esImportante = (n: Pick<NotaCliente, 'avisar' | 'pide' | 'tipo'>) => n.tipo !== 'pago' && (n.tipo === 'calidad_consultas' || ((n.avisar || !!n.pide) && n.tipo !== 'otro') || (n.tipo === 'otro' && !!n.pide))

export function NotasCliente() {
  const [notas, setNotas] = useState<NotaCliente[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // La nota del link del aviso (?nota=<id>): se lee una vez; mientras no hay notas el panel no pinta nada, así no hay desfase con el servidor
  const [foco] = useState<number | null>(() => (typeof window === 'undefined' ? null : Number(new URLSearchParams(window.location.search).get('nota')) || null))
  const [todas, setTodas] = useState(() => foco !== null)
  const [conResto, setConResto] = useState(false)
  useEffect(() => {
    fetch('/api/anuncios/notas', { cache: 'no-store' })
      .then(r => r.json().then(j => (r.ok ? setNotas(j.notas ?? []) : setError(j.error ?? 'No se pudieron leer las notas'))))
      .catch(() => setError('No se pudieron leer las notas'))
  }, [])
  useEffect(() => {
    if (notas && foco) setTimeout(() => document.getElementById(`nota-${foco}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }, [notas, foco])
  if (error) return <section id="notas" aria-label="Notas del cliente" className="mt-8"><p style={{ fontSize: 13, color: 'var(--humo)' }}>Notas del cliente: {error}</p></section>
  if (!notas) return null
  const importantes = notas.filter(n => esImportante(n) || n.id === foco)
  const resto = notas.length - importantes.length
  const base = conResto ? notas : importantes
  const pendientes = importantes.filter(n => n.avisar).length
  const lista = todas ? base : base.slice(0, VISIBLES)
  return (
    <details id="notas" open={foco !== null} aria-label="Notas del cliente" className="anu-solapa">
      <summary className="etq-laton">Notas del cliente: {importantes.length} importantes{pendientes ? `, ${pendientes} con pedido` : ''}</summary>
      <p className="mt-1 anu-nota">Lo que dijeron de sus anuncios en su grupo de WhatsApp (últimos 60 días), solo lo que sirve para la estrategia: pedidos, cosas a tener en cuenta y cómo vienen las consultas. El bot solo lee.</p>
      {!importantes.length && !conResto && <p className="mt-3 anu-nota">No hay notas importantes.</p>}
      <ul className="mt-3 flex flex-col">
        {lista.map(n => (
          <li key={n.id} id={`nota-${n.id}`} className="py-3" style={{ borderTop: '1px solid var(--filete)', fontSize: 14, ...(foco === n.id ? { background: 'color-mix(in srgb, var(--laton) 12%, transparent)', paddingLeft: 8, paddingRight: 8 } : {}) }}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="num" style={{ color: 'var(--humo)', fontSize: 13 }}>{fecha(n.enviado)}</span>
              <span style={{ color: 'var(--hueso)', fontWeight: 600 }}>{n.cliente}</span>
              <span style={{ fontSize: 12, color: 'var(--humo)' }}>{etiquetaTipo(n.tipo)}{n.grupo ? ` · grupo ${n.grupo}` : ''}</span>
              {n.estado === 'aviso_fallido' && <span style={{ fontSize: 12, color: '#f0b1b8' }}>el aviso a Valen no salió</span>}
            </div>
            <p className="mt-1">{n.dijo}</p>
            {n.pide && <p className="mt-1" style={{ color: 'var(--laton)' }}>Pide: {n.pide}</p>}
            {!n.pide && n.avisar && <p className="mt-1" style={{ color: 'var(--laton)' }}>Tenerlo en cuenta para la campaña</p>}
            {n.texto && <details className="mt-1" style={{ fontSize: 13, color: 'var(--humo)' }}><summary style={{ cursor: 'pointer' }}>Mensaje original</summary><p className="mt-1" style={{ whiteSpace: 'pre-wrap' }}>{n.texto}</p></details>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-x-5" style={{ fontSize: 13 }}>
        {base.length > VISIBLES && <button type="button" className="enlace" onClick={() => setTodas(!todas)}>{todas ? 'Ver menos' : `Ver las ${base.length}`}</button>}
        {resto > 0 && <button type="button" className="enlace" onClick={() => setConResto(!conResto)}>{conResto ? 'Ocultar los comentarios sueltos' : `Ver también ${resto} comentario${resto > 1 ? 's' : ''} suelto${resto > 1 ? 's' : ''}`}</button>}
      </div>
    </details>
  )
}
