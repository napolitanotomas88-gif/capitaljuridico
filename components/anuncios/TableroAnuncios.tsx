'use client'

// Tablero de anuncios: carga inicial y actualizaciones manuales. Dos vistas:
//   · LISTA (simple): una línea por cliente con el color, el porqué, el CPL, los guiones y el link.
//   · DETALLE: en celular tarjetas; en escritorio tabla compacta con todos los números.
// La vista elegida se recuerda en este navegador.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilaAnuncio, Tablero } from '@/lib/anuncios/tablero'
import { dm, fmtEntero, fmtGasto, fmtMonto, fmtPct, haceTiempo, sumarDias } from '@/lib/anuncios/formato'
import { COLOR, colorDe, Corriendo, Enlaces, Estado, GuionEstado, NivelCPL, Saldo, Sparkline, cpl, GUION_CORTO } from './piezas'
import { nombreDia } from '@/lib/anuncios/feriados'
import { RecuentoMeta } from './Recuento'
import { PanelPorLanzar } from './PorLanzar'
import { NotasCliente } from './NotasCliente'
import { filasDelPeriodo, ordenarCPL, type PeriodoCPL, type OrdenCPL } from '@/lib/anuncios/vista'

type FiltroEstado = 'sin_gasto' | 'todos' | 'error' | 'rojo' | 'amarillo' | 'verde'
type FiltroCorriendo = 'todos' | 'menos7' | '7a30' | 'mas30' | 'frenadas'
type FiltroMoneda = 'todas' | 'USD' | 'ARS' | 'otras'
type Vista = 'lista' | 'detalle'
// Fila como se muestra: TODO en USD. Las cuentas en otra moneda vienen convertidas (ARS con el dólar
// MEP venta, el resto con la cotización del día) y guardan su moneda original
type FilaVista = FilaAnuncio & { monedaOriginal?: string; cplOriginal?: number | null }

function aUSD(f: FilaAnuncio, t: number): FilaVista {
  const d = (v: number | null) => (v == null ? null : v / t)
  return {
    ...f, moneda: 'USD', monedaOriginal: f.moneda, cplOriginal: f.cpl.d7,
    cpl: { ...f.cpl, ayer: d(f.cpl.ayer), d7: d(f.cpl.d7), d7prev: d(f.cpl.d7prev), historico: d(f.cpl.historico) },
    gasto: { hoy: f.gasto.hoy / t, ayer: f.gasto.ayer / t, d7: f.gasto.d7 / t, d7prev: f.gasto.d7prev / t, promedioDiario: f.gasto.promedioDiario / t },
    saldo: { ...f.saldo, restante: d(f.saldo.restante) },
  }
}
const CLAVE_VISTA = 'anuncios:vista'
const COLUMNAS_LISTA = 'minmax(170px, 1.1fr) minmax(0, 1.8fr) 105px 105px 110px 60px'

