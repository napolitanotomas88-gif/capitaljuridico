'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'
import { useConfirmacion } from '@/components/ui/Confirmacion'

// Acciones de la encuesta mensual (4/11/2026): marcar el envío, quitar una marca y asignar o descartar una respuesta.
// Todas van a POST /api/clientes/encuesta y recargan la pantalla. Usa las clases de «Cargar alta» (altas.css).
function useAccionEncuesta() {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [msj, setMsj] = useState<{ ok: boolean; texto: string } | null>(null)
  const [confirmar, dialogo] = useConfirmacion()
  async function enviar(cuerpo: Record<string, unknown>) {
    if (ocupado) return
    setOcupado(true); setMsj(null)
    try {
      const r = await fetch('/api/clientes/encuesta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string }
      setMsj({ ok: r.ok, texto: j.mensaje ?? (r.ok ? 'Listo.' : 'No se pudo guardar.') })
      if (r.ok) setTimeout(() => router.refresh(), 800)
    } catch { setMsj({ ok: false, texto: 'Sin conexión: no se guardó.' }) } finally { setOcupado(false) }
  }
  const resultado = <>{dialogo}<div aria-live="polite">{msj && <p className={`cj-altas__resultado${msj.ok ? '' : ' cj-altas__resultado--error'}`}>{msj.texto}</p>}</div></>
  return { ocupado, enviar, confirmar, resultado }
}

export type ActivoVista = { id: string; nombre: string; responsable: string; ultimoEnvio: string | null }

export function MarcarEnvio({ activos, hoy, minimo }: { activos: ActivoVista[]; hoy: string; minimo: string }) {
  const { ocupado, enviar, confirmar, resultado } = useAccionEncuesta()
  const [dia, setDia] = useState(hoy)
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(activos.map((a) => a.id)))
  const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <section className="cj-panel cj-altas__tarjeta" aria-labelledby="encuesta-marcar">
      <div className="cj-altas__cabeza">
        <h2 id="encuesta-marcar" className="cj-altas__nombre">Marcar encuesta enviada</h2>
        <span className="cj-texto-2">{elegidos.size} de {activos.length} clientes activos elegidos</span>
      </div>
      <p className="cj-texto-2">Mandá el Typeform a mano y después marcalo acá. Cuentan las respuestas desde las 00:00 del día que elijas.</p>
      <div className="cj-altas__botones">
        <label className="cj-texto-2" htmlFor="encuesta-dia">Fecha de envío</label>
        <input id="encuesta-dia" type="date" className="cj-campo__entrada" value={dia} min={minimo} max={hoy} onChange={(e) => setDia(e.target.value)} />
        <Boton variante="secundario" onClick={() => setElegidos(new Set(activos.map((a) => a.id)))}>Todos</Boton>
        <Boton variante="secundario" onClick={() => setElegidos(new Set())}>Ninguno</Boton>
      </div>
      <details>
        <summary className="cj-enlace">Elegir clientes</summary>
        <ul className="cj-encuesta__elegir">
          {activos.map((a) => (
            <li key={a.id}>
              <label>
                <input type="checkbox" checked={elegidos.has(a.id)} onChange={() => alternar(a.id)} /> {a.id} · {a.nombre}
                <span className="cj-texto-2"> · {a.responsable}{a.ultimoEnvio ? `, último envío ${a.ultimoEnvio}` : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>
      <div className="cj-altas__botones">
        <Boton disabled={ocupado || elegidos.size === 0} onClick={async () => {
          const ok = await confirmar({
            titulo: `¿Marcar la encuesta como enviada a ${elegidos.size} clientes el ${dia}?`,
            detalle: 'Queda anotado el envío de ese día para cada uno. Si te equivocaste, se quita cliente por cliente con «Quitar».',
            accion: 'Marcar enviada',
          })
          if (ok) void enviar({ accion: 'enviada', ids: [...elegidos], dia })
        }}>
          {ocupado ? 'Guardando…' : `Marcar enviada (${elegidos.size})`}
        </Boton>
      </div>
      {resultado}
    </section>
  )
}

export function QuitarEnvio({ id, dia, nombre }: { id: string; dia: string; nombre: string }) {
  const { ocupado, enviar, confirmar, resultado } = useAccionEncuesta()
  return (
    <>
      <Boton variante="secundario" disabled={ocupado} onClick={async () => {
        const ok = await confirmar({ titulo: `¿Quitar la marca de envío de ${nombre}?`, detalle: 'Ese día deja de figurar como enviado. Se puede volver a marcar.', accion: 'Quitar la marca', peligro: true })
        if (ok) void enviar({ accion: 'quitar', id, dia })
      }}>Quitar</Boton>
      {resultado}
    </>
  )
}

export function AsignarRespuesta({ clave, sugerido }: { clave: string; sugerido: string | null }) {
  const { ocupado, enviar, confirmar, resultado } = useAccionEncuesta()
  const [id, setId] = useState(sugerido ?? '')
  return (
    <>
      <div className="cj-altas__botones">
        <input className="cj-campo__entrada" placeholder="ID del CRM (A123)" value={id} onChange={(e) => setId(e.target.value)} maxLength={8} aria-label="ID del cliente" />
        <Boton disabled={ocupado || !id.trim()} onClick={() => void enviar({ accion: 'asignar', clave, id: id.trim() })}>Asignar</Boton>
        <Boton variante="secundario" disabled={ocupado} onClick={async () => {
          const ok = await confirmar({ titulo: '¿Descartar esta respuesta?', detalle: 'Sale de la lista y no cuenta para ningún cliente. No se puede deshacer desde el Despacho.', accion: 'Descartar', peligro: true })
          if (ok) void enviar({ accion: 'descartar', clave })
        }}>Descartar</Boton>
      </div>
      {resultado}
    </>
  )
}
