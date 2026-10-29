'use client'

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ETAPAS_TARJETAS, COLOR_ETAPA_TARJETA, type CamposTarjetaEdicion, type EtapaTarjeta, type EventoTarjetaEdicion, type PedidoTarjetaEdicion, type RespuestaTarjetasEdicion, type TarjetaEdicion } from '@/lib/edicion/tarjetasTipos'
import { buscarTarjeta, cantidadDescendientes, coincideTarjeta, esRegresoTarjeta, reemplazarTarjeta } from '@/lib/edicion/vistaTarjetas'
import { tarjetasEdicionDemo } from '@/lib/edicion/demoTarjetas'
import type { RolEdicion } from '@/lib/edicion/tipos'
import './tarjetas.css'

const RUTA = '/api/edicion/tarjetas'
const SIN_PERMISOS = { mover: false, campos: false, comentar: false }
const claveNueva = () => `tarjeta_${crypto.randomUUID()}`
const fecha = (s: string) => { const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }) : 'Fecha no registrada' }
const etapaEstilo = (etapa: EtapaTarjeta) => ({ '--et-color': COLOR_ETAPA_TARJETA[etapa] } as CSSProperties)
const hrefSeguro = (s: string) => /^https:\/\/[^\s]+$/i.test(s.trim()) ? s.trim() : null

