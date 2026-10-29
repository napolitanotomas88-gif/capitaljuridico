'use client'

import { useId, useRef, useState } from 'react'
import { Boton } from '@/components/ui'

// "Canjear crédito": formulario en dos pasos contra POST /api/referidos/canje. 1) Vista previa (siempre simula: calcula el movimiento que se
// asentaría en el libro "Créditos"). 2) Si el servidor avisa que la escritura real está disponible para quien pide (`escrituraReal`), aparece
// "Confirmar canje" con los meses y los USD, y recién ahí se asienta (misma clave de envío: reintentar no duplica). Sin la bandera real, sigue
// siendo solo simulación. Los meses de servicio y los USD se muestran SIEMPRE por separado: nunca se suman ni se convierten. Solo contra la renovación.
type Saldo = { meses: number; usd: number; renovacionGratis: boolean; extras: string[] }
type Movimiento = { fecha: string; tipo: string; meses: number; extra: string; renovacionAplicada: string; nota: string }
type Respuesta = {
  politicaSaldo?: { texto: string }
  ok: boolean; estado?: string; codigo?: string; motivo?: string; mensaje?: string; esDemo?: boolean; avisos?: string[]; escrituraReal?: boolean; id?: string
  saldo?: Saldo; referenciaMeses?: { pagoUnicoUSD: number; planDePagosUSD: number }; movimiento?: Movimiento
  errores?: Record<string, string>; error?: string
}

type Props = { idCliente: string; hoy: string; demo?: boolean }

const nuevaClave = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)
const num = (n: number) => n.toLocaleString('es-AR')

