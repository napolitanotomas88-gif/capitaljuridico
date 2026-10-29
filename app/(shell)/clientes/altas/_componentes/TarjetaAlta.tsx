'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'
import type { AltaVista, EsperaVista, Opcion } from '@/lib/bot/alta/despacho/vista'
import { enviarAccion, nuevoId, type Respuesta } from './enviar'

// Un alta abierta: estado, pasos, pedidos abiertos (el mismo texto de Verificaciones C.J o el pedido al closer) con sus
// respuestas y lo que queda a mano. Cada botón manda UNA acción a /api/clientes/altas; el motor la procesa en segundo plano
// y la pantalla se recarga sola a los pocos segundos.
type Props = { alta: AltaVista; foco: boolean; aprobador: boolean; aMano: boolean; closerPropio: string | null }

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

function useAccion(alta: string) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [res, setRes] = useState<Respuesta | null>(null)
  async function accion(campos: Record<string, string>, archivos?: FileList | null) {
    if (ocupado) return
    const fd = new FormData()
    fd.set('alta_id', alta)
    for (const [k, v] of Object.entries(campos)) fd.set(k, v)
    for (const f of archivos ? [...archivos] : []) fd.append('archivos', f)
    setOcupado(true); setRes(null)
    const r = await enviarAccion(fd)
    setOcupado(false); setRes(r)
    if (r.ok) setTimeout(() => router.refresh(), 3500)
  }
  return { ocupado, res, accion }
}

function Resultado({ res }: { res: Respuesta | null }) {
  return <div aria-live="polite">{res && <p className={`cj-altas__resultado${res.ok ? '' : ' cj-altas__resultado--error'}`}>{res.mensaje}</p>}</div>
}

