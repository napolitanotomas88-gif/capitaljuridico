'use client'

import { useMemo, useState } from 'react'
import type { TrackerEncuesta } from '@/lib/clientes/encuesta/modelo'

// Tracker de la encuesta mensual (4/11/2026): una fila por cliente activo y una columna por mes. Llega armado del servidor
// (trackerEncuesta), ya ordenado con «No completó» primero; acá solo se filtra por responsable.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const etiquetaMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}-${mes.slice(2, 4)}`
const puntaje = (v: number | null) => (v === null ? '' : ` · ${String(v).replace('.', ',')}`)
const dia = (ymd: string) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`

export function Tracker({ tracker }: { tracker: TrackerEncuesta }) {
  const [responsable, setResponsable] = useState('')
  const responsables = useMemo(() => [...new Set(tracker.filas.map((f) => f.responsable))].sort((a, b) => a.localeCompare(b, 'es')), [tracker])
  const filas = responsable ? tracker.filas.filter((f) => f.responsable === responsable) : tracker.filas
  return (
    <>
      <div className="cj-encuesta__filtro">
        <label className="cj-texto-2" htmlFor="tracker-responsable">Responsable</label>
        <select id="tracker-responsable" className="cj-campo__entrada" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
          <option value="">Todos ({tracker.filas.length})</option>
          {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="cj-tabla-scroll" role="region" aria-label="Encuesta por mes" tabIndex={0}>
        <table className="cj-tabla cj-encuesta__tracker">
          <thead>
            <tr><th>ID</th><th>Cliente</th><th>Responsable</th>{tracker.meses.map((m) => <th key={m}>{etiquetaMes(m)}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td>{f.id}</td><td>{f.nombre}</td><td>{f.responsable}</td>
                {f.casillas.map((c, i) => (
                  <td key={tracker.meses[i]}>
                    {c?.estado === 'completo' && <span className="cj-encuesta__si">✓ Completó{puntaje(c.valor)}</span>}
                    {c?.estado === 'no_completo' && <span className="cj-encuesta__no" title={`Enviada el ${dia(c.enviada)}`}>✗ No completó</span>}
                    {!c && <span className="cj-texto-2" aria-label="Sin ronda">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
