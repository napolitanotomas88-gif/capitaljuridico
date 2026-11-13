'use client'

import { useState } from 'react'
import { fmtMoneda } from './tablero'
import { veredictoCosto, type CruceCalculado, type FilaPosteo, type TotalesCruce } from '@/lib/anuncios/seguidoresCruce'

// Costo por seguidor real de FM: cruce diario de Meta Ads (lo que atribuye) con Business Suite (lo que trajo cada
// posteo). El costo real usa solo los seguidores que vinieron de anuncios: los orgánicos no cuentan.
// Los datos los manda la tarea diaria de la Mac a /api/ads/seguidores.

const TONO: Record<'bueno' | 'medio' | 'malo', string> = {
  bueno: 'var(--tono-bueno)', medio: 'var(--brand-texto)', malo: 'var(--tono-malo)',
}

const entero = (v: number | null) => (v == null ? '—' : v.toLocaleString('es-AR'))
const nombreCuenta = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)

function Costo({ v, fuerte = true }: { v: number | null; fuerte?: boolean }) {
  if (v == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  return <span style={{ color: TONO[veredictoCosto(v).tono], fontWeight: fuerte ? 700 : 500 }}>{fmtMoneda(v)}</span>
}

const fechaCorta = (dia: string) => {
  const [, m, d] = dia.split('-')
  return `${Number(d)}/${Number(m)}`
}
const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

const th: React.CSSProperties = { textAlign: 'right', padding: '6px 6px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', padding: '7px 6px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const rotulo: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }

function Tarjeta({ titulo, valor, pie }: { titulo: string; valor: number | null; pie: string }) {
  const tono = valor != null ? TONO[veredictoCosto(valor).tono] : 'var(--text-muted)'
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
      <p style={rotulo}>{titulo}</p>
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

function FilaCuenta({ nombre, t, total = false }: { nombre: string; t: TotalesCruce; total?: boolean }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: total ? 'var(--bg)' : undefined }}>
      <td style={{ padding: '8px 6px', fontWeight: total ? 800 : 600 }}>{nombre}</td>
      <td style={td}>{fmtMoneda(t.gastoAcum)}</td>
      <td style={td}>{entero(t.atribuidosAcum)}</td>
      <td style={td}><Costo v={t.costoAtribuido} fuerte={false} /></td>
      <td style={td}>{entero(t.seguidoresReales)}</td>
      <td style={td}><Costo v={t.costoReal} /></td>
      <td style={td}>{fmtMoneda(t.gastoAyer)}</td>
      <td style={td}>{entero(t.atribuidosAyer)}</td>
      <td style={td}>{entero(t.seguidoresRealesAyer)}</td>
      <td style={td}><Costo v={t.costoRealAyer} /></td>
    </tr>
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
  const dia = fechaCorta(diaDatos)

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
          Cruce del {fechaCorta(cruce.dia)} a las {horaDe(cruce.tomada)} · Meta Ads × Business Suite · sin orgánicos
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, margin: '14px 0' }}>
        <Tarjeta titulo="Costo real FM — acumulado" valor={t.costoReal}
          pie={`${fmtMoneda(t.gastoConDato)} ÷ ${entero(t.seguidoresReales)} seguidores de anuncios`} />
        <Tarjeta titulo="Costo atribuido por Meta" valor={t.costoAtribuido}
          pie={`${fmtMoneda(t.gastoAcum)} ÷ ${entero(t.atribuidosAcum)} seguidores atribuidos`} />
        <Tarjeta titulo={`Costo real FM — día ${dia}`} valor={t.costoRealAyer}
          pie={hayAnterior ? `${fmtMoneda(t.gastoAyerConDato)} ÷ ${entero(t.seguidoresRealesAyer)} seguidores de anuncios · gasto total ${fmtMoneda(t.gastoAyer)}`
            : `gasto ${fmtMoneda(t.gastoAyer)} · los seguidores del día salen desde la segunda foto`} />
      </div>

      {/* Por cuenta publicitaria: cada una medida por separado, más el total */}
      <p style={{ ...rotulo, marginBottom: 4 }}>Por cuenta</p>
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...th, textAlign: 'left' }}>CUENTA</th>
              <th style={th}>GASTO</th><th style={th}>ATRIBUIDOS</th><th style={th}>COSTO ATRIB.</th>
              <th style={th}>SEGUIDORES ADS</th><th style={th}>COSTO REAL</th>
              <th style={th}>DÍA {dia}: GASTO</th><th style={th}>ATRIB.</th><th style={th}>SEG. ADS</th><th style={th}>COSTO REAL</th>
            </tr>
          </thead>
          <tbody>
            {cruce.porCuenta.map(c => <FilaCuenta key={c.cuenta} nombre={nombreCuenta(c.cuenta)} t={c.totales} />)}
            {cruce.porCuenta.length > 1 && <FilaCuenta nombre="Total FM" t={t} total />}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {boton('ayer', `Día ${dia}`)}
        {boton('acumulado', 'Acumulado')}
        {vista === 'ayer' && !hayAnterior && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Seguidores del día: desde la segunda foto (Business Suite da acumulados).</span>
        )}
      </div>

      {filas.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          {vista === 'ayer' ? 'Ningún posteo de FM gastó ese día.' : 'Sin posteos con gasto para mostrar.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ ...th, textAlign: 'left' }}>POSTEO</th>
                {vista === 'ayer' ? (<>
                  <th style={th}>GASTO</th><th style={th}>ATRIBUIDOS</th><th style={th}>COSTO ATRIB.</th>
                  <th style={th}>SEG. ADS NUEVOS</th><th style={th}>COSTO REAL</th>
                </>) : (<>
                  <th style={th}>GASTO</th><th style={th}>ATRIBUIDOS</th><th style={th}>COSTO ATRIB.</th>
                  <th style={th}>SEG. ADS (TOTAL)</th><th style={th}>COSTO REAL</th><th style={th}>CON ORGÁNICOS</th>
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
                    <td style={td}><Costo v={p.costoAtribuidoAyer} fuerte={false} /></td>
                    <td style={td}>{entero(p.bsAnunciosNuevos)}</td>
                    <td style={td}><Costo v={p.costoRealAyer} /></td>
                  </>) : (<>
                    <td style={td}>{fmtMoneda(p.gastoAcum)}</td>
                    <td style={td}>{entero(p.atribuidosAcum)}</td>
                    <td style={td}><Costo v={p.costoAtribuido} fuerte={false} /></td>
                    <td style={td}>{p.bsAnuncios == null ? 'sin dato' : `${entero(p.bsAnuncios)} (${entero(p.bsTotal)})`}</td>
                    <td style={td}><Costo v={p.costoReal} /></td>
                    <td style={td}><Costo v={p.costoConOrganicos} fuerte={false} /></td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cruce.perfiles.length > 0 && (
        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          <p style={{ ...rotulo, marginBottom: 4 }}>Anuncios sin posteo propio · crecimiento del perfil menos orgánicos</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ ...th, textAlign: 'left' }}>PERFIL</th>
                <th style={th}>SEGUIDORES</th><th style={th}>CRECIMIENTO</th><th style={th}>− ORGÁNICOS</th><th style={th}>SEG. ADS</th>
                <th style={th}>GASTO</th><th style={th}>COSTO REAL</th><th style={th}>ATRIBUIDOS</th>
                <th style={th}>DÍA: GASTO</th><th style={th}>DÍA: SEG. ADS</th><th style={th}>DÍA: COSTO</th>
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
                  <td style={td}>{entero(p.crecimientoAcum)}</td>
                  <td style={td}>{entero(p.organicosAcum)}</td>
                  <td style={td}>{entero(p.nuevosAcum)}</td>
                  <td style={td}>{fmtMoneda(p.gastoAcum)}</td>
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
        Costo real = gasto ÷ seguidores que vinieron de anuncios según Business Suite (los orgánicos no cuentan; incluye anuncios de otras campañas que usen el mismo posteo). En los perfiles sin posteo propio: crecimiento del perfil menos los seguidores orgánicos de sus posteos. Costo atribuido = gasto ÷ seguidores que Meta Ads le atribuye. Semáforo: hasta $2,20 winner · hasta $3 escalar · hasta $5 regular · más, bajo.
      </p>
    </div>
  )
}
