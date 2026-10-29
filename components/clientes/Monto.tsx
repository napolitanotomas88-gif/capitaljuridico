import type { ReactNode } from 'react'
import './montos.css'

// Una cifra de dinero que el botón "Ocultar montos" (BotonMontos.tsx) puede tapar en pantalla (26/10/2026, pedido de Tomás:
// para compartir pantalla). Es solo visual: lo que no puede ver un rol sin Finanzas ya no llega del servidor. Sirve en
// componentes de servidor y de cliente (es un span con la clase cj-monto).
export function Monto({ children }: { children: ReactNode }) {
  return <span className="cj-monto">{children}</span>
}
