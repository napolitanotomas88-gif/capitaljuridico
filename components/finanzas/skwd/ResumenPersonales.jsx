import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { calcularSaldoCombinado, etiquetaSaldo, INGRESOS_DESDE } from './calculoPersonales'

// Resumen de Gastos Personales. MÓDULO INDEPENDIENTE: recibe filas de gastos_personales y, solo para consulta, los ingresos
// («Quién recibió») ya leídos de Pagos. No escribe nada y no se mezcla con Gastos, Cuentas, Estado de Resultados ni Dashboard.

// Paleta de gráficos de marca: Gero = Verde Toga, Tomi = Oro Capital (se distinguen también por luminosidad). Nombres de claves sin cambios.
// Colores de la paleta del Despacho (marfil)
const COLOR = { gero: '#012d25', tomi: '#be8f49', neutro: '#012d25', gris: '#8c8574', grilla: '#e3d9c6', tinta2: '#605747' }
const fmt = (n) => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const compacto = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k` : `$${Math.round(v)}`)
const hoyLocal = () => new Date().toLocaleDateString('en-CA')
const pad = (n) => String(n).padStart(2, '0')
const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

function atajos(hoy) {
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7))
  return {
    Todo: ['', ''],
    'Este mes': [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(ultimoDia(y, m))}`],
    'Este año': [`${y}-01-01`, `${y}-12-31`],
  }
}

