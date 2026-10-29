'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'
import { LARGO_COMENTARIO, MIN_COMENTARIO_CAMBIOS, type ClaveRevisor, type EstadoPedidoRevision } from '@/lib/bot/kickoff/revision'
import { enviarKickoff } from './enviar'

// Revisión de las ideas de guiones por quien entró (Tomi o Gero M: lo decide el servidor con la sesión, revisorDeSesion):
// aprobar, pedir cambios (con comentario obligatorio) o deshacer lo propio. Cada uno toca SOLO su revisión. Manda el
// `cuando` de lo que se ve (previo) y la HUELLA de las ideas que se están viendo: si el bot las rehízo mientras tanto, el
// servidor responde «ideas_cambiaron», no escribe y se recarga (nadie aprueba ideas que no leyó). Pedir cambios avisa al
// otro revisor por Discord. En el ejemplo (?demo=1) se elige "probar como" Tomi o Gero M y nada sale de la pantalla.
export interface RevisorPropio {
  clave: ClaveRevisor
  nombre: string
  estado: 'pendiente' | 'aprobada' | 'cambios'
  comentario: string
  cuandoTexto: string | null
  previo: string | null
}

type Props = { idCliente: string; recordingId: number; revisores: RevisorPropio[]; huella: string; demo: boolean }

const clave = (rs: RevisorPropio[], huella: string) => `${huella}|${rs.map(r => `${r.clave}:${r.estado}:${r.previo ?? ''}`).join('|')}`

export function RevisionIdeas({ idCliente, recordingId, revisores, huella, demo }: Props) {
  const router = useRouter()
  const idComentario = useId()
  const [lista, setLista] = useState(revisores)
  const [visto, setVisto] = useState(clave(revisores, huella))
  if (visto !== clave(revisores, huella)) { setVisto(clave(revisores, huella)); setLista(revisores) }
  const [como, setComo] = useState<ClaveRevisor>(revisores[0]?.clave ?? 'tomi')
  const [abierto, setAbierto] = useState(false)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [msj, setMsj] = useState<{ texto: string; error: boolean } | null>(null)
  const yo = lista.find(r => r.clave === como) ?? lista[0]
  if (!yo) return null

  const cambiar = (nuevo: Partial<RevisorPropio>) => setLista(xs => xs.map(r => (r.clave === yo.clave ? { ...r, ...nuevo } : r)))

  async function enviar(estado: EstadoPedidoRevision) {
    if (enviando) return
    const texto = estado === 'cambios' ? comentario.trim() : ''
    if (estado === 'cambios' && texto.length < MIN_COMENTARIO_CAMBIOS) {
      setMsj({ texto: 'Escribí qué cambiar antes de mandar el pedido.', error: true })
      return
    }
    if (demo) {
      cambiar({ estado, comentario: texto, cuandoTexto: estado === 'pendiente' ? null : 'recién', previo: new Date().toISOString() })
      setAbierto(false)
      setComentario('')
      setMsj({ texto: 'Ejemplo: no se guarda.', error: false })
      return
    }
    setEnviando(true)
    setMsj(null)
    const r = await enviarKickoff(idCliente, { accion: 'revision', recording_id: recordingId, estado, comentario: texto, huella: estado === 'pendiente' ? '' : huella, previo: yo.previo })
    setEnviando(false)
    if (r.ok) {
      // Deshacer también deja una marca (queda el historial): el próximo cambio va con ese `cuando`
      cambiar({ estado, comentario: texto, cuandoTexto: estado === 'pendiente' ? null : 'recién', previo: r.cuando ?? yo.previo })
      setAbierto(false)
      setComentario('')
      setMsj({ texto: r.mensaje, error: false })
      router.refresh()
    } else {
      setMsj({ texto: r.mensaje, error: true })
      if (r.codigo === 'conflicto' || r.codigo === 'ideas_cambiaron') router.refresh()
    }
  }

  const cuando = yo.cuandoTexto ? ` (${yo.cuandoTexto})` : ''
  return (
    <div className="ko-revision">
      {demo && lista.length > 1 && (
        <div className="ko-revision__quien" role="group" aria-label="Probar como">
          <span className="cj-etiqueta">Probar como</span>
          {lista.map(r => (
            <button key={r.clave} type="button" className="cj-chip" aria-pressed={r.clave === yo.clave} onClick={() => { setComo(r.clave); setAbierto(false); setMsj(null) }}>
              {r.nombre}
            </button>
          ))}
        </div>
      )}
      <p className="ko-dato__texto">
        {yo.estado === 'aprobada' && `${demo ? `${yo.nombre} las aprobó` : 'Las aprobaste'}${cuando}.`}
        {yo.estado === 'cambios' && `${demo ? `${yo.nombre} pidió cambios` : 'Pediste cambios'}${cuando}: «${yo.comentario}»`}
        {yo.estado === 'pendiente' && (demo ? `${yo.nombre} todavía no las revisó.` : 'Todavía no revisaste estas ideas.')}
      </p>
      {!abierto && (
        <div className="ko-revision__acciones">
          {yo.estado !== 'aprobada' && <Boton onClick={() => enviar('aprobada')} disabled={enviando}>Aprobar las ideas</Boton>}
          {yo.estado !== 'cambios' && <Boton variante="secundario" onClick={() => { setAbierto(true); setMsj(null) }} disabled={enviando}>Pedir cambios</Boton>}
          {yo.estado !== 'pendiente' && <Boton variante="secundario" onClick={() => enviar('pendiente')} disabled={enviando}>Deshacer</Boton>}
        </div>
      )}
      {abierto && (
        <form className="ko-revision__form" onSubmit={e => { e.preventDefault(); void enviar('cambios') }}>
          <label htmlFor={idComentario}>
            <span className="cj-etiqueta">Qué cambiar (obligatorio: le llega al otro revisor por Discord)</span>
            <textarea id={idComentario} value={comentario} maxLength={LARGO_COMENTARIO} required minLength={MIN_COMENTARIO_CAMBIOS} disabled={enviando}
              onChange={e => setComentario(e.target.value)} placeholder="Qué idea cambiar y por qué (por ejemplo: «la N no va porque…», «en la N, el gancho más corto»)" />
          </label>
          <div className="ko-revision__acciones">
            <Boton type="submit" disabled={enviando}>Mandar el pedido</Boton>
            <Boton variante="secundario" onClick={() => { setAbierto(false); setComentario('') }} disabled={enviando}>Cancelar</Boton>
          </div>
        </form>
      )}
      <p role="status" aria-live="polite" className={msj?.error ? 'ko-msj ko-msj--error' : 'ko-msj'}>{enviando ? 'Guardando…' : msj?.texto ?? ''}</p>
    </div>
  )
}
