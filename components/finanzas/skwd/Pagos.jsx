import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

// Registro de pagos.
// - LEE de la vista pagos_vigentes (los datos con las correcciones aplicadas; sin correcciones es idéntica a la tabla pagos).
// - Pagos IMPORTADOS (con id_origen): sus datos originales no se editan acá. Para cambiarlos se usa "Corregir" (pestaña Correcciones),
//   que conserva el original. Solo se pueden cambiar los campos de trabajo: revisar y nota_revision. No se pueden borrar.
// - Pagos CREADOS EN LA WEB (sin id_origen): se crean, editan y borran normalmente en la tabla pagos.
// - «Quién recibió» (Gero, Tomi, Financiera o Empresa) se guarda en la tabla aparte pago_quien_recibio (una fila por pago).
//   Un pago sin fila es «Sin asignar». Nunca se asigna automáticamente. En pagos importados se puede asignar y cambiar de opción
//   (sin tocar sus campos originales) pero no quitar. Para borrar un pago web hay que quitar antes su asignación.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const nombreMes = (fecha) => `${fecha.slice(0, 4)}-${MESES[Number(fecha.slice(5, 7)) - 1]}`
const hoy = () => new Date().toISOString().slice(0, 10)

// Campos del formulario de carga. Programa, Pesos ARS, Comisión (pasarela) y CAT-CASH ya no se cargan desde acá:
// las columnas y los datos históricos se conservan (se siguen mostrando/corrigiendo donde corresponde), solo no se piden en pagos nuevos.
const vacio = () => ({
  fecha: hoy(),
  cliente: '',
  telefono: '',
  monto_usd: '',
  moneda_original: 'USD',
  closer: '',
  setter: '',
  comprobante: '',
  concepto: '',
  fuente: '',
  tipo_venta: '',
  tipo_pago: '',
  revisar: false,
  nota_revision: '',
})

const QUIENES = ['Gero', 'Tomi', 'Financiera', 'Empresa']
const DESDE_PERSONALES = '2026-10-01' // desde esta fecha los pagos asignados a Gero o Tomi se usarán en Gastos Personales
const numeros = ['monto_usd']
const filtrosVacios = { mes: '', concepto: '', fuente: '', closer: '', quien: '', buscar: '', soloRevisar: false }

function paraGuardar(f) {
  const out = { mes: nombreMes(f.fecha) }
  for (const k of Object.keys(vacio())) {
    if (k === 'revisar') out[k] = f[k]
    else if (numeros.includes(k)) out[k] = f[k] === '' || f[k] === null ? null : Number(f[k])
    else out[k] = typeof f[k] === 'string' && f[k].trim() === '' ? null : f[k]
  }
  out.fecha = f.fecha
  out.cliente = f.cliente.trim()
  out.moneda_original = f.moneda_original // sin el campo Pesos en el formulario, la moneda original se conserva tal cual
  return out
}

function desdeFila(p) {
  const f = vacio()
  for (const k of Object.keys(f)) f[k] = p[k] ?? (k === 'revisar' ? false : k === 'moneda_original' ? 'USD' : '')
  return f
}

const usd = (n) => '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const esImportado = (p) => p.id_origen !== null && p.id_origen !== undefined
const estaCorregido = (p, k) => !!(p.correcciones && k in p.correcciones)
const originalDe = (p, k) => (p.valores_originales && k in p.valores_originales ? p.valores_originales[k] : p[k])
const verOriginal = (v) => (v === null || v === undefined ? '(vacío)' : typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : String(v))

