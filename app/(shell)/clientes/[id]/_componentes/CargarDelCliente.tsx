'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui'

// «Cargar lo que dijo el cliente» (2/11/2026): el bot ya no lee los grupos de WhatsApp del cliente. Quien ve algo importante lo
// carga acá y entra al mismo flujo que antes:
//   · Señal de éxito (contento o buen resultado) → medidor de Éxito y, cuando corresponde, el pedido de OK del testimonio.
//   · Llegó el testimonio (el video) → agradecimiento con el Calendly para enviar (📤) y aviso a Gero M.
//   · Nota sobre los anuncios (zona, presupuesto, pausa, calidad de consultas…) → #📣-ads para Valentino.
// Lo que dijo sobre los guiones se carga en /guiones/<ID> («nota»), y los cambios u OK de un video en la tarjeta de Edición.
const TIPOS = [
  { v: 'exito', t: 'Señal de éxito (contento o buen resultado)' },
  { v: 'testimonio', t: 'Llegó el video de testimonio' },
  { v: 'anuncios', t: 'Nota sobre los anuncios' },
] as const

export function CargarDelCliente({ idCrm, nombre }: { idCrm: string; nombre: string }) {
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['v']>('exito')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null)
  async function cargar() {
    if (ocupado) return
    if (tipo !== 'testimonio' && texto.trim().length < 3) { setMsj({ ok: false, texto: 'Escribí lo que dijo el cliente.' }); return }
    setOcupado(true); setMsj(null)
    try {
      const r = await fetch(`/api/clientes/${encodeURIComponent(idCrm)}/cargar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tipo, texto: texto.trim(), nombre }) })
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string }
      setMsj({ ok: r.ok, texto: j.mensaje ?? (r.ok ? 'Cargado.' : 'No se pudo cargar.') })
      if (r.ok) setTexto('')
    } catch { setMsj({ ok: false, texto: 'Sin conexión: no se cargó.' }) } finally { setOcupado(false) }
  }
  return (
    <section id="cargar-del-cliente" className="cj-panel cj-pila cj-pila--chica" aria-label="Cargar lo que dijo el cliente">
      <h2>Cargar lo que dijo el cliente</h2>
      <p className="cj-texto-2">El bot ya no lee los grupos de WhatsApp: si el cliente dijo algo importante, cargalo acá.</p>
      <select className="cj-campo__entrada" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} aria-label="Qué pasó">
        {TIPOS.map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}
      </select>
      <textarea className="cj-campo__entrada" rows={3} maxLength={1500} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === 'testimonio' ? 'Opcional: dónde lo mandó' : 'Lo que escribió el cliente (copiado del grupo)'} aria-label="Texto" />
      <div><Boton disabled={ocupado} onClick={() => void cargar()}>{ocupado ? 'Cargando…' : 'Cargar'}</Boton></div>
      <div aria-live="polite">{msj && <p className={msj.ok ? 'cj-texto-2' : 'cj-aviso'}>{msj.texto}</p>}</div>
    </section>
  )
}
