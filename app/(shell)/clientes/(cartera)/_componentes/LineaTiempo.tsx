'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AYUDA_ETAPA, ETAPAS, ETAPAS_CIERRE, FILTROS_RECORRIDO_INICIALES, NOMBRE_ETAPA, NOMBRE_RANGO, RANGOS_ANTIGUEDAD, VENCE_PRONTO_DIAS,
  NOMBRE_TRAMO, TRAMOS, agruparPorEtapa, agruparPorTramo, filtrarRecorrido, posicionEnEje, tramoDe,
  type Etapa, type FilaRecorrido, type FiltrosRecorrido, type IdTramo,
} from '@/lib/clientes/recorrido'
import { clasesFuentes } from '../../../fuentes'
import './recorrido.css'

// Línea de tiempo de la cartera (25/10/2026, reemplaza "Prioridad: todavía sin campaña lanzada"): todos los clientes de
// Agencia, cada uno en su etapa (la regla está en lib/clientes/recorrido.ts). Arriba, una barra con cuántos hay en cada
// etapa (tocar una hace "zoom" a esa etapa); filtros por closer, antigüedad, frenados y vencimiento; abajo, las columnas
// (en el celular, una lista por etapa que se abre de a una y los filtros detrás de un botón). Tocar un cliente abre su
// tarjeta completa al costado (en el celular, a pantalla completa): la URL pasa a ?cliente=<ID> (se puede compartir) y el
// servidor la arma con DetalleCliente; mientras llega se ve el esqueleto. Cerrar vuelve atrás en el historial si la abrió
// un clic (el "atrás" no la reabre). El panel va en un portal sobre <body>: el shell anima su contenido con transform y
// eso rompería el position: fixed. Filtra en el navegador sobre filas livianas (sin contacto).
// Dos vistas (25/10/2026, pedido de Tomás: "que la línea de tiempo sea literal"): POR TIEMPO (por defecto) es un eje de 0 a 4
// meses desde el Día 1 con cada cliente en su día exacto y los tramos de 30 días debajo; tocar un tramo lo agranda y trae
// todas sus tarjetas con una animación más larga (con scroll si son muchas). POR ETAPA son las columnas de antes.

const POR_COLUMNA = 8
const RECORRIDO = ETAPAS.filter(e => !ETAPAS_CIERRE.includes(e))

type Props = {
  filas: FilaRecorrido[]
  abierto: string | null          // ?cliente= que ya armó el servidor
  detalle: ReactNode              // la tarjeta abierta (DetalleCliente dentro de Suspense)
  avisos: string[]
  avisoCliente?: { texto: string; href: string | null } | null   // ?cliente= que no abre ninguna tarjeta
}

