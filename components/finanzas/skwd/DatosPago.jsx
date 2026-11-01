import { useState } from 'react'
import { supabase } from './supabase'

// Editar los datos de pago de una persona (tabla personas_sensibles): CUIT/CUIL, teléfono, cuenta en pesos y en dólares.
// Pedido de Tomás (1/11/2026): «una sección donde puedas agregar o eliminar datos de pago, como lo teníamos antes».
// Solo se muestra a los correos autorizados (la base igual lo exige: RLS + trigger). «Eliminar» = dejar el campo vacío:
// la base no borra registros sensibles, guarda cada versión en personas_sensibles_historial y firma quién lo cambió.
const CAMPOS = [
  { campo: 'cuil_cuit', etiqueta: 'CUIT / CUIL', ayuda: 'Ej.: 20-12345678-9' },
  { campo: 'telefono', etiqueta: 'Teléfono', ayuda: 'Con característica: 54 9 11…' },
  { campo: 'direccion_pago_ars', etiqueta: 'Cuenta en pesos (ARS)', ayuda: 'CBU, CVU o alias' },
  { campo: 'direccion_pago_usd', etiqueta: 'Cuenta en dólares (USD)', ayuda: 'CBU en dólares, alias o billetera' },
]
const desde = (registro) => Object.fromEntries(CAMPOS.map(({ campo }) => [campo, registro?.[campo] ?? '']))

export default function DatosPago({ persona, registro, onGuardado }) {
  const [form, setForm] = useState(null) // null = cerrado
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar(e) {
    e.preventDefault()
    setError('')
    const datos = Object.fromEntries(CAMPOS.map(({ campo }) => [campo, form[campo].trim() === '' ? null : form[campo].trim()]))
    setGuardando(true)
    const r = registro
      ? await supabase.from('personas_sensibles').update(datos).eq('persona_id', persona.id).select('persona_id')
      : await supabase.from('personas_sensibles').insert({ persona_id: persona.id, ...datos, pendientes: {} }).select('persona_id')
    setGuardando(false)
    if (r.error) return setError(r.error.message)
    if (!r.data || r.data.length !== 1) return setError('No se guardó nada: tu usuario no tiene permiso para editar datos de pago.')
    setForm(null)
    onGuardado()
  }

  if (!form) return <p><button type="button" onClick={() => setForm(desde(registro))}>{registro ? 'Editar datos de pago' : 'Agregar datos de pago'}</button></p>

  return (
    <form onSubmit={guardar} className="form datos-pago">
      {CAMPOS.map(({ campo, etiqueta, ayuda }) => (
        <label key={campo}>{etiqueta}
          <input name={campo} value={form[campo]} placeholder={ayuda} autoComplete="off" onChange={(e) => setForm({ ...form, [campo]: e.target.value })} />
        </label>
      ))}
      <p className="aviso">Para eliminar un dato, dejá el campo vacío. Cada cambio queda en el historial con tu correo.</p>
      {error && <p className="error">Error: {error}</p>}
      <div className="acciones">
        <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar datos de pago'}</button>
        <button type="button" onClick={() => setForm(null)} disabled={guardando}>Cancelar</button>
      </div>
    </form>
  )
}
