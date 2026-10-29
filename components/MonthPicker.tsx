'use client'

const LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

interface Props {
  monthlyCash: number[]
  selected: number | null   // 0-11, null = ninguno
  onChange: (idx: number | null) => void
}

export function MonthPicker({ monthlyCash, selected, onChange }: Props) {
  return (
    <div className="fila-deslizable" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      {LABELS.map((label, i) => {
        // Habilitado si tiene cash cargado O es el mes en curso (aunque arranque en $0)
        const hasData = monthlyCash[i] > 0 || i === new Date().getMonth()
        const isActive = selected === i
        return (
          <button
            key={label}
            onClick={() => hasData ? onChange(isActive ? null : i) : undefined}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              border: `1.5px solid ${isActive ? 'var(--brand-orange)' : 'var(--border)'}`,
              background: isActive ? 'var(--brand-orange)' : 'transparent',
              color: isActive ? 'var(--on-brand)' : hasData ? 'var(--text-muted)' : 'var(--border)',
              cursor: hasData ? 'pointer' : 'default',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