const diasTxt = (n: number | null) => (n === null ? '' : n === 0 ? 'hoy' : `${n} ${n === 1 ? 'día' : 'días'}`)
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function LineaTiempo({ filas, abierto, detalle, avisos, avisoCliente }: Props) {
  const router = useRouter()
  const ruta = usePathname()
  const [f, setF] = useState<FiltrosRecorrido>(FILTROS_RECORRIDO_INICIALES)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [cerrado, setCerrado] = useState<string | null>(null)   // el que se acaba de cerrar: no se muestra mientras el servidor responde
  const [, empezar] = useTransition()
  const [masDe, setMasDe] = useState<Set<Etapa>>(new Set())
  const [abiertasMovil, setAbiertasMovil] = useState<Set<Etapa>>(new Set())
  const [filtrosMovil, setFiltrosMovil] = useState(false)
  const [vista, setVista] = useState<'tiempo' | 'etapas'>('tiempo')
  const [tramo, setTramo] = useState<IdTramo | null>(null)
  const origen = useRef<HTMLElement | null>(null)
  const porClic = useRef(false)   // la tarjeta abierta entró al historial con un clic acá: cerrar = volver atrás
  const focoPendiente = useRef(false)   // al cerrar, el foco vuelve a la tarjeta de origen cuando el panel ya se desmontó (y la página dejó de estar inerte)

  const cambiar = (o: Partial<FiltrosRecorrido>) => setF(x => ({ ...x, ...o }))
  const closers = useMemo(() => [...new Set(filas.map(x => x.closer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [filas])
  const visibles = useMemo(() => filtrarRecorrido(filas, f), [filas, f])
  const grupos = useMemo(() => agruparPorEtapa(visibles), [visibles])
  const enColumnas = (xs: FilaRecorrido[]) => xs.filter(x => f.cierre || !ETAPAS_CIERRE.includes(x.etapa)).length
  const cuentaFrenados = useMemo(() => enColumnas(filtrarRecorrido(filas, { ...f, frenados: true })), [filas, f])   // eslint-disable-line react-hooks/exhaustive-deps
  const cuentaVencen = useMemo(() => enColumnas(filtrarRecorrido(filas, { ...f, vencen: true })), [filas, f])         // eslint-disable-line react-hooks/exhaustive-deps
  const columnas = f.etapa ? [f.etapa] : RECORRIDO.concat(f.cierre ? ETAPAS_CIERRE : [])
  const totalRecorrido = filas.filter(x => !ETAPAS_CIERRE.includes(x.etapa)).length
  const mostrando = columnas.reduce((s, e) => s + grupos.get(e)!.length, 0)
  const activos = [
    f.texto && `búsqueda «${f.texto}»`, f.closer && `closer ${f.closer}`, f.antiguedad !== 'todos' && `cliente hace ${NOMBRE_RANGO[f.antiguedad].toLowerCase()}`,
    f.frenados && 'solo frenados', f.vencen && `vencen en ${VENCE_PRONTO_DIAS} días`, f.etapa && `etapa ${NOMBRE_ETAPA[f.etapa]}`,
  ].filter((x): x is string => !!x)
  const limpiar = () => setF(x => ({ ...FILTROS_RECORRIDO_INICIALES, cierre: x.cierre }))

  // ── Abrir y cerrar la tarjeta (la URL manda: ?cliente=<ID>, conservando los demás parámetros) ──
  const urlCon = useCallback((id: string | null) => {
    const q = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
    if (id) q.set('cliente', id)
    else q.delete('cliente')
    const s = q.toString()
    return `${ruta}${s ? `?${s}` : ''}`
  }, [ruta])
  const idPanel = abriendo ?? (abierto && abierto !== cerrado ? abierto : null)
  const abrir = (id: string, el: HTMLElement) => {
    origen.current = el
    setCerrado(null)
    setAbriendo(id)
    // Con otra tarjeta ya abierta se reemplaza la entrada: un solo "atrás" cierra
    const yaAbierta = !!idPanel
    if (!yaAbierta) porClic.current = true
    empezar(() => (yaAbierta ? router.replace(urlCon(id), { scroll: false }) : router.push(urlCon(id), { scroll: false })))
  }
  const cerrar = useCallback(() => {
    setCerrado(abierto)
    setAbriendo(null)
    if (porClic.current) { porClic.current = false; router.back() }
    else empezar(() => router.replace(urlCon(null), { scroll: false }))
    focoPendiente.current = true
  }, [router, urlCon, abierto])
  // El "atrás" del navegador cierra la tarjeta: la URL ya no trae ?cliente y el servidor manda abierto = null
  const [previo, setPrevio] = useState(abierto)
  if (previo !== abierto) {
    setPrevio(abierto)
    if (!abierto) { setAbriendo(null); setCerrado(null) }
  }
  // Se espera a que termine la navegación (abierto = null): Next mueve el foco al navegar y pisaría este
  useEffect(() => {
    if (idPanel || abierto || !focoPendiente.current) return
    focoPendiente.current = false
    const id = requestAnimationFrame(() => {
      const el = origen.current
      if (el?.isConnected) el.focus()
      else document.getElementById('h-recorrido')?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [idPanel, abierto])
  const filaPanel = idPanel ? filas.find(x => x.id === idPanel) ?? null : null
  const cargando = !!abriendo && abriendo !== abierto

  return (
    <section className="cj-panel rc" aria-labelledby="h-recorrido">
      <div className="rc-cabecera">
        <div>
          <p className="cj-etiqueta cj-etiqueta--laton">Recorrido</p>
          <h2 id="h-recorrido" tabIndex={-1} className="cj-titulo cj-titulo--seccion">Dónde está cada cliente</h2>
        </div>
        <p className="cj-texto-2 rc-cabecera__sub">{totalRecorrido} clientes en el recorrido. Tocá una etapa para acercarte y un cliente para ver todo.</p>
      </div>

      {avisos.map(a => <p key={a} className="rc-aviso" role="status">{a}</p>)}
      {avisoCliente && (
        <p className="rc-aviso" role="status">{avisoCliente.texto}{avisoCliente.href && <> <a className="cj-enlace" href={avisoCliente.href}>Abrir su ficha</a></>}</p>
      )}

      <BarraEtapas grupos={grupos} total={totalRecorrido} elegida={f.etapa} onElegir={e => cambiar({ etapa: f.etapa === e ? null : e })} />

      <button type="button" className="rc-abrir-filtros" aria-expanded={filtrosMovil} aria-controls="rc-filtros" onClick={() => setFiltrosMovil(v => !v)}>
        Filtros{activos.length ? ` (${activos.length})` : ''}
      </button>
      <div id="rc-filtros" className={filtrosMovil ? 'rc-filtros rc-filtros--abiertos' : 'rc-filtros'} role="group" aria-label="Filtros del recorrido">
        <label className="rc-campo">
          <span className="cj-etiqueta">Buscar</span>
          <input type="search" value={f.texto} onChange={e => cambiar({ texto: e.target.value })} placeholder="Nombre o ID" className="rc-input" />
        </label>
        <label className="rc-campo">
          <span className="cj-etiqueta">Closer</span>
          <select value={f.closer ?? ''} onChange={e => cambiar({ closer: e.target.value || null })} className="rc-input">
            <option value="">Todos</option>
            {closers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="rc-campo">
          <span className="cj-etiqueta">Cliente hace</span>
          <select value={f.antiguedad} onChange={e => cambiar({ antiguedad: e.target.value as FiltrosRecorrido['antiguedad'] })} className="rc-input">
            {RANGOS_ANTIGUEDAD.map(r => <option key={r} value={r}>{NOMBRE_RANGO[r]}</option>)}
          </select>
        </label>
        <div className="rc-interruptores">
          <Interruptor activo={f.frenados} onClick={() => cambiar({ frenados: !f.frenados })} tono="freno">Frenados <span className="rc-num">{cuentaFrenados}</span></Interruptor>
          <Interruptor activo={f.vencen} onClick={() => cambiar({ vencen: !f.vencen })}>Vencen en {VENCE_PRONTO_DIAS} días <span className="rc-num">{cuentaVencen}</span></Interruptor>
          <Interruptor activo={f.cierre} onClick={() => cambiar({ cierre: !f.cierre })}>Pausa y bajas</Interruptor>
          <button type="button" className="rc-limpiar" onClick={limpiar} disabled={!activos.length}>Limpiar</button>
        </div>
      </div>

      <p className="rc-estado" role="status" aria-live="polite">
        {activos.length ? <>Mostrando <strong>{mostrando}</strong> de {totalRecorrido} · {activos.join(' · ')}</> : <>Mostrando los {mostrando} clientes{f.cierre ? ', con pausa y bajas' : ''}</>}
      </p>

      {f.etapa && (
        <div className="rc-zoom">
          <p><strong>{NOMBRE_ETAPA[f.etapa]}</strong> <span className="cj-texto-2">· {AYUDA_ETAPA[f.etapa]}</span></p>
          <button type="button" className="rc-limpiar" onClick={() => cambiar({ etapa: null })}>Ver todas las etapas</button>
        </div>
      )}

      <div className="rc-vistas" role="group" aria-label="Cómo ver la línea de tiempo">
        <button type="button" className="rc-vista" aria-pressed={vista === 'tiempo'} onClick={() => setVista('tiempo')}>Por tiempo</button>
        <button type="button" className="rc-vista" aria-pressed={vista === 'etapas'} onClick={() => setVista('etapas')}>Por etapa</button>
      </div>

      {vista === 'tiempo' ? (
        <EjeTiempo filas={columnas.flatMap(e => grupos.get(e)!)} abierto={tramo} onTramo={t => setTramo(x => (x === t ? null : t))} idPanel={idPanel} onAbrir={abrir} />
      ) : (
        <div className={f.etapa ? 'rc-marco' : 'rc-marco rc-marco--desliza'}>
          <div className={f.etapa ? 'rc-tablero rc-tablero--zoom' : 'rc-tablero'} key={`${f.etapa ?? 'todas'}`}>
            {columnas.map(e => {
              const xs = grupos.get(e)!
              const todas = f.etapa === e || masDe.has(e)
              const muestra = todas ? xs : xs.slice(0, POR_COLUMNA)
              const frenados = xs.filter(x => x.frenado).length
              const abiertaMovil = !!f.etapa || abiertasMovil.has(e)
              return (
                <section key={e} className={`rc-col rc-col--${e}${abiertaMovil ? ' rc-col--abierta' : ''}`} aria-labelledby={`h-col-${e}`}>
                  <header className="rc-col__cab">
                    <button type="button" className="rc-col__titulo" onClick={() => cambiar({ etapa: f.etapa === e ? null : e })} aria-pressed={f.etapa === e} title={AYUDA_ETAPA[e]}>
                      <span id={`h-col-${e}`}>{NOMBRE_ETAPA[e]}</span>
                      <span className="rc-col__n">{xs.length}</span>
                    </button>
                    {frenados > 0 && <span className="rc-col__freno">{plural(frenados, 'frenado', 'frenados')}</span>}
                    {/* En el celular las etapas vienen cerradas: este botón las abre (en escritorio no se ve) */}
                    <button type="button" className="rc-col__plegar" aria-expanded={abiertaMovil} aria-controls={`rc-lista-${e}`}
                      onClick={() => setAbiertasMovil(s => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n })}>
                      {abiertaMovil ? 'Cerrar' : 'Ver'}
                      <span className="cj-solo-lectores"> {NOMBRE_ETAPA[e]}</span>
                    </button>
                  </header>
                  <div id={`rc-lista-${e}`} className="rc-col__cuerpo">
                    {xs.length === 0 ? (
                      <div className="rc-col__vacio">
                        <p>{activos.length ? 'Nadie con estos filtros' : 'Nadie en esta etapa'}</p>
                        {activos.length > 0 && <button type="button" className="rc-limpiar" onClick={limpiar}>Limpiar filtros</button>}
                      </div>
                    ) : (
                      <ul className="rc-col__lista">
                        {muestra.map((x, i) => (
                          <li key={x.clave ?? x.id} style={{ '--i': Math.min(i, 6) } as CSSProperties}>
                            <Tarjeta x={x} grande={!!f.etapa} activa={idPanel === x.id} onAbrir={abrir} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {!todas && xs.length > POR_COLUMNA && (
                      <button type="button" className="rc-col__mas" onClick={() => setMasDe(s => new Set(s).add(e))}>Ver los otros {xs.length - POR_COLUMNA}</button>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {idPanel && (
        <Panel titulo={filaPanel?.nombre ?? idPanel} subtitulo={filaPanel ? `Cliente ${filaPanel.id}${filaPanel.closer ? ` · closer ${filaPanel.closer}` : ''}` : ''} onCerrar={cerrar}>
          {cargando || !abierto ? <Esqueleto /> : detalle}
        </Panel>
      )}
    </section>
  )
}

function BarraEtapas({ grupos, total, elegida, onElegir }: { grupos: Map<Etapa, FilaRecorrido[]>; total: number; elegida: Etapa | null; onElegir: (e: Etapa) => void }) {
  return (
    <ol className={elegida ? 'rc-barra rc-barra--zoom' : 'rc-barra'} aria-label="Clientes por etapa">
      {RECORRIDO.map((e, i) => {
        const n = grupos.get(e)!.length
        const frenados = grupos.get(e)!.filter(x => x.frenado).length
        return (
          <li key={e} className="rc-barra__item" style={{ '--peso': Math.max(n, total ? 0.6 : 1), '--paso': i } as CSSProperties}>
            <button type="button" className={`rc-barra__btn rc-barra__btn--${e}`} aria-pressed={elegida === e} onClick={() => onElegir(e)} aria-label={`${NOMBRE_ETAPA[e]}: ${plural(n, 'cliente', 'clientes')}${frenados ? `, ${plural(frenados, 'frenado', 'frenados')}` : ''}`}>
              <span className="rc-barra__n">{n}</span>
              <span className="rc-barra__nombre">{NOMBRE_ETAPA[e]}</span>
              {frenados > 0 && <span className="rc-barra__freno" aria-hidden>{frenados}</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// Familia de color de cada etapa en el eje: producción (latón), lanzado (verde), éxito (verde profundo), renovación, cierre
const FAMILIA: Record<Etapa, string> = {
  alta: 'prod', kickoff: 'prod', guiones: 'prod', grabacion: 'prod2', edicion: 'prod2', por_lanzar: 'prod2',
  lanzado: 'lanza', exito: 'exito', renovacion: 'renov', pausa: 'cierre', baja: 'cierre', sin_dato: 'cierre',
}
const LEYENDA: [string, string][] = [['prod', 'Alta a Guiones'], ['prod2', 'Grabación a Por lanzar'], ['lanza', 'Lanzado'], ['exito', 'Éxito'], ['renov', 'Renovación']]
const POR_TRAMO_CERRADO = 6

/** El eje literal: regla de 0 a 4 meses con un punto por cliente en su día y, debajo, los tramos de 30 días. */
function EjeTiempo({ filas, abierto, onTramo, idPanel, onAbrir }: {
  filas: FilaRecorrido[]; abierto: IdTramo | null; onTramo: (t: IdTramo) => void; idPanel: string | null; onAbrir: (id: string, el: HTMLElement) => void
}) {
  const porTramo = useMemo(() => agruparPorTramo(filas), [filas])
  // Puntos: los que caen casi en el mismo día se apilan hacia arriba (hasta 7 de alto)
  const puntos = useMemo(() => {
    const pila = new Map<number, number>()
    return filas.filter(x => x.diasCliente !== null).map(x => {
      const pos = posicionEnEje(x.diasCliente!)
      const celda = Math.round(pos * 80)
      const nivel = pila.get(celda) ?? 0
      pila.set(celda, nivel + 1)
      return { x, pos, nivel: Math.min(nivel, 6) }
    })
  }, [filas])
  const idx = TRAMOS.findIndex(t => t.id === abierto)
  const tramos: IdTramo[] = [...TRAMOS.map(t => t.id), ...(porTramo.get('sin_fecha')!.length ? ['sin_fecha' as const] : [])]
  return (
    <div className={abierto ? 'rc-eje rc-eje--abierto' : 'rc-eje'}>
      <div className="rc-regla" aria-hidden>
        <div className="rc-regla__puntos">
          {idx >= 0 && <span className="rc-regla__foco" style={{ left: `${(idx / TRAMOS.length) * 100}%`, width: `${100 / TRAMOS.length}%` }} />}
          {puntos.map(({ x, pos, nivel }) => (
            <span key={x.clave ?? x.id} className={`rc-pto rc-pto--${FAMILIA[x.etapa]}${x.frenado ? ' rc-pto--freno' : ''}${idPanel === x.id ? ' rc-pto--activo' : ''}${abierto && tramoDe(x.diasCliente) !== abierto ? ' rc-pto--fuera' : ''}`}
              style={{ left: `${pos * 100}%`, '--nivel': nivel } as CSSProperties} title={`${x.nombre} · día ${x.diasCliente}`} />
          ))}
        </div>
        <div className="rc-regla__linea">
          {[0, 1, 2, 3, 4].map(m => <span key={m} className="rc-regla__marca" style={{ left: `${(m / 5) * 100}%` }}><span>{m === 0 ? 'Día 1' : `Mes ${m}`}</span></span>)}
          <span className="rc-regla__marca rc-regla__marca--fin" style={{ left: '100%' }}><span>+</span></span>
        </div>
      </div>
      <ul className="rc-leyenda" aria-label="Colores de las etapas">
        {LEYENDA.map(([k, t]) => <li key={k}><span className={`rc-pto rc-pto--${k} rc-pto--quieto`} aria-hidden />{t}</li>)}
        <li><span className="rc-pto rc-pto--prod rc-pto--freno rc-pto--quieto" aria-hidden />Frenado</li>
      </ul>

      <div className="rc-tramos">
        {tramos.map(t => {
          const xs = porTramo.get(t)!
          const frenados = xs.filter(x => x.frenado).length
          const esAbierto = abierto === t
          return (
            <section key={t} className={`rc-tramo${esAbierto ? ' rc-tramo--abierto' : ''}${abierto && !esAbierto ? ' rc-tramo--chico' : ''}`} aria-labelledby={`h-tramo-${t}`}>
              <button type="button" className="rc-tramo__cab" aria-expanded={esAbierto} aria-controls={`rc-tramo-${t}`} onClick={() => onTramo(t)}>
                <span id={`h-tramo-${t}`} className="rc-tramo__nombre">{NOMBRE_TRAMO[t]}</span>
                <span className="rc-tramo__n">{xs.length}</span>
                {frenados > 0 && <span className="rc-tramo__freno">{plural(frenados, 'frenado', 'frenados')}</span>}
                <span className="rc-tramo__accion">{esAbierto ? 'Cerrar' : 'Abrir'}</span>
              </button>
              <div id={`rc-tramo-${t}`} className="rc-tramo__cuerpo">
                {xs.length === 0 ? <p className="rc-col__vacio">Nadie en este tramo</p> : esAbierto ? (
                  <ul className="rc-tramo__tarjetas">
                    {xs.map((x, i) => (
                      <li key={x.clave ?? x.id} style={{ '--i': Math.min(i, 14) } as CSSProperties}>
                        <span className={`rc-tramo__etapa rc-tramo__etapa--${FAMILIA[x.etapa]}`}>{NOMBRE_ETAPA[x.etapa]} · día {x.diasCliente ?? '—'}</span>
                        <Tarjeta x={x} grande activa={idPanel === x.id} onAbrir={onAbrir} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="rc-mini">
                    {xs.slice(0, POR_TRAMO_CERRADO).map(x => (
                      <li key={x.clave ?? x.id}>
                        {/* Tocar el nombre abre la tarjeta completa del cliente (sin abrir el tramo) */}
                        <button type="button" className={`rc-mini__item${x.frenado ? ' rc-mini__item--freno' : ''}${idPanel === x.id ? ' rc-mini__item--activo' : ''}`}
                          onClick={e => onAbrir(x.id, e.currentTarget)} aria-haspopup="dialog">
                          <span className={`rc-pto rc-pto--${FAMILIA[x.etapa]} rc-pto--quieto`} aria-hidden />
                          <span className="rc-mini__nombre">{x.nombre}</span>
                          <span className="rc-mini__etapa">{NOMBRE_ETAPA[x.etapa]} · día {x.diasCliente ?? '—'}</span>
                        </button>
                      </li>
                    ))}
                    {xs.length > POR_TRAMO_CERRADO && (
                      <li>
                        <button type="button" className="rc-mini__mas" aria-controls={`rc-tramo-${t}`} onClick={() => {
                          onTramo(t)
                          // El botón desaparece al abrir: el foco va a la primera tarjeta que no se veía
                          requestAnimationFrame(() => document.querySelector<HTMLElement>(`#rc-tramo-${t} .rc-tramo__tarjetas > li:nth-child(${POR_TRAMO_CERRADO + 1}) button`)?.focus())
                        }}>
                          Ver los otros {xs.length - POR_TRAMO_CERRADO}
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Tarjeta({ x, grande, activa, onAbrir }: { x: FilaRecorrido; grande: boolean; activa: boolean; onAbrir: (id: string, el: HTMLElement) => void }) {
  // Los días frenados ya se ven en rojo en "en la etapa": la alerta solo se repite si es otra cosa
  const porDias = !!x.alertas[0]?.endsWith('sin moverse')
  const motivo = porDias ? x.alertas[1] : x.alertas[0]
  return (
    <button
      type="button"
      className={`rc-tarjeta${x.frenado ? ' rc-tarjeta--freno' : ''}${activa ? ' rc-tarjeta--activa' : ''}`}
      onClick={e => onAbrir(x.id, e.currentTarget)}
      aria-haspopup="dialog"
    >
      <span className="rc-tarjeta__nombre">{x.nombre}</span>
      <span className="rc-tarjeta__meta">
        {x.closer && <span>Closer {x.closer}</span>}
        {x.diasEtapa !== null && (
          <span className={porDias ? 'rc-tarjeta__dias--freno' : undefined}>
            {porDias && <span className="rc-punto" aria-hidden />}
            {x.diasEtapa === 0 ? 'Llegó hoy' : `${diasTxt(x.diasEtapa)} en la etapa`}{porDias ? ' · frenado' : ''}
          </span>
        )}
        {x.fuente === 'clickup' && <span className="rc-tarjeta__fuente">según ClickUp</span>}
      </span>
      {grande && <span className="rc-tarjeta__detalle">{x.detalle}</span>}
      {motivo && <span className="rc-tarjeta__alerta"><span className="rc-punto" aria-hidden />{motivo}</span>}
      {!motivo && x.venceEn !== null && x.venceEn <= VENCE_PRONTO_DIAS && <span className="rc-tarjeta__vence">{x.venceEn >= 0 ? `Vence en ${diasTxt(x.venceEn)}` : `Venció hace ${diasTxt(-x.venceEn)}`}</span>}
    </button>
  )
}

function Interruptor({ activo, onClick, tono, children }: { activo: boolean; onClick: () => void; tono?: 'freno'; children: ReactNode }) {
  return (
    <button type="button" className={`rc-interruptor${tono ? ` rc-interruptor--${tono}` : ''}`} aria-pressed={activo} onClick={onClick}>
      {children}
    </button>
  )
}

const sinSuscripcion = () => () => {}
const ENFOCABLES = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Panel lateral (pantalla completa en el celular): diálogo modal en un portal, con el resto de la página inerte, foco
// adentro, Escape y clic afuera cierran
function Panel({ titulo, subtitulo, onCerrar, children }: { titulo: string; subtitulo: string; onCerrar: () => void; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null)
  const encabezado = useRef<HTMLHeadingElement>(null)
  // El portal necesita document: en el servidor (enlace directo con ?cliente=) no se dibuja y aparece al hidratar
  const montado = useSyncExternalStore(sinSuscripcion, () => true, () => false)
  useEffect(() => {
    if (!montado) return
    encabezado.current?.focus()
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const fondo = document.querySelector<HTMLElement>('.cj-raiz')
    fondo?.setAttribute('inert', '')
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCerrar(); return }
      if (e.key !== 'Tab' || !caja.current) return
      const foco = caja.current.querySelectorAll<HTMLElement>(ENFOCABLES)
      if (!foco.length) return
      const primero = foco[0], ultimo = foco[foco.length - 1], activo = document.activeElement
      if (e.shiftKey && (activo === primero || activo === encabezado.current)) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus() }
    }
    document.addEventListener('keydown', tecla)
    return () => { document.body.style.overflow = previo; fondo?.removeAttribute('inert'); document.removeEventListener('keydown', tecla) }
  }, [montado, onCerrar])
  if (!montado) return null
  return createPortal(
    <div className={`rc-capa ${clasesFuentes}`}>
      <div className="rc-fondo" onClick={onCerrar} aria-hidden />
      <div ref={caja} className="rc-panel" role="dialog" aria-modal="true" aria-labelledby="rc-panel-titulo">
        <div className="rc-panel__cab">
          <div>
            <h2 id="rc-panel-titulo" ref={encabezado} tabIndex={-1} className="cj-titulo rc-panel__titulo">{titulo}</h2>
            {subtitulo && <p className="cj-etiqueta">{subtitulo}</p>}
          </div>
          <button type="button" className="rc-cerrar" onClick={onCerrar} aria-label="Cerrar la tarjeta del cliente">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="rc-panel__cuerpo" data-rc-cuerpo>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Saltos dentro de la tarjeta: desplazan solo el cuerpo del panel (sin hash: no suman historial ni corren la página). */
export function Saltos({ secciones }: { secciones: [string, string][] }) {
  const ir = (ancla: string, el: HTMLElement) => {
    const cuerpo = el.closest<HTMLElement>('[data-rc-cuerpo]')
    const sec = document.getElementById(ancla)
    if (!cuerpo || !sec) return
    const barra = el.closest<HTMLElement>('.rc-saltos')?.offsetHeight ?? 0
    cuerpo.scrollTo({ top: sec.getBoundingClientRect().top - cuerpo.getBoundingClientRect().top + cuerpo.scrollTop - barra - 8, behavior: 'smooth' })
  }
  return (
    <nav className="rc-saltos" aria-label="Secciones del cliente">
      {secciones.map(([ancla, texto]) => <button key={ancla} type="button" className="rc-salto" onClick={e => ir(ancla, e.currentTarget)}>{texto}</button>)}
    </nav>
  )
}

export function Esqueleto({ etiqueta = 'Cargando la tarjeta del cliente' }: { etiqueta?: string }) {
  return (
    <div className="rc-esqueleto" role="status" aria-label={etiqueta}>
      <span /><span /><span className="rc-esqueleto--corto" /><span /><span className="rc-esqueleto--alto" /><span />
    </div>
  )
}
