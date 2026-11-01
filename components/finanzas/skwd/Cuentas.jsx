import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

// Reglas de esta pantalla:
// - Los totales EMPRESARIALES salen SOLO de la vista movimientos_cuenta_empresa (nunca de la tabla directa).
// - En movimientos importados (con id_origen) fecha, descripción, monto, tipo y de quién/para quién están bloqueados:
//   se corrigen SOLO desde la pestaña Correcciones (botón "Corregir"); el original se conserva.
// - La lista general lee la vista movimientos_cuenta_vigentes (valores con las correcciones aplicadas).
// - Los importados no se pueden borrar. Solo se borran los cargados desde la web.

const TIPOS = ['Ingreso empresa', 'Gasto empresa', 'Inversión empresa', 'Gasto personal compartido', 'Gasto personal', 'Transferencia de dinero']
const QUIEN = ['Ambos', 'De gero para tomi', 'De Gero Hacien la Empresa (ambos)']
const MESES_2026 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`)
const hoy = () => new Date().toISOString().slice(0, 10)
const fmt = (n) => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const mesDe = (fecha) => fecha.slice(0, 7) + '-01'
const suma = (arr, f = () => true) => arr.filter(f).reduce((s, m) => s + Number(m.monto), 0)
const filtrosVacios = { cuenta: '', periodo: '', tipo: '', buscar: '', personales: true, resumenes: true }

const esImportado = (m) => m.id_origen !== null && m.id_origen !== undefined
const estaCorregido = (m, k) => !!m.correcciones && Object.prototype.hasOwnProperty.call(m.correcciones, k)
const verOriginal = (m, k) => {
  const v = m.valores_originales?.[k]
  return v === null || v === undefined || v === '' ? '(vacío)' : k === 'monto' ? fmt(v) : String(v)
}
// Muestra el valor vigente; si está corregido lleva ✎ y el original al pasar el mouse
function Celda({ m, k, children }) {
  if (!estaCorregido(m, k)) return <>{children}</>
  return <span className="corregido" title={`Original: ${verOriginal(m, k)}`}>{children} ✎</span>
}

function Etiquetas({ m }) {
  return (
    <>
      {m.revisar && <span className="et et-revisar">⚑ REVISAR</span>}
      {m.es_personal && <span className="et et-gris">PERSONAL</span>}
      {m.es_resumen && <span className="et et-gris">RESUMEN</span>}
      {m.sin_periodo && <span className="et et-naranja">SIN PERÍODO</span>}
      {m.tipo === 'Transferencia de dinero' && <span className="et et-gris">TRANSFERENCIA</span>}
      {!m.id_origen && <span className="et et-azul">WEB</span>}
    </>
  )
}

function Monto({ valor }) {
  return <span className={Number(valor) < 0 ? 'neg' : 'pos'}>{fmt(valor)}</span>
}

export default function Cuentas({ onCorregir }) {
  const [vista, setVista] = useState('movimientos')
  const [cuentas, setCuentas] = useState([])
  const [lista, setLista] = useState([]) // vista movimientos_cuenta_vigentes (todos, con correcciones aplicadas)
  const [empresa, setEmpresa] = useState([]) // vista movimientos_cuenta_empresa (para totales empresariales)
  const [filtros, setFiltros] = useState(filtrosVacios)
  const [panel, setPanel] = useState(null) // { modo: 'nuevo' } | { modo: 'ver', id }
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function cargar() {
    const [c, l, e] = await Promise.all([
      supabase.from('cuentas').select('*').order('id'),
      supabase.from('movimientos_cuenta_vigentes').select('*').order('id').limit(5000),
      supabase.from('movimientos_cuenta_empresa').select('*').order('id').limit(5000),
    ])
    const err = c.error || l.error || e.error
    if (err) setError(err.message)
    else {
      setCuentas(c.data)
      setLista(l.data)
      setEmpresa(e.data)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const nombreCuenta = (id) => cuentas.find((c) => c.id === id)?.nombre ?? '—'

  async function actualizar(id, cambios, texto) {
    setError('')
    setMensaje('')
    const { error } = await supabase.from('movimientos_cuenta').update(cambios).eq('id', id)
    if (error) {
      setError(error.message)
      return false
    }
    setMensaje(texto || 'Guardado.')
    await cargar()
    return true
  }

  const periodosExistentes = useMemo(() => [...new Set(lista.map((m) => m.periodo).filter(Boolean))].sort().reverse(), [lista])
  const opcionesPeriodo = useMemo(() => [...new Set([...MESES_2026, ...periodosExistentes])].sort(), [periodosExistentes])

  const q = filtros.buscar.trim().toLowerCase()
  const pasa = (m) =>
    (!filtros.cuenta || m.cuenta_id === Number(filtros.cuenta)) &&
    (!filtros.periodo || (filtros.periodo === 'sin' ? m.periodo === null : m.periodo === filtros.periodo)) &&
    (!filtros.tipo || m.tipo === filtros.tipo) &&
    (!q || (m.descripcion || '').toLowerCase().includes(q))

  // Orden: período más reciente primero; sin período al final; luego fecha
  const ordenar = (a, b) => (b.periodo || '').localeCompare(a.periodo || '') || (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id

  const visibles = useMemo(
    () => lista.filter((m) => pasa(m) && (filtros.personales || !m.es_personal) && (filtros.resumenes || !m.es_resumen)).sort(ordenar),
    [lista, filtros] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const empFiltrada = useMemo(() => empresa.filter(pasa), [empresa, filtros]) // eslint-disable-line react-hooks/exhaustive-deps
  const listaFiltrada = useMemo(() => lista.filter(pasa), [lista, filtros]) // eslint-disable-line react-hooks/exhaustive-deps

  const tot = {
    ingresos: suma(empFiltrada, (m) => m.tipo === 'Ingreso empresa'),
    gastos: suma(empFiltrada, (m) => m.tipo === 'Gasto empresa'),
    inversion: suma(empFiltrada, (m) => m.tipo === 'Inversión empresa'),
    transferencias: suma(empFiltrada, (m) => m.tipo === 'Transferencia de dinero'),
    nTransf: empFiltrada.filter((m) => m.tipo === 'Transferencia de dinero').length,
    personales: suma(listaFiltrada, (m) => m.es_personal),
    nPersonales: listaFiltrada.filter((m) => m.es_personal).length,
    resumenes: suma(listaFiltrada, (m) => m.es_resumen),
    nResumenes: listaFiltrada.filter((m) => m.es_resumen).length,
    ambos: listaFiltrada.filter((m) => m.es_personal && m.es_resumen).length,
  }
  tot.neto = tot.ingresos + tot.gastos + tot.inversion // las transferencias NO entran al neto

  const sinPeriodo = lista.filter((m) => m.sin_periodo)
  const sinFecha = lista.filter((m) => m.sin_fecha)
  const aRevisar = lista.filter((m) => m.revisar)

  const cambiarFiltro = (e) => {
    const { name, value, type, checked } = e.target
    setFiltros({ ...filtros, [name]: type === 'checkbox' ? checked : value })
  }

  const abierto = panel?.modo === 'ver' ? lista.find((m) => m.id === panel.id) : null

  return (
    <>
      <div className="cabecera">
        <h2>Cuentas</h2>
        <button type="button" onClick={() => { setPanel({ modo: 'nuevo' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>+ Nuevo movimiento</button>
      </div>
      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      {panel?.modo === 'nuevo' && (
        <FormularioMovimiento cuentas={cuentas} onCancelar={() => setPanel(null)} onGuardado={async (t) => { setPanel(null); setMensaje(t); await cargar() }} onError={setError} />
      )}
      {abierto && (
        <PanelMovimiento
          m={abierto}
          cuentas={cuentas}
          opcionesPeriodo={opcionesPeriodo}
          nombreCuenta={nombreCuenta}
          onCerrar={() => setPanel(null)}
          onCorregir={onCorregir}
          onGuardar={actualizar}
          onBorrado={async () => { setPanel(null); setMensaje('Movimiento borrado.'); await cargar() }}
          onError={setError}
        />
      )}

      <nav className="subtabs">
        {[
          ['movimientos', `Movimientos (${lista.length})`],
          ['completar', `Por completar (${sinPeriodo.length})`],
          ['revisar', `Revisar (${aRevisar.length})`],
          ['resumen', 'Resumen'],
        ].map(([id, nombre]) => (
          <button key={id} type="button" onClick={() => setVista(id)} disabled={vista === id}>{nombre}</button>
        ))}
      </nav>

      {vista === 'movimientos' && (
        <>
          <div className="filtros">
            <select name="cuenta" value={filtros.cuenta} onChange={cambiarFiltro}>
              <option value="">Todas las cuentas</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select name="periodo" value={filtros.periodo} onChange={cambiarFiltro}>
              <option value="">Todos los períodos</option>
              <option value="sin">Sin período</option>
              {periodosExistentes.map((p) => <option key={p} value={p}>{p.slice(0, 7)}</option>)}
            </select>
            <select name="tipo" value={filtros.tipo} onChange={cambiarFiltro}>
              <option value="">Todos los tipos</option>
              {TIPOS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <input name="buscar" placeholder="Buscar descripción" value={filtros.buscar} onChange={cambiarFiltro} />
            <label className="check"><input type="checkbox" name="personales" checked={filtros.personales} onChange={cambiarFiltro} /> Mostrar personales</label>
            <label className="check"><input type="checkbox" name="resumenes" checked={filtros.resumenes} onChange={cambiarFiltro} /> Mostrar resúmenes</label>
            <button type="button" onClick={() => setFiltros(filtrosVacios)}>Limpiar</button>
          </div>

          <h3 className="titulo-bloque">Totales empresariales <span className="aviso">(según filtros; solo movimientos de empresa, sin personales ni resúmenes ni transferencias)</span></h3>
          <div className="resumen-principal">
            <div><span>Ingresos</span><strong className="pos">{fmt(tot.ingresos)}</strong></div>
            <div><span>Gastos</span><strong className="neg">{fmt(tot.gastos)}</strong></div>
            <div><span>Inversión</span><strong className="neg">{fmt(tot.inversion)}</strong></div>
            <div><span>Neto empresarial</span><strong>{fmt(tot.neto)}</strong></div>
          </div>
          <div className="aparte">
            <strong>Aparte — NO se suman al neto de la empresa:</strong>
            <span>Personales: {fmt(tot.personales)} ({tot.nPersonales})</span>
            <span>Resúmenes: {fmt(tot.resumenes)} ({tot.nResumenes})</span>
            <span>Transferencias entre cuentas: {fmt(tot.transferencias)} ({tot.nTransf})</span>
            {tot.ambos > 0 && <span className="aviso">({tot.ambos} movimiento(s) son personales y resúmenes a la vez)</span>}
          </div>

          <p><strong>{visibles.length}</strong> de {lista.length} movimientos</p>
          <TablaMovimientos filas={visibles} nombreCuenta={nombreCuenta} onCorregir={onCorregir} onAbrir={(m) => { setPanel({ modo: 'ver', id: m.id }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
        </>
      )}

      {vista === 'completar' && (
        <PorCompletar sinPeriodo={sinPeriodo} sinFecha={sinFecha} empresa={empresa} nombreCuenta={nombreCuenta} opcionesPeriodo={opcionesPeriodo} onGuardar={actualizar} onAbrir={(m) => setPanel({ modo: 'ver', id: m.id })} />
      )}

      {vista === 'revisar' && (
        <Revisar lista={lista} nombreCuenta={nombreCuenta} onGuardar={actualizar} onAbrir={(m) => { setPanel({ modo: 'ver', id: m.id }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
      )}

      {vista === 'resumen' && <Resumen cuentas={cuentas} lista={lista} empresa={empresa} />}
    </>
  )
}

function TablaMovimientos({ filas, nombreCuenta, onAbrir, onCorregir }) {
  return (
    <div className="tabla-scroll">
      <table>
        <thead>
          <tr><th>Fecha</th><th>Período</th><th>Cuenta</th><th>Descripción</th><th>Monto</th><th>Tipo</th><th>De quién / para quién</th><th>Nota</th><th>Etiquetas</th><th></th></tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr key={m.id} className={(m.revisar ? 'fila-revisar ' : '') + (m.es_personal || m.es_resumen ? 'fila-gris' : '')}>
              <td className="nowrap"><Celda m={m} k="fecha">{m.fecha ?? <em>{m.fecha_original ?? '(sin fecha)'}</em>}</Celda></td>
              <td className="nowrap">{m.periodo ? m.periodo.slice(0, 7) : <em>sin período</em>}</td>
              <td>{nombreCuenta(m.cuenta_id)}</td>
              <td><Celda m={m} k="descripcion">{m.descripcion}</Celda></td>
              <td className="nowrap"><Celda m={m} k="monto"><Monto valor={m.monto} /></Celda></td>
              <td><Celda m={m} k="tipo">{m.tipo}</Celda></td>
              <td><Celda m={m} k="de_quien_para_quien">{m.de_quien_para_quien}</Celda></td>
              <td>{m.nota}</td>
              <td><Etiquetas m={m} /></td>
              <td className="nowrap">
                <button type="button" onClick={() => onAbrir(m)}>Abrir</button>
                {esImportado(m) && <>{' '}<button type="button" onClick={() => onCorregir && onCorregir({ tabla: 'movimientos_cuenta', id: m.id })}>Corregir</button></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PanelMovimiento({ m, cuentas, opcionesPeriodo, nombreCuenta, onCerrar, onCorregir, onGuardar, onBorrado, onError }) {
  const importado = esImportado(m)
  const periodoEditable = !importado || m.periodo_fuente !== 'fecha'
  const fechaEditable = !importado || m.fecha === null
  const [f, setF] = useState({
    cuenta_id: String(m.cuenta_id), periodo: m.periodo ?? '', fecha: m.fecha ?? '', nota: m.nota ?? '', revisar: m.revisar, nota_revision: m.nota_revision ?? '',
    descripcion: m.descripcion, monto: String(m.monto), tipo: m.tipo, de_quien_para_quien: m.de_quien_para_quien ?? '',
  })
  useEffect(() => {
    setF({
      cuenta_id: String(m.cuenta_id), periodo: m.periodo ?? '', fecha: m.fecha ?? '', nota: m.nota ?? '', revisar: m.revisar, nota_revision: m.nota_revision ?? '',
      descripcion: m.descripcion, monto: String(m.monto), tipo: m.tipo, de_quien_para_quien: m.de_quien_para_quien ?? '',
    })
  }, [m.id, m.periodo, m.fecha, m.revisar])

  const cambiar = (e) => setF({ ...f, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const vacio = (v) => (v.trim() === '' ? null : v.trim())

  async function guardar(e) {
    e.preventDefault()
    const cambios = { cuenta_id: Number(f.cuenta_id), nota: vacio(f.nota), revisar: f.revisar, nota_revision: vacio(f.nota_revision) }
    if (importado) {
      if (periodoEditable && (f.periodo || null) !== m.periodo) {
        cambios.periodo = f.periodo || null
        cambios.periodo_fuente = f.periodo ? 'manual' : 'pendiente'
      }
      if (fechaEditable && f.fecha) {
        cambios.fecha = f.fecha
        if (!(cambios.periodo ?? m.periodo)) { cambios.periodo = mesDe(f.fecha); cambios.periodo_fuente = 'fecha' }
      }
    } else {
      const monto = Number(f.monto)
      const err = validarSigno(f.tipo, monto)
      if (err) return onError(err)
      Object.assign(cambios, { fecha: f.fecha, periodo: mesDe(f.fecha), periodo_fuente: 'fecha', descripcion: f.descripcion.trim(), monto, tipo: f.tipo, de_quien_para_quien: vacio(f.de_quien_para_quien) })
    }
    onError('')
    await onGuardar(m.id, cambios, 'Movimiento actualizado.')
  }

  async function borrar() {
    if (importado) return
    if (!window.confirm(`¿Borrar el movimiento "${m.descripcion}"? Solo se pueden borrar los cargados desde la web.`)) return
    const { error } = await supabase.from('movimientos_cuenta').delete().eq('id', m.id)
    if (error) onError(error.message)
    else onBorrado()
  }

  const bloqueado = (valor, k) => <span className="bloqueado">🔒 {k ? <Celda m={m} k={k}>{valor ?? '—'}</Celda> : (valor ?? '—')}</span>

  return (
    <section className="detalle">
      <div className="detalle-cab">
        <h2>Movimiento #{m.id} {importado ? <span className="aviso">(importado del Excel)</span> : <span className="aviso">(cargado en la web)</span>}</h2>
        <button type="button" onClick={onCerrar}>Cerrar</button>
      </div>
      <p><Etiquetas m={m} /></p>
      {m.revisar && m.nota_revision && <p className="aviso-box">⚑ Motivo de la revisión: {m.nota_revision}</p>}

      <form onSubmit={guardar} className="form">
        <label>Cuenta
          <select name="cuenta_id" value={f.cuenta_id} onChange={cambiar}>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Fecha
          {fechaEditable ? <input type="date" name="fecha" value={f.fecha} onChange={cambiar} required={!importado} /> : bloqueado(m.fecha, 'fecha')}
        </label>
        <label>Período
          {periodoEditable ? (
            <select name="periodo" value={f.periodo} onChange={cambiar} disabled={!importado}>
              {importado && <option value="">(sin período)</option>}
              {opcionesPeriodo.map((p) => <option key={p} value={p}>{p.slice(0, 7)}</option>)}
            </select>
          ) : bloqueado(`${m.periodo?.slice(0, 7)} (viene de la fecha)`)}
        </label>
        <label>Descripción
          {importado ? bloqueado(m.descripcion, 'descripcion') : <input name="descripcion" value={f.descripcion} onChange={cambiar} required />}
        </label>
        <label>Monto (USD)
          {importado ? bloqueado(fmt(m.monto), 'monto') : <input name="monto" type="number" step="0.01" value={f.monto} onChange={cambiar} required />}
        </label>
        <label>Tipo
          {importado ? bloqueado(m.tipo, 'tipo') : <select name="tipo" value={f.tipo} onChange={cambiar}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select>}
        </label>
        <label>De quién / para quién
          {importado ? bloqueado(m.de_quien_para_quien, 'de_quien_para_quien') : (
            <>
              <input name="de_quien_para_quien" value={f.de_quien_para_quien} onChange={cambiar} list="dl-quien" />
              <datalist id="dl-quien">{QUIEN.map((q) => <option key={q} value={q} />)}</datalist>
            </>
          )}
        </label>
        <label>Nota
          <input name="nota" value={f.nota} onChange={cambiar} />
        </label>
        <label className="check"><input type="checkbox" name="revisar" checked={f.revisar} onChange={cambiar} /> Marcar para revisar</label>
        <label>Nota de revisión
          <input name="nota_revision" value={f.nota_revision} onChange={cambiar} />
        </label>
        <div className="acciones">
          <button type="submit">Guardar cambios</button>
          {importado
            ? <button type="button" onClick={() => onCorregir && onCorregir({ tabla: 'movimientos_cuenta', id: m.id })}>Corregir datos del movimiento</button>
            : <button type="button" onClick={borrar}>Borrar</button>}
        </div>
      </form>

      <h3>Datos originales <span className="aviso">(no se pueden modificar)</span></h3>
      <ul className="datos">
        {['fecha', 'descripcion', 'monto', 'tipo', 'de_quien_para_quien'].filter((k) => estaCorregido(m, k)).map((k) => (
          <li key={k}><strong>Original de {k.replace(/_/g, ' ')}:</strong> {verOriginal(m, k)} <span className="aviso">(corregido ✎)</span></li>
        ))}
        <li><strong>Pestaña de origen:</strong> {m.hoja_origen ?? '—'}</li>
        <li><strong>Texto original de la fecha:</strong> {m.fecha_original ?? '—'}</li>
        <li><strong>Cómo se asignó el período:</strong> {m.periodo_fuente}</li>
        <li><strong>Identificador de origen:</strong> {m.id_origen ?? '—'}</li>
        <li><strong>Cuenta actual:</strong> {nombreCuenta(m.cuenta_id)}</li>
      </ul>
    </section>
  )
}

function validarSigno(tipo, monto) {
  if (!Number.isFinite(monto) || monto === 0) return 'El monto no puede ser 0 ni estar vacío.'
  if (tipo === 'Ingreso empresa' && monto < 0) return 'Un ingreso debe tener monto positivo.'
  if (['Gasto empresa', 'Inversión empresa', 'Gasto personal compartido', 'Gasto personal'].includes(tipo) && monto > 0) return 'Un gasto o inversión debe tener monto negativo (sale dinero).'
  return ''
}

function FormularioMovimiento({ cuentas, onCancelar, onGuardado, onError }) {
  const [f, setF] = useState({ cuenta_id: cuentas[0] ? String(cuentas[0].id) : '', fecha: hoy(), descripcion: '', monto: '', tipo: 'Ingreso empresa', de_quien_para_quien: 'Ambos', nota: '' })
  const cambiar = (e) => setF({ ...f, [e.target.name]: e.target.value })
  async function guardar(e) {
    e.preventDefault()
    const monto = Number(f.monto)
    const err = validarSigno(f.tipo, monto)
    if (err) return onError(err)
    onError('')
    const { error } = await supabase.from('movimientos_cuenta').insert({
      cuenta_id: Number(f.cuenta_id), fecha: f.fecha, periodo: mesDe(f.fecha), periodo_fuente: 'fecha', descripcion: f.descripcion.trim(), monto, tipo: f.tipo,
      de_quien_para_quien: f.de_quien_para_quien.trim() || null, nota: f.nota.trim() || null, es_resumen: false, hoja_origen: 'Cargado en la web',
    })
    if (error) onError(error.message)
    else onGuardado('Movimiento guardado.')
  }
  return (
    <section className="detalle">
      <div className="detalle-cab"><h2>Nuevo movimiento</h2><button type="button" onClick={onCancelar}>Cancelar</button></div>
      <p className="aviso">Monto con signo: <strong>positivo</strong> si entra dinero, <strong>negativo</strong> si sale. Queda registrado como "Cargado en la web".</p>
      <form onSubmit={guardar} className="form">
        <label>Cuenta<select name="cuenta_id" value={f.cuenta_id} onChange={cambiar}>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label>Fecha<input type="date" name="fecha" value={f.fecha} onChange={cambiar} required /></label>
        <label>Descripción<input name="descripcion" value={f.descripcion} onChange={cambiar} required /></label>
        <label>Monto (USD)<input name="monto" type="number" step="0.01" value={f.monto} onChange={cambiar} required /></label>
        <label>Tipo<select name="tipo" value={f.tipo} onChange={cambiar}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>De quién / para quién
          <input name="de_quien_para_quien" value={f.de_quien_para_quien} onChange={cambiar} list="dl-quien-nuevo" />
          <datalist id="dl-quien-nuevo">{QUIEN.map((q) => <option key={q} value={q} />)}</datalist>
        </label>
        <label>Nota<input name="nota" value={f.nota} onChange={cambiar} /></label>
        <div className="acciones"><button type="submit">Guardar movimiento</button></div>
      </form>
    </section>
  )
}

function PorCompletar({ sinPeriodo, sinFecha, empresa, nombreCuenta, opcionesPeriodo, onGuardar, onAbrir }) {
  const [modo, setModo] = useState('periodo')
  const [elegido, setElegido] = useState({}) // id -> mes elegido en la fila
  const [fechas, setFechas] = useState({})
  const [marcados, setMarcados] = useState(new Set())
  const [mesLote, setMesLote] = useState('')

  const filas = modo === 'periodo' ? sinPeriodo : sinFecha
  const idsEmpresa = new Set(empresa.map((m) => m.id))
  const pendEmpresa = sinPeriodo.filter((m) => idsEmpresa.has(m.id))
  const alternar = (id) => { const s = new Set(marcados); s.has(id) ? s.delete(id) : s.add(id); setMarcados(s) }

  async function guardarPeriodo(m, mes) {
    if (!mes) return
    await onGuardar(m.id, { periodo: mes, periodo_fuente: 'manual' }, 'Período asignado.')
  }
  async function aplicarLote() {
    if (!mesLote || marcados.size === 0) return
    for (const id of marcados) await onGuardar(id, { periodo: mesLote, periodo_fuente: 'manual' }, `Período ${mesLote.slice(0, 7)} asignado a ${marcados.size} movimiento(s).`)
    setMarcados(new Set())
  }
  async function guardarFecha(m, fecha) {
    if (!fecha) return
    const cambios = { fecha }
    if (!m.periodo) { cambios.periodo = mesDe(fecha); cambios.periodo_fuente = 'fecha' }
    await onGuardar(m.id, cambios, 'Fecha guardada.')
  }

  return (
    <>
      <div className="aviso-box">
        Sin período: <strong>{sinPeriodo.length}</strong> movimientos ({pendEmpresa.length} empresariales por <strong>{fmt(pendEmpresa.reduce((s, m) => s + Number(m.monto), 0))}</strong>).
        Mientras no tengan mes, <strong>no entran en los totales por mes</strong>.
      </div>
      <nav className="subtabs">
        <button type="button" onClick={() => setModo('periodo')} disabled={modo === 'periodo'}>Sin período ({sinPeriodo.length})</button>
        <button type="button" onClick={() => setModo('fecha')} disabled={modo === 'fecha'}>Sin fecha ({sinFecha.length})</button>
      </nav>

      {modo === 'periodo' && (
        <div className="filtros">
          <strong>Asignar en lote a los tildados ({marcados.size}):</strong>
          <select value={mesLote} onChange={(e) => setMesLote(e.target.value)}>
            <option value="">Elegir mes…</option>
            {opcionesPeriodo.map((p) => <option key={p} value={p}>{p.slice(0, 7)}</option>)}
          </select>
          <button type="button" onClick={aplicarLote} disabled={!mesLote || marcados.size === 0}>Aplicar a tildados</button>
          <button type="button" onClick={() => setMarcados(new Set(sinPeriodo.map((m) => m.id)))}>Tildar todos</button>
          <button type="button" onClick={() => setMarcados(new Set())}>Destildar</button>
        </div>
      )}

      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>{modo === 'periodo' && <th></th>}<th>Cuenta</th><th>Descripción</th><th>Monto</th><th>Tipo</th><th>Pestaña de origen</th><th>{modo === 'periodo' ? 'Asignar mes' : 'Asignar fecha'}</th><th></th></tr>
          </thead>
          <tbody>
            {filas.map((m) => (
              <tr key={m.id} className={m.es_personal || m.es_resumen ? 'fila-gris' : ''}>
                {modo === 'periodo' && <td><input type="checkbox" checked={marcados.has(m.id)} onChange={() => alternar(m.id)} aria-label="Tildar" /></td>}
                <td>{nombreCuenta(m.cuenta_id)}</td>
                <td><Celda m={m} k="descripcion">{m.descripcion}</Celda> <Etiquetas m={m} /></td>
                <td className="nowrap"><Celda m={m} k="monto"><Monto valor={m.monto} /></Celda></td>
                <td><Celda m={m} k="tipo">{m.tipo}</Celda></td>
                <td>{m.hoja_origen}</td>
                <td className="nowrap">
                  {modo === 'periodo' ? (
                    <>
                      <select value={elegido[m.id] ?? ''} onChange={(e) => setElegido({ ...elegido, [m.id]: e.target.value })}>
                        <option value="">Mes…</option>
                        {opcionesPeriodo.map((p) => <option key={p} value={p}>{p.slice(0, 7)}</option>)}
                      </select>{' '}
                      <button type="button" disabled={!elegido[m.id]} onClick={() => guardarPeriodo(m, elegido[m.id])}>Guardar</button>
                    </>
                  ) : (
                    <>
                      <input type="date" value={fechas[m.id] ?? ''} onChange={(e) => setFechas({ ...fechas, [m.id]: e.target.value })} />{' '}
                      <button type="button" disabled={!fechas[m.id]} onClick={() => guardarFecha(m, fechas[m.id])}>Guardar</button>
                    </>
                  )}
                </td>
                <td><button type="button" onClick={() => onAbrir(m)}>Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length === 0 && <p className="ok">No queda nada por completar en esta lista.</p>}
    </>
  )
}

function Revisar({ lista, nombreCuenta, onGuardar, onAbrir }) {
  const [verRevisados, setVerRevisados] = useState(false)
  const pendientes = lista.filter((m) => m.revisar)
  const revisados = lista.filter((m) => !m.revisar && m.nota_revision)
  const filas = verRevisados ? [...pendientes, ...revisados] : pendientes
  return (
    <>
      <p className="aviso">Estos movimientos conservan sus datos originales sin corregir. "Marcar como revisado" solo quita la marca; el motivo queda guardado.</p>
      <label className="check"><input type="checkbox" checked={verRevisados} onChange={(e) => setVerRevisados(e.target.checked)} /> Mostrar también los ya revisados ({revisados.length})</label>
      <div className="tabla-scroll">
        <table>
          <thead><tr><th>Estado</th><th>Fecha</th><th>Cuenta</th><th>Descripción</th><th>Monto</th><th>Tipo</th><th>Pestaña de origen</th><th>Motivo</th><th></th></tr></thead>
          <tbody>
            {filas.map((m) => (
              <tr key={m.id} className={m.revisar ? 'fila-revisar' : ''}>
                <td>{m.revisar ? '⚑ A revisar' : '✓ Revisado'}</td>
                <td className="nowrap"><Celda m={m} k="fecha">{m.fecha ?? <em>{m.fecha_original ?? '(sin fecha)'}</em>}</Celda></td>
                <td>{nombreCuenta(m.cuenta_id)}</td>
                <td><Celda m={m} k="descripcion">{m.descripcion}</Celda></td>
                <td className="nowrap"><Celda m={m} k="monto"><Monto valor={m.monto} /></Celda></td>
                <td><Celda m={m} k="tipo">{m.tipo}</Celda></td>
                <td>{m.hoja_origen}</td>
                <td className="nota">{m.nota_revision}</td>
                <td className="nowrap">
                  {m.revisar
                    ? <button type="button" onClick={() => onGuardar(m.id, { revisar: false }, 'Marcado como revisado.')}>Marcar como revisado</button>
                    : <button type="button" onClick={() => onGuardar(m.id, { revisar: true }, 'Marcado para revisar de nuevo.')}>Volver a marcar</button>}{' '}
                  <button type="button" onClick={() => onAbrir(m)}>Abrir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length === 0 && <p className="ok">No hay movimientos para revisar.</p>}
    </>
  )
}

function Resumen({ cuentas, lista, empresa }) {
  const porCuenta = cuentas.map((c) => {
    const e = empresa.filter((m) => m.cuenta_id === c.id), l = lista.filter((m) => m.cuenta_id === c.id)
    const ing = suma(e, (m) => m.tipo === 'Ingreso empresa'), gas = suma(e, (m) => m.tipo === 'Gasto empresa'), inv = suma(e, (m) => m.tipo === 'Inversión empresa')
    return { c, ing, gas, inv, neto: ing + gas + inv, transf: suma(e, (m) => m.tipo === 'Transferencia de dinero'), pers: suma(l, (m) => m.es_personal), res: suma(l, (m) => m.es_resumen), sinP: l.filter((m) => m.sin_periodo).length, n: l.length }
  })
  const periodos = [...new Set(empresa.map((m) => m.periodo).filter(Boolean))].sort()
  const porMes = periodos.map((p) => {
    const e = empresa.filter((m) => m.periodo === p)
    const ing = suma(e, (m) => m.tipo === 'Ingreso empresa'), gas = suma(e, (m) => m.tipo === 'Gasto empresa'), inv = suma(e, (m) => m.tipo === 'Inversión empresa')
    return { p, ing, gas, inv, neto: ing + gas + inv }
  })
  const sinP = empresa.filter((m) => m.periodo === null)
  const sinPIng = suma(sinP, (m) => m.tipo === 'Ingreso empresa'), sinPGas = suma(sinP, (m) => m.tipo === 'Gasto empresa'), sinPInv = suma(sinP, (m) => m.tipo === 'Inversión empresa')
  const tot = porCuenta.reduce((a, r) => ({ ing: a.ing + r.ing, gas: a.gas + r.gas, inv: a.inv + r.inv, neto: a.neto + r.neto }), { ing: 0, gas: 0, inv: 0, neto: 0 })

  return (
    <>
      <p className="aviso">Los importes empresariales salen solo de la vista de empresa (sin personales, resúmenes ni transferencias en el neto).</p>
      <h3>Por cuenta</h3>
      <div className="tabla-scroll">
        <table>
          <thead><tr><th>Cuenta</th><th>Movimientos</th><th>Ingresos</th><th>Gastos</th><th>Inversión</th><th>Neto empresarial</th><th>Aparte: personales</th><th>Aparte: resúmenes</th><th>Aparte: transferencias</th><th>Sin período</th></tr></thead>
          <tbody>
            {porCuenta.map((r) => (
              <tr key={r.c.id}>
                <td>{r.c.nombre}</td><td>{r.n}</td><td><Monto valor={r.ing} /></td><td><Monto valor={r.gas} /></td><td><Monto valor={r.inv} /></td>
                <td><strong>{fmt(r.neto)}</strong></td><td className="gris">{fmt(r.pers)}</td><td className="gris">{fmt(r.res)}</td><td className="gris">{fmt(r.transf)}</td><td>{r.sinP}</td>
              </tr>
            ))}
            <tr className="fila-total"><td>Total</td><td>{lista.length}</td><td><Monto valor={tot.ing} /></td><td><Monto valor={tot.gas} /></td><td><Monto valor={tot.inv} /></td><td><strong>{fmt(tot.neto)}</strong></td><td colSpan={4}></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Por mes (solo empresarial)</h3>
      <div className="tabla-scroll">
        <table>
          <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Inversión</th><th>Neto empresarial</th></tr></thead>
          <tbody>
            {porMes.map((r) => (
              <tr key={r.p}><td>{r.p.slice(0, 7)}</td><td><Monto valor={r.ing} /></td><td><Monto valor={r.gas} /></td><td><Monto valor={r.inv} /></td><td><strong>{fmt(r.neto)}</strong></td></tr>
            ))}
            {sinP.length > 0 && (
              <tr className="fila-revisar"><td><em>Sin período ({sinP.length})</em></td><td><Monto valor={sinPIng} /></td><td><Monto valor={sinPGas} /></td><td><Monto valor={sinPInv} /></td><td><strong>{fmt(sinPIng + sinPGas + sinPInv)}</strong></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
