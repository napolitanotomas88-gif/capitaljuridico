import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { dolares, fechaCorta, mesLargo } from './formato'

// Registro de gastos de la empresa.
// - LEE de la vista gastos_vigentes (los datos con las correcciones aplicadas; sin correcciones es idéntica a la tabla gastos).
// - Gastos IMPORTADOS (con id_origen): sus datos originales no se editan ni se borran acá. Para cambiarlos se usa "Corregir"
//   (pestaña Correcciones), que conserva el original. No tienen campos de trabajo editables.
// - Gastos CREADOS EN LA WEB (sin id_origen): se crean, editan y borran normalmente en la tabla gastos.

const hoy = () => new Date().toISOString().slice(0, 10)
const vacio = () => ({ fecha: hoy(), concepto: '', monto_usd: '', tipo: '', departamento: '', cuenta: '' })
const filtrosVacios = { mes: '', tipo: '', departamento: '', cuenta: '', buscar: '' }
const usd = (n) => dolares(n)
const esImportado = (g) => g.id_origen !== null && g.id_origen !== undefined
const estaCorregido = (g, k) => !!(g.correcciones && k in g.correcciones)
const originalDe = (g, k) => (g.valores_originales && k in g.valores_originales ? g.valores_originales[k] : g[k])
const verOriginal = (v) => (v === null || v === undefined ? '(vacío)' : typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : String(v))

function paraGuardar(f) {
  const vacioANull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)
  return {
    fecha: f.fecha,
    concepto: f.concepto.trim(),
    monto_usd: Number(f.monto_usd),
    tipo: vacioANull(f.tipo),
    departamento: vacioANull(f.departamento),
    cuenta: vacioANull(f.cuenta),
  }
}

function desdeFila(g) {
  return {
    fecha: g.fecha,
    concepto: g.concepto ?? '',
    monto_usd: g.monto_usd ?? '',
    tipo: g.tipo ?? '',
    departamento: g.departamento ?? '',
    cuenta: g.cuenta ?? '',
  }
}