export default function Pagos({ onCorregir }) {
  const [pagos, setPagos] = useState([])
  const [asignaciones, setAsignaciones] = useState({}) // pago_id -> 'Gero' | 'Tomi' | 'Financiera' | 'Empresa' (sin entrada = Sin asignar)
  const [form, setForm] = useState(vacio())
  const [quien, setQuien] = useState('') // selector «Quién recibió» del formulario ('' = Sin asignar)
  const [editandoId, setEditandoId] = useState(null)
  const [filtros, setFiltros] = useState(filtrosVacios)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function cargar() {
    const [p, a] = await Promise.all([
      supabase.from('pagos_vigentes').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(5000),
      supabase.from('pago_quien_recibio').select('pago_id, quien').limit(5000),
    ])
    if (p.error) setError(p.error.message)
    else setPagos(p.data)
    if (a.error) setError(`No se pudo leer «Quién recibió»: ${a.error.message}`)
    else setAsignaciones(Object.fromEntries(a.data.map((x) => [x.pago_id, x.quien])))
  }

  useEffect(() => {
    cargar()
  }, [])

  const opciones = useMemo(() => {
    const u = (k) => [...new Set(pagos.map((p) => p[k]).filter(Boolean))].sort()
    return {
      meses: [...new Set(pagos.map((p) => p.fecha.slice(0, 7)))].sort().reverse(),
      conceptos: u('concepto'),
      fuentes: u('fuente'),
      closers: u('closer'),
      setters: u('setter'),
      tiposVenta: u('tipo_venta'),
      tiposPago: u('tipo_pago'),
    }
  }, [pagos])

  const visibles = useMemo(() => {
    const q = filtros.buscar.trim().toLowerCase()
    return pagos.filter(
      (p) =>
        (!filtros.mes || p.fecha.startsWith(filtros.mes)) &&
        (!filtros.concepto || p.concepto === filtros.concepto) &&
        (!filtros.fuente || p.fuente === filtros.fuente) &&
        (!filtros.closer || p.closer === filtros.closer) &&
        (!filtros.quien || (filtros.quien === 'sin' ? !asignaciones[p.id] : asignaciones[p.id] === filtros.quien)) &&
        (!filtros.soloRevisar || p.revisar) &&
        (!q || [p.cliente, p.telefono, p.comprobante].some((v) => (v || '').toLowerCase().includes(q)))
    )
  }, [pagos, filtros, asignaciones])

  const total = visibles.reduce((s, p) => s + Number(p.monto_usd), 0)
  // Solo informativo: no asigna ni modifica nada
  const sinAsignarDesdeOctubre = pagos.filter((p) => p.fecha >= DESDE_PERSONALES && !asignaciones[p.id])
  const enEdicion = editandoId ? pagos.find((p) => p.id === editandoId) : null
  const editaImportado = !!enEdicion && esImportado(enEdicion)

  function cambiar(e) {
    const { name, value, type, checked } = e.target
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value })
  }

  function cambiarFiltro(e) {
    const { name, value, type, checked } = e.target
    setFiltros({ ...filtros, [name]: type === 'checkbox' ? checked : value })
  }

  function editar(p) {
    setEditandoId(p.id)
    setForm(desdeFila(p))
    setQuien(asignaciones[p.id] ?? '')
    setMensaje('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelar() {
    setEditandoId(null)
    setForm(vacio())
    setQuien('')
  }

  // Guarda «Quién recibió» en la tabla aparte pago_quien_recibio. Devuelve '' si salió bien o el mensaje de error.
  // Nunca toca la tabla pagos. Explícito (insert / update / delete), sin upsert, y verifica que el cambio se haya aplicado.
  async function guardarAsignacion(pagoId, nuevo, actual, importado) {
    if ((nuevo || '') === (actual || '')) return ''
    if (!nuevo) {
      if (importado) return 'La asignación de un pago importado no se puede quitar: elegí otra opción.'
      const { data, error } = await supabase.from('pago_quien_recibio').delete().eq('pago_id', pagoId).select('pago_id')
      if (error) return error.message
      return data && data.length === 1 ? '' : 'No se pudo quitar la asignación.'
    }
    if (!QUIENES.includes(nuevo)) return 'Valor de «Quién recibió» no válido.'
    if (!actual) {
      const { error } = await supabase.from('pago_quien_recibio').insert({ pago_id: pagoId, quien: nuevo })
      return error ? error.message : ''
    }
    const { data, error } = await supabase.from('pago_quien_recibio').update({ quien: nuevo }).eq('pago_id', pagoId).select('pago_id')
    if (error) return error.message
    return data && data.length === 1 ? '' : 'No se pudo cambiar la asignación.'
  }

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    let pagoId = editandoId
    let textoOk
    if (editaImportado) {
      // Pago importado: SOLO campos de trabajo (revisar y nota_revision). Los datos originales se cambian con "Corregir".
      // Si solo cambió «Quién recibió», la tabla pagos no se toca.
      const nota = form.nota_revision.trim() === '' ? null : form.nota_revision.trim()
      if (form.revisar !== enEdicion.revisar || nota !== (enEdicion.nota_revision ?? null)) {
        const r = await supabase.from('pagos').update({ revisar: form.revisar, nota_revision: nota }).eq('id', editandoId)
        if (r.error) {
          setError(r.error.message)
          return
        }
      }
      textoOk = 'Revisión actualizada.'
    } else if (editandoId) {
      const r = await supabase.from('pagos').update(paraGuardar(form)).eq('id', editandoId)
      if (r.error) {
        setError(r.error.message)
        return
      }
      textoOk = 'Pago actualizado.'
    } else {
      const r = await supabase.from('pagos').insert(paraGuardar(form)).select('id').single()
      if (r.error) {
        setError(r.error.message)
        return
      }
      pagoId = r.data.id
      textoOk = 'Pago guardado.'
    }
    // «Quién recibió»: tabla aparte. Si falla, el pago ya quedó guardado y queda «Sin asignar» (o con su asignación anterior).
    const fallo = await guardarAsignacion(pagoId, quien, asignaciones[pagoId], editaImportado)
    if (fallo) {
      setError(`${textoOk.replace('.', '')}, pero no se pudo guardar «Quién recibió»: ${fallo.replace(/\.?$/, '.')} Editá el pago para reintentarlo.`)
    } else {
      setMensaje(textoOk)
    }
    setEditandoId(null)
    setForm({ ...vacio(), fecha: form.fecha })
    setQuien('')
    cargar()
  }

  async function borrar(p) {
    if (esImportado(p)) return // los pagos importados no se borran
    if (!confirm(`¿Borrar el pago de ${p.cliente} (${usd(p.monto_usd)})?`)) return
    setError('')
    setMensaje('')
    // Primero se quita la asignación (la base no deja borrar un pago que todavía la tiene) y se verifica que se quitó.
    if (asignaciones[p.id]) {
      const { data, error } = await supabase.from('pago_quien_recibio').delete().eq('pago_id', p.id).select('pago_id')
      if (error || !data || data.length !== 1) {
        setError(`No se borró el pago: no se pudo quitar antes su asignación de «Quién recibió»${error ? ` (${error.message})` : ''}. No se perdió ningún dato.`)
        cargar()
        return
      }
    }
    const { error } = await supabase.from('pagos').delete().eq('id', p.id)
    if (error) {
      // El pago no se borró: se intenta devolver su asignación para no perder ese dato.
      let restaurada = true
      if (asignaciones[p.id]) {
        const r = await supabase.from('pago_quien_recibio').insert({ pago_id: p.id, quien: asignaciones[p.id] })
        restaurada = !r.error
      }
      setError(`El pago no se pudo borrar: ${error.message}. El pago sigue guardado${asignaciones[p.id] ? (restaurada ? ' y se restauró su «Quién recibió».' : ` pero quedó «Sin asignar»: volvé a elegir «${asignaciones[p.id]}» editándolo.`) : '.'}`)
      cargar()
      return
    }
    setMensaje('Pago borrado.')
    cargar()
  }

  async function alternarRevisar(p) {
    const { error } = await supabase.from('pagos').update({ revisar: !p.revisar }).eq('id', p.id)
    if (error) setError(error.message)
    cargar()
  }

  const campo = (name, label, props = {}) => (
    <label>
      {label}
      <input name={name} value={form[name]} onChange={cambiar} {...props} />
    </label>
  )

  const lista = (name, label, valores) => (
    <label>
      {label}
      <input name={name} value={form[name]} onChange={cambiar} list={`dl-${name}`} />
      <datalist id={`dl-${name}`}>
        {valores.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </label>
  )

  // Selector de «Quién recibió». En un pago importado que ya tiene asignación no se ofrece «Sin asignar» (no se puede quitar).
  const selectorQuien = (importado) => (
    <label>
      Quién recibió
      <select name="quien" value={quien} onChange={(e) => setQuien(e.target.value)}>
        {!(importado && editandoId && asignaciones[editandoId]) && <option value="">Sin asignar</option>}
        {QUIENES.map((q) => (
          <option key={q} value={q}>{q}</option>
        ))}
      </select>
    </label>
  )

  // Celda con la marca ✎ si el dato está corregido (al pasar el mouse se ve el original)
  const celda = (p, k, texto) =>
    estaCorregido(p, k) ? (
      <span className="corregido" title={`Original: ${verOriginal(originalDe(p, k))}`}>{texto} ✎</span>
    ) : (
      texto
    )

  return (
    <>
      <h2>{editandoId ? (editaImportado ? `Revisión del pago #${editandoId} (importado)` : `Editando pago #${editandoId}`) : 'Cargar pago'}</h2>
      {editaImportado ? (
        <form onSubmit={guardar} className="form">
          <p className="aviso" style={{ gridColumn: '1 / -1' }}>
            Este pago es <strong>importado</strong>: sus datos originales no se editan acá. Para cambiar un dato usá <strong>Corregir</strong> (se conserva el original).
            Desde acá solo se pueden cambiar los campos de trabajo y «Quién recibió», que se guarda aparte y no modifica el pago (se puede cambiar de opción, no quitar).
          </p>
          {selectorQuien(true)}
          <label className="check">
            <input type="checkbox" name="revisar" checked={form.revisar} onChange={cambiar} /> Marcar para revisar
          </label>
          {campo('nota_revision', 'Nota de revisión')}
          <div className="acciones">
            <button type="submit">Guardar revisión</button>
            <button type="button" onClick={cancelar}>Cancelar</button>
          </div>
        </form>
      ) : (
        <form onSubmit={guardar} className="form">
          {campo('fecha', 'Fecha', { type: 'date', required: true })}
          {campo('cliente', 'Cliente', { required: true })}
          {campo('telefono', 'Teléfono')}
          {campo('monto_usd', 'Efectivo recaudado (USD)', { type: 'number', step: '0.01', required: true })}
          {lista('concepto', 'Concepto', opciones.conceptos)}
          {lista('fuente', 'Fuente', opciones.fuentes)}
          {lista('closer', 'Closer', opciones.closers)}
          {lista('setter', 'Setter', opciones.setters)}
          {lista('tipo_venta', 'Tipo de venta', opciones.tiposVenta)}
          {lista('tipo_pago', 'Tipo de pago', opciones.tiposPago)}
          {campo('comprobante', 'Comprobante')}
          {selectorQuien(false)}
          <label className="check">
            <input type="checkbox" name="revisar" checked={form.revisar} onChange={cambiar} /> Marcar para revisar
          </label>
          {campo('nota_revision', 'Nota de revisión')}
          <div className="acciones">
            <button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar pago'}</button>
            {editandoId && (
              <button type="button" onClick={cancelar}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      <h2>Registro de pagos</h2>
      <div className="filtros">
        <select name="mes" value={filtros.mes} onChange={cambiarFiltro}>
          <option value="">Todos los meses</option>
          {opciones.meses.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select name="concepto" value={filtros.concepto} onChange={cambiarFiltro}>
          <option value="">Todos los conceptos</option>
          {opciones.conceptos.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select name="fuente" value={filtros.fuente} onChange={cambiarFiltro}>
          <option value="">Todas las fuentes</option>
          {opciones.fuentes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select name="closer" value={filtros.closer} onChange={cambiarFiltro}>
          <option value="">Todos los closers</option>
          {opciones.closers.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select name="quien" value={filtros.quien} onChange={cambiarFiltro}>
          <option value="">Todos (quién recibió)</option>
          <option value="sin">Sin asignar</option>
          {QUIENES.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
        <input name="buscar" placeholder="Buscar cliente, teléfono o comprobante" value={filtros.buscar} onChange={cambiarFiltro} />
        <label className="check">
          <input type="checkbox" name="soloRevisar" checked={filtros.soloRevisar} onChange={cambiarFiltro} /> Solo para revisar
        </label>
        <button type="button" onClick={() => setFiltros(filtrosVacios)}>Limpiar filtros</button>
      </div>

      <p>
        <strong>{visibles.length}</strong> de {pagos.length} pagos — Total: <strong>{usd(total)}</strong>
      </p>
      <p className="aviso">
        Pagos desde el 1/10/2026 sin «Quién recibió»: <strong>{sinAsignarDesdeOctubre.length}</strong>
        {sinAsignarDesdeOctubre.length > 0 && ' (usá el filtro «Sin asignar» para verlos)'}. Es solo informativo: nada se asigna automáticamente.
      </p>

      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Cliente</th><th>USD</th><th>Pesos ARS</th><th>Concepto</th><th>Fuente</th><th>Closer</th><th>Setter</th><th>Quién recibió</th><th>Revisar</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} className={p.revisar ? 'fila-revisar' : ''}>
                <td>{celda(p, 'fecha', p.fecha)}</td>
                <td>{celda(p, 'cliente', p.cliente)}</td>
                <td>{celda(p, 'monto_usd', usd(p.monto_usd))}</td>
                <td>{celda(p, 'pesos_ars', p.pesos_ars !== null ? Number(p.pesos_ars).toLocaleString('es-AR') : '')}</td>
                <td>{celda(p, 'concepto', p.concepto)}</td>
                <td>{celda(p, 'fuente', p.fuente)}</td>
                <td>{celda(p, 'closer', p.closer)}</td>
                <td>{celda(p, 'setter', p.setter)}</td>
                <td>{asignaciones[p.id] ?? <em className="aviso">Sin asignar</em>}</td>
                <td title={p.nota_revision || ''}>
                  <button type="button" onClick={() => alternarRevisar(p)}>{p.revisar ? '⚑ Sí' : '—'}</button>
                </td>
                <td className="nowrap">
                  {esImportado(p) ? (
                    <>
                      <button type="button" onClick={() => onCorregir && onCorregir({ tabla: 'pagos', id: p.id })}>Corregir</button>{' '}
                      <button type="button" onClick={() => editar(p)}>Revisión / Quién recibió</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => editar(p)}>Editar</button>{' '}
                      <button type="button" onClick={() => borrar(p)}>Borrar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