export function CanjeCreditos({ idCliente, hoy, demo = false }: Props) {
  const base = useId()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [res, setRes] = useState<Respuesta | null>(null)
  const [status, setStatus] = useState(0)
  const [real, setReal] = useState(false)                           // el servidor avisó que este canje se puede asentar de verdad
  const [previa, setPrevia] = useState<{ pedido: Record<string, unknown>; saldo: Saldo } | null>(null)  // lo que se va a confirmar
  const clave = useRef(nuevaClave())
  const id = (n: string) => `${base}-${n}`

  async function mandar(cuerpo: Record<string, unknown>): Promise<Respuesta | null> {
    if (enviando) return null
    setEnviando(true); setRes(null); setStatus(0)
    try {
      const r = await fetch('/api/referidos/canje', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
      setStatus(r.status)
      const j: Respuesta = await r.json().catch(() => ({ ok: false, mensaje: 'Respuesta ilegible del servidor.' }))
      setRes(j)
      return j
    } catch {
      setRes({ ok: false, mensaje: 'No hay conexión con el servidor. No se sabe si se guardó: reintentá el mismo canje (no se duplica).' })
      return null
    } finally {
      setEnviando(false)
    }
  }

  // Paso 1: vista previa (nunca escribe)
  async function revisar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const pedido = { idCliente, renovacionAplicada: String(f.get('renovacionAplicada') ?? ''), fecha: String(f.get('fecha') ?? ''), contexto: 'renovacion', claveEnvio: clave.current, demo }
    setPrevia(null); setReal(false)
    const j = await mandar({ ...pedido, vistaPrevia: true })
    if (j?.ok && j.estado === 'simulado' && j.escrituraReal && j.saldo) { setReal(true); setPrevia({ pedido, saldo: j.saldo }) }
  }

  // Paso 2: confirmar (escritura real, misma clave: un reintento completa el mismo canje)
  async function confirmar() {
    if (!previa || !real) return
    const j = await mandar(previa.pedido)
    if (j?.ok && j.estado === 'guardado') setPrevia(null)
  }

  // Cambiar la renovación invalida la vista previa: otro pedido, otra clave
  const cambio = () => { if (previa) { setPrevia(null); clave.current = nuevaClave() } }

  const errores = res?.errores ?? {}
  const saldo = res?.saldo
  const guardado = res?.ok && res.estado === 'guardado'
  const pendiente = res?.codigo === 'pendiente_confirmacion'
  const tono = res?.ok ? 'aviso' : 'error'
  const mensaje = res?.mensaje ?? res?.error ?? (status === 401 ? 'Tu sesión venció. Recargá la página y entrá de nuevo.' : status === 403 ? 'Tu rol no puede canjear créditos.' : status === 422 ? 'Revisá los datos del canje.' : '')

  return (
    <div className="cj-formulario-envoltorio">
      <Boton variante="secundario" onClick={() => setAbierto(a => !a)} aria-expanded={abierto} aria-controls={id('panel')}>
        {abierto ? 'Cerrar' : demo ? 'Canjear crédito (simulación)' : 'Canjear crédito'}
      </Boton>
      {abierto && (
        <form id={id('panel')} onSubmit={revisar} className="cj-formulario cj-panel" noValidate>
          <p className="cj-parrafo cj-texto-2">
            {real
              ? 'Primero revisás el canje y después lo confirmás: recién ahí se asienta en el libro “Créditos”.'
              : demo ? 'Cliente de ejemplo: calcula el movimiento que se asentaría en el libro “Créditos” y no guarda nada.'
                : 'Revisá el canje para consultar el saldo y comprobar si se puede confirmar. La revisión no guarda cambios.'}{' '}
            Los meses liberados se aplican automáticamente al confirmar una nueva renovación desde la tarjeta del cliente.
            Los créditos en USD requieren un canje manual y nunca se descuentan automáticamente. Este canje manual usa todo el saldo disponible del ciclo,
            solo contra la renovación (nunca en efectivo), con los meses y los USD por separado; la escalera vuelve a empezar.
          </p>
          <div className="cj-formulario__campo">
            <label htmlFor={id('ren')} className="cj-etiqueta">Renovación a la que se aplica</label>
            <input id={id('ren')} name="renovacionAplicada" className="cj-campo__entrada" required maxLength={120} autoComplete="off" placeholder="Renovación 2026-11" onChange={cambio} aria-invalid={errores.renovacionAplicada ? true : undefined} />
            {errores.renovacionAplicada && <span className="cj-formulario__error" role="alert">{errores.renovacionAplicada}</span>}
          </div>
          <div className="cj-formulario__campo">
            <label htmlFor={id('fecha')} className="cj-etiqueta">Fecha del canje</label>
            <input id={id('fecha')} name="fecha" type="date" className="cj-campo__entrada" defaultValue={hoy} min={hoy} max={hoy} readOnly aria-describedby={id('fecha-a')} aria-invalid={errores.fecha ? true : undefined} />
            <span id={id('fecha-a')} className="cj-formulario__ayuda">Solo con la fecha de hoy: todavía no hay una regla para canjear con fecha pasada.</span>
            {errores.fecha && <span className="cj-formulario__error" role="alert">{errores.fecha}</span>}
          </div>
          <div className="cj-formulario__acciones">
            <Boton type="submit" variante={previa ? 'secundario' : 'primario'} disabled={enviando} aria-busy={enviando}>{enviando && !previa ? 'Calculando…' : demo ? 'Simular canje' : 'Revisar canje'}</Boton>
            {previa && real && (
              <Boton type="button" variante="primario" onClick={confirmar} disabled={enviando} aria-busy={enviando}>
                {enviando ? 'Asentando…' : pendiente ? 'Reintentar el mismo canje' : `Confirmar canje: ${num(previa.saldo.meses)} ${previa.saldo.meses === 1 ? 'mes' : 'meses'} y USD ${num(previa.saldo.usd)}`}
              </Boton>
            )}
          </div>
          <div aria-live="polite">
            {res && (
              <div className={`cj-aviso cj-formulario__resultado cj-formulario__resultado--${tono}`}>
                {mensaje && <p>{guardado ? <strong>{mensaje}</strong> : mensaje}</p>}
                {pendiente && <p className="cj-texto-2">Todavía NO está confirmado. Reintentá el mismo canje: se completa en la misma fila, sin duplicar.</p>}
                {saldo && (
                  <>
                    <p><strong>Meses de servicio:</strong> <span className="cj-num">{num(saldo.meses)}</span>{saldo.renovacionGratis ? ' (incluye la renovación gratis)' : ''}</p>
                    <p><strong>Crédito en USD:</strong> <span className="cj-num">USD {num(saldo.usd)}</span> <span className="cj-texto-2">(aparte de los meses: no se suman ni se convierten)</span></p>
                    {res.referenciaMeses && (
                      <p className="cj-texto-2">Referencia para reportes de los meses: USD {num(res.referenciaMeses.pagoUnicoUSD)} en pago único{saldo.renovacionGratis ? ` o USD ${num(res.referenciaMeses.planDePagosUSD)} en plan de pagos` : ''}. No es plata a pagar.</p>
                    )}
                  </>
                )}
                {res.movimiento && (
                  <p className="cj-texto-2">
                    Movimiento que se asentaría: canje del {res.movimiento.fecha}, {res.movimiento.meses !== 0 ? `${num(res.movimiento.meses)} meses` : 'sin meses'}
                    {res.movimiento.extra ? `, extra “${res.movimiento.extra}”` : ''}, renovación “{res.movimiento.renovacionAplicada}”.
                  </p>
                )}
                {res.politicaSaldo && <p className="cj-texto-2">{res.politicaSaldo.texto}</p>}
                {res.esDemo && <p className="cj-texto-2">Cliente de ejemplo: nada de esto sale de la planilla.</p>}
                {res.avisos?.map(a => <p key={a} className="cj-texto-2">{a}</p>)}
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
