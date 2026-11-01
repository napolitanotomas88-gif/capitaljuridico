import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave })
    setCargando(false)
    if (error) setError('No se pudo entrar. Revisá el email y la contraseña.')
  }

  return (
    <main className="app login">
      <div className="login-tarjeta">
        <img className="login-logo" src="/marca/capital-juridico-imagotipo-marfil.png" alt="Capital Jurídico" width="240" height="115" />
        <h1>Finanzas SKWD</h1>
        <h2>Iniciar sesión</h2>
        <form onSubmit={entrar} className="login-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required />
          </label>
          <button type="submit" disabled={cargando}>{cargando ? 'Entrando...' : 'Entrar'}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  )
}
