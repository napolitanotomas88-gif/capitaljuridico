'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

interface Props {
  labels: string[]
  agendadas: number[]
  cerradas: number[]
}

export function CallsChart({ labels, agendadas, cerradas }: Props) {
  const data = labels
    .map((label, i) => ({ label, Agendadas: agendadas[i] ?? 0, Cerradas: cerradas[i] ?? 0 }))
    .filter(d => d.Agendadas > 0 || d.Cerradas > 0)

  if (data.length === 0) return null

  return (
    <div className="card p-5">
      <p className="section-title">Llamadas & Cierres — por mes</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 13 }}
            itemStyle={{ color: 'var(--text)' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} formatter={(v) => <span style={{ color: 'var(--text-muted)' }}>{v}</span>} />
          <Bar dataKey="Agendadas" fill="var(--s-dorado)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Cerradas"  fill="var(--s-bordo)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
