import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import ResumenPersonales from './ResumenPersonales'
import { clasificar, EJECUTORES, GASTO_DE, TIPOS } from './calculoPersonales'

// Gastos Personales: MÓDULO INDEPENDIENTE. Escribe SOLO la tabla gastos_personales.
// Además LEE (solo select) pagos_vigentes y pago_quien_recibio para sumar los ingresos recibidos por Gero y Tomi desde el 1/10/2026.
// No escribe nada en Pagos ni en «Quién recibió», y no afecta Pagos, Gastos, Cuentas, Estado de Resultados ni Dashboard.

const hoy = () => new Date().toISOString().slice(0, 10)
const vacio = () => ({ fecha: hoy(), ejecutado_por: 'Gero A.', tipo_gasto: 'Personal', gasto_de: 'Para ambos', monto_usd: '', descripcion: '' })
const fmt = (n) => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function GastosPersonales() {
  const [vista, setVista] = useState('movimientos')
  const [gastos, setGastos] = useState([])
  const [form, setForm] = useState(vacio())
  const [editandoId, setEditandoId] = useState(null)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [ingresos, setIngresos] = useState(null) // { pagos, asignaciones } (solo lectura) o null si no se pudo leer
  const [errorIngresos, setErrorIngresos] = useState('Leyendo ingresos…')

  async function cargar() {
    // Los ingresos («Quién recibió») se leen de Pagos SOLO PARA CONSULTA: pagos_vigentes y pago_quien_recibio, únicamente con select.
    const [g, p, a] = await Promise.all([
      supabase.from('gastos_personales').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(5000),
      supabase.from('pagos_vigentes').select('id, fecha, monto_usd, cliente').limit(5000),
      supabase.from('pago_quien_recibio').select('pago_id, quien').limit(5000),
    ])
    if (g.error) setError(g.error.message)
    else setGastos(g.data)
    // Si falla cualquiera de las dos lecturas (o podría estar incompleta), no hay ingresos confiables: el saldo combinado no se muestra como definitivo.
    if (p.error || a.error) {
      setIngresos(null)
      setErrorIngresos(`No se pudieron leer los ingresos (${[p.error && `pagos: ${p.error.message}`, a.error && `«Quién recibió»: ${a.error.message}`].filter(Boolean).join('; ')}).`)
    } else if (p.data.length >= 5000 || a.data.length >= 5000) {
      setIngresos(null)
      setErrorIngresos('La lectura de ingresos puede estar incompleta (demasiados registros).')
    } else {
      setIngresos({ pagos: p.data, asignaciones: a.data })
      setErrorIngresos('')
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value })
  const aviso = useMemo(() => {
    const c = clasificar({ ejecutado_por: form.ejecutado_por, gasto_de: form.gasto_de })
    return c.estado === 'revisar' ? c.motivo : ''
  }, [form.ejecutado_por, form.gasto_de])

  function editar(id) {
    const g = gastos.find((x) => x.id === id)
    if (!g) return
    setEditandoId(id)
    setForm({ fecha: g.fecha, ejecutado_por: g.ejecutado_por, tipo_gasto: g.tipo_gasto, gasto_de: g.gasto_de, monto_usd: String(g.monto_usd), descripcion: g.descripcion ?? '' })
    setVista('movimientos')
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
    const monto = Number(form.monto_usd)
    if (!Number.isFinite(monto) || monto <= 0) return setError('El monto debe ser un número mayor que 0.')
    const datos = { fecha: form.fecha, ejecutado_por: form.ejecutado_por, tipo_gasto: form.tipo_gasto, gasto_de: form.gasto_de, monto_usd: monto, descripcion: form.descripcion.trim() || null }
    const { error } = editandoId ? await supabase.from('gastos_personales').update(datos).eq('id', editandoId) : await supabase.from('gastos_personales').insert(datos)
    if (error) return setError(error.message)
    setMensaje(editandoId ? 'Gasto personal actualizado.' : 'Gasto personal guardado.')
    setEditandoId(null)
    setForm({ ...vacio(), fecha: form.fecha, ejecutado_por: form.ejecutado_por })
    cargar()
  }

  async function borrar(g) {
    if (!window.confirm(`¿Borrar el gasto personal de ${fmt(g.monto_usd)}${g.descripcion ? ` ("${g.descripcion}")` : ''}?`)) return
    const { error } = await supabase.from('gastos_personales').delete().eq('id', g.id)
    if (error) setError(error.message)
    if (editandoId === g.id) cancelar()
    cargar()
  }

  const total = gastos.reduce((s, g) => s + Number(g.monto_usd), 0)

  return (
    <>
      <h2>Gastos Personales</h2>
      <nav className="subtabs">
        <button type="button" onClick={() => setVista('resumen')} disabled={vista === 'resumen'}>Resumen y balance</button>
        <button type="button" onClick={() => setVista('movimientos')} disabled={vista === 'movimientos'}>Movimientos ({gastos.length})</button>
      </nav>
      {error && <p className="error">Error: {error}</p>}
      {mensaje && <p className="ok">{mensaje}</p>}

      {vista === 'resumen' && <ResumenPersonales gastos={gastos} ingresos={ingresos} errorIngresos={errorIngresos} onEditar={editar} />}

      {vista === 'movimientos' && (
        <>
          <h3>{editandoId ? `Editando gasto personal #${editandoId}` : 'Cargar gasto personal'}</h3>
          <form onSubmit={guardar} className="form">
            <label>Fecha<input type="date" name="fecha" value={form.fecha} onChange={cambiar} required /></label>
            <label>Ejecutado por<select name="ejecutado_por" value={form.ejecutado_por} onChange={cambiar}>{EJECUTORES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Tipo de gasto<select name="tipo_gasto" value={form.tipo_gasto} onChange={cambiar}>{TIPOS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Gasto de<select name="gasto_de" value={form.gasto_de} onChange={cambiar}>{GASTO_DE.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Monto (USD)<input name="monto_usd" type="number" step="0.01" min="0" value={form.monto_usd} onChange={cambiar} required /></label>
            <label>Descripción (opcional)<input name="descripcion" value={form.descripcion} onChange={cambiar} /></label>
            <div className="acciones">
              <button type="submit">{editandoId ? 'Guardar cambios' : 'Guardar gasto personal'}</button>
              {editandoId && <button type="button" onClick={cancelar}>Cancelar</button>}
            </div>
          </form>
          {aviso && <div className="aviso-box">⚠ {aviso} Si lo guardás así quedará <strong>"A revisar"</strong> y fuera del balance.</div>}

          <h3>Gastos personales ({gastos.length}) — Total registrado: {fmt(total)}</h3>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>Fecha</th><th>Ejecutado por</th><th>Tipo</th><th>Gasto de</th><th>Monto</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {gastos.map((g) => {
                  const c = clasificar(g)
                  return (
                    <tr key={g.id} className={(c.estado === 'revisar' ? 'fila-revisar ' : '') + (g.id === editandoId ? 'fila-abierta' : '')}>
                      <td>{g.fecha}</td><td>{g.ejecutado_por}</td><td>{g.tipo_gasto}</td><td>{g.gasto_de}</td><td>{fmt(g.monto_usd)}</td><td>{g.descripcion}</td>
                      <td>{c.estado === 'revisar' ? <span className="et et-revisar" title={c.motivo}>⚑ A REVISAR</span> : ''}</td>
                      <td className="nowrap"><button type="button" onClick={() => editar(g.id)}>Editar</button> <button type="button" onClick={() => borrar(g)}>Borrar</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
