'use client'

import { useState } from 'react'
import { LARGO_NOTA_PASO } from '@/lib/edicion/pedido'
import type { FilaPaso } from '@/lib/edicion/vista'
import { Mensaje } from './Mensaje'
import { TextoParaCopiar } from './TextoParaCopiar'
import { useEnvio } from './useEnvio'

// Un escalón del seguimiento e01 (el cliente no grabó): día 0 y recordatorios son un texto para el grupo Contenido (se copia
// y se marca «hecho»); día 2 (audio de Gero M) y día 4 (llamada citando el contrato) son guías internas que también se
// marcan «hecho» con una nota; el día 9 lo decide Tomás: pausar o seguir con un recordatorio cada 4 días hábiles.
export function PasoE01({ p, demo, puedeMarcar, puedeDecidir }: { p: FilaPaso; demo: boolean; puedeMarcar: boolean; puedeDecidir: boolean }) {
  const { enviando, msj, enviar } = useEnvio(demo)
  const [nota, setNota] = useState('')
  const cuerpoHecho = { accion: 'paso_hecho', paso_id: p.id, version: p.version }
  return (
    <article className={p.vencido && !p.hecho ? 'ed-paso ed-paso--vencido' : 'ed-paso'} aria-label={`${p.escalon}`}>
      <div className="ed-paso__cab">
        <h3>{p.escalon}</h3>
        <span className={p.vencido && !p.hecho ? 'ed-marca ed-marca--alerta' : 'ed-marca'}>{p.vencido ? 'Vencido' : 'Para'} el {p.debido.split('-').reverse().slice(0, 2).join('/')}</span>
      </div>
      <p className="ed-sub">
        A cargo de <strong>{p.responsable}</strong> · {p.videos} video{p.videos === 1 ? '' : 's'} esperando · {p.diasHabiles} día{p.diasHabiles === 1 ? '' : 's'} hábil{p.diasHabiles === 1 ? '' : 'es'} · por {p.motivo}
      </p>
      {p.frenado && <p className="ed-interno"><strong>Frenado</strong>Llegaron crudos del cliente que todavía no están ubicados: ubicalos en la ficha del cliente antes de seguir con el escalón.</p>}

      {p.noSalio && <p className="ed-interno"><strong>No salió por WhatsApp</strong>{p.noSalio.replace(/^No salió por WhatsApp:\s*/, '')}</p>}
      {p.hecho ? (
        <p className="ed-constancia">Hecho por {p.hecho.quien || 'alguien'} · {p.hecho.cuando}{p.hecho.nota ? ` · ${p.hecho.nota}` : ''}</p>
      ) : p.bot && p.texto.para === 'grupo_contenido' ? (
        <p className="ed-sub">Lo manda el bot por WhatsApp al grupo Contenido (días hábiles, de 10 a 19). No lo mandes a mano: cuando salga, queda acá como hecho.</p>
      ) : p.texto.para === 'grupo_contenido' ? (
        <TextoParaCopiar texto={p.texto.texto} etiqueta="Mensaje para el grupo Contenido (podés cambiar la fecha antes de copiar)" demo={demo}
          envio={puedeMarcar ? { cuerpo: cuerpoHecho, boton: 'Hecho: lo mandé', conNota: true } : null} />
      ) : (
        <div className="ed-copiar">
          <p className="cj-etiqueta">Guía interna para {p.texto.responsable === 'gero_m' ? 'Gero M' : 'Tomás'} (no es para el cliente)</p>
          <ol className="ed-guia">{p.texto.pasos.map(x => <li key={x}>{x}</li>)}</ol>
          {puedeMarcar && !p.esDia9 && (
            <>
              <label className="ed-campo"><span>Nota (qué respondió, qué se acordó)</span><input value={nota} maxLength={LARGO_NOTA_PASO} onChange={e => setNota(e.target.value)} autoComplete="off" /></label>
              <div className="ed-botones">
                <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={() => void enviar({ ...cuerpoHecho, nota: nota.trim(), texto: '' })}>Hecho</button>
              </div>
            </>
          )}
        </div>
      )}

      {p.esDia9 && !p.decision && (puedeDecidir ? (
        <div className="ed-botones">
          <button type="button" className="cj-boton cj-boton--secundario ed-boton-peligro" disabled={enviando} onClick={() => { if (window.confirm('¿Pausar? Los videos que esperan crudos quedan en pausa y se cierra el seguimiento.')) void enviar({ accion: 'paso_decision', paso_id: p.id, version: p.version, decision: 'pausar' }) }}>Pausar</button>
          <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando} onClick={() => void enviar({ accion: 'paso_decision', paso_id: p.id, version: p.version, decision: 'seguir' })}>Seguir con recordatorios</button>
        </div>
      ) : <p className="ed-sub">Lo decide Tomás: pausar o seguir con un recordatorio cada 4 días hábiles.</p>)}
      {p.decision && <p className="ed-constancia">Decisión: {p.decision}</p>}
      <Mensaje msj={msj} enviando={enviando} />
    </article>
  )
}
