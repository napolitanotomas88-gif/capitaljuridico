'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'

// «Es incumplimiento» / «No corresponde» de un hallazgo a verificar (capturas, guiones, crudos). Usa las clases de altas.css.
export function Verificar({ id, resumen }: { id: number; resumen: string }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [descartar, setDescartar] = useState(false)

  async function accion(a: 'confirmar' | 'descartar') {
    if (ocupado) return
    if (a === 'descartar' && motivo.trim().length < 3) { setMsj({ ok: false, texto: 'Escribí por qué no corresponde.' }); return }
    setOcupado(true); setMsj(null)
    try {
      const r = await fetch(`/api/clientes/controles/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: a, motivo: a === 'descartar' ? motivo.trim() : undefined }) })
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string; mensajeId?: number }
      setMsj({ ok: r.ok, texto: j.mensaje ?? (r.ok ? 'Listo.' : 'No se pudo guardar.') })
      if (r.ok && j.mensajeId) setTimeout(() => router.push(`/clientes/para-enviar#m-${j.mensajeId}`), 1000)
      else if (r.ok) setTimeout(() => router.refresh(), 1000)
    } catch { setMsj({ ok: false, texto: 'Sin conexión: no se guardó.' }) } finally { setOcupado(false) }
  }

  return (
    <span>
      <span className="cj-altas__botones">
        <Boton disabled={ocupado} onClick={() => { if (confirm(`¿Confirmás que es incumplimiento? Se arma el aviso para el cliente (${resumen}).`)) void accion('confirmar') }}>{ocupado ? 'Guardando…' : 'Es incumplimiento'}</Boton>
        <Boton variante="secundario" disabled={ocupado} onClick={() => setDescartar((x) => !x)}>No corresponde</Boton>
      </span>
      {descartar && (
        <span className="cj-altas__botones">
          <input className="cj-campo__entrada" placeholder="Motivo (p. ej.: no hubo conversaciones ese día)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} aria-label="Motivo" />
          <Boton variante="secundario" disabled={ocupado} onClick={() => void accion('descartar')}>Confirmar</Boton>
        </span>
      )}
      <span aria-live="polite">{msj && <span className={`cj-altas__resultado${msj.ok ? '' : ' cj-altas__resultado--error'}`}>{msj.texto}</span>}</span>
    </span>
  )
}
