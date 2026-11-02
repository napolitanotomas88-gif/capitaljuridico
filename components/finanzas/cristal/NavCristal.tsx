'use client'
// Navegación de cristal de Finanzas (PRUEBA, 1/11/2026). Réplica del video de referencia que pasó Tomás («Glassy SideBar»):
// riel de íconos ⇄ panel con la misma animación (ancho con curva de salida fuerte, etiquetas que entran escalonadas con
// desenfoque, píldora activa «líquida» con dos resortes, lupa del riel con magnificación tipo dock, tooltip que se desliza,
// insignias, subárbol desplegable, interruptor y usuario abajo). Colores: verde Toga / oro mate de Capital Jurídico.
// Atajos: [ abre y cierra; ⌘K (o Ctrl+K) enfoca el buscador. Estilos en ./cristal.css (todo bajo .fin-cristal).
// Solo presentación: los conteos de las insignias son lecturas (select) por /api/finanzas/db; no se escribe nada.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { prepararBase, supabase } from '../skwd/supabase'
import { IconoCristal } from './iconos'

import { BASE_PRUEBA } from './rutas'
export { BASE_PRUEBA }
const COOKIE_NAV = 'fin_cristal_nav'
const COOKIE_NOCHE = 'fin_cristal_noche'

type Item = { id: string; etiqueta: string; href: string; insignia?: 'gris' | 'roja'; rotuloInsignia?: string }
type Grupo = { titulo: string; items: (Item | { id: 'reportes'; etiqueta: string; hijos: (Item & { punto: string })[] })[] }

const ruta = (v: string) => (v === 'resumen' ? BASE_PRUEBA : `${BASE_PRUEBA}/${v}`)

const GRUPOS: Grupo[] = [
  {
    titulo: 'Finanzas',
    items: [
      { id: 'resumen', etiqueta: 'Resumen', href: ruta('resumen') },
      { id: 'pagos', etiqueta: 'Pagos', href: ruta('pagos'), insignia: 'gris', rotuloInsignia: 'para revisar' },
      { id: 'gastos', etiqueta: 'Gastos', href: ruta('gastos') },
      { id: 'equipo', etiqueta: 'Equipo', href: ruta('equipo') },
      { id: 'pagos-equipo', etiqueta: 'Pagos del equipo', href: ruta('pagos-equipo'), insignia: 'roja', rotuloInsignia: 'sin pagar' },
    ],
  },
  {
    titulo: 'Control',
    items: [
      { id: 'correcciones', etiqueta: 'Correcciones', href: ruta('correcciones') },
      {
        id: 'reportes', etiqueta: 'Reportes', hijos: [
          { id: 'estado', etiqueta: 'Estado de resultados', href: ruta('estado'), punto: 'verde' },
          { id: 'tablero', etiqueta: 'Tablero', href: ruta('tablero'), punto: 'oro' },
          { id: 'personales', etiqueta: 'Gastos personales', href: ruta('personales'), punto: 'bordo' },
        ],
      },
    ],
  },
]

const TODOS: Item[] = GRUPOS.flatMap((g) => g.items.flatMap((i) => ('hijos' in i ? i.hijos : [i])))

