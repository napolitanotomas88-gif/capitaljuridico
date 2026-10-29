'use client'
// Piezas visuales del dashboard de Finanzas (mismo look cristal que el dashboard principal)
import type { ReactNode } from 'react'

export const fmtUsd = (n: number | null | undefined, dec = 0) =>
  n == null ? '—' : `${n < 0 ? '−' : ''}US$ ${Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
export const fmtArs = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '−' : ''}AR$ ${Math.abs(Math.round(n)).toLocaleString('es-AR')}`
export const fmtPct = (n: number | null | undefined, dec = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`

export function Seccion({ titulo, subtitulo, children, accion }: { titulo: string; subtitulo?: ReactNode; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="card p-4 md:p-5" style={{ minWidth: 0 }}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div style={{ minWidth: 0 }}>
          <h2 className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--text-muted)' }}>{titulo}</h2>
          {subtitulo && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{subtitulo}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  )
}

export function Tile({ label, valor, nota, tono }: { label: string; valor: string; nota?: ReactNode; tono?: 'bien' | 'mal' | 'neutro' }) {
  const color = tono === 'bien' ? 'var(--fin-bien)' : tono === 'mal' ? 'var(--fin-mal)' : 'var(--text)'
  return (
    <div className="glass-tile p-3 md:p-4" style={{ minWidth: 0 }}>
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl md:text-2xl font-black mt-1 tabular-nums" style={{ color, overflowWrap: 'anywhere' }}>{valor}</p>
      {nota && <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{nota}</p>}
    </div>
  )
}

// Barra de magnitud (un solo tono: el color de marca). El texto va siempre en tinta de texto.
export function Barra({ label, valor, max, texto, nota, marca }: { label: ReactNode; valor: number; max: number; texto: string; nota?: ReactNode; marca?: ReactNode }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, valor / max)) : 0
  return (
    <div className="py-1.5" title={`${typeof label === 'string' ? label : ''} ${texto}`}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span style={{ color: 'var(--text)', minWidth: 0 }} className="truncate">{label} {marca}</span>
        <span className="tabular-nums font-semibold shrink-0" style={{ color: 'var(--text)' }}>{texto}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--fin-pista)', marginTop: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 4, background: 'var(--brand-orange)', minWidth: valor > 0 ? 4 : 0 }} />
      </div>
      {nota && <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{nota}</p>}
    </div>
  )
}

export function Etiqueta({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'aviso' | 'neutro' | 'mal' | 'bien' }) {
  const fondo = tono === 'aviso' ? 'var(--fin-aviso-bg)' : tono === 'mal' ? 'var(--fin-mal-bg)' : tono === 'bien' ? 'var(--fin-bien-bg)' : 'var(--fin-pista)'
  const color = tono === 'aviso' ? 'var(--fin-aviso)' : tono === 'mal' ? 'var(--fin-mal)' : tono === 'bien' ? 'var(--fin-bien)' : 'var(--text)'
  // Fondo propio y más oscuro que el vidrio de la tarjeta: así el texto de la etiqueta no depende del brillo de atrás
  return (
    <span className="inline-block text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 align-middle" style={{ backgroundColor: fondo, backgroundImage: 'linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28))', color }}>
      {children}
    </span>
  )
}

export function Aviso({ children, tono = 'aviso' }: { children: ReactNode; tono?: 'aviso' | 'mal' }) {
  return (
    <div role={tono === 'mal' ? 'alert' : 'status'} className="text-xs rounded-xl px-3 py-2 mt-2" style={{
      background: tono === 'mal' ? 'var(--fin-mal-bg)' : 'var(--fin-aviso-bg)',
      color: 'var(--text)', border: `1px solid ${tono === 'mal' ? 'var(--fin-mal)' : 'var(--fin-aviso)'}`,
    }}>
      <span style={{ color: tono === 'mal' ? 'var(--fin-mal)' : 'var(--fin-aviso)', fontWeight: 700 }}>{tono === 'mal' ? '✕ ' : '! '}</span>
      {children}
    </div>
  )
}
