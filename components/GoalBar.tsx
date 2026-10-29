'use client'

import { GOALS } from '@/lib/config'

interface Props {
  value: number | null
  type: 'monthly' | 'annual'
  monthIdx?: number   // 0-11: mes que se está viendo (para metas de meses pasados)
  persona?: string    // filtro de persona activo: el valor es SU cash, la meta es de toda la empresa
}

function daysLeft(deadline: Date) {
  return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86400000))
}

// Meta mensual recurrente: el plazo es el fin del mes en curso
function endOfCurrentMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function GoalBar({ value, type, monthIdx, persona }: Props) {
  const goal = GOALS[type]
  const current = value ?? 0
  const pct = Math.min(100, (current / goal.target) * 100)
  const remaining = Math.max(0, goal.target - current)
  // Mes pasado → el período ya cerró (0 días); mes actual → días hasta fin de mes
  const esMesPasado = type === 'monthly' && monthIdx != null && monthIdx < new Date().getMonth()
  const days = esMesPasado ? 0 : daysLeft(type === 'monthly' ? endOfCurrentMonth() : goal.deadline)
  const ok = value !== null

  return (
    <div className="goal-card">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
            {goal.label}
          </p>
          {persona && (
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              cash de <span style={{ color: 'var(--text)', fontWeight: 600 }}>{persona}</span> vs meta de la empresa
            </p>
          )}
          <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--brand-red)' }}>
            {ok ? fmtUSD(current) : <span style={{ color: 'var(--text-muted)' }}>Sin datos</span>}
            <span className="text-sm font-normal ml-1.5" style={{ color: 'var(--text-muted)' }}>
              / {fmtUSD(goal.target)}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black tabular-nums" style={{ color: pct >= 100 ? 'var(--tono-bueno)' : 'var(--brand-texto)' }}>
            {ok ? `${pct.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{esMesPasado ? 'mes cerrado' : `${days}d restantes`}</p>
        </div>
      </div>

      <div className="cuotas-bar">
        <div className="cuotas-fill" style={{ width: `${ok ? pct : 0}%` }} />
      </div>

      {ok && remaining > 0 && days > 0 && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          Faltan <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtUSD(remaining)}</span>
          {' · Ritmo necesario: '}
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtUSD(remaining / days)}/día</span>
        </p>
      )}
      {pct >= 100 && <p className="text-xs mt-2 font-semibold" style={{ color: 'var(--tono-bueno)' }}>✓ Meta alcanzada</p>}
    </div>
  )
}
