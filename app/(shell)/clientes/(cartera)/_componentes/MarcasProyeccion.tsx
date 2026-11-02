'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { ItemProyeccion } from '@/lib/bot/proyeccion/vista'

// Las 3 marcas rápidas de la llamada de proyección (Tomás, 2/11/2026): Avisado · Agendada (fecha) · Hecha / No se dio.
// Las mismas en el panel de Clientes y en la tarjeta del cliente: POST /api/clientes/<id>/proyeccion (tabla cj_proyeccion).
// «Agendada» o «Hecha» cortan los avisos del bot. Cada marca se quita con otro clic.

const corta = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('/')
const sumar = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

type Props = { item: ItemProyeccion; hoy: string; demo?: boolean }

export function MarcasProyeccion({ item, hoy, demo = false }: Props) {
  const router = useRouter()
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const [fecha, setFecha] = useState(item.agendada ?? (item.dias > 7 ? sumar(hoy, 7) : hoy))
  const [, empezar] = useTransition()

  const marcar = async (campo: 'avisado' | 'agendada' | 'resultado', valor: string | null, resultado?: 'hecha' | 'no_se_dio') => {
    if (demo) { setError('Con los datos de ejemplo no se guarda nada.'); return }
    setEnviando(true); setError(null)
    try {
      const r = await fetch(`/api/clientes/${encodeURIComponent(item.id)}/proyeccion`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fin: item.fin, campo, fecha: valor, resultado }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensaje?: string }
      if (!r.ok || !j.ok) { setError(j.mensaje ?? 'No se pudo guardar.'); return }
      setEligiendo(false)
      empezar(() => router.refresh())
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  const diaResultado = item.agendada && item.agendada <= hoy ? item.agendada : hoy
  const nombre = <span className="cj-solo-lectores"> · {item.nombre}</span>

  return (
    <div className="py-marcas" aria-busy={enviando}>
      <button type="button" className={`py-marca${item.avisado ? ' py-marca--si' : ''}`} aria-pressed={!!item.avisado} disabled={enviando}
        title={item.avisado ? 'Quitar «Avisado»' : 'Se le avisó que vamos a tener la llamada de proyección'}
        onClick={() => void marcar('avisado', item.avisado ? null : hoy)}>
        {item.avisado ? `✓ Avisado ${corta(item.avisado)}` : 'Avisado'}{nombre}
      </button>

      {eligiendo ? (
        <form className="py-fecha" onSubmit={(e) => { e.preventDefault(); void marcar('agendada', fecha) }}>
          <label>
            <span className="cj-solo-lectores">Fecha de la llamada de {item.nombre}</span>
            <input type="date" className="rc-input py-input" value={fecha} min="2024-01-01" onChange={(e) => setFecha(e.target.value)} required autoFocus />
          </label>
          <button type="submit" className="py-marca py-marca--si" disabled={enviando}>Guardar</button>
          {item.agendada && <button type="button" className="py-marca" disabled={enviando} onClick={() => void marcar('agendada', null)}>Quitar</button>}
          <button type="button" className="py-marca" disabled={enviando} onClick={() => setEligiendo(false)}>Cancelar</button>
        </form>
      ) : (
        <button type="button" className={`py-marca${item.agendada ? ' py-marca--si' : ''}`} aria-pressed={!!item.agendada} disabled={enviando}
          title={item.agendada ? 'Cambiar o quitar la fecha' : 'Anotar la fecha de la llamada'} onClick={() => setEligiendo(true)}>
          {item.agendada ? `✓ Agendada ${corta(item.agendada)}${item.agendadaFuente === 'calendly' ? ' · Calendly' : ''}` : 'Agendada…'}{nombre}
        </button>
      )}

      {item.resultado ? (
        <button type="button" className={`py-marca py-marca--si${item.resultado === 'no_se_dio' ? ' py-marca--no' : ''}`} aria-pressed disabled={enviando}
          title="Quitar el resultado" onClick={() => void marcar('resultado', null)}>
          {item.resultado === 'hecha' ? '✓ Hecha' : '✗ No se dio'}{item.resultadoFecha ? ` ${corta(item.resultadoFecha)}` : ''}{nombre}
        </button>
      ) : (
        <>
          <button type="button" className="py-marca" disabled={enviando} onClick={() => void marcar('resultado', diaResultado, 'hecha')}>Hecha{nombre}</button>
          <button type="button" className="py-marca" disabled={enviando} onClick={() => void marcar('resultado', diaResultado, 'no_se_dio')}>No se dio{nombre}</button>
        </>
      )}
      {error && <p className="py-error" role="alert">{error}</p>}
    </div>
  )
}
