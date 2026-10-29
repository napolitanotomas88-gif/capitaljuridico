'use client'

import { useState } from 'react'
import { fmtMoneda } from './tablero'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'

// retargeting = embudo propio (campañas 'retarget'). vslRetargeting = forma VIEJA de /api/ads (el vsl lo
// incluía): si llega, se separa acá para que el gráfico no lo cuente como VSL.
export interface AdsDaily { date: string; vsl: number; fm: number; webinar: number; uruguay: number; otros: number; retargeting?: number; vslRetargeting?: number }
export interface AdsCampaign { name: string; funnel: string; spend7d: number; spendMonth: number; active: boolean }
export interface AdsAd { name: string; funnel: string; spend7d: number; leadsMeta: number; cplMeta: number | null; active: boolean }

// Puntito de estado: verde = activo en Meta, gris = apagado/pausado
function StatusDot({ active }: { active: boolean }) {
  return (
    <span role="img" aria-label={active ? 'Activo' : 'Apagado'} title={active ? 'Activo' : 'Apagado'} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 7, flexShrink: 0,
      background: active ? 'var(--tono-bueno)' : 'transparent', border: active ? 'none' : '1.5px solid var(--text-muted)', boxShadow: active ? '0 0 4px color-mix(in srgb, var(--tono-bueno) 60%, transparent)' : 'none',
    }} />
  )
}

interface Props {
  daily: AdsDaily[]
  campaigns: AdsCampaign[]
  adsIndividuales: AdsAd[]
  adsPeriodLabel: string      // "junio" | "últimos 7 días" — período de las tablas
  isMonthView: boolean        // true → todo el reporte cubre el mes seleccionado
  agendasPorDia: Record<string, { vsl: number; ig: number; retargeting?: number }>   // fecha "YYYY-MM-DD" → agendas
  cpaVSL: number | null       // ads VSL del mes ÷ agendas VSL del mes (sin retargeting: es otro embudo)
  agendasVSLMes: number
  cpaRetargeting?: number | null      // ads Retargeting del mes ÷ agendas Retargeting del mes
  agendasRetargetingMes?: number
  adsRetargetingMes?: number | null   // gasto del mes en campañas 'retarget' (Meta API)
  esMesPasado?: boolean       // mes cerrado → la tabla de anuncios arranca en "Historial" (los de ese mes ya están apagados)
  cps: number | null          // CPL Instagram del mes: gasto FM ÷ seguimientos (real) o estimado de Meta
  cpsEstimado?: boolean       // true = estimado Meta (todavía no se cargaron los seguimientos del mes)
  seguidoresMes: number
  monthLabel?: string | null
}

type SortKey = 'spend' | 'leads' | 'cpl'

// 0 → "$0"; centavos solo para 0 < |v| < 10
const fmtUSD = fmtMoneda

// Semáforo del CPL definido por el usuario (costo por seguidor, campañas FM)
function cpsVerdict(cps: number): { label: string; color: string } {
  if (cps <= 2.2) return { label: 'Winner (1.5–2.2)', color: 'var(--tono-bueno)' }
  if (cps <= 3.0) return { label: 'Escalar — posible winner (2.2–3)', color: 'var(--tono-bueno)' }
  if (cps <= 5.0) return { label: 'Regular (3–5)', color: 'var(--brand-texto)' }
  return { label: 'Rendimiento bajo (5+)', color: 'var(--tono-malo)' }
}

const FUNNEL_COLOR: Record<string, string> = {
  VSL: '#7f202c', Retargeting: '#805c29', FM: '#be8f49', Webinar: '#1f6b52', Uruguay: '#b8ad98', Otros: '#605747',
}
// Tinta del texto sobre cada insignia (el blanco no se lee sobre el dorado ni sobre el gris medio)
const FUNNEL_INK: Record<string, string> = { FM: '#1d1d1b', Uruguay: '#1d1d1b' }

