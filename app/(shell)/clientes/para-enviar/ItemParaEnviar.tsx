'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Boton } from '@/components/ui'

// Un mensaje «para enviar»: el texto listo para copiar, el link a la pantalla de la pieza y los botones «Enviado» y
// «No corresponde» (con motivo). Usa las clases de «Cargar alta» (altas.css), sin estilos propios.
export type MensajeVista = {
  id: number; pieza: string; titulo: string; grupo: string; cliente: string; idCrm: string | null; texto: string
  abrir: string | null; adjuntos: string[]; desde: string; responsables: string
}

export function ItemParaEnviar({ m }: { m: MensajeVista }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [descartar, setDescartar] = useState(false)

  async function copiar() {
    try { await navigator.clipboard.writeText(m.texto); setMsj({ ok: true, texto: 'Texto copiado: pegalo en el grupo del cliente.' }) }
    catch { setMsj({ ok: false, texto: 'No se pudo copiar automáticamente: seleccioná el texto y copialo.' }) }
  }

  async function accion(a: 'enviado' | 'descartar') {
    if (ocupado) return
    if (a === 'descartar' && motivo.trim().length < 3) { setMsj({ ok: false, texto: 'Escribí por qué no corresponde.' }); return }
    setOcupado(true); setMsj(null)
    try {
      const r = await fetch(`/api/clientes/para-enviar/${m.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: a, motivo: a === 'descartar' ? motivo.trim() : undefined }) })
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string }
      setMsj({ ok: r.ok, texto: j.mensaje ?? (r.ok ? 'Listo.' : 'No se pudo guardar.') })
      if (r.ok) setTimeout(() => router.refresh(), 1200)
    } catch { setMsj({ ok: false, texto: 'Sin conexión: no se guardó.' }) } finally { setOcupado(false) }
  }

  return (
    <section id={`m-${m.id}`} className="cj-panel cj-altas__tarjeta" aria-label={`${m.titulo} para ${m.cliente}`}>
      <div className="cj-altas__cabeza">
        <h2 className="cj-altas__nombre">{m.cliente}</h2>
        <span className="cj-texto-2">{m.titulo} · grupo {m.grupo} · {m.desde}{m.responsables ? ` · ${m.responsables}` : ''}</span>
      </div>
      <pre className="cj-altas__texto">{m.texto}</pre>
      {m.adjuntos.length > 0 && <ul className="cj-altas__lista">{m.adjuntos.map((a) => <li key={a}>Adjuntá: <a href={a} target="_blank" rel="noreferrer" className="cj-enlace">{a}</a></li>)}</ul>}
      <div className="cj-altas__botones">
        <Boton variante="secundario" onClick={() => void copiar()}>Copiar texto</Boton>
        {m.abrir && <Link href={m.abrir} className="cj-enlace">Abrir</Link>}
        <Boton disabled={ocupado} onClick={() => { if (confirm(`¿Ya lo mandaste al grupo ${m.grupo} de ${m.cliente}?`)) void accion('enviado') }}>{ocupado ? 'Guardando…' : 'Enviado'}</Boton>
        <Boton variante="secundario" disabled={ocupado} onClick={() => setDescartar((x) => !x)}>No corresponde</Boton>
      </div>
      {descartar && (
        <div className="cj-altas__botones">
          <input className="cj-campo__entrada" placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} aria-label="Motivo" />
          <Boton variante="secundario" disabled={ocupado} onClick={() => void accion('descartar')}>Confirmar</Boton>
        </div>
      )}
      <div aria-live="polite">{msj && <p className={`cj-altas__resultado${msj.ok ? '' : ' cj-altas__resultado--error'}`}>{msj.texto}</p>}</div>
    </section>
  )
}
