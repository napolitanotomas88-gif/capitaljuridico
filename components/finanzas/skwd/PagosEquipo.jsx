import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { OPCIONES_PAGADO_POR, validarLinea, armarLinea, totalDe, tipoRemuneracion, cierreDeMes, mesDe, mesAnterior, motivoBloqueoComision } from './calculoPayroll'
import { calcularComision, nombresSinPersona, REGLAS_COMISION } from './calculoComisiones'

const usd = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const ars = (n) => 'ARS ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const mesActual = () => new Date().toLocaleDateString('en-CA').slice(0, 7)
// comisionEditada / bonusEditado: false = el importe lo propone el cálculo automático; true = lo escribió la persona (manual) y no se pisa
const vacio = (mes = '') => ({ persona_id: '', mes, puesto: '', departamento: '', honorarios_base: '', bonuses: '', comision: '', comisionEditada: false, bonusEditado: false, pagado: false, pagado_por: '', nota: '', confirmaAdicional: false })

// Reglas de esta pantalla:
// - Lee la vista pagos_equipo_vigentes (valores con las correcciones aplicadas). Los datos sensibles NO se leen acá.
// - Las líneas importadas (con id_origen) tienen bloqueados mes, puesto, departamento, honorarios, bonus, comisión, total y moneda:
//   se corrigen SOLO desde la pestaña Correcciones (botón "Corregir"); el original se conserva. No se pueden borrar.
// - Siguen editables los campos de trabajo: pagado, pagado_por y nota (se escriben en la tabla pagos_equipo).
// - Las líneas NUEVAS (creadas acá, sin id_origen) se crean, editan y —solo si están pendientes— se borran en pagos_equipo.
//   Las reglas del alta (validaciones, duplicados, cierre de mes) están en calculoPayroll.js. Nunca se escribe en Gastos.
// - Las personas inactivas no aparecen al cargar líneas nuevas (su historial se conserva).
const esImportado = (l) => l.id_origen !== null && l.id_origen !== undefined
const estaCorregido = (l, k) => !!l.correcciones && Object.prototype.hasOwnProperty.call(l.correcciones, k)
const verOriginal = (l, k) => {
  const v = l.valores_originales?.[k]
  if (v === null || v === undefined || v === '') return '(vacío)'
  if (k === 'mes') return String(v).slice(0, 7)
  return ['honorarios_base', 'bonuses', 'comision', 'total_usd'].includes(k) ? usd(v) : String(v)
}
// Muestra el valor vigente; si está corregido lleva ✎ y el original al pasar el mouse
function Celda({ l, k, children }) {
  if (!estaCorregido(l, k)) return <>{children}</>
  return <span className="corregido" title={`Original: ${verOriginal(l, k)}`}>{children} ✎</span>
}

