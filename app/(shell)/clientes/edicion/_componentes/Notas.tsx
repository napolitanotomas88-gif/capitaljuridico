'use client'

import { useId, useState } from 'react'
import { ETIQUETA_TIPO_NOTA } from '@/lib/edicion/etiquetas'
import { LARGO_NOTA_VIDEO, LARGO_URL, leerTiempo } from '@/lib/edicion/pedido'
import { TIPOS_NOTA, type TipoNota } from '@/lib/edicion/tipos'
import type { FilaNota, VistaVideo } from '@/lib/edicion/vista'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// Las notas de corrección por segundo (f03). Aylu y Tomás las escriben (segundo en mm:ss, hasta, tipo, texto y un link a una
// imagen si hace falta) y salen juntas con «Pedir corrección» (también con el video ya mandado al cliente). Con el video YA
// en corrección, una nota nueva se suma a la corrección en curso (le avisamos a René) sin contar otra ronda. "Corrección N"
// es la cuenta total; "ronda" queda para el contador del cliente (P6). René tilda cada una a medida que la resuelve; ve solo las
// enviadas. Una nota enviada ya no se edita ni se borra (queda en el historial tal cual la recibió René).
type Props = {
  videoId: number; demo: boolean
  rondas: VistaVideo['rondasNotas']; nuevas: FilaNota[]
  puedeEscribir: boolean; enCorreccion: boolean
}

function FilaDeNota({ n, demo }: { n: FilaNota; demo: boolean }) {
  const { enviando, msj, enviar } = useEnvio(demo)
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(n.texto)
  const hecha = !!n.tilde
  return (
    <li className={hecha ? 'ed-nota ed-nota--hecha' : 'ed-nota'}>
      <span className="ed-nota__tiempo">{n.tiempo || '—'}</span>
      <div className="ed-nota__cuerpo">
        <span className="cj-etiqueta">{n.tipo}{n.origen === 'del cliente' ? ' · del cliente' : ''}</span>
        {editando ? (
          <label className="ed-campo">
            <span className="cj-solo-lectores">Texto de la nota</span>
            <textarea value={texto} maxLength={LARGO_NOTA_VIDEO} rows={2} onChange={e => setTexto(e.target.value)} />
          </label>
        ) : (
          <p className="ed-nota__texto">{n.texto}</p>
        )}
        {n.imagen && <a className="ed-link" href={n.imagen} target="_blank" rel="noopener noreferrer">Ver la imagen</a>}
        {n.afecta && <span className="ed-sub">{n.afecta}</span>}
        {n.tilde && <span className="ed-sub">Tildada por {n.tilde.quien || 'alguien'} · {n.tilde.cuando}</span>}
        <Mensaje msj={msj} enviando={enviando} />
      </div>
      <div className="ed-nota__lado">
        {n.puedeTildar && (
          <label className="ed-tilde">
            <input type="checkbox" checked={hecha} disabled={enviando} onChange={e => void enviar({ accion: 'nota_tildar', nota_id: n.id, version: n.version, tildada: e.target.checked })} />
            {hecha ? 'Resuelta' : 'Marcar resuelta'}
          </label>
        )}
        {n.puedeEditar && !editando && (
          <span className="ed-botones">
            <button type="button" className="cj-chip" onClick={() => setEditando(true)}>Editar</button>
            <button type="button" className="cj-chip ed-boton-peligro" disabled={enviando} onClick={() => { if (window.confirm('¿Borrar esta nota?')) void enviar({ accion: 'nota_borrar', nota_id: n.id, version: n.version }) }}>Borrar</button>
          </span>
        )}
        {editando && (
          <span className="ed-botones">
            <button type="button" className="cj-chip" disabled={enviando || !texto.trim()} onClick={async () => {
              const r = await enviar({ accion: 'nota_editar', nota_id: n.id, version: n.version, cambios: { texto: texto.trim() } })
              if (r?.ok || demo) setEditando(false)
            }}>Guardar</button>
            <button type="button" className="cj-chip" onClick={() => { setEditando(false); setTexto(n.texto) }}>Cancelar</button>
          </span>
        )}
      </div>
    </li>
  )
}

