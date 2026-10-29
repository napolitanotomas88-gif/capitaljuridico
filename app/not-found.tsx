import type { Metadata } from 'next'
import Link from 'next/link'

// 404 en español (el de Next sale en inglés), para quien ya tiene sesión: sin sesión el proxy manda a /entrar. Una sola salida: "/",
// que el proxy resuelve según quién sea la persona (cada rol cae en su sección), así que no hace falta leer la sesión acá.
//
// OJO: este archivo cuelga del layout raíz, que comparten el dashboard viejo, Finanzas y el login de Anuncios. Todo lo que se
// importe acá (cj.css, next/font) se precarga también en esas páginas, aunque no lo usen (~80 KB de fuentes y avisos "preloaded
// but not used" en la consola). Por eso va con estilos en línea, los colores del Manual (Tinta, Hueso, Latón) y tipografía del
// sistema. La marca completa vive en app/(shell). scripts/test-pantallas.mjs falla si alguien vuelve a importarla acá.

export const metadata: Metadata = {
  title: 'Página no encontrada · Despacho',
  robots: { index: false, follow: false },
}

const TINTA = '#0A0C0B'
const HUESO = '#EFE9DC'
const LATON = '#B08D4F'

export default function NoEncontrada() {
  return (
    <main
      lang="es"
      style={{
        flex: '1 1 auto',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 24,
        padding: '64px clamp(24px, 6vw, 96px)',
        background: TINTA,
        color: HUESO,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: 15,
        lineHeight: 1.6,
      }}
    >
      <p style={{ margin: 0, color: LATON, fontSize: 11, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Error 404</p>
      <h1 style={{ margin: 0, maxWidth: 560, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 'clamp(30px, 5vw, 46px)', fontWeight: 400, lineHeight: 1.15 }}>
        No encontramos esa página
      </h1>
      <p style={{ margin: 0, maxWidth: 560 }}>La dirección no existe o cambió de lugar.</p>
      <div>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            padding: '0 24px',
            background: HUESO,
            color: TINTA,
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.14em',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  )
}
