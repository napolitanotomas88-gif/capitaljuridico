// Esqueletos de carga del shell: bloques con brillo suave (clase `.esqueleto` de app/globals.css, la misma del Resumen y del
// tablero de anuncios) con la forma aproximada de la pantalla que viene. Sin estilos nuevos: solo medidas en línea y las clases
// de siempre (cj-pila, cj-rejilla). El brillo se apaga solo con «reducir movimiento» (regla general de globals.css).
// Se usan desde los loading.tsx de cada sección y como reserva de los <Suspense> que traen fuentes lentas.
import type { CSSProperties, ReactNode } from 'react'

const RADIO = 'var(--cj-radio)'

function Barra({ alto, ancho = '100%', opacidad = 1 }: { alto: number; ancho?: CSSProperties['width']; opacidad?: number }) {
  return <div className="esqueleto" aria-hidden="true" style={{ height: alto, width: ancho, maxWidth: '100%', borderRadius: RADIO, opacity: opacidad }} />
}

/** El lugar del título de la pantalla (etiqueta chica + título). */
export function EsqueletoTitulo() {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Barra alto={12} ancho={96} />
      <Barra alto={36} ancho="min(360px, 70%)" />
    </div>
  )
}

/** Una tira de cifras (las tarjetas del resumen de arriba). */
export function EsqueletoCifras({ cantidad = 4 }: { cantidad?: number }) {
  return (
    <div className="cj-rejilla" aria-hidden="true">
      {Array.from({ length: cantidad }, (_, i) => <Barra key={i} alto={96} />)}
    </div>
  )
}

/** Renglones de una tabla o de una lista, cada vez más tenues. */
export function EsqueletoFilas({ filas = 6, alto = 44 }: { filas?: number; alto?: number }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: filas }, (_, i) => <Barra key={i} alto={alto} opacidad={Math.max(0.35, 1 - i * 0.12)} />)}
    </div>
  )
}

/** Envoltorio accesible: avisa «cargando» una sola vez y deja las barras fuera del lector de pantalla. */
export function EsqueletoZona({ etiqueta, chica = false, children }: { etiqueta: string; chica?: boolean; children: ReactNode }) {
  return (
    <div className={chica ? 'cj-pila cj-pila--chica' : 'cj-pila'} role="status" aria-busy="true" aria-label={etiqueta}>
      {children}
    </div>
  )
}

/** Pantalla entera genérica: título, cifras (opcionales) y una lista. */
export function EsqueletoPantalla({ etiqueta = 'Cargando…', cifras = 0, filas = 6 }: { etiqueta?: string; cifras?: number; filas?: number }) {
  return (
    <EsqueletoZona etiqueta={etiqueta}>
      <EsqueletoTitulo />
      {cifras > 0 && <EsqueletoCifras cantidad={cifras} />}
      <EsqueletoFilas filas={filas} />
    </EsqueletoZona>
  )
}
