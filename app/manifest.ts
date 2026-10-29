import type { MetadataRoute } from 'next'
import { VERSION_ICONOS } from '@/components/shell/pwa'

// Manifiesto de la app instalable (PWA) de Despacho · Capital Jurídico. Es PÚBLICO a propósito (lib/auth/rutas.ts: /manifest.webmanifest
// y /pwa/*): el navegador lo pide sin cookie y no lleva ningún dato, solo nombre, colores e íconos.
// NO hay service worker ni caché sin conexión: los datos de clientes, ventas y finanzas son privados y siempre se leen
// del servidor con la sesión. Instalar la app solo agrega el ícono y la ventana sin barra del navegador.
// Los íconos los dibuja app/pwa/[nombre]/route.ts con el isotipo dorado de la marca (public/marca/isotipo-dorado.svg) sobre TINTA.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    // Nombre de la app instalada (pedido de Tomás, 25/10/2026): "Capital Jurídico"
    name: 'Capital Jurídico',
    short_name: 'Capital Jurídico',
    description: 'Despacho: el sistema de gestión de Capital Jurídico',
    lang: 'es',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    categories: ['business', 'productivity'],
    // Atajos al mantener apretado el ícono de la app (Android; iOS los ignora). Son rutas del dashboard: piden sesión como siempre.
    shortcuts: [
      { name: 'Resumen', url: '/' },
      { name: 'Ventas', url: '/ventas' },
      { name: 'Cobro de cuotas', url: '/cuotas' },
      { name: 'Clientes', url: '/clientes' },
      { name: 'Finanzas', url: '/finanzas' },
    ],
    background_color: '#f2eadc',
    theme_color: '#012d25',
    icons: [
      // ?v=: los celulares guardan los íconos 24 h por dirección; al cambiar el dibujo se sube el número para que los bajen
      // de nuevo (v=2: isotipo de Capital Jurídico, 25/10/2026; antes, el wordmark "DESPACHO")
      { src: `/pwa/icon-192.png?v=${VERSION_ICONOS}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/pwa/icon-512.png?v=${VERSION_ICONOS}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/pwa/icon-maskable-512.png?v=${VERSION_ICONOS}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
