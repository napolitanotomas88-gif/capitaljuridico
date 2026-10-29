'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  feccu: number
  feccp: number
  becc: number
}

const SLICES = [
  { key: 'FECCU', color: 'var(--s-bordo)' },
  { key: 'FECCP', color: 'var(--s-dorado)' },
  { key: 'BECC',  color: 'var(--s-dorado-claro)' },
]

function fmtUSD(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function RevenuePieChart({ feccu, feccp, becc }: Props) {
  const values: Record<string, number> = { FECCU: feccu, FECCP: feccp, BECC: becc }
  const data = SLICES
    .map(s => ({ name: s.key, value: values[s.key], color: s.color }))
    .filter(d => d.value > 0)

  if (data.length === 0) return (
    <div className="card p-6 flex items-center justify-center text-sm" style={{ height: 260, color: 'var(--text-muted)' }}>
      Sin datos en el período
    </div>
  )

  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="card p-5">
      <p className="section-title">Ingresos por Categoría</p>
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={75}
              dataKey="value"
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: unknown) => [fmtUSD(Number(v)), '']}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>Total</p>
          <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{fmtUSD(total)}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginTop: 4 }}>
        {data.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.name}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginLeft: 'auto' }}>
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
