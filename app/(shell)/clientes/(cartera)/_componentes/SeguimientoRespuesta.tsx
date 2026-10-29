'use client'
import { useState } from 'react'

export function SeguimientoRespuesta({ idCrm, demo }: { idCrm: string; demo: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState('equipo')
  const [cuando, setCuando] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (demo) { setMensaje('Los datos de ejemplo no generan cambios.'); return }
    setGuardando(true); setMensaje('')
    try {
      const r = await fetch('/api/clientes/inactivos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idCrm, tipo, cuando: cuando ? new Date(cuando).toISOString() : undefined }) }), j = await r.json()
      setMensaje(r.ok ? 'Seguimiento actualizado. Si pasan 3 días sin respuesta, el equipo recibe una alerta interna.' : j.mensaje ?? j.error ?? 'No se pudo registrar.')
      if (r.ok) setAbierto(false)
    } catch { setMensaje('No se pudo comprobar el resultado. Reintentá. No se envía ningún mensaje al cliente.') }
    finally { setGuardando(false) }
  }
  return <details className="ac-historial" open={abierto} onToggle={e => setAbierto(e.currentTarget.open)}><summary>Seguimiento de respuesta</summary><p className="cj-texto-2">Registrá una interacción real. Las alertas son internas; no se envían recordatorios al cliente.</p><form className="ac-forma" onSubmit={e => void guardar(e)}><label className="rc-campo"><span className="cj-etiqueta">Qué pasó</span><select className="rc-input" value={tipo} onChange={e => setTipo(e.target.value)}><option value="equipo">Le escribimos: esperamos respuesta</option><option value="cliente">El cliente respondió</option><option value="resuelta">La espera ya está resuelta</option></select></label><label className="rc-campo"><span className="cj-etiqueta">Cuándo (vacío = ahora)</span><input className="rc-input" type="datetime-local" value={cuando} onChange={e => setCuando(e.target.value)} /></label><button className="cj-boton" disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar'}</button></form>{mensaje && <p role="status">{mensaje}</p>}</details>
}