function TooltipMes({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="dash-tooltip">
      <strong>{d.nombre}</strong>
      <div style={{ color: COLOR.gero }}>● Gero pagó: {fmt(d.gero)}</div>
      <div style={{ color: COLOR.tomi }}>● Tomi pagó: {fmt(d.tomi)}</div>
      <div>Total: <strong>{fmt(d.total)}</strong> ({d.n} gasto(s))</div>
    </div>
  )
}
function TooltipSimple({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return <div className="dash-tooltip"><strong>{d.nombre}</strong><div>{fmt(d.usd)}</div><div className="aviso">{d.n} gasto(s)</div></div>
}

function Tarjeta({ titulo, subtitulo, children, columnas, filas }) {
  return (
    <figure className="dash-card">
      <figcaption><strong>{titulo}</strong>{subtitulo && <span className="aviso"> · {subtitulo}</span>}</figcaption>
      {children}
      <details className="dash-tabla">
        <summary>Ver como tabla</summary>
        <table>
          <thead><tr>{columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

function BarrasSimples({ datos, titulo }) {
  return (
    <div role="img" aria-label={titulo} style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={datos} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={COLOR.grilla} vertical={false} />
          <XAxis dataKey="nombre" tick={{ fill: COLOR.tinta2, fontSize: 12 }} axisLine={{ stroke: '#cdbf9f' }} tickLine={false} interval={0} />
          <YAxis tickFormatter={compacto} tick={{ fill: COLOR.gris, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
          <Tooltip content={<TooltipSimple />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
          <Bar dataKey="usd" fill={COLOR.neutro} radius={[4, 4, 0, 0]} barSize={34} isAnimationActive={false}>
            {datos.map((d, i) => <Cell key={i} fill={COLOR.neutro} />)}
            <LabelList dataKey="usd" position="top" formatter={compacto} fill={COLOR.tinta2} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function ResumenPersonales({ gastos, ingresos, errorIngresos, onEditar }) {
  const hoy = hoyLocal()
  const A = useMemo(() => atajos(hoy), [hoy])
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [tipo, setTipo] = useState('ambos')

  const rangoValido = !desde || !hasta || desde <= hasta
  const c = useMemo(() => calcularSaldoCombinado(gastos, ingresos, { desde: desde || null, hasta: hasta || null, tipo }), [gastos, ingresos, desde, hasta, tipo])
  const r = c.base // balance de gastos: la fórmula de siempre, sin cambios
  const activo = Object.entries(A).find(([, [a, b]]) => a === desde && b === hasta)?.[0]
  const b = r.balance
  const conIngresos = c.incluyeIngresos && c.disponible // el ajuste de ingresos entra al saldo solo en «Ambos» y si la lectura salió bien
  const ing = c.ingresos
  const hayDatos = r.n > 0 || (conIngresos && ing.n > 0)
  const mostrado = c.incluyeIngresos ? c.saldo : { deudor: b.deudor, texto: b.texto } // en «Ambos» el saldo puede ser null (no definitivo)
  const colorBalance = !mostrado ? COLOR.gris : mostrado.deudor === 'Tomi' ? COLOR.gero : mostrado.deudor === 'Gero' ? COLOR.tomi : COLOR.gris
  const mesDesde = INGRESOS_DESDE.slice(0, 7)
  const fechaCorta = INGRESOS_DESDE.split('-').reverse().join('/')

  return (
    <>
      <div className="aviso-box">
        Este resumen es <strong>independiente</strong> de las finanzas de la empresa: no afecta Pagos, Gastos, Cuentas, el Estado de Resultados ni el Dashboard.
        Los ingresos de «Quién recibió» se leen de Pagos solo para consulta.
      </div>

      <div className="filtros">
        <label className="check">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="check">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {Object.keys(A).map((n) => <button key={n} type="button" disabled={activo === n} onClick={() => { setDesde(A[n][0]); setHasta(A[n][1]) }}>{n}</button>)}
        <span className="aviso">Vacío = sin límite. Incluye el día de inicio y el de fin.</span>
      </div>
      <div className="filtros">
        <strong>Tipo de gasto:</strong>
        {[['ambos', 'Ambos'], ['Personal', 'Personal'], ['Empresarial', 'Empresarial']].map(([v, t]) => (
          <button key={v} type="button" disabled={tipo === v} onClick={() => setTipo(v)}>{t}</button>
        ))}
        <span className="aviso">Cambia el resumen, los gráficos y el balance.</span>
      </div>
      {!rangoValido && <div className="aviso-box">⚠ La fecha "Desde" debe ser anterior o igual a "Hasta".</div>}

      {c.incluyeIngresos && !c.disponible && (
        <div className="aviso-box">⚠ {errorIngresos || 'No se pudieron leer los ingresos.'} Por eso <strong>no se muestra el saldo final</strong> (gastos + ingresos): lo que ves abajo es solo el balance de gastos y no es definitivo. Recargá la página para reintentar.</div>
      )}
      {!c.incluyeIngresos && (
        <div className="aviso-box">ℹ En la vista «{tipo}» los <strong>ingresos recibidos no están incluidos</strong>: el saldo es solo de gastos. Los ingresos se suman únicamente en la vista «Ambos».</div>
      )}

      {!hayDatos ? (
        <p className="aviso">No hay gastos personales en este período{tipo !== 'ambos' ? ` de tipo ${tipo}` : ''}.</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><span>Total registrado</span><strong>{fmt(r.total)}</strong><small>{r.n} gasto(s)</small></div>
            <div className="kpi"><span style={{ color: COLOR.gero }}>● Pagó Gero</span><strong>{fmt(r.pagoGero)}</strong></div>
            <div className="kpi"><span style={{ color: COLOR.tomi }}>● Pagó Tomi</span><strong>{fmt(r.pagoTomi)}</strong></div>
            {conIngresos && <div className="kpi"><span>Ingresos desde el {fechaCorta}</span><strong>{fmt(ing.gero + ing.tomi)}</strong><small>Gero {fmt(ing.gero)} · Tomi {fmt(ing.tomi)}</small></div>}
            <div className="kpi destacada" style={{ borderColor: colorBalance }}>
              <span>{c.incluyeIngresos ? 'Saldo entre Gero y Tomi (gastos + ingresos)' : 'Balance entre Gero y Tomi (solo gastos)'}</span>
              {mostrado ? <strong style={{ fontSize: 20 }}>{mostrado.texto}</strong> : <strong style={{ fontSize: 20 }}>Sin calcular</strong>}
              <small>
                {conIngresos
                  ? `Gastos: ${b.texto} · Ingresos: ${c.ajuste.texto}`
                  : `Tomi debe ${fmt(b.tomiDebeAGero)} · Gero debe ${fmt(b.geroDebeATomi)}${c.incluyeIngresos ? ` · Solo gastos (provisorio): ${b.texto}` : ''}`}
              </small>
            </div>
          </div>
          {r.revisar.n > 0 && <div className="aviso-box">⚠ {r.revisar.n} gasto(s) por {fmt(r.revisar.usd)} están <strong>"A revisar"</strong> y quedan <strong>fuera del balance</strong> (ver abajo).</div>}

          <div className="dash-grid">
            <Tarjeta titulo="Gasto por mes" subtitulo="apilado por quién pagó" columnas={['Mes', 'Pagó Gero', 'Pagó Tomi', 'Total', 'Gastos']} filas={r.porMes.map((m) => [m.nombre, fmt(m.gero), fmt(m.tomi), fmt(m.total), m.n])}>
              <div role="img" aria-label="Gasto por mes, apilado por quién pagó" style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={r.porMes} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                    <CartesianGrid stroke={COLOR.grilla} vertical={false} />
                    <XAxis dataKey="nombre" tick={{ fill: COLOR.tinta2, fontSize: 12 }} axisLine={{ stroke: '#cdbf9f' }} tickLine={false} interval={0} />
                    <YAxis tickFormatter={compacto} tick={{ fill: COLOR.gris, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                    <Tooltip content={<TooltipMes />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: COLOR.tinta2 }}>{v === 'gero' ? 'Pagó Gero' : 'Pagó Tomi'}</span>} />
                    <Bar dataKey="gero" stackId="a" fill={COLOR.gero} stroke="#fffdf8" strokeWidth={2} barSize={30} isAnimationActive={false} />
                    <Bar dataKey="tomi" stackId="a" fill={COLOR.tomi} stroke="#fffdf8" strokeWidth={2} radius={[4, 4, 0, 0]} barSize={30} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Tarjeta>

            <Tarjeta titulo="Para quién fue el gasto" columnas={['Gasto de', 'Monto', 'Gastos']} filas={r.porParaQuien.map((x) => [x.nombre, fmt(x.usd), x.n])}>
              <BarrasSimples datos={r.porParaQuien} titulo="Gasto por categoría de 'gasto de'" />
            </Tarjeta>

            <Tarjeta titulo="Personal vs Empresarial" columnas={['Tipo', 'Monto', 'Gastos']} filas={r.porTipo.map((x) => [x.nombre, fmt(x.usd), x.n])}>
              <BarrasSimples datos={r.porTipo} titulo="Gasto por tipo" />
            </Tarjeta>
          </div>

          {c.incluyeIngresos && ing && (
            <section className="dash-seccion">
              <h3>Ingresos recibidos desde el {fechaCorta}</h3>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>Recibió</th><th>Pagos</th><th>Monto</th></tr></thead>
                  <tbody>
                    <tr><td>Gero</td><td>{ing.nGero}</td><td>{fmt(ing.gero)}</td></tr>
                    <tr><td>Tomi</td><td>{ing.nTomi}</td><td>{fmt(ing.tomi)}</td></tr>
                    <tr className="fila-total"><td colSpan={2}>Ajuste por ingresos = (Tomi {fmt(ing.tomi)} − Gero {fmt(ing.gero)}) / 2</td><td><strong>{c.ajuste.texto}</strong></td></tr>
                  </tbody>
                </table>
              </div>
              <p className="aviso">Solo cuentan los pagos con «Quién recibió» = Gero o Tomi, con el monto vigente en USD (con las correcciones aplicadas, sin descontar comisiones de pasarela). Los ingresos se reparten 50/50.</p>
              <div className="aviso-box">
                <strong>Informativo — NO entra al cálculo</strong> (según el período elegido):
                <ul>
                  <li>Pagos desde el {fechaCorta} <strong>sin «Quién recibió»</strong>: {ing.sinAsignar.n} por {fmt(ing.sinAsignar.usd)}
                    {ing.sinAsignar.n > 0 && ` — ${ing.sinAsignar.filas.map((p) => `#${p.id} ${p.cliente ?? ''} ${fmt(p.monto_usd)}`).join('; ')}`}. Se asignan desde la pestaña Pagos.</li>
                  <li>Pagos recibidos por Financiera: {ing.otrosReceptores.financiera.n} por {fmt(ing.otrosReceptores.financiera.usd)} · por Empresa: {ing.otrosReceptores.empresa.n} por {fmt(ing.otrosReceptores.empresa.usd)} (excluidos).</li>
                  <li>Pagos anteriores al {fechaCorta}: {ing.anteriores.n} por {fmt(ing.anteriores.usd)} (período histórico, no se recalcula)
                    {ing.anteriores.conReceptorPersonal.n > 0 && ` — ${ing.anteriores.conReceptorPersonal.n} de ellos tienen receptor Gero/Tomi pero tampoco se cuentan`}.</li>
                </ul>
              </div>
            </section>
          )}

          {r.n > 0 || (conIngresos && ing.n > 0) ? (
            <section className="dash-seccion">
              <h3>Detalle por mes</h3>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Mes</th>
                      {conIngresos && <><th>Recibió Gero</th><th>Recibió Tomi</th></>}
                      <th>Gero pagó por cuenta de Tomi</th><th>Tomi pagó por cuenta de Gero</th>
                      <th>Compartidos: pagó Gero</th><th>Compartidos: pagó Tomi</th><th>Saldo de gastos</th>
                      {conIngresos && <><th>Ajuste por ingresos</th><th>Saldo del mes</th><th>Saldo acumulado</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {c.mensual.map((m) => (
                      <tr key={m.mes}>
                        <td>{m.nombre}</td>
                        {conIngresos && (m.mes < mesDesde ? <><td>—</td><td>—</td></> : <><td>{fmt(m.recibioGero)}</td><td>{fmt(m.recibioTomi)}</td></>)}
                        <td>{fmt(m.geroPorTomi)}</td><td>{fmt(m.tomiPorGero)}</td><td>{fmt(m.compartidosGero)}</td><td>{fmt(m.compartidosTomi)}</td><td>{etiquetaSaldo(m.netoGastos)}</td>
                        {conIngresos && <><td>{m.mes < mesDesde ? '—' : etiquetaSaldo(m.ajuste)}</td><td>{etiquetaSaldo(m.saldoMes)}</td><td><strong>{etiquetaSaldo(m.acumulado)}</strong></td></>}
                      </tr>
                    ))}
                    {conIngresos && <tr className="fila-total"><td colSpan={9}>Saldo final (gastos + ingresos)</td><td colSpan={2}><strong>{c.saldo.texto}</strong></td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="aviso">«Gero pagó por cuenta de Tomi» = gastos «Gero para Tomi» (Tomi debe el 100%); «Tomi pagó por cuenta de Gero» = «Tomi para Gero» (Gero debe el 100%); «Compartidos» = «Para ambos» (el que no pagó debe el 50%). Solo se muestran los gastos que entran al balance (no los «A revisar»).{!conIngresos && ' Esta vista no incluye ingresos.'}</p>
            </section>
          ) : null}

          <section className="dash-seccion">
            <h3>Cómo se calcula el balance</h3>
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>Concepto</th><th>Gastos</th><th>Monto pagado</th><th>Parte que debe</th><th>Importe</th><th>Quién debe</th></tr></thead>
                <tbody>
                  {b.lineas.map((l) => (
                    <tr key={l.clave} className={l.n === 0 ? 'fila-gris' : ''}>
                      <td>{l.texto}</td><td>{l.n}</td><td>{fmt(l.base)}</td><td>{l.porcentaje * 100}%</td><td>{fmt(l.importe)}</td><td>{l.deudor} le debe a {l.acreedor}</td>
                    </tr>
                  ))}
                  <tr className="fila-total"><td colSpan={4}>Tomi le debe a Gero</td><td>{fmt(b.tomiDebeAGero)}</td><td></td></tr>
                  <tr className="fila-total"><td colSpan={4}>Gero le debe a Tomi</td><td>{fmt(b.geroDebeATomi)}</td><td></td></tr>
                  <tr className="fila-total"><td colSpan={4}>Balance neto de gastos</td><td colSpan={2}><strong>{b.texto}</strong></td></tr>
                  {conIngresos && <tr className="fila-total"><td colSpan={4}>Ajuste por ingresos (Tomi {fmt(ing.tomi)} − Gero {fmt(ing.gero)}) / 2</td><td colSpan={2}><strong>{c.ajuste.texto}</strong></td></tr>}
                  {conIngresos && <tr className="fila-total"><td colSpan={4}>Saldo final = balance de gastos + ajuste por ingresos</td><td colSpan={2}><strong>{c.saldo.texto}</strong></td></tr>}
                </tbody>
              </table>
            </div>
            <p className="aviso">Se usa "Ejecutado por" como quien pagó. "Gero para Tomi" lo paga Gero y Tomi debe el 100%; "Tomi para Gero" lo paga Tomi y Gero debe el 100%; "Para ambos": quien no pagó debe el 50%. Los gastos inconsistentes se marcan "A revisar" y no entran al balance.</p>
          </section>

          {r.revisar.n > 0 && (
            <section className="dash-seccion">
              <h3>A revisar ({r.revisar.n})</h3>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>Fecha</th><th>Ejecutado por</th><th>Tipo</th><th>Gasto de</th><th>Monto</th><th>Descripción</th><th>Motivo</th><th></th></tr></thead>
                  <tbody>
                    {r.revisar.filas.map((g) => (
                      <tr key={g.id} className="fila-revisar">
                        <td>{g.fecha}</td><td>{g.ejecutado_por}</td><td>{g.tipo_gasto}</td><td>{g.gasto_de}</td><td>{fmt(g.monto_usd)}</td><td>{g.descripcion}</td><td className="nota">{g.motivo}</td>
                        <td><button type="button" onClick={() => onEditar(g.id)}>Editar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  )
}
