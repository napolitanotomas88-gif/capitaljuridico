'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RespuestaTarjetasEdicion, TarjetaEdicion, VideoNuevoEdicion } from '@/lib/edicion/tarjetasTipos'

// Alta desde el tablero (4/11/2026): Aylu y Tomás eligen un cliente del CRM y cargan de 1 a 12 videos. Si el cliente ya
// tiene tarjeta, los videos se le suman (nunca una segunda tarjeta del mismo cliente sin elegirla). Se crea también en ClickUp.
const RUTA = '/api/edicion/tarjetas'
const MAX = 12
const vacio = (n: number): VideoNuevoEdicion => ({ nombre: `Video ${n}`, crudo: '', editado: '', prioridad: null, asignado: 'rene', guion: '' })
const etapa = (v: VideoNuevoEdicion) => v.editado.trim() ? 'editado' : v.crudo.trim() ? 'para editar' : 'en espera de datos'

export function NuevaTarjeta({ tarjetas, listo }: { tarjetas: TarjetaEdicion[]; listo: (t: TarjetaEdicion | null, mensaje: string) => void }) {
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [videos, setVideos] = useState<VideoNuevoEdicion[]>([vacio(1)])
  const [padre, setPadre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [clave] = useState(() => `alta_${crypto.randomUUID()}`)
  useEffect(() => {
    let vigente = true
    void fetch(`${RUTA}?clientes=1`, { cache: 'no-store' }).then(r => r.json()).then((j: { ok: boolean; clientes?: { id: string; nombre: string }[]; mensaje?: string }) => { if (!vigente) return; if (j.ok) setClientes(j.clientes ?? []); else setError(j.mensaje ?? 'No se pudo leer el CRM.') }).catch(() => { if (vigente) setError('No se pudo leer el CRM.') })
    return () => { vigente = false }
  }, [])
  const elegido = useMemo(() => clientes?.find(c => `${c.nombre} (${c.id})` === busqueda || c.id === busqueda.trim().toUpperCase()) ?? null, [clientes, busqueda])
  const raices = elegido ? tarjetas.filter(t => t.id_crm === elegido.id && !t.parent_id) : []
  const cambiar = (i: number, k: keyof VideoNuevoEdicion, v: string) => setVideos(vs => vs.map((x, j) => j === i ? { ...x, [k]: v || (k === 'prioridad' || k === 'asignado' ? null : '') } : x))
  const cantidad = (n: number) => setVideos(vs => n > vs.length ? [...vs, ...Array.from({ length: n - vs.length }, (_, i) => vacio(vs.length + i + 1))] : vs.slice(0, n))
  const enviar = async () => {
    if (!elegido || enviando) return
    if (raices.length > 1 && !padre) { setError('Este cliente tiene más de una tarjeta: elegí a cuál sumar los videos.'); return }
    setEnviando(true); setError(null)
    try {
      const r = await fetch(RUTA, { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ accion: 'crear', clave, id_crm: elegido.id, cliente: elegido.nombre, padre_id: padre || null, videos: videos.map(v => ({ ...v, nombre: v.nombre.trim(), crudo: v.crudo.trim(), editado: v.editado.trim(), guion: v.guion.trim() })) }) })
      const j = await r.json().catch(() => ({})) as RespuestaTarjetasEdicion
      if (!r.ok || !j.ok) { setError(j.mensaje ?? 'No se pudo crear. Reintentá: el mismo intento no se duplica.'); return }
      listo(j.tarjeta ?? null, j.mensaje ?? 'Tarjeta creada.')
    } catch { setError('Se cortó la conexión. Reintentá: el mismo intento no se duplica.') } finally { setEnviando(false) }
  }
  return <form className="ed-pila" onSubmit={e => { e.preventDefault(); void enviar() }}>
    <label className="ed-campo"><span>Cliente del CRM</span><input list="et-clientes-alta" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder={clientes ? 'Nombre o ID' : 'Leyendo el CRM…'} disabled={!clientes || enviando} required /></label>
    <datalist id="et-clientes-alta">{clientes?.map(c => <option key={c.id} value={`${c.nombre} (${c.id})`} />)}</datalist>
    {elegido && raices.length === 1 && <p className="ed-sub">Ya tiene tarjeta («{raices[0].nombre}»): los videos se suman ahí.</p>}
    {elegido && raices.length > 1 && <label className="ed-campo"><span>Sumar a la tarjeta</span><select value={padre} onChange={e => setPadre(e.target.value)} required disabled={enviando}><option value="">Elegí…</option>{raices.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>}
    <label className="ed-campo"><span>Cantidad de videos</span><input type="number" min={1} max={MAX} value={videos.length} onChange={e => cantidad(Math.max(1, Math.min(MAX, Number(e.target.value) || 1)))} disabled={enviando} /></label>
    {videos.map((v, i) => <fieldset key={i} className="ed-pila et-alta-video"><legend>{v.nombre || `Video ${i + 1}`} · entra en «{etapa(v)}»</legend>
      <label className="ed-campo"><span>Nombre</span><input value={v.nombre} maxLength={120} onChange={e => cambiar(i, 'nombre', e.target.value)} disabled={enviando} /></label>
      <label className="ed-campo"><span>Link del crudo</span><input type="url" value={v.crudo} placeholder="https://drive.google.com/…" onChange={e => cambiar(i, 'crudo', e.target.value)} disabled={enviando} /></label>
      <label className="ed-campo"><span>Link del editado</span><input type="url" value={v.editado} placeholder="https://drive.google.com/file/d/…" onChange={e => cambiar(i, 'editado', e.target.value)} disabled={enviando} /></label>
      <label className="ed-campo"><span>Prioridad</span><select value={v.prioridad ?? ''} onChange={e => cambiar(i, 'prioridad', e.target.value)} disabled={enviando}><option value="">Normal</option><option value="urgent">Urgente</option><option value="high">Alta</option><option value="low">Baja</option></select></label>
      <label className="ed-campo"><span>Asignado</span><select value={v.asignado ?? ''} onChange={e => cambiar(i, 'asignado', e.target.value)} disabled={enviando}><option value="rene">René</option><option value="aylu">Aylu</option><option value="tomas">Tomás</option><option value="">Sin asignar</option></select></label>
      <label className="ed-campo"><span>Guion (opcional: de acá sale el copy del anuncio)</span><textarea rows={3} maxLength={6000} value={v.guion} onChange={e => cambiar(i, 'guion', e.target.value)} disabled={enviando} /></label>
    </fieldset>)}
    {error && <p className="cj-aviso" role="alert">{error}</p>}
    <button type="submit" className="cj-boton cj-boton--primario" disabled={!elegido || enviando}>{enviando ? 'Creando…' : `Crear ${videos.length === 1 ? 'tarjeta' : `tarjeta con ${videos.length} videos`}`}</button>
  </form>
}
