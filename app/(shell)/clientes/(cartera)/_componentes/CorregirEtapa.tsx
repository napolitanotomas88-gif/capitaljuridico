'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { NOMBRE_ETAPA, type Etapa } from '@/lib/clientes/recorrido'

// "Corregir etapa" en la tarjeta del cliente (26/10/2026, pedido de Tomás): fijar a mano la etapa cuando el registro automático
// no alcanza. Manda hasta que se toca "Volver a la automática" (POST /api/clientes/<id>/hitos con { etapa }, tabla
// cj_etapas_manual). Pausa y Baja no se eligen acá: salen del CRM. Mismas etapas que ETAPAS_CORREGIBLES de hitosRegistro.ts.
const ETAPAS_CORREGIBLES: Etapa[] = ['alta', 'kickoff', 'guiones', 'grabacion', 'edicion', 'por_lanzar', 'lanzado', 'exito', 'renovacion']

type Props = { idCrm: string; etapa: Etapa; manual: boolean; automatica: Etapa | null; demo: boolean }

export function CorregirEtapa({ idCrm, etapa, manual, automatica, demo }: Props) {
  const router = useRouter()
  const boton = useRef<HTMLButtonElement>(null)
  const [abierto, setAbierto] = useState(false)
  const [elegida, setElegida] = useState<Etapa>(ETAPAS_CORREGIBLES.includes(etapa) ? etapa : 'alta')
  const [nota, setNota] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [guardado, setGuardado] = useState<string | null>(null)
  const [actualizando, empezar] = useTransition()

  const enviar = async (cuerpo: { etapa: Etapa | null; nota?: string }, texto: string) => {
    if (demo) { setError('Con los datos de ejemplo (?demo=1) no se guarda nada.'); return }
    setEnviando(true); setError(null)
    try {
      const r = await fetch(`/api/clientes/${encodeURIComponent(idCrm)}/hitos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensaje?: string }
      if (!r.ok || !j.ok) { setError(j.mensaje ?? 'No se pudo guardar. Probá de nuevo.'); return }
      setAbierto(false); setGuardado(texto)
      empezar(() => router.refresh())
      requestAnimationFrame(() => boton.current?.focus())
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rc-corregir">
      {manual && automatica && <p className="rc-corregir__nota">El registro automático dice <strong>{NOMBRE_ETAPA[automatica]}</strong>.</p>}
      <p className="rc-hito__estado" role="status" aria-live="polite">{guardado && (actualizando ? `${guardado}: actualizando…` : `${guardado}.`)}</p>
      {!abierto ? (
        <div className="rc-hito__botones">
          <button ref={boton} type="button" className="rc-hito__accion" onClick={() => { setGuardado(null); setAbierto(true) }}>Corregir etapa</button>
          {manual && (
            <button type="button" className="rc-limpiar" disabled={enviando} onClick={() => void enviar({ etapa: null }, 'Volvió a la etapa automática')}>Volver a la automática</button>
          )}
        </div>
      ) : (
        <form className="rc-hito__form" onSubmit={e => { e.preventDefault(); void enviar({ etapa: elegida, nota }, `Etapa corregida a ${NOMBRE_ETAPA[elegida]}`) }}>
          <div className="rc-hito__campos">
            <label className="rc-campo">
              <span className="cj-etiqueta">Etapa real</span>
              <select className="rc-input" value={elegida} onChange={e => setElegida(e.target.value as Etapa)}>
                {ETAPAS_CORREGIBLES.map(x => <option key={x} value={x}>{NOMBRE_ETAPA[x]}</option>)}
              </select>
            </label>
            <label className="rc-campo rc-hito__nota">
              <span className="cj-etiqueta">Por qué (opcional)</span>
              <input type="text" className="rc-input" value={nota} maxLength={300} onChange={e => setNota(e.target.value)} placeholder="Por ejemplo: ya grabó, falta subir los crudos" />
            </label>
          </div>
          <p className="rc-corregir__nota">Manda sobre la etapa automática hasta que la saques. Pausa y Baja salen del CRM.</p>
          {error && <p className="rc-hito__error" role="alert">{error}</p>}
          <div className="rc-hito__botones">
            <button type="submit" className="cj-boton cj-boton--primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando} onClick={() => { setAbierto(false); requestAnimationFrame(() => boton.current?.focus()) }}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  )
}