export default function PagosEquipo({ onCorregir }) {
  const [lineas, setLineas] = useState([])
  const [personas, setPersonas] = useState([])
  const [mes, setMes] = useState(null) // null = aún sin elegir; '' = todos
  const [depto, setDepto] = useState('')
  const [estado, setEstado] = useState('')
  const [buscar, setBuscar] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [vista, setVista] = useState('lineas') // 'lineas' | 'cierre'
  const [form, setForm] = useState(null) // null = formulario cerrado
  const [editandoId, setEditandoId] = useState(null)
  const [mesCierre, setMesCierre] = useState(mesActual())
  const [comisionRes, setComisionRes] = useState(null) // { clave, data | error }: pagos_vigentes del mes (solo lectura) para la propuesta automática
  const [refresco, setRefresco] = useState(0) // se suma cada vez que se abre el formulario o se pide «Actualizar pagos»: fuerza leer los pagos de nuevo
  const [kpi, setKpi] = useState(false) // «objetivo KPI alcanzado»: tilda MANUAL (bono 15% de la comisión de Setter)
  const cargaId = useRef(0)

  async function cargar() {
    const mi = ++cargaId.current
    const [l, p] = await Promise.all([
      supabase.from('pagos_equipo_vigentes').select('*').order('mes', { ascending: false }).order('id').limit(5000),
      supabase.from('personas').select('id, nombre, puesto, departamento, activo, apodos').limit(500),
    ])
    if (mi !== cargaId.current) return // llegó otra carga más nueva mientras esta esperaba: se descarta para no pisar datos recientes con datos viejos
    const err = l.error || p.error
    if (err) setError(err.message)
    else {
      setLineas(l.data)
      setPersonas(p.data)
    }
  }
  const nombreDe = (l) => personas.find((p) => p.id === l.persona_id)?.nombre

  useEffect(() => {
    cargar()
  }, [])

  const meses = useMemo(() => [...new Set(lineas.map((l) => l.mes))].sort().reverse(), [lineas])

  // Al cargar, se elige el mes más reciente que tenga importes
  useEffect(() => {
    if (mes === null && lineas.length) {
      const conImporte = meses.find((m) => lineas.some((l) => l.mes === m && Number(l.total_usd) > 0))
      setMes(conImporte || meses[0] || '')
    }
  }, [lineas, meses, mes])

  const departamentos = useMemo(() => [...new Set(lineas.map((l) => l.departamento).filter(Boolean))].sort(), [lineas])

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return lineas.filter(
      (l) =>
        (!mes || l.mes === mes) &&
        (!depto || l.departamento === depto) &&
        (!estado || (estado === 'pagados' ? l.pagado : !l.pagado)) &&
        (!q || [nombreDe(l), l.nombre_original].some((v) => (v || '').toLowerCase().includes(q)))
    )
  }, [lineas, personas, mes, depto, estado, buscar]) // eslint-disable-line react-hooks/exhaustive-deps

  const suma = (arr, k) => arr.reduce((s, l) => s + Number(l[k] || 0), 0)
  const totales = {
    lineas: visibles.length,
    honorarios: suma(visibles, 'honorarios_base'),
    bonuses: suma(visibles, 'bonuses'),
    comision: suma(visibles, 'comision'),
    total: suma(visibles, 'total_usd'),
    pagado: suma(visibles.filter((l) => l.pagado), 'total_usd'),
    pendiente: suma(visibles.filter((l) => !l.pagado), 'total_usd'),
    totalArs: suma(visibles, 'total_ars'),
    conArs: visibles.filter((l) => l.total_ars !== null).length,
    lineasPagadas: visibles.filter((l) => l.pagado).length,
    lineasPendientes: visibles.filter((l) => !l.pagado).length,
  }
  const porDepto = useMemo(() => {
    const m = {}
    for (const l of visibles) m[l.departamento || '(sin departamento)'] = (m[l.departamento || '(sin departamento)'] || 0) + Number(l.total_usd)
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [visibles])

  async function actualizar(id, cambios) {
    setError('')
    const { error } = await supabase.from('pagos_equipo').update(cambios).eq('id', id)
    if (error) setError(error.message)
    cargar()
  }

  function editarNota(l) {
    const nueva = window.prompt('Nota de esta línea (dejá el texto original si no querés cambiarlo):', l.nota || '')
    if (nueva === null) return
    actualizar(l.id, { nota: nueva.trim() === '' ? null : nueva.trim() })
  }

  // ---------------------------------------------------------------- alta / edición de líneas nuevas (solo las creadas en la web)
  const personaDe = (id) => personas.find((p) => String(p.id) === String(id))
  const personasParaElegir = personas.filter((p) => p.activo || String(p.id) === String(form?.persona_id)) // las inactivas no se ofrecen (salvo la de la línea que se está editando)

  // ---- Propuesta de comisión AUTOMÁTICA (reglas en calculoComisiones.js; acá no se duplican).
  // Se recalcula sola cada vez que cambia la persona o el mes, al abrir el formulario o al pedir «Actualizar pagos». Lee los pagos cobrados del mes
  // de pagos_vigentes SOLO para consulta. `clave` identifica la consulta vigente: si el resultado que llega no es de la clave actual (cambiaste de persona
  // o de mes mientras cargaba) se descarta, y la propuesta se calcula siempre con el resultado de la clave actual, nunca con uno viejo.
  const mesFormOk = !!form && /^\d{4}-(0[1-9]|1[0-2])$/.test(form.mes)
  const claveComision = form && !editandoId && form.persona_id && mesFormOk ? `${form.mes}|${form.persona_id}|${refresco}` : null
  useEffect(() => {
    if (!claveComision) return undefined
    const mesC = claveComision.split('|')[0]
    let vigente = true
    ;(async () => {
      const ultimo = new Date(Date.UTC(Number(mesC.slice(0, 4)), Number(mesC.slice(5, 7)), 0)).getUTCDate()
      const { data, error } = await supabase.from('pagos_vigentes').select('id, fecha, monto_usd, closer, setter, concepto, fuente, tipo_venta')
        .gte('fecha', `${mesC}-01`).lte('fecha', `${mesC}-${String(ultimo).padStart(2, '0')}`).limit(5000)
      if (!vigente) return // ya cambió la persona / el mes / se cerró el formulario
      if (error) setComisionRes({ clave: claveComision, error: `No se pudieron leer los pagos del mes: ${error.message}` })
      else if (data.length >= 5000) setComisionRes({ clave: claveComision, error: 'La lectura de pagos puede estar incompleta (demasiados registros): no se calcula la comisión.' })
      else setComisionRes({ clave: claveComision, data })
    })()
    return () => { vigente = false }
  }, [claveComision])
  const estadoCalculo = !claveComision ? 'inactivo' : comisionRes?.clave !== claveComision ? 'cargando' : comisionRes.error ? 'error' : 'listo'
  const propuesta = estadoCalculo === 'listo' ? calcularComision({ pagos: comisionRes.data, personas, persona: personaDe(form.persona_id), mes: form.mes, kpi }) : null
  const sinPersona = estadoCalculo === 'listo' ? nombresSinPersona({ pagos: comisionRes.data, personas, mes: form.mes }) : []
  const comisionExistente = form && !editandoId && form.persona_id && mesFormOk ? lineas.filter((l) => String(l.persona_id) === String(form.persona_id) && mesDe(l.mes) === form.mes && Number(l.comision) > 0) : []
  // Importes automáticos: la comisión de la propuesta (si no está bloqueada y no hay ya una comisión de esa persona en el mes) y, con KPI marcado, su bono.
  const autoComision = propuesta && !propuesta.bloqueada && comisionExistente.length === 0 && propuesta.comision > 0 ? String(propuesta.comision) : ''
  const autoBono = autoComision && kpi && propuesta.bono > 0 ? String(propuesta.bono) : ''
  // Valores que realmente se muestran / validan / guardan: lo que escribió la persona si lo editó a mano; si no, lo automático.
  const formEf = form ? { ...form, comision: form.comisionEditada ? form.comision : autoComision, bonuses: form.bonusEditado ? form.bonuses : autoBono } : null
  const validacion = formEf ? validarLinea({ ...formEf, permitirInactiva: !!editandoId }, { personas, lineas, editandoId }) : null
  const bloqueoComision = formEf && !editandoId ? motivoBloqueoComision({ comision: formEf.comision, propuesta, estado: estadoCalculo }) : null

  function abrirNueva(persona_id = '', mes = null) {
    const p = personaDe(persona_id)
    setError('')
    setMensaje('')
    setEditandoId(null)
    setKpi(false)
    setRefresco((r) => r + 1) // cada vez que se abre el formulario se leen de nuevo los pagos
    cargar() // …y se refrescan personas y líneas (apodos, estado activo, duplicados) por si cambiaron
    setForm({ ...vacio(mes || (vista === 'cierre' ? mesCierre : '') || mesActual()), persona_id: p ? String(p.id) : '', puesto: p?.puesto ?? '', departamento: p?.departamento ?? '' })
  }
  function editarLinea(l) {
    if (esImportado(l)) return // las importadas solo se corrigen desde Correcciones
    setError('')
    setMensaje('')
    setEditandoId(l.id)
    setForm({
      persona_id: String(l.persona_id ?? ''), mes: mesDe(l.mes), puesto: l.puesto ?? '', departamento: l.departamento ?? '',
      honorarios_base: String(l.honorarios_base ?? ''), bonuses: String(l.bonuses ?? ''), comision: String(l.comision ?? ''), comisionEditada: true, bonusEditado: true, // al editar una línea guardada, sus importes no se pisan
      pagado: !!l.pagado, pagado_por: l.pagado_por ?? '', nota: l.nota ?? '', confirmaAdicional: true,
    })
    setKpi(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function cambiarForm(e) {
    const { name, value, type, checked } = e.target
    const nuevo = { ...form, [name]: type === 'checkbox' ? checked : value }
    if (name === 'persona_id') {
      const p = personaDe(value)
      nuevo.puesto = p?.puesto ?? ''
      nuevo.departamento = p?.departamento ?? ''
      nuevo.confirmaAdicional = false
    }
    if (name === 'mes') nuevo.confirmaAdicional = false
    if (name === 'persona_id' || name === 'mes') {
      // Al cambiar de persona o de mes, los importes de comisión y bono vuelven a ser automáticos (lo escrito a mano era de otra persona / otro mes) y el KPI se desmarca
      nuevo.comisionEditada = false
      nuevo.bonusEditado = false
      nuevo.comision = ''
      nuevo.bonuses = ''
      setKpi(false)
    }
    setForm(nuevo)
  }
  // Escribir a mano un importe de comisión o de bono lo saca del modo automático (no se pisa solo)
  const cambiarImporteManual = (campo) => (e) => setForm({ ...form, [campo]: e.target.value, [campo === 'comision' ? 'comisionEditada' : 'bonusEditado']: true })
  const volverAPropuesta = () => setForm({ ...form, comision: '', bonuses: '', comisionEditada: false, bonusEditado: false })
  // Copia SOLO los honorarios de la línea del mes anterior de esa persona (acción explícita; no se calcula nada solo)
  const lineaMesAnterior = form && form.persona_id && form.mes ? lineas.find((l) => String(l.persona_id) === String(form.persona_id) && mesDe(l.mes) === mesAnterior(form.mes) && Number(l.honorarios_base) > 0) : null
  function cerrarForm() {
    setForm(null)
    setEditandoId(null)
    setComisionRes(null)
    setKpi(false)
  }
  async function guardarLinea(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    // La propuesta automática solo se guarda cuando la persona confirma con «Guardar línea». Una comisión no se guarda si la propuesta está bloqueada o sin calcular.
    if (bloqueoComision) return setError(bloqueoComision)
    const v = validarLinea({ ...formEf, permitirInactiva: !!editandoId }, { personas, lineas, editandoId })
    if (v.errores.length) return setError(v.errores.join(' '))
    const persona = personaDe(form.persona_id)
    const datos = armarLinea(formEf, persona)
    // Si el importe de comisión es exactamente el propuesto (no se editó a mano) y no hay nota, queda constancia de cómo se calculó
    if (!editandoId && !datos.nota && !form.comisionEditada && autoComision) datos.nota = `Comisión calculada con las reglas nuevas sobre ${propuesta.pagosUsados} pago(s)${autoBono ? ' · KPI alcanzado (bono 15% de la comisión de Setter)' : ''}`
    if (editandoId) {
      const original = lineas.find((l) => l.id === editandoId)
      if (!original || esImportado(original)) return setError('Esa línea es importada: se corrige desde la pestaña Correcciones.')
      const { data, error } = await supabase.from('pagos_equipo').update(datos).eq('id', editandoId).select('id')
      if (error) return setError(error.message)
      if (!data || data.length !== 1) return setError('No se pudo actualizar la línea (no se modificó nada).')
      setMensaje('Línea actualizada.')
    } else {
      const { data, error } = await supabase.from('pagos_equipo').insert(datos).select('id')
      if (error) return setError(error.message)
      if (!data || data.length !== 1) return setError('No se pudo confirmar que la línea se guardó. Recargá la página y revisá la lista antes de volver a cargarla.')
      setMensaje(`Línea guardada: ${persona.nombre}, ${form.mes}, ${usd(datos.total_usd)} (${datos.pagado ? 'pagada' : 'pendiente'}).`)
    }
    setMes(datos.mes) // el filtro salta al mes de la línea guardada para que se vea en la lista
    cerrarForm()
    cargar()
  }
  async function borrarLinea(l) {
    if (esImportado(l)) return // las líneas importadas no se borran nunca
    if (l.pagado) return setError('Solo se pueden borrar líneas pendientes. Desmarcá «Pagado» primero si corresponde.')
    if (!window.confirm(`¿Borrar la línea de ${nombreDe(l) ?? l.nombre_original} (${mesDe(l.mes)}, ${usd(l.total_usd)})?`)) return
    setError('')
    setMensaje('')
    const { data, error } = await supabase.from('pagos_equipo').delete().eq('id', l.id).select('id')
    if (error) return setError(error.message)
    if (!data || data.length !== 1) return setError('No se pudo borrar la línea (no se modificó nada).')
    setMensaje('Línea borrada.')
    cargar()
  }

  const cierre = useMemo(() => cierreDeMes(lineas, personas, mesCierre), [lineas, personas, mesCierre])
  const mesesCierre = useMemo(() => [...new Set([mesActual(), ...lineas.map((l) => mesDe(l.mes))])].sort().reverse(), [lineas])

  return (
    <>
      <h2>Pagos del equipo</h2>
      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      <nav className="subtabs">
        <button type="button" onClick={() => setVista('lineas')} disabled={vista === 'lineas'}>Líneas</button>
        <button type="button" onClick={() => setVista('cierre')} disabled={vista === 'cierre'}>Cierre de mes</button>
        <button type="button" onClick={() => abrirNueva()} disabled={!!form && !editandoId}>+ Nueva línea</button>
      </nav>

      {form && (
        <section className="detalle">
          <h3>{editandoId ? `Editando línea #${editandoId}` : 'Nueva línea de pago del equipo'}</h3>
          <form onSubmit={guardarLinea} className="form">
            <label>Persona
              <select name="persona_id" value={form.persona_id} onChange={cambiarForm} required>
                <option value="">— elegí —</option>
                {personasParaElegir.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.activo ? '' : ' (inactiva)'}</option>)}
              </select>
            </label>
            <label>Período (mes)<input type="month" name="mes" value={form.mes} onChange={cambiarForm} required /></label>
            <label>Rol (puesto)<input name="puesto" value={form.puesto} onChange={cambiarForm} /></label>
            <label>Área (departamento)<input name="departamento" value={form.departamento} onChange={cambiarForm} /></label>
            <label>Honorarios (USD)<input type="number" step="0.01" min="0" name="honorarios_base" value={form.honorarios_base} onChange={cambiarForm} /></label>
            <label>Bonus (USD){!form.bonusEditado && autoBono ? ' · bono KPI automático' : ''}<input type="number" step="0.01" min="0" name="bonuses" value={formEf.bonuses} onChange={cambiarImporteManual('bonuses')} /></label>
            <label>Comisión (USD){!form.comisionEditada && autoComision ? ' · propuesta automática' : ''}<input type="number" step="0.01" min="0" name="comision" value={formEf.comision} onChange={cambiarImporteManual('comision')} /></label>
            <label>Estado
              <select name="pagado" value={form.pagado ? 'si' : 'no'} onChange={(e) => setForm({ ...form, pagado: e.target.value === 'si' })}>
                <option value="no">Pendiente</option>
                <option value="si">Pagado</option>
              </select>
            </label>
            <label>Pagado por
              <select name="pagado_por" value={form.pagado_por} onChange={cambiarForm}>
                <option value="">—</option>
                {OPCIONES_PAGADO_POR.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label>Nota (opcional)<input name="nota" value={form.nota} onChange={cambiarForm} /></label>
            <p className="aviso">
              Tipo de remuneración: <strong>{tipoRemuneracion(formEf)}</strong> · Total a pagar: <strong>{usd(totalDe(formEf))}</strong> (honorarios + bonus + comisión) · Moneda: USD
            </p>
            {validacion?.existentes.length > 0 && !editandoId && (
              <div className="aviso-box">
                ⚠ Esa persona ya tiene {validacion.existentes.length === 1 ? 'una línea' : `${validacion.existentes.length} líneas`} en {form.mes}: {validacion.existentes.map((l) => `${usd(l.total_usd)} (${esImportado(l) ? 'importada' : 'web'}, ${l.pagado ? 'pagada' : 'pendiente'})`).join('; ')}.
                <label className="check"><input type="checkbox" name="confirmaAdicional" checked={form.confirmaAdicional} onChange={cambiarForm} /> Es una línea adicional (por ejemplo un ajuste)</label>
              </div>
            )}
            {!editandoId && (
              <div className="aviso-box">
                <strong>Comisión (reglas nuevas) — cálculo automático</strong>
                <p className="aviso">Se calcula sola al elegir persona y mes, con los pagos cobrados actuales: Setter {REGLAS_COMISION.setterInbound * 100}% Inbound IG / {REGLAS_COMISION.setterEnrutamiento * 100}% Enrutamiento (solo Fee, PIF y 1ra Cuota) · Closer {REGLAS_COMISION.closer * 100}% de lo cobrado de Front-end · bono KPI {REGLAS_COMISION.bonoKpiSetter * 100}% de la comisión de Setter (lo marcás vos). Es una propuesta: no se guarda hasta que confirmes con «Guardar línea», y no modifica Payroll histórico.</p>
                {estadoCalculo === 'inactivo' && <p className="aviso">Elegí la persona y el mes para ver la propuesta.</p>}
                {estadoCalculo === 'cargando' && <p className="aviso">Calculando con los pagos cobrados de {form.mes}…</p>}
                {estadoCalculo === 'error' && <p className="error">{comisionRes.error}</p>}
                {estadoCalculo !== 'inactivo' && <p><button type="button" onClick={() => setRefresco((r) => r + 1)} disabled={estadoCalculo === 'cargando'}>↻ Actualizar pagos</button> <span className="aviso">Vuelve a leer los pagos del mes (por si se cargaron o corrigieron mientras tenías esto abierto).</span></p>}
                {propuesta && (
                  <div>
                    {propuesta.bloqueada && <div className="aviso-box">⛔ <strong>Propuesta bloqueada:</strong> {propuesta.motivoBloqueo} No se puede guardar una comisión mientras esté bloqueada; la línea se puede guardar con la comisión en 0.</div>}
                    {propuesta.lineas.length > 0 && (
                      <table>
                        <thead><tr><th>Regla</th><th>Pagos</th><th>Base cobrada</th><th>%</th><th>Comisión</th></tr></thead>
                        <tbody>
                          {propuesta.lineas.map((l) => <tr key={l.regla}><td>{l.regla}</td><td>{l.n}</td><td>{usd(l.base)}</td><td>{l.pct * 100}%</td><td>{usd(l.monto)}</td></tr>)}
                        </tbody>
                      </table>
                    )}
                    <label className="check"><input type="checkbox" checked={kpi} onChange={(e) => setKpi(e.target.checked)} disabled={propuesta.bloqueada} /> Objetivo KPI alcanzado (bono {REGLAS_COMISION.bonoKpiSetter * 100}% de la comisión de Setter)</label>
                    <table>
                      <tbody>
                        <tr><td>Comisión Setter</td><td>{usd(propuesta.comisionSetter)}</td></tr>
                        <tr><td>Comisión Closer</td><td>{usd(propuesta.comisionCloser)}</td></tr>
                        <tr><td>Comisión (Setter + Closer)</td><td>{usd(propuesta.comision)}</td></tr>
                        <tr><td>Bono KPI ({REGLAS_COMISION.bonoKpiSetter * 100}% de Setter){kpi ? '' : ' — KPI sin marcar'}</td><td>{usd(propuesta.bono)}</td></tr>
                        <tr><td><strong>Total propuesto</strong></td><td><strong>{usd(propuesta.total)}</strong></td></tr>
                      </tbody>
                    </table>
                    {!propuesta.bloqueada && autoComision && !form.comisionEditada && <div className="aviso">✔ El campo «Comisión» se completó con esta propuesta{autoBono && !form.bonusEditado ? ' y el campo «Bonus» con el bono KPI' : ''}. Podés cambiarlos antes de guardar.</div>}
                    {!propuesta.bloqueada && form.comisionEditada && Number(form.comision || 0) !== propuesta.comision && <div className="aviso">⚠ La comisión que escribiste ({usd(form.comision)}) es distinta de la propuesta ({usd(propuesta.comision)}).</div>}
                    {(form.comisionEditada || form.bonusEditado) && <p><button type="button" onClick={volverAPropuesta}>↺ Volver a la propuesta automática</button></p>}
                    {propuesta.requiereRevision && <div className="aviso-box">⚠ <strong>Hay pagos marcados para revisión</strong> (devoluciones o datos inconsistentes). No suman a la propuesta; revisalos en el detalle de abajo antes de confirmar.</div>}
                    {propuesta.notas.filter((n) => n !== propuesta.motivoBloqueo).map((n) => <div key={n} className="aviso">• {n}</div>)}
                    {(propuesta.pagosIncluidos.length > 0 || propuesta.pagosExcluidos.length > 0) && (
                      <details>
                        <summary>Ver pagos incluidos ({propuesta.pagosIncluidos.length}) y excluidos ({propuesta.pagosExcluidos.length}) con su motivo</summary>
                        <div className="tabla-scroll">
                          <table>
                            <thead><tr><th>Pago</th><th>Fecha</th><th>Rol</th><th>Concepto</th><th>Fuente</th><th>Tipo de venta</th><th>Monto</th><th>Resultado</th><th>Motivo</th></tr></thead>
                            <tbody>
                              {propuesta.pagosIncluidos.map((x) => <tr key={`i${x.id}-${x.rol}`}><td>#{x.id}</td><td>{x.fecha}</td><td>{x.rol}</td><td>{x.concepto}</td><td>{x.fuente}</td><td>{x.tipo_venta}</td><td>{usd(x.base)}</td><td>Incluido ({x.pct * 100}%)</td><td>{x.motivo}</td></tr>)}
                              {propuesta.pagosExcluidos.map((x) => <tr key={`e${x.id}-${x.rol}`} className="fila-gris"><td>#{x.id}</td><td>{x.fecha}</td><td>{x.rol}</td><td>{x.concepto}</td><td>{x.fuente}</td><td>{x.tipo_venta}</td><td>{x.monto === null ? '—' : usd(x.monto)}</td><td>{x.revisar ? 'Excluido · REVISAR' : 'Excluido'}</td><td>{x.motivo}</td></tr>)}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    {sinPersona.length > 0 && <div className="aviso">Nombres de Pagos de este mes sin persona asociada (agregalos en Equipo → apodos si corresponde): {sinPersona.map((x) => `${x.nombre} (${x.n})`).join('; ')}</div>}
                  </div>
                )}
                {comisionExistente.length > 0 && <div className="aviso">⚠ Ya hay una comisión registrada para esta persona en {form.mes} ({usd(comisionExistente.reduce((s, l) => s + Number(l.comision), 0))}): no se completa sola ni se puede cargar otra. Comparala con la propuesta y, si hace falta, usá «Corregir» sobre esa línea (la línea existente no se modifica desde acá).</div>}
              </div>
            )}
            {lineaMesAnterior && !editandoId && (
              <p><button type="button" onClick={() => setForm({ ...form, honorarios_base: String(lineaMesAnterior.honorarios_base) })}>Copiar honorarios del mes anterior ({usd(lineaMesAnterior.honorarios_base)})</button> <span className="aviso">Solo copia el importe de honorarios; lo confirmás vos.</span></p>
            )}
            {bloqueoComision && <div className="aviso-box">⛔ {bloqueoComision}</div>}
            <div className="acciones">
              <button type="submit" disabled={!!bloqueoComision}>{editandoId ? 'Guardar cambios' : 'Guardar línea'}</button>
              <button type="button" onClick={cerrarForm}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      {vista === 'cierre' && (
        <section className="dash-seccion">
          <h3>Cierre de mes</h3>
          <div className="filtros">
            <select value={mesCierre} onChange={(e) => setMesCierre(e.target.value)}>
              {mesesCierre.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="aviso">Lo que corresponde pagar a cada persona en el mes (suma de todas sus líneas). Las inactivas con líneas en el mes también aparecen.</span>
          </div>
          <div className="resumen-principal">
            <div><span>Total a pagar</span><strong>{usd(cierre.totales.total)}</strong></div>
            <div><span>Pagado</span><strong>{usd(cierre.totales.pagado)}</strong></div>
            <div><span>Pendiente</span><strong>{usd(cierre.totales.pendiente)}</strong></div>
            <div><span>Líneas</span><strong>{cierre.totales.lineas}</strong></div>
          </div>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>Persona</th><th>Rol</th><th>Área</th><th>Honorarios</th><th>Bonus</th><th>Comisión</th><th>Total a pagar</th><th>Pagado</th><th>Pendiente</th><th>Líneas</th><th></th></tr></thead>
              <tbody>
                {cierre.filas.map((f) => (
                  <tr key={f.persona_id ?? f.nombre} className={f.activo === false ? 'fila-inactiva' : ''}>
                    <td>{f.nombre}{f.activo === false && ' (inactiva)'}</td><td>{f.puesto}</td><td>{f.departamento}</td>
                    <td>{usd(f.honorarios)}</td><td>{usd(f.bonus)}</td><td>{usd(f.comision)}</td><td><strong>{usd(f.total)}</strong></td><td>{usd(f.pagado)}</td><td>{usd(f.pendiente)}</td><td>{f.lineas}</td>
                    <td className="nowrap">{f.activo && <button type="button" onClick={() => abrirNueva(f.persona_id, mesCierre)}>Agregar línea</button>}</td>
                  </tr>
                ))}
                {cierre.filas.length === 0 && <tr><td colSpan={11} className="aviso">No hay líneas en {mesCierre}.</td></tr>}
              </tbody>
            </table>
          </div>
          {cierre.sinLinea.length > 0 && (
            <div className="aviso-box">
              <strong>Personas activas sin ninguna línea en {mesCierre} ({cierre.sinLinea.length}):</strong>{' '}
              {cierre.sinLinea.map((p) => <button key={p.id} type="button" onClick={() => abrirNueva(p.id, mesCierre)}>{p.nombre}</button>)}
              <div className="aviso">Es solo un aviso: puede que ese mes no les corresponda pago.</div>
            </div>
          )}
        </section>
      )}

      {vista === 'lineas' && <>
      <div className="filtros">
        <select value={mes ?? ''} onChange={(e) => setMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {meses.map((m) => (
            <option key={m} value={m}>{m.slice(0, 7)}</option>
          ))}
        </select>
        <select value={depto} onChange={(e) => setDepto(e.target.value)}>
          <option value="">Todos los departamentos</option>
          {departamentos.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Pagados y no pagados</option>
          <option value="pagados">Solo pagados</option>
          <option value="pendientes">Solo no pagados</option>
        </select>
        <input placeholder="Buscar persona" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>

      <div className="resumen-principal">
        <div><span>Total de líneas</span><strong>{totales.lineas}</strong></div>
        <div><span>Pagadas</span><strong>{totales.lineasPagadas}</strong></div>
        <div><span>Pendientes</span><strong>{totales.lineasPendientes}</strong></div>
        <div><span>Total USD</span><strong>{usd(totales.total)}</strong></div>
        <div><span>USD pagado</span><strong>{usd(totales.pagado)}</strong></div>
        <div><span>USD pendiente</span><strong>{usd(totales.pendiente)}</strong></div>
      </div>

      <div className="tarjetas">
        <div><span>Líneas</span><strong>{totales.lineas}</strong></div>
        <div><span>Honorarios</span><strong>{usd(totales.honorarios)}</strong></div>
        <div><span>Bonus</span><strong>{usd(totales.bonuses)}</strong></div>
        <div><span>Comisión</span><strong>{usd(totales.comision)}</strong></div>
        <div className="destacada"><span>Total USD</span><strong>{usd(totales.total)}</strong></div>
        <div><span>Pagado</span><strong>{usd(totales.pagado)}</strong></div>
        <div><span>Pendiente</span><strong>{usd(totales.pendiente)}</strong></div>
        {totales.conArs > 0 && <div><span>Total ARS ({totales.conArs} líneas)</span><strong>{ars(totales.totalArs)}</strong></div>}
      </div>

      <div className="resumenes">
        <div>
          <h3>Por departamento</h3>
          <table>
            <tbody>
              {porDepto.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{usd(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th></th><th>Mes</th><th>Persona</th><th>Puesto</th><th>Departamento</th><th>Honorarios</th><th>Bonus</th><th>Comisión</th><th>Total</th><th>Moneda</th><th>Pagado</th><th>Pagado por</th><th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => (
              <tr key={l.id}>
                {/* Primera columna a propósito: así "Corregir" siempre se ve, sin tener que desplazar la tabla hacia la derecha */}
                <td className="nowrap">
                  {esImportado(l) && <button type="button" onClick={() => onCorregir && onCorregir({ tabla: 'pagos_equipo', id: l.id })}>Corregir</button>}
                  {!esImportado(l) && <button type="button" onClick={() => editarLinea(l)}>Editar</button>}
                  {!esImportado(l) && !l.pagado && <button type="button" onClick={() => borrarLinea(l)}>Borrar</button>}
                </td>
                <td><Celda l={l} k="mes">{l.mes.slice(0, 7)}</Celda></td>
                <td>
                  {nombreDe(l)}
                  {nombreDe(l) !== l.nombre_original && <div className="aviso">en el Excel: {l.nombre_original}</div>}
                </td>
                <td><Celda l={l} k="puesto">{l.puesto}</Celda></td>
                <td><Celda l={l} k="departamento">{l.departamento}</Celda></td>
                <td><Celda l={l} k="honorarios_base">{usd(l.honorarios_base)}</Celda></td>
                <td><Celda l={l} k="bonuses">{usd(l.bonuses)}</Celda></td>
                <td><Celda l={l} k="comision">{usd(l.comision)}</Celda></td>
                <td>
                  <Celda l={l} k="total_usd"><strong>{usd(l.total_usd)}</strong></Celda>
                  {l.total_ars !== null && <div className="aviso">{ars(l.total_ars)}</div>}
                </td>
                <td title={l.moneda_original || ''}><Celda l={l} k="moneda">{l.moneda || ''}</Celda></td>
                <td>
                  <input type="checkbox" checked={l.pagado} onChange={(e) => actualizar(l.id, { pagado: e.target.checked })} aria-label="Pagado" />
                </td>
                <td>
                  <select value={l.pagado_por || ''} onChange={(e) => actualizar(l.id, { pagado_por: e.target.value || null })}>
                    <option value="">—</option>
                    {OPCIONES_PAGADO_POR.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </td>
                <td className="nota">
                  {l.nota}{' '}
                  <button type="button" onClick={() => editarNota(l)} title="Editar nota">✎</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </>
  )
}