export function TableroAnuncios() {
  const [datosFuente, setDatos] = useState<Tablero | null>(null)
  const cargandoRef = useRef(false)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaConsulta, setUltimaConsulta] = useState<number | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const [estado, setEstado] = useState<FiltroEstado>('todos')
  const [corriendo, setCorriendo] = useState<FiltroCorriendo>('todos')
  const [moneda, setMoneda] = useState<FiltroMoneda>('todas')
  const [q, setQ] = useState('')
  const [periodoCPL, setPeriodoCPL] = useState<PeriodoCPL>('ayer')
  const datos = useMemo(() => {
    if (!datosFuente) return null
    const filas = filasDelPeriodo(datosFuente.filas, periodoCPL)
    return { ...datosFuente, filas, resumen: { ...datosFuente.resumen,
      sinGasto: filas.filter(f => f.semaforo === 'sin_gasto').length,
      errores: filas.filter(f => f.semaforo === 'error').length,
      rojos: filas.filter(f => f.semaforo === 'rojo').length,
      amarillos: filas.filter(f => f.semaforo === 'amarillo').length,
      verdes: filas.filter(f => f.semaforo === 'verde').length,
    } }
  }, [datosFuente, periodoCPL])
  const [ordenCPL, setOrdenCPL] = useState<OrdenCPL>('prioridad')
  const [rama, setRama] = useState<string>('todas')
  const [soloGracia, setSoloGracia] = useState(false)
  const [soloAumento, setSoloAumento] = useState(false)
  const [foco, setFoco] = useState<'lanzadas' | 'revisar' | null>(null)
  const hayFiltros = estado !== 'todos' || corriendo !== 'todos' || moneda !== 'todas' || q !== '' || rama !== 'todas' || soloAumento || soloGracia || foco !== null || ordenCPL !== 'prioridad' || periodoCPL !== 'ayer'
  const restablecer = () => { setEstado('todos'); setCorriendo('todos'); setMoneda('todas'); setQ(''); setRama('todas'); setSoloAumento(false); setSoloGracia(false); setFoco(null); setOrdenCPL('prioridad'); setPeriodoCPL('ayer') }
  // Acceso de un clic: parte de cero (sin combinar filtros previos que vacíen la lista) y lleva al listado
  const irA = (modo: 'lanzadas' | 'revisar') => {
    if (foco === modo) { setFoco(null); return }
    setEstado('todos'); setCorriendo('todos'); setMoneda('todas'); setQ(''); setRama('todas'); setSoloAumento(false); setSoloGracia(false); setFoco(modo)
    setTimeout(() => document.getElementById('listado-foco')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  // Se lee en el primer render del navegador: mientras carga se muestra el aviso de "Cargando", que no usa la vista
  const [vista, setVistaEstado] = useState<Vista>(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem(CLAVE_VISTA) === 'detalle' ? 'detalle' : 'lista' } catch { return 'lista' }
  })
  const setVista = (v: Vista) => { setVistaEstado(v); try { localStorage.setItem(CLAVE_VISTA, v) } catch { /* nada */ } }

  const cargar = useCallback(async (manual = false) => {
    if (cargandoRef.current) return
    cargandoRef.current = true
    setActualizando(true)
    try {
      // Sin cache:'no-store' a propósito: el navegador mandaría "Cache-Control: no-cache" y en
      // desarrollo Next saltearía su caché (le pegaría a Meta en cada consulta). La API ya responde no-store.
      // ?demo=1 fuera de producción (25/10/2026): cuentas de ejemplo (lib/anuncios/demo.ts), sin pedirle nada a Meta
      if (process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('demo') === '1') {
        const { tableroDemo } = await import('@/lib/anuncios/demo')
        setDatos(tableroDemo(new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)))
        setError(null)
        setUltimaConsulta(Date.now())
        return
      }
      const r = await fetch('/api/anuncios', { method: manual ? 'POST' : 'GET' })
      if (r.status === 401) { window.location.href = '/anuncios/login'; return }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`)
      setDatos(j as Tablero)
      setError(null)
      setUltimaConsulta(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      cargandoRef.current = false
      setActualizando(false)
    }
  }, [])

  // Sólo carga inicial. El reloj actualiza las etiquetas, sin pedir datos.
  useEffect(() => {
    const primera = setTimeout(() => void cargar(), 0)
    const tic = setInterval(() => setAhora(Date.now()), 5000)
    return () => { clearTimeout(primera); clearInterval(tic) }
  }, [cargar])

  const filas = useMemo((): FilaVista[] => {
    if (!datos) return []
    const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const busca = n(q.trim())
    const filtradas = datos.filas.filter(f => {
      if (soloGracia && !f.pago.periodoGracia) return false
      if (estado !== 'todos' && f.semaforo !== estado) return false
      const c = f.corriendo
      if (corriendo === 'frenadas' && c.frenadaHace == null && !f.pausado && !c.sinAnunciosActivos) return false
      if (corriendo === 'menos7' && !(!f.pausado && !c.sinAnunciosActivos && c.frenadaHace == null && c.dias < 7)) return false
      if (corriendo === '7a30' && !(!f.pausado && !c.sinAnunciosActivos && c.frenadaHace == null && c.dias >= 7 && c.dias <= 30)) return false
      if (corriendo === 'mas30' && !(!f.pausado && !c.sinAnunciosActivos && c.frenadaHace == null && c.dias > 30)) return false
      if (moneda === 'otras' ? ['USD', 'ARS'].includes(f.moneda) : moneda !== 'todas' && f.moneda !== moneda) return false
      if (soloAumento && !f.aumento) return false
      if (foco === 'lanzadas' && !f.lanzamientos.some(l => !l.etapa && l.dia <= 10)) return false
      if (foco === 'revisar' && !f.revisarDia4) return false
      if (rama !== 'todas' && (rama === 'sin' ? !!f.rama : f.rama?.id !== rama)) return false
      if (busca && !n(`${f.cliente} ${f.cuenta} ${f.negocio?.nombre ?? ''} ${f.idNum}`).includes(busca)) return false
      return true
    }).map(f => (f.moneda !== 'USD' && f.usdPor ? aUSD(f, f.usdPor) : f))
    return ordenarCPL(filtradas, periodoCPL, ordenCPL)
  }, [datos, estado, corriendo, moneda, q, rama, soloAumento, soloGracia, foco, periodoCPL, ordenCPL])
  const ramas = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of datos?.filas ?? []) if (f.rama) m.set(f.rama.id, f.rama.nombre)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [datos])

  if (!datos) {
    return (
      <div className="mx-auto px-4 md:px-8 py-16" style={{ maxWidth: 1480 }}>
        <p className="etq-laton">Capital Jurídico</p>
        <h1 className="serif mt-3" style={{ fontSize: 44 }}>Anuncios de clientes</h1>
        {error ? (
          <div role="alert" className="mt-8">
            <p style={{ color: 'var(--hueso)', borderLeft: '2px solid var(--borgona)', paddingLeft: 12 }}>No se pudo cargar el tablero: {error}</p>
            <button type="button" className="boton mt-5" disabled={actualizando} onClick={() => void cargar(true)}>Reintentar</button>
          </div>
        ) : (
          <div role="status" aria-busy="true" className="mt-8">
            <p style={{ color: 'var(--humo)' }}>Cargando las cuentas de Meta, el CRM y los guiones…</p>
            <div className="mt-6 grid gap-3">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="esqueleto" style={{ height: 56, opacity: 1 - i * 0.12 }} />)}
            </div>
          </div>
        )}
      </div>
    )
  }

  const r = datos.resumen
  const tok = datos.token?.principal
  return (
    <div className="mx-auto px-4 md:px-8 pt-10 pb-20" style={{ maxWidth: 1480 }}>
      {/* ── Encabezado ── */}
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
        <div>
          <p className="etq-laton">Capital Jurídico · Pauta de clientes</p>
          <h1 className="serif mt-2" style={{ fontSize: 'clamp(38px, 5vw, 56px)', lineHeight: 1.02 }}>Anuncios de clientes</h1>
        </div>
        <div className="lg:text-right" style={{ fontSize: 13, color: 'var(--humo)', lineHeight: 1.7 }}>
          <div style={{ color: 'var(--hueso)', fontSize: 15 }}>
            Actualizado {haceTiempo(datos.actualizado.insights ?? datos.generado, ahora)}
            {error && <span style={{ color: 'var(--laton)' }}> · sin conexión ({haceTiempo(ultimaConsulta, ahora)})</span>}
          </div>
          <button type="button" disabled={actualizando} onClick={() => void cargar(true)} aria-busy={actualizando}
            className="border px-3 py-1 my-2 disabled:opacity-50" style={{ borderColor: 'var(--laton)', color: 'var(--hueso)' }}>
            {actualizando ? 'Actualizando…' : 'Actualizar datos'}
          </button>
          <span className="sr-only" role="status">{actualizando ? 'Actualizando datos' : error ? `Error: ${error}` : ultimaConsulta ? 'Datos cargados' : ''}</span>
          <div>
            Gasto y mensajes {haceTiempo(datos.actualizado.insights, ahora)} · pagos y saldo {haceTiempo(datos.actualizado.cuentas, ahora)} · actualización manual
          </div>
          <div>
            Token de Meta:{' '}
            {tok
              ? !tok.valido ? <span style={{ color: 'var(--hueso)' }}>inválido</span>
                : tok.diasRestantes == null ? 'no vence'
                : <span style={{ color: tok.diasRestantes <= 10 ? 'var(--hueso)' : undefined }}>vence en {tok.diasRestantes} días</span>
              : 'sin datos'}
            {' · '}
            <a href="/api/anuncios/reporte-pdf" style={{ color: 'var(--laton)', textDecoration: 'underline', textUnderlineOffset: 3 }}>reporte PDF</a>
            {' · '}
            <form method="post" action="/api/anuncios/logout" style={{ display: 'inline' }}>
              <button type="submit" style={{ background: 'none', border: 0, color: 'var(--humo)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }} title="Cierra solo el acceso a Anuncios (la sesión de Google sigue); vuelve a pedir la clave">cerrar Anuncios</button>
            </form>
          </div>
        </div>
      </header>
      <div style={{ height: 1, background: 'var(--laton)', width: 56, margin: '26px 0 30px', opacity: 0.7 }} />

      {/* ── Resumen en una línea ── */}
      {/* Resumen en tarjetas (25/10/2026): cada número es un botón que filtra la lista; el estado va con su cuadradito Y su texto */}
      <section aria-label="Resumen" className="anu-resumen">
        {([['error', r.errores, 'con error'], ['sin_gasto', r.sinGasto, 'sin gasto'], ['rojo', r.rojos, 'en rojo'], ['amarillo', r.amarillos, 'en amarillo'], ['verde', r.verdes, 'en verde']] as const).map(([k, n, txt]) => (
          <button
            key={k} type="button" onClick={() => setEstado(estado === k ? 'todos' : k)} aria-pressed={estado === k}
            className="anu-tarjeta"
          >
            <span className="anu-tarjeta__rotulo">
              <span style={{ width: 10, height: 10, background: COLOR[k], border: k === 'verde' ? '1px solid rgba(239,233,220,0.25)' : 'none', display: 'inline-block', flex: 'none' }} />
              {txt.charAt(0).toUpperCase() + txt.slice(1)}
            </span>
            <span className="serif num anu-tarjeta__valor">{n}</span>
            <span className="anu-tarjeta__accion">{estado === k ? 'Quitar filtro' : 'Filtrar la lista'}</span>
          </button>
        ))}
        {([['lanzadas', r.lanzadas, 'Lanzamientos recientes'], ['revisar', r.revisarDia4, 'Revisar para optimizar']] as const).map(([k, n, txt]) => (
          <button
            key={k} type="button" onClick={() => irA(k)} aria-pressed={foco === k}
            title={k === 'lanzadas' ? 'Cuentas con anuncios nuevos de los últimos 10 días' : 'Revisión pendiente desde el día 4 del lanzamiento (o de la última reactivación tras una pausa) hasta confirmar la optimización, y revisión semanal (cada 7 días) de campañas DM con 2 o más anuncios o tras 7 días de competencia'}
            className="anu-tarjeta anu-tarjeta--azul"
          >
            <span className="anu-tarjeta__rotulo">{txt}</span>
            <span className="serif num anu-tarjeta__valor">{n}</span>
            <span className="anu-tarjeta__accion">{foco === k ? 'Quitar foco' : 'Ver cuáles'}</span>
          </button>
        ))}
        <a href="#por-lanzar" onClick={() => { const d = document.getElementById('por-lanzar') as HTMLDetailsElement | null; if (d) d.open = true }}
          title="Clientes activos que todavía no lanzaron: acceso a su cuenta de Meta y lo que dice su ficha de kickoff para armar la campaña"
          className="anu-tarjeta anu-tarjeta--laton">
          <span className="anu-tarjeta__rotulo">Por lanzar</span>
          <span className="serif num anu-tarjeta__valor">{r.porLanzar}</span>
          <span className="anu-tarjeta__contexto">{r.sinAccesoPorLanzar} sin acceso{r.listosParaArmar > 0 ? ` · ${r.listosParaArmar} listo${r.listosParaArmar > 1 ? 's' : ''} para armar` : ''}</span>
        </a>
        <p className="anu-resumen__linea">
          <b style={{ color: 'var(--hueso)', fontWeight: 500 }}>{r.erroresPago}</b> con error de pago{r.erroresNuevos > 0 && <span style={{ color: 'var(--azul)' }}> ({r.erroresNuevos} nuevo{r.erroresNuevos > 1 ? 's' : ''}, en azul 3 días)</span>} ·{' '}
          <b style={{ color: 'var(--hueso)', fontWeight: 500 }}>{r.saldosPorAgotarse}</b> por quedarse sin saldo ·{' '}
          <b style={{ color: 'var(--hueso)', fontWeight: 500 }}>{r.sinMensajes}</b> gastan sin mensajes ·{' '}
          <b style={{ color: 'var(--hueso)', fontWeight: 500 }}>{r.enAumento}</b> {'\u2197\uFE0E'} en aumento ·{' '}
          <b style={{ color: 'var(--hueso)', fontWeight: 500 }}>{r.aGrabar}</b> a grabar ·{' '}
          <b style={{ color: 'var(--hueso)', fontWeight: 500 }}>{r.sinGuionesNecesarios}</b> sin guiones que se necesitan ·{' '}
          {r.total} cuentas
        </p>
      </section>

      <TermometroMeta dias={datos.diasMeta} hoy={datos.hoy} />
      <RecuentoMeta hoy={datos.hoy} casa="bolsa" />
      <PanelLanzamientos filas={datos.filas} foco={foco} alOptimizar={() => void cargar()} />
      <PanelCompetencia filas={datos.filas} alRevisar={() => void cargar(false)} />
      <PanelPresupuesto filas={datos.filas} hoy={datos.hoy} />
      <PanelPorLanzar items={datos.porLanzar ?? []} avisos={datos.avisosPorLanzar ?? []} sinEditados={datos.porLanzarSinEditados ?? []} />
      <NotasCliente />
      <GuionesAGrabar filas={datos.filas} />

      {/* ── Avisos (Meta limita, token, sheets) ── */}
      {datos.avisos.length > 0 && (
        <section aria-label="Avisos" className="mt-8 flex flex-col gap-2">
          {datos.avisos.map((a, i) => (
            <p key={i} style={{ fontSize: 14, borderLeft: '2px solid var(--borgona)', paddingLeft: 12, color: 'var(--hueso)' }}>{a}</p>
          ))}
        </section>
      )}

      {/* ── Filtros ── */}
      <section aria-label="Filtros" className="mt-10 flex flex-col lg:flex-row lg:flex-wrap lg:items-end gap-5 lg:gap-x-10" style={{ borderTop: '1px solid var(--filete)', paddingTop: 20 }}>
        <Grupo titulo="Vista">
          <Chip activo={vista === 'lista'} onClick={() => setVista('lista')}>Lista</Chip>
          <Chip activo={vista === 'detalle'} onClick={() => setVista('detalle')}>Detalle</Chip>
        </Grupo>
        <Grupo titulo="CPL">
          <Chip activo={periodoCPL === 'd7'} onClick={() => setPeriodoCPL('d7')}>Últimos 7 días</Chip>
          <Chip activo={periodoCPL === 'ayer'} onClick={() => setPeriodoCPL('ayer')}>Día anterior</Chip>
        </Grupo>
        <label className="flex flex-col gap-2" style={{ minWidth: 180 }}>
          <span className="etq">Ordenar por</span>
          <select aria-label="Ordenar por" className="buscar" value={ordenCPL} onChange={e => setOrdenCPL(e.target.value as OrdenCPL)} style={{ background: 'var(--tinta)' }}>
            <option value="prioridad">Prioridad</option>
            <option value="alto">CPL más alto</option>
            <option value="bajo">CPL más bajo</option>
          </select>
        </label>
        <Grupo titulo="Estado">
          <Chip activo={soloGracia} onClick={() => { setSoloGracia(!soloGracia); setEstado('todos'); setCorriendo('todos'); setMoneda('todas'); setQ(''); setRama('todas'); setSoloAumento(false); setFoco(null) }}>Período de gracia · Revisar ({datos.resumen.periodoGracia})</Chip>
          {(['todos', 'error', 'sin_gasto', 'rojo', 'amarillo', 'verde'] as const).map(k => (
            <Chip key={k} activo={estado === k} onClick={() => setEstado(k)}>{k === 'todos' ? 'Todos' : k === 'error' ? '\u26A0\uFE0E Error' : k === 'sin_gasto' ? 'Sin gasto' : k}</Chip>
          ))}
          <Chip activo={soloAumento} onClick={() => setSoloAumento(!soloAumento)}>{'\u2197\uFE0E'} En aumento ({datos.resumen.enAumento})</Chip>
          <Chip activo={foco === 'lanzadas'} onClick={() => irA('lanzadas')}><span style={{ color: foco === 'lanzadas' ? undefined : 'var(--azul)' }}>{'\u25CF'}</span> Lanzadas ({datos.resumen.lanzadas})</Chip>
          <Chip activo={foco === 'revisar'} onClick={() => irA('revisar')}><span style={{ color: foco === 'revisar' ? undefined : 'var(--azul)' }}>{'\u25CF'}</span> Revisar ({datos.resumen.revisarDia4})</Chip>
        </Grupo>
        <Grupo titulo="Días corriendo">
          {([['todos', 'Todos'], ['menos7', 'Menos de 7'], ['7a30', '7 a 30'], ['mas30', 'Más de 30'], ['frenadas', 'Frenadas']] as const).map(([k, t]) => (
            <Chip key={k} activo={corriendo === k} onClick={() => setCorriendo(k)}>{t}</Chip>
          ))}
        </Grupo>
        <Grupo titulo="Moneda">
          {([['todas', 'Todas'], ['USD', 'USD'], ['ARS', 'ARS'], ['otras', 'Otras']] as const).map(([k, t]) => (
            <Chip key={k} activo={moneda === k} onClick={() => setMoneda(k)}>{t}</Chip>
          ))}
        </Grupo>
        <label className="flex flex-col gap-2" style={{ minWidth: 200 }}>
          <span className="etq">Rama del derecho</span>
          <select className="buscar" value={rama} onChange={e => setRama(e.target.value)} style={{ background: 'var(--tinta)' }}>
            <option value="todas">Todas</option>
            {ramas.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            <option value="sin">Sin rama</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 xl:ml-auto" style={{ minWidth: 220 }}>
          <span className="etq">Buscar cliente</span>
          <input className="buscar" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, cuenta o portfolio" />
        </label>
      </section>
      <p id="listado-foco" className="mt-4" style={{ fontSize: 13, color: 'var(--humo)', scrollMarginTop: 16 }}>
        {hayFiltros && <button type="button" className="chip" onClick={restablecer} style={{ marginRight: 12 }}>Restablecer filtros</button>}
        {foco && <span style={{ color: 'var(--azul)', marginRight: 8 }}>{foco === 'lanzadas' ? 'Solo lanzamientos recientes' : 'Solo campañas a revisar (día 4-5)'} ·</span>}
        {filas.length === datos.filas.length ? `${filas.length} cuentas` : `${filas.length} de ${datos.filas.length} cuentas`} · {ordenCPL === 'prioridad' ? 'ordenadas por prioridad' : ordenCPL === 'alto' ? 'CPL de mayor a menor' : 'CPL de menor a mayor'} · CPL {periodoCPL === 'ayer' ? `del día anterior (${dm(sumarDias(datos.hoy, -1))})` : 'de los últimos 7 días'}
        <span style={{ display: 'block', marginTop: 6 }}>Colores: CPL {periodoCPL === 'ayer' ? 'del día anterior' : 'de los últimos 7 días'}. Tendencias y guiones: evaluación independiente. Sin CPL o sin conversión a USD: al final del orden por CPL.</span>
      </p>

      {foco && (() => {
        const ocultos = datos.filas.filter(f => f.semaforo === 'error' && !filas.some(x => x.id === f.id)).length
        return ocultos > 0 ? (
          <p className="mt-2" style={{ fontSize: 13, color: 'var(--hueso)', borderLeft: '2px solid var(--borgona)', paddingLeft: 12 }}>
            {ocultos} cuenta{ocultos > 1 ? 's' : ''} con error no aparece{ocultos > 1 ? 'n' : ''} en este filtro. <button type="button" className="enlace" onClick={() => { setFoco(null); setEstado('error') }} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' }}>Ver errores</button>
          </p>
        ) : null
      })()}

      {/* ── Vista LISTA: una línea por cliente ── */}
      {vista === 'lista' && (
        <div className="mt-4" style={{ borderTop: '1px solid var(--filete-fuerte)' }}>
          <div className="hidden lg:grid gap-x-4 etq" style={{ gridTemplateColumns: COLUMNAS_LISTA, padding: '10px 0 10px 17px', fontSize: 10 }}>
            <span>Cliente</span><span>Estado · motivo</span><span className="text-right">CPL semanal</span><span className="text-right">Gasto ayer</span><span>Guiones</span><span />
          </div>
          {filas.map(f => <FilaLista key={f.id} f={f} periodo={periodoCPL} ordenado={ordenCPL !== 'prioridad'} />)}
        </div>
      )}

      {/* ── Vista DETALLE · escritorio (1280 px o más): tabla compacta ── */}
      {vista === 'detalle' && <>
      <div className="hidden xl:block mt-4 overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ width: 96 }}>Estado</th>
              <th>Cliente</th>
              <th>Por qué</th>
              <th style={{ textAlign: 'right' }}>CPL semanal</th>
              <th style={{ textAlign: 'right' }}>CPL ayer · 7 ant.</th>
              <th style={{ textAlign: 'right' }}>Gasto ayer · msj</th>
              <th>Corriendo · saldo</th>
              <th>Guiones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => <FilaTabla key={f.id} f={f} periodo={periodoCPL} ordenado={ordenCPL !== 'prioridad'} />)}
          </tbody>
        </table>
      </div>

      {/* ── Celular y tablet: tarjetas (2 columnas desde 768 px) ── */}
      <div className="xl:hidden mt-4 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-8">
        {filas.map(f => <Tarjeta key={f.id} f={f} periodo={periodoCPL} />)}
      </div>
      </>}

      {!filas.length && <p className="mt-10" style={{ color: 'var(--humo)' }}>Ninguna cuenta con esos filtros.</p>}

      {/* ── Cuentas excluidas y referencias ── */}
      <section className="mt-16 grid gap-10 lg:grid-cols-2" style={{ borderTop: '1px solid var(--filete)', paddingTop: 24, fontSize: 14, color: 'var(--humo)' }}>
        <div>
          <p className="etq-laton mb-3">Cómo se lee</p>
          <p>Todo en USD: los pesos se pasan con el dólar MEP venta del día y las otras monedas con su cotización del día. CPL = gasto ÷ conversaciones de mensajes iniciadas: elegí 7 días completos hasta ayer o sólo el día anterior. El selector cambia el CPL, los estados, los contadores y los filtros: ayer o 7 días completos hasta ayer. En el período elegido, gasto sin mensajes: rojo; sin gasto, clientes pausados o sin anuncios activos: grupo separado «Sin gasto», sin color de rendimiento. Los errores de pago tienen prioridad y quedan en su propio grupo. Las alertas de tendencias y guiones conservan sus períodos de evaluación; las cuentas sin anuncios activos en Meta, sin gasto reciente o en pausa del CRM no generan alertas de rendimiento por gasto histórico. Cada rama del derecho tiene su CPL normal (ej. Laboral hasta USD 1,50, Geriátrico hasta 2,70): verde hasta el tope de su rango, amarillo hasta 50% arriba, rojo más. La rama sale de ClickUp (Seguimiento de Anuncios). Sin rama: verde hasta 2,80 · amarillo hasta 4 · rojo más.</p>
          <p className="mt-3">Error (con ⚠︎): problema de pago o sin medio de pago; va arriba de todo porque hay que solucionarlo primero.</p>
          <p className="mt-3">Icono ↗ = CPL en aumento por días seguidos (días hábiles; fines de semana, feriados y días malos de Meta no cuentan). No cambia el color, que va por el CPL actual: 3 días &ldquo;subiendo&rdquo; · 4 días &ldquo;revisar nuevos guiones&rdquo;. Se filtra con &ldquo;↗ En aumento&rdquo;. Un día cuenta si su CPL quedó 20% o más arriba de su base. Los que se queman y los que no rinden (primera tanda con 4 días completos malos) van a Guiones a grabar.</p>
          <p className="mt-3">Línea chica: CPL diario de 3 semanas (punto hueco = fin de semana o feriado; marca roja = gastó sin mensajes; raya latón abajo = día malo de Meta).</p>
          <p className="mt-3">Día malo de Meta: el mismo día, a más de la mitad de las cuentas le subió el CPL 30% o más, y la suba típica también pasa el 30% (se compara hábil con hábil y fin de semana con fin de semana).</p>
        </div>
        {datos.filas.some(f => !f.rama || f.rama.fuente === 'cuenta') && (
          <details>
            <summary className="etq-laton">Falta la rama en ClickUp ({datos.filas.filter(f => !f.rama || f.rama.fuente === 'cuenta').length})</summary>
            <p className="mt-2">Completar &ldquo;Tópicos Objetivos&rdquo; en ClickUp → Seguimiento de Anuncios. Mientras tanto usan los umbrales generales{' '}(o la rama que sugiere el nombre de la cuenta).</p>
            <ul className="mt-3 flex flex-col gap-1">
              {datos.filas.filter(f => !f.rama || f.rama.fuente === 'cuenta').map(f => (
                <li key={f.id}><span style={{ color: 'var(--hueso)' }}>{f.cliente}</span> — {f.clickup ? `tarea "${f.clickup.nombre}" sin tópicos` : 'sin tarea en ClickUp'}{f.rama ? ` (por el nombre de la cuenta: ${f.rama.nombre})` : ''}</li>
              ))}
            </ul>
          </details>
        )}
        {datos.excluidas.length > 0 && (
          <details>
            <summary className="etq-laton">Cuentas de la lista que no se muestran ({datos.excluidas.length})</summary>
            <ul className="mt-3 flex flex-col gap-1">
              {datos.excluidas.map(e => <li key={e.id}><span style={{ color: 'var(--hueso)' }}>{e.cuenta}</span> — {e.motivo}</li>)}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="etq">{titulo}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="chip" aria-pressed={activo} onClick={onClick}>{children}</button>
}

function Identidad({ f }: { f: FilaVista }) {
  const distinto = f.cliente.trim().toLowerCase() !== f.cuenta.trim().toLowerCase()
  return (
    <>
      <div style={{ fontSize: 16, color: 'var(--hueso)', fontWeight: 500, lineHeight: 1.3 }}>{f.cliente}</div>
      <div style={{ fontSize: 12.5, color: 'var(--humo)', marginTop: 2 }}>
        {distinto ? `${f.cuenta} · ` : ''}{f.monedaOriginal ?? f.moneda}{f.negocio?.nombre && f.negocio.nombre !== f.cuenta ? ` · ${f.negocio.nombre}` : ''}{f.extra ? ' · sumada por el CRM' : ''}
        <span style={{ display: 'block', color: f.rama ? 'var(--laton)' : 'var(--humo)' }}>{f.rama ? f.rama.nombre : 'Sin rama'}</span>
        {f.lanzamientos.length > 0 && <span style={{ display: 'block', marginTop: 4 }}><IconoLanzada f={f} /></span>}
      </div>
    </>
  )
}

function PorQue({ f }: { f: FilaAnuncio }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.45 }}>
      {f.aumento && <span style={{ display: 'block', color: 'var(--laton)', marginBottom: 2 }}><IconoAumento f={f} /> {f.aumento.texto}</span>}
      <span style={{ color: 'var(--hueso)' }}>{f.frase}</span>
      {f.semaforo !== 'verde' && f.notas.length > 0 && <span style={{ display: 'block', color: 'var(--humo)', fontSize: 12.5, marginTop: 2 }}>{f.notas.join(' · ')}</span>}
      {!f.pausado && !f.corriendo.sinAnunciosActivos && f.corriendo.frenadaHace == null && f.tendencia.tipo !== 'sin_datos' && !f.motivos.some(m => ['subiendo', 'quemando', 'grabar', 'finde'].includes(m.tipo)) && f.tendencia.tipo !== 'estable' && f.semaforo !== 'verde' && !f.notas.includes(f.tendencia.texto) && (
        <span style={{ display: 'block', color: 'var(--humo)', fontSize: 12.5, marginTop: 2 }}>{f.tendencia.texto}</span>
      )}
    </div>
  )
}

function Mini({ etq, children, derecha }: { etq: string; children: React.ReactNode; derecha?: boolean }) {
  return (
    <div className="num" style={{ display: 'flex', justifyContent: derecha ? 'flex-end' : 'flex-start', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
      <span className="etq" style={{ fontSize: 9.5 }}>{etq}</span>
      <span>{children}</span>
    </div>
  )
}

function FilaTabla({ f, periodo, ordenado }: { f: FilaVista; periodo: PeriodoCPL; ordenado: boolean }) {
  return (
    <tr>
      <td style={{ paddingLeft: 14, borderLeft: `3px solid ${colorDe(f)}` }}><Estado s={f.semaforo} nuevo={f.pago.nuevo} /></td>
      <td style={{ minWidth: 220, maxWidth: 300 }}>
        <Identidad f={f} />
        <div style={{ marginTop: 8 }}><Enlaces f={f} /></div>
      </td>
      <td style={{ minWidth: 220, maxWidth: 320 }}><PorQue f={f} /></td>
      <td style={{ textAlign: 'right' }}>
        <div className="serif num" style={{ fontSize: 28, lineHeight: 1.05, ...marcaOrden(ordenado && periodo === 'd7') }}>{cpl(f.cpl.d7, f, f.gasto.d7)}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><span title={`Nivel según el CPL ${periodo === 'ayer' ? 'del día anterior' : 'de 7 días'}`}><NivelCPL f={f} /> <small style={{ color: 'var(--humo)' }}>color: {periodo === 'ayer' ? 'día anterior' : '7 días'}</small></span></div>
        <RitmoPresupuesto f={f} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}><Sparkline f={f} ancho={96} alto={22} /></div>
      </td>
      <td style={{ textAlign: 'right' }}>
        <Mini etq="Ayer" derecha><span style={marcaOrden(ordenado && periodo === 'ayer')}>{cpl(f.cpl.ayer, f, f.gasto.ayer)}</span></Mini>
        <Mini etq="7 ant." derecha>{cpl(f.cpl.d7prev, f, f.gasto.d7prev)}</Mini>
        {f.cpl.variacion7 != null && <div className="num" style={{ fontSize: 12, color: f.cpl.variacion7 >= 0.2 ? 'var(--hueso)' : 'var(--humo)' }}>{fmtPct(f.cpl.variacion7)} vs. 7 ant.</div>}
      </td>
      <td style={{ textAlign: 'right' }}>
        <Mini etq={f.moneda} derecha>{fmtGasto(f.gasto.ayer, f.moneda, { sinMoneda: true })}</Mini>
        <Mini etq="Msj" derecha>{fmtEntero(f.mensajes.ayer)}</Mini>
        <div className="num" style={{ fontSize: 12, color: 'var(--humo)' }}>hoy {fmtGasto(f.gasto.hoy, f.moneda, { sinMoneda: true })} · {fmtEntero(f.mensajes.hoy)} msj</div>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Corriendo f={f} />
        <div style={{ marginTop: 6, fontSize: 14 }}><Saldo f={f} /></div>
      </td>
      <td style={{ minWidth: 150, maxWidth: 210, fontSize: 14 }}><GuionEstado f={f} /></td>
    </tr>
  )
}

function Dato({ etq, children }: { etq: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="etq" style={{ fontSize: 10 }}>{etq}</div>
      <div className="num" style={{ fontSize: 15, marginTop: 2 }}>{children}</div>
    </div>
  )
}

function Tarjeta({ f, periodo }: { f: FilaVista; periodo: PeriodoCPL }) {
  return (
    <article style={{ borderTop: '1px solid var(--filete)', borderLeft: `3px solid ${colorDe(f)}`, padding: '18px 0 20px 14px' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><Identidad f={f} /></div>
        <Estado s={f.semaforo} nuevo={f.pago.nuevo} />
      </div>
      <div className="mt-3"><PorQue f={f} /></div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="etq" style={{ fontSize: 10 }}>CPL semanal · {f.moneda}</div>
          <div className="serif num" style={{ fontSize: 42, lineHeight: 1.05 }}>{cpl(f.cpl.d7, f, f.gasto.d7)}</div>
          <div className="mt-1"><span title={`Nivel según el CPL ${periodo === 'ayer' ? 'del día anterior' : 'de 7 días'}`}><NivelCPL f={f} /> <small style={{ color: 'var(--humo)' }}>color: {periodo === 'ayer' ? 'día anterior' : '7 días'}</small></span></div>
        </div>
        <RitmoPresupuesto f={f} />
        <Sparkline f={f} ancho={120} alto={30} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
        <Dato etq="CPL ayer">{cpl(f.cpl.ayer, f, f.gasto.ayer)}</Dato>
        <Dato etq="7 anteriores">{cpl(f.cpl.d7prev, f, f.gasto.d7prev)}{f.cpl.variacion7 != null && <span style={{ color: 'var(--humo)', fontSize: 12 }}> {fmtPct(f.cpl.variacion7)}</span>}</Dato>
        <Dato etq="Corriendo"><Corriendo f={f} /></Dato>
        <Dato etq="Gasto ayer">{fmtGasto(f.gasto.ayer, f.moneda, { sinMoneda: true })}</Dato>
        <Dato etq="Mensajes ayer">{fmtEntero(f.mensajes.ayer)}</Dato>
        <Dato etq="Saldo"><Saldo f={f} /></Dato>
      </div>
      <div className="mt-3" style={{ fontSize: 14 }}><span className="etq" style={{ fontSize: 10, marginRight: 8 }}>Guiones</span><GuionEstado f={f} /></div>
      <div className="mt-4"><Enlaces f={f} /></div>
    </article>
  )
}

// ── Termómetro de Meta: las últimas 3 semanas, un cuadrito por día; borgoña = día malo de Meta ──
function TermometroMeta({ dias, hoy }: { dias: Tablero['diasMeta']; hoy: string }) {
  if (!dias?.length) return null
  const malos = dias.filter(x => x.malo)
  const recientes = malos.filter(x => x.d >= sumarDias(hoy, -3))
  const ultimo = recientes[recientes.length - 1]
  return (
    <section aria-label="Días malos de Meta" className="mt-8">
      {ultimo && (
        <p style={{ fontSize: 15, borderLeft: '2px solid var(--borgona)', paddingLeft: 12, color: 'var(--hueso)', marginBottom: 14 }}>
          {ultimo.d === sumarDias(hoy, -1) ? 'Ayer' : `El ${nombreDia(ultimo.d)} ${dm(ultimo.d)}`} fue un día malo de Meta: al {Math.round(ultimo.parte * 100)}% de las cuentas le subió el CPL (suba mediana {fmtPct(ultimo.mediana - 1)}). Es general, no de los guiones: no cuenta para las alertas.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="etq">Meta · últimas 3 semanas</span>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          {dias.map(x => (
            <span
              key={x.d}
              title={`${nombreDia(x.d)} ${dm(x.d)}${x.tipo === 'finde' ? ' (fin de semana / feriado)' : ''}: subió en ${x.suben} de ${x.cuentas} cuentas · mediana ${fmtPct(x.mediana - 1)}${x.malo ? ' · DÍA MALO DE META' : ''}`}
              style={{ width: 10, height: 14, display: 'inline-block', background: x.malo ? 'var(--borgona)' : x.tipo === 'finde' ? 'transparent' : 'rgba(239,233,220,0.16)', border: x.tipo === 'finde' && !x.malo ? '1px solid rgba(239,233,220,0.22)' : '1px solid transparent' }}
            />
          ))}
        </span>
        <span style={{ fontSize: 13, color: 'var(--humo)' }}>
          {malos.length ? `Días malos: ${malos.map(x => `${nombreDia(x.d).slice(0, 3)} ${dm(x.d)}`).join(' · ')}` : 'Ningún día malo: las subas que veas son de cada cuenta'}
        </span>
      </div>
    </section>
  )
}

// ── Vista LISTA: lo mínimo para decidir. Color · cliente · por qué · CPL · guiones · link ──
// La cifra por la que se está ordenando se marca (latón, negrita): si no, el orden parece no aplicarse
const marcaOrden = (activa: boolean): React.CSSProperties => activa ? { color: 'var(--laton)', fontWeight: 600 } : {}

function FilaLista({ f, periodo, ordenado }: { f: FilaVista; periodo: PeriodoCPL; ordenado: boolean }) {
  const cplSemanal = cpl(f.cpl.d7, f, f.gasto.d7)
  const cplAyer = cpl(f.cpl.ayer, f, f.gasto.ayer)
  const guion = GUION_CORTO[f.guiones.estado]
  return (
    <div style={{ borderBottom: '1px solid var(--filete)', borderLeft: `3px solid ${colorDe(f)}` }}>
      {/* Escritorio y tablet */}
      <div className="hidden lg:grid items-center gap-x-4" style={{ gridTemplateColumns: COLUMNAS_LISTA, padding: '12px 0 12px 14px' }}>
        <div className="min-w-0">
          <div style={{ fontSize: 15.5, fontWeight: 500, lineHeight: 1.3, display: 'flex', alignItems: 'baseline', minWidth: 0 }}><span className="truncate">{f.cliente}</span>{f.aumento && <span style={{ flexShrink: 0 }}><IconoAumento f={f} /></span>}{f.lanzamientos.length > 0 && <span style={{ flexShrink: 0 }}><IconoLanzada f={f} /></span>}</div>
          <div style={{ fontSize: 12, color: 'var(--humo)' }} className="truncate">{f.rama ? <span style={{ color: 'var(--laton)' }}>{f.rama.nombre} · </span> : ''}{f.cuenta.trim().toLowerCase() !== f.cliente.trim().toLowerCase() ? `${f.cuenta} · ` : ''}{f.monedaOriginal ?? f.moneda}</div>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.4, color: f.semaforo === 'verde' ? 'var(--humo)' : 'var(--hueso)' }} className="min-w-0">{f.aumento && <span style={{ color: 'var(--laton)' }}>{f.aumento.texto} · </span>}{f.frase}{f.pago.periodoGracia && <span style={{ display: 'block', color: 'var(--azul)' }}>Período de gracia · revisar pago</span>}</div>
        <div className="num" style={{ textAlign: 'right' }}>
          <span className="serif" style={{ fontSize: 22, ...marcaOrden(ordenado && periodo === 'd7') }}>{cplSemanal}</span><small style={{ color: 'var(--humo)' }}> {f.moneda}</small>
          <div style={{ fontSize: 10, color: 'var(--humo)' }}>Objetivo: {fmtMonto(f.presupuesto.objetivoDiarioUSD, 'USD')}/día</div>
          <div style={{ fontSize: 10, color: 'var(--humo)' }}>Real: {fmtMonto(f.presupuesto.realDiarioUSD, 'USD')}/día</div>
        </div>
        <div className="num" style={{ textAlign: 'right' }}>
          <span className="serif" style={{ fontSize: 20 }}>{fmtGasto(f.gasto.ayer, f.moneda)}</span>
          <div style={{ fontSize: ordenado && periodo === 'ayer' ? 13 : 10, color: 'var(--humo)', ...marcaOrden(ordenado && periodo === 'ayer') }}>CPL ayer {cplAyer} {f.moneda}</div>
        </div>
        <div style={{ fontSize: 13, color: f.guiones.estado === 'sin_guiones' ? 'var(--laton)' : 'var(--humo)' }} title={f.guiones.detalle}>{guion}</div>
        <div style={{ textAlign: 'right', paddingRight: 4 }}><a className="enlace" href={f.links.ads} target="_blank" rel="noopener noreferrer">Abrir</a></div>
      </div>
      {/* Celular */}
      <div className="lg:hidden" style={{ padding: '12px 0 12px 12px' }}>
        <div className="flex items-baseline justify-between gap-3">
          <div style={{ fontSize: 15.5, fontWeight: 500, lineHeight: 1.3, display: 'flex', alignItems: 'baseline' }} className="min-w-0"><span className="truncate">{f.cliente}</span>{f.aumento && <span style={{ flexShrink: 0 }}><IconoAumento f={f} /></span>}{f.lanzamientos.length > 0 && <span style={{ flexShrink: 0 }}><IconoLanzada f={f} /></span>}</div>

        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.4, marginTop: 3, color: f.semaforo === 'verde' ? 'var(--humo)' : 'var(--hueso)' }}>{f.aumento && <span style={{ color: 'var(--laton)' }}>{f.aumento.texto} · </span>}{f.frase}{f.pago.periodoGracia && <span style={{ display: 'block', color: 'var(--azul)' }}>Período de gracia · revisar pago</span>}</div>
        <div className="grid grid-cols-2 gap-4 my-2 num" aria-label={`Métricas; estado por ${periodo === 'ayer' ? 'ayer' : '7 días'}`}>
          <div><div className="etq" style={{ fontSize: 9 }}>CPL semanal</div><div style={marcaOrden(ordenado && periodo === 'd7')}>{cplSemanal} {f.moneda}</div><small style={{ color: 'var(--humo)', display: 'block' }}>Objetivo: {fmtMonto(f.presupuesto.objetivoDiarioUSD, 'USD')}/día</small><small style={{ color: 'var(--humo)', display: 'block' }}>Real: {fmtMonto(f.presupuesto.realDiarioUSD, 'USD')}/día</small></div>
          <div><div className="etq" style={{ fontSize: 9 }}>Gasto ayer</div><div>{fmtGasto(f.gasto.ayer, f.moneda)}</div><small style={{ color: 'var(--humo)', ...marcaOrden(ordenado && periodo === 'ayer') }}>CPL ayer {cplAyer} {f.moneda}</small></div>
        </div>
        <div className="flex items-center justify-between gap-3" style={{ marginTop: 6 }}>
          <span style={{ fontSize: 12.5, color: f.guiones.estado === 'sin_guiones' ? 'var(--laton)' : 'var(--humo)' }}>{f.rama ? `${f.rama.nombre} · ` : ''}Guiones: {guion}</span>
          <a className="enlace" href={f.links.ads} target="_blank" rel="noopener noreferrer">Abrir</a>
        </div>
      </div>
    </div>
  )
}


// ── Guiones a grabar: las cuentas que se queman (4+ días hábiles seguidos más caras) y las que no
// rinden (primera tanda con 4 días completos malos). Con el estado de guiones para saber si ya hay algo listo.
function GuionesAGrabar({ filas }: { filas: FilaAnuncio[] }) {
  const quema = filas.filter(f => f.aGrabar === 'quema')
  const noRinde = filas.filter(f => f.aGrabar === 'no_rinde')
  if (!quema.length && !noRinde.length) return null
  const item = (f: FilaAnuncio, tipo: 'grabar' | 'no_rinde') => (
    <li key={f.id} className="flex flex-col lg:flex-row lg:items-baseline gap-x-4 gap-y-0.5" style={{ padding: '8px 0', borderBottom: '1px solid var(--filete)' }}>
      <span style={{ fontWeight: 500, minWidth: 200 }}>{f.cliente}</span>
      <span style={{ color: 'var(--humo)', fontSize: 14, flex: 1 }}>{tipo === 'grabar' ? f.aumento?.texto : f.motivos.find(m => m.tipo === tipo)?.texto}</span>
      <span style={{ fontSize: 13, color: f.guiones.estado === 'sin_guiones' ? 'var(--laton)' : 'var(--humo)', whiteSpace: 'nowrap' }} title={f.guiones.detalle}>
        Guiones: {GUION_CORTO[f.guiones.estado]}
      </span>
      <a className="enlace" href={f.links.ads} target="_blank" rel="noopener noreferrer">Abrir</a>
    </li>
  )
  return (
    <section aria-label="Guiones a grabar" className="mt-8" style={{ borderLeft: '2px solid var(--borgona)', paddingLeft: 16 }}>
      <p className="etq-laton">Guiones a grabar · {quema.length + noRinde.length}</p>
      {quema.length > 0 && <>
        <p className="mt-3" style={{ fontSize: 13, color: 'var(--humo)' }}>Se están quemando: 4 o más días hábiles seguidos más caros</p>
        <ul>{quema.map(f => item(f, 'grabar'))}</ul>
      </>}
      {noRinde.length > 0 && <>
        <p className="mt-4" style={{ fontSize: 13, color: 'var(--humo)' }}>Primera tanda: 4 días completos con CPL del cliente alto o sin mensajes después de lanzar</p>
        <ul>{noRinde.map(f => item(f, 'no_rinde'))}</ul>
      </>}
    </section>
  )
}

// ↗ con los días de suba seguidos: latón si sube (3 días), hueso sobre borgoña si se quema (4) o hay que grabar (5+)
function IconoAumento({ f }: { f: FilaAnuncio }) {
  if (!f.aumento) return null
  const fuerte = f.aumento.nivel !== 'subiendo'
  return (
    <span title={f.aumento.texto} className="num" style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', padding: '1px 6px', marginLeft: 4, verticalAlign: '2px', whiteSpace: 'nowrap',
      background: fuerte ? 'var(--borgona)' : 'transparent', color: fuerte ? 'var(--hueso)' : 'var(--laton)', border: `1px solid ${fuerte ? 'var(--borgona)' : 'var(--laton)'}` }}>
      {'\u2197\uFE0E'} {f.aumento.dias}d
    </span>
  )
}

// Azul = campaña con anuncios nuevos (últimos 10 días). Muestra el día de la más nueva; día 4-5 = revisar
function IconoLanzada({ f }: { f: FilaAnuncio }) {
  const l = [...f.lanzamientos].sort((a, b) => Number(b.pendienteRevision) - Number(a.pendienteRevision) || a.dia - b.dia)[0]
  if (!l) return null
  const revisar = f.revisarDia4
  return (
    <span title={f.lanzamientos.map(x => `${x.campana}: lanzada el ${dm(x.fecha)} (día ${x.dia})`).join('\n')} className="num"
      style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', padding: '1px 6px', marginLeft: 4, verticalAlign: '2px', whiteSpace: 'nowrap',
        background: revisar ? 'var(--azul)' : 'transparent', color: revisar ? 'var(--tinta)' : 'var(--azul)', border: '1px solid var(--azul)' }}>
      {l.pendienteRevision ? 'Revisar para optimizar' : l.fechaRevision ? 'Revisada · ciclo 7 días' : l.etapa === 'competencia' ? `Compiten · ${l.diasCompetencia}/7` : l.etapa === 'ganador' ? 'Revisar ganador' : revisar ? 'Revisar · día 4' : `Nueva · día ${l.dia}`}
    </span>
  )
}

// ── Lanzamientos: por defecto la revisión de día 4-5; con foco, todos los de 10 días o solo los a revisar ──
function PanelLanzamientos({ filas, foco, alOptimizar }: { filas: FilaAnuncio[]; foco: 'lanzadas' | 'revisar' | null; alOptimizar: () => void }) {
  const todos = foco === 'lanzadas'
  const items = filas.flatMap(f => f.lanzamientos.filter(l => todos ? !l.etapa && l.dia <= 10 : l.pendienteRevision).map(l => ({ f, l }))).sort((a, b) => b.l.dia - a.l.dia)
  if (!items.length) {
    return foco ? (
      <section aria-label="Lanzamientos" className="mt-8" style={{ borderLeft: '2px solid var(--azul)', paddingLeft: 16 }}>
        <p className="etq" style={{ color: 'var(--azul)' }}>{todos ? 'Lanzamientos recientes · 0' : 'Revisar para optimizar · 0'}</p>
        <p className="mt-2" style={{ fontSize: 13, color: 'var(--humo)' }}>{todos ? 'No hay anuncios nuevos en los últimos 10 días.' : 'No hay revisiones pendientes de lanzamiento o competencia semanal.'}</p>
      </section>
    ) : null
  }
  return (
    <details open={foco != null} aria-label="Lanzamientos" className="mt-8" style={{ borderLeft: '2px solid var(--azul)', paddingLeft: 16 }}>
      <summary className="etq" style={{ color: 'var(--azul)', cursor: 'pointer' }}>{todos ? 'Lanzamientos recientes' : 'Revisar para optimizar'} · {items.length}</summary>
      <p className="mt-2" style={{ fontSize: 13, color: 'var(--humo)' }}>{todos ? 'Anuncios nuevos de los últimos 10 días (día 1 = el del lanzamiento). Al día 4 o 5 toca revisar CPL, mensajes y creativos.' : 'Revisión inicial desde el día 4 hasta confirmarla. Campañas DM con 2 o más anuncios activos: revisar los mejores cada 7 días; la revisión queda pendiente hasta registrarla.'}</p>
      <ul className="mt-2">
        {items.map(({ f, l }) => {
          const tope = f.rama?.umbral.ok ?? 2.8
          const revisar = l.pendienteRevision
          return (
            <li key={l.campanaId} className="flex flex-col lg:flex-row lg:items-baseline gap-x-4 gap-y-0.5" style={{ padding: '8px 0', borderBottom: '1px solid var(--filete)' }}>
              <span style={{ fontWeight: 500, minWidth: 200 }}>{f.cliente}</span>
              <span style={{ color: 'var(--humo)', fontSize: 14, flex: 1 }}>
                {l.campana} · {l.reactivada ? 'reactivada' : 'lanzada'} el {dm(l.fecha)} · <span style={{ color: 'var(--azul)' }}>día {l.dia}{revisar ? ' · revisar' : ''}</span> · {l.anuncios} anuncio{l.anuncios > 1 ? 's' : ''}
                {l.gasto != null && <> · {fmtGasto(f.usdPor ? l.gasto / f.usdPor : l.gasto, f.usdPor ? 'USD' : f.moneda)} · {l.mensajes} msj · CPL <span style={{ color: l.cplUSD != null && l.cplUSD <= tope ? 'var(--hueso)' : 'var(--laton)' }}>{l.cplUSD != null ? `USD ${l.cplUSD.toFixed(2).replace('.', ',')}` : 'sin mensajes'}</span> (normal ≤ {String(tope).replace('.', ',')})</>}
              </span>
              {revisar && !l.fechaRevision && !l.fechaOptimizacion && !(l.dm && l.anuncios >= 2) && <span style={{ fontSize: 12, color: 'var(--azul)' }}>sin revisión registrada</span>}
              {l.dm && l.anuncios >= 2 && <span style={{ fontSize: 12, color: 'var(--azul)' }}>DM · {l.anuncios} activos · {l.diasDesdeRevision} días {l.fechaRevision || l.fechaOptimizacion ? 'desde última revisión/optimización' : 'desde inicio · sin revisión registrada'}</span>}
              {revisar && <BotonOptimizada campanaId={l.campanaId} alGuardar={alOptimizar} />}
              {revisar && <BotonOptimizada campanaId={l.campanaId} alGuardar={alOptimizar} revision />}
              <a className="enlace" href={l.link} target="_blank" rel="noopener noreferrer">Abrir campaña</a>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function BotonOptimizada({ campanaId, alGuardar, revision = false }: { campanaId: string; alGuardar: () => void; revision?: boolean }) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guardar = async () => {
    if (guardando) return
    setGuardando(true); setError(null)
    try {
      const r = await fetch('/api/anuncios/optimizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campanaId, accion: revision ? 'revision_competencia' : 'optimizacion' }) })
      if (!r.ok) throw new Error((await r.json()).error ?? 'No se pudo guardar')
      alGuardar()
    } catch (e) { setError((e as Error).message) }
    finally { setGuardando(false) }
  }
  return <span><button type="button" className="enlace" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : revision ? 'Ya revisé' : 'Ya optimicé'}</button>{error && <small role="alert">{error}</small>}</span>
}

function PanelCompetencia({ filas, alRevisar }: { filas: FilaAnuncio[]; alRevisar: () => void }) {
  const items = filas.flatMap(f => f.lanzamientos.filter(l => l.etapa).map(l => ({ f, l })))
  if (!items.length) return null
  return <section id="competencia" aria-label="Seguimiento de optimizaciones" className="mt-8" style={{ borderLeft: '2px solid var(--azul)', paddingLeft: 16 }}>
    <p className="etq" style={{ color: 'var(--azul)' }}>Mejores compitiendo · {items.filter(x => x.l.etapa === 'competencia').length} · Revisar ganador final · {items.filter(x => x.l.etapa === 'ganador').length}</p>
    <p className="mt-2" style={{ fontSize: 13, color: 'var(--humo)' }}>7 días desde la confirmación de optimización. Después: comparar los anuncios que quedaron, elegir el ganador y mantener presupuesto si funciona.</p>
    <ul>{items.map(({ f, l }) => <li key={l.campanaId} className="flex flex-col lg:flex-row gap-3 py-2" style={{ borderBottom: '1px solid var(--filete)' }}>
      <span>{f.cliente}</span><span style={{ color: 'var(--azul)', flex: 1 }}>{l.etapa === 'ganador' ? 'Revisar ganador final' : `Mejores compitiendo · ${l.diasCompetencia} de 7 días`} · optimización confirmada {dm(l.fechaOptimizacion!)} · {l.campana}</span>
      {l.etapa === 'ganador' && <BotonOptimizada campanaId={l.campanaId} alGuardar={alRevisar} revision />}
      <a className="enlace" href={l.link} target="_blank" rel="noopener noreferrer">Abrir campaña</a>
    </li>)}</ul>
  </section>
}

function PanelPresupuesto({ filas, hoy }: { filas: FilaAnuncio[]; hoy: string }) {
  const cortos = filas.filter(f => f.presupuesto.estado === 'corto')
  const excesos = filas.filter(f => f.presupuesto.estado === 'exceso')
  const enRango = filas.filter(f => f.presupuesto.estado === 'en_rango')
  const faltantes = filas.filter(f => f.presupuesto.estado === 'sin_presupuesto')
  const [year, mes, dia] = hoy.split('-').map(Number)
  const diasMes = new Date(Date.UTC(year, mes, 0)).getUTCDate()
  const diasRestantes = diasMes - dia + 1
  const esperado = (dia - 1) / diasMes * 100
  const porcentaje = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%'
  const grupos = [
    { titulo: 'Se están quedando cortos', filas: cortos, color: 'var(--laton)' },
    { titulo: 'Se están pasando', filas: excesos, color: '#c98085' },
    { titulo: 'Dentro del margen (±USD 20)', filas: enRango, color: 'var(--azul)' },
  ]
  return <details aria-label="Revisar presupuesto" className="mt-8" style={{ borderLeft: '2px solid var(--laton)', paddingLeft: 16 }}>
    <summary className="etq-laton" style={{ cursor: 'pointer' }}>Revisar presupuesto · {cortos.length + excesos.length}</summary>
    <p className="mt-3" style={{ color: 'var(--humo)', fontSize: 13 }}>Gasto acumulado hasta {dm(sumarDias(hoy, -1))}. Quedan {diasRestantes} días, desde hoy hasta fin de mes. El objetivo diario reparte el presupuesto pendiente entre esos días.</p>
    <p className="mt-1" style={{ color: 'var(--humo)', fontSize: 12 }}>Barra = presupuesto consumido · marca vertical = avance esperado del mes ({porcentaje(esperado)}). Configurado en Meta se compara con el objetivo de los días restantes; es presupuesto asignado, no gasto garantizado. La proyección indica cómo cerraríamos si mantenemos el ritmo del mes hasta ayer. Desvíos de hasta USD 20, hacia arriba o abajo, están dentro del margen; el objetivo sigue siendo cumplir el pactado exacto.</p>
    {grupos.filter(g => g.filas.length).map(grupo => <section key={grupo.titulo} aria-label={grupo.titulo} className="mt-6">
      <h3 className="etq-laton" style={{ color: grupo.color }}>{grupo.titulo} · {grupo.filas.length}</h3>
      <ul>{grupo.filas.map(f => {
        const p = f.presupuesto
        const restante = Math.max(0, p.mensualUSD! - p.gastadoMesUSD!)
        const consumido = p.mensualUSD! > 0 ? p.gastadoMesUSD! / p.mensualUSD! * 100 : 0
        const desvio = p.proyeccionUSD! - p.mensualUSD!
        const cierreConfigurado = p.configuradoDiarioUSD == null ? null : p.gastadoMesUSD! + p.configuradoDiarioUSD * diasRestantes
        const diferenciaConfigurada = cierreConfigurado == null ? null : Math.round((cierreConfigurado - p.mensualUSD!) * 100) / 100
        const cumplimiento = f.pago.errorPago ? 'Error de pago: lo configurado no se está gastando' : p.gastadoMesUSD! > p.mensualUSD! + 20 && p.configuradoDiarioUSD === 0 ? 'Ya excedido · configurado en cero' : diferenciaConfigurada == null ? p.configuradoNota ?? 'Sin datos de Meta' : Math.abs(diferenciaConfigurada) <= 20 ? 'Alcanza · dentro del margen' : diferenciaConfigurada > 20 ? `Bajar ${fmtMonto(Math.max(0, p.configuradoDiarioUSD! - p.ajusteDiarioUSD!), 'USD')}/día` : `Subir ${fmtMonto(Math.max(0, p.ajusteDiarioUSD! - p.configuradoDiarioUSD!), 'USD')}/día`
        const dato = (etiqueta: string, valor: string, destacado = false, detalle?: string) => <div>
          <dt style={{ color: 'var(--humo)', fontSize: 11, marginBottom: 5 }}>{etiqueta}</dt>
          <dd className="num" style={{ margin: 0, fontSize: destacado ? 18 : 15, color: destacado ? 'var(--hueso)' : undefined }}>{valor}</dd>
          {detalle && <dd style={{ margin: '4px 0 0', color: 'var(--humo)', fontSize: 11 }}>{detalle}</dd>}
        </div>
        return <li key={f.id} className="py-4 grid gap-4 xl:grid-cols-[minmax(180px,1.5fr)_minmax(0,5fr)_minmax(150px,1fr)]" style={{ borderBottom: '1px solid var(--filete)' }}>
          <div>
            <div style={{ fontSize: 15 }}>{f.cliente}</div>
            <a className="enlace" style={{ display: 'inline-block', marginTop: 7, fontSize: 11 }} href={f.links.ads} target="_blank" rel="noopener noreferrer">Revisar anuncios</a>
            <div className="mt-2" style={{ color: 'var(--humo)', fontSize: 10 }}>{p.fuente}</div>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-4" style={{ margin: 0 }}>
            {dato('Pactado para el mes', fmtMonto(p.mensualUSD, 'USD'))}
            {dato('Gastado este mes', fmtMonto(p.gastadoMesUSD, 'USD'))}
            {dato('Cierre proyectado', fmtMonto(p.proyeccionUSD, 'USD'), false, `${desvio > 0 ? '+' : '−'}${fmtMonto(Math.abs(desvio), 'USD')} vs. pactado`)}
            {dato('Falta gastar', fmtMonto(restante, 'USD'), false, p.gastadoMesUSD! > p.mensualUSD! ? `Ya excedido en ${fmtMonto(p.gastadoMesUSD! - p.mensualUSD!, 'USD')}` : 'para completar lo pactado')}
            {dato('Objetivo desde hoy', `${fmtMonto(p.ajusteDiarioUSD, 'USD')}/día`, true, `durante ${diasRestantes} días`)}
            {dato('Configurado en Meta', p.configuradoDiarioUSD == null ? 'No disponible' : `${fmtMonto(p.configuradoDiarioUSD, 'USD')}/día`, true, cumplimiento)}
          </dl>
          <div aria-label={`Avance mensual de ${f.cliente}`}>
            <div className="flex justify-between gap-2" style={{ fontSize: 11, color: 'var(--humo)' }}><span>Del pactado</span><span className="num">{porcentaje(consumido)}</span></div>
            <div role="progressbar" aria-label={`Presupuesto consumido de ${f.cliente}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, consumido))} aria-valuetext={`${porcentaje(consumido)} consumido; esperado ${porcentaje(esperado)}`} className="mt-2" style={{ height: 5, position: 'relative', background: 'var(--filete)', borderRadius: 3 }}>
              <div style={{ width: `${Math.min(100, Math.max(0, consumido))}%`, height: '100%', borderRadius: 3, background: grupo.color, opacity: 0.65 }} />
              <span title={`Esperado hasta ayer: ${porcentaje(esperado)}`} style={{ position: 'absolute', left: `${esperado}%`, top: -3, width: 1, height: 11, background: 'var(--hueso)', opacity: 0.75 }} />
            </div>
            <div className="mt-2" style={{ color: 'var(--humo)', fontSize: 10 }}>Esperado: {porcentaje(esperado)}</div>
          </div>
        </li>
      })}</ul>
    </section>)}
    {!cortos.length && !excesos.length && <p className="mt-2" style={{ color: 'var(--humo)' }}>Sin desvíos mayores a USD 20 con datos suficientes.</p>}
    {!!faltantes.length && <p className="mt-2" style={{ color: 'var(--humo)' }}>Sin presupuesto confirmado: {faltantes.map(f => f.cliente).join(', ')}.</p>}
  </details>
}

function RitmoPresupuesto({ f }: { f: FilaVista }) {
  return <div className="num" style={{ fontSize: 10, color: 'var(--humo)' }}>
    <div>Objetivo: {fmtMonto(f.presupuesto.objetivoDiarioUSD, 'USD')}/día</div>
    <div>Real: {fmtMonto(f.presupuesto.realDiarioUSD, 'USD')}/día (7 días)</div>
  </div>
}
