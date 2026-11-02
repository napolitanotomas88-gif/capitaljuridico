import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { calcularEstado } from './calculoEstado'
import { dolares } from './formato'

// Todo se calcula en vivo desde los valores VIGENTES (con las correcciones aplicadas): pagos_vigentes, gastos_vigentes,
// pagos_equipo_vigentes y, de Cuentas, solo las inversiones leídas de la vista movimientos_cuenta_empresa.
// Esta pantalla es solo de lectura/cálculo: nunca lee las tablas originales ni escribe correcciones. No se usa ninguna fórmula del Excel.

const fmt = (n) => dolares(n, 2)
// Celdas de la tabla: sin símbolo, porque la tabla dice «USD» en el encabezado
const num = (n) => (Number(n) < 0 ? '−' : '') + Math.abs(Number(n)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (x) => (x === null || x === undefined ? 'n/d' : (x * 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%')
const hoyLocal = () => new Date().toLocaleDateString('en-CA')
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const etiquetaTipo = (t) => t   // mismo nombre que en Gastos y en el Resumen («Software»)

export default function EstadoResultados() {
  const hoy = hoyLocal()
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)))
  const [datos, setDatos] = useState(null)
  const [saldo, setSaldo] = useState(0)
  const [saldoEdit, setSaldoEdit] = useState('0')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  // «Comparación con Excel»: la foto del Excel ya no viaja dentro del código público de la web; se lee de la tabla protegida
  // estado_referencia_excel (solo usuarios autorizados). null = el panel todavía no se abrió; después 'cargando' | 'no_disponible' | 'ok'.
  const [referencia, setReferencia] = useState(null)

  async function cargarDatos() {
    const [p, g, e, i] = await Promise.all([
      supabase.from('pagos_vigentes').select('fecha, monto_usd, comision').limit(5000),
      supabase.from('gastos_vigentes').select('fecha, monto_usd, tipo').limit(5000),
      supabase.from('pagos_equipo_vigentes').select('mes, departamento, total_usd, pagado').limit(5000),
      // De Cuentas SOLO la vista de empresa, y SOLO inversiones
      supabase.from('movimientos_cuenta_empresa').select('periodo, monto, tipo').eq('tipo', 'Inversión empresa').limit(5000),
    ])
    const err = p.error || g.error || e.error || i.error
    if (err) return setError(err.message)
    setDatos({ pagos: p.data, gastos: g.data, equipo: e.data, inversiones: i.data })
  }

  async function cargarSaldo(a) {
    const { data, error } = await supabase.from('estado_parametros').select('anio, saldo_inicial').eq('anio', a)
    if (error) return setError(error.message)
    const v = data && data[0] ? Number(data[0].saldo_inicial) : 0
    setSaldo(v)
    setSaldoEdit(String(v))
  }

  // Solo se pide al abrir el panel. Sin datos, sin autorización (la base devuelve 0 filas) o con cualquier error => «no disponible»:
  // nunca se inventan cifras ni se toca el resto del Estado de Resultados.
  async function cargarReferencia(a) {
    setReferencia({ estado: 'cargando' })
    const { data, error } = await supabase.from('estado_referencia_excel').select('mes, beneficio, acumulado, causa, fecha_referencia').eq('anio', a).order('mes')
    const filas = !error && Array.isArray(data)
      ? data.map((f) => ({ mes: Number(f.mes), beneficio: Number(f.beneficio), acumulado: f.acumulado === null || f.acumulado === undefined ? null : Number(f.acumulado), causa: f.causa || '', fecha: String(f.fecha_referencia || '') }))
      : []
    const valida = filas.length > 0 && filas.every((f, i) => Number.isInteger(f.mes) && f.mes >= 1 && f.mes <= 12 && Number.isFinite(f.beneficio) && (f.acumulado === null || Number.isFinite(f.acumulado)) && (i === 0 || f.mes > filas[i - 1].mes))
    if (!valida) return setReferencia({ estado: 'no_disponible' })
    const [aa, mm, dd] = filas[0].fecha.slice(0, 10).split('-')
    setReferencia({ estado: 'ok', filas, fecha: aa && mm && dd ? `${dd}/${mm}/${aa}` : '' })
  }

  useEffect(() => {
    cargarDatos()
  }, [])
  useEffect(() => {
    cargarSaldo(anio)
  }, [anio])

  async function guardarSaldo(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    const v = Number(saldoEdit)
    if (!Number.isFinite(v)) return setError('El saldo inicial debe ser un número.')
    const { error } = await supabase.from('estado_parametros').upsert({ anio, saldo_inicial: v, actualizado_en: new Date().toISOString() }, { onConflict: 'anio' })
    if (error) return setError(error.message)
    setSaldo(v)
    setMensaje('Saldo inicial guardado.')
  }

  const anios = useMemo(() => {
    const s = new Set([Number(hoy.slice(0, 4))])
    if (datos) {
      datos.pagos.forEach((x) => x.fecha && s.add(Number(x.fecha.slice(0, 4))))
      datos.gastos.forEach((x) => x.fecha && s.add(Number(x.fecha.slice(0, 4))))
      datos.equipo.forEach((x) => x.mes && s.add(Number(x.mes.slice(0, 4))))
    }
    return [...s].sort((a, b) => b - a)
  }, [datos, hoy])

  const est = useMemo(() => (datos ? calcularEstado({ anio, hoy, saldoInicial: saldo, ...datos }) : null), [datos, anio, hoy, saldo])

  if (error && !est) return <p className="error">Error: {error}</p>
  if (!est) return <p>Cargando Estado de Resultados…</p>

  const activos = est.meses.filter((m) => !m.vacio)
  const ultimo = activos[activos.length - 1]
  const mesEnCurso = est.meses.find((m) => m.estado === 'en_curso')

  // ---- definición de las filas de la tabla
  const filas = [
    { t: 'seccion', label: 'INGRESOS' },
    { label: 'Cash collected', m: (m) => m.cash, tot: est.total.cash, f: num, fuerte: true },
    { label: '↳ variación vs mes anterior', m: (m) => m.variacion, tot: null, f: pct, sub: true, nd: true },
    { label: 'Comisiones de plataformas', m: (m) => m.comisiones, tot: est.total.comisiones, f: num },
    { label: 'Cash collected neto', m: (m) => m.cashNeto, tot: est.total.cashNeto, f: num, fuerte: true },
    { t: 'seccion', label: 'GASTOS OPERATIVOS' },
    { t: 'sub', label: 'Staff (Payroll, todas las líneas del mes)' },
    ...est.areas.map((a) => ({ label: a, m: (m) => m.staff.areas[a], tot: est.total.staff.areas[a], f: num, sangria: true })),
    { label: 'Subtotal Staff', m: (m) => m.staff.subtotal, tot: est.total.staff.subtotal, f: num, fuerte: true },
    { label: '↳ pendiente de pago (ya incluido arriba)', m: (m) => m.staff.pendiente, tot: est.total.staff.pendiente, f: (p) => (p.lineas > 0 ? `${num(p.monto)} (${p.lineas})` : '—'), sub: true, texto: true },
    { t: 'sub', label: 'Gastos (tabla Gastos, una línea por tipo)' },
    ...est.tipos.map((tp) => ({ label: etiquetaTipo(tp), m: (m) => m.gastosPorTipo[tp], tot: est.total.gastosPorTipo[tp], f: num, sangria: true })),
    { label: 'Gastos totales', m: (m) => m.gastosTotales, tot: est.total.gastosTotales, f: num, fuerte: true },
    { t: 'seccion', label: 'RESULTADO' },
    { label: 'BENEFICIO NETO', m: (m) => m.beneficio, tot: est.total.beneficio, f: num, fuerte: true, destacada: true },
    { label: '% beneficio neto', m: (m) => m.pct, tot: est.total.pct, f: pct, sub: true, nd: true },
    { t: 'seccion', label: 'INVERSIONES (desde Cuentas)' },
    { label: 'Inversiones', m: (m) => m.inversiones, tot: est.total.inversiones, f: num },
    { label: 'RESULTADO DESPUÉS DE INVERSIONES', m: (m) => m.resultadoDespuesInversiones, tot: est.total.resultadoDespuesInversiones, f: num, fuerte: true, destacada: true },
    { t: 'seccion', label: 'BENEFICIO ACUMULADO' },
    { label: 'Beneficio acumulado', m: (m) => m.acumulado, tot: ultimo ? ultimo.acumulado : null, f: num, fuerte: true },
    { label: 'Beneficio acumulado después de inversiones', m: (m) => m.acumuladoDespuesInversiones, tot: ultimo ? ultimo.acumuladoDespuesInversiones : null, f: num },
  ]

  const celda = (fila, m) => {
    if (m.vacio) return <td key={m.key} className="er-vacio">—</td>
    const v = fila.m(m)
    const enCurso = m.estado === 'en_curso'
    let txt
    if (fila.nd && (v === null || v === undefined)) txt = enCurso ? 'n/d' : '—'
    else txt = fila.f(v)
    const marca = enCurso && !fila.nd && !fila.texto ? '*' : ''
    const neg = !fila.texto && typeof v === 'number' && v < 0 && fila.f === fmt
    return <td key={m.key} className={(enCurso ? 'er-encurso ' : '') + (neg ? 'neg' : '')} title={typeof v === 'number' && fila.f === fmt ? String(v) : undefined}>{txt}{marca}</td>
  }

  return (
    <>
      <div className="cabecera">
        {/* El título lo pone la página (SeccionTitulo de FinanzasSkwd): acá iba repetido */}
        <label className="check">Año
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>{anios.map((a) => <option key={a}>{a}</option>)}</select>
        </label>
      </div>
      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      <form onSubmit={guardarSaldo} className="filtros">
        <label className="check">Saldo inicial del beneficio acumulado (USD)
          <input type="number" step="0.01" value={saldoEdit} onChange={(e) => setSaldoEdit(e.target.value)} style={{ width: 130 }} />
        </label>
        <button type="submit" disabled={Number(saldoEdit) === saldo}>Guardar saldo inicial</button>
        <span className="aviso">Opcional. En la planilla anterior estaba vacío (US$ 0).</span>
      </form>

      {mesEnCurso && (
        <div className="aviso-box">
          ⏳ <strong>{MESES_LARGO[mesEnCurso.m - 1].replace(/^./, (c) => c.toUpperCase())} está en curso</strong>: los números del mes son parciales y llevan asterisco (*). El equipo se liquida a fin de mes y los gastos todavía no están cargados, por eso el % de beneficio y la variación figuran como "n/d".
        </div>
      )}
      {est.alertas.map((a) => <div key={a} className="aviso-box">⚠ {a}</div>)}

      <div className="resumen-principal">
        <div><span>Cash collected {anio}{est.hayMesEnCurso ? ' (incluye mes en curso)' : ''}</span><strong className="pos">{fmt(est.total.cash)}</strong></div>
        <div><span>Gastos totales</span><strong className="neg">{fmt(est.total.gastosTotales)}</strong></div>
        <div><span>Beneficio neto</span><strong>{fmt(est.total.beneficio)}</strong></div>
        <div><span>Resultado después de inversiones</span><strong>{fmt(est.total.resultadoDespuesInversiones)}</strong></div>
        <div><span>Beneficio acumulado a meses cerrados</span><strong>{fmt(est.acumuladoCerrado)}</strong></div>
        {est.hayMesEnCurso && <div><span>Acumulado con el mes en curso (parcial)</span><strong className="gris">{fmt(est.acumuladoConEnCurso)}*</strong></div>}
      </div>

      <div className="tabla-scroll er-tabla">
        <table>
          <thead>
            <tr>
              <th>USD</th>
              {est.meses.map((m) => <th key={m.key} className={m.estado === 'en_curso' ? 'er-encurso' : ''}>{m.nombre}{m.estado === 'en_curso' ? ' (en curso)' : ''}</th>)}
              <th>Total año</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              if (f.t === 'seccion') return <tr key={i} className="er-seccion"><td colSpan={14}>{f.label}</td></tr>
              if (f.t === 'sub') return <tr key={i} className="er-sub"><td colSpan={14}>{f.label}</td></tr>
              const tot = f.tot === null || f.tot === undefined ? '—' : f.f(f.tot)
              return (
                <tr key={i} className={(f.fuerte ? 'er-fuerte ' : '') + (f.destacada ? 'er-destacada ' : '') + (f.sub ? 'er-subfila' : '')}>
                  <td className={f.sangria ? 'er-sangria' : ''}>{f.label}</td>
                  {est.meses.map((m) => celda(f, m))}
                  <td className="er-total">{tot}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {est.hayMesEnCurso && <p className="aviso">* Mes en curso: datos parciales. El Total año suma los meses cerrados y el mes en curso.</p>}

      <details className="er-detalle">
        <summary>Notas de cálculo (de dónde sale cada número y qué nunca entra)</summary>
        <ul>
          <li><strong>Cash collected y comisiones:</strong> tabla Pagos, por la fecha de cada pago. Un pago pertenece al mes de su fecha (límites exactos, sin "31 de septiembre" ni "31 de febrero").</li>
          <li><strong>Staff:</strong> Payroll (Pagos del equipo), por mes de liquidación y departamento. Se cuentan <strong>todas</strong> las líneas del mes, pagadas o no; las pendientes se indican aparte.</li>
          <li><strong>Software, Otros, Anuncios y demás:</strong> tabla Gastos, por fecha del gasto, con <strong>una línea por cada tipo</strong>. Un tipo nuevo o un gasto sin tipo aparecen solos.</li>
          <li><strong>Inversiones:</strong> de Cuentas, solo movimientos de tipo "Inversión empresa", leídos de la vista <code>movimientos_cuenta_empresa</code>.</li>
          <li><strong>Septiembre</strong> no incluye los cobros del 1/10 (pertenecen a octubre).</li>
          <li><strong>Los gastos de 2026</strong> se toman de los datos reales de Gastos, no de referencias a 2025.</li>
          <li><strong>Marzo</strong> incluye correctamente los gastos de tipo "Anuncios".</li>
          <li><strong>Nunca entran:</strong> Gastos Personales, ni los personales, resúmenes o transferencias entre cuentas de Cuentas, ni los ingresos y gastos de Cuentas (ya están en Pagos, Gastos y Payroll).</li>
          <li><strong>Beneficio acumulado:</strong> saldo inicial + suma de los beneficios mes a mes (en el Excel se llamaba "Saldo").</li>
        </ul>
      </details>

      {anio === 2026 && (
        <details className="er-detalle" onToggle={(e) => { if (e.currentTarget.open && (!referencia || referencia.estado !== 'ok')) cargarReferencia(anio) }}>
          <summary>Comparación con la planilla anterior y diferencias detectadas</summary>
          {!referencia || referencia.estado === 'cargando' ? (
            <p className="aviso">Cargando referencia…</p>
          ) : referencia.estado !== 'ok' ? (
            <p className="aviso-box">Referencia no disponible</p>
          ) : (
            <>
              <p className="aviso">Los valores del Excel son una foto fija{referencia.fecha ? ` al ${referencia.fecha}` : ''} y no se actualizan. Esta comparación es informativa: no interviene en el Estado de Resultados.</p>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>Mes</th><th>Beneficio en el Excel</th><th>Beneficio calculado (web)</th><th>Diferencia</th><th>Causa de la diferencia</th></tr></thead>
                  <tbody>
                    {referencia.filas.map((f) => {
                      const m = est.meses[f.mes - 1]
                      if (!m) return null
                      const web = !m.vacio ? m.beneficio : null
                      const dif = web === null ? null : Math.round((web - f.beneficio) * 100) / 100
                      return (
                        <tr key={f.mes} className={dif !== null && Math.abs(dif) > 0.005 ? 'fila-revisar' : ''}>
                          <td>{m.nombre}{m.estado === 'en_curso' ? ' (en curso)' : ''}</td>
                          <td>{fmt(f.beneficio)}</td>
                          <td>{web === null ? '—' : fmt(web)}</td>
                          <td>{dif === null ? '—' : Math.abs(dif) < 0.005 ? 'coincide ✔' : fmt(dif)}</td>
                          <td className="nota">{f.causa}</td>
                        </tr>
                      )
                    })}
                    {(() => {
                      const fa = [...referencia.filas].reverse().find((f) => f.acumulado !== null)
                      if (!fa) return null
                      return (
                        <tr className="fila-total">
                          <td>Acumulado hasta {MESES_LARGO[fa.mes - 1]}</td><td>{fmt(fa.acumulado)}</td>
                          <td>{est.acumuladoConEnCurso === null ? '—' : fmt(est.acumuladoConEnCurso)}</td>
                          <td>{est.acumuladoConEnCurso === null ? '—' : fmt(Math.round((est.acumuladoConEnCurso - fa.acumulado) * 100) / 100)}</td>
                          <td className="nota">El Excel sobrestimaba el beneficio acumulado por las diferencias anteriores.</td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </details>
      )}
    </>
  )
}

