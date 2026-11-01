import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { armarPersona, validarPersona, consolidarSensibles, textoMeses, fichaPermanente, autorizacionDesdeSondeo, etiquetaOrigen } from './calculoEquipo'

const mask = (v) => (v ? '••••' + String(v).slice(-4) : '—')
const fechaCorta = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '—')
const usd = (n) => '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })

// El historial lee pagos_equipo_vigentes (valores con correcciones). Las celdas corregidas llevan ✎ y el original al pasar el mouse.
// Datos sensibles (separados, ocultos por defecto), SOLO LECTURA y solo si la autorización está confirmada:
//   - permanentes: personas_sensibles (+ su historial). La base los entrega solo a los correos autorizados (RLS).
//   - históricos por mes: pagos_equipo_sensibles, solo como referencia (nunca se escriben).
// Sin autorización confirmada no se lee ni se muestra ningún dato sensible.
const estaCorregido = (l, k) => !!l.correcciones && Object.prototype.hasOwnProperty.call(l.correcciones, k)
const verOriginal = (l, k) => {
  const v = l.valores_originales?.[k]
  if (v === null || v === undefined || v === '') return '(vacío)'
  if (k === 'mes') return String(v).slice(0, 7)
  return k === 'total_usd' ? usd(v) : String(v)
}
function Celda({ l, k, children }) {
  if (!estaCorregido(l, k)) return <>{children}</>
  return <span className="corregido" title={`Original: ${verOriginal(l, k)}`}>{children} ✎</span>
}

