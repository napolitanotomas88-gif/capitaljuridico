'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icono } from './iconos'
import {
  ANCHO_DEFECTO, ANCHO_MAX, ANCHO_MIN, COOKIE_NAV, alArrastrar, anchoVisible, escribirPreferencia, limitarAncho, type PreferenciaNav,
} from './preferenciaNav'
import { Conectados } from './Conectados'
import { Wordmark } from './Wordmark'
import type { ItemNavegacion } from './secciones'

// Navegación unificada. Escritorio: barra lateral. Celular (<=768px): barra superior mínima (logo, nombre y rol) y BARRA
// INFERIOR de pestañas, como una app: hasta 4 secciones a mano del pulgar y "Más" con el resto y "Salir" en una hoja.
// El layout ya filtró las secciones según el rol; acá solo se dibujan. El item "aparte" (solo desarrollo) queda separado.
// Escritorio: la barra se puede ACHICAR a solo íconos (botón, o Ctrl/⌘+B) para tener más lugar en las calls, y su ancho se ajusta
// arrastrando el borde derecho (o con las flechas del teclado sobre él; doble clic vuelve al ancho normal). Queda guardado por persona.
// "Salir" es un formulario POST común a /api/auth/salir (anda sin JavaScript). Con el usuario de prueba de desarrollo no hay
// sesión que cerrar, así que no se muestran ni el nombre ni "Salir".
type Props = {
  items: ItemNavegacion[]
  aparte?: ItemNavegacion[]
  inicio: string
  nombre: string
  rol: string
  esDePrueba: boolean
  preferencia: PreferenciaNav
  /** Quién está conectado (27/10/2026): lo ve todo el equipo */
  verConectados?: boolean
}

