'use client'

export interface TicketEntry {
  label: string
  amount: number
  count: number
  color: string
}

interface Props {
  entries: TicketEntry[]
  aovFeccu: number | null   // FECCU del período ÷ clientes nuevos (AOV sobre primer pago)
  feccuDeals: number        // cantidad de clientes nuevos (ventas FECCU)
  // AOV separado por embudo (misma atribución que el cash)
  aovVSL: number | null
  dealsVSL: number
  aovIG: number | null
  dealsIG: number
}

function fmtUSD(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function TicketCard({ entries, aovFeccu, feccuDeals, aovVSL, dealsVSL, aovIG, dealsIG }: Props) {
  const withData = entries.filter(e => e.count > 0)

  if (withData.length === 0 && aovFeccu === null) return null

  return (
    <div className="card p-5">
      <p className="section-title">Ticket Promedio</p>

      {aovFeccu !== null && (
        <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            AOV — solo FECCU (primer pago)
          </p>
          <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-red)', lineHeight: 1.1, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {fmtUSD(aovFeccu)}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {feccuDeals} {feccuDeals === 1 ? 'cierre' : 'cierres'} en el período (hojas de closers)
          </p>

          {/* AOV por embudo */}
          {(aovVSL != null || aovIG != null) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
                  AOV VSL
                </p>
                <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--tono-malo)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {aovVSL != null ? fmtUSD(aovVSL) : '—'}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {dealsVSL} {dealsVSL === 1 ? 'cierre' : 'cierres'}
                </p>
              </div>
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
                  AOV Instagram
                </p>
                <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--brand-texto)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {aovIG != null ? fmtUSD(aovIG) : '—'}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {dealsIG} {dealsIG === 1 ? 'cierre' : 'cierres'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {withData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {withData.map(e => (
            <div key={e.label} style={{
              background: 'var(--bg)',
              borderRadius: 10,
              padding: '10px 12px',
            }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
                {e.label}
              </p>
              <p style={{ fontSize: 18, fontWeight: 800, color: e.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {fmtUSD(e.amount / e.count)}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                {e.count} op.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
