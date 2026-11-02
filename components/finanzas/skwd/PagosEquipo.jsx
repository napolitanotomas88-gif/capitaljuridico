import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { OPCIONES_PAGADO_POR, validarLinea, armarLinea, totalDe, tipoRemuneracion, cierreDeMes, mesDe, mesAnterior, motivoBloqueoComision } from './calculoPayroll'
import { calcularComision, nombresSinPersona, REGLAS_COMISION } from './calculoComisiones'
import SopDelPuesto from './SopDelPuesto'
import { Boton } from '@/components/ui/Boton'
import { ChipSemaforo } from '@/components/ui/ChipSemaforo'

const usd = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const ars = (n) => 'ARS ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const mesActual = () => new Date().toLocaleDateString('en-CA').slice(0, 7)
// comisionEditada / bonusEditado: false = el importe lo propone el cálculo automático; true = lo escribió la persona (manual) y no se pisa
const vacio = (mes = '') => ({ persona_id: '', mes, puesto: '', departamento: '', honorarios_base: '', bonuses: '', comision: '', extras: '', extras_detalle: '', comisionEditada: false, bonusEditado: false, pagado: false, pagado_por: '', nota: '', confirmaAdicional: false })

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
  const [intentado, setIntentado] = useState(false) // solo presentación: los errores se muestran al lado de cada campo después del primer «Guardar»
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
    extras: suma(visibles, 'extras'),
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
    setIntentado(false)
    setRefresco((r) => r + 1) // cada vez que se abre el formulario se leen de nuevo los pagos
    cargar() // …y se refrescan personas y líneas (apodos, estado activo, duplicados) por si cambiaron
    setForm({ ...vacio(mes || (vista === 'cierre' ? mesCierre : '') || mesActual()), persona_id: p ? String(p.id) : '', puesto: p?.puesto ?? '', departamento: p?.departamento ?? '' })
  }
  function editarLinea(l) {
    if (esImportado(l)) return // las importadas solo se corrigen desde Correcciones
    setError('')
    setMensaje('')
    setEditandoId(l.id)
    setIntentado(false)
    setForm({
      persona_id: String(l.persona_id ?? ''), mes: mesDe(l.mes), puesto: l.puesto ?? '', departamento: l.departamento ?? '',
      honorarios_base: String(l.honorarios_base ?? ''), bonuses: String(l.bonuses ?? ''), comision: String(l.comision ?? ''), extras: Number(l.extras) ? String(l.extras) : '', extras_detalle: l.extras_detalle ?? '', comisionEditada: true, bonusEditado: true, // al editar una línea guardada, sus importes no se pisan
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
    setIntentado(false)
  }
  async function guardarLinea(e) {
    e.preventDefault()
    setIntentado(true)
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

  // ---------------------------------------------------------------- presentación
  // Errores al lado de cada campo: los mensajes salen de validarLinea (calculoPayroll.js) y acá solo se ubican junto al campo que corresponde.
  // Se muestran después del primer intento de guardar; mientras tanto el formulario no se llena de rojo.
  const erroresForm = intentado && validacion ? validacion.errores : []
  const errorDe = (campo) => erroresForm.filter((t) => campoDeError(t) === campo).join(' ') || null
  const erroresSinCampo = erroresForm.filter((t) => !campoDeError(t))
  const props = (campo, ayuda) => {
    const err = errorDe(campo)
    return { id: `pe-${campo}`, 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `pe-${campo}-error` : ayuda ? `pe-${campo}-ayuda` : undefined }
  }
  const ayudaComision = editandoId ? null : !form?.comisionEditada && autoComision ? 'Propuesta automática: podés cambiarla antes de guardar.' : 'Se propone sola al elegir persona y mes (ver abajo).'
  const ayudaBonus = !editandoId && !form?.bonusEditado && autoBono ? `Bono KPI automático (${REGLAS_COMISION.bonoKpiSetter * 100}% de la comisión de Setter).` : null
  const extrasConImporte = !!form && Number(form.extras) > 0

  return (
    <div className="pe">
      {error && !form && <p className="error" role="alert">Error: {error}</p>}
      {mensaje && <p className="ok" role="status">{mensaje}</p>}

      <div className="pe-barra">
        <div className="pe-segmento" role="group" aria-label="Vista de pagos del equipo">
          <button type="button" aria-pressed={vista === 'lineas'} onClick={() => setVista('lineas')}>Líneas</button>
          <button type="button" aria-pressed={vista === 'cierre'} onClick={() => setVista('cierre')}>Cierre de mes</button>
        </div>
        <Boton variante="marca" onClick={() => abrirNueva()} disabled={!!form && !editandoId}>+ Nueva línea</Boton>
      </div>

      {form && (
        <section className="pe-carga" aria-labelledby="pe-carga-titulo">
          <header className="pe-carga__cab">
            <div>
              <span className="cj-etiqueta cj-etiqueta--laton">{editandoId ? 'Editar línea' : 'Cargar pago'}</span>
              <h3 id="pe-carga-titulo">{editandoId ? `Editando línea #${editandoId}` : 'Nueva línea de pago del equipo'}</h3>
            </div>
            <p className="pe-ayuda">Los campos con <span className="pe-obligatorio">*</span> son obligatorios. Todo en USD.</p>
          </header>

          <form onSubmit={guardarLinea} className="pe-form">
            <div className="pe-form__cuerpo">
              <fieldset className="pe-grupo">
                <legend>Persona y período</legend>
                <div className="pe-rejilla">
                  <Campo campo="persona_id" etiqueta="Persona" obligatorio error={errorDe('persona_id')} className="pe-c6">
                    <select {...props('persona_id')} name="persona_id" value={form.persona_id} onChange={cambiarForm} required>
                      <option value="">— elegí —</option>
                      {personasParaElegir.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.activo ? '' : ' (inactiva)'}</option>)}
                    </select>
                  </Campo>
                  <Campo campo="mes" etiqueta="Período (mes)" obligatorio error={errorDe('mes')} className="pe-c6">
                    <input {...props('mes')} type="month" name="mes" value={form.mes} onChange={cambiarForm} required />
                  </Campo>
                  <Campo campo="puesto" etiqueta="Rol (puesto)" ayuda="Se completa con el de la persona." className="pe-c6">
                    <input {...props('puesto', true)} name="puesto" value={form.puesto} onChange={cambiarForm} />
                  </Campo>
                  <Campo campo="departamento" etiqueta="Área (departamento)" className="pe-c6">
                    <input {...props('departamento')} name="departamento" value={form.departamento} onChange={cambiarForm} />
                  </Campo>
                  {form.persona_id && <div className="pe-c12"><SopDelPuesto puesto={form.puesto} puestoPersona={personaDe(form.persona_id)?.puesto} /></div>}
                </div>
                {validacion?.existentes.length > 0 && !editandoId && (
                  <div className={`aviso-box${errorDe('confirmaAdicional') ? ' pe-aviso--error' : ''}`}>
                    ⚠ Esa persona ya tiene {validacion.existentes.length === 1 ? 'una línea' : `${validacion.existentes.length} líneas`} en {form.mes}: {validacion.existentes.map((l) => `${usd(l.total_usd)} (${esImportado(l) ? 'importada' : 'web'}, ${l.pagado ? 'pagada' : 'pendiente'})`).join('; ')}.
                    <label className="pe-check"><input type="checkbox" name="confirmaAdicional" checked={form.confirmaAdicional} onChange={cambiarForm} aria-describedby={errorDe('confirmaAdicional') ? 'pe-confirmaAdicional-error' : undefined} /> Es una línea adicional (por ejemplo un ajuste)</label>
                    {errorDe('confirmaAdicional') && <p id="pe-confirmaAdicional-error" className="pe-error">{errorDe('confirmaAdicional')}</p>}
                  </div>
                )}
              </fieldset>

              <fieldset className="pe-grupo">
                <legend>Montos</legend>
                <div className="pe-rejilla">
                  <Campo campo="honorarios_base" etiqueta="Honorarios" error={errorDe('honorarios_base')} className="pe-c3">
                    <Monto><input {...props('honorarios_base')} type="number" inputMode="decimal" step="0.01" min="0" name="honorarios_base" value={form.honorarios_base} onChange={cambiarForm} placeholder="0" /></Monto>
                  </Campo>
                  <Campo campo="bonuses" etiqueta="Bonus" ayuda={ayudaBonus} error={errorDe('bonuses')} className="pe-c3">
                    <Monto><input {...props('bonuses', ayudaBonus)} type="number" inputMode="decimal" step="0.01" min="0" name="bonuses" value={formEf.bonuses} onChange={cambiarImporteManual('bonuses')} placeholder="0" /></Monto>
                  </Campo>
                  <Campo campo="comision" etiqueta="Comisión" ayuda={ayudaComision} error={errorDe('comision')} className="pe-c3">
                    <Monto><input {...props('comision', ayudaComision)} type="number" inputMode="decimal" step="0.01" min="0" name="comision" value={formEf.comision} onChange={cambiarImporteManual('comision')} placeholder="0" /></Monto>
                  </Campo>
                  <Campo campo="extras" etiqueta="Extras" error={errorDe('extras')} className="pe-c3">
                    <Monto><input {...props('extras')} type="number" inputMode="decimal" step="0.01" min="0" name="extras" value={form.extras} onChange={cambiarForm} placeholder="0" /></Monto>
                  </Campo>
                  <Campo campo="extras_detalle" etiqueta="Detalle de los extras" obligatorio={extrasConImporte} ayuda={extrasConImporte ? 'Obligatorio cuando hay extras.' : 'Solo si hay extras.'} error={errorDe('extras_detalle')} className="pe-c12">
                    <input {...props('extras_detalle', true)} name="extras_detalle" value={form.extras_detalle} onChange={cambiarForm} placeholder="Qué hizo de más (ej.: cubrió edición de otro cliente)" />
                  </Campo>
                  {lineaMesAnterior && !editandoId && (
                    <div className="pe-c12 pe-linea-accion">
                      <Boton variante="secundario" onClick={() => setForm({ ...form, honorarios_base: String(lineaMesAnterior.honorarios_base) })}>Copiar honorarios del mes anterior ({usd(lineaMesAnterior.honorarios_base)})</Boton>
                      <span className="pe-ayuda">Solo copia el importe de honorarios; lo confirmás vos.</span>
                    </div>
                  )}
                </div>

                {!editandoId && (
                  <div className="pe-propuesta">
                    <div className="pe-propuesta__cab">
                      <div>
                        <span className="cj-etiqueta cj-etiqueta--laton">Comisión · reglas nuevas</span>
                        <h4>Cálculo automático</h4>
                      </div>
                      {estadoCalculo !== 'inactivo' && <Boton variante="secundario" onClick={() => setRefresco((r) => r + 1)} disabled={estadoCalculo === 'cargando'}>↻ Actualizar pagos</Boton>}
                    </div>
                    <p className="pe-ayuda">Se calcula sola al elegir persona y mes, con los pagos cobrados actuales: Setter {REGLAS_COMISION.setterInbound * 100}% Inbound IG / {REGLAS_COMISION.setterEnrutamiento * 100}% Enrutamiento (solo Fee, PIF y 1ra Cuota) · Closer {REGLAS_COMISION.closer * 100}% de lo cobrado de Front-end · bono KPI {REGLAS_COMISION.bonoKpiSetter * 100}% de la comisión de Setter (lo marcás vos). Es una propuesta: no se guarda hasta que confirmes con «Guardar línea», y no modifica Payroll histórico.</p>
                    {estadoCalculo === 'inactivo' && <p className="pe-vacio">Elegí la persona y el mes para ver la propuesta.</p>}
                    {estadoCalculo === 'cargando' && <p className="pe-vacio" role="status">Calculando con los pagos cobrados de {form.mes}…</p>}
                    {estadoCalculo === 'error' && <p className="error">{comisionRes.error}</p>}
                    {estadoCalculo !== 'inactivo' && <p className="pe-ayuda">«Actualizar pagos» vuelve a leer los pagos del mes (por si se cargaron o corrigieron mientras tenías esto abierto).</p>}
                    {propuesta && (
                      <div className="pe-propuesta__cuerpo">
                        {propuesta.bloqueada && <div className="aviso-box">⛔ <strong>Propuesta bloqueada:</strong> {propuesta.motivoBloqueo} No se puede guardar una comisión mientras esté bloqueada; la línea se puede guardar con la comisión en 0.</div>}
                        <div className="pe-propuesta__tablas">
                          {propuesta.lineas.length > 0 && (
                            <div className="tabla-scroll">
                              <table className="pe-tabla">
                                <thead><tr><th>Regla</th><th className="num">Pagos</th><th className="num">Base cobrada</th><th className="num">%</th><th className="num">Comisión</th></tr></thead>
                                <tbody>
                                  {propuesta.lineas.map((l) => <tr key={l.regla}><td>{l.regla}</td><td className="num">{l.n}</td><td className="num">{usd(l.base)}</td><td className="num">{l.pct * 100}%</td><td className="num">{usd(l.monto)}</td></tr>)}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div className="tabla-scroll">
                            <table className="pe-tabla">
                              <tbody>
                                <tr><td>Comisión Setter</td><td className="num">{usd(propuesta.comisionSetter)}</td></tr>
                                <tr><td>Comisión Closer</td><td className="num">{usd(propuesta.comisionCloser)}</td></tr>
                                <tr><td>Comisión (Setter + Closer)</td><td className="num">{usd(propuesta.comision)}</td></tr>
                                <tr><td>Bono KPI ({REGLAS_COMISION.bonoKpiSetter * 100}% de Setter){kpi ? '' : ' — KPI sin marcar'}</td><td className="num">{usd(propuesta.bono)}</td></tr>
                                <tr className="fila-total"><td>Total propuesto</td><td className="num">{usd(propuesta.total)}</td></tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <label className="pe-check"><input type="checkbox" checked={kpi} onChange={(e) => setKpi(e.target.checked)} disabled={propuesta.bloqueada} /> Objetivo KPI alcanzado (bono {REGLAS_COMISION.bonoKpiSetter * 100}% de la comisión de Setter)</label>
                        {!propuesta.bloqueada && autoComision && !form.comisionEditada && <p className="pe-nota-ok">✔ El campo «Comisión» se completó con esta propuesta{autoBono && !form.bonusEditado ? ' y el campo «Bonus» con el bono KPI' : ''}. Podés cambiarlos antes de guardar.</p>}
                        {!propuesta.bloqueada && form.comisionEditada && Number(form.comision || 0) !== propuesta.comision && <p className="pe-nota-aviso">⚠ La comisión que escribiste ({usd(form.comision)}) es distinta de la propuesta ({usd(propuesta.comision)}).</p>}
                        {(form.comisionEditada || form.bonusEditado) && <p><Boton variante="secundario" onClick={volverAPropuesta}>↺ Volver a la propuesta automática</Boton></p>}
                        {propuesta.requiereRevision && <div className="aviso-box">⚠ <strong>Hay pagos marcados para revisión</strong> (devoluciones o datos inconsistentes). No suman a la propuesta; revisalos en el detalle de abajo antes de confirmar.</div>}
                        {propuesta.notas.filter((n) => n !== propuesta.motivoBloqueo).map((n) => <p key={n} className="pe-ayuda">• {n}</p>)}
                        {(propuesta.pagosIncluidos.length > 0 || propuesta.pagosExcluidos.length > 0) && (
                          <details className="pe-detalle">
                            <summary>Ver pagos incluidos ({propuesta.pagosIncluidos.length}) y excluidos ({propuesta.pagosExcluidos.length}) con su motivo</summary>
                            <div className="tabla-scroll">
                              <table className="pe-tabla">
                                <thead><tr><th>Pago</th><th>Fecha</th><th>Rol</th><th>Concepto</th><th>Fuente</th><th>Tipo de venta</th><th className="num">Monto</th><th>Resultado</th><th>Motivo</th></tr></thead>
                                <tbody>
                                  {propuesta.pagosIncluidos.map((x) => <tr key={`i${x.id}-${x.rol}`}><td>#{x.id}</td><td className="nowrap">{x.fecha}</td><td>{x.rol}</td><td>{x.concepto}</td><td>{x.fuente}</td><td>{x.tipo_venta}</td><td className="num">{usd(x.base)}</td><td>Incluido ({x.pct * 100}%)</td><td>{x.motivo}</td></tr>)}
                                  {propuesta.pagosExcluidos.map((x) => <tr key={`e${x.id}-${x.rol}`} className="fila-gris"><td>#{x.id}</td><td className="nowrap">{x.fecha}</td><td>{x.rol}</td><td>{x.concepto}</td><td>{x.fuente}</td><td>{x.tipo_venta}</td><td className="num">{x.monto === null ? '—' : usd(x.monto)}</td><td>{x.revisar ? 'Excluido · REVISAR' : 'Excluido'}</td><td>{x.motivo}</td></tr>)}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                        {sinPersona.length > 0 && <p className="pe-ayuda">Nombres de Pagos de este mes sin persona asociada (agregalos en Equipo → apodos si corresponde): {sinPersona.map((x) => `${x.nombre} (${x.n})`).join('; ')}</p>}
                      </div>
                    )}
                    {comisionExistente.length > 0 && <div className="aviso-box">⚠ Ya hay una comisión registrada para esta persona en {form.mes} ({usd(comisionExistente.reduce((s, l) => s + Number(l.comision), 0))}): no se completa sola ni se puede cargar otra. Comparala con la propuesta y, si hace falta, usá «Corregir» sobre esa línea (la línea existente no se modifica desde acá).</div>}
                  </div>
                )}
              </fieldset>

              <fieldset className="pe-grupo">
                <legend>Pago</legend>
                <div className="pe-rejilla">
                  <Campo campo="pagado" etiqueta="Estado" className="pe-c4">
                    <select {...props('pagado')} name="pagado" value={form.pagado ? 'si' : 'no'} onChange={(e) => setForm({ ...form, pagado: e.target.value === 'si' })}>
                      <option value="no">Pendiente</option>
                      <option value="si">Pagado</option>
                    </select>
                  </Campo>
                  <Campo campo="pagado_por" etiqueta="Pagado por" error={errorDe('pagado_por')} className="pe-c4">
                    <select {...props('pagado_por')} name="pagado_por" value={form.pagado_por} onChange={cambiarForm}>
                      <option value="">—</option>
                      {OPCIONES_PAGADO_POR.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </Campo>
                  <Campo campo="nota" etiqueta="Nota" ayuda="Opcional. Si la dejás vacía y la comisión es la propuesta, se anota cómo se calculó." className="pe-c12">
                    <input {...props('nota', true)} name="nota" value={form.nota} onChange={cambiarForm} />
                  </Campo>
                </div>
              </fieldset>
            </div>

            <aside className="pe-form__resumen" aria-label="Total de la línea">
              <div className="pe-total">
                <span className="cj-etiqueta">Total a pagar</span>
                <strong className="pe-total__valor" aria-live="polite">{usd(totalDe(formEf))}</strong>
                <span className="pe-ayuda">USD · {tipoRemuneracion(formEf)}</span>
                <dl className="pe-desglose">
                  <div><dt>Honorarios</dt><dd>{usd(formEf.honorarios_base)}</dd></div>
                  <div><dt>Bonus</dt><dd>{usd(formEf.bonuses)}</dd></div>
                  <div><dt>Comisión</dt><dd>{usd(formEf.comision)}</dd></div>
                  <div><dt>Extras</dt><dd>{usd(formEf.extras)}</dd></div>
                </dl>
                <div className="pe-total__estado">
                  <span className="pe-ayuda">Estado</span>
                  <ChipSemaforo estado={form.pagado ? 'verde' : 'amarillo'} className="pe-estado">{form.pagado ? 'Pagado' : 'Pendiente'}</ChipSemaforo>
                </div>
                {errorDe('total') && <p className="pe-error" role="alert">{errorDe('total')}</p>}
              </div>
              {bloqueoComision && <div className="aviso-box" role="alert">⛔ {bloqueoComision}</div>}
              {error && <p className="pe-error pe-error--caja" role="alert">{erroresForm.length ? 'Revisá los campos marcados.' : `Error: ${error}`}</p>}
              {erroresSinCampo.length > 0 && <p className="pe-error">{erroresSinCampo.join(' ')}</p>}
              <div className="pe-acciones">
                <Boton variante="marca" type="submit" disabled={!!bloqueoComision}>{editandoId ? 'Guardar cambios' : 'Guardar línea'}</Boton>
                <Boton variante="secundario" onClick={cerrarForm}>Cancelar</Boton>
              </div>
            </aside>
          </form>
        </section>
      )}

      {vista === 'cierre' && (
        <section className="pe-seccion" aria-labelledby="pe-cierre-titulo">
          <div className="pe-filtros">
            <div className="pe-campo">
              <label htmlFor="pe-mes-cierre" id="pe-cierre-titulo">Cierre del mes</label>
              <select id="pe-mes-cierre" value={mesCierre} onChange={(e) => setMesCierre(e.target.value)}>
                {mesesCierre.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <p className="pe-ayuda">Lo que corresponde pagar a cada persona en el mes (suma de todas sus líneas). Las inactivas con líneas en el mes también aparecen.</p>
          </div>
          <div className="pe-kpis">
            <div className="pe-kpi pe-kpi--destacada"><span className="cj-etiqueta">Total a pagar</span><strong>{usd(cierre.totales.total)}</strong><small>{cierre.totales.lineas} líneas</small></div>
            <div className="pe-kpi"><span className="cj-etiqueta">Pagado</span><strong>{usd(cierre.totales.pagado)}</strong></div>
            <div className="pe-kpi"><span className="cj-etiqueta">Pendiente</span><strong>{usd(cierre.totales.pendiente)}</strong></div>
            <div className="pe-kpi"><span className="cj-etiqueta">Líneas</span><strong>{cierre.totales.lineas}</strong></div>
          </div>
          <div className="tabla-scroll">
            <table className="pe-tabla">
              <thead><tr><th>Persona</th><th>Rol</th><th>Área</th><th className="num">Honorarios</th><th className="num">Bonus</th><th className="num">Comisión</th><th className="num">Extras</th><th className="num">Total a pagar</th><th className="num">Pagado</th><th className="num">Pendiente</th><th>Estado</th><th className="num">Líneas</th><th><span className="sr-solo">Acciones</span></th></tr></thead>
              <tbody>
                {cierre.filas.map((f) => (
                  <tr key={f.persona_id ?? f.nombre} className={f.activo === false ? 'fila-inactiva' : ''}>
                    <td>{f.nombre}{f.activo === false && ' (inactiva)'}</td><td>{f.puesto}</td><td>{f.departamento}</td>
                    <td className="num">{usd(f.honorarios)}</td><td className="num">{usd(f.bonus)}</td><td className="num">{usd(f.comision)}</td><td className="num">{usd(f.extras)}</td><td className="num"><strong>{usd(f.total)}</strong></td><td className="num">{usd(f.pagado)}</td><td className="num">{usd(f.pendiente)}</td>
                    <td><ChipSemaforo estado={Number(f.pendiente) > 0 ? 'amarillo' : 'verde'} className="pe-estado">{Number(f.pendiente) > 0 ? 'Pendiente' : 'Pagado'}</ChipSemaforo></td>
                    <td className="num">{f.lineas}</td>
                    <td className="nowrap">{f.activo && <button type="button" onClick={() => abrirNueva(f.persona_id, mesCierre)}>Agregar línea</button>}</td>
                  </tr>
                ))}
                {cierre.filas.length === 0 && <tr><td colSpan={13} className="aviso">No hay líneas en {mesCierre}.</td></tr>}
              </tbody>
            </table>
          </div>
          {cierre.sinLinea.length > 0 && (
            <div className="aviso-box pe-sin-linea">
              <strong>Personas activas sin ninguna línea en {mesCierre} ({cierre.sinLinea.length}):</strong>{' '}
              {cierre.sinLinea.map((p) => <button key={p.id} type="button" onClick={() => abrirNueva(p.id, mesCierre)}>{p.nombre}</button>)}
              <div className="aviso">Es solo un aviso: puede que ese mes no les corresponda pago.</div>
            </div>
          )}
        </section>
      )}

      {vista === 'lineas' && <>
      <div className="pe-filtros" role="search" aria-label="Filtrar líneas">
        <div className="pe-campo">
          <label htmlFor="pe-f-mes">Mes</label>
          <select id="pe-f-mes" value={mes ?? ''} onChange={(e) => setMes(e.target.value)}>
            <option value="">Todos los meses</option>
            {meses.map((m) => (
              <option key={m} value={m}>{m.slice(0, 7)}</option>
            ))}
          </select>
        </div>
        <div className="pe-campo">
          <label htmlFor="pe-f-depto">Departamento</label>
          <select id="pe-f-depto" value={depto} onChange={(e) => setDepto(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {departamentos.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="pe-campo">
          <label htmlFor="pe-f-estado">Estado</label>
          <select id="pe-f-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Pagados y no pagados</option>
            <option value="pagados">Solo pagados</option>
            <option value="pendientes">Solo no pagados</option>
          </select>
        </div>
        <div className="pe-campo pe-campo--ancho">
          <label htmlFor="pe-f-buscar">Buscar</label>
          <input id="pe-f-buscar" type="search" placeholder="Nombre de la persona" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
      </div>

      <div className="pe-kpis">
        <div className="pe-kpi pe-kpi--destacada"><span className="cj-etiqueta">Total USD</span><strong>{usd(totales.total)}</strong><small>{totales.lineas} líneas</small></div>
        <div className="pe-kpi"><span className="cj-etiqueta">USD pagado</span><strong>{usd(totales.pagado)}</strong><small>{totales.lineasPagadas} líneas pagadas</small></div>
        <div className="pe-kpi"><span className="cj-etiqueta">USD pendiente</span><strong>{usd(totales.pendiente)}</strong><small>{totales.lineasPendientes} líneas pendientes</small></div>
        {totales.conArs > 0 && <div className="pe-kpi"><span className="cj-etiqueta">Total ARS</span><strong>{ars(totales.totalArs)}</strong><small>{totales.conArs} líneas con importe en pesos</small></div>}
      </div>

      <div className="pe-dos">
        <section className="pe-tarjeta pe-c8">
          <h3>Desglose</h3>
          <dl className="pe-desglose pe-desglose--fila">
            <div><dt>Honorarios</dt><dd>{usd(totales.honorarios)}</dd></div>
            <div><dt>Bonus</dt><dd>{usd(totales.bonuses)}</dd></div>
            <div><dt>Comisión</dt><dd>{usd(totales.comision)}</dd></div>
            <div><dt>Extras</dt><dd>{usd(totales.extras)}</dd></div>
          </dl>
        </section>
        <section className="pe-tarjeta pe-c4">
          <h3>Por departamento</h3>
          <table className="pe-tabla pe-tabla--compacta">
            <tbody>
              {porDepto.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="num">{usd(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="tabla-scroll">
        <table className="pe-tabla">
          <thead>
            <tr>
              <th><span className="sr-solo">Acciones</span></th><th>Mes</th><th>Persona</th><th>Puesto</th><th>Departamento</th><th className="num">Honorarios</th><th className="num">Bonus</th><th className="num">Comisión</th><th className="num">Extras</th><th className="num">Total</th><th>Moneda</th><th>Pagado</th><th>Pagado por</th><th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => (
              <tr key={l.id}>
                {/* Primera columna a propósito: así "Corregir" siempre se ve, sin tener que desplazar la tabla hacia la derecha */}
                <td className="nowrap">
                  {esImportado(l) && <button type="button" onClick={() => onCorregir && onCorregir({ tabla: 'pagos_equipo', id: l.id })}>Corregir</button>}
                  {!esImportado(l) && <button type="button" onClick={() => editarLinea(l)}>Editar</button>}
                  {!esImportado(l) && !l.pagado && <button type="button" className="quitar" onClick={() => borrarLinea(l)}>Borrar</button>}
                </td>
                <td className="nowrap"><Celda l={l} k="mes">{l.mes.slice(0, 7)}</Celda></td>
                <td>
                  {nombreDe(l)}
                  {nombreDe(l) !== l.nombre_original && <div className="aviso">en el Excel: {l.nombre_original}</div>}
                </td>
                <td><Celda l={l} k="puesto">{l.puesto}</Celda></td>
                <td><Celda l={l} k="departamento">{l.departamento}</Celda></td>
                <td className="num"><Celda l={l} k="honorarios_base">{usd(l.honorarios_base)}</Celda></td>
                <td className="num"><Celda l={l} k="bonuses">{usd(l.bonuses)}</Celda></td>
                <td className="num"><Celda l={l} k="comision">{usd(l.comision)}</Celda></td>
                <td className="num">{Number(l.extras) ? <span title={l.extras_detalle || ''}>{usd(l.extras)}</span> : '—'}</td>
                <td className="num">
                  <Celda l={l} k="total_usd"><strong>{usd(l.total_usd)}</strong></Celda>
                  {l.total_ars !== null && <div className="aviso">{ars(l.total_ars)}</div>}
                </td>
                <td title={l.moneda_original || ''}><Celda l={l} k="moneda">{l.moneda || ''}</Celda></td>
                <td>
                  <label className="pe-pagado">
                    <input type="checkbox" checked={l.pagado} onChange={(e) => actualizar(l.id, { pagado: e.target.checked })} aria-label="Pagado" />
                    <ChipSemaforo estado={l.pagado ? 'verde' : 'amarillo'} className="pe-estado">{l.pagado ? 'Pagado' : 'Pendiente'}</ChipSemaforo>
                  </label>
                </td>
                <td>
                  <select value={l.pagado_por || ''} onChange={(e) => actualizar(l.id, { pagado_por: e.target.value || null })} aria-label="Pagado por">
                    <option value="">—</option>
                    {OPCIONES_PAGADO_POR.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </td>
                <td className="nota">
                  {l.nota}{' '}
                  <button type="button" onClick={() => editarNota(l)} title="Editar nota" aria-label="Editar nota">✎</button>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && <tr><td colSpan={14} className="aviso">No hay líneas con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  )
}

// Campo con etiqueta visible, ayuda y error debajo (el error reemplaza a la ayuda y queda unido al control por aria-describedby)
function Campo({ campo, etiqueta, obligatorio = false, ayuda = null, error = null, className = '', children }) {
  return (
    <div className={`pe-campo ${className}${error ? ' pe-campo--error' : ''}`}>
      <label htmlFor={`pe-${campo}`}>{etiqueta}{obligatorio && <span className="pe-obligatorio" aria-hidden="true"> *</span>}</label>
      {children}
      {ayuda && !error && <p id={`pe-${campo}-ayuda`} className="pe-ayuda">{ayuda}</p>}
      {error && <p id={`pe-${campo}-error`} className="pe-error">{error}</p>}
    </div>
  )
}

// Importe con el prefijo USD dentro del campo y los números alineados a la derecha
function Monto({ children }) {
  return <div className="pe-monto"><span aria-hidden="true">USD</span>{children}</div>
}

// A qué campo corresponde cada mensaje de validarLinea (calculoPayroll.js). Lo que no tiene campo se muestra junto a los botones.
function campoDeError(t) {
  if (t.startsWith('Elegí una persona') || t.includes('está inactiva')) return 'persona_id'
  if (t.startsWith('Elegí el mes')) return 'mes'
  if (t.includes('importe de honorarios')) return 'honorarios_base'
  if (t.includes('importe de bonus')) return 'bonuses'
  if (t.includes('importe de comisión') || t.startsWith('Ya hay una comisión')) return 'comision'
  if (t.includes('importe de extras')) return 'extras'
  if (t.includes('Detalle de los extras')) return 'extras_detalle'
  if (t.includes('Pagado por')) return 'pagado_por'
  if (t.startsWith('El total')) return 'total'
  if (t.startsWith('Ya existe')) return 'confirmaAdicional'
  return null
}