function bajo(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
/** Activa si la ruta está bajo su enlace o bajo uno de sus prefijos ("Clientes" también en /guiones y /anuncios) */
function activo(pathname: string, it: ItemNavegacion): boolean {
  return bajo(pathname, it.href) || (it.prefijos ?? []).some((p) => bajo(pathname, p))
}

const MAX_PESTANAS = 5

export function Navegacion({ items, aparte = [], inicio, nombre, rol, esDePrueba, preferencia, verConectados = false }: Props) {
  const pathname = usePathname()
  const [pref, setPref] = useState<PreferenciaNav>(preferencia)
  const [arrastrando, setArrastrando] = useState(false)
  const lateral = useRef<HTMLElement>(null)

  // Aplica la preferencia al marco (variable CSS y data-nav en .cj-raiz) y la guarda en la cookie de la persona
  const aplicar = useCallback((p: PreferenciaNav, guardar = true) => {
    setPref(p)
    const raiz = lateral.current?.closest<HTMLElement>('.cj-raiz')
    if (raiz) {
      raiz.style.setProperty('--cj-ancho-lateral', `${anchoVisible(p)}px`)
      raiz.dataset.nav = p.chica ? 'chica' : 'abierta'
    }
    if (guardar) document.cookie = `${COOKIE_NAV}=${escribirPreferencia(p)}; path=/; max-age=31536000; samesite=lax`
  }, [])
  const alternar = useCallback(() => aplicar({ ...pref, chica: !pref.chica }), [aplicar, pref])

  // Ctrl/⌘+B achica o agranda la barra (salvo mientras se escribe en un campo)
  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      alternar()
    }
    document.addEventListener('keydown', alTecla)
    return () => document.removeEventListener('keydown', alTecla)
  }, [alternar])

  // Arrastre del borde: el ancho sigue al puntero; muy angosto pasa a "chica". Se guarda al soltar.
  const alBajar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setArrastrando(true)
  }
  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastrando || !lateral.current) return
    const izquierda = lateral.current.getBoundingClientRect().left
    aplicar(alArrastrar(e.clientX - izquierda, pref), false)
  }
  const alSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastrando) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setArrastrando(false)
    aplicar(pref)
  }
  const alTeclaBorde = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const paso = e.shiftKey ? 48 : 16
    const actual = pref.chica ? ANCHO_MIN : pref.ancho
    if (e.key === 'ArrowRight') aplicar({ chica: false, ancho: limitarAncho(actual + paso) })
    else if (e.key === 'ArrowLeft') aplicar(pref.chica || pref.ancho <= ANCHO_MIN ? { ...pref, chica: true } : { chica: false, ancho: limitarAncho(actual - paso) })
    else if (e.key === 'Home') aplicar({ ...pref, chica: true })
    else if (e.key === 'End') aplicar({ chica: false, ancho: ANCHO_MAX })
    else if (e.key === 'Enter' || e.key === ' ') alternar()
    else return
    e.preventDefault()
  }
  const [hojaAbierta, setHojaAbierta] = useState(false)
  const botonMas = useRef<HTMLButtonElement>(null)
  const todas = [...items, ...aparte]
  const hayMas = todas.length > MAX_PESTANAS || !esDePrueba
  // Con "Más" (siempre hay "Salir" para una sesión real) entran 4 secciones; sin "Más", hasta 5
  const visibles = hayMas ? todas.slice(0, MAX_PESTANAS - 1) : todas
  const enMas = hayMas ? todas.slice(MAX_PESTANAS - 1) : []
  const masActivo = enMas.some((it) => activo(pathname, it))

  // La hoja se cierra al navegar y con Escape
  const [rutaAnterior, setRutaAnterior] = useState(pathname)
  if (rutaAnterior !== pathname) { setRutaAnterior(pathname); if (hojaAbierta) setHojaAbierta(false) }
  useEffect(() => {
    if (!hojaAbierta) return
    const alTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHojaAbierta(false); botonMas.current?.focus() } }
    document.addEventListener('keydown', alTecla)
    return () => document.removeEventListener('keydown', alTecla)
  }, [hojaAbierta])

  const enlace = (it: ItemNavegacion) => (
    <Link href={it.href} aria-current={activo(pathname, it) ? 'page' : undefined} title={pref.chica ? it.etiqueta : undefined}>
      <Icono nombre={it.clave} />
      <span className="cj-nav__txt">{it.etiqueta}</span>
    </Link>
  )
  const etiquetaAlternar = pref.chica ? 'Agrandar el menú' : 'Achicar el menú'
  return (
    <>
      <aside className="cj-lateral" ref={lateral} id="cj-lateral" data-arrastrando={arrastrando || undefined}>
        <div className="cj-cabecera">
          <div className="cj-cabecera__fila">
            <Wordmark href={inicio} />
            <button type="button" className="cj-plegar" onClick={alternar} aria-expanded={!pref.chica} aria-controls="cj-lateral" aria-label={etiquetaAlternar} title={`${etiquetaAlternar} (Ctrl/⌘+B)`}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" />{pref.chica ? <path d="M13 10l2 2-2 2" /> : <path d="M16 10l-2 2 2 2" />}
              </svg>
            </button>
          </div>
          <div className="cj-cuenta">
            {!esDePrueba && (
              <p className="cj-cuenta__nombre" title={nombre}>
                {nombre}
              </p>
            )}
            <p className="cj-etiqueta cj-rol">{esDePrueba ? `Prueba · ${rol}` : rol}</p>
            {verConectados && !pref.chica && <Conectados />}
          </div>
        </div>
        <nav aria-label="Secciones">
          <ul className="cj-nav">
            {items.map((it) => (
              <li key={it.clave}>{enlace(it)}</li>
            ))}
            {aparte.map((it, i) => (
              <li key={it.clave} className={i === 0 ? 'cj-nav__aparte' : undefined}>
                {enlace(it)}
              </li>
            ))}
          </ul>
        </nav>
        {!esDePrueba && (
          <form method="post" action="/api/auth/salir" className="cj-salir">
            <button type="submit" className="cj-boton cj-boton--secundario" title={pref.chica ? 'Salir' : undefined}>
              <Icono nombre="salir" />
              <span className="cj-nav__txt">Salir</span>
            </button>
          </form>
        )}
        {/* Borde para ajustar el ancho (solo escritorio) */}
        <div
          className="cj-borde"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ancho del menú: arrastrá o usá las flechas"
          aria-controls="cj-lateral"
          aria-valuemin={0}
          aria-valuemax={ANCHO_MAX}
          aria-valuenow={anchoVisible(pref)}
          tabIndex={0}
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          onKeyDown={alTeclaBorde}
          onDoubleClick={() => aplicar({ chica: false, ancho: ANCHO_DEFECTO })}
        />
      </aside>

      {/* Barra inferior (solo celular, ver cj.css) */}
      <nav className="cj-tabbar" aria-label="Secciones">
        <ul>
          {visibles.map((it) => (
            <li key={it.clave}>
              <Link href={it.href} aria-current={activo(pathname, it) ? 'page' : undefined}>
                <Icono nombre={it.clave} />
                <span>{it.etiqueta}</span>
              </Link>
            </li>
          ))}
          {hayMas && (
            <li>
              <button ref={botonMas} type="button" aria-haspopup="dialog" aria-expanded={hojaAbierta} aria-current={masActivo ? 'page' : undefined} onClick={() => setHojaAbierta((v) => !v)}>
                <Icono nombre="mas" />
                <span>Más</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {hojaAbierta && (
        <div className="cj-hoja-fondo" onClick={() => setHojaAbierta(false)}>
          <div className="cj-hoja" role="dialog" aria-modal="true" aria-label="Más opciones" onClick={(e) => e.stopPropagation()}>
            <span className="cj-hoja__asa" aria-hidden="true" />
            {!esDePrueba && (
              <p className="cj-hoja__cuenta">
                <strong>{nombre}</strong>
                <span className="cj-etiqueta">{rol}</span>
              </p>
            )}
            {verConectados && <Conectados />}
            <ul>
              {enMas.map((it) => (
                <li key={it.clave}>
                  <Link href={it.href} aria-current={activo(pathname, it) ? 'page' : undefined}>
                    <Icono nombre={it.clave} />
                    {it.etiqueta}
                  </Link>
                </li>
              ))}
              {!esDePrueba && (
                <li>
                  <form method="post" action="/api/auth/salir">
                    <button type="submit">
                      <Icono nombre="salir" />
                      Salir
                    </button>
                  </form>
                </li>
              )}
            </ul>
            <button type="button" className="cj-hoja__cerrar" onClick={() => setHojaAbierta(false)} autoFocus>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
