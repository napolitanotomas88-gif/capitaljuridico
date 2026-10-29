'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'
export function Entrega({ tanda, previo, url }: { tanda: number; previo: string; url: string }) {
  const router = useRouter()
  const [confirmo, setConfirmo] = useState(false), [ocupado, setOcupado] = useState(false), [mensaje, setMensaje] = useState('')
  async function entregar() {
    if (!confirmo || ocupado) return
    setOcupado(true)
    try {
      const r = await fetch('/api/clientes/entregas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tanda, previo, confirmacion: true }) })
      const j = await r.json().catch(() => ({}))
      setMensaje(j.mensaje ?? (r.ok ? 'Entrega registrada.' : 'No se pudo registrar.'))
      if (r.ok) router.refresh()
    } catch { setMensaje('Sin conexión: la entrega no se registró.') } finally { setOcupado(false) }
  }
  return <div className="cj-pila">
    <p><a href={url} target="_blank" rel="noreferrer" className="cj-enlace">Abrir documento de guiones</a></p>
    <p><button type="button" className="cj-enlace" onClick={async () => { try { await navigator.clipboard.writeText(url); setMensaje('Link copiado. Enviáselo al cliente y después confirmá la entrega.') } catch { setMensaje('No se pudo copiar automáticamente. Abrí el documento para compartir su enlace.') } }}>Copiar link para el cliente</button></p>
    <label><input type="checkbox" checked={confirmo} onChange={e => setConfirmo(e.target.checked)} /> Ya envié al cliente el link de esta versión aprobada.</label>
    <Boton disabled={!confirmo || ocupado} onClick={() => void entregar()}>{ocupado ? 'Guardando…' : 'Confirmar entrega'}</Boton>
    {mensaje && <p role="status">{mensaje}</p>}
  </div>
}
