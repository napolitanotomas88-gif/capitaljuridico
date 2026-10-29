'use client'

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

// Hoja "Cuotas a Cobrar": J4 = suma de la col E "Monto por Cobrar" (lo PENDIENTE) y
// M4 = suma de la col F "Monto Cobrado". El total del plan es la suma de las dos.
interface Props {
  pendiente: number | null   // 'Cuotas a Cobrar'!J4
  cobradas: number | null    // 'Cuotas a Cobrar'!M4
  noPaga?: number | null     // 'Cuotas a Cobrar'!J17: parte del pendiente marcada "No Paga"
}

export function CuotasCard({ pendiente, cobradas, noPaga }: Props) {
  const ok = pendiente !== null && cobradas !== null
  const total = ok ? (pendiente as number) + (cobradas as number) : null
  const pct = ok && (total as number) > 0 ? ((cobradas as number) / (total as number)) * 100 : 0

  return (
    <div className="goal-card">
      <p className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>
        Cuotas a Cobrar
      </p>
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[
          { label: 'Total',     val: total,     color: 'var(--text)' },
          { label: 'Cobrado',   val: cobradas,  color: 'var(--tono-bueno)' },
          { label: 'Pendiente', val: pendiente, color: 'var(--brand-texto)' },
        ].map(({ label, val, color }) => (
          <div key={label}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-xl font-black tabular-nums" style={{ color }}>
              {val !== null ? fmtUSD(val) : '—'}
            </p>
          </div>
        ))}
      </div>
      <div className="cuotas-bar">
        <div className="cuotas-fill" style={{ width: `${ok ? pct : 0}%` }} />
      </div>
      {ok && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          {pct.toFixed(1)}% cobrado · cobrado ÷ (cobrado + pendiente)
          {noPaga != null && noPaga > 0 ? ` · el pendiente incluye ${fmtUSD(noPaga)} marcados "No Paga"` : ''}
        </p>
      )}
    </div>
  )
}