async function leer(id?: string): Promise<RespuestaTarjetasEdicion> {
  const r = await fetch(`${RUTA}${id ? `?id=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' })
  const j = await r.json().catch(() => ({ ok: false, mensaje: 'No se pudo leer la respuesta.' })) as RespuestaTarjetasEdicion
  return { ...j, ok: r.ok && j.ok }
}

export function TableroTarjetas({ demo, rol, inicial }: { demo: boolean; rol: RolEdicion; inicial?: RespuestaTarjetasEdicion }) {
  const [tarjetas, setTarjetas] = useState<TarjetaEdicion[]>(() => demo ? tarjetasEdicionDemo() : inicial?.tarjetas ?? [])
  const [permisos, setPermisos] = useState(() => demo ? { mover: rol !== 'lector', campos: rol !== 'lector', comentar: rol !== 'lector' } : inicial?.permisos ?? SIN_PERMISOS)
  const [cargando, setCargando] = useState(!demo && !inicial)
  const [consulta, setConsulta] = useState('')
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [historial, setHistorial] = useState<EventoTarjetaEdicion[]>([])
  const [detalleCargando, setDetalleCargando] = useState(false)
  const [detalleError, setDetalleError] = useState<string | null>(null)
  const [movimiento, setMovimiento] = useState<{ id: string; etapa: EtapaTarjeta } | null>(null)
  const [arrastrada, setArrastrada] = useState<string | null>(null)
  const [destino, setDestino] = useState<EtapaTarjeta | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [pendiente, setPendiente] = useState<PedidoTarjetaEdicion | null>(null)
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(() => inicial && !inicial.ok ? { texto: inicial.mensaje ?? 'No se pudo leer el tablero.', error: true } : null)
  const bloqueo = useRef(false)
  const detalleId = useRef<string | null>(null)
  const eventosDemo = useRef(new Map<string, EventoTarjetaEdicion[]>())

  const aplicarLectura = (j: RespuestaTarjetasEdicion) => {
    if (!j.ok) { setMensaje({ texto: j.mensaje ?? 'No se pudo leer el tablero. Reintentá.', error: true }); return }
    setTarjetas(j.tarjetas ?? []); setPermisos(j.permisos ?? SIN_PERMISOS)
  }
  useEffect(() => {
    if (demo || inicial) return
    let vigente = true
    void leer().then(j => { if (vigente) aplicarLectura(j) }).catch(() => { if (vigente) setMensaje({ texto: 'No se pudo conectar con el tablero.', error: true }) }).finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [demo, inicial])

  const cargar = async () => {
    if (demo) return
    setCargando(true); setMensaje(null)
    try { aplicarLectura(await leer()) } catch { setMensaje({ texto: 'No se pudo conectar con el tablero.', error: true }) }
    finally { setCargando(false) }
  }
  const cargarDetalle = async (id: string) => {
    setHistorial([]); setDetalleError(null)
    if (demo) { setHistorial(eventosDemo.current.get(id) ?? []); return }
    setDetalleCargando(true)
    try {
      const j = await leer(id)
      if (detalleId.current !== id) return
      if (!j.ok) { setDetalleError(j.mensaje ?? 'No se pudo leer el historial.'); return }
      if (j.tarjeta) setTarjetas(ts => reemplazarTarjeta(ts, j.tarjeta!))
      setHistorial([...(j.historial ?? [])].sort((a, b) => (Date.parse(a.fecha) || 0) - (Date.parse(b.fecha) || 0) || a.id.localeCompare(b.id)))
    } catch { if (detalleId.current === id) setDetalleError('No se pudo leer el historial. Los comentarios anteriores siguen guardados.') }
    finally { if (detalleId.current === id) setDetalleCargando(false) }
  }
  const abrir = (id: string) => { detalleId.current = id; setSeleccionada(id); void cargarDetalle(id) }
  const editable = (t: TarjetaEdicion) => t.puede_editar !== false && !!t.id_crm
  const etapasPara = (t: TarjetaEdicion) => !permisos.mover || !editable(t) ? [] : t.etapas_permitidas ?? (rol === 'rene' ? ['editando', 'editado', 'corregido'] as EtapaTarjeta[] : ETAPAS_TARJETAS.filter(e => e !== t.etapa))
  const proponer = (id: string, etapa: EtapaTarjeta) => {
    if (enviando || pendiente) return
    const t = buscarTarjeta(tarjetas, id)
    if (!t || t.etapa === etapa || !etapasPara(t).includes(etapa)) return
    setMovimiento({ id, etapa }); setMensaje(null)
  }

  const mandar = async (p: PedidoTarjetaEdicion) => {
    if (bloqueo.current) return
    bloqueo.current = true; setEnviando(true); setMensaje(null)
    try {
      if (demo) {
        const t = buscarTarjeta(tarjetas, p.id)
        if (t) setTarjetas(ts => reemplazarTarjeta(ts, { ...t, ...(p.accion === 'mover' ? { etapa: p.etapa } : p.accion === 'campos' ? { campos: p.campos } : {}), version: t.version + 1 }))
        const hs = [...(eventosDemo.current.get(p.id) ?? []), { id: p.clave, fecha: new Date().toISOString(), quien: 'Equipo de ejemplo', tipo: p.accion === 'mover' ? 'movimiento' as const : p.accion === 'campos' ? 'campos' as const : 'comentario' as const, ...(p.accion === 'mover' ? { antes: t?.etapa, despues: p.etapa } : {}), texto: p.accion === 'comentar' ? p.texto : p.accion === 'mover' ? p.comentario ?? '' : '' }]
        eventosDemo.current.set(p.id, hs)
        if (detalleId.current === p.id) setHistorial(hs)
        setMovimiento(null); setPendiente(null); setMensaje({ texto: 'Ejemplo actualizado en esta pantalla. No se guardó ni se enviaron avisos.', error: false }); return true
      }
      const r = await fetch(RUTA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), cache: 'no-store' })
      const j = await r.json().catch(() => ({})) as RespuestaTarjetasEdicion
      if (r.status === 202 || !r.ok || !j.ok) {
        if (r.status >= 500 || [202, 408, 429].includes(r.status)) setPendiente(p)
        else { setPendiente(null); if (r.status === 409) { setMovimiento(null); void cargar() } }
        setMensaje({ texto: j.mensaje ?? 'No se pudo confirmar el cambio. Reintentá el mismo intento para comprobarlo.', error: true }); return false
      }
      if (!j.dry && !j.tarjeta) { setPendiente(p); setMensaje({ texto: 'El servidor no devolvió la tarjeta confirmada. Reintentá el mismo cambio para comprobar el resultado.', error: true }); return false }
      if (!j.dry && j.tarjeta) setTarjetas(ts => reemplazarTarjeta(ts, j.tarjeta!, true))
      setPendiente(null); setMovimiento(null)
      setMensaje({ texto: j.mensaje ?? (j.dry ? 'Vista previa: no se guardó.' : 'Cambio guardado.'), error: false })
      if (!j.dry && seleccionada === p.id) void cargarDetalle(p.id)
      return true
    } catch {
      setPendiente(p); setMensaje({ texto: 'Se cortó la conexión. Conservamos este intento: reintentá para comprobar el resultado sin duplicarlo.', error: true }); return false
    } finally { bloqueo.current = false; setEnviando(false) }
  }

  const abierta = seleccionada ? buscarTarjeta(tarjetas, seleccionada) : null
  const aMover = movimiento ? buscarTarjeta(tarjetas, movimiento.id) : null
  const visibles = tarjetas.filter(t => coincideTarjeta(t, consulta))
  const bloqueado = enviando || !!pendiente
  const enArrastre = arrastrada ? buscarTarjeta(tarjetas, arrastrada) : null
  const destinosArrastre = enArrastre ? etapasPara(enArrastre) : []
  const resultado = mensaje && <div className={mensaje.error ? 'et-resultado et-error' : 'et-resultado'} role={mensaje.error ? 'alert' : 'status'}><p>{mensaje.texto}</p>{pendiente && <button type="button" className="cj-boton cj-boton--secundario" disabled={enviando} onClick={() => void mandar(pendiente)}>Reintentar el mismo cambio</button>}</div>
  return <div className="et-tablero">
    <div className="et-herramientas">
      <label className="ed-campo"><span>Buscar cliente o video</span><input type="search" value={consulta} onChange={e => setConsulta(e.target.value)} placeholder="Nombre o ID del cliente" /></label>
      <span className="ed-sub">{tarjetas.length} clientes · {tarjetas.reduce((n, t) => n + cantidadDescendientes(t), 0)} videos</span>
      {!demo && <button type="button" className="cj-boton cj-boton--secundario" disabled={cargando || enviando} onClick={() => void cargar()}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>}
    </div>
    {demo && <p className="cj-aviso">Datos de ejemplo: podés probar los movimientos. No se guardan ni se envían mensajes.</p>}
    {!abierta && !aMover && resultado}
    {cargando && !tarjetas.length ? <p role="status">Leyendo las tarjetas de Edición…</p> : <div className="et-columnas" aria-label="Tablero de Edición">
      {ETAPAS_TARJETAS.map(etapa => {
        const ts = visibles.filter(t => t.etapa === etapa)
        const permiteSoltar = destinosArrastre.includes(etapa)
        return <section key={etapa} className={`et-columna${destino === etapa && permiteSoltar ? ' et-columna--destino' : ''}`} style={etapaEstilo(etapa)} aria-label={etapa}
          onDragOver={e => { if (permiteSoltar && !bloqueado) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDestino(etapa) } }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDestino(null) }}
          onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id === arrastrada) proponer(id, etapa); setDestino(null); setArrastrada(null) }}>
          <header className="et-columna__cab"><span className="et-estado-punto" aria-hidden /><h2>{etapa}</h2><span className="ed-contador">{ts.length}</span></header>
          <ul className="et-lista">{ts.map(t => <Tarjeta key={t.id} t={t} abrir={abrir} etapas={etapasPara} proponer={proponer} bloqueado={bloqueado} arrastrar={setArrastrada} />)}</ul>
          {!ts.length && <p className="et-vacia">Sin tarjetas</p>}
        </section>
      })}
    </div>}
    {abierta && <Dialogo titulo={abierta.nombre} volverA={abierta.id} bloqueado={bloqueado} cerrar={() => { if (!bloqueado) { detalleId.current = null; setSeleccionada(null) } }}>{!aMover && resultado}<DetalleTarjeta key={abierta.id} t={abierta} historial={historial} cargando={detalleCargando} error={detalleError} demo={demo} rol={rol} permisos={{ campos: permisos.campos && editable(abierta), comentar: permisos.comentar && editable(abierta) }} bloqueado={bloqueado} enviar={mandar} etapas={etapasPara(abierta)} proponer={proponer} /></Dialogo>}
    {aMover && movimiento && <Dialogo titulo={`Mover ${aMover.nombre}`} volverA={aMover.id} bloqueado={bloqueado} cerrar={() => { if (!bloqueado) setMovimiento(null) }}>{resultado}<Movimiento key={`${aMover.id}:${movimiento.etapa}`} t={aMover} etapa={movimiento.etapa} rol={rol} bloqueado={bloqueado} confirmar={p => mandar({ ...p, clave: claveNueva() })} /></Dialogo>}
  </div>
}

