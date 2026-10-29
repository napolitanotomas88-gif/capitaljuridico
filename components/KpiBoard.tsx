'use client'

import { fmtMoneda } from './tablero'

export interface KpiItem {
  label: string
  value: number | null
  format: 'number' | 'currency' | 'percent' | 'ratio'
  sub?: string
  highlight?: boolean
  tone?: 'good' | 'warn' | 'bad'   // colorea el valor (semáforos)
}

export interface KpiGroup {
  title: string
  items: KpiItem[]
}

interface Props {
  groups: KpiGroup[]
  periodLabel: string
  title?: string
}

function fmt(v: number | null, format: KpiItem['format']): string {
  if (v == null) return '—'
  switch (format) {
    // Montos chicos (CPL, costo por seguidor) con centavos: $2.09 y no "$2"; el cero es "$0"
    case 'currency': return fmtMoneda(v)
    case 'percent':  return `${v.toFixed(1)}%`
    case 'ratio':    return `${v.toFixed(2)}x`
    default:         return Math.round(v).toLocaleString('en-US')
  }
}

const TONE: Record<NonNullable<KpiItem['tone']>, string> = {
  good: 'var(--tono-bueno)', warn: 'var(--brand-texto)', bad: 'var(--tono-malo)',
}

export function KpiBoard({ groups, periodLabel, title = 'Tablero rápido' }: Props) {
  return (
    <div className="glass-board" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          {title}
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{periodLabel}</p>
      </div>

      {groups.map(g => (
        <div key={g.title} style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
              {g.title}
            </p>
            <div style={{ flex: 1, height: 1, background: 'color-mix(in srgb, var(--border) 70%, transparent)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 8 }}>
            {g.items.map(it => (
              <div key={it.label} className="glass-tile" style={{
                padding: '10px 12px',
                borderTop: it.highlight ? '2px solid var(--brand-orange)' : undefined,
              }}>
                <p style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.25, minHeight: 24, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {it.label}
                </p>
                <p style={{
                  fontSize: 17, fontWeight: 800, lineHeight: 1.15, marginTop: 3,
                  fontVariantNumeric: 'tabular-nums',
                  color: it.value == null ? 'var(--text-muted)' : it.tone ? TONE[it.tone] : 'var(--text)',
                }}>
                  {fmt(it.value, it.format)}
                </p>
                {it.sub && (
                  <p style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.25 }}>{it.sub}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
