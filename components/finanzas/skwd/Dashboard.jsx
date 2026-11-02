import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from './supabase'
import { calcularDashboard, REGLAS } from './calculoDashboard'

// Todo se calcula en vivo desde los pagos VIGENTES (pagos_vigentes: con las correcciones aplicadas) y la columna "comisión" de Payroll.
// Solo lectura: no crea ni modifica pagos ni correcciones. No usa fórmulas ni tablas dinámicas del Excel.
// No lee Cuentas, Gastos, Gastos Personales ni los datos sensibles del equipo.

// Paleta de gráficos: tonos de la marca (Verde Toga, Oro Capital, Bordó) sobre superficie Marfil. Los nombres de las claves se conservan.
// Colores de la paleta del Despacho (marfil)
const COLOR = { principal: '#012d25', suave: '#9db5ac', naranja: '#be8f49', aqua: '#7f202c', gris: '#8c8574', grilla: '#e3d9c6', tinta2: '#605747' }
const fmt = (n) => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n) => '$' + Math.round(Number(n)).toLocaleString('es-AR')
const compacto = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k` : `$${Math.round(v)}`)
const pct = (x, signo = false) => (x === null || x === undefined ? 'n/d' : (signo && x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%')
const fechaCorta = (s) => s.split('-').reverse().join('/')

const hoyLocal = () => new Date().toLocaleDateString('en-CA')
const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const pad = (n) => String(n).padStart(2, '0')
function presets(hoy) {
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7))
  const mp = m === 1 ? 12 : m - 1, yp = m === 1 ? y - 1 : y
  return {
    'Este mes': [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(ultimoDia(y, m))}`],
    'Mes anterior': [`${yp}-${pad(mp)}-01`, `${yp}-${pad(mp)}-${pad(ultimoDia(yp, mp))}`],
    'Este año': [`${y}-01-01`, `${y}-12-31`],
  }
}

function Delta({ valor, invertir }) {
  if (valor === null || valor === undefined) return <span className="delta delta-nd">vs anterior: n/d</span>
  const sube = valor > 0
  const bueno = invertir ? !sube : sube
  return <span className={'delta ' + (valor === 0 ? 'delta-nd' : bueno ? 'delta-pos' : 'delta-neg')}>{sube ? '▲' : valor < 0 ? '▼' : '='} {pct(valor, true)} vs anterior</span>
}

function TooltipBarra({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="dash-tooltip">
      <strong>{d.etiqueta || d.nombre}</strong>
      <div>{fmt(d.usd)}</div>
      <div className="aviso">{d.n} pago(s)</div>
    </div>
  )
}

