'use client'

import { useState } from 'react'

export interface FunnelStats {
  leads: number | null      // leads crudos del canal (null = sin datos)
  feccuCac: number | null   // FECCU del embudo ÷ ads del embudo (null = ads sin separar)
  agendadas: number
  ocurridas: number         // agendas cuya fecha/hora ya pasó
  sinRegistro?: number      // ocurridas con "¿Se presentó?" vacío: se descuentan del denominador de show up / cierre
  calificadas: number
  presentadas: number
  cerradas: number
}

// Retargeting = embudo propio (campañas 'retarget' en Meta · agendas con 'RETARGETING' en la campaña, col H)
type Channel = 'todos' | 'vsl' | 'retargeting' | 'ig' | 'uruguay' | 'webinar' | 'wsp' | 'referido'

interface Props {
  byChannel: Record<Channel, FunnelStats>
  // Desglose de origen de agendas (solo se muestra en "Todos")
  vsl: number
  retargeting?: number              // agendas del embudo Retargeting (opcional: /api/raw viejo no lo separa)
  ig: number
  uruguay: number
  webinar: number
  wsp: number
  referido: number
  monthLabel?: string | null
  leadsVSL?: number | null
  leadsIG?: number | null
  costoPorLeadVSL?: number | null   // Ads VSL ÷ visitas (se muestra en la pestaña VSL; sin retargeting)
  cpaRetargeting?: number | null    // Ads Retargeting ÷ agendas Retargeting del mes (pestaña Retargeting)
  cpsIG?: number | null             // CPL Instagram: gasto FM ÷ seguimientos (real) o estimado Meta
  cpsIGEstimado?: boolean           // true = estimado Meta (faltan cargar los seguimientos del mes)
}

// ink = color del texto sobre la barra: blanco no se lee sobre naranja/amarillo (contraste 2.3:1 y 1.7:1)
const STAGES = [
  { key: 'agendadas',   label: 'Agendadas',   desc: 'Llamadas agendadas',        color: '#7f202c', ink: '#fff',    inkSub: 'rgba(255,255,255,0.85)' },
  { key: 'calificadas', label: 'Calificadas', desc: 'Agendas que calificaron',   color: '#be8f49', ink: '#1d1d1b', inkSub: 'rgba(29,29,27,0.9)' },
  { key: 'presentadas', label: 'Presentadas', desc: 'Show up (se presentaron)',  color: '#d9b574', ink: '#1d1d1b', inkSub: 'rgba(29,29,27,0.9)' },
  { key: 'cerradas',    label: 'Cerradas',    desc: 'Ventas cerradas',           color: '#1f6b52', ink: '#fff',    inkSub: 'rgba(255,255,255,0.85)' },
] as const

const SOURCES = [
  { key: 'vsl',      label: 'VSL',          color: 'var(--s-bordo)' },
  { key: 'retargeting', label: 'Retargeting', color: 'var(--s-dorado-osc)' },
  { key: 'ig',       label: 'Instagram',    color: 'var(--s-dorado)' },
  { key: 'uruguay',  label: 'VSL Uruguay',  color: 'var(--s-taupe)' },
  { key: 'webinar',  label: 'Webinar',      color: 'var(--s-verde)' },
  { key: 'wsp',      label: 'Enrutamiento', color: 'var(--s-gris)' },
  { key: 'referido', label: 'Referidos',    color: 'var(--s-dorado-claro)' },
] as const

const TABS: { id: Channel; label: string }[] = [
  { id: 'todos',    label: 'Todos' },
  { id: 'vsl',      label: 'VSL' },
  { id: 'retargeting', label: 'Retargeting' },
  { id: 'ig',       label: 'Instagram' },
  { id: 'uruguay',  label: 'VSL Uruguay' },
  { id: 'webinar',  label: 'Webinar' },
  { id: 'wsp',      label: 'Enrutamiento' },
  { id: 'referido', label: 'Referidos' },
]

