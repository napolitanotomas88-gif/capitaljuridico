'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Boton } from '@/components/ui'
import { useConfirmacion } from '@/components/ui/Confirmacion'
import type { ItemAprobacion as Item } from '@/lib/clientes/aprobaciones'

// Un pedido para aprobar: el texto (el mismo que iba a Verificaciones C.J.), un campo opcional para lo que antes iba después
// del OK («sin Ana», «FINALIZADO», «sin mensaje», «A123») y los botones OK / NO / Hecho a mano. Clases de altas.css.
export function ItemAprobacion({ item, puede }: { item: Item; puede: boolean }) {
  const router = useRouter()
  const [resto, setResto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null)
  const [confirmar, dialogo] = useConfirmacion()

  async function responder(veredicto: 'ok' | 'no' | 'a_mano') {
    if (ocupado) return
    if (veredicto === 'a_mano' && !(await confirmar({ titulo: '¿Ya está hecho a mano?', detalle: 'El bot no va a mandar nada por este pedido y sale de la lista.', accion: 'Sí, está hecho a mano' }))) return
    if (ocupado) return
    setOcupado(true); setMsj(null)
    try {
      const r = await fetch('/api/clientes/aprobaciones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fuente: item.fuente, id: item.id, veredicto, resto: resto.trim() }) })
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string }
      setMsj({ ok: r.ok, texto: j.mensaje ?? (r.ok ? 'Listo.' : 'No se pudo guardar.') })
      if (r.ok) setTimeout(() => router.refresh(), 2500)
    } catch { setMsj({ ok: false, texto: 'Sin conexión: no se guardó.' }) } finally { setOcupado(false) }
  }

  return (
    <section id={`${item.fuente}-${item.id}`} className="cj-panel cj-altas__tarjeta" aria-label={`${item.titulo}: ${item.cliente}`}>
      <div className="cj-altas__cabeza">
        <h2 className="cj-altas__nombre">{item.cliente}</h2>
        <span className="cj-texto-2">{item.titulo} · {item.desde}{item.idCrm ? <> · <Link href={`/clientes/${item.idCrm}`} className="cj-enlace">{item.idCrm}</Link></> : null}</span>
      </div>
      <pre className="cj-altas__texto">{item.texto}</pre>
      {puede && (
        <>
          {item.ayudaResto && <input className="cj-campo__entrada" placeholder={item.ayudaResto} value={resto} onChange={(e) => setResto(e.target.value)} maxLength={300} aria-label={item.ayudaResto} />}
          <div className="cj-altas__botones">
            <Boton disabled={ocupado} onClick={() => void responder('ok')}>OK</Boton>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void responder('no')}>NO</Boton>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void responder('a_mano')}>Hecho a mano</Boton>
          </div>
        </>
      )}
      <div aria-live="polite">{msj && <p className={`cj-altas__resultado${msj.ok ? '' : ' cj-altas__resultado--error'}`}>{msj.texto}</p>}</div>
      {dialogo}
    </section>
  )
}
