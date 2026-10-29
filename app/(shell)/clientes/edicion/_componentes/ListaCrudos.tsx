'use client'

import { useState } from 'react'
import type { FilaArchivo } from '@/lib/edicion/vista'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// Los archivos de "Crudos - X" o "Editados - X": nombre, duración, peso, quién lo subió (cliente o equipo, nunca el mail),
// link a Drive, transcripción y a qué video quedó asignado. Aylu y Tomás lo pueden cambiar: un vínculo puesto por una
// persona el bot no lo pisa nunca. Un editado que propuso el bot se acepta con un toque.
type Props = { archivos: FilaArchivo[]; videos: { id: number; clave: string }[]; puedeVincular: boolean; demo: boolean; tipo: 'crudo' | 'editado'; vacio: string }

function Fila({ a, videos, puedeVincular, demo, tipo }: { a: FilaArchivo } & Omit<Props, 'archivos' | 'vacio'>) {
  const { enviando, msj, enviar } = useEnvio(demo)
  const actual = a.asignado?.video_id ?? 0
  const [elegido, setElegido] = useState<number>(actual)
  return (
    <li className="ed-archivo">
      <div>
        <p className="ed-archivo__nombre">{a.nombre}{a.borrado && <span className="ed-marca ed-marca--alerta" style={{ marginLeft: 8 }}>borrado en Drive</span>}</p>
        <p className="ed-archivo__datos">
          {a.duracion && <span className="ed-num">{a.duracion}</span>}
          {a.peso && <span className="ed-num">{a.peso}</span>}
          {a.subio && <span>{a.subio}</span>}
          {a.creado && <span>{a.creado}</span>}
        </p>
        <a className="ed-link" href={a.drive} target="_blank" rel="noopener noreferrer">Abrir en Drive</a>
      </div>
      <div>
        {tipo === 'crudo' && <p className="ed-archivo__datos"><span className={a.transcripcion.tono === 'rojo' ? 'ed-marca ed-marca--alerta' : a.transcripcion.tono === 'amarillo' ? 'ed-marca ed-marca--laton' : a.transcripcion.tono === 'verde' ? 'ed-marca ed-marca--ok' : 'ed-marca'}>{a.transcripcion.texto}</span></p>}
        {a.inferido && <p className="ed-archivo__datos">{a.inferido}</p>}
      </div>
      <div>
        {a.asignado ? <p className="ed-archivo__datos">Video {a.asignado.clave}{a.asignado.por ? ` · lo asignó ${a.asignado.por}` : ''}</p> : <p className="ed-archivo__datos">Sin video asignado</p>}
        {a.propuesta && <p className="ed-archivo__datos"><span className="ed-marca ed-marca--ok">El bot propone {a.propuesta.clave}</span></p>}
        {puedeVincular && (
          <div className="ed-botones">
            {a.propuesta && <button type="button" className="cj-chip" disabled={enviando} onClick={() => void enviar({ accion: 'vincular_archivo', archivo_id: a.id, video_id: a.propuesta!.video_id })}>Vincular a {a.propuesta.clave}</button>}
            <label className="ed-campo ed-campo--medio">
              <span className="cj-solo-lectores">Video de {a.nombre}</span>
              <select value={elegido} onChange={e => setElegido(Number(e.target.value))} disabled={enviando}>
                <option value={0}>Sin video</option>
                {videos.map(v => <option key={v.id} value={v.id}>{v.clave}</option>)}
              </select>
            </label>
            {elegido !== actual && <button type="button" className="cj-chip" disabled={enviando} onClick={() => void enviar({ accion: 'vincular_archivo', archivo_id: a.id, video_id: elegido || null })}>Guardar</button>}
          </div>
        )}
        <Mensaje msj={msj} enviando={enviando} />
      </div>
    </li>
  )
}

export function ListaCrudos({ archivos, vacio, ...resto }: Props) {
  if (!archivos.length) return <p className="ed-vacio">{vacio}</p>
  return <ul className="ed-archivos">{archivos.map(a => <Fila key={a.id} a={a} {...resto} />)}</ul>
}
