'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LARGO_NOTA, NOMBRE_VALOR_CHECK, VALORES_CHECK, type ValorCheck } from '@/lib/bot/kickoff/revision'
import type { ItemPortfolio } from '@/lib/bot/kickoff/tipos'
import { enviarKickoff } from './enviar'

// Tilde a mano de un ítem del portfolio que ni Meta ni la llamada resolvieron: ok / falta / problema y una nota corta.
// Tocar un botón guarda ese valor con la nota del campo (que arranca con la nota guardada): tocar el que ya está prendido
// con una nota distinta la actualiza, sin quitar el tilde. Para quitarlo está «Quitar tilde», explícito (en el celular el
// tooltip no se ve). Se guarda en cj_kickoffs.portfolio_checks con quién y cuándo; manda el `cuando` de lo que se ve
// (previo): si otro lo cambió en el medio, el servidor no escribe y se recarga. En el ejemplo (?demo=1) cambia solo en pantalla.
export interface TildeActual { valor: ValorCheck; nota: string; quien: string; cuandoTexto: string | null; cuando: string }

type Props = { idCliente: string; recordingId: number; item: ItemPortfolio; nombre: string; actual: TildeActual | null; demo: boolean }

const clave = (t: TildeActual | null) => (t ? `${t.valor}|${t.cuando}|${t.nota}` : '')

export function TildePortfolio({ idCliente, recordingId, item, nombre, actual, demo }: Props) {
  const router = useRouter()
  const idNota = useId()
  const [tilde, setTilde] = useState(actual)
  const [nota, setNota] = useState(actual?.nota ?? '')
  // Lo que llega del servidor (después de router.refresh) manda: ajuste de estado durante el render, sin efecto
  const [visto, setVisto] = useState(actual)
  if (clave(visto) !== clave(actual)) { setVisto(actual); setTilde(actual); setNota(actual?.nota ?? '') }
  const [enviando, setEnviando] = useState(false)
  const [msj, setMsj] = useState<{ texto: string; error: boolean } | null>(null)

  async function guardar(valor: ValorCheck | null) {
    if (enviando) return
    const n = valor ? nota.trim() : ''
    if (demo) {
      setTilde(valor ? { valor, nota: n, quien: 'vos', cuandoTexto: 'recién', cuando: new Date().toISOString() } : null)
      if (!valor) setNota('')
      setMsj({ texto: 'Ejemplo: no se guarda.', error: false })
      return
    }
    setEnviando(true)
    setMsj(null)
    const r = await enviarKickoff(idCliente, { accion: 'check', recording_id: recordingId, item, valor, nota: n, previo: tilde?.cuando ?? null })
    setEnviando(false)
    if (r.ok) {
      setTilde(valor && r.cuando ? { valor, nota: n, quien: 'vos', cuandoTexto: 'recién', cuando: r.cuando } : null)
      if (!valor) setNota('')
      setMsj({ texto: r.mensaje, error: false })
      router.refresh()
    } else {
      setMsj({ texto: r.mensaje, error: true })
      if (r.codigo === 'conflicto') router.refresh()
    }
  }

  const notaCambio = !!tilde && nota.trim() !== tilde.nota
  return (
    <div className="ko-tilde">
      <span className="cj-etiqueta">Tildar a mano</span>
      <div className="ko-tilde__botones" role="group" aria-label={`Tildar a mano: ${nombre}`}>
        {VALORES_CHECK.map(v => {
          const prendido = tilde?.valor === v
          return (
            <button key={v} type="button" className="cj-chip" aria-pressed={prendido} disabled={enviando || (prendido && !notaCambio)}
              onClick={() => guardar(v)} title={prendido && notaCambio ? 'Guardar la nota nueva' : undefined}>
              {NOMBRE_VALOR_CHECK[v]}
            </button>
          )
        })}
        {tilde && (
          <button type="button" className="cj-chip ko-tilde__quitar" disabled={enviando} onClick={() => guardar(null)}>
            Quitar tilde
          </button>
        )}
      </div>
      <label className="ko-tilde__nota" htmlFor={idNota}>
        <span className="ko-sub">{tilde ? 'Nota (para cambiarla, tocá de nuevo el botón prendido)' : 'Nota (opcional, va con el botón que toques)'}</span>
        <input id={idNota} type="text" value={nota} maxLength={LARGO_NOTA} autoComplete="off" disabled={enviando} onChange={e => setNota(e.target.value)} />
      </label>
      <p className="ko-sub">
        {tilde
          ? `Tildado «${NOMBRE_VALOR_CHECK[tilde.valor].toLowerCase()}» por ${tilde.quien || 'alguien'}${tilde.cuandoTexto ? ` · ${tilde.cuandoTexto}` : ''}${tilde.nota ? ` — ${tilde.nota}` : ''}`
          : 'Sin tildar.'}
      </p>
      <p role="status" aria-live="polite" className={msj?.error ? 'ko-msj ko-msj--error' : 'ko-msj'}>{enviando ? 'Guardando…' : msj?.texto ?? ''}</p>
    </div>
  )
}
