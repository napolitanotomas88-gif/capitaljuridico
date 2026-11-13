'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Boton, SeccionTitulo } from '@/components/ui'
import type { EntradaHistorial } from '@/lib/eow/db'
import {
  COLORES, NOMBRE_COLOR, NOMBRE_TARJETA, TARJETAS, contar, fechaCorta, nuevoIdFila, ubicar,
  type Color, type DatosEow, type DestinoUbicar, type FilaEow, type ReporteEow, type Tarjeta,
} from '@/lib/eow/modelo'

// Editor del reporte EOW (13/11/2026). Todo se edita en la pantalla y se guarda junto con «Guardar cambios» (un solo POST con
// la versión leída: si alguien guardó antes, 409 y se pide recargar, sin pisar lo del otro).

type Props = { semanas: string[]; inicial: ReporteEow | null; historial: EntradaHistorial[] }

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export function EditorEow({ semanas, inicial, historial }: Props) {
  const router = useRouter()
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
    if (sucio && !window.confirm('Tenés cambios sin guardar en esta semana. ¿Crear la semana nueva igual?')) return
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

  const titulo = inicial ? `Reporte EOW · semana del ${fechaCorta(inicial.semana)}` : 'Reporte EOW'
  return (
    <div className="eow cj-pila cj-pila--chica">
      <SeccionTitulo
        etiqueta="EOW · End of Week"
        titulo={titulo}
        acciones={<Boton variante="marca" onClick={nuevaSemana}>Nueva semana</Boton>}
      />

      {semanas.length > 0 && (
        <nav className="eow-semanas" aria-label="Semanas anteriores">
          {semanas.map((s) => (
            <Link key={s} href={`/eow?semana=${s}`} className="eow-chip" aria-current={s === inicial?.semana ? 'page' : undefined}>
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
                      <button type="button" className={`eow-pill eow-pill--${f.pausado ? 'pausado' : c}`} onClick={() => editarFila(f.id, { pausado: !f.pausado })} title={f.pausado ? 'Quitar la pausa' : 'Marcar pausado'}>
                        {f.pausado ? 'Pausado' : NOMBRE_COLOR[c]}
                      </button>
                      <label className="eow-mover">
                        <span className="eow-sr">Mover a {f.cliente} a otro color</span>
                        <select value={c} onChange={(e) => editarFila(f.id, { color: e.target.value as Color })}>
                          {COLORES.map((x) => <option key={x} value={x}>{NOMBRE_COLOR[x]}</option>)}
                        </select>
                      </label>
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
                  <li key={i}><strong>{h.quien}</strong> · {hora(h.cuando)} — {h.cambios.slice(0, 8).join(' · ')}{h.cambios.length > 8 ? ` · y ${h.cambios.length - 8} más` : ''}</li>
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
        <button type="submit" className="eow-agregar">+</button>
      </form>
    </div>
  )
}
