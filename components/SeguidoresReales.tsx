'use client'

import { useState } from 'react'
import { fmtMoneda } from './tablero'
import { veredictoCosto, type CruceCalculado, type FilaPosteo } from '@/lib/anuncios/seguidoresCruce'

// Costo por seguidor real de FM: cruce diario de Meta Ads (lo que atribuye) con Business Suite (lo que trajo cada
// posteo). Los datos los manda la tarea diaria de la Mac a /api/ads/seguidores.

const TONO: Record<'bueno' | 'medio' | 'malo', string> = {
  bueno: 'var(--tono-bueno)', medio: 'var(--brand-texto)', malo: 'var(--tono-malo)',
}

const dinero = (v: number | null) => (v == null ? '—' : fmtMoneda(v))
const entero = (v: number | null) => (v == null ? '—' : v.toLocaleString('es-AR'))

function Costo({ v }: { v: number | null }) {
  if (v == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  return <span style={{ color: TONO[veredictoCosto(v).tono], fontWeight: 700 }}>{fmtMoneda(v)}</span>
}

const fechaCorta = (dia: string) => {
  const [, m, d] = dia.split('-')
  return `${Number(d)}/${Number(m)}`
}
const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 6px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', padding: '7px 6px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function Tarjeta({ titulo, valor, pie }: { titulo: string; valor: number | null; pie: string }) {
  const tono = valor != null ? TONO[veredictoCosto(valor).tono] : 'var(--text-muted)'
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{titulo}</p>
      <p style={{ fontSize: 24, fontWeight: 800, color: tono, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {valor != null ? `$${valor.toFixed(2)}` : '—'}
      </p>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        {valor != null ? `${veredictoCosto(valor).etiqueta} · ` : ''}{pie}
      </p>
    </div>
  )
}

function NombrePosteo({ p }: { p: Pick<FilaPosteo, 'clave' | 'texto' | 'cuenta'> }) {
  return (
    <td style={{ padding: '7px 6px', maxWidth: 260 }}>
      <span style={{ fontWeight: 700 }}>{p.clave}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>{p.cuenta}</span>
      {p.texto && <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.texto}</span>}
    </td>
  )
}

export function SeguidoresReales({ cruce }: { cruce: CruceCalculado }) {
  const [vista, setVista] = useState<'ayer' | 'acumulado'>('ayer')
  const t = cruce.totales
  const conGastoAyer = cruce.posteos.filter(p => p.gastoAyer > 0)
  const acumulado = [...cruce.posteos].filter(p => p.gastoAyer > 0 || p.gastoAcum >= 50).sort((a, b) => b.gastoAcum - a.gastoAcum)
  const filas = vista === 'ayer' ? conGastoAyer : acumulado
  const hayAnterior = cruce.diaAnterior != null
  // La foto de la mañana mide «ayer»: el día de los datos es el anterior al de la foto.
  const diaDatos = (() => { const d = new Date(`${cruce.dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()

  const boton = (k: 'ayer' | 'acumulado', etiqueta: string) => (
    <button type="button" onClick={() => setVista(k)} aria-pressed={vista === k}
      style={{
        fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
        border: '1px solid var(--border)', background: vista === k ? 'var(--text)' : 'transparent',
        color: vista === k ? 'var(--card)' : 'var(--text-muted)',
      }}>{etiqueta}</button>
  )

  return (
    <div className="card p-5">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <p className="section-title" style={{ margin: 0 }}>FM — Costo por seguidor real</p>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Cruce del {fechaCorta(cruce.dia)} a las {horaDe(cruce.tomada)} · Meta Ads × Business Suite
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, margin: '14px 0' }}>
        <Tarjeta titulo="Costo real — acumulado" valor={t.costoReal}
          pie={`${fmtMoneda(t.gastoConDato)} ÷ ${entero(t.seguidoresReales)} seguidores (Business Suite)`} />
        <Tarjeta titulo="Costo atribuido por Meta" valor={t.costoAtribuido}
          pie={`${fmtMoneda(t.gastoAcum)} ÷ ${entero(t.atribuidosAcum)} seguidores atribuidos`} />
        <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Gasto FM del {fechaCorta(diaDatos)}</p>
          <p style={{ fontSize: 24, fontWeight: 800, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{fmtMoneda(t.gastoAyer)}</p>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {entero(t.atribuidosAyer)} atribuidos por Meta · costo atribuido {dinero(t.costoAtribuidoAyer)}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {boton('ayer', `Día ${fechaCorta(diaDatos)}`)}
        {boton('acumulado', 'Acumulado')}
        {vista === 'ayer' && !hayAnterior && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Seguidores del día: desde la segunda foto (Business Suite da acumulados).</span>
        )}
      </div>

      {filas.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          {vista === 'ayer' ? 'Ningún anuncio de FM gastó ese día.' : 'Sin posteos con gasto para mostrar.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ ...th, textAlign: 'left' }}>POSTEO</th>
                {vista === 'ayer' ? (<>
                  <th style={th}>GASTO</th><th style={th}>ATRIBUIDOS</th><th style={th}>COSTO ATRIB.</th>
                  <th style={th}>NUEVOS BS (ADS)</th><th style={th}>COSTO REAL</th>
                </>) : (<>
                  <th style={th}>GASTO</th><th style={th}>ATRIBUIDOS</th><th style={th}>COSTO ATRIB.</th>
                  <th style={th}>SEGUIDORES BS (ADS)</th><th style={th}>COSTO REAL</th><th style={th}>SOLO ADS</th>
                </>)}
              </tr>
            </thead>
            <tbody>
              {filas.map(p => (
                <tr key={`${p.cuenta}|${p.clave}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <NombrePosteo p={p} />
                  {vista === 'ayer' ? (<>
                    <td style={td}>{fmtMoneda(p.gastoAyer)}</td>
                    <td style={td}>{entero(p.atribuidosAyer)}</td>
                    <td style={td}><Costo v={p.costoAtribuidoAyer} /></td>
                    <td style={td}>{p.bsNuevos == null ? '—' : `${entero(p.bsNuevos)} (${entero(p.bsAnunciosNuevos)})`}</td>
                    <td style={td}><Costo v={p.costoRealAyer} /></td>
                  </>) : (<>
                    <td style={td}>{fmtMoneda(p.gastoAcum)}</td>
                    <td style={td}>{entero(p.atribuidosAcum)}</td>
                    <td style={td}><Costo v={p.costoAtribuido} /></td>
                    <td style={td}>{p.bsTotal == null ? 'sin dato' : `${entero(p.bsTotal)} (${entero(p.bsAnuncios)})`}</td>
                    <td style={td}><Costo v={p.costoReal} /></td>
                    <td style={td}><Costo v={p.costoSoloAnuncios} /></td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cruce.perfiles.length > 0 && (
        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
            Anuncios sin posteo propio · se mide el crecimiento del perfil
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ ...th, textAlign: 'left' }}>PERFIL</th>
                <th style={th}>SEGUIDORES</th><th style={th}>GASTO</th><th style={th}>NUEVOS</th><th style={th}>COSTO REAL</th>
                <th style={th}>ATRIBUIDOS</th><th style={th}>DÍA: GASTO</th><th style={th}>DÍA: NUEVOS</th><th style={th}>DÍA: COSTO</th>
              </tr>
            </thead>
            <tbody>
              {cruce.perfiles.map(p => (
                <tr key={`${p.cuenta}|${p.usuario}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 6px' }}>
                    <span style={{ fontWeight: 700 }}>@{p.usuario}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>{p.cuenta}</span>
                  </td>
                  <td style={td}>{entero(p.seguidores)}</td>
                  <td style={td}>{fmtMoneda(p.gastoAcum)}</td>
                  <td style={td}>{entero(p.nuevosAcum)}</td>
                  <td style={td}><Costo v={p.costoRealAcum} /></td>
                  <td style={td}>{entero(p.atribuidosAcum)}</td>
                  <td style={td}>{fmtMoneda(p.gastoAyer)}</td>
                  <td style={td}>{entero(p.nuevosAyer)}</td>
                  <td style={td}><Costo v={p.costoRealAyer} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cruce.notas.length > 0 && (
        <ul style={{ marginTop: 10, paddingLeft: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          {cruce.notas.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8 }}>
        Costo real = gasto ÷ seguidores del posteo en Business Suite (entre paréntesis, los que vinieron de anuncios; incluye anuncios de otras campañas que usen el mismo posteo). Costo atribuido = gasto ÷ seguidores que Meta Ads le atribuye. Semáforo: hasta $2,20 winner · hasta $3 escalar · hasta $5 regular · más, bajo.
      </p>
    </div>
  )
}
