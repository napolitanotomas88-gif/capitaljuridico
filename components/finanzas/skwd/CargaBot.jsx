import { useRef, useState } from 'react'
import { OPCIONES_PROGRAMA } from '../../../lib/bot/alta/finanzas'
import { CLOSERS_BOT, FUENTES_BOT, SETTERS_BOT, faltanParaBot, pagoParaBotVacio, textoAltaDesdePago } from '../../../lib/finanzasSkwd/altaDesdePago'
import { enviarAccion, nuevoId } from '../../../app/(shell)/clientes/altas/_componentes/enviar'

// Finanzas → Pagos, modo «Con el bot» (Tomás, 5/11/2026): el pago se manda al bot de altas, igual que «Cargar alta».
// El bot decide si es alta nueva, seña (Fee) o cuota de un cliente existente; carga el pago en la planilla y en esta app
// (por eso acá no se inserta nada) y en un alta nueva crea el cliente, la carpeta de Drive y lo demás.
// Ver lib/finanzasSkwd/altaDesdePago.ts.
const PROGRAMAS = OPCIONES_PROGRAMA.filter((p) => p !== 'Fee')
const MEDIOS = ['Transferencia', 'Tarjeta', 'Mercado Pago', 'Efectivo', 'Stripe', 'PayPal', 'Wise', 'Binance']

export default function CargaBot({ onListo }) {
  const [d, setD] = useState(pagoParaBotVacio)
  const [closer, setCloser] = useState('')
  const [archivos, setArchivos] = useState([])
  const [ocupado, setOcupado] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [res, setRes] = useState(null)
  const id = useRef(nuevoId())
  const inputArchivos = useRef(null)

  const cambiar = (e) => {
    const { name, value, type, checked } = e.target
    setD((x) => ({ ...x, [name]: type === 'checkbox' ? checked : value }))
  }
  const faltan = faltanParaBot(d, closer, archivos.length)

  async function mandar(accion) {
    if (ocupado) return
    setRes(null)
    if (accion === 'cargar' && faltan.length) { setRes({ ok: false, mensaje: `Falta: ${faltan.join(', ')}.` }); return }
    const fd = new FormData()
    fd.set('accion', accion)
    fd.set('id', id.current)
    fd.set('texto', textoAltaDesdePago(d, closer))
    fd.set('closer', closer)
    for (const f of archivos) fd.append('archivos', f)
    setOcupado(accion)
    const r = await enviarAccion(fd)
    setOcupado(null)
    if (accion === 'previsualizar') { setPrevia(r); return }
    setRes(r)
    if (r.ok) {
      setD(pagoParaBotVacio()); setCloser(''); setArchivos([]); setPrevia(null); id.current = nuevoId()
      if (inputArchivos.current) inputArchivos.current.value = ''
      onListo && onListo()
    }
  }

  const campo = (name, label, props = {}) => (
    <label>
      <span>{label}{props.required && <span className="pe-obligatorio" aria-hidden="true"> *</span>}</span>
      <input name={name} value={d[name]} onChange={cambiar} {...props} />
    </label>
  )

  return (
    <>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void mandar('cargar') }} noValidate>
        {campo('cliente', 'Cliente', { required: true })}
        {campo('telefono', 'Teléfono (con código de país)', { required: true, inputMode: 'tel', placeholder: '+54 9 11 …' })}
        <label>
          <span>Programa<span className="pe-obligatorio" aria-hidden="true"> *</span></span>
          <select name="programa" value={d.programa} onChange={cambiar} required>
            <option value="">Elegí el programa</option>
            {PROGRAMAS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>
          <span>Closer<span className="pe-obligatorio" aria-hidden="true"> *</span></span>
          <select value={closer} onChange={(e) => setCloser(e.target.value)} required>
            <option value="">Elegí el closer</option>
            {CLOSERS_BOT.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Setter
          <select name="setter" value={d.setter} onChange={cambiar}>
            <option value="">Que lo busque el bot</option>
            {SETTERS_BOT.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>
          Fuente
          <select name="fuente" value={d.fuente} onChange={cambiar}>
            <option value="">Que la busque el bot</option>
            {FUENTES_BOT.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        {campo('montoUsd', 'Este pago (USD)', { type: 'number', step: '0.01', min: '0' })}
        {campo('pesos', 'Este pago en pesos (si pagó en ARS)', { type: 'number', step: '1', min: '0' })}
        <label>
          Medio de pago
          <input name="medio" value={d.medio} onChange={cambiar} list="dl-medio-bot" />
          <datalist id="dl-medio-bot">{MEDIOS.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label>
          <span>Comprobantes (imagen o PDF)<span className="pe-obligatorio" aria-hidden="true"> *</span></span>
          <input ref={inputArchivos} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" onChange={(e) => setArchivos([...e.target.files])} />
        </label>
        <label className="check" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" name="altaNueva" checked={d.altaNueva} onChange={cambiar} /> Es un cliente nuevo (alta): completá sus datos
        </label>
        {d.altaNueva && (
          <>
            {campo('correo', 'Correo', { type: 'email', required: true })}
            {campo('inicio', 'Inicio del servicio', { type: 'date', required: true })}
            {campo('dni', 'DNI / CI', { required: true })}
            {campo('cuit', 'CUIT / CUIL', { required: true })}
            {campo('direccion', 'Dirección', { required: true })}
            {campo('socios', 'Socios (nombre, teléfono y correo; «No tiene» si no hay)')}
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Cuotas que faltan, sin este pago (una por renglón: dd/mm/aaaa monto){d.programa.includes('| PP |') && <span className="pe-obligatorio" aria-hidden="true"> *</span>}</span>
              <textarea name="cuotas" value={d.cuotas} onChange={cambiar} rows={4} placeholder={'06/12/2026 825\n06/01/2027 825'} />
            </label>
          </>
        )}
        <p className="pe-ayuda" style={{ gridColumn: '1 / -1' }}>
          El bot decide si es alta nueva, seña (Fee) o cuota de un cliente que ya está, y carga el pago en la planilla y en esta lista (el
          tipo de pago lo calcula solo). En un alta nueva crea el cliente, la carpeta de Drive y lo demás, como «Cargar alta». Si le falta
          algo, lo pregunta en Verificaciones.
        </p>
        <div className="acciones">
          <button type="button" onClick={() => void mandar('previsualizar')} disabled={!!ocupado}>{ocupado === 'previsualizar' ? 'Leyendo…' : 'Vista previa'}</button>
          <button type="submit" disabled={!!ocupado}>{ocupado === 'cargar' ? 'Mandando…' : 'Mandar al bot'}</button>
        </div>
      </form>
      <div aria-live="polite">
        {res && <p className={res.ok ? 'ok' : 'error'}>{res.mensaje || (res.ok ? 'Listo: el bot ya lo está cargando. Seguilo en Clientes → Altas.' : 'No se pudo.')}</p>}
        {previa && (previa.ok ? (
          <div className="aviso">
            <p><strong>Vista previa · no se cargó nada.</strong> {previa.tipo ? `Tipo: ${previa.tipo}.` : ''} {previa.datos?.columnaB ? `Programa: ${previa.datos.columnaB}.` : ''}</p>
            {!!previa.faltantes?.length && <p>Le faltaría: {previa.faltantes.join(' · ')}</p>}
            {!!previa.avisos?.length && <p>Para revisar: {previa.avisos.join(' · ')}</p>}
          </div>
        ) : <p className="error">{previa.mensaje}</p>)}
      </div>
    </>
  )
}
