import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import {
  CATALOGO, TABLAS, anotarEventos, avisosConciliacion, calcularImpacto, camposCorregidos, estaCorregido, formatearValor, normalizarEntrada,
  referenciaDe, valorOriginal, validarCorreccion,
} from './calculoCorrecciones'
import { dolares } from './formato'

// Correcciones de datos importados.
// - El ORIGINAL nunca se sobrescribe: cada corrección es un registro nuevo en la tabla `correcciones` (solo se agrega).
// - Quién y cuándo los pone la base de datos (tu sesión y la hora del servidor); el original y el valor anterior los copia la base.
// - Esta pantalla solo ESCRIBE (insert) en `correcciones`. No modifica Pagos, Gastos, Cuentas, Payroll ni las conciliaciones.

const VISTA_DE = { pagos: 'pagos_vigentes', gastos: 'gastos_vigentes', movimientos_cuenta: 'movimientos_cuenta_vigentes', pagos_equipo: 'pagos_equipo_vigentes' }
const COLUMNAS = {
  pagos: [['fecha', 'Fecha'], ['cliente', 'Cliente'], ['monto_usd', 'USD'], ['pesos_ars', 'ARS'], ['concepto', 'Concepto'], ['fuente', 'Fuente'], ['tipo_venta', 'Venta'], ['tipo_pago', 'Pago']],
  gastos: [['fecha', 'Fecha'], ['concepto', 'Concepto'], ['monto_usd', 'USD'], ['tipo', 'Tipo'], ['departamento', 'Depto'], ['cuenta', 'Cuenta']],
  movimientos_cuenta: [['fecha', 'Fecha'], ['descripcion', 'Descripción'], ['monto', 'Monto'], ['tipo', 'Tipo'], ['de_quien_para_quien', 'De quién / para quién']],
  pagos_equipo: [['mes', 'Mes'], ['persona', 'Persona'], ['puesto', 'Puesto'], ['departamento', 'Depto'], ['honorarios_base', 'Honorarios'], ['bonuses', 'Bonus'], ['comision', 'Comisión'], ['total_usd', 'Total'], ['moneda', 'Moneda']],
}
const COMPONENTES_PAYROLL = ['honorarios_base', 'bonuses', 'comision']
const fmt = (n) => dolares(n, 2)
const cuando = (s) => (s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const ETIQUETA_ESTADO = { vigente: ['VIGENTE', 'et-verde'], reemplazada: ['REEMPLAZADA', 'et-gris'], revertida: ['REVERTIDA', 'et-gris'], reversion: ['REVERSIÓN AL ORIGINAL', 'et-azul'] }

// objetivo: { tabla, id } cuando se llega desde el botón "Corregir" de otro módulo (abre el registro ya elegido).
export default function Correcciones({ objetivo = null, onConsumido = null }) {
  const objetivoRef = useRef(null)
  const [vista, setVista] = useState('corregir')
  const [config, setConfig] = useState({ campos: [], vocab: {} })
  const [eventos, setEventos] = useState([])
  const [conciliaciones, setConciliaciones] = useState([])
  const [movInfo, setMovInfo] = useState([])
  const [personas, setPersonas] = useState([])
  const [modulo, setModulo] = useState('pagos')
  const [filas, setFilas] = useState([])
  const [cargandoFilas, setCargandoFilas] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [soloCorregidos, setSoloCorregidos] = useState(false)
  const [limite, setLimite] = useState(100)
  const [sel, setSel] = useState(null) // { id }
  const [campo, setCampo] = useState('')
  const [texto, setTexto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [tambienTotal, setTambienTotal] = useState(true)
  const [filtroH, setFiltroH] = useState({ modulo: '', campo: '', quien: '', estado: '', buscar: '' })
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [inicial, setInicial] = useState(false)

  async function cargarBase() {
    const [ev, ca, vo, co, mv, pe] = await Promise.all([
      supabase.from('correcciones').select('*').order('id').limit(5000),
      supabase.from('campos_corregibles').select('tabla, campo'),
      supabase.from('vocabularios_correccion').select('tabla, campo, valor'),
      supabase.from('conciliaciones').select('*').limit(5000),
      supabase.from('movimientos_cuenta_vigentes').select('id, descripcion, monto').limit(5000),
      supabase.from('personas').select('id, nombre').limit(500),
    ])
    const err = ev.error || ca.error || vo.error || pe.error
    if (err) return setError(err.message)
    const vocab = {}
    for (const v of vo.data) (vocab[`${v.tabla}.${v.campo}`] = vocab[`${v.tabla}.${v.campo}`] || []).push(v.valor)
    setConfig({ campos: ca.data, vocab })
    setEventos(ev.data)
    setConciliaciones(co.error ? [] : co.data)
    setMovInfo(mv.error ? [] : mv.data)
    setPersonas(pe.data)
    setInicial(true)
  }
  async function cargarFilas(t) {
    setCargandoFilas(true)
    const { data, error } = await supabase.from(VISTA_DE[t]).select('*').order('id').limit(5000)
    setCargandoFilas(false)
    if (error) return setError(error.message)
    setFilas(data)
    // Si se llegó desde "Corregir" de otro módulo: abrir ese registro
    const o = objetivoRef.current
    if (o && o.tabla === t && data.some((f) => f.id === o.id)) {
      setSel({ id: o.id }); setCampo(''); setTexto(''); setMotivo(''); setMensaje(''); setError('')
      objetivoRef.current = null
      if (onConsumido) onConsumido()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
  useEffect(() => { cargarBase() }, [])
  useEffect(() => {
    if (!objetivo) return
    objetivoRef.current = objetivo
    setVista('corregir'); setBuscar(''); setSoloCorregidos(false)
    if (modulo !== objetivo.tabla) setModulo(objetivo.tabla)
    else cargarFilas(objetivo.tabla)
  }, [objetivo])
  useEffect(() => { setSel(null); setCampo(''); setLimite(100); setFilas([]); cargarFilas(modulo) }, [modulo])

  const nombrePersona = (id) => personas.find((p) => p.id === id)?.nombre ?? `#${id}`
  const permitidos = useMemo(() => config.campos.filter((c) => c.tabla === modulo).map((c) => c.campo), [config, modulo])
  const camposDelModulo = Object.keys(CATALOGO[modulo].campos).filter((c) => permitidos.includes(c))

  const filaSel = sel ? filas.find((f) => f.id === sel.id) : null
  const def = campo ? CATALOGO[modulo].campos[campo] : null
  const vocabCampo = config.vocab[`${modulo}.${campo}`] || []

  // ---- entrada, validación e impacto (en vivo)
  const entrada = useMemo(() => (def && texto !== '' ? normalizarEntrada(modulo, campo, texto, vocabCampo) : null), [def, texto, modulo, campo, vocabCampo])
  const errores = useMemo(() => {
    if (!filaSel || !def) return []
    const e = []
    if (entrada?.error) e.push(entrada.error)
    e.push(...validarCorreccion({ tabla: modulo, campo, valor: entrada?.valor ?? null, vigente: filaSel[campo], motivo }).filter((x) => !(entrada?.error && x === 'Falta el valor corregido.')))
    return e
  }, [filaSel, def, entrada, modulo, campo, motivo])
  const impacto = useMemo(() => {
    if (!filaSel || !def || !entrada || entrada.error) return null
    const filasCtx = modulo === 'pagos_equipo' ? filas : filas
    try { return calcularImpacto({ tabla: modulo, fila: filaSel, campo, valor: entrada.valor, filas: filasCtx }) } catch { return null }
  }, [filaSel, def, entrada, modulo, campo, filas])
  const avisosConc = useMemo(() => (filaSel && campo ? avisosConciliacion({ tabla: modulo, fila: filaSel, campo, conciliaciones, movimientos: movInfo }) : []), [filaSel, campo, modulo, conciliaciones, movInfo])
  const ofreceTotal = modulo === 'pagos_equipo' && COMPONENTES_PAYROLL.includes(campo) && impacto?.totalSugerido !== undefined && impacto?.totalSugerido !== null && Number(filaSel?.total_usd) !== impacto.totalSugerido && permitidos.includes('total_usd')

  const sugerencias = useMemo(() => (def && def.tipo === 'texto' ? [...new Set(filas.map((f) => f[campo]).filter(Boolean))].sort() : []), [def, filas, campo])

  // ---- escribir (SOLO insert en correcciones)
  async function guardarEventos(registros, textoOk) {
    setError(''); setMensaje('')
    const { error } = await supabase.from('correcciones').insert(registros)
    if (error) return setError(traducir(error.message))
    setMensaje(textoOk)
    setCampo(''); setTexto(''); setMotivo('')
    await Promise.all([cargarBase(), cargarFilas(modulo)])
  }
  const referencia = (f) => referenciaDe(modulo, f, personas)
  async function guardar(e) {
    e.preventDefault()
    if (errores.length) return setError(errores[0])
    const registros = [{ tabla: modulo, registro_id: filaSel.id, campo, tipo_evento: 'correccion', valor_nuevo: entrada.valor, motivo: motivo.trim(), referencia: referencia(filaSel) }]
    if (ofreceTotal && tambienTotal) registros.push({ tabla: modulo, registro_id: filaSel.id, campo: 'total_usd', tipo_evento: 'correccion', valor_nuevo: impacto.totalSugerido, motivo: `${motivo.trim()} (total recalculado)`, referencia: referencia(filaSel) })
    await guardarEventos(registros, registros.length > 1 ? 'Corrección guardada (y total recalculado).' : 'Corrección guardada. El valor original quedó intacto.')
  }
  async function revertir(tabla, registroId, campoR, refTexto) {
    const m = window.prompt(`Motivo para volver al valor ORIGINAL de "${campoR}" (mínimo 5 caracteres):`, '')
    if (m === null) return
    if (m.trim().length < 5) return setError('El motivo es obligatorio (mínimo 5 caracteres).')
    await guardarEventos([{ tabla, registro_id: registroId, campo: campoR, tipo_evento: 'reversion', motivo: m.trim(), referencia: refTexto }], 'Dato revertido a su valor original (la corrección anterior queda en el historial).')
  }

  // ---- listas
  const q = buscar.trim().toLowerCase()
  const visibles = filas.filter((f) => (!soloCorregidos || camposCorregidos(f).length) && (!q || [f.id, ...COLUMNAS[modulo].map(([k]) => (k === 'persona' ? nombrePersona(f.persona_id) : f[k]))].some((v) => String(v ?? '').toLowerCase().includes(q))))
  const anotados = useMemo(() => anotarEventos(eventos), [eventos])
  const histo = anotados.filter((e) => (!filtroH.modulo || e.tabla === filtroH.modulo) && (!filtroH.campo || e.campo === filtroH.campo) && (!filtroH.quien || e.corregido_por === filtroH.quien) && (!filtroH.estado || e.estado === filtroH.estado)
    && (!filtroH.buscar || `${e.referencia} ${e.motivo}`.toLowerCase().includes(filtroH.buscar.toLowerCase()))).sort((a, b) => b.id - a.id)
  const resumen = TABLAS.map((t) => ({ t, vigentes: anotados.filter((e) => e.tabla === t && e.estado === 'vigente').length }))
  const eventosDelRegistro = filaSel ? anotados.filter((e) => e.tabla === modulo && e.registro_id === filaSel.id).sort((a, b) => b.id - a.id) : []

  if (error && !inicial) return <p className="error">Error: {error}</p>
  if (!inicial) return <p>Cargando correcciones…</p>

  const celda = (f, k) => {
    if (k === 'persona') return nombrePersona(f.persona_id)
    const v = f[k]
    const txt = v === null || v === undefined ? '' : CATALOGO[modulo].campos[k] ? formatearValor(modulo, k, v) : String(v)
    return estaCorregido(f, k) ? <span className="corregido" title={`Original: ${formatearValor(modulo, k, valorOriginal(f, k))}`}>{txt} ✎</span> : txt
  }

  return (
    <>
      <h2>Correcciones de datos importados</h2>
      <div className="aviso-box">
        <strong>El dato original nunca se sobrescribe.</strong> Cada corrección se guarda aparte, con su motivo, quién la hizo y cuándo (los pone la base de datos), y se puede <strong>revertir al original</strong>.
        Todas las pantallas (Pagos, Gastos, Pagos del equipo, Estado de resultados, Tablero y, aunque hoy estén ocultas del menú, Cuentas y Conciliación) leen los <strong>valores vigentes</strong>: una corrección se ve en todas las pantallas.
      </div>
      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      <div className="tarjetas">
        {resumen.map((r) => <div key={r.t}><span>{CATALOGO[r.t].nombre}</span><strong>{r.vigentes}</strong><small>{r.vigentes === 1 ? 'campo con corrección vigente' : 'campos con corrección vigente'}</small></div>)}
        <div><span>Eventos en el historial</span><strong>{eventos.length}</strong><small>solo se agregan, nunca se editan</small></div>
      </div>

      <nav className="subtabs">
        <button type="button" onClick={() => setVista('corregir')} disabled={vista === 'corregir'}>Corregir un dato</button>
        <button type="button" onClick={() => setVista('historial')} disabled={vista === 'historial'}>Historial ({eventos.length})</button>
      </nav>

      {vista === 'corregir' && (
        <>
          <div className="filtros">
            <strong>Módulo:</strong>
            {TABLAS.map((t) => <button key={t} type="button" disabled={modulo === t} onClick={() => setModulo(t)}>{CATALOGO[t].nombre}</button>)}
            <input type="search" aria-label="Buscar registros para corregir" placeholder="Buscar (cliente, descripción, monto, fecha…)" value={buscar} onChange={(e) => { setBuscar(e.target.value); setLimite(100) }} />
            <label className="check"><input type="checkbox" checked={soloCorregidos} onChange={(e) => setSoloCorregidos(e.target.checked)} /> Solo con correcciones</label>
          </div>

          {filaSel && (
            <section className="detalle">
              <div className="detalle-cab"><h3>Corregir dato — {referencia(filaSel)}</h3><button type="button" onClick={() => { setSel(null); setCampo(''); setTexto(''); setMotivo('') }}>Cerrar</button></div>
              <p className="aviso">Registro #{filaSel.id} · importado ({filaSel.id_origen}). Los datos originales están a la vista y bloqueados 🔒: la corrección es un registro aparte.</p>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>Campo</th><th>Original 🔒</th><th>Vigente</th><th></th></tr></thead>
                  <tbody>
                    {camposDelModulo.map((c) => (
                      <tr key={c} className={c === campo ? 'fila-abierta' : ''}>
                        <td>{CATALOGO[modulo].campos[c].label}</td>
                        <td>{formatearValor(modulo, c, valorOriginal(filaSel, c))}</td>
                        <td>{estaCorregido(filaSel, c) ? <strong>{formatearValor(modulo, c, filaSel[c])} ✎</strong> : <span className="aviso">igual al original</span>}</td>
                        <td className="nowrap">
                          <button type="button" onClick={() => { setCampo(c); setTexto(''); setMotivo(''); setMensaje(''); setError('') }}>Corregir este campo</button>{' '}
                          {estaCorregido(filaSel, c) && <button type="button" onClick={() => revertir(modulo, filaSel.id, c, referencia(filaSel))}>Revertir al original</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {def && (
                <form onSubmit={guardar} className="form" style={{ marginTop: 14 }}>
                  <h4 style={{ gridColumn: '1 / -1', margin: 0 }}>Corregir "{def.label}"</h4>
                  <label>Original (🔒)<span className="bloqueado">{formatearValor(modulo, campo, valorOriginal(filaSel, campo))}</span></label>
                  <label>Vigente ahora<span className="bloqueado">{formatearValor(modulo, campo, filaSel[campo])}</span></label>
                  <label>Valor corregido
                    {def.tipo === 'vocab' && vocabCampo.length > 0 ? (
                      <select value={texto} onChange={(e) => setTexto(e.target.value)} required><option value="">Elegir…</option>{vocabCampo.map((v) => <option key={v}>{v}</option>)}</select>
                    ) : def.tipo === 'fecha' ? <input type="date" value={texto} onChange={(e) => setTexto(e.target.value)} required />
                    : def.tipo === 'mes' ? <input type="month" value={texto} onChange={(e) => setTexto(e.target.value)} required />
                    : def.tipo === 'numero' ? <input type="number" step="0.01" value={texto} onChange={(e) => setTexto(e.target.value)} required />
                    : <><input value={texto} onChange={(e) => setTexto(e.target.value)} list="dl-correccion" required /><datalist id="dl-correccion">{sugerencias.map((s) => <option key={s} value={s} />)}</datalist></>}
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>Motivo (obligatorio, mínimo 5 caracteres)
                    <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se corrige (queda en el historial)" required />
                  </label>
                  {ofreceTotal && (
                    <label className="check" style={{ gridColumn: '1 / -1' }}>
                      <input type="checkbox" checked={tambienTotal} onChange={(e) => setTambienTotal(e.target.checked)} /> Corregir también el total de la línea a {fmt(impacto.totalSugerido)} (honorarios + bonus + comisión), con el mismo motivo
                    </label>
                  )}

                  {avisosConc.map((a, i) => (
                    <div key={i} className="aviso-box" style={{ gridColumn: '1 / -1' }}>⚠ <strong>Registro conciliado.</strong> {a.texto}<div className="aviso">{a.detalle.join(' · ')}</div></div>
                  ))}

                  {impacto && (
                    <div className="impacto" style={{ gridColumn: '1 / -1' }}>
                      <strong>Vista previa del impacto</strong> <span className="aviso">(cómo cambiarían los totales si se aplica esta corrección)</span>
                      <table>
                        <tbody>
                          {impacto.lineas.map((l, i) => (
                            <tr key={i}>
                              <td>{l.texto}</td>
                              <td>{l.antes !== undefined ? l.antes : ''}</td>
                              <td>{l.antes !== undefined ? '→' : ''}</td>
                              <td><strong>{l.despues !== undefined ? l.despues : ''}</strong></td>
                              <td className={l.delta < 0 ? 'neg' : l.delta > 0 ? 'pos' : ''}>{l.delta !== null && l.delta !== undefined && l.delta !== 0 ? `(${l.delta > 0 ? '+' : '−'}${fmt(Math.abs(l.delta)).replace('−', '')})` : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {impacto.avisos.filter((a) => !(ofreceTotal && tambienTotal && a.includes('inconsistente'))).map((a, i) => <div key={i} className="aviso-box">ℹ {a}</div>)}
                    </div>
                  )}
                  {errores.length > 0 && texto !== '' && <div className="error" style={{ gridColumn: '1 / -1' }}>{errores.join(' ')}</div>}
                  <p className="aviso" style={{ gridColumn: '1 / -1' }}>Quién corrige y cuándo los registra la base de datos (tu sesión y la hora del servidor).</p>
                  <div className="acciones" style={{ gridColumn: '1 / -1' }}>
                    <button type="submit" disabled={errores.length > 0}>Guardar corrección</button>
                    <button type="button" onClick={() => { setCampo(''); setTexto(''); setMotivo('') }}>Cancelar</button>
                  </div>
                </form>
              )}

              <h4>Historial de este registro ({eventosDelRegistro.length})</h4>
              {eventosDelRegistro.length === 0 ? <p className="aviso">Este registro todavía no tiene correcciones.</p> : (
                <div className="tabla-scroll">
                  <table>
                    <thead><tr><th>Cuándo</th><th>Quién</th><th>Campo</th><th>Original → anterior → nuevo</th><th>Motivo</th><th>Estado</th></tr></thead>
                    <tbody>
                      {eventosDelRegistro.map((e) => (
                        <tr key={e.id}>
                          <td className="nowrap">{cuando(e.corregido_en)}</td><td>{e.corregido_por}</td><td>{CATALOGO[e.tabla].campos[e.campo]?.label ?? e.campo}</td>
                          <td>{formatearValor(e.tabla, e.campo, e.valor_original)} → {formatearValor(e.tabla, e.campo, e.valor_anterior)} → <strong>{formatearValor(e.tabla, e.campo, e.valor_nuevo)}</strong></td>
                          <td className="nota">{e.motivo}</td><td><span className={`et ${ETIQUETA_ESTADO[e.estado]?.[1]}`}>{ETIQUETA_ESTADO[e.estado]?.[0]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <p><strong>{visibles.length}</strong> de {filas.length} registros importados {cargandoFilas && '(cargando…)'}</p>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>#</th>{COLUMNAS[modulo].map(([k, l]) => <th key={k}>{l}</th>)}<th title="Campos corregidos" aria-label="Campos corregidos">✎</th><th></th></tr></thead>
              <tbody>
                {visibles.slice(0, limite).map((f) => (
                  <tr key={f.id} className={f.id === sel?.id ? 'fila-abierta' : ''}>
                    <td>{f.id}</td>
                    {COLUMNAS[modulo].map(([k]) => <td key={k}>{celda(f, k)}</td>)}
                    <td>{camposCorregidos(f).length || ''}</td>
                    <td className="nowrap"><button type="button" onClick={() => { setSel({ id: f.id }); setCampo(''); setTexto(''); setMotivo(''); setMensaje(''); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Corregir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibles.length > limite && <p><button type="button" onClick={() => setLimite(limite + 200)}>Mostrar más ({visibles.length - limite} restantes)</button></p>}
        </>
      )}

      {vista === 'historial' && (
        <>
          <div className="filtros">
            <select aria-label="Filtrar por pantalla" value={filtroH.modulo} onChange={(e) => setFiltroH({ ...filtroH, modulo: e.target.value })}><option value="">Todos los módulos</option>{TABLAS.map((t) => <option key={t} value={t}>{CATALOGO[t].nombre}</option>)}</select>
            <select aria-label="Filtrar por campo" value={filtroH.campo} onChange={(e) => setFiltroH({ ...filtroH, campo: e.target.value })}><option value="">Todos los campos</option>{[...new Set(eventos.map((e) => e.campo))].sort().map((c) => <option key={c}>{c}</option>)}</select>
            <select aria-label="Filtrar por persona" value={filtroH.quien} onChange={(e) => setFiltroH({ ...filtroH, quien: e.target.value })}><option value="">Todas las personas</option>{[...new Set(eventos.map((e) => e.corregido_por))].sort().map((c) => <option key={c}>{c}</option>)}</select>
            <select aria-label="Filtrar por estado" value={filtroH.estado} onChange={(e) => setFiltroH({ ...filtroH, estado: e.target.value })}><option value="">Todos los estados</option><option value="vigente">Vigentes</option><option value="reemplazada">Reemplazadas</option><option value="revertida">Revertidas</option><option value="reversion">Reversiones</option></select>
            <input type="search" aria-label="Buscar en el historial" placeholder="Buscar en registro o motivo" value={filtroH.buscar} onChange={(e) => setFiltroH({ ...filtroH, buscar: e.target.value })} />
          </div>
          {histo.length === 0 ? <p className="aviso">No hay correcciones registradas con esos filtros.</p> : (
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>Cuándo</th><th>Quién</th><th>Módulo</th><th>Registro</th><th>Campo</th><th>Original</th><th>Anterior</th><th>Nuevo</th><th>Motivo</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {histo.map((e) => (
                    <tr key={e.id} className={e.estado === 'vigente' ? '' : 'fila-gris'}>
                      <td className="nowrap">{cuando(e.corregido_en)}</td><td>{e.corregido_por}</td><td>{CATALOGO[e.tabla].nombre}</td><td className="nota">{e.referencia}</td>
                      <td>{CATALOGO[e.tabla].campos[e.campo]?.label ?? e.campo}</td>
                      <td>{formatearValor(e.tabla, e.campo, e.valor_original)}</td><td>{formatearValor(e.tabla, e.campo, e.valor_anterior)}</td><td><strong>{formatearValor(e.tabla, e.campo, e.valor_nuevo)}</strong></td>
                      <td className="nota">{e.motivo}</td><td><span className={`et ${ETIQUETA_ESTADO[e.estado]?.[1]}`}>{ETIQUETA_ESTADO[e.estado]?.[0]}</span></td>
                      <td>{e.estado === 'vigente' && <button type="button" onClick={() => revertir(e.tabla, e.registro_id, e.campo, e.referencia)}>Revertir al original</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

/** Traduce errores de la base a mensajes claros (la base es la autoridad de las validaciones). */
function traducir(msg) {
  if (/permission denied/i.test(msg)) return 'No tenés permiso para registrar la corrección (¿sesión vencida?).'
  return msg
}
