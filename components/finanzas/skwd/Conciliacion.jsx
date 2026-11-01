import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { calcularConciliacion, decisionDesdeCandidato, etiquetaDestino } from './calculoConciliacion'

// Conciliación de Cuentas. Herramienta de REVISIÓN: solo sugiere y guarda TUS decisiones en la tabla `conciliaciones`.
// - No modifica Pagos, Gastos, Cuentas (movimientos originales), Payroll, Estado de Resultados ni Dashboard.
// - Lee los valores VIGENTES (con las correcciones aplicadas): pagos_vigentes, gastos_vigentes y pagos_equipo_vigentes.
// - Los movimientos a conciliar salen de la vista movimientos_cuenta_empresa (sin personales ni resúmenes; ya basada en la vista vigente).
// - Los resúmenes de Cuentas (movimientos_cuenta_vigentes con es_resumen) se leen SOLO para los "controles del mes".
// - No carga nada en Pagos ni en Gastos: "Falta registrar" solo deja una marca.

const fmt = (n) => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + '%')
const mesDe = (m) => (m.periodo ?? m.fecha ?? '').slice(0, 7)
const NOMBRE_ESTADO = { conciliado: 'Conciliado', sin_contraparte: 'Sin contraparte', falta_registrar: 'Falta registrar en Gastos', duplicado_cuentas: 'Duplicado dentro de Cuentas', ignorado: 'Ignorado' }
const filtrosVacios = { mes: '', cuenta: '', estado: 'pendientes' }

function Confianza({ estado }) {
  if (estado === 'alta') return <span className="et et-verde">ALTA</span>
  if (estado === 'media') return <span className="et et-naranja">MEDIA</span>
  if (estado === 'ambigua') return <span className="et et-revisar">AMBIGUA</span>
  if (estado === 'sin_coincidencia') return <span className="et et-gris">SIN COINCIDENCIA</span>
  return null
}