export function AdsReport({ daily, campaigns, adsIndividuales, adsPeriodLabel, isMonthView, agendasPorDia, cpaVSL, agendasVSLMes, cpaRetargeting, agendasRetargetingMes = 0, adsRetargetingMes, esMesPasado, cps, cpsEstimado, seguidoresMes, monthLabel }: Props) {
  // Filtro por embudo + estado + orden de la tabla de anuncios
  const [funnelFilter, setFunnelFilter] = useState<string>('Todos')
  // "Activos" = prendidos HOY en Meta: en un mes pasado casi siempre da vacío → arranca en "Historial".
  // La elección del usuario vale para el período en que la hizo; al cambiar de mes vuelve al default.
  const [eleccion, setEleccion] = useState<{ periodo: string; solo: boolean } | null>(null)
  const soloActivos = eleccion?.periodo === adsPeriodLabel ? eleccion.solo : !esMesPasado
  const setSoloActivos = (solo: boolean) => setEleccion({ periodo: adsPeriodLabel, solo })
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortAsc, setSortAsc] = useState(false)

  const funnelsPresentes = ['Todos', ...Array.from(new Set(adsIndividuales.map(a => a.funnel)))]
  const adsFiltrados = adsIndividuales
    .filter(a => funnelFilter === 'Todos' || a.funnel === funnelFilter)
    .filter(a => !soloActivos || a.active)
    .sort((a, b) => {
      const val = (x: AdsAd) => sortKey === 'spend' ? x.spend7d : sortKey === 'leads' ? x.leadsMeta
        : (x.cplMeta ?? Number.POSITIVE_INFINITY)   // CPL: los "—" siempre al final
      return sortAsc ? val(a) - val(b) : val(b) - val(a)
    })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(key === 'cpl') }  // CPL arranca ascendente (más bajo = mejor)
  }
  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''
  // Unir gasto diario con agendas del día para el gráfico.
  // Barras apiladas = gasto TOTAL del día: VSL + Retargeting + FM + otros (webinar / Uruguay / pre-call Hammer)
  const r2 = (n: number) => Math.round(n * 100) / 100
  const chartData = daily.map(d => {
    // /api/ads nuevo manda `retargeting` aparte; el viejo lo metía dentro de `vsl` (con `vslRetargeting` como desglose)
    const ret = d.retargeting ?? d.vslRetargeting ?? 0
    const vsl = d.retargeting != null ? (d.vsl ?? 0) : Math.max(0, (d.vsl ?? 0) - (d.vslRetargeting ?? 0))
    return {
      date: d.date.slice(5),          // "MM-DD"
      'Ads VSL': r2(vsl),
      'Ads Retargeting': r2(ret),
      'Ads FM': r2(d.fm ?? 0),
      'Ads otros': r2((d.webinar ?? 0) + (d.uruguay ?? 0) + (d.otros ?? 0)),
      'Agendas VSL': agendasPorDia[d.date]?.vsl ?? 0,
      'Agendas Retargeting': agendasPorDia[d.date]?.retargeting ?? 0,
      'Agendas IG': agendasPorDia[d.date]?.ig ?? 0,
    }
  })
  // Solo se dibuja la serie de retargeting si hubo gasto o agendas en el período del gráfico
  const hayRetargeting = chartData.some(d => d['Ads Retargeting'] > 0 || d['Agendas Retargeting'] > 0)
  const mostrarCpaRet = cpaRetargeting != null || (adsRetargetingMes ?? 0) > 0 || agendasRetargetingMes > 0

  return (
    <div className="card p-5">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <p className="section-title" style={{ margin: 0 }}>Anuncios — Campañas activas</p>
        {monthLabel && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-texto)' }}>{monthLabel}</span>}
      </div>

      {/* ── KPIs del mes: CPA (VSL) y CPS (FM) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, margin: '14px 0' }}>
        <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            CPA VSL — costo por agenda
          </p>
          <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--brand-red)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {cpaVSL != null ? fmtUSD(cpaVSL) : '—'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {agendasVSLMes} agendas VSL en el mes {cpaVSL == null ? '· faltan ads' : ''}
          </p>
        </div>
        {/* CPA Retargeting: embudo propio (ads 'retarget' ÷ agendas con campaña RETARGETING) */}
        {mostrarCpaRet && (
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              CPA Retargeting — costo por agenda
            </p>
            <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--brand-texto)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {cpaRetargeting != null ? fmtUSD(cpaRetargeting) : '—'}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {agendasRetargetingMes} agendas retargeting en el mes
              {(adsRetargetingMes ?? 0) > 0 ? ` · ${fmtUSD(adsRetargetingMes as number)} de ads` : ' · sin gasto de retargeting'}
            </p>
          </div>
        )}
        <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            CPL Instagram — costo por seguidor
          </p>
          <p style={{ fontSize: 24, fontWeight: 800, color: cps != null ? cpsVerdict(cps).color : 'var(--text-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {cps != null ? `$${cps.toFixed(2)}` : '—'}
          </p>
          <p style={{ fontSize: 10, color: cps != null ? cpsVerdict(cps).color : 'var(--text-muted)', marginTop: 2, fontWeight: 600 }}>
            {cps != null ? cpsVerdict(cps).label : 'sin gasto FM ni datos de Meta este mes'}
          </p>
          {cps != null && cpsEstimado && (
            <p style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 2 }}>
              estimado Meta · falta cargar seguimientos del mes
            </p>
          )}
        </div>
      </div>

      {/* ── Gráfico: gasto diario vs agendas del día (últimos 35 días) ── */}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} interval={4} />
          <YAxis yAxisId="usd" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
          <YAxis yAxisId="ag" orientation="right" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={28} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12 }}
            itemStyle={{ color: 'var(--text)' }}
            formatter={(v: unknown, name: unknown) => {
              const label = String(name)
              return [label.startsWith('Ads') ? fmtUSD(Number(v)) : String(v), label]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: 'var(--text-muted)' }}>{v}</span>} />
          <Bar yAxisId="usd" dataKey="Ads VSL" stackId="ads" fill="var(--s-bordo)" radius={[0, 0, 0, 0]} />
          {hayRetargeting && <Bar yAxisId="usd" dataKey="Ads Retargeting" stackId="ads" fill="var(--s-dorado-osc)" radius={[0, 0, 0, 0]} />}
          <Bar yAxisId="usd" dataKey="Ads FM" stackId="ads" fill="var(--s-dorado)" radius={[0, 0, 0, 0]} />
          <Bar yAxisId="usd" dataKey="Ads otros" stackId="ads" fill="var(--s-arena)" radius={[3, 3, 0, 0]} />
          <Line yAxisId="ag" type="monotone" dataKey="Agendas VSL" stroke="var(--s-verde-prof)" strokeWidth={2} dot={false} />
          <Line yAxisId="ag" type="monotone" dataKey="Agendas IG" stroke="var(--s-dorado-osc)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
          {hayRetargeting && <Line yAxisId="ag" type="monotone" dataKey="Agendas Retargeting" stroke="var(--s-gris)" strokeWidth={2} strokeDasharray="2 2" dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
        Barras: gasto diario total (USD, eje izq.: VSL + Retargeting + FM + otros = webinar/Uruguay/pre-call) · Líneas: llamadas programadas ese día (eje der.) · {isMonthView ? adsPeriodLabel : 'últimos 35 días'}
      </p>

      {/* ── Tabla de campañas activas ── */}
      {campaigns.length > 0 && (
        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>CAMPAÑA</th>
                <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)' }}>EMBUDO</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)' }}>{isMonthView ? `GASTO ${adsPeriodLabel.toUpperCase()}` : 'ÚLT. 7 DÍAS'}</th>
                {!isMonthView && <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)' }}>MES ACTUAL</th>}
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.name} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 4px', color: 'var(--text)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><StatusDot active={c.active} />{c.name}</td>
                  <td style={{ padding: '7px 4px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: FUNNEL_COLOR[c.funnel] ?? '#605747',
                      color: FUNNEL_INK[c.funnel] ?? '#fff',
                    }}>{c.funnel}</span>
                  </td>
                  <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(c.spend7d)}</td>
                  {!isMonthView && <td style={{ padding: '7px 4px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(c.spendMonth)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Anuncios individuales (filtrables y ordenables) ── */}
      {adsIndividuales.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', margin: 0 }}>
              ANUNCIOS — {adsPeriodLabel.toUpperCase()} (leads/CPL según Meta, solo para comparar entre anuncios)
            </p>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Estado: activos (default) vs todos los que gastaron en el período */}
              <button onClick={() => setSoloActivos(true)} style={{
                padding: '2px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${soloActivos ? '#1f6b52' : 'var(--border)'}`,
                background: soloActivos ? '#1f6b52' : 'transparent',
                color: soloActivos ? '#fff' : 'var(--text-muted)',
              }}>Activos</button>
              <button onClick={() => setSoloActivos(false)} style={{
                padding: '2px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${!soloActivos ? 'var(--brand-orange)' : 'var(--border)'}`,
                background: !soloActivos ? 'var(--brand-orange)' : 'transparent',
                color: !soloActivos ? 'var(--on-brand)' : 'var(--text-muted)',
              }}>Historial</button>
              <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />
              {funnelsPresentes.map(f => (
                <button key={f} onClick={() => setFunnelFilter(f)} style={{
                  padding: '2px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  border: `1.5px solid ${funnelFilter === f ? 'var(--brand-orange)' : 'var(--border)'}`,
                  background: funnelFilter === f ? 'var(--brand-orange)' : 'transparent',
                  color: funnelFilter === f ? 'var(--on-brand)' : 'var(--text-muted)',
                }}>{f}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>ANUNCIO</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)' }}>EMBUDO</th>
                  <th onClick={() => toggleSort('spend')} style={{ textAlign: 'right', padding: '6px 4px', fontSize: 10, color: sortKey === 'spend' ? 'var(--brand-texto)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>GASTO{arrow('spend')}</th>
                  <th onClick={() => toggleSort('leads')} style={{ textAlign: 'right', padding: '6px 4px', fontSize: 10, color: sortKey === 'leads' ? 'var(--brand-texto)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>LEADS (META){arrow('leads')}</th>
                  <th onClick={() => toggleSort('cpl')} style={{ textAlign: 'right', padding: '6px 4px', fontSize: 10, color: sortKey === 'cpl' ? 'var(--brand-texto)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>CPL (META){arrow('cpl')}</th>
                </tr>
              </thead>
              <tbody>
                {adsFiltrados.map((a, i) => (
                  <tr key={a.name + i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 4px', color: 'var(--text)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><StatusDot active={a.active} />{a.name}</td>
                    <td style={{ padding: '7px 4px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: FUNNEL_COLOR[a.funnel] ?? '#605747', color: FUNNEL_INK[a.funnel] ?? '#fff',
                      }}>{a.funnel}</span>
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtUSD(a.spend7d)}</td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{a.leadsMeta || '—'}</td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: a.cplMeta == null ? 'var(--text-muted)' : 'var(--text)' }}>
                      {a.cplMeta != null ? fmtUSD(a.cplMeta) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {adsFiltrados.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0 2px' }}>
                {soloActivos ? 'Sin anuncios activos hoy con este filtro — tocá "Historial" para ver los que gastaron en el período' : 'Sin anuncios con este filtro'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
