'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'

// "Actualizar referido" (27/10/2026): avanza un referido ya cargado con PATCH /api/referidos (estado, fecha de la llamada,
// cliente nuevo, primer pago, reembolso, nota). Escribe solo sobre su fila; el servidor valida y rechaza si otro lo cambió antes.
// Solo Tomás, Gero A, Gero M y Aylu (si no, el servidor responde 403 y se muestra).
export type DatosReferido = {
  id: string; nombre: string; estado: string; fechaLlamada: string | null
  idClienteNuevo: string; fechaPrimerPago: string | null; reembolso: boolean
}
type Props = { referido: DatosReferido; estados: readonly string[]; clientes: { id: string; nombre: string }[]; hoy: string }
type Resultado = { tono: 'ok' | 'aviso' | 'error'; mensaje: string; avisos?: string[] }

const CON_LLAMADA = ['Asistió', 'No asistió', 'No cerró', 'Cerró']

export function ActualizarReferido({ referido, estados, clientes, hoy }: Props) {
  const base = useId()
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [estado, setEstado] = useState(referido.estado || 'Presentado')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [res, setRes] = useState<Resultado | null>(null)
  const id = (n: string) => `${base}-${n}`

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (enviando) return
    setEnviando(true); setErrores({}); setRes(null)
    const f = new FormData(e.currentTarget)
    const cuerpo = {
      id: referido.id, estadoAnterior: referido.estado, estado,
      fechaLlamada: String(f.get('fechaLlamada') ?? ''), idClienteNuevo: String(f.get('idClienteNuevo') ?? ''),
      fechaPrimerPago: String(f.get('fechaPrimerPago') ?? ''), reembolso: f.get('reembolso') === 'si', nota: String(f.get('nota') ?? ''),
    }
    try {
      const r = await fetch('/api/referidos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 422 && j.errores) setErrores(j.errores)
      else if (r.ok && j.ok) {
        setRes({ tono: j.estado === 'guardado' ? 'ok' : 'aviso', mensaje: j.mensaje, avisos: j.avisos })
        if (j.estado === 'guardado') router.refresh()
      } else setRes({ tono: 'error', mensaje: j.mensaje ?? j.error ?? 'No se pudo guardar. Probá de nuevo.' })
    } catch {
      setRes({ tono: 'error', mensaje: 'No hay conexión con el servidor. No se guardó nada.' })
    } finally {
      setEnviando(false)
    }
  }

  const error = (n: string) => errores[n] && <span className="cj-formulario__error" role="alert">{errores[n]}</span>
  const cierra = estado === 'Cerró'
  return (
    <div className="cj-formulario-envoltorio">
      <Boton variante="secundario" onClick={() => setAbierto(a => !a)} aria-expanded={abierto} aria-controls={id('panel')}>
        {abierto ? 'Cerrar' : 'Actualizar'}
      </Boton>
      {abierto && (
        <form id={id('panel')} onSubmit={enviar} className="cj-formulario cj-panel" noValidate>
          <div className="cj-formulario__campo">
            <label htmlFor={id('estado')} className="cj-etiqueta">Estado</label>
            <select id={id('estado')} className="cj-campo__entrada" value={estado} onChange={e => setEstado(e.target.value)}>
              {estados.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {error('estado')}
          </div>
          {CON_LLAMADA.includes(estado) && (
            <div className="cj-formulario__campo">
              <label htmlFor={id('fl')} className="cj-etiqueta">Fecha de la llamada</label>
              <input id={id('fl')} name="fechaLlamada" type="date" max={hoy} defaultValue={referido.fechaLlamada ?? ''} className="cj-campo__entrada" />
              {error('fechaLlamada')}
            </div>
          )}
          {cierra && (
            <>
              <div className="cj-formulario__campo">
                <label htmlFor={id('cn')} className="cj-etiqueta">Cliente nuevo</label>
                <select id={id('cn')} name="idClienteNuevo" defaultValue={referido.idClienteNuevo} className="cj-campo__entrada">
                  <option value="">Elegí el cliente que se dio de alta</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.id})</option>)}
                </select>
                {error('idClienteNuevo')}
              </div>
              <div className="cj-formulario__campo">
                <label htmlFor={id('fp')} className="cj-etiqueta">Fecha del primer pago</label>
                <input id={id('fp')} name="fechaPrimerPago" type="date" max={hoy} defaultValue={referido.fechaPrimerPago ?? ''} className="cj-campo__entrada" />
                <span className="cj-formulario__ayuda">El crédito se libera 14 días después, si no hay reembolso.</span>
                {error('fechaPrimerPago')}
              </div>
              <label className="cj-parrafo"><input type="checkbox" name="reembolso" value="si" defaultChecked={referido.reembolso} /> Pidió reembolso</label>
              {error('reembolso')}
            </>
          )}
          <div className="cj-formulario__campo">
            <label htmlFor={id('nota')} className="cj-etiqueta">Nota (opcional)</label>
            <input id={id('nota')} name="nota" maxLength={300} className="cj-campo__entrada" autoComplete="off" />
          </div>
          <div className="cj-formulario__acciones">
            <Boton type="submit" variante="primario" disabled={enviando} aria-busy={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</Boton>
          </div>
          <div aria-live="polite">
            {res && (
              <div className={`cj-aviso cj-formulario__resultado cj-formulario__resultado--${res.tono}`}>
                <p>{res.mensaje}</p>
                {res.avisos?.map(a => <p key={a} className="cj-texto-2">{a}</p>)}
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
