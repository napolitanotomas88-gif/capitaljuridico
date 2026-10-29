'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ETIQUETA_PRIORIDAD, type FilaGuiones, type Prioridad } from '@/lib/clientes/prioridad'

// Tabla de guiones por cliente: prioridad, último guion, último lanzamiento en Meta, días y entregas desde el lanzamiento, y si se
// grabó. Filtros de un toque. En el celular, tarjetas.
type FiltroGrabado = 'todos' | 'grabado' | 'nunca' | 'sin_grabar'
const fecha = (ymd: string | null) => (ymd ? ymd.split('-').reverse().slice(0, 2).join('/') + '/' + ymd.slice(2, 4) : '—')
const dias = (n: number | null) => (n === null ? '—' : n === 0 ? 'hoy' : `hace ${n} ${n === 1 ? 'día' : 'días'}`)
const lanz = (f: FilaGuiones) => (f.ultimoLanzamiento ? `${f.lanzamientoAprox ? '≈ ' : ''}${fecha(f.ultimoLanzamiento)}` : f.campanaActiva ? 'activa (sin fecha)' : 'nunca')

export function TablaGuiones({ filas, avisos }: { filas: FilaGuiones[]; avisos: string[] }) {
  const [q, setQ] = useState('')
  const [grabado, setGrabado] = useState<FiltroGrabado>('todos')
  const [prioridad, setPrioridad] = useState<Prioridad | 0>(0)
  const visibles = useMemo(() => filas.filter(f =>
    (!q || f.nombre.toLowerCase().includes(q.toLowerCase()) || f.idCliente.toLowerCase().includes(q.toLowerCase())) &&
    (grabado === 'todos' || (grabado === 'grabado' ? f.grabado : grabado === 'nunca' ? !f.grabado : f.guionSinGrabar)) &&
    (!prioridad || f.prioridad === prioridad)), [filas, q, grabado, prioridad])
  const cuenta = (p: Prioridad) => filas.filter(f => f.prioridad === p).length

  return (
    <section className="cj-pila cj-pila--chica" aria-labelledby="h-tabla-guiones">
      <h2 id="h-tabla-guiones" className="cj-titulo cj-titulo--seccion">Guiones por cliente</h2>
      <p className="cj-texto-2 gs-sub">
        Prioridad 5 = onboarding (guiones desde cero) · 4 = optimización urgente (fue mal o no hay nada rindiendo) · 3 = optimización con variables · 1 = variaciones de lo que funciona, para que no se queme.
        Los datos de guiones y grabaciones salen de la carpeta de cada cliente en Drive: el documento “Guiones” (última modificación) y los videos de “Crudos” (se grabó).
      </p>
      {avisos.map(a => <p key={a} className="pr-aviso" role="status">{a}</p>)}
      <div className="gs-filtros">
        <input className="gs-buscar" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" />
        <div className="cj-fila" role="group" aria-label="Prioridad">
          <button type="button" className="cj-chip" aria-pressed={prioridad === 0} onClick={() => setPrioridad(0)}>Todas ({filas.length})</button>
          {([5, 4, 3, 1] as Prioridad[]).map(p => (
            <button key={p} type="button" className="cj-chip" aria-pressed={prioridad === p} onClick={() => setPrioridad(prioridad === p ? 0 : p)}>Prioridad {p} ({cuenta(p)})</button>
          ))}
        </div>
        <div className="cj-fila" role="group" aria-label="Grabación">
          {(['todos', 'grabado', 'nunca', 'sin_grabar'] as FiltroGrabado[]).map(g => (
            <button key={g} type="button" className="cj-chip" aria-pressed={grabado === g} onClick={() => setGrabado(g)}>
              {g === 'todos' ? 'Grabados y no' : g === 'grabado' ? 'Se grabó' : g === 'nunca' ? 'Nunca se grabó' : `Guiones sin grabar (${filas.filter(f => f.guionSinGrabar).length})`}
            </button>
          ))}
        </div>
      </div>
      <p className="cj-etiqueta" role="status">{visibles.length} de {filas.length} clientes activos</p>
      <ul className="gs-lista">
        {visibles.map(f => (
          <li key={f.idCliente} className={`gs-item gs-item--p${f.prioridad}`}>
            <div className="gs-item__cab">
              <span className={`gs-prioridad gs-prioridad--${f.prioridad}`} title={ETIQUETA_PRIORIDAD[f.prioridad]}>P{f.prioridad}</span>
              <Link href={`/clientes/${encodeURIComponent(f.idCliente)}`} prefetch={false} className="gs-item__nombre">{f.nombre}</Link>
              {f.etapa && <span className="pr-etapa">{f.etapa}</span>}
              {f.guionSinGrabar && <span className="gs-alerta">Guiones sin grabar</span>}
            </div>
            <dl className="gs-datos">
              <div><dt>Último guion</dt><dd>
                {f.ultimoGuion ? <>{f.guionUrl ? <a href={f.guionUrl} target="_blank" rel="noreferrer" className="gs-enlace">{fecha(f.ultimoGuion)}</a> : fecha(f.ultimoGuion)} <span className="cj-texto-2">({dias(f.diasDesdeGuion)})</span></> : 'Sin guiones'}
                {f.guionPor && <span className="gs-por">por {f.guionPor}</span>}
              </dd></div>
              <div><dt>Último lanzamiento</dt><dd>{lanz(f)}</dd></div>
              <div><dt>¿Guion nuevo desde el lanzamiento?</dt><dd>{f.guionDespuesDelLanzamiento === null ? (f.guionesDesdeLanzamiento === null ? '—' : `${f.guionesDesdeLanzamiento} entregas`) : f.guionDespuesDelLanzamiento ? 'Sí' : 'No'}</dd></div>
              <div><dt>¿Se grabó?</dt><dd>{f.grabado ? `Sí${f.ultimaGrabacion ? ` (${fecha(f.ultimaGrabacion)})` : ''}` : 'Nunca'}{f.crudos !== null && <span className="gs-por">{f.crudos} {f.crudos === 1 ? 'video crudo' : 'videos crudos'}{f.editados !== null ? ` · ${f.editados} editados` : ''}</span>}</dd></div>
              <div><dt>Closer</dt><dd>{f.closer || '—'}</dd></div>
            </dl>
            <p className="gs-enlaces">
              {/* Acción principal a un clic (25/10/2026): la tanda de guiones del cliente, con la sección Guiones sola */}
              <Link href={`/guiones/${encodeURIComponent(f.idCliente)}`} prefetch={false} className="cj-boton cj-boton--marca gs-accion">Abrir guiones</Link>
              {f.carpetaUrl && <a href={f.carpetaUrl} target="_blank" rel="noreferrer" className="pr-enlace">Carpeta en Drive</a>}
              {f.urlClickUp && <a href={f.urlClickUp} target="_blank" rel="noreferrer" className="pr-enlace">ClickUp</a>}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
