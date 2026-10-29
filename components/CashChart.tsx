'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface Props {
  labels: string[]
  cash: number[]
}

function formatK(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`
}

export function CashChart({ labels, cash }: Props) {
  const data = labels.map((label, i) => ({ label, cash: cash[i] ?? 0 })).filter(d => d.cash > 0)

  if (data.length === 0) return (
    <div className="card p-6 flex items-center justify-center h-48 text-sm" style={{ color: 'var(--text-muted)' }}>
      Sin datos de cash aún
    </div>
  )

  return (
    <div className="card p-5">
      <p className="section-title">Cash Collected — Evolución mensual</p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--s-dorado)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--s-dorado)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatK} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            formatter={(v) => [`$${Number(v).toLocaleString('en-US')}`, 'Cash Collected']}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 13 }}
            itemStyle={{ color: 'var(--text)' }}
          />
          <Area
            type="monotone"
            dataKey="cash"
            stroke="var(--s-dorado)"
            strokeWidth={2.5}
            fill="url(#cashGrad)"
            dot={{ fill: 'var(--s-dorado)', r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: 'var(--s-bordo)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
