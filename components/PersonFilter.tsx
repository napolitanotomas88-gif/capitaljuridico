'use client'

interface Props {
  closers: string[]
  selected: string   // '' = todos
  onChange: (v: string) => void
}

export function PersonFilter({ closers, selected, onChange }: Props) {
  const options = ['', ...closers]
  const labels: Record<string, string> = { '': 'Todos' }

  return (
    <div className="flex flex-wrap items-center gap-2 fila-deslizable">
      {options.map(c => (
        <button
          key={c}
          className={`filter-pill ${selected === c ? 'active' : ''}`}
          onClick={() => onChange(c)}
        >
          {labels[c] ?? c}
        </button>
      ))}
    </div>
  )
}
