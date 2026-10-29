'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { haceCuanto, ordenPendientes, type Notificacion } from '@/lib/notificaciones/modelo'
import { atajosDelHub } from './menuRapidoAtajos'
import { NOMBRE_SECCION_CORTO } from './menuRapidoTextos'
import './menuRapido.css'

// Menú rápido del hub Clientes (27/10/2026, pedido de Tomás: "hub rápido con acciones y todas las notificaciones para estar
// rápidos"). Un botón al lado de las pestañas, con la cantidad de pendientes; al abrirlo:
//   · arriba, las notificaciones PENDIENTES que ve esta persona (urgentes primero, después las que más esperan): qué hay que
//     hacer, a quién le toca (una persona o una sección), hace cuánto que está sin hacerse y el botón "Hecho";
//   · abajo, los accesos rápidos a las pestañas que la persona puede ver.
// Fuente: GET /api/notificaciones?pendientes=1 (lib/notificaciones). El aviso emergente con sonido es del marco del shell
// (sesión DASHBOARD PWA), que lee la misma fuente. Sondea cada 60 s con la pestaña visible y al abrir el menú.

type Acceso = { href: string; etiqueta: string }
const SONDEO_MS = 60_000

export function MenuRapido({ accesos, puedeEditarCliente = false, puedeFinanzas = false, puedeEntregarGuiones = false }: { accesos: Acceso[]; puedeEditarCliente?: boolean; puedeFinanzas?: boolean; puedeEntregarGuiones?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [lista, setLista] = useState<Notificacion[] | null>(null)
  const [error, setError] = useState(false)
  const [errorAccion, setErrorAccion] = useState(false)
  const [avisoFuente, setAvisoFuente] = useState<string | null>(null)
  const [verHechas, setVerHechas] = useState(false)
  const [marcando, setMarcando] = useState<number | null>(null)
  const idPanel = useId()
  const caja = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)

  const cargar = useCallback(async () => {
    // ?demo=1 (solo en desarrollo): pendientes de ejemplo, sin tocar la base
    if (process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('demo') === '1') { setLista(ejemplo()); setError(false); return }
    try {
      const r = await fetch(`/api/notificaciones?${verHechas ? 'historial=1' : 'pendientes=1'}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const j = (await r.json()) as { notificaciones?: Notificacion[]; avisoReconciliacion?: string | null }
      setAvisoFuente(j.avisoReconciliacion ?? null)
      setLista([...(j.notificaciones ?? [])].sort(ordenPendientes)); setError(false)
    } catch { setError(true) }
  }, [verHechas])

  useEffect(() => {
    const primera = setTimeout(() => void cargar(), 0)
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, SONDEO_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearTimeout(primera); clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar])

  // Cerrar con Escape o tocando afuera; el foco vuelve al botón
  useEffect(() => {
    if (!abierto) return
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAbierto(false); boton.current?.focus() } }
    const afuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', afuera)
    return () => { document.removeEventListener('keydown', tecla); document.removeEventListener('pointerdown', afuera) }
  }, [abierto])

  const hecha = async (n: Notificacion) => {
    setMarcando(n.id); setErrorAccion(false)
    if (process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('demo') === '1') {
      setLista(l => verHechas ? (l ?? []).map(x => x.id === n.id ? { ...x, hechaEn: new Date().toISOString(), hechaPor: 'Prueba' } : x) : (l ?? []).filter(x => x.id !== n.id))
      setMarcando(null); return
    }
    try {
      const r = await fetch(`/api/notificaciones/${n.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'hecha' }) })
      if (!r.ok) throw new Error(String(r.status))
      setLista(l => verHechas ? (l ?? []).map(x => x.id === n.id ? { ...x, hechaEn: new Date().toISOString(), hechaPor: 'Vos' } : x) : (l ?? []).filter(x => x.id !== n.id))
    } catch { setErrorAccion(true) } finally { setMarcando(null) }
  }

  const pendientes = lista?.filter(n => !n.hechaEn).length ?? 0
  const atajos = atajosDelHub(accesos, { puedeEditarCliente, puedeFinanzas, puedeEntregarGuiones })
  const urgentes = lista?.filter(n => n.urgente && !n.hechaEn).length ?? 0
  return (
    <div className="mr" ref={caja}>
      <button ref={boton} type="button" className={`mr-boton${urgentes ? ' mr-boton--urgente' : ''}`} aria-expanded={abierto} aria-controls={idPanel}
        onClick={() => { setAbierto(v => !v); if (!abierto) void cargar() }}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>
        Atajos y pendientes
        {pendientes > 0 && <span className="mr-cuenta" aria-label={`${pendientes} pendientes${urgentes ? `, ${urgentes} urgentes` : ''}`}>{pendientes}</span>}
      </button>
      {abierto && (
        <div id={idPanel} className="mr-panel" role="region" aria-label="Hub de atajos">
          <section aria-labelledby={`${idPanel}-a`}>
            <h2 id={`${idPanel}-a`} className="mr-titulo">¿Qué necesitás hacer?</h2>
            <nav aria-label="Acciones rápidas" className="mr-acciones">
              {atajos.map(a => <Link key={a.href} href={a.href} className="mr-accion" onClick={() => setAbierto(false)}>{a.etiqueta}<span aria-hidden> →</span></Link>)}
            </nav>
          </section>
          <section aria-labelledby={`${idPanel}-p`}>
            <div className="mr-cab-pendientes"><h2 id={`${idPanel}-p`} className="mr-titulo">Pendientes {pendientes > 0 && <span className="mr-sub">· {pendientes}{urgentes ? `, ${urgentes} urgentes` : ''}</span>}</h2><button className="mr-historial" type="button" aria-pressed={verHechas} onClick={() => setVerHechas(v => !v)}>{verHechas ? 'Sólo pendientes' : 'Ver también hechas'}</button></div>
            {errorAccion && <p className="mr-aviso" role="alert">No se pudo marcar como hecha. Reintentá.</p>}
            {avisoFuente && <p className="mr-aviso" role="status">{avisoFuente}</p>}
            {error && <p className="mr-aviso" role="status">No se pudieron leer las notificaciones. Probá de nuevo en un minuto.</p>}
            {!error && lista === null && <p className="mr-vacio">Cargando…</p>}
            {!error && lista?.length === 0 && <p className="mr-vacio">Nada pendiente.</p>}
            {!!lista?.length && (
              <ul className="mr-lista">
                {lista.map(n => (
                  <li key={n.id} className={`mr-item${n.hechaEn ? ' mr-item--hecha' : ''}${n.urgente ? ' mr-item--urgente' : ''}`}>
                    <div className="mr-item__texto">
                      <p className="mr-item__titulo">{n.urgente && <span className="mr-urgente">Urgente</span>}{n.url ? <Link href={n.url} onClick={() => setAbierto(false)}>{n.titulo}</Link> : n.titulo}</p>
                      {n.cuerpo && <p className="mr-item__cuerpo">{n.cuerpo}</p>}
                      <p className="mr-item__meta">
                        {n.paraEmail ? `Para ${n.paraEmail.split('@')[0]}` : n.paraSeccion ? `Para ${NOMBRE_SECCION_CORTO[n.paraSeccion] ?? n.paraSeccion}` : 'Para todos'}
                        {' · '}<span title={new Date(n.creadaEn).toLocaleString('es-AR')}>{n.hechaEn ? `Hecha por ${n.hechaPor || 'el equipo'}` : `sin hacer ${haceCuanto(n.creadaEn)}`}</span>
                      </p>
                    </div>
                    <button type="button" className="mr-hecho" disabled={marcando === n.id || !!n.hechaEn} onClick={() => void hecha(n)}>
                      {n.hechaEn ? 'Hecha' : marcando === n.id ? 'Guardando…' : 'Hecho'}<span className="cj-solo-lectores">: {n.titulo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <nav aria-label="Accesos rápidos" className="mr-accesos">
            {accesos.map(a => <Link key={a.href} href={a.href} className="mr-acceso" onClick={() => setAbierto(false)}>{a.etiqueta}</Link>)}
          </nav>
        </div>
      )}
    </div>
  )
}

function ejemplo(): Notificacion[] {
  const hace = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const n = (id: number, o: Partial<Notificacion>): Notificacion => ({ id, creadaEn: hace(2), paraEmail: null, paraSeccion: null, tipo: 'ejemplo', titulo: '', cuerpo: '', url: null, urgente: false, hechaEn: null, hechaPor: null, origen: 'demo', vista: false, ...o })
  return [
    n(1, { titulo: 'Tanda de guiones a revisar · Estudio Ejemplo Tres', cuerpo: '6 guiones listos para verificar.', paraSeccion: 'guiones', urgente: true, creadaEn: hace(26), url: '/guiones?demo=1' }),
    n(2, { titulo: 'Pago vencido · Estudio Ejemplo Cuatro', cuerpo: 'Venció hace 5 días.', paraSeccion: 'finanzas', urgente: true, creadaEn: hace(5) }),
    n(3, { titulo: 'Crudos nuevos para revisar · Estudio Ejemplo Cinco', paraSeccion: 'edicion', creadaEn: hace(50), url: '/clientes/edicion?demo=1' }),
    n(4, { titulo: 'Renovación en 6 días · Estudio Ejemplo Dos', paraEmail: 'tomas@ejemplo.test', creadaEn: hace(3), url: '/clientes?demo=1&cliente=E002' }),
  ].sort(ordenPendientes)
}

