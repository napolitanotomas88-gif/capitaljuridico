'use client'

interface Props {
  label: string
  value: number | null
  format: 'currency' | 'number' | 'percent' | 'ratio'
  sub?: string
  highlight?: boolean
}

function fmt(v: number | null, format: Props['format']): { main: string; unit: string } {
  if (v === null) return { main: '—', unit: '' }
  switch (format) {
    case 'currency':
      return { main: `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, unit: '' }
    case 'percent':
      return { main: v.toFixed(1), unit: '%' }
    case 'ratio':
      return { main: v.toFixed(2), unit: 'x' }
    default:
      return { main: v.toLocaleString('en-US'), unit: '' }
  }
}

export function BigMetricCard({ label, value, format, sub, highlight }: Props) {
  const { main, unit } = fmt(value, format)
  const isNeg = value !== null && value < 0

  return (
    <div className="big-metric">
      <p className="bm-label">{label}</p>
      <div className="flex items-baseline gap-0.5 mt-2">
        <span
          className="bm-value"
          style={{
            color: isNeg ? 'var(--tono-malo)' : highlight ? 'var(--brand-texto)' : 'var(--brand-num)',
          }}
        >
          {main}
        </span>
        {unit && <span className="bm-unit">{unit}</span>}
      </div>
      {sub && <p className="bm-sub">{sub}</p>}
    </div>
  )
}