function NotaNueva({ videoId, demo, enCorreccion }: { videoId: number; demo: boolean; enCorreccion: boolean }) {
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const id = useId()
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [tipo, setTipo] = useState<TipoNota>('texto')
  const [texto, setTexto] = useState('')
  const [imagen, setImagen] = useState('')

  async function guardar() {
    const s = leerTiempo(desde), h = leerTiempo(hasta)
    if (s === undefined) { setMsj({ texto: 'El segundo va como 17, 1:05 o 1,05 (un minuto y cinco segundos).', error: true }); return }
    if (h === undefined) { setMsj({ texto: '"Hasta" va como 32, 1:12 o 1,12.', error: true }); return }
    if (h !== null && (s === null || h < s)) { setMsj({ texto: '"Hasta" va después del segundo de inicio.', error: true }); return }
    if (!texto.trim()) { setMsj({ texto: 'Escribí la nota.', error: true }); return }
    const r = await enviar({ accion: 'nota_crear', video_id: videoId, segundo: s, hasta: h, tipo, texto: texto.trim(), imagen_url: imagen.trim() || null })
    if (r?.ok) { setDesde(''); setHasta(''); setTexto(''); setImagen('') }
  }

  return (
    <div className="ed-form" role="group" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="cj-etiqueta cj-etiqueta--laton">Nueva nota</p>
      <div className="ed-form__fila">
        {/* Teclado numérico del celular (sin «:»): 1,05 o 1.05 se lee como 1:05 */}
        <label className="ed-campo ed-campo--chico"><span>Segundo</span><input value={desde} onChange={e => setDesde(e.target.value)} inputMode="decimal" placeholder="17 o 1,05" autoComplete="off" /></label>
        <label className="ed-campo ed-campo--chico"><span>Hasta</span><input value={hasta} onChange={e => setHasta(e.target.value)} inputMode="decimal" placeholder="32 o 1,12" autoComplete="off" /></label>
        <label className="ed-campo">
          <span>Tipo</span>
          <select value={tipo} onChange={e => setTipo(e.target.value as TipoNota)}>{TIPOS_NOTA.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_NOTA[t]}</option>)}</select>
        </label>
      </div>
      <label className="ed-campo"><span>Qué corregir</span><textarea value={texto} maxLength={LARGO_NOTA_VIDEO} rows={2} onChange={e => setTexto(e.target.value)} placeholder='Dice "mora" y es "demora"' /></label>
      <label className="ed-campo"><span>Link a una imagen (opcional, https)</span><input type="url" inputMode="url" value={imagen} maxLength={LARGO_URL} onChange={e => setImagen(e.target.value)} autoComplete="off" /></label>
      {enCorreccion && <p className="ed-sub">El video ya está en corrección: la nota se suma a la corrección en curso y le avisamos a René.</p>}
      <div className="ed-botones">
        <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando} onClick={() => void guardar()}>Agregar la nota</button>
      </div>
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}

export function Notas({ videoId, demo, rondas, nuevas, puedeEscribir, enCorreccion }: Props) {
  const hayAlgo = rondas.length > 0 || nuevas.length > 0
  return (
    <div className="ed-rondas">
      {nuevas.length > 0 && (
        <div className="ed-ronda">
          <h3>Sin mandar todavía ({nuevas.length})</h3>
          <ul className="ed-notas">{nuevas.map(n => <FilaDeNota key={n.id} n={n} demo={demo} />)}</ul>
          <p className="ed-sub">Salen juntas con «Pedir corrección».</p>
        </div>
      )}
      {[...rondas].reverse().map(r => (
        <div key={r.ronda} className="ed-ronda">
          <h3>Corrección {r.ronda} · {r.origen}</h3>
          <ul className="ed-notas">{r.notas.map(n => <FilaDeNota key={n.id} n={n} demo={demo} />)}</ul>
        </div>
      ))}
      {!hayAlgo && <p className="ed-vacio">Sin notas de corrección.</p>}
      {puedeEscribir && <NotaNueva videoId={videoId} demo={demo} enCorreccion={enCorreccion} />}
    </div>
  )
}
