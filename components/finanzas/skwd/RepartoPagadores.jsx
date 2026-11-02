import { QUIENES_PAGAN, filaVacia, repartoUno, repartoMitades, montosReparto, chipsDeLinea } from './calculoPagadores'
import { dolares } from './formato'

const usd = (n) => dolares(n, 2)
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

// Editor de «Pagado por» repartido (pedido de Tomás, 1/11/2026): filas «Quién ▾ / % / = USD», agregar y quitar filas,
// atajos «100% uno» y «50/50 Tomi y Gero». Solo presenta: las reglas están en calculoPagadores.js y el error lo pasa
// la pantalla (mismo estilo que el resto de los errores del formulario).
export function RepartoPagadores({ id = 'pe-pagado_por', filas, onChange, total = 0, error = null, ayuda = null }) {
  const montos = montosReparto(total, filas)
  const suma = filas.reduce((s, f) => s + num(f.porcentaje), 0)
  const cambiar = (i, campo, valor) => onChange(filas.map((f, k) => (k === i ? { ...f, [campo]: valor } : f)))
  const quitar = (i) => onChange(filas.length > 1 ? filas.filter((_, k) => k !== i) : [filaVacia()])
  const agregar = () => {
    const resto = Math.round((100 - suma) * 100) / 100
    const libre = QUIENES_PAGAN.find((q) => !filas.some((f) => f.quien === q)) ?? ''
    onChange([...filas, { quien: libre, porcentaje: resto > 0 ? String(resto) : '' }])
  }
  const errId = `${id}-error`
  return (
    <div className={`pe-reparto${error ? ' pe-campo--error' : ''}`} role="group" aria-labelledby={`${id}-titulo`} aria-describedby={error ? errId : ayuda ? `${id}-ayuda` : undefined}>
      <div className="pe-reparto__cab">
        <span id={`${id}-titulo`} className="pe-reparto__titulo">Pagado por</span>
        <div className="pe-reparto__atajos">
          <button type="button" onClick={() => onChange(repartoUno(filas[0]?.quien ?? ''))}>100% uno</button>
          <button type="button" onClick={() => onChange(repartoMitades())}>50/50 Tomi y Gero</button>
        </div>
      </div>
      <ul className="pe-reparto__filas">
        {filas.map((f, i) => (
          <li key={i} className="pe-reparto__fila">
            <select id={i === 0 ? id : undefined} value={f.quien} onChange={(e) => cambiar(i, 'quien', e.target.value)} aria-label={`Quién paga (fila ${i + 1})`} aria-invalid={error ? true : undefined}>
              <option value="">— quién —</option>
              {QUIENES_PAGAN.map((q) => <option key={q} value={q} disabled={q !== f.quien && filas.some((o) => o.quien === q)}>{q}</option>)}
            </select>
            <div className="pe-reparto__pct">
              <input type="number" inputMode="decimal" step="0.01" min="0.01" max="100" value={f.porcentaje} onChange={(e) => cambiar(i, 'porcentaje', e.target.value)} aria-label={`Porcentaje (fila ${i + 1})`} aria-invalid={error ? true : undefined} />
              <span aria-hidden="true">%</span>
            </div>
            <span className="pe-reparto__usd" aria-label={`Monto en USD (fila ${i + 1})`}>= {usd(montos[i])}</span>
            <button type="button" className="quitar" onClick={() => quitar(i)} disabled={filas.length === 1 && !f.quien} aria-label={`Quitar fila ${i + 1}`} title="Quitar">✕</button>
          </li>
        ))}
      </ul>
      <div className="pe-reparto__pie">
        <button type="button" onClick={agregar} disabled={filas.length >= QUIENES_PAGAN.length}>+ Agregar quién paga</button>
        <span className={`pe-reparto__suma${Math.abs(suma - 100) > 0.01 && filas.some((f) => f.quien) ? ' pe-reparto__suma--mal' : ''}`}>Suma: {Math.round(suma * 100) / 100}%</span>
      </div>
      {ayuda && !error && <p id={`${id}-ayuda`} className="pe-ayuda">{ayuda}</p>}
      {error && <p id={errId} className="pe-error">{error}</p>}
    </div>
  )
}

/** Chips «Gero 80% · Tomi 20%» de una línea (o del texto de pagado_por si todavía no tiene reparto). */
export function ChipsPagadores({ linea, vacio = '—' }) {
  const chips = chipsDeLinea(linea)
  if (!chips.length) return <span className="pe-ayuda">{vacio}</span>
  return (
    <span className="pe-chips" title={chips.map((c) => c.texto).join(' · ')}>
      {chips.map((c) => <span key={c.quien} className="pe-chip">{c.texto}</span>)}
    </span>
  )
}
