// Íconos de línea estilo Lucide (18 px, trazo 1,75) para la navegación de cristal de Finanzas (prueba, 1/11/2026).
// Dibujados a mano (sin dependencia nueva): mismos trazos que Lucide (licencia ISC) para los que usa el video de referencia.
import type { ReactNode } from 'react'

const TRAZOS: Record<string, ReactNode> = {
  // Resumen: 4 círculos en grilla (el "Dashboard" del video)
  resumen: (<><circle cx="7" cy="7" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="7" cy="17" r="3" /><circle cx="17" cy="17" r="3" /></>),
  // Pagos: rayo (el "Activity" del video: lo que entra)
  pagos: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  // Gastos: billetera
  gastos: (<><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>),
  // Equipo: personas
  equipo: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  // Pagos del equipo: calendario (el "Schedule" del video: los pagos de cada mes)
  'pagos-equipo': (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></>),
  // Correcciones: globo de mensaje (el "Messages" del video)
  correcciones: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  // Reportes (grupo desplegable): capas (el "Projects" del video)
  reportes: (<><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /></>),
  // Estado de resultados: barras
  estado: (<><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></>),
  // Gastos personales: engranaje (el "Settings" del video)
  personales: (<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>),
  buscar: (<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  sol: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>),
  luna: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  derecha: <path d="m9 18 6-6-6-6" />,
  izquierda: <path d="m15 18-6-6 6-6" />,
  arriba: <path d="m18 15-6-6-6 6" />,
  arribaAbajo: (<><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></>),
  volver: (<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>),
  salir: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
}

export type NombreIcono = keyof typeof TRAZOS

export function IconoCristal({ nombre, tam = 18, trazo = 1.75, className }: { nombre: string; tam?: number; trazo?: number; className?: string }) {
  return (
    <svg className={className} width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={trazo}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {TRAZOS[nombre]}
    </svg>
  )
}
