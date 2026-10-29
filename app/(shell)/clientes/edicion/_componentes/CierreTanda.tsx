'use client'

import { useId, useState } from 'react'
import { LARGO_CITA } from '@/lib/edicion/pedido'
import type { CierreTandaVista } from '@/lib/edicion/vista'
import { BotonAccion } from './BotonAccion'
import { Mensaje } from './Mensaje'
import { TextoParaCopiar } from './TextoParaCopiar'
import { useEnvio } from './useEnvio'

// El cierre de una tanda del guion, como lo hace Aylu (253 de 282 cierres fueron en tanda): pasar al cliente todos los
// editados o corregidos de una vez, UN mensaje con todos los links (f04) con su «Enviado», y el OK del cliente para todos
// con la misma cita (f06). Cada video se sigue pudiendo mover de a uno desde su ficha.
type Props = { tanda: number | null; cierre: CierreTandaVista; demo: boolean; puedeEnvio: boolean }

function OkDeTodos({ items, demo }: { items: CierreTandaVista['ok']; demo: boolean }) {
  const id = useId()
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const [abierto, setAbierto] = useState(false)
  const [cita, setCita] = useState('')
  const n = items.length
  return (
    <div className="ed-copiar">
      <button type="button" className="cj-boton cj-boton--secundario" aria-expanded={abierto} aria-controls={`${id}-ok`} onClick={() => setAbierto(!abierto)}>
        {n === 1 ? 'El cliente dio el OK' : `El cliente dio el OK a los ${n}`}
      </button>
      {abierto && (
        <div className="ed-panel-accion" id={`${id}-ok`}>
          <label className="ed-campo">
            <span>Pegá el mensaje del cliente con el OK (tal cual): queda como cita en {n === 1 ? 'el video' : `los ${n} videos`}</span>
            <textarea value={cita} maxLength={LARGO_CITA} rows={3} onChange={e => setCita(e.target.value)} placeholder="«Perfecto, me encantaron todos»" />
          </label>
          <div className="ed-botones">
            <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={async () => {
              if (cita.trim().length < 2) { setMsj({ texto: 'Pegá el mensaje del cliente.', error: true }); return }
              if (!window.confirm(`¿Pasar ${n === 1 ? 'el video' : `los ${n} videos`} a Aprobado? Le avisamos a Valen.`)) return
              const r = await enviar({ accion: 'mover_lote', transicion: 'ok_cliente', items, cita: cita.trim() })
              if (r?.ok) { setCita(''); setAbierto(false) }
            }}>Aprobar {n === 1 ? 'el video' : `los ${n}`}</button>
          </div>
        </div>
      )}
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}

export function CierreTanda({ tanda, cierre, demo, puedeEnvio }: Props) {
  const de = tanda ? ` de la tanda ${tanda}` : ''
  const nAl = cierre.alCliente.length
  return (
    <div className="ed-cierre" role="group" aria-label={`Cierre${de}`}>
      <p className="cj-etiqueta cj-etiqueta--laton">Cierre{de}</p>
      {nAl > 0 && (
        <BotonAccion demo={demo} variante="primario" etiqueta={nAl === 1 ? 'Está bien: al cliente' : `Están bien los ${nAl}: al cliente`}
          confirmar={`¿Pasar ${nAl === 1 ? 'el video' : `los ${nAl} videos`}${de} a «Con el cliente»? Después copiás un solo mensaje con todos los links.`}
          cuerpo={{ accion: 'mover_lote', transicion: 'para_cliente', items: cierre.alCliente }} />
      )}
      {cierre.linkFinal && (
        <TextoParaCopiar key={cierre.linkFinal.items.map(i => `${i.video_id}.${i.version}`).join('-')} texto={cierre.linkFinal.texto}
          etiqueta={`Link final${de} para el grupo Contenido (${cierre.linkFinal.items.length === 1 ? '1 video' : `${cierre.linkFinal.items.length} videos en un mensaje`})`} demo={demo}
          envio={puedeEnvio ? { cuerpo: { accion: 'envio_registrado', tipo: 'link_final', items: cierre.linkFinal.items }, boton: 'Enviado' } : null} />
      )}
      {cierre.ok.length > 0 && <OkDeTodos items={cierre.ok} demo={demo} />}
    </div>
  )
}
