'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Boton, SeccionTitulo } from '@/components/ui'
import { useConfirmacion } from '@/components/ui/Confirmacion'
import type { EntradaHistorial } from '@/lib/eow/db'
import {
  COLORES, NOMBRE_COLOR, NOMBRE_TARJETA, TARJETAS, contar, fechaCorta, nuevoIdFila, rangoSemana, ubicar,
  type Color, type DatosEow, type DestinoUbicar, type FilaEow, type ReporteEow, type Tarjeta,
} from '@/lib/eow/modelo'
import { Calificacion } from '@/components/clientes/Calificacion'
import type { PuntajeCompacto } from '@/lib/clientes/puntaje'
import { NOMBRE_ESTADO_CARTERA, crearVinculador, difiereDeCartera, linkCartera, type ClienteCartera, type Vinculo } from '@/lib/eow/vinculo'

// Editor del reporte EOW (13/11/2026). Todo se edita en la pantalla y se guarda junto con «Guardar cambios» (un solo POST con
// la versión leída: si alguien guardó antes, 409 y se pide recargar, sin pisar lo del otro).

type Props = { semanas: string[]; inicial: ReporteEow | null; historial: EntradaHistorial[]; cartera: ClienteCartera[] | null; puntajes?: Record<string, PuntajeCompacto> | null }

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export function EditorEow({ semanas, inicial, historial, cartera, puntajes = null }: Props) {
  const router = useRouter()
  const [confirmar, dialogoConfirmar] = useConfirmacion()
  const [datos, setDatos] = useState<DatosEow>(() => ({ filas: inicial?.filas ?? [], tarjetas: inicial?.tarjetas ?? ({} as DatosEow['tarjetas']) }))
  const [version, setVersion] = useState(inicial?.version ?? 0)
  const [sucio, setSucio] = useState(false)
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error' | 'trabajando'; texto: string } | null>(
    inicial?.actualizado ? { tipo: 'ok', texto: `Guardado${inicial.actualizadoPor ? ` por ${inicial.actualizadoPor}` : ''} · ${hora(inicial.actualizado)}` } : null,
  )

  // Avisar antes de salir con cambios sin guardar
  useEffect(() => {
    if (!sucio) return
    const alSalir = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [sucio])

  const cambiar = (f: (d: DatosEow) => DatosEow) => { setDatos(f); setSucio(true) }
  const editarFila = (id: string, cambio: Partial<FilaEow>) => cambiar((d) => ({ ...d, filas: d.filas.map((x) => (x.id === id ? { ...x, ...cambio } : x)) }))
  const quitarFila = (id: string) => cambiar((d) => ({ ...d, filas: d.filas.filter((x) => x.id !== id) }))
  const agregarFila = (color: Color) =>
    cambiar((d) => ({ ...d, filas: [...d.filas, { id: nuevoIdFila(), cliente: '', comentario: '', color, pausado: false, idCrm: null, lanzado: null, origen: 'manual' }] }))
  const ubicarFila = (id: string, destino: DestinoUbicar) => cambiar((d) => ({ ...d, filas: ubicar(d.filas, id, destino) }))
  const editarTarjeta = (k: Tarjeta, items: string[]) => cambiar((d) => ({ ...d, tarjetas: { ...d.tarjetas, [k]: items } }))

  const n = useMemo(() => contar(datos.filas), [datos.filas])
  const vinculador = useMemo(() => (cartera ? crearVinculador(cartera) : null), [cartera])
  const vincular = (f: FilaEow): Vinculo | null => (vinculador ? vinculador(f) : null)
  const sinUbicar = datos.filas.filter((f) => !f.color)

  async function guardar() {
    if (!inicial) return
    setEstado({ tipo: 'trabajando', texto: 'Guardando…' })
    // Las filas sin nombre no se guardan (el servidor las descarta igual)
    const limpio = { ...datos, filas: datos.filas.filter((f) => f.cliente.trim()) }
    try {
      const r = await fetch('/api/eow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'guardar', semana: inicial.semana, version, datos: limpio }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setEstado({ tipo: 'error', texto: j.error ?? 'No se pudo guardar.' }); return }
      setVersion(j.version)
      setSucio(false)
      setEstado({ tipo: 'ok', texto: `Guardado por ${j.actualizadoPor ?? 'vos'} · ${hora(j.actualizado)}` })
      router.refresh()
    } catch {
      setEstado({ tipo: 'error', texto: 'Sin conexión: no se guardó. Probá de nuevo.' })
    }
  }

  async function nuevaSemana() {
    if (sucio && !(await confirmar({
      titulo: '¿Crear la semana nueva igual?',
      detalle: 'Tenés cambios sin guardar en esta semana. Si creás la nueva ahora, esos cambios se pierden y no se recuperan.',
      accion: 'Crear la semana nueva',
      peligro: true,
    }))) return
    setEstado({ tipo: 'trabajando', texto: 'Creando la semana nueva…' })
    try {
      const r = await fetch('/api/eow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'nueva' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.reporte) { setEstado({ tipo: 'error', texto: j.error ?? 'No se pudo crear la semana.' }); return }
      setSucio(false)
      router.push(`/eow?semana=${j.reporte.semana}`)
      router.refresh()
    } catch {
      setEstado({ tipo: 'error', texto: 'Sin conexión: no se creó la semana.' })
    }
  }

  const titulo = inicial ? `Reporte EOW · semana del ${rangoSemana(inicial.semana)}` : 'Reporte EOW'
  return (
    <div className="eow cj-pila cj-pila--chica">
      {dialogoConfirmar}
      <SeccionTitulo
        etiqueta="EOW · End of Week"
        titulo={titulo}
        acciones={<Boton variante="marca" onClick={nuevaSemana}>Nueva semana</Boton>}
      />

      {semanas.length > 0 && (
        <nav className="eow-semanas" aria-label="Semanas anteriores">
          {semanas.map((s) => (
            <Link key={s} href={`/eow?semana=${s}`} className="eow-chip" title={`Semana del ${rangoSemana(s)}`} aria-current={s === inicial?.semana ? 'page' : undefined}>
              {fechaCorta(s)}
            </Link>
          ))}
        </nav>
      )}

      {!inicial ? (
        <p className="eow-vacio">Todavía no hay reportes. Tocá «Nueva semana» para empezar.</p>
      ) : (
        <>
          <section className="eow-contadores" aria-label="Contadores del semáforo">
            {COLORES.map((c) => (
              <div key={c} className={`eow-contador eow-contador--${c}`}>
                <span className="eow-contador__rotulo">{NOMBRE_COLOR[c]}</span>
                <span className="eow-contador__numero">{n[c]}</span>
                <span className="eow-contador__pie">{datos.filas.filter((f) => f.color === c && f.pausado).length} pausados</span>
              </div>
            ))}
          </section>

          <p className="eow-ayuda">
            Cada cliente tiene su <strong>estado</strong> (Activo o Pausado) y su <strong>color</strong>: se cambian juntos en el desplegable de la fila, o con «Pausar» / «Reanudar».
            {cartera
              ? ' La columna «Cartera» muestra cómo está el cliente en /clientes; pausar o reanudar allá se hace desde su tarjeta (link «en la Cartera»), porque escribe el CRM.'
                + (puntajes ? ' Al lado va su puntaje (el del cliente y el interno) como referencia: no cambia el color que elegís.' : '')
              : ' No se pudo leer la Cartera: se muestra sin su estado.'}
          </p>

          {sinUbicar.length > 0 && (
            <section className="eow-lanzados" aria-labelledby="eow-lanzados-titulo">
              <h2 id="eow-lanzados-titulo" className="eow-lanzados__titulo">Recién lanzados · para ubicar <span className="eow-cuenta">{sinUbicar.length}</span></h2>
              <ul className="eow-lista">
                {sinUbicar.map((f) => (
                  <li key={f.id} className="eow-fila eow-fila--lanzado">
                    <span className="eow-fila__cliente">{f.cliente}</span>
                    <span className="eow-fila__dato">{f.lanzado ? `Lanzó el ${fechaCorta(f.lanzado)}` : 'Recién lanzado'}</span>
                    <label className="eow-ubicar">
                      <span className="eow-sr">Ubicar a {f.cliente}</span>
                      <select value="" onChange={(e) => e.target.value && ubicarFila(f.id, e.target.value as DestinoUbicar)}>
                        <option value="">Ubicar…</option>
                        <option value="rojo">Rojo</option>
                        <option value="amarillo">Amarillo</option>
                        <option value="verde">Verde</option>
                        <option value="pausado">Pausado</option>
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {COLORES.map((c) => {
            const filas = datos.filas.filter((f) => f.color === c)
            return (
              <section key={c} className={`eow-color eow-color--${c}`} aria-labelledby={`eow-${c}`}>
                <h2 id={`eow-${c}`} className="eow-color__titulo">
                  <span className="eow-punto" aria-hidden="true" /> {NOMBRE_COLOR[c]} <span className="eow-cuenta">{filas.length}</span>
                </h2>
                {filas.length === 0 && <p className="eow-vacio">Sin clientes en {NOMBRE_COLOR[c].toLowerCase()}.</p>}
                <ul className="eow-lista">
                  {filas.map((f) => (
                    <li key={f.id} className="eow-fila">
                      <input className="eow-fila__cliente eow-input" value={f.cliente} placeholder="Cliente" aria-label="Cliente" onChange={(e) => editarFila(f.id, { cliente: e.target.value })} />
                      <input className="eow-fila__comentario eow-input" value={f.comentario} placeholder="Comentario" aria-label={`Comentario de ${f.cliente || 'cliente'}`} onChange={(e) => editarFila(f.id, { comentario: e.target.value })} />
                      <label className={`eow-estado-fila eow-pill--${f.pausado ? 'pausado' : c}`}>
                        <span className="eow-sr">Estado de {f.cliente || 'este cliente'}: activo o pausado, y color</span>
                        <select value={`${f.pausado ? 'pausado' : 'activo'}:${c}`} onChange={(e) => { const [p, col] = e.target.value.split(':'); editarFila(f.id, { pausado: p === 'pausado', color: col as Color }) }}>
                          <optgroup label="Activo">
                            {COLORES.map((x) => <option key={x} value={`activo:${x}`}>Activo · {NOMBRE_COLOR[x]}</option>)}
                          </optgroup>
                          <optgroup label="Pausado">
                            {COLORES.map((x) => <option key={x} value={`pausado:${x}`}>Pausado · {NOMBRE_COLOR[x]}</option>)}
                          </optgroup>
                        </select>
                      </label>
                      <button type="button" className="eow-pausar" onClick={() => editarFila(f.id, { pausado: !f.pausado })}>
                        {f.pausado ? 'Reanudar' : 'Pausar'}
                      </button>
                      <CeldaCartera fila={f} vinculo={vincular(f)} cartera={cartera} puntajes={puntajes} alVincular={(cambio) => editarFila(f.id, cambio)} />
                      <button type="button" className="eow-quitar" aria-label={`Quitar a ${f.cliente || 'esta fila'}`} onClick={() => quitarFila(f.id)}>×</button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="eow-agregar" onClick={() => agregarFila(c)}>+ Agregar cliente</button>
              </section>
            )
          })}

          <section className="eow-tarjetas" aria-label="Tarjetas de la semana">
            {TARJETAS.map((k) => (
              <TarjetaEditable key={k} titulo={NOMBRE_TARJETA[k]} items={datos.tarjetas[k] ?? []} alCambiar={(items) => editarTarjeta(k, items)} />
            ))}
          </section>

          {historial.length > 0 && (
            <details className="eow-historial">
              <summary>Historial de cambios ({historial.length})</summary>
              <ul>
                {historial.map((h, i) => (
                  <li key={i}><strong>{h.quien}</strong> · {hora(h.cuando)}: {h.cambios.slice(0, 8).join('; ')}{h.cambios.length > 8 ? `; y ${h.cambios.length - 8} más` : ''}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="eow-barra" role="region" aria-label="Guardar">
            <span className={`eow-estado ${estado ? `eow-estado--${estado.tipo}` : ''}`} role="status">{sucio ? 'Cambios sin guardar' : estado?.texto ?? ''}</span>
            {estado?.tipo === 'error' && sucio && <span className="eow-estado eow-estado--error" role="alert">{estado.texto}</span>}
            <Boton variante="primario" onClick={guardar} disabled={!sucio || estado?.tipo === 'trabajando'}>Guardar cambios</Boton>
          </div>
        </>
      )}
    </div>
  )
}

function TarjetaEditable({ titulo, items, alCambiar }: { titulo: string; items: string[]; alCambiar: (items: string[]) => void }) {
  const [nuevo, setNuevo] = useState('')
  const sumar = () => { const t = nuevo.trim(); if (!t) return; alCambiar([...items, t]); setNuevo('') }
  return (
    <div className="eow-tarjeta">
      <h3 className="eow-tarjeta__titulo">{titulo} <span className="eow-cuenta">{items.length}</span></h3>
      <ul className="eow-tarjeta__lista">
        {items.map((it, i) => (
          <li key={i}>
            <input className="eow-input" value={it} aria-label={`${titulo}: ítem ${i + 1}`} onChange={(e) => alCambiar(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="eow-quitar" aria-label={`Quitar «${it}»`} onClick={() => alCambiar(items.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ul>
      <form className="eow-tarjeta__nuevo" onSubmit={(e) => { e.preventDefault(); sumar() }}>
        <input className="eow-input" value={nuevo} placeholder="Agregar…" aria-label={`Agregar a ${titulo}`} onChange={(e) => setNuevo(e.target.value)} />
        <button type="submit" className="eow-agregar" aria-label={`Agregar a ${titulo}`}>+</button>
      </form>
    </div>
  )
}

function CeldaCartera({ fila, vinculo, cartera, puntajes, alVincular }: { fila: FilaEow; vinculo: Vinculo | null; cartera: ClienteCartera[] | null; puntajes: Record<string, PuntajeCompacto> | null; alVincular: (c: Partial<FilaEow>) => void }) {
  const [eligiendo, setEligiendo] = useState(false)
  if (!cartera || !vinculo) return <span className="eow-cartera eow-cartera--nada">—</span>
  if (eligiendo) {
    const valor = fila.noVincular ? 'ninguno' : fila.idCrm ?? 'auto'
    return (
      <label className="eow-cartera">
        <span className="eow-sr">Vincular a {fila.cliente} con un cliente de la Cartera</span>
        <select autoFocus value={valor} onBlur={() => setEligiendo(false)} onChange={(e) => {
          const v = e.target.value
          alVincular(v === 'auto' ? { idCrm: null, noVincular: false } : v === 'ninguno' ? { idCrm: null, noVincular: true } : { idCrm: v, noVincular: false })
          setEligiendo(false)
        }}>
          <option value="auto">Automático (por nombre)</option>
          <option value="ninguno">No vincular</option>
          {[...cartera].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.id}) · {NOMBRE_ESTADO_CARTERA[c.estado]}</option>)}
        </select>
      </label>
    )
  }
  if (vinculo.tipo === 'ninguno') {
    return (
      <span className="eow-cartera eow-cartera--nada">
        <button type="button" className="eow-vincular" onClick={() => setEligiendo(true)}>{vinculo.motivo === 'quitado' ? 'Sin vincular' : 'Vincular…'}</button>
      </span>
    )
  }
  const c = vinculo.cliente
  const difiere = difiereDeCartera(fila, vinculo)
  return (
    <span className={`eow-cartera eow-cartera--${c.estado}${difiere ? ' eow-cartera--difiere' : ''}`}>
      <a href={linkCartera(c.id)} title={`${c.nombre} (${c.id}) en la Cartera${vinculo.tipo === 'auto' ? ' · vinculado por nombre' : ''}`}>
        Cartera: {NOMBRE_ESTADO_CARTERA[c.estado]}{c.estado === 'pausado' && c.pausaDesde ? ` desde ${fechaCorta(c.pausaDesde).slice(0, 5)}` : ''}
      </a>
      {difiere && <a className="eow-cartera__aviso" href={linkCartera(c.id)}>{fila.pausado ? 'pausar en la Cartera' : 'reanudar en la Cartera'} ↗</a>}
      <button type="button" className="eow-vincular" aria-label={`Cambiar el vínculo de ${fila.cliente}`} onClick={() => setEligiendo(true)}>{vinculo.tipo === 'auto' ? 'auto' : 'manual'}</button>
      {/* Puntaje interno como referencia (no cambia el color que elige Gero M) */}
      {puntajes?.[c.id.toUpperCase()] && <Calificacion className="eow-puntaje" p={puntajes[c.id.toUpperCase()]} />}
    </span>
  )
}