function vistaDe(pathname: string): string {
  if (!pathname.startsWith(BASE_PRUEBA)) return 'resumen'
  const resto = pathname.slice(BASE_PRUEBA.length).replace(/^\//, '').split('/')[0]
  return resto || 'resumen'
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function guardarCookie(nombre: string, valor: string) {
  try { document.cookie = `${nombre}=${valor}; path=/finanzas; max-age=31536000; samesite=lax` } catch { /* sin cookies: solo no se recuerda */ }
}

/** Resorte crítico-amortiguado simple (masa 1) para cada borde de la píldora activa. */
type Resorte = { x: number; v: number }
function paso(r: Resorte, destino: number, k: number, c: number, dt: number) {
  const a = -k * (r.x - destino) - c * r.v
  r.v += a * dt
  r.x += r.v * dt
}

export function NavCristal({ abiertaInicial, nocheInicial, onCambio }: { abiertaInicial: boolean; nocheInicial: boolean; onCambio: (estado: { abierta: boolean; noche: boolean }) => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const actual = vistaDe(pathname)
  const [abierta, setAbierta] = useState(abiertaInicial)
  const [noche, setNoche] = useState(nocheInicial)
  const [reportes, setReportes] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [correo, setCorreo] = useState<string | null>(null)
  const [conteos, setConteos] = useState<Record<string, number>>({})
  const [menuUsuario, setMenuUsuario] = useState(false)
  const [tip, setTip] = useState<{ texto: string; extra?: string; y: number; x: number; visible: boolean; siempre?: boolean }>({ texto: '', y: 0, x: 0, visible: false })
  const [anchoTip, setAnchoTip] = useState(0)
  const [presionado, setPresionado] = useState<string | null>(null)

  const lista = useRef<HTMLDivElement>(null)
  const pildora = useRef<HTMLSpanElement>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const medidor = useRef<HTMLSpanElement>(null)

  useEffect(() => { onCambio({ abierta, noche }) }, [abierta, noche, onCambio])
  // En el celular se entra siempre con el riel (el panel abierto taparía el contenido), aunque en la compu se haya dejado abierto
  useEffect(() => {
    const raf = requestAnimationFrame(() => { if (window.matchMedia('(max-width: 767px)').matches) setAbierta(false) })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Correo de la sesión y conteos de las insignias (solo lectura)
  useEffect(() => {
    let vivo = true
    prepararBase().then(async (b) => {
      if (!vivo) return
      setCorreo(b.correo)
      if (b.modo !== 'token') return
      type Respuesta = { data: unknown; error: unknown }
      const [rev, pend] = (await Promise.all([
        supabase.from('pagos_vigentes').select('id').eq('revisar', true).limit(5000),
        supabase.from('pagos_equipo_vigentes').select('id').eq('pagado', false).limit(5000),
      ])) as Respuesta[]
      if (!vivo) return
      const c: Record<string, number> = {}
      if (!rev.error && Array.isArray(rev.data)) c.pagos = rev.data.length
      if (!pend.error && Array.isArray(pend.data)) c['pagos-equipo'] = pend.data.length
      setConteos(c)
    })
    return () => { vivo = false }
  }, [])

  const alternar = useCallback(() => {
    setAbierta((a) => { guardarCookie(COOKIE_NAV, a ? 'riel' : 'panel'); return !a })
    setMenuUsuario(false)
  }, [])

  const alternarNoche = () => setNoche((n) => { guardarCookie(COOKIE_NOCHE, n ? '0' : '1'); return !n })

  // Atajos: [ abre/cierra · ⌘K / Ctrl+K busca · Escape cierra el menú del usuario
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const enCampo = e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, [contenteditable="true"]') != null)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!abierta) { setAbierta(true); guardarCookie(COOKIE_NAV, 'panel') }
        setTimeout(() => buscador.current?.focus(), abierta ? 0 : 200)
        return
      }
      if (e.key === '[' && !enCampo && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); alternar() }
      if (e.key === 'Escape') {
        setMenuUsuario(false)
        // En el celular el panel abierto tapa el contenido: Escape lo cierra (como tocar el velo)
        if (abierta && window.matchMedia('(max-width: 767px)').matches) alternar()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [abierta, alternar])

  // En el celular el panel abierto va encima del contenido: se cierra al navegar
  const [rutaPrevia, setRutaPrevia] = useState(pathname)
  if (rutaPrevia !== pathname) {
    setRutaPrevia(pathname)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) setAbierta(false)
  }

  // ── Búsqueda: filtra las páginas; Enter abre la primera ──
  const coincide = useCallback((t: string) => !busqueda.trim() || sinAcentos(t).includes(sinAcentos(busqueda.trim())), [busqueda])
  const resultados = useMemo(() => TODOS.filter((i) => coincide(i.etiqueta)), [coincide])

  // ── Píldora activa «líquida»: dos resortes, el borde delantero rápido y el trasero lento ──
  const resortes = useRef<{ arriba: Resorte; abajo: Resorte; iniciada: boolean; raf: number }>({ arriba: { x: 0, v: 0 }, abajo: { x: 0, v: 0 }, iniciada: false, raf: 0 })
  const moverPildora = useCallback((inmediato = false) => {
    const l = lista.current, p = pildora.current
    if (!l || !p) return
    const fila = l.querySelector<HTMLElement>(`[data-vista="${actual}"]`)
    if (!fila || fila.offsetParent === null) { p.style.opacity = '0'; return }
    p.style.opacity = '1'
    const extra = abierta ? 0 : 1
    // Posición dentro de la lista (no del grupo): por rectángulos, sumando el desplazamiento de la lista
    const rf = fila.getBoundingClientRect(), rl = l.getBoundingClientRect()
    const arribaFila = rf.top - rl.top + l.scrollTop
    const destArriba = arribaFila - extra
    const destAbajo = arribaFila + rf.height + extra
    const r = resortes.current
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    cancelAnimationFrame(r.raf)
    if (!r.iniciada || inmediato || reducir) {
      r.arriba = { x: destArriba, v: 0 }; r.abajo = { x: destAbajo, v: 0 }; r.iniciada = true
      p.style.top = `${destArriba}px`; p.style.height = `${destAbajo - destArriba}px`; p.style.setProperty('--inflar', '0px')
      return
    }
    const bajando = destArriba > r.arriba.x
    let previo = performance.now()
    const cuadro = (ahora: number) => {
      let dt = Math.min(0.032, (ahora - previo) / 1000)
      previo = ahora
      // subpasos para que el resorte rápido sea estable
      while (dt > 0) {
        const h = Math.min(dt, 1 / 240)
        paso(r.arriba, destArriba, bajando ? 200 : 500, bajando ? 26 : 30, h)
        paso(r.abajo, destAbajo, bajando ? 500 : 200, bajando ? 30 : 26, h)
        dt -= h
      }
      const alto = Math.max(r.abajo.x - r.arriba.x, 8)
      const estiro = Math.max(0, alto - (destAbajo - destArriba))
      p.style.top = `${r.arriba.x}px`
      p.style.height = `${alto}px`
      p.style.setProperty('--inflar', `${Math.min(6, estiro * 0.12)}px`)
      const quieto = Math.abs(r.arriba.x - destArriba) < 0.3 && Math.abs(r.abajo.x - destAbajo) < 0.3 && Math.abs(r.arriba.v) + Math.abs(r.abajo.v) < 2
      if (quieto) {
        p.style.top = `${destArriba}px`; p.style.height = `${destAbajo - destArriba}px`; p.style.setProperty('--inflar', '0px')
        return
      }
      r.raf = requestAnimationFrame(cuadro)
    }
    r.raf = requestAnimationFrame(cuadro)
  }, [actual, abierta])

  useLayoutEffect(() => { moverPildora() }, [moverPildora, reportes, busqueda])
  // Al abrir o cerrar el subárbol, la fila activa puede moverse cuando termina la transición del alto
  useEffect(() => {
    const t = setTimeout(() => moverPildora(), 260)
    return () => clearTimeout(t)
  }, [reportes, moverPildora])
  // Al abrir o cerrar el panel, el paso entre filas cambia (riel 46 → panel 40) con transición: la píldora acompaña cuadro a cuadro
  useEffect(() => {
    const inicio = performance.now()
    let raf = 0
    const seguir = () => {
      moverPildora(true)
      if (performance.now() - inicio < 420) raf = requestAnimationFrame(seguir)
    }
    raf = requestAnimationFrame(seguir)
    return () => cancelAnimationFrame(raf)
  }, [abierta, moverPildora])
  useEffect(() => {
    const r = resortes.current
    const alCambiar = () => moverPildora(true)
    window.addEventListener('resize', alCambiar)
    return () => { window.removeEventListener('resize', alCambiar); cancelAnimationFrame(r.raf) }
  }, [moverPildora])

  // ── Riel: magnificación tipo dock (escala continua según la distancia vertical al cursor) ──
  const magnificar = (e: React.MouseEvent) => {
    const l = lista.current
    if (abierta || !l || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const filas = Array.from(l.querySelectorAll<HTMLElement>('[data-magnifica]')).filter((f) => f.offsetParent !== null)
    const escalas = filas.map((f) => {
      const c = f.getBoundingClientRect()
      const dy = e.clientY - (c.top + c.height / 2)
      return 1 + 0.45 * Math.max(0, 1 - Math.abs(dy) / 90)
    })
    const extras = escalas.map((s) => (s - 1) * 22)
    // la fila más cercana al cursor queda quieta; las de arriba suben y las de abajo bajan
    let k = 0
    escalas.forEach((s, i) => { if (s > escalas[k]) k = i })
    const acum = (i: number) => extras.slice(0, i).reduce((a, b) => a + b, 0) + extras[i] / 2
    const centro = acum(k)
    filas.forEach((f, i) => {
      f.style.setProperty('--s', escalas[i].toFixed(3))
      f.style.setProperty('--dy', `${(acum(i) - centro).toFixed(2)}px`)
      if (f.dataset.vista === actual) {
        pildora.current?.style.setProperty('--s', escalas[i].toFixed(3))
        pildora.current?.style.setProperty('--dy', `${(acum(i) - centro).toFixed(2)}px`)
      }
    })
  }
  const soltarMagnificacion = () => {
    lista.current?.querySelectorAll<HTMLElement>('[data-magnifica]').forEach((f) => { f.style.setProperty('--s', '1'); f.style.setProperty('--dy', '0px') })
    pildora.current?.style.setProperty('--s', '1')
    pildora.current?.style.setProperty('--dy', '0px')
  }
  useEffect(() => { if (abierta) soltarMagnificacion() }, [abierta])

  // ── Tooltip de cristal: uno solo que se desliza entre íconos ──
  const mostrarTip = (el: HTMLElement, texto: string, extra?: string, siempre = false) => {
    const contenedor = el.closest('.fcn')
    if ((abierta && !siempre) || !contenedor) return
    const r = el.getBoundingClientRect(), base = contenedor.getBoundingClientRect()
    setTip({ texto, extra, y: r.top + r.height / 2 - base.top, x: siempre ? r.right - base.left : base.width, visible: true, siempre })
  }
  const ocultarTip = () => setTip((t) => ({ ...t, visible: false }))
  useLayoutEffect(() => { if (medidor.current) setAnchoTip(medidor.current.offsetWidth) }, [tip.texto, tip.extra])
  // Con el panel abierto solo queda el tooltip del botón circular
  const tipVisible = tip.visible && (!abierta || tip.siempre === true)

  const propsTip = (texto: string, extra?: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => mostrarTip(e.currentTarget, texto, extra),
    onFocus: (e: React.FocusEvent<HTMLElement>) => mostrarTip(e.currentTarget, texto, extra),
    onBlur: ocultarTip,
  })
  const presionar = (id: string) => ({
    onPointerDown: () => setPresionado(id),
    onPointerUp: () => setPresionado(null),
    onPointerLeave: () => setPresionado((p) => (p === id ? null : p)),
  })

  const iniciales = (correo ?? 'F').split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'F'
  const nombreUsuario = correo ? (correo.endsWith('@finanzas.despacho') ? 'Acceso con clave' : correo.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) : 'Finanzas'

  let fila = 0
  const filaItem = (item: Item, icono: string): ReactNode => {
    if (!coincide(item.etiqueta)) return null
    const i = fila++
    const n = conteos[item.id] ?? 0
    const activo = actual === item.id
    return (
      <Link key={item.id} href={item.href} className="fcn-item" data-vista={item.id} data-magnifica data-presionado={presionado === item.id || undefined}
        aria-current={activo ? 'page' : undefined} style={{ '--i': i } as CSSProperties} {...presionar(item.id)}
        {...propsTip(item.etiqueta, n > 0 ? String(n) : undefined)} onMouseLeave={ocultarTip}
        aria-label={n > 0 ? `${item.etiqueta} (${n} ${item.rotuloInsignia})` : undefined}>
        <span className="fcn-ico"><IconoCristal nombre={icono} />{n > 0 && <span className="fcn-punto-riel" aria-hidden="true" />}</span>
        <span className="fcn-txt fcn-anima">{item.etiqueta}</span>
        {n > 0 && <span className={`fcn-insignia fcn-insignia--${item.insignia} fcn-anima`} aria-hidden="true">{n > 99 ? '99+' : n}</span>}
      </Link>
    )
  }

  return (
    <div className="fcn" data-abierta={abierta} onMouseLeave={() => { ocultarTip(); soltarMagnificacion() }}>
      <nav className="fcn-panel" aria-label="Finanzas (prueba)">
        {/* Encabezado: logo + nombre */}
        <div className="fcn-cab">
          <Link href={BASE_PRUEBA} className="fcn-logo" aria-label="Capital Jurídico · Finanzas: ir al Resumen" {...propsTip('Capital Jurídico')} onMouseLeave={ocultarTip}>
            <span className="fcn-logo__iso" aria-hidden="true" />
          </Link>
          <div className="fcn-cab__textos fcn-anima" style={{ '--i': 0 } as CSSProperties} aria-hidden={!abierta}>
            <strong>Capital Jurídico</strong>
            <span>Finanzas · prueba</span>
          </div>
        </div>

        {/* Buscador: en el riel queda la lupa sola */}
        <div className="fcn-buscar" onClick={() => buscador.current?.focus()}>
          <button type="button" className="fcn-buscar__lupa" tabIndex={abierta ? -1 : 0} aria-label="Buscar páginas (⌘K)"
            {...propsTip('Buscar', '⌘K')} onMouseLeave={ocultarTip}
            onClick={(e) => { e.stopPropagation(); if (!abierta) { setAbierta(true); guardarCookie(COOKIE_NAV, 'panel') } setTimeout(() => buscador.current?.focus(), abierta ? 0 : 200) }}>
            <IconoCristal nombre="buscar" tam={16} />
          </button>
          <input ref={buscador} type="search" className="fcn-anima" style={{ '--i': 1 } as CSSProperties} placeholder="Buscar páginas" aria-label="Buscar páginas de Finanzas"
            value={busqueda} tabIndex={abierta ? 0 : -1} onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && resultados[0]) { router.push(resultados[0].href); setBusqueda(''); e.currentTarget.blur() }
              if (e.key === 'Escape') { setBusqueda(''); e.currentTarget.blur() }
            }} />
          <kbd className="fcn-kbd fcn-anima" style={{ '--i': 1 } as CSSProperties} aria-hidden="true">⌘K</kbd>
        </div>

        <div ref={lista} className="fcn-lista" onMouseMove={magnificar} onMouseLeave={soltarMagnificacion}>
          <span ref={pildora} className="fcn-activa" aria-hidden="true" />
          {GRUPOS.map((g, gi) => {
            const visibles = g.items.filter((it) => ('hijos' in it ? it.hijos.some((h) => coincide(h.etiqueta)) || coincide(it.etiqueta) : coincide(it.etiqueta)))
            if (!visibles.length) return null
            return (
              <div key={g.titulo} className="fcn-grupo" role="group" aria-label={g.titulo}>
                <div className="fcn-titulo" data-primero={gi === 0 || undefined} aria-hidden="true">
                  <span className="fcn-titulo__texto fcn-anima" style={{ '--i': fila } as CSSProperties}>{g.titulo}</span>
                  <span className="fcn-titulo__linea" />
                </div>
                {visibles.map((it) => {
                  if (!('hijos' in it)) return filaItem(it, it.id)
                  const i = fila++
                  const hijoActivo = it.hijos.some((h) => h.id === actual)
                  const abiertoSub = reportes || busqueda.trim() !== ''
                  return (
                    <div key={it.id} className="fcn-arbol" data-desplegado={abiertoSub}>
                      <button type="button" className="fcn-item" data-magnifica data-vista={!abiertoSub || !abierta ? (hijoActivo ? actual : undefined) : undefined}
                        aria-expanded={abiertoSub} aria-controls="fcn-sub-reportes" style={{ '--i': i } as CSSProperties} data-presionado={presionado === it.id || undefined}
                        {...presionar(it.id)} {...propsTip(it.etiqueta)} onMouseLeave={ocultarTip}
                        onClick={() => { if (!abierta) { setAbierta(true); setReportes(true); guardarCookie(COOKIE_NAV, 'panel') } else setReportes((r) => !r) }}>
                        <span className="fcn-ico"><IconoCristal nombre="reportes" /></span>
                        <span className="fcn-txt fcn-anima">{it.etiqueta}</span>
                        <span className="fcn-chevron fcn-anima" aria-hidden="true"><IconoCristal nombre="arriba" tam={14} trazo={2} /></span>
                      </button>
                      <div className="fcn-sub" id="fcn-sub-reportes">
                        <div className="fcn-sub__interior">
                          {it.hijos.filter((h) => coincide(h.etiqueta) || coincide(it.etiqueta)).map((h, hi) => {
                            fila++
                            return (
                              <Link key={h.id} href={h.href} className="fcn-subitem" data-vista={h.id} aria-current={actual === h.id ? 'page' : undefined}
                                style={{ '--j': hi } as CSSProperties} tabIndex={abierta && abiertoSub ? 0 : -1}>
                                <span className={`fcn-punto fcn-punto--${h.punto}`} aria-hidden="true" />
                                <span className="fcn-subitem__txt">{h.etiqueta}</span>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
          {busqueda.trim() && !resultados.length && <p className="fcn-vacio">Sin páginas con «{busqueda.trim()}»</p>}
        </div>

        {/* Modo nocturno: separado por 20 px */}
        <div className="fcn-noche">
          <button type="button" className="fcn-item fcn-item--noche" role="switch" aria-checked={noche} onClick={alternarNoche}
            {...propsTip(noche ? 'Modo nocturno: sí' : 'Modo nocturno')} onMouseLeave={ocultarTip} style={{ '--i': fila + 1 } as CSSProperties}>
            <span className="fcn-ico"><IconoCristal nombre={noche ? 'luna' : 'sol'} /></span>
            <span className="fcn-txt fcn-anima">Modo nocturno</span>
            <span className="fcn-interruptor fcn-anima" aria-hidden="true"><span className="fcn-interruptor__perilla" /></span>
          </button>
        </div>

        {/* Usuario: correo de la sesión de Finanzas */}
        <div className="fcn-usuario">
          <button type="button" className="fcn-usuario__boton" aria-haspopup="menu" aria-expanded={menuUsuario} onClick={() => setMenuUsuario((m) => !m)}
            {...propsTip(correo ?? 'Sesión de Finanzas')} onMouseLeave={ocultarTip}>
            <span className="fcn-avatar" aria-hidden="true">{iniciales}<span className="fcn-en-linea" /></span>
            <span className="fcn-usuario__textos fcn-anima" style={{ '--i': fila + 2 } as CSSProperties}>
              <strong>{nombreUsuario}</strong>
              <span>{correo ?? '—'}</span>
            </span>
            <span className="fcn-usuario__chev fcn-anima" style={{ '--i': fila + 2 } as CSSProperties}><IconoCristal nombre="arribaAbajo" tam={14} /></span>
          </button>
        </div>
      </nav>

      {/* Botón circular expandir / contraer: mitad afuera del borde, a la altura del logo */}
      <button type="button" className="fcn-plegar" onClick={(e) => { const boton = e.currentTarget; alternar(); setTimeout(() => { if (boton.matches(':hover')) mostrarTip(boton, abierta ? 'Expandir' : 'Contraer', '[', true) }, 320) }} aria-label={abierta ? 'Contraer el menú ([)' : 'Expandir el menú ([)'} aria-expanded={abierta}
        onMouseEnter={(e) => mostrarTip(e.currentTarget, abierta ? 'Contraer' : 'Expandir', '[', true)} onMouseLeave={ocultarTip}
        onFocus={(e) => mostrarTip(e.currentTarget, abierta ? 'Contraer' : 'Expandir', '[', true)} onBlur={ocultarTip}>
        <IconoCristal nombre={abierta ? 'izquierda' : 'derecha'} tam={12} trazo={2.2} />
      </button>

      {menuUsuario && (
        <div className="fcn-menu" role="menu" aria-label="Sesión">
          <Link role="menuitem" href="/finanzas" className="fcn-menu__op"><IconoCristal nombre="volver" tam={16} /> Finanzas actual</Link>
          <Link role="menuitem" href="/" className="fcn-menu__op"><IconoCristal nombre="volver" tam={16} /> Volver al Despacho</Link>
          <form method="post" action="/api/finanzas/logout">
            <button role="menuitem" type="submit" className="fcn-menu__op"><IconoCristal nombre="salir" tam={16} /> Cerrar Finanzas</button>
          </form>
        </div>
      )}

      {/* Tooltip: píldora clara de cristal que se desliza en Y y cambia de ancho */}
      <div className="fcn-tip" role="tooltip" data-visible={tipVisible} aria-hidden={!tipVisible}
        style={{ '--tip-y': `${tip.y}px`, '--tip-x': `${tip.x}px`, width: anchoTip || undefined } as CSSProperties}>
        <span className="fcn-tip__txt">{tip.texto}</span>
        {tip.extra && <span className="fcn-tip__extra">{tip.extra}</span>}
      </div>
      <span ref={medidor} className="fcn-tip fcn-tip--medir" aria-hidden="true">
        <span className="fcn-tip__txt">{tip.texto}</span>
        {tip.extra && <span className="fcn-tip__extra">{tip.extra}</span>}
      </span>
      {abierta && <div className="fcn-velo" onClick={alternar} aria-hidden="true" />}
    </div>
  )
}