function OpcionesEquipo({ alta, espera }: { alta: string; espera: EsperaVista }) {
  const { ocupado, res, accion } = useAccion(alta)
  const [valores, setValores] = useState<Record<number, string>>({})
  const responder = (texto: string) => {
    if (texto.trim().toUpperCase().startsWith('NO') && !confirm(`¿Responder "${texto}"?`)) return
    void accion({ accion: 'responder', espera_id: espera.id, texto })
  }
  const campo = (i: number, o: Extract<Opcion, { prefijo: string }> | Extract<Opcion, { tipo: 'no' }>, placeholder: string, tipo = 'text') => (
    <input className="cj-campo__entrada" type={tipo} inputMode={tipo === 'number' ? 'decimal' : undefined} aria-label={o.etiqueta} placeholder={placeholder} value={valores[i] ?? ''} onChange={(e) => setValores({ ...valores, [i]: e.target.value })} />
  )
  return (
    <>
      <div className="cj-altas__botones">
        {espera.opciones.map((o, i) => {
          switch (o.tipo) {
            case 'boton': return <Boton key={i} variante={i === 0 ? 'marca' : 'secundario'} disabled={ocupado} onClick={() => responder(o.texto)}>{o.etiqueta}</Boton>
            case 'numero': return <span key={i} className="cj-altas__botones">{campo(i, o, o.ayuda, 'number')}<Boton variante="marca" disabled={ocupado || !valores[i]} onClick={() => responder(`OK ${valores[i]}`)}>OK {valores[i] ?? ''}</Boton></span>
            case 'lista': return (
              <span key={i} className="cj-altas__botones">
                <select className="cj-campo__entrada" aria-label={o.etiqueta} value={valores[i] ?? ''} onChange={(e) => setValores({ ...valores, [i]: e.target.value })}>
                  <option value="" disabled>Elegí la fuente</option>
                  {o.opciones.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                <Boton variante="marca" disabled={ocupado || !valores[i]} onClick={() => responder(`OK ${valores[i]}`)}>OK con la fuente</Boton>
              </span>
            )
            case 'nombre': return <span key={i} className="cj-altas__botones">{campo(i, o, o.ayuda)}<Boton variante="secundario" disabled={ocupado || !valores[i]?.trim()} onClick={() => responder(`OK ${valores[i].trim()}`)}>OK con este nombre</Boton></span>
            case 'no': return <span key={i} className="cj-altas__botones">{campo(i, o, 'Motivo')}<Boton variante="secundario" disabled={ocupado} onClick={() => responder(`NO ${valores[i]?.trim() ?? ''}`.trim())}>{o.etiqueta}</Boton></span>
            default: return null
          }
        })}
      </div>
      <Resultado res={res} />
    </>
  )
}

function DatosCloser({ alta, espera, opcion }: { alta: string; espera: EsperaVista; opcion: Extract<Opcion, { tipo: 'datos' }> }) {
  const { ocupado, res, accion } = useAccion(alta)
  const [texto, setTexto] = useState(opcion.plantilla)
  const [archivos, setArchivos] = useState<FileList | null>(null)
  return (
    <div className="cj-formulario">
      <label className="cj-etiqueta" htmlFor={`datos-${alta}-${espera.id}`}>Una línea por dato (por ejemplo "Inicio del servicio: 26/10/2026")</label>
      <textarea id={`datos-${alta}-${espera.id}`} className="cj-campo__entrada" rows={Math.max(3, opcion.plantilla.split('\n').length + 1)} value={texto} onChange={(e) => setTexto(e.target.value)} />
      {opcion.conArchivos && <input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" className="cj-campo__entrada" aria-label="Comprobante" onChange={(e) => setArchivos(e.target.files)} />}
      <div className="cj-altas__botones">
        <Boton variante="marca" disabled={ocupado} onClick={() => void accion({ accion: 'datos', espera_id: espera.id, id: nuevoId(), texto: texto.split('\n').filter((l) => !/:\s*$/.test(l)).join('\n') }, archivos)}>{ocupado ? 'Enviando…' : 'Enviar datos'}</Boton>
      </div>
      <Resultado res={res} />
    </div>
  )
}

function AMano({ alta, item, puede }: { alta: string; item: AltaVista['aMano'][number]; puede: boolean }) {
  const { ocupado, res, accion } = useAccion(alta)
  return (
    <div className="cj-altas__amano">
      <p><strong>{item.titulo}</strong> <span className="cj-texto-2">· {item.estado}{item.motivo ? ` · ${item.motivo}` : ''}</span></p>
      <ul className="cj-altas__lista">{item.detalle.map((d, i) => <li key={i}>{d}</li>)}</ul>
      {item.copiar && <details><summary>Texto para copiar</summary><pre className="cj-altas__texto">{item.copiar}</pre></details>}
      {puede ? (
        <div className="cj-altas__botones"><Boton variante="secundario" disabled={ocupado} onClick={() => { if (confirm(`¿${item.titulo.replace('A mano: ', '')} ya está hecho a mano?`)) void accion({ accion: 'a_mano', paso: item.paso }) }}>Hecho a mano</Boton></div>
      ) : <p className="cj-texto-2">Lo marcan Tomás, Gero A, Aylu o Gero M.</p>}
      <Resultado res={res} />
    </div>
  )
}

export function TarjetaAlta({ alta, foco, aprobador, aMano, closerPropio }: Props) {
  const { ocupado, res, accion } = useAccion(alta.id)
  const ancla = (e: EsperaVista) => (foco ? `espera-${e.id}` : `espera-${alta.id}-${e.id}`)
  const puedeDatos = aprobador || !!closerPropio
  return (
    <article id={`alta-${alta.id}`} className={`cj-panel cj-altas__tarjeta${foco ? ' cj-altas__tarjeta--foco' : ''}`}>
      <header className="cj-altas__cabeza">
        <h3 className="cj-altas__nombre">{alta.cliente}</h3>
        <span className="cj-texto-2">{alta.closer ? `Closer ${alta.closer} · ` : ''}{alta.origen === 'despacho' ? 'cargada en el Despacho' : 'por WhatsApp'} · {hora(alta.creado)}</span>
      </header>
      <p><span className="cj-etiqueta cj-etiqueta--laton">{alta.estadoTexto}</span>{alta.modo !== 'real' ? <span className="cj-texto-2"> · modo {alta.modo}</span> : null}{alta.comprobantes ? <span className="cj-texto-2"> · {alta.comprobantes} comprobante(s)</span> : null}</p>
      {alta.error && <p className="cj-texto-2">Último error: {alta.error}</p>}
      <ul className="cj-altas__pasos" aria-label="Pasos">
        {alta.pasos.map((p) => <li key={p.id} className={`cj-altas__paso cj-altas__paso--${p.estado}`} title={p.error ?? undefined}>{p.titulo}: {p.estadoTexto}</li>)}
      </ul>

      {alta.esperas.map((e) => (
        <section key={e.id} id={ancla(e)} className="cj-altas__espera" aria-label={`${e.quienTexto} (${e.id})`}>
          <p><strong>{e.quienTexto}</strong> <span className="cj-texto-2">· desde {hora(e.desde)}{e.avisada ? ' · avisado en Discord' : ''}{e.estado === 'simulada' ? ' · simulación' : ''}</span></p>
          <pre className="cj-altas__texto">{e.texto}</pre>
          {e.estado === 'abierta' && (e.quien === 'closer'
            ? (puedeDatos ? e.opciones.map((o, i) => (o.tipo === 'datos' ? <DatosCloser key={i} alta={alta.id} espera={e} opcion={o} /> : null)) : null)
            : (aprobador ? <OpcionesEquipo alta={alta.id} espera={e} /> : <p className="cj-texto-2">Lo aprueban Tomás, Gero A, Aylu o Gero M.</p>))}
        </section>
      ))}

      {alta.aMano.map((m) => <AMano key={m.paso} alta={alta.id} item={m} puede={aMano} />)}

      <div className="cj-altas__botones">
        <Boton variante="secundario" disabled={ocupado} onClick={() => void accion({ accion: 'reintentar' })}>Reintentar ahora</Boton>
      </div>
      <Resultado res={res} />
    </article>
  )
}