function Tarjeta({ t, abrir, etapas, proponer, bloqueado, arrastrar, profundidad = 0 }: { t: TarjetaEdicion; abrir: (id: string) => void; etapas: (t: TarjetaEdicion) => readonly EtapaTarjeta[]; proponer: (id: string, etapa: EtapaTarjeta) => void; bloqueado: boolean; arrastrar: (id: string | null) => void; profundidad?: number }) {
  const [expandida, setExpandida] = useState(false)
  const destinos = etapas(t)
  return <li data-tarjeta-id={t.id} className={`et-tarjeta${profundidad ? ' et-tarjeta--hija' : ''}`} draggable={!bloqueado && destinos.length > 0}
    onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; arrastrar(t.id) }} onDragEnd={e => { e.stopPropagation(); arrastrar(null) }}>
    <div className="et-tarjeta__cab"><button type="button" className="et-nombre" onClick={() => abrir(t.id)}>{t.nombre}</button>{t.prioridad === 'urgent' || t.prioridad === 'urgente' ? <span className="ed-marca ed-marca--alerta">Urgente</span> : null}</div>
    {profundidad > 0 && <span className="et-etapa" style={etapaEstilo(t.etapa)}><span className="et-estado-punto" aria-hidden />{t.etapa}</span>}
    {t.id_crm && profundidad === 0 && <p className="et-meta">{t.id_crm}{t.asignados?.length ? ` · ${t.asignados.join(', ')}` : ''}</p>}
    {!t.id_crm && <p className="et-meta">Cliente por vincular · solo lectura</p>}
    <div className="et-campos-resumen">{Object.entries(t.campos).filter(([,v]) => !!v).map(([k, v]) => { const href = hrefSeguro(v); return href ? <a key={k} href={href} target="_blank" rel="noreferrer" draggable={false}>{k === 'crudo' ? 'Crudo' : k === 'editado' ? 'Editado' : 'Paleta'}</a> : <span key={k} title={v}>{k === 'paleta' ? `Paleta: ${v}` : k === 'crudo' ? 'Crudo cargado' : 'Editado cargado'}</span> })}</div>
    {t.espera_whatsapp && <p className="et-meta">Envío al cliente pendiente</p>}
    {t.avisos?.map(a => <p key={a} className="et-meta">{a}</p>)}
    <div className="et-tarjeta__pie">{t.hijos.length > 0 && <button type="button" className="et-expandir" aria-expanded={expandida} onClick={() => setExpandida(x => !x)}>{expandida ? '▾' : '▸'} {cantidadDescendientes(t)} {profundidad ? 'subtareas' : 'videos'}</button>}<SelectorEtapa t={t} etapas={destinos} bloqueado={bloqueado} proponer={proponer} /></div>
    {expandida && <ul className="et-hijos">{t.hijos.map(h => <Tarjeta key={h.id} t={h} abrir={abrir} etapas={etapas} proponer={proponer} bloqueado={bloqueado} arrastrar={arrastrar} profundidad={profundidad + 1} />)}</ul>}
  </li>
}

