import type { Viewport } from 'next'
import { MarcoOpcional } from '@/components/shell/MarcoOpcional'
import { VIEWPORT_APP } from '@/components/shell/pwa'

// Login de Finanzas y diseño clásico (/finanzas/clasico): verdes y dentro del marco del dashboard (menú, nombre y Salir) cuando hay sesión de Google. Se abre igual
// que antes, con su contraseña. Sin sesión de Google se ve sola. Ver components/shell/MarcoOpcional.tsx.
export const viewport: Viewport = VIEWPORT_APP

export default function FinanzasLayout({ children }: { children: React.ReactNode }) {
  return <MarcoOpcional seccion="finanzas">{children}</MarcoOpcional>
}
