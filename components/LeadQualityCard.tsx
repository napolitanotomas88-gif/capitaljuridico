'use client'

export interface LetraStats {
  agendas: number
  cierres: number
  cash: number
}

interface Props {
  stats: Record<'A' | 'B' | 'C' | 'D' | 'E', LetraStats>
  sinClasificar: number   // llamadas del período sin urgencia cargada (col M vacía)
  periodLabel: string
}

// Descripciones según la fórmula de la col Q "Lead Scoring" del CRM de ventas (urgencia × facturación mensual)
const LETRAS: Array<{ key: 'A' | 'B' | 'C' | 'D' | 'E'; color: string; texto: string; desc: string }> = [
  { key: 'A', color: '#1f6b52', texto: 'var(--tono-bueno)', desc: 'YA + factura $750–1.5K' },
  { key: 'B', color: '#5f9a7a', texto: 'var(--tono-bueno)', desc: 'YA + $1.5K o más · 2–4 sem + $1.5–3K' },
  { key: 'C', color: '#be8f49', texto: 'var(--brand-texto)', desc: 'YA + $0–750 · 2–4 sem + otras · meses + $0–750' },
  { key: 'D', color: '#7f202c', texto: 'var(--tono-malo)', desc: '2–4 sem + $0–750 · meses + $1.5–3K · aún no sé' },
  { key: 'E', color: '#8c7b62', texto: 'var(--text-muted)', desc: 'Meses + factura alta · aún no sé + $1.5–3K' },
]

function fmtUSD(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function LeadQualityCard({ stats, sinClasificar, periodLabel }: Props) {
  const total = LETRAS.reduce((s, l) => s + stats[l.key].agendas, 0)
  if (total === 0) return null

  return (
    <div className="card p-5">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <p className="section-title" style={{ marginBottom: 0 }}>Lead Scoring — A · B · C · D · E</p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{periodLabel}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
        {LETRAS.map(({ key, color, texto, desc }) => {
          const s = stats[key]
          const pct = total > 0 ? (s.agendas / total) * 100 : 0
          const cashPorCall = s.agendas > 0 ? s.cash / s.agendas : 0
          const tasa = s.agendas > 0 ? (s.cierres / s.agendas) * 100 : 0
          return (
            <div key={key} style={{
              background: 'var(--bg)',
              borderRadius: 12,
              padding: '12px 14px',
              borderTop: `3px solid ${color}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: texto }}>{key}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {s.agendas}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({pct.toFixed(0)}%)</span>
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, minHeight: 26, lineHeight: 1.3 }}>{desc}</p>

              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                  Cash × llamada
                </p>
                <p style={{ fontSize: 18, fontWeight: 800, color: texto, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                  {fmtUSD(cashPorCall)}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {s.cierres} {s.cierres === 1 ? 'cierre' : 'cierres'} ({tasa.toFixed(1)}%) · {fmtUSD(s.cash)} total
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 10 }}>
        Letra de la columna &quot;Lead Scoring&quot; (col Q) de las hojas de closers: la misma fórmula del CRM (urgencia × facturación).
        Cash = FECCU del Registro de Pagos matcheado por nombre o teléfono del cliente.
        {sinClasificar > 0 ? ` ${sinClasificar} ${sinClasificar === 1 ? 'agenda sin Lead Scoring (no clasificada)' : 'agendas sin Lead Scoring (no clasificadas)'}.` : ''}
      </p>
    </div>
  )
}