function SelectorEtapa({ t, etapas, bloqueado, proponer }: { t: TarjetaEdicion; etapas: readonly EtapaTarjeta[]; bloqueado: boolean; proponer: (id: string, e: EtapaTarjeta) => void }) {
  if (!etapas.length) return null
  return <label className="et-selector"><span className="cj-solo-lectores">Mover {t.nombre}</span><select value="" disabled={bloqueado} onChange={e => { if (e.target.value) proponer(t.id, e.target.value as EtapaTarjeta) }}><option value="">Mover a…</option>{ETAPAS_TARJETAS.filter(e => e !== t.etapa && etapas.includes(e)).map(e => <option key={e} value={e}>{e}</option>)}</select></label>
}

function Dialogo({ titulo, cerrar, children, volverA, bloqueado = false }: { titulo: string; cerrar: () => void; children: ReactNode; volverA: string; bloqueado?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    d.showModal()
    return () => {
      d.close()
      requestAnimationFrame(() => {
        const dialogoAbierto = document.querySelector<HTMLDialogElement>('dialog[open]')
        const previoVisible = anterior && anterior !== document.body && anterior.isConnected && !anterior.closest('dialog:not([open])') && (!dialogoAbierto || dialogoAbierto.contains(anterior))
        const destino = previoVisible ? anterior : dialogoAbierto?.querySelector<HTMLElement>('button, input, select, textarea') ?? document.querySelector<HTMLElement>(`[data-tarjeta-id="${CSS.escape(volverA)}"] .et-nombre`)
        destino?.focus()
      })
    }
  }, [volverA])
  return <dialog ref={ref} className="et-dialogo" aria-labelledby={id} onCancel={e => { e.preventDefault(); cerrar() }}><header><h2 id={id}>{titulo}</h2><button type="button" className="et-cerrar" aria-label="Cerrar" disabled={bloqueado} onClick={cerrar}>×</button></header><div className="et-dialogo__cuerpo">{children}</div></dialog>
}

