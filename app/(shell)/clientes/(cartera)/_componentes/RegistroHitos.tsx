'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { NOMBRE_FUENTE_HITO, NOMBRE_HITO, textoFechaHito, type ClaveHito, type Hito } from '@/lib/clientes/hitos'

// Registro de hitos en la tarjeta del cliente (25/10/2026, pedido de Tomás: "llevar literalmente el registro de todo").
// Cada hito se completa solo con lo que muestran las fuentes (lib/clientes/hitos.ts) y se puede anotar o corregir a mano:
// POST /api/clientes/<id>/hitos (tabla cj_hitos). Lo anotado manda sobre lo automático; "Quitar lo anotado" vuelve a lo
// automático. Después de guardar se refresca la página: la etapa del cliente se recalcula con el registro nuevo.

type Props = { idCrm: string; hitos: Hito[]; hoy: string; demo: boolean }

export function RegistroHitos({ idCrm, hitos, hoy, demo }: Props) {
  const router = useRouter()
  const [editando, setEditando] = useState<ClaveHito | null>(null)
  const [guardado, setGuardado] = useState<ClaveHito | null>(null)
  const [actualizando, empezar] = useTransition()
  // Al cerrar el formulario (guardar o cancelar) el foco vuelve al botón del hito, que reemplaza al formulario
  const cerrar = (clave: ClaveHito, guardo: boolean) => {
    setEditando(null)
    if (guardo) { setGuardado(clave); empezar(() => router.refresh()) }
    requestAnimationFrame(() => document.getElementById(`rc-hito-${clave}`)?.focus())
  }
  return (
    <>
    <p className="rc-hito__estado" role="status" aria-live="polite">
      {guardado && (actualizando ? `Guardado «${NOMBRE_HITO[guardado]}»: actualizando la etapa…` : `Guardado «${NOMBRE_HITO[guardado]}».`)}
    </p>
    <ol className="rc-hitos" aria-label="Registro del cliente">
      {hitos.map(h => (
        <li key={h.clave} className={`rc-hito${h.hecho ? ' rc-hito--hecho' : ''}${h.fuente === 'inferido' ? ' rc-hito--inferido' : ''}`}>
          <span className="rc-hito__punto" aria-hidden />
          <div className="rc-hito__cuerpo">
            <div className="rc-hito__fila">
              <span className="rc-hito__nombre">{NOMBRE_HITO[h.clave]}</span>
              <span className="rc-hito__fecha">{textoFechaHito(h)}</span>
            </div>
            {h.hecho && (
              <p className="rc-hito__fuente">
                {h.fuente ? NOMBRE_FUENTE_HITO[h.fuente] : ''}
                {h.detalle && h.fuente !== 'manual' ? ` · ${h.detalle}` : ''}
                {h.manual && <> · {h.manual.nota ? `«${h.manual.nota}» · ` : ''}{h.manual.quien}</>}
              </p>
            )}
            {editando === h.clave ? (
              <FormHito idCrm={idCrm} hito={h} hoy={hoy} demo={demo} onCerrar={guardo => cerrar(h.clave, guardo)} />
            ) : (
              <button type="button" id={`rc-hito-${h.clave}`} className="rc-hito__accion" onClick={() => { setGuardado(null); setEditando(h.clave) }}>
                {h.manual ? 'Corregir' : h.hecho ? 'Anotar la fecha real' : 'Anotar'}
                <span className="cj-solo-lectores"> {NOMBRE_HITO[h.clave]}</span>
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
    </>
  )
}

function FormHito({ idCrm, hito, hoy, demo, onCerrar }: { idCrm: string; hito: Hito; hoy: string; demo: boolean; onCerrar: (guardo: boolean) => void }) {
  const [fecha, setFecha] = useState(hito.manual?.fecha ?? hito.fecha ?? hoy)
  // Corregir un hito anotado "sin fecha" arranca así (no le pone la de hoy sin avisar)
  const [sinFecha, setSinFecha] = useState(hito.manual ? hito.manual.fecha === null : false)
  const [nota, setNota] = useState(hito.manual?.nota ?? '')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (cuerpo: Record<string, unknown>) => {
    if (demo) { setError('Con los datos de ejemplo (?demo=1) no se guarda nada.'); return }
    setEnviando(true); setError(null)
    try {
      const r = await fetch(`/api/clientes/${encodeURIComponent(idCrm)}/hitos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensaje?: string }
      if (!r.ok || !j.ok) { setError(j.mensaje ?? 'No se pudo guardar. Probá de nuevo.'); return }
      onCerrar(true)
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="rc-hito__form" onSubmit={e => { e.preventDefault(); void enviar({ hito: hito.clave, fecha: sinFecha ? null : fecha, nota }) }}>
      <div className="rc-hito__campos">
        <label className="rc-campo">
          <span className="cj-etiqueta">Fecha</span>
          <input type="date" className="rc-input" value={fecha} max={hoy} min="2024-01-01" disabled={sinFecha} onChange={e => setFecha(e.target.value)} required={!sinFecha} />
        </label>
        <label className="rc-hito__check">
          <input type="checkbox" checked={sinFecha} onChange={e => setSinFecha(e.target.checked)} /> Hecho, no sé la fecha
        </label>
        <label className="rc-campo rc-hito__nota">
          <span className="cj-etiqueta">Nota (opcional)</span>
          <input type="text" className="rc-input" value={nota} maxLength={300} onChange={e => setNota(e.target.value)} placeholder="Por ejemplo: grabó 6 videos" />
        </label>
      </div>
      {error && <p className="rc-hito__error" role="alert">{error}</p>}
      <div className="rc-hito__botones">
        <button type="submit" className="cj-boton cj-boton--primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="cj-boton cj-boton--secundario" onClick={() => onCerrar(false)} disabled={enviando}>Cancelar</button>
        {hito.manual && (
          <button type="button" className="rc-limpiar" disabled={enviando} onClick={() => void enviar({ hito: hito.clave, borrar: true })}>Quitar lo anotado</button>
        )}
      </div>
    </form>
  )
}
