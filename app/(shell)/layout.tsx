import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import { METADATA_APP, VIEWPORT_APP } from '@/components/shell/pwa'
import { MarcoShell } from '@/components/shell/MarcoShell'
import { obtenerSesion } from '@/lib/auth/sesion'

// Shell del dashboard unificado Capital Jurídico: marca (fuentes + cj.css), navegación y acceso por rol.
// El marco en sí (barra lateral, nombre y Salir) está en components/shell/MarcoShell.tsx, que también usan Finanzas y
// Anuncios. Sin sesión válida manda a /entrar (que vive fuera de este grupo para no redirigirse a sí misma).
// OJO: este layout no alcanza como barrera, no se re-ejecuta en cada navegación ni frena a las páginas hijas.
// Cada página tiene que llamar exigirAcceso(seccion) de lib/auth/sesion.ts antes de leer datos.

export const metadata: Metadata = {
  title: { default: 'Despacho · Capital Jurídico', template: '%s · Despacho' },
  description: 'Despacho: el sistema de gestión de Capital Jurídico',
  robots: { index: false, follow: false },
  ...METADATA_APP,
}

export const viewport: Viewport = VIEWPORT_APP

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion()
  if (!sesion) redirect('/entrar')
  return <MarcoShell sesion={sesion}>{children}</MarcoShell>
}
