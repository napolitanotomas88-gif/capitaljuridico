'use client'

import { useId, useState } from 'react'
import { ETIQUETA_BLOQUEO, ETIQUETA_MOTIVO, ETIQUETA_PRIORIDAD } from '@/lib/edicion/etiquetas'
import { LARGO_CITA, LARGO_MOTIVO_BLOQUEO, LARGO_NOTA, LARGO_URL } from '@/lib/edicion/pedido'
import { BLOQUEOS, MOTIVOS_REGRABAR, PRIORIDADES, type Bloqueo, type MotivoRegrabar, type Prioridad } from '@/lib/edicion/tipos'
import type { AccionBoton } from '@/lib/edicion/vista'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// Los botones del video: los que da accionesPara(rol, …) (estados.ts), así nadie ve un botón que la API le va a rechazar.
// Los que piden un dato (motivo del regrabar, nota de una pausa, cita del OK del cliente, link al editado) abren un panel
// chico con ese campo antes de mandar. Además: la prioridad y los bloqueos (Aylu y Tomás todo; René solo "otro" con
// motivo, que le avisa a Aylu; el bloqueo del tope de rondas lo maneja Tomás).
type Props = {
  videoId: number; version: number; acciones: AccionBoton[]; demo: boolean
  prioridad: Prioridad; puedePrioridad: boolean
  bloqueo: { clave: Bloqueo; texto: string; motivo: string } | null
  permisoBloqueo: 'todo' | 'otro' | null; puedeTope: boolean
  /** Lo que se dice cuando no hay botones (por ejemplo, a René con notas sin tildar). */
  vacio?: string | null
}

const TITULO_PIDE: Record<NonNullable<AccionBoton['pide']>, string> = {
  motivo: '¿Por qué hay que regrabar?', nota: 'Dejá una nota (queda en el historial)', nota_opcional: 'Nota (opcional)',
  cita: 'Pegá el mensaje del cliente con el OK (tal cual)', link: 'Link al editado en Drive', link_opcional: 'Link al editado en Drive (si ya está)',
}

