'use client'

import { Metric } from '@/lib/sheets'

function formatValue(value: number | null, format: Metric['format']): string {
  if (value === null) return '—'
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value)
    case 'percent':
      return `${value.toFixed(1)}%`
    default:
      return new Intl.NumberFormat('en-US').format(value)
  }
}

interface Props {
  metric: Metric
}

export function MetricCard({ metric }: Props) {
  const isNegative = metric.value !== null && metric.value < 0
  const noData = metric.value === null

  return (
    <div className="metric-card group">
      <p className="metric-label">{metric.label}</p>
      <p
        className={`metric-value ${
          noData ? 'text-zinc-600' : isNegative ? 'text-red-400' : 'text-cyan-300'
        }`}
      >
        {formatValue(metric.value, metric.format)}
      </p>
      <div className="metric-glow" />
    </div>
  )
}