function DetalleTarjeta({ t, historial, cargando, error, demo, rol, permisos, bloqueado, enviar, etapas, proponer }: { t: TarjetaEdicion; historial: EventoTarjetaEdicion[]; cargando: boolean; error: string | null; demo: boolean; rol: RolEdicion; permisos: { campos: boolean; comentar: boolean }; bloqueado: boolean; enviar: (p: PedidoTarjetaEdicion) => Promise<boolean | undefined>; etapas: readonly EtapaTarjeta[]; proponer: (id: string, e: EtapaTarjeta) => void }) {
  const [campos, setCampos] = useState(t.campos), [comentario, setComentario] = useState('')
  const [versionCampos, setVersionCampos] = useState(t.version)
  const cambios = Object.keys(campos).some(k => campos[k as keyof CamposTarjetaEdicion] !== t.campos[k as keyof CamposTarjetaEdicion])
  const revisarCampos = cambios && versionCampos !== t.version
  return <div className="ed-pila">
    <div className="et-detalle-estado"><span className="et-etapa" style={etapaEstilo(t.etapa)}><span className="et-estado-punto" aria-hidden />{t.etapa}</span><SelectorEtapa t={t} etapas={etapas} bloqueado={bloqueado} proponer={proponer} /></div>
    {t.id_crm ? <p className="ed-sub">Cliente {t.id_crm}{t.asignados?.length ? ` · ${t.asignados.join(', ')}` : ''}</p> : <p className="cj-aviso">Cliente por vincular. Sus datos se conservan para revisión.</p>}
    {t.espera_whatsapp && <p className="cj-aviso">Envío al cliente pendiente. El video sigue en la cola de entrega; revisá los avisos antes de enviarlo.</p>}
    {t.avisos?.map(a => <p className="cj-aviso" key={a}>{a}</p>)}
    <form className="et-detalle-campos" onSubmit={e => { e.preventDefault(); if (!revisarCampos) void enviar({ accion: 'campos', id: t.id, version: versionCampos, clave: claveNueva(), campos }) }}>
      {(['paleta', 'crudo', 'editado'] as const).map((k, i) => <label className="ed-campo" key={k}><span>{i + 1} - {k === 'paleta' ? 'Paleta de Color' : k === 'crudo' ? 'Crudo' : 'Editado'}</span><textarea rows={k === 'paleta' ? 2 : 1} maxLength={2000} value={campos[k]} readOnly={!permisos.campos || (rol === 'rene' && k !== 'editado')} disabled={bloqueado} onChange={e => { if (!cambios) setVersionCampos(t.version); setCampos(c => ({ ...c, [k]: e.target.value })) }} />{hrefSeguro(t.campos[k]) && <a href={hrefSeguro(t.campos[k])!} target="_blank" rel="noreferrer" className="cj-enlace">Abrir {k === 'paleta' ? 'paleta' : k}</a>}</label>)}
      {revisarCampos && <div className="cj-aviso" role="status"><p>La tarjeta tuvo otra actualización. Tu borrador sigue visible; revisá los campos actuales antes de guardarlo.</p><button type="button" className="cj-boton cj-boton--secundario" disabled={bloqueado} onClick={() => { setCampos(t.campos); setVersionCampos(t.version) }}>Cargar campos actuales</button></div>}
      {permisos.campos && cambios && <button type="submit" className="cj-boton cj-boton--primario" disabled={bloqueado || revisarCampos}>Guardar campos</button>}
    </form>
    {t.video_id && <a className="cj-enlace" href={`/clientes/edicion/video/${t.video_id}${demo ? '?demo=1' : ''}`}>Abrir video y correcciones</a>}
    <section aria-label="Actividad de la tarjeta"><h3>Actividad y comentarios</h3>{cargando ? <p role="status">Leyendo actividad…</p> : error ? <p className="cj-aviso" role="alert">{error}</p> : !historial.length ? <p className="ed-sub">Todavía no hay actividad registrada acá.</p> : <ol className="et-actividad">{historial.map(h => <li key={h.id}><p><strong>{h.quien || 'Equipo'}</strong> · <time dateTime={h.fecha}>{fecha(h.fecha)}</time></p>{h.tipo === 'movimiento' && <p>{h.antes} → {h.despues}</p>}{h.tipo === 'campos' && <p>Actualizó los campos de la tarjeta.</p>}{h.texto && <p className="et-comentario">{h.texto}</p>}</li>)}</ol>}
      {permisos.comentar && <form className="et-comentar" onSubmit={e => { e.preventDefault(); void enviar({ accion: 'comentar', id: t.id, version: t.version, clave: claveNueva(), texto: comentario.trim() }).then(ok => { if (ok) setComentario('') }) }}><label className="ed-campo"><span>Comentario</span><textarea value={comentario} rows={3} maxLength={4000} disabled={bloqueado} onChange={e => setComentario(e.target.value)} required /></label><button type="submit" className="cj-boton cj-boton--primario" disabled={bloqueado || !comentario.trim()}>Comentar</button></form>}
    </section>
  </div>
}

