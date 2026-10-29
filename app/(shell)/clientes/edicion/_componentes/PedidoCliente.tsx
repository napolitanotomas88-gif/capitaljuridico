'use client'

import { useId, useState } from 'react'
import { ETIQUETA_TIPO_NOTA } from '@/lib/edicion/etiquetas'
import { LARGO_NOTA, LARGO_NOTA_VIDEO, LARGO_PEDIDO_CLIENTE, MAX_NOTAS_A_MANO, leerTiempo } from '@/lib/edicion/pedido'
import { TIPOS_NOTA, type TipoNota } from '@/lib/edicion/tipos'
import type { VistaPedido } from '@/lib/edicion/vista'
import { Mensaje } from './Mensaje'
import { useEnvio } from './useEnvio'

// f05: el cliente pidió cambios en el grupo Contenido. Aylu pega el mensaje y Claude lo separa en notas (o las carga a mano,
// si Claude no está o no entendió). Aylu tilda las que van y confirma: pasan a Corrección para René. Las que "no afectan el
// rendimiento" vienen sin tildar: Aylu decide. P6 (tope de 2 rondas del cliente) es INTERNO: si la confirmación sería la
// 3.ª ronda y no la hace Tomás, queda esperando su OK y René no la ve. Al cliente nunca se le dice que no en automático.
type Props = {
  videoId: number; demo: boolean
  puedeCargar: boolean; esTomas: boolean
  pedidos: VistaPedido[]; esperaTomas: VistaPedido | null
  seriaTercera: boolean
}

interface FilaAMano { tiempo: string; hasta: string; tipo: TipoNota; texto: string; afecta: boolean }
const filaVacia = (): FilaAMano => ({ tiempo: '', hasta: '', tipo: 'texto', texto: '', afecta: true })