function GraficoBarras({ datos, horizontal = false, colorDe, titulo }) {
  const alto = horizontal ? 36 + datos.length * 34 : 260
  const etiquetas = datos.length <= 8
  return (
    <div role="img" aria-label={titulo} style={{ width: '100%', height: alto }}>
      <ResponsiveContainer>
        <BarChart data={datos} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 18, right: horizontal ? 56 : 8, left: horizontal ? 8 : 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={COLOR.grilla} strokeWidth={1} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={compacto} tick={{ fill: COLOR.gris, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="nombre" width={118} tick={{ fill: COLOR.tinta2, fontSize: 12 }} axisLine={{ stroke: '#cdbf9f' }} tickLine={false} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey="nombre" tick={{ fill: COLOR.tinta2, fontSize: 12 }} axisLine={{ stroke: '#cdbf9f' }} tickLine={false} interval={0} />
              <YAxis tickFormatter={compacto} tick={{ fill: COLOR.gris, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
            </>
          )}
          <Tooltip content={<TooltipBarra />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
          <Bar dataKey="usd" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} barSize={horizontal ? 18 : 26} isAnimationActive={false}>
            {datos.map((d, i) => <Cell key={i} fill={colorDe ? colorDe(d, i) : COLOR.principal} />)}
            {etiquetas && <LabelList dataKey="usd" position={horizontal ? 'right' : 'top'} formatter={compacto} fill={COLOR.tinta2} fontSize={11} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function TarjetaGrafico({ titulo, subtitulo, children, filas, columnas }) {
  return (
    <figure className="dash-card">
      <figcaption>
        <strong>{titulo}</strong>
        {subtitulo && <span className="aviso"> · {subtitulo}</span>}
      </figcaption>
      {children}
      {filas && (
        <details className="dash-tabla">
          <summary>Ver como tabla</summary>
          <table>
            <thead><tr>{columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </details>
      )}
    </figure>
  )
}

// cristal: con el diseño de cristal las barras «principal» se pintan marfil (cristal.css); en el clásico, verde oscuro.
// Solo cambia el texto que explica el color.
export default function Dashboard({ cristal = false }) {
  const hoy = hoyLocal()
  const P = useMemo(() => presets(hoy), [hoy])
  const [desde, setDesde] = useState(P['Mes anterior'][0])
  const [hasta, setHasta] = useState(P['Mes anterior'][1])
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const [p, e, pe] = await Promise.all([
        supabase.from('pagos_vigentes').select('fecha, programa, monto_usd, pesos_ars, closer, setter, concepto, fuente, tipo_venta, tipo_pago').limit(5000),
        // De Payroll SOLO la comisión registrada VIGENTE y el nombre (nunca los datos sensibles). La vista no admite el embebido de personas: se leen aparte.
        supabase.from('pagos_equipo_vigentes').select('mes, comision, persona_id').limit(5000),
        supabase.from('personas').select('id, nombre').limit(500),
      ])
      const err = p.error || e.error || pe.error
      if (err) return setError(err.message)
      const nombre = Object.fromEntries(pe.data.map((x) => [x.id, x.nombre]))
      setDatos({ pagos: p.data, equipo: e.data.map((x) => ({ mes: x.mes, comision: x.comision, persona: nombre[x.persona_id] ?? null })) })
    })()
  }, [])

  const rangoValido = desde && hasta && desde <= hasta
  const d = useMemo(() => (datos && rangoValido ? calcularDashboard({ desde, hasta, ...datos }) : null), [datos, desde, hasta, rangoValido])

  const activo = Object.entries(P).find(([, [a, b]]) => a === desde && b === hasta)?.[0]

  if (error && !datos) return <p className="error">Error: {error}</p>
  if (!datos) return <p>Cargando Dashboard…</p>

  const k = d?.kpis
  return (
    <>
      {error && <p className="error">Error: {error}</p>}

      <div className="filtros">
        <label className="check">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="check">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {Object.keys(P).map((n) => <button key={n} type="button" disabled={activo === n} onClick={() => { setDesde(P[n][0]); setHasta(P[n][1]) }}>{n}</button>)}
        <span className="aviso">El rango incluye el día de inicio y el de fin.</span>
      </div>
      {!rangoValido && <div className="aviso-box">⚠ La fecha "Desde" debe ser anterior o igual a "Hasta".</div>}

      {d && (
        <>
          <p className="aviso">Período: <strong>{fechaCorta(desde)} al {fechaCorta(hasta)}</strong> · se compara con {k.anterior.tipo}: {fechaCorta(k.anterior.desde)} al {fechaCorta(k.anterior.hasta)}</p>

          <div className="kpis">
            <div className="kpi destacada"><span>Cash collected</span><strong>{fmt(k.cash)}</strong><Delta valor={k.variacion.cash} /><small>Anterior: {fmt(k.anterior.cash)}</small></div>
            <div className="kpi"><span>Pagos</span><strong>{k.pagos}</strong><Delta valor={k.variacion.pagos} /><small>Anterior: {k.anterior.pagos}</small></div>
            <div className="kpi"><span>Ticket promedio</span><strong>{k.ticket === null ? 'n/d' : fmt(k.ticket)}</strong><Delta valor={k.variacion.ticket} /><small>Anterior: {k.anterior.ticket === null ? 'n/d' : fmt(k.anterior.ticket)}</small></div>
            <div className="kpi"><span>Cobrado en pesos</span><strong>{k.pesos.pct === null ? 'n/d' : pct(k.pesos.pct)}</strong><small>{k.pesos.n} pago(s) · {fmt(k.pesos.usd)} equivalentes</small></div>
          </div>

          <div className="dash-grid">
            <TarjetaGrafico titulo={`Cash collected por mes ${d.anio}`} subtitulo={`los meses del rango en ${cristal ? 'marfil' : 'verde oscuro'}`}
              columnas={['Mes', 'Cash', 'Pagos']} filas={d.porMes.map((m) => [m.nombre, fmt(m.usd), m.n])}>
              <GraficoBarras datos={d.porMes.map((m) => ({ nombre: m.nombre, usd: m.usd, n: m.n, etiqueta: `${m.nombre} ${d.anio}`, enRango: m.enRango }))} titulo={`Cash por mes ${d.anio}`} colorDe={(x) => (x.enRango ? COLOR.principal : COLOR.suave)} />
            </TarjetaGrafico>

            <TarjetaGrafico titulo="Cash por fuente" columnas={['Fuente', 'Cash', 'Pagos']} filas={d.porFuente.map((x) => [x.nombre, fmt(x.usd), x.n])}>
              <GraficoBarras horizontal datos={d.porFuente} titulo="Cash por fuente" colorDe={(x) => (x.nombre === 'Sin fuente' ? COLOR.gris : COLOR.principal)} />
            </TarjetaGrafico>

            <TarjetaGrafico titulo="Pagos por concepto" subtitulo="monto; la cantidad está en la tabla" columnas={['Concepto', 'Cash', 'Pagos']} filas={d.porConcepto.map((x) => [x.nombre, fmt(x.usd), x.n])}>
              <GraficoBarras datos={d.porConcepto} titulo="Cash por concepto" />
            </TarjetaGrafico>

            <TarjetaGrafico titulo="Cash por closer" columnas={['Closer', 'Cash', 'Pagos']} filas={d.porCloser.map((x) => [x.nombre, fmt(x.usd), x.n])}>
              <GraficoBarras horizontal datos={d.porCloser} titulo="Cash por closer" colorDe={(x) => (x.nombre === 'Sin closer' ? COLOR.gris : COLOR.principal)} />
            </TarjetaGrafico>

            <TarjetaGrafico titulo="Cash por setter" columnas={['Setter', 'Cash', 'Pagos']} filas={d.porSetter.map((x) => [x.nombre, fmt(x.usd), x.n])}>
              <GraficoBarras horizontal datos={d.porSetter} titulo="Cash por setter" colorDe={(x) => (x.nombre === 'Sin setter' ? COLOR.gris : COLOR.principal)} />
            </TarjetaGrafico>

            <TarjetaGrafico titulo="Tipo de venta y de pago" subtitulo="FECCU · FECCP · BECC · Sin clasificar"
              columnas={['Categoría', 'Cash', 'Pagos']}
              filas={[['FECCU · Front-end Upfront', fmt(d.clasificacion.feccu.usd), d.clasificacion.feccu.n], ['FECCP · Front-end Payment Plan', fmt(d.clasificacion.feccp.usd), d.clasificacion.feccp.n], ['BECC · Back-end', fmt(d.clasificacion.becc.usd), d.clasificacion.becc.n], ['Sin clasificar', fmt(d.clasificacion.sinClasificar.usd), d.clasificacion.sinClasificar.n]]}>
              <GraficoBarras datos={[
                { nombre: 'FECCU', etiqueta: 'FECCU · Front-end Upfront', ...d.clasificacion.feccu, color: COLOR.principal },
                { nombre: 'FECCP', etiqueta: 'FECCP · Front-end Payment Plan', ...d.clasificacion.feccp, color: COLOR.naranja },
                { nombre: 'BECC', etiqueta: 'BECC · Back-end', ...d.clasificacion.becc, color: COLOR.aqua },
                { nombre: 'Sin clasificar', etiqueta: 'Sin clasificar', ...d.clasificacion.sinClasificar, color: COLOR.gris },
              ]} titulo="Cash por tipo de venta y de pago" colorDe={(x) => x.color} />
            </TarjetaGrafico>
          </div>

          <section className="dash-seccion">
            <h3>FECCU · FECCP · BECC</h3>
            <div className="tarjetas">
              <div><span>FECCU (Front-end Upfront)</span><strong>{fmt(d.clasificacion.feccu.usd)}</strong><small>{d.clasificacion.feccu.n} pago(s)</small></div>
              <div><span>FECCP (Front-end Payment Plan)</span><strong>{fmt(d.clasificacion.feccp.usd)}</strong><small>{d.clasificacion.feccp.n} pago(s)</small></div>
              <div><span>BECC (Back-end)</span><strong>{fmt(d.clasificacion.becc.usd)}</strong><small>{d.clasificacion.becc.n} pago(s)</small></div>
              <div className={d.clasificacion.sinClasificar.n ? 'tarjeta-alerta' : ''}><span>Sin clasificar</span><strong>{fmt(d.clasificacion.sinClasificar.usd)}</strong><small>{d.clasificacion.sinClasificar.n} pago(s)</small></div>
            </div>
            <p className="aviso">
              "Sin clasificar" no se asigna solo: incluye {d.clasificacion.detalleSinClasificar.frontSinTipoPago.n} pago(s) Front-end sin tipo de pago ({fmt(d.clasificacion.detalleSinClasificar.frontSinTipoPago.usd)}) y {d.clasificacion.detalleSinClasificar.sinTipoVenta.n} sin tipo de venta ({fmt(d.clasificacion.detalleSinClasificar.sinTipoVenta.usd)}).
              BECC solo necesita el tipo de venta Back-end{d.clasificacion.backSinTipoPago.n > 0 ? `; ${d.clasificacion.backSinTipoPago.n} de esos pago(s) no tienen tipo de pago` : ''}.
            </p>
          </section>

          <section className="dash-seccion">
            <h3>Comisiones</h3>
            <p className="aviso">La comisión <strong>teórica</strong> sale de la regla del Excel y se muestra junto a la registrada en Payroll. No modifica Payroll.</p>
            {d.comisiones.rangoParcial && <div className="aviso-box">ℹ El rango no es una sucesión de meses completos: la comisión de Payroll es mensual, por eso no se compara (muestra "—").</div>}
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>Persona</th><th>Cómo se calculó</th><th>Comisión teórica</th><th>Registrada en Payroll</th><th>Diferencia</th></tr></thead>
                <tbody>
                  {d.comisiones.personas.length === 0 && <tr><td colSpan={5}>No hay comisiones para calcular en este período.</td></tr>}
                  {d.comisiones.personas.map((p) => (
                    <tr key={p.nombre} className={p.diferencia !== null && Math.abs(p.diferencia) > 0.005 ? 'fila-revisar' : ''}>
                      <td><strong>{p.nombre}</strong>{p.alias.length > 0 && p.alias.join(' ') !== p.nombre && <div className="aviso">en Pagos: {p.alias.join(', ')}</div>}</td>
                      <td className="nota">{p.detalle.length ? p.detalle.map((x, i) => <div key={i}>{x.concepto} = {fmt(x.monto)}</div>) : <em>sin pagos atribuibles en el período</em>}</td>
                      <td>{p.estadoTeorica === 'sin_datos' ? <em>sin datos suficientes</em> : fmt(p.teorica)}</td>
                      <td>{p.estadoPayroll === 'ok' ? fmt(p.payroll) : p.estadoPayroll === 'rango_parcial' ? '—' : <em>sin datos suficientes{' '}<span className="aviso">(no se encontró a la persona en Payroll)</span></em>}</td>
                      <td>{p.diferencia === null ? '—' : Math.abs(p.diferencia) < 0.005 ? 'coincide ✔' : fmt(p.diferencia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {d.comisiones.socios.length > 0 && (
              <>
                <h4>Socios — comisión teórica, <u>no se paga</u></h4>
                <div className="tabla-scroll">
                  <table>
                    <thead><tr><th>Socio</th><th>Cash como closer</th><th>Comisión teórica (10%)</th></tr></thead>
                    <tbody>{d.comisiones.socios.map((s) => <tr key={s.nombre} className="fila-gris"><td>{s.nombre}</td><td>{fmt(s.cash)} ({s.n})</td><td>{fmt(s.teorica)} <span className="et et-gris">NO SE PAGA</span></td></tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
            {d.comisiones.notas.map((n, i) => <div key={i} className={n.tipo === 'sin_datos' ? 'aviso-box' : 'aviso'}>{n.tipo === 'sin_datos' ? '⚠ ' : 'ℹ '}{n.texto}</div>)}
            <details className="er-detalle">
              <summary>Reglas de comisión usadas (las del Excel)</summary>
              <ul>
                <li><strong>Closers:</strong> {(REGLAS.closerPct * 100).toFixed(0)}% de todo el cash del closer en el período. Se calcula para todas las personas que aparecen en los datos (sin lista fija).</li>
                <li><strong>Setter Mai:</strong> {(REGLAS.setterInboundPct * 100).toFixed(0)}% de Fee + PIF + 1ra Cuota con fuente "Inbound IG".</li>
                <li><strong>ENRU / Mai:</strong> {(REGLAS.setterEnrutamientoPct * 100).toFixed(1)}% de Fee + PIF + 1ra Cuota con fuente "Enrutamiento" (pagos con setter "Mai" o "ENRU / Mai"; el Excel calculaba esta fila con el setter "Mai").</li>
                <li><strong>Socios (Gero y Tomi):</strong> comisión teórica aparte; nunca se mezcla con las comisiones de Payroll.</li>
                <li>Si faltan datos (por ejemplo un pago sin setter, sin closer o sin fuente) se informa "sin datos suficientes"; no se asume nada.</li>
                <li>La comisión de Payroll es mensual: solo se compara cuando el rango cubre meses completos.</li>
              </ul>
            </details>
          </section>

          <section className="dash-seccion">
            <h3>Calidad de datos</h3>
            {!d.calidad.hayProblemas ? <p className="ok">✔ Todos los pagos del período tienen los datos completos.</p> : (
              <>
                <p className="aviso">Pagos del período con datos incompletos (se corrigen desde la pestaña Pagos):</p>
                <div className="tarjetas">
                  {[['sinFuente', 'Sin fuente'], ['sinTipoPago', 'Sin tipo de pago'], ['sinTipoVenta', 'Sin tipo de venta'], ['sinSetter', 'Sin setter'], ['sinCloser', 'Sin closer'], ['sinConcepto', 'Sin concepto']].map(([c, t]) => (
                    <div key={c} className={d.calidad[c].n ? 'tarjeta-alerta' : ''}><span>{t}</span><strong>{d.calidad[c].n}</strong><small>{d.calidad[c].n ? fmt(d.calidad[c].usd) : 'completo ✔'}</small></div>
                  ))}
                </div>
              </>
            )}
          </section>

          <details className="er-detalle">
            <summary>Notas de cálculo</summary>
            <ul>
              <li>Todo sale de la tabla <strong>Pagos</strong>, por la fecha exacta de cada pago, con el rango inclusivo (por ejemplo, el rango de septiembre no incluye los cobros del 1/10).</li>
              <li>El período anterior de comparación: si el rango son meses completos, los mismos meses inmediatamente anteriores; si no, la misma cantidad de días justo antes.</li>
              <li>Cash en pesos: pagos con "Pesos ARS" cargado; el importe en USD es el equivalente ya registrado en "Efectivo recaudado".</li>
              <li>No intervienen Cuentas, Gastos, Gastos Personales ni los datos sensibles del equipo. De Payroll solo se lee el nombre y la comisión registrada.</li>
              <li>Los gráficos tienen su versión en tabla ("Ver como tabla").</li>
            </ul>
          </details>
        </>
      )}
    </>
  )
}