export default function Conciliacion() {
  const [datos, setDatos] = useState(null)
  const [vista, setVista] = useState('ingresos')
  const [filtros, setFiltros] = useState(filtrosVacios)
  const [panel, setPanel] = useState(null) // movId abierto para "elegir otro"
  const [lote, setLote] = useState(null) // confirmación en lote pendiente
  const [verTodasLote, setVerTodasLote] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function cargar() {
    // Todo se lee con los valores VIGENTES (con las correcciones aplicadas). Nada se modifica acá.
    const [m, r, p, g, e, pe, c, co] = await Promise.all([
      supabase.from('movimientos_cuenta_empresa').select('id, cuenta_id, fecha, periodo, descripcion, monto, tipo, hoja_origen').limit(5000),
      // SOLO resúmenes y SOLO para los "controles del mes": no entran en ningún cálculo empresarial
      supabase.from('movimientos_cuenta_vigentes').select('id, periodo, descripcion, monto').eq('es_resumen', true).limit(5000),
      supabase.from('pagos_vigentes').select('id, fecha, monto_usd, cliente, concepto').limit(5000),
      supabase.from('gastos_vigentes').select('id, fecha, monto_usd, concepto, tipo').limit(5000),
      supabase.from('pagos_equipo_vigentes').select('id, mes, total_usd, persona_id').limit(5000),
      supabase.from('personas').select('id, nombre').limit(500), // la vista vigente no admite el embebido de personas: se leen aparte
      supabase.from('cuentas').select('id, nombre').order('id'),
      supabase.from('conciliaciones').select('*').limit(5000),
    ])
    const err = m.error || r.error || p.error || g.error || e.error || pe.error || c.error
    if (err) return setError(err.message)
    const tablaFalta = !!co.error
    const nombrePersona = Object.fromEntries(pe.data.map((x) => [x.id, x.nombre]))
    setDatos({
      movimientos: m.data, resumenes: r.data, pagos: p.data, gastos: g.data,
      equipo: e.data.map((x) => ({ id: x.id, mes: x.mes, total_usd: x.total_usd, persona: nombrePersona[x.persona_id] ?? '' })),
      cuentas: c.data, conciliaciones: tablaFalta ? [] : co.data, tablaFalta,
    })
  }

  useEffect(() => {
    cargar()
  }, [])

  const R = useMemo(() => (datos ? calcularConciliacion(datos) : null), [datos])
  if (error && !datos) return <p className="error">Error: {error}</p>
  if (!datos || !R) return <p>Cargando conciliación…</p>

  const nombreCuenta = (id) => datos.cuentas.find((c) => c.id === id)?.nombre ?? '—'
  const puedeGuardar = !datos.tablaFalta

  // ---------------------------------------------------------------- persistencia (SOLO tabla conciliaciones)
  async function guardar(filas, texto) {
    setError(''); setMensaje('')
    if (!puedeGuardar) return setError('Primero hay que crear la tabla "conciliaciones" (ver el aviso de arriba).')
    const { error } = await supabase.from('conciliaciones').insert(filas)
    if (error) return setError(error.message)
    setMensaje(texto)
    setPanel(null); setLote(null); setVerTodasLote(false)
    await cargar()
  }
  async function deshacer(decision) {
    setError(''); setMensaje('')
    const { error } = await supabase.from('conciliaciones').delete().eq('id', decision.id)
    if (error) return setError(error.message)
    setMensaje('Decisión deshecha: el movimiento volvió a pendiente.')
    await cargar()
  }
  const decidir = (movId, estado, nota = null) => guardar([{ movimiento_cuenta_id: movId, estado, nota }], `Marcado como "${NOMBRE_ESTADO[estado]}".`)
  const pedirNota = (movId, estado) => { const n = window.prompt('Nota (opcional):', ''); if (n === null) return; decidir(movId, estado, n.trim() || null) }
  const confirmar = (mov, cand, confianza, nota) => guardar([decisionDesdeCandidato(mov.id, cand, confianza, nota)], 'Conciliación guardada.')

  // ---------------------------------------------------------------- filtros
  const pasa = (f) =>
    (!filtros.cuenta || f.mov.cuenta_id === Number(filtros.cuenta)) &&
    (!filtros.mes || (filtros.mes === 'sin' ? !mesDe(f.mov) : mesDe(f.mov) === filtros.mes)) &&
    (filtros.estado === 'todos' || (filtros.estado === 'pendientes' ? !f.decision : !!f.decision))
  const meses = [...new Set([...R.ingresos.filas, ...R.gastos.filas].map((f) => mesDe(f.mov)).filter(Boolean))].sort()

  // ---------------------------------------------------------------- etiquetas de destinos
  const textoDestino = (d) => {
    if (d.destino_tipo === 'pago') { const p = datos.pagos.find((x) => x.id === d.destino_id); return p ? `Pago de ${p.cliente} · ${p.fecha} · ${fmt(p.monto_usd)}` : '⚠ el pago ya no existe' }
    if (d.destino_tipo === 'gasto') { const g = datos.gastos.find((x) => x.id === d.destino_id); return g ? `Gasto "${g.concepto}" · ${g.fecha} · ${fmt(g.monto_usd)}` : '⚠ el gasto ya no existe' }
    if (d.destino_tipo === 'payroll_linea') { const e = datos.equipo.find((x) => x.id === d.destino_id); return e ? `Payroll: ${e.persona} · ${e.mes.slice(0, 7)} · ${fmt(e.total_usd)}` : '⚠ la línea de Payroll ya no existe' }
    if (d.destino_tipo === 'payroll_mes') return `Payroll: total del mes ${String(d.destino_mes).slice(0, 7)}`
    return ''
  }
  const textoCand = (c) => {
    const o = c.original
    if (c.tipo === 'pago') return `Pago de ${c.texto} · ${o.fecha} · ${fmt(o.monto_usd)}`
    if (c.tipo === 'gasto') return `Gasto "${c.texto}" · ${o.fecha} · ${fmt(o.monto_usd)}`
    if (c.tipo === 'payroll_linea') return `Payroll: ${c.texto} · ${c.mes} · ${fmt(c.monto)}`
    return `Payroll: total del mes ${c.mes} · ${fmt(c.monto)}`
  }

  // ---------------------------------------------------------------- fila de la tabla
  const Fila = ({ f, esGasto }) => {
    const { mov, decision, sugerencia: s } = f
    return (
      <tr className={decision ? 'fila-gris' : s?.estado === 'alta' ? '' : ''}>
        <td className="nowrap">{mov.fecha ?? <em>{mesDe(mov) || 'sin período'}</em>}</td>
        <td>{nombreCuenta(mov.cuenta_id)}</td>
        <td>{mov.descripcion}<div className="aviso">{mov.hoja_origen}</div></td>
        <td className="nowrap"><span className={mov.monto < 0 ? 'neg' : 'pos'}>{fmt(mov.monto)}</span></td>
        <td className="nota">
          {decision && (
            <>
              <strong>{NOMBRE_ESTADO[decision.estado]}</strong>
              {decision.estado === 'conciliado' && <div>{textoDestino(decision)}</div>}
              {decision.nota && <div className="aviso">Nota: {decision.nota}</div>}
            </>
          )}
          {!decision && s?.mejor && (
            <>
              <div>{textoCand(s.mejor.c)}</div>
              <div className="aviso">{s.mejor.razones.join(' · ')}</div>
            </>
          )}
          {!decision && s?.estado === 'ambigua' && <div>{s.candidatos.length} candidatos con el mismo puntaje: elegí uno.</div>}
          {!decision && s?.estado === 'sin_coincidencia' && (
            <>
              <div>{esGasto ? 'No está en Gastos ni en Payroll.' : 'No hay un pago con ese monto exacto.'}</div>
              {s.nota && <div className="aviso">{s.nota}</div>}
              {s.parcial?.length > 0 && <div className="aviso">¿Pago parcial a {[...new Set(s.parcial.map((c) => c.texto))].join(', ')} ({s.parcial[0].mes})? Podés asociarlo a mano.</div>}
              {s.debiles?.length > 0 && <div className="aviso">{s.debiles.length} candidato(s) débil(es) con mes distinto.</div>}
            </>
          )}
        </td>
        <td>{decision ? <span className="et et-gris">{decision.confianza ? decision.confianza.toUpperCase() : 'MARCADO'}</span> : <Confianza estado={s?.estado} />}</td>
        <td className="acciones-fila">
          {decision ? (
            <button type="button" onClick={() => deshacer(decision)}>Deshacer</button>
          ) : (
            <>
              {s?.mejor && ['alta', 'media'].includes(s.estado) && <button type="button" disabled={!puedeGuardar} onClick={() => confirmar(mov, s.mejor, s.estado)}>Confirmar</button>}
              {(s?.candidatos?.length > 0 || s?.debiles?.length > 0 || s?.parcial?.length > 0) && <button type="button" onClick={() => setPanel(mov.id)}>Elegir otro</button>}
              <button type="button" disabled={!puedeGuardar} onClick={() => pedirNota(mov.id, 'sin_contraparte')}>Sin contraparte</button>
              {esGasto && <button type="button" disabled={!puedeGuardar} onClick={() => pedirNota(mov.id, 'falta_registrar')}>Falta registrar en Gastos</button>}
              <button type="button" disabled={!puedeGuardar} onClick={() => pedirNota(mov.id, 'ignorado')}>Ignorar</button>
            </>
          )}
        </td>
      </tr>
    )
  }

  const Tabla = ({ filas, esGasto }) => (
    <div className="tabla-scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Cuenta</th><th>Movimiento 🔒</th><th>Monto 🔒</th><th>Sugerencia / decisión</th><th>Confianza</th><th>Acciones</th></tr></thead>
        <tbody>{filas.map((f) => <Fila key={f.mov.id} f={f} esGasto={esGasto} />)}</tbody>
      </table>
    </div>
  )

  const seccion = vista === 'ingresos' ? R.ingresos : R.gastos
  const filas = vista === 'ingresos' || vista === 'gastos' ? seccion.filas.filter(pasa) : []
  const altaVisible = filas.filter((f) => !f.decision && f.sugerencia?.estado === 'alta')
  const altaUsd = altaVisible.reduce((s, f) => s + Math.abs(f.mov.monto), 0)

  const movPanel = panel ? [...R.ingresos.filas, ...R.gastos.filas].find((f) => f.mov.id === panel) : null

  return (
    <>
      <h2>Conciliación de Cuentas</h2>
      <div className="aviso-box">
        Herramienta de <strong>revisión</strong>: sugiere coincidencias y guarda <strong>tus decisiones</strong>. No modifica Pagos, Gastos, Cuentas, Payroll, el Estado de Resultados ni el Dashboard, y no carga nada automáticamente. Los movimientos de Cuentas siguen bloqueados (🔒).
      </div>
      {datos.tablaFalta && (
        <div className="aviso-box">
          ⚠ Falta crear la tabla <strong>conciliaciones</strong> en Supabase. Mientras tanto podés ver las sugerencias, pero no guardar decisiones. Ejecutá el SQL que te pasó Claude y recargá.
        </div>
      )}
      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      <div className="tarjetas">
        {[['Ingresos ↔ Pagos', R.ingresos], ['Gastos ↔ Gastos / Payroll', R.gastos]].map(([t, c]) => (
          <div key={t}>
            <span>{t}</span><strong>{c.conciliados} de {c.total} conciliados</strong>
            <small>{c.alta} alta · {c.media} media · {c.ambigua} ambigua · {c.sinCoincidencia} sin coincidencia{c.faltaRegistrar ? ` · ${c.faltaRegistrar} falta registrar` : ''}</small>
          </div>
        ))}
        <div><span>Posibles duplicados en Cuentas</span><strong>{R.duplicados.length}</strong><small>grupos a revisar</small></div>
        <div><span>No se concilian</span><strong>{R.otros.total}</strong><small>inversiones y transferencias</small></div>
      </div>

      <nav className="subtabs">
        {[['ingresos', 'Ingresos ↔ Pagos'], ['gastos', 'Gastos ↔ Gastos y Payroll'], ['controles', 'Controles del mes'], ['duplicados', `Duplicados (${R.duplicados.length})`], ['cobertura', 'Cobertura']].map(([id, n]) => (
          <button key={id} type="button" onClick={() => { setVista(id); setPanel(null) }} disabled={vista === id}>{n}</button>
        ))}
      </nav>

      {(vista === 'ingresos' || vista === 'gastos') && (
        <>
          <div className="filtros">
            <select value={filtros.mes} onChange={(e) => setFiltros({ ...filtros, mes: e.target.value })}>
              <option value="">Todos los meses</option><option value="sin">Sin período</option>
              {meses.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filtros.cuenta} onChange={(e) => setFiltros({ ...filtros, cuenta: e.target.value })}>
              <option value="">Todas las cuentas</option>
              {datos.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
              <option value="pendientes">Pendientes</option><option value="decididos">Con decisión</option><option value="todos">Todos</option>
            </select>
            <button type="button" onClick={() => setFiltros(filtrosVacios)}>Limpiar</button>
            <button type="button" disabled={!puedeGuardar || altaVisible.length === 0} onClick={() => setLote({ filas: altaVisible, usd: altaUsd })}>
              Confirmar en lote las de confianza ALTA ({altaVisible.length})
            </button>
          </div>
          <p><strong>{filas.length}</strong> movimiento(s) en la vista actual.</p>

          {lote && (
            <div className="detalle">
              <h3>Confirmar {lote.filas.length} coincidencias de confianza ALTA</h3>
              <p>
                Vas a guardar <strong>{lote.filas.length}</strong> conciliaciones que suman <strong>{fmt(lote.usd)}</strong> (en valor absoluto), de {vista === 'ingresos' ? 'ingresos contra Pagos' : 'gastos contra Gastos / Payroll'}.
                Es solo un registro de tus decisiones: <strong>no modifica ningún movimiento, pago ni gasto</strong>, y cada una se puede deshacer después.
              </p>
              <ul className="datos">
                {(verTodasLote ? lote.filas : lote.filas.slice(0, 6)).map((f) => <li key={f.mov.id}>{f.mov.descripcion} ({fmt(f.mov.monto)}) → {textoCand(f.sugerencia.mejor.c)} <span className="aviso">· {f.sugerencia.mejor.razones.join(' · ')}</span></li>)}
                {lote.filas.length > 6 && <li><button type="button" onClick={() => setVerTodasLote(!verTodasLote)}>{verTodasLote ? 'Ver menos' : `Ver las ${lote.filas.length} coincidencias completas`}</button></li>}
              </ul>
              <div className="acciones">
                <button type="button" onClick={() => guardar(lote.filas.map((f) => decisionDesdeCandidato(f.mov.id, f.sugerencia.mejor, 'alta')), `${lote.filas.length} conciliaciones confirmadas (${fmt(lote.usd)}).`)}>Sí, confirmar {lote.filas.length} coincidencias ({fmt(lote.usd)})</button>
                <button type="button" onClick={() => setLote(null)}>Cancelar</button>
              </div>
            </div>
          )}

          {movPanel && (
            <section className="detalle">
              <div className="detalle-cab"><h3>Elegir otra contraparte</h3><button type="button" onClick={() => setPanel(null)}>Cerrar</button></div>
              <p><span className="bloqueado">🔒 {movPanel.mov.descripcion} · {fmt(movPanel.mov.monto)} · {movPanel.mov.fecha ?? mesDe(movPanel.mov) ?? 'sin período'} · {nombreCuenta(movPanel.mov.cuenta_id)}</span></p>
              {(() => {
                const s = movPanel.sugerencia
                const lista = [...(s?.candidatos || []).map((x) => ({ ...x, tipoLista: 'Candidato' })), ...(s?.debiles || []).map((x) => ({ ...x, tipoLista: 'Candidato débil' })), ...(s?.parcial || []).map((c) => ({ c, razones: ['mismo nombre en Payroll, monto distinto: posible pago parcial'], tipoLista: 'Posible pago parcial', parcial: true }))]
                if (!lista.length) return <p className="aviso">No hay otras opciones.</p>
                return (
                  <div className="tabla-scroll">
                    <table>
                      <thead><tr><th>Tipo</th><th>Contraparte</th><th>Por qué</th><th></th></tr></thead>
                      <tbody>
                        {lista.map((x, i) => (
                          <tr key={i}>
                            <td>{x.tipoLista}</td><td>{textoCand(x.c)}</td><td className="nota">{x.razones.join(' · ')}</td>
                            <td><button type="button" disabled={!puedeGuardar} onClick={() => confirmar(movPanel.mov, x, 'manual', x.parcial ? 'Pago parcial (monto distinto al total de la línea de Payroll)' : null)}>Asociar</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </section>
          )}

          <Tabla filas={filas} esGasto={vista === 'gastos'} />
          {vista === 'gastos' && R.otros.filas.length > 0 && (
            <section className="dash-seccion">
              <h4>No se concilian (inversiones y transferencias)</h4>
              <p className="aviso">Las inversiones ya se consideran en el Estado de Resultados; las transferencias entre cuentas no son ingresos ni gastos.</p>
              <div className="tabla-scroll"><table><tbody>
                {R.otros.filas.map((f) => <tr key={f.mov.id} className="fila-gris"><td>{f.mov.fecha ?? mesDe(f.mov)}</td><td>{nombreCuenta(f.mov.cuenta_id)}</td><td>{f.mov.descripcion}</td><td>{fmt(f.mov.monto)}</td><td>{f.mov.tipo}</td></tr>)}
              </tbody></table></div>
            </section>
          )}
        </>
      )}

      {vista === 'controles' && (
        <>
          <p className="aviso">Compara los <strong>resúmenes mensuales</strong> de Cuentas ("Cash collected" y "ADS") con los totales de Pagos y de Gastos. Es solo un control de calidad: los resúmenes <strong>no entran en ningún cálculo empresarial</strong>.</p>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>Mes</th><th>Cash collected (resúmenes)</th><th>Pagos del mes</th><th>Diferencia</th><th>ADS (resúmenes)</th><th>Gastos de Anuncios</th><th>Diferencia</th></tr></thead>
              <tbody>
                {R.controles.map((c) => (
                  <tr key={c.mes}>
                    <td>{c.mes}</td>
                    <td>{c.estadoCash ? fmt(c.cashResumenes) : '—'}</td><td>{fmt(c.cashPagos)}</td>
                    <td className={c.estadoCash === 'diferencia' ? 'neg' : ''}>{c.estadoCash === null ? '—' : c.estadoCash === 'ok' ? 'coincide ✔' : fmt(c.difCash)}</td>
                    <td>{c.estadoAds ? fmt(c.adsResumenes) : '—'}</td><td>{fmt(c.adsGastos)}</td>
                    <td className={c.estadoAds === 'diferencia' ? 'neg' : ''}>{c.estadoAds === null ? '—' : c.estadoAds === 'ok' ? 'coincide ✔' : fmt(c.difAds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {R.controles.length === 0 && <p className="aviso">No hay resúmenes para controlar.</p>}
        </>
      )}

      {vista === 'duplicados' && (
        <>
          <p className="aviso">Grupos de movimientos de Cuentas con la misma descripción, monto y mes, y <strong>más movimientos que pagos o gastos posibles</strong>. Marcar uno como duplicado solo deja una marca: no borra ni cambia el movimiento.</p>
          {R.duplicados.length === 0 && <p className="ok">✔ No se detectaron posibles duplicados.</p>}
          {R.duplicados.map((d) => (
            <section key={d.clave} className="dash-seccion">
              <h4>{d.movimientos[0].descripcion} · {fmt(d.movimientos[0].monto)} · {d.clave.split('|')[2]} — {d.movimientos.length} movimientos, {d.destinosPosibles} destino(s) posible(s)</h4>
              <div className="tabla-scroll">
                <table>
                  <tbody>
                    {d.movimientos.map((m, i) => (
                      <tr key={m.id}>
                        <td>{m.fecha ?? <em>{mesDe(m) || 'sin período'}</em>}</td><td>{nombreCuenta(m.cuenta_id)}</td><td>{m.hoja_origen}</td><td>{fmt(m.monto)}</td>
                        <td>{d.decisiones[i] ? <><strong>{NOMBRE_ESTADO[d.decisiones[i].estado]}</strong> <button type="button" onClick={() => deshacer(d.decisiones[i])}>Deshacer</button></> : <button type="button" disabled={!puedeGuardar} onClick={() => pedirNota(m.id, 'duplicado_cuentas')}>Marcar como duplicado de Cuentas</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}

      {vista === 'cobertura' && (
        <>
          <p className="aviso">Qué parte de los pagos de cada mes aparece en alguna cuenta. <strong>Es informativo, no un error</strong>: Cuentas no registra todos los movimientos del negocio.</p>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>Mes</th><th>Pagos</th><th>Cash</th><th>Conciliados</th><th>% conciliado</th><th>Sugeridos (alta/media)</th><th>% con sugeridos</th></tr></thead>
              <tbody>
                {R.cobertura.map((c) => (
                  <tr key={c.mes}><td>{c.mes}</td><td>{c.pagos}</td><td>{fmt(c.usd)}</td><td>{c.confirmados} ({fmt(c.usdConfirmados)})</td><td>{pct(c.pctConfirmado)}</td><td>{c.sugeridos} ({fmt(c.usdSugeridos)})</td><td>{pct(c.pctConConSugeridos)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