function agrupar(lista, clave) {
  const m = {}
  for (const g of lista) {
    const k = g[clave] || 'Sin ' + clave
    m[k] = (m[k] || 0) + Number(g.monto_usd)
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

export default function Gastos({ onCorregir }) {
  const [gastos, setGastos] = useState([])
  const [form, setForm] = useState(vacio())
  const [editandoId, setEditandoId] = useState(null)
  const [filtros, setFiltros] = useState(filtrosVacios)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function cargar() {
    const { data, error } = await supabase
      .from('gastos_vigentes')
      .select('*')
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .limit(5000)
    if (error) setError(error.message)
    else setGastos(data)
  }

  useEffect(() => {
    cargar()
  }, [])

  const opciones = useMemo(() => {
    const u = (k) => [...new Set(gastos.map((g) => g[k]).filter(Boolean))].sort()
    return {
      meses: [...new Set(gastos.map((g) => g.fecha.slice(0, 7)))].sort().reverse(),
      tipos: u('tipo'),
      departamentos: u('departamento'),
      cuentas: u('cuenta'),
    }
  }, [gastos])

  const visibles = useMemo(() => {
    const q = filtros.buscar.trim().toLowerCase()
    return gastos.filter(
      (g) =>
        (!filtros.mes || g.fecha.startsWith(filtros.mes)) &&
        (!filtros.tipo || g.tipo === filtros.tipo) &&
        (!filtros.departamento || g.departamento === filtros.departamento) &&
        (!filtros.cuenta || g.cuenta === filtros.cuenta) &&
        (!q || (g.concepto || '').toLowerCase().includes(q))
    )
  }, [gastos, filtros])

  const total = visibles.reduce((s, g) => s + Number(g.monto_usd), 0)
  const porTipo = useMemo(() => agrupar(visibles, 'tipo'), [visibles])
  const porDepartamento = useMemo(() => agrupar(visibles, 'departamento'), [visibles])
  const enEdicion = editandoId ? gastos.find((g) => g.id === editandoId) : null

  function cambiar(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  function cambiarFiltro(e) {
    setFiltros({ ...filtros, [e.target.name]: e.target.value })
  }

  function editar(g) {
    if (esImportado(g)) return // los gastos importados no se editan acá: se usa "Corregir"
    setEditandoId(g.id)
    setForm(desdeFila(g))
    setMensaje('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelar() {
    setEditandoId(null)
    setForm(vacio())
  }

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    if (enEdicion && esImportado(enEdicion)) {
      setError('Los gastos importados no se editan acá: usá "Corregir" (se conserva el original).')
      return
    }
    const datos = paraGuardar(form)
    const { error } = editandoId
      ? await supabase.from('gastos').update(datos).eq('id', editandoId)
      : await supabase.from('gastos').insert(datos)
    if (error) {
      setError(error.message)
      return
    }
    setMensaje(editandoId ? 'Gasto actualizado.' : 'Gasto guardado.')
    setEditandoId(null)
    setForm({ ...vacio(), fecha: form.fecha })
    cargar()
  }

  async function borrar(g) {
    if (esImportado(g)) return // los gastos importados no se borran
    if (!confirm(`¿Borrar el gasto "${g.concepto}" (${usd(g.monto_usd)})?`)) return
    const { error } = await supabase.from('gastos').delete().eq('id', g.id)
    if (error) setError(error.message)
    cargar()
  }

  const lista = (name, label, valores) => (
    <label>
      {label}
      <input name={name} value={form[name]} onChange={cambiar} list={`dlg-${name}`} />
      <datalist id={`dlg-${name}`}>
        {valores.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </label>
  )

  // Celda con la marca ✎ si el dato está corregido (al pasar el mouse se ve el original)
  const celda = (g, k, texto) =>
    estaCorregido(g, k) ? (
      <span className="corregido" title={`Original: ${verOriginal(originalDe(g, k))}`}>{texto} ✎</span>
    ) : (
      texto
    )

  return (
    <>
      <h2>{editandoId ? `Editando gasto #${editandoId}` : 'Cargar gasto'}</h2>
      <form onSubmit={guardar} className="form">
        <label>
          <span>Fecha<span className="pe-obligatorio" aria-hidden="true"> *</span></span>
          <input type="date" name="fecha" value={form.fecha} onChange={cambiar} required />
        </label>
        <label>
          <span>Concepto<span className="pe-obligatorio" aria-hidden="true"> *</span></span>
          <input name="concepto" value={form.concepto} onChange={cambiar} required />
        </label>
        <label>
          <span>Monto (en USD)<span className="pe-obligatorio" aria-hidden="true"> *</span></span>
          <input type="number" step="0.01" name="monto_usd" value={form.monto_usd} onChange={cambiar} required />
        </label>
        {lista('tipo', 'Tipo de gasto', opciones.tipos)}
        {lista('departamento', 'Departamento', opciones.departamentos)}
        <p className="pe-ayuda" style={{ gridColumn: '1 / -1' }}>Los campos con * son obligatorios. Tipo y departamento sugieren los valores ya usados: elegí uno de la lista para que el gasto sume en la categoría correcta.</p>
        <div className="acciones">
          <button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar gasto'}</button>
          {editandoId && (
            <button type="button" onClick={cancelar}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      <h2>Registro de gastos</h2>
      <div className="filtros">
        <select name="mes" aria-label="Filtrar por mes" value={filtros.mes} onChange={cambiarFiltro}>
          <option value="">Todos los meses</option>
          {opciones.meses.map((m) => (
            <option key={m} value={m}>{mesLargo(m)}</option>
          ))}
        </select>
        <select name="tipo" aria-label="Filtrar por tipo de gasto" value={filtros.tipo} onChange={cambiarFiltro}>
          <option value="">Todos los tipos</option>
          {opciones.tipos.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select name="departamento" aria-label="Filtrar por departamento" value={filtros.departamento} onChange={cambiarFiltro}>
          <option value="">Todos los departamentos</option>
          {opciones.departamentos.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select name="cuenta" aria-label="Filtrar por cuenta" value={filtros.cuenta} onChange={cambiarFiltro}>
          <option value="">Todas las cuentas</option>
          {opciones.cuentas.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input name="buscar" type="search" aria-label="Buscar gastos por concepto" placeholder="Buscar concepto" value={filtros.buscar} onChange={cambiarFiltro} />
        <button type="button" onClick={() => setFiltros(filtrosVacios)}>Limpiar filtros</button>
      </div>

      <p>
        <strong>{visibles.length}</strong> de {gastos.length} gastos — Total: <strong>{usd(total)}</strong>
      </p>

      <div className="resumenes">
        <div>
          <h3>Por tipo de gasto</h3>
          <table>
            <tbody>
              {porTipo.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{usd(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Por departamento</h3>
          <table>
            <tbody>
              {porDepartamento.map(([k, v]) => (
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
              <th>Fecha</th><th>Concepto</th><th>Monto</th><th>Tipo</th><th>Departamento</th><th>Cuenta</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((g) => (
              <tr key={g.id}>
                <td className="nowrap">{celda(g, 'fecha', fechaCorta(g.fecha))}</td>
                <td>{celda(g, 'concepto', g.concepto)}</td>
                <td>{celda(g, 'monto_usd', usd(g.monto_usd))}</td>
                <td>{celda(g, 'tipo', g.tipo)}</td>
                <td>{celda(g, 'departamento', g.departamento)}</td>
                <td>{celda(g, 'cuenta', g.cuenta)}</td>
                <td className="nowrap">
                  {esImportado(g) ? (
                    <button type="button" title="Gasto importado: se corrige en Correcciones y el dato original queda guardado" onClick={() => onCorregir && onCorregir({ tabla: 'gastos', id: g.id })}>Corregir</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => editar(g)}>Editar</button>{' '}
                      <button type="button" onClick={() => borrar(g)}>Borrar</button>
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