function Propuesto({ p, demo, seriaTercera, esTomas }: { p: VistaPedido; demo: boolean; seriaTercera: boolean; esTomas: boolean }) {
  const { enviando, msj, enviar } = useEnvio(demo)
  const [elegidas, setElegidas] = useState<number[]>(() => p.propuesta.map((n, i) => (n.afecta_rendimiento ? i : -1)).filter(i => i >= 0))
  const [descartando, setDescartando] = useState(false)
  const [nota, setNota] = useState('')
  const alternar = (i: number) => setElegidas(xs => (xs.includes(i) ? xs.filter(x => x !== i) : [...xs, i].sort((a, b) => a - b)))
  return (
    <div className="ed-pedido">
      <p className="cj-etiqueta cj-etiqueta--laton">Pedido del cliente · {p.creado}{p.creadoPor ? ` · lo cargó ${p.creadoPor}` : ''}</p>
      <p className="ed-cita">{p.texto}</p>
      {p.propuesta.length ? (
        <ul className="ed-propuesta">
          {p.propuesta.map((n, i) => (
            <li key={i}>
              <label>
                <input type="checkbox" checked={elegidas.includes(i)} onChange={() => alternar(i)} />
                <span>
                  <strong className="ed-num">{n.tiempo ? `${n.tiempo} · ` : ''}</strong>{n.etiquetaTipo}: {n.texto}
                  {n.cita && <><br /><span className="ed-sub">«{n.cita}»</span></>}
                  <br /><span className={n.afecta_rendimiento ? 'ed-sub' : 'ed-sub'}>{n.afecta_rendimiento ? 'Afecta el rendimiento' : 'No afecta el rendimiento'}{n.motivo ? `: ${n.motivo}` : ''}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ed-vacio">No salió una propuesta automática. Descartá este pedido y cargá las notas a mano.</p>
      )}
      {seriaTercera && !esTomas && elegidas.length > 0 && (
        <p className="ed-interno"><strong>Interno</strong>Sería la 3.ª ronda del cliente: al confirmar queda esperando el OK de Tomás y René no la ve hasta entonces. Al cliente no se le dice nada.</p>
      )}
      <div className="ed-botones">
        {p.propuesta.length > 0 && (
          <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={() => void enviar({ accion: 'pedido_confirmar', pedido_id: p.id, version: p.version, elegidas })}>
            {elegidas.length ? `Confirmar ${elegidas.length} nota${elegidas.length === 1 ? '' : 's'}` : 'Nada para corregir'}
          </button>
        )}
        <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando} aria-expanded={descartando} onClick={() => setDescartando(!descartando)}>Descartar el pedido</button>
      </div>
      {descartando && (
        <div className="ed-panel-accion">
          <label className="ed-campo"><span>Por qué (opcional)</span><input value={nota} maxLength={LARGO_NOTA} onChange={e => setNota(e.target.value)} autoComplete="off" /></label>
          <div className="ed-botones"><button type="button" className="cj-boton cj-boton--secundario ed-boton-peligro" disabled={enviando} onClick={() => void enviar({ accion: 'pedido_descartar', pedido_id: p.id, version: p.version, nota: nota.trim() })}>Descartar</button></div>
        </div>
      )}
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}

function EsperaTomas({ p, demo, esTomas }: { p: VistaPedido; demo: boolean; esTomas: boolean }) {
  const { enviando, msj, enviar } = useEnvio(demo)
  return (
    <div className="ed-pedido">
      <p className="ed-interno"><strong>Interno</strong>3.ª ronda del cliente: espera el OK de Tomás. René no la ve todavía y al cliente no se le dice nada.</p>
      <p className="ed-cita">{p.texto}</p>
      <ul className="ed-guia">{p.elegidas.map(i => p.propuesta[i]).filter(Boolean).map((n, k) => <li key={k}>{n.tiempo ? `${n.tiempo} · ` : ''}{n.etiquetaTipo}: {n.texto}</li>)}</ul>
      <div className="ed-botones">
        {esTomas && <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={() => void enviar({ accion: 'ronda_autorizar', pedido_id: p.id, version: p.version })}>Autorizar la ronda</button>}
        <button type="button" className="cj-boton cj-boton--secundario ed-boton-peligro" disabled={enviando} onClick={() => { if (window.confirm('¿Descartar el pedido? El video vuelve a quedar con el cliente, sin bloqueo.')) void enviar({ accion: 'pedido_descartar', pedido_id: p.id, version: p.version, nota: '' }) }}>Descartar el pedido</button>
      </div>
      <Mensaje msj={msj} enviando={enviando} />
    </div>
  )
}

function CargarPedido({ videoId, demo }: { videoId: number; demo: boolean }) {
  const id = useId()
  const { enviando, msj, setMsj, enviar } = useEnvio(demo)
  const [texto, setTexto] = useState('')
  const [aMano, setAMano] = useState(false)
  const [filas, setFilas] = useState<FilaAMano[]>([filaVacia()])
  const cambiar = (i: number, c: Partial<FilaAMano>) => setFilas(xs => xs.map((x, k) => (k === i ? { ...x, ...c } : x)))

  async function separar() {
    if (texto.trim().length < 3) { setMsj({ texto: 'Pegá el mensaje del cliente.', error: true }); return }
    const r = await enviar({ video_id: videoId, texto: texto.trim() }, { ruta: '/api/edicion/pedido' })
    if (r?.ok) setTexto('')
  }
  async function guardarAMano() {
    if (texto.trim().length < 3) { setMsj({ texto: 'Pegá el mensaje del cliente (queda como referencia).', error: true }); return }
    const notas = []
    for (const [i, f] of filas.entries()) {
      if (!f.texto.trim()) continue
      const s = leerTiempo(f.tiempo), h = leerTiempo(f.hasta)
      if (s === undefined || h === undefined) { setMsj({ texto: `Nota ${i + 1}: el tiempo va como 17, 1:05 o 1,05 (un minuto y cinco segundos).`, error: true }); return }
      notas.push({ texto: f.texto.trim(), tipo: f.tipo, segundo: s, hasta: h !== null && s !== null && h >= s ? h : null, afecta_rendimiento: f.afecta })
    }
    if (!notas.length) { setMsj({ texto: 'Escribí al menos una nota.', error: true }); return }
    const r = await enviar({ video_id: videoId, texto: texto.trim(), notas }, { ruta: '/api/edicion/pedido' })
    if (r?.ok) { setTexto(''); setFilas([filaVacia()]); setAMano(false) }
  }

  return (
    <div className="ed-form">
      <label className="ed-campo" htmlFor={`${id}-p`}><span>Pegá el mensaje del cliente con lo que pide cambiar</span></label>
      <textarea id={`${id}-p`} className="ed-texto" value={texto} maxLength={LARGO_PEDIDO_CLIENTE} rows={4} onChange={e => setTexto(e.target.value)} />
      <div className="ed-botones">
        <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={() => void separar()}>Separar en notas</button>
        <button type="button" className="cj-chip" aria-expanded={aMano} onClick={() => setAMano(!aMano)}>{aMano ? 'Cerrar la carga a mano' : 'Cargar las notas a mano'}</button>
      </div>
      {aMano && (
        <div className="ed-panel-accion">
          {filas.map((f, i) => (
            <div key={i} className="ed-form__fila" role="group" aria-label={`Nota ${i + 1}`}>
              <label className="ed-campo ed-campo--chico"><span>Segundo</span><input value={f.tiempo} inputMode="decimal" placeholder="12 o 1,05" onChange={e => cambiar(i, { tiempo: e.target.value })} /></label>
              <label className="ed-campo ed-campo--chico"><span>Hasta</span><input value={f.hasta} inputMode="decimal" placeholder="1,12" onChange={e => cambiar(i, { hasta: e.target.value })} /></label>
              <label className="ed-campo"><span>Tipo</span><select value={f.tipo} onChange={e => cambiar(i, { tipo: e.target.value as TipoNota })}>{TIPOS_NOTA.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_NOTA[t]}</option>)}</select></label>
              <label className="ed-campo" style={{ flexBasis: '100%' }}><span>Qué cambiar</span><input value={f.texto} maxLength={LARGO_NOTA_VIDEO} onChange={e => cambiar(i, { texto: e.target.value })} /></label>
              <label className="ed-tilde"><input type="checkbox" checked={f.afecta} onChange={e => cambiar(i, { afecta: e.target.checked })} />Afecta el rendimiento</label>
            </div>
          ))}
          <div className="ed-botones">
            {filas.length < MAX_NOTAS_A_MANO && <button type="button" className="cj-chip" onClick={() => setFilas(xs => [...xs, filaVacia()])}>Otra nota</button>}
            <button type="button" className="cj-boton cj-boton--primario" disabled={enviando} onClick={() => void guardarAMano()}>Guardar el pedido</button>
          </div>
        </div>
      )}
      <Mensaje msj={msj} enviando={enviando} textoEnviando="Separando el pedido…" />
    </div>
  )
}

export function PedidoCliente({ videoId, demo, puedeCargar, esTomas, pedidos, esperaTomas, seriaTercera }: Props) {
  // Solo quien carga pedidos (Aylu y Tomás) ve esto: a René la vista ya no le manda pedidos (P6), y acá tampoco se dibuja
  if (!puedeCargar && !esTomas) return null
  const propuesto = pedidos.find(p => p.claveEstado === 'propuesto') ?? null
  const anteriores = pedidos.filter(p => p !== propuesto && p !== esperaTomas)
  return (
    <div className="ed-pedido">
      {esperaTomas && <EsperaTomas p={esperaTomas} demo={demo} esTomas={esTomas} />}
      {!esperaTomas && propuesto && puedeCargar && <Propuesto p={propuesto} demo={demo} seriaTercera={seriaTercera} esTomas={esTomas} />}
      {!esperaTomas && !propuesto && puedeCargar && <CargarPedido videoId={videoId} demo={demo} />}
      {anteriores.length > 0 && (
        <details className="cj-detalles">
          <summary className="cj-etiqueta">Pedidos anteriores ({anteriores.length})</summary>
          <ul className="ed-guia">
            {anteriores.map(p => <li key={p.id}><span className="ed-sub">{p.creado} · {p.estado}</span><br />{p.texto}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
