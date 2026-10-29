'use client'

import { useId, useRef, useState } from 'react'
import { Boton } from '@/components/ui'

// "Registrar referido": formulario que manda UNA alta a POST /api/referidos (el servidor valida, decide y escribe).
// Estado inicial siempre "Presentado". No otorga créditos ni canjea nada. Sirve desde la ficha (cliente fijo) y desde
// /clientes/referidos (se elige el cliente). Por defecto el servidor está en modo de revisión: no guarda y lo dice.
export type OpcionCliente = { id: string; nombre: string }
type Props = { referidor?: OpcionCliente; opciones?: OpcionCliente[]; momentos: string[]; hoy: string }
type Errores = Partial<Record<string, string>>
type Resultado = { ok: boolean; tono: 'ok' | 'aviso' | 'error'; mensaje: string; avisos?: string[] }

const nuevaClave = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)

export function RegistrarReferido({ referidor, opciones = [], momentos, hoy }: Props) {
  const base = useId()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errores, setErrores] = useState<Errores>({})
  const [res, setRes] = useState<Resultado | null>(null)
  const clave = useRef(nuevaClave())
  const form = useRef<HTMLFormElement>(null)
  const id = (n: string) => `${base}-${n}`

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (enviando) return // doble clic: no se manda dos veces
    setEnviando(true); setErrores({}); setRes(null)
    const f = new FormData(e.currentTarget)
    const cuerpo = Object.fromEntries([...f.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']))
    if (referidor) cuerpo.idReferidor = referidor.id
    cuerpo.claveEnvio = clave.current
    try {
      const r = await fetch('/api/referidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 422 && j.errores) setErrores(j.errores)
      else if (r.ok && j.ok) {
        setRes({ ok: true, tono: j.estado === 'ya_existia' || j.estado === 'simulado' ? 'aviso' : 'ok', mensaje: j.mensaje, avisos: j.avisos })
        if (j.estado === 'guardado') { form.current?.reset(); clave.current = nuevaClave() }
      } else if (r.status === 401) setRes({ ok: false, tono: 'error', mensaje: 'Tu sesión venció. Recargá la página y entrá de nuevo.' })
      else if (r.status === 403) setRes({ ok: false, tono: 'error', mensaje: 'Tu rol no puede registrar referidos.' })
      else setRes({ ok: false, tono: 'error', mensaje: j.mensaje ?? j.error ?? 'No se pudo guardar. Probá de nuevo.' })
    } catch {
      setRes({ ok: false, tono: 'error', mensaje: 'No hay conexión con el servidor. No se guardó nada.' })
    } finally {
      setEnviando(false)
    }
  }

  const campo = (n: string, etiqueta: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, ayuda?: string) => (
    <div className="cj-formulario__campo">
      <label htmlFor={id(n)} className="cj-etiqueta">{etiqueta}</label>
      <input id={id(n)} name={n} className="cj-campo__entrada" aria-invalid={errores[n] ? true : undefined} aria-describedby={errores[n] ? id(`${n}-e`) : ayuda ? id(`${n}-a`) : undefined} {...props} />
      {ayuda && !errores[n] && <span id={id(`${n}-a`)} className="cj-formulario__ayuda">{ayuda}</span>}
      {errores[n] && <span id={id(`${n}-e`)} className="cj-formulario__error" role="alert">{errores[n]}</span>}
    </div>
  )

  return (
    <div className="cj-formulario-envoltorio">
      <Boton variante="secundario" onClick={() => setAbierto(a => !a)} aria-expanded={abierto} aria-controls={id('panel')}>
        {abierto ? 'Cerrar' : 'Registrar referido'}
      </Boton>
      {abierto && (
        <form id={id('panel')} ref={form} onSubmit={enviar} className="cj-formulario cj-panel" noValidate>
          <p className="cj-parrafo cj-texto-2">Se carga como “Presentado”. No suma ni canjea créditos: eso lo calcula el programa a partir de las filas.</p>
          {referidor ? (
            <p className="cj-parrafo"><span className="cj-etiqueta">Cliente que refiere</span><br />{referidor.nombre} <span className="cj-texto-2">({referidor.id})</span></p>
          ) : (
            <div className="cj-formulario__campo">
              <label htmlFor={id('idReferidor')} className="cj-etiqueta">Cliente que refiere</label>
              <select id={id('idReferidor')} name="idReferidor" className="cj-campo__entrada" defaultValue="" aria-invalid={errores.idReferidor ? true : undefined}>
                <option value="" disabled>Elegí el cliente que refirió</option>
                {opciones.map(o => <option key={o.id} value={o.id}>{o.nombre} ({o.id})</option>)}
              </select>
              {errores.idReferidor && <span className="cj-formulario__error" role="alert">{errores.idReferidor}</span>}
            </div>
          )}
          {campo('nombre', 'Nombre del referido', { required: true, autoComplete: 'off', maxLength: 120 })}
          {campo('telefono', 'Teléfono', { required: true, inputMode: 'tel', autoComplete: 'off', placeholder: '+54 9 351 555 1234' }, 'Con código de país si lo sabés. Sirve para no cargar dos veces a la misma persona.')}
          {campo('mail', 'Mail (opcional)', { type: 'email', autoComplete: 'off', maxLength: 120 })}
          {campo('estudio', 'Estudio del referido', { required: true, autoComplete: 'off', maxLength: 120 }, 'Tiene que ser distinto al del cliente que refiere.')}
          <div className="cj-formulario__campo">
            <label htmlFor={id('momento')} className="cj-etiqueta">Momento del pedido</label>
            <select id={id('momento')} name="momento" className="cj-campo__entrada" defaultValue="" aria-invalid={errores.momento ? true : undefined}>
              <option value="" disabled>Elegí el momento</option>
              {momentos.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {errores.momento && <span className="cj-formulario__error" role="alert">{errores.momento}</span>}
          </div>
          {campo('fechaPedido', 'Fecha del pedido', { type: 'date', defaultValue: hoy, max: hoy, min: '2026-10-01' }, 'Desde el 1/10/2026, cuando arrancó el programa: lo anterior no suma.')}
          {campo('notas', 'Notas (opcional)', { maxLength: 300 })}
          {campo('idClienteNuevo', 'Ya es cliente: su ID (opcional)', { autoComplete: 'off', maxLength: 12, placeholder: 'A170' }, 'Solo para cargar un referido que ya cerró y está en el CRM. Después marcalo "Cerró" con la fecha del primer pago.')}
          <div className="cj-formulario__acciones">
            <Boton type="submit" variante="primario" disabled={enviando} aria-busy={enviando}>{enviando ? 'Guardando…' : 'Guardar referido'}</Boton>
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
