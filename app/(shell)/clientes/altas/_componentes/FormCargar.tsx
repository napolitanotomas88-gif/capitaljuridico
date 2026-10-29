'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'
import { enviarAccion, nuevoId, type Respuesta } from './enviar'

// Formulario de «Cargar alta»: el texto tal cual lo mandó el closer (#ALTA o formato libre), el closer (un closer con
// sesión carga solo a su nombre) y 1 o más comprobantes. "Vista previa" no escribe nada; "Cargar alta" lo manda al bot.
type Previa = Respuesta & {
  tipo?: string
  datos?: Record<string, unknown>
  comprobantes?: { nombre: string; bytes: number }[]
  faltantes?: string[]; avisos?: string[]
  preguntas?: { quien: string; paso: string; texto: string }[]
  haria?: string[]
}

const usd = (n: unknown) => (typeof n === 'number' ? `USD ${n.toLocaleString('es-AR')}` : null)
const fecha = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x.split('-').reverse().join('/') : null)

export function FormCargar({ closers, closerFijo }: { closers: string[]; closerFijo: string | null }) {
  const base = useId()
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const id = useRef(nuevoId())
  const [ocupado, setOcupado] = useState<null | 'previa' | 'cargar'>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [res, setRes] = useState<Respuesta | null>(null)

  async function mandar(accion: 'previsualizar' | 'cargar') {
    if (!form.current || ocupado) return
    const fd = new FormData(form.current)
    fd.set('accion', accion)
    fd.set('id', id.current)
    if (closerFijo) fd.set('closer', closerFijo)
    setOcupado(accion === 'cargar' ? 'cargar' : 'previa'); setRes(null)
    const r = await enviarAccion(fd)
    setOcupado(null)
    if (accion === 'previsualizar') { setPrevia(r as Previa); return }
    setRes(r)
    if (r.ok) {
      form.current.reset(); setPrevia(null); id.current = nuevoId()
      setTimeout(() => router.refresh(), 4000)
    }
  }

  const d = previa?.ok ? previa.datos ?? {} : {}
  const filas: [string, string | null][] = [
    ['Tipo', previa?.tipo === 'libre' ? 'Formato libre (se confirma en Verificaciones)' : previa?.tipo ?? null],
    ['Cliente', (d.nombre as string) ?? null], ['Closer', (d.closer as string) ?? null], ['Programa', (d.programa as string) ?? null],
    ['Teléfono', (d.telefono as string) ?? null], ['Correo', (d.correo as string) ?? null],
    ['Pago', [d.modalidad, usd(d.totalUsd)].filter(Boolean).join(' ') || null], ['Este pago', usd(d.estePagoUsd) ?? (d.pagoEnPesos ? 'En pesos' : null)],
    ['Inicio', fecha(d.inicio)], ['Socios', (d.socios as string) ?? null],
  ]

  return (
    <div className="cj-pila cj-pila--chica">
      <form ref={form} className="cj-formulario cj-altas__form cj-panel" onSubmit={(e) => { e.preventDefault(); void mandar('cargar') }} noValidate>
        <div className="cj-formulario__campo">
          <label htmlFor={`${base}-texto`} className="cj-etiqueta">Alta tal cual la mandó el closer</label>
          <textarea id={`${base}-texto`} name="texto" className="cj-campo__entrada" required maxLength={20000} placeholder={'#ALTA\nPrograma: Agencia\nTipo de pago: PIF 1300 USD\nEste pago: 1300 USD · Transferencia\nNombre completo: …\nTeléfono: …\nCorreo: …'} />
          <span className="cj-formulario__ayuda">Con #ALTA o en formato libre (nombre, teléfono o correo y el pago). Mismas reglas que en WhatsApp: Fee, cliente existente y primera cuota.</span>
        </div>
        <div className="cj-formulario__campo">
          <label htmlFor={`${base}-closer`} className="cj-etiqueta">Closer</label>
          {closerFijo ? (
            <p className="cj-parrafo">{closerFijo} <span className="cj-texto-2">(cargás a tu nombre)</span></p>
          ) : (
            <select id={`${base}-closer`} name="closer" className="cj-campo__entrada" defaultValue="" required>
              <option value="" disabled>Elegí el closer</option>
              {closers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div className="cj-formulario__campo">
          <label htmlFor={`${base}-archivos`} className="cj-etiqueta">Comprobantes (imagen o PDF)</label>
          <input id={`${base}-archivos`} name="archivos" type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" className="cj-campo__entrada" />
          <span className="cj-formulario__ayuda">Uno o más, hasta 4 MB cada uno (4,4 MB entre todos).</span>
        </div>
        <div className="cj-formulario__acciones">
          <Boton variante="secundario" onClick={() => void mandar('previsualizar')} disabled={!!ocupado} aria-busy={ocupado === 'previa'}>{ocupado === 'previa' ? 'Leyendo…' : 'Vista previa'}</Boton>
          <Boton type="submit" variante="marca" disabled={!!ocupado} aria-busy={ocupado === 'cargar'}>{ocupado === 'cargar' ? 'Cargando…' : 'Cargar alta'}</Boton>
        </div>
        <div aria-live="polite">
          {res && <p className={`cj-altas__resultado${res.ok ? '' : ' cj-altas__resultado--error'}`}>{res.mensaje}</p>}
        </div>
      </form>

      {previa && (
        <div className="cj-panel cj-altas__previa" aria-live="polite">
          {!previa.ok ? <p className="cj-altas__resultado cj-altas__resultado--error">{previa.mensaje}</p> : (
            <>
              <p className="cj-etiqueta cj-etiqueta--laton">Vista previa · no se cargó nada</p>
              <dl>{filas.filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              <p>Comprobantes: {previa.comprobantes?.length ? previa.comprobantes.map((c) => c.nombre).join(', ') : <strong>ninguno (hace falta al menos uno para cargar)</strong>}</p>
              {!!previa.faltantes?.length && <><p><strong>Le falta al closer:</strong></p><ul className="cj-altas__lista">{previa.faltantes.map((x) => <li key={x}>{x}</li>)}</ul></>}
              {!!previa.avisos?.length && <><p><strong>Para revisar:</strong></p><ul className="cj-altas__lista">{previa.avisos.map((x) => <li key={x}>{x}</li>)}</ul></>}
              {!!previa.preguntas?.length && <><p><strong>Preguntaría:</strong></p>{previa.preguntas.map((q, i) => <div key={i}><p className="cj-texto-2">{q.quien} · {q.paso}</p><pre className="cj-altas__texto">{q.texto}</pre></div>)}</>}
              {!!previa.haria?.length && <details><summary>Qué haría el bot ({previa.haria.length})</summary><ul className="cj-altas__lista">{previa.haria.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
              <p className="cj-texto-2">La vista previa no lee el comprobante ni el CRM: eso pasa al cargar.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
