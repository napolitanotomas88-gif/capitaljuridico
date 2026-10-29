'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

// count = cierres = clientes cuyo PRIMER pago FECCU del año cae en el período
// (el 2do pago de un PIF partido no es otro cierre); amount = todo el FECCU del período.
// embudo = embudo atribuido por el server (transactions[].embudo: fila de closer cerrada del cliente,
// si no por fuente col K). Si no viene (/api/raw viejo) se clasifica por la fuente como antes.
export type EmbudoPago = 'vsl' | 'ig' | 'uruguay' | 'retargeting' | 'referido' | 'webinar' | 'otro'
interface Props {
  sources: { source: string; amount: number; count: number; embudo?: EmbudoPago | null }[]
}

type Categoria = 'VSL' | 'Retargeting' | 'IG' | 'VSL Uruguay' | 'Webinar' | 'Referido' | 'Otro'
const POR_EMBUDO: Record<EmbudoPago, Categoria> = {
  vsl: 'VSL', retargeting: 'Retargeting', ig: 'IG', uruguay: 'VSL Uruguay',
  webinar: 'Webinar', referido: 'Referido', otro: 'Otro',
}

// Clasifica la Fuente (col K del Registro) en canal — espejo de la atribución del embudo:
// IG = inbound + link en bio · Referido aparte · Otro = enrutamiento/wsp/webinar/outbound
// VSL = vsl + sin fuente + sin clasificar (bug de tracking)
function classify(raw: string): Categoria {
  const s = raw.toLowerCase()
  if (s.includes('ig') || s.includes('inbound') || s.includes('bio')) return 'IG'
  if (s.includes('referido') || s.includes('referral') || s.includes('refe')) return 'Referido'
  if (s.includes('enrutamiento') || s.includes('wsp') || s.includes('webi') || s.includes('outbound')) return 'Otro'
  return 'VSL'
}

const COLORS: Record<string, string> = {
  VSL:      'var(--s-bordo)',
  Retargeting: 'var(--s-dorado-osc)',
  IG:       'var(--s-dorado)',
  'VSL Uruguay': 'var(--s-taupe)',
  Webinar:  'var(--s-verde)',
  Referido: 'var(--s-dorado-claro)',
  Otro:     'var(--s-gris)',
}

function fmtUSD(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function LeadSourceChart({ sources }: Props) {
  // Aggregate by channel
  const agg: Record<string, { amount: number; count: number }> = {}
  for (const s of sources) {
    const cat = (s.embudo && POR_EMBUDO[s.embudo]) || classify(s.source)
    if (!agg[cat]) agg[cat] = { amount: 0, count: 0 }
    agg[cat].amount += s.amount
    agg[cat].count  += s.count
  }

  // Total FECCU del período: incluye los pagos de clientes que ya habían cerrado antes
  const totalCash = Object.values(agg).reduce((s, v) => s + v.amount, 0)
  const data = Object.entries(agg)
    .map(([name, v]) => ({ name, ...v, color: COLORS[name] ?? 'var(--s-arena)' }))
    .filter(d => d.count > 0)
    .sort((a, b) => b.count - a.count)

  if (data.length === 0) return (
    <div className="card p-6 flex items-center justify-center text-sm" style={{ height: 260, color: 'var(--text-muted)' }}>
      {totalCash > 0 ? `Sin cierres nuevos en el período (FECCU ${fmtUSD(totalCash)} de clientes que ya habían pagado)` : 'Sin cierres FECCU en el período'}
    </div>
  )

  const totalCount = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="card p-5">
      <p className="section-title">Origen de cierres FECCU</p>
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={75}
              dataKey="count"
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map(entry => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: unknown, _n: unknown, p: unknown) => {
                const item = (p as { payload?: { amount?: number } })?.payload
                return [`${v} cierres · ${fmtUSD(item?.amount ?? 0)}`, '']
              }}
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
          <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>Cierres FECCU</p>
          <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', lineHeight: 1.4 }}>{totalCount}</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {data.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{d.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.count} {d.count === 1 ? 'cierre' : 'cierres'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', width: 38, textAlign: 'right' }}>
              {((d.count / totalCount) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, textAlign: 'right' }}>
        Total FECCU: <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmtUSD(totalCash)}</span>
      </p>
      <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, textAlign: 'right' }}>
        cierre = primer pago FECCU del cliente en el año
      </p>
    </div>
  )
}
