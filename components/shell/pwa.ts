import type { Metadata, Viewport } from 'next'

// App instalable (PWA, SIN service worker ni caché sin conexión: los datos son privados y se leen siempre del servidor).
// Lo comparten el layout del shell y la página "/" (el Resumen vive fuera del grupo (shell) y solo importa el layout a mano:
// sus metadatos no heredan del layout, así que hay que repetirlos). El manifiesto es app/manifest.ts.
/**
 * Versión de los íconos de la app (va en la dirección como ?v=): los celulares los guardan 24 h por dirección, así que al
 * cambiar el dibujo se sube este número y los bajan de nuevo al reinstalar. 2 = isotipo de Capital Jurídico (25/10/2026).
 */
export const VERSION_ICONOS = 2

export const METADATA_APP: Pick<Metadata, 'appleWebApp' | 'icons'> = {
  // En iOS se abre sin la barra de Safari, con el nombre "Capital Jurídico" y el isotipo (app/pwa/[nombre]/route.ts)
  appleWebApp: { capable: true, title: 'Capital Jurídico', statusBarStyle: 'black-translucent' },
  icons: { apple: `/pwa/apple-touch-icon.png?v=${VERSION_ICONOS}` },
}

// Fondo TINTA también en la barra del navegador del celular. viewportFit 'cover' deja que la app llegue al borde de la
// pantalla (muesca, barra de inicio): cj.css respeta esas zonas con env(safe-area-inset-*).
export const VIEWPORT_APP: Viewport = { themeColor: '#012d25', colorScheme: 'light', width: 'device-width', initialScale: 1, viewportFit: 'cover' }