function Movimiento({ t, etapa, rol, bloqueado, confirmar }: { t: TarjetaEdicion; etapa: EtapaTarjeta; rol: RolEdicion; bloqueado: boolean; confirmar: (p: Omit<Extract<PedidoTarjetaEdicion, { accion: 'mover' }>, 'clave'>) => Promise<boolean | undefined> }) {
  const [comentario, setComentario] = useState(''), [cliente, setCliente] = useState(false), [autorizar, setAutorizar] = useState(false)
  const regreso = esRegresoTarjeta(t.etapa, etapa), publicado = etapa === 'publicado', tercera = regreso && cliente && (t.ronda_cliente ?? 0) >= 2
  return <form className="ed-pila" onSubmit={e => { e.preventDefault(); void confirmar({ accion: 'mover', id: t.id, version: t.version, etapa, ...(comentario.trim() ? { comentario: comentario.trim() } : {}), ...(regreso ? { origen: cliente ? 'cliente' : 'interno' } : {}), ...(tercera && autorizar ? { autorizarTercera: true } : {}) }) }}>
    <p><strong>{t.etapa}</strong> → <strong>{etapa}</strong></p>
    {t.hijos.length > 0 && <p className="ed-sub">Se mueve esta tarjeta. Cada video conserva su propio estado.</p>}
    {etapa === 'revisión' && <p className="ed-sub">Se prepara el envío del link editado al cliente. Si WhatsApp está desconectado, queda pendiente.</p>}
    {publicado && <p className="ed-sub">El OK queda anotado y se avisa al equipo de Anuncios.</p>}
    {!regreso && (etapa === 'editado' || etapa === 'corregido') && <p className="ed-sub">Se avisa a Aylu para revisar el video.</p>}
    <label className="ed-campo"><span>{publicado ? 'Pegá el mensaje del cliente con su OK' : regreso ? 'Comentario para la corrección' : 'Comentario (opcional)'}</span><textarea rows={3} value={comentario} maxLength={4000} onChange={e => setComentario(e.target.value)} required={regreso || publicado} disabled={bloqueado} /></label>
    {regreso && <label className="ed-opcion"><input type="checkbox" checked={cliente} onChange={e => setCliente(e.target.checked)} disabled={bloqueado} /><span>Es un pedido de corrección del cliente</span></label>}
    {tercera && (rol === 'tomas' ? <label className="ed-opcion"><input type="checkbox" checked={autorizar} onChange={e => setAutorizar(e.target.checked)} disabled={bloqueado} required /><span>Autorizo una nueva ronda del cliente</span></label> : <p className="cj-aviso">Esta ronda del cliente necesita la autorización de Tomás.</p>)}
    {regreso && <p className="ed-sub">El comentario queda en el historial y acompaña el aviso a René para la corrección.</p>}
    <button type="submit" className="cj-boton cj-boton--primario" disabled={bloqueado || ((regreso || publicado) && !comentario.trim()) || (tercera && (rol !== 'tomas' || !autorizar))}>{bloqueado ? 'Guardando…' : 'Confirmar movimiento'}</button>
  </form>
}