export function AccionesVideo({ videoId, version, acciones, demo, prioridad, puedePrioridad, bloqueo, permisoBloqueo, puedeTope, vacio }: Props) {
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const id = useId()
  const [abierta, setAbierta] = useState<AccionBoton | null>(null)
  const [motivo, setMotivo] = useState<MotivoRegrabar | ''>('')
  const [nota, setNota] = useState('')
  const [cita, setCita] = useState('')
  const [link, setLink] = useState('')
  const [prio, setPrio] = useState<Prioridad>(prioridad)
  const [bloq, setBloq] = useState<Bloqueo>('otro')
  const [motivoBloq, setMotivoBloq] = useState('')
  const [verBloqueo, setVerBloqueo] = useState(false)

  const limpiar = () => { setAbierta(null); setMotivo(''); setNota(''); setCita(''); setLink('') }

  async function mover(a: AccionBoton) {
    const cuerpo: Record<string, unknown> = { accion: 'mover', video_id: videoId, version, transicion: a.accion }
    if (a.pide === 'motivo') {
      if (!motivo) { setMsj({ texto: 'Elegí el motivo.', error: true }); return }
      cuerpo.motivo = motivo
      if (nota.trim()) cuerpo.nota = nota.trim()
    }
    if (a.pide === 'nota') {
      if (nota.trim().length < 3) { setMsj({ texto: 'Escribí la nota.', error: true }); return }
      cuerpo.nota = nota.trim()
    }
    if (a.pide === 'cita') {
      if (cita.trim().length < 2) { setMsj({ texto: 'Pegá el mensaje del cliente.', error: true }); return }
      cuerpo.cita = cita.trim()
    }
    if (a.pide === 'link' || a.pide === 'link_opcional') {
      if (a.pide === 'link' && !link.trim()) { setMsj({ texto: 'Pegá el link al editado.', error: true }); return }
      if (link.trim()) cuerpo.editado_url = link.trim()
    }
    const r = await enviar(cuerpo)
    if (r?.ok) limpiar()
  }

  function tocar(a: AccionBoton) {
    setMsj(null)
    if (a.pide) { setAbierta(abierta?.accion === a.accion ? null : a); return }
    if (a.tono === 'peligro' && !window.confirm(`¿${a.etiqueta}?`)) return
    void mover(a)
  }

  const claseBoton = (a: AccionBoton) => a.tono === 'primario' ? 'cj-boton cj-boton--primario' : a.tono === 'peligro' ? 'cj-boton cj-boton--secundario ed-boton-peligro' : 'cj-boton cj-boton--secundario'
  const bloqueosElegibles = BLOQUEOS.filter(b => permisoBloqueo === 'todo' ? (b !== 'tope_rondas_cliente' || puedeTope) : b === 'otro')
  const puedeQuitar = !!bloqueo && permisoBloqueo === 'todo' && (bloqueo.clave !== 'tope_rondas_cliente' || puedeTope)

  return (
    <div className="ed-acciones">
      {acciones.length > 0 ? (
        <div className="ed-acciones__botones">
          {acciones.map(a => (
            <button key={a.accion} type="button" className={claseBoton(a)} disabled={enviando} aria-expanded={a.pide ? abierta?.accion === a.accion : undefined} aria-controls={a.pide ? `${id}-panel` : undefined} onClick={() => tocar(a)}>
              {a.etiqueta}
            </button>
          ))}
        </div>
      ) : (
        <p className="ed-vacio">{vacio || 'No hay movimientos para vos en este estado.'}</p>
      )}

      {abierta && (
        <div className="ed-panel-accion" id={`${id}-panel`}>
          <p className="cj-etiqueta cj-etiqueta--laton">{abierta.etiqueta}</p>
          {abierta.pide === 'motivo' && (
            <>
              <fieldset className="ed-opciones">
                <legend>{TITULO_PIDE.motivo}</legend>
                {MOTIVOS_REGRABAR.map(m => (
                  <label key={m} className="ed-opcion">
                    <input type="radio" name={`${id}-motivo`} value={m} checked={motivo === m} onChange={() => setMotivo(m)} />
                    <span>{ETIQUETA_MOTIVO[m]}</span>
                  </label>
                ))}
              </fieldset>
              <label className="ed-campo">
                <span>Detalle para el cliente (opcional: «la frase del CTA», «se escucha el ventilador»)</span>
                <input value={nota} maxLength={LARGO_NOTA} onChange={e => setNota(e.target.value)} autoComplete="off" />
              </label>
            </>
          )}
          {abierta.pide === 'nota' && (
            <label className="ed-campo">
              <span>{TITULO_PIDE.nota}</span>
              <textarea value={nota} maxLength={LARGO_NOTA} onChange={e => setNota(e.target.value)} rows={3} />
            </label>
          )}
          {abierta.pide === 'cita' && (
            <label className="ed-campo">
              <span>{TITULO_PIDE.cita}</span>
              <textarea value={cita} maxLength={LARGO_CITA} onChange={e => setCita(e.target.value)} rows={3} placeholder="«Perfecto, me encantó, adelante»" />
            </label>
          )}
          {(abierta.pide === 'link' || abierta.pide === 'link_opcional') && (
            <label className="ed-campo">
              <span>{TITULO_PIDE[abierta.pide]}</span>
              <input type="url" inputMode="url" value={link} maxLength={LARGO_URL} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/file/d/…" autoComplete="off" />
              {abierta.pide === 'link_opcional' && <span className="ed-sub">Sin link, el video pasa igual y queda marcado «falta el link» hasta que se vincule el editado.</span>}
            </label>
          )}
          <div className="ed-botones">
            <button type="button" className={abierta.tono === 'peligro' ? 'cj-boton cj-boton--secundario ed-boton-peligro' : 'cj-boton cj-boton--primario'} disabled={enviando} onClick={() => void mover(abierta)}>Confirmar</button>
            <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando} onClick={limpiar}>Cancelar</button>
          </div>
        </div>
      )}

      {(puedePrioridad || permisoBloqueo) && (
        <div className="ed-form__fila">
          {puedePrioridad && (
            <div className="ed-botones">
              <label className="ed-campo ed-campo--medio">
                <span>Prioridad</span>
                <select value={prio} onChange={e => setPrio(e.target.value as Prioridad)} disabled={enviando}>
                  {PRIORIDADES.map(p => <option key={p} value={p}>{ETIQUETA_PRIORIDAD[p]}</option>)}
                </select>
              </label>
              {prio !== prioridad && <button type="button" className="cj-chip" disabled={enviando} onClick={() => void enviar({ accion: 'prioridad', video_id: videoId, version, prioridad: prio })}>Guardar prioridad</button>}
            </div>
          )}
          {permisoBloqueo && (
            <div className="ed-botones">
              {puedeQuitar && (
                <button type="button" className="cj-chip" disabled={enviando} onClick={() => void enviar({ accion: 'bloqueo', video_id: videoId, version, bloqueo: null, motivo: '' })}>Quitar el bloqueo</button>
              )}
              {!bloqueo && (
                <button type="button" className="cj-chip" aria-expanded={verBloqueo} onClick={() => setVerBloqueo(!verBloqueo)}>
                  {permisoBloqueo === 'otro' ? 'Avisar un problema' : 'Marcar un bloqueo'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {verBloqueo && permisoBloqueo && !bloqueo && (
        <div className="ed-panel-accion">
          {permisoBloqueo === 'todo' && (
            <label className="ed-campo ed-campo--medio">
              <span>Bloqueo</span>
              <select value={bloq} onChange={e => setBloq(e.target.value as Bloqueo)}>
                {bloqueosElegibles.map(b => <option key={b} value={b}>{ETIQUETA_BLOQUEO[b]}</option>)}
              </select>
            </label>
          )}
          <label className="ed-campo">
            <span>{permisoBloqueo === 'otro' ? 'Qué pasa (le avisamos a Aylu)' : 'Motivo'}</span>
            <input value={motivoBloq} maxLength={LARGO_MOTIVO_BLOQUEO} onChange={e => setMotivoBloq(e.target.value)} autoComplete="off" placeholder="El crudo del video 3 no abre" />
          </label>
          <div className="ed-botones">
            <button type="button" className="cj-boton cj-boton--primario" disabled={enviando || motivoBloq.trim().length < 3} onClick={async () => {
              const r = await enviar({ accion: 'bloqueo', video_id: videoId, version, bloqueo: permisoBloqueo === 'otro' ? 'otro' : bloq, motivo: motivoBloq.trim() })
              if (r?.ok) { setVerBloqueo(false); setMotivoBloq('') }
            }}>Guardar</button>
            <button type="button" className="cj-boton cj-boton--secundario" onClick={() => setVerBloqueo(false)}>Cancelar</button>
          </div>
        </div>
      )}
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}
