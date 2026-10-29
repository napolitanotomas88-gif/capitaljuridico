'use client'

export type QuickRange = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom' | 'all'

export interface DateRange {
  from: Date | null
  to: Date | null
  quick: QuickRange
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function buildDateRange(quick: QuickRange): DateRange {
  const today = startOfDay(new Date())
  switch (quick) {
    case 'today':
      return { from: today, to: new Date(), quick }
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      return { from: y, to: y, quick }
    }
    case '7d': {
      const f = new Date(today); f.setDate(f.getDate() - 6)
      return { from: f, to: new Date(), quick }
    }
    case '30d': {
      const f = new Date(today); f.setDate(f.getDate() - 29)
      return { from: f, to: new Date(), quick }
    }
    case 'month': {
      const f = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: f, to: new Date(), quick }
    }
    default:
      return { from: null, to: null, quick }
  }
}

interface Props {
  value: DateRange
  onChange: (r: DateRange) => void
}

const QUICK: { id: QuickRange; label: string }[] = [
  { id: 'all',       label: 'Todo' },
  { id: 'today',     label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: '7d',        label: '7 días' },
  { id: '30d',       label: '30 días' },
  { id: 'month',     label: 'Este mes' },
  { id: 'custom',    label: 'Custom' },
]

function toInputVal(d: Date | null) {
  if (!d) return ''
  // Fecha LOCAL, no toISOString(): un "hasta" de las 23:59 en UTC-3 mostraría el día siguiente
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function DateFilter({ value, onChange }: Props) {
  const handleQuick = (q: QuickRange) => {
    if (q === 'custom') {
      onChange({ ...value, quick: 'custom' })
    } else {
      onChange(buildDateRange(q))
    }
  }

  const handleFrom = (s: string) => {
    onChange({ ...value, from: s ? new Date(s + 'T00:00:00') : null, quick: 'custom' })
  }

  const handleTo = (s: string) => {
    onChange({ ...value, to: s ? new Date(s + 'T23:59:59') : null, quick: 'custom' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 fila-deslizable">
      {QUICK.map(q => (
        <button
          key={q.id}
          className={`filter-pill ${value.quick === q.id ? 'active' : ''}`}
          onClick={() => handleQuick(q.id)}
        >
          {q.label}
        </button>
      ))}
      {value.quick === 'custom' && (
        <div className="flex items-center gap-1">
          <input type="date" value={toInputVal(value.from)} onChange={e => handleFrom(e.target.value)} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={toInputVal(value.to)} onChange={e => handleTo(e.target.value)} />
        </div>
      )}
    </div>
  )
}