function Detalle({ persona, autorizado, onCerrar, onCambioActivo, onEditar }) {
  const [lineas, setLineas] = useState([])
  const [sens, setSens] = useState([])
  const [registro, setRegistro] = useState(null) // fila de personas_sensibles de esta persona (solo si la autorización está confirmada)
  const [historial, setHistorial] = useState([]) // versiones de personas_sensibles_historial (solo lectura)
  const [mostrar, setMostrar] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    setMostrar(false)
    setSens([])
    setRegistro(null)
    setHistorial([])
    ;(async () => {
      const { data, error } = await supabase
        .from('pagos_equipo_vigentes')
        .select('id, mes, nombre_original, puesto, departamento, total_usd, pagado, pagado_por, nota, correcciones, valores_originales')
        .eq('persona_id', persona.id)
        .order('mes', { ascending: false })
      if (!vivo) return
      if (error) return setError(error.message)
      setLineas(data)
      // Sin autorización CONFIRMADA no se lee ningún dato sensible (ni permanente ni histórico).
      if (autorizado !== true) return
      const [rp, rh] = await Promise.all([
        supabase
          .from('personas_sensibles')
          .select('persona_id, cuil_cuit, telefono, direccion_pago_ars, direccion_pago_usd, pendientes, origen, nota_origen, creado_en, actualizado_en, actualizado_por')
          .eq('persona_id', persona.id),
        supabase
          .from('personas_sensibles_historial')
          .select('id, cambiado_en, cambiado_por, operacion, cuil_cuit, telefono, direccion_pago_ars, direccion_pago_usd')
          .eq('persona_id', persona.id)
          .order('id', { ascending: false }),
      ])
      if (!vivo) return
      if (rp.error) setError(rp.error.message)
      else setRegistro(rp.data?.[0] ?? null)
      if (rh.error) setError(rh.error.message)
      else setHistorial(rh.data ?? [])
      if (data.length) {
        const r = await supabase.from('pagos_equipo_sensibles').select('*').in('pago_equipo_id', data.map((l) => l.id))
        if (!vivo) return
        if (r.error) setError(r.error.message)
        else setSens(r.data)
      }
    })()
    return () => {
      vivo = false
      setSens([]) // al cerrar o cambiar de persona se descartan los datos sensibles
      setRegistro(null)
      setHistorial([])
    }
  }, [persona.id, autorizado])

  const porLinea = Object.fromEntries(sens.map((s) => [s.pago_equipo_id, s]))
  const conDatos = lineas.filter((l) => porLinea[l.id])
  const campo = (v) => (mostrar ? v || '—' : mask(v))
  // Vista consolidada (solo para mostrar): un valor por campo; si hay valores distintos se listan todos con sus meses. No escribe ni elige nada.
  const consolidado = useMemo(() => consolidarSensibles(lineas, sens), [lineas, sens])
  // Ficha permanente (solo para mostrar). Sin autorización confirmada no contiene ningún valor.
  const ficha = useMemo(() => fichaPermanente({ autorizado, registro, consolidadoHistorico: consolidado }), [autorizado, registro, consolidado])

  return (
    <section className="detalle">
      <div className="detalle-cab">
        <h2>{persona.nombre}</h2>
        <button type="button" onClick={onCerrar}>Cerrar detalle</button>
      </div>
      {error && <p className="error">Error: {error}</p>}

      <h3>Datos de la persona</h3>
      <ul className="datos">
        <li><strong>Puesto:</strong> {persona.puesto || '—'}</li>
        <li><strong>Departamento:</strong> {persona.departamento || '—'}</li>
        <li><strong>Estado:</strong> {persona.activo ? 'Activo' : 'Inactivo'}{' '}
          <button type="button" onClick={() => onCambioActivo(persona)}>{persona.activo ? 'Quitar' : 'Reactivar'}</button>{' '}
          <button type="button" onClick={() => onEditar(persona)}>Editar perfil</button>
        </li>
        <li><strong>Otros nombres en el Excel:</strong> {persona.apodos || '—'}</li>
        <li><strong>Notas:</strong> {persona.notas || '—'}</li>
      </ul>

      <h3>Datos sensibles <span className="aviso">(separados, ocultos por defecto)</span></h3>
      {autorizado === null && <p className="aviso">Comprobando autorización…</p>}
      {autorizado === false && (
        <p className="aviso">No se muestran datos sensibles: no se pudo confirmar que tu usuario esté autorizado para verlos.</p>
      )}
      {autorizado === true && (
        <>
          <p>
            <button type="button" onClick={() => setMostrar(!mostrar)}>{mostrar ? 'Ocultar datos' : 'Mostrar datos'}</button>{' '}
            <span className="aviso">{ficha.estado === 'sin_registro' ? 'Esta persona no tiene registro permanente' : 'Registro permanente de la persona (solo lectura)'}</span>
          </p>

          <h4>Datos permanentes</h4>
          <ul className="datos">
            {ficha.campos.map((f) => (
              <li key={f.campo}>
                <strong>{f.etiqueta}:</strong>{' '}
                {f.estado === 'completo' && campo(f.valor)}
                {(f.estado === 'vacio' || f.estado === 'sin_registro') && '—'}
                {f.estado === 'pendiente' && (
                  <>
                    <span className="et et-revisar">⚠ Pendiente de revisión: {f.motivo}</span>
                    {f.candidatos.length > 0 && (
                      <ul>
                        {f.candidatos.map((v) => (
                          <li key={v.valor}>
                            {campo(v.valor)}{' '}
                            <span className="aviso">· valor histórico en {textoMeses(v.meses)}{v.masReciente ? ' · el más reciente' : ''} · no se eligió ninguno</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {mostrar && ficha.estado === 'con_registro' && (
            <p className="aviso">
              Origen: {etiquetaOrigen(ficha.origen)} · Última modificación: {fechaCorta(ficha.actualizadoEn)} por {ficha.actualizadoPor || '—'}
            </p>
          )}

          <details>
            <summary>Historial de cambios ({historial.length})</summary>
            {historial.length === 0 ? (
              <p className="aviso">Sin versiones registradas.</p>
            ) : (
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Fecha</th><th>Operación</th><th>Por</th><th>CUIL/CUIT</th><th>Teléfono</th><th>Dirección ARS</th><th>Dirección USD</th></tr>
                  </thead>
                  <tbody>
                    {historial.map((h) => (
                      <tr key={h.id}>
                        <td>{fechaCorta(h.cambiado_en)}</td>
                        <td>{h.operacion === 'alta' ? 'Versión inicial' : 'Cambio'}</td>
                        <td>{mostrar ? h.cambiado_por : '••••'}</td>
                        <td>{campo(h.cuil_cuit)}</td>
                        <td>{campo(h.telefono)}</td>
                        <td>{campo(h.direccion_pago_ars)}</td>
                        <td>{campo(h.direccion_pago_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>

          <details>
            <summary>Origen histórico por mes (referencia; no se modifica)</summary>
            <p className="aviso">{conDatos.length === 0 ? 'Sin datos sensibles mensuales cargados' : `Cargados en ${conDatos.length} mes(es); abajo se muestran una sola vez por campo`}</p>
      {conDatos.length > 0 && (
        <>
          <ul className="datos">
            {consolidado.map((c) => (
              <li key={c.campo}>
                <strong>{c.etiqueta}:</strong>{' '}
                {c.estado === 'sin_datos' && '—'}
                {c.estado === 'unico' && (
                  <>
                    {campo(c.valores[0].valor)}{' '}
                    <span className="aviso">· figura en {textoMeses(c.valores[0].meses)}{c.valores[0].variantes.length > 1 ? ` · escrito de ${c.valores[0].variantes.length} formas en distintos meses (ver detalle)` : ''}</span>
                  </>
                )}
                {c.estado === 'varios' && (
                  <>
                    <span className="et et-revisar">⚠ {c.valores.length} valores distintos — revisar</span>
                    <ul>
                      {c.valores.map((v) => (
                        <li key={v.valor}>
                          {campo(v.valor)}{' '}
                          <span className="aviso">· {textoMeses(v.meses)}{v.masReciente ? ' · es el más reciente' : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
          <details>
            <summary>Ver detalle por mes</summary>
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr><th>Mes</th><th>CUIL/CUIT</th><th>Teléfono</th><th>Dirección ARS</th><th>Dirección USD</th></tr>
                </thead>
                <tbody>
                  {conDatos.map((l) => {
                    const s = porLinea[l.id]
                    return (
                      <tr key={l.id}>
                        <td>{l.mes.slice(0, 7)}</td>
                        <td>{campo(s.cuil_cuit)}</td>
                        <td>{campo(s.telefono)}</td>
                        <td>{campo(s.direccion_pago_ars)}</td>
                        <td>{campo(s.direccion_pago_usd)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
          </details>
        </>
      )}

      <h3>Historial de pagos</h3>
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr><th>Mes</th><th>Nombre en el Excel</th><th>Puesto</th><th>Departamento</th><th>Total</th><th>Pagado</th><th>Pagado por</th></tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id}>
                <td><Celda l={l} k="mes">{l.mes.slice(0, 7)}</Celda></td>
                <td>{l.nombre_original}</td>
                <td><Celda l={l} k="puesto">{l.puesto}</Celda></td>
                <td><Celda l={l} k="departamento">{l.departamento}</Celda></td>
                <td><Celda l={l} k="total_usd">{usd(l.total_usd)}</Celda></td>
                <td>{l.pagado ? 'Sí' : 'No'}</td>
                <td>{l.pagado_por || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Equipo() {
  const [personas, setPersonas] = useState([])
  const [filtro, setFiltro] = useState('todos')
  const [buscar, setBuscar] = useState('')
  const [abiertoId, setAbiertoId] = useState(null)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [form, setForm] = useState(null) // null = cerrado · { id: null | número, nombre, puesto, departamento, apodos, notas }
  // Autorización para ver datos sensibles: null = comprobando · true = confirmada · false = no autorizado o no confirmado (falla cerrada).
  const [autorizado, setAutorizado] = useState(null)
  const [marcas, setMarcas] = useState({}) // persona_id -> cantidad de campos pendientes (SIN valores); solo con autorización confirmada

  async function cargar() {
    const { data, error } = await supabase.from('personas').select('*').order('nombre')
    if (error) setError(error.message)
    else setPersonas(data)
  }

  // La base devuelve personas_sensibles solo a los correos autorizados (a los demás, 0 filas sin error). Solo se piden persona_id y pendientes.
  async function sondearAutorizacion() {
    const { data, error } = await supabase.from('personas_sensibles').select('persona_id, pendientes')
    const ok = autorizacionDesdeSondeo(data, error)
    setAutorizado(ok)
    setMarcas(ok ? Object.fromEntries(data.map((r) => [r.persona_id, r.pendientes && typeof r.pendientes === 'object' ? Object.keys(r.pendientes).length : 0])) : {})
  }

  // Alta / edición del perfil (nombre, rol, área, otros nombres y notas). Los datos sensibles NO se tocan acá.
  function abrirForm(p = null) {
    setError('')
    setMensaje('')
    setForm(p ? { id: p.id, nombre: p.nombre ?? '', puesto: p.puesto ?? '', departamento: p.departamento ?? '', apodos: p.apodos ?? '', notas: p.notas ?? '' } : { id: null, nombre: '', puesto: '', departamento: '', apodos: '', notas: '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function guardarPersona(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    const v = validarPersona(form, personas, form.id)
    if (v.errores.length) return setError(v.errores.join(' '))
    const datos = armarPersona(form)
    if (form.id) {
      const { data, error } = await supabase.from('personas').update(datos).eq('id', form.id).select('id')
      if (error) return setError(error.message)
      if (!data || data.length !== 1) return setError('No se pudo actualizar el perfil (no se modificó nada).')
      setMensaje(`Perfil de ${datos.nombre} actualizado.`)
    } else {
      const { data, error } = await supabase.from('personas').insert({ ...datos, activo: true }).select('id')
      if (error) return setError(error.message)
      if (!data || data.length !== 1) return setError('No se pudo confirmar que la persona se guardó. Recargá la página y revisá la lista antes de volver a cargarla.')
      setMensaje(`Persona ${datos.nombre} agregada (activa).`)
    }
    setForm(null)
    cargar()
  }

  useEffect(() => {
    cargar()
    sondearAutorizacion()
  }, [])

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return personas.filter(
      (p) =>
        (filtro === 'todos' || (filtro === 'activos' ? p.activo : !p.activo)) &&
        (!q || [p.nombre, p.puesto, p.departamento, p.apodos].some((v) => (v || '').toLowerCase().includes(q)))
    )
  }, [personas, filtro, buscar])

  // Agregar y quitar rápido (pedido de Tomás, 1/11/2026: «tiene que estar rápido para agregar o quitar personas»).
  // Quitar: si la persona no tiene ningún pago cargado, se borra (fue un alta de más); si tiene, pasa a Inactiva y conserva
  // su historial. Sin ventanas de confirmación: cada cambio deja un «Deshacer» en el mensaje.
  const [deshacer, setDeshacer] = useState(null) // { texto, accion: () => Promise }
  const [rapida, setRapida] = useState({ nombre: '', puesto: '', departamento: '' })
  const [guardandoRapida, setGuardandoRapida] = useState(false)

  async function agregarRapida(e) {
    e.preventDefault()
    if (guardandoRapida) return
    setError('')
    setMensaje('')
    setDeshacer(null)
    const v = validarPersona({ ...rapida, apodos: '', notas: '' }, personas, null)
    if (v.errores.length) return setError(v.errores.join(' '))
    setGuardandoRapida(true)
    const datos = armarPersona({ ...rapida, apodos: '', notas: '' })
    const { data, error } = await supabase.from('personas').insert({ ...datos, activo: true }).select('id')
    setGuardandoRapida(false)
    if (error) return setError(error.message)
    if (!data || data.length !== 1) return setError('No se pudo confirmar que la persona se guardó. Recargá la página y revisá la lista antes de volver a cargarla.')
    const id = data[0].id
    setMensaje(`${datos.nombre} agregada (activa).`)
    setDeshacer({ texto: 'Deshacer', accion: async () => supabase.from('personas').delete().eq('id', id) })
    setRapida({ nombre: '', puesto: '', departamento: '' })
    cargar()
  }

  async function quitar(p) {
    setError('')
    setMensaje('')
    setDeshacer(null)
    const { data: lineas, error: e1 } = await supabase.from('pagos_equipo').select('id, pagado, total_usd').eq('persona_id', p.id).limit(500)
    if (e1) return setError(`No se pudo comprobar el historial de ${p.nombre}: ${e1.message}. No se cambió nada.`)
    if (!lineas.length) {
      const { data: copia } = await supabase.from('personas').select('*').eq('id', p.id)
      const { error } = await supabase.from('personas').delete().eq('id', p.id)
      if (error) {
        // Tiene datos asociados (por ejemplo, datos sensibles): queda inactiva en vez de borrarse
        return cambiarActivo(p)
      }
      const fila = copia?.[0]
      setMensaje(`${p.nombre} quitada (no tenía pagos cargados).`)
      if (fila) {
        const { id: _id, creado_en: _c, ...resto } = fila
        setDeshacer({ texto: 'Deshacer', accion: async () => supabase.from('personas').insert(resto) })
      }
      if (abiertoId === p.id) setAbiertoId(null)
      return cargar()
    }
    return cambiarActivo(p, lineas)
  }

  // Activo / Inactivo (baja lógica reversible). Al pasar a inactiva se avisa de sus líneas pendientes de pago.
  async function cambiarActivo(p, lineas = null) {
    setError('')
    setDeshacer(null)
    const { data, error } = await supabase.from('personas').update({ activo: !p.activo }).eq('id', p.id).select('id')
    if (error) return setError(error.message)
    if (!data || data.length !== 1) return setError('No se pudo cambiar el estado (no se modificó nada).')
    let texto = `${p.nombre} ahora está ${p.activo ? 'inactiva (conserva su historial de pagos)' : 'activa'}.`
    if (p.activo) {
      const pend = (lineas ?? []).filter((l) => !l.pagado)
      if (pend.length) texto += ` Ojo: tiene ${pend.length} pago(s) pendiente(s) por ${usd(pend.reduce((s, l) => s + Number(l.total_usd || 0), 0))}; se pueden pagar igual.`
    }
    setMensaje(texto)
    setDeshacer({ texto: 'Deshacer', accion: async () => supabase.from('personas').update({ activo: p.activo }).eq('id', p.id) })
    cargar()
  }

  async function hacerDeshacer() {
    const d = deshacer
    if (!d) return
    setDeshacer(null)
    const { error } = await d.accion()
    if (error) setError(`No se pudo deshacer: ${error.message}`)
    else setMensaje('Listo, se deshizo el último cambio.')
    cargar()
  }

  const abierta = personas.find((p) => p.id === abiertoId)

  return (
    <>
      <h2>Equipo</h2>
      {error && <p className="error">Error: {error}</p>}
      {mensaje && (
        <p className="ok">
          {mensaje}{' '}
          {deshacer && <button type="button" onClick={hacerDeshacer}>{deshacer.texto}</button>}
        </p>
      )}
      <form onSubmit={agregarRapida} className="alta-rapida" aria-label="Agregar persona">
        <input placeholder="Nombre y apellido" value={rapida.nombre} onChange={(e) => setRapida({ ...rapida, nombre: e.target.value })} aria-label="Nombre y apellido" />
        <input placeholder="Rol" value={rapida.puesto} onChange={(e) => setRapida({ ...rapida, puesto: e.target.value })} aria-label="Rol" />
        <input placeholder="Área" value={rapida.departamento} onChange={(e) => setRapida({ ...rapida, departamento: e.target.value })} aria-label="Área" />
        <button type="submit" disabled={guardandoRapida || !rapida.nombre.trim()}>{guardandoRapida ? 'Agregando…' : '+ Agregar'}</button>
        <button type="button" className="secundario" onClick={() => abrirForm()} disabled={!!form && !form.id}>Más datos…</button>
      </form>
      <p className="aviso">Quitar: si la persona no tiene pagos cargados se borra; si tiene, pasa a Inactiva y conserva su historial. Todo se puede deshacer.</p>
      {form && (
        <section className="detalle">
          <h3>{form.id ? `Editando el perfil de ${form.nombre || 'la persona'}` : 'Nueva persona'}</h3>
          <form onSubmit={guardarPersona} className="form">
            <label>Nombre y apellido<input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></label>
            <label>Rol (puesto)<input value={form.puesto} onChange={(e) => setForm({ ...form, puesto: e.target.value })} /></label>
            <label>Área (departamento)<input value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} /></label>
            <label>Otros nombres en Pagos (apodos, separados por coma)<input value={form.apodos} onChange={(e) => setForm({ ...form, apodos: e.target.value })} placeholder="Ej.: Mai" /></label>
            <label>Notas<input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></label>
            <p className="aviso">Los apodos son los nombres con los que figura en la pestaña Pagos como closer o setter: sirven para calcularle comisiones sin adivinar. Cada apodo debe pertenecer a una sola persona.</p>
            <div className="acciones">
              <button type="submit">{form.id ? 'Guardar cambios' : 'Agregar persona'}</button>
              <button type="button" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </form>
        </section>
      )}
      <div className="filtros">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="todos">Todas las personas</option>
          <option value="activos">Solo activas</option>
          <option value="inactivos">Solo inactivas</option>
        </select>
        <input placeholder="Buscar nombre, puesto o departamento" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      <p>
        <strong>{visibles.length}</strong> de {personas.length} personas — Activas: <strong>{personas.filter((p) => p.activo).length}</strong>
      </p>

      <div className="tabla-scroll">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Rol</th><th>Área</th><th>Otros nombres</th><th>Estado</th>{autorizado === true && <th>Datos permanentes</th>}<th></th></tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} className={(p.activo ? '' : 'fila-inactiva ') + (p.id === abiertoId ? 'fila-abierta' : '')}>
                <td>{p.nombre}</td>
                <td>{p.puesto}</td>
                <td>{p.departamento}</td>
                <td>{p.apodos}</td>
                <td className="nowrap">{p.activo ? '● Activa' : '○ Inactiva'}</td>
                {autorizado === true && <td>{p.id in marcas ? (marcas[p.id] > 0 ? `${marcas[p.id]} campo(s) pendiente(s)` : 'Con registro') : 'Sin registro'}</td>}
                <td className="nowrap">
                  <button type="button" onClick={() => setAbiertoId(p.id)}>Ver detalle</button>{' '}
                  <button type="button" onClick={() => abrirForm(p)}>Editar</button>{' '}
                  {p.activo
                    ? <button type="button" className="quitar" onClick={() => quitar(p)}>Quitar</button>
                    : <button type="button" onClick={() => cambiarActivo(p)}>Reactivar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {abierta && <Detalle persona={abierta} autorizado={autorizado} onCerrar={() => setAbiertoId(null)} onCambioActivo={(p) => (p.activo ? quitar(p) : cambiarActivo(p))} onEditar={abrirForm} />}
    </>
  )
}