export function SalesFunnel({ byChannel, vsl, retargeting = 0, ig, uruguay, webinar, wsp, referido, monthLabel, leadsVSL, leadsIG, costoPorLeadVSL, cpaRetargeting, cpsIG, cpsIGEstimado }: Props) {
  const [channel, setChannel] = useState<Channel>('todos')
  const stats = byChannel[channel]
  const values: Record<string, number> = {
    agendadas: stats.agendadas, calificadas: stats.calificadas,
    presentadas: stats.presentadas, cerradas: stats.cerradas,
  }
  const top = stats.agendadas || 1

  const srcValues: Record<string, number> = { vsl, retargeting, ig, uruguay, webinar, wsp, referido }
  const srcTotal = vsl + retargeting + ig + uruguay + webinar + wsp + referido

  const hasLeads = stats.leads != null && stats.leads > 0
  // Tasa de agenda: en "Todos" solo las agendas de los embudos que tienen leads medidos (VSL + IG);
  // retargeting/referidos/enrutamiento/webinar/Uruguay no tienen leads en el denominador
  const agendasConLeads = channel === 'todos' ? byChannel.vsl.agendadas + byChannel.ig.agendadas : stats.agendadas
  const pctAgenda = hasLeads && agendasConLeads > 0 ? (agendasConLeads / (stats.leads as number)) * 100 : null
  // Show up y cierre sobre ocurridas CON registro (las sin registrar no se sabe si se presentaron)
  const sinReg = stats.sinRegistro ?? 0
  const baseOc = stats.ocurridas - sinReg

  return (
    <div className="card p-5">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <p className="section-title" style={{ margin: 0 }}>Embudo de Ventas</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
          {/* Selector de canal (hace wrap en móvil: la tarjeta tiene overflow hidden) */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setChannel(t.id)}
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  border: `1.5px solid ${channel === t.id ? 'var(--brand-orange)' : 'var(--border)'}`,
                  background: channel === t.id ? 'var(--brand-orange)' : 'transparent',
                  color: channel === t.id ? 'var(--on-brand)' : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {monthLabel && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-texto)' }}>{monthLabel}</span>
          )}
        </div>
      </div>

      {/* ── Origen de las agendas (solo vista "Todos") ── */}
      {channel === 'todos' && srcTotal > 0 && (
        <div style={{ marginBottom: 18, marginTop: 10 }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
            ORIGEN DE LAS AGENDAS
          </p>
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--bg)' }}>
            {SOURCES.map(s => {
              const v = srcValues[s.key]
              const w = (v / srcTotal) * 100
              if (w === 0) return null
              return <div key={s.key} title={`${s.label}: ${v}`} style={{ width: `${w}%`, background: s.color, transition: 'width 0.6s' }} />
            })}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            {SOURCES.map(s => {
              const v = srcValues[s.key]
              const pct = (v / srcTotal) * 100
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{v}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({pct.toFixed(0)}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {channel !== 'todos' && <div style={{ marginTop: 10 }} />}

      {/* ── Nivel LEADS ── */}
      {hasLeads && (
        <div style={{ marginBottom: 6 }}>
          <div style={{
            width: '100%', background: 'var(--bg)', borderRadius: 8,
            border: '1.5px dashed var(--border)',
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>Leads</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {channel === 'todos'
                  ? `VSL ${leadsVSL?.toLocaleString('en-US') ?? 's/d'} visitas${leadsIG != null ? ` · IG ${leadsIG.toLocaleString('en-US')}` : ' · IG s/d'}`
                  : channel === 'vsl'
                    ? `Visitas al sitio (GA4)${costoPorLeadVSL != null ? ` · $${costoPorLeadVSL.toFixed(2)}/lead (ads VSL)` : ''}`
                    : `Conversaciones IG${cpsIG != null ? ` · CPL $${cpsIG.toFixed(2)}/seguidor${cpsIGEstimado ? ' (estimado Meta)' : ''}` : ''}`}
              </div>
            </div>
            <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {(stats.leads as number).toLocaleString('en-US')}
            </span>
          </div>
          {pctAgenda != null && (
            <div style={{ textAlign: 'center', margin: '1px 0' }}>
              <span style={{
                fontSize: 9, color: 'var(--text-muted)', fontWeight: 600,
                background: 'var(--bg)', borderRadius: 4, padding: '1px 6px',
              }}>
                ▼ {pctAgenda.toFixed(1)}% agenda
              </span>
            </div>
          )}
        </div>
      )}
      {/* CPL de Instagram aunque todavía no haya conversaciones cargadas en el mes */}
      {channel === 'ig' && !hasLeads && cpsIG != null && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8 }}>
          CPL Instagram ${cpsIG.toFixed(2)}/seguidor{cpsIGEstimado ? ' · estimado Meta · falta cargar seguimientos del mes' : ''}
        </p>
      )}

      {/* ── Embudo por etapas ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {STAGES.map((stage, i) => {
          const val = values[stage.key]
          const widthPct = Math.max((val / top) * 100, 6)
          const prev = i > 0 ? values[STAGES[i - 1].key] : null
          const stepPct = prev && prev > 0 ? (val / prev) * 100 : null

          return (
            <div key={stage.key}>
              {stepPct !== null && (
                <div style={{ textAlign: 'center', margin: '1px 0' }}>
                  <span style={{
                    fontSize: 9, color: 'var(--text-muted)', fontWeight: 600,
                    background: 'var(--bg)', borderRadius: 4, padding: '1px 6px',
                  }}>
                    ▼ {stepPct.toFixed(0)}%
                  </span>
                </div>
              )}
              <div style={{
                width: `${widthPct}%`, margin: '0 auto',
                background: stage.color, borderRadius: 8,
                padding: '10px 14px', minWidth: 120,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
              }}>
                <div style={{ lineHeight: 1.15 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: stage.ink }}>{stage.label}</div>
                  <div style={{ fontSize: 9, color: stage.inkSub, whiteSpace: 'nowrap' }}>{stage.desc}</div>
                </div>
                <span style={{ fontSize: 20, fontWeight: 900, color: stage.ink, fontVariantNumeric: 'tabular-nums' }}>
                  {val}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Conversión total ──
          Show up y Ag→Cierre se calculan sobre las agendas que YA ocurrieron y tienen
          registrado si se presentó (una llamada a futuro no puede haberse presentado aún). */}
      {stats.agendadas > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', rowGap: 10, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {pctAgenda != null && <Metric label="Agenda" value={`${pctAgenda.toFixed(1)}%`} />}
          <Metric label="Calificación" value={`${((stats.calificadas / top) * 100).toFixed(0)}%`} />
          <Metric label="Show up"      value={baseOc > 0 ? `${((stats.presentadas / baseOc) * 100).toFixed(0)}%` : '—'} />
          <Metric label="Cierre"       value={stats.presentadas > 0 ? `${((stats.cerradas / stats.presentadas) * 100).toFixed(1)}%` : '—'} />
          <Metric label="Ag. → Cierre" value={baseOc > 0 ? `${((stats.cerradas / baseOc) * 100).toFixed(1)}%` : '—'} highlight />
          <Metric label="FECCU:CAC" value={stats.feccuCac != null ? `${stats.feccuCac.toFixed(2)}x` : '—'} />
        </div>
      )}
      {stats.agendadas > 0 && sinReg > 0 && (
        <p style={{ fontSize: 10, textAlign: 'center', marginTop: 6, color: 'var(--text-muted)' }}>
          {sinReg} {sinReg === 1 ? 'llamada ocurrida sin registrar' : 'llamadas ocurridas sin registrar'} &quot;¿Se presentó?&quot; · fuera del show up y del cierre
        </p>
      )}
      {/* Retargeting: no tiene leads propios medidos → se muestra el costo por agenda del embudo */}
      {channel === 'retargeting' && cpaRetargeting != null && (
        <p style={{ fontSize: 10, textAlign: 'center', marginTop: 6, color: 'var(--text-muted)' }}>
          Costo por agenda ${cpaRetargeting.toFixed(2)} (ads retargeting ÷ agendas retargeting del mes)
        </p>
      )}

      {/* ── Semáforo FECCU:CAC del embudo (regla del mentor, sobre primer pago ÷ ads) ── */}
      {channel !== 'todos' && stats.feccuCac != null && (
        <p style={{ fontSize: 11, textAlign: 'center', marginTop: 10, fontWeight: 700,
          color: stats.feccuCac < 3 ? 'var(--tono-malo)' : stats.feccuCac <= 5 ? 'var(--brand-texto)' : 'var(--tono-bueno)' }}>
          {stats.feccuCac < 3 ? 'FECCU:CAC < 3 — revisar/apagar este embudo'
            : stats.feccuCac <= 5 ? 'FECCU:CAC entre 3 y 5 — mantener'
            : 'FECCU:CAC > 5 — evaluar escalar'}
        </p>
      )}
      {channel !== 'todos' && stats.feccuCac == null && stats.agendadas > 0 && (
        <p style={{ fontSize: 10, textAlign: 'center', marginTop: 10, color: 'var(--text-muted)' }}>
          FECCU:CAC del embudo sin dato: gasto del embudo en el mes menor a $300 (muestra chica) o sin anuncios propios
        </p>
      )}
      {stats.agendadas === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '14px 0 4px' }}>
          Sin agendas de este canal en el período
        </p>
      )}
    </div>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: highlight ? 'var(--brand-red)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.03em', marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}
